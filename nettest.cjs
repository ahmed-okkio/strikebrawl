// Dev only: launches a host window and a joining window, both auto-played (see playtest.cjs).
// Run: node nettest.cjs <screenshot dir> [short]   (short = start at frame 9)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'nettest-out';
const electron = require('electron'); // path to the electron binary when required from node
const run = (name, hash) => {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const p = spawn(electron, ['.'], { cwd: __dirname, env: { ...process.env, PLAYTEST: dir, PLAYTEST_HASH: hash } });
  p.stdout.on('data', d => String(d).split('\n').filter(l => l.includes('[page]')).forEach(l => console.log(`${name}: ${l.replace('[page] ', '')}`)));
  p.on('exit', code => console.log(`${name} exited ${code}`));
  return p;
};

const host = run('host', process.argv[3] === 'short' ? 'nethost-short' : 'nethost');
host.stdout.on('data', d => {
  const m = /LOBBY CODE (\w{5})/.exec(String(d));
  if (m) run('join', `netjoin:${m[1]}`);
});
