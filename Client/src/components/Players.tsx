import { backSrc } from '../lib/art';
import { statusTags, type NameOf } from '../lib/game';
import type { GameView, PlayerId, RoomView } from '../lib/types';
import { api } from '../net/socket';
import { BackImg, CardImg, Sheet } from './common';
import { MoneyTracker } from './MoneyTracker';

const Crown = () => <img className="crown" src={backSrc('king')} alt="" aria-hidden="true" />;

/** Everyone, in this round's turn order (King first). */
export function PlayerList({ room, name, onSelect }: { room: RoomView; name: NameOf; onSelect: (id: PlayerId) => void }) {
  const g = room.game!;
  const byId = new Map(g.players.map((p) => [p.id, p]));
  const online = new Map(room.members.map((m) => [m.id, m.connected]));
  return (
    <div className="players" role="list" aria-label="Players in turn order">
      {g.turnOrder.map(({ playerId, done }, i) => {
        const p = byId.get(playerId)!;
        const isTurn = g.turn?.playerId === p.id;
        const tags = statusTags(g, p.id, name);
        return (
          <button
            key={p.id} role="listitem" onClick={() => onSelect(p.id)}
            className={`player${p.role === 'king' ? ' is-king' : ''}${isTurn ? ' is-turn' : ''}${p.id === g.you ? ' is-me' : ''}`}
            aria-label={`${p.name}, ${p.role}, ${p.gold} gold${isTurn ? ', playing now' : ''}`}
          >
            <span className={`order${done && g.phase === 'playing' ? ' done' : ''}`}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span className="pname">{p.role === 'king' && <Crown />}{p.name}</span>
              <span className="pmeta">
                {!online.get(p.id) && <span className="tag warn">offline</span>}
                {isTurn && <span className="tag king">playing {g.turn!.plays}/{g.turn!.allowance}</span>}
                <span className="tag">🂠 {p.handCount}</span>
                {p.faceDown.length > 0 && (
                  <span className="tag" title="Face-down cards claimed to be Knights">
                    <span className="fd-backs">{p.faceDown.map((f) => <img key={f.slot} src={backSrc(f.deck)} alt="" />)}</span>
                    {p.faceDown.length} knight?
                  </span>
                )}
                {g.phase === 'negotiation' && p.negotiationDone && <span className="tag">✓ done</span>}
                {tags.map((t) => <span key={t.text} className={`tag${t.warn ? ' warn' : ''}`}>{t.text}</span>)}
              </span>
            </span>
            <span className="pgold">{p.gold}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PlayerSheet({ room, id, name, onClose, onMessage, onOffer }: {
  room: RoomView; id: PlayerId; name: NameOf; onClose: () => void; onMessage: (id: PlayerId) => void; onOffer: (id: PlayerId) => void;
}) {
  const g: GameView = room.game!;
  const p = g.players.find((x) => x.id === id)!;
  const me = id === g.you;
  const tags = statusTags(g, id, name);
  const bad = g.statuses.filter((s) => g.legal.payBadBlood.includes(s.id) && s.kind === 'badBlood');
  const debts = g.statuses.filter((s) => g.legal.freeDebtor.includes(s.id) && s.kind === 'debt' && s.debtor === id);
  return (
    <Sheet onClose={onClose} label={`${p.name}'s details`}>
      <h2>{p.role === 'king' ? '👑 ' : ''}{p.name}{me ? ' (you)' : ''}</h2>
      <p className="center muted">{p.role === 'king' ? 'The King' : 'A Noble'} · seat {p.seat + 1} · {p.handCount} cards in hand</p>
      <div style={{ maxWidth: 260, margin: '12px auto 0' }}>
        <MoneyTracker role={p.role} gold={p.gold} />
      </div>
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t.text} className={`tag${t.warn ? ' warn' : ''}`}>{t.text}</span>)}</div>}
      {p.faceDown.length > 0 && (
        <>
          <p className="section-title">Face down in front of {me ? 'you' : p.name}</p>
          <div className="reveal-row">
            {p.faceDown.map((f) => (
              <div key={f.slot} className="stack" style={{ gap: 4 }}>
                {f.cardKey ? <CardImg cardKey={f.cardKey} /> : <BackImg deck={f.deck} />}
                <small className="faint center">{f.cardKey ? 'you placed this' : `placed by ${name(f.placedBy)}`}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {bad.map((s) => s.kind === 'badBlood' && (
        <button key={s.id} className="btn gold block" onClick={() => api.act({ type: 'payBadBlood', statusId: s.id })}>
          Pay {name(s.a === g.you ? s.b : s.a)} 200 to end the Bad Blood
        </button>
      ))}
      {debts.map((s) => s.kind === 'debt' && (
        <button key={s.id} className="btn gold block" onClick={() => api.act({ type: 'freeDebtor', statusId: s.id })}>
          Free {name(s.debtor)}: pay {name(s.creditor)} 200
        </button>
      ))}
      {!me && (
        <div className="row">
          <button className="btn ghost grow" onClick={() => onMessage(id)}>Message privately</button>
          {g.negotiation && <button className="btn gold grow" onClick={() => onOffer(id)}>Offer a deal</button>}
        </div>
      )}
      <button className="btn dark block" onClick={onClose}>Close</button>
    </Sheet>
  );
}
