// Spoken lines in person. The game can't hear a pledge or a parrot, so "I said
// it" is a claim: everyone else can overrule it from the log, and once they all
// have, the speaker is treated as having refused. Open until the round ends.

import { useState } from 'react';
import type { NameOf } from '../lib/game';
import type { ClaimView, GameView } from '../lib/types';
import { api, useStore } from '../net/socket';
import { Sheet } from './common';

export function ClaimSheet({ g, claim, name, onClose }: { g: GameView; claim: ClaimView; name: NameOf; onClose: () => void }) {
  const cards = useStore((s) => s.cards);
  const [busy, setBusy] = useState(false);
  const mine = claim.by === g.you;
  const voted = claim.votes.includes(g.you);
  const vote = async (v: boolean) => {
    setBusy(true);
    await api.act({ type: 'overrule', claimId: claim.id, vote: v });
    setBusy(false);
  };
  return (
    <Sheet onClose={onClose} label="Dispute a spoken line">
      <span className="section-title" style={{ margin: 0 }}>{cards[claim.cardKey]?.name ?? 'Spoken line'} · round {claim.round}</span>
      <h2>Did {mine ? 'you' : name(claim.by)} really do it?</h2>
      <p className="center">“{claim.text}”</p>
      <p className="muted center" style={{ fontSize: '.85rem' }}>
        If every other player overrules it, {claim.penalty}.
      </p>
      <div className="answers" aria-label="Who wants to overrule">
        {claim.voters.map((id) => (
          <span key={id} className={`answer${claim.votes.includes(id) ? ' done' : ''}`}>
            {id === g.you ? 'You' : name(id)}{claim.votes.includes(id) ? ' overrules' : ' …'}
          </span>
        ))}
      </div>
      <p className="faint center" style={{ fontSize: '.75rem' }}>{claim.votes.length}/{claim.voters.length} — it must be unanimous.</p>
      <div className="sheet-actions">
        {claim.overruled ? (
          <p className="center"><b>Overruled.</b> {claim.penalty}.</p>
        ) : !claim.open ? (
          <p className="faint center">It stood — a line can only be disputed in the round it was said.</p>
        ) : mine ? (
          <p className="faint center">You can't vote on your own line.</p>
        ) : voted ? (
          <button className="btn ghost block" disabled={busy} onClick={() => vote(false)}>Take back my vote</button>
        ) : (
          <button className="btn gold block" disabled={busy} onClick={() => vote(true)}>Overrule — they didn't do it</button>
        )}
        <button className="btn dark block" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}

/** On the table: any line someone has started to dispute, so the rest can find it. */
export function DisputeBanner({ g, name, onOpen }: { g: GameView; name: NameOf; onOpen: (id: string) => void }) {
  const cards = useStore((s) => s.cards);
  const live = g.claims.filter((c) => c.open && c.votes.length > 0);
  if (!live.length) return null;
  return (
    <section className="panel stack" aria-label="Disputed lines">
      {live.map((c) => (
        <button key={c.id} className="offer incoming" onClick={() => onOpen(c.id)} style={{ textAlign: 'left', color: 'inherit', background: 'none' }}>
          <span className="section-title" style={{ margin: 0 }}>Disputed: {cards[c.cardKey]?.name ?? 'spoken line'}</span>
          <span style={{ fontSize: '.85rem' }}>{c.votes.map((id) => (id === g.you ? 'You' : name(id))).join(', ')} say{c.votes.length === 1 && c.votes[0] !== g.you ? 's' : ''} {c.by === g.you ? 'you' : name(c.by)} didn't really do it — {c.votes.length}/{c.voters.length} to overrule.</span>
          <span className="gold" style={{ fontSize: '.8rem' }}>{c.by === g.you ? 'Tap to see' : c.votes.includes(g.you) ? 'Tap to review' : 'Tap to vote'}</span>
        </button>
      ))}
    </section>
  );
}
