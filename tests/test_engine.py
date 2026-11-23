import unittest
from collections import Counter

from cardduel import (ActionType, Card, Color, Game, IllegalAction, Phase, Rank, Rules,
                      build_deck, make_agent, play_game, run_match, summarize)
from cardduel.engine import ACCEPT, CHALLENGE, DRAW, PASS, Action

R, Y, G, B = Color.RED, Color.YELLOW, Color.GREEN, Color.BLUE


def setup(hand0, hand1, top, color=None, draw=None, player=0, rules=None):
    """Build a game in a hand-crafted position."""
    g = Game(seed=1, rules=rules)
    g.hands = [list(hand0), list(hand1)]
    g.discard = [top]
    g.current_color = color if color is not None else top.color
    g.draw_pile = list(draw) if draw is not None else [Card(Rank.NINE, Y)] * 20
    g.current_player = player
    g.phase = Phase.TURN
    g.events = []
    return g


def all_cards(g):
    return g.hands[0] + g.hands[1] + g.draw_pile + g.discard


class DeckTests(unittest.TestCase):
    def test_composition(self):
        d = build_deck()
        self.assertEqual(len(d), 108)
        c = Counter(d)
        self.assertEqual(c[Card(Rank.ZERO, R)], 1)
        self.assertEqual(c[Card(Rank.FIVE, B)], 2)
        self.assertEqual(c[Card(Rank.SKIP, G)], 2)
        self.assertEqual(c[Card(Rank.WILD)], 4)
        self.assertEqual(c[Card(Rank.WILD_DRAW_FOUR)], 4)

    def test_roundtrip(self):
        for card in set(build_deck()):
            self.assertEqual(Card.from_str(card.to_str()), card)

    def test_points(self):
        self.assertEqual(Card(Rank.SEVEN, R).points, 7)
        self.assertEqual(Card(Rank.DRAW_TWO, R).points, 20)
        self.assertEqual(Card(Rank.WILD).points, 50)


class RuleTests(unittest.TestCase):
    def test_deal(self):
        g = Game(seed=5)
        self.assertEqual(len(all_cards(g)), 108)
        self.assertNotEqual(g.top_card.rank, Rank.WILD_DRAW_FOUR)

    def test_matching(self):
        g = setup([Card(Rank.THREE, R), Card(Rank.FIVE, B), Card(Rank.SEVEN, G), Card(Rank.WILD)],
                  [Card(Rank.ONE, R)], Card(Rank.FIVE, R))
        plays = {a.card for a in g.legal_actions() if a.type is ActionType.PLAY}
        self.assertEqual(plays, {Card(Rank.THREE, R), Card(Rank.FIVE, B), Card(Rank.WILD)})
        with self.assertRaises(IllegalAction):
            g.step(Action(ActionType.PLAY, Card(Rank.SEVEN, G)))

    def test_number_passes_turn(self):
        g = setup([Card(Rank.THREE, R), Card(Rank.ONE, B)], [Card(Rank.ONE, R)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.THREE, R)))
        self.assertEqual(g.current_player, 1)

    def test_skip_and_reverse_give_extra_turn(self):
        for rank in (Rank.SKIP, Rank.REVERSE):
            g = setup([Card(rank, R), Card(Rank.ONE, B)], [Card(Rank.ONE, R)], Card(Rank.FIVE, R))
            g.step(Action(ActionType.PLAY, Card(rank, R)))
            self.assertEqual(g.current_player, 0, rank)

    def test_draw_two(self):
        g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.ONE, B)], [Card(Rank.ONE, R)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        self.assertEqual(len(g.hands[1]), 3)
        self.assertEqual(g.current_player, 0)

    def test_wild_sets_color(self):
        g = setup([Card(Rank.WILD), Card(Rank.ONE, B)], [Card(Rank.ONE, R)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.WILD), G))
        self.assertEqual(g.current_color, G)
        self.assertEqual(g.current_player, 1)

    def test_draw_playable_then_play_or_pass(self):
        g = setup([Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R),
                  draw=[Card(Rank.EIGHT, R)])
        g.step(DRAW)
        self.assertEqual(g.phase, Phase.DREW)
        self.assertEqual(g.legal_actions(), [Action(ActionType.PLAY, Card(Rank.EIGHT, R)), PASS])
        g.step(PASS)
        self.assertEqual(g.current_player, 1)

    def test_draw_unplayable_ends_turn(self):
        g = setup([Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R),
                  draw=[Card(Rank.EIGHT, Y)])
        g.step(DRAW)
        self.assertEqual(g.current_player, 1)
        self.assertEqual(g.phase, Phase.TURN)

    def test_draw_until_playable(self):
        g = setup([Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R),
                  draw=[Card(Rank.EIGHT, R), Card(Rank.TWO, Y), Card(Rank.THREE, Y)],
                  rules=Rules(draw_until_playable=True))
        g.step(DRAW)
        self.assertEqual(len(g.hands[0]), 4)
        self.assertEqual(g.pending_card, Card(Rank.EIGHT, R))

    def test_wd4_accept(self):
        g = setup([Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.WILD_DRAW_FOUR), B))
        self.assertEqual(g.phase, Phase.CHALLENGE)
        self.assertEqual(g.current_player, 1)
        g.step(ACCEPT)
        self.assertEqual(len(g.hands[1]), 5)
        self.assertEqual(g.current_player, 0)

    def test_wd4_challenge_fails(self):
        g = setup([Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.WILD_DRAW_FOUR), B))
        g.step(CHALLENGE)
        self.assertEqual(len(g.hands[1]), 7)
        self.assertEqual(g.current_player, 0)

    def test_wd4_challenge_succeeds(self):
        g = setup([Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, R)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R))
        g.step(Action(ActionType.PLAY, Card(Rank.WILD_DRAW_FOUR), B))
        g.step(CHALLENGE)
        self.assertEqual(len(g.hands[0]), 5)
        self.assertEqual(len(g.hands[1]), 1)
        self.assertEqual(g.current_player, 1)
        self.assertEqual(g.current_color, B)

    def test_wd4_restricted(self):
        g = setup([Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, R)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R),
                  rules=Rules(wd4_restricted=True))
        self.assertFalse(any(a.card == Card(Rank.WILD_DRAW_FOUR) for a in g.legal_actions()))

    def test_win_and_score_includes_final_draw(self):
        g = setup([Card(Rank.DRAW_TWO, R)], [Card(Rank.WILD), Card(Rank.SKIP, B)], Card(Rank.FIVE, R),
                  draw=[Card(Rank.NINE, Y), Card(Rank.EIGHT, Y)])
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        self.assertTrue(g.is_over)
        self.assertEqual(g.winner, 0)
        self.assertEqual(g.score(), 50 + 20 + 9 + 8)

    def test_reshuffle(self):
        g = setup([Card(Rank.ONE, B)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R), draw=[])
        g.discard = [Card(Rank.TWO, Y), Card(Rank.THREE, Y), Card(Rank.FIVE, R)]
        g.step(DRAW)
        self.assertEqual(g.top_card, Card(Rank.FIVE, R))
        self.assertEqual(len(g.hands[0]), 2)
        self.assertEqual(g.stats.reshuffles, 1)


class SimulationTests(unittest.TestCase):
    def test_many_games_conserve_cards(self):
        for seed in range(200):
            agents = [make_agent("random"), make_agent("heuristic")]
            g = play_game(agents, seed=seed, starter=seed % 2)
            self.assertTrue(g.is_over)
            self.assertEqual(sorted(all_cards(g)), sorted(build_deck()))
            if g.winner is not None:
                self.assertEqual(len(g.hands[g.winner]), 0)

    def test_reproducible(self):
        a = list(run_match("heuristic", "random", games=60, seed=3, chunk_size=20))
        b = list(run_match("heuristic", "random", games=60, seed=3, chunk_size=20, workers=3))
        self.assertEqual(a, b)
        c = list(run_match("heuristic", "random", games=60, seed=4, chunk_size=20))
        self.assertNotEqual(a, c)

    def test_summary(self):
        s = summarize(run_match("greedy", "random", games=100, seed=1))
        self.assertEqual(s["games"], 100)
        self.assertEqual(sum(s["wins"]) + s["draws"], 100)
        self.assertGreater(s["win_rate"][0], 0.8)


if __name__ == "__main__":
    unittest.main()
