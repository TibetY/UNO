"""Built-in bots. Implement :class:`Agent` to add your own."""
from __future__ import annotations

import random
from collections import Counter
from typing import Callable, Dict, List, Optional, Sequence

from .cards import COLORS, Card, Color, Rank
from .engine import Action, ActionType, Observation, Phase


class Agent:
    """Base class. Override :meth:`act`.

    ``on_game_start`` is called once per game with a seed so agents that use
    randomness stay reproducible.
    """

    name = "agent"

    def __init__(self) -> None:
        self.rng = random.Random()
        self.player = 0

    def on_game_start(self, player: int, seed: Optional[int]) -> None:
        self.player = player
        self.rng = random.Random(seed)

    def act(self, obs: Observation, legal: Sequence[Action]) -> Action:
        raise NotImplementedError

    def on_game_end(self, result: Dict) -> None:  # optional hook
        pass


class RandomAgent(Agent):
    """Uniformly random legal action."""

    name = "random"

    def act(self, obs, legal):
        return self.rng.choice(list(legal))


def _best_color(hand: Sequence[Card], rng: random.Random, allowed: Sequence[Color] = COLORS) -> Color:
    """The color we hold most of, among the colors we're allowed to pick."""
    counts = Counter(c.color for c in hand if c.color in allowed)
    if not counts:
        return rng.choice(list(allowed))
    top = max(counts.values())
    return rng.choice([c for c in allowed if counts.get(c, 0) == top])


def _allowed_colors(plays: Sequence[Action], card: Card) -> List[Color]:
    """Colors on offer for this card (must_change_color can rule one out)."""
    return [c for c in COLORS if any(a.card == card and a.color == c for a in plays)]


class GreedyAgent(Agent):
    """Always plays if it can (non-wild first, highest points first); never challenges."""

    name = "greedy"

    def act(self, obs, legal):
        plays = [a for a in legal if a.type is ActionType.PLAY]
        if obs.phase is Phase.RESPOND and not plays:
            return next(a for a in legal if a.type is ActionType.ACCEPT)
        if not plays:
            return legal[0]  # DRAW, PASS or DONE
        colored = [a for a in plays if not a.card.rank.is_colorless]
        if colored:
            return max(colored, key=lambda a: a.card.points)
        order = {Rank.WILD: 0, Rank.CUSTOM: 1, Rank.WILD_DRAW_FOUR: 2}  # prefer the plain wild
        wild = min(plays, key=lambda a: order[a.card.rank])
        color = _best_color([c for c in obs.hand if c != plays[0].card], self.rng,
                            _allowed_colors(plays, wild.card) or COLORS)
        if wild.color is None:  # a custom card that doesn't pick a color
            return wild
        return next(a for a in plays if a.card == wild.card and a.color == color)


class HeuristicAgent(Agent):
    """A reasonably strong hand-written strategy.

    * Keeps wilds as a last resort; only plays WD4 legally (avoids losing challenges).
    * Prefers cards of the color it holds most, so it keeps control of play.
    * Uses Skip/Reverse/Draw Two aggressively when the opponent is close to going out,
      and chains extra turns (2-player action cards give another turn).
    * Changes color away from what the opponent seems unable to play.
    * Challenges WD4 based on a running estimate of how often this opponent bluffs.
    """

    name = "heuristic"

    def __init__(self, challenge_threshold: float = 0.25) -> None:
        super().__init__()
        self.challenge_threshold = challenge_threshold
        self._ch_tries = 0
        self._ch_wins = 0

    # -- inference from the public log
    def _opp_weak_colors(self, obs: Observation) -> Counter:
        """Colors the opponent drew on (likely lacks them), recent events weigh more."""
        weak: Counter = Counter()
        color = None
        opp = 1 - obs.player
        for ev in obs.history:
            if ev["event"] == "play" and ev.get("color"):
                color = ev["color"]
                if ev["player"] == opp:
                    weak[color] = 0  # just showed they have it
            elif ev["event"] == "start_card" and ":" in ev["card"]:
                color = ev["card"].split(":")[0]
            elif ev["event"] == "draw" and ev.get("voluntary") and ev["player"] == opp and color:
                weak[color] += 1
        return weak

    def _choose_color(self, obs: Observation, exclude: Card, allowed: Sequence[Color] = COLORS) -> Color:
        hand = list(obs.hand)
        hand.remove(exclude)
        counts = Counter(c.color for c in hand if c.color is not None)
        weak = self._opp_weak_colors(obs)
        def score(col: Color) -> float:
            # Our own cards decide: pick the color we hold most of. Colors the
            # opponent seems to be out of (they drew on them) only break ties.
            return counts.get(col, 0) * 10 + min(weak.get(col.value, 0), 3) + self.rng.random() * 0.01
        return max(allowed, key=score)

    def act(self, obs, legal):
        plays = [a for a in legal if a.type is ActionType.PLAY]
        if obs.phase is Phase.RESPOND:
            # Stacking passes the penalty on: always worth it. Prefer a +2 over a +4.
            stack = next((a for a in plays if a.card.rank is not Rank.WILD_DRAW_FOUR), None) \
                or next(iter(plays), None)
            if stack is not None:
                if stack.color is None:
                    return stack
                col = self._choose_color(obs, stack.card, _allowed_colors(plays, stack.card))
                return next(a for a in plays if a.card == stack.card and a.color == col)
            if any(a.type is ActionType.CHALLENGE for a in legal):
                return self._challenge(obs, legal)
            return next(a for a in legal if a.type is ActionType.ACCEPT)
        if obs.phase is Phase.MULTI:
            # Dump extra copies, but keep spare wilds unless we're close to going out.
            if not plays:
                return next(a for a in legal if a.type is ActionType.DONE)
            nxt = plays[0]
            if not nxt.card.rank.is_colorless:
                return nxt
            if len(obs.hand) > 3 and obs.opponent_hand_size > 2:
                return next(a for a in legal if a.type is ActionType.DONE)
            if nxt.color is None:
                return nxt
            col = self._choose_color(obs, nxt.card, _allowed_colors(plays, nxt.card))
            return next(a for a in plays if a.card == nxt.card and a.color == col)
        if not plays:
            return legal[0]

        hand = list(obs.hand)
        multi = obs.rules.multi_play
        color_counts = Counter(c.color for c in hand if c.color is not None)
        opp_low = obs.opponent_hand_size <= 2
        has_current = obs.current_color is not None and color_counts.get(obs.current_color, 0) > 0

        def value(a: Action) -> float:
            c = a.card
            v = 0.0
            if c.rank is Rank.WILD_DRAW_FOUR:
                if has_current:
                    return -100.0  # illegal; risky against a challenger
                v = -30.0 + (60 if opp_low else 0)
            elif c.rank is Rank.WILD:
                v = -20.0 + (10 if opp_low else 0)
            elif c.rank is Rank.CUSTOM:
                # Hold it like a wild; a big pick-up is a finisher when they're low.
                v = -20.0 + ((40 if obs.rules.custom_draw > 0 else 10) if opp_low else 0)
            else:
                v += color_counts.get(c.color, 0) * 3  # stay in our strong color
                v += c.points * 0.1                   # dump high cards
                if multi:  # a rank we hold several of empties the hand faster
                    v += (sum(1 for h in hand if h.rank is c.rank) - 1) * 4
                if c.rank.is_action:
                    # extra turn: great if we can follow up, essential when opp is low
                    follow = sum(1 for h in hand if h != c and (h.color == c.color or h.rank.is_wild))
                    v += 4 + (15 if opp_low else 0) + (3 if follow else -2)
                    if c.rank is Rank.DRAW_TWO:
                        v += 2
            # Going out?
            if len(hand) == 1:
                v += 1000
            return v

        best = max(plays, key=lambda a: (value(a), self.rng.random()))
        if obs.phase is Phase.DREW and value(best) < -50:
            return next(a for a in legal if a.type is ActionType.PASS)
        if obs.phase is Phase.TURN and value(best) < -50:
            return next(a for a in legal if a.type is ActionType.DRAW)
        # When the only option is a wild and the hand is still big, drawing first
        # keeps the wild for later.
        if (obs.phase is Phase.TURN and best.card.rank.is_colorless
                and len(hand) > 4 and not opp_low):
            return next(a for a in legal if a.type is ActionType.DRAW)
        if best.card.rank.is_colorless and best.color is not None:
            col = self._choose_color(obs, best.card, _allowed_colors(plays, best.card))
            return next(a for a in plays if a.card == best.card and a.color == col)
        return best

    def on_game_end(self, result):
        # Learn how often challenging this opponent pays off (Beta posterior).
        p = self.player
        self._ch_tries += result["challenges"][p]
        self._ch_wins += result["challenges_won"][p]

    def _challenge(self, obs, legal):
        # Did the opponent recently draw on the color that was active before the WD4?
        prev_color = None
        for ev in reversed(obs.history[:-1]):
            if ev["event"] == "play" and ev.get("color"):
                prev_color = ev["color"]
                break
            if ev["event"] == "start_card" and ":" in ev["card"]:
                prev_color = ev["card"].split(":")[0]
                break
        weak = self._opp_weak_colors(obs)
        # Prior: bluffs are uncommon (Beta(1, 3)), updated with experience vs this opponent.
        p_illegal = (1 + self._ch_wins) / (4 + self._ch_tries)
        # Bigger hands are more likely to contain the color.
        p_illegal *= min(1.5, 0.5 + obs.opponent_hand_size / 8)
        if prev_color and weak.get(prev_color, 0) > 0:
            p_illegal *= 0.3
        # Success swings ~8 cards (they draw 4, we draw 0); failure costs 2 extra cards.
        want = p_illegal >= self.challenge_threshold
        t = ActionType.CHALLENGE if want else ActionType.ACCEPT
        return next(a for a in legal if a.type is t)


class CallableAgent(Agent):
    """Wrap a plain function ``f(obs, legal) -> Action`` as an agent."""

    def __init__(self, fn: Callable[[Observation, Sequence[Action]], Action], name: str = "callable"):
        super().__init__()
        self.fn = fn
        self.name = name

    def act(self, obs, legal):
        return self.fn(obs, legal)


AGENTS: Dict[str, Callable[[], Agent]] = {
    "random": RandomAgent,
    "greedy": GreedyAgent,
    "heuristic": HeuristicAgent,
}


def make_agent(name: str) -> Agent:
    try:
        return AGENTS[name]()
    except KeyError:
        raise ValueError(f"unknown agent {name!r}; choose from {sorted(AGENTS)}") from None
