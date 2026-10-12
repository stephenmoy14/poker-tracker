import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameEvent } from "../engine/types";
import { replay } from "../engine/replay";
import { type NewEvent, rejectionReason, removeAt, replaceAt, stamp, undoLast } from "./log";
import { loadEvents, saveEvents } from "./storage";
import { EVERYTHING, type Game } from "./game";

/**
 * A game kept on this phone only. `dispatch` checks an event against the
 * current state first and returns the reason if it's rejected, so the UI can
 * show it without adding anything to the log.
 */
export function useGame(gameId: string): Game {
  const [events, setEvents] = useState<GameEvent[]>(() => loadEvents(gameId));
  const [saveFailed, setSaveFailed] = useState(false);

  // Callers mount this with key={gameId}, so switching games starts fresh
  // and never saves one game's events under another's id.
  useEffect(() => {
    setSaveFailed(!saveEvents(gameId, events));
  }, [gameId, events]);

  const { state, error } = useMemo(() => replay(events), [events]);

  const dispatch = useCallback(
    async (e: NewEvent): Promise<string | null> => {
      if (error) return `Event ${error.index + 1} is no longer valid. Fix or delete it in the log first.`;
      const event = stamp(e);
      const reason = rejectionReason(state, event);
      if (reason) return reason;
      setEvents((prev) => [...prev, event]);
      return null;
    },
    [state, error],
  );

  const change = (f: (prev: GameEvent[]) => GameEvent[]) => async () => {
    try {
      setEvents(f(events));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  return {
    events,
    state,
    error,
    dispatch,
    undo: change((prev) => (prev.length > 1 ? undoLast(prev) : prev)),
    replaceEvent: (index, next) => change((prev) => replaceAt(prev, index, next))(),
    deleteEvent: (index) => change((prev) => removeAt(prev, index))(),
    pending: false,
    saveFailed,
    can: EVERYTHING,
    room: null,
  };
}
