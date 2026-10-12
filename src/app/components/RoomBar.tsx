import { useState } from "react";
import type { Game, RoomInfo } from "../game";
import { nameOf } from "../ui";

/** Room code + share, connection status, and which player this phone is. */
export function RoomBar({ game, room }: { game: Game; room: RoomInfo }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}#/room/${room.code}`;
  const me = room.me;
  const playing = me?.playerId && game.state ? nameOf(game.state, me.playerId) : null;

  const share = async () => {
    const text = `Join our poker game: code ${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: room.name, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <div className="room-bar">
      <button type="button" className="room-code" onClick={share} aria-label={`Room code ${room.code}. Share link`}>
        <span className="muted small-text">Room</span> <strong>{room.code}</strong>
        <span className="small-text">{copied ? " · link copied" : " · share"}</span>
      </button>
      <span className={`live-dot ${room.live ? "on" : ""}`} title={room.live ? "Live" : "Reconnecting"}>
        {room.live ? "Live" : "Reconnecting…"}
      </span>
      <span className="small-text muted grow right">
        {me?.isHost ? "You're the host" : playing ? `You're ${playing}` : "Watching"}
        {room.backendLabel !== "Supabase" && " · this browser only"}
      </span>
    </div>
  );
}
