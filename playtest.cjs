// Scripted visible playtest: plays the human seat with real keyboard events, screenshots key moments.
// Run: PLAYTEST=<screenshot dir> npx electron .
const fs = require('fs');
const path = require('path');

module.exports = function playtest(win, outDir) {
  const wc = win.webContents;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const js = code => wc.executeJavaScript(code);
  const key = (type, keyCode) => wc.sendInputEvent({ type, keyCode });
  const tap = async (k, ms = 60) => { key('keyDown', k); await sleep(ms); key('keyUp', k); };
  let shot = 0;
  const snap = async name => fs.writeFileSync(path.join(outDir, `${String(++shot).padStart(2, '0')}-${name}.png`), (await win.capturePage()).toPNG());

  wc.on('console-message', (_e, _level, msg) => console.log('[page]', msg));
  wc.once('did-finish-load', async () => {
    if (process.env.PLAYTEST_NOPLAY) return;
    win.focus(); wc.focus();
    await sleep(1500);
    let throws = 0, ultTried = false;
    for (;;) {
      const s = await js(`({ phase: window.__game?.phase, human: window.__game?.human,
        draft: !document.getElementById('draft').classList.contains('hidden'),
        targets: !document.getElementById('targets').classList.contains('hidden') })`);
      if (s.phase === 'end') { await sleep(1500); await snap('end'); break; }
      if (s.draft) {
        await snap('draft');
        await tap(String(1 + Math.floor(Math.random() * 3)));
        await sleep(400);
        if (await js(`!document.getElementById('targets').classList.contains('hidden')`)) { await snap('targets'); await tap('1'); }
        await sleep(600);
        continue;
      }
      if (s.phase === 'aim' && s.human) {
        throws++;
        // line up: step right, nudge aim back left, add a little hook
        const right = 80 + Math.random() * 220;
        key('keyDown', 'D'); await sleep(right); key('keyUp', 'D');
        key('keyDown', 'Left'); await sleep(150 + Math.random() * 250); key('keyUp', 'Left');
        key('keyDown', 'Q'); await sleep(100 + Math.random() * 150); key('keyUp', 'Q');
        if (!ultTried && throws >= 4) { ultTried = true; await tap('U'); await sleep(400); await snap('ultimate'); }
        if (throws <= 2) await snap('aim');
        key('keyDown', 'Space');
        const target = 0.6 + Math.random() * 0.35;
        for (let t = 0; t < 400; t++) { await sleep(10); if ((await js('window.__game.power')) >= target) break; }
        if (throws <= 2) await snap('charging');
        key('keyUp', 'Space');
        await sleep(2300);
        if (throws <= 3) await snap('rolling');
        continue;
      }
      await sleep(250);
    }
    await sleep(1000);
    win.close();
  });
};
