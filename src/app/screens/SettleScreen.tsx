import type { GameState } from "../../engine/types";
import { isBetweenHands } from "../../engine/hand";
import { settlement } from "../../engine/settlement";
import type { Game } from "../game";
import { ConfirmButton, nameOf, useAmounts } from "../ui";

export function SettleScreen({ game, state }: { game: Game; state: GameState }) {
  const { fmt: money, signed: signedMoney, isChips } = useAmounts();
  if (!isBetweenHands(state)) {
    return (
      <section className="card">
        <h2>{isChips ? "Results" : "Settle up"}</h2>
        <p className="muted">Finish the current hand to see results.</p>
      </section>
    );
  }

  const { nets, payments } = settlement(state);
  // Chip games: rank by result, no payments.
  const rows = isChips ? [...nets].sort((a, b) => b.net - a.net) : nets;
  const ended = state.status === "ended";

  return (
    <>
      <section className="card">
        <h2>Results</h2>
        <table className="results">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">{isChips ? "Chips in" : "Bought in"}</th>
              <th className="num">{ended ? "Cashed out" : "Stack"}</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = state.players[r.playerId]!;
              return (
                <tr key={r.playerId}>
                  <td>
                    {p.name}
                    {p.status === "left" && <span className="badge">left</span>}
                  </td>
                  <td className="num">{money(p.totalBuyIn)}</td>
                  <td className="num">{money(p.stack)}</td>
                  <td className={`num ${r.net > 0 ? "up" : r.net < 0 ? "down" : ""}`}>{signedMoney(r.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!ended && <p className="hint">Based on current stacks. Players still sitting can keep playing.</p>}
      </section>

      {!isChips && (
      <section className="card">
        <h2>Payments</h2>
        {payments.length === 0 ? (
          <p className="muted">Everyone's even.</p>
        ) : (
          <ul className="payments">
            {payments.map((p, i) => (
              <li key={i}>
                <strong>{nameOf(state, p.from)}</strong> pays <strong>{nameOf(state, p.to)}</strong>
                <span className="num">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">The fewest payments that settle everyone up.</p>
      </section>
      )}

      {!ended && game.can.host && (
        <section className="card">
          <ConfirmButton
            label="End game"
            confirmLabel="Tap again to end the game"
            className="wide"
            onConfirm={() => void game.dispatch({ type: "game_ended" })}
          />
          <p className="hint">Ending stops new hands. Undo reopens it.</p>
        </section>
      )}
    </>
  );
}
