# One King One Crown — online edition

A mobile-first, real-time multiplayer version of the tabletop game **One King
One Crown**. 4–8 players, one phone each, private rooms joined by a 5-letter
code. The server deals, shuffles, rolls, tracks every coin and enforces the
rules; each phone only ever receives what that player is allowed to see.

> **Credit & licence.** One King One Crown is designed by its original
> creators ([onecrown.store](https://www.onecrown.store)). The rules, card art,
> character cards and round tracker come from their official print-and-play
> edition, which is shared under
> [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This
> adaptation must stay **free and non-commercial**, keep this attribution, and
> be shared under the same licence. It is not affiliated with the designers.

## Quick start

Needs Node 20+ (tested on Node 24).

```sh
npm run setup      # installs Server/ and Client/
npm run dev        # server on :3001, client on :5173
```

Open <http://localhost:5173>. To play with friends on the same Wi-Fi, have them
open `http://<your computer's LAN IP>:5173` — the client finds the server on
the same host automatically. You need 4 players to start; for solo testing open
four browser windows (use private windows so each gets its own seat).

Run the parts separately with `npm run dev` inside `Server/` or `Client/`.

## Configuration

Both `.env` files are optional; copy the `.env.example` next to them.

| Where | Variable | Default | What it does |
|---|---|---|---|
| Server | `PORT` | `3001` | Port to listen on (Heroku sets it). |
| Server | `CLIENT_ORIGINS` | any | Comma-separated allowed origins. No cookies are used, so "any" is safe; pin it in production if you like. |
| Server | `DATA_DIR` | `./data` | Folder for saved rooms when `MONGODB_URI` is empty. |
| Server | `MONGODB_URI` | — | Save rooms in MongoDB instead of files. |
| Client | `VITE_SERVER_URL` | `http(s)://<page host>:3001` | Where the client connects. Set it when the server lives elsewhere. |

## Tests and checks

```sh
npm test           # server (node --test) + client (vitest)
npm run typecheck
npm run build
```

* **Server — 87 tests.** Setup for every player count; turn order and the
  round tracker's direction changes; play/draw counts; the negotiation timer;
  four-round endings; dotted-line cards; dice (deterministic via physical-dice
  mode); target, ownership and turn validation; Knights and bluffs; Betray the
  King + King Maker; crown changes, seat/hand swaps and tie roll-offs;
  Isolation / King's Eye; Bad Blood, Indebted, Hindsight, Scout; the 400-gold
  negotiation cap across several deals; 1-for-1 card swaps; offer privacy;
  private-chat isolation; replayed actions; fake balances; reconnects; restarts
  restoring a saved game; a real-socket test checking what goes over the wire;
  and a **fuzz test that plays 66 complete random games** (4–8 players) checking
  after every action that gold stays in 0–2000, every card is in exactly one
  place, there is exactly one King in the King's seat and hands hold only their
  own deck's cards.
* **Client — 6 tests.** The money-tracker token lands on the right printed cell
  for every balance 0–2000 on both character cards.

## How it is built

```
One-King-One-Crown/
├── Server/                 Node + Express + Socket.IO (TypeScript, ESM)
│   ├── src/cards/catalog.ts     the 44 official cards: printed text, copies, art
│   ├── src/game/                the rules engine (no I/O)
│   │   ├── engine.ts            setup, turns, rounds, actions, timers
│   │   ├── effects/             one handler per card (noble.ts, kingCards.ts)
│   │   ├── prompts.ts           votes / choices / rolls / support windows
│   │   ├── gold.ts              the only code that changes a balance
│   │   ├── king.ts, knights.ts, protection.ts, negotiation.ts
│   │   └── view.ts              what each player may see
│   ├── src/rooms/roomManager.ts lobby, seats, reconnects, chat, timers
│   ├── src/socket/handlers.ts   socket events (documented at the top)
│   └── src/persistence/store.ts file / MongoDB / memory stores
├── Client/                 React 19 + Vite (TypeScript)
│   ├── public/art/              official art cropped from the PDF + manifest.json
│   └── src/                     pages (Landing, Lobby, Game) and components
├── docs/rule-audit.md      every rule with its PDF page, and every ambiguity + the default chosen
├── docs/card-catalog.md    all cards (generated: npm run catalog:doc)
└── tools/extract_assets.py crops the card art out of "All Cards.pdf"
```

**Server-authoritative.** A client sends a request (`play this card with these
targets`, `answer this prompt`, `offer this deal`); the engine validates it
against the state, applies it to a *copy* of the state and only keeps the copy
if everything succeeded — so a multi-player effect is never half-applied. Dice
and shuffles come from a seeded generator stored in the game state. Each action
carries an id; a resent id is acknowledged and ignored.

**No rules in the client.** For every card in your hand the server sends
whether it can be played, why not, and exactly which targets/amounts each
option allows; prompts arrive with their options. The client just renders them.

**Hidden information is never sent.** `view.ts` builds each player's payload
from scratch: other hands, deck order, face-down card identities (except to
the player who placed them), other people's deal offers and private messages
are simply absent. The socket test checks the actual wire payloads.

**Cards** are data (`catalog.ts`) plus a small handler each. A handler lists
what the player must choose up front, starts the effect, and continues when a
prompt is answered. Every choice the card's player makes is made before the
card resolves — the game never chooses for them. Other players' answers have a
visible countdown; if it runs out, the documented default applies (see the
rule audit, "C11").

**Money tracker.** `tools/extract_assets.py` measures the printed 3×7 grid on
both official character cards and writes it to `manifest.json` (and fails if
the inverted start cell isn't 1000 / 600). The client positions the official
eye token by percentage of that grid, so it stays on the right number at any
size and glides when gold changes.

**Persistence.** Every change saves the whole room (game, seats, chat, tokens).
After a restart the rooms come back, timers re-arm from their absolute
deadlines, and players rejoin with the token their browser kept.

**Reconnecting.** Your seat is tied to a token in your browser's storage, not
to the connection. Refresh, lose signal or switch apps and you come straight
back. A player who stays disconnected keeps their seat for the whole game;
their turn is skipped after 60 s and their prompts take the defaults.

## Rules decisions

The PDFs leave some things open (when exactly the gold check crowns someone,
what "vocal support" means online, what happens when a deck runs out, how
Black Plague pairs are chosen…). Each one is listed in
[docs/rule-audit.md](docs/rule-audit.md) with the default used and where it
lives in the code. The most visible ones:

* Crowning happens after a whole card (or deal) resolves, when a Noble's gold
  rose — or the King's fell — to strictly more than the King's (A1).
* "Vocal support" is a timed **Support** button; Betray the King needs two.
* Spoken cards (Actors, Loyal Dog, Bend the Knee, Royal Parrot…) post your line
  to the table as a speech bubble.
* A room can switch to **real dice**: you roll at the table and tap the number.

## Re-extracting the artwork

```sh
pip install pymupdf pillow numpy
python tools/extract_assets.py "path/to/All Cards.pdf" Client/public/art
```

It checks that every copy of a card is the same picture and that copy counts
match the sheets (99 cards: 25 King, 74 Noble, 44 faces). The server's
`catalog.test.ts` checks the catalog against the manifest.

## Deploying

Same shape as the other games: the server on Heroku (`npm run build`, then
`npm start`), the client on Netlify (`Client/netlify.toml`; set
`VITE_SERVER_URL` to the server's URL). Heroku wipes its disk on every restart,
so set `MONGODB_URI` there if games must survive a restart. The client pings
`/ping` every 5 minutes during a game to keep an eco dyno awake.

## Limitations

* **MongoDB storage has not been run against a real database** — there's no
  MongoDB on the development machine. The file store (the default) is what the
  tests and local play use. The Mongo store is ~30 lines over the same interface.
* Tested on desktop browsers and Chromium's phone emulation (390×844), not on
  physical phones yet.
* Spoken lines and physical dice are honour-system, as at a real table.
* No accounts: clearing your browser's site data mid-game loses your seat.
* A save is written ~150 ms after each change; a crash inside that window loses
  the last action.
* Response timeouts, "Done negotiating" and the 1/3/5-minute negotiation
  options are digital additions; 2 minutes is the official default.
#   O n e K i n g  
 