// The little desert jerboa: a fist-sized, round, fluffy hopper (≈ 0.4 m to the
// ear tips, tail twice its body) in the giant jerboa's style — sandy coat with a
// white belly and hip stripe, an oversized head with huge glossy modelled eyes in
// cream rings, a pink twitchy nose, long whiskers, two vast veined pink ears,
// tiny pink forepaws, kangaroo hind legs on long bristle-fringed feet, and the
// black-and-white feathered tail flag.
//
// RIG (faces +Z, LEFT = +X, origin on the ground between the feet, 1/150 m):
//   hips (root) → chest → head → ear_l, ear_r, eye_l, eye_r
//   chest → arm_l, arm_r;  hips → thigh_l → shin_l → foot_l (and _r);  hips → tail1 → tail2 → tail3
// `JerboaPupAnim` poses it: sit (sniffing, ear swivels), upright (periscope),
// wash (paws rubbing the face, eyes squeezed shut), hop (crouch → kick → tuck →
// land), crouch (scared, ears flat).
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, blob, ell, cap, tube, line, paint, exposed, splitInto, mixc, n01, h01, fur, wetEye, add3, sub3, scl3, dot3, cross3, norm3, sstep, clamp01, memoBy } from './ckit';

const VS = 1 / 150;
const U = (m: number) => m / VS;
const P = (x: number, y: number, z: number): V3 => [x / VS, y / VS, z / VS];
const Pv = (v: V3): V3 => [v[0] / VS, v[1] / VS, v[2] / VS];
const M = (i: number) => (i + 0.5) * VS;
const mirX = (v: V3): V3 => [-v[0], v[1], v[2]];

const C = {
  sand: 0xd9b17b,
  sandL: 0xeaca98,
  sandD: 0xb08757,
  white: 0xf6efe3,
  whiteD: 0xe2d6c4,
  pink: 0xeea79f,
  pinkD: 0xd88a8c,
  nose: 0xe48a8a,
  claw: 0xf2e6d4,
  tuftBlack: 0x1f1a17,
  tuftWhite: 0xfbf7f0,
  ring: 0xf8eedc,
};

const J = {
  hips: [0, 0.1, -0.03] as V3,
  chest: [0, 0.145, 0.03] as V3,
  neck: [0, 0.19, 0.055] as V3,
  eye: [0.045, 0.239, 0.104] as V3,
  earBase: [0.03, 0.274, 0.056] as V3,
  shoulder: [0.032, 0.158, 0.074] as V3,
  elbow: [0.037, 0.137, 0.094] as V3,
  wrist: [0.022, 0.127, 0.11] as V3,
  hip: [0.045, 0.092, -0.04] as V3,
  knee: [0.056, 0.07, 0.042] as V3,
  ankle: [0.05, 0.02, -0.068] as V3,
  heel: [0.05, 0.011, -0.08] as V3,
  toe: [0.05, 0.009, 0.075] as V3,
  t1: [0, 0.075, -0.1] as V3,
  t2: [0, 0.042, -0.2] as V3,
  t3: [0, 0.03, -0.31] as V3,
  t4: [0, 0.036, -0.4] as V3,
  tip: [0, 0.064, -0.48] as V3,
};
const EYE_R = 0.024;
const EAR = { L: 0.125, W: 0.03, dir: norm3([0.36, 0.9, -0.24]), face: norm3([0.45, 0, 1]) };

function ventral(p: V3) {
  const a: V3 = [0, 0.09, -0.04], b: V3 = [0, 0.2, 0.06];
  const ab = sub3(b, a);
  const t = clamp01(dot3(sub3(p, a), ab) / dot3(ab, ab));
  const r = sub3(p, add3(a, scl3(ab, t)));
  return dot3(norm3(r), norm3([0, -0.55, 0.84]));
}

function buildPup(): RigSpec {
  const rig = new CRig('jerboa_pup', VS);
  const sandF = fur(C.sand, C.sandL, C.sandD, 2.2, 7, [1, 2.4, 1.4]);
  const whiteF = fur(C.white, 0xffffff, C.whiteD, 2.2, 8, [1, 2.4, 1.4]);
  const coat = (i: number, j: number, k: number) => {
    const v = ventral([M(i), M(j), M(k)]) + (n01(i, j, k, 0.16, 3) - 0.5) * 0.35;
    if (v > 0.3) return whiteF(i, j, k);
    if (v > 0.12) return mixc(sandF(i, j, k), C.white, 0.55);
    return v < -0.72 ? mixc(sandF(i, j, k), C.sandD, 0.3) : sandF(i, j, k);
  };

  // ================================================================ round fluffy body (split hips / chest)
  const body = new VoxelModel('body');
  const prims: Prim[] = [
    { c: P(0, 0.092, -0.035), r: P(0.07, 0.074, 0.078) }, // rump
    { c: P(0, 0.118, 0.02), r: P(0.058, 0.064, 0.062) }, // belly
    { c: P(0, 0.152, 0.05), r: P(0.046, 0.05, 0.045) }, // chest
    { c: P(0.05, 0.078, -0.03), r: P(0.034, 0.056, 0.066) }, // haunches
    { c: P(-0.05, 0.078, -0.03), r: P(0.034, 0.056, 0.066) },
    { a: P(0, 0.17, 0.052), b: P(0, 0.198, 0.066), r0: U(0.042), r1: U(0.04) }, // scruff
  ];
  blob(body, prims, (i, j, k) => {
    // the white hip stripe across the haunch
    if (Math.abs(M(i)) > 0.07 && Math.abs(M(j) - 0.075 + M(k) * 0.3) < 0.006) return C.white;
    return coat(i, j, k);
  }, { k: U(0.02), disp: (x, y, z) => (n01(x, y, z, 0.24, 11) - 0.5) * 0.9, keep: (_x, y) => y >= 1 && M(y) < 0.215 });
  const nA = norm3([0, 0.8, 0.6]);
  const hips = rig.part('hips', undefined, Pv(J.hips));
  const chest = rig.part('chest', 'hips', Pv(J.chest));
  splitInto(body, hips, chest, (x, y, z) => dot3(sub3([M(x), M(y), M(z)], J.chest), nA) >= 0, (x, y, z) => dot3(sub3([M(x), M(y), M(z)], J.chest), nA) >= -0.012);

  // ================================================================ big round head
  const head = rig.part('head', 'chest', Pv(J.neck));
  const headCol = (i: number, j: number, k: number) => {
    const X = M(i), Y = M(j), Z = M(k), ax = Math.abs(X);
    let c = sandF(i, j, k);
    if ((Y < 0.214 - Math.max(0, Z - 0.1) * 0.2 && Z > 0.05) || (Y < 0.2 && Z > 0.0)) c = whiteF(i, j, k);
    else if (Z > 0.13 && ax > 0.012 && Y < 0.228) c = mixc(c, C.white, 0.6);
    // a pale brow spot over each eye
    if (Math.hypot(ax - 0.04, Y - 0.27, Z - 0.1) < 0.012) c = mixc(c, C.white, 0.6);
    if (Y > 0.27) c = mixc(c, C.sandD, sstep(0.27, 0.3, Y) * 0.3);
    return c;
  };
  blob(head, [
    { c: P(0, 0.238, 0.078), r: P(0.068, 0.06, 0.064) }, // cranium
    { c: P(0.036, 0.218, 0.102), r: P(0.036, 0.033, 0.036) }, // fluffy cheeks
    { c: P(-0.036, 0.218, 0.102), r: P(0.036, 0.033, 0.036) },
    { c: P(0, 0.214, 0.138), r: P(0.029, 0.025, 0.03) }, // snout
    { c: P(0, 0.258, 0.098), r: P(0.045, 0.03, 0.035) }, // forehead
    { a: P(0, 0.19, 0.055), b: P(0, 0.21, 0.075), r0: U(0.042), r1: U(0.04) }, // neck join
  ], headCol, { k: U(0.014), disp: (x, y, z) => (n01(x, y, z, 0.3, 21) - 0.5) * 0.8 });
  // twitchy pink nose, mouth line, buck teeth
  ell(head, P(0, 0.219, 0.166), P(0.011, 0.009, 0.008), (_x, y) => (M(y) < 0.216 ? C.pinkD : C.nose), { fl: VF.METAL });
  {
    const fz = (x: number, y: number) => {
      let z = 60;
      while (z > 0 && !head.has(x, y, z)) z--;
      return z;
    };
    for (const x of [-2, 1]) {
      const y = Math.floor(U(0.217));
      const z = fz(x, y);
      if (z > 0) head.set(x, y, z, 0x8a4448);
    }
    const my = Math.floor(U(0.2));
    for (let x = -2; x <= 1; x++) {
      const z = fz(x, my + 1);
      if (z > 0) head.set(x, my + 1, z, x === -2 || x === 1 ? 0xc06a6e : 0x8a5048);
    }
    for (const x of [-1, 0]) {
      const z = fz(x, my);
      if (z > 0) for (let y = my - 1; y <= my; y++) head.set(x, y, z, y === my - 1 ? 0xfaf6ee : 0xf2ead8);
    }
  }
  // huge glossy eyes in cream rings
  const eyeC = Pv(J.eye);
  for (const s of [1, -1]) {
    const ec = s > 0 ? eyeC : mirX(eyeC);
    paint(head, (x, y, z) => Math.hypot(x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]) < U(EYE_R) * 1.45 && exposed(head, x, y, z), C.ring);
    ell(head, ec, [U(EYE_R) * 1.04, U(EYE_R) * 1.04, U(EYE_R) * 1.04], 0, { carve: true });
  }
  const eyeL = rig.part('eye_l', 'head', eyeC);
  wetEye(eyeL, eyeC, U(EYE_R), [0.62, 0.08, 0.78], { sclera: 0x170e0a, iris: 0x3c2414, irisEdge: 0x24160c, pupil: 0x050303, irisR: 0.92, pupilR: 0.64, bigGlint: 2 });
  rig.mirror('eye_l', 'eye_r');
  // long whiskers
  for (let w = 0; w < 4; w++) {
    const root: V3 = [0.016, 0.212 + w * 0.004, 0.155 - w * 0.003];
    const dir = norm3([1, 0.12 - w * 0.09, -0.3 + w * 0.05]);
    const len = 0.075 - Math.abs(w - 1.5) * 0.006;
    const mid = add3(add3(root, scl3(dir, len * 0.5)), [0, -0.004, 0]);
    const tip = add3(add3(root, scl3(dir, len)), [0, -0.012, 0]);
    for (const s of [1, -1]) {
      const pts = [root, mid, tip].map((p) => Pv(s > 0 ? p : mirX(p)));
      line(head, pts, (x, y, z) => {
        const d = Math.hypot(x + 0.5 - pts[0][0], y + 0.5 - pts[0][1], z + 0.5 - pts[0][2]) / U(len);
        return d < 0.35 ? 0x5e5048 : d < 0.7 ? 0xb8aea4 : 0xf4f0ea;
      });
    }
  }

  // ================================================================ vast veined ears
  {
    const base = Pv(J.earBase);
    const u = EAR.dir;
    const w = norm3(sub3(EAR.face, scl3(u, dot3(EAR.face, u))));
    const v = cross3(u, w);
    const Ln = U(EAR.L), W = U(EAR.W);
    const ear = rig.part('ear_l', 'head', base);
    const R = Ln + 2;
    for (let i = Math.floor(base[0] - R); i <= Math.ceil(base[0] + R); i++)
      for (let j = Math.floor(base[1] - 3); j <= Math.ceil(base[1] + R); j++)
        for (let k = Math.floor(base[2] - R); k <= Math.ceil(base[2] + R); k++) {
          const q = sub3([i + 0.5, j + 0.5, k + 0.5], base);
          const a = dot3(q, u), b = dot3(q, v), c = dot3(q, w);
          const t = a / Ln;
          if (t < -0.03 || t > 1) continue;
          const hw = W * (0.62 + 0.38 * sstep(0, 0.3, t)) * Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2));
          if (hw < 0.5 || Math.abs(b) > hw) continue;
          const e = (b / hw) ** 2;
          const mid = 2.2 * e - 0.8 * (1 - t);
          const th = 0.9 + 0.9 * (1 - t);
          if (c < mid - th || c > mid + th * 0.6) continue;
          let col: number;
          const rim = Math.abs(b) > hw - 1 || t > 0.965;
          if (c > mid - th * 0.2) {
            col = C.pink;
            for (const vk of [-0.4, 0, 0.4]) {
              const vb = hw * vk * (0.35 + 0.65 * t) + Math.sin(t * 9 + vk * 5) * 0.5;
              if (Math.abs(b - vb) < 0.5 && t > 0.15 && t < 0.9) col = C.pinkD;
            }
            if (t < 0.14) col = mixc(C.white, C.pink, t / 0.14);
            if (rim) col = 0xf0c0a8;
          } else col = rim ? C.sandL : mixc(C.sand, C.pink, 0.18 + h01(i, j, k, 5) * 0.08);
          ear.set(i, j, k, col);
        }
    rig.mirror('ear_l', 'ear_r');
  }

  // ================================================================ tiny pink forepaws held at the chest
  {
    const SH = Pv(J.shoulder), EL = Pv(J.elbow), WR = Pv(J.wrist);
    const arm = rig.part('arm_l', 'chest', SH);
    tube(arm, [SH, EL, WR], [U(0.012), U(0.01), U(0.008)], (x, y, z) => (M(z) > 0.09 ? whiteF(x, y, z) : sandF(x, y, z)));
    blob(arm, [{ c: P(0.02, 0.122, 0.116), r: P(0.009, 0.01, 0.008) }], C.pink, { k: U(0.004) });
    for (let f = 0; f < 3; f++) arm.set(Math.floor(U(0.014 + f * 0.005)), Math.floor(U(0.112)), Math.floor(U(0.121)), C.claw);
    rig.mirror('arm_l', 'arm_r');
  }

  // ================================================================ kangaroo hind legs on long bristled feet
  {
    const HP = Pv(J.hip), KN = Pv(J.knee), AN = Pv(J.ankle), HE = Pv(J.heel), TO = Pv(J.toe);
    const thigh = rig.part('thigh_l', 'hips', HP);
    cap(thigh, HP, KN, U(0.032), U(0.019), (x, y, z) => (M(x) < 0.04 ? whiteF(x, y, z) : sandF(x, y, z)));
    const shin = rig.part('shin_l', 'thigh_l', KN);
    cap(shin, KN, AN, U(0.014), U(0.009), (x, y, z) => (M(x) < 0.05 ? whiteF(x, y, z) : sandF(x, y, z)));
    const foot = rig.part('foot_l', 'shin_l', AN);
    const footCol = (x: number, y: number, z: number) => (M(y) < 0.008 ? mixc(C.white, C.whiteD, h01(x, y, z, 9) * 0.6) : M(y) > 0.016 ? sandF(x, y, z) : whiteF(x, y, z));
    blob(foot, [
      { a: AN, b: HE, r0: U(0.01), r1: U(0.011) },
      { a: HE, b: TO, r0: U(0.011), r1: U(0.009) },
    ], footCol, { k: U(0.006), keep: (_x, y) => y >= 0 });
    for (let t = -1; t <= 1; t++) {
      const a = P(0.05 + t * 0.006, 0.008, 0.07), b = P(0.05 + t * 0.009, 0.006, 0.092 - Math.abs(t) * 0.006);
      cap(foot, a, b, U(0.0055), U(0.0045), footCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
      foot.set(Math.floor(b[0]), Math.max(0, Math.floor(b[1])), Math.floor(b[2] + 1), C.claw);
    }
    for (let s = 0; s < 16; s++) {
      const z = -0.075 + s * 0.0095;
      for (const dx of [-0.012, 0.012]) foot.set(Math.floor(U(0.05 + dx)), 0, Math.floor(U(z)), mixc(C.white, 0xffffff, 0.3));
    }
    rig.mirror('thigh_l', 'thigh_r');
    rig.mirror('shin_l', 'shin_r', 'thigh_r');
    rig.mirror('foot_l', 'foot_r', 'shin_r');
  }

  // ================================================================ long thin tail with the black-and-white flag
  {
    const tCol = (x: number, y: number, z: number) => (M(y) < 0.03 && Math.abs(M(x)) < 0.006 ? whiteF(x, y, z) : sandF(x, y, z));
    const t1 = rig.part('tail1', 'hips', Pv(J.t1));
    cap(t1, Pv(J.t1), Pv(J.t2), U(0.01), U(0.008), tCol);
    const t2 = rig.part('tail2', 'tail1', Pv(J.t2));
    cap(t2, Pv(J.t2), Pv(J.t3), U(0.008), U(0.0068), tCol);
    const t3 = rig.part('tail3', 'tail2', Pv(J.t3));
    tube(t3, [Pv(J.t3), Pv(J.t4), Pv(J.tip)], [U(0.0068), U(0.006), U(0.005)], tCol);
    const dir = norm3(sub3(J.tip, J.t4));
    const b0 = add3(J.t4, scl3(dir, 0.0)), b1 = add3(J.t4, scl3(dir, 0.04)), b2 = add3(J.tip, scl3(dir, 0.025));
    blob(t3, [
      { a: Pv(b0), b: Pv(b1), r0: U(0.008), r1: U(0.018) },
      { a: Pv(b1), b: Pv(b2), r0: U(0.02), r1: U(0.011) },
    ], (x, y, z) => {
      const along = dot3(sub3([M(x), M(y), M(z)], J.t4), dir);
      const black = along < 0.046;
      const base = black ? C.tuftBlack : C.tuftWhite;
      return h01(x, y, z, 31) < 0.12 ? mixc(base, black ? 0x3a3430 : 0xe8e2d8, 0.6) : base;
    }, { k: U(0.01), disp: (x, y, z) => (n01(x, y, z, 0.5, 41) - 0.5) * 1.1 });
    for (let h = 0; h < 9; h++) {
      const a = -1 + h / 4;
      const side = norm3(cross3(dir, [0, 1, 0]));
      const root = add3(add3(J.tip, scl3(dir, -0.01)), scl3(side, a * 0.012));
      const tip = add3(add3(root, scl3(dir, 0.03 - Math.abs(a) * 0.01)), scl3(side, a * 0.012));
      line(t3, [Pv(root), Pv(tip)], h % 3 === 0 ? 0xe8e2d8 : C.tuftWhite);
    }
  }

  for (const p of rig.parts) {
    if (!p.parent || p.name.startsWith('eye_')) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  rig.socket('head_top', 'head', P(0, 0.3, 0.08));
  rig.socket('nose', 'head', P(0, 0.22, 0.17));
  return rig.build({ kind: 'jerboa_pup', height: 0.4, headY: 0.24, radius: 0.08, eyeY: J.eye[1] });
}

const memo = memoBy(() => 'pup', buildPup);
/** the little ambient jerboa (≈ 0.4 m to the ear tips) */
export function jerboaPupRig(): RigSpec {
  return memo(undefined);
}

// ============================================================================ animation
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
type Tri = [number, number, number];
const NAMES = ['hips', 'chest', 'head', 'ear_l', 'ear_r', 'arm_l', 'arm_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail1', 'tail2', 'tail3'];
export type PupMode = 'sit' | 'upright' | 'wash' | 'hop' | 'crouch';

class Spr {
  x = 0;
  v = 0;
  constructor(public k = 120, public c = 9) {}
  step(target: number, dt: number) {
    this.v += (this.k * (target - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export class JerboaPupAnim {
  t = Math.random() * 10;
  mode: PupMode = 'sit';
  /** hop progress 0..1 (set by the owner while hopping) */
  hopK = 0;
  /** head yaw toward something (rad) */
  look = 0;
  private cur: Record<string, Tri> = {};
  private tgt: Record<string, Tri> = {};
  private ears = [new Spr(90, 7), new Spr(90, 7), new Spr(70, 6), new Spr(70, 6)];
  private tail = [new Spr(50, 6), new Spr(40, 5)];
  private sniff = 0;
  private nextSniff = 1;
  private swivel = [0, 0];
  private nextSwivel = 1;
  private lookCur = 0;
  private sq = new Spr(260, 13);
  private wasAir = false;
  private hipsY0: number;
  constructor(public rig: RigInstance) {
    for (const n of NAMES) {
      this.cur[n] = [0, 0, 0];
      this.tgt[n] = [0, 0, 0];
    }
    this.hipsY0 = rig.nodes['hips']?.position.y ?? 0;
  }
  private set(n: string, x: number, y = 0, z = 0) {
    this.tgt[n] = [x, y, z];
  }

  update(dt: number) {
    const t = (this.t += dt);
    for (const n of NAMES) this.tgt[n] = [0, 0, 0];
    let l = 12;
    let earBack = 0, earOut = 0, tailLift = 0, eyeSq = 1, crouch = 0;
    // sniffing: quick nose-bob bursts; ears swivel independently toward sounds
    this.nextSniff -= dt;
    if (this.nextSniff <= 0) {
      this.nextSniff = 0.8 + Math.random() * 2.5;
      this.sniff = 0.5;
    }
    this.sniff = Math.max(0, this.sniff - dt);
    this.nextSwivel -= dt;
    if (this.nextSwivel <= 0) {
      this.nextSwivel = 0.6 + Math.random() * 2;
      this.swivel = [(Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9];
    }
    const sniffBob = this.sniff > 0 ? Math.sin(t * 38) * 0.05 : 0;
    switch (this.mode) {
      case 'sit':
        this.set('chest', Math.sin(t * 2.2) * 0.02);
        this.set('head', sniffBob + Math.sin(t * 0.9) * 0.04, 0, Math.sin(t * 0.6) * 0.05);
        this.set('arm_l', -0.15);
        this.set('arm_r', -0.15);
        break;
      case 'upright':
        // up on the haunches like a periscope, paws tucked to the chest, ears tall
        this.set('hips', -0.35);
        this.set('chest', -0.45);
        this.set('head', 0.55 + sniffBob);
        this.set('thigh_l', 0.35);
        this.set('thigh_r', 0.35);
        this.set('shin_l', -0.2);
        this.set('shin_r', -0.2);
        this.set('arm_l', -0.6, 0, -0.1);
        this.set('arm_r', -0.6, 0, 0.1);
        earBack = -0.2;
        tailLift = -0.1;
        break;
      case 'wash': {
        // paws up to the face, rubbing in little circles, head tilting into it, eyes squeezed shut
        const rub = Math.sin(t * 15), tilt = Math.sin(t * 2.6);
        this.set('hips', -0.25);
        this.set('chest', -0.3);
        this.set('head', 0.38 + Math.abs(rub) * 0.06, 0, tilt * 0.22);
        this.set('arm_l', -1.35 + rub * 0.3, 0.2, -0.25 + Math.cos(t * 15) * 0.15);
        this.set('arm_r', -1.35 - rub * 0.3, -0.2, 0.25 - Math.cos(t * 15) * 0.15);
        this.set('thigh_l', 0.2);
        this.set('thigh_r', 0.2);
        earBack = 0.35 + tilt * 0.1;
        earOut = 0.15;
        eyeSq = 0.15;
        l = 18;
        break;
      }
      case 'hop': {
        const k = this.hopK;
        if (k < 0.18) {
          // crouch to spring
          const c = k / 0.18;
          this.set('hips', 0.25 * c);
          this.set('thigh_l', -0.3 * c);
          this.set('thigh_r', -0.3 * c);
          crouch = c;
        } else if (k < 0.78) {
          // kick: legs whip back straight, tail streams, ears trail
          const a = (k - 0.18) / 0.6;
          this.set('hips', 0.3 - a * 0.55);
          this.set('chest', -0.1);
          this.set('head', 0.15);
          const ext = a < 0.4 ? 1 : 1 - (a - 0.4) / 0.6;
          this.set('thigh_l', 1.0 * ext - 0.6 * (1 - ext));
          this.set('thigh_r', 1.0 * ext - 0.6 * (1 - ext));
          this.set('shin_l', -0.6 * ext);
          this.set('shin_r', -0.6 * ext);
          this.set('foot_l', 0.9 * ext);
          this.set('foot_r', 0.9 * ext);
          this.set('arm_l', -0.7);
          this.set('arm_r', -0.7);
          earBack = 0.7;
          tailLift = 0.45;
          l = 26;
        } else {
          const c = (k - 0.78) / 0.22;
          this.set('hips', -0.25 * (1 - c));
          this.set('thigh_l', -0.4 * (1 - c));
          this.set('thigh_r', -0.4 * (1 - c));
          earBack = 0.3 * (1 - c);
          l = 22;
        }
        const air = k > 0.2 && k < 0.8;
        if (this.wasAir && !air) this.sq.v -= 3.5;
        this.wasAir = air;
        break;
      }
      case 'crouch':
        this.set('hips', 0.2);
        this.set('chest', 0.25);
        this.set('head', -0.1);
        earBack = 1.0;
        tailLift = -0.3;
        crouch = 0.8;
        eyeSq = 1.1;
        break;
    }
    // head look
    this.lookCur = damp(this.lookCur, Math.max(-1, Math.min(1, this.look)), 5, dt);
    const th = this.tgt['head'];
    this.tgt['head'] = [th[0], th[1] + this.lookCur, th[2]];
    for (const n of NAMES) {
      const c = this.cur[n], g = this.tgt[n];
      for (let i = 0; i < 3; i++) c[i] = damp(c[i], g[i], l, dt);
    }
    const N = this.rig.nodes;
    for (const n of NAMES) {
      if (n.startsWith('ear') || n.startsWith('tail')) continue;
      const c = this.cur[n];
      N[n]?.rotation.set(c[0], c[1], c[2]);
    }
    // floppy ears (springs) + swivels
    for (let e = 0; e < 2; e++) {
      const s = e === 0 ? 1 : -1;
      const p = this.ears[e].step(-earBack, dt);
      const o = this.ears[e + 2].step(earOut + this.swivel[e] * 0.4, dt);
      N[e === 0 ? 'ear_l' : 'ear_r']?.rotation.set(p, this.swivel[e] * 0.6, -s * o);
    }
    // tail: lazy sway on the sand, lifts as a counterweight when hopping
    const tl = this.tail[0].step(tailLift, dt), ts = this.tail[1].step(Math.sin(t * 1.3) * 0.25, dt);
    N['tail1']?.rotation.set(-tl * 0.6, ts * 0.6, 0);
    N['tail2']?.rotation.set(-tl * 0.5, ts * 0.8, 0);
    N['tail3']?.rotation.set(-tl * 0.3 + Math.sin(t * 2.1) * 0.05, ts, 0);
    // eyes squeezed shut while washing, breathing, landing squash
    for (const n of ['eye_l', 'eye_r']) N[n]?.scale.set(1, damp(N[n]?.scale.y ?? 1, eyeSq, 14, dt), 1);
    const sq = this.sq.step(0, dt);
    const br = Math.sin(t * 5.5) * 0.015;
    if (N['hips']) N['hips'].position.y = this.hipsY0 - crouch * 0.02;
    this.rig.root.scale.set(1 - sq * 0.08 + br * 0.3, 1 + sq * 0.12 + br * 0.4, 1 - sq * 0.08);
  }
}
