// Where the gold token sits on a printed character card. The card prints 21
// cells, 0..2000 in steps of 100, three per row. Positions are percentages of
// the card image so the token stays on its cell at any size.
//
// Rule for a balance that isn't a multiple of 100 (never produced by the
// printed cards, but handled anyway): the token sits on the cell for the
// balance rounded DOWN to 100, and the exact number is always shown beside it.

import type { CharacterGeometry } from './art';

export const GOLD_MIN = 0;
export const GOLD_MAX = 2000;

export interface CellBox { x: number; y: number; w: number; h: number; value: number; exact: boolean } // % of the image

export function cellFor(gold: number, g: CharacterGeometry): CellBox {
  const clamped = Math.max(GOLD_MIN, Math.min(GOLD_MAX, Number.isFinite(gold) ? gold : 0));
  const value = Math.floor(clamped / 100) * 100;
  const index = value / 100;
  const col = index % 3;
  const row = Math.floor(index / 3);
  const [x0, x1] = [g.colEdges[col], g.colEdges[col + 1]];
  const [y0, y1] = [g.rowEdges[row], g.rowEdges[row + 1]];
  return {
    x: ((x0 + x1) / 2 / g.width) * 100,
    y: ((y0 + y1) / 2 / g.height) * 100,
    w: ((x1 - x0) / g.width) * 100,
    h: ((y1 - y0) / g.height) * 100,
    value,
    exact: value === gold,
  };
}
