import { describe, it, expect } from "vitest";
import { applyEvent, replay } from "../replay";
import { create, join, start, fold, check, call, raise, ev, run, rejection, stacks } from "./helpers";

const setup = () => [create(), join("a", 1), join("b", 2), join("c", 3), start(3)];

describe("replay", () => {
  it("starts empty and requires game_created first", () => {
    expect(replay([])).toEqual({ state: null, error: null });
    const result = replay([join("a", 1)]);
    expect(result.state).toBeNull();
    expect(result.error!.index).toBe(0);
    expect(rejection([create(), create()])).toContain("already been created");
  });

  it("stops at the first invalid event and returns the state just before it", () => {
    const events = [...setup(), call("c"), check("c"), fold("a")];
    const { state, error } = replay(events);
    expect(error).toEqual({ eventId: events[6]!.id, index: 6, message: "It's A's turn, not C's" });
    // State reflects c's call but nothing after the bad event.
    expect(state!.hand!.toAct).toBe("a");
    expect(stacks(state!)).toEqual({ a: 990, b: 975, c: 975 });
  });

  it("calls store no amount, so editing an earlier raise adjusts the call", () => {
    const original = [...setup(), raise("c", 100), call("a")];
    expect(run(original).players.a!.stack).toBe(900);

    const edited = [...original];
    edited[5] = { ...edited[5]!, action: { kind: "raise", to: 200 } } as typeof edited[5];
    expect(run(edited).players.a!.stack).toBe(800);
  });

  it("an edit can make a later event invalid; it's reported, never skipped", () => {
    const events = [...setup(), call("c"), call("a"), check("b")];
    events[5] = raise("c", 100); // now b faces a raise and can't check
    const { error } = replay(events);
    expect(error!.index).toBe(7);
    expect(error!.message).toContain("can't check");
  });

  it("undo is just dropping the last event", () => {
    const events = [...setup(), fold("c"), fold("a")];
    const undone = run(events.slice(0, -1));
    expect(undone.hand!.phase).toBe("betting");
    expect(undone.hand!.toAct).toBe("a");
  });

  it("applyEvent never mutates its input", () => {
    const before = run(setup());
    const snapshot = JSON.stringify(before);
    applyEvent(before, raise("c", 100));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const events = [...setup(), raise("c", 100), call("a"), fold("b")];
    expect(JSON.stringify(run(events))).toBe(JSON.stringify(run(events)));
  });
});

describe("table events", () => {
  it("validates joins", () => {
    expect(rejection([create(), join("a", 1), join("a", 2)])).toContain("already exists");
    expect(rejection([create(), join("a", 11)])).toContain("between 1 and 10");
    expect(rejection([create(), join("a", 1, 33)])).toContain("multiple");
    expect(rejection([create(), join("a", 1, 0)])).toContain("more than zero");
    expect(rejection([create(), ev({ type: "player_joined", playerId: "a", name: "x".repeat(41), seat: 1, buyIn: 100 })])).toContain("up to 40 characters");
  });

  it("frees a seat when a player leaves, and keeps their stack for settlement", () => {
    const s = run([create(), join("a", 1, 500), ev({ type: "player_left", playerId: "a" }), join("b", 1)]);
    expect(s.players.a!.status).toBe("left");
    expect(s.players.a!.stack).toBe(500);
    expect(s.players.b!.seat).toBe(1);
    expect(rejection([create(), join("a", 1), ev({ type: "player_left", playerId: "a" }),
      ev({ type: "rebuy", playerId: "a", amount: 100 })])).toContain("has left");
  });

  it("validates sit out / return", () => {
    expect(rejection([create(), join("a", 1), ev({ type: "player_returned", playerId: "a" })])).toContain("isn't sitting out");
    expect(rejection([create(), join("a", 1), ev({ type: "player_sat_out", playerId: "a" }),
      ev({ type: "player_sat_out", playerId: "a" })])).toContain("already sitting out");
  });

  it("validates the config", () => {
    expect(rejection([create(10, 23)])).toContain("Big blind");
    expect(rejection([create(25, 10)])).toContain("can't be smaller");
  });

  it("ending the game waits for the hand and blocks everything after", () => {
    expect(rejection([...setup(), ev({ type: "game_ended" })])).toContain("during a hand");
    const ended = [...setup(), fold("c"), fold("a"), ev({ type: "game_ended" })];
    expect(run(ended).status).toBe("ended");
    expect(rejection([...ended, start(1)])).toContain("has ended");
  });
});
