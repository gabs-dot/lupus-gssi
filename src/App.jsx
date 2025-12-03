import { useState, useEffect } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";

// Generate a simple game code like "ABC-123"
function generateGameCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "0123456789";

  let part1 = "";
  for (let i = 0; i < 3; i++) {
    part1 += letters[Math.floor(Math.random() * letters.length)];
  }

  let part2 = "";
  for (let i = 0; i < 3; i++) {
    part2 += numbers[Math.floor(Math.random() * numbers.length)];
  }

  return `${part1}-${part2}`;
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
  }));
}

function App() {
  const [playerName, setPlayerName] = useState("");
  const [currentGame, setCurrentGame] = useState(null); // { id, code, hostName, players: [] }
  const [showJoin, setShowJoin] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // 1) First screen: ask for the display name
  if (!playerName) {
    return (
      <div className="app">
        <header className="header">
          <h1>🌑 Lupus @ GSSI</h1>
          <p>Social deduction game for the GSSI community</p>
        </header>

        <main className="card">
          <h2>What should we call you?</h2>
          <p className="muted">
            This name will be visible to other players during the game.
          </p>
          <NameForm onConfirmName={setPlayerName} />
        </main>
      </div>
    );
  }

  // 2) If a game exists → show the Lobby
  if (currentGame) {
    return (
      <Lobby
        playerName={playerName}
        game={currentGame}
        onLeaveGame={() => setCurrentGame(null)}
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
      />
    );
  }

  // 3) Home after entering the name
  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>Welcome, {playerName}.</p>
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
              // 1) Create game in Supabase
              const code = generateGameCode();

              const { data: game, error: gameError } = await supabase
                .from("games")
                .insert({
                  code,
                  host_name: playerName,
                  status: "lobby",
                })
                .select()
                .single();

              if (gameError) {
                console.error("Error creating game:", gameError);
                alert("Something went wrong while creating the game.");
                return;
              }

              // 2) Insert host as first player
              const { data: player, error: playerError } = await supabase
                .from("players")
                .insert({
                  game_id: game.id,
                  name: playerName,
                  is_host: true,
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

              // 3) Load all players for the lobby (currently just the host)
              const players = await fetchPlayersForGame(game.id);

              const newGame = {
                id: game.id,
                code: game.code,
                hostName: game.host_name,
                players,
              };

              setCurrentGame(newGame);
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
            playerName={playerName}
            onJoinedGame={setCurrentGame}
          />
        )}

        <p className="tiny">
          With realtime enabled, players will appear in the lobby as they join
          from their own devices.
        </p>
      </main>
    </div>
  );
}

// Component: name input
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

// Component: join game by code
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
      // 1) Look up the game by code
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

      if (game.status !== "lobby") {
        setError("This game is no longer in the lobby.");
        return;
      }

      // 2) Insert this player into the lobby
      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert({
          game_id: game.id,
          name: playerName,
          is_host: false,
        })
        .select()
        .single();

      if (playerError) {
        console.error("Error joining game:", playerError);
        setError("Failed to join the game. Please try again.");
        return;
      }

      // 3) Load all players
      const players = await fetchPlayersForGame(game.id);

      const joinedGame = {
        id: game.id,
        code: game.code,
        hostName: game.host_name,
        players,
      };

      onJoinedGame(joinedGame);
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

// Lobby screen (after “Create a new game” or join)
function Lobby({ game, playerName, onLeaveGame, onPlayersUpdated }) {
  const isHost = game.hostName === playerName;

  // Realtime subscription for players in this game
  useEffect(() => {
    let isCancelled = false;

    async function syncPlayers() {
      try {
        const players = await fetchPlayersForGame(game.id);
        if (!isCancelled) {
          onPlayersUpdated(players);
        }
      } catch (err) {
        console.error("Error syncing players:", err);
      }
    }

    // Initial load
    syncPlayers();

    const channel = supabase
      .channel(`players-game-${game.id}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table: "players",
          filter: `game_id=eq.${game.id}`,
        },
        (payload) => {
          console.log("Realtime event for players:", payload);
          syncPlayers();
        }
      )
      .subscribe((status) => {
        console.log("Realtime channel status:", status);
      });

    return () => {
      isCancelled = true;
      supabase.removeChannel(channel);
    };
  }, [game.id, onPlayersUpdated]);

  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>Game code</p>
        <div className="game-code">{game.code}</div>
      </header>

      <main className="card">
        <h2>Lobby</h2>
        <p className="muted">
          Share this code with other players. As they join, they will appear in
          the list below automatically.
        </p>

        <section className="players">
          <h3>Players in the lobby</h3>
          <ul>
            {game.players.map((p) => (
              <li key={p.id} className="player-item">
                <span>{p.name}</span>
                {p.isHost && <span className="badge">Host</span>}
              </li>
            ))}
          </ul>
        </section>

        {isHost && (
          <button className="btn primary" disabled>
            Start game (coming soon)
          </button>
        )}

        <button className="btn ghost" onClick={onLeaveGame}>
          Leave game
        </button>
      </main>
    </div>
  );
}

export default App;