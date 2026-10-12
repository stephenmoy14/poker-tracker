# Poker Tracker: Design Decisions

This file records decisions made while building, on top of the original spec.
Read it before changing the engine. If a decision here conflicts with the spec,
this file wins (it's newer).

## Stack

- React + TypeScript + Vite, Vitest for tests.
- Phase 2: Supabase (an `events` table keyed by room, realtime subscriptions).
- The engine (`src/engine/`) is pure TypeScript: no React, browser APIs, or
  database code. **Enforced by ESLint** (`eslint.engine-rules.js`, applied to
  `src/engine/**` in `eslint.config.js`): no React/Supabase/pg imports, no
  imports from `app/` or `sync/`, no browser globals (window, document,
  localStorage, fetch, crypto, timers…), no `import.meta`, no `globalThis`.
  `npm run lint`; `npm run check` runs typecheck + lint + tests.

## Money

- All amounts are **integer cents**. Never floats.
- The smallest unit is **$0.05** (`config.unit = 5`). Every amount must be a
  multiple of the unit; the engine rejects anything else.
- **Chip games:** `config.format = "chips"` (missing = money, so older saved
  games still work). Amounts are plain chip counts, `unit = 1`, shown as "250"
  instead of "$2.50" (`formatAmount` in `money.ts`). Engine messages and log
  lines use the same formatting. Results show who's up/down in chips, ranked;
  no payments.
- Blinds must also be multiples of the unit (e.g. $0.10 / $0.25).

## Events (event sourcing)

The event log is the only thing persisted. State is always `replay(events)`.

Event types: `game_created`, `player_joined`, `rebuy`, `player_left`,
`player_sat_out`, `player_returned`, `hand_started`, `action`,
`hand_fast_entry`, `pot_awarded`, `game_ended`.

Each event has an `id` (for edit/delete), `at` (display only; order comes from
log position), and an optional `by` (phase 2: who entered it).

**Only things a human decided are events.** Everything the rules determine is
computed during replay:

- **Blinds post automatically** as part of `hand_started`; no separate blind
  events. The log still displays "Sam posts SB $0.10". Undoing a hand start
  removes its blinds with it.
- **Streets advance automatically** when a betting round completes.
- **Uncalled bets return automatically** when betting ends.
- **Pots award automatically** when everyone else folds, or when a pot has only
  one eligible player. The host picks winners only when there's a real choice.
- **Calls store no amount**; it's derived from state, so editing an earlier
  raise adjusts later calls automatically.

Other event details:

- `hand_started` stores `buttonSeat`. The engine suggests the next seat; the
  host can override. Storing it means later edits don't move past buttons.
- No separate all-in action. An all-in is a bet, raise, or call that uses the
  whole stack; the engine marks the player all-in. The UI's All-in button
  produces whichever applies.
- Bets and raises are stored as **"raise to"** (total for the street), not
  "raise by".
- `hand_fast_entry` records each player's total contribution for the hand and
  whether they folded, and ends betting. It may follow some normal actions.
- Rebuys, leaving, sitting out, and returning happen between hands only.
  **Joining can happen mid-hand**: the newcomer isn't in the current hand and
  is dealt in from the next one.

## Table rules

- **Sitting between players (`seats.ts`):** seats are numbered 1..maxSeats
  clockwise. `seatAfter(state, playerId)` gives the seat to ask for to sit right
  after that player: an empty number between them if there is one, otherwise
  the next player's seat. `player_joined` then calls `makeRoom`: if the seat is
  taken, that player and everyone after them up to the next empty seat move up
  one (or, with no room above, the players before move down). Every stored seat
  number moves with its player (players, `lastButtonSeat`, the hand's button and
  blinds), so turn order and the next button are as if the newcomer had always
  sat there.

- **Sitting out:** a player keeps seat and stack and is skipped for the button,
  blinds, and dealing. **Returning is free** (no missed blinds owed).
- **Button:** always moves to the next occupied, non-sitting-out seat. No
  casino dead-button rules. Heads-up: the button posts the small blind.
- **No antes, no straddles.**
- **Who gets dealt in:** seated players with chips. A player with $0 is skipped
  (for button, blinds and dealing) until they rebuy.
- **Short blinds:** a player who can't cover a blind posts what they have and is
  all-in. The amount to call is the biggest blind actually posted, so if the big
  blind is short, others call what's really in (not the full big blind).
- **Opening bets:** the minimum bet is the big blind. Any opening bet on a street
  (even a short all-in one) lets everyone act again, since nobody had faced a bet.
- **Raising needs an opponent:** a player can't raise when everyone else still in
  the hand is all-in (nobody could call it). They may call or fold.
- **Not handled:** several short all-ins that together add up to a full raise do
  not reopen betting (casino rule TDA 43 says they would).
- **Short all-in raises don't reopen betting.** If a player goes all-in for
  less than a full raise, players who already acted may call or fold but not
  re-raise. Minimum raise = size of the last full raise (starts at the big blind).

## Replay and edits

- Replay applies events in order. **It stops at the first invalid event** and
  returns the state just before it, plus the error (event id, index, message).
- The UI shows "event N is no longer valid" after an edit, and the host fixes
  or deletes it. Invalid events are never silently skipped.
- Undo = remove the last event and replay.
- `applyEvent` never changes the state it's given; it returns a new one.
- Before `game_created`, the state is `null` (so `ReplayResult.state` can be null).
- After a hand is fully awarded, it stays in `state.hand` with phase `"complete"`
  (so the UI can show the result) until the next `hand_started`. "Between hands"
  means no hand yet or the last hand is complete.
- Fast entry: every player in the hand needs an entry; nobody can enter less than
  they already put in or more than they have; someone who folded stays folded; a
  player still in who put in less than the top live amount must be all-in.

## Side pots (`pots.ts`)

Input: every player's total contribution for the hand, in seat order starting
left of the button, with folded flags.

1. **Uncalled bet:** if one player's contribution is alone at the top, the
   amount above the second-largest contribution is returned to them.
2. **Boundaries:** distinct contribution amounts of non-folded players, low to
   high. Folded players never create a boundary.
3. **Fill:** each slice runs from the previous boundary to its own; every
   player (folded or not) adds whatever part of their chips falls in that range.
   The top slice also absorbs any folded chips above the highest live amount.
4. **Eligible:** non-folded players whose contribution reaches the slice's top.

Each pot's `eligible` list is in seat order. **The UI must display it** (e.g.
"Side pot 1 · $10.00 · Ben, Dee, Cam"), and the showdown screen offers only
eligible players as winners.

## Awarding (`award.ts`)

- The host awards pots from the **last side pot down to the main pot**.
- `awardPot` rejects any winner not in the pot's `eligible` list.
- Pots with only one eligible player award automatically. Eligible lists shrink
  from the main pot up, so these are always next in last-to-first order.
- `pot_awarded.potIndex` must be the next pot in that order.
- **Split pots** divide in $0.05 units. Leftover units are dealt **one at a
  time** starting with the first tied winner left of the button (e.g. 5 units
  among 3 winners → 2, 2, 1 units in seat order).

## Invariants (checked by `properties.test.ts` over 5,000 random hands)

- Pots + returned uncalled bet = total contributions, exactly.
- Every pot is positive, a multiple of the unit, and has at least one eligible player.
- No folded player is ever eligible.
- Each side pot's eligible players are a strict subset of the previous pot's.
- An uncalled bet only ever goes to the single largest contributor.
- Split payouts sum exactly to the pot and differ by at most one unit.

`game.properties.test.ts` also plays 300 random games (7,500 hands of random
legal actions, rebuys, sitting out and awards) and checks that stacks plus chips
in the middle always equal total buy-ins, and that replaying the log
reproduces the exact same state, and that everyone settles up to exactly zero.

## Settlement

- Net result per player = final stack (or stack when they left) − total buy-ins.
  All nets must sum to zero.
- Suggest the fewest payments to settle up.
- Only available between hands (during a hand some chips are in the middle).
  Players who left are included, using the stack they left with.
- **Fewest payments (`settleUp`):** each payment zeroes out at least one person,
  so k people who are up or down never need more than k − 1 payments. If they
  split into smaller groups that each balance on their own, each group of m
  needs m − 1, so the fewest payments = k − (most balancing groups). We find
  that exactly by checking all subsets when ≤ 18 people are up or down (instant),
  otherwise fall back to biggest loser pays biggest winner. Within a group,
  payments also go biggest loser → biggest winner.

## Log lines (`describe.ts`)

- `describeLog(events)` returns one entry per event (with its hand number, for
  grouping) and stops at the first invalid event, like `replay`.
- Each entry has lines of two kinds: `event` (what the host entered, e.g.
  "Cam raises to $3.00") and `auto` (what the rules did: blinds, streets,
  "(no more betting)" run-outs, uncalled bets returned, the pots with their
  eligible players, automatic awards). The UI can style them differently.
- Call amounts in the log come from state, so they update when an earlier
  raise is edited.

## Status

Done (tests passing):
- Engine: `types`, `money`, `pots`, `award`, `hand`, `replay`, `settlement`,
  `describe`, `seats`, with tests
- Single-device UI: table diagram, actions, quick entry, showdown, log with
  edit/delete/undo, settlement, chip games, squeeze-in/mid-hand joins
- ESLint with the engine-purity rules
- Hardening: event checks, rate limits, server-recorded authorship
  (0002 migration, tested on real Postgres)
- Deployed on Vercel + Supabase; keep-alive ping (0003 + GitHub Action);
  "server asleep" message
- Shared games: Supabase schema + functions (tested on real Postgres),
  sync client with conflict handling (tested with simulated phones), room
  UI; a 3-phone hand was played through in a real browser using the
  tabs backend

Next:
1. Try shared games on real phones at a real game; collect fixes
2. Add the keep-alive secrets on GitHub (SUPABASE.md step 6)
3. Write up the design for public online games (server-run hands, hidden
   cards, timers, accounts) before building any of it
4. Later: real card dealing (each phone sees its own hole cards)

## UI (phase 1, single device)

- **Files:** `src/app/`. Engine stays UI-free; the app only calls engine functions.
  - `storage.ts`: each game's event log in localStorage (`poker-tracker:games`
    index + one key per game). Phase 2 swaps this file for Supabase.
  - `log.ts`: pure log operations (stamp, undo, replace, delete, check an event
    before adding it). `money.ts`: dollar text ↔ cents. Both have tests.
  - `useGame.ts`: one game's log + `replay` result. `dispatch` checks the event
    first and returns the engine's message instead of adding a bad event.
  - `screens/`: Home (games list, new game with Money/Chips), Table, Log,
    Settle up (Results in chip games).
    `components/`: TableDiagram, AddPlayer, PlayersPanel, HandView (action
    panel, quick entry, showdown), EventEditor.
  - `ui.tsx`: `AmountProvider`/`useAmounts` so every screen formats and parses
    amounts per the game's money/chips setting.
- **Routing:** `#/` and `#/game/<id>` (no router library; phone back button works).
  The game screen is keyed by game id so switching games never cross-saves.
- **Mobile first:** 44px+ touch targets, numeric keypad for money, light/dark.
- **Table diagram (`TableDiagram.tsx`):** an oval table with players clockwise
  in seat order, evenly spaced along the oval (first seat at the bottom; the
  layout doesn't rotate). Shows name, stack, dealer button, SB/BB, this street's
  bet as a chip toward the middle, folded/all-in/"next hand"/sitting out, and
  the pot and street in the centre. The player to act is drawn larger with a
  ring; the last recorded action shows as a bubble on that player
  (`lastAction.ts`). "+" spots between players open the add-player form for
  that spot (also mid-hand). 7+ players use smaller tiles.
- **Table:** between hands shows the last hand's result, a Deal button (button
  seat pre-filled with the engine's suggestion, editable) and the players panel
  (add, rebuy, sit out/back in, leave). During a hand: seats with D/SB/BB
  badges, whose turn it is, this street's bets and stacks; the action panel
  offers only legal actions (Fold, Check/Call, Bet/Raise to with Min, ½ pot,
  Pot, All-in shortcuts). Pot-sized raise = call, then raise by the pot after
  the call. "Quick entry" switches to entering totals.
- **Showdown:** pots listed main first with eligible players; the next pot to
  award (last side pot first) shows winner toggles; pick several for a split.
- **Log:** `describeLog` output grouped by hand, with Edit/Delete on each event.
  Editable: blinds, joins, rebuys, button seat, actions (kind + amount), quick
  entry totals, pot winners. Anything else: delete and re-enter. An edit that
  breaks a later event shows a red banner on every tab; the broken event is
  red in the log and later events are greyed until it's fixed. New input is
  blocked while the log has an invalid event.
- **Undo** (top bar) removes the last event. Deletes need a second tap.
- **Settle up:** results table and fewest payments; available between hands.
  "End game" adds `game_ended` (Undo reopens).

## Shared games (multi-device sync)

Decisions: the host plus each player acting for their own seat; join by room
code with no accounts (Supabase anonymous sign-in); assume everyone's online
(entry pauses while reconnecting). Setup steps: `SUPABASE.md`.

- **Data:** `rooms` (code, name, host, `version`), `room_members` (uid,
  is_host, claimed `player_id`; one phone per player), `events` (room, seq,
  body jsonb). The event log is still the only game data
  (`supabase/migrations/0001_rooms.sql`).
- **Writes only through functions** (`create_room`, `join_room`,
  `room_snapshot`, `append_event`, `undo_last`, `replace_log`,
  `claim_player`, `release_player`), all `security definer`. Tables have
  read-only RLS for members; no direct writes.
- **Versions:** every log change bumps `rooms.version`. Writes pass the
  version the phone last saw; the function locks the room row and refuses
  with `conflict` if it moved. Tested with two simultaneous sessions: the
  second waits for the first, then gets `conflict`.
- **Permissions** (`src/sync/rules.ts`, mirrored in SQL): host can do
  anything; a phone linked to a player may only append `action` events for
  that player, and undo its own last action; unlinked phones watch. Edits and
  deletes (`replace_log`) are host-only. The database doesn't run the engine,
  so turn order and amounts are checked on the phone before sending; a
  tampered phone could add an out-of-turn action, which would show as an
  invalid event for the host to delete.
- **Client (`src/sync/roomClient.ts`):** check locally (permission, then
  engine); if refused, reload once and re-check (the phone may just be
  behind); send with the version; on `conflict` reload, re-check, retry (up
  to 3 times). Edits/deletes aren't retried blindly after a conflict ("Someone
  changed the game just now…"). Undo is retried.
- **Live updates:** phones subscribe to their room's row (Supabase Realtime,
  RLS applies) and reload the snapshot on any change. Claims bump
  `updated_at` (not `version`) so they don't cause write conflicts.
- **Backends (`src/sync/`):** `SupabaseBackend` when `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are set (loaded lazily); otherwise `LocalBackend`
  shares rooms between tabs of one browser (localStorage + BroadcastChannel,
  one "phone" per tab). Both follow the same rules; `roomServer.ts` is the
  TypeScript stand-in for the database, also used by the tests
  (`memoryBackend.ts`).
- **UI:** "Share with other phones" on new game; "Join a game" by code or
  `#/room/<CODE>` link; shared games listed on Home. In a room: code chip
  (share sheet / copy link), Live/Reconnecting badge, "You're Ann / host /
  Watching". "Who are you?" links the phone to a player; the host sees
  "Phones & seats" and can free a seat. Non-hosts don't see Deal, "+",
  player management, quick entry, award buttons, log edit/delete, or End
  game; they see "Waiting for Ben…" / "Your turn". Every screen works through
  the same `Game` interface (`src/app/game.ts`) for local and shared games.
- **Hardening (`supabase/migrations/0002_hardening.sql`):**
  - Every stored event: JSON object, known `type`, `id` 1–64 chars and
    unique in the room, ≤ 8 KB. ≤ 20,000 events and ≤ 50 phones per room.
    Room names ≤ 60 chars; player names ≤ 40 (engine).
  - Rate limits per phone (anonymous uid), in `rate_limit_hits` (no client
    access): 40 changes / 10 s, 10 join attempts / minute, 10 new rooms /
    hour. Only successful calls count (a refused call stores nothing), so
    `join_room` returns null for an unknown code instead of raising: an
    error would roll back the record of the attempt and make guessing free.
    The client turns null into "No game with that code".
  - The server overwrites each event's `by` ("host", or the player the phone
    plays as) and `at` (server clock). `replace_log` keeps `by`/`at` for
    events already in the log (matched by id); new ones are the host's.
    The log shows "entered by the host" on actions the host entered for a
    player in shared games.
  - `eventRefusal`/`enteredBy` in `rules.ts` mirror this; the stand-in
    server (`roomServer.ts`) applies the same checks and stamping, but not
    the rate limits.
  - Not covered: someone making many anonymous sign-ins to dodge per-phone
    limits (Supabase's per-IP sign-in limit slows it; CAPTCHA stops it), and
    turn order still being checked on the phone only.
- **Keep-alive (`0003_keepalive.sql`, `.github/workflows/keep-alive.yml`):**
  `ping()` (callable with the public key, reads one row, returns 'ok') is
  called daily by a GitHub Action using repo secrets `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`, so the free project doesn't pause after a week.
- **Server asleep:** `src/sync/errors.ts` tells network-level failures
  (failed fetch, timeouts, 502/503/504/540, "paused") from real refusals;
  the Supabase backend turns them into `UnreachableError` with a message
  saying the host can resume the project from the dashboard. The room
  screen shows it as "The game server is asleep" with Try again. Local
  games are unaffected.
- **Hosting:** live at https://poker-tracker-umber-one.vercel.app (Vercel,
  builds from GitHub `main`; env vars `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` = publishable key). Smoke-tested on the live
  site: create room, anonymous sign-in, Live, add players, deal, act, undo.
- **Tests:** `src/sync/__tests__/sync.test.ts` (several simulated phones on
  the stand-in server: permissions, stale phones, simultaneous taps, undo,
  edits, claims, server stamping, event checks); `supabase/tests/rooms.test.sql`
  and `hardening.test.sql` (same rules plus the limits against real
  Postgres; `npm run test:db`).

## Working agreement

- Propose data model and file structure changes before writing code.
- Engine first, with tests, before UI.
- Explain non-obvious algorithms in plain language before implementing them.
- Run `npm test` after every engine change.
