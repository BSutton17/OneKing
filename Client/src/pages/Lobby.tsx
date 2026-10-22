import { useState } from 'react';
import { BackImg } from '../components/common';
import { Credits } from '../components/Credits';
import type { RoomView } from '../lib/types';
import { api, toast } from '../net/socket';

export function Lobby({ room }: { room: RoomView }) {
  const isHost = room.hostId === room.you;
  const n = room.members.length;
  const enough = n >= room.limits.min && n <= room.limits.max;
  const [busy, setBusy] = useState(false);
  const link = `${location.origin}${location.pathname}?room=${room.code}`;

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'One King One Crown', text: `Join my game — room ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Invite link copied', 'info');
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <main className="screen">
      <div style={{ width: 84 }}><BackImg deck="king" /></div>
      <p className="section-title">Room code</p>
      <div className="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>{room.code}</div>
      <button className="btn ghost small" onClick={share}>Share invite</button>

      <section className="panel stack" style={{ width: '100%' }}>
        <h2>Seats {n}/{room.limits.max}</h2>
        <p className="faint center" style={{ fontSize: '.8rem' }}>
          Seats go clockwise around the table.{isHost ? ' Playing in person? Arrange them like you’re sitting.' : ''}
        </p>
        <ol className="seat-list">
          {room.members.map((m, i) => (
            <li key={m.id} className="seat">
              <span className="seat-num">{i + 1}</span>
              <span className={`dot${m.connected ? '' : ' off'}`} title={m.connected ? 'Connected' : 'Disconnected'} />
              <span className="name">{m.name}{m.id === room.you ? ' (you)' : ''}</span>
              {m.id === room.hostId && <span className="tag king">Host</span>}
              {isHost && (
                <span className="row">
                  <button className="icon-btn" aria-label={`Move ${m.name} up`} disabled={i === 0} onClick={() => api.seat(m.id, -1)}>↑</button>
                  <button className="icon-btn" aria-label={`Move ${m.name} down`} disabled={i === n - 1} onClick={() => api.seat(m.id, 1)}>↓</button>
                  {m.id !== room.you && <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => api.kick(m.id)}>✕</button>}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="panel stack" style={{ width: '100%' }}>
        <h3>Table rules</h3>
        <p className="section-title">Negotiation time</p>
        <div className="chips" role="radiogroup" aria-label="Negotiation time">
          {[60, 120, 180, 300].map((s) => (
            <button key={s} role="radio" aria-checked={room.settings.negotiationSeconds === s} className={`chip${room.settings.negotiationSeconds === s ? ' on' : ''}`} disabled={!isHost} onClick={() => api.settings({ negotiationSeconds: s })}>
              {s / 60} min{s === 120 ? ' (official)' : ''}
            </button>
          ))}
        </div>
        <p className="section-title">Dice</p>
        <div className="chips" role="radiogroup" aria-label="Dice">
          {(['digital', 'physical'] as const).map((d) => (
            <button key={d} role="radio" aria-checked={room.settings.diceMode === d} className={`chip${room.settings.diceMode === d ? ' on' : ''}`} disabled={!isHost} onClick={() => api.settings({ diceMode: d })}>
              {d === 'digital' ? '🎲 Rolled for you' : '✋ Real dice (type your roll)'}
            </button>
          ))}
        </div>
      </section>

      {isHost ? (
        <button className="btn gold block sticky-cta" disabled={!enough || busy} onClick={async () => { setBusy(true); await api.start(); setBusy(false); }}>
          {enough ? 'Deal the character cards' : `Need ${room.limits.min}–${room.limits.max} players`}
        </button>
      ) : (
        <p className="muted center">Waiting for the host to start…</p>
      )}
      <button className="btn ghost small" onClick={() => api.leave()}>Leave room</button>
      <Credits />
    </main>
  );
}
