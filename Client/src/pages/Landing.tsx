import { useState } from 'react';
import { BackImg } from '../components/common';
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
    <main className="screen landing">
      <div className="landing-hero">
        <div className="landing-crown"><BackImg deck="king" /></div>
        <h1 className="game-title">One King<br />One Crown</h1>
        <p className="tagline">Betray. Lie. Manipulate.<br />There's only One Crown.</p>
      </div>

      <div className="landing-side stack">
        {notice && <p className="notice" role="alert">{notice}</p>}
        <div className="panel stack">
          <label className="section-title" htmlFor="name">Your name</label>
          <input id="name" className="input" value={name} maxLength={16} autoComplete="nickname" placeholder="e.g. Lebron James" onChange={(e) => setName(e.target.value)} />

          <button className="btn gold block" disabled={!named || busy || !connected} onClick={() => go(() => api.create(name.trim()))}>
            Create a private room
          </button>

          <div className="divider">or</div>
          <input
            className="input code-input" value={code} maxLength={4} placeholder="0000" aria-label="4-digit room code" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <button className="btn block" disabled={!named || code.length !== 4 || busy || !connected} onClick={() => go(() => api.join(name.trim(), code))}>
            Join room
          </button>
          {!connected && <p className="faint center">Connecting to the server…</p>}
        </div>
      </div>
    </main>
  );
}
