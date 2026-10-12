import { useEffect, useMemo, useReducer, useState } from "react";
import type { SyncBackend } from "../sync/types";
import { RoomClient } from "../sync/roomClient";
import { capabilities } from "../sync/rules";
import type { Game } from "./game";
import type { NewEvent } from "./log";

const OFFLINE = "Reconnecting… your entry wasn't sent. Try again in a moment.";

/**
 * A game shared between phones. Everything is drawn from the server's log;
 * nothing is entered while the live connection is down (shared games assume
 * everyone's online).
 */
export function useRoomGame(roomId: string, backend: SyncBackend): Game & { loading: boolean; loadError: string | null } {
  const client = useMemo(() => new RoomClient(backend, roomId), [backend, roomId]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [live, setLive] = useState(false);
  const [pending, setPending] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const off = client.onChange(rerender);
    const reload = () =>
      client.refresh().then(
        () => setLoadError(null),
        (err) => setLoadError(err instanceof Error ? err.message : String(err)),
      );
    void reload();
    const unsubscribe = backend.subscribe(roomId, () => void reload(), setLive);
    const goneOffline = () => setLive(false);
    window.addEventListener("offline", goneOffline);
    return () => {
      off();
      unsubscribe();
      window.removeEventListener("offline", goneOffline);
    };
  }, [client, backend, roomId]);

  const snap = client.snapshot;
  const { state, error } = client.replayed;
  const events = snap?.events ?? [];

  const send = async (f: () => Promise<string | null>): Promise<string | null> => {
    if (!live) return OFFLINE;
    setPending((n) => n + 1);
    try {
      return await f();
    } finally {
      setPending((n) => n - 1);
    }
  };

  return {
    events,
    state,
    error,
    dispatch: (e: NewEvent) => send(() => client.submit(e)),
    undo: () => send(() => client.undo()),
    replaceEvent: (i, next) => send(() => client.replaceEvent(i, next)),
    deleteEvent: (i) => send(() => client.deleteEvent(i)),
    pending: pending > 0,
    saveFailed: false,
    can: capabilities(client.me, events),
    room: snap
      ? {
          code: snap.code,
          name: snap.name,
          members: snap.members,
          me: client.me,
          live,
          backendLabel: backend.label,
          claim: (playerId) => send(() => client.claim(playerId)),
          release: (playerId) => send(() => client.release(playerId)),
        }
      : null,
    loading: !snap && !loadError,
    loadError,
  };
}
