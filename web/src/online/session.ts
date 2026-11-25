/**
 * Online 1v1 over a shared room's presence.
 *
 * The host's browser runs the engine and is the referee. Each side keeps one
 * presence object current:
 *   host:  { app, role: "host",  name, v, g, st, sc }   v = state version,
 *          g = seated guest's peer label, st = the guest's view of the table,
 *          sc = match score [host, guest]
 *   guest: { app, role: "guest", name, act }            act = { seq, v, keys }:
 *          "make these moves, in order, on state version v" (action keys)
 * Presence is absolute state, handed to late joiners and re-asserted after
 * reconnects, so nothing needs re-sending when messages drop. Everything a peer
 * sends is untrusted: the host validates every move against the rules, and the
 * host never publishes its own hand until the game is over.
 */
import { type Action, Game, type Rules, actionKey } from "../engine/engine";
import { parseCard } from "../engine/cards";
import { randomSeed } from "../engine/rng";
import { type TableView, type WireView, decodeView, encodeView, viewFromGame } from "../view";
import { REACTION_COOLDOWN_MS, REACTION_MS, type Reaction, type ReactionId, isReactionId } from "../reactions";
import type { TurnClock } from "../timer";
import type { Peer, SharedRoom } from "./transport";

export type OnlineStatus =
  | "connecting"     // joining the room
  | "waiting"        // host: waiting for an opponent
  | "looking"        // guest: no host found yet
  | "playing"
  | "full"           // guest: someone else has the seat
  | "opponent-left";

export interface OnlineState {
  role: "host" | "guest";
  code: string;
  status: OnlineStatus;
  connected: boolean;
  /** Has been connected at least once (so a drop is a reconnect, not the first connect). */
  wasConnected: boolean;
  view: TableView | null;
  myName: string;
  oppName: string;
  /** [my wins, opponent's wins] */
  score: [number, number];
  /** Guest: a move was sent and the host hasn't answered yet. */
  sending: boolean;
  /** Reactions currently on screen (seat 0 = host, 1 = guest). */
  reactions: Reaction[];
  /** Turn timer length in ms (0 = off), and the clock running now. */
  turnMs: number;
  clock: TurnClock | null;
  transport: "online" | "local";
}

const APP = "card-duel";
const MAX_PRESENCE = 3600;
const CARD_RE = /^(?:(?:red|yellow|green|blue):(?:\d|skip|reverse|draw2)|wild4?|custom)$/;

export const cleanName = (s: unknown, fallback: string) =>
  typeof s === "string" && s.trim() ? s.trim().replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, "").slice(0, 24) : fallback;

export function makeCode(): string {
  // No vowels, so a code can't spell a word.
  const abc = "bcdfghjkmnpqrstvwxz23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
export const roomName = (code: string) => `duel-${code}`;
export const validCode = (code: string) => /^[a-z0-9]{3,12}$/.test(code);

/**
 * Keeps the screen on during an online game where the browser allows it: a
 * phone that locks or sleeps stops checking in, and the host's phone is also
 * the referee. Re-acquired when the page comes back into view.
 */
const keepAwake = (() => {
  type Lock = { release(): Promise<void> };
  let lock: Lock | null = null;
  let wanted = false;
  const acquire = async () => {
    wanted = true;
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<Lock> } }).wakeLock;
    if (!wl || lock || document.visibilityState !== "visible") return;
    try {
      lock = await wl.request("screen");
      (lock as unknown as EventTarget).addEventListener?.("release", () => (lock = null));
    } catch {
      /* not allowed here (low battery, embedded view, older browser) */
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (wanted && document.visibilityState === "visible") void acquire();
  });
  return {
    acquire,
    release() {
      wanted = false;
      void lock?.release().catch(() => {});
      lock = null;
    },
  };
})();

abstract class Session {
  protected listeners = new Set<() => void>();
  protected state: OnlineState;
  protected unsubs: (() => void)[] = [];

  constructor(protected room: SharedRoom, role: "host" | "guest", code: string, name: string) {
    this.state = {
      role, code, status: "connecting", connected: false, wasConnected: false, view: null,
      myName: name, oppName: "Opponent", score: [0, 0], sending: false, transport: room.kind, reactions: [], turnMs: 0, clock: null,
    };
  }

  protected start() {
    this.unsubs.push(this.room.onPeers((p) => this.onPeers(p)));
    this.unsubs.push(this.room.onConnection((c) => this.set({ connected: c, wasConnected: this.state.wasConnected || c })));
    void keepAwake.acquire();
  }

  protected abstract onPeers(peers: readonly Peer[]): void;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  protected set(patch: Partial<OnlineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- reactions: { emo: { id, n } } in presence; n changes with every new one
  protected abstract readonly seat: number;
  private lastSent = 0;
  private seenEmo = new Map<string, number>();

  /** Send a reaction (also shown here at once). */
  react(id: ReactionId) {
    const now = Date.now();
    if (now - this.lastSent < REACTION_COOLDOWN_MS) return;
    this.lastSent = now;
    void this.room.presence({ emo: { id, n: now } }).catch(() => {});
    this.show(this.seat, id);
  }

  /** Called with the other player's presence: show their reaction if it's new. */
  protected checkReaction(peer: Peer, seat: number) {
    const emo = peer.presence.emo as { id?: unknown; n?: unknown } | undefined;
    const n = emo && typeof emo.n === "number" ? emo.n : 0;
    const before = this.seenEmo.get(peer.peer);
    this.seenEmo.set(peer.peer, n);
    // The first time we see someone, whatever reaction they sent before is old news.
    if (before === undefined || n === before || !emo || !isReactionId(emo.id)) return;
    this.show(seat, emo.id);
  }

  private show(seat: number, id: ReactionId) {
    const r: Reaction = { seat, id, key: Date.now() + Math.random() };
    this.set({ reactions: [...this.state.reactions.filter((x) => x.seat !== seat), r] });
    window.setTimeout(() => this.set({ reactions: this.state.reactions.filter((x) => x !== r) }), REACTION_MS);
  }

  async leave() {
    keepAwake.release();
    this.unsubs.forEach((u) => u());
    this.listeners.clear();
    await this.room.leave().catch(() => {});
  }
}

// ------------------------------------------------------------------ host

export class HostSession extends Session {
  protected readonly seat = 0;
  private game: Game | null = null;
  private ver = 0;
  private guestPeer: string | null = null;
  private lastSeq = 0;
  private counted = false;
  private gamesPlayed = 0;
  private hostScore: [number, number] = [0, 0];

  constructor(room: SharedRoom, code: string, name: string, private rules: Partial<Rules>) {
    super(room, "host", code, name);
    this.state.status = "waiting";
    void room.presence({ app: APP, role: "host", name, v: 0, g: null, st: null, sc: [0, 0] });
    this.start();
  }

  protected onPeers(peers: readonly Peer[]) {
    const guests = peers.filter((p) => !p.isMe && p.presence.app === APP && p.presence.role === "guest");
    let seated = guests.find((p) => p.peer === this.guestPeer);
    let reseated = false;
    if (!seated && guests.length) {
      seated = guests[0];
      this.guestPeer = seated.peer;
      this.lastSeq = 0;
      reseated = true;
    }
    const oppName = cleanName(seated?.presence.name, "Opponent");
    const status: OnlineStatus = !this.game ? "waiting" : seated ? "playing" : "opponent-left";
    const statusChanged = status !== this.state.status;
    this.set({ oppName, status });
    // The clock pauses while the opponent is away, and restarts when they're back.
    if (statusChanged && this.game) {
      this.clockKey = null;
      window.clearTimeout(this.clockTimer);
      this.clock = null;
      if (status === "playing") reseated = true;
      else this.set({ clock: null });
    }
    if (seated) this.checkReaction(seated, 1);
    if (seated && !this.game) return this.newGame();
    if (seated) this.handleAct(seated.presence.act);
    if (reseated || (seated && oppName !== this.lastPublishedOpp)) this.publish();
  }

  private lastPublishedOpp = "";

  private handleAct(act: unknown) {
    if (!act || typeof act !== "object") return;
    const { seq, v, keys } = act as Record<string, unknown>;
    if (typeof seq !== "number" || typeof v !== "number" || !Array.isArray(keys) || keys.length > 40) return;
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    const g = this.game;
    if (!g || v !== this.ver || g.isOver || g.current !== 1) return;
    if (applyMoves(g, 1, keys.filter((k): k is string => typeof k === "string"))) this.changed();
  }

  /** The host's own moves (seat 0). */
  actMany(actions: Action[]) {
    const g = this.game;
    if (!g || g.isOver || g.current !== 0) return;
    if (applyMoves(g, 0, actions.map(actionKey))) this.changed();
  }

  newGame() {
    if (this.game && !this.game.isOver) return;
    const starter = this.gamesPlayed === 0 ? Math.floor(Math.random() * 2) : 1 - this.game!.starter;
    this.gamesPlayed++;
    this.game = new Game({ seed: randomSeed(), starter, rules: this.rules });
    this.counted = false;
    this.set({ status: this.guestPeer ? "playing" : "waiting" });
    this.changed();
  }

  private changed() {
    const g = this.game!;
    if (g.isOver && !this.counted && g.winner !== null) {
      this.hostScore[g.winner]++;
      this.counted = true;
    }
    this.publish();
  }

  private publish() {
    const g = this.game;
    this.ver++;
    const names: [string, string] = [this.state.myName, this.state.oppName];
    this.lastPublishedOpp = this.state.oppName;
    let st: WireView | null = null;
    if (g) {
      for (const limit of [16, 10, 6, 3, 1]) {
        st = encodeView(viewFromGame(g, { you: 1, names, eventLimit: limit }));
        if (JSON.stringify(st).length < MAX_PRESENCE) break;
      }
    }
    const clock = this.updateClock();
    const tm = clock ? { s: clock.seat, left: Math.max(0, clock.deadline - Date.now()), t: clock.total } : null;
    void this.room.presence({ v: this.ver, g: this.guestPeer, st, sc: this.hostScore, tl: this.turnMs, tm }).catch(() => {});
    this.set({
      view: g ? viewFromGame(g, { you: 0, names }) : null,
      score: [...this.hostScore] as [number, number],
      turnMs: this.turnMs,
      clock,
    });
  }

  // ---- turn timer: the host keeps time for both players
  private get turnMs() {
    return Math.max(0, (this.rules.turnSeconds ?? 0) * 1000);
  }
  private clockKey: string | null = null;
  private clock: TurnClock | null = null;
  private clockTimer: number | undefined;

  /** Start a fresh clock when the turn changes; returns the running clock. */
  private updateClock(): TurnClock | null {
    const g = this.game;
    const key = g && !g.isOver && this.turnMs > 0 && this.state.status === "playing"
      ? `${g.seed}:${g.uid}:${g.turn}:${g.current}` : null;
    if (key === this.clockKey) return this.clock;
    window.clearTimeout(this.clockTimer);
    this.clockKey = key;
    this.clock = null;
    if (!key || !g) return null;
    this.clock = { seat: g.current, deadline: Date.now() + this.turnMs, total: this.turnMs };
    this.clockTimer = window.setTimeout(() => {
      // Only if it's still that turn and the player is still here.
      if (this.clockKey !== key || this.state.status !== "playing" || !this.game || this.game.isOver) return;
      this.game.timeout();
      this.changed();
    }, this.turnMs);
    return this.clock;
  }
}

// ------------------------------------------------------------------ guest

function validView(w: unknown): w is WireView {
  if (!w || typeof w !== "object") return false;
  const v = w as Record<string, unknown>;
  const cardsOk = (xs: unknown) => Array.isArray(xs) && xs.every((c) => typeof c === "string" && CARD_RE.test(c));
  return (
    Array.isArray(v.hands) && v.hands.every((h) => h === null || cardsOk(h)) &&
    typeof v.top === "string" && CARD_RE.test(v.top) &&
    (v.pending === null || (typeof v.pending === "string" && CARD_RE.test(v.pending))) &&
    Array.isArray(v.legal) && v.legal.every((a) => typeof a === "string") &&
    Array.isArray(v.events) && Array.isArray(v.handSizes) && typeof v.pendingDraw === "number" && !!v.rules && typeof v.rules === "object" && typeof v.gameId === "string" && v.gameId.length < 40 && v.you === 1
  );
}

export class GuestSession extends Session {
  protected readonly seat = 1;
  private hostPeer: string | null = null;
  private hostVer = -1;
  private sentFor = -1;
  private sawHost = false;
  private clockVer = -1;
  private guestClock: TurnClock | null = null;
  /** The table as it will look once the host confirms our move (shown meanwhile). */
  private predicted: TableView | null = null;
  private sendTimer: number | undefined;

  constructor(room: SharedRoom, code: string, name: string) {
    super(room, "guest", code, name);
    this.state.status = "looking";
    void room.presence({ app: APP, role: "guest", name, act: null });
    this.start();
  }

  protected onPeers(peers: readonly Peer[]) {
    const hosts = peers.filter((p) => !p.isMe && p.presence.app === APP && p.presence.role === "host");
    const host = hosts.find((p) => p.peer === this.hostPeer) ?? hosts[0];
    if (!host) {
      this.set({ status: this.sawHost ? "opponent-left" : "looking" });
      return;
    }
    this.sawHost = true;
    this.hostPeer = host.peer;
    const pr = host.presence;
    const me = this.room.myPeer();
    const seat = typeof pr.g === "string" ? pr.g : null;
    const oppName = cleanName(pr.name, "Host");
    if (seat && seat !== me) return this.set({ status: "full", oppName });
    this.checkReaction(host, 0);
    if (typeof pr.v === "number") this.hostVer = pr.v;
    const view = validView(pr.st) ? decodeView(pr.st) : null;
    if (view && typeof view.eventBase !== "number") view.eventBase = 0;
    if (view) {
      view.names = [oppName, this.state.myName];
      const r = view.rules as Partial<TableView["rules"]>;
      view.rules = {
        multiPlay: !!r.multiPlay, stackDraws: !!r.stackDraws, numberFinish: !!r.numberFinish,
        customColor: r.customColor !== false, customSkip: !!r.customSkip,
        customDraw: Math.max(0, Math.min(99, Math.floor(Number(r.customDraw) || 0))),
      };
    }
    const sc = Array.isArray(pr.sc) && pr.sc.length === 2 ? (pr.sc as number[]).map((x) => Number(x) || 0) : [0, 0];
    const waiting = this.sentFor === this.hostVer;
    if (!waiting) this.settle();
    if (typeof pr.v === "number" && pr.v !== this.clockVer) {
      this.clockVer = pr.v;
      const tm = pr.tm as { s?: unknown; left?: unknown; t?: unknown } | null | undefined;
      const ok = tm && (tm.s === 0 || tm.s === 1) && typeof tm.left === "number" && typeof tm.t === "number" && tm.t > 0 && tm.t <= 600_000;
      this.guestClock = ok ? { seat: tm!.s as number, deadline: Date.now() + Math.min(tm!.left as number, tm!.t as number), total: tm!.t as number } : null;
    }
    const tl = typeof pr.tl === "number" && pr.tl > 0 && pr.tl <= 600_000 ? pr.tl : 0;
    this.set({
      status: view ? "playing" : "looking",
      oppName,
      // While our move is on its way, keep showing it rather than the old table.
      view: waiting && this.predicted ? this.predicted : view,
      score: [sc[1], sc[0]],
      sending: waiting,
      turnMs: tl,
      clock: this.guestClock,
    });
  }

  private settle() {
    this.predicted = null;
    window.clearTimeout(this.sendTimer);
  }

  actMany(actions: Action[]) {
    const v = this.state.view;
    if (!v || this.sentFor === this.hostVer || !actions.length) return;
    if (!v.legal.some((a) => actionKey(a) === actionKey(actions[0]))) return;
    this.sentFor = this.hostVer;
    this.predicted = predict(v, actions);
    this.set({ sending: true, view: this.predicted ?? v });
    const giveUp = () => {
      // No answer: show the host's table again and let the player retry.
      this.sentFor = -1;
      this.settle();
      this.onPeers(this.room.peers());
    };
    window.clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(giveUp, 8000);
    void this.room.presence({ act: { seq: Date.now(), v: this.hostVer, keys: actions.map(actionKey) } }).catch(giveUp);
  }
}

export type AnySession = HostSession | GuestSession;

/**
 * What the table will look like after these moves, for cards played from our
 * hand: they leave the hand and land on the pile at once. Draws and other
 * moves depend on hidden cards, so those wait for the host (null).
 */
function predict(v: TableView, actions: Action[]): TableView | null {
  const me = v.you;
  if (me === null || !actions.length || !actions.every((a) => a.type === "play")) return null;
  const hand = [...(v.hands[me] ?? [])];
  const events = [...v.events];
  let color = v.color;
  let top = v.top;
  for (const a of actions) {
    if (a.type !== "play") return null;
    const i = hand.indexOf(a.card);
    if (i < 0) return null;
    hand.splice(i, 1);
    const { rank, color: own } = parseCard(a.card);
    if (a.color) color = a.color;
    else if (rank !== "custom") color = own;
    top = a.card;
    events.push({ t: v.turn, event: "play", player: me, card: a.card, color });
  }
  const lastRank = parseCard(top).rank;
  const goesAgain = lastRank === "skip" || lastRank === "reverse";
  const hands = [...v.hands];
  hands[me] = hand;
  const handSizes = [...v.handSizes];
  handSizes[me] = hand.length;
  return {
    ...v, hands, handSizes, events, top, color, legal: [], pending: null,
    current: goesAgain || !hand.length ? me : 1 - me,
  };
}

/**
 * Apply `seat`'s moves in order, each checked against the rules; stop at the
 * first one that isn't legal. If the cards picked leave the engine waiting
 * for more of the same rank, end the turn. Returns whether anything changed.
 */
function applyMoves(g: Game, seat: number, keys: string[]): boolean {
  let changed = false;
  for (const key of keys) {
    if (g.isOver || g.current !== seat) break;
    const a = g.legalActions().find((x) => actionKey(x) === key);
    if (!a) break;
    g.step(a);
    changed = true;
  }
  if (changed && !g.isOver && g.current === seat && g.phase === "multi") g.step({ type: "done" });
  return changed;
}
