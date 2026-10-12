import { describe, it, expect } from "vitest";
import { computePots, type Contribution } from "../pots";

// Amounts are in cents. Players are listed in seat order, left of the button first.
const p = (playerId: string, amount: number, folded = false): Contribution => ({
  playerId,
  amount,
  folded,
});

describe("computePots", () => {
  it("simple hand, no all-ins: one pot", () => {
    const result = computePots([p("sb", 10, true), p("a", 100), p("b", 100), p("c", 100)]);
    expect(result.uncalled).toBeNull();
    expect(result.pots).toEqual([{ amount: 310, eligible: ["a", "b", "c"] }]);
  });

  it("one short all-in: main pot and one side pot", () => {
    const result = computePots([p("a", 50), p("b", 200), p("c", 200)]);
    expect(result.uncalled).toBeNull();
    expect(result.pots).toEqual([
      { amount: 150, eligible: ["a", "b", "c"] },
      { amount: 300, eligible: ["b", "c"] },
    ]);
  });

  it("two all-ins at different amounts: main pot and two side pots", () => {
    const result = computePots([p("a", 50), p("b", 120), p("c", 300), p("d", 300)]);
    expect(result.pots).toEqual([
      { amount: 200, eligible: ["a", "b", "c", "d"] },
      { amount: 210, eligible: ["b", "c", "d"] },
      { amount: 360, eligible: ["c", "d"] },
    ]);
  });

  it("folded player's chips stay in the pots but they are never eligible", () => {
    const result = computePots([p("a", 50), p("folder", 80, true), p("b", 200), p("d", 200)]);
    expect(result.pots).toEqual([
      { amount: 200, eligible: ["a", "b", "d"] },
      { amount: 330, eligible: ["b", "d"] },
    ]);
  });

  it("returns an uncalled bet over an all-in", () => {
    const result = computePots([p("a", 1000), p("b", 400)]);
    expect(result.uncalled).toEqual({ playerId: "a", amount: 600 });
    expect(result.pots).toEqual([{ amount: 800, eligible: ["a", "b"] }]);
  });

  it("returns an uncalled bet when everyone folds to it", () => {
    const result = computePots([p("a", 300), p("b", 100, true)]);
    expect(result.uncalled).toEqual({ playerId: "a", amount: 200 });
    expect(result.pots).toEqual([{ amount: 200, eligible: ["a"] }]);
  });

  it("everyone folds preflop to the big blind", () => {
    const result = computePots([
      p("sb", 10, true),
      p("bb", 25),
      p("utg", 0, true),
      p("btn", 0, true),
    ]);
    expect(result.uncalled).toEqual({ playerId: "bb", amount: 15 });
    expect(result.pots).toEqual([{ amount: 20, eligible: ["bb"] }]);
  });

  it("no uncalled bet when the top amount is matched", () => {
    expect(computePots([p("a", 500), p("b", 500), p("c", 200)]).uncalled).toBeNull();
  });

  it("matches the worked example from the design notes", () => {
    const result = computePots([
      p("alex", 200),
      p("eve", 300, true),
      p("ben", 500),
      p("dee", 1000),
      p("cam", 1200),
    ]);
    expect(result.uncalled).toEqual({ playerId: "cam", amount: 200 });
    expect(result.pots).toEqual([
      { amount: 1000, eligible: ["alex", "ben", "dee", "cam"] },
      { amount: 1000, eligible: ["ben", "dee", "cam"] },
      { amount: 1000, eligible: ["dee", "cam"] },
    ]);
  });

  it("folded chips above the highest live amount go into the top pot", () => {
    const result = computePots([p("a", 100), p("b", 300, true), p("c", 300, true)]);
    expect(result.uncalled).toBeNull();
    expect(result.pots).toEqual([{ amount: 700, eligible: ["a"] }]);
  });

  it("keeps eligible players in seat order", () => {
    const result = computePots([p("z", 100), p("m", 100), p("a", 100)]);
    expect(result.pots[0]!.eligible).toEqual(["z", "m", "a"]);
  });

  it("rejects invalid input", () => {
    expect(() => computePots([])).toThrow();
    expect(() => computePots([p("a", 100, true), p("b", 100, true)])).toThrow();
    expect(() => computePots([p("a", 100), p("a", 100)])).toThrow();
    expect(() => computePots([p("a", -5), p("b", 100)])).toThrow();
    expect(() => computePots([p("a", 2.5), p("b", 100)])).toThrow();
  });
});
