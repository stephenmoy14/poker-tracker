import type { GameEvent, GameState, HandState, PlayerId, ReplayError, Street } from "./types";
import { formatAmount } from "./money";
import { applyEvent } from "./replay";
import { potLabel } from "./hand";

// Readable log lines, e.g. "Sam posts SB $0.10" or "Cam raises to $3.00".
//
// Each event gets the line for what the human entered ("event"), followed by
// lines for what the rules did as a result ("auto"): blinds, new streets,
// uncalled bets returned, pots formed and pots awarded automatically. The UI
// can style the two kinds differently.

export interface LogLine {
  kind: "event" | "auto";
  text: string;
}

export interface DescribedEvent {
  eventId: string;
  index: number;
  handNumber: number | null; // the hand this event belongs to, for grouping
  lines: LogLine[];
}

export interface DescribedLog {
  entries: DescribedEvent[];
  error: ReplayError | null; // same as replay(): the log stops at the first invalid event
}

/** Describes the whole log, stopping at the first invalid event like replay(). */
export function describeLog(events: readonly GameEvent[]): DescribedLog {
  const entries: DescribedEvent[] = [];
  let state: GameState | null = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    let next: GameState;
    try {
      next = applyEvent(state, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { entries, error: { eventId: event.id, index, message } };
    }
    entries.push({
      eventId: event.id,
      index,
      handNumber: handNumberOf(event, next),
      lines: describeEvent(state, next, event),
    });
    state = next;
  }
  return { entries, error: null };
}

/** Lines for one event, given the state before and after it. */
export function describeEvent(before: GameState | null, after: GameState, event: GameEvent): LogLine[] {
  const name = (id: PlayerId) => after.players[id]?.name ?? id;
  const money = (c: number) => formatAmount(c, after.config);
  const lines: LogLine[] = [];
  const say = (text: string) => lines.push({ kind: "event", text });

  switch (event.type) {
    case "game_created":
      say(
        `Game created · blinds ${money(event.config.smallBlind)} / ${money(event.config.bigBlind)}` +
          (event.config.format === "chips" ? " chips" : ""),
      );
      break;
    case "player_joined":
      say(`${name(event.playerId)} joins in seat ${event.seat} with ${money(event.buyIn)}`);
      break;
    case "rebuy":
      say(`${name(event.playerId)} rebuys ${money(event.amount)}`);
      break;
    case "player_left":
      say(`${name(event.playerId)} leaves with ${money(after.players[event.playerId]!.stack)}`);
      break;
    case "player_sat_out":
      say(`${name(event.playerId)} sits out`);
      break;
    case "player_returned":
      say(`${name(event.playerId)} is back`);
      break;
    case "game_ended":
      say("Game over");
      break;

    case "hand_started": {
      const hand = after.hand!;
      const button = seatOwner(after, event.buttonSeat);
      say(`Hand #${hand.number} · ${name(button)} has the button`);
      for (const [seat, label] of [[hand.smallBlindSeat, "SB"], [hand.bigBlindSeat, "BB"]] as const) {
        if (seat === null) continue;
        const id = seatOwner(after, seat);
        const hp = hand.players.find((p) => p.playerId === id)!;
        lines.push({ kind: "auto", text: `${name(id)} posts ${label} ${money(hp.committedTotal)}${hp.allIn ? " (all-in)" : ""}` });
      }
      break;
    }

    case "action": {
      const prev = before!.hand!.players.find((p) => p.playerId === event.playerId)!;
      const now = after.hand!.players.find((p) => p.playerId === event.playerId)!;
      const allIn = now.allIn && !prev.allIn ? " (all-in)" : "";
      const who = name(event.playerId);
      const a = event.action;
      if (a.kind === "fold") say(`${who} folds`);
      else if (a.kind === "check") say(`${who} checks`);
      else if (a.kind === "call") say(`${who} calls ${money(now.committedTotal - prev.committedTotal)}${allIn}`);
      else if (a.kind === "bet") say(`${who} bets ${money(a.to)}${allIn}`);
      else say(`${who} raises to ${money(a.to)}${allIn}`);
      break;
    }

    case "hand_fast_entry": {
      const parts = event.entries.map(
        (e) => `${name(e.playerId)} ${money(e.contributed)}${e.folded ? " (folded)" : ""}`,
      );
      say(`Quick entry: ${parts.join(", ")}`);
      break;
    }

    case "pot_awarded":
      // The host's choice; written out below with the other awards.
      break;
  }

  if (after.hand && affectsHand(event)) lines.push(...handConsequences(before, after, event));
  return lines;
}

// ───────────── Internals ─────────────

function affectsHand(event: GameEvent): boolean {
  return ["hand_started", "action", "hand_fast_entry", "pot_awarded"].includes(event.type);
}

function handNumberOf(event: GameEvent, after: GameState): number | null {
  return affectsHand(event) && after.hand ? after.hand.number : null;
}

function seatOwner(state: GameState, seat: number): PlayerId {
  return Object.values(state.players).find((p) => p.seat === seat && p.status !== "left")!.id;
}

const STREET_NAMES: Partial<Record<Street, string>> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};
const STREETS: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

/** What the rules did after this event: streets, returns, pots, awards. */
function handConsequences(before: GameState | null, after: GameState, event: GameEvent): LogLine[] {
  const hand = after.hand!;
  const prevHand: HandState | null =
    before?.hand && before.hand.number === hand.number ? before.hand : null;
  const name = (id: PlayerId) => after.players[id]?.name ?? id;
  const money = (c: number) => formatAmount(c, after.config);
  const lines: LogLine[] = [];
  const auto = (text: string) => lines.push({ kind: "auto", text });

  // New streets, including ones dealt without betting after an all-in.
  const from = STREETS.indexOf(prevHand?.street ?? "preflop");
  const to = STREETS.indexOf(hand.street);
  const runout = hand.mode === "actions" && to - from > 1;
  for (let i = from + 1; i <= to; i++) {
    const street = STREETS[i]!;
    if (hand.mode === "fast_entry" && street !== "showdown") continue;
    const note = runout && street !== "showdown" && i === from + 1 ? " (no more betting)" : "";
    auto(`${STREET_NAMES[street]}${note}`);
  }

  // Betting just ended: uncalled bet and the pots.
  const wasBetting = prevHand ? prevHand.phase === "betting" : true;
  if (wasBetting && hand.phase !== "betting") {
    if (hand.uncalledReturn) {
      const { playerId, amount } = hand.uncalledReturn;
      auto(`${money(amount)} uncalled, returned to ${name(playerId)}`);
    }
    const live = hand.players.filter((p) => !p.folded).length;
    if (live > 1) {
      hand.pots.forEach((pot, i) => {
        auto(`${i === 0 ? "Main pot" : `Side pot ${i}`} ${money(pot.amount)} · ${pot.eligible.map(name).join(", ")}`);
      });
    }
  }

  // Awards made by this event. With pot_awarded, the first is the host's choice.
  const newAwards = hand.awards.slice(prevHand?.awards.length ?? 0);
  newAwards.forEach((award, i) => {
    const kind = event.type === "pot_awarded" && i === 0 ? "event" : "auto";
    lines.push({ kind, text: describeAward(award.potIndex, award.payouts, hand.pots.length, name, money) });
  });
  return lines;
}

function describeAward(
  potIndex: number,
  payouts: Record<PlayerId, number>,
  potCount: number,
  name: (id: PlayerId) => string,
  money: (c: number) => string,
): string {
  const winners = Object.keys(payouts);
  const total = Object.values(payouts).reduce((s, x) => s + x, 0);
  const pot = potCount === 1 ? "the pot" : potLabel(potIndex);
  if (winners.length === 1) return `${name(winners[0]!)} wins ${pot} (${money(total)})`;
  const shares = winners.map((id) => `${name(id)} ${money(payouts[id]!)}`).join(", ");
  return `${listNames(winners.map(name))} split ${pot} (${money(total)}): ${shares}`;
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
