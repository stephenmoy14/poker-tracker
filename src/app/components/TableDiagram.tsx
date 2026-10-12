import type { GameState, HandPlayer, PlayerId } from "../../engine/types";
import { seatedPlayers } from "../../engine/seats";
import { useAmounts } from "../ui";

// An oval table with players placed clockwise in seat order. The layout stays
// put during a hand (first seat at the bottom), so people find themselves in
// the same spot every time. The player to act is drawn larger; the last
// recorded action shows as a bubble on that player's seat. "+" spots between
// players add someone right there.

export interface LastAction {
  playerId: PlayerId;
  text: string; // "Raises to $1.00"
}

const STREET: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

const ASPECT = 1.08; // table height / width (matches .table-wrap aspect-ratio)

/** Point on the oval at angle t (0 = bottom centre, increasing clockwise). Percent coords. */
function at(t: number, rx: number, ry: number) {
  const a = Math.PI / 2 + t;
  return { left: 50 + rx * Math.cos(a), top: 50 + ry * Math.sin(a) };
}

/**
 * Angles that split the oval into equal lengths, so seats are evenly spaced
 * on screen (equal angles bunch up where the oval curves tightest).
 * `offset` 0.5 gives the midpoints between seats.
 */
function evenAngles(count: number, rx: number, ry: number, offset = 0): number[] {
  const samples = 720;
  const lengths = [0];
  for (let i = 1; i <= samples; i++) {
    const p = at(((i - 1) / samples) * 2 * Math.PI, rx, ry);
    const q = at((i / samples) * 2 * Math.PI, rx, ry);
    lengths.push(lengths[i - 1]! + Math.hypot(q.left - p.left, (q.top - p.top) * ASPECT));
  }
  const total = lengths[samples]!;
  return Array.from({ length: count }, (_, k) => {
    const target = (((k + offset) / count) % 1) * total;
    let i = 1;
    while (i < samples && lengths[i]! < target) i++;
    return (i / samples) * 2 * Math.PI;
  });
}

export function TableDiagram({
  state,
  lastAction,
  meId = null,
  onAdd,
}: {
  state: GameState;
  lastAction: LastAction | null;
  /** The player this phone plays as, if any (shared games). */
  meId?: PlayerId | null;
  /** Called with the player the newcomer sits after (null = empty table). */
  onAdd?: (afterId: PlayerId | null) => void;
}) {
  const { fmt } = useAmounts();
  const players = seatedPlayers(state);
  const hand = state.hand && state.hand.phase !== "complete" ? state.hand : null;
  const inHand = new Map<PlayerId, HandPlayer>(hand ? hand.players.map((hp) => [hp.playerId, hp]) : []);
  const n = players.length;
  const crowded = n >= 7;
  const seatAngles = evenAngles(n, 37, 41);
  const gapAngles = evenAngles(n, 37, 41, 0.5);
  const pot = hand
    ? hand.players.reduce((s, p) => s + p.committedTotal, 0) - (hand.uncalledReturn?.amount ?? 0)
    : 0;
  const full = n >= state.config.maxSeats;

  return (
    <div className={`table-wrap ${crowded ? "crowded" : ""}`} aria-label="Table">
      <div className="felt">
        <div className="felt-center">
          {hand ? (
            <>
              <div className="felt-street">
                Hand #{hand.number} · {hand.phase === "awarding" ? "Showdown" : STREET[hand.street]}
              </div>
              <div className="felt-pot">{fmt(pot)}</div>
            </>
          ) : n === 0 ? (
            onAdd && (
              <button type="button" className="primary" onClick={() => onAdd(null)}>
                Add the first player
              </button>
            )
          ) : (
            <div className="felt-street">{state.status === "ended" ? "Game over" : "Between hands"}</div>
          )}
        </div>
      </div>

      {players.map((p, i) => {
        const angle = seatAngles[i]!;
        const pos = at(angle, 37, 41);
        const hp = inHand.get(p.id);
        const toAct = hand?.toAct === p.id;
        const last = lastAction?.playerId === p.id;
        const button = hand ? hand.buttonSeat === p.seat : state.lastButtonSeat === p.seat;
        const role = hand
          ? p.seat === hand.smallBlindSeat
            ? "SB"
            : p.seat === hand.bigBlindSeat
              ? "BB"
              : null
          : null;
        const cls = [
          "seat-tile",
          toAct ? "to-act" : "",
          last ? "last-action" : "",
          hp?.folded ? "folded" : "",
          hand && !hp ? "not-dealt" : "",
          p.id === meId ? "is-me" : "",
          !hand && p.status === "sitting_out" ? "not-dealt" : "",
        ].join(" ");
        const betPos = at(angle, 22, 25);
        return (
          <div key={p.id}>
            <div
              className={cls}
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
              aria-current={toAct ? "true" : undefined}
            >
              <div className="tile-name">
                {p.name}
                {button && <span className="dealer" title="Dealer button">D</span>}
              </div>
              <div className="tile-stack">{fmt(p.stack)}</div>
              {p.id === meId && <div className="tile-me">you</div>}
              {role && <div className="tile-role">{role}</div>}
              {hp?.allIn && <div className="tile-tag hot">all-in</div>}
              {hp?.folded && <div className="tile-tag">folded</div>}
              {hand && !hp && <div className="tile-tag">next hand</div>}
              {!hand && p.status === "sitting_out" && <div className="tile-tag">sitting out</div>}
              {last && lastAction && <div className="bubble">{lastAction.text}</div>}
            </div>
            {hp && hp.committedStreet > 0 && (
              <div className="bet-chip" style={{ left: `${betPos.left}%`, top: `${betPos.top}%` }}>
                {fmt(hp.committedStreet)}
              </div>
            )}
          </div>
        );
      })}

      {onAdd &&
        !full &&
        n > 0 &&
        players.map((p, i) => {
          const next = players[(i + 1) % n]!;
          const pos = at(gapAngles[i]!, crowded ? 46 : 38, crowded ? 48 : 42);
          const label = n === 1 ? `Add player next to ${p.name}` : `Add player between ${p.name} and ${next.name}`;
          return (
            <button
              key={`add-${p.id}`}
              type="button"
              className="add-spot"
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
              aria-label={label}
              title={label}
              onClick={() => onAdd(p.id)}
            >
              +
            </button>
          );
        })}
    </div>
  );
}
