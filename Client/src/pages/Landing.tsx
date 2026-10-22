import { useState } from 'react';
import { Credits } from '../components/Credits';
import { bannerSrc } from '../lib/art';
import { api, savedName, useStore } from '../net/socket';

export function Landing() {
  const notice = useStore((s) => s.notice);
  const connected = useStore((s) => s.connected);
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const named = name.trim().length > 0;

  return (
    <main className="screen">
      <img className="banner" src={bannerSrc} alt="One King One Crown" />
      <p className="tagline">Betray. Lie. Manipulate.<br />There's only One Crown.</p>
      {notice && <p className="notice" role="alert">{notice}</p>}

      <div className="panel stack" style={{ width: '100%' }}>
        <label className="section-title" htmlFor="name">Your name</label>
        <input id="name" className="input" value={name} maxLength={16} autoComplete="nickname" placeholder="e.g. Lady Macbeth" onChange={(e) => setName(e.target.value)} />

        <button className="btn gold block" disabled={!named || busy || !connected} onClick={() => go(() => api.create(name.trim()))}>
          Create a private room
        </button>

        <div className="divider">or join friends</div>
        <input
          className="input code-input" value={code} maxLength={4} placeholder="0000" aria-label="4-digit room code" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <button className="btn block" disabled={!named || code.length !== 4 || busy || !connected} onClick={() => go(() => api.join(name.trim(), code))}>
          Join room
        </button>
        {!connected && <p className="faint center">Connecting to the server…</p>}
      </div>

      <section className="panel flat stack" style={{ width: '100%', background: 'rgba(0,0,0,.25)' }}>
        <h3>How it works</h3>
        <p className="muted center" style={{ fontSize: '.88rem', lineHeight: 1.5 }}>
          4–8 players, one phone each — around the same table or apart. Four rounds. Become King by having more gold than the King,
          and be King when round four ends. Every round: play your cards, then two minutes to negotiate. No deal is binding.
        </p>
      </section>
      <Credits />
    </main>
  );
}
