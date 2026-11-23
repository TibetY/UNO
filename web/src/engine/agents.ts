import { COLORS, type CardId, type Color, isWild, parseCard, points } from "./cards";
import type { Action, GameResult, Observation } from "./engine";
import { Rng } from "./rng";

export interface Agent {
  readonly name: string;
  onGameStart(player: number, seed: number): void;
  act(obs: Observation, legal: Action[]): Action;
  onGameEnd?(result: GameResult): void;
}

abstract class BaseAgent implements Agent {
  abstract readonly name: string;
  protected rng = new Rng(1);
  protected player = 0;
  onGameStart(player: number, seed: number) {
    this.player = player;
    this.rng = new Rng(seed);
  }
  abstract act(obs: Observation, legal: Action[]): Action;
}

const find = (legal: Action[], type: Action["type"]) => legal.find((a) => a.type === type)!;
const plays = (legal: Action[]) => legal.filter((a): a is Extract<Action, { type: "play" }> => a.type === "play");

function colorCounts(hand: readonly CardId[]) {
  const counts = new Map<Color, number>();
  for (const c of hand) {
    const col = parseCard(c).color;
    if (col) counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  return counts;
}

/** Uniformly random legal action. */
export class RandomAgent extends BaseAgent {
  readonly name = "random";
  act(_obs: Observation, legal: Action[]) {
    return this.rng.pick(legal);
  }
}

/** Always plays if it can (colored cards first, highest points first); never challenges. */
export class GreedyAgent extends BaseAgent {
  readonly name = "greedy";
  act(obs: Observation, legal: Action[]): Action {
    const ps = plays(legal);
    if (obs.phase === "respond" && !ps.length) return find(legal, "accept");
    if (!ps.length) return legal[0];
    const colored = ps.filter((a) => !isWild(parseCard(a.card).rank));
    if (colored.length) return colored.reduce((b, a) => (points(a.card) > points(b.card) ? a : b));
    const wild = ps.some((a) => a.card === "wild") ? "wild" : "wild4";
    const rest = [...obs.hand];
    rest.splice(rest.indexOf(wild), 1);
    const counts = colorCounts(rest);
    const top = Math.max(0, ...counts.values());
    const best = COLORS.filter((c) => (counts.get(c) ?? 0) === top);
    const color = this.rng.pick(best);
    return ps.find((a) => a.card === wild && a.color === color)!;
  }
}

/**
 * Hand-written strategy: holds wilds, plays Wild Draw Four only legally, sticks to
 * its strongest color, uses action cards hard when the opponent is low, and
 * learns across games how often challenging this opponent pays off.
 */
export class HeuristicAgent extends BaseAgent {
  readonly name = "heuristic";
  private chTries = 0;
  private chWins = 0;
  constructor(private threshold = 0.25) {
    super();
  }

  onGameEnd(r: GameResult) {
    this.chTries += r.challenges[this.player];
    this.chWins += r.challengesWon[this.player];
  }

  /** Colors the opponent drew on (so probably lacks). */
  private oppWeak(obs: Observation) {
    const weak = new Map<string, number>();
    const opp = 1 - obs.player;
    let color: string | null = null;
    for (const ev of obs.history) {
      if (ev.event === "play" && ev.color) {
        color = ev.color;
        if (ev.player === opp) weak.set(color, 0);
      } else if (ev.event === "start_card" && ev.card?.includes(":")) {
        color = parseCard(ev.card).color;
      } else if (ev.event === "draw" && ev.voluntary && ev.player === opp && color) {
        weak.set(color, (weak.get(color) ?? 0) + 1);
      }
    }
    return weak;
  }

  private chooseColor(obs: Observation, exclude: CardId): Color {
    const hand = [...obs.hand];
    hand.splice(hand.indexOf(exclude), 1);
    const counts = colorCounts(hand);
    const weak = this.oppWeak(obs);
    let best: Color = COLORS[0];
    let bestScore = -Infinity;
    for (const c of COLORS) {
      const s = (counts.get(c) ?? 0) * 2 + (weak.get(c) ?? 0) + this.rng.next() * 0.01;
      if (s > bestScore) [best, bestScore] = [c, s];
    }
    return best;
  }

  act(obs: Observation, legal: Action[]): Action {
    const ps = plays(legal);
    if (obs.phase === "respond") {
      // Stacking passes the penalty on: always worth it. Prefer a +2 over a +4.
      const stack = ps.find((a) => a.card !== "wild4") ?? ps.find((a) => a.card === "wild4");
      if (stack) {
        if (stack.card !== "wild4") return stack;
        const col = this.chooseColor(obs, "wild4");
        return ps.find((a) => a.card === "wild4" && a.color === col)!;
      }
      return legal.some((a) => a.type === "challenge") ? this.challenge(obs, legal) : find(legal, "accept");
    }
    if (obs.phase === "multi") {
      // Dump extra copies, but keep spare wilds unless we're close to going out.
      const next = ps[0];
      if (!next) return find(legal, "done");
      if (!isWild(parseCard(next.card).rank)) return next;
      if (obs.hand.length > 3 && obs.opponentHandSize > 2) return find(legal, "done");
      const col = this.chooseColor(obs, next.card);
      return ps.find((a) => a.card === next.card && a.color === col)!;
    }
    if (!ps.length) return legal[0];
    const hand = obs.hand;
    const multi = obs.rules.multiPlay;
    const counts = colorCounts(hand);
    const oppLow = obs.opponentHandSize <= 2;
    const hasCurrent = obs.color !== null && (counts.get(obs.color) ?? 0) > 0;

    const value = (card: CardId): number => {
      if (hand.length === 1) return 1000;
      const { rank, color } = parseCard(card);
      if (rank === "wild4") return hasCurrent ? -100 : -30 + (oppLow ? 60 : 0);
      if (rank === "wild") return -20 + (oppLow ? 10 : 0);
      let v = (counts.get(color!) ?? 0) * 3 + points(card) * 0.1;
      // With multi-play, a rank we hold several of empties the hand faster.
      if (multi) v += (hand.filter((h) => parseCard(h).rank === rank).length - 1) * 4;
      if (rank.length > 1) {
        const follow = hand.some((h) => h !== card && (parseCard(h).color === color || isWild(parseCard(h).rank)));
        v += 4 + (oppLow ? 15 : 0) + (follow ? 3 : -2);
        if (rank === "draw2") v += 2;
      }
      return v;
    };

    let best = ps[0];
    let bestV = -Infinity;
    for (const a of ps) {
      const v = value(a.card) + this.rng.next() * 1e-6;
      if (v > bestV) [best, bestV] = [a, v];
    }
    if (obs.phase === "drew" && bestV < -50) return find(legal, "pass");
    if (obs.phase === "turn" && bestV < -50) return find(legal, "draw");
    if (obs.phase === "turn" && isWild(parseCard(best.card).rank) && hand.length > 4 && !oppLow) return find(legal, "draw");
    if (isWild(parseCard(best.card).rank)) {
      const col = this.chooseColor(obs, best.card);
      return ps.find((a) => a.card === best.card && a.color === col)!;
    }
    return best;
  }

  private challenge(obs: Observation, legal: Action[]): Action {
    let prev: string | null = null;
    for (let i = obs.history.length - 2; i >= 0; i--) {
      const ev = obs.history[i];
      if (ev.event === "play" && ev.color) { prev = ev.color; break; }
      if (ev.event === "start_card" && ev.card?.includes(":")) { prev = parseCard(ev.card).color; break; }
    }
    let p = (1 + this.chWins) / (4 + this.chTries);
    p *= Math.min(1.5, 0.5 + obs.opponentHandSize / 8);
    if (prev && (this.oppWeak(obs).get(prev) ?? 0) > 0) p *= 0.3;
    return find(legal, p >= this.threshold ? "challenge" : "accept");
  }
}

export const AGENTS = {
  random: () => new RandomAgent(),
  greedy: () => new GreedyAgent(),
  heuristic: () => new HeuristicAgent(),
} as const;
export type AgentName = keyof typeof AGENTS;
export const AGENT_NAMES = Object.keys(AGENTS) as AgentName[];

export const AGENT_BLURBS: Record<AgentName, string> = {
  random: "Picks any legal move at random",
  greedy: "Always plays if it can, highest points first",
  heuristic: "Holds wilds, plays to its strongest color, attacks when you're low",
};
