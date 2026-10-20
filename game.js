import * as THREE from 'three';
import { sfx } from './audio.js';
import { cumulative, total, frameDone, freshRack, marks } from './scoring.js';
import { AUGS, ULTS, COLORS, BOT_NAMES, icon } from './data.js';
import { LANE_HALF, HEAD_Z, BALL_R, BALL_M, START_Z, createLane, rack, sweep, standingCount, launch, step } from './sim.js';
import { renderer, camera, render, views, syncLane, syncProps, showAim, emit, updateParticles } from './scene.js';
import { LIVE, MOLE_LIFE, freshLive, liveOpen, liveInput, liveTick, liveBot, screenFx, clearScreen, drawScreen, screenBusy } from './live.js';
import * as P2P from './net.js';

const MAX_PLAYERS = 8;
const AIM_TIME = 20; // seconds a human gets to throw before the game throws for them
const HASH = location.hash.slice(1);
const VERSION = new URLSearchParams(location.search).get('v') || 'dev';
const AUTO = HASH === 'auto';
const TEST = AUTO || /^(playtest|nethost|netjoin|livetest)/.test(HASH); // scripted runs log events to the console
const log = (...a) => TEST && console.log(...a);
const SPEED = AUTO ? 3 : 1; // time scale, sped up for bot-only smoke runs
const $ = id => document.getElementById(id);

// Update in progress (driven by main.cjs): a full-screen bar that swallows all input until the installer takes over.
let updating = false;
addEventListener('keydown', e => { if (updating) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
window.__update = s => {
  updating = !s.done;
  $('update').classList.toggle('hidden', !updating);
  $('update').classList.toggle('checking', !!s.checking);
  if (s.checking) { $('updtitle').textContent = 'Checking for updates…'; $('updtxt').textContent = 'One moment'; return; }
  if (s.v) $('updtitle').textContent = `Updating to v${s.v}`;
  $('updfill').style.width = `${s.p ?? 0}%`;
  const mb = n => (n / 1048576).toFixed(1);
  $('updtxt').textContent = s.installing ? 'Installing… the game will restart by itself'
    : s.total ? `${mb(s.got)} / ${mb(s.total)} MB · ${Math.floor(s.p)}%` : 'Starting download…';
};
if (new URLSearchParams(location.search).get('u') === '1') window.__update({ checking: true });
const clamp = THREE.MathUtils.clamp;
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------- state ----------
// net.mode: 'local' (hotseat), 'host' (authoritative, runs the sim) or 'client' (renders what the host sends)
let net = { mode: 'local', myId: 'local' };
let players = [], cur = 0, frame = 0, phase = 'menu', turn = 0;
let paused = false, gameId = 0, shake = 0, slowmo = 0, timeScale = 1;
const SLOWMO = 0.8; // seconds of eased slow-motion when a fast first ball meets the pins
const L = createLane();
L.aim = freshAim();
const pending = new Set(); // player indices still drafting (shown on the waiting screen)
const auth = () => net.mode !== 'client';
const isMine = p => !!p && !p.bot && (net.mode === 'local' || p.owner === net.myId);
const myTurn = () => phase === 'aim' && isMine(players[cur]) && !L.aim.thrown;
function freshAim() { return { x: 0, angle: 0, spin: 0, power: 0, charging: false, thrown: false, t: Math.random() * 10, t0: 0, disp: 0 }; }

const count = (list, id) => list.filter(a => a.id === id).length;
function mods(p) {
  const b = id => count(p.buffs, id), n = id => count(p.nerfs, id);
  return {
    radius: n('pinbowl') ? 0.09 : BALL_R * (1.3 ** b('boulder')) * (0.65 ** n('pebble')),
    mass: n('pinbowl') ? 5 : BALL_M * 2 ** b('heavy'),
    sway: 0.009 * (b('steady') ? 0.15 : 1) * 3 ** n('shaky'),
    hook: 0.38 * 2 ** b('hook'),
    lucky: b('lucky') > 0,
    magnet: b('magnet'),
    bumpers: b('bumpers') > 0,
    speed: (1 + 0.3 * b('power')) * (n('pinbowl') ? 0.85 : 1),
    meter: 2 ** n('butter'),
    grease: n('grease'),
    fog: n('fog') > 0,
    lead: 1.8 ** n('lead'),
    reverse: n('reverse') % 2 === 1,
    boom: b('boom') > 0,
    rocket: b('rocket') > 0,
    domino: b('domino') > 0,
    pinball: b('pinball') > 0,
    wind: p.nerfs.filter(a => a.id === 'wind').reduce((s, a) => s + (a.dir || 1), 0),
    banana: n('banana') > 0,
    wide: n('wide') > 0,
    fuse: n('fuse') > 0,
    split: b('split') > 0,
    portal: b('portal') > 0,
    moon: n('moon') > 0,
    rebel: n('rebel') > 0,
    pinbowl: n('pinbowl') > 0,
    mega: n('mega') > 0,
  };
}
const swayNow = (aim, m) => m.sway * (Math.sin(aim.t * 2.1) + 0.5 * Math.sin(aim.t * 5.3));
// the live card riding on this bowler this frame (at most one): { id, from, by }
const liveOf = p => [...p.nerfs, ...p.buffs].find(a => LIVE[a.id]);
const leader = (exclude) => players.filter(o => o !== exclude).sort((a, b) => total(b.frames) - total(a.frames) || Math.random() - 0.5)[0];

// game-time delay: freezes while paused, never resolves once the game it belongs to is quit
const wait = ms => {
  const id = gameId;
  return new Promise(r => {
    let left = ms / SPEED;
    const tick = () => { if (id !== gameId) return; if (!paused) left -= 50; if (left <= 0) r(); else setTimeout(tick, 50); };
    setTimeout(tick, 50);
  });
};

// ---------- effects: run locally and, on the host, mirrored to every client ----------
let outbox = [];
function fx(e) {
  runFx(e);
  if (net.mode === 'host') outbox.push(e);
}
function runFx(e) {
  const p = players[e.who];
  switch (e.e) {
    case 'knock': emit(e.x, 0.25, e.z, 6, ['#ffffff', '#ffe9a8'], 1.5, 0.02, 6); break;
    case 'pin': sfx.pin(e.s, e.x / 0.7); break;
    case 'bumper': sfx.bumper(e.x); break;
    case 'gutter': sfx.gutterDrop(e.x); break;
    case 'wall': shake = 0.3; sfx.wall(); emit(e.x, 0.2, -12.9, 30, ['#c0462e', '#8a3a28', '#ffffff'], 2.5, 0.03); break;
    case 'pit': sfx.pit(); break;
    case 'contact': if (e.fast) { slowmo = SLOWMO; shake = 0.25; } break;
    case 'quake': shake = 1; sfx.quake(); banner('EARTHQUAKE!'); emit(0, 0.05, HEAD_Z - 0.4, 80, ['#8a6a4a', '#c9a27a', '#ffffff'], 3, 0.03); break;
    case 'release': sfx.release(); break;
    case 'boom': shake = 0.8; slowmo = SLOWMO; sfx.boom(); banner('KABOOM!'); emit(e.x, 0.2, e.z, 90, ['#ff8a00', '#ffc93c', '#ff4560', '#ffffff'], 4, 0.035); break;
    case 'rocket': sfx.rocket(); emit(e.x, 0.15, e.z + 0.2, 50, ['#ff8a00', '#ffc93c', '#ffffff'], 2.5, 0.03, 2); break;
    case 'banana': sfx.slip(); toast(`${pname(p)} slipped on a <b>Banana Peel</b>!`, 'banana', kindColor('nerf')); emit(e.x, 0.1, e.z, 25, ['#ffe135', '#fff6a8'], 2, 0.03); break;
    case 'mulligan': banner('MULLIGAN!', `${p.name} gets a do-over`); sfx.spare(); break;
    case 'toast': toast(e.html, e.ic, e.color); if (isMine(players[e.hurt])) sfx.sabotage(); break;
    case 'ult':
      banner(ULTS[p.ult].name.toUpperCase(), `${p.name} used their Ultimate`);
      toast(`${pname(p)} unleashed <b>${ULTS[p.ult].name}</b>`, p.ult, '#8b5cff');
      emit(L.ball.x, 0.3, L.ball.z, 40, ['#8b5cff', '#ffc93c', '#fff'], 2.5, 0.03, 3);
      sfx.ult();
      break;
    case 'result':
      sfx.rollStop();
      if (e.mk === 'X') { banner('STRIKE!', p.name); confetti(); sfx.strike(); shake = 0.5; }
      else if (e.mk === '/') { banner('SPARE!', p.name); confetti(); sfx.spare(); }
      else if (e.n === 0) { banner(e.g ? 'GUTTER BALL' : 'WHIFF!'); sfx.gutter(); }
      else banner(String(e.n), e.n === 1 ? 'pin' : 'pins');
      break;
    case 'end': showEnd(); break;
    // live cards
    case 'ink': screenFx(e); sfx.scribble(); break;
    case 'tomato': screenFx(e); sfx.splat(); break;
    case 'horn': screenFx(e); sfx.horn(); shake = 0.4; banner('HONK!'); startle(); break;
    case 'swat': sfx.swat(); break;
    case 'mole': sfx.squeak(); emit(e.x, 0.05, e.z, 12, ['#5a3a1a', '#8a6a4a'], 1, 0.03); break;
    case 'bonk': sfx.bonk(); shake = 0.25; banner('BONK!'); emit(e.x, 0.15, e.z, 20, ['#ffffff', '#ffe35a'], 2, 0.03); break;
    case 'spill': sfx.splat(); break;
    case 'oil': sfx.slip(); emit(e.x, 0.05, e.z, 14, ['#3a2a10', '#6b4a1a'], 1.2, 0.03); break;
    case 'gull': sfx.squawk(); break;
    case 'gullhit': sfx.squawk(); sfx.bonk(); shake = 0.3; banner('SQUAWK!'); emit(e.x, 0.2, e.z, 30, ['#ffffff', '#dddddd'], 2.5, 0.03); break;
    case 'shuffle': sfx.pop(); emit(e.x, 0.2, e.z, 10, ['#ff8a00', '#ffffff'], 1, 0.025); break;
    case 'hype': sfx.hype(); banner('HYPED!', '+20% power'); emit(L.ball.x, 0.3, L.ball.z, 50, COLORS, 3, 0.03, 4); break;
    case 'sweep': sfx.brush(); break;
    case 'warp': sfx.warp(); emit(e.x, 0.15, e.z, 40, ['#3df0ff', '#ff8a00', '#ffffff'], 2, 0.03); break;
    case 'portal': sfx.warp(); break;
    case 'split': sfx.pop(); banner('SPLIT!'); emit(e.x, 0.15, e.z, 30, [p?.color || '#fff', '#ffffff'], 2, 0.03); break;
    case 'rebel': sfx.squeak(); toast(`${pname(p)}'s pins are running away!`, 'rebel', kindColor('nerf')); break;
    case 'vote': showVote(e); break;
    case 'voted':
      $('vote').classList.add('hidden');
      toast(`The crowd chose <b>${AUGS[e.win].name}</b> for ${pname(players[e.target])}'s next turn`, e.win, '#8b5cff');
      sfx.sabotage();
      break;
  }
}
// Air Horn: the bowler's power meter jumps mid-charge, or they flinch their aim
function startle() {
  if (!myTurn()) return;
  const a = L.aim, m = mods(players[cur]);
  if (a.charging) a.t0 -= (0.3 + Math.random() * 0.5) / (1.1 * m.meter);
  else a.angle = clamp(a.angle + pick([-1, 1]) * 0.025, -0.05, 0.05);
}
function confetti() {
  for (const s of [-1, 1]) emit(s * 0.5, 0.2, HEAD_Z + 0.6, 90, COLORS.concat('#ffffff'), 4.5, 0.035, 5);
}

// ---------- host -> client sync ----------
let metaDirty = false, lastSnap = 0, lastPins = '';
const syncMeta = () => { metaDirty = true; renderHUD(); };
const r3 = v => Math.round(v * 1000) / 1000;
function meta() {
  return { t: 'm', gid: gameId, frame, cur, phase, turn, pending: [...pending], players: players.map(({ name, color, bot, owner, frames, buffs, nerfs, ult, ultUsed, ultArmed, wallNext, bet }) => ({ name, color, bot, owner, frames, buffs, nerfs, ult, ultUsed, ultArmed, wallNext, bet })) };
}
function snapshot() {
  const b = L.ball, R = L.roll || {};
  const pins = L.pins.map(p => [r3(p.x), r3(p.z), +p.standing, +p.gone, r3(p.tilt), r3(p.dx), r3(p.dz), r3(p.vx), r3(p.vz), r3(p.y), r3(p.tumble), p.s]);
  const key = JSON.stringify(pins), changed = key !== lastPins; lastPins = key;
  return { t: 's', lp: L.phase, b: [r3(b.x), r3(b.z), r3(b.r), +b.gutter, +b.visible, +b.active, r3(b.vx), r3(b.vz), r3(b.y)], a: [r3(L.aim.x), r3(L.aim.disp), r3(L.aim.spin), r3(L.aim.power)],
    w: R.wall || 0, bu: +!!R.bumpers, tm: Math.ceil(L.timer || 0), ts: r3(timeScale), p: changed ? pins : undefined,
    lv: L.live || undefined, x: L.extra.length ? L.extra.map(q => [r3(q.x), r3(q.z), r3(q.r), +q.gutter, +q.visible, +q.active, r3(q.vx), r3(q.vz), r3(q.y)]) : undefined };
}
function flushMeta() { if (metaDirty) { net.broadcast(meta()); metaDirty = false; } }
function hostTick(now) {
  if (net.mode !== 'host') return;
  flushMeta();
  if (outbox.length) { net.broadcast({ t: 'fx', a: outbox }); outbox = []; }
  if (phase !== 'menu' && now - lastSnap > (L.phase === 'roll' ? 50 : 100)) { lastSnap = now; net.broadcast(snapshot()); }
}

// client side: apply what the host sent
let target = null, pinsAt = 0; // latest lane snapshot (smoothed toward each frame) and when pins last changed
function onHostMessage(msg) {
  switch (msg.t) {
    case 'lobby': renderLobby(msg); break;
    case 'reject': leaveOnline(msg.why); break;
    case 'bye': leaveOnline('The host ended the game.'); break;
    case 'm': {
      if (msg.gid !== gameId) { // new game started
        gameId = msg.gid; enterGame();
      }
      const newTurn = msg.turn !== turn;
      ({ frame, cur, phase, turn } = msg);
      players = msg.players;
      pending.clear(); msg.pending.forEach(i => pending.add(i));
      if (newTurn) { L.aim = freshAim(); ctlLocal = {}; views[0].setOwner(players[cur].name, players[cur].color); }
      renderHUD();
      break;
    }
    case 's': {
      target = msg; msg.at = performance.now();
      // pins are only sent when they change, so apply them now; a later snapshot without pins must not drop them
      if (msg.p) { pinsAt = msg.at; msg.p.forEach((q, i) => Object.assign(L.pins[i], { tx: q[0], tz: q[1], standing: !!q[2], gone: !!q[3], ttilt: q[4], dx: q[5], dz: q[6], tvx: q[7], tvz: q[8], ty: q[9], ttumble: q[10], s: q[11] ?? 1 })); }
      break;
    }
    case 'fx': msg.a.forEach(runFx); break;
    case 'draft': showDraft(players[msg.me], msg.offer, msg.extra).then(r => net.send({ t: 'pick', did: msg.did, ...r })); break;
  }
}
// Dead reckoning: extrapolate the last snapshot along its velocity, then ease the small error away.
// Snapshots arrive at ~20 Hz; easing toward them directly made motion pulse.
function applyTarget(dt) {
  const s = target;
  if (!s) return;
  // velocities are physical; scale by the host's slow-mo so prediction doesn't overshoot
  const age = Math.min(0.15, (performance.now() - s.at) / 1000) * (s.ts ?? 1);
  const k = Math.min(1, dt * 30), lerp = (a, b) => a + (b - a) * k;
  const mine = myTurn();
  L.phase = s.lp;
  const [sx, sz, br, bg, bv, ba, bvx, bvz, by] = s.b;
  const bx = sx + (ba ? bvx * age : 0), bz = sz + (ba ? bvz * age : 0);
  const jump = Math.abs(bz - L.ball.z) > 3; // a new throw or reset: snap instead of sliding
  // on my turn my own aim rules: a snapshot sent before the turn changed would drag in the previous bowler's position
  if (!mine) {
    L.ball.x = jump ? bx : lerp(L.ball.x, bx);
    [L.aim.x, L.aim.disp, L.aim.spin, L.aim.power] = s.a;
  }
  L.ball.z = jump ? bz : lerp(L.ball.z, bz);
  Object.assign(L.ball, { r: br, gutter: !!bg, visible: !!bv, active: !!ba, vx: bvx, vz: bvz, y: by });
  L.roll = { ...(L.roll || {}), wall: s.w, bumpers: !!s.bu };
  L.timer = s.tm;
  L.extra = (s.x || []).map(([x, z, r, g, v, a, vx, vz, y]) => ({ x: x + (a ? vx * age : 0), z: z + (a ? vz * age : 0), r, gutter: !!g, visible: !!v, y }));
  L.live = s.lv || null;
  // the card I'm controlling shows my own mouse straight away, not the host's echo
  const X = controlling();
  if (X && ctlLocal.fly && X.fly && !X.fly.stun) Object.assign(X.fly, ctlLocal.fly);
  if (X && ctlLocal.fake != null && X.fake != null) X.fake = ctlLocal.fake;
  if (X && ctlLocal.cam) X.cam = ctlLocal.cam;
  const pinAge = Math.min(0.15, (performance.now() - pinsAt) / 1000) * (s.ts ?? 1);
  for (const p of L.pins) if (p.tx !== undefined) {
    const px = p.tx + p.tvx * pinAge, pz = p.tz + p.tvz * pinAge, snap = Math.abs(pz - p.z) > 1;
    p.x = snap ? px : lerp(p.x, px); p.z = snap ? pz : lerp(p.z, pz);
    p.y = snap ? p.ty : lerp(p.y, p.ty); p.tumble = snap ? p.ttumble : lerp(p.tumble, p.ttumble);
    p.tilt = snap ? p.ttilt : Math.min(1, p.tilt + (p.ttilt > p.tilt ? dt * 5 : (p.ttilt - p.tilt)));
  }
}

// host side: what clients may ask for
const netLive = {}; // test runs: live-card inputs received from guests
function onClientMessage(id, msg) {
  if (msg.t === 'pick') return draftWaiters.get(msg.did)?.(id, msg);
  if (phase === 'menu') return;
  const owns = q => q?.owner === id;
  if (msg.t === 'live') {
    if (TEST) netLive[`${L.live?.id}:${msg.a}`] = (netLive[`${L.live?.id}:${msg.a}`] || 0) + 1;
    return L.live && owns(players[L.live.by]) && liveInput(L, msg, fx, players[L.live.by].color);
  }
  if (msg.t === 'vote') return castVote(owns, msg.id, msg.c);
  if (msg.t === 'bet') return owns(players[msg.by]) && placeBet(msg.by, msg.c);
  const p = players[cur];
  if (!owns(p)) return;
  if (msg.t === 'swat') swat();
  if (msg.t === 'portal') placePortal(+msg.x, +msg.z);
  if (msg.t === 'aim' && L.phase === 'aim') { L.aim.x = clamp(+msg.x || 0, -LANE_HALF, LANE_HALF); L.aim.disp = +msg.d || 0; L.aim.spin = clamp(+msg.s || 0, -1, 1); L.aim.power = clamp(+msg.p || 0, 0, 1); }
  if (msg.t === 'throw') throwBall(msg);
  if (msg.t === 'ult') tryUlt();
  if (msg.t === 'steer' && L.roll) L.roll.steer = clamp(+msg.v || 0, -1, 1);
}

// ---------- UI ----------
const pname = p => `<span class="n" style="color:${p.color}">${p.name}</span>`;
const initial = p => (p.bot ? p.name.replace(/^Bot /, '') : p.name).trim()[0]?.toUpperCase() || '?';
function banner(text, sub = '') {
  const b = $('banner'); b.innerHTML = `<span>${text}</span>${sub ? `<small>${sub}</small>` : ''}`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function toast(html, ic, color) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<b class="ic" style="background:${color}">${icon(ic)}</b><span>${html}</span>`;
  $('feed').prepend(t); setTimeout(() => t.remove(), 6500);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  log(t.textContent);
}
const KINDS = { buff: ['#1fbf75', 'BUFF'], nerf: ['#ff4560', 'SABOTAGE'], live: ['#ff8a00', 'LIVE SABOTAGE'], help: ['#3d8bff', 'LIVE ASSIST'], bet: ['#e0a800', 'BET'] };
const kindColor = k => KINDS[k][0];
const BETS = { X: 'STRIKE', '/': 'SPARE', open: 'OPEN FRAME' };

function renderScoreboard() {
  const sb = $('scoreboard');
  sb.classList.toggle('compact', players.length > 4);
  let h = '<table><tr><th></th>' + [...Array(10)].map((_, i) => `<th>${i + 1}</th>`).join('') + '<th>TOTAL</th></tr>';
  players.forEach((p, i) => {
    const cum = cumulative(p.frames);
    const mini = [...p.buffs, ...p.nerfs].map(a => `<b class="${AUGS[a.id].kind}" title="${AUGS[a.id].name}">${icon(a.id)}</b>`).join('')
      + (p.bet ? `<b class="bet" title="Hot Tip on ${players[p.bet.on]?.name}">${icon('bet')}</b>` : '');
    const tag = p.bot ? '<span class="cpu">CPU</span>' : net.mode !== 'local' && isMine(p) ? '<span class="cpu you">YOU</span>' : '';
    h += `<tr class="${i === cur && phase !== 'end' ? 'cur' : ''}" style="--pc:${p.color}"><td class="who"><span class="avatar">${initial(p)}</span><span class="nm">${p.name}</span>${tag}<span class="mini">${mini}</span></td>`;
    for (let f = 0; f < 10; f++) {
      const mk = marks(p.frames[f] || []);
      const boxes = [...Array(f === 9 ? 3 : 2)].map((_, k) => {
        const m = mk[k] ?? '';
        return `<span class="${m === 'X' ? 'x' : m === '/' ? 's' : ''}">${m}</span>`;
      }).join('');
      h += `<td class="${f === 9 ? 'f10 ' : ''}${i === cur && f === frame && phase !== 'end' ? 'now' : ''}"><div class="marks">${boxes}</div><div class="cum">${cum[f] ?? ''}</div></td>`;
    }
    h += `<td class="tot">${total(p.frames)}</td></tr>`;
  });
  sb.innerHTML = h + '</table>';
}
function renderTurn() {
  const p = players[cur];
  if (!p) return;
  const m = mods(p), mine = isMine(p);
  const chip = (cls, id, name, extra = '') => `<span class="chip ${cls}"><b>${icon(id)}</b>${name}${extra}</span>`;
  const who = p.bot ? '<span class="cpu">CPU</span>' : net.mode !== 'local' ? `<span class="cpu ${mine ? 'you' : ''}">${mine ? 'YOUR TURN' : 'ONLINE'}</span>` : '';
  $('turn').style.setProperty('--pc', p.color);
  $('turn').innerHTML = `<div class="top"><span class="avatar">${initial(p)}</span><div><h2>${p.name}${who}</h2>
    <div class="meta">Frame ${frame + 1} · Ball ${(p.frames[frame]?.length ?? 0) + 1}<span id="clock"></span></div></div></div>`
    + `<div class="chips">${p.buffs.map(a => chip(AUGS[a.id].kind, a.id, AUGS[a.id].name, a.from ? ` <small>· ${a.from}</small>` : '')).join('')}`
    + p.nerfs.map(a => chip(AUGS[a.id].kind, a.id, AUGS[a.id].name + (a.id === 'wind' ? (a.dir > 0 ? ' →' : ' ←') : ''), ` <small>· ${a.from}</small>`)).join('')
    + (L.roll?.wall ? chip('nerf', 'wall', 'Brick Wall') : '') + '</div>';
  const u = ULTS[p.ult], btn = $('ultbtn');
  btn.innerHTML = `<span class="orb">${icon(p.ult)}<span class="key">U</span></span><span><div class="lbl">${p.ultArmed ? 'ARMED' : p.ultUsed ? 'ULTIMATE USED' : 'ULTIMATE · READY'}</div><div class="nm">${u.name}</div><div class="ds">${u.desc}</div></span>`;
  btn.disabled = !mine || (p.ultUsed && !p.ultArmed);
  btn.classList.toggle('armed', !!p.ultArmed);
  $('rev').classList.toggle('hidden', !m.reverse);
  for (const id of ['shot', 'keys']) $(id).classList.toggle('hidden', !mine || phase !== 'aim');
  renderBet();
}
// Hot Tip: a local player holding a bet on this bowler calls it before their first ball
function renderBet() {
  const p = players[cur], el = $('bet');
  const q = phase === 'aim' && !p.frames[frame]?.length ? players.find(o => isMine(o) && o.bet?.on === cur && !o.bet.call) : null;
  el.classList.toggle('hidden', !q);
  if (!q) return;
  const by = players.indexOf(q);
  el.innerHTML = `<div class="lbl">HOT TIP · ${pname(q)}</div><h4>Call ${pname(p)}'s frame</h4><div class="opts">${Object.entries(BETS).map(([c, n]) => `<button class="btn" data-c="${c}">${n}</button>`).join('')}</div>`;
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    el.querySelectorAll('button').forEach(x => { x.disabled = true; x.classList.toggle('on', x === b); });
    if (auth()) placeBet(by, b.dataset.c); else net.send({ t: 'bet', by, c: b.dataset.c });
  });
}
// the live-card panel: what's riding on this ball, who holds it, ammo, and (for the holder) how to use it
let liveKey = '';
function renderLive() {
  const X = L.live, c = LIVE[X?.id], el = $('live'), q = c && players[X.by];
  const show = !!q && phase !== 'menu' && (L.phase === 'aim' || L.phase === 'roll');
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('ctl', !!controlling());
  if (!show) { liveKey = ''; return; }
  const mine = isMine(q), open = liveOpen(L), key = `${X.id}|${X.by}|${mine}|${open}`;
  if (key !== liveKey) {
    liveKey = key;
    const a = AUGS[X.id];
    el.style.setProperty('--pc', kindColor(a.kind));
    el.innerHTML = `<b class="ic">${icon(X.id)}</b><div><div class="lbl">${KINDS[a.kind][1]} · ${pname(q)}</div><div class="nm">${a.name}</div>`
      + `<div class="bar"><i id="livefill"></i></div><div class="hint">${mine ? (open ? c.hint : c.phase === 'roll' ? 'Get ready: this works once the ball is rolling' : '') : ''}</div></div>`;
  }
  const f = c.meter ? X.meter : c.ammo ? X.ammo / c.ammo : 1;
  $('livefill').style.width = `${clamp(f, 0, 1) * 100}%`;
}
function renderHUD() {
  if (phase === 'menu' || !players.length) return;
  renderScoreboard(); renderTurn();
  const waiting = phase === 'draft' && pending.size && $('draft').classList.contains('hidden');
  $('wait').classList.toggle('hidden', !waiting);
  if (waiting) $('waitnames').innerHTML = [...pending].map(i => pname(players[i])).join(', ');
}

// ---------- menu / lobby ----------
const cfg = { humans: 1, bots: 3 };
let lobby = null; // host only: { seats: [{ id, name }], bots }
function renderMenu() { $('humans').textContent = cfg.humans; $('bots').textContent = cfg.bots; }
document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
  const k = b.dataset.k, d = Number(b.dataset.d);
  if (k === 'lbots') {
    lobby.bots = clamp(lobby.bots + d, 0, MAX_PLAYERS - lobby.seats.length);
    return broadcastLobby();
  }
  const o = k === 'humans' ? 'bots' : 'humans';
  cfg[k] = clamp(cfg[k] + d, 0, MAX_PLAYERS - cfg[o]);
  renderMenu();
});
renderMenu();
$('ver').textContent = `v${VERSION}`;
$('rules').innerHTML = [
  ['pin', '#3d8bff', 'Up to 8 bowlers, 10 frames, real bowling scoring.'],
  ['cards', '#1fbf75', 'Draft a fresh augment every frame. Buff yourself or sabotage a rival. They expire when the frame ends.'],
  ['star', '#8b5cff', 'One Ultimate per game. Timing is everything.'],
  ['eye', '#ff8a00', 'Live cards: mess with a rival in real time, with your mouse, while they bowl.'],
].map(([ic, c, t]) => `<b style="background:${c}">${icon(ic)}</b><span>${t}</span>`).join('');
try { $('pname').value = localStorage.getItem('sb-name') || ''; } catch {}
const myName = () => {
  const n = $('pname').value.trim().slice(0, 14) || 'Player';
  try { localStorage.setItem('sb-name', n); } catch {}
  return n;
};
$('joincode').oninput = e => { e.target.value = P2P.cleanCode(e.target.value); };
$('start').onclick = () => {
  if (cfg.humans + cfg.bots < 1) return;
  const seats = [...Array(cfg.humans)].map((_, i) => ({ name: `Player ${i + 1}`, bot: false, owner: 'local' }));
  startGame(seats.concat(botSeats(cfg.bots, seats.length)));
};
const botSeats = (n, from) => [...Array(n)].map((_, i) => ({ name: `Bot ${BOT_NAMES[(from + i) % BOT_NAMES.length]}`, bot: true, owner: null }));
const setStatus = (msg, bad) => { $('netstatus').textContent = msg; $('netstatus').classList.toggle('bad', !!bad); };

$('hostbtn').onclick = async () => {
  setStatus('Opening lobby…');
  try { net = await P2P.host(); } catch (e) { return setStatus(e.message, true); }
  setStatus('');
  lobby = { seats: [{ id: 'host', name: myName() }], bots: 0 };
  net.on('join', (id, name, v) => {
    if (v !== VERSION) { net.send(id, { t: 'reject', why: `Version mismatch: the host is on v${VERSION}, you're on v${v}. Restart the game to update.` }); return setTimeout(() => net.kick(id), 300); }
    if (phase !== 'lobby') { net.send(id, { t: 'reject', why: 'That game has already started.' }); return setTimeout(() => net.kick(id), 300); }
    if (lobby.seats.length >= MAX_PLAYERS) { net.send(id, { t: 'reject', why: 'That lobby is full.' }); return setTimeout(() => net.kick(id), 300); }
    const taken = new Set(lobby.seats.map(s => s.name));
    let n = name, k = 2; while (taken.has(n)) n = `${name} ${k++}`;
    lobby.seats.push({ id, name: n });
    lobby.bots = Math.min(lobby.bots, MAX_PLAYERS - lobby.seats.length);
    sfx.click(); broadcastLobby();
  });
  net.on('leave', id => {
    if (phase === 'lobby') { lobby.seats = lobby.seats.filter(s => s.id !== id); return broadcastLobby(); }
    const p = players.find(q => q.owner === id);
    if (!p) return;
    Object.assign(p, { bot: true, owner: null });
    fx({ e: 'toast', html: `${pname(p)} disconnected, a bot takes over`, ic: 'wifi', color: '#ff4560' });
    draftWaiters.forEach(fn => fn(id, null));
    if (players[cur] === p && L.phase === 'aim') botTurn();
    syncMeta();
  });
  net.on('msg', onClientMessage);
  phase = 'lobby';
  showLobby(true);
  broadcastLobby();
};
$('joinbtn').onclick = async () => {
  const code = P2P.cleanCode($('joincode').value);
  if (code.length !== 5) return setStatus('Enter the 5-letter lobby code.', true);
  setStatus('Connecting…');
  try { net = await P2P.join(code, myName(), VERSION); } catch (e) { net = { mode: 'local', myId: 'local' }; return setStatus(e.message, true); }
  setStatus('');
  gameId = -1; // the host numbers its games itself; ours must never match, or its first game is missed and we stay in the lobby
  const conn = net;
  net.on('msg', onHostMessage);
  net.on('close', () => { if (net === conn) leaveOnline('Lost connection to the host.'); });
  phase = 'lobby';
  showLobby(false);
  $('lobbycode').textContent = code;
};
function broadcastLobby() {
  const msg = { t: 'lobby', code: net.code, seats: lobby.seats.map(s => s.name), bots: lobby.bots };
  net.broadcast(msg);
  renderLobby(msg);
}
function showLobby(isHost) {
  $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden');
  $('hostctl').classList.toggle('hidden', !isHost);
  $('lobbystart').classList.toggle('hidden', !isHost);
  $('lobbymsg').textContent = isHost ? 'Share the code. Friends join from the main menu.' : 'Waiting for the host to start…';
}
function renderLobby(msg) {
  $('lobbycode').textContent = msg.code;
  $('lbots').textContent = msg.bots;
  const seats = msg.seats.map((n, i) => ({ n, c: COLORS[i], bot: false })).concat([...Array(msg.bots)].map((_, i) => ({ n: `Bot ${BOT_NAMES[(msg.seats.length + i) % BOT_NAMES.length]}`, c: COLORS[msg.seats.length + i], bot: true })));
  $('seats').innerHTML = seats.map(s => `<div class="seat" style="--pc:${s.c}"><span class="avatar">${initial({ name: s.n, bot: s.bot })}</span>${s.n}${s.bot ? '<span class="cpu">CPU</span>' : ''}</div>`).join('')
    + [...Array(MAX_PLAYERS - seats.length)].map(() => '<div class="seat empty">Open seat</div>').join('');
  if (TEST && HASH.startsWith('nethost') && msg.seats.length >= 2) setTimeout(() => $('lobbystart').click(), 500);
}
$('copycode').onclick = () => navigator.clipboard?.writeText($('lobbycode').textContent).catch(() => {});
$('lobbystart').onclick = () => {
  const seats = lobby.seats.map(s => ({ name: s.name, bot: false, owner: s.id }));
  startGame(seats.concat(botSeats(lobby.bots, seats.length)));
};
$('lobbyleave').onclick = () => leaveOnline();
function leaveOnline(why) {
  if (net.mode === 'host') net.broadcast({ t: 'bye' });
  const n = net;
  net = { mode: 'local', myId: 'local' };
  setTimeout(() => n.close?.(), 200);
  quitToMenu();
  if (why) setStatus(why, true);
}

// ---------- pause ----------
function setPaused(v) {
  // online games keep running for everyone else; the overlay is just a menu
  paused = v && net.mode === 'local';
  $('pause').classList.toggle('hidden', !v);
  $('soundbtn').textContent = `SOUND: ${sfx.muted ? 'OFF' : 'ON'}`;
  $('quit').textContent = net.mode === 'local' ? 'QUIT TO MENU' : 'LEAVE GAME';
  if (v) { sfx.chargeStop(); keys.clear(); L.aim.charging = false; }
}
function quitToMenu() {
  gameId++; setPaused(false); pending.clear(); target = null; vote = null;
  L.live = null; L.extra = []; clearScreen();
  for (const id of ['vote', 'bet', 'live']) $(id).classList.add('hidden');
  sfx.rollStop(); sfx.chargeStop();
  for (const id of ['hud', 'draft', 'end', 'lobby', 'wait']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  phase = 'menu'; players = []; L.phase = 'idle'; L.roll = null;
  rack(L); views[0].setOwner();
}
$('resume').onclick = () => setPaused(false);
$('quit').onclick = () => net.mode === 'local' ? quitToMenu() : leaveOnline();
$('soundbtn').onclick = () => { sfx.toggleMute(); setPaused(true); };
$('again').onclick = () => net.mode === 'local' ? quitToMenu() : leaveOnline();
$('ultbtn').onclick = () => requestUlt();
document.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => sfx.click()));

// ---------- game flow (host / local only) ----------
function enterGame() {
  for (const id of ['menu', 'lobby', 'end']) $(id).classList.add('hidden');
  $('hud').classList.remove('hidden');
  L.phase = 'idle'; rack(L);
  for (const p of L.pins) delete p.tx; // drop smoothing targets left over from a previous game
}
function startGame(seats) {
  const ultIds = Object.keys(ULTS);
  players = seats.slice(0, MAX_PLAYERS).map((s, i) => ({
    ...s, color: COLORS[i], frames: [], buffs: [], nerfs: [],
    ult: pick(ultIds), ultUsed: false, ultArmed: false, wallNext: false, skill: 0.7 + Math.random() * 0.6,
  }));
  cur = 0; frame = TEST && HASH.includes('short') ? 8 : 0; turn = 0; gameId++; lastPins = ''; // short: test hook, last two frames only
  enterGame();
  syncMeta();
  beginFrame();
}

async function beginFrame() {
  const id = gameId;
  // augments last one frame: everyone's are wiped and redrafted every frame
  for (const p of players) { p.buffs = []; p.nerfs = []; p.bet = null; }
  phase = 'draft'; L.phase = 'idle'; syncMeta();
  await runDrafts();
  if (id !== gameId) return;
  cur = 0;
  startTurn();
}

// Everyone drafts at once: bots instantly, remote players in parallel, hotseat players one after another.
const draftWaiters = new Map();
let draftSeq = 0;
// a buff, a sabotage (passive or live), and a wildcard from any kind; live cards only while a rival is free of one
function offerFor(p) {
  const sh = (...kinds) => Object.keys(AUGS).filter(i => kinds.includes(AUGS[i].kind)).sort(() => Math.random() - 0.5);
  const b = sh('buff');
  if (players.length < 2) return b.slice(0, 3);
  const free = players.some(o => o !== p && !liveOf(o)), live = free ? ['live', 'help'] : [];
  if (free && TEST && HASH.startsWith('nethost')) return sh('live', 'help').slice(0, 3); // net test: exercise live cards over the wire
  const offer = [b[0], sh('nerf', ...(free ? ['live'] : []))[0]];
  offer.push(sh('buff', 'nerf', 'bet', ...live).find(i => !offer.includes(i)));
  return offer;
}
function botPick(p, offer) {
  const id = pick(offer), k = AUGS[id].kind, others = players.filter(o => o !== p);
  return { id, target: players.indexOf(k === 'help' || k === 'bet' ? pick(others) : leader(p)) };
}
function applyPick(p, offer, r) {
  if (!r || !offer.includes(r.id)) r = botPick(p, offer);
  const a = AUGS[r.id], by = players.indexOf(p);
  if (a.kind === 'buff') {
    p.buffs.push({ id: r.id });
    fx({ e: 'toast', html: `${pname(p)} drafted <b>${a.name}</b>`, ic: r.id, color: kindColor(a.kind) });
    return syncMeta();
  }
  // a bowler carries at most one live card; drafts run in parallel, so a pick can lose the race for its target
  const ok = o => o && o !== p && !(LIVE[r.id] && liveOf(o));
  const t = [players[r.target], leader(p), ...players].find(ok);
  if (!t) {
    const b = pick(Object.keys(AUGS).filter(i => AUGS[i].kind === 'buff'));
    p.buffs.push({ id: b });
    fx({ e: 'toast', html: `${pname(p)}'s <b>${a.name}</b> fizzled, so they get <b>${AUGS[b].name}</b>`, ic: b, color: kindColor('buff') });
    return syncMeta();
  }
  const ti = players.indexOf(t);
  if (a.kind === 'bet') {
    p.bet = { on: ti, call: null };
    fx({ e: 'toast', html: `${pname(p)} is betting on ${pname(t)}'s frame`, ic: r.id, color: kindColor(a.kind) });
  } else if (a.kind === 'help') {
    t.buffs.push({ id: r.id, from: p.name, by });
    fx({ e: 'toast', html: `${pname(p)} will help ${pname(t)} with <b>${a.name}</b>`, ic: r.id, color: kindColor(a.kind) });
  } else {
    t.nerfs.push({ id: r.id, from: p.name, by, dir: pick([-1, 1]) }); // dir: which way a Crosswind blows
    fx({ e: 'toast', html: `${pname(p)} hit ${pname(t)} with <b>${a.name}</b>`, ic: r.id, color: kindColor(a.kind), hurt: ti });
  }
  syncMeta();
}
async function runDrafts() {
  const order = [...players].sort((a, b) => total(a.frames) - total(b.frames));
  const picks = p => { const n = 1 + (p.bonus || 0); p.bonus = 0; return n; }; // a won Hot Tip = an extra pick
  for (const p of order.filter(q => q.bot)) for (let k = picks(p); k--;) { const o = offerFor(p); applyPick(p, o, botPick(p, o)); await wait(220); }
  const humans = order.filter(q => !q.bot);
  const remote = humans.filter(q => net.mode === 'host' && q.owner !== 'host');
  const local = humans.filter(q => !remote.includes(q));
  const remotePick = (p, extra) => new Promise(done => {
    const idx = players.indexOf(p), offer = offerFor(p), did = ++draftSeq;
    draftWaiters.set(did, (from, msg) => {
      if (from !== p.owner) return;
      draftWaiters.delete(did);
      applyPick(p, offer, msg && { id: msg.id, target: msg.target });
      done();
    });
    flushMeta(); // the client needs the roster before it can show its cards
    net.send(p.owner, { t: 'draft', did, me: idx, offer, extra });
  });
  const remoteDone = Promise.all(remote.map(async p => {
    const idx = players.indexOf(p);
    pending.add(idx);
    for (let k = 0, n = picks(p); k < n; k++) await remotePick(p, k > 0);
    pending.delete(idx); syncMeta();
  }));
  local.forEach(p => pending.add(players.indexOf(p)));
  syncMeta();
  for (const p of local) {
    for (let k = 0, n = picks(p); k < n; k++) {
      const offer = offerFor(p), r = await showDraft(p, offer, k > 0);
      applyPick(p, offer, r);
    }
    pending.delete(players.indexOf(p));
  }
  await remoteDone;
}

function startTurn() {
  const p = players[cur];
  p.frames[frame] = [];
  if (p.chaosNext) { // Crowd Chaos landed on this player
    p.nerfs.push({ id: p.chaosNext, from: 'The Crowd', dir: pick([-1, 1]) });
    fx({ e: 'toast', html: `The crowd's <b>${AUGS[p.chaosNext].name}</b> hits ${pname(p)}`, ic: p.chaosNext, color: '#8b5cff', hurt: cur });
    p.chaosNext = null;
    syncMeta();
  }
  rackFor(p);
  setupAim();
}
// a fresh rack; Wide Rack spreads it out (still inside the lane)
function rackFor(p) {
  rack(L);
  const m = mods(p);
  if (m.wide) for (const q of L.pins) { q.x *= 1.1; q.z = HEAD_Z + (q.z - HEAD_Z) * 1.3; }
  if (m.mega) L.pins[0].s = 2.2; // the head pin
}

function setupAim() {
  const p = players[cur], m = mods(p);
  phase = 'aim'; L.phase = 'aim'; turn++;
  L.aim = freshAim();
  Object.assign(L.ball, { x: 0, z: START_Z, vx: 0, vz: 0, r: m.radius, m: m.mass, active: false, gutter: false, visible: true, y: 0 });
  const rolls = p.frames[frame];
  // m: the sim also runs while aiming, so pins knocked by an Earthquake Button can fall
  L.roll = { bumpers: m.bumpers && rolls.length === 0, wall: p.wallNext ? pick([-1, 1]) : 0, first: rolls.length === 0 || freshRack(rolls), steer: 0, m };
  L.extra = [];
  L.live = freshLive(liveOf(p));
  if (rolls.length === 0) for (const q of players) if (q.bot && q.bet?.on === cur) placeBet(players.indexOf(q), pick(Object.keys(BETS)));
  if (p.wallNext) fx({ e: 'toast', html: `A brick wall blocks ${pname(p)}'s lane!`, ic: 'wall', color: '#8b5cff' });
  p.wallNext = false;
  L.timer = m.fuse ? 6 : AIM_TIME;
  views[0].setOwner(p.name, p.color);
  syncMeta();
  if (p.bot) botTurn();
}

async function botTurn() {
  const p = players[cur], t = turn;
  // a bot being heckled while it aims takes its time, so the heckler gets to play
  const heckled = ['aim', 'both'].includes(LIVE[L.live?.id]?.phase);
  await wait(heckled ? 3500 + Math.random() * 2000 : 600 + Math.random() * 600);
  if (t !== turn || !p.bot) return;
  const m = mods(p), standing = L.pins.filter(q => q.standing);
  if (!p.ultUsed && (Math.random() < 0.12 || frame === 9)) tryUlt();
  let tx = L.roll.first ? pick([0.07, -0.07]) : standing.reduce((s, q) => s + q.x, 0) / standing.length;
  if (L.roll.wall) tx = -L.roll.wall * 0.15;
  const x = (Math.random() - 0.5) * 0.4;
  let angle = Math.atan2(tx - x, -(HEAD_Z - START_Z));
  const err = (0.004 + m.sway * 0.8 + (m.fog ? 0.006 : 0) + (m.reverse ? 0.004 : 0) + 0.004 * m.grease) * p.skill;
  angle += (Math.random() + Math.random() + Math.random() - 1.5) * err * 1.4;
  Object.assign(L.aim, { x, disp: angle });
  await wait(450);
  if (t !== turn) return;
  throwBall({ x, angle, spin: 0, power: Math.min(1, 0.55 + Math.random() * 0.4 + (m.meter > 1 ? (Math.random() - 0.5) * 0.4 : 0)) });
}

function tryUlt() {
  const p = players[cur];
  if (phase !== 'aim' || L.phase !== 'aim' || p.ultUsed || L.aim.charging) return;
  p.ultUsed = true; p.ultArmed = true;
  if (p.ult === 'wall') {
    p.ultArmed = false;
    const t = leader(p);
    if (t) {
      t.wallNext = true;
      fx({ e: 'toast', html: `${pname(p)} dropped a brick wall on ${pname(t)}'s next roll`, ic: 'wall', color: '#8b5cff', hurt: players.indexOf(t) });
    }
  }
  if (p.ult === 'wreck') L.ball.r = 0.32;
  fx({ e: 'ult', who: cur });
  if (p.ult === 'chaos') { p.ultArmed = false; startVote(p); }
  syncMeta();
}

// ---------- Crowd Chaos: everyone but the target votes on a nerf for the leader's next turn ----------
let vote = null, voteSeq = 0;
const CHAOS = ['moon', 'rebel', 'pinbowl', 'mega', 'banana', 'wind', 'pebble', 'butter', 'reverse', 'fog', 'wide', 'grease'];
function startVote(p) {
  const t = leader(p);
  if (!t) return;
  const target = players.indexOf(t), id = ++voteSeq;
  vote = { id, target, choices: [...CHAOS].sort(() => Math.random() - 0.5).slice(0, 3), votes: {} };
  players.forEach((q, i) => { if (q.bot && i !== target) vote.votes[i] = Math.floor(Math.random() * 3); });
  fx({ e: 'vote', id, target, choices: vote.choices, by: players.indexOf(p) });
  wait(8000).then(() => closeVote(id));
}
// own(q): does player q belong to whoever is voting?
function castVote(own, id, c) {
  if (!vote || vote.id !== id || ![0, 1, 2].includes(c)) return;
  players.forEach((q, i) => { if (own(q) && !q.bot && i !== vote.target) vote.votes[i] = c; });
}
function closeVote(id) {
  if (!vote || vote.id !== id) return;
  const n = [0, 0, 0];
  Object.values(vote.votes).forEach(c => n[c]++);
  const win = vote.choices[pick([0, 1, 2].filter(i => n[i] === Math.max(...n)))];
  players[vote.target].chaosNext = win;
  fx({ e: 'voted', id, target: vote.target, win });
  vote = null;
}
function showVote(e) {
  const el = $('vote'), can = players.some((q, i) => isMine(q) && i !== e.target);
  el.innerHTML = `<div class="lbl">CROWD CHAOS · ${pname(players[e.by])}</div><h4>Vote: ${pname(players[e.target])}'s next nightmare</h4>`
    + `<div class="opts">${e.choices.map((id, i) => `<button class="btn" data-c="${i}"${can ? '' : ' disabled'}>${icon(id)} ${AUGS[id].name}</button>`).join('')}</div><div class="timer"><i></i></div>`;
  el.classList.remove('hidden');
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    const c = +b.dataset.c;
    el.querySelectorAll('button').forEach(x => { x.disabled = true; x.classList.toggle('on', x === b); });
    if (auth()) castVote(isMine, e.id, c); else net.send({ t: 'vote', id: e.id, c });
  });
  sfx.vote();
}

// ---------- Hot Tip bets (host) ----------
function placeBet(by, c) {
  const q = players[by], p = players[cur];
  if (!q?.bet || q.bet.on !== cur || q.bet.call || !BETS[c] || L.phase !== 'aim' || p.frames[frame]?.length) return;
  q.bet.call = c;
  fx({ e: 'toast', html: `${pname(q)} bets <b>${BETS[c]}</b> on ${pname(p)}`, ic: 'bet', color: kindColor('bet') });
  syncMeta();
}
function settleBets(p) {
  const r = p.frames[frame], i = players.indexOf(p);
  const res = r[0] === 10 ? 'X' : r[0] + (r[1] ?? 0) === 10 ? '/' : 'open';
  for (const q of players) if (q.bet?.on === i && q.bet.call) {
    const won = q.bet.call === res;
    if (won) q.bonus = (q.bonus || 0) + 1;
    fx({ e: 'toast', html: won ? `${pname(q)} called it! Extra card next frame` : `${pname(q)} lost the bet`, ic: 'bet', color: won ? kindColor('buff') : '#8a84b8' });
    q.bet = null;
  }
}

// ---------- bowler-side live interactions (host) ----------
function swat() {
  const f = L.live?.fly;
  if (!f || f.stun || L.phase !== 'aim') return;
  f.stun = 2.5;
  fx({ e: 'swat' });
}
// Portals: the entry is whichever is nearer the bowler
function placePortal(x, z) {
  const P = L.live?.portals;
  if (!P || !mods(players[cur]).portal || L.phase !== 'aim' || P.length >= 2) return;
  const q = { x: clamp(x, -0.4, 0.4), z: clamp(z, -15, -2) };
  if (P.length && Math.abs(P[0].z - q.z) < 1.5) return;
  P.push(q); P.sort((a, b) => b.z - a.z);
  fx({ e: 'portal', x: q.x, z: q.z });
}

// params.angle is the final launch angle, sway included
function throwBall(params) {
  if (phase !== 'aim' || L.phase !== 'aim') return;
  const p = players[cur], m = mods(p);
  if (p.ultArmed && p.ult === 'wreck') { m.radius = 0.32; m.mass *= 3; }
  L.ball.r = m.radius; L.ball.m = m.mass;
  L.roll.missile = p.ultArmed && p.ult === 'missile';
  L.roll.quake = p.ultArmed && p.ult === 'quake';
  p.ultArmed = false;
  const x = clamp(+params.x || 0, -LANE_HALF + L.ball.r, LANE_HALF - L.ball.r);
  const angle = clamp(+params.angle || 0, -0.12, 0.12), spin = clamp(+params.spin || 0, -1, 1), power = clamp(+params.power || 0, 0, 1);
  if (L.live.id === 'cheer' && L.live.done) m.speed *= 1.2;
  // portals not placed by hand: entry on the ball's line, exit lined up on the pocket
  if (m.portal && L.live.portals.length < 2) L.live.portals = [{ x: clamp(x + Math.sin(angle) * (START_Z + 5), -0.4, 0.4), z: -5 }, { x: pick([-0.07, 0.07]), z: -12.5 }];
  launch(L, { x, angle, spin, power }, m);
  Object.assign(L.aim, { x, disp: angle, spin, power, thrown: true, charging: false });
  phase = 'roll'; L.phase = 'roll';
  log(`${p.name} throws x=${x.toFixed(2)} angle=${angle.toFixed(3)} spin=${spin.toFixed(2)} power=${power.toFixed(2)}`);
  fx({ e: 'release' });
  syncMeta();
}

const simEvent = (name, a, b) => {
  if (name === 'knock') fx({ e: 'knock', x: a, z: b });
  else if (name === 'pin') { if (a > 0.03) fx({ e: 'pin', s: a, x: b }); }
  else if (name === 'contact') fx({ e: 'contact', fast: L.roll.first && a > 5 });
  else if (['boom', 'rocket', 'banana', 'bonk', 'oil', 'gullhit', 'warp', 'split', 'rebel'].includes(name)) fx({ e: name, x: a, z: b, who: cur });
  else fx({ e: name, x: a });
};

async function endRoll() {
  phase = 'result'; L.phase = 'result';
  const p = players[cur], rolls = p.frames[frame];
  const knocked = L.roll.standingBefore - standingCount(L);
  if (rolls.length === 0 && knocked <= 3 && p.buffs.some(a => a.id === 'mulligan')) { // the roll never happened
    p.buffs = p.buffs.filter(a => a.id !== 'mulligan');
    fx({ e: 'mulligan', who: cur });
    syncMeta();
    await wait(1400);
    rackFor(p);
    return setupAim();
  }
  rolls.push(knocked);
  const mk = marks(rolls).at(-1);
  log(`${p.name} frame ${frame + 1}: ${knocked} pins${L.ball.gutter ? ' (gutter)' : ''} -> [${marks(rolls).join(' ')}] total ${total(p.frames)}`);
  fx({ e: 'result', who: cur, mk, n: knocked, g: L.ball.gutter });
  syncMeta();
  await wait(1400);
  if (!frameDone(frame, rolls)) {
    if (freshRack(rolls)) rackFor(p); else sweep(L);
    return setupAim();
  }
  settleBets(p);
  if (++cur < players.length) return startTurn();
  if (++frame < 10) return beginFrame();
  phase = 'end'; L.phase = 'idle';
  syncMeta();
  fx({ e: 'end' });
}

function showEnd() {
  const ranked = [...players].sort((a, b) => total(b.frames) - total(a.frames));
  $('winner').innerHTML = `${ranked[0].name}<em>WINS!</em>`;
  $('standings').innerHTML = ranked.map((p, i) => `<div class="row" style="--pc:${p.color}"><span class="place">#${i + 1}</span><span class="avatar">${initial(p)}</span>${p.name}<span class="sc">${total(p.frames)}</span></div>`).join('');
  $('again').textContent = net.mode === 'local' ? 'PLAY AGAIN' : 'BACK TO MENU';
  $('end').classList.remove('hidden');
  sfx.win(); confetti();
  log('GAME OVER ' + ranked.map(p => `${p.name}=${total(p.frames)}`).join(' '));
  if (net.mode === 'host') log('LIVE INPUTS FROM GUESTS ' + JSON.stringify(netLive));
}

// ---------- draft UI (used for local players and, on clients, for "my" pick) ----------
function showDraft(p, offer, extra) {
  const others = players.filter(o => o !== p);
  return new Promise(done => {
    $('wait').classList.add('hidden');
    $('draft').classList.remove('hidden');
    $('drafttitle').style.setProperty('--pc', p.color);
    $('drafttitle').innerHTML = `<span>${p.name}</span>, pick ${extra ? 'a bonus card' : 'an augment'}`;
    $('targets').classList.add('hidden');
    $('cards').innerHTML = '';
    sfx.deal();
    const game = gameId;
    let targetBtns = [];
    const finish = (id, t) => {
      removeEventListener('keydown', keyPick);
      if (game !== gameId) return;
      sfx.pick();
      $('draft').classList.add('hidden');
      done({ id, target: t === undefined ? -1 : players.indexOf(t) });
      renderHUD();
    };
    const els = offer.map((id, i) => {
      const a = AUGS[id], el = document.createElement('div');
      el.className = `card k-${a.kind}`;
      el.innerHTML = `<div class="art"><span class="kind">${KINDS[a.kind][1]}</span><span class="num"><kbd>${i + 1}</kbd></span><b>${icon(id)}</b></div><h3>${a.name}</h3><p>${a.desc}</p>`;
      el.onmouseenter = () => sfx.hover();
      el.onclick = () => {
        if (a.kind === 'buff') return finish(id);
        sfx.click();
        const t = $('targets'); t.classList.remove('hidden');
        const q = a.kind === 'help' ? `Who do you help with ${a.name}?` : a.kind === 'bet' ? 'Bet on whose frame?' : `Who gets ${a.name}?`;
        t.innerHTML = `<h4>${q} <kbd>1</kbd>–<kbd>${others.length}</kbd></h4>`;
        targetBtns = others.map(o => {
          const bt = document.createElement('button'); bt.className = 'btn';
          bt.disabled = !!LIVE[id] && !!liveOf(o); // one live card per bowler
          bt.innerHTML = `<span class="avatar" style="--pc:${o.color}">${initial(o)}</span>${o.name} · ${total(o.frames)}${bt.disabled ? ' · taken' : ''}`;
          bt.onclick = () => finish(id, o); t.append(bt);
          return bt;
        });
      };
      $('cards').append(el);
      return el;
    });
    const keyPick = e => { const i = Number(e.key) - 1; (targetBtns.length ? targetBtns : els)[i]?.click(); };
    addEventListener('keydown', keyPick);
  });
}

// ---------- input ----------
const keys = new Set();
function requestUlt() {
  if (!myTurn()) return;
  if (auth()) tryUlt(); else net.send({ t: 'ult' });
}
function release() {
  const p = players[cur], m = mods(p), a = L.aim;
  const params = { x: a.x, angle: a.angle + swayNow(a, m), spin: a.spin, power: a.power };
  a.charging = false; sfx.chargeStop();
  if (auth()) throwBall(params);
  else { a.thrown = true; net.send({ t: 'throw', ...params }); }
}
addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape' && !['menu', 'end', 'lobby'].includes(phase)) return setPaused($('pause').classList.contains('hidden'));
  if (!$('pause').classList.contains('hidden')) return;
  keys.add(e.code);
  if (e.code === 'KeyM') toast(sfx.toggleMute() ? 'Sound off <kbd>M</kbd>' : 'Sound on <kbd>M</kbd>', 'star', '#3d8bff');
  if (!myTurn()) return;
  if (e.code === 'Space') { L.aim.charging = true; L.aim.t0 = L.aim.t; }
  if (e.code === 'KeyU') requestUlt();
});
addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'Space' && myTurn() && L.aim.charging) release();
});
addEventListener('blur', () => keys.clear());

// ---------- mouse: live-card controls for whoever holds the card; swatting and portals for the bowler ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitV = new THREE.Vector3(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function laneAt(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(ground, hitV) ? { x: hitV.x, z: hitV.z } : null;
}
// the live card this machine is driving right now, if any
const controlling = () => {
  const X = L.live, q = X && LIVE[X.id] && players[X.by];
  return q && phase !== 'menu' && isMine(q) && liveOpen(L) ? X : null;
};
let ctlLocal = {}, inkPts = null, lastMove = 0, dragPin = -1, blowSide = 0, mouseAt = null;
function liveSend(d) {
  if (auth()) return liveInput(L, d, fx, players[L.live.by].color);
  net.send({ t: 'live', ...d });
  if (d.a === 'fly') ctlLocal.fly = { x: d.x, y: d.y };
  if (d.a === 'fake') ctlLocal.fake = d.v;
  if (d.a === 'cam') ctlLocal.cam = [d.x, d.y];
}
function flushInk(end) {
  if (inkPts?.length >= 4) liveSend({ a: 'ink', s: inkPts });
  inkPts = end ? null : inkPts.slice(-2);
}
const frac = e => [e.clientX / innerWidth, e.clientY / innerHeight];
function nearestPin(h) {
  let best = -1, bd = 0.3;
  L.pins.forEach((p, i) => { const d = Math.hypot(p.x - h.x, p.z - h.z); if (p.standing && !p.gone && d < bd) { bd = d; best = i; } });
  return best;
}
renderer.domElement.addEventListener('pointerdown', e => {
  const X = controlling(), [fx_, fy] = frac(e);
  if (X) {
    const kind = LIVE[X.id].input;
    if (kind === 'drag') inkPts = [fx_, fy];
    if (kind === 'click') liveSend({ a: X.id, x: fx_, y: fy });
    if (kind === 'lane') { const h = laneAt(e); if (h) liveSend({ a: 'lane', ...h }); }
    if (kind === 'pin') { const h = laneAt(e); dragPin = h ? nearestPin(h) : -1; }
    if (kind === 'hold') liveSend({ a: 'blow', v: blowSide = fx_ < 0.5 ? -1 : 1 });
    if (kind === 'mash') { liveSend({ a: 'mash' }); sfx.tick(); }
    return;
  }
  if (!myTurn()) return;
  const fly = L.live?.fly;
  if (fly && !fly.stun && Math.hypot((fx_ - fly.x) * innerWidth, (fy - fly.y) * innerHeight) < 70) return auth() ? swat() : net.send({ t: 'swat' });
  if (mods(players[cur]).portal) { const h = laneAt(e); if (h) auth() ? placePortal(h.x, h.z) : net.send({ t: 'portal', ...h }); }
});
addEventListener('pointermove', e => {
  mouseAt = e;
  const X = controlling();
  if (!X) return;
  const [x, y] = frac(e), kind = LIVE[X.id].input, now = performance.now();
  if (kind === 'drag' && inkPts) { inkPts.push(x, y); if (inkPts.length >= 12) flushInk(); }
  if (kind === 'hold' && e.buttons && (x < 0.5 ? -1 : 1) !== blowSide) liveSend({ a: 'blow', v: blowSide = x < 0.5 ? -1 : 1 });
  if (kind === 'move' && now - lastMove > 50) {
    lastMove = now;
    liveSend(X.id === 'fly' ? { a: 'fly', x, y } : X.id === 'fakeaim' ? { a: 'fake', v: (x - 0.5) * 0.16 }
      : X.id === 'camjack' ? { a: 'cam', x: (x - 0.5) * 2, y: (y - 0.5) * 2 } : { a: 'goal', v: (x - 0.5) * 1.4 });
  }
});
addEventListener('pointerup', e => {
  const X = controlling();
  if (inkPts) flushInk(true);
  if (X?.id === 'shuffle' && dragPin >= 0) { const h = laneAt(e); if (h) liveSend({ a: 'pin', i: dragPin, ...h }); }
  if (X?.id === 'blower' && blowSide) liveSend({ a: 'blow', v: blowSide = 0 });
  dragPin = -1;
});
// where the placement ring goes: lane cards, a pin being dragged, or the bowler's portals
function cursorAt() {
  if (!mouseAt) return null;
  const X = controlling(), kind = X && LIVE[X.id].input;
  const portals = myTurn() && L.live && mods(players[cur]).portal && L.live.portals.length < 2;
  if (!(kind === 'lane' || (kind === 'pin' && dragPin >= 0) || portals)) return null;
  const h = laneAt(mouseAt);
  return h && { ...h, c: portals ? (L.live.portals.length ? '#ff8a00' : '#3df0ff') : '#ffffff' };
}

// ---------- main loop ----------
const camPos = new THREE.Vector3(0, 1.4, 3), camLook = new THREE.Vector3(0, 0, -18), tmpV = new THREE.Vector3();
let last = performance.now(), clock = 0, lastAimSent = 0, lastSteer = 0;
let announced = -1, botLive = {};
function frameLoop(now) {
  const realDt = Math.min(0.05, (now - last) / 1000) * SPEED; last = now; clock += realDt;
  slowmo = Math.max(0, slowmo - realDt);
  // ease down to 0.45x and back up; an abrupt drop reads as a frame hitch
  timeScale = slowmo > 0 ? 1 - 0.55 * Math.sin(Math.PI * (1 - slowmo / SLOWMO)) : 1;
  const dt = paused ? 0 : realDt * timeScale;
  const p = players[cur], m = p && mods(p), mine = myTurn();
  // your-turn callout: once per turn, on whichever machine controls the bowler
  if (mine && turn !== announced) { announced = turn; banner('YOUR TURN', p.name); sfx.yourTurn(); }
  document.body.classList.toggle('myturn', mine);
  if (net.mode === 'client') applyTarget(realDt);

  if (L.phase === 'aim' && p) {
    const a = L.aim;
    a.t += dt;
    if (mine) {
      const dir = m.reverse ? -1 : 1, k = c => keys.has(c) ? 1 : 0;
      a.x = clamp(a.x + (k('KeyD') - k('KeyA')) * dir * 0.6 * dt, -LANE_HALF + L.ball.r, LANE_HALF - L.ball.r);
      a.angle = clamp(a.angle + (k('ArrowRight') - k('ArrowLeft')) * dir * 0.035 * dt, -0.05, 0.05);
      a.spin = clamp(a.spin + (k('KeyE') - k('KeyQ')) * dir * 1.2 * dt, -1, 1);
      if (a.charging) { const c = (a.t - a.t0) * 1.1 * m.meter; a.power = 1 - Math.abs((c % 2) - 1); sfx.charge(a.power); }
      a.disp = a.angle + swayNow(a, m);
      $('spindot').style.left = `${50 + a.spin * 36}%`;
      $('powerfill').style.width = `${a.power * 100}%`;
      if (net.mode === 'client' && now - lastAimSent > 100) { lastAimSent = now; net.send({ t: 'aim', x: a.x, d: a.disp, s: a.spin, p: a.power }); }
    }
    if (auth() || mine) L.ball.x = a.x;
    // shot clock: host-side for remote players, local otherwise (the local player is never auto-thrown on a client)
    if (auth() && !p.bot) {
      L.timer -= dt;
      if (L.timer <= 0) { if (mine) release(); else throwBall({ x: a.x, angle: a.disp, spin: a.spin, power: a.power || 0.5 }); }
    }
  }
  const clockEl = $('clock');
  if (clockEl) {
    const s = Math.max(0, Math.ceil(L.timer || 0)), show = L.phase === 'aim' && p && !p.bot;
    clockEl.textContent = show ? ` · ${s}s` : '';
    clockEl.classList.toggle('low', show && s <= 5);
  }
  // live cards (host): timers, bot controllers, and the sim keeps running while aiming so shoved or quaked pins settle
  if (auth() && phase !== 'menu' && L.live?.id) {
    liveTick(L, dt);
    const q = players[L.live.by];
    if (q?.bot && liveOpen(L)) {
      if (botLive.for !== L.live) botLive = { for: L.live };
      liveBot(L, dt, botLive, d => liveInput(L, d, fx, q.color));
    }
  }
  if (L.phase === 'aim' && auth() && L.roll?.m) for (let s = 0; s < 4; s++) step(L, dt / 4, simEvent);
  // net test: the scripted guest plays its live cards like a bot, but through the network
  if (TEST && net.mode === 'client' && controlling()) {
    if (botLive.turn !== turn) botLive = { turn };
    liveBot(L, realDt, botLive, liveSend);
  }
  if (L.phase === 'roll' && auth()) {
    if (isMine(p)) {
      const v = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      L.roll.steer = v;
    }
    for (let s = 0; s < 8 && L.phase === 'roll'; s++) if (step(L, dt / 8, simEvent)) endRoll();
  } else if (L.phase === 'roll' && isMine(p) && L.roll) {
    const v = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    if (v !== lastSteer) { lastSteer = v; net.send({ t: 'steer', v }); }
  }
  // rolling rumble + trail follow the ball
  const X = L.live, rolling = L.phase === 'roll' && L.ball.active;
  if (rolling && X?.blow) emit(L.ball.x - X.blow * 0.3, 0.12, L.ball.z, 2, ['#cfe9ff', '#8bd346', '#ffb627'], 0.8, 0.03, 0);
  if (rolling && X?.sweep > 0) emit(L.ball.x, 0.03, L.ball.z - L.ball.r - 0.15, 2, ['#ffffff', '#d8ecff'], 0.7, 0.025, 0);
  sfx.blower(!!(L.phase === 'roll' && X?.blow));
  sfx.buzz(L.phase === 'aim' && X?.fly ? X.fly.x * 2 - 1 : null, X?.fly?.stun > 0);
  if (L.phase === 'roll' && L.ball.active) {
    sfx.rollStart(); sfx.rollUpdate(Math.hypot(L.ball.vx, L.ball.vz), L.ball.gutter, L.ball.x);
    if (!L.ball.gutter && Math.random() < 0.6) emit(L.ball.x, 0.03, L.ball.z + L.ball.r, 1, [p?.color || '#fff'], 0.2, 0.025, 0);
  } else sfx.rollStop();

  // camera
  // frame-rate independent easing so the camera glides the same at 30 or 144 fps
  const ease = rate => 1 - Math.exp(-realDt * rate);
  const aiming = L.phase === 'aim' && !!p;
  if (aiming) {
    const cj = X?.cam || [0, 0]; // Camera Hijack
    camPos.lerp(tmpV.set(L.aim.x * 0.5 + cj[0] * 0.7, 0.75 + cj[1] * 0.35, 2.3 + cj[1] * 1.2), ease(5));
    camLook.lerp(tmpV.set(L.aim.x * 0.2 + cj[0] * 1.6, 0.05, -6), ease(5));
  } else if (L.phase === 'roll' || L.phase === 'result') {
    camPos.lerp(tmpV.set(L.ball.x * 0.6, 0.95, Math.max(L.ball.z + 2.4, -13.8)), ease(7));
    camLook.lerp(tmpV.set(L.ball.x * 0.4, 0.15, Math.max(L.ball.z - 5, HEAD_Z)), ease(7));
  } else { // slow attract orbit for menus and drafts
    camPos.lerp(tmpV.set(Math.sin(clock * 0.15) * 3, 1.6 + Math.sin(clock * 0.2) * 0.3, -11 + Math.cos(clock * 0.15) * 4), ease(1.2));
    camLook.lerp(tmpV.set(0, 0.2, -18), ease(1.2));
  }
  showAim(aiming, 0, L.aim.x, L.ball.z, L.aim.disp, clock, aiming && X?.fake != null ? X.fake + swayNow(L.aim, m) : null);
  syncLane(0, L, p?.color, aiming && isMine(p) && m.fog, !!m?.pinbowl);
  syncProps(L, realDt, clock, cursorAt(), MOLE_LIFE);
  drawScreen(realDt, aiming && X?.fly ? X.fly : null);
  renderLive();
  updateParticles(dt);
  shake = Math.max(0, shake - realDt);
  camera.position.copy(camPos).add(tmpV.set((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, 0));
  camera.lookAt(camLook);
  const fov = 50 - 18 * (1 - timeScale);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * ease(8); camera.updateProjectionMatrix(); }
  render();
  hostTick(now);
  requestAnimationFrame(frameLoop);
}
rack(L);
requestAnimationFrame(frameLoop);

// ---------- test hooks ----------
if (TEST) window.__game = { get phase() { return phase; }, get human() { return myTurn(); }, get power() { return L.aim.power; },
  L, get players() { return players; }, get cur() { return cur; }, get vote() { return vote; }, screenBusy, mods, throwBall, tryUlt, swat,
  start: startGame,
  // put a card on the current bowler, held by player `by`, and restart their ball
  give(id, by) {
    const p = players[cur], k = AUGS[id].kind;
    p.buffs = []; p.nerfs = [];
    if (k === 'bet') players[by].bet = { on: cur, call: null };
    else (k === 'buff' || k === 'help' ? p.buffs : p.nerfs).push({ id, from: players[by].name, by });
    p.frames[frame] = []; rackFor(p); setupAim();
  },
  screenOf(x, z) { const v = new THREE.Vector3(x, 0, z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; },
  shot() { // the 3D view plus the effects canvas (DOM HUD not included)
    render();
    const r = renderer.domElement, c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = r.width; c.height = r.height; g.drawImage(r, 0, 0); g.drawImage($('fxc'), 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } };
if (HASH === 'livetest') import('./livetest.js').then(t => t.run(window.__game));
if (AUTO) startGame(botSeats(4, 0));
if (HASH === 'playtest' || HASH === 'draft') startGame([{ name: 'Player 1', bot: false, owner: 'local' }, ...botSeats(3, 1)]);
if (HASH.startsWith('nethost')) { $('pname').value = 'Host'; $('hostbtn').click(); const iv = setInterval(() => { if (net.code) { console.log('LOBBY CODE ' + net.code); lobby.bots = 2; broadcastLobby(); clearInterval(iv); } }, 200); }
if (HASH.startsWith('netjoin:')) { $('pname').value = 'Guest'; $('joincode').value = HASH.slice(8); $('joinbtn').click(); }
