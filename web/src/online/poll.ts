/**
 * Online rooms on a static host (Netlify): a SharedRoom backed by the relay
 * function at /api/room/<name>. Each check posts this page's presence and
 * returns everyone's. It checks often while things change and backs off when
 * quiet, to keep function calls low.
 */
import type { Peer, RoomProvider, SharedRoom } from "./transport";

/** Check every half second while the game is moving... */
const FAST_MS = 500;
/** ...and after this long with no changes, slow down to save function calls. */
const QUIET_AFTER_MS = 30_000;
const SLOW_MS = 2000;
const HIDDEN_MS = 6000;

class PollRoom implements SharedRoom {
  readonly kind = "online" as const;
  private me = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("") + "x";
  private mine: Record<string, unknown> = {};
  private snapshot: readonly Peer[] = Object.freeze([]);
  private peerListeners = new Set<(p: readonly Peer[]) => void>();
  private connListeners = new Set<(c: boolean) => void>();
  private connected = false;
  private failures = 0;
  private lastChange = Date.now();
  private timer: number | undefined;
  private inFlight = false;
  private again = false;
  private stopped = false;

  constructor(private url: string) {
    this.rebuild([]);
    void this.poll();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === "visible") this.kick();
  };

  /** Check now (e.g. right after this player moved). */
  private kick() {
    this.lastChange = Date.now();
    if (this.inFlight) this.again = true;
    else void this.poll();
  }

  private async poll(body: Record<string, unknown> = {}) {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.inFlight = true;
    let changed = false;
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peer: this.me, presence: this.mine, ...body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { peers?: { peer: string; presence: Record<string, unknown> }[] };
      const others = (data.peers ?? []).filter((p) => p.peer !== this.me && p.presence && typeof p.presence === "object");
      changed = this.rebuild(others);
      this.failures = 0;
      this.setConnected(true);
    } catch {
      this.failures++;
      if (this.failures >= 2) this.setConnected(false);
    } finally {
      this.inFlight = false;
    }
    if (this.stopped) return;
    if (this.again) {
      this.again = false;
      return void this.poll();
    }
    // Fast while the game is moving; slower when it's been quiet or the page is hidden.
    if (changed) this.lastChange = Date.now();
    const quiet = Date.now() - this.lastChange > QUIET_AFTER_MS;
    const wait = document.visibilityState === "hidden" ? HIDDEN_MS : quiet ? SLOW_MS : FAST_MS;
    this.timer = window.setTimeout(() => void this.poll(), wait);
  }

  private lastOthers = "";
  private rebuild(others: { peer: string; presence: Record<string, unknown> }[]): boolean {
    const key = JSON.stringify(others);
    const changed = key !== this.lastOthers;
    this.lastOthers = key;
    this.snapshot = Object.freeze([
      { peer: this.me, isMe: true, presence: this.mine },
      ...others.map((p) => ({ peer: p.peer, isMe: false, presence: p.presence })),
    ]);
    if (changed) for (const l of this.peerListeners) l(this.snapshot);
    return changed;
  }

  private setConnected(c: boolean) {
    if (c === this.connected) return;
    this.connected = c;
    for (const l of this.connListeners) l(c);
  }

  async presence(patch: Record<string, unknown>) {
    const next = { ...this.mine };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    this.mine = next;
    this.snapshot = Object.freeze([{ peer: this.me, isMe: true, presence: this.mine }, ...this.snapshot.slice(1)]);
    this.kick();
  }
  peers() {
    return this.snapshot;
  }
  onPeers(fn: (p: readonly Peer[]) => void) {
    this.peerListeners.add(fn);
    queueMicrotask(() => fn(this.snapshot));
    return () => this.peerListeners.delete(fn);
  }
  onConnection(fn: (c: boolean) => void) {
    this.connListeners.add(fn);
    queueMicrotask(() => fn(this.connected));
    return () => this.connListeners.delete(fn);
  }
  myPeer() {
    return this.me;
  }
  async leave() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisible);
    this.peerListeners.clear();
    this.connListeners.clear();
    try {
      await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ peer: this.me, leave: true }), keepalive: true });
    } catch {
      /* the relay forgets us after a few seconds anyway */
    }
  }
}

/** Resolves a provider if this site has the relay function, else null. */
export async function pollRoomProvider(base = "/api/room/"): Promise<RoomProvider | null> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(base + "_health", { signal: ctl.signal, cache: "no-store" });
    window.clearTimeout(t);
    if (!res.ok || !(await res.json()).ok) return null;
  } catch {
    return null;
  }
  return { kind: "online", join: async (name) => new PollRoom(base + encodeURIComponent(name)) };
}
