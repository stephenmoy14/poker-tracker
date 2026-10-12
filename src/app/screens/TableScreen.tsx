import { useMemo, useRef, useState } from "react";
import type { GameState, PlayerId } from "../../engine/types";
import { dealablePlayers, suggestButtonSeat } from "../../engine/hand";
import type { Game } from "../game";
import { ErrorText, nameOf, useAmounts } from "../ui";
import { lastActionOf } from "../lastAction";
import { PlayersPanel } from "../components/PlayersPanel";
import { HandView } from "../components/HandView";
import { TableDiagram } from "../components/TableDiagram";
import { AddPlayer } from "../components/AddPlayer";

export function TableScreen({ game, state }: { game: Game; state: GameState }) {
  const hand = state.hand;
  const inHand = !!hand && hand.phase !== "complete";
  // undefined = form closed; null = empty table; id = sit after that player
  const [addAfter, setAddAfter] = useState<PlayerId | null | undefined>(undefined);
  const addRef = useRef<HTMLDivElement>(null);
  const lastAction = useMemo(() => lastActionOf(game.events, state), [game.events, state]);
  const ended = state.status === "ended";

  const openAdd = (after: PlayerId | null) => {
    setAddAfter(after);
    setTimeout(() => addRef.current?.querySelector("input")?.focus(), 0);
  };

  return (
    <>
      <TableDiagram
        state={state}
        lastAction={lastAction}
        meId={game.room?.me?.playerId ?? null}
        onAdd={ended || !game.can.host ? undefined : openAdd}
      />

      {addAfter !== undefined && (
        <section className="card" ref={addRef}>
          <AddPlayer
            key={`${String(addAfter)}-${game.events.length}`}
            game={game}
            state={state}
            initialAfter={addAfter}
            onDone={() => setAddAfter(undefined)}
          />
        </section>
      )}

      {ended ? (
        <section className="card">
          <h2>Game over</h2>
          <p>See the results tab. Undo reopens the game.</p>
        </section>
      ) : inHand ? (
        <HandView key={game.events.length} game={game} state={state} />
      ) : (
        <>
          {hand && <LastHand state={state} />}
          <StartHand key={game.events.length} game={game} state={state} />
          <PlayersPanel game={game} state={state} />
          {addAfter === undefined && game.can.host && (
            <div className="center-row">
              <button type="button" className="link" onClick={() => openAdd(null)}>
                + Add player
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function LastHand({ state }: { state: GameState }) {
  const { fmt } = useAmounts();
  const hand = state.hand!;
  const awards = [...hand.awards].sort((a, b) => a.potIndex - b.potIndex);
  return (
    <section className="card subtle">
      <h2>Hand #{hand.number} result</h2>
      <ul className="plain">
        {awards.map((a) => (
          <li key={a.potIndex}>
            {hand.pots.length > 1 ? `${potTitle(a.potIndex)}: ` : ""}
            {Object.entries(a.payouts)
              .map(([id, amount]) => `${nameOf(state, id)} wins ${fmt(amount)}`)
              .join(", ")}
          </li>
        ))}
        {hand.uncalledReturn && (
          <li className="muted">
            {fmt(hand.uncalledReturn.amount)} uncalled, returned to {nameOf(state, hand.uncalledReturn.playerId)}
          </li>
        )}
      </ul>
    </section>
  );
}

function StartHand({ game, state }: { game: Game; state: GameState }) {
  const dealable = dealablePlayers(state);
  const suggested = suggestButtonSeat(state);
  const [seat, setSeat] = useState<number | null>(suggested);
  const [error, setError] = useState<string | null>(null);

  if (dealable.length < 2) {
    return (
      <section className="card">
        <h2>Next hand</h2>
        <p className="muted">Add at least two players with chips to deal a hand. Tap + on the table.</p>
      </section>
    );
  }
  const handNumber = state.handsPlayed + 1;
  if (!game.can.host) {
    return (
      <section className="card waiting">
        <h2>Hand #{handNumber}</h2>
        <p className="muted">Waiting for the host to deal.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>Hand #{handNumber}</h2>
      <div className="row center">
        <label className="grow">
          Button
          <select value={seat ?? ""} onChange={(e) => setSeat(Number(e.target.value))}>
            {dealable.map((p) => (
              <option key={p.id} value={p.seat}>
                {p.name}
                {p.seat === suggested ? " · next" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={game.pending}
          onClick={() => void game.dispatch({ type: "hand_started", buttonSeat: seat ?? suggested! }).then(setError)}
        >
          Deal
        </button>
      </div>
      <p className="hint">Blinds post automatically. Sitting-out players and players with no chips are skipped.</p>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

const potTitle = (i: number) => (i === 0 ? "Main pot" : `Side pot ${i}`);
