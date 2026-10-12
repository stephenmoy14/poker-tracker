import { useState, type FormEvent } from "react";
import type { GameState, PlayerId } from "../../engine/types";
import { seatAfter, seatedPlayers } from "../../engine/seats";
import { isBetweenHands } from "../../engine/hand";
import type { Game } from "../game";
import { newId } from "../log";
import { ErrorText, MoneyInput, useAmounts } from "../ui";

/**
 * Adds a player at a chosen spot: "between Ann and Ben". The engine turns
 * that into a seat number and moves others along if there's no empty seat.
 */
export function AddPlayer({
  game,
  state,
  initialAfter,
  onDone,
}: {
  game: Game;
  state: GameState;
  initialAfter?: PlayerId | null;
  onDone?: () => void;
}) {
  const { parse, toInput, example } = useAmounts();
  const seated = seatedPlayers(state);
  // Default spot: after the last seated player (i.e. at the end).
  const [after, setAfter] = useState<PlayerId | null>(initialAfter ?? seated[seated.length - 1]?.id ?? null);
  const [name, setName] = useState("");
  const [buyIn, setBuyIn] = useState(() => toInput(lastJoinBuyIn(game) ?? state.config.bigBlind * 100));
  const [error, setError] = useState<string | null>(null);

  if (seated.length >= state.config.maxSeats) return <p className="muted">The table is full.</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parse(buyIn);
    if (amount === null) return setError(`Enter a buy-in like ${example}`);
    const reason = await game.dispatch({
      type: "player_joined",
      playerId: newId(),
      name,
      seat: seatAfter(state, after),
      buyIn: amount,
    });
    setError(reason);
    if (!reason) onDone?.();
  };

  const spots = seated.map((p, i) => {
    const next = seated[(i + 1) % seated.length]!;
    return { id: p.id, label: seated.length === 1 ? `Next to ${p.name}` : `Between ${p.name} and ${next.name}` };
  });

  return (
    <form className="add-player" onSubmit={submit}>
      <h3>Add player</h3>
      <div className="row">
        <label className="grow">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={40} />
        </label>
        <label>
          Buy-in
          <MoneyInput value={buyIn} onChange={setBuyIn} label="Buy-in" />
        </label>
      </div>
      {spots.length > 0 && (
        <label>
          Sits
          <select value={after ?? ""} onChange={(e) => setAfter(e.target.value)} aria-label="Where they sit">
            {spots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!isBetweenHands(state) && <p className="hint">They join now and are dealt in from the next hand.</p>}
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button type="submit" className="primary" disabled={game.pending}>
          Add
        </button>
        {onDone && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function lastJoinBuyIn(game: Game): number | null {
  for (let i = game.events.length - 1; i >= 0; i--) {
    const e = game.events[i]!;
    if (e.type === "player_joined") return e.buyIn;
  }
  return null;
}
