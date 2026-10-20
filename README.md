# Strike Brawl

Chaotic party bowling for up to 8 players: real ten-pin scoring, a fresh augment draft every frame (buff yourself or sabotage a rival), live cards that let you heckle whoever is bowling with your mouse (tomatoes, a pesky fly, moles, a leaf blower, a seagull...), and one game-changing Ultimate per game. Play locally on one keyboard or online peer-to-peer with a 5-letter lobby code.

**Download:** grab `StrikeBrawl-Setup-x.y.z.exe` from the [latest release](https://github.com/ahmed-okkio/strikebrawl/releases/latest). The game updates itself after that.

## Dev

```
npm install
npm start          # run from source
npm test           # scoring, physics and card checks
npm run release    # build the installer and publish it as a GitHub release (needs GH_TOKEN)
```

Bump `version` in package.json before each release; installed copies pick it up on next launch.
