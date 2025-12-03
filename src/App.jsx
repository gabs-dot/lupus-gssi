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

// Fisher–Yates shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build a simple role distribution given number of players
function buildRoles(playerCount) {
  const roles = [];

  // Very simple rules for now:
  // - 1 Mafia per ~4 players (at least 1)
  // - 1 Detective
  // - 1 Doctor
  // - rest Citizens
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

// Insert/update a night action for a player (Mafia/Doctor)
async function submitNightAction({
  gameId,
  playerId,
  dayNumber,
  actionType,
  targetPlayerId,
}) {
  // Remove previous action of this type for this player/night
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
  // Remove previous vote from this player for this day
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
function App() {
  const [playerName, setPlayerName] = useState("");
  const [currentGame, setCurrentGame] = useState(null); // { id, code, hostName, status, phase, dayNumber, players: [] }
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [resolvingDay, setResolvingDay] = useState(false);

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

  // 2) If a game exists → show the Lobby / Night UI
  if (currentGame && currentPlayerId) {
    return (
      <Lobby
        playerName={playerName}
        currentPlayerId={currentPlayerId}
        game={currentGame}
        onLeaveGame={() => {
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

              // 2) Insert host as first player
              const { data: player, error: playerError } = await supabase
                .from("players")
                .insert({
                  game_id: game.id,
                  name: playerName,
                  is_host: true,
                  alive: true,
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

              // 3) Load full game
              const hydrated = await hydrateGame(game.id);

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
            playerName={playerName}
            onJoinedGame={(game, playerId) => {
              setCurrentGame(game);
              setCurrentPlayerId(playerId);
            }}
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
          alive: true,
        })
        .select()
        .single();

      if (playerError) {
        console.error("Error joining game:", playerError);
        setError("Failed to join the game. Please try again.");
        return;
      }

      // 3) Load full game
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

// Lobby + Night UI
function Lobby({
  game,
  playerName,
  currentPlayerId,
  onLeaveGame,
  onPlayersUpdated,
  onGameUpdated,
}) {
  const isHost = game.hostName === playerName;
  const [isStarting, setIsStarting] = useState(false);
  const [resolvingNight, setResolvingNight] = useState(false);
  const [detectiveResult, setDetectiveResult] = useState("");

  const me = game.players.find((p) => p.id === currentPlayerId) || null;

    const isNight =
    game.phase === "night_1" ||
    (game.phase && game.phase.toLowerCase().startsWith("night"));

  const isDay =
    !isNight &&
    game.phase &&
    game.phase.toLowerCase().startsWith("day");

  const alivePlayers = game.players.filter((p) => p.alive !== false);
  const phaseLabel = (() => {
    if (game.phase === "lobby") return "Lobby";
    if (isNight) return `Night ${game.dayNumber || 1}`;
    if (isDay) return `Day ${game.dayNumber || 1}`;
    return game.phase || "Unknown phase";
  })();
  // Realtime subscription for players in this game
  useEffect(() => {
    let isCancelled = false;

    async function syncPlayersAndMaybePhase() {
      try {
        const players = await fetchPlayersForGame(game.id);
        if (isCancelled) return;

        onPlayersUpdated(players);

        // If local game.phase is still "lobby" but some players already have a role,
        // we infer that the host started the game and we are in night_1.
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

    // Initial load
    syncPlayersAndMaybePhase();

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
        () => {
          console.log("Realtime: players changed");
          syncPlayersAndMaybePhase();
        }
      )
      .subscribe((status) => {
        console.log("Realtime players channel status:", status);
      });

    return () => {
      isCancelled = true;
      supabase.removeChannel(channel);
    };
  }, [game.id, game.phase, onPlayersUpdated, onGameUpdated]);

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

      const roles = buildRoles(players.length);

      // Assign roles one by one
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
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

      // Update game phase to Night 1 (in DB)
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
      } else {
        console.log("Game started: night_1");
      }

      // Aggiorna stato locale
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
        console.error("Error fetching actions:", error);
        alert("Failed to fetch night actions.");
        setResolvingNight(false);
        return;
      }

      const mafiaActions = actions.filter(
        (a) => a.action_type === "MAFIA_KILL" && a.target_player_id
      );
      const doctorActions = actions.filter(
        (a) => a.action_type === "DOCTOR_PROTECT" && a.target_player_id
      );

      // Mafia target: majority vote
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

      // Doctor latest action (if any)
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
          setResolvingNight(false);
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

      // Move to "day_1" (UI for daytime to be implemented later)
      const { error: gameUpdateError } = await supabase
        .from("games")
        .update({
          phase: "day_1",
          day_number: dayNumber,
        })
        .eq("id", game.id);

      if (gameUpdateError) {
        console.error("Error updating game phase to day:", gameUpdateError);
      }

      onGameUpdated({
        phase: "day_1",
        dayNumber: dayNumber,
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

  // Detective: local investigation (no DB, just uses roles already in memory)
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
        setResolvingDay(false);
        return;
      }

      // Compute majority
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
          setResolvingDay(false);
          return;
        }

        lynchedName = lynchedPlayer.name;
      }

      // Reload players
      const players = await fetchPlayersForGame(game.id);
      onPlayersUpdated(players);

      if (lynchedName) {
        alert(`Day is over. ${lynchedName} was lynched.`);
      } else {
        alert("Day is over. No one was lynched.");
      }

      // Move to next night
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

  return (
    <div className="app">
      <header className="header">
        <h1>🌑 Lupus @ GSSI</h1>
        <p>{phaseLabel}</p>
        <div className="game-code">{game.code}</div>
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
                  {/* Roles are secret: we do NOT show p.role here */}
                </div>
              </li>
            ))}
          </ul>
        </section>

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

        {isNight && me && me.alive !== false && (
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
                {isDay && me && me.alive !== false && (
          <section
            className="players"
            style={{ marginTop: "1rem", borderStyle: "dotted" }}
          >
            <h3>Day voting</h3>
            <DayVotingActions
              me={me}
              game={game}
              alivePlayers={alivePlayers}
            />
          </section>
        )}

              {isHost && (
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            {!me?.role && (
              <button
                className="btn primary"
                onClick={handleStartGame}
                disabled={isStarting}
              >
                {isStarting ? "Starting..." : "Start game"}
              </button>
            )}
            {me?.role && isNight && (
              <button
                className="btn primary"
                onClick={handleResolveNight}
                disabled={resolvingNight}
              >
                {resolvingNight ? "Resolving..." : "Resolve night"}
              </button>
            )}
            {me?.role && isDay && (
              <button
                className="btn primary"
                onClick={handleResolveDay}
                disabled={resolvingDay}
              >
                {resolvingDay ? "Resolving..." : "Resolve day"}
              </button>
            )}
          </div>
        )}

        <button className="btn ghost" onClick={onLeaveGame}>
          Leave game
        </button>
      </main>
    </div>
  );
}

// Night action components

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

  function handleSubmit(e) {
    e.preventDefault();
    if (!targetId) {
      return;
    }
    onInvestigate(targetId);
  }

  const possibleTargets = alivePlayers.filter((p) => p.id !== me.id);

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
      {detectiveResult && (
        <p className="tiny" style={{ marginTop: "0.5rem" }}>
          {detectiveResult}
        </p>
      )}
    </form>
  );
}
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
export default App;