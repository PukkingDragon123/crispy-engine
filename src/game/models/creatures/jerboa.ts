// The giant jerboa: a rare, curious, adorable desert hopper about 3 m tall to
// the ear tips. A round fluffy body leaning forward on kangaroo-long hind legs
// with snowshoe feet, tiny pink forepaws held at the chest, an enormous head
// with huge glossy modelled eyes ringed in cream, buck teeth, long whiskers,
// two vast veined ears (two segments each, so they flop), and a very long thin
// tail ending in a black-and-white feathered flag.
//
// RIG (faces +Z, LEFT = +X, origin on the ground between the feet, 1/48 m):
//   hips (root) → chest → neck → head → jaw, eye_l/eye_r, ear_l → ear_l2, ear_r → ear_r2
//   chest → arm_l → paw_l, arm_r → paw_r
//   hips → thigh_l → shin_l → foot_l (and _r); hips → tail1 → … → tail5
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, blob, ell, cap, tube, line, paint, exposed, splitInto, mixc, n01, h01, fur, wetEye, add3, sub3, scl3, dot3, cross3, norm3, sstep, clamp01, memoBy } from './ckit';

const VS = 1 / 48;
const U = (m: number) => m / VS;
const P = (x: number, y: number, z: number): V3 => [x / VS, y / VS, z / VS];
const Pv = (v: V3): V3 => [v[0] / VS, v[1] / VS, v[2] / VS];
/** voxel index -> metres at the cell centre */
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
  hips: [0, 1.0, -0.28] as V3,
  chest: [0, 1.3, -0.08] as V3,
  neck: [0, 1.66, 0.1] as V3,
  head: [0, 1.84, 0.15] as V3,
  jaw: [0, 1.86, 0.36] as V3,
  eye: [0.205, 2.04, 0.415] as V3,
  earBase: [0.15, 2.27, 0.08] as V3,
  shoulder: [0.18, 1.5, 0.17] as V3,
  elbow: [0.235, 1.41, 0.3] as V3,
  wrist: [0.135, 1.345, 0.4] as V3,
  hip: [0.24, 0.98, -0.3] as V3,
  knee: [0.29, 0.6, 0.06] as V3,
  ankle: [0.29, 0.19, -0.3] as V3,
  heel: [0.29, 0.075, -0.36] as V3,
  ball: [0.29, 0.058, 0.3] as V3,
  t1: [0, 0.86, -0.64] as V3,
  t2: [0, 0.6, -0.95] as V3,
  t3: [0, 0.32, -1.28] as V3,
  t4: [0, 0.14, -1.68] as V3,
  t5: [0, 0.11, -2.1] as V3,
  tMid: [0, 0.16, -2.36] as V3,
  tTip: [0, 0.34, -2.6] as V3,
};
const EYE_R = 0.108;
const EAR = { L: 0.86, W: 0.19, dir: norm3([0.42, 0.88, -0.2]), face: norm3([0.42, 0, 1]) };

/** ventral (belly-side) factor for a body point: 1 = belly/chest front, -1 = back */
function ventral(p: V3) {
  const a: V3 = [0, 1.0, -0.34], b: V3 = [0, 1.78, 0.14];
  const ab = sub3(b, a);
  const t = clamp01(dot3(sub3(p, a), ab) / dot3(ab, ab));
  const r = sub3(p, add3(a, scl3(ab, t)));
  const vdir = norm3([0, -0.52, 0.86]);
  return dot3(norm3(r), vdir);
}

function buildJerboa(): RigSpec {
  const rig = new CRig('giant_jerboa', VS);
  const sandF = fur(C.sand, C.sandL, C.sandD, 2.2, 7, [1, 2.4, 1.4]);
  const whiteF = fur(C.white, 0xffffff, C.whiteD, 2.2, 8, [1, 2.4, 1.4]);
  const coat = (i: number, j: number, k: number) => {
    const p: V3 = [M(i), M(j), M(k)];
    const v = ventral(p) + (n01(i, j, k, 0.14, 3) - 0.5) * 0.35;
    if (v > 0.32) return whiteF(i, j, k);
    if (v > 0.14) return mixc(sandF(i, j, k), C.white, 0.55);
    // darker guard-hair saddle along the spine
    return v < -0.75 ? mixc(sandF(i, j, k), C.sandD, 0.32) : sandF(i, j, k);
  };

  // ================================================================ body (one sculpt, split along the spine)
  const body = new VoxelModel('body');
  const bodyPrims: Prim[] = [
    { c: P(0, 1.0, -0.34), r: P(0.4, 0.42, 0.42) }, // rump
    { c: P(0, 1.2, -0.12), r: P(0.36, 0.4, 0.36) }, // belly
    { c: P(0, 1.46, 0.04), r: P(0.29, 0.31, 0.28) }, // chest
    { a: P(0, 1.58, 0.06), b: P(0, 1.86, 0.18), r0: U(0.24), r1: U(0.2) }, // scruff / neck
    { c: P(0.25, 0.93, -0.3), r: P(0.2, 0.32, 0.34) }, // haunches
    { c: P(-0.25, 0.93, -0.3), r: P(0.2, 0.32, 0.34) },
  ];
  blob(body, bodyPrims, coat, { k: U(0.14), disp: (x, y, z) => (n01(x, y, z, 0.2, 11) - 0.5) * 0.9, keep: (_x, y) => M(y) < 1.92 });
  const nA = norm3([0, 0.86, 0.51]), nB = norm3([0, 0.9, 0.44]);
  const side = (n: V3, o: V3) => (x: number, y: number, z: number) => dot3(sub3([M(x), M(y), M(z)], o), n);
  const sA = side(nA, J.chest), sB = side(nB, J.neck);
  const hips = rig.part('hips', undefined, Pv(J.hips));
  const upper = new VoxelModel('upper');
  splitInto(body, hips, upper, (x, y, z) => sA(x, y, z) >= 0, (x, y, z) => sA(x, y, z) >= -0.06);
  const chest = rig.part('chest', 'hips', Pv(J.chest));
  const neck = rig.part('neck', 'chest', Pv(J.neck));
  splitInto(upper, chest, neck, (x, y, z) => sB(x, y, z) >= 0, (x, y, z) => sB(x, y, z) >= -0.06);

  // ================================================================ head (+ jaw split along the mouth)
  const headMass = new VoxelModel('headMass');
  const headCol = (i: number, j: number, k: number) => {
    const X = M(i), Y = M(j), Z = M(k), ax = Math.abs(X);
    let c = sandF(i, j, k);
    // white cheeks, chin and muzzle sides; sandy crown and nose bridge
    const low = Y < 1.97 - Math.max(0, Z - 0.3) * 0.15;
    if ((low && Z > 0.12) || (Y < 1.9 && Z > 0.02)) c = whiteF(i, j, k);
    else if (Z > 0.4 && ax > 0.06 && Y < 2.02) c = mixc(c, C.white, 0.6);
    if (Y > 2.16) c = mixc(c, C.sandD, sstep(2.16, 2.32, Y) * 0.35);
    return c;
  };
  const headPrims: Prim[] = [
    { c: P(0, 2.02, 0.2), r: P(0.34, 0.31, 0.33) }, // cranium
    { c: P(0.16, 1.9, 0.32), r: P(0.2, 0.17, 0.19) }, // fluffy cheeks
    { c: P(-0.16, 1.9, 0.32), r: P(0.2, 0.17, 0.19) },
    { c: P(0, 1.94, 0.47), r: P(0.155, 0.135, 0.15) }, // snout
    { c: P(0, 2.12, 0.33), r: P(0.21, 0.13, 0.14) }, // forehead
    { a: P(0, 1.83, 0.36), b: P(0, 1.845, 0.53), r0: U(0.085), r1: U(0.06) }, // chin
    { a: P(0, 1.83, 0.1), b: P(0, 1.9, 0.22), r0: U(0.2), r1: U(0.19) }, // neck join
  ];
  blob(headMass, headPrims, headCol, { k: U(0.08), disp: (x, y, z) => (n01(x, y, z, 0.26, 21) - 0.5) * 0.8 });
  const head = rig.part('head', 'neck', Pv(J.head));
  const jaw = rig.part('jaw', 'head', Pv(J.jaw));
  splitInto(headMass, head, jaw, (_x, y, z) => M(y) < 1.868 && M(y) > 1.74 && M(z) > 0.33);
  // mouth line + a hint of pink inside
  const empty = (x: number, y: number, z: number) => !head.has(x, y, z) && !jaw.has(x, y, z);
  jaw.forEach((x, y, z) => {
    if (!jaw.has(x, y + 1, z)) jaw.set(x, y, z, empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1) ? 0x6a4038 : 0xc86a6e);
  });
  // pink wet nose with a dark nostril line, buck teeth below it
  ell(head, P(0, 1.968, 0.6), P(0.07, 0.056, 0.048), (x, y) => (M(y) < 1.95 ? C.pinkD : C.nose), { fl: VF.METAL });
  {
    const fz = (x: number, y: number) => {
      let z = 60;
      while (z > 0 && !head.has(x, y, z)) z--;
      return z;
    };
    const ny = Math.floor(U(1.955));
    for (const x of [-2, 1]) {
      const z = fz(x, ny);
      if (z > 0) head.set(x, ny, z, 0x8a4448);
    }
    const ty = Math.floor(U(1.875));
    for (const x of [-1, 0]) {
      const z = fz(x, ty + 2);
      for (let y = ty - 1; y <= ty; y++) head.set(x, y, z, y === ty - 1 ? 0xfaf6ee : 0xf2ead8);
    }
  }
  // huge glossy eyes in cream rings
  const eyeC = Pv(J.eye);
  for (const s of [1, -1]) {
    const ec = s > 0 ? eyeC : mirX(eyeC);
    paint(head, (x, y, z) => {
      const d = Math.hypot(x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]);
      return d < U(EYE_R) * 1.5 && exposed(head, x, y, z);
    }, C.ring);
    ell(head, ec, [U(EYE_R) * 1.03, U(EYE_R) * 1.03, U(EYE_R) * 1.03], 0, { carve: true });
  }
  const eyeL = rig.part('eye_l', 'head', eyeC);
  wetEye(eyeL, eyeC, U(EYE_R), [0.6, 0.06, 0.8], { sclera: 0x170e0a, iris: 0x3c2414, irisEdge: 0x24160c, pupil: 0x050303, irisR: 0.92, pupilR: 0.62, bigGlint: 2 });
  rig.mirror('eye_l', 'eye_r');
  // long whiskers fanning from the muzzle (dark roots, white tips)
  for (let w = 0; w < 4; w++) {
    const root: V3 = [0.1, 1.93 + w * 0.018, 0.55 - w * 0.012];
    const dir = norm3([1, 0.12 - w * 0.09, -0.32 + w * 0.05]);
    const len = 0.44 - Math.abs(w - 1.5) * 0.04;
    const mid = add3(add3(root, scl3(dir, len * 0.5)), [0, -0.02, 0]);
    const tip = add3(add3(root, scl3(dir, len)), [0, -0.07, 0]);
    for (const s of [1, -1]) {
      const pts = [root, mid, tip].map((p) => Pv(s > 0 ? p : mirX(p)));
      line(head, pts, (x, y, z) => {
        const d = Math.hypot(x + 0.5 - pts[0][0], y + 0.5 - pts[0][1], z + 0.5 - pts[0][2]) / U(len);
        return d < 0.35 ? 0x5e5048 : d < 0.7 ? 0xb8aea4 : 0xf4f0ea;
      });
    }
  }

  // ================================================================ enormous veined ears (two segments each)
  {
    const base = Pv(J.earBase);
    const u = EAR.dir;
    const w = norm3(sub3(EAR.face, scl3(u, dot3(EAR.face, u))));
    const v = cross3(u, w);
    const L = U(EAR.L), W = U(EAR.W);
    const ear1 = rig.part('ear_l', 'head', base);
    const pivot2 = add3(base, scl3(u, L * 0.52));
    const ear2 = rig.part('ear_l2', 'ear_l', pivot2);
    const R = L + 2;
    for (let i = Math.floor(base[0] - R); i <= Math.ceil(base[0] + R); i++)
      for (let j = Math.floor(base[1] - 4); j <= Math.ceil(base[1] + R); j++)
        for (let k = Math.floor(base[2] - R); k <= Math.ceil(base[2] + R); k++) {
          const q = sub3([i + 0.5, j + 0.5, k + 0.5], base);
          const a = dot3(q, u), b = dot3(q, v), c = dot3(q, w);
          const t = a / L;
          if (t < -0.02 || t > 1) continue;
          const hw = W * (0.6 + 0.4 * sstep(0, 0.3, t)) * Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2));
          if (hw < 0.5 || Math.abs(b) > hw) continue;
          const e = (b / hw) ** 2;
          const mid = 2.6 * e - 1.2 * (1 - t); // cupped: edges curl forward
          const th = 1.1 + 1.3 * (1 - t);
          if (c < mid - th || c > mid + th * 0.6) continue;
          let col: number;
          const rim = Math.abs(b) > hw - 1.1 || t > 0.965;
          if (c > mid - th * 0.2) {
            // inner face: warm pink with darker branching veins, pale fur near the base
            col = C.pink;
            for (const vk of [-0.42, 0, 0.42]) {
              const vb = hw * vk * (0.35 + 0.65 * t) + Math.sin(t * 9 + vk * 5) * 0.6;
              if (Math.abs(b - vb) < 0.55 && t > 0.12 && t < 0.92) col = C.pinkD;
            }
            if (t < 0.14) col = mixc(C.white, C.pink, t / 0.14);
            if (rim) col = 0xf0c0a8;
          } else col = rim ? C.sandL : mixc(C.sand, C.pink, 0.18 + h01(i, j, k, 5) * 0.08);
          (t < 0.52 ? ear1 : ear2).set(i, j, k, col);
        }
    rig.mirror('ear_l', 'ear_r');
    rig.mirror('ear_l2', 'ear_r2', 'ear_r');
  }

  // ================================================================ tiny forelimbs held at the chest
  {
    const SH = Pv(J.shoulder), EL = Pv(J.elbow), WR = Pv(J.wrist);
    const arm = rig.part('arm_l', 'chest', SH);
    tube(arm, [SH, EL, WR], [U(0.068), U(0.054), U(0.043)], (x, y, z) => (M(y) < 1.42 || M(z) > 0.33 ? whiteF(x, y, z) : sandF(x, y, z)));
    const paw = rig.part('paw_l', 'arm_l', WR);
    blob(paw, [{ c: P(0.115, 1.31, 0.428), r: P(0.05, 0.056, 0.044) }, { a: Pv(J.wrist), b: P(0.118, 1.315, 0.425), r0: U(0.042), r1: U(0.044) }], C.pink, { k: U(0.02) });
    for (let f = 0; f < 3; f++) {
      const fx = 0.09 + f * 0.026;
      cap(paw, P(fx, 1.285, 0.448), P(fx - 0.004, 1.245, 0.46), U(0.017), U(0.014), C.pink);
      paw.set(Math.floor(U(fx - 0.005)), Math.floor(U(1.232)), Math.floor(U(0.462)), C.claw);
    }
    rig.mirror('arm_l', 'arm_r');
    rig.mirror('paw_l', 'paw_r', 'arm_r');
  }

  // ================================================================ kangaroo-long hind legs with snowshoe feet
  {
    const HP = Pv(J.hip), KN = Pv(J.knee), AN = Pv(J.ankle), HE = Pv(J.heel), BA = Pv(J.ball);
    const legCol = (x: number, y: number, z: number) => {
      const X = M(x), Y = M(y), Z = M(z);
      if (X < 0.2) return whiteF(x, y, z); // inner leg
      if (Math.abs(Y - 0.86 + Z * 0.25) < 0.035 && X > 0.3) return C.white; // the white hip stripe
      return sandF(x, y, z);
    };
    const thigh = rig.part('thigh_l', 'hips', HP);
    cap(thigh, HP, KN, U(0.2), U(0.11), legCol);
    const shin = rig.part('shin_l', 'thigh_l', KN);
    cap(shin, KN, AN, U(0.1), U(0.06), (x, y, z) => (M(z) > -0.1 + (M(y) - 0.6) * 0.0 && M(x) < 0.27 ? whiteF(x, y, z) : sandF(x, y, z)));
    const foot = rig.part('foot_l', 'shin_l', AN);
    const footCol = (x: number, y: number, z: number) => (M(y) < 0.05 ? mixc(C.white, C.whiteD, h01(x, y, z, 9) * 0.6) : M(y) > 0.1 ? sandF(x, y, z) : whiteF(x, y, z));
    blob(foot, [
      { a: AN, b: HE, r0: U(0.062), r1: U(0.07) },
      { a: HE, b: BA, r0: U(0.074), r1: U(0.06) },
    ], footCol, { k: U(0.04), keep: (_x, y) => y >= 0 });
    for (let t = -1; t <= 1; t++) {
      const a = P(0.29 + t * 0.04, 0.05, 0.3), b = P(0.29 + t * 0.06, 0.036, 0.47 - Math.abs(t) * 0.04);
      cap(foot, a, b, U(0.036), U(0.03), footCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
      foot.set(Math.floor(b[0]), Math.max(0, Math.floor(b[1]) - 0), Math.floor(b[2] + U(0.03)), C.claw);
    }
    // stiff pale bristles along the sole edges (the jerboa's snowshoes)
    for (let s = 0; s < 14; s++) {
      const z = -0.32 + s * 0.05;
      for (const dx of [-0.075, 0.075]) foot.set(Math.floor(U(0.29 + dx)), 0, Math.floor(U(z)), mixc(C.white, 0xffffff, 0.3));
    }
    rig.mirror('thigh_l', 'thigh_r');
    rig.mirror('shin_l', 'shin_r', 'thigh_r');
    rig.mirror('foot_l', 'foot_r', 'shin_r');
  }

  // ================================================================ very long thin tail with the black-and-white flag
  {
    const tCol = (x: number, y: number, z: number) => (M(y) < (M(z) < -1.5 ? 0.11 : 0.3) - 0 && Math.abs(M(x)) < 0.05 ? whiteF(x, y, z) : sandF(x, y, z));
    const segs: [string, string, V3, V3, number, number][] = [
      ['tail1', 'hips', J.t1, J.t2, 0.075, 0.064],
      ['tail2', 'tail1', J.t2, J.t3, 0.064, 0.054],
      ['tail3', 'tail2', J.t3, J.t4, 0.054, 0.046],
      ['tail4', 'tail3', J.t4, J.t5, 0.046, 0.04],
    ];
    for (const [n, par, a, b, r0, r1] of segs) {
      const m = rig.part(n, par, Pv(a));
      cap(m, Pv(a), Pv(b), U(r0), U(r1), tCol);
    }
    const t5 = rig.part('tail5', 'tail4', Pv(J.t5));
    tube(t5, [Pv(J.t5), Pv(J.tMid), Pv(J.tTip)], [U(0.04), U(0.034), U(0.026)], tCol);
    // the flag: a flattened feathery brush, black band then a bright white tip
    const dir = norm3(sub3(J.tTip, J.tMid));
    const rotY = Math.atan2(dir[0], dir[2]);
    const pitch = -Math.asin(dir[1]);
    blob(t5, [
      { c: P(0, 0.19, -2.31), r: P(0.11, 0.07, 0.17), rot: [pitch * 0.6, rotY, 0] },
      { c: P(0, 0.3, -2.52), r: P(0.13, 0.075, 0.2), rot: [pitch, rotY, 0] },
    ], (x, y, z) => {
      const along = dot3(sub3([M(x), M(y), M(z)], J.tMid), dir);
      const black = along < 0.07;
      const base = black ? C.tuftBlack : C.tuftWhite;
      return h01(x, y, z, 31) < 0.12 ? mixc(base, black ? 0x3a3430 : 0xe8e2d8, 0.6) : base;
    }, { k: U(0.06), disp: (x, y, z) => (n01(x, y, z, 0.5, 41) - 0.5) * 1.2 });
    // feathered hair tips fanning off the flag
    for (let h = 0; h < 9; h++) {
      const a = -1 + h / 4;
      const root = add3(J.tMid, add3(scl3(dir, 0.16 + Math.abs(a) * 0.02), [a * 0.1, 0.02, 0]));
      const tip = add3(root, add3(scl3(dir, 0.14), [a * 0.08, 0.03 * (1 - Math.abs(a)), 0]));
      line(t5, [Pv(root), Pv(tip)], h % 3 === 0 ? 0xe8e2d8 : C.tuftWhite);
    }
  }

  // overlapping parts never share an exposed cell (no coplanar z-fighting at the joints)
  for (const p of rig.parts) {
    if (!p.parent) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }

  rig.socket('mouth', 'head', P(0, 1.88, 0.6));
  rig.socket('head_top', 'head', P(0, 2.33, 0.2));
  rig.socket('paw_l', 'paw_l', P(0.115, 1.29, 0.45));
  rig.socket('paw_r', 'paw_r', P(-0.115, 1.29, 0.45));
  rig.socket('chest', 'chest', P(0, 1.42, 0.32));
  return rig.build({ kind: 'jerboa', height: 3.0, headY: 2.02, hipY: 1.0, radius: 0.6, eyeY: J.eye[1] });
}

const buildMemo = memoBy(() => 'jerboa', buildJerboa);
/** the giant jerboa (≈ 2.35 m to the crown, ≈ 3.0 m to the ear tips) */
export function giantJerboaRig(): RigSpec {
  return buildMemo(undefined);
}
