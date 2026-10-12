import { useState } from "react";
import type { Game } from "../game";
import { useGame } from "../useGame";
import { listGames } from "../storage";
import { TableScreen } from "./TableScreen";
import { LogScreen } from "./LogScreen";
import { SettleScreen } from "./SettleScreen";
import { AmountProvider, ErrorText } from "../ui";
import { RoomBar } from "../components/RoomBar";
import { WhoAreYou } from "../components/WhoAreYou";

type Tab = "table" | "log" | "settle";

/** A game kept on this phone only. */
export function LocalGameScreen({ gameId, onExit }: { gameId: string; onExit: () => void }) {
  const game = useGame(gameId);
  const meta = listGames().find((g) => g.id === gameId);
  return <GameView game={game} title={meta?.name ?? "Game"} onExit={onExit} />;
}

/** The game screens, for local and shared games alike. */
export function GameView({ game, title, onExit }: { game: Game; title: string; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("table");
  const [notice, setNotice] = useState<string | null>(null);
  const style = game.state?.config ?? { format: "money" as const, currency: "USD" };
  const chips = style.format === "chips";

  return (
    <AmountProvider value={style}>
      <main className="page">
        <header className="topbar">
          <button type="button" className="link" onClick={onExit}>
            ‹ Games
          </button>
          <h1 className="title">{title}</h1>
          <button
            type="button"
            className="small"
            disabled={!game.can.undo || game.events.length <= 1 || game.pending}
            onClick={() => void game.undo().then(setNotice)}
            title="Remove the last event"
          >
            Undo
          </button>
        </header>

        {game.room && <RoomBar game={game} room={game.room} />}
        <ErrorText>{notice}</ErrorText>

        {game.saveFailed && (
          <p className="banner warn">This browser isn't saving. Keep this tab open until the game ends.</p>
        )}

        {game.error && (
          <div className="banner error">
            <span>
              Event {game.error.index + 1} is no longer valid: {game.error.message}
              {!game.can.host && " The host needs to fix it."}
            </span>
            {tab !== "log" && (
              <button type="button" className="small" onClick={() => setTab("log")}>
                {game.can.host ? "Fix in log" : "See log"}
              </button>
            )}
          </div>
        )}

        {game.room && game.state && <WhoAreYou game={game} room={game.room} state={game.state} />}

        <nav className="tabs" role="tablist">
          {(["table", "log", "settle"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t === "table" ? "Table" : t === "log" ? "Log" : chips ? "Results" : "Settle up"}
            </button>
          ))}
        </nav>

        {!game.state ? (
          <LogScreen game={game} />
        ) : tab === "table" ? (
          <TableScreen game={game} state={game.state} />
        ) : tab === "log" ? (
          <LogScreen game={game} />
        ) : (
          <SettleScreen game={game} state={game.state} />
        )}
      </main>
    </AmountProvider>
  );
}
