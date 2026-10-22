// sfc32: a small seeded generator whose whole state lives in GameState.rng,
// so shuffles and dice are server-controlled, survive a restart, and are
// reproducible in tests.

import { randomInt } from 'node:crypto';
import type { GameState } from './types.js';

export function seedRng(seed?: number): number[] {
  const s = seed ?? randomInt(0, 2 ** 32);
  const state = [0x9e3779b9, 0x243f6a88, 0xb7e15162, s >>> 0];
  for (let i = 0; i < 15; i++) next(state);
  return state;
}

function next(s: number[]): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return t / 4294967296;
}

export function random(g: GameState): number {
  return next(g.rng);
}

export function randomIndex(g: GameState, n: number): number {
  return Math.floor(random(g) * n);
}

export function rollDie(g: GameState): number {
  return 1 + randomIndex(g, 6);
}

export function shuffle<T>(g: GameState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomIndex(g, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
