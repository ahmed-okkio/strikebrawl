// Publishes release/ to GitHub Releases for the current package.json version (installed copies auto-update from it).
const { execFileSync } = require('child_process');
const { version } = require('./package.json');
const files = [`StrikeBrawl-Setup-${version}.exe`, `StrikeBrawl-Setup-${version}.exe.blockmap`, 'latest.yml'].map(f => `release/${f}`);
execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--title', `Strike Brawl ${version}`, '--notes', process.env.NOTES || `Strike Brawl ${version}`], { stdio: 'inherit' });
