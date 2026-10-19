const { app, BrowserWindow, dialog } = require('electron');
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

// Downloads new versions from GitHub Releases in the background, then offers a restart.
function checkForUpdates(win) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('error', () => {}); // offline or GitHub down: just play the current version
  autoUpdater.on('update-downloaded', async info => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, title: 'Update ready',
      message: `Strike Brawl ${info.version} is ready.`, detail: 'Restart now to update, or it installs when you next close the game.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

app.on('window-all-closed', () => app.quit());
