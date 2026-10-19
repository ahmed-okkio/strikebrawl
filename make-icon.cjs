// Dev only: renders build/icon.ico (256px PNG inside an ICO container). Run: npx electron make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<canvas id=c width=256 height=256></canvas><script>
const g = c.getContext('2d');
const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
rr(8, 8, 240, 240, 56); g.fillStyle = '#15123a'; g.fill();
rr(16, 16, 224, 224, 50); const bg = g.createLinearGradient(0, 16, 0, 240); bg.addColorStop(0, '#8b5cff'); bg.addColorStop(1, '#ff4f8b'); g.fillStyle = bg; g.fill();
g.globalAlpha = .14; g.fillStyle = '#fff';
for (let i = -6; i < 8; i++) { g.beginPath(); g.moveTo(i * 40, 256); g.lineTo(i * 40 + 20, 256); g.lineTo(i * 40 + 140, 0); g.lineTo(i * 40 + 120, 0); g.fill(); }
g.globalAlpha = 1;
// pin
g.save(); g.translate(170, 46); g.rotate(.32);
g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(16, 0, 18, 22, 12, 40); g.bezierCurveTo(30, 60, 32, 110, 20, 150); g.lineTo(-20, 150); g.bezierCurveTo(-32, 110, -30, 60, -12, 40); g.bezierCurveTo(-18, 22, -16, 0, 0, 0);
g.lineWidth = 10; g.strokeStyle = '#15123a'; g.stroke(); g.fillStyle = '#fff'; g.fill();
g.fillStyle = '#e8243f'; g.fillRect(-14, 36, 28, 6); g.fillRect(-14, 47, 28, 6);
g.restore();
// ball
const bx = 104, by = 150, r = 70;
g.beginPath(); g.arc(bx, by, r + 6, 0, 7); g.fillStyle = '#15123a'; g.fill();
const ball = g.createRadialGradient(bx - 24, by - 26, 6, bx, by, r); ball.addColorStop(0, '#ffe27a'); ball.addColorStop(.55, '#ffc93c'); ball.addColorStop(1, '#f08c00');
g.beginPath(); g.arc(bx, by, r, 0, 7); g.fillStyle = ball; g.fill();
g.fillStyle = '#15123a'; for (const [x, y] of [[-14, -28], [12, -32], [-2, -6]]) { g.beginPath(); g.arc(bx + x, by + y, 9, 0, 7); g.fill(); }
g.beginPath(); g.ellipse(bx - 30, by - 36, 14, 8, -.7, 0, 7); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
</script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${html}</body>`));
  const png = Buffer.from((await win.webContents.executeJavaScript('c.toDataURL()')).split(',')[1], 'base64');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); // ICO, one image
  header.writeUInt8(0, 6); header.writeUInt8(0, 7); // 0 = 256px
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), Buffer.concat([header, png]));
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.png'), png);
  app.quit();
});
