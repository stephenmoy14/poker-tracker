import { describe, it, expect } from "vitest";
import { splitPot, awardPot } from "../award";
import { computePots } from "../pots";

const UNIT = 5; // $0.05

describe("splitPot", () => {
  it("single winner takes the whole pot", () => {
    expect(splitPot(1000, ["a"], ["a", "b"], UNIT)).toEqual({ a: 1000 });
  });

  it("splits evenly when it divides", () => {
    expect(splitPot(1000, ["a", "b"], ["a", "b"], UNIT)).toEqual({ a: 500, b: 500 });
  });

  it("odd chip goes to the first tied winner left of the button", () => {
    // $0.35 = 7 units; Ben sits before Alex in seat order.
    expect(splitPot(35, ["alex", "ben"], ["ben", "carl", "alex"], UNIT)).toEqual({
      ben: 20,
      alex: 15,
    });
  });

  it("several leftover units are dealt one at a time from the button", () => {
    // $0.25 = 5 units, three winners: 2, 2, 1 units.
    expect(splitPot(25, ["c", "a", "b"], ["a", "b", "c"], UNIT)).toEqual({ a: 10, b: 10, c: 5 });
  });

  it("rejects bad input", () => {
    expect(() => splitPot(33, ["a"], ["a"], UNIT)).toThrow(); // not a multiple of $0.05
    expect(() => splitPot(100, [], ["a"], UNIT)).toThrow();
    expect(() => splitPot(100, ["a", "a"], ["a"], UNIT)).toThrow();
    expect(() => splitPot(100, ["x"], ["a"], UNIT)).toThrow();
  });
});

describe("awardPot", () => {
  it("rejects a winner who isn't eligible for the pot", () => {
    const pot = { amount: 300, eligible: ["b", "c"] };
    expect(() => awardPot(pot, ["a"], ["a", "b", "c"], UNIT)).toThrow();
  });

  it("all-in player wins the main pot but loses the side pot", () => {
    const seats = ["a", "b", "c"];
    const { pots } = computePots([
      { playerId: "a", amount: 50, folded: false },
      { playerId: "b", amount: 200, folded: false },
      { playerId: "c", amount: 200, folded: false },
    ]);
    // Awarded last side pot first, main pot last.
    const side = awardPot(pots[1]!, ["b"], seats, UNIT);
    const main = awardPot(pots[0]!, ["a"], seats, UNIT);
    expect(side).toEqual({ b: 300 });
    expect(main).toEqual({ a: 150 });
  });
});
