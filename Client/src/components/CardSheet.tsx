// Inspect a card from your hand and play it: choose an option (dotted-line
// cards), fill in what the server says the card needs, confirm. Or place it
// face down as a (claimed) Knight. Every choice is offered by the server; the
// player always makes it themselves.

import { useState } from 'react';
import type { NameOf } from '../lib/game';
import type { FieldSpec, HandCard } from '../lib/types';
import { api, useStore } from '../net/socket';
import { CardImg, Sheet } from './common';

type Setup = Record<string, string | string[]>;

const filled = (f: FieldSpec, v: Setup[string] | undefined) =>
  f.kind === 'order' ? Array.isArray(v) && v.length === (f.choices?.length ?? 0) : typeof v === 'string' && v.trim().length > 0;

export function CardSheet({ card, name, isKing, onClose }: { card: HandCard; name: NameOf; isKing: boolean; onClose: () => void }) {
  const def = useStore((s) => s.cards[card.key]);
  const [option, setOption] = useState<number | null>(def?.options ? null : 0);
  const [setup, setSetup] = useState<Setup>({});
  const [placeTarget, setPlaceTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!def) return null;

  const opt = option === null ? null : card.play.options[option];
  const complete = Boolean(opt?.ok && opt.fields.every((f) => filled(f, setup[f.name])));
  const pick = (o: number) => {
    setOption(o);
    setSetup({});
  };
  const send = async (action: Parameters<typeof api.act>[0]) => {
    setBusy(true);
    const r = await api.act(action);
    setBusy(false);
    if (r.ok) onClose();
  };
  const placeTo = isKing ? placeTarget : card.place.targets[0];

  return (
    <Sheet onClose={onClose} label={def.name}>
      <div className="split">
      <div className="split-art"><div className="big-card"><CardImg def={def} small={false} /></div></div>
      <div className="split-body">
      <h2>{def.name}</h2>
      {!def.options && <p className="printed">{def.printedText}</p>}
      {def.timing && <p className="faint center" style={{ fontSize: '.78rem' }}>⏳ {def.timing}</p>}
      {!card.play.ok && card.play.reason && <p className="reason">{card.play.reason}</p>}

      {def.options && (
        <div className="stack" role="radiogroup" aria-label="Choose one option">
          <p className="section-title">Choose ONE option</p>
          {def.options.map((text, i) => {
            const o = card.play.options[i];
            return (
              <button key={i} role="radio" aria-checked={option === i} className={`option-card${option === i ? ' on' : ''}`} disabled={!card.play.ok || !o.ok} onClick={() => pick(i)}>
                <b>{i + 1}.</b>{text}
                {!o.ok && card.play.ok && o.reason && <span className="reason" style={{ display: 'block', textAlign: 'left' }}>{o.reason}</span>}
              </button>
            );
          })}
        </div>
      )}

      {card.play.ok && opt?.ok && opt.fields.map((f) => (
        <Field key={f.name} field={f} setup={setup} onChange={(v) => setSetup((s) => ({ ...s, [f.name]: v }))} name={name} />
      ))}

      {card.play.ok && (
        <button className="btn gold block" disabled={!complete || busy} onClick={() => send({ type: 'play', cardId: card.id, option: option ?? 0, setup })}>
          Play {def.name}
        </button>
      )}

      {card.place.ok && (
        <section className="panel flat stack" style={{ background: 'var(--panel-2)' }}>
          <p className="section-title">Or place it face down as a Knight{def.key.endsWith(':knight') ? '' : ' (a bluff)'}</p>
          {isKing && (
            <div className="chips">
              {card.place.targets.map((id) => (
                <button key={id} className={`chip${placeTarget === id ? ' on' : ''}`} onClick={() => setPlaceTarget(id)}>{name(id)}</button>
              ))}
            </div>
          )}
          <button className="btn ghost block" disabled={!placeTo || busy} onClick={() => send({ type: 'place', cardId: card.id, targetId: placeTo })}>
            Place face down{isKing && placeTo ? ` in front of ${name(placeTo)}` : ''}
          </button>
          <p className="faint center" style={{ fontSize: '.75rem' }}>Counts as one of your plays. Only a real Knight stops a Betrayal.</p>
        </section>
      )}
      <button className="btn dark block" onClick={onClose}>Close</button>
      </div>
      </div>
    </Sheet>
  );
}

function Field({ field, setup, onChange, name }: { field: FieldSpec; setup: Setup; onChange: (v: string | string[]) => void; name: NameOf }) {
  const value = setup[field.name];
  if (field.kind === 'text') {
    return (
      <label className="stack">
        <span className="section-title">{field.label}</span>
        <input className="input" maxLength={field.maxLength} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  if (field.kind === 'order') {
    const order = (Array.isArray(value) ? value : []) as string[];
    return (
      <div className="stack">
        <p className="section-title">{field.label}</p>
        <div className="chips">
          {field.choices!.map((c) => {
            const at = order.indexOf(c.value);
            return (
              <button key={c.value} className={`chip${at >= 0 ? ' on' : ''}`} disabled={at >= 0} onClick={() => onChange([...order, c.value])}>
                {at >= 0 ? `${at + 1}. ` : ''}{c.label}
              </button>
            );
          })}
        </div>
        {order.length > 0 && (
          <p className="center muted" style={{ fontSize: '.8rem' }}>
            Pairs: {chunk(order).map((p) => p.map(name).join(' & ') + (p.length === 1 && order.length === field.choices!.length ? ' & the King' : '')).join(' · ')}{' '}
            <button className="btn ghost small" onClick={() => onChange([])}>Reset</button>
          </p>
        )}
      </div>
    );
  }
  const taken = (field.distinctFrom ?? []).map((n) => setup[n]);
  return (
    <div className="stack">
      <p className="section-title">{field.label}</p>
      <div className="chips">
        {field.choices!.map((c) => (
          <button key={c.value} className={`chip${value === c.value ? ' on' : ''}`} disabled={taken.includes(c.value)} onClick={() => onChange(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const chunk = (xs: string[]) => xs.reduce<string[][]>((out, x, i) => (i % 2 ? out[out.length - 1].push(x) : out.push([x]), out), []);
