const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// test runs get their own profile: a running game locks the shared one and stalls the page's storage
if (process.env.SMOKE || process.env.PLAYTEST) app.setPath('userData', path.join(app.getPath('temp'), `strikebrawl-test-${process.pid}`));

app.whenReady().then(() => {
  // SMOKE=<png path> runs a bots-only game, screenshots it, then quits (used for testing).
  const smoke = process.env.SMOKE;
  const win = new BrowserWindow({
    width: 1400, height: 860, backgroundColor: '#15123a', autoHideMenuBar: true,
    title: 'Strike Brawl', icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { backgroundThrottling: false },
  });
  const playtest = process.env.PLAYTEST; // dev only: scripted playthrough, see playtest.cjs
  // test runs render normally (hidden windows lose GPU/audio) but sit off-screen, out of the taskbar, without stealing focus
  if (smoke || playtest) { win.hide(); win.setSkipTaskbar(true); win.setPosition(-4000, 0); win.showInactive(); win.webContents.setAudioMuted(true); }
  if (playtest) require('./playtest.cjs')(win, playtest);
  const hash = smoke ? process.env.SMOKE_HASH ?? 'auto' : playtest ? process.env.PLAYTEST_HASH || 'playtest' : '';
  const updates = app.isPackaged && !smoke && !playtest;
  // v feeds the lobby version check; u=1 makes the page start behind the "checking for updates" screen
  win.loadFile(path.join(__dirname, 'index.html'), { query: { v: app.getVersion(), u: updates ? '1' : '0' }, hash });
  if (updates) checkForUpdates(win);
  if (!smoke) return;
  win.webContents.on('console-message', (_e, level, msg) => console.log('[page]', msg));
  setTimeout(async () => {
    fs.writeFileSync(smoke, (await win.capturePage()).toPNG());
    app.quit();
  }, Number(process.env.SMOKE_MS || 6000));
});

// Downloads new versions from GitHub Releases at launch. The page shows a blocking progress bar (window.__update),
// then the installer runs silently and relaunches the game.
function checkForUpdates(win) {
  const { autoUpdater } = require('electron-updater');
  const show = s => win.webContents.executeJavaScript(`window.__update?.(${JSON.stringify(s)})`).catch(() => {});
  // the page starts blocked; every outcome except a found update releases it
  let found = false;
  const release = () => { if (!found) show({ done: true }); };
  autoUpdater.on('update-not-available', release);
  setTimeout(release, 15000); // a hung check (bad connection) never locks anyone out
  autoUpdater.on('update-available', i => { found = true; show({ v: i.version, p: 0 }); });
  autoUpdater.on('download-progress', d => show({ p: d.percent, got: d.transferred, total: d.total }));
  autoUpdater.on('error', () => { found = false; show({ done: true }); }); // offline or GitHub down: just play the current version
  autoUpdater.on('update-downloaded', () => {
    show({ p: 100, installing: true });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200); // silent install, then reopen
  });
  win.webContents.once('did-finish-load', () => autoUpdater.checkForUpdates().catch(() => {}));
}

app.on('window-all-closed', () => app.quit());
