import { describe, it, expect } from "vitest";
import { amountToInput, centsToInput, clampToUnit, parseAmount, parseDollars } from "../money";
import { rejectionReason, removeAt, replaceAt, stamp, strip, undoLast } from "../log";
import { replay } from "../../engine/replay";
import type { GameEvent } from "../../engine/types";

describe("parseDollars", () => {
  it("reads common ways of typing money", () => {
    expect(parseDollars("1.25")).toBe(125);
    expect(parseDollars("$1.25")).toBe(125);
    expect(parseDollars(" 20 ")).toBe(2000);
    expect(parseDollars(".5")).toBe(50);
    expect(parseDollars("3.")).toBe(300);
    expect(parseDollars("1,000")).toBe(100000);
    expect(parseDollars("0")).toBe(0);
  });

  it("rejects anything else", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars(".")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(parseDollars("-1")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });

  it("round-trips with centsToInput", () => {
    for (const c of [0, 5, 10, 125, 2000, 99995]) expect(parseDollars(centsToInput(c))).toBe(c);
    expect(centsToInput(2000)).toBe("20");
    expect(centsToInput(125)).toBe("1.25");
  });

  it("clamps to the unit and range", () => {
    expect(clampToUnit(123, 5, 50, 1000)).toBe(120);
    expect(clampToUnit(10, 5, 50, 1000)).toBe(50);
    expect(clampToUnit(5000, 5, 50, 1000)).toBe(1000);
  });
});

describe("parseAmount (money or chips)", () => {
  const money = { format: "money" as const, currency: "USD" };
  const chips = { format: "chips" as const, currency: "USD" };
  it("money games read dollars", () => {
    expect(parseAmount("1.25", money)).toBe(125);
    expect(amountToInput(125, money)).toBe("1.25");
  });
  it("chip games read whole chips", () => {
    expect(parseAmount("500", chips)).toBe(500);
    expect(parseAmount("1,500", chips)).toBe(1500);
    expect(parseAmount("2.5", chips)).toBeNull();
    expect(parseAmount("", chips)).toBeNull();
    expect(amountToInput(1500, chips)).toBe("1500");
  });
  it("games saved before chip mode default to money", () => {
    expect(parseAmount("1.25", { currency: "USD" })).toBe(125);
  });
});

describe("event log operations", () => {
  const created = stamp({
    type: "game_created",
    config: { smallBlind: 10, bigBlind: 25, unit: 5, currency: "USD", maxSeats: 10 },
  });
  const ann = stamp({ type: "player_joined", playerId: "ann", name: "Ann", seat: 1, buyIn: 1000 });
  const rebuy = stamp({ type: "rebuy", playerId: "ann", amount: 500 });
  const log: GameEvent[] = [created, ann, rebuy];

  it("gives every event a unique id", () => {
    expect(new Set(log.map((e) => e.id)).size).toBe(3);
  });

  it("undo drops the last event", () => {
    expect(undoLast(log)).toEqual([created, ann]);
  });

  it("edit keeps the id and time and replays with the new value", () => {
    const edited = replaceAt(log, 2, { type: "rebuy", playerId: "ann", amount: 2000 });
    expect(edited[2]!.id).toBe(rebuy.id);
    expect(edited[2]!.at).toBe(rebuy.at);
    expect(replay(edited).state!.players.ann!.stack).toBe(3000);
    expect(log[2]).toBe(rebuy); // original untouched
  });

  it("strip + replaceAt round-trips", () => {
    expect(replaceAt(log, 1, strip(ann))).toEqual(log);
  });

  it("delete removes an event, but not the game itself", () => {
    expect(removeAt(log, 2)).toEqual([created, ann]);
    expect(() => removeAt(log, 0)).toThrow();
    expect(() => removeAt(log, 9)).toThrow();
  });

  it("rejectionReason explains without changing anything", () => {
    const state = replay(log).state;
    expect(rejectionReason(state, stamp({ type: "rebuy", playerId: "ann", amount: 33 }))).toContain("multiple");
    expect(rejectionReason(state, stamp({ type: "rebuy", playerId: "ann", amount: 100 }))).toBeNull();
    expect(replay(log).state).toEqual(state);
  });
});
