import { describe, expect, test } from 'vitest';
import { characterCard } from './art';
import { cellFor } from './money';

describe('money tracker positions', () => {
  for (const role of ['king', 'noble'] as const) {
    const geo = characterCard(role);

    test(`${role}: every balance 0..2000 lands on its own printed cell, in reading order`, () => {
      const seen = new Set<string>();
      for (let gold = 0; gold <= 2000; gold += 100) {
        const c = cellFor(gold, geo);
        const index = gold / 100;
        // inside the measured grid cell for that value
        const [col, row] = [index % 3, Math.floor(index / 3)];
        const px = (c.x / 100) * geo.width;
        const py = (c.y / 100) * geo.height;
        expect(px).toBeGreaterThan(geo.colEdges[col]);
        expect(px).toBeLessThan(geo.colEdges[col + 1]);
        expect(py).toBeGreaterThan(geo.rowEdges[row]);
        expect(py).toBeLessThan(geo.rowEdges[row + 1]);
        expect(c.exact).toBe(true);
        seen.add(`${c.x.toFixed(2)},${c.y.toFixed(2)}`);
      }
      expect(seen.size).toBe(21);
    });

    test(`${role}: 0 is top-left, 2000 bottom-right, 1000 in the middle of row 4`, () => {
      const zero = cellFor(0, geo);
      const top = cellFor(2000, geo);
      const mid = cellFor(1000, geo);
      expect(zero.x).toBeLessThan(mid.x);
      expect(mid.x).toBeLessThan(top.x);
      expect(zero.y).toBeLessThan(mid.y);
      expect(mid.y).toBeLessThan(top.y);
    });
  }

  test('balances outside 0..2000 clamp; non-multiples of 100 round down but say so', () => {
    const geo = characterCard('noble');
    expect(cellFor(-300, geo).value).toBe(0);
    expect(cellFor(5000, geo).value).toBe(2000);
    const odd = cellFor(650, geo);
    expect(odd.value).toBe(600);
    expect(odd.exact).toBe(false);
  });
});
