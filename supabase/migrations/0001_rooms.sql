-- Poker Tracker: shared games ("rooms").
--
-- The event log is the only game data stored. Phones read it, replay it with
-- the engine, and write through the functions below; there are no direct
-- write permissions on the tables.
--
-- Every change to the log bumps rooms.version. Writers pass the version
-- they last saw; if it no longer matches, the call fails with 'conflict' and
-- the phone reloads, re-checks the entry with the engine, and retries.
--
-- Permissions (same as src/sync/rules.ts):
--   host: anything
--   phone linked to a player: only 'action' events for that player
--   phone not linked to a player: watch only
--   undo: host, or the player whose action is the last event
--   edit/delete history (replace_log): host only
-- Turn order and amounts are checked by the engine on the phone.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  host_uid uuid not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  uid uuid not null,
  is_host boolean not null default false,
  player_id text,
  joined_at timestamptz not null default now(),
  primary key (room_id, uid)
);

-- One phone per player.
create unique index room_members_one_phone_per_player
  on public.room_members (room_id, player_id) where player_id is not null;

create table public.events (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq integer not null,
  body jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (room_id, seq)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.events enable row level security;

-- Is the signed-in user in this room? (security definer so policies can use it
-- without recursing into room_members' own policy)
create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_members where room_id = p_room and uid = auth.uid());
$$;

-- Members can read their rooms. Nobody writes directly.
create policy "members read rooms" on public.rooms for select to authenticated
  using (public.is_room_member(id));
create policy "members read members" on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
create policy "members read events" on public.events for select to authenticated
  using (public.is_room_member(room_id));

grant select on public.rooms, public.room_members, public.events to authenticated;

-- ── Helpers ──

create function public._require_uid() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Not signed in'; end if;
  return v;
end $$;

-- Locks the room row (serialising writers), checks membership and version,
-- and returns the caller's membership.
create function public._lock_room(p_room uuid, p_expected_version bigint)
returns public.room_members
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_version bigint;
  v_member room_members;
begin
  select version into v_version from rooms where id = p_room for update;
  select * into v_member from room_members where room_id = p_room and uid = v_uid;
  if v_version is null or v_member.uid is null then
    raise exception 'forbidden: You''re not in this game';
  end if;
  if p_expected_version is not null and v_version <> p_expected_version then
    raise exception 'conflict';
  end if;
  return v_member;
end $$;

create function public._bump(p_room uuid) returns bigint
language sql security definer set search_path = public as $$
  update rooms set version = version + 1, updated_at = now() where id = p_room returning version;
$$;

create function public._insert_log(p_room uuid, p_events jsonb, p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_events) <> 'array' or p_events -> 0 ->> 'type' is distinct from 'game_created' then
    raise exception 'A game''s log must start with game_created';
  end if;
  insert into events (room_id, seq, body, created_by)
  select p_room, (ord - 1)::int, e, p_uid
  from jsonb_array_elements(p_events) with ordinality as t (e, ord);
end $$;

-- ── Functions the app calls ──

create function public.create_room(p_name text, p_events jsonb)
returns table (room_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_code text;
  v_id uuid;
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms r where r.code = v_code);
  end loop;

  insert into rooms (code, name, host_uid)
  values (v_code, coalesce(nullif(trim(p_name), ''), 'Game'), v_uid)
  returning id into v_id;
  insert into room_members (room_id, uid, is_host) values (v_id, v_uid, true);
  perform _insert_log(v_id, p_events, v_uid);
  return query select v_id, v_code;
end $$;

create function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_id uuid;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'No game with that code'; end if;
  insert into room_members (room_id, uid) values (v_id, v_uid) on conflict do nothing;
  return v_id;
end $$;

-- Everything a phone needs, read in one consistent snapshot.
create function public.room_snapshot(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v jsonb;
begin
  if not exists (select 1 from room_members where room_id = p_room and uid = v_uid) then
    raise exception 'forbidden: You''re not in this game';
  end if;
  select jsonb_build_object(
    'roomId', r.id,
    'code', r.code,
    'name', r.name,
    'version', r.version,
    'me', v_uid,
    'events', coalesce((select jsonb_agg(e.body order by e.seq) from events e where e.room_id = r.id), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('uid', m.uid, 'isHost', m.is_host, 'playerId', m.player_id) order by m.joined_at)
      from room_members m where m.room_id = r.id), '[]'::jsonb)
  ) into v
  from rooms r where r.id = p_room;
  return v;
end $$;

create function public.append_event(p_room uuid, p_expected_version bigint, p_event jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m room_members := _lock_room(p_room, p_expected_version);
begin
  if not m.is_host then
    if m.player_id is null then
      raise exception 'forbidden: Pick which player you are to take part';
    elsif p_event ->> 'type' is distinct from 'action' then
      raise exception 'forbidden: Only the host can do that';
    elsif p_event ->> 'playerId' is distinct from m.player_id then
      raise exception 'forbidden: You can only act for your own seat';
    end if;
  end if;
  insert into events (room_id, seq, body, created_by)
  values (p_room, (select coalesce(max(seq) + 1, 0) from events where room_id = p_room), p_event, m.uid);
  return _bump(p_room);
end $$;

create function public.undo_last(p_room uuid, p_expected_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m room_members := _lock_room(p_room, p_expected_version);
  v_seq int;
  v_last jsonb;
begin
  select seq, body into v_seq, v_last from events where room_id = p_room order by seq desc limit 1;
  if v_last is null or v_last ->> 'type' = 'game_created' then
    raise exception 'forbidden: Nothing to undo';
  end if;
  if not m.is_host and not (v_last ->> 'type' = 'action' and m.player_id is not null
                            and v_last ->> 'playerId' = m.player_id) then
    raise exception 'forbidden: Only the host can undo that';
  end if;
  delete from events where room_id = p_room and seq = v_seq;
  return _bump(p_room);
end $$;

create function public.replace_log(p_room uuid, p_expected_version bigint, p_events jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m room_members := _lock_room(p_room, p_expected_version);
begin
  if not m.is_host then raise exception 'forbidden: Only the host can do that'; end if;
  delete from events where room_id = p_room;
  perform _insert_log(p_room, p_events, m.uid);
  return _bump(p_room);
end $$;

create function public.claim_player(p_room uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m room_members := _lock_room(p_room, null);
begin
  if p_player is not null then
    if not exists (select 1 from events
                   where room_id = p_room and body ->> 'type' = 'player_joined' and body ->> 'playerId' = p_player) then
      raise exception 'No such player in this game';
    end if;
    if exists (select 1 from room_members
               where room_id = p_room and player_id = p_player and uid <> m.uid) then
      raise exception 'forbidden: Another phone already plays as them. The host can free that seat.';
    end if;
  end if;
  update room_members set player_id = p_player where room_id = p_room and uid = m.uid;
  update rooms set updated_at = now() where id = p_room; -- tells other phones
end $$;

create function public.release_player(p_room uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m room_members := _lock_room(p_room, null);
begin
  if not m.is_host then raise exception 'forbidden: Only the host can do that'; end if;
  update room_members set player_id = null where room_id = p_room and player_id = p_player;
  update rooms set updated_at = now() where id = p_room;
end $$;

-- Only signed-in users (anonymous sign-ins count) may call the app functions;
-- the helpers aren't callable at all.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_room(text, jsonb),
  public.join_room(text),
  public.room_snapshot(uuid),
  public.append_event(uuid, bigint, jsonb),
  public.undo_last(uuid, bigint),
  public.replace_log(uuid, bigint, jsonb),
  public.claim_player(uuid, text),
  public.release_player(uuid, text),
  public.is_room_member(uuid)
to authenticated;

-- Live updates: phones subscribe to their room's row and reload on change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;
