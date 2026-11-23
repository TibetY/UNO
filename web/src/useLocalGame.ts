import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS, type Agent, type AgentName } from "./engine/agents";
import { type Action, Game, type GameEvent, type Rules, actionKey } from "./engine/engine";
import { randomSeed } from "./engine/rng";

export type Seat = AgentName | "human";

export interface LocalGameOptions {
  seats: [Seat, Seat];
  rules: Partial<Rules>;
  seed?: number;
  starter?: number;
}

/**
 * Runs a game in the browser. Bot seats move on their own after
 * `delay(newEvents, game)` ms, where newEvents happened since the last move.
 */
export function useLocalGame(delay: (newEvents: readonly GameEvent[], game: Game) => number, paused = false) {
  const game = useRef<Game | null>(null);
  const seen = useRef(0);
  const agents = useRef<(Agent | null)[]>([null, null]);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const start = useCallback((o: LocalGameOptions) => {
    const seed = o.seed ?? randomSeed();
    const starter = o.starter ?? Math.floor(Math.random() * 2);
    // Bots persist across games so learning bots keep what they learned.
    agents.current = o.seats.map((s, p) => {
      if (s === "human") return null;
      const prev = agents.current[p];
      return prev && prev.name === s ? prev : AGENTS[s]();
    });
    agents.current.forEach((a, p) => a?.onGameStart(p, seed * 2 + p + 1));
    game.current = new Game({ seed, starter, rules: o.rules });
    seen.current = 0;
    bump();
  }, []);

  const finishIfOver = () => {
    const g = game.current!;
    if (g.isOver) {
      const r = g.result();
      agents.current.forEach((a) => a?.onGameEnd?.(r));
    }
  };

  const stepBot = useCallback(() => {
    const g = game.current;
    if (!g || g.isOver) return;
    const a = agents.current[g.current];
    if (!a) return;
    g.step(a.act(g.observation(g.current), g.legalActions()));
    finishIfOver();
    bump();
  }, []);

  const act = useCallback((action: Action) => {
    const g = game.current;
    if (!g || g.isOver || agents.current[g.current]) return;
    if (!g.legalActions().some((a) => actionKey(a) === actionKey(action))) return;
    g.step(action);
    finishIfOver();
    bump();
  }, []);

  /** Several of the human's moves in a row (cards picked together). */
  const actMany = useCallback((actions: Action[]) => {
    const g = game.current;
    if (!g) return;
    const me = g.current;
    if (agents.current[me]) return;
    for (const action of actions) {
      if (g.isOver || g.current !== me) break;
      if (!g.legalActions().some((a) => actionKey(a) === actionKey(action))) break;
      g.step(action);
    }
    // The cards picked were the whole plan: don't wait for more of the same rank.
    if (!g.isOver && g.current === me && g.phase === "multi") g.step({ type: "done" });
    finishIfOver();
    bump();
  }, []);

  const g = game.current;
  const botToMove = !!g && !g.isOver && !!agents.current[g.current];
  const version = g ? g.events.length * 1000 + g.turn : 0;

  useEffect(() => {
    if (!botToMove || paused) return;
    const fresh = g!.events.slice(seen.current);
    seen.current = g!.events.length;
    const t = window.setTimeout(stepBot, delay(fresh, g!));
    return () => window.clearTimeout(t);
  }, [botToMove, paused, version, stepBot, delay]);

  return { game: g, start, act, actMany, stepBot, botToMove };
}
