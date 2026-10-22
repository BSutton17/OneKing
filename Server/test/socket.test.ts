// End to end over real sockets: four browsers' worth of clients create/join a
// room, start, play, chat and reconnect. Checks what actually goes over the wire.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { MemoryStore } from '../src/persistence/store.js';
import { createServer } from '../src/server.js';

let server: Awaited<ReturnType<typeof createServer>>;
let url = '';
const clients: Socket[] = [];

before(async () => {
  server = await createServer({ store: new MemoryStore(), log: { error: () => {}, log: () => {} } });
  await new Promise<void>((r) => server.httpServer.listen(0, r));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});
after(async () => {
  clients.forEach((c) => c.close());
  await server.close();
});

type View = any;
function client() {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  let latest: View = null;
  const waiters: ((v: View) => void)[] = [];
  socket.on('room:state', (v: View) => {
    latest = v;
    waiters.splice(0).forEach((w) => w(v));
  });
  const emit = (event: string, payload: object = {}) => new Promise<any>((r) => socket.emit(event, payload, r));
  const next = () => new Promise<View>((r) => waiters.push(r));
  const until = async (pred: (v: View) => boolean) => {
    while (!latest || !pred(latest)) await next();
    return latest;
  };
  return { socket, emit, until, get view() { return latest; } };
}

describe('over real sockets', () => {
  test('create, join, start; each player sees only their own hand; the card catalog arrives on connect', async () => {
    const hello = new Promise<any>((r) => {
      const c = connect(url, { transports: ['websocket'], forceNew: true });
      clients.push(c);
      c.on('server:hello', r);
    });
    const { cards } = await hello;
    assert.equal(cards.length, 44);
    assert.equal(cards.reduce((s: number, c: { copies: number }) => s + c.copies, 0), 99);

    const ann = client();
    await new Promise((r) => ann.socket.on('connect', r as () => void));
    const created = await ann.emit('room:create', { name: 'Ann' });
    assert.ok(created.ok);
    const others = [client(), client(), client()];
    for (const [i, c] of others.entries()) {
      const r = await c.emit('room:join', { name: ['Bob', 'Cat', 'Dan'][i], code: created.code });
      assert.ok(r.ok, r.error);
    }
    await ann.until((v) => v.members.length === 4);
    assert.deepEqual(await others[0].emit('room:start'), { ok: false, error: 'Only the host can do that' });
    assert.ok((await ann.emit('room:start')).ok);

    const all = [ann, ...others];
    const views = await Promise.all(all.map((c) => c.until((v) => v.status === 'playing' && v.game)));
    for (const v of views) {
      assert.equal(v.game.hand.length, 8);
      for (const other of views) {
        if (other === v) continue;
        for (const card of other.game.hand) assert.ok(!JSON.stringify(v).includes(card.id), 'another hand leaked over the wire');
      }
      assert.equal(v.game.players.length, 4);
      assert.ok(v.game.players.every((p: any) => typeof p.handCount === 'number' && !('hand' in p)));
    }

    // the King places a face-down card; everyone sees it, nobody else sees what it is
    const kingId = views[0].game.kingId;
    const kingClient = all[views.findIndex((v) => v.you === kingId)];
    const card = kingClient.view.game.hand.find((h: any) => h.place.ok);
    const target = kingClient.view.game.players.find((p: any) => p.id !== kingId).id;
    const r = await kingClient.emit('game:action', { actionId: 'x1', type: 'place', cardId: card.id, targetId: target });
    assert.ok(r.ok, r.error);
    for (const c of all) {
      const v = await c.until((x) => x.game.players.some((p: any) => p.faceDown.length));
      const fd = v.game.players.find((p: any) => p.id === target).faceDown[0];
      assert.equal(fd.cardKey, c === kingClient ? card.key : null);
    }

    // private chat goes only to the two people
    const bobId = views[1].you;
    assert.ok((await ann.emit('chat:send', { to: bobId, text: 'secret plan' })).ok);
    await others[0].until((v) => v.chat.some((m: any) => m.text === 'secret plan'));
    await ann.until((v) => v.chat.some((m: any) => m.text === 'secret plan'));
    assert.ok((await others[1].emit('chat:send', { to: null, text: 'hi all' })).ok);
    const cat = await others[1].until((v) => v.chat.some((m: any) => m.text === 'hi all'));
    assert.ok(!cat.chat.some((m: any) => m.text === 'secret plan'));

    // reconnect: a brand-new socket with Dan's token gets Dan's seat and hand back
    const dan = others[2].view;
    others[2].socket.close();
    const token = server.manager.rooms.get(created.code)!.members.find((m) => m.id === dan.you)!.token;
    const fresh = client();
    await new Promise((res) => fresh.socket.on('connect', res as () => void));
    assert.ok((await fresh.emit('room:resume', { token })).ok);
    const back = await fresh.until((v) => v.you === dan.you);
    assert.deepEqual(back.game.hand.map((h: any) => h.id).sort(), dan.game.hand.map((h: any) => h.id).sort());
  });

  test('bad payloads are refused without hurting the server', async () => {
    const c = client();
    await new Promise((r) => c.socket.on('connect', r as () => void));
    assert.equal((await c.emit('game:action', { type: 'play' })).ok, false);
    assert.equal((await c.emit('room:join', { name: 'X', code: 12345 })).ok, false);
    const health = await fetch(`${url}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
  });
});
