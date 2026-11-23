import { RANKS } from "./cards";
import { AGENTS, type Agent, type AgentName } from "./agents";
import { Game, type GameResult, type Rules } from "./engine";

export function playGame(agents: Agent[], seed: number, starter: number, rules?: Partial<Rules>): Game {
  const g = new Game({ seed, starter, rules });
  agents.forEach((a, p) => a.onGameStart(p, seed * 2 + p + 1));
  while (!g.isOver) {
    const p = g.current;
    g.step(agents[p].act(g.observation(p), g.legalActions()));
  }
  const r = g.result();
  agents.forEach((a) => a.onGameEnd?.(r));
  return g;
}

export interface MatchOptions {
  p0: AgentName;
  p1: AgentName;
  games: number;
  seed: number;
  rules?: Partial<Rules>;
  onProgress?: (done: number) => void;
  signal?: AbortSignal;
}

/** Runs games in slices so the page stays responsive. Starting player alternates. */
export async function runMatch(o: MatchOptions): Promise<GameResult[]> {
  const agents = [AGENTS[o.p0](), AGENTS[o.p1]()];
  const out: GameResult[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < o.games; i++) {
    if (o.signal?.aborted) break;
    out.push(playGame(agents, o.seed * 1_000_003 + i, i % 2, o.rules).result());
    if (performance.now() - sliceStart > 30) {
      o.onProgress?.(i + 1);
      await new Promise((r) => setTimeout(r, 0));
      sliceStart = performance.now();
    }
  }
  o.onProgress?.(out.length);
  return out;
}

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

export interface Summary {
  games: number;
  wins: [number, number];
  draws: number;
  winRate: [number, number];
  winCi: [[number, number], [number, number]];
  firstPlayerRate: number;
  firstPlayerCi: [number, number];
  turnsMean: number;
  turnsMedian: number;
  turnsMax: number;
  pointsPerWin: [number, number];
  perGame: Record<"cardsDrawn" | "cardsPlayed" | "challenges" | "challengesWon" | "wd4Illegal" | "stacks" | "extraCards", [number, number]>;
  reshuffles: number;
  byRank: [Record<string, number>, Record<string, number>];
  turnHistogram: { bucket: number; counts: [number, number][] };
}

export function summarize(rs: GameResult[]): Summary {
  const n = rs.length;
  const wins: [number, number] = [0, 0];
  let draws = 0, starterWins = 0;
  const pts: [number, number] = [0, 0];
  for (const r of rs) {
    if (r.winner === null) draws++;
    else {
      wins[r.winner]++;
      pts[r.winner] += r.points;
      if (r.winner === r.starter) starterWins++;
    }
  }
  const turns = rs.map((r) => r.turns).sort((a, b) => a - b);
  const per = (k: keyof Summary["perGame"]): [number, number] =>
    [0, 1].map((p) => rs.reduce((s, r) => s + r[k][p], 0) / n) as [number, number];
  const byRank: [Record<string, number>, Record<string, number>] = [{}, {}];
  for (const p of [0, 1]) for (const rank of RANKS) {
    const total = rs.reduce((s, r) => s + (r.playedByRank[p][rank] ?? 0), 0);
    if (total) byRank[p][rank] = total / n;
  }
  const bucket = 10;
  const hist = new Map<number, number>();
  for (const t of turns) hist.set(Math.floor(t / bucket) * bucket, (hist.get(Math.floor(t / bucket) * bucket) ?? 0) + 1);
  const decided = n - draws;
  return {
    games: n,
    wins,
    draws,
    winRate: [wins[0] / n, wins[1] / n],
    winCi: [wilson(wins[0], n), wilson(wins[1], n)],
    firstPlayerRate: decided ? starterWins / decided : 0,
    firstPlayerCi: wilson(starterWins, decided),
    turnsMean: turns.reduce((a, b) => a + b, 0) / n,
    turnsMedian: n % 2 ? turns[(n - 1) / 2] : (turns[n / 2 - 1] + turns[n / 2]) / 2,
    turnsMax: turns[n - 1],
    pointsPerWin: [pts[0] / Math.max(1, wins[0]), pts[1] / Math.max(1, wins[1])],
    perGame: {
      cardsDrawn: per("cardsDrawn"),
      cardsPlayed: per("cardsPlayed"),
      challenges: per("challenges"),
      challengesWon: per("challengesWon"),
      wd4Illegal: per("wd4Illegal"),
      stacks: per("stacks"),
      extraCards: per("extraCards"),
    },
    reshuffles: rs.reduce((s, r) => s + r.reshuffles, 0) / n,
    byRank,
    turnHistogram: { bucket, counts: [...hist.entries()].sort((a, b) => a[0] - b[0]) },
  };
}
