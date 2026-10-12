import { useState } from "react";
import type { GameState } from "../../engine/types";
import { seatedPlayers } from "../../engine/seats";
import type { Game, RoomInfo } from "../game";
import { ConfirmButton, ErrorText, nameOf } from "../ui";

/**
 * Links this phone to a player so it can enter that player's actions.
 * Shown until the phone picks someone (or chooses to watch). The host also
 * sees which phones are linked and can free a seat whose phone is gone.
 */
export function WhoAreYou({ game, room, state }: { game: Game; room: RoomInfo; state: GameState }) {
  const me = room.me;
  const [open, setOpen] = useState(!me?.isHost && !me?.playerId);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const claimedBy = new Map(room.members.filter((m) => m.playerId).map((m) => [m.playerId!, m.uid]));
  const players = seatedPlayers(state);
  const pick = (playerId: string | null) =>
    void room.claim(playerId).then((reason) => {
      setError(reason);
      if (!reason) setOpen(false);
    });

  if (!open) {
    return (
      <div className="center-row">
        <button type="button" className="link small-text" onClick={() => setOpen(true)}>
          {me.isHost ? "Phones & seats" : me.playerId ? `Not ${nameOf(state, me.playerId)}? Change` : "Join as a player"}
        </button>
      </div>
    );
  }

  return (
    <section className="card who">
      <h2>{me.isHost ? "Phones & seats" : "Who are you?"}</h2>
      {players.length === 0 ? (
        <p className="muted">No players yet. {me.isHost ? "Add them on the table." : "The host adds players first."}</p>
      ) : (
        <ul className="list">
          {players.map((p) => {
            const holder = claimedBy.get(p.id);
            const mine = holder === me.uid;
            const taken = !!holder && !mine;
            return (
              <li key={p.id} className="list-row">
                <span className="grow">
                  <strong>{p.name}</strong>
                  {mine && <span className="badge">you</span>}
                  {taken && <span className="badge">on another phone</span>}
                </span>
                {me.isHost && taken && (
                  <ConfirmButton
                    label="Free"
                    confirmLabel="Free seat?"
                    className="small"
                    onConfirm={() => void room.release(p.id).then(setError)}
                  />
                )}
                {!mine && !taken && (
                  <button type="button" className="small" disabled={game.pending} onClick={() => pick(p.id)}>
                    {me.isHost ? "That's me" : "I'm " + p.name}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="row">
        {me.playerId && (
          <button type="button" onClick={() => pick(null)}>
            {me.isHost ? "I'm not playing" : "Just watch"}
          </button>
        )}
        {!me.playerId && !me.isHost && (
          <button type="button" onClick={() => setOpen(false)}>
            Just watch
          </button>
        )}
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="hint">
        {me.isHost
          ? "As host you can enter anything for anyone. Players' phones can only act for their own seat."
          : "You can enter your own actions when it's your turn. The host deals, awards pots and fixes mistakes."}
      </p>
    </section>
  );
}
