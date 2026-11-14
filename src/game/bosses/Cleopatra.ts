// CLEOPATRA, AVATAR OF RA — wave 75 of the Nile (the end of region B).
// The sun's own daughter, veiled head to foot in glowing silk, hovering above
// the river beside her golden royal barge. Her dance IS her attack: every move
// is a choreographed bullet pattern of sunlight.
//   Phase 1 (100–66%)  Something (a pirouette; her crimson sleeve-ribbons sweep
//                      two spiral curtains of sun-fire with open lanes),
//                      Across the Universe (a sun salutation: a mandala of counter-
//                      rotating rings, each with gaps, blooms outward),
//                      Dear Prudence (one hand to the sky: sunlight lances fall
//                      on golden rings that track you), Beast of Burden
//                      (she points: her lions roar, then pounce)
//   Phase 2 (66–33%)   + She's a Rainbow (the crown disc charges and a sunbeam
//                      sweeps the sand: jump it or outrun it), Strawberry Fields
//                      Forever (she splits into golden mirages around
//                      you; all of them throw diamond fans; only she casts a
//                      shadow and sheds petals), Golden Slumbers (golden scarab
//                      swarms pour from her sleeves: shoot them down);
//                      fresh Rams of Amun leap from the barge if hers fell
//   Phase 3 (33–0%)    her silk catches fire at the edges, the glow swells;
//                      + Good Day Sunshine (solar flares erupt under you),
//                      Let It Bleed (she rises as a little sun: mandalas,
//                      twin beams and flares at once, then she sinks exhausted
//                      with her heart open), a third lion joins
// Her guards feed her SUN WARD: while a Ram of Amun stands, she shrugs off most
// damage. Weak points: the heart (x1.7, x3 while exhausted), the head (x1.4),
// the sun disc (x1.3), her hands (x1.2).
// Intro: the golden barge glides in on a rain of rose petals, golden dancers on
// its prow, her rams and lions on deck; she rises from her throne and floats
// out over the water. Death: her silk burns away, she becomes a column of light,
// the sky goes dark and Ra is enraged ("raEnraged"; world.burnToLava if present).
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere } from './Boss';
import type { Hit } from '../combat/Damage';
import { RigInstance, type RigGeo } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, type VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { RigEyes } from '../fx/FaceFx';
import { speak3D } from '../fx/WorldSpeech';
import type { EnvPreset } from '../world/Env';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { SpringF } from '../anim/spring';
import { Cloth } from '../../engine/physics/Cloth';
import { courtGeo, prewarmCourt } from '../models/cleopatra/courtGeo';
import { COURT_BUILDERS } from '../models/cleopatra/courtList';
import { buildRigGeo } from '../../engine/voxel/Rig';
import { Silk, SilkRenderer } from './cleo/Silk';
import { SunShots, ScarabSwarm } from './cleo/SunShots';
import { RoyalGuard, TamedLion, type CourtDeps } from './cleo/Court';

const SUNC = '#ffd27a';
const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** the river at noon of a god: warm gold light, haze like honey */
const GOLDEN: Partial<EnvPreset> = { sunColor: 0xffd08a, sunIntensity: 3.6, hemiSky: 0xb8c4e8, hemiGround: 0xd8a060, fog: 0xe8c890, horizon: 0xffd8a0, exposure: 1.06, clouds: 0.35, cloudColor: 0xfff0d0 };
/** Live and Let Die: the sun is in her hands, the sky goes violet */
const ECLIPSE: Partial<EnvPreset> = { zenith: 0x24123a, horizon: 0xff8a40, ground: 0x7a4a2a, sunColor: 0xffb060, sunIntensity: 2.0, hemiSky: 0x7a6aa0, hemiGround: 0x8a4a2a, hemiIntensity: 0.8, fog: 0x8a4a3a, fogNear: 40, fogFar: 300, exposure: 1.1, stars: 0.5, clouds: 0.5, cloudColor: 0xc06a4a };
/** Ra is enraged: a blood eclipse */
const RA_ANGER: Partial<EnvPreset> = { zenith: 0x1a0606, horizon: 0xc0300c, ground: 0x4a1a0c, sunColor: 0xff5a1a, sunIntensity: 2.6, sunElev: 9, hemiSky: 0x6a2a2a, hemiGround: 0x5a1a0a, hemiIntensity: 0.75, fog: 0x5a160c, fogNear: 30, fogFar: 260, exposure: 1.12, stars: 0.6, clouds: 0.8, cloudColor: 0x7a1a0a };

// ------------------------------------------------------------------------------ dance poses
type J3 = [number, number, number];
type Pose = Record<string, J3>;
const mirror = (l: Pose): Pose => {
  const o: Pose = { ...l };
  for (const [k, v] of Object.entries(l)) if (k.endsWith('_l')) o[k.slice(0, -2) + '_r'] ??= [v[0], -v[1], -v[2]];
  return o;
};
const POSES: Record<string, Pose> = {
  idle: mirror({ torso: [0.03, 0, 0], head: [0.06, 0, 0], arm_l: [-0.12, 0, 0.2], fore_l: [-0.45, 0, 0.05], hand_l: [-0.25, 0.3, 0], fing_l: [0.25, 0, 0], foot_l: [0.15, 0, 0], foot_r: [0.4, 0, 0] }),
  open: mirror({ torso: [-0.1, 0, 0], head: [-0.15, 0, 0], arm_l: [-0.25, 0, 1.3], fore_l: [-0.15, 0, 0.35], hand_l: [0, 0.9, 0.35], fing_l: [-0.1, 0, 0] }),
  raise: mirror({ torso: [-0.12, 0, 0], head: [-0.3, 0, 0], arm_l: [-0.15, 0, 2.75], fore_l: [0, 0, 0.55], hand_l: [0, 0, 0.5], fing_l: [0.1, 0, 0] }),
  sky: { ...mirror({ arm_l: [-0.3, 0, 2.85], fore_l: [0, 0, 0.2], hand_l: [0, 0, 0.3], fing_l: [-0.1, 0, 0] }), arm_r: [-0.35, 0, -0.55], fore_r: [-0.3, 0, -0.2], hand_r: [0, -0.4, 0], fing_r: [0.2, 0, 0], head: [-0.35, 0.2, 0], torso: [-0.08, 0.15, 0.08] },
  point: { ...mirror({ arm_l: [-0.2, 0, 0.6], fore_l: [-0.6, 0, 0.2], hand_l: [-0.2, 0.4, 0], fing_l: [0.3, 0, 0] }), arm_r: [-1.5, 0, -0.1], fore_r: [-0.05, 0, 0], hand_r: [0.15, 0, 0], fing_r: [-0.1, 0, 0], torso: [0, -0.3, 0], head: [0, 0.25, 0] },
  cup: mirror({ torso: [0.12, 0, 0], head: [0.25, 0, 0], arm_l: [-0.55, 0.2, 0.3], fore_l: [-1.55, 0.6, 0], hand_l: [-0.3, 0.4, -0.6], fing_l: [0.6, 0, 0] }),
  push: mirror({ torso: [-0.05, 0, 0], head: [-0.05, 0, 0], arm_l: [-1.25, 0, 0.25], fore_l: [-0.35, 0, -0.55], hand_l: [0.6, 0, 0], fing_l: [-0.3, 0, 0] }),
  spin: { ...mirror({ fing_l: [0, 0, 0] }), arm_l: [-0.3, 0, 2.4], fore_l: [0, 0, 0.6], hand_l: [0, 0, 0.5], arm_r: [-0.25, 0, -1.45], fore_r: [-0.2, 0, -0.35], hand_r: [0, -0.5, -0.3], head: [-0.1, 0, 0.15], torso: [-0.06, 0, -0.08] },
  bow: { ...mirror({}), torso: [0.4, 0, 0], head: [0.3, 0, 0], arm_l: [0.15, 0, 0.55], fore_l: [-0.25, 0, 0.2], hand_l: [0, 0.5, 0.4], arm_r: [-0.6, 0, -0.3], fore_r: [-1.2, 0, 0.3], hand_r: [0, 0, 0], skirt: [-0.15, 0, 0] },
  seated: mirror({ torso: [0.05, 0, 0], head: [0.1, 0, 0], arm_l: [-0.55, 0, 0.22], fore_l: [-0.85, 0, 0], hand_l: [0.3, 0, 0], fing_l: [0.2, 0, 0], skirt: [-1.5, 0, 0], skirt_lo: [1.5, 0, 0], foot_l: [0.3, 0, 0] }),
  exhausted: mirror({ torso: [0.45, 0, 0.1], head: [0.5, 0, 0.2], arm_l: [0.1, 0, 0.15], fore_l: [-0.2, 0, 0], hand_l: [0.2, 0, 0], fing_l: [0.4, 0, 0], skirt: [-0.9, 0, 0], skirt_lo: [1.6, 0, 0] }),
  death: mirror({ torso: [-0.45, 0, 0], head: [-0.6, 0, 0], arm_l: [0.1, 0, 0.95], fore_l: [-0.1, 0, 0.2], hand_l: [0, 0.6, 0.3], fing_l: [-0.2, 0, 0] }),
};
const JOINTS = ['torso', 'head', 'arm_l', 'fore_l', 'hand_l', 'fing_l', 'thumb_l', 'arm_r', 'fore_r', 'hand_r', 'fing_r', 'thumb_r', 'skirt', 'skirt_lo', 'foot_l', 'foot_r'];

/** start carving the queen's court off-thread (a few waves early) */
export function prewarmCleopatra() {
  prewarmCourt();
}

/** a golden mirage of the queen (Lucy in the Sky with Diamonds): one hit pops it */
class Mirage {
  id = 982000 + Math.floor(Math.random() * 9000);
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.6;
  height = 3.2;
  alive = true;
  isBoss = false;
  hp = 1;
  maxHp = 1;
  name = 'Mirage';
  flying = true;
  rig: RigInstance;
  fireT = rnd.next();
  ph = rnd.next() * TAU;
  constructor(public owner: Cleopatra, geo: RigGeo, mat: VoxelMaterial) {
    this.rig = new RigInstance(geo, { material: mat, castShadow: false });
    owner.ctx.scene.add(this.rig.root);
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number) {
    if (!this.alive) return null;
    _v.set(this.pos.x, this.pos.y + 2.0, this.pos.z);
    const ox = o.x - _v.x, oy = o.y - _v.y, oz = o.z - _v.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - 0.7 * 0.7);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxT) return null;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: this, t, point, normal: point.clone().sub(_v).normalize(), headshot: false, part: 'mirage', surface: 'enemy' as const };
  }
  takeDamage(_hit: Hit, point?: THREE.Vector3) {
    if (!this.alive) return 0;
    this.owner.popMirage(this, point);
    return 1;
  }
}

export class Cleopatra extends Boss {
  // ------------------------------------------------------------------ assets
  private geo: RigGeo | null = null;
  private silkR: SilkRenderer;
  private silks: Record<string, Silk> = {};
  private colliders: { c: THREE.Vector3; r: number }[] = [];
  shots: SunShots;
  private swarm: ScarabSwarm | null = null;
  private heartLight: THREE.PointLight;
  private mirageMat: VoxelMaterial;
  private mirages: Mirage[] = [];
  private dancers: RigInstance[] = [];
  // ------------------------------------------------------------------ the barge
  private barge: { rig: RigInstance; pos: THREE.Vector3; y: number; yaw: number; water: boolean; anchor: THREE.Vector3; t: number; sink: number; fire: number } | null = null;
  private bargeCloth: Cloth[] = [];
  private bargeSilk: Silk[] = [];
  // ------------------------------------------------------------------ the court
  guards: RoyalGuard[] = [];
  lions: TamedLion[] = [];
  private courtD: CourtDeps;
  private tier: number;
  // ------------------------------------------------------------------ animation state
  private poseName = 'idle';
  private cur: Record<string, THREE.Vector3> = {};
  private dance = 0.4;
  private spinRate = 0;
  private spinTarget = 0;
  private spinA = 0;
  private hoverT = 1.6;
  private hoverNow = 0;
  private glowT = 1;
  private glowNow = 0;
  private raySpin = 0.4;
  private rayA = 0;
  private burnT = 0;
  private skirtS = [new SpringF(0, 1.8, 0.35), new SpringF(0, 1.8, 0.35), new SpringF(0, 1.4, 0.3), new SpringF(0, 1.4, 0.3)];
  private apronS = new SpringF(0, 2.2, 0.3);
  private seated = false;
  private lookYaw = 0;
  private exposed = false;
  private petalT = 0;
  private emberT = 0;
  private hintT = 0;
  private wardFx = 0;
  // ------------------------------------------------------------------ fight state
  private queue: string[] = [];
  private lastAttack = '';
  private lastCallout = '';
  private cds = { strawberry: 6, swarm: 4, desperate: 0 };
  private desperateDone = 0;
  private baseEnv: EnvPreset;
  private golden: EnvPreset;
  private eclipse: EnvPreset;
  private anger: EnvPreset;
  private envK = 0;
  private envT = 0;
  private envTo: 'golden' | 'eclipse' | 'anger' = 'golden';
  private envApplied = -1;
  private dead = false;
  private heartS: HitSphere;
  private disposed = false;

  constructor(d: BossDeps, tier = 3) {
    // the base builds a cheap placeholder; the real rig is carved off-thread and swapped in (intro)
    super(d, 'cleopatra_pending', { name: 'Cleopatra', title: 'Avatar of Ra, Daughter of the Sun', hp: 4600 * tier, scale: 1, eyes: ['glow', 0xffd070] });
    this.tier = tier;
    this.armor = 40;
    this.physRes = 0.12;
    this.magicRes = 0.22;
    this.statusRes = { poison: 0.5, burn: 0.8, bleed: 0.3 };
    this.bounty = 1500;
    this.gold = 600;
    this.phases = [0.66, 0.33];
    this.flying = true;
    this.squash.kick = () => {};
    this.radius = 0.55;
    this.height = 3.2;
    this.root.visible = false;
    const ctx = this.ctx;
    prewarmCourt();
    this.silkR = new SilkRenderer(ctx.scene);
    this.shots = new SunShots(ctx, this.player);
    this.shots.sourceId = this.id;
    this.shots.onDraw = (add) => this.drawWard(add);
    this.heartLight = new THREE.PointLight(0xffb850, 0, 14, 1.6);
    ctx.scene.add(this.heartLight);
    this.mirageMat = makeVoxelMaterial({ transparent: true, opacity: 0.55, emissiveStrength: 2.2 });
    this.mirageMat.userData.tint.value.setRGB(1.25, 1.0, 0.55);
    this.mirageMat.userData.fx.value.set(0.35, 0, 1.2, 0);
    this.mirageMat.depthWrite = false;
    this.heartS = { node: 'torso', r: 0.22, part: 'heart', weak: 1.7, offset: [0, 0.26, 0.06] };
    this.baseEnv = { ...ctx.world.env.preset };
    this.golden = { ...this.baseEnv, ...GOLDEN, sunAzim: this.baseEnv.sunAzim };
    this.eclipse = { ...this.baseEnv, ...ECLIPSE, sunAzim: this.baseEnv.sunAzim };
    this.anger = { ...this.baseEnv, ...RA_ANGER, sunAzim: this.baseEnv.sunAzim };
    const self = this;
    this.courtD = {
      ctx,
      player: this.player,
      enemies: d.enemies,
      cloth: d.cloth,
      shots: this.shots,
      queen: {
        get pos() {
          return self.pos;
        },
        get alive() {
          return self.alive && !!self.geo;
        },
        heart: (out) => self.heart(out),
      },
      callout: (song, who) => this.callout(song, who),
    };
    for (const j of JOINTS) this.cur[j] = new THREE.Vector3();
    (window as any).__cleopatra = this; // dev handle: __cleopatra.debug('universe')
  }

  // ================================================================== geometry
  /** swap the placeholder for the carved queen and dress her in silk */
  private adopt(geo: RigGeo) {
    if (this.geo) return;
    this.geo = geo;
    const old = this.rig;
    this.root.remove(old.root);
    old.material.dispose();
    this.rig = new RigInstance(geo, { ownMaterial: true });
    this.rig.material.userData.emissiveStrength.value = 1.5;
    this.root.add(this.rig.root);
    this.eyes = new RigEyes(this.rig, 'glow', 0xffd070);
    this.height = 3.2;
    this.hitSpheres = [
      this.heartS,
      { node: 'head', r: 0.2, part: 'head', weak: 1.4, offset: [0, 0.31, 0.0] },
      { node: 'sun_disc', r: 0.24, part: 'disc', weak: 1.3, offset: [0, 0, 0] },
      { node: 'torso', r: 0.3, part: 'torso', weak: 1.0, offset: [0, 0.3, -0.05] },
      { node: 'pelvis', r: 0.32, part: 'body', weak: 0.9, offset: [0, 0, 0] },
      { node: 'skirt', r: 0.36, part: 'gown', weak: 0.7, offset: [0, -0.3, 0] },
      { node: 'skirt_lo', r: 0.42, part: 'gown', weak: 0.7, offset: [0, -0.4, 0] },
      { node: 'hand_l', r: 0.13, part: 'hand', weak: 1.2, offset: [0.014, -0.086, 0.012] },
      { node: 'hand_r', r: 0.13, part: 'hand', weak: 1.2, offset: [-0.014, -0.086, 0.012] },
    ];
    this.rig.nodes['torso'].add(this.heartLight);
    this.heartLight.position.set(0, 0.26, 0.3);
    // silk: the veil, crimson sleeve streamers, sash ribbons and four sheer skirt panels
    const S = (k: string, w: number, h: number, width: number, length: number, look: ConstructorParameters<typeof Silk>[1], o: { stiffness?: number; drag?: number; gravity?: number } = {}) => {
      const s = new Silk({ w, h, width, length, stiffness: o.stiffness ?? 0.85, drag: o.drag ?? 2.4, gravity: o.gravity ?? 7, thickness: 0.016 }, look);
      s.cloth.groundAt = (x, z) => this.ctx.world.groundAt(x, z);
      s.cloth.spheres = this.colliders;
      this.silks[k] = s;
      this.silkR.add(s);
    };
    const ivory = { main: 0xf6ecdc, alt: 0xf0dcb8, trim: 0xe8b84a };
    S('veil', 9, 15, 0.5, 2.5, { ...ivory, glow: 0.35, glowFall: 0.7, pattern: 'veil' }, { gravity: 6 });
    for (const sd of ['l', 'r']) {
      S('sleeve_' + sd, 4, 16, 0.3, 2.5, { main: 0xc02a3a, alt: 0x8e1a2c, trim: 0xe8b84a, glow: 0.3, glowFall: 0.4, pattern: 'ribbon' }, { stiffness: 0.8, drag: 2.8, gravity: 5.5 });
      S('sash_' + sd, 3, 14, 0.15, 2.0, { main: 0xf2d48a, alt: 0xe0b04a, trim: 0xc02a3a, glow: 0.25, pattern: 'ribbon' }, { gravity: 6.5 });
    }
    for (const sd of ['f', 'b', 'l', 'r']) S('skirt_' + sd, 5, 10, 0.36, 1.45, { main: 0xfaf2e4, alt: 0xf2e2c6, trim: 0xe8b84a, glow: 0.28, glowFall: 0.6, pattern: 'panel' }, { stiffness: 0.9, gravity: 7.5 });
    for (let i = 0; i < 5; i++) this.colliders.push({ c: new THREE.Vector3(), r: 0.3 });
  }

  // ================================================================== small helpers
  private callout(song: string, who = 'Cleopatra') {
    if (song === this.lastCallout) return;
    this.lastCallout = song;
    this.ctx.toast(`« ${song} »`, SUNC, who);
    this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
  }
  /** her lines float in golden type over her head, in an airy, layered voice */
  taunt(text: string, color = '#ffc860') {
    speak3D(this.ctx.engine, 'serket', text, this.pos, { key: `boss:${this.id}`, lift: this.height * 1.12 + 0.4, side: 0.4, size: 0.2, px: 64, wrap: 26, color: '#fff4dc', glow: color, hdr: 1.6, voice: { follow: true, key: `boss:${this.id}` } });
  }
  private say(lines: string[]) {
    this.taunt(rnd.pick(lines));
  }
  heart(out: THREE.Vector3) {
    const s = this.rig.sockets['heart'];
    if (s && this.geo) return s.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 2.1, this.pos.z);
  }
  private palm(s: 0 | 1, out: THREE.Vector3) {
    const k = this.rig.sockets[s === 0 ? 'palm_l' : 'palm_r'];
    if (k && this.geo) return k.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
  }
  private disc(out: THREE.Vector3) {
    const k = this.rig.sockets['disc_front'];
    if (k && this.geo) return k.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 3.3, this.pos.z);
  }
  private surface(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.player.pos.clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private guardsUp() {
    return this.guards.some((g) => g.alive);
  }
  private waitFor(fn: () => boolean, max: number) {
    return (async () => {
      let t = 0;
      while (!fn() && t < max) {
        await this.wait(0.1);
        t += 0.1;
      }
      return fn();
    })();
  }
  /** a court rig (carved off-thread), or a synchronous carve if the worker never answered */
  private courtNow(key: string) {
    return courtGeo(key) ?? buildRigGeo(COURT_BUILDERS[key](), 'court:' + key);
  }
  private setPose(p: string, dance = this.dance) {
    this.poseName = p;
    this.dance = dance;
  }

  // ================================================================== the barge
  private chooseBargeSpot(p0: THREE.Vector3) {
    const w = this.ctx.world;
    const wl = w.sa.waterLevel;
    const toPl = Math.atan2(this.player.pos.x - p0.x, this.player.pos.z - p0.z);
    const deep = (x: number, z: number) => wl > -100 && w.sa.field.heightSmooth(x, z) < wl - 0.35;
    if (wl > -100) {
      let best: { x: number; z: number; yaw: number; score: number } | null = null;
      for (let r = 0; r <= 34; r += 4)
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * TAU;
          const x = p0.x + Math.sin(ang) * r, z = p0.z + Math.cos(ang) * r;
          if (!deep(x, z) || w.storm.sdf(x, z) < 10) continue;
          for (let y = 0; y < 8; y++) {
            const yaw = (y / 8) * Math.PI;
            let ok = 0;
            for (let s = -8; s <= 8; s += 2) if (deep(x + Math.sin(yaw) * s, z + Math.cos(yaw) * s)) ok++;
            const score = ok * 10 - r * 0.6 - Math.hypot(x - this.player.pos.x, z - this.player.pos.z) * 0.05;
            if (ok >= 8 && (!best || score > best.score)) best = { x, z, yaw, score };
          }
        }
      if (best) return { anchor: new THREE.Vector3(best.x, wl, best.z), yaw: best.yaw, water: true };
    }
    // no river here: the barge sails the sand on its own light
    const back = new THREE.Vector3(p0.x - Math.sin(toPl) * 7, 0, p0.z - Math.cos(toPl) * 7);
    return { anchor: back, yaw: toPl + Math.PI / 2, water: false };
  }
  private spawnBarge(geo: RigGeo, at: THREE.Vector3, yaw: number, water: boolean, anchor: THREE.Vector3) {
    const rig = new RigInstance(geo, { ownMaterial: true });
    rig.material.userData.emissiveStrength.value = 1.3;
    this.ctx.scene.add(rig.root);
    this.barge = { rig, pos: at.clone(), y: 0, yaw, water, anchor: anchor.clone(), t: 0, sink: 0, fire: 0 };
    // silk curtains on the pavilion and two long pennants at the stern
    for (const sd of ['l', 'r']) {
      const c = new Silk({ w: 8, h: 8, width: 3.2, length: 2.2, stiffness: 0.85, drag: 2.2, gravity: 7, thickness: 0.02 }, { main: 0xfbf4e6, alt: 0xf0e0c0, trim: 0xe0b048, glow: 0.12, pattern: 'panel' });
      c.cloth.groundAt = (x, z) => this.ctx.world.groundAt(x, z);
      this.silkR.add(c);
      this.bargeSilk.push(c);
      const p = new Cloth({ w: 3, h: 14, width: 0.42, length: 3.4, colors: [0xc02a3a, 0x8a1a2a, 0xe0b048], pattern: 'flag', fray: 0.3, stiffness: 0.8, drag: 2.6, gravity: 4 });
      p.groundAt = (x, z) => this.ctx.world.groundAt(x, z);
      this.d.cloth.add(p);
      this.bargeCloth.push(p);
      void sd;
    }
  }
  private updateBarge(dt: number) {
    const B = this.barge;
    if (!B) return;
    B.t += dt;
    const r = B.rig;
    // afloat where the river runs under the hull, else sailing the sand on its own light
    const w = this.ctx.world;
    const wet = w.sa.waterLevel > -100 && w.sa.field.heightSmooth(B.pos.x, B.pos.z) < w.sa.waterLevel - 0.2;
    const gT = wet ? w.sa.waterLevel - 0.18 : this.surface(B.pos.x, B.pos.z) + 0.65;
    B.y = B.t < 0.05 ? gT : damp(B.y, gT, 3, dt);
    const g = B.y;
    const bob = Math.sin(B.t * 0.8) * 0.06;
    r.root.position.set(B.pos.x, g + bob - B.sink, B.pos.z);
    r.root.rotation.set(Math.sin(B.t * 0.55) * 0.015 + B.sink * 0.05, B.yaw, Math.sin(B.t * 0.7 + 1) * 0.02 - B.sink * 0.08, 'YXZ');
    // the oars row on their own, slow and stately; the fans sway
    const row = B.t * 1.6;
    for (let i = 1; i <= 6; i++)
      for (const [sd, s] of [['l', 1], ['r', -1]] as [string, number][]) {
        const n = r.nodes[`oar_${sd}${i}`];
        if (!n) continue;
        const p = row + i * 0.15;
        n.rotation.set(0, s * Math.sin(p) * 0.35, s * (Math.cos(p) * 0.12 - 0.04));
      }
    for (const [sd, s] of [['l', 1], ['r', -1]] as [string, number][]) {
      const f = r.nodes['fan_' + sd];
      if (f) f.rotation.set(Math.sin(B.t * 1.1 + s) * 0.08, 0, s * Math.sin(B.t * 0.9) * 0.12);
    }
    r.root.updateMatrixWorld(true);
    // curtains along the pavilion sides, pennants off the stern poles
    const wind = this.ctx.world.sa.wind;
    const sk = r.sockets;
    for (let i = 0; i < this.bargeSilk.length; i++) {
      const sd = i === 0 ? 'l' : 'r';
      const a = sk['curtain_f' + sd]?.getWorldPosition(_a), b = sk['curtain_b' + sd]?.getWorldPosition(_b);
      if (a && b) this.bargeSilk[i].pinLine(a, b);
      this.bargeSilk[i].cloth.wind.set(wind.x * 3, 0.3, wind.z * 3);
    }
    for (let i = 0; i < this.bargeCloth.length; i++) {
      const s = sk[i === 0 ? 'pennant_l' : 'pennant_r'];
      if (!s) continue;
      s.getWorldPosition(_a);
      const c = this.bargeCloth[i];
      c.anchors.forEach((p, k) => p.copy(_a).add(_w.set(0, -k * 0.1, 0)));
      c.wind.set(wind.x * 5 + 3, 0.6, wind.z * 5 + 1);
    }
    // fire bowls and, after she falls, the burning hull
    if (rnd.chance(0.5)) {
      for (const k of ['brazier_l', 'brazier_r']) {
        const s = sk[k]?.getWorldPosition(_a);
        if (s) this.ctx.particles.emit({ pos: { x: s.x, y: s.y, z: s.z }, count: 1, vel: { x: 0, y: 1.6, z: 0 }, spread: 0.3, life: [0.35, 0.6], size: [0.35, 0.1], sprite: ['flame0', 'flame1', 'flame2'], color: [0xffd070, 0xff9a30, 0xff6020], additive: true, animate: true });
      }
    }
    if (!wet && rnd.chance(0.3)) this.shots.mote(B.pos.x + (rnd.next() - 0.5) * 3, g - 0.6, B.pos.z + (rnd.next() - 0.5) * 3, 0, 0.5, 0, { life: 0.8, size: 0.4, color: 0xffc860 });
    if (B.fire > 0) {
      for (let i = 0; i < 3; i++) {
        const l = (rnd.next() - 0.5) * 13;
        const x = B.pos.x + Math.sin(B.yaw) * l, z = B.pos.z + Math.cos(B.yaw) * l;
        this.ctx.particles.emit({ pos: { x, y: g + 1 - B.sink, z }, count: 1, vel: { x: 0, y: 2.4, z: 0 }, spread: 0.8, life: [0.5, 0.9], size: [0.9, 0.2], sprite: ['flame0', 'flame1', 'flame2'], color: [0xffd070, 0xff8a30, 0xff4a10], additive: true, animate: true });
        if (rnd.chance(0.3)) this.ctx.particles.emit({ pos: { x, y: g + 2 - B.sink, z }, count: 1, vel: { x: wind.x, y: 2, z: wind.z }, spread: 0.5, life: [1.5, 2.5], size: [1, 3], sprite: ['cloud0', 'cloud1'], color: [0x3a2a24, 0x5a4a40], alpha: 0.7, drag: 0.8 });
      }
    }
    // the hunter cannot ride through the hull
    const pl = this.player;
    const lx = pl.pos.x - B.pos.x, lz = pl.pos.z - B.pos.z;
    const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
    const along = lx * fx + lz * fz, across = lx * fz - lz * fx;
    if (Math.abs(along) < 7.4 && Math.abs(across) < 1.9 * Math.sqrt(Math.max(0, 1 - (along / 7.6) ** 2)) + 0.4 && pl.pos.y < g + 1.4) {
      const s = Math.sign(across) || 1;
      pl.board.impulse.add(_w.set(fz * s * 30 * dt, 0, -fx * s * 30 * dt));
    }
  }

  // ================================================================== intro: the golden barge on a rain of petals
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    this.radius = -50;
    const p0 = this.pos.clone();
    const spot = this.chooseBargeSpot(p0);
    const fwd = new THREE.Vector3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
    // sail in along the river, toward the side nearer the hunter
    const toPl = _a.set(this.player.pos.x - spot.anchor.x, 0, this.player.pos.z - spot.anchor.z);
    if (toPl.dot(fwd) < 0) fwd.negate();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const start = spot.anchor.clone().addScaledVector(fwd, -44);
    const pp = this.player.pos;
    const camPos = new THREE.Vector3(pp.x - fwd.z * 3 + (pp.x - spot.anchor.x) * 0.15, 0, pp.z + fwd.x * 3 + (pp.z - spot.anchor.z) * 0.15);
    camPos.y = this.surface(camPos.x, camPos.z) + 3.2;
    const look = start.clone().setY(this.surface(start.x, start.z) + 3);
    cam.setCine({ pos: camPos, look, fov: 50 });
    ctx.sfx('divine_whisper', null, 0.9, 0.8);
    ctx.sfx('wave_start', null, 0.5, 0.6);
    this.envTo = 'golden';
    this.envT = 0.6;
    // wait for the hull to be carved (petals already fall)
    const petalsAt = (c: THREE.Vector3, r: number, n: number) => {
      for (let i = 0; i < n; i++) this.shots.petal(c.x + (rnd.next() - 0.5) * r * 2, c.y + 6 + rnd.next() * 5, c.z + (rnd.next() - 0.5) * r * 2, (rnd.next() - 0.5) * 2, -0.5, (rnd.next() - 0.5) * 2, 7);
    };
    await this.waitFor(() => {
      petalsAt(start, 10, 3);
      return !!courtGeo('cleo_barge');
    }, 9);
    this.spawnBarge(this.courtNow('cleo_barge'), start, yaw, spot.water, spot.anchor);
    ctx.sfx('divine_chime', start, 1, 0.7);
    // she sits enthroned; the court arrives as each rig is carved
    const glide = 7.0;
    let t = 0;
    let shot = 0;
    while (t < glide || !this.geo) {
      const k = clamp(t / glide, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.barge!.pos.lerpVectors(start, spot.anchor, e);
      if (!this.geo && courtGeo('cleopatra')) this.adopt(courtGeo('cleopatra')!);
      if (!this.geo && t > glide + 6) this.adopt(this.courtNow('cleopatra'));
      if (this.geo && !this.root.visible) {
        this.root.visible = true;
        this.seated = true;
        this.setPose('seated', 0.15);
        this.glowT = 0.4;
        this.spawnDancers();
      }
      if (!this.guards.length && (courtGeo('cleo_guard') || t > glide + 4)) this.spawnGuards(true);
      if (!this.lions.length && (courtGeo('cleo_lion') || t > glide + 4)) this.spawnLions(true);
      // the barge's petal storm
      const bp = this.barge!.pos;
      petalsAt(_b.set(bp.x, this.surface(bp.x, bp.z), bp.z), 9, 2);
      // shots: wide from the bank, then low along the gilded hull, then onto the pavilion
      const cam1 = k < 0.4 ? 0 : k < 0.75 ? 1 : 2;
      if (cam1 !== shot || t === 0) shot = cam1;
      const hull = this.barge!.rig.root;
      if (shot === 0) {
        look.lerp(_a.set(bp.x, this.surface(bp.x, bp.z) + 2.5, bp.z), 0.08);
        cam.setCine({ pos: camPos, look, fov: 46 });
      } else if (shot === 1) {
        hull.localToWorld(_a.set(5.5, 1.2, 6 - (k - 0.4) * 10));
        _a.y = Math.max(_a.y, this.surface(_a.x, _a.z) + 0.8);
        camPos.lerp(_a, 0.1);
        hull.localToWorld(_b.set(0, 2.2, 1));
        look.lerp(_b, 0.12);
        cam.setCine({ pos: camPos, look, fov: 44 });
      } else {
        hull.localToWorld(_a.set(2.6, 2.6, 6.5));
        camPos.lerp(_a, 0.06);
        hull.localToWorld(_b.set(0, 2.4, -0.6));
        look.lerp(_b, 0.1);
        cam.setCine({ pos: camPos, look, fov: 38 });
      }
      await this.wait(0.05);
      t += 0.05;
    }
    // she rises from the throne: the veil lifts, the light swells, the disc ignites
    const hull = this.barge!.rig.root;
    ctx.sfx('divine_power', this.pos, 1, 0.75);
    this.seated = false;
    this.setPose('open', 0.2);
    this.hoverT = 0.5;
    this.glowT = 1.6;
    this.raySpin = 2.5;
    ctx.events.emit('bossIntro', this);
    for (let i = 0; i < 30; i++) {
      hull.localToWorld(_a.set(1.6, 2.6, 4.8));
      camPos.lerp(_a, 0.08);
      this.heart(_b);
      look.lerp(_b.add(_w.set(0, 0.5, 0)), 0.15);
      cam.setCine({ pos: camPos, look, fov: 34 });
      await this.wait(0.05);
    }
    this.taunt('Kneel, little shadow. The sun has come to dance upon your grave.');
    this.setPose('spin', 0.6);
    // she floats out over the prow toward the hunter
    const out = this.arenaPoint(new THREE.Vector3());
    const from = this.pos.clone();
    for (let i = 0; i < 44; i++) {
      const k = i / 43, e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(from, out, e);
      this.hoverT = 0.5 + e * 1.2;
      if (i === 12) {
        for (const dz of this.dancers) this.burstPetals(dz.root.position, 30);
        for (const dz of this.dancers) dz.root.removeFromParent();
        this.dancers = [];
        ctx.sfx('divine_chime', this.pos, 0.8, 1.2);
      }
      if (i === 20) this.releaseCourt();
      this.heart(_b);
      look.lerp(_b, 0.12);
      _a.copy(_b).add(_w.set(Math.sin(yaw + 1.2) * 7, 1.2, Math.cos(yaw + 1.2) * 7));
      _a.y = Math.max(_a.y, this.surface(_a.x, _a.z) + 1.4);
      camPos.lerp(_a, 0.06);
      cam.setCine({ pos: camPos, look, fov: 44 });
      await this.wait(0.05);
    }
    this.setPose('idle', 0.4);
    await this.wait(0.6);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
    this.radius = 0.55;
    this.glowT = 1;
    this.raySpin = 0.4;
    for (const g of this.guards) g.register();
    for (const l of this.lions) l.register();
    this.ctx.toast('HER RAMS GUARD HER', '#ffd36b', 'Break the Rams of Amun to break her sun ward');
  }
  /** a hover point between the barge and the hunter */
  private arenaPoint(out: THREE.Vector3) {
    const B = this.barge;
    const c = B ? B.anchor : this.pos;
    const dx = this.player.pos.x - c.x, dz = this.player.pos.z - c.z, d = Math.hypot(dx, dz) || 1;
    const r = Math.min(9, d * 0.5);
    out.set(c.x + (dx / d) * r, 0, c.z + (dz / d) * r);
    out.y = this.surface(out.x, out.z);
    return out;
  }
  private spawnDancers() {
    const B = this.barge;
    if (!B || !this.geo) return;
    for (let i = 0; i < 4; i++) {
      const r = new RigInstance(this.geo, { material: this.mirageMat, castShadow: false });
      r.root.scale.setScalar(0.58);
      this.ctx.scene.add(r.root);
      this.dancers.push(r);
    }
  }
  private updateDancers(dt: number) {
    const B = this.barge;
    if (!B || !this.dancers.length) return;
    const s = B.rig.sockets['prow_deck'];
    if (!s) return;
    s.getWorldPosition(_a);
    const t = this.t;
    this.dancers.forEach((r, i) => {
      const a = t * 0.9 + (i / this.dancers.length) * TAU;
      r.root.position.set(_a.x + Math.sin(a) * 0.9, _a.y + 0.05 + Math.sin(t * 3 + i) * 0.05, _a.z + Math.cos(a) * 0.9);
      r.root.rotation.y = a + Math.PI / 2 + t * 2;
      const n = r.nodes;
      const w = t * 3 + i;
      n['arm_l']?.rotation.set(-0.3, 0, 2.2 + Math.sin(w) * 0.5);
      n['arm_r']?.rotation.set(-0.3, 0, -1.3 - Math.sin(w + 1) * 0.4);
      n['fore_l']?.rotation.set(0, 0, 0.6 + Math.sin(w + 2) * 0.3);
      n['fore_r']?.rotation.set(0, 0, -0.4);
      n['torso']?.rotation.set(-0.05, 0, Math.sin(w) * 0.12);
      n['skirt_lo']?.scale.set(1.18, 0.94, 1.18);
    });
    void dt;
  }

  // ================================================================== the court
  private spawnGuards(onDeck: boolean) {
    const g = this.courtNow('cleo_guard');
    for (const side of [1, -1]) {
      const gd = new RoyalGuard(this.courtD, g, side, this.tier);
      gd.scripted = true;
      gd.state = 'deck';
      if (!onDeck) gd.root.visible = true;
      this.guards.push(gd);
    }
  }
  private spawnLions(onDeck: boolean, extra = false) {
    const keys = extra ? ['cleo_lioness'] : ['cleo_lion', 'cleo_lioness'];
    for (const k of keys) {
      const l = new TamedLion(this.courtD, this.courtNow(k), k === 'cleo_lion', this.tier);
      l.scripted = true;
      l.state = 'deck';
      this.lions.push(l);
      void onDeck;
    }
  }
  /** keep the scripted court on its deck spots */
  private updateCourtOnDeck() {
    const B = this.barge;
    if (!B) return;
    const sk = B.rig.sockets;
    const put = (a: { pos: THREE.Vector3; yaw: number }, s: string, yawOff: number) => {
      const k = sk[s];
      if (!k) return;
      k.getWorldPosition(a.pos);
      a.yaw = B.yaw + yawOff;
    };
    this.guards.forEach((g, i) => g.scripted && g.state === 'deck' && put(g, i % 2 ? 'deck_fr' : 'deck_fl', 0));
    this.lions.forEach((l, i) => l.scripted && l.state === 'deck' && put(l, i % 2 ? 'deck_br' : 'deck_bl', i % 2 ? -0.5 : 0.5));
  }
  /** the rams and lions leap ashore */
  private releaseCourt() {
    const c = this.arenaPoint(new THREE.Vector3());
    const dx = this.player.pos.x - c.x, dz = this.player.pos.z - c.z, d = Math.hypot(dx, dz) || 1;
    const fx = dx / d, fz = dz / d;
    this.guards.forEach((g, i) => {
      if (g.state !== 'deck') return;
      const s = i % 2 ? -1 : 1;
      const to = new THREE.Vector3(c.x + fx * 3.5 - fz * s * 2.5, 0, c.z + fz * 3.5 + fx * s * 2.5);
      to.y = this.surface(to.x, to.z);
      g.leap(to);
      this.ctx.sfx('whoosh_big', g.pos, 0.7, 0.8);
    });
    this.lions.forEach((l, i) => {
      if (l.state !== 'deck') return;
      const s = i % 2 ? -1 : 1;
      const to = new THREE.Vector3(c.x + fx * 6 - fz * s * 5, 0, c.z + fz * 6 + fx * s * 5);
      to.y = this.surface(to.x, to.z);
      this.ctx.engine.tweens.after(0.25 * i, () => l.leapTo(to));
    });
  }
  private updateCourt(dt: number) {
    this.updateCourtOnDeck();
    for (const a of [...this.guards, ...this.lions]) a.update(dt);
    // the fallen dissolve and leave
    for (const arr of [this.guards, this.lions] as (RoyalGuard | TamedLion)[][])
      for (let i = arr.length - 1; i >= 0; i--)
        if (arr[i].gone) {
          arr[i].dispose();
          arr.splice(i, 1);
        }
  }

  // ================================================================== fight loop
  protected async fight() {
    this.envTo = 'golden';
    while (true) {
      this.check();
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      const p = this.phase, r = rnd.next(), d = this.distToPlayer();
      let pick: string;
      if (d > 34) pick = 'glide';
      else if (p === 0) pick = r < 0.32 ? 'something' : r < 0.58 ? 'universe' : r < 0.84 ? 'prudence' : 'beast';
      else if (p === 1) pick = r < 0.2 ? 'something' : r < 0.36 ? 'universe' : r < 0.5 ? 'prudence' : r < 0.66 ? 'rainbow' : r < 0.8 && this.cds.strawberry <= 0 ? 'strawberry' : r < 0.92 && this.cds.swarm <= 0 ? 'goldenSlumbers' : 'beast';
      else pick = r < 0.15 ? 'something' : r < 0.29 ? 'universe' : r < 0.43 ? 'goodDay' : r < 0.57 ? 'rainbow' : r < 0.68 && this.cds.strawberry <= 0 ? 'strawberry' : r < 0.8 && this.cds.swarm <= 0 ? 'goldenSlumbers' : r < 0.92 ? 'prudence' : 'beast';
      if (pick === this.lastAttack && pick !== 'glide') pick = pick === 'something' ? 'prudence' : 'something';
      await this.run(pick);
      await this.glide(p >= 2 ? 0.7 : 1.1);
    }
  }
  private async run(name: string) {
    this.lastAttack = name;
    switch (name) {
      case 'something':
        return this.something();
      case 'universe':
        return this.universe();
      case 'prudence':
        return this.prudence();
      case 'rainbow':
        return this.rainbow();
      case 'strawberry':
        return this.strawberry();
      case 'goldenSlumbers':
        return this.goldenSlumbers();
      case 'goodDay':
        return this.goodDay();
      case 'beast':
        return this.beast();
      case 'letItBleed':
        return this.letItBleed();
      case 'reinforce':
        return this.reinforce();
      default:
        return this.glide(1);
    }
  }
  /** dev/test: queue an attack (something, universe, prudence, rainbow, strawberry, goldenSlumbers, goodDay, beast, letItBleed, reinforce) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  /** a graceful reposition: she drifts to a new mark near her barge, dancing softly */
  private async glide(dur: number) {
    this.setPose('idle', 0.6);
    this.hoverT = 1.6;
    const B = this.barge;
    const c = B ? B.anchor : this.pos;
    const pl = this.player.pos;
    const a = Math.atan2(this.pos.x - pl.x, this.pos.z - pl.z) + (rnd.next() - 0.5) * 1.4;
    const r = 10 + rnd.next() * 5;
    let x = pl.x + Math.sin(a) * r, z = pl.z + Math.cos(a) * r;
    const dc = Math.hypot(x - c.x, z - c.z);
    if (dc > 26) {
      x = c.x + ((x - c.x) / dc) * 26;
      z = c.z + ((z - c.z) / dc) * 26;
    }
    await this.moveTo(x, z, 7, Math.max(0.6, dur + 0.8));
    this.stop();
  }

  // ------------------------------------------------------------------ Something: the silk dance
  private async something() {
    this.callout('Something');
    if (rnd.chance(0.4)) this.say(['Something in the way I move...', 'Dance with me.', 'Watch the silk, not the queen.']);
    this.setPose('spin', 0.5);
    this.hoverT = 1.9;
    this.glowT = 1.4;
    this.ctx.sfx('divine_chime', this.pos, 0.9, 1.15);
    for (const k of ['sleeve_l', 'sleeve_r']) if (this.silks[k]) this.silks[k].glowMul = 2.2;
    await this.wait(0.75);
    let dir = rnd.chance(0.5) ? 1 : -1;
    const dur = 3.4 + this.phase * 0.5;
    const rate = 0.085;
    let t = 0, acc = 0, flipped = false;
    while (t < dur) {
      this.spinTarget = dir * (5.0 + this.phase * 0.5);
      acc += 0.05;
      while (acc >= rate) {
        acc -= rate;
        const lane = (t % 0.56) < 0.38;
        if (!lane) continue;
        for (const k of ['sleeve_l', 'sleeve_r']) {
          const s = this.silks[k];
          if (!s) continue;
          s.tip(2, _a);
          const rx = _a.x - this.pos.x, rz = _a.z - this.pos.z, rl = Math.hypot(rx, rz) || 1;
          const tx = (-rz / rl) * dir, tz = (rx / rl) * dir;
          this.shots.fire('sun', _a.x, _a.y, _a.z, (rx / rl) * 7.2 + tx * 1.4, (rz / rl) * 7.2 + tz * 1.4, { dmg: 14 });
        }
        if (this.phase >= 1 && rnd.chance(0.35)) {
          const a = rnd.next() * TAU;
          this.shots.fire('petal', this.pos.x, this.pos.y + 0.8, this.pos.z, Math.sin(a) * 4.5, Math.cos(a) * 4.5, { dmg: 10, turn: dir * 0.4 });
        }
      }
      if (this.phase >= 1 && !flipped && t > dur * 0.5) {
        flipped = true;
        dir = -dir;
        this.ctx.sfx('whoosh', this.pos, 0.8, 1.3);
      }
      if (rnd.chance(0.4)) this.shots.petal(this.pos.x, this.pos.y + 1.2, this.pos.z, (rnd.next() - 0.5) * 6, 1.5, (rnd.next() - 0.5) * 6, 4);
      await this.wait(0.05);
      t += 0.05;
    }
    this.spinTarget = 0;
    for (const k of ['sleeve_l', 'sleeve_r']) if (this.silks[k]) this.silks[k].glowMul = 1;
    this.setPose('bow', 0.2);
    this.glowT = 1;
    await this.wait(0.6);
    this.setPose('idle', 0.4);
  }

  // ------------------------------------------------------------------ Sun King: the mandala
  private async universe() {
    this.callout('Across the Universe');
    if (rnd.chance(0.4)) this.say(['Behold the sun at noon.', 'Every ring a door. Find one.']);
    this.stop();
    this.setPose('open', 0.15);
    this.hoverT = 2.8;
    this.raySpin = 3;
    this.glowT = 1.7;
    this.ctx.sfx('divine_power', this.pos, 0.9, 1.0);
    await this.wait(0.5);
    const rings = 4 + this.phase;
    const n = 26 + this.phase * 2;
    const cx = this.pos.x, cz = this.pos.z, cy = this.pos.y + 1.7;
    for (let r = 0; r < rings; r++) {
      const ph = rnd.next() * TAU;
      const gaps = [0, 1, 2].map((g) => Math.round((g / 3) * n + rnd.next() * 2));
      this.shots.ring(cx, cy, cz, n, 1.4 + r * 0.12, 6.0, (r % 2 ? 0.55 : -0.55) * (1 + this.phase * 0.15), { kind: r === rings - 1 ? 'sun' : r % 2 ? 'sunS' : 'sun', delay: 1.0 + r * 0.45, gaps, gapW: 1.6, phase: ph, dmg: 13, life: 8 });
    }
    for (let i = 0; i < 6; i++) {
      this.shots.petal(cx, cy, cz, (rnd.next() - 0.5) * 5, 2, (rnd.next() - 0.5) * 5, 5);
    }
    await this.wait(1.0 + rings * 0.45);
    if (this.phase >= 1) {
      this.setPose('point', 0.1);
      for (let v = 0; v < 3; v++) {
        const from = this.palm(1, _a).clone();
        const a0 = Math.atan2(this.player.pos.x - from.x, this.player.pos.z - from.z);
        for (let i = -2; i <= 2; i++) this.shots.fire('ray', from.x, from.y, from.z, Math.sin(a0 + i * 0.16) * 13, Math.cos(a0 + i * 0.16) * 13, { dmg: 12, life: 4 });
        this.ctx.sfx('enemy_shot', from, 0.6, 1.4);
        await this.wait(0.35);
      }
    }
    await this.wait(0.5);
    this.raySpin = 0.4;
    this.glowT = 1;
    this.hoverT = 1.6;
    this.setPose('idle', 0.4);
  }

  // ------------------------------------------------------------------ November Rain: sunlight lances
  private async prudence() {
    this.callout('Dear Prudence');
    if (rnd.chance(0.4)) this.say(['Let the sky fall on you.', 'Light, falling like rain.']);
    this.setPose('sky', 0.2);
    this.glowT = 1.4;
    await this.wait(0.4);
    const n = 6 + this.phase * 2;
    for (let i = 0; i < n; i++) {
      const p = this.predicted(0.85).add(_w.set((rnd.next() - 0.5) * 4.4, 0, (rnd.next() - 0.5) * 4.4));
      void this.lance(p).catch(() => {});
      await this.wait(0.32 - this.phase * 0.04);
    }
    await this.wait(1.1);
    this.glowT = 1;
    this.setPose('idle', 0.4);
  }
  private async lance(at: THREE.Vector3) {
    const ctx = this.ctx;
    const g = this.surface(at.x, at.z);
    const R = 1.7;
    for (let s = 0; s < 5; s++) {
      ctx.fx.ring({ x: at.x, y: g + 0.15, z: at.z }, 0xffc040, R * 2, 0.3);
      for (let k = 0; k < 3; k++) this.shots.mote(at.x + (rnd.next() - 0.5) * 0.6, g + 6 + rnd.next() * 10, at.z + (rnd.next() - 0.5) * 0.6, 0, -18, 0, { life: 0.5, size: 0.22, color: 0xfff0b0 });
      await this.wait(0.18);
    }
    // the lance strikes
    for (let k = 0; k < 14; k++) this.shots.mote(at.x, g + k * 1.4, at.z, 0, -6, 0, { life: 0.25 + k * 0.02, size: 0.9, color: 0xffd070, sprite: 'halo' });
    this.shots.burst(at.x, g + 0.5, at.z, 0xfff0b0, 14);
    ctx.fx.light({ x: at.x, y: g + 1.5, z: at.z }, 0xffc060, 6, 0.25, 10);
    ctx.fx.ring({ x: at.x, y: g + 0.2, z: at.z }, 0xfff0c0, R * 2.4, 0.35);
    ctx.fx.sandBurst({ x: at.x, y: g, z: at.z }, 0.8);
    ctx.events.emit('groundMark', at.x, at.z, R * 0.8, 1);
    ctx.sfx('thunder', { x: at.x, y: g, z: at.z }, 0.35, 1.6);
    ctx.sfx('explosion', { x: at.x, y: g, z: at.z }, 0.45, 1.3);
    const pl = this.player;
    if (pl.alive && Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < R && pl.pos.y < g + 2.5) pl.takeHit({ base: 24, kind: 'magic', source: 'contact', knock: 10, status: [{ id: 'burn', stacks: 2, dur: 3 }] }, new THREE.Vector3(at.x, g, at.z));
    if (this.phase >= 1) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rnd.next() * 0.3;
      this.shots.fire('sunS', at.x, g + 1, at.z, Math.sin(a) * 5, Math.cos(a) * 5, { dmg: 10, life: 4 });
    }
  }

  // ------------------------------------------------------------------ Shine a Light: the sweeping sunbeam
  private async rainbow() {
    this.callout("She's a Rainbow");
    if (rnd.chance(0.5)) this.say(['Look upon me.', 'There is nowhere the sun does not reach.']);
    this.stop();
    this.setPose('push', 0.1);
    this.hoverT = 2.3;
    this.glowT = 1.9;
    this.raySpin = 6;
    this.ctx.sfx('ult_activate', this.pos, 0.7, 0.8);
    const dir = rnd.chance(0.5) ? 1 : -1;
    const base = Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
    const twin = this.phase >= 2;
    const starts = twin ? [base, base] : [base - dir * 1.05];
    // the charge: light gathers into the disc; the opening line glows on the sand
    for (let t = 0; t < 1.0; t += 0.05) {
      this.disc(_a);
      for (let k = 0; k < 2; k++) {
        const r = 2 + rnd.next() * 2, a = rnd.next() * TAU;
        this.shots.mote(_a.x + Math.sin(a) * r, _a.y + (rnd.next() - 0.5) * 2, _a.z + Math.cos(a) * r, -Math.sin(a) * r * 3, 0, -Math.cos(a) * r * 3, { life: 0.33, size: 0.25, color: 0xffd070, drag: 0 });
      }
      for (const a0 of starts)
        if (rnd.chance(0.6)) {
          const s = 5 + rnd.next() * 26;
          const x = this.pos.x + Math.sin(a0) * s, z = this.pos.z + Math.cos(a0) * s;
          this.shots.mote(x, this.surface(x, z) + 0.2, z, 0, 0.8, 0, { life: 0.4, size: 0.4, color: 0xff8a30, sprite: 'glyph' });
        }
      await this.wait(0.05);
    }
    this.ctx.sfx('divine_power', this.pos, 1, 1.2);
    this.ctx.shake(0.25);
    const dur = 2.4;
    const from = () => this.disc(new THREE.Vector3());
    if (twin) {
      this.shots.beam({ cx: this.pos.x, cz: this.pos.z, ang: base, sweep: 1.0, dur, from, width: 1.1, dmg: 24 });
      this.shots.beam({ cx: this.pos.x, cz: this.pos.z, ang: base, sweep: -1.0, dur, from, width: 1.1, dmg: 24 });
    } else this.shots.beam({ cx: this.pos.x, cz: this.pos.z, ang: starts[0], sweep: (dir * 2.1) / dur, dur, from, width: 1.15, dmg: 24 });
    for (let t = 0; t < dur; t += 0.1) {
      if (rnd.chance(0.5)) this.ctx.shake(0.08);
      await this.wait(0.1);
    }
    this.glowT = 1;
    this.raySpin = 0.4;
    this.hoverT = 1.6;
    this.setPose('idle', 0.4);
    await this.wait(0.4);
  }

  // ------------------------------------------------------------------ Lucy in the Sky with Diamonds: mirages
  private async strawberry() {
    if (!this.geo) return;
    this.callout('Strawberry Fields Forever');
    this.say(['Which of us is the sun?', 'Look for the one who bleeds roses.']);
    this.cds.strawberry = 16;
    this.setPose('spin', 0.6);
    this.spinTarget = 7;
    await this.wait(0.7);
    const pl = this.player.pos;
    const k = 2 + this.phase;
    const base = Math.atan2(this.pos.x - pl.x, this.pos.z - pl.z);
    const slots: THREE.Vector3[] = [];
    for (let i = 0; i <= k; i++) {
      const a = base + (i / (k + 1)) * TAU;
      const p = new THREE.Vector3(pl.x + Math.sin(a) * 11, 0, pl.z + Math.cos(a) * 11);
      p.y = this.surface(p.x, p.z);
      slots.push(p);
    }
    const real = Math.floor(rnd.next() * slots.length);
    this.burstPetals(this.pos, 40);
    this.ctx.sfx('smoke_bomb', this.pos, 0.6, 1.4);
    this.pos.copy(slots[real]);
    this.burstPetals(this.pos, 30);
    this.spinTarget = 0;
    for (let i = 0; i < slots.length; i++) {
      if (i === real) continue;
      const m = new Mirage(this, this.geo, this.mirageMat);
      m.pos.copy(slots[i]);
      this.mirages.push(m);
      this.d.enemies.registerExternal(m as any);
      this.burstPetals(m.pos, 20);
    }
    this.setPose('open', 0.8);
    const dur = 6.5;
    for (let t = 0; t < dur; t += 0.05) {
      const all: THREE.Vector3[] = [this.pos, ...this.mirages.filter((m) => m.alive).map((m) => m.pos)];
      for (const m of this.mirages) {
        if (!m.alive) continue;
        m.fireT += 0.05;
        if (m.fireT > 1.25) {
          m.fireT = 0;
          this.diamondFan(m.pos);
        }
      }
      if (Math.floor(t / 1.25) !== Math.floor((t - 0.05) / 1.25)) this.diamondFan(this.pos);
      // only the real queen sheds petals
      if (rnd.chance(0.5)) this.shots.petal(this.pos.x + (rnd.next() - 0.5), this.pos.y + 1.5, this.pos.z + (rnd.next() - 0.5), (rnd.next() - 0.5) * 2, -0.3, (rnd.next() - 0.5) * 2, 3);
      void all;
      await this.wait(0.05);
    }
    for (const m of this.mirages) if (m.alive) this.popMirage(m, undefined, true);
    this.setPose('idle', 0.4);
  }
  private diamondFan(from: THREE.Vector3) {
    const y = from.y + 2.0;
    const a0 = Math.atan2(this.player.pos.x - from.x, this.player.pos.z - from.z);
    for (let i = -2; i <= 2; i++) this.shots.fire('diamond', from.x, y, from.z, Math.sin(a0 + i * 0.14) * 9.5, Math.cos(a0 + i * 0.14) * 9.5, { dmg: 12, life: 4 });
    this.ctx.sfx('gem_chime', from, 0.35, 1.2 + rnd.next() * 0.3);
  }
  popMirage(m: Mirage, at?: THREE.Vector3, quiet = false) {
    if (!m.alive) return;
    m.alive = false;
    this.d.enemies.unregisterExternal(m as any);
    const p = at ?? _a.set(m.pos.x, m.pos.y + 2, m.pos.z);
    this.burstPetals(m.pos, 18);
    this.shots.burst(p.x, p.y, p.z, 0xffe090, 14);
    if (!quiet) {
      this.ctx.sfx('glass_break', p, 0.6, 1.4);
      this.ctx.fx.number({ x: p.x, y: p.y + 0.5, z: p.z }, 'MIRAGE', 0xffe090, 0.9);
    }
    m.rig.root.removeFromParent();
  }
  private updateMirages(dt: number) {
    for (let i = this.mirages.length - 1; i >= 0; i--) {
      const m = this.mirages[i];
      if (!m.alive) {
        this.mirages.splice(i, 1);
        continue;
      }
      const g = this.surface(m.pos.x, m.pos.z);
      m.pos.y = g + this.hoverNow + Math.sin(this.t * 1.3 + m.ph) * 0.12;
      m.rig.root.position.copy(m.pos);
      m.rig.root.rotation.y = Math.atan2(this.player.pos.x - m.pos.x, this.player.pos.z - m.pos.z) + Math.sin(this.t * 2 + m.ph) * 0.3;
      // they mirror her dance
      for (const j of JOINTS) {
        const src = this.rig.nodes[j], dst = m.rig.nodes[j];
        if (src && dst) dst.rotation.copy(src.rotation);
      }
    }
    void dt;
  }

  // ------------------------------------------------------------------ Golden Slumbers: the scarab swarm
  private async goldenSlumbers() {
    const g0 = courtGeo('cleo_scarab0'), g1 = courtGeo('cleo_scarab1');
    if (!g0 || !g1) return this.prudence();
    if (!this.swarm) {
      this.swarm = new ScarabSwarm(this.ctx, this.player, [g0.parts[0].geo, g1.parts[0].geo]);
      this.swarm.onPop = (x, y, z) => {
        this.shots.burst(x, y, z, 0xffd060, 6);
        this.ctx.sfx('scarab_squish', { x, y, z }, 0.3, 1.5);
      };
    }
    this.callout('Golden Slumbers');
    this.say(['Sleep, little shadow. My scarabs will carry you.', 'Golden dreams.']);
    this.cds.swarm = 14;
    this.stop();
    this.setPose('cup', 0.15);
    this.glowT = 1.5;
    this.ctx.sfx('swarm_loop', this.pos, 0.8, 1.2);
    for (let t = 0; t < 0.9; t += 0.05) {
      for (const s of [0, 1] as const) {
        this.palm(s, _a);
        this.shots.mote(_a.x, _a.y, _a.z, (rnd.next() - 0.5) * 1.5, 1, (rnd.next() - 0.5) * 1.5, { life: 0.4, size: 0.3, color: 0xffc040 });
      }
      await this.wait(0.05);
    }
    this.swarm.setRegistered(true, (t) => this.d.enemies.registerExternal(t as any), (t) => this.d.enemies.unregisterExternal(t as any));
    this.setPose('open', 0.2);
    const per = 10 + this.phase * 3;
    const a0 = Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
    for (let i = 0; i < per; i++) {
      for (let st = 0; st < 3; st++) {
        const a = a0 + (st - 1) * 0.95;
        this.palm(st === 0 ? 0 : 1, _a);
        this.swarm.spawn(_a.x, _a.y, _a.z, Math.sin(a) * 7, 1.5, Math.cos(a) * 7, 1.1 + rnd.next() * 0.5, 5 + rnd.next());
      }
      await this.wait(0.11);
    }
    await this.wait(0.8);
    this.glowT = 1;
    this.setPose('idle', 0.4);
  }

  // ------------------------------------------------------------------ Good Day Sunshine: solar flares
  private async goodDay() {
    this.callout('Good Day Sunshine');
    this.say(['Bask.', 'Feel how warm I can be.']);
    this.setPose('raise', 0.3);
    this.glowT = 1.8;
    const n = 4 + this.phase;
    const c = this.predicted(0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd.next() * 0.4;
      const r = i === 0 ? 0 : 4.5 + rnd.next() * 1.5;
      const at = new THREE.Vector3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r);
      void this.flare(at, 0.9 + i * 0.12).catch(() => {});
    }
    await this.wait(1.9);
    this.glowT = 1;
    this.setPose('idle', 0.4);
  }
  private async flare(at: THREE.Vector3, warn: number) {
    await this.slam(at, 2.3, 26, warn, 'fire');
    const g = this.surface(at.x, at.z);
    this.ctx.particles.emit({ pos: { x: at.x, y: g, z: at.z }, count: 18, vel: { x: 0, y: 9, z: 0 }, spread: 2.5, life: [0.5, 1], size: [0.9, 0.2], sprite: ['flame0', 'flame1', 'flame2'], color: [0xfff0b0, 0xffb040, 0xff5a10], additive: true, animate: true, gravity: -2 });
    this.ctx.fx.light({ x: at.x, y: g + 2, z: at.z }, 0xff9a30, 5, 0.4, 12);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      this.shots.fire('sunS', at.x, g + 1, at.z, Math.sin(a) * 6, Math.cos(a) * 6, { dmg: 10, life: 4 });
    }
  }

  // ------------------------------------------------------------------ Welcome to the Jungle: the lions
  private async beast() {
    const live = this.lions.filter((l) => l.alive && !l.scripted);
    if (!live.length) return this.something();
    this.callout('Beast of Burden');
    this.say(['My children are hungry.', 'Sekhem. Fetch.', 'Bring him to me.']);
    this.setPose('point', 0.2);
    live.forEach((l, i) => this.ctx.engine.tweens.after(0.2 + i * 0.35, () => l.command('roar')));
    await this.wait(1.6);
    live.forEach((l, i) => this.ctx.engine.tweens.after(i * 0.4, () => l.command('pounce')));
    await this.wait(1.0);
    this.setPose('idle', 0.4);
  }

  // ------------------------------------------------------------------ Live and Let Die: the little sun
  private async letItBleed() {
    this.callout('Let It Bleed');
    this.taunt('If I must burn, the world burns with me!', '#ff8a40');
    this.cds.desperate = 999;
    this.desperateDone++;
    this.stop();
    this.invulnerable = true;
    this.setPose('raise', 0.2);
    this.hoverT = 5.5;
    this.glowT = 2.4;
    this.raySpin = 7;
    this.envTo = 'eclipse';
    this.envT = 0.9;
    this.ctx.sfx('divine_power', this.pos, 1, 0.6);
    this.ctx.shake(0.4);
    await this.wait(1.5);
    this.invulnerable = false;
    const dur = 9;
    for (let t = 0; t < dur; t += 0.1) {
      if (Math.floor(t / 2.4) !== Math.floor((t - 0.1) / 2.4)) {
        const cx = this.pos.x, cz = this.pos.z, cy = this.pos.y + 1.6;
        for (let r = 0; r < 3; r++) this.shots.ring(cx, cy, cz, 24, 1.6, 5, (r % 2 ? 0.45 : -0.45), { kind: 'sun', delay: 0.6 + r * 0.5, gaps: [Math.floor(rnd.next() * 24), Math.floor(rnd.next() * 24)], gapW: 2, phase: rnd.next() * TAU, dmg: 12, life: 8 });
      }
      if (Math.abs(t - 1.5) < 0.05 || Math.abs(t - 5.6) < 0.05) {
        const base = Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
        const from = () => this.disc(new THREE.Vector3());
        this.shots.beam({ cx: this.pos.x, cz: this.pos.z, ang: base + 0.9, sweep: -0.75, dur: 3, from, width: 1.0, dmg: 22 });
        this.shots.beam({ cx: this.pos.x, cz: this.pos.z, ang: base - 0.9, sweep: 0.75, dur: 3, from, width: 1.0, dmg: 22 });
        this.ctx.sfx('ult_activate', this.pos, 0.6, 0.9);
      }
      if (Math.floor(t / 1.8) !== Math.floor((t - 0.1) / 1.8) && t > 0.5) {
        const c = this.predicted(0.8);
        for (let i = 0; i < 3; i++) {
          const a = rnd.next() * TAU;
          void this.flare(new THREE.Vector3(c.x + Math.sin(a) * (i ? 4 : 0), 0, c.z + Math.cos(a) * (i ? 4 : 0)), 0.9).catch(() => {});
        }
      }
      if (rnd.chance(0.6)) {
        this.heart(_a);
        this.shots.mote(_a.x, _a.y, _a.z, (rnd.next() - 0.5) * 8, (rnd.next() - 0.3) * 8, (rnd.next() - 0.5) * 8, { life: 0.6, size: 0.3, color: 0xff9a30, sprite: 'ember', drag: 1 });
      }
      await this.wait(0.1);
    }
    // spent: she sinks, kneeling on the air, her heart laid open
    this.raySpin = 0.2;
    this.hoverT = 0.9;
    this.setPose('exhausted', 0);
    this.envTo = 'golden';
    this.envT = 0.6;
    this.exposed = true;
    this.glowT = 2.8;
    this.ctx.toast('HER HEART LIES OPEN', '#ffd36b', 'Strike the light in her chest');
    this.ctx.sfx('heartbeat', this.pos, 1, 0.8);
    await this.wait(4.5);
    this.exposed = false;
    this.glowT = 1.3;
    this.hoverT = 1.6;
    this.setPose('idle', 0.4);
    this.cds.desperate = 0;
  }

  /** fresh rams leap from the barge */
  private async reinforce() {
    if (this.guards.filter((g) => g.alive).length >= 2) return;
    this.say(['Rams of Amun! To your queen!', 'Guard me.']);
    this.setPose('raise', 0.2);
    const B = this.barge;
    const n = 2 - this.guards.filter((g) => g.alive).length;
    const geo = this.courtNow('cleo_guard');
    for (let i = 0; i < n; i++) {
      const gd = new RoyalGuard(this.courtD, geo, i ? -1 : 1, this.tier);
      if (B) {
        B.rig.sockets[i ? 'deck_fr' : 'deck_fl']?.getWorldPosition(gd.pos);
      } else gd.pos.copy(this.pos);
      const to = new THREE.Vector3(this.pos.x + (i ? -2.5 : 2.5), 0, this.pos.z + 2);
      to.y = this.surface(to.x, to.z);
      gd.leap(to);
      gd.register();
      this.guards.push(gd);
    }
    this.ctx.sfx('shield_up', this.pos, 1, 0.7);
    await this.wait(1.4);
    this.setPose('idle', 0.4);
  }

  // ================================================================== phases, damage, ward
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p === 1) {
      this.taunt('You dance well. Let us see you dance with diamonds.');
      this.queue.push('reinforce', 'strawberry');
      this.glowT = 1.3;
    } else if (p === 2) {
      this.taunt('My silk... burns? Then burn with me!', '#ff8a40');
      this.burnT = 0.45;
      this.glowT = 1.6;
      this.queue.push('letItBleed');
      if (this.lions.filter((l) => l.alive).length < 3) {
        this.spawnLions(false, true);
        const l = this.lions[this.lions.length - 1];
        const B = this.barge;
        if (B) B.rig.sockets['deck_bl']?.getWorldPosition(l.pos);
        else l.pos.copy(this.pos);
        l.state = 'deck';
        const to = new THREE.Vector3(this.pos.x + 4, 0, this.pos.z + 4);
        to.y = this.surface(to.x, to.z);
        l.leapTo(to);
        l.register();
        this.ctx.toast('A LIONESS JOINS THE HUNT', '#ffd36b');
      }
    }
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.geo) return 0;
    this.heartS.weak = this.exposed ? 3.0 : 1.7;
    let mult = 1;
    const warded = this.guardsUp() && !this.exposed;
    if (warded) {
      mult = 0.3;
      this.wardFx = 1;
      if (point && rnd.chance(0.4)) this.ctx.fx.hit(point, { x: -(dir?.x ?? 0), y: 0.5, z: -(dir?.z ?? 0) }, 'armor', 0.8);
      if (this.hintT <= 0) {
        this.hintT = 12;
        this.ctx.toast('SUN WARD', '#ffd36b', 'Her Rams of Amun shield her: break them first');
      }
    }
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * mult }, point, dir);
    if (amt > 0) {
      this.glowNow = Math.min(3, this.glowNow + 0.06);
      if (rnd.chance(0.3)) this.shots.petal(this.pos.x, this.pos.y + 1.6, this.pos.z, (rnd.next() - 0.5) * 3, 1, (rnd.next() - 0.5) * 3, 3);
    }
    if (this.alive && this.frac < 0.14 && this.desperateDone < 2 && this.cds.desperate <= 0 && !this.queue.includes('letItBleed')) this.queue.push('letItBleed');
    return amt;
  }
  protected hitKind() {
    return 'armor' as any;
  }
  /** the ward ring of sun glyphs orbiting her while her rams stand */
  private drawWard(add: (x: number, y: number, z: number, sprite: string, size: number, color: number, alpha: number, rot?: number) => void) {
    if (!this.geo || !this.root.visible || this.dead) return;
    const on = this.guardsUp() && !this.exposed;
    if (!on) return;
    const n = 10;
    const flash = this.wardFx;
    for (let i = 0; i < n; i++) {
      const a = this.t * 0.8 + (i / n) * TAU;
      const y = this.pos.y + 1.6 + Math.sin(this.t * 2 + i) * 0.25;
      add(this.pos.x + Math.sin(a) * 1.25, y, this.pos.z + Math.cos(a) * 1.25, 'glyph', 0.32 + flash * 0.15, 0xffd070, 0.7 + flash * 0.3, a);
    }
  }

  // ================================================================== per frame
  update(dt: number) {
    if (this.disposed) return;
    this.cds.strawberry -= dt;
    this.cds.swarm -= dt;
    this.hintT -= dt;
    this.wardFx = Math.max(0, this.wardFx - dt * 3);
    // hover over the river / sand
    if (!this.seated) {
      this.hoverNow = damp(this.hoverNow, this.hoverT, 1.6, dt);
      const g = this.surface(this.pos.x, this.pos.z);
      this.pos.y = g + this.hoverNow + Math.sin(this.t * 1.3) * 0.12;
    } else if (this.barge) {
      const s = this.barge.rig.sockets['throne_seat'];
      if (s) {
        s.getWorldPosition(_a);
        this.pos.set(_a.x, _a.y - 1.62 + 0.05, _a.z);
        this.yaw = this.barge.yaw;
      }
    }
    super.update(dt);
    this.updateBarge(dt);
    this.updateDancers(dt);
    if (this.geo) this.updateSilk(dt);
    this.updateCourt(dt);
    this.updateMirages(dt);
    this.swarm?.update(dt, this.t);
    if (this.swarm && !this.swarm.alive) this.swarm.setRegistered(false, (t) => this.d.enemies.registerExternal(t as any), (t) => this.d.enemies.unregisterExternal(t as any));
    this.shots.update(dt, this.t);
    this.silkR.update(dt, this.t);
    this.updateEnv(dt);
    this.ambient(dt);
  }

  private updateSilk(dt: number) {
    const n = this.rig.nodes;
    const sk = this.rig.sockets;
    this.root.updateMatrixWorld(true);
    // colliders: head, chest, hips, upper and lower gown
    const col = this.colliders;
    const pts: [string, [number, number, number], number][] = [['head', [0, 0.31, 0], 0.2], ['torso', [0, 0.28, 0], 0.27], ['pelvis', [0, -0.05, 0], 0.3], ['skirt', [0, -0.35, 0], 0.34], ['skirt_lo', [0, -0.45, 0], 0.42]];
    pts.forEach(([node, off, r], i) => {
      n[node]?.localToWorld(col[i].c.set(off[0], off[1], off[2]));
      col[i].r = r;
    });
    const wind = this.ctx.world.sa.wind;
    const set = (k: string, a: THREE.Vector3, b: THREE.Vector3) => {
      const s = this.silks[k];
      if (!s) return;
      s.pinLine(a, b);
      // wind: the world's, her own motion, and her spin streaming the silk outward
      const mid = _w.copy(a).add(b).multiplyScalar(0.5);
      const rx = mid.x - this.pos.x, rz = mid.z - this.pos.z;
      const w = this.spinRate;
      s.cloth.wind.set(wind.x * 2.5 - this.vel.x - w * rz * 1.6 + rx * Math.abs(w) * 1.4, 0.4 + Math.abs(w) * 0.4, wind.z * 2.5 - this.vel.z + w * rx * 1.6 + rz * Math.abs(w) * 1.4);
      s.burnLevel = this.burnT;
    };
    const head = n['head'];
    if (sk['veil_anchor'] && head) {
      sk['veil_anchor'].getWorldPosition(_a);
      const x = _b.set(1, 0, 0).transformDirection(head.matrixWorld);
      set('veil', _a.clone().addScaledVector(x, -0.17), _a.clone().addScaledVector(x, 0.17));
    }
    for (const sd of ['l', 'r']) {
      const a = sk['sleeve_a_' + sd], b = sk['sleeve_b_' + sd];
      if (a && b) set('sleeve_' + sd, a.getWorldPosition(new THREE.Vector3()), b.getWorldPosition(new THREE.Vector3()));
      const s = sk['sash_' + sd];
      if (s) {
        s.getWorldPosition(_a);
        const x = _b.set(1, 0, 0).transformDirection(n['pelvis'].matrixWorld);
        set('sash_' + sd, _a.clone().addScaledVector(x, -0.04), _a.clone().addScaledVector(x, 0.04));
      }
    }
    const px = new THREE.Vector3(1, 0, 0).transformDirection(n['pelvis'].matrixWorld);
    const pz = new THREE.Vector3(0, 0, 1).transformDirection(n['pelvis'].matrixWorld);
    for (const [sd, sock, axis] of [['f', 'skirt_f', px], ['b', 'skirt_b', px], ['l', 'skirt_l', pz], ['r', 'skirt_r', pz]] as [string, string, THREE.Vector3][]) {
      const s = sk[sock];
      if (!s) continue;
      s.getWorldPosition(_a);
      set('skirt_' + sd, _a.clone().addScaledVector(axis, -0.17), _a.clone().addScaledVector(axis, 0.17));
    }
    this.silkR.glow.value = 0.6 + this.glowNow * 0.55;
    void dt;
  }

  private updateEnv(dt: number) {
    const target = this.envTo;
    this.envK = damp(this.envK, this.envT, 0.7, dt);
    if (Math.abs(this.envK - this.envApplied) > 0.004 || target !== (this as any)._envLast) {
      (this as any)._envLast = target;
      this.envApplied = this.envK;
      const to = target === 'anger' ? this.anger : target === 'eclipse' ? this.eclipse : this.golden;
      this.ctx.world.env.lerpPreset(this.baseEnv, to, this.envK);
    }
  }

  private ambient(dt: number) {
    if (!this.geo || !this.root.visible) return;
    this.petalT += dt;
    if (this.petalT > 0.18 && !this.dead) {
      this.petalT = 0;
      // a few petals always fall around her as she dances
      this.shots.petal(this.pos.x + (rnd.next() - 0.5) * 1.5, this.pos.y + 1.4 + rnd.next() * 1.2, this.pos.z + (rnd.next() - 0.5) * 1.5, (rnd.next() - 0.5) * 1.5, 0.2, (rnd.next() - 0.5) * 1.5, 4);
    }
    // burning silk: embers and smoke off the edges
    this.emberT += dt;
    if (this.burnT > 0 && this.emberT > 0.04) {
      this.emberT = 0;
      for (const s of Object.values(this.silks))
        if (rnd.chance(0.4) && s.ember(_a)) {
          this.shots.mote(_a.x, _a.y, _a.z, (rnd.next() - 0.5) * 1.5, 1.5 + rnd.next() * 2, (rnd.next() - 0.5) * 1.5, { life: 0.8, size: 0.12, color: rnd.chance(0.5) ? 0xffa030 : 0xff6a20, sprite: 'ember', drag: 0.8 });
          if (rnd.chance(0.15)) this.ctx.particles.emit({ pos: { x: _a.x, y: _a.y, z: _a.z }, count: 1, vel: { x: 0, y: 1, z: 0 }, spread: 0.3, life: [0.8, 1.4], size: [0.2, 0.6], sprite: ['puff0', 'puff1'], color: [0x4a3a34, 0x6a5a50], alpha: 0.5, drag: 1 });
        }
    }
    // the glow of the corona
    if (rnd.chance(0.25)) {
      this.disc(_a);
      const a = rnd.next() * TAU;
      this.shots.mote(_a.x + Math.sin(a) * 0.3, _a.y + Math.cos(a) * 0.3, _a.z, Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0, { life: 0.6, size: 0.18, color: 0xffd070 });
    }
  }

  // ================================================================== procedural dance animation
  protected animate(dt: number) {
    if (!this.geo) return;
    const n = this.rig.nodes;
    const t = this.t;
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    // spin: the pirouette, then a graceful settle back to face the hunter
    this.spinRate = damp(this.spinRate, this.spinTarget, this.spinTarget ? 3 : 4, dt);
    this.spinA += this.spinRate * dt;
    if (!this.spinTarget && Math.abs(this.spinRate) < 0.6) {
      const k = Math.round(this.spinA / TAU) * TAU;
      this.spinA = damp(this.spinA, k, 3, dt);
    }
    if (!this.seated && this.alive) this.lookYaw = Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
    if (!this.seated) this.yaw = dampAngle(this.yaw, this.lookYaw, 3.5, dt);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw + this.spinA);
    const spinK = clamp(Math.abs(this.spinRate) / 5, 0, 1);
    // pose targets with the dance layered on top
    const P = POSES[this.poseName] ?? POSES.idle;
    const D = this.dance;
    const w = t * 2.2;
    const tgt = (j: string): [number, number, number] => {
      const b = P[j] ?? POSES.idle[j] ?? [0, 0, 0];
      let [x, y, z] = b;
      if (D > 0) {
        if (j === 'arm_l') z += Math.sin(w + 1) * 0.22 * D, x += Math.sin(w * 0.5) * 0.12 * D;
        if (j === 'arm_r') z -= Math.sin(w + 2.4) * 0.22 * D, x += Math.sin(w * 0.5 + 1) * 0.12 * D;
        if (j === 'fore_l') z += Math.sin(w + 2) * 0.28 * D;
        if (j === 'fore_r') z -= Math.sin(w + 3.4) * 0.28 * D;
        if (j === 'hand_l') y += Math.sin(t * 3 + 1) * 0.55 * D, z += Math.sin(t * 2.6) * 0.25 * D;
        if (j === 'hand_r') y -= Math.sin(t * 3 + 2.6) * 0.55 * D, z -= Math.sin(t * 2.6 + 1) * 0.25 * D;
        if (j === 'torso') z += Math.sin(w) * 0.05 * D, y += Math.sin(w * 0.5) * 0.1 * D;
        if (j === 'head') z -= Math.sin(w + 0.6) * 0.08 * D, y += Math.sin(w * 0.5 + 1) * 0.12 * D;
      }
      if (j === 'fing_l' || j === 'fing_r') x += Math.sin(t * 1.7 + (j === 'fing_l' ? 0 : 1.3)) * 0.12;
      if (j === 'torso') x += Math.sin(t * 1.4) * 0.02 - hitK * 0.15;
      if (j === 'head') x += hitK * 0.12;
      return [x, y, z];
    };
    for (const j of JOINTS) {
      const node = n[j];
      if (!node) continue;
      const [x, y, z] = tgt(j);
      const c = this.cur[j];
      const rate = j.startsWith('fing') || j.startsWith('hand') ? 9 : j.startsWith('skirt') ? 5 : 6;
      c.x = damp(c.x, x, rate, dt);
      c.y = damp(c.y, y, rate, dt);
      c.z = damp(c.z, z, rate, dt);
      node.rotation.set(c.x, c.y, c.z);
    }
    // hips sway; the gown swings on springs and flares out when she spins
    n['pelvis'].rotation.set(0, 0, Math.sin(w) * 0.06 * D);
    const fwdV = Math.sin(this.yaw) * this.vel.x + Math.cos(this.yaw) * this.vel.z;
    const sideV = Math.cos(this.yaw) * this.vel.x - Math.sin(this.yaw) * this.vel.z;
    const sx = this.skirtS[0].step(-fwdV * 0.05, dt), sz = this.skirtS[1].step(sideV * 0.05 + Math.sin(w) * 0.04 * D, dt);
    const lx = this.skirtS[2].step(sx * 1.3, dt), lz = this.skirtS[3].step(sz * 1.3, dt);
    if (this.poseName !== 'seated' && this.poseName !== 'exhausted') {
      n['skirt'].rotation.x += sx;
      n['skirt'].rotation.z += sz;
      n['skirt_lo'].rotation.x += lx;
      n['skirt_lo'].rotation.z += lz;
    }
    n['skirt_lo'].scale.set(1 + spinK * 0.28, 1 - spinK * 0.1, 1 + spinK * 0.28);
    n['apron'].rotation.x = clamp(this.apronS.step(-fwdV * 0.06 + sx * 0.5, dt), -0.4, 0.5) - spinK * 0.3;
    // the uraeus sways; the corona turns
    n['cobra'].rotation.set(-0.06 + Math.sin(t * 1.3) * 0.05, Math.sin(t * 0.9) * 0.15, 0);
    this.rayA += this.raySpin * dt;
    n['rays'].rotation.z = this.rayA;
    n['sun_disc'].rotation.z = Math.sin(t * 0.4) * 0.05;
    // the inner light
    this.glowNow = damp(this.glowNow, this.glowT + Math.sin(t * 2.2) * 0.08, 2.5, dt);
    const fx = this.rig.material.userData.fx.value;
    fx.z = (this.glowNow - 1) * 0.8 + (this.exposed ? 0.8 + Math.sin(t * 10) * 0.3 : 0);
    this.heartLight.intensity = this.root.visible ? 3 + this.glowNow * 5 + this.raySpin * 0.4 + (this.exposed ? 8 : 0) : 0;
  }

  private burstPetals(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) this.shots.petal(at.x + (rnd.next() - 0.5) * 1.2, at.y + 0.5 + rnd.next() * 2.5, at.z + (rnd.next() - 0.5) * 1.2, (rnd.next() - 0.5) * 7, 1 + rnd.next() * 4, (rnd.next() - 0.5) * 7, 4 + rnd.next() * 2);
  }

  // ================================================================== death: the silk burns, a column of light, Ra wakes
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dead = true;
    this.invulnerable = true;
    this.exposed = false;
    const ctx = this.ctx;
    this.taunt('Father... the light... is going out...', '#ff9a50');
    ctx.engine.slowMo(0.25, 30);
    ctx.engine.tweens.after(1.6, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 1.2);
    ctx.shake(0.8);
    ctx.engine.flash(0xfff0c0, 0.4, 0.7);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    this.shots.clear();
    this.swarm?.clear();
    for (const m of this.mirages) this.popMirage(m, undefined, true);
    // her court kneels and turns to golden sand
    for (const a of [...this.guards, ...this.lions]) if (a.alive) {
      a.alive = false;
      a.deadT = 0;
      a.unregister();
    }
    this.radius = -50;
    void this.deathSequence();
  }
  private async deathSequence() {
    const ctx = this.ctx;
    const tw = ctx.engine.tweens;
    const cam = this.d.cam;
    this.setPose('death', 0);
    this.spinTarget = 0;
    this.burnT = 1.3;
    this.glowT = 2.6;
    this.hoverT = this.hoverNow + 1.4;
    this.raySpin = 9;
    const fx = this.rig.material.userData.fx.value;
    // 1) the silk burns away in an ember storm
    for (let t = 0; t < 2.2; t += 0.05) {
      await tw.wait(0.05);
      this.glowT = 2.2 + Math.sin(t * 25) * 0.6;
      for (let k = 0; k < 3; k++) {
        this.heart(_a);
        this.shots.mote(_a.x + (rnd.next() - 0.5), _a.y + (rnd.next() - 0.5) * 2, _a.z + (rnd.next() - 0.5), (rnd.next() - 0.5) * 4, 2 + rnd.next() * 4, (rnd.next() - 0.5) * 4, { life: 1, size: 0.16, color: rnd.chance(0.5) ? 0xffa030 : 0xffe080, sprite: 'ember', drag: 0.6 });
      }
      if (t > 1.0) {
        // a column of light into the sky
        this.heart(_a);
        for (let k = 0; k < 4; k++) this.shots.mote(_a.x + (rnd.next() - 0.5) * 0.6, _a.y + rnd.next() * 30, _a.z + (rnd.next() - 0.5) * 0.6, 0, 30, 0, { life: 0.5, size: 1.2, color: 0xffd070, sprite: 'halo', drag: 0 });
      }
    }
    // 2) she comes apart into light and roses
    ctx.sfx('soul_leave', this.pos, 1, 0.7);
    ctx.sfx('divine_power', this.pos, 1, 0.5);
    this.burstPetals(this.pos.clone().add(_w.set(0, 1, 0)), 260);
    for (const s of Object.values(this.silks)) s.cloth.anchors.forEach((a) => a.y += 0.01);
    for (let t = 0; t < 1.4; t += 0.05) {
      await tw.wait(0.05);
      fx.y = Math.min(1.02, t / 1.3);
      this.glowT = 3 * (1 - t / 1.4);
    }
    this.root.visible = false;
    for (const s of Object.values(this.silks)) this.silkR.remove(s);
    this.heartLight.intensity = 0;
    if (this.barge) this.barge.fire = 1;
    // 3) the sky goes dark: Ra is enraged
    this.envTo = 'anger';
    this.envK = 0;
    this.envT = 1;
    ctx.sfx('thunder', null, 1, 0.5);
    ctx.sfx('quake_rumble', this.pos, 1, 0.5);
    ctx.shake(0.6);
    ctx.engine.letterbox(true, 0.6);
    const pp = this.player.pos;
    const sky = new THREE.Vector3(this.pos.x, this.surface(this.pos.x, this.pos.z) + 26, this.pos.z);
    const camPos = new THREE.Vector3(pp.x - (this.pos.x - pp.x) * 0.25, this.surface(pp.x, pp.z) + 2.4, pp.z - (this.pos.z - pp.z) * 0.25);
    cam.setCine({ pos: camPos, look: sky, fov: 56 });
    await tw.wait(1.2);
    speak3D(ctx.engine, 'anubis', 'WHO HAS PUT OUT THE LIGHT OF MY DAUGHTER?', sky, { key: `ra:${this.id}`, size: 0.9, px: 96, wrap: 30, color: '#ffe0c0', glow: '#ff3a10', hdr: 2.2 });
    ctx.toast('« Ruby Tuesday »', '#ff6a3a', 'Ra is enraged', true);
    ctx.events.emit('raEnraged', { x: this.pos.x, z: this.pos.z, from: 'cleopatra' });
    const world = ctx.world as unknown as { burnToLava?: (o?: unknown) => void };
    world.burnToLava?.({ x: this.pos.x, z: this.pos.z });
    for (let t = 0; t < 3.4; t += 0.05) {
      await tw.wait(0.05);
      if (this.barge) this.barge.sink = Math.min(2.6, this.barge.sink + 0.05 * 0.5);
      if (rnd.chance(0.15)) ctx.shake(0.2);
    }
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.6);
    // 4) the bounty
    ctx.fx.coins({ x: this.pos.x, y: this.surface(this.pos.x, this.pos.z) + 1, z: this.pos.z }, 40);
    this.onDefeated?.(this, false);
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    super.dispose();
    const ctx = this.ctx;
    if (this.alive) {
      // aborted mid-fight (run ended): give the sky back
      ctx.world.env.apply(this.baseEnv);
      this.d.cam.setCine(null);
      ctx.engine.letterbox(false, 0.3);
    }
    this.shots.dispose();
    this.swarm?.setRegistered(false, (t) => this.d.enemies.registerExternal(t as any), (t) => this.d.enemies.unregisterExternal(t as any));
    this.swarm?.dispose();
    this.silkR.dispose();
    for (const c of this.bargeCloth) this.d.cloth.remove(c);
    this.bargeCloth = [];
    this.bargeSilk = [];
    if (this.barge) {
      this.barge.rig.root.removeFromParent();
      this.barge.rig.material.dispose();
      this.barge = null;
    }
    for (const a of [...this.guards, ...this.lions]) a.dispose();
    this.guards = [];
    this.lions = [];
    for (const m of this.mirages) {
      this.d.enemies.unregisterExternal(m as any);
      m.rig.root.removeFromParent();
    }
    this.mirages = [];
    for (const dz of this.dancers) dz.root.removeFromParent();
    this.dancers = [];
    this.heartLight.removeFromParent();
    this.mirageMat.dispose();
    this.rig.material.dispose();
    if ((window as any).__cleopatra === this) (window as any).__cleopatra = null;
  }
}
