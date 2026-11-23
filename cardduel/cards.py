"""Card definitions and deck construction."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class Color(str, Enum):
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"
    BLUE = "blue"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.value


COLORS = (Color.RED, Color.YELLOW, Color.GREEN, Color.BLUE)


class Rank(str, Enum):
    ZERO = "0"
    ONE = "1"
    TWO = "2"
    THREE = "3"
    FOUR = "4"
    FIVE = "5"
    SIX = "6"
    SEVEN = "7"
    EIGHT = "8"
    NINE = "9"
    SKIP = "skip"
    REVERSE = "reverse"
    DRAW_TWO = "draw2"
    WILD = "wild"
    WILD_DRAW_FOUR = "wild4"

    @property
    def is_number(self) -> bool:
        return self.value.isdigit()

    @property
    def is_wild(self) -> bool:
        return self in (Rank.WILD, Rank.WILD_DRAW_FOUR)

    @property
    def is_action(self) -> bool:
        return not self.is_number

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.value


NUMBER_RANKS = tuple(r for r in Rank if r.is_number)
COLORED_ACTION_RANKS = (Rank.SKIP, Rank.REVERSE, Rank.DRAW_TWO)


@dataclass(frozen=True, order=True)
class Card:
    """A card. Wild cards have ``color=None``."""

    rank: Rank
    color: Optional[Color] = None

    def __post_init__(self) -> None:
        if self.rank.is_wild and self.color is not None:
            raise ValueError("wild cards have no color")
        if not self.rank.is_wild and self.color is None:
            raise ValueError("non-wild cards need a color")

    @property
    def points(self) -> int:
        if self.rank.is_number:
            return int(self.rank.value)
        if self.rank.is_wild:
            return 50
        return 20

    def matches(self, top: "Card", current_color: Optional[Color]) -> bool:
        """Whether this card may legally be played on ``top``.

        ``current_color`` is the active color (it differs from ``top.color``
        after a wild). ``None`` means any color is acceptable (wild opening card).
        """
        if self.rank.is_wild:
            return True
        if current_color is None:
            return True
        return self.color == current_color or self.rank == top.rank

    def short(self) -> str:
        if self.rank.is_wild:
            return self.rank.value.upper()
        return f"{self.color.value[0].upper()}{self.rank.value}"

    def to_str(self) -> str:
        if self.rank.is_wild:
            return self.rank.value
        return f"{self.color.value}:{self.rank.value}"

    @classmethod
    def from_str(cls, s: str) -> "Card":
        if ":" in s:
            color, rank = s.split(":", 1)
            return cls(Rank(rank), Color(color))
        return cls(Rank(s))

    def __str__(self) -> str:
        return self.to_str()


def build_deck() -> List[Card]:
    """Standard 108-card deck.

    Per color: one 0, two each of 1-9, two each of skip/reverse/draw2 (25 cards).
    Plus 4 wild and 4 wild-draw-four.
    """
    deck: List[Card] = []
    for color in COLORS:
        deck.append(Card(Rank.ZERO, color))
        for rank in NUMBER_RANKS[1:] + COLORED_ACTION_RANKS:
            deck.append(Card(rank, color))
            deck.append(Card(rank, color))
    deck.extend(Card(Rank.WILD) for _ in range(4))
    deck.extend(Card(Rank.WILD_DRAW_FOUR) for _ in range(4))
    return deck
