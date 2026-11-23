"""Two-player rules engine.

The engine is a state machine driven by :meth:`Game.step`. At every decision
point :meth:`Game.legal_actions` lists exactly what the player to act may do,
and :meth:`Game.observation` gives that player's (imperfect-information) view.
This makes it easy to plug in scripted bots, search, or RL agents.

Two-player rule specifics (official rules):
  * Reverse acts like Skip: the player who played it goes again.
  * Skip / Draw Two / Wild Draw Four: the opponent loses their turn, so the
    player who played the card goes again.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .cards import COLORS, Card, Color, Rank, build_deck


class Phase(str, Enum):
    TURN = "turn"            # play a card or draw
    DREW = "drew"            # drew a playable card: play it or pass
    CHALLENGE = "challenge"  # opponent played Wild Draw Four: challenge or accept
    OVER = "over"


class ActionType(str, Enum):
    PLAY = "play"
    DRAW = "draw"
    PASS = "pass"
    CHALLENGE = "challenge"
    ACCEPT = "accept"


@dataclass(frozen=True)
class Action:
    type: ActionType
    card: Optional[Card] = None
    color: Optional[Color] = None  # declared color for wild cards

    def __str__(self) -> str:
        if self.type is ActionType.PLAY:
            s = f"play {self.card}"
            if self.color is not None and self.card.rank.is_wild:
                s += f" -> {self.color.value}"
            return s
        return self.type.value


DRAW = Action(ActionType.DRAW)
PASS = Action(ActionType.PASS)
CHALLENGE = Action(ActionType.CHALLENGE)
ACCEPT = Action(ActionType.ACCEPT)


@dataclass
class Rules:
    """Configurable rule options. Defaults follow the official rules."""

    hand_size: int = 7
    # After drawing, may the player immediately play the drawn card if legal?
    play_drawn_card: bool = True
    # House rule: keep drawing until a playable card appears.
    draw_until_playable: bool = False
    # Official: WD4 may only be played when you hold no card of the current
    # color, enforced through the challenge mechanism. If ``wd4_restricted`` is
    # True the engine simply forbids illegal WD4 plays (and challenges are moot).
    wd4_restricted: bool = False
    allow_wd4_challenge: bool = True
    # Safety valve against (extremely rare) endless games.
    max_turns: int = 1000


@dataclass
class Observation:
    """What the acting player can see."""

    player: int
    phase: Phase
    hand: Tuple[Card, ...]
    top_card: Card
    current_color: Optional[Color]
    opponent_hand_size: int
    draw_pile_size: int
    discard_pile: Tuple[Card, ...]
    pending_card: Optional[Card]   # card just drawn (Phase.DREW)
    turn: int
    history: Tuple[Dict[str, Any], ...]  # public event log (no hidden info)


@dataclass
class GameStats:
    cards_drawn: List[int] = field(default_factory=lambda: [0, 0])
    cards_played: List[int] = field(default_factory=lambda: [0, 0])
    draw_actions: List[int] = field(default_factory=lambda: [0, 0])
    passes: List[int] = field(default_factory=lambda: [0, 0])
    played_by_rank: List[Dict[str, int]] = field(default_factory=lambda: [{}, {}])
    challenges: List[int] = field(default_factory=lambda: [0, 0])
    challenges_won: List[int] = field(default_factory=lambda: [0, 0])
    wd4_illegal: List[int] = field(default_factory=lambda: [0, 0])
    reshuffles: int = 0


class IllegalAction(ValueError):
    pass


class Game:
    """A single two-player game."""

    def __init__(self, seed: Optional[int] = None, starter: int = 0,
                 rules: Optional[Rules] = None, record_events: bool = True):
        if starter not in (0, 1):
            raise ValueError("starter must be 0 or 1")
        self.rules = rules or Rules()
        self.seed = seed
        self.rng = random.Random(seed)
        self.starter = starter
        self.record_events = record_events

        self.hands: List[List[Card]] = [[], []]
        self.draw_pile: List[Card] = build_deck()
        self.rng.shuffle(self.draw_pile)
        self.discard: List[Card] = []
        self.current_color: Optional[Color] = None
        self.current_player = starter
        self.phase = Phase.TURN
        self.pending_card: Optional[Card] = None
        self.turn = 0
        self.winner: Optional[int] = None
        self.end_reason: Optional[str] = None
        self.events: List[Dict[str, Any]] = []
        self.stats = GameStats()
        # WD4 challenge context
        self._wd4_offender: Optional[int] = None
        self._wd4_was_illegal = False

        self._deal()

    # ------------------------------------------------------------------ setup
    def _deal(self) -> None:
        for _ in range(self.rules.hand_size):
            for p in (self.starter, 1 - self.starter):
                self.hands[p].append(self.draw_pile.pop())
        self._log("deal", player=None, hand_sizes=[len(h) for h in self.hands])

        # Flip the starting card; a Wild Draw Four goes back and we reshuffle.
        while True:
            card = self.draw_pile.pop()
            if card.rank is Rank.WILD_DRAW_FOUR:
                self.draw_pile.append(card)
                self.rng.shuffle(self.draw_pile)
                continue
            break
        self.discard.append(card)
        self.current_color = card.color  # None for a plain wild: starter picks freely
        self._log("start_card", player=None, card=card.to_str())

        p = self.starter
        if card.rank in (Rank.SKIP, Rank.REVERSE):
            self.current_player = 1 - p
        elif card.rank is Rank.DRAW_TWO:
            self._draw(p, 2)
            self.current_player = 1 - p
        else:
            self.current_player = p
        self._begin_turn()

    # ---------------------------------------------------------------- helpers
    @property
    def top_card(self) -> Card:
        return self.discard[-1]

    @property
    def is_over(self) -> bool:
        return self.phase is Phase.OVER

    def _log(self, kind: str, player: Optional[int], **data: Any) -> None:
        if self.record_events:
            self.events.append({"t": self.turn, "event": kind, "player": player, **data})

    def _refill(self) -> bool:
        """Reshuffle the discard pile (minus the top card) into the draw pile."""
        if self.draw_pile:
            return True
        if len(self.discard) <= 1:
            return False
        top = self.discard.pop()
        self.draw_pile = self.discard
        self.rng.shuffle(self.draw_pile)
        self.discard = [top]
        self.stats.reshuffles += 1
        self._log("reshuffle", player=None, size=len(self.draw_pile))
        return True

    def _draw_one(self, player: int) -> Optional[Card]:
        if not self._refill():
            return None
        card = self.draw_pile.pop()
        self.hands[player].append(card)
        self.stats.cards_drawn[player] += 1
        return card

    def _draw(self, player: int, n: int) -> List[Card]:
        drawn = []
        for _ in range(n):
            c = self._draw_one(player)
            if c is None:
                break
            drawn.append(c)
        self._log("draw", player=player, count=len(drawn))
        return drawn

    def _begin_turn(self) -> None:
        self.turn += 1
        self.phase = Phase.TURN
        self.pending_card = None
        if self.turn > self.rules.max_turns:
            self._finish(None, "max_turns")

    def _end_turn(self, next_player: int) -> None:
        self.current_player = next_player
        self._begin_turn()

    def _finish(self, winner: Optional[int], reason: str) -> None:
        self.phase = Phase.OVER
        self.winner = winner
        self.end_reason = reason
        self._log("game_over", player=winner, reason=reason)

    def playable(self, card: Card, player: Optional[int] = None) -> bool:
        if not card.matches(self.top_card, self.current_color):
            return False
        if card.rank is Rank.WILD_DRAW_FOUR and self.rules.wd4_restricted:
            p = self.current_player if player is None else player
            return not self._has_color(p)
        return True

    def _has_color(self, player: int) -> bool:
        if self.current_color is None:
            return False
        return any(c.color == self.current_color for c in self.hands[player])

    def _play_actions(self, card: Card) -> List[Action]:
        if card.rank.is_wild:
            return [Action(ActionType.PLAY, card, c) for c in COLORS]
        return [Action(ActionType.PLAY, card)]

    # ------------------------------------------------------------- public API
    def legal_actions(self) -> List[Action]:
        if self.phase is Phase.OVER:
            return []
        if self.phase is Phase.CHALLENGE:
            return [CHALLENGE, ACCEPT]
        if self.phase is Phase.DREW:
            return self._play_actions(self.pending_card) + [PASS]
        actions: List[Action] = []
        for card in sorted(set(self.hands[self.current_player])):
            if self.playable(card):
                actions.extend(self._play_actions(card))
        actions.append(DRAW)
        return actions

    def observation(self, player: Optional[int] = None) -> Observation:
        p = self.current_player if player is None else player
        return Observation(
            player=p,
            phase=self.phase,
            hand=tuple(self.hands[p]),
            top_card=self.top_card,
            current_color=self.current_color,
            opponent_hand_size=len(self.hands[1 - p]),
            draw_pile_size=len(self.draw_pile),
            discard_pile=tuple(self.discard),
            pending_card=self.pending_card if p == self.current_player else None,
            turn=self.turn,
            history=tuple(self.events),
        )

    def step(self, action: Action) -> None:
        if self.phase is Phase.OVER:
            raise IllegalAction("game is over")
        if action not in self.legal_actions():
            raise IllegalAction(f"illegal action {action} in phase {self.phase.value}")
        p = self.current_player

        if self.phase is Phase.CHALLENGE:
            self._resolve_challenge(p, action)
        elif action.type is ActionType.PLAY:
            self._play(p, action)
        elif action.type is ActionType.DRAW:
            self._do_draw(p)
        elif action.type is ActionType.PASS:
            self.stats.passes[p] += 1
            self._log("pass", player=p)
            self._end_turn(1 - p)

    # -------------------------------------------------------------- mechanics
    def _do_draw(self, p: int) -> None:
        self.stats.draw_actions[p] += 1
        drawn: List[Card] = []
        while True:
            c = self._draw_one(p)
            if c is None:
                break
            drawn.append(c)
            if not self.rules.draw_until_playable or self.playable(c, p):
                break
        self._log("draw", player=p, count=len(drawn), voluntary=True)
        last = drawn[-1] if drawn else None
        if last is not None and self.rules.play_drawn_card and self.playable(last, p):
            self.phase = Phase.DREW
            self.pending_card = last
        else:
            self._end_turn(1 - p)

    def _play(self, p: int, action: Action) -> None:
        card = action.card
        illegal_wd4 = card.rank is Rank.WILD_DRAW_FOUR and self._has_color(p)
        self.hands[p].remove(card)
        self.discard.append(card)
        self.current_color = action.color if card.rank.is_wild else card.color
        self.stats.cards_played[p] += 1
        rk = self.stats.played_by_rank[p]
        rk[card.rank.value] = rk.get(card.rank.value, 0) + 1
        if illegal_wd4:
            self.stats.wd4_illegal[p] += 1
        self._log("play", player=p, card=card.to_str(),
                  color=self.current_color.value if self.current_color else None)

        opp = 1 - p
        won = not self.hands[p]
        if card.rank in (Rank.SKIP, Rank.REVERSE):
            nxt = p
        elif card.rank is Rank.DRAW_TWO:
            self._draw(opp, 2)
            nxt = p
        elif card.rank is Rank.WILD_DRAW_FOUR:
            if self.rules.allow_wd4_challenge and not won:
                self._wd4_offender = p
                self._wd4_was_illegal = illegal_wd4
                self.current_player = opp
                self.phase = Phase.CHALLENGE
                self.pending_card = None
                return
            self._draw(opp, 4)
            nxt = p
        else:
            nxt = opp

        if won:
            self._finish(p, "out_of_cards")
        else:
            self._end_turn(nxt)

    def _resolve_challenge(self, victim: int, action: Action) -> None:
        offender = self._wd4_offender
        self._wd4_offender = None
        if action.type is ActionType.ACCEPT:
            self._log("accept", player=victim)
            self._draw(victim, 4)
            self._end_turn(offender)
            return
        self.stats.challenges[victim] += 1
        success = self._wd4_was_illegal
        self._log("challenge", player=victim, success=success,
                  # Revealing the offender's hand to the challenger is part of the
                  # official rule; we only log whether it succeeded.
                  )
        if success:
            self.stats.challenges_won[victim] += 1
            self._draw(offender, 4)
            self._end_turn(victim)
        else:
            self._draw(victim, 6)
            self._end_turn(offender)

    # ---------------------------------------------------------------- scoring
    def score(self) -> int:
        """Points earned by the winner (sum of the loser's hand)."""
        if self.winner is None:
            return 0
        return sum(c.points for c in self.hands[1 - self.winner])

    def result(self) -> Dict[str, Any]:
        s = self.stats
        return {
            "seed": self.seed,
            "starter": self.starter,
            "winner": self.winner,
            "end_reason": self.end_reason,
            "turns": self.turn,
            "points": self.score(),
            "final_hand_sizes": [len(h) for h in self.hands],
            "cards_drawn": list(s.cards_drawn),
            "cards_played": list(s.cards_played),
            "draw_actions": list(s.draw_actions),
            "passes": list(s.passes),
            "played_by_rank": [dict(d) for d in s.played_by_rank],
            "challenges": list(s.challenges),
            "challenges_won": list(s.challenges_won),
            "wd4_illegal": list(s.wd4_illegal),
            "reshuffles": s.reshuffles,
        }
