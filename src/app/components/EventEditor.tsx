import { useState, type FormEvent } from "react";
import type { GameEvent, PlayerAction } from "../../engine/types";
import { strip, type NewEvent } from "../log";
import { amountToInput, parseAmount } from "../money";
import { ErrorText, MoneyInput, useAmounts } from "../ui";
import { formatAmount, type AmountStyle } from "../../engine/money";

// Editing past events. Only fields a host would plausibly mistype are
// editable; anything else can be deleted and re-entered. Saving doesn't check
// whether later events still make sense: replay does that and the log shows
// the first one that broke.

const EDITABLE = new Set<GameEvent["type"]>([
  "game_created",
  "player_joined",
  "rebuy",
  "hand_started",
  "action",
  "hand_fast_entry",
  "pot_awarded",
]);

export const isEditable = (e: GameEvent) => EDITABLE.has(e.type);

/** A plain description for events replay hasn't reached. */
export function rawLabel(e: GameEvent, names: Record<string, string>, style: AmountStyle): string {
  const m = (c: number) => formatAmount(c, style);
  const n = (id: string) => names[id] ?? id;
  switch (e.type) {
    case "game_created":
      return `Game created · blinds ${m(e.config.smallBlind)} / ${m(e.config.bigBlind)}`;
    case "player_joined":
      return `${e.name} joins in seat ${e.seat} with ${m(e.buyIn)}`;
    case "rebuy":
      return `${n(e.playerId)} rebuys ${m(e.amount)}`;
    case "player_left":
      return `${n(e.playerId)} leaves`;
    case "player_sat_out":
      return `${n(e.playerId)} sits out`;
    case "player_returned":
      return `${n(e.playerId)} is back`;
    case "hand_started":
      return `New hand · button on seat ${e.buttonSeat}`;
    case "action":
      return `${n(e.playerId)} ${actionText(e.action, m)}`;
    case "hand_fast_entry":
      return `Quick entry: ${e.entries.map((x) => `${n(x.playerId)} ${m(x.contributed)}${x.folded ? " (folded)" : ""}`).join(", ")}`;
    case "pot_awarded":
      return `${e.winners.map(n).join(" and ")} awarded pot ${e.potIndex === 0 ? "(main)" : e.potIndex}`;
    case "game_ended":
      return "Game over";
  }
}

function actionText(a: PlayerAction, m: (c: number) => string): string {
  switch (a.kind) {
    case "fold":
      return "folds";
    case "check":
      return "checks";
    case "call":
      return "calls";
    case "bet":
      return `bets ${m(a.to)}`;
    case "raise":
      return `raises to ${m(a.to)}`;
  }
}

export function EventEditor({
  event,
  names,
  onSave,
  onCancel,
}: {
  event: GameEvent;
  names: Record<string, string>;
  onSave: (next: NewEvent) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { style } = useAmounts();
  const [draft, setDraft] = useState<NewEvent>(() => strip(event));
  const [error, setError] = useState<string | null>(null);
  // Money fields are edited as text and parsed on save.
  const [text, setText] = useState<Record<string, string>>(() => initialText(event, style));
  const setT = (k: string) => (v: string) => setText({ ...text, [k]: v });

  const cents = (k: string): number => {
    const v = parseAmount(text[k] ?? "", style);
    if (v === null) throw new Error(style.format === "chips" ? "Enter whole chip amounts like 500" : "Enter amounts like 1.50");
    return v;
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    try {
      onSave(build(draft, cents));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const allPlayers = Object.entries(names);

  return (
    <form className="editor stack" onSubmit={save}>
      <div className="muted small-text">Editing: {rawLabel(event, names, style)}</div>

      {draft.type === "game_created" && (
        <div className="row">
          <label>
            Small blind
            <MoneyInput value={text.sb ?? ""} onChange={setT("sb")} />
          </label>
          <label>
            Big blind
            <MoneyInput value={text.bb ?? ""} onChange={setT("bb")} />
          </label>
        </div>
      )}

      {draft.type === "player_joined" && (
        <div className="row">
          <label className="grow">
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            Seat
            <input
              type="number"
              min={1}
              value={draft.seat}
              onChange={(e) => setDraft({ ...draft, seat: Number(e.target.value) })}
            />
          </label>
          <label>
            Buy-in
            <MoneyInput value={text.amount ?? ""} onChange={setT("amount")} />
          </label>
        </div>
      )}

      {draft.type === "rebuy" && (
        <label>
          Rebuy amount
          <MoneyInput value={text.amount ?? ""} onChange={setT("amount")} />
        </label>
      )}

      {draft.type === "hand_started" && (
        <label>
          Button seat
          <input
            type="number"
            min={1}
            value={draft.buttonSeat}
            onChange={(e) => setDraft({ ...draft, buttonSeat: Number(e.target.value) })}
          />
        </label>
      )}

      {draft.type === "action" && (
        <div className="row center">
          <span>{names[draft.playerId] ?? draft.playerId}</span>
          <select
            value={draft.action.kind}
            onChange={(e) => {
              const kind = e.target.value as PlayerAction["kind"];
              const action: PlayerAction =
                kind === "bet" || kind === "raise" ? { kind, to: parseAmount(text.to ?? "", style) ?? 0 } : { kind };
              setDraft({ ...draft, action });
            }}
          >
            <option value="fold">folds</option>
            <option value="check">checks</option>
            <option value="call">calls</option>
            <option value="bet">bets</option>
            <option value="raise">raises to</option>
          </select>
          {(draft.action.kind === "bet" || draft.action.kind === "raise") && (
            <MoneyInput value={text.to ?? ""} onChange={setT("to")} label="Amount" />
          )}
        </div>
      )}

      {draft.type === "hand_fast_entry" &&
        draft.entries.map((entry, i) => (
          <div key={entry.playerId} className="row center">
            <span className="grow">{names[entry.playerId] ?? entry.playerId}</span>
            <MoneyInput value={text[`e${i}`] ?? ""} onChange={setT(`e${i}`)} />
            <label className="check">
              <input
                type="checkbox"
                checked={entry.folded}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    entries: draft.entries.map((x, j) => (j === i ? { ...x, folded: e.target.checked } : x)),
                  })
                }
              />
              folded
            </label>
          </div>
        ))}

      {draft.type === "pot_awarded" && (
        <div className="row wrap">
          {allPlayers.map(([id, name]) => {
            const on = draft.winners.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={`toggle ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    ...draft,
                    winners: on ? draft.winners.filter((w) => w !== id) : [...draft.winners, id],
                  })
                }
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function initialText(e: GameEvent, style: AmountStyle): Record<string, string> {
  const centsToInput = (n: number) => amountToInput(n, style);
  switch (e.type) {
    case "game_created":
      return { sb: centsToInput(e.config.smallBlind), bb: centsToInput(e.config.bigBlind) };
    case "player_joined":
      return { amount: centsToInput(e.buyIn) };
    case "rebuy":
      return { amount: centsToInput(e.amount) };
    case "action":
      return { to: e.action.kind === "bet" || e.action.kind === "raise" ? centsToInput(e.action.to) : "" };
    case "hand_fast_entry":
      return Object.fromEntries(e.entries.map((x, i) => [`e${i}`, centsToInput(x.contributed)]));
    default:
      return {};
  }
}

/** Folds the edited text fields back into the event. */
function build(draft: NewEvent, cents: (k: string) => number): NewEvent {
  switch (draft.type) {
    case "game_created":
      return { ...draft, config: { ...draft.config, smallBlind: cents("sb"), bigBlind: cents("bb") } };
    case "player_joined":
      return { ...draft, buyIn: cents("amount") };
    case "rebuy":
      return { ...draft, amount: cents("amount") };
    case "action":
      return draft.action.kind === "bet" || draft.action.kind === "raise"
        ? { ...draft, action: { kind: draft.action.kind, to: cents("to") } }
        : draft;
    case "hand_fast_entry":
      return { ...draft, entries: draft.entries.map((x, i) => ({ ...x, contributed: cents(`e${i}`) })) };
    case "pot_awarded":
      if (draft.winners.length === 0) throw new Error("Pick at least one winner");
      return draft;
    default:
      return draft;
  }
}
