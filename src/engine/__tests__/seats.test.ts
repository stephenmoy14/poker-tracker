import { describe, it, expect } from "vitest";
import { seatAfter } from "../seats";
import { suggestButtonSeat } from "../hand";
import { describeLog } from "../describe";
import { create, join, start, fold, call, raise, ev, run, rejection } from "./helpers";

const seats = (s: ReturnType<typeof run>) =>
  Object.fromEntries(Object.values(s.players).filter((p) => p.status !== "left").map((p) => [p.id, p.seat]));

describe("sitting between players", () => {
  it("uses an empty seat number between them when there is one", () => {
    const s = run([create(), join("a", 1), join("c", 3)]);
    expect(seatAfter(s, "a")).toBe(2);
    expect(seats(run([create(), join("a", 1), join("c", 3), join("b", 2)]))).toEqual({ a: 1, c: 3, b: 2 });
  });

  it("squeezes in, moving the players after up one seat", () => {
    const base = [create(), join("a", 1), join("b", 2), join("c", 3)];
    expect(seatAfter(run(base), "a")).toBe(2);
    expect(seats(run([...base, join("n", 2)]))).toEqual({ a: 1, n: 2, b: 3, c: 4 });
  });

  it("only moves players up to the next empty seat", () => {
    const s = run([create(), join("a", 1), join("b", 2), join("c", 3), join("d", 6), join("n", 2)]);
    expect(seats(s)).toEqual({ a: 1, n: 2, b: 3, c: 4, d: 6 });
  });

  it("between the last and first player wraps around the table", () => {
    const s = run([create(10, 25, 4), join("a", 2), join("b", 3), join("c", 4)]);
    expect(seatAfter(s, "c")).toBe(1);
  });

  it("moves players down when there's no room above", () => {
    // 4 seats: 2, 3, 4 taken. Squeezing in between seat 3 and seat 4.
    const base = [create(10, 25, 4), join("a", 2), join("b", 3), join("c", 4)];
    expect(seatAfter(run(base), "b")).toBe(4);
    expect(seats(run([...base, join("n", 4)]))).toEqual({ a: 1, b: 2, n: 3, c: 4 });
  });

  it("rejects a full table", () => {
    expect(rejection([create(10, 25, 2), join("a", 1), join("b", 2), join("c", 1)])).toContain("full");
  });

  it("the button keeps rotating as if the newcomer had always been there", () => {
    // Hand 1: button c (seat 3). Newcomer squeezes in between a and b.
    const s = run([
      create(), join("a", 1), join("b", 2), join("c", 3), start(3), fold("c"), fold("a"),
      join("n", 2),
    ]);
    expect(seats(s)).toEqual({ a: 1, n: 2, b: 3, c: 4 });
    expect(s.lastButtonSeat).toBe(4); // still c
    expect(suggestButtonSeat(s)).toBe(1); // next is a, as before
    expect(s.hand!.buttonSeat).toBe(4); // the finished hand's display moved too
  });

  it("someone can join mid-hand; they're dealt in from the next hand", () => {
    const events = [
      create(), join("a", 1), join("b", 2), join("c", 3), start(3),
      join("n", 2),                     // squeezes in during the hand
      raise("c", 100), call("a"), fold("b"),
    ];
    const s = run(events);
    expect(s.hand!.players.map((p) => p.playerId)).toEqual(["a", "b", "c"]);
    expect(s.hand!.buttonSeat).toBe(4);
    expect(s.hand!.bigBlindSeat).toBe(3);
    expect(s.hand!.street).toBe("flop");
  });
});

describe("chip games", () => {
  const chips = () =>
    ev({ type: "game_created", config: { smallBlind: 25, bigBlind: 50, unit: 1, currency: "USD", maxSeats: 9, format: "chips" } });

  it("uses whole chips and shows plain numbers", () => {
    const events = [chips(), join("a", 1, 5000), join("b", 2, 5000), start(1), raise("a", 150), call("b")];
    const s = run(events);
    expect(s.players.a!.stack).toBe(4850);
    const lines = describeLog(events).entries.flatMap((e) => e.lines.map((l) => l.text));
    expect(lines).toContain("Game created · blinds 25 / 50 chips");
    expect(lines).toContain("A joins in seat 1 with 5,000");
    expect(lines).toContain("A raises to 150");
    expect(lines).toContain("B calls 100");
  });

  it("explains errors in chips", () => {
    expect(rejection([chips(), join("a", 1, 5000), join("b", 2, 5000), start(1), raise("a", 60)])).toBe(
      "Raise to 60 is below the minimum of 100",
    );
    expect(rejection([chips(), join("a", 1, 2.5)])).toContain("whole number of chips");
  });

  it("rejects an unknown format", () => {
    expect(
      rejection([ev({ type: "game_created", config: { smallBlind: 1, bigBlind: 2, unit: 1, currency: "USD", maxSeats: 9, format: "beans" as "chips" } })]),
    ).toContain("money or chips");
  });
});
