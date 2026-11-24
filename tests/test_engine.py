import unittest
from collections import Counter

from cardduel import (ActionType, Card, Color, Game, IllegalAction, Phase, Rank, Rules,
                      build_deck, make_agent, play_game, run_match, summarize)
from cardduel.engine import ACCEPT, CHALLENGE, DONE, DRAW, PASS, Action

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
        self.assertEqual(g.phase, Phase.RESPOND)
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


HOUSE = Rules(multi_play=True, stack_draws=True, number_finish=True)


class HouseRuleTests(unittest.TestCase):
    def test_multi_play_same_number_any_color(self):
        g = setup([Card(Rank.FIVE, R), Card(Rank.FIVE, B), Card(Rank.FIVE, G), Card(Rank.ONE, Y)],
                  [Card(Rank.ONE, R)], Card(Rank.TWO, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.FIVE, R)))
        self.assertEqual((g.phase, g.current_player), (Phase.MULTI, 0))
        self.assertEqual(g.legal_actions(), [Action(ActionType.PLAY, Card(Rank.FIVE, B)),
                                             Action(ActionType.PLAY, Card(Rank.FIVE, G)), DONE])
        g.step(Action(ActionType.PLAY, Card(Rank.FIVE, G)))
        g.step(Action(ActionType.PLAY, Card(Rank.FIVE, B)))
        self.assertEqual((g.current_player, g.current_color, g.hands[0]), (1, B, [Card(Rank.ONE, Y)]))

    def test_skip_then_same_color(self):
        for rank in (Rank.SKIP, Rank.REVERSE):
            g = setup([Card(rank, R), Card(rank, B), Card(Rank.EIGHT, R), Card(Rank.ONE, G)],
                      [Card(Rank.ONE, Y)], Card(Rank.TWO, R), rules=HOUSE)
            g.step(Action(ActionType.PLAY, Card(rank, R)))
            self.assertEqual((g.phase, g.current_player), (Phase.TURN, 0))
            cards = [a.card for a in g.legal_actions() if a.type is ActionType.PLAY]
            self.assertEqual(sorted(cards), sorted([Card(rank, B), Card(Rank.EIGHT, R)]))
            g.step(Action(ActionType.PLAY, Card(Rank.EIGHT, R)))
            self.assertEqual(g.current_player, 1)

    def test_done_ends_turn_early(self):
        g = setup([Card(Rank.FIVE, R), Card(Rank.FIVE, B), Card(Rank.ONE, Y)], [Card(Rank.ONE, R)],
                  Card(Rank.TWO, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.FIVE, R)))
        g.step(DONE)
        self.assertEqual((g.current_player, len(g.hands[0])), (1, 2))

    def test_two_draw_twos_at_once(self):
        g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.DRAW_TWO, B), Card(Rank.ONE, Y)], [Card(Rank.ONE, G)],
                  Card(Rank.TWO, R), rules=Rules(multi_play=True))
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, B)))
        self.assertEqual((len(g.hands[1]), g.current_player), (5, 0))

    def test_stack_draw_two(self):
        g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.ONE, Y)], [Card(Rank.DRAW_TWO, B), Card(Rank.ONE, G)],
                  Card(Rank.TWO, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        self.assertEqual((g.phase, g.current_player, g.pending_draw), (Phase.RESPOND, 1, 2))
        self.assertEqual(g.legal_actions(), [ACCEPT, Action(ActionType.PLAY, Card(Rank.DRAW_TWO, B))])
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, B)))
        self.assertEqual((len(g.hands[0]), g.current_player, g.pending_draw), (5, 1, 0))

    def test_like_on_like_only(self):
        g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.ONE, Y)], [Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, G)],
                  Card(Rank.TWO, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        self.assertEqual((len(g.hands[1]), g.current_player, g.pending_draw), (4, 0, 0))

    def test_number_finish(self):
        for last in (Card(Rank.SKIP, R), Card(Rank.REVERSE, R), Card(Rank.DRAW_TWO, R),
                     Card(Rank.WILD), Card(Rank.WILD_DRAW_FOUR)):
            g = setup([last], [Card(Rank.ONE, G)], Card(Rank.FIVE, R), rules=HOUSE)
            self.assertEqual(g.legal_actions(), [DRAW])
        g = setup([Card(Rank.SEVEN, R)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.SEVEN, R)))
        self.assertEqual(g.winner, 0)

    def test_challengeable_wd4_can_be_stacked(self):
        g = setup([Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, R)], [Card(Rank.WILD_DRAW_FOUR), Card(Rank.ONE, G)],
                  Card(Rank.FIVE, R), rules=HOUSE)
        g.step(Action(ActionType.PLAY, Card(Rank.WILD_DRAW_FOUR), B))
        types = [a.type for a in g.legal_actions()]
        self.assertEqual(types[:2], [ActionType.CHALLENGE, ActionType.ACCEPT])
        self.assertEqual(types.count(ActionType.PLAY), 4)

    def test_custom_card_default_plus_ten_with_color(self):
        self.assertEqual(len(build_deck(2)), 110)
        rules = Rules(custom_cards=2)
        g = setup([Card(Rank.CUSTOM), Card(Rank.ONE, Y)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R),
                  draw=[Card(Rank.NINE, Y)] * 30, rules=rules)
        plays = [a for a in g.legal_actions() if a.type is ActionType.PLAY]
        self.assertEqual(len(plays), 4)  # one per color
        g.step(Action(ActionType.PLAY, Card(Rank.CUSTOM), B))
        self.assertEqual((len(g.hands[1]), g.current_player, g.current_color), (11, 0, B))
        self.assertEqual(Card(Rank.CUSTOM).points, 50)

    def test_custom_card_skip_without_color(self):
        rules = Rules(custom_cards=2, custom_color=False, custom_skip=True, custom_draw=0)
        g = setup([Card(Rank.CUSTOM), Card(Rank.ONE, Y)], [Card(Rank.ONE, G)], Card(Rank.FIVE, R), rules=rules)
        self.assertEqual([a for a in g.legal_actions() if a.type is ActionType.PLAY],
                         [Action(ActionType.PLAY, Card(Rank.CUSTOM))])
        g.step(Action(ActionType.PLAY, Card(Rank.CUSTOM)))
        self.assertEqual((g.current_player, g.current_color, len(g.hands[1])), (0, R, 1))

    def test_custom_cards_stack_like_on_like(self):
        rules = Rules(custom_cards=2, stack_draws=True, custom_draw=5)
        g = setup([Card(Rank.CUSTOM), Card(Rank.ONE, Y)], [Card(Rank.CUSTOM), Card(Rank.DRAW_TWO, G)],
                  Card(Rank.FIVE, R), draw=[Card(Rank.NINE, Y)] * 30, rules=rules)
        g.step(Action(ActionType.PLAY, Card(Rank.CUSTOM), B))
        self.assertEqual((g.phase, g.pending_draw), (Phase.RESPOND, 5))
        self.assertEqual(sorted({a.card.rank for a in g.legal_actions() if a.type is ActionType.PLAY}), [Rank.CUSTOM])
        g.step(Action(ActionType.PLAY, Card(Rank.CUSTOM), G))
        self.assertEqual((len(g.hands[0]), g.current_player), (11, 1))

    def test_bots_finish_with_custom_cards(self):
        for rules in (Rules(multi_play=True, stack_draws=True, number_finish=True, custom_cards=4),
                      Rules(custom_cards=4, custom_color=False, custom_skip=True, custom_draw=3)):
            for seed in range(100):
                g = play_game([make_agent("heuristic"), make_agent("greedy")], seed=seed, starter=seed % 2, rules=rules)
                self.assertTrue(g.is_over)
                self.assertEqual(sorted(all_cards(g)), sorted(build_deck(4)))

    def test_plus_ends_turn(self):
        # Official: the +2 player goes again. With plus_ends_turn, the victim plays next.
        for rule, nxt in ((False, 0), (True, 1)):
            g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.ONE, Y)], [Card(Rank.ONE, G)], Card(Rank.TWO, R),
                      rules=Rules(plus_ends_turn=rule))
            g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
            self.assertEqual((len(g.hands[1]), g.current_player), (3, nxt))
        # After accepting a stacked penalty, the one who accepted plays next.
        g = setup([Card(Rank.DRAW_TWO, R), Card(Rank.ONE, Y)], [Card(Rank.DRAW_TWO, B), Card(Rank.ONE, G)],
                  Card(Rank.TWO, R), rules=Rules(stack_draws=True, plus_ends_turn=True))
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, R)))
        g.step(Action(ActionType.PLAY, Card(Rank.DRAW_TWO, B)))
        self.assertEqual((len(g.hands[0]), g.current_player), (5, 0))

    def test_bots_finish_under_house_rules(self):
        for seed in range(200):
            g = play_game([make_agent("heuristic"), make_agent("random")], seed=seed, starter=seed % 2, rules=HOUSE)
            self.assertTrue(g.is_over)
            self.assertEqual(sorted(all_cards(g)), sorted(build_deck()))


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
