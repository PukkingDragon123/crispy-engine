// THE SPHINX — the gate of the Nile (wave 50, region A). A ~33 m living
// limestone colossus with a lion's body and a pharaoh's sly face, lying in
// front of the bronze river gate. It sleeps until the hunter rides close, then
// wakes, shakes off a thousand years of dust and plays with him like a cat with
// a toy: mean, delighted, never in a hurry. Every move is a song title.
//   Phase 1 (100–66%)  Jumpin' Jack Flash (a paw bat that sends you flying),
//                      Hello, Goodbye (swatted back and forth between its
//                      paws), Under My Thumb (pinned under a paw: mash to
//                      wriggle free), Live and Let Die (the pounce: butt
//                      wiggle, leap, two-pawed slam), You Could Be Mine (the
//                      tail whip: jump it), Twist and Shout (a roar that
//                      sprays sand out of its mouth), Sympathy for the Devil
//                      (a riddle in floating 3D type: ride into the answer)
//   Phase 2 (66–33%)   + I Want to Hold Your Hand (scooped up in a paw and held
//                      up to its face: time the squirm or be flung), Roll Over
//                      Beethoven (it rolls onto its back: quakes, belly and
//                      gem exposed), Run for Your Life (it bounds after you)
//   Phase 3 (33–0%)    enraged: Street Fighting Man (chained flurries), blazing
//                      eyes, every seam burning.
// Weak points: the eyes (x2.6), the chest gem (x1.6, x3 while exposed), and
// five crack sites that open into glowing seams as it takes damage.
// Death: "Knockin' on Heaven's Door" — every crack flares, the statue breaks
// apart into tumbling blocks, the head rolls into the river and the river gate
// swings open (the wave ends and the run travels on to region B).
// Rendering: the rig is built in a worker (models/sphinx/*) and swapped in for
// the Boss base's placeholder; its materials keep cracks dark until they open.
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere, Cancelled } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import { RigInstance } from '../../engine/voxel/Rig';
import { RigEyes } from '../fx/FaceFx';
import { speak3D, say3D, hush3D } from '../fx/WorldSpeech';
import { FloatText3D } from '../fx/FloatText3D';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { loadSphinxGeos, sphinxGeos, releaseSphinxGeos, type SphinxGeos } from './sphinx/SphinxGeo';
import { sphinxStone, stoneUniforms, type StoneU } from './sphinx/SphinxMaterial';
import type { VoxelMaterial } from '../../engine/render/VoxelMaterial';

type V3 = [number, number, number];
const TAU = Math.PI * 2;
const COL = '#ffc76a';
const GOLDC = '#ffd98a';
const STONE = [0xe0cba0, 0xd2b98d, 0xc4a77c, 0xeee0bc, 0xb39468];
const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a];
const WATER = [0xe8f6f2, 0xb8dcd6, 0x8ec4bc, 0xffffff];
const GRAINS = ['grain0', 'grain1', 'grain2', 'grain3'];
const PUFFS = ['puff0', 'puff1', 'puff2', 'cloud0'];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _L = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** what the Sphinx can use from the Nile world, if it is there (every field optional) */
interface NileWorldLike {
  gate?: { x: number; z: number; yaw?: number };
  openGate?(): void;
}

interface Leg {
  front: boolean;
  side: number;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  toes: THREE.Object3D[];
  /** rest (rig-local metres): joints and the sole centre */
  J0: THREE.Vector3;
  J1: THREE.Vector3;
  J2: THREE.Vector3;
  sole: THREE.Vector3;
  L1: number;
  L2: number;
  u0: THREE.Vector3;
  f0: THREE.Vector3;
  soleOff: THREE.Vector3;
  mode: 'plant' | 'aim' | 'body';
  plant: THREE.Vector3;
  step: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null;
  tgt: THREE.Vector3;
  now: THREE.Vector3;
  rate: number;
  /** paw orientation relative to the body (pitch, roll, yaw) */
  ori: THREE.Vector3;
  oriNow: THREE.Vector3;
  curl: number;
  curlNow: number;
  /** body-mode target (rig-local metres) */
  local: THREE.Vector3;
}

interface Ring {
  x: number;
  z: number;
  r: number;
  speed: number;
  max: number;
  dmg: number;
  knock: number;
  hit: boolean;
  fx: number;
}

interface Chunk {
  node: THREE.Object3D;
  v: THREE.Vector3;
  w: THREE.Vector3;
  t: number;
  landed: boolean;
  sink: number;
}

export class Sphinx extends Boss {
  private G: SphinxGeos | null = null;
  private ready = false;
  private U: StoneU;
  private gemU: StoneU;
  private siteU: Record<string, StoneU> = {};
  private mats: VoxelMaterial[] = [];
  private sites: { name: string; part: string; c: THREE.Vector3; r: number; open: number; at: number; sphere: HitSphere }[] = [];
  private legs: Leg[] = [];
  private rest: Record<string, THREE.Vector3> = {};
  private j: Record<string, any> = {};
  // ------------------------------------------------------------ pose targets / current values
  private P = { rear: 0, front: 0, roll: 0, lean: 0, twist: 0, foreZ: 0, hindZ: 0, foreX: 0, hindX: 0, rate: 2.2 };
  private N = { rear: -5, front: -4.6, roll: 0, lean: 0, twist: 0, foreZ: 4.5, hindZ: 3.4, foreX: 0.4, hindX: 1.2 };
  private air = 0;
  private airPitch = 0;
  private look: THREE.Vector3 | null = null;
  private lookV = new THREE.Vector3();
  private lookRate = 2.2;
  private headYaw = 0;
  private headPitch = 0;
  private headTilt = 0;
  private tiltT = 0;
  private jaw = 0;
  private jawT = 0;
  private headDown = 0;
  private headDownT = 0;
  private tailMood = 0.3;
  private whip = 0;
  private whipT = 0;
  private whipSide = 1;
  private tailUp = 0;
  private tailUpT = 0;
  private wiggle = 0;
  private pupil: 'slit' | 'wide' | 'shut' = 'shut';
  private blinkT = 0;
  private turnRate = 0.9;
  private walkTo: THREE.Vector3 | null = null;
  private walkSpeed = 0;
  private grind = 0;
  private grindSfxT = 0;
  private fxT = 0;
  private dormant = true;
  private dead = false;
  private exposedT = 0;
  private gemOpenT = 0;
  private stunT = 0;
  private dazeT = 0;
  // ------------------------------------------------------------ hunter handling
  private hold: { at: () => THREE.Vector3; squeeze: number } | null = null;
  private rings: Ring[] = [];
  private queue: string[] = [];
  private cds = { pin: 4, grab: 10, roll: 18, chase: 6, roar: 6, riddle: 0, whip: 0, pounce: 3 };
  private riddles = 0;
  private lastAttack = '';
  private lastCallout = '';
  /** what it is doing (dev / tests) */
  dbg = '';
  // ------------------------------------------------------------ the gate and the corpse
  private gate: RigInstance | null = null;
  private gateMat: VoxelMaterial | null = null;
  private gateOpen = 0;
  private gateOpenT = 0;
  private chunks: Chunk[] = [];
  private seamLight: THREE.PointLight;
  private gemLight: THREE.PointLight;
  private eyeSphere: HitSphere[] = [];
  private gemSphere: HitSphere;
  private pawSpheres: HitSphere[] = [];
  private plantedWeak = 0;
  private offRelease: (() => void) | null = null;
  private riddleUI: { plaques: FloatText3D[]; pts: THREE.Vector3[]; marks: unknown[] } | null = null;

  constructor(d: BossDeps, private tier = 2) {
    // the base builds a cheap placeholder; the real rig (carved off-thread) is swapped in when ready
    super(d, 'sphinx_placeholder', { name: 'The Sphinx', title: 'Keeper of the River Gate', hp: 6500 * tier, scale: 1, eyes: ['glow', 0xffb43a] });
    this.root.visible = false;
    this.armor = 52;
    this.physRes = 0.14;
    this.magicRes = 0.12;
    this.statusRes = { poison: 0.6, bleed: 0.9, burn: 0.4, stun: 0.8 };
    this.bounty = 1400;
    this.gold = 560;
    this.phases = [0.66, 0.33];
    this.flying = true;
    this.squash.kick = () => {};
    this.invulnerable = true;
    this.radius = -50;
    this.height = 20.5;
    this.U = stoneUniforms({ glow: 0 });
    this.gemU = stoneUniforms({ glow: 0 });
    this.gemSphere = { node: 'gem', r: 1.25, part: 'gem', weak: 1.6 };
    this.seamLight = new THREE.PointLight(0xffb04a, 0, 26, 1.6);
    this.gemLight = new THREE.PointLight(0xff5a2a, 0, 16, 1.6);
    if (!d.enemies.qte) d.enemies.qte = d.qte;
    const g = sphinxGeos();
    if (g) this.adopt(g);
    else void loadSphinxGeos().then((gg) => this.alive && !this.dead && this.adopt(gg));
    bindSphinxRelease(this.ctx);
    (window as any).__sphinx = this; // dev handle: __sphinx.debug('pin')
  }

  protected hitKind() {
    return 'rock' as any;
  }
  /** a dying Sphinx stays 'alive' for the wave until its gate is open; its moves stop at once */
  protected check() {
    if (!this.alive || this.dead || this.escaped) throw new Cancelled();
  }

  // ================================================================== the real rig
  private adopt(g: SphinxGeos) {
    if (this.ready) return;
    this.G = g;
    const old = this.rig;
    this.root.remove(old.root);
    old.material.dispose();
    this.rig = new RigInstance(g.sphinx, { ownMaterial: true });
    this.root.add(this.rig.root);
    this.eyes = new RigEyes(this.rig, 'glow', 0xffb43a);
    const meta = g.sphinx.spec.meta ?? {};
    this.j = meta.j as Record<string, any>;
    // rest pivots (rig-local metres)
    for (const p of g.sphinx.parts) {
      const v = p.offset.clone();
      let pi = p.parent;
      while (pi >= 0) {
        v.add(g.sphinx.parts[pi].offset);
        pi = g.sphinx.parts[pi].parent;
      }
      this.rest[p.name] = v;
    }
    // materials: stone (dark cracks), crack sites (seams that open), the gem
    const fx = this.rig.material.userData.fx;
    const body = sphinxStone('body', fx, this.U);
    const gem = sphinxStone('body', fx, this.gemU);
    this.mats.push(body, gem);
    const siteDefs = (meta.sites as { name: string; part: string; c: V3; r: number }[]) ?? [];
    for (const s of siteDefs) {
      const u: StoneU = { ...this.U, open: { value: 0 }, reach: { value: s.r * 1.05 } };
      this.siteU[s.name] = u;
      const m = sphinxStone('site', fx, u);
      this.mats.push(m);
      if (this.rig.meshes[s.name]) this.rig.meshes[s.name].material = m;
      const sphere: HitSphere = { node: s.name, r: s.r * 0.62, part: s.name, weak: 0.6 };
      this.sites.push({ name: s.name, part: s.part, c: new THREE.Vector3(...s.c), r: s.r, open: 0, at: 0, sphere });
    }
    for (const [name, mesh] of Object.entries(this.rig.meshes)) {
      if (this.siteU[name]) continue;
      mesh.material = name === 'gem' ? gem : body;
    }
    this.rig.material.dispose();
    this.rig.material = body;
    this.setPupil('shut');
    // legs
    const V = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
    const n = this.rig.nodes;
    for (const front of [true, false])
      for (const side of [0, 1]) {
        const sd = side === 0 ? 'l' : 'r';
        const J0 = V(this.j[front ? 'sh' : 'hp'][side]), J1 = V(this.j[front ? 'el' : 'kn'][side]), J2 = V(this.j[front ? 'wr' : 'hk'][side]);
        const sole = V(this.j[front ? 'paw' : 'hpaw'][side]);
        const leg: Leg = {
          front, side,
          upper: n[(front ? 'arm_' : 'thigh_') + sd], lower: n[(front ? 'fore_' : 'shin_') + sd], end: n[(front ? 'paw_' : 'foot_') + sd],
          toes: front ? [1, 2, 3, 4].map((k) => n[`toe${k}_${sd}`]) : [],
          J0, J1, J2, sole,
          L1: J0.distanceTo(J1), L2: J1.distanceTo(J2),
          u0: J1.clone().sub(J0).normalize(), f0: J2.clone().sub(J1).normalize(),
          soleOff: sole.clone().sub(J2),
          mode: 'plant', plant: new THREE.Vector3(), step: null, tgt: new THREE.Vector3(), now: new THREE.Vector3(), rate: 6,
          ori: new THREE.Vector3(), oriNow: new THREE.Vector3(), curl: 0, curlNow: 0, local: new THREE.Vector3(),
        };
        this.legs.push(leg);
      }
    // hit spheres
    const off = (node: string, p: THREE.Vector3 | V3): [number, number, number] => {
      const q = (Array.isArray(p) ? V(p) : p.clone()).sub(this.rest[node]);
      return [q.x, q.y, q.z];
    };
    const mid = (a: V3, b: V3) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3;
    this.eyeSphere = [
      { node: 'eye_l', r: 0.62, part: 'eye', weak: 2.6 },
      { node: 'eye_r', r: 0.62, part: 'eye', weak: 2.6 },
    ];
    this.pawSpheres = [];
    const hs: HitSphere[] = [...this.eyeSphere, this.gemSphere];
    for (const s of this.sites) hs.push(s.sphere);
    const hc = this.j.hc as V3, hsc = this.j.hs as number;
    hs.push({ node: 'head', r: 3.1 * hsc * 0.85, part: 'head', weak: 1.05, offset: off('head', [hc[0], hc[1] + 0.4, hc[2] + 0.4]) });
    hs.push({ node: 'jaw', r: 1.5, part: 'jaw', weak: 0.9, offset: off('jaw', [hc[0], hc[1] - 2.3, hc[2] + 1.9]) });
    hs.push({ node: 'neck', r: 2.6, part: 'neck', weak: 0.65, offset: off('neck', [0, 12.0, 7.0]) });
    hs.push({ node: 'chest', r: 4.3, part: 'chest', weak: 0.55, offset: off('chest', [0, 9.6, 3.6]) });
    hs.push({ node: 'belly', r: 3.8, part: 'belly', weak: 0.5, offset: off('belly', [0, 9.6, -2.6]) });
    hs.push({ node: 'hips', r: 4.0, part: 'hips', weak: 0.5, offset: off('hips', [0, 9.6, -10.0]) });
    for (const side of [0, 1]) {
      const sd = side === 0 ? 'l' : 'r';
      const g2 = (k: string) => this.j[k][side] as V3;
      hs.push({ node: 'arm_' + sd, r: 2.0, part: 'leg', weak: 0.55, offset: off('arm_' + sd, mid(g2('sh'), g2('el'))) });
      hs.push({ node: 'fore_' + sd, r: 1.6, part: 'leg', weak: 0.55, offset: off('fore_' + sd, mid(g2('el'), g2('wr'))) });
      const paw: HitSphere = { node: 'paw_' + sd, r: 2.1, part: 'paw', weak: 0.7, offset: off('paw_' + sd, [g2('paw')[0], 0.9, g2('paw')[2]]) };
      this.pawSpheres.push(paw);
      hs.push(paw);
      hs.push({ node: 'thigh_' + sd, r: 2.5, part: 'leg', weak: 0.55, offset: off('thigh_' + sd, mid(g2('hp'), g2('kn'))) });
      hs.push({ node: 'shin_' + sd, r: 1.4, part: 'leg', weak: 0.55, offset: off('shin_' + sd, mid(g2('kn'), g2('hk'))) });
      hs.push({ node: 'foot_' + sd, r: 1.6, part: 'leg', weak: 0.55, offset: off('foot_' + sd, [g2('hpaw')[0], 0.8, g2('hpaw')[2]]) });
    }
    for (let i = 1; i <= 4; i++) hs.push({ node: 'tail' + i, r: 0.95, part: 'tail', weak: 0.5, offset: off('tail' + i, mid(this.j.tail[i - 1], this.j.tail[i])) });
    this.hitSpheres = hs;
    // lights: the gem's own, and the seams' (follows the brightest open site)
    this.rig.nodes['gem']?.add(this.gemLight);
    this.gemLight.position.set(0, 0, 1.2);
    this.root.add(this.seamLight);
    this.ready = true;
    // first pose: the classic sphinx, lying in front of its gate
    this.snapPose();
  }

  // ================================================================== small helpers
  private setPupil(k: 'slit' | 'wide' | 'shut') {
    if (!this.G || k === this.pupil) return;
    this.pupil = k;
    for (const sd of ['l', 'r']) {
      const m = this.rig.meshes['eye_' + sd];
      const g = this.G.eyes[`${k}_${sd}`];
      if (m && g) m.geometry = g;
    }
  }
  private callout(song: string, big = true) {
    this.dbg = song;
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 1.5, z: this.pos.z };
    this.d.enemies.callout(song, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title: song, enemy: this, pos, tier: 'boss' });
    if (big && song !== this.lastCallout) {
      this.lastCallout = song;
      this.ctx.toast(`« ${song} »`, COL, 'The Sphinx');
      this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
    }
  }
  /** it speaks from its own mouth, deep and amused (floating 3D type) */
  taunt(text: string, color = COL) {
    const at = this.sock('mouth', new THREE.Vector3());
    speak3D(this.ctx.engine, 'anubis', text, at, { key: `boss:${this.id}`, lift: 2.2, size: 0.22, px: 64, wrap: 30, color: '#fff1dc', glow: color, hdr: 1.6, voice: { follow: true, key: `boss:${this.id}` } });
  }
  private say(lines: string[]) {
    this.taunt(rnd.pick(lines));
  }
  private sock(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    if (s) {
      s.updateWorldMatrix(true, false);
      s.getWorldPosition(out);
    } else out.set(this.pos.x, this.pos.y + 15, this.pos.z);
    return out;
  }
  private nodePos(name: string, out: THREE.Vector3) {
    const n = this.rig.nodes[name];
    if (!n) return out.copy(this.pos);
    n.updateWorldMatrix(true, false);
    return n.getWorldPosition(out);
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private wet(x: number, z: number) {
    const w = this.ctx.world;
    return w.sa.waterLevel > w.sa.field.heightAt(x, z) + 0.05;
  }
  private fwd(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  private side(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  /** a rig-local (body frame, yaw only) point in the world */
  private bodyPt(x: number, y: number, z: number, out = new THREE.Vector3()) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + x * c + z * s, this.pos.y + y, this.pos.z - x * s + z * c);
  }
  /** a world point in the body frame (yaw only) */
  private toBody(p: THREE.Vector3, out = new THREE.Vector3()) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(dx * c - dz * s, p.y - this.pos.y, dx * s + dz * c);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private inFront(maxD: number, cosMin = 0.2) {
    const dx = this.player.pos.x - this.pos.x, dz = this.player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return d < maxD && (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d > cosMin;
  }
  /** the hunter in the body frame */
  private playerLocal() {
    return this.toBody(this.player.pos, new THREE.Vector3());
  }
  private get haste() {
    return (1 - this.phase * 0.14) * (this.dazeT > 0 ? 1.2 : 1);
  }
  private splash(x: number, y: number, z: number, power = 1) {
    const P = this.ctx.particles;
    if (this.wet(x, z)) {
      P.emit({ pos: { x, y: y + 0.1, z }, count: Math.round(20 * power), vel: { x: 0, y: 5 * Math.sqrt(power), z: 0 }, spread: 3.4 * power, gravity: 14, drag: 0.3, life: [0.5, 1.2], size: [0.16, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: WATER, ground: true, jitter: 0.8 * power });
      P.emit({ pos: { x, y: y + 0.3, z }, count: Math.round(5 * power), spread: 1.2 * power, up: 1.4, life: [0.7, 1.5], size: [0.8 * power, 2.2 * power], sprite: PUFFS, color: [0xf0fbff, 0xd0eef0], alpha: 0.55, drag: 2.2, rot: 6, rotSpeed: 0.5 });
      this.ctx.fx.ring({ x, y: y + 0.08, z }, 0xd8fbff, 2.4 * power, 0.5);
    } else {
      this.ctx.fx.sandBurst({ x, y, z }, power);
      this.ctx.fx.dust({ x, y, z }, power, 0xe6cf9f, Math.round(3 + power * 3));
    }
  }
  /** stone grinding: dust and grit shaken out of a joint */
  private grit(p: THREE.Vector3, k = 1) {
    this.ctx.particles.emit({ pos: p, count: Math.round(4 * k), vel: { x: 0, y: -1.5, z: 0 }, spread: 1.6 * k, jitter: 0.6, life: [0.7, 1.3], size: [0.16, 0.08], sprite: GRAINS, color: SAND, gravity: 11, ground: true, bounce: 0.1 });
    if (rnd.chance(0.5 * k)) this.ctx.particles.emit({ pos: p, count: 1, vel: { x: 0, y: -0.4, z: 0 }, spread: 0.8, life: [1.0, 2.0], size: [1.0 * k, 2.6 * k], sprite: PUFFS, color: [0xe8d4ac, 0xd8c094], alpha: 0.6, drag: 1.6, rot: 6, rotSpeed: 0.4, jitter: 0.8 });
    if (rnd.chance(0.25 * k)) this.ctx.particles.emit({ pos: p, count: 2, spread: 2.5, up: 1, life: [0.6, 1.1], size: [0.14, 0.1], sprite: 'pebble', color: STONE, gravity: 16, ground: true, bounce: 0.3, rot: 6, rotSpeed: 8 });
  }
  /** an expanding shock ring on the ground: hurts anyone grounded when its front passes (jump it) */
  private quake(x: number, z: number, max: number, dmg: number, knock = 12, speed = 22) {
    this.rings.push({ x, z, r: 1, speed, max, dmg, knock, hit: false, fx: 0 });
    const w = this.ctx.world;
    if (!this.wet(x, z)) w.sand.ring(x, z, { speed, height: 1.0 + max * 0.025, width: 2.4, life: max / speed + 0.4, rise: 0.12, fall: 0.8 });
    this.ctx.sfx('quake_rumble', { x, y: this.ground(x, z), z }, 1, 0.6);
  }
  private async dodgeOffer(from: THREE.Vector3, up = false) {
    const dg = this.d.enemies.dodge;
    if (!dg.qte) dg.qte = this.d.qte;
    if (!dg.ready()) return false;
    const r = await dg.offer({ from, up });
    this.check();
    return r === 'good' || r === 'perfect';
  }
  private openUp(dur = 2.6, label = 'OPENING!') {
    this.exposedT = Math.max(this.exposedT, dur);
    const top = { x: this.pos.x, y: this.pos.y + this.height + 1.2, z: this.pos.z };
    this.d.enemies.callout(label, top, 'elite');
    this.ctx.sfx('counter_clang', this.pos, 0.8, 0.6);
  }

  // ================================================================== the hunter: held, pinned, flung
  private grabHunter(at: () => THREE.Vector3) {
    this.hold = { at, squeeze: 0 };
    this.player.status.apply('stun', 1, 30, 1, 1, {});
    this.player.board.vel.set(0, 0, 0);
  }
  private releaseHunter() {
    if (!this.hold) return;
    this.hold = null;
    this.player.status.clear('stun');
    this.player.invuln = Math.max(this.player.invuln, 0.8);
  }
  /** throw the hunter (horizontal speed along dir, plus up) */
  private fling(dir: THREE.Vector3, speed: number, up: number, dmg: number) {
    const pl = this.player;
    this.releaseHunter();
    pl.invuln = 0;
    if (dmg > 0) pl.takeHit({ base: dmg, kind: 'phys', source: 'contact', knock: 0 }, _v.copy(pl.pos).addScaledVector(dir, -3));
    pl.board.grounded = false;
    pl.board.impulse.x += dir.x * speed;
    pl.board.impulse.z += dir.z * speed;
    pl.board.impulse.y += up;
    pl.invuln = Math.max(pl.invuln, 0.5);
    this.ctx.sfx('punch', pl.pos, 1, 0.5);
    this.ctx.sfx('whoosh_big', pl.pos, 1, 0.7);
    this.ctx.shake(0.5);
  }
  private holdUpdate() {
    if (!this.hold) return;
    const pl = this.player, pb = pl.board;
    const p = this.hold.at();
    pb.pos.copy(p);
    pb.vel.set(0, 0, 0);
    pb.grounded = false;
    pb.impulse.set(0, 0, 0);
    pl.root.position.copy(p);
    pl.root.updateMatrixWorld(true);
  }

  // ================================================================== intro: the statue wakes
  async intro() {
    const ctx = this.ctx, cam = this.d.cam;
    // the colossus is carved off-thread: wait for it (a fresh session builds it in a few seconds)
    if (!this.ready) {
      ctx.toast('THE RIVER GATE', COL, 'Something enormous sleeps ahead…');
      const g = await loadSphinxGeos();
      this.check();
      this.adopt(g);
    }
    this.placeArena();
    this.root.visible = true;
    this.snapPose();
    ctx.toast('THE RIVER GATE', COL, 'Ride up to the statue', true);
    // it sleeps until the hunter comes close (or loses patience)
    const t0 = this.t;
    while (this.distToPlayer() > 44 && this.t - t0 < 14) {
      if (rnd.chance(0.1)) this.grit(this.bodyPt((rnd.next() - 0.5) * 8, 11 + rnd.next() * 3, (rnd.next() - 0.5) * 16, _a), 0.6);
      await this.wait(0.1);
    }
    ctx.engine.letterbox(true, 0.5);
    const pp = this.playerPos();
    const f = this.fwd(new THREE.Vector3());
    const sd = this.side(new THREE.Vector3());
    // 1) a low shot past the hunter: the ground trembles, dust trickles, the eyes kindle
    const camA = new THREE.Vector3().copy(this.pos).addScaledVector(f, 30).addScaledVector(sd, 14);
    camA.y = this.ground(camA.x, camA.z) + 2.2;
    const head = () => this.sock('head_top', new THREE.Vector3()).add(new THREE.Vector3(0, -4, 0));
    cam.setCine({ pos: camA, look: head(), fov: 46 });
    ctx.sfx('quake_rumble', this.pos, 1, 0.5);
    for (let t = 0; t < 1.6; t += 0.1) {
      ctx.shake(0.15);
      for (let i = 0; i < 3; i++) this.grit(this.bodyPt((rnd.next() - 0.5) * 7, 6 + rnd.next() * 6, (rnd.next() - 0.5) * 18, _a), 0.8);
      await this.wait(0.1);
    }
    ctx.sfx('divine_power', this.pos, 0.9, 0.55);
    this.setPupil('slit');
    for (let t = 0; t < 1.0; t += 0.05) {
      this.U.glow.value = t;
      this.gemU.glow.value = t * 0.6;
      await this.wait(0.05);
    }
    // 2) the head turns, grinding, to look at the hunter: a slow smile
    this.look = this.player.pos;
    this.lookRate = 0.9;
    ctx.sfx('rock_crumble', this.pos, 1, 0.45);
    const camB = new THREE.Vector3().copy(head()).addScaledVector(f, 13).addScaledVector(sd, -5);
    camB.y += 1;
    cam.setCine({ pos: camB, look: head(), fov: 40 });
    this.setExpr('smug');
    for (let t = 0; t < 1.6; t += 0.1) {
      this.grit(this.nodePos('neck', _a).add(_b.set(0, 1, 0)), 0.8);
      await this.wait(0.1);
    }
    // 3) it rises, stretches into a play bow and shakes the dust off
    cam.setCine({ pos: camA.clone().addScaledVector(f, 6).add(new THREE.Vector3(0, 3, 0)), look: this.bodyPt(0, 9, 4), fov: 52 });
    this.pose({ rear: 0.6, front: -3.4, foreZ: 4.5, hindZ: 0, foreX: 0.3, hindX: 0 }, 1.1);
    this.tailUpT = 1;
    ctx.sfx('rock_crumble', this.pos, 1, 0.5);
    for (let t = 0; t < 1.8; t += 0.1) {
      this.grit(this.bodyPt((rnd.next() - 0.5) * 7, 8 + rnd.next() * 4, (rnd.next() - 0.5) * 18, _a), 1);
      if (rnd.chance(0.3)) ctx.shake(0.2);
      await this.wait(0.1);
    }
    this.pose({ rear: 0, front: 0, foreZ: 0, hindZ: 0, foreX: 0, hindX: 0 }, 1.8);
    await this.wait(0.8);
    await this.shakeOff();
    // 4) the roar
    const mouth = this.sock('mouth', new THREE.Vector3());
    cam.setCine({ pos: mouth.clone().addScaledVector(f, 15).addScaledVector(sd, 6).add(new THREE.Vector3(0, -2.5, 0)), look: mouth.clone().add(new THREE.Vector3(0, 1.2, 0)), fov: 44 });
    this.callout('Welcome to the Jungle');
    this.jawT = 0.75;
    this.setExpr('laugh');
    this.U.glow.value = 1.6;
    ctx.sfx('boss_roar', this.pos, 1, 0.5);
    ctx.sfx('anubis_roar', this.pos, 0.8, 0.7);
    ctx.shake(0.9);
    for (let i = 0; i < 6; i++) this.ctx.engine.tweens.after(i * 0.12, () => this.roarPuff(1.2));
    await this.wait(1.4);
    this.jawT = 0;
    this.taunt('A new toy, floating down my river. Come here. Let us play.');
    // the boss card (Cinema) frames the giant from its paws
    this.radius = 6;
    ctx.events.emit('bossIntro', this);
    await this.wait(2.4);
    this.radius = -50;
    this.U.glow.value = 1;
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.dormant = false;
    this.invulnerable = false;
    this.look = null;
    this.lookRate = 2.2;
    this.setExpr('smug');
    ctx.toast('THE SPHINX', COL, 'Shoot the eyes, the gem and every crack that opens', true);
  }
  /** a wet-dog shake through the whole body: dust sheets off it */
  private async shakeOff() {
    this.ctx.sfx('rock_crumble', this.pos, 1, 0.6);
    for (let t = 0; t < 1.1; t += 0.05) {
      this.N.lean = Math.sin(t * 26) * 0.07 * (1 - t / 1.1);
      this.tiltT = Math.sin(t * 30 + 1) * 0.25 * (1 - t / 1.1);
      if (rnd.chance(0.6)) this.grit(this.bodyPt((rnd.next() - 0.5) * 8, 8 + rnd.next() * 5, (rnd.next() - 0.5) * 20, _a), 1.3);
      await this.wait(0.05);
    }
    this.N.lean = 0;
    this.tiltT = 0;
  }
  /** pick the arena: in front of the river gate (the Nile's own gate, or one raised here) */
  private placeArena() {
    const w = this.ctx.world, storm = w.storm;
    const nile = (w as unknown as { nile?: NileWorldLike }).nile;
    const pp = this.playerPos();
    let gx: number, gz: number, gyaw: number;
    if (nile?.gate) {
      gx = nile.gate.x;
      gz = nile.gate.z;
      gyaw = nile.gate.yaw ?? Math.atan2(pp.x - gx, pp.z - gz);
    } else {
      // ahead of the hunter along where he is looking, as far as the storm allows
      let best = -1, bx = this.pos.x, bz = this.pos.z, bs = -1e9;
      const base = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z);
      for (let i = 0; i < 16; i++) {
        const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.35;
        for (const dist of [62, 54, 46, 40]) {
          const x = pp.x + Math.sin(a) * dist, z = pp.z + Math.cos(a) * dist;
          const sc = Math.min(storm.sdf(x, z) - 26, storm.sdf(pp.x + Math.sin(a) * (dist - 46), pp.z + Math.cos(a) * (dist - 46)) - 10) - i * 0.6;
          if (sc > bs) {
            bs = sc;
            best = a;
            bx = x;
            bz = z;
          }
          if (sc > 0) break;
        }
        if (bs > 0) break;
      }
      void best;
      gx = bx;
      gz = bz;
      gyaw = Math.atan2(pp.x - gx, pp.z - gz);
    }
    // the sphinx lies 34 m in front of its gate, facing the hunter
    const sx = gx + Math.sin(gyaw) * 34, sz = gz + Math.cos(gyaw) * 34;
    this.place(sx, sz, Math.atan2(pp.x - sx, pp.z - sz));
    if (!nile?.gate && this.G) {
      const gate = new RigInstance(this.G.gate, { ownMaterial: true });
      this.gate = gate;
      this.gateMat = gate.material;
      gate.root.position.set(gx, Math.min(this.ground(gx, gz), this.ground(gx + Math.cos(gyaw) * 10, gz - Math.sin(gyaw) * 10), this.ground(gx - Math.cos(gyaw) * 10, gz + Math.sin(gyaw) * 10)) - 0.4, gz);
      gate.root.rotation.y = gyaw;
      this.ctx.scene.add(gate.root);
    }
  }

  // ================================================================== fight loop
  protected async fight() {
    while (true) {
      this.check();
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      const p = this.phase, r = rnd.next(), d = this.distToPlayer();
      const pl = this.playerLocal();
      const behind = pl.z < 2 && Math.abs(pl.x) < 16;
      let pick: string;
      if (behind && this.cds.whip <= 0) pick = 'whip';
      else if (d > 46) pick = p >= 1 && this.cds.chase <= 0 ? 'chase' : r < 0.5 ? 'roar' : 'stalk';
      else if (d > 30) pick = r < 0.35 ? 'pounce' : r < 0.6 && this.cds.roar <= 0 ? 'roar' : p >= 1 && this.cds.chase <= 0 ? 'chase' : 'stalk';
      else if (p === 0) pick = r < 0.3 ? 'bat' : r < 0.5 ? 'volley' : r < 0.66 && this.cds.pin <= 0 ? 'pin' : r < 0.8 && this.cds.pounce <= 0 ? 'pounce' : r < 0.9 && this.cds.roar <= 0 ? 'roar' : 'bat';
      else if (p === 1) pick = r < 0.18 ? 'bat' : r < 0.32 ? 'volley' : r < 0.46 && this.cds.grab <= 0 ? 'grab' : r < 0.58 && this.cds.pin <= 0 ? 'pin' : r < 0.7 && this.cds.roll <= 0 ? 'roll' : r < 0.82 && this.cds.pounce <= 0 ? 'pounce' : r < 0.92 && this.cds.roar <= 0 ? 'roar' : 'volley';
      else pick = r < 0.24 ? 'flurry' : r < 0.38 && this.cds.grab <= 0 ? 'grab' : r < 0.5 && this.cds.roll <= 0 ? 'roll' : r < 0.62 && this.cds.pin <= 0 ? 'pin' : r < 0.74 ? 'volley' : r < 0.86 && this.cds.pounce <= 0 ? 'pounce' : this.cds.roar <= 0 ? 'roar' : 'bat';
      if (pick === this.lastAttack && pick !== 'stalk') pick = pick === 'bat' ? 'volley' : 'bat';
      await this.run(pick);
      await this.wait((p >= 2 ? 0.35 : p === 1 ? 0.6 : 0.85) * this.haste);
    }
  }
  private async run(name: string) {
    this.lastAttack = name;
    switch (name) {
      case 'bat':
        return this.jumpinJackFlash();
      case 'volley':
        return this.helloGoodbye();
      case 'pin':
        return this.underMyThumb();
      case 'grab':
        return this.holdYourHand();
      case 'pounce':
        return this.liveAndLetDie();
      case 'whip':
        return this.youCouldBeMine();
      case 'roar':
        return this.twistAndShout();
      case 'roll':
        return this.rollOverBeethoven();
      case 'chase':
        return this.runForYourLife();
      case 'riddle':
        return this.sympathyForTheDevil();
      case 'flurry':
        return this.streetFightingMan();
      default:
        return this.stalk();
    }
  }
  /** dev/test: queue a move (bat, volley, pin, grab, pounce, whip, roar, roll, chase, riddle, flurry) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  /** it pads after the hunter, head low, tail swishing */
  private async stalk() {
    const pp = this.playerPos();
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const go = Math.max(0, d - 22);
    this.pose({ rear: -0.6, front: -1.2 }, 2);
    this.headDownT = 0.15;
    this.walkTo = new THREE.Vector3(this.pos.x + (dx / d) * go, 0, this.pos.z + (dz / d) * go);
    this.walkSpeed = 5.5 + this.phase * 1.5;
    const t0 = this.t;
    while (this.walkTo && this.t - t0 < 3.2) await this.wait(0.1);
    this.walkTo = null;
    this.pose({ rear: 0, front: 0 }, 2);
    this.headDownT = 0;
  }

  // ------------------------------------------------------------------ Jumpin' Jack Flash: the paw bat
  /** one bat with paw s; returns true if it connected */
  private async bat(s: number, windup: number, toward?: number): Promise<boolean> {
    const ctx = this.ctx, pl = this.player;
    const leg = this.legs[s];
    const sgn = s === 0 ? 1 : -1;
    // wind-up: the paw rises out to the side, claws out, the body leans away
    this.N.lean = -sgn * 0.05;
    this.P.twist = clamp(Math.atan2(this.playerLocal().x, Math.max(4, this.playerLocal().z)), -0.5, 0.5);
    this.aimLocal(leg, sgn * 8.5, 6.5, 9, 7, { pitch: -0.3, roll: sgn * 0.9, yaw: -sgn * 0.5 }, -0.6);
    this.setPupil('wide');
    this.warn().bang(this, { tier: 'tell', life: windup, y: this.height + 1 });
    const pr = this.toBody(this.predicted(windup + 0.2));
    const zone = () => {
      const l = this.playerLocal();
      return l.z > 2 && l.z < 22 && Math.abs(l.x) < 15 && this.player.pos.y - this.ground(this.player.pos.x, this.player.pos.z) < 4;
    };
    this.warn().wedge(this.pos.x, this.pos.z, this.yaw + (pr.x > 0 ? 0.3 : -0.3), 20, 0.75, windup, 'tell');
    await this.wait(windup * 0.6);
    let dodged = false;
    if (zone() && rnd.chance(0.65)) dodged = await this.dodgeOffer(this.bodyPt(sgn * 8, 0, 10, new THREE.Vector3()));
    else await this.wait(windup * 0.4);
    // the swipe: across the front through where the hunter will be
    const tgtL = this.toBody(this.predicted(0.2));
    const hx = clamp(tgtL.x, -10, 10), hz = clamp(tgtL.z, 6, 19);
    const path: V3[] = [[sgn * 9, 2.4, hz - 1], [hx + sgn * 2.5, 1.2, hz + 0.6], [hx - sgn * 3, 1.0, hz + 0.4], [-sgn * 8, 2.6, hz - 2]];
    ctx.sfx('whoosh_big', this.pos, 1, 0.55);
    this.N.lean = sgn * 0.06;
    this.P.twist = -sgn * 0.25;
    let hit = false;
    const T = 0.42 * this.haste + 0.08;
    const dir = this.side(new THREE.Vector3()).multiplyScalar(-sgn);
    for (let t = 0, t0 = this.t; t <= T; t = this.t - t0) {
      const k = t / T;
      const seg = Math.min(2, Math.floor(k * 3)), u = k * 3 - seg;
      const a = path[seg], b = path[seg + 1];
      this.aimLocal(leg, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, 30, { pitch: -0.15, roll: sgn * 0.5, yaw: -sgn * 0.7 }, -0.5);
      // claws through the shallows: a wake of spray
      const pw = this.sock(s === 0 ? 'paw_l' : 'paw_r', _a);
      if (rnd.chance(0.6)) this.splash(pw.x, this.ground(pw.x, pw.z), pw.z, 0.7);
      if (!hit && !dodged && pl.alive && pw.distanceTo(pl.center(_b)) < 3.0) {
        hit = true;
        if (toward !== undefined) dir.copy(this.side(_b)).multiplyScalar(toward);
        dir.addScaledVector(this.fwd(_b), 0.35).normalize();
        this.fling(dir, 21 + this.phase * 2, 12, 18 + this.phase * 4);
        ctx.engine.hitStop(0.06);
        ctx.fx.hit(pw, { x: dir.x, y: 0.5, z: dir.z }, 'rock', 1.6);
        this.setExpr('laugh');
        if (rnd.chance(0.5)) this.say(['Bat. Bat. BAT.', 'Fly, little toy!', 'Again! Do it again!', 'Hah! Look at it go.']);
      }
      await this.wait(1 / 60);
    }
    this.N.lean = 0;
    this.P.twist = 0;
    this.toPlant(leg);
    await this.wait(0.35 * this.haste);
    return hit;
  }
  private async jumpinJackFlash() {
    this.callout("Jumpin' Jack Flash");
    const l = this.playerLocal();
    const s = l.x >= 0 ? 0 : 1;
    await this.bat(s, 0.75 * this.haste + 0.15);
    this.setExpr('smug');
  }
  // ------------------------------------------------------------------ Hello, Goodbye: swatted between its paws
  private async helloGoodbye() {
    this.callout('Hello, Goodbye');
    if (rnd.chance(0.5)) this.say(['Hello.', 'Hello… goodbye!', 'Left paw, right paw.']);
    let s = this.playerLocal().x >= 0 ? 0 : 1;
    const n = 3 + this.phase;
    for (let i = 0; i < n; i++) {
      this.check();
      if (!this.inFront(26, 0.1) && i > 0) break;
      // a hit sends the hunter across to the other paw, which is already waiting
      await this.bat(s, (i === 0 ? 0.6 : 0.32) * this.haste + 0.1, s === 0 ? -1 : 1);
      s = 1 - s;
    }
    this.setExpr('smug');
  }

  // ------------------------------------------------------------------ Under My Thumb: pinned
  private async underMyThumb(fast = false) {
    const ctx = this.ctx, pl = this.player, cam = this.d.cam;
    this.callout('Under My Thumb');
    this.cds.pin = 14 - this.phase * 2;
    const s = this.playerLocal().x >= 0 ? 0 : 1;
    const leg = this.legs[s];
    const sgn = s === 0 ? 1 : -1;
    this.pose({ rear: 0.4, front: -1.6 }, 2.5);
    this.setPupil('wide');
    this.headDownT = 0.3;
    this.say(['Hold still.', 'Mine.', 'Where do you think you are going?']);
    // the paw hovers over the hunter, tracking, then locks
    const W = (fast ? 0.7 : 1.15) * this.haste + 0.2;
    const mark = this.warn().circle(pl.pos.x, pl.pos.z, 2.8, W, 'grab', () => ({ x: this.player.pos.x, z: this.player.pos.z }), W * 0.82);
    this.warn().bang(this, { tier: 'grab', life: W, y: this.height + 1 });
    let lock = new THREE.Vector3();
    for (let t = 0, t0 = this.t; t < W; t = this.t - t0) {
      if (t < W * 0.82) lock.copy(this.predicted(0.25));
      const l = this.toBody(lock);
      l.x = clamp(l.x, -11, 11);
      l.z = clamp(l.z, 5, 21);
      this.aimLocal(leg, l.x, 7.5 + Math.sin(t * 9) * 0.3, l.z, 5, { pitch: 0.1, roll: 0, yaw: 0 }, -0.4);
      this.N.lean = sgn * Math.sin(t * 11) * 0.025;
      await this.wait(1 / 30);
    }
    this.warn().endMark(mark);
    const l = this.toBody(lock);
    l.x = clamp(l.x, -11, 11);
    l.z = clamp(l.z, 5, 21);
    // the slam
    lock = this.bodyPt(l.x, 0, l.z, new THREE.Vector3());
    lock.y = this.ground(lock.x, lock.z);
    for (let t = 0, t0 = this.t; t < 0.18; t = this.t - t0) {
      this.aimLocal(leg, l.x, 0.8, l.z, 40, { pitch: 0, roll: 0, yaw: 0 }, 0.2);
      await this.wait(1 / 60);
    }
    ctx.shake(0.8);
    ctx.engine.hitStop(0.05);
    ctx.sfx('explosion', lock, 1, 0.6);
    ctx.sfx('rock_crumble', lock, 1, 0.6);
    this.splash(lock.x, lock.y, lock.z, 2.2);
    const caught = pl.alive && Math.hypot(pl.pos.x - lock.x, pl.pos.z - lock.z) < 3.0 && pl.pos.y < lock.y + 2.4 && pl.invuln <= 0;
    if (!caught) {
      if (pl.alive && Math.hypot(pl.pos.x - lock.x, pl.pos.z - lock.z) < 5.5 && pl.pos.y < lock.y + 2.2) pl.takeHit({ base: 16 + this.phase * 3, kind: 'phys', source: 'contact', knock: 12 }, lock);
      this.quake(lock.x, lock.z, 12, 10 + this.phase * 2, 8, 18);
      this.planted(leg, 1.4);
      await this.wait(1.0 * this.haste);
      this.toPlant(leg);
      this.pose({ rear: 0, front: 0 }, 2);
      this.headDownT = 0;
      return;
    }
    // pinned: the paw presses down on the hunter
    this.grabHunter(() => _T.set(lock.x, lock.y, lock.z));
    this.setExpr('laugh');
    const camP = lock.clone().addScaledVector(this.side(_a), sgn * 7).addScaledVector(this.fwd(_b), 4);
    camP.y = this.ground(camP.x, camP.z) + 1.0;
    cam.setCine({ pos: camP, look: this.sock('mouth', _w).clone().lerp(lock, 0.45), fov: 54 });
    ctx.engine.letterbox(true, 0.35);
    ctx.toast('PINNED!', '#ff8a6a', 'Mash E to wriggle free', true);
    this.say(['Under my paw, where you belong.', 'Squeak for me.', 'Such a soft little thing.']);
    let free = false;
    try {
      const qp = this.d.qte.run({ kind: 'mash', key: 'KeyE', label: 'WRIGGLE FREE', duration: 2.8, target: 14 + this.phase * 3, at: () => ({ x: lock.x, y: lock.y + 2.4, z: lock.z }) });
      let res: string | null = null;
      void qp.then((r) => (res = r));
      let tick = 0;
      for (let t = 0, t0 = this.t; t < 3.2 && res === null; t = this.t - t0) {
        this.aimLocal(leg, l.x, 1.6 + Math.sin(t * 7) * 0.15, l.z, 14, { pitch: 0.05, roll: 0, yaw: 0 }, 0.8);
        this.tiltT = Math.sin(t * 1.4) * 0.25;
        tick -= 1 / 30;
        if (tick <= 0) {
          tick = 0.6;
          pl.applyDamage(3 + this.phase, 'contact', true);
          ctx.shake(0.15);
          this.splash(lock.x, lock.y, lock.z, 0.8);
        }
        await this.wait(1 / 30);
      }
      free = res !== null && res !== 'fail';
    } finally {
      if (!this.dead) {
        cam.setCine(null);
        ctx.engine.letterbox(false, 0.35);
      }
    }
    if (free) {
      // the hunter squirms out between its toes; it flinches back, surprised
      this.releaseHunter();
      const out = this.fwd(new THREE.Vector3()).multiplyScalar(1).addScaledVector(this.side(_a), -sgn * 0.6).normalize();
      pl.board.impulse.set(out.x * 12, 6, out.z * 12);
      pl.invuln = Math.max(pl.invuln, 1.2);
      this.aimLocal(leg, l.x * 0.8, 6, l.z - 2, 8, { pitch: -0.4, roll: 0, yaw: 0 }, -0.3);
      this.setExpr('stunned');
      ctx.toast('WRIGGLED FREE!', '#9dff3a', 'Its paw is up: hit it now');
      this.openUp(2.4);
      await this.wait(1.4);
    } else {
      // squashed, then batted away
      pl.applyDamage(20 + this.phase * 6, 'contact', false);
      this.aimLocal(leg, l.x, 0.9, l.z, 20, { pitch: 0, roll: 0, yaw: 0 }, 1);
      ctx.shake(0.6);
      await this.wait(0.3);
      this.fling(this.fwd(new THREE.Vector3()).addScaledVector(this.side(_a), sgn * 0.8).normalize(), 22, 13, 10);
      this.setExpr('laugh');
      await this.wait(0.6);
    }
    this.toPlant(leg);
    this.pose({ rear: 0, front: 0 }, 2);
    this.headDownT = 0;
    this.tiltT = 0;
    this.setExpr('smug');
  }

  // ------------------------------------------------------------------ I Want to Hold Your Hand: scooped up, held to its face
  private async holdYourHand() {
    const ctx = this.ctx, pl = this.player, cam = this.d.cam;
    this.callout('I Want to Hold Your Hand');
    this.cds.grab = 22 - this.phase * 3;
    const s = this.playerLocal().x >= 0 ? 0 : 1;
    const leg = this.legs[s];
    const sgn = s === 0 ? 1 : -1;
    const W = 0.75 * this.haste + 0.2;
    this.warn().bang(this, { tier: 'grab', life: W + 0.3, y: this.height + 1 });
    this.pose({ rear: 0.2, front: -2.2 }, 3);
    this.setPupil('wide');
    this.aimLocal(leg, sgn * 9, 3.5, 8, 7, { pitch: -0.2, roll: sgn * 0.8, yaw: -sgn * 0.6 }, -0.4);
    await this.wait(W * 0.6);
    let dodged = false;
    if (this.inFront(24, 0.2)) dodged = await this.dodgeOffer(this.bodyPt(sgn * 9, 0, 9, new THREE.Vector3()));
    else await this.wait(W * 0.4);
    // the scoop: low along the ground, toes cupped
    const tL = this.toBody(this.predicted(0.25));
    const hx = clamp(tL.x, -10, 10), hz = clamp(tL.z, 6, 18);
    let caught = false;
    ctx.sfx('whoosh_big', this.pos, 1, 0.65);
    for (let t = 0, t0 = this.t; t < 0.4; t = this.t - t0) {
      const k = t / 0.4;
      const x = sgn * 9 + (hx - sgn * 3 - sgn * 9) * k;
      this.aimLocal(leg, x, 0.9 + Math.sin(k * Math.PI) * 0.4, hz + Math.sin(k * Math.PI) * 1.2, 28, { pitch: -0.5, roll: sgn * 0.6, yaw: -sgn * 0.8 }, 0.6);
      const pw = this.sock(s === 0 ? 'paw_l' : 'paw_r', _a);
      if (rnd.chance(0.5)) this.splash(pw.x, this.ground(pw.x, pw.z), pw.z, 0.6);
      if (!dodged && pl.alive && pl.invuln <= 0 && pw.distanceTo(pl.center(_b)) < 2.8) {
        caught = true;
        break;
      }
      await this.wait(1 / 60);
    }
    if (!caught) {
      this.toPlant(leg);
      this.pose({ rear: 0, front: 0 }, 2);
      await this.wait(0.5);
      return;
    }
    // caught: up it goes, to the face
    const cup = () => this.sock(s === 0 ? 'paw_l' : 'paw_r', _T).addScaledVector(UP, -0.4);
    this.grabHunter(cup);
    ctx.sfx('punch', pl.pos, 0.8, 0.6);
    ctx.engine.letterbox(true, 0.4);
    this.pose({ rear: -3.2, front: -0.4, foreZ: 0, foreX: 0 }, 1.6);
    this.headDownT = 0.45;
    this.setExpr('smug');
    // the paw rises in front of the face, palm up, toes curled round the hunter
    const showPaw = (rate: number, lift = 0) => {
      const hc = this.j.hc as V3;
      this.aimLocal(leg, sgn * 2.4, hc[1] - 3.4 + lift, hc[2] + 3.8, rate, { pitch: -1.15, roll: sgn * 0.3, yaw: -sgn * 0.4 }, 0.85);
      this.look = this.lookV.copy(cup());
    };
    for (let t = 0, t0 = this.t; t < 1.2; t = this.t - t0) {
      showPaw(3);
      await this.wait(1 / 30);
    }
    // the cinematic: the giant face and the tiny hunter in its paw
    const face = this.sock('mouth', new THREE.Vector3());
    const mid = face.clone().lerp(cup(), 0.5);
    const camP = mid.clone().addScaledVector(this.side(_a), -sgn * 11).addScaledVector(this.fwd(_b), 7);
    camP.y += 1.2;
    cam.setCine({ pos: camP, look: mid, fov: 48 });
    this.tiltT = sgn * 0.3;
    this.say(['Such a small thing, to cross my river.', 'Do you squeak? Squeak for me.', 'I want to keep you. Forever.', 'What a funny little face.']);
    ctx.toast('IN ITS PAW!', '#ff8a6a', 'Time the squirm: SPACE when the ring closes', true);
    for (let t = 0, t0 = this.t; t < 1.6; t = this.t - t0) {
      showPaw(4, Math.sin(t * 2.2) * 0.3);
      await this.wait(1 / 30);
    }
    let free = false;
    try {
      const r = await this.qte({ kind: 'ring', key: 'Space', label: 'SLIP FREE', duration: 1.25 - this.phase * 0.1, at: () => cup() });
      free = r !== 'fail';
    } catch (e) {
      this.releaseHunter();
      if (!this.dead) {
        cam.setCine(null);
        ctx.engine.letterbox(false, 0.4);
      }
      throw e;
    }
    if (free) {
      // the hunter slips through its toes and drops past its face: shoot the eyes on the way down
      this.releaseHunter();
      pl.board.impulse.set(this.fwd(_a).x * 4, -2, this.fwd(_a).z * 4);
      pl.invuln = Math.max(pl.invuln, 2.2);
      this.setExpr('stunned');
      this.blinkT = 0.25;
      leg.curl = -0.4;
      ctx.toast('SLIPPED FREE!', '#9dff3a', 'Its eyes are right there: SHOOT');
      this.openUp(3.2, 'THE EYES!');
      ctx.engine.slowMo(0.35, 10);
      cam.setCine({ pos: camP.clone().lerp(face, 0.25), look: face, fov: 44 });
      await this.wait(0.7);
      ctx.engine.slowMo(1, 4);
      cam.setCine(null);
      ctx.engine.letterbox(false, 0.4);
      await this.wait(1.2);
    } else {
      cam.setCine(null);
      ctx.engine.letterbox(false, 0.4);
      if (rnd.chance(0.5)) {
        // flung far out over the river
        this.say(['Fetch!', 'Go on, then. Swim.']);
        for (let t = 0, t0 = this.t; t < 0.35; t = this.t - t0) {
          this.aimLocal(leg, sgn * 6, 13, 0, 9, { pitch: 0.6, roll: sgn * 0.4, yaw: 0 }, 0.9);
          await this.wait(1 / 30);
        }
        ctx.sfx('whoosh_big', this.pos, 1, 0.5);
        for (let t = 0, t0 = this.t; t < 0.2; t = this.t - t0) {
          this.aimLocal(leg, sgn * 3, 9, 14, 30, { pitch: -0.6, roll: 0, yaw: 0 }, -0.5);
          await this.wait(1 / 60);
        }
        this.fling(this.fwd(new THREE.Vector3()).addScaledVector(this.side(_a), sgn * 0.3).normalize(), 30, 15, 20 + this.phase * 5);
      } else {
        // dropped, and smacked by the other paw on the way down
        this.say(['Hello…', 'Catch!']);
        this.releaseHunter();
        pl.board.impulse.set(0, 2, 0);
        const other = this.legs[1 - s];
        for (let t = 0, t0 = this.t; t < 0.3; t = this.t - t0) {
          this.aimLocal(other, -sgn * 7, 9, 10, 30, { pitch: 0, roll: -sgn * 0.6, yaw: sgn * 0.5 }, -0.5);
          await this.wait(1 / 60);
        }
        this.callout('Hello, Goodbye', false);
        this.fling(this.side(new THREE.Vector3()).multiplyScalar(sgn).addScaledVector(this.fwd(_a), 0.6).normalize(), 26, 10, 22 + this.phase * 5);
        this.toPlant(other);
      }
      this.setExpr('laugh');
      await this.wait(0.8);
    }
    this.look = null;
    this.toPlant(leg);
    this.pose({ rear: 0, front: 0, foreZ: 0, foreX: 0 }, 2);
    this.headDownT = 0;
    this.tiltT = 0;
    this.setExpr('smug');
  }

  // ------------------------------------------------------------------ Live and Let Die: the pounce
  private async liveAndLetDie(chained = false) {
    const ctx = this.ctx, pl = this.player;
    if (!chained) this.callout('Live and Let Die');
    this.cds.pounce = 7;
    // the hunting crouch: belly low, the butt wiggles, the tail tip twitches
    const W = (chained ? 0.7 : 1.25) * this.haste + 0.15;
    this.pose({ rear: -0.4, front: -2.8, hindZ: 1.4 }, 3);
    this.setPupil('wide');
    this.tailUpT = 0.4;
    let land = this.predicted(W + 0.9);
    const mark = this.warn().circle(land.x, land.z, 6, W, 'heavy', () => {
      const p = this.predicted(0.9);
      return { x: p.x, z: p.z };
    }, W * 0.75);
    this.warn().bang(this, { tier: 'heavy', life: W, y: this.height + 1 });
    ctx.sfx('jackal_growl', this.pos, 1, 0.35);
    for (let t = 0, t0 = this.t; t < W; t = this.t - t0) {
      this.wiggle = Math.min(1, t / 0.3);
      if (t < W * 0.75) land = this.predicted(0.9);
      this.faceTarget(land, 3, 1 / 30);
      await this.wait(1 / 30);
    }
    this.wiggle = 0;
    this.warn().endMark(mark);
    // clamp the landing inside its reach and the storm
    const dx = land.x - this.pos.x, dz = land.z - this.pos.z, dist = Math.hypot(dx, dz) || 1;
    const reach = clamp(dist - 9, 6, 32);
    const tx = this.pos.x + (dx / dist) * reach, tz = this.pos.z + (dz / dist) * reach;
    await this.leap(tx, tz, 0.95 + reach * 0.012, 7 + reach * 0.12, true);
    // the slam: both forepaws
    const f = this.fwd(_a);
    const hit = this.bodyPt(0, 0, 9, new THREE.Vector3());
    hit.y = this.ground(hit.x, hit.z);
    ctx.shake(1.1);
    ctx.engine.hitStop(0.06);
    ctx.sfx('explosion_big', hit, 1, 0.55);
    ctx.sfx('rock_crumble', hit, 1, 0.5);
    for (const s of [-1, 1]) this.splash(hit.x + Math.cos(this.yaw) * s * 4, hit.y, hit.z - Math.sin(this.yaw) * s * 4, 2.4);
    ctx.world.deform(hit.x, hit.z, 4, 0.8);
    if (pl.alive && Math.hypot(pl.pos.x - hit.x, pl.pos.z - hit.z) < 7 && pl.pos.y < hit.y + 3) pl.takeHit({ base: 30 + this.phase * 6, kind: 'phys', source: 'contact', knock: 18 }, hit);
    this.quake(hit.x, hit.z, 24 + this.phase * 4, 14 + this.phase * 3, 12, 20);
    void f;
    // stuck for a beat: the planted paws are open
    for (const l of this.legs) if (l.front) this.planted(l, 1.6);
    this.setExpr('smug');
    await this.wait(1.25 * this.haste);
    this.pose({ rear: 0, front: 0, hindZ: 0 }, 2);
    this.tailUpT = 0;
  }
  /** a bound through the air to (x, z): legs reach and tuck, the body arcs */
  private async leap(x: number, z: number, T: number, h: number, slam: boolean) {
    const ctx = this.ctx;
    const x0 = this.pos.x, z0 = this.pos.z;
    this.faceTarget(_v.set(x, 0, z));
    ctx.sfx('whoosh_big', this.pos, 1, 0.45);
    ctx.sfx('rock_crumble', this.pos, 0.8, 0.5);
    this.splash(this.pos.x, this.ground(this.pos.x, this.pos.z), this.pos.z, 1.8);
    this.pose({ rear: 0, front: 0.6, hindZ: 0 }, 8);
    for (const l of this.legs) {
      l.mode = 'body';
      l.local.copy(l.sole);
    }
    for (let t = 0, t0 = this.t; t <= T; t = this.t - t0) {
      const k = t / T;
      this.pos.x = x0 + (x - x0) * k;
      this.pos.z = z0 + (z - z0) * k;
      this.air = Math.sin(k * Math.PI) * h;
      this.airPitch = (0.5 - k) * 0.5;
      // forelegs reach ahead and down, hind legs stretch back, then gather for the landing
      const reachF = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      for (const l of this.legs) {
        const sg = l.side === 0 ? 1 : -1;
        if (l.front) l.local.set(sg * 4.2, -0.4 + (1 - reachF) * 0.4 - (slam ? k * 1.2 : 0), l.sole.z + 4.5 * reachF + 1.5);
        else l.local.set(sg * 3.8, 1.5 * reachF, l.sole.z - 4.5 * reachF);
      }
      if (rnd.chance(0.3)) this.grit(this.bodyPt((rnd.next() - 0.5) * 6, 5 + this.air, (rnd.next() - 0.5) * 18, _a), 0.8);
      await this.wait(1 / 60);
    }
    this.air = 0;
    this.airPitch = 0;
    for (const l of this.legs) {
      l.mode = 'plant';
      l.step = null;
      this.homeOf(l, l.plant);
      l.now.copy(l.plant);
    }
    this.pose({ rear: -0.8, front: -1.2 }, 6);
    this.footfall(this.bodyPt(0, 0, 4, _a), 2.2);
  }

  // ------------------------------------------------------------------ You Could Be Mine: the tail whip
  private async youCouldBeMine() {
    const ctx = this.ctx, pl = this.player;
    this.callout('You Could Be Mine');
    this.cds.whip = 6;
    const l = this.playerLocal();
    const side = l.x >= 0 ? 1 : -1;
    // it swings its rear toward the hunter: tail up, twitching
    this.tailUpT = 1;
    this.whipSide = side;
    const W = 0.7 * this.haste + 0.15;
    this.warn().bang(this, { tier: 'heavy', life: W, y: this.height + 1 });
    const tailBase = this.nodePos('tail2', new THREE.Vector3());
    this.warn().wedge(tailBase.x, tailBase.z, Math.atan2(pl.pos.x - tailBase.x, pl.pos.z - tailBase.z), 13, 1.1, W, 'heavy');
    this.turnRate = 0;
    const yaw0 = this.yaw;
    for (let t = 0, t0 = this.t; t < W; t = this.t - t0) {
      this.yaw = dampAngle(this.yaw, yaw0 - side * 0.5, 3, 1 / 30);
      this.whipT = -0.6;
      await this.wait(1 / 30);
    }
    // the whip: a low sweep (jump it)
    ctx.sfx('whoosh_big', tailBase, 1, 0.4);
    let hit = false;
    for (let t = 0, t0 = this.t; t < 0.5; t = this.t - t0) {
      const k = t / 0.5;
      this.whipT = -0.6 + k * 2.2;
      this.yaw = dampAngle(this.yaw, yaw0 + side * 0.35, 5, 1 / 60);
      if (!hit && pl.alive) {
        for (const n of ['tail4', 'tail6', 'tail8']) {
          const p = this.nodePos(n, _a);
          if (Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) < 2.6 && pl.pos.y < this.ground(pl.pos.x, pl.pos.z) + 1.6) {
            hit = true;
            pl.takeHit({ base: 22 + this.phase * 4, kind: 'phys', source: 'contact', knock: 17 }, this.nodePos('tail2', _b));
            ctx.engine.hitStop(0.05);
            break;
          }
        }
        const tip = this.nodePos('tail8', _a);
        if (rnd.chance(0.7)) this.splash(tip.x, this.ground(tip.x, tip.z), tip.z, 0.9);
      }
      await this.wait(1 / 60);
    }
    this.whipT = 0;
    this.tailUpT = 0;
    this.turnRate = 0.9;
    if (hit) this.say(['Mine.', 'You could be mine.']);
    await this.wait(0.4);
  }

  // ------------------------------------------------------------------ Twist and Shout: the sand roar
  private async twistAndShout() {
    const ctx = this.ctx;
    this.callout('Twist and Shout');
    this.cds.roar = 10;
    const W = 0.8 * this.haste + 0.2;
    this.warn().bang(this, { tier: 'heavy', life: W, y: this.height + 1 });
    this.pose({ rear: -0.8, front: 0.3 }, 2.5);
    this.headDownT = -0.35;
    this.jawT = 0.3;
    this.U.glow.value = 1.6;
    ctx.sfx('quake_rumble', this.pos, 0.8, 0.6);
    await this.wait(W);
    // the roar: the head sweeps across, sand blasting out of the throat
    this.jawT = 0.85;
    this.headDownT = 0.12;
    ctx.sfx('boss_roar', this.pos, 1, 0.5);
    ctx.sfx('sand_spray', this.pos, 1, 0.5);
    const T = 1.7;
    const side = rnd.sign();
    const pp0 = this.playerLocal();
    let acc = 0;
    for (let t = 0, t0 = this.t; t < T; t = this.t - t0) {
      const k = t / T;
      const aim = this.bodyPt(clamp(pp0.x, -14, 14) + side * (k - 0.5) * 26, 0, clamp(pp0.z, 10, 40), _a);
      aim.y = this.ground(aim.x, aim.z) + 1;
      this.look = aim.clone();
      this.lookRate = 6;
      const m = this.sock('mouth', _b);
      const dir = _v.copy(aim).sub(m).normalize();
      acc += (16 + this.phase * 6) / 30;
      while (acc >= 1) {
        acc -= 1;
        const sp = 24 + rnd.next() * 5;
        const j = 0.08;
        this.d.enemies.proj.spawn({ kind: 'sand', x: m.x, y: m.y, z: m.z, vx: (dir.x + (rnd.next() - 0.5) * j) * sp, vy: (dir.y + (rnd.next() - 0.5) * j) * sp + 2, vz: (dir.z + (rnd.next() - 0.5) * j) * sp, dmg: 7 + this.phase * 2, grav: 4, life: 2.4, sourceId: this.id });
      }
      ctx.particles.emit({ pos: m, count: 8, vel: { x: dir.x * 22, y: dir.y * 22 + 1, z: dir.z * 22 }, spread: 3.5, jitter: 0.5, life: [0.5, 1.1], size: [0.24, 0.12], sprite: GRAINS, color: SAND, gravity: 6, drag: 0.5, ground: true });
      ctx.particles.emit({ pos: m, count: 2, vel: { x: dir.x * 14, y: dir.y * 14, z: dir.z * 14 }, spread: 2.5, life: [0.7, 1.3], size: [1.2, 3.2], sprite: PUFFS, color: [0xf0d8a8, 0xe0c08a], alpha: 0.7, drag: 1.4, rot: 6, rotSpeed: 0.8 });
      if (rnd.chance(0.4)) ctx.shake(0.2);
      await this.wait(1 / 30);
    }
    this.jawT = 0;
    this.headDownT = 0;
    this.look = null;
    this.lookRate = 2.2;
    this.U.glow.value = this.phase >= 2 ? 2 : 1;
    this.pose({ rear: 0, front: 0 }, 2);
  }
  /** a puff of sand and grit out of the mouth (roars) */
  private roarPuff(k = 1) {
    const m = this.sock('mouth', _a), f = this.fwd(_b);
    this.ctx.particles.emit({ pos: m, count: Math.round(12 * k), vel: { x: f.x * 12, y: 2, z: f.z * 12 }, spread: 4, life: [0.6, 1.2], size: [0.24, 0.12], sprite: GRAINS, color: SAND, gravity: 8, drag: 0.6, ground: true });
    this.ctx.particles.emit({ pos: m, count: 2, vel: { x: f.x * 8, y: 1, z: f.z * 8 }, spread: 2, life: [0.9, 1.6], size: [1.5 * k, 3.5 * k], sprite: PUFFS, color: [0xf0d8a8, 0xe0c08a], alpha: 0.65, drag: 1.4, rot: 6, rotSpeed: 0.6 });
  }

  // ------------------------------------------------------------------ Roll Over Beethoven: it rolls onto its back
  private async rollOverBeethoven() {
    const ctx = this.ctx;
    this.callout('Roll Over Beethoven');
    this.cds.roll = 26;
    this.say(['Rub my belly. I dare you.', 'Roll over. Roll OVER!', 'Watch this, little toy.']);
    const dir = rnd.sign();
    this.setPupil('wide');
    this.pose({ rear: -4.2, front: -4.2, foreZ: 2, hindZ: 2 }, 2.5);
    await this.wait(0.8);
    // over onto its side… and onto its back
    for (const l of this.legs) {
      l.mode = 'body';
      l.local.copy(l.sole).add(_v.set(0, 2, 0));
    }
    const roll = async (to: number, T: number) => {
      const r0 = this.N.roll;
      for (let t = 0, t0 = this.t; t <= T; t = this.t - t0) {
        const k = t / T, e = k * k * (3 - 2 * k);
        this.P.roll = this.N.roll = r0 + (to - r0) * e;
        this.paddle(t);
        await this.wait(1 / 30);
      }
    };
    await roll(dir * Math.PI * 0.5, 0.7);
    this.bump(1.0);
    await roll(dir * Math.PI * 0.92, 0.6);
    this.bump(1.3);
    this.gemOpenT = 3.6;
    ctx.toast('BELLY UP!', COL, 'The gem is open: shoot it');
    // on its back: it wriggles, every wriggle a quake
    for (let i = 0; i < 4 + this.phase; i++) {
      const w0 = this.N.roll;
      for (let t = 0, t0 = this.t; t < 0.5; t = this.t - t0) {
        this.P.roll = this.N.roll = dir * Math.PI * 0.92 + Math.sin((t / 0.5) * Math.PI) * 0.22 * (i % 2 ? 1 : -1);
        this.paddle(t + i);
        await this.wait(1 / 30);
      }
      this.N.roll = w0;
      this.bump(0.7);
    }
    await roll(dir * Math.PI * 0.5, 0.6);
    this.bump(1.0);
    await roll(0, 0.8);
    this.P.roll = this.N.roll = 0;
    for (const l of this.legs) {
      l.mode = 'plant';
      l.step = null;
      this.homeOf(l, l.plant);
      l.now.copy(l.plant);
    }
    this.pose({ rear: 0, front: 0, foreZ: 0, hindZ: 0 }, 1.6);
    this.gemOpenT = 0;
    this.setExpr('smug');
  }
  /** legs paddling at the sky while it lies on its back */
  private paddle(t: number) {
    for (const l of this.legs) {
      const sg = l.side === 0 ? 1 : -1, ph = (l.front ? 0 : 1.6) + l.side * 3.1;
      l.local.set(l.sole.x + sg * 1.2, l.sole.y + 2.4 + Math.sin(t * 6 + ph) * 1.6, l.sole.z + Math.cos(t * 6 + ph) * 2.2);
      l.curl = 0.4 + Math.sin(t * 6 + ph) * 0.4;
    }
  }
  private bump(k: number) {
    const ctx = this.ctx;
    ctx.shake(0.5 * k);
    ctx.sfx('explosion', this.pos, 0.8 * k, 0.5);
    ctx.sfx('rock_crumble', this.pos, k, 0.55);
    for (let i = 0; i < 6; i++) {
      const p = this.bodyPt((rnd.next() - 0.5) * 12, 0, (rnd.next() - 0.5) * 24, _a);
      this.splash(p.x, this.ground(p.x, p.z), p.z, 1.4 * k);
    }
    this.quake(this.pos.x, this.pos.z, 22 + 6 * k, 10 + this.phase * 3, 10, 18);
  }

  // ------------------------------------------------------------------ Run for Your Life: it bounds after you
  private async runForYourLife() {
    this.callout('Run for Your Life');
    this.cds.chase = 18;
    this.say(['Run, little toy. Run!', 'I will catch you. I always catch them.', 'Faster! This is the fun part.']);
    this.setPupil('wide');
    const n = 3 + this.phase;
    for (let i = 0; i < n; i++) {
      this.check();
      const p = this.predicted(1.0);
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d < 16) break;
      const go = Math.min(d - 12, 20);
      this.pose({ rear: -0.6, front: -1.6 }, 6);
      await this.wait(0.22 * this.haste);
      await this.leap(this.pos.x + (dx / d) * go, this.pos.z + (dz / d) * go, 0.75, 4.5, false);
      this.quake(this.pos.x, this.pos.z, 10, 8 + this.phase * 2, 8, 18);
    }
    if (this.distToPlayer() < 24) await (rnd.chance(0.5) ? this.bat(this.playerLocal().x >= 0 ? 0 : 1, 0.45) : this.liveAndLetDie(true));
    this.pose({ rear: 0, front: 0 }, 2);
  }

  // ------------------------------------------------------------------ Street Fighting Man: the enraged flurry
  private async streetFightingMan() {
    this.callout('Street Fighting Man');
    this.say(['No more games. Well… one more.', 'Come here, come HERE!']);
    const s = this.playerLocal().x >= 0 ? 0 : 1;
    await this.bat(s, 0.3);
    await this.bat(1 - s, 0.25);
    if (this.inFront(30, -0.2)) await this.liveAndLetDie(true);
    else await this.youCouldBeMine();
  }

  // ------------------------------------------------------------------ Sympathy for the Devil: the riddle
  private async sympathyForTheDevil() {
    const ctx = this.ctx, pl = this.player;
    this.callout('Sympathy for the Devil');
    this.riddles++;
    const R = rnd.pick(RIDDLES);
    this.invulnerable = true;
    this.pose({ rear: -2.4, front: -0.4, foreZ: 1 }, 2);
    this.headDownT = 0.3;
    this.tiltT = 0.18;
    this.setPupil('wide');
    this.setExpr('smug');
    this.look = pl.pos;
    const head = () => this.sock('head_top', new THREE.Vector3());
    say3D(ctx.engine, 'Pleased to meet you, little toy. Hope you guess my answer.', head(), { key: 'sphinx_riddle', size: 0.24, px: 64, wrap: 30, color: '#fff3d6', glow: GOLDC, hdr: 1.7, lift: 1.5, hold: 2.6 });
    await this.wait(2.6);
    say3D(ctx.engine, R.q, head(), { key: 'sphinx_riddle', size: 0.24, px: 64, wrap: 30, color: '#fff3d6', glow: GOLDC, hdr: 1.7, lift: 1.5, hold: 13 });
    // the answers stand in the river in front of the hunter: ride into one
    const toS = _a.set(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z).normalize();
    const sd = _b.set(toS.z, 0, -toS.x);
    const order = rnd.shuffle([0, 1, 2]);
    const pts: THREE.Vector3[] = [];
    const plaques: FloatText3D[] = [];
    const marks: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const p = pl.pos.clone().addScaledVector(toS, 11).addScaledVector(sd, (i - 1) * 9);
      if (this.toBody(p).z < 12) p.addScaledVector(toS, -8);
      p.y = this.ground(p.x, p.z);
      pts.push(p);
      const ft = new FloatText3D(R.a[order[i]], { size: 1.0, px: 72, cps: 24, wrap: 16, color: '#fff3d6', glow: GOLDC, hdr: 1.8 });
      ft.anchor.copy(p).add(new THREE.Vector3(0, 3.2, 0));
      ctx.scene.add(ft.mesh);
      plaques.push(ft);
      marks.push(this.warn().circle(p.x, p.z, 3.2, 12, 'tell'));
    }
    this.riddleUI = { plaques, pts, marks };
    ctx.toast('THE RIDDLE', GOLDC, 'Ride into the right answer', true);
    let chosen = -1;
    const T = 12 - this.phase;
    for (let t = 0, t0 = this.t; t < T && chosen < 0; t = this.t - t0) {
      for (let i = 0; i < 3; i++) {
        plaques[i].update(1 / 30, ctx.camera);
        if (Math.hypot(pl.pos.x - pts[i].x, pl.pos.z - pts[i].z) < 3.4) chosen = i;
      }
      await this.wait(1 / 30);
    }
    this.clearRiddle();
    hush3D('sphinx_riddle');
    this.invulnerable = false;
    this.look = null;
    const right = chosen >= 0 && order[chosen] === 0;
    if (right) {
      ctx.sfx('qte_perfect', null, 0.9);
      ctx.sfx('divine_chime', pl.pos, 0.8, 0.8);
      ctx.fx.sparkle(pl.center(_a), 0xffd36b, 24, 1.8);
      this.taunt('…Correct. How very annoying.');
      ctx.toast('RIDDLE SOLVED', '#9dff3a', 'It sulks: the gem and every open seam are bare');
      this.setExpr('stunned');
      this.setPupil('slit');
      this.pose({ rear: -3.6, front: -3.2 }, 1.5);
      this.headDownT = 0.5;
      this.dazeT = 6;
      this.gemOpenT = 6;
      this.openUp(6, 'SULKING!');
      await this.wait(5.5);
      this.pose({ rear: 0, front: 0, foreZ: 0 }, 2);
      this.headDownT = 0;
      this.tiltT = 0;
    } else {
      ctx.sfx('sting_negative', null, 0.8);
      this.taunt(chosen < 0 ? 'Too slow. The answer was ' + R.a[0].toLowerCase() + '.' : 'Wrong. The answer was ' + R.a[0].toLowerCase() + '.');
      this.setExpr('laugh');
      this.tiltT = 0;
      this.pose({ rear: 0, front: 0, foreZ: 0 }, 2);
      await this.wait(0.6);
      await this.underMyThumb(true);
    }
  }
  private clearRiddle() {
    const r = this.riddleUI;
    if (!r) return;
    for (const p of r.plaques) p.dispose();
    for (const m of r.marks) this.warn().endMark(m as never);
    this.riddleUI = null;
  }

  // ================================================================== phases, damage, weak points
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p === 1) {
      this.taunt('Oh, you bite. Good. I was getting bored.');
      this.queue.push('roll');
    } else if (p === 2) {
      this.taunt('ENOUGH. Now I play rough.');
      this.U.glow.value = 2;
      this.U.heat.value = 0.25;
      this.gemU.glow.value = 1.6;
      this.queue.push('flurry');
    }
  }
  private warn() {
    return this.d.enemies.warn;
  }
  /** cracks open as it takes damage, each at its own threshold */
  private updateSites(dt: number) {
    const lost = 1 - this.frac;
    const order = ['crack_haunch', 'crack_flank', 'crack_shoulder', 'crack_back', 'crack_brow'];
    for (const s of this.sites) {
      const i = order.indexOf(s.name);
      const at = 0.08 + i * 0.13;
      const target = this.dead ? 1 : lost < at ? 0 : clamp(0.35 + (lost - at) * 2.6, 0, 1);
      if (target > 0 && s.open === 0) this.siteBreaks(s);
      s.open = damp(s.open, target, 3, dt);
      const u = this.siteU[s.name];
      if (u) u.open.value = s.open;
      s.sphere.weak = s.open > 0.3 ? 1.9 * (this.dazeT > 0 ? 1.4 : 1) : 0.6;
    }
  }
  private siteBreaks(s: { name: string; open: number }) {
    s.open = 0.001;
    const p = this.nodePos(s.name, new THREE.Vector3());
    this.ctx.sfx('ore_crack', p, 1, 0.6);
    this.ctx.sfx('rock_crumble', p, 1, 0.7);
    this.ctx.events.emit('gibs', p.x, p.y, p.z, 18, 0.35, STONE, 7, 5);
    this.ctx.fx.light(p, 0xffb04a, 6, 0.8, 14);
    this.ctx.shake(0.4);
    this.ctx.particles.emit({ pos: p, count: 16, spread: 4, up: 3, life: [0.5, 1.1], size: [0.3, 0.06], sprite: ['spark', 'glow8'], additive: true, color: [0xffd98a, 0xffa53a, 0xffffff], gravity: 6, drag: 1 });
    if (this.alive) this.ctx.toast('A SEAM CRACKS OPEN', COL, 'Shoot the glowing cracks');
  }
  private planted(l: Leg, t: number) {
    this.plantedWeak = Math.max(this.plantedWeak, t);
    void l;
  }
  private rayT(o: THREE.Vector3, d: THREE.Vector3, s: HitSphere) {
    const n = this.rig.nodes[s.node];
    if (!n) return -1;
    const c = n.localToWorld(_E.set(...(s.offset ?? [0, 0, 0])));
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - s.r * s.r);
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    return t;
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.ready || this.dormant || this.dead || !this.root.visible) return null;
    const best = super.hitTest(o, d, maxT);
    if (!best) return null;
    const prefer = (s: HitSphere, slack: number): RayHit | null => {
      const t = this.rayT(o, d, s);
      if (t < 0 || t > best.t + slack || t > maxT) return null;
      return { enemy: this, t, point: o.clone().addScaledVector(d, t), normal: d.clone().negate(), headshot: true, part: s.part, surface: 'enemy' };
    };
    for (const s of this.eyeSphere) {
      const h = prefer(s, this.exposedT > 0 ? 2.5 : 1.0);
      if (h) return h;
    }
    if (this.gemOpenT > 0 || this.exposedT > 0) {
      const h = prefer(this.gemSphere, 2.5);
      if (h) return h;
    }
    for (const s of this.sites)
      if (s.open > 0.3) {
        const h = prefer(s.sphere, 1.2);
        if (h) return h;
      }
    return best;
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (this.dormant) return 0;
    const ex = this.exposedT > 0 ? 1.5 : 1;
    for (const e of this.eyeSphere) e.weak = 2.6 * ex;
    this.gemSphere.weak = this.gemOpenT > 0 ? 3 : 1.6 * ex;
    for (const p of this.pawSpheres) p.weak = this.plantedWeak > 0 ? 1.3 : 0.7;
    const part = hit.tags?.[0];
    const amt = super.takeDamage(hit, point, dir);
    if (amt > 0) {
      if (part === 'eye') {
        this.blinkT = 0.18;
        this.headTilt += rnd.sign() * 0.14;
        if (rnd.chance(0.3)) this.ctx.sfx('boss_hurt', this.pos, 0.7, 0.6);
      } else if (part === 'gem' && point) {
        this.ctx.particles.emit({ pos: point, count: 6, spread: 3, life: [0.3, 0.7], size: [0.25, 0.05], sprite: ['spark', 'glow8'], additive: true, color: [0xff7a4a, 0xffd0a0], drag: 1.5 });
        this.gemU.heat.value = Math.min(1, this.gemU.heat.value + 0.15);
      } else if (part?.startsWith('crack_') && point) {
        this.ctx.particles.emit({ pos: point, count: 5, spread: 3, up: 1, life: [0.3, 0.7], size: [0.22, 0.05], sprite: ['spark', 'glow8'], additive: true, color: [0xffd98a, 0xffa53a], gravity: 6, drag: 1 });
      }
      if (point && rnd.chance(0.35)) this.ctx.particles.emit({ pos: point, count: 3, spread: 3, up: 1, life: [0.5, 1], size: [0.12, 0.08], sprite: 'pebble', color: STONE, gravity: 16, ground: true, bounce: 0.3, rot: 6, rotSpeed: 8 });
    }
    // the riddles: once in each of the first two phases
    if (this.alive && !this.queue.includes('riddle') && ((this.riddles === 0 && this.frac < 0.84) || (this.riddles === 1 && this.frac < 0.5))) this.queue.unshift('riddle');
    return amt;
  }

  // ================================================================== per-frame
  update(dt: number) {
    if (!this.root.visible && !this.alive && !this.chunks.length) return;
    this.t += dt;
    this.hitT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    for (const k of Object.keys(this.cds) as (keyof typeof this.cds)[]) this.cds[k] -= dt;
    this.exposedT = Math.max(0, this.exposedT - dt);
    this.gemOpenT = Math.max(0, this.gemOpenT - dt);
    this.plantedWeak = Math.max(0, this.plantedWeak - dt);
    this.dazeT = Math.max(0, this.dazeT - dt);
    this.blinkT = Math.max(0, this.blinkT - dt);
    // statuses
    const tick = this.status.tick(dt, this.maxHp, false, true);
    if (tick && this.alive) {
      if (tick.poison > 0) this.takeDamage({ base: tick.poison, kind: 'magic', source: 'poison', canCrit: false });
      if (this.alive && tick.burn > 0) this.takeDamage({ base: tick.burn, kind: 'magic', source: 'burn', canCrit: false });
    }
    if (!this.ready) return;
    // locomotion: a slow, heavy walk (the leaps move it on their own)
    if (this.walkTo && this.alive) {
      const dx = this.walkTo.x - this.pos.x, dz = this.walkTo.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.5) this.walkTo = null;
      else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 1.4, dt);
        const sp = this.walkSpeed * this.status.slowMul() * clamp(1 - Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - this.yaw), Math.cos(Math.atan2(dx, dz) - this.yaw))), 0.2, 1);
        this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * sp, 3, dt);
        this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * sp, 3, dt);
      }
    } else {
      this.vel.x = damp(this.vel.x, 0, 4, dt);
      this.vel.z = damp(this.vel.z, 0, 4, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // it keeps its face toward its toy
    if (this.alive && !this.dormant && !this.walkTo && this.air === 0 && this.turnRate > 0 && Math.abs(this.N.roll) < 0.1) this.faceTarget(this.player.pos, this.turnRate * (this.phase >= 2 ? 1.4 : 1), dt);
    // keep the body inside the storm
    const sd = this.ctx.world.storm.sdf(this.pos.x, this.pos.z);
    if (sd < 16 && this.alive) {
      const inw = this.ctx.world.storm.inward(this.pos.x, this.pos.z, { x: 0, z: 0 });
      this.pos.x += inw.x * (16 - sd) * dt * 2;
      this.pos.z += inw.z * (16 - sd) * dt * 2;
    }
    // stand on the ground (or the water) under the body
    const f = this.fwd(_a);
    const gF = this.ground(this.pos.x + f.x * 6, this.pos.z + f.z * 6), gB = this.ground(this.pos.x - f.x * 9, this.pos.z - f.z * 9);
    const g0 = Math.min(gF, gB);
    this.pos.y = g0 + this.air;
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.root.scale.setScalar(1);
    if (this.dead) this.updateChunks(dt);
    else this.animate(dt, gF - g0, gB - g0);
    this.rig.material.userData.fx.value.x = this.flash * 0.45;
    this.holdUpdate();
    this.updateRings(dt);
    if (this.alive) {
      this.updateSites(dt);
      this.collide();
      this.ambient(dt);
    }
    this.updateGate(dt);
  }

  /** the body is solid: the hunter slides off it */
  private collide() {
    if (this.hold || this.dormant) return;
    const pl = this.player;
    if (!pl.alive) return;
    const p = pl.pos;
    const a = this.nodePos('hips', _a), b = this.nodePos('chest', _b).add(this.fwd(_w).multiplyScalar(2.5));
    const ab = _w.copy(b).sub(a);
    const t = clamp(((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / (ab.x * ab.x + ab.z * ab.z || 1), 0, 1);
    const cx = a.x + ab.x * t, cz = a.z + ab.z * t;
    const r = 4.4;
    const dx = p.x - cx, dz = p.z - cz, dd = Math.hypot(dx, dz);
    if (dd < r && p.y < a.y + 3) {
      const nx = dd > 0.01 ? dx / dd : Math.cos(this.yaw), nz = dd > 0.01 ? dz / dd : -Math.sin(this.yaw);
      p.x = cx + nx * r;
      p.z = cz + nz * r;
      const v = pl.board.vel, into = v.x * nx + v.z * nz;
      if (into < 0) {
        v.x -= nx * into * 1.3;
        v.z -= nz * into * 1.3;
      }
    }
  }

  private updateRings(dt: number) {
    const pl = this.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const prev = r.r;
      r.r += r.speed * dt;
      r.fx -= dt;
      if (r.fx <= 0) {
        r.fx = 0.07;
        const n = Math.round(6 + r.r * 0.6);
        for (let k = 0; k < n; k++) {
          const a = rnd.next() * TAU;
          const x = r.x + Math.cos(a) * r.r, z = r.z + Math.sin(a) * r.r;
          const y = this.ground(x, z);
          if (this.wet(x, z)) this.ctx.particles.emit({ pos: { x, y: y + 0.1, z }, count: 2, vel: { x: Math.cos(a) * 3, y: 4, z: Math.sin(a) * 3 }, spread: 1, gravity: 14, life: [0.4, 0.8], size: [0.14, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: WATER, ground: true });
          else this.ctx.particles.emit({ pos: { x, y: y + 0.1, z }, count: 2, vel: { x: Math.cos(a) * 3, y: 3, z: Math.sin(a) * 3 }, spread: 1, gravity: 12, life: [0.4, 0.8], size: [0.18, 0.1], sprite: GRAINS, color: SAND, ground: true });
        }
      }
      const d = Math.hypot(pl.pos.x - r.x, pl.pos.z - r.z);
      if (!r.hit && pl.alive && !this.hold && d > prev - 1 && d < r.r + 0.6 && pl.pos.y < this.ground(pl.pos.x, pl.pos.z) + 1.2) {
        r.hit = true;
        pl.takeHit({ base: r.dmg, kind: 'phys', source: 'contact', knock: r.knock }, _v.set(r.x, pl.pos.y, r.z));
        pl.board.impulse.y += 5;
      }
      if (r.r > r.max) this.rings.splice(i, 1);
    }
  }

  private ambient(dt: number) {
    this.fxT += dt;
    if (this.fxT < 0.08) return;
    const k = this.fxT;
    this.fxT = 0;
    // stone grinding: dust and grit shaken out of the joints, a low groan of rock
    if (this.grind > 0.25) {
      for (const n of ['arm_l', 'arm_r', 'thigh_l', 'thigh_r', 'neck']) if (rnd.chance(Math.min(0.8, this.grind * 0.35))) this.grit(this.nodePos(n, _a).add(_b.set(0, 1.5, 0)), Math.min(1.4, this.grind * 0.5));
      this.grindSfxT -= k;
      if (this.grindSfxT <= 0 && this.grind > 0.8) {
        this.grindSfxT = 0.7 + rnd.next() * 0.5;
        this.ctx.sfx('rock_crumble', this.pos, Math.min(0.8, this.grind * 0.3), 0.4 + rnd.next() * 0.15);
      }
    }
    // the open seams breathe light and sparks
    let best = 0;
    for (const s of this.sites) {
      if (s.open < 0.2) continue;
      if (s.open > best) {
        best = s.open;
        this.nodePos(s.name, _a);
        this.root.worldToLocal(this.seamLight.position.copy(_a));
      }
      if (rnd.chance(0.25 * s.open)) {
        this.nodePos(s.name, _a);
        this.ctx.particles.emit({ pos: _a, count: 1, spread: 1.6, up: 1.2, life: [0.6, 1.3], size: [0.12, 0.04], sprite: ['spark', 'glow8'], additive: true, color: [0xffd98a, 0xffa53a], gravity: -1, drag: 0.8, jitter: s.r * 0.4 });
      }
    }
    this.seamLight.intensity = best * (5 + this.phase * 2) + Math.sin(this.t * 2.6) * best;
    this.gemLight.intensity = (this.gemU.glow.value * 3 + (this.gemOpenT > 0 ? 8 : 0)) * (0.85 + Math.sin(this.t * 3.2) * 0.15);
  }

  // ================================================================== procedural animation
  /** set pose targets (rate: how fast the body follows) */
  private pose(p: Partial<typeof this.P>, rate = 2.2) {
    Object.assign(this.P, p);
    this.P.rate = rate;
  }
  /** jump straight into the current targets (no blend) */
  private snapPose() {
    if (!this.ready) return;
    Object.assign(this.N, { rear: this.P.rear, front: this.P.front, roll: this.P.roll, lean: 0, twist: 0, foreZ: this.P.foreZ, hindZ: this.P.hindZ, foreX: this.P.foreX, hindX: this.P.hindX });
    if (this.dormant) Object.assign(this.N, { rear: -5, front: -4.6, foreZ: 4.5, hindZ: 3.4, foreX: 0.4, hindX: 1.2 });
    if (this.dormant) Object.assign(this.P, { rear: -5, front: -4.6, foreZ: 4.5, hindZ: 3.4, foreX: 0.4, hindX: 1.2 });
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);
    for (const l of this.legs) {
      this.homeOf(l, l.plant);
      l.now.copy(l.plant);
      l.step = null;
      l.mode = 'plant';
    }
  }
  /** where a leg's sole rests under the current pose (world) */
  private homeOf(l: Leg, out: THREE.Vector3) {
    const sg = l.side === 0 ? 1 : -1;
    const N = this.N;
    const x = l.sole.x + sg * (l.front ? N.foreX : N.hindX);
    const z = l.sole.z + (l.front ? N.foreZ : N.hindZ) + (l.front ? 0.7 : 0.4) * Math.sin(this.N.twist) * sg;
    this.bodyPt(x, 0, z, out);
    out.y = this.ground(out.x, out.z);
    return out;
  }
  /** aim a paw at a body-frame point (rig-local metres; y above the ground under it) */
  private aimLocal(l: Leg, x: number, y: number, z: number, rate: number, ori: { pitch: number; roll: number; yaw: number }, curl: number) {
    this.bodyPt(x, 0, z, l.tgt);
    l.tgt.y = this.ground(l.tgt.x, l.tgt.z) + y;
    if (l.mode !== 'aim') {
      l.mode = 'aim';
      l.step = null;
    }
    l.rate = rate;
    l.ori.set(ori.pitch, ori.roll, ori.yaw);
    l.curl = curl;
  }
  /** give a paw back to the ground: it steps down to its home */
  private toPlant(l: Leg) {
    if (l.mode === 'plant') return;
    l.mode = 'plant';
    l.ori.set(0, 0, 0);
    l.curl = 0;
    const to = this.homeOf(l, new THREE.Vector3());
    l.step = { from: l.now.clone(), to, t: 0, dur: 0.38, h: 0.6 };
  }
  private footfall(p: THREE.Vector3, k: number) {
    const y = this.ground(p.x, p.z);
    this.splash(p.x, y, p.z, 0.9 * k);
    if (k > 0.8) this.ctx.shake(Math.max(0, 0.22 * k - this.distToPlayer() * 0.004));
    if (rnd.chance(0.7)) this.ctx.sfx(this.wet(p.x, p.z) ? 'water_loop' : 'footstep_sand', { x: p.x, y, z: p.z }, 0.7, 0.35);
    if (k > 1.5) this.ctx.sfx('rock_crumble', { x: p.x, y, z: p.z }, 0.6, 0.45);
  }

  protected animate(dt: number, frontGround = 0, backGround = 0) {
    const n = this.rig.nodes;
    const t = this.t;
    const P = this.P, N = this.N;
    const r = P.rate;
    N.rear = damp(N.rear, P.rear, r, dt);
    N.front = damp(N.front, P.front, r, dt);
    N.foreZ = damp(N.foreZ, P.foreZ, r, dt);
    N.hindZ = damp(N.hindZ, P.hindZ, r, dt);
    N.foreX = damp(N.foreX, P.foreX, r, dt);
    N.hindX = damp(N.hindX, P.hindX, r, dt);
    N.twist = damp(N.twist, P.twist, 5, dt);
    if (Math.abs(P.roll - N.roll) > 1e-3) N.roll = damp(N.roll, P.roll, 4, dt);
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    const breathe = Math.sin(t * 0.7) * 0.012;
    const wig = this.wiggle * Math.sin(t * 13);
    // ------------------------------------------------------------ body: rear and front heights pitch the spine about the hips
    const rollAbs = Math.abs(N.roll);
    const rollDrop = -5.0 * clamp(Math.sin(Math.min(rollAbs, Math.PI / 2)) + (rollAbs > Math.PI / 2 ? 0.15 : 0), 0, 1.1);
    const rear = N.rear + backGround + rollDrop + this.wiggle * 0.5 + wig * 0.25;
    const front = N.front + frontGround + rollDrop;
    const hipsR = this.rest['hips'];
    n['hips'].position.set(hipsR.x + wig * 0.4, hipsR.y + rear, hipsR.z);
    const pitch = -Math.atan2(front - rear, 11.8) + this.airPitch;
    n['hips'].rotation.set(pitch, N.twist * 0.25 + wig * 0.06, N.roll + N.lean + hitK * 0.01);
    n['belly'].rotation.set(breathe * 0.5 + hitK * 0.02, N.twist * 0.3 - wig * 0.08, -N.lean * 0.3);
    n['chest'].rotation.set(breathe, N.twist * 0.35, -N.lean * 0.3);
    // ------------------------------------------------------------ the head: it watches its toy, slow and heavy; tilts like a curious cat
    this.headDown = damp(this.headDown, this.headDownT, 2.5, dt);
    const head = n['head'], neck = n['neck'];
    let yawT = 0, pitchT = 0;
    const lookAt = this.look ?? (this.dormant ? null : this.player.center(_L));
    if (lookAt) {
      neck.parent!.updateWorldMatrix(true, false);
      const lp = neck.parent!.worldToLocal(_v.copy(lookAt));
      const hp = this.rest['head'];
      const dx = lp.x - hp.x, dy = lp.y - hp.y, dz = lp.z - hp.z;
      yawT = clamp(Math.atan2(dx, dz), -1.0, 1.0);
      pitchT = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.75);
    }
    this.headYaw = damp(this.headYaw, yawT, this.lookRate, dt);
    this.headPitch = damp(this.headPitch, pitchT + this.headDown, this.lookRate, dt);
    this.headTilt = damp(this.headTilt, this.tiltT, 2, dt);
    neck.rotation.set(this.headPitch * 0.4 - pitch * 0.35, this.headYaw * 0.4, -N.roll * 0.15);
    head.rotation.set(this.headPitch * 0.6 - pitch * 0.25 + hitK * 0.06, this.headYaw * 0.6, this.headTilt + Math.sin(t * 0.37) * 0.02);
    // jaw, brows, lappets (stone cloth hangs)
    this.jaw = damp(this.jaw, this.jawT + this.rig.exprJaw * 0.5, 6, dt);
    if (n['jaw']) n['jaw'].rotation.x = this.jaw * 0.55;
    if (n['brow_l']) n['brow_l'].rotation.z = damp(n['brow_l'].rotation.z, this.rig.exprBrow[0], 8, dt);
    if (n['brow_r']) n['brow_r'].rotation.z = damp(n['brow_r'].rotation.z, this.rig.exprBrow[1], 8, dt);
    for (const sd of ['l', 'r']) {
      const lap = n['lappet_' + sd];
      if (lap) lap.rotation.set(-(this.headPitch * 0.6 + this.headPitch * 0.4) * 0.75 + pitch * 0.4, 0, 0);
    }
    // eyes: they find the hunter; blink and pupil state
    this.root.updateMatrixWorld(true);
    if (lookAt && !this.dormant) {
      for (const sd of ['l', 'r']) {
        const eye = n['eye_' + sd];
        if (!eye) continue;
        const lp = head.worldToLocal(_v.copy(lookAt)).sub(eye.position).normalize();
        _q.setFromUnitVectors(_w.set(0, 0, 1), lp);
        _qi.identity().slerp(_q, 0.5);
        eye.quaternion.slerp(_qi, 1 - Math.exp(-8 * dt));
      }
    }
    if (this.G) {
      const want = this.dormant || this.blinkT > 0 || this.dead ? 'shut' : this.pupil === 'shut' ? 'slit' : this.pupil;
      if (want !== this.pupil || this.blinkT > 0) {
        for (const sd of ['l', 'r']) {
          const m = this.rig.meshes['eye_' + sd];
          const g = this.G.eyes[`${this.blinkT > 0 || this.dormant || this.dead ? 'shut' : want}_${sd}`];
          if (m && g) m.geometry = g;
        }
      }
    }
    // occasional blinks and a relaxed pupil
    if (!this.dormant && rnd.chance(dt * 0.15)) this.blinkT = 0.14;
    if (this.pupil === 'wide' && rnd.chance(dt * 0.25) && !this.hold) this.setPupil('slit');
    // ------------------------------------------------------------ tail: a lazy swish, the tip flicks; whips on command
    this.whip = damp(this.whip, this.whipT, this.whipT !== 0 ? 10 : 4, dt);
    this.tailUp = damp(this.tailUp, this.tailUpT, 3, dt);
    const agit = 0.25 + this.phase * 0.25 + this.tailUp * 0.5 + this.wiggle;
    for (let i = 1; i <= 8; i++) {
      const tn = n['tail' + i];
      if (!tn) continue;
      const lag = i * 0.55;
      const sw = Math.sin(t * (0.9 + agit) - lag) * (0.06 + i * 0.02) * (0.6 + agit) + (i > 5 ? Math.sin(t * 5 - lag * 2) * 0.08 * agit : 0);
      const up = -this.tailUp * (i < 4 ? 0.28 : -0.1) + (this.dormant ? 0.12 : 0);
      const wh = this.whip * this.whipSide * (i < 3 ? 0.35 : 0.25);
      tn.rotation.set(up + Math.sin(t * 0.6 - lag) * 0.03, wh * 0.4, sw + wh);
    }
    // ------------------------------------------------------------ legs
    this.root.updateMatrixWorld(true);
    let moving = 0;
    for (const l of this.legs) moving += this.legStep(l, dt);
    for (const l of this.legs) this.solveLeg(l, dt);
    // toes: curl (grip) and spread (claws out)
    for (const l of this.legs) {
      l.curlNow = damp(l.curlNow, l.curl, 8, dt);
      l.toes.forEach((toe, k) => {
        if (!toe) return;
        const c = l.curlNow;
        toe.rotation.set(c > 0 ? c * 1.2 : c * 0.5, 0, (c < 0 ? -c * 0.12 : 0) * (k - 1.5));
      });
    }
    // grinding energy from how fast the big joints move
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.grind = damp(this.grind, moving * 0.6 + sp * 0.1 + Math.abs(N.roll - P.roll) + (this.air > 0 ? 1 : 0), 4, dt);
  }

  /** stepping: a planted paw lifts and moves when its home drifts too far */
  private legStep(l: Leg, dt: number) {
    if (l.mode !== 'plant') return 0;
    if (l.step) {
      const s = l.step;
      s.t += dt / s.dur;
      const k = Math.min(1, s.t), e = k * k * (3 - 2 * k);
      l.plant.lerpVectors(s.from, s.to, e);
      l.plant.y += Math.sin(k * Math.PI) * s.h;
      if (k >= 1) {
        l.step = null;
        l.plant.copy(s.to);
        this.footfall(l.plant, l.front ? 1.1 : 0.9);
      }
      return 1;
    }
    const home = this.homeOf(l, _S);
    // lead the step when walking
    home.x += this.vel.x * 0.35;
    home.z += this.vel.z * 0.35;
    const far = Math.hypot(home.x - l.plant.x, home.z - l.plant.z);
    const thr = 1.6 + (this.walkTo ? 0 : 0.6);
    if (far > thr) {
      // one paw of a pair at a time, and never both diagonals
      const busy = this.legs.some((o) => o !== l && o.step && (o.front === l.front || o.side !== l.side));
      if (!busy || far > thr * 2.5) l.step = { from: l.plant.clone(), to: home.clone(), t: 0, dur: clamp(0.55 - this.walkSpeed * 0.02, 0.3, 0.55), h: Math.min(2.2, 0.8 + far * 0.25) };
    }
    l.plant.y = this.ground(l.plant.x, l.plant.z);
    return 0;
  }

  private solveLeg(l: Leg, dt: number) {
    // the paw's wanted sole point and orientation (world)
    l.oriNow.x = damp(l.oriNow.x, l.ori.x, 8, dt);
    l.oriNow.y = damp(l.oriNow.y, l.ori.y, 8, dt);
    l.oriNow.z = damp(l.oriNow.z, l.ori.z, 8, dt);
    const bodyQ = this.root.quaternion;
    let tgt: THREE.Vector3;
    if (l.mode === 'plant') tgt = l.plant;
    else if (l.mode === 'aim') tgt = l.tgt;
    else {
      // body frame: follows the whole (rolled, pitched) body
      tgt = this.rig.nodes['hips'].localToWorld(_T.copy(l.local).sub(this.rest['hips']));
    }
    if (l.now.lengthSq() === 0) l.now.copy(tgt);
    if (l.mode === 'plant') l.now.copy(tgt);
    else l.now.lerp(tgt, 1 - Math.exp(-l.rate * dt));
    // paw orientation: body yaw, then the paw's own pitch / roll / yaw; in body mode it follows the body
    // a lying cat rests its hind feet flat, hock down
    const lieK = !l.front && l.mode === 'plant' ? clamp((-this.N.rear - 1.5) / 3.5, 0, 1) : 0;
    _e.set(l.oriNow.x - 0.85 * lieK, l.oriNow.z, l.oriNow.y, 'YXZ');
    _qp.setFromEuler(_e);
    const Qp = l.mode === 'body' ? this.rig.nodes['hips'].getWorldQuaternion(_qa).multiply(_qp) : _qf.copy(bodyQ).multiply(_qp);
    // wrist / hock point from the sole
    const W = _E.copy(l.soleOff).applyQuaternion(Qp).negate().add(l.now);
    // two-bone IK
    const up = l.upper, lo = l.lower;
    up.parent!.updateWorldMatrix(true, false);
    const qPar = up.parent!.getWorldQuaternion(_q1);
    up.getWorldPosition(_S);
    const D = _v.copy(W).sub(_S);
    const L1 = l.L1, L2 = l.L2;
    const dist = clamp(D.length(), Math.abs(L1 - L2) + 0.05, (L1 + L2) * 0.998);
    const dir = D.normalize();
    // the elbow points back, the knee forward (slightly out)
    const sg = l.side === 0 ? 1 : -1;
    const pole = _w.set(sg * 0.25, l.front ? -0.2 : 0.1, l.front ? -1 : 1).applyQuaternion(l.mode === 'body' ? this.rig.nodes['hips'].getWorldQuaternion(_qi) : bodyQ);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const E = _a.copy(_S).addScaledVector(dir, a).addScaledVector(pole, h);
    const T = _b.copy(_S).addScaledVector(dir, dist);
    const qInv = _qi.copy(qPar).invert();
    const qa = _q2.setFromUnitVectors(l.u0, _T.copy(E).sub(_S).normalize().applyQuaternion(qInv));
    const qw = _q3.copy(qPar).multiply(qa);
    const qf = _q4.setFromUnitVectors(l.f0, _T.copy(T).sub(E).normalize().applyQuaternion(_qi.copy(qw).invert()));
    up.quaternion.copy(qa);
    lo.quaternion.copy(qf);
    // the paw itself
    const qEnd = qw.multiply(qf);
    l.end.quaternion.copy(qEnd.invert().multiply(Qp));
    up.updateMatrixWorld(true);
  }

  // ================================================================== death: the statue breaks; the gate opens
  die() {
    if (!this.alive || this.dead) return;
    this.dead = true;
    const ctx = this.ctx;
    this.releaseHunter();
    this.clearRiddle();
    hush3D('sphinx_riddle');
    this.d.cam.setCine(null);
    this.setExpr('defeated');
    this.callout("Knockin' on Heaven's Door");
    this.taunt('You… play… rough…');
    ctx.engine.slowMo(0.25, 30);
    ctx.engine.tweens.after(1.6, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.6);
    ctx.shake(1);
    ctx.engine.flash(0xfff0c8, 0.35, 0.7);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    this.invulnerable = true;
    this.rings = [];
    void this.deathSequence().catch((e) => console.warn('[sphinx] death', e));
  }
  private async deathSequence() {
    const ctx = this.ctx, tw = ctx.engine.tweens, cam = this.d.cam;
    // 1) it staggers and sinks down onto its belly; every crack burns open
    ctx.engine.letterbox(true, 0.6);
    const f = this.fwd(new THREE.Vector3()), s = this.side(new THREE.Vector3());
    const camP = this.pos.clone().addScaledVector(f, 34).addScaledVector(s, 18);
    camP.y = this.ground(camP.x, camP.z) + 6;
    const lookP = this.pos.clone().add(new THREE.Vector3(0, 9, 0));
    cam.setCine({ pos: camP, look: lookP, fov: 50 });
    for (const l of this.legs) this.toPlant(l);
    this.pose({ rear: -5, front: -4.4, foreZ: 3, hindZ: 3, foreX: 0.6, hindX: 1.2 }, 1.2);
    this.headDownT = 0.6;
    this.jawT = 0.5;
    for (let t = 0; t < 2.6; t += 1 / 30) {
      const k = t / 2.6;
      this.U.seam.value = k * k;
      this.U.heat.value = k * 0.8;
      this.U.glow.value = 1 + k * 2;
      this.N.lean = Math.sin(t * 9) * 0.03 * (1 - k);
      this.animate(1 / 30, 0, 0);
      if (rnd.chance(0.4)) this.grit(this.bodyPt((rnd.next() - 0.5) * 8, 5 + rnd.next() * 6, (rnd.next() - 0.5) * 20, _a), 1.3);
      if (rnd.chance(0.25)) ctx.shake(0.3);
      if (rnd.chance(0.2)) ctx.sfx('ore_crack', this.pos, 0.8, 0.5 + rnd.next() * 0.3);
      this.seamLight.intensity = 6 + k * 18;
      await tw.wait(1 / 30);
    }
    // 2) it breaks apart
    ctx.sfx('explosion_big', this.pos, 1, 0.45);
    ctx.sfx('rock_crumble', this.pos, 1, 0.4);
    ctx.engine.flash(0xffe0a0, 0.45, 0.6);
    ctx.shake(1.2);
    this.shatter();
    // 3) the gate opens
    await tw.wait(2.2);
    if (this.gate) {
      const g = this.gate.root;
      const gp = g.position.clone();
      const gf = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
      cam.setCine({ pos: gp.clone().addScaledVector(gf, 46).add(new THREE.Vector3(0, 7, 0)), look: gp.clone().add(new THREE.Vector3(0, 9, 0)), fov: 52 });
    }
    this.gateOpenT = 1;
    ctx.sfx('door_creak', this.gate?.root.position ?? this.pos, 1, 0.3);
    ctx.sfx('quake_rumble', this.gate?.root.position ?? this.pos, 1, 0.4);
    ctx.toast('THE RIVER GATE OPENS', COL, 'The upper Nile lies beyond', true);
    const nile = (ctx.world as unknown as { nile?: NileWorldLike }).nile;
    nile?.openGate?.();
    ctx.events.emit('nileGateOpen', { x: this.gate?.root.position.x ?? this.pos.x, z: this.gate?.root.position.z ?? this.pos.z });
    await tw.wait(3.2);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.6);
    ctx.fx.coins({ x: this.pos.x, y: this.ground(this.pos.x, this.pos.z) + 2, z: this.pos.z }, 40);
    // now the wave may end (and the run travel on through the open gate)
    this.alive = false;
    this.onDefeated?.(this, false);
    await tw.wait(6);
    this.finish();
  }
  /** every part breaks off and tumbles: the head rolls into the river */
  private shatter() {
    const ctx = this.ctx;
    this.root.updateMatrixWorld(true);
    const BREAK = /^(hips|belly|chest|neck|head|arm_[lr]|fore_[lr]|paw_[lr]|thigh_[lr]|shin_[lr]|foot_[lr]|tail\d)$/;
    const nodes = Object.values(this.rig.nodes);
    for (const node of nodes) {
      if (!BREAK.test(node.name)) continue;
      ctx.scene.attach(node);
      const p = node.getWorldPosition(new THREE.Vector3());
      const out = p.clone().sub(this.pos).setY(0);
      const l = out.length() || 1;
      out.multiplyScalar(1 / l);
      const head = node.name === 'head';
      const v = out.multiplyScalar(head ? 3 : 1.5 + rnd.next() * 3).add(new THREE.Vector3(0, head ? 4 : 2 + rnd.next() * 4, 0));
      if (head) v.addScaledVector(this.fwd(_a), 5);
      this.chunks.push({ node, v, w: new THREE.Vector3((rnd.next() - 0.5) * 1.6, (rnd.next() - 0.5) * 1.2, (rnd.next() - 0.5) * 1.6).multiplyScalar(head ? 0.5 : 1), t: 0, landed: false, sink: 0 });
      ctx.events.emit('gibs', p.x, p.y, p.z, head ? 14 : 8, 0.45, STONE, 6, 5);
    }
    for (let i = 0; i < 8; i++) {
      const p = this.bodyPt((rnd.next() - 0.5) * 10, 4 + rnd.next() * 8, (rnd.next() - 0.5) * 24, new THREE.Vector3());
      ctx.particles.emit({ pos: p, count: 3, spread: 3, up: 1, life: [2, 3.5], size: [3, 7], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0xe8d4ac, 0xd8c094, 0xc4a77c], alpha: 0.85, drag: 1.2, rot: 6, rotSpeed: 0.4, jitter: 2 });
    }
    this.seamLight.intensity = 0;
  }
  private updateChunks(dt: number) {
    for (const c of this.chunks) {
      c.t += dt;
      const n = c.node;
      if (!c.landed) {
        c.v.y -= 18 * dt;
        n.position.addScaledVector(c.v, dt);
        n.rotation.x += c.w.x * dt;
        n.rotation.y += c.w.y * dt;
        n.rotation.z += c.w.z * dt;
        const g = this.ground(n.position.x, n.position.z);
        if (n.position.y < g + 0.6 && c.v.y < 0) {
          if (Math.abs(c.v.y) > 6) {
            c.v.y *= -0.25;
            c.v.x *= 0.5;
            c.v.z *= 0.5;
            c.w.multiplyScalar(0.5);
            this.splash(n.position.x, g, n.position.z, n.name === 'head' ? 3 : 1.6);
            this.ctx.sfx('rock_crumble', n.position, 0.7, 0.4 + rnd.next() * 0.3);
            this.ctx.shake(n.name === 'head' ? 0.6 : 0.15);
          } else c.landed = true;
        }
      } else if (c.t > 4) {
        // settle, then sink away into the river and the sand
        c.sink += dt;
        n.position.y -= dt * 0.6;
        if (rnd.chance(dt * 2)) this.splash(n.position.x, this.ground(n.position.x, n.position.z), n.position.z, 0.6);
      }
    }
    if (this.chunks.length) this.rig.material.userData.fx.value.y = clamp((this.chunks[0].t - 5) / 6, 0, 1) * 0.9;
  }
  private updateGate(dt: number) {
    if (!this.gate) return;
    this.gateOpen = damp(this.gateOpen, this.gateOpenT, 0.45, dt);
    const k = this.gateOpen;
    this.gate.nodes['door_l'].rotation.y = k * 1.75;
    this.gate.nodes['door_r'].rotation.y = -k * 1.75;
    if (k > 0.02 && k < 0.95 && rnd.chance(dt * 6)) {
      for (const sd of [-1, 1]) {
        const p = this.gate.root.localToWorld(_a.set(sd * 10, 1 + rnd.next() * 14, 0));
        this.grit(p, 0.8);
      }
    }
  }
  /** the fight is over: the corpse is gone; the gate stays open behind the hunter */
  private finish() {
    for (const c of this.chunks) c.node.removeFromParent();
    this.chunks = [];
    this.dispose();
  }

  dispose() {
    if (!this.root.parent && !this.chunks.length && !this.ready) return;
    super.dispose();
    this.releaseHunter();
    this.clearRiddle();
    for (const c of this.chunks) c.node.removeFromParent();
    this.chunks = [];
    this.seamLight.removeFromParent();
    this.gemLight.removeFromParent();
    // materials are ours; the geometry belongs to the shared cache (released with the run, or after the gate)
    for (const m of this.mats) m.dispose();
    this.mats = [];
    this.offRelease?.();
    if ((window as any).__sphinx === this) (window as any).__sphinx = null;
  }
}

// ============================================================================ riddles (folk riddles, retold)
const RIDDLES: { q: string; a: [string, string, string] }[] = [
  { q: 'What walks on four legs at dawn, on two at noon, and on three at dusk?', a: ['MAN', 'LION', 'SCARAB'] },
  { q: 'I have a mouth but never eat, a bed but never sleep, and I run but never walk. What am I?', a: ['A RIVER', 'A SNAKE', 'A COWBOY'] },
  { q: 'The more of me you take, the more you leave behind. What am I?', a: ['FOOTSTEPS', 'GOLD', 'BULLETS'] },
  { q: 'I am always coming, but I never arrive. What am I?', a: ['TOMORROW', 'THE TIDE', 'A STRANGER'] },
  { q: 'What has a neck but no head, and wears a cap?', a: ['A BOTTLE', 'A MUMMY', 'A CACTUS'] },
];

// ============================================================================ release the carved geometry when the run ends
let releaseBound = false;
function bindSphinxRelease(ctx: { engine: { onAfterUpdate: ((dt: number, rdt: number) => void)[]; current: { scene: unknown } | null }; scene: unknown }) {
  if (releaseBound) return;
  releaseBound = true;
  const eng = ctx.engine, scene = ctx.scene;
  const tick = () => {
    if (eng.current?.scene === scene) return;
    const i = eng.onAfterUpdate.indexOf(tick);
    if (i >= 0) eng.onAfterUpdate.splice(i, 1);
    releaseBound = false;
    releaseSphinxGeos();
  };
  eng.onAfterUpdate.push(tick);
}
/** warm the colossus a few waves early (called through NILE_PREWARM) */
export function prewarmSphinx(ctx?: { engine: { onAfterUpdate: ((dt: number, rdt: number) => void)[]; current: { scene: unknown } | null }; scene: unknown }) {
  void loadSphinxGeos();
  if (ctx) bindSphinxRelease(ctx);
}
