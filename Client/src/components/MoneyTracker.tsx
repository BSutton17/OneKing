// The official character card with the eye token on the player's balance.
// Positions are percentages of the printed grid (lib/money.ts), so the token
// stays on its cell at any size; it glides to the new cell when gold changes.

import { art, characterCard, roundTracker, tokenSrc } from '../lib/art';
import { cellFor } from '../lib/money';
import type { Role } from '../lib/types';

export function MoneyTracker({ role, gold, name, caption = true }: { role: Role; gold: number; name?: string; caption?: boolean }) {
  const geo = characterCard(role);
  const cell = cellFor(gold, geo);
  const size = Math.min(cell.w, cell.h * (geo.height / geo.width)) * 0.56;
  return (
    <figure style={{ margin: 0 }}>
      <div className="money" style={{ aspectRatio: `${geo.width} / ${geo.height}` }} data-testid={`money-${role}`}>
        <img src={art(geo.src)} alt={`${role === 'king' ? "King's" : "Noble's"} character card`} draggable={false} />
        <span
          className="token"
          data-cell={cell.value}
          style={{ left: `${cell.x}%`, top: `${cell.y}%`, width: `${size}%`, aspectRatio: '1' }}
          aria-hidden="true"
        >
          <img src={tokenSrc} alt="" />
        </span>
      </div>
      {caption && (
        <figcaption className="money-caption" aria-live="polite">
          {name ? `${name}: ` : ''}
          {gold.toLocaleString()} gold{!cell.exact && <span className="faint"> (token on {cell.value})</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** The printed round tracker with the eye token on the current round. */
export function RoundTracker({ round }: { round: number }) {
  const x = roundTracker.centersX[Math.max(0, Math.min(3, round - 1))];
  return (
    <div className="round-tracker" aria-label={`Round ${round} of 4, ${round % 2 ? 'clockwise' : 'counter-clockwise'}`}>
      <img className="track" src={art(roundTracker.src)} alt="Round tracker: one clockwise, two counter-clockwise, three clockwise, four counter-clockwise" />
      <span className="token" style={{ left: `${x}%`, top: '88%' }} aria-hidden="true">
        <img src={tokenSrc} alt="" />
      </span>
    </div>
  );
}
