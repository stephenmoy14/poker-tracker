import { useState, type FormEvent } from "react";
import type { GameState, Player } from "../../engine/types";
import type { Game } from "../game";
import { ConfirmButton, ErrorText, MoneyInput, useAmounts } from "../ui";

/** Seats, stacks and between-hands actions: rebuy, sit out, return, leave. */
export function PlayersPanel({ game, state }: { game: Game; state: GameState }) {
  const { fmt, signed } = useAmounts();
  const players = Object.values(state.players).sort((a, b) => a.seat - b.seat);
  const here = players.filter((p) => p.status !== "left");
  const gone = players.filter((p) => p.status === "left");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="card">
      <h2>Players</h2>
      {here.length === 0 && <p className="muted">No one's sitting yet.</p>}
      <ul className="list">
        {here.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="list-row link"
              aria-expanded={open === p.id}
              disabled={!game.can.host}
              onClick={() => setOpen(open === p.id ? null : p.id)}
            >
              <span className="seat">{p.seat}</span>
              <span className="grow">
                <strong>{p.name}</strong>
                {p.status === "sitting_out" && <span className="badge">sitting out</span>}
                {p.stack === 0 && p.status === "seated" && <span className="badge warn">no chips</span>}
              </span>
              <span className="num">{fmt(p.stack)}</span>
              <span className={`num small-text ${tone(p.stack - p.totalBuyIn)}`}>{signed(p.stack - p.totalBuyIn)}</span>
            </button>
            {open === p.id && game.can.host && <PlayerActions key={game.events.length} game={game} player={p} />}
          </li>
        ))}
      </ul>
      {gone.length > 0 && (
        <>
          <h3>Left the game</h3>
          <ul className="list">
            {gone.map((p) => (
              <li key={p.id} className="list-row muted">
                <span className="grow">{p.name}</span>
                <span className="num">cashed out {fmt(p.stack)}</span>
                <span className={`num small-text ${tone(p.stack - p.totalBuyIn)}`}>{signed(p.stack - p.totalBuyIn)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const tone = (net: number) => (net > 0 ? "up" : net < 0 ? "down" : "muted");

function PlayerActions({ game, player }: { game: Game; player: Player }) {
  const { fmt, parse, example } = useAmounts();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rebuy = (e: FormEvent) => {
    e.preventDefault();
    const value = parse(amount);
    if (value === null) return setError(`Enter an amount like ${example}`);
    void game.dispatch({ type: "rebuy", playerId: player.id, amount: value }).then(setError);
  };

  return (
    <div className="drawer">
      <form className="row center" onSubmit={rebuy}>
        <MoneyInput value={amount} onChange={setAmount} label={`Rebuy amount for ${player.name}`} />
        <button type="submit">Rebuy</button>
      </form>
      <div className="row">
        {player.status === "sitting_out" ? (
          <button type="button" onClick={() => void game.dispatch({ type: "player_returned", playerId: player.id }).then(setError)}>
            Back in
          </button>
        ) : (
          <button type="button" onClick={() => void game.dispatch({ type: "player_sat_out", playerId: player.id }).then(setError)}>
            Sit out
          </button>
        )}
        <ConfirmButton
          label={`Leave with ${fmt(player.stack)}`}
          confirmLabel="Confirm leave"
          onConfirm={() => void game.dispatch({ type: "player_left", playerId: player.id }).then(setError)}
        />
      </div>
      <p className="hint">Total bought in: {fmt(player.totalBuyIn)}</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
