import { rolloff } from '../king.js';
import type { Resolution } from '../types.js';
import { kingCards } from './kingCards.js';
import { noble } from './noble.js';
import type { CardHandler } from './types.js';

const BY_KEY: Record<string, CardHandler> = {
  ...Object.fromEntries(Object.entries(noble).map(([id, h]) => [`noble:${id}`, h])),
  ...Object.fromEntries(Object.entries(kingCards).map(([id, h]) => [`king:${id}`, h])),
};

export function handlerForKey(key: string): CardHandler {
  const h = BY_KEY[key];
  if (!h) throw new Error(`No handler for ${key}`);
  return h;
}

export function handlerFor(res: Resolution): CardHandler {
  return res.kind === 'rolloff' ? rolloff : handlerForKey(res.cardKey!);
}

export const HANDLED_KEYS = Object.keys(BY_KEY);
