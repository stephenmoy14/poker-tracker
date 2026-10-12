\set ON_ERROR_STOP 1
\set QUIET 1
-- Tests for 0002_hardening.sql. Run after rooms.test.sql (reuses its t.* helpers).

\set host  'aaaaaaaa-1111-1111-1111-111111111111'
\set annp  'aaaaaaaa-2222-2222-2222-222222222222'
\set guesser 'aaaaaaaa-3333-3333-3333-333333333333'
\set spammer 'aaaaaaaa-4444-4444-4444-444444444444'

set role authenticated;
select set_config('request.jwt.claim.sub', :'host', false) \gset x_

-- The phone claims to be someone else ("by":"ann") and sends a fake time; the server overrides both.
select room_id, code from create_room(repeat('x', 100), '[
  {"id":"h1","at":0,"by":"ann","type":"game_created","config":{"smallBlind":10,"bigBlind":25,"unit":5,"currency":"USD","maxSeats":10}},
  {"id":"h2","at":0,"type":"player_joined","playerId":"ann","name":"Ann","seat":1,"buyIn":1000},
  {"id":"h3","at":0,"type":"player_joined","playerId":"ben","name":"Ben","seat":2,"buyIn":1000}
]'::jsonb) \gset
select set_config('t.code', :'code', false) \gset x_
select t.check((select length(name) from rooms where id = :'room_id') = 60, 'room names are capped at 60 characters');
select t.check((select bool_and(body ->> 'by' = 'host') from events where room_id = :'room_id'), 'starting events are recorded as entered by the host');
select t.check((select bool_and((body ->> 'at')::bigint > 1700000000000) from events where room_id = :'room_id'), 'starting events get the server''s time');

-- Event checks
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '"just a string"'), 'must be an object');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '{"id":"x","type":"drop_table"}'), 'Unknown event type');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '{"type":"rebuy","playerId":"ann","amount":100}'), 'needs an id');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', jsonb_build_object('id', repeat('i', 65), 'type', 'rebuy')), 'needs an id');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', jsonb_build_object('id', 'big', 'type', 'rebuy', 'pad', repeat('x', 9000))), 'too large');
select t.expect_error(format('select append_event(%L, 1, %L)', :'room_id', '{"id":"h2","type":"rebuy","playerId":"ann","amount":100}'), 'already added');
select t.expect_error(format('select replace_log(%L, 1, %L)', :'room_id', '[{"id":"a","type":"game_created"},{"id":"a","type":"rebuy"}]'), 'same id');
select t.expect_error(format('select create_room(%L, %L)', 'x', '[{"id":"z","type":"game_created"}, 5]'), 'must be an object');

-- Server-recorded authorship
select t.check(append_event(:'room_id', 1, '{"id":"h4","at":0,"by":"ann","type":"hand_started","buttonSeat":2}') = 2, 'host deals');
select t.check((select body ->> 'by' from events where room_id = :'room_id' and body ->> 'id' = 'h4') = 'host', 'host''s event recorded as host even though the phone said "ann"');
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
select join_room(:'code') \gset x_
select claim_player(:'room_id', 'ann');
select t.check(append_event(:'room_id', 2, '{"id":"h5","at":0,"by":"host","type":"action","playerId":"ann","action":{"kind":"call"}}') = 3, 'Ann acts');
select t.check((select body ->> 'by' from events where room_id = :'room_id' and body ->> 'id' = 'h5') = 'ann', 'Ann''s phone can''t pretend to be the host');
select t.check((select (body ->> 'at')::bigint from events where room_id = :'room_id' and body ->> 'id' = 'h5') > 1700000000000, 'server time, not the phone''s "at": 0');

-- Editing history keeps original authorship; new events are the host's.
select set_config('request.jwt.claim.sub', :'host', false) \gset x_
select replace_log(:'room_id', 3, (
  select jsonb_agg(case when body ->> 'id' = 'h5' then body || '{"by":"host","at":1}' else body end order by seq)
  from events where room_id = :'room_id'
) || '[{"id":"h6","type":"rebuy","playerId":"ben","amount":100,"by":"ann"}]'::jsonb) \gset x_
select t.check((select body ->> 'by' from events where room_id = :'room_id' and body ->> 'id' = 'h5') = 'ann', 'an edit keeps who originally entered the event');
select t.check((select (body ->> 'at')::bigint from events where room_id = :'room_id' and body ->> 'id' = 'h5') > 1, 'an edit keeps the original time');
select t.check((select body ->> 'by' from events where room_id = :'room_id' and body ->> 'id' = 'h6') = 'host', 'a new event added in an edit is the host''s');

-- Guessing room codes is slow: 10 tries a minute.
select set_config('request.jwt.claim.sub', :'guesser', false) \gset x_
do $$
declare ok int := 0; refused text;
begin
  for i in 1..12 loop
    begin
      if join_room('ZZZZZ' || i) is not null then raise exception 'guessed a room?'; end if;
      ok := ok + 1; -- unknown code: null, no error
    exception when others then
      if sqlerrm like 'Too many attempts%' then refused := sqlerrm; exit; end if;
      raise;
    end;
  end loop;
  perform t.check(ok = 10 and refused is not null, format('room-code guessing stops after 10 tries a minute (%s tries, then "%s")', ok, refused));
end $$;
-- ...but reopening a game you're already in isn't counted.
select set_config('request.jwt.claim.sub', :'annp', false) \gset x_
do $$
begin
  for i in 1..15 loop perform join_room(current_setting('t.code')); end loop;
  perform t.check(true, 'reopening your own game 15 times isn''t limited');
end $$;

-- Writes: 40 per 10 seconds per phone.
select set_config('request.jwt.claim.sub', :'spammer', false) \gset x_
select set_config('t.room', :'room_id', false) \gset x_
do $$
declare ok int := 0; refused text;
begin
  perform join_room(current_setting('t.code'));
  for i in 1..45 loop
    begin
      perform claim_player(current_setting('t.room')::uuid, null);
      ok := ok + 1;
    exception when others then refused := sqlerrm; exit;
    end;
  end loop;
  perform t.check(ok = 40 and refused like 'Too many changes%', format('a phone gets 40 changes per 10 seconds (%s, then "%s")', ok, refused));
end $$;

-- New rooms: 10 an hour per phone.
do $$
declare ok int := 0; refused text;
begin
  for i in 1..12 loop
    begin
      perform create_room('spam', jsonb_build_array(jsonb_build_object('id', 'g' || i, 'type', 'game_created')));
      ok := ok + 1;
    exception when others then refused := sqlerrm; exit;
    end;
  end loop;
  perform t.check(ok = 10 and refused like 'Too many new games%', format('a phone can create 10 rooms an hour (%s, then "%s")', ok, refused));
end $$;

-- Phones can't read or reset their own limits.
select t.expect_error('delete from rate_limit_hits', 'permission denied');
select t.expect_error('select _rate_limit(''write'', 1000, ''1 second'', ''x'')', 'permission denied');
reset role;
\echo ALL HARDENING TESTS PASSED
