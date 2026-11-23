import { useRef, useState } from "react";
import { AGENT_NAMES, type AgentName } from "../engine/agents";
import { RANKS, cap, rankName } from "../engine/cards";
import type { Rules } from "../engine/engine";
import { type Summary, runMatch, summarize } from "../engine/simulate";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (x: number, d = 2) => x.toFixed(d);

export function SimPage({ rules }: { rules: Rules }) {
  const [p0, setP0] = useState<AgentName>("heuristic");
  const [p1, setP1] = useState<AgentName>("greedy");
  const [games, setGames] = useState(5000);
  const [seed, setSeed] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ s: Summary; secs: number; names: [string, string] } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    const n = Math.max(1, Math.min(100_000, Math.floor(games) || 1));
    abort.current = new AbortController();
    setProgress(0);
    const t0 = performance.now();
    const rs = await runMatch({ p0, p1, games: n, seed, rules, onProgress: setProgress, signal: abort.current.signal });
    setProgress(null);
    if (!rs.length) return;
    const names: [string, string] = p0 === p1 ? [`${cap(p0)} (P1)`, `${cap(p1)} (P2)`] : [cap(p0), cap(p1)];
    setResult({ s: summarize(rs), secs: (performance.now() - t0) / 1000, names });
  };

  return (
    <section className="sim">
      <div className="panel sim-form">
        <h3>Run a match</h3>
        <div className="grid2">
          <div className="field">
            <label htmlFor="s0">Player 1</label>
            <select id="s0" value={p0} onChange={(e) => setP0(e.target.value as AgentName)}>
              {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s1">Player 2</label>
            <select id="s1" value={p1} onChange={(e) => setP1(e.target.value as AgentName)}>
              {AGENT_NAMES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sg">Games</label>
            <input id="sg" type="number" min={1} max={100000} value={games} onChange={(e) => setGames(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="ss">Seed</label>
            <input id="ss" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </div>
        </div>
        {progress === null ? (
          <button className="btn primary wide" onClick={run}>Run simulation</button>
        ) : (
          <>
            <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemax={games}>
              <div style={{ width: `${(progress / games) * 100}%` }} />
            </div>
            <button className="btn wide" onClick={() => abort.current?.abort()}>Stop · {progress.toLocaleString()} games played</button>
          </>
        )}
        <p className="help">Players alternate going first. The same seed gives the same results. Uses the rule options below.</p>
      </div>
      <div className="sim-results">
        {result ? <Results {...result} /> : (
          <div className="empty">Pick two bots and run a match. You'll get win rates with confidence intervals, game length and which cards get played.</div>
        )}
      </div>
    </section>
  );
}

function Results({ s, secs, names }: { s: Summary; secs: number; names: [string, string] }) {
  const counts = s.turnHistogram.counts;
  const maxC = Math.max(...counts.map((c) => c[1]));
  const ranks = RANKS.filter((r) => s.byRank[0][r] || s.byRank[1][r]);
  const tile = (k: string, v: string, sub: string) => (
    <div className="tile"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{sub}</div></div>
  );
  return (
    <>
      <div className="panel">
        <div className="versus">
          <div><span className="who"><i className="key p0" />{names[0]}</span><span className="pct">{pct(s.winRate[0])}</span></div>
          <div className="right"><span className="who">{names[1]}<i className="key p1" /></span><span className="pct">{pct(s.winRate[1])}</span></div>
        </div>
        <div className="winbar">
          <div className="p0" style={{ width: `${s.winRate[0] * 100}%` }} />
          <div className="dr" style={{ width: `${(s.draws / s.games) * 100}%` }} />
          <div className="p1" style={{ width: `${s.winRate[1] * 100}%` }} />
        </div>
        <div className="ci">
          <span>95% CI {pct(s.winCi[0][0])}–{pct(s.winCi[0][1])}</span>
          <span>{s.games.toLocaleString()} games · {secs.toFixed(1)}s{s.draws ? ` · ${s.draws} draws` : ""}</span>
          <span>95% CI {pct(s.winCi[1][0])}–{pct(s.winCi[1][1])}</span>
        </div>
      </div>
      <div className="tiles">
        {tile("First player wins", pct(s.firstPlayerRate), `95% CI ${pct(s.firstPlayerCi[0])}–${pct(s.firstPlayerCi[1])}`)}
        {tile("Turns per game", num(s.turnsMean, 1), `median ${s.turnsMedian} · max ${s.turnsMax}`)}
        {tile("Points per win", `${Math.round(s.pointsPerWin[0])} / ${Math.round(s.pointsPerWin[1])}`, `${names[0]} / ${names[1]}`)}
        {tile("Cards drawn per game", `${num(s.perGame.cardsDrawn[0], 1)} / ${num(s.perGame.cardsDrawn[1], 1)}`, `${names[0]} / ${names[1]}`)}
        {tile("Challenges per game", `${num(s.perGame.challenges[0])} / ${num(s.perGame.challenges[1])}`, `won ${num(s.perGame.challengesWon[0])} / ${num(s.perGame.challengesWon[1])}`)}
        {tile("Stacked draw cards per game", `${num(s.perGame.stacks[0])} / ${num(s.perGame.stacks[1])}`, `extra same-rank cards ${num(s.perGame.extraCards[0])} / ${num(s.perGame.extraCards[1])}`)}
        {tile("Illegal Wild Draw Fours", `${num(s.perGame.wd4Illegal[0])} / ${num(s.perGame.wd4Illegal[1])}`, `per game · ${num(s.reshuffles, 3)} reshuffles`)}
      </div>
      <div className="panel">
        <h3>Game length in turns</h3>
        <div className="hist">
          {counts.map(([b, c]) => (
            <div key={b} style={{ height: `${(c / maxC) * 100}%` }} title={`${b}–${b + s.turnHistogram.bucket - 1} turns: ${c} games`} />
          ))}
        </div>
        <div className="hist-axis"><span>{counts[0]?.[0] ?? 0}</span><span>{(counts.at(-1)?.[0] ?? 0) + s.turnHistogram.bucket}</span></div>
      </div>
      <div className="panel">
        <h3>Cards played per game</h3>
        <div className="table-scroll">
          <table className="ranks">
            <thead><tr><th>Card</th><th>{names[0]}</th><th>{names[1]}</th></tr></thead>
            <tbody>
              {ranks.map((r) => (
                <tr key={r}><td>{rankName(r)}</td><td>{num(s.byRank[0][r] ?? 0)}</td><td>{num(s.byRank[1][r] ?? 0)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
