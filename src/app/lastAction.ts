import type { GameEvent, GameState } from "../engine/types";
import { replay } from "../engine/replay";
import { describeEvent } from "../engine/describe";
import type { LastAction } from "./components/TableDiagram";

/**
 * The most recent player action in the current hand, worded for a bubble:
 * "Raises to $1.00", "Calls $0.90 (all-in)". Null if the last event wasn't an
 * action (a new hand, an award, a join...).
 */
export function lastActionOf(events: readonly GameEvent[], state: GameState | null): LastAction | null {
  const last = events[events.length - 1];
  if (!last || last.type !== "action" || !state?.hand || state.hand.phase === "complete") return null;
  const before = replay(events.slice(0, -1)).state;
  const line = describeEvent(before, state, last).find((l) => l.kind === "event");
  if (!line) return null;
  const name = state.players[last.playerId]?.name ?? "";
  const text = line.text.startsWith(`${name} `) ? line.text.slice(name.length + 1) : line.text;
  return { playerId: last.playerId, text: text.charAt(0).toUpperCase() + text.slice(1) };
}
