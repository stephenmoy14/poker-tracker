\set ON_ERROR_STOP 1
\set QUIET 1
-- Test helpers (owned by the superuser, callable by the app role).
create schema t;
grant usage on schema t to authenticated, anon;
create function t.expect_error(q text, frag text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if position(frag in sqlerrm) = 0 then
      raise exception 'FAIL: % → expected error containing "%", got "%"', q, frag, sqlerrm;
    end if;
    raise notice 'ok   refused: % (%)', left(q, 60), sqlerrm;
    return;
  end;
  raise exception 'FAIL: % → expected error containing "%", but it succeeded', q, frag;
end $$;
create function t.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   %', label;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- Phones
\set host  '11111111-1111-1111-1111-111111111111'
\set annp  '22222222-2222-2222-2222-222222222222'
\set watch '33333333-3333-3333-3333-333333333333'
\set other '44444444-4444-4444-4444-444444444444'
\set outsider '55555555-5555-5555-5555-555555555555'

set role authenticated;
select set_config('request.jwt.claim.sub', :'host', false) \gset x_

select room_id, code from create_room('Friday', '[
  {"id":"e1","at":0,"type":"game_created","config":{"smallBlind":10,"bigBlind":25,"unit":5,"currency":"USD","maxSeats":10}},
  {"id":"e2","at":0,"type":"player_joined","playerId":"ann","name":"Ann","seat":1,"buyIn":1000},
  {"id":"e3","at":0,"type":"player_joined","playerId":"ben","name":"Ben","seat":2,"buyIn":1000},
  {"id":"e4","at":0,"type":"player_joined","playerId":"cam","name":"Cam","seat":3,"buyIn":1000}
]'::jsonb) \gset
select t.check(:'code' ~ '^[A-Z2-9]{6}$', 'room code looks like ' || :'code');
select t.check((room_snapshot(:'room_id')->>'version')::int = 1, 'new room starts at version 1');
select t.check(jsonb_array_length(room_snapshot(:'room_id')->'events') = 4, 'snapshot has the 4 starting events in order');
select t.check(room_snapshot(:'room_id')->'events'->3->>'playerId' = 'cam', 'events come back in log order');
select t.check((room_snapshot(:'room_id')->'members'->0->>'isHost')::boolean, 'creator is the host');

-- Outsiders see nothing and can't write directly.
select set_config('request.jwt.claim.sub', :'outsider', false) \gset x_
select t.expect_error(format('select room_snapshot(%L)', :'room_id'), 'not in this game');
select t.check((select count(*) from events where room_id = :'room_id') = 0, 'row-level security hides events from outsiders');
select t.check((select count(*) from rooms where id = :'room_id') = 0, 'row-level security hides the room from outsiders');
select t.expect_error(format('insert into events (room_id, seq, body) values (%L, 99, %L)', :'room_id', '{}'), 'permission denied');
select t.expect_error(format('update rooms set version = 99 where id = %L', :'room_id'), 'permission denied');
select t.check(join_room('ZZZZZZ') is null, 'unknown room code: nothing joined');

-- Ann's phone joins (lower-case code works) and claims Ann.
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
select t.check(join_room(lower(:'code')) = :'room_id'::uuid, 'join by code (case-insensitive)');
select t.check(join_room(:'code') = :'room_id'::uuid, 'joining twice is harmless');
select t.check((select count(*) from events where room_id = :'room_id') = 4, 'members can read the events');
select t.expect_error(format('select claim_player(%L, %L)', :'room_id', 'zed'), 'No such player');
select claim_player(:'room_id', 'ann');
select t.check((select player_id from room_members where room_id = :'room_id' and uid = :'annp') = 'ann', 'Ann''s phone plays as Ann');

-- Players can't deal; the host can.
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '{"id":"e5","at":0,"type":"hand_started","buttonSeat":3}'), 'Only the host can do that');
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select t.check(append_event(:'room_id', 1, '{"id":"e5","at":0,"type":"hand_started","buttonSeat":3}') = 2, 'host deals: version 2');

-- Ann can only act for Ann, and only with the current version.
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
select t.expect_error(format('select append_event(%L, 2, %L)', :'room_id', '{"id":"e6","at":0,"type":"action","playerId":"cam","action":{"kind":"fold"}}'), 'only act for your own seat');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '{"id":"e6","at":0,"type":"action","playerId":"ann","action":{"kind":"call"}}'), 'conflict');
select t.check(append_event(:'room_id', 2, '{"id":"e6","at":0,"type":"action","playerId":"ann","action":{"kind":"call"}}') = 3, 'Ann acts for herself: version 3');
select t.check((select max(seq) from events where room_id = :'room_id') = 5, 'appended at the end of the log');

-- Watchers watch.
select set_config('request.jwt.claim.sub', :'watch', false) \gset x_
select join_room(:'code') \gset x_
select t.expect_error(format('select append_event(%L, 3, %L)', :'room_id', '{"id":"e7","at":0,"type":"action","playerId":"ben","action":{"kind":"call"}}'), 'Pick which player');
select t.expect_error(format('select undo_last(%L, 3)', :'room_id'), 'Only the host can undo that');

-- Undo: Ann can take back her own last action, not the deal.
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
select t.check(undo_last(:'room_id', 3) = 4, 'Ann undoes her own action: version 4');
select t.expect_error(format('select undo_last(%L, 4)', :'room_id'), 'Only the host can undo that');
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select t.check(undo_last(:'room_id', 4) = 5, 'host undoes the deal: version 5');
select t.check((select count(*) from events where room_id = :'room_id') = 4, 'back to the 4 starting events');

-- Editing history: host only, current version only, must start with game_created.
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
select t.expect_error(format('select replace_log(%L, 5, %L)', :'room_id', '[{"type":"game_created"}]'), 'Only the host can do that');
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select t.expect_error(format('select replace_log(%L, 4, %L)', :'room_id', '[{"type":"game_created"}]'), 'conflict');
select t.expect_error(format('select replace_log(%L, 5, %L)', :'room_id', '[{"type":"rebuy"}]'), 'must start with game_created');
select t.check(replace_log(:'room_id', 5, (select jsonb_agg(body order by seq) from events where room_id = :'room_id' and seq < 3)) = 6, 'host rewrites the log: version 6');
select t.check((select count(*) from events where room_id = :'room_id') = 3, 'rewritten log has 3 events');
select t.check((select array_agg(seq order by seq) from events where room_id = :'room_id') = array[0,1,2], 'seq renumbered from 0');

-- One phone per player; the host can free a seat.
select set_config('request.jwt.claim.sub', :'other', false) \gset x_
select join_room(:'code') \gset x_
select t.expect_error(format('select claim_player(%L, %L)', :'room_id', 'ann'), 'Another phone already plays as them');
select t.expect_error(format('select release_player(%L, %L)', :'room_id', 'ann'), 'Only the host can do that');
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select release_player(:'room_id', 'ann');
select set_config('request.jwt.claim.sub', :'other', false) \gset x_
select claim_player(:'room_id', 'ann');
select t.check((select player_id from room_members where room_id = :'room_id' and uid = :'other') = 'ann', 'new phone took over Ann after the host freed her');
select claim_player(:'room_id', null);
select t.check((select player_id from room_members where room_id = :'room_id' and uid = :'other') is null, 'a phone can go back to just watching');

-- Not signed in / internal helpers.
select set_config('request.jwt.claim.sub', '', false) \gset x_
select t.expect_error('select create_room(''x'', ''[{"type":"game_created"}]'')', 'Not signed in');
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select t.expect_error(format('select _bump(%L)', :'room_id'), 'permission denied');
reset role;
set role anon;
select t.expect_error('select create_room(''x'', ''[{"type":"game_created"}]'')', 'permission denied');
reset role;
\echo ALL DATABASE TESTS PASSED
