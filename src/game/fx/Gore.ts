// Gore for the instanced horde: what makes losing a limb feel GOOD.
//  - sculpted wound caps (torn flesh around a bone cross-section / splintered
//    bone spilling sand / cracked chitin oozing ichor) on the stump AND on the
//    cut end of the flying limb, riding the body part or the ragdoll piece
//  - arterial jets that pump in heartbeats (a fountain from a neck), droplets
//    stretched by speed, mist puffs, landing splats soaked into the sand
//  - spreading pools under collapsed corpses, voxel gibs for violent deaths
//  - skulls that burst on a crit headshot (bone chips, red mist, a neck fountain),
//    exit-wound sprays through the back of a shot body, bodies torn at the waist
//  - every count is capped so a horde can die all at once
//  - every creature bleeds what it is made of: blood, sand, embalming dust,
//    green ichor, acid
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { VoxelModel, mix } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hash2 } from '../../engine/math/rand';

export type Fluid = 'blood' | 'sand' | 'dust' | 'ichor' | 'acid';

interface FluidInfo {
  cols: number[];
  mist: number;
  /** ground-mark channel (2 blood, 3 venom-green) or -1 */
  mark: number;
  gravity: number;
  sprite: string[];
  cap: 0 | 1 | 2;
  gib: number[];
}

export const FLUIDS: Record<Fluid, FluidInfo> = {
  blood: { cols: [0xc81e1e, 0x9a1010, 0xe03a2a, 0x6a0808], mist: 0xa81414, mark: 2, gravity: 13, sprite: ['blood0', 'blood1', 'blood2', 'dot3'], cap: 0, gib: [0x8a1010, 0xb02020, 0xd85a4a, 0xf0e3c6, 0x5a0a0a] },
  sand: { cols: [0xe8c890, 0xd6a968, 0xb88a50, 0xf3dcab], mist: 0xd8bd8a, mark: -1, gravity: 15, sprite: ['dot3', 'grain0', 'grain1', 'dot4'], cap: 1, gib: [0xf0e3c6, 0xe1d0ab, 0xb88a50, 0x8a6a45] },
  dust: { cols: [0x5a4630, 0x3a2a1a, 0xd8ccb0, 0x8a7656], mist: 0x8a7656, mark: -1, gravity: 9, sprite: ['dot3', 'grain0', 'dot4'], cap: 1, gib: [0xd8ccb0, 0xc9b994, 0x5a4630, 0x3a2a1a] },
  ichor: { cols: [0x9dff3a, 0x6fbf2a, 0xd8ff9a, 0x4a8a1a], mist: 0x7fd030, mark: 3, gravity: 12, sprite: ['dot3', 'dot4', 'grain0'], cap: 2, gib: [0x3a2414, 0x5a3a1e, 0x9dff3a, 0x6fbf2a] },
  acid: { cols: [0xb8f05c, 0x9dff3a, 0xeaffb0, 0xc81e1e], mist: 0x9dff3a, mark: 3, gravity: 12, sprite: ['dot3', 'dot4', 'blood0'], cap: 0, gib: [0x8a1010, 0xb8f05c, 0x9dff3a, 0xf0e3c6] },
};

/** what an enemy bleeds */
export function fluidFor(id: string, hitKind: string, alpha = false): Fluid {
  if (/husk/i.test(id)) return 'sand';
  if (id === 'mummy' || id === 'bandageWhipper') return 'dust';
  if ((id === 'thornyLizard' || id === 'bellSnake') && alpha) return 'acid';
  if (hitKind === 'chitin' || hitKind === 'armor') return 'ichor';
  if (hitKind === 'bone' || hitKind === 'wood') return 'sand';
  if (hitKind === 'linen') return 'dust';
  return 'blood';
}

// ------------------------------------------------------------------ caps
// Built at 1/48 m, +Y points out of the wound. ~0.2 m across before scaling.
const CAP_VS = 1 / 48;
function capModel(kind: 0 | 1 | 2) {
  const m = new VoxelModel('wound' + kind);
  const R = 5;
  const h = (x: number, z: number, s: number) => hash2(x * 7 + s, z * 13 - s);
  for (let x = -R - 1; x <= R + 1; x++)
    for (let z = -R - 1; z <= R + 1; z++) {
      const d = Math.hypot(x, z * 1.08);
      const rag = R + (h(x, z, 3) - 0.5) * 2.2; // torn, uneven rim
      if (d > rag) continue;
      const rim = d > rag - 1.6;
      if (kind === 0) {
        // torn skin lip, wet muscle, a fat ring, the bone with dark marrow
        const bone = d < 1.9;
        const marrow = d < 0.9;
        const top = rim ? Math.round(h(x, z, 5) * 2) : bone ? 2 : 1 + Math.round(h(x, z, 9) * 1.2);
        for (let y = -1; y <= top; y++) {
          let c: number;
          if (marrow && y === top) c = 0x5a1414;
          else if (bone) c = y === top ? 0xf3e8cf : 0xe1d0ab;
          else if (rim) c = y >= top - 0 ? mix(0xd88a6a, 0xb86048, h(x, y, z)) : 0x9a3a2a;
          else if (d < 2.6) c = 0xf2d9a8; // fat / fascia ring
          else c = y === top ? mix(0xd42a22, 0xa01414, h(x + y, z, 1)) : 0x7a0c0c;
          m.set(x, y, z, c);
        }
        // a strand of sinew and a hanging drip
        if (h(x, z, 21) > 0.93 && d > 2 && d < R - 1) m.set(x, top + 1, z, 0xc24a3a);
      } else if (kind === 1) {
        // splintered bone shafts of uneven length, peeled dry hide, sand spilling over
        const bone = d < 2.3;
        const top = bone ? 1 + Math.round(h(x, z, 4) * 4) : rim ? Math.round(h(x, z, 6) * 2.4) : 0;
        for (let y = -1; y <= top; y++) {
          let c: number;
          if (bone) c = y === top ? 0xf6ecd6 : mix(0xe8dcbc, 0xcdb88e, h(x, y, z));
          else if (rim) c = mix(0x9a6a42, 0x7a5232, h(x, y, z)); // dried hide
          else c = mix(0xe3bd80, 0xd6a968, h(x, y, z)); // sand
          m.set(x, y, z, c);
        }
        if (!bone && !rim && h(x, z, 31) > 0.7) m.set(x, 1, z, 0xf0d29a);
      } else {
        // cracked shell shards around a bulging bead of ichor
        const goo = d < 3.2;
        const top = goo ? 1 + Math.round((1 - d / 3.2) * 2.2 + h(x, z, 2) * 0.8) : rim ? 1 + Math.round(h(x, z, 8) * 2.5) : 0;
        for (let y = -1; y <= top; y++) {
          let c: number;
          if (goo) c = y === top ? (h(x, y, z) > 0.8 ? 0xeaffb0 : 0x9dff3a) : 0x5aa020;
          else c = mix(0x3a2414, 0x5a3a1e, h(x, y, z)); // chitin
          m.set(x, y, z, c);
        }
      }
    }
  return m;
}

const MAXCAP = 128;
/** live arterial jets (oldest stop first) */
const MAXJETS = 40;
/** live spreading pools */
const MAXPOOLS = 32;

interface Holder {
  /** follow a live / dying enemy part: resolved through partWorld */
  e: any | null;
  part: number;
  /** follow a ragdoll piece (pos / quat / scale / life) */
  rag: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number; life: number } | null;
}

interface Cap {
  h: Holder;
  local: THREE.Matrix4;
  kind: 0 | 1 | 2;
}

interface Jet {
  h: Holder;
  lp: THREE.Vector3;
  ld: THREE.Vector3;
  t: number;
  life: number;
  power: number;
  speed: number;
  fluid: Fluid;
  size: number;
  acc: number;
  markT: number;
}

interface Pool {
  x: number;
  z: number;
  t: number;
  r: number;
  fluid: Fluid;
  next: number;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _mt = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Gore {
  private caps: Cap[] = [];
  private jets: Jet[] = [];
  private pools: Pool[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  group = new THREE.Group();
  /** world matrix of an enemy part (false once the enemy is gone) */
  partWorld: (e: any, part: number, out: THREE.Matrix4) => boolean = () => false;

  constructor(private ctx: Ctx) {
    this.group.name = 'gore';
    const mat = makeVoxelMaterial();
    for (const k of [0, 1, 2] as const) {
      const geo = buildVoxelGeometry(capModel(k), { voxelSize: CAP_VS, pivot: [0, 0, 0] });
      const im = new THREE.InstancedMesh(geo, mat, MAXCAP);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      this.meshes.push(im);
      this.group.add(im);
    }
    ctx.scene.add(this.group);
  }

  get count() {
    return this.caps.length + this.jets.length;
  }

  private holderWorld(h: Holder, out: THREE.Matrix4) {
    if (h.rag) {
      if (h.rag.life <= 0) return false;
      _s.setScalar(h.rag.scale);
      out.compose(h.rag.pos, h.rag.quat, _s);
      return true;
    }
    return this.partWorld(h.e, h.part, out);
  }

  /**
   * A limb came off. `holderW` = world matrix of the part that keeps the stump
   * (null if none), `jointW` = world position of the joint, `dir` = world
   * direction the limb pointed (out of the stump), `size` = limb thickness (m).
   */
  sever(o: {
    e: any;
    holder: number;
    holderW: THREE.Matrix4 | null;
    joint: THREE.Vector3;
    dir: THREE.Vector3;
    size: number;
    fluid: Fluid;
    head?: boolean;
    /** the flying limb piece + its world matrix at the cut, for a cap on the cut end */
    piece?: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number; life: number } | null;
    pieceW?: THREE.Matrix4 | null;
    /** stump jet strength multiplier (a burst skull pumps a fountain) */
    fountain?: number;
  }) {
    const fo = o.fountain ?? 1;
    const F = FLUIDS[o.fluid];
    const scale = Math.max(0.35, Math.min(2.6, (o.size * 1.15) / 0.22));
    // the stump on the body
    if (o.holderW && o.holder >= 0) {
      const inv = _m2.copy(o.holderW).invert();
      const capW = this.capMatrix(o.joint, o.dir, scale, _m);
      this.addCap({ e: o.e, part: o.holder, rag: null }, new THREE.Matrix4().multiplyMatrices(inv, capW), F.cap);
      // the jet rides the stump: local point + local direction in the holder frame
      const lp = o.joint.clone().applyMatrix4(inv);
      const ld = o.dir.clone().transformDirection(inv);
      this.addJet({
        h: { e: o.e, part: o.holder, rag: null },
        lp,
        ld,
        t: 0,
        life: (o.head ? 3.8 : 2.0 + Math.random() * 0.8) * (fo > 1 ? 1.25 : 1),
        power: (o.head ? 1.7 : 1.15) * fo,
        speed: (o.head ? 9.2 : 5.4) * (fo > 1 ? 1.15 : 1),
        fluid: o.fluid,
        size: Math.min(1.7, scale),
        acc: 0,
        markT: 0,
      });
    }
    // the cut end of the flying piece points back at the body
    if (o.piece && o.pieceW) {
      const inv = _m2.copy(o.pieceW).invert();
      const back = _d.copy(o.dir).negate();
      const capW = this.capMatrix(o.joint, back, scale, _m);
      const h: Holder = { e: null, part: -1, rag: o.piece };
      this.addCap(h, new THREE.Matrix4().multiplyMatrices(inv, capW), F.cap);
      this.addJet({ h, lp: o.joint.clone().applyMatrix4(inv), ld: back.clone().transformDirection(inv), t: 0, life: 1.6, power: 0.55, speed: 2.2, fluid: o.fluid, size: Math.min(1.2, scale), acc: 0, markT: 0 });
    }
    // the burst at the moment of the cut
    const p = this.ctx.particles;
    p.emit({ pos: o.joint, count: Math.round(22 * Math.min(1.5, scale)), vel: { x: o.dir.x * 3.6, y: 2.6, z: o.dir.z * 3.6 }, spread: 3.6, gravity: F.gravity, drag: 0.6, life: [0.45, 1.0], size: [0.065, 0.032], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.018 });
    p.emit({ pos: o.joint, count: 3, vel: { x: o.dir.x * 0.8, y: 0.6, z: o.dir.z * 0.8 }, spread: 0.6, life: [0.35, 0.7], size: [0.12, 0.34], sprite: ['puff0', 'puff1'], color: F.mist, alpha: 0.36, drag: 2.5 });
    if (F.mark >= 0) {
      this.ctx.events.emit('groundMark', o.joint.x + o.dir.x * 0.6, o.joint.z + o.dir.z * 0.6, 0.45 + Math.random() * 0.3, F.mark);
      this.ctx.events.emit('groundMark', o.joint.x + o.dir.x * 1.5, o.joint.z + o.dir.z * 1.5, 0.22 + Math.random() * 0.2, F.mark);
    }
  }

  /** move every cap / jet held by (e, part) onto its ragdoll piece */
  rehome(e: any, part: number, piece: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number; life: number }) {
    for (const c of this.caps) if (c.h.e === e && c.h.part === part) c.h = { e: null, part: -1, rag: piece };
    for (const j of this.jets) if (j.h.e === e && j.h.part === part) j.h = { e: null, part: -1, rag: piece };
  }

  /** a pool spreading under a corpse (slow seep, soaked deep into the sand) */
  pool(x: number, z: number, r: number, fluid: Fluid) {
    if (FLUIDS[fluid].mark < 0) return;
    if (this.pools.length >= MAXPOOLS) this.pools.shift();
    this.pools.push({ x, z, t: 0, r: r * 1.35, fluid, next: 0 });
  }

  private addJet(j: Jet) {
    if (this.jets.length >= MAXJETS) this.jets.shift();
    this.jets.push(j);
  }

  /**
   * A skull bursting on a crit headshot: bone chips and voxel gibs blown out
   * along the shot, a hanging cloud of mist, a spray painted on the sand
   * behind. (The neck stump + fountain come from sever(head, fountain).)
   */
  skullBurst(at: { x: number; y: number; z: number }, dir: { x: number; z: number }, fluid: Fluid, scale = 1) {
    const F = FLUIDS[fluid];
    const P = this.ctx.particles;
    const bone = [0xf3e8cf, 0xe1d0ab, 0xc9b994];
    const wet = fluid === 'blood' || fluid === 'acid' ? [0xd88a8a, 0xb84a4a, 0x8a1010] : F.gib;
    this.ctx.events.emit('gibs', at.x, at.y, at.z, Math.round(10 * scale), 0.055 * scale, [...bone, ...wet], 6.5, 4.5);
    this.ctx.events.emit('gibs', at.x + dir.x * 0.2, at.y, at.z + dir.z * 0.2, Math.round(6 * scale), 0.035 * scale, F.gib, 8, 3);
    P.emit({ pos: at, count: 12, vel: { x: dir.x * 5, y: 3, z: dir.z * 5 }, spread: 5, life: [0.6, 1.2], size: [0.06, 0.05], sprite: ['bone', 'pebble'], color: bone, gravity: 15, ground: true, bounce: 0.3, rot: 6, rotSpeed: 12 });
    P.emit({ pos: at, count: Math.round(40 * scale), vel: { x: dir.x * 5.5, y: 2.6, z: dir.z * 5.5 }, spread: 5.5, gravity: F.gravity, drag: 0.5, life: [0.5, 1.2], size: [0.075, 0.035], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.022 });
    P.emit({ pos: at, count: 6, vel: { x: dir.x * 1.6, y: 0.5, z: dir.z * 1.6 }, spread: 1.2, life: [0.9, 1.8], size: [0.25, 1.1 * scale], sprite: ['puff0', 'puff1', 'puff2', 'cloud0'], color: F.mist, alpha: 0.42, drag: 2.4, rot: 6, rotSpeed: 0.8, gravity: 0.6 });
    if (F.mark >= 0)
      for (let i = 0; i < 6; i++) {
        const k = 0.6 + i * 0.55 + Math.random() * 0.4;
        this.ctx.events.emit('groundMark', at.x + dir.x * k + (Math.random() - 0.5) * 0.8, at.z + dir.z * k + (Math.random() - 0.5) * 0.8, 0.5 - i * 0.05 + Math.random() * 0.2, F.mark);
      }
  }

  /** a round through and out the back: a cone of droplets and mist along the shot, painted on the sand behind */
  exitWound(at: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, fluid: Fluid, power = 1) {
    const F = FLUIDS[fluid];
    const P = this.ctx.particles;
    const s = 4.5 * power;
    P.emit({ pos: at, count: Math.round(14 * power), vel: { x: dir.x * s, y: dir.y * s + 1.2, z: dir.z * s }, spread: 1.8, gravity: F.gravity, drag: 0.7, life: [0.35, 0.8], size: [0.055, 0.028], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.02 });
    P.emit({ pos: at, count: 1, vel: { x: dir.x * 2, y: 0.3, z: dir.z * 2 }, spread: 0.4, life: [0.3, 0.6], size: [0.1, 0.4 * power], sprite: ['puff0', 'puff1'], color: F.mist, alpha: 0.3, drag: 3 });
    if (F.mark >= 0) this.ctx.events.emit('groundMark', at.x + dir.x * (1.2 + power), at.z + dir.z * (1.2 + power), 0.22 + 0.12 * power + Math.random() * 0.12, F.mark);
  }

  /** a body torn at the waist: a gush, strings of offal and a wide soak */
  split(at: { x: number; y: number; z: number }, dir: { x: number; z: number }, fluid: Fluid, scale = 1) {
    const F = FLUIDS[fluid];
    const offal = fluid === 'blood' || fluid === 'acid' ? [0xc86a6a, 0xa84848, 0xe0a090, 0x7a1010, 0xd8b8a0] : F.gib;
    this.ctx.events.emit('gibs', at.x, at.y, at.z, Math.round(12 * scale), 0.06 * scale, offal, 4.5, 3.5);
    this.ctx.particles.emit({ pos: at, count: Math.round(34 * scale), vel: { x: dir.x * 2, y: 3.2, z: dir.z * 2 }, spread: 4.5, gravity: F.gravity, drag: 0.5, life: [0.5, 1.2], size: [0.075, 0.035], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.02 });
    this.ctx.particles.emit({ pos: at, count: 4, spread: 1.4, up: 0.6, life: [0.6, 1.3], size: [0.25, 0.8], sprite: ['puff0', 'puff1', 'cloud1'], color: F.mist, alpha: 0.34, drag: 2.2, rot: 6, rotSpeed: 0.6 });
    if (F.mark >= 0) {
      for (let i = 0; i < 5; i++) this.ctx.events.emit('groundMark', at.x + (Math.random() - 0.5) * 2.4, at.z + (Math.random() - 0.5) * 2.4, 0.35 + Math.random() * 0.45, F.mark);
      this.pool(at.x, at.z, 0.9 * scale, fluid);
    }
  }

  /** voxel chunks for violent deaths */
  gibs(at: { x: number; y: number; z: number }, fluid: Fluid, n = 10, power = 1) {
    this.ctx.events.emit('gibs', at.x, at.y, at.z, n, 0.07, FLUIDS[fluid].gib, 5 + power * 3, 3 + power * 2);
    const F = FLUIDS[fluid];
    this.ctx.particles.emit({ pos: at, count: Math.round(32 * power), spread: 5.5, up: 3.4, gravity: F.gravity, drag: 0.5, life: [0.5, 1.2], size: [0.075, 0.035], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.02 });
    this.ctx.particles.emit({ pos: at, count: 4, spread: 1.3, up: 0.8, life: [0.5, 1.0], size: [0.22, 0.65], sprite: ['puff0', 'puff1'], color: F.mist, alpha: 0.34, drag: 2.2 });
    if (F.mark >= 0) for (let i = 0; i < 6; i++) this.ctx.events.emit('groundMark', at.x + (Math.random() - 0.5) * 3.4, at.z + (Math.random() - 0.5) * 3.4, 0.35 + Math.random() * 0.55, F.mark);
  }

  private capMatrix(at: THREE.Vector3, dir: THREE.Vector3, scale: number, out: THREE.Matrix4) {
    _q.setFromUnitVectors(UP, _v.copy(dir).normalize());
    // a random twist so caps never look stamped
    _mt.makeRotationY(Math.random() * Math.PI * 2);
    _s.setScalar(scale);
    out.compose(at, _q, _s).multiply(_mt);
    return out;
  }

  private addCap(h: Holder, local: THREE.Matrix4, kind: 0 | 1 | 2) {
    if (this.caps.length >= MAXCAP * 2) this.caps.shift();
    this.caps.push({ h, local, kind });
  }

  update(dt: number) {
    const ctx = this.ctx;
    // caps
    const n = [0, 0, 0];
    for (let i = this.caps.length - 1; i >= 0; i--) {
      const c = this.caps[i];
      if (!this.holderWorld(c.h, _m)) {
        this.caps.splice(i, 1);
        continue;
      }
      const im = this.meshes[c.kind];
      if (n[c.kind] >= MAXCAP) continue;
      _m.multiply(c.local);
      im.setMatrixAt(n[c.kind]++, _m);
    }
    for (let k = 0; k < 3; k++) {
      const im = this.meshes[k];
      im.count = n[k];
      im.instanceMatrix.needsUpdate = true;
    }
    // jets: arterial pumping in heartbeats, fading out
    const P = ctx.particles;
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.t += dt;
      if (j.t >= j.life || !this.holderWorld(j.h, _m)) {
        this.jets.splice(i, 1);
        continue;
      }
      const F = FLUIDS[j.fluid];
      _v.copy(j.lp).applyMatrix4(_m);
      _d.copy(j.ld).transformDirection(_m);
      const fade = Math.pow(1 - j.t / j.life, 1.4);
      const beat = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(j.t * 9.5)), 2);
      const rate = 82 * j.power * fade * beat;
      j.acc += rate * dt;
      const cnt = Math.floor(j.acc);
      if (cnt > 0) {
        j.acc -= cnt;
        const sp = j.speed * (0.55 + beat * 0.6) * (0.5 + fade * 0.5);
        P.emit({ pos: _v, count: cnt, vel: { x: _d.x * sp, y: _d.y * sp + 0.9, z: _d.z * sp }, spread: 0.45 + (1 - beat) * 0.35, gravity: F.gravity, drag: 0.35, life: [0.5, 1.0], size: [0.058 * j.size, 0.03 * j.size], sprite: F.sprite, color: F.cols, ground: true, stretch: 0.02 });
        if (Math.random() < 0.05 * j.power) P.emit({ pos: _v, count: 1, vel: { x: _d.x * 1.2, y: 0.4, z: _d.z * 1.2 }, spread: 0.3, life: [0.25, 0.5], size: [0.08, 0.2], sprite: ['puff0', 'puff1'], color: F.mist, alpha: 0.28, drag: 2.5 });
      }
      // where the stream lands: soak the sand
      j.markT -= dt;
      if (F.mark >= 0 && j.markT <= 0 && beat > 0.45) {
        j.markT = 0.09;
        const sp = j.speed * 0.9;
        const vy = _d.y * sp + 0.9;
        const g = F.gravity;
        const hgt = Math.max(0.05, _v.y - ctx.world.groundAt(_v.x, _v.z));
        const tl = (vy + Math.sqrt(vy * vy + 2 * g * hgt)) / g;
        ctx.events.emit('groundMark', _v.x + _d.x * sp * tl, _v.z + _d.z * sp * tl, 0.15 + Math.random() * 0.2 * Math.min(2, j.power), F.mark);
      }
    }
    // pools
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t += dt;
      p.next -= dt;
      if (p.next <= 0) {
        p.next = 0.14;
        const k = 1 - Math.pow(1 - Math.min(1, p.t / 3), 2);
        ctx.events.emit('groundMark', p.x, p.z, p.r * (0.3 + 0.7 * k), FLUIDS[p.fluid].mark);
      }
      if (p.t > 3.1) this.pools.splice(i, 1);
    }
  }

  clear() {
    this.caps.length = 0;
    this.jets.length = 0;
    this.pools.length = 0;
    for (const im of this.meshes) im.count = 0;
  }

  dispose() {
    this.clear();
    for (const im of this.meshes) im.geometry.dispose();
    this.group.removeFromParent();
  }
}
