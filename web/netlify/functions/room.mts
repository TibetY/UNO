import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { type RoomStore, type StoredPeer, handleRoom } from "../lib/room-core";

/** Netlify Blobs, with strong consistency so a move is visible on the next poll. */
function blobStore(): RoomStore {
  const s = getStore({ name: "card-duel-rooms", consistency: "strong" });
  return {
    get: async (k) => (await s.get(k, { type: "json" })) as StoredPeer | null,
    set: async (k, v) => void (await s.setJSON(k, v)),
    delete: async (k) => void (await s.delete(k)),
    list: async (prefix) => (await s.list({ prefix })).blobs.map((b) => b.key),
  };
}

export default async (req: Request, context: Context) => handleRoom(req, context.params.room, blobStore());

export const config: Config = { path: "/api/room/:room" };
