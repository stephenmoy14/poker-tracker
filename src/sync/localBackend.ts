import type { GameEvent, PlayerId } from "../engine/types";
import { newId } from "../app/log";
import { RoomServer, type ServerData } from "./roomServer";
import type { SyncBackend } from "./types";

// "Share between tabs" mode, used until Supabase is configured. Rooms live in
// this browser's localStorage; each tab acts as a separate phone (its own id
// in sessionStorage), and tabs hear about changes over a BroadcastChannel.
// Same rules as the real server (roomServer.ts), so it's a faithful way to
// try sharing on one computer. It can't reach other devices.

const DATA_KEY = "poker-tracker:local-server";
const UID_KEY = "poker-tracker:local-uid";

function tabUid(): string {
  try {
    let uid = sessionStorage.getItem(UID_KEY);
    if (!uid) {
      uid = newId();
      sessionStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return newId();
  }
}

export class LocalBackend implements SyncBackend {
  readonly label = "this browser";
  private readonly uid = tabUid();
  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("poker-tracker-sync") : null;
  private readonly sameTab = new Map<string, Set<() => void>>();

  private run<T>(roomId: string | null, f: (server: RoomServer) => T): Promise<T> {
    try {
      const data = read();
      const result = f(new RoomServer(data, newId));
      write(data);
      if (roomId) {
        this.channel?.postMessage(roomId);
        this.sameTab.get(roomId)?.forEach((cb) => cb());
      }
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  createRoom(name: string, events: GameEvent[]) {
    return this.run(null, (s) => s.createRoom(this.uid, name, events));
  }
  joinRoom(code: string) {
    return this.run(null, (s) => s.joinRoom(this.uid, code));
  }
  load(roomId: string) {
    return this.run(null, (s) => s.load(this.uid, roomId));
  }
  append(roomId: string, v: number, event: GameEvent) {
    return this.run(roomId, (s) => s.append(this.uid, roomId, v, event));
  }
  undo(roomId: string, v: number) {
    return this.run(roomId, (s) => s.undo(this.uid, roomId, v));
  }
  replaceLog(roomId: string, v: number, events: GameEvent[]) {
    return this.run(roomId, (s) => s.replaceLog(this.uid, roomId, v, events));
  }
  claimPlayer(roomId: string, playerId: PlayerId | null) {
    return this.run(roomId, (s) => s.claimPlayer(this.uid, roomId, playerId));
  }
  releasePlayer(roomId: string, playerId: PlayerId) {
    return this.run(roomId, (s) => s.releasePlayer(this.uid, roomId, playerId));
  }

  subscribe(roomId: string, onChange: () => void, onStatus?: (live: boolean) => void) {
    const onMessage = (e: MessageEvent) => {
      if (e.data === roomId) onChange();
    };
    this.channel?.addEventListener("message", onMessage);
    const set = this.sameTab.get(roomId) ?? new Set();
    set.add(onChange);
    this.sameTab.set(roomId, set);
    onStatus?.(true);
    return () => {
      this.channel?.removeEventListener("message", onMessage);
      set.delete(onChange);
    };
  }
}

function read(): ServerData {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as ServerData) : { rooms: {} };
  } catch {
    return { rooms: {} };
  }
}

function write(data: ServerData) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch {
    throw new Error("This browser refused to save");
  }
}
