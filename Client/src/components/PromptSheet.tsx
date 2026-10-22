// Answering a question the game puts to you: a vote, a choice, a roll, a
// support window, a King Maker window, cards shown only to you, a line to say.

import { useState } from 'react';
import type { NameOf } from '../lib/game';
import type { GameView, PromptView } from '../lib/types';
import { api } from '../net/socket';
import { CardImg, Countdown, Sheet } from './common';

export function PromptSheet({ g, prompt, name, diceMode, onHide }: { g: GameView; prompt: PromptView; name: NameOf; diceMode: 'digital' | 'physical'; onHide: () => void }) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState(prompt.speech ?? '');
  const answer = async (response: object) => {
    setBusy(true);
    await api.act({ type: 'respond', promptId: prompt.id, response });
    setBusy(false);
  };
  const res = g.resolution!;
  const kingMakers = g.hand.filter((h) => h.key === 'noble:king_maker');
  const reveal = prompt.private;

  return (
    <Sheet onClose={onHide} label={prompt.title}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="section-title" style={{ margin: 0 }}>{res.kind === 'rolloff' ? 'Crown roll-off' : `${name(res.actor)} played`}</span>
        <Countdown deadline={prompt.deadline} />
      </div>
      <div className="split">
      {res.cardKey && <div className="split-art"><div className="prompt-card"><CardImg cardKey={res.cardKey} small={false} /></div></div>}
      <div className="split-body">
      <h2>{prompt.title}</h2>
      <p className="center" style={{ lineHeight: 1.45 }}>{prompt.text}</p>

      {reveal && (
        <div className="stack">
          <p className="section-title">{reveal.heading} — only you can see this</p>
          <div className="reveal-row">
            {reveal.cards.map((c, i) => (
              <CardImg
                key={i} cardKey={c.key} selected={picked === i} label={c.key ? undefined : `Hidden card ${i + 1}`}
                onClick={prompt.kind === 'card' ? () => setPicked(i) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {prompt.kind === 'choice' && (
        <div className="stack">
          {prompt.options!.map((o) => (
            <button key={o.value} className="btn block" disabled={busy || Boolean(o.disabled)} onClick={() => answer({ value: o.value })}>
              {o.label}{o.disabled ? ` — ${o.disabled}` : ''}
            </button>
          ))}
        </div>
      )}

      {prompt.kind === 'player' && (
        <div className="chips">
          {prompt.players!.filter((id) => !prompt.notSelf || id !== g.you).map((id) => (
            <button key={id} className="chip" disabled={busy} onClick={() => answer({ playerId: id })}>{name(id)}{id === g.you ? ' (you)' : ''}</button>
          ))}
        </div>
      )}

      {prompt.kind === 'vote' && (
        <div className="row">
          <button className="btn gold grow" disabled={busy} onClick={() => answer({ yes: true })}>{res.cardKey === 'king:snakes' ? '✋ Raise hand' : 'Yes'}</button>
          <button className="btn ghost grow" disabled={busy} onClick={() => answer({ yes: false })}>{res.cardKey === 'king:snakes' ? 'Keep it down' : 'No'}</button>
        </div>
      )}

      {prompt.kind === 'support' && (
        <div className="row">
          <button className="btn gold grow" disabled={busy} onClick={() => answer({})}>📣 I support it</button>
          <button className="btn ghost grow" disabled={busy} onClick={() => answer({ declined: true })}>Stay quiet</button>
        </div>
      )}

      {prompt.kind === 'roll' && (diceMode === 'physical' ? (
        <div className="stack">
          <p className="section-title">Roll your die, then tap what you rolled</p>
          <div className="dice-row">
            {[1, 2, 3, 4, 5, 6].map((v) => <button key={v} className="die" disabled={busy} onClick={() => answer({ value: v })}>{v}</button>)}
          </div>
        </div>
      ) : (
        <button className="btn gold block roll-btn" disabled={busy} onClick={() => answer({})}>🎲 Roll the die</button>
      ))}

      {prompt.kind === 'kingMaker' && (
        <div className="stack">
          {kingMakers.length > 0 ? (
            <>
              <button className="btn gold block" disabled={busy} onClick={() => answer({ cardId: kingMakers[0].id, side: 'support' })}>Play King Maker: support the King (+1)</button>
              <button className="btn block" disabled={busy} onClick={() => answer({ cardId: kingMakers[0].id, side: 'oppose' })}>Play King Maker: oppose the King (−1)</button>
            </>
          ) : (
            <p className="faint center">You have no King Maker.</p>
          )}
          <button className="btn ghost block" disabled={busy} onClick={() => answer({ cardId: null })}>Pass</button>
        </div>
      )}

      {prompt.kind === 'card' && (
        <div className="row">
          <button className="btn gold grow" disabled={busy || picked === null} onClick={() => answer({ index: picked })}>{reveal?.blind ? 'Take this card' : 'Choose this card'}</button>
          <button className="btn ghost grow" disabled={busy} onClick={() => answer({ index: null })}>None</button>
        </div>
      )}

      {prompt.kind === 'look' && <button className="btn gold block" disabled={busy} onClick={() => answer({})}>Done looking</button>}

      {prompt.kind === 'speech' && (
        <div className="stack">
          {prompt.allowCustom ? (
            <input className="input" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} aria-label="What you say" />
          ) : (
            <p className="center" style={{ fontStyle: 'italic', fontSize: '1.05rem' }}>“{prompt.speech}”</p>
          )}
          <button className="btn gold block" disabled={busy} onClick={() => answer({ text })}>🗣️ Say it to the table</button>
        </div>
      )}

      <button className="btn dark block" onClick={onHide}>Hide for now</button>
      </div>
      </div>
    </Sheet>
  );
}

/** Who has answered so far (public answers shown unless the vote is secret). */
export function Answers({ prompt, name }: { prompt: PromptView; name: NameOf }) {
  return (
    <div className="answers" aria-label="Answers">
      {prompt.who.map((id) => {
        const r = prompt.responses[id];
        const done = prompt.answered.includes(id);
        let what = '';
        if (r?.kind === 'roll') what = ` 🎲${r.value}`;
        else if (r?.kind === 'vote') what = r.yes ? ' ✓' : ' ✗';
        else if (r?.kind === 'support') what = r.declined ? ' quiet' : ' 📣';
        else if (r?.kind === 'kingMaker') what = r.side ? ` King Maker: ${r.side}` : ' pass';
        else if (r?.kind === 'player') what = ` → ${name(r.playerId)}`;
        else if (done) what = ' ✓';
        return <span key={id} className={`answer${done ? ' done' : ''}`}>{name(id)}{what || (done ? '' : ' …')}</span>;
      })}
    </div>
  );
}
