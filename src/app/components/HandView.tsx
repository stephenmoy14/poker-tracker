import { useState, type FormEvent } from "react";
import type { GameState } from "../../engine/types";
import { legalActions, nextPotIndex, potLabel } from "../../engine/hand";
import type { Game } from "../game";
import { clampToUnit } from "../money";
import { ErrorText, MoneyInput, nameOf, useAmounts } from "../ui";

/** Parent re-mounts this after every event (key), so local input state resets. */
export function HandView({ game, state }: { game: Game; state: GameState }) {
  const hand = state.hand!;
  const [quick, setQuick] = useState(false);
  const potTotal = hand.players.reduce((s, p) => s + p.committedTotal, 0) - (hand.uncalledReturn?.amount ?? 0);

  const myTurn = !!hand.toAct && game.can.actFor(hand.toAct);

  return (
    <>
      {hand.phase === "betting" && !quick && myTurn && <ActionPanel game={game} state={state} potTotal={potTotal} />}
      {hand.phase === "betting" && !quick && !myTurn && hand.toAct && (
        <section className="card waiting" aria-live="polite">
          <h2>Waiting for {nameOf(state, hand.toAct)}…</h2>
          <p className="hint">Their phone (or the host) enters what they do.</p>
        </section>
      )}
      {hand.phase === "betting" && game.can.host && (
        <div className="center-row">
          <button type="button" className="link" onClick={() => setQuick(!quick)}>
            {quick ? "Back to action by action" : "Quick entry: just enter totals"}
          </button>
        </div>
      )}
      {hand.phase === "betting" && quick && game.can.host && <QuickEntry game={game} state={state} />}
      {hand.phase === "awarding" && <Awarding game={game} state={state} />}
    </>
  );
}

function ActionPanel({ game, state, potTotal }: { game: Game; state: GameState; potTotal: number }) {
  const { fmt: money, toInput, parse, example } = useAmounts();
  const hand = state.hand!;
  const legal = legalActions(state);
  const [amount, setAmount] = useState(legal?.minBetOrRaiseTo != null ? toInput(legal.minBetOrRaiseTo) : "");
  const [error, setError] = useState<string | null>(null);
  if (!legal || !hand.toAct) return null;

  const id = hand.toAct;
  const name = nameOf(state, id);
  const stack = state.players[id]!.stack;
  const act = (action: Parameters<typeof dispatchAction>[2]) => void dispatchAction(game, id, action).then(setError);
  const busy = game.pending;
  const isMe = game.room?.me?.playerId === id;
  const isBet = hand.currentBet === 0;
  const min = legal.minBetOrRaiseTo;
  const max = legal.maxBetOrRaiseTo;

  const sized = (fraction: number) => {
    // Pot-sized raise: call first, then raise by the size of the pot after the call.
    const raiseBy = (potTotal + legal.callAmount) * fraction;
    return clampToUnit(hand.currentBet + raiseBy, state.config.unit, min ?? 0, max);
  };

  const submitBet = (e: FormEvent) => {
    e.preventDefault();
    const to = parse(amount);
    if (to === null) return setError(`Enter an amount like ${example}`);
    act(isBet ? { kind: "bet", to } : { kind: "raise", to });
  };

  const typed = parse(amount);
  return (
    <section className="card action">
      <h2>{isMe ? "Your turn" : `${name} to act`}</h2>
      {legal.callAmount > 0 && <p className="muted">{money(legal.callAmount)} to call</p>}
      <div className="row actions">
        <button type="button" disabled={busy} onClick={() => act({ kind: "fold" })}>
          Fold
        </button>
        {legal.canCheck ? (
          <button type="button" className="primary" disabled={busy} onClick={() => act({ kind: "check" })}>
            Check
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={() => act({ kind: "call" })}>
            Call {money(legal.callAmount)}
            {legal.callAmount === stack ? " (all-in)" : ""}
          </button>
        )}
      </div>

      {min !== null ? (
        <form className="bet-form" onSubmit={submitBet}>
          <label htmlFor="bet-amount">{isBet ? "Bet" : "Raise to"}</label>
          <div className="row center">
            <MoneyInput id="bet-amount" value={amount} onChange={setAmount} />
            <button type="submit" className="primary" disabled={busy}>
              {typed === max ? `All-in ${money(max)}` : isBet ? "Bet" : "Raise"}
            </button>
          </div>
          <div className="row chips">
            <button type="button" className="small" onClick={() => setAmount(toInput(min))}>
              Min {money(min)}
            </button>
            <button type="button" className="small" onClick={() => setAmount(toInput(sized(0.5)))}>
              ½ pot
            </button>
            <button type="button" className="small" onClick={() => setAmount(toInput(sized(1)))}>
              Pot
            </button>
            <button type="button" className="small" onClick={() => setAmount(toInput(max))}>
              All-in
            </button>
          </div>
          {min === max && min < (isBet ? state.config.bigBlind : hand.currentBet + hand.lastRaiseSize) && (
            <p className="hint">Not enough for a full raise: all-in is the only raise.</p>
          )}
        </form>
      ) : (
        !legal.canCheck && <p className="hint">{name} can only call or fold here.</p>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function dispatchAction(
  game: Game,
  playerId: string,
  action: { kind: "fold" } | { kind: "check" } | { kind: "call" } | { kind: "bet"; to: number } | { kind: "raise"; to: number },
) {
  return game.dispatch({ type: "action", playerId, action });
}

function QuickEntry({ game, state }: { game: Game; state: GameState }) {
  const { toInput, parse } = useAmounts();
  const hand = state.hand!;
  const [rows, setRows] = useState(() =>
    hand.players.map((hp) => ({ playerId: hp.playerId, amount: toInput(hp.committedTotal), folded: hp.folded })),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const entries = [];
    for (const r of rows) {
      const cents = parse(r.amount);
      if (cents === null) return setError(`Enter an amount for ${nameOf(state, r.playerId)}`);
      entries.push({ playerId: r.playerId, contributed: cents, folded: r.folded });
    }
    void game.dispatch({ type: "hand_fast_entry", entries }).then(setError);
  };

  return (
    <section className="card">
      <h2>Quick entry</h2>
      <p className="hint">
        What each player put in this hand in total, blinds included. Tick anyone who folded. Betting ends when you
        save.
      </p>
      <form onSubmit={submit} className="stack">
        {rows.map((r, i) => (
          <div key={r.playerId} className="row center">
            <span className="grow">{nameOf(state, r.playerId)}</span>
            <MoneyInput
              value={r.amount}
              label={`${nameOf(state, r.playerId)} total`}
              onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={r.folded}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, folded: e.target.checked } : x)))}
              />
              folded
            </label>
          </div>
        ))}
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="primary">
          Save totals
        </button>
      </form>
    </section>
  );
}

function Awarding({ game, state }: { game: Game; state: GameState }) {
  const { fmt: money } = useAmounts();
  const hand = state.hand!;
  const next = nextPotIndex(hand)!;
  const [winners, setWinners] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const awarded = new Map(hand.awards.map((a) => [a.potIndex, a]));
  const toggle = (id: string) =>
    setWinners(winners.includes(id) ? winners.filter((w) => w !== id) : [...winners, id]);

  return (
    <section className="card action">
      <h2>Showdown</h2>
      {hand.uncalledReturn && (
        <p className="muted">
          {money(hand.uncalledReturn.amount)} uncalled, returned to {nameOf(state, hand.uncalledReturn.playerId)}
        </p>
      )}
      <ul className="pots">
        {hand.pots.map((pot, i) => {
          const label = potTitle((i));
          const done = awarded.get(i);
          return (
            <li key={i} className={i === next ? "pot-row current" : "pot-row"}>
              <div className="row center">
                <strong className="grow">
                  {label} · {money(pot.amount)}
                </strong>
                {done && <span className="badge">awarded</span>}
                {!done && i !== next && <span className="badge">after {potLabel(next)}</span>}
              </div>
              <div className="muted small-text">{pot.eligible.map((id) => nameOf(state, id)).join(", ")}</div>
              {done && (
                <div className="small-text">
                  {Object.entries(done.payouts)
                    .map(([id, amt]) => `${nameOf(state, id)} ${money(amt)}`)
                    .join(", ")}
                </div>
              )}
              {i === next && !game.can.host && <p className="hint">The host picks the winner.</p>}
              {i === next && game.can.host && (
                <>
                  <p className="hint">Who won? Pick more than one for a split.</p>
                  <div className="row wrap">
                    {pot.eligible.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`toggle ${winners.includes(id) ? "on" : ""}`}
                        aria-pressed={winners.includes(id)}
                        onClick={() => toggle(id)}
                      >
                        {nameOf(state, id)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={winners.length === 0 || game.pending}
                    onClick={() => void game.dispatch({ type: "pot_awarded", potIndex: i, winners }).then(setError)}
                  >
                    Award {potLabel(i)}
                    {winners.length > 1 ? " (split)" : ""}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

const potTitle = (i: number) => (i === 0 ? "Main pot" : `Side pot ${i}`);
