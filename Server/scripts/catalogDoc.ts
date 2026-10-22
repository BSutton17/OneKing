// Writes docs/card-catalog.md from src/cards/catalog.ts (npm run catalog:doc).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARDS, type CardDef } from '../src/cards/catalog.js';

const row = (c: CardDef) => {
  const text = (c.options ? c.options.map((o, i) => `**${i + 1}.** ${o}`).join('<br>') : c.printedText).replace(/\n/g, '<br>').replace(/\|/g, '\|');
  const extra = [c.timing && `Timing: ${c.timing}`, c.dice && `Dice: ${c.dice}`].filter(Boolean).join('<br>');
  return `| <img src="../Client/public/${c.art.small}" width="90"> | **${c.name}**<br>\`${c.key}\` ×${c.copies} | ${text} | ${c.targets} | ${c.effect}${extra ? `<br>${extra}` : ''} | ${(c.notes ?? []).join(', ')} |`;
};

const section = (deck: 'king' | 'noble') => {
  const cards = CARDS.filter((c) => c.deck === deck);
  const total = cards.reduce((s, c) => s + c.copies, 0);
  return [
    `## ${deck === 'king' ? 'King' : 'Noble'} deck — ${total} cards, ${cards.length} faces`,
    '',
    '| Art | Card | Printed text | Targets | What the engine does | Rule audit |',
    '|---|---|---|---|---|---|',
    ...cards.map(row),
    '',
  ].join('\n');
};

const md = [
  '# Card catalog',
  '',
  'Generated from `Server/src/cards/catalog.ts` by `npm run catalog:doc` — edit the catalog, not this file.',
  'Printed text is transcribed exactly from `All Cards.pdf`; artwork is cropped from the same PDF by `tools/extract_assets.py`.',
  'Rule-audit ids (A*, C*) point to [rule-audit.md](rule-audit.md). Handlers: `Server/src/game/effects/`.',
  '',
  section('noble'),
  section('king'),
].join('\n');

writeFileSync(fileURLToPath(new URL('../../docs/card-catalog.md', import.meta.url)), md);
console.log('wrote docs/card-catalog.md');
