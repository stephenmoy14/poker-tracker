import type { GameEvent, PlayerId } from "../engine/types";
import type { Member } from "./types";

// Who may do what in a shared game. The same rules are enforced by the
// database functions (supabase/migrations) and by the in-browser stand-in
// server (roomServer.ts):
//   - The host may do anything.
//   - A phone linked to a player may only submit actions for that player.
//   - Anyone else (not linked) can only watch.
//   - Undo: the host, or the player whose action is the last event.
//   - Editing or deleting past events: host only.
// Turn order and amounts are checked by the engine on the phone before
// anything is sent (the database doesn't run the engine).

export const NOT_YOURS = "You can only act for your own seat";

// Limits shared with supabase/migrations/0002_hardening.sql.
export const MAX_EVENT_BYTES = 8192;
export const MAX_EVENTS_PER_ROOM = 20000;
export const MAX_ID_LENGTH = 64;
const EVENT_TYPES = new Set<string>([
  "game_created", "player_joined", "rebuy", "player_left", "player_sat_out", "player_returned",
  "hand_started", "action", "hand_fast_entry", "pot_awarded", "game_ended",
]);

/** Shape checks the server makes on every stored event. */
export function eventRefusal(event: unknown): string | null {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return "Each event must be an object";
  const e = event as { type?: unknown; id?: unknown };
  if (typeof e.type !== "string" || !EVENT_TYPES.has(e.type)) return "Unknown event type";
  if (typeof e.id !== "string" || e.id.length < 1 || e.id.length > MAX_ID_LENGTH) {
    return "Each event needs an id of 1 to 64 characters";
  }
  if (new TextEncoder().encode(JSON.stringify(event)).length > MAX_EVENT_BYTES) return "That event is too large";
  return null;
}

/** Who the server records as having entered an event. */
export function enteredBy(member: Member): PlayerId | "host" | undefined {
  return member.isHost ? "host" : (member.playerId ?? undefined);
}
export const HOST_ONLY = "Only the host can do that";
export const WATCHING = "Pick which player you are to take part";

export function appendRefusal(member: Member | undefined, event: GameEvent): string | null {
  if (!member) return "You're not in this game";
  if (member.isHost) return null;
  if (!member.playerId) return WATCHING;
  if (event.type !== "action") return HOST_ONLY;
  if (event.playerId !== member.playerId) return NOT_YOURS;
  return null;
}

export function undoRefusal(member: Member | undefined, last: GameEvent | undefined): string | null {
  if (!member) return "You're not in this game";
  if (!last) return "Nothing to undo";
  if (last.type === "game_created") return "Nothing to undo";
  if (member.isHost) return null;
  if (last.type === "action" && member.playerId && last.playerId === member.playerId) return null;
  return "Only the host can undo that";
}

export function replaceRefusal(member: Member | undefined): string | null {
  if (!member) return "You're not in this game";
  return member.isHost ? null : HOST_ONLY;
}

/** What this phone may do, for showing or hiding controls. */
export function capabilities(member: Member | undefined, events: readonly GameEvent[]) {
  return {
    host: !!member?.isHost,
    actFor: (playerId: PlayerId) => !!member && (member.isHost || member.playerId === playerId),
    undo: undoRefusal(member, events[events.length - 1]) === null,
  };
}
