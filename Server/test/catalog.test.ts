import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CARDS } from '../src/cards/catalog.js';
import { HANDLED_KEYS } from '../src/game/effects/index.js';

const art = (p: string) => fileURLToPath(new URL(`../../Client/public/${p}`, import.meta.url));

test('the catalog has the 99 printed cards: 25 King, 74 Noble, 44 different faces', () => {
  assert.equal(CARDS.length, 44);
  assert.equal(CARDS.filter((c) => c.deck === 'king').reduce((s, c) => s + c.copies, 0), 25);
  assert.equal(CARDS.filter((c) => c.deck === 'noble').reduce((s, c) => s + c.copies, 0), 74);
});

test('copy counts match what the extraction tool counted on the PDF sheets', () => {
  const manifest = JSON.parse(readFileSync(art('art/manifest.json'), 'utf8'));
  for (const c of CARDS) assert.equal(manifest.copies[c.key], c.copies, c.key);
  assert.equal(Object.keys(manifest.copies).length, CARDS.length);
});

test('every card has a rules handler and its official artwork', () => {
  for (const c of CARDS) {
    assert.ok(HANDLED_KEYS.includes(c.key), `${c.key} has no handler`);
    assert.ok(existsSync(art(c.art.full)), `${c.art.full} missing`);
    assert.ok(existsSync(art(c.art.small)), `${c.art.small} missing`);
  }
});

test('dotted-line cards keep both printed halves', () => {
  const dotted = CARDS.filter((c) => c.options).map((c) => c.key).sort();
  assert.deepEqual(dotted, ['noble:actors', 'noble:council_meeting', 'noble:isolation', 'noble:loyalty', 'noble:wrath']);
  for (const c of CARDS.filter((x) => x.options)) assert.ok(c.printedText.includes(c.options![0]) && c.printedText.includes(c.options![1]));
});
