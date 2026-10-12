import type { GameEvent, PlayerId } from "../engine/types";
import { appendRefusal, enteredBy, eventRefusal, MAX_EVENTS_PER_ROOM, replaceRefusal, undoRefusal } from "./rules";
import { ConflictError, PermissionError, type Member, type RoomSnapshot } from "./types";

// A stand-in for the database: the same rooms, versions, permission and
// event checks as supabase/migrations (0001 + 0002), on plain data. It
// doesn't rate-limit (that only matters on a shared server). Used by the
// tests (memoryBackend.ts) and the "share between tabs" mode (localBackend.ts).

export interface RoomRecord {
  id: string;
  code: string;
  name: string;
  version: number;
  events: GameEvent[];
  members: Member[];
}

export interface ServerData {
  rooms: Record<string, RoomRecord>;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function randomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return code;
}

export class RoomServer {
  constructor(
    private readonly data: ServerData,
    private readonly makeId: () => string,
    private readonly makeCode: () => string = () => randomCode(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  createRoom(uid: string, name: string, events: GameEvent[]) {
    checkLog(events);
    let code = this.makeCode();
    while (Object.values(this.data.rooms).some((r) => r.code === code)) code = this.makeCode();
    const id = this.makeId();
    this.data.rooms[id] = {
      id,
      code,
      name: (name.trim() || "Game").slice(0, 60),
      version: 1,
      events: events.map((e) => ({ ...e, by: "host" as const, at: this.now() })),
      members: [{ uid, isHost: true, playerId: null }],
    };
    return { roomId: id, code };
  }

  joinRoom(uid: string, code: string) {
    const room = Object.values(this.data.rooms).find((r) => r.code === code.trim().toUpperCase());
    if (!room) throw new Error("No game with that code");
    if (!room.members.some((m) => m.uid === uid)) room.members.push({ uid, isHost: false, playerId: null });
    return { roomId: room.id };
  }

  load(uid: string, roomId: string): RoomSnapshot {
    const room = this.memberRoom(uid, roomId);
    return {
      roomId: room.id,
      code: room.code,
      name: room.name,
      version: room.version,
      events: structuredCopy(room.events),
      members: structuredCopy(room.members),
      me: uid,
    };
  }

  append(uid: string, roomId: string, expectedVersion: number, event: GameEvent) {
    const room = this.memberRoom(uid, roomId);
    if (room.version !== expectedVersion) throw new ConflictError();
    const shape = eventRefusal(event);
    if (shape) throw new Error(shape);
    const me = member(room, uid)!;
    refuse(appendRefusal(me, event));
    if (room.events.some((e) => e.id === event.id)) throw new Error("That event was already added");
    if (room.events.length >= MAX_EVENTS_PER_ROOM) throw new Error("This game's log is full (20,000 events)");
    // Who entered it and when, from the server's point of view.
    room.events.push({ ...event, by: enteredBy(me), at: this.now() });
    room.version++;
  }

  undo(uid: string, roomId: string, expectedVersion: number) {
    const room = this.memberRoom(uid, roomId);
    if (room.version !== expectedVersion) throw new ConflictError();
    refuse(undoRefusal(member(room, uid), room.events[room.events.length - 1]));
    room.events.pop();
    room.version++;
  }

  replaceLog(uid: string, roomId: string, expectedVersion: number, events: GameEvent[]) {
    const room = this.memberRoom(uid, roomId);
    if (room.version !== expectedVersion) throw new ConflictError();
    refuse(replaceRefusal(member(room, uid)));
    checkLog(events);
    // Events already in the log keep who entered them and when; new ones are the host's, now.
    const old = new Map(room.events.map((e) => [e.id, e]));
    room.events = events.map((e) => {
      const before = old.get(e.id);
      return before ? { ...e, by: before.by, at: before.at } : { ...e, by: "host" as const, at: this.now() };
    });
    room.version++;
  }

  claimPlayer(uid: string, roomId: string, playerId: PlayerId | null) {
    const room = this.memberRoom(uid, roomId);
    const me = member(room, uid)!;
    if (playerId !== null) {
      if (!room.events.some((e) => e.type === "player_joined" && e.playerId === playerId)) {
        throw new Error("No such player in this game");
      }
      const holder = room.members.find((m) => m.playerId === playerId && m.uid !== uid);
      if (holder) throw new PermissionError("Another phone already plays as them. The host can free that seat.");
    }
    me.playerId = playerId;
  }

  releasePlayer(uid: string, roomId: string, playerId: PlayerId) {
    const room = this.memberRoom(uid, roomId);
    refuse(replaceRefusal(member(room, uid)));
    for (const m of room.members) if (m.playerId === playerId) m.playerId = null;
  }

  private memberRoom(uid: string, roomId: string): RoomRecord {
    const room = this.data.rooms[roomId];
    if (!room || !member(room, uid)) throw new PermissionError("You're not in this game");
    return room;
  }
}

function checkLog(events: GameEvent[]) {
  if (events[0]?.type !== "game_created") throw new Error("A room's log must start with game_created");
  if (events.length > MAX_EVENTS_PER_ROOM) throw new Error("This game's log is full (20,000 events)");
  for (const e of events) {
    const shape = eventRefusal(e);
    if (shape) throw new Error(shape);
  }
  if (new Set(events.map((e) => e.id)).size !== events.length) throw new Error("Two events have the same id");
}

function member(room: RoomRecord, uid: string): Member | undefined {
  return room.members.find((m) => m.uid === uid);
}

function refuse(reason: string | null) {
  if (reason) throw new PermissionError(reason);
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
