import { useEffect, useRef, useState } from "react";
import { startGame } from "./game.js";
import "./App.css";

const MAP_URLS = import.meta.glob("./assets/maps/*.tmj", {
  eager: true,
  query: "?url",
  import: "default",
});

const MAP_BY_KEY = Object.fromEntries(
  Object.entries(MAP_URLS).map(([path, url]) => [
    path.split("/").pop().replace(".tmj", ""),
    url,
  ]),
);

function normalizeMapKey(raw) {
  if (!raw) return "portfolio";
  return String(raw).replace(".tmj", "");
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function App() {
  const gameRootRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [currentMap, setCurrentMap] = useState("portfolio");
  const [currentSpawn, setCurrentSpawn] = useState(null);

  useEffect(() => {
    let stop = null;
    let cancelled = false;

    (async () => {
      if (!gameRootRef.current) return;
      try {
        setStatus("loading");
        setError(null);
        const loadingStartedAt = performance.now();

        const mapKey = normalizeMapKey(currentMap);
        const mapUrl = MAP_BY_KEY[mapKey] ?? MAP_BY_KEY.portfolio;

        stop = await startGame({
          mapUrl,
          spawnName: currentSpawn ?? undefined,
          initialMessageKey:
            mapKey === "portfolio" && currentSpawn == null ? "intro.start" : null,
          root: gameRootRef.current,
          scale: 1,
          zoom: 2.4,
          debug: false,
          onPortal: ({ targetMap, targetSpawn }) => {
            const nextMap = normalizeMapKey(targetMap);
            if (!MAP_BY_KEY[nextMap]) return;
            setCurrentMap(nextMap);
            setCurrentSpawn(targetSpawn ?? null);
          },
          onError: (err) => {
            setError(err?.message ?? String(err));
            setStatus("error");
          },
        });
        const elapsed = performance.now() - loadingStartedAt;
        const remaining = Math.max(0, 650 - elapsed);
        if (remaining > 0) {
          await wait(remaining);
        }
        if (!cancelled) setStatus("running");
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
      if (cancelled) stop?.();
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [currentMap, currentSpawn]);

  return (
    <div className="game-root" ref={gameRootRef}>
      {status === "loading" && (
        <div className="loading-hud">
          <div className="loading-hud__label">Yukleniyor...</div>
          <div className="loading-hud__bar">
            <div className="loading-hud__bar-fill" />
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="hud">
          <div>Game error: {error}</div>
        </div>
      )}
    </div>
  );
}

export default App;
