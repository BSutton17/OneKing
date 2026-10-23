import type { GameView, PlayerId, RoomView, Status } from './types';

export type NameOf = (id: PlayerId | 'bank' | null | undefined) => string;

export function namer(room: RoomView): NameOf {
  const map = new Map(room.members.map((m) => [m.id, m.name]));
  room.game?.players.forEach((p) => map.set(p.id, p.name));
  return (id) => (id === 'bank' ? 'the bank' : id ? map.get(id) ?? '?' : '?');
}

/** Little labels shown under a player's name. */
export function statusTags(g: GameView, pid: PlayerId, name: NameOf): { text: string; warn?: boolean }[] {
  const out: { text: string; warn?: boolean }[] = [];
  const other = (s: { a: string; b: string }) => (s.a === pid ? s.b : s.a);
  for (const s of g.statuses as Status[]) {
    switch (s.kind) {
      case 'isolationLook': if (s.playerId === pid) out.push({ text: 'Cards hidden' }); break;
      case 'isolationGold': if (s.playerId === pid) out.push({ text: 'Gold protected' }); break;
      case 'kingsEye': if (s.playerId === pid) out.push({ text: "King's Eye" }); break;
      case 'shiftingTides': if (s.a === pid || s.b === pid) out.push({ text: `Takes only from ${name(other(s))}`, warn: true }); break;
      case 'badBlood':
        if (s.owner === pid) out.push({ text: `Profits from ${name(s.a)} vs ${name(s.b)}` });
        if (s.a === pid || s.b === pid) out.push({ text: `Bad blood with ${name(other(s))}`, warn: true });
        break;
      case 'debt':
        if (s.debtor === pid) out.push({ text: `Owes ${name(s.creditor)}`, warn: true });
        if (s.creditor === pid) out.push({ text: `${name(s.debtor)} owes them` });
        break;
      case 'hindsight': if (s.owner === pid) out.push({ text: `Hindsight: ${name(s.backed)} (R${s.deadlineRound})` }); break;
      case 'scout': if (s.owner === pid) out.push({ text: `Scout: ${name(s.backed)} (R${s.deadlineRound})` }); break;
    }
  }
  return out;
}

/** "Bob, 200 gold" — what the player chose when playing a card. */
export function setupSummary(setup: Record<string, string | string[]>, name: NameOf): string {
  return Object.entries(setup)
    .map(([key, v]) => {
      if (Array.isArray(v)) return v.map(name).join(' · ');
      if (key === 'amount') return `${v} gold`;
      if (key.startsWith('backer')) return `backed by ${name(v)}`;
      if (key === 'sentence') return `“${v}”`;
      if (v.startsWith('player:')) return `${name(v.slice(7))}'s hand`;
      if (v.startsWith('slot:')) return 'a face-down card';
      return name(v);
    })
    .join(' → ');
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
