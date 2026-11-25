import { useEffect, useState, useSyncExternalStore } from "react";
import type { Rules } from "../engine/engine";
import { type AnySession, GuestSession, HostSession, cleanName, makeCode, roomName, validCode } from "../online/session";
import type { RoomProvider } from "../online/transport";
import { loadString, save } from "../storage";
import { GameLog, Table } from "./Table";
import { Stage, useImmersive } from "../immersive";

interface Props {
  provider: RoomProvider | null;
  rules: Rules;
  initialCode: string;
}

export function OnlinePage({ provider, rules, initialCode }: Props) {
  const [session, setSession] = useState<AnySession | null>(null);
  const [name, setName] = useState(() => loadString("name", ""));
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const { enter, exit } = useImmersive();

  useEffect(() => setCode((c) => initialCode || c), [initialCode]);

  if (!provider) return <section className="panel narrow">Connecting…</section>;

  const begin = async (role: "host" | "guest") => {
    const nick = cleanName(name, role === "host" ? "Host" : "Guest");
    save("name", nick);
    const c = role === "host" ? makeCode() : code.trim().toLowerCase();
    if (!validCode(c)) return setError("Enter the 5-character code your friend sent you.");
    enter(); // inside the tap, so the browser allows full screen
    setError("");
    setJoining(true);
    try {
      const room = await provider.join(roomName(c));
      setSession(role === "host" ? new HostSession(room, c, nick, rules) : new GuestSession(room, c, nick));
      setHash(`join-${c}`);
    } catch (e) {
      exit();
      setError(errorText(e));
    } finally {
      setJoining(false);
    }
  };

  const leave = () => {
    void session?.leave();
    setSession(null);
    setHash("online");
    exit();
  };

  if (session) return <OnlineGame session={session} onLeave={leave} />;

  return (
    <section className="lobby">
      <div className="panel lobby-card">
        <h2>Play a friend</h2>
        <p className="lede">
          Start a game and send your friend the code. They open this page, pick <b>Online</b> and enter it.
          {provider.kind === "local" && (
            <span className="warn"> Online play needs the hosted site (your Netlify site or the claude.ai page). Running here, it can only link tabs in this browser.</span>
          )}
        </p>
        <div className="field">
          <label htmlFor="nick">Your name</label>
          <input id="nick" type="text" maxLength={24} placeholder="e.g. Sam" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="lobby-actions">
          <div className="lobby-col">
            <h3>Host</h3>
            <p className="help">You deal and referee. Uses your rule options below.</p>
            <button className="btn primary wide" disabled={joining} onClick={() => begin("host")}>Create game</button>
          </div>
          <div className="lobby-or">or</div>
          <div className="lobby-col">
            <h3>Join</h3>
            <p className="help">Have a code from a friend? Enter it here.</p>
            <div className="join-row">
              <input id="code" type="text" inputMode="text" autoCapitalize="none" autoComplete="off" spellCheck={false}
                aria-label="Game code" placeholder="Code" maxLength={12} value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && begin("guest")} />
              <button className="btn" disabled={joining || !code} onClick={() => begin("guest")}>Join</button>
            </div>
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

/** Both players have to be on the same site: games don't cross between hosts. */
const onClaudePage = () => /claude\.ai$|claudeusercontent|anthropic/.test(location.hostname) || !location.hostname;

/**
 * A link that opens this site on the Online tab with the code filled in. None
 * on the claude.ai page (its frame's address isn't the one people open) or when
 * only same-browser tabs can play.
 */
function inviteUrl(code: string, transport: "online" | "local"): string | null {
  if (transport !== "online" || onClaudePage()) return null;
  return `${location.origin}${location.pathname}#join-${code}`;
}

function siteHint(transport: "online" | "local"): string {
  if (transport === "local") return "This copy can only link tabs in this browser.";
  const host = location.hostname;
  if (onClaudePage()) return "You both need to be on this same claude.ai page.";
  return `You both need to be on ${host}.`;
}

function setHash(h: string) {
  try {
    history.replaceState(null, "", `#${h}`);
  } catch {
    /* ignore */
  }
}

function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "not_permitted") return "Your access to this page doesn't allow online games. Ask the owner to share it with you.";
  if (code === "limit_reached") return "Too many games are open right now. Try again in a moment.";
  return "Couldn't connect to the game room. Check your connection and try again.";
}

function OnlineGame({ session, onLeave }: { session: AnySession; onLeave: () => void }) {
  const s = useSyncExternalStore(session.subscribe, session.getState);
  const [copied, setCopied] = useState(false);
  const host = session instanceof HostSession;

  const invite = inviteUrl(s.code, s.transport);
  const [shared, setShared] = useState("");
  const share = async () => {
    if (!invite) return;
    const text = `Join my Card Duel game! Code: ${s.code}`;
    // Phones: the share menu (Messages, WhatsApp...). Elsewhere: copy the link.
    if (navigator.share) {
      try {
        await navigator.share({ title: "Card Duel", text, url: invite });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return; // they closed the menu
      }
    }
    try {
      await navigator.clipboard.writeText(invite);
      setShared("Link copied. Paste it into a message.");
    } catch {
      const el = document.getElementById("invite-link");
      if (el) window.getSelection()?.selectAllChildren(el);
      setShared("Select the link and copy it.");
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(s.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      const el = document.getElementById("code-text");
      if (el) window.getSelection()?.selectAllChildren(el);
    });
  };

  const scoreChips: [JSX.Element, JSX.Element] | undefined = s.view
    ? ([0, 1].map((seat) => {
        const mine = seat === s.view!.you;
        return <span key={seat} className="seat-score" title="Games won">{mine ? s.score[0] : s.score[1]} won</span>;
      }) as [JSX.Element, JSX.Element])
    : undefined;

  let banner: string | null = null;
  if (!s.connected) banner = s.wasConnected ? "Reconnecting…" : "Connecting…";
  else if (s.status === "opponent-left") banner = host ? `${s.oppName} left. The game resumes if they rejoin with the code.` : `${s.oppName} left. Waiting for them to come back…`;
  else if (s.status === "full") banner = `This game already has two players.`;

  return (
    <section className="layout">
      <Stage>
        {banner && <div className="banner" role="status">{banner}</div>}
        {s.view ? (
          <Table
            view={s.view}
            busy={s.sending || !s.connected}
            onActions={(as) => session.actMany(as)}
            reactions={s.reactions}
            onReact={(id) => session.react(id)}
            seatExtra={scoreChips}
            status={s.sending && s.view.current === s.view.you ? "Sending…" : undefined}
            gameOverActions={host
              ? <button className="btn primary" onClick={() => (session as HostSession).newGame()}>Rematch</button>
              : <span className="help">Waiting for {s.oppName} to start a rematch…</span>}
          />
        ) : (
          <div className="table waiting">
            <div className="waiting-box">
              {host ? (
                <>
                  <p className="eyebrow">Your game code</p>
                  <button className="code" id="code-text" onClick={copy} title="Copy code">{s.code}</button>
                  {invite ? (
                    <>
                      <button className="btn primary share-btn" onClick={share}>Share invite link</button>
                      <p className="invite-link" id="invite-link">{invite}</p>
                      <p className="help">{shared || (copied ? "Code copied." : "Your friend opens the link and taps Join. Or they can type the code under Online.")}</p>
                    </>
                  ) : (
                    <p className="help">{copied ? "Copied." : "Tap the code to copy it."} Send it to your friend. They choose <b>Online</b>, then <b>Join</b>.</p>
                  )}
                  <p className="pulse">Waiting for an opponent…</p>
                  <p className="help">Keep this screen open and on: your device runs the game. {siteHint(s.transport)}</p>
                </>
              ) : s.status === "full" ? (
                <p>Someone else already took the seat in game <b>{s.code}</b>.</p>
              ) : (
                <>
                  <p className="eyebrow">Game {s.code}</p>
                  <p className="pulse">{s.status === "opponent-left" ? "The host left the game." : "Looking for the host…"}</p>
                  <p className="help">Check the code, and that the host still has the game open with the screen on. {siteHint(s.transport)}</p>
                </>
              )}
            </div>
          </div>
        )}
      </Stage>
      <aside className="side">
        <div className="panel">
          <h3>Online game</h3>
          <dl className="facts">
            <div><dt>Code</dt><dd><button className="linklike" onClick={copy}>{s.code}</button></dd></div>
            <div><dt>You</dt><dd>{s.myName} ({host ? "host" : "guest"})</dd></div>
            <div><dt>Opponent</dt><dd>{s.status === "waiting" ? "Not here yet" : s.oppName}</dd></div>
            <div><dt>Match</dt><dd className="num">{s.score[0]} – {s.score[1]}</dd></div>
            <div><dt>Connection</dt><dd><span className={"dot " + (s.connected ? "ok" : "bad")} />{s.connected ? (s.transport === "local" ? "This browser only" : "Online") : s.wasConnected ? "Reconnecting" : "Connecting"}</dd></div>
          </dl>
          <button className="btn wide" onClick={onLeave}>Leave game</button>
        </div>
        {s.view && (
          <div className="panel log-panel">
            <h3>Log</h3>
            <GameLog v={s.view} />
          </div>
        )}
      </aside>
    </section>
  );
}
