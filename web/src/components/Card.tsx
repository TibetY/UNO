import { type CSSProperties, type KeyboardEvent, createContext, useContext } from "react";
import { type CardId, type Color, cardLabel, parseCard } from "../engine/cards";

const SYMBOL: Record<string, string> = { skip: "⊘", reverse: "⇄", draw2: "+2", wild: "", wild4: "+4" };

/** What the blank custom card does in this game (set in the rules before dealing). */
export interface CustomCardRules {
  customColor: boolean;
  customSkip: boolean;
  customDraw: number;
}
export const CustomCardContext = createContext<CustomCardRules>({ customColor: true, customSkip: false, customDraw: 10 });

export function customEffect(r: CustomCardRules): string {
  const parts: string[] = [];
  if (r.customDraw > 0) parts.push(`opponent picks up ${r.customDraw}`);
  if (r.customSkip) parts.push("you go again");
  if (r.customColor) parts.push("you choose the color");
  return parts.length ? parts.join(", ") : "no effect";
}

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
  const custom = useContext(CustomCardContext);
  if (rank === "custom") {
    return <CustomCard r={custom} chosen={chosen} playable={playable} dim={dim} selected={selected} order={order}
      highlight={highlight} className={className} style={style} onClick={onClick} />;
  }
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

/** The blank custom card: black border, white face, its effect written on it. */
function CustomCard({ r, chosen, playable, dim, selected, order, highlight, className = "", style, onClick }: Omit<Props, "id"> & { r: CustomCardRules }) {
  const big = r.customDraw > 0 ? `+${r.customDraw}` : r.customSkip ? "⊘" : "";
  const cls = ["card", "custom", playable && "playable", dim && "dim", selected && "selected", highlight && "highlight", className]
    .filter(Boolean).join(" ");
  const interactive = (playable || selected) && onClick;
  return (
    <div
      className={cls}
      data-rank="custom"
      style={chosen ? ({ ...style, "--chosen": `var(--${chosen})` } as CSSProperties) : style}
      data-chosen={chosen ? "" : undefined}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`Custom card: ${customEffect(r)}` + (chosen ? `, ${chosen} chosen` : "") + (order ? `, picked ${order}` : "")}
      aria-pressed={interactive ? !!selected : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick!();
        }
      }}
    >
      <div className="face">
        <span className="corner tl">{big}</span>
        <div className="custom-mark">
          {big && <span className="custom-big">{big}</span>}
          <span className="custom-icons">
            {r.customColor && <i className="custom-diamond" />}
            {r.customSkip && r.customDraw > 0 && <i className="custom-skip">⊘</i>}
          </span>
        </div>
        <span className="corner br">{big}</span>
      </div>
      {order ? <span className="order">{order}</span> : null}
    </div>
  );
}
