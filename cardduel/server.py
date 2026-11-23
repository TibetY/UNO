"""Web server: JSON API over the engine plus the static frontend (stdlib only).

    python -m cardduel serve --port 8000
"""
from __future__ import annotations

import json
import os
import random
import threading
import uuid
from collections import OrderedDict
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

from .agents import AGENTS, Agent, make_agent
from .cards import Card
from .engine import Action, Game, Rules
from .simulate import run_match, summarize

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
MAX_GAMES = 500
MAX_SIM_GAMES = 50_000
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}


def card_json(c: Optional[Card]) -> Optional[Dict[str, Any]]:
    if c is None:
        return None
    return {"rank": c.rank.value, "color": c.color.value if c.color else None, "id": c.to_str()}


def action_json(i: int, a: Action) -> Dict[str, Any]:
    return {"i": i, "type": a.type.value, "card": card_json(a.card),
            "color": a.color.value if a.color else None, "label": str(a)}


def parse_rules(d: Optional[Dict[str, Any]]) -> Rules:
    defaults = Rules()
    kw = {}
    for k, v in (d or {}).items():
        if k in {f.name for f in fields(Rules)}:
            kw[k] = bool(v) if isinstance(getattr(defaults, k), bool) else int(v)
    r = Rules(**kw)
    r.hand_size = max(1, min(r.hand_size, 20))
    r.max_turns = max(10, min(r.max_turns, 5000))
    return r


class Session:
    """A live game. ``players[p]`` is an Agent, or None for a human seat."""

    def __init__(self, players: List[Optional[Agent]], seed: int, starter: int, rules: Rules):
        self.id = uuid.uuid4().hex[:12]
        self.players = players
        self.game = Game(seed=seed, starter=starter, rules=rules)
        for p, a in enumerate(players):
            if a is not None:
                a.on_game_start(p, seed * 2 + p + 1)
        self.lock = threading.Lock()
        self._ended = False

    @property
    def human(self) -> Optional[int]:
        for p, a in enumerate(self.players):
            if a is None:
                return p
        return None

    def bot_to_act(self) -> bool:
        g = self.game
        return not g.is_over and self.players[g.current_player] is not None

    def advance(self) -> None:
        """Let the bot whose turn it is take one action."""
        g = self.game
        if not self.bot_to_act():
            return
        p = g.current_player
        g.step(self.players[p].act(g.observation(p), g.legal_actions()))
        self._check_end()

    def human_act(self, index: int) -> None:
        g = self.game
        if g.is_over or self.players[g.current_player] is not None:
            raise ValueError("not your turn")
        legal = g.legal_actions()
        if not 0 <= index < len(legal):
            raise ValueError("invalid action index")
        g.step(legal[index])
        self._check_end()

    def _check_end(self) -> None:
        if self.game.is_over and not self._ended:
            self._ended = True
            res = self.game.result()
            for a in self.players:
                if a is not None:
                    a.on_game_end(res)

    def state(self) -> Dict[str, Any]:
        g = self.game
        human = self.human
        reveal = g.is_over or human is None
        hands = [[card_json(c) for c in h] if (reveal or p == human) else None
                 for p, h in enumerate(g.hands)]
        your_turn = human is not None and not g.is_over and g.current_player == human
        legal = [action_json(i, a) for i, a in enumerate(g.legal_actions())] if your_turn else []
        return {
            "id": self.id,
            "seed": g.seed,
            "players": [a.name if a else "you" for a in self.players],
            "human": human,
            "phase": g.phase.value,
            "current_player": g.current_player,
            "turn": g.turn,
            "hands": hands,
            "hand_sizes": [len(h) for h in g.hands],
            "top_card": card_json(g.top_card),
            "current_color": g.current_color.value if g.current_color else None,
            "draw_pile_size": len(g.draw_pile),
            "discard_size": len(g.discard),
            "pending_card": card_json(g.pending_card) if (your_turn or reveal) else None,
            "legal": legal,
            "bot_to_act": self.bot_to_act(),
            "winner": g.winner,
            "end_reason": g.end_reason,
            "score": g.score(),
            "events": g.events,
            "stats": g.result() if g.is_over else None,
        }


class Store:
    def __init__(self) -> None:
        self.sessions: "OrderedDict[str, Session]" = OrderedDict()
        self.lock = threading.Lock()

    def add(self, s: Session) -> None:
        with self.lock:
            self.sessions[s.id] = s
            while len(self.sessions) > MAX_GAMES:
                self.sessions.popitem(last=False)

    def get(self, sid: str) -> Session:
        with self.lock:
            s = self.sessions.get(sid)
            if s is None:
                raise KeyError("unknown game")
            self.sessions.move_to_end(sid)
            return s


STORE = Store()


def _agent_or_human(name: str) -> Optional[Agent]:
    return None if name == "human" else make_agent(name)


def api_new_game(body: Dict[str, Any]) -> Dict[str, Any]:
    p0 = body.get("p0", "human")
    p1 = body.get("p1", "heuristic")
    if p1 == "human":
        raise ValueError("only seat 0 can be human")
    seed = body.get("seed")
    seed = int(seed) if seed not in (None, "") else random.randrange(1 << 30)
    starter = body.get("starter")
    starter = int(starter) if starter in (0, 1, "0", "1") else random.randrange(2)
    s = Session([_agent_or_human(p0), _agent_or_human(p1)], seed, starter, parse_rules(body.get("rules")))
    STORE.add(s)
    return s.state()


def api_simulate(body: Dict[str, Any]) -> Dict[str, Any]:
    games = max(1, min(int(body.get("games", 1000)), MAX_SIM_GAMES))
    p0, p1 = body.get("p0", "heuristic"), body.get("p1", "greedy")
    for n in (p0, p1):
        if n not in AGENTS:
            raise ValueError(f"unknown agent {n}")
    workers = min(os.cpu_count() or 1, 8) if games >= 2000 else 1
    results = list(run_match(p0, p1, games=games, seed=int(body.get("seed", 0)),
                             rules=parse_rules(body.get("rules")), workers=workers))
    s = summarize(results)
    # Distribution data for charts.
    turns = [r["turns"] for r in results]
    bucket = 10
    hist: Dict[int, int] = {}
    for t in turns:
        hist[t // bucket * bucket] = hist.get(t // bucket * bucket, 0) + 1
    s["turns_histogram"] = {"bucket": bucket, "counts": sorted(hist.items())}
    margins = [r["points"] if r["winner"] == 0 else -r["points"] for r in results if r["winner"] is not None]
    s["points_mean_when_won"] = [
        (sum(r["points"] for r in results if r["winner"] == p) / max(1, s["wins"][p])) for p in (0, 1)]
    s["net_points_per_game_p0"] = sum(margins) / len(results)
    return s


class Handler(BaseHTTPRequestHandler):
    server_version = "cardduel"

    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get("CARDDUEL_LOG"):
            super().log_message(fmt, *args)

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: Any) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _body(self) -> Dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/agents":
            return self._json(200, {"agents": sorted(AGENTS)})
        if path.startswith("/api/game/"):
            try:
                s = STORE.get(path.split("/")[3])
            except KeyError as e:
                return self._json(404, {"error": str(e)})
            with s.lock:
                return self._json(200, s.state())
        name = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.realpath(os.path.join(WEB_DIR, name))
        if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, CONTENT_TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        parts = path.strip("/").split("/")
        try:
            body = self._body()
            if path == "/api/game":
                return self._json(200, api_new_game(body))
            if path == "/api/simulate":
                return self._json(200, api_simulate(body))
            if len(parts) == 4 and parts[:2] == ["api", "game"]:
                s = STORE.get(parts[2])
                with s.lock:
                    if parts[3] == "action":
                        s.human_act(int(body["index"]))
                    elif parts[3] == "advance":
                        s.advance()
                    else:
                        return self._json(404, {"error": "unknown endpoint"})
                    return self._json(200, s.state())
            return self._json(404, {"error": "unknown endpoint"})
        except KeyError as e:
            return self._json(404, {"error": str(e)})
        except (ValueError, TypeError) as e:
            return self._json(400, {"error": str(e)})


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"cardduel running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
