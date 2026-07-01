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

function createBackgroundMusic(src = "/audio/music.mp3") {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0.3;

  return {
    async start() {
      await audio.play();
    },
    stop() {
      audio.pause();
    },
    destroy() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

function App() {
  const gameRootRef = useRef(null);
  const musicRef = useRef(null);
  const languageMenuRef = useRef(null);
  const playerPositionRef = useRef(null);
  const hasStartedRef = useRef(false);
  const [currentMap, setCurrentMap] = useState("portfolio");
  const [currentSpawn, setCurrentSpawn] = useState(null);
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem("portfolio-language") || "tr";
  });
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  useEffect(() => {
    let stop = null;
    let cancelled = false;

    (async () => {
      if (!gameRootRef.current) return;
      try {
        gameRootRef.current.replaceChildren();
        const mapKey = normalizeMapKey(currentMap);
        const mapUrl = MAP_BY_KEY[mapKey] ?? MAP_BY_KEY.portfolio;
        const savedPosition =
          playerPositionRef.current?.map === mapKey
            ? playerPositionRef.current
            : null;

        stop = await startGame({
          mapUrl,
          spawnName: currentSpawn ?? undefined,
          initialPosition: savedPosition,
          initialMessageKey:
            !hasStartedRef.current && mapKey === "portfolio" && currentSpawn == null
              ? "intro.start"
              : null,
          root: gameRootRef.current,
          scale: 1,
          zoom: 2.4,
          debug: false,
          language,
          onPlayerPositionChange: ({ x, y }) => {
            playerPositionRef.current = { map: mapKey, x, y };
          },
          onPortal: ({ targetMap, targetSpawn }) => {
            const nextMap = normalizeMapKey(targetMap);
            if (!MAP_BY_KEY[nextMap]) return;
            playerPositionRef.current = null;
            setCurrentMap(nextMap);
            setCurrentSpawn(targetSpawn ?? null);
          },
          onError: (err) => {
            console.error(err);
          },
        });
        hasStartedRef.current = true;
      } catch (e) {
        console.error(e);
      }
      if (cancelled) stop?.();
    })();

    return () => {
      cancelled = true;
      stop?.();
      gameRootRef.current?.replaceChildren();
    };
  }, [currentMap, currentSpawn, language]);

  useEffect(() => {
    localStorage.setItem("portfolio-language", language);
  }, [language]);

  useEffect(() => {
    if (!languageMenuOpen) return undefined;

    const closeMenu = (event) => {
      if (!languageMenuRef.current?.contains(event.target)) {
        setLanguageMenuOpen(false);
      }
    };
    const closeWithEscape = (event) => {
      if (event.key === "Escape") setLanguageMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [languageMenuOpen]);

  useEffect(() => {
    return () => {
      musicRef.current?.destroy();
      musicRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!musicEnabled) {
      musicRef.current?.stop();
      return;
    }

    if (!musicRef.current) {
      musicRef.current = createBackgroundMusic();
    }

    const startMusic = () => {
      musicRef.current?.start().catch((error) => {
        if (error?.name !== "NotAllowedError") {
          console.warn("Background music could not start.", error);
        }
      });
    };

    startMusic();
    window.addEventListener("pointerdown", startMusic, { once: true });
    window.addEventListener("keydown", startMusic, { once: true });

    return () => {
      window.removeEventListener("pointerdown", startMusic);
      window.removeEventListener("keydown", startMusic);
    };
  }, [musicEnabled]);

  const languageLabel = language === "tr" ? "TR" : "EN";
  const musicLabel = musicEnabled
    ? language === "tr" ? "Müzik açık" : "Music on"
    : language === "tr" ? "Müzik kapalı" : "Music off";
  const musicShortLabel = musicEnabled
    ? language === "tr" ? "Açık" : "On"
    : language === "tr" ? "Kapalı" : "Off";

  const chooseLanguage = (nextLanguage) => {
    setLanguage(nextLanguage);
    setLanguageMenuOpen(false);
  };

  return (
    <div className="app-shell">
      <div className="game-root" ref={gameRootRef} />
      <div className="game-controls" aria-label="Game controls">
        <div className="language-control" ref={languageMenuRef}>
          <button
            className="control-button language-button"
            type="button"
            onClick={() => setLanguageMenuOpen((value) => !value)}
            aria-expanded={languageMenuOpen}
            aria-haspopup="menu"
            aria-label={language === "tr" ? "Dil seçimi" : "Choose language"}
          >
            <span className="language-globe" aria-hidden="true">◎</span>
            <span>{languageLabel}</span>
            <span
              className={`menu-chevron${languageMenuOpen ? " is-open" : ""}`}
              aria-hidden="true"
            >
              ▾
            </span>
          </button>
          {languageMenuOpen && (
            <div className="language-menu" role="menu">
              <button
                className={`language-option${language === "tr" ? " is-selected" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={language === "tr"}
                onClick={() => chooseLanguage("tr")}
              >
                <span>Türkçe</span>
                <span aria-hidden="true">{language === "tr" ? "✓" : ""}</span>
              </button>
              <button
                className={`language-option${language === "en" ? " is-selected" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={language === "en"}
                onClick={() => chooseLanguage("en")}
              >
                <span>English</span>
                <span aria-hidden="true">{language === "en" ? "✓" : ""}</span>
              </button>
            </div>
          )}
        </div>
        <button
          className="control-button music-button"
          type="button"
          onClick={() => setMusicEnabled((value) => !value)}
          aria-pressed={musicEnabled}
          aria-label={musicLabel}
          title={musicLabel}
        >
          <span className="music-icon" aria-hidden="true">
            {musicEnabled ? "♫" : "♪"}
          </span>
          <span>{musicShortLabel}</span>
          <span className="music-status" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default App;
