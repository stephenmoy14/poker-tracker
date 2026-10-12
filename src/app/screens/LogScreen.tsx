import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameEvent } from "../../engine/types";
import { describeLog, type DescribedEvent } from "../../engine/describe";
import type { Game } from "../game";
import { ConfirmButton, ErrorText, useAmounts } from "../ui";
import { EventEditor, isEditable, rawLabel } from "../components/EventEditor";

/**
 * The full history. Each event can be edited or deleted; the log then
 * replays. If an edit makes a later event impossible, replay stops there and
 * that event is shown in red to fix or delete. Events after it are listed but
 * not applied until it's fixed.
 */
export function LogScreen({ game }: { game: Game }) {
  const { style } = useAmounts();
  const log = describeLog(game.events);
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const names = playerNames(game.events);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, []);

  // Group consecutive entries by hand.
  const groups: { hand: number | null; entries: DescribedEvent[] }[] = [];
  for (const entry of log.entries) {
    const last = groups[groups.length - 1];
    if (last && last.hand === entry.handNumber) last.entries.push(entry);
    else groups.push({ hand: entry.handNumber, entries: [entry] });
  }

  const row = (index: number, content: ReactNode, className = "") => {
    const event = game.events[index]!;
    if (editing === index) {
      return (
        <li key={event.id} className={`log-entry editing ${className}`}>
          <EventEditor
            event={event}
            names={names}
            onCancel={() => setEditing(null)}
            onSave={async (next) => {
              const reason = await game.replaceEvent(index, next);
              setNotice(reason);
              if (!reason) setEditing(null);
            }}
          />
        </li>
      );
    }
    return (
      <li key={event.id} className={`log-entry ${className}`}>
        <div className="grow">
          {content}
          {/* Shared games: say when the host entered a player's action for them. */}
          {game.room && event.type === "action" && event.by === "host" && (
            <div className="line auto entered-by">entered by the host</div>
          )}
        </div>
        <div className="log-tools">
          {game.can.host && isEditable(event) && (
            <button type="button" className="small" onClick={() => setEditing(index)}>
              Edit
            </button>
          )}
          {game.can.host && index > 0 && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete?"
              className="small"
              onConfirm={() => void game.deleteEvent(index).then(setNotice)}
            />
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="card log">
      <div className="hand-head">
        <h2>Log</h2>
        <span className="muted small-text">{game.events.length} events</span>
      </div>
      <ErrorText>{notice}</ErrorText>
      {!game.can.host && <p className="hint">Only the host can edit or delete past events.</p>}
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.hand !== null && <h3 className="log-hand">Hand #{g.hand}</h3>}
          <ul className="log-list">
            {g.entries.map((entry) =>
              row(
                entry.index,
                entry.lines.map((l, i) => (
                  <div key={i} className={l.kind === "auto" ? "line auto" : "line"}>
                    {l.text}
                  </div>
                )),
              ),
            )}
          </ul>
        </div>
      ))}

      {log.error && (
        <ul className="log-list">
          {row(
            log.error.index,
            <>
              <div className="line">{rawLabel(game.events[log.error.index]!, names, style)}</div>
              <div className="line invalid">No longer valid: {log.error.message}</div>
            </>,
            "invalid-entry",
          )}
          {game.events.slice(log.error.index + 1).map((e, i) =>
            row(log.error!.index + 1 + i, <div className="line">{rawLabel(e, names, style)}</div>, "pending"),
          )}
        </ul>
      )}
      {log.error && log.error.index + 1 < game.events.length && (
        <p className="hint">Greyed events aren't applied until the red one is fixed or deleted.</p>
      )}
      <div ref={bottom} />
    </section>
  );
}

/** Names from join events, so even unapplied events can show who they're about. */
function playerNames(events: readonly GameEvent[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const e of events) if (e.type === "player_joined") names[e.playerId] = e.name;
  return names;
}
