import { describe, it, expect } from "vitest";
import { legalActions, suggestButtonSeat } from "../hand";
import {
  create, join, start, fold, check, call, bet, raise, award, fast, ev, run, rejection, stacks,
} from "./helpers";

// Blinds $0.10 / $0.25. Three players, button on seat 3:
// seat order left of the button is a (SB), b (BB), c (button).
const three = () => [create(), join("a", 1), join("b", 2), join("c", 3), start(3)];

describe("starting a hand", () => {
  it("posts blinds automatically and starts action left of the big blind", () => {
    const s = run(three());
    const hand = s.hand!;
    expect(stacks(s)).toEqual({ a: 990, b: 975, c: 1000 });
    expect(hand.smallBlindSeat).toBe(1);
    expect(hand.bigBlindSeat).toBe(2);
    expect(hand.players.map((p) => p.playerId)).toEqual(["a", "b", "c"]);
    expect(hand.currentBet).toBe(25);
    expect(hand.toAct).toBe("c");
  });

  it("heads-up: the button posts the small blind and acts first preflop only", () => {
    let s = run([create(), join("a", 1), join("b", 2), start(1)]);
    expect(stacks(s)).toEqual({ a: 990, b: 975 });
    expect(s.hand!.toAct).toBe("a");
    s = run([create(), join("a", 1), join("b", 2), start(1), call("a"), check("b")]);
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.toAct).toBe("b");
  });

  it("a short big blind posts what it has; others call what's really in", () => {
    const s = run([create(), join("a", 1), join("b", 2, 15), join("c", 3), start(3)]);
    expect(s.hand!.players[1]!.allIn).toBe(true);
    expect(s.hand!.currentBet).toBe(15);
    expect(legalActions(s)!.callAmount).toBe(15);
  });

  it("rejects a button on an empty, sitting-out or broke seat", () => {
    expect(rejection([create(), join("a", 1), join("b", 2), start(5)])).toContain("Seat 5");
    expect(
      rejection([create(), join("a", 1), join("b", 2), join("c", 3),
        ev({ type: "player_sat_out", playerId: "c" }), start(3)]),
    ).toContain("Seat 3");
  });

  it("needs two players with chips", () => {
    expect(rejection([create(), join("a", 1), start(1)])).toContain("two players");
  });
});

describe("betting rounds", () => {
  it("everyone folds to the big blind: uncalled bet returned, pot auto-awarded", () => {
    const s = run([...three(), fold("c"), fold("a")]);
    const hand = s.hand!;
    expect(hand.phase).toBe("complete");
    expect(hand.uncalledReturn).toEqual({ playerId: "b", amount: 15 });
    expect(hand.awards).toEqual([{ potIndex: 0, payouts: { b: 20 } }]);
    expect(stacks(s)).toEqual({ a: 990, b: 1010, c: 1000 });
    expect(s.handsPlayed).toBe(1);
  });

  it("the big blind gets the option after limps", () => {
    const s = run([...three(), call("c"), call("a")]);
    expect(s.hand!.toAct).toBe("b");
    expect(legalActions(s)).toEqual({
      canFold: true, canCheck: true, callAmount: 0, minBetOrRaiseTo: 50, maxBetOrRaiseTo: 1000,
    });
    const after = run([...three(), call("c"), call("a"), check("b")]);
    expect(after.hand!.street).toBe("flop");
    expect(after.hand!.currentBet).toBe(0);
    expect(after.hand!.toAct).toBe("a"); // first player left of the button
  });

  it("plays a full hand to showdown and splits the pot with the odd chip", () => {
    const s = run([
      ...three(), call("c"), call("a"), check("b"),
      check("a"), check("b"), check("c"),          // flop
      bet("a", 50), call("b"), fold("c"),          // turn
      check("a"), check("b"),                      // river
    ]);
    const hand = s.hand!;
    expect(hand.street).toBe("showdown");
    expect(hand.phase).toBe("awarding");
    expect(hand.pots).toEqual([{ amount: 175, eligible: ["a", "b"] }]);

    const done = run([
      ...three(), call("c"), call("a"), check("b"),
      check("a"), check("b"), check("c"),
      bet("a", 50), call("b"), fold("c"),
      check("a"), check("b"),
      award(0, ["a", "b"]),
    ]);
    // $1.75 = 35 units: a (first left of the button) gets 18, b gets 17.
    expect(stacks(done)).toEqual({ a: 1015, b: 1010, c: 975 });
    expect(done.hand!.phase).toBe("complete");
  });

  it("checks turn order and check/call legality", () => {
    expect(rejection([...three(), call("a")])).toContain("C's turn");
    expect(rejection([...three(), check("c")])).toContain("can't check");
    expect(rejection([...three(), call("c"), call("a"), call("b")])).toContain("nothing to call");
  });
});

describe("bet and raise sizes", () => {
  it("stores 'raise to' and enforces the minimum raise", () => {
    expect(rejection([...three(), raise("c", 40)])).toContain("minimum of $0.50");
    expect(rejection([...three(), bet("c", 100)])).toContain("raise instead");
    expect(rejection([...three(), raise("c", 33)])).toContain("multiple");

    const s = run([...three(), raise("c", 100)]);
    expect(s.hand!.lastRaiseSize).toBe(75);
    expect(legalActions(s)!.minBetOrRaiseTo).toBe(175);
    expect(legalActions(s)!.callAmount).toBe(90);
    expect(rejection([...three(), raise("c", 100), raise("a", 150)])).toContain("minimum of $1.75");
  });

  it("can't bet more than the stack", () => {
    expect(rejection([...three(), raise("c", 1005)])).toContain("only has enough");
  });

  it("minimum bet after the flop is the big blind", () => {
    const flop = [...three(), call("c"), call("a"), check("b")];
    expect(legalActions(run(flop))!.minBetOrRaiseTo).toBe(25);
    expect(rejection([...flop, bet("a", 20)])).toContain("minimum of $0.25");
    expect(rejection([...flop, raise("a", 50)])).toContain("bet instead");
  });
});

describe("short all-in raises", () => {
  // a SB, b BB, c, d (button, only $1.50).
  const four = (dStack: number) => [
    create(), join("a", 1), join("b", 2), join("c", 3), join("d", 4, dStack), start(4),
  ];

  it("don't reopen betting for players who already acted", () => {
    const base = [...four(150), raise("c", 100), raise("d", 150)]; // d all-in: +50 < 75
    let s = run(base);
    // a and b haven't acted yet, so they may still raise (min = 150 + 75).
    expect(legalActions(s)!.minBetOrRaiseTo).toBe(225);

    s = run([...base, fold("a"), call("b")]);
    expect(s.hand!.toAct).toBe("c");
    const legal = legalActions(s)!;
    expect(legal.callAmount).toBe(50);
    expect(legal.minBetOrRaiseTo).toBeNull();
    expect(rejection([...base, fold("a"), call("b"), raise("c", 400)])).toContain("only call or fold");

    s = run([...base, fold("a"), call("b"), call("c")]);
    expect(s.hand!.street).toBe("flop");
  });

  it("a full all-in raise does reopen betting", () => {
    const s = run([...four(200), raise("c", 100), raise("d", 200), fold("a"), call("b")]);
    expect(s.hand!.toAct).toBe("c");
    expect(legalActions(s)!.minBetOrRaiseTo).toBe(300);
  });
});

describe("all-ins and side pots", () => {
  it("runs out the board when everyone is all-in and returns the uncalled bet", () => {
    const s = run([
      create(), join("a", 1), join("b", 2, 300), start(1), raise("a", 1000), call("b"),
    ]);
    const hand = s.hand!;
    expect(hand.street).toBe("showdown");
    expect(hand.toAct).toBeNull();
    expect(hand.uncalledReturn).toEqual({ playerId: "a", amount: 700 });
    expect(hand.pots).toEqual([{ amount: 600, eligible: ["b", "a"] }]);
  });

  it("asks nobody to act when only one player has chips and owes nothing", () => {
    // a (button/SB) is all-in for the small blind; b's big blind covers it.
    const s = run([create(), join("a", 1, 10), join("b", 2), start(1)]);
    expect(s.hand!.phase).toBe("awarding");
    expect(s.hand!.uncalledReturn).toEqual({ playerId: "b", amount: 15 });
    expect(s.hand!.pots).toEqual([{ amount: 20, eligible: ["b", "a"] }]);
  });

  it("auto-awards a side pot only one player can win, then the host awards the rest", () => {
    // a SB (only $1), b BB, c button.
    const events = [
      create(), join("a", 1, 100), join("b", 2), join("c", 3), start(3),
      raise("c", 400), call("a"), call("b"),   // a all-in for $1
      bet("b", 500), fold("c"),                // flop
    ];
    const s = run(events);
    const hand = s.hand!;
    expect(hand.uncalledReturn).toEqual({ playerId: "b", amount: 500 });
    expect(hand.pots).toEqual([
      { amount: 300, eligible: ["a", "b"] },
      { amount: 600, eligible: ["b"] },
    ]);
    expect(hand.awards).toEqual([{ potIndex: 1, payouts: { b: 600 } }]);
    expect(hand.phase).toBe("awarding");

    expect(rejection([...events, award(1, ["b"])])).toContain("next is the main pot");
    expect(rejection([...events, award(0, ["c"])])).toContain("not eligible");

    const done = run([...events, award(0, ["a"])]);
    expect(stacks(done)).toEqual({ a: 300, b: 1200, c: 600 });
    expect(done.hand!.phase).toBe("complete");
  });
});

describe("fast entry", () => {
  it("records totals, ends betting and builds the pots", () => {
    const s = run([
      ...three(),
      fast([
        { playerId: "a", contributed: 10, folded: true },
        { playerId: "b", contributed: 200, folded: false },
        { playerId: "c", contributed: 200, folded: false },
      ]),
    ]);
    const hand = s.hand!;
    expect(hand.mode).toBe("fast_entry");
    expect(hand.street).toBe("showdown");
    expect(hand.pots).toEqual([{ amount: 410, eligible: ["b", "c"] }]);
    expect(stacks(s)).toEqual({ a: 990, b: 800, c: 800 });
  });

  it("can follow normal actions", () => {
    const s = run([
      ...three(), raise("c", 100), fold("a"),
      fast([
        { playerId: "a", contributed: 10, folded: true },
        { playerId: "b", contributed: 100, folded: true },
        { playerId: "c", contributed: 100, folded: false },
      ]),
    ]);
    expect(s.hand!.phase).toBe("complete");
    expect(stacks(s)).toEqual({ a: 990, b: 900, c: 1110 });
  });

  it("rejects entries that don't add up", () => {
    const e = (a: number, b: number, c: number, aFold = false) =>
      fast([
        { playerId: "a", contributed: a, folded: aFold },
        { playerId: "b", contributed: b, folded: false },
        { playerId: "c", contributed: c, folded: false },
      ]);
    expect(rejection([...three(), e(5, 200, 200, true)])).toContain("already put in");
    expect(rejection([...three(), e(10, 200, 150, true)])).toContain("without being all-in");
    expect(rejection([...three(), e(10, 200, 2000, true)])).toContain("only has");
    expect(rejection([...three(), raise("c", 100), fold("a"), e(100, 100, 100)])).toContain("already folded");
    expect(
      rejection([...three(), fast([{ playerId: "a", contributed: 10, folded: true }])]),
    ).toContain("Missing");
  });
});

describe("between hands", () => {
  it("rebuys and sitting out wait until the hand is over", () => {
    expect(rejection([...three(), ev({ type: "rebuy", playerId: "a", amount: 500 })])).toContain("during a hand");
    expect(rejection([...three(), ev({ type: "player_sat_out", playerId: "a" })])).toContain("during a hand");
    const s = run([...three(), fold("c"), fold("a"), ev({ type: "rebuy", playerId: "a", amount: 500 })]);
    expect(s.players.a!.totalBuyIn).toBe(1500);
  });

  it("suggests the next button, skipping sitting-out and broke players", () => {
    const afterHand = [...three(), fold("c"), fold("a")];
    expect(suggestButtonSeat(run(afterHand))).toBe(1);
    expect(
      suggestButtonSeat(run([...afterHand, ev({ type: "player_sat_out", playerId: "a" })])),
    ).toBe(2);
  });

  it("sitting-out and broke players aren't dealt in; returning is free", () => {
    const sat = run([
      create(), join("a", 1), join("b", 2), join("c", 3), join("d", 4),
      ev({ type: "player_sat_out", playerId: "c" }), start(1),
    ]);
    expect(sat.hand!.players.map((p) => p.playerId)).toEqual(["b", "d", "a"]);

    // b is all-in in the big blind and loses everything, then is skipped.
    const broke = run([
      create(), join("a", 1), join("b", 2, 25), join("c", 3), start(3),
      call("c"), fold("a"), award(0, ["c"]),
      start(1),
    ]);
    expect(broke.players.b!.stack).toBe(0);
    expect(broke.hand!.players.map((p) => p.playerId)).toEqual(["c", "a"]);

    const back = run([
      create(), join("a", 1), join("b", 2), join("c", 3),
      ev({ type: "player_sat_out", playerId: "c" }), ev({ type: "player_returned", playerId: "c" }),
      start(3),
    ]);
    expect(back.players.c!.stack).toBe(1000); // no missed blinds charged
  });
});
