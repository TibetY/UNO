import { createContext, type RefObject } from "react";
import type { CardId } from "./engine/cards";
import type { GameEvent } from "./engine/engine";

/** Card motion timing (ms). */
export const DEAL_STAGGER = 170;    // opening deal: gap between cards
export const DRAW_STAGGER = 420;    // drawing: gap between cards
export const FLIGHT_MS = 650;       // deck → hand
export const PLAY_MS = 560;         // hand → pile
export const PLAY_STAGGER = 260;    // several cards played at once
export const SHIFT_MS = 420;        // cards sliding to make or close a gap
export const EASE = "cubic-bezier(.22, .68, .24, 1)";

/** How long the card motion for these new events takes to finish. */
export function dealAnimationMs(events: readonly GameEvent[], handSize: number): number {
  let ms = 0;
  let plays = 0;
  for (const e of events) {
    if (e.event === "deal") ms = Math.max(ms, handSize * DEAL_STAGGER + FLIGHT_MS);
    else if (e.event === "draw" && e.count) ms += (Math.min(e.count, 12) - 1) * DRAW_STAGGER + FLIGHT_MS;
    else if (e.event === "play") plays++;
  }
  if (plays) ms += PLAY_MS + (plays - 1) * PLAY_STAGGER;
  return ms;
}

export const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where a card left a hand from, so the pile can fly it in from there. */
export interface Departure {
  seat: number;
  /** null for a face-down card. */
  card: CardId | null;
  rect: DOMRect;
  at: number;
}

export interface TableMotion {
  deck: RefObject<HTMLElement>;
  departures: { current: Departure[] };
}

export const MotionContext = createContext<TableMotion | null>(null);

/** Fly `el` from `from` (a viewport rect) to where it sits now. */
export function flyFrom(el: HTMLElement, from: DOMRect, opts: { duration: number; delay?: number; rotate?: number }) {
  const to = el.getBoundingClientRect();
  if (!to.width) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const s = from.width / to.width;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${opts.rotate ?? 0}deg)` },
      { transform: "translate(0, 0) scale(1) rotate(0deg)" },
    ],
    { duration: opts.duration, delay: opts.delay ?? 0, easing: EASE, fill: "backwards" },
  );
}
