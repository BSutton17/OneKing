# Rule audit — One King One Crown (digital edition)

Sources: `Rules.pdf` (18-page print-and-play guide) and `All Cards.pdf` (28 pages:
title, notes, round tracker + tokens, timer board + tokens, character cards and
backs, 11 card sheets each followed by its back sheet). Every rule below cites
its page. Where the PDFs are silent or ambiguous the decision is listed under
**Ambiguities** with the default this implementation uses. Each default lives
in one place in the server (`Server/src/game/config.ts` or the card's handler)
so it can be changed without touching anything else.

## 1. What the PDFs say

| # | Topic | Rule (source) | Implemented in |
|---|---|---|---|
| 1 | Players | 4–8 players (R p5) | `rooms/roomManager.ts` start check |
| 2 | Length | 4 rounds; whoever is King at the end of round 4 wins (R p5, p14) | `game/engine.ts` `endRound` |
| 3 | Win route | "Become the King by accumulating more gold than the current king" (R p5) | `game/king.ts` |
| 4 | Roles | Character cards dealt face down; whoever gets the King's card starts as King, the rest are Nobles; then all are revealed (R p5–6) | `game/setup.ts` |
| 5 | Starting gold | King 1000, Nobles 600 (R p6) — matches the highlighted cells on the printed character cards | `game/setup.ts` |
| 6 | Gold limits | Character cards run 0–2000 in steps of 100; you can't go above or below; at 0 you keep playing and anyone "taking" from you gets nothing more (R p16) | `game/gold.ts` |
| 7 | Hands | 8 cards each; King uses King cards, Nobles use Noble cards (R p7). Always have at least 8; if you discard/lose a card, draw a replacement instantly (R p15). Nobles cannot use or hold King cards and vice versa (R p17) | `game/cards.ts` |
| 8 | Turn order | Turn direction alternates: R1 clockwise, R2 counter-, R3 clockwise, R4 counter-clockwise (round tracker, R p8 / C p3) | `game/engine.ts` |
| 9 | Phases | Each round = Playing Phase then Negotiation Phase (R p11) | `game/engine.ts` |
| 10 | King's turn | King always goes first; plays 3 cards then draws 3; with only 3 Nobles plays 2 / draws 2 (R p11) | `game/turns.ts` |
| 11 | Noble turns | Next noble from the King in the round's direction; each plays 2 then draws 2 (R p12) | `game/turns.ts` |
| 12 | Dotted cards | Choose ONE of the two options (R p10) | card handlers |
| 13 | Dice | Some cards need dice rolls (R p10) | `game/prompts.ts` (digital or physical dice) |
| 14 | Negotiation | 2 minutes per round, timed (R p13). Players may trade gold, exchange cards, gain support for a Betrayal, make deals | `game/negotiation.ts` |
| 15 | Deals | Not binding; players can lie (R p14) | offers change nothing until accepted; no promises are tracked |
| 16 | Gold cap in negotiation | A player can't **receive** more than 400 gold in a single negotiation phase (R p14) | `game/negotiation.ts` |
| 17 | Card exchanges | Only 1-for-1: you can only give someone a card if you get one back (R p14) | `game/negotiation.ts` |
| 18 | Discards | Only as a deal with someone else; never just to get a replacement (R p14) | discards are part of an accepted offer |
| 19 | End of round | Move the round counter; next round starts at the King (R p14) | `game/engine.ts` |
| 20 | New King | At any time a player becomes King: they physically swap seats with the former King, swap cards (former King becomes a Noble, takes the new King's cards as they are), and after the demotion the next noble in turn plays next (R p15) | `game/king.ts` |
| 21 | Simultaneous Kings | If two players become King at the same time they both roll; the lowest roll loses 100 gold (R p15) | `game/king.ts` roll-off |
| 22 | Knights | Knights protect from Betrayal cards and can be bluffed: place ANY card face down and claim it's a Knight; a fake offers no protection (R p16) | `game/knights.ts` |
| 23 | King & Knights | The King cannot protect themselves from "Betray The King"; the King's Knight is meant to be given to a noble (R p16) | `game/knights.ts` |
| 24 | Bank | "Bank" = gain/lose without taking from anyone; it is unlimited (R p17) | `game/gold.ts` |

## 2. Components found in the PDFs

* **Character cards** (C p5): 1 King card (black grid, 1000 highlighted), 8 Noble cards (white grid, 600 highlighted). A 3-column × 7-row grid, 0 → 2000. Back: C p6.
* **Round tracker** (C p3): ROUND ONE ⟳ clockwise, TWO ⟲, THREE ⟳, FOUR ⟲. 24 eye tokens.
* **Timer board** (C p4): two hourglasses (a physical negotiation timer aid); the server timer replaces it, so it isn't used.
* **King deck — 25 cards, 16 faces** and **Noble deck — 74 cards, 28 faces**. Full list with copy counts: [card-catalog.md](card-catalog.md). Counts come from the sheets; the deck of each sheet column is confirmed from the matching back sheet (the back sheets are mirrored left-right for duplex printing, e.g. page 24 column 0 is the King back behind page 23 column 2 = Black Plague).
* Copies of a card are pixel-identical (checked by `tools/extract_assets.py`), so a repeated image never means a different effect.

## 3. Ambiguities and the defaults used

Each item: the question, what we do, and why. "Response timeout" means a
player who must answer a prompt (vote, choice, roll…) gets a visible countdown;
when it runs out the listed default is applied and logged — the player who
**played** the card is never decided for silently (they choose everything up
front before the card resolves).

### Core rules

* **A1 — When does "more gold than the King" crown someone?** The guide says "at any time". We check after every complete action (a card fully resolved, a deal, a payment), never in the middle of a card. Default mode `kingCheck: "onChange"`: a Noble is crowned when their gold rose (or the King's gold fell) during that action and they now have **strictly more** than the King. Reason: People's Champion moves the crown without moving gold; a purely continuous check would hand the crown straight back on the spot, making that card a no-op. The alternative `"continuous"` (any Noble richer than the King at any check) is one config switch.
* **A2 — Who becomes King when several Nobles pass the King at once?** The richest. The dice roll-off (R p15) is used only when the richest candidates are **tied**; highest roll is crowned, rerolling ties, and the lowest roll loses 100 (with 3+ tied, only the single lowest loses 100; ties for lowest reroll).
* **A3 — What does "next noble in turn plays next" mean mid-turn?** Turns belong to seats. The King's seat is fixed (the new King takes the old King's seat). If the player whose turn it is was one of the two who swapped, their turn ends at once and the next seat in the round's direction plays; otherwise the current turn just continues. Both swapped players then refill to 8 cards from their new deck.
* **A4 — What if a deck runs out?** 7 Nobles × (8 + 4×2) = 112 > 74 Noble cards. When a deck is empty its discard pile is shuffled into a new deck; if both are empty no card is drawn.
* **A5 — End-of-turn draw.** Draw the printed count (3/2/2), then top up to 8 if below. Helping Hand's own 2 cards are drawn when it's played. This reproduces "plays 2, draws 2" exactly and never double-draws.
* **A6 — A player who can't make all their plays.** Any card can normally be placed face down as a claimed Knight, so this is rare. If a player has no card they may legally play or place, they may end their turn early; they still draw the printed count.
* **A7 — Bluffing limits.** Placing a card face down "counts as a card played" (Knight card text), so a bluff obeys the card's own **timing** limits: no Betrayal / Betray the King bluff in round 1, Divine Right only in rounds 3–4, People's Champion only in round 4, never the Royal Bomb (it may only leave your hand in negotiation). Non-timing conditions (Icarus affordability, Divine Right's ≤300 gold) don't apply to a bluff.
* **A8 — What do Knights block, and what happens to bluffs?** Only the Betrayal card (Betray the King targets the King, who can't be protected). When a Betrayal is supported against a player with face-down cards in front of them: a real Knight (Noble or King) blocks it and is revealed and discarded; if none is real, the Betrayal succeeds and the face-down bluffs are revealed and discarded.
* **A9 — Who sees face-down cards?** Everyone sees that a card lies face down in front of a player, who put it there, and its **back** (King or Noble deck — visible on a real table). Only the player who placed it knows what it is (the King's Knight text: the protected player can't look at it).
* **A10 — Gold over the 2000 cap.** Card effects never push a balance past 2000; the excess goes back to the bank (e.g. a Betrayal that would take you to 2300 leaves you at 2000). Negotiated transfers that would exceed 2000 are refused instead, so no-one throws gold away by accident.
* **A11 — All amounts are multiples of 100.** Every printed amount is. Negotiated amounts must be multiples of 100 too, so the token always sits on a printed cell. (The tracker still handles any value: the marker sits on the cell for the balance rounded down to 100 and the exact number is printed beside it.)
* **A12 — "Taking" gold.** A forced player-to-player payment caused by a card counts as the card's player **taking** gold (e.g. Tithe, Grudge, Meat for Meat, Icarus winnings, Loyalty, Council Meeting, Anchor, Indebted's per-round payment, which the creditor takes). Losses to the bank are not "taking". This decides Isolation ("no one can take gold from you"), Shifting Tides ("can only take gold from each other") and King's Eye ("takes gold from them" → the Noble pays 100).
* **A13 — Timing words.** "Until your next turn" ends when that player's next turn starts (King's Eye, Shifting Tides); "until the end of your next turn" ends when it finishes (Isolation). Tracked by player, so a crown change doesn't cancel them.
* **A14 — Negotiation limit scope.** The 400 cap counts gold received through negotiated deals only. Card-defined payments that can happen at any time (ending Bad Blood, freeing a debtor) are card effects, not negotiation, and don't count.
* **A15 — Negotiation can end early.** If every connected player presses "Done negotiating", the phase ends before 2:00. Nothing else shortens it.
* **A16 — Card trades between King and Nobles.** Impossible: a card trade would put a King card in a Noble's hand. Gold-only deals with the King are fine.
* **A17 — Disconnections.** Seats are held for the whole game. A disconnected player's prompts take their defaults at the deadline; if it's their turn and they've been gone 60 s, their turn is skipped (no more plays and no end-of-turn draw, but their hand is still topped back up to 8). Negotiation runs on regardless; offers to/from them expire with the phase.
* **A18 — Dice.** Rolls are made by the server when the roller presses Roll. A room can switch to **physical dice**: the roller types the number they rolled on the table (honour system). If a roller never answers, the server rolls for them.

### Cards

* **C1 Betrayal / Betray the King — "vocal support".** Support is given out loud (or in chat) before the card is played. When playing it, the player **names their backer(s)**: for Betrayal one Noble other than themselves and the target; for Betray the King two players other than themselves and the King. The named backers must then confirm on their own phones (30 s / 45 s). If a backer denies it or doesn't answer, the card has no effect. The log shows who backed it. A Hindsight on the player still pays out when the card is played (C3).
* **C2 King Maker — the window.** After Betray the King gets its support, every Noble gets a 20 s King Maker window (everyone sees it, so it doesn't reveal who holds one). Holders may play it on either side. King Maker is played out of turn, doesn't count toward a turn, and its player draws a replacement at once. "Support" means supporting the King (+1). Roll ≤ 3 → swap places and gold; ≥ 4 → King stays and gains 200 (modified rolls outside 1–6 are just compared to these thresholds). The losing side pays 300 each.
* **C3 Hindsight / Scout — deadline and self-backing.** "By the end of the next round": played in round r, settled at the end of round r+1 (round 4 → at the end of the game, before the winner is read). They pay out the moment the backed Noble plays a Betrayal (even an unsupported one) / becomes King. You must back a Noble other than yourself.
* **C4 Bad Blood / Indebted.** Payouts happen at the start of every later round. Bad Blood ends when either of the two picked Nobles (not you) pays the other 200: either with the button (Trade/Deals tab or the player's details, any time no card is resolving, no confirmation needed) or by giving the other 200+ gold in an accepted negotiation deal. Indebted: any player other than the debtor and creditor may free the debtor by paying the creditor 200. "Any debts are gone if you become king" = debts **owed to the card's player** vanish when that player becomes King. A debtor with less than 100 pays what they have.
* **C5 People's Champion.** You may nominate any Noble, including yourself. All Nobles other than the nominee vote (your own vote counts as yes); unanimous yes → nominee and King roll (reroll ties); higher wins the throne without moving gold (see A1).
* **C6 Black Plague pairing.** The King arranges the pairs (the King played the card). With an odd number of Nobles the King rolls alongside the lone Noble; only the Noble can lose gold.
* **C7 Scapegoat.** "Your left" = the next seat clockwise; voting goes clockwise from there, publicly, one Noble at a time. A tie is settled by a roll-off between the tied Nobles: lowest roll loses the 300 (rerolling a tie for lowest).
* **C8 Sub Rosa (Noble).** Looking at a hand lets you pick which card to take on a 4+; looking at a face-down card means you take a card **blind** from the hand of the player it protects. Nobles can't take King cards, and the Royal Bomb can't be stolen. The victim draws a replacement.
* **C9 Sub Rosa (King).** On a 4+ the King picks one card from the hand he looked at to discard (not the Royal Bomb); the victim draws a replacement.
* **C10 Anchor.** The King picks the target Noble and "the player of your choice" up front; the target chooses which happens.
* **C11 Allies, Grudge, Loyalty, Tithe, Debt Collector, Bend the Knee, Royal Parrot, We Ride Together** — the other player's decision is a prompt with a timeout default: Allies → you gain 100; Grudge → disagree; Loyalty → they pay you; Tithe / Debt Collector → a random eligible player; Bend the Knee → thank; Royal Parrot → repeat; We Ride Together → no split.
* **C12 Spoken/social cards** (Actors, Council Meeting's praise, Loyalty's pledge, Loyal Dog, Bend the Knee, Royal Parrot). In person they are said out loud (M1). Online, the player taps (or types) their line and it is posted to the table as a highlighted "speech". When something rides on the line, the speaker taps whether they said it, and the reward only comes after: **Loyal Dog's gold** and **Council Meeting's two cards** are paid once they confirm, and "Refuse" gets them nothing (default if they don't answer: refuse). Bend the Knee and Royal Parrot already work this way, with their printed 300 penalty. Actors and Loyalty's pledge change no gold, so they stay an instruction to the table.
* **C13 Isolation vs looking.** "Look at your cards" covers your hand and face-down cards in front of you.
* **C14 Shifting Tides** restricts only the two named Nobles as takers; other players may still take from them.
* **C15 Royal Bomb** can be given away only as one side of a 1-for-1 card exchange (rule 17) or discarded as part of an accepted deal, both during negotiation. It's discarded before the hand swap when its holder becomes King.
* **C16 Targets.** Where a card says "a noble"/"a player" and targeting yourself would be meaningless (Allies, Betrayal, Meat for Meat, Wrath, Tithe, Grudge's victim…), you can't pick yourself. Cards that say "a player of your choice" may target the King unless the effect would be meaningless (Loyalty's second option, which pays the King). The full per-card target list is in the catalog.
* **C17 Icarus "if you can afford it"** = you have at least 100 × (number of other Nobles).
* **C18 Unprotected** removes face-down cards in front of every player except you; removed cards are discarded unrevealed.
* **C20 Overruling a spoken line (in person).** The game can't hear what's said at the table, so when a player taps that they said a line that something rides on (Loyal Dog's pledge, Council Meeting's praise, Bend the Knee's thanks, the Royal Parrot), the log entry becomes a **claim**. Any other player can tap it and vote to overrule. If **every** other player (the King included, the speaker excluded) votes to overrule, the speaker is treated as having refused: Loyal Dog's gold goes back to the bank, Council Meeting's two drawn cards are discarded (a random card from hand replaces one already played), and Bend the Knee / Royal Parrot cost the printed 300. Votes can be withdrawn. A claim can be overruled until the end of the round it was made in (after that round's negotiation). An overrule that completes mid-card is applied once that card is resolved. Actors and Loyalty's pledge change nothing, so there is nothing to overrule. Online the game posts the line itself, so there are no claims.
* **C19 Council Meeting's vote** ("if all players vote yes, you take 100 gold from the king") is a vote of the **other Nobles** only. The King is the one losing the gold, so letting him vote would let him veto every Council Meeting.

### Same room vs apart (host setting)

* **M1 — In person (default).** Players talk out loud, so there is no chat. Spoken-line cards (C12) show an instruction on every phone ("Bob must say: …") and do not wait; the Royal Parrot's sentence is spoken by the King, not typed. Anything that changes the game state stays a button: votes, Betrayal backers, King Maker, dice, and choices that cost gold (refusing Bend the Knee or the Parrot). A spoken line with something riding on it can be overruled by the rest of the table (C20).
* **M2 — In-person trading.** Negotiation is verbal; the phones only record what physically changes hands: give gold, swap a card (1-for-1), discard a card as part of a deal. Each needs the other player's confirmation. An offer still unanswered when the phase ends expires, and both players are told nothing changed hands. Multi-part deals are separate handovers, so — exactly as at a real table — either side can renege halfway (Rules p14: no deal is binding).
* **M3 — Virtual.** Table chat, private messages, combined deal offers, and spoken lines as speech bubbles.
* **M4 — Swapped cards stay face down** until the swap happens, in both modes: the rules let players lie about what they're offering. A card discarded as part of a deal is shown, since discards are put down openly.

### Things the digital edition adds (not rules)

4-digit room codes, reconnect tokens, the everyone's-gold view, the response timeouts above, the "Done negotiating" early finish, in-room chat, and the optional physical-dice mode.
