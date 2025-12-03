import { useState } from "react";
import "./App.css";

function App() {
  const [page, setPage] = useState("home");

  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus nel mio Istituto</h1>
        <p>Gioco online per la nostra scuola</p>
      </header>

      {page === "home" && (
        <main className="main">
          <button onClick={() => setPage("create")} className="btn">
            Crea una nuova partita
          </button>
          <button onClick={() => setPage("join")} className="btn secondary">
            Entra in una partita
          </button>
        </main>
      )}

      {page === "create" && (
        <main className="main">
          <h2>Crea partita</h2>
          <p>(Qui più avanti metteremo il form per creare una stanza)</p>
          <button onClick={() => setPage("home")} className="btn back">
            ← Torna alla home
          </button>
        </main>
      )}

      {page === "join" && (
        <main className="main">
          <h2>Entra in una partita</h2>
          <p>(Qui più avanti metteremo il codice partita da inserire)</p>
          <button onClick={() => setPage("home")} className="btn back">
            ← Torna alla home
          </button>
        </main>
      )}
    </div>
  );
}

export default App;