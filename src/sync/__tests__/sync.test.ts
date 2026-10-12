import { describe, it, expect } from "vitest";
import { MemoryHub } from "../memoryBackend";
import { RoomClient } from "../roomClient";
import { stamp } from "../../app/log";
import { HOST_ONLY, NOT_YOURS, WATCHING } from "../rules";

// Several simulated phones sharing one stand-in server.

const created = () =>
  stamp({ type: "game_created", config: { smallBlind: 10, bigBlind: 25, unit: 5, currency: "USD", maxSeats: 10 } });

async function setup() {
  const hub = new MemoryHub();
  const hostBackend = hub.client("host-uid");
  const { roomId, code } = await hostBackend.createRoom("Friday", [created()]);
  const host = new RoomClient(hostBackend, roomId);
  await host.refresh();
  for (const [id, seat] of [["ann", 1], ["ben", 2], ["cam", 3]] as const) {
    expect(await host.submit({ type: "player_joined", playerId: id, name: id.toUpperCase(), seat, buyIn: 1000 })).toBeNull();
  }
  const phone = async (uid: string, playerId: string | null) => {
    const backend = hub.client(uid);
    await backend.joinRoom(code.toLowerCase()); // codes aren't case-sensitive
    const client = new RoomClient(backend, roomId);
    await client.refresh();
    if (playerId) expect(await client.claim(playerId)).toBeNull();
    return client;
  };
  return { hub, roomId, code, host, phone };
}

describe("shared games", () => {
  it("the host creates a room with a 6-character code and is the host", async () => {
    const { host, code } = await setup();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(host.me!.isHost).toBe(true);
    expect(host.replayed.state!.players.ann!.stack).toBe(1000);
  });

  it("a player's phone can only act for that player, on their turn", async () => {
    const { host, phone } = await setup();
    const ann = await phone("ann-phone", "ann");
    expect(await ann.submit({ type: "hand_started", buttonSeat: 3 })).toBe(HOST_ONLY);
    expect(await host.submit({ type: "hand_started", buttonSeat: 3 })).toBeNull(); // a SB, b BB, c first
    await ann.refresh();
    expect(await ann.submit({ type: "action", playerId: "cam", action: { kind: "fold" } })).toBe(NOT_YOURS);
    expect(await ann.submit({ type: "action", playerId: "ann", action: { kind: "fold" } })).toBe("It's CAM's turn, not ANN's");
    expect(await host.submit({ type: "action", playerId: "cam", action: { kind: "call" } })).toBeNull(); // host can act for anyone
    expect(await ann.submit({ type: "action", playerId: "ann", action: { kind: "call" } })).toBeNull();
    expect(host.replayed.state!.hand!.toAct).toBe("ann"); // host hasn't refreshed yet...
    await host.refresh();
    expect(host.replayed.state!.hand!.toAct).toBe("ben"); // ...now it sees Ann's call
  });

  it("phones that haven't picked a player can only watch", async () => {
    const { phone } = await setup();
    const watcher = await phone("watcher", null);
    expect(await watcher.submit({ type: "rebuy", playerId: "ann", amount: 500 })).toBe(WATCHING);
    expect(await watcher.undo()).toBe("Only the host can undo that");
  });

  it("two phones tapping at once: the second is re-checked against the new log", async () => {
    const { host, phone } = await setup();
    await host.submit({ type: "hand_started", buttonSeat: 3 });
    const cam = await phone("cam-phone", "cam");
    // Both have the same version. The host taps "fold" for Cam while Cam taps "call".
    expect(await cam.submit({ type: "action", playerId: "cam", action: { kind: "call" } })).toBeNull();
    // Host's view is stale; its submit hits a conflict, reloads, and the engine now says it's Ann's turn.
    expect(await host.submit({ type: "action", playerId: "cam", action: { kind: "fold" } })).toBe("It's ANN's turn, not CAM's");
    expect(host.snapshot!.events.filter((e) => e.type === "action").length).toBe(1);
  });

  it("a stale entry that still makes sense goes through after the reload", async () => {
    const { host, phone } = await setup();
    const ann = await phone("ann-phone", "ann");
    // Host adds Dee; Ann's phone (stale) doesn't know. Then host rebuys Ann from a stale view.
    const stale = new RoomClient(host.backend, host.roomId);
    await stale.refresh();
    expect(await host.submit({ type: "player_joined", playerId: "dee", name: "DEE", seat: 4, buyIn: 1000 })).toBeNull();
    expect(await stale.submit({ type: "rebuy", playerId: "ann", amount: 500 })).toBeNull();
    await ann.refresh();
    expect(ann.replayed.state!.players.ann!.stack).toBe(1500);
    expect(Object.keys(ann.replayed.state!.players)).toContain("dee");
  });

  it("undo: a player can take back their own last action, the host anything", async () => {
    const { host, phone } = await setup();
    await host.submit({ type: "hand_started", buttonSeat: 3 });
    const cam = await phone("cam-phone", "cam");
    const ann = await phone("ann-phone", "ann");
    await cam.submit({ type: "action", playerId: "cam", action: { kind: "call" } });
    await ann.refresh();
    expect(await ann.undo()).toBe("Only the host can undo that"); // last action is Cam's
    expect(await cam.undo()).toBeNull();
    expect(await cam.undo()).toBe("Only the host can undo that"); // now the last event is the deal
    await host.refresh();
    expect(await host.undo()).toBeNull();
    expect(host.replayed.state!.hand).toBeNull();
  });

  it("only the host edits or deletes history", async () => {
    const { host, phone } = await setup();
    const ann = await phone("ann-phone", "ann");
    expect(await ann.deleteEvent(3)).toBe(HOST_ONLY);
    expect(await host.replaceEvent(1, { type: "player_joined", playerId: "ann", name: "Annie", seat: 1, buyIn: 2000 })).toBeNull();
    await ann.refresh();
    expect(ann.replayed.state!.players.ann!.name).toBe("Annie");
    expect(await host.deleteEvent(3)).toBeNull();
    expect(host.replayed.state!.players.cam).toBeUndefined();
  });

  it("an edit against a stale log asks the host to look again", async () => {
    const { host, phone } = await setup();
    const stale = new RoomClient(host.backend, host.roomId);
    await stale.refresh();
    await (await phone("x", null)).refresh();
    await host.submit({ type: "rebuy", playerId: "ann", amount: 100 });
    expect(await stale.deleteEvent(3)).toContain("Someone changed the game");
  });

  it("one phone per player; the host can free a seat", async () => {
    const { host, phone } = await setup();
    await phone("ann-phone", "ann");
    const other = await phone("ann-new-phone", null);
    expect(await other.claim("ann")).toContain("Another phone already plays as them");
    expect(await other.claim("zed")).toBe("No such player in this game");
    expect(await other.release("ann")).toBe(HOST_ONLY);
    expect(await host.release("ann")).toBeNull();
    expect(await other.claim("ann")).toBeNull();
    expect(other.me!.playerId).toBe("ann");
  });

  it("wrong codes and outsiders are refused", async () => {
    const { hub, roomId } = await setup();
    const outsider = hub.client("outsider");
    await expect(outsider.joinRoom("ZZZZZZ")).rejects.toThrow("No game with that code");
    await expect(outsider.load(roomId)).rejects.toThrow("not in this game");
  });

  it("the server records who entered each event, not the phone", async () => {
    const { host, phone } = await setup();
    await host.submit({ type: "hand_started", buttonSeat: 3 }); // ann SB, ben BB, cam first
    const cam = await phone("cam-phone", "cam");
    // A tampered phone claims the host entered it, at time 0.
    const forged = { ...stamp({ type: "action", playerId: "cam", action: { kind: "call" } }), by: "host" as const, at: 0 };
    await cam.backend.append(cam.roomId, cam.snapshot!.version, forged);
    await host.refresh();
    const stored = host.snapshot!.events[host.snapshot!.events.length - 1]!;
    expect(stored.by).toBe("cam");
    expect(stored.at > 0).toBe(true);
    // The host's own entries are "host".
    await host.submit({ type: "action", playerId: "ann", action: { kind: "fold" } });
    expect(host.snapshot!.events[host.snapshot!.events.length - 1]!.by).toBe("host");
  });

  it("editing history keeps who entered each event", async () => {
    const { host, phone } = await setup();
    await host.submit({ type: "hand_started", buttonSeat: 3 });
    const cam = await phone("cam-phone", "cam");
    expect(await cam.submit({ type: "action", playerId: "cam", action: { kind: "raise", to: 100 } })).toBeNull();
    await host.refresh();
    const index = host.snapshot!.events.length - 1;
    expect(await host.replaceEvent(index, { type: "action", playerId: "cam", action: { kind: "raise", to: 150 } })).toBeNull();
    const edited = host.snapshot!.events[index]!;
    expect(edited.by).toBe("cam");
    expect(edited.type === "action" && edited.action.kind === "raise" && edited.action.to).toBe(150);
  });

  it("refuses malformed, oversized and duplicate events", async () => {
    const { host } = await setup();
    const v = host.snapshot!.version;
    const append = (e: unknown) => host.backend.append(host.roomId, v, e as never);
    await expect(append("hello")).rejects.toThrow("must be an object");
    await expect(append({ id: "x", type: "drop_table" })).rejects.toThrow("Unknown event type");
    await expect(append({ type: "rebuy", playerId: "ann", amount: 5 })).rejects.toThrow("needs an id");
    await expect(append({ id: "big", type: "rebuy", pad: "x".repeat(9000) })).rejects.toThrow("too large");
    const existing = host.snapshot!.events[1]!;
    await expect(append({ ...existing })).rejects.toThrow("already added");
  });

  it("subscribers hear about changes", async () => {
    const { hub, roomId, host } = await setup();
    let heard = 0;
    hub.client("host-uid").subscribe(roomId, () => heard++);
    await host.submit({ type: "rebuy", playerId: "ann", amount: 100 });
    expect(heard).toBe(1);
  });
});
