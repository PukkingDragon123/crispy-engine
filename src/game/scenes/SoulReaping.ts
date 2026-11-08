// THE REAPING — what Sundown sees between the killing blow and the Weighing of the Heart.
// It plays in the run's own world, on real time, while the world crawls in slow motion:
//   1. THE HEART   a close, heavy shot through the rib cage: his wrapped heart beats
//                  (light pulses through the bones from inside, every thump a sound),
//                  slower and weaker, the linen loosening, until it stops and greys.
//   2. THE SOUL    a jade spectral Sundown tears loose out of the body, back arched,
//                  shedding wisps and pixel motes, staggers and crumples to its knees.
//   3. THE ARM     the sky darkens; the sand trembles, bulges and bursts: the giant arm
//                  of Anubis (black skin, gold cuffs, hooked gold claws) erupts behind
//                  the soul and looms over it.
//   4. THE PARRY   the hand rears and strikes; a timing ring closes on it. A perfect
//                  parry is spectacular (the soul's forearm meets the palm in a burst
//                  of sparks and a ring of light, the hand recoils, time kisses to a
//                  stop) and changes nothing: the god shakes it off ("Cute.") and
//                  grabs him anyway.
//   5. THE DRAG    the fingers close round the soul and the arm pulls it down into the
//                  sand in a sinking vortex; black. (The Weighing of the Heart opens on
//                  "…the sand gives way.")
// Self-driving (engine.onAfterUpdate, after the scene's own update): it owns the camera
// while it runs and hands it back afterwards. ENTER skips to the end.
// API (RunScene.onPlayerDeath): `await new SoulReaping({ ctx, player, qte, hud }).run()`.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { Qte, type QteResult } from '../ui/Qte';
import { buildRigGeo, RigGeo, RigInstance } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Particles } from '../fx/Particles';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { hudHeartRig } from '../models/props/hud';
import { anubisArmRig } from '../models/anubis/arm';
import { spiritNormals } from '../models/anubis/realm';
import { spiritMaterial, soulShellGeos, type SpiritMat } from './AnubisTrial';
import type { EnvPreset } from '../world/Env';

export interface ReapBody {
  rig: RigInstance;
  pos: THREE.Vector3;
}
export interface ReapHost {
  ctx: Ctx;
  player: ReapBody;
  qte: Qte;
  /** hide / show the run HUD */
  hud?: (on: boolean) => void;
  /** hand off into the realm of the dead instead of fading out: the camera dives into the vortex after the soul */
  handoff?: boolean;
  /** with handoff: the lens stays buried in the sand until this resolves (the realm below is built) */
  ready?: Promise<unknown>;
}

type V3 = THREE.Vector3;
type Euler3 = [number, number, number];
type SoulMode = 'off' | 'inside' | 'tear' | 'stagger' | 'kneel' | 'turn' | 'guard' | 'held';
type ArmMode = 'hidden' | 'rumble' | 'burst' | 'loom' | 'strike' | 'recoil' | 'shrug' | 'grab' | 'lift' | 'drag';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);
/** the heart in the torso (from the chest socket: a little to his left, behind the sternum) and the camera under the ribs */
const HEART_AT = new THREE.Vector3(0.028, -0.012, -0.13);
const HEART_CAM = new THREE.Vector3(0.056, -0.31, 0.19);
const SAND = [0xf0d29a, 0xe3bd80, 0xd6a968, 0xfbe6b8];
const JADE = [0x7ff0e0, 0xc8fff4, 0x4fd8c0];
const GOLDS = [0xffffff, 0xfff0a6, 0xffd36b];

// the soul's poses (joint euler targets); kneeling also drops the root to the knees
const POSE: Record<string, Partial<Record<string, Euler3>>> = {
  tear: { pelvis: [0, 0, 0], torso: [-0.5, 0, 0], head: [-0.8, 0, 0], arm_l: [0.75, 0, 1.15], arm_r: [0.75, 0, -1.15], fore_l: [-0.25, 0, 0], fore_r: [-0.25, 0, 0], thigh_l: [0.3, 0, 0], thigh_r: [0.12, 0, 0], shin_l: [0.55, 0, 0], shin_r: [0.4, 0, 0] },
  stagger: { torso: [0.4, 0, 0.12], head: [0.35, 0, 0], arm_l: [-0.3, 0, 0.35], arm_r: [-0.55, 0, -0.25], fore_l: [-0.6, 0, 0], fore_r: [-0.5, 0, 0], thigh_l: [-0.55, 0, 0], thigh_r: [0.2, 0, 0], shin_l: [0.8, 0, 0], shin_r: [0.45, 0, 0] },
  kneel: { torso: [0.5, 0, 0.04], head: [0.6, 0, 0], arm_l: [-0.38, 0, 0.14], arm_r: [-0.42, 0, -0.14], fore_l: [-0.4, 0, 0], fore_r: [-0.35, 0, 0], thigh_l: [-0.14, 0, 0.06], thigh_r: [-0.14, 0, -0.06], shin_l: [1.52, 0, 0], shin_r: [1.52, 0, 0] },
  turn: { torso: [-0.12, 0, 0], head: [-0.7, 0, 0], arm_l: [-0.25, 0, 0.4], arm_r: [-0.3, 0, -0.4], fore_l: [-0.45, 0, 0], fore_r: [-0.45, 0, 0], thigh_l: [-0.14, 0, 0.06], thigh_r: [-0.14, 0, -0.06], shin_l: [1.52, 0, 0], shin_r: [1.52, 0, 0] },
  guard: { torso: [-0.18, 0.28, 0], head: [-0.4, 0.22, 0], arm_l: [-0.5, 0, 0.6], arm_r: [-1.8, 0, -0.45], fore_l: [-0.6, 0, 0], fore_r: [-1.55, 0, 0], thigh_l: [-0.14, 0, 0.06], thigh_r: [-0.14, 0, -0.06], shin_l: [1.52, 0, 0], shin_r: [1.52, 0, 0] },
  held: { torso: [-0.25, 0, 0], head: [-0.55, 0, 0], arm_l: [-2.7, 0, 0.45], arm_r: [-2.3, 0, -0.65], fore_l: [-0.3, 0, 0], fore_r: [-0.55, 0, 0], thigh_l: [-0.35, 0, 0], thigh_r: [0.25, 0, 0], shin_l: [0.65, 0, 0], shin_r: [0.35, 0, 0] },
};

export class SoulReaping {
  private ctx: Ctx;
  private t = 0;
  private timeK = 1;
  private kissT = 0;
  private waits: { at: number; res: () => void }[] = [];
  private phase: 'heart' | 'tear' | 'rise' | 'parry' | 'grab' | 'drag' | 'dive' | 'end' = 'heart';
  private skipHold = 0;
  private diveT = 0;
  private skipping = false;
  private fx = new Particles();
  private objs: THREE.Object3D[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private lights: { l: THREE.PointLight; L: any }[] = [];
  private saved: Record<string, any> = {};
  private savedSky: EnvPreset | null = null;
  private sky = 0;
  private skyTarget = 0;
  private parry: QteResult = 'fail';
  private tick = (_dt: number, rdt: number) => this.update(Math.min(0.1, rdt));
  // stage
  private body = V();
  private S = V(); // where the soul kneels
  private away = V(); // from the camera side through the soul (the arm rises this way)
  private side = V();
  private B0 = V(); // where the arm breaks the sand
  // the heart
  private heart: RigInstance | null = null;
  private heartMat: VoxelMaterial | null = null;
  private heartGlow: SpiritMat | null = null;
  private beats: { at: number; k: number; done?: boolean }[] = [];
  private beat = 0;
  private beatK = 0;
  private heartDead = 0;
  private wrapLoose = 0;
  // the soul
  private soul: RigInstance | null = null;
  private soulCore: VoxelMaterial | null = null;
  private soulShell: SpiritMat | null = null;
  private soulMode: SoulMode = 'off';
  private soulT = 0;
  private soulPos = V();
  private soulYaw = 0;
  private soulYawTarget = 0;
  private soulGain = 0;
  private kneeDrop = 0.3;
  private held = false;
  // the arm
  private armGeo: RigGeo | null = null;
  private arm: RigInstance | null = null;
  private armHolder = new THREE.Group();
  private armMat: VoxelMaterial | null = null;
  private armShell: SpiritMat | null = null;
  private armMode: ArmMode = 'hidden';
  private armT = 0;
  private ap = { rise: -11, tilt: 0, flex: 0, curl: 0, spread: 0.1, thumb: 0, shiftX: 0, shiftY: 0, shiftZ: 0, twist: 0 };
  private recoilV = 0;
  private recoil = 0;
  private strikeDur = 1;
  private strikeShift = V();
  private grip = V();
  // camera
  private cam = { p: V(), l: V(), fov: 40 };
  private camFrom = { p: V(), l: V(), fov: 40 };
  private camBlend = 0;
  private camBlendDur = 0;
  private shot: ((t: number) => { p: V3; l: V3; fov: number }) | null = null;
  private shotT = 0;
  private shake = 0;
  private line: FloatText3D | null = null;
  private v1 = V();
  private v2 = V();
  private q1 = new THREE.Quaternion();

  constructor(private h: ReapHost) {
    this.ctx = h.ctx;
    this.fx.quality = Math.max(0.6, h.ctx.engine.quality.particles);
    this.ctx.scene.add(this.fx.group);
    this.objs.push(this.fx.group);
    (window as any).__reaping = this;
  }

  // =========================================================================== running
  /** play it through; resolves with the parry result once the soul is under the sand (screen black) */
  async run(): Promise<QteResult> {
    const eng = this.ctx.engine;
    this.stage();
    eng.onAfterUpdate.push(this.tick);
    try {
      await this.script();
    } finally {
      this.teardown();
    }
    return this.parry;
  }

  private wait(sec: number) {
    if (this.skipping) return Promise.resolve();
    return new Promise<void>((res) => this.waits.push({ at: this.t + sec, res }));
  }

  private sfx(id: string, volume = 0.8, pitch = 1) {
    if (!this.skipping) this.ctx.engine.audio.play(id, { volume, pitch });
  }

  private setShot(fn: (t: number) => { p: V3; l: V3; fov: number }, blend = 0) {
    this.camFrom.p.copy(this.cam.p);
    this.camFrom.l.copy(this.cam.l);
    this.camFrom.fov = this.cam.fov;
    this.shot = fn;
    this.shotT = 0;
    this.camBlend = 0;
    this.camBlendDur = blend;
  }

  /** the set: where the soul will kneel and the arm break through, lights, grade, the heart */
  private stage() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const cam = ctx.camera;
    this.h.hud?.(false);
    eng.letterbox(true, 0.5);
    this.body.copy(this.h.player.pos);
    // the soul tears out of his chest toward us; the arm rises behind the body
    const fwd = this.h.player.rig.root.getWorldDirection(this.v1).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(this.body.x - cam.position.x, 0, this.body.z - cam.position.z).negate();
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    this.away.copy(fwd).normalize().negate();
    this.side.set(this.away.z, 0, -this.away.x);
    this.S.copy(this.body).addScaledVector(this.away, -1.15).addScaledVector(this.side, 0.35);
    this.S.y = ctx.world.groundAt(this.S.x, this.S.z);
    this.B0.copy(this.body).addScaledVector(this.away, 1.9).addScaledVector(this.side, -0.25);
    this.B0.y = ctx.world.groundAt(this.B0.x, this.B0.z);
    this.cam.p.copy(cam.position);
    this.cam.l.copy(cam.position).add(cam.getWorldDirection(this.v1));
    this.cam.fov = cam.fov;
    // borrow the run's pooled lights (no new lights: nothing recompiles)
    for (const L of (ctx.fx as any).lights?.slice(0, 3) ?? []) {
      L.t = 0;
      L.dur = 1e9;
      L.i0 = 0;
      this.lights.push({ l: L.l, L });
    }
    // grade
    const u = eng.post.u;
    this.saved = { desat: u.uDesat.value, vig: u.uVignette.value, con: u.uContrast.value, sat: u.uSaturation.value, spirit: u.uSpirit.value, tS: u.uTintShadows.value.clone(), tH: u.uTintHighlights.value.clone() };
    this.savedSky = { ...ctx.world.env.preset };
    (window as any).__music?.setMood('off', 1.2);
    this.buildHeart();
  }

  private async script() {
    const eng = this.ctx.engine;
    // ---------------------------------------------------------------- 1. the heart
    this.phase = 'heart';
    eng.slowMo(0.04, 6);
    eng.audio.setMuffle(0.6, 0.8);
    this.beats = [{ at: 0.45, k: 1 }, { at: 1.45, k: 0.82 }, { at: 2.65, k: 0.58 }, { at: 4.15, k: 0.3 }];
    this.setShot(this.shotHeart, 0.25);
    // build the soul and the arm a beat in, while the heart holds the screen
    await this.wait(0.15);
    this.buildSoul();
    this.buildArm();
    await this.wait(4.75);
    // ---------------------------------------------------------------- 2. the soul tears loose
    this.phase = 'tear';
    eng.audio.setMuffle(0, 0.5);
    eng.slowMo(0.2, 3);
    this.setShot(this.shotSoul, 0);
    this.soulMode = 'inside';
    this.soulT = 0;
    this.sfx('soul_leave', 0.9, 0.85);
    await this.wait(0.6);
    this.soulMode = 'tear';
    this.soulT = 0;
    this.sfx('whoosh_big', 0.6, 0.7);
    this.sfx('divine_whisper', 0.6, 0.7);
    this.tearBurst();
    eng.flash(0xbfffee, 0.25, 0.5);
    await this.wait(0.85);
    this.soulMode = 'stagger';
    this.soulT = 0;
    this.sfx('skeleton_rattle', 0.5, 0.6);
    await this.wait(0.65);
    this.soulMode = 'kneel';
    this.soulT = 0;
    this.sfx('hit_bone', 0.35, 0.6);
    await this.wait(1.4);
    // ---------------------------------------------------------------- 3. the arm of Anubis
    this.phase = 'rise';
    this.skyTarget = 1;
    this.armMode = 'rumble';
    this.armT = 0;
    this.setShot(this.shotRise, 0.9);
    this.sfx('quake_rumble', 1, 0.6);
    this.sfx('sand_rise', 0.7, 0.6);
    (window as any).__music?.setMood('underworld', 2);
    await this.wait(1.0);
    this.soulMode = 'turn';
    this.soulT = 0;
    this.soulYawTarget = Math.atan2(this.away.x, this.away.z);
    await this.wait(0.35);
    this.armMode = 'burst';
    this.armT = 0;
    this.burstFx();
    await this.wait(0.7);
    this.armMode = 'loom';
    this.armT = 0;
    await this.wait(1.7);
    // ---------------------------------------------------------------- 4. the strike and the parry
    this.phase = 'parry';
    this.setShot(this.shotParry, 0.35);
    const D = 1.2;
    this.strikeDur = Qte.ringPerfect(D);
    this.aimStrike();
    this.armMode = 'strike';
    this.armT = 0;
    this.sfx('whoosh_big', 0.8, 0.55);
    this.sfx('jackal_growl', 0.6, 0.6);
    let res: QteResult | null = null;
    if (!this.skipping) void this.h.qte.run({ kind: 'ring', key: 'KeyF', alt: ['Mouse0', 'Space'], label: 'PARRY', duration: D, at: () => this.gripPoint(), noKiss: true }).then((r) => (res = r));
    while (!this.skipping && res === null && this.armT < this.strikeDur) await this.wait(0.01);
    const r: QteResult = res ?? 'fail';
    if (r !== 'fail' && !this.skipping) {
      this.parry = r;
      this.doParry(r);
      await this.wait(r === 'perfect' ? 0.9 : 0.6);
      // the joke: none of that mattered
      this.armMode = 'shrug';
      this.armT = 0;
      this.setShot(this.shotJoke, 0.5);
      this.say(r === 'perfect' ? '"Cute."' : '"No."');
      await this.wait(r === 'perfect' ? 1.6 : 1.1);
      this.setShot(this.shotParry, 0.25);
      this.strikeDur = 0.32;
      this.aimStrike();
      this.armMode = 'strike';
      this.armT = 0;
      this.sfx('whoosh_big', 0.9, 0.7);
      await this.wait(this.strikeDur);
    } else {
      // a miss (or no answer): the blow simply lands
      while (!this.skipping && this.armT < this.strikeDur) await this.wait(0.01);
    }
    // ---------------------------------------------------------------- 5. the grab and the drag
    this.phase = 'grab';
    this.grab();
    this.setShot(this.shotDrag, 0.6);
    await this.wait(0.7);
    this.armMode = 'lift';
    this.armT = 0;
    this.sfx('anubis_roar', 0.55, 0.65);
    await this.wait(0.45);
    this.phase = 'drag';
    this.armMode = 'drag';
    this.armT = 0;
    this.sfx('sand_burst', 1, 0.6);
    this.sfx('quake_rumble', 0.9, 0.7);
    this.sfx('soul_leave', 0.8, 0.6);
    await this.wait(1.05);
    if (this.h.handoff) {
      // after it: the camera dives into the closing vortex and the sand swallows the lens
      this.phase = 'dive';
      this.diveT = 0;
      this.setShot(this.shotDive, 0.12);
      this.sfx('whoosh_big', 1, 0.42);
      this.sfx('sand_rise', 1, 0.45);
      this.sfx('divine_whisper', 0.5, 0.55);
      await this.wait(1.1);
      // buried: hold here until the realm below is ready, then through
      if (this.h.ready) await this.h.ready;
      eng.flash(0x3a2c1e, 0.92, 0.9);
    } else await (this.skipping ? eng.fadeOut(0.25) : eng.fadeOut(0.55));
    this.phase = 'end';
  }

  // =========================================================================== building
  private buildHeart() {
    const p = this.h.player;
    const torso = p.rig.nodes['torso'];
    if (!torso) return;
    try {
      const geo = buildRigGeo(hudHeartRig(), 'hud_heart');
      this.heartMat = makeVoxelMaterial({ emissiveStrength: 0 });
      this.mats.push(this.heartMat);
      const h = new RigInstance(geo, { material: this.heartMat, castShadow: false });
      // in the rib cage, a little to his left, behind the sternum
      const chest = p.rig.sockets['chest'];
      const at = chest ? chest.position.clone() : V(0, 0.2, 0.12);
      h.root.position.copy(at).add(HEART_AT);
      h.root.rotation.set(0.12, 0.3, 0.4);
      h.root.scale.setScalar(1.75);
      torso.add(h.root);
      this.objs.push(h.root);
      this.heart = h;
      // a faint glow that reads through cloth and bone
      this.heartGlow = spiritMaterial(0x6a0a08, 0xff7a5a, { inflate: 0.0004, power: 2.4, core: 0.25, lumRim: 1, gain: 0.0, vein: 0.5 });
      this.heartGlow.depthTest = false;
      this.heartGlow.uniforms.uFogNear.value = 80;
      this.heartGlow.uniforms.uFogFar.value = 400;
      this.mats.push(this.heartGlow);
      const shells = soulShellGeos(geo);
      geo.parts.forEach((pp, i) => {
        const m = new THREE.Mesh(shells[i], this.heartGlow!);
        m.renderOrder = 6;
        h.nodes[pp.name].add(m);
      });
    } catch (e) {
      console.warn('[reaping] heart', e);
    }
  }

  private buildSoul() {
    const geo = this.h.player.rig.geo;
    this.soulCore = makeVoxelMaterial({ transparent: true, opacity: 0.38 });
    this.soulCore.userData.tint.value.setRGB(0.55, 1.25, 1.3);
    this.soulCore.depthWrite = false;
    this.soulShell = spiritMaterial(0x0f6a5a, 0xb8fff0, { inflate: 0.012, power: 2.2, core: 0.55, lumRim: 1, gain: 0, vein: 0.6 });
    this.soulShell.uniforms.uFogNear.value = 80;
    this.soulShell.uniforms.uFogFar.value = 400;
    this.mats.push(this.soulCore, this.soulShell);
    const s = new RigInstance(geo, { material: this.soulCore, castShadow: false });
    const shells = soulShellGeos(geo);
    geo.parts.forEach((p, i) => {
      const m = new THREE.Mesh(shells[i], this.soulShell!);
      m.renderOrder = 5;
      s.nodes[p.name].add(m);
    });
    s.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === this.soulCore) o.renderOrder = 4;
    });
    // compile its materials now, out of sight under the sand, then hide it until it tears loose
    s.root.position.copy(this.body).add(V(0, -30, 0));
    this.ctx.scene.add(s.root);
    this.objs.push(s.root);
    this.soul = s;
    void this.ctx.engine.renderer.compileAsync?.(s.root, this.ctx.camera, this.ctx.scene)?.catch?.(() => {});
    s.root.visible = false;
    // how far the root drops to bring the knees to the sand
    const ix = geo.index;
    const off = (n: string) => (ix[n] !== undefined ? geo.parts[ix[n]].offset.y : 0);
    this.kneeDrop = Math.max(0.15, off('pelvis') + off('thigh_l') + off('shin_l') - 0.06);
  }

  private buildArm() {
    try {
      const spec = anubisArmRig();
      this.armGeo = buildRigGeo(spec, 'anubis_arm:reap');
      for (const p of this.armGeo.parts) if (!p.geo.getAttribute('snormal')) spiritNormals(p.geo, p.model, p.pivot, spec.voxelSize, 2);
      this.armMat = makeVoxelMaterial({ emissiveStrength: 0.4 });
      this.armMat.envMapIntensity = 1.2;
      this.armShell = spiritMaterial(0x0a4a7a, 0xa8f4ff, { inflate: 0.03, power: 3.6, core: 0.0, lumRim: 0, gain: 0.0, vein: 0.25 });
      this.armShell.uniforms.uFogNear.value = 80;
      this.armShell.uniforms.uFogFar.value = 400;
      this.mats.push(this.armMat, this.armShell);
      const a = new RigInstance(this.armGeo, { material: this.armMat, castShadow: true });
      this.armGeo.parts.forEach((p) => {
        const m = new THREE.Mesh(p.geo, this.armShell!);
        m.renderOrder = 5;
        a.nodes[p.name].add(m);
      });
      this.armHolder.add(a.root);
      this.armHolder.position.copy(this.B0);
      this.armHolder.rotation.y = Math.atan2(-this.away.x, -this.away.z);
      this.ctx.scene.add(this.armHolder);
      this.objs.push(this.armHolder);
      this.arm = a;
      this.poseArm(0);
      void this.ctx.engine.renderer.compileAsync?.(this.armHolder, this.ctx.camera, this.ctx.scene)?.catch?.(() => {});
    } catch (e) {
      console.warn('[reaping] arm', e);
    }
  }

  // =========================================================================== moments
  private tearBurst() {
    const c = this.soulCenter(this.v1);
    this.fx.emit({ pos: c, count: 70, spread: 3.2, up: 1, life: [0.5, 1.3], size: [0.07, 0.015], sprite: ['dot3', 'glow8', 'dot4'], color: JADE, additive: true, drag: 2.4, gravity: -0.6 });
    this.fx.emit({ pos: c, count: 3, life: [0.35, 0.5], size: [0.3, 2.6], sprite: 'ring', color: 0x9ffff0, additive: true, alpha: 0.7 });
    this.fx.emit({ pos: c, count: 26, spread: 1.4, up: 0.6, life: [0.9, 1.8], size: [0.3, 0.9], sprite: ['cloud0', 'cloud1'], color: 0x5fd8c8, alpha: 0.12, additive: true, drag: 1.5, gravity: -0.4, rot: 3, rotSpeed: 0.6 });
  }

  private burstFx() {
    const ctx = this.ctx;
    const B = this.B0;
    this.sfx('sand_burst', 1, 0.55);
    this.sfx('explosion_big', 0.55, 0.5);
    this.sfx('anubis_roar', 0.9, 0.75);
    this.sfx('rock_crumble', 0.8, 0.6);
    this.shake = 1;
    ctx.shake(0.7);
    ctx.engine.flash(0x9fe8ff, 0.2, 0.4);
    const top = { x: B.x, y: B.y + 0.4, z: B.z };
    this.fx.emit({ pos: top, count: 200, spread: 7, up: 11, jitter: 1.4, life: [0.9, 2.0], size: [0.07, 0.12], sprite: ['dot3', 'dot4', 'grain0', 'grain1'], color: SAND, gravity: 13, drag: 0.5, ground: true });
    this.fx.emit({ pos: top, count: 40, spread: 5, up: 3, jitter: 1.6, life: [1.6, 3.2], size: [1.0, 3.2], sprite: ['puff0', 'puff1', 'puff2'], color: [0xe6cf9f, 0xd8bc88], alpha: 0.55, drag: 1.4, gravity: -0.2, rot: 3, rotSpeed: 0.4 });
    this.fx.emit({ pos: top, count: 30, spread: 6, up: 8, life: [1, 1.8], size: [0.1, 0.08], sprite: 'pebble', color: [0xd2a77a, 0xb98a60, 0x7a5137], gravity: 16, ground: true, bounce: 0.3, rot: 6, rotSpeed: 4 });
    // a skirt of dust rolling out along the ground
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.fx.emit({ pos: { x: B.x + Math.cos(a) * 1.4, y: B.y + 0.3, z: B.z + Math.sin(a) * 1.4 }, vel: { x: Math.cos(a) * 7, y: 0.6, z: Math.sin(a) * 7 }, count: 1, life: [1.2, 2.2], size: [0.8, 2.4], sprite: ['puff0', 'puff3'], color: 0xe6cf9f, alpha: 0.5, drag: 2.2 });
    }
    ctx.events.emit('gibs', B.x, B.y + 0.6, B.z, 26, 0.32, SAND, 9, 9);
    ctx.events.emit('groundMark', B.x, B.z, 4.2, 0);
  }

  /** aim the strike so the palm meets the soul's chest at the end of it */
  private aimStrike() {
    const a = this.arm;
    if (!a) return;
    const save = { ...this.ap };
    this.ap.rise = 0;
    this.ap.tilt = 0.62;
    this.ap.flex = 1.0;
    this.ap.curl = 0.32;
    this.ap.shiftX = this.ap.shiftY = this.ap.shiftZ = 0;
    this.poseArm(0);
    this.armHolder.updateMatrixWorld(true);
    a.sockets['grip'].getWorldPosition(this.v1);
    const target = this.soulCenter(this.v2).add(V(0, 0.15, 0));
    // (into the holder's frame: the shift moves the root inside it)
    this.strikeShift.subVectors(target, this.v1).applyAxisAngle(UP, -this.armHolder.rotation.y);
    // keep the elbow under the sand: the arm may slide along the ground, not climb out
    this.strikeShift.y = clamp(this.strikeShift.y, -2.2, 0.9);
    Object.assign(this.ap, save);
    this.poseArm(0);
  }

  private doParry(r: QteResult) {
    const eng = this.ctx.engine;
    const P = this.gripPoint() ?? this.soulCenter(V());
    const perfect = r === 'perfect';
    this.soulMode = 'guard';
    this.soulT = 0;
    this.armMode = 'recoil';
    this.armT = 0;
    this.recoilV = perfect ? 9 : 6;
    this.kissT = perfect ? 0.32 : 0.18;
    this.shake = perfect ? 1 : 0.6;
    this.ctx.shake(perfect ? 0.6 : 0.35);
    eng.hitStop(perfect ? 0.25 : 0.12, 0.03);
    eng.flash(perfect ? 0xfff4d0 : 0xd6fff4, perfect ? 0.55 : 0.3, perfect ? 0.4 : 0.25);
    this.sfx('counter_clang', 1, perfect ? 0.85 : 1);
    this.sfx('hit_armor', 0.8, 0.7);
    if (perfect) {
      this.sfx('divine_chime', 0.8, 1.2);
      this.sfx('ricochet', 0.5, 0.8);
    }
    // sparks, a ring of light in the plane facing us, jade off the soul's forearm
    const fx = this.fx;
    fx.emit({ pos: P, count: perfect ? 110 : 50, spread: perfect ? 11 : 7, life: [0.25, 0.7], size: [0.06, 0.012], sprite: 'spark', color: GOLDS, additive: true, drag: 1.6, gravity: 7, stretch: 0.09 });
    fx.emit({ pos: P, count: 2, life: [0.3, 0.45], size: [0.4, perfect ? 6 : 3.5], sprite: 'ring', color: perfect ? 0xfff0a6 : 0xc8fff4, additive: true });
    fx.emit({ pos: P, count: 1, life: [0.18, 0.18], size: [perfect ? 3.4 : 2, 0.2], sprite: 'flash0', color: 0xffffff, additive: true });
    const cam = this.ctx.camera;
    const right = V(1, 0, 0).applyQuaternion(cam.quaternion), up = V(0, 1, 0).applyQuaternion(cam.quaternion);
    const n = perfect ? 48 : 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const d = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
      const sp = perfect ? 9 : 6;
      fx.emit({ pos: { x: P.x + d.x * 0.3, y: P.y + d.y * 0.3, z: P.z + d.z * 0.3 }, vel: { x: d.x * sp, y: d.y * sp, z: d.z * sp }, count: 1, life: [0.35, 0.5], size: [0.16, 0.02], sprite: i % 3 ? 'glow8' : 'star4', color: perfect ? [0xfff0a6, 0xffffff] : [0xc8fff4, 0x7ff0e0], additive: true, drag: 3.2 });
    }
    const fore = this.soul?.nodes['fore_r'];
    if (fore) {
      fore.getWorldPosition(this.v1);
      fx.emit({ pos: this.v1, count: perfect ? 50 : 24, spread: 4, life: [0.4, 0.9], size: [0.08, 0.015], sprite: ['dot3', 'glow8'], color: JADE, additive: true, drag: 2.5 });
    }
    // the light flares gold at the contact
    const L = this.lights[2]?.l;
    if (L) {
      L.position.copy(P);
      L.color.setHex(perfect ? 0xffe2a0 : 0xbff8ee);
      this.flare = perfect ? 60 : 30;
    }
  }
  private flare = 0;

  private say(text: string) {
    const ft = new FloatText3D(text, { size: 0.62, color: '#ffe6ad', glow: '#ff9d3a', cps: 16, wrap: 30, hdr: 1.8, px: 72 });
    this.ctx.scene.add(ft.mesh);
    this.line?.dispose();
    this.line = ft;
    this.lineT = 0;
    this.placeLine(1);
  }
  private lineT = 0;
  private placeLine(k: number) {
    const ft = this.line;
    if (!ft || !this.arm) return;
    this.arm.sockets['palm_c'].getWorldPosition(this.v1);
    const want = this.soulCenter(this.v2).lerp(this.v1, 0.55).add(V(0, 0.9, 0));
    ft.anchor.lerp(want, k);
  }

  private grab() {
    const a = this.arm, s = this.soul;
    this.sfx('punch', 1, 0.5);
    this.sfx('skeleton_rattle', 0.8, 0.7);
    this.sfx('hit_bone', 0.6, 0.6);
    this.ctx.shake(0.5);
    this.shake = 0.8;
    this.armMode = 'grab';
    this.armT = 0;
    if (!a || !s) return;
    // the soul is now the god's: it rides in the closing hand
    a.sockets['grip'].attach(s.root);
    this.held = true;
    this.soulMode = 'held';
    this.soulT = 0;
    const P = this.gripPoint();
    if (P) this.fx.emit({ pos: P, count: 40, spread: 3, life: [0.4, 1], size: [0.08, 0.015], sprite: ['dot3', 'glow8'], color: JADE, additive: true, drag: 2 });
  }

  // =========================================================================== frame
  private update(rdt: number) {
    const eng = this.ctx.engine;
    // hold SPACE / ENTER to skip (a tap is never enough: a stray press must not throw the scene away)
    // (touch: a finger held still on the screen)
    const held = eng.input.isDown('Space') || eng.input.isDown('Enter') || eng.input.touchHolding;
    this.skipHold = held && !this.skipping ? this.skipHold + rdt : 0;
    this.h.qte.hold = this.skipHold > 0.08 ? { label: 'HOLD TO SKIP', k: Math.min(1, this.skipHold / 0.9) } : null;
    if (!this.skipping && this.skipHold >= 0.9) {
      this.skipping = true;
      this.h.qte.hold = null;
      for (const w of this.waits.splice(0)) w.res();
    }
    if (this.phase === 'dive') this.updateDive(rdt);
    // the slow-motion kiss after a parry
    this.kissT = Math.max(0, this.kissT - rdt);
    this.timeK = damp(this.timeK, this.kissT > 0 ? 0.12 : 1, this.kissT > 0 ? 30 : 6, rdt);
    // (testing aid: window.__reapHold freezes the sequence clock for a capture)
    const dt = (window as any).__reapHold ? 0 : rdt * this.timeK;
    this.t += dt;
    for (let i = this.waits.length - 1; i >= 0; i--) {
      if (this.t >= this.waits[i].at) {
        const w = this.waits.splice(i, 1)[0];
        w.res();
      }
    }
    this.updateHeart(dt);
    this.updateSoul(dt);
    this.updateArm(dt);
    this.updateLights(dt);
    this.updateGrade(rdt);
    this.updateCamera(dt);
    if (this.line) {
      this.lineT += dt;
      this.placeLine(1 - Math.exp(-6 * dt));
      this.line.update(dt, this.ctx.camera, (c, i, s) => Voice.syllable('anubis', c, { index: i, text: s }));
      if (this.lineT > 1.5) this.line.show(false);
    }
    this.fx.update(dt, this.ctx.scene.fog as THREE.Fog);
  }

  // ---------------------------------------------------------------- the heart
  private updateHeart(dt: number) {
    const h = this.heart;
    if (!h) return;
    const t = this.t;
    // beats: lub (and a softer dub a quarter-beat later), each weaker and the last barely there
    for (const b of this.beats)
      if (!b.done && t >= b.at && this.phase === 'heart') {
        b.done = true;
        this.beat = 0;
        this.beatK = b.k;
        this.wrapLoose += 0.25;
        this.sfx('heartbeat', 0.35 + 0.65 * b.k, 0.78 + 0.22 * b.k);
        this.shake = Math.max(this.shake, 0.12 * b.k);
      }
    this.beat += dt;
    const ph = this.beat;
    const lub = Math.exp(-(((ph - 0.02) / 0.07) ** 2)) + 0.6 * Math.exp(-(((ph - 0.3) / 0.08) ** 2));
    const k = lub * this.beatK;
    const last = this.beats[this.beats.length - 1];
    if (last?.done && this.beat > 0.6) this.heartDead = Math.min(1, this.heartDead + dt * 0.8);
    const n = h.nodes;
    const sq = 1 + k * 0.13;
    n['heart']?.scale.set(sq * 1.02, sq, sq);
    for (const v of ['aorta', 'pulmonary', 'vena']) n[v]?.scale.setScalar(1 + k * 0.16);
    const axes = (h.geo.spec.meta?.wrapAxes as [number, number, number][] | undefined) ?? [];
    for (let i = 0; i < 6; i++) {
      const w = n['wrap' + (i + 1)];
      if (!w) continue;
      const loose = clamp(this.wrapLoose * 1.4 - (5 - i) * 0.18, 0, 1);
      const ax = axes[i] ?? [0, 1, 0];
      this.v1.set(ax[0], ax[1], ax[2]).normalize();
      w.quaternion.setFromAxisAngle(this.v1, loose * (0.45 + 0.06 * Math.sin(t * 2 + i)));
    }
    // light from inside: a red pulse through the ribs, greying out when it stops
    const dead = this.heartDead;
    const tint = this.heartMat!.userData.tint.value;
    tint.setRGB(lerp(1 + k * 0.8, 0.42, dead), lerp(1 + k * 0.15, 0.38, dead), lerp(1 + k * 0.1, 0.4, dead));
    if (this.heartGlow) this.heartGlow.uniforms.uGain.value = this.phase === 'heart' ? (0.05 + k * 0.5) * (1 - dead) : 0;
    // the pulse lights the ribs from inside; a soft warm key from our side lets the heart itself read
    const L = this.lights[0]?.l, K = this.lights[1]?.l;
    if (L) {
      h.root.getWorldPosition(L.position);
      L.color.setHex(0xff3a24);
      L.distance = 1.6;
      L.intensity = this.phase === 'heart' ? (0.35 + k * 3.2) * (1 - dead) : 0;
    }
    if (K && this.phase === 'heart') {
      h.root.getWorldPosition(this.v2);
      K.position.copy(this.v2).lerp(this.ctx.camera.position, 0.4);
      K.color.setHex(0xffb08a);
      K.distance = 0.8;
      K.intensity = (0.35 + k * 0.6) * (1 - dead * 0.6);
    }
  }

  // ---------------------------------------------------------------- the soul
  private soulCenter(out: V3) {
    const s = this.soul;
    if (s && s.root.visible && s.nodes['torso']) {
      s.root.updateMatrixWorld(true);
      return s.nodes['torso'].getWorldPosition(out);
    }
    return out.copy(this.S).add(V(0, 0.7, 0));
  }

  private updateSoul(dt: number) {
    const s = this.soul;
    if (!s || this.soulMode === 'off') return;
    this.soulT += dt;
    const m = this.soulMode;
    const T = this.soulT;
    const r = s.root;
    const body = this.h.player.rig;
    if (m === 'inside' && T <= dt + 1e-6) {
      // start exactly where the body is, in its pose
      body.root.updateMatrixWorld(true);
      body.root.matrixWorld.decompose(r.position, r.quaternion, r.scale);
      r.scale.setScalar(1);
      for (const k in s.nodes) {
        const a = body.nodes[k], b = s.nodes[k];
        if (!a || !b) continue;
        b.quaternion.copy(a.quaternion);
        b.position.copy(a.position);
      }
      this.soulPos.copy(r.position);
      this.soulYaw = this.soulYawTarget = new THREE.Euler().setFromQuaternion(r.quaternion, 'YXZ').y;
      r.visible = true;
    }
    if (!this.held) {
      // root: drift out of the body to the kneeling spot; yaw toward the camera, later toward the arm
      const toCam = Math.atan2(-this.away.x, -this.away.z);
      if (m === 'tear' || m === 'stagger' || m === 'kneel') this.soulYawTarget = toCam;
      this.soulYaw = dampAngle(this.soulYaw, this.soulYawTarget, m === 'turn' || m === 'guard' ? 5 : 3, dt);
      const g = this.ctx.world.groundAt(this.soulPos.x, this.soulPos.z);
      let lift = 0;
      if (m === 'tear') {
        this.soulPos.x = damp(this.soulPos.x, lerp(this.body.x, this.S.x, 0.45), 3, dt);
        this.soulPos.z = damp(this.soulPos.z, lerp(this.body.z, this.S.z, 0.45), 3, dt);
        lift = 0.35 * Math.sin(Math.min(1, T / 0.85) * Math.PI);
      } else if (m === 'stagger' || m === 'kneel' || m === 'turn' || m === 'guard') {
        this.soulPos.x = damp(this.soulPos.x, this.S.x, 4, dt);
        this.soulPos.z = damp(this.soulPos.z, this.S.z, 4, dt);
        lift = m === 'stagger' ? -this.kneeDrop * sstep(0.2, 0.65, T) * 0.6 : -this.kneeDrop;
      }
      const wantY = g + lift + (m === 'kneel' ? Math.sin(this.t * 1.7) * 0.012 : 0);
      this.soulPos.y = m === 'inside' ? this.soulPos.y : damp(this.soulPos.y, wantY, m === 'kneel' ? 9 : 6, dt);
      r.position.copy(this.soulPos);
      if (m !== 'inside') r.quaternion.setFromEuler(new THREE.Euler(0, this.soulYaw, 0, 'YXZ'));
    } else {
      // held in the god's fist: across the palm, head out of the thumb side
      r.position.x = damp(r.position.x, -0.86, 10, dt);
      r.position.y = damp(r.position.y, 0, 10, dt);
      r.position.z = damp(r.position.z, 0.05, 10, dt);
      this.q1.setFromEuler(new THREE.Euler(0.15, 0.2, -Math.PI / 2));
      r.quaternion.slerp(this.q1, 1 - Math.exp(-10 * dt));
    }
    // limbs
    const pose = POSE[m === 'inside' ? 'tear' : m === 'turn' ? 'turn' : m] ?? POSE.kneel;
    const t = this.t;
    const rate = m === 'inside' ? 1.2 : m === 'tear' ? 7 : m === 'guard' ? 22 : m === 'held' ? 9 : m === 'stagger' ? 6 : 4;
    for (const k in pose) {
      const n = s.nodes[k];
      if (!n) continue;
      let [x, y, z] = pose[k]!;
      if (m === 'held') {
        // thrashing in the grip
        const ph = t * 9 + k.length * 1.7;
        x += Math.sin(ph) * (k.startsWith('arm') ? 0.45 : k.startsWith('thigh') || k.startsWith('shin') ? 0.5 : 0.15);
        z += Math.sin(ph * 0.7 + 1) * (k.startsWith('arm') ? 0.3 : 0.05);
      } else if (m === 'kneel') {
        x += Math.sin(t * 1.7 + k.length) * 0.02; // shaking breath
      } else if (m === 'tear') {
        x += Math.sin(t * 23 + k.length) * 0.04 * (1 - Math.min(1, T)); // convulsing loose
      }
      n.rotation.set(damp(n.rotation.x, x, rate, dt), damp(n.rotation.y, y, rate, dt), damp(n.rotation.z, z, rate, dt));
    }
    if (s.nodes['jaw']) s.nodes['jaw'].rotation.x = damp(s.nodes['jaw'].rotation.x, m === 'tear' || m === 'held' ? 0.45 : m === 'turn' ? 0.25 : 0.05, 8, dt);
    // glow: wells up inside the body, flares on tearing loose, steady after
    const want = m === 'inside' ? 0.9 : m === 'tear' ? 2.2 : 1.35;
    this.soulGain = damp(this.soulGain, want, m === 'tear' ? 10 : 3, dt);
    const flick = 0.92 + 0.08 * Math.sin(t * 3.1) + 0.05 * Math.sin(t * 17);
    this.soulShell!.uniforms.uGain.value = this.soulGain * flick;
    this.soulCore!.opacity = clamp(this.soulGain * 0.3, 0, 0.42);
    // motes shed by the soul, wisps trailing off the shoulders
    if (Math.random() < dt * (m === 'tear' ? 90 : m === 'held' ? 50 : 18)) {
      const c = this.soulCenter(this.v1);
      this.fx.emit({ pos: { x: c.x + (Math.random() - 0.5) * 0.5, y: c.y + (Math.random() - 0.4) * 0.9, z: c.z + (Math.random() - 0.5) * 0.5 }, vel: { x: 0, y: 0.5, z: 0 }, count: 1, spread: 0.3, life: [0.6, 1.4], size: [0.05, 0.012], sprite: Math.random() < 0.3 ? 'glow8' : 'dot3', color: JADE, additive: true, drag: 0.8, gravity: -0.4 });
    }
    if (Math.random() < dt * 6) {
      const c = this.soulCenter(this.v1);
      this.fx.emit({ pos: { x: c.x, y: c.y + 0.3, z: c.z }, vel: { x: (Math.random() - 0.5) * 0.4, y: 0.7, z: (Math.random() - 0.5) * 0.4 }, count: 1, life: [1.2, 2], size: [0.25, 0.7], sprite: ['cloud0', 'cloud2'], color: 0x4fd0c0, alpha: 0.1, additive: true, rot: 3, rotSpeed: 0.5 });
    }
    // the soul's light
    const L = this.lights[1]?.l;
    if (L) {
      this.soulCenter(L.position);
      L.color.setHex(0x6fffe0);
      L.distance = 7;
      L.intensity = this.soulGain * 7;
    }
  }

  // ---------------------------------------------------------------- the arm
  /** the arm's current pose → the rig (rise and tilt on the root, the wrist, every finger) */
  private poseArm(t: number) {
    const a = this.arm;
    if (!a) return;
    const p = this.ap;
    const r = a.root;
    r.position.set(p.shiftX, -1.7 + p.rise + p.shiftY, p.shiftZ);
    r.rotation.set(p.tilt, p.twist, Math.sin(t * 0.6) * 0.03);
    const n = a.nodes;
    n['palm']?.rotation.set(p.flex, 0, Math.sin(t * 0.8) * 0.05);
    for (let f = 1; f <= 4; f++) {
      const ripple = this.armMode === 'loom' || this.armMode === 'shrug' ? Math.sin(t * 2.4 - f * 0.7) * 0.18 : 0;
      for (let k = 1; k <= 3; k++) {
        const j = n[`f${f}_${k}`];
        if (!j) continue;
        const rest = a.geo.parts[a.geo.index[`f${f}_${k}`]].rest;
        j.rotation.set(rest.x + p.curl * (k === 1 ? 0.9 : 1.1) + ripple * (k === 1 ? 1 : 0.6), rest.y, rest.z + (k === 1 ? (f - 2.5) * p.spread * 0.6 : 0));
      }
    }
    for (let k = 1; k <= 3; k++) {
      const j = n[`t_${k}`];
      if (!j) continue;
      const rest = a.geo.parts[a.geo.index[`t_${k}`]].rest;
      j.rotation.set(rest.x + p.thumb * (k === 1 ? 0.5 : 0.8), rest.y - p.thumb * (k === 1 ? 0.6 : 0), rest.z + (k === 1 ? -p.thumb * 0.7 + p.spread : 0));
    }
  }

  private gripPoint() {
    if (!this.arm || this.armMode === 'hidden') return null;
    this.arm.sockets['grip'].getWorldPosition(this.grip);
    return this.grip;
  }

  private updateArm(dt: number) {
    this.armT += dt;
    const a = this.arm;
    if (!a) return;
    const T = this.armT;
    const t = this.t;
    const p = this.ap;
    const m = this.armMode;
    const B = this.B0;
    a.root.visible = m !== 'hidden';
    switch (m) {
      case 'hidden':
        p.rise = -11;
        break;
      case 'rumble': {
        // the sand trembles and bulges where it will break
        p.rise = -11;
        const k = Math.min(1, T / 1.2);
        this.shake = Math.max(this.shake, 0.22 * k);
        if (Math.random() < dt * 60 * k) {
          const ang = Math.random() * Math.PI * 2, rr = Math.random() * 2.4 * (1.2 - k * 0.4);
          const x = B.x + Math.cos(ang) * rr, z = B.z + Math.sin(ang) * rr;
          this.fx.emit({ pos: { x, y: this.ctx.world.groundAt(x, z) + 0.05, z }, count: 3, spread: 0.6, up: 1.2 + k * 2.5, life: [0.3, 0.7], size: [0.05, 0.08], sprite: ['dot3', 'grain0', 'grain2'], color: SAND, gravity: 12, ground: true });
        }
        if (Math.random() < dt * 8 * k) this.fx.emit({ pos: { x: B.x, y: B.y + 0.1, z: B.z }, count: 2, spread: 1.6, up: 0.4, life: [1, 1.8], size: [0.6, 1.4], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.35, drag: 2 });
        break;
      }
      case 'burst': {
        // up through the sand, overshooting, the hand thrown open
        const k = Math.min(1, T / 0.45);
        const o = 1 - Math.pow(1 - k, 3);
        p.rise = lerp(-11, 0, o) + Math.sin(Math.min(1, T / 0.7) * Math.PI) * 0.6 * sstep(0.3, 1, T / 0.45);
        p.tilt = damp(p.tilt, 0.05, 8, dt);
        p.flex = damp(p.flex, -0.45, 8, dt);
        p.curl = damp(p.curl, -0.1, 8, dt);
        p.spread = damp(p.spread, 0.35, 8, dt);
        p.thumb = damp(p.thumb, -0.2, 8, dt);
        if (T < 0.5 && Math.random() < dt * 80) this.sandAt(this.armEntry(this.v1), 4, 6);
        break;
      }
      case 'loom': {
        // the hand bends over the soul like a claw and breathes, fingers rippling
        p.rise = damp(p.rise, 0.25 + Math.sin(t * 1.1) * 0.12, 3, dt);
        p.tilt = damp(p.tilt, 0.24 + Math.sin(t * 0.7) * 0.03, 2.2, dt);
        p.flex = damp(p.flex, 0.7 + Math.sin(t * 0.9) * 0.05, 2.2, dt);
        p.curl = damp(p.curl, 0.55, 2, dt);
        p.spread = damp(p.spread, 0.2, 2, dt);
        p.thumb = damp(p.thumb, 0.1, 2, dt);
        break;
      }
      case 'strike': {
        // rear back (first third), then the lunge lands on the soul at strikeDur
        const k = T / this.strikeDur;
        const wind = this.strikeDur > 0.6 ? 0.36 : 0.12;
        if (k < wind) {
          const w = k / wind;
          p.tilt = damp(p.tilt, -0.06, 9, dt);
          p.flex = damp(p.flex, -0.3, 9, dt);
          p.curl = damp(p.curl, 0.0, 9, dt);
          p.spread = damp(p.spread, 0.3, 9, dt);
          p.rise = damp(p.rise, 0.4 + w * 0.3, 9, dt);
        } else {
          const u = clamp((k - wind) / (1 - wind), 0, 1);
          const e = u * u * (1.6 - 0.6 * u); // accelerating into the blow
          p.tilt = lerp(-0.06, 0.62, e);
          p.flex = lerp(-0.3, 1.0, e);
          p.curl = lerp(0, 0.32, e);
          p.spread = lerp(0.3, 0.15, e);
          p.rise = lerp(0.7, 0, e);
          p.shiftX = this.strikeShift.x * e;
          p.shiftY = this.strikeShift.y * e;
          p.shiftZ = this.strikeShift.z * e;
        }
        break;
      }
      case 'recoil': {
        // knocked back: a stiff spring on the tilt, fingers flung open, a jolt down the wrist
        this.recoil += this.recoilV * dt;
        this.recoilV += (-90 * this.recoil - 9 * this.recoilV) * dt;
        p.tilt = damp(p.tilt, 0.3, 3, dt) - this.recoil * 0.08;
        p.flex = damp(p.flex, 0.2, 4, dt) - this.recoil * 0.12;
        p.curl = damp(p.curl, -0.25, 10, dt);
        p.spread = damp(p.spread, 0.4, 10, dt);
        p.shiftX = damp(p.shiftX, this.strikeShift.x * 0.4, 4, dt);
        p.shiftY = damp(p.shiftY, this.strikeShift.y * 0.4, 4, dt);
        p.shiftZ = damp(p.shiftZ, this.strikeShift.z * 0.4, 4, dt);
        p.rise = damp(p.rise, 0.5, 4, dt);
        break;
      }
      case 'shrug': {
        // a flick of the wrist, a slow flex of the fingers: unimpressed
        this.recoil = damp(this.recoil, 0, 6, dt);
        p.tilt = damp(p.tilt, 0.3, 3, dt);
        p.flex = damp(p.flex, 0.35 + Math.sin(T * 9) * 0.08 * Math.max(0, 1 - T), 4, dt);
        p.twist = Math.sin(T * 7) * 0.12 * Math.max(0, 1 - T * 1.2);
        p.curl = damp(p.curl, 0.5 + Math.sin(T * 3) * 0.2, 3, dt);
        p.spread = damp(p.spread, 0.1, 3, dt);
        p.thumb = damp(p.thumb, 0.3, 3, dt);
        p.shiftX = damp(p.shiftX, this.strikeShift.x * 0.4, 3, dt);
        p.shiftY = damp(p.shiftY, this.strikeShift.y * 0.4, 3, dt);
        p.shiftZ = damp(p.shiftZ, this.strikeShift.z * 0.4, 3, dt);
        p.rise = damp(p.rise, 0.5, 3, dt);
        break;
      }
      case 'grab': {
        // the fingers close round the soul, the thumb locks over
        p.twist = damp(p.twist, 0, 6, dt);
        p.curl = damp(p.curl, 1.12, 7, dt);
        p.thumb = damp(p.thumb, 0.95, 7, dt);
        p.spread = damp(p.spread, 0, 7, dt);
        p.rise = damp(p.rise, Math.sin(T * 30) * 0.03 * Math.max(0, 1 - T * 2), 10, dt);
        break;
      }
      case 'lift': {
        // a heave: the fist comes up with its prize
        p.rise = damp(p.rise, 0.9, 6, dt);
        p.tilt = damp(p.tilt, 0.25, 5, dt);
        p.flex = damp(p.flex, 0.45, 5, dt);
        p.curl = damp(p.curl, 1.2, 8, dt);
        break;
      }
      case 'drag': {
        // straight down into the sand, accelerating; the sand swirls in after it
        const k = Math.min(1, T / 1.0);
        p.rise = 0.9 - 12 * k * k;
        p.tilt = damp(p.tilt, 0, 4, dt);
        p.flex = damp(p.flex, 0.2, 4, dt);
        p.shiftX = damp(p.shiftX, 0, 2, dt);
        p.shiftZ = damp(p.shiftZ, 0, 2, dt);
        this.shake = Math.max(this.shake, 0.4);
        this.vortex(dt, k);
        break;
      }
    }
    this.poseArm(t);
    // the god's breath: cold vapour off the cuff and the knuckles; sand pouring off the arm as it rises
    if (m !== 'hidden' && m !== 'rumble' && p.rise > -6) {
      if (Math.random() < dt * 22) {
        const sock = ['wrist_back', 'palm_c', 'tip'][Math.floor(Math.random() * 3)];
        a.sockets[sock].getWorldPosition(this.v1);
        this.fx.emit({ pos: { x: this.v1.x + (Math.random() - 0.5) * 0.8, y: this.v1.y, z: this.v1.z + (Math.random() - 0.5) * 0.8 }, vel: { x: 0, y: 0.8, z: 0 }, count: 1, spread: 0.3, life: [1, 2], size: [0.14, 0.03], sprite: Math.random() < 0.5 ? 'glow8' : 'dot4', color: [0x6fd8ff, 0xc8f8ff, 0xffe6a0], additive: true, drag: 0.6, gravity: -0.3 });
      }
      if (T < 2.5 && (m === 'burst' || m === 'loom') && Math.random() < dt * 40) {
        a.sockets['wrist_back'].getWorldPosition(this.v1);
        this.fx.emit({ pos: { x: this.v1.x + (Math.random() - 0.5) * 1.6, y: this.v1.y + Math.random() * 2, z: this.v1.z + (Math.random() - 0.5) * 1.6 }, count: 2, spread: 0.3, life: [0.6, 1.2], size: [0.05, 0.07], sprite: ['dot3', 'grain1'], color: SAND, gravity: 10, ground: true });
      }
    }
    // spirit shell and runes wake with it
    const on = m === 'hidden' || m === 'rumble' ? 0 : 1;
    if (this.armShell) this.armShell.uniforms.uGain.value = damp(this.armShell.uniforms.uGain.value, on * (0.2 + 0.04 * Math.sin(t * 2.3)), 3, dt);
    if (this.armMat) this.armMat.userData.emissiveStrength.value = damp(this.armMat.userData.emissiveStrength.value, on * (1.6 + Math.sin(t * 3.7) * 0.3), 2, dt);
  }

  /** where the forearm breaks the sand (for dust) */
  private armEntry(out: V3) {
    return out.copy(this.B0).add(V(this.ap.shiftX, 0, this.ap.shiftZ).applyAxisAngle(V(0, 1, 0), this.armHolder.rotation.y));
  }

  private sandAt(p: V3, n: number, up: number) {
    this.fx.emit({ pos: { x: p.x, y: p.y + 0.2, z: p.z }, count: n, spread: 2.2, up, jitter: 0.9, life: [0.5, 1.2], size: [0.06, 0.1], sprite: ['dot3', 'dot4', 'grain0'], color: SAND, gravity: 12, ground: true });
  }

  /** the sand pouring into the hole behind the sinking fist */
  private vortex(dt: number, k: number) {
    const c = this.armEntry(this.v2);
    c.y = this.ctx.world.groundAt(c.x, c.z);
    const n = Math.floor(dt * 160) + (Math.random() < (dt * 160) % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 3.2 * (1 - k * 0.4);
      const tx = -Math.sin(a), tz = Math.cos(a);
      this.fx.emit({ pos: { x: c.x + Math.cos(a) * r, y: c.y + 0.06, z: c.z + Math.sin(a) * r }, vel: { x: tx * 4 - Math.cos(a) * 2.5, y: -0.4, z: tz * 4 - Math.sin(a) * 2.5 }, count: 1, life: [0.4, 0.9], size: [0.05, 0.08], sprite: ['dot3', 'grain1', 'grain2'], color: SAND, drag: 0.6 });
    }
    if (Math.random() < dt * 14) this.fx.emit({ pos: { x: c.x, y: c.y + 0.3, z: c.z }, count: 2, spread: 2.4, up: 1.4, life: [1.2, 2.4], size: [0.8, 2.2], sprite: ['puff0', 'puff2'], color: 0xe2c894, alpha: 0.45, drag: 1.6, rot: 3, rotSpeed: 1.2 });
    if (Math.random() < dt * 10) this.ctx.events.emit('gibs', c.x, c.y + 0.3, c.z, 3, 0.22, SAND, 3, 3);
  }

  // ---------------------------------------------------------------- light, sky, grade
  private updateLights(dt: number) {
    const L = this.lights[2]?.l;
    if (!L) return;
    this.flare = damp(this.flare, 0, 5, dt);
    const a = this.arm;
    if (a && this.armMode !== 'hidden' && this.armMode !== 'rumble' && this.flare < 1) {
      // between the hand and the soul: a cold light on both, never a hot spot on the palm
      a.sockets['palm_c'].getWorldPosition(L.position);
      L.position.lerp(this.soulCenter(this.v1), 0.5);
      L.color.setHex(0x7fd8ff);
    }
    L.distance = 13;
    const on = this.arm && this.armMode !== 'hidden' && this.armMode !== 'rumble' ? 1 : 0;
    L.intensity = on * 15 + this.flare;
  }

  private updateGrade(rdt: number) {
    const eng = this.ctx.engine;
    const u = eng.post.u;
    const heart = this.phase === 'heart';
    const dead = this.heartDead;
    u.uDesat.value = heart ? 0.45 + dead * 0.45 : 0.5 - this.sky * 0.2;
    u.uVignette.value = heart ? 0.75 : 0.55 + this.sky * 0.15;
    u.uContrast.value = this.saved.con * (heart ? 1.08 : 1.05 + this.sky * 0.08);
    u.uSpirit.value = this.sky * 0.1;
    u.uTintShadows.value.setRGB(0.94, 0.98, 1.08);
    this.sky = damp(this.sky, this.skyTarget, 1.4, rdt);
    if (this.savedSky && this.sky > 0.002) {
      const a = this.savedSky;
      const dusk: EnvPreset = { ...a, zenith: 0x080a18, horizon: 0x3a2c48, ground: 0x2a2030, sunColor: 0x9fb8ff, sunIntensity: 1.3, hemiSky: 0x40507a, hemiGround: 0x3a3028, hemiIntensity: 0.75, fog: 0x2a2838, fogNear: Math.min(a.fogNear, 30), fogFar: Math.min(a.fogFar, 260), stars: 0.7, clouds: Math.max(a.clouds, 0.85), cloudColor: 0x2a2638 };
      this.ctx.world.env.lerpPreset(a, dusk, this.sky);
    }
  }

  // ---------------------------------------------------------------- camera
  private updateCamera(dt: number) {
    if (!this.shot) return;
    this.shotT += dt;
    const s = this.shot(this.shotT);
    let p = s.p, l = s.l, fov = s.fov;
    if (this.camBlendDur > 0 && this.shotT < this.camBlendDur) {
      const k = sstep(0, 1, this.shotT / this.camBlendDur);
      p = this.camFrom.p.clone().lerp(s.p, k);
      l = this.camFrom.l.clone().lerp(s.l, k);
      fov = lerp(this.camFrom.fov, s.fov, k);
    }
    this.shake = damp(this.shake, 0, 2.4, dt);
    const sh = this.shake * this.shake;
    const t = this.t;
    const hand = V(Math.sin(t * 0.71) * 0.03 + Math.sin(t * 31) * sh * 0.12, Math.sin(t * 0.53) * 0.025 + Math.sin(t * 27 + 1) * sh * 0.12, Math.sin(t * 29 + 2) * sh * 0.06);
    // never inside a dune (the dive goes right down to the sand)
    const g = this.ctx.world.groundAt(p.x, p.z) + (this.phase === 'dive' ? 0.12 : 0.25);
    if (p.y < g) p = p.clone().setY(g);
    this.cam.p.copy(p);
    this.cam.l.copy(l);
    this.cam.fov = fov;
    const cam = this.ctx.camera;
    cam.position.copy(p).add(hand);
    // looking straight down into the hole, the top of the frame points toward the arm
    if (this.phase === 'dive') cam.up.copy(this.away).lerp(UP, 1 - sstep(0, 0.4, this.diveT)).normalize();
    else cam.up.set(0, 1, 0);
    cam.lookAt(l);
    if (this.phase === 'rise' || this.phase === 'drag') cam.rotateZ(Math.sin(t * 0.4) * 0.02 + (this.phase === 'rise' ? 0.05 : -0.04)); // a little dutch
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  /** close and heavy: up through the open bottom of the rib cage, the ribs arching over the heart, creeping in */
  private shotHeart = (t: number) => {
    const h = this.heart;
    const torso = this.h.player.rig.nodes['torso'];
    if (!h || !torso) return { p: this.cam.p.clone(), l: this.cam.l.clone(), fov: this.cam.fov };
    const local = h.root.position;
    const k = sstep(0, 4.6, t);
    torso.updateWorldMatrix(true, false);
    const pc = torso.localToWorld(HEART_CAM.clone().multiplyScalar(lerp(1, 0.8, k)).add(local));
    const lc = torso.localToWorld(V(local.x, local.y + 0.012, local.z));
    return { p: pc, l: lc, fov: lerp(42, 36, k) };
  };
  /** the body and the soul tearing out of it: a three-quarter shot, low, drifting */
  private shotSoul = (t: number) => {
    const fwd = this.away.clone().negate();
    const c = this.body.clone().lerp(this.S, sstep(0.4, 3, t));
    const p = c.clone().addScaledVector(fwd, 3.0 - t * 0.12).addScaledVector(this.side, 1.5 + t * 0.1).add(V(0, 0.75, 0));
    return { p, l: c.clone().add(V(0, 0.75 - sstep(1.5, 3, t) * 0.25, 0)), fov: 46 };
  };
  /** low and wide behind the kneeling soul: the arm towers out of the sand */
  private shotRise = (t: number) => {
    const fwd = this.away.clone().negate();
    const p = this.S.clone().addScaledVector(fwd, 4.6 - Math.min(t, 4) * 0.12).addScaledVector(this.side, -1.3).add(V(0, 0.35, 0));
    const up = sstep(0.9, 2.2, t);
    const l = this.S.clone().lerp(this.B0, 0.5).add(V(0, lerp(0.9, 2.3, up), 0));
    return { p, l, fov: lerp(55, 64, up) };
  };
  /** over the soul's shoulder into the incoming palm */
  private shotParry = (t: number) => {
    const fwd = this.away.clone().negate();
    // just behind the soul's right shoulder: its head in the corner, the palm coming down at us
    const p = this.S.clone().addScaledVector(fwd, 1.35).addScaledVector(this.side, 0.6).add(V(0, 1.05, 0));
    const g = this.gripPoint();
    const l = (g ? g.clone() : this.B0.clone().add(V(0, 3, 0))).lerp(this.soulCenter(V()).add(V(0, 0.3, 0)), 0.3);
    return { p, l, fov: 58 - Math.min(1, t) * 4 };
  };
  /** side-on two-shot for the god's verdict on the parry */
  private shotJoke = (t: number) => {
    const c = this.S.clone().lerp(this.B0, 0.45);
    const p = c.clone().addScaledVector(this.side, 6.4).addScaledVector(this.away, -1.6).add(V(0, 1.6 + t * 0.05, 0));
    return { p, l: c.add(V(0, 2.2, 0)), fov: 54 };
  };
  /** down into the hole after the fist: the camera drops onto the vortex, turning to look straight down */
  private shotDive = (t: number) => {
    const e = this.armEntry(V());
    e.y = this.ctx.world.groundAt(e.x, e.z);
    const k = sstep(0, 1.1, t);
    const p = this.cam.p.clone().lerp(e.clone().add(V(0, 1.5, 0)), k * k);
    const l = e.clone().add(V(0, -3, 0)).addScaledVector(this.away, 0.6 * (1 - k));
    return { p, l, fov: lerp(52, 88, k) };
  };
  /** sand streaming up past the lens and closing over it */
  private updateDive(rdt: number) {
    this.diveT += rdt;
    const k = sstep(0, 1.1, this.diveT);
    const cam = this.ctx.camera;
    const fwd = cam.getWorldDirection(this.v2);
    const n = Math.floor(rdt * (80 + 340 * k)) + 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * (1.4 - k * 0.8);
      const d = 0.35 + Math.random() * (1.6 - k * 0.9);
      const right = V(1, 0, 0).applyQuaternion(cam.quaternion), up = V(0, 1, 0).applyQuaternion(cam.quaternion);
      const at = cam.position.clone().addScaledVector(fwd, d).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      const big = Math.random() < 0.15 + 0.4 * k;
      this.fx.emit({ pos: at, vel: { x: -fwd.x * 6, y: -fwd.y * 6 + 1, z: -fwd.z * 6 }, count: 1, life: [0.3, 0.7], size: big ? [0.8, 1.8] : [0.03, 0.06], sprite: big ? ['puff0', 'puff1', 'puff2'] : ['dot3', 'grain1', 'streak'], color: big ? [0x7a5e40, 0x6a5238, 0x5a4630] : SAND, alpha: big ? 0.92 : 1, stretch: big ? 0 : 0.08, drag: 1 });
    }
  }

  /** high over the fist and down into the hole as the sand takes it */
  private shotDrag = (t: number) => {
    const fwd = this.away.clone().negate();
    const e = this.armEntry(V());
    const p = this.S.clone().addScaledVector(fwd, 3.8 - t * 0.3).addScaledVector(this.side, 1.6).add(V(0, 2.4 + t * 0.4, 0));
    const g = this.gripPoint();
    const l = this.phase === 'drag' ? e.clone().add(V(0, Math.max(0, 1.6 - this.armT * 2.4), 0)) : g ? g.clone() : e.clone().add(V(0, 2, 0));
    return { p, l, fov: 50 };
  };

  // =========================================================================== teardown
  private teardown() {
    const eng = this.ctx.engine;
    const i = eng.onAfterUpdate.indexOf(this.tick);
    if (i >= 0) eng.onAfterUpdate.splice(i, 1);
    if (this.h.qte.active && !this.h.qte.active.done) this.h.qte.cancel();
    this.line?.dispose();
    this.line = null;
    for (const o of this.objs) o.removeFromParent();
    this.soul?.root.removeFromParent();
    // particle layers belong to this sequence
    for (const o of this.fx.group.children) {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose?.();
    }
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const { l, L } of this.lights) {
      l.intensity = 0;
      L.t = 1;
      L.dur = 1;
      L.i0 = 0;
    }
    const u = eng.post.u;
    const sv = this.saved;
    if (sv.tS) {
      u.uDesat.value = sv.desat;
      u.uVignette.value = sv.vig;
      u.uContrast.value = sv.con;
      u.uSaturation.value = sv.sat;
      u.uSpirit.value = sv.spirit;
      u.uTintShadows.value.copy(sv.tS);
      u.uTintHighlights.value.copy(sv.tH);
    }
    if (this.savedSky) this.ctx.world.env.apply(this.savedSky);
    eng.audio.setMuffle(0, 0.2);
    this.h.qte.hold = null;
    if (!this.h.handoff) eng.letterbox(false, 0.01);
    if ((window as any).__reaping === this) delete (window as any).__reaping;
  }
}

/**
 * Build the heavy pieces (the wrapped heart, the arm of Anubis with its spirit normals)
 * ahead of time so the death itself never hitches (~1.5 s of CPU in all). `now` builds
 * them on the spot (call it while the run is loading); otherwise one per idle moment.
 * Safe to call more than once.
 */
export function prewarmReaping(now = false) {
  const idle = (fn: () => void) => (now ? fn() : (window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 300));
  idle(() => {
    try {
      buildRigGeo(hudHeartRig(), 'hud_heart');
    } catch {
      /* built on demand */
    }
    idle(() => {
      try {
        const spec = anubisArmRig();
        const g = buildRigGeo(spec, 'anubis_arm:reap');
        for (const p of g.parts) if (!p.geo.getAttribute('snormal')) spiritNormals(p.geo, p.model, p.pivot, spec.voxelSize, 2);
      } catch {
        /* built on demand */
      }
    });
  });
}

function dampAngle(a: number, b: number, l: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-l * dt));
}
