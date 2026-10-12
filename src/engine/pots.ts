import type { Cents, PlayerId, Pot } from "./types";

export interface Contribution {
  playerId: PlayerId;
  amount: Cents; // total put in this hand, blinds included
  folded: boolean;
}

export interface PotResult {
  pots: Pot[]; // main pot first, then side pots in order
  uncalled: { playerId: PlayerId; amount: Cents } | null;
}

/**
 * Splits a finished hand's contributions into a main pot and side pots.
 *
 * `contributions` must list every player dealt into the hand, in seat order
 * starting left of the button. Each pot's `eligible` list keeps that order,
 * so the UI can display it directly and the odd-chip rule can use it.
 *
 * Steps (see the design notes):
 *  1. Return the uncalled part of the single largest contribution.
 *  2. Slice boundaries = distinct amounts of players who haven't folded.
 *  3. Every player's chips fill the slices from the bottom up.
 *  4. Eligible = non-folded players whose chips reach the top of the slice.
 */
export function computePots(contributions: readonly Contribution[]): PotResult {
  validate(contributions);

  // 1. Uncalled bet: anything above the second-largest contribution was never matched.
  const byAmount = [...contributions].sort((a, b) => b.amount - a.amount);
  const top = byAmount[0]!;
  const secondAmount = byAmount[1]?.amount ?? 0;
  const adjusted = new Map(contributions.map((c) => [c.playerId, c.amount]));
  let uncalled: PotResult["uncalled"] = null;
  if (top.amount > secondAmount) {
    uncalled = { playerId: top.playerId, amount: top.amount - secondAmount };
    adjusted.set(top.playerId, secondAmount);
  }
  const amountOf = (id: PlayerId) => adjusted.get(id)!;

  // 2. Slice boundaries come only from players still in the hand.
  const live = contributions.filter((c) => !c.folded);
  const levels = [...new Set(live.map((c) => amountOf(c.playerId)).filter((a) => a > 0))].sort(
    (a, b) => a - b,
  );

  const total = contributions.reduce((sum, c) => sum + amountOf(c.playerId), 0);
  if (levels.length === 0) {
    if (total > 0) {
      throw new Error("Chips are in the pot but no remaining player contributed anything");
    }
    return { pots: [], uncalled };
  }

  // 3 + 4. Fill each slice and record who can win it.
  const pots: Pot[] = [];
  let previous = 0;
  levels.forEach((level, i) => {
    // The top slice also absorbs any folded chips above the highest live amount,
    // so no chip is ever left out of a pot.
    const isTopSlice = i === levels.length - 1;
    let amount = 0;
    for (const c of contributions) {
      const a = amountOf(c.playerId);
      const upTo = isTopSlice ? a : Math.min(a, level);
      amount += Math.max(0, upTo - previous);
    }
    const eligible = live.filter((c) => amountOf(c.playerId) >= level).map((c) => c.playerId);
    pots.push({ amount, eligible });
    previous = level;
  });

  return { pots, uncalled };
}

function validate(contributions: readonly Contribution[]): void {
  if (contributions.length === 0) throw new Error("No contributions given");
  const seen = new Set<PlayerId>();
  for (const c of contributions) {
    if (seen.has(c.playerId)) throw new Error(`Duplicate player ${c.playerId}`);
    seen.add(c.playerId);
    if (!Number.isInteger(c.amount) || c.amount < 0) {
      throw new Error(`Invalid contribution for ${c.playerId}: ${c.amount}`);
    }
  }
  if (contributions.every((c) => c.folded)) {
    throw new Error("At least one player must still be in the hand");
  }
}
