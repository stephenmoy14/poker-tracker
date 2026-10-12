import type { GameEvent, GameState } from "../engine/types";
import { applyEvent } from "../engine/replay";

// Operations on the event log. The log is the only thing saved; every screen
// is drawn from replay(log). Undo, edit and delete are just list operations
// followed by a replay.

/** An event as the UI builds it, before it gets an id and timestamp. */
export type NewEvent = GameEvent extends infer E
  ? E extends GameEvent
    ? Omit<E, "id" | "at">
    : never
  : never;

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function stamp(e: NewEvent, now = Date.now()): GameEvent {
  return { ...e, id: newId(), at: now } as GameEvent;
}

/** Null if the event would be accepted in this state, otherwise the reason. */
export function rejectionReason(state: GameState | null, event: GameEvent): string | null {
  try {
    applyEvent(state, event);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function undoLast(events: readonly GameEvent[]): GameEvent[] {
  return events.slice(0, -1);
}

/** Replaces the event at `index`, keeping its id and time. */
export function replaceAt(events: readonly GameEvent[], index: number, next: NewEvent): GameEvent[] {
  const old = events[index];
  if (!old) throw new Error(`No event at position ${index}`);
  const copy = [...events];
  copy[index] = { ...next, id: old.id, at: old.at } as GameEvent;
  return copy;
}

export function removeAt(events: readonly GameEvent[], index: number): GameEvent[] {
  if (index < 0 || index >= events.length) throw new Error(`No event at position ${index}`);
  if (index === 0 && events.length > 1) throw new Error("The game-created event can't be deleted");
  return [...events.slice(0, index), ...events.slice(index + 1)];
}

/** Drops id/at so an event can be edited and passed back to replaceAt. */
export function strip(event: GameEvent): NewEvent {
  const { id: _id, at: _at, ...rest } = event;
  return rest as NewEvent;
}
