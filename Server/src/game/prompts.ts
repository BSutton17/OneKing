// Prompts: the questions a card puts to players (votes, choices, rolls,
// support windows...). A card handler asks; players answer through the
// 'respond' action; when everyone needed has answered (or the deadline passes
// and the documented defaults are filled in) the handler's onPrompt runs.

import { handHas, refill, removeFromHand } from './cards.js';
import { randomIndex, rollDie } from './rng.js';
import { fail, log, nameOf, nextId } from './state.js';
import type { GameState, PlayerId, Prompt, PromptKind, Resolution, Response } from './types.js';

export type AskSpec = Omit<Prompt, 'id' | 'responses' | 'deadline' | 'need'> & { ms: number; need?: Prompt['need'] };

export function ask(g: GameState, res: Resolution, spec: AskSpec): Prompt {
  const { ms, ...rest } = spec;
  const prompt: Prompt = { need: 'all', ...rest, id: nextId(g, 'q'), responses: {}, deadline: g.now + ms };
  res.prompt = prompt;
  return prompt;
}

/** Sequential prompts: whose answer is due now. */
export function nextResponder(prompt: Prompt): PlayerId | null {
  return prompt.who.find((id) => !prompt.responses[id]) ?? null;
}

export function isComplete(prompt: Prompt): boolean {
  if (typeof prompt.need === 'number') {
    const supporters = Object.values(prompt.responses).filter((r) => r.kind === 'support' && !r.declined).length;
    if (supporters >= prompt.need) return true;
  }
  return prompt.who.every((id) => prompt.responses[id]);
}

const MAX_SPEECH = 140;
const cleanText = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH) : '';

/** Validate a player's answer and record it (throws a RuleError if invalid). */
export function respond(g: GameState, res: Resolution, playerId: PlayerId, promptId: unknown, raw: unknown): void {
  const prompt = res.prompt;
  if (!prompt || prompt.id !== promptId) fail('That question has already been answered');
  if (!prompt.who.includes(playerId)) fail("This question isn't for you");
  if (prompt.responses[playerId]) fail('You already answered');
  if (prompt.sequential && nextResponder(prompt) !== playerId) fail("It isn't your turn to answer yet");
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  prompt.responses[playerId] = parse(g, res, prompt, playerId, r);
}

function parse(g: GameState, res: Resolution, prompt: Prompt, playerId: PlayerId, r: Record<string, unknown>): Response {
  const kind: PromptKind = prompt.kind;
  switch (kind) {
    case 'choice': {
      const opt = prompt.options?.find((o) => o.value === r.value);
      if (!opt) fail('Pick one of the options');
      if (opt.disabled) fail(opt.disabled);
      return { kind: 'choice', value: opt.value };
    }
    case 'player': {
      if (typeof r.playerId !== 'string' || !prompt.players?.includes(r.playerId)) fail('Pick one of the players offered');
      if (prompt.notSelf && r.playerId === playerId) fail("You can't pick yourself");
      return { kind: 'player', playerId: r.playerId };
    }
    case 'vote':
      if (typeof r.yes !== 'boolean') fail('Vote yes or no');
      return { kind: 'vote', yes: r.yes };
    case 'support':
      return { kind: 'support', declined: r.declined === true };
    case 'roll': {
      if (g.config.diceMode === 'physical') {
        const v = Number(r.value);
        if (!Number.isInteger(v) || v < 1 || v > 6) fail('Enter the number you rolled (1-6)');
        return { kind: 'roll', value: v };
      }
      return { kind: 'roll', value: rollDie(g) };
    }
    case 'kingMaker': {
      if (r.cardId === null || r.cardId === undefined) return { kind: 'kingMaker', cardId: null };
      if (r.side !== 'support' && r.side !== 'oppose') fail('Choose a side');
      const cardId = String(r.cardId);
      if (!handHas(g, playerId, 'noble:king_maker').includes(cardId)) fail("You don't have that King Maker");
      // played out of turn: it leaves the hand now and is replaced at once (Rules p15)
      removeFromHand(g, playerId, cardId);
      (res.data.kingMakerCards ??= []).push(cardId);
      refill(g, playerId);
      log(g, 'play', `${nameOf(g, playerId)} plays King Maker to ${r.side === 'support' ? 'SUPPORT' : 'OPPOSE'} the King (${r.side === 'support' ? '+1' : '−1'})`, { actor: playerId, cardKey: 'noble:king_maker' });
      return { kind: 'kingMaker', cardId, side: r.side };
    }
    case 'card': {
      if (r.index === null) return { kind: 'card', index: null };
      const n = prompt.private?.[playerId]?.cards.length ?? 0;
      const i = Number(r.index);
      if (!Number.isInteger(i) || i < 0 || i >= n) fail('Pick one of the cards');
      return { kind: 'card', index: i };
    }
    case 'look':
      return { kind: 'look' };
    case 'speech': {
      const custom = prompt.allowCustom ? cleanText(r.text) : '';
      const text = custom || prompt.speech || '';
      log(g, 'speech', text, { actor: playerId });
      return { kind: 'speech', text };
    }
  }
}

/** The deadline passed: fill in the documented defaults (see rule audit). */
export function expire(g: GameState, prompt: Prompt): void {
  for (const id of prompt.who) {
    if (prompt.responses[id]) continue;
    if (typeof prompt.need === 'number' && isComplete(prompt)) break;
    const who = nameOf(g, id);
    switch (prompt.kind) {
      case 'choice': {
        const opt = prompt.options?.find((o) => o.value === prompt.defaultValue && !o.disabled) ?? prompt.options?.find((o) => !o.disabled);
        if (opt) {
          prompt.responses[id] = { kind: 'choice', value: opt.value };
          log(g, 'info', `${who} didn't answer in time: "${opt.label}"`);
        }
        break;
      }
      case 'player': {
        const pool = (prompt.players ?? []).filter((p) => !prompt.notSelf || p !== id);
        const pick = prompt.defaultValue && pool.includes(prompt.defaultValue) ? prompt.defaultValue : pool[randomIndex(g, pool.length)];
        if (pick) {
          prompt.responses[id] = { kind: 'player', playerId: pick };
          log(g, 'info', `${who} didn't answer in time: ${nameOf(g, pick)} was picked at random`);
        }
        break;
      }
      case 'vote':
        prompt.responses[id] = { kind: 'vote', yes: false };
        log(g, 'info', `${who} didn't vote in time (counted as no)`);
        break;
      case 'support':
        prompt.responses[id] = { kind: 'support', declined: true };
        break;
      case 'roll':
        prompt.responses[id] = { kind: 'roll', value: rollDie(g), auto: true };
        break;
      case 'kingMaker':
        prompt.responses[id] = { kind: 'kingMaker', cardId: null };
        break;
      case 'card':
        prompt.responses[id] = { kind: 'card', index: null };
        break;
      case 'look':
        prompt.responses[id] = { kind: 'look' };
        break;
      case 'speech':
        prompt.responses[id] = { kind: 'speech', text: '', silent: true };
        log(g, 'info', `${who} stayed silent`);
        break;
    }
  }
}

// ---- reading answers -------------------------------------------------------

export const choiceOf = (p: Prompt, id: PlayerId): string | undefined => {
  const r = p.responses[id];
  return r?.kind === 'choice' ? r.value : undefined;
};
export const pickOf = (p: Prompt, id: PlayerId): PlayerId | undefined => {
  const r = p.responses[id];
  return r?.kind === 'player' ? r.playerId : undefined;
};
export const voteOf = (p: Prompt, id: PlayerId): boolean => {
  const r = p.responses[id];
  return r?.kind === 'vote' && r.yes;
};
export const rollOf = (p: Prompt, id: PlayerId): number => {
  const r = p.responses[id];
  return r?.kind === 'roll' ? r.value : 0;
};
export const supporters = (p: Prompt): PlayerId[] =>
  Object.entries(p.responses).filter(([, r]) => r.kind === 'support' && !r.declined).map(([id]) => id);
