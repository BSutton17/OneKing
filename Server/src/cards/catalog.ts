// The official cards, transcribed from "All Cards.pdf". printedText is exactly
// what is printed on the card; dotted-line cards list each half in `options`.
// Copy counts come from the card sheets (tools/extract_assets.py checks them).
// What the engine does with each card lives in game/effects/*.ts; `effect`,
// `targets` and `notes` here document it (docs/card-catalog.md is generated
// from this file: npm run catalog:doc).

import type { DeckName } from '../game/types.js';

export interface CardDef {
  key: string; // `${deck}:${id}`
  id: string;
  deck: DeckName;
  name: string;
  copies: number;
  printedText: string;
  options?: [string, string]; // the two halves of a dotted-line card
  dice?: string;
  timing?: string;
  targets: string;
  effect: string;
  notes?: string[]; // rule-audit references
  art: { full: string; small: string };
}

type Def = Omit<CardDef, 'key' | 'art' | 'deck'>;

const DOT = '\n••••••••\n';

const noble: Def[] = [
  {
    id: 'actors', name: 'Actors', copies: 3,
    options: ['Everyone must thank the king for their glorious rule however horrible and cruel it might have been.', 'Everyone must laugh at the player of your choice.'],
    printedText: '', targets: 'Option 2: any other player.',
    effect: 'No gold changes. Everyone asked gets a one-tap line to say (posted to the table).', notes: ['C12'],
  },
  {
    id: 'allies', name: 'Allies', copies: 3,
    printedText: 'Pick a noble. They choose if you gain 100 gold or lose 200 to the bank. Other players can convince them to take the second option.',
    targets: 'Another Noble.', effect: 'The Noble chooses: you gain 100 from the bank, or you lose 200 to the bank.', notes: ['C11'],
  },
  {
    id: 'bad_blood', name: 'Bad Blood', copies: 3,
    printedText: 'Pick two nobles. You gain 200 gold from the bank at the beginning of every round until one of them gives the other 200 gold. They can make this payment out of turn.',
    targets: 'Two other Nobles.', effect: 'Lasting: +200 to you at the start of each later round until either of the two pays the other 200.', notes: ['C4'],
  },
  {
    id: 'beggars_blessing', name: "Beggar's Blessing", copies: 3,
    printedText: 'All nobles with 300 gold or lower gain 200.',
    targets: 'None.', effect: 'Every Noble with ≤300 gains 200 from the bank.',
  },
  {
    id: 'betrayal', name: 'Betrayal', copies: 4,
    printedText: "Take all gold from another noble. Requires vocal support from another noble after it's played or it has no effect. Not playable in the first round.",
    timing: 'Rounds 2–4.', targets: 'Another Noble.',
    effect: 'Support window; with 1 supporting Noble you take all their gold unless a real Knight is in front of them.', notes: ['A8', 'C1'],
  },
  {
    id: 'betray_the_king', name: 'Betray the King', copies: 2,
    printedText: "The King rolls: 1–3, you switch places and gold. 4–6, they remain king and gain 200 gold from the bank. After it's played, you must gain vocal support from TWO players or it has no effect. Not playable in the first round.",
    timing: 'Rounds 2–4.', dice: 'The King rolls (King Maker modifies it).', targets: 'The King.',
    effect: 'Support window (2 players), King Maker window, King rolls: ≤3 you become King and swap gold; ≥4 the King gains 200.', notes: ['C1', 'C2'],
  },
  {
    id: 'council_meeting', name: 'Council Meeting', copies: 3,
    options: ['If all players vote yes, you take 100 gold from the king. If one votes no, you lose 100 to the bank', 'Draw two cards, but you must praise the king.'],
    printedText: '', targets: 'None.',
    effect: 'Option 1: the other Nobles vote (not the King); all yes → take 100 from the King, any no → lose 100. Option 2: praise the King and draw 2 cards — refuse and draw nothing.', notes: ['A12', 'C12', 'C19'],
  },
  {
    id: 'divine_right', name: 'Divine Right', copies: 1,
    printedText: 'If you roll 5+: You gain 1200 gold. Play only if you have 300 gold or less. Can only be played or discarded in the last 2 rounds.',
    timing: 'Rounds 3–4, only with ≤300 gold.', dice: 'You roll: 5–6 wins.', targets: 'None.', effect: 'Roll 5+ → gain 1200 from the bank.',
  },
  {
    id: 'grudge', name: 'Grudge', copies: 2,
    printedText: 'Pick a player. They have to agree to you taking 200 gold from the noble of your choice. If they disagree, you lose 100 gold to the bank.',
    targets: 'A judge (any other player) and a victim (another Noble).',
    effect: 'The judge agrees → you take 200 from the victim; disagrees → you lose 100.', notes: ['A12', 'C11'],
  },
  {
    id: 'helping_hand', name: 'Helping Hand', copies: 3,
    printedText: 'Draw 2 extra cards and play an extra card. So, if this is your first card, you get to play 3 more now.',
    targets: 'None.', effect: "Draw 2 now; doesn't count as a play and gives +1 play this turn.", notes: ['A5'],
  },
  {
    id: 'hindsight', name: 'Hindsight', copies: 2,
    printedText: 'Back a specific noble to play the "Betrayal" card before the end of the next round. If correct, gain 300 gold from the bank. If not, lose 100. Keep this in front of you until then.',
    targets: 'Another Noble.', effect: 'Stays in front of you: +300 when they play a Betrayal, −100 if they haven\'t by the end of next round.', notes: ['C3'],
  },
  {
    id: 'icarus', name: 'Icarus', copies: 2,
    printedText: 'If you roll a 4-6, all nobles must pay you 100 gold. If you fail, you must pay each noble 100 gold. You can only play this card if you can afford it.',
    timing: 'Only with ≥100 × other Nobles.', dice: 'You roll: 4–6 wins.', targets: 'All other Nobles.',
    effect: 'Win → take 100 from each other Noble; lose → pay each other Noble 100.', notes: ['A12', 'C17'],
  },
  {
    id: 'indebted', name: 'Indebted', copies: 2,
    printedText: 'If you roll a 3-6, a noble has to pay you 100 gold at the beginning of every round until another player frees them by paying you 200. This payment can be made at any time. Any debts are gone if you become king.',
    dice: 'You roll: 3–6 wins.', targets: 'Another Noble (the debtor).',
    effect: 'Lasting debt: the debtor pays you 100 at the start of each later round until someone else pays you 200.', notes: ['C4'],
  },
  {
    id: 'isolation', name: 'Isolation', copies: 3,
    options: ['No one can look at your cards until the end of your next turn.', 'No one can take gold from you until the end of your next turn. This does not apply to the Betrayal card.'],
    printedText: '', targets: 'Yourself.', effect: 'A protection on you until the end of your next turn.', notes: ['A12', 'A13', 'C13'],
  },
  {
    id: 'king_maker', name: 'King Maker', copies: 2,
    printedText: 'Play this card out of turn when you or someone plays "Betray the King". Choose a side: support (+1 to the King\'s roll) or oppose (−1 to the King\'s roll). If your side fails, pay 300 gold to the bank.',
    timing: 'Only in the King Maker window of a Betray the King.', targets: 'A side.',
    effect: '±1 on the King\'s roll; the losing side pays 300.', notes: ['C2'],
  },
  {
    id: 'knight', name: 'Knight', copies: 2,
    printedText: 'Place this card FACE DOWN in front of you to protect you from one betrayal. Placing a knight down counts as a card played.',
    targets: 'Yourself.', effect: 'Face down in front of you; blocks one Betrayal.', notes: ['A8', 'A9'],
  },
  {
    id: 'loyalty', name: 'Loyalty', copies: 3,
    options: ['Pick a player. They choose whether to pay you 100 gold or force the king pay you.', 'Force a player to pay the king 100 gold and pledge their loyalty to them.'],
    printedText: '', targets: 'Option 1: any other player. Option 2: another Noble.',
    effect: 'Option 1: they choose who pays you 100 (them or the King). Option 2: they pay the King 100 and pledge loyalty.', notes: ['A12', 'C11', 'C12'],
  },
  {
    id: 'meat_for_meat', name: 'Meat for Meat', copies: 4,
    printedText: 'You and another noble roll. If you roll higher, you collect 200 from them.',
    dice: 'You and the Noble roll.', targets: 'Another Noble.', effect: 'Higher roll than them → take 200 from them.', notes: ['A12'],
  },
  {
    id: 'peoples_champion', name: "People's Champion", copies: 1,
    printedText: 'Nominate a noble as King. If all other nobles agree, they roll against the current King to take the throne. Can only be played or discarded in the last round.',
    timing: 'Round 4.', dice: 'Nominee vs King.', targets: 'Any Noble (you may nominate yourself).',
    effect: 'Unanimous Noble vote → nominee and King roll; higher roll takes the throne.', notes: ['A1', 'C5'],
  },
  {
    id: 'royal_bomb', name: 'Royal Bomb', copies: 1,
    printedText: 'You and everyone else (excluding the king) lose 800 gold. This card cannot be stolen and can only be discarded or given away by you during the "Negotiation Phase". If you become king, the card is discarded. Use this card to pressure and negotiate.',
    targets: 'All Nobles including you.', effect: 'You and every other Noble lose 800 to the bank.', notes: ['C15'],
  },
  {
    id: 'scout', name: 'Scout', copies: 2,
    printedText: "Back a noble to become king by the end of the next round. If you're correct, earn 300 gold from the bank. If you're wrong, lose 100. Keep this card in front of you until then.",
    targets: 'Another Noble.', effect: 'Stays in front of you: +300 when they become King, −100 if they haven\'t by the end of next round.', notes: ['C3'],
  },
  {
    id: 'shadow_deal', name: 'Shadow Deal', copies: 5,
    printedText: 'Give another player 100 or 200 gold (you pick) from the bank. You can give it to the king.',
    targets: 'Any other player.', effect: 'They gain 100 or 200 from the bank.',
  },
  {
    id: 'sub_rosa', name: 'Sub Rosa', copies: 5,
    printedText: "Look at any player's hand or one face down knight card (pick one). If you roll a 4 or higher you can take a card from their hand.",
    dice: 'You roll: 4–6 wins.', targets: "Another player's hand, or one face-down card.",
    effect: 'Look privately; on 4+ take a card from that player\'s hand (chosen if you saw the hand, blind otherwise).', notes: ['C8', 'C13'],
  },
  {
    id: 'subsidies', name: 'Subsidies', copies: 3,
    printedText: 'All nobles get gold for as much gold as they have:\nNo gold – Receive 300\n100-300 – Receive 200\n400-500 – Receive 100',
    targets: 'None.', effect: 'Every Noble: 0 → +300, 100–300 → +200, 400–500 → +100.',
  },
  {
    id: 'suppress_rebellion', name: 'Suppress Rebellion', copies: 2,
    printedText: 'If the king pathetically rolls a 1-3, the bank must give you 200 gold and every other noble 100 gold.',
    dice: 'The King rolls: 1–3 wins.', targets: 'None.', effect: 'King rolls 1–3 → you +200, every other Noble +100.',
  },
  {
    id: 'tithe', name: 'Tithe', copies: 2,
    printedText: 'Pick a player. They must pick a noble to give you 100 gold.',
    targets: 'Any other player picks a Noble (not you).', effect: 'The picked Noble gives you 100.', notes: ['A12', 'C11'],
  },
  {
    id: 'unprotected', name: 'Unprotected', copies: 2,
    printedText: 'If you roll a 5-6, all face down knights in play are removed except yours.',
    dice: 'You roll: 5–6 wins.', targets: 'None.', effect: 'Every face-down card not in front of you is discarded unrevealed.', notes: ['C18'],
  },
  {
    id: 'wrath', name: 'Wrath', copies: 4,
    options: ['You lose 100 gold, but a noble of your choice loses 300.', 'Make a player lose 100 to the bank.'],
    printedText: '', targets: 'Option 1: another Noble. Option 2: any other player.',
    effect: 'Option 1: you −100, they −300. Option 2: they −100.',
  },
];

const king: Def[] = [
  {
    id: 'black_plague', name: 'Black Plague', copies: 1,
    printedText: 'All nobles pair up and each roll a die. If either noble in a pair rolls a 1, both nobles in that pair lose 200 gold. If there is an odd number of nobles, roll with a lone one, but only they can lose gold.',
    dice: 'Every Noble rolls (the King too, with an odd number).', targets: 'All Nobles, paired by the King.',
    effect: 'A 1 in a pair → both Nobles of the pair −200.', notes: ['C6'],
  },
  {
    id: 'eye_for_an_eye', name: 'Eye for an Eye', copies: 1,
    printedText: 'You lose 100 gold to the bank but a player of your choice loses 300.',
    targets: 'Any Noble.', effect: 'You −100, they −300.',
  },
  {
    id: 'bend_the_knee', name: 'Bend the Knee', copies: 2,
    printedText: "Force a player to thank you for everything you've done for them. If they refuse, they pay the bank 300 gold. If they cannot afford to, they must thank you.",
    targets: 'Any Noble.', effect: 'They thank you (said to the table) or pay 300.', notes: ['C11', 'C12'],
  },
  {
    id: 'helping_hand', name: 'Helping Hand', copies: 1,
    printedText: "First draw two, then play an extra card. So, if this is your first card, you play 4 more now (or 3, if you're only playing with 3 nobles).",
    targets: 'None.', effect: "Draw 2 now; doesn't count as a play and gives +1 play this turn.", notes: ['A5'],
  },
  {
    id: 'knight', name: 'Knight', copies: 1,
    printedText: "Place this card face down in front of a player to protect them from one Betrayal card. They can't look at it.",
    targets: 'A Noble.', effect: 'Face down in front of them; blocks one Betrayal. Only you know what it is.', notes: ['A8', 'A9'],
  },
  {
    id: 'anchor', name: 'Anchor', copies: 2,
    printedText: 'Player loses 200 gold to the bank or lets the player of your choice lose 100 to you.',
    targets: 'A Noble, plus a Noble of your choice.', effect: 'The first Noble chooses: they lose 200, or the second loses 100 to you.', notes: ['A12', 'C10'],
  },
  {
    id: 'loyal_dog', name: 'Loyal Dog', copies: 3,
    printedText: 'Give a player 100 to 300 gold (you pick) from the bank but they must say "Thank you my king, I pledge my loyalty to you my king."',
    targets: 'Any Noble.', effect: 'They say the pledge and then gain 100/200/300 from the bank — refuse and they get nothing.', notes: ['C12'],
  },
  {
    id: 'mad_king', name: 'Mad King', copies: 1,
    printedText: 'Force everyone to roll dice. Whoever rolls a 1 loses 300 to the bank. You must roll as well. If you roll a 1 you lose 500.',
    dice: 'Everyone rolls.', targets: 'Everyone.', effect: 'Nobles rolling 1 lose 300; you lose 500 on a 1.',
  },
  {
    id: 'debt_collector', name: 'Debt Collector', copies: 2,
    printedText: 'Pick a player. This player picks someone to lose 200 gold to the bank.',
    targets: 'A Noble, who picks anyone.', effect: 'The picked player loses 200 to the bank.', notes: ['C11'],
  },
  {
    id: 'royal_parrot', name: 'Royal Parrot', copies: 2,
    printedText: 'As the royal parrot, a player of your choice has to pay the bank 100 gold then repeat a sentence you give them in a high-pitched voice. 300 to the bank if they refuse.',
    targets: 'A Noble, plus your sentence.', effect: 'They pay 100, then repeat your sentence or pay 300 more.', notes: ['C11', 'C12'],
  },
  {
    id: 'shifting_tides', name: 'Shifting Tides', copies: 1,
    printedText: 'Pick two nobles. They can only take gold from each other until your next turn. This does not include Betrayal cards.',
    targets: 'Two Nobles.', effect: 'Until your next turn, those two may only take gold from each other.', notes: ['A12', 'A13', 'C14'],
  },
  {
    id: 'snakes', name: 'Snakes', copies: 1,
    printedText: 'Pick a player and announce it. All nobles must vote by raising their hand. If even one noble raises their hand, the chosen player loses 300 gold to the bank.',
    targets: 'Any Noble.', effect: 'Secret vote of all Nobles; one raised hand → they lose 300.',
  },
  {
    id: 'sub_rosa', name: 'Sub Rosa', copies: 2,
    printedText: "Look at another player's hand. If you roll a 4 or higher, you can also discard a card.",
    dice: 'You roll: 4–6 wins.', targets: "A Noble's hand.", effect: 'Look privately; on 4+ discard a card of your choice from it.', notes: ['C9', 'C13'],
  },
  {
    id: 'scapegoat', name: 'Scapegoat', copies: 1,
    printedText: 'Each noble must vote on another noble to lose 300 gold to the bank, starting from the noble to your left. A tie is decided by a dice roll.',
    dice: 'Only to break a tie.', targets: 'All Nobles vote.', effect: 'Most votes loses 300; ties → lowest roll among the tied.', notes: ['C7'],
  },
  {
    id: 'kings_eye', name: "King's Eye", copies: 2,
    printedText: 'Protect a player of your choice until your next turn. If a noble looks at their cards or takes gold from them, they must pay the bank 100 gold.',
    targets: 'Any player (you too).', effect: 'Until your next turn, a Noble who looks at their cards or takes their gold pays 100.', notes: ['A12', 'A13'],
  },
  {
    id: 'we_ride_together', name: 'We Ride Together', copies: 2,
    printedText: 'Pick two players. Whoever rolls lower between them has to lose 200 gold to the bank. Players can agree to lose 100 gold each instead only AFTER they both roll. Roll again if they tie.',
    dice: 'Both players roll.', targets: 'Two players.', effect: 'Lower roll −200, unless both agree to −100 each.', notes: ['C11'],
  },
];

function build(deck: DeckName, defs: Def[]): CardDef[] {
  return defs.map((d) => {
    const art = `art/cards/${deck}/${d.id}`;
    return {
      ...d,
      deck,
      key: `${deck}:${d.id}`,
      printedText: d.options ? d.options.join(DOT) : d.printedText,
      art: { full: `${art}.webp`, small: `${art}.sm.webp` },
    };
  });
}

export const CARDS: CardDef[] = [...build('noble', noble), ...build('king', king)];
export const CARD_BY_KEY: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.key, c]));

export function cardDef(key: string): CardDef {
  const def = CARD_BY_KEY[key];
  if (!def) throw new Error(`Unknown card ${key}`);
  return def;
}
