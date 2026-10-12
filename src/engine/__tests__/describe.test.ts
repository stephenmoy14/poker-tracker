import { describe, it, expect } from "vitest";
import { describeLog } from "../describe";
import { create, join, start, fold, check, call, bet, raise, award, fast, ev } from "./helpers";

/** All lines as "event: text" / "auto: text" for easy comparison. */
const lines = (events: Parameters<typeof describeLog>[0]) =>
  describeLog(events).entries.flatMap((e) => e.lines.map((l) => `${l.kind}: ${l.text}`));

const table = () => [create(), join("ann", 1), join("ben", 2), join("cam", 3)];

describe("describeLog", () => {
  it("describes setup events", () => {
    expect(lines([
      ...table(),
      ev({ type: "rebuy", playerId: "ann", amount: 500 }),
      ev({ type: "player_sat_out", playerId: "cam" }),
      ev({ type: "player_returned", playerId: "cam" }),
      ev({ type: "player_left", playerId: "cam" }),
      ev({ type: "game_ended" }),
    ])).toEqual([
      "event: Game created · blinds $0.10 / $0.25",
      "event: ANN joins in seat 1 with $10.00",
      "event: BEN joins in seat 2 with $10.00",
      "event: CAM joins in seat 3 with $10.00",
      "event: ANN rebuys $5.00",
      "event: CAM sits out",
      "event: CAM is back",
      "event: CAM leaves with $10.00",
      "event: Game over",
    ]);
  });

  it("describes a hand with blinds, streets, derived call amounts and a split", () => {
    const out = lines([
      ...table(), start(3),
      raise("cam", 100), call("ann"), fold("ben"),
      bet("ann", 200), call("cam"),                   // flop
      check("ann"), check("cam"),                     // turn
      check("ann"), check("cam"),                     // river
      award(0, ["ann", "cam"]),
    ]).slice(4);
    expect(out).toEqual([
      "event: Hand #1 · CAM has the button",
      "auto: ANN posts SB $0.10",
      "auto: BEN posts BB $0.25",
      "event: CAM raises to $1.00",
      "event: ANN calls $0.90",
      "event: BEN folds",
      "auto: Flop",
      "event: ANN bets $2.00",
      "event: CAM calls $2.00",
      "auto: Turn",
      "event: ANN checks",
      "event: CAM checks",
      "auto: River",
      "event: ANN checks",
      "event: CAM checks",
      "auto: Showdown",
      "auto: Main pot $6.25 · ANN, CAM",
      "event: ANN and CAM split the pot ($6.25): ANN $3.15, CAM $3.10",
    ]);
  });

  it("describes a fold-around win with the uncalled bet returned", () => {
    expect(lines([...table(), start(3), fold("cam"), fold("ann")]).slice(-4)).toEqual([
      "event: CAM folds",
      "event: ANN folds",
      "auto: $0.15 uncalled, returned to BEN",
      "auto: BEN wins the pot ($0.20)",
    ]);
  });

  it("describes all-ins, the run-out, side pots and automatic awards", () => {
    const out = lines([
      create(), join("ann", 1, 100), join("ben", 2), join("cam", 3), start(3),
      raise("cam", 400), call("ann"), call("ben"),
      bet("ben", 500), fold("cam"),
      award(0, ["ann"]),
    ]).slice(-12);
    expect(out).toEqual([
      "event: BEN calls $3.75",
      "auto: Flop",
      "event: BEN bets $5.00",
      "event: CAM folds",
      "auto: Turn (no more betting)",
      "auto: River",
      "auto: Showdown",
      "auto: $5.00 uncalled, returned to BEN",
      "auto: Main pot $3.00 · ANN, BEN",
      "auto: Side pot 1 $6.00 · BEN",
      "auto: BEN wins side pot 1 ($6.00)",
      "event: ANN wins the main pot ($3.00)",
    ]);

    const runout = lines([create(), join("ann", 1), join("ben", 2, 300), start(1), raise("ann", 1000), call("ben")]);
    expect(runout.slice(-8)).toEqual([
      "event: ANN raises to $10.00 (all-in)",
      "event: BEN calls $2.75 (all-in)",
      "auto: Flop (no more betting)",
      "auto: Turn",
      "auto: River",
      "auto: Showdown",
      "auto: $7.00 uncalled, returned to ANN",
      "auto: Main pot $6.00 · BEN, ANN",
    ]);
  });

  it("describes quick entry", () => {
    const out = lines([
      ...table(), start(3),
      fast([
        { playerId: "ann", contributed: 10, folded: true },
        { playerId: "ben", contributed: 200, folded: false },
        { playerId: "cam", contributed: 200, folded: false },
      ]),
    ]).slice(-3);
    expect(out).toEqual([
      "event: Quick entry: ANN $0.10 (folded), BEN $2.00, CAM $2.00",
      "auto: Showdown",
      "auto: Main pot $4.10 · BEN, CAM",
    ]);
  });

  it("tags entries with their hand and stops at an invalid event", () => {
    const log = describeLog([...table(), start(3), check("cam")]);
    expect(log.entries.map((e) => e.handNumber)).toEqual([null, null, null, null, 1]);
    expect(log.error!.index).toBe(5);
  });
});
