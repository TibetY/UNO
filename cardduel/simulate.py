"""Run many automated games and aggregate statistics."""
from __future__ import annotations

import json
import math
import statistics
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from typing import Callable, Dict, Iterable, Iterator, List, Optional, Sequence, Union

from .agents import Agent, make_agent
from .engine import Game, Rules

AgentSpec = Union[str, Callable[[], Agent]]


def _build(spec: AgentSpec) -> Agent:
    return make_agent(spec) if isinstance(spec, str) else spec()


def play_game(agents: Sequence[Agent], seed: Optional[int] = None, starter: int = 0,
              rules: Optional[Rules] = None, record_events: bool = True) -> Game:
    """Play one game to completion between two agent instances."""
    game = Game(seed=seed, starter=starter, rules=rules, record_events=record_events)
    for p, agent in enumerate(agents):
        agent.on_game_start(p, None if seed is None else seed * 2 + p + 1)
    while not game.is_over:
        p = game.current_player
        legal = game.legal_actions()
        action = agents[p].act(game.observation(p), legal)
        game.step(action)
    res = game.result()
    for agent in agents:
        agent.on_game_end(res)
    return game


def _run_chunk(args) -> List[Dict]:
    specs, seeds, rules_dict, keep_events, base_index = args
    rules = Rules(**rules_dict)
    agents = [_build(specs[0]), _build(specs[1])]
    out = []
    for i, seed in enumerate(seeds):
        idx = base_index + i
        starter = idx % 2  # alternate who goes first for fairness
        # HeuristicAgent reads the history, so events are always recorded.
        g = play_game(agents, seed=seed, starter=starter, rules=rules, record_events=True)
        r = g.result()
        r["game"] = idx
        r["agents"] = [agents[0].name, agents[1].name]
        if keep_events:
            r["events"] = g.events
        out.append(r)
    return out


def run_match(p0: AgentSpec, p1: AgentSpec, games: int = 1000, seed: int = 0,
              rules: Optional[Rules] = None, workers: int = 1,
              keep_events: bool = False, chunk_size: int = 250) -> Iterator[Dict]:
    """Yield one result dict per game. Reproducible for a given seed."""
    rules = rules or Rules()
    seeds = [seed * 1_000_003 + i for i in range(games)]
    chunks = [(
        (p0, p1), seeds[i:i + chunk_size], asdict(rules), keep_events, i,
    ) for i in range(0, games, chunk_size)]
    if workers <= 1:
        for c in chunks:
            yield from _run_chunk(c)
    else:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for res in ex.map(_run_chunk, chunks):
                yield from res


def _wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def summarize(results: Iterable[Dict]) -> Dict:
    results = list(results)
    n = len(results)
    if n == 0:
        return {"games": 0}
    names = results[0].get("agents", ["p0", "p1"])
    wins = Counter(r["winner"] for r in results)
    starter_wins = sum(1 for r in results if r["winner"] == r["starter"])
    decided = sum(1 for r in results if r["winner"] is not None)
    turns = [r["turns"] for r in results]
    summary: Dict = {
        "games": n,
        "agents": names,
        "wins": [wins.get(0, 0), wins.get(1, 0)],
        "draws": wins.get(None, 0),
        "win_rate": [wins.get(0, 0) / n, wins.get(1, 0) / n],
        "win_rate_ci95": [_wilson(wins.get(0, 0), n), _wilson(wins.get(1, 0), n)],
        "first_player_win_rate": starter_wins / decided if decided else 0.0,
        "first_player_ci95": _wilson(starter_wins, decided),
        "turns_mean": statistics.fmean(turns),
        "turns_median": statistics.median(turns),
        "turns_max": max(turns),
        "points_total": [sum(r["points"] for r in results if r["winner"] == p) for p in (0, 1)],
    }
    for key in ("cards_drawn", "cards_played", "draw_actions", "challenges",
                "challenges_won", "wd4_illegal"):
        summary[f"{key}_per_game"] = [sum(r[key][p] for r in results) / n for p in (0, 1)]
    summary["reshuffles_per_game"] = sum(r["reshuffles"] for r in results) / n
    by_rank = [Counter(), Counter()]
    for r in results:
        for p in (0, 1):
            by_rank[p].update(r["played_by_rank"][p])
    summary["played_by_rank_per_game"] = [
        {k: v / n for k, v in sorted(by_rank[p].items())} for p in (0, 1)]
    return summary


def format_summary(s: Dict) -> str:
    if not s.get("games"):
        return "no games"
    a0, a1 = s["agents"]
    lines = [
        f"Games played:        {s['games']}",
        f"P0 ({a0:>9}) wins:  {s['wins'][0]:>7}  {s['win_rate'][0]:6.1%}  "
        f"95% CI [{s['win_rate_ci95'][0][0]:.1%}, {s['win_rate_ci95'][0][1]:.1%}]",
        f"P1 ({a1:>9}) wins:  {s['wins'][1]:>7}  {s['win_rate'][1]:6.1%}  "
        f"95% CI [{s['win_rate_ci95'][1][0]:.1%}, {s['win_rate_ci95'][1][1]:.1%}]",
        f"Draws (turn cap):    {s['draws']}",
        f"First-player wins:   {s['first_player_win_rate']:.1%}  "
        f"95% CI [{s['first_player_ci95'][0]:.1%}, {s['first_player_ci95'][1]:.1%}]",
        f"Turns mean/med/max:  {s['turns_mean']:.1f} / {s['turns_median']:.0f} / {s['turns_max']}",
        f"Points scored:       {s['points_total'][0]} vs {s['points_total'][1]}",
        f"Cards drawn/game:    {s['cards_drawn_per_game'][0]:.2f} vs {s['cards_drawn_per_game'][1]:.2f}",
        f"Cards played/game:   {s['cards_played_per_game'][0]:.2f} vs {s['cards_played_per_game'][1]:.2f}",
        f"Challenges/game:     {s['challenges_per_game'][0]:.3f} vs {s['challenges_per_game'][1]:.3f}"
        f"  (won {s['challenges_won_per_game'][0]:.3f} vs {s['challenges_won_per_game'][1]:.3f})",
        f"Illegal WD4/game:    {s['wd4_illegal_per_game'][0]:.3f} vs {s['wd4_illegal_per_game'][1]:.3f}",
        f"Reshuffles/game:     {s['reshuffles_per_game']:.3f}",
    ]
    return "\n".join(lines)


def write_jsonl(results: Iterable[Dict], path: str) -> Iterator[Dict]:
    """Write results to a JSON Lines file while passing them through."""
    with open(path, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
            yield r


CSV_FIELDS = ["game", "seed", "starter", "winner", "end_reason", "turns", "points",
              "agent0", "agent1", "hand0", "hand1", "drawn0", "drawn1",
              "played0", "played1", "challenges0", "challenges1", "wd4_illegal0",
              "wd4_illegal1", "reshuffles"]


def to_csv_row(r: Dict) -> List:
    return [r.get("game"), r["seed"], r["starter"], r["winner"], r["end_reason"], r["turns"],
            r["points"], *r.get("agents", ["", ""]), *r["final_hand_sizes"], *r["cards_drawn"],
            *r["cards_played"], *r["challenges"], *r["wd4_illegal"], r["reshuffles"]]
