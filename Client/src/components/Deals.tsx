// Negotiation Phase (Rules p13-14). Nothing changes hands until the other
// player confirms; no deal is binding.
//   In person: players talk out loud; the Trade pane only records what
//   physically changes hands (give gold / swap a card / discard a card).
//   Virtual: combined offers plus table and private chat.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NameOf } from '../lib/game';
import type { GameView, Offer, PlayerId, RoomView } from '../lib/types';
import { api, useStore } from '../net/socket';
import { CardImg, Countdown, Crown, Sheet } from './common';

const LIMIT = 400;

const me = (g: GameView) => g.players.find((p) => p.id === g.you)!;

/** What an offer does, from the reader's side. */
export function OfferLines({ o, g, name }: { o: Offer; g: GameView; name: NameOf }) {
  const cards = useStore((s) => s.cards);
  const mine = o.from === g.you;
  const from = mine ? 'You' : name(o.from);
  const to = mine ? name(o.to) : 'You';
  const give: string[] = [];
  const ask: string[] = [];
  if (o.giveGold) give.push(`${o.giveGold} gold`);
  if (o.giveCard || o.askCard) give.push(o.giveCardKey ? `the card ${cards[o.giveCardKey]?.name ?? '?'}` : 'a card (face down)');
  if (o.discardCardKey) give.push(`to discard ${cards[o.discardCardKey]?.name ?? 'a card'}`);
  if (o.askGold) ask.push(`${o.askGold} gold`);
  if (o.askCard) ask.push('a card of their choice');
  if (o.askDiscard) ask.push('to discard a card of their choice');
  return (
    <div className="offer-lines">
      {give.length > 0 && <div><b>{from}</b> {mine ? 'give' : 'gives'}: {give.join(', ')}</div>}
      {ask.length > 0 && <div><b>{to}</b> {mine ? 'gives' : 'give'}: {ask.join(', ')}</div>}
    </div>
  );
}

/** The recipient never gets the proposer's card ids, so read the flags. */
function OfferTitle({ o, name }: { o: Offer; name: NameOf }) {
  const swap = o.askCard;
  const discard = Boolean(o.discardCard || o.discardCardKey);
  const asks = o.askGold > 0 || o.askDiscard;
  if (o.giveGold && !swap && !discard && !asks) return <>{name(o.from)} is giving you {o.giveGold} gold</>;
  if (swap && !o.giveGold && !discard && !asks) return <>{name(o.from)} wants to swap a card with you</>;
  if (discard && !o.giveGold && !swap && !asks) return <>{name(o.from)} is discarding a card as part of your deal</>;
  return <>Deal from {name(o.from)}</>;
}

/** Pops up for the player being asked: confirm, refuse, or decide later. */
export function IncomingOfferSheet({ g, offer, name, onLater }: { g: GameView; offer: Offer; name: NameOf; onLater: () => void }) {
  const [give, setGive] = useState<string | null>(null);
  const [toss, setToss] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = (!offer.askCard || give) && (!offer.askDiscard || toss);
  const send = async (action: Parameters<typeof api.act>[0]) => {
    setBusy(true);
    await api.act(action);
    setBusy(false);
  };
  return (
    <Sheet onClose={onLater} label="Incoming offer">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="section-title" style={{ margin: 0 }}>Negotiation</span>
        {g.negotiation && <Countdown deadline={g.negotiation.endsAt} />}
      </div>
      <h2><OfferTitle o={offer} name={name} /></h2>
      <OfferLines o={offer} g={g} name={name} />
      {offer.askCard && <CardPicker g={g} label="Pick the card you give back (you'll see theirs after the swap)" value={give} onChange={setGive} exclude={toss} />}
      {offer.askDiscard && <CardPicker g={g} label="Pick the card you discard (you draw a replacement)" value={toss} onChange={setToss} exclude={give} />}
      <div className="row">
        <button className="btn gold grow" disabled={!ready || busy} onClick={() => send({ type: 'acceptOffer', offerId: offer.id, cardId: give, discardId: toss })}>
          {offer.giveGold && !offer.askCard && !offer.askGold ? 'Take it' : 'Accept'}
        </button>
        <button className="btn ghost grow" disabled={busy} onClick={() => send({ type: 'declineOffer', offerId: offer.id })}>Refuse</button>
      </div>
      <button className="btn dark block" onClick={onLater}>Later</button>
    </Sheet>
  );
}

export function CardPicker({ g, label, value, onChange, exclude }: { g: GameView; label: string; value: string | null; onChange: (id: string | null) => void; exclude?: string | null }) {
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

export function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button className="icon-btn" aria-label="100 less" disabled={value <= 0} onClick={() => onChange(value - 100)}>−</button>
      <output aria-live="polite">{value}</output>
      <button className="icon-btn" aria-label="100 more" disabled={value + 100 > max} onClick={() => onChange(value + 100)}>+</button>
    </div>
  );
}

function NegotiationHeader({ g, intro }: { g: GameView; intro: string }) {
  const you = me(g);
  if (!g.negotiation) return null;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Negotiation</h2>
        <Countdown deadline={g.negotiation.endsAt} />
      </div>
      <p className="muted center" style={{ fontSize: '.82rem' }}>
        {intro} You can still receive <span className="gold">{LIMIT - you.receivedInNegotiation}</span> gold this phase.
      </p>
      <button className={`btn block ${you.negotiationDone ? 'ghost' : 'dark'}`} onClick={() => api.act({ type: 'doneNegotiating', done: !you.negotiationDone })}>
        {you.negotiationDone ? '✓ Done (undo)' : "I'm done negotiating"}
      </button>
      <p className="faint center" style={{ fontSize: '.72rem' }}>The phase ends early once everyone is done.</p>
    </>
  );
}

function Outgoing({ g, name }: { g: GameView; name: NameOf }) {
  const outgoing = g.negotiation?.offers.filter((o) => o.from === g.you) ?? [];
  return (
    <>
      {outgoing.map((o) => (
        <div key={o.id} className="offer">
          <p className="section-title" style={{ margin: 0 }}>Waiting for {name(o.to)} to confirm</p>
          <OfferLines o={o} g={g} name={name} />
          <button className="btn ghost small" onClick={() => api.act({ type: 'cancelOffer', offerId: o.id })}>Withdraw</button>
        </div>
      ))}
    </>
  );
}

function Incoming({ g, name, open }: { g: GameView; name: NameOf; open: (o: Offer) => void }) {
  const incoming = g.negotiation?.offers.filter((o) => o.to === g.you) ?? [];
  return (
    <>
      {incoming.map((o) => (
        <button key={o.id} className="offer incoming" onClick={() => open(o)} style={{ textAlign: 'left', color: 'inherit', background: 'none' }}>
          <p className="section-title" style={{ margin: 0 }}><OfferTitle o={o} name={name} /></p>
          <OfferLines o={o} g={g} name={name} />
          <span className="gold" style={{ fontSize: '.8rem' }}>Tap to answer</span>
        </button>
      ))}
    </>
  );
}

// ---- in person ---------------------------------------------------------------------

type TradeKind = 'gold' | 'swap' | 'discard';

export function TradePane({ room, name, openIncoming }: { room: RoomView; name: NameOf; openIncoming: (o: Offer) => void }) {
  const g = room.game!;
  const [form, setForm] = useState<TradeKind | null>(null);
  const open = Boolean(g.negotiation);
  return (
    <section className="panel stack">
      {open ? (
        <NegotiationHeader g={g} intro="Talk it out loud. When something actually changes hands, record it here — the other player confirms on their phone." />
      ) : (
        <>
          <h2>Trading</h2>
          <p className="muted center" style={{ fontSize: '.85rem' }}>Gold and cards change hands in the Negotiation Phase at the end of each round. Until then — talk, plot and win support for your Betrayal out loud.</p>
        </>
      )}
      <div className="trade-actions">
        <button className="btn gold" disabled={!open} onClick={() => setForm('gold')}>Give gold</button>
        <button className="btn" disabled={!open} onClick={() => setForm('swap')}>Swap a card</button>
        <button className="btn ghost" disabled={!open} onClick={() => setForm('discard')}>Discard a card</button>
      </div>
      <p className="faint center" style={{ fontSize: '.72rem' }}>Deals aren't binding: a "gold for a card" deal is two handovers — and either of you can betray the other halfway.</p>
      <Incoming g={g} name={name} open={openIncoming} />
      <Outgoing g={g} name={name} />
      {form && <TradeSheet g={g} kind={form} name={name} onClose={() => setForm(null)} />}
    </section>
  );
}

function TradeSheet({ g, kind, name, onClose }: { g: GameView; kind: TradeKind; name: NameOf; onClose: () => void }) {
  const you = me(g);
  const [to, setTo] = useState<PlayerId | null>(null);
  const [gold, setGold] = useState(0);
  const [card, setCard] = useState<string | null>(null);
  const them = g.players.find((p) => p.id === to);
  const maxGive = them ? Math.min(you.gold, LIMIT - them.receivedInNegotiation, 2000 - them.gold) : 0;
  const ready = them && (kind === 'gold' ? gold > 0 : Boolean(card));
  const title = kind === 'gold' ? 'Give gold' : kind === 'swap' ? 'Swap a card' : 'Discard a card';
  const who = kind === 'discard' ? 'Who is this deal with? They confirm it.' : kind === 'gold' ? 'Give to' : 'Swap with';
  const send = async () => {
    if (!them) return;
    const action =
      kind === 'gold' ? { type: 'offer', to: them.id, giveGold: gold }
      : kind === 'swap' ? { type: 'offer', to: them.id, giveCard: card, askCard: true }
      : { type: 'offer', to: them.id, discardCard: card };
    const r = await api.act(action);
    if (r.ok) onClose();
  };
  return (
    <Sheet onClose={onClose} label={title}>
      <h2>{title}</h2>
      <p className="section-title">{who}</p>
      <div className="chips">
        {g.players.filter((p) => p.id !== g.you).map((p) => {
          const blocked = kind === 'swap' && p.role !== you.role;
          return (
            <button key={p.id} className={`chip${to === p.id ? ' on' : ''}`} disabled={blocked} title={blocked ? "King and Noble cards can't change hands" : undefined}
              onClick={() => { setTo(p.id); setGold(0); }}>
              {p.role === 'king' && <Crown />}{p.name}
            </button>
          );
        })}
      </div>
      {kind === 'swap' && <p className="faint center" style={{ fontSize: '.75rem' }}>King and Noble cards can't change hands. They pick the card they give back.</p>}
      {them && kind === 'gold' && (
        <>
          <Stepper value={gold} max={Math.max(0, maxGive)} onChange={setGold} />
          <p className="faint center" style={{ fontSize: '.75rem' }}>{them.name} can still receive {LIMIT - them.receivedInNegotiation} gold this phase.</p>
        </>
      )}
      {them && kind !== 'gold' && (
        <CardPicker g={g} label={kind === 'swap' ? 'Your card (they only see it after the swap)' : 'The card you discard (you draw a replacement)'} value={card} onChange={setCard} />
      )}
      <button className="btn gold block" disabled={!ready} onClick={send}>
        {kind === 'gold' ? `Give ${gold} gold${them ? ` to ${them.name}` : ''}` : kind === 'swap' ? 'Ask to swap' : 'Ask them to confirm'}
      </button>
      <button className="btn dark block" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}

// ---- virtual ---------------------------------------------------------------------------

export function DealsPane({ room, name, openOffer, openIncoming, dmTarget, setDmTarget }: {
  room: RoomView; name: NameOf; openOffer: (to?: PlayerId) => void; openIncoming: (o: Offer) => void; dmTarget: PlayerId | null; setDmTarget: (id: PlayerId | null) => void;
}) {
  const g = room.game!;
  return (
    <>
      <section className="panel stack">
        {g.negotiation ? (
          <>
            <NegotiationHeader g={g} intro="Trade gold, swap cards 1-for-1, promise anything. Nothing is binding." />
            <button className="btn gold block" onClick={() => openOffer()}>New offer</button>
          </>
        ) : (
          <p className="muted center" style={{ fontSize: '.85rem' }}>Deals open in the Negotiation Phase at the end of the round. Chat is open any time — use it to win support for a Betrayal.</p>
        )}
        <Incoming g={g} name={name} open={openIncoming} />
        <Outgoing g={g} name={name} />
      </section>
      <Chat room={room} name={name} thread={dmTarget} setThread={setDmTarget} />
    </>
  );
}

export function OfferSheet({ g, name, initialTo, onClose }: { g: GameView; name: NameOf; initialTo?: PlayerId; onClose: () => void }) {
  const you = me(g);
  const [to, setTo] = useState<PlayerId | null>(initialTo ?? null);
  const [giveGold, setGiveGold] = useState(0);
  const [askGold, setAskGold] = useState(0);
  const [giveCard, setGiveCard] = useState<string | null>(null);
  const [discardCard, setDiscardCard] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const them = g.players.find((p) => p.id === to);
  const sameRole = them && them.role === you.role;
  const maxGive = them ? Math.min(you.gold, LIMIT - them.receivedInNegotiation, 2000 - them.gold) : 0;
  const maxAsk = them ? Math.min(them.gold, LIMIT - you.receivedInNegotiation, 2000 - you.gold) : 0;
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
            <CardPicker g={g} label="A card (face down — they give one back)" value={giveCard} onChange={setGiveCard} exclude={discardCard} />
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
          <button key={m.id} role="tab" aria-selected={thread === m.id} className={`chip${thread === m.id ? ' on' : ''}`} onClick={() => setThread(m.id)}>{m.name}</button>
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
