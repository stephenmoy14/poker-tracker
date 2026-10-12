import type { GameEvent, GameState, PlayerId, ReplayError } from "../engine/types";
import type { NewEvent } from "./log";
import type { Member } from "../sync/types";

/**
 * What every screen works with, whether the game lives on this phone only
 * (useGame.ts) or is shared between phones (useRoomGame.ts). Changes are async
 * and resolve to null, or to the reason they weren't made.
 */
export interface Game {
  events: GameEvent[];
  state: GameState | null;
  error: ReplayError | null;
  dispatch(e: NewEvent): Promise<string | null>;
  undo(): Promise<string | null>;
  replaceEvent(index: number, next: NewEvent): Promise<string | null>;
  deleteEvent(index: number): Promise<string | null>;
  /** A change is on its way to the server. */
  pending: boolean;
  /** This browser refused to save (local games only). */
  saveFailed: boolean;
  can: Capabilities;
  room: RoomInfo | null;
}

export interface Capabilities {
  /** Deal, award, add players, rebuys, edit history, end the game. */
  host: boolean;
  /** Enter actions for this player. */
  actFor(playerId: PlayerId): boolean;
  /** Undo the last event. */
  undo: boolean;
}

export interface RoomInfo {
  code: string;
  name: string;
  members: Member[];
  me: Member | undefined;
  /** Live connection to the server is up. */
  live: boolean;
  /** Where the room lives, e.g. "Supabase" or "this browser". */
  backendLabel: string;
  claim(playerId: PlayerId | null): Promise<string | null>;
  release(playerId: PlayerId): Promise<string | null>;
}

export const EVERYTHING: Capabilities = { host: true, actFor: () => true, undo: true };
