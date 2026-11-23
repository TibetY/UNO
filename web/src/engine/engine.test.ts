import { describe, expect, it } from "vitest";
import { buildDeck, points } from "./cards";
import { type Action, Game, type Rules } from "./engine";
import { AGENTS } from "./agents";
import { playGame, runMatch, summarize } from "./simulate";

function setup(hand0: string[], hand1: string[], top: string, o: { color?: string; draw?: string[]; rules?: Partial<Rules> } = {}) {
  const g = new Game({ seed: 1, rules: o.rules });
  g.hands = [[...hand0], [...hand1]];
  g.discard = [top];
  g.color = (o.color ?? top.split(":")[0]) as Game["color"];
  g.drawPile = o.draw ? [...o.draw] : Array(20).fill("yellow:9");
  g.current = 0;
  g.phase = "turn";
  g.events = [];
  return g;
}
const play = (card: string, color?: string): Action => (color ? { type: "play", card, color: color as never } : { type: "play", card });
const all = (g: Game) => [...g.hands[0], ...g.hands[1], ...g.drawPile, ...g.discard].sort();

describe("deck", () => {
  it("has 108 standard cards", () => {
    const d = buildDeck();
    expect(d.length).toBe(108);
    expect(d.filter((c) => c === "red:0").length).toBe(1);
    expect(d.filter((c) => c === "blue:5").length).toBe(2);
    expect(d.filter((c) => c === "wild4").length).toBe(4);
    expect(points("red:7")).toBe(7);
    expect(points("red:draw2")).toBe(20);
    expect(points("wild")).toBe(50);
  });
});

describe("rules", () => {
  it("deals 7 each and never starts on a Wild Draw Four", () => {
    for (let s = 0; s < 50; s++) {
      const g = new Game({ seed: s });
      expect(all(g)).toEqual(buildDeck().sort());
      expect(g.top).not.toBe("wild4");
    }
  });
  it("matches color or rank; wilds always", () => {
    const g = setup(["red:3", "blue:5", "green:7", "wild"], ["red:1"], "red:5");
    const cards = new Set(g.legalActions().filter((a) => a.type === "play").map((a) => (a as { card: string }).card));
    expect(cards).toEqual(new Set(["red:3", "blue:5", "wild"]));
    expect(() => g.step(play("green:7"))).toThrow();
  });
  it("skip and reverse give another turn in 2-player", () => {
    for (const r of ["skip", "reverse"]) {
      const g = setup([`red:${r}`, "blue:1"], ["red:1"], "red:5");
      g.step(play(`red:${r}`));
      expect(g.current).toBe(0);
    }
  });
  it("draw two hits the opponent and keeps the turn", () => {
    const g = setup(["red:draw2", "blue:1"], ["red:1"], "red:5");
    g.step(play("red:draw2"));
    expect(g.hands[1].length).toBe(3);
    expect(g.current).toBe(0);
  });
  it("drawn playable card can be played or kept", () => {
    const g = setup(["blue:1"], ["green:1"], "red:5", { draw: ["red:8"] });
    g.step({ type: "draw" });
    expect(g.phase).toBe("drew");
    expect(g.legalActions()).toEqual([play("red:8"), { type: "pass" }]);
    g.step({ type: "pass" });
    expect(g.current).toBe(1);
  });
  it("draw until playable", () => {
    const g = setup(["blue:1"], ["green:1"], "red:5", { draw: ["red:8", "yellow:2", "yellow:3"], rules: { drawUntilPlayable: true } });
    g.step({ type: "draw" });
    expect(g.hands[0].length).toBe(4);
    expect(g.pending).toBe("red:8");
  });
  it("wild draw four: accept, failed challenge, successful challenge", () => {
    let g = setup(["wild4", "blue:1"], ["green:1"], "red:5");
    g.step(play("wild4", "blue"));
    expect(g.phase).toBe("challenge");
    g.step({ type: "accept" });
    expect([g.hands[1].length, g.current]).toEqual([5, 0]);

    g = setup(["wild4", "blue:1"], ["green:1"], "red:5");
    g.step(play("wild4", "blue"));
    g.step({ type: "challenge" });
    expect([g.hands[1].length, g.current]).toEqual([7, 0]);

    g = setup(["wild4", "red:1"], ["green:1"], "red:5");
    g.step(play("wild4", "blue"));
    g.step({ type: "challenge" });
    expect([g.hands[0].length, g.hands[1].length, g.current, g.color]).toEqual([5, 1, 1, "blue"]);
  });
  it("restricted wild draw four", () => {
    const g = setup(["wild4", "red:1"], ["green:1"], "red:5", { rules: { wd4Restricted: true } });
    expect(g.legalActions().some((a) => a.type === "play" && a.card === "wild4")).toBe(false);
  });
  it("scores the loser's hand, including a final draw two", () => {
    const g = setup(["red:draw2"], ["wild", "blue:skip"], "red:5", { draw: ["yellow:9", "yellow:8"] });
    g.step(play("red:draw2"));
    expect([g.winner, g.score()]).toEqual([0, 50 + 20 + 9 + 8]);
  });
  it("reshuffles the discard pile", () => {
    const g = setup(["blue:1"], ["green:1"], "red:5", { draw: [] });
    g.discard = ["yellow:2", "yellow:3", "red:5"];
    g.step({ type: "draw" });
    expect(g.top).toBe("red:5");
    expect(g.stats.reshuffles).toBe(1);
  });
});

describe("simulation", () => {
  it("conserves cards and always finishes", () => {
    for (let s = 0; s < 200; s++) {
      const g = playGame([AGENTS.random(), AGENTS.heuristic()], s, s % 2);
      expect(g.isOver).toBe(true);
      expect(all(g)).toEqual(buildDeck().sort());
      if (g.winner !== null) expect(g.hands[g.winner].length).toBe(0);
    }
  });
  it("is reproducible and matches the Python engine's statistics", async () => {
    const a = await runMatch({ p0: "heuristic", p1: "random", games: 2000, seed: 1 });
    const b = await runMatch({ p0: "heuristic", p1: "random", games: 2000, seed: 1 });
    expect(a).toEqual(b);
    const s = summarize(a);
    // Python: heuristic beats random ~98%, ~55 turns per game.
    expect(s.winRate[0]).toBeGreaterThan(0.96);
    expect(s.turnsMean).toBeGreaterThan(45);
    expect(s.turnsMean).toBeLessThan(65);
    const g = summarize(await runMatch({ p0: "heuristic", p1: "greedy", games: 3000, seed: 2 }));
    // Python: heuristic vs greedy ~50%, ~32 turns.
    expect(Math.abs(g.winRate[0] - 0.5)).toBeLessThan(0.04);
    expect(g.turnsMean).toBeGreaterThan(28);
    expect(g.turnsMean).toBeLessThan(36);
  });
});
