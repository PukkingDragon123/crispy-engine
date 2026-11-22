// The backstory: three short scenes (~41 s, hold Space / Enter / Esc / a click to skip), letterboxed,
// every word floating 3D text in the world.
//   1. NIGHT. A travellers' camp in the deep sand: goat-hair tents, a crackling stone fire pit, hanging
//      lanterns, camels chewing. The mother (a shadow) kneels by the fire cradling her cursed baby, a
//      tiny scorpion-child whose claws and little tail peek out of the swaddle. She sings, then cries,
//      her shoulders shaking. The father (a shadow) stands at the edge of the firelight, turned away.
//   2. DAWN. The camp is gone: pole holes, tracks, a cold fire pit with one thread of smoke. The baby
//      lies alone on the sand. The caravan's silhouettes go over the dune into the rising sun (the
//      mother looks back once). Something small crawls up out of the sand and sits beside him.
//   3. YEARS LATER, SUNSET. Sundown drops over the crest of a great dune and carves down it on his
//      board in plumes of backlit sand, skids to a stop, outdraws a shadow outlaw and puts him down,
//      then tears the outlaw's bounty bill off a post, reads it, folds it and pockets it.
// The whole stage is a pure function of the timeline (stage(T)), so it can jump (?bt=seconds) and draw a
// contact sheet of four moments in one frame (?debug=backstory&contact=1). Particles run on top.
// Call order on a new game: the memory loading (ui/loading/MemoryShards) -> playBackstory() -> lore title.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, voxelMesh, type RigSpec } from '../../engine/voxel/Rig';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Noise, hash3 } from '../../engine/math/rand';
import { modelEntry } from '../models/lookup';
import * as CH from '../models/characters';
import * as MS from '../models/props/menuSet';
import * as Hx from '../models/props/hideout';
import { nomadTent, coldFire, tentBundle } from '../models/props/nomadCamp';
import { shadowHumanRig, shadowMaterial, scorpionBabyRig, SHADOW_POSES, applyPose, walkPose, kneelDrop, shadowStaff, type ShadowMaterial, type Pose } from '../models/shadowHuman';
import { CineKit, GRAIN, SAND, PUFF } from './CineKit';
import { FloatText3D } from '../fx/FloatText3D';
import { loadSave } from '../meta/Save';
import { mysteryPhoto, pressPrint, PRINT_W, PRINT_H } from '../ui/WantedPrint';
import { PARCHMENT_GLSL } from '../ui/Choice';

export interface BackstoryOpts {
  /** allow hold-to-skip (default true) */
  skippable?: boolean;
  /** jump straight to this time (s) */
  startAt?: number;
  /** debug: freeze and draw a contact sheet of four moments */
  contact?: boolean;
}

/**
 * Play the backstory cinematic as its own scene. Resolves once it has ended (or was skipped) with the
 * screen faded to black; the caller then sets the next scene (it fades in from black).
 */
export function playBackstory(engine: Engine, opts: BackstoryOpts = {}): Promise<void> {
  return new Promise<void>((res) => {
    const s = new BackstoryScene(engine, opts, res);
    void engine.setScene(s, 0.6, '#000', { loading: 'Remembering' });
  });
}

// ====================================================================== timeline (seconds)
const T_S2 = 15.0, T_S3 = 24.4, T_END = 41.6;
const ss = (x: number) => x * x * (3 - 2 * x);
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => ss(sat((v - a) / (b - a)));
const win = (t: number, a: number, b: number, fi = 0.4, fo = 0.4) => sstep(a, a + fi, t) * (1 - sstep(b - fo, b, t));

interface Line {
  text: string;
  t0: number;
  t1: number;
  at: THREE.Vector3;
  size: number;
  color: string;
  glow: string;
  ft?: FloatText3D;
}

// ====================================================================== the land
function heightFn() {
  const n = new Noise(1717);
  return (x: number, z: number) => {
    const r = Math.hypot(x, z);
    let y = n.fbm2(x * 0.018 + 3, z * 0.018, 3) * 2.4 * sstep(9, 42, r) + n.fbm2(x * 0.06, z * 0.06 + 5, 2) * 0.22 * sstep(4, 13, r);
    // the low dune north of the camp the caravan leaves over
    y += Math.exp(-(((z + 42) / 8) ** 2)) * 6.5 * Math.exp(-((x / 90) ** 2));
    // the great dune of scene 3 (a barchan: long windward back, a steep slip face toward +z)
    const dx = x - 300, dz = z + 60;
    const prof = dz < 0 ? Math.exp(-((dz / 60) ** 2)) : Math.pow(Math.max(0, 1 - dz / 52), 1.55);
    y += 30 * prof * Math.exp(-((dx / 78) ** 2));
    y += Math.sin((x * 0.8 + z * 0.6) * 2.1 + n.n2(x * 0.18, z * 0.18) * 2.6) * 0.025;
    return y;
  };
}
type HFn = (x: number, z: number) => number;
const SANDP = [0xe2bf86, 0xd4a970, 0xefd3a0, 0xc29660];

/** a crisp voxel sand patch with wind ripples; `mark` dents it (tracks, pole holes) and tints it */
function sandPatch(h: HFn, cx: number, cz: number, R: number, vs: number, mark?: (x: number, z: number) => { dy: number; col?: number } | null) {
  const m = new VoxelModel('bs_patch');
  const n = Math.ceil(R / vs);
  const top = (i: number, j: number) => {
    const x = cx + i * vs, z = cz + j * vs;
    const mk = mark?.(x, z);
    return Math.round(h(x, z) / vs) + (mk?.dy ?? 0);
  };
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j > n * n) continue;
      const x = cx + i * vs, z = cz + j * vs;
      const y = top(i, j);
      const lo = Math.min(y, top(i + 1, j), top(i - 1, j), top(i, j + 1), top(i, j - 1)) - 1;
      const rip = Math.sin((x * 0.8 + z * 0.6) * 2.1 + Math.sin(x * 0.4) * 1.3);
      const hv = hash3(i, j, 9);
      let c = rip > 0.55 ? SANDP[2] : rip < -0.6 ? SANDP[1] : SANDP[0];
      if (hv > 0.985) c = SANDP[3];
      if (hv < 0.003) c = 0x8a7660;
      const mk = mark?.(x, z);
      if (mk?.col !== undefined) c = mk.col;
      for (let k = lo; k <= y; k++) m.set(i, k, j, k === y ? c : SANDP[1]);
    }
  const mesh = new THREE.Mesh(buildVoxelGeometry(m, { voxelSize: vs, pivot: [0.5, 1, 0.5], ao: 0.45 }), sharedVoxelMaterial);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = mesh.castShadow = true;
  return mesh;
}

function farGround(h: HFn, holes: [number, number, number][]) {
  const g = new THREE.PlaneGeometry(1000, 1000, 400, 400);
  g.rotateX(-Math.PI / 2);
  g.translate(150, 0, -20);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(SANDP[0]), c1 = new THREE.Color(SANDP[1]), c2 = new THREE.Color(SANDP[2]), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = h(x, z);
    for (const [hx, hz, hr] of holes) if (Math.hypot(x - hx, z - hz) < hr - 0.4) y -= 0.35;
    pos.setY(i, y);
    const s = (h(x + 1, z) - h(x - 1, z)) * 0.5 + (h(x, z + 1) - h(x, z - 1)) * 0.3;
    c.copy(c0).lerp(s > 0 ? c2 : c1, Math.min(1, Math.abs(s) * 1.2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

// ====================================================================== the sky
const SKY_VS = /* glsl */ `varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */ `
uniform vec3 uZen, uHor, uHorSun, uSunDir, uSunCol, uMoonDir;
uniform float uStars, uMoon, uTime, uSunVis;
varying vec3 vDir;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float mu = dot(d, uSunDir);
  vec3 hor = mix(uHor, uHorSun, pow(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 3.0));
  vec3 col = mix(hor, uZen, pow(smoothstep(-0.03, 0.62, y), 0.5));
  // painted cloud streaks low over the horizon
  float cl = vn(vec3(d.x * 7.0, y * 34.0, d.z * 7.0)) * vn(vec3(d.x * 19.0 + 3.0, y * 60.0, d.z * 19.0));
  col = mix(col, hor * 1.25 + uSunCol * 0.08 * uSunVis, smoothstep(0.32, 0.6, cl) * smoothstep(0.02, 0.08, y) * (1.0 - smoothstep(0.12, 0.3, y)) * 0.5);
  col += uSunCol * (pow(max(mu, 0.0), 7.0) * 0.16 + pow(max(mu, 0.0), 60.0) * 0.45) * uSunVis;
  col = mix(col, uSunCol * 1.7, smoothstep(0.99925, 0.9996, mu) * uSunVis);
  if (uStars > 0.01 && y > -0.02) {
    vec3 q = floor(d * 420.0);
    float s = h3(q);
    float mag = step(0.9956, s) * (0.3 + 0.7 * fract(s * 97.0));
    col += mix(vec3(1.0, 0.88, 0.74), vec3(0.75, 0.86, 1.0), fract(s * 31.0)) * mag * uStars * smoothstep(0.0, 0.25, y) * (0.6 + 0.4 * sin(uTime * 2.3 + s * 60.0)) * 1.5;
    float band = exp(-pow((d.z * 0.7 + d.x * 0.7 + 0.18 * sin(d.x * 2.6)) * 3.2, 2.0));
    col += vec3(0.4, 0.45, 0.72) * band * (vn(d * 9.0) * 0.6 + vn(d * 23.0) * 0.4) * 0.1 * uStars * smoothstep(0.0, 0.25, y);
  }
  float mm = dot(d, uMoonDir);
  col += vec3(0.5, 0.58, 0.85) * pow(max(mm, 0.0), 220.0) * 0.32 * uMoon;
  float md = smoothstep(0.99955, 0.99972, mm);
  if (md > 0.0) col = mix(col, vec3(0.96, 0.94, 0.86) * (0.8 + 0.25 * vn(d * 900.0)) * 1.8, md * uMoon);
  if (y < 0.0) col = mix(col, hor * 0.6, smoothstep(0.0, 0.25, -y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Look {
  zen: number;
  hor: number;
  horSun: number;
  sunDir: THREE.Vector3;
  sunCol: number;
  sunVis: number;
  stars: number;
  moon: number;
  key: number;
  keyI: number;
  hemiS: number;
  hemiG: number;
  hemiI: number;
  fog: number;
  fogN: number;
  fogF: number;
}
const LOOKS: Record<'night' | 'dawn' | 'dusk', Look> = {
  night: { zen: 0x04071a, hor: 0x18203e, horSun: 0x1c2448, sunDir: new THREE.Vector3(0.5, 0.62, 0.6).normalize(), sunCol: 0x9aa8e0, sunVis: 0, stars: 1, moon: 1, key: 0x7a8ad0, keyI: 0.32, hemiS: 0x2a3462, hemiG: 0x0c0a12, hemiI: 0.42, fog: 0x0a0e1e, fogN: 26, fogF: 230 },
  dawn: { zen: 0x2a3a72, hor: 0x9a8aa8, horSun: 0xffb07a, sunDir: new THREE.Vector3(0.06, 0.07, -1).normalize(), sunCol: 0xffc08a, sunVis: 1, stars: 0.18, moon: 0.25, key: 0xffb88a, keyI: 1.7, hemiS: 0x8a96c8, hemiG: 0x6a4a3a, hemiI: 0.7, fog: 0xc8a096, fogN: 50, fogF: 380 },
  dusk: { zen: 0x2c3c7a, hor: 0xd6866a, horSun: 0xffa452, sunDir: new THREE.Vector3(-0.5, 0.09, -0.86).normalize(), sunCol: 0xffa65a, sunVis: 1, stars: 0.05, moon: 0, key: 0xffa060, keyI: 2.3, hemiS: 0x8a7aac, hemiG: 0x8a5a3a, hemiI: 0.72, fog: 0xd89a72, fogN: 70, fogF: 560 },
};

// ====================================================================== Sundown's poses (joint angles on his rig)
const RIDE: Pose = { torso: [0.22, 0.4, 0.05], head: [-0.1, 0.78, 0.04], arm_l: [-0.15, 0, 1.05], fore_l: [-0.45, 0, 0], arm_r: [-0.25, 0, -0.85], fore_r: [-0.7, 0, 0], thigh_l: [-0.5, 0, 0.24], shin_l: [0.85, 0, 0], thigh_r: [-0.5, 0, -0.24], shin_r: [0.85, 0, 0] };
const SKID: Pose = { torso: [0.32, 0.1, -0.12], head: [-0.05, 0.2, 0.1], arm_l: [-0.4, 0, 1.3], fore_l: [-0.3, 0, 0], arm_r: [-0.35, 0, -1.1], fore_r: [-0.5, 0, 0], thigh_l: [-0.85, 0, 0.3], shin_l: [1.35, 0, 0], thigh_r: [-0.8, 0, -0.3], shin_r: [1.3, 0, 0] };
const AIM: Pose = { arm_r: [-1.38, 0, -0.08], fore_r: [-0.1, 0, 0], arm_l: [-0.3, 0, 0.25], fore_l: [-0.55, 0, 0], torso: [0.06, 0, 0], head: [0.04, 0, 0], thigh_l: [-0.2, 0, 0.18], shin_l: [0.32, 0, 0], thigh_r: [-0.18, 0, -0.18], shin_r: [0.3, 0, 0] };
const LOWER: Pose = { arm_r: [-0.22, 0, -0.16], fore_r: [-0.55, 0, 0], torso: [0.04, 0.12, 0], head: [0.05, 0.65, 0], thigh_l: [-0.12, 0, 0.16], shin_l: [0.2, 0, 0], thigh_r: [-0.1, 0, -0.16], shin_r: [0.18, 0, 0] };
const GRAB: Pose = { arm_l: [-0.55, 0, 0.95], fore_l: [-0.55, 0, 0], torso: [0.05, 0.45, 0.06], head: [0.1, 0.85, 0] };
const READ: Pose = { arm_l: [-1.15, 0.3, 0.12], fore_l: [-1.35, 0, 0], torso: [0.08, 0.1, 0], head: [0.42, 0.12, 0] };
const TUCK: Pose = { arm_l: [-0.38, 0, -0.32], fore_l: [-1.95, 0, 0], torso: [0.05, 0, 0], head: [0.12, -0.1, 0] };
const GAZE: Pose = { head: [-0.12, -0.45, 0], torso: [0, -0.15, 0] };
const BANDIT_FALL: Pose = { torso: [-0.5, 0.3, 0.1], head: [-0.7, -0.3, 0], arm_r: [-2.4, 0, -0.7], arm_l: [-1.6, 0, 0.9], fore_l: [-0.6, 0, 0], thigh_l: [-0.4, 0, 0.1], shin_l: [0.6, 0, 0] };

// ====================================================================== the scene
type Phase = 'night' | 'dawn' | 'dusk';
interface Act {
  rig: RigInstance;
  rest: Map<string, THREE.Euler>;
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class BackstoryScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.04, 1600);
  ready = false;
  private T = 0;
  private done = false;
  private h: HFn = heightFn();
  private kit!: CineKit;
  private sky!: THREE.Mesh;
  private skyU: Record<string, THREE.IUniform> = {};
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
  private fireL = new THREE.PointLight(0xff8a3a, 0, 24, 1.5);
  private lampL: THREE.PointLight[] = [];
  private fog = new THREE.Fog(0, 10, 100);
  private groups: Record<Phase, THREE.Group> = { night: new THREE.Group(), dawn: new THREE.Group(), dusk: new THREE.Group() };
  private phase: Phase | null = null;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private lines: Line[] = [];
  private loops: { stop(t?: number): void }[] = [];
  // actors
  private mother!: Act;
  private motherMat!: ShadowMaterial;
  private father!: Act;
  private baby!: Act;
  private babyHolder = new THREE.Group();
  private babySand = new THREE.Group();
  private fatherMat!: ShadowMaterial;
  private camels: { a: Act; base: THREE.Vector3; yaw: number; walk: boolean; seed: number }[] = [];
  private walkers: { a: Act; z0: number; x: number; speed: number; seed: number; mount?: number; look?: boolean }[] = [];
  private pinch: Act | null = null;
  private lamps: { a: Act; at: THREE.Vector3 }[] = [];
  private hero!: Act;
  private heroRoot = new THREE.Group();
  private heroTilt = new THREE.Group();
  private heroStance = new THREE.Group();
  private gun: RigInstance | null = null;
  private bandit!: Act;
  private banditMat!: ShadowMaterial;
  private poster!: THREE.Mesh;
  private posterHome = new THREE.Matrix4();
  // places
  private M = new THREE.Vector3(1.5, 0, 1.15); // where the mother kneels
  private F = new THREE.Vector3(-3.6, 0, 2.9); // where the father stands
  private B = new THREE.Vector3(0.95, 0, 0.85); // where the baby lies at dawn
  private S = new THREE.Vector3(300, 0, 20); // where Sundown stops
  private BD = new THREE.Vector3(300, 0, 29.5); // the outlaw
  private P = new THREE.Vector3(300.78, 0, 20.12); // the bounty post
  private ridePts: THREE.Vector3[] = [];
  private ride!: THREE.CatmullRomCurve3;
  // ui
  private fadeEl = document.createElement('div');
  private skipEl = document.createElement('div');
  private hold = 0;
  private holding = false;
  private hintT = 0;
  private keyDown = (e: KeyboardEvent) => {
    if (['Space', 'Enter', 'Escape', 'KeyE'].includes(e.code)) {
      this.holding = true;
      this.hintT = 3;
      e.preventDefault();
    }
  };
  private keyUp = (e: KeyboardEvent) => {
    if (['Space', 'Enter', 'Escape', 'KeyE'].includes(e.code)) this.holding = false;
  };
  private ptrDown = () => {
    this.holding = true;
    this.hintT = 3;
  };
  private ptrUp = () => (this.holding = false);

  constructor(private engine: Engine, private o: BackstoryOpts, private resolve: () => void) {
    this.T = o.startAt ?? +(new URLSearchParams(location.search).get('bt') ?? 0);
  }

  private own<T extends THREE.BufferGeometry>(g: T) {
    this.geos.push(g);
    return g;
  }
  private static(key: string, g: THREE.Group, x: number, z: number, ry = 0, sc = 1, sink = 0.03) {
    try {
      const r = modelEntry(key)?.() as { model?: VoxelModel; voxelSize?: number } | undefined;
      if (!r?.model) return null;
      const m = new THREE.Mesh(this.own(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize!, pivot: 'bottom' })), sharedVoxelMaterial);
      m.castShadow = m.receiveShadow = true;
      m.position.set(x, this.h(x, z) - sink, z);
      m.rotation.y = ry;
      m.scale.setScalar(sc);
      g.add(m);
      return m;
    } catch (e) {
      console.warn('[backstory] prop', key, e);
      return null;
    }
  }
  private act(spec: RigSpec, key: string, mat?: THREE.Material): Act {
    const rig = new RigInstance(buildRigGeo(spec, key), { material: mat as never });
    const rest = new Map<string, THREE.Euler>();
    for (const p of rig.geo.parts) rest.set(p.name, p.rest.clone());
    return { rig, rest };
  }

  async enter() {
    const eng = this.engine;
    const s = this.scene;
    const h = this.h;
    s.fog = this.fog;
    for (const g of Object.values(this.groups)) s.add(g);
    // ---- light and sky
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    s.add(this.sun, this.sun.target, this.hemi, this.fireL);
    this.skyU = {
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uHorSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() }, uStars: { value: 0 }, uMoon: { value: 0 }, uTime: { value: 0 }, uSunVis: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    this.kit = new CineKit(eng, s, { groundAt: h });
    // ---- the ground: one far mesh, crisp voxel patches at the camp (night and dawn) and the dune foot
    s.add(farGround(h, [[0, 0, 13], [300, 24, 10]]));
    await eng.nextFrame();
    this.groups.night.add(sandPatch(h, 0, 0, 13, 0.1));
    const tracks = this.trackMarks();
    this.groups.dawn.add(sandPatch(h, 0, 0, 13, 0.1, tracks));
    this.groups.dusk.add(sandPatch(h, 300, 24, 10, 0.12));
    await eng.nextFrame();
    this.buildCamp();
    await eng.nextFrame();
    this.buildDawn();
    await eng.nextFrame();
    this.buildDusk();
    this.buildLines();
    // ---- ui: our own fade (deterministic on the timeline), the skip hint
    Object.assign(this.fadeEl.style, { position: 'absolute', inset: '0', background: '#000', opacity: '1', pointerEvents: 'none', zIndex: '40' });
    Object.assign(this.skipEl.style, { position: 'absolute', right: '3vw', bottom: '13vh', font: "16px 'Alagard', serif", color: '#e8dcc0', letterSpacing: '2px', opacity: '0', transition: 'opacity .3s', pointerEvents: 'none', zIndex: '41', textShadow: '0 2px 0 #000' });
    this.skipEl.innerHTML = 'HOLD TO SKIP<div style="height:3px;margin-top:5px;background:#3a2a1a"><div style="height:3px;width:0;background:#e8b04a"></div></div>';
    eng.overlay.append(this.fadeEl, this.skipEl);
    if (this.o.skippable !== false) {
      window.addEventListener('keydown', this.keyDown);
      window.addEventListener('keyup', this.keyUp);
      window.addEventListener('pointerdown', this.ptrDown);
      window.addEventListener('pointerup', this.ptrUp);
    }
    eng.letterbox(true, 0.01);
    this.stage(this.T);
    this.ready = true;
    (window as unknown as { __backstory: unknown }).__backstory = this;
  }

  /** where the camp walked away: camel and foot tracks up toward the dune, pole holes, a drag mark, flattened tent floors */
  private trackMarks() {
    const paths: [number, number, number, number, number][] = [
      // x0, z0, x1, z1, kind (0 feet, 1 camel)
      [-7, 3, -3.5, -13, 1], [-8.5, 0.5, -4, -13, 1], [8, 4, 1, -13, 1], [1.6, 1.2, -1.5, -13, 0], [-3.6, 2.9, -2.4, -13, 0], [4.5, -1, 0.5, -13, 0],
    ];
    const holes: [number, number][] = [];
    for (const [tx, tz, ry] of [[-1.5, -6.2, 0.15], [6.4, -2.6, -1.1]] as [number, number, number][])
      for (const px of [-1.9, 0, 1.9]) for (const pz of [-0.75, 1.45]) holes.push([tx + Math.cos(ry) * px + Math.sin(ry) * pz, tz - Math.sin(ry) * px + Math.cos(ry) * pz]);
    return (x: number, z: number) => {
      for (const [hx, hz] of holes) if (Math.hypot(x - hx, z - hz) < 0.07) return { dy: -2, col: 0x9a7a50 };
      for (const [x0, z0, x1, z1, k] of paths) {
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
        const t = ((x - x0) * dx + (z - z0) * dz) / (L * L);
        if (t < 0 || t > 1) continue;
        const along = t * L, lat = ((x - x0) * dz - (z - z0) * dx) / L;
        const step = k ? 0.95 : 0.68, side = (Math.floor(along / step) % 2 ? 1 : -1) * (k ? 0.2 : 0.11);
        const u = (along % step) - step / 2;
        const r = k ? (u / 0.13) ** 2 + ((lat - side) / 0.11) ** 2 : (u / 0.12) ** 2 + ((lat - side) / 0.05) ** 2;
        if (r < 1) return { dy: -1, col: SANDP[3] };
      }
      // a drag mark where something heavy was pulled away
      if (Math.abs(x - 2.2 - (z + 1) * -0.2) < 0.18 && z < -1 && z > -12) return { dy: -1, col: SANDP[1] };
      return null;
    };
  }

  private buildCamp() {
    const g = this.groups.night;
    const h = this.h;
    // tents
    for (const [x, z, ry, seed] of [[-1.5, -6.2, 0.15, 1], [6.4, -2.6, -1.1, 2]] as [number, number, number, number][]) {
      const t = nomadTent(seed);
      const m = new THREE.Mesh(this.own(buildVoxelGeometry(t.model, { voxelSize: t.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
      m.castShadow = m.receiveShadow = true;
      m.position.set(x, h(x, z) - 0.02, z);
      m.rotation.y = ry;
      g.add(m);
      // a lantern under each outer front pole
      for (const hk of [t.meta.hooks[0], t.meta.hooks[2]]) {
        const at = new THREE.Vector3(...hk).applyAxisAngle(UP, ry).add(m.position);
        this.lamp(g, at);
      }
    }
    // the fire
    const fp = MS.firePit();
    const fire = new THREE.Mesh(this.own(buildVoxelGeometry(fp.model, { voxelSize: fp.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
    fire.castShadow = fire.receiveShadow = true;
    fire.position.set(0, h(0, 0) - 0.02, 0);
    g.add(fire);
    const cold = new THREE.Mesh(this.own(buildVoxelGeometry(coldFire(fp.model), { voxelSize: fp.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
    cold.castShadow = cold.receiveShadow = true;
    cold.position.copy(fire.position);
    this.groups.dawn.add(cold);
    // rugs, packs, saddles
    this.static('rug_1', g, 1.75, 1.35, -0.6);
    this.static('rug_2', g, -2.2, -1.4, 0.4);
    for (const [k, x, z, ry] of [['sack_1', 4.2, -0.4, 0.4], ['sack_2', 4.7, 0.2, 1.2], ['sack_3', -4.6, -3.2, 2.0], ['crate_2', -3.9, -3.9, 0.3], ['bedroll', -1.6, -2.4, 1.1], ['pot_1', 0.95, -0.55, 0], ['saddle_rail', 3.4, 3.2, -0.5], ['wood_pile', -1.5, 1.2, 0.6]] as [string, number, number, number][])
      this.static(k, g, x, z, ry);
    // camels: two by the tents, one at the father's side
    const cs = modelEntry('camel')?.() as RigSpec | undefined;
    if (cs?.parts) {
      for (const [x, z, yaw, seed] of [[-7.4, 2.6, 1.9, 1], [-8.8, -0.6, 1.4, 2], [7.6, 4.4, -2.5, 3]] as [number, number, number, number][]) {
        const a = this.act(cs, 'camel:backstory');
        a.rig.root.position.set(x, h(x, z), z);
        a.rig.root.rotation.y = yaw;
        g.add(a.rig.root);
        this.camels.push({ a, base: a.rig.root.position.clone(), yaw, walk: false, seed });
      }
    }
    // the mother, kneeling by the fire, the baby in her arms
    this.motherMat = shadowMaterial({ rim: 0.9, rimColor: 0xff9a4a });
    this.mats.push(this.motherMat);
    this.mother = this.act(shadowHumanRig('mother'), 'shadow:mother', this.motherMat);
    const M = this.M;
    this.mother.rig.root.position.set(M.x, h(M.x, M.z), M.z);
    this.mother.rig.root.rotation.y = Math.atan2(-M.x, -M.z);
    g.add(this.mother.rig.root);
    this.baby = this.act(scorpionBabyRig(), 'scorpion_baby');
    this.babyHolder.add(this.baby.rig.root);
    this.mother.rig.attach('cradle', this.babyHolder);
    this.babyHolder.position.set(-0.03, 0.0, -0.02);
    this.babyHolder.rotation.set(-0.35, 0.12, 0.1);
    // the father, turned away from them at the edge of the light, his staff planted
    const fm = (this.fatherMat = shadowMaterial({ rim: 1.0, rimColor: 0xff8a40 }));
    this.mats.push(fm);
    this.father = this.act(shadowHumanRig('traveller'), 'shadow:traveller', fm);
    const F = this.F;
    this.father.rig.root.position.set(F.x, h(F.x, F.z), F.z);
    this.father.rig.root.rotation.y = Math.atan2(F.x, F.z) + 0.25; // facing out into the dark
    g.add(this.father.rig.root);
    const st = shadowStaff(1.75);
    const staff = voxelMesh(st.model, st.voxelSize, 'center', fm);
    staff.rotation.x = Math.PI / 2;
    const sh = new THREE.Group();
    sh.add(staff);
    this.father.rig.attach('hand_r', sh);
    staff.rotation.set(1.2, 0, 0);
  }

  private lamp(g: THREE.Group, at: THREE.Vector3) {
    try {
      const spec = Hx.lanternRig(0.18, this.lamps.length);
      const a = this.act(spec, 'lantern:backstory:' + this.lamps.length);
      const len = (spec.meta?.length as number) ?? 0.4;
      a.rig.root.position.copy(at).add(new THREE.Vector3(0, -len, 0));
      g.add(a.rig.root);
      this.lamps.push({ a, at: at.clone() });
      const l = new THREE.PointLight(0xffb060, 0, 7, 1.6);
      l.position.copy(at).add(new THREE.Vector3(0, -len * 0.7, 0));
      g.add(l);
      this.lampL.push(l);
    } catch (e) {
      console.warn('[backstory] lantern', e);
    }
  }

  private buildDawn() {
    const g = this.groups.dawn;
    const h = this.h;
    // the caravan: father leading, two riders, the loaded camel, the mother walking last
    const cs = modelEntry('camel')?.() as RigSpec | undefined;
    const rm = shadowMaterial({ rim: 1.2, rimColor: 0xffc49a, rimDir: new THREE.Vector3(0, 0.3, -1) });
    this.mats.push(rm);
    const camelX = [-3.2, -1.4, 0.6];
    if (cs?.parts)
      camelX.forEach((x, i) => {
        const a = this.act(cs, 'camel:backstory');
        g.add(a.rig.root);
        this.camels.push({ a, base: new THREE.Vector3(x, 0, -37.4 - i * 1.6), yaw: Math.PI, walk: true, seed: 10 + i });
        if (i < 2) {
          const r = this.act(shadowHumanRig('rider'), 'shadow:rider', rm);
          a.rig.nodes['body']?.add(r.rig.root);
          r.rig.root.position.set(0, -0.47, -0.1);
          applyPose(r.rig.nodes, r.rest, [[SHADOW_POSES.ride, 1]]);
        } else {
          for (const [dx, sd] of [[0.32, 1], [-0.32, 2]] as [number, number][]) {
            const b = tentBundle(sd);
            const bm = new THREE.Mesh(this.own(buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: 'center' })), sharedVoxelMaterial);
            bm.rotation.y = Math.PI / 2;
            bm.position.set(dx, 0.46, -0.05);
            a.rig.nodes['body']?.add(bm);
          }
        }
      });
    const fa = this.act(shadowHumanRig('traveller'), 'shadow:traveller', rm);
    g.add(fa.rig.root);
    this.walkers.push({ a: fa, x: -4.4, z0: -36.2, speed: 1.15, seed: 1 });
    const mo = this.act(shadowHumanRig('woman'), 'shadow:woman', rm);
    g.add(mo.rig.root);
    this.walkers.push({ a: mo, x: 1.6, z0: -40.4, speed: 1.0, seed: 2, look: true });
    // the baby, alone by the cold fire
    const B = this.B;
    const holder = this.babySand;
    holder.position.set(B.x, h(B.x, B.z) + 0.0, B.z);
    holder.rotation.y = 0.5;
    g.add(holder);
    // something small comes out of the sand to sit with him
    const ps = modelEntry('pinch')?.() as RigSpec | undefined;
    if (ps?.parts) {
      this.pinch = this.act(ps, 'pinch:backstory');
      g.add(this.pinch.rig.root);
    }
    // a stake left behind, a cracked pot
    this.static('pot_2', g, -1.2, -0.9, 1.3, 0.9, 0.12);
  }

  private buildDusk() {
    const g = this.groups.dusk;
    const h = this.h;
    // ---- the ride: over the crest and down the slip face in long carves
    this.ridePts = [[300, -64], [301.5, -57], [296.5, -44], [304, -30], [297.5, -15], [301.5, 0], [300.4, 12], [300, 20]].map(([x, z]) => new THREE.Vector3(x, h(x, z), z));
    this.ride = new THREE.CatmullRomCurve3(this.ridePts, false, 'centripetal');
    for (const v of [this.S, this.BD, this.P]) v.y = h(v.x, v.z);
    // ---- Sundown: his own rig, look, gun and board
    const save = loadSave();
    const look = save.look ?? { hat: 'stetson', outfit: 'punk' };
    let spec = modelEntry(`cowboy_${look.hat}_${look.outfit}`)?.() as RigSpec | undefined;
    if (!spec?.parts) spec = CH.skeletonCowboyRig({ hat: 'stetson', outfit: 'punk' } as never);
    const mat = makeVoxelMaterial();
    this.mats.push(mat);
    this.hero = this.act(spec, spec.name + ':player', mat);
    let gs: RigSpec | undefined;
    try {
      gs = save.gun ? ((CH as unknown as { revolverRig?: (g: unknown) => RigSpec }).revolverRig?.(save.gun)) : undefined;
    } catch {
      gs = undefined;
    }
    gs ??= modelEntry('revolver_standard')?.() as RigSpec | undefined;
    if (gs?.parts) {
      this.gun = new RigInstance(buildRigGeo(gs, gs.name + ':player'), { material: mat });
      const holder = new THREE.Group();
      holder.rotation.x = Math.PI / 2;
      holder.add(this.gun.root);
      if (!this.hero.rig.attach('hand_r', holder)) this.hero.rig.nodes['fore_r']?.add(holder);
    }
    const bm = CH.sandboardModel(((look as { board?: string }).board ?? 'driftwood') as CH.BoardId);
    const board = voxelMesh(bm.model, bm.voxelSize, 'center', mat);
    board.position.y = 0.06;
    this.heroRoot.add(this.heroTilt);
    this.heroTilt.add(board, this.heroStance);
    this.heroStance.rotation.y = -Math.PI / 2;
    this.heroStance.position.y = 0.1;
    this.heroStance.add(this.hero.rig.root);
    g.add(this.heroRoot);
    this.hero.rig.setExpression('determined');
    // ---- the outlaw and his bill on the post
    this.banditMat = shadowMaterial({ rim: 1.3, rimColor: 0xffb070, rimDir: LOOKS.dusk.sunDir });
    this.mats.push(this.banditMat);
    const bs = shadowHumanRig('bandit');
    this.bandit = this.act(bs, 'shadow:bandit', this.banditMat);
    this.bandit.rig.root.position.copy(this.BD);
    this.bandit.rig.root.rotation.y = Math.PI;
    g.add(this.bandit.rig.root);
    const post = this.static('signpost_2', g, this.P.x, this.P.z, -0.2, 1, 0.08);
    this.poster = this.makePoster(bs);
    this.poster.position.set(this.P.x, this.P.y + 1.28, this.P.z + 0.09);
    this.poster.rotation.set(0, -0.2, 0.04);
    this.poster.updateMatrix();
    this.posterHome.copy(this.poster.matrix);
    g.add(this.poster);
    void post;
    // bleached bones and a dead tree by the post
    this.static('skull_cow', g, 298.6, 24.4, 0.6, 0.9);
    this.static('dry_bush_2', g, 302.6, 26, 1.1);
    this.static('cactus_saguaro_dmg1', g, 295.5, 31, 0.4);
  }

  /** the outlaw's bounty bill: his photographed silhouette pressed into a pixel print on parchment */
  private makePoster(spec: RigSpec) {
    const W = PRINT_W, H = PRINT_H;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.textBaseline = 'top';
    const line = (t: string, size: number, y: number, col: string) => {
      c.font = `${size}px Alagard`;
      const w = c.measureText(t).width;
      const k = Math.min(1, (W - 10) / w);
      c.save();
      c.translate(Math.round(W / 2 - (w * k) / 2), y);
      c.scale(k, 1);
      c.fillStyle = col;
      c.fillText(t, 0, 0);
      c.restore();
    };
    line('WANTED', 32, 5, '#2a1a10');
    line('DEAD  OR  ALIVE', 16, 36, '#7a1e12');
    try {
      const photo = mysteryPhoto(this.engine.renderer, buildRigGeo(spec, 'shadow:bandit'));
      if (photo) {
        const pr = pressPrint(photo);
        c.drawImage(pr, Math.round(W / 2 - pr.width / 2), 54);
      }
    } catch (e) {
      console.warn('[backstory] portrait', e);
    }
    line('JUMPIN JACK', 24, 144, '#2a1a10');
    line('REWARD', 16, 180, '#5a3a20');
    line('$ 500', 24, 198, '#7a1e12');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
    const u = { uSeed: { value: 0.37 }, uAspect: { value: W / H } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uAspect;\n${PARCHMENT_GLSL}`)
        .replace(
          '#include <map_fragment>',
          `{ vec2 pUv = vMapUv; float e = paperEdge(pUv, uAspect); float tr = paperTear(pUv, 0.02); if (e < tr) discard;
             vec3 pc = pow(parchment(pUv, uAspect, e, tr), vec3(2.2)); vec4 ink = texture2D(map, pUv);
             pc = mix(pc, ink.rgb, ink.a * (gl_FrontFacing ? 0.92 : 0.25)); diffuseColor.rgb *= pc; }`
        );
    };
    m.customProgramCacheKey = () => 'dustup-backstory-bill';
    this.mats.push(m);
    const mesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.3, 0.3 * (H / W), 4, 6)), m);
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = true;
    return mesh;
  }

  private buildLines() {
    const L = (text: string, t0: number, t1: number, at: THREE.Vector3, size = 0.34, color = '#f2e6cc', glow = '#3a2a1a') => this.lines.push({ text, t0, t1, at, size, color, glow });
    const h = this.h;
    L('Once, a camp in the deep sand.', 0.8, 4.5, new THREE.Vector3(-1.5, 4.2, -2.5), 0.62);
    L('Hush now, little stinger...', 5.2, 8.0, new THREE.Vector3(this.M.x + 0.1, 1.35, this.M.z + 0.45), 0.12, '#ffd9a0', '#5a2a10');
    L('A mother wept for her cursed son.', 7.8, 10.3, new THREE.Vector3(this.M.x - 0.3, 1.75, this.M.z - 0.2), 0.2);
    L('His father could not look at him.', 10.7, 14.0, new THREE.Vector3(this.F.x - 0.9, 2.15, this.F.z + 0.6), 0.24);
    L('At dawn, they were gone.', 15.7, 19.0, new THREE.Vector3(this.B.x + 0.05, h(this.B.x, this.B.z) + 0.62, this.B.z - 0.25), 0.11);
    L('The sand kept him.', 20.6, 23.6, new THREE.Vector3(this.B.x - 0.7, h(this.B.x, this.B.z) + 1.25, this.B.z - 2.5), 0.18);
    L('Years later.', 24.9, 27.6, new THREE.Vector3(312, 8.5, -8), 1.2);
    L('He grew up a bounty hunter.', 35.4, 38.0, new THREE.Vector3(this.S.x - 1.1, this.S.y + 2.25, this.S.z + 0.4), 0.2);
    L('They called him Sundown.', 38.6, 41.4, new THREE.Vector3(this.S.x - 0.6, this.S.y + 2.0, this.S.z + 0.9), 0.24);
  }

  // ==================================================================== the stage, as a function of time
  private setPhase(p: Phase) {
    if (this.phase === p) return;
    this.phase = p;
    for (const [k, g] of Object.entries(this.groups)) g.visible = k === p;
    const L = LOOKS[p];
    const u = this.skyU;
    (u.uZen.value as THREE.Color).setHex(L.zen);
    (u.uHor.value as THREE.Color).setHex(L.hor);
    (u.uHorSun.value as THREE.Color).setHex(L.horSun);
    (u.uSunDir.value as THREE.Vector3).copy(L.sunDir);
    (u.uSunCol.value as THREE.Color).setHex(L.sunCol);
    u.uSunVis.value = L.sunVis;
    u.uStars.value = L.stars;
    u.uMoon.value = L.moon;
    this.sun.color.setHex(L.key);
    this.sun.intensity = L.keyI;
    this.hemi.color.setHex(L.hemiS);
    this.hemi.groundColor.setHex(L.hemiG);
    this.hemi.intensity = L.hemiI;
    this.fog.color.setHex(L.fog);
    this.fog.near = L.fogN;
    this.fog.far = L.fogF;
    this.fireL.visible = p === 'night';
    for (const l of this.lampL) l.visible = p === 'night';
    // the baby moves from his mother's arms to the sand
    if (p === 'night') this.babyHolder.add(this.baby.rig.root);
    else if (p === 'dawn') this.babySand.add(this.baby.rig.root);
    if (p === 'night' || p === 'dawn') this.baby.rig.root.visible = true;
    if (this.o.contact) return;
    const audio = this.engine.audio;
    for (const l of this.loops) l.stop(0.8);
    this.loops.length = 0;
    const lp = audio.loop(p === 'night' ? 'night_loop' : 'wind_loop', p === 'night' ? 0.5 : 0.35);
    if (lp) this.loops.push(lp);
  }

  private keyLight(focus: THREE.Vector3) {
    const d = this.phase === 'night' ? LOOKS.night.sunDir : LOOKS[this.phase ?? 'dusk'].sunDir;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(d, 60);
    this.sun.target.updateMatrixWorld();
  }

  private cam(pos: THREE.Vector3, look: THREE.Vector3, fov: number, t: number, shake = 0.012) {
    const c = this.camera;
    c.position.copy(pos);
    c.position.x += Math.sin(t * 1.3) * shake + Math.sin(t * 3.1) * shake * 0.3;
    c.position.y += Math.sin(t * 1.7 + 1) * shake * 0.8;
    c.lookAt(look);
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  private pose(a: Act, poses: [Pose, number][]) {
    applyPose(a.rig.nodes, a.rest, poses);
  }

  /** everything the timeline decides at time T (no particles: those are fx()) */
  private stage(T: number) {
    const h = this.h;
    const P = T < T_S2 ? 'night' : T < T_S3 ? 'dawn' : 'dusk';
    this.setPhase(P);
    this.skyU.uTime.value = T;
    // ---- camels breathe, chew and flick their tails; on the dune they walk away
    for (const c of this.camels) {
      const n = c.a.rig.nodes;
      const t = T + c.seed * 3.1;
      applyPose(n, c.a.rest, []);
      if (c.walk) {
        const z = c.base.z - Math.max(0, T - 18.6) * 1.15;
        const x = c.base.x;
        c.a.rig.root.position.set(x, h(x, z), z);
        c.a.rig.root.rotation.set(0, c.yaw, 0);
        const ph = t * 4.4;
        for (const [leg, off] of [['leg_fl', 0], ['leg_bl', 0], ['leg_fr', Math.PI], ['leg_br', Math.PI]] as [string, number][]) {
          const s = Math.sin(ph + off);
          if (n[leg]) n[leg].rotation.x += s * 0.38;
          const sh = n[leg.replace('leg', 'shin')];
          if (sh) sh.rotation.x += Math.max(0, Math.cos(ph + off)) * (leg.includes('f') ? -0.55 : 0.55);
        }
        const bp = c.a.rig.geo.parts.find((q) => q.name === 'body');
        if (n.body && bp) n.body.position.y = bp.offset.y + Math.abs(Math.sin(ph)) * 0.04;
        if (n.neck) n.neck.rotation.x += Math.sin(ph * 2) * 0.05;
      } else {
        if (n.neck) n.neck.rotation.x += 0.12 + Math.sin(t * 0.4) * 0.08;
        if (n.head) n.head.rotation.y += Math.sin(t * 0.27) * 0.25;
      }
      if (n.jaw) n.jaw.rotation.x += Math.max(0, Math.sin(t * 5.2)) * 0.12;
      if (n.tail) n.tail.rotation.z += Math.sin(t * 1.3) * 0.25 * Math.max(0, Math.sin(t * 0.31));
    }
    // ---- lanterns swing a little in the night wind
    for (const [i, l] of this.lamps.entries()) {
      const n = l.a.rig.nodes;
      const sw = Math.sin(T * 1.1 + i * 2) * 0.06;
      if (n.chain) n.chain.rotation.set(sw, 0, sw * 0.6);
    }
    if (P === 'night') this.stageNight(T);
    else if (P === 'dawn') this.stageDawn(T);
    else this.stageDusk(T);
    // ---- the fade, and the letterboxed words
    const fade = Math.max(1 - sstep(0, 1.1, T), sstep(14.0, 14.9, T) * (1 - sstep(15.0, 15.8, T)), sstep(23.5, 24.3, T) * (1 - sstep(24.4, 25.2, T)), sstep(40.4, 41.5, T));
    this.fadeEl.style.opacity = fade.toFixed(3);
  }

  private stageNight(T: number) {
    const h = this.h;
    // the mother: kneeling, rocking him, then the sobs come and her shoulders shake
    const mo = this.mother;
    const sob = sstep(7.2, 8.0, T) * (1 - sstep(13.5, 14.5, T));
    const rock = Math.sin(T * 1.7);
    this.pose(mo, [[SHADOW_POSES.kneel, 1], [SHADOW_POSES.cradle, 1]]);
    const n = mo.rig.nodes;
    const shake = Math.sin(T * 23) * 0.5 + Math.sin(T * 31 + 1) * 0.5;
    const heave = Math.max(0, Math.sin(T * 2.6)) * sob;
    n.torso.rotation.x += 0.05 + heave * 0.08 + shake * 0.018 * sob;
    n.torso.rotation.z += rock * 0.05 * (1 - sob * 0.6);
    n.head.rotation.x += 0.08 * sob + shake * 0.025 * sob;
    n.head.rotation.z += -rock * 0.04;
    n.arm_l.rotation.z += shake * 0.03 * sob;
    n.arm_r.rotation.z -= shake * 0.03 * sob;
    n.arm_l.rotation.x += heave * 0.05;
    n.arm_r.rotation.x += heave * 0.05;
    if (n.tail) n.tail.rotation.x += 0.1 + Math.sin(T * 0.9) * 0.04;
    const M = this.M;
    mo.rig.root.position.set(M.x, h(M.x, M.z) - kneelDrop((mo.rig.geo.spec.meta?.hipY as number) ?? 0.93), M.z);
    this.motherMat.rimDir.set(-M.x, 0.4, -M.z).normalize();
    this.babyNow(T, true);
    // the father: still, his head down, only the cloth moving
    const fa = this.father;
    this.pose(fa, [[SHADOW_POSES.away, 1]]);
    const fn = fa.rig.nodes;
    fn.head.rotation.x += Math.sin(T * 0.5) * 0.03;
    if (fn.cape) fn.cape.rotation.x += 0.05 + Math.sin(T * 1.3) * 0.03;
    if (fn.tail) fn.tail.rotation.x += 0.15 + Math.sin(T * 1.7) * 0.05;
    if (fn.robe) fn.robe.rotation.z += Math.sin(T * 1.1) * 0.015;
    this.fatherMat.rimDir.set(-this.F.x, 0.3, -this.F.z).normalize();
    // fire and lantern flicker
    const fl = 0.75 + 0.25 * Math.sin(T * 13.1) * Math.sin(T * 7.3 + 1) + 0.1 * Math.sin(T * 29);
    this.fireL.position.set(0, 0.7, 0);
    this.fireL.intensity = 26 * fl;
    for (const [i, l] of this.lampL.entries()) l.intensity = 3.2 * (0.9 + 0.1 * Math.sin(T * 9 + i * 3));
    // ---- the shots
    const M0 = new THREE.Vector3(M.x, 0.75, M.z);
    if (T < 4.8) {
      const k = ss(sat(T / 4.8));
      this.cam(new THREE.Vector3(-17 + k * 6, 9.5 - k * 5.2, 21 - k * 7.5), new THREE.Vector3(0, 1.2 - k * 0.2, -2.5 + k * 1.5), 42, T, 0.02);
      this.keyLight(new THREE.Vector3(0, 0, -1));
    } else if (T < 10.2) {
      const k = ss(sat((T - 4.8) / 5.4));
      const yaw = Math.atan2(-M.x, -M.z);
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const pos = M0.clone().addScaledVector(side, 2.1 - k * 0.65).addScaledVector(fwd, 0.55 - k * 0.15).add(new THREE.Vector3(0, 0.35 - k * 0.1, 0));
      this.cam(pos, M0.clone().addScaledVector(fwd, 0.18).add(new THREE.Vector3(0, -0.02, 0)), 34 - k * 4, T);
      this.keyLight(M0);
    } else {
      const k = ss(sat((T - 10.2) / 4.3));
      const F = this.F;
      const yaw = Math.atan2(F.x, F.z) + 0.25;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const pos = new THREE.Vector3(F.x, 1.45, F.z).addScaledVector(fwd, 3.2 - k * 0.7).addScaledVector(side, -1.0);
      this.cam(pos, new THREE.Vector3(F.x, 1.35, F.z).addScaledVector(side, 0.55).addScaledVector(fwd, -1.2), 36, T);
      this.keyLight(new THREE.Vector3(F.x, 0, F.z));
    }
  }

  /** the baby's little life: the tail curls and twitches, the claws reach and pinch, the head turns */
  private babyNow(T: number, held: boolean) {
    const n = this.baby.rig.nodes;
    applyPose(n, this.baby.rest, []);
    const reach = held ? 0.5 + 0.5 * Math.sin(T * 0.9) : 0.6 + 0.4 * Math.sin(T * 1.3);
    for (const [s, ph] of [['l', 0], ['r', 1.7]] as [string, number][]) {
      const c = n['claw_' + s];
      if (c) c.rotation.set(Math.sin(T * 1.6 + ph) * 0.18, 0, (s === 'l' ? -1 : 1) * 0.1 - reach * 0.35);
      const f = n['clawf_' + s];
      if (f) f.rotation.z = Math.max(0, Math.sin(T * 3.1 + ph)) * 0.5;
    }
    for (let i = 1; i <= 4; i++) {
      const t = n['tail' + i];
      if (t) t.rotation.set(Math.sin(T * 1.9 - i * 0.6) * 0.06, Math.sin(T * 1.2 - i * 0.5) * 0.1, Math.sin(T * 2.3 - i * 0.7) * 0.12 + (held ? 0 : 0.05));
    }
    if (n.head) n.head.rotation.set(Math.sin(T * 0.7) * 0.12, 0, Math.sin(T * 0.5) * 0.08);
  }

  private stageDawn(T: number) {
    const h = this.h;
    this.babyNow(T, false);
    // ---- the caravan walks away over the dune; the mother looks back once
    for (const w of this.walkers) {
      const z = w.z0 - Math.max(0, T - 18.6) * w.speed;
      const n = w.a.rig.nodes;
      applyPose(n, w.a.rest, [[SHADOW_POSES.idle, 1]]);
      const bob = walkPose(n, (T - 18.6) * w.speed * 5.2 + w.seed, 0.9);
      w.a.rig.root.position.set(w.x, h(w.x, z) + bob, z);
      w.a.rig.root.rotation.y = Math.PI;
      if (w.look) {
        const lk = win(T, 21.0, 22.8, 0.5, 0.6);
        n.head.rotation.y += lk * 2.0;
        n.torso.rotation.y += lk * 0.5;
      } else n.head.rotation.x += 0.2;
    }
    // ---- the little scorpion comes to sit beside him
    if (this.pinch) {
      const B = this.B;
      const k = sstep(20.5, 23.0, T);
      const from = new THREE.Vector3(B.x + 1.5, 0, B.z + 0.9), to = new THREE.Vector3(B.x + 0.32, 0, B.z + 0.22);
      const p = from.clone().lerp(to, k);
      p.y = h(p.x, p.z) - (1 - sstep(20.5, 21.1, T)) * 0.08;
      const r = this.pinch.rig.root;
      r.position.copy(p);
      r.rotation.y = Math.atan2(to.x - from.x, to.z - from.z) * (1 - sstep(22.7, 23.4, T)) + sstep(22.7, 23.4, T) * Math.atan2(B.x - to.x, B.z - to.z);
      r.visible = T > 20.5;
      const n = this.pinch.rig.nodes;
      applyPose(n, this.pinch.rest, []);
      const walking = k > 0 && k < 1 ? 1 : 0;
      for (const [name, node] of Object.entries(n)) {
        const m = /leg_?([lr])(\d)/.exec(name);
        if (m) node.rotation.y += Math.sin(T * 16 + +m[2] * 1.6 + (m[1] === 'l' ? 0 : Math.PI)) * 0.35 * walking;
        if (/^tail\d/.test(name)) node.rotation.x += Math.sin(T * 2 + +name.slice(4)) * 0.05;
      }
    }
    const B0 = new THREE.Vector3(this.B.x, h(this.B.x, this.B.z) + 0.1, this.B.z);
    if (T < 19.5) {
      const k = ss(sat((T - T_S2) / 4.5));
      this.cam(B0.clone().add(new THREE.Vector3(0.95 - k * 0.3, 0.32 - k * 0.08, 0.95 - k * 0.3)), B0.clone().add(new THREE.Vector3(0.0, 0.02, -0.03)), 34, T, 0.006);
      this.keyLight(B0);
    } else {
      const k = ss(sat((T - 19.5) / 4.5));
      this.cam(B0.clone().add(new THREE.Vector3(0.35, 0.45 + k * 0.12, 2.6 + k * 0.4)), new THREE.Vector3(-0.8, 3.6 + k * 0.4, -40), 30, T, 0.008);
      this.keyLight(B0.clone().add(new THREE.Vector3(0, 0, -4)));
    }
  }

  /** the board on the ride curve at time T: position, heading, lean */
  private rideAt(T: number) {
    const k = sat((T - T_S3) / 6.2);
    const u = Math.min(1, k * k * (1.55 - 0.55 * k));
    const p = this.ride.getPointAt(u);
    const tg = this.ride.getTangentAt(Math.min(0.999, u + 0.002));
    const tg2 = this.ride.getTangentAt(Math.min(0.999, u + 0.03));
    const turn = tg.x * tg2.z - tg.z * tg2.x;
    p.y = this.h(p.x, p.z);
    return { p, yaw: Math.atan2(tg.x, tg.z), lean: THREE.MathUtils.clamp(-turn * 30, -0.5, 0.5), u };
  }

  private stageDusk(T: number) {
    const h = this.h;
    const n = this.hero.rig.nodes;
    const S = this.S;
    let pos: THREE.Vector3, yaw: number, lean = 0;
    const tSkid = 30.6;
    if (T < tSkid) {
      const r = this.rideAt(T);
      pos = r.p;
      yaw = r.yaw;
      lean = r.lean;
      this.pose(this.hero, [[RIDE, 1]]);
      n.torso.rotation.z += lean * 0.4;
    } else {
      // skid: the board swings ninety degrees and digs in
      const k = sstep(tSkid, tSkid + 0.9, T);
      const r = this.rideAt(tSkid);
      pos = r.p.clone().lerp(S, 1 - (1 - k) * (1 - k));
      pos.y = h(pos.x, pos.z);
      yaw = r.yaw + (Math.PI / 2 - r.yaw) * ss(k);
      lean = -0.35 * win(T, tSkid, tSkid + 1.3, 0.2, 0.6);
      const aim = win(T, 32.1, 35.0, 0.35, 0.5);
      const grab = win(T, 35.5, 36.4, 0.3, 0.25), read = win(T, 36.2, 38.0, 0.3, 0.3), tuck = win(T, 37.9, 39.3, 0.3, 0.4), gaze = sstep(39.2, 40.2, T);
      const settle = sstep(tSkid + 0.9, 32.1, T);
      this.pose(this.hero, [[SKID, (1 - settle) * (1 - aim)], [LOWER, settle * (1 - aim)], [AIM, aim], [GRAB, grab], [READ, read], [TUCK, tuck], [GAZE, gaze]]);
      // the kick of the shot
      const kick = Math.exp(-Math.max(0, T - 32.8) * 9) * (T > 32.8 ? 1 : 0);
      n.arm_r.rotation.x -= kick * 0.45;
      n.fore_r.rotation.x -= kick * 0.2;
      // the jaw snaps shut after the kill; the tail whips
      if (n.jaw) n.jaw.rotation.x = 0.12 * win(T, 32.9, 33.3, 0.05, 0.15);
      if (n.tail2) n.tail2.rotation.x += Math.sin(T * 6) * 0.15 * win(T, 32.8, 34, 0.1, 0.5);
    }
    if (n.tail1) n.tail1.rotation.x += Math.sin(T * 2.1) * 0.06;
    this.heroRoot.position.copy(pos);
    this.heroRoot.rotation.y = yaw;
    // align the board to the slope, lean into the carve
    const e = 0.6;
    const nrm = _v.set(h(pos.x - e, pos.z) - h(pos.x + e, pos.z), 2 * e, h(pos.x, pos.z - e) - h(pos.x, pos.z + e)).normalize();
    _q.setFromUnitVectors(UP, nrm);
    const inv = new THREE.Quaternion().setFromAxisAngle(UP, -yaw);
    this.heroTilt.quaternion.copy(inv).multiply(_q).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean));
    this.hero.rig.root.position.y = -0.06 - (T > tSkid ? 0.08 * (1 - sstep(tSkid + 0.9, 32.1, T)) : 0);
    // ---- the outlaw: waits, goes for his gun, is thrown back and breaks up into black smoke
    const b = this.bandit;
    const bn = b.rig.nodes;
    const hit = sstep(32.82, 33.4, T);
    this.pose(b, [[SHADOW_POSES.idle, 1 - hit], [SHADOW_POSES.draw, win(T, 31.6, 33.0, 0.8, 0.2) * 0.7], [BANDIT_FALL, hit]]);
    bn.head.rotation.y += Math.sin(T * 0.8) * 0.1 * (1 - hit);
    if (bn.cape) bn.cape.rotation.x += 0.05 + Math.sin(T * 2.1) * 0.03;
    const fall = sstep(33.1, 33.9, T);
    b.rig.root.position.set(this.BD.x, this.BD.y + Math.sin(sat((T - 32.82) / 0.9) * Math.PI) * 0.25 * (T > 32.82 ? 1 : 0), this.BD.z + hit * 1.3);
    b.rig.root.rotation.set(-fall * 1.42, Math.PI, 0);
    b.rig.root.position.y += fall * 0.12;
    this.banditMat.dissolve = sstep(34.0, 35.4, T);
    b.rig.root.visible = T < 35.5;
    // ---- the bill: on its post, torn off, read, folded and pocketed
    const tear = 35.95;
    if (T < tear) {
      this.poster.matrix.copy(this.posterHome);
      this.poster.matrix.decompose(this.poster.position, this.poster.quaternion, this.poster.scale);
      this.poster.rotation.z += Math.sin(T * 3.1) * 0.03;
      this.poster.visible = true;
    } else {
      this.scene.updateMatrixWorld();
      const hand = this.hero.rig.sockets['hand_l']?.getWorldPosition(_v2) ?? _v2.copy(S);
      const head = (this.hero.rig.nodes.head ?? this.hero.rig.root).getWorldPosition(new THREE.Vector3());
      const k = sstep(tear, tear + 0.35, T);
      const home = new THREE.Vector3().setFromMatrixPosition(this.posterHome);
      const held = hand.clone().add(new THREE.Vector3(0, 0.02, 0)).lerp(head, 0.08);
      this.poster.position.copy(home).lerp(held, k);
      _m.lookAt(head, this.poster.position, UP);
      const qh = new THREE.Quaternion().setFromRotationMatrix(_m);
      const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.posterHome));
      this.poster.quaternion.copy(q0).slerp(qh, k);
      const fold = sstep(37.9, 38.5, T);
      this.poster.scale.set(1 - fold * 0.5, 1 - sstep(38.4, 38.9, T) * 0.5, 1);
      this.poster.visible = T < 39.0;
    }
    // ---- the shots
    const H0 = pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    if (T < 27.6) {
      const k = ss(sat((T - T_S3) / 3.2));
      this.cam(new THREE.Vector3(321 - k * 3, h(318, 4) + 2.4, 4 - k * 2), H0.clone().lerp(new THREE.Vector3(300, 14, -40), 0.35 * (1 - k)), 38, T, 0.03);
      this.keyLight(pos);
    } else if (T < tSkid) {
      const r = this.rideAt(T);
      const fwd = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const cp = pos.clone().addScaledVector(side, -3.4).addScaledVector(fwd, 1.2);
      cp.y = Math.max(h(cp.x, cp.z) + 0.6, pos.y + 0.75);
      this.cam(cp, H0.clone().addScaledVector(fwd, 1.6), 50, T, 0.05);
      this.keyLight(pos);
    } else if (T < 33.2) {
      const B = this.BD;
      this.cam(new THREE.Vector3(B.x + 0.75, B.y + 1.72, B.z + 1.55), new THREE.Vector3(S.x - 0.2, S.y + 1.05, S.z), 34, T, 0.01);
      this.keyLight(S.clone().lerp(B, 0.5));
    } else if (T < 35.2) {
      const k = ss(sat((T - 33.2) / 2));
      this.cam(new THREE.Vector3(S.x - 0.75, S.y + 1.45, S.z - 1.35 - k * 0.3), new THREE.Vector3(this.BD.x, this.BD.y + 0.7, this.BD.z + 0.8), 36, T, 0.008);
      this.keyLight(S.clone().lerp(this.BD, 0.5));
    } else {
      const k = ss(sat((T - 35.2) / 6));
      const up = sstep(39.0, 41.5, T);
      this.cam(new THREE.Vector3(S.x - 1.35 - up * 0.6, S.y + 1.45 + up * 0.9, S.z + 2.3 + k * 0.3 + up * 1.2), new THREE.Vector3(S.x + 0.3 - up * 0.4, S.y + 1.3 + up * 0.25, S.z + 0.1), 34 + up * 6, T, 0.008);
      this.keyLight(S);
    }
  }

  // ==================================================================== particles and sound (playback only)
  private fx(T: number, dt: number) {
    const P = this.kit.particles;
    const chance = (r: number) => Math.random() < r * dt;
    if (T < T_S2) {
      // fire: pixel flames, sparks, embers, smoke
      P.emit({ pos: { x: 0, y: 0.15, z: 0 }, count: 2, spread: 0.25, up: 1.6, life: [0.35, 0.7], size: [0.34, 0.08], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], animate: true, additive: true, color: [0xffffff], jitter: 0.16, gravity: -2 });
      if (chance(14)) P.emit({ pos: { x: 0, y: 0.4, z: 0 }, count: 1, spread: 0.5, up: 2.6, life: [1.2, 2.6], size: [0.035, 0.012], sprite: 'dot3', additive: true, color: [0xffd080, 0xffa040, 0xff6a1a], gravity: -0.4, drag: 0.6, jitter: 0.2 });
      if (chance(4)) P.emit({ pos: { x: 0, y: 1.0, z: 0 }, count: 1, vel: { x: 0.25, y: 0.8, z: 0.1 }, spread: 0.2, life: [2.5, 4], size: [0.3, 1.2], sprite: PUFF, color: [0x2a2630, 0x3a3440], alpha: 0.32, drag: 0.6, rot: 6, rotSpeed: 0.3 });
      if (T > 4.8 && T < 10.2 && chance(3)) P.emit({ pos: { x: this.M.x, y: 1.0, z: this.M.z }, count: 1, spread: 0.4, up: 0.3, life: [1.5, 3], size: [0.02, 0.01], sprite: 'dot2', additive: true, color: 0xffe0a0, jitter: 0.5, gravity: -0.1, drag: 0.5 });
    } else if (T < T_S3) {
      // the cold pit's last thread of smoke, grains in the dawn wind
      if (chance(3)) P.emit({ pos: { x: 0.05, y: 0.12, z: 0 }, count: 1, vel: { x: 0.12, y: 0.35, z: 0.05 }, spread: 0.05, life: [3, 5], size: [0.07, 0.5], sprite: PUFF, color: [0x8a8290, 0xa8a0a8], alpha: 0.3, drag: 0.4, rot: 6, rotSpeed: 0.2 });
      if (chance(20)) P.emit({ pos: { x: this.B.x - 3 + Math.random() * 6, y: 0.06, z: this.B.z - 2 + Math.random() * 4 }, count: 1, vel: { x: 1.6, y: 0.1, z: 0.4 }, spread: 0.3, life: [0.8, 1.6], size: [0.03, 0.02], sprite: GRAIN, color: SAND, gravity: 1, drag: 0.3 });
    } else {
      // sand streaming off the crest; the board's spray; the skid wall; the shot; the outlaw's smoke
      if (chance(30)) {
        const x = 270 + Math.random() * 60, z = -60 + (Math.random() - 0.5) * 4;
        P.emit({ pos: { x, y: this.h(x, z) + 0.1, z }, count: 2, vel: { x: 0.5, y: 0.4, z: 3.2 }, spread: 0.6, life: [1.2, 2.4], size: [0.12, 0.06], sprite: GRAIN, color: SAND, gravity: 0.5, drag: 0.2, jitter: 0.3 });
      }
      const r = this.heroRoot;
      const tSkid = 30.6;
      if (T < tSkid + 1.0 && T > T_S3 + 0.3) {
        const yaw = r.rotation.y;
        const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
        const skid = T > tSkid ? 1 - sstep(tSkid, tSkid + 1.0, T) : 0;
        const tail = { x: r.position.x - fwd.x * 0.5, y: r.position.y + 0.05, z: r.position.z - fwd.z * 0.5 };
        if (skid > 0) {
          P.emit({ pos: { x: r.position.x, y: r.position.y + 0.1, z: r.position.z }, count: Math.round(10 * skid), vel: { x: 0, y: 3.4, z: 6 }, spread: 2.2, life: [0.6, 1.4], size: [0.08, 0.05], sprite: GRAIN, color: SAND, gravity: 11, ground: true, bounce: 0.2, jitter: 0.3 });
          if (chance(18)) P.emit({ pos: { x: r.position.x, y: r.position.y + 0.3, z: r.position.z + 0.4 }, count: 1, vel: { x: 0, y: 0.8, z: 2.4 }, spread: 0.8, life: [1, 2], size: [0.5, 1.6], sprite: PUFF, color: [0xf0c890, 0xe0b070], alpha: 0.5, drag: 1.6, rot: 6, rotSpeed: 0.5 });
        } else {
          P.emit({ pos: tail, count: 3, vel: { x: -fwd.x * 3, y: 2.2, z: -fwd.z * 3 }, spread: 1.4, life: [0.5, 1.1], size: [0.07, 0.05], sprite: GRAIN, color: SAND, gravity: 10, ground: true, bounce: 0.2, jitter: 0.15 });
          if (chance(9)) P.emit({ pos: tail, count: 1, vel: { x: -fwd.x * 1.5, y: 0.6, z: -fwd.z * 1.5 }, spread: 0.6, life: [1, 2.2], size: [0.4, 1.4], sprite: PUFF, color: [0xf6d4a0, 0xffc890], alpha: 0.45, drag: 1.4, rot: 6, rotSpeed: 0.4 });
        }
      }
      if (T >= 32.8 && T - dt < 32.8) {
        this.scene.updateMatrixWorld();
        const m = this.hero.rig.sockets['hand_r']?.getWorldPosition(new THREE.Vector3()) ?? this.S.clone();
        m.z += 0.32;
        m.y += 0.05;
        P.emit({ pos: m, count: 2, life: [0.06, 0.1], size: [0.5, 0.9], sprite: ['flash0', 'glow32'], additive: true, color: 0xfff0c0, sizeJitter: 0 });
        P.emit({ pos: m, count: 18, vel: { x: 0, y: 0.4, z: 5 }, spread: 3, life: [0.15, 0.4], size: [0.05, 0.01], sprite: 'spark', additive: true, color: [0xfff2c0, 0xffc050], stretch: 0.04, gravity: 4 });
        P.emit({ pos: m, count: 4, vel: { x: 0, y: 0.4, z: 1.2 }, spread: 0.4, life: [1.4, 2.4], size: [0.15, 0.6], sprite: PUFF, color: 0xd8d0c8, alpha: 0.4, drag: 1.2, rot: 6, rotSpeed: 0.4 });
        this.kit.light(m, 0xffc070, 30, 0.14, 9);
        this.engine.flash(0xfff0d0, 0.14, 0.1);
        this.kit.sfx('rev_shot', null, 1);
        this.kit.sfx('ricochet', null, 0.25, 0.8);
        const b = this.BD;
        P.emit({ pos: { x: b.x, y: b.y + 1.3, z: b.z }, count: 16, vel: { x: 0, y: 1, z: 3 }, spread: 1.4, life: [0.5, 1.2], size: [0.06, 0.03], sprite: GRAIN, color: [0x0a080c, 0x1a161e], gravity: 6 });
      }
      if (T > 34.0 && T < 35.6 && chance(26)) {
        const b = this.bandit.rig.root.position;
        P.emit({ pos: { x: b.x + (Math.random() - 0.5) * 0.6, y: b.y + 0.2 + Math.random() * 0.5, z: b.z + 0.5 + Math.random() * 1.2 }, count: 1, vel: { x: 0.3, y: 0.9, z: 0.4 }, spread: 0.4, life: [1.4, 2.6], size: [0.18, 0.7], sprite: PUFF, color: [0x08060a, 0x16121a], alpha: 0.7, drag: 0.8, rot: 6, rotSpeed: 0.4 });
      }
      // the cigarette smokes
      if (chance(2.5)) {
        const tip = this.hero.rig.sockets['cig_tip'];
        if (tip) {
          const p = tip.getWorldPosition(new THREE.Vector3());
          P.emit({ pos: p, count: 1, vel: { x: 0.05, y: 0.32, z: 0.05 }, spread: 0.04, life: [1.4, 2.4], size: [0.03, 0.16], sprite: PUFF, color: 0xd8d0c8, alpha: 0.35, drag: 0.4, rot: 6, rotSpeed: 0.3 });
        }
      }
    }
    // one-shot sounds
    const at = (t: number) => T >= t && T - dt < t;
    if (at(1.2)) this.kit.sfx('camel_grunt', null, 0.35, 0.9);
    if (at(11.4)) this.kit.sfx('camel_grunt', null, 0.4, 0.8);
    if (at(T_S3 + 0.4)) this.kit.sfx('whoosh_big', null, 0.5, 0.7);
    if (at(27.6)) this.kit.sfx('board_jump', null, 0.5);
    if (at(30.6)) this.kit.sfx('sand_spray', null, 0.9);
    if (at(32.3)) this.kit.sfx('rev_hammer', null, 0.8);
    if (at(35.95)) this.kit.sfx('paper_flutter', null, 0.8);
    if (at(34.0)) this.kit.sfx('soul_leave', null, 0.5, 0.8);
  }

  private texts(T: number, dt: number) {
    for (const l of this.lines) {
      const on = T >= l.t0 && T < l.t1;
      if (on && !l.ft) {
        l.ft = new FloatText3D(l.text, { size: l.size, color: l.color, glow: l.glow, cps: 26, wrap: 40, hdr: 1.05, px: 72 });
        l.ft.anchor.copy(l.at);
        this.scene.add(l.ft.mesh);
        l.ft.show(true);
      }
      if (!l.ft) continue;
      if (!on) l.ft.show(false);
      l.ft.update(dt, this.camera);
      if (!on && (T > l.t1 + 1.2 || T < l.t0)) {
        l.ft.mesh.removeFromParent();
        l.ft.dispose();
        l.ft = undefined;
      }
    }
  }

  update(_dt: number, rdt: number) {
    if (!this.ready) return;
    const dt = Math.min(Math.max(rdt, 0), 1 / 24);
    if (this.o.contact) return;
    // the film starts once the loading cover (the memory glass's flare) has gone
    if (this.engine.loader?.shown) return;
    // hold to skip
    this.hintT = Math.max(0, this.hintT - dt);
    this.hold = this.holding ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    this.skipEl.style.opacity = this.hintT > 0 || this.hold > 0 ? '1' : '0';
    (this.skipEl.querySelector('div > div') as HTMLElement).style.width = Math.min(100, (this.hold / 0.8) * 100) + '%';
    if (this.hold > 0.8 && !this.done && this.T < T_END - 1.2) this.T = Math.max(this.T, T_END - 1.2);
    const prev = this.T;
    this.T = Math.min(T_END, this.T + dt);
    this.stage(this.T);
    this.fx(this.T, this.T - prev || dt);
    this.texts(this.T, dt);
    this.kit.update(dt);
    if (this.T >= T_END && !this.done) this.finish();
  }

  /** debug: four moments of the film in one frame (one per quadrant) */
  postRender(r: THREE.WebGLRenderer) {
    if (!this.o.contact || !this.ready) return;
    const w = r.domElement.width / r.getPixelRatio(), hh = r.domElement.height / r.getPixelRatio();
    const times = [8.6, 12.4, 21.6, 29.2];
    const old = r.getScissorTest();
    r.setScissorTest(true);
    r.autoClear = false;
    times.forEach((t, i) => {
      this.stage(t);
      const x = (i % 2) * (w / 2), y = (1 - Math.floor(i / 2)) * (hh / 2);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
      r.setViewport(x, y, w / 2, hh / 2);
      r.setScissor(x, y, w / 2, hh / 2);
      r.clear();
      r.render(this.scene, this.camera);
    });
    r.setScissorTest(old);
    r.setViewport(0, 0, w, hh);
    r.autoClear = true;
    this.fadeEl.style.opacity = '0';
  }

  private finish() {
    this.done = true;
    this.engine.fadeEl.style.background = '#000';
    this.engine.fadeEl.style.opacity = '1';
    this.resolve();
  }

  exit() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerdown', this.ptrDown);
    window.removeEventListener('pointerup', this.ptrUp);
    this.engine.letterbox(false);
    this.fadeEl.remove();
    this.skipEl.remove();
    for (const l of this.loops) l.stop(0.5);
    for (const l of this.lines) l.ft?.dispose();
    this.kit?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    if (!this.done) {
      this.done = true;
      this.resolve();
    }
  }
}
