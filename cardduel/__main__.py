"""Command-line interface.

    python -m cardduel simulate --p0 heuristic --p1 random --games 10000
    python -m cardduel tournament --games 2000
    python -m cardduel play --opponent heuristic
    python -m cardduel serve --port 8000
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
import time

from .agents import AGENTS, Agent, make_agent
from .engine import Phase, Rules
from .simulate import CSV_FIELDS, format_summary, play_game, run_match, summarize, to_csv_row


def _rules(args) -> Rules:
    return Rules(
        hand_size=args.hand_size,
        play_drawn_card=not args.no_play_drawn,
        draw_until_playable=args.draw_until_playable,
        wd4_restricted=args.wd4_restricted,
        allow_wd4_challenge=not args.no_challenge,
        max_turns=args.max_turns,
    )


def cmd_simulate(args) -> None:
    t0 = time.time()
    results = run_match(args.p0, args.p1, games=args.games, seed=args.seed,
                        rules=_rules(args), workers=args.workers,
                        keep_events=args.events)
    collected = []
    jf = open(args.jsonl, "w") if args.jsonl else None
    cf = open(args.csv, "w", newline="") if args.csv else None
    cw = csv.writer(cf) if cf else None
    if cw:
        cw.writerow(CSV_FIELDS)
    try:
        for r in results:
            if jf:
                jf.write(json.dumps(r) + "\n")
            if cw:
                cw.writerow(to_csv_row(r))
            r.pop("events", None)
            collected.append(r)
    finally:
        for f in (jf, cf):
            if f:
                f.close()
    s = summarize(collected)
    print(format_summary(s))
    print(f"Elapsed:             {time.time() - t0:.1f}s")
    if args.summary_json:
        with open(args.summary_json, "w") as f:
            json.dump(s, f, indent=2)


def cmd_tournament(args) -> None:
    names = args.agents or sorted(AGENTS)
    rules = _rules(args)
    table = {}
    for a, b in itertools.combinations(names, 2):
        s = summarize(run_match(a, b, games=args.games, seed=args.seed, rules=rules,
                                workers=args.workers))
        table[(a, b)] = s["win_rate"][0]
        table[(b, a)] = s["win_rate"][1]
    w = max(len(n) for n in names) + 2
    print("Row agent's win rate vs column agent".ljust(w))
    print(" " * w + "".join(n.rjust(w) for n in names))
    for a in names:
        row = "".join(("-" if a == b else f"{table[(a, b)]:.1%}").rjust(w) for b in names)
        print(a.ljust(w) + row)


def describe(ev, me: int) -> str:
    who = "You" if ev["player"] == me else "Bot"
    k = ev["event"]
    if k == "start_card":
        return f"Starting card: {ev['card']}"
    if k == "play":
        extra = f" (color -> {ev['color']})" if ev["card"].startswith("wild") else ""
        return f"{who} played {ev['card']}{extra}"
    if k == "draw":
        return f"{who} drew {ev['count']} card(s)"
    if k == "pass":
        return f"{who} passed"
    if k == "challenge":
        return f"{who} challenged the Wild Draw Four: {'success' if ev['success'] else 'failed'}"
    if k == "accept":
        return f"{who} accepted the Wild Draw Four"
    if k == "reshuffle":
        return "Discard pile reshuffled into the draw pile"
    return ""


class HumanAgent(Agent):
    name = "human"

    def on_game_start(self, player, seed):
        super().on_game_start(player, seed)
        self._seen = 0

    def show_new_events(self, history):
        for ev in history[self._seen:]:
            line = describe(ev, self.player)
            if line:
                print("  " + line)
        self._seen = len(history)

    def act(self, obs, legal):
        self.show_new_events(obs.history)
        print()
        print(f"Top: {obs.top_card}   active color: "
              f"{obs.current_color.value if obs.current_color else 'any'}   "
              f"opponent cards: {obs.opponent_hand_size}   draw pile: {obs.draw_pile_size}")
        print("Your hand:", " ".join(c.short() for c in sorted(obs.hand)))
        if obs.phase is Phase.DREW:
            print(f"You drew {obs.pending_card}.")
        if obs.phase is Phase.CHALLENGE:
            print("Opponent played Wild Draw Four.")
        for i, a in enumerate(legal):
            print(f"  [{i}] {a}")
        while True:
            try:
                choice = input("> ").strip()
            except EOFError:
                sys.exit(0)
            if choice.isdigit() and int(choice) < len(legal):
                return legal[int(choice)]
            print("Enter the number of an option.")


def cmd_play(args) -> None:
    import random
    seed = args.seed if args.seed is not None else random.randrange(1 << 30)
    bot = make_agent(args.opponent)
    human = HumanAgent()
    g = play_game([human, bot], seed=seed, starter=0 if args.first else 1, rules=_rules(args))
    human.show_new_events(g.events)
    print()
    if g.winner == 0:
        print(f"You win! (+{g.score()} points)")
    elif g.winner == 1:
        print(f"{bot.name} wins (+{g.score()} points).")
    else:
        print("Draw (turn limit reached).")
    print(f"Seed: {seed}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="cardduel", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def rule_args(p):
        g = p.add_argument_group("rules")
        g.add_argument("--hand-size", type=int, default=7)
        g.add_argument("--no-play-drawn", action="store_true",
                       help="drawn card cannot be played the same turn")
        g.add_argument("--draw-until-playable", action="store_true")
        g.add_argument("--wd4-restricted", action="store_true",
                       help="forbid Wild Draw Four when holding the active color")
        g.add_argument("--no-challenge", action="store_true",
                       help="disable Wild Draw Four challenges")
        g.add_argument("--max-turns", type=int, default=1000)

    choices = sorted(AGENTS)
    p = sub.add_parser("simulate", help="run a match between two bots")
    p.add_argument("--p0", default="heuristic", choices=choices)
    p.add_argument("--p1", default="random", choices=choices)
    p.add_argument("--games", type=int, default=1000)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--workers", type=int, default=1)
    p.add_argument("--jsonl", help="write one JSON record per game")
    p.add_argument("--events", action="store_true", help="include full event log in --jsonl")
    p.add_argument("--csv", help="write one CSV row per game")
    p.add_argument("--summary-json", help="write the aggregate summary as JSON")
    rule_args(p)
    p.set_defaults(func=cmd_simulate)

    p = sub.add_parser("tournament", help="round-robin between bots")
    p.add_argument("--agents", nargs="*", choices=choices)
    p.add_argument("--games", type=int, default=1000)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--workers", type=int, default=1)
    rule_args(p)
    p.set_defaults(func=cmd_tournament)

    p = sub.add_parser("play", help="play against a bot in the terminal")
    p.add_argument("--opponent", default="heuristic", choices=choices)
    p.add_argument("--seed", type=int)
    p.add_argument("--first", action="store_true", help="you go first")
    rule_args(p)
    p.set_defaults(func=cmd_play)

    p = sub.add_parser("serve", help="run the web app")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=lambda a: __import__("cardduel.server", fromlist=["serve"]).serve(a.host, a.port))

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
