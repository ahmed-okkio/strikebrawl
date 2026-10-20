// Live cards: during the target's turn, whoever played the card gets mouse controls to mess with them (or help them).
// The host owns the state (L.live, fresh every ball) and clients see it through snapshots; lane hazards in it
// are read by sim.js. Screen-space effects (ink, tomatoes, the fly, the horn flash) are drawn here over the game.
import { LANE_HALF, HEAD_Z, topple } from './sim.js';

// phase: when the controls work. input: how the mouse drives it. ammo: uses (or seconds, or ink) per ball.
// meter: clicks needed to fill a mash bar. hint: shown to the controller.
export const LIVE = {
  doodle:   { phase: 'aim', input: 'drag', ammo: 1, hint: 'Drag the mouse to draw on their screen' },
  tomato:   { phase: 'aim', input: 'click', ammo: 3, hint: 'Click to throw a tomato at their screen' },
  fly:      { phase: 'aim', input: 'move', ammo: 12, hint: 'Move the mouse to steer the fly' },
  horn:     { phase: 'aim', input: 'click', ammo: 1, hint: 'Click to blast the horn. Best while they charge!' },
  fakeaim:  { phase: 'aim', input: 'move', hint: 'Move the mouse left / right to steer the fake line' },
  camjack:  { phase: 'aim', input: 'move', hint: 'Move the mouse to swing their camera around' },
  shuffle:  { phase: 'aim', input: 'pin', ammo: 2, hint: 'Drag a pin to a new spot' },
  oil:      { phase: 'aim', input: 'lane', ammo: 2, hint: 'Click the lane to spill oil' },
  quakebtn: { phase: 'aim', input: 'mash', meter: 30, hint: 'Mash the mouse button before they throw!' },
  cheer:    { phase: 'aim', input: 'mash', meter: 25, hint: 'Mash the mouse button to hype them up!' },
  goalie:   { phase: 'both', input: 'move', hint: 'Move the mouse left / right to slide your goalie' },
  blower:   { phase: 'roll', input: 'hold', ammo: 2, hint: 'Hold the mouse on the left or right half to blow' },
  mole:     { phase: 'roll', input: 'lane', ammo: 2, hint: 'Click the lane just ahead of the ball' },
  gull:     { phase: 'roll', input: 'lane', ammo: 1, hint: 'Click where the ball will be in a second' },
  sweep:    { phase: 'roll', input: 'mash', hint: 'Mash the mouse button to sweep!' },
};
export const MOLE_LIFE = 1.3; // seconds a mole stays up

// per-ball state; liveOf = the live card riding on this bowler ({ id, by }) or undefined
export function freshLive(c) {
  const id = c?.id ?? null;
  return {
    id, by: c?.by ?? -1, t: 0, ammo: LIVE[id]?.ammo ?? 0, meter: 0, done: 0, blow: 0, sweep: 0, cam: [0, 0],
    moles: [], oil: [], portals: [], gull: null,
    fake: id === 'fakeaim' ? 0.04 : null,
    fly: id === 'fly' ? { x: 0.5, y: 0.3, stun: 0 } : null,
    goalie: id === 'goalie' ? { x: 0, z: HEAD_Z + 1, tx: 0, vx: 0, vz: 0, down: 0 } : null,
  };
}

// are the card's controls live right now?
export function liveOpen(L) {
  const c = LIVE[L.live?.id];
  if (!c) return false;
  const aim = L.phase === 'aim' && !L.aim.thrown, roll = L.phase === 'roll';
  return c.phase === 'both' ? aim || roll : c.phase === 'aim' ? aim : roll;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
const side = () => (Math.random() < 0.5 ? -1 : 1);

// Host: apply one input from the card's controller. fx broadcasts an effect; color is the controller's.
export function liveInput(L, d, fx, color) {
  const X = L.live;
  if (!liveOpen(L) || !d) return;
  const lane = () => ({ x: clamp(d.x, -LANE_HALF + 0.08, LANE_HALF - 0.08), z: +d.z || 0 });
  switch (X.id) {
    case 'doodle': {
      if (d.a !== 'ink' || X.ammo <= 0 || !Array.isArray(d.s)) return;
      const s = d.s.slice(0, 120).map(v => clamp(v, 0, 1)); // a polyline: x0, y0, x1, y1, ...
      let len = 0;
      for (let i = 2; i + 1 < s.length; i += 2) len += Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
      X.ammo = Math.max(0, X.ammo - len / 3);
      return fx({ e: 'ink', s, c: color });
    }
    case 'tomato': if (d.a === 'tomato' && X.ammo > 0) { X.ammo--; fx({ e: 'tomato', x: clamp(d.x, 0, 1), y: clamp(d.y, 0, 1) }); } return;
    case 'fly': if (d.a === 'fly' && X.fly && !X.fly.stun) { X.fly.x = clamp(d.x, 0, 1); X.fly.y = clamp(d.y, 0, 1); } return;
    case 'horn': if (d.a === 'horn' && X.ammo > 0) { X.ammo--; fx({ e: 'horn' }); } return;
    case 'fakeaim': if (d.a === 'fake') X.fake = clamp(d.v, -0.07, 0.07); return;
    case 'camjack': if (d.a === 'cam') X.cam = [clamp(d.x, -1, 1), clamp(d.y, -1, 1)]; return;
    case 'goalie': if (d.a === 'goal' && X.goalie) X.goalie.tx = clamp(d.v, -0.45, 0.45); return;
    case 'blower': if (d.a === 'blow') X.blow = X.ammo > 0 ? Math.sign(+d.v || 0) : 0; return;
    case 'shuffle': {
      const p = L.pins[d.i | 0];
      if (d.a !== 'pin' || X.ammo <= 0 || !p?.standing || p.gone) return;
      const x = clamp(d.x, -LANE_HALF + 0.07, LANE_HALF - 0.07), z = clamp(d.z, HEAD_Z - 1, HEAD_Z + 0.4);
      if (L.pins.some(q => q !== p && !q.gone && Math.hypot(q.x - x, q.z - z) < 0.02 + 0.06 * ((q.s || 1) + (p.s || 1)))) return;
      Object.assign(p, { x, z, vx: 0, vz: 0 });
      X.ammo--;
      return fx({ e: 'shuffle', x, z });
    }
    case 'oil': {
      if (d.a !== 'lane' || X.ammo <= 0) return;
      const { x, z } = lane();
      if (z > -3 || z < -14) return;
      X.ammo--; X.oil.push({ x, z, dir: side(), hit: 0 });
      return fx({ e: 'spill', x, z });
    }
    case 'mole': {
      if (d.a !== 'lane' || X.ammo <= 0) return;
      const { x, z } = lane();
      if (z > -1 || z < -16.6) return;
      X.ammo--; X.moles.push({ x, z, vx: 0, vz: 0, t: MOLE_LIFE, bonk: 0 });
      return fx({ e: 'mole', x, z });
    }
    case 'gull': {
      if (d.a !== 'lane' || X.ammo <= 0 || X.gull) return;
      const { x, z } = lane();
      if (z > -1 || z < -17) return;
      X.ammo--; X.gull = { x, z, t: 0.9, side: side() };
      return fx({ e: 'gull', x, z });
    }
    case 'quakebtn': case 'cheer':
      if (d.a !== 'mash' || X.done) return;
      X.meter = Math.min(1, X.meter + 1 / LIVE[X.id].meter);
      if (X.meter < 1 - 1e-9) return; // n steps of 1/n can sum to just under 1
      X.meter = 1;
      X.done = 1;
      if (X.id === 'cheer') return fx({ e: 'hype' }); // throwBall reads X.done
      for (const p of L.pins) if (p.standing && !p.gone && Math.random() < 0.3) topple(p);
      return fx({ e: 'quake' });
    case 'sweep': if (d.a === 'mash') { X.sweep = 0.35; fx({ e: 'sweep' }); } return;
  }
}

// Host: timers that run every frame
export function liveTick(L, dt) {
  const X = L.live;
  if (!X?.id) return;
  X.t += dt;
  if (X.fly && L.phase === 'aim') { X.fly.stun = Math.max(0, X.fly.stun - dt); if ((X.ammo -= dt) <= 0) X.fly = null; }
  if (X.blow && (X.ammo -= dt) <= 0) X.blow = 0;
  X.sweep = Math.max(0, X.sweep - dt);
}

// Host: a bot holding the card. B is scratch state for this ball; input() applies like a human's input.
const rnd = (a, b) => a + Math.random() * (b - a);
export function liveBot(L, dt, B, input) {
  const X = L.live, ball = L.ball, roll = L.phase === 'roll';
  B.acc = (B.acc || 0) + dt;
  const ahead = (t, err) => ({ a: 'lane', x: ball.x + ball.vx * t + rnd(-err, err), z: ball.z + ball.vz * t }); // where the ball will be
  switch (X.id) {
    case 'doodle':
      if (X.t > 0.6 && X.ammo > 0 && B.acc > 0.05) {
        B.acc = 0;
        const p = B.p || [rnd(0.3, 0.7), rnd(0.3, 0.6)];
        B.dir = (B.dir ?? rnd(0, 6)) + rnd(-1.2, 1.2);
        const q = [clamp(p[0] + Math.cos(B.dir) * 0.035, 0.2, 0.8), clamp(p[1] + Math.sin(B.dir) * 0.035, 0.2, 0.8)];
        input({ a: 'ink', s: [...p, ...q] }); B.p = q;
      }
      return;
    case 'tomato': if (X.t > (B.next ??= rnd(0.7, 1.4))) { B.next += rnd(0.5, 1.2); input({ a: 'tomato', x: rnd(0.3, 0.7), y: rnd(0.25, 0.65) }); } return;
    case 'fly': return input({ a: 'fly', x: 0.5 + 0.22 * Math.sin(X.t * 1.3) + 0.08 * Math.sin(X.t * 4.1), y: 0.45 + 0.15 * Math.sin(X.t * 1.7 + 1) });
    case 'horn': if (X.ammo > 0 && (L.aim.power > 0.35 || X.t > (B.at ??= rnd(1.5, 4)))) input({ a: 'horn' }); return;
    case 'fakeaim': return input({ a: 'fake', v: L.aim.disp + (B.off ??= rnd(0.02, 0.045) * side()) });
    case 'camjack': return input({ a: 'cam', x: Math.sin(X.t * 0.9) * 0.9, y: Math.sin(X.t * 0.6) * 0.7 });
    case 'shuffle':
      if (X.ammo > 0 && X.t > 1 + (2 - X.ammo) * 0.7) {
        const live = L.pins.filter(p => p.standing && !p.gone), i = L.pins.indexOf(live[Math.floor(Math.random() * live.length)]);
        for (let k = 0, n = X.ammo; k < 15 && X.ammo === n; k++) input({ a: 'pin', i, x: rnd(-0.45, 0.45), z: rnd(HEAD_Z - 1, HEAD_Z + 0.4) });
      }
      return;
    case 'oil':
      if (X.ammo > 0 && X.t > 1 + (2 - X.ammo) * 0.8) {
        const z = X.ammo === 2 ? -6 : -10.5;
        input({ a: 'lane', x: L.aim.x + Math.sin(L.aim.disp) * (ball.z - z) + rnd(-0.08, 0.08), z });
      }
      return;
    case 'quakebtn': case 'cheer': if (X.t > 0.4) while (B.acc > 0.11) { B.acc -= 0.11; input({ a: 'mash' }); } return;
    case 'sweep': while (B.acc > 0.2) { B.acc -= 0.2; input({ a: 'mash' }); } return;
    case 'goalie': {
      const gz = X.goalie.z;
      const pred = roll && ball.vz < -0.5 ? ball.x + ball.vx * (gz - ball.z) / ball.vz : L.aim.x + Math.sin(L.aim.disp) * (ball.z - gz);
      return input({ a: 'goal', v: pred + (B.err ??= rnd(-0.14, 0.14)) });
    }
    case 'blower': if (ball.z < -2 && X.ammo > 0 && !ball.gutter) input({ a: 'blow', v: B.dir ??= (Math.sign(ball.x) || side()) }); return;
    case 'mole': if (ball.z < -3 && X.ammo > 0 && X.t > (B.next ?? 0)) { B.next = X.t + 0.8; input(ahead(0.45, 0.07)); } return;
    case 'gull': if (ball.z < -3 && X.ammo > 0) input(ahead(0.9, 0.15)); return;
  }
}

// ---------- screen effects (every machine) ----------
let cv, g; // the effects canvas, found on first draw (this module also loads in node tests)
let ink = [], tomatoes = [], flash = 0;
export function screenFx(e) {
  if (e.e === 'ink') ink.push({ s: e.s, c: e.c, age: 0 });
  if (e.e === 'tomato') {
    const blobs = [[0, 0, 1]], drips = [];
    for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, d = rnd(0.7, 1.25); blobs.push([Math.cos(a) * d, Math.sin(a) * d, rnd(0.15, 0.4)]); }
    for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28, d = rnd(1.4, 2.1); blobs.push([Math.cos(a) * d, Math.sin(a) * d, rnd(0.05, 0.12)]); }
    for (let i = 0; i < 3; i++) drips.push([rnd(-0.7, 0.7), rnd(0.1, 0.22), rnd(0.6, 1.4)]);
    tomatoes.push({ x: e.x, y: e.y, age: 0, blobs, drips, seeds: [...Array(6)].map(() => [rnd(-0.6, 0.6), rnd(-0.6, 0.6), rnd(0, 3)]) });
  }
  if (e.e === 'horn') flash = 1;
}
export function clearScreen() { ink = []; tomatoes = []; flash = 0; }
export const screenBusy = () => ink.length + tomatoes.length; // test hook

// fly: { x, y, stun } in screen fractions, or null
export function drawScreen(dt, fly) {
  cv ||= document.getElementById('fxc'); g ||= cv.getContext('2d');
  const W = innerWidth, H = innerHeight, k = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * k) || cv.height !== Math.round(H * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, W, H);
  const u = Math.min(W, H) / 900, now = performance.now();

  // ink: fat marker strokes in the doodler's colour, outlined so they read on any background; fade after ~3s
  ink = ink.filter(s => (s.age += dt) < 4);
  g.lineCap = g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const s of ink) {
    g.globalAlpha = Math.min(1, 4 - s.age);
    g.beginPath();
    for (let i = 0; i + 1 < s.s.length; i += 2) g[i ? 'lineTo' : 'moveTo'](s.s[i] * W, s.s[i + 1] * H);
    g.strokeStyle = pass ? s.c : '#15123a'; g.lineWidth = (pass ? 13 : 21) * u;
    g.stroke();
  }

  // tomatoes: a splat that slowly slides down the screen, then fades
  tomatoes = tomatoes.filter(t => (t.age += dt) < 8);
  for (const t of tomatoes) {
    const x = t.x * W, y = (t.y + t.age * 0.012) * H, r = 70 * u * (1 + Math.min(0.15, t.age * 0.05));
    g.globalAlpha = Math.min(1, (8 - t.age) / 1.5);
    g.fillStyle = '#c81d1d';
    for (const [dx, dy, rr] of t.blobs) { g.beginPath(); g.arc(x + dx * r, y + dy * r, rr * r, 0, 7); g.fill(); }
    for (const [dx, w, len] of t.drips) {
      const l = len * r * (1 + t.age * 0.35);
      g.fillRect(x + dx * r - w * r / 2, y, w * r, l);
      g.beginPath(); g.arc(x + dx * r, y + l, w * r * 0.6, 0, 7); g.fill();
    }
    g.fillStyle = '#e8402f';
    g.beginPath(); g.arc(x - r * 0.15, y - r * 0.15, r * 0.6, 0, 7); g.fill();
    g.fillStyle = '#ffd34d';
    for (const [dx, dy, a] of t.seeds) { g.beginPath(); g.ellipse(x + dx * r, y + dy * r, r * 0.07, r * 0.04, a, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.1, -0.6, 0, 7); g.fill();
  }

  // the fly: jittery body, flapping wings; dazed and upside down after a swat
  if (fly) {
    const x = fly.x * W + (fly.stun ? 0 : Math.sin(now / 37) * 4 * u), y = fly.y * H + (fly.stun ? 0 : Math.cos(now / 29) * 4 * u);
    g.globalAlpha = 1;
    g.save(); g.translate(x, y); g.scale(2.5 * u, 2.5 * u); if (fly.stun) g.rotate(Math.PI);
    const flap = fly.stun ? 0.2 : Math.sin(now / 11) * 0.6;
    g.fillStyle = 'rgba(215,232,255,.7)'; g.strokeStyle = 'rgba(40,50,80,.6)'; g.lineWidth = 1;
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(-2, s * 9, 13, 6, s * (0.5 + flap), 0, 7); g.fill(); g.stroke(); }
    g.strokeStyle = '#1b1b22'; g.lineWidth = 1.6;
    for (const s of [-1, 1]) for (const lx of [-5, 0, 5]) { g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx - 3, s * 10); g.stroke(); }
    g.fillStyle = '#23232c'; g.beginPath(); g.ellipse(-3, 0, 12, 7, 0, 0, 7); g.fill();
    g.fillStyle = '#3a8f4a'; g.beginPath(); g.ellipse(-4, 0, 9, 5, 0, 0, 7); g.fill(); // green-bottle sheen
    g.fillStyle = '#23232c'; g.beginPath(); g.arc(10, 0, 6, 0, 7); g.fill();
    g.fillStyle = '#b3122e';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(12, s * 3.6, 3.2, 0, 7); g.fill(); }
    if (fly.stun) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(10.5, s * 3.6 - 1.5); g.lineTo(13.5, s * 3.6 + 1.5); g.moveTo(13.5, s * 3.6 - 1.5); g.lineTo(10.5, s * 3.6 + 1.5); g.stroke(); } }
    g.restore();
  }

  if (flash > 0) { g.globalAlpha = flash * 0.7; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2.5); }
  g.globalAlpha = 1;
}
