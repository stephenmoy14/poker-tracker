import type {
  Cents,
  FastEntry,
  GameState,
  HandPlayer,
  HandState,
  LegalActions,
  Player,
  PlayerAction,
  PlayerId,
  Street,
} from "./types";
import { assertValidAmount, formatAmount } from "./money";
import { computePots } from "./pots";
import { awardPot } from "./award";

// Hand mechanics: blinds, button, turn order, legal actions, round completion,
// street advancement, end of betting and pot awarding.
//
// The functions that change state (startHand, applyAction, applyFastEntry,
// awardNextPot) MUTATE the state they're given and throw an Error with a
// readable message when something isn't allowed. replay.ts always hands them
// a fresh copy, so callers outside the engine never see a half-applied event.
//
// How a betting round works (plain language):
//  - `hasActed` means "has acted since the last full bet or raise".
//  - A player needs to act if they haven't matched the current bet, or if
//    they haven't acted yet and someone else could still respond to a bet.
//  - A full bet or raise resets everyone else's `hasActed`, so they all get
//    to act again, including re-raising.
//  - A short all-in raise does NOT reset it. Players who already acted must
//    still call or fold (they're behind the bet), but because their
//    `hasActed` is still true they aren't allowed to raise.
//  - When nobody needs to act, the round is over: move to the next street,
//    or to showdown after the river. If nobody (or only one player) has
//    chips left to bet, the remaining streets are skipped.

const STREETS: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

const fmt = (state: GameState, amount: Cents) => formatAmount(amount, state.config);

// ───────────── Queries ─────────────

/** True between hands: no hand yet, or the last hand is fully awarded. */
export function isBetweenHands(state: GameState): boolean {
  return state.hand === null || state.hand.phase === "complete";
}

/** Players who get dealt in: seated (not sitting out or gone) with chips. Seat order. */
export function dealablePlayers(state: GameState): Player[] {
  return Object.values(state.players)
    .filter((p) => p.status === "seated" && p.stack > 0)
    .sort((a, b) => a.seat - b.seat);
}

/**
 * Suggested button for the next hand: the next dealable seat after the last
 * button, wrapping around. Null if fewer than two players can be dealt in.
 */
export function suggestButtonSeat(state: GameState): number | null {
  const seats = dealablePlayers(state).map((p) => p.seat);
  if (seats.length < 2) return null;
  const last = state.lastButtonSeat;
  if (last === null) return seats[0]!;
  return seats.find((s) => s > last) ?? seats[0]!;
}

/** Index of the pot the host must award next (last side pot first), or null. */
export function nextPotIndex(hand: HandState): number | null {
  if (hand.phase !== "awarding") return null;
  return hand.pots.length - 1 - hand.awards.length;
}

export function potLabel(index: number): string {
  return index === 0 ? "the main pot" : `side pot ${index}`;
}

/** What the player whose turn it is may do, or null if nobody is to act. */
export function legalActions(state: GameState): LegalActions | null {
  const hand = state.hand;
  if (!hand || hand.phase !== "betting" || hand.toAct === null) return null;
  const hp = handPlayer(hand, hand.toAct);
  const player = state.players[hp.playerId]!;

  const toCall = Math.max(0, hand.currentBet - hp.committedStreet);
  const maxTo = hp.committedStreet + player.stack;
  // Raising is only possible if betting is open to this player (no short
  // all-in has closed it), someone else could call, and the stack goes past
  // the current bet.
  const othersCanAct = hand.players.some((o) => o !== hp && canAct(o));
  let minTo: Cents | null = null;
  if (!hp.hasActed && othersCanAct && maxTo > hand.currentBet) {
    minTo = Math.min(fullMinimum(state, hand), maxTo);
  }
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, player.stack),
    minBetOrRaiseTo: minTo,
    maxBetOrRaiseTo: maxTo,
  };
}

// ───────────── Starting a hand ─────────────

export function startHand(state: GameState, buttonSeat: number): void {
  if (state.status === "ended") throw new Error("The game has ended");
  if (!isBetweenHands(state)) throw new Error("A hand is already in progress");

  const dealt = dealablePlayers(state);
  if (dealt.length < 2) throw new Error("At least two players with chips are needed to start a hand");
  const buttonIndex = dealt.findIndex((p) => p.seat === buttonSeat);
  if (buttonIndex < 0) {
    throw new Error(`Seat ${buttonSeat} has no player who can take the button`);
  }

  // Seat order starting left of the button; the button is last.
  const order = [...dealt.slice(buttonIndex + 1), ...dealt.slice(0, buttonIndex + 1)];
  const headsUp = order.length === 2;
  // Heads-up the button posts the small blind and the other player the big.
  const sbIndex = headsUp ? 1 : 0;
  const bbIndex = headsUp ? 0 : 1;

  const { config } = state;
  const hand: HandState = {
    number: state.handsPlayed + 1,
    buttonSeat,
    smallBlindSeat: order[sbIndex]!.seat,
    bigBlindSeat: order[bbIndex]!.seat,
    street: "preflop",
    players: order.map((p) => ({
      playerId: p.id,
      committedStreet: 0,
      committedTotal: 0,
      folded: false,
      allIn: false,
      hasActed: false,
    })),
    toAct: null,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    mode: "actions",
    phase: "betting",
    uncalledReturn: null,
    pots: [],
    awards: [],
  };
  state.hand = hand;
  state.lastButtonSeat = buttonSeat;

  // Blinds post automatically. A short stack posts what it has and is all-in.
  const sb = hand.players[sbIndex]!;
  const bb = hand.players[bbIndex]!;
  commit(state, sb, Math.min(config.smallBlind, state.players[sb.playerId]!.stack));
  commit(state, bb, Math.min(config.bigBlind, state.players[bb.playerId]!.stack));
  // The bet to match is the biggest blind actually posted. (If the big blind
  // is short, players call what's really in, not the full big blind.)
  hand.currentBet = Math.max(sb.committedStreet, bb.committedStreet);

  // Action starts left of the big blind (heads-up: the button).
  advance(state, bbIndex);
}

// ───────────── Player actions ─────────────

export function applyAction(state: GameState, playerId: PlayerId, action: PlayerAction): void {
  const hand = state.hand;
  if (!hand || hand.phase !== "betting") throw new Error("No betting round is in progress");
  if (!state.players[playerId]) throw new Error(`Unknown player ${playerId}`);
  if (hand.toAct !== playerId) {
    const turn = hand.toAct ? `${nameOf(state, hand.toAct)}'s turn` : "nobody's turn";
    throw new Error(`It's ${turn}, not ${nameOf(state, playerId)}'s`);
  }

  const index = hand.players.findIndex((p) => p.playerId === playerId);
  const hp = hand.players[index]!;
  const player = state.players[playerId]!;
  const name = player.name;
  const toCall = hand.currentBet - hp.committedStreet;

  switch (action.kind) {
    case "fold":
      hp.folded = true;
      break;

    case "check":
      if (toCall > 0) {
        throw new Error(`${name} can't check: it's ${fmt(state, toCall)} to call`);
      }
      break;

    case "call":
      if (toCall <= 0) throw new Error(`${name} has nothing to call; check instead`);
      commit(state, hp, Math.min(toCall, player.stack));
      break;

    case "bet":
    case "raise": {
      const verb = action.kind === "bet" ? "Bet" : "Raise";
      if (action.kind === "bet" && hand.currentBet > 0) {
        throw new Error(`There's already a bet of ${fmt(state, hand.currentBet)}; raise instead`);
      }
      if (action.kind === "raise" && hand.currentBet === 0) {
        throw new Error("There's no bet to raise; bet instead");
      }
      assertValidAmount(action.to, state.config.unit, verb, state.config);

      const legal = legalActions(state)!;
      if (legal.minBetOrRaiseTo === null) {
        throw new Error(`${name} can only call or fold here`);
      }
      const to = action.to;
      const allInTo = legal.maxBetOrRaiseTo;
      if (to > allInTo) {
        throw new Error(`${name} only has enough to go to ${fmt(state, allInTo)}`);
      }
      const fullMin = fullMinimum(state, hand);
      if (to < fullMin && to !== allInTo) {
        throw new Error(
          `${verb} to ${fmt(state, to)} is below the minimum of ${fmt(state, fullMin)}`,
        );
      }

      const increment = to - hand.currentBet;
      const isFull = increment >= hand.lastRaiseSize;
      commit(state, hp, to - hp.committedStreet);
      if (isFull) hand.lastRaiseSize = increment;
      // A full bet or raise reopens betting for everyone. So does any opening
      // bet, even a short all-in one: nobody has faced a bet on this street yet.
      if (isFull || action.kind === "bet") {
        for (const other of hand.players) if (other !== hp) other.hasActed = false;
      }
      hand.currentBet = to;
      break;
    }
  }

  hp.hasActed = true;
  advance(state, index);
}

/**
 * Records each player's total for the hand in one go and ends betting.
 * May follow some normal actions; chips already committed can't be taken back.
 */
export function applyFastEntry(state: GameState, entries: readonly FastEntry[]): void {
  const hand = state.hand;
  if (!hand || hand.phase !== "betting") throw new Error("No betting round is in progress");
  const { unit } = state.config;

  const byId = new Map<PlayerId, FastEntry>();
  for (const e of entries) {
    if (byId.has(e.playerId)) throw new Error(`${nameOf(state, e.playerId)} is listed twice`);
    byId.set(e.playerId, e);
  }
  for (const hp of hand.players) {
    if (!byId.has(hp.playerId)) throw new Error(`Missing an entry for ${nameOf(state, hp.playerId)}`);
  }
  if (byId.size !== hand.players.length) {
    const extra = entries.find((e) => !hand.players.some((p) => p.playerId === e.playerId))!;
    throw new Error(`${nameOf(state, extra.playerId)} isn't in this hand`);
  }

  // Validate everything before changing anything.
  for (const hp of hand.players) {
    const e = byId.get(hp.playerId)!;
    const name = nameOf(state, hp.playerId);
    assertValidAmount(e.contributed, unit, `${name}'s contribution`, state.config);
    const extra = e.contributed - hp.committedTotal;
    if (extra < 0) {
      throw new Error(`${name} already put in ${fmt(state, hp.committedTotal)}; can't enter less`);
    }
    if (extra > state.players[hp.playerId]!.stack) {
      throw new Error(
        `${name} only has ${fmt(state, hp.committedTotal + state.players[hp.playerId]!.stack)} in total`,
      );
    }
    if (hp.folded && (!e.folded || extra > 0)) {
      throw new Error(`${name} already folded with ${fmt(state, hp.committedTotal)} in`);
    }
  }
  const live = hand.players.filter((hp) => !byId.get(hp.playerId)!.folded);
  if (live.length === 0) throw new Error("At least one player must still be in the hand");
  const maxLive = Math.max(...live.map((hp) => byId.get(hp.playerId)!.contributed));
  for (const hp of live) {
    const e = byId.get(hp.playerId)!;
    const allIn = e.contributed - hp.committedTotal === state.players[hp.playerId]!.stack;
    if (e.contributed < maxLive && !allIn) {
      throw new Error(
        `${nameOf(state, hp.playerId)} put in less than ${fmt(state, maxLive)} without being all-in`,
      );
    }
  }

  for (const hp of hand.players) {
    const e = byId.get(hp.playerId)!;
    commit(state, hp, e.contributed - hp.committedTotal);
    hp.folded = e.folded;
  }
  hand.mode = "fast_entry";
  if (live.length > 1) hand.street = "showdown";
  endBetting(state);
}

/** The host picks winners for the next pot (last side pot first). */
export function awardNextPot(state: GameState, potIndex: number, winners: readonly PlayerId[]): void {
  const hand = state.hand;
  if (!hand || hand.phase !== "awarding") throw new Error("There are no pots waiting to be awarded");
  const expected = nextPotIndex(hand)!;
  if (potIndex !== expected) {
    throw new Error(`Pots are awarded from the last side pot down; next is ${potLabel(expected)}`);
  }
  pay(state, potIndex, winners);
  autoAward(state);
}

// ───────────── Internals ─────────────

function handPlayer(hand: HandState, id: PlayerId): HandPlayer {
  const hp = hand.players.find((p) => p.playerId === id);
  if (!hp) throw new Error(`Player ${id} isn't in this hand`);
  return hp;
}

function nameOf(state: GameState, id: PlayerId): string {
  return state.players[id]?.name ?? id;
}

function canAct(hp: HandPlayer): boolean {
  return !hp.folded && !hp.allIn;
}

/** Smallest full bet (the big blind) or full raise-to. */
function fullMinimum(state: GameState, hand: HandState): Cents {
  return hand.currentBet === 0 ? state.config.bigBlind : hand.currentBet + hand.lastRaiseSize;
}

function needsToAct(hand: HandState, hp: HandPlayer): boolean {
  if (!canAct(hp)) return false;
  if (hp.committedStreet < hand.currentBet) return true;
  if (hp.hasActed) return false;
  // Hasn't acted and owes nothing: only worth asking if someone could respond to a bet.
  return hand.players.some((o) => o !== hp && canAct(o));
}

/** Moves chips from a player's stack into the hand. */
function commit(state: GameState, hp: HandPlayer, amount: Cents): void {
  const player = state.players[hp.playerId]!;
  if (amount < 0 || amount > player.stack) {
    throw new Error(`${player.name} can't put in ${fmt(state, amount)}`);
  }
  player.stack -= amount;
  hp.committedStreet += amount;
  hp.committedTotal += amount;
  if (player.stack === 0) hp.allIn = true;
}

/** After someone acts (or blinds post): find who's next, or end the round. */
function advance(state: GameState, fromIndex: number): void {
  const hand = state.hand!;
  if (hand.players.filter((p) => !p.folded).length === 1) {
    endBetting(state); // everyone else folded
    return;
  }
  const n = hand.players.length;
  for (let k = 1; k <= n; k++) {
    const hp = hand.players[(fromIndex + k) % n]!;
    if (needsToAct(hand, hp)) {
      hand.toAct = hp.playerId;
      return;
    }
  }
  nextStreet(state);
}

function nextStreet(state: GameState): void {
  const hand = state.hand!;
  for (;;) {
    if (hand.street === "river") {
      hand.street = "showdown";
      endBetting(state);
      return;
    }
    hand.street = STREETS[STREETS.indexOf(hand.street) + 1]!;
    for (const hp of hand.players) {
      hp.committedStreet = 0;
      hp.hasActed = false;
    }
    hand.currentBet = 0;
    hand.lastRaiseSize = state.config.bigBlind;
    // After the flop, action starts with the first player left of the button.
    const first = hand.players.find((hp) => needsToAct(hand, hp));
    if (first) {
      hand.toAct = first.playerId;
      return;
    }
    // Nobody can bet (all-in): deal the rest of the board without betting.
  }
}

function endBetting(state: GameState): void {
  const hand = state.hand!;
  hand.toAct = null;
  const { pots, uncalled } = computePots(
    hand.players.map((hp) => ({ playerId: hp.playerId, amount: hp.committedTotal, folded: hp.folded })),
  );
  if (uncalled) state.players[uncalled.playerId]!.stack += uncalled.amount;
  hand.uncalledReturn = uncalled;
  hand.pots = pots;
  hand.phase = "awarding";
  autoAward(state);
}

/**
 * Awards pots that have only one eligible player (everyone else folded, or a
 * top side pot nobody else reached). Eligible lists shrink from the main pot
 * up, so these are always the next ones in last-to-first order.
 */
function autoAward(state: GameState): void {
  const hand = state.hand!;
  while (hand.awards.length < hand.pots.length) {
    const index = nextPotIndex(hand)!;
    const pot = hand.pots[index]!;
    if (pot.eligible.length !== 1) return; // the host has a real choice
    pay(state, index, pot.eligible);
  }
  hand.phase = "complete";
  state.handsPlayed += 1;
}

function pay(state: GameState, potIndex: number, winners: readonly PlayerId[]): void {
  const hand = state.hand!;
  const pot = hand.pots[potIndex]!;
  const seatOrder = hand.players.map((hp) => hp.playerId);
  const payouts = awardPot(pot, winners, seatOrder, state.config.unit);
  for (const [id, amount] of Object.entries(payouts)) state.players[id]!.stack += amount;
  hand.awards.push({ potIndex, payouts });
}
