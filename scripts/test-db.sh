#!/usr/bin/env bash
# Runs the database tests against a local Postgres (not Supabase).
# Needs psql and a Postgres you can create databases on, e.g.:
#   PGHOST=localhost PGUSER=postgres ./scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-poker_tracker_test}
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/rooms.test.sql 2>&1 | grep -E "ok |FAIL|PASSED|ERROR"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/hardening.test.sql 2>&1 | grep -E "ok |FAIL|PASSED|ERROR"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/keepalive.test.sql 2>&1 | grep -E "ok |FAIL|PASSED|ERROR"
psql -q -c "drop database $DB"
