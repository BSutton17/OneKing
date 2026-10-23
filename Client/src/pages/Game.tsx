// The table. Phones in portrait get four tabs in a bottom dock; phones in
// landscape get the same tabs as a rail on the left; wide screens show every
// pane at once. In-person games have a Trade tab (no chat); virtual games have
// Deals + chat.

import { useEffect, useRef, useState } from 'react';
import { CardSheet } from '../components/CardSheet';
import { CardImg, Countdown, useWide } from '../components/common';
import { DealsPane, IncomingOfferSheet, OfferSheet, TradePane } from '../components/Deals';
import { MoneyTracker, RoundTracker } from '../components/MoneyTracker';
import { GameOver, LogPane, NowPanel } from '../components/Now';
import { AllGoldSheet, PlayerList, PlayerSheet } from '../components/Players';
import { PromptSheet } from '../components/PromptSheet';
import { art, characterCard } from '../lib/art';
import { namer, type NameOf } from '../lib/game';
import type { Offer, PlayerId, RoomView } from '../lib/types';
import { api, toast, useStore } from '../net/socket';

type Tab = 'table' | 'hand' | 'deals' | 'log';

export function Game({ room }: { room: RoomView }) {
  const g = room.game!;
  const name = namer(room);
  const cards = useStore((s) => s.cards);
  const wide = useWide();
  const inPerson = g.mode === 'inPerson';
  const [tab, setTab] = useState<Tab>('table');
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<PlayerId | null>(null);
  const [allGold, setAllGold] = useState(false);
  const [hiddenPrompt, setHiddenPrompt] = useState<string | null>(null);
  const [offerTo, setOfferTo] = useState<PlayerId | '' | null>(null); // '' = new offer, no recipient yet
  const [laterOffers, setLaterOffers] = useState<string[]>([]);
  const [shownOffer, setShownOffer] = useState<string | null>(null);
  const [dm, setDm] = useState<PlayerId | null>(null);
  const [overClosed, setOverClosed] = useState(false);

  const me = g.players.find((p) => p.id === g.you)!;
  const prompt = g.resolution?.prompt;
  const myPrompt = prompt?.mine ? prompt : null;
  const myTurn = g.legal.myTurn;
  const playable = g.hand.filter((h) => h.play.ok || h.place.ok).length;
  const incoming = g.negotiation?.offers.filter((o) => o.to === g.you) ?? [];
  // an incoming offer pops up by itself (unless you said "Later" or are answering a card)
  const popOffer: Offer | undefined =
    incoming.find((o) => o.id === shownOffer) ?? incoming.find((o) => !laterOffers.includes(o.id));

  useAnnouncements(room, name);

  const status = myPrompt
    ? `Answer: ${myPrompt.title}`
    : g.phase === 'over'
      ? `${name(g.winner)} is the King. Game over.`
      : myTurn && g.turn
        ? `Your turn — play ${g.turn.allowance - g.turn.plays} more card${g.turn.allowance - g.turn.plays === 1 ? '' : 's'}`
        : g.resolution
          ? g.resolution.kind === 'rolloff' ? 'Roll-off for the crown…' : `${name(g.resolution.actor)} is playing ${cards[g.resolution.cardKey ?? '']?.name ?? 'a card'}…`
          : g.phase === 'negotiation'
            ? g.roundEnding ? 'Ending the round…' : inPerson ? 'Negotiate out loud!' : 'Negotiation — make your deals'
            : g.turn ? `${name(g.turn.playerId)} is playing` : '';

  const pane = (id: Tab) => `pane pane-${id}${wide || tab === id ? ' active' : ''}`;
  const leave = () => {
    if (confirm('Leave the game? Your seat is kept if you come back with this browser.')) void api.leave();
  };
  const tabs = [
    ['table', 'Table', 0],
    ['hand', 'Hand', myTurn ? playable : 0],
    ['deals', inPerson ? 'Trade' : 'Deals', incoming.length],
    ['log', 'Log', 0],
  ] as const;

  return (
    <div className="game">
      <header className="topbar">
        <div className="tb-tracker"><RoundTracker round={g.round} /></div>
        <div className="tb-info">
          <div className="phase-name">R{g.round} · {g.phase === 'negotiation' ? 'Negotiation' : g.phase === 'over' ? 'Game over' : 'Playing'}</div>
          <div className="faint tb-sub">{g.direction === 1 ? '⟳ clockwise' : '⟲ counter'} · room {room.code}</div>
          {g.phase === 'negotiation' && g.negotiation && <Countdown deadline={g.negotiation.endsAt} />}
        </div>
        <button className="tb-gold" onClick={() => setAllGold(true)} aria-label="See everyone's gold">
          Gold
        </button>
        <button className={`status-line${myPrompt || myTurn ? ' mine' : ''}`}
          onClick={() => (myPrompt ? setHiddenPrompt(null) : myTurn ? setTab('hand') : undefined)}>
          {status}
        </button>
      </header>

      <main className="panes">
        <section className={pane('table')} aria-label="Table">
          <NowPanel g={g} name={name} onAnswer={() => setHiddenPrompt(null)} />
          <div className="stack" style={{ gap: 8 }}>
            <PlayerList room={room} name={name} onSelect={setOpenPlayer} />
            <p className="faint center" style={{ fontSize: '.72rem' }}>Decks: King {g.decks.king} · Noble {g.decks.noble} — tap a player for details</p>
          </div>
        </section>

        <section className={pane('hand')} aria-label="Your hand">
          <div className="hand-head">
            <div className="hand-money"><MoneyTracker role={me.role} gold={me.gold} caption={false} /></div>
            <div className="stack grow" style={{ gap: 4 }}>
              <h2 style={{ textAlign: 'left' }}>{me.role === 'king' ? 'You are the King' : 'You are a Noble'}</h2>
              <span className="me-gold">{me.gold} gold</span>
              <span className="muted" style={{ fontSize: '.8rem' }}>
                {myTurn && g.turn ? `Play ${g.turn.allowance - g.turn.plays} more.` : 'Tap a card to read it.'} Any card can be placed face down as a (claimed) Knight.
              </span>
            </div>
          </div>
          <div className="hand-grid" role="list" aria-label="Cards in your hand">
            {g.hand.map((h) => (
              <div key={h.id} className="card-cell" role="listitem">
                <CardImg cardKey={h.key} dim={myTurn && !h.play.ok && !h.place.ok} onClick={() => setOpenCard(h.id)} />
                <small>{myTurn ? (h.play.ok ? 'Playable' : h.place.ok ? 'face down only' : '—') : ''}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={pane('deals')} aria-label={inPerson ? 'Trade' : 'Deals and chat'}>
          {inPerson ? (
            <TradePane room={room} name={name} openIncoming={(o) => setShownOffer(o.id)} />
          ) : (
            <DealsPane room={room} name={name} openOffer={(to) => setOfferTo(to ?? '')} openIncoming={(o) => setShownOffer(o.id)} dmTarget={dm} setDmTarget={setDm} />
          )}
        </section>

        <section className={pane('log')} aria-label="Game log">
          <LogPane g={g} name={name} />
        </section>
      </main>

      <footer className="dock">
        <button className="me-open" onClick={() => setOpenPlayer(g.you)} aria-label="Your money card">
          <img className="mini-card" src={art(characterCard(me.role).src)} alt="" />
          <span className="me-gold">{me.gold}</span>
          <span className="me-label muted">{me.role === 'king' ? 'King' : 'Noble'} · {me.name}</span>
        </button>
        <nav className="tabs" role="tablist">
          {tabs.map(([id, label, badge]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              {label}
              {badge > 0 && <span className="badge">{badge}</span>}
            </button>
          ))}
        </nav>
        <button className="btn ghost small leave-btn" onClick={leave}>Leave</button>
      </footer>

      {openCard && g.hand.find((h) => h.id === openCard) && (
        <CardSheet card={g.hand.find((h) => h.id === openCard)!} name={name} isKing={me.role === 'king'} onClose={() => setOpenCard(null)} />
      )}
      {openPlayer && (
        <PlayerSheet room={room} id={openPlayer} name={name} onClose={() => setOpenPlayer(null)}
          onMessage={inPerson ? undefined : (id) => { setDm(id); setTab('deals'); setOpenPlayer(null); }}
          onOffer={(id) => { setOpenPlayer(null); setTab('deals'); if (!inPerson) setOfferTo(id); }} />
      )}
      {allGold && <AllGoldSheet g={g} onClose={() => setAllGold(false)} />}
      {offerTo !== null && <OfferSheet g={g} name={name} initialTo={offerTo || undefined} onClose={() => setOfferTo(null)} />}
      {myPrompt && hiddenPrompt !== myPrompt.id && !openCard ? (
        <PromptSheet key={myPrompt.id} g={g} prompt={myPrompt} name={name} diceMode={room.settings.diceMode} onHide={() => setHiddenPrompt(myPrompt.id)} />
      ) : (
        popOffer && !openCard && offerTo === null && (
          <IncomingOfferSheet key={popOffer.id} g={g} offer={popOffer} name={name}
            onLater={() => { setLaterOffers((l) => [...l, popOffer.id]); setShownOffer(null); }} />
        )
      )}
      {g.phase === 'over' && !overClosed && <GameOver room={room} name={name} onClose={() => setOverClosed(true)} />}
    </div>
  );
}

/** Speech bubbles / out-loud instructions, crown changes and "your turn" nudges as the log grows. */
function useAnnouncements(room: RoomView, name: NameOf) {
  const g = room.game!;
  const seen = useRef<string | null>(g.log.at(-1)?.id ?? null);
  const lastTurn = useRef<string | null>(null);
  useEffect(() => {
    const i = seen.current ? g.log.findIndex((e) => e.id === seen.current) : -1;
    const fresh = g.log.slice(i + 1);
    seen.current = g.log.at(-1)?.id ?? seen.current;
    for (const e of fresh.slice(-4)) {
      if (e.kind === 'speech') toast(e.text, 'speech', name(e.actor));
      if (e.kind === 'say') toast(e.text, 'say');
      if (e.kind === 'crown' || e.kind === 'private' || e.kind === 'deal') toast(e.text, 'info');
    }
  }, [g.log, name]);
  useEffect(() => {
    const t = g.turn?.playerId ?? null;
    if (t === g.you && lastTurn.current !== t) {
      toast('Your turn!', 'info');
      navigator.vibrate?.(120);
    }
    lastTurn.current = t;
  }, [g.turn?.playerId, g.you]);
  const promptId = g.resolution?.prompt?.mine ? g.resolution.prompt.id : null;
  useEffect(() => {
    if (promptId) navigator.vibrate?.([60, 40, 60]);
  }, [promptId]);
}
