import type { GameEvent } from "./engine/engine";

/** Card-dealing animation timing (ms). */
export const DEAL_STAGGER = 130;   // opening deal: gap between cards
export const DRAW_STAGGER = 300;   // drawing (penalties, the deck): gap between cards
export const DEAL_DURATION = 480;  // one card's flight

/** How long the dealing animation for these new events takes to finish. */
export function dealAnimationMs(events: readonly GameEvent[], handSize: number): number {
  let ms = 0;
  for (const e of events) {
    if (e.event === "deal") ms = Math.max(ms, handSize * DEAL_STAGGER + DEAL_DURATION);
    else if (e.event === "draw" && e.count) ms += Math.min(e.count, 12) * DRAW_STAGGER + DEAL_DURATION;
  }
  return ms;
}
