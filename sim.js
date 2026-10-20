// Per-lane bowling physics. Pure data + functions, no rendering: only the host (or local game) runs this.
// Coordinates are lane-local metres: x across the lane (0 = centre), z down the lane (pins at negative z), y up.
// Motion is mostly planar; pins get a simple vertical hop + tumble so big hits send them flying.

export const LANE_HALF = 0.53, GUTTER_R = 0.12, GUTTER_X = LANE_HALF + GUTTER_R;
export const KICKBACK_X = 0.77; // inner face of the side walls around the pin deck
export const DECK_Z = -16.9;    // kickback walls start here
export const HEAD_Z = -18.3, PIT_Z = -19.6, PIT_BACK = -20.35, ROW_DZ = 0.264, PIN_DX = 0.305;
export const BALL_R = 0.11, PIN_R = 0.06, PIN_LEN = 0.38, BALL_M = 7, PIN_M = 1.5;
export const START_Z = 0.4, WALL_Z = -13;
const G = 9.8;
const KICK_E = 0.75; // kickback walls are lively: pins rebound back into the deck
const PIN_PIN = 0.6; // how hard a pin must be hit by another pin to topple (x ball threshold)

export function rackSpots() {
  const s = [];
  for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) s.push([(k - r / 2) * PIN_DX, HEAD_Z - r * ROW_DZ]);
  return s;
}

const freshPin = () => ({ x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, standing: true, gone: false, tilt: 0, tumble: 0, spin: 0, dx: 0, dz: 1, s: 1 }); // s: size (Mega Pin)
export function createLane() {
  return {
    phase: 'idle', // idle | aim | roll | result
    ball: { x: 0, z: START_Z, y: 0, vx: 0, vz: 0, r: BALL_R, m: BALL_M, spin: 0, active: false, gutter: false, visible: true },
    extra: [], // Split Ball's extra balls
    live: null, // live-card state for the current ball (see live.js); the sim reads its lane hazards
    pins: rackSpots().map(freshPin),
    roll: null,
  };
}

export function rack(L) {
  rackSpots().forEach(([x, z], i) => Object.assign(L.pins[i], freshPin(), { x, z }));
}
export function sweep(L) {
  for (const p of L.pins) { if (!p.standing) p.gone = true; p.vx = p.vz = 0; }
}
export const standingCount = L => L.pins.filter(p => p.standing).length;
// knock a standing pin over outside a roll (Earthquake Button); step() animates the fall
export function topple(p) {
  const a = Math.random() * Math.PI * 2;
  Object.assign(p, { standing: false, dx: Math.cos(a), dz: Math.sin(a), vx: Math.cos(a) * 0.3, vz: Math.sin(a) * 0.3 });
}

// Launch the ball. m = the thrower's modifiers (see mods() in game.js).
export function launch(L, { x, angle, spin, power }, m) {
  const speed = (5.5 + 4 * power) * m.speed;
  Object.assign(L.ball, { x, z: START_Z, y: 0, vx: Math.sin(angle) * speed, vz: -Math.cos(angle) * speed, spin, active: true, gutter: false, visible: true });
  L.roll.m = m;
  L.roll.t = 0; L.roll.settle = 0;
  L.roll.standingBefore = standingCount(L);
  L.roll.slipZ = -5 - Math.random() * 7; // where a Banana Peel lies
  L.roll.curl = Math.random() < 0.5 ? -1 : 1; // which way a Bowling Pin Ball rolls off
  L.extra = [];
}

function collide(a, b, ra, rb, ma, mb, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
  if (d >= ra + rb || d === 0) return 0;
  const nx = dx / d, nz = dz / d;
  const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  const push = (ra + rb - d) / (1 / ma + 1 / mb);
  a.x -= nx * push / ma; a.z -= nz * push / ma; b.x += nx * push / mb; b.z += nz * push / mb;
  if (rel <= 0) return 0;
  const j = 1.7 * rel / (1 / ma + 1 / mb);
  a.vx -= j / ma * nx; a.vz -= j / ma * nz; b.vx += j / mb * nx; b.vz += j / mb * nz;
  return j;
}

// A standing pin is one circle; a lying pin is a chain of circles along its body (belly, neck, head),
// so a ball or pin can't pass through its ends.
const LYING = [[0.1, 0.06], [0.22, 0.045], [0.33, 0.035]];
function circles(p) {
  const k = p.s || 1;
  if (p.standing) return [[p.x, p.z, PIN_R * k]];
  const s = Math.sin(p.tilt * Math.PI / 2) * k;
  return LYING.map(([o, r]) => [p.x + p.dx * o * s, p.z + p.dz * o * s, r * k]);
}
// a Bowling Pin Ball lies across the lane: belly, shoulder and head (matches the pin-ball mesh in scene.js)
const PINBALL = [[-0.13, 0.09], [0.02, 0.065], [0.24, 0.05]];
const airborne = p => p.y > 0.25; // above the ball
// pins are tall: a flying pin still clips a standing pin's body, but sails over pins lying flat
const meets = (a, b) => Math.abs(a.y - b.y) < (a.standing || b.standing ? PIN_LEN * Math.max(a.s || 1, b.s || 1) - 0.05 : 0.15);

// Advance one lane by dt. ev(name, ...args) reports sound/particle events. Returns true once everything has settled.
export function step(L, dt, ev) {
  const R = L.roll, m = R.m, X = L.live, pinM = PIN_M * m.lead;
  const pm = p => pinM * (p.s > 1 ? 5 : 1); // a Mega Pin is much heavier
  R.t += dt;
  const knock = (p, dx, dz, dv = 0) => {
    if (!p.standing) return;
    const d = Math.hypot(dx, dz) || 1;
    p.standing = false; p.dx = dx / d; p.dz = dz / d;
    if (dv > 2.5 && Math.random() < 0.65) { // a hard hit launches the pin
      p.vy = Math.min(3.2, dv * 0.28) * (0.5 + Math.random() * 0.5);
      p.spin = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 14);
    }
    if (m.moon) { p.vy = Math.max(p.vy, 0.7 + Math.random() * 1.1); p.spin = (Math.random() - 0.5) * 12; } // low gravity: every pin floats off
    ev('knock', p.x, p.z);
  };
  // kickback walls around the deck, lane dividers elsewhere: keep the whole pin (base and head) inside
  const wallClamp = p => {
    const side = p.z < DECK_Z ? KICKBACK_X : GUTTER_X + 0.1;
    const k = p.s || 1, s = p.standing ? 0 : Math.sin(p.tilt * Math.PI / 2) * PIN_LEN * k;
    const xs = [p.x - PIN_R * k, p.x + PIN_R * k, p.x + p.dx * s];
    const over = Math.max(...xs) - side, under = -side - Math.min(...xs);
    if (over > 0) { p.x -= over; p.vx = -Math.abs(p.vx) * (m.pinball ? 1.2 : KICK_E); if (p.standing) knock(p, -1, p.vz); }
    if (under > 0) { p.x += under; p.vx = Math.abs(p.vx) * (m.pinball ? 1.2 : KICK_E); if (p.standing) knock(p, 1, p.vz); }
    if (p.y < 0 && p.z > PIT_Z) { p.z = PIT_Z - 0.001; p.vz = Math.min(p.vz, 0); } // a pin down in the pit can't climb back out
  };
  // Kaboom: every pin near the blast is thrown outward and up
  const boom = (x, z) => {
    for (const p of L.pins) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
      if (p.gone || d > 0.55) continue;
      const f = 1 + 4 * (1 - d / 0.55);
      p.vx += dx / d * f; p.vz += dz / d * f - 0.5;
      knock(p, dx, dz);
      p.vy = Math.max(p.vy, 1.2 + Math.random() * 1.6); p.spin = (Math.random() - 0.5) * 30;
    }
    ev('boom', x, z);
  };
  const hit = (p, j, lead) => {
    const dv = j / pm(p);
    if (dv > 0.9 * lead || (m.lucky && dv > 0.15 && Math.random() < 0.6)) knock(p, p.vx, p.vz, dv);
  };

  // live-card hazards (see live.js): blower, portals, oil, moles and the goalie
  const hazards = b => {
    if (X.blow) b.vx += X.blow * 0.32 * dt;
    const [pa, pb] = X.portals;
    if (pb && !R.warped && Math.hypot(b.x - pa.x, b.z - pa.z) < 0.17) { R.warped = true; b.x = pb.x; b.z = pb.z - 0.05; ev('warp', pb.x, pb.z); }
    for (const o of X.oil) if (!o.hit && Math.hypot(b.x - o.x, b.z - o.z) < 0.26) { o.hit = 1; b.vx += o.dir * 0.25; b.spin = 0; ev('oil', b.x, b.z); }
    for (const mo of X.moles) if (mo.t > 0 && !mo.bonk) {
      const { x, z } = mo; // a mole is rooted in its hole: only the ball bounces
      if (collide(b, mo, b.r, 0.07, b.m, 50, b.x, b.z, x, z)) { mo.bonk = 1; mo.t = Math.min(mo.t, 0.4); ev('bonk', x, z); }
      Object.assign(mo, { x, z, vx: 0, vz: 0 });
    }
    const G = X.goalie;
    if (G && !G.down && collide(b, G, b.r, 0.09, b.m, 4, b.x, b.z, G.x, G.z)) { G.down = 0.01; ev('bonk', G.x, G.z); }
  };

  const roll = ball => {
    const main = ball === L.ball;
    if (!(X?.sweep > 0)) {
      if (ball.z < -5 && ball.vz < 0) ball.vx += ball.spin * m.hook * dt;
      if (m.grease) ball.vx += (Math.random() - 0.5) * 9 * m.grease * dt;
      if (m.wind && !ball.gutter && ball.vz < 0) ball.vx += m.wind * 0.07 * dt;
    } else if (ball.vz < 0) ball.vz -= 0.35 * dt; // swept lane: no drift, a little extra pace
    if (m.pinbowl && main && !ball.gutter && ball.vz < 0) ball.vx += (R.curl * 0.3 + (Math.random() - 0.5) * 3) * dt; // a pin rolls in a lopsided arc
    if (m.rocket && !R.rocketed && !ball.gutter && ball.z < -7) { R.rocketed = true; ball.vz *= 1.6; ball.vx *= 0.3; ev('rocket', ball.x, ball.z); }
    if (m.banana && !R.slipped && !ball.gutter && ball.z < R.slipZ) { R.slipped = true; ball.vx += (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.15); ev('banana', ball.x, ball.z); }
    if (R.missile && ball.vz < 0) ball.vx += (R.steer || 0) * 2.2 * dt;
    if (m.magnet && main && ball.z < -8) {
      const live = L.pins.filter(p => p.standing);
      if (live.length) {
        const dist = p => Math.abs(p.x - ball.x) + Math.abs(p.z - ball.z);
        const near = live.reduce((a, b) => dist(b) < dist(a) ? b : a);
        ball.vx += Math.sign(near.x - ball.x) * 0.9 * m.magnet * dt;
      }
    }
    if (X && !ball.gutter) hazards(ball);
    if (m.split && main && !R.split && !ball.gutter && ball.z < -9) {
      R.split = true;
      ball.r *= 0.75; ball.m *= 0.5;
      L.extra = [-1, 1].map(s => ({ ...ball, vx: ball.vx + s * 0.4 }));
      ev('split', ball.x, ball.z);
    }
    ball.x += ball.vx * dt; ball.z += ball.vz * dt;
    // a ball rolling back toward the bowler (off a wall) loses speed fast instead of coasting forever
    const drag = ball.vz > 0 ? 2.5 : 0.05;
    ball.vx *= 1 - drag * dt; ball.vz *= 1 - drag * dt;
    if (!ball.gutter && ball.z > PIT_Z && Math.abs(ball.x) > LANE_HALF - (R.bumpers ? ball.r : 0)) {
      if (R.bumpers) { ball.x = Math.sign(ball.x) * (LANE_HALF - ball.r); ball.vx = -ball.vx * 0.7; ev('bumper', ball.x); }
      else if (Math.abs(ball.x) > LANE_HALF) { ball.gutter = true; ball.vx = 0; ball.x = Math.sign(ball.x) * GUTTER_X; ball.spin = 0; ev('gutter', ball.x); }
    }
    if (R.wall && !ball.gutter && ball.vz < 0 && ball.z - ball.r < WALL_Z + 0.1 && ball.z > WALL_Z) {
      const x0 = R.wall > 0 ? 0.02 : -LANE_HALF, x1 = R.wall > 0 ? LANE_HALF : -0.02;
      if (ball.x + ball.r > x0 && ball.x - ball.r < x1) {
        ball.z = WALL_Z + 0.1 + ball.r; // rest against the bricks, never inside them
        ball.vz = -ball.vz * 0.18; ball.vx = ball.vx * 0.3 + (Math.random() - 0.5) * 0.4;
        ev('wall', ball.x);
      }
    }
    if (!ball.gutter) for (const p of L.pins) {
      if (p.gone || airborne(p)) continue;
      const shape = main && m.pinbowl ? PINBALL.map(([o, r]) => [ball.x + o, ball.z, r]) : [[ball.x, ball.z, ball.r]];
      hitPin: for (const [bx, bz, br] of shape) for (const [cx, cz, r] of circles(p)) {
        const j = collide(ball, p, br, r, ball.m, pm(p), bx, bz, cx, cz);
        if (!j) continue;
        if (j > 0.3) ev('pin', j / 12, p.x); // resting contact is silent
        if (p.standing && !R.contact) {
          R.contact = true; ev('contact', Math.hypot(ball.vx, ball.vz));
          if (m.boom) boom(ball.x, ball.z);
        }
        if (p.standing) hit(p, j, m.lead);
        break hitPin;
      }
    }
    if (ball.z < DECK_Z && Math.abs(ball.x) > KICKBACK_X - ball.r && !ball.gutter) { ball.x = Math.sign(ball.x) * (KICKBACK_X - ball.r); ball.vx = -ball.vx * 0.5; }
    ball.y = ball.z < PIT_Z ? -Math.min(0.35, (PIT_Z - ball.z) * 0.6) : 0; // drop into the pit
    if (ball.z > START_Z) { ball.z = START_Z; ball.vz = 0; }
    if (ball.z < PIT_BACK || Math.hypot(ball.vx, ball.vz) < 0.2) {
      ball.active = false; ball.visible = ball.z > PIT_BACK;
      if (ball.z < PIT_BACK) ev('pit');
    }
  };
  const ball = L.ball;
  if (ball.active) roll(ball);
  for (const b of L.extra) if (b.active) roll(b);

  if (X) {
    for (const mo of X.moles) mo.t -= dt;
    const g = X.gull;
    if (g) {
      const was = g.t; g.t -= dt;
      if (was > 0 && g.t <= 0) { // the seagull lands: a ball nearby gets knocked aside
        const b = [ball, ...L.extra].find(q => q.active && !q.gutter && Math.hypot(q.x - g.x, q.z - g.z) < 0.35);
        if (b) { b.vx += (Math.sign(b.x - g.x) || (Math.random() < 0.5 ? -1 : 1)) * 0.7; b.vz *= 0.75; ev('gullhit', g.x, g.z); }
      }
      if (g.t < -1.2) X.gull = null;
    }
    const G = X.goalie;
    if (G && !G.down) G.x += Math.max(-1.4 * dt, Math.min(1.4 * dt, G.tx - G.x));
    else if (G) { G.down = Math.min(1, G.down + dt * 4); G.x += G.vx * dt; G.z += G.vz * dt; const f = Math.exp(-2 * dt); G.vx *= f; G.vz *= f; }
  }
  // Pin Rebellion: standing pins shuffle away from the incoming ball (but not off the deck)
  if (m.rebel && ball.active && !R.contact) for (const p of L.pins) {
    if (!p.standing || p.gone) continue;
    const dz = ball.z - p.z;
    if (dz > 0 && dz < 2.5 && Math.abs(p.x - ball.x) < 0.45) {
      if (!R.scared) { R.scared = true; ev('rebel', p.x, p.z); }
      p.vx += (Math.sign(p.x - ball.x) || (Math.random() < 0.5 ? -1 : 1)) * 4 * dt;
    }
    const lim = LANE_HALF - 0.08;
    if (Math.abs(p.x) > lim) { p.x = Math.sign(p.x) * lim; p.vx = 0; }
  }


  for (const p of L.pins) {
    if (p.gone) continue;
    p.x += p.vx * dt; p.z += p.vz * dt;
    const grounded = p.y <= 0 && p.vy <= 0;
    const f = Math.exp(-(p.standing ? 4 : grounded ? 1.6 : 0.2) * dt); p.vx *= f; p.vz *= f;
    if (!p.standing) p.tilt = Math.min(1, p.tilt + dt * (2 + p.tilt * 8)); // accelerates like a real topple
    // vertical hop + tumble
    const floor = p.z < PIT_Z ? -0.35 : 0;
    if (!grounded || p.y > floor) {
      p.vy -= (m.moon ? 1.7 : G) * dt; p.y += p.vy * dt; p.tumble += p.spin * dt;
      if (p.y <= floor) { p.y = floor; if (p.vy < -1.2) { p.vy = -p.vy * 0.3; p.spin *= 0.5; ev('pin', 0.15, p.x); } else { p.vy = 0; p.spin = 0; } }
    }
    if (p.vy === 0 && p.spin === 0) p.tumble += (Math.round(p.tumble / Math.PI) * Math.PI - p.tumble) * Math.min(1, dt * 10); // settle lying flat
    wallClamp(p);
    if (p.z < PIT_Z || Math.abs(p.x) > LANE_HALF + 0.02) knock(p, p.vx, p.vz);
    if (p.z < PIT_BACK) { p.z = PIT_BACK; p.vz = 0; p.gone = true; } // behind the curtain
  }
  const P = L.pins;
  for (let i = 0; i < P.length; i++) for (let k = i + 1; k < P.length; k++) {
    const a = P[i], b = P[k];
    if (a.gone || b.gone || !meets(a, b)) continue;
    if (a.standing && b.standing && Math.hypot(a.vx, a.vz) + Math.hypot(b.vx, b.vz) < 0.05) continue;
    if (Math.abs(a.x - b.x) > 0.8 || Math.abs(a.z - b.z) > 0.8) continue;
    let j = 0;
    outer: for (const [ax, az, ar] of circles(a)) for (const [bx, bz, br] of circles(b)) {
      j = collide(a, b, ar, br, pm(a), pm(b), ax, az, bx, bz);
      if (j) break outer;
    }
    if (j && a.standing && b.standing && !R.contact) continue; // pins jostled before the ball arrives just push
    if (j) { if (j > 0.15) ev('pin', j / 4, a.x); if (a.standing) hit(a, j, m.lead * PIN_PIN * (m.domino ? 0.3 : 1)); if (b.standing) hit(b, j, m.lead * PIN_PIN * (m.domino ? 0.3 : 1)); }
  }
  for (const p of P) if (!p.gone) wallClamp(p); // pin-on-pin pushes must not shove a pin back into a wall
  const moving = P.some(p => !p.gone && (Math.hypot(p.vx, p.vz) > 0.05 || p.y > 0.001 || p.vy !== 0 || (!p.standing && p.tilt < 1)));
  if (!ball.active && !L.extra.some(b => b.active) && !moving) R.settle += dt; else R.settle = 0;
  if (R.settle > 0.6 || R.t > 10) {
    if (R.quake && !R.quaked) {
      R.quaked = true; R.settle = 0; ev('quake');
      for (const p of P) if (p.standing && Math.random() < 0.6) { const a = Math.random() * 6.28; p.vx = Math.cos(a) * 0.5; p.vz = Math.sin(a) * 0.5; knock(p, p.vx, p.vz); }
      return false;
    }
    return true;
  }
  return false;
}
