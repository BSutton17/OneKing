import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { backSrc, publicUrl } from '../lib/art';
import type { CardDef, Role } from '../lib/types';
import { useStore } from '../net/socket';

/** A card face (official art). `text` alternative = the printed text, for screen readers. */
export function CardImg({ def, cardKey, small = true, dim, selected, onClick, label, children }: {
  def?: CardDef; cardKey?: string | null; small?: boolean; dim?: boolean; selected?: boolean; onClick?: () => void; label?: string; children?: ReactNode;
}) {
  const cards = useStore((s) => s.cards);
  const d = def ?? (cardKey ? cards[cardKey] : undefined);
  const deck: Role = (d?.deck ?? (cardKey?.startsWith('king:') ? 'king' : 'noble')) as Role;
  const src = d ? publicUrl(small ? d.art.small : d.art.full) : backSrc(deck, small);
  const alt = d ? `${d.name}: ${d.printedText}` : 'Face-down card';
  const cls = `card${dim ? ' dim' : ''}${selected ? ' selected' : ''}`;
  const body = (
    <>
      <img src={src} alt={alt} loading="lazy" draggable={false} />
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={label ?? alt}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The King card back, used wherever the King needs marking. */
export const Crown = () => <img className="crown" src={backSrc('king')} alt="" aria-hidden="true" />;

export function BackImg({ deck }: { deck: Role | 'character' }) {
  return (
    <div className="card">
      <img src={backSrc(deck)} alt={`${deck} card back`} draggable={false} />
    </div>
  );
}

export function Sheet({ onClose, children, label, wide }: { onClose?: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // rendered on <body>: a sheet opened from inside a scrolling pane must not be
  // clipped by it or end up under the bottom dock (iOS)
  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Current server time (local clock corrected by the offset measured from each update). */
export function useServerNow(intervalMs = 250): number {
  const offset = useStore((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), intervalMs);
    setNow(Date.now() + offset);
    return () => clearInterval(t);
  }, [offset, intervalMs]);
  return now;
}

export function Countdown({ deadline, className = '' }: { deadline: number; className?: string }) {
  const now = useServerNow();
  const ms = Math.max(0, deadline - now);
  const s = Math.ceil(ms / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return <span className={`timer ${s <= 10 ? 'low' : ''} ${className}`} role="timer" aria-label={`${s} seconds left`}>{text}</span>;
}

export function useWide(min = 1024): boolean {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return Boolean(wide);
}
