import type { GameEvent } from "../engine/types";

// Phase 1 keeps each game's event log in this browser's localStorage.
// Phase 2 replaces this file with Supabase. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.

export interface GameMeta {
  id: string;
  name: string;
  createdAt: number;
}

const INDEX_KEY = "poker-tracker:games";
const gameKey = (id: string) => `poker-tracker:game:${id}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listGames(): GameMeta[] {
  return read<GameMeta[]>(INDEX_KEY, []).sort((a, b) => b.createdAt - a.createdAt);
}

export function addGame(meta: GameMeta, events: GameEvent[]): void {
  write(gameKey(meta.id), events);
  write(INDEX_KEY, [...listGames().filter((g) => g.id !== meta.id), meta]);
}

export function loadEvents(id: string): GameEvent[] {
  return read<GameEvent[]>(gameKey(id), []);
}

/** Returns false if the browser refused to save. */
export function saveEvents(id: string, events: GameEvent[]): boolean {
  return write(gameKey(id), events);
}

export function deleteGame(id: string): void {
  try {
    localStorage.removeItem(gameKey(id));
  } catch {
    /* ignore */
  }
  write(INDEX_KEY, listGames().filter((g) => g.id !== id));
}

// ── Shared games this phone has joined ──

export interface RoomMeta {
  code: string;
  roomId: string;
  name: string;
  joinedAt: number;
}

const ROOMS_KEY = "poker-tracker:rooms";

export function listRooms(): RoomMeta[] {
  return read<RoomMeta[]>(ROOMS_KEY, []).sort((a, b) => b.joinedAt - a.joinedAt);
}

export function rememberRoom(room: RoomMeta): void {
  write(ROOMS_KEY, [...listRooms().filter((r) => r.code !== room.code), room]);
}

export function forgetRoom(code: string): void {
  write(ROOMS_KEY, listRooms().filter((r) => r.code !== code));
}
