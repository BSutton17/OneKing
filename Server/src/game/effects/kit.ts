// Helpers shared by the card handlers.

import { cardDef } from '../../cards/catalog.js';
import { canLook, canTake } from '../protection.js';
import { ask } from '../prompts.js';
import { log, nameOf } from '../state.js';
import type { GameState, PlayerId, Resolution } from '../types.js';
import type { FieldSpec } from './types.js';

export const playerField = (g: GameState, name: string, label: string, ids: PlayerId[], distinctFrom?: string[]): FieldSpec => ({
  name, kind: 'player', label, distinctFrom,
  choices: ids.map((id) => ({ value: id, label: nameOf(g, id) })),
});

export const amountField = (name: string, label: string, amounts: number[]): FieldSpec => ({
  name, kind: 'choice', label, choices: amounts.map((a) => ({ value: String(a), label: `${a} gold` })),
});

export const takeable = (g: GameState, actor: PlayerId, ids: PlayerId[]) => ids.filter((id) => canTake(g, actor, id));
export const lookable = (g: GameState, actor: PlayerId, ids: PlayerId[]) => ids.filter((id) => canLook(g, actor, id));

export const target = (res: Resolution, name = 'target'): PlayerId => res.setup[name] as string;

export const src = (res: Resolution) => `card:${res.cardKey}`;

/** "Alice plays Wrath on Bob" — the public line for a card being played. */
export function announce(g: GameState, res: Resolution, detail = ''): void {
  const def = cardDef(res.cardKey!);
  const option = def.options && res.option !== undefined ? ` (option ${res.option + 1})` : '';
  log(g, 'play', `${nameOf(g, res.actor)} plays ${def.name}${option}${detail ? ` — ${detail}` : ''}`, { actor: res.actor, cardKey: res.cardKey });
}

export const say = (g: GameState, text: string) => log(g, 'info', text);

/**
 * A card makes players say something. Virtual: each of them gets a prompt and
 * their line is posted to the table. In person: they say it out loud — every
 * screen shows the instruction and the game doesn't wait (C12).
 */
export function speak(g: GameState, res: Resolution, o: { who: PlayerId[]; line: string; instruction: string; title: string; text: string; allowCustom?: boolean }): void {
  if (g.config.mode === 'inPerson') {
    log(g, 'say', `📣 ${o.instruction}`, { actor: o.who.length === 1 ? o.who[0] : undefined });
    return;
  }
  ask(g, res, { kind: 'speech', title: o.title, text: o.text, who: o.who, speech: o.line, allowCustom: o.allowCustom, ms: g.config.speechMs });
}
