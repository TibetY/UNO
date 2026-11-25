import { describe, expect, it } from "vitest";
import { buildDeck, points } from "./cards";
import { type Action, Game, HOUSE_RULES, type Rules } from "./engine";
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
    expect(g.phase).toBe("respond");
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

describe("house rules", () => {
  const house = { multiPlay: true, stackDraws: true, numberFinish: true };
  it("multi-play: same number in different colors, last card sets the color", () => {
    const g = setup(["red:5", "blue:5", "green:5", "yellow:1"], ["red:1"], "red:2", { rules: house });
    g.step(play("red:5"));
    expect(g.phase).toBe("multi");
    expect(g.current).toBe(0);
    expect(g.legalActions()).toEqual([play("blue:5"), play("green:5"), { type: "done" }]);
    g.step(play("green:5"));
    g.step(play("blue:5"));
    // No 5s left, so the turn ends by itself.
    expect([g.current, g.color, g.hands[0]]).toEqual([1, "blue", ["yellow:1"]]);
    expect(g.stats.extraCards[0]).toBe(2);
  });
  it("skip/reverse give another turn at once: same color or same symbol can follow", () => {
    for (const r of ["skip", "reverse"]) {
      const g = setup([`red:${r}`, `blue:${r}`, "red:8", "green:1"], ["yellow:1"], "red:2", { rules: house });
      g.step(play(`red:${r}`));
      expect([g.phase, g.current]).toEqual(["turn", 0]);
      const cards = g.legalActions().filter((a) => a.type === "play").map((a) => (a as { card: string }).card);
      expect(cards).toEqual([`blue:${r}`, "red:8"]);
      g.step(play("red:8"));
      expect(g.current).toBe(1);
    }
  });
  it("after a skip with nothing to follow, the player must draw", () => {
    const g = setup(["red:skip", "green:1"], ["yellow:1"], "red:2", { rules: house });
    g.step(play("red:skip"));
    expect(g.legalActions()).toEqual([{ type: "draw" }]);
  });
  it("multi-play: stop early with done", () => {
    const g = setup(["red:5", "blue:5", "yellow:1"], ["red:1"], "red:2", { rules: house });
    g.step(play("red:5"));
    g.step({ type: "done" });
    expect([g.current, g.hands[0].length]).toEqual([1, 2]);
  });
  it("two +2s at once make the opponent draw 4", () => {
    const g = setup(["red:draw2", "blue:draw2", "yellow:1"], ["green:1"], "red:2", { rules: { multiPlay: true } });
    g.step(play("red:draw2"));
    g.step(play("blue:draw2"));
    expect([g.hands[1].length, g.current]).toEqual([5, 0]);
  });
  it("stacking +2 on +2 passes the total back", () => {
    const g = setup(["red:draw2", "yellow:1"], ["blue:draw2", "green:1"], "red:2", { rules: house });
    g.step(play("red:draw2"));
    expect([g.phase, g.current, g.pendingDraw]).toEqual(["respond", 1, 2]);
    expect(g.legalActions()).toEqual([{ type: "accept" }, play("blue:draw2")]);
    g.step(play("blue:draw2"));
    // Player 0 has no draw card, so they draw 4 and player 1 goes again.
    expect([g.hands[0].length, g.current, g.pendingDraw]).toEqual([5, 1, 0]);
  });
  it("like on like only: no +4 on a +2, no +2 on a +4", () => {
    let g = setup(["red:draw2", "yellow:1"], ["wild4", "green:1"], "red:2", { rules: house });
    g.step(play("red:draw2"));
    // Player 1 only has a +4, which can't answer a +2: they draw 2 at once.
    expect([g.hands[1].length, g.current, g.pendingDraw]).toEqual([4, 0, 0]);

    g = setup(["wild4", "yellow:1"], ["blue:draw2", "green:1"], "red:2", { rules: { ...house, allowWd4Challenge: false } });
    g.step(play("wild4", "green"));
    expect([g.hands[1].length, g.current]).toEqual([6, 0]);
  });
  it("a challengeable +4 can be answered by challenge, accept or a stack", () => {
    const g = setup(["wild4", "red:1"], ["wild4", "green:1"], "red:5", { rules: house });
    g.step(play("wild4", "blue"));
    const keys = g.legalActions().map((a) => a.type + ("color" in a ? a.color : ""));
    expect(keys).toEqual(["challenge", "accept", "playred", "playyellow", "playgreen", "playblue"]);
    g.step({ type: "challenge" });
    // Player 0 held red, so the bluff is caught: they draw the 4.
    expect([g.hands[0].length, g.current]).toEqual([5, 1]);
  });
  it("going out on a +2 still makes the opponent draw", () => {
    const g = setup(["red:draw2"], ["blue:draw2", "green:1"], "red:5", { rules: { stackDraws: true }, draw: ["yellow:9", "yellow:8"] });
    g.step(play("red:draw2"));
    expect([g.winner, g.hands[1].length]).toEqual([0, 4]);
  });
  it("number finish: an action card can't be your last card", () => {
    for (const last of ["red:skip", "red:reverse", "red:draw2", "wild", "wild4"]) {
      const g = setup([last], ["green:1"], "red:5", { rules: house });
      expect(g.legalActions()).toEqual([{ type: "draw" }]);
    }
    const g = setup(["red:7"], ["green:1"], "red:5", { rules: house });
    g.step(play("red:7"));
    expect(g.winner).toBe(0);
  });
  it("number finish: can't empty the hand with a run of action cards", () => {
    // Two +2s: the first is fine, the second would be the last card.
    let g = setup(["red:draw2", "blue:draw2"], ["green:1"], "red:5", { rules: house });
    g.step(play("red:draw2"));
    expect(g.hands[0]).toEqual(["blue:draw2"]);
    expect(g.winner).toBe(null);
    // A Skip leaves a lone action card: on the extra turn the player must draw.
    g = setup(["red:skip", "red:reverse"], ["green:1"], "red:5", { rules: house });
    g.step(play("red:skip"));
    expect([g.current, g.legalActions()]).toEqual([0, [{ type: "draw" }]]);
  });
  it("number finish: you can't stack with your last card", () => {
    const g = setup(["red:draw2", "yellow:1"], ["blue:draw2"], "red:2", { rules: house });
    g.step(play("red:draw2"));
    expect([g.hands[1].length, g.current]).toEqual([3, 0]);
  });
  it("custom card: default +10 with a color choice", () => {
    expect(buildDeck(2).length).toBe(110);
    const g = setup(["custom", "yellow:1"], ["green:1"], "red:5", { rules: { customCards: 2 }, draw: Array(30).fill("yellow:9") });
    expect(g.legalActions().filter((a) => a.type === "play").length).toBe(4);
    g.step(play("custom", "blue"));
    expect([g.hands[1].length, g.current, g.color]).toEqual([11, 0, "blue"]);
    expect(points("custom")).toBe(50);
  });
  it("custom card: skip without a color choice keeps the color", () => {
    const g = setup(["custom", "yellow:1"], ["green:1"], "red:5", { rules: { customCards: 2, customColor: false, customSkip: true, customDraw: 0 } });
    expect(g.legalActions().filter((a) => a.type === "play")).toEqual([play("custom")]);
    g.step(play("custom"));
    expect([g.current, g.color, g.hands[1].length]).toEqual([0, "red", 1]);
  });
  it("custom cards stack only on custom cards", () => {
    const g = setup(["custom", "yellow:1"], ["custom", "green:draw2"], "red:5", { rules: { customCards: 2, stackDraws: true, customDraw: 5 }, draw: Array(30).fill("yellow:9") });
    g.step(play("custom", "blue"));
    expect([g.phase, g.pendingDraw]).toEqual(["respond", 5]);
    expect(new Set(g.legalActions().filter((a) => a.type === "play").map((a) => (a as { card: string }).card))).toEqual(new Set(["custom"]));
    g.step(play("custom", "green"));
    expect([g.hands[0].length, g.current]).toEqual([11, 1]);
  });
  it("bots finish with custom cards in both setups", () => {
    const setups = [{ ...house, customCards: 4 }, { customCards: 4, customColor: false, customSkip: true, customDraw: 3 }];
    for (const rules of setups) for (let s = 0; s < 100; s++) {
      const g = playGame([AGENTS.heuristic(), AGENTS.greedy()], s, s % 2, rules);
      expect(g.isOver).toBe(true);
      expect(all(g)).toEqual(buildDeck(4).sort());
    }
  });
  it("plus ends turn: after a + card the opponent plays next", () => {
    for (const [rule, next] of [[false, 0], [true, 1]] as const) {
      const g = setup(["red:draw2", "yellow:1"], ["green:1"], "red:2", { rules: { plusEndsTurn: rule } });
      g.step(play("red:draw2"));
      expect([g.hands[1].length, g.current]).toEqual([3, next]);
    }
    // After accepting a stacked penalty, the one who accepted plays next.
    const g = setup(["red:draw2", "yellow:1"], ["blue:draw2", "green:1"], "red:2", { rules: { stackDraws: true, plusEndsTurn: true } });
    g.step(play("red:draw2"));
    g.step(play("blue:draw2"));
    expect([g.hands[0].length, g.current]).toEqual([5, 0]);
    // A custom card set to "player goes again" still does.
    const c = setup(["custom", "yellow:1"], ["green:1"], "red:2", { rules: { customCards: 2, customSkip: true, customDraw: 3, plusEndsTurn: true } });
    c.step(play("custom", "blue"));
    expect([c.hands[1].length, c.current]).toEqual([4, 0]);
  });
  it("C House Rules: no Wild Draw Four challenges", () => {
    const g = setup(["wild4", "red:1", "yellow:2"], ["green:1"], "red:5", { rules: HOUSE_RULES });
    g.step(play("wild4", "blue"));
    // No challenge to offer and nothing to stack: player 1 draws 4 at once and plays next.
    expect([g.hands[1].length, g.current, g.stats.challenges]).toEqual([5, 1, [0, 0]]);
    const og = setup(["wild4", "red:1"], ["green:1"], "red:5");
    og.step(play("wild4", "blue"));
    expect(og.legalActions().map((x) => x.type)).toEqual(["challenge", "accept"]);
  });
  it("bots finish games and conserve cards under house rules", () => {
    for (let s = 0; s < 200; s++) {
      const g = playGame([AGENTS.heuristic(), AGENTS.random()], s, s % 2, house);
      expect(g.isOver).toBe(true);
      expect(all(g)).toEqual(buildDeck().sort());
    }
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
    // Python, C House Rules (--rules c-house): heuristic vs greedy ~49%, ~36 turns.
    const h = summarize(await runMatch({ p0: "heuristic", p1: "greedy", games: 3000, seed: 3, rules: HOUSE_RULES }));
    expect(Math.abs(h.winRate[0] - 0.49)).toBeLessThan(0.04);
    expect(h.turnsMean).toBeGreaterThan(32);
    expect(h.turnsMean).toBeLessThan(40);
  });
});
