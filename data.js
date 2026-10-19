// Static game content: icons, augments, ultimates, player palette.
// 24x24 stroke icons, drawn with currentColor
export const ICONS = {
  boulder: '<circle cx="12" cy="12" r="9"/><circle cx="9.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="14.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12.5" r="1.3" fill="currentColor"/>',
  heavy: '<path d="M8.5 9.5a3.5 3.5 0 1 1 7 0"/><path d="M6.5 10h11l1.8 10H4.7z"/>',
  steady: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  hook: '<path d="M7 21V11a5 5 0 0 1 10 0v3"/><path d="M14 11.5l3 3 3-3"/>',
  lucky: '<circle cx="9" cy="9" r="3.2"/><circle cx="15" cy="9" r="3.2"/><circle cx="9" cy="15" r="3.2"/><circle cx="15" cy="15" r="3.2"/><path d="M14 16l5 6"/>',
  magnet: '<path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0z"/><path d="M5 8h4M15 8h4"/>',
  bumpers: '<path d="M4 3v18M20 3v18"/><circle cx="12" cy="12" r="4"/><path d="M7 7l2 2M17 17l-2-2"/>',
  power: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  butter: '<path d="M3 13l9-5 9 5-9 5z"/><path d="M3 13v3l9 5 9-5v-3"/><path d="M8 4c1 1 1 2 0 3M12 2c1 1 1 2 0 3"/>',
  grease: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
  shaky: '<circle cx="12" cy="12" r="8"/><path d="M5 12l2-2.5 2 5 2-5 2 5 2-5 2 5 2-2.5"/>',
  pebble: '<circle cx="12" cy="12" r="2.5"/><path d="M4 4l4.5 4.5M20 4l-4.5 4.5M4 20l4.5-4.5M20 20l-4.5-4.5"/><path d="M8.5 5v3.5H5M15.5 5v3.5H19M8.5 19v-3.5H5M15.5 19v-3.5H19"/>',
  fog: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M3 21h12M9 21h12"/>',
  lead: '<path d="M12 2c1.4 0 1.9 1.4 1.5 3.3L13 7.5c2.8 2 3.4 5.6 2.4 9L15 18H9l-.4-1.5c-1-3.4-.4-7 2.4-9l-.5-2.2C10.1 3.4 10.6 2 12 2z"/><path d="M6 22h12"/>',
  reverse: '<path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>',
  wreck: '<path d="M12 2v3M12 7v2"/><circle cx="12" cy="16" r="6"/><path d="M9 14a3 3 0 0 1 3-2"/>',
  quake: '<path d="M2 20h20"/><path d="M13 3l-4 6 5 2.5-4 6"/><path d="M4 16l2-2M20 16l-2-2"/>',
  missile: '<path d="M14.5 4.5C17 3 21 3 21 3s0 4-1.5 6.5L12 17l-5-5z"/><path d="M7 12l-3.5 1 2.5-4.5M12 17l-1 3.5 4.5-2.5"/><circle cx="15.5" cy="8.5" r="1.4"/>',
  wall: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M12 9.7v4.6M6 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  pin: '<path d="M12 2c1.4 0 1.9 1.4 1.5 3.3L13 7.5c2.8 2 3.4 5.6 2.4 9L14.6 21H9.4l-.8-4.5c-1-3.4-.4-7 2.4-9l-.5-2.2C10.1 3.4 10.6 2 12 2z"/>',
  cards: '<rect x="3" y="5" width="11" height="15" rx="2"/><path d="M10 4.5 12 3l9 3-4 14"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
export const icon = id => `<svg class="i" viewBox="0 0 24 24">${ICONS[id]}</svg>`;

export const AUGS = {
  boulder: { name: 'Boulder Ball', kind: 'buff', desc: 'Your ball is 30% bigger. Hard to miss.' },
  heavy:   { name: 'Heavyweight', kind: 'buff', desc: 'Ball mass x2. Pins fly, your ball plows through.' },
  steady:  { name: 'Steady Hands', kind: 'buff', desc: 'Aim sway almost disappears.' },
  hook:    { name: 'Hook Master', kind: 'buff', desc: 'Spin hooks twice as hard.' },
  lucky:   { name: 'Lucky Wobble', kind: 'buff', desc: 'Pins that wobble have a 60% chance to drop anyway.' },
  magnet:  { name: 'Pin Magnet', kind: 'buff', desc: 'Your ball curves toward standing pins.' },
  bumpers: { name: 'Bumpers', kind: 'buff', desc: 'Bumpers on the first roll of every frame.' },
  power:   { name: 'Power Surge', kind: 'buff', desc: '+30% ball speed for extra pin carnage.' },
  butter:  { name: 'Butterfingers', kind: 'nerf', desc: "Target's power meter moves twice as fast." },
  grease:  { name: 'Greasy Lane', kind: 'nerf', desc: "Target's ball drifts randomly down the lane." },
  shaky:   { name: 'Shaky Aim', kind: 'nerf', desc: "Target's aim sways three times harder." },
  pebble:  { name: 'Pebble Ball', kind: 'nerf', desc: "Target's ball shrinks by 35%." },
  fog:     { name: 'Fog of War', kind: 'nerf', desc: 'Target cannot see the pins while aiming.' },
  lead:    { name: 'Lead Pins', kind: 'nerf', desc: "Target's pins are heavy and hard to topple." },
  reverse: { name: 'Backwards', kind: 'nerf', desc: "Target's left and right controls are swapped." },
};
export const ULTS = {
  wreck:   { name: 'Wrecking Ball', desc: 'Your next roll is a giant, triple-weight ball.' },
  quake:   { name: 'Earthquake', desc: 'After your next roll, each standing pin has a 60% chance to fall.' },
  missile: { name: 'Guided Missile', desc: 'Steer your next roll live with A / D.' },
  wall:    { name: 'Brick Wall', desc: "The leader's next roll faces a wall across half the lane." },
};
export const COLORS = ['#ff4f6d', '#3d8bff', '#ffb627', '#22c9a6', '#a66bff', '#ff7a2f', '#4fd1ff', '#8bd346'];
export const BOT_NAMES = ['Gutterson', 'Splitz', 'Pinzilla', 'Lowball', 'Strikezilla', 'Bumper', 'Sparetacus', 'Kingpin'];

