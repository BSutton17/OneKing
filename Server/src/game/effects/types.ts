import type { GameState, PlayerId, Prompt, Resolution, Setup } from '../types.js';

/** One thing the card's player must choose before the card resolves. */
export interface FieldSpec {
  name: string;
  kind: 'player' | 'choice' | 'text' | 'order';
  label: string;
  choices?: { value: string; label: string }[];
  distinctFrom?: string[]; // must differ from these other fields
  maxLength?: number; // text
}

export interface CardHandler {
  /** Why the card can't be played right now (beyond missing targets), or null. */
  check?(g: GameState, actor: PlayerId, option: number): string | null;
  /** What the player picks up front. A field with no choices = no valid target. */
  fields?(g: GameState, actor: PlayerId, option: number): FieldSpec[];
  /** Cross-field checks after each field was validated against its choices. */
  validate?(g: GameState, actor: PlayerId, option: number, setup: Setup): string | null;
  start(g: GameState, res: Resolution): void;
  /** Called with the finished prompt (already removed from res.prompt). */
  onPrompt?(g: GameState, res: Resolution, prompt: Prompt): void;
  /** Helping Hand: doesn't count toward the turn's plays. */
  notCounted?: boolean;
  /** Can't be played with the Play action (King Maker, the Knights). */
  playable?: false;
  unplayableReason?: string;
}
