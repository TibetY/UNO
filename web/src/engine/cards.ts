export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type Color = (typeof COLORS)[number];
export const RANKS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2", "wild", "wild4"] as const;
export type Rank = (typeof RANKS)[number];

/** Cards are plain strings: "red:5", "blue:skip", "wild", "wild4". */
export type CardId = string;

export interface CardParts {
  rank: Rank;
  color: Color | null;
}

export function parseCard(id: CardId): CardParts {
  const i = id.indexOf(":");
  if (i < 0) return { rank: id as Rank, color: null };
  return { color: id.slice(0, i) as Color, rank: id.slice(i + 1) as Rank };
}

export function makeCard(rank: Rank, color: Color | null): CardId {
  return color ? `${color}:${rank}` : rank;
}

export const isWild = (r: Rank) => r === "wild" || r === "wild4";
export const isNumber = (r: Rank) => r.length === 1;

export function points(id: CardId): number {
  const { rank } = parseCard(id);
  if (isNumber(rank)) return Number(rank);
  return isWild(rank) ? 50 : 20;
}

/** Can `card` be played on `top` when the active color is `color` (null = anything goes)? */
export function matches(card: CardId, top: CardId, color: Color | null): boolean {
  const c = parseCard(card);
  if (isWild(c.rank) || color === null) return true;
  return c.color === color || c.rank === parseCard(top).rank;
}

/** Standard 108-card deck. */
export function buildDeck(): CardId[] {
  const deck: CardId[] = [];
  for (const color of COLORS) {
    deck.push(makeCard("0", color));
    for (const rank of RANKS.slice(1, 13)) deck.push(makeCard(rank, color), makeCard(rank, color));
  }
  for (let i = 0; i < 4; i++) deck.push("wild", "wild4");
  return deck;
}

const RANK_NAMES: Partial<Record<Rank, string>> = { skip: "Skip", reverse: "Reverse", draw2: "Draw Two", wild: "Wild", wild4: "Wild Draw Four" };
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const rankName = (r: Rank) => RANK_NAMES[r] ?? r;

export function cardLabel(id: CardId): string {
  const { rank, color } = parseCard(id);
  return color ? `${cap(color)} ${rankName(rank)}` : rankName(rank);
}

export function sortHand(hand: readonly CardId[]): CardId[] {
  const co = (c: Color | null) => (c ? COLORS.indexOf(c) : 4);
  return [...hand].sort((a, b) => {
    const pa = parseCard(a), pb = parseCard(b);
    return co(pa.color) - co(pb.color) || RANKS.indexOf(pa.rank) - RANKS.indexOf(pb.rank);
  });
}
