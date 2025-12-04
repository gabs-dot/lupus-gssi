import { useState, useEffect } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";

/* -------------------------------------------------------
   🔐 Account session (login / register)
------------------------------------------------------- */
const ACCOUNT_SESSION_KEY = "lupus_gssi_account";

function saveAccountSession(account) {
  try {
    localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(account));
  } catch (e) {
    console.error("Failed to save account session", e);
  }
}

function clearAccountSession() {
  try {
    localStorage.removeItem(ACCOUNT_SESSION_KEY);
  } catch (e) {
    console.error("Failed to clear account session", e);
  }
}

/* -------------------------------------------------------
   🎮 Game session (rejoin specific game as specific player)
------------------------------------------------------- */
const GAME_SESSION_KEY = "lupus_gssi_game_session";

function saveGameSession({ gameId, playerId, playerName }) {
  try {
    localStorage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify({ gameId, playerId, playerName })
    );
  } catch (e) {
    console.error("Failed to save game session", e);
  }
}


function clearGameSession() {
  try {
    localStorage.removeItem(GAME_SESSION_KEY);
  } catch (e) {
    console.error("Failed to clear game session", e);
  }
}

/* -------------------------------------------------------
   Helpers Supabase
------------------------------------------------------- */

// Generate a simple game code like "ABC-123"
function generateGameCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "0123456789";

  let part1 = "";
  for (let i = 0; i < 3; i++) {
    const index = Math.floor(Math.random() * letters.length);
    part1 += letters[index];
  }

  let part2 = "";
  for (let i = 0; i < 3; i++) {
    const index = Math.floor(Math.random() * numbers.length);
    part2 += numbers[index];
  }

  return `${part1}-${part2}`;
}

// Fisher–Yates shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build a simple role distribution given number of NON-HOST players
function buildRoles(playerCount) {
  const roles = [];

  const mafiaCount = Math.max(1, Math.floor(playerCount / 4));
  for (let i = 0; i < mafiaCount; i++) {
    roles.push("MAFIA");
  }

  roles.push("DETECTIVE");
  roles.push("DOCTOR");

  while (roles.length < playerCount) {
    roles.push("CITIZEN");
  }

  return shuffle(roles);
}

// Helper to load all players for a game from Supabase
async function fetchPlayersForGame(gameId) {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data.map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.is_host,
    role: p.role,
    alive: p.alive,
  }));
}

// Helper to load a single game by id
async function fetchGameById(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();

  if (error) {
    throw error;
  }

  return {
    id: data.id,
    code: data.code,
    hostName: data.host_name,
    status: data.status,
    phase: data.phase,
    dayNumber: data.day_number,
  };
}

// Helper: load full game (game + players)
async function hydrateGame(gameId) {
  const game = await fetchGameById(gameId);
  const players = await fetchPlayersForGame(gameId);
  return { ...game, players };
}

// Insert/update a night action for a player (Mafia/Doctor/Detective)
async function submitNightAction({
  gameId,
  playerId,
  dayNumber,
  actionType,
  targetPlayerId,
}) {
  await supabase
    .from("actions")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .eq("day_number", dayNumber)
    .eq("phase", "night")
    .eq("action_type", actionType);

  const { error } = await supabase.from("actions").insert({
    game_id: gameId,
    player_id: playerId,
    day_number: dayNumber,
    phase: "night",
    action_type: actionType,
    target_player_id: targetPlayerId,
  });

  if (error) {
    throw error;
  }
}

// Insert/update a day vote action
async function submitDayVote({ gameId, playerId, dayNumber, targetPlayerId }) {
  await supabase
    .from("actions")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .eq("day_number", dayNumber)
    .eq("phase", "day")
    .eq("action_type", "DAY_VOTE");

  const { error } = await supabase.from("actions").insert({
    game_id: gameId,
    player_id: playerId,
    day_number: dayNumber,
    phase: "day",
    action_type: "DAY_VOTE",
    target_player_id: targetPlayerId,
  });

  if (error) {
    throw error;
  }
}

// For host: status of night actions per player
async function fetchNightActionStatus(gameId, dayNumber) {
  const { data, error } = await supabase
    .from("actions")
    .select("player_id, action_type")
    .eq("game_id", gameId)
    .eq("phase", "night")
    .eq("day_number", dayNumber);

  if (error) {
    throw error;
  }

  const status = {};
  for (const a of data) {
    if (!status[a.player_id]) {
      status[a.player_id] = {
        mafiaKill: false,
        doctorProtect: false,
        detectiveInvestigate: false,
      };
    }
    if (a.action_type === "MAFIA_KILL") {
      status[a.player_id].mafiaKill = true;
    }
    if (a.action_type === "DOCTOR_PROTECT") {
      status[a.player_id].doctorProtect = true;
    }
    if (a.action_type === "DETECTIVE_INVESTIGATE") {
      status[a.player_id].detectiveInvestigate = true;
    }
  }
  return status;
}

// For host: status of day votes (who has voted)
async function fetchDayVoteStatus(gameId, dayNumber) {
  const { data, error } = await supabase
    .from("actions")
    .select("player_id")
    .eq("game_id", gameId)
    .eq("phase", "day")
    .eq("day_number", dayNumber)
    .eq("action_type", "DAY_VOTE");

  if (error) {
    throw error;
  }

  const status = {};
  for (const a of data) {
    status[a.player_id] = true;
  }
  return status;
}

/* -------------------------------------------------------
   APP
------------------------------------------------------- */

function App() {
  const [account, setAccount] = useState(null);
  const [authInitializing, setAuthInitializing] = useState(true);

  const [playerName, setPlayerName] = useState("");
  const [currentGame, setCurrentGame] = useState(null); // { id, code, hostName, status, phase, dayNumber, players: [] }
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [initializingGame, setInitializingGame] = useState(true);

  // storico partite collegate all'account
  const [myGames, setMyGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState("");

  // 🔁 Ripristina l'ACCOUNT da localStorage (login persistente)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACCOUNT_SESSION_KEY);
      if (!raw) {
        setAuthInitializing(false);
        return;
      }

      const saved = JSON.parse(raw);
      if (!saved.id || !saved.username) {
        clearAccountSession();
        setAuthInitializing(false);
        return;
      }

      setAccount(saved);
    } catch (e) {
      console.error("Error restoring account", e);
      clearAccountSession();
    } finally {
      setAuthInitializing(false);
    }
  }, []);

  // 🔁 Prova a riprendere una partita salvata (gameId + playerId)
  useEffect(() => {
  async function tryResumeGameSession() {
    try {
      const raw = localStorage.getItem(GAME_SESSION_KEY);
      if (!raw) {
        setInitializingGame(false);
        return;
      }

      const saved = JSON.parse(raw);
      if (!saved.gameId || !saved.playerId || !saved.playerName) {
        clearGameSession();
        setInitializingGame(false);
        return;
      }

      // Se il game è stato cancellato su Supabase, questa chiamata può fallire
      let game;
      try {
        game = await hydrateGame(saved.gameId);
      } catch (e) {
        console.error("hydrateGame failed, clearing session", e);
        clearGameSession();
        setInitializingGame(false);
        return;
      }

      if (!game) {
        clearGameSession();
        setInitializingGame(false);
        return;
      }

      const me = game.players.find((p) => p.id === saved.playerId);
      if (!me) {
        clearGameSession();
        setInitializingGame(false);
        return;
      }

      if (!playerName) {
        setPlayerName(saved.playerName);
      }

      setCurrentGame(game);
      setCurrentPlayerId(saved.playerId);
    } catch (err) {
      console.error("Error restoring game session", err);
      clearGameSession();
    } finally {
      setInitializingGame(false);
    }
  }

  tryResumeGameSession();
}, [playerName]);

  // 🔗 Collega l'account al playerName (username = nome nel gioco)
  useEffect(() => {
    if (account && !playerName) {
      setPlayerName(account?.username);
    }
  }, [account, playerName]);

  // Carica tutte le partite in cui compare il mio username nella tabella players
  async function loadMyGames() {
    if (!account) return;
    setLoadingGames(true);
    setGamesError("");

    try {
      // Tutti i player record con name = account?.username
      const { data: playerRows, error: playersError } = await supabase
        .from("players")
        .select("id, game_id, is_host")
        .eq("name", account?.username);

      if (playersError) {
        console.error("Error loading player list for history:", playersError);
        setGamesError("Could not load your games.");
        return;
      }

      if (!playerRows || playerRows.length === 0) {
        setMyGames([]);
        return;
      }

      const gameIds = [...new Set(playerRows.map((p) => p.game_id))];

      const { data: games, error: gamesErrorRes } = await supabase
        .from("games")
        .select("*")
        .in("id", gameIds);

      if (gamesErrorRes) {
        console.error("Error loading games for history:", gamesErrorRes);
        setGamesError("Could not load your games.");
        return;
      }

      const merged = games.map((g) => {
        const pr = playerRows.find((p) => p.game_id === g.id);
        return {
          game: g,
          playerId: pr?.id,
          isHost: pr?.is_host || false,
        };
      });

      // Ordina per id decrescente (o cambia come preferisci)
      merged.sort((a, b) => (b.game.id || 0) - (a.game.id || 0));

      setMyGames(merged);
    } catch (err) {
      console.error("Error in loadMyGames:", err);
      setGamesError("Unexpected error while loading your games.");
    } finally {
      setLoadingGames(false);
    }
  }

  // Quando ho un account e NON sono dentro una partita, carico lo storico
  useEffect(() => {
    if (!account) return;
    if (currentGame) return;
    loadMyGames();
  }, [account, currentGame]);

  async function handleRejoinGameFromHome(gameId) {
    const entry = myGames.find((g) => g.game.id === gameId);
    if (!entry) return;

    try {
      const hydrated = await hydrateGame(gameId);

      const me = hydrated.players.find((p) => p.id === entry.playerId);
      if (!me) {
        alert("You are no longer part of this game.");
        await loadMyGames();
        return;
      }

      // aggiorno sessione locale
      saveGameSession({
        gameId,
        playerId: entry.playerId,
        playerName: me.name,
      });

      setPlayerName(me.name);
      setCurrentGame(hydrated);
      setCurrentPlayerId(entry.playerId);
    } catch (err) {
      console.error("Error rejoining game:", err);
      alert("Failed to rejoin this game.");
    }
  }

  async function handleDeleteFromHistory(gameId, playerId, isHost) {
    if (!account) return;

    if (isHost) {
      const confirmed = window.confirm(
        "You are the host of this game. Deleting it will remove the game for everyone. Continue?"
      );
      if (!confirmed) return;

      try {
        await supabase.from("actions").delete().eq("game_id", gameId);
        await supabase.from("players").delete().eq("game_id", gameId);
        await supabase.from("games").delete().eq("id", gameId);

        // se questa era la partita salvata in sessione, pulisco
        try {
          const raw = localStorage.getItem(GAME_SESSION_KEY);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.gameId === gameId) {
              clearGameSession();
            }
          }
        } catch (e) {
          console.error("Error clearing game session after delete:", e);
        }

        setMyGames((prev) => prev.filter((g) => g.game.id !== gameId));
      } catch (err) {
        console.error("Error deleting game:", err);
        alert("Failed to delete this game.");
      }
    } else {
      const confirmed = window.confirm(
        "Remove this game from your history and leave it? You will no longer be a player in this game."
      );
      if (!confirmed) return;

      try {
        await supabase.from("players").delete().eq("id", playerId);

        try {
          const raw = localStorage.getItem(GAME_SESSION_KEY);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.gameId === gameId && saved.playerId === playerId) {
              clearGameSession();
            }
          }
        } catch (e) {
          console.error("Error clearing session after leaving game:", e);
        }

        setMyGames((prev) => prev.filter((g) => g.game.id !== gameId));
      } catch (err) {
        console.error("Error removing game from history:", err);
        alert("Failed to remove this game.");
      }
    }
  }

  function handleLogout() {
    clearAccountSession();
    clearGameSession();
    setAccount(null);
    setPlayerName("");
    setCurrentGame(null);
    setCurrentPlayerId(null);
    setMyGames([]);
  }

  // ⏳ Finché stiamo controllando l'account
  if (authInitializing) {
    return (
      <div className="app">
        <header className="header">
          <h1>🌑 Lupus @ GSSI</h1>
        </header>
        <main className="card">
          <p className="muted">Checking your account…</p>
        </main>
      </div>
    );
  }

  // 🔑 Se non c'è account → schermata Login / Register
  if (!account) {
    return (
      <AuthScreen
        onLoggedIn={(acc) => {
          setAccount(acc);
          saveAccountSession(acc);
        }}
      />
    );
  }

  // Finché stiamo provando a riprendere la partita
  if (initializingGame) {
    return (
      <div className="app">
        <header className="header">
          <h1>🌑 Lupus @ GSSI</h1>
        </header>
        <main className="card">
          <p className="muted">Reconnecting to your last game…</p>
        </main>
      </div>
    );
  }

  // Se sono già dentro un game → mostra Lobby
  if (currentGame && currentPlayerId) {
    return (
      <Lobby
        playerName={playerName}
        currentPlayerId={currentPlayerId}
        game={currentGame}
        onLeaveGame={() => {
          clearGameSession();
          setCurrentGame(null);
          setCurrentPlayerId(null);
        }}
        onPlayersUpdated={(players) =>
          setCurrentGame((prev) =>
            prev
              ? {
                  ...prev,
                  players,
                }
              : prev
          )
        }
        onGameUpdated={(partial) =>
          setCurrentGame((prev) =>
            prev
              ? {
                  ...prev,
                  ...partial,
                }
              : prev
          )
        }
      />
    );
  }

  // 3) Home dopo login (ma non dentro una partita)
  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <p style={{ margin: 0 }}>Welcome, {account?.username}.</p>
          <button
            type="button"
            className="btn ghost"
            onClick={handleLogout}
            style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
          >
            Log out
          </button>
        </div>
      </header>

      <main className="card">
        <h2>Create or join a game</h2>
        <p className="muted">
          You can create a new game and share the code, or join an existing one
          using a code.
        </p>

        <button
          className="btn primary"
          disabled={isBusy}
          onClick={async () => {
            if (isBusy) return;
            setIsBusy(true);

            try {
              const code = generateGameCode();

              const { data: game, error: gameError } = await supabase
                .from("games")
                .insert({
                  code,
                  host_name: account?.username,
                  status: "lobby",
                  phase: "lobby",
                  day_number: 0,
                })
                .select()
                .single();

              if (gameError) {
                console.error("Error creating game:", gameError);
                alert("Something went wrong while creating the game.");
                return;
              }

              const { data: player, error: playerError } = await supabase
                .from("players")
                .insert({
                  game_id: game.id,
                  name: account?.username,
                  is_host: true,
                  alive: true,
                  role: null,
                })
                .select()
                .single();

              if (playerError) {
                console.error("Error creating host player:", playerError);
                alert(
                  "Game created, but failed to register you as a player."
                );
                return;
              }

              const hydrated = await hydrateGame(game.id);

              saveGameSession({
                gameId: game.id,
                playerId: player.id,
                playerName: account?.username,
              });

              setPlayerName(account?.username);
              setCurrentGame(hydrated);
              setCurrentPlayerId(player.id);
            } catch (err) {
              console.error(err);
              alert("Unexpected error while creating the game.");
            } finally {
              setIsBusy(false);
            }
          }}
        >
          {isBusy ? "Creating game..." : "Create a new game"}
        </button>

        <button
          className="btn secondary"
          onClick={() => setShowJoin((prev) => !prev)}
        >
          {showJoin ? "Hide join form" : "Join a game"}
        </button>

        {showJoin && (
          <JoinGameForm
            playerName={account?.username}
            onJoinedGame={(game, playerId) => {
              saveGameSession({
                gameId: game.id,
                playerId,
                playerName: account?.username,
              });

              setPlayerName(account?.username);
              setCurrentGame(game);
              setCurrentPlayerId(playerId);
            }}
          />
        )}

        <p className="tiny" style={{ marginTop: "0.75rem" }}>
          With realtime enabled, players will appear in the lobby as they join
          from their own devices.
        </p>

        <hr style={{ margin: "1.5rem 0", opacity: 0.2 }} />

        <h3>Your games</h3>
        {gamesError && <p className="error">{gamesError}</p>}

        {loadingGames ? (
          <p className="muted">Loading your games…</p>
        ) : myGames.length === 0 ? (
          <p className="tiny">You have no games in your history yet.</p>
        ) : (
          <section className="players" style={{ marginTop: "0.5rem" }}>
            <ul>
              {myGames.map(({ game, playerId, isHost }) => (
                <li
                  key={game.id}
                  className="player-item"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div>
                      <strong>{game.code}</strong>{" "}
                      <span className="tiny">
                        {isHost ? "(host)" : "(player)"}
                      </span>
                    </div>
                    <div className="tiny">
                      Status: {game.status || "unknown"} – Phase:{" "}
                      {game.phase || "-"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {game.status !== "ended" && (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          handleRejoinGameFromHome(game.id)
                        }
                      >
                        Rejoin
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        handleDeleteFromHistory(
                          game.id,
                          playerId,
                          isHost
                        )
                      }
                    >
                      Delete from history
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}


/* -------------------------------------------------------
   Name form
------------------------------------------------------- */

function NameForm({ onConfirmName }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      setError("Please enter at least one character 😄");
      return;
    }
    if (trimmed.length > 20) {
      setError("Keep it under 20 characters.");
      return;
    }

    setError("");
    onConfirmName(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <input
        className="input"
        placeholder="e.g. Alice, Bob, Prof. Rossi…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn primary">
        Continue
      </button>
    </form>
  );
}

/* -------------------------------------------------------
   Join game by code
------------------------------------------------------- */

function JoinGameForm({ playerName, onJoinedGame }) {
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  async function handleJoin(e) {
    e.preventDefault();
    const trimmed = codeInput.trim().toUpperCase();

    if (!trimmed) {
      setError("Please enter a game code.");
      return;
    }

    setError("");
    setIsJoining(true);

    try {
      const { data: game, error: gameError } = await supabase
        .from("games")
        .select("*")
        .eq("code", trimmed)
        .single();

      if (gameError || !game) {
        console.error("Error finding game:", gameError);
        setError("Game not found. Check the code and try again.");
        return;
      }

      // Se questo nome è già un player in quel game → rejoin
      const { data: existingPlayers, error: existingError } = await supabase
        .from("players")
        .select("*")
        .eq("game_id", game.id)
        .eq("name", playerName)
        .order("joined_at", { ascending: true });

      if (existingError) {
        console.error("Error checking existing player:", existingError);
        setError("Something went wrong while checking your player.");
        return;
      }

      const existingPlayer = existingPlayers?.[0] || null;

      if (existingPlayer) {
        const hydrated = await hydrateGame(game.id);
        onJoinedGame(hydrated, existingPlayer.id);
        return;
      }

      // Se non è lobby e non sei già player → non puoi entrare
      if (game.status !== "lobby") {
        setError(
          "This game has already started and you are not part of it."
        );
        return;
      }

      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert({
          game_id: game.id,
          name: playerName,
          is_host: false,
          alive: true,
        })
        .select()
        .single();

      if (playerError) {
        console.error("Error joining game:", playerError);
        setError("Failed to join the game. Please try again.");
        return;
      }

      const hydrated = await hydrateGame(game.id);
      onJoinedGame(hydrated, player.id);
    } catch (err) {
      console.error(err);
      setError("Unexpected error while joining the game.");
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <form onSubmit={handleJoin} className="form" style={{ marginTop: "1rem" }}>
      <label className="muted" style={{ fontSize: "0.85rem" }}>
        Enter a game code shared by the host:
      </label>
      <input
        className="input"
        placeholder="e.g. ABC-123"
        value={codeInput}
        onChange={(e) => setCodeInput(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn secondary" disabled={isJoining}>
        {isJoining ? "Joining..." : "Join game"}
      </button>
    </form>
  );
}

/* -------------------------------------------------------
   Lobby + Night + Day UI
------------------------------------------------------- */
// -------------------------------------------------------
// Calcola eventuale vincitore a partire dai players
// -------------------------------------------------------
function computeWinnerFromPlayers(players) {
  const aliveNonHost = players.filter(
    (p) => p.alive !== false && !p.isHost
  );
  const mafiaAlive = aliveNonHost.filter((p) => p.role === "MAFIA").length;
  const goodAlive = aliveNonHost.length - mafiaAlive;

  if (aliveNonHost.length === 0) {
    return null; // situazione strana, nessuno vivo
  }

  if (mafiaAlive === 0) {
    return "VILLAGERS"; // tutti i mafia morti
  }

  if (mafiaAlive >= goodAlive) {
    return "MAFIA"; // mafia >= buoni => mafia vince
  }

  return null; // partita continua
}
function Lobby({
  game,
  account,
  playerName,
  currentPlayerId,
  onLogout,
  onLeaveGame,
  onPlayersUpdated,
  onGameUpdated,
}) {
  const isHost = game.hostName === playerName;
  const [isStarting, setIsStarting] = useState(false);
  const [resolvingNight, setResolvingNight] = useState(false);
  const [resolvingDay, setResolvingDay] = useState(false);
  const [detectiveResult, setDetectiveResult] = useState("");
  const [nightStatus, setNightStatus] = useState(null);
  const [dayStatus, setDayStatus] = useState(null);
  const [actionsLoading, setActionsLoading] = useState(false);

  const me = game.players.find((p) => p.id === currentPlayerId) || null;

  const isNight =
    game.phase === "night_1" ||
    (game.phase && game.phase.toLowerCase().startsWith("night"));

  const isDay =
    !isNight && game.phase && game.phase.toLowerCase().startsWith("day");

  const alivePlayers = game.players.filter(
    (p) => p.alive !== false && !p.isHost
  );
  const isDead = !!me && me.alive === false;
  const isGameOver =
    game.status === "ended" || game.phase === "ended";
  const phaseLabel = (() => {
    if (game.phase === "lobby") return "Lobby";
    if (isNight) return `Night ${game.dayNumber || 1}`;
    if (isDay) return `Day ${game.dayNumber || 1}`;
    return game.phase || "Unknown phase";
  })();

  // Realtime: players
  useEffect(() => {
    let isCancelled = false;

    async function syncPlayersAndMaybePhase() {
      try {
        const players = await fetchPlayersForGame(game.id);
        if (isCancelled) return;

        onPlayersUpdated(players);

        if (
          game.phase === "lobby" &&
          players.some((p) => p.role && p.role.length > 0)
        ) {
          onGameUpdated({
            status: "ongoing",
            phase: "night_1",
            dayNumber: 1,
          });
        }
      } catch (err) {
        console.error("Error syncing players:", err);
      }
    }

    syncPlayersAndMaybePhase();

    const channel = supabase
      .channel(`players-game-${game.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `game_id=eq.${game.id}`,
        },
        () => {
          syncPlayersAndMaybePhase();
        }
      )
      .subscribe();

    return () => {
      isCancelled = true;
      supabase.removeChannel(channel);
    };
  }, [game.id, game.phase, onPlayersUpdated, onGameUpdated]);

  // Realtime: game
  useEffect(() => {
    let cancelled = false;

    async function syncGame() {
      try {
        const g = await fetchGameById(game.id);
        if (cancelled) return;
        onGameUpdated({
          id: g.id,
          code: g.code,
          hostName: g.hostName,
          status: g.status,
          phase: g.phase,
          dayNumber: g.dayNumber,
        });
      } catch (err) {
        console.error("Error syncing game:", err);
      }
    }

    syncGame();

    const channel = supabase
      .channel(`games-${game.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "games",
          filter: `id=eq.${game.id}`,
        },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          onGameUpdated({
            id: row.id,
            code: row.code,
            hostName: row.host_name,
            status: row.status,
            phase: row.phase,
            dayNumber: row.day_number,
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [game.id, onGameUpdated]);

  async function handleStartGame() {
    if (!isHost) return;
    if (isStarting) return;

    setIsStarting(true);
    try {
      const players = await fetchPlayersForGame(game.id);

      if (players.length < 4) {
        alert("You need at least 4 players to start a game.");
        setIsStarting(false);
        return;
      }

      const hostPlayer = players.find((p) => p.isHost);
      const nonHostPlayers = players.filter((p) => !p.isHost);

      if (!hostPlayer) {
        alert("No host player found.");
        setIsStarting(false);
        return;
      }

      if (nonHostPlayers.length < 3) {
        alert("You need at least 3 non-host players for roles.");
        setIsStarting(false);
        return;
      }

      const roles = buildRoles(nonHostPlayers.length);

      for (let i = 0; i < nonHostPlayers.length; i++) {
        const p = nonHostPlayers[i];
        const role = roles[i];

        const { error } = await supabase
          .from("players")
          .update({ role, alive: true })
          .eq("id", p.id);

        if (error) {
          console.error("Error updating player role:", p, error);
          alert(`Failed to assign roles: ${error.message}`);
          setIsStarting(false);
          return;
        }
      }

      const { error: hostUpdateError } = await supabase
        .from("players")
        .update({ role: null, alive: true })
        .eq("id", hostPlayer.id);

      if (hostUpdateError) {
        console.error("Error updating host player:", hostUpdateError);
        alert("Roles assigned, but failed to update host.");
        setIsStarting(false);
        return;
      }

      const { error: gameUpdateError } = await supabase
        .from("games")
        .update({
          status: "ongoing",
          phase: "night_1",
          day_number: 1,
        })
        .eq("id", game.id);

      if (gameUpdateError) {
        console.error("Error updating game phase:", gameUpdateError);
        alert(
          `Roles assigned, but failed to update game phase: ${gameUpdateError.message}`
        );
      }

      onGameUpdated({
        status: "ongoing",
        phase: "night_1",
        dayNumber: 1,
      });
    } catch (err) {
      console.error("Error starting game:", err);
      alert(
        `Unexpected error while starting the game: ${
          err?.message || String(err)
        }`
      );
    } finally {
      setIsStarting(false);
    }
  }

   async function handleResolveNight() {
    if (!isHost) return;
    if (!isNight) return;
    if (resolvingNight) return;

    setResolvingNight(true);
    try {
      const dayNumber = game.dayNumber || 1;

      const { data: actions, error } = await supabase
        .from("actions")
        .select("*")
        .eq("game_id", game.id)
        .eq("phase", "night")
        .eq("day_number", dayNumber);

      if (error) {
        console.error("Error fetching night actions:", error);
        alert("Failed to fetch night actions.");
        return;
      }

      const mafiaActions = actions.filter(
        (a) => a.action_type === "MAFIA_KILL" && a.target_player_id
      );
      const doctorActions = actions.filter(
        (a) => a.action_type === "DOCTOR_PROTECT" && a.target_player_id
      );

      let mafiaTargetId = null;
      if (mafiaActions.length > 0) {
        const counts = {};
        for (const a of mafiaActions) {
          const t = a.target_player_id;
          counts[t] = (counts[t] || 0) + 1;
        }
        let max = 0;
        for (const [target, count] of Object.entries(counts)) {
          if (count > max) {
            max = count;
            mafiaTargetId = target;
          }
        }
      }

      let doctorTargetId = null;
      if (doctorActions.length > 0) {
        const last = doctorActions[doctorActions.length - 1];
        doctorTargetId = last.target_player_id;
      }

      let killedName = null;

      if (mafiaTargetId && mafiaTargetId !== doctorTargetId) {
        const { data: killedPlayer, error: killError } = await supabase
          .from("players")
          .update({ alive: false })
          .eq("id", mafiaTargetId)
          .select()
          .single();

        if (killError) {
          console.error("Error killing player:", killError);
          alert("Failed to update killed player.");
          return;
        }

        killedName = killedPlayer.name;
      }

      // Reload players to see who is dead
      const players = await fetchPlayersForGame(game.id);
      onPlayersUpdated(players);

      if (killedName) {
        alert(`Night is over. ${killedName} was killed.`);
      } else {
        alert("Night is over. No one was killed.");
      }

      // 👉 Controllo fine partita
      const winner = computeWinnerFromPlayers(players);
      if (winner) {
        const { error: gameEndError } = await supabase
          .from("games")
          .update({
            status: "ended",
            phase: "ended",
          })
          .eq("id", game.id);

        if (gameEndError) {
          console.error("Error updating game to ended:", gameEndError);
        }

        onGameUpdated({
          status: "ended",
          phase: "ended",
        });

        alert(
          `Game over! ${
            winner === "MAFIA" ? "Mafia" : "Villagers"
          } win the game.`
        );
        return; // non passiamo al giorno
      }

      // Se il gioco non è finito, passiamo al giorno
      const dayNumberToUse = game.dayNumber || 1;

      const { error: gameUpdateError } = await supabase
        .from("games")
        .update({
          phase: `day_${dayNumberToUse}`,
          day_number: dayNumberToUse,
        })
        .eq("id", game.id);

      if (gameUpdateError) {
        console.error("Error updating game phase to day:", gameUpdateError);
      }

      onGameUpdated({
        phase: `day_${dayNumberToUse}`,
        dayNumber: dayNumberToUse,
      });
    } catch (err) {
      console.error("Error resolving night:", err);
      alert(
        `Unexpected error while resolving the night: ${
          err?.message || String(err)
        }`
      );
    } finally {
      setResolvingNight(false);
    }
  }

   async function handleResolveDay() {
    if (!isHost) return;
    if (!isDay) return;
    if (resolvingDay) return;

    setResolvingDay(true);
    try {
      const dayNumber = game.dayNumber || 1;

      const { data: actions, error } = await supabase
        .from("actions")
        .select("*")
        .eq("game_id", game.id)
        .eq("phase", "day")
        .eq("day_number", dayNumber)
        .eq("action_type", "DAY_VOTE");

      if (error) {
        console.error("Error fetching day votes:", error);
        alert("Failed to fetch day votes.");
        return;
      }

      let lynchTargetId = null;

      if (actions.length > 0) {
        const counts = {};
        for (const a of actions) {
          const t = a.target_player_id;
          if (!t) continue;
          counts[t] = (counts[t] || 0) + 1;
        }

        let max = 0;
        let maxId = null;
        let tie = false;

        for (const [target, count] of Object.entries(counts)) {
          if (count > max) {
            max = count;
            maxId = target;
            tie = false;
          } else if (count === max) {
            tie = true;
          }
        }

        if (!tie && maxId) {
          lynchTargetId = maxId;
        }
      }

      let lynchedName = null;

      if (lynchTargetId) {
        const { data: lynchedPlayer, error: lynchError } = await supabase
          .from("players")
          .update({ alive: false })
          .eq("id", lynchTargetId)
          .select()
          .single();

        if (lynchError) {
          console.error("Error lynching player:", lynchError);
          alert("Failed to update lynched player.");
          return;
        }

        lynchedName = lynchedPlayer.name;
      }

      const players = await fetchPlayersForGame(game.id);
      onPlayersUpdated(players);

      if (lynchedName) {
        alert(`Day is over. ${lynchedName} was lynched.`);
      } else {
        alert("Day is over. No one was lynched.");
      }

      // 👉 Controllo fine partita dopo la votazione
      const winner = computeWinnerFromPlayers(players);
      if (winner) {
        const { error: gameEndError } = await supabase
          .from("games")
          .update({
            status: "ended",
            phase: "ended",
          })
          .eq("id", game.id);

        if (gameEndError) {
          console.error("Error updating game to ended:", gameEndError);
        }

        onGameUpdated({
          status: "ended",
          phase: "ended",
        });

        alert(
          `Game over! ${
            winner === "MAFIA" ? "Mafia" : "Villagers"
          } win the game.`
        );
        return; // non passiamo alla notte
      }

      // Nessun vincitore ancora → notte successiva
      const nextDayNumber = (game.dayNumber || 1) + 1;

      const { error: gameUpdateError } = await supabase
        .from("games")
        .update({
          phase: `night_${nextDayNumber}`,
          day_number: nextDayNumber,
        })
        .eq("id", game.id);

      if (gameUpdateError) {
        console.error(
          "Error updating game phase to next night:",
          gameUpdateError
        );
      }

      onGameUpdated({
        phase: `night_${nextDayNumber}`,
        dayNumber: nextDayNumber,
      });
    } catch (err) {
      console.error("Error resolving day:", err);
      alert(
        `Unexpected error while resolving the day: ${
          err?.message || String(err)
        }`
      );
    } finally {
      setResolvingDay(false);
    }
  }
    async function handleEndGameManual() {
    if (!isHost) return;
    const confirmed = window.confirm(
      "End this game for everyone? Players will no longer be able to act."
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("games")
        .update({
          status: "ended",
          phase: "ended",
        })
        .eq("id", game.id);

      if (error) {
        console.error("Error ending game:", error);
        alert("Failed to end the game.");
        return;
      }

      onGameUpdated({
        status: "ended",
        phase: "ended",
      });

      alert("Game ended.");
      onLeaveGame(); // l'host esce
    } catch (err) {
      console.error("Error ending game manually:", err);
      alert("Unexpected error while ending the game.");
    }
  }

  function handleDetectiveInvestigation(targetId) {
    const target = game.players.find((p) => p.id === targetId);
    if (!target) {
      setDetectiveResult("Could not find that player.");
      return;
    }
    if (!target.role) {
      setDetectiveResult(
        `${target.name} does not have an assigned role yet.`
      );
      return;
    }
    if (target.role === "MAFIA") {
      setDetectiveResult(
        `You sense something suspicious about ${target.name}...`
      );
    } else {
      setDetectiveResult(
        `${target.name} seems innocent (or at least not Mafia).`
      );
    }
  }

  async function refreshActionsStatus() {
    if (!isHost) return;
    setActionsLoading(true);
    try {
      const dayNumber = game.dayNumber || 1;
      if (isNight) {
        const status = await fetchNightActionStatus(game.id, dayNumber);
        setNightStatus(status);
        setDayStatus(null);
      } else if (isDay) {
        const status = await fetchDayVoteStatus(game.id, dayNumber);
        setDayStatus(status);
        setNightStatus(null);
      } else {
        setNightStatus(null);
        setDayStatus(null);
      }
    } catch (err) {
      console.error("Error refreshing actions status:", err);
      alert("Failed to refresh master view.");
    } finally {
      setActionsLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div>
            <h1>🌑 Lupus @ GSSI</h1>
            <p>{phaseLabel}</p>
            <div className="game-code">{game.code}</div>
          </div>
          {account && (
            <div style={{ textAlign: "right" }}>
              <p className="tiny">Logged in as {account?.username}</p>
              <button className="btn ghost" onClick={onLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="card">
        <h2>Game lobby</h2>
        <p className="muted">
          Share this code with other players. As they join, they will appear in
          the list below automatically.
        </p>

        <section className="players">
          <h3>Players</h3>
          <ul>
            {game.players.map((p) => (
              <li key={p.id} className="player-item">
                <span>
                  {p.name}
                  {p.id === currentPlayerId ? " (you)" : ""}
                  {p.alive === false && " (dead)"}
                </span>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {p.isHost && <span className="badge">Host</span>}
                  {isHost && p.role && (
                    <span className="badge">{p.role}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {!isHost && isDead && (
          <section
            className="players"
            style={{
              marginTop: "1rem",
              borderStyle: "solid",
              borderColor: "#b91c1c",
            }}
          >
            <h3>You have been eliminated</h3>
            <p className="muted">
              You are no longer part of the game. You can still follow the
              discussion, but you cannot act anymore.
            </p>
            {me.role && (
              <p style={{ marginTop: "0.5rem" }}>
                You were: <strong>{me.role}</strong>
              </p>
            )}
          </section>
        )}

        {me && me.role && (
          <section
            className="players"
            style={{ marginTop: "1rem", borderStyle: "dashed" }}
          >
            <h3>Your role</h3>
            <p className="muted">
              This information is only visible on your device (other players
              see only their own roles).
            </p>
            <p style={{ fontSize: "1.1rem", marginTop: "0.5rem" }}>
              🃏 <strong>{me.role}</strong>
            </p>
          </section>
        )}

          {!isGameOver && isNight && me && me.alive !== false && me.role &&  (
          <section
            className="players"
            style={{ marginTop: "1rem", borderStyle: "dotted" }}
          >
            <h3>Night actions</h3>
            {me.role === "MAFIA" && (
              <NightMafiaActions
                me={me}
                game={game}
                alivePlayers={alivePlayers}
              />
            )}
            {me.role === "DOCTOR" && (
              <NightDoctorActions
                me={me}
                game={game}
                alivePlayers={alivePlayers}
              />
            )}
            {me.role === "DETECTIVE" && (
              <NightDetectiveActions
                me={me}
                game={game}
                alivePlayers={alivePlayers}
                detectiveResult={detectiveResult}
                onInvestigate={handleDetectiveInvestigation}
              />
            )}
            {me.role === "CITIZEN" && (
              <p className="muted">
                You are a Citizen. Try not to panic and survive the night.
              </p>
            )}
          </section>
        )}

        {!isGameOver && isDay && me && me.alive !== false && me.role && (
          <section
            className="players"
            style={{ marginTop: "1rem", borderStyle: "dotted" }}
          >
            <h3>Day voting</h3>
            <DayVotingActions me={me} game={game} alivePlayers={alivePlayers} />
          </section>
        )}

        {isHost && (
          <>
            <section
              className="players"
              style={{ marginTop: "1rem", borderStyle: "dotted" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <h3>Master panel</h3>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
                  onClick={refreshActionsStatus}
                  disabled={actionsLoading}
                >
                  {actionsLoading ? "Refreshing..." : "Refresh actions"}
                </button>
              </div>

              {isNight && (
                <>
                  <p className="tiny">
                    Night overview: which special roles have submitted their
                    actions.
                  </p>
                  <ul>
                    {alivePlayers.map((p) => {
                      const s = nightStatus?.[p.id] || {};
                      return (
                        <li key={p.id} className="player-item">
                          <span>{p.name}</span>
                          <div
                            style={{
                              display: "flex",
                              gap: "0.4rem",
                              fontSize: "0.8rem",
                            }}
                          >
                            {p.role === "MAFIA" && (
                              <span
                                className="badge"
                                style={{
                                  opacity: s.mafiaKill ? 1 : 0.5,
                                }}
                              >
                                Mafia action {s.mafiaKill ? "✓" : "…"}
                              </span>
                            )}
                            {p.role === "DOCTOR" && (
                              <span
                                className="badge"
                                style={{
                                  opacity: s.doctorProtect ? 1 : 0.5,
                                }}
                              >
                                Doctor action {s.doctorProtect ? "✓" : "…"}
                              </span>
                            )}
                            {p.role === "DETECTIVE" && (
                              <span
                                className="badge"
                                style={{
                                  opacity: s.detectiveInvestigate ? 1 : 0.5,
                                }}
                              >
                                Detective action{" "}
                                {s.detectiveInvestigate ? "✓" : "…"}
                              </span>
                            )}
                            {p.role === "CITIZEN" && (
                              <span className="badge" style={{ opacity: 0.5 }}>
                                Citizen
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {isDay && (
                <>
                  <p className="tiny">
                    Day overview: which players have already cast their vote.
                  </p>
                  <ul>
                    {alivePlayers.map((p) => {
                      const voted = !!dayStatus?.[p.id];
                      return (
                        <li key={p.id} className="player-item">
                          <span>{p.name}</span>
                          <span
                            className="badge"
                            style={{ opacity: voted ? 1 : 0.5 }}
                          >
                            {voted ? "Voted ✓" : "No vote yet"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>

                                    <div
              style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
            >
              {!isGameOver && game.phase === "lobby" && (
                <button
                  className="btn primary"
                  onClick={handleStartGame}
                  disabled={isStarting}
                >
                  {isStarting ? "Starting..." : "Start game"}
                </button>
              )}
              {!isGameOver && isNight && (
                <button
                  className="btn primary"
                  onClick={handleResolveNight}
                  disabled={resolvingNight}
                >
                  {resolvingNight ? "Resolving..." : "Resolve night"}
                </button>
              )}
              {!isGameOver && isDay && (
                <button
                  className="btn primary"
                  onClick={handleResolveDay}
                  disabled={resolvingDay}
                >
                  {resolvingDay ? "Resolving..." : "Resolve day"}
                </button>
              )}

              {/* Nuovo pulsante: termina partita ed esci */}
              {!isGameOver && (
                <button
                  className="btn ghost"
                  onClick={handleEndGameManual}
                >
                  End game &amp; leave
                </button>
              )}
            </div>
          </>
        )}

        <button className="btn ghost" onClick={onLeaveGame}>
          Leave game
        </button>
      </main>
    </div>
  );
}

/* -------------------------------------------------------
   Night action components
------------------------------------------------------- */

function NightMafiaActions({ me, game, alivePlayers }) {
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("");

  const possibleTargets = alivePlayers.filter((p) => p.id !== me.id);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId) {
      setStatus("Select a target first.");
      return;
    }
    try {
      await submitNightAction({
        gameId: game.id,
        playerId: me.id,
        dayNumber: game.dayNumber || 1,
        actionType: "MAFIA_KILL",
        targetPlayerId: targetId,
      });
      setStatus("Kill submitted.");
    } catch (err) {
      console.error("Error submitting mafia action:", err);
      setStatus("Failed to submit action.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label className="muted" style={{ fontSize: "0.85rem" }}>
        Mafia: choose a player to kill tonight.
      </label>
      <select
        className="input"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        <option value="">Select a target…</option>
        {possibleTargets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {status && <p className="tiny">{status}</p>}
      <button type="submit" className="btn secondary">
        Submit kill
      </button>
    </form>
  );
}

function NightDoctorActions({ me, game, alivePlayers }) {
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId) {
      setStatus("Select someone to protect.");
      return;
    }
    try {
      await submitNightAction({
        gameId: game.id,
        playerId: me.id,
        dayNumber: game.dayNumber || 1,
        actionType: "DOCTOR_PROTECT",
        targetPlayerId: targetId,
      });
      setStatus("Protection submitted.");
    } catch (err) {
      console.error("Error submitting doctor action:", err);
      setStatus("Failed to submit action.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label className="muted" style={{ fontSize: "0.85rem" }}>
        Doctor: choose a player to protect tonight.
      </label>
      <select
        className="input"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        <option value="">Select someone…</option>
        {alivePlayers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {status && <p className="tiny">{status}</p>}
      <button type="submit" className="btn secondary">
        Submit protection
      </button>
    </form>
  );
}

function NightDetectiveActions({
  me,
  game,
  alivePlayers,
  detectiveResult,
  onInvestigate,
}) {
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("");

  const possibleTargets = alivePlayers.filter(
    (p) => p.id !== me.id && !p.isHost
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId) {
      setStatus("Select a target.");
      return;
    }
    try {
      await submitNightAction({
        gameId: game.id,
        playerId: me.id,
        dayNumber: game.dayNumber || 1,
        actionType: "DETECTIVE_INVESTIGATE",
        targetPlayerId: targetId,
      });
      onInvestigate(targetId);
      setStatus("Investigation submitted.");
    } catch (err) {
      console.error("Error submitting detective action:", err);
      setStatus("Failed to submit investigation.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label className="muted" style={{ fontSize: "0.85rem" }}>
        Detective: choose a player to investigate tonight.
      </label>
      <select
        className="input"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        <option value="">Select a target…</option>
        {possibleTargets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn secondary">
        Investigate
      </button>
      {status && (
        <p className="tiny" style={{ marginTop: "0.5rem" }}>
          {status}
        </p>
      )}
      {detectiveResult && (
        <p className="tiny" style={{ marginTop: "0.5rem" }}>
          {detectiveResult}
        </p>
      )}
    </form>
  );
}

/* -------------------------------------------------------
   Day voting
------------------------------------------------------- */

function DayVotingActions({ me, game, alivePlayers }) {
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("");

  const possibleTargets = alivePlayers.filter((p) => p.id !== me.id);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId) {
      setStatus("Select someone to vote for.");
      return;
    }
    try {
      await submitDayVote({
        gameId: game.id,
        playerId: me.id,
        dayNumber: game.dayNumber || 1,
        targetPlayerId: targetId,
      });
      setStatus(
        "Vote submitted. You can change it until the host resolves the day."
      );
    } catch (err) {
      console.error("Error submitting day vote:", err);
      setStatus("Failed to submit vote.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label className="muted" style={{ fontSize: "0.85rem" }}>
        During the day, discuss and vote to lynch a player.
      </label>
      <select
        className="input"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        <option value="">Select a player…</option>
        {possibleTargets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {status && (
        <p className="tiny" style={{ marginTop: "0.5rem" }}>
          {status}
        </p>
      )}
      <button type="submit" className="btn secondary">
        Submit vote
      </button>
    </form>
  );
}

/* -------------------------------------------------------
   Auth screen (login / register)
------------------------------------------------------- */

function AuthScreen({ onLoggedIn }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const u = username.trim();
    const p = password.trim();

    if (!u || !p) {
      setError("Please enter both username and password.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const { data: existing, error: checkError } = await supabase
          .from("accounts")
          .select("id")
          .eq("username", u)
          .limit(1);

        if (checkError) {
          console.error("Error checking account:", checkError);
          setError("Something went wrong. Please try again.");
          return;
        }

        if (existing && existing.length > 0) {
          setError("This username is already taken.");
          return;
        }

        const { data: acc, error: insertError } = await supabase
          .from("accounts")
          .insert({
            username: u,
            password: p, // plaintext, ok per gioco interno
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating account:", insertError);
          setError("Failed to create the account.");
          return;
        }

        onLoggedIn({ id: acc.id, username: acc.username });
        return;
      } else {
        const { data: rows, error: loginError } = await supabase
          .from("accounts")
          .select("*")
          .eq("username", u)
          .eq("password", p)
          .limit(1);

        if (loginError) {
          console.error("Error logging in:", loginError);
          setError("Something went wrong. Please try again.");
          return;
        }

        const acc = rows?.[0];
        if (!acc) {
          setError("Invalid username or password.");
          return;
        }

        onLoggedIn({ id: acc.id, username: acc.username });
      }
    } catch (err) {
      console.error("Auth error:", err);
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>Account login</p>
      </header>
      <main className="card">
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            type="button"
            className={`btn ${mode === "login" ? "primary" : "secondary"}`}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={`btn ${mode === "register" ? "primary" : "secondary"}`}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn primary" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Logging in..."
                : "Registering..."
              : mode === "login"
              ? "Login"
              : "Register"}
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;