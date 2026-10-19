// Standard ten-pin scoring. frames: array of up to 10 arrays of roll counts.

// Cumulative score per frame, null where a bonus isn't known yet.
export function cumulative(frames) {
  const flat = frames.flat();
  const out = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    const fr = frames[f];
    if (!fr || !fr.length) { out.push(null); continue; }
    const a = flat[i], b = flat[i + 1], c = flat[i + 2];
    let s = null;
    if (f === 9) { if (frameDone(9, fr)) s = fr.reduce((x, y) => x + y, 0); }
    else if (a === 10) { if (b !== undefined && c !== undefined) s = 10 + b + c; i += 1; }
    else if (fr.length === 2) { if (a + b === 10) { if (c !== undefined) s = 10 + c; } else s = a + b; i += 2; }
    else i += fr.length;
    if (s === null || out.includes(null)) { out.push(null); continue; }
    total += s;
    out.push(total);
  }
  return out;
}

export function total(frames) {
  const c = cumulative(frames).filter(v => v !== null);
  return c.length ? c[c.length - 1] : 0;
}

export function frameDone(f, rolls) {
  const [a, b] = rolls;
  if (f < 9) return a === 10 || rolls.length === 2;
  if (rolls.length < 2) return false;
  if (rolls.length === 3) return true;
  return !(a === 10 || a + b === 10);
}

// Does the next roll in this frame get a fresh rack?
export function freshRack(rolls) {
  let left = 10;
  for (const v of rolls) { left -= v; if (left === 0) left = 10; }
  return left === 10;
}

// Display marks: X strike, / spare, - zero.
export function marks(rolls) {
  let left = 10, first = true;
  return rolls.map(v => {
    let m;
    if (v === left) m = first ? 'X' : '/';
    else m = v === 0 ? '-' : String(v);
    left -= v; first = left === 0;
    if (first) left = 10;
    return m;
  });
}
