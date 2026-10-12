import { describe, it, expect } from "vitest";
import { computePots, type Contribution } from "../pots";
import { splitPot } from "../award";

// Seeded PRNG so any failure is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNIT = 5;
const RUNS = 5000;

function randomHand(rand: () => number): Contribution[] {
  const n = 2 + Math.floor(rand() * 8); // 2-9 players
  const hand: Contribution[] = [];
  for (let i = 0; i < n; i++) {
    const folded = rand() < 0.35;
    // Live players always put something in; folded players may have put in nothing.
    const minUnits = folded ? 0 : 1;
    // Small range so ties (shared all-in amounts) happen often.
    const units = minUnits + Math.floor(rand() * 40);
    hand.push({ playerId: `p${i}`, amount: units * UNIT, folded });
  }
  if (hand.every((c) => c.folded)) hand[0] = { ...hand[0]!, folded: false, amount: UNIT };
  return hand;
}

describe("pot invariants over random hands", () => {
  it("hold for every generated hand", () => {
    const rand = mulberry32(12345);
    for (let run = 0; run < RUNS; run++) {
      const hand = randomHand(rand);
      const { pots, uncalled } = computePots(hand);
      const ctx = JSON.stringify(hand);

      // Chips are conserved.
      const total = hand.reduce((s, c) => s + c.amount, 0);
      const inPots = pots.reduce((s, pot) => s + pot.amount, 0);
      expect(inPots + (uncalled?.amount ?? 0), ctx).toBe(total);

      const folded = new Set(hand.filter((c) => c.folded).map((c) => c.playerId));
      let previousEligible: string[] | null = null;
      for (const pot of pots) {
        expect(pot.amount > 0, ctx).toBe(true);
        expect(pot.amount % UNIT, ctx).toBe(0);
        expect(pot.eligible.length > 0, ctx).toBe(true);
        expect(pot.eligible.some((id) => folded.has(id)), ctx).toBe(false);
        // Each side pot's eligible players are a strict subset of the previous pot's.
        if (previousEligible) {
          expect(pot.eligible.every((id) => previousEligible!.includes(id)), ctx).toBe(true);
          expect(pot.eligible.length < previousEligible.length, ctx).toBe(true);
        }
        previousEligible = pot.eligible;
      }

      // An uncalled bet only goes to the single largest contributor.
      if (uncalled) {
        const max = Math.max(...hand.map((c) => c.amount));
        const atMax = hand.filter((c) => c.amount === max);
        expect(atMax.length, ctx).toBe(1);
        expect(atMax[0]!.playerId, ctx).toBe(uncalled.playerId);
      }

      // Splitting any pot among any eligible winners pays out exactly, within one unit.
      const seats = hand.map((c) => c.playerId);
      for (const pot of pots) {
        const k = 1 + Math.floor(rand() * pot.eligible.length);
        const winners = pot.eligible.slice(0, k);
        const payouts = Object.values(splitPot(pot.amount, winners, seats, UNIT));
        expect(payouts.reduce((s, x) => s + x, 0), ctx).toBe(pot.amount);
        expect(Math.max(...payouts) - Math.min(...payouts) <= UNIT, ctx).toBe(true);
      }
    }
  });
});
