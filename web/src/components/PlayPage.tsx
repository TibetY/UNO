import { useCallback, useEffect, useState } from "react";
import { AGENT_BLURBS, AGENT_NAMES, type AgentName } from "../engine/agents";
import type { Game, GameEvent, Rules } from "../engine/engine";
import { dealAnimationMs } from "../anim";
import { cap } from "../engine/cards";
import { useLocalGame } from "../useLocalGame";
import { viewFromGame } from "../view";
import { GameLog, Table } from "./Table";
import { Stage, useImmersive } from "../immersive";

type Opponent = AgentName | "friend";
const FRIEND_NAMES: [string, string] = ["Player 1", "Player 2"];

export function PlayPage({ rules }: { rules: Rules }) {
  const [opponent, setOpponent] = useState<Opponent>("heuristic");
  // The mode of the game on the table (the menu may already show the next one).
  const [hotseat, setHotseat] = useState(false);
  // Pass-and-play: whose cards are showing. Hidden while the device changes hands.
  const [revealed, setRevealed] = useState<number | null>(null);
  const [starter, setStarter] = useState<"" | "0" | "1">("");
  const [seed, setSeed] = useState("");
  const [record, setRecord] = useState<[number, number]>([0, 0]);
  const [counted, setCounted] = useState(-1);
  const delay = useCallback((evs: readonly GameEvent[], g: Game) => 750 + dealAnimationMs(evs, g.rules.handSize), []);
  const { game, start, actMany } = useLocalGame(delay);
  const { enter } = useImmersive();

  const newGame = () => {
    setHotseat(opponent === "friend");
    setRevealed(null);
    start({
      seats: ["human", opponent === "friend" ? "human" : opponent],
      rules,
      seed: seed === "" ? undefined : Number(seed),
      starter: starter === "" ? undefined : Number(starter),
    });
  };

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
  const handoff = hotseat && !game.isOver && revealed !== game.current;
  const view = hotseat
    ? viewFromGame(game, { you: game.isOver || handoff ? null : game.current, names: FRIEND_NAMES })
    : viewFromGame(game, { you: 0, names: ["You", opponent === "friend" ? "Friend" : cap(opponent)] });
  if (hotseat) view.sharedDevice = true;

  return (
    <section className="layout">
      <Stage>
        <Table view={view} onActions={actMany} hideHands={handoff}
          gameOverActions={<button className="btn primary" onClick={newGame}>New game</button>} />
        {handoff && (
          <div className="handoff" role="dialog" aria-label={`${FRIEND_NAMES[game.current]}'s turn`}>
            <p className="eyebrow">Pass the device</p>
            <h2>{FRIEND_NAMES[game.current]}'s turn</h2>
            <p className="help">{FRIEND_NAMES[1 - game.current]}: don't look!</p>
            <button className="btn primary" onClick={() => setRevealed(game.current)}>
              I'm {FRIEND_NAMES[game.current]}, show my cards
            </button>
          </div>
        )}
      </Stage>
      <aside className="side">
        <div className="panel">
          <h3>Game</h3>
          <div className="field">
            <label htmlFor="opp">Opponent</label>
            <select id="opp" value={opponent} onChange={(e) => setOpponent(e.target.value as Opponent)}>
              {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)} (bot)</option>)}
              <option value="friend">A friend on this device</option>
            </select>
            <small className="help">{opponent === "friend"
              ? "Pass-and-play: take turns on one device. Cards stay hidden while you hand it over."
              : AGENT_BLURBS[opponent]}</small>
          </div>
          <div className="field">
            <label htmlFor="starter">Who starts</label>
            <select id="starter" value={starter} onChange={(e) => setStarter(e.target.value as "" | "0" | "1")}>
              <option value="">Random</option>
              <option value="0">{opponent === "friend" ? "Player 1" : "You"}</option>
              <option value="1">{opponent === "friend" ? "Player 2" : "Opponent"}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="seed">Seed <small>(optional, replays the same deal)</small></label>
            <input id="seed" type="number" placeholder="Random" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
          <button className="btn primary wide" onClick={() => { newGame(); enter(); }}>New game</button>
          <div className="note">Seed {game.seed} · This session: {hotseat ? `Player 1 ${record[0]}, Player 2 ${record[1]}` : `you ${record[0]}, bots ${record[1]}`}</div>
        </div>
        <div className="panel log-panel">
          <h3>Log</h3>
          {handoff ? <p className="help">Hidden while the device changes hands.</p> : <GameLog v={view} />}
        </div>
      </aside>
    </section>
  );
}
