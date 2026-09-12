/* ============================================================================
 * SQUEAK & SEEK — a gloriously useless WebXR AR toy 🐭🚀
 * ----------------------------------------------------------------------------
 * Loop: rat scurries on your floor -> dog companion (camera-anchored) looks
 * at it and barks when it hides -> rat AI bolts for hiding spots found via
 * the XR hit-test (raised surface = table, vertical scan = pillar/wall) ->
 * tap the rat to CATCH -> swipe up to YEET with cannon-es ragdoll physics.
 *
 * All models are Three.js primitives grouped in buildRatMesh()/buildPetMesh()
 * so you can swap in your own GLTF models later (notes at the bottom).
 * AR needs HTTPS + a WebXR device (Android Chrome/ARCore, or the WebXR API
 * emulator extension on desktop). Preview mode simulates a room locally.
 * ==========================================================================*/

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import * as SFX from './sfx.js';

/* ================================ CONFIG ================================== */

const CFG = {
  rat: {
    speed: 1.1,               // m/s scurry speed
    panicSpeed: 1.9,          // m/s when the user gets close
    radius: 0.09,             // body radius (AI + picking)
    height: 0.14,             // body height above the floor
    fleeDistance: 1.6,        // camera closer than this => panic
    wanderInterval: [1.2, 2.8],
  },
  pet: {
    offset: new THREE.Vector3(0.26, -0.34, -0.62), // screen-space anchor rel. to camera
    maxTilt: THREE.MathUtils.degToRad(35),
    barkInterval: [0.9, 2.2],  // randomized bark cadence
  },
  yeet: {
    minSwipeDist: 0.16,       // normalized screen distance to count as swipe
    throwSpeed: 9.0,
    upBias: 0.45,
    spin: 14,
  },
  world: {
    roomRadius: 3.2,          // wander bounds around the user
    hideProbeMaxDist: 3.0,    // how far the rat will run to hide
  },
};

const State = Object.freeze({
  SPAWNING: 'SPAWNING',
  RUNNING: 'RUNNING',
  CAUGHT: 'CAUGHT',
  YEETED: 'YEETED',
});

/* ============================== THREE SETUP =============================== */

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 40);

/** The camera actually used this frame: XR camera while presenting. */
function activeCamera() {
  return renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
}

/* Pet anchor lives directly in the scene; every frame we manually pin it
 * near the active camera (yaw-only so it doesn't tumble with the phone). */
const petAnchor = new THREE.Group();
scene.add(petAnchor);

/* ============================== UI HELPERS ================================ */

const el = {
  score: document.getElementById('score'),
  badge: document.getElementById('badge'),
  hint: document.getElementById('hint'),
  startOverlay: document.getElementById('startOverlay'),
  btnAR: document.getElementById('btnAR'),
  btnPreview: document.getElementById('btnPreview'),
};

let score = 0;
const setHint = (t) => (el.hint.textContent = t);
const setBadge = (t) => (el.badge.textContent = t || '');

function popup(text, x = innerWidth / 2, y = innerHeight * 0.45, color = '#ffd166') {
  const p = document.createElement('div');
  p.className = 'popup';
  p.textContent = text;
  p.style.cssText += `left:${x}px; top:${y}px; color:${color}`;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1200);
}

/* ============================== GAME STATE ================================ */

const G = {
  mode: null,                 // 'ar' | 'preview'
  state: State.SPAWNING,
  rat: null,
  pet: null,
  hidingSpots: [],            // { key, point, kind }
  cameraWorldPos: new THREE.Vector3(),
  reticle: null,
  placementReady: false,
  lastHitPose: null,
  hitTestSource: null,
  scan: { last: null, samples: [] }, // vertical-surface accumulator
  yeetWatch: null,
};

/* ============================ PHYSICS (cannon-es) ========================== */

const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
physics.broadphase = new CANNON.SAPBroadphase(physics);

const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
physics.addBody(groundBody);

const ratBody = new CANNON.Body({
  mass: 1.2,
  shape: new CANNON.Sphere(CFG.rat.radius),
  type: CANNON.Body.KINEMATIC,   // hand-driven until the yeet makes it DYNAMIC
  linearDamping: 0.35,
  angularDamping: 0.6,
});
physics.addBody(ratBody);

/* MEME IMPACT: the random meme sound + fullscreen image fire at the exact
 * moment the yeeted rat SMACKS into the ground (or furniture), not at launch.
 * One trigger per flight; ignores soft grazes below 1 m/s impact speed.     */
ratBody.addEventListener('collide', (e) => {
  if (G.state !== State.YEETED || G.impactPlayed) return;
  const impactV = Math.abs(e.contact?.getImpactVelocityAlongNormal?.() ?? 0);
  if (impactV < 1.0) return;
  G.impactPlayed = true;
  flashRandomMeme();        // surprise fullscreen meme on impact 🖼️
});

/* ============================ MESH BUILDERS =============================== */
/* Swap these internals for GLTF models; keep origin/foot + facing:
 * rat faces +X, origin at feet; pet faces +Z, origin at body center.      */

function buildRatMesh() {
  const g = new THREE.Group();
  const brown = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xf2a3b3, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(CFG.rat.radius, 0.12, 4, 10), brown);
  body.rotation.z = Math.PI / 2;
  body.position.y = CFG.rat.height;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), brown);
  head.position.set(0.16, CFG.rat.height, 0);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.07, 8), pink);
  snout.rotation.z = -Math.PI / 2;
  snout.position.set(0.22, CFG.rat.height - 0.005, 0);
  g.add(snout);

  for (const z of [-0.045, 0.045]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), pink);
    ear.scale.set(1, 1.2, 0.5);
    ear.position.set(0.13, CFG.rat.height + 0.07, z);
    g.add(ear);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const z of [-0.03, 0.03]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), eyeMat);
    eye.position.set(0.19, CFG.rat.height + 0.02, z);
    g.add(eye);
  }

  const tailPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    tailPts.push(new THREE.Vector3(
      -CFG.rat.radius - t * 0.22,
      CFG.rat.height - 0.02 + Math.sin(t * Math.PI) * 0.05,
      Math.sin(t * Math.PI * 2) * 0.02
    ));
  }
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 12, 0.012, 6, false),
    pink
  );
  g.add(tail);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  g.add(shadow);
  return g;
}

function buildPetMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.6 });
  const tan = new THREE.MeshStandardMaterial({ color: 0xd8a15a, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), white);
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.12), white);
  head.position.set(0, 0.09, 0.14);
  g.add(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), tan);
  snout.position.set(0, 0.06, 0.21);
  g.add(snout);

  for (const x of [-0.05, 0.05]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.02), dark);
    ear.position.set(x, 0.15, 0.13);
    g.add(ear);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const x of [-0.035, 0.035]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeMat);
    eye.position.set(x, 0.10, 0.205);
    g.add(eye);
  }
  for (const x of [-0.06, 0.06]) for (const z of [-0.07, 0.07]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.035), white);
    leg.position.set(x, -0.08, z);
    g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), tan);
  tail.position.set(0, 0.04, -0.15);
  tail.name = 'petTail';
  g.add(tail);
  return g;
}

function buildReticle() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.10, 0.13, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6ee7a0, transparent: true, opacity: 0.9, depthWrite: false })
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.02, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6ee7a0, depthWrite: false })
  );
  dot.position.y = 0.002;
  g.add(ring, dot);
  g.visible = false;
  return g;
}

function buildBarkLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '900 64px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 8;
  ctx.strokeText('WOOF!', 128, 64);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('WOOF!', 128, 64);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })
  );
  sprite.scale.set(0.24, 0.12, 1);
  sprite.position.set(0, 0.30, 0);
  sprite.renderOrder = 999;
  sprite.visible = false;
  return sprite;
}

/* ============================== PET / RAT INIT ============================ */

function initPet() {
  if (G.pet) return;
  const group = new THREE.Group();
  const dog = buildPetMesh();
  const bark = buildBarkLabel();
  group.add(dog, bark);
  petAnchor.add(group);
  G.pet = { group, dog, barkLabel: bark, barkTimer: 1, barkPhase: 0 };
}

function createRat(position) {
  const group = new THREE.Group();
  const mesh = buildRatMesh();
  group.add(mesh);
  group.position.copy(position);
  scene.add(group);

  ratBody.type = CANNON.Body.KINEMATIC;
  ratBody.velocity.setZero();
  ratBody.angularVelocity.setZero();
  ratBody.position.set(position.x, position.y + CFG.rat.height, position.z);

  G.rat = {
    group, mesh,
    vel: new THREE.Vector3(),
    wanderTimer: 0,
    wanderDir: new THREE.Vector3(1, 0, 0),
    hiding: false,
    hideTarget: null,
    squeakPhase: Math.random() * 10,
  };
  G.state = State.RUNNING;
  G.placementReady = false;
  if (G.reticle) G.reticle.visible = false;
  SFX.spawnPop();
  setHint('Follow the dog’s gaze 👀 — corner the rat, then TAP it!');
}

function respawnRat() {
  if (G.rat) { scene.remove(G.rat.group); G.rat = null; }
  G.state = State.SPAWNING;
  if (G.mode === 'ar') {
    setHint('Point at the floor — tap the green ring to spawn a rat 🐭');
    if (G.reticle) G.reticle.visible = false; // shown when a hit lands
  } else {
    createRat(new THREE.Vector3(0, 0, 0)); // preview: room center
  }
}

/* ============================== MUTE BUTTON =============================== */

const muteBtn = document.createElement('div');
muteBtn.textContent = '🔊';
muteBtn.style.cssText =
  'position:fixed;left:14px;bottom:calc(18px + env(safe-area-inset-bottom));' +
  'font-size:22px;z-index:12;cursor:pointer;background:#0007;padding:8px 12px;' +
  'border-radius:12px;user-select:none;-webkit-user-select:none;';
document.body.appendChild(muteBtn);
muteBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const m = SFX.toggleMute();
  muteBtn.textContent = m ? '🔇' : '🔊';
});

/* ====================== RANDOM MEME IMAGE FLASH =========================== */
/* Every YEET flashes a random fullscreen image for ~1.5 s (matching the random
 * throw sound). Add/remove files in MEME_IMAGES; they sit next to index.html.
 * Never repeats the same image twice in a row.                              */

const MEME_IMAGES = [
  '9c6738bf74f94adf5ed0f9e4170cbf2d.jpg',
  'OIP (1).webp',
  'OIP (2).webp',
  'OIP (3).webp',
  'OIP (4).webp',
  'OIP (5).webp',
  'OIP (6).webp',
  'OIP.webp',
];

const memeFlash = document.getElementById('memeFlash');
const memeImg = memeFlash.querySelector('img');
let lastMemeIdx = -1;
let memeTO = null;

/** Flash a random meme image fullscreen for ~1.5 seconds. */
function flashRandomMeme() {
  let idx = Math.floor(Math.random() * MEME_IMAGES.length);
  if (idx === lastMemeIdx && MEME_IMAGES.length > 1) idx = (idx + 1) % MEME_IMAGES.length;
  lastMemeIdx = idx;
  memeImg.src = MEME_IMAGES[idx];
  memeFlash.classList.add('show');
  clearTimeout(memeTO);
  memeTO = setTimeout(() => memeFlash.classList.remove('show'), 1500);
}

/* =========================== HIDING SPOTS ================================= */
/* AR: registered while you scan the room with the camera (hit-test based):
 *  - a hit landing higher than 15 cm off the floor => raised surface (TABLE)
 *  - hits whose x/z stays put while y sweeps > 25 cm => vertical (PILLAR/WALL)
 * Preview: synthesized around fake furniture.                               */

function registerHidingSpot(point, kind) {
  const key = `${Math.round(point.x * 10)},${Math.round(point.z * 10)}`;
  if (G.hidingSpots.some((s) => s.key === key)) return;
  G.hidingSpots.push({ key, point: point.clone().setY(0), kind });
  setBadge(`🧠 ${G.hidingSpots.length} hiding spot${G.hidingSpots.length > 1 ? 's' : ''}`);
}

/** Best spot: near the rat, far from the user; tables are comfier. */
function chooseHideSpot() {
  if (!G.hidingSpots.length || !G.rat) return null;
  let best = null, bestScore = -Infinity;
  for (const s of G.hidingSpots) {
    const dRat = s.point.distanceTo(G.rat.group.position);
    if (dRat > CFG.world.hideProbeMaxDist) continue;
    const dUser = s.point.distanceTo(G.cameraWorldPos);
    const score = (CFG.world.hideProbeMaxDist - dRat) * 1.2 + dUser * 0.8
      + (s.kind === 'table' ? 0.5 : s.kind === 'pillar' ? 0.3 : 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/* ============================ RAT AI UPDATE =============================== */

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function smoothAngle(from, to, t) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, t);
}

function updateRat(dt) {
  const rat = G.rat;
  if (!rat) return;
  const pos = rat.group.position;
  const distToCam = pos.distanceTo(G.cameraWorldPos);
  const panicked = distToCam < CFG.rat.fleeDistance;

  // Decide when to bolt for a hiding spot
  rat.wanderTimer -= dt;
  if (panicked && !rat.hiding && G.hidingSpots.length && Math.random() < 0.7) {
    const spot = chooseHideSpot();
    if (spot) {
      rat.hiding = true;
      rat.hideTarget = spot;
      SFX.panicSqueak();
      setHint('🙈 The rat is hiding! Your dog knows where… 👀');
    }
  }
  if (rat.hiding && rat.hideTarget) {
    if (pos.distanceTo(rat.hideTarget.point) < 0.18 && distToCam < 0.8) {
      // cornered at its spot: bolt to another one (or wander if none)
      const other = chooseHideSpot();
      if (other && other.point.distanceTo(pos) > 0.4) rat.hideTarget = other;
      else { rat.hiding = false; rat.hideTarget = null; rat.wanderTimer = 0; }
    }
  }

  // Steering: hide-target > wander (away-biased random walk)
  let speed = panicked ? CFG.rat.panicSpeed : CFG.rat.speed;
  let desired = _v1.set(0, 0, 0);
  if (rat.hiding && rat.hideTarget) {
    desired.subVectors(rat.hideTarget.point, pos).setY(0);
    if (desired.lengthSq() < 0.002) desired.set(0, 0, 0);
  } else {
    if (rat.wanderTimer <= 0) {
      const away = _v2.subVectors(pos, G.cameraWorldPos).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize();
      _q1.setFromAxisAngle(Y_AXIS, (Math.random() - 0.5) * Math.PI * 1.2);
      rat.wanderDir.copy(away).applyQuaternion(_q1).normalize();
      rat.wanderTimer = THREE.MathUtils.lerp(CFG.rat.wanderInterval[0], CFG.rat.wanderInterval[1], Math.random());
    }
    desired.copy(rat.wanderDir);
  }

  if (desired.lengthSq() > 0) {
    desired.normalize().multiplyScalar(speed);
    rat.vel.lerp(desired, Math.min(1, dt * 6));
  } else {
    rat.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
  }

  pos.addScaledVector(rat.vel, dt);

  // Keep inside play radius; bounce if outside
  const rFlat = Math.hypot(pos.x, pos.z);
  if (rFlat > CFG.world.roomRadius) {
    pos.x *= CFG.world.roomRadius / rFlat;
    pos.z *= CFG.world.roomRadius / rFlat;
    rat.wanderDir.multiplyScalar(-1);
    rat.wanderTimer = 0;
  }
  pos.y = 0;

  // Visuals: face movement direction (model faces +X => yaw = atan2(-z, x))
  if (rat.vel.lengthSq() > 0.001) {
    const yaw = Math.atan2(-rat.vel.z, rat.vel.x);
    rat.group.rotation.y = smoothAngle(rat.group.rotation.y, yaw, dt * 10);
  }
  rat.squeakPhase += dt * (4 + rat.vel.length() * 4);
  rat.mesh.position.y = Math.abs(Math.sin(rat.squeakPhase)) * 0.03 * (rat.hiding ? 0.3 : 1);

  // Random idle squeaks while scurrying — the rat never shuts up
  rat.squeakSoundTimer = (rat.squeakSoundTimer || 0) - dt;
  if (rat.squeakSoundTimer <= 0 && rat.vel.lengthSq() > 0.01) {
    rat.squeakSoundTimer = 0.5 + Math.random() * 1.6;
    SFX.squeak(panicked ? 1.35 : 1);
  }

  // Keep kinematic body in sync (used for pick point + yeet handoff)
  ratBody.position.set(pos.x, pos.y + CFG.rat.height, pos.z);
  ratBody.velocity.set(rat.vel.x, 0, rat.vel.z);
}

/* ============================ PET AI UPDATE =============================== */

const _e1 = new THREE.Euler(), _q2 = new THREE.Quaternion();
const _offset = new THREE.Vector3();

/** Pin petAnchor near the active camera, yaw-only (no phone-pitch tumbling). */
function updatePetAnchor() {
  const cam = activeCamera();
  cam.getWorldPosition(_v1);
  cam.getWorldQuaternion(_q1);
  const yaw = _e1.setFromQuaternion(_q1, 'YXZ').y;
  _q2.setFromAxisAngle(Y_AXIS, yaw);
  petAnchor.quaternion.copy(_q2);
  petAnchor.position.copy(_v1).add(_offset.copy(CFG.pet.offset).applyQuaternion(_q2));
}

const _petWorld = new THREE.Vector3(), _ratPos = new THREE.Vector3(), _dir = new THREE.Vector3();

function updatePet(dt, time) {
  const pet = G.pet, rat = G.rat;
  if (!pet || !rat) return;

  pet.group.getWorldPosition(_petWorld);
  _ratPos.copy(rat.group.position);
  _dir.subVectors(_ratPos, _petWorld);

  const dist = _dir.length();
  const ratHidden = rat.hiding || dist > 2.6;

  // LOOK-AT CONTROLLER: yaw toward the rat (+Z is the dog's face), pitch clamp
  const worldYawToRat = Math.atan2(_dir.x, _dir.z);
  const anchorYaw = _e1.setFromQuaternion(petAnchor.quaternion, 'YXZ').y;
  const flatDist = Math.hypot(_dir.x, _dir.z);
  const pitch = ratHidden ? 0 : Math.atan2(_dir.y, flatDist);
  pet.group.rotation.set(
    THREE.MathUtils.clamp(pitch, -CFG.pet.maxTilt, CFG.pet.maxTilt),
    worldYawToRat - anchorYaw,
    0
  );

  // BARKING CUE: randomized pulses + WOOF sprite while the rat is hidden
  pet.barkTimer -= dt;
  if (pet.barkTimer <= 0) {
    pet.barkTimer = THREE.MathUtils.lerp(CFG.pet.barkInterval[0], CFG.pet.barkInterval[1], Math.random());
    if (ratHidden) {
      pet.barkPhase = 1;
      SFX.bark();
      pet.barkLabel.visible = true;
      clearTimeout(pet.barkTO);
      pet.barkTO = setTimeout(() => (pet.barkLabel.visible = false), 450);
    }
  }
  if (pet.barkPhase > 0) {
    pet.barkPhase = Math.max(0, pet.barkPhase - dt * 2.5);
    pet.group.scale.setScalar(1 + Math.sin(pet.barkPhase * Math.PI) * 0.22);
  } else {
    pet.group.scale.lerp(_v1.set(1, 1, 1), Math.min(1, dt * 6));
  }

  // Tail wag: slow & alert when hidden, excited blur when the rat is visible
  const tail = pet.dog.getObjectByName('petTail');
  if (tail) tail.rotation.y = Math.sin(time * (ratHidden ? 3 : 14)) * 0.6;
}

/* ======================= CATCH (raycast) & YEET =========================== */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _pickSphere = new THREE.Sphere();

function tryCatch(clientX, clientY) {
  if (G.state !== State.RUNNING || !G.rat) return false;
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, activeCamera());
  _pickSphere.center.copy(G.rat.group.position).setY(CFG.rat.height);
  _pickSphere.radius = CFG.rat.radius * 2.4;
  if (!raycaster.ray.intersectsSphere(_pickSphere)) return false;

  G.state = State.CAUGHT;
  G.rat.hiding = false;
  G.rat.hideTarget = null;
  SFX.boing();
  popup('CAUGHT! 🐭✊', clientX, clientY, '#6ee7a0');
  setHint('Got it! Now SWIPE UP fast to YEET it 🚀');
  if (navigator.vibrate) navigator.vibrate(80);
  return true;
}

/** Gaze-based catch fallback (XR "select" without dom-overlay / emulator). */
function tryGazeCatch() {
  if (G.state !== State.RUNNING || !G.rat) return;
  const cam = activeCamera();
  cam.getWorldPosition(_v1);
  cam.getWorldDirection(_v2);
  _dir.subVectors(_pickSphere.center.copy(G.rat.group.position).setY(CFG.rat.height), _v1);
  const dist = _dir.length();
  if (dist > 2.5) return;
  _dir.normalize();
  if (_dir.dot(_v2) < 0.978) return; // ~ within 12° of gaze
  G.state = State.CAUGHT;
  G.rat.hiding = false;
  SFX.boing();
  popup('CAUGHT! 🐭✊', innerWidth / 2, innerHeight / 2, '#6ee7a0');
  setHint('Now SWIPE UP to yeet! (or tap/select again to throw)');
  if (navigator.vibrate) navigator.vibrate(80);
}

/* ---- Swipe gesture tracking (works for both dom-overlay taps and preview) */
const swipe = { active: false, id: null, startX: 0, startY: 0, endX: 0, endY: 0, startTime: 0 };

function onPointerDown(e) {
  swipe.active = true;
  swipe.id = e.pointerId;
  swipe.startX = swipe.endX = e.clientX;
  swipe.startY = swipe.endY = e.clientY;
  swipe.startTime = performance.now();
}

function onPointerMove(e) {
  if (!swipe.active || e.pointerId !== swipe.id) return;
  swipe.endX = e.clientX;
  swipe.endY = e.clientY;
}

function onPointerUp(e) {
  if (!swipe.active || e.pointerId !== swipe.id) { swipe.active = false; return; }
  swipe.active = false;

  const dx = swipe.endX - swipe.startX;
  const dy = swipe.endY - swipe.startY;
  const distNorm = Math.hypot(dx, dy) / Math.max(innerWidth, innerHeight);
  const duration = (performance.now() - swipe.startTime) / 1000;

  if (G.state === State.RUNNING) {
    if (distNorm < 0.04 && duration < 0.35) tryCatch(e.clientX, e.clientY);
    return;
  }
  if (G.state === State.CAUGHT) {
    if (distNorm >= CFG.yeet.minSwipeDist) yeet(dx, dy);
    else setHint('A tiny flick won’t do it — SWIPE UP! 🚀');
  }
}

/** THE YEET: swipe direction -> camera-relative launch, then cannon-es flight. */
const _forward = new THREE.Vector3(), _right = new THREE.Vector3();

function yeet(dx = 0, dy = -innerHeight * 0.5) {
  if (!G.rat || G.state !== State.CAUGHT) return;
  G.state = State.YEETED;
  const cam = activeCamera();

  cam.getWorldDirection(_v1);
  _forward.copy(_v1).setY(0).normalize();
  _right.crossVectors(_forward, Y_AXIS).normalize();

  const launch = new THREE.Vector3()
    .addScaledVector(_right, dx / innerWidth)
    .addScaledVector(_forward, -dy / innerHeight)
    .normalize()
    .multiplyScalar(CFG.yeet.throwSpeed)
    .add(new THREE.Vector3(0, CFG.yeet.upBias * CFG.yeet.throwSpeed, 0));

  ratBody.type = CANNON.Body.DYNAMIC;
  ratBody.wakeUp();
  G.impactPlayed = false;   // arm the meme impact trigger for this flight
  ratBody.position.set(G.rat.group.position.x, G.rat.group.position.y + CFG.rat.height, G.rat.group.position.z);
  ratBody.velocity.set(launch.x, launch.y, launch.z);
  ratBody.angularVelocity.set(
    (Math.random() - 0.5) * CFG.yeet.spin,
    (Math.random() - 0.5) * CFG.yeet.spin,
    (Math.random() - 0.5) * CFG.yeet.spin
  );

  if (navigator.vibrate) navigator.vibrate([40, 40, 120]);
  SFX.playThrowSound();     // meme clip fires INSTANTLY on the throw gesture 🎁
  popup('YEEEEET! 🚀🐭', swipe.endX, swipe.endY);
  setHint('🚀🐭💨 …waiting for the mess to settle…');
  G.yeetWatch = { settle: 0, elapsed: 0 };
}

function updateYeet(dt) {
  if (G.state !== State.YEETED || !G.rat) return;
  G.yeetWatch.elapsed += dt;
  const speed = ratBody.velocity.length();
  if (speed < 0.6 && ratBody.position.y < 0.3) {
    G.yeetWatch.settle += dt;
    if (G.yeetWatch.settle > 0.7) return scoreYeet();
  } else {
    G.yeetWatch.settle = 0;
  }
  if (G.yeetWatch.elapsed > 6) scoreYeet(); // flew into the void
}

function scoreYeet() {
  SFX.splat();                    // landing thud + dizzy squeaks
  SFX.jingle(0.35);               // ta-da fanfare right after the splat
  score++;
  el.score.textContent = `🚀 Yeeted: ${score}`;
  popup('+1 YEET 🐭', undefined, undefined, '#6ee7a0');
  if (navigator.vibrate) navigator.vibrate(60);
  respawnRat();
}

/* ====================== AR SESSION & HIT-TEST SETUP ======================= */

async function startAR() {
  SFX.init(); // must happen inside this user gesture
  const supported = navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  if (!supported) {
    popup('AR unsupported — preview mode 💻');
    return startPreview();
  }

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local-floor'],
      optionalFeatures: ['dom-overlay', 'plane-detection'],
      domOverlay: { root: document.getElementById('hud') },
    });
  } catch (err) {
    console.warn('AR session failed:', err);
    popup('AR refused — preview mode 💻');
    return startPreview();
  }

  G.mode = 'ar';
  el.startOverlay.style.display = 'none';
  setBadge('📱 AR');
  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  G.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  G.reticle = buildReticle();
  scene.add(G.reticle);
  initPet();
  respawnRat();

  // XR "select" (taps on phones without dom-overlay, emulator clicks):
  session.addEventListener('select', () => {
    if (G.state === State.SPAWNING && G.placementReady && G.lastHitPose) {
      createRat(G.lastHitPose.clone());
    } else if (G.state === State.RUNNING) {
      tryGazeCatch();
    } else if (G.state === State.CAUGHT) {
      yeet(0, -innerHeight * 0.6); // default forward-up throw
    }
  });

  session.addEventListener('end', () => location.reload());
}

/** Per-frame hit-test: reticle placement while SPAWNING, room scan otherwise. */
function updateARHitTest(frame, refSpace) {
  if (!G.hitTestSource || !G.reticle) return;
  const results = frame.getHitTestResults(G.hitTestSource);
  if (!results.length) {
    if (G.state === State.SPAWNING) { G.reticle.visible = false; G.placementReady = false; }
    G.scan.last = null;
    return;
  }
  const pose = results[0].getPose(refSpace);
  if (!pose) return;
  const p = pose.transform.position;
  const hit = new THREE.Vector3(p.x, p.y, p.z);

  if (G.state === State.SPAWNING) {
    G.lastHitPose = hit.clone();
    G.reticle.position.copy(hit);
    G.reticle.visible = true;
    G.placementReady = true;
    return;
  }

  // While playing, keep learning the room from the center-of-screen hit:
  // raised hit => table (hide under); stationary x/z while y sweeps => pillar.
  if (hit.y > 0.15) {
    registerHidingSpot(hit, 'table');
  } else {
    const s = G.scan;
    if (s.last && Math.hypot(hit.x - s.last.x, hit.z - s.last.z) < 0.12 && Math.abs(hit.y - s.last.y) > 0.03) {
      s.samples.push(hit.clone());
      const ys = s.samples.map((v) => v.y);
      if (Math.max(...ys) - Math.min(...ys) > 0.25 && s.samples.length > 5) {
        registerHidingSpot(hit.clone().setY(0), 'pillar');
        s.samples.length = 0;
      }
    } else if (!s.last || Math.hypot(hit.x - s.last.x, hit.z - s.last.z) >= 0.12) {
      s.samples.length = 0; // moved to a new spot; restart the sweep
    }
    s.last = hit.clone();
    if (s.samples.length > 30) s.samples.length = 0;
  }
}

/* ============================= PREVIEW MODE =============================== */

let orbit = null;

function startPreview() {
  SFX.init(); // user gesture: unlock the noise machine
  G.mode = 'preview';
  el.startOverlay.style.display = 'none';
  setBadge('💻 Preview');

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x40465a, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(2, 4, 1);
  scene.add(dir);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(CFG.world.roomRadius, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2c3142, roughness: 1 })
  );
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4258, roughness: 0.9 });

  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.0, 0.35), wallMat);
  pillar.position.set(-1.2, 1.0, -1.0);
  scene.add(pillar);

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.8), wallMat);
  tableTop.position.set(1.4, 0.62, -0.6);
  scene.add(tableTop);
  for (const [x, z] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), wallMat);
    leg.position.set(1.4 + x, 0.3, -0.6 + z);
    scene.add(leg);
  }

  // Same "hiding spots" AR would discover: behind the pillar, under the table
  registerHidingSpot(new THREE.Vector3(-1.2, 0, -1.32), 'pillar');
  registerHidingSpot(new THREE.Vector3(-1.2, 0, -0.68), 'pillar');
  registerHidingSpot(new THREE.Vector3(1.4, 0, -0.6), 'table');

  camera.position.set(0, 1.55, 2.2);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0.4, 0);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 0.3;
  orbit.maxDistance = 8;

  initPet();
  respawnRat();
  setHint('💻 Preview: drag to look, wheel to zoom. Close in to panic the rat; TAP to catch; SWIPE UP to yeet!');
}

/* ============================ MAIN RENDER LOOP ============================ */

const clock = new THREE.Clock();
const _carry = new THREE.Vector3();

renderer.setAnimationLoop((timestamp, xrFrame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Track the user's head position
  activeCamera().getWorldPosition(G.cameraWorldPos);

  // AR: reticle + room scanning
  if (renderer.xr.isPresenting && xrFrame && G.hitTestSource) {
    updateARHitTest(xrFrame, renderer.xr.getReferenceSpace());
  }

  // Pet anchor follows the camera; pet looks at the rat
  updatePetAnchor();
  if (G.pet && G.rat && G.state !== State.YEETED) updatePet(dt, t);

  // State machine
  if (G.state === State.RUNNING) {
    updateRat(dt);
  } else if (G.state === State.CAUGHT && G.rat) {
    // Rat dangles in front of the camera, squirming
    const cam = activeCamera();
    cam.getWorldPosition(_v1);
    cam.getWorldDirection(_v2);
    _carry.copy(_v1).addScaledVector(_v2, 0.45).add(_offset.set(0.1, -0.12, 0));
    G.rat.group.position.lerp(_carry, Math.min(1, dt * 12));
    G.rat.group.rotation.z = Math.sin(t * 18) * 0.25;
    G.rat.group.rotation.y += dt * 2;
    G.rat.mesh.position.y = 0;
  } else if (G.state === State.YEETED && G.rat) {
    // Ragdoll flight via cannon-es, mesh follows the body
    physics.step(1 / 60, dt, 3);
    G.rat.group.position.set(ratBody.position.x, ratBody.position.y - CFG.rat.height, ratBody.position.z);
    G.rat.group.quaternion.copy(ratBody.quaternion);
    updateYeet(dt);
  }

  if (orbit) orbit.update();
  renderer.render(scene, camera);
});

/* ============================== INPUT WIRING ============================== */

addEventListener('pointerdown', onPointerDown, { passive: true });
addEventListener('pointermove', onPointerMove, { passive: true });
addEventListener('pointerup', onPointerUp, { passive: true });

el.btnAR.addEventListener('click', () => {
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => (ok ? startAR() : (popup('No AR here — preview 💻'), startPreview())));
  } else {
    popup('No WebXR API — preview 💻');
    startPreview();
  }
});
el.btnPreview.addEventListener('click', startPreview);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

console.log('%c🐭 Squeak & Seek loaded.', 'font-weight:bold',
  'WebXR:', navigator.xr ? 'available' : 'not available (use Preview)');

/* ============================================================================
 * SWAPPING IN REAL MODES (GLTF):
 *   buildRatMesh()  -> load your rat GLTF; origin at feet, facing +X.
 *   buildPetMesh()  -> load your dog/cat GLTF; origin at body center, +Z face,
 *                      and name a wagging tail bone/object 'petTail'.
 *   Physics is a single sphere body — swap for a compound shape if you like.
 *   AR hiding spots are learned live from the hit-test scan; preview mode
 *   synthesizes the same structures around fake furniture.
 * ==========================================================================*/
