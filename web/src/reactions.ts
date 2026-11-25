/** Preset reactions players can send during a game. Only these ids travel. */
export const REACTIONS = [
  { id: "angry", emoji: "😠", label: "Angry" },
  { id: "crying", emoji: "😭", label: "Crying" },
  { id: "cool", emoji: "😎", label: "Cool" },
  { id: "grin", emoji: "😁", label: "Grinning" },
  { id: "devil", emoji: "😈", label: "Devil" },
  { id: "cursing", emoji: "🤬", label: "Cursing" },
  { id: "down", emoji: "👎", label: "Thumbs down" },
  { id: "up", emoji: "👍", label: "Thumbs up" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

/** A reaction on screen: who sent it, which one, and a unique key for its animation. */
export interface Reaction {
  seat: number;
  id: ReactionId;
  key: number;
}

export const reactionEmoji = (id: string) => REACTIONS.find((r) => r.id === id)?.emoji ?? null;
export const isReactionId = (id: unknown): id is ReactionId => typeof id === "string" && REACTIONS.some((r) => r.id === id);

/** How long a reaction stays on screen (ms). */
export const REACTION_MS = 2600;
/** At most one reaction per this many ms from each player. */
export const REACTION_COOLDOWN_MS = 1000;
