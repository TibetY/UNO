import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS, type Agent, type AgentName } from "./engine/agents";
import { type Action, Game, type Rules, actionKey } from "./engine/engine";
import { randomSeed } from "./engine/rng";

export type Seat = AgentName | "human";

export interface LocalGameOptions {
  seats: [Seat, Seat];
  rules: Partial<Rules>;
  seed?: number;
  starter?: number;
}

/** Runs a game in the browser; bot seats move on their own after `delay()` ms. */
export function useLocalGame(delay: () => number, paused = false) {
  const game = useRef<Game | null>(null);
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

  const g = game.current;
  const botToMove = !!g && !g.isOver && !!agents.current[g.current];
  const version = g ? g.events.length * 1000 + g.turn : 0;

  useEffect(() => {
    if (!botToMove || paused) return;
    const t = window.setTimeout(stepBot, delay());
    return () => window.clearTimeout(t);
  }, [botToMove, paused, version, stepBot, delay]);

  return { game: g, start, act, stepBot, botToMove };
}
