import type { GameEvent, PlayerId } from "../engine/types";

// Shared games ("rooms"). The room's event log lives on the server; every
// phone replays it with the engine. Writes carry the log version the phone
// last saw, so two phones can't both append "next" without one of them
// re-checking first.

export interface Member {
  uid: string; // anonymous auth user id (one per phone/browser)
  isHost: boolean;
  playerId: PlayerId | null; // which player this phone acts for, if any
}

export interface RoomSnapshot {
  roomId: string;
  code: string; // short code people type to join, e.g. "K7P2QX"
  name: string;
  version: number; // bumps on every change to the log
  events: GameEvent[];
  members: Member[];
  me: string; // this phone's uid
}

export interface SyncBackend {
  /** Human-readable name for the UI, e.g. "Supabase" or "this browser". */
  readonly label: string;
  createRoom(name: string, events: GameEvent[]): Promise<{ roomId: string; code: string }>;
  /** Joins by code (idempotent) and returns the room id. */
  joinRoom(code: string): Promise<{ roomId: string }>;
  load(roomId: string): Promise<RoomSnapshot>;
  append(roomId: string, expectedVersion: number, event: GameEvent): Promise<void>;
  undo(roomId: string, expectedVersion: number): Promise<void>;
  /** Host only: replace the whole log (edits and deletes). */
  replaceLog(roomId: string, expectedVersion: number, events: GameEvent[]): Promise<void>;
  /** Link this phone to a player (null = just watching). */
  claimPlayer(roomId: string, playerId: PlayerId | null): Promise<void>;
  /** Host only: free a player claimed by a phone that's gone. */
  releasePlayer(roomId: string, playerId: PlayerId): Promise<void>;
  /** Calls back on any change to the room; `onStatus` reports whether the live connection is up. */
  subscribe(roomId: string, onChange: () => void, onStatus?: (live: boolean) => void): () => void;
}

/** Someone else changed the log first. Reload, re-check, retry. */
export class ConflictError extends Error {
  constructor() {
    super("Someone else just changed the game");
    this.name = "ConflictError";
  }
}

/** The server refused: not allowed for this phone. */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
