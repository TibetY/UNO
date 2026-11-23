"use strict";

const $ = (id) => document.getElementById(id);
const COLOR_ORDER = ["red", "yellow", "green", "blue", null];
const RANK_ORDER = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2","wild","wild4"];
const SYMBOL = { skip: "⊘", reverse: "⇄", draw2: "+2", wild: "", wild4: "+4" };
const CORNER = { skip: "⊘", reverse: "⇄", draw2: "+2", wild: "", wild4: "+4" };
const BOT_DELAY_PLAY = 750;

const ui = {
  view: "play",       // play | watch | sim
  state: null,
  agents: [],
  loopToken: 0,
  paused: false,
  prevHands: [null, null],
  prevDiscard: 0,
  pendingWild: null,  // card id waiting for a color choice
  busy: false,
};

/* ------------------------------------------------------------ api */
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ cards */
function cardLabel(c) {
  if (!c) return "";
  if (c.rank === "wild") return "Wild";
  if (c.rank === "wild4") return "Wild Draw Four";
  const r = { skip: "Skip", reverse: "Reverse", draw2: "Draw Two" }[c.rank] || c.rank;
  return `${cap(c.color)} ${r}`;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

function cardEl(card, opts = {}) {
  const el = document.createElement("div");
  const wild = card.color === null;
  el.className = "card " + (wild ? "wild" : "c-" + card.color);
  el.dataset.rank = card.rank;
  el.dataset.id = card.id;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", cardLabel(card));
  const sym = SYMBOL[card.rank] ?? card.rank;
  const corner = CORNER[card.rank] ?? card.rank;
  const face = document.createElement("div");
  face.className = "face";
  if (wild && card.rank === "wild") {
    face.innerHTML = `<span class="corner tl mini"></span><div class="emblem"><span></span></div><span class="corner br mini"></span>`;
  } else {
    face.innerHTML = `<span class="corner tl">${corner}</span><div class="emblem"><span>${sym}</span></div><span class="corner br">${corner}</span>`;
  }
  el.appendChild(face);
  if (opts.chosen) {
    el.dataset.chosen = opts.chosen;
    el.style.setProperty("--chosen", `var(--${opts.chosen})`);
  }
  return el;
}

function backEl() {
  const el = document.createElement("div");
  el.className = "card back";
  el.innerHTML = `<div class="face"><div class="emblem"><span>DUEL</span></div></div>`;
  return el;
}

function sortHand(hand) {
  return [...hand].sort((a, b) =>
    COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) ||
    RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
}

function fitHand(container, n, scale = 1) {
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) * scale;
  const avail = container.clientWidth - 24;
  let overlap = 6;
  if (n > 1 && n * cw + (n - 1) * 6 > avail) {
    overlap = Math.max((avail - cw) / (n - 1) - cw, -cw * 0.84);
  }
  container.style.setProperty("--overlap", `${overlap}px`);
}

/* ------------------------------------------------------------ names & log */
function playerName(p, s = ui.state) {
  if (!s) return "";
  if (s.human === p) return "You";
  const n = cap(s.players[p]);
  return s.human === null ? `P${p + 1} · ${n}` : n;
}

function describe(ev, s) {
  const who = ev.player === null ? "" : playerName(ev.player, s);
  switch (ev.event) {
    case "start_card": return { text: `Starting card: <b>${cardLabel(parseCard(ev.card))}</b>`, card: ev.card };
    case "play": {
      const c = parseCard(ev.card);
      const extra = c.color === null ? ` → <b>${ev.color}</b>` : "";
      return { text: `<b>${who}</b> played ${cardLabel(c)}${extra}`, card: ev.card, color: ev.color };
    }
    case "draw": return { text: `<b>${who}</b> drew ${ev.count} card${ev.count === 1 ? "" : "s"}` };
    case "pass": return { text: `<b>${who}</b> kept the card and passed` };
    case "challenge": return { text: `<b>${who}</b> challenged — ${ev.success ? "caught a bluff!" : "it was legal"}` };
    case "accept": return { text: `<b>${who}</b> accepted the Wild Draw Four` };
    case "reshuffle": return { text: `Discard pile reshuffled (${ev.size} cards)` };
    case "game_over":
      return { text: ev.player === null ? "Game ended in a draw" : `<b>${who}</b> won` };
    default: return null;
  }
}

function parseCard(str) {
  if (!str.includes(":")) return { rank: str, color: null, id: str };
  const [color, rank] = str.split(":");
  return { rank, color, id: str };
}

function renderLog(s) {
  const log = $("log");
  log.innerHTML = "";
  for (const ev of s.events) {
    const d = describe(ev, s);
    if (!d) continue;
    const li = document.createElement("li");
    const pip = document.createElement("span");
    pip.className = "pip";
    const color = d.color || (d.card && parseCard(d.card).color);
    pip.style.background = color ? `var(--${color})` : (d.card ? "var(--wild)" : "transparent");
    if (!d.card) pip.style.boxShadow = "none";
    li.appendChild(pip);
    const span = document.createElement("span");
    span.innerHTML = d.text;
    li.appendChild(span);
    log.prepend(li);
  }
}

/* ------------------------------------------------------------ render */
function render() {
  const s = ui.state;
  if (!s) return;
  const yourTurn = s.legal.length > 0;

  // seats (seat0 = bottom, seat1 = top)
  for (const p of [0, 1]) {
    $("name" + p).textContent = playerName(p);
    $("count" + p).textContent = s.hand_sizes[p];
    $("seat" + p).classList.toggle("active", s.winner === null && s.end_reason === null && s.current_player === p);
  }
  renderHand(0, s, yourTurn);
  renderHand(1, s, false);

  // draw pile
  const canDraw = s.legal.some((a) => a.type === "draw");
  $("deck").disabled = !canDraw;
  $("deck").classList.toggle("can-draw", canDraw);
  $("deckCount").textContent = `${s.draw_pile_size} in deck`;

  // discard pile: show the last few played cards fanned
  const discard = $("discard");
  const played = s.events.filter((e) => e.event === "play" || e.event === "start_card");
  const recent = played.slice(-4);
  discard.innerHTML = "";
  recent.forEach((ev, i) => {
    const c = parseCard(ev.card);
    const isTop = i === recent.length - 1;
    const el = cardEl(c, { chosen: c.color === null && isTop ? s.current_color : null });
    const rot = ((hash(ev.t + ev.card + i) % 25) - 12);
    el.style.transform = `rotate(${rot}deg)`;
    el.style.setProperty("--rot", `${rot}deg`);
    if (isTop) {
      el.classList.add("top");
      if (s.discard_size === ui.prevDiscard) el.style.animation = "none";
    }
    discard.appendChild(el);
  });
  ui.prevDiscard = s.discard_size;
  discard.style.setProperty("--ring", s.current_color ? `var(--${s.current_color})` : "rgba(255,255,255,.5)");
  $("colorLabel").textContent = s.current_color ? `${cap(s.current_color)} to play` : "Any color";

  renderStatus(s, yourTurn);
  renderActionBar(s);
  renderLog(s);

  // overlays
  $("challengeDlg").classList.toggle("hidden", !(yourTurn && s.phase === "challenge"));
  if (s.end_reason) showGameOver(s);
  else $("gameOver").classList.add("hidden");
}

function renderHand(p, s, yourTurn) {
  const container = $("hand" + p);
  const hand = s.hands[p];
  container.innerHTML = "";
  const prev = ui.prevHands[p];
  const prevCounts = {};
  if (prev) for (const c of prev) prevCounts[c.id] = (prevCounts[c.id] || 0) + 1;

  if (!hand) {
    for (let i = 0; i < s.hand_sizes[p]; i++) container.appendChild(backEl());
    fitHand(container, s.hand_sizes[p], 0.78);
    ui.prevHands[p] = null;
    return;
  }
  const playableIds = new Set(s.legal.filter((a) => a.type === "play").map((a) => a.card.id));
  let pendingMarked = false;
  for (const c of sortHand(hand)) {
    const el = cardEl(c);
    if (prev) {
      if (prevCounts[c.id]) prevCounts[c.id]--;
      else el.classList.add("fresh");
    }
    if (p === s.human && yourTurn) {
      if (playableIds.has(c.id)) {
        el.classList.add("playable");
        el.tabIndex = 0;
        el.addEventListener("click", () => onCardClick(c));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") onCardClick(c); });
      } else {
        el.classList.add("dim");
      }
    }
    if (s.pending_card && !pendingMarked && c.id === s.pending_card.id && p === s.current_player && s.phase === "drew") {
      el.classList.add("pending");
      pendingMarked = true;
    }
    container.appendChild(el);
  }
  fitHand(container, hand.length, p === 1 ? 0.78 : 1);
  ui.prevHands[p] = hand;
}

function renderStatus(s, yourTurn) {
  let msg = "";
  if (s.end_reason) msg = "";
  else if (yourTurn) {
    if (s.phase === "drew") msg = `You drew a ${cardLabel(s.pending_card)}. Play it or keep it.`;
    else if (s.phase === "challenge") msg = "Your opponent played a Wild Draw Four.";
    else msg = s.legal.some((a) => a.type === "play") ? "Your turn: pick a card, or draw." : "No playable cards. Draw from the deck.";
  } else if (s.bot_to_act) {
    msg = `${playerName(s.current_player)} is thinking…`;
    if (ui.view === "watch" && ui.paused) msg = "Paused";
  }
  $("status").textContent = msg;
}

function renderActionBar(s) {
  const bar = $("actionbar");
  bar.innerHTML = "";
  const pass = s.legal.find((a) => a.type === "pass");
  const draw = s.legal.find((a) => a.type === "draw");
  if (pass) bar.appendChild(button("Keep it · end turn", () => act(pass.i)));
  if (draw) bar.appendChild(button("Draw a card", () => act(draw.i)));
}

function button(text, fn, cls = "btn") {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", fn);
  return b;
}

function showGameOver(s) {
  const dlg = $("gameOver");
  const humanGame = s.human !== null;
  let title;
  if (s.winner === null) title = "Draw";
  else if (humanGame) title = s.winner === s.human ? "You win!" : `${playerName(s.winner)} wins`;
  else title = `${playerName(s.winner)} wins`;
  $("goTitle").textContent = title;
  const st = s.stats;
  const loser = s.winner === null ? null : 1 - s.winner;
  $("goText").innerHTML = s.winner === null
    ? `The turn limit was reached after ${s.turn} turns.`
    : `+${s.score} points from the cards left in ${humanGame && loser === s.human ? "your" : playerName(loser) + "'s"} hand · ${s.turn} turns<br>` +
      `<small>Cards drawn: ${playerName(0)} ${st.cards_drawn[0]} · ${playerName(1)} ${st.cards_drawn[1]}</small>`;
  const rev = $("goReveal");
  rev.innerHTML = "";
  if (loser !== null && s.hands[loser]) for (const c of sortHand(s.hands[loser])) rev.appendChild(cardEl(c));
  // in watch mode, auto-dismiss so the table stays visible while paused
  dlg.classList.remove("hidden");
}

function hash(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/* ------------------------------------------------------------ interaction */
function onCardClick(card) {
  if (ui.busy) return;
  const s = ui.state;
  const options = s.legal.filter((a) => a.type === "play" && a.card.id === card.id);
  if (!options.length) return;
  if (card.color === null) {
    ui.pendingWild = card.id;
    $("colorPicker").classList.remove("hidden");
    return;
  }
  act(options[0].i);
}

function chooseColor(color) {
  $("colorPicker").classList.add("hidden");
  const a = ui.state.legal.find((x) => x.type === "play" && x.card.id === ui.pendingWild && x.color === color);
  ui.pendingWild = null;
  if (a) act(a.i);
}

async function act(index) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    ui.state = await api(`/api/game/${ui.state.id}/action`, { index });
    render();
  } catch (e) {
    $("status").textContent = "Error: " + e.message;
  } finally {
    ui.busy = false;
  }
  runBots();
}

function botDelay() {
  if (ui.view !== "watch") return BOT_DELAY_PLAY;
  const v = Number($("speed").value); // 0 slow .. 100 fast
  return Math.round(1600 * Math.pow(1 - v / 100, 2)) + 30;
}

async function runBots() {
  const token = ++ui.loopToken;
  while (ui.state && ui.state.bot_to_act && token === ui.loopToken) {
    if (ui.view === "watch" && ui.paused) return;
    await sleep(botDelay());
    if (token !== ui.loopToken || (ui.view === "watch" && ui.paused)) return;
    await stepBot();
  }
}

async function stepBot() {
  try {
    ui.state = await api(`/api/game/${ui.state.id}/advance`, {});
    render();
  } catch (e) {
    $("status").textContent = "Error: " + e.message;
    ui.loopToken++;
  }
}

function rules() {
  return {
    hand_size: Number($("rHand").value) || 7,
    draw_until_playable: $("rDrawUntil").checked,
    play_drawn_card: !$("rNoPlayDrawn").checked,
    wd4_restricted: $("rWd4Restricted").checked,
    allow_wd4_challenge: !$("rNoChallenge").checked,
  };
}

async function newGame() {
  ui.loopToken++;
  ui.prevHands = [null, null];
  ui.prevDiscard = 0;
  ui.paused = false;
  $("btnPause").textContent = "Pause";
  $("gameOver").classList.add("hidden");
  $("colorPicker").classList.add("hidden");
  const body = {
    p0: ui.view === "watch" ? $("selP0").value : "human",
    p1: $("selP1").value,
    starter: $("selStarter").value,
    seed: $("inSeed").value,
    rules: rules(),
  };
  try {
    ui.state = await api("/api/game", body);
  } catch (e) {
    $("status").textContent = "Error: " + e.message;
    return;
  }
  $("seedNote").textContent = `Seed ${ui.state.seed}`;
  render();
  runBots();
}

function setView(view) {
  ui.view = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $("tableView").classList.toggle("hidden", view === "sim");
  $("simView").classList.toggle("hidden", view !== "sim");
  if (view === "sim") { ui.loopToken++; return; }
  const watch = view === "watch";
  $("fieldP0").classList.toggle("hidden", !watch);
  $("watchControls").classList.toggle("hidden", !watch);
  $("labP1").textContent = watch ? "Player 2" : "Opponent";
  $("optStart0").textContent = watch ? "Player 1" : "You";
  $("selStarter").options[2].textContent = watch ? "Player 2" : "Opponent";
  $("deck").title = watch ? "" : "Draw a card";
  newGame();
}

/* ------------------------------------------------------------ simulate */
async function runSim() {
  const btn = $("btnSim");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Running…`;
  const body = {
    p0: $("simP0").value, p1: $("simP1").value,
    games: Number($("simGames").value) || 1000, seed: Number($("simSeed").value) || 0,
    rules: rules(),
  };
  const t0 = performance.now();
  try {
    const s = await api("/api/simulate", body);
    renderSim(s, (performance.now() - t0) / 1000);
  } catch (e) {
    $("simResults").innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Run simulation";
  }
}

const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const num = (x, d = 2) => Number(x).toFixed(d);

function renderSim(s, secs) {
  const [a0, a1] = s.agents.map(cap);
  const label0 = a0 === a1 ? `${a0} (P1)` : a0;
  const label1 = a0 === a1 ? `${a1} (P2)` : a1;
  const drawRate = s.draws / s.games;
  const ranks = RANK_ORDER.filter((r) => s.played_by_rank_per_game.some((d) => d[r]));
  const counts = s.turns_histogram.counts;
  const maxC = Math.max(...counts.map((c) => c[1]));
  const lastBucket = counts.length ? counts[counts.length - 1][0] : 0;
  const rankName = (r) => ({ skip: "Skip", reverse: "Reverse", draw2: "Draw Two", wild: "Wild", wild4: "Wild Draw Four" }[r] || r);

  $("simResults").innerHTML = `
    <div class="panel">
      <div class="versus">
        <div><span class="who"><span class="legend"><i style="background:var(--blue)"></i>${label0}</span></span><span class="pct">${pct(s.win_rate[0])}</span></div>
        <div style="text-align:right"><span class="who"><span class="legend">${label1}<i style="background:var(--red)"></i></span></span><span class="pct">${pct(s.win_rate[1])}</span></div>
      </div>
      <div class="winbar">
        <div class="p0" style="width:${s.win_rate[0] * 100}%"></div>
        <div class="dr" style="width:${drawRate * 100}%"></div>
        <div class="p1" style="width:${s.win_rate[1] * 100}%"></div>
      </div>
      <div class="ci">
        <span>95% CI ${pct(s.win_rate_ci95[0][0])}–${pct(s.win_rate_ci95[0][1])}</span>
        <span>${s.games.toLocaleString()} games · ${secs.toFixed(1)}s${s.draws ? ` · ${s.draws} draws` : ""}</span>
        <span>95% CI ${pct(s.win_rate_ci95[1][0])}–${pct(s.win_rate_ci95[1][1])}</span>
      </div>
    </div>
    <div class="tiles">
      ${tile("First player wins", pct(s.first_player_win_rate), `CI ${pct(s.first_player_ci95[0])}–${pct(s.first_player_ci95[1])}`)}
      ${tile("Turns per game", num(s.turns_mean, 1), `median ${s.turns_median} · max ${s.turns_max}`)}
      ${tile("Avg points per win", `${Math.round(s.points_mean_when_won[0])} / ${Math.round(s.points_mean_when_won[1])}`, `${label0} / ${label1}`)}
      ${tile("Cards drawn / game", `${num(s.cards_drawn_per_game[0], 1)} / ${num(s.cards_drawn_per_game[1], 1)}`, `${label0} / ${label1}`)}
      ${tile("Challenges / game", `${num(s.challenges_per_game[0])} / ${num(s.challenges_per_game[1])}`, `won ${num(s.challenges_won_per_game[0])} / ${num(s.challenges_won_per_game[1])}`)}
      ${tile("Illegal Wild Draw Fours / game", `${num(s.wd4_illegal_per_game[0])} / ${num(s.wd4_illegal_per_game[1])}`, `reshuffles ${num(s.reshuffles_per_game, 3)} / game`)}
    </div>
    <div class="panel">
      <h3>Game length (turns)</h3>
      <div class="hist">${counts.map(([b, c]) => `<div style="height:${(c / maxC) * 100}%" title="${b}–${b + s.turns_histogram.bucket - 1} turns: ${c} games"></div>`).join("")}</div>
      <div class="hist-axis"><span>${counts.length ? counts[0][0] : 0}</span><span>${lastBucket + s.turns_histogram.bucket}</span></div>
    </div>
    <div class="panel">
      <h3>Cards played per game</h3>
      <table class="ranks">
        <thead><tr><th>Card</th><th>${label0}</th><th>${label1}</th></tr></thead>
        <tbody>${ranks.map((r) => `<tr><td>${rankName(r)}</td><td>${num(s.played_by_rank_per_game[0][r] || 0)}</td><td>${num(s.played_by_rank_per_game[1][r] || 0)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function tile(k, v, sub) {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
}

/* ------------------------------------------------------------ init */
async function init() {
  const { agents } = await api("/api/agents");
  ui.agents = agents;
  const fill = (sel, def) => {
    sel.innerHTML = agents.map((a) => `<option value="${a}"${a === def ? " selected" : ""}>${cap(a)}</option>`).join("");
  };
  fill($("selP0"), "greedy");
  fill($("selP1"), "heuristic");
  fill($("simP0"), "heuristic");
  fill($("simP1"), "greedy");

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $("btnNew").addEventListener("click", newGame);
  $("btnAgain").addEventListener("click", newGame);
  $("deck").addEventListener("click", () => {
    const d = ui.state && ui.state.legal.find((a) => a.type === "draw");
    if (d) act(d.i);
  });
  document.querySelectorAll(".swatch").forEach((b) => b.addEventListener("click", () => chooseColor(b.dataset.color)));
  $("cancelColor").addEventListener("click", () => { $("colorPicker").classList.add("hidden"); ui.pendingWild = null; });
  $("btnChallenge").addEventListener("click", () => act(ui.state.legal.find((a) => a.type === "challenge").i));
  $("btnAccept").addEventListener("click", () => act(ui.state.legal.find((a) => a.type === "accept").i));
  $("btnPause").addEventListener("click", () => {
    ui.paused = !ui.paused;
    $("btnPause").textContent = ui.paused ? "Resume" : "Pause";
    render();
    if (!ui.paused) runBots();
  });
  $("btnStep").addEventListener("click", async () => {
    if (!ui.state || !ui.state.bot_to_act) return;
    ui.paused = true;
    ui.loopToken++;
    $("btnPause").textContent = "Resume";
    await stepBot();
  });
  $("btnSim").addEventListener("click", runSim);
  window.addEventListener("resize", () => ui.state && render());
  setView("play");
}

init().catch((e) => { $("status").textContent = "Could not reach the server: " + e.message; });
