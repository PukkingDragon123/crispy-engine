// THE HEART OF THE OASIS — the zone the Oasis King owns (sub-area B, theme
// 'oasisheart': an island bowl ringed by a deep moat).
//
//  WHILE THE KING LIVES the zone feels owned:
//   - the moat and the island's pond are murky green (scum rafts drifting,
//     flies over the water, bubbles burping up), a sickly haze hangs over it;
//   - the King himself cruises the pond — only his fin and back cut the
//     water — and every so often surfaces, whiskers trailing; the ground rumbles;
//   - his army: crocodiles lurk with only their eyes above the water (pond
//     shallows, the moat) and burst out when you ride close ("Undercover of the
//     Night"); land catfish patrol the island in a pack; walking flytraps stand
//     rooted among the palms and tear free when you pass ("Strawberry Fields
//     Forever"); reeds round the pond rustle where crocs hide.
//  THE ARMY'S MOVES (enemy defs registered here, weight 0: never in the normal
//   roster): crocs lunge and DEATH-ROLL you ("Roll Over Beethoven"), land
//   catfish GULP you whole ("Got to Get You into My Life") and spit water jets
//   that knock you flying ("Rain"), flytraps lunge and SWALLOW you ("The
//   Garden") and lob acid seeds ("Bad Apples"). The grabs ride the bell snake's
//   wrap + mash QTE ('snakeWrap' events); this module plays them out with a
//   full-rig puppet (rolling croc, gulping catfish, closing trap).
//  THE KING: riding into the island's bowl starts the fight (bosses/OasisKing).
//  KILLING HIM cleanses the oasis: the water clears to turquoise, lily pads
//   float up, dragonflies come back, the army slinks off for good, the haze
//   lifts to gold, and the pond becomes a safe haven that heals the hunter.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { OasisHeart } from '../run/OasisHeart';
//   field:   oasis: OasisHeart | null = null;
//   enter(): right after `this.ruins = new RuinNests({...})` (before the first populateZone):
//              this.oasis = OasisHeart.create({ ctx: this.ctx, player: this.player, enemies: this.enemies, qte: this.qte,
//                cam: this.camRig, cloth: this.cloth, props: this.props, adoptBoss: (b) => this.adoptBoss(b) });
//   populateZone(z): at the end:   this.oasis?.populateZone(z);
//   update():  next to `this.ruins?.update(dt);`:   this.oasis?.update(dt);
//   exit():    this.oasis?.dispose();
//   adoptBoss(b: Boss): spawnBoss() minus makeBoss/place — registerExternal, bosses.push, boss music,
//              the onDefeated rewards, then `void b.start()` (spawnBoss can call it after placing).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { ENEMIES, type EnemyDef, type AttackDef } from '../enemies/EnemyDefs';
import type { Enemies, Enemy } from '../enemies/Enemies';
import { resolveRig } from '../enemies/EnemyRender';
import type { Player } from '../player/Player';
import type { Qte } from '../ui/Qte';
import type { CameraRig } from '../player/CameraRig';
import type { ClothRenderer } from '../../engine/physics/Cloth';
import type { Props } from '../world/Props';
import type { Anchor, ZoneDef } from '../world/RegionGen';
import type { Boss } from '../bosses/Boss';
import { OasisKing, WaterShots, type KingArena } from '../bosses/OasisKing';
import { loadKingGeo, kingGeo } from '../models/creatures/oasisKingGeo';
import { buildRigGeo, RigInstance, voxelMesh, type RigGeo } from '../../engine/voxel/Rig';
import { sharedVoxelMaterial, atmoFogUniforms, globalUniforms } from '../../engine/render/VoxelMaterial';
import { PRESETS, type EnvPreset } from '../world/Env';
import { rnd, damp, clamp } from '../../engine/math/rand';
import { dragonflyRig, lilyPads } from '../models/props/ruins';

// ============================================================================ the army
const JET: AttackDef = { kind: 'aura', range: 15, minRange: 4, cooldown: 4.6, windup: 0.8, dmg: 9, radius: 0.01, title: 'Rain' };
export const OASIS_CROC: EnemyDef = {
  id: 'oasisCroc', name: 'Oasis Crocodile', title: 'Smiles With Its Whole Face', rig: 'oasis_croc', rigAlpha: 'oasis_croc_alpha',
  hp: 150, armor: 34, physRes: 0.1, magicRes: 0.05, statusRes: { bleed: 0.3, poison: 0.2 }, speed: 7.2, radius: 0.62, height: 0.62,
  ai: 'constrictor',
  attacks: [
    { kind: 'leap', range: 9, minRange: 2.4, cooldown: 5.2, windup: 0.85, dmg: 15, qte: true, title: 'Rocket Queen' },
    { kind: 'melee', range: 2.5, cooldown: 1.5, windup: 0.42, dmg: 13, status: [{ id: 'bleed', stacks: 1, dur: 3 }], title: 'Shattered' },
    { kind: 'charge', range: 16, minRange: 6, cooldown: 7.5, windup: 0.75, dmg: 18, title: 'Run for Your Life' },
  ],
  contact: 8, bounty: 14, gold: [2, 6], hitKind: 'flesh',
  weakness: 'Lurks with only its eyes above the water. The lunge locks its jaws and it death-rolls you: mash E to tear free. Shoot the soft belly when it rolls.',
  firstWave: 51, weight: 0, group: [1, 2], moveTitles: { wrap: 'Roll Over Beethoven', lurk: 'Undercover of the Night' },
  lore: 'The Oasis King keeps them like hounds. They lie in the green water for days, waiting for something to come and drink.',
};
export const OASIS_CATFISH: EnemyDef = {
  id: 'oasisCatfish', name: 'Land Catfish', title: 'Walks Like a Fish, Eats Like a Grave', rig: 'oasis_catfish', rigAlpha: 'oasis_catfish_alpha',
  hp: 120, armor: 16, physRes: 0.05, magicRes: 0.05, statusRes: { poison: 0.3 }, speed: 4.6, radius: 0.75, height: 1.05,
  ai: 'constrictor',
  attacks: [
    { kind: 'leap', range: 8, minRange: 2.2, cooldown: 6, windup: 1.0, dmg: 10, qte: true, title: 'Hello, Goodbye' },
    { kind: 'melee', range: 2.3, cooldown: 1.7, windup: 0.5, dmg: 11, title: 'Dizzy Miss Lizzy' },
    JET,
  ],
  contact: 6, bounty: 11, gold: [1, 5], hitKind: 'flesh', variants: ['oasis_catfish', 'oasis_catfish_v1'],
  weakness: 'Its spit is a water cannon that throws you across the sand — strafe it. The lunge GULPS you: mash E (or shoot its belly) to get out.',
  firstWave: 51, weight: 0, group: [2, 3], moveTitles: { wrap: 'Got to Get You into My Life', patrol: 'Come Together' },
  lore: 'Somewhere a walking catfish crawled out of a drying puddle. The King taught the rest of them to keep walking.',
};
export const OASIS_FLYTRAP: EnemyDef = {
  id: 'oasisFlytrap', name: 'Walking Flytrap', title: 'Rooted in Malice', rig: 'oasis_flytrap', rigAlpha: 'oasis_flytrap_alpha',
  hp: 110, armor: 10, physRes: 0, magicRes: 0.1, statusRes: { poison: 1, burn: -0.8 }, speed: 3.4, radius: 0.75, height: 2.4,
  ai: 'constrictor',
  attacks: [
    { kind: 'leap', range: 7.5, minRange: 2.2, cooldown: 6, windup: 1.05, dmg: 12, qte: true, title: 'Sweet Child o\' Mine' },
    { kind: 'melee', range: 2.7, cooldown: 1.6, windup: 0.5, dmg: 12, status: [{ id: 'poison', stacks: 2, dur: 4 }], title: 'Dandelion' },
    { kind: 'lob', range: 16, minRange: 4, cooldown: 4.2, windup: 0.7, dmg: 7, count: 3, speed: 12, proj: 'venom', status: [{ id: 'poison', stacks: 2, dur: 4 }], title: 'Bad Apples' },
  ],
  contact: 5, bounty: 12, gold: [1, 5], hitKind: 'wood', burnMul: 2, variants: ['oasis_flytrap', 'oasis_flytrap_v1'],
  weakness: 'Stands still as a plant until you pass. The trap gapes before it lunges — if it closes on you, mash E. It burns beautifully.',
  firstWave: 51, weight: 0, group: [1, 3], moveTitles: { wrap: 'The Garden', uproot: 'Strawberry Fields Forever' },
  lore: 'The King\'s gardeners planted them along the shore. They did not stay planted.',
};
export function registerOasisArmy() {
  if (!ENEMIES.oasisCroc) ENEMIES.oasisCroc = OASIS_CROC;
  if (!ENEMIES.oasisCatfish) ENEMIES.oasisCatfish = OASIS_CATFISH;
  if (!ENEMIES.oasisFlytrap) ENEMIES.oasisFlytrap = OASIS_FLYTRAP;
}
registerOasisArmy();
const ARMY_IDS = new Set(['oasisCroc', 'oasisCatfish', 'oasisFlytrap']);
const KIND_ID = { croc: 'oasisCroc', catfish: 'oasisCatfish', flytrap: 'oasisFlytrap' } as const;
const RIG_KEYS = ['oasis_croc', 'oasis_croc_alpha', 'oasis_catfish', 'oasis_catfish_v1', 'oasis_catfish_alpha', 'oasis_flytrap', 'oasis_flytrap_v1', 'oasis_flytrap_alpha'];

// ============================================================================ the water
const waterVert = /* glsl */ `
uniform float uTime, uLevel;
uniform vec4 uRip[6];
uniform vec4 uBul[4];
varying vec3 vW;
varying float vH;
#include <fog_pars_vertex>
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = 0.0;
  for (int i = 0; i < 4; i++) { vec4 b = uBul[i]; if (b.w != 0.0) { vec2 d = w.xz - b.xy; h += b.w * exp(-dot(d, d) / (b.z * b.z)); } }
  for (int i = 0; i < 6; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (r.w > 0.0 && age > 0.0 && age < 4.0) { float d = length(w.xz - r.xy); float x = d - age * 6.5; h += r.w * exp(-age * 0.9) * exp(-x * x * 0.3) * sin(x * 2.0); }
  }
  h += sin(w.x * 0.35 + uTime * 1.1) * 0.025 + cos(w.z * 0.42 - uTime * 0.9) * 0.025;
  w.y = uLevel + h;
  vH = h;
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const waterFrag = /* glsl */ `
uniform float uTime, uLevel, uMurk, uAlpha;
uniform vec3 uMurkDeep, uMurkShallow, uScum, uClearDeep, uClearShallow, uSky;
uniform sampler2D uHeight; uniform vec2 uSize;
uniform vec4 uMask;
uniform vec4 uBowl;
uniform vec4 uVortex;
varying vec3 vW;
varying float vH;
#include <fog_pars_fragment>
float h12(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 px = floor(vW.xz * 4.0) / 4.0;
  vec2 q = px;
  float vk = 0.0;
  if (uVortex.w > 0.0) {
    vec2 d = px - uVortex.xy; float r = length(d);
    vk = uVortex.w * smoothstep(uVortex.z, 0.0, r);
    float ang = vk * (2.5 + 7.0 / (r + 1.0)) + uTime * 3.0 * vk;
    float c = cos(ang), s = sin(ang);
    q = uVortex.xy + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  float g = uBowl.z > 0.0 ? uBowl.w + pow(clamp(length(vW.xz - uBowl.xy) / uBowl.z, 0.0, 2.0), 3.0) * 5.5 : texture2D(uHeight, vW.xz / uSize).r;
  float depth = clamp((uLevel - g) / 2.2, 0.0, 1.0);
  vec3 murk = mix(uMurkShallow, uMurkDeep, smoothstep(0.0, 0.6, depth));
  float n = vn(q * 0.32 + vec2(uTime * 0.05, uTime * 0.03)) * 0.65 + vn(q * 1.25 - uTime * 0.07) * 0.35;
  murk = mix(murk, uScum, step(0.6, n) * 0.8);
  murk = mix(murk, uScum * 1.25, step(0.74, n) * 0.5);
  murk += step(0.988, h12(px + floor(uTime * 2.0))) * 0.12;
  vec3 clear = mix(uClearShallow, uClearDeep, smoothstep(0.0, 1.0, depth));
  float w1 = sin(q.x * 0.9 + uTime * 1.6) * cos(q.y * 0.7 - uTime * 1.2);
  clear += w1 * 0.035 + step(0.982, h12(px + floor(uTime * 3.0))) * 0.6;
  vec3 col = mix(clear, murk, uMurk);
  col += vH * 0.4;
  col = mix(col, col * 0.3, vk * smoothstep(uVortex.z * 0.4, 0.0, length(px - uVortex.xy)));
  float foam = smoothstep(0.07, 0.0, depth) * (0.55 + 0.45 * step(0.5, fract(w1 * 2.0 + uTime * 0.3)));
  foam = max(foam, smoothstep(0.08, 0.2, vH) * 0.7);
  col = mix(col, mix(vec3(0.94, 0.97, 0.9), vec3(0.78, 0.82, 0.62), uMurk), foam);
  float fr = pow(1.0 - clamp(normalize(cameraPosition - vW).y, 0.0, 1.0), 4.0);
  col = mix(col, uSky, (0.08 + 0.45 * fr) * (1.0 - uMurk * 0.55));
  float d = length(vW.xz - uMask.xy);
  float mask = smoothstep(uMask.w, uMask.w - 3.0, d) * (uMask.z > 0.0 ? smoothstep(uMask.z - 2.0, uMask.z + 1.5, d) : 1.0);
  float a = mix(mix(0.6, 0.94, uMurk), 0.96, foam) * mask * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

/** a murky / clear water sheet over part of the zone (the pond in the bowl, or a tint over the moat) */
class OasisWater {
  mesh: THREE.Mesh;
  u: Record<string, { value: any }>;
  private ripI = 0;
  constructor(scene: THREE.Scene, cx: number, cz: number, half: number, seg: number, level: number, mask: [number, number], bowl: [number, number] | null, world: { water: THREE.Mesh | null; sa: { field: { size: number } } }, sky: number) {
    const wm = world.water?.material as THREE.ShaderMaterial | undefined;
    const size = world.sa.field.size;
    this.u = {
      ...atmoFogUniforms(),
      uTime: globalUniforms.uTime,
      uLevel: { value: level },
      uMurk: { value: 1 },
      uAlpha: { value: 1 },
      uMurkDeep: { value: new THREE.Color(0x1c3420) },
      uMurkShallow: { value: new THREE.Color(0x56692e) },
      uScum: { value: new THREE.Color(0x6e7c32) },
      uClearDeep: { value: new THREE.Color(0x158896) },
      uClearShallow: { value: new THREE.Color(0x76e2d6) },
      uSky: { value: new THREE.Color(sky) },
      uHeight: { value: wm?.uniforms?.uHeight?.value ?? null },
      uSize: { value: new THREE.Vector2(size, size) },
      uMask: { value: new THREE.Vector4(cx, cz, mask[0], mask[1]) },
      uBowl: { value: new THREE.Vector4(cx, cz, bowl ? bowl[0] : 0, bowl ? bowl[1] : 0) },
      uVortex: { value: new THREE.Vector4(0, 0, 1, 0) },
      uRip: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      uBul: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: this.u, transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(cx, 0, cz);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  get level() {
    return this.u.uLevel.value as number;
  }
  set level(v: number) {
    this.u.uLevel.value = v;
  }
  ripple(x: number, z: number, amp: number) {
    (this.u.uRip.value as THREE.Vector4[])[this.ripI++ % 6].set(x, z, globalUniforms.uTime.value, amp * 0.35);
  }
  bulge(slot: number, x: number, z: number, r: number, h: number) {
    (this.u.uBul.value as THREE.Vector4[])[slot & 3].set(x, z, Math.max(0.5, r), h);
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ============================================================================ deps
export interface OasisHeartDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  qte: Qte;
  cam: CameraRig;
  cloth: ClothRenderer;
  /** the zone's props: lets the heart plant reeds round its pond before the zone is built */
  props?: Props;
  /** RunScene: register + reward + start the King like spawnBoss does (else OasisHeart runs him itself) */
  adoptBoss?: (b: Boss) => void;
}

type Mode = 'lurk' | 'patrol' | 'rooted' | 'free';
interface Slot {
  kind: 'croc' | 'catfish' | 'flytrap';
  mode: Mode;
  home: { x: number; z: number };
  e: Enemy | null;
  respawn: number;
  path?: { x: number; z: number }[];
  pathI: number;
  rustle: number;
  water: boolean;
}
interface Puppet {
  e: Enemy;
  rig: RigInstance;
  kind: 'roll' | 'gulp' | 'swallow';
  t: number;
  saved: Uint8Array;
  yaw: number;
  at: THREE.Vector3;
  hunterVis: boolean;
  hid: boolean;
  spin: number;
  thud: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const AXZ = new THREE.Vector3(0, 0, 1);

const MURK_ENV: EnvPreset = { zenith: 0x4c7488, horizon: 0xc4cca2, ground: 0x7a7a52, sunColor: 0xe8d8a4, sunIntensity: 2.6, sunElev: 21, sunAzim: 250, hemiSky: 0x8ea48a, hemiGround: 0x7a7a52, hemiIntensity: 0.95, fog: 0x8f9c78, fogNear: 14, fogFar: 250, exposure: 1.0, stars: 0, clouds: 0.85, cloudColor: 0xb8c0a0 };
const HAVEN_ENV: EnvPreset = { zenith: 0x2f86d8, horizon: 0xffe2b0, ground: 0xb8a060, sunColor: 0xffe2a8, sunIntensity: 3.6, sunElev: 26, sunAzim: 250, hemiSky: 0xb0d4f0, hemiGround: 0xb8a464, hemiIntensity: 1.1, fog: 0xd4e4dc, fogNear: 30, fogFar: 460, exposure: 1.05, stars: 0, clouds: 0.4, cloudColor: 0xfff0d8 };

export class OasisHeart implements KingArena {
  cx = 0;
  cz = 0;
  r = 70;
  shots: WaterShots;
  zone: ZoneDef;
  private ar = 75;
  private base = 0;
  private pond: OasisWater;
  private moat: OasisWater | null = null;
  private pondTarget = 0;
  private pondRate = 1;
  private murk = 1;
  private murkTarget = 1;
  private slots: Slot[] = [];
  private army = new Set<Enemy>();
  private puppets: Puppet[] = [];
  private jetDone = new WeakMap<Enemy, number>();
  private offs: (() => void)[] = [];
  private t = 0;
  private populated = false;
  private warm: string[] = [];
  private warmT = 0;
  private lurker: { rig: RigInstance; ang: number; surface: number; surfaceT: number; x: number; z: number; yaw: number } | null = null;
  private king: OasisKing | null = null;
  private kingAdopted = false;
  /** 'owned' → 'fight' → 'cleansed' */
  state: 'owned' | 'fight' | 'cleansed' = 'owned';
  private rumbleT = 12;
  private envK = 0;
  private envApplied = -1;
  private havenK = 0;
  private group = new THREE.Group();
  private lilies: { mesh: THREE.InstancedMesh; pts: { x: number; z: number; rot: number; ph: number }[] }[] = [];
  private flies: { rig: RigInstance; pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; ph: number }[] = [];
  private regenT = 0;
  private havenToast = false;
  private wadeT = 0;

  /** the heart only exists in sub-areas that have an oasisheart zone */
  static create(d: OasisHeartDeps): OasisHeart | null {
    const z = d.ctx.world.sa.zones.find((q) => q.theme === 'oasisheart');
    if (!z) return null;
    return new OasisHeart(d, z);
  }

  constructor(private d: OasisHeartDeps, zone: ZoneDef) {
    registerOasisArmy();
    const ctx = d.ctx;
    this.zone = zone;
    const arena = zone.anchors.find((a) => a.kind === 'bossArena');
    this.cx = arena?.x ?? zone.cx;
    this.cz = arena?.z ?? zone.cz;
    this.ar = (arena?.data?.r ?? zone.r * 0.68 - 4) + 4;
    this.r = this.ar - 3;
    this.base = arena?.data?.level ?? ctx.world.field.heightAt(this.cx, this.cz);
    this.group.name = 'oasis-heart';
    ctx.scene.add(this.group);
    const sky = PRESETS[ctx.world.sa.env]?.zenith ?? 0x317ccb;
    this.pondTarget = this.base + 0.5;
    this.pond = new OasisWater(ctx.scene, this.cx, this.cz, 52, 104, this.pondTarget, [0, 50], [this.ar, this.base], ctx.world, sky);
    if (ctx.world.water) {
      const lake = (arena?.data?.lake as [number, number] | undefined) ?? [this.ar + 4, this.ar + 20];
      this.moat = new OasisWater(ctx.scene, this.cx, this.cz, lake[1] + 6, 96, ctx.world.sa.waterLevel + 0.05, [lake[0] - 1, lake[1] + 2], null, ctx.world, sky);
    }
    this.shots = new WaterShots(ctx, d.player);
    this.plantReeds();
    // the grabs: puppet a croc's death roll, a catfish's gulp, a flytrap closing on the hunter
    this.offs.push(ctx.events.on('snakeWrap', (e: Enemy) => this.startPuppet(e)));
    this.offs.push(ctx.events.on('snakeWrapEnd', (e: Enemy, broke: boolean) => this.endPuppet(e, broke)));
    this.offs.push(ctx.events.on('enemyHit', (e: Enemy) => this.wake(e)));
    this.offs.push(ctx.events.on('oasisKingDefeated', () => this.cleanse()));
    if (typeof window !== 'undefined') (window as any).__oasis = this; // dev handle: __oasis.startKing()
  }

  // ================================================================== KingArena
  pondLevel() {
    return this.pond.level;
  }
  pondR() {
    const h = this.pond.level - this.base;
    return h <= 0 ? 0 : this.ar * Math.cbrt(h / 5.5);
  }
  inPond(x: number, z: number) {
    return Math.hypot(x - this.cx, z - this.cz) < this.pondR() - 0.3;
  }
  flood(state: -1 | 0 | 1, dur: number) {
    this.pondTarget = this.base + (state > 0 ? 1.15 : state < 0 ? -0.7 : 0.5);
    this.pondRate = 1 / Math.max(0.3, dur);
    this.ripple(this.cx, this.cz, state > 0 ? 1 : 0.5);
    this.d.ctx.sfx(state < 0 ? 'water_loop' : 'quake_rumble', null, 0.6, state < 0 ? 0.5 : 0.7);
  }
  ripple(x: number, z: number, amp: number) {
    this.pond.ripple(x, z, amp);
  }
  bulge(slot: number, x: number, z: number, r: number, h: number) {
    this.pond.bulge(slot, x, z, r, h);
  }
  vortex(x: number, z: number, r: number, k: number) {
    (this.pond.u.uVortex.value as THREE.Vector4).set(x, z, Math.max(1, r), k);
  }
  onKingIntro() {
    this.removeLurker();
  }
  summon(kind: 'croc' | 'catfish' | 'flytrap', n: number, near: { x: number; z: number }, alpha = false): Enemy[] {
    const out: Enemy[] = [];
    const ctx = this.d.ctx;
    for (let i = 0; i < n; i++) {
      let p: { x: number; z: number } | null = null;
      for (let k = 0; k < 10 && !p; k++) {
        const a = rnd.next() * Math.PI * 2, r = 5 + rnd.next() * 8;
        const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
        if (Math.hypot(x - this.cx, z - this.cz) > this.r - 5 || ctx.world.storm.sdf(x, z) < 4) continue;
        if (Math.hypot(x - this.d.player.pos.x, z - this.d.player.pos.z) < 4.5) continue;
        p = { x, z };
      }
      if (!p) continue;
      const wet = this.inPond(p.x, p.z);
      const e = this.d.enemies.spawn(KIND_ID[kind], p.x, p.z, { emerge: wet || kind === 'catfish' ? 'run' : 'sand', alpha: alpha && i === 0 });
      if (!e) continue;
      if (wet) this.shots.splash(p.x, this.pond.level, p.z, 1.3);
      else ctx.fx.sandBurst({ x: p.x, y: ctx.world.groundAt(p.x, p.z), z: p.z }, 1.1);
      this.army.add(e);
      out.push(e);
    }
    return out;
  }

  // ================================================================== zone setup
  /** reeds, rushes and flowers round the pond (only if the zone's props are not built yet) */
  private plantReeds() {
    const pr = this.d.props;
    if (pr && pr.list.some((p: { zone: number }) => p.zone === this.zone.index)) return;
    const R = this.pondR();
    const add = (kind: string, r0: number, r1: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd.next() * 0.4;
        const r = R * (r0 + rnd.next() * (r1 - r0));
        this.zone.anchors.push({ kind, x: this.cx + Math.cos(a) * r, z: this.cz + Math.sin(a) * r, rot: rnd.next() * 6.28, scale: 0.9 + rnd.next() * 0.5 } as Anchor);
      }
    };
    add('oasisReeds', 0.9, 1.06, 26);
    add('reeds', 0.95, 1.14, 18);
    add('oasisFlowers', 1.08, 1.3, 10);
  }

  /** the zone is about to open (RunScene populates the next zone at each unlock): start the heavy work quietly */
  populateZone(z: ZoneDef) {
    if (z.index !== this.zone.index || this.populated) return;
    this.populated = true;
    void loadKingGeo();
    this.warm = RIG_KEYS.slice();
  }

  private zoneOpen() {
    return this.d.ctx.world.unlockedZone >= this.zone.index;
  }

  private spawnArmy() {
    const ctx = this.d.ctx;
    const wl = ctx.world.sa.waterLevel;
    const R = this.pondR();
    // crocs: two in the pond shallows among the reeds, two in the moat
    for (let i = 0; i < 2; i++) {
      const a = rnd.next() * Math.PI * 2;
      this.slots.push({ kind: 'croc', mode: 'lurk', home: { x: this.cx + Math.cos(a) * R * 0.82, z: this.cz + Math.sin(a) * R * 0.82 }, e: null, respawn: 0, pathI: 0, rustle: 1, water: true });
    }
    for (let i = 0, tries = 0; i < 2 && tries < 30; tries++) {
      const a = rnd.next() * Math.PI * 2, r = this.ar + 12 + (rnd.next() - 0.5) * 3;
      const x = this.cx + Math.cos(a) * r, z = this.cz + Math.sin(a) * r;
      if (ctx.world.field.heightAt(x, z) > wl - 0.2 || ctx.world.storm.sdf(x, z) < 3 || this.zone.mouths.some((m) => Math.hypot(m.x - x, m.z - z) < 20)) continue;
      this.slots.push({ kind: 'croc', mode: 'lurk', home: { x, z }, e: null, respawn: 0, pathI: 0, rustle: 1, water: false });
      i++;
    }
    // a land catfish pack on a patrol loop round the island
    const path: { x: number; z: number }[] = [];
    const pr = this.ar * 0.62;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      path.push({ x: this.cx + Math.cos(a) * pr * (0.9 + Math.sin(i * 2.3) * 0.1), z: this.cz + Math.sin(a) * pr * (0.9 + Math.cos(i * 1.7) * 0.1) });
    }
    for (let i = 0; i < 3; i++) this.slots.push({ kind: 'catfish', mode: 'patrol', home: { ...path[0] }, e: null, respawn: i * 0.5, path, pathI: 0, rustle: 0, water: false });
    // flytraps rooted among the palms, in pairs
    for (let i = 0, tries = 0; i < 4 && tries < 60; tries++) {
      const a = rnd.next() * Math.PI * 2, r = this.ar * (0.72 + rnd.next() * 0.16);
      const x = this.cx + Math.cos(a) * r, z = this.cz + Math.sin(a) * r;
      if (this.slots.some((s) => s.kind === 'flytrap' && Math.hypot(s.home.x - x, s.home.z - z) < 6)) continue;
      const g0 = ctx.world.field.heightAt(x, z), g1 = ctx.world.field.heightAt(x + 1.5, z), g2 = ctx.world.field.heightAt(x, z + 1.5);
      if (Math.abs(g1 - g0) > 0.9 || Math.abs(g2 - g0) > 0.9) continue;
      this.slots.push({ kind: 'flytrap', mode: 'rooted', home: { x, z }, e: null, respawn: 0, pathI: 0, rustle: 0, water: false });
      i++;
    }
  }

  private spawnSlot(s: Slot) {
    const id = KIND_ID[s.kind];
    const alpha = rnd.chance(0.12);
    let x = s.home.x, z = s.home.z;
    if (s.mode === 'patrol' && s.path) {
      const i = this.slots.filter((q) => q.path === s.path).indexOf(s);
      x += (i - 1) * 2.2;
      z += (i % 2) * 2;
    }
    const e = this.d.enemies.spawn(id, x, z, { emerge: 'run', alpha });
    if (!e) return;
    s.e = e;
    s.mode = s.kind === 'croc' ? 'lurk' : s.kind === 'catfish' ? 'patrol' : 'rooted';
    this.army.add(e);
    this.hold(s, 0);
  }

  /** keep an unwoken army unit in its ambush pose (the horde AI is parked in its 'spawn' state) */
  private hold(s: Slot, dt: number) {
    const e = s.e!;
    const ctx = this.d.ctx;
    e.state = 'spawn';
    e.stateT = 0.2;
    e.retreat = 0;
    if (s.mode === 'lurk') {
      // only the eyes, the brow and the ridge of the back above the water
      const lvl = s.water ? this.pond.level : ctx.world.sa.waterLevel;
      const ph = this.t * 0.25 + s.home.x;
      const tx = s.home.x + Math.sin(ph) * 1.5, tz = s.home.z + Math.cos(ph * 0.8) * 1.5;
      e.vel.set((tx - e.pos.x) * 0.6, 0, (tz - e.pos.z) * 0.6);
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      e.pos.y = Math.max(ctx.world.field.heightAt(e.pos.x, e.pos.z) - 0.6, lvl - 0.44 * e.scale);
      if (Math.hypot(e.vel.x, e.vel.z) > 0.05) e.yaw = dampAngle(e.yaw, Math.atan2(e.vel.x, e.vel.z), 2, dt);
      if (rnd.chance(dt * 0.4)) ctx.fx.bubbles({ x: e.pos.x, y: lvl, z: e.pos.z }, 1);
      // the reeds rustle where it hides
      s.rustle -= dt;
      if (s.water && s.rustle <= 0) {
        s.rustle = 1.5 + rnd.next() * 3;
        ctx.particles.emit({ pos: { x: e.pos.x, y: lvl + 0.8, z: e.pos.z }, count: 5, spread: 1.2, up: 0.8, life: [0.6, 1.2], size: [0.1, 0.05], sprite: ['twig', 'dot3'], color: [0x6a8a32, 0x8aa848, 0x4e6e26], gravity: 2, drag: 1.5, rot: 3, rotSpeed: 3, jitter: 0.8 });
        if (Math.hypot(e.pos.x - this.d.player.pos.x, e.pos.z - this.d.player.pos.z) < 30) ctx.sfx('tumbleweed', e.pos, 0.25, 1.6);
        this.ripple(e.pos.x, e.pos.z, 0.25);
      }
    } else if (s.mode === 'patrol' && s.path) {
      const tgt = s.path[s.pathI % s.path.length];
      const i = this.slots.filter((q) => q.path === s.path).indexOf(s);
      const ox = (i - 1) * 2.2, oz = (i % 2) * 2;
      const dx = tgt.x + ox - e.pos.x, dz = tgt.z + oz - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 2) s.pathI++;
      const sp = 2.1;
      e.vel.set((dx / d) * sp, 0, (dz / d) * sp);
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      e.pos.y = ctx.world.groundAt(e.pos.x, e.pos.z);
      e.yaw = dampAngle(e.yaw, Math.atan2(dx, dz), 3, dt);
    } else {
      e.vel.set(0, 0, 0);
      e.pos.set(s.home.x, ctx.world.groundAt(s.home.x, s.home.z), s.home.z);
    }
  }

  /** an army unit stops pretending: out of the water, off the patrol, up out of the ground */
  private release(s: Slot) {
    const e = s.e;
    if (!e || s.mode === 'free') return;
    const ctx = this.d.ctx;
    const mode = s.mode;
    s.mode = 'free';
    e.state = 'move';
    e.stateT = 0;
    e.retreat = 0;
    if (mode === 'lurk') {
      const lvl = s.water ? this.pond.level : ctx.world.sa.waterLevel;
      e.pos.y = ctx.world.groundAt(e.pos.x, e.pos.z);
      e.vel.y = 5;
      e.cds[0] = 0;
      this.shots.splash(e.pos.x, lvl, e.pos.z, 1.4);
      ctx.sfx('water_loop', e.pos, 0.8, 1.1);
      ctx.sfx('giant_scorpion_hiss', e.pos, 0.7, 0.8);
      this.d.enemies.skill(e, OASIS_CROC.moveTitles!.lurk, undefined, true);
    } else if (mode === 'rooted') {
      ctx.fx.sandBurst({ x: e.pos.x, y: e.pos.y, z: e.pos.z }, 1.3, 0x6a5030);
      ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 1.4, 0x5a4428, 5);
      ctx.sfx('rock_crumble', e.pos, 0.5, 1.6);
      e.squash.kick(7);
      this.d.enemies.skill(e, OASIS_FLYTRAP.moveTitles!.uproot, undefined, true);
    } else if (mode === 'patrol') {
      // the whole pack turns at once
      for (const o of this.slots) if (o !== s && o.path === s.path && o.e?.alive) this.release(o);
      if (rnd.chance(0.5)) this.d.enemies.skill(e, OASIS_CATFISH.moveTitles!.patrol);
      ctx.sfx('camel_grunt', e.pos, 0.5, 0.6);
    }
  }

  /** shot while lurking: it comes for you */
  private wake(e: Enemy) {
    if (!e || !ARMY_IDS.has(e.def?.id)) return;
    const s = this.slots.find((q) => q.e === e);
    if (s && s.mode !== 'free') this.release(s);
  }

  // ================================================================== puppets: the grabs
  private startPuppet(e: Enemy) {
    if (!e || !ARMY_IDS.has(e.def.id)) return;
    const ctx = this.d.ctx, pl = this.d.player;
    let geo: RigGeo;
    try {
      geo = buildRigGeo(resolveRig(e.rigKey), 'inst:' + e.rigKey);
    } catch {
      return;
    }
    const rig = new RigInstance(geo, { castShadow: true, material: sharedVoxelMaterial as never });
    rig.root.scale.setScalar(e.scale);
    this.group.add(rig.root);
    const kind = e.def.id === 'oasisCroc' ? 'roll' : e.def.id === 'oasisCatfish' ? 'gulp' : 'swallow';
    const yaw = Math.atan2(pl.pos.x - e.leapFrom.x, pl.pos.z - e.leapFrom.z);
    const fwd = _v.set(Math.sin(yaw), 0, Math.cos(yaw));
    const reach = (kind === 'roll' ? 1.72 : kind === 'gulp' ? 0.35 : 0.95) * e.scale;
    const at = new THREE.Vector3(pl.pos.x - fwd.x * reach, 0, pl.pos.z - fwd.z * reach);
    at.y = ctx.world.groundAt(at.x, at.z);
    const P: Puppet = { e, rig, kind, t: 0, saved: e.hidden.slice(), yaw, at, hunterVis: pl.root.visible, hid: false, spin: 0, thud: 0 };
    e.hidden.fill(1);
    if (kind !== 'roll') {
      pl.root.visible = false;
      P.hid = true;
    }
    this.puppets.push(P);
    if (kind === 'gulp') {
      ctx.sfx('scarab_squish', pl.pos, 1, 0.45);
      ctx.toast('GULPED!', '#ff8a6a', 'Mash E to burst out of its belly', true);
    } else if (kind === 'swallow') {
      ctx.sfx('scarab_squish', pl.pos, 1, 0.7);
      ctx.sfx('poison_burst', pl.pos, 0.7, 0.8);
      ctx.toast('SWALLOWED BY THE TRAP!', '#9dff3a', 'Mash E before it digests you', true);
    } else {
      ctx.sfx('hit_bone', pl.pos, 1, 0.6);
      ctx.toast('DEATH ROLL!', '#ff6a3a', 'Mash E to tear free', true);
    }
    this.posePuppet(P, 0);
  }

  private endPuppet(e: Enemy, broke: boolean) {
    const i = this.puppets.findIndex((p) => p.e === e);
    if (i < 0) return;
    const P = this.puppets[i];
    this.puppets.splice(i, 1);
    const ctx = this.d.ctx, pl = this.d.player;
    for (let k = 0; k < e.hidden.length; k++) e.hidden[k] = P.saved[k];
    P.rig.root.removeFromParent();
    if (P.hid) pl.root.visible = P.hunterVis;
    const fwd = _v.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    const wet = this.inPond(pl.pos.x, pl.pos.z) || ctx.world.field.heightAt(pl.pos.x, pl.pos.z) < ctx.world.sa.waterLevel;
    if (P.kind === 'gulp') {
      // spat out in a gush of water
      const m = P.at.clone().addScaledVector(fwd, 1.5 * e.scale);
      pl.board.pos.set(m.x, ctx.world.groundAt(m.x, m.z), m.z);
      pl.board.impulse.set(fwd.x * 14, 7, fwd.z * 14);
      this.shots.splash(m.x, pl.board.pos.y + 0.6, m.z, 1.6);
      ctx.sfx('water_loop', m, 1, 0.8);
      ctx.sfx('gore_splat', m, 0.6, 0.7);
      if (broke) ctx.toast('SPAT OUT!', '#9dff3a');
    } else if (P.kind === 'swallow') {
      const m = P.at.clone().addScaledVector(fwd, 1.4 * e.scale);
      pl.board.pos.set(m.x, ctx.world.groundAt(m.x, m.z), m.z);
      pl.board.impulse.set(fwd.x * 9, 6, fwd.z * 9);
      this.d.enemies.proj.acidSplash(m.x, pl.board.pos.y + 1.2, m.z, 0, true, e.id);
      ctx.sfx('poison_burst', m, 0.8, 1);
    } else if (wet) this.shots.splash(pl.pos.x, pl.pos.y + 0.3, pl.pos.z, 1.5);
    else ctx.fx.sandBurst({ x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }, 1.2);
    pl.invuln = Math.max(pl.invuln, 0.6);
  }

  private posePuppet(P: Puppet, dt: number) {
    const ctx = this.d.ctx, pl = this.d.player;
    const e = P.e;
    P.t += dt;
    e.hidden.fill(1);
    const n = P.rig.nodes;
    const t = P.t, s = e.scale;
    const fwd = _w.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    _q.setFromAxisAngle(UP, P.yaw);
    if (P.kind === 'roll') {
      // the death roll: the croc spins about its long axis with the hunter clamped in its jaws
      const rate = Math.min(11, 3 + t * 16);
      P.spin += rate * dt;
      const h = 0.36 * s;
      _q2.setFromAxisAngle(AXZ, P.spin);
      const q = _q.clone().multiply(_q2);
      const piv = new THREE.Vector3(0, h, 0);
      const off = piv.clone().applyQuaternion(q);
      P.rig.root.quaternion.copy(q);
      P.rig.root.position.set(P.at.x, P.at.y + h - off.y, P.at.z).add(new THREE.Vector3(-off.x, 0, -off.z));
      for (const k of ['fl', 'fr', 'bl', 'br']) {
        n['leg_' + k]?.rotation.set(0, Math.sin(t * 18 + k.length) * 0.5, Math.sin(t * 15 + (k[1] === 'l' ? 0 : 2)) * 0.6);
        n['foot_' + k]?.rotation.set(0, 0, Math.sin(t * 17) * 0.4);
      }
      for (let i = 1; i <= 3; i++) n['tail' + i]?.rotation.set(0, Math.sin(t * 9 - i) * 0.45, 0);
      n['jaw']?.rotation.set(0.1 + Math.sin(t * 20) * 0.03, 0, 0);
      n['head']?.rotation.set(-0.08, Math.sin(t * 13) * 0.08, 0);
      // the hunter rolls with it, about the chest
      const R = new THREE.Quaternion().setFromAxisAngle(fwd, P.spin);
      const c = new THREE.Vector3(pl.pos.x, pl.pos.y + 0.9, pl.pos.z);
      pl.root.position.sub(c).applyQuaternion(R).add(c);
      pl.root.quaternion.premultiply(R);
      P.thud -= dt;
      if (P.thud <= 0) {
        P.thud = 0.28;
        const wet = this.inPond(pl.pos.x, pl.pos.z) || ctx.world.field.heightAt(pl.pos.x, pl.pos.z) < ctx.world.sa.waterLevel;
        if (wet) this.shots.splash(pl.pos.x + (rnd.next() - 0.5) * 2, Math.max(this.pond.level, ctx.world.sa.waterLevel), pl.pos.z + (rnd.next() - 0.5) * 2, 0.8);
        else ctx.fx.sandSpray({ x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }, { x: (rnd.next() - 0.5) * 3, y: 2.5, z: (rnd.next() - 0.5) * 3 }, 1.4);
        ctx.sfx('hit_flesh', pl.pos, 0.6, 0.6 + rnd.next() * 0.2);
        ctx.shake(0.18);
      }
      return;
    }
    if (P.kind === 'gulp') {
      // jaws gape, snap shut; the belly bulges and squirms; it rocks and shakes its head
      const gape = t < 0.22 ? Math.sin((t / 0.22) * Math.PI) * 0.95 : 0.02;
      const rock = Math.sin(t * 6.5) * 0.12 + Math.sin(t * 11) * 0.04;
      P.rig.root.quaternion.copy(_q).multiply(_q2.setFromAxisAngle(AXZ, rock));
      P.rig.root.position.copy(P.at);
      n['jaw']?.rotation.set(gape, 0, 0);
      n['head']?.rotation.set(-gape * 0.4 + Math.sin(t * 9) * 0.05, Math.sin(t * 7) * 0.18, 0);
      const bm = P.rig.meshes['body'];
      const sq = Math.sin(t * 10) * 0.05 + Math.sin(t * 15.7) * 0.03;
      if (bm) bm.scale.set(1.16 + sq, 1.2 - sq * 0.6, 1.08);
      n['whisker_l']?.rotation.set(0, Math.sin(t * 8) * 0.3, -0.1);
      n['whisker_r']?.rotation.set(0, -Math.sin(t * 8 + 1) * 0.3, 0.1);
      for (let i = 1; i <= 3; i++) n['tail' + i]?.rotation.set(0, Math.sin(t * 7 - i * 0.8) * 0.35, 0);
      for (const k of ['fl', 'fr', 'bl', 'br']) n['leg_' + k]?.rotation.set(0, Math.sin(t * 9 + k.length * 3) * 0.3, (k[1] === 'l' ? 1 : -1) * Math.abs(Math.sin(t * 7)) * 0.3);
      P.thud -= dt;
      if (P.thud <= 0) {
        P.thud = 0.45 + rnd.next() * 0.4;
        const m = P.at.clone().addScaledVector(fwd, 1.2 * s);
        ctx.fx.bubbles({ x: m.x, y: m.y + 0.6 * s, z: m.z }, 3);
        ctx.sfx('scarab_squish', P.at, 0.4, 0.5 + rnd.next() * 0.3);
      }
      pl.root.visible = false;
      return;
    }
    // the trap: shut over the hunter, heaving, drooling acid; the roots grip the ground
    const close = Math.min(1, t / 0.18);
    P.rig.root.quaternion.copy(_q).multiply(_q2.setFromAxisAngle(AXZ, Math.sin(t * 4) * 0.05));
    P.rig.root.position.copy(P.at);
    const rest = P.rig.geo.parts[P.rig.geo.index['jaw']]?.rest.x ?? 0.4;
    n['jaw']?.rotation.set(rest - 0.9 * close + Math.sin(t * 12) * 0.02, 0, 0);
    n['head']?.rotation.set(0.42 * close + Math.sin(t * 5) * 0.04, Math.sin(t * 3.5) * 0.06, 0);
    const pulse = 1 + Math.max(0, Math.sin(t * 7)) * 0.08;
    const jm = P.rig.meshes['jaw'];
    if (jm) jm.scale.setScalar(pulse);
    n['mandible_l']?.rotation.set(0, -0.6 * close + Math.sin(t * 6) * 0.08, 0);
    n['mandible_r']?.rotation.set(0, 0.6 * close - Math.sin(t * 6) * 0.08, 0);
    for (let i = 1; i <= 3; i++) {
      n['leg_l' + i]?.rotation.set(0, 0, -0.12 + Math.sin(t * 5 + i) * 0.05);
      n['leg_r' + i]?.rotation.set(0, 0, 0.12 - Math.sin(t * 5 + i) * 0.05);
    }
    P.thud -= dt;
    if (P.thud <= 0) {
      P.thud = 0.3 + rnd.next() * 0.3;
      const m = P.at.clone().addScaledVector(fwd, 0.95 * s);
      ctx.particles.emit({ pos: { x: m.x, y: m.y + 1.9 * s, z: m.z }, count: 4, spread: 0.6, gravity: 9, life: [0.4, 0.8], size: [0.08, 0.04], sprite: ['ichor', 'dot3', 'bubble'], color: [0xc8ff5a, 0x9dff3a, 0xffffff], ground: true });
      ctx.sfx('poison_tick', m, 0.4, 0.8);
    }
    pl.root.visible = false;
  }

  // ================================================================== the King
  private ensureLurker() {
    if (this.lurker || this.state !== 'owned') return;
    const geo = kingGeo();
    if (!geo) return;
    const rig = new RigInstance(geo, { castShadow: true, material: sharedVoxelMaterial as never });
    this.group.add(rig.root);
    this.lurker = { rig, ang: rnd.next() * Math.PI * 2, surface: 0, surfaceT: 10, x: this.cx, z: this.cz, yaw: 0 };
  }
  private removeLurker() {
    if (!this.lurker) return;
    this.lurker.rig.root.removeFromParent();
    this.lurker = null;
    this.bulge(2, 0, 0, 1, 0);
  }
  private updateLurker(dt: number) {
    const L = this.lurker;
    if (!L) return;
    const ctx = this.d.ctx;
    const R = Math.max(4, this.pondR() * 0.5);
    L.ang += (1.5 / R) * dt;
    const x = this.cx + Math.cos(L.ang) * R, z = this.cz + Math.sin(L.ang) * R;
    L.yaw = Math.atan2(x - L.x, z - L.z);
    L.x = x;
    L.z = z;
    // now and then it surfaces: the broad head and the whiskers break the water
    L.surfaceT -= dt;
    if (L.surfaceT <= 0) {
      L.surfaceT = 14 + rnd.next() * 12;
      L.surface = 1;
      this.ripple(x, z, 0.8);
      ctx.sfx('water_loop', { x, y: this.pond.level, z }, 0.6, 0.5);
    }
    L.surface = Math.max(0, L.surface - dt / 4);
    const up = Math.sin(L.surface * Math.PI) * 1.1;
    const t = this.t;
    L.rig.root.position.set(x, this.pond.level - 2.85 + up, z);
    L.rig.root.rotation.set(0, L.yaw, 0);
    const n = L.rig.nodes;
    for (let i = 1; i <= 3; i++) n['tail' + i]?.rotation.set(0, Math.sin(t * 2.2 - i * 0.85) * (0.18 + i * 0.08), 0);
    n['body']?.rotation.set(0, Math.sin(t * 2.2) * 0.05, 0);
    n['fin_dorsal']?.rotation.set(-0.08, Math.sin(t * 1.1) * 0.04, 0);
    for (const s of [1, -1]) for (let i = 1; i <= 3; i++) n[`whisker_${s > 0 ? 'l' : 'r'}${i}`]?.rotation.set(0, (0.35 + Math.sin(t * 1.1 - i * 0.7) * 0.15) * s, 0);
    this.bulge(2, x + Math.sin(L.yaw) * 4, z + Math.cos(L.yaw) * 4, 4.5, 0.18 + up * 0.15);
    if (rnd.chance(dt * 3)) this.shots.splash(x + Math.sin(L.yaw) * 1.2, this.pond.level, z + Math.cos(L.yaw) * 1.2, 0.35);
    if (rnd.chance(dt * 0.8)) this.ripple(x, z, 0.3);
  }

  private bossAlive() {
    return this.d.enemies.externals.some((x) => x.alive && (x as { isBoss?: boolean }).isBoss);
  }

  /** riding into the island's bowl wakes the King (also: dev handle __oasis.startKing()) */
  startKing() {
    if (this.state !== 'owned') return null;
    const geo = kingGeo();
    if (!geo) {
      void loadKingGeo();
      return null;
    }
    const pl = this.d.player;
    const L = this.lurker;
    const x = L?.x ?? this.cx, z = L?.z ?? this.cz;
    const king = new OasisKing({ ctx: this.d.ctx, player: pl, enemies: this.d.enemies, qte: this.d.qte, cam: this.d.cam, cloth: this.d.cloth }, this, geo);
    king.place(x, z, Math.atan2(pl.pos.x - x, pl.pos.z - z));
    this.king = king;
    this.state = 'fight';
    // the ambient army joins the fight
    for (const s of this.slots) if (s.e?.alive && s.mode !== 'free' && Math.hypot(s.e.pos.x - pl.pos.x, s.e.pos.z - pl.pos.z) < 45) this.release(s);
    if (this.d.adoptBoss) {
      this.kingAdopted = true;
      this.d.adoptBoss(king);
    } else {
      this.d.enemies.registerExternal(king);
      void king.start();
    }
    this.d.ctx.events.emit('oasisKingStart', king);
    return king;
  }

  // ================================================================== the cleansing
  private cleanse() {
    if (this.state === 'cleansed') return;
    this.state = 'cleansed';
    const ctx = this.d.ctx;
    this.murkTarget = 0;
    this.pondTarget = this.base + 0.5;
    this.pondRate = 0.4;
    this.vortex(0, 0, 1, 0);
    // the army slinks off for good (the lurkers simply sink away)
    for (const e of this.army) {
      if (!e.alive) continue;
      const s = this.slots.find((q) => q.e === e);
      if (s && s.mode === 'lurk') {
        e.alive = false;
        this.shots.splash(e.pos.x, e.pos.y + 0.3, e.pos.z, 0.6);
        continue;
      }
      if (e.state === 'spawn') e.state = 'move';
      e.retreat = 0.001 + rnd.next() * 0.8;
    }
    this.slots.length = 0;
    ctx.engine.tweens.after(4.5, () => {
      ctx.toast('THE OASIS IS CLEANSED', '#7fe8dc', 'The Heart of the Oasis is a safe haven now', true);
      ctx.sfx('divine_chime', null, 0.9, 0.9);
      this.d.enemies.callout('Good Day Sunshine', { x: this.cx, y: this.pond.level + 6, z: this.cz }, 'boss');
      ctx.events.emit('oasisCleansed', this);
      this.bloom();
    }, true);
  }

  /** lily pads float up on the clear water, dragonflies come back */
  private bloom() {
    const ctx = this.d.ctx;
    try {
      for (let v = 0; v < 2; v++) {
        const lp = lilyPads(v + 2) as { model: any; voxelSize: number };
        const base = voxelMesh(lp.model, lp.voxelSize, 'bottom');
        const N = 9;
        const mesh = new THREE.InstancedMesh(base.geometry, sharedVoxelMaterial, N);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        const pts: { x: number; z: number; rot: number; ph: number }[] = [];
        for (let i = 0; i < N; i++) {
          const a = rnd.next() * Math.PI * 2, r = this.pondR() * (0.2 + rnd.next() * 0.68);
          pts.push({ x: this.cx + Math.cos(a) * r, z: this.cz + Math.sin(a) * r, rot: rnd.next() * 6.28, ph: rnd.next() * 6 });
        }
        this.group.add(mesh);
        this.lilies.push({ mesh, pts });
      }
      for (let i = 0; i < 4; i++) {
        const rig = new RigInstance(buildRigGeo(dragonflyRig(i), 'dragonfly' + i), { castShadow: false });
        const p = new THREE.Vector3(this.cx + (rnd.next() - 0.5) * 20, this.pond.level + 0.8, this.cz + (rnd.next() - 0.5) * 20);
        rig.root.position.copy(p);
        this.group.add(rig.root);
        this.flies.push({ rig, pos: p.clone(), from: p.clone(), to: p.clone(), t: 1, dur: 1, ph: rnd.next() * 10 });
      }
    } catch (e) {
      console.warn('[oasis] bloom failed', e);
    }
    // a rising shimmer over the whole pond
    for (let i = 0; i < 40; i++) {
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * this.pondR();
      ctx.particles.emit({ pos: { x: this.cx + Math.cos(a) * r, y: this.pond.level + 0.2, z: this.cz + Math.sin(a) * r }, count: 1, vel: { x: 0, y: 1.2 + rnd.next(), z: 0 }, life: [1.2, 2.4], size: [0.4, 0.05], sprite: ['star4', 'glow16'], additive: true, color: [0xffe8a8, 0xd8fff4, 0xffffff], delay: rnd.next() * 2 });
    }
  }

  // ================================================================== per frame
  update(dt: number) {
    this.t += dt;
    const d = this.d, ctx = d.ctx, pl = d.player, pp = pl.pos;
    const dist = Math.hypot(pp.x - this.cx, pp.z - this.cz);
    const near = dist < this.zone.r + 60;
    // quiet prewarm of the army's instanced rigs, one per half second
    if (this.warm.length) {
      this.warmT -= dt;
      if (this.warmT <= 0) {
        this.warmT = 0.5;
        const k = this.warm.shift()!;
        try {
          d.enemies.render.get(k, 96);
        } catch (e) {
          console.warn('[oasis] prewarm', k, e);
        }
      }
    }
    // the water: level, murk, the shots
    this.pond.level = damp(this.pond.level, this.pondTarget, 3 * this.pondRate, dt);
    this.murk = damp(this.murk, this.murkTarget, 0.35, dt);
    this.pond.u.uMurk.value = this.murk;
    if (this.moat) {
      this.moat.u.uMurk.value = this.murk;
      this.moat.u.uAlpha.value = clamp(this.murk * 1.2, 0, 1);
    }
    this.shots.murk = this.murk;
    this.shots.update(dt);
    // the King's lurking silhouette, then the trigger
    if (this.state === 'owned' && this.zoneOpen()) {
      this.ensureLurker();
      this.updateLurker(dt);
      if (this.lurker && pl.alive && dist < this.r * 0.8 && !this.bossAlive()) this.startKing();
    }
    if (this.king && !this.kingAdopted && (this.king.alive || this.king.root.parent)) this.king.update(dt);
    // the army: spawn once the zone opens, hold the ambushes, respawn the fallen while the King rules
    if (this.state !== 'cleansed' && this.zoneOpen() && near) {
      if (!this.slots.length) this.spawnArmy();
      for (const s of this.slots) {
        if (!s.e || !s.e.alive) {
          if (s.e && !s.e.alive) {
            s.e = null;
            s.respawn = 40 + rnd.next() * 20;
          }
          s.respawn -= dt;
          if (s.respawn <= 0 && this.state === 'owned' && Math.hypot(s.home.x - pp.x, s.home.z - pp.z) > 30) this.spawnSlot(s);
          continue;
        }
        if (s.mode === 'free') continue;
        const ed = Math.hypot(s.e.pos.x - pp.x, s.e.pos.z - pp.z);
        const wakeR = s.mode === 'lurk' ? 9 + pl.speed * 0.3 : s.mode === 'patrol' ? 20 : 11;
        if (pl.alive && ed < wakeR && Math.abs(s.e.pos.y - pp.y) < 6) this.release(s);
        else this.hold(s, dt);
      }
    }
    for (const e of this.army) if (!e.alive) this.army.delete(e);
    // the catfish water jets
    for (const e of this.army) {
      if (e.def.id !== 'oasisCatfish' || !e.alive) continue;
      if (e.atk === JET && e.state === 'windup' && this.jetDone.get(e) !== -1 && e.stateT < 0.1) {
        this.jetDone.set(e, -1);
        const to = _v.set(pp.x - e.pos.x, 0, pp.z - e.pos.z);
        const L = to.length() || 1;
        d.enemies.warn.lane(e.pos.x, e.pos.z, to.x / L, to.z / L, Math.min(16, L + 3), 1.8, e.wind, 'tell');
      }
      if (e.atk === JET && e.state === 'strike' && this.jetDone.get(e) !== 1) {
        this.jetDone.set(e, 1);
        this.catfishJet(e);
      }
      if (e.state !== 'strike' && e.state !== 'windup') this.jetDone.delete(e);
    }
    // the grabs
    for (const P of this.puppets) this.posePuppet(P, dt);
    // ambience while the King rules: rumbles, burps of gas, flies over the scum
    if (this.state !== 'cleansed' && dist < this.zone.r + 20) {
      this.rumbleT -= dt;
      if (this.rumbleT <= 0) {
        this.rumbleT = 14 + rnd.next() * 14;
        ctx.sfx('quake_rumble', null, 0.45, 0.6);
        ctx.shake(0.12);
        this.ripple(this.cx + (rnd.next() - 0.5) * 20, this.cz + (rnd.next() - 0.5) * 20, 0.6);
      }
      if (rnd.chance(dt * 2.5)) {
        const a = rnd.next() * Math.PI * 2, r = rnd.next() * this.pondR() * 0.95;
        ctx.fx.bubbles({ x: this.cx + Math.cos(a) * r, y: this.pond.level, z: this.cz + Math.sin(a) * r }, 2);
      }
      if (this.murk > 0.5 && rnd.chance(dt * 1.5)) {
        const a = rnd.next() * Math.PI * 2, r = rnd.next() * this.pondR();
        ctx.particles.emit({ pos: { x: this.cx + Math.cos(a) * r, y: this.pond.level + 0.5 + rnd.next() * 0.8, z: this.cz + Math.sin(a) * r }, count: 4, spread: 0.6, life: [1.2, 2.2], size: [0.06, 0.06], sprite: ['fly0', 'fly1'], animate: true, color: 0x2a2418, drag: 3, jitter: 0.5 });
      }
    }
    // wading through the pond: a bow wave off the board
    if (pl.alive && pl.root.visible && this.inPond(pp.x, pp.z) && this.pond.level > ctx.world.groundAt(pp.x, pp.z) + 0.05) {
      const sp = pl.speed;
      this.wadeT -= dt;
      if (sp > 2.5 && rnd.chance(dt * (8 + sp))) {
        const v = pl.board.vel;
        ctx.particles.emit({ pos: { x: pp.x, y: this.pond.level + 0.05, z: pp.z }, count: 3, vel: { x: v.x * 0.25, y: 2 + sp * 0.12, z: v.z * 0.25 }, spread: 1.4, gravity: 12, life: [0.3, 0.7], size: [0.1, 0.04], sprite: ['dot3', 'dot4', 'bubble'], color: this.murk > 0.5 ? [0xb8c890, 0x8a9a5a, 0xdce4b8] : [0xd8f4f0, 0xffffff, 0x9ad8d0], jitter: 0.4 });
      }
      if (sp > 4 && this.wadeT <= 0) {
        this.wadeT = 0.5;
        this.ripple(pp.x, pp.z, 0.25);
        ctx.sfx('water_loop', pp, 0.25, 1.4);
      }
    }
    // the haze: sickly green while the King rules, gold once cleansed
    this.updateEnv(dt, dist);
    // the haven
    if (this.state === 'cleansed') this.updateHaven(dt, dist);
  }

  private catfishJet(e: Enemy) {
    const ctx = this.d.ctx;
    const from = this.d.enemies.socketWorld(e, 'mouth', new THREE.Vector3()) ?? new THREE.Vector3(e.pos.x + Math.sin(e.yaw) * 1.3, e.pos.y + 0.6, e.pos.z + Math.cos(e.yaw) * 1.3);
    const to = this.d.player.center(new THREE.Vector3());
    const dmg = JET.dmg * e.dmgMul;
    for (let i = 0; i < 5; i++)
      ctx.engine.tweens.after(i * 0.06, () => {
        if (!e.alive) return;
        this.shots.fire(from, { x: to.x + (rnd.next() - 0.5) * 0.4, y: to.y, z: to.z + (rnd.next() - 0.5) * 0.4 }, { speed: 19, dmg: i === 0 ? dmg : dmg * 0.35, knock: i === 0 ? 13 : 4, r: 0.36 });
      });
    this.shots.splash(from.x, from.y - 0.3, from.z, 0.5);
    ctx.sfx('water_loop', from, 0.7, 1.2);
    ctx.sfx('camel_spit', from, 0.6, 0.6);
  }

  private updateEnv(dt: number, dist: number) {
    const env = this.d.ctx.world.env;
    const base = PRESETS[this.d.ctx.world.sa.env] ?? env.preset;
    const inside = clamp(1 - (dist - this.zone.r * 0.7) / (this.zone.r * 0.6), 0, 1);
    const otherBoss = this.d.enemies.externals.some((x) => x.alive && (x as { isBoss?: boolean }).isBoss && x !== this.king);
    const want = otherBoss ? 0 : this.state === 'cleansed' ? 0 : inside * 0.55 * this.murk;
    this.envK = damp(this.envK, want, 1.2, dt);
    this.havenK = damp(this.havenK, this.state === 'cleansed' && !otherBoss ? inside * 0.5 : 0, 0.6, dt);
    const k = this.envK + this.havenK;
    if (k < 0.004 && this.envApplied <= 0.004) return;
    if (Math.abs(k - this.envApplied) < 0.006) return;
    this.envApplied = k;
    if (k < 0.004) env.apply(base);
    else if (this.havenK > this.envK) env.lerpPreset(base, HAVEN_ENV, this.havenK);
    else env.lerpPreset(base, MURK_ENV, this.envK);
  }

  private updateHaven(dt: number, dist: number) {
    const ctx = this.d.ctx, pl = this.d.player, pp = pl.pos;
    // lily pads bob on the clear water
    for (const L of this.lilies) {
      const m = new THREE.Matrix4();
      L.pts.forEach((p, i) => {
        const y = this.pond.level + 0.01 + Math.sin(this.t * 1.1 + p.ph) * 0.025;
        m.compose(_v.set(p.x, y, p.z), _q.setFromAxisAngle(UP, p.rot + Math.sin(this.t * 0.3 + p.ph) * 0.1), _w.set(1, 1, 1));
        L.mesh.setMatrixAt(i, m);
      });
      L.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const f of this.flies) {
      f.ph += dt;
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.from.copy(f.pos);
        const a = rnd.next() * Math.PI * 2, r = this.pondR() * (0.1 + rnd.next() * 0.85);
        f.to.set(this.cx + Math.cos(a) * r, this.pond.level + 0.4 + rnd.next() * 1.2, this.cz + Math.sin(a) * r);
        f.dur = 0.4 + rnd.next() * 0.5;
        f.t = -rnd.next() * 1.6;
      }
      const k = clamp(f.t, 0, 1);
      f.pos.lerpVectors(f.from, f.to, k * k * (3 - 2 * k));
      f.rig.root.position.set(f.pos.x, f.pos.y + Math.sin(f.ph * 3) * 0.04, f.pos.z);
      if (f.t > 0 && f.t < 1) f.rig.root.rotation.y = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
      const w = Math.sin(f.ph * 70) * 0.6;
      f.rig.nodes['wing_l']?.rotation.set(0, 0, w);
      f.rig.nodes['wing_r']?.rotation.set(0, 0, -w);
    }
    // the safe haven: the clear water heals while nothing hunts you
    if (!pl.alive || dist > this.pondR() + 10 || pl.hp >= pl.maxHp) return;
    let threat = false;
    for (const e of this.d.enemies.list) if (e.alive && e.pos.distanceToSquared(pp) < 400) {
      threat = true;
      break;
    }
    if (threat) return;
    this.regenT += dt;
    if (this.regenT < 0.5) return;
    this.regenT = 0;
    pl.heal(pl.maxHp * 0.02);
    ctx.fx.sparkle({ x: pp.x, y: pp.y + 1, z: pp.z }, 0x7fe8dc, 3, 0.6);
    if (!this.havenToast) {
      this.havenToast = true;
      ctx.toast('SAFE HAVEN', '#7fe8dc', 'The Heart of the Oasis mends your bones');
    }
  }

  dispose() {
    for (const off of this.offs) off();
    for (const P of [...this.puppets]) this.endPuppet(P.e, false);
    this.removeLurker();
    this.pond.dispose();
    this.moat?.dispose();
    this.shots.clear();
    this.group.removeFromParent();
    if (this.envApplied > 0.004) this.d.ctx.world.env.apply(PRESETS[this.d.ctx.world.sa.env] ?? this.d.ctx.world.env.preset);
    if (typeof window !== 'undefined' && (window as any).__oasis === this) (window as any).__oasis = null;
  }
}

function dampAngle(a: number, b: number, rate: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-rate * dt));
}
