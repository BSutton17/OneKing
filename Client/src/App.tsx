import { useEffect } from 'react';
import { Game } from './pages/Game';
import { Landing } from './pages/Landing';
import { Lobby } from './pages/Lobby';
import { keepServerAwake } from './net/keepAwake';
import { serverUrl, socket, useStore } from './net/socket';

export function App() {
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);
  const everConnected = useStore((s) => s.everConnected);
  const toasts = useStore((s) => s.toasts);
  const playing = room?.status === 'playing';
  useEffect(() => (playing ? keepServerAwake(serverUrl, socket) : undefined), [playing]);

  return (
    <>
      {!room ? <Landing /> : room.status === 'lobby' ? <Lobby room={room} /> : <Game room={room} />}
      <div className="toasts" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.who && <b>{t.who} says</b>}
            {t.tone === 'speech' ? `“${t.text}”` : t.text}
          </div>
        ))}
      </div>
      {room && everConnected && !connected && <div className="conn" role="status">Reconnecting…</div>}
    </>
  );
}

