import { useEffect, useState } from "react";
import { HOUSE_RULES, type Rules } from "./engine/engine";
import { OnlinePage } from "./components/OnlinePage";
import { PlayPage } from "./components/PlayPage";
import { SimPage } from "./components/SimPage";
import { WatchPage } from "./components/WatchPage";
import { type RoomProvider, artifactRoomProvider, localRoomProvider } from "./online/transport";
import { load, save } from "./storage";

type View = "play" | "online" | "watch" | "sim";
const TABS: { id: View; label: string }[] = [
  { id: "play", label: "Play a bot" },
  { id: "online", label: "Online" },
  { id: "watch", label: "Watch bots" },
  { id: "sim", label: "Simulate" },
];

function readHash(): { view: View; code: string } {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("join-")) return { view: "online", code: h.slice(5).replace(/[^a-z0-9]/g, "") };
  if (TABS.some((t) => t.id === h)) return { view: h as View, code: "" };
  return { view: "play", code: "" };
}

export function App() {
  const [{ view, code }, setRoute] = useState(readHash);
  const [rules, setRules] = useState<Rules>(() => load("rules", HOUSE_RULES));
  const [provider, setProvider] = useState<RoomProvider | null>(null);

  useEffect(() => {
    let alive = true;
    artifactRoomProvider().then((p) => alive && setProvider(p ?? localRoomProvider));
    const onHash = () => {
      const next = readHash();
      // Ignore our own replaceState updates while a game is open.
      if (next.view !== view || next.code) setRoute(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      alive = false;
      window.removeEventListener("hashchange", onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (v: View) => {
    setRoute((r) => ({ ...r, view: v }));
    if (v !== "online" || !location.hash.startsWith("#join-")) {
      try { history.replaceState(null, "", `#${v}`); } catch { /* ignore */ }
    }
  };
  const updateRules = (patch: Partial<Rules>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    save("rules", next);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="brand-name">Card Duel</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={view === t.id} className={"tab" + (view === t.id ? " active" : "")} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <div id="page-play" hidden={view !== "play"}><PlayPage rules={rules} /></div>
        <div id="page-online" hidden={view !== "online"}><OnlinePage provider={provider} rules={rules} initialCode={code} /></div>
        <div id="page-watch" hidden={view !== "watch"}><WatchPage rules={rules} active={view === "watch"} /></div>
        <div id="page-sim" hidden={view !== "sim"}><SimPage rules={rules} /></div>
        <RulesPanel rules={rules} onChange={updateRules} />
      </main>
    </>
  );
}

function RulesPanel({ rules, onChange }: { rules: Rules; onChange: (p: Partial<Rules>) => void }) {
  return (
    <details className="panel rules">
      <summary>Rule options <small>apply to new games</small></summary>
      <div className="rules-grid">
        <label className="check"><input type="checkbox" checked={rules.multiPlay} onChange={(e) => onChange({ multiPlay: e.target.checked })} /> Play several of the same number or symbol in one turn</label>
        <label className="check"><input type="checkbox" checked={rules.stackDraws} onChange={(e) => onChange({ stackDraws: e.target.checked })} /> Stack +2 on +2, or +4 on +4, to pass the penalty on</label>
        <label className="check"><input type="checkbox" checked={rules.numberFinish} onChange={(e) => onChange({ numberFinish: e.target.checked })} /> You can only go out on a number card</label>
        <label className="check"><input type="checkbox" checked={rules.drawUntilPlayable} onChange={(e) => onChange({ drawUntilPlayable: e.target.checked })} /> Draw until you get a playable card</label>
        <label className="check"><input type="checkbox" checked={!rules.playDrawnCard} onChange={(e) => onChange({ playDrawnCard: !e.target.checked })} /> A drawn card can't be played the same turn</label>
        <label className="check"><input type="checkbox" checked={rules.wd4Restricted} onChange={(e) => onChange({ wd4Restricted: e.target.checked })} /> Wild Draw Four only when you can't follow the color</label>
        <label className="check"><input type="checkbox" checked={!rules.allowWd4Challenge} onChange={(e) => onChange({ allowWd4Challenge: !e.target.checked })} /> No Wild Draw Four challenges</label>
        <label className="check">Hand size
          <input type="number" min={1} max={20} value={rules.handSize} onChange={(e) => onChange({ handSize: Math.max(1, Math.min(20, Number(e.target.value) || 7)) })} />
        </label>
      </div>
    </details>
  );
}
