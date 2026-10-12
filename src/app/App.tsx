import { useEffect, useState } from "react";
import { Home } from "./screens/Home";
import { LocalGameScreen } from "./screens/GameScreen";
import { RoomScreen } from "./screens/RoomScreen";

// Routes: "#/" is the list of games, "#/game/<id>" a game on this phone,
// "#/room/<CODE>" a shared game. The hash keeps the phone's back button
// working without a router library.

type Route = { kind: "home" } | { kind: "game"; id: string } | { kind: "room"; code: string };

function readHash(): Route {
  const game = /^#\/game\/(.+)$/.exec(window.location.hash);
  if (game) return { kind: "game", id: decodeURIComponent(game[1]!) };
  const room = /^#\/room\/([A-Za-z0-9]+)$/.exec(window.location.hash);
  if (room) return { kind: "room", code: room[1]!.toUpperCase() };
  return { kind: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };
  const home = () => go("#/");

  if (route.kind === "game") return <LocalGameScreen key={route.id} gameId={route.id} onExit={home} />;
  if (route.kind === "room") return <RoomScreen key={route.code} code={route.code} onExit={home} />;
  return (
    <Home
      onOpen={(id) => go(`#/game/${encodeURIComponent(id)}`)}
      onOpenRoom={(code) => go(`#/room/${code}`)}
    />
  );
}
