// Procedural sound: everything is synthesised at runtime, no audio assets.
let ctx, master, wet, noiseBuf;
let muted = false;

function init() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = 0.8;
  master.connect(comp).connect(ctx.destination);
  // small-hall reverb from a generated impulse response
  const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  wet = ctx.createGain(); wet.gain.value = 0.3;
  wet.connect(conv).connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// route a node to the mix with optional pan and reverb send
function out(node, pan = 0, verb = 0.3) {
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(p).connect(master);
  if (verb) { const s = ctx.createGain(); s.gain.value = verb; p.connect(s).connect(wet); }
  return p;
}
function envGain(t, attack, decay, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}
function tone(freq, { type = 'sine', t = 0, attack = 0.005, decay = 0.2, vol = 0.3, to, pan = 0, verb = 0.3, lp } = {}) {
  const at = ctx.currentTime + t, o = ctx.createOscillator(), g = envGain(at, attack, decay, vol);
  o.type = type; o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
  let n = o.connect(g);
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n = n.connect(f); }
  out(n, pan, verb);
  o.start(at); o.stop(at + attack + decay + 0.05);
  return o;
}
function noise({ t = 0, attack = 0.002, decay = 0.1, vol = 0.3, type = 'bandpass', freq = 1000, Q = 1, to, pan = 0, verb = 0.3 } = {}) {
  const at = ctx.currentTime + t, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = envGain(at, attack, decay, vol);
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.frequency.setValueAtTime(freq, at); f.Q.value = Q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
  out(s.connect(f).connect(g), pan, verb);
  s.start(at, Math.random()); s.stop(at + attack + decay + 0.05);
}

// one wooden pin clack: noise transient + a few inharmonic partials
function clack(strength, pan, t = 0) {
  const v = 0.08 + 0.32 * strength;
  noise({ t, decay: 0.04, vol: v * 1.4, freq: 2600 + Math.random() * 1200, Q: 2, pan });
  for (const base of [640, 1700]) tone(base * (0.92 + Math.random() * 0.16), { t, decay: 0.07 + Math.random() * 0.1, vol: v * 0.5, pan, verb: 0 });
}
function applause(dur, vol) {
  for (let i = 0; i < dur * 70; i++) {
    const t = Math.random() ** 1.6 * dur;
    noise({ t, decay: 0.02 + Math.random() * 0.03, vol: vol * (1 - t / dur * 0.7), freq: 1200 + Math.random() * 2400, Q: 1.2, pan: Math.random() * 1.6 - 0.8, verb: 0.5 });
  }
}

let rollNodes = null, chargeOsc = null, lastClack = 0;
const ok = () => !muted && init().state !== 'closed';

export const sfx = {
  get muted() { return muted; },
  toggleMute() { init(); muted = !muted; master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05); return muted; },
  resume() { init(); if (ctx.state === 'suspended') ctx.resume(); },

  click() { if (ok()) tone(880, { type: 'triangle', decay: 0.05, vol: 0.12, to: 1200, verb: 0.1 }); },
  hover() { if (ok()) tone(1500, { type: 'sine', decay: 0.03, vol: 0.05, verb: 0.05 }); },
  deal() { if (!ok()) return; for (let i = 0; i < 3; i++) noise({ t: i * 0.07, decay: 0.12, vol: 0.12, freq: 900, to: 3000, Q: 0.8 }); },
  pick() {
    if (!ok()) return;
    noise({ decay: 0.3, vol: 0.18, freq: 500, to: 4000, Q: 0.7 });
    [784, 1175].forEach((f, i) => tone(f, { type: 'triangle', t: 0.05 + i * 0.07, decay: 0.25, vol: 0.12 }));
  },
  sabotage() {
    if (!ok()) return;
    tone(220, { type: 'sawtooth', decay: 0.4, vol: 0.12, to: 110, lp: 900 });
    tone(233, { type: 'sawtooth', decay: 0.4, vol: 0.1, to: 116, lp: 900 });
  },

  charge(p) {
    if (!ok()) return;
    if (!chargeOsc) {
      chargeOsc = ctx.createOscillator(); chargeOsc.type = 'triangle';
      chargeOsc.gain = ctx.createGain(); chargeOsc.gain.gain.value = 0.035;
      out(chargeOsc.connect(chargeOsc.gain), 0, 0.1); chargeOsc.start();
    }
    chargeOsc.frequency.setTargetAtTime(220 + p * 500, ctx.currentTime, 0.02);
  },
  chargeStop() { if (chargeOsc) { chargeOsc.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02); chargeOsc.stop(ctx.currentTime + 0.1); chargeOsc = null; } },

  release() { if (!ok()) return; tone(90, { decay: 0.25, vol: 0.5, to: 45, verb: 0.2 }); noise({ decay: 0.15, vol: 0.2, type: 'lowpass', freq: 400 }); },
  rollStart() {
    if (!ok() || rollNodes) return;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 3;
    g.gain.value = 0; o.type = 'sine'; o.frequency.value = 48; og.gain.value = 0;
    const pan = out(s.connect(f).connect(g), 0, 0.15); out(o.connect(og), 0, 0);
    s.start(); o.start();
    rollNodes = { s, f, g, o, og, pan };
  },
  rollUpdate(speed, gutter, x) {
    if (!rollNodes) return;
    const t = ctx.currentTime, v = Math.min(1, speed / 9);
    rollNodes.g.gain.setTargetAtTime(v * (gutter ? 0.5 : 0.9), t, 0.05);
    rollNodes.og.gain.setTargetAtTime(gutter ? 0 : v * 0.25, t, 0.05);
    rollNodes.f.frequency.setTargetAtTime(gutter ? 1100 : 180 + v * 160, t, 0.05);
    rollNodes.f.type = gutter ? 'bandpass' : 'lowpass';
    rollNodes.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x / 0.7)), t, 0.05);
  },
  rollStop() {
    if (!rollNodes) return;
    const t = ctx.currentTime, n = rollNodes; rollNodes = null;
    n.g.gain.setTargetAtTime(0, t, 0.08); n.og.gain.setTargetAtTime(0, t, 0.08);
    n.s.stop(t + 0.5); n.o.stop(t + 0.5);
  },

  pin(strength, pan = 0) {
    if (!ok()) return;
    const now = performance.now();
    if (now - lastClack < 28) return; // a pin explosion is dozens of hits; ~35 clacks/s already sounds full
    lastClack = now;
    clack(Math.min(1, strength), pan);
  },
  pit() { if (!ok()) return; tone(70, { decay: 0.35, vol: 0.45, to: 35, verb: 0.4 }); noise({ decay: 0.3, vol: 0.2, type: 'lowpass', freq: 300, verb: 0.4 }); },
  gutterDrop(x) { if (!ok()) return; tone(160, { decay: 0.15, vol: 0.25, to: 90, pan: x }); noise({ decay: 0.1, vol: 0.2, freq: 1800, Q: 4, pan: x }); },
  bumper(x) { if (ok()) tone(260, { decay: 0.3, vol: 0.35, to: 520, pan: x }); },
  wall() {
    if (!ok()) return;
    tone(80, { decay: 0.4, vol: 0.6, to: 40, verb: 0.5 });
    for (let i = 0; i < 18; i++) noise({ t: 0.05 + Math.random() * 0.6, decay: 0.05, vol: 0.12, type: 'lowpass', freq: 700 + Math.random() * 600, verb: 0.4 });
  },
  quake() {
    if (!ok()) return;
    noise({ attack: 0.15, decay: 1.6, vol: 0.7, type: 'lowpass', freq: 110, Q: 2, verb: 0.6 });
    tone(38, { attack: 0.1, decay: 1.4, vol: 0.5, type: 'sawtooth', lp: 120, verb: 0.3 });
  },
  ult() {
    if (!ok()) return;
    tone(180, { type: 'sawtooth', attack: 0.5, decay: 0.15, vol: 0.18, to: 1400, lp: 3000 });
    noise({ attack: 0.5, decay: 0.2, vol: 0.2, freq: 400, to: 6000, Q: 1.5 });
    tone(60, { t: 0.55, decay: 0.6, vol: 0.6, to: 30, verb: 0.6 });
    [523, 659, 784].forEach(f => tone(f, { type: 'square', t: 0.55, decay: 0.5, vol: 0.05, lp: 3000 }));
  },

  yourTurn() { // bright arcade "ding-ding" so you notice even when looking away
    if (!ok()) return;
    noise({ attack: 0.12, decay: 0.12, vol: 0.12, freq: 600, to: 5000, Q: 1.2 });
    [[880, 0.12], [1320, 0.24]].forEach(([f, t]) => { tone(f, { type: 'triangle', t, decay: 0.5, vol: 0.2 }); tone(f * 2, { t, decay: 0.25, vol: 0.05 }); });
  },
  strike() {
    if (!ok()) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => { tone(f, { type: 'triangle', t: 0.3 + i * 0.08, decay: 0.45, vol: 0.16 }); tone(f / 2, { type: 'square', t: 0.3 + i * 0.08, decay: 0.3, vol: 0.04, lp: 2000 }); });
    tone(1046, { type: 'triangle', t: 0.75, attack: 0.02, decay: 1.0, vol: 0.14 });
    applause(2.8, 0.1);
  },
  spare() {
    if (!ok()) return;
    [659, 784, 988].forEach((f, i) => tone(f, { type: 'triangle', t: 0.25 + i * 0.09, decay: 0.4, vol: 0.15 }));
    applause(1.8, 0.07);
  },
  gutter() { // sad trombone
    if (!ok()) return;
    [[392, 0.3], [370, 0.3], [349, 0.3], [330, 0.9]].reduce((t, [f, d]) => {
      const o = tone(f, { type: 'sawtooth', t, attack: 0.03, decay: d, vol: 0.13, lp: 1200 });
      if (d > 0.5) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = 12; l.connect(lg).connect(o.frequency); l.start(ctx.currentTime + t); l.stop(ctx.currentTime + t + d); }
      return t + d * 0.9;
    }, 0.2);
  },
  win() {
    if (!ok()) return;
    [[523, 0], [523, 0.15], [523, 0.3], [659, 0.45], [784, 0.75], [659, 1.0], [784, 1.15], [1046, 1.35]].forEach(([f, t]) => {
      tone(f, { type: 'triangle', t, decay: t > 1.3 ? 1.2 : 0.25, vol: 0.18 });
      tone(f / 2, { type: 'square', t, decay: 0.2, vol: 0.05, lp: 1800 });
    });
    applause(4, 0.1);
  },
};
