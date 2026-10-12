-- Poker Tracker: keep-alive. Run after 0002_hardening.sql.
--
-- Supabase pauses free projects after about a week of low database activity.
-- A scheduled GitHub Action (.github/workflows/keep-alive.yml) calls ping()
-- once a day so the project stays awake between games. ping() reads one row
-- so it's a real database query, and returns only 'ok'.

create function public.ping() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform 1 from rooms limit 1;
  return 'ok';
end $$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
