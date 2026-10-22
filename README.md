# OneKing — One King One Crown, online

A mobile-first, real-time multiplayer version of the tabletop game **One King
One Crown**. 4–8 players, one phone each, in a private room joined by a 4-digit
code. Play **around the same table** (you talk out loud; the phones handle
cards, gold, dice and votes) or **apart** (chat, private messages and full deal
offers). The server deals, shuffles, rolls, tracks every coin and enforces the
rules; each phone only receives what that player is allowed to see.

- Client: <https://onekingonecrown.netlify.app>
- Server: <https://oneking-3290b1569525.herokuapp.com>

> **Credit & licence.** One King One Crown is designed by its original creators
> ([onecrown.store](https://www.onecrown.store)). The rules, card art, character
> cards and round tracker come from their official print-and-play edition,
> shared under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
> This adaptation must stay **free and non-commercial**, keep this attribution,
> and be shared under the same licence. It is not affiliated with the designers.

## Quick start

Needs Node 24.

```sh
npm run setup      # installs Server/ and Client/
npm run dev        # server on :3001, client on :5173
```

Open <http://localhost:5173>. Friends on the same Wi-Fi open
`http://<your computer's LAN IP>:5173` — the client finds the server on the same
host by itself. You need 4 players to start; for solo testing use four private
browser windows.

## Two ways to play (the host picks in the lobby)

| | **Same room** (default) | **Apart (online)** |
|---|---|---|
| Talking | Out loud. No chat at all. | Table chat + private messages. |
| Spoken cards (Actors, Loyal Dog, Council Meeting, Loyalty, Bend the Knee, Royal Parrot) | Every phone shows "📣 Bob must say: …" and the game carries on while they say it. The King speaks the Parrot's sentence himself. | The player's line is posted as a speech bubble. |
| Negotiation | **Trade** tab: only what physically changes hands — 💰 give gold, 🔄 swap a card, 🗑️ discard a card. The other player confirms on their phone. Everything else (promises, alliances, threats) is said out loud. | **Deals** tab: full offers (gold both ways, card swaps, discards) plus chat. |
| Both | Votes, support for a Betrayal, King Makers, dice and choices that cost gold stay as buttons. The 400-gold receive limit, 1-for-1 card swaps and "King and Noble cards never mix" are enforced. A card offered in a swap stays face down until the swap happens — players can lie. Deals are never binding: a "gold for a card" deal is two handovers, and either side can betray halfway. | |

**Everyone's gold, any time:** the 💰 **Gold** button in the top bar shows every
player's official character card with their eye token on it. Tokens only ever
move when the server moves gold, so the table can always check the count.

## Configuration

| Where | Variable | Default | What it does |
|---|---|---|---|
| Server | `PORT` | `3001` | Port to listen on (Heroku sets it). |
| Server | `CLIENT_ORIGINS` | any | Comma-separated allowed origins (a trailing `/` is ignored). No cookies are used, so "any" is safe. |
| Client | `VITE_SERVER_URL` | `http(s)://<page host>:3001` | Where the client connects. `Client/.env.production` sets it to the Heroku server for production builds. |

## Deploying (this repo holds both apps)

**Netlify (client).** `netlify.toml` at the repo root tells Netlify to build
only `Client/` (base `Client`, command `npm run build`, publish `dist`, Node 24).
A root `netlify.toml` overrides the UI's build settings, so nothing needs
changing in the dashboard — just connect the site to this GitHub repo.

**Heroku (server).** The root `package.json` makes Heroku build and run only
`Server/`: `heroku-postbuild` installs and compiles the server, and the
`Procfile` runs `npm start` → `Server`. Either connect the app to this GitHub
repo (Deploy tab → GitHub → enable automatic deploys from `main`) or push to it
directly: `git push https://git.heroku.com/oneking.git main`.

**Keeping the eco dyno awake.** Eco dynos sleep after 30 minutes without an HTTP
request (an open socket doesn't count). While a game is running each client
pings `/ping` every 10 minutes, and stops if the game goes quiet for 30 minutes
so the dyno can still sleep (same approach as Hypo).

**Reconnecting.** Rooms live in the server's memory. Your seat is tied to a
token in your browser, so a refresh, a phone that went to sleep or a dropped
connection puts you straight back in your seat with your hand. A player who
stays away keeps their seat for the whole game; their turn is skipped after 60 s
and their prompts take the defaults. (If the dyno itself restarts, rooms in
progress are lost.)

## Tests and checks

```sh
npm test           # server (node --test) + client (vitest)
npm run typecheck
npm run build
```

* **Server — 94 tests.** Setup for every player count; turn order and the
  round tracker's direction; play/draw counts; the negotiation timer; four-round
  endings; dotted-line cards; dice; target / ownership / turn validation;
  Knights and bluffs; Betray the King + King Maker; crown changes, seat/hand
  swaps and tie roll-offs; Isolation / King's Eye; Bad Blood, Indebted,
  Hindsight, Scout; the 400-gold cap; 1-for-1 swaps; offer privacy; in-person vs
  virtual behaviour; chat isolation (and no chat in person); replayed actions;
  fake balances; reconnects; a real-socket test of what goes over the wire; and
  a **fuzz test of 84 complete random games** (4–8 players, both modes) checking
  after every action that gold stays in 0–2000, every card is in exactly one
  place, there is one King in the King's seat and hands hold only their own
  deck's cards.
* **Client — 6 tests**: the money-tracker token lands on the right printed
  cell for every balance on both character cards.

## How it is built

```
OneKing/
├── Server/                 Node + Express + Socket.IO (TypeScript)
│   ├── src/cards/catalog.ts     the 44 official cards: printed text, copies, art
│   ├── src/game/                the rules engine (no I/O)
│   │   ├── engine.ts            setup, turns, rounds, actions, timers
│   │   ├── effects/             one handler per card (noble.ts, kingCards.ts)
│   │   ├── prompts.ts           votes / choices / rolls / support windows
│   │   ├── gold.ts              the only code that changes a balance
│   │   ├── king.ts, knights.ts, protection.ts, negotiation.ts
│   │   └── view.ts              what each player may see
│   ├── src/rooms/roomManager.ts lobby, seats, reconnects, chat, timers
│   └── src/socket/handlers.ts   socket events (documented at the top)
├── Client/                 React 19 + Vite (TypeScript)
│   ├── public/art/              official art cropped from the PDF + manifest.json
│   └── src/                     pages (Landing, Lobby, Game) and components
├── docs/rule-audit.md      every rule with its PDF page, every ambiguity + the default chosen
├── docs/card-catalog.md    all cards (generated: npm run catalog:doc)
├── tools/extract_assets.py crops the card art out of "All Cards.pdf"
├── netlify.toml, Procfile, package.json   deployment of the two apps from one repo
```

**Server-authoritative.** A client sends a request (play this card with these
targets, answer this prompt, give this gold); the engine validates it, applies
it to a *copy* of the state and keeps the copy only if everything succeeded, so
a multi-player effect is never half-applied. Dice and shuffles come from a
seeded generator in the game state. Each action carries an id; a resent id is
acknowledged and ignored.

**No rules in the client.** For every card in your hand the server sends
whether it can be played, why not, and exactly which targets each option
allows; prompts arrive with their options. The client renders them.

**Hidden information is never sent.** Each player's payload is built from
scratch: other hands, deck order, face-down card identities (except to whoever
placed them), cards offered in a swap, other people's deals and private
messages are simply absent.

**Money tracker.** `tools/extract_assets.py` measures the printed 3×7 grid on
both official character cards into `manifest.json` (and fails if the inverted
start cell isn't 1000 / 600). The client places the official eye token by
percentage of that grid, so it stays on the right number at any size.

**Layouts.** Portrait phone (primary): top bar, one pane, bottom tabs. Phone
held sideways: one-line top bar, tabs as a rail on the left, card and prompt
sheets split art-left / controls-right. Desktop: every pane at once.

## Rules decisions

The PDFs leave some things open; each is in [docs/rule-audit.md](docs/rule-audit.md)
with the default used. The most visible ones: crowning happens after a whole
card or deal resolves, when a Noble now has strictly more gold than the King
(A1); "vocal support" is a timed Support button; a room can use **real dice**
(roll at the table, tap the number).

## Re-extracting the artwork

```sh
pip install pymupdf pillow numpy
python tools/extract_assets.py "path/to/All Cards.pdf" Client/public/art
```

## Limitations

* Tested in desktop browsers and Chromium's phone emulation (390×844 portrait,
  844×390 landscape), not yet on physical phones.
* Spoken lines and real dice are honour-system, as at a real table.
* No accounts: clearing your browser's site data mid-game loses your seat.
* Response timeouts, "Done negotiating" and the 1/3/5-minute negotiation options
  are digital additions; 2 minutes is the official default.
