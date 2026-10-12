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
with `supabase/migrations/0002_hardening.sql` (always in number order; if
more files appear later, run each new one once).

This creates the `rooms`, `room_members` and `events` tables, the functions
the app calls, and the read rules (only people in a room can see it). It
also turns on live updates for `rooms`.

To check that live updates are on: Database → Publications →
`supabase_realtime` should list `rooms`.

## 4. Point the app at it

1. Project Settings → API (or Data API): copy the **Project URL** and the
   **anon public** key. The anon key is meant to be public; the database
   rules decide what it can do.
2. In the project folder, copy `.env.example` to `.env.local` and paste them in:

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

3. Restart `npm run dev`. The "Share with other phones" note should no longer
   say "this browser only".

## 5. Try it with a phone

`npm run dev -- --host` and open the Network address on a phone on the same
Wi-Fi. Start a shared game on your computer, then on the phone tap
**Join a game** and type the room code (or open the shared link).

To use it away from your Wi-Fi, deploy the app (for example to Vercel,
Netlify or GitHub Pages) with the same two environment variables set.

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
