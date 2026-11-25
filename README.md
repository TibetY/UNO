# cardduel

A two-player (1v1) color-matching shedding card game engine with the classic
108-card deck, built for **automated play and statistics gathering**. It's
pure Python 3.9+ with no dependencies, plus a React web app in `web/`.

## Web app (React)

The web app is in `web/`. It's React and TypeScript, built with Vite. A
TypeScript port of the engine runs entirely in the browser, so no server is
needed.

```bash
cd web
npm install
npm run dev              # local development server
npm test                 # engine tests, including checks against the Python engine's stats
npm run build            # static site in web/dist/, deployable to any static host
npm run build:artifact   # single self-contained page: web/dist-artifact/card-duel.html
```

The app has two tabs:

- **Play**: play against `random`, `greedy` or `heuristic`, or against a friend on the same device.
- **Online**: play a friend in real time. One player creates a game and taps **Share invite link**, which opens the phone's share menu (Messages, WhatsApp and so on) or copies the link on a computer. The link opens the Online tab with the code filled in. The other player can also type the 5-character code. Both players need to be on the same site.

During a game, the 😊 button next to your name sends a reaction (😭 😂 🙄 🤬 👎 👍 🍆 🗑️). Online, your opponent sees it within about half a second. Against a bot, the bot sometimes reacts on its own.

**Turn timer** (Rules → Turn timer, default 30 seconds, or Off): a bar in each player's name tag shows their time. When it runs out, the turn is forfeited: the player draws a card and play passes, or takes a penalty they owe. Bots aren't timed. Online, the host's device keeps time for both players.

Bot-vs-bot matches and statistics are on the command line (`python -m cardduel simulate`, `tournament`).

**On phones**, starting a game (New game, Create game, Join) switches to a
full-screen table that can't scroll or zoom. **☰ Menu** goes back to the
settings and log, and **⛶ Full screen** returns to the game. Where the browser
allows it (for example Android Chrome), the browser's own controls are hidden
too. iPhone Safari never lets a web page hide its address bar, so on an iPhone
use **Share → Add to Home Screen**. The site includes a web-app manifest, so it
then opens like an installed app with no browser controls.

**Two players on one device**: under **Play**, choose the opponent **A friend on this device**. Players take turns on one phone or computer. Between turns, a "Pass the device" screen hides both hands until the next player taps to show theirs.

**Online on Netlify**: the site includes a small relay function (`web/netlify/functions/room.mts`, with the logic in `web/netlify/lib/room-core.ts`). Each player's browser posts its presence to `/api/room/<game>` and gets the other player's back. State is kept in Netlify Blobs, so no other service or account is needed. Browsers check about every 0.7 seconds while moves are happening, slowing to every 3 seconds when idle (less in a background tab), so a game uses a few hundred function calls. Netlify deploys the function on its own with the site. The app uses the claude.ai room when it's running there, this relay on Netlify, and same-browser tabs anywhere else.

**How online play works.** It runs over a claude.ai Artifact's shared room, so
it works when the `build:artifact` page is published as an Artifact. The
host's browser runs the engine and acts as referee. Each side shares one small
"presence" object: the host shares the guest's view of the table, and the
guest shares the move it picked. The host checks every move against the
rules, and the host's own hand is never sent until the game ends. Presence
always holds the latest state, so a dropped message or a late joiner needs no
special handling. If the guest reloads, they can rejoin the same game with
the code.

Outside claude.ai, the same code falls back to `BroadcastChannel`, which links
tabs of one browser. That fallback is for development and tests. Playing over
the internet from a different host would need a small relay server that
implements the same `SharedRoom` interface (`web/src/online/transport.ts`).

The TypeScript engine uses the same rules as the Python engine. Its tests
check that the bots' win rates and game lengths match the Python simulator.

## Quick start (CLI)

```bash
# Match between two bots: prints win rates (with 95% CIs), first-player edge, game length, etc.
python -m cardduel simulate --p0 heuristic --p1 greedy --games 20000 --workers 4

# Save per-game data for your own analysis
python -m cardduel simulate --games 10000 --csv games.csv --jsonl games.jsonl --summary-json summary.json
python -m cardduel simulate --games 100 --jsonl replays.jsonl --events   # include full move logs

# Round-robin between all bots
python -m cardduel tournament --games 5000

# Play against a bot in the terminal
python -m cardduel play --opponent heuristic

# Tests
python -m unittest
```

Rule variants are flags on every command: `--hand-size`, `--draw-until-playable`,
`--no-play-drawn`, `--wd4-restricted`, `--no-challenge`, `--multi-play`, `--stack-draws`,
`--number-finish`, `--plus-ends-turn`, `--custom-cards`, `--custom-draw`, `--custom-skip`,
`--custom-no-color`, `--rules og|c-house`, `--house` and `--max-turns`.

## Rules implemented (official 2-player rules)

- Deck: per color one 0, two each of 1–9, Skip, Reverse and Draw Two. Plus 4 Wild and 4 Wild Draw Four.
- Each player gets 7 cards. If the first card flipped is a Wild Draw Four, it goes back and the deck is reshuffled. A Skip, Reverse or Draw Two as the first card applies to the starting player. A plain Wild as the first card lets the starter play any card.
- **In 2-player games, Reverse works like Skip.** Skip, Reverse, Draw Two and Wild Draw Four all give the player who played them another turn.
- If you draw a playable card, you may play it right away or pass. With `--draw-until-playable` you keep drawing until you get a playable card.
- Wild Draw Four can be played at any time, but the opponent may **challenge** it. If you held a card of the active color, you draw 4 instead. If you didn't, the challenger draws 6. Use `--wd4-restricted` to forbid illegal plays outright.
- When the draw pile runs out, the discard pile (except the top card) is shuffled to make a new one.
- If the last card played is a Draw Two or Wild Draw Four, the opponent still draws, and those cards count toward the winner's score.
- Scoring: number cards are worth their face value, action cards 20 and wilds 50. The winner scores the points left in the loser's hand.
- Not modeled: the penalty for forgetting to announce your last card (bots always announce it).

**Rule sets.** There are two:

- **C House Rules**: the default in the web app. It turns on everything below, with 2 custom cards.
- **OG**: the official rules, as above. This is the default on the command line.

In the web app, pick a set under **Rules**. Changing any option shows "Custom". On the command line, use `--rules og` or `--rules c-house`. You can also turn on single rules with the flags below.

**House rules:**

- **Multi-play**: after playing a card, you can add more cards of the same number or symbol, in any color, in the same turn. The last card sets the color. Draw cards add up, so two +2s make the opponent draw 4. In the web app, tap the cards in the order you want them played (they rise, numbered), then press **Play**. The first card has to match the pile. A Skip and a Reverse of the same color also go together.
- **Skip and Reverse** (official two-player rule): you go again at once, so any card matching it can follow (red Skip, then red 8). If nothing matches, you have to draw.
- **Stacking**: when you're hit with a +2, you can answer with a +2, and when you're hit with a +4, with a +4 (never a +4 on a +2, or the other way round). The total passes to the other player, and whoever can't or won't stack draws all of it.
- **Custom card** (`--custom-cards N`): a card with a black border and a blank white face. You set what it does before the game starts: the opponent picks up N cards (`--custom-draw`, default 10), the player chooses the color (on by default; `--custom-no-color` turns it off), and/or the player goes again (`--custom-skip`). It can be played on anything. If it doesn't choose a color, the color stays as it was. A custom card that makes the opponent pick up can only be stacked on another custom card. It's worth 50 points, and it's an action card, so you can't go out on it.
- **No Wild Draw Four challenges** (`--no-challenge`): under the official rules you can challenge a +4 you think was played while the player still had a card of the active color. C House Rules turns this off: a +4 can always be played, and the other player draws (or stacks). In the web app this is the checkbox "Wild Draw Four can be challenged".
- **No extra turn after a + card** (`--plus-ends-turn`): officially, in two-player, the person who plays a +2 or +4 goes again. With this rule their turn ends: the opponent draws (or stacks), then plays. This also covers custom cards that make you pick up, unless the custom card is set to "player goes again".
- **Finish on a number** (`--number-finish`): you can only go out on a number card. An action card (Skip, Reverse, +2, +4 or a wild) can't be your last card; if it's all you have left, you draw. A +4 played as a stack can't be challenged. A +4 that starts a penalty can still be challenged: if the challenge succeeds, the player who played it draws the whole total; if it fails, the challenger draws the total plus 2.

## Writing your own bot

```python
from cardduel import Agent, ActionType, run_match, summarize, format_summary

class MyBot(Agent):
    name = "mybot"
    def act(self, obs, legal):
        # obs: hand, top_card, current_color, opponent_hand_size, draw_pile_size,
        #      discard_pile, phase, pending_card, history (public event log)
        # legal: every legal Action (PLAY card[+color], DRAW, PASS, CHALLENGE, ACCEPT)
        plays = [a for a in legal if a.type is ActionType.PLAY]
        return plays[0] if plays else legal[0]

print(format_summary(summarize(run_match(MyBot, "heuristic", games=5000))))
```

To drive the engine step by step (for RL environments, search or custom loops):

```python
from cardduel import Game
g = Game(seed=42, starter=0)
while not g.is_over:
    obs, legal = g.observation(), g.legal_actions()
    g.step(legal[0])
print(g.result())
```

`Game.observation()` only shows what the acting player can know. Full state is
available on `g.hands`, `g.draw_pile` and `g.discard` for analysis.

## Built-in bots

| name        | strategy |
|-------------|----------|
| `random`    | Picks a random legal action. It draws often, so it's very weak. |
| `greedy`    | Always plays if it can. It plays colored cards first, highest points first, and never challenges. |
| `heuristic` | Holds wilds and plays Wild Draw Four only legally. It sticks to its strongest color, plays action cards hard when the opponent is low on cards, and learns how often to challenge. |

Reproducibility: results are deterministic for a given `--seed`, whatever the
number of workers. Games alternate the starting player. Agents persist within a
chunk of 250 games, which matters only for bots that learn between games.
