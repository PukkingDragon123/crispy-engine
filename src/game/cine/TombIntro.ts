// THE WEEPING WALL (new game, STORY-B): the lore title, Sundown's first bounty, and the tomb.
// Played in a private scene (like the Anubis trial) while the run waits behind it:
//   1. LORE      dusk over the dunes, the colossal wall on the horizon; three lines of the tale float up,
//                then SERKET'S REACH rises out of the sand in voxel letters
//   2. BOUNTY    he walks the last of the sand toward the wall: towering fluted cliff, a carved pylon
//                whose five door frames are each turned a little off true, two stone Serkets and two
//                stone scorpions keeping the door, carved cubes half sunk in the sand, shards hanging in air
//   3. THE HALL  inside: torches light themselves as he passes; on an altar at the back, in torchlight,
//                a little scorpion (Pinch) looks at him
//   4. SLAM      the slab drops behind him; the sun goes out
//   5. SERKET    the scorpion lifts on a column of sand, rings of glyphs assemble, and the goddess is built
//                out of the sand from her heart outward, then ignites
//   6. TALK      floating 3D words (she speaks; he answers)
//   7. DOMAIN    she opens her domain: the tomb burns away outward from her in a jade front, the night of
//                her domain is behind it (scorpion constellations), and her stone ring rises round them
// SPACE / ESC / the SKIP label skip to the end. The run-side domain (run/SerketDomain.ts) picks up from
// the same layout. API: `await playTombIntro({ engine, player, from })` (the caller restores the camera).
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Player } from '../player/Player';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { modelEntry } from '../models/lookup';
import * as CH from '../models/characters';
import { FloatText3D, type FloatTextOpts } from '../fx/FloatText3D';
import { Particles } from '../fx/Particles';
import { Voice } from '../audio/Voice';
import { GlyphRings, LightSigil, SandVortex, SerketSpirit, spiritMotes } from '../fx/SerketSpirit';
import { PinchMotion } from '../player/PinchMotion';
import { PINCH_PERCH_SCALE } from '../player/PinchPerch';
import { DrunkGait } from '../anim/drunkWalk';
import { VoxelWord } from './VoxelLetters';
import { realScorpionRig } from '../models/enemies/real/rscorpion';
import { chitin } from '../models/enemies/real/rk';
import { scorpionGirlRig } from '../models/characters/scorpionGirl';
import { buildArena, DomainSky, setMaterial, setUniforms } from './DomainSet';
import { carvedBlock, CHAMBER, pinchAltar, tombChamber, tombCliff, tombDoorSlab, tombGround, tombGroundH, tombPortal, torchSconce } from '../models/props/serketDomain';

export interface TombDeps {
  engine: Engine;
  player: Player;
  /** 'title' plays the lore title first; 'tomb' starts at the walk */
  from?: 'title' | 'tomb';
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (k: number) => k * k * (3 - 2 * k);
const JADE = '#c8ffe4', JADE_GLOW = '#2fd88a';
/** layout (m) */
const FLOOR_Y = 1.5;
const DOOR_Z = -3;
const ALTAR = V(0, FLOOR_Y + 1.0, -23.2);
export const DOMAIN_CENTER = V(0, FLOOR_Y, -14);
const SERKET_SCALE = 1.5;

export async function playTombIntro(d: TombDeps): Promise<{ skipped: boolean }> {
  const eng = d.engine;
  const pl = d.player;
  let skipped = false;
  const skipEl = document.createElement('div');
  skipEl.style.cssText = "position:absolute;right:3vw;bottom:4vh;font-family:'Alagard';font-size:18px;color:#fff3d6;opacity:.7;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #2a1408";
  skipEl.textContent = 'SKIP >';
  skipEl.onpointerdown = (e) => {
    e.stopPropagation();
    skipped = true;
  };
  eng.overlay.append(skipEl);
  let clicked = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Escape') skipped = true;
    if (e.code === 'Enter' || e.code === 'KeyE') clicked = true;
  };
  const onDown = () => (clicked = true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onDown);

  // ------------------------------------------------------------------ the scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, eng.width / Math.max(1, eng.height), 0.08, 1200);
  scene.fog = new THREE.Fog(0xf0bc8a, 70, 460);
  scene.background = new THREE.Color(0xf0b884);
  const hemi = new THREE.HemisphereLight(0xb8c4e0, 0xc88850, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb066, 3.1);
  const sunDir = V(0.55, 0.3, 0.78).normalize();
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = eng.quality.shadows;
  sun.shadow.mapSize.setScalar(Math.min(2048, eng.quality.shadowSize));
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  // a golden-hour sky: warm haze at the horizon, deep blue overhead, the sun's glow
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uK: { value: 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uSun; uniform float uK; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(vec3(1.0, 0.72, 0.48), vec3(0.2, 0.36, 0.66), pow(max(h, 0.0), 0.55));
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += vec3(1.0, 0.62, 0.3) * (pow(s, 6.0) * 0.5 + pow(s, 120.0) * 3.0);
        gl_FragColor = vec4(c * uK, 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  sky.renderOrder = -20;
  scene.add(sky);
  const fx = new Particles();
  fx.groundAt = (x, z) => groundAt(x, z);
  scene.add(fx.group);
  const U = setUniforms(), AU = setUniforms();
  AU.uApp.value = 0;
  const matSet = setMaterial(U), matStone = setMaterial(U, { stone: true }), matArena = setMaterial(AU, { appear: true });
  const geos: THREE.BufferGeometry[] = [];
  const mesh = (m: { model: any; voxelSize: number }, at: THREE.Vector3, pivot: [number, number, number] | 'bottom' | 'center' = [0.5, 0, 0.5], mat: THREE.Material = matSet) => {
    const g = buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot });
    geos.push(g);
    const o = new THREE.Mesh(g, mat);
    o.position.copy(at);
    o.castShadow = true;
    o.receiveShadow = true;
    scene.add(o);
    return o;
  };
  // inside the hall the floor is the chamber's; outside, the dunes
  const groundAt = (x: number, z: number) => (z < DOOR_Z + 0.2 && Math.abs(x) < 6 ? FLOOR_Y : z < 4.3 && z > DOOR_Z && Math.abs(x) < 3.5 ? FLOOR_Y - Math.max(0, z - 0.25) * 0.37 : tombGroundH(x, z));
  mesh(tombCliff(), V(0, 0, 0));
  mesh(tombPortal(), V(0, 0, DOOR_Z), [0.5, 0, 0]);
  mesh(tombChamber(), V(0, FLOOR_Y, DOOR_Z), [0.5, 0, 1]);
  mesh(tombGround(-42, 42, -6, 42, 0.5), V(0, 0, 0), [0.5, 0, 0.5]);
  mesh(tombGround(-100, 100, 42.5, 160, 1), V(0, 0, 0), [0.5, 0, 0.5]);
  const slab = mesh(tombDoorSlab(), V(0, 9.4, DOOR_Z - 0.55), 'bottom');
  slab.visible = false;
  // torches down both walls (they light themselves as he passes)
  const sc = torchSconce();
  const torches: { light: THREE.PointLight; at: THREE.Vector3; on: number; ph: number }[] = [];
  for (const s of [-1, 1])
    for (const tz of [20, 38, 56, 72]) {
      const at = V(s * (CHAMBER.half * CHAMBER.vs - 0.02), FLOOR_Y + 3.2, DOOR_Z - (CHAMBER.corridor + tz) * CHAMBER.vs);
      const o = mesh(sc, at, [0.5, 0, 0.5]);
      o.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      const f = new THREE.Vector3(...sc.flame).applyEuler(o.rotation).add(at);
      let light = torches.find((t) => Math.abs(t.at.z - f.z) < 0.1)?.light;
      if (!light) {
        light = new THREE.PointLight(0xff9440, 0, 13, 1.6);
        light.position.set(0, f.y + 0.3, f.z);
        scene.add(light);
      }
      torches.push({ light, at: f, on: 0, ph: Math.random() * 10 });
    }
  const alt = pinchAltar();
  mesh(alt, ALTAR.clone(), [0.5, 0, 0.5]);
  // statues: the goddess twice, carved from her own likeness, and two stone scorpions
  const stoneRigs: RigInstance[] = [];
  const girl = buildRigGeo(scorpionGirlRig(), 'serket_girl:spirit');
  for (const s of [-1, 1]) {
    const plinth = mesh(carvedBlock(1, 16), V(s * 9.6, 0.7, 1.1), 'center');
    plinth.scale.set(1.7, 0.85, 1.5);
    const r = new RigInstance(girl, { material: matStone, castShadow: true });
    r.root.position.set(s * 9.6, 1.55, 1.1);
    r.root.rotation.y = -s * 0.12;
    r.root.scale.setScalar(3.4);
    const n = r.nodes;
    n.arm_l?.rotation.set(-0.35, 0, 0.8);
    n.fore_l?.rotation.set(-0.55, 0, 0.1);
    n.arm_r?.rotation.set(-0.35, 0, -0.8);
    n.fore_r?.rotation.set(-0.55, 0, -0.1);
    n.head?.rotation.set(0.12, 0, 0);
    scene.add(r.root);
    stoneRigs.push(r);
  }
  const stoneScorp = buildRigGeo(realScorpionRig({ name: 'scorpion_statue', vs: 1 / 36, k: 1.1, shell: chitin(0xa8743a, 0xd8a85a, 1 / 36, 4, { cell: 0.2 }), shellLight: 0xe0b870, dark: 0x5a3a1c, tailTip: 0x6a4420, telson: 0xc08a3a }), 'scorpion_statue');
  for (const s of [-1, 1]) {
    const r = new RigInstance(stoneScorp, { material: matStone, castShadow: true });
    r.root.position.set(s * 17.5, tombGroundH(s * 17.5, 4.5) - 0.1, 4.5);
    r.root.rotation.y = s * 0.4;
    r.root.scale.setScalar(2.1);
    r.nodes.arm_l?.rotation.set(-0.25, 0.2, 0);
    r.nodes.arm_r?.rotation.set(-0.25, -0.2, 0);
    scene.add(r.root);
    stoneRigs.push(r);
  }
  // the strange geometry: carved cubes half sunk on the approach, and shards hanging in the air by the door
  for (const [i, [x, z, sz]] of ([[-8, 12, 18], [11, 18, 24], [-15, 26, 20], [6, 33, 16], [-3, 46, 26], [19, 40, 22]] as const).entries()) {
    const b = mesh(carvedBlock(i + 2, sz), V(x, tombGroundH(x, z) + sz / 8 * 0.2, z), 'center');
    b.rotation.set(0.5 + i * 0.9, i * 1.7, 0.3 + i * 0.6);
  }
  const shards = ([[-5.4, 11.8, 1.4], [5.6, 12.6, 1.2], [0, 18.8, 1.5]] as const).map(([x, y, z], i) => {
    const o = mesh(carvedBlock(9 + i, 10), V(x, y, z), 'center');
    return { o, y, ph: i * 2.1 };
  });
  // the domain waiting behind it all
  const arena = buildArena(scene, DOMAIN_CENTER, matArena);
  arena.rise = 0;
  const night = new DomainSky(scene);
  night.fade = 0;

  // ------------------------------------------------------------------ the actors
  const actor = new RigInstance(pl.rig.geo, { material: pl.material });
  scene.add(actor.root);
  const gun = new RigInstance(pl.gun.geo, { material: pl.material });
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(gun.root);
  if (!actor.attach('hip_r', holder)) actor.nodes['pelvis']?.add(holder);
  const boardOnBack = new THREE.Mesh(pl.boardMesh.geometry, pl.material);
  boardOnBack.castShadow = true;
  const mount = (CH as unknown as { attachBoardOnBack?: (r: RigInstance, b: THREE.Object3D, o?: { material?: THREE.Material }) => THREE.Group | null }).attachBoardOnBack;
  if (!(mount && actor.sockets['board_back'] && mount(actor, boardOnBack, { material: pl.material }))) {
    const sling = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.x = -Math.PI / 2;
    tilt.position.set(0, -0.05, -0.07);
    tilt.add(boardOnBack);
    sling.rotation.z = 0.36;
    sling.add(tilt);
    if (!actor.attach('back', sling)) actor.nodes['torso']?.add(sling);
  }
  actor.setExpression('determined');
  const gait = new DrunkGait(7.7, { weave: 0.08, stumbleEvery: [9, 14] });
  let walkAmt = 0, drawn = 0;
  const pinchSpec = modelEntry('pinch')?.() as RigSpec | undefined;
  const pinch = pinchSpec?.parts ? new RigInstance(buildRigGeo(pinchSpec, 'pinch:tomb'), { material: pl.material, castShadow: true }) : null;
  const pm = pinch ? new PinchMotion(pinch) : null;
  if (pinch) {
    pinch.root.scale.setScalar(PINCH_PERCH_SCALE * 1.35);
    pinch.root.position.copy(ALTAR).add(V(0, alt.top + 0.02, 0.05));
    pinch.root.rotation.y = 0;
    scene.add(pinch.root);
  }
  const spirit = new SerketSpirit(scene, { scale: SERKET_SCALE });
  spirit.root.position.copy(ALTAR).add(V(0, 0.0, 2.2));
  spirit.form = 0;
  spirit.spirit = 0;
  spirit.glow = 0;
  const soulH = spirit.height * SERKET_SCALE;
  const rings = new GlyphRings(scene, [
    { radius: 2.6, y: 0.6, count: 16, speed: 0.6, tilt: [0.06, -0.04] },
    { radius: 3.4, y: 2.2, count: 20, speed: -0.42, tilt: [-0.08, 0.05] },
    { radius: 2.2, y: 3.9, count: 12, speed: 0.8, tilt: [0.1, 0.08] },
  ], 1.5);
  rings.group.position.copy(spirit.root.position);
  rings.appear = 0;
  const sigil = new LightSigil(scene, spirit.root.position.clone(), 0, groundAt, 0.9);
  const vortex = new SandVortex(scene, 900);
  vortex.center.copy(spirit.root.position);
  vortex.bodyH = soulH * 0.92;
  vortex.bodyR = 0.5 * SERKET_SCALE;

  // ------------------------------------------------------------------ the loop
  const texts: FloatText3D[] = [];
  const near = new Map<FloatText3D, () => THREE.Vector3>();
  let speaking: FloatText3D | null = null;
  let speakingAs: 'serket' | 'sundown' | 'pinch' = 'serket';
  let T = 0;
  let last = performance.now();
  const dtCap = +(new URLSearchParams(location.search).get('cinedt') ?? 0.05);
  const camTo = { pos: V(0, 2, 60), look: V(0, 20, 0), fov: 40 };
  const camAt = { pos: camTo.pos.clone(), look: camTo.look.clone(), fov: 40 };
  let camBlend = 0;
  const shot = (pos: THREE.Vector3, look: THREE.Vector3, fov = 40, cut = false) => {
    camTo.pos.copy(pos);
    camTo.look.copy(look);
    camTo.fov = fov;
    if (cut) {
      camAt.pos.copy(pos);
      camAt.look.copy(look);
      camAt.fov = fov;
    }
    camBlend = cut ? 0 : 1;
  };
  let shake = 0;
  const tick = (dt: number) => {
    T += dt;
    camera.aspect = eng.width / Math.max(1, eng.height);
    const k = 1 - Math.exp(-dt * (camBlend ? 6 : 60));
    camAt.pos.lerp(camTo.pos, k);
    camAt.look.lerp(camTo.look, k);
    camAt.fov += (camTo.fov - camAt.fov) * k;
    camera.position.copy(camAt.pos);
    shake = Math.max(0, shake - dt * 1.6);
    if (shake > 0) camera.position.add(V((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, 0));
    camera.lookAt(camAt.look);
    camera.fov = camAt.fov;
    camera.updateProjectionMatrix();
    // Sundown
    gait.update(dt, 6.0, walkAmt);
    gait.pose(actor.nodes, { armL: true, armR: drawn < 0.5, head: false });
    if (drawn > 0) {
      actor.nodes['arm_r']?.rotation.set(-0.35 * drawn, 0, -0.25 * drawn);
      actor.nodes['fore_r']?.rotation.set(-1.05 * drawn, 0, 0);
    }
    actor.root.position.y = groundAt(actor.root.position.x, actor.root.position.z);
    if (actor.nodes['jaw']) actor.nodes['jaw'].rotation.x = actor.exprJaw;
    if (walkAmt > 0.3 && gait.stepped) {
      eng.audio.play('footstep_sand', { volume: 0.35, pitch: (actor.root.position.z < DOOR_Z ? 0.7 : 0.9) + Math.random() * 0.2 });
      const p = actor.root.position;
      if (p.z > DOOR_Z) fx.emit({ pos: { x: p.x, y: p.y + 0.04, z: p.z }, count: 5, spread: 1.1, up: 1.1, life: [0.4, 0.8], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'grain2'], color: [0xf6dfb0, 0xe0b373], gravity: 9, ground: true });
    }
    actor.root.updateMatrixWorld(true);
    pm?.update(dt, { speed: 0, mode: 'idle' });
    // the set breathes: shards hang and turn, torches flicker
    for (const s of shards) {
      s.o.position.y = s.y + Math.sin(T * 0.6 + s.ph) * 0.25;
      s.o.rotation.y += dt * 0.12;
      s.o.rotation.x += dt * 0.05;
    }
    for (const t of torches) {
      const f = 0.82 + 0.12 * Math.sin(T * 13 + t.ph) + 0.08 * Math.sin(T * 29 + t.ph * 2);
      t.light.intensity = t.on * 2.2 * f;
      if (t.on > 0.3 && Math.random() < dt * 22) fx.emit({ pos: { x: t.at.x, y: t.at.y + 0.08, z: t.at.z }, count: 1, spread: 0.12, up: 1.2, life: [0.25, 0.55], size: [0.09, 0.02], sprite: ['glow8', 'spark'], color: [0xffd080, 0xff8a2a], additive: true, drag: 1.5, gravity: -1.5 });
      if (t.on > 0.3 && Math.random() < dt * 3) fx.emit({ pos: { x: t.at.x, y: t.at.y + 0.4, z: t.at.z }, count: 1, spread: 0.1, up: 0.6, life: [1.2, 2.0], size: [0.12, 0.5], sprite: ['puff0', 'puff1'], color: 0x3a2e28, alpha: 0.25, drag: 1, gravity: -0.6, rot: 3 });
    }
    spirit.update(dt);
    rings.update(dt);
    sigil.update();
    vortex.update(dt, scene.fog as THREE.Fog);
    arena.update(dt, T);
    night.update(camera);
    sky.position.copy(camera.position);
    fx.update(dt, scene.fog as THREE.Fog);
    for (const t of texts) {
      const at = near.get(t);
      if (at) {
        const w = at();
        t.anchor.copy(camera.position).addScaledVector(w.sub(camera.position).normalize(), 3.4);
      }
      t.update(dt, camera, t === speaking ? (c, i, s) => Voice.syllable(speakingAs, c, { index: i, text: s }) : undefined);
    }
    clicked = false;
  };
  const frame = async () => {
    await eng.tweens.wait(0.016, true);
    while ((window as any).__cineHold && !skipped) await eng.tweens.wait(0.016, true);
    const now = performance.now();
    const dt = Math.min(dtCap, (now - last) / 1000);
    last = now;
    tick(dt);
    return dt;
  };
  const runFor = async (dur: number, fn: (k: number, t: number, dt: number) => void = () => {}) => {
    let t = 0;
    while (!skipped && t < dur) {
      const dt = await frame();
      t += dt;
      fn(Math.min(1, t / dur), t, dt);
    }
  };
  const text = (s: string, o: FloatTextOpts, at: () => THREE.Vector3) => {
    const t = new FloatText3D(s, o);
    scene.add(t.mesh);
    texts.push(t);
    near.set(t, at);
    return t;
  };
  const head = () => actor.root.position.clone().add(V(0, 2.05, 0));
  const say = async (who: 'serket' | 'sundown' | 'pinch', line: string, hold = 1.2) => {
    if (skipped) return;
    const at =
      who === 'serket'
        ? () => spirit.root.position.clone().add(V(0, soulH * 0.92, 0)).addScaledVector(camRight(), -1.1)
        : who === 'pinch'
          ? () => (pinch ? pinch.root.getWorldPosition(new THREE.Vector3()).add(V(0.2, 0.35, 0)) : head())
          : () => head().addScaledVector(camRight(), 0.35);
    const o: FloatTextOpts = who === 'serket' ? { size: 0.12, color: JADE, glow: JADE_GLOW, cps: 34, wrap: 30, hdr: 1.15 } : who === 'pinch' ? { size: 0.1, color: '#d6ffa8', glow: '#58c81a', cps: 40, wrap: 26, hdr: 1.05 } : { size: 0.11, color: '#fff3d6', glow: '#a86a3a', cps: 38, wrap: 30, hdr: 1.0 };
    const t = text(line, o, at);
    speaking = t;
    speakingAs = who;
    if (who === 'serket') {
      spirit.talking = true;
      eng.audio.play('divine_whisper', { volume: 0.45 });
    }
    while (!skipped && !t.done) {
      await frame();
      if (clicked) t.skipTyping();
    }
    spirit.talking = false;
    await runFor(hold + line.length * 0.014);
    t.show(false);
    speaking = null;
    await runFor(0.15);
  };
  const camRight = () => new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const phase = (n: string) => ((window as any).__tombPhase = n);
  (window as any).__tomb = { scene, camera, spirit, arena, night, U, AU };

  const prevScene = (eng.post as any).renderPass?.scene as THREE.Scene | undefined;
  const prevCam = (eng.post as any).renderPass?.camera as THREE.Camera | undefined;
  eng.post.setSceneCamera(scene, camera);
  eng.letterbox(true, 0.01);
  (window as any).__music?.setMood('intro');
  try {
    // ================================================================ 1. THE LORE
    if ((d.from ?? 'title') === 'title') {
      phase('lore');
      actor.root.visible = false;
      shot(V(4, 2.4, 82), V(0, 24, 0), 38, true);
      tick(0);
      void eng.fadeIn(1.4);
      eng.audio.play('whoosh_big', { volume: 0.4, pitch: 0.5 });
      const lore = [
        'The old gods of Egypt never left the desert. They only learned to wear hats.',
        'In a travellers’ camp a child was born with a scorpion\u2019s tail. At dawn the camp was gone.',
        'The sand raised him. Now he rides it, and he hunts men for money.',
      ];
      const lower = () => camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 6).addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), -1.15);
      for (const [i, line] of lore.entries()) {
        const t = text(line, { size: 0.105, color: '#fff1d8', glow: '#7a4a24', cps: 30, wrap: 46, hdr: 1.0 }, lower);
        await runFor(1.2 + line.length / 30 + 1.4, (k) => {
          const z = 82 - (i + k) * 4;
          shot(V(4 - (i + k) * 0.6, 2.4 - (i + k) * 0.1, z), V(0, 24 - (i + k) * 2, 0), 38);
          if (clicked) t.skipTyping();
        });
        t.show(false);
        await runFor(0.4);
      }
      // the title stands up out of the sand
      phase('title');
      const word = new VoxelWord("SERKET'S REACH", { height: 1.5, style: 'sand', glow: 0.15, castShadow: true });
      word.group.position.set(0, tombGroundH(0, 52), 52);
      word.group.rotation.y = 0.05;
      scene.add(word.group);
      word.plant(groundAt);
      word.enter('rise', 0.07);
      eng.audio.play('sand_rise', { volume: 0.9 });
      eng.audio.play('divine_chime', { volume: 0.5 });
      const sub = text('where the sand remembers every bone', { size: 0.075, color: '#fff3d6', glow: '#8a5a2a', cps: 40, wrap: 60, hdr: 1.0 }, () => V(0, tombGroundH(0, 52) - 0.4, 52.2));
      sub.show(false);
      await runFor(4.6, (k, t, dt) => {
        word.update(dt);
        if (t > 1.6) sub.show(true);
        shot(V(1.2 - k * 1.5, 1.3 + k * 0.4, 61.5 - k * 1.6), V(0, 1.6 + k * 3, 50 - k * 10), 42);
        if (Math.random() < dt * 20) fx.emit({ pos: { x: (Math.random() - 0.5) * 12, y: tombGroundH(0, 52) + 0.1, z: 52 + Math.random() }, count: 2, spread: 1.4, up: 1.6, life: [0.5, 1.1], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'grain2'], color: [0xf6dfb0, 0xe0b373], gravity: 7, ground: true });
      });
      sub.show(false);
      word.leave('sink');
      await runFor(0.8, (_k, _t, dt) => word.update(dt));
      word.dispose();
      word.group.removeFromParent();
      actor.root.visible = true;
    } else void eng.fadeIn(0.8);

    // ================================================================ 2. THE FIRST BOUNTY
    phase('walk');
    actor.root.position.set(1.6, 0, 31);
    actor.root.rotation.y = Math.PI;
    walkAmt = 1;
    // low behind him: the wall towers over a small man in a big hat
    shot(V(3.4, 0.7, 37), V(0, 9, 0), 46, true);
    await runFor(3.4, (k) => {
      actor.root.position.set(1.6 - k * 0.8, 0, 31 - k * 5.6);
      shot(V(3.4 - k * 0.6, 0.7 + k * 0.2, 37 - k * 4.8), V(0, 9 + k * 2, 0), 46);
    });
    // ahead of him at the foot of the steps, looking up past him at the pylon
    actor.root.position.set(0.3, 0, 12);
    shot(V(-2.6, 0.5, 6.2), V(0.2, 3.2, 14), 44, true);
    const walk2 = say('sundown', "No name on this bounty. Just a scorpion pressed in green wax, and enough money to buy a town.", 0.3);
    await runFor(2.6, (k) => actor.root.position.set(0.3 - k * 0.3, 0, 12 - k * 5.2));
    await walk2;
    walkAmt = 0;
    shot(V(-1.8, 1.1, 8.4), V(0, 7.5, -2), 50);
    actor.root.rotation.y = Math.PI;
    actor.setExpression('smug');
    await say('sundown', 'Reckon I got questions.', 0.6);
    // up the steps and into the dark
    phase('steps');
    walkAmt = 0.8;
    shot(V(1.4, 2.0, 11), V(0, 3.2, -4), 42, true);
    await runFor(2.6, (k) => actor.root.position.set(0, 0, 6.6 - k * 9.2));
    // ================================================================ 3. THE HALL
    phase('hall');
    hemi.intensity = 0.16;
    hemi.color.set(0x6a5a70);
    scene.fog = new THREE.Fog(0x140c08, 6, 42);
    actor.setExpression('focus');
    eng.audio.play('door_creak', { volume: 0.3, pitch: 0.6 });
    shot(V(0.9, FLOOR_Y + 1.9, -1.2), V(0, FLOOR_Y + 1.4, -16), 52, true);
    await runFor(4.4, (k) => {
      const z = -2.6 - k * 12.6;
      actor.root.position.set(0, FLOOR_Y, z);
      shot(V(0.9, FLOOR_Y + 1.9, z + 2.6), V(0, FLOOR_Y + 1.2, z - 9), 52);
      // the torches catch one pair at a time as he walks past
      for (const t of torches) {
        if (t.on === 0 && t.at.z > z - 4.5) {
          t.on = 0.01;
          eng.audio.play('whoosh', { volume: 0.4, pitch: 0.9 + Math.random() * 0.2 });
          fx.emit({ pos: t.at, count: 14, spread: 1.2, up: 1.5, life: [0.3, 0.7], size: [0.1, 0.03], sprite: ['spark', 'glow8'], color: [0xffe0a0, 0xff8a2a], additive: true, drag: 2 });
        }
        if (t.on > 0) t.on = Math.min(1, t.on + 0.05);
      }
    });
    for (const t of torches) t.on = 1;
    walkAmt = 0;
    // in the torchlight, on the altar: a little scorpion
    phase('pinch');
    shot(ALTAR.clone().add(V(0.55, alt.top + 0.32, 1.25)), ALTAR.clone().add(V(0, alt.top + 0.08, 0)), 30, true);
    eng.audio.play('scorpion_chitter', { volume: 0.6, pitch: 1.3 });
    pinch?.setExpression('surprised');
    await runFor(1.6);
    await say('pinch', '*click*', 0.3);
    shot(actor.root.position.clone().add(V(1.2, 1.7, 1.6)), ALTAR.clone().add(V(0, 1.2, 0)), 44, true);
    actor.setExpression('smug');
    await say('sundown', "You the bounty, little fella?", 0.4);
    // ================================================================ 4. THE DOOR
    phase('slam');
    shot(V(1.6, FLOOR_Y + 1.6, -13.5), V(0, FLOOR_Y + 3.6, DOOR_Z), 46, true);
    eng.audio.play('quake_rumble', { volume: 0.6, pitch: 1.3 });
    await runFor(0.5);
    slab.visible = true;
    const y0 = slab.position.y;
    let fell = false;
    await runFor(0.75, (k) => {
      slab.position.y = Math.max(FLOOR_Y, y0 - (y0 - FLOOR_Y) * k * k * 1.8);
      if (!fell && slab.position.y <= FLOOR_Y + 0.01) {
        fell = true;
        shake = 1.2;
        eng.audio.play('explosion_big', { volume: 0.7, pitch: 0.55 });
        eng.audio.play('rock_crumble', { volume: 0.9, pitch: 0.7 });
        fx.emit({ pos: { x: 0, y: FLOOR_Y + 0.2, z: DOOR_Z - 0.9 }, count: 40, spread: 5, up: 1.2, life: [0.8, 1.8], size: [0.4, 1.4], sprite: ['puff0', 'puff1', 'puff2'], color: [0xc8a878, 0xa88a60], alpha: 0.5, drag: 2.5, rot: 6 });
        fx.emit({ pos: { x: 0, y: FLOOR_Y + 0.2, z: DOOR_Z - 0.9 }, count: 50, spread: 6, up: 2.5, life: [0.5, 1.1], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'pebble'], color: [0xe0c08a, 0xa08060], gravity: 9, ground: true });
        sun.intensity = 0;
        hemi.intensity = 0.06;
        for (const t of torches) t.on = 0.45;
      }
    });
    for (const t of torches) t.on = 1;
    // he spins round, iron out
    actor.root.rotation.y = 0;
    drawn = 1;
    if (!actor.attach('hand_r', holder)) actor.nodes['fore_r']?.add(holder);
    actor.setExpression('surprised');
    shot(actor.root.position.clone().add(V(-1.5, 1.6, -2.4)), actor.root.position.clone().add(V(0, 1.5, 0)), 44, true);
    eng.audio.play('rev_hammer', { volume: 0.8 });
    await say('sundown', '...Course it does.', 0.4);
    // ================================================================ 5. SERKET
    phase('rise');
    actor.root.rotation.y = Math.PI;
    actor.setExpression('focus');
    const sp = spirit.root.position;
    shot(V(3.6, FLOOR_Y + 1.2, -14.2), sp.clone().add(V(0, 1.4, 0)), 48, true);
    eng.audio.play('divine_chime', { volume: 0.7 });
    eng.audio.play('sand_rise', { volume: 0.9 });
    const pFrom = pinch ? pinch.root.position.clone() : sp.clone();
    const core = sp.clone().add(V(0, soulH * 0.56, 0));
    await runFor(2.2, (k, _t, dt) => {
      // the little scorpion lifts off the altar on a breath of sand, glowing
      if (pinch) {
        pinch.root.position.lerpVectors(pFrom, core, ease(k));
        pinch.root.rotation.y += dt * (2 + k * 8);
      }
      sigil.reveal = ease(k);
      vortex.intensity = k * 0.6;
      vortex.height = 2 + k * 3;
      if (Math.random() < 0.5) spiritMotes(fx, pinch ? pinch.root.position : core, 2, 0.4, 1.2);
    });
    eng.audio.play('whoosh_big', { volume: 0.8 });
    eng.audio.play('spectral_scorpion', { volume: 0.5, pitch: 0.7 });
    await runFor(2.0, (k) => {
      vortex.intensity = 0.6 + k * 0.6;
      vortex.height = 5 + k * 4;
      rings.appear = ease(Math.min(1, k * 1.3));
      const a = k * 0.8;
      shot(sp.clone().add(V(Math.sin(a) * 5.5, 1.0 + k * 1.6, 7.8 - k * 1.2)), sp.clone().add(V(0, 1.6 + k * 1.2, 0)), 46);
      if (pinch) pinch.root.scale.setScalar(PINCH_PERCH_SCALE * 1.35 * (1 - k * 0.6));
    });
    // her body is built out of the sand from her heart outward; the scorpion is her heart
    eng.audio.play('divine_power', { volume: 0.7 });
    await runFor(2.6, (k) => {
      const e = ease(k);
      vortex.gather = e;
      spirit.form = Math.min(1, e * 1.05);
      spirit.glow = 0.4 * e;
      if (pinch) pinch.root.scale.setScalar(PINCH_PERCH_SCALE * 0.54 * (1 - e));
      shot(sp.clone().add(V(2.4 - k * 3.6, 0.6 + k * 0.4, 6.4)), sp.clone().add(V(0, soulH * (0.45 + 0.2 * k), 0)), 44 - k * 6);
    });
    if (pinch) pinch.root.visible = false;
    spirit.form = 1;
    eng.flash(0x9dffc8, 0.7, 0.6);
    eng.audio.play('resurrect', { volume: 0.8 });
    eng.audio.play('spectral_scorpion', { volume: 1 });
    shake = 0.8;
    fx.emit({ pos: { x: sp.x, y: sp.y + soulH * 0.4, z: sp.z }, count: 80, spread: 8, up: 3, life: [0.6, 1.4], size: [0.07, 0.04], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [0xf6dfb0, 0xeccb8f, 0xe0b373], gravity: 9, drag: 0.6, ground: true });
    spiritMotes(fx, { x: sp.x, y: sp.y + soulH * 0.5, z: sp.z }, 40, 1.6, 2.4);
    spirit.setExpression('happy');
    spirit.flick();
    spirit.snip();
    await runFor(1.4, (k) => {
      const e = ease(k);
      spirit.spirit = e;
      spirit.glow = 0.4 + e * 0.6;
      vortex.gather = 1 - e * 0.3;
      vortex.burst = e;
      vortex.intensity = 1.2 * (1 - e);
      sigil.fade = 1 - e * 0.5;
      shot(sp.clone().add(V(-1.8, 0.7 + e * 0.3, 6.6)), sp.clone().add(V(0, soulH * 0.62, 0)), 40);
    });
    vortex.intensity = 0;
    spirit.look = actor.root.position.clone().add(V(0, 1.6, 0));
    spirit.pose = 'open';
    // ================================================================ 6. SHE SPEAKS
    phase('talk');
    const herShot = () => shot(sp.clone().add(V(1.6, soulH * 0.42, 5.4)), sp.clone().add(V(0, soulH * 0.68, 0)), 40);
    const hisShot = () => shot(actor.root.position.clone().add(V(-1.3, 1.55, -2.6)), actor.root.position.clone().add(V(0.3, 1.5, 0)), 42);
    const wide = () => shot(actor.root.position.clone().add(V(2.6, 1.9, 3.4)), sp.clone().add(V(0, soulH * 0.55, 0)), 48);
    wide();
    await say('serket', 'Hello, little stinger. I have waited for you since that dawn by the cold fire.', 0.9);
    hisShot();
    await say('sundown', '...The scorpion talks.', 0.4);
    herShot();
    spirit.pose = 'present';
    spirit.setExpression('smug');
    await say('serket', 'The scorpion is a goddess. Serket. I posted your bounty. A child of my sting, all grown up. Good.', 0.9);
    spirit.setExpression('stern');
    spirit.pose = 'open';
    await say('serket', "Set's storm is eating my sands, and gods may not ride into it. I need a new champion, and you are going to earn it.", 0.9);
    hisShot();
    actor.setExpression('smug');
    await say('sundown', "I don't work for free, ma'am.", 0.4);
    herShot();
    spirit.setExpression('happy');
    spirit.pose = 'beckon';
    spirit.snip();
    await say('serket', 'Then let me see what you are worth. Come into my domain.', 0.5);
    // ================================================================ 7. HER DOMAIN
    phase('domain');
    spirit.pose = 'raise';
    spirit.flick();
    rings.spread = 1.6;
    eng.audio.play('divine_power', { volume: 0.9, pitch: 0.8 });
    eng.audio.play('whoosh_big', { volume: 0.9, pitch: 0.6 });
    U.uOrigin.value.copy(sp).add(V(0, 2, 0));
    AU.uOrigin.value.copy(DOMAIN_CENTER);
    const bg = new THREE.Color(0x140c08), bgNight = new THREE.Color(0x03060c);
    await runFor(5.2, (k, t, dt) => {
      const e = ease(k);
      U.uDis.value = Math.pow(k, 1.6) * 170;
      AU.uApp.value = e * 64;
      arena.rise = Math.min(1, k * 1.25);
      night.fade = Math.min(1, k * 1.6);
      skyMat.uniforms.uK.value = 1 - Math.min(1, k * 2);
      sky.visible = k < 0.5;
      (scene.background as THREE.Color).copy(bg).lerp(bgNight, e);
      const f = scene.fog as THREE.Fog;
      f.color.copy(bg).lerp(new THREE.Color(0x0a1424), e);
      f.near = 6 + e * 30;
      f.far = 42 + e * 160;
      hemi.color.set(0x5068a0);
      hemi.groundColor.set(0x302a34);
      hemi.intensity = 0.06 + e * 0.55;
      sun.color.set(0xa8c0ff);
      sun.position.set(-30, 70, 40);
      sun.intensity = e * 1.1;
      for (const tt of torches) tt.on = 1 - e;
      rings.update(0);
      const a = -0.6 + k * 1.5;
      shot(DOMAIN_CENTER.clone().add(V(Math.sin(a) * (8 + e * 8), 2 + e * 10, Math.cos(a) * (8 + e * 8))), DOMAIN_CENTER.clone().add(V(0, 2.5 - e * 0.5, 0)), 50 + e * 6);
      if (Math.random() < dt * 40) spiritMotes(fx, DOMAIN_CENTER.clone().add(V((Math.random() - 0.5) * 30, Math.random() * 6, (Math.random() - 0.5) * 30)), 1, 1, 2);
      if (t > 0.1 && t < 0.15) shake = 0.5;
    });
    U.uDis.value = 1e4;
    AU.uApp.value = 1e4;
    arena.rise = 1;
    night.fade = 1;
    spirit.pose = 'open';
    rings.spread = 1;
    hisShot();
    actor.setExpression('surprised');
    await say('sundown', "...Now that's a trick.", 0.3);
    wide();
    spirit.setExpression('smug');
    await say('serket', 'No door here but the one I open. Ride for me, shoot for me, bleed a little for me, and I will open it.', 0.6);
  } finally {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onDown);
    skipEl.remove();
    for (const t of texts) t.dispose();
    spirit.dispose();
    rings.dispose();
    sigil.dispose();
    vortex.dispose();
    night.dispose();
    arena.dispose();
    fx.group.removeFromParent();
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && geos.includes((o as THREE.Mesh).geometry)) o.removeFromParent();
    });
    for (const g of geos) g.dispose();
    for (const r of stoneRigs) r.root.removeFromParent();
    matSet.dispose();
    matStone.dispose();
    matArena.dispose();
    skyMat.dispose();
    sun.shadow.map?.dispose();
    if (prevScene && prevCam) eng.post.setSceneCamera(prevScene, prevCam);
    phase('done');
  }
  return { skipped };
}
