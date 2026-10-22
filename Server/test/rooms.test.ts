import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RoomManager } from '../src/rooms/roomManager.js';
import { T0 } from './helpers.js';

function setup(n = 4) {
  let now = T0;
  const kicked: string[] = [];
  // fake timers: callbacks are collected and run by hand
  let timerSeq = 0;
  const pending = new Map<number, () => void>();
  const setT = ((fn: () => void) => (pending.set(++timerSeq, fn), timerSeq)) as never;
  const clearT = ((id: number) => pending.delete(id)) as never;
  const runTimers = () => {
    const fns = [...pending.values()];
    pending.clear();
    fns.forEach((fn) => fn());
  };
  const m = new RoomManager({
    now: () => now,
    timers: { setTimeout: setT, clearTimeout: clearT },
    onKick: (id) => kicked.push(id),
    seed: () => 99,
  });
  const host = m.create({ socketId: 's0', name: 'Ann' });
  assert.ok(host.ok);
  const tokens = [host.token];
  const ids = [host.playerId];
  for (let i = 1; i < n; i++) {
    const j = m.join({ socketId: `s${i}`, name: ['Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'][i - 1], code: host.code });
    assert.ok(j.ok);
    tokens.push(j.token);
    ids.push(j.playerId);
  }
  const room = () => m.rooms.get(host.code)!;
  const sock = (pid: string) => `s${ids.indexOf(pid)}`;
  return { m, code: host.code, tokens, ids, room, sock, kicked, runTimers, advance: (ms: number) => (now += ms), nowOf: () => now };
}

let actionSeq = 0;
const aid = () => `a${++actionSeq}`;

describe('lobby', () => {
  test('room codes are 4 digits; spaces are ignored when joining', () => {
    const { m, code } = setup(1);
    assert.match(code, /^\d{4}$/);
    const j = m.join({ socketId: 'x', name: 'Zed', code: ` ${code.slice(0, 2)} ${code.slice(2)} ` });
    assert.ok(j.ok);
  });

  test('a new room is in person by default; the host can switch it to virtual', () => {
    const { m, room } = setup(4);
    assert.equal(room().settings.mode, 'inPerson');
    assert.equal(m.settings('s1', { mode: 'virtual' }).ok, false, 'only the host');
    assert.ok(m.settings('s0', { mode: 'virtual' }).ok);
    m.start('s0');
    assert.equal(room().game!.config.mode, 'virtual');
  });

  test('clear errors for a missing name, an unknown code, a full room and a started game', () => {
    const { m, code } = setup(8);
    assert.deepEqual(m.join({ socketId: 'x', name: '', code }), { ok: false, error: 'Please enter your name' });
    assert.match((m.join({ socketId: 'x', name: 'Zed', code: 'ABCD' }) as { error: string }).error, /4 digits/);
    const unused = code === '0000' ? '0001' : '0000';
    assert.match((m.join({ socketId: 'x', name: 'Zed', code: unused }) as { error: string }).error, /No room/);
    assert.match((m.join({ socketId: 'x', name: 'Zed', code }) as { error: string }).error, /full/);
    const small = setup(4);
    assert.ok(small.m.start('s0').ok);
    assert.match((small.m.join({ socketId: 'y', name: 'Zed', code: small.code }) as { error: string }).error, /already started/);
  });

  test('only the host can start, and only with 4-8 players', () => {
    const three = setup(3);
    assert.match((three.m.start('s0') as { error: string }).error, /4–8 players/);
    const four = setup(4);
    assert.match((four.m.start('s1') as { error: string }).error, /Only the host/);
    assert.ok(four.m.start('s0').ok);
    assert.equal(four.room().status, 'playing');
  });

  test('the host arranges seats; seat order becomes the game circle', () => {
    const { m, room, ids } = setup(4);
    assert.ok(m.moveSeat('s0', ids[3], -1).ok);
    assert.deepEqual(room().members.map((x) => x.id), [ids[0], ids[1], ids[3], ids[2]]);
    assert.ok(m.start('s0').ok);
    assert.deepEqual(room().game!.seats, [ids[0], ids[1], ids[3], ids[2]]);
  });

  test('duplicate names get a number', () => {
    const { m, code, room } = setup(1);
    m.join({ socketId: 'x', name: 'ann', code });
    assert.deepEqual(room().members.map((x) => x.name), ['Ann', 'ann 2']);
  });
});

describe('private information', () => {
  test("no player's payload ever contains another player's card ids", () => {
    const { m, room, ids } = setup(5);
    m.start('s0');
    const g = room().game!;
    for (const me of ids) {
      const json = JSON.stringify(m.view(room(), me));
      for (const other of ids) {
        if (other === me) continue;
        for (const card of g.players[other].hand) assert.ok(!json.includes(`"${card}"`), `${me} can see ${other}'s ${card}`);
      }
      for (const card of [...g.decks.king, ...g.decks.noble]) assert.ok(!json.includes(`"${card}"`), 'deck contents leak');
    }
  });

  test('in-person rooms have no chat: you talk at the table', () => {
    const { m } = setup(4);
    assert.match((m.chat('s0', { text: 'hello' }) as { error: string }).error, /out loud/);
  });

  test('private messages reach only the two players; public ones reach everyone', () => {
    const { m, room, ids } = setup(4);
    m.settings('s0', { mode: 'virtual' });
    assert.ok(m.chat('s0', { to: ids[1], text: 'psst, ally with me' }).ok);
    assert.ok(m.chat('s2', { to: null, text: 'hello table' }).ok);
    const seen = (pid: string) => m.view(room(), pid).chat.map((c) => c.text);
    assert.deepEqual(seen(ids[0]), ['psst, ally with me', 'hello table']);
    assert.deepEqual(seen(ids[1]), ['psst, ally with me', 'hello table']);
    assert.deepEqual(seen(ids[2]), ['hello table']);
    assert.deepEqual(seen(ids[3]), ['hello table']);
  });

  test('chat is length-limited and rate-limited', () => {
    const { m, room, advance } = setup(4);
    m.settings('s0', { mode: 'virtual' });
    assert.ok(m.chat('s0', { text: 'x'.repeat(1000) }).ok);
    assert.equal(room().chat[0].text.length, 300);
    assert.match((m.chat('s0', { text: 'again' }) as { error: string }).error, /Slow down/);
    advance(500);
    assert.ok(m.chat('s0', { text: 'again' }).ok);
  });
});

describe('actions', () => {
  function started() {
    const s = setup(5);
    s.m.start('s0');
    return s;
  }

  test("you can't act for someone else, and a game action needs an action id", () => {
    const { m, room, sock } = started();
    const g = room().game!;
    const current = g.turn!.playerId;
    const other = g.seats.find((x) => x !== current)!;
    const r = m.act(sock(other), { actionId: aid(), type: 'play', cardId: g.players[current].hand[0] });
    assert.equal(r.ok, false);
    assert.match((m.act(sock(current), { type: 'endTurn' }) as { error: string }).error, /action id/);
    assert.match((m.act('nobody', { actionId: aid(), type: 'endTurn' }) as { error: string }).error, /not in a room/);
  });

  test('a replayed action (same id) is acknowledged but not applied twice', () => {
    const { m, room, sock } = started();
    const g = room().game!;
    const k = g.turn!.playerId;
    const card = g.players[k].hand[0];
    const action = { actionId: 'same-id', type: 'place', cardId: card, targetId: g.seats.find((x) => x !== k) };
    assert.ok(m.act(sock(k), action).ok);
    const after = room().game!;
    assert.deepEqual(m.act(sock(k), action), { ok: true, duplicate: true });
    assert.equal(room().game, after, 'state unchanged');
    assert.equal(after.turn!.plays, 1);
  });

  test("clients can't set balances: the server ignores anything but the action", () => {
    const { m, room, sock } = started();
    const g = room().game!;
    const k = g.turn!.playerId;
    m.act(sock(k), { actionId: aid(), type: 'place', cardId: g.players[k].hand[0], targetId: g.seats.find((x) => x !== k), gold: 2000, players: {} });
    assert.equal(room().game!.players[k].gold, 1000);
  });
});

describe('connections and timers', () => {
  test('reconnecting with the token restores the same seat; a bad token is refused', () => {
    const { m, room, tokens, ids } = setup(4);
    m.start('s0');
    m.disconnect('s1');
    assert.equal(room().members[1].connected, false);
    assert.equal(room().status, 'playing', 'the game goes on');
    const r = m.resume({ socketId: 'new-socket', token: tokens[1] });
    assert.deepEqual(r, { ok: true, code: room().code, playerId: ids[1] });
    assert.equal(room().members[1].connected, true);
    assert.equal(m.resume({ socketId: 'z', token: 'nope' }).ok, false);
  });

  test('opening the game in a second tab moves you there and tells the first tab', () => {
    const { m, tokens, kicked } = setup(4);
    m.resume({ socketId: 'tab2', token: tokens[0] });
    assert.deepEqual(kicked, ['s0']);
  });

  test('a disconnected lobby member loses their seat after the grace period; mid-game the seat is kept', () => {
    const lobby = setup(4);
    lobby.m.disconnect('s3');
    assert.equal(lobby.room().members.length, 4, 'kept during the grace period');
    lobby.runTimers();
    assert.equal(lobby.room().members.length, 3, 'freed after it');

    const game = setup(4);
    game.m.start('s0');
    game.m.disconnect('s3');
    game.runTimers();
    assert.equal(game.room().members.length, 4);
    assert.equal(game.room().game!.seats.length, 4);
  });

  test('if the host leaves the lobby, the next player becomes host', () => {
    const { m, room, ids } = setup(4);
    m.leave('s0');
    assert.equal(room().hostId, ids[1]);
  });

  test('the negotiation timer is owned by the server: firing it moves the game to round 2', () => {
    const { m, room, sock, advance, nowOf } = setup(4);
    m.start('s0');
    for (let guard = 0; guard < 20 && room().game!.phase === 'playing'; guard++) {
      const g = room().game!;
      const pid = g.turn!.playerId;
      const target = g.players[pid].role === 'king' ? g.seats.find((x) => x !== pid) : pid;
      assert.ok(m.act(sock(pid), { actionId: aid(), type: 'place', cardId: g.players[pid].hand[0], targetId: target }).ok);
    }
    const g = room().game!;
    assert.equal(g.phase, 'negotiation');
    advance(g.negotiation!.endsAt - nowOf());
    m.fire(room().code);
    assert.equal(room().game!.round, 2);
  });

  test("everyone pressing Done ends negotiation early", () => {
    const { m, room, sock, ids } = setup(4);
    m.start('s0');
    for (let guard = 0; guard < 20 && room().game!.phase === 'playing'; guard++) {
      const g = room().game!;
      const pid = g.turn!.playerId;
      const target = g.players[pid].role === 'king' ? g.seats.find((x) => x !== pid) : pid;
      m.act(sock(pid), { actionId: aid(), type: 'place', cardId: g.players[pid].hand[0], targetId: target });
    }
    for (const id of ids) m.act(sock(id), { actionId: aid(), type: 'doneNegotiating', done: true });
    assert.equal(room().game!.round, 2);
  });

  test("a disconnected player's turn is skipped after 60 seconds", () => {
    const { m, room, sock, advance } = setup(4);
    m.start('s0');
    const k = room().game!.turn!.playerId;
    m.disconnect(sock(k));
    advance(59_000);
    m.fire(room().code);
    assert.equal(room().game!.turn!.playerId, k);
    advance(2_000);
    m.fire(room().code);
    assert.notEqual(room().game!.turn!.playerId, k);
  });

  test('a player skipped mid-turn still ends with 8 cards (Rules p15)', () => {
    const { m, room, sock, advance } = setup(5);
    m.start('s0');
    const g = room().game!;
    const k = g.turn!.playerId;
    m.act(sock(k), { actionId: aid(), type: 'place', cardId: g.players[k].hand[0], targetId: g.seats.find((x) => x !== k) });
    assert.equal(room().game!.players[k].hand.length, 7);
    m.disconnect(sock(k));
    advance(61_000);
    m.fire(room().code);
    assert.notEqual(room().game!.turn!.playerId, k);
    assert.equal(room().game!.players[k].hand.length, 8);
  });
});
