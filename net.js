// Peer-to-peer transport over WebRTC (PeerJS, loaded as window.Peer).
// The host's peer id is derived from a short lobby code; PeerJS's public server is only used to introduce peers.
const PREFIX = 'strikebrawl-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => [...Array(5)].map(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function emitter() {
  const fns = {};
  return {
    on(type, fn) { (fns[type] ||= []).push(fn); },
    emit(type, ...args) { for (const fn of fns[type] || []) fn(...args); },
  };
}
const timeout = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

export async function host() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const peer = new window.Peer(PREFIX + code, { debug: 0 });
    try {
      await Promise.race([
        new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); }),
        timeout(10000, 'Could not reach the matchmaking server. Check your internet connection.'),
      ]);
    } catch (e) {
      peer.destroy();
      if (e.type === 'unavailable-id') continue;
      throw new Error(e.message || 'Could not start hosting.');
    }
    const ev = emitter(), conns = new Map();
    peer.on('connection', conn => {
      conn.on('data', msg => {
        if (msg.t === 'hello' && !conns.has(conn.peer)) { conns.set(conn.peer, conn); ev.emit('join', conn.peer, String(msg.name || 'Player').slice(0, 14), String(msg.v || 'old')); }
        else if (conns.has(conn.peer)) ev.emit('msg', conn.peer, msg);
      });
      const gone = () => { if (conns.delete(conn.peer)) ev.emit('leave', conn.peer); };
      conn.on('close', gone); conn.on('error', gone);
    });
    // the lobby code stays reachable even if the signalling socket drops mid-game
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
      mode: 'host', code, myId: 'host', on: ev.on,
      send(id, msg) { const c = conns.get(id); if (c?.open) c.send(msg); },
      broadcast(msg) { for (const c of conns.values()) if (c.open) c.send(msg); },
      kick(id) { conns.get(id)?.close(); conns.delete(id); },
      close() { peer.destroy(); },
    };
  }
  throw new Error('Could not get a free lobby code, try again.');
}

export async function join(code, name, v) {
  const peer = new window.Peer({ debug: 0 });
  const ev = emitter();
  try {
    const conn = await Promise.race([
      new Promise((res, rej) => {
        peer.on('error', e => rej(new Error(e.type === 'peer-unavailable' ? `No lobby found with code ${code}.` : e.message)));
        peer.on('open', () => {
          const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
          c.on('open', () => res(c));
          c.on('error', e => rej(e));
        });
      }),
      timeout(12000, 'Could not connect to that lobby. The host may be behind a strict firewall.'),
    ]);
    conn.on('data', msg => ev.emit('msg', msg));
    conn.on('close', () => ev.emit('close'));
    conn.send({ t: 'hello', name, v });
    return { mode: 'client', myId: peer.id, on: ev.on, send(msg) { if (conn.open) conn.send(msg); }, close() { peer.destroy(); } };
  } catch (e) {
    peer.destroy();
    throw e;
  }
}
