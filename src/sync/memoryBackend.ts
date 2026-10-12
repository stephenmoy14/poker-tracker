import type { GameEvent, PlayerId } from "../engine/types";
import { RoomServer, type ServerData } from "./roomServer";
import type { SyncBackend } from "./types";

/**
 * In-memory server shared by several "phones" in one process (tests).
 * `hub.client(uid)` gives one phone's backend.
 */
export class MemoryHub {
  readonly data: ServerData = { rooms: {} };
  private ids = 0;
  private readonly server = new RoomServer(this.data, () => `room${++this.ids}`);
  private readonly listeners = new Map<string, Set<() => void>>();

  client(uid: string): SyncBackend {
    const s = this.server;
    const notify = (roomId: string) => this.listeners.get(roomId)?.forEach((f) => f());
    const run = async <T>(roomId: string | null, f: () => T): Promise<T> => {
      const result = f();
      if (roomId) notify(roomId);
      return result;
    };
    return {
      label: "memory",
      createRoom: (name: string, events: GameEvent[]) => run(null, () => s.createRoom(uid, name, events)),
      joinRoom: (code: string) => run(null, () => s.joinRoom(uid, code)),
      load: async (roomId: string) => s.load(uid, roomId),
      append: (roomId: string, v: number, e: GameEvent) => run(roomId, () => s.append(uid, roomId, v, e)),
      undo: (roomId: string, v: number) => run(roomId, () => s.undo(uid, roomId, v)),
      replaceLog: (roomId: string, v: number, events: GameEvent[]) => run(roomId, () => s.replaceLog(uid, roomId, v, events)),
      claimPlayer: (roomId: string, p: PlayerId | null) => run(roomId, () => s.claimPlayer(uid, roomId, p)),
      releasePlayer: (roomId: string, p: PlayerId) => run(roomId, () => s.releasePlayer(uid, roomId, p)),
      subscribe: (roomId: string, onChange: () => void, onStatus?: (live: boolean) => void) => {
        const set = this.listeners.get(roomId) ?? new Set();
        set.add(onChange);
        this.listeners.set(roomId, set);
        onStatus?.(true);
        return () => set.delete(onChange);
      },
    };
  }
}
