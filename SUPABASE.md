# Setting up shared games (Supabase)

Shared games let several phones follow one game live: the host deals and
fixes mistakes, and each player can enter their own actions on their turn.
Until this is set up, "Share with other phones" works between tabs of one
browser only, which is handy for trying it out.

It takes about ten minutes on Supabase's free plan.

## 1. Create a project

1. Sign in at supabase.com and create a new project (any name and region; save
   the database password somewhere, though the app doesn't need it).
2. Wait for it to finish setting up.

## 2. Turn on anonymous sign-ins

Players don't make accounts. Each phone gets an anonymous login that's
remembered in that browser.

Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**.

## 3. Create the tables and functions

SQL Editor → New query → paste all of `supabase/migrations/0001_rooms.sql`
→ Run. It should finish with "Success. No rows returned". Then do the same
with `supabase/migrations/0002_hardening.sql`, then
`supabase/migrations/0003_keepalive.sql` (always in number order; when a new
file appears later, run just that one, once).

This creates the `rooms`, `room_members` and `events` tables, the functions
the app calls, and the read rules (only people in a room can see it). It
also turns on live updates for `rooms`.

To check everything is in place, run this in a new query:

```sql
select
  (select count(*) from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('create_room','join_room','room_snapshot','append_event',
                       'undo_last','replace_log','claim_player','release_player')) as app_functions,
  exists (select 1 from pg_tables where tablename = 'rate_limit_hits') as hardening,
  exists (select 1 from pg_proc where proname = 'ping') as keepalive,
  exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and tablename = 'rooms') as live_updates;
```

You want **8 · true · true · true**.

## 4. Point the app at it

1. Use the **Connect** button at the top of the project (or Settings → API
   Keys) and copy the **Project URL** and the **publishable** key
   (`sb_publishable_…`). Older projects show an **anon** key instead; either
   works. These keys are meant to be public: the database rules decide what
   they can do. Never use the **secret** / **service_role** key in the app.
2. In the project folder, copy `.env.example` to `.env.local` and paste them in:

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```

3. Restart `npm run dev`. The "Share with other phones" note should no longer
   say "this browser only".

## 5. Try it with a phone

`npm run dev -- --host` and open the Network address on a phone on the same
Wi-Fi. Start a shared game on your computer, then on the phone tap
**Join a game** and type the room code (or open the shared link).

To use it away from your Wi-Fi, deploy the app (for example to Vercel,
Netlify or GitHub Pages) with the same two environment variables set.
On Vercel: Project → Settings → Environment Variables, then redeploy (the
values are built into the app, so changes need a new deploy). Don't use
Supabase's Vercel integration: it names the variables for Next.js
(`NEXT_PUBLIC_…`), which this app doesn't read.

## 6. Keep it awake (free plan)

Supabase pauses free projects after about a week of low activity (it emails
a warning first). `.github/workflows/keep-alive.yml` calls the database's
`ping()` once a day so that doesn't happen between games:

1. GitHub repo → Settings → Secrets and variables → Actions → **New
   repository secret**. Add `SUPABASE_URL` (Project URL) and
   `SUPABASE_ANON_KEY` (the same publishable/anon key).
2. Actions → **Keep Supabase awake** → **Run workflow**. It should finish
   green and print `Supabase answered: "ok"`.

GitHub turns off scheduled workflows in repos with no commits for 60 days
(it emails you first); re-enable it from the Actions tab.

**If it pauses anyway:** players see "The game server is asleep" with a
Try again button. You (the project owner) resume it from the Supabase
dashboard: open the project → **Resume project**. It takes a minute or
two and everything comes back as it was. Games kept on a single phone work
the whole time.

## How it works

- Every room's game is stored as its event log, the same one the app already
  uses. Every phone replays it with the same engine.
- Phones never write to the tables directly; they call functions
  (`append_event`, `undo_last`, `replace_log`, `claim_player`, …). Each write
  says which version of the log the phone last saw. If someone else changed
  it first, the write is refused with `conflict`, and the phone reloads,
  re-checks the entry and tries again.
- The database checks who may do what: the host can do anything; a phone
  linked to a player can only add actions for that player (and undo its own
  last action); other phones can only watch. Turn order and amounts are
  checked by the app on each phone before anything is sent.
- Phones listen for changes to their room's row and reload the log when it
  changes.
- Hardening (0002): every event is checked (known type, an id unique in the
  room, at most 8 KB; at most 20,000 events and 50 phones per room). Each
  phone is limited to 40 changes per 10 seconds, 10 join attempts a minute
  (so room codes can't be guessed quickly) and 10 new games an hour. The
  server records who entered each event and when, whatever the phone says;
  the log shows "entered by the host" when the host acts for a player.

## Limits worth knowing

- The host is whoever created the room, on that browser. If the host clears
  their browser data, nobody can do host-only things in that room any more.
- Supabase limits anonymous sign-ins per IP address per hour (30 by default).
  A table of phones on one Wi-Fi is well under that.
- The rate limits are per phone (per anonymous sign-in). Someone determined
  could make many sign-ins to get around them; Supabase's per-IP sign-in
  limit slows that down, and turning on CAPTCHA for sign-ins
  (Authentication → Attack Protection) stops it. Worth doing before any
  public games, not needed for friends.
- Shared games assume everyone's online: if the connection drops, entry is
  paused and a "Reconnecting…" badge shows until it's back.

## Testing the database rules locally (optional)

`scripts/test-db.sh` runs the migration and a set of permission and conflict
tests against any local Postgres (not your Supabase project):

```
PGHOST=localhost PGUSER=postgres ./scripts/test-db.sh
```
