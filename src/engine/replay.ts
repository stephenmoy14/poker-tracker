import type { GameConfig, GameEvent, GameState, ReplayResult } from "./types";
import { assertValidAmount, type AmountStyle } from "./money";
import { applyAction, applyFastEntry, awardNextPot, isBetweenHands, startHand } from "./hand";
import { makeRoom } from "./seats";

/**
 * Applies one event and returns the new state. Never changes `state`.
 * Throws an Error with a readable message if the event isn't valid here.
 * `state` is null only before `game_created`.
 */
export function applyEvent(state: GameState | null, event: GameEvent): GameState {
  if (event.type === "game_created") {
    if (state) throw new Error("The game has already been created");
    validateConfig(event.config);
    return {
      config: { ...event.config },
      players: {},
      hand: null,
      handsPlayed: 0,
      lastButtonSeat: null,
      status: "open",
    };
  }
  if (!state) throw new Error("The first event must create the game");
  if (state.status === "ended") throw new Error("The game has ended");

  const s = clone(state);
  const { unit } = s.config;

  switch (event.type) {
    case "player_joined": {
      // Allowed during a hand: the newcomer is dealt in from the next hand.
      if (s.players[event.playerId]) throw new Error(`Player ${event.playerId} already exists`);
      const name = event.name.trim();
      if (!name) throw new Error("A player needs a name");
      if (name.length > 40) throw new Error("Names can be up to 40 characters");
      assertPositive(event.buyIn, unit, "Buy-in", s.config);
      const seat = makeRoom(s, event.seat); // squeezes in, moving others if needed
      s.players[event.playerId] = {
        id: event.playerId,
        name,
        seat,
        stack: event.buyIn,
        totalBuyIn: event.buyIn,
        status: "seated",
      };
      break;
    }

    case "rebuy": {
      const p = activePlayer(s, event.playerId);
      requireBetweenHands(s, "rebuy");
      assertPositive(event.amount, unit, "Rebuy", s.config);
      p.stack += event.amount;
      p.totalBuyIn += event.amount;
      break;
    }

    case "player_left": {
      const p = activePlayer(s, event.playerId);
      requireBetweenHands(s, "leave");
      p.status = "left"; // stack stays as the cash-out amount for settlement
      break;
    }

    case "player_sat_out": {
      const p = activePlayer(s, event.playerId);
      requireBetweenHands(s, "sit out");
      if (p.status === "sitting_out") throw new Error(`${p.name} is already sitting out`);
      p.status = "sitting_out";
      break;
    }

    case "player_returned": {
      const p = activePlayer(s, event.playerId);
      requireBetweenHands(s, "return");
      if (p.status !== "sitting_out") throw new Error(`${p.name} isn't sitting out`);
      p.status = "seated";
      break;
    }

    case "hand_started":
      startHand(s, event.buttonSeat);
      break;

    case "action":
      applyAction(s, event.playerId, event.action);
      break;

    case "hand_fast_entry":
      applyFastEntry(s, event.entries);
      break;

    case "pot_awarded":
      awardNextPot(s, event.potIndex, event.winners);
      break;

    case "game_ended":
      requireBetweenHands(s, "end the game");
      s.status = "ended";
      break;

    default: {
      const unknown: never = event;
      throw new Error(`Unknown event type ${(unknown as { type: string }).type}`);
    }
  }
  return s;
}

/**
 * Rebuilds the state from the log. Stops at the first invalid event and
 * returns the state just before it, plus the error. Never skips events.
 */
export function replay(events: readonly GameEvent[]): ReplayResult {
  let state: GameState | null = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    try {
      state = applyEvent(state, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { state, error: { eventId: event.id, index, message } };
    }
  }
  return { state, error: null };
}

// ───────────── Helpers ─────────────

function validateConfig(c: GameConfig): void {
  if (c.format !== undefined && c.format !== "money" && c.format !== "chips") {
    throw new Error("Choose money or chips");
  }
  if (!Number.isInteger(c.unit) || c.unit <= 0) throw new Error("The smallest chip must be a positive whole number");
  assertPositive(c.smallBlind, c.unit, "Small blind", c);
  assertPositive(c.bigBlind, c.unit, "Big blind", c);
  if (c.bigBlind < c.smallBlind) throw new Error("The big blind can't be smaller than the small blind");
  if (!Number.isInteger(c.maxSeats) || c.maxSeats < 2) throw new Error("A table needs at least 2 seats");
  if (!c.currency) throw new Error("A currency is required");
}

function assertPositive(amount: number, unit: number, label: string, style?: AmountStyle): void {
  assertValidAmount(amount, unit, label, style);
  if (amount === 0) throw new Error(`${label} must be more than zero`);
}

function requireBetweenHands(state: GameState, what: string): void {
  if (!isBetweenHands(state)) throw new Error(`Can't ${what} during a hand`);
}

function activePlayer(state: GameState, id: string) {
  const p = state.players[id];
  if (!p) throw new Error(`Unknown player ${id}`);
  if (p.status === "left") throw new Error(`${p.name} has left the game`);
  return p;
}

/** State is plain data (no Dates, Maps or functions), so a JSON copy is exact. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
