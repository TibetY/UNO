import type { CardId, Color } from "./engine/cards";
import { type Action, type Game, type GameEvent, type Phase, actionKey } from "./engine/engine";

/** Everything the table needs to draw one seat's view of a game. */
export interface TableView {
  /** Changes whenever a new game is dealt. */
  gameId: string;
  rules: { multiPlay: boolean; stackDraws: boolean; numberFinish: boolean };
  /** Seat the viewer controls, or null when only watching. */
  you: number | null;
  /** Seat drawn at the bottom of the table. */
  bottom: number;
  names: [string, string];
  /** A hand is null when it's hidden from this viewer. */
  hands: (CardId[] | null)[];
  handSizes: number[];
  top: CardId;
  color: Color | null;
  drawPile: number;
  phase: Phase;
  current: number;
  pending: CardId | null;
  /** Cards owed by the player to act (phase "respond"). */
  pendingDraw: number;
  legal: Action[];
  winner: number | null;
  endReason: string | null;
  points: number;
  turn: number;
  drawn: number[];
  events: GameEvent[];
}

export function viewFromGame(
  g: Game,
  o: { you: number | null; names: [string, string]; showAll?: boolean; eventLimit?: number },
): TableView {
  const reveal = o.showAll || g.isOver;
  const yourTurn = o.you !== null && !g.isOver && g.current === o.you;
  return {
    gameId: `${g.seed}:${g.uid}`,
    rules: { multiPlay: g.rules.multiPlay, stackDraws: g.rules.stackDraws, numberFinish: g.rules.numberFinish },
    you: o.you,
    bottom: o.you ?? 0,
    names: o.names,
    hands: g.hands.map((h, p) => (reveal || p === o.you ? [...h] : null)),
    handSizes: g.hands.map((h) => h.length),
    top: g.top,
    color: g.color,
    drawPile: g.drawPile.length,
    phase: g.phase,
    current: g.current,
    pending: yourTurn || reveal ? g.pending : null,
    pendingDraw: g.pendingDraw,
    legal: yourTurn ? g.legalActions() : [],
    winner: g.winner,
    endReason: g.endReason,
    points: g.score(),
    turn: g.turn,
    drawn: [...g.stats.cardsDrawn],
    events: o.eventLimit ? g.events.slice(-o.eventLimit) : [...g.events],
  };
}

// ---- compact wire format for online play (fits in a 4 KiB presence object) ----

export interface WireView extends Omit<TableView, "legal"> {
  legal: string[];
}

export function decodeAction(key: string): Action {
  if (!key.startsWith("play:")) return { type: key as "draw" | "pass" | "done" | "challenge" | "accept" };
  const [card, color] = key.slice(5).split(">");
  return color ? { type: "play", card, color: color as Color } : { type: "play", card };
}

export const encodeView = (v: TableView): WireView => ({ ...v, legal: v.legal.map(actionKey) });
export const decodeView = (w: WireView): TableView => ({ ...w, legal: w.legal.map(decodeAction) });
