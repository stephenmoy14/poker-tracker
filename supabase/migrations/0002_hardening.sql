-- Poker Tracker: hardening for shared games. Run after 0001_rooms.sql.
--
--  1. Every event is checked before it's stored: a JSON object, a known
--     type, an id (unique within the room), and at most 8 KB. A room holds
--     at most 20,000 events and 50 phones. Room names are capped at 60
--     characters.
--  2. Rate limits per phone: 40 changes per 10 seconds, 10 join attempts
--     per minute (so room codes can't be guessed quickly), 10 new rooms
--     per hour. Only calls that succeed are counted (a refused call stores
--     nothing), except join attempts: join_room returns null for an unknown
--     code instead of raising, so wrong guesses count too.
--  3. The server records who entered each event and when: the stored
--     event's "by" is "host" or the player the phone plays as, and "at" is
--     the server's clock, whatever the phone sent. Editing history keeps the
--     original "by"/"at" of events that were already there.

-- ── Rate limits ──

create table public.rate_limit_hits (
  uid uuid not null,
  bucket text not null,
  at timestamptz not null default clock_timestamp()
);
create index rate_limit_hits_lookup on public.rate_limit_hits (uid, bucket, at);
alter table public.rate_limit_hits enable row level security; -- no policies: functions only

create function public._rate_limit(p_bucket text, p_max int, p_window interval, p_message text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_count int;
begin
  delete from rate_limit_hits where uid = v_uid and at < clock_timestamp() - interval '1 hour';
  select count(*) into v_count from rate_limit_hits
  where uid = v_uid and bucket = p_bucket and at > clock_timestamp() - p_window;
  if v_count >= p_max then
    raise exception '%', p_message;
  end if;
  insert into rate_limit_hits (uid, bucket) values (v_uid, p_bucket);
end $$;

-- Returns true so it can run first, as a declaration, in the write functions.
create function public._limit_writes() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform _rate_limit('write', 40, interval '10 seconds',
    'Too many changes in a short time. Wait a few seconds and try again.');
  return true;
end $$;

-- ── Event checks ──

create function public._check_event(p_event jsonb) returns void
language plpgsql immutable as $$
begin
  if jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'Each event must be an object';
  end if;
  if (p_event ->> 'type') is null or (p_event ->> 'type') not in (
    'game_created', 'player_joined', 'rebuy', 'player_left', 'player_sat_out', 'player_returned',
    'hand_started', 'action', 'hand_fast_entry', 'pot_awarded', 'game_ended'
  ) then
    raise exception 'Unknown event type';
  end if;
  if jsonb_typeof(p_event -> 'id') is distinct from 'string'
     or length(p_event ->> 'id') not between 1 and 64 then
    raise exception 'Each event needs an id of 1 to 64 characters';
  end if;
  if octet_length(p_event::text) > 8192 then
    raise exception 'That event is too large';
  end if;
end $$;

create function public._now_ms() returns bigint
language sql stable as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- Replaces 0001's version: checks every event, unique ids, the size cap.
create or replace function public._insert_log(p_room uuid, p_events jsonb, p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
begin
  if jsonb_typeof(p_events) <> 'array' or p_events -> 0 ->> 'type' is distinct from 'game_created' then
    raise exception 'A game''s log must start with game_created';
  end if;
  if jsonb_array_length(p_events) > 20000 then
    raise exception 'This game''s log is full (20,000 events)';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    perform _check_event(e);
  end loop;
  if (select count(distinct x ->> 'id') from jsonb_array_elements(p_events) x) <> jsonb_array_length(p_events) then
    raise exception 'Two events have the same id';
  end if;
  insert into events (room_id, seq, body, created_by)
  select p_room, (ord - 1)::int, e2, p_uid
  from jsonb_array_elements(p_events) with ordinality as t (e2, ord);
end $$;

-- ── Functions the app calls (same signatures as 0001) ──

create or replace function public.create_room(p_name text, p_events jsonb)
returns table (room_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_code text;
  v_id uuid;
  v_events jsonb;
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform _rate_limit('create', 10, interval '1 hour', 'Too many new games from this phone. Try again later.');
  if jsonb_typeof(p_events) <> 'array' then raise exception 'A game''s log must be a list'; end if;
  -- The creator is the host, so every starting event was entered by the host, now.
  select coalesce(jsonb_agg((e - 'by') || jsonb_build_object('by', 'host', 'at', _now_ms()) order by ord), '[]')
  into v_events
  from jsonb_array_elements(p_events) with ordinality as t (e, ord)
  where jsonb_typeof(e) = 'object';
  if jsonb_array_length(v_events) <> jsonb_array_length(p_events) then
    raise exception 'Each event must be an object';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms r where r.code = v_code);
  end loop;

  insert into rooms (code, name, host_uid)
  values (v_code, left(coalesce(nullif(trim(p_name), ''), 'Game'), 60), v_uid)
  returning id into v_id;
  insert into room_members (room_id, uid, is_host) values (v_id, v_uid, true);
  perform _insert_log(v_id, v_events, v_uid);
  return query select v_id, v_code;
end $$;

create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := _require_uid();
  v_id uuid;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  -- Already a member: no limit (reopening a game you're in is free).
  if v_id is not null and exists (select 1 from room_members where room_id = v_id and uid = v_uid) then
    return v_id;
  end if;
  perform _rate_limit('join', 10, interval '1 minute', 'Too many attempts to join a game. Wait a minute and try again.');
  -- Unknown code: return null rather than raising, so this attempt still
  -- counts towards the limit (an error would roll back the record of it).
  if v_id is null then return null; end if;
  if (select count(*) from room_members where room_id = v_id) >= 50 then
    raise exception 'This game is full';
  end if;
  insert into room_members (room_id, uid) values (v_id, v_uid) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.append_event(p_room uuid, p_expected_version bigint, p_event jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_limited boolean := _limit_writes();
  m room_members := _lock_room(p_room, p_expected_version);
  v_event jsonb;
begin
  perform _check_event(p_event);
  if not m.is_host then
    if m.player_id is null then
      raise exception 'forbidden: Pick which player you are to take part';
    elsif p_event ->> 'type' is distinct from 'action' then
      raise exception 'forbidden: Only the host can do that';
    elsif p_event ->> 'playerId' is distinct from m.player_id then
      raise exception 'forbidden: You can only act for your own seat';
    end if;
  end if;
  if exists (select 1 from events where room_id = p_room and body ->> 'id' = p_event ->> 'id') then
    raise exception 'That event was already added';
  end if;
  if (select count(*) from events where room_id = p_room) >= 20000 then
    raise exception 'This game''s log is full (20,000 events)';
  end if;
  -- Who entered it and when, from the server's point of view.
  v_event := (p_event - 'by' - 'at')
    || jsonb_build_object('by', case when m.is_host then 'host' else m.player_id end, 'at', _now_ms());
  insert into events (room_id, seq, body, created_by)
  values (p_room, (select coalesce(max(seq) + 1, 0) from events where room_id = p_room), v_event, m.uid);
  return _bump(p_room);
end $$;

create or replace function public.undo_last(p_room uuid, p_expected_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_limited boolean := _limit_writes();
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

create or replace function public.replace_log(p_room uuid, p_expected_version bigint, p_events jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_limited boolean := _limit_writes();
  m room_members := _lock_room(p_room, p_expected_version);
  v_events jsonb;
begin
  if not m.is_host then raise exception 'forbidden: Only the host can do that'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'A game''s log must be a list'; end if;
  -- Events that were already in the log keep who entered them and when;
  -- anything new was entered by the host, now.
  select coalesce(jsonb_agg(
           case when o.body is not null
             then (e - 'by' - 'at') || jsonb_strip_nulls(jsonb_build_object('by', o.body -> 'by', 'at', o.body -> 'at'))
             else (e - 'by' - 'at') || jsonb_build_object('by', 'host', 'at', _now_ms())
           end order by ord), '[]')
  into v_events
  from jsonb_array_elements(p_events) with ordinality as t (e, ord)
  left join events o on o.room_id = p_room and o.body ->> 'id' = e ->> 'id'
  where jsonb_typeof(e) = 'object';
  if jsonb_array_length(v_events) <> jsonb_array_length(p_events) then
    raise exception 'Each event must be an object';
  end if;
  delete from events where room_id = p_room;
  perform _insert_log(p_room, v_events, m.uid);
  return _bump(p_room);
end $$;

create or replace function public.claim_player(p_room uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_limited boolean := _limit_writes();
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
  update rooms set updated_at = now() where id = p_room;
end $$;

create or replace function public.release_player(p_room uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_limited boolean := _limit_writes();
  m room_members := _lock_room(p_room, null);
begin
  if not m.is_host then raise exception 'forbidden: Only the host can do that'; end if;
  update room_members set player_id = null where room_id = p_room and player_id = p_player;
  update rooms set updated_at = now() where id = p_room;
end $$;

-- Helpers stay private; the app functions keep their grants from 0001.
revoke execute on function
  public._rate_limit(text, int, interval, text),
  public._limit_writes(),
  public._check_event(jsonb),
  public._now_ms()
from public, anon, authenticated;
