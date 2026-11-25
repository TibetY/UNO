import { type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLORS, type CardId, type Color, cap, cardLabel, isWild, matches, parseCard, rankName, sortHand } from "../engine/cards";
import type { Action, GameEvent } from "../engine/engine";
import type { TableView } from "../view";
import { Card, CardBack, CustomCardContext } from "./Card";
import {
  DEAL_STAGGER, EASE, FLIGHT_MS, MotionContext, PLAY_MS, PLAY_STAGGER, SHIFT_MS, dealAnimationMs, drawStagger,
  type TableMotion, flyFrom, reducedMotion,
} from "../anim";

interface Props {
  view: TableView;
  /** Called with one or more moves to make in order (e.g. several cards played at once). */
  onActions?: (actions: Action[]) => void;
  /** Blocks input (e.g. waiting for the server to confirm a move). */
  busy?: boolean;
  /** Overrides the status line. */
  status?: string;
  /** Extra chips beside each seat name, e.g. match score. */
  seatExtra?: [ReactNode, ReactNode];
  /** Buttons in the game-over dialog. */
  gameOverActions?: ReactNode;
  /** Hide the game-over dialog (e.g. spectators). */
  hideGameOver?: boolean;
  /** Show both hands face down (pass-and-play, while the device changes hands). */
  hideHands?: boolean;
}

export function playerName(v: TableView, p: number) {
  return v.you === p && !v.sharedDevice ? "You" : v.names[p];
}

interface Keyed {
  key: string;
  card: CardId;
}

/** Stable keys for a sorted hand, so duplicates keep their identity. */
function keyCards(sorted: readonly CardId[]): Keyed[] {
  const seen = new Map<CardId, number>();
  return sorted.map((card) => {
    const n = (seen.get(card) ?? 0) + 1;
    seen.set(card, n);
    return { key: `${card}#${n}`, card };
  });
}

/** Can `next` be played right after `prev` in the same go? */
function canFollow(prev: CardId, next: CardId, multiPlay: boolean): boolean {
  const p = parseCard(prev);
  // Skip/Reverse give another turn: any card matching it can follow.
  if (p.rank === "skip" || p.rank === "reverse") return matches(next, prev, p.color);
  return multiPlay && parseCard(next).rank === p.rank;
}

export function Table({ view: v0, onActions, busy, status, seatExtra, gameOverActions, hideGameOver, hideHands }: Props) {
  const v = hideHands ? { ...v0, hands: [null, null], legal: [] } : v0;
  const [selected, setSelected] = useState<Keyed[]>([]);
  const [wildChain, setWildChain] = useState<CardId[] | null>(null);
  const deck = useRef<HTMLButtonElement>(null);
  const departures = useRef<TableMotion["departures"]["current"]>([]);
  const motion = useMemo<TableMotion>(() => ({ deck, departures }), []);

  const top = 1 - v.bottom;
  const yourTurn = v.legal.length > 0 && !busy;
  const send = (actions: Action[]) => {
    if (!busy && actions.length) onActions?.(actions);
  };
  const legalByCard = useMemo(() => {
    const m = new Map<CardId, Action[]>();
    for (const a of v.legal) if (a.type === "play") m.set(a.card, [...(m.get(a.card) ?? []), a]);
    return m;
  }, [v.legal]);
  const find = (type: Action["type"]) => v.legal.find((a) => a.type === type);

  useEffect(() => {
    setSelected([]);
    setWildChain(null);
  }, [v.turn, v.phase, v.gameId]);

  const myHand = useMemo(() => keyCards(sortHand(v.hands[v.bottom] ?? [])), [v.hands, v.bottom]);
  const last = selected[selected.length - 1];
  const isSelected = (k: string) => selected.some((s) => s.key === k);
  /** With numberFinish, an action card can't be the card that empties your hand. */
  const finishOk = (card: CardId, cardsLeftAfter: number) =>
    !v.rules.numberFinish || cardsLeftAfter > 0 || /^\d$/.test(parseCard(card).rank);
  const followable = (k: Keyed) =>
    !!last && !isSelected(k.key) && canFollow(last.card, k.card, v.rules.multiPlay) &&
    finishOk(k.card, myHand.length - selected.length - 1);

  /** Does playing this card ask for a color? */
  const picksColor = (c: CardId) => {
    const r = parseCard(c).rank;
    return isWild(r) || (r === "custom" && v.rules.customColor);
  };
  const playChain = (cards: CardId[]) => {
    if (cards.some(picksColor)) return setWildChain(cards);
    send(cards.map((card) => ({ type: "play", card })));
    setSelected([]);
  };
  const chooseColor = (color: Color) => {
    const chain = wildChain ?? [];
    setWildChain(null);
    setSelected([]);
    send(chain.map((card) => (picksColor(card) ? { type: "play", card, color } : { type: "play", card })));
  };

  const tapCard = (k: Keyed) => {
    if (!yourTurn) return;
    const i = selected.findIndex((s) => s.key === k.key);
    if (i >= 0) return setSelected(selected.slice(0, i)); // tap a picked card to take it (and later ones) back
    if (selected.length && followable(k)) return setSelected([...selected, k]);
    if (!legalByCard.has(k.card)) return;
    // Picking several cards starts only when another card of the same number or
    // symbol could go with it. A lone Skip/Reverse plays at once: it's your turn
    // again straight after, so you just tap the next card.
    const rank = parseCard(k.card).rank;
    const extraTurn = rank === "skip" || rank === "reverse";
    const color = parseCard(k.card).color;
    // Partners: the same number or symbol; with C House multi-play, a Skip and a
    // Reverse of the same color also go together.
    const isPartner = (o: Keyed) => {
      const p = parseCard(o.card);
      if (p.rank === rank) return true;
      return v.rules.multiPlay && extraTurn && (p.rank === "skip" || p.rank === "reverse") && p.color === color;
    };
    const hasPartner = (v.rules.multiPlay || extraTurn) &&
      myHand.some((o) => o.key !== k.key && isPartner(o) && finishOk(o.card, myHand.length - 2));
    if (hasPartner && v.phase !== "multi") setSelected([k]);
    else playChain([k.card]);
  };

  const over = v.endReason !== null;
  // Let the winning card(s) land, and any penalty cards be dealt, before the
  // game-over box covers the table.
  const [showOver, setShowOver] = useState(false);
  useEffect(() => {
    if (!over) return setShowOver(false);
    if (reducedMotion()) return setShowOver(true);
    const t = window.setTimeout(() => setShowOver(true), dealAnimationMs(finalMove(v).events, 7) + 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over, v.gameId]);
  const draw = find("draw");
  const pass = find("pass");
  const done = find("done");
  const accept = find("accept");
  const challenge = find("challenge");
  const opp = v.you === null ? "" : v.names[1 - v.you];
  const picking = selected.length > 0;

  let statusText = status;
  if (statusText === undefined) {
    if (over) statusText = "";
    else if (yourTurn && picking) {
      statusText = selected.length === 1
        ? `Tap more cards to play them too, in order. Then press Play.`
        : `${selected.length} cards picked. Tap more, or press Play.`;
    } else if (yourTurn) {
      if (v.phase === "drew") statusText = `You drew ${aOrAn(cardLabel(v.pending!))}. Play it or keep it.`;
      else if (v.phase === "respond") statusText = respondText(v, opp, legalByCard.size > 0, !!challenge);
      else if (v.phase === "multi") statusText = `Play another ${rankName(parseCard(v.top).rank)}, or end your turn.`;
      else if (!legalByCard.size && v.rules.numberFinish && myHand.length === 1 && !/^\d$/.test(parseCard(myHand[0].card).rank))
        statusText = "You can only go out on a number card. Draw a card.";
      else if (goesAgain(v)) statusText = legalByCard.size ? "You go again. Pick a card, or draw." : "You go again, but nothing matches. Draw a card.";
      else statusText = legalByCard.size ? "Your turn. Pick a card, or draw." : "No playable cards. Draw from the deck.";
    } else statusText = `${playerName(v, v.current)} ${v.you === null ? "to move" : "is thinking…"}`;
  }

  return (
    <MotionContext.Provider value={motion}>
     <CustomCardContext.Provider value={v.rules}>
      <div className="table">
        <Seat v={v} seat={top} position="top" extra={seatExtra?.[top]} />

        <div className="center">
          <div className="pile-wrap">
            <button
              ref={deck}
              className={"deck" + (draw && !busy && !picking ? " can-draw" : "")}
              disabled={!draw || busy || picking}
              onClick={() => draw && send([draw])}
              aria-label={draw ? "Draw a card" : "Draw pile"}
            >
              <CardBack />
            </button>
            <span className="pile-label">{v.drawPile} in deck</span>
          </div>
          <div className="pile-wrap">
            <DiscardPile v={v} />
            <span className="pile-label">
              {v.color ? `${cap(v.color)} to play` : "Any color"}
              {v.pendingDraw > 0 && <span className="owed" title="Cards owed by the player to act"> · +{v.pendingDraw}</span>}
            </span>
          </div>
        </div>

        <div className="status" aria-live="polite">{statusText}</div>
        <div className="actionbar">
          {picking ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => playChain(selected.map((s) => s.card))}>
                Play {selected.length === 1 ? "card" : `${selected.length} cards`}
              </button>
              <button className="btn" onClick={() => setSelected([])}>Cancel</button>
            </>
          ) : (
            <>
              {pass && <button className="btn" disabled={busy} onClick={() => send([pass])}>Keep it · end turn</button>}
              {done && <button className="btn primary" disabled={busy} onClick={() => send([done])}>End turn</button>}
              {challenge && <button className="btn" disabled={busy} onClick={() => send([challenge])}>Challenge</button>}
              {accept && <button className="btn primary" disabled={busy} onClick={() => send([accept])}>Draw {v.pendingDraw}</button>}
              {draw && <button className="btn" disabled={busy} onClick={() => send([draw])}>Draw a card</button>}
            </>
          )}
        </div>

        <Seat v={v} seat={v.bottom} position="bottom" extra={seatExtra?.[v.bottom]}
          cardState={yourTurn ? (k) => {
            const order = selected.findIndex((s) => s.key === k.key);
            if (order >= 0) return { selected: true, order: order + 1 };
            if (picking) return followable(k) ? { playable: true } : { dim: true };
            return legalByCard.has(k.card) ? { playable: true } : { dim: true };
          } : undefined}
          onTap={tapCard} />

        {wildChain && (
          <div className="overlay" onClick={() => setWildChain(null)}>
            <div className="dialog" role="dialog" aria-label="Choose a color" onClick={(e) => e.stopPropagation()}>
              <h2>Choose a color</h2>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button key={c} className={`swatch c-${c}`} aria-label={cap(c)} onClick={() => chooseColor(c)} />
                ))}
              </div>
              <button className="btn ghost" onClick={() => setWildChain(null)}>Cancel</button>
            </div>
          </div>
        )}

        {over && !hideGameOver && showOver && <GameOver v={v} actions={gameOverActions} />}
      </div>
     </CustomCardContext.Provider>
    </MotionContext.Provider>
  );
}

function aOrAn(label: string) {
  return (/^[AEIOU]/.test(label) ? "an " : "a ") + label;
}

/** The player to act just played a Skip or Reverse, so this is their extra turn. */
function goesAgain(v: TableView): boolean {
  for (let i = v.events.length - 1; i >= 0; i--) {
    const e = v.events[i];
    if (e.event === "play") return e.player === v.current && /:(skip|reverse)$/.test(e.card ?? "");
    if (e.event !== "game_over") return false;
  }
  return false;
}

function respondText(v: TableView, opp: string, canStack: boolean, canChallenge: boolean): string {
  const n = v.pendingDraw;
  const topRank = parseCard(v.top).rank;
  const card = topRank === "wild4" ? "Wild Draw Four" : topRank === "custom" ? "custom card" : "Draw Two";
  if (canStack) {
    return `${opp} hit you with +${n}. Stack a draw card to pass it on, or draw ${n}.` +
      (canChallenge ? ` You can also challenge (if you're wrong you draw ${n + 2}).` : "");
  }
  const prev = prevColor(v.events);
  return `${opp} played a ${card}. Think they still had a ${prev ?? "matching"} card? Challenge it, or draw ${n}. If you're wrong you draw ${n + 2}.`;
}

function prevColor(events: GameEvent[]): string | null {
  for (let i = events.length - 2; i >= 0; i--) {
    const e = events[i];
    if (e.event === "play" && e.color) return e.color;
    if (e.event === "start_card" && e.card) return parseCard(e.card).color;
  }
  return null;
}

interface CardState {
  playable?: boolean;
  dim?: boolean;
  selected?: boolean;
  order?: number;
}

function Seat({ v, seat, position, extra, cardState, onTap }: {
  v: TableView; seat: number; position: "top" | "bottom"; extra?: ReactNode;
  cardState?: (k: Keyed) => CardState; onTap?: (k: Keyed) => void;
}) {
  const active = v.endReason === null && v.current === seat;
  const info = (
    <div className="seat-info">
      <span className="seat-dot" />
      <span className="seat-name">{playerName(v, seat)}</span>
      <span className="seat-count" aria-label={`${v.handSizes[seat]} cards`}>{v.handSizes[seat]}</span>
      {extra}
    </div>
  );
  return (
    <div className={`seat seat-${position}${active ? " active" : ""}`}>
      {position === "top" && info}
      <Hand v={v} seat={seat} small={position === "top"} cardState={cardState} onTap={onTap} />
      {position === "bottom" && info}
    </div>
  );
}

/**
 * A hand of cards. Each card sits in a "slot" the motion code moves: when the
 * layout changes, slots glide from where they were to where they now are, new
 * cards fly in from the deck one after another, and cards that leave are noted
 * so the discard pile can fly them in from here.
 */
function Hand({ v, seat, small, cardState, onTap }: {
  v: TableView; seat: number; small: boolean;
  cardState?: (k: Keyed) => CardState; onTap?: (k: Keyed) => void;
}) {
  const motion = useContext(MotionContext)!;
  const ref = useRef<HTMLDivElement>(null);
  const hand = v.hands[seat];
  const n = v.handSizes[seat];
  const handKey = hand ? sortHand(hand).join(",") : `#${n}`;
  const items = useMemo<Keyed[]>(
    () => (hand ? keyCards(sortHand(hand)) : Array.from({ length: n }, (_, i) => ({ key: `back#${i}`, card: "" }))),
    [handKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Overlap so the hand always fits on one row. Measured on resize only, so a
  // card arriving doesn't cause a second layout pass.
  const [box, setBox] = useState({ width: 0, card: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const cw = parseFloat(getComputedStyle(el).getPropertyValue("--cw")) * (small ? 0.78 : 1);
      setBox((b) => (b.width === el.clientWidth && b.card === cw ? b : { width: el.clientWidth, card: cw }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [small]);
  // Fit the hand: overlap the cards, and once they'd overlap too much to read
  // (big hands on phones), stack them into 2 or 3 rows instead.
  const avail = box.width - 24;
  const overlapFor = (perRow: number) =>
    box.card && perRow > 1 && perRow * box.card + (perRow - 1) * 6 > avail
      ? Math.max((avail - box.card) / (perRow - 1) - box.card, -box.card * 0.84)
      : 6;
  const readable = (perRow: number) => box.card + overlapFor(perRow) >= box.card * 0.42;
  let rows = 1;
  if (!small && hand) while (rows < 3 && !readable(Math.ceil(n / rows))) rows++;
  const perRow = Math.ceil(n / rows) || 1;
  const overlap = overlapFor(perRow);

  const slots = useRef(new Map<string, HTMLDivElement>());
  const prev = useRef<{ game: string; seat: number; faceUp: boolean; pos: Map<string, { x: number; y: number }>; rects: Map<string, DOMRect>; cards: Map<string, CardId> } | null>(null);

  useLayoutEffect(() => {
    const host = ref.current!;
    const reduce = reducedMotion();
    const before = prev.current;
    const newGame = !before || before.game !== v.gameId;
    // A different player's hand now sits here (pass-and-play): just place it.
    const swapped = !!before && !newGame && (before.seat !== seat || before.faceUp !== !!hand);
    const hostRect = host.getBoundingClientRect();
    const pos = new Map<string, { x: number; y: number }>();
    const rects = new Map<string, DOMRect>();
    const cards = new Map<string, CardId>();

    // Cards that left this hand: remember where they were for the pile.
    if (before && !newGame && !swapped) {
      for (const [k, r] of before.rects) {
        if (!slots.current.has(k)) motion.departures.current.push({ seat, card: before.cards.get(k) || null, rect: r, at: performance.now() });
      }
      motion.departures.current = motion.departures.current.filter((d) => performance.now() - d.at < 3000);
    }

    const deckRect = motion.deck.current?.getBoundingClientRect();
    let arriving = 0;
    const newCards = newGame ? 0 : items.filter((it) => !before!.pos.has(it.key)).length;
    const gap = drawStagger(newCards);
    items.forEach((it, i) => {
      const el = slots.current.get(it.key);
      if (!el) return;
      // Layout position, unaffected by any transform in flight.
      const p = { x: el.offsetLeft, y: el.offsetTop };
      pos.set(it.key, p);
      cards.set(it.key, it.card);
      rects.set(it.key, new DOMRect(hostRect.left + p.x, hostRect.top + p.y, el.offsetWidth, el.offsetHeight));
      if (reduce || swapped) return;
      const old = newGame ? undefined : before!.pos.get(it.key);
      if (old) {
        if (Math.abs(old.x - p.x) < 0.5 && Math.abs(old.y - p.y) < 0.5) return;
        // Moved: glide from where it is on screen right now.
        const visual = el.getBoundingClientRect();
        el.getAnimations().forEach((a) => a.cancel());
        const dx = visual.left - (hostRect.left + p.x);
        const dy = visual.top - (hostRect.top + p.y);
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${visual.width / el.offsetWidth || 1})` }, { transform: "none" }],
          { duration: SHIFT_MS, easing: EASE },
        );
      } else if (deckRect) {
        // New card: fly in from the deck.
        const delay = newGame ? i * DEAL_STAGGER + (small ? DEAL_STAGGER / 2 : 0) : arriving++ * gap;
        el.getAnimations().forEach((a) => a.cancel());
        flyFrom(el, deckRect, { duration: FLIGHT_MS, delay, rotate: small ? 8 : -10 });
      }
    });
    prev.current = { game: v.gameId, seat, faceUp: !!hand, pos, rects, cards };
  });

  const style = { "--overlap": `${overlap}px` } as React.CSSProperties;
  let pendingMarked = false;
  return (
    <div ref={ref} className={`hand ${small ? "hand-small" : "hand-main"}${rows > 1 ? " rows" : ""}`} style={style}>
      {items.flatMap((it, i) => {
        const rowStart = rows > 1 && i % perRow === 0;
        const lower = rows > 1 && i >= perRow;
        const slotClass = "slot" + (rowStart ? " row-start" : "") + (lower ? " row-lower" : "");
        // Line breaks between rows keep every card in one container, so a card
        // moving to another row glides there instead of being rebuilt.
        const brk = rowStart && i > 0 ? [<div className="row-break" key={`row-${i / perRow}`} aria-hidden="true" />] : [];
        const setRef = (el: HTMLDivElement | null) => {
          if (el) slots.current.set(it.key, el);
          else slots.current.delete(it.key);
        };
        if (!hand) return [...brk, <div className={slotClass} key={it.key} ref={setRef}><CardBack /></div>];
        const st = cardState?.(it) ?? {};
        const isPending = !pendingMarked && v.phase === "drew" && v.current === seat && it.card === v.pending;
        if (isPending) pendingMarked = true;
        return [...brk, (
          <div className={slotClass} key={it.key} ref={setRef}>
            <Card id={it.card} highlight={isPending} playable={st.playable} dim={st.dim} selected={st.selected} order={st.order}
              onClick={st.playable || st.selected ? () => onTap?.(it) : undefined} />
          </div>
        )];
      })}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** The discard pile: the last few cards, fanned. New cards fly in from the hand that played them. */
function DiscardPile({ v }: { v: TableView }) {
  const motion = useContext(MotionContext)!;
  // Keys use each event's absolute number, so a sliding window of events
  // (online guests get only the latest few) doesn't look like new cards.
  const played = v.events
    .map((e, i) => ({ e, i: (v.eventBase ?? 0) + i }))
    .filter(({ e }) => (e.event === "play" || e.event === "start_card") && e.card);
  if (!played.length || played[played.length - 1].e.card !== v.top) {
    played.push({ e: { t: v.turn, event: "play", player: null, card: v.top }, i: -1 });
  }
  const shown = played.slice(-4);
  const els = useRef(new Map<string, HTMLDivElement>());
  const seen = useRef<{ game: string; keys: Set<string> } | null>(null);

  useLayoutEffect(() => {
    const before = seen.current;
    const newGame = !before || before.game !== v.gameId;
    const fresh = shown.filter(({ e, i }) => !before?.keys.has(`${i}:${e.card}`) && !newGame);
    seen.current = { game: v.gameId, keys: new Set(shown.map(({ e, i }) => `${i}:${e.card}`)) };
    if (reducedMotion()) return;
    if (newGame) {
      // The starting card flips over from the deck.
      const { e, i } = shown[shown.length - 1];
      const el = els.current.get(`${i}:${e.card}`);
      const deck = motion.deck.current?.getBoundingClientRect();
      if (el && deck) flyFrom(el, deck, { duration: PLAY_MS, rotate: -rotation(e, i) });
      return;
    }
    if (!fresh.length) return;
    // Hide the new cards at once; fly them in once every hand has noted its departures.
    for (const { e, i } of fresh) els.current.get(`${i}:${e.card}`)?.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1 });
    queueMicrotask(() => {
      fresh.forEach(({ e, i }, n) => {
        const el = els.current.get(`${i}:${e.card}`);
        if (!el) return;
        const deps = motion.departures.current;
        const j = deps.findIndex((d) => d.seat === e.player && (d.card === e.card || d.card === null));
        const from = j >= 0 ? deps.splice(j, 1)[0].rect : motion.deck.current?.getBoundingClientRect();
        if (!from) return;
        el.getAnimations().forEach((a) => a.cancel());
        flyFrom(el, from, { duration: PLAY_MS, delay: n * PLAY_STAGGER, rotate: -rotation(e, i) });
      });
    });
  });

  return (
    <div className="discard" style={{ "--ring": v.color ? `var(--${v.color})` : "var(--ring-any)" } as React.CSSProperties}>
      {shown.map(({ e, i }, n) => {
        const isTop = n === shown.length - 1;
        const key = `${i}:${e.card}`;
        return (
          <div className="pile-slot" key={key} ref={(el) => { if (el) els.current.set(key, el); else els.current.delete(key); }}>
            <Card id={e.card!}
              chosen={isTop && parseCard(e.card!).color === null ? v.color : null}
              style={{ transform: `rotate(${rotation(e, i)}deg)` }} />
          </div>
        );
      })}
    </div>
  );
}

function rotation(e: GameEvent, i: number) {
  return (hash(`${e.t}${e.card}${i}`) % 25) - 12;
}

/** The winner's last move: the cards they went out with, and any penalty that followed. */
function finalMove(v: TableView): { cards: CardId[]; events: GameEvent[] } {
  const cards: CardId[] = [];
  let start = v.events.length;
  for (let i = v.events.length - 1; i >= 0; i--) {
    const e = v.events[i];
    if (e.event === "game_over" || (e.event === "draw" && !e.voluntary && cards.length === 0)) { start = i; continue; }
    if (e.event === "play" && e.player === v.winner && e.card) { cards.unshift(e.card); start = i; continue; }
    break;
  }
  return { cards, events: v.events.slice(start) };
}

function GameOver({ v, actions }: { v: TableView; actions?: ReactNode }) {
  const loser = v.winner === null ? null : 1 - v.winner;
  const finale = v.winner === null ? [] : finalMove(v).cards;
  let title = "Draw";
  if (v.winner !== null) title = v.you === v.winner ? "You win!" : `${playerName(v, v.winner)} wins`;
  const loserHand = loser !== null ? v.hands[loser] : null;
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p>
          {v.winner === null
            ? `The turn limit was reached after ${v.turn} turns.`
            : <>+{v.points} points from the cards left in {loser === v.you ? "your" : `${v.names[loser!]}'s`} hand · {v.turn} turns<br />
                <small>Cards drawn: {playerName(v, 0)} {v.drawn[0]} · {playerName(v, 1)} {v.drawn[1]}</small></>}
        </p>
        {finale.length > 0 && (
          <div className="finale">
            <span className="finale-label">{v.you === v.winner && !v.sharedDevice ? "You went out with" : `${playerName(v, v.winner!)} went out with`}</span>
            <div className="reveal">{finale.map((c, i) => <Card key={i} id={c} chosen={parseCard(c).color === null && i === finale.length - 1 ? v.color : null} />)}</div>
          </div>
        )}
        {loserHand && loserHand.length > 0 && (
          <div className="finale">
            <span className="finale-label">{loser === v.you && !v.sharedDevice ? "Left in your hand" : `Left in ${playerName(v, loser!)}'s hand`}</span>
            <div className="reveal">{sortHand(loserHand).map((c, i) => <Card key={i} id={c} />)}</div>
          </div>
        )}
        <div className="row">{actions}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ log

export function describeEvent(e: GameEvent, v: TableView): string | null {
  const who = e.player === null ? "" : playerName(v, e.player);
  switch (e.event) {
    case "start_card": return `Starting card: ${cardLabel(e.card!)}`;
    case "play": {
      const r = parseCard(e.card!).rank;
      const chose = isWild(r) || (r === "custom" && v.rules.customColor);
      return `${who} played ${r === "custom" ? `a custom card` : cardLabel(e.card!)}${chose ? ` → ${e.color}` : ""}`;
    }
    case "draw": return `${who} drew ${e.count} card${e.count === 1 ? "" : "s"}`;
    case "pass": return `${who} kept the card`;
    case "challenge": return `${who} challenged: ${e.success ? "caught a bluff!" : "it was legal"}`;
    case "accept": return `${who} accepted the penalty`;
    case "reshuffle": return `Discard pile reshuffled into the deck`;
    case "game_over": return e.player === null ? "Game drawn at the turn limit" : `${who} won`;
    default: return null;
  }
}

export function GameLog({ v }: { v: TableView }) {
  const items = v.events
    .map((e, i) => ({ e, i, text: describeEvent(e, v) }))
    .filter((x) => x.text)
    .reverse();
  return (
    <ol className="log">
      {items.map(({ e, i, text }) => {
        const color = e.event === "play" ? e.color : e.card ? parseCard(e.card).color : null;
        return (
          <li key={i}>
            <span className={"pip" + (e.card ? "" : " none")} style={{ background: color ? `var(--${color})` : undefined }} />
            <span>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}
