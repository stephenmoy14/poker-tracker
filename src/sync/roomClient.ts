import type { GameEvent, PlayerId, ReplayResult } from "../engine/types";
import { replay } from "../engine/replay";
import { type NewEvent, rejectionReason, removeAt, replaceAt, stamp } from "../app/log";
import { appendRefusal, replaceRefusal, undoRefusal } from "./rules";
import { ConflictError, PermissionError, type Member, type RoomSnapshot, type SyncBackend } from "./types";

// One phone's view of a shared game. Framework-free so it can be tested with
// several simulated phones; useRoomGame.ts wraps it for React.
//
// Sending an entry:
//  1. Check it here first: is this phone allowed (rules.ts), and does the
//     engine accept it against the latest log?
//  2. Send it with the log version this phone last saw.
//  3. If someone else changed the log first (ConflictError), reload, check
//     again against the new log, and retry. An entry that no longer makes
//     sense (e.g. two people tapped for the same turn) gets the engine's reason.

const MAX_TRIES = 3;

export class RoomClient {
  private snap: RoomSnapshot | null = null;
  private cached: { version: number; result: ReplayResult } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly backend: SyncBackend,
    readonly roomId: string,
  ) {}

  get snapshot(): RoomSnapshot | null {
    return this.snap;
  }

  get me(): Member | undefined {
    return this.snap?.members.find((m) => m.uid === this.snap!.me);
  }

  /** replay(events), cached per version. */
  get replayed(): ReplayResult {
    const snap = this.snap;
    if (!snap) return { state: null, error: null };
    if (this.cached?.version !== snap.version) this.cached = { version: snap.version, result: replay(snap.events) };
    return this.cached.result;
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  async refresh(): Promise<void> {
    this.snap = await this.backend.load(this.roomId);
    this.listeners.forEach((f) => f());
  }

  /** Adds an event to the end of the log. Returns null, or why it wasn't added. */
  async submit(e: NewEvent): Promise<string | null> {
    let reloaded = false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const snap = this.snap;
      if (!snap) return "Still loading the game";
      const { state, error } = this.replayed;
      const event = stamp(e);
      const refused = error
        ? `Event ${error.index + 1} is no longer valid. The host needs to fix it in the log.`
        : (appendRefusal(this.me, event) ?? rejectionReason(state, event));
      if (refused) {
        // This phone's view may just be behind (e.g. it hasn't heard about
        // the previous player's action yet). Reload once before refusing.
        if (reloaded) return refused;
        reloaded = true;
        await this.refresh();
        attempt--;
        continue;
      }
      try {
        await this.backend.append(this.roomId, snap.version, event);
        await this.refresh();
        return null;
      } catch (err) {
        if (err instanceof ConflictError) {
          await this.refresh(); // someone else went first: check again against the new log
          reloaded = true;
          continue;
        }
        return message(err);
      }
    }
    return "The game is changing quickly. Try again.";
  }

  async undo(): Promise<string | null> {
    return this.rewrite((snap) => {
      const refused = undoRefusal(this.me, snap.events[snap.events.length - 1]);
      if (refused) throw new PermissionError(refused);
      return this.backend.undo(this.roomId, snap.version);
    }, true);
  }

  async replaceEvent(index: number, next: NewEvent): Promise<string | null> {
    return this.rewrite((snap) => this.replace(snap, replaceAt(snap.events, index, next)));
  }

  async deleteEvent(index: number): Promise<string | null> {
    return this.rewrite((snap) => this.replace(snap, removeAt(snap.events, index)));
  }

  async claim(playerId: PlayerId | null): Promise<string | null> {
    return this.simple(() => this.backend.claimPlayer(this.roomId, playerId));
  }

  async release(playerId: PlayerId): Promise<string | null> {
    return this.simple(() => this.backend.releasePlayer(this.roomId, playerId));
  }

  private replace(snap: RoomSnapshot, events: GameEvent[]) {
    const refused = replaceRefusal(this.me);
    if (refused) throw new PermissionError(refused);
    return this.backend.replaceLog(this.roomId, snap.version, events);
  }

  /**
   * Edits, deletes and undo point at a specific event, so if the log changed
   * underneath we don't retry blindly: we reload and ask the person to look
   * again. (Undo is retried: "remove the last event" still means the same.)
   */
  private async rewrite(op: (snap: RoomSnapshot) => Promise<void>, retry = false): Promise<string | null> {
    for (let attempt = 0; attempt < (retry ? MAX_TRIES : 1); attempt++) {
      const snap = this.snap;
      if (!snap) return "Still loading the game";
      try {
        await op(snap);
        await this.refresh();
        return null;
      } catch (err) {
        if (err instanceof ConflictError) {
          await this.refresh();
          if (retry) continue;
          return "Someone changed the game just now. Check the log and try again.";
        }
        return message(err);
      }
    }
    return "The game is changing quickly. Try again.";
  }

  private async simple(op: () => Promise<void>): Promise<string | null> {
    try {
      await op();
      await this.refresh();
      return null;
    } catch (err) {
      return message(err);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
