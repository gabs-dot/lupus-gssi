import { useState } from "react";
import "./App.css";

// Genera un codice partita tipo "GSSI42"
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

  // 1) Schermata iniziale: chiediamo il nome
  if (!playerName) {
    return (
      <div className="app">
        <header className="header">
          <h1>🌑 Lupus @ GSSI</h1>
          <p>Gioco sociale per PhD, postdoc e prof</p>
        </header>

        <main className="card">
          <h2>Come ti chiami?</h2>
          <p className="muted">
            Il tuo nome verrà mostrato agli altri giocatori durante la partita.
          </p>
          <NameForm onConfirmName={setPlayerName} />
        </main>
      </div>
    );
  }

  // 2) Se esiste una partita → mostra Lobby
  if (currentGame) {
    return (
      <Lobby
        playerName={playerName}
        game={currentGame}
        onLeaveGame={() => setCurrentGame(null)}
      />
    );
  }

  // 3) Home dopo aver inserito il nome
  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>Benvenutə, {playerName}.</p>
      </header>

      <main className="card">
        <h2>Nuova o esistente?</h2>
        <p className="muted">
          Puoi creare una nuova partita e condividere il codice, oppure (più
          avanti) entrare in una partita esistente.
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
          Crea una nuova partita
        </button>

        <button className="btn secondary" disabled>
          Entra in una partita (presto)
        </button>

        <p className="tiny">
          Per ora la modalità “Entra in una partita” sarà attivata quando
          colleghiamo il backend (Supabase/Firebase).
        </p>
      </main>
    </div>
  );
}

// Component per chiedere il nome
function NameForm({ onConfirmName }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      setError("Scrivi almeno un carattere 😄");
      return;
    }
    if (trimmed.length > 20) {
      setError("Tienilo sotto i 20 caratteri.");
      return;
    }

    setError("");
    onConfirmName(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <input
        className="input"
        placeholder="Es. Alice, Bob, Prof. Rossi…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn primary">
        Continua
      </button>
    </form>
  );
}

// Schermata Lobby (dopo "Crea partita")
function Lobby({ game, playerName, onLeaveGame }) {
  const isHost = game.hostName === playerName;

  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>Codice partita</p>
        <div className="game-code">{game.code}</div>
      </header>

      <main className="card">
        <h2>Lobby</h2>
        <p className="muted">
          Condividi il codice con gli altri giocatori. In questa versione
          l&apos;app funziona ancora solo localmente sul tuo dispositivo; tra
          poco la collegheremo al backend per far entrare davvero gli altri.
        </p>

        <section className="players">
          <h3>Giocatori nella lobby</h3>
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
            Avvia partita (presto)
          </button>
        )}

        <button className="btn ghost" onClick={onLeaveGame}>
          Esci dalla partita
        </button>
      </main>
    </div>
  );
}

export default App;