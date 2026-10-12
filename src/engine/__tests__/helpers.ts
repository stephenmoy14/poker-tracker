import type { GameEvent, GameState, PlayerAction, PlayerId, FastEntry } from "../types";
import { replay } from "../replay";

// Small builders so tests read like a hand history. Amounts are in cents.

export type NewEvent = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "at"> : never) : never;

let counter = 0;
export function ev(e: NewEvent): GameEvent {
  counter += 1;
  return { ...e, id: `e${counter}`, at: 0 } as GameEvent;
}

export const create = (smallBlind = 10, bigBlind = 25, maxSeats = 10) =>
  ev({ type: "game_created", config: { smallBlind, bigBlind, unit: 5, currency: "USD", maxSeats } });

export const join = (playerId: PlayerId, seat: number, buyIn = 1000) =>
  ev({ type: "player_joined", playerId, name: playerId.toUpperCase(), seat, buyIn });

export const start = (buttonSeat: number) => ev({ type: "hand_started", buttonSeat });

export const fold = (playerId: PlayerId) => act(playerId, { kind: "fold" });
export const check = (playerId: PlayerId) => act(playerId, { kind: "check" });
export const call = (playerId: PlayerId) => act(playerId, { kind: "call" });
export const bet = (playerId: PlayerId, to: number) => act(playerId, { kind: "bet", to });
export const raise = (playerId: PlayerId, to: number) => act(playerId, { kind: "raise", to });
export const act = (playerId: PlayerId, action: PlayerAction) => ev({ type: "action", playerId, action });

export const award = (potIndex: number, winners: PlayerId[]) =>
  ev({ type: "pot_awarded", potIndex, winners });

export const fast = (entries: FastEntry[]) => ev({ type: "hand_fast_entry", entries });

/** Replays and fails the test if any event is rejected. */
export function run(events: GameEvent[]): GameState {
  const { state, error } = replay(events);
  if (error) throw new Error(`Event ${error.index} rejected: ${error.message}`);
  return state!;
}

/** Replays and returns the rejection message (fails if nothing was rejected). */
export function rejection(events: GameEvent[]): string {
  const { error } = replay(events);
  if (!error) throw new Error("Expected an event to be rejected");
  return error.message;
}

export const stacks = (s: GameState) =>
  Object.fromEntries(Object.values(s.players).map((p) => [p.id, p.stack]));
