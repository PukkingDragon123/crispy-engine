// The end of the hunt. When a run truly ends (a second death, or a failed Weighing
// of the Heart) this cinematic plays before the hideout:
//   1. the killing blow, again, in slow motion from a low dramatic angle: the killer
//      winds up and strikes, Sundown is thrown back, his hat tumbles off, the gun
//      spins out of his hand and drops into the sand, the board skids away, and he
//      crumples to his knees and onto his back;
//   2. the killer gloats over the body (enemies dance), the camera cranes up and
//      away, then tilts up into the SKY;
//   3. a time-lapse: the sun arcs and sets, the stars wheel round the pole, the moon
//      passes, dawn breaks, again and again; the sand drifts over the body, and a big
//      Alagard "N DAYS PASSED…" counts the sunrises;
//   4. the last sunrise blooms to white and dissolves into the hideout, where he wakes
//      up on the couch (HubScene's wake arrival) and his WANTED poster gets nailed up.
// Space / Enter / Esc / click skips straight to the hideout.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { Env, EnvPreset, PRESETS } from '../world/Env';
import { ATMO, ATMO_HAZE_GLSL, globalUniforms, sharedVoxelMaterial, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { Noise, hash3 } from '../../engine/math/rand';
import { Particles } from '../fx/Particles';
import { modelEntry } from '../models/lookup';
import type { EnemyDef } from '../enemies/EnemyDefs';
import { Puppet } from '../ui/codex/Puppet';
import { HubScene } from './HubScene';
import { nav } from '../Nav';
import type { PosterData, RunResult } from './ResultsScene';

export interface DeathCineKiller {
  name: string;
  def?: EnemyDef;
  rigKey?: string;
  alpha?: boolean;
  /** bosses: their rig */
  spec?: RigSpec;
  scale?: number;
}

export interface DeathCineOpts {
  hero: RigSpec | null;
  gun: RigSpec | null;
  board: THREE.BufferGeometry | null;
  killer: DeathCineKiller | null;
  area: 'A' | 'B' | 'C';
  seed: number;
  /** sunrises until he wakes up at home */
  days: number;
  result: PosterData;
}

/**
 * Gather what the cinematic needs from a run (duck-typed RunScene): the hunter's rig, gun and board,
 * and his killer (the nearest attacker, bosses first).
 */
export function deathCineFromRun(run: any, result: RunResult): DeathCineOpts {
  const p = run.player;
  const pos: THREE.Vector3 = p?.pos ?? new THREE.Vector3();
  let best: any = null, bs = Infinity;
  for (const e of (run.enemies?.list ?? []) as any[]) {
    if (!e?.alive || !e.pos) continue;
    const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
    if (d > 32) continue;
    const busy = e.state === 'strike' || e.state === 'recover' || e.state === 'windup' || e.state === 'leap' || e.state === 'charge';
    const s = d - (e.isBoss ? 18 : 0) - (busy ? 6 : 0);
    if (s < bs) {
      bs = s;
      best = e;
    }
  }
  let killer: DeathCineKiller | null = null;
  if (best?.def) killer = { name: best.name, def: best.def, rigKey: best.rigKey, alpha: !!best.alpha };
  else if (best?.rig?.geo?.spec) killer = { name: best.name, spec: best.rig.geo.spec, scale: best.scale ?? 1 };
  const r = result.run;
  const seed = ((run.opts?.seed ?? 1) * 131 + r.kills * 7 + r.wave * 13) >>> 0;
  return {
    hero: p?.rig?.geo?.spec ?? result.hero ?? null,
    gun: p?.gun?.geo?.spec ?? null,
    board: p?.boardMesh?.geometry ?? null,
    killer,
    area: run.opts?.area ?? 'A',
    seed,
    days: 2 + (seed % 5),
    result: { run: { ...r }, won: false, bosses: [...result.bosses], hero: result.hero ?? p?.rig?.geo?.spec ?? null, banked: result.banked },
  };
}

// ======================================================================= the land
const SANDS: Record<string, number[]> = {
  A: [0xe8c48a, 0xd9ad70, 0xf2d6a2, 0xc99a5e],
  B: [0xd8bf8e, 0xc9a874, 0xe6d2a4, 0xb08c5a],
  C: [0xd99a68, 0xc8834e, 0xe8b07e, 0xa86a40],
};

function heightFn(seed: number) {
  const n = new Noise(seed);
  return (x: number, z: number) => {
    const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
    const r = Math.hypot(x, z);
    const big = n.ridged2(u * 0.0075 + 3.1, v * 0.014, 3) * 15;
    const mid = n.fbm2(x * 0.03 + 7, z * 0.03, 3) * 2.6;
    const fl = Math.min(1, Math.max(0, (r - 2.4) / 22));
    const flat = fl * fl * (3 - 2 * fl);
    const ripple = Math.sin(u * 2.1 + n.n2(x * 0.18, z * 0.18) * 2.6) * 0.03;
    return (big + mid - 2.4) * flat + ripple;
  };
}

/** the patch he dies on: fine voxel sand with wind ripples, pebbles and a few bleached bones */
function nearGround(h: (x: number, z: number) => number, area: string, seed: number) {
  const VS = 0.15, R = 84;
  const m = new VoxelModel('death_ground');
  const pal = SANDS[area] ?? SANDS.A;
  const hi = (i: number, j: number) => Math.round(h(i * VS, j * VS) / VS);
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++) {
      if (i * i + j * j > R * R) continue;
      const y = hi(i, j);
      const lo = Math.min(y, hi(i + 1, j), hi(i - 1, j), hi(i, j + 1), hi(i, j - 1)) - 1;
      const x = i * VS, z = j * VS;
      const rip = Math.sin((x * 0.8 + z * 0.6) * 2.1 + Math.sin(x * 0.4) * 1.3);
      const n = hash3(i, j, seed);
      let c = rip > 0.55 ? pal[2] : rip < -0.6 ? pal[1] : pal[0];
      if (n > 0.985) c = pal[3];
      if (n < 0.004) c = 0x8a7660; // a pebble
      for (let k = lo; k <= y; k++) m.set(i, k, j, k === y ? c : pal[1]);
    }
  return buildVoxelGeometry(m, { voxelSize: VS, pivot: [0.5, 1, 0.5], ao: 0.8 });
}

/** the dunes out to the horizon (smooth, sampled from the same field; sunk under the near patch) */
function farGround(h: (x: number, z: number) => number, area: string) {
  const g = new THREE.PlaneGeometry(900, 900, 220, 220);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const pal = SANDS[area] ?? SANDS.A;
  const c0 = new THREE.Color(pal[0]), c1 = new THREE.Color(pal[1]), c2 = new THREE.Color(pal[2]), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // finer near the middle, coarser far away (squash the grid toward the centre)
    const r = Math.hypot(x, z);
    const k = r < 1 ? 1 : Math.pow(r / 450, 1.6) * 450 / r;
    const X = x * k, Z = z * k;
    const R = Math.hypot(X, Z);
    const y = h(X, Z) - (R < 12.4 ? 0.35 : 0);
    pos.setXYZ(i, X, y, Z);
    const s = (h(X + 1, Z) - h(X - 1, Z)) * 0.5;
    c.copy(c0).lerp(s > 0 ? c2 : c1, Math.min(1, Math.abs(s) * 1.4));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** a low drift of sand that rises over the body as the days pass */
function driftModel(seed: number, area: string) {
  const m = new VoxelModel('drift');
  const pal = SANDS[area] ?? SANDS.A;
  for (let x = -9; x <= 9; x++)
    for (let z = -16; z <= 6; z++)
      for (let y = 0; y <= 5; y++) {
        const d = (x / 9.5) ** 2 + ((z + 5) / 11.5) ** 2 + (y / 5.2) ** 2 + (hash3(x, z, seed) - 0.5) * 0.12;
        if (d < 1) m.set(x, y, z, y >= 4 || d > 0.8 ? pal[0] : pal[1]);
      }
  return buildVoxelGeometry(m, { voxelSize: 0.06, pivot: [0.5, 0, 0.5] });
}

// ======================================================================= the sky
const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uGround, fogColor, uSunDir, uSunCol, uMoonDir;
uniform mat4 uAtmo;
uniform mat3 uStarRot;
uniform float uStars, uTime, uMoon, uNight, uSunVis;
varying vec3 vDir;
${ATMO_HAZE_GLSL}
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 hz = atmoHaze(d, fogColor);
  float t = clamp(y, 0.0, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  float g = pow(smoothstep(0.0, 0.75, t), 0.55);
  g *= 1.0 - 0.3 * pow(mu, 3.0) * (1.0 - t);
  vec3 col = mix(hz, uZenith, g);
  col += hz * 0.07 * exp(-abs(y) * 36.0);
  if (y < 0.0) col = mix(hz, uGround, smoothstep(0.0, 0.35, -y) * 0.35);
  // stars: fixed to the celestial sphere, wheeling round the pole; a faint milky way
  vec3 sd = uStarRot * d;
  if (uStars > 0.01 && y > -0.02) {
    vec3 q = floor(sd * 420.0);
    float s = h3(q);
    float tw = 0.55 + 0.45 * sin(uTime * 2.3 + s * 60.0);
    float mag = step(0.9958, s) * (0.35 + 0.65 * fract(s * 97.0));
    vec3 sc = mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.85, 1.0), fract(s * 31.0));
    float lowFade = smoothstep(0.0, 0.25, y);
    col += sc * mag * tw * uStars * lowFade * 1.6;
    float band = exp(-pow((sd.z + 0.18 * sin(sd.x * 2.6)) * 3.4, 2.0));
    float cl = vn(sd * 9.0) * 0.6 + vn(sd * 23.0) * 0.4;
    col += vec3(0.42, 0.46, 0.7) * band * cl * 0.09 * uStars * lowFade;
  }
  // the sun: forward glow + a limb-darkened disk
  col += uSunCol * 0.05 * (pow(mu, 6.0) * 0.45 + pow(mu, 48.0) * 1.1 + pow(mu, 420.0) * 3.0) * uSunVis;
  float disk = smoothstep(0.99955, 0.99972, dot(d, uSunDir));
  col = mix(col, uSunCol * (0.72 + 0.28 * smoothstep(0.99955, 0.99993, dot(d, uSunDir))), disk * uSunVis);
  // the moon: a pale cratered disk with a soft halo, lit on the sun side
  float mm = dot(d, uMoonDir);
  col += vec3(0.62, 0.7, 0.9) * pow(max(mm, 0.0), 300.0) * 0.35 * uMoon;
  float md = smoothstep(0.99962, 0.99976, mm);
  if (md > 0.0) {
    vec3 mu2 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 mv2 = cross(mu2, uMoonDir);
    vec2 mp = vec2(dot(d, mu2), dot(d, mv2)) / 0.0219;
    float crat = vn(vec3(mp * 3.2, 1.7)) * 0.6 + vn(vec3(mp * 7.0, 4.1)) * 0.4;
    float lit = clamp(0.35 + 0.65 * dot(normalize(vec3(mp, sqrt(max(0.0, 1.0 - dot(mp, mp))))), normalize(vec3(dot(uSunDir, mu2), dot(uSunDir, mv2), 0.6))), 0.12, 1.0);
    vec3 mc = vec3(0.95, 0.93, 0.86) * (0.78 + 0.3 * crat) * lit * 2.2;
    col = mix(col, mc, md * uMoon);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const LAT = THREE.MathUtils.degToRad(32);
const POLE = new THREE.Vector3(0, Math.sin(LAT), Math.cos(LAT));
const MER = new THREE.Vector3(0, Math.cos(LAT), -Math.sin(LAT));
const WEST = new THREE.Vector3(-1, 0, 0);
/** a body on the celestial sphere at hour angle H (0 = due south, highest) and declination dec */
function celestial(H: number, dec: number, out: THREE.Vector3) {
  return out.copy(MER).multiplyScalar(Math.cos(H)).addScaledVector(WEST, Math.sin(H)).multiplyScalar(Math.cos(dec)).addScaledVector(POLE, Math.sin(dec)).normalize();
}

const DUSK: EnvPreset = { zenith: 0x1c2452, horizon: 0xd8704a, ground: 0x5a3a3a, sunColor: 0xff7a52, sunIntensity: 0.8, sunElev: 2, sunAzim: 250, hemiSky: 0x6070a8, hemiGround: 0x4a3030, hemiIntensity: 0.75, fog: 0x6a5a7c, fogNear: 30, fogFar: 320, exposure: 1, stars: 0.55, clouds: 0.5, cloudColor: 0xb07a8a };
const DAWN: EnvPreset = { ...DUSK, horizon: 0xf0a07a, zenith: 0x2a3a6e, fog: 0x8a7a96, cloudColor: 0xe0a0a8, sunColor: 0xffa070 };

function mixPreset(a: EnvPreset, b: EnvPreset, k: number): EnvPreset {
  const c = (x: number, y: number) => _c1.setHex(x).lerp(_c2.setHex(y), k).getHex();
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    zenith: c(a.zenith, b.zenith), horizon: c(a.horizon, b.horizon), ground: c(a.ground, b.ground), sunColor: c(a.sunColor, b.sunColor),
    sunIntensity: n(a.sunIntensity, b.sunIntensity), sunElev: n(a.sunElev, b.sunElev), sunAzim: n(a.sunAzim, b.sunAzim),
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    fog: c(a.fog, b.fog), fogNear: n(a.fogNear, b.fogNear), fogFar: n(a.fogFar, b.fogFar), exposure: n(a.exposure, b.exposure),
    stars: n(a.stars, b.stars), clouds: n(a.clouds, b.clouds), cloudColor: c(a.cloudColor, b.cloudColor),
  };
}
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

// ======================================================================= the fall
type J = [number, number, number];
interface PoseKey {
  t: number;
  /** root offset (x, y, z) and rotation (x, y, z) */
  r: [number, number, number, number, number, number];
  j: Record<string, J>;
}
const AIM: Record<string, J> = { arm_r: [-1.35, 0, -0.1], fore_r: [-0.12, 0, 0], arm_l: [-0.3, 0, 0.2], fore_l: [-0.55, 0, 0], torso: [0.06, 0, 0], head: [0.04, 0, 0], thigh_l: [-0.18, 0, 0.06], shin_l: [0.3, 0, 0], thigh_r: [0.12, 0, -0.05], shin_r: [0.12, 0, 0] };
const DOWN: Record<string, J> = { arm_r: [-2.75, 0, -0.45], fore_r: [-0.35, 0, 0], arm_l: [-0.35, 0, 1.3], fore_l: [-0.55, 0, 0], torso: [-0.08, 0.1, 0.05], head: [-0.12, 0.72, 0.12], jaw: [0.42, 0, 0], thigh_l: [-0.95, 0, 0.28], shin_l: [1.35, 0, 0], thigh_r: [-0.22, 0, -0.16], shin_r: [0.42, 0, 0] };
const FALL: PoseKey[] = [
  { t: 0, r: [0, 0.1, 0, 0, 0, 0], j: AIM },
  { t: 0.2, r: [0, 0.14, -0.2, -0.17, 0.12, 0.05], j: { arm_r: [-2.6, 0, -0.75], fore_r: [-0.4, 0, 0], arm_l: [-1.45, 0, 1.1], fore_l: [-0.85, 0, 0], torso: [-0.52, 0.22, 0.08], head: [-0.78, -0.32, 0.1], jaw: [0.38, 0, 0], thigh_l: [-0.38, 0, 0.1], shin_l: [0.5, 0, 0], thigh_r: [0.28, 0, -0.08], shin_r: [0.2, 0, 0] } },
  { t: 0.55, r: [0, -0.06, -0.34, -0.08, 0.2, 0.08], j: { arm_r: [-1.15, 0, -0.95], fore_r: [-0.65, 0, 0], arm_l: [-0.6, 0, 0.95], fore_l: [-0.9, 0, 0], torso: [-0.18, 0.26, 0.1], head: [-0.28, -0.2, 0.16], jaw: [0.32, 0, 0], thigh_l: [-0.62, 0, 0.12], shin_l: [1.05, 0, 0], thigh_r: [-0.12, 0, -0.1], shin_r: [0.75, 0, 0] } },
  { t: 0.95, r: [0.05, -0.31, -0.4, 0.05, 0.26, 0.1], j: { arm_r: [0.18, 0, -0.35], fore_r: [-0.2, 0, 0], arm_l: [0.12, 0, 0.4], fore_l: [-0.3, 0, 0], torso: [0.46, 0.15, 0.16], head: [0.62, 0.2, 0.2], jaw: [0.42, 0, 0], thigh_l: [0.06, 0, 0.12], shin_l: [1.55, 0, 0], thigh_r: [0.1, 0, -0.1], shin_r: [1.6, 0, 0] } },
  { t: 1.22, r: [0.1, -0.2, -0.44, -0.55, 0.3, 0.22], j: { arm_r: [-0.9, 0, -0.5], fore_r: [-0.3, 0, 0], arm_l: [-0.4, 0, 0.9], fore_l: [-0.4, 0, 0], torso: [-0.25, 0.12, 0.1], head: [-0.35, 0.4, 0.15], jaw: [0.45, 0, 0], thigh_l: [-0.4, 0, 0.2], shin_l: [1.45, 0, 0], thigh_r: [-0.05, 0, -0.12], shin_r: [1.2, 0, 0] } },
  { t: 1.55, r: [0.15, 0.1, -0.5, -1.47, 0.34, 0.22], j: DOWN },
  { t: 1.68, r: [0.15, 0.16, -0.5, -1.4, 0.34, 0.2], j: DOWN },
  { t: 1.9, r: [0.15, 0.1, -0.5, -1.47, 0.34, 0.22], j: DOWN },
];
const ss = (x: number) => x * x * (3 - 2 * x);
/** the time-lapse camera: east of the body, looking west-south-west over it into the sunset sky */
const TL_POS = new THREE.Vector3(12, 4.6, 5.4);
const TL_DIR = new THREE.Vector3(-0.92, 0.17, -0.36).normalize();
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => ss(clamp01((v - a) / (b - a)));

interface Body {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  r: number;
  rest: THREE.Quaternion;
  sink: number;
  landed: number;
  bounces: number;
  sfx: string;
}

// ======================================================================= the scene
export class DeathCine implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1400);
  ready = false;
  private env!: Env;
  private sky!: THREE.Mesh;
  private skyU: Record<string, THREE.IUniform> = {};
  private h!: (x: number, z: number) => number;
  private particles = new Particles();
  private hero: RigInstance | null = null;
  private heroHolder = new THREE.Group();
  private heroRest = new Map<string, THREE.Euler>();
  private killer: Puppet | null = null;
  private killerGone = false;
  private bodies: Body[] = [];
  private drift: THREE.Mesh | null = null;
  private hat: THREE.Mesh | null = null;
  private gunRoot: THREE.Object3D | null = null;
  private boardMesh: THREE.Mesh | null = null;
  private t = 0;
  /** the hunter's clock (slow motion runs here) */
  private hc = -1;
  private strikeAt = -1;
  private rate = 1;
  private fallDone = -1;
  /** time-lapse: day fraction (0 midnight, .25 sunrise, .5 noon, .75 sunset) */
  private tau = 0.66;
  private tlStart = -1;
  private tlOn = false;
  private tlDur = 8;
  private sunrises = 0;
  private endAt = -1;
  private leaving = false;
  private ui = document.createElement('div');
  private title = document.createElement('div');
  private skipEl = document.createElement('div');
  private loops: { stop(t?: number): void }[] = [];
  private nightLoop: { stop(t?: number): void } | null = null;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private starRot = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();
  private base!: EnvPreset;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camRoll = 0;
  private fovNow = 40;
  private sand: number[];
  private geos: THREE.BufferGeometry[] = [];
  private own(g: THREE.BufferGeometry) {
    this.geos.push(g);
    return g;
  }

  constructor(private engine: Engine, private o: DeathCineOpts) {
    this.sand = SANDS[o.area] ?? SANDS.A;
  }

  async enter() {
    const eng = this.engine;
    const s = this.scene;
    const o = this.o;
    this.h = heightFn(o.seed);
    // ---- light and air
    this.base = { ...PRESETS[o.area === 'B' ? 'oasis' : o.area === 'C' ? 'pyramid' : 'dunes'] };
    this.env = new Env(s, o.area === 'B' ? 'oasis' : o.area === 'C' ? 'pyramid' : 'dunes', o.seed % 1000);
    this.env.sky.visible = false;
    this.env.shadowExtent = 9;
    this.env.sun.shadow.mapSize.set(2048, 2048);
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, fogColor: { value: this.env.fog.color },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uMoonDir: { value: this.moonDir }, uAtmo: { value: ATMO.u },
      uStarRot: { value: this.starRot }, uStars: { value: 0 }, uTime: { value: 0 }, uMoon: { value: 0 }, uNight: { value: 0 }, uSunVis: { value: 1 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    this.applySky(0);
    try {
      this.envRT = this.env.applyEnvMap(eng.renderer);
    } catch (e) {
      console.warn('[death] env', e);
    }
    // ---- the ground
    const near = new THREE.Mesh(this.own(nearGround(this.h, o.area, o.seed)), sharedVoxelMaterial);
    near.receiveShadow = true;
    near.castShadow = true;
    s.add(near);
    const far = new THREE.Mesh(this.own(farGround(this.h, o.area)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    far.receiveShadow = true;
    s.add(far);
    // set dressing: a bleached skull, a broken cactus, a rib arch on the ridge
    const prop = (key: string, x: number, z: number, ry: number, sc = 1, sink = 0.05) => {
      try {
        const r = modelEntry(key)?.() as any;
        if (!r?.model) return;
        const m = new THREE.Mesh(this.own(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
        m.castShadow = m.receiveShadow = true;
        m.position.set(x, this.h(x, z) - sink, z);
        m.rotation.y = ry;
        m.scale.setScalar(sc);
        s.add(m);
      } catch (e) {
        console.warn('[death] prop', key, e);
      }
    };
    prop('skull_cow', -1.9, 1.6, 2.4, 0.8);
    prop('cactus_saguaro_dmg2', 4.6, -5.2, 0.7);
    prop(o.area === 'C' ? 'obelisk_broken' : o.area === 'B' ? 'column_broken' : 'rib_arch', -13, -16, 0.5, 1, 0.4);
    prop('cattle_skull_post', 6.5, 4.2, -0.8);
    s.add(this.particles.group);
    this.particles.groundAt = this.h;
    // ---- the hunter
    if (o.hero?.parts) {
      this.hero = new RigInstance(buildRigGeo(o.hero, o.hero.name + ':death'), { material: makeVoxelMaterial(), castShadow: true });
      for (const p of this.hero.geo.parts) this.heroRest.set(p.name, p.rest.clone());
      this.heroHolder.add(this.hero.root);
      this.hero.setExpression('angry');
      if (o.gun?.parts) {
        const g = new RigInstance(buildRigGeo(o.gun, o.gun.name + ':death'), { material: this.hero.material });
        const holder = new THREE.Group();
        holder.rotation.x = Math.PI / 2;
        holder.add(g.root);
        if (!this.hero.attach('hand_r', holder)) this.hero.nodes['fore_r']?.add(holder);
        this.gunRoot = g.root;
      }
      this.hat = this.hero.meshes['hat'] ?? null;
    }
    s.add(this.heroHolder);
    this.heroHolder.position.set(0, this.h(0, 0), 0);
    if (o.board) {
      this.boardMesh = new THREE.Mesh(o.board, makeVoxelMaterial());
      this.boardMesh.castShadow = this.boardMesh.receiveShadow = true;
      this.boardMesh.position.set(0, 0.07, 0);
      this.boardMesh.rotation.y = Math.PI / 2;
      s.add(this.boardMesh);
    }
    this.pose(0);
    // ---- the killer, facing him
    const k = o.killer;
    try {
      if (k?.def) this.killer = Puppet.enemy(k.def, { alpha: k.alpha, rigKey: k.rigKey, material: makeVoxelMaterial() });
      else if (k?.spec) this.killer = Puppet.rig(k.spec, { key: 'death:' + k.spec.name, material: makeVoxelMaterial() });
    } catch (e) {
      console.warn('[death] killer', e);
      this.killer = null;
    }
    if (this.killer) {
      const kp = this.killer;
      const reach = k?.def ? (k.def.attacks.find((a) => a.kind === 'melee') ? 1.15 + kp.radius : Math.min(7, 2.6 + kp.radius * 2)) : 1.6 + kp.radius * 1.2;
      const kx = 0.25, kz = reach;
      kp.root.position.set(kx, this.h(kx, kz), kz);
      kp.root.rotation.y = Math.PI;
      if (k?.scale && !k.def) kp.root.scale.setScalar(k.scale);
      kp.onStrike = () => this.onStrike();
      s.add(kp.root);
    }
    // ---- the overlay: letterbox, the big title, a skip hint
    this.ui.style.cssText = 'position:absolute;inset:0;z-index:9;pointer-events:none';
    this.title.style.cssText = "position:absolute;left:0;right:0;top:30%;text-align:center;font-family:'Alagard';font-size:clamp(40px,9vw,120px);letter-spacing:.08em;color:#fff1d2;opacity:0;transform:translateY(14px) scale(.96);transition:opacity 1.4s ease,transform 2.2s cubic-bezier(.2,.7,.2,1);text-shadow:0 4px 0 #2a1408,0 0 26px rgba(255,190,110,.55),0 0 80px rgba(255,140,60,.35);white-space:nowrap";
    this.skipEl.style.cssText = "position:absolute;right:28px;bottom:calc(11vh + 14px);font-family:'Alagard';font-size:15px;color:#fff3d6;opacity:0;transition:opacity 1s;text-shadow:0 2px 0 #2a1408,0 0 8px #000";
    this.skipEl.textContent = 'Space · Esc · click — skip';
    this.ui.append(this.title, this.skipEl);
    eng.overlay.appendChild(this.ui);
    eng.letterbox(true, 0.4);
    eng.input.setWantLock(false);
    (window as any).__music?.setMood('tension', 0.6);
    const w = eng.audio.loop('wind_loop', 0.5);
    if (w) this.loops.push(w);
    this.tlDur = THREE.MathUtils.clamp(2.1 * o.days + 1.6, 6, 13);
    // camera: low and close, dutch angle, looking up past the killer at the hunter
    this.camera.aspect = eng.width / eng.height;
    this.shotA(0, true);
    setTimeout(() => (this.skipEl.style.opacity = '0.7'), 1500);
    this.ready = true;
    (window as any).__death = this;
  }

  // ---------------------------------------------------------------- the hunter's pose
  private pose(hc: number) {
    const h = this.hero;
    if (!h) return;
    let i = 0;
    while (i < FALL.length - 2 && hc > FALL[i + 1].t) i++;
    const a = FALL[i], b = FALL[Math.min(FALL.length - 1, i + 1)];
    const k = b.t > a.t ? ss(clamp01((hc - a.t) / (b.t - a.t))) : 1;
    const R = this.heroHolder;
    const g = this.h(0, 0);
    R.position.set(a.r[0] + (b.r[0] - a.r[0]) * k, g + a.r[1] + (b.r[1] - a.r[1]) * k, a.r[2] + (b.r[2] - a.r[2]) * k);
    R.rotation.set(a.r[3] + (b.r[3] - a.r[3]) * k, a.r[4] + (b.r[4] - a.r[4]) * k, a.r[5] + (b.r[5] - a.r[5]) * k, 'YXZ');
    // breathing out the last of it, then still
    const life = hc < 0 ? 1 : 1 - sstep(1.4, 2.2, hc);
    const br = Math.sin(this.t * 2.2) * 0.02 * life;
    for (const [name, rest] of this.heroRest) {
      const n = h.nodes[name];
      if (!n) continue;
      const ja = a.j[name] ?? [0, 0, 0], jb = b.j[name] ?? [0, 0, 0];
      n.rotation.set(rest.x + ja[0] + (jb[0] - ja[0]) * k, rest.y + ja[1] + (jb[1] - ja[1]) * k, rest.z + ja[2] + (jb[2] - ja[2]) * k);
    }
    if (h.nodes['torso']) h.nodes['torso'].rotation.x += br;
    if (h.nodes['jaw']) h.nodes['jaw'].rotation.x += h.exprJaw;
    // the aim trembles before the blow
    if (hc < 0 && h.nodes['arm_r']) h.nodes['arm_r'].rotation.x += Math.sin(this.t * 13) * 0.012;
  }

  // ---------------------------------------------------------------- the blow
  private onStrike() {
    if (this.strikeAt >= 0) return;
    const eng = this.engine;
    this.strikeAt = this.t;
    this.hc = 0;
    eng.flash(0xfff0d0, 0.35, 0.2);
    eng.audio.play('hit_bone', { volume: 1, pitch: 0.7 });
    eng.audio.play('skeleton_rattle', { volume: 0.9, pitch: 0.8 });
    eng.audio.play('time_slow', { volume: 0.8 });
    eng.audio.play('sting_negative', { volume: 0.7 });
    this.hero?.setExpression('hurt');
    const chest = this.v1.set(0, this.h(0, 0) + 1.15, 0);
    const k = this.o.killer?.def;
    if (k && !k.attacks.some((a) => a.kind === 'melee')) {
      // a shot: muzzle smoke at the killer, a spray of bone chips off the hunter
      const kp = this.killer!.root.position;
      this.particles.emit({ pos: { x: kp.x, y: kp.y + 1.3, z: kp.z - 0.4 }, count: 6, spread: 0.4, up: 0.4, life: [0.8, 1.4], size: [0.2, 0.6], sprite: ['puff0', 'puff1'], color: 0xe8e0d0, alpha: 0.6, drag: 2 });
    }
    this.particles.emit({ pos: chest, count: 18, spread: 2.2, up: 1.6, vel: { x: 0, y: 0.6, z: -1.8 }, life: [0.6, 1.4], size: [0.05, 0.03], sprite: ['twig', 'dot3'], color: [0xf2dcb4, 0xd6b78a, 0xfff1d6], gravity: 6, ground: true, drag: 0.4 });
    this.particles.emit({ pos: chest, count: 5, spread: 0.6, up: 0.4, life: [0.9, 1.6], size: [0.3, 0.9], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.5, drag: 1.6 });
  }

  /** a thing flies off him: the hat, the gun, the board */
  private launch(obj: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3, r: number, rest: THREE.Quaternion, sink: number, sfx: string) {
    this.scene.attach(obj);
    this.bodies.push({ obj, vel, spin, r, rest, sink, landed: -1, bounces: 0, sfx });
  }

  private stepBodies(dt: number) {
    const q = new THREE.Quaternion();
    for (const b of this.bodies) {
      const o = b.obj;
      if (b.landed >= 0) {
        b.landed += dt;
        o.quaternion.slerp(b.rest, 1 - Math.exp(-dt * 7));
        const g = this.h(o.position.x, o.position.z);
        o.position.y += (g + b.r - b.sink - o.position.y) * (1 - Math.exp(-dt * 6));
        continue;
      }
      b.vel.y -= 9.8 * dt;
      o.position.addScaledVector(b.vel, dt);
      const w = b.spin.length();
      if (w > 1e-4) {
        q.setFromAxisAngle(this.v2.copy(b.spin).divideScalar(w), w * dt);
        o.quaternion.premultiply(q);
      }
      const g = this.h(o.position.x, o.position.z) + b.r;
      if (o.position.y < g) {
        o.position.y = g;
        const p = { x: o.position.x, y: g - b.r, z: o.position.z };
        const hard = -b.vel.y;
        this.particles.emit({ pos: p, count: 4 + Math.round(hard), spread: 0.6, up: 0.5, life: [0.6, 1.2], size: [0.18, 0.5], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.6, drag: 2.2 });
        this.particles.emit({ pos: p, count: 8 + Math.round(hard * 3), spread: 1.2, up: 1.6, life: [0.4, 0.9], size: [0.05, 0.03], sprite: ['dot3', 'dot4'], color: this.sand, gravity: 10, ground: true, jitter: 0.3 });
        this.engine.audio.play(b.sfx, { volume: Math.min(1, 0.3 + hard * 0.12) });
        if (hard > 1.4 && b.bounces < 2) {
          b.bounces++;
          b.vel.set(b.vel.x * 0.45, hard * 0.3, b.vel.z * 0.45);
          b.spin.multiplyScalar(0.45);
        } else b.landed = 0;
      }
    }
  }

  private updateHero(dt: number) {
    const h = this.hero;
    if (this.hc < 0) {
      this.pose(-1);
      return;
    }
    this.hc += dt;
    this.pose(this.hc);
    if (!h) return;
    // the hat pops off, the gun flies out of his hand, the board skids away
    if (this.hat && this.hc > 0.06) {
      const hat = this.hat;
      this.hat = null;
      const m = new THREE.Mesh(hat.geometry, hat.material);
      m.castShadow = true;
      hat.updateWorldMatrix(true, false);
      hat.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      // pivot the tumble round the crown's centre
      hat.geometry.computeBoundingBox();
      const c = hat.geometry.boundingBox!.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      wrap.position.copy(c).applyMatrix4(hat.matrixWorld);
      wrap.quaternion.copy(m.quaternion);
      m.position.copy(c).multiplyScalar(-1).multiply(m.scale);
      m.quaternion.identity();
      wrap.add(m);
      this.scene.add(wrap);
      hat.visible = false;
      const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 2.2, -0.15, 'YXZ'));
      this.launch(wrap, new THREE.Vector3(-0.9, 3.4, -2.3), new THREE.Vector3(-7, 2.5, 3), 0.07, rest, 0, 'board_land');
    }
    if (this.gunRoot && this.hc > 0.1) {
      const g = this.gunRoot;
      this.gunRoot = null;
      const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.9, Math.PI / 2, 'YXZ'));
      this.launch(g, new THREE.Vector3(-2.2, 3.0, 0.4), new THREE.Vector3(2, 14, -4), 0.03, rest, 0.025, 'rev_dry');
      this.engine.audio.play('rev_spin', { volume: 0.6, pitch: 0.7 });
    }
    if (this.boardMesh && this.hc > 0.14 && !this.bodies.some((b) => b.obj === this.boardMesh)) {
      const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, Math.PI / 2 + 0.6, 0.12, 'YXZ'));
      this.launch(this.boardMesh, new THREE.Vector3(1.6, 1.2, -2.6), new THREE.Vector3(0, 2.2, 3.5), 0.04, rest, 0.12, 'board_land');
    }
    // knees, then the back, hit the sand
    if (this.hc > 0.95 && this.hc - dt <= 0.95) this.thump(0.4, -0.4, 0.7);
    if (this.hc > 1.55 && this.hc - dt <= 1.55) {
      this.thump(0.15, -1.2, 1.3);
      this.engine.audio.play('skeleton_rattle', { volume: 0.7, pitch: 0.6 });
      h.setExpression('dead');
      this.fallDone = this.t;
    }
  }

  private thump(x: number, z: number, k: number) {
    const p = { x, y: this.h(x, z), z };
    this.particles.emit({ pos: p, count: Math.round(8 * k), spread: 1.2, up: 0.6, life: [0.8, 1.6], size: [0.3, 0.9], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a, 0xc9a77a], alpha: 0.6, drag: 2, rot: 3, rotSpeed: 0.4 });
    this.particles.emit({ pos: p, count: Math.round(22 * k), spread: 2, up: 2.2, life: [0.4, 0.9], size: [0.05, 0.03], sprite: ['dot3', 'dot4'], color: this.sand, gravity: 11, ground: true, jitter: 0.6 });
    this.engine.audio.play('sand_burst', { volume: 0.5 * k });
  }

  // ---------------------------------------------------------------- sky and light
  /** day fraction → sun, moon, stars, light, sky colours */
  private applySky(tau: number) {
    const H = (tau - 0.5) * Math.PI * 2;
    celestial(H, THREE.MathUtils.degToRad(15), this.sunDir);
    celestial(H - 0.42 * Math.PI * 2, THREE.MathUtils.degToRad(-6), this.moonDir);
    this.m4.makeRotationAxis(POLE, -tau * Math.PI * 2);
    this.starRot.setFromMatrix4(this.m4);
    const alt = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    const rising = Math.sin(H) < 0;
    const eve = rising ? DAWN : DUSK;
    let p: EnvPreset;
    if (alt > 24) p = { ...this.base };
    else if (alt > 7) p = mixPreset(PRESETS.menu, this.base, (alt - 7) / 17);
    else if (alt > 0) p = mixPreset({ ...PRESETS.pyramid, sunIntensity: 2.2 }, PRESETS.menu, alt / 7);
    else if (alt > -7) p = mixPreset(eve, { ...PRESETS.pyramid, sunIntensity: 2.2 }, (alt + 7) / 7);
    else if (alt > -16) p = mixPreset(PRESETS.night, eve, (alt + 16) / 9);
    else p = { ...PRESETS.night };
    const night = clamp01((-alt + 2) / 14);
    // the light: the sun by day, the moon by night (both faint at the hand-over, so no pop)
    const sunI = sstep(-0.05, 0.14, this.sunDir.y);
    const moonI = sstep(-0.04, 0.2, this.moonDir.y) * night;
    this.lightDir.copy(sunI >= moonI * 0.35 ? this.sunDir : this.moonDir);
    p.sunElev = THREE.MathUtils.radToDeg(Math.asin(Math.max(0.03, this.lightDir.y)));
    p.sunAzim = THREE.MathUtils.radToDeg(Math.atan2(this.lightDir.z, this.lightDir.x));
    const env = this.env;
    env.apply(p);
    env.sun.intensity = Math.max(sunI * p.sunIntensity * 1.35, moonI * 1.25, 0.12);
    if (sunI < moonI * 0.35) env.sun.color.setHex(0x9fb8ff);
    env.hemi.intensity = p.hemiIntensity * (0.34 + 0.46 * night);
    globalUniforms.uSunCol.value.copy(env.sun.color).multiplyScalar(env.sun.intensity);
    ATMO.u[3] = 0.8 - 0.55 * night;
    this.scene.environmentIntensity = 0.52 - 0.4 * night;
    const u = this.skyU;
    (u.uZenith.value as THREE.Color).setHex(p.zenith);
    (u.uGround.value as THREE.Color).setHex(p.ground);
    (u.uSunCol.value as THREE.Color).setHex(p.sunColor).multiplyScalar(7 - 4 * night);
    u.uSunVis.value = sstep(-0.035, 0.0, this.sunDir.y);
    u.uStars.value = Math.max(p.stars, night);
    u.uMoon.value = sstep(-0.02, 0.03, this.moonDir.y) * (0.35 + 0.65 * night);
    u.uNight.value = night;
    // a night and a dawn to remember
    return night;
  }

  // ---------------------------------------------------------------- camera
  private setCam(pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll: number, rdt: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-rdt * 3.2);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    this.fovNow += (fov - this.fovNow) * (snap ? 1 : k);
    this.camRoll += (roll - this.camRoll) * (snap ? 1 : k);
    const c = this.camera;
    c.position.copy(this.camPos);
    c.lookAt(this.camLook);
    c.rotateZ(this.camRoll);
    c.fov = this.fovNow;
    c.aspect = this.engine.width / this.engine.height;
    c.updateProjectionMatrix();
  }

  /** low and to the side, looking up past the killer */
  private shotA(rdt: number, snap = false) {
    const g = this.h(0, 0);
    const kz = this.killer ? this.killer.root.position.z : 1.5;
    const push = Math.min(1, this.t / 4) * 0.35;
    const pos = this.v1.set(2.25 - push, g + 0.32, kz * 0.45 + 0.2);
    const look = this.v2.set(0.05, g + 1.05, kz * 0.38);
    this.setCam(pos, look, 36, 0.14, rdt, snap);
  }

  // ---------------------------------------------------------------- frame
  update(_dt: number, rdt: number) {
    if (!this.ready) return;
    const eng = this.engine;
    const inp = eng.input;
    this.t += rdt;
    const t = this.t;
    if (t > 0.6 && !this.leaving && (inp.wasPressed('Space') || inp.wasPressed('Escape') || inp.wasPressed('Enter') || inp.wasPressed('Mouse0'))) {
      this.finish(true);
      return;
    }
    // slow motion from the blow, easing back to speed as he goes down
    const sinceHit = this.strikeAt >= 0 ? t - this.strikeAt : -1;
    this.rate = sinceHit < 0 ? 1 : sinceHit < 1.0 ? 0.24 : sinceHit < 1.8 ? 0.24 + (sinceHit - 1.0) / 0.8 * 0.76 : 1;
    const dt = rdt * this.rate;
    // the killer strikes (or, with no killer, he just goes down)
    if (this.strikeAt < 0) {
      if (this.killer && t > 0.35 && !this.killer.busy) this.killer.attack();
      if (!this.killer && t > 0.9) this.onStrike();
      if (t > 4) this.onStrike();
    }
    const kp = this.killer;
    if (kp && !this.killerGone) {
      kp.viewerAlive = this.fallDone < 0;
      kp.update(dt, this.v1.copy(this.heroHolder.position).setY(this.heroHolder.position.y + 1.2));
    }
    this.updateHero(dt);
    this.stepBodies(dt);
    // drifting pixel sand, always
    const w = { x: -0.9, z: 0.42 };
    const tl = this.tlOn ? clamp01((t - this.tlStart) / this.tlDur) : 0;
    if (Math.random() < rdt * (16 + tl * 30)) {
      const x = (Math.random() - 0.5) * 14 + 4, z = (Math.random() - 0.5) * 14;
      this.particles.emit({ pos: { x, y: this.h(x, z) + 0.05 + Math.random() * 0.2, z }, count: 3, vel: { x: w.x * (6 + Math.random() * 4), y: 0.25, z: w.z * (6 + Math.random() * 4) }, spread: 0.6, jitter: 1, gravity: 1.2, drag: 0.25, life: [1.4, 2.8], size: [0.04, 0.07], sprite: 'dot3', color: this.sand, ground: true });
    }
    // ---- the shots
    const fd = this.fallDone >= 0 ? t - this.fallDone : -1;
    const g = this.h(0, 0);
    if (fd < 0) {
      if (sinceHit < 0.6) this.shotA(rdt);
      else {
        // drift round as he goes down, settling above him
        const k = ss(clamp01((sinceHit - 0.6) / 2.6));
        const a = 0.15 + k * 1.2;
        this.setCam(this.v1.set(Math.cos(a) * (2.4 - k * 0.6), g + 0.35 + k * 1.1, Math.sin(a) * (2.4 - k * 0.6) * 0.6 + 0.4 - k * 0.6), this.v2.set(0.1, g + 0.9 - k * 0.65, -0.35 * k), 36 + k * 6, 0.14 * (1 - k), rdt);
      }
    } else if (fd < 2.4) {
      // past his skull, down the length of him, to the killer gloating over the body
      this.setCam(this.v1.set(-0.6, g + 1.2 - fd * 0.05, -3.05 - fd * 0.08), this.v2.set(0.1, g + 0.6, 0.25), 42, 0.03, rdt);
    } else if (!this.tlOn) {
      // crane straight up over the body, then out and away, tilting up into the sky
      const k = ss(clamp01((fd - 2.4) / 5.2));
      const P0 = new THREE.Vector3(-0.6, g + 1.08, -3.24), P1 = new THREE.Vector3(0.35, g + 8.5, -0.9), P2 = TL_POS.clone().setY(g + TL_POS.y);
      const pos = this.v1.set(0, 0, 0).addScaledVector(P0, (1 - k) * (1 - k)).addScaledVector(P1, 2 * k * (1 - k)).addScaledVector(P2, k * k);
      const tilt = ss(clamp01((k - 0.45) / 0.55));
      const body = this.v2.set(0.0, g + 0.3, -1.1);
      const sky = TL_DIR.clone().multiplyScalar(40).add(pos);
      this.setCam(pos, body.lerp(sky, tilt), 42 + ss(clamp01(k / 0.6)) * 26, 0, rdt * 2.2);
      if (k >= 1) {
        this.tlOn = true;
        this.tlStart = t;
        (window as any).__music?.setMood('off', 2);
        this.nightLoop = eng.audio.loop('night_loop', 0.0);
      }
    } else {
      // the time-lapse: a slow pan across the western sky
      const pos = this.v1.copy(TL_POS).setY(g + TL_POS.y);
      const dir = new THREE.Vector3(TL_DIR.x, TL_DIR.y - tl * 0.02, TL_DIR.z - tl * 0.22).normalize();
      this.setCam(pos, this.v2.copy(pos).addScaledVector(dir, 40), 68, 0, rdt * 2);
    }
    // ---- the time-lapse
    let night = 0;
    if (this.tlOn) {
      const ease = tl < 0.5 ? 2 * tl * tl : 1 - Math.pow(-2 * tl + 2, 2) / 2;
      const span = this.o.days + (0.3 - 0.66);
      this.tau = 0.66 + span * ease;
      // count the sunrises (from the clock itself, so a jump never loses one)
      const n = Math.max(0, Math.floor(this.tau - 0.27));
      if (n > this.sunrises) this.onSunrise(n);
      night = this.applySky(this.tau);
      (this.env as any).cloudSpeed = 2.2 + Math.sin(tl * Math.PI) * 140;
      this.nightLoopVol(night);
      // the killer is gone by the first night; the sand creeps over him
      if (!this.killerGone && night > 0.6 && this.killer) {
        this.killerGone = true;
        this.killer.root.visible = false;
      }
      if (!this.drift) {
        this.drift = new THREE.Mesh(this.own(driftModel(this.o.seed, this.o.area)), sharedVoxelMaterial);
        this.drift.receiveShadow = this.drift.castShadow = true;
        this.drift.position.set(0.15, g - 0.33, -0.55);
        this.drift.rotation.y = 0.34;
        this.scene.add(this.drift);
      }
      this.drift.position.y = g - 0.33 + ss(tl) * 0.26;
      this.heroHolder.position.y -= ss(tl) * 0.06;
      if (tl >= 1 && this.endAt < 0) this.endAt = t + 1.1;
    } else this.applySky(0.66);
    this.skyU.uTime.value = t;
    this.env.update(this.v1.set(0, g, 0), rdt * (this.tlOn ? 1 : this.rate), t);
    this.sky.position.copy(this.camera.position);
    this.particles.update(dt, this.scene.fog as THREE.Fog);
    if (this.endAt >= 0 && t >= this.endAt) this.finish(false);
  }

  private nightLoopVol(night: number) {
    const l = this.nightLoop as any;
    if (l?.setVolume) l.setVolume(0.35 * night);
  }

  private onSunrise(n: number) {
    this.sunrises = n;
    const el = this.title;
    el.textContent = `${n} ${n === 1 ? 'DAY' : 'DAYS'} PASSED…`;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0) scale(1)';
    el.animate([{ transform: 'translateY(0) scale(1.08)', filter: 'brightness(1.6)' }, { transform: 'translateY(0) scale(1)', filter: 'brightness(1)' }], { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)' });
    this.engine.audio.play('divine_chime', { volume: 0.35, pitch: 0.7 + n * 0.05 });
  }

  /** dissolve into the hideout: he wakes up at home */
  private finish(skipped: boolean) {
    if (this.leaving) return;
    this.leaving = true;
    const eng = this.engine;
    const days = this.o.days;
    if (skipped) {
      this.title.textContent = `${days} DAYS PASSED…`;
      this.title.style.opacity = '1';
      this.title.style.transform = 'translateY(0) scale(1)';
    }
    void (async () => {
      await eng.fadeOut(skipped ? 0.5 : 1.5, '#fff3dc');
      this.title.style.opacity = '0';
      await eng.setScene(new HubScene(eng, () => nav.ride(false), () => nav.menu(), { wake: { days, result: this.o.result } }), 0.9, '#fff3dc');
    })();
  }

  exit() {
    for (const l of this.loops) l.stop(0.8);
    this.nightLoop?.stop(0.8);
    this.ui.remove();
    this.engine.letterbox(false, 0.4);
    this.env?.dispose();
    this.envRT?.dispose();
    this.killer?.dispose();
    this.sky?.geometry.dispose();
    (this.sky?.material as THREE.Material | undefined)?.dispose();
    for (const g of this.geos) g.dispose();
    if ((window as any).__death === this) (window as any).__death = null;
  }
}
