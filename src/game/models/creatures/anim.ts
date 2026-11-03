// Procedural animation for the meerkats, the giant jerboa and the player's
// dance moves. Everything is layered on the rigs' rest poses: damped pose
// targets per mode, springy secondary motion (ears, tails, squash & stretch)
// and beat-locked oscillators for playing and dancing. Pure functions of
// time + state, shared by the gameplay modules and the dev viewer.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';

const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const _v = new THREE.Vector3();

type Tri = [number, number, number];

/** captures each part's rest transform and writes rest + delta every frame */
class Joints {
  private base: Record<string, { pos: THREE.Vector3; rot: THREE.Euler }> = {};
  constructor(public rig: RigInstance) {
    for (const p of rig.geo.parts) this.base[p.name] = { pos: p.offset.clone(), rot: p.rest.clone() };
  }
  has(n: string) {
    return !!this.rig.nodes[n];
  }
  rot(n: string, x: number, y: number, z: number) {
    const node = this.rig.nodes[n];
    if (!node) return;
    const b = this.base[n].rot;
    node.rotation.set(b.x + x, b.y + y, b.z + z);
  }
  pos(n: string, x: number, y: number, z: number) {
    const node = this.rig.nodes[n];
    if (!node) return;
    const b = this.base[n].pos;
    node.position.set(b.x + x, b.y + y, b.z + z);
  }
  scale(n: string, x: number, y: number, z: number) {
    this.rig.nodes[n]?.scale.set(x, y, z);
  }
}

/** a damped pose: named joints -> current euler deltas chasing targets */
class PoseBlend {
  cur: Record<string, Tri> = {};
  tgt: Record<string, Tri> = {};
  constructor(names: string[]) {
    for (const n of names) {
      this.cur[n] = [0, 0, 0];
      this.tgt[n] = [0, 0, 0];
    }
  }
  clear() {
    for (const n in this.tgt) this.tgt[n] = [0, 0, 0];
  }
  set(n: string, x: number, y = 0, z = 0) {
    if (this.tgt[n]) this.tgt[n] = [x, y, z];
  }
  add(n: string, x: number, y = 0, z = 0) {
    const t = this.tgt[n];
    if (t) this.tgt[n] = [t[0] + x, t[1] + y, t[2] + z];
  }
  step(dt: number, l: number) {
    for (const n in this.cur) {
      const c = this.cur[n], t = this.tgt[n];
      c[0] = damp(c[0], t[0], l, dt);
      c[1] = damp(c[1], t[1], l, dt);
      c[2] = damp(c[2], t[2], l, dt);
    }
  }
}

/** critically-damped-ish spring for floppy secondary motion */
class Spring {
  x = 0;
  v = 0;
  constructor(public k = 120, public c = 10) {}
  step(target: number, dt: number) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

// =====================================================================================================
// MEERKAT
// =====================================================================================================
export type MeerkatMode = 'stand' | 'periscope' | 'hop' | 'dive' | 'alert' | 'groom' | 'play' | 'dance' | 'cheer' | 'sad' | 'crouch';
const MK_JOINTS = ['hips', 'chest', 'neck', 'head', 'jaw', 'ear_l', 'ear_r', 'arm_l', 'arm_r', 'paw_l', 'paw_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail1', 'tail2', 'tail3', 'instrument'];

export class MeerkatAnim {
  t: number;
  mode: MeerkatMode = 'stand';
  /** world point to look at (null = look around in quick sentinel saccades) */
  lookAt: THREE.Vector3 | null = null;
  /** chatter intensity 0..1 (decays on its own) */
  chatter = 0;
  /** music position in beats (play / dance) */
  beat = 0;
  /** 0..1 progress through a hop (pose only; the caller moves the root) */
  hopK = 0;
  /** extra vertical root offset the pose wants (crouch / dance bounce), metres */
  rootDrop = 0;
  private J: Joints;
  private P = new PoseBlend(MK_JOINTS);
  private sq = new Spring(260, 13);
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private tYaw = 0;
  private tPitch = 0;
  private tRoll = 0;
  private nextSac = 0;
  private nextRoll = 3;
  private blink = 0;
  private nextBlink = 2;
  private ear = [new Spring(300, 12), new Spring(300, 12)];
  private nextEar = 1;
  private tailS = new Spring(150, 8);
  private nextTail = 2;
  private play?: { arm_l: Tri; arm_r: Tri; paw_l: Tri; paw_r: Tri };
  private drummer: boolean;
  private headY: number;
  private rnd: () => number;
  private dropS = 0;

  constructor(public rig: RigInstance, seed = 1) {
    this.J = new Joints(rig);
    let s = (seed * 9301 + 49297) % 233280;
    this.rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    this.t = this.rnd() * 20;
    const meta = rig.geo.spec.meta ?? {};
    this.play = meta.playPose;
    this.drummer = meta.instrument === 'drum';
    this.headY = meta.headY ?? 0.37;
  }

  /** squash & stretch impulse (+ stretch, - squash) */
  kick(a: number) {
    this.sq.v += a;
  }

  update(dt: number) {
    const P = this.P, J = this.J, R = this.rnd;
    this.t += dt;
    const t = this.t;
    P.clear();
    let l = 14;
    this.rootDrop = 0;
    // ---------------------------------------------------------------- look: snappy sentinel saccades
    this.nextSac -= dt;
    if (this.lookAt) {
      this.rig.root.updateWorldMatrix(true, false);
      const p = this.rig.root.worldToLocal(_v.copy(this.lookAt));
      const by = Math.atan2(p.x, p.z - 0.02), bp = -Math.atan2(p.y - this.headY, Math.hypot(p.x, p.z));
      if (this.nextSac <= 0) {
        this.nextSac = 0.5 + R() * 1.4;
        this.tYaw = clamp(by + (R() - 0.5) * 0.3, -1.5, 1.5);
        this.tPitch = clamp(bp + (R() - 0.5) * 0.12, -0.55, 0.6);
      }
    } else if (this.nextSac <= 0) {
      this.nextSac = 0.35 + R() * 1.1;
      this.tYaw = (R() - 0.5) * 2.6;
      this.tPitch = (R() - 0.65) * 0.5;
    }
    this.nextRoll -= dt;
    if (this.nextRoll <= 0) {
      this.nextRoll = 1.5 + R() * 3.5;
      this.tRoll = R() < 0.45 ? (R() < 0.5 ? -0.3 : 0.3) : 0; // the curious head tilt
    }
    const snappy = this.mode === 'alert' ? 30 : 20;
    this.yaw = damp(this.yaw, this.tYaw, snappy, dt);
    this.pitch = damp(this.pitch, this.tPitch, snappy, dt);
    this.roll = damp(this.roll, this.tRoll, 6, dt);
    let lookW = 1;
    // ---------------------------------------------------------------- mode targets
    switch (this.mode) {
      case 'stand':
        break;
      case 'periscope':
        P.set('arm_l', -0.12, 0, -0.08);
        P.set('arm_r', -0.12, 0, 0.08);
        P.set('paw_l', 0.6);
        P.set('paw_r', 0.6);
        P.set('tail1', -1.05);
        P.set('tail2', -0.35);
        P.set('tail3', -0.2);
        break;
      case 'hop': {
        const s = Math.sin(Math.PI * clamp(this.hopK, 0, 1));
        P.set('thigh_l', -0.95 * s);
        P.set('thigh_r', -0.95 * s);
        P.set('shin_l', 1.35 * s);
        P.set('shin_r', 1.35 * s);
        P.set('foot_l', -0.5 * s);
        P.set('foot_r', -0.5 * s);
        P.set('arm_l', -0.75 * s, 0, 0.15 * s);
        P.set('arm_r', -0.75 * s, 0, -0.15 * s);
        P.set('chest', 0.22 * s);
        P.set('tail1', 0.45 * s);
        P.set('tail2', 0.25 * s);
        l = 24;
        lookW = 0.4;
        break;
      }
      case 'dive':
        // drop down the shaft with the arms up like a diver, ears pinned back
        P.set('arm_l', -2.65, 0, 0.12);
        P.set('arm_r', -2.65, 0, -0.12);
        P.set('paw_l', -0.2);
        P.set('paw_r', -0.2);
        P.set('ear_l', -0.6, -0.5, 0);
        P.set('ear_r', -0.6, 0.5, 0);
        P.set('head', -0.25);
        P.set('tail1', -1.1);
        P.set('tail2', -0.4);
        l = 28;
        lookW = 0;
        break;
      case 'alert':
        P.set('chest', -0.12);
        P.set('neck', -0.1);
        P.set('arm_l', -0.35, 0, -0.05);
        P.set('arm_r', -0.35, 0, 0.05);
        P.set('paw_l', 0.5);
        P.set('paw_r', 0.5);
        P.set('tail1', 0.65);
        P.set('tail2', 0.3);
        this.chatter = Math.max(this.chatter, Math.sin(t * 9) > 0.2 ? 1 : 0); // sharp alarm barks
        l = 20;
        break;
      case 'groom':
        P.set('arm_r', -1.55, 0, 0.5);
        P.set('paw_r', 0.4 + Math.sin(t * 17) * 0.35);
        P.set('head', 0.32, 0.2, 0.35);
        lookW = 0.15;
        break;
      case 'crouch':
        P.set('thigh_l', -1.35);
        P.set('thigh_r', -1.35);
        P.set('shin_l', 2.2);
        P.set('shin_r', 2.2);
        P.set('foot_l', -0.85);
        P.set('foot_r', -0.85);
        P.set('chest', 0.95);
        P.set('neck', 0.3);
        P.set('head', -0.5);
        P.set('arm_l', -0.6);
        P.set('arm_r', -0.6);
        P.set('tail1', 0.5);
        this.rootDrop = -0.085;
        lookW = 0.3;
        break;
      case 'sad':
        P.set('chest', 0.25);
        P.set('neck', 0.2);
        P.set('head', 0.42, 0, Math.sin(t * 1.3) * 0.08);
        P.set('ear_l', 0.5, 0, 0.45);
        P.set('ear_r', 0.5, 0, -0.45);
        P.set('arm_l', 0.1);
        P.set('arm_r', 0.1);
        P.set('tail1', -0.45);
        lookW = 0.2;
        break;
      case 'cheer': {
        const pump = Math.sin(t * 13);
        P.set('arm_l', -2.5 + pump * 0.25, 0, 0.32);
        P.set('arm_r', -2.5 - pump * 0.25, 0, -0.32);
        P.set('paw_l', -0.3);
        P.set('paw_r', -0.3);
        P.set('chest', -0.1);
        P.set('tail1', 0.7);
        P.set('tail2', 0.35);
        this.chatter = Math.max(this.chatter, 0.7);
        lookW = 0.5;
        l = 18;
        break;
      }
      case 'play':
      case 'dance': {
        const b = this.beat;
        const bob = Math.abs(Math.sin(Math.PI * b));
        const dance = this.mode === 'dance';
        if (this.play) {
          const pp = this.play;
          P.set('arm_l', ...pp.arm_l);
          P.set('arm_r', ...pp.arm_r);
          P.set('paw_l', ...pp.paw_l);
          P.set('paw_r', ...pp.paw_r);
        } else {
          P.set('arm_l', -0.6 + Math.sin(Math.PI * b) * 0.5, 0, 0.5);
          P.set('arm_r', -0.6 - Math.sin(Math.PI * b) * 0.5, 0, -0.5);
        }
        // the twist: hips one way, shoulders the other, knees bouncing on the beat
        const tw = dance ? 0.42 : 0.12;
        P.set('hips', 0, tw * Math.sin(Math.PI * b), 0);
        P.add('chest', 0.04, -tw * 1.15 * Math.sin(Math.PI * b), (dance ? 0.05 : 0.06) * Math.sin((Math.PI * b) / 2));
        const knee = dance ? 0.3 + 0.18 * bob : 0.06 * bob;
        P.set('thigh_l', -knee);
        P.set('thigh_r', -knee);
        P.set('shin_l', knee * 1.9);
        P.set('shin_r', knee * 1.9);
        P.set('foot_l', -knee * 0.9);
        P.set('foot_r', -knee * 0.9 - (dance ? 0 : 0.35 * Math.max(0, Math.sin(Math.PI * 2 * b)))); // toe tap
        P.set('tail1', 0.2, 0.5 * Math.sin(Math.PI * b + 0.6) * (dance ? 1 : 0.4), 0);
        this.rootDrop = -(0.01 + 0.012 * knee);
        lookW = 0.45;
        l = 22;
        break;
      }
    }
    // look distribution (neck + head) on top of the mode pose
    const yw = this.yaw * lookW, pt = this.pitch * lookW;
    P.add('neck', pt * 0.3, yw * 0.35, 0);
    P.add('head', pt * 0.7, yw * 0.65, this.roll * lookW);
    if (Math.abs(yw) > 0.8) P.add('chest', 0, (yw - Math.sign(yw) * 0.8) * 0.4, 0);
    P.step(dt, l);

    // ---------------------------------------------------------------- additive layers
    const c = P.cur;
    const breathe = Math.sin(t * 2.6) * 0.018;
    const ch = (this.chatter = Math.max(0, this.chatter - dt * 1.6));
    const chat = ch > 0 ? Math.abs(Math.sin(t * 26)) * ch : 0;
    let jaw = chat * 0.34;
    let headX = Math.sin(t * 26) * 0.06 * ch;
    // playing: strums or drum strokes locked to the beat
    const add: Record<string, Tri> = {};
    const a = (n: string, x: number, y = 0, z = 0) => {
      const v = add[n] ?? [0, 0, 0];
      add[n] = [v[0] + x, v[1] + y, v[2] + z];
    };
    if ((this.mode === 'play' || this.mode === 'dance') && this.play) {
      const b = this.beat;
      if (this.drummer) {
        const sl = Math.pow(Math.sin(Math.PI * b), 2), sr = Math.pow(Math.sin(Math.PI * (b + 0.5)), 2);
        a('arm_l', 0.32 * sl);
        a('arm_r', 0.32 * sr);
        a('paw_l', -0.25 * sl);
        a('paw_r', -0.25 * sr);
      } else {
        const lefty = this.play.arm_l[2] < 0;
        const strum = Math.sin(Math.PI * 4 * b);
        a(lefty ? 'arm_l' : 'arm_r', 0.1 * strum);
        a(lefty ? 'paw_l' : 'paw_r', 0.32 * Math.sin(Math.PI * 4 * b + 0.5));
        a(lefty ? 'arm_r' : 'arm_l', 0, 0, (lefty ? -1 : 1) * 0.035 * Math.sin((Math.PI * b) / 2));
      }
      headX += (Math.abs(Math.sin(Math.PI * this.beat)) * 0.14 - 0.06) * (this.mode === 'dance' ? 1.4 : 1);
      jaw += this.mode === 'dance' ? Math.max(0, Math.sin(Math.PI * this.beat)) * 0.12 : 0; // singing along
    }
    // ear flicks and tail twitches (secondary springs)
    this.nextEar -= dt;
    if (this.nextEar <= 0) {
      this.nextEar = 0.8 + R() * 2.6;
      this.ear[R() < 0.5 ? 0 : 1].v += (R() < 0.5 ? -1 : 1) * 18;
    }
    if (ch > 0.3 && R() < dt * 6) this.ear[R() < 0.5 ? 0 : 1].v += 14;
    const e0 = this.ear[0].step(0, dt), e1 = this.ear[1].step(0, dt);
    this.nextTail -= dt;
    if (this.nextTail <= 0) {
      this.nextTail = 1.2 + R() * 3;
      this.tailS.v += (R() - 0.5) * 16;
    }
    const tw = this.tailS.step(0, dt);
    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 1.8 + R() * 3.5;
      this.blink = 0.12;
    }
    this.blink = Math.max(0, this.blink - dt);
    let eyeY = this.blink > 0 ? 0.12 : 1;
    if (this.mode === 'groom') eyeY = Math.min(eyeY, 0.45);
    if (this.mode === 'sad') eyeY = Math.min(eyeY, 0.7);
    if (this.mode === 'cheer') eyeY = Math.min(eyeY, 0.55);

    // ---------------------------------------------------------------- write joints
    const w = (n: string, dx = 0, dy = 0, dz = 0) => {
      const v = c[n] ?? [0, 0, 0], ad = add[n] ?? [0, 0, 0];
      J.rot(n, v[0] + ad[0] + dx, v[1] + ad[1] + dy, v[2] + ad[2] + dz);
    };
    w('hips');
    w('chest', breathe);
    w('neck');
    w('head', headX);
    w('jaw', jaw);
    w('ear_l', e0 * 0.3, 0, e0 * 0.16);
    w('ear_r', e1 * 0.3, 0, -e1 * 0.16);
    for (const n of ['arm_l', 'arm_r', 'paw_l', 'paw_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail1', 'tail2']) w(n);
    w('tail3', tw * 0.12, tw * 0.5, 0);
    w('instrument');
    for (const n of ['eye_l', 'eye_r']) this.rig.nodes[n]?.scale.set(1, eyeY, 1);
    // squash & stretch on the whole body (volume-preserving), plus chatter pulses
    const s = clamp(this.sq.step(0, dt) + chat * 0.03, -0.35, 0.35);
    J.scale('hips', 1 - s * 0.45, 1 + s, 1 - s * 0.45);
    this.dropS = damp(this.dropS, this.rootDrop, 12, dt);
    J.pos('hips', 0, this.dropS, 0);
  }
}

// =====================================================================================================
// DANCE MOVES (shared vocabulary for the jerboa and the player)
// =====================================================================================================
export type DanceMove = 'hop' | 'left' | 'right' | 'wiggle' | 'spin';
export const DANCE_MOVES: DanceMove[] = ['hop', 'left', 'right', 'wiggle', 'spin'];
export const DANCE_INFO: Record<DanceMove, { key: string; glyph: string; name: string }> = {
  hop: { key: 'KeyW', glyph: 'W', name: 'BIG HOP' },
  left: { key: 'KeyA', glyph: 'A', name: 'SHIMMY LEFT' },
  right: { key: 'KeyD', glyph: 'D', name: 'SHIMMY RIGHT' },
  wiggle: { key: 'KeyS', glyph: 'S', name: 'TAIL WIGGLE' },
  spin: { key: 'Space', glyph: 'SPACE', name: 'SPIN' },
};
/** root motion requested by a pose (local metres / radians) */
export interface RootMotion {
  x: number;
  y: number;
  yaw: number;
}

// =====================================================================================================
// GIANT JERBOA
// =====================================================================================================
export type JerboaMode = 'idle' | 'hop' | 'curious' | 'dance' | 'happy' | 'sad' | 'startle' | 'bow';
const JB_JOINTS = ['hips', 'chest', 'neck', 'head', 'jaw', 'ear_l', 'ear_l2', 'ear_r', 'ear_r2', 'arm_l', 'arm_r', 'paw_l', 'paw_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'];

export class JerboaAnim {
  t = 0;
  mode: JerboaMode = 'idle';
  hopK = 0;
  move: DanceMove = 'hop';
  moveK = 0;
  beat = 0;
  lookAt: THREE.Vector3 | null = null;
  root: RootMotion = { x: 0, y: 0, yaw: 0 };
  private J: Joints;
  private P = new PoseBlend(JB_JOINTS);
  private ears = [new Spring(70, 6), new Spring(70, 6), new Spring(55, 5), new Spring(55, 5)];
  private earSide = [new Spring(60, 6), new Spring(60, 6)];
  private tail = [new Spring(40, 6), new Spring(30, 5), new Spring(24, 4)];
  private sq = new Spring(180, 11);
  private yaw = 0;
  private pitch = 0;
  private tilt = 0;
  private nextTilt = 1;
  private tTilt = 0;
  private blink = 0;
  private nextBlink = 2;
  private sniff = 0;
  private wasAir = false;

  constructor(public rig: RigInstance) {
    this.J = new Joints(rig);
  }
  kick(a: number) {
    this.sq.v += a;
  }

  update(dt: number) {
    const P = this.P, t = (this.t += dt);
    P.clear();
    this.root = { x: 0, y: 0, yaw: 0 };
    let l = 10;
    let earT = [0, 0, 0, 0]; // ear_l, ear_r, ear_l2, ear_r2 pitch targets (+ = flop forward)
    let earS = [0, 0]; // splay
    let tailLift = 0;
    let eye = 1;
    let lookW = 1;
    // ---------------------------------------------------------------- look + curious tilts
    let ty = 0, tp = 0;
    if (this.lookAt) {
      this.rig.root.updateWorldMatrix(true, false);
      const p = this.rig.root.worldToLocal(_v.copy(this.lookAt));
      ty = clamp(Math.atan2(p.x, p.z), -1.1, 1.1);
      tp = clamp(-Math.atan2(p.y - 2.0, Math.hypot(p.x, p.z)), -0.5, 0.45);
    }
    this.nextTilt -= dt;
    if (this.nextTilt <= 0) {
      this.nextTilt = 1.2 + Math.random() * 2.2;
      this.tTilt = this.mode === 'curious' ? (Math.random() < 0.5 ? -0.32 : 0.32) : Math.random() < 0.3 ? (Math.random() - 0.5) * 0.3 : 0;
    }
    this.yaw = damp(this.yaw, ty, 5, dt);
    this.pitch = damp(this.pitch, tp, 5, dt);
    this.tilt = damp(this.tilt, this.tTilt, 4, dt);
    // ---------------------------------------------------------------- mode
    switch (this.mode) {
      case 'idle':
        earT = [0.05 + Math.sin(t * 0.7) * 0.05, 0.05 + Math.sin(t * 0.6 + 1) * 0.05, 0.08, 0.08];
        break;
      case 'curious':
        P.set('neck', 0.18);
        P.set('head', -0.12);
        P.set('arm_l', -0.25);
        P.set('arm_r', -0.25);
        earT = [-0.18, -0.18, -0.05, -0.05];
        earS = [0.12, 0.12];
        if (Math.random() < dt * 0.7) this.sniff = 0.6;
        break;
      case 'startle':
        P.set('chest', -0.28);
        P.set('neck', -0.15);
        P.set('arm_l', -0.6);
        P.set('arm_r', -0.6);
        earT = [-0.85, -0.85, -0.4, -0.4];
        tailLift = 0.5;
        eye = 1.12;
        l = 18;
        break;
      case 'sad':
        P.set('chest', 0.18);
        P.set('neck', 0.25);
        P.set('head', 0.3, 0, Math.sin(t * 1.2) * 0.06);
        earT = [0.85, 0.85, 0.5, 0.5];
        earS = [0.5, 0.5];
        tailLift = -0.25;
        eye = 0.62;
        lookW = 0.3;
        break;
      case 'bow':
        P.set('chest', 0.55);
        P.set('neck', 0.25);
        P.set('head', 0.25);
        P.set('arm_l', -0.7, 0, -0.2);
        P.set('arm_r', -0.7, 0, 0.2);
        earT = [0.3, 0.3, 0.3, 0.3];
        eye = 0.5;
        lookW = 0.1;
        break;
      case 'happy': {
        const hop = Math.abs(Math.sin(t * Math.PI * 1.6));
        this.root.y = hop * 0.22;
        P.set('arm_l', -0.9 + Math.sin(t * 10) * 0.3, 0, -0.1);
        P.set('arm_r', -0.9 - Math.sin(t * 10) * 0.3, 0, 0.1);
        P.set('thigh_l', -0.25 * (1 - hop));
        P.set('thigh_r', -0.25 * (1 - hop));
        P.set('shin_l', 0.4 * (1 - hop));
        P.set('shin_r', 0.4 * (1 - hop));
        earT = [Math.sin(t * 6) * 0.3, Math.sin(t * 6 + 1.5) * 0.3, 0.2, 0.2];
        earS = [0.2, 0.2];
        tailLift = 0.35;
        eye = 0.55;
        l = 16;
        break;
      }
      case 'hop':
        this.hopPose(clamp(this.hopK, 0, 1));
        earT = this.hopEars;
        tailLift = this.hopTail;
        l = 22;
        lookW = 0.5;
        break;
      case 'dance': {
        const k = clamp(this.moveK, 0, 1);
        const r = this.dancePose(this.move, k);
        earT = r.ears;
        earS = r.splay;
        tailLift = r.tail;
        eye = r.eye;
        lookW = 0.35;
        l = 24;
        break;
      }
    }
    // landing squash
    const air = this.root.y > 0.05;
    if (this.wasAir && !air) this.kick(-2.2);
    this.wasAir = air;
    // look on top
    P.add('neck', this.pitch * 0.35 * lookW, this.yaw * 0.35 * lookW, 0);
    P.add('head', this.pitch * 0.65 * lookW, this.yaw * 0.65 * lookW, this.tilt);
    P.step(dt, l);
    // ---------------------------------------------------------------- springs & layers
    const c = P.cur;
    this.sniff = Math.max(0, this.sniff - dt);
    const sniff = this.sniff > 0 ? Math.sin(t * 38) * 0.035 : 0;
    const breathe = Math.sin(t * 1.9) * 0.025;
    // ears: base + tips lag behind body motion
    const bodyV = this.sq.v * 0.02;
    const eL = this.ears[0].step(earT[0] + bodyV, dt), eR = this.ears[1].step(earT[1] + bodyV, dt);
    const eL2 = this.ears[2].step(earT[2] + (eL - earT[0]) * 1.4, dt), eR2 = this.ears[3].step(earT[3] + (eR - earT[1]) * 1.4, dt);
    const sL = this.earSide[0].step(earS[0], dt), sR = this.earSide[1].step(earS[1], dt);
    const tA = this.tail[0].step(tailLift, dt), tB = this.tail[1].step(tA * 0.8 + Math.sin(t * 1.3) * 0.06, dt), tC = this.tail[2].step(tB * 0.8 + Math.sin(t * 1.7 + 1) * 0.12, dt);
    // blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 2 + Math.random() * 3.5;
      this.blink = 0.14;
    }
    this.blink = Math.max(0, this.blink - dt);
    if (this.blink > 0) eye = 0.1;
    const J = this.J;
    const w = (n: string, dx = 0, dy = 0, dz = 0) => {
      const v = c[n] ?? [0, 0, 0];
      J.rot(n, v[0] + dx, v[1] + dy, v[2] + dz);
    };
    w('hips');
    w('chest', breathe);
    w('neck');
    w('head', sniff);
    w('jaw', this.mode === 'happy' ? 0.15 : 0);
    w('ear_l', eL, 0, -sL);
    w('ear_r', eR, 0, sR);
    w('ear_l2', eL2);
    w('ear_r2', eR2);
    for (const n of ['arm_l', 'arm_r', 'paw_l', 'paw_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r']) w(n);
    w('tail1', tA * 0.6);
    w('tail2', tA * 0.3, tB * 0.25, 0);
    w('tail3', -tA * 0.2, tB * 0.35, 0);
    w('tail4', -tA * 0.25, tC * 0.4, 0);
    w('tail5', tC * 0.25, tC * 0.5, 0);
    for (const n of ['eye_l', 'eye_r']) this.rig.nodes[n]?.scale.set(1, eye, 1);
    const s = clamp(this.sq.step(0, dt), -0.3, 0.3);
    J.scale('hips', 1 - s * 0.4, 1 + s, 1 - s * 0.4);
    J.pos('hips', this.root.x, this.root.y, 0);
  }

  // ---- hop cycle: crouch, launch, tuck, land
  private hopEars = [0, 0, 0, 0];
  private hopTail = 0;
  private hopPose(k: number) {
    const P = this.P;
    let thigh = 0, shin = 0, foot = 0, chest = 0, arm = -0.2, drop = 0;
    if (k < 0.22) {
      const c = sstep(0, 0.22, k);
      thigh = -0.45 * c;
      shin = 0.8 * c;
      foot = -0.35 * c;
      drop = -0.2 * c;
      chest = 0.1 * c;
    } else if (k < 0.34) {
      const e = sstep(0.22, 0.34, k);
      thigh = -0.45 + 0.75 * e;
      shin = 0.8 - 1.2 * e;
      foot = -0.35 + 0.95 * e;
      drop = -0.2 + 0.2 * e;
      chest = 0.1 + 0.15 * e;
    } else if (k < 0.82) {
      const a = sstep(0.34, 0.6, k);
      thigh = 0.3 - 0.95 * a;
      shin = -0.4 + 1.3 * a;
      foot = 0.6 - 0.75 * a;
      chest = 0.25 - 0.1 * a;
      arm = -0.5;
    } else {
      const c = Math.sin(Math.PI * sstep(0.82, 1, k));
      thigh = -0.65 + 0.65 * sstep(0.82, 1, k) - 0.2 * c;
      shin = 0.9 - 0.9 * sstep(0.82, 1, k) + 0.4 * c;
      foot = -0.15 + 0.15 * sstep(0.82, 1, k) - 0.25 * c;
      drop = -0.14 * c;
    }
    P.set('thigh_l', thigh);
    P.set('thigh_r', thigh);
    P.set('shin_l', shin);
    P.set('shin_r', shin);
    P.set('foot_l', foot);
    P.set('foot_r', foot);
    P.set('chest', chest);
    P.set('arm_l', arm);
    P.set('arm_r', arm);
    const airK = k > 0.3 && k < 0.85 ? 1 : 0;
    this.hopEars = [-0.55 * airK + 0.25 * (1 - airK), -0.55 * airK + 0.25 * (1 - airK), -0.35 * airK, -0.35 * airK];
    this.hopTail = 0.45 * airK;
    this.root.y += drop;
  }

  /** a dance move at progress k (0..1, the beat lands at 0.5); returns ear/tail/eye wishes */
  private dancePose(m: DanceMove, k: number) {
    const P = this.P;
    const out = { ears: [0, 0, 0, 0], splay: [0, 0], tail: 0, eye: 1 };
    const pk = Math.sin(Math.PI * k); // 0 -> 1 -> 0, peak on the beat
    // stand tall to dance (the rest pose leans forward)
    P.set('chest', -0.22);
    P.set('neck', -0.05);
    switch (m) {
      case 'hop': {
        const crouch = k < 0.22 ? sstep(0, 0.22, k) : k > 0.8 ? Math.sin(Math.PI * sstep(0.8, 1, k)) : 0;
        const air = k > 0.22 && k < 0.8 ? Math.sin((Math.PI * (k - 0.22)) / 0.58) : 0;
        this.root.y = air * 0.75 - crouch * 0.18;
        P.set('thigh_l', -0.45 * crouch - 0.5 * air);
        P.set('thigh_r', -0.45 * crouch - 0.5 * air);
        P.set('shin_l', 0.8 * crouch + 0.7 * air);
        P.set('shin_r', 0.8 * crouch + 0.7 * air);
        P.set('foot_l', -0.35 * crouch + 0.3 * air);
        P.set('foot_r', -0.35 * crouch + 0.3 * air);
        P.set('arm_l', -1.9 * air - 0.3, 0, 0.5 * air);
        P.set('arm_r', -1.9 * air - 0.3, 0, -0.5 * air);
        out.ears = [-0.5 * air, -0.5 * air, -0.3 * air, -0.3 * air];
        out.splay = [0.45 * air, 0.45 * air];
        out.tail = 0.6 * air;
        out.eye = air > 0.5 ? 0.6 : 1;
        break;
      }
      case 'left':
      case 'right': {
        const s = m === 'left' ? 1 : -1;
        this.root.x = s * 0.55 * pk;
        this.root.y = 0.32 * pk;
        P.add('chest', 0, 0, -s * 0.26 * pk);
        P.add('head', 0, s * 0.3 * pk, -s * 0.2 * pk);
        P.set('arm_l', -0.8 - (s > 0 ? 0.9 : 0) * pk, 0, (s > 0 ? 0.7 : 0.2) * pk);
        P.set('arm_r', -0.8 - (s < 0 ? 0.9 : 0) * pk, 0, -(s < 0 ? 0.7 : 0.2) * pk);
        P.set('thigh_l', -0.35 * pk);
        P.set('thigh_r', -0.35 * pk);
        P.set('shin_l', 0.6 * pk);
        P.set('shin_r', 0.6 * pk);
        P.set('tail1', 0, -s * 0.5 * pk, 0);
        P.set('tail2', 0, -s * 0.35 * pk, 0);
        out.splay = [s > 0 ? 0.45 * pk : -0.1, s < 0 ? 0.45 * pk : -0.1];
        out.ears = [0.2 * pk, 0.2 * pk, 0.35 * pk, 0.35 * pk];
        out.tail = 0.25 * pk;
        break;
      }
      case 'wiggle': {
        const low = Math.sin(Math.PI * sstep(0, 1, k));
        const wig = Math.sin(Math.PI * 4 * k);
        this.root.y = -0.24 * low;
        P.set('hips', 0, 0.38 * wig * low, 0);
        P.add('chest', 0.35 * low, -0.3 * wig * low, 0);
        P.set('thigh_l', -0.65 * low);
        P.set('thigh_r', -0.65 * low);
        P.set('shin_l', 1.1 * low);
        P.set('shin_r', 1.1 * low);
        P.set('foot_l', -0.45 * low);
        P.set('foot_r', -0.45 * low);
        P.set('arm_l', -0.6 * low);
        P.set('arm_r', -0.6 * low);
        P.set('tail1', 0.2 * low, -0.6 * Math.sin(Math.PI * 4 * k + 0.6) * low, 0);
        P.set('tail2', 0, -0.5 * Math.sin(Math.PI * 4 * k + 1.2) * low, 0);
        P.set('tail3', 0, -0.4 * Math.sin(Math.PI * 4 * k + 1.8) * low, 0);
        out.ears = [0.35 * wig * low, -0.35 * wig * low, 0.2, 0.2];
        out.tail = 0.3 * low;
        out.eye = 0.6;
        break;
      }
      case 'spin': {
        const e = sstep(0.1, 0.9, k);
        this.root.yaw = e * Math.PI * 2;
        this.root.y = 0.12 * pk;
        P.set('arm_l', -1.2 * pk, 0, 0.9 * pk);
        P.set('arm_r', -1.2 * pk, 0, -0.9 * pk);
        P.set('thigh_l', -0.2 * pk);
        P.set('thigh_r', -0.2 * pk);
        P.set('shin_l', 0.35 * pk);
        P.set('shin_r', 0.35 * pk);
        out.splay = [0.9 * pk, 0.9 * pk];
        out.ears = [-0.25 * pk, -0.25 * pk, -0.4 * pk, -0.4 * pk];
        out.tail = 0.5 * pk;
        break;
      }
    }
    return out;
  }
}

// =====================================================================================================
// THE PLAYER'S DANCE (humanoid rig: pelvis, torso, head, arm/fore, thigh/shin)
// =====================================================================================================
export type HumanMove = DanceMove | 'groove' | 'stumble' | 'cheer' | 'idle';
const HU_JOINTS = ['pelvis', 'torso', 'head', 'arm_l', 'arm_r', 'fore_l', 'fore_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r'];

export class HumanDance {
  private J: Joints;
  private P = new PoseBlend(HU_JOINTS);
  root: RootMotion = { x: 0, y: 0, yaw: 0 };
  private drop = 0;
  constructor(public rig: RigInstance) {
    this.J = new Joints(rig);
  }
  /** pose one frame; `k` = move progress (beat at 0.5), `beat` = music position in beats */
  pose(move: HumanMove, k: number, beat: number, t: number, dt: number) {
    const P = this.P;
    P.clear();
    this.root = { x: 0, y: 0, yaw: 0 };
    let drop = 0;
    const pk = Math.sin(Math.PI * clamp(k, 0, 1));
    const bob = Math.abs(Math.sin(Math.PI * beat));
    const bend = (th: number) => {
      P.add('thigh_l', -th);
      P.add('thigh_r', -th);
      P.add('shin_l', th * 2);
      P.add('shin_r', th * 2);
      drop = Math.max(drop, 0.56 * (1 - Math.cos(th)));
    };
    switch (move) {
      case 'idle':
        break;
      case 'groove':
        bend(0.12 + 0.14 * bob);
        P.set('torso', 0.06 * bob, 0.12 * Math.sin((Math.PI * beat) / 2), 0);
        P.set('head', 0.16 * bob - 0.06);
        P.set('arm_l', -0.35 + 0.25 * Math.sin(Math.PI * beat), 0, 0.15);
        P.set('arm_r', -0.35 - 0.25 * Math.sin(Math.PI * beat), 0, -0.15);
        P.set('fore_l', -1.1);
        P.set('fore_r', -1.1);
        break;
      case 'hop': {
        const crouch = k < 0.2 ? sstep(0, 0.2, k) : k > 0.78 ? Math.sin(Math.PI * sstep(0.78, 1, k)) : 0;
        const air = k > 0.2 && k < 0.78 ? Math.sin((Math.PI * (k - 0.2)) / 0.58) : 0;
        bend(0.55 * crouch);
        this.root.y = air * 0.5;
        P.add('thigh_l', -0.9 * air);
        P.add('thigh_r', -0.9 * air);
        P.add('shin_l', 1.5 * air);
        P.add('shin_r', 1.5 * air);
        P.set('arm_l', -2.85 * air - 0.3 * crouch, 0, 0.22 * air);
        P.set('arm_r', -2.85 * air - 0.3 * crouch, 0, -0.22 * air);
        P.set('head', -0.25 * air);
        break;
      }
      case 'left':
      case 'right': {
        const s = move === 'left' ? 1 : -1;
        this.root.x = s * 0.35 * pk;
        this.root.y = 0.08 * pk;
        bend(0.15 * pk);
        P.set('torso', 0, s * 0.25 * pk, -s * 0.22 * pk);
        P.set('head', 0, s * 0.35 * pk, -s * 0.15 * pk);
        // disco point up and out on the leading side, the other fist on the hip
        const point = s > 0 ? 'arm_l' : 'arm_r', hipA = s > 0 ? 'arm_r' : 'arm_l';
        const pf = s > 0 ? 'fore_l' : 'fore_r', hf = s > 0 ? 'fore_r' : 'fore_l';
        P.set(point, -2.35 * pk, 0, s * 0.62 * pk);
        P.set(pf, -0.15 * pk);
        P.set(hipA, 0.25 * pk, 0, -s * 0.55 * pk);
        P.set(hf, -1.7 * pk);
        break;
      }
      case 'wiggle': {
        const low = Math.sin(Math.PI * clamp(k, 0, 1));
        const wig = Math.sin(Math.PI * 4 * k);
        bend(0.62 * low);
        P.set('pelvis', 0, 0.45 * wig * low, 0);
        P.set('torso', 0.28 * low, -0.55 * wig * low, 0);
        P.set('arm_l', -0.55 * low + 0.35 * wig * low, 0, 0.2);
        P.set('arm_r', -0.55 * low - 0.35 * wig * low, 0, -0.2);
        P.set('fore_l', -1.4 * low);
        P.set('fore_r', -1.4 * low);
        P.set('head', -0.15 * low, 0, 0.2 * wig * low);
        break;
      }
      case 'spin': {
        const e = sstep(0.08, 0.92, k);
        this.root.yaw = e * Math.PI * 2;
        this.root.y = 0.06 * pk;
        bend(0.18 * (1 - pk));
        P.set('arm_l', -0.2 * pk, 0, 1.35 * pk);
        P.set('arm_r', -0.2 * pk, 0, -1.35 * pk);
        P.set('head', -0.2 * pk);
        break;
      }
      case 'stumble': {
        const w1 = Math.sin(t * 17), w2 = Math.sin(t * 11 + 1);
        bend(0.25 * pk);
        P.set('torso', 0.3 * w2 * pk, 0, 0.35 * w1 * pk);
        P.set('head', 0.2 * w1 * pk, 0.3 * w2 * pk, -0.3 * w1 * pk);
        P.set('arm_l', -1.2 + Math.sin(t * 21) * 0.9 * pk, 0, 0.8 * pk);
        P.set('arm_r', -1.2 + Math.sin(t * 19 + 2) * 0.9 * pk, 0, -0.8 * pk);
        P.set('fore_l', -0.6 * pk);
        P.set('fore_r', -0.6 * pk);
        this.root.x = 0.12 * w1 * pk;
        break;
      }
      case 'cheer': {
        const pump = Math.sin(t * 12);
        bend(0.12 + 0.1 * Math.abs(pump));
        this.root.y = Math.abs(Math.sin(t * 6)) * 0.12;
        P.set('arm_l', -2.7 + 0.25 * pump, 0, 0.25);
        P.set('arm_r', -2.7 - 0.25 * pump, 0, -0.25);
        P.set('fore_l', -0.35);
        P.set('fore_r', -0.35);
        P.set('head', -0.25);
        break;
      }
    }
    P.step(dt, 26);
    this.drop = damp(this.drop, drop, 26, dt);
    const c = P.cur;
    for (const n of HU_JOINTS) J_rot(this.J, n, c[n]);
    this.J.pos('pelvis', this.root.x, this.root.y - this.drop, 0);
  }
  restore() {
    this.rig.resetPose();
  }
}
function J_rot(J: Joints, n: string, v: Tri) {
  J.rot(n, v[0], v[1], v[2]);
}
