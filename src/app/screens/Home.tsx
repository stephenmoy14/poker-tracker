import { useState, type FormEvent } from "react";
import { replay } from "../../engine/replay";
import { newId, rejectionReason, stamp } from "../log";
import { parseAmount } from "../money";
import { addGame, deleteGame, forgetRoom, listGames, listRooms, loadEvents, rememberRoom } from "../storage";
import { getBackend, supabaseConfigured } from "../../sync";
import { formatAmount } from "../../engine/money";
import { AmountProvider, ConfirmButton, ErrorText, MoneyInput } from "../ui";

export function Home({ onOpen, onOpenRoom }: { onOpen: (id: string) => void; onOpenRoom: (code: string) => void }) {
  const [games, setGames] = useState(listGames);
  const [rooms, setRooms] = useState(listRooms);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"money" | "chips">("money");
  const [sb, setSb] = useState("0.10");
  const [bb, setBb] = useState("0.25");
  const style = { format, currency: "USD" };

  const changeFormat = (next: "money" | "chips") => {
    setFormat(next);
    // Sensible starting blinds for each mode; the host can change them.
    if (next === "chips") {
      setSb("25");
      setBb("50");
    } else {
      setSb("0.10");
      setBb("0.25");
    }
  };
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const smallBlind = parseAmount(sb, style);
    const bigBlind = parseAmount(bb, style);
    if (smallBlind === null || bigBlind === null) {
      setError(format === "chips" ? "Enter blinds like 25 and 50" : "Enter blinds like 0.10 and 0.25");
      return;
    }
    const event = stamp({
      type: "game_created",
      config: { smallBlind, bigBlind, unit: format === "chips" ? 1 : 5, currency: "USD", maxSeats: 10, format },
    });
    const reason = rejectionReason(null, event);
    if (reason) {
      setError(reason);
      return;
    }
    const title =
      name.trim() ||
      `Game · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    if (shared) {
      setBusy(true);
      try {
        const backend = await getBackend();
        const { roomId, code } = await backend.createRoom(title, [event]);
        rememberRoom({ code, roomId, name: title, joinedAt: Date.now() });
        onOpenRoom(code);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    const id = newId();
    addGame({ id, name: title, createdAt: Date.now() }, [event]);
    onOpen(id);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return setError("Room codes are 6 letters and numbers");
    onOpenRoom(code);
  };

  return (
    <main className="page">
      <header className="topbar">
        <h1>Poker Tracker</h1>
      </header>

      <section className="card">
        <h2>New game</h2>
        <form onSubmit={create} className="stack">
          <label>
            Name
            <input value={name} placeholder="Friday game" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Playing for
            <select value={format} onChange={(e) => changeFormat(e.target.value as "money" | "chips")}>
              <option value="money">Money ($)</option>
              <option value="chips">Chips only (no money)</option>
            </select>
          </label>
          <AmountProvider value={style}>
          <div className="row">
            <label>
              Small blind
              <MoneyInput value={sb} onChange={setSb} label="Small blind" />
            </label>
            <label>
              Big blind
              <MoneyInput value={bb} onChange={setBb} label="Big blind" />
            </label>
          </div>
          </AmountProvider>
          <p className="hint">
            {format === "chips"
              ? "Amounts are chip counts. Results show who's up or down in chips; no payments."
              : "The smallest amount is $0.05, so blinds must be multiples of $0.05."}
          </p>
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with other phones
          </label>
          {shared && (
            <p className="hint">
              {supabaseConfigured()
                ? "You'll get a room code. Players join with it and enter their own actions; you're the host."
                : "Supabase isn't set up yet (see SUPABASE.md), so for now this shares between tabs in this browser only."}
            </p>
          )}
          <ErrorText>{error}</ErrorText>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : shared ? "Start shared game" : "Start game"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Join a game</h2>
        <form className="row center" onSubmit={join}>
          <input
            className="code-input grow"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Room code"
            aria-label="Room code"
            autoCapitalize="characters"
            maxLength={6}
          />
          <button type="submit">Join</button>
        </form>
      </section>

      {rooms.length > 0 && (
        <section className="card">
          <h2>Shared games</h2>
          <ul className="list">
            {rooms.map((r) => (
              <li key={r.code} className="list-row">
                <button type="button" className="link grow" onClick={() => onOpenRoom(r.code)}>
                  <strong>{r.name}</strong>
                  <span className="muted">Room {r.code}</span>
                </button>
                <ConfirmButton
                  label="Forget"
                  confirmLabel="Forget?"
                  className="small"
                  onConfirm={() => {
                    forgetRoom(r.code);
                    setRooms(listRooms());
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {games.length > 0 && (
        <section className="card">
          <h2>Games</h2>
          <ul className="list">
            {games.map((g) => {
              const state = replay(loadEvents(g.id)).state;
              const players = state ? Object.values(state.players).length : 0;
              const blinds = state
                ? `${formatAmount(state.config.smallBlind, state.config)} / ${formatAmount(state.config.bigBlind, state.config)}` +
                  (state.config.format === "chips" ? " chips" : "")
                : "";
              return (
                <li key={g.id} className="list-row">
                  <button type="button" className="link grow" onClick={() => onOpen(g.id)}>
                    <strong>{g.name}</strong>
                    <span className="muted">
                      {blinds} · {players} players · {state?.handsPlayed ?? 0} hands
                      {state?.status === "ended" ? " · ended" : ""}
                    </span>
                  </button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete?"
                    className="small"
                    onConfirm={() => {
                      deleteGame(g.id);
                      setGames(listGames());
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
