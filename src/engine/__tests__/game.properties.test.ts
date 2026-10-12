import { describe, it, expect } from "vitest";
import type { GameEvent, GameState, PlayerAction } from "../types";
import { applyEvent, replay } from "../replay";
import type { NewEvent } from "./helpers";
import { settlement } from "../settlement";
import { seatAfter, seatedPlayers } from "../seats";
import { legalActions, nextPotIndex, suggestButtonSeat, isBetweenHands, dealablePlayers } from "../hand";

// Plays thousands of random but legal hands through the engine and checks
// that chips are never created or lost and that replaying the log reproduces
// the same state.

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
const GAMES = 300;
const HANDS_PER_GAME = 25;

/** Chips sitting in the middle: committed during betting, unawarded pots after. */
function chipsInMiddle(s: GameState): number {
  const hand = s.hand;
  if (!hand) return 0;
  if (hand.phase === "betting") return hand.players.reduce((sum, p) => sum + p.committedTotal, 0);
  const awarded = new Set(hand.awards.map((a) => a.potIndex));
  return hand.pots.reduce((sum, pot, i) => sum + (awarded.has(i) ? 0 : pot.amount), 0);
}

function checkInvariants(s: GameState, ctx: string) {
  const buyIns = Object.values(s.players).reduce((sum, p) => sum + p.totalBuyIn, 0);
  const stacks = Object.values(s.players).reduce((sum, p) => sum + p.stack, 0);
  expect(stacks + chipsInMiddle(s), ctx).toBe(buyIns);
  for (const p of Object.values(s.players)) {
    expect(p.stack >= 0 && p.stack % UNIT === 0, ctx).toBe(true);
  }
}

describe("random games", () => {
  it("conserve chips and replay to the same state", () => {
    const rand = mulberry32(2024);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    let handsCompleted = 0;
    let lateJoins = 0;
    let showdowns = 0;

    for (let g = 0; g < GAMES; g++) {
      const events: GameEvent[] = [];
      let state: GameState | null = null as GameState | null;
      let id = 0;
      const push = (e: NewEvent) => {
        const event = { ...e, id: `g${g}e${++id}`, at: 0 } as GameEvent;
        state = applyEvent(state, event); // throws (fails the test) if the engine rejects a legal move
        events.push(event);
        checkInvariants(state, `game ${g}, event ${id}: ${JSON.stringify(event)}`);
      };

      const sb = UNIT * (1 + Math.floor(rand() * 4));
      push({ type: "game_created", config: { smallBlind: sb, bigBlind: sb * 2, unit: UNIT, currency: "USD", maxSeats: 9 } });
      const n = 2 + Math.floor(rand() * 6);
      const seats = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rand() - 0.5).slice(0, n);
      seats.forEach((seat, i) =>
        push({ type: "player_joined", playerId: `p${i}`, name: `P${i}`, seat, buyIn: UNIT * (2 + Math.floor(rand() * 200)) }),
      );

      for (let h = 0; h < HANDS_PER_GAME; h++) {
        let s = state!;
        // Occasionally sit someone out / bring them back, and rebuy broke players.
        for (const p of Object.values(s.players)) {
          if (p.stack === 0 && p.status !== "left") push({ type: "rebuy", playerId: p.id, amount: UNIT * 100 });
          else if (p.status === "seated" && rand() < 0.05) push({ type: "player_sat_out", playerId: p.id });
          else if (p.status === "sitting_out" && rand() < 0.5) push({ type: "player_returned", playerId: p.id });
        }
        s = state!;
        if (dealablePlayers(s).length < 2) {
          for (const p of Object.values(s.players)) {
            if (p.status === "sitting_out") push({ type: "player_returned", playerId: p.id });
          }
          s = state!;
        }
        const button = rand() < 0.9 ? suggestButtonSeat(s)! : pick(dealablePlayers(s)).seat;
        push({ type: "hand_started", buttonSeat: button });

        for (let guard = 0; guard < 500 && !isBetweenHands(state!); guard++) {
          s = state!;
          const hand = s.hand!;
          if (hand.phase === "awarding") {
            const i = nextPotIndex(hand)!;
            const eligible = hand.pots[i]!.eligible;
            const winners = eligible.filter(() => rand() < 0.4);
            push({ type: "pot_awarded", potIndex: i, winners: winners.length ? winners : [pick(eligible)] });
            if (isBetweenHands(state!)) showdowns++;
            continue;
          }
          // Now and then someone squeezes in mid-hand next to a random player.
          if (rand() < 0.01 && seatedPlayers(s).length < 9) {
            const next: string = pick(seatedPlayers(s)).id;
            lateJoins++;
            push({ type: "player_joined", playerId: `late${id}`, name: `Late${id}`, seat: seatAfter(s, next), buyIn: UNIT * 100 });
            s = state!;
          }
          const legal = legalActions(s)!;
          const options: PlayerAction[] = [];
          options.push(legal.canCheck ? { kind: "check" } : { kind: "call" });
          options.push(legal.canCheck ? { kind: "check" } : { kind: "call" });
          if (!legal.canCheck || rand() < 0.1) options.push({ kind: "fold" });
          if (legal.minBetOrRaiseTo !== null) {
            const min = legal.minBetOrRaiseTo;
            const max = legal.maxBetOrRaiseTo;
            const to = rand() < 0.2 ? max : min + UNIT * Math.floor(rand() * ((max - min) / UNIT + 1));
            options.push({ kind: hand.currentBet === 0 ? "bet" : "raise", to });
          }
          push({ type: "action", playerId: hand.toAct!, action: pick(options) });
        }
        expect(isBetweenHands(state!)).toBe(true);
        handsCompleted++;
      }

      // Everyone can be settled up exactly.
      const { nets, payments } = settlement(state!);
      const owed = new Map(nets.map((r) => [r.playerId, r.net]));
      for (const p of payments) {
        owed.set(p.from, owed.get(p.from)! + p.amount);
        owed.set(p.to, owed.get(p.to)! - p.amount);
      }
      expect([...owed.values()].every((v) => v === 0)).toBe(true);

      // Replaying the whole log gives exactly the same state.
      const replayed = replay(events);
      expect(replayed.error).toBeNull();
      expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(state));
    }

    // Make sure the generator actually exercised showdowns, not just folds.
    expect(handsCompleted).toBe(GAMES * HANDS_PER_GAME);
    expect(showdowns > handsCompleted / 10).toBe(true);
    expect(lateJoins > 50).toBe(true);
  });
});
