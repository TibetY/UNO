/**
 * Relay for online games on a static host: each player keeps one small
 * "presence" object (the same contract as the claude.ai room), stored under
 * rooms/<room>/<peer>. Players post their own presence and get everyone's back.
 * Each player only ever writes its own key, so two players never overwrite
 * each other. The host's browser still referees the game.
 */

export interface RoomStore {
  get(key: string): Promise<StoredPeer | null>;
  set(key: string, value: StoredPeer): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface StoredPeer {
  presence: Record<string, unknown>;
  seen: number;
}

const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const PEER_RE = /^[a-z0-9]{6,24}$/;
const MAX_PRESENCE = 8 * 1024;
/** A peer that hasn't checked in for this long has left. */
export const PEER_TTL_MS = 15_000;
/** Forget peers entirely after this long. */
const PURGE_MS = 10 * 60_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function handleRoom(req: Request, room: string, store: RoomStore, now = Date.now()): Promise<Response> {
  if (room === "_health") return json(200, { ok: true });
  if (!ROOM_RE.test(room)) return json(400, { error: "bad room name" });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const raw = await req.text();
  if (raw.length > MAX_PRESENCE + 512) return json(413, { error: "too large" });
  let body: { peer?: unknown; presence?: unknown; leave?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }
  const peer = typeof body.peer === "string" ? body.peer : "";
  if (!PEER_RE.test(peer)) return json(400, { error: "bad peer" });
  const key = `rooms/${room}/${peer}`;

  if (body.leave === true) {
    await store.delete(key);
  } else {
    const presence = body.presence && typeof body.presence === "object" && !Array.isArray(body.presence)
      ? (body.presence as Record<string, unknown>) : {};
    await store.set(key, { presence, seen: now });
  }

  const peers: { peer: string; presence: Record<string, unknown> }[] = [];
  for (const k of await store.list(`rooms/${room}/`)) {
    const id = k.slice(`rooms/${room}/`.length);
    const v = await store.get(k);
    if (!v) continue;
    const age = now - v.seen;
    if (age > PURGE_MS) await store.delete(k);
    else if (age <= PEER_TTL_MS) peers.push({ peer: id, presence: v.presence });
  }
  return json(200, { peers, now });
}

export function memoryStore(): RoomStore {
  const m = new Map<string, StoredPeer>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  };
}
