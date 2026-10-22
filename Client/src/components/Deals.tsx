// Negotiation Phase (Rules p13-14): offers (nothing happens until the other
// player accepts; no deal is binding) and table / private chat.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NameOf } from '../lib/game';
import type { GameView, Offer, PlayerId, RoomView } from '../lib/types';
import { api, useStore } from '../net/socket';
import { CardImg, Countdown, Sheet } from './common';

const LIMIT = 400;

function OfferLines({ o, g, name }: { o: Offer; g: GameView; name: NameOf }) {
  const cards = useStore((s) => s.cards);
  const mine = o.from === g.you;
  const from = mine ? 'You' : name(o.from);
  const to = mine ? name(o.to) : 'You';
  const give: string[] = [];
  const ask: string[] = [];
  if (o.giveGold) give.push(`${o.giveGold} gold`);
  if (o.giveCardKey) give.push(`the card ${cards[o.giveCardKey]?.name ?? '?'}`);
  if (o.discardCardKey) give.push(`to discard ${cards[o.discardCardKey]?.name ?? 'a card'}`);
  if (o.askGold) ask.push(`${o.askGold} gold`);
  if (o.askCard) ask.push('a card of their choice');
  if (o.askDiscard) ask.push('to discard a card of their choice');
  return (
    <div className="offer-lines">
      {give.length > 0 && <div><b>{from}</b> {mine ? 'offer' : 'offers'}: {give.join(', ')}</div>}
      {ask.length > 0 && <div><b>{to}</b> {mine ? 'gives' : 'give'}: {ask.join(', ')}</div>}
    </div>
  );
}

export function DealsPane({ room, name, openOffer, dmTarget, setDmTarget }: {
  room: RoomView; name: NameOf; openOffer: (to?: PlayerId) => void; dmTarget: PlayerId | null; setDmTarget: (id: PlayerId | null) => void;
}) {
  const g = room.game!;
  const me = g.players.find((p) => p.id === g.you)!;
  const [accepting, setAccepting] = useState<Offer | null>(null);
  const offers = g.negotiation?.offers ?? [];
  const incoming = offers.filter((o) => o.to === g.you);
  const outgoing = offers.filter((o) => o.from === g.you);

  return (
    <>
      <section className="panel stack">
        {g.negotiation ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Negotiation</h2>
              <Countdown deadline={g.negotiation.endsAt} />
            </div>
            <p className="muted center" style={{ fontSize: '.82rem' }}>
              Trade gold, swap cards 1-for-1, promise anything. Nothing is binding. You can still receive <span className="gold">{LIMIT - me.receivedInNegotiation}</span> gold this phase.
            </p>
            <div className="row">
              <button className="btn gold grow" onClick={() => openOffer()}>New offer</button>
              <button className={`btn grow ${me.negotiationDone ? 'ghost' : 'dark'}`} onClick={() => api.act({ type: 'doneNegotiating', done: !me.negotiationDone })}>
                {me.negotiationDone ? '✓ Done (undo)' : "I'm done"}
              </button>
            </div>
            <p className="faint center" style={{ fontSize: '.72rem' }}>The phase ends early if everyone online is done.</p>
          </>
        ) : (
          <p className="muted center" style={{ fontSize: '.85rem' }}>Deals open in the Negotiation Phase at the end of the round. Chat is open any time — use it to win support for a Betrayal.</p>
        )}

        {incoming.map((o) => (
          <div key={o.id} className="offer incoming">
            <p className="section-title" style={{ margin: 0 }}>Offer from {name(o.from)}</p>
            <OfferLines o={o} g={g} name={name} />
            <div className="row">
              <button className="btn gold small grow" onClick={() => (o.askCard || o.askDiscard ? setAccepting(o) : api.act({ type: 'acceptOffer', offerId: o.id }))}>Accept</button>
              <button className="btn ghost small grow" onClick={() => api.act({ type: 'declineOffer', offerId: o.id })}>Decline</button>
            </div>
          </div>
        ))}
        {outgoing.map((o) => (
          <div key={o.id} className="offer">
            <p className="section-title" style={{ margin: 0 }}>Your offer to {name(o.to)} — waiting</p>
            <OfferLines o={o} g={g} name={name} />
            <button className="btn ghost small" onClick={() => api.act({ type: 'cancelOffer', offerId: o.id })}>Withdraw</button>
          </div>
        ))}
      </section>

      <Chat room={room} name={name} thread={dmTarget} setThread={setDmTarget} />
      {accepting && <AcceptSheet g={g} offer={accepting} name={name} onClose={() => setAccepting(null)} />}
    </>
  );
}

function AcceptSheet({ g, offer, name, onClose }: { g: GameView; offer: Offer; name: NameOf; onClose: () => void }) {
  const [give, setGive] = useState<string | null>(null);
  const [toss, setToss] = useState<string | null>(null);
  const ready = (!offer.askCard || give) && (!offer.askDiscard || toss);
  return (
    <Sheet onClose={onClose} label="Accept offer">
      <h2>Deal with {name(offer.from)}</h2>
      <OfferLines o={offer} g={g} name={name} />
      {offer.askCard && <CardPicker g={g} label="Pick the card you give in exchange" value={give} onChange={setGive} exclude={toss} />}
      {offer.askDiscard && <CardPicker g={g} label="Pick the card you discard (you draw a replacement)" value={toss} onChange={setToss} exclude={give} />}
      <button className="btn gold block" disabled={!ready} onClick={async () => {
        const r = await api.act({ type: 'acceptOffer', offerId: offer.id, cardId: give, discardId: toss });
        if (r.ok) onClose();
      }}>Accept the deal</button>
      <button className="btn dark block" onClick={onClose}>Back</button>
    </Sheet>
  );
}

function CardPicker({ g, label, value, onChange, exclude }: { g: GameView; label: string; value: string | null; onChange: (id: string | null) => void; exclude?: string | null }) {
  return (
    <div className="stack">
      <p className="section-title">{label}</p>
      <div className="reveal-row">
        {g.hand.filter((h) => h.id !== exclude).map((h) => (
          <CardImg key={h.id} cardKey={h.key} selected={value === h.id} onClick={() => onChange(value === h.id ? null : h.id)} />
        ))}
      </div>
    </div>
  );
}

export function OfferSheet({ g, name, initialTo, onClose }: { g: GameView; name: NameOf; initialTo?: PlayerId; onClose: () => void }) {
  const me = g.players.find((p) => p.id === g.you)!;
  const [to, setTo] = useState<PlayerId | null>(initialTo ?? null);
  const [giveGold, setGiveGold] = useState(0);
  const [askGold, setAskGold] = useState(0);
  const [giveCard, setGiveCard] = useState<string | null>(null);
  const [discardCard, setDiscardCard] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const them = g.players.find((p) => p.id === to);
  const sameRole = them && them.role === me.role;
  const maxGive = them ? Math.min(me.gold, LIMIT - them.receivedInNegotiation, 2000 - them.gold) : 0;
  const maxAsk = them ? Math.min(them.gold, LIMIT - me.receivedInNegotiation, 2000 - me.gold) : 0;
  const empty = !giveGold && !askGold && !giveCard && !discardCard && !askDiscard;

  return (
    <Sheet onClose={onClose} label="New offer">
      <h2>New offer</h2>
      <p className="section-title">To</p>
      <div className="chips">
        {g.players.filter((p) => p.id !== g.you).map((p) => (
          <button key={p.id} className={`chip${to === p.id ? ' on' : ''}`} onClick={() => { setTo(p.id); setGiveCard(null); setGiveGold(0); setAskGold(0); }}>{p.name}</button>
        ))}
      </div>
      {them && (
        <>
          <p className="section-title">You give</p>
          <Stepper value={giveGold} max={Math.max(0, maxGive)} onChange={setGiveGold} />
          {sameRole ? (
            <CardPicker g={g} label="A card (they must give one back — cards swap 1-for-1)" value={giveCard} onChange={setGiveCard} exclude={discardCard} />
          ) : (
            <p className="faint center" style={{ fontSize: '.78rem' }}>King and Noble cards can't change hands — gold only with {them.role === 'king' ? 'the King' : 'a Noble'}.</p>
          )}
          <CardPicker g={g} label="Discard one of your cards as part of the deal (optional)" value={discardCard} onChange={setDiscardCard} exclude={giveCard} />
          <p className="section-title">You ask {them.name} for</p>
          <Stepper value={askGold} max={Math.max(0, maxAsk)} onChange={setAskGold} />
          {giveCard && <p className="center muted">…and a card of their choice in exchange</p>}
          <label className="row center" style={{ fontSize: '.85rem' }}>
            <input type="checkbox" checked={askDiscard} onChange={(e) => setAskDiscard(e.target.checked)} /> They discard a card of their choice
          </label>
          <button className="btn gold block" disabled={empty} onClick={async () => {
            const r = await api.act({ type: 'offer', to: them.id, giveGold, askGold, giveCard, askCard: Boolean(giveCard), discardCard, askDiscard });
            if (r.ok) onClose();
          }}>Send offer</button>
        </>
      )}
      <button className="btn dark block" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button className="icon-btn" aria-label="100 less" disabled={value <= 0} onClick={() => onChange(value - 100)}>−</button>
      <output aria-live="polite">{value}</output>
      <button className="icon-btn" aria-label="100 more" disabled={value + 100 > max} onClick={() => onChange(value + 100)}>+</button>
    </div>
  );
}

function Chat({ room, name, thread, setThread }: { room: RoomView; name: NameOf; thread: PlayerId | null; setThread: (id: PlayerId | null) => void }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const you = room.you;
  const msgs = useMemo(
    () => room.chat.filter((c) => (thread === null ? c.to === null : (c.from === you && c.to === thread) || (c.from === thread && c.to === you))),
    [room.chat, thread, you],
  );
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [msgs.length, thread]);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const r = await api.chat(thread, t);
    if (r.ok) setText('');
  };
  return (
    <section className="panel stack">
      <h3>Chat</h3>
      <div className="threads" role="tablist" aria-label="Conversations">
        <button role="tab" aria-selected={thread === null} className={`chip${thread === null ? ' on' : ''}`} onClick={() => setThread(null)}>Everyone</button>
        {room.members.filter((m) => m.id !== you).map((m) => (
          <button key={m.id} role="tab" aria-selected={thread === m.id} className={`chip${thread === m.id ? ' on' : ''}`} onClick={() => setThread(m.id)}>🔒 {m.name}</button>
        ))}
      </div>
      <p className="faint center" style={{ fontSize: '.72rem' }}>{thread ? `Private — only you and ${name(thread)} see this` : 'Public — the whole table sees this'}</p>
      <div className="messages" ref={box} aria-live="polite">
        {msgs.length === 0 && <p className="faint center">No messages yet.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg${m.from === you ? ' mine' : ''}${m.to ? ' private' : ''}`}>
            <span className="who">{m.from === you ? 'You' : name(m.from)} · {new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {m.text}
          </div>
        ))}
      </div>
      <form className="compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="input" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder={thread ? `Whisper to ${name(thread)}…` : 'Say something to everyone…'} aria-label="Message" />
        <button className="btn gold" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
