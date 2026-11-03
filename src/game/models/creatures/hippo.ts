// The sand hippo: a huge, heavy desert-adapted hippopotamus (≈ 4 m long, 1.6 m
// at the shoulder) and its round, pink-cheeked calf.
//
// Sculpted as one organic mass (smooth unions, never bare primitives): a deep
// sagging barrel on short pillar legs; a massive head with eyes, ears and slit
// nostrils raised on top so it can lie buried in a dune with only those showing;
// a broad bulbous muzzle over a heavy lower jaw that gapes wide (tongue bowl,
// gums, palate ridges, molars), big curved lower tusks resting in grooves of the
// upper lip, forward pegs of incisors; tough sandy hide with neck creases, scars,
// mottling, sun-bleached back and wind-scoured patches scratched by blown sand;
// splayed four-toed feet on wide padded "snowshoe" soles; a short bristled tail.
// Modelled glossy eyes under real lids (they blink); tiny cupped ears that twirl.
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the belly):
//   body (root) → head → jaw, eye_l/eye_r, lid_l/lid_r, ear_l/ear_r
//   body → leg_fl → shin_fl (and fr), body → leg_bl → shin_bl (and br), body → tail
// Adult 1/32 m. The calf uses the same design re-proportioned (bigger head and
// eyes, chubby short body, stubby legs, tusk buds) at 1/70 m.
// `HippoAnim` drives every pose: walk / trot / gallop gaits, wallowing and
// burrowing (sinking into the sand), the yawn display, the bite, rage, squash
// on a bounce, blinks, ear twirls, tail wags, and the calf's carried / thrown /
// dizzy poses.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, blob, ell, cap, tube, line, paint, exposed, splitInto, mixc, n01, h01, wetEye, add3, sub3, scl3, dot3, norm3, sstep, invXYZ, memoBy } from './ckit';

// ============================================================================ palette
const HIDE = {
  base: 0xae8266,
  light: 0xc9a07e,
  dark: 0x8a634e,
  belly: 0xd09a88,
  pink: 0xdca08e,
  scour: 0xdcc6a0,
  scratch: 0xb2906e,
  dust: 0xd5ba8c,
  crease: 0x664434,
  pore: 0x5a3c30,
  scar: 0xe2b4a2,
  lip: 0x683e34,
  gum: 0xc06a66,
  tongue: 0xd6857c,
  palate: 0xae5a58,
  ridge: 0x8c4446,
  ivory: 0xefe2c2,
  ivoryBase: 0xc4a980,
  ivoryTip: 0xfbf4e2,
  molar: 0xe2d4b2,
  nail: 0x4a3c34,
  pad: 0x56402f,
  bristle: 0xe6d8c2,
  lash: 0x3a2620,
};

// ============================================================================ design (adult metres)
type Look = { baby: boolean; dv: number; s: number; bw: number; bl: number; drop: number; hk: number; lift: number; eyeK: number; lr: number };
const ADULT: Look = { baby: false, dv: 1 / 32, s: 1, bw: 1, bl: 1, drop: 0, hk: 1, lift: 0, eyeK: 1, lr: 1 };
const BABY: Look = { baby: true, dv: 1 / 24, s: 0.34, bw: 1.12, bl: 0.8, drop: 0.13, hk: 1.32, lift: 0.07, eyeK: 1.32, lr: 1.12 };

const J = {
  bodyC: [0, 0.98, -0.05] as V3,
  neck: [0, 1.12, 1.22] as V3,
  hinge: [0, 1.0, 1.42] as V3,
  turret: [0.3, 1.46, 1.6] as V3,
  ear: [0.235, 1.56, 1.37] as V3,
  shoulder: [0.5, 0.92, 0.72] as V3,
  elbow: [0.53, 0.5, 0.79] as V3,
  fAnkle: [0.54, 0.15, 0.82] as V3,
  fFoot: [0.54, 0, 0.85] as V3,
  hip: [0.48, 0.95, -0.98] as V3,
  knee: [0.52, 0.52, -0.88] as V3,
  bAnkle: [0.53, 0.15, -1.0] as V3,
  bFoot: [0.53, 0, -0.98] as V3,
  tail0: [0, 1.28, -1.42] as V3,
  tail1: [0, 1.11, -1.56] as V3,
  tail2: [0, 0.94, -1.61] as V3,
};
const EYE_R = 0.072;
const mir = (v: V3): V3 => [-v[0], v[1], v[2]];
const mouthY = (q: V3) => 0.99 + 0.06 * sstep(1.72, 1.45, q[2]);

function buildHippo(L: Look): RigSpec {
  const dv = L.dv;
  const baby = L.baby;
  const U = (m: number) => m / dv;
  const V = (p: V3): V3 => [p[0] / dv, p[1] / dv, p[2] / dv];
  const Mv = (x: number, y: number, z: number): V3 => [(x + 0.5) * dv, (y + 0.5) * dv, (z + 0.5) * dv];
  // ---- design transforms (identity for the adult; the calf is re-proportioned)
  const legK = 1 - L.drop / 0.95;
  const B = (p: V3): V3 => [p[0] * L.bw, p[1] - L.drop, p[2] * L.bl];
  const NB = B(J.neck);
  const H = (p: V3): V3 => [NB[0] + (p[0] - J.neck[0]) * L.hk, NB[1] + L.lift + (p[1] - J.neck[1]) * L.hk, NB[2] + (p[2] - J.neck[2]) * L.hk];
  const G = (p: V3): V3 => [p[0] * L.bw, p[1] * legK, p[2] * L.bl];
  const invB = (p: V3): V3 => [p[0] / L.bw, p[1] + L.drop, p[2] / L.bl];
  const invH = (p: V3): V3 => [J.neck[0] + (p[0] - NB[0]) / L.hk, J.neck[1] + (p[1] - NB[1] - L.lift) / L.hk, J.neck[2] + (p[2] - NB[2]) / L.hk];
  const invG = (p: V3): V3 => [p[0] / L.bw, p[1] / legK, p[2] / L.bl];
  const EB = (c: V3, r: V3): Prim => ({ c: V(B(c)), r: [U(r[0] * L.bw), U(r[1]), U(r[2] * L.bl)] });
  const CB = (a: V3, b: V3, r0: number, r1: number): Prim => ({ a: V(B(a)), b: V(B(b)), r0: U(r0 * L.bw), r1: U(r1 * L.bw) });
  const EH = (c: V3, r: V3): Prim => ({ c: V(H(c)), r: [U(r[0] * L.hk), U(r[1] * L.hk), U(r[2] * L.hk)] });
  const CH = (a: V3, b: V3, r0: number, r1: number): Prim => ({ a: V(H(a)), b: V(H(b)), r0: U(r0 * L.hk), r1: U(r1 * L.hk) });
  const both = (f: (s: number) => void) => [1, -1].forEach(f);
  const sx = (v: V3, s: number): V3 => (s > 0 ? v : mir(v));

  const rig = new CRig(baby ? 'baby_hippo' : 'sand_hippo', dv * L.s);
  const babyPink = (c: number) => (baby ? mixc(c, HIDE.pink, 0.32) : c);

  // ---------------------------------------------------------------- hide
  /** scars on the flanks of an old bull (segments, adult metres) */
  const SCARS: [V3, V3][] = baby ? [] : [
    [[0.77, 1.12, 0.18], [0.7, 0.86, 0.5]],
    [[-0.75, 1.2, -0.52], [-0.77, 0.96, -0.24]],
    [[0.42, 1.5, -0.34], [0.58, 1.34, -0.02]],
    [[-0.5, 1.42, 0.5], [-0.66, 1.2, 0.68]],
  ];
  const segD = (p: V3, a: V3, b: V3) => {
    const ab = sub3(b, a);
    const t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / dot3(ab, ab)));
    return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
  };
  /** the hide at an adult-space point q (i, j, k = voxel for per-voxel variation) */
  const skin = (q: V3, i: number, j: number, k: number, vy: number) => {
    let c = HIDE.base;
    const m = n01(q[0], q[1], q[2], 2.6, 3);
    if (m > 0.63) c = mixc(c, HIDE.dark, 0.32);
    else if (m < 0.35) c = mixc(c, HIDE.light, 0.38);
    if (vy > 0.45) c = mixc(c, HIDE.light, sstep(0.45, 0.95, vy) * 0.45); // sun-bleached back
    if (vy < -0.38) c = mixc(c, HIDE.belly, sstep(-0.38, -0.78, vy) * 0.75); // soft pink belly
    // wind-scoured patches: pale, chalky, scratched along the wind by blown sand
    if (!baby && vy > -0.15) {
      const pm = n01(q[0] * 1.3, q[1] * 1.7, q[2], 2.1, 17);
      if (pm > 0.635) {
        const g = (q[2] + q[1] * 0.45) * 21 + n01(q[0], q[1], q[2], 9, 5) * 2.4;
        c = g - Math.floor(g) < 0.22 ? HIDE.scratch : mixc(HIDE.scour, HIDE.light, h01(i, j, k, 4) * 0.35);
      } else if (pm > 0.605) c = mixc(c, HIDE.dark, 0.28);
    }
    for (const [a, b] of SCARS) {
      const d = segD(q, a, b);
      if (d < 0.022) c = HIDE.scar;
      else if (d < 0.045) c = mixc(c, HIDE.dark, 0.25);
    }
    if (q[1] < 0.5) c = mixc(c, HIDE.dust, sstep(0.5, 0.18, q[1]) * 0.55); // caked sand
    if (h01(i, j, k, 9) < 0.028) c = mixc(c, HIDE.pore, 0.4);
    return babyPink(c);
  };
  const bodyCol = (i: number, j: number, k: number) => {
    const q = invB(Mv(i, j, k));
    return skin(q, i, j, k, (q[1] - 0.98) / 0.58);
  };

  // ================================================================ body: deep sagging barrel
  const body = rig.part('body', undefined, V(B(J.bodyC)));
  const bodyPrims: Prim[] = [
    EB([0, 0.99, -0.12], [0.78, 0.56, 1.32]), // barrel
    EB([0, 1.05, 0.6], [0.74, 0.55, 0.66]), // chest / shoulders
    EB([0, 1.02, -0.92], [0.76, 0.56, 0.62]), // rump
    EB([0, 0.75, -0.05], [0.66, 0.36, 1.05]), // sagging belly
    CB([0, 1.02, 0.9], [0, 1.1, 1.32], 0.52, 0.46), // thick neck
    EB([0.5, 0.86, 0.72], [0.27, 0.42, 0.34]), // shoulder bulges
    EB([-0.5, 0.86, 0.72], [0.27, 0.42, 0.34]),
    EB([0.48, 0.88, -0.96], [0.3, 0.44, 0.42]), // haunches
    EB([-0.48, 0.88, -0.96], [0.3, 0.44, 0.42]),
    EB([0, 1.5, -0.25], [0.42, 0.12, 0.6]), // a low ridge along the spine
  ];
  const fdisp = dv / 0.15;
  blob(body, bodyPrims, bodyCol, { k: U(0.16), disp: (x, y, z) => (n01(x, y, z, fdisp, 11) - 0.5) * 0.9, keep: (_x, y) => y >= 0 });
  // thick skin creases ringing the neck
  {
    const creaseZ = (q: V3, c: number) => 1.02 + c * 0.12 + (1.2 - q[1]) * 0.12 + Math.sin(q[0] * 4 + c) * 0.02;
    const del: V3[] = [];
    body.forEach((x, y, z) => {
      if (!exposed(body, x, y, z)) return;
      const q = invB(Mv(x, y, z));
      if (q[1] < 0.6 || q[2] < 0.9 || q[2] > 1.42) return;
      for (let c = 0; c < 3; c++) if (Math.abs(q[2] - creaseZ(q, c)) < dv * 0.55) {
        del.push([x, y, z]);
        break;
      }
    });
    for (const [x, y, z] of del) body.del(x, y, z);
    paint(body, (x, y, z) => {
      if (!exposed(body, x, y, z)) return false;
      const q = invB(Mv(x, y, z));
      if (q[1] < 0.6 || q[2] < 0.88 || q[2] > 1.45) return false;
      for (let c = 0; c < 3; c++) if (Math.abs(q[2] - creaseZ(q, c)) < dv * 1.6) return true;
      return false;
    }, (x, y, z) => mixc(bodyCol(x, y, z), HIDE.crease, 0.5));
  }

  // ================================================================ head (+ jaw split along the mouth)
  const headCol = (i: number, j: number, k: number) => {
    const q = invH(Mv(i, j, k));
    let c = HIDE.base;
    const m = n01(q[0], q[1], q[2], 3.2, 23);
    if (m > 0.64) c = mixc(c, HIDE.dark, 0.3);
    else if (m < 0.34) c = mixc(c, HIDE.light, 0.35);
    if (q[1] > 1.38) c = mixc(c, HIDE.light, sstep(1.38, 1.62, q[1]) * 0.4);
    // pink skin round the eyes, the ears and the cheeks; a pink-lipped mouth
    const de = Math.min(Math.hypot(q[0] - 0.33, q[1] - 1.48, q[2] - 1.66), Math.hypot(q[0] + 0.33, q[1] - 1.48, q[2] - 1.66));
    if (de < 0.2) c = mixc(c, HIDE.pink, sstep(0.2, 0.1, de) * 0.6);
    if (q[1] < 1.12 && Math.abs(q[0]) > 0.3) c = mixc(c, HIDE.pink, sstep(1.12, 0.92, q[1]) * 0.45);
    if (Math.abs(q[1] - mouthY(q)) < 0.06 && q[2] > 1.5) c = mixc(c, HIDE.pink, 0.35);
    // freckled muzzle (bristle pores), dusty chin
    if (q[2] > 2.0 && h01(i, j, k, 13) < 0.09) c = mixc(c, HIDE.pore, 0.55);
    if (q[1] < 0.7) c = mixc(c, HIDE.dust, 0.3);
    if (h01(i, j, k, 9) < 0.02) c = mixc(c, HIDE.pore, 0.35);
    return babyPink(c);
  };
  const headPrims: Prim[] = [
    EH([0, 1.3, 1.54], [0.44, 0.33, 0.4]), // cranium
    EH([0.34, 1.08, 1.55], [0.25, 0.3, 0.32]), // jowls
    EH([-0.34, 1.08, 1.55], [0.25, 0.3, 0.32]),
    EH([0, 1.16, 2.0], [0.4, 0.24, 0.44]), // long snout
    EH([0.25, 1.03, 2.1], [0.3, 0.25, 0.34]), // bulbous lip lobes over the tusk roots
    EH([-0.25, 1.03, 2.1], [0.3, 0.25, 0.34]),
    EH([0.14, 1.27, 2.27], [0.1, 0.075, 0.095]), // raised nostrils
    EH([-0.14, 1.27, 2.27], [0.1, 0.075, 0.095]),
    EH(J.turret, [0.135, 0.12, 0.135]), // periscope eye turrets
    EH(mir(J.turret), [0.135, 0.12, 0.135]),
    EH([0, 1.5, 1.5], [0.26, 0.1, 0.18]), // brow
    EH([0.235, 1.53, 1.37], [0.09, 0.08, 0.08]), // ear mounds
    EH([-0.235, 1.53, 1.37], [0.09, 0.08, 0.08]),
    CH([0, 0.93, 1.48], [0, 0.86, 2.14], 0.4, 0.34), // heavy lower jaw
    EH([0.24, 0.87, 2.04], [0.3, 0.2, 0.36]), // chin lobes
    EH([-0.24, 0.87, 2.04], [0.3, 0.2, 0.36]),
    CH([0, 1.1, 1.3], [0, 1.12, 1.45], 0.46, 0.46), // neck join (stays inside the body's neck)
  ];
  const headMass = new VoxelModel('headMass');
  blob(headMass, headPrims, headCol, { k: U(0.09 * L.hk), disp: (x, y, z) => (n01(x, y, z, fdisp * 1.3, 21) - 0.5) * 0.8, keep: (_x, y) => y >= 0 });
  const head = rig.part('head', 'body', V(H(J.neck)));
  const jaw = rig.part('jaw', 'head', V(H(J.hinge)));
  splitInto(headMass, head, jaw, (x, y, z) => {
    const q = invH(Mv(x, y, z));
    return q[2] > 1.36 && q[1] < mouthY(q);
  });
  const hz = V(H(J.hinge))[2];
  /** a cell with an empty horizontal neighbour within R (rim of a cut face) */
  const rimOf = (m: VoxelModel, x: number, y: number, z: number, R: number) => {
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (!m.has(x + dx, y, z + dz)) return true;
    return false;
  };
  // ---- lower tusks: big curved ivory, resting in grooves of the upper lip (carved), rooted in the jaw
  const TUSK: V3[] = [[0.36, 0.9, 2.06], [0.43, 1.08, 2.16], [0.47, 1.25, 2.13], [0.46, 1.38, 2.03]];
  const TUSK_R = [0.08, 0.068, 0.05, 0.022];
  if (!baby) {
    both((s) => {
      const pts = TUSK.map((p) => V(H(sx(p, s))));
      tube(head, pts, TUSK_R.map((r) => U(r * L.hk) + 1.1), 0, { carve: true });
      const y0 = pts[0][1], y1 = pts[3][1];
      tube(jaw, pts, TUSK_R.map((r) => U(r * L.hk)), (x, y) => {
        const t = (y + 0.5 - y0) / (y1 - y0);
        let c = t < 0.22 ? HIDE.ivoryBase : t > 0.82 ? HIDE.ivoryTip : mixc(HIDE.ivory, HIDE.ivoryBase, (0.5 - t) * 0.4);
        if (t > 0.2 && t < 0.8 && Math.floor(y * 0.75) % 3 === 0) c = mixc(c, HIDE.ivoryBase, 0.35); // growth lines
        return c;
      });
    });
    // forward pegs of lower incisors
    both((s) => {
      cap(jaw, V(H(sx([0.07, 0.93, 2.36], s))), V(H(sx([0.09, 0.955, 2.56], s))), U(0.036), U(0.028), (_x, _y, z) => (z * dv > H([0, 0, 2.5])[2] ? HIDE.ivoryTip : HIDE.ivory));
      cap(jaw, V(H(sx([0.19, 0.93, 2.32], s))), V(H(sx([0.24, 0.955, 2.5], s))), U(0.033), U(0.025), HIDE.ivory);
    });
  } else {
    // the calf's tusk buds and milk incisors
    both((s) => {
      ell(jaw, V(H(sx([0.36, 0.97, 2.08], s))), [U(0.05 * L.hk), U(0.06 * L.hk), U(0.05 * L.hk)], HIDE.ivoryTip);
      ell(jaw, V(H(sx([0.1, 0.95, 2.42], s))), [U(0.035 * L.hk), U(0.03 * L.hk), U(0.04 * L.hk)], HIDE.ivoryTip);
    });
  }
  // ---- the mouth: lip line, gums, a tongue bowl carved into the jaw, molars; palate ridges above
  {
    const tops: V3[] = [];
    jaw.forEach((x, y, z, c) => {
      if (!jaw.has(x, y + 1, z) && z > hz + 1 && c !== HIDE.ivory && c !== HIDE.ivoryBase && c !== HIDE.ivoryTip) tops.push([x, y, z]);
    });
    const bowl: V3[] = [];
    for (const [x, y, z] of tops) {
      if (!rimOf(jaw, x, y, z, 3)) bowl.push([x, y, z]);
      else jaw.set(x, y, z, rimOf(jaw, x, y, z, 1) ? HIDE.lip : HIDE.gum);
    }
    for (const [x, y, z] of bowl) {
      jaw.del(x, y, z);
      jaw.del(x, y - 1, z);
    }
    for (const [x, y, z] of bowl) {
      const q = invH(Mv(x, y - 2, z));
      if (!jaw.has(x, y - 2, z)) continue;
      const tongue = Math.abs(q[0]) < 0.2 && q[2] > 1.55;
      const c = tongue ? (Math.abs(q[0]) < dv * 0.7 ? mixc(HIDE.tongue, HIDE.ridge, 0.4) : mixc(HIDE.tongue, 0xf0a090, h01(x, y, z, 3) * 0.3)) : HIDE.gum;
      jaw.set(x, y - 2, z, c, VF.METAL); // wet
      // a row of molars along the back of the bowl
      if (!tongue && q[2] > 1.5 && q[2] < 1.88 && Math.floor(q[2] / dv) % 3 !== 0) jaw.set(x, y - 1, z, HIDE.molar);
    }
    head.forEach((x, y, z) => {
      if (head.has(x, y - 1, z) || z <= hz + 1) return;
      const q = invH(Mv(x, y, z));
      if (q[1] > mouthY(q) + 0.08) return;
      if (rimOf(head, x, y, z, 1)) head.set(x, y, z, HIDE.lip);
      else head.set(x, y, z, z % 3 === 0 ? HIDE.ridge : HIDE.palate, VF.METAL);
    });
  }
  // ---- slit nostrils that pinch shut against blowing sand
  both((s) => {
    const a = V(H(sx([0.105, 1.35, 2.245], s))), b = V(H(sx([0.18, 1.34, 2.31], s)));
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.floor(a[0] + (b[0] - a[0]) * t), z = Math.floor(a[2] + (b[2] - a[2]) * t);
      for (let y = Math.floor(a[1]) + 4; y > Math.floor(a[1]) - 6; y--) {
        if (!head.has(x, y, z)) continue;
        head.del(x, y, z);
        head.set(x, y - 1, z, 0x3a2420);
        break;
      }
    }
  });
  // ---- stiff pale bristles on the muzzle and chin
  for (const m of [head, jaw]) {
    const add: V3[] = [];
    m.forEach((x, y, z) => {
      const q = invH(Mv(x, y, z));
      if (q[2] < 2.12 || h01(x, y, z, 77) > (baby ? 0.01 : 0.02) || !exposed(m, x, y, z)) return;
      const d = norm3(sub3(q, [0, 1.02, 1.92]));
      const p: V3 = [x + Math.round(d[0]), y + Math.round(d[1]), z + Math.round(d[2])];
      if (!m.has(p[0], p[1], p[2]) && !head.has(p[0], p[1], p[2]) && !jaw.has(p[0], p[1], p[2])) add.push(p);
    });
    for (const [x, y, z] of add) m.set(x, y, z, HIDE.bristle);
  }

  // ================================================================ eyes on periscope turrets, lids, ears
  const RE = EYE_R * L.hk * L.eyeK;
  const fwdL = norm3([0.55, 0.25, 0.8]);
  const eyeCL = add3(H(J.turret), scl3(fwdL, 0.135 * L.hk - RE * 0.55));
  both((s) => {
    const ec = V(sx(eyeCL, s));
    paint(head, (x, y, z) => Math.hypot(x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]) < U(RE) * 1.8 && exposed(head, x, y, z), (x, y, z) => mixc(headCol(x, y, z), HIDE.pink, 0.45));
    ell(head, ec, [U(RE) * 1.07, U(RE) * 1.07, U(RE) * 1.07], 0, { carve: true });
  });
  {
    const ec = V(eyeCL);
    const eye = rig.part('eye_l', 'head', ec);
    wetEye(eye, ec, U(RE), fwdL, baby
      ? { sclera: 0x24140e, iris: 0x5c3018, irisEdge: 0x2e180a, pupil: 0x070404, irisR: 0.94, pupilR: 0.6, bigGlint: 2 }
      : { sclera: 0x3a2218, iris: 0x6e3c1e, irisEdge: 0x40220e, pupil: 0x0a0605, irisR: 0.86, pupilR: 0.5, bigGlint: 2 });
    rig.mirror('eye_l', 'eye_r');
    // heavy lids: a hood of hide over the top of each eye (rotates down over it to blink)
    const lid = rig.part('lid_l', 'head', ec);
    const r0 = U(RE) + 0.35, r1 = U(RE) + 1.75;
    const up: V3 = [0, 1, 0];
    const R = Math.ceil(r1) + 1;
    for (let x = Math.floor(ec[0] - R); x <= ec[0] + R; x++)
      for (let y = Math.floor(ec[1] - R); y <= ec[1] + R; y++)
        for (let z = Math.floor(ec[2] - R); z <= ec[2] + R; z++) {
          const d: V3 = [x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]];
          const l = Math.hypot(d[0], d[1], d[2]);
          if (l < r0 || l > r1 || head.has(x, y, z)) continue;
          const n = scl3(d, 1 / l);
          const du = dot3(n, up);
          if (du < 0.1 || dot3(n, fwdL) < -0.2) continue;
          lid.set(x, y, z, du < 0.24 ? HIDE.lash : mixc(headCol(x, y, z), HIDE.pink, 0.25));
        }
    rig.mirror('lid_l', 'lid_r');
  }
  {
    const eb = H(J.ear);
    const ear = rig.part('ear_l', 'head', V(eb));
    const ec = V(add3(eb, scl3([0.025, 0.08, -0.02], L.hk)));
    const er: V3 = [U(0.07 * L.hk), U(0.1 * L.hk), U(0.045 * L.hk)];
    const rot: V3 = [-0.25, 0, -0.5];
    ell(ear, ec, er, (x, y, z) => {
      const l = invXYZ([x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]], rot);
      const rim = (l[0] / er[0]) ** 2 + (l[1] / er[1]) ** 2 > 0.6;
      if (l[2] > er[2] * 0.2) return rim ? HIDE.dark : mixc(HIDE.pink, 0xc07a70, h01(x, y, z, 2) * 0.4);
      return babyPink(rim ? HIDE.light : HIDE.base);
    }, { rot });
    rig.mirror('ear_l', 'ear_r');
  }

  // ================================================================ short pillar legs on splayed padded feet
  const legCol = (i: number, j: number, k: number) => {
    const q = invG(Mv(i, j, k));
    let c = skin(q, i, j, k, Math.abs(q[0]) > 0.55 ? 0.1 : -0.2);
    // ring wrinkles at the wrists / ankles
    if (q[1] > 0.12 && q[1] < 0.34 && (q[1] * 34 + n01(q[0], q[1], q[2], 8, 2) * 1.5) % 1 < 0.22) c = mixc(c, HIDE.crease, 0.45);
    if (q[1] < 0.06) c = HIDE.pad;
    return c;
  };
  const lr = L.lr;
  const foot = (m: VoxelModel, at: V3) => {
    const pad = add3(at, [0, 0.07, 0.02]);
    blob(m, [
      { c: V(G(pad)), r: [U(0.21 * lr), U(0.085 * legK), U(0.23 * lr)] },
      { c: V(G(add3(at, [0, 0.04, 0.08]))), r: [U(0.25 * lr), U(0.042 * legK), U(0.24 * lr)] }, // wide snowshoe sole
    ], legCol, { k: U(0.05), keep: (_x, y) => y >= 0 });
    for (const a of [-0.82, -0.27, 0.27, 0.82]) {
      const d: V3 = [Math.sin(a), 0, Math.cos(a)];
      const t0 = add3(at, add3(scl3(d, 0.1), [0, 0.075, 0])), t1 = add3(at, add3(scl3(d, 0.25), [0, 0.055, 0]));
      cap(m, V(G(t0)), V(G(t1)), U(0.075 * lr), U(0.062 * lr), legCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
      cap(m, V(G(add3(at, add3(scl3(d, 0.25), [0, 0.05, 0])))), V(G(add3(at, add3(scl3(d, 0.31), [0, 0.045, 0])))), U(0.056 * lr), U(0.04 * lr), (x, y, z) => (h01(x, y, z, 6) < 0.25 ? 0x5e4c42 : HIDE.nail), { keep: (_t, _a, _b, _x, y) => y >= 0 });
    }
  };
  {
    const sh = G(J.shoulder), el = G(J.elbow), an = G(J.fAnkle);
    const leg = rig.part('leg_fl', 'body', V(sh));
    cap(leg, V(sh), V(el), U(0.27 * lr), U(0.22 * lr), legCol);
    const shin = rig.part('shin_fl', 'leg_fl', V(el));
    cap(shin, V(el), V(an), U(0.22 * lr), U(0.19 * lr), legCol);
    foot(shin, J.fFoot);
    rig.mirror('leg_fl', 'leg_fr');
    rig.mirror('shin_fl', 'shin_fr', 'leg_fr');
  }
  {
    const hp = G(J.hip), kn = G(J.knee), an = G(J.bAnkle);
    const leg = rig.part('leg_bl', 'body', V(hp));
    cap(leg, V(hp), V(kn), U(0.29 * lr), U(0.22 * lr), legCol);
    const shin = rig.part('shin_bl', 'leg_bl', V(kn));
    cap(shin, V(kn), V(an), U(0.22 * lr), U(0.19 * lr), legCol);
    foot(shin, J.bFoot);
    rig.mirror('leg_bl', 'leg_br');
    rig.mirror('shin_bl', 'shin_br', 'leg_br');
  }

  // ================================================================ short flat tail with a bristle tuft
  {
    const tail = rig.part('tail', 'body', V(B(J.tail0)));
    const pts = [J.tail0, J.tail1, J.tail2].map((p) => V(B(p)));
    tube(tail, pts, [U(0.075 * L.bw), U(0.064 * L.bw), U(0.05 * L.bw)], bodyCol);
    for (let b = 0; b < 7; b++) {
      const a = (b / 6 - 0.5) * 1.6;
      const root = B(add3(J.tail2, [Math.sin(a) * 0.03, 0.01, -0.02]));
      const tip = B(add3(J.tail2, [Math.sin(a) * 0.07, -0.1 - Math.cos(a) * 0.03, -0.04]));
      line(tail, [V(root), V(tip)], b % 2 ? 0x3c2c24 : 0x584034);
    }
  }

  // overlapping parts never share an exposed cell (no coplanar z-fighting at the joints)
  for (const p of rig.parts) {
    if (!p.parent || /^(eye|lid)_/.test(p.name)) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }

  const s = L.s;
  rig.socket('mouth', 'head', V(H([0, 1.0, 2.36])));
  rig.socket('back', 'body', V(B([0, 1.6, 0])));
  rig.socket('head_top', 'head', V(H([0, 1.62, 1.45])));
  rig.socket('nostril_l', 'head', V(H([0.14, 1.36, 2.28])));
  rig.socket('nostril_r', 'head', V(H([-0.14, 1.36, 2.28])));
  return rig.build({
    kind: 'hippo',
    baby,
    scale: s,
    height: H(J.turret)[1] * s + 0.12 * L.hk * s,
    backY: (B([0, 1.58, 0])[1]) * s,
    halfLen: 1.5 * L.bl * s,
    halfWid: 0.78 * L.bw * s,
    radius: 0.86 * L.bw * s,
    length: (H([0, 1, 2.5])[2] - B([0, 1, -1.56])[2]) * s,
    headZ: H([0, 1, 2.2])[2] * s,
    wallowDrop: 0.5 * s,
    burrowDrop: (1.12 - L.drop * 0.5) * s,
    lidAxis: norm3([0.8, 0, -0.55]),
  });
}

const memo = memoBy((b: boolean) => (b ? 'baby' : 'adult'), (b: boolean) => buildHippo(b ? BABY : ADULT));
/** the adult sand hippo (≈ 4 m long, 1.6 m at the shoulder, 1/32 m) */
export function sandHippoRig(): RigSpec {
  return memo(false);
}
/** the calf (≈ 1.4 m long, round and pink-cheeked, tusk buds; 1/70 m) */
export function babyHippoRig(): RigSpec {
  return memo(true);
}

// ============================================================================ animation
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;
const GAIT = {
  walk: { lb: 0, lf: 0.25, rb: 0.5, rf: 0.75 },
  trot: { lb: 0.5, lf: 0, rb: 0, rf: 0.5 },
  gallop: { lb: 0, lf: 0.6, rb: 0.12, rf: 0.48 },
};
const LEGS: ['lf' | 'rf' | 'lb' | 'rb', string, string, number][] = [
  ['lf', 'leg_fl', 'shin_fl', 1],
  ['rf', 'leg_fr', 'shin_fr', -1],
  ['lb', 'leg_bl', 'shin_bl', 1],
  ['rb', 'leg_br', 'shin_br', -1],
];
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();

export interface HippoDrive {
  /** ground speed (m/s) */
  speed: number;
  /** yaw rate (rad/s), leans into turns */
  turn?: number;
  /** 0 standing, 1 wallowing (lying sunk in the sand), 2 burrowed (only eyes, ears, nostrils and back show) */
  sink: number;
  /** yawn / threat gape 0..1 */
  yawn: number;
  /** bite phase 0..1 (< 0: none) — the jaws snap shut at ≈ 0.4 */
  bite: number;
  /** rage 0..1: head low, ears pinned, squinting, snorting */
  rage: number;
  /** head yaw toward something (rad, + = its left) */
  look: number;
  /** calf poses */
  mode?: 'normal' | 'carried' | 'thrown' | 'dizzy';
}

/**
 * Procedural animation for both hippo rigs. Writes every joint each frame
 * (rest + delta), root scale (squash) and the body's sink. Gaits blend by speed:
 * lateral-sequence walk → diagonal trot → rotary gallop.
 */
export class HippoAnim {
  t = Math.random() * 10;
  phase = Math.random();
  readonly s: number;
  readonly baby: boolean;
  private base: Record<string, THREE.Vector3> = {};
  private sq = 0;
  private sqV = 0;
  private sinkCur = 0;
  private lookY = 0;
  private blink = 0;
  private nextBlink = 1 + Math.random() * 3;
  private earT = [9, 9];
  private nextEar = 1.5 + Math.random() * 3;
  private wagT = 9;
  private nextWag = 4 + Math.random() * 6;
  private gal = 0;
  private trot = 0;
  private amp = 0;
  /** digging wiggle while sinking into / heaving out of the sand 0..1 */
  digging = 0;
  /** how far the body is sunk into the sand right now (m) */
  drop = 0;
  /** current sink level (0 stand, 1 wallow, 2 burrow) */
  get sunk() {
    return this.sinkCur;
  }
  private lidAxis: [THREE.Vector3, THREE.Vector3];
  constructor(public rig: RigInstance) {
    const meta = rig.geo.spec.meta ?? {};
    this.s = meta.scale ?? 1;
    this.baby = !!meta.baby;
    for (const p of rig.geo.parts) this.base[p.name] = p.offset.clone();
    const a = meta.lidAxis ?? [0.8, 0, -0.55];
    this.lidAxis = [new THREE.Vector3(a[0], a[1], a[2]).normalize(), new THREE.Vector3(-a[0], a[1], -a[2]).normalize()];
  }
  /** squash impulse (negative = squash down, e.g. a hunter bouncing on its back) */
  kick(v: number) {
    this.sqV += v;
  }
  private rot(n: string, x: number, y = 0, z = 0) {
    this.rig.nodes[n]?.rotation.set(x, y, z);
  }

  update(dt: number, d: HippoDrive) {
    const t = (this.t += dt);
    const n = this.rig.nodes;
    const s = this.s;
    const mode = d.mode ?? 'normal';
    // ---------------------------------------------------------------- gait
    const sp = d.speed / s;
    this.amp = damp(this.amp, clamp(sp / 1.1, 0, 1), 6, dt);
    this.trot = damp(this.trot, sstep(1.9, 3.4, sp), 4, dt);
    this.gal = damp(this.gal, sstep(5, 7.2, sp), 4, dt);
    const stride = (this.baby ? 1.25 : 1.6) + sp * 0.22;
    this.phase = (this.phase + (dt * Math.max(sp, this.amp * 0.6)) / stride) % 1;
    const ph = this.phase, amp = this.amp, tr = this.trot, gl = this.gal;
    // ---------------------------------------------------------------- sink (wallow / burrow)
    const prevSink = this.sinkCur;
    this.sinkCur = damp(this.sinkCur, d.sink, d.sink > this.sinkCur ? 0.9 : d.rage > 0.3 ? 4.5 : 1.6, dt);
    this.digging = clamp(Math.abs(this.sinkCur - prevSink) / Math.max(dt, 1e-4) * 2, 0, 1);
    const w = Math.min(1, this.sinkCur), bur = Math.max(0, this.sinkCur - 1);
    const meta = this.rig.geo.spec.meta ?? {};
    const drop = (this.drop = (meta.wallowDrop ?? 0.5 * s) * w + ((meta.burrowDrop ?? 1.1 * s) - (meta.wallowDrop ?? 0.5 * s)) * bur);
    // ---------------------------------------------------------------- body
    const bob = (-(0.022 + 0.03 * tr) * Math.abs(Math.cos(ph * TAU * 2)) * (1 - gl) + 0.06 * gl * Math.sin(ph * TAU)) * amp * s;
    const breathe = Math.sin(t * 1.3) * 0.006 * s;
    const bb = this.base['body'];
    let bodyX = 0.08 * gl * Math.sin(ph * TAU + 1.2) * amp - 0.05 * d.yawn;
    let bodyZ = 0.035 * amp * Math.sin(ph * TAU) * (1 - tr * 0.5) * (1 - gl) - (d.turn ?? 0) * 0.05;
    bodyZ += Math.sin(t * 9) * 0.07 * this.digging;
    if (d.bite >= 0) bodyX += 0.06 * sstep(0.32, 0.42, d.bite) * (1 - sstep(0.5, 1, d.bite));
    if (mode === 'dizzy') bodyZ += Math.sin(t * 6) * 0.08;
    n['body']?.position.set(bb.x, bb.y + bob + breathe - drop, bb.z);
    this.rot('body', bodyX, 0, bodyZ);
    // ---------------------------------------------------------------- legs
    for (const [k, leg, shin, side] of LEGS) {
      const off = lerp(lerp(GAIT.walk[k], GAIT.trot[k], tr), GAIT.gallop[k], gl);
      const a = (ph + off) * TAU;
      const A = (0.32 + 0.12 * tr + 0.2 * gl) * amp;
      const swing = Math.sin(a), lift = Math.max(0, Math.cos(a));
      const front = k === 'lf' || k === 'rf';
      let lx = -A * swing * (front ? 0.55 : 0.5), lz = 0, shx = lift * amp * (front ? 0.9 : 0.7);
      // lying down: front legs reach forward, hind legs fold, all splay a little (mostly under the sand)
      lx += (front ? -0.7 : -0.55) * w;
      shx += (front ? 1.35 : 1.5) * w;
      lz += side * 0.22 * w;
      if (mode === 'carried') {
        lx = Math.sin(t * 17 + (front ? 0 : 1.6) + side) * 0.65;
        shx = 0.4 + Math.sin(t * 17 + side * 2) * 0.3;
        lz = side * 0.2;
      } else if (mode === 'thrown') {
        lx = front ? -0.9 : 0.8;
        lz = side * 0.55;
        shx = 0.2;
      }
      this.rot(leg, lx, 0, lz);
      this.rot(shin, shx);
    }
    // ---------------------------------------------------------------- head, jaw
    let look = clamp(d.look, -0.6, 0.6);
    if (mode === 'carried') look = Math.sin(t * 2.3) * 0.45;
    if (mode === 'dizzy') look += Math.cos(t * 6) * 0.3;
    this.lookY = damp(this.lookY, look, 4, dt);
    let hx = 0.04 * amp * Math.sin(ph * TAU * 2 + 1) * (1 - gl) - 0.6 * bodyX * gl + 0.12 * d.rage + 0.1 * gl;
    hx += -0.55 * d.yawn - 0.2 * bur;
    let jx = 0.12 * d.rage + 1.2 * d.yawn + 0.06 * gl + Math.max(0, Math.sin(t * 0.8)) * 0.02;
    if (d.bite >= 0) {
      const b = d.bite;
      const open = b < 0.32 ? sstep(0, 0.32, b) : b < 0.44 ? 1 - sstep(0.32, 0.44, b) : 0;
      jx += 1.15 * open;
      hx += b < 0.32 ? -0.3 * sstep(0, 0.32, b) : b < 0.5 ? lerp(-0.3, 0.3, sstep(0.32, 0.42, b)) : 0.3 * (1 - sstep(0.5, 1, b));
    }
    let hz = 0;
    if (mode === 'carried') jx = 0.3 + Math.max(0, Math.sin(t * 9)) * 0.25;
    if (mode === 'thrown') jx = 0.7;
    if (mode === 'dizzy') hz = Math.sin(t * 6) * 0.28;
    this.rot('head', hx, this.lookY * 0.8, hz);
    this.rot('jaw', jx);
    // ---------------------------------------------------------------- ears: twirl now and then, pinned back in rage / at speed
    this.nextEar -= dt;
    if (this.nextEar <= 0) {
      this.nextEar = 1.5 + Math.random() * 4;
      const e = Math.random() < 0.5 ? 0 : 1;
      this.earT[e] = 0;
      if (Math.random() < 0.4) this.earT[1 - e] = -0.08;
    }
    for (let e = 0; e < 2; e++) {
      this.earT[e] += dt;
      const et = this.earT[e];
      const twirl = et >= 0 && et < 0.4 ? Math.sin(et * 45) * 0.7 * (1 - et / 0.4) : 0;
      const back = 0.65 * d.rage + 0.4 * d.yawn + 0.3 * gl + (mode === 'thrown' ? 0.8 : 0) + (mode === 'carried' ? Math.sin(t * 11 + e) * 0.3 : 0);
      this.rot(e === 0 ? 'ear_l' : 'ear_r', -back, twirl, 0);
    }
    // ---------------------------------------------------------------- lids: blinks, sleepy idle, squint
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 2 + Math.random() * 4;
      this.blink = 0.16;
    }
    this.blink = Math.max(0, this.blink - dt);
    let lid = 0.18 + 0.35 * d.rage + 0.5 * d.yawn + 0.25 * bur + (mode === 'dizzy' ? 0.55 : 0);
    if (mode === 'thrown' || mode === 'carried') lid = 0;
    if (this.blink > 0) lid = 1.15;
    for (let e = 0; e < 2; e++) {
      const node = n[e === 0 ? 'lid_l' : 'lid_r'];
      if (node) node.quaternion.copy(_q.setFromAxisAngle(_ax.copy(this.lidAxis[e]), lid));
    }
    // ---------------------------------------------------------------- tail: wag bursts, streams out at a gallop
    this.nextWag -= dt;
    if (this.nextWag <= 0) {
      this.nextWag = 5 + Math.random() * 8;
      this.wagT = 0;
    }
    this.wagT += dt;
    const wag = this.wagT < 1.1 ? Math.sin(this.wagT * 24) * 0.55 : 0;
    this.rot('tail', -0.35 * gl - 0.2 * tr * amp + Math.sin(t * 1.7) * 0.04, wag + (mode === 'carried' ? Math.sin(t * 20) * 0.5 : 0), 0);
    // ---------------------------------------------------------------- squash spring (bounces, landings)
    this.sqV += (-170 * this.sq - 11 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    const q = clamp(this.sq, -0.45, 0.45);
    this.rig.root.scale.set(1 - q * 0.45, 1 + q, 1 - q * 0.45);
  }
}
