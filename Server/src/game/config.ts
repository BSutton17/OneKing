import type { GameConfig } from './types.js';

export const MIN_PLAYERS = 4; // Rules p5
export const MAX_PLAYERS = 8;
export const ROUNDS = 4;
export const HAND_SIZE = 8; // Rules p7 / p15
export const GOLD_MIN = 0; // Rules p16
export const GOLD_MAX = 2000;
export const START_GOLD = { king: 1000, noble: 600 }; // Rules p6
export const NEGOTIATION_RECEIVE_LIMIT = 400; // Rules p14
export const OFFICIAL_NEGOTIATION_MS = 2 * 60_000; // Rules p13

export const DEFAULT_CONFIG: GameConfig = {
  negotiationMs: OFFICIAL_NEGOTIATION_MS,
  diceMode: 'digital',
  kingCheck: 'onChange',
  responseMs: 60_000,
  voteMs: 45_000,
  rollMs: 30_000,
  speechMs: 30_000,
  revealMs: 45_000,
  betrayalSupportMs: 30_000,
  betrayKingSupportMs: 45_000,
  kingMakerMs: 20_000,
  disconnectedTurnMs: 60_000,
};

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
