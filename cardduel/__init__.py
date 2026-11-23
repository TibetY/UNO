"""Two-player color-matching shedding card game engine for simulation and bots."""
from .cards import COLORS, Card, Color, Rank, build_deck
from .engine import Action, ActionType, Game, IllegalAction, Observation, Phase, Rules
from .agents import AGENTS, Agent, CallableAgent, GreedyAgent, HeuristicAgent, RandomAgent, make_agent
from .simulate import format_summary, play_game, run_match, summarize

__all__ = [
    "COLORS", "Card", "Color", "Rank", "build_deck",
    "Action", "ActionType", "Game", "IllegalAction", "Observation", "Phase", "Rules",
    "AGENTS", "Agent", "CallableAgent", "GreedyAgent", "HeuristicAgent", "RandomAgent", "make_agent",
    "format_summary", "play_game", "run_match", "summarize",
]
