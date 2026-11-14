// RA, THE SUN KING — the Nile's last gate, wave 100. Cleopatra was only his
// vessel; when she falls he comes himself. The sky splits, the sun falls out of
// the rift and unfolds above the burned river: a ~34 m falcon-headed god of
// living fire (models/enemies/ra.ts) who hovers over the lava, his disc behind
// his head, his wings 60 m across. He is the light of the fight: the sun's
// direction follows his disc, so every shadow on the field points away from him.
//   Phase 1 (100–66%)  Here Comes the Sun (flare globs arc down and burst into
//                      skimming rings of sun orbs), Shine a Light (twin eye
//                      beams sweep the ground and melt a burning trench),
//                      Jumpin' Jack Flash (fire falcons peel off his wings,
//                      circle and dive)
//   Phase 2 (66–33%)   + The Long and Winding Road (a solar wind blows down the
//                      river: the board is shoved along it through lanes of
//                      wind-borne orbs), November Rain (sunfire meteors)
//   Phase 3 (33–0%)    + Paint It Black (an eclipse: meteors cool into obsidian
//                      spires, the moon covers his disc and the corona flashes:
//                      only his shadow is safe; the eyes are the target), and
//                      at the end Live and Let Die (he goes supernova: a timing
//                      QTE to shoot the heart of the sun)
// Weak points: the sun disc core (×2, ×4 while he is spent after the
// supernova), the eyes (×2.4, ×3.2 in the eclipse).
// Death: he collapses into a dying star (the body burns away into the core,
// the core swells red, falls in on itself and flashes white), the fire drains
// out of the world, the river runs back to water and dawn comes up.
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere, Cancelled } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { EnvPreset } from '../world/Env';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigGeo } from '../../engine/voxel/Rig';
import type { RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import type { VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { raHeadHD, raJawHD, raEyeHD, sunMeteorModel, obsidianSpireModel, eclipseMoonModel, fireFalconRig } from '../models/enemies/ra';
import { raMaterial, SolarShots, Ribbon, segDist, riverFlow, SUN, EMBERS, FIRE_COLS } from './RaFx';
import { Cinema } from '../cine/Cinema';
import { speak3D } from '../fx/WorldSpeech';
import type { VoiceId } from '../audio/Voice';
import { rnd, damp, clamp, dampAngle } from '../../engine/math/rand';

const SUNC = '#ffc860';
/** a deep, ringing god's voice */
const RA_VOICE: VoiceId = 'setAvatar';
const MOLTEN_DROP = 0xffb040;
const ASH = [0x3a302c, 0x5a4a42, 0x2a2220];
const SMOKE = [0x4a3a34, 0x3a2c28, 0x6a5246];
/** Ra's sky: a burning dusk under him (the sun's direction is tracked to his disc) */
const BURN: Partial<EnvPreset> = {
  zenith: 0x3a1418, horizon: 0xff8a3a, ground: 0x5a2010, sunColor: 0xffc070, sunIntensity: 3.3, hemiSky: 0xd07050, hemiGround: 0x8a3010, hemiIntensity: 1.05,
  fog: 0x9a3a1e, fogNear: 50, fogFar: 380, exposure: 1.04, stars: 0, clouds: 0.5, cloudColor: 0xff9a5a,
};
const ECLIPSE: Partial<EnvPreset> = {
  zenith: 0x040308, horizon: 0x5a1610, ground: 0x160806, sunColor: 0xfff2dc, sunIntensity: 0.55, hemiSky: 0x2a2036, hemiGround: 0x2a0c08, hemiIntensity: 0.5,
  fog: 0x160a0c, fogNear: 30, fogFar: 260, exposure: 1.12, stars: 0.9, clouds: 0.15, cloudColor: 0x4a1a1a,
};
const NOVA: Partial<EnvPreset> = {
  zenith: 0xffe0b0, horizon: 0xfff6e8, ground: 0xffc890, sunColor: 0xfff8f0, sunIntensity: 5.0, hemiSky: 0xfff0d8, hemiGround: 0xffb070, hemiIntensity: 1.6,
  fog: 0xffe8c8, fogNear: 20, fogFar: 260, exposure: 1.2, stars: 0, clouds: 0.1, cloudColor: 0xffffff,
};
const DAWN: Partial<EnvPreset> = {
  zenith: 0x3a6ab4, horizon: 0xffc8a0, ground: 0xc89a70, sunColor: 0xffd2a4, sunIntensity: 2.7, sunElev: 9, hemiSky: 0xa8c0e8, hemiGround: 0xb08868, hemiIntensity: 1.0,
  fog: 0xf0c8b4, fogNear: 50, fogFar: 480, exposure: 1.0, stars: 0.04, clouds: 0.6, cloudColor: 0xffd8c4,
};
const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'sunColor', 'hemiSky', 'hemiGround', 'fog', 'cloudColor'] as const;
const NUM_KEYS = ['sunIntensity', 'sunElev', 'sunAzim', 'hemiIntensity', 'fogNear', 'fogFar', 'exposure', 'stars', 'clouds'] as const;
const _ca = new THREE.Color();
const _cb = new THREE.Color();
function mixPreset(a: EnvPreset, b: Partial<EnvPreset>, k: number): EnvPreset {
  if (k <= 0) return a;
  const o = { ...a } as EnvPreset;
  for (const key of COLOR_KEYS) if (b[key] !== undefined) o[key] = _ca.setHex(a[key]).lerp(_cb.setHex(b[key]!), k).getHex();
  for (const key of NUM_KEYS) if (b[key] !== undefined) o[key] = a[key] + (b[key]! - a[key]) * k;
  return o;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

// ----------------------------------------------------------------------------- shared geometry (built once per page)
export interface RaGeos {
  head: THREE.BufferGeometry;
  jaw: THREE.BufferGeometry;
  eyeL: THREE.BufferGeometry;
  eyeR: THREE.BufferGeometry;
  meteors: THREE.BufferGeometry[];
  spires: THREE.BufferGeometry[];
  moon: THREE.BufferGeometry;
  falcon: RigGeo;
}
let GEOS: RaGeos | null = null;
export function raGeos(): RaGeos {
  if (GEOS) return GEOS;
  const g = (r: { model: any; voxelSize: number; pivot?: [number, number, number] }, pv: [number, number, number] | 'center' | 'bottom' = 'center') => buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: r.pivot ?? pv });
  GEOS = {
    head: g(raHeadHD()),
    jaw: g(raJawHD()),
    eyeL: g(raEyeHD(false)),
    eyeR: g(raEyeHD(true)),
    meteors: [0, 1, 2].map((s) => g(sunMeteorModel(s))),
    spires: [0, 1, 2, 3].map((s) => g(obsidianSpireModel(s), 'bottom')),
    moon: g(eclipseMoonModel()),
    falcon: buildRigGeo(fireFalconRig(), 'ra_falcon'),
  };
  return GEOS;
}
let RIG: RigGeo | null = null;
/** Ra's body rig (the boss and the wrath apparition share one build) */
export function raRigGeo(): RigGeo {
  if (!RIG) RIG = buildRigGeo(modelEntry('ra')!() as RigSpec, 'boss:ra');
  return RIG;
}
/** build Ra's rig and his close-up parts ahead of time (loading screens) */
export function prewarmRa() {
  raRigGeo();
  raGeos();
}

// ----------------------------------------------------------------------------- arm IK data (as the Khonsu colossus)
interface ArmJ {
  E: THREE.Vector3;
  W: THREE.Vector3;
  K: THREE.Vector3;
  fist: THREE.Vector3;
  palm: THREE.Vector3;
  L1: number;
  u0: THREE.Vector3;
  fingers: THREE.Vector3[];
  thumb: THREE.Vector3;
  wristAxis: THREE.Vector3;
}
interface ArmCtl {
  mode: 'rest' | 'aim';
  tgt: THREE.Vector3;
  now: THREE.Vector3;
  rate: number;
  curl: number;
  curlNow: number;
  wrist: number;
  wristNow: number;
  pole: THREE.Vector3;
}
interface Falcon {
  rig: RigInstance;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  state: 'rise' | 'circle' | 'dive';
  t: number;
  hp: number;
  ang: number;
  wait: number;
  target: THREE.Vector3;
  flap: number;
  yaw: number;
  pitch: number;
  marked: boolean;
}
interface Meteor {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  T: number;
  spire: number;
  dmg: number;
  ring: number;
  spin: THREE.Vector3;
}
interface Spire {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  y: number;
  h: number;
  r: number;
  t: number;
  life: number;
}
interface Fire {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
  dps: number;
}
interface Sweep {
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
  T: number;
  warn: number;
  hitCd: number;
  melt: number;
  last: THREE.Vector3;
  p: THREE.Vector3;
}

export class RaSunKing extends Boss {
  private body: VoxelMaterial;
  private eyeMat: VoxelMaterial;
  private raU = { value: new THREE.Vector4(1, 1, 1, 1) };
  private eyeRa = { value: new THREE.Vector4(1.3, 0, 1.4, 1) };
  private J: ArmJ[] = [];
  private arms: ArmCtl[] = [];
  private eyeAxis: THREE.Vector3[];
  private hd: THREE.Mesh[] = [];
  // pose controls
  private flapPh = 0;
  private flapRate = 2.3;
  private flapAmp = 0.1;
  private beat = 0;
  private liftW = 0;
  private foldT = 0;
  private foldNow = 0;
  private bendT = 0;
  private bendNow = 0;
  private headUp = 0;
  private headUpNow = 0;
  private hoverH = 9;
  private yRate = 2.2;
  private lift = 0;
  private liftNow = 0;
  private glide = new THREE.Vector3();
  private glideTo: THREE.Vector3 | null = null;
  private glideSpeed = 6;
  private turnRate = 1.2;
  private discT = 0.3;
  private discNow = 0.3;
  private coreScaleT = 1;
  private coreScaleNow = 1;
  private eyeGlowT = 1;
  private eyeGlowNow = 1;
  private spent = 0;
  // the fight's own systems
  private shots: SolarShots;
  private beams: Ribbon[];
  private warnLine: Ribbon;
  private sweeps: Sweep[] = [];
  private falcons: Falcon[] = [];
  private meteors: Meteor[] = [];
  private spires: Spire[] = [];
  private fires: Fire[] = [];
  private moon: THREE.Mesh | null = null;
  private moonK = 0;
  private moonT = 0;
  private wind = { on: 0, t: 0, dir: new THREE.Vector3(1, 0, 0), accel: 0 };
  private sunLight: THREE.PointLight;
  // the sky
  private baseEnv: EnvPreset;
  private burnT = 0.55;
  private burnNow = 0;
  private eclT = 0;
  private eclNow = 0;
  private novaT = 0;
  private novaNow = 0;
  private dawn = 0;
  private envAcc = 1;
  /** the death sequence takes the sky over (restoreWorld) */
  private envHeld = false;
  private bloom0 = -1;
  private fxT = 0;
  private queue: string[] = [];
  private cds = { eclipse: 10, wind: 4, rain: 2 };
  private lastAttack = '';
  private lastCallout = '';
  private novaDone = false;
  private dead = false;
  private coreSphere: HitSphere;
  private eyeSpheres: HitSphere[];
  private corpse: THREE.Object3D | null = null;
  private gone = false;

  constructor(d: BossDeps, tier = 3) {
    super(d, 'ra', { name: 'Ra', title: 'The Sun King', hp: 2600 * 8 + 600 * Math.max(0, tier - 3), scale: 1, eyes: ['glow', 0xffd060] });
    this.armor = 50;
    this.physRes = 0.12;
    this.magicRes = 0.24;
    this.statusRes = { burn: 0.9 } as any;
    this.bounty = 2000;
    this.gold = 900;
    this.phases = [0.66, 0.33];
    this.flying = true;
    this.squash.kick = () => {}; // a god of 34 m does not wobble
    const ctx = this.ctx;
    const meta = this.rig.geo.spec.meta ?? {};
    RIG = this.rig.geo;
    const G = raGeos();
    // ------------------------------------------------------------------ materials
    const fx = this.rig.material.userData.fx;
    this.body = raMaterial(fx, this.raU, 'body');
    this.eyeMat = raMaterial(fx, this.eyeRa, 'eyes');
    for (const mesh of Object.values(this.rig.meshes)) {
      mesh.material = this.body;
      mesh.castShadow = false; // he is the light: his own body never shades the field
    }
    this.rig.material.dispose();
    this.rig.material = this.body;
    // close-up head, jaw and the modelled eyes replace the body-rig versions
    const n = this.rig.nodes;
    const swap = (part: string, geo: THREE.BufferGeometry, mat: VoxelMaterial) => {
      const node = n[part];
      if (!node) return;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false;
      m.receiveShadow = true;
      node.add(m);
      this.hd.push(m);
      this.rig.meshes[part].visible = false;
    };
    swap('head', G.head, this.body);
    swap('jaw', G.jaw, this.body);
    swap('eye_l', G.eyeL, this.eyeMat);
    swap('eye_r', G.eyeR, this.eyeMat);
    // ------------------------------------------------------------------ rig data (rig-local metres, right side mirrored)
    const ik = meta.ik;
    const mx = (meta.mirrorX as number) ?? 0;
    for (const s of [0, 1]) {
      const pt = (v: number[]) => (s === 0 ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(mx - v[0], v[1], v[2]));
      const ax = (v: number[]) => (s === 0 ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v[0], -v[1], -v[2]));
      const S = pt(ik.shoulder), E = pt(ik.elbow);
      this.J.push({ E, W: pt(ik.wrist), K: pt(ik.knuckle), fist: pt(ik.fist), palm: pt(ik.palm), L1: S.distanceTo(E), u0: E.clone().sub(S).normalize(), fingers: (ik.fingerAxes as number[][]).map(ax), thumb: ax(ik.thumbAxis), wristAxis: ax(ik.handX) });
      this.arms.push({ mode: 'rest', tgt: new THREE.Vector3(), now: new THREE.Vector3(), rate: 2, curl: 0.4, curlNow: 0.4, wrist: 0, wristNow: 0, pole: new THREE.Vector3(s === 0 ? 0.7 : -0.7, -0.1, -0.7).normalize() });
    }
    const ea = meta.eyeAxis as number[];
    this.eyeAxis = [new THREE.Vector3(ea[0], ea[1], ea[2]).normalize(), new THREE.Vector3(-ea[0], ea[1], ea[2]).normalize()];
    // ------------------------------------------------------------------ hit spheres (node-local offsets from rest positions)
    const rest = (name: string) => {
      const out = new THREE.Vector3();
      let o: THREE.Object3D | null = n[name] ?? null;
      while (o && o !== this.rig.root) {
        out.add(o.position);
        o = o.parent;
      }
      return out;
    };
    const off = (name: string, p: number[]): [number, number, number] => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).sub(rest(name));
      return [v.x, v.y, v.z];
    };
    const mir = (p: number[]) => [mx - p[0], p[1], p[2]];
    this.eyeSpheres = [
      { node: 'eye_l', r: 0.95, part: 'eye', weak: 2.4 },
      { node: 'eye_r', r: 0.95, part: 'eye', weak: 2.4 },
    ];
    this.coreSphere = { node: 'core', r: 3.5, part: 'core', weak: 2.0, offset: [0, 0, 0.7] };
    const hpv = meta.headPivot as number[];
    this.hitSpheres = [
      ...this.eyeSpheres,
      this.coreSphere,
      { node: 'head', r: 2.5, part: 'head', weak: 1.3, offset: [0, 2.4, 0.6] },
      { node: 'torso', r: 4.6, part: 'torso', weak: 0.8, offset: off('torso', [0, 16.8, 0.4]) },
      { node: 'pelvis', r: 3.4, part: 'body', weak: 0.6, offset: off('pelvis', [0, 9.6, 0]) },
      { node: 'tail2', r: 2.0, part: 'body', weak: 0.6 },
      { node: 'arm_l', r: 1.5, part: 'arm', weak: 0.7, offset: off('arm_l', [6.1, 17.3, 0.2]) },
      { node: 'arm_r', r: 1.5, part: 'arm', weak: 0.7, offset: off('arm_r', mir([6.1, 17.3, 0.2])) },
      { node: 'fore_l', r: 1.3, part: 'arm', weak: 0.7, offset: off('fore_l', [7.9, 13.4, 1.6]) },
      { node: 'fore_r', r: 1.3, part: 'arm', weak: 0.7, offset: off('fore_r', mir([7.9, 13.4, 1.6])) },
      { node: 'wing_l', r: 4.0, part: 'wing', weak: 0.45, offset: off('wing_l', [6.4, 17.6, -3.2]) },
      { node: 'wing_r', r: 4.0, part: 'wing', weak: 0.45, offset: off('wing_r', mir([6.4, 17.6, -3.2])) },
      { node: 'wing2_l', r: 4.0, part: 'wing', weak: 0.45, offset: off('wing2_l', [13.4, 20.6, -3.9]) },
      { node: 'wing2_r', r: 4.0, part: 'wing', weak: 0.45, offset: off('wing2_r', mir([13.4, 20.6, -3.9])) },
      { node: 'wing3_l', r: 4.4, part: 'wing', weak: 0.45, offset: off('wing3_l', [21.5, 21.0, -4.4]) },
      { node: 'wing3_r', r: 4.4, part: 'wing', weak: 0.45, offset: off('wing3_r', mir([21.5, 21.0, -4.4])) },
    ];
    void hpv;
    this.radius = 6.5;
    // ------------------------------------------------------------------ systems
    this.shots = new SolarShots(ctx, this.player, this.id);
    this.beams = [new Ribbon(28, { core: 0xfff6e0, edge: 0xff9a32, flow: 9 }), new Ribbon(28, { core: 0xfff6e0, edge: 0xff9a32, flow: 9 })];
    this.warnLine = new Ribbon(40, { core: 0xffb070, edge: 0xe0401a, flow: 3 });
    for (const r of [...this.beams, this.warnLine]) {
      r.intensity = 0;
      ctx.scene.add(r.mesh);
    }
    this.sunLight = new THREE.PointLight(0xffb060, 0, 170, 1.05);
    this.sunLight.castShadow = false;
    (this.rig.sockets['core'] ?? this.root).add(this.sunLight);
    this.baseEnv = { ...ctx.world.env.preset };
    const post = ctx.engine.post as unknown as { bloom?: { strength: number } };
    if (post.bloom) {
      this.bloom0 = post.bloom.strength;
      post.bloom.strength = Math.max(this.bloom0, 0.12);
    }
    (window as any).__ra = this; // dev handle: __ra.debug('shineALight')
  }

  protected hitKind() {
    return 'spirit' as any;
  }

  // ------------------------------------------------------------------ helpers
  private callout(song: string) {
    if (song === this.lastCallout) return;
    this.lastCallout = song;
    this.ctx.toast(`« ${song} »`, SUNC, 'Ra');
    this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
  }
  private say(lines: string[]) {
    this.taunt(rnd.pick(lines), SUNC);
  }
  /** his words hang by his beak (floating 3D type that follows his head), not over his disc */
  taunt(text: string, color = SUNC) {
    const at = this.rig.sockets['mouth'] ?? this.root;
    speak3D(this.ctx.engine, RA_VOICE, text, at, { key: `boss:${this.id}`, lift: 2.2, side: 4.5, size: 0.24, px: 64, wrap: 26, color: '#fff1dc', glow: color, hdr: 1.7, voice: { follow: true, key: `boss:${this.id}` } });
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private baseGround(x: number, z: number) {
    const w = this.ctx.world;
    return Math.max(w.sa.field.heightSmooth(x, z), w.sa.waterLevel);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private socketWorld(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    if (s) {
      s.updateWorldMatrix(true, false);
      s.getWorldPosition(out);
    } else out.set(this.pos.x, this.pos.y + 25, this.pos.z);
    return out;
  }
  private discWorld(out: THREE.Vector3) {
    return this.socketWorld('core', out);
  }
  /** touching him means touching the white-hot point of his tail */
  distToPlayer() {
    const pp = this.player.pos;
    return Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z, Math.max(0, this.pos.y - pp.y - 1.5));
  }
  private stopArms() {
    for (const A of this.arms) {
      A.mode = 'rest';
      A.wrist = 0;
    }
    this.bendT = 0;
    this.headUp = 0;
    this.anim.jaw = 0;
  }
  private aim(s: number, p: THREE.Vector3, rate: number, curl: number, wrist = 0) {
    const A = this.arms[s];
    A.mode = 'aim';
    A.tgt.copy(p);
    A.rate = rate;
    A.curl = curl;
    A.wrist = wrist;
  }
  /** a point in his own frame (rig-local metres) */
  private local(x: number, y: number, z: number) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(new THREE.Vector3(x, y, z));
  }
  private storm(x: number, z: number) {
    return this.ctx.world.storm.sdf(x, z);
  }

  // ------------------------------------------------------------------ the descent
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    const eng = ctx.engine;
    const tw = eng.tweens;
    eng.letterbox(true, 0.6);
    eng.input.enabled = false;
    this.invulnerable = true;
    this.player.invuln = Math.max(this.player.invuln, 14); // the horde does not get a free hit while he descends
    const R0 = this.radius;
    this.radius = -50;
    // above the river, in front of the hunter
    const pp = this.playerPos().clone();
    const spot = this.arenaSpot(pp, Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw)), 50);
    const g = this.baseGround(spot.x, spot.z);
    this.pos.set(spot.x, g + this.hoverH, spot.z);
    this.faceTarget(pp);
    this.lift = this.liftNow = 120;
    this.foldT = this.foldNow = 1;
    this.discT = this.discNow = 2.5;
    this.eyeGlowT = this.eyeGlowNow = 0;
    this.root.visible = false;
    const u = new THREE.Vector3(spot.x - pp.x, 0, spot.z - pp.z).normalize();
    const side = new THREE.Vector3(u.z, 0, -u.x);
    // 1) the light goes out of the sky; the sky splits
    const sky = new THREE.Vector3(spot.x, g + 140, spot.z).addScaledVector(u, 40);
    const camA = pp.clone().addScaledVector(u, -6).addScaledVector(side, 2.4);
    camA.y = Math.max(pp.y, this.ground(camA.x, camA.z)) + 1.4;
    const rift = new Ribbon(36, { core: 0xffffff, edge: 0xffb050, flow: 2 });
    rift.intensity = 0;
    ctx.scene.add(rift.mesh);
    const riftPts: THREE.Vector3[] = [];
    for (let i = 0; i < 36; i++) {
      const k = i / 35 - 0.5;
      riftPts.push(sky.clone().addScaledVector(side, k * 150).add(new THREE.Vector3(0, Math.sin(k * 9) * 6 + (rnd.next() - 0.5) * 5 - k * 18, 0)));
    }
    ctx.sfx('quake_rumble', pp, 1, 0.5);
    ctx.sfx('thunder', null, 0.9, 0.6);
    this.eclT = 0.75; // the light dims before he comes
    for (let t = 0; t < 2.4; t += 1 / 30) {
      const k = t / 2.4;
      cam.setCine({ pos: camA, look: sky.clone().lerp(new THREE.Vector3(spot.x, g + 40, spot.z), 0.2), fov: 62 });
      for (let i = 0; i < 36; i++) rift.points[i].copy(riftPts[i]);
      const open = Math.max(0, (k - 0.3) / 0.7);
      for (let i = 0; i < 36; i++) rift.widths[i] = (0.4 + open * open * 18) * Math.sin((i / 35) * Math.PI) * (0.7 + 0.3 * Math.sin(i * 1.7 + t * 6));
      rift.intensity = Math.min(1.4, k * 2.2);
      rift.update(ctx.camera);
      if (rnd.chance(0.4)) ctx.shake(0.08 + open * 0.2);
      if (open > 0 && rnd.chance(0.6)) {
        const p = riftPts[rnd.int(4, 31)];
        ctx.particles.emit({ pos: p, count: 3, vel: { x: 0, y: -12, z: 0 }, spread: 4, life: [0.8, 1.4], size: [0.6, 0.1], sprite: ['spark', 'glow8'], additive: true, color: [0xffffff, SUN.gold], stretch: 0.05 });
      }
      await this.wait(1 / 30);
    }
    eng.flash(0xfff2d0, 0.5, 0.5);
    ctx.sfx('divine_power', pp, 1, 0.5);
    // 2) the sun falls out of the rift, curled up in its wings
    this.root.visible = true;
    this.yRate = 80;
    const fall = 2.3;
    for (let t = 0; t < fall; t += 1 / 30) {
      const k = t / fall;
      this.liftNow = this.lift = 120 * (1 - k * k);
      this.root.updateMatrixWorld(true);
      const c = this.discWorld(_a);
      const camB = pp.clone().addScaledVector(u, -7).addScaledVector(side, -3);
      camB.y = Math.max(pp.y, this.ground(camB.x, camB.z)) + 2;
      cam.setCine({ pos: camB, look: c.clone().lerp(new THREE.Vector3(spot.x, g + 20, spot.z), 0.35), fov: 58 - k * 8 });
      for (let i = 0; i < 3; i++) ctx.particles.emit({ pos: { x: c.x + (rnd.next() - 0.5) * 12, y: c.y + 6 + rnd.next() * 10, z: c.z + (rnd.next() - 0.5) * 12 }, count: 3, vel: { x: 0, y: 14, z: 0 }, spread: 3, life: [0.6, 1.2], size: [2.2, 0.4], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.2 });
      if (rnd.chance(0.5)) ctx.particles.emit({ pos: { x: c.x, y: c.y + 14, z: c.z }, count: 2, spread: 5, up: 3, life: [1.6, 2.6], size: [4, 9], sprite: ['cloud0', 'cloud1', 'cloud2'], color: SMOKE, alpha: 0.7, drag: 1, rot: 6, rotSpeed: 0.3, jitter: 4 });
      rift.intensity = 1.4 * (1 - k * 0.6);
      rift.update(ctx.camera);
      ctx.shake(0.06 + k * 0.2);
      await this.wait(1 / 30);
    }
    this.liftNow = this.lift = 0;
    this.yRate = 2.2;
    // he stops dead over the river: the heat breaks over the field
    const at = new THREE.Vector3(spot.x, g, spot.z);
    eng.flash(0xffe2b0, 0.6, 0.7);
    eng.hitStop(0.08);
    ctx.shake(1);
    ctx.sfx('explosion_big', at, 1, 0.4);
    this.heatWave(at, 34);
    ctx.enemies.inRadius(at, 38, (e) => ctx.enemies.damage(e, { base: 400, kind: 'magic', source: 'divine', knock: 14, canCrit: false }));
    // 3) he unfolds
    this.foldT = 0;
    this.headUp = 0.25;
    for (const s of [0, 1]) this.aim(s, this.local(s === 0 ? 14 : -14, 20, 4), 1.6, -0.1, -0.3);
    ctx.sfx('whoosh_big', at, 1, 0.5);
    for (let t = 0; t < 1.7; t += 1 / 30) {
      const k = t / 1.7;
      this.root.updateMatrixWorld(true);
      const c = this.discWorld(_a);
      const camC = at.clone().addScaledVector(u, -30).addScaledVector(side, 8);
      camC.y = Math.max(this.ground(camC.x, camC.z) + 2, at.y + 3 + k * 6);
      cam.setCine({ pos: camC, look: c.clone().add(new THREE.Vector3(0, -8 + k * 2, 0)), fov: 64 });
      rift.intensity = Math.max(0, 0.56 - k);
      rift.update(ctx.camera);
      this.eclT = 0.75 * (1 - k);
      await this.wait(1 / 30);
    }
    rift.dispose();
    // 4) the eyes kindle; the roar
    this.root.updateMatrixWorld(true);
    const head = this.socketWorld('mouth', new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const camD = head.clone().addScaledVector(fwd, 13).add(new THREE.Vector3(0, -3.2, 0)).addScaledVector(side, 3);
    this.headUp = -0.1;
    this.eyeGlowT = 1.6;
    ctx.sfx('divine_chime', head, 0.8, 0.6);
    for (let t = 0; t < 0.9; t += 1 / 30) {
      cam.setCine({ pos: camD, look: head.clone().add(new THREE.Vector3(0, 1.2, 0)), fov: 40 - t * 3 });
      await this.wait(1 / 30);
    }
    this.setExpr('enraged');
    this.anim.jaw = 0.4;
    this.discT = 1.4;
    ctx.sfx('boss_roar', this.pos, 1, 0.45);
    ctx.sfx('anubis_roar', head, 0.8, 0.6);
    ctx.shake(0.9);
    this.callout('Sun King');
    this.taunt('I was old when your river was young. Kneel in my light, and burn.', SUNC);
    for (let t = 0; t < 2.4; t += 1 / 30) {
      cam.setCine({ pos: camD.clone().addScaledVector(fwd, t * 0.8), look: head.clone().add(new THREE.Vector3(0, 1.2, 0)), fov: 37 - t });
      this.breathFire(0.6);
      await this.wait(1 / 30);
    }
    this.anim.jaw = 0;
    // the name, planted in the burned ground under him (Cinema casts it)
    const camE = pp.clone().addScaledVector(u, -4).addScaledVector(side, 3.5);
    camE.y = Math.max(pp.y, this.ground(camE.x, camE.z)) + 1.2;
    const look = this.discWorld(new THREE.Vector3()).add(new THREE.Vector3(0, -12, 0));
    cam.setCine({ pos: camE, look, fov: 66 });
    ctx.events.emit('bossIntro', this);
    const word = camE.clone().addScaledVector(_w.copy(look).sub(camE).setY(0).normalize(), 9);
    word.y = this.ground(word.x, word.z);
    Cinema.get()?.stamp('RA', '#ffb347', { at: word, title: true, hold: 2.4 });
    await tw.wait(2.6);
    this.setExpr('angry');
    this.stopArms();
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    eng.input.enabled = true;
    this.invulnerable = false;
    this.radius = R0;
    this.discT = 0.4;
    this.eyeGlowT = 1;
  }

  /** a point to hover over: the river if the world knows it, else open ground in a direction */
  private arenaSpot(from: THREE.Vector3, yaw: number, dist: number) {
    let best = { x: from.x + Math.sin(yaw) * dist, z: from.z + Math.cos(yaw) * dist, s: -1e9 };
    for (let i = 0; i < 14; i++) {
      const a = yaw + (i === 0 ? 0 : (rnd.next() - 0.5) * 2.4);
      const d = dist * (0.85 + rnd.next() * 0.3);
      const x = from.x + Math.sin(a) * d, z = from.z + Math.cos(a) * d;
      const sd = this.storm(x, z);
      const onRiver = riverFlow(this.ctx.world, x, z) ? 8 : 0;
      const s = Math.min(sd, 30) + onRiver - Math.abs(a - yaw) * 3;
      if (s > best.s) best = { x, z, s };
    }
    return best;
  }
  /** a ring of fire and dust rolling out over the ground */
  private heatWave(at: THREE.Vector3, r: number) {
    const ctx = this.ctx;
    for (let k = 0; k < 6; k++)
      ctx.engine.tweens.after(k * 0.08, () => {
        const rr = (r * (k + 1)) / 6;
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + k;
          const x = at.x + Math.cos(a) * rr, z = at.z + Math.sin(a) * rr;
          const y = this.ground(x, z);
          ctx.particles.emit({ pos: { x, y: y + 0.4, z }, count: 2, vel: { x: Math.cos(a) * 9, y: 2.5, z: Math.sin(a) * 9 }, spread: 1.5, life: [0.4, 0.8], size: [1.2, 0.2], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
          if (i % 3 === 0) ctx.particles.emit({ pos: { x, y: y + 0.6, z }, count: 1, vel: { x: Math.cos(a) * 5, y: 1.5, z: Math.sin(a) * 5 }, spread: 1, life: [1.0, 1.8], size: [1.5, 4], sprite: ['cloud0', 'cloud1'], color: SMOKE, alpha: 0.6, drag: 1.5, rot: 6, rotSpeed: 0.4 });
        }
      });
    ctx.fx.light({ x: at.x, y: at.y + 6, z: at.z }, 0xffa040, 40, 0.8, r * 1.5);
  }
  /** fire pouring out of the beak */
  private breathFire(k: number) {
    const m = this.socketWorld('mouth', _b);
    const f = _w.set(Math.sin(this.yaw), 0.35, Math.cos(this.yaw)).normalize();
    this.ctx.particles.emit({ pos: { x: m.x, y: m.y, z: m.z }, count: Math.round(5 * k), vel: { x: f.x * 14, y: f.y * 14, z: f.z * 14 }, spread: 3, life: [0.4, 0.8], size: [1.4, 0.3], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.4, gravity: -3 });
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    while (true) {
      this.check();
      if (!this.novaDone && this.phase >= 2 && this.frac < 0.14) {
        await this.liveAndLetDie();
        continue;
      }
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      const p = this.phase, r = rnd.next(), d = Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
      let pick: string;
      if (d > 74 || d < 26) pick = 'drift';
      else if (p === 0) pick = r < 0.36 ? 'hereComesTheSun' : r < 0.66 ? 'shineALight' : r < 0.88 ? 'jumpinJackFlash' : 'drift';
      else if (p === 1) pick = r < 0.22 ? 'hereComesTheSun' : r < 0.42 ? 'shineALight' : r < 0.56 ? 'jumpinJackFlash' : r < 0.74 && this.cds.wind <= 0 ? 'longWindingRoad' : r < 0.9 && this.cds.rain <= 0 ? 'novemberRain' : 'hereComesTheSun';
      else pick = this.cds.eclipse <= 0 && r < 0.35 ? 'paintItBlack' : r < 0.5 ? 'shineALight' : r < 0.64 ? 'hereComesTheSun' : r < 0.76 && this.cds.rain <= 0 ? 'novemberRain' : r < 0.88 && this.cds.wind <= 0 ? 'longWindingRoad' : 'jumpinJackFlash';
      if (pick === this.lastAttack && pick !== 'drift') pick = pick === 'shineALight' ? 'hereComesTheSun' : 'shineALight';
      await this.run(pick);
      if (rnd.chance(0.35) && pick !== 'drift') await this.drift();
      await this.wait(p >= 2 ? 0.55 : 0.9);
    }
  }
  private async run(name: string) {
    this.lastAttack = name;
    switch (name) {
      case 'hereComesTheSun':
        return this.hereComesTheSun();
      case 'shineALight':
        return this.shineALight();
      case 'jumpinJackFlash':
        return this.jumpinJackFlash();
      case 'longWindingRoad':
        return this.longWindingRoad();
      case 'novemberRain':
        return this.novemberRain(false);
      case 'paintItBlack':
        return this.paintItBlack();
      case 'liveAndLetDie':
        return this.liveAndLetDie();
      default:
        return this.drift();
    }
  }
  /** dev/test: queue an attack (hereComesTheSun, shineALight, jumpinJackFlash, longWindingRoad, novemberRain, paintItBlack, liveAndLetDie, drift) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  /** glide to a new place over the river, a few great wingbeats */
  private async drift() {
    const pp = this.playerPos();
    const cur = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z);
    const spot = this.arenaSpot(pp, cur + rnd.sign() * (0.4 + rnd.next() * 0.6), 46 + rnd.next() * 8);
    this.glideTo = new THREE.Vector3(spot.x, 0, spot.z);
    this.glideSpeed = 9;
    this.beat = 1;
    this.ctx.sfx('whoosh_big', this.pos, 0.8, 0.5);
    const t0 = this.t;
    while (this.glideTo && this.t - t0 < 4) {
      await this.wait(0.1);
      if (Math.hypot(this.pos.x - spot.x, this.pos.z - spot.z) < 2) break;
    }
    this.glideTo = null;
    this.beat = 0;
  }

  // ------------------------------------------------------------------ Here Comes the Sun: flare globs that burst into rings
  private async hereComesTheSun() {
    this.callout('Here Comes the Sun');
    if (rnd.chance(0.5)) this.say(['Here I come.', 'Look up, little thing. Look at me.', 'Every dawn was mine.']);
    this.headUp = 0.35;
    for (const s of [0, 1]) this.aim(s, this.local(s === 0 ? 7 : -7, 30, 4), 2.4, -0.2, -0.6);
    this.discT = 1.6;
    this.ctx.sfx('divine_power', this.pos, 0.9, 0.8);
    await this.wait(0.8);
    const n = 3 + this.phase + (rnd.chance(0.4) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.check();
      const from = this.discWorld(new THREE.Vector3());
      const base = this.predicted(1.6);
      const a = rnd.next() * Math.PI * 2, r = i === 0 ? 0 : 3 + rnd.next() * 7;
      const tx = base.x + Math.cos(a) * r, tz = base.z + Math.sin(a) * r;
      const ty = this.ground(tx, tz);
      const T = 1.6 + rnd.next() * 0.35, g = 16;
      const tgt = new THREE.Vector3(tx, ty, tz);
      this.warnRing(tgt, 3.2, T);
      this.shots.spawn({ kind: 'glob', x: from.x, y: from.y, z: from.z, vx: (tx - from.x) / T, vy: (ty - from.y) / T + 0.5 * g * T, vz: (tz - from.z) / T, grav: g, dmg: 24, r: 1.0, size: 1.5, life: T + 2, onLand: (s) => this.flareBurst(s.x, s.z) });
      this.ctx.sfx('whoosh', from, 0.7, 0.7);
      this.ctx.particles.emit({ pos: from, count: 10, spread: 6, life: [0.3, 0.6], size: [1.2, 0.2], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
      await this.wait(0.32);
    }
    this.discT = 0.5;
    await this.wait(1.2);
    this.stopArms();
  }
  private flareBurst(x: number, z: number) {
    if (this.dead) return;
    const ctx = this.ctx;
    const y = this.ground(x, z);
    ctx.fx.explosion({ x, y: y + 0.6, z }, 2.4);
    ctx.sfx('explosion', { x, y, z }, 0.8, 0.9);
    ctx.events.emit('groundMark', x, z, 2.4, 1);
    const pl = this.player;
    if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 2.8 && pl.pos.y < y + 2.5) pl.takeHit({ base: 22, kind: 'magic', source: 'contact', knock: 9, status: [{ id: 'burn', stacks: 2, dur: 3 }] }, new THREE.Vector3(x, y, z));
    const n = 16 + this.phase * 4;
    const sp = 8.5 + this.phase * 1.2;
    const ph = rnd.next() * Math.PI * 2;
    this.shots.ring(x, z, n, sp, 13 + this.phase * 2, { phase: ph, gap: 2 });
    if (this.phase >= 1) ctx.engine.tweens.after(0.38, () => !this.dead && this.shots.ring(x, z, n, sp * 0.72, 13, { phase: ph + Math.PI / n, gap: 2 }));
    this.fires.push({ x, z, r: 2.4, t: 0, dur: 3.5, dps: 12 });
  }
  /** a pulsing warning ring where something is coming down */
  private warnRing(at: THREE.Vector3, r: number, dur: number) {
    const steps = Math.max(1, Math.round(dur / 0.3));
    for (let i = 0; i < steps; i++)
      this.ctx.engine.tweens.after(i * 0.3, () => {
        if (this.dead) return;
        const y = this.ground(at.x, at.z) + 0.2;
        this.ctx.fx.ring({ x: at.x, y, z: at.z }, i >= steps - 2 ? 0xffe080 : 0xff6a2a, r * 2, 0.32);
      });
  }

  // ------------------------------------------------------------------ Shine a Light: twin eye beams sweep the ground and melt it
  private async shineALight() {
    this.callout('Shine a Light');
    if (rnd.chance(0.5)) this.say(['Stand in my light.', 'Nothing hides from the eye of Ra.', 'I see you. I always see you.']);
    const sweeps = this.phase >= 2 ? 2 : 1;
    for (let k = 0; k < sweeps; k++) {
      this.check();
      const pp = this.predicted(1.0);
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
      const fx = dx / dl, fz = dz / dl;
      // across his line of sight through you, or (phase 2+) a stroke along it
      const along = this.phase >= 1 && rnd.chance(0.35);
      const ux = along ? fx : -fz, uz = along ? fz : fx;
      const half = 15 + this.phase * 3;
      const sgn = rnd.sign();
      const a = new THREE.Vector3(pp.x - ux * half * sgn, 0, pp.z - uz * half * sgn);
      const b = new THREE.Vector3(pp.x + ux * half * sgn, 0, pp.z + uz * half * sgn);
      a.y = this.ground(a.x, a.z);
      b.y = this.ground(b.x, b.z);
      const T = 2.3 - this.phase * 0.2;
      const sw: Sweep = { a, b, t: 0, T, warn: 1.15, hitCd: 0, melt: 0, last: a.clone(), p: a.clone() };
      this.sweeps.push(sw);
      this.bendT = 0.12;
      this.eyeGlowT = 2.4;
      this.anim.jaw = 0.12;
      this.ctx.sfx('divine_power', this.pos, 1, 1.3);
      await this.wait(sw.warn + T + 0.2);
      this.eyeGlowT = 1;
    }
    this.stopArms();
  }
  private updateSweeps(dt: number) {
    const ctx = this.ctx;
    let beamOn = false;
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const s = this.sweeps[i];
      s.t += dt;
      if (s.t < s.warn) {
        // the warning: a smouldering line traced over the ground, pulsing hotter
        const k = s.t / s.warn;
        const pts = this.warnLine.points;
        for (let j = 0; j < pts.length; j++) {
          const f = j / (pts.length - 1);
          pts[j].lerpVectors(s.a, s.b, f);
          pts[j].y = this.ground(pts[j].x, pts[j].z) + 0.25;
          this.warnLine.widths[j] = 0.5 + 0.4 * Math.sin(f * 30 - s.t * 12) ** 2;
        }
        this.warnLine.intensity = 0.25 + 0.35 * Math.abs(Math.sin(s.t * 9)) * k;
        if (rnd.chance(0.5)) {
          const f = rnd.next();
          const x = s.a.x + (s.b.x - s.a.x) * f, z = s.a.z + (s.b.z - s.a.z) * f;
          ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.2, z }, count: 2, spread: 0.8, up: 2, life: [0.3, 0.6], size: [0.35, 0.05], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
        }
        // the eyes charge
        for (const e of ['gaze_l', 'gaze_r']) {
          const p = this.socketWorld(e, _a);
          if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 2, spread: 3, life: [0.15, 0.3], size: [0.5, 0.05], sprite: ['spark', 'glow8'], additive: true, color: [0xffffff, SUN.gold], drag: 6 });
        }
        continue;
      }
      this.warnLine.intensity = 0;
      const k = Math.min(1, (s.t - s.warn) / s.T);
      const e = k * k * (3 - 2 * k);
      s.p.lerpVectors(s.a, s.b, e);
      s.p.y = this.ground(s.p.x, s.p.z);
      beamOn = true;
      // the twin beams converge on the point
      const sideX = -(s.b.z - s.a.z), sideZ = s.b.x - s.a.x, sl = Math.hypot(sideX, sideZ) || 1;
      for (let j = 0; j < 2; j++) {
        const eye = this.socketWorld(j === 0 ? 'gaze_l' : 'gaze_r', _a);
        const hit = _b.set(s.p.x + (sideX / sl) * (j === 0 ? 0.55 : -0.55), s.p.y + 0.2, s.p.z + (sideZ / sl) * (j === 0 ? 0.55 : -0.55));
        this.beams[j].beam(eye, hit, 0.7, 2.1, 0.2, this.t);
        this.beams[j].intensity = Math.min(1, (s.t - s.warn) * 6) * (k > 0.96 ? (1 - k) * 25 : 1);
        this.beams[j].update(ctx.camera);
        // hit test along the beam
        const pc = this.player.center(_w);
        if (s.hitCd <= 0 && this.player.alive && (segDist(pc, eye, hit) < 1.25 || (Math.hypot(pc.x - hit.x, pc.z - hit.z) < 2.3 && pc.y < s.p.y + 3))) {
          s.hitCd = 0.6;
          this.player.takeHit({ base: 30 + this.phase * 6, kind: 'magic', source: 'contact', knock: 11, status: [{ id: 'burn', stacks: 3, dur: 3 }] }, hit.clone());
        }
      }
      s.hitCd -= dt;
      // the ground melts: a burning trench behind the point
      s.melt -= dt;
      if (s.melt <= 0) {
        s.melt = 0.14;
        ctx.world.deform(s.p.x, s.p.z, 1.7, 0.32);
        ctx.events.emit('groundMark', s.p.x, s.p.z, 2.0, 1);
        if (s.p.distanceTo(s.last) > 1.4) {
          this.fires.push({ x: s.p.x, z: s.p.z, r: 1.7, t: 0, dur: 3.6, dps: 15 });
          s.last.copy(s.p);
        }
      }
      ctx.particles.emit({ pos: { x: s.p.x, y: s.p.y + 0.3, z: s.p.z }, count: 4, spread: 4, up: 5, life: [0.3, 0.7], size: [1.0, 0.15], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
      ctx.particles.emit({ pos: { x: s.p.x, y: s.p.y + 0.3, z: s.p.z }, count: 3, spread: 6, up: 6, life: [0.5, 1.0], size: [0.12, 0.06], sprite: ['dot3', 'spark'], color: [MOLTEN_DROP, 0xffd060], additive: true, gravity: 16, ground: true, bounce: 0.2 });
      if (rnd.chance(0.3)) ctx.particles.emit({ pos: { x: s.p.x, y: s.p.y + 1, z: s.p.z }, count: 1, spread: 1.5, up: 2.5, life: [1.2, 2.0], size: [1.5, 3.5], sprite: ['cloud0', 'cloud1'], color: SMOKE, alpha: 0.6, drag: 1.4, rot: 6, rotSpeed: 0.4 });
      if (rnd.chance(dt * 6)) ctx.sfx('sand_spray', s.p, 0.7, 0.6);
      ctx.fx.light({ x: s.p.x, y: s.p.y + 2, z: s.p.z }, 0xffb050, 14, 0.12, 16);
      if (rnd.chance(0.5)) ctx.shake(0.06);
      if (k >= 1) this.sweeps.splice(i, 1);
    }
    if (!beamOn) for (const b of this.beams) b.intensity = 0;
    if (!this.sweeps.length) this.warnLine.intensity = 0;
    else if (this.warnLine.intensity > 0) this.warnLine.update(ctx.camera);
  }

  // ------------------------------------------------------------------ Jumpin' Jack Flash: fire falcons peel off his wings and dive
  private async jumpinJackFlash() {
    this.callout("Jumpin' Jack Flash");
    if (rnd.chance(0.5)) this.say(['Fly, my children. Bring me its eyes.', 'My falcons are hungry.', 'Feathers of fire, find it.']);
    const n = Math.min(6, 3 + this.phase + (rnd.chance(0.4) ? 1 : 0));
    this.beat = 1.4;
    this.bendT = -0.08;
    const G = raGeos();
    for (let i = 0; i < n; i++) {
      this.check();
      const sock = ['wingtip_l', 'wingtip_r', 'wingmid_l', 'wingmid_r'][i % 4];
      const p = this.socketWorld(sock, new THREE.Vector3());
      const rig = new RigInstance(G.falcon, { material: this.body, castShadow: false });
      rig.root.scale.setScalar(1.25);
      this.ctx.scene.add(rig.root);
      const out = new THREE.Vector3(p.x - this.pos.x, 0, p.z - this.pos.z).normalize();
      this.falcons.push({ rig, pos: p.clone(), vel: new THREE.Vector3(out.x * 10, 9, out.z * 10), state: 'rise', t: 0, hp: 70 + this.phase * 20, ang: Math.atan2(p.z - this.player.pos.z, p.x - this.player.pos.x), wait: 0.8 + i * 0.55, target: new THREE.Vector3(), flap: rnd.next() * 6, yaw: 0, pitch: 0, marked: false });
      this.ctx.particles.emit({ pos: p, count: 16, spread: 6, life: [0.3, 0.7], size: [1.0, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
      this.ctx.sfx('vulture_screech', p, 0.7, 1.35 + rnd.next() * 0.2);
      await this.wait(0.2);
    }
    this.beat = 0;
    const t0 = this.t;
    while (this.falcons.length && this.t - t0 < 7) await this.wait(0.2);
    this.stopArms();
  }
  private updateFalcons(dt: number) {
    const pl = this.player;
    const pp = pl.pos;
    for (let i = this.falcons.length - 1; i >= 0; i--) {
      const f = this.falcons[i];
      f.t += dt;
      const n = f.rig.nodes;
      let flapK = 1, tuck = 0;
      if (f.state === 'rise') {
        f.vel.y = damp(f.vel.y, 2, 1.5, dt);
        if (f.t > 0.8) {
          f.state = 'circle';
          f.t = 0;
        }
      } else if (f.state === 'circle') {
        f.ang += dt * 1.5;
        const R = 15, H = this.ground(pp.x, pp.z) + 13;
        const tx = pp.x + Math.cos(f.ang) * R, tz = pp.z + Math.sin(f.ang) * R;
        // fly to the orbit, never faster than a stooping falcon
        let vx = (tx - f.pos.x) * 2.2, vy = (H - f.pos.y) * 2, vz = (tz - f.pos.z) * 2.2;
        const vl = Math.hypot(vx, vy, vz), cap = 26 / Math.max(26, vl);
        vx *= cap;
        vy *= cap;
        vz *= cap;
        f.vel.x = damp(f.vel.x, vx, 3, dt);
        f.vel.z = damp(f.vel.z, vz, 3, dt);
        f.vel.y = damp(f.vel.y, vy, 3, dt);
        if (f.t > f.wait) {
          f.state = 'dive';
          f.t = 0;
          f.target.copy(this.predicted(0.75));
          f.target.y = this.ground(f.target.x, f.target.z) + 0.8;
          this.warnRing(f.target, 1.8, 0.6);
          this.ctx.sfx('vulture_screech', f.pos, 0.8, 1.5);
        }
      } else {
        // the stoop: wings tucked, straight at the mark
        tuck = Math.min(1, f.t * 3);
        flapK = 0.15;
        const d = _v.copy(f.target).sub(f.pos);
        const L = d.length() || 1;
        const sp = 32;
        f.vel.lerp(d.multiplyScalar(sp / L), Math.min(1, dt * 6));
        const hitP = Math.hypot(pp.x - f.pos.x, pp.z - f.pos.z) < 1.7 && Math.abs(pp.y + 0.9 - f.pos.y) < 1.8;
        if (hitP || L < 1.2 || f.pos.y < this.ground(f.pos.x, f.pos.z) + 0.3 || f.t > 2.5) {
          if (hitP && pl.alive) pl.takeHit({ base: 24 + this.phase * 4, kind: 'magic', source: 'contact', knock: 10, status: [{ id: 'burn', stacks: 2, dur: 3 }] }, f.pos.clone());
          this.falconBurst(f, true);
          this.falcons.splice(i, 1);
          continue;
        }
      }
      f.pos.addScaledVector(f.vel, dt);
      // face the flight, bank into turns
      const hs = Math.hypot(f.vel.x, f.vel.z);
      f.yaw = dampAngle(f.yaw, Math.atan2(f.vel.x, f.vel.z), 6, dt);
      f.pitch = damp(f.pitch, -Math.atan2(f.vel.y, Math.max(0.1, hs)), 6, dt);
      f.rig.root.position.copy(f.pos);
      f.rig.root.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
      f.flap += dt * (10 + (1 - tuck) * 4);
      const s = Math.sin(f.flap) * 0.85 * flapK;
      if (n['wing_l']) {
        n['wing_l'].rotation.set(0, tuck * 0.9, s - tuck * 0.2);
        n['wing_r'].rotation.set(0, -tuck * 0.9, -s + tuck * 0.2);
        n['wtip_l'].rotation.set(0, tuck * 0.8, Math.sin(f.flap - 0.7) * 0.4 * flapK);
        n['wtip_r'].rotation.set(0, -tuck * 0.8, -Math.sin(f.flap - 0.7) * 0.4 * flapK);
      }
      if (n['tail']) n['tail'].rotation.x = Math.sin(f.flap * 0.5) * 0.1;
      if (n['head']) n['head'].rotation.set(f.pitch * -0.5, 0, 0);
      // its trail of flame
      if (rnd.chance(0.8)) this.ctx.particles.emit({ pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z }, count: 2, vel: { x: -f.vel.x * 0.15, y: 0.6, z: -f.vel.z * 0.15 }, spread: 1, life: [0.25, 0.55], size: [0.9, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
    }
  }
  private falconBurst(f: Falcon, explode: boolean) {
    const ctx = this.ctx;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    ctx.particles.emit({ pos: p, count: 24, spread: 8, up: 3, life: [0.3, 0.8], size: [1.0, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
    ctx.particles.emit({ pos: p, count: 10, spread: 5, up: 4, life: [0.8, 1.4], size: [0.16, 0.1], sprite: 'feather', color: [0xffd070, 0xff9a3a], gravity: 3, drag: 2, rot: 6, rotSpeed: 4 });
    if (explode) {
      const g = this.ground(p.x, p.z);
      if (p.y < g + 3) {
        ctx.fx.explosion({ x: p.x, y: g + 0.5, z: p.z }, 2);
        ctx.events.emit('groundMark', p.x, p.z, 1.8, 1);
        if (this.phase >= 1) this.shots.ring(p.x, p.z, 8 + this.phase * 2, 7.5, 11, { gap: 1 });
      }
      ctx.sfx('explosion', p, 0.6, 1.2);
    } else ctx.sfx('divine_chime', p, 0.5, 1.4);
    f.rig.root.removeFromParent();
  }

  // ------------------------------------------------------------------ The Long and Winding Road: a solar wind down the river
  private async longWindingRoad() {
    this.callout('The Long and Winding Road');
    this.cds.wind = 18;
    if (rnd.chance(0.6)) this.say(['Ride my wind, then. All the way to the end.', 'The road is long. The sun is longer.', 'Go where I blow you.']);
    const pp = this.playerPos();
    const rf = riverFlow(this.ctx.world, pp.x, pp.z);
    const tx = pp.x - this.pos.x, tz = pp.z - this.pos.z, tl = Math.hypot(tx, tz) || 1;
    // down the river if there is one; else across his face, so it carries you past him
    const s = rnd.sign();
    const dir = rf ? new THREE.Vector3(rf.x, 0, rf.z) : new THREE.Vector3((-tz / tl) * s, 0, (tx / tl) * s);
    this.wind.dir.copy(dir);
    this.lift = 4;
    this.foldT = -0.25; // wings swept wide forward
    this.beat = 2.2;
    this.ctx.sfx('wind_loop', pp, 1, 0.7);
    this.ctx.sfx('whoosh_big', this.pos, 1, 0.45);
    this.anim.jaw = 0.25;
    await this.wait(0.8);
    const dur = 6 + this.phase;
    this.wind.on = 1;
    this.wind.t = 0;
    this.wind.accel = 9 + this.phase * 2;
    this.shots.wind.copy(dir).multiplyScalar(15);
    let lane = 0;
    for (let t = 0; t < dur; t += 0.1) {
      this.check();
      lane -= 0.1;
      if (lane <= 0) {
        lane = 0.75 - this.phase * 0.08;
        // a wall of wind-borne orbs upwind, with a gap to slip through
        const p = this.playerPos();
        const up = 26;
        const cx = p.x - dir.x * up, cz = p.z - dir.z * up;
        const px = -dir.z, pz = dir.x;
        const gap = (rnd.next() - 0.5) * 16;
        for (let l = -16; l <= 16; l += 1.6) {
          if (Math.abs(l - gap) < 2.8) continue;
          const x = cx + px * l, z = cz + pz * l;
          if (this.storm(x, z) < 1) continue;
          this.shots.spawn({ x, y: this.ground(x, z) + 1.1, z, vx: dir.x * 15, vz: dir.z * 15, dmg: 12, hug: 1.1, wind: true, size: 0.5, life: 4.5 });
        }
      }
      await this.wait(0.1);
    }
    this.wind.on = 0;
    this.lift = 0;
    this.foldT = 0;
    this.beat = 0;
    this.anim.jaw = 0;
    this.stopArms();
  }
  private updateWind(dt: number) {
    const W = this.wind;
    const k = W.on ? Math.min(1, (W.t += dt) / 0.6) : 0;
    if (!W.on && W.t > 0) W.t = Math.max(0, W.t - dt * 2);
    if (k <= 0) return;
    const pl = this.player;
    if (pl.alive) {
      const v = pl.board.vel;
      const a = W.accel * k * (pl.board.grounded ? 1 : 0.6);
      v.x += W.dir.x * a * dt;
      v.z += W.dir.z * a * dt;
    }
    // the wind made visible: embers and heat streaming past
    const ctx = this.ctx;
    const pp = pl.pos;
    for (let i = 0; i < 4; i++) {
      const x = pp.x - W.dir.x * 22 + (rnd.next() - 0.5) * 36, z = pp.z - W.dir.z * 22 + (rnd.next() - 0.5) * 36;
      const y = this.ground(x, z) + 0.5 + rnd.next() * 5;
      ctx.particles.emit({ pos: { x, y, z }, count: 1, vel: { x: W.dir.x * 26, y: 0.5, z: W.dir.z * 26 }, spread: 1.5, life: [0.8, 1.4], size: [0.45, 0.08], sprite: i % 2 ? 'spark' : EMBERS, additive: true, color: FIRE_COLS, stretch: 0.04, drag: 0.2 });
    }
    if (rnd.chance(0.3)) ctx.particles.emit({ pos: { x: pp.x - W.dir.x * 18 + (rnd.next() - 0.5) * 24, y: pp.y + 1, z: pp.z - W.dir.z * 18 + (rnd.next() - 0.5) * 24 }, count: 1, vel: { x: W.dir.x * 18, y: 0.4, z: W.dir.z * 18 }, spread: 2, life: [1.0, 1.6], size: [2, 4.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: SMOKE, alpha: 0.4, drag: 0.4, rot: 6, rotSpeed: 0.3 });
  }

  // ------------------------------------------------------------------ November Rain: sunfire meteors
  private async novemberRain(cover: boolean) {
    if (!cover) {
      this.callout('November Rain');
      this.cds.rain = 14;
      if (rnd.chance(0.5)) this.say(['The sky is mine to drop.', 'Rain, and burn.', 'I throw stars, little thing.']);
    }
    const s = rnd.chance(0.5) ? 0 : 1;
    this.aim(s, this.local(s === 0 ? 6 : -6, 33, 2), 3, 1.2, 0.3);
    this.headUp = 0.4;
    this.discT = 1.8;
    this.ctx.sfx('thunder', null, 0.7, 0.8);
    await this.wait(0.7);
    this.ctx.engine.flash(0xffd8a0, 0.25, 0.35);
    const G = raGeos();
    const n = cover ? 4 : 6 + this.phase * 2;
    const pp = this.playerPos().clone();
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      this.check();
      let tx: number, tz: number;
      if (cover) {
        // a loose ring round the hunter: cover in every direction from his disc
        const a = a0 + (i / n) * Math.PI * 2 + (rnd.next() - 0.5) * 0.4, r = 9 + rnd.next() * 5;
        tx = pp.x + Math.cos(a) * r;
        tz = pp.z + Math.sin(a) * r;
      } else {
        const p = this.predicted(1.5);
        const a = rnd.next() * Math.PI * 2, r = i === 0 ? 0 : 3 + rnd.next() * 11;
        tx = p.x + Math.cos(a) * r;
        tz = p.z + Math.sin(a) * r;
      }
      if (this.storm(tx, tz) < 3) continue;
      const to = new THREE.Vector3(tx, this.ground(tx, tz), tz);
      const sideA = this.yaw + Math.PI / 2 * (rnd.chance(0.5) ? 1 : -1);
      const from = to.clone().add(new THREE.Vector3(Math.sin(sideA) * 26 - Math.sin(this.yaw) * 20, 78, Math.cos(sideA) * 26 - Math.cos(this.yaw) * 20));
      const mesh = new THREE.Mesh(G.meteors[i % 3], this.body);
      mesh.position.copy(from);
      mesh.scale.setScalar(cover ? 1.2 : 1);
      this.ctx.scene.add(mesh);
      const T = 1.55 + rnd.next() * 0.3;
      this.meteors.push({ mesh, from, to, t: 0, T, spire: cover ? i : -1, dmg: 34 + this.phase * 4, ring: cover ? 0 : 10 + this.phase * 2, spin: new THREE.Vector3(rnd.next() * 3, rnd.next() * 3, rnd.next() * 3) });
      this.warnRing(to, 4.2, T);
      await this.wait(cover ? 0.15 : 0.32);
    }
    this.discT = 0.5;
    await this.wait(cover ? 1.9 : 1.2);
    this.stopArms();
  }
  private updateMeteors(dt: number) {
    const ctx = this.ctx;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.T);
      m.mesh.position.lerpVectors(m.from, m.to, k * k * 0.25 + k * 0.75);
      m.mesh.rotation.x += m.spin.x * dt;
      m.mesh.rotation.y += m.spin.y * dt;
      const p = m.mesh.position;
      ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 4, spread: 2.5, up: 1, life: [0.3, 0.6], size: [2.2, 0.3], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.5 });
      if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: p.x, y: p.y + 1, z: p.z }, count: 1, spread: 1, life: [1.4, 2.4], size: [2, 5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: SMOKE, alpha: 0.75, drag: 1, rot: 6, rotSpeed: 0.3, jitter: 0.8 });
      if (k < 1) continue;
      // impact
      const at = m.to;
      const pt = { x: at.x, y: at.y + 0.8, z: at.z };
      ctx.fx.explosion(pt, 3.8);
      ctx.sfx('explosion_big', pt, 0.9, 0.75);
      ctx.shake(0.45);
      ctx.world.deform(at.x, at.z, 3.2, 0.8);
      ctx.events.emit('groundMark', at.x, at.z, 4, 1);
      ctx.particles.emit({ pos: pt, count: 22, spread: 10, up: 9, life: [0.8, 1.5], size: [0.3, 0.2], sprite: 'pebble', color: [0x2c2636, 0x4a4258, 0xffa040], gravity: 16, ground: true, bounce: 0.3, rot: 6, rotSpeed: 8 });
      const pl = this.player;
      if (Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < 4.6 && pl.pos.y < at.y + 3.5) pl.takeHit({ base: m.dmg, kind: 'magic', source: 'contact', knock: 15, status: [{ id: 'burn', stacks: 3, dur: 3 }] }, at.clone());
      if (m.ring) this.shots.ring(at.x, at.z, m.ring, 8, 12, { gap: 2 });
      if (m.spire >= 0) this.raiseSpire(at.x, at.z, m.spire);
      else this.fires.push({ x: at.x, z: at.z, r: 3, t: 0, dur: 4, dps: 14 });
      m.mesh.removeFromParent();
      this.meteors.splice(i, 1);
    }
  }
  private raiseSpire(x: number, z: number, seed: number) {
    const G = raGeos();
    const mesh = new THREE.Mesh(G.spires[seed % G.spires.length], this.body);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.y = rnd.next() * Math.PI * 2;
    const y = this.ground(x, z);
    mesh.position.set(x, y - 6, z);
    this.ctx.scene.add(mesh);
    mesh.geometry.computeBoundingBox();
    const h = mesh.geometry.boundingBox!.max.y;
    this.spires.push({ mesh, x, z, y, h, r: 1.25, t: 0, life: 22 });
    this.ctx.sfx('rock_crumble', { x, y, z }, 0.9, 0.7);
  }
  private updateSpires(dt: number) {
    for (let i = this.spires.length - 1; i >= 0; i--) {
      const s = this.spires[i];
      s.t += dt;
      const rise = Math.min(1, s.t / 0.35);
      const sink = s.t > s.life ? Math.min(1, (s.t - s.life) / 2.5) : 0;
      s.mesh.position.y = s.y - 6 * (1 - rise * rise) - s.h * sink * 1.1;
      if (sink > 0 && rnd.chance(0.3)) this.ctx.particles.emit({ pos: { x: s.x, y: s.y + 0.4, z: s.z }, count: 2, spread: 2, up: 2, life: [0.4, 0.8], size: [0.8, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2 });
      if (sink >= 1) {
        s.mesh.removeFromParent();
        this.spires.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ Paint It Black: the eclipse
  private async paintItBlack() {
    this.callout('Paint It Black');
    this.cds.eclipse = 34;
    this.say(['Hide, then. Find the dark, if there is any left.', 'I will put out my own light to find you.', 'Even my shadow is a gift.']);
    // the meteors that fall first cool into obsidian: the only shade on the field
    await this.novemberRain(true);
    const G = raGeos();
    if (!this.moon) {
      this.moon = new THREE.Mesh(G.moon, this.body);
      this.moon.castShadow = false;
      this.rig.nodes['disc']?.add(this.moon);
    }
    this.moon.visible = true;
    this.moonT = 1;
    this.ctx.sfx('time_slow', null, 0.8, 0.6);
    this.ctx.sfx('night_loop', null, 0.5, 0.8);
    this.eclT = 1;
    this.eyeGlowT = 2.2;
    this.eyeSpheres.forEach((s) => (s.weak = 3.2));
    await this.wait(2.4);
    this.ctx.toast('FIND HIS SHADOW', '#ffe6b0', 'Hide behind the obsidian from his disc');
    const pulses = 3 + (this.phase >= 2 && this.frac < 0.22 ? 1 : 0);
    for (let i = 0; i < pulses; i++) {
      this.check();
      // telegraph: the corona swells, the light gathers (shadows sharpen)
      this.ctx.sfx('divine_power', this.pos, 1, 0.6 + i * 0.1);
      this.novaT = 0.18;
      for (let t = 0; t < 1.6; t += 0.1) {
        this.coronaBurst(0.4 + t * 0.5);
        await this.wait(0.1);
      }
      // the flash
      this.ctx.engine.flash(0xfff4e0, 0.8, 0.55);
      this.ctx.shake(0.5);
      this.ctx.sfx('explosion_big', this.player.pos, 0.6, 1.6);
      this.coronaBurst(3);
      if (this.player.alive) {
        if (this.shaded()) {
          this.ctx.toast(rnd.pick(['IN HIS SHADOW', 'SHADED', 'THE DARK HOLDS']), '#ffe6b0');
        } else {
          this.player.takeHit({ base: this.player.maxHp * 0.3, kind: 'magic', source: 'contact', knock: 6, status: [{ id: 'burn', stacks: 4, dur: 4 }] }, this.discWorld(new THREE.Vector3()));
        }
      }
      this.novaT = 0;
      // he drifts: the shadows swing
      const pp = this.playerPos();
      const cur = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z) + rnd.sign() * 0.5;
      const sp = this.arenaSpot(pp, cur, 48);
      this.glideTo = new THREE.Vector3(sp.x, 0, sp.z);
      this.glideSpeed = 8;
      await this.wait(1.6);
      this.glideTo = null;
    }
    this.moonT = 0;
    this.eclT = 0;
    this.eyeGlowT = 1;
    this.eyeSpheres.forEach((s) => (s.weak = 2.4));
    await this.wait(1.2);
    if (this.moon) this.moon.visible = this.moonK > 0.02;
  }
  /** is the hunter out of sight of the disc? (obsidian spires, props, the ground; never his own body) */
  private shaded() {
    const pc = this.player.center(new THREE.Vector3());
    pc.y += 0.3;
    const disc = this.discWorld(new THREE.Vector3());
    const d = disc.clone().sub(pc);
    const L = d.length();
    d.divideScalar(L);
    for (const s of this.spires) {
      // closest approach of the sight line to the spire's axis (in plan)
      const hx = d.x, hz = d.z, hl = hx * hx + hz * hz;
      if (hl < 1e-6) continue;
      const t = clamp(((s.x - pc.x) * hx + (s.z - pc.z) * hz) / hl, 0, L);
      const x = pc.x + hx * t, z = pc.z + hz * t, y = pc.y + d.y * t;
      const top = s.mesh.position.y + s.h;
      const r = s.r * (1 - clamp((y - s.mesh.position.y) / s.h, 0, 1) * 0.7) + 0.35;
      if (y < top && Math.hypot(x - s.x, z - s.z) < r) return true;
    }
    const res = { t: -1, c: null as any, nx: 0, nz: 0 };
    this.ctx.world.colliders.raycast(pc.x, pc.y, pc.z, d.x, d.y, d.z, Math.min(L, 80), res);
    if (res.t >= 0) return true;
    const f = this.ctx.world.field;
    for (let t = 1.5; t < Math.min(L, 90); t += 1.5) if (pc.y + d.y * t < f.heightAt(pc.x + d.x * t, pc.z + d.z * t)) return true;
    return false;
  }
  /** white prominences flaring off the eclipsed disc */
  private coronaBurst(k: number) {
    const c = this.discWorld(_a);
    const n = Math.round(6 * k);
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2;
      const r = 5.4 + rnd.next() * 0.6;
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      const right = _w.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.ctx.particles.emit({ pos: { x: c.x + right.x * ox, y: c.y + oy, z: c.z + right.z * ox }, count: 1, vel: { x: right.x * Math.cos(a) * 6 * k, y: Math.sin(a) * 6 * k, z: right.z * Math.cos(a) * 6 * k }, spread: 1, life: [0.4, 0.9], size: [1.8 * Math.min(2, k), 0.2], sprite: ['glow16', 'flame0', 'flame2'], additive: true, color: [0xffffff, 0xfff0d0, 0xffd080], drag: 1.5 });
    }
  }

  // ------------------------------------------------------------------ Live and Let Die: the supernova
  private async liveAndLetDie() {
    this.novaDone = true;
    this.callout('Live and Let Die');
    this.say(['Then we both burn. Burn with me!', 'If the sun must die, it takes the sky with it.']);
    this.invulnerable = true;
    this.sweeps = [];
    for (const f of this.falcons) this.falconBurst(f, false);
    this.falcons = [];
    this.lift = 12;
    this.foldT = -0.3;
    this.headUp = 0.3;
    for (const s of [0, 1]) this.aim(s, this.local(s === 0 ? 15 : -15, 22, 3), 1.8, -0.2, -0.5);
    this.discT = 3;
    this.coreScaleT = 1.65;
    this.ctx.sfx('time_slow', null, 1, 0.5);
    this.ctx.sfx('divine_power', this.pos, 1, 0.4);
    for (let t = 0; t < 3.2; t += 0.1) {
      this.novaT = Math.min(0.85, t / 3.2);
      this.coronaBurst(1 + t);
      if (rnd.chance(0.5)) this.ctx.shake(0.1 + t * 0.08);
      // the field's fire is pulled up into him
      const pp = this.playerPos();
      const c = this.discWorld(_a);
      for (let i = 0; i < 3; i++) {
        const x = pp.x + (rnd.next() - 0.5) * 40, z = pp.z + (rnd.next() - 0.5) * 40, y = this.ground(x, z) + 0.5;
        const T = 1.2;
        this.ctx.particles.emit({ pos: { x, y, z }, count: 1, vel: { x: (c.x - x) / T, y: (c.y - y) / T, z: (c.z - z) / T }, life: [T * 0.9, T], size: [0.6, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS });
      }
      if (Math.floor(t * 10) % 8 === 0) this.ctx.engine.flash(0xfff0d0, 0.15, 0.2);
      await this.wait(0.1);
    }
    const r = await this.qte({ kind: 'bar', label: 'SHOOT THE HEART OF THE SUN', speed: 1.5, width: 0.17, duration: 4, at: () => this.discWorld(new THREE.Vector3()) });
    const ctx = this.ctx;
    const core = this.discWorld(new THREE.Vector3());
    if (r === 'perfect' || r === 'good') {
      // the shot goes into the heart of the sun: it cracks and the light falls back in
      ctx.fx.bulletTracer(this.player.center(new THREE.Vector3()), core, 0xfff6d0, true, 400);
      ctx.sfx('headshot', core, 1, 0.6);
      ctx.sfx('glass_break', core, 1, 0.5);
      ctx.engine.hitStop(0.12);
      ctx.engine.flash(0xffffff, 0.6, 0.5);
      ctx.shake(0.8);
      ctx.toast(r === 'perfect' ? 'THE HEART OF THE SUN' : 'THE SUN CRACKS', '#fff0c0', r === 'perfect' ? 'Perfect shot' : 'He is spent', true);
      this.novaT = 0;
      this.coreScaleT = 0.8;
      this.invulnerable = false;
      if (r === 'perfect') {
        this.hp = 0;
        this.die();
        return;
      }
      this.hp = Math.min(this.hp, this.maxHp * 0.045);
    } else {
      // supernova
      ctx.engine.flash(0xffffff, 1, 1.2);
      ctx.shake(1.2);
      ctx.sfx('explosion_big', core, 1, 0.3);
      this.heatWave(new THREE.Vector3(this.pos.x, this.ground(this.pos.x, this.pos.z), this.pos.z), 60);
      for (let k = 0; k < 3; k++) ctx.engine.tweens.after(k * 0.3, () => !this.dead && this.shots.ring(this.player.pos.x, this.player.pos.z, 26, 10 + k * 2, 14, { phase: k * 0.4, gap: 3, r0: 22 }));
      if (this.player.alive) this.player.takeHit({ base: this.player.maxHp * 0.4, kind: 'magic', source: 'contact', knock: 20, status: [{ id: 'burn', stacks: 5, dur: 5 }] }, core);
      this.novaT = 0;
      this.coreScaleT = 0.85;
      this.invulnerable = false;
    }
    // spent: he sags, the core bare and weak
    this.setExpr('stunned');
    this.spent = 7;
    this.coreSphere.weak = 4;
    this.lift = -3;
    this.foldT = 0.35;
    this.discT = 0.2;
    this.stopArms();
    this.bendT = 0.35;
    await this.wait(7);
    this.coreSphere.weak = 2;
    this.coreScaleT = 1;
    this.lift = 0;
    this.foldT = 0;
    this.bendT = 0;
    this.setExpr('enraged');
  }

  // ------------------------------------------------------------------ targeting (falcons ride along)
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (this.dead) return null;
    // the moon covers his heart in the eclipse
    const saved = this.coreSphere.r;
    if (this.moonK > 0.5) this.coreSphere.r = 0.01;
    let best = super.hitTest(o, d, maxT);
    this.coreSphere.r = saved;
    let bt = best ? best.t : maxT;
    for (let i = 0; i < this.falcons.length; i++) {
      const f = this.falcons[i];
      const ox = o.x - f.pos.x, oy = o.y - f.pos.y, oz = o.z - f.pos.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - 1.4 * 1.4;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(f.pos).normalize(), headshot: false, part: 'falcon' + i, surface: 'enemy' };
    }
    return best;
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    const tag = hit.tags?.[0];
    if (tag && tag.startsWith('falcon')) {
      // a shot falcon: find the one nearest the point
      let fi = -1, bd = 9;
      for (let i = 0; i < this.falcons.length; i++) {
        const dd = point ? this.falcons[i].pos.distanceTo(point) : i;
        if (dd < bd) {
          bd = dd;
          fi = i;
        }
      }
      if (fi < 0) return 0;
      const f = this.falcons[fi];
      const amt = Math.max(1, hit.base * (hit.mult ?? 1));
      f.hp -= amt;
      this.ctx.fx.number({ x: f.pos.x, y: f.pos.y + 0.6, z: f.pos.z }, Math.round(amt), 0xffd040, 1);
      this.ctx.fx.hit(point ?? f.pos, { x: 0, y: 1, z: 0 }, 'spirit', 0.8);
      if (f.hp <= 0) {
        this.falconBurst(f, false);
        this.falcons.splice(fi, 1);
        this.ctx.toast(rnd.pick(['FALCON DOWN', 'PLUCKED', 'FEATHERS EVERYWHERE']), SUNC);
      }
      return amt;
    }
    return super.takeDamage(hit, point, dir);
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    this.burnT = p >= 2 ? 1 : 0.8;
    this.raU.value.z = p >= 2 ? 1.5 : 1.2;
    this.discT = 2.2;
    this.ctx.engine.tweens.after(1.2, () => (this.discT = 0.5));
    this.say(p >= 2 ? ['Enough. I will burn the sky down to the river stones.', 'You are still here? Then nothing will be left.'] : ['You sting like a gnat in the noon. Feel the noon, then.', 'The desert burned for less.']);
    // the burn spreads under him
    this.heatWave(new THREE.Vector3(this.pos.x, this.ground(this.pos.x, this.pos.z), this.pos.z), 28);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    if (this.gone || (!this.root.visible && !this.alive && !this.corpse)) return;
    for (const k of Object.keys(this.cds) as (keyof typeof this.cds)[]) this.cds[k] -= dt;
    if (this.alive && !this.dead) {
      // glide and hover
      if (this.glideTo) {
        const dx = this.glideTo.x - this.pos.x, dz = this.glideTo.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
        const sp = Math.min(this.glideSpeed, dl * 1.2);
        this.glide.x = damp(this.glide.x, (dx / dl) * sp, 1.6, dt);
        this.glide.z = damp(this.glide.z, (dz / dl) * sp, 1.6, dt);
      } else {
        this.glide.x = damp(this.glide.x, 0, 1.4, dt);
        this.glide.z = damp(this.glide.z, 0, 1.4, dt);
      }
      this.pos.x += this.glide.x * dt;
      this.pos.z += this.glide.z * dt;
      this.liftNow = damp(this.liftNow, this.lift, 1.3, dt);
      const g = this.baseGround(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, g + this.hoverH + this.liftNow + Math.sin(this.t * 0.7) * 0.7 - this.spent * 0.15, this.yRate, dt);
      this.faceTarget(this.player.pos, this.turnRate, dt);
      this.spent = Math.max(0, this.spent - dt);
    }
    this.vel.set(0, 0, 0); // the glide above already moved him (vel only reports it)
    super.update(dt);
    this.vel.copy(this.glide);
    this.shots.update(dt);
    this.updateSweeps(dt);
    this.updateFalcons(dt);
    this.updateMeteors(dt);
    this.updateSpires(dt);
    this.updateFires(dt);
    this.updateWind(dt);
    this.updateEnv(dt);
    this.ambientFx(dt);
  }

  private updateFires(dt: number) {
    const pl = this.player;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.dur) {
        this.fires.splice(i, 1);
        continue;
      }
      const k = 1 - f.t / f.dur;
      if (rnd.chance(dt * 10 * k)) {
        const a = rnd.next() * Math.PI * 2, r = Math.sqrt(rnd.next()) * f.r;
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
        this.ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.1, z }, count: 1, spread: 0.4, up: 2.5, life: [0.3, 0.7], size: [0.9 * k + 0.3, 0.1], sprite: EMBERS, animate: true, additive: true, color: [0xffffff], drag: 1, gravity: -2 });
      }
      if (pl.alive && pl.pos.y < this.ground(f.x, f.z) + 1.2 && Math.hypot(pl.pos.x - f.x, pl.pos.z - f.z) < f.r && rnd.chance(dt * 3)) pl.takeHit({ base: f.dps * 0.35, kind: 'magic', source: 'contact', knock: 0, status: [{ id: 'burn', stacks: 1, dur: 2 }] });
    }
  }

  /** the sky follows the sun: Ra's disc is where the light comes from */
  private updateEnv(dt: number) {
    this.burnNow = damp(this.burnNow, this.burnT, 0.6, dt);
    this.eclNow = damp(this.eclNow, this.eclT, 1.4, dt);
    this.novaNow = damp(this.novaNow, this.novaT, 3, dt);
    this.moonK = damp(this.moonK, this.moonT, 1.2, dt);
    if (this.envHeld) return;
    this.envAcc += dt;
    if (this.envAcc < 0.08) return;
    this.envAcc = 0;
    let p = mixPreset(this.baseEnv, BURN, this.burnNow);
    p = mixPreset(p, ECLIPSE, this.eclNow);
    p = mixPreset(p, NOVA, this.novaNow);
    if (this.dawn > 0) p = mixPreset(p, DAWN, this.dawn);
    if (this.root.visible && this.dawn < 0.5) {
      // the sun is where his disc is
      const c = this.discWorld(_a);
      const pp = this.player.pos;
      const dx = c.x - pp.x, dy = c.y - pp.y, dz = c.z - pp.z, L = Math.hypot(dx, dy, dz) || 1;
      const az = THREE.MathUtils.radToDeg(Math.atan2(dz, dx));
      const el = clamp(THREE.MathUtils.radToDeg(Math.asin(dy / L)), 14, 68);
      let da = az - p.sunAzim;
      da = ((da + 540) % 360) - 180;
      const k = Math.min(1, this.burnNow * 1.6) * (1 - this.dawn * 2);
      p = { ...p, sunAzim: p.sunAzim + da * k, sunElev: p.sunElev + (el - p.sunElev) * k };
    }
    this.ctx.world.env.apply(p);
  }

  private ambientFx(dt: number) {
    if (!this.root.visible) return;
    this.fxT += dt;
    if (this.fxT < 0.06) return;
    this.fxT = 0;
    const ctx = this.ctx;
    const glow = this.raU.value.x;
    // embers shed from the wings and the trunk point, the corona round the disc
    for (const s of ['wingtip_l', 'wingtip_r', 'wingmid_l', 'wingmid_r']) {
      if (!rnd.chance(0.7)) continue;
      const p = this.socketWorld(s, _a);
      ctx.particles.emit({ pos: { x: p.x + (rnd.next() - 0.5) * 5, y: p.y + (rnd.next() - 0.5) * 4, z: p.z + (rnd.next() - 0.5) * 3 }, count: 2, vel: { x: 0, y: -1.5, z: 0 }, spread: 2, up: 3, life: [0.6, 1.3], size: [0.7 * glow, 0.08], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.2, gravity: -1 });
    }
    const tip = this.socketWorld('tailtip', _a);
    ctx.particles.emit({ pos: { x: tip.x, y: tip.y, z: tip.z }, count: 2, vel: { x: 0, y: -4, z: 0 }, spread: 1.5, life: [0.5, 1.0], size: [0.18, 0.04], sprite: ['spark', 'dot3'], additive: true, color: [0xffffff, SUN.gold], gravity: 8, stretch: 0.03 });
    if (rnd.chance(0.5 * glow)) this.coronaBurst(0.5);
    // the burning world: embers rise, ash drifts down
    const pp = this.player.pos;
    const b = this.burnNow;
    for (let i = 0; i < Math.round(3 * b); i++) {
      const x = pp.x + (rnd.next() - 0.5) * 50, z = pp.z + (rnd.next() - 0.5) * 50;
      ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.3 + rnd.next() * 3, z }, count: 1, vel: { x: ctx.world.sa.wind.x * 2, y: 1.8 + rnd.next() * 2, z: ctx.world.sa.wind.z * 2 }, spread: 0.6, life: [1.5, 3], size: [0.14, 0.05], sprite: ['spark', 'dot2'], additive: true, color: [0xffb050, 0xff7a2a, 0xffe0a0], drag: 0.3 });
    }
    if (rnd.chance(0.6 * b)) {
      const x = pp.x + (rnd.next() - 0.5) * 40, z = pp.z + (rnd.next() - 0.5) * 40;
      ctx.particles.emit({ pos: { x, y: pp.y + 8 + rnd.next() * 8, z }, count: 1, vel: { x: 0.4, y: -0.9, z: 0.2 }, spread: 0.4, life: [3, 5], size: [0.1, 0.08], sprite: ['dot3', 'grain1'], color: ASH, drag: 0.4, rot: 6, rotSpeed: 2 });
    }
  }

  // ------------------------------------------------------------------ procedural animation
  protected animate(dt: number) {
    const n = this.rig.nodes;
    const t = this.t;
    const hitK = Math.max(0, 1 - this.hitT / 0.35);
    this.foldNow = damp(this.foldNow, this.foldT, 2.2, dt);
    this.bendNow = damp(this.bendNow, this.bendT, 2.4, dt);
    this.headUpNow = damp(this.headUpNow, this.headUp, 2.4, dt);
    this.beat = Math.max(0, this.beat);
    // ---- wings: slow, heavy beats; the outer joints follow a beat behind
    const rate = this.flapRate + this.beat * 1.1;
    this.flapPh += dt * rate;
    const amp = this.flapAmp + this.beat * 0.16 + Math.hypot(this.glide.x, this.glide.z) * 0.012;
    const fold = this.foldNow;
    for (const s of [1, -1]) {
      const sf = s > 0 ? '_l' : '_r';
      const w1 = n['wing' + sf], w2 = n['wing2' + sf], w3 = n['wing3' + sf];
      if (!w1) continue;
      const ph = this.flapPh;
      // fold > 0 wraps the wings forward round him (the falling star), < 0 sweeps them wide
      w1.rotation.set(-0.05 * fold, -s * (fold > 0 ? fold * 1.15 : fold * 0.5), s * (Math.sin(ph) * amp + 0.04 - Math.max(0, fold) * 0.5 - hitK * 0.05));
      w2.rotation.set(0, -s * Math.max(0, fold) * 0.9, s * (Math.sin(ph - 0.7) * amp * 0.7 - Math.max(0, fold) * 0.35));
      w3.rotation.set(0.04 * Math.sin(ph - 1.1), -s * Math.max(0, fold) * 0.8, s * (Math.sin(ph - 1.3) * amp * 0.6 - Math.max(0, fold) * 0.3));
    }
    // ---- the plasma trunk: a wave runs down it like a candle flame in a draught
    const lean = clamp(-(this.glide.x * Math.sin(this.yaw) + this.glide.z * Math.cos(this.yaw)) * 0.02, -0.25, 0.25);
    for (let i = 1; i <= 4; i++) {
      const tn = n['tail' + i];
      if (!tn) continue;
      tn.rotation.set(0.05 * Math.sin(t * 1.3 - i * 0.8) + lean * 0.4, 0.04 * Math.sin(t * 0.7 - i), 0.07 * Math.sin(t * 0.95 - i * 0.7));
    }
    if (n['tailfan']) n['tailfan'].rotation.set(0.05 * Math.sin(t * 1.1) + lean * 0.5, 0, 0.04 * Math.sin(t * 0.8));
    // ---- body
    const br = Math.sin(t * 0.8) * 0.02;
    if (n['pelvis']) n['pelvis'].rotation.set(lean * 0.3 + this.bendNow * 0.2, 0, Math.sin(t * 0.45) * 0.015);
    n['torso'].rotation.set(this.bendNow * 0.5 + br - hitK * 0.06, Math.sin(t * 0.33) * 0.03, Math.sin(t * 0.41) * 0.02);
    // ---- head: finds you, slow and imperious; looks up to the sky to call
    const head = n['head'];
    if (head) {
      head.parent!.updateWorldMatrix(true, false);
      const lp = head.parent!.worldToLocal(this.player.center(_a));
      const dx = lp.x - head.position.x, dy = lp.y - head.position.y, dz = lp.z - head.position.z;
      const yaw = clamp(Math.atan2(dx, dz), -0.8, 0.8), pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.4, 0.7);
      head.rotation.x = damp(head.rotation.x, pitch * 0.75 - this.headUpNow - this.bendNow * 0.3 + hitK * 0.12, 2.4, dt);
      head.rotation.y = damp(head.rotation.y, yaw * 0.85, 2.4, dt);
      head.rotation.z = Math.sin(t * 0.5) * 0.03;
      if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, this.rig.exprJaw + this.anim.jaw + (this.anim.jaw > 0.2 ? Math.sin(t * 30) * 0.03 : 0), 9, dt);
      if (n['brow_l']) n['brow_l'].rotation.z = damp(n['brow_l'].rotation.z, -this.rig.exprBrow[0], 8, dt);
      if (n['brow_r']) n['brow_r'].rotation.z = damp(n['brow_r'].rotation.z, -this.rig.exprBrow[1], 8, dt);
    }
    // ---- the disc: the core turns and breathes; the glow follows his effort
    this.discNow = damp(this.discNow, this.discT, 2.5, dt);
    this.coreScaleNow = damp(this.coreScaleNow, this.coreScaleT, 2, dt);
    const core = n['core'];
    if (core) {
      core.rotation.z += dt * 0.12;
      core.scale.setScalar(this.coreScaleNow * (1 + Math.sin(t * 2.3) * 0.02 * (1 + this.discNow)));
    }
    if (n['disc']) n['disc'].rotation.set(Math.sin(t * 0.37) * 0.02, Math.sin(t * 0.29) * 0.025, 0);
    if (n['uraeus']) n['uraeus'].rotation.set(Math.sin(t * 1.4) * 0.04, Math.sin(t * 0.9) * 0.06, 0);
    if (this.moon) {
      const k = this.moonK;
      this.moon.position.set((1 - k) * 11, (1 - k) * 2, 2.0);
      this.moon.visible = k > 0.01;
    }
    const fxv = this.rig.material.userData.fx.value;
    fxv.z = (this.discNow - 0.3) * 0.25 + this.novaNow * 1.2 - this.eclNow * 0.55;
    this.raU.value.x = 1 - this.eclNow * 0.62;
    this.raU.value.y = 1;
    this.eyeGlowNow = damp(this.eyeGlowNow, this.eyeGlowT, 3, dt);
    this.eyeRa.value.x = 0.4 + this.eyeGlowNow * 1.1 + this.eclNow * 0.6;
    this.sunLight.intensity = this.root.visible ? (55 + this.discNow * 40 + this.novaNow * 250) * (1 - this.eclNow * 0.8) : 0;
    this.root.updateMatrixWorld(true);
    // ---- arms (IK), hands, fingers
    for (let s = 0; s < 2; s++) this.solveArm(s, dt);
    // ---- the eyes find you
    if (head) {
      for (let s = 0; s < 2; s++) {
        const eye = n[s === 0 ? 'eye_l' : 'eye_r'];
        if (!eye) continue;
        const lp = head.worldToLocal(this.player.center(_a)).sub(eye.position).normalize();
        _q.setFromUnitVectors(this.eyeAxis[s], lp);
        _qi.identity().slerp(_q, Math.min(1, 0.4 / Math.max(0.01, 2 * Math.acos(Math.min(1, Math.abs(_q.w))))));
        eye.quaternion.slerp(_qi, 1 - Math.exp(-7 * dt));
      }
    }
  }

  private solveArm(s: number, dt: number) {
    const A = this.arms[s], J = this.J[s], n = this.rig.nodes;
    const sf = s === 0 ? '_l' : '_r';
    const arm = n['arm' + sf], fore = n['fore' + sf], hand = n['hand' + sf];
    if (!arm || !fore || !hand) return;
    if (A.mode === 'rest') {
      // hands float at his sides, fingers loose, a slow drift
      this.root.localToWorld(A.tgt.copy(J.K).add(_v.set((s === 0 ? 1 : -1) * (0.6 + Math.sin(this.t * 0.31 + s) * 0.4), Math.sin(this.t * 0.43 + s * 2) * 0.5 + 0.6, 1.2 + Math.cos(this.t * 0.27 + s) * 0.5)));
      A.rate = 1.8;
      A.curl = 0.4 + Math.sin(this.t * 0.6 + s * 3) * 0.1;
      A.wrist = 0.15;
    }
    if (A.now.lengthSq() === 0) A.now.copy(A.tgt);
    A.now.lerp(A.tgt, 1 - Math.exp(-A.rate * dt));
    A.wristNow = damp(A.wristNow, A.wrist, 6, dt);
    A.curlNow = damp(A.curlNow, A.curl, 7, dt);
    hand.quaternion.setFromAxisAngle(J.wristAxis, A.wristNow);
    const k = _a.copy(A.curlNow > 1 ? J.fist : J.K).sub(J.W).applyQuaternion(hand.quaternion).add(_b.copy(J.W).sub(J.E));
    const L2 = k.length();
    const f0 = k.normalize();
    const L1 = J.L1;
    arm.parent!.getWorldQuaternion(_qt);
    arm.getWorldPosition(_S);
    const D = _d.copy(A.now).sub(_S);
    const dist = clamp(D.length(), Math.abs(L1 - L2) + 0.05, (L1 + L2) * 0.995);
    const dir = D.normalize();
    const pole = _p.copy(A.pole).applyQuaternion(this.root.quaternion);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _E.copy(_S).addScaledVector(dir, a).addScaledVector(pole, h);
    _T.copy(_S).addScaledVector(dir, dist);
    _qi.copy(_qt).invert();
    _qa.setFromUnitVectors(J.u0, _v.copy(_E).sub(_S).normalize().applyQuaternion(_qi));
    _qw.copy(_qt).multiply(_qa).invert();
    _qf.setFromUnitVectors(f0, _v.copy(_T).sub(_E).normalize().applyQuaternion(_qw));
    const kk = 1 - Math.exp(-12 * dt);
    arm.quaternion.slerp(_qa, kk);
    fore.quaternion.slerp(_qf, kk);
    for (let f = 0; f < 4; f++) {
      const ax = J.fingers[f];
      const w = Math.sin(this.t * 1.3 + f * 0.7 + s) * 0.06;
      const c = A.curlNow + f * 0.05;
      n[`fing${f + 1}${sf}`]?.quaternion.setFromAxisAngle(ax, c - 0.32 + w);
      n[`tip${f + 1}${sf}`]?.quaternion.setFromAxisAngle(ax, c * 1.1 - 0.45 + w);
    }
    n['thumb' + sf]?.quaternion.setFromAxisAngle(J.thumb, A.curlNow * 0.7 - 0.1);
    n['thumbtip' + sf]?.quaternion.setFromAxisAngle(J.thumb, A.curlNow * 0.6);
    hand.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ death: a dying star, and dawn
  /** the fight script stops the moment he starts dying (he stays "alive" for the wave until the star is out) */
  protected check() {
    if (this.dead) throw new Cancelled();
    super.check();
  }
  die() {
    if (!this.alive || this.dead) return;
    // `alive` stays true until the dying star has burned out and dawn is up: the wave (and the run's
    // last results screen) waits for the whole sequence instead of cutting it off
    this.dead = true;
    const ctx = this.ctx;
    this.setExpr('defeated');
    this.taunt('The sun... goes... down...', SUNC);
    ctx.engine.slowMo(0.25, 30);
    ctx.engine.tweens.after(1.6, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.5);
    ctx.sfx('anubis_roar', this.pos, 0.8, 0.4);
    ctx.shake(1);
    ctx.engine.flash(0xfff2d0, 0.45, 0.7);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    this.invulnerable = true;
    this.radius = -50;
    this.sweeps = [];
    this.shots.clear();
    for (const f of this.falcons) this.falconBurst(f, false);
    this.falcons = [];
    this.wind.on = 0;
    this.eclT = 0;
    this.novaT = 0;
    this.moonT = 0;
    for (const b of this.beams) b.intensity = 0;
    this.warnLine.intensity = 0;
    void this.deathSequence();
  }
  private async deathSequence() {
    const ctx = this.ctx;
    const tw = ctx.engine.tweens;
    const fx = this.rig.material.userData.fx.value;
    // 1) the god burns away into his heart: wings close, the body dissolves inward
    this.foldT = 1;
    this.bendT = 0.4;
    this.headUp = -0.3;
    this.anim.jaw = 0.5;
    for (const s of [0, 1]) this.aim(s, this.local(s === 0 ? 2 : -2, 26, 4), 1.4, 1.2, 0.4);
    this.coreScaleT = 1.3;
    for (let t = 0; t < 3.0; t += 0.05) {
      await tw.wait(0.05);
      const k = t / 3;
      fx.y = Math.min(0.92, k * 1.1);
      // the fire runs up into the disc
      const c = this.discWorld(_a);
      for (let i = 0; i < 4; i++) {
        const x = c.x + (rnd.next() - 0.5) * 40, y = c.y - 25 + rnd.next() * 30, z = c.z + (rnd.next() - 0.5) * 20;
        const T = 0.7;
        ctx.particles.emit({ pos: { x, y, z }, count: 1, vel: { x: (c.x - x) / T, y: (c.y - y) / T, z: (c.z - z) / T }, life: [T * 0.9, T], size: [1.2, 0.2], sprite: EMBERS, additive: true, color: FIRE_COLS });
      }
      if (rnd.chance(0.3)) ctx.shake(0.25);
    }
    // 2) the dying star: the heart tears loose, swells red, falls in, flashes white
    const core = this.rig.nodes['core'];
    let star: THREE.Object3D | null = null;
    if (core) {
      ctx.scene.attach(core);
      this.corpse = core;
      star = core;
    }
    this.root.visible = false;
    const starFx = { value: new THREE.Vector4() };
    const starRa = { value: new THREE.Vector4(1.4, 0, 1.6, 1.4) };
    const starMat = raMaterial(starFx, starRa, 'star');
    star?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = starMat;
    });
    const s0 = star ? star.scale.x : 1;
    ctx.sfx('quake_rumble', this.pos, 1, 0.4);
    for (let t = 0; t < 2.2; t += 0.05) {
      await tw.wait(0.05);
      const k = t / 2.2;
      if (star) {
        star.scale.setScalar(s0 * (1 + k * 0.9));
        star.rotation.z += 0.05 * (1 + k * 4);
      }
      starRa.value.x = 1.4 - k * 0.6; // cooling to a red giant
      starFx.value.z = -k * 0.3;
      this.coronaBurst(1.5 + k * 2);
    }
    ctx.sfx('time_slow', null, 1, 0.4);
    for (let t = 0; t < 0.7; t += 0.05) {
      await tw.wait(0.05);
      const k = t / 0.7;
      if (star) star.scale.setScalar(s0 * (1.9 - k * 1.75));
      starRa.value.x = 0.8 + k * 3;
      starFx.value.z = k * 2;
    }
    const c = star ? star.getWorldPosition(new THREE.Vector3()) : this.pos.clone();
    ctx.engine.flash(0xffffff, 1, 1.4);
    ctx.engine.hitStop(0.1);
    ctx.shake(1.2);
    ctx.sfx('explosion_big', c, 1, 0.3);
    ctx.sfx('divine_chime', c, 1, 0.5);
    ctx.particles.emit({ pos: c, count: 1, life: [0.5, 0.6], size: [4, 60], sprite: 'ring', additive: true, color: 0xfff6e0, sizeJitter: 0 });
    ctx.particles.emit({ pos: c, count: 80, spread: 40, life: [0.8, 1.6], size: [1.5, 0.1], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.2 });
    ctx.fx.light(c, 0xfff0d0, 200, 1.2, 160);
    star?.removeFromParent();
    this.corpse = null;
    starMat.dispose();
    // 3) the fire drains: the river runs back to water, dawn comes up
    this.ctx.toast('« Let It Be »', '#ffe3a0', 'The river runs clear', true);
    void this.restoreWorld();
    await tw.wait(2.2);
    // 4) bounty, then clean up: the reward drops on the ground before the hunter, not in the sky
    const pp = this.player.pos;
    const dl = Math.hypot(this.pos.x - pp.x, this.pos.z - pp.z) || 1;
    const bx = pp.x + ((this.pos.x - pp.x) / dl) * 7, bz = pp.z + ((this.pos.z - pp.z) / dl) * 7;
    this.pos.set(bx, this.ground(bx, bz), bz);
    ctx.fx.coins({ x: bx, y: this.pos.y + 2, z: bz }, 50);
    this.alive = false;
    this.onDefeated?.(this, false);
    this.dispose();
  }
  /** lava back to water and a cool dawn (the world worker owns burnToLava; without it only the sky changes) */
  private async restoreWorld() {
    const ctx = this.ctx;
    const tw = ctx.engine.tweens;
    const world = ctx.world as unknown as { burnToLava?: (k: number) => void };
    this.envHeld = true;
    const p0 = { ...ctx.world.env.preset };
    for (let t = 0; t < 6; t += 0.05) {
      await tw.wait(0.05, true);
      const k = t / 6, e = k * k * (3 - 2 * k);
      world.burnToLava?.(1 - e);
      const p = mixPreset(p0, DAWN, e);
      ctx.world.env.apply(p);
    }
    world.burnToLava?.(0);
    ctx.world.env.apply(mixPreset(this.baseEnv, DAWN, 1));
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    super.dispose();
    this.shots.dispose();
    for (const b of this.beams) b.dispose();
    this.warnLine.dispose();
    for (const f of this.falcons) f.rig.root.removeFromParent();
    this.falcons = [];
    for (const m of this.meteors) m.mesh.removeFromParent();
    this.meteors = [];
    for (const s of this.spires) s.mesh.removeFromParent();
    this.spires = [];
    this.fires = [];
    this.sweeps = [];
    this.sunLight.removeFromParent();
    this.corpse?.removeFromParent();
    this.corpse = null;
    this.moon?.removeFromParent();
    this.dead = true;
    this.wind.on = 0;
    const post = this.ctx.engine.post as unknown as { bloom?: { strength: number } };
    if (post.bloom && this.bloom0 >= 0) post.bloom.strength = this.bloom0;
    // a boss torn down mid-fight (the run ended) gives the sky back
    if (this.alive) this.ctx.world.env.apply(this.baseEnv);
    this.body.dispose();
    this.eyeMat.dispose();
    if ((window as any).__ra === this) (window as any).__ra = null;
  }
}


