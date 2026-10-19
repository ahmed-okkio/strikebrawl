// Rendering: the alley, per-lane meshes, particles and post-processing. Knows nothing about game rules.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { LANE_HALF, GUTTER_X, GUTTER_R, KICKBACK_X, DECK_Z, PIT_Z, PIT_BACK, PIN_LEN, WALL_Z, rackSpots } from './sim.js';

const LANE_SPACING = 2.2;

await document.fonts.load('80px "Lilita One"').catch(() => {});
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.prepend(renderer.domElement);
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b2270');
scene.fog = new THREE.Fog('#2b2270', 22, 48);
export const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
// composer targets drop the canvas MSAA, so render into a multisampled target instead
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.35, 0.92));
composer.addPass(new OutputPass());
const vignette = new ShaderPass(VignetteShader);
vignette.uniforms.offset.value = 0.9; vignette.uniforms.darkness.value = 1.15;
composer.addPass(vignette);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
export const render = () => composer.render();

scene.add(new THREE.HemisphereLight('#fff1e0', '#3a2a80', 1.1));
const sun = new THREE.DirectionalLight('#fff4e6', 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -3.5, right: 3.5, top: 12, bottom: -12, near: 1, far: 30 });
const deckLight = new THREE.SpotLight('#fff6e8', 10, 6, 0.7, 0.5);
deckLight.castShadow = true; deckLight.shadow.mapSize.set(1024, 1024);
scene.add(sun, sun.target, deckLight, deckLight.target);
// shadows only need to be sharp around the lane the camera is on
export function setFocus(x) {
  sun.position.set(x + 3, 9, -4); sun.target.position.set(x, 0, -12);
  deckLight.position.set(x, 1.4, -17.2); deckLight.target.position.set(x, 0, -18.8);
}
setFocus(0);

function canvasTex(w, h, draw, repeatY = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeatY !== 1) { t.wrapT = THREE.RepeatWrapping; t.repeat.y = repeatY; }
  return t;
}
const woodTex = canvasTex(512, 1024, (g, w, h) => {
  const boards = 39, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const l = 66 + Math.random() * 8;
    g.fillStyle = `hsl(${28 + Math.random() * 6}, 70%, ${l - 8}%)`; g.fillRect(i * bw, 0, bw, h);
    for (let k = 0; k < 14; k++) { // grain
      g.strokeStyle = `hsla(28, 50%, ${l - 12}%, ${0.08 + Math.random() * 0.1})`; g.lineWidth = 1;
      const x = i * bw + Math.random() * bw; g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 64) g.lineTo(x + Math.sin(y * 0.01 + k) * 1.2, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(80,45,20,.25)'; g.fillRect(i * bw, 0, 1, h);
  }
}, 4);
const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const glow = color => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false });

// masking unit above the pins: lane number + whoever owns the lane
function drawMask(g, w, h, n, name, color) {
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#ff4f8b'); grad.addColorStop(1, '#7b4dff');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.12)';
  for (let i = -4; i < 14; i++) { g.beginPath(); g.moveTo(i * 90, h); g.lineTo(i * 90 + 45, h); g.lineTo(i * 90 + 245, 0); g.lineTo(i * 90 + 200, 0); g.fill(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color || '#15123a'; g.beginPath(); g.arc(90, h / 2, 62, 0, 7); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#15123a'; g.stroke();
  g.font = '80px "Lilita One"'; g.fillStyle = '#fff'; g.fillText(String(n), 90, h / 2 + 4);
  const text = name ? name.toUpperCase() : 'STRIKE BRAWL';
  let size = 118; g.font = `${size}px "Lilita One"`;
  while (g.measureText(text).width > w - 220 && size > 40) g.font = `${size -= 6}px "Lilita One"`;
  g.lineWidth = 18; g.strokeStyle = '#15123a'; g.strokeText(text, w / 2 + 60, h / 2 + 8);
  g.fillStyle = '#ffc93c'; g.fillText(text, w / 2 + 60, h / 2 + 8);
}
const wallTex = canvasTex(512, 256, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#3a2c8f'); grad.addColorStop(1, '#231a5e');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = ['#ff4f8b', '#3df0ff', '#ffc93c', '#7b4dff'][i % 4]; g.globalAlpha = 0.5;
    const x = Math.random() * w, y = Math.random() * h, r = 2 + Math.random() * 5;
    g.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill();
  }
});
wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.x = 3;
const carpetTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#1e1850'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = ['#ff4f8b', '#3df0ff', '#ffc93c', '#8b5cff'][i % 4]; g.lineWidth = 5; g.globalAlpha = 0.55;
    const x = Math.random() * w, y = Math.random() * h;
    if (i % 3 === 0) { g.beginPath(); g.arc(x, y, 8 + Math.random() * 10, 0, 7); g.stroke(); }
    else if (i % 3 === 1) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 20, y - 25, x + 40, y); g.stroke(); }
    else { g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 10, y + 8); g.lineTo(x - 10, y + 8); g.closePath(); g.stroke(); }
  }
});
carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping; carpetTex.repeat.set(12, 10);

const PIN_PROFILE = [[0, 0], [0.03, 0], [0.05, 0.04], [0.06, 0.1], [0.058, 0.14], [0.045, 0.2], [0.028, 0.245], [0.023, 0.255], [0.022, 0.27], [0.024, 0.285], [0.032, 0.32], [0.034, 0.345], [0.028, 0.37], [0.012, 0.38], [0, 0.382]];
const pinTex = canvasTex(4, 14 * 8, (g, w, h) => { // lathe v runs per profile segment; paint segments 6 and 8 red
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8243f'; for (const s of [6, 8]) g.fillRect(0, h - (s + 1) * 8, w, 8);
});
const pinMat = new THREE.MeshPhysicalMaterial({ map: pinTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
const pinGeo = new THREE.LatheGeometry(PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 24);
function makePinMesh() {
  const m = new THREE.Mesh(pinGeo, pinMat); m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  return g;
}

const laneMat = new THREE.MeshPhysicalMaterial({ map: woodTex, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
const approachMat = new THREE.MeshPhysicalMaterial({ color: '#f3d29a', map: woodTex, roughness: 0.4, clearcoat: 0.6 });
const gutterMat = mat('#6f7bab', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
const capMat = mat('#241d5c', { roughness: 0.4 }), darkMat = mat('#4a2a14', { roughness: 0.4 });
// U-shaped trough (lower half-ring) extruded down the lane; opening faces up so a gutter ball stays visible
const gutterGeo = (() => {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, GUTTER_R + 0.014, Math.PI, Math.PI * 2, false);
  sh.absarc(0, 0, GUTTER_R, Math.PI * 2, Math.PI, true);
  return new THREE.ExtrudeGeometry(sh, { depth: -PIT_Z + 0.4, bevelEnabled: false, curveSegments: 20 });
})();
const kickMat = mat('#fff', { map: canvasTex(256, 512, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#2c2470'); grad.addColorStop(1, '#151040');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 9; i++) { g.fillStyle = ['#ff4f8b', '#3df0ff', '#ffc93c'][i % 3]; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 10, 0, 7); g.fill(); }
}), roughness: 0.6 });
const curtainMat = mat('#fff', { map: canvasTex(512, 64, (g, w, h) => { // heavy black drape with vertical folds
  for (let x = 0; x < w; x++) { const v = 10 + 9 * Math.sin(x * 0.19) + 4 * Math.sin(x * 0.53); g.fillStyle = `rgb(${v},${v - 2},${v + 8})`; g.fillRect(x, 0, 1, h); }
}), roughness: 1 });
function buildLane(x0, n) {
  const g = new THREE.Group(); g.position.x = x0;
  const lane = new THREE.Mesh(new THREE.BoxGeometry((GUTTER_X - GUTTER_R - 0.016) * 2, 0.17, 20.2), laneMat); // stops short of the gutter lip so they never share a surface
  lane.position.set(0, -0.085, -9.6); lane.receiveShadow = true; g.add(lane);
  const approach = new THREE.Mesh(new THREE.BoxGeometry(2, 0.17, 5), approachMat);
  approach.position.set(0, -0.086, 2.9); approach.receiveShadow = true; g.add(approach);
  for (const s of [-1, 1]) {
    const gut = new THREE.Mesh(gutterGeo, gutterMat);
    gut.position.set(s * GUTTER_X, 0, PIT_Z); gut.receiveShadow = true; g.add(gut);
    // kickbacks: slim side panels like a real house, running from the deck up into the masking unit
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.32, DECK_Z - PIT_BACK), kickMat);
    kick.position.set(s * (KICKBACK_X + 0.03), 0.48, (DECK_Z + PIT_BACK) / 2); kick.receiveShadow = true; g.add(kick);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 20.4), capMat);
    cap.position.set(s * 0.95, -0.06, -9.6); g.add(cap);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 20.4), glow(n % 2 ? '#3df0ff' : '#ff4f8b'));
    neon.position.set(s * 0.94, 0.06, -9.6); g.add(neon);
  }
  const foul = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HALF * 2, 0.025), glow('#ff3355'));
  foul.rotation.x = -Math.PI / 2; foul.position.set(0, 0.001, 0); g.add(foul);
  for (let i = -3; i <= 3; i++) {
    const a = new THREE.Mesh(new THREE.CircleGeometry(0.05, 3), darkMat);
    a.rotation.x = -Math.PI / 2; a.rotation.z = Math.PI / 2; a.scale.set(0.5, 1, 1);
    a.position.set(i * 0.135, 0.001, -4.6 + Math.abs(i) * 0.3); g.add(a);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), darkMat);
    d.rotation.x = -Math.PI / 2; d.position.set(i * 0.135, 0.001, -2.1); g.add(d);
  }
  const pit = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 0.2), mat('#100c2e'));
  pit.position.set(0, 0.6, -20.7); g.add(pit);
  const pitFloor = new THREE.Mesh(new THREE.BoxGeometry(KICKBACK_X * 2, 0.05, PIT_Z - PIT_BACK + 0.2), mat('#0b0920'));
  pitFloor.position.set(0, -0.4, (PIT_Z + PIT_BACK) / 2 - 0.1); g.add(pitFloor);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(KICKBACK_X * 2, 1.6), curtainMat);
  curtain.position.set(0, 0.35, PIT_BACK - 0.02); g.add(curtain);
  const maskCanvas = document.createElement('canvas'); maskCanvas.width = 1024; maskCanvas.height = 320;
  drawMask(maskCanvas.getContext('2d'), 1024, 320, n);
  const maskTex = new THREE.CanvasTexture(maskCanvas); maskTex.colorSpace = THREE.SRGBColorSpace; maskTex.anisotropy = 8;
  const mask = new THREE.Mesh(new THREE.BoxGeometry(2, 0.62, 0.3), [capMat, capMat, capMat, capMat, mat('#fff', { map: maskTex, roughness: 0.5 }), capMat]);
  mask.position.set(0, 1.45, -19.3); g.add(mask);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.03), glow('#fff2c8'));
  strip.position.set(0, 1.12, -19.15); g.add(strip);
  // overhead monitor above the approach mirrors the masking unit art
  const monitor = new THREE.Group();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55), new THREE.MeshBasicMaterial({ map: maskTex, toneMapped: false, color: '#b8b0d8' }));
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.67, 0.06), capMat);
  bezel.position.z = -0.035; monitor.add(bezel, screen);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6), capMat);
  pole.position.set(0, 1.1, -0.06); monitor.add(pole);
  monitor.position.set(0, 2.75, -3.2); monitor.rotation.x = -0.18; g.add(monitor);
  scene.add(g);
  return { group: g, setOwner(name, color) { drawMask(maskCanvas.getContext('2d'), 1024, 320, n, name, color); maskTex.needsUpdate = true; } };
}

// static room
// carpet sits below the gutter troughs and stops short of the pits so neither is sliced through
const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 59.5), mat('#fff', { map: carpetTex, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.17, 10.25); floor.receiveShadow = true; scene.add(floor);
const back = new THREE.Mesh(new THREE.PlaneGeometry(60, 8), mat('#fff', { map: wallTex }));
back.position.set(0, 3, -21); scene.add(back);
const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 256, (g, w, h) => {
  g.font = '170px "Lilita One"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff4f8b'; g.shadowBlur = 30; g.fillStyle = '#ffd6e6'; g.fillText('STRIKE BRAWL', w / 2, h / 2 + 10);
}), transparent: true, toneMapped: false }));
sign.position.set(0, 4.3, -20.9); scene.add(sign);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ color: '#120e33' }));
ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, 4.8, -5); scene.add(ceiling);
for (let i = -3; i <= 3; i++) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(26, 0.05, 0.25), glow('#fff4d6'));
  bar.position.set(0, 4.6, -18 + i * 5); scene.add(bar);
}
for (const i of [-3, -2, -1, 1, 2, 3]) { // neighbouring lanes with static racks
  const { group } = buildLane(i * LANE_SPACING, 7 + i);
  for (const [px, pz] of rackSpots()) group.add(makePinMesh().translateX(px).translateZ(pz));
}

// ---------- per-lane dynamic meshes ----------
const ballTexCache = {};
export function ballTexture(color) { // marbled swirl in the player's colour
  return ballTexCache[color] ||= canvasTex(512, 256, (g, w, h) => {
    const base = new THREE.Color(color);
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const c = base.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.35);
      g.strokeStyle = `#${c.getHexString()}`; g.globalAlpha = 0.5; g.lineWidth = 3 + Math.random() * 10;
      g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 60; g.quadraticCurveTo(x + 40, y - 30, x, y); }
      g.stroke();
    }
  });
}
const ballGeo = new THREE.SphereGeometry(1, 48, 32), holeGeo = new THREE.CircleGeometry(0.11, 16), holeMat = mat('#0c0a1f');
const brickTex = canvasTex(256, 128, (g) => {
  g.fillStyle = '#5a2a20'; g.fillRect(0, 0, 256, 128);
  for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
    g.fillStyle = `hsl(${8 + Math.random() * 8}, 60%, ${42 + Math.random() * 10}%)`;
    g.fillRect(c * 64 + (r % 2) * 32 + 3, r * 32 + 3, 58, 26);
  }
});
const brickMat = mat('#fff', { map: brickTex, roughness: 0.9 });
const bumperMat = mat('#ffc93c', { emissive: '#ff8a00', emissiveIntensity: 0.3 });

// soft contact shadow under the ball so it reads as grounded at speed
const blobMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
}) });
// the live lane sits at x = 0; views is an array so the sync code stays lane-agnostic
export const views = [0].map(x0 => {
  const deco = buildLane(x0, 7);
  const pins = rackSpots().map(([x, z]) => { const m = makePinMesh(); m.position.set(x0 + x, 0, z); scene.add(m); return m; });
  const ball = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }));
  ball.castShadow = true; ball.visible = false;
  for (const [a, b] of [[0.22, 0.32], [-0.22, 0.32], [0, 0.6]]) { // finger holes so the roll reads
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.position.setFromSphericalCoords(1.001, b, a); h.lookAt(h.position.clone().multiplyScalar(2)); ball.add(h);
  }
  scene.add(ball);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.2), brickMat);
  wall.castShadow = true; wall.visible = false; scene.add(wall);
  const bumpers = [-1, 1].map(s => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 18, 12), bumperMat);
    b.rotation.x = Math.PI / 2; b.position.set(x0 + s * (LANE_HALF + 0.03), 0.05, -9.2); b.visible = false; scene.add(b);
    return b;
  });
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), blobMat);
  blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
  return { x0, pins, ball, blob, wall, bumpers, setOwner: deco.setOwner };
});

const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
// Copy a lane's sim state onto its meshes. hidePins = fog of war for the local viewer.
export function syncLane(i, L, color, hidePins) {
  const v = views[i], b = L.ball;
  if (color && v.ball.userData.color !== color) { v.ball.material.map = ballTexture(color); v.ball.material.needsUpdate = true; v.ball.userData.color = color; }
  v.ball.visible = L.phase !== 'idle' && b.visible;
  v.ball.scale.setScalar(b.r);
  const px = v.ball.position.x, pz = v.ball.position.z;
  // in the gutter a small ball rests on the trough floor, a big one rides the rims
  const gy = b.r > GUTTER_R ? Math.sqrt(b.r * b.r - GUTTER_R * GUTTER_R) : b.r - GUTTER_R;
  v.ball.position.set(v.x0 + b.x, (b.gutter ? gy : b.r) + (b.y || 0), b.z);
  v.blob.visible = v.ball.visible && !b.gutter && !(b.y < 0);
  v.blob.position.set(v.x0 + b.x, 0.002, b.z); v.blob.scale.setScalar(b.r * 3.2);
  const dx = v.ball.position.x - px, dz = v.ball.position.z - pz, dist = Math.hypot(dx, dz);
  if (dist > 1e-5 && dist < 1) v.ball.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpV.set(dz, 0, -dx).normalize(), dist / b.r));
  L.pins.forEach((p, k) => {
    const m = v.pins[k];
    m.visible = !p.gone && !hidePins;
    const ang = p.standing ? 0 : p.tilt * Math.PI / 2 + (p.tumble || 0);
    // a lying pin rests on its belly, not its base pivot; in the gutter it sinks into the trough
    const lift = 0.055 * Math.abs(Math.sin(ang)) + (Math.abs(p.x) > LANE_HALF + 0.04 && p.z > PIT_Z ? -0.07 : 0);
    m.position.set(v.x0 + p.x, (p.y || 0) + lift, p.z);
    m.quaternion.setFromAxisAngle(tmpV.set(p.dz, 0, -p.dx), ang);
  });
  const R = L.roll;
  v.wall.visible = !!R?.wall && L.phase !== 'idle';
  if (R?.wall) v.wall.position.set(v.x0 + R.wall * 0.27, 0.2, WALL_Z);
  v.bumpers.forEach(m => m.visible = !!R?.bumpers && L.phase !== 'idle');
}

// ---------- aim guide (one, shown on the lane being aimed by the local player) ----------
const aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
const aimDots = [...Array(14)].map((_, i) => {
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.025 - i * 0.0012, 12), aimMat);
  d.rotation.x = -Math.PI / 2; scene.add(d); return d;
});
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 3), glow('#ffc93c'));
arrow.rotation.x = -Math.PI / 2; scene.add(arrow);
export function showAim(on, x0, x, z, a, t) {
  arrow.visible = on; aimDots.forEach(d => d.visible = on);
  if (!on) return;
  aimDots.forEach((d, i) => d.position.set(x0 + x + Math.sin(a) * (0.35 + i * 0.32), 0.003, z - Math.cos(a) * (0.35 + i * 0.32)));
  aimMat.opacity = 0.55 + 0.3 * Math.sin(t * 6);
  arrow.position.set(x0 + x + Math.sin(a) * 5, 0.02, z - Math.cos(a) * 5); arrow.rotation.z = -a;
}

// ---------- particles (confetti, sparks, trail) ----------
const MAX_P = 900;
const parts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), MAX_P);
parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
parts.frustumCulled = false; scene.add(parts);
const pool = [...Array(MAX_P)].map(() => ({ life: 0 }));
let nextP = 0;
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
export function emit(x, y, z, n, colors, spd, size, grav = 9) {
  for (let i = 0; i < n; i++) {
    const p = pool[nextP = (nextP + 1) % MAX_P];
    const a = Math.random() * Math.PI * 2, u = Math.random();
    Object.assign(p, { x, y, z, vx: Math.cos(a) * spd * u, vy: spd * (0.5 + Math.random()), vz: Math.sin(a) * spd * u,
      life: 1, decay: 0.5 + Math.random() * 0.5, size: size * (0.6 + Math.random() * 0.6), grav, rx: Math.random() * 6, ry: Math.random() * 6 });
    parts.setColorAt(nextP, tmpC.set(colors[i % colors.length]).multiplyScalar(1.4));
  }
  parts.instanceColor.needsUpdate = true;
}
emit(0, -10, 0, 1, ['#fff'], 0, 0); // allocate instanceColor
export function updateParticles(dt) {
  pool.forEach((p, i) => {
    if (p.life > 0) {
      p.life -= p.decay * dt; p.vy -= p.grav * dt;
      p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += dt * 8; p.ry += dt * 6;
      if (p.y < 0.01) { p.y = 0.01; p.vy *= -0.3; }
    }
    dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rx, p.ry, 0);
    dummy.scale.setScalar(p.life > 0 ? p.size * Math.min(1, p.life * 3) : 0);
    dummy.updateMatrix(); parts.setMatrixAt(i, dummy.matrix);
  });
  parts.instanceMatrix.needsUpdate = true;
}

// reflections come from the alley itself (neon, ceiling bars); lift the scene so the probe sits above the lanes
scene.position.y = -0.6;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(scene, 0.02, 0.1, 60).texture;
scene.position.y = 0;
scene.environmentIntensity = 0.7;
