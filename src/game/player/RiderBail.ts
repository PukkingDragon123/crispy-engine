// Wipeouts: Sundown thrown off the board and the short (~2 s) board retrieval.
//
// - tumble: a connected verlet ragdoll (pelvis, neck, skull, shoulders, elbows,
//   hands, hips, knees, feet and the scorpion tail) seeded from his current pose
//   with the ride's momentum plus a head-over-heels spin. Bones are distance
//   constraints, the trunk is braced into a box, knees / elbows / the spine can't
//   fold flat; the sand stops, bounces and drags every joint. The particles drive
//   the rig: trunk frames from the hip / shoulder lines, every limb and tail bone
//   aimed down its segment (parallel transport, so nothing twists or pops)
// - meanwhile the board skids, barrel-rolls and settles deck up a few metres off
// - recovery: he pushes up onto a knee, stands, dusts the sand off his ribs,
//   jogs (or sprints) to the board, stomps the tail so it flips up, hops on
// - any input (jump / push / fire) after the first beat skips ahead: the board
//   slides to his feet and he hops on. He is invulnerable through it all.
// Emits 'wipeout' (reason) at the start and 'boardRecovered' on the mount.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { RigInstance } from '../../engine/voxel/Rig';
import type { Board } from './Board';
import type { CameraRig } from './CameraRig';
import { clamp, damp, wrapAngle } from '../../engine/math/rand';

export interface BailHost {
  board: Board;
  rig: RigInstance;
  root: THREE.Group;
  tilt: THREE.Group;
  stance: THREE.Group;
  boardMesh: THREE.Mesh;
  cam: CameraRig;
  alive: boolean;
  invuln: number;
  express(name: string, dur?: number): void;
}

export const BAIL = {
  /** tumble ends once settled after tumbleMin, or at tumbleMax (s) */
  tumbleMin: 0.62,
  tumbleMax: 1.15,
  kneel: 0.2,
  stand: 0.34,
  jogSpeed: 4.8,
  /** the jog never takes longer than this (he sprints if the board is far) */
  jogMax: 0.6,
  stomp: 0.42,
  /** blend from the mount pose into the riding animation (s) */
  blendOut: 0.3,
  /** input skips ahead after this long (s) */
  skipAfter: 0.22,
  invulnAfter: 0.9,
  /** no second hit throw-off this soon after a recovery (s) */
  throwCd: 5,
};

const UP = new THREE.Vector3(0, 1, 0);
const G = 22;
const H = 1 / 120;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** the joints the recovery poses drive (rig-local Euler targets; absent = rest) */
const POSE_NODES = ['pelvis', 'torso', 'head', 'arm_l', 'fore_l', 'arm_r', 'fore_r', 'thigh_l', 'shin_l', 'thigh_r', 'shin_r', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'stinger'];
type Pose = Record<string, [number, number, number]>;

type Phase = 'off' | 'tumble' | 'kneel' | 'stand' | 'jog' | 'stomp';

interface Con {
  i: number;
  j: number;
  rest: number;
  k: number;
  /** only push apart (a fold limit), never pull */
  min?: boolean;
}

export class RiderBail {
  active = false;
  phase: Phase = 'off';
  reason = '';
  private t = 0;
  private total = 0;
  private sinceRecover = 99;
  // ---- ragdoll particles
  private n = 0;
  private p = new Float32Array(26 * 3);
  private o = new Float32Array(26 * 3);
  private r = new Float32Array(26);
  private w = new Float32Array(26);
  private gy = new Float32Array(26);
  private cons: Con[] = [];
  private idx: Record<string, number> = {};
  private aims: { node: THREE.Object3D; parent: string; from: number; to: number; q: THREE.Quaternion; prev: THREE.Vector3 }[] = [];
  private corr = { pelvis: new THREE.Quaternion(), torso: new THREE.Quaternion(), head: new THREE.Quaternion() };
  private wq: Record<string, THREE.Quaternion> = {};
  private acc = 0;
  private bodyVel = new THREE.Vector3();
  private lastP = new THREE.Vector3();
  private thudCd = 0;
  // ---- the loose board
  private bp = new THREE.Vector3();
  private bv = new THREE.Vector3();
  private byaw = 0;
  private bspin = 0;
  private broll = 0;
  private brollV = 0;
  private bpitch = 0;
  private skidFx = 0;
  // ---- recovery
  private from: Record<string, THREE.Quaternion> = {};
  private fromPel = new THREE.Vector3();
  private pelRest = new THREE.Vector3();
  private stand = new THREE.Vector3();
  private face = 0;
  private jogPh = 0;
  private jogV = 0;
  private stompFrom = new THREE.Vector3();
  private stompYaw = 0;
  private quick = false;
  private patFx = 0;
  private stomped = false;
  // ---- blend into the riding animation after the mount
  private outT = 9;
  private outQ: Record<string, THREE.Quaternion> = {};
  private outPel = new THREE.Vector3();
  /** called on the mount (Player resets its animation memory) */
  onRecovered?: () => void;

  constructor(private ctx: Ctx, private h: BailHost) {
    const pel = h.rig.geo.parts.find((q) => q.name === 'pelvis');
    if (pel) this.pelRest.copy(pel.offset);
    for (const nm of POSE_NODES) {
      this.from[nm] = new THREE.Quaternion();
      this.outQ[nm] = new THREE.Quaternion();
      this.wq[nm] = new THREE.Quaternion();
    }
  }

  /** can a hit throw him off right now */
  canThrow() {
    return !this.active && this.sinceRecover > BAIL.throwCd;
  }

  /**
   * Throw him off the board. dir: horizontal unit the blow pushes him (null: the ride's
   * own momentum); power scales the throw.
   */
  start(reason: string, dir: THREE.Vector3 | null = null, power = 1) {
    const h = this.h, b = h.board, ctx = this.ctx;
    if (this.active || !h.rig.nodes['pelvis'] || !h.rig.nodes['torso']) return false;
    this.active = true;
    this.reason = reason;
    this.phase = 'tumble';
    this.t = this.total = 0;
    this.quick = false;
    this.stomped = false;
    this.outT = 9;
    b.offBoard = true;
    b.longCharging = false;
    b.drifting = false;
    b.grapple.active = false;
    const spd = b.speed;
    const f = b.forward;
    // the body flies on with the ride (and the blow), up and over the nose
    const v = _a.set(b.vel.x * 0.82, Math.max(0, b.vel.y) * 0.5 + 3.2 + power * 1.4, b.vel.z * 0.82);
    if (dir) v.addScaledVector(dir, 4.5 + power * 2.5);
    if (reason === 'balance') {
      // over the side he was tipping to
      const s = Math.sign(b.bal) || 1;
      v.x += Math.cos(b.heading) * s * 2.2;
      v.z += -Math.sin(b.heading) * s * 2.2;
    }
    const hv = Math.hypot(v.x, v.z);
    const tx = hv > 0.5 ? v.x / hv : f.x, tz = hv > 0.5 ? v.z / hv : f.z;
    // head over heels along the throw, a little twist and roll so no two falls match
    const spin = _b.set(tz, 0, -tx).multiplyScalar(-(4 + Math.min(10, hv) * 0.55));
    spin.x += (Math.random() - 0.5) * 3;
    spin.y += (Math.random() - 0.5) * 4;
    spin.z += (Math.random() - 0.5) * 3;
    this.seed(v, spin);
    // the board skids on, barrel-rolling, and settles deck up a few metres away
    this.bp.copy(b.pos);
    this.bv.set(f.x * Math.min(8, spd * 0.5), 2.2 + Math.min(2, spd * 0.1), f.z * Math.min(8, spd * 0.5));
    this.byaw = b.heading;
    this.bspin = (Math.random() - 0.5) * 7;
    this.broll = 0;
    this.brollV = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5);
    this.bpitch = 0;
    ctx.scene.add(h.boardMesh);
    this.placeBoard();
    b.vel.set(0, 0, 0);
    b.grounded = true;
    h.invuln = Math.max(h.invuln, 1);
    h.express('hurt', 1.4);
    ctx.sfx('hit_bone', b.pos, 0.8, 0.9);
    ctx.sfx('skeleton_rattle', b.pos, 0.8);
    ctx.sfx('board_land', b.pos, 0.7, 0.8);
    ctx.fx.sandBurst(b.pos, 1.1);
    h.cam.addTrauma(0.32);
    h.cam.punch(-0.03, 0, -2.5, (Math.random() - 0.5) * 0.06);
    ctx.events.emit('wipeout', reason, spd);
    return true;
  }

  /** end it at once (revive, teleport): back on the board where he lies */
  abort() {
    if (!this.active) return;
    this.mount(true);
  }

  // =================================================================== update
  update(dt: number, skip: boolean) {
    this.sinceRecover += dt;
    if (!this.active || !(dt > 0)) return;
    const h = this.h, b = h.board;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.total += dt;
    h.invuln = Math.max(h.invuln, 0.5);
    this.boardStep(dt);
    if (skip && h.alive && this.total > BAIL.skipAfter && this.phase !== 'stomp') this.skipAhead();
    switch (this.phase) {
      case 'tumble': {
        this.simulate(dt);
        this.applyRagdoll();
        const P = this.pv(this.idx.pelvis, _c);
        b.pos.set(P.x, this.ctx.world.groundAt(P.x, P.z), P.z);
        const settled = this.t > BAIL.tumbleMin && this.maxSpeed() < 1.3;
        if (h.alive && (settled || this.t > BAIL.tumbleMax)) this.getUp();
        break;
      }
      case 'kneel':
      case 'stand': {
        const dur = this.phase === 'kneel' ? BAIL.kneel : BAIL.stand;
        const k = clamp(this.t / dur, 0, 1);
        this.blend(this.phase === 'kneel' ? KNEEL : this.dustPose(k), smooth(this.phase === 'kneel' ? k : k / 0.45), this.phase === 'kneel' ? 0.34 : 0.03);
        this.setRoot(this.stand.x, this.ctx.world.groundAt(this.stand.x, this.stand.z) - 0.1, this.stand.z, this.face);
        if (k >= 1) {
          if (this.phase === 'kneel') this.enter('stand');
          else this.startJog();
        }
        break;
      }
      case 'jog':
        this.jog(dt);
        break;
      case 'stomp':
        this.stomp(dt);
        break;
    }
    if (this.phase !== 'tumble') b.pos.set(this.stand.x, this.ctx.world.groundAt(this.stand.x, this.stand.z), this.stand.z);
    b.vel.set(0, 0, 0);
  }

  /** after the riding animation ran: ease from the mount pose into it */
  blendOut(dt: number) {
    if (this.outT >= BAIL.blendOut) return;
    this.outT += dt;
    const k = smooth(this.outT / BAIL.blendOut);
    const n = this.h.rig.nodes;
    for (const nm of POSE_NODES) {
      const o = n[nm];
      if (o) o.quaternion.slerpQuaternions(this.outQ[nm], o.quaternion, k);
    }
    const pel = n['pelvis'];
    if (pel) pel.position.lerpVectors(this.outPel, pel.position, k);
  }

  // ================================================================== ragdoll
  private add(name: string, at: THREE.Vector3, rad: number, inv: number) {
    const i = this.n++;
    this.p[i * 3] = this.o[i * 3] = at.x;
    this.p[i * 3 + 1] = this.o[i * 3 + 1] = at.y;
    this.p[i * 3 + 2] = this.o[i * 3 + 2] = at.z;
    this.r[i] = rad;
    this.w[i] = inv;
    this.idx[name] = i;
    return i;
  }
  private pv(i: number, out: THREE.Vector3) {
    return out.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
  }
  private dist(i: number, j: number) {
    return Math.hypot(this.p[i * 3] - this.p[j * 3], this.p[i * 3 + 1] - this.p[j * 3 + 1], this.p[i * 3 + 2] - this.p[j * 3 + 2]);
  }
  private con(a: string, b: string, k = 1, minK = 0) {
    const i = this.idx[a], j = this.idx[b];
    if (i === undefined || j === undefined) return;
    const rest = this.dist(i, j);
    if (minK > 0) this.cons.push({ i, j, rest: rest * minK, k, min: true });
    else this.cons.push({ i, j, rest, k });
  }

  /** particles at the joints of his current pose, moving with v and spinning at spin (rad/s) */
  private seed(v: THREE.Vector3, spin: THREE.Vector3) {
    const h = this.h, rig = h.rig, nd = rig.nodes, so = rig.sockets;
    rig.root.scale.set(1, 1, 1);
    h.root.updateMatrixWorld(true);
    this.n = 0;
    this.cons.length = 0;
    this.aims.length = 0;
    this.idx = {};
    const meta = rig.geo.spec.meta as { kneeY?: number } | undefined;
    const shinL = meta?.kneeY ?? 0.4;
    const at = (o: THREE.Object3D | undefined, x = 0, y = 0, z = 0) => (o ? o.localToWorld(_d.set(x, y, z)) : null);
    const put = (name: string, o: THREE.Object3D | undefined, rad: number, inv: number, x = 0, y = 0, z = 0) => {
      const q = at(o, x, y, z);
      if (q) this.add(name, q, rad, inv);
    };
    put('pelvis', nd['pelvis'], 0.12, 0.5);
    put('neck', nd['head'], 0.11, 0.6);
    put('skull', nd['head'], 0.17, 0.8, 0, 0.34, 0.03);
    put('sh_l', nd['arm_l'], 0.08, 1);
    put('sh_r', nd['arm_r'], 0.08, 1);
    put('el_l', nd['fore_l'], 0.06, 1);
    put('el_r', nd['fore_r'], 0.06, 1);
    put('ha_l', so['hand_l'] ?? nd['fore_l'], 0.06, 1);
    put('ha_r', so['hand_r'] ?? nd['fore_r'], 0.07, 1);
    put('hip_l', nd['thigh_l'], 0.08, 0.8);
    put('hip_r', nd['thigh_r'], 0.08, 0.8);
    put('kn_l', nd['shin_l'], 0.07, 1);
    put('kn_r', nd['shin_r'], 0.07, 1);
    put('ft_l', nd['shin_l'], 0.07, 1, 0, -shinL, 0.02);
    put('ft_r', nd['shin_r'], 0.07, 1, 0, -shinL, 0.02);
    const tail = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'stinger'].filter((t) => nd[t]);
    for (const t of tail) put(t, nd[t], 0.05, 1.3);
    if (tail.length) put('tip', so['tail_tip'] ?? nd[tail[tail.length - 1]], 0.05, 1.3);
    // bones
    this.con('pelvis', 'neck');
    this.con('neck', 'skull');
    for (const s of ['l', 'r']) {
      this.con('pelvis', 'hip_' + s);
      this.con('neck', 'sh_' + s);
      this.con('sh_' + s, 'el_' + s);
      this.con('el_' + s, 'ha_' + s);
      this.con('hip_' + s, 'kn_' + s);
      this.con('kn_' + s, 'ft_' + s);
      // the trunk is a box
      this.con('sh_' + s, 'hip_' + s, 1);
      this.con('skull', 'sh_' + s, 0.8);
      this.con('pelvis', 'sh_' + s, 0.8);
      this.con('neck', 'hip_' + s, 0.8);
      // knees, elbows and the neck can't fold flat
      this.con('hip_' + s, 'ft_' + s, 1, 0.62);
      this.con('sh_' + s, 'ha_' + s, 1, 0.5);
      this.con('skull', 'ha_' + s, 1, 0.3);
    }
    this.con('hip_l', 'hip_r');
    this.con('sh_l', 'sh_r');
    this.con('sh_l', 'hip_r', 0.9);
    this.con('sh_r', 'hip_l', 0.9);
    this.con('skull', 'pelvis', 1, 0.95);
    if (tail.length) {
      const chain = ['pelvis', ...tail, 'tip'];
      for (let k = 1; k < chain.length; k++) this.con(chain[k - 1], chain[k]);
      // springy braces keep the curl
      for (let k = 2; k < chain.length; k++) this.con(chain[k - 2], chain[k], 0.25);
      this.con('neck', tail[0], 0.6);
    }
    // the trunk frames and every aimed bone, measured on this pose
    const up = this.trunkUp(_a);
    this.frame(this.pv(this.idx.hip_l, _b).sub(this.pv(this.idx.hip_r, _c)), up, _q);
    this.corr.pelvis.copy(_q).invert().multiply(nd['pelvis'].getWorldQuaternion(_q2));
    this.frame(this.pv(this.idx.sh_l, _b).sub(this.pv(this.idx.sh_r, _c)), up, _q);
    this.corr.torso.copy(_q).invert().multiply(nd['torso'].getWorldQuaternion(_q2));
    if (nd['head'] && this.idx.skull !== undefined) {
      this.frame(this.pv(this.idx.sh_l, _b).sub(this.pv(this.idx.sh_r, _c)), this.pv(this.idx.skull, _d).sub(this.pv(this.idx.neck, _a)).normalize(), _q);
      this.corr.head.copy(_q).invert().multiply(nd['head'].getWorldQuaternion(_q2));
    }
    const aim = (node: string, parent: string, a: string, b: string) => {
      const o = nd[node], i = this.idx[a], j = this.idx[b];
      if (!o || i === undefined || j === undefined) return;
      const prev = this.pv(j, new THREE.Vector3()).sub(this.pv(i, _a));
      if (prev.lengthSq() < 1e-8) return;
      this.aims.push({ node: o, parent, from: i, to: j, q: o.getWorldQuaternion(new THREE.Quaternion()), prev: prev.normalize() });
    };
    for (const s of ['l', 'r']) {
      aim('arm_' + s, 'torso', 'sh_' + s, 'el_' + s);
      aim('fore_' + s, 'arm_' + s, 'el_' + s, 'ha_' + s);
      aim('thigh_' + s, 'pelvis', 'hip_' + s, 'kn_' + s);
      aim('shin_' + s, 'thigh_' + s, 'kn_' + s, 'ft_' + s);
    }
    const chain = [...tail, 'tip'];
    for (let k = 0; k < tail.length; k++) aim(tail[k], k ? tail[k - 1] : 'pelvis', tail[k], chain[k + 1]);
    // velocities: the throw plus the spin about the centre of mass
    const com = _c.set(0, 0, 0);
    for (let i = 0; i < this.n; i++) com.add(this.pv(i, _d));
    com.divideScalar(Math.max(1, this.n));
    for (let i = 0; i < this.n; i++) {
      const rp = this.pv(i, _d).sub(com);
      const vx = v.x + spin.y * rp.z - spin.z * rp.y, vy = v.y + spin.z * rp.x - spin.x * rp.z, vz = v.z + spin.x * rp.y - spin.y * rp.x;
      this.o[i * 3] = this.p[i * 3] - vx * H;
      this.o[i * 3 + 1] = this.p[i * 3 + 1] - vy * H;
      this.o[i * 3 + 2] = this.p[i * 3 + 2] - vz * H;
    }
    this.acc = 0;
    this.thudCd = 0;
    this.pv(this.idx.pelvis, this.lastP);
  }

  private trunkUp(out: THREE.Vector3) {
    const I = this.idx;
    this.pv(I.sh_l, out).add(this.pv(I.sh_r, _d)).multiplyScalar(0.5);
    this.pv(I.hip_l, _s).add(this.pv(I.hip_r, _d)).multiplyScalar(0.5);
    return out.sub(_s).normalize();
  }

  /** rig frame from a left axis and an up axis: +X left, +Y up, +Z forward */
  private frame(left: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion) {
    const y = up;
    const x = left.addScaledVector(y, -left.dot(y));
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    const z = _s.crossVectors(x, y).normalize();
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
  }

  private simulate(dt: number) {
    this.acc += dt;
    const world = this.ctx.world, n = this.n, p = this.p, o = this.o;
    let steps = 0;
    while (this.acc >= H && steps < 8) {
      this.acc -= H;
      steps++;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        const vx = (p[k] - o[k]) * 0.998, vy = (p[k + 1] - o[k + 1]) * 0.998, vz = (p[k + 2] - o[k + 2]) * 0.998;
        o[k] = p[k];
        o[k + 1] = p[k + 1];
        o[k + 2] = p[k + 2];
        p[k] += vx;
        p[k + 1] += vy - G * H * H;
        p[k + 2] += vz;
        this.gy[i] = world.groundAt(p[k], p[k + 2]) + this.r[i];
      }
      for (let it = 0; it < 6; it++) {
        for (const c of this.cons) {
          const a = c.i * 3, b = c.j * 3;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const d = Math.hypot(dx, dy, dz);
          if (d < 1e-6 || (c.min && d >= c.rest)) continue;
          const wa = this.w[c.i], wb = this.w[c.j], ws = wa + wb;
          if (ws <= 0) continue;
          const s = ((d - c.rest) / d) * c.k;
          p[a] += dx * s * (wa / ws);
          p[a + 1] += dy * s * (wa / ws);
          p[a + 2] += dz * s * (wa / ws);
          p[b] -= dx * s * (wb / ws);
          p[b + 1] -= dy * s * (wb / ws);
          p[b + 2] -= dz * s * (wb / ws);
        }
        // the sand: no sinking, a little bounce, and grit dragging the sliding joints
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          if (p[k + 1] >= this.gy[i]) continue;
          const vy = p[k + 1] - o[k + 1];
          p[k + 1] = this.gy[i];
          if (it === 0) {
            o[k + 1] = p[k + 1] + Math.min(0, vy) * 0.22;
            o[k] = p[k] - (p[k] - o[k]) * 0.8;
            o[k + 2] = p[k + 2] - (p[k + 2] - o[k + 2]) * 0.8;
            const imp = -vy / H;
            if (imp > 4 && this.thudCd <= 0 && (i === this.idx.pelvis || i === this.idx.skull || i === this.idx.neck)) {
              this.thudCd = 0.18;
              const at = { x: p[k], y: this.gy[i] - this.r[i], z: p[k + 2] };
              this.ctx.fx.sandBurst(at, clamp(imp / 9, 0.35, 1));
              this.ctx.sfx('hit_bone', at, clamp(imp / 14, 0.25, 0.7), 0.85 + Math.random() * 0.2);
            }
          }
        }
      }
    }
    if (this.acc > H) this.acc = 0;
    this.thudCd -= dt;
    // the body's velocity (camera lag, anyone who asks)
    const P = this.pv(this.idx.pelvis, _a);
    this.bodyVel.copy(P).sub(this.lastP).divideScalar(Math.max(1e-4, dt));
    this.lastP.copy(P);
  }

  private maxSpeed() {
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      m = Math.max(m, Math.hypot(this.p[k] - this.o[k], this.p[k + 1] - this.o[k + 1], this.p[k + 2] - this.o[k + 2]) / H);
    }
    return m;
  }

  /** drive the rig from the particles */
  private applyRagdoll() {
    const rig = this.h.rig, nd = rig.nodes, I = this.idx;
    rig.root.updateWorldMatrix(true, false);
    const baseQ = rig.root.getWorldQuaternion(_q3);
    const up = this.trunkUp(_a);
    const wq = this.wq;
    this.frame(this.pv(I.hip_l, _b).sub(this.pv(I.hip_r, _c)), up.clone(), wq.pelvis).multiply(this.corr.pelvis);
    this.frame(this.pv(I.sh_l, _b).sub(this.pv(I.sh_r, _c)), up.clone(), wq.torso).multiply(this.corr.torso);
    if (I.skull !== undefined) this.frame(this.pv(I.sh_l, _b).sub(this.pv(I.sh_r, _c)), this.pv(I.skull, _d).sub(this.pv(I.neck, _a)).normalize(), wq.head).multiply(this.corr.head);
    for (const a of this.aims) {
      const cur = this.pv(a.to, _b).sub(this.pv(a.from, _c));
      if (cur.lengthSq() < 1e-8) continue;
      cur.normalize();
      a.q.premultiply(_q.setFromUnitVectors(a.prev, cur));
      a.prev.copy(cur);
      wq[a.node.name]?.copy(a.q);
    }
    const local = (name: string, parentQ: THREE.Quaternion) => {
      const o = nd[name];
      if (o && wq[name]) o.quaternion.copy(parentQ).invert().multiply(wq[name]);
    };
    local('pelvis', baseQ);
    const P = this.pv(I.pelvis, _b);
    nd['pelvis'].position.copy(rig.root.worldToLocal(P));
    local('torso', wq.pelvis);
    if (I.skull !== undefined) local('head', wq.torso);
    for (const a of this.aims) local(a.node.name, wq[a.parent] ?? baseQ);
  }

  // ================================================================ the board
  private boardStep(dt: number) {
    if (this.phase === 'stomp') return;
    const world = this.ctx.world;
    this.bv.y -= G * dt;
    this.bp.addScaledVector(this.bv, dt);
    const g = world.groundAt(this.bp.x, this.bp.z);
    const sp = Math.hypot(this.bv.x, this.bv.z);
    if (this.bp.y <= g) {
      this.bp.y = g;
      if (this.bv.y < -3) {
        this.bv.y *= -0.3;
        this.ctx.sfx('board_land', this.bp, clamp(-this.bv.y / 6, 0.2, 0.5), 1.15);
        this.ctx.fx.sandBurst(this.bp, 0.4);
      } else this.bv.y = 0;
      // grit: the board scrubs to a stop, its spin and roll die
      const ns = Math.max(0, sp - 7.5 * dt);
      if (sp > 1e-4) {
        this.bv.x *= ns / sp;
        this.bv.z *= ns / sp;
      }
      this.bspin *= Math.exp(-5 * dt);
      const target = Math.round(this.broll / (Math.PI * 2)) * Math.PI * 2;
      this.brollV += (-(this.broll - target) * 70 - this.brollV * 9) * dt;
      this.skidFx -= dt;
      if (sp > 1.5 && this.skidFx <= 0) {
        this.skidFx = 0.05;
        this.ctx.fx.sandSpray({ x: this.bp.x, y: g + 0.05, z: this.bp.z }, { x: -this.bv.x * 0.3, y: 1, z: -this.bv.z * 0.3 }, 0.6);
      }
    }
    this.broll += this.brollV * dt;
    this.byaw += this.bspin * dt;
    // a board left far behind is kicked along toward him (the retrieval stays short)
    if (this.phase !== 'tumble' && this.phase !== 'jog') {
      const dx = this.stand.x - this.bp.x, dz = this.stand.z - this.bp.z;
      const d = Math.hypot(dx, dz);
      if (d > 5.5) this.bp.x += (dx / d) * (d - 5.5) * Math.min(1, dt * 3), this.bp.z += (dz / d) * (d - 5.5) * Math.min(1, dt * 3);
    }
    this.placeBoard();
  }

  private placeBoard() {
    const m = this.h.boardMesh;
    m.position.set(this.bp.x, this.bp.y + 0.06, this.bp.z);
    _e.set(this.bpitch, 0, this.broll, 'XYZ');
    m.quaternion.setFromAxisAngle(UP, this.byaw).multiply(_q2.setFromEuler(_e));
  }

  // ================================================================ recovery
  private setRoot(x: number, y: number, z: number, faceYaw: number) {
    const r = this.h.root;
    r.position.set(x, y, z);
    // the rig faces root -X (the stance turn): a root yaw of face + 90 degrees faces him along face
    r.quaternion.setFromAxisAngle(UP, faceYaw + Math.PI / 2);
    this.h.tilt.rotation.set(0, 0, 0);
    this.h.tilt.position.set(0, 0, 0);
  }

  /** move the root under him (standing where the ragdoll lies, facing the board) without moving the body */
  private rebase(x: number, z: number, faceYaw: number) {
    const nd = this.h.rig.nodes, pel = nd['pelvis'];
    this.h.root.updateMatrixWorld(true);
    _m2.copy(pel.matrixWorld);
    this.setRoot(x, this.ctx.world.groundAt(x, z) - 0.1, z, faceYaw);
    this.h.root.updateMatrixWorld(true);
    _m.copy(this.h.rig.root.matrixWorld).invert().multiply(_m2);
    _m.decompose(pel.position, pel.quaternion, _s);
  }

  private faceBoard(x: number, z: number) {
    return Math.atan2(this.bp.x - x, this.bp.z - z);
  }

  private getUp() {
    const P = this.pv(this.idx.pelvis, _a);
    this.stand.set(P.x, 0, P.z);
    this.face = this.faceBoard(P.x, P.z);
    this.rebase(P.x, P.z, this.face);
    this.enter('kneel');
    this.ctx.sfx('skeleton_rattle', this.h.board.pos, 0.5, 1.1);
    this.h.express('determined', 1.5);
  }

  private enter(ph: Phase) {
    this.phase = ph;
    this.t = 0;
    const nd = this.h.rig.nodes;
    for (const nm of POSE_NODES) if (nd[nm]) this.from[nm].copy(nd[nm].quaternion);
    if (nd['pelvis']) this.fromPel.copy(nd['pelvis'].position);
  }

  /** slerp every pose joint from the captured pose toward target at k; drop lowers the hips (m) */
  private blend(target: Pose, k: number, drop: number, lift = 0, fwd = 0) {
    const nd = this.h.rig.nodes;
    for (const nm of POSE_NODES) {
      const o = nd[nm];
      if (!o) continue;
      const e = target[nm];
      _q.setFromEuler(_e.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0));
      o.quaternion.slerpQuaternions(this.from[nm], _q, k);
    }
    const pel = nd['pelvis'];
    if (pel) pel.position.lerpVectors(this.fromPel, _a.set(this.pelRest.x, this.pelRest.y - drop + lift, this.pelRest.z + fwd), k);
  }

  /** standing, the free hand patting the sand off his ribs and coat, head down to look */
  private dustPose(k: number): Pose {
    const u = clamp((k - 0.3) / 0.7, 0, 1);
    const pat = Math.sin(u * Math.PI * 4);
    const on = Math.sin(u * Math.PI);
    if (u > 0 && Math.abs(pat) > 0.95 && this.patFx <= 0) {
      this.patFx = 0.12;
      const c = this.h.rig.nodes['torso']?.localToWorld(_c.set(0, 0.25, 0.15));
      if (c) {
        this.ctx.particles.emit({ pos: { x: c.x, y: c.y, z: c.z }, count: 4, spread: 0.6, up: 0.4, life: [0.5, 1.0], size: [0.18, 0.5], sprite: ['puff0', 'puff1', 'puff2'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.55, drag: 2.6, rot: 4 });
        this.ctx.sfx('footstep_sand', c, 0.25, 1.4);
      }
    }
    this.patFx -= 1 / 60;
    return {
      pelvis: [0.04, 0, 0],
      torso: [0.12 + on * 0.18, on * 0.18, 0],
      head: [on * 0.42, -on * 0.15, 0],
      arm_l: [-0.35 - on * 0.35, 0, 0.12 - on * 0.5],
      fore_l: [-0.4 - on * (1.2 + pat * 0.3), 0, 0],
      arm_r: [0.05, 0, -0.16],
      fore_r: [-0.45, 0, 0],
      thigh_l: [-0.06, 0, 0.05],
      shin_l: [0.12, 0, 0],
      thigh_r: [-0.04, 0, -0.05],
      shin_r: [0.1, 0, 0],
    };
  }

  private mountPoint(out: THREE.Vector3) {
    // stand a step short of the board, on the side he comes from
    const dx = this.stand.x - this.bp.x, dz = this.stand.z - this.bp.z;
    const d = Math.hypot(dx, dz) || 1;
    return out.set(this.bp.x + (dx / d) * 0.75, 0, this.bp.z + (dz / d) * 0.75);
  }

  private startJog() {
    this.enter('jog');
    this.jogPh = 0;
    const mp = this.mountPoint(_a);
    const d = Math.hypot(mp.x - this.stand.x, mp.z - this.stand.z);
    this.jogV = Math.max(BAIL.jogSpeed, d / BAIL.jogMax);
    if (d < 0.25) this.startStomp();
  }

  private jog(dt: number) {
    const mp = this.mountPoint(_b);
    let dx = mp.x - this.stand.x, dz = mp.z - this.stand.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, this.jogV * dt);
    if (d > 1e-4) {
      dx /= d;
      dz /= d;
      this.stand.x += dx * step;
      this.stand.z += dz * step;
      this.face = this.face + wrapAngle(Math.atan2(dx, dz) - this.face) * Math.min(1, dt * 12);
    }
    const sprint = clamp((this.jogV - BAIL.jogSpeed) / 4, 0, 1);
    this.jogPh += dt * Math.PI * 2 * (2.5 + sprint * 0.9);
    const s = Math.sin(this.jogPh), c = Math.cos(this.jogPh);
    const A = 0.7 + sprint * 0.25;
    const pose: Pose = {
      pelvis: [0.12, 0.16 * s, 0],
      torso: [0.2 + sprint * 0.12, -0.24 * s, 0],
      head: [-0.12, 0.08 * s, 0],
      thigh_l: [-A * s - 0.18, 0, 0.04],
      shin_l: [0.25 + 1.15 * Math.max(0, c), 0, 0],
      thigh_r: [A * s - 0.18, 0, -0.04],
      shin_r: [0.25 + 1.15 * Math.max(0, -c), 0, 0],
      arm_l: [0.75 * s, 0, 0.14],
      fore_l: [-1.3, 0, 0],
      arm_r: [-0.45 * s - 0.15, 0, -0.14],
      fore_r: [-1.15, 0, 0],
    };
    const bob = 0.05 - 0.045 * Math.abs(c);
    this.blend(pose, smooth(this.t / 0.14), bob);
    const g = this.ctx.world.groundAt(this.stand.x, this.stand.z);
    this.setRoot(this.stand.x, g - 0.1 + Math.abs(s) * 0.03, this.stand.z, this.face);
    // footfalls kick little puffs
    if (Math.abs(c) > 0.97 && this.patFx <= 0) {
      this.patFx = 0.12;
      this.ctx.fx.sandSpray({ x: this.stand.x, y: g + 0.04, z: this.stand.z }, { x: -dx * 1.5, y: 0.6, z: -dz * 1.5 }, 0.35);
      this.ctx.sfx('footstep_sand', this.h.board.pos, 0.3, 1.1 + Math.random() * 0.1);
    }
    this.patFx -= dt;
    if (d < 0.08 || this.t > BAIL.jogMax + 0.25) this.startStomp();
  }

  private startStomp() {
    this.enter('stomp');
    this.stompFrom.set(this.stand.x, this.ctx.world.groundAt(this.stand.x, this.stand.z) - 0.1, this.stand.z);
    this.stompYaw = this.face + Math.PI / 2;
    this.stomped = false;
    this.bv.set(0, 0, 0);
    this.bspin = this.brollV = 0;
    // deck up for the stomp
    this.broll = Math.round(this.broll / (Math.PI * 2)) * Math.PI * 2;
  }

  /** skip: the board slides to his feet and he hops straight on */
  private skipAhead() {
    if (this.phase === 'tumble') {
      const P = this.pv(this.idx.pelvis, _a);
      this.stand.set(P.x, 0, P.z);
      this.face = this.faceBoard(P.x, P.z);
      this.rebase(P.x, P.z, this.face);
    }
    this.quick = true;
    this.startStomp();
  }

  private stomp(dt: number) {
    const k = clamp(this.t / (this.quick ? BAIL.stomp * 0.8 : BAIL.stomp), 0, 1);
    const world = this.ctx.world;
    if (this.quick) {
      // the board skates in under him
      const kk = 1 - Math.exp(-dt * 16);
      this.bp.x += (this.stand.x - this.bp.x) * kk;
      this.bp.z += (this.stand.z - this.bp.z) * kk;
    }
    const gB = world.groundAt(this.bp.x, this.bp.z);
    // the tail stomp flips the board up nose first, it comes round level under his feet
    const u = clamp((k - 0.34) / 0.5, 0, 1);
    if (k >= 0.34 && !this.stomped) {
      this.stomped = true;
      this.ctx.sfx('board_jump', this.bp, 0.7, 1.15);
      this.ctx.fx.sandBurst(this.bp, 0.5);
    }
    this.bp.y = gB + Math.sin(Math.PI * u) * 0.5;
    this.bpitch = -Math.sin(Math.PI * u) * 1.15 * (1 - u * 0.4);
    const toYaw = this.h.board.heading;
    void toYaw;
    this.placeBoard();
    // rider: foot up onto the tail, stomp, hop, land on the deck
    const lift = k < 0.3 ? smooth(k / 0.3) : k < 0.4 ? 1 - smooth((k - 0.3) / 0.1) : 0;
    const hop = k > 0.4 && k < 0.88 ? Math.sin((Math.PI * (k - 0.4)) / 0.48) : 0;
    const tuck = k > 0.36 ? smooth((k - 0.36) / 0.14) * (1 - smooth((k - 0.8) / 0.2)) : 0;
    const pose: Pose = {
      pelvis: [0.12 + tuck * 0.2, 0, 0],
      torso: [0.15 + tuck * 0.25, 0.1 * lift, 0],
      head: [-0.1, 0, 0],
      thigh_l: [-0.1 - tuck * 0.9, 0, 0.1],
      shin_l: [0.15 + tuck * 1.35, 0, 0],
      thigh_r: [-0.75 * lift - tuck * 0.85, 0, -0.1],
      shin_r: [0.9 * lift + tuck * 1.3, 0, 0],
      arm_l: [-0.2, 0, 0.25 + tuck * 0.65],
      fore_l: [-0.6, 0, 0],
      arm_r: [-0.15, 0, -0.2 - tuck * 0.5],
      fore_r: [-0.8, 0, 0],
    };
    this.blend(pose, smooth(this.t / 0.12), 0.04 + (k > 0.8 ? smooth((k - 0.8) / 0.2) * 0.12 : 0));
    // he travels onto the board through the hop and turns into his riding stance
    const m = smooth((k - 0.38) / 0.45);
    const x = this.stompFrom.x + (this.bp.x - this.stompFrom.x) * m;
    const z = this.stompFrom.z + (this.bp.z - this.stompFrom.z) * m;
    const y = this.stompFrom.y + (gB - this.stompFrom.y) * m + hop * 0.55;
    const r = this.h.root;
    r.position.set(x, y, z);
    const yaw = this.stompYaw + wrapAngle(this.byaw - this.stompYaw) * smooth((k - 0.35) / 0.5);
    r.quaternion.setFromAxisAngle(UP, yaw);
    this.stand.set(x, 0, z);
    if (k >= 1) this.mount(false);
  }

  private mount(abort: boolean) {
    const h = this.h, b = h.board, nd = h.rig.nodes;
    // capture the last pose for the blend into the riding animation
    for (const nm of POSE_NODES) if (nd[nm]) this.outQ[nm].copy(nd[nm].quaternion);
    if (nd['pelvis']) this.outPel.copy(nd['pelvis'].position);
    this.outT = abort ? BAIL.blendOut : 0;
    if (abort && this.phase === 'tumble') {
      const P = this.pv(this.idx.pelvis, _a);
      this.bp.set(P.x, 0, P.z);
    }
    const g = this.ctx.world.groundAt(this.bp.x, this.bp.z);
    h.tilt.add(h.boardMesh);
    h.boardMesh.position.set(0, 0.06, 0);
    h.boardMesh.quaternion.identity();
    b.offBoard = false;
    b.place(this.bp.x, g, this.bp.z, this.byaw);
    const f = b.forward;
    b.vel.set(f.x * 2.2, 0, f.z * 2.2);
    b.stumble = 0;
    this.active = false;
    this.phase = 'off';
    this.sinceRecover = 0;
    h.invuln = Math.max(h.invuln, BAIL.invulnAfter);
    if (!abort) {
      this.ctx.sfx('board_land', b.pos, 0.6, 1.05);
      this.ctx.fx.sandBurst(b.pos, 0.6);
      h.express('smug', 1);
    }
    this.onRecovered?.();
    this.ctx.events.emit('boardRecovered', this.reason, this.total);
  }

  /** how far into the bail (s), for anyone timing around it */
  get elapsed() {
    return this.total;
  }
  /** the ragdoll body's velocity while tumbling */
  get velocity() {
    return this.bodyVel;
  }
}

/** pushed up onto one knee, a hand on the sand, looking up */
const KNEEL: Pose = {
  pelvis: [0.35, 0, 0],
  torso: [0.5, 0, 0],
  head: [-0.45, 0, 0],
  thigh_l: [-1.45, 0, 0.12],
  shin_l: [1.45, 0, 0],
  thigh_r: [0.05, 0, -0.1],
  shin_r: [1.85, 0, 0],
  arm_l: [-0.85, 0, 0.35],
  fore_l: [-0.25, 0, 0],
  arm_r: [-0.35, 0, -0.3],
  fore_r: [-0.9, 0, 0],
  tail1: [0.25, 0, 0],
};

void damp;
