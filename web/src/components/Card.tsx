import type { CSSProperties, KeyboardEvent } from "react";
import { type CardId, type Color, cardLabel, parseCard } from "../engine/cards";

const SYMBOL: Record<string, string> = { skip: "⊘", reverse: "⇄", draw2: "+2", wild: "", wild4: "+4" };

interface Props {
  id: CardId;
  /** Chosen color shown on a wild's rim (top of the discard pile). */
  chosen?: Color | null;
  playable?: boolean;
  dim?: boolean;
  /** Picked to be played; `order` is its place in the sequence. */
  selected?: boolean;
  order?: number;
  /** The card you just drew. */
  highlight?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Card({ id, chosen, playable, dim, selected, order, highlight, className = "", style, onClick }: Props) {
  const { rank, color } = parseCard(id);
  const sym = SYMBOL[rank] ?? rank;
  const cls = [
    "card",
    color ? `c-${color}` : "wild",
    playable && "playable",
    dim && "dim",
    selected && "selected",
    highlight && "highlight",
    className,
  ].filter(Boolean).join(" ");
  const interactive = (playable || selected) && onClick;
  const onKey = (e: KeyboardEvent) => {
    if (interactive && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick!();
    }
  };
  return (
    <div
      className={cls}
      data-rank={rank}
      style={chosen ? ({ ...style, "--chosen": `var(--${chosen})` } as CSSProperties) : style}
      data-chosen={chosen ? "" : undefined}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={cardLabel(id) + (chosen ? `, ${chosen} chosen` : "") + (order ? `, picked ${order}` : "")}
      aria-pressed={interactive ? !!selected : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={onKey}
    >
      <div className="face">
        {rank === "wild" ? <span className="corner tl mini" /> : <span className="corner tl">{sym}</span>}
        <div className="emblem"><span>{sym}</span></div>
        {rank === "wild" ? <span className="corner br mini" /> : <span className="corner br">{sym}</span>}
      </div>
      {order ? <span className="order">{order}</span> : null}
    </div>
  );
}

export function CardBack({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`card back ${className}`} style={style} role="img" aria-label="Face-down card">
      <div className="face"><div className="emblem"><span>DUEL</span></div></div>
    </div>
  );
}
