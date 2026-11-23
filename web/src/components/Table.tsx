import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLORS, type CardId, type Color, cap, cardLabel, isWild, parseCard, sortHand } from "../engine/cards";
import type { Action, GameEvent } from "../engine/engine";
import type { TableView } from "../view";
import { Card, CardBack } from "./Card";

interface Props {
  view: TableView;
  onAction?: (a: Action) => void;
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
}

export function playerName(v: TableView, p: number) {
  return v.you === p ? "You" : v.names[p];
}

export function Table({ view: v, onAction, busy, status, seatExtra, gameOverActions, hideGameOver }: Props) {
  const [wildFor, setWildFor] = useState<CardId | null>(null);
  const top = 1 - v.bottom;
  const yourTurn = v.legal.length > 0 && !busy;
  const act = (a: Action) => {
    if (!busy) onAction?.(a);
  };
  const legalByCard = useMemo(() => {
    const m = new Map<CardId, Action[]>();
    for (const a of v.legal) if (a.type === "play") m.set(a.card, [...(m.get(a.card) ?? []), a]);
    return m;
  }, [v.legal]);
  const find = (type: Action["type"]) => v.legal.find((a) => a.type === type);

  useEffect(() => setWildFor(null), [v.turn, v.phase]);

  const playCard = (card: CardId) => {
    const options = legalByCard.get(card);
    if (!options) return;
    if (isWild(parseCard(card).rank)) setWildFor(card);
    else act(options[0]);
  };
  const chooseColor = (color: Color) => {
    const a = v.legal.find((x) => x.type === "play" && x.card === wildFor && x.color === color);
    setWildFor(null);
    if (a) act(a);
  };

  const over = v.endReason !== null;
  const draw = find("draw");
  const pass = find("pass");
  const challenge = yourTurn && v.phase === "challenge";

  let statusText = status;
  if (statusText === undefined) {
    if (over) statusText = "";
    else if (yourTurn) {
      if (v.phase === "drew") statusText = `You drew ${aOrAn(cardLabel(v.pending!))}. Play it or keep it.`;
      else if (v.phase === "challenge") statusText = `${v.names[1 - v.you!]} played a Wild Draw Four.`;
      else statusText = legalByCard.size ? "Your turn. Pick a card, or draw." : "No playable cards. Draw from the deck.";
    } else statusText = `${playerName(v, v.current)} ${v.you === null ? "to move" : "is thinking…"}`;
  }

  return (
    <div className="table">
      <Seat v={v} seat={top} position="top" extra={seatExtra?.[top]} />

      <div className="center">
        <div className="pile-wrap">
          <button
            className={"deck" + (draw && !busy ? " can-draw" : "")}
            disabled={!draw || busy}
            onClick={() => draw && act(draw)}
            aria-label={draw ? "Draw a card" : "Draw pile"}
          >
            <CardBack />
          </button>
          <span className="pile-label">{v.drawPile} in deck</span>
        </div>
        <div className="pile-wrap">
          <DiscardPile v={v} />
          <span className="pile-label">{v.color ? `${cap(v.color)} to play` : "Any color"}</span>
        </div>
      </div>

      <div className="status" aria-live="polite">{statusText}</div>
      <div className="actionbar">
        {pass && <button className="btn" disabled={busy} onClick={() => act(pass)}>Keep it · end turn</button>}
        {draw && <button className="btn" disabled={busy} onClick={() => act(draw)}>Draw a card</button>}
      </div>

      <Seat v={v} seat={v.bottom} position="bottom" extra={seatExtra?.[v.bottom]}
        playable={yourTurn ? legalByCard : undefined} onPlay={playCard} />

      {wildFor && (
        <div className="overlay" onClick={() => setWildFor(null)}>
          <div className="dialog" role="dialog" aria-label="Choose a color" onClick={(e) => e.stopPropagation()}>
            <h2>Choose a color</h2>
            <div className="swatches">
              {COLORS.map((c) => (
                <button key={c} className={`swatch c-${c}`} aria-label={cap(c)} onClick={() => chooseColor(c)} />
              ))}
            </div>
            <button className="btn ghost" onClick={() => setWildFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {challenge && (
        <div className="overlay">
          <div className="dialog" role="dialog" aria-label="Wild Draw Four">
            <h2>Wild Draw Four!</h2>
            <p>
              Think {v.names[1 - v.you!]} still had a {v.events.length ? prevColor(v.events) ?? "matching" : "matching"} card? Challenge it.
              <br />
              <small>Right: they draw 4 and you play on. Wrong: you draw 6 and lose your turn.</small>
            </p>
            <div className="row">
              <button className="btn primary" onClick={() => act(find("challenge")!)}>Challenge</button>
              <button className="btn" onClick={() => act(find("accept")!)}>Accept · draw 4</button>
            </div>
          </div>
        </div>
      )}

      {over && !hideGameOver && <GameOver v={v} actions={gameOverActions} />}
    </div>
  );
}

function aOrAn(label: string) {
  return (/^[AEIOU]/.test(label) ? "an " : "a ") + label;
}

function prevColor(events: GameEvent[]): string | null {
  for (let i = events.length - 2; i >= 0; i--) {
    const e = events[i];
    if (e.event === "play" && e.color) return e.color;
    if (e.event === "start_card" && e.card) return parseCard(e.card).color;
  }
  return null;
}

function Seat({ v, seat, position, extra, playable, onPlay }: {
  v: TableView; seat: number; position: "top" | "bottom"; extra?: ReactNode;
  playable?: Map<CardId, Action[]>; onPlay?: (c: CardId) => void;
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
      <Hand v={v} seat={seat} small={position === "top"} playable={playable} onPlay={onPlay} />
      {position === "bottom" && info}
    </div>
  );
}

function Hand({ v, seat, small, playable, onPlay }: {
  v: TableView; seat: number; small: boolean;
  playable?: Map<CardId, Action[]>; onPlay?: (c: CardId) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<CardId[] | null>(null);
  const hand = v.hands[seat];
  const n = v.handSizes[seat];
  const [overlap, setOverlap] = useState(6);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const first = el.querySelector(".card") as HTMLElement | null;
      const cw = first ? first.offsetWidth : 80;
      const avail = el.clientWidth - 24;
      let o = 6;
      if (n > 1 && n * cw + (n - 1) * 6 > avail) o = Math.max((avail - cw) / (n - 1) - cw, -cw * 0.84);
      setOverlap(o);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  // Mark cards that weren't in the previous render so they animate in.
  const fresh = useMemo(() => {
    const out = new Set<number>();
    if (!hand) return out;
    const counts = new Map<CardId, number>();
    for (const c of prev.current ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    sortHand(hand).forEach((c, i) => {
      const k = counts.get(c) ?? 0;
      if (k > 0) counts.set(c, k - 1);
      else if (prev.current) out.add(i);
    });
    return out;
  }, [hand]);
  useEffect(() => {
    prev.current = hand;
  }, [hand]);

  const style = { "--overlap": `${overlap}px` } as React.CSSProperties;
  let pendingMarked = false;
  return (
    <div ref={ref} className={`hand ${small ? "hand-small" : "hand-main"}`} style={style}>
      {hand
        ? sortHand(hand).map((c, i) => {
            const canPlay = !!playable?.has(c);
            const isPending = !pendingMarked && v.phase === "drew" && v.current === seat && c === v.pending;
            if (isPending) pendingMarked = true;
            return (
              <Card key={`${c}-${i}`} id={c} fresh={fresh.has(i)} highlight={isPending}
                playable={canPlay} dim={!!playable && !canPlay} onClick={() => onPlay?.(c)} />
            );
          })
        : Array.from({ length: n }, (_, i) => <CardBack key={i} />)}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function DiscardPile({ v }: { v: TableView }) {
  const played = v.events.filter((e) => (e.event === "play" || e.event === "start_card") && e.card);
  const recent = played.slice(-4);
  if (!recent.length || recent[recent.length - 1].card !== v.top) recent.push({ t: v.turn, event: "play", player: null, card: v.top });
  const shown = recent.slice(-4);
  return (
    <div className="discard" style={{ "--ring": v.color ? `var(--${v.color})` : "var(--ring-any)" } as React.CSSProperties}>
      {shown.map((e, i) => {
        const isTop = i === shown.length - 1;
        const rot = (hash(`${e.t}${e.card}${i}`) % 25) - 12;
        return (
          <Card key={`${e.t}-${e.card}-${played.length - shown.length + i}`} id={e.card!}
            className={isTop ? "top" : ""}
            chosen={isTop && parseCard(e.card!).color === null ? v.color : null}
            style={{ transform: `rotate(${rot}deg)`, "--rot": `${rot}deg` } as React.CSSProperties} />
        );
      })}
    </div>
  );
}

function GameOver({ v, actions }: { v: TableView; actions?: ReactNode }) {
  const loser = v.winner === null ? null : 1 - v.winner;
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
        {loserHand && (
          <div className="reveal">{sortHand(loserHand).map((c, i) => <Card key={i} id={c} />)}</div>
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
    case "play": return `${who} played ${cardLabel(e.card!)}${parseCard(e.card!).color ? "" : ` → ${e.color}`}`;
    case "draw": return `${who} drew ${e.count} card${e.count === 1 ? "" : "s"}`;
    case "pass": return `${who} kept the card`;
    case "challenge": return `${who} challenged: ${e.success ? "caught a bluff!" : "it was legal"}`;
    case "accept": return `${who} accepted the Wild Draw Four`;
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

