import { useState } from "react";
import "./App.css";

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

function App() {
  const [playerName, setPlayerName] = useState("");
  const [currentGame, setCurrentGame] = useState(null); // { code, hostName, players: [] }

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
          You can create a new game and share the code, or (soon) join an
          existing one using a code.
        </p>

        <button
          className="btn primary"
          onClick={() => {
            const code = generateGameCode();
            const newGame = {
              code,
              hostName: playerName,
              players: [
                {
                  id: "host",
                  name: playerName,
                  isHost: true,
                },
              ],
            };
            setCurrentGame(newGame);
          }}
        >
          Create a new game
        </button>

        <button className="btn secondary" disabled>
          Join a game (coming soon)
        </button>

        <p className="tiny">
          For now the “Join game” flow will be enabled once we connect a real
          backend so multiple people at GSSI can share the same lobby.
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

// Lobby screen (after “Create a new game”)
function Lobby({ game, playerName, onLeaveGame }) {
  const isHost = game.hostName === playerName;

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
          Share this code with other players. In this version the app still
          runs only on your device; shortly we&apos;ll hook it up to a backend
          so everyone can join the same lobby in real time.
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