// Main menu: dusk in the deep desert. Sundown rests on a driftwood log on a dune crest beside a
// crackling stone fire pit; his sandboard is planted upright in the sand with Pinch perched on top
// (or rides on his back when the rig offers a `board_back` socket). Behind the camp a weathered
// ranch gate carries the cut-out "dustUP" letters against a huge low sun sinking between mesa
// spires. The menu is a signpost of Alagard arrow boards: hover lifts and lights a board, a click
// knocks it; arrows/W/S + Enter work too.
// Alive: pixel flames, sparks and smoke, sand streaming off the crests, duster and scarf in the
// wind, coin flips and revolver spins, Pinch snapping at a firefly, tumbleweeds, circling vultures,
// a painted dusk sky with a crescent moon, stars and shooting stars, and a slow orbiting camera.
// NEW RUN tilts the camera up into the blinding sky (approved transition), then onRide() fires.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, sharedVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { ClothRenderer } from '../../engine/physics/Cloth';
import { Heightfield } from '../world/Heightfield';
import { Terrain } from '../world/Terrain';
import * as PM from '../models/props';
import * as MS from '../models/props/menuSet';
import * as CH from '../models/characters';
import { modelEntry } from '../models/lookup';
import type { Ramp } from '../models/style';
import { Particles, EmitOpts } from '../fx/Particles';
import { Garments } from '../player/Garments';
import { loadSave } from '../meta/Save';
import { Ease } from '../../engine/Tween';
import { clamp, damp, noise } from '../../engine/math/rand';
import { nav } from '../Nav';
import { KnowledgeSign } from './thoth/KnowledgeSign';
import { ThothHall } from './ThothHall';
import { resetTutor } from '../ui/TouchTutor';

type Pivot = [number, number, number] | 'bottom' | 'center';
function vmesh(model: VoxelModel, vs: number, pivot: Pivot = 'bottom', mat: THREE.Material = sharedVoxelMaterial, shadow = true) {
  const m = new THREE.Mesh(buildVoxelGeometry(model, { voxelSize: vs, pivot }), mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const R = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

// ---------------------------------------------------------------- layout (scene metres; camp plateau y ≈ 0)
const FIELD = 416, RES = 0.5, BASE = 40;
const CX = 208, CZ = 352; // scene origin inside the heightfield (centre of a terrain chunk)
const SUN_DIR = new THREE.Vector3(-0.39, 0.07, -0.918).normalize();
const MOON_DIR = new THREE.Vector3(-0.43, 0.19, -0.88).normalize();
const FIRE = new THREE.Vector3(-1.25, 0, 0.75);
const SEAT = { x: 0.05, z: -0.5, yaw: -0.42 };
const BOARD = { x: 1.0, z: -1.05, yaw: -0.25 };
const GATE = { x: -0.45, z: -2.75, yaw: 0.05 };
const POST = { x: 2.45, z: 0.95, yaw: -0.24 };
const CAM_T = new THREE.Vector3(0.45, 1.5, -0.7);
const CAM_DIST = 8.4;
const LABELS = ['NEW RUN', 'RESUME', 'HIDEOUT', 'SETTINGS'];
/** the glowing sign of knowledge (THOTH'S HALL) floats over the dunes left of the camp */
const KSIGN = { x: -1.95, z: 0.3, y: 1.8, yaw: 0.28 };
const brinkZ = (x: number) => -3.1 + Math.sin(x * 0.21 + 0.6) * 0.5 + x * 0.05;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uSun, uMoon, uZen, uHigh, uMid, uLow, uHorSun, uHorAway, uBelow, uSunCol, uCloudLit, uCloudMid, uCloudDark, uMetA, uMetB;
uniform float uTime, uMetT;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = dot(d, uSun);
  float az = dot(normalize(d.xz + vec2(1e-5)), normalize(uSun.xz)) * 0.5 + 0.5;
  float e = max(y, 0.0);
  vec3 hor = mix(uHorAway, uHorSun, pow(az, 2.5));
  vec3 c = mix(hor, uLow, smoothstep(0.0, 0.07, e));
  c = mix(c, uMid, smoothstep(0.05, 0.22, e));
  c = mix(c, uHigh, smoothstep(0.16, 0.45, e));
  c = mix(c, uZen, smoothstep(0.4, 0.95, e));
  float g = max(sd, 0.0);
  c += uSunCol * (pow(g, 6.0) * 0.4 + pow(g, 40.0) * 0.9 + pow(g, 400.0) * 2.5);
  if (y < 0.0) c = mix(hor * 0.95, uBelow, smoothstep(0.0, 0.25, -y));
  // painted cloud bands, lit from below by the sun (three cel tones)
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.06);
    vec2 q = vec2(cp.x * 0.55 + cp.y * 0.2, cp.y * 2.4 - cp.x * 0.3) * 0.54 + vec2(uTime * 0.006, 0.0);
    float f = fbm(q);
    float f2 = fbm(q + normalize(uSun.xz) * 0.22);
    float cov = smoothstep(0.5, 0.68, f) * smoothstep(0.015, 0.09, y) * (1.0 - smoothstep(0.32, 0.6, y));
    float lit = clamp((f - f2) * 7.0 + 0.45 + pow(g, 4.0) * 0.5, 0.0, 1.0);
    float tone = lit < 0.36 ? 0.0 : lit < 0.7 ? 0.5 : 1.0;
    vec3 cl = mix(uCloudDark, uCloudMid, smoothstep(0.0, 0.5, tone));
    cl = mix(cl, uCloudLit, smoothstep(0.5, 1.0, tone));
    cl += uSunCol * pow(g, 10.0) * 1.2 * (0.4 + tone);
    c = mix(c, cl, cov * 0.9);
  }
  // stars in the dark upper sky, away from the sun
  if (y > 0.16) {
    vec3 sp = floor(d * 420.0);
    float s = h31(sp);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + s * 3.0) + s * 60.0);
    float vis = smoothstep(0.16, 0.6, y) * (1.0 - pow(az, 3.0) * 0.85);
    c += vec3(1.0, 0.94, 0.86) * step(0.9972, s) * tw * vis * 1.8;
  }
  // the sun: huge and low, limb-darkened, sliced by the hot air near the horizon
  float sunR = 0.042;
  float ang = acos(clamp(sd, -1.0, 1.0));
  if (ang < sunR) {
    float r = ang / sunR;
    vec3 sc = mix(vec3(1.0, 0.9, 0.66), vec3(1.0, 0.5, 0.18), r * r) * (16.0 - r * r * 9.0);
    float slice = step(0.8, fract((y - uSun.y) * 170.0 + 0.3)) * step(y, uSun.y - sunR * 0.3);
    sc *= 1.0 - slice * 0.6;
    c = mix(c, sc, 1.0 - smoothstep(0.94, 1.0, r));
  }
  // thin crescent moon above the sun (lit limb toward the sun), with earthshine
  if (dot(d, uMoon) > 0.0) {
    vec3 mr = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    vec3 mu = cross(mr, uMoon);
    vec2 q = vec2(dot(d, mr), dot(d, mu)) / 0.024;
    float ql = length(q);
    vec2 s2 = normalize(vec2(dot(uSun, mr), dot(uSun, mu)));
    float disc = 1.0 - smoothstep(0.94, 1.0, ql);
    float lit = disc * smoothstep(0.96, 1.06, length(q + s2 * 0.4));
    float maria = 0.82 + 0.18 * vn(q * 2.5 + 4.0);
    c = mix(c, c * 1.03 + vec3(0.03, 0.04, 0.07), disc * 0.4);
    c = mix(c, vec3(1.0, 0.95, 0.84) * 2.6 * maria, lit);
    c += vec3(1.0, 0.88, 0.72) * exp(-max(ql - 1.0, 0.0) * 1.6) * 0.04 * (1.0 - disc);
  }
  // shooting star
  if (uMetT > 0.0 && uMetT < 1.0) {
    vec3 hd = normalize(mix(uMetA, uMetB, uMetT));
    vec3 td = normalize(mix(uMetA, uMetB, max(0.0, uMetT - 0.28)));
    vec3 ab = hd - td;
    float tt = clamp(dot(d - td, ab) / max(dot(ab, ab), 1e-7), 0.0, 1.0);
    float dist = length(d - (td + ab * tt));
    c += vec3(1.0, 0.95, 0.86) * (1.0 - smoothstep(0.0, 0.0024, dist)) * tt * tt * sin(uMetT * 3.14159) * 7.0;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

interface Plank {
  label: string;
  group: THREE.Group;
  proxy: THREE.Mesh;
  mat: VoxelMaterial;
  restYaw: number;
  restRoll: number;
  hover: number;
  knock: number;
  wasHot: boolean;
}
interface Fly {
  p: THREE.Vector3;
  v: THREE.Vector3;
  phase: number;
  dart: number;
}
interface Weed {
  m: THREE.Mesh;
  r: number;
  x: number;
  z: number;
  x0: number;
  x1: number;
  speed: number;
  on: boolean;
  next: number;
  hop: number;
  far: boolean;
}
type ActKind = 'coin' | 'spin' | 'glance';

export class MenuScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1400);
  ready = false;
  private built = false;
  private particles = new Particles();
  private cloth = new ClothRenderer();
  private garments: Garments | null = null;
  private hf!: Heightfield;
  private terrain: Terrain | null = null;
  private sky!: THREE.Mesh;
  private skyU!: Record<string, THREE.IUniform>;
  private sun!: THREE.DirectionalLight;
  private fireLight!: THREE.PointLight;
  private lanterns: { pivot: THREE.Group; light: THREE.PointLight; phase: number; mesh: THREE.Object3D }[] = [];
  private planks: Plank[] = [];
  /** THOTH'S HALL: the sign, and the hall itself while it is open */
  private ksign: KnowledgeSign | null = null;
  private ksignHot = 0;
  private hall: ThothHall | null = null;
  private ray = new THREE.Raycaster();
  private hot: Plank | null = null;
  private sel = -1;
  private kb = false;
  private lastNdc = new THREE.Vector2(9, 9);
  private hero: RigInstance | null = null;
  private gunSpin = new THREE.Group();
  private heroBase = new THREE.Vector3();
  private head = { yaw: 0, pitch: 0 };
  private act: { kind: ActKind; t: number; flag: number } | null = null;
  private nextAct = 5;
  private lastAct: ActKind | null = null;
  private coin: { m: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; fly: boolean } | null = null;
  private pinch: RigInstance | null = null;
  private perch = new THREE.Object3D();
  private pinchS = { yaw: 0, lunge: 0, snap: 0, cd: 2, twitch: 0, nextTwitch: 3 };
  private flies: Fly[] = [];
  private weeds: Weed[] = [];
  private vultures: { r: RigInstance; phase: number; rad: number; c: THREE.Vector3; flapAt: number }[] = [];
  private crests: THREE.Vector3[] = [];
  private meteor = { start: -1, next: 9, a: new THREE.Vector3(), b: new THREE.Vector3() };
  private acc: Record<string, number> = {};
  private t = 0;
  private gust = 1;
  private mouse = new THREE.Vector2();
  private leaving = false;
  private panel: HTMLDivElement | null = null;
  private msg: HTMLDivElement;
  private wind: { stop(t?: number): void } | null = null;
  private crickets: { stop(t?: number): void } | null = null;
  private postSaved: { bloom?: number; vignette?: number } = {};
  private logFrame = { x: SEAT.x, z: SEAT.z, yaw: SEAT.yaw, top: 0.4 };

  constructor(private engine: Engine, private onRide: () => void) {
    this.msg = document.createElement('div');
  }

  /** ground height (scene metres) */
  private gy = (x: number, z: number) => this.hf.heightAt(x + CX, z + CZ) - BASE;

  /** ms the set took to build (diagnostics) */
  buildMs = 0;

  async enter() {
    const t0 = performance.now();
    const s = this.scene;
    const eng = this.engine;
    this.buildSky();
    this.buildLights();
    this.buildGround();
    s.add(this.particles.group, this.cloth.mesh);
    this.particles.groundAt = this.gy;
    try {
      this.buildCamp();
    } catch (e) {
      console.warn('[menu] camp failed', e);
    }
    try {
      this.buildGateAndSign();
    } catch (e) {
      console.warn('[menu] signage failed', e);
    }
    try {
      this.buildHero();
    } catch (e) {
      console.warn('[menu] hero failed', e);
    }
    try {
      this.buildLife();
    } catch (e) {
      console.warn('[menu] life failed', e);
    }
    // camera
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.placeCamera(0);
    // post: a touch more bloom for the sun, a deeper vignette
    const post: any = eng.post;
    if (post?.bloom) {
      this.postSaved.bloom = post.bloom.strength;
      post.bloom.strength = 0.16;
    }
    if (post?.u?.uVignette) {
      this.postSaved.vignette = post.u.uVignette.value;
      post.u.uVignette.value = 0.4;
    }
    (window as any).__music?.setMood('menu');
    this.wind = eng.audio.loop('wind_loop', 0.32);
    this.crickets = eng.audio.loop('night_loop', 0.12);
    eng.input.setWantLock(false);
    this.msg.style.cssText = "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);font-family:'Alagard';font-size:19px;letter-spacing:1px;color:#fff3d6;text-shadow:0 3px 0 #2a1408,0 0 14px #000;z-index:7;pointer-events:none;opacity:0;transition:opacity .5s;text-align:center";
    eng.overlay.appendChild(this.msg);
    eng.tweens.after(1.2, () => this.say('Click a sign  ·  arrows + Enter'), true);
    this.built = true;
    this.ready = true;
    this.buildMs = Math.round(performance.now() - t0);
  }

  // ================================================================ build
  private buildSky() {
    const col = (h: number) => ({ value: new THREE.Color(h) });
    this.skyU = {
      uSun: { value: SUN_DIR.clone() },
      uMoon: { value: MOON_DIR.clone() },
      uZen: col(0x16214c),
      uHigh: col(0x3b4482),
      uMid: col(0x8c5f8c),
      uLow: col(0xe2826c),
      uHorSun: col(0xffb45c),
      uHorAway: col(0xea967c),
      uBelow: col(0xa45e46),
      uSunCol: col(0xffa048),
      uCloudLit: col(0xffc480),
      uCloudMid: col(0xdc7672),
      uCloudDark: col(0x56446e),
      uMetA: { value: new THREE.Vector3(0, 1, 0) },
      uMetB: { value: new THREE.Vector3(0, 1, 0) },
      uMetT: { value: -1 },
      uTime: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xd08a6c, 28, 380);
    this.scene.background = new THREE.Color(0xd08a6c);
  }

  private buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x7c76c8, 0xc88458, 1.0));
    this.sun = new THREE.DirectionalLight(0xff9a52, 4.0);
    this.sun.position.copy(SUN_DIR).multiplyScalar(70);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -11;
    sc.right = sc.top = 11;
    sc.near = 1;
    sc.far = 220;
    s.add(this.sun, this.sun.target);
    // cool dusk fill from the open sky behind the camera
    const fill = new THREE.DirectionalLight(0x8494ff, 0.35);
    fill.position.set(8, 10, 14);
    s.add(fill);
    // no cube shadow: six extra passes over the near terrain cost more than they show
    this.fireLight = new THREE.PointLight(0xff8236, 9, 0, 2);
    s.add(this.fireLight);
  }

  private buildGround() {
    const hf = new Heightfield(FIELD, RES);
    const bounds = { x0: -CX, x1: FIELD - CX, z0: -CZ, z1: FIELD - CZ };
    for (let j = 0; j < hf.n; j++)
      for (let i = 0; i < hf.n; i++) {
        const k = hf.idx(i, j);
        const g = MS.menuGround(i * RES - CX, j * RES - CZ, bounds);
        hf.base[k] = g.h + BASE;
        hf.baseMat[k] = g.mat;
      }
    hf.finalize();
    this.hf = hf;
    const terrain = new Terrain(hf, MS.MENU_WIND);
    terrain.group.position.set(-CX, -BASE, -CZ);
    this.scene.add(terrain.group);
    terrain.buildAll(new THREE.Vector3(CX, 0, CZ));
    this.terrain = terrain;
    // far crests for spindrift: a crest has a slip face downwind
    const W = MS.MENU_WIND;
    for (let i = 0; i < 3000 && this.crests.length < 16; i++) {
      const z = -18 - Math.pow(Math.random(), 0.7) * 110;
      const x = (Math.random() - 0.5) * (40 - z * 1.1);
      const h = this.gy(x, z);
      if (h > -9 && h >= this.gy(x - W.x * 2, z - W.z * 2) - 0.05 && h > this.gy(x + W.x * 2.5, z + W.z * 2.5) + 0.6 && this.crests.every((c) => c.distanceTo(new THREE.Vector3(x, h, z)) > 8))
        this.crests.push(new THREE.Vector3(x, h, z));
    }
  }

  private place(obj: THREE.Object3D, x: number, z: number, yaw = 0, sink = 0) {
    obj.position.set(x, this.gy(x, z) - sink, z);
    obj.rotation.y = yaw;
    this.scene.add(obj);
    return obj;
  }

  private buildCamp() {
    const P: any = PM;
    // fire pit
    const fp = MS.firePit();
    this.place(vmesh(fp.model, fp.voxelSize), FIRE.x, FIRE.z, 0.4, 0.02);
    FIRE.y = this.gy(FIRE.x, FIRE.z);
    this.fireLight.position.set(FIRE.x, FIRE.y + 0.45, FIRE.z);
    // the seat log
    const lg = MS.seatLog();
    const log = this.place(vmesh(lg.model, lg.voxelSize), SEAT.x, SEAT.z, SEAT.yaw, 0.04);
    this.logFrame.top = log.position.y + lg.seatTop;
    // far silhouettes: saguaros on the dunes, giant ribs against the sun, a broken obelisk in the haze
    try {
      for (const [x, z, sd] of [[-15, -21, 3], [11, -29, 5], [26, -47, 7], [-34, -58, 2], [44, -80, 4], [-8, -95, 6]] as [number, number, number][]) {
        const c = P.cactus(sd, 'saguaro');
        const m = this.place(vmesh(c.model, c.voxelSize), x, z, sd, 0.2);
        m.scale.setScalar(1.1 + (sd % 3) * 0.2);
      }
      const ob = P.obelisk(4, true);
      this.place(vmesh(ob.model, ob.voxelSize), 52, -118, 0.4, 2);
    } catch {}
  }

  private buildGateAndSign() {
    // ---- title gate
    const gt = MS.titleGate('dustUP', 4);
    const gate = new THREE.Group();
    gate.add(vmesh(gt.model, gt.voxelSize, [0, 0, 0]));
    this.place(gate, GATE.x, GATE.z, GATE.yaw, 0.08);
    gate.updateMatrixWorld(true);
    // the letters catch a warm wash from the camp below
    const titleLight = new THREE.PointLight(0xffb070, 3.2, 7, 2);
    titleLight.position.set(0, gt.top - 0.5, 1.7);
    gate.add(titleLight);
    // ---- signpost + menu boards
    const sp = MS.signpost();
    const post = new THREE.Group();
    post.add(vmesh(sp.model, sp.voxelSize, [0, 0, 0]));
    this.place(post, POST.x, POST.z, POST.yaw, 0.06);
    const woods = [R(0xd9c6a2, 0xbca784, 0xeedcbc, 0x8e7a5c), R(0xb07c4a, 0x8e6036, 0xc89660, 0x5e3c1e), R(0x7a5034, 0x5e3c25, 0x93654a, 0x3c2516), R(0x8a7662, 0x6c5a48, 0xa69078, 0x46382c), R(0x9a6a3e, 0x7a512c, 0xb4834f, 0x50331a)];
    const red = R(0xc8442a, 0xa0341e, 0xe2643e, 0x6a2010), cream = R(0xf3e2bc, 0xd8c39a, 0xfff4dc, 0xa48c66);
    LABELS.forEach((label, i) => {
      const dir: 1 | -1 = i % 2 === 0 ? -1 : 1;
      const pm = MS.arrowPlank(label, dir, i * 7 + 3, woods[i], i === 0 ? red : cream);
      const PS = 0.86;
      const mat = makeVoxelMaterial();
      (mat.userData.emissiveStrength as { value: number }).value = 0;
      const mesh = vmesh(pm.model, pm.voxelSize, pm.pivot, mat);
      mesh.scale.setScalar(PS);
      const g = new THREE.Group();
      g.add(mesh);
      // invisible hit box (cheap raycasts)
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(pm.length * PS, pm.height * PS, 0.12), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set((dir * pm.length * PS) / 2, 0, 0.04);
      g.add(proxy);
      g.position.set(0, 2.3 - i * 0.37, sp.faceZ + 0.004 + i * 0.002);
      const restYaw = [0.08, -0.12, 0.05, -0.06, 0.1][i];
      const restRoll = [-0.05, 0.04, 0.02, -0.06, 0.035][i];
      g.rotation.set(0, restYaw, restRoll);
      g.userData.y0 = g.position.y;
      g.userData.z0 = g.position.z;
      post.add(g);
      this.planks.push({ label, group: g, proxy, mat, restYaw, restRoll, hover: 0, knock: 0, wasHot: false });
    });
    // ---- lanterns: two on the gate, one on the signpost arm
    const lt = MS.hurricaneLantern();
    const lanternGeo = buildVoxelGeometry(lt.model, { voxelSize: lt.voxelSize, pivot: lt.pivot });
    const hang = (parent: THREE.Object3D, at: MS.V3, phase: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(...at);
      const ch = MS.chain(2);
      pivot.add(vmesh(ch.model, ch.voxelSize, ch.pivot));
      const lm = new THREE.Mesh(lanternGeo, sharedVoxelMaterial);
      lm.castShadow = true;
      lm.position.y = -ch.length;
      pivot.add(lm);
      const light = new THREE.PointLight(0xffa850, 1.6, 7, 2);
      light.position.set(0, -ch.length + lt.flame[1], 0);
      pivot.add(light);
      parent.add(pivot);
      this.lanterns.push({ pivot, light, phase, mesh: lm });
    };
    for (const [k, h] of gt.lanternHooks.entries()) hang(gate, h, k * 2.1);
    hang(post, sp.lanternHook, 4.2);
    // ---- THOTH'S HALL: the sign of knowledge hanging in the air over the dunes
    try {
      const ks = new KnowledgeSign(this.particles);
      ks.group.position.set(KSIGN.x, this.gy(KSIGN.x, KSIGN.z) + KSIGN.y, KSIGN.z);
      ks.group.rotation.y = KSIGN.yaw;
      this.scene.add(ks.group);
      this.ksign = ks;
    } catch (e) {
      console.warn('[menu] knowledge sign', e);
    }
  }

  private rigOf(keys: string[]): RigSpec | null {
    for (const k of keys) {
      const e = modelEntry(k);
      if (!e) continue;
      try {
        const r = e() as RigSpec;
        if (r?.parts) return r;
      } catch (err) {
        console.warn('[menu] model failed', k, err);
      }
    }
    return null;
  }

  private buildHero() {
    const save = loadSave();
    const look = save.look ?? { hat: 'stetson', outfit: 'duster', board: 'driftwood' };
    const spec = this.rigOf([`cowboy_${look.hat}_${look.outfit}`, 'cowboy_stetson_punk', 'cowboy_stetson_duster']);
    if (!spec) return;
    const hero = new RigInstance(buildRigGeo(spec, spec.name + ':player'), { material: makeVoxelMaterial() });
    this.hero = hero;
    hero.setExpression('smug');
    for (const n of ['head', 'torso']) if (hero.nodes[n]) hero.nodes[n].rotation.order = 'YXZ';
    this.scene.add(hero.root);
    // the revolver rests in his right hand (the holder spins it around the trigger finger)
    let gunSpec: RigSpec | null = null;
    try {
      const g = (CH as any).revolverRig?.(save.gun) as RigSpec | undefined;
      if (g?.parts) gunSpec = g;
    } catch {}
    gunSpec = gunSpec ?? this.rigOf(['revolver_standard']);
    if (gunSpec) {
      const gun = new RigInstance(buildRigGeo(gunSpec, gunSpec.name + ':player'), { material: hero.material });
      const holder = new THREE.Group();
      holder.rotation.x = Math.PI / 2;
      holder.add(this.gunSpin);
      this.gunSpin.add(gun.root);
      if (!hero.attach('hand_r', holder)) hero.nodes['fore_r']?.add(holder);
    }
    // seat him: pose, then rest the lowest of pelvis/thighs on the blanket
    this.poseSeated(0, 0);
    hero.root.position.set(0, 0, 0);
    hero.root.rotation.set(0, 0, 0);
    hero.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const n of ['pelvis', 'thigh_l', 'thigh_r']) if (hero.meshes[n]) box.union(new THREE.Box3().setFromObject(hero.meshes[n]));
    const under = isFinite(box.min.y) ? box.min.y : (spec.meta?.hipY ?? 0.66) - 0.1;
    const lf = this.logFrame;
    this.heroBase.set(lf.x + Math.sin(lf.yaw) * 0.02, lf.top - under - 0.015, lf.z + Math.cos(lf.yaw) * 0.02);
    hero.root.position.copy(this.heroBase);
    hero.root.rotation.y = lf.yaw;
    // board: on his back when the rig has the socket, else planted upright in the sand
    let be: { model: VoxelModel; voxelSize: number; meta?: any } | undefined;
    try {
      be = CH.sandboardModel((look.board ?? 'driftwood') as CH.BoardId);
    } catch {
      be = (modelEntry('board_' + look.board) ?? modelEntry('board_driftwood'))?.() as typeof be;
    }
    if (be?.model) {
      const bm = vmesh(be.model, be.voxelSize, 'center', hero.material);
      const half = (be.meta?.length ?? 1.45) / 2;
      this.perch.position.set(0, 0, half - 0.04);
      bm.add(this.perch);
      let onBack = false;
      if (hero.sockets['board_back']) {
        try {
          onBack = !!CH.attachBoardOnBack(hero, bm, { material: hero.material });
        } catch (err) {
          console.warn('[menu] board_back mount failed', err);
        }
      }
      if (onBack) {
        // the board's nose is hidden behind his hat: Pinch rides his left shoulder instead
        this.perch.removeFromParent();
        this.perch.position.set(0, 0, 0);
        if (!hero.attach('shoulder_l', this.perch)) hero.nodes['torso']?.add(this.perch);
      } else {
        const g = new THREE.Group();
        bm.rotation.x = -Math.PI / 2;
        g.add(bm);
        g.position.set(BOARD.x, this.gy(BOARD.x, BOARD.z) - 0.26 + half, BOARD.z);
        g.rotation.set(0.1, Math.PI + BOARD.yaw, 0.06, 'YXZ');
        this.scene.add(g);
      }
    }
    // Pinch on the top of the board
    const ps = this.rigOf(['pinch']);
    if (ps) {
      this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':menu'), { material: makeVoxelMaterial() });
      this.pinch.setExpression('neutral');
      this.scene.add(this.pinch.root);
    }
    // coin for the flips
    try {
      const gc = (PM as any).goldCoin();
      const cm = vmesh(gc.model, gc.voxelSize, 'center', hero.material);
      cm.scale.setScalar(0.15);
      cm.visible = false;
      this.scene.add(cm);
      this.coin = { m: cm, p: new THREE.Vector3(), v: new THREE.Vector3(), fly: false };
    } catch {}
    // duster tails + scarf: engine cloth in the wind, resting on the log and the sand
    this.garments = new Garments(hero, this.cloth, (x, z) => this.clothGround(x, z));
    this.poseSeated(0, 0);
    hero.root.updateMatrixWorld(true);
    for (let i = 0; i < 90; i++) {
      this.garments.update(MS.MENU_WIND.x * 2.4, MS.MENU_WIND.z * 2.4, new THREE.Vector3());
      this.cloth.update(1 / 60, i / 60);
    }
  }

  private clothGround(x: number, z: number) {
    const g = this.gy(x, z);
    const lf = this.logFrame;
    const dx = x - lf.x, dz = z - lf.z;
    const c = Math.cos(lf.yaw), s = Math.sin(lf.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < 0.85 && Math.abs(lz) < 0.2) return Math.max(g, lf.top - 0.04 - lz * lz * 2.5);
    return g;
  }

  private buildLife() {
    const P: any = PM;
    // fireflies: one teases Pinch, two dance over the fire
    for (let i = 0; i < 3; i++) this.flies.push({ p: new THREE.Vector3(FIRE.x + i * 0.6, 1.0 + i * 0.2, FIRE.z - 0.4), v: new THREE.Vector3(), phase: i * 2.3, dart: 0 });
    // tumbleweeds: one bounces across the camp, one across the far slope
    for (let i = 0; i < 2; i++) {
      const tw = P.tumbleweed(i + 1);
      const m = vmesh(tw.model, tw.voxelSize, 'center');
      m.visible = false;
      this.scene.add(m);
      const far = i === 1;
      this.weeds.push({ m, r: 0.4, x: 0, z: 0, x0: far ? -70 : -16, x1: far ? 70 : 17, speed: 0, on: false, next: far ? 6 : 13, hop: 0, far });
    }
    // vultures circling high over the dunes
    const vs = this.rigOf(['vulture']);
    if (vs)
      for (let i = 0; i < 2; i++) {
        const r = new RigInstance(buildRigGeo(vs, vs.name + ':menu'), { material: makeVoxelMaterial(), castShadow: false });
        this.scene.add(r.root);
        this.vultures.push({ r, phase: i * Math.PI, rad: 15 + i * 5, c: new THREE.Vector3(-22 + i * 6, 24 + i * 3, -64 - i * 8), flapAt: 2 + i * 3 });
      }
  }

  // ================================================================ ui
  private say(t: string) {
    this.msg.textContent = t;
    this.msg.style.opacity = '1';
    clearTimeout((this.msg as any)._t);
    (this.msg as any)._t = setTimeout(() => (this.msg.style.opacity = '0'), 3200);
  }

  exit() {
    this.hall?.dispose();
    this.hall = null;
    this.ksign?.dispose();
    this.msg.remove();
    this.panel?.remove();
    this.wind?.stop(0.5);
    this.crickets?.stop(0.5);
    document.body.style.cursor = 'default';
    const post: any = this.engine.post;
    if (this.postSaved.bloom !== undefined && post?.bloom) post.bloom.strength = this.postSaved.bloom;
    if (this.postSaved.vignette !== undefined && post?.u?.uVignette) post.u.uVignette.value = this.postSaved.vignette;
    this.garments?.dispose();
    this.terrain?.dispose();
    this.terrain = null;
  }

  private choose(p: Plank) {
    const eng = this.engine;
    p.knock = 1;
    eng.audio.play('ui_click', { volume: 0.7 });
    eng.audio.play('kick', { volume: 0.5, pitch: 1.25 });
    // a thunk of dust off the board
    const wp = p.proxy.getWorldPosition(new THREE.Vector3());
    this.particles.emit({ pos: wp, count: 14, spread: 1.2, up: 0.6, life: [0.5, 1.1], size: [0.03, 0.02], sprite: ['grain0', 'grain1', 'grain2', 'grain3', 'woodchip'], color: [0xe8c890, 0xc8a070, 0x9a7448], gravity: 6, drag: 1.2, jitter: 0.5 });
    this.particles.emit({ pos: wp, count: 3, spread: 0.4, up: 0.2, life: [0.6, 1.0], size: [0.2, 0.7], sprite: ['puff0', 'puff1', 'puff2'], color: 0xe8cfa4, alpha: 0.4, drag: 2, rot: 6, rotSpeed: 1 });
    switch (p.label) {
      case 'NEW RUN':
      case 'RESUME': {
        if (this.leaving) return;
        this.leaving = true;
        eng.audio.play('level_transition', { volume: 0.8 });
        this.hero?.setExpression('determined');
        this.pinch?.setExpression('surprised');
        // tilt up past the sign and zoom into the blinding sky
        const from = this.camera.position.clone();
        const dir0 = this.camera.getWorldDirection(new THREE.Vector3());
        const sky = new THREE.Vector3(dir0.x * 0.35, 1, dir0.z * 0.35).normalize();
        const fov0 = this.camera.fov;
        eng.tweens.run(1.5, (k) => {
          const e = Ease.inOutCubic(k);
          this.camera.position.lerpVectors(from, from.clone().add(new THREE.Vector3(0, 3.5, 0)).addScaledVector(dir0, 6), e);
          const d = dir0.clone().lerp(sky, e).normalize();
          this.camera.lookAt(this.camera.position.clone().add(d));
          this.camera.fov = fov0 + (14 - fov0) * Ease.inCubic(k);
          this.camera.updateProjectionMatrix();
        }, Ease.linear, { real: true });
        eng.audio.play('whoosh_big', { volume: 0.7, pitch: 0.7 });
        eng.tweens.after(0.95, () => this.onRide(), true);
        break;
      }
      case 'SETTINGS':
        this.openSettings();
        break;
      case 'HIDEOUT':
        if (this.leaving) return;
        this.leaving = true;
        eng.audio.play('door_creak', { volume: 0.8 });
        nav.hub();
        break;
    }
  }

  /** the sign of knowledge: Thoth's Hall opens over the menu (the camp waits behind it) */
  private openHall() {
    if (this.hall || this.leaving) return;
    const eng = this.engine;
    this.ksign?.burst();
    eng.audio.play('divine_chime', { volume: 0.6 });
    eng.audio.play('paper_flutter', { volume: 0.5, pitch: 0.9 });
    this.panel?.remove();
    this.panel = null;
    this.msg.style.opacity = '0';
    document.body.style.cursor = 'default';
    const hall = new ThothHall(eng, {
      hero: this.hero?.geo.spec ?? null,
      back: { scene: this.scene, camera: this.camera },
      from: 'menu',
      onClosed: () => {
        if (this.hall === hall) this.hall = null;
        hall.dispose();
        eng.input.setWantLock(false);
      },
    });
    this.hall = hall;
    void hall.open();
  }

  private openSettings() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      return;
    }
    const eng = this.engine;
    const p = document.createElement('div');
    p.style.cssText = "position:absolute;left:6vw;top:50%;transform:translateY(-50%);z-index:8;padding:18px 22px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:18px;min-width:260px;pointer-events:auto";
    const row = (label: string, input: HTMLElement) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, input);
      p.appendChild(r);
    };
    const title = document.createElement('div');
    title.textContent = 'SETTINGS';
    title.style.cssText = 'font-size:28px;color:#8a2a18;text-align:center;margin-bottom:6px';
    p.appendChild(title);
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(((eng.audio as any).master?.gain?.value ?? 1) * 100));
    vol.oninput = () => (eng.audio as any).setMaster?.(+vol.value / 100);
    row('Volume', vol);
    const q = document.createElement('select');
    for (const [v, t] of [['high', 'High'], ['low', 'Low (fast)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      q.appendChild(o);
    }
    q.value = eng.quality.bloom ? 'high' : 'low';
    q.onchange = () => eng.applyQuality(q.value === 'low' ? { shadows: false, pixelRatio: 0.6, bloom: false, shadowSize: 512 } : { shadows: true, pixelRatio: Math.min(window.devicePixelRatio, 1.5), bloom: true, shadowSize: 2048 });
    row('Quality', q);
    const sens = document.createElement('input');
    sens.type = 'range';
    sens.min = '20';
    sens.max = '300';
    sens.value = String(Math.round(((eng.input as any).sensitivity ?? 1) * 100));
    sens.oninput = () => ((eng.input as any).sensitivity = +sens.value / 100);
    const touch = eng.input.touchDevice;
    row(touch ? 'Aim speed' : 'Mouse', sens);
    if (touch) {
      // the board always kicks along by itself on a touch screen; the lesson can be shown again
      const tl = document.createElement('input');
      tl.type = 'checkbox';
      tl.checked = false;
      tl.onchange = () => tl.checked && resetTutor();
      row('Touch lesson again', tl);
    } else {
      const ap = document.createElement('input');
      ap.type = 'checkbox';
      ap.checked = eng.input.autoPushDesktop;
      ap.onchange = () => eng.input.setAutoPushDesktop(ap.checked);
      row('Auto push', ap);
    }
    p.querySelectorAll('input,select').forEach((el) => ((el as HTMLElement).style.cssText = 'font-family:Alagard;font-size:16px;accent-color:#8a2a18'));
    eng.overlay.appendChild(p);
    this.panel = p;
  }

  // ================================================================ per frame
  update(_dt: number, rdt: number) {
    if (!this.built) return;
    // Thoth's Hall owns the screen while it is open
    if (this.hall) {
      this.hall.update(rdt);
      return;
    }
    this.t += rdt;
    const t = this.t;
    const dt = Math.min(rdt, 0.05);
    this.gust = 0.75 + 0.5 * (noise.n2(t * 0.13, 7.3) * 0.5 + 0.5) + Math.max(0, noise.n2(t * 0.4, 2.1)) * 0.5;
    this.skyU.uTime.value = t;
    this.updateMenu(dt);
    this.updateHero(dt);
    this.updatePinch(dt);
    this.updateFire(dt);
    this.updateSand(dt);
    this.updateWorldLife(dt);
    if (this.garments && this.hero) {
      this.hero.root.updateMatrixWorld(true);
      this.garments.update(MS.MENU_WIND.x * 2.6 * this.gust, MS.MENU_WIND.z * 2.6 * this.gust, new THREE.Vector3());
    }
    this.cloth.update(dt, this.engine.realTime);
    this.particles.update(dt, this.scene.fog as THREE.Fog);
    if (!this.leaving) this.placeCamera(dt);
    this.sky.position.copy(this.camera.position);
    if (this.terrain) this.terrain.update(new THREE.Vector3(CX, 0, CZ), 2);
  }

  private rate(key: string, perSec: number, dt: number) {
    const a = (this.acc[key] ?? Math.random()) + perSec * dt;
    const n = Math.floor(a);
    this.acc[key] = a - n;
    return n;
  }

  private placeCamera(dt: number) {
    const t = this.t;
    const inp = this.engine.input;
    this.mouse.x = damp(this.mouse.x, inp.ndcX, 1.6, dt || 1);
    this.mouse.y = damp(this.mouse.y, inp.ndcY, 1.6, dt || 1);
    const intro = Ease.outCubic(clamp(t / 3.6, 0, 1));
    const yaw = 0.035 + 0.075 * Math.sin(t * 0.12) + 0.03 * Math.sin(t * 0.27 + 1) + this.mouse.x * 0.035;
    const dist = CAM_DIST + (1 - intro) * 3.2;
    const cx = CAM_T.x + Math.sin(yaw) * dist, cz = CAM_T.z + Math.cos(yaw) * dist;
    const cy = this.gy(cx, cz) + 1.42 + 0.07 * Math.sin(t * 0.17) + this.mouse.y * 0.1 + (1 - intro) * 0.9;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(CAM_T.x + Math.sin(t * 0.21) * 0.05, CAM_T.y + Math.sin(t * 0.33) * 0.03, CAM_T.z);
  }

  // ---------------------------------------------------------------- signage
  private updateMenu(dt: number) {
    const eng = this.engine;
    const inp = eng.input;
    const n = this.planks.length;
    // the settings card closes with Esc (on a touch screen: two fingers)
    if (this.panel && inp.wasPressed('Escape')) this.openSettings();
    // keyboard
    const up = inp.wasPressed('ArrowUp') || inp.wasPressed('KeyW');
    const down = inp.wasPressed('ArrowDown') || inp.wasPressed('KeyS');
    // the sign of knowledge is the last stop of the keyboard cycle (index n)
    const nk = n + (this.ksign ? 1 : 0);
    if ((up || down) && nk && !this.leaving) {
      this.kb = true;
      this.sel = this.sel < 0 ? 0 : (this.sel + (down ? 1 : -1) + nk) % nk;
    }
    let signHit = false;
    // mouse
    let hit: Plank | null = null;
    if (inp.ndcX !== this.lastNdc.x || inp.ndcY !== this.lastNdc.y) {
      this.kb = false;
      this.lastNdc.set(inp.ndcX, inp.ndcY);
    }
    if (!this.kb) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
      const hits = this.ray.intersectObjects([...this.planks.map((p) => p.proxy), ...(this.ksign ? [this.ksign.proxy] : [])], false);
      if (hits.length) hit = this.planks.find((p) => p.proxy === hits[0].object) ?? null;
      signHit = !!hits.length && !!this.ksign && hits[0].object === this.ksign.proxy;
      this.sel = hit ? this.planks.indexOf(hit) : signHit ? n : -1;
    } else {
      hit = this.planks[this.sel] ?? null;
      signHit = this.sel === n && !!this.ksign;
    }
    if (this.leaving) hit = null;
    if (this.leaving) signHit = false;
    // the sign: hover lights it, a click (or Enter on it) opens the hall
    if (this.ksign) {
      if (signHit && this.ksignHot < 0.5) eng.audio.play('divine_whisper', { volume: 0.3, pitch: 1.2 });
      this.ksignHot = signHit ? 1 : 0;
      this.ksign.update(dt, this.ksignHot);
      if (signHit && !this.leaving && ((!this.kb && inp.wasPressed('Mouse0')) || (this.kb && (inp.wasPressed('Enter') || inp.wasPressed('Space') || inp.wasPressed('NumpadEnter'))))) {
        this.openHall();
        return;
      }
    }
    if (hit !== this.hot) {
      if (hit) {
        eng.audio.play('ui_hover', { volume: 0.45 });
        if (!hit.wasHot) {
          // first touch shakes a little sand off the board
          const wp = hit.proxy.getWorldPosition(new THREE.Vector3());
          this.particles.emit({ pos: { x: wp.x, y: wp.y + 0.15, z: wp.z }, count: 10, spread: 0.3, life: [0.6, 1.2], size: [0.025, 0.02], sprite: ['grain0', 'grain1', 'grain2'], color: [0xf0d29a, 0xe0b06e], gravity: 5, jitter: 0.5 });
          hit.wasHot = true;
        }
      }
      this.hot = hit;
    }
    document.body.style.cursor = (hit || signHit) && !this.kb ? 'pointer' : 'default';
    if (!this.leaving) {
      if (hit && !this.kb && inp.wasPressed('Mouse0')) this.choose(hit);
      else if (this.sel >= 0 && this.sel < n && (inp.wasPressed('Enter') || inp.wasPressed('Space') || inp.wasPressed('NumpadEnter'))) this.choose(this.planks[this.sel]);
    }
    const t = this.t;
    for (const p of this.planks) {
      const on = p === hit ? 1 : 0;
      p.hover = damp(p.hover, on, 9, dt);
      p.knock = Math.max(0, p.knock - dt * 2.2);
      const h = p.hover;
      const sway = Math.sin(t * 1.3 + p.restYaw * 40) * 0.012 * this.gust;
      p.group.rotation.z = p.restRoll * (1 - h * 0.7) + sway + Math.sin(p.knock * 20) * p.knock * 0.22 + h * Math.sin(t * 7) * 0.012;
      p.group.rotation.y = p.restYaw * (1 - h) + h * 0.06;
      p.group.position.z = p.group.userData.z0 + h * 0.09 - p.knock * 0.04;
      p.group.position.y = p.group.userData.y0 + h * 0.035;
      const sc = 1 + h * 0.035;
      p.group.scale.setScalar(sc);
      (p.mat.userData.emissiveStrength as { value: number }).value = h * 1.5 + p.knock * 0.8;
      p.mat.emissive.setRGB(0.22 * h, 0.09 * h, 0.02 * h);
    }
  }

  // ---------------------------------------------------------------- hero
  private poseSeated(t: number, dt: number) {
    const h = this.hero;
    if (!h) return;
    const n = h.nodes;
    const breathe = Math.sin(t * 1.55) * 0.018;
    const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
    set('pelvis', -0.04, 0, 0);
    set('thigh_l', -1.66, 0, 0.2);
    set('thigh_r', -1.62, 0, -0.16);
    set('shin_l', 1.5, 0, -0.06);
    set('shin_r', 1.42, 0, 0.08);
    if (n['coat']) n['coat'].rotation.set(1.05, 0, 0);
    if (n['torso']) n['torso'].rotation.set(0.27 + breathe, 0, 0);
    set('arm_l', -0.62, 0, 0.16);
    set('fore_l', -0.72, 0, 0);
    set('arm_r', -0.64, 0, -0.14);
    set('fore_r', -0.66, 0, 0);
    void dt;
  }

  private startAct() {
    const opts: ActKind[] = (['coin', 'spin', 'glance'] as ActKind[]).filter((k) => k !== this.lastAct);
    const kind = opts[Math.floor(Math.random() * opts.length)];
    this.act = { kind, t: 0, flag: 0 };
    this.lastAct = kind;
  }

  private updateHero(dt: number) {
    const h = this.hero;
    if (!h) return;
    const t = this.t;
    const n = h.nodes;
    this.poseSeated(t, dt);
    // idle actions
    if (!this.act && t > this.nextAct && !this.leaving) this.startAct();
    let lookAt: THREE.Vector3 = new THREE.Vector3(FIRE.x, FIRE.y + 0.3, FIRE.z);
    if (Math.sin(t * 0.23) > 0.55) lookAt = new THREE.Vector3(-30, 6, -120); // gazes at the sunset now and then
    const a = this.act;
    if (a) {
      a.t += dt;
      const k = a.t;
      if (a.kind === 'coin') this.actCoin(k, a, dt);
      else if (a.kind === 'spin') {
        const w = smooth01(k / 0.4) * (1 - smooth01((k - 1.6) / 0.6));
        if (n['arm_r']) n['arm_r'].rotation.x -= 0.32 * w;
        if (n['fore_r']) n['fore_r'].rotation.x -= 0.62 * w;
        if (k > 0.35 && a.flag === 0) {
          a.flag = 1;
          this.engine.audio.play('rev_spin', { volume: 0.4 });
        }
        this.gunSpin.rotation.x = -Ease.outCubic(clamp((k - 0.35) / 1.15, 0, 1)) * Math.PI * 6;
        if (k > 1.6 && a.flag === 1) {
          a.flag = 2;
          this.engine.audio.play('rev_hammer', { volume: 0.25 });
        }
        lookAt = this.gunSpin.getWorldPosition(new THREE.Vector3());
        if (k > 2.3) this.endAct();
      } else {
        // glance at the camera, a wink
        lookAt = this.camera.position.clone();
        if (k > 0.9 && a.flag === 0) {
          a.flag = 1;
          h.setExpression('wink');
        }
        if (k > 1.5 && a.flag === 1) {
          a.flag = 2;
          h.setExpression('smug');
        }
        if (k > 3) this.endAct();
      }
      if (this.coin?.fly) lookAt = this.coin.p;
    }
    if (this.hot && !(a && a.kind === 'coin')) lookAt = this.hot.proxy.getWorldPosition(new THREE.Vector3());
    // head + torso follow the look target
    h.root.updateMatrixWorld(true);
    const local = h.root.worldToLocal(lookAt.clone());
    const hy = (this.hero!.geo.spec.meta?.shoulderY ?? 1.18) + 0.12;
    const yaw = clamp(Math.atan2(local.x, local.z), -1.15, 1.15);
    const pitch = clamp(-Math.atan2(local.y - hy, Math.hypot(local.x, local.z)), -0.55, 0.65);
    this.head.yaw = damp(this.head.yaw, yaw, 4.5, dt);
    this.head.pitch = damp(this.head.pitch, pitch, 4.5, dt);
    if (n['torso']) n['torso'].rotation.y = this.head.yaw * 0.25;
    if (n['head']) n['head'].rotation.set(-0.22 + this.head.pitch + Math.sin(t * 0.7) * 0.015, this.head.yaw * 0.75, Math.sin(t * 0.4) * 0.03);
    // the hat brim catches the gusts
    if (n['hat']) n['hat'].rotation.z = Math.sin(t * 5.3) * 0.008 * this.gust;
  }

  private endAct() {
    this.act = null;
    this.nextAct = this.t + 4.5 + Math.random() * 4;
    this.gunSpin.rotation.x = 0;
    this.hero?.setExpression('smug');
  }

  private actCoin(k: number, a: { flag: number }, dt: number) {
    const h = this.hero!;
    const n = h.nodes;
    const c = this.coin;
    const raise = smooth01(k / 0.45) * (1 - smooth01((k - 2.1) / 0.5));
    if (n['arm_l']) n['arm_l'].rotation.x -= 0.25 * raise;
    if (n['fore_l']) n['fore_l'].rotation.x -= 0.85 * raise;
    const hand = (h.sockets['hand_l'] ?? n['fore_l'])?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    if (!c) {
      if (k > 2.6) this.endAct();
      return;
    }
    // flick
    if (a.flag === 0 && k > 0.55) {
      a.flag = 1;
      c.fly = true;
      c.p.copy(hand).add(new THREE.Vector3(0, 0.04, 0));
      c.v.set(0.05, 2.7, 0.02);
      this.engine.audio.play('pickup_gold', { volume: 0.16, pitch: 1.6 });
      if (n['fore_l']) n['fore_l'].rotation.x -= 0.25;
    }
    if (c.fly) {
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      c.m.rotation.x += 33 * dt;
      if (c.v.y > -0.2 && c.v.y < 0.3) this.particles.emit({ pos: c.p, count: 1, life: [0.12, 0.16], size: [0.08, 0.02], sprite: 'star4', color: 0xfff0b0, additive: true });
      if (c.v.y < 0 && c.p.y <= hand.y + 0.03) {
        c.fly = false;
        a.flag = 2;
        this.engine.audio.play('pickup_gold', { volume: 0.22, pitch: 1.25 });
        h.setExpression('smug');
      }
    } else c.p.copy(hand).add(new THREE.Vector3(0, 0.03, 0));
    c.m.visible = k < 2.45;
    c.m.position.copy(c.p);
    if (a.flag === 2 && n['fore_l']) n['fore_l'].rotation.x += 0.12 * Math.max(0, 1 - (k - 1.1) * 4);
    if (k > 2.7) {
      c.m.visible = false;
      this.endAct();
    }
  }

  // ---------------------------------------------------------------- Pinch + fireflies
  private updatePinch(dt: number) {
    const p = this.pinch;
    const t = this.t;
    const S = this.pinchS;
    const perchW = this.perch.getWorldPosition(new THREE.Vector3());
    // fireflies
    const flyHome = (i: number) => {
      if (i === 0) {
        const near = Math.sin(t * 0.33) > -0.2;
        return near ? perchW.clone().add(new THREE.Vector3(0.12 + Math.sin(t * 1.3) * 0.18, 0.32 + Math.sin(t * 2.1) * 0.08, 0.18 + Math.cos(t * 1.1) * 0.15)) : new THREE.Vector3(FIRE.x + 0.5, FIRE.y + 1.4, FIRE.z - 0.3);
      }
      return new THREE.Vector3(FIRE.x + Math.sin(t * 0.4 + i * 3) * 1.2, FIRE.y + 1.1 + Math.sin(t * 0.7 + i) * 0.35 + i * 0.25, FIRE.z - 0.5 + Math.cos(t * 0.35 + i * 2) * 0.9);
    };
    this.flies.forEach((f, i) => {
      const home = flyHome(i);
      const wob = new THREE.Vector3(noise.n2(t * 0.9, i * 7.1), noise.n2(t * 1.1, i * 3.3 + 20) * 0.6, noise.n2(t * 0.8, i * 5.7 + 40)).multiplyScalar(1.6);
      f.v.addScaledVector(home.sub(f.p).multiplyScalar(2.2).add(wob), dt);
      f.v.multiplyScalar(Math.exp(-dt * 1.8));
      f.v.x += MS.MENU_WIND.x * 0.15 * dt * this.gust;
      f.p.addScaledVector(f.v, dt);
      const blink = Math.pow(Math.max(0, Math.sin(t * 2.3 + f.phase * 3)), 3);
      const fl = Math.max(0.05, dt * 1.6);
      this.particles.emit({ pos: f.p, count: 1, life: [fl, fl], size: [0.05 + blink * 0.05, 0.04], sprite: 'glow8', color: 0xd8ff70, alpha: 0.35 + blink * 0.65, additive: true, sizeJitter: 0 });
      if (this.rate('fly' + i, 14, dt)) this.particles.emit({ pos: f.p, count: 1, life: [0.3, 0.4], size: [0.014, 0.004], sprite: 'dot2', color: 0xb8f060, alpha: 0.6, additive: true, sizeJitter: 0 });
    });
    if (!p) return;
    p.root.position.copy(perchW);
    // target: coin in the air > teasing firefly > the fire
    const fly = this.flies[0];
    let tgt = new THREE.Vector3(FIRE.x, FIRE.y + 0.3, FIRE.z);
    if (this.coin?.fly) tgt = this.coin.p;
    else if (fly && fly.p.distanceTo(perchW) < 1.2) tgt = fly.p;
    const dx = tgt.x - perchW.x, dz = tgt.z - perchW.z;
    S.yaw = dampAngle(S.yaw, Math.atan2(dx, dz), 5, dt);
    // snap at the firefly
    S.cd -= dt;
    const tipDist = fly ? fly.p.distanceTo(perchW.clone().add(new THREE.Vector3(Math.sin(S.yaw) * 0.3, 0.12, Math.cos(S.yaw) * 0.3))) : 9;
    if (S.snap <= 0 && S.cd <= 0 && tipDist < 0.32) {
      S.snap = 0.42;
      S.cd = 2.2 + Math.random() * 2;
      this.engine.audio.play('scorpion_chitter', { volume: 0.22, pitch: 1.3 });
    }
    let open = 0.12 + Math.max(0, Math.sin(t * 2.6)) * 0.12, lunge = 0;
    if (S.snap > 0) {
      const k = 1 - S.snap / 0.42;
      open = k < 0.45 ? 0.7 : 0;
      lunge = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 1;
      if (k > 0.45 && fly && fly.dart <= 0) {
        fly.dart = 1;
        fly.v.add(new THREE.Vector3(fly.p.x - perchW.x, 0.8, fly.p.z - perchW.z).normalize().multiplyScalar(2.4));
      }
      S.snap -= dt;
      if (S.snap <= 0) {
        this.pinch!.setExpression('neutral');
        if (fly) fly.dart = 0;
      }
    }
    S.lunge = damp(S.lunge, lunge, 18, dt);
    p.root.rotation.set(0, S.yaw, 0);
    const n = p.nodes;
    if (n['body']) {
      n['body'].rotation.x = S.lunge * 0.32 + Math.sin(t * 1.7) * 0.02;
      n['body'].position.z = (n['body'].userData.z0 ??= n['body'].position.z) + S.lunge * 0.05;
    }
    // tail: curled high, twitching now and then
    if (t > S.nextTwitch) {
      S.twitch = 1;
      S.nextTwitch = t + 1.5 + Math.random() * 3;
    }
    S.twitch = Math.max(0, S.twitch - dt * 3.2);
    const tw = Math.sin(S.twitch * 14) * S.twitch;
    for (let k = 1; k <= 5; k++) if (n['tail' + k]) n['tail' + k].rotation.set(-0.32 - Math.sin(t * 1.9 + k * 0.6) * 0.05 - tw * 0.18 * (k / 5) - S.lunge * 0.12, Math.sin(t * 1.3 + k) * 0.06, 0);
    if (n['stinger']) n['stinger'].rotation.x = -0.2 - tw * 0.4;
    if (n['pincer_l']) n['pincer_l'].rotation.y = -open;
    if (n['pincer_r']) n['pincer_r'].rotation.y = open;
    if (n['arm_l']) n['arm_l'].rotation.set(-S.lunge * 0.3, Math.sin(t * 1.1) * 0.06 - S.lunge * 0.15, 0);
    if (n['arm_r']) n['arm_r'].rotation.set(-S.lunge * 0.3, -Math.sin(t * 1.1 + 1) * 0.06 + S.lunge * 0.15, 0);
    for (let k = 1; k <= 4; k++) {
      const g = Math.sin(t * 3 + k * 1.3) * 0.04;
      if (n['leg_l' + k]) n['leg_l' + k].rotation.z = 0.25 + g;
      if (n['leg_r' + k]) n['leg_r' + k].rotation.z = -0.25 - g;
    }
  }

  // ---------------------------------------------------------------- fire
  private updateFire(dt: number) {
    const t = this.t;
    const P = this.particles;
    const f = { x: FIRE.x, y: FIRE.y, z: FIRE.z };
    const W = MS.MENU_WIND;
    const lean = 0.35 * this.gust;
    const flick = 0.78 + 0.12 * Math.sin(t * 17.3) + 0.08 * Math.sin(t * 7.1 + 1) + 0.1 * noise.n2(t * 6, 3.3);
    this.fireLight.intensity = 9 * flick;
    this.fireLight.position.set(FIRE.x + Math.sin(t * 9) * 0.03 + W.x * 0.08 * this.gust, FIRE.y + 0.45 + Math.sin(t * 13) * 0.03, FIRE.z);
    const base: EmitOpts = { pos: f, count: 1 };
    for (let i = this.rate('flame', 30, dt); i > 0; i--)
      P.emit({ ...base, pos: { x: f.x + (Math.random() - 0.5) * 0.26, y: f.y + 0.12, z: f.z + (Math.random() - 0.5) * 0.26 }, vel: { x: W.x * lean, y: 1.05, z: W.z * lean }, spread: 0.12, life: [0.35, 0.65], size: [0.5, 0.08], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], animate: true, color: [0xffd070, 0xffa040, 0xff8030], additive: true, drag: 0.6, sizeJitter: 0.3 });
    // tall licking tongues
    for (let i = this.rate('tongue', 7, dt); i > 0; i--)
      P.emit({ ...base, pos: { x: f.x + (Math.random() - 0.5) * 0.12, y: f.y + 0.25, z: f.z + (Math.random() - 0.5) * 0.12 }, vel: { x: W.x * lean * 1.3, y: 1.7, z: W.z * lean * 1.3 }, spread: 0.08, life: [0.28, 0.42], size: [0.34, 0.05], sprite: ['flame1', 'flame2', 'flame3'], animate: true, color: [0xffe08a, 0xffb050], additive: true, drag: 0.4, stretch: 0.06 });
    for (let i = this.rate('core', 8, dt); i > 0; i--)
      P.emit({ ...base, pos: { x: f.x, y: f.y + 0.25, z: f.z }, life: [0.2, 0.3], size: [1.1, 0.7], sprite: 'glow32', color: 0xff6a1a, alpha: 0.5, additive: true, sizeJitter: 0.2 });
    for (let i = this.rate('spark', 9 + Math.max(0, Math.sin(t * 0.7)) * 8, dt); i > 0; i--)
      P.emit({ ...base, pos: { x: f.x, y: f.y + 0.35, z: f.z }, vel: { x: W.x * lean * 1.6, y: 1.6, z: W.z * lean * 1.6 }, spread: 0.6, up: 0.8, life: [0.9, 2.0], size: [0.035, 0.015], sprite: 'spark', color: [0xffc060, 0xff9a40, 0xffe090], additive: true, drag: 0.5, jitter: 0.08, gravity: -0.2 });
    for (let i = this.rate('smoke', 2.2, dt); i > 0; i--)
      P.emit({ ...base, pos: { x: f.x, y: f.y + 0.8, z: f.z }, vel: { x: W.x * 0.32 * this.gust, y: 0.95, z: W.z * 0.32 * this.gust - 0.1 }, spread: 0.08, life: [1.8, 2.6], size: [0.1, 0.5], sprite: ['puff0', 'puff1', 'puff2', 'puff3'], color: [0x9a8a82, 0xae9e94, 0x8a7a72], alpha: 0.32, drag: 0.3, rot: 6, rotSpeed: 0.5, fadeIn: 0.25 });
    // a log settles: a pop of sparks
    if (Math.random() < dt * 0.25) {
      P.emit({ ...base, pos: { x: f.x, y: f.y + 0.25, z: f.z }, count: 16, spread: 1.6, up: 2.2, life: [0.6, 1.4], size: [0.04, 0.012], sprite: 'spark', color: [0xffe0a0, 0xffa040], additive: true, drag: 0.8, gravity: 2.5 });
      this.fireLight.intensity *= 1.4;
    }
    // coffee steam
    if (this.rate('steam', 1.2, dt)) P.emit({ ...base, pos: { x: f.x + 0.33, y: f.y + 0.52, z: f.z + 0.3 }, vel: { x: W.x * 0.3, y: 0.35, z: W.z * 0.3 }, spread: 0.05, life: [1.2, 2], size: [0.06, 0.3], sprite: ['puff1', 'puff2'], color: 0xe8e0d8, alpha: 0.25, drag: 0.6, rot: 6, rotSpeed: 0.8 });
    // lanterns: flicker and sway on their chains
    for (const l of this.lanterns) {
      l.light.intensity = 1.6 * (0.86 + 0.1 * Math.sin(t * 11 + l.phase) + 0.06 * noise.n2(t * 5, l.phase));
      l.pivot.rotation.z = Math.sin(t * 1.7 + l.phase) * 0.05 * this.gust + 0.03 * this.gust;
      l.pivot.rotation.x = Math.sin(t * 1.3 + l.phase * 2) * 0.03;
    }
  }

  // ---------------------------------------------------------------- wind and sand
  private updateSand(dt: number) {
    const P = this.particles;
    const W = MS.MENU_WIND;
    const g = this.gust;
    // grains streaming off the brink behind the camp
    for (let i = this.rate('brink', 80 * g, dt); i > 0; i--) {
      const x = -8 + Math.random() * 16, z = brinkZ(x);
      const sp = 1.2 + Math.random() * 1.6 * g;
      P.emit({ pos: { x, y: this.gy(x, z) + 0.04, z }, vel: { x: W.x * sp, y: 0.25 + Math.random() * 0.3, z: W.z * sp - 0.3 }, count: 1, spread: 0.2, life: [1.2, 2.4], size: [0.045, 0.03], sprite: ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'], color: [0xf4d7a0, 0xe6bb7c, 0xfde6b8], gravity: 0.45, drag: 0.35 });
    }
    // low saltation over the plateau and the apron
    for (let i = this.rate('salt', 45 * g, dt); i > 0; i--) {
      const x = -9 + Math.random() * 14, z = -2 + Math.random() * 9;
      P.emit({ pos: { x, y: this.gy(x, z) + 0.03, z }, vel: { x: W.x * 2.2 * g, y: 0.35, z: W.z * 2.2 * g }, count: 1, spread: 0.25, life: [0.5, 1.1], size: [0.022, 0.018], sprite: ['grain0', 'grain2', 'grain4'], color: [0xf0d29a, 0xe0b06e], gravity: 2.4, ground: true, bounce: 0.3, drag: 0.3 });
    }
    // drifting sand sheets
    for (let i = this.rate('sheet', 2.2 * g, dt); i > 0; i--) {
      const x = -10 + Math.random() * 6, z = -2 + Math.random() * 8;
      P.emit({ pos: { x, y: this.gy(x, z) + 0.08, z }, vel: { x: W.x * 1.8 * g, y: 0.05, z: W.z * 1.8 * g }, count: 1, spread: 0.2, life: [1.6, 2.6], size: [0.22, 0.75], sprite: ['puff0', 'puff1', 'puff2'], color: [0xf2d0a0, 0xe8bf8c], alpha: 0.3, drag: 0.2, rot: 6, rotSpeed: 0.3, fadeIn: 0.3 });
    }
    // spindrift plumes off the far crests
    for (const c of this.crests)
      if (Math.random() < dt * 0.9 * g)
        P.emit({ pos: c, vel: { x: W.x * 3.5 * g, y: 0.5, z: W.z * 3.5 * g }, count: 1, spread: 0.6, life: [2.4, 3.6], size: [0.7, 2.4], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0xf6c8a0, 0xe8b490], alpha: 0.32, drag: 0.15, rot: 6, rotSpeed: 0.2, fadeIn: 0.35 });
    // dust motes in the warm light
    for (let i = this.rate('mote', 7, dt); i > 0; i--) {
      const x = -3.5 + Math.random() * 8, z = 0.5 + Math.random() * 5.5;
      P.emit({ pos: { x, y: 0.3 + Math.random() * 2.4, z }, vel: { x: W.x * 0.18, y: 0.02, z: W.z * 0.18 }, count: 1, spread: 0.05, life: [4, 7], size: [0.012, 0.012], sprite: 'dot2', color: [0xffe0b0, 0xffc890], alpha: 0.55, additive: true, fadeIn: 0.3, sizeJitter: 0.4 });
    }
  }

  // ---------------------------------------------------------------- tumbleweeds, vultures, meteors
  private updateWorldLife(dt: number) {
    const t = this.t;
    const g = this.gust;
    for (const w of this.weeds) {
      if (!w.on) {
        if (t < w.next) continue;
        w.on = true;
        w.x = w.x0;
        w.z = w.far ? -24 - Math.random() * 8 : 3.1 + Math.random() * 1.4;
        w.speed = (w.far ? 6 : 3.6) + Math.random() * 1.2;
        w.m.visible = true;
        w.m.scale.setScalar(w.far ? 1.2 : 0.85);
        w.r = 0.4 * w.m.scale.x;
        if (!w.far) this.engine.audio.play('tumbleweed', { volume: 0.18 });
      }
      w.x += w.speed * g * dt;
      w.z += MS.MENU_WIND.z * w.speed * 0.3 * dt;
      const prev = Math.sin(w.hop);
      w.hop += dt * w.speed * 1.25;
      const s = Math.sin(w.hop);
      const gy = this.gy(w.x, w.z);
      w.m.position.set(w.x, gy + w.r + Math.abs(s) * 0.5 * (0.6 + g * 0.4), w.z);
      w.m.rotation.z -= (w.speed * g * dt) / w.r;
      w.m.rotation.y = Math.sin(t * 0.7) * 0.3;
      if (Math.sign(prev) !== Math.sign(s)) {
        this.particles.emit({ pos: { x: w.x, y: gy + 0.05, z: w.z }, count: w.far ? 2 : 4, spread: 0.6, up: 0.4, life: [0.6, 1.2], size: [0.2, 0.8], sprite: ['puff0', 'puff1', 'puff2'], color: [0xe8c898, 0xd8b080], alpha: 0.45, drag: 2, rot: 6, rotSpeed: 1 });
        if (!w.far) this.particles.emit({ pos: { x: w.x, y: gy + 0.05, z: w.z }, count: 6, spread: 1.4, up: 1, life: [0.4, 0.8], size: [0.025, 0.02], sprite: ['grain0', 'grain1', 'grain2', 'twig'], color: [0xe8c898, 0x9a7448], gravity: 6, ground: true });
      }
      if (w.x > w.x1) {
        w.on = false;
        w.m.visible = false;
        w.next = t + (w.far ? 16 : 20) + Math.random() * 14;
      }
    }
    for (const v of this.vultures) {
      const a = t * 0.085 + v.phase;
      const p = v.c.clone().add(new THREE.Vector3(Math.cos(a) * v.rad, Math.sin(t * 0.3 + v.phase) * 1.5, Math.sin(a) * v.rad));
      v.r.root.position.copy(p);
      v.r.root.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), 0, 'YXZ');
      v.r.root.rotation.z = 0.32;
      let flap = 0;
      if (t > v.flapAt) {
        const k = t - v.flapAt;
        flap = Math.sin(k * 8.5) * Math.sin(Math.min(1, k / 1.8) * Math.PI);
        if (k > 1.8) v.flapAt = t + 5 + Math.random() * 6;
      }
      const n = v.r.nodes;
      if (n['wing_l']) n['wing_l'].rotation.z = 0.1 + flap * 0.55;
      if (n['wing_r']) n['wing_r'].rotation.z = -0.1 - flap * 0.55;
      if (n['tail']) n['tail'].rotation.x = Math.sin(t * 0.8 + v.phase) * 0.08;
      if (n['head']) n['head'].rotation.y = Math.sin(t * 0.5 + v.phase) * 0.4;
    }
    // shooting stars
    const m = this.meteor;
    if (m.start < 0 && t > m.next) {
      const az = -0.9 + Math.random() * 1.6, el = 0.45 + Math.random() * 0.5;
      m.a.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      const side = Math.random() < 0.5 ? -1 : 1;
      m.b.set(m.a.x + side * 0.28, m.a.y - 0.16, m.a.z + side * 0.06).normalize();
      m.start = t;
      this.skyU.uMetA.value.copy(m.a);
      this.skyU.uMetB.value.copy(m.b);
    }
    if (m.start >= 0) {
      const k = (t - m.start) / 0.85;
      this.skyU.uMetT.value = k;
      if (k >= 1) {
        m.start = -1;
        m.next = t + 11 + Math.random() * 16;
        this.skyU.uMetT.value = -1;
      }
    }
  }
}

function smooth01(x: number) {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
}
function dampAngle(a: number, b: number, lambda: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
