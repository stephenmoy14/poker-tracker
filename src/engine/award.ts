import type { Cents, PlayerId, Pot } from "./types";
import { assertValidAmount } from "./money";

/**
 * Divides `amount` evenly between `winners` in whole units. Leftover units are
 * dealt out one at a time, starting with the first winner in `seatOrder`
 * (which must start left of the button).
 */
export function splitPot(
  amount: Cents,
  winners: readonly PlayerId[],
  seatOrder: readonly PlayerId[],
  unit: Cents,
): Record<PlayerId, Cents> {
  assertValidAmount(amount, unit, "Pot");
  if (winners.length === 0) throw new Error("A pot needs at least one winner");
  const winnerSet = new Set(winners);
  if (winnerSet.size !== winners.length) throw new Error("Duplicate winner");
  for (const w of winners) {
    if (!seatOrder.includes(w)) throw new Error(`Winner ${w} is not seated in this hand`);
  }

  const ordered = seatOrder.filter((id) => winnerSet.has(id));
  const units = amount / unit;
  const base = Math.floor(units / ordered.length);
  const leftover = units % ordered.length;

  const payouts: Record<PlayerId, Cents> = {};
  ordered.forEach((id, i) => {
    payouts[id] = (base + (i < leftover ? 1 : 0)) * unit;
  });
  return payouts;
}

/** Like splitPot, but rejects winners who aren't eligible for this pot. */
export function awardPot(
  pot: Pot,
  winners: readonly PlayerId[],
  seatOrder: readonly PlayerId[],
  unit: Cents,
): Record<PlayerId, Cents> {
  for (const w of winners) {
    if (!pot.eligible.includes(w)) throw new Error(`${w} is not eligible for this pot`);
  }
  return splitPot(pot.amount, winners, seatOrder, unit);
}
