/**
 * Two-player rules engine (same rules as the Python package).
 *
 * A state machine driven by `step(action)`. `legalActions()` lists what the
 * player to act may do; `observation(p)` is that player's imperfect view.
 *
 * Two-player specifics: Reverse acts like Skip, and Skip / Reverse / Draw Two /
 * Wild Draw Four all give the player who played them another turn.
 *
 * House rules (off by default):
 *  - multiPlay: after playing a card you may add more cards of the same rank
 *    (any color) in the same turn. Draw cards add up: two +2s = draw 4.
 *    (Skip/Reverse don't need it: they give another turn, where any matching
 *    card can follow.)
 *  - stackDraws: when hit by a +2 you may answer with a +2, and when hit by a
 *    +4 with a +4; the total passes to the other player.
 *  - numberFinish: you can only go out on a number card. An action card
 *    (Skip, Reverse, +2, wilds) can't be your last card.
 */
import { COLORS, type CardId, type Color, buildDeck, isNumber, isWild, matches, parseCard, points } from "./cards";
import { Rng } from "./rng";

/** turn: play or draw · drew: play the drawn card or keep it · multi: add more
 *  cards of the same rank or finish · respond: hit by a draw card, so accept,
 *  stack or challenge · over */
export type Phase = "turn" | "drew" | "multi" | "respond" | "over";

export type Action =
  | { type: "play"; card: CardId; color?: Color }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "done" }
  | { type: "challenge" }
  | { type: "accept" };

export interface Rules {
  handSize: number;
  playDrawnCard: boolean;
  drawUntilPlayable: boolean;
  wd4Restricted: boolean;
  allowWd4Challenge: boolean;
  multiPlay: boolean;
  stackDraws: boolean;
  numberFinish: boolean;
  maxTurns: number;
}

export const DEFAULT_RULES: Rules = {
  handSize: 7,
  playDrawnCard: true,
  drawUntilPlayable: false,
  wd4Restricted: false,
  allowWd4Challenge: true,
  multiPlay: false,
  stackDraws: false,
  numberFinish: false,
  maxTurns: 1000,
};

/** The house rules this app plays by default. */
export const HOUSE_RULES: Rules = { ...DEFAULT_RULES, multiPlay: true, stackDraws: true, numberFinish: true };

export interface GameEvent {
  t: number;
  event: "deal" | "start_card" | "play" | "draw" | "pass" | "challenge" | "accept" | "reshuffle" | "game_over";
  player: number | null;
  card?: CardId;
  color?: Color | null;
  count?: number;
  voluntary?: boolean;
  success?: boolean;
  reason?: string;
  size?: number;
}

export interface Observation {
  player: number;
  phase: Phase;
  hand: readonly CardId[];
  top: CardId;
  color: Color | null;
  opponentHandSize: number;
  drawPileSize: number;
  pending: CardId | null;
  /** Cards the player to act must draw unless they stack (phase "respond"). */
  pendingDraw: number;
  turn: number;
  history: readonly GameEvent[];
  rules: Rules;
}

export interface GameResult {
  seed: number;
  starter: number;
  winner: number | null;
  endReason: string | null;
  turns: number;
  points: number;
  finalHandSizes: number[];
  cardsDrawn: number[];
  cardsPlayed: number[];
  drawActions: number[];
  playedByRank: Record<string, number>[];
  challenges: number[];
  challengesWon: number[];
  wd4Illegal: number[];
  stacks: number[];
  extraCards: number[];
  reshuffles: number;
}

export const actionKey = (a: Action) =>
  a.type === "play" ? `play:${a.card}${a.color ? ">" + a.color : ""}` : a.type;

export function actionLabel(a: Action): string {
  if (a.type !== "play") return a.type;
  return a.color && isWild(parseCard(a.card).rank) ? `play ${a.card} → ${a.color}` : `play ${a.card}`;
}

export class IllegalAction extends Error {}

export class Game {
  readonly rules: Rules;
  readonly seed: number;
  /** Distinguishes two games dealt from the same seed (UI only; not part of the rules). */
  readonly uid = Math.random().toString(36).slice(2, 8);
  readonly starter: number;
  private rng: Rng;
  hands: CardId[][] = [[], []];
  drawPile: CardId[];
  discard: CardId[] = [];
  color: Color | null = null;
  current: number;
  phase: Phase = "turn";
  pending: CardId | null = null;
  turn = 0;
  winner: number | null = null;
  endReason: string | null = null;
  events: GameEvent[] = [];
  stats = {
    cardsDrawn: [0, 0],
    cardsPlayed: [0, 0],
    drawActions: [0, 0],
    playedByRank: [{}, {}] as Record<string, number>[],
    challenges: [0, 0],
    challengesWon: [0, 0],
    wd4Illegal: [0, 0],
    stacks: [0, 0],
    extraCards: [0, 0],
    reshuffles: 0,
  };
  /** Cards owed by the player to act (phase "respond"). */
  pendingDraw = 0;
  private offender: number | null = null;
  private canChallenge = false;
  private wd4WasIllegal = false;
  // The batch of same-rank cards being played this turn.
  private batchRank: string | null = null;
  private batchCount = 0;
  private batchIsResponse = false;
  private batchIllegalWd4 = false;

  constructor(opts: { seed: number; starter?: number; rules?: Partial<Rules> }) {
    this.seed = opts.seed;
    this.starter = opts.starter ?? 0;
    this.current = this.starter;
    this.rules = { ...DEFAULT_RULES, ...opts.rules };
    this.rng = new Rng(opts.seed);
    this.drawPile = this.rng.shuffle(buildDeck());
    this.deal();
  }

  // ---------------------------------------------------------------- setup
  private deal() {
    const s = this.starter;
    for (let i = 0; i < this.rules.handSize; i++) {
      for (const p of [s, 1 - s]) this.hands[p].push(this.drawPile.pop()!);
    }
    this.log("deal", null, {});
    let card: CardId;
    for (;;) {
      card = this.drawPile.pop()!;
      if (card !== "wild4") break;
      this.drawPile.push(card);
      this.rng.shuffle(this.drawPile);
    }
    this.discard.push(card);
    const c = parseCard(card);
    this.color = c.color;
    this.log("start_card", null, { card });
    if (c.rank === "skip" || c.rank === "reverse") this.current = 1 - s;
    else if (c.rank === "draw2") {
      this.drawN(s, 2);
      this.current = 1 - s;
    } else this.current = s;
    this.beginTurn();
  }

  // -------------------------------------------------------------- helpers
  get top(): CardId {
    return this.discard[this.discard.length - 1];
  }
  get isOver() {
    return this.phase === "over";
  }

  private log(event: GameEvent["event"], player: number | null, data: Partial<GameEvent>) {
    this.events.push({ t: this.turn, event, player, ...data });
  }

  private refill(): boolean {
    if (this.drawPile.length) return true;
    if (this.discard.length <= 1) return false;
    const top = this.discard.pop()!;
    this.drawPile = this.rng.shuffle(this.discard);
    this.discard = [top];
    this.stats.reshuffles++;
    this.log("reshuffle", null, { size: this.drawPile.length });
    return true;
  }

  private drawOne(p: number): CardId | null {
    if (!this.refill()) return null;
    const c = this.drawPile.pop()!;
    this.hands[p].push(c);
    this.stats.cardsDrawn[p]++;
    return c;
  }

  private drawN(p: number, n: number) {
    let count = 0;
    for (let i = 0; i < n && this.drawOne(p) !== null; i++) count++;
    this.log("draw", p, { count });
  }

  private beginTurn() {
    this.turn++;
    this.phase = "turn";
    this.pending = null;
    if (this.turn > this.rules.maxTurns) this.finish(null, "max_turns");
  }

  private endTurn(next: number) {
    this.current = next;
    this.beginTurn();
  }

  private finish(winner: number | null, reason: string) {
    this.phase = "over";
    this.winner = winner;
    this.endReason = reason;
    this.log("game_over", winner, { reason });
  }

  private hasColor(p: number) {
    return this.color !== null && this.hands[p].some((c) => parseCard(c).color === this.color);
  }

  playable(card: CardId, p = this.current): boolean {
    if (!matches(card, this.top, this.color)) return false;
    if (card === "wild4" && this.rules.wd4Restricted) return !this.hasColor(p);
    return true;
  }

  private playActions(card: CardId): Action[] {
    return isWild(parseCard(card).rank)
      ? COLORS.map((color) => ({ type: "play", card, color }) as Action)
      : [{ type: "play", card }];
  }

  /** With numberFinish, an action card can't be a player's last card. */
  private finishOk(p: number, card: CardId): boolean {
    return !this.rules.numberFinish || this.hands[p].length > 1 || isNumber(parseCard(card).rank);
  }

  // ------------------------------------------------------------ public API
  legalActions(): Action[] {
    const p = this.current;
    return this.allActions().filter((a) => a.type !== "play" || this.finishOk(p, a.card));
  }

  private allActions(): Action[] {
    if (this.phase === "over") return [];
    if (this.phase === "respond") {
      const out: Action[] = this.canChallenge ? [{ type: "challenge" }, { type: "accept" }] : [{ type: "accept" }];
      for (const card of this.stackable(this.current)) out.push(...this.playActions(card));
      return out;
    }
    if (this.phase === "multi") {
      const out: Action[] = [];
      for (const card of [...new Set(this.hands[this.current])].sort()) {
        if (parseCard(card).rank === this.batchRank) out.push(...this.playActions(card));
      }
      out.push({ type: "done" });
      return out;
    }
    if (this.phase === "drew") return [...this.playActions(this.pending!), { type: "pass" }];
    const out: Action[] = [];
    for (const card of [...new Set(this.hands[this.current])].sort()) {
      if (this.playable(card)) out.push(...this.playActions(card));
    }
    out.push({ type: "draw" });
    return out;
  }

  observation(p = this.current): Observation {
    return {
      player: p,
      phase: this.phase,
      hand: this.hands[p],
      top: this.top,
      color: this.color,
      opponentHandSize: this.hands[1 - p].length,
      drawPileSize: this.drawPile.length,
      pending: p === this.current ? this.pending : null,
      pendingDraw: p === this.current ? this.pendingDraw : 0,
      turn: this.turn,
      history: this.events,
      rules: this.rules,
    };
  }

  step(action: Action) {
    if (this.phase === "over") throw new IllegalAction("game is over");
    const key = actionKey(action);
    if (!this.legalActions().some((a) => actionKey(a) === key)) {
      throw new IllegalAction(`illegal action ${key} in phase ${this.phase}`);
    }
    const p = this.current;
    switch (action.type) {
      case "play":
        return this.play(p, action.card, action.color);
      case "draw":
        return this.doDraw(p);
      case "pass":
        this.log("pass", p, {});
        return this.endTurn(1 - p);
      case "done":
        return this.resolveBatch(p, false);
      case "accept":
      case "challenge":
        return this.resolveResponse(p, action.type === "challenge");
    }
  }

  /** Draw cards `p` may stack on the pending penalty. */
  private stackable(p: number): CardId[] {
    if (!this.rules.stackDraws) return [];
    // Like on like only: +2 on +2, +4 on +4.
    const topRank = parseCard(this.top).rank;
    return [...new Set(this.hands[p])].sort()
      .filter((c) => parseCard(c).rank === topRank && this.finishOk(p, c));
  }

  // ------------------------------------------------------------ mechanics
  private doDraw(p: number) {
    this.stats.drawActions[p]++;
    let last: CardId | null = null;
    let count = 0;
    for (;;) {
      const c = this.drawOne(p);
      if (c === null) break;
      last = c;
      count++;
      if (!this.rules.drawUntilPlayable || this.playable(c, p)) break;
    }
    this.log("draw", p, { count, voluntary: true });
    if (last !== null && this.rules.playDrawnCard && this.playable(last, p)) {
      this.phase = "drew";
      this.pending = last;
    } else this.endTurn(1 - p);
  }

  private play(p: number, card: CardId, chosen?: Color) {
    const { rank, color } = parseCard(card);
    if (this.phase !== "multi") {
      // First card of this turn's batch.
      this.batchIsResponse = this.phase === "respond";
      this.batchIllegalWd4 = rank === "wild4" && !this.batchIsResponse && this.hasColor(p);
      this.batchRank = rank;
      this.batchCount = 0;
      if (this.batchIsResponse) this.stats.stacks[p]++;
      if (this.batchIllegalWd4) this.stats.wd4Illegal[p]++;
    } else this.stats.extraCards[p]++;
    this.hands[p].splice(this.hands[p].indexOf(card), 1);
    this.discard.push(card);
    this.color = isWild(rank) ? chosen! : color;
    this.stats.cardsPlayed[p]++;
    const byRank = this.stats.playedByRank[p];
    byRank[rank] = (byRank[rank] ?? 0) + 1;
    this.batchCount++;
    this.log("play", p, { card, color: this.color });

    const won = this.hands[p].length === 0;
    // Skip/Reverse already give another turn (where any matching card, the same
    // rank included, can follow), so they never wait in the multi phase.
    const extraTurn = rank === "skip" || rank === "reverse";
    if (!won && !extraTurn && this.rules.multiPlay && this.hands[p].some((c) => parseCard(c).rank === rank)) {
      this.phase = "multi";
      this.pending = null;
      return;
    }
    this.resolveBatch(p, won);
  }

  /** Apply the effect of the cards played this turn. */
  private resolveBatch(p: number, won: boolean) {
    const rank = this.batchRank!;
    const n = this.batchCount;
    this.batchRank = null;
    const opp = 1 - p;
    if (rank === "draw2" || rank === "wild4") {
      this.pendingDraw += (rank === "draw2" ? 2 : 4) * n;
      this.offender = p;
      if (won) {
        this.drawN(opp, this.pendingDraw);
        this.pendingDraw = 0;
        return this.finish(p, "out_of_cards");
      }
      this.canChallenge = rank === "wild4" && this.rules.allowWd4Challenge && !this.batchIsResponse;
      this.wd4WasIllegal = this.batchIllegalWd4;
      if (this.canChallenge || this.stackable(opp).length) {
        this.current = opp;
        this.phase = "respond";
        this.pending = null;
        return;
      }
      this.drawN(opp, this.pendingDraw);
      this.pendingDraw = 0;
      return this.endTurn(p);
    }
    if (won) return this.finish(p, "out_of_cards");
    this.endTurn(rank === "skip" || rank === "reverse" ? p : opp);
  }

  private resolveResponse(victim: number, challenge: boolean) {
    const offender = this.offender!;
    const owed = this.pendingDraw;
    this.pendingDraw = 0;
    this.offender = null;
    if (!challenge) {
      this.log("accept", victim, {});
      this.drawN(victim, owed);
      return this.endTurn(offender);
    }
    this.stats.challenges[victim]++;
    const success = this.wd4WasIllegal;
    this.log("challenge", victim, { success });
    if (success) {
      this.stats.challengesWon[victim]++;
      this.drawN(offender, owed);
      this.endTurn(victim);
    } else {
      this.drawN(victim, owed + 2);
      this.endTurn(offender);
    }
  }

  // ------------------------------------------------------------- scoring
  score(): number {
    if (this.winner === null) return 0;
    return this.hands[1 - this.winner].reduce((s, c) => s + points(c), 0);
  }

  result(): GameResult {
    const s = this.stats;
    return {
      seed: this.seed,
      starter: this.starter,
      winner: this.winner,
      endReason: this.endReason,
      turns: this.turn,
      points: this.score(),
      finalHandSizes: this.hands.map((h) => h.length),
      cardsDrawn: [...s.cardsDrawn],
      cardsPlayed: [...s.cardsPlayed],
      drawActions: [...s.drawActions],
      playedByRank: s.playedByRank.map((d) => ({ ...d })),
      challenges: [...s.challenges],
      challengesWon: [...s.challengesWon],
      wd4Illegal: [...s.wd4Illegal],
      stacks: [...s.stacks],
      extraCards: [...s.extraCards],
      reshuffles: s.reshuffles,
    };
  }
}
