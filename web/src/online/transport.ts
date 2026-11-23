/**
 * A minimal shared-room interface with two implementations:
 *  - the claude.ai artifact `room` capability (real online play), and
 *  - a BroadcastChannel fallback that links tabs of the same browser
 *    (for local development and tests).
 */

export interface Peer {
  peer: string;
  isMe: boolean;
  presence: Readonly<Record<string, unknown>>;
}

export interface SharedRoom {
  readonly kind: "online" | "local";
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(fn: (peers: readonly Peer[]) => void): () => void;
  onConnection(fn: (connected: boolean) => void): () => void;
  myPeer(): string | null;
  leave(): Promise<void>;
}

export interface RoomProvider {
  readonly kind: "online" | "local";
  join(name: string): Promise<SharedRoom>;
}

// ------------------------------------------------------------ claude.ai room

interface ClaudeNamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly (Peer & { sameTab: boolean })[];
  onPeers(fn: (c: { peers: readonly (Peer & { sameTab: boolean })[] }) => void, onError?: (e: unknown) => void): () => void;
  onConnection(fn: (c: boolean) => void, onError?: (e: unknown) => void): () => void;
  connected(): boolean;
  leave(): Promise<void>;
}
interface ClaudeRoom {
  join(name: string): Promise<ClaudeNamedRoom>;
}

class ArtifactRoom implements SharedRoom {
  readonly kind = "online" as const;
  constructor(private r: ClaudeNamedRoom) {}
  presence(patch: Record<string, unknown>) {
    return this.r.presence(patch);
  }
  peers() {
    return this.r.peers();
  }
  onPeers(fn: (p: readonly Peer[]) => void) {
    return this.r.onPeers((c) => fn(c.peers), () => fn(this.r.peers()));
  }
  onConnection(fn: (c: boolean) => void) {
    return this.r.onConnection(fn, () => fn(false));
  }
  myPeer() {
    return this.r.peers().find((p) => p.isMe && p.sameTab)?.peer ?? null;
  }
  leave() {
    return this.r.leave();
  }
}

/** Resolves the artifact room if this page runs inside claude.ai, else null. */
export async function artifactRoomProvider(): Promise<RoomProvider | null> {
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!claude?.use) return null;
  try {
    const room = (await claude.use("room")) as ClaudeRoom | null;
    if (!room) return null;
    return { kind: "online", join: async (name) => new ArtifactRoom(await room.join(name)) };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ local fallback

type LocalMsg =
  | { t: "presence"; peer: string; presence: Record<string, unknown> }
  | { t: "leave"; peer: string }
  | { t: "hello"; peer: string };

class LocalRoom implements SharedRoom {
  readonly kind = "local" as const;
  private ch: BroadcastChannel;
  private me = Math.random().toString(36).slice(2, 12);
  private mine: Record<string, unknown> = {};
  private others = new Map<string, { presence: Record<string, unknown>; seen: number }>();
  private listeners = new Set<(p: readonly Peer[]) => void>();
  private snapshot: readonly Peer[] = [];
  private timer: number;

  constructor(name: string) {
    this.ch = new BroadcastChannel("card-duel/" + name);
    this.ch.onmessage = (e: MessageEvent<LocalMsg>) => this.receive(e.data);
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.rebuild();
    this.send({ t: "hello", peer: this.me });
    this.send({ t: "presence", peer: this.me, presence: this.mine });
    window.addEventListener("pagehide", this.onHide);
  }
  private onHide = () => this.send({ t: "leave", peer: this.me });
  private send(m: LocalMsg) {
    try {
      this.ch.postMessage(m);
    } catch {
      /* channel closed */
    }
  }
  private receive(m: LocalMsg) {
    if (m.peer === this.me) return;
    if (m.t === "hello") return this.send({ t: "presence", peer: this.me, presence: this.mine });
    if (m.t === "leave") this.others.delete(m.peer);
    else this.others.set(m.peer, { presence: m.presence, seen: Date.now() });
    this.rebuild();
  }
  private tick() {
    this.send({ t: "presence", peer: this.me, presence: this.mine });
    const before = this.others.size;
    for (const [k, v] of this.others) if (Date.now() - v.seen > 4000) this.others.delete(k);
    if (this.others.size !== before) this.rebuild();
  }
  private rebuild() {
    this.snapshot = Object.freeze([
      { peer: this.me, isMe: true, presence: this.mine },
      ...[...this.others].map(([peer, v]) => ({ peer, isMe: false, presence: v.presence })),
    ]);
    for (const l of this.listeners) l(this.snapshot);
  }
  async presence(patch: Record<string, unknown>) {
    const next = { ...this.mine };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    this.mine = next;
    this.send({ t: "presence", peer: this.me, presence: this.mine });
    this.rebuild();
  }
  peers() {
    return this.snapshot;
  }
  onPeers(fn: (p: readonly Peer[]) => void) {
    this.listeners.add(fn);
    queueMicrotask(() => fn(this.snapshot));
    return () => this.listeners.delete(fn);
  }
  onConnection(fn: (c: boolean) => void) {
    queueMicrotask(() => fn(true));
    return () => {};
  }
  myPeer() {
    return this.me;
  }
  async leave() {
    this.send({ t: "leave", peer: this.me });
    window.clearInterval(this.timer);
    window.removeEventListener("pagehide", this.onHide);
    this.listeners.clear();
    this.ch.close();
  }
}

export const localRoomProvider: RoomProvider = {
  kind: "local",
  join: async (name) => new LocalRoom(name),
};
