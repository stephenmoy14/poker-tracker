import { useEffect, useState } from "react";
import type { SyncBackend } from "../../sync/types";
import { getBackend } from "../../sync";
import { useRoomGame } from "../useRoomGame";
import { rememberRoom } from "../storage";
import { GameView } from "./GameScreen";
import { SERVER_ASLEEP } from "../../sync/errors";

/** "#/room/K7P2QX": joins the room (if needed) and shows it live. */
export function RoomScreen({ code, onExit }: { code: string; onExit: () => void }) {
  const [joined, setJoined] = useState<{ backend: SyncBackend; roomId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const backend = await getBackend();
        const { roomId } = await backend.joinRoom(code);
        if (!cancelled) setJoined({ backend, roomId });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <Problem title={`Couldn't open game ${code}`} message={error} onExit={onExit} />;
  if (!joined) return <Loading text={`Joining game ${code}…`} />;
  return <RoomGame key={joined.roomId} {...joined} code={code} onExit={onExit} />;
}

function RoomGame({ backend, roomId, code, onExit }: { backend: SyncBackend; roomId: string; code: string; onExit: () => void }) {
  const game = useRoomGame(roomId, backend);
  const name = game.room?.name;

  useEffect(() => {
    if (name) rememberRoom({ code, roomId, name, joinedAt: Date.now() });
  }, [code, roomId, name]);

  if (game.loadError) return <Problem title={`Couldn't load game ${code}`} message={game.loadError} onExit={onExit} />;
  if (game.loading || !game.room) return <Loading text="Loading the game…" />;
  return <GameView game={game} title={game.room.name} onExit={onExit} />;
}

function Loading({ text }: { text: string }) {
  return (
    <main className="page">
      <section className="card center-row">
        <p className="muted">{text}</p>
      </section>
    </main>
  );
}

function Problem({ title, message, onExit }: { title: string; message: string; onExit: () => void }) {
  const asleep = message === SERVER_ASLEEP;
  return (
    <main className="page">
      <section className="card">
        <h2>{asleep ? "The game server is asleep" : title}</h2>
        <p className={asleep ? "" : "error"}>{message}</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <button type="button" onClick={onExit}>
            Back to games
          </button>
        </div>
      </section>
    </main>
  );
}
