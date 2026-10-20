import assert from 'node:assert';
import { cumulative, total, frameDone, marks, freshRack } from './scoring.js';

assert.equal(total(Array(9).fill([10]).concat([[10, 10, 10]])), 300);
assert.equal(total(Array(10).fill([9, 0])), 90);
assert.equal(total(Array(9).fill([5, 5]).concat([[5, 5, 5]])), 150);
assert.deepEqual(cumulative([[10], [7, 3], [9, 0]]).slice(0, 3), [20, 39, 48]);
assert.deepEqual(cumulative([[10], [10]]).slice(0, 2), [null, null]);
assert.equal(frameDone(9, [10, 3]), false);
assert.equal(frameDone(9, [3, 4]), true);
assert.equal(freshRack([10, 3]), false);
assert.equal(freshRack([7, 3]), true);
assert.deepEqual(marks([10, 10, 10]), ['X', 'X', 'X']);
assert.deepEqual(marks([10, 7, 3]), ['X', '7', '/']);
assert.deepEqual(marks([0, 10]), ['-', '/']);
console.log('scoring ok');

// physics: a firm centre shot topples pins, a wide shot finds the gutter
import { createLane, rack, launch, step, standingCount } from './sim.js';
const plain = { speed: 1, hook: 0.38, lead: 1, lucky: false, magnet: 0, grease: 0 };
function bowl(params) {
  const L = createLane(); rack(L);
  L.roll = { bumpers: false, wall: 0 };
  launch(L, params, plain);
  for (let t = 0; t < 20 * 120 && !step(L, 1 / 120, () => {}); t++);
  return { knocked: 10 - standingCount(L), gutter: L.ball.gutter };
}
const pocket = bowl({ x: 0, angle: Math.atan2(0.07, 18.7), spin: 0, power: 0.9 });
assert.ok(pocket.knocked >= 6, `pocket shot knocked only ${pocket.knocked}`);
const wide = bowl({ x: 0, angle: 0.08, spin: 0, power: 0.8 });
assert.ok(wide.gutter && wide.knocked === 0, 'wide shot should be a gutter ball');
console.log(`physics ok (pocket shot: ${pocket.knocked} pins)`);

// stress: random throws never leave a pin poking through a wall or under the lane, and always settle
import { KICKBACK_X, GUTTER_X, DECK_Z, PIN_LEN, PIT_Z } from './sim.js';
let worst = 0;
for (let n = 0; n < 300; n++) {
  const L = createLane(); rack(L);
  L.roll = { bumpers: false, wall: 0 };
  const strong = { ...plain, lead: 1 };
  launch(L, { x: (Math.random() - 0.5) * 0.8, angle: (Math.random() - 0.5) * 0.06, spin: Math.random() * 2 - 1, power: Math.random() }, strong);
  let t = 0;
  while (!step(L, 1 / 120, () => {})) {
    t++;
    assert.ok(t < 11 * 120, 'lane never settled');
    for (const p of L.pins) {
      if (p.gone) continue;
      const side = p.z < DECK_Z ? KICKBACK_X : GUTTER_X + 0.1;
      const tip = p.standing ? 0 : Math.sin(p.tilt * Math.PI / 2) * PIN_LEN;
      const reach = Math.max(Math.abs(p.x) + 0.06, Math.abs(p.x + p.dx * tip));
      worst = Math.max(worst, reach - side);
      assert.ok(p.y >= (p.z < PIT_Z ? -0.351 : -1e-9), `pin under the floor: y=${p.y}`);
    }
  }
}
assert.ok(worst < 0.02, `pin clipped ${worst.toFixed(3)} m into a wall`);
console.log(`stress ok (deepest wall contact ${(Math.max(0, worst) * 1000).toFixed(1)} mm)`);

// live cards and the new wild cards: each one does what its card says
import { freshLive, liveInput, liveTick } from './live.js';
import { HEAD_Z } from './sim.js';
function setup(id) {
  const L = createLane(); rack(L);
  L.phase = 'aim'; L.aim = { thrown: false, x: 0, disp: 0, power: 0 };
  L.roll = { bumpers: false, wall: 0, m: plain };
  L.live = freshLive(id && { id, by: 1 });
  return L;
}
const fxLog = [], fxRec = e => fxLog.push(e.e), fired = e => fxLog.filter(n => n === e).length;
const send = (L, d) => liveInput(L, d, fxRec, '#f00');
// throw, then run the lane to rest; during(L, t) runs every tick (inputs mid-roll)
function run(L, params, m = {}, during) {
  L.phase = 'roll'; L.aim.thrown = true;
  launch(L, params, { ...plain, ...m });
  const evs = [], seen = { maxPinY: 0, xAtDeck: null };
  for (let i = 0; i < 12 * 120; i++) {
    during?.(L, i / 120);
    liveTick(L, 1 / 120);
    const done = step(L, 1 / 120, n => evs.push(n));
    for (const p of L.pins) { seen.maxPinY = Math.max(seen.maxPinY, p.y); assert.ok(Number.isFinite(p.x + p.z + p.y), 'pin went NaN'); }
    if (seen.xAtDeck === null && L.ball.z < -15) seen.xAtDeck = L.ball.x;
    if (done) break;
  }
  return { evs, knocked: 10 - standingCount(L), ...seen };
}
const straight = { x: 0, angle: 0, spin: 0, power: 0.8 };
const aimFor = (L, secs) => { for (let i = 0; i < secs * 120; i++) { liveTick(L, 1 / 120); step(L, 1 / 120, () => {}); } };

{ // Doodle: ink runs out
  const L = setup('doodle');
  send(L, { a: 'ink', s: [0, 0.5, 1, 0.5, 0, 0.5] }); assert.ok(L.live.ammo < 0.4 && fired('ink') === 1);
  send(L, { a: 'ink', s: [0, 0, 1, 1, 0, 0, 1, 1] }); assert.equal(L.live.ammo, 0);
  send(L, { a: 'ink', s: [0, 0, 1, 1] }); assert.equal(fired('ink'), 2, 'drew with no ink left');
}
{ // Tomato Toss: 3 throws; Air Horn: 1 blast
  const L = setup('tomato');
  for (let i = 0; i < 5; i++) send(L, { a: 'tomato', x: 0.5, y: 0.5 });
  assert.equal(fired('tomato'), 3);
  const H = setup('horn');
  send(H, { a: 'horn' }); send(H, { a: 'horn' }); assert.equal(fired('horn'), 1);
}
{ // Pesky Fly: steerable, frozen while stunned, flies off after 12s
  const L = setup('fly');
  send(L, { a: 'fly', x: 0.2, y: 0.8 }); assert.deepEqual([L.live.fly.x, L.live.fly.y], [0.2, 0.8]);
  L.live.fly.stun = 1; send(L, { a: 'fly', x: 0.9, y: 0.9 }); assert.equal(L.live.fly.x, 0.2);
  aimFor(L, 12.1); assert.equal(L.live.fly, null);
}
{ // Fake Aim Line + Camera Hijack: clamped inputs; aim-only cards close once the ball is thrown
  const L = setup('fakeaim'); send(L, { a: 'fake', v: 9 }); assert.equal(L.live.fake, 0.07);
  const C = setup('camjack'); send(C, { a: 'cam', x: -3, y: 0.5 }); assert.deepEqual(C.live.cam, [-1, 0.5]);
  C.aim.thrown = true; send(C, { a: 'cam', x: 0, y: 0 }); assert.deepEqual(C.live.cam, [-1, 0.5]);
}
{ // Pin Shuffle: 2 moves, never onto another pin
  const L = setup('shuffle');
  send(L, { a: 'pin', i: 0, x: 0.3, z: HEAD_Z + 0.3 }); assert.deepEqual([L.pins[0].x, L.pins[0].z], [0.3, HEAD_Z + 0.3]);
  send(L, { a: 'pin', i: 1, x: L.pins[2].x, z: L.pins[2].z }); assert.equal(L.live.ammo, 1, 'stacked a pin on another');
  send(L, { a: 'pin', i: 1, x: -0.4, z: HEAD_Z + 0.3 }); send(L, { a: 'pin', i: 3, x: 0, z: HEAD_Z + 0.3 });
  assert.equal(L.live.ammo, 0); assert.notEqual(L.pins[3].z, HEAD_Z + 0.3);
  aimFor(L, 1); assert.equal(standingCount(L), 10, 'shuffled pins fell over');
}
{ // Earthquake Button: 30 mashes topple pins before the throw, and they don't count
  let toppled = 0;
  for (let k = 0; k < 3 && !toppled; k++) {
    const L = setup('quakebtn');
    for (let i = 0; i < 29; i++) send(L, { a: 'mash' });
    assert.equal(L.live.done, 0);
    send(L, { a: 'mash' }); assert.equal(L.live.done, 1);
    aimFor(L, 1.5);
    toppled = 10 - standingCount(L);
    if (toppled) {
      L.roll.contact = false;
      const before = standingCount(L);
      launch(L, { ...straight, power: 0.1, angle: 0.1 }, plain);
      assert.equal(L.roll.standingBefore, before, 'quaked pins would score');
    }
  }
  assert.ok(toppled > 0, 'quake never toppled a pin');
}
{ // Cheerleader: 25 mashes fill the hype bar (throwBall turns it into +20% speed)
  const L = setup('cheer');
  for (let i = 0; i < 25; i++) send(L, { a: 'mash' });
  assert.ok(L.live.done && fired('hype') === 1);
}
{ // Oil Spill: aim-phase only, and it kicks the ball sideways
  const L = setup('oil');
  send(L, { a: 'lane', x: 0, z: -6 }); send(L, { a: 'lane', x: 0, z: -1 }); // -1 is off the allowed strip
  assert.equal(L.live.oil.length, 1);
  const r = run(L, straight);
  assert.ok(r.evs.includes('oil') && Math.abs(r.xAtDeck) > 0.1, `oil: ${r.xAtDeck}`);
}
{ // Goalie Pin: slides at a capped speed, and a ball through it bowls it over
  const L = setup('goalie');
  send(L, { a: 'goal', v: 0.3 }); aimFor(L, 0.1); assert.ok(L.live.goalie.x > 0.1 && L.live.goalie.x < 0.2);
  aimFor(L, 1); assert.ok(Math.abs(L.live.goalie.x - 0.3) < 1e-6);
  send(L, { a: 'goal', v: 0 }); aimFor(L, 1);
  const r = run(L, straight);
  assert.ok(L.live.goalie.down > 0 && r.evs.includes('bonk'), 'goalie never got hit');
}
{ // Leaf Blower: roll-phase only, 2s of fuel, pushes the ball off line
  const L = setup('blower');
  send(L, { a: 'blow', v: -1 }); assert.equal(L.live.blow, 0, 'blew while aiming');
  const r = run(L, straight, {}, L => send(L, { a: 'blow', v: -1 }));
  assert.ok(L.live.ammo <= 0 && L.live.blow === 0 && (r.xAtDeck ?? -1) < -0.2, `blower: ${r.xAtDeck}`);
}
{ // Whack-a-Mole: a mole in the ball's path bonks it
  const L = setup('mole');
  const r = run(L, straight, {}, (L, t) => { if (t > 0.3 && !L.live.moles.length) send(L, { a: 'lane', x: L.ball.x, z: L.ball.z - 1.2 }); });
  assert.ok(L.live.moles[0].bonk && r.evs.includes('bonk'), 'mole missed');
}
{ // Seagull: lands where the ball will be 0.9s later and knocks it aside
  const L = setup('gull');
  const r = run(L, straight, {}, (L, t) => { if (t > 0.3 && L.live.ammo) send(L, { a: 'lane', x: L.ball.x, z: L.ball.z + L.ball.vz * 0.9 }); });
  assert.ok(r.evs.includes('gullhit'), 'gull missed');
}
{ // Curling Sweep: sweeping cancels hook
  const hooked = run(setup(), { ...straight, spin: 1 }).xAtDeck;
  const L = setup('sweep'), swept = run(L, { ...straight, spin: 1 }, {}, L => send(L, { a: 'mash' })).xAtDeck;
  assert.ok(Math.abs(swept) < Math.abs(hooked) / 3, `sweep: ${swept} vs ${hooked}`);
}
{ // Split Ball, Portals, Moon Gravity, Pin Rebellion, Mega Pin, Bowling Pin Ball
  const S = setup(), split = run(S, straight, { split: true });
  assert.ok(S.extra.length === 2 && split.evs.includes('split'));
  const P = setup(); P.live.portals = [{ x: 0, z: -5 }, { x: 0.25, z: -12.5 }];
  const warp = run(P, straight);
  assert.ok(warp.evs.includes('warp') && Math.abs(warp.xAtDeck - 0.25) < 0.05, 'portal');
  assert.ok(run(setup(), straight, { moon: true }).maxPinY > 0.4, 'moon pins never floated');
  const R = setup(), rebel = run(R, { ...straight, power: 0.3 }, { rebel: true });
  assert.ok(rebel.evs.includes('rebel'));
  const M = setup(); M.pins[0].s = 2.2;
  run(M, straight);
  const B = setup(); B.ball.r = 0.09; B.ball.m = 5;
  run(B, straight, { pinbowl: true, speed: 0.85 });
}
// stress: the wild cards together never NaN, and always settle
for (let n = 0; n < 100; n++) {
  const L = setup(n % 2 ? 'goalie' : 'oil'); L.pins[0].s = 2.2;
  if (n % 2 === 0) L.live.oil.push({ x: 0, z: -7, dir: 1, hit: 0 });
  const r = run(L, { x: (Math.random() - 0.5) * 0.8, angle: (Math.random() - 0.5) * 0.06, spin: Math.random() * 2 - 1, power: Math.random() },
    { split: true, moon: true, rebel: true, pinbowl: n % 3 === 0 });
  assert.ok(r.knocked >= 0 && r.knocked <= 10);
}
console.log(`live cards ok (${fxLog.length} effects)`);
