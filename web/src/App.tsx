import { useEffect, useState } from "react";
import { HOUSE_RULES, OG_RULES, type Rules } from "./engine/engine";
import { Card, CustomCardContext, customEffect } from "./components/Card";
import { OnlinePage } from "./components/OnlinePage";
import { PlayPage } from "./components/PlayPage";
import { SimPage } from "./components/SimPage";
import { WatchPage } from "./components/WatchPage";
import { type RoomProvider, artifactRoomProvider, localRoomProvider } from "./online/transport";
import { pollRoomProvider } from "./online/poll";
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
    // claude.ai's room, else this site's relay function (Netlify), else tabs of this browser.
    (async () => (await artifactRoomProvider()) ?? (await pollRoomProvider()) ?? localRoomProvider)()
      .then((p) => alive && setProvider(p));
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
        <RulesPanel rules={rules} onChange={updateRules} onReplace={(r) => { setRules(r); save("rules", r); }} />
      </main>
    </>
  );
}

const RULE_SETS: { id: string; name: string; rules: Rules; blurb: string }[] = [
  { id: "c-house", name: "C House Rules", rules: HOUSE_RULES,
    blurb: "Play several of the same card at once, stack +2 on +2 and +4 on +4, finish only on a number, and 2 custom cards." },
  { id: "og", name: "OG", rules: OG_RULES, blurb: "The official rules." },
];

function sameRules(a: Rules, b: Rules) {
  return (Object.keys(b) as (keyof Rules)[]).every((k) => k === "maxTurns" || a[k] === b[k]);
}

function RulesPanel({ rules, onChange, onReplace }: {
  rules: Rules; onChange: (p: Partial<Rules>) => void; onReplace: (r: Rules) => void;
}) {
  const set = RULE_SETS.find((r) => sameRules(rules, r.rules));
  const num = (v: string, lo: number, hi: number, fallback: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v)) || (v === "0" ? 0 : fallback)));
  const preview = { customColor: rules.customColor, customSkip: rules.customSkip, customDraw: rules.customDraw };
  return (
    <details className="panel rules">
      <summary>Rules: <b>{set ? set.name : "Custom"}</b> <small>changes apply from the next game</small></summary>
      <div className="field rule-set">
        <label htmlFor="ruleset">Rule set</label>
        <select id="ruleset" value={set?.id ?? "custom"}
          onChange={(e) => { const r = RULE_SETS.find((x) => x.id === e.target.value); if (r) onReplace(r.rules); }}>
          {RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          {!set && <option value="custom">Custom (your changes)</option>}
        </select>
        <small className="help">{set ? set.blurb : "Your own mix. Pick a rule set to start over from it."}</small>
      </div>

      <h4>House rules</h4>
      <div className="rules-grid">
        <label className="check"><input type="checkbox" checked={rules.multiPlay} onChange={(e) => onChange({ multiPlay: e.target.checked })} /> Play several of the same number or symbol in one turn</label>
        <label className="check"><input type="checkbox" checked={rules.stackDraws} onChange={(e) => onChange({ stackDraws: e.target.checked })} /> Stack +2 on +2, or +4 on +4, to pass the penalty on</label>
        <label className="check"><input type="checkbox" checked={rules.numberFinish} onChange={(e) => onChange({ numberFinish: e.target.checked })} /> You can only go out on a number card</label>
      </div>

      <h4>Custom card</h4>
      <div className="custom-rules">
        <div className="custom-preview" aria-hidden="true">
          <CustomCardContext.Provider value={preview}><Card id="custom" /></CustomCardContext.Provider>
        </div>
        <div className="rules-grid">
          <label className="check">Custom cards in the deck
            <input type="number" min={0} max={8} value={rules.customCards} onChange={(e) => onChange({ customCards: num(e.target.value, 0, 8, 0) })} />
          </label>
          <label className="check">Opponent picks up
            <input type="number" min={0} max={20} value={rules.customDraw} onChange={(e) => onChange({ customDraw: num(e.target.value, 0, 20, 0) })} />
          </label>
          <label className="check"><input type="checkbox" checked={rules.customColor} onChange={(e) => onChange({ customColor: e.target.checked })} /> Player chooses the color</label>
          <label className="check"><input type="checkbox" checked={rules.customSkip} onChange={(e) => onChange({ customSkip: e.target.checked })} /> Player goes again (skip)</label>
          <p className="help">This card: {customEffect(preview)}. {rules.customCards === 0 ? "There are none in the deck right now." : `${rules.customCards} in the deck.`}</p>
        </div>
      </div>

      <h4>Other options</h4>
      <div className="rules-grid">
        <label className="check"><input type="checkbox" checked={rules.drawUntilPlayable} onChange={(e) => onChange({ drawUntilPlayable: e.target.checked })} /> Draw until you get a playable card</label>
        <label className="check"><input type="checkbox" checked={!rules.playDrawnCard} onChange={(e) => onChange({ playDrawnCard: !e.target.checked })} /> A drawn card can't be played the same turn</label>
        <label className="check"><input type="checkbox" checked={rules.wd4Restricted} onChange={(e) => onChange({ wd4Restricted: e.target.checked })} /> Wild Draw Four only when you can't follow the color</label>
        <label className="check"><input type="checkbox" checked={!rules.allowWd4Challenge} onChange={(e) => onChange({ allowWd4Challenge: !e.target.checked })} /> No Wild Draw Four challenges</label>
        <label className="check">Hand size
          <input type="number" min={1} max={20} value={rules.handSize} onChange={(e) => onChange({ handSize: num(e.target.value, 1, 20, 7) })} />
        </label>
      </div>
    </details>
  );
}
