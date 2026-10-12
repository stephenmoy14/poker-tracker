import { describe, it, expect } from "vitest";
import type { NetResult, Payment } from "../types";
import { netResults, settleUp, settlement } from "../settlement";
import { create, join, start, fold, raise, ev, run } from "./helpers";

const nets = (values: Record<string, number>): NetResult[] =>
  Object.entries(values).map(([playerId, net]) => ({ playerId, net }));

/** Applies payments to nets; everyone should end at zero. */
function settles(n: NetResult[], payments: Payment[]): boolean {
  const left = new Map(n.map((r) => [r.playerId, r.net]));
  for (const p of payments) {
    if (p.amount <= 0) return false;
    left.set(p.from, left.get(p.from)! + p.amount);
    left.set(p.to, left.get(p.to)! - p.amount);
  }
  return [...left.values()].every((v) => v === 0);
}

describe("netResults", () => {
  it("is final stack minus buy-ins, including rebuys and players who left", () => {
    const s = run([
      create(), join("a", 1, 1000), join("b", 2, 1000), join("c", 3, 1000),
      start(3), raise("c", 300), fold("a"), fold("b"),   // c wins the blinds
      ev({ type: "rebuy", playerId: "c", amount: 500 }),
      ev({ type: "player_left", playerId: "b" }),
    ]);
    expect(netResults(s)).toEqual([
      { playerId: "a", net: -10 },
      { playerId: "b", net: -25 },
      { playerId: "c", net: 35 },
    ]);
  });

  it("waits until the hand is over", () => {
    const s = run([create(), join("a", 1), join("b", 2), start(1)]);
    expect(() => netResults(s)).toThrow();
  });
});

describe("settleUp", () => {
  it("nobody owes anything", () => {
    expect(settleUp(nets({ a: 0, b: 0 }))).toEqual([]);
    expect(settleUp([])).toEqual([]);
  });

  it("one loser pays one winner", () => {
    expect(settleUp(nets({ a: 500, b: -500 }))).toEqual([{ from: "b", to: "a", amount: 500 }]);
  });

  it("one big loser pays several winners", () => {
    expect(settleUp(nets({ a: 300, b: 200, c: -500 }))).toEqual([
      { from: "c", to: "a", amount: 300 },
      { from: "c", to: "b", amount: 200 },
    ]);
  });

  it("finds pairs that cancel out, beating biggest-pays-biggest", () => {
    // Biggest loser pays biggest winner would take 4 payments here.
    // Ann/Cam cancel exactly, and Ben + Dee = Eve, so 3 is enough.
    const n = nets({ ann: 800, ben: 700, cam: -800, dee: 200, eve: -900 });
    const payments = settleUp(n);
    expect(payments.length).toBe(3);
    expect(settles(n, payments)).toBe(true);
  });

  it("rejects results that don't balance", () => {
    expect(() => settleUp(nets({ a: 100, b: -50 }))).toThrow();
  });

  it("settles random tables exactly, in at most k − 1 payments", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 300; run++) {
      const k = 2 + Math.floor(rand() * 9);
      const values: number[] = [];
      for (let i = 0; i < k - 1; i++) values.push(5 * (Math.floor(rand() * 41) - 20));
      values.push(-values.reduce((s, x) => s + x, 0));
      const n = values.map((net, i) => ({ playerId: `p${i}`, net }));
      const payments = settleUp(n);
      expect(settles(n, payments), JSON.stringify(n)).toBe(true);
      const nonZero = values.filter((v) => v !== 0).length;
      expect(payments.length <= Math.max(0, nonZero - 1), JSON.stringify(n)).toBe(true);
    }
  });

  it("handles large tables with the fallback", () => {
    const n = Array.from({ length: 24 }, (_, i) => ({ playerId: `p${i}`, net: i < 12 ? 100 : -100 }));
    const payments = settleUp(n);
    expect(settles(n, payments)).toBe(true);
  });
});

describe("settlement", () => {
  it("returns nets and payments together", () => {
    const s = run([create(), join("a", 1), join("b", 2), start(1), fold("a")]);
    expect(settlement(s)).toEqual({
      nets: [{ playerId: "a", net: -10 }, { playerId: "b", net: 10 }],
      payments: [{ from: "a", to: "b", amount: 10 }],
    });
  });
});
