/** Preset reactions players can send during a game. Only these ids travel. */
export const REACTIONS = [
  { id: "crying", emoji: "😭", label: "Crying" },
  { id: "lol", emoji: "😂", label: "Crying laughing" },
  { id: "eyeroll", emoji: "🙄", label: "Eye roll" },
  { id: "cursing", emoji: "🤬", label: "Cursing" },
  { id: "down", emoji: "👎", label: "Thumbs down" },
  { id: "up", emoji: "👍", label: "Thumbs up" },
  { id: "eggplant", emoji: "🍆", label: "Eggplant" },
  { id: "trash", emoji: "🗑️", label: "Garbage" },
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
