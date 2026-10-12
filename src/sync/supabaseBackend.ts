import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { GameEvent, PlayerId } from "../engine/types";
import { ConflictError, PermissionError, type RoomSnapshot, type SyncBackend } from "./types";

// Shared games on Supabase. Each phone signs in anonymously (no email or
// password; the session is remembered in this browser), reads the room with
// room_snapshot(), writes through the functions in
// supabase/migrations/0001_rooms.sql, and listens for changes to its room's
// row over Realtime.

export class SupabaseBackend implements SyncBackend {
  readonly label = "Supabase";
  private readonly client: SupabaseClient;
  private signingIn: Promise<void> | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  /** Signs in anonymously once per browser (the session persists). */
  private session(): Promise<void> {
    this.signingIn ??= (async () => {
      const { data } = await this.client.auth.getSession();
      if (data.session) return;
      const { error } = await this.client.auth.signInAnonymously();
      if (error) {
        throw new Error(`Couldn't connect: ${error.message}. Is anonymous sign-in turned on in Supabase?`);
      }
    })().catch((err) => {
      this.signingIn = null;
      throw err;
    });
    return this.signingIn;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    await this.session();
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toError(error.message);
    return data as T;
  }

  async createRoom(name: string, events: GameEvent[]) {
    const rows = await this.rpc<{ room_id: string; code: string }[]>("create_room", { p_name: name, p_events: events });
    const row = rows[0];
    if (!row) throw new Error("The server didn't create the game");
    return { roomId: row.room_id, code: row.code };
  }

  async joinRoom(code: string) {
    // null = no such code (returned rather than raised so wrong guesses count towards the join limit)
    const roomId = await this.rpc<string | null>("join_room", { p_code: code });
    if (!roomId) throw new Error("No game with that code");
    return { roomId };
  }

  load(roomId: string) {
    return this.rpc<RoomSnapshot>("room_snapshot", { p_room: roomId });
  }

  async append(roomId: string, v: number, event: GameEvent) {
    await this.rpc("append_event", { p_room: roomId, p_expected_version: v, p_event: event });
  }

  async undo(roomId: string, v: number) {
    await this.rpc("undo_last", { p_room: roomId, p_expected_version: v });
  }

  async replaceLog(roomId: string, v: number, events: GameEvent[]) {
    await this.rpc("replace_log", { p_room: roomId, p_expected_version: v, p_events: events });
  }

  async claimPlayer(roomId: string, playerId: PlayerId | null) {
    await this.rpc("claim_player", { p_room: roomId, p_player: playerId });
  }

  async releasePlayer(roomId: string, playerId: PlayerId) {
    await this.rpc("release_player", { p_room: roomId, p_player: playerId });
  }

  subscribe(roomId: string, onChange: () => void, onStatus?: (live: boolean) => void) {
    let channel: RealtimeChannel | null = null;
    let closed = false;
    void this.session().then(() => {
      if (closed) return;
      channel = this.client
        .channel(`room:${roomId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          () => onChange(),
        )
        .subscribe((status) => {
          const live = status === "SUBSCRIBED";
          onStatus?.(live);
          if (live) onChange(); // catch up on anything missed while connecting
        });
    });
    return () => {
      closed = true;
      if (channel) void this.client.removeChannel(channel);
    };
  }
}

function toError(message: string): Error {
  if (message === "conflict") return new ConflictError();
  if (message.startsWith("forbidden: ")) return new PermissionError(message.slice("forbidden: ".length));
  return new Error(message);
}
