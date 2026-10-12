import type { GameState, Player, PlayerId } from "./types";

// Seats and squeezing in.
//
// Seats are numbered 1..maxSeats clockwise. Empty numbers are allowed (someone
// left, or nobody sat there). When a newcomer wants to sit between two
// players:
//  - if there's an empty seat number between them, they take it;
//  - otherwise they take the second player's seat, and that player and
//    everyone after them up to the next empty seat moves up one seat
//    (if there's no empty seat above, the players before move down instead).
// Everything stored as a seat number (players, the button, the blinds, the
// last button) moves with its player, so turn order and the next button are
// unchanged apart from the newcomer.

/** Players currently at the table (not left), in seat order. */
export function seatedPlayers(state: GameState): Player[] {
  return Object.values(state.players)
    .filter((p) => p.status !== "left")
    .sort((a, b) => a.seat - b.seat);
}

function occupant(state: GameState, seat: number): Player | undefined {
  return Object.values(state.players).find((p) => p.status !== "left" && p.seat === seat);
}

/**
 * The seat number a newcomer should ask for to sit right after `afterId`
 * (clockwise), before the next player. Null `afterId` means "anywhere"
 * (used when the table is empty).
 */
export function seatAfter(state: GameState, afterId: PlayerId | null): number {
  const max = state.config.maxSeats;
  const seated = seatedPlayers(state);
  const firstFree = () => {
    for (let s = 1; s <= max; s++) if (!occupant(state, s)) return s;
    return 1;
  };
  const after = afterId ? seated.find((p) => p.id === afterId) : undefined;
  if (!after) return firstFree();

  const index = seated.indexOf(after);
  const next = seated[(index + 1) % seated.length]!;
  const step = (s: number) => (s % max) + 1;
  for (let s = step(after.seat); s !== next.seat && s !== after.seat; s = step(s)) {
    if (!occupant(state, s)) return s;
  }
  // No empty number between them: take the next player's seat and shift.
  return next === after ? firstFree() : next.seat;
}

/**
 * Makes `seat` available for a newcomer and returns the seat they get.
 * Mutates seat numbers in `state` (players, button, blinds, last button).
 */
export function makeRoom(state: GameState, seat: number): number {
  const max = state.config.maxSeats;
  if (!Number.isInteger(seat) || seat < 1 || seat > max) throw new Error(`Seat must be between 1 and ${max}`);
  if (!occupant(state, seat)) return seat;
  if (seatedPlayers(state).length >= max) throw new Error("The table is full");

  // Prefer moving the players from `seat` upward to the next empty seat.
  let free = seat + 1;
  while (free <= max && occupant(state, free)) free++;
  if (free <= max) {
    const moves = new Map<number, number>();
    for (let s = free - 1; s >= seat; s--) moves.set(s, s + 1);
    applyMoves(state, moves);
    return seat;
  }
  // Otherwise move the players before `seat` downward; the newcomer sits just before `seat`.
  free = seat - 1;
  while (free >= 1 && occupant(state, free)) free--;
  const moves = new Map<number, number>();
  for (let s = free + 1; s <= seat - 1; s++) moves.set(s, s - 1);
  applyMoves(state, moves);
  return seat - 1;
}

function applyMoves(state: GameState, moves: Map<number, number>): void {
  const moved = (s: number) => moves.get(s) ?? s;
  for (const p of Object.values(state.players)) {
    if (p.status !== "left") p.seat = moved(p.seat);
  }
  if (state.lastButtonSeat !== null) state.lastButtonSeat = moved(state.lastButtonSeat);
  const hand = state.hand;
  if (hand) {
    hand.buttonSeat = moved(hand.buttonSeat);
    hand.bigBlindSeat = moved(hand.bigBlindSeat);
    if (hand.smallBlindSeat !== null) hand.smallBlindSeat = moved(hand.smallBlindSeat);
  }
}
