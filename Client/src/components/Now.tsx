import { useState } from 'react';
import { setupSummary, type NameOf } from '../lib/game';
import type { GameView, RoomView } from '../lib/types';
import { api, useStore } from '../net/socket';
import { BackImg, CardImg, Countdown } from './common';
import { Answers } from './PromptSheet';

/** The card being resolved / whose turn it is / the negotiation timer. */
export function NowPanel({ g, name, onAnswer }: { g: GameView; name: NameOf; onAnswer: () => void }) {
  const cards = useStore((s) => s.cards);
  const res = g.resolution;
  if (res) {
    const def = res.cardKey ? cards[res.cardKey] : null;
    const p = res.prompt;
    return (
      <section className="panel now" aria-live="polite">
        <div>{res.cardKey ? <CardImg cardKey={res.cardKey} /> : <div className="card" style={{ display: 'grid', placeItems: 'center', background: 'var(--gold)', color: '#111', fontSize: 34 }}>👑</div>}</div>
        <div className="text">
          <span className="now-title">
            {res.kind === 'rolloff' ? 'Two Nobles pass the King at once!' : `${name(res.actor)} plays ${def?.name ?? 'a card'}${res.option !== null && def?.options ? ` (option ${res.option + 1})` : ''}`}
          </span>
          {Object.keys(res.setup).length > 0 && <span className="muted" style={{ fontSize: '.82rem' }}>{setupSummary(res.setup, name)}</span>}
          {p && (
            <>
              <span style={{ fontSize: '.88rem' }}><b>{p.title}:</b> {p.text}</span>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Answers prompt={p} name={name} />
                <Countdown deadline={p.deadline} />
              </div>
              {p.mine && <button className="btn gold small" onClick={onAnswer}>Your answer is needed</button>}
            </>
          )}
        </div>
      </section>
    );
  }
  if (g.phase === 'over') return null;
  if (g.phase === 'negotiation' && g.negotiation) {
    const done = g.players.filter((x) => x.negotiationDone).length;
    return (
      <section className="panel center stack">
        <h2>Negotiation Phase</h2>
        <Countdown deadline={g.negotiation.endsAt} className="timer" />
        <p className="muted" style={{ fontSize: '.85rem' }}>Make deals in the Deals tab. {done}/{g.players.length} done.</p>
      </section>
    );
  }
  const t = g.turn;
  if (!t) return null;
  const mine = t.playerId === g.you;
  return (
    <section className="panel center stack">
      <h2>{mine ? 'Your turn' : `${name(t.playerId)}'s turn`}</h2>
      <p className="muted">{t.plays} of {t.allowance} cards played{mine ? ' — open your Hand to play' : ''}</p>
      {mine && g.legal.canEndTurn && (
        <button className="btn ghost small" onClick={() => api.act({ type: 'endTurn' })}>I have nothing I can play — end turn</button>
      )}
    </section>
  );
}

export function LogPane({ g, name }: { g: GameView; name: NameOf }) {
  const [tab, setTab] = useState<'events' | 'gold'>('events');
  return (
    <section className="panel stack">
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={tab === 'events'} className={`chip${tab === 'events' ? ' on' : ''}`} onClick={() => setTab('events')}>Events</button>
        <button role="tab" aria-selected={tab === 'gold'} className={`chip${tab === 'gold' ? ' on' : ''}`} onClick={() => setTab('gold')}>Gold history</button>
      </div>
      {tab === 'events' ? (
        <ol className="log" aria-label="Game log, newest first">
          {[...g.log].reverse().map((e) => (
            <li key={e.id} className={`k-${e.kind}`}>
              {e.kind === 'speech' ? <><b>{name(e.actor)}:</b> “{e.text}”</> : e.kind === 'private' ? <>🔒 {e.text}</> : e.text}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="log" aria-label="Gold transactions, newest first">
          {[...g.transactions].reverse().map((t) => (
            <li key={t.id}>
              <span className="faint">R{t.round}</span> {name(t.from)} → {name(t.to)}: <span className="gold">{t.amount}</span>
              {t.received !== t.amount && <span className="faint"> ({t.received} arrived — 2000 cap)</span>}
              <span className="faint"> · {t.source.replace(/^card:(king|noble):/, '').replace(/^system:/, '').replace(/_/g, ' ')}</span>
            </li>
          ))}
          {g.transactions.length === 0 && <li className="faint">No gold has moved yet.</li>}
        </ol>
      )}
    </section>
  );
}

export function GameOver({ room, name, onClose }: { room: RoomView; name: NameOf; onClose: () => void }) {
  const g = room.game!;
  const isHost = room.hostId === room.you;
  const standings = [...g.players].sort((a, b) => (a.role === 'king' ? -1 : b.role === 'king' ? 1 : b.gold - a.gold));
  const crowns = g.log.filter((e) => e.kind === 'crown' && e.text.includes('new King')).length;
  return (
    <div className="sheet-backdrop">
      <div className="sheet over" role="dialog" aria-modal="true" aria-label="Game over">
        <div className="crown-art"><BackImg deck="king" /></div>
        <h2>{g.winner === g.you ? 'You are the King!' : `${name(g.winner)} wins`}</h2>
        <p className="tagline">There's only One Crown.</p>
        <p className="muted">Four rounds · the crown changed hands {crowns} time{crowns === 1 ? '' : 's'}</p>
        <table className="standings">
          <tbody>
            {standings.map((p, i) => (
              <tr key={p.id}>
                <td>{p.role === 'king' ? '👑' : i + 1}</td>
                <td style={{ textAlign: 'left' }}>{p.name}{p.id === g.you ? ' (you)' : ''}</td>
                <td>{p.gold}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: '.75rem' }}>Only the King wins — gold is how you get the crown.</p>
        {isHost ? <button className="btn gold block" onClick={() => api.lobby()}>Back to the lobby</button> : <p className="muted">The host can take everyone back to the lobby.</p>}
        <div className="row">
          <button className="btn dark grow" onClick={onClose}>See the table</button>
          <button className="btn ghost grow" onClick={() => api.leave()}>Leave</button>
        </div>
      </div>
    </div>
  );
}
