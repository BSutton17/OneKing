// The table. Phones get four tabs (Table / Hand / Deals / Log) and a dock with
// your own gold; wide screens show all four panes at once.

import { useEffect, useRef, useState } from 'react';
import { CardSheet } from '../components/CardSheet';
import { CardImg, Countdown, useWide } from '../components/common';
import { DealsPane, OfferSheet } from '../components/Deals';
import { MoneyTracker, RoundTracker } from '../components/MoneyTracker';
import { GameOver, LogPane, NowPanel } from '../components/Now';
import { PlayerList, PlayerSheet } from '../components/Players';
import { PromptSheet } from '../components/PromptSheet';
import { art, characterCard } from '../lib/art';
import { namer } from '../lib/game';
import type { PlayerId, RoomView } from '../lib/types';
import { api, toast, useStore } from '../net/socket';

type Tab = 'table' | 'hand' | 'deals' | 'log';

export function Game({ room }: { room: RoomView }) {
  const g = room.game!;
  const name = namer(room);
  const cards = useStore((s) => s.cards);
  const wide = useWide();
  const [tab, setTab] = useState<Tab>('table');
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<PlayerId | null>(null);
  const [hiddenPrompt, setHiddenPrompt] = useState<string | null>(null);
  const [offerTo, setOfferTo] = useState<PlayerId | '' | null>(null); // '' = new offer, no recipient yet
  const [dm, setDm] = useState<PlayerId | null>(null);
  const [overClosed, setOverClosed] = useState(false);

  const me = g.players.find((p) => p.id === g.you)!;
  const prompt = g.resolution?.prompt;
  const myPrompt = prompt?.mine ? prompt : null;
  const myTurn = g.legal.myTurn;
  const playable = g.hand.filter((h) => h.play.ok || h.place.ok).length;
  const incoming = g.negotiation?.offers.filter((o) => o.to === g.you).length ?? 0;

  useAnnouncements(room, name);

  // the money card of the role you hold right now
  const status = myPrompt
    ? `Answer: ${myPrompt.title}`
    : g.phase === 'over'
      ? `${name(g.winner)} is the King. Game over.`
      : myTurn && g.turn
        ? `Your turn — play ${g.turn.allowance - g.turn.plays} more card${g.turn.allowance - g.turn.plays === 1 ? '' : 's'}`
        : g.resolution
          ? g.resolution.kind === 'rolloff' ? 'Roll-off for the crown…' : `${name(g.resolution.actor)} is playing ${cards[g.resolution.cardKey ?? '']?.name ?? 'a card'}…`
          : g.phase === 'negotiation'
            ? g.roundEnding ? 'Ending the round…' : 'Negotiation — make your deals'
            : g.turn ? `${name(g.turn.playerId)} is playing` : '';

  const pane = (id: Tab) => `pane pane-${id}${wide || tab === id ? ' active' : ''}`;

  return (
    <div className="game">
      <header className="topbar">
        <div style={{ width: wide ? 160 : 104 }}><RoundTracker round={g.round} /></div>
        <div className="phase-box">
          <div className="phase-name">Round {g.round} · {g.phase === 'negotiation' ? 'Negotiation' : g.phase === 'over' ? 'Game over' : 'Playing'}</div>
          <div className="faint" style={{ fontSize: '.72rem' }}>{g.direction === 1 ? '⟳ clockwise' : '⟲ counter-clockwise'} · room {room.code}</div>
          {g.phase === 'negotiation' && g.negotiation && <Countdown deadline={g.negotiation.endsAt} />}
        </div>
      </header>
      <button className={`status-line${myPrompt || myTurn ? ' mine' : ''}`} style={{ border: 0, width: '100%', color: 'inherit', font: 'inherit', fontWeight: 800 }}
        onClick={() => (myPrompt ? setHiddenPrompt(null) : myTurn ? setTab('hand') : undefined)}>
        {status}
      </button>

      <main className="panes">
        <section className={pane('table')} aria-label="Table">
          <NowPanel g={g} name={name} onAnswer={() => setHiddenPrompt(null)} />
          <PlayerList room={room} name={name} onSelect={setOpenPlayer} />
          <p className="faint center" style={{ fontSize: '.72rem' }}>
            Decks: King {g.decks.king} · Noble {g.decks.noble} — tap a player for their money card
          </p>
        </section>

        <section className={pane('hand')} aria-label="Your hand">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: wide ? 170 : 120, flex: 'none' }}><MoneyTracker role={me.role} gold={me.gold} caption={false} /></div>
            <div className="stack grow" style={{ gap: 6 }}>
              <h2 style={{ textAlign: 'left' }}>{me.role === 'king' ? '👑 You are the King' : 'You are a Noble'}</h2>
              <span className="me-gold">{me.gold} gold</span>
              <span className="muted" style={{ fontSize: '.82rem' }}>
                {myTurn && g.turn ? `Play ${g.turn.allowance - g.turn.plays} more.` : 'Tap a card to read it.'} Any card can be placed face down as a (claimed) Knight.
              </span>
            </div>
          </div>
          <div className="hand-grid" role="list" aria-label="Cards in your hand">
            {g.hand.map((h) => (
              <div key={h.id} className="card-cell" role="listitem">
                <CardImg cardKey={h.key} dim={myTurn && !h.play.ok && !h.place.ok} onClick={() => setOpenCard(h.id)} />
                <small>{myTurn ? (h.play.ok ? '▶ playable' : h.place.ok ? 'face down only' : '—') : ''}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={pane('deals')} aria-label="Deals and chat">
          <DealsPane room={room} name={name} openOffer={(to) => setOfferTo(to ?? '')} dmTarget={dm} setDmTarget={setDm} />
        </section>

        <section className={pane('log')} aria-label="Game log">
          <LogPane g={g} name={name} />
        </section>
      </main>

      <footer className="dock">
        <div className="me-strip">
          <button className="me-open" onClick={() => setOpenPlayer(g.you)} aria-label="Your money card">
            <img className="mini-card" src={art(characterCard(me.role).src)} alt="" />
            <span className="me-gold">{me.gold}</span>
            <span className="grow muted" style={{ fontSize: '.8rem' }}>{me.role === 'king' ? '👑 King' : 'Noble'} · {me.name}</span>
          </button>
          <button className="btn ghost small" onClick={() => { if (confirm('Leave the game? Your seat is kept if you come back with this browser.')) void api.leave(); }}>Leave</button>
        </div>
        <nav className="tabs" role="tablist">
          {([['table', '♛', 'Table', 0], ['hand', '🂠', 'Hand', myTurn ? playable : 0], ['deals', '🤝', 'Deals', incoming], ['log', '☰', 'Log', 0]] as const).map(([id, ico, label, badge]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              <span className="ico" aria-hidden="true">{ico}</span>{label}
              {badge > 0 && <span className="badge">{badge}</span>}
            </button>
          ))}
        </nav>
      </footer>

      {openCard && g.hand.find((h) => h.id === openCard) && (
        <CardSheet card={g.hand.find((h) => h.id === openCard)!} name={name} isKing={me.role === 'king'} onClose={() => setOpenCard(null)} />
      )}
      {openPlayer && (
        <PlayerSheet room={room} id={openPlayer} name={name} onClose={() => setOpenPlayer(null)}
          onMessage={(id) => { setDm(id); setTab('deals'); setOpenPlayer(null); }}
          onOffer={(id) => { setOpenPlayer(null); setTab('deals'); setOfferTo(id); }} />
      )}
      {offerTo !== null && <OfferSheet g={g} name={name} initialTo={offerTo || undefined} onClose={() => setOfferTo(null)} />}
      {myPrompt && hiddenPrompt !== myPrompt.id && !openCard && (
        <PromptSheet key={myPrompt.id} g={g} prompt={myPrompt} name={name} diceMode={room.settings.diceMode} onHide={() => setHiddenPrompt(myPrompt.id)} />
      )}
      {g.phase === 'over' && !overClosed && <GameOver room={room} name={name} onClose={() => setOverClosed(true)} />}
    </div>
  );
}

/** Speech bubbles, crown changes and "your turn" nudges as the log grows. */
function useAnnouncements(room: RoomView, name: (id: string | undefined) => string) {
  const g = room.game!;
  const seen = useRef<string | null>(g.log.at(-1)?.id ?? null);
  const lastTurn = useRef<string | null>(null);
  useEffect(() => {
    const i = seen.current ? g.log.findIndex((e) => e.id === seen.current) : -1;
    const fresh = g.log.slice(i + 1);
    seen.current = g.log.at(-1)?.id ?? seen.current;
    for (const e of fresh.slice(-4)) {
      if (e.kind === 'speech') toast(e.text, 'speech', name(e.actor));
      if (e.kind === 'crown') toast(e.text, 'info');
      if (e.kind === 'private') toast(e.text, 'info');
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
