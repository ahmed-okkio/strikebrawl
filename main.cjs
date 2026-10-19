const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// test runs get their own profile: a running game locks the shared one and stalls the page's storage
if (process.env.SMOKE || process.env.PLAYTEST) app.setPath('userData', path.join(app.getPath('temp'), `strikebrawl-test-${process.pid}`));

app.whenReady().then(() => {
  // SMOKE=<png path> runs a bots-only game, screenshots it, then quits (used for testing).
  const smoke = process.env.SMOKE;
  const win = new BrowserWindow({
    width: 1400, height: 860, backgroundColor: '#15123a', autoHideMenuBar: true, show: !(smoke || process.env.PLAYTEST), // test runs stay off-screen
    title: 'Strike Brawl', icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { backgroundThrottling: false },
  });
  const playtest = process.env.PLAYTEST; // dev only: visible scripted playthrough, see playtest.cjs
  if (playtest) require('./playtest.cjs')(win, playtest);
  const hash = smoke ? process.env.SMOKE_HASH ?? 'auto' : playtest ? process.env.PLAYTEST_HASH || 'playtest' : '';
  win.loadFile(path.join(__dirname, 'index.html'), { query: { v: app.getVersion() }, hash }); // version feeds the lobby check
  if (app.isPackaged && !smoke && !playtest) checkForUpdates(win);
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
  autoUpdater.on('update-available', i => show({ v: i.version, p: 0 }));
  autoUpdater.on('download-progress', d => show({ p: d.percent, got: d.transferred, total: d.total }));
  autoUpdater.on('error', () => show({ failed: true })); // offline or GitHub down: just play the current version
  autoUpdater.on('update-downloaded', () => {
    show({ p: 100, installing: true });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200); // silent install, then reopen
  });
  win.webContents.once('did-finish-load', () => autoUpdater.checkForUpdates().catch(() => {}));
}

app.on('window-all-closed', () => app.quit());
