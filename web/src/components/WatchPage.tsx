import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_NAMES, type AgentName } from "../engine/agents";
import { cap } from "../engine/cards";
import type { Rules } from "../engine/engine";
import { useLocalGame } from "../useLocalGame";
import { viewFromGame } from "../view";
import { GameLog, Table } from "./Table";

export function WatchPage({ rules, active }: { rules: Rules; active: boolean }) {
  const [p0, setP0] = useState<AgentName>("greedy");
  const [p1, setP1] = useState<AgentName>("heuristic");
  const [speed, setSpeed] = useState(55);
  const [paused, setPaused] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const delay = useCallback(() => Math.round(1600 * (1 - speedRef.current / 100) ** 2) + 30, []);
  const { game, start, stepBot } = useLocalGame(delay, paused || !active);

  const newGame = () => start({ seats: [p0, p1], rules });
  useEffect(() => {
    if (!game) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!game?.isOver || !autoNext || paused || !active) return;
    const t = window.setTimeout(newGame, 2500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.isOver, autoNext, paused, game, active]);

  if (!game) return null;
  const n0 = p0 === p1 ? `${cap(p0)} (P1)` : cap(p0);
  const n1 = p0 === p1 ? `${cap(p1)} (P2)` : cap(p1);
  const view = viewFromGame(game, { you: null, names: [n0, n1], showAll: true });

  return (
    <section className="layout">
      <Table view={view} status={paused && !game.isOver ? "Paused" : undefined}
        gameOverActions={<button className="btn primary" onClick={newGame}>Next game</button>} />
      <aside className="side">
        <div className="panel">
          <h3>Bots</h3>
          <div className="grid2">
            <div className="field">
              <label htmlFor="w0">Bottom</label>
              <select id="w0" value={p0} onChange={(e) => setP0(e.target.value as AgentName)}>
                {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="w1">Top</label>
              <select id="w1" value={p1} onChange={(e) => setP1(e.target.value as AgentName)}>
                {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="speed">Speed</label>
            <input id="speed" type="range" min={0} max={100} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </div>
          <label className="check"><input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} /> Start the next game automatically</label>
          <div className="row">
            <button className="btn" onClick={() => setPaused((x) => !x)}>{paused ? "Resume" : "Pause"}</button>
            <button className="btn" onClick={() => { setPaused(true); stepBot(); }}>Step</button>
          </div>
          <button className="btn primary wide" onClick={newGame}>New game</button>
          <div className="note">Seed {game.seed}</div>
        </div>
        <div className="panel log-panel">
          <h3>Log</h3>
          <GameLog v={view} />
        </div>
      </aside>
    </section>
  );
}
