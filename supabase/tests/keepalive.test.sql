\set ON_ERROR_STOP 1
\set QUIET 1
-- Tests for 0003_keepalive.sql. Run after rooms.test.sql (reuses its t.* helpers).
set role anon;
select t.check(ping() = 'ok', 'anyone with the public key can ping (no sign-in needed)');
reset role;
set role authenticated;
select t.check(ping() = 'ok', 'signed-in phones can ping too');
reset role;
\echo ALL KEEP-ALIVE TESTS PASSED
