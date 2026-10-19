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
