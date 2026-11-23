import { useCallback, useEffect, useState } from "react";
import { AGENT_BLURBS, AGENT_NAMES, type AgentName } from "../engine/agents";
import type { Rules } from "../engine/engine";
import { cap } from "../engine/cards";
import { useLocalGame } from "../useLocalGame";
import { viewFromGame } from "../view";
import { GameLog, Table } from "./Table";

export function PlayPage({ rules }: { rules: Rules }) {
  const [opponent, setOpponent] = useState<AgentName>("heuristic");
  const [starter, setStarter] = useState<"" | "0" | "1">("");
  const [seed, setSeed] = useState("");
  const [record, setRecord] = useState<[number, number]>([0, 0]);
  const [counted, setCounted] = useState(-1);
  const delay = useCallback(() => 750, []);
  const { game, start, act } = useLocalGame(delay);

  const newGame = () =>
    start({
      seats: ["human", opponent],
      rules,
      seed: seed === "" ? undefined : Number(seed),
      starter: starter === "" ? undefined : Number(starter),
    });

  useEffect(() => {
    if (!game) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (game?.isOver && game.winner !== null && counted !== game.seed) {
      setCounted(game.seed);
      setRecord(([a, b]) => (game.winner === 0 ? [a + 1, b] : [a, b + 1]));
    }
  }, [game, game?.isOver, counted]);

  if (!game) return null;
  const view = viewFromGame(game, { you: 0, names: ["You", cap(opponent)] });

  return (
    <section className="layout">
      <Table view={view} onAction={act}
        gameOverActions={<button className="btn primary" onClick={newGame}>New game</button>} />
      <aside className="side">
        <div className="panel">
          <h3>Game</h3>
          <div className="field">
            <label htmlFor="opp">Opponent</label>
            <select id="opp" value={opponent} onChange={(e) => setOpponent(e.target.value as AgentName)}>
              {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
            </select>
            <small className="help">{AGENT_BLURBS[opponent]}</small>
          </div>
          <div className="field">
            <label htmlFor="starter">Who starts</label>
            <select id="starter" value={starter} onChange={(e) => setStarter(e.target.value as "" | "0" | "1")}>
              <option value="">Random</option>
              <option value="0">You</option>
              <option value="1">Opponent</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="seed">Seed <small>(optional, replays the same deal)</small></label>
            <input id="seed" type="number" placeholder="Random" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
          <button className="btn primary wide" onClick={newGame}>New game</button>
          <div className="note">Seed {game.seed} · This session: you {record[0]}, bots {record[1]}</div>
        </div>
        <div className="panel log-panel">
          <h3>Log</h3>
          <GameLog v={view} />
        </div>
      </aside>
    </section>
  );
}
