// Dev only: plays every live and wild card through the real game (synthetic mouse events, host logic, rendering)
// and checks each did its job. Run off-screen and muted:
//   PLAYTEST=<out dir> PLAYTEST_HASH=livetest npx electron .     -> <out dir>/results.json + a screenshot per card
import { HEAD_Z } from './sim.js';

export async function run(G) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const cv = document.querySelector('canvas');
  const W = innerWidth, H = innerHeight, L = G.L;
  const ev = (type, x, y, buttons = 0) => (type === 'pointerdown' ? cv : window).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, buttons, bubbles: true }));
  const click = (x, y) => { ev('pointerdown', x, y, 1); ev('pointerup', x, y); };
  const clickLane = (x, z) => click(...G.screenOf(x, z));
  const results = [], shots = {}, errors = [];
  addEventListener('error', e => errors.push(e.message));
  addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info: String(info) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const shot = async name => { await sleep(120); shots[name] = G.shot(); };

  // two local humans: whoever bowls, the other one holds the card
  G.start([{ name: 'Ann', bot: false, owner: 'local' }, { name: 'Bob', bot: false, owner: 'local' }]);
  const other = () => 1 - G.cur;
  async function ready() {
    const t0 = performance.now();
    for (;;) {
      if (!$('draft').classList.contains('hidden')) {
        document.querySelector('#cards .card')?.click(); await sleep(60);
        document.querySelector('#targets:not(.hidden) .btn:not(:disabled)')?.click();
      }
      if (G.phase === 'aim' && G.human && !L.aim.thrown && $('draft').classList.contains('hidden')) return sleep(200);
      if (performance.now() - t0 > 30000) throw new Error('never got an aim phase');
      await sleep(50);
    }
  }
  // throw, then wait out the roll; during() runs every ~16ms while it rolls
  async function rollOut(during, params = { x: 0, angle: 0, spin: 0, power: 0.8 }) {
    G.throwBall(params);
    const t0 = performance.now();
    while (L.phase === 'roll' && performance.now() - t0 < 15000) { await during?.(); await sleep(16); }
  }
  async function card(id, by = other()) { await ready(); G.give(id, by); await sleep(250); }
  const panel = () => !$('live').classList.contains('hidden');

  const cards = {
    async doodle() {
      await card('doodle');
      check('doodle: panel shows for the holder', panel() && $('live').textContent.includes('Drag'));
      ev('pointerdown', W * 0.3, H * 0.4, 1);
      for (let i = 1; i <= 20; i++) { ev('pointermove', W * (0.3 + i * 0.02), H * (0.4 + Math.sin(i / 3) * 0.1), 1); await sleep(16); }
      ev('pointerup', W * 0.7, H * 0.4);
      await sleep(150);
      check('doodle: ink on screen, ink meter drops', G.screenBusy() > 0 && L.live.ammo < 1, L.live.ammo.toFixed(2));
      await shot('doodle');
      await rollOut();
    },
    async tomato() {
      await card('tomato');
      for (const [x, y] of [[0.3, 0.3], [0.6, 0.5], [0.45, 0.65], [0.5, 0.5]]) { click(W * x, H * y); await sleep(80); }
      check('tomato: 3 splats then empty', L.live.ammo === 0 && G.screenBusy() >= 3, G.screenBusy());
      await shot('tomato');
      await rollOut();
    },
    async fly() {
      await card('fly');
      ev('pointermove', W * 0.3, H * 0.35); await sleep(150);
      check('fly: follows the mouse', Math.abs(L.live.fly.x - 0.3) < 0.01 && Math.abs(L.live.fly.y - 0.35) < 0.01);
      await shot('fly');
      G.swat(); await sleep(50);
      check('fly: swat stuns it', L.live.fly.stun > 0);
      ev('pointermove', W * 0.8, H * 0.8); await sleep(150);
      check('fly: stunned fly ignores the mouse', Math.abs(L.live.fly.x - 0.3) < 0.01);
      await rollOut();
    },
    async horn() {
      await card('horn');
      L.aim.charging = true; L.aim.t0 = L.aim.t; await sleep(300);
      const t0 = L.aim.t0;
      click(W / 2, H / 2); await sleep(60);
      check('horn: power jumps mid-charge', L.aim.t0 < t0 && L.live.ammo === 0, (t0 - L.aim.t0).toFixed(2));
      shots.horn = G.shot();
      L.aim.charging = false;
      await rollOut();
    },
    async fakeaim() {
      await card('fakeaim');
      ev('pointermove', W * 0.85, H * 0.5); await sleep(150);
      check('fakeaim: decoy steers right', L.live.fake > 0.04, L.live.fake);
      await shot('fakeaim');
      await rollOut();
    },
    async camjack() {
      await card('camjack');
      ev('pointermove', W * 0.05, H * 0.2); await sleep(900);
      check('camjack: camera dragged', L.live.cam[0] < -0.8);
      await shot('camjack');
      await rollOut();
    },
    async shuffle() {
      await card('shuffle');
      const [px, py] = G.screenOf(L.pins[0].x, L.pins[0].z), [tx, ty] = G.screenOf(0.35, HEAD_Z + 0.25);
      ev('pointerdown', px, py, 1); ev('pointermove', tx, ty, 1); ev('pointerup', tx, ty); await sleep(100);
      check('shuffle: dragged the head pin', Math.abs(L.pins[0].x - 0.35) < 0.05 && L.live.ammo === 1, `${L.pins[0].x.toFixed(3)}, ${L.pins[0].z.toFixed(2)}`);
      await sleep(600);
      check('shuffle: moved pin still standing', L.pins[0].standing);
      await shot('shuffle');
      await rollOut();
    },
    async oil() {
      await card('oil');
      clickLane(0, -6); await sleep(80); clickLane(0.2, -10); await sleep(80); clickLane(-0.2, -8);
      check('oil: two patches, no more', L.live.oil.length === 2, JSON.stringify(L.live.oil.map(o => [o.x.toFixed(2), o.z.toFixed(1)])));
      await shot('oil');
      await rollOut();
      check('oil: ball skidded through it', L.live.oil[0].hit === 1);
    },
    async quakebtn() {
      await card('quakebtn');
      for (let i = 0; i < 30; i++) { click(W / 2, H / 2); await sleep(10); }
      await sleep(1500);
      const down = L.pins.filter(p => !p.standing).length;
      check('quakebtn: meter full, lane shook', L.live.done === 1 && L.live.meter === 1, `${down} pins down`);
      await shot('quakebtn');
      await rollOut(null, { x: 0, angle: 0, spin: 0, power: 0.8 });
    },
    async cheer() {
      await card('cheer');
      for (let i = 0; i < 25; i++) { click(W / 2, H / 2); await sleep(10); }
      check('cheer: hyped', L.live.done === 1);
      G.throwBall({ x: 0, angle: 0, spin: 0, power: 0.8 });
      const v = -L.ball.vz;
      check('cheer: +20% ball speed', v > (5.5 + 4 * 0.8) * 1.19, v.toFixed(2));
      await rollOut(() => {});
    },
    async goalie() {
      await card('goalie');
      ev('pointermove', W * 0.8, H / 2); await sleep(800);
      check('goalie: slides with the mouse', L.live.goalie.x > 0.2, L.live.goalie.x.toFixed(2));
      await shot('goalie');
      ev('pointermove', W * 0.5, H / 2); await sleep(800);
      await rollOut();
      check('goalie: bowled over', L.live.goalie.down > 0);
    },
    async blower() {
      await card('blower');
      check('blower: waits for the roll', !$('live').textContent.includes('Hold'));
      let blew = false;
      await rollOut(async () => {
        if (L.ball.z < -1 && !blew) { ev('pointerdown', W * 0.2, H / 2, 1); blew = true; await sleep(300); check('blower: blowing left', L.live.blow === -1); shots.blower = G.shot(); }
      });
      ev('pointerup', W * 0.2, H / 2);
      check('blower: fuel used, ball pushed left', L.live.ammo <= 0.05 || L.ball.x < -0.1, `${L.live.ammo.toFixed(2)} ${L.ball.x.toFixed(2)}`);
    },
    async mole() {
      await card('mole');
      let placed = false;
      await rollOut(async () => {
        if (L.ball.z < -3 && !placed) { placed = true; clickLane(L.ball.x, L.ball.z + L.ball.vz * 0.3); await sleep(100); shots.mole = G.shot(); }
      });
      check('mole: popped up', L.live.moles.length === 1, `bonked: ${L.live.moles[0]?.bonk}`);
    },
    async gull() {
      await card('gull');
      let placed = false;
      await rollOut(async () => {
        if (L.ball.z < -2 && !placed) { placed = true; clickLane(L.ball.x, L.ball.z + L.ball.vz * 0.9); await sleep(450); shots.gull = G.shot(); }
      });
      check('gull: called in', L.live.ammo === 0);
    },
    async sweep() {
      await card('sweep');
      let swept = 0;
      await rollOut(async () => { click(W / 2, H / 2); if (L.live.sweep > 0) swept++; if (swept === 20) shots.sweep = G.shot(); });
      check('sweep: sweeping while it rolls', swept > 10, swept);
    },
    async bet() {
      await ready();
      const by = other(); G.give('bet', by); await sleep(300);
      const shown = !$('bet').classList.contains('hidden');
      document.querySelector('#bet .btn')?.click(); await sleep(100);
      check('bet: panel shows, call recorded', shown && G.players[by].bet?.call === 'X', G.players[by].bet?.call);
      await rollOut();
    },
    async chaos() {
      await ready();
      const p = G.players[G.cur], t = other();
      Object.assign(p, { ult: 'chaos', ultUsed: false, ultArmed: false });
      G.players[t].frames[0] = [10]; G.players[t].frames[1] ||= []; // make the other player the leader
      G.tryUlt(); await sleep(200);
      const shown = !$('vote').classList.contains('hidden');
      document.querySelectorAll('#vote .btn')[1]?.click();
      const pickd = G.vote?.choices[1];
      for (let i = 0; i < 300 && G.vote; i++) await sleep(50); // the vote runs ~8s of game time
      check('chaos: vote shown, crowd pick lands on the leader', shown && G.players[t].chaosNext === pickd, `${pickd} -> ${G.players[t].chaosNext}`);
      await rollOut();
    },
    async split() {
      await card('split', G.cur);
      let n = 0;
      await rollOut(() => { if (L.extra.length === 2 && !n++) shots.split = G.shot(); });
      check('split: three balls', n > 0);
    },
    async portal() {
      await card('portal', G.cur);
      clickLane(0, -5); await sleep(60); clickLane(0.22, -12); await sleep(150);
      check('portal: bowler placed both', L.live.portals.length === 2, JSON.stringify(L.live.portals));
      await shot('portal');
      await rollOut();
      check('portal: ball warped', L.roll.warped === true);
    },
    async moon() {
      await card('moon');
      let maxY = 0;
      await rollOut(() => { const y = Math.max(...L.pins.map(p => p.y)); if (y > 0.5 && y > maxY + 0.2) shots.moon = G.shot(); maxY = Math.max(maxY, y); });
      check('moon: pins floated', maxY > 0.4, maxY.toFixed(2));
    },
    async rebel() {
      await card('rebel');
      await rollOut(null, { x: 0, angle: 0, spin: 0, power: 0.4 });
      check('rebel: pins ran', L.roll.scared === true);
    },
    async pinbowl() {
      await card('pinbowl');
      check('pinbowl: pin-sized ball', L.ball.r === 0.09);
      let s = 0;
      await rollOut(() => { if (L.ball.z < -6 && !s++) shots.pinbowl = G.shot(); });
    },
    async mega() {
      await card('mega');
      check('mega: giant head pin', L.pins[0].s === 2.2);
      await shot('mega');
      await rollOut();
    },
  };
  for (const [id, fn] of Object.entries(cards)) {
    try { await fn(); } catch (e) { check(`${id}: crashed`, false, e.stack || e); }
  }
  check('no page errors', !errors.length, errors.join(' | '));
  window.__liveDone = { results, shots };
}
