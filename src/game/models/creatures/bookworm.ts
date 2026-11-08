// The bookworms: the librarians of Thoth's Hall. Plump, segmented larvae with
// soft banded bodies, pale bellies, spiracle dots and a fuzz of fine setae, who
// read with their whole length curled up off the floor.
//
//   - every body segment is its own sculpt and its own joint, so the worm can
//     inch along in a travelling wave, rear up tall to shelve a book, or curl;
//   - stubby prolegs with dark crochet soles under the belly, tiny jointed true
//     legs on the thorax, and two little arms with three-fingered paws;
//   - a big round head with chubby cheeks, a mouth with its own lower lip, and
//     glossy modelled eyes behind real wire spectacles (with upper lids that blink);
//   - a tiny cap, a quill tucked in somewhere, and something to read.
//
// Variants (bookwormRig(v)):
//   0 bookworm             "Inkwell"   sage green, round gold spectacles, maroon fez and tassel, an open book
//   1 bookworm_elder       "Old Vellum" lavender grey, half-moon spectacles on a chain, a lapis skullcap,
//                                       white brows and whiskers, a big open tome
//   2 bookworm_apprentice  "Dog-Ear"   peach, thick tortoiseshell glasses, a floppy linen cap, a stack of books
//   3 bookworm_archivist   "Ledger"    ochre, a monocle on a chain, a green eyeshade with two quills, an open ledger
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the tail end, 1/160 m):
//   seg0 (root, tail end on the ground) → seg1 → … → seg9 (thorax, upright in the rest pose) → head
//   head → jaw (lower lip), eye_l / eye_r, lid_l / lid_r (blink: rotate +X by meta.blink.close),
//          specs, cap (→ tassel on the fez)
//   seg9 → hand_l, hand_r (arms), book (spine + left half; or the stack)
//   book → cover_r (the right half: close = rotate Y by meta.bookClose), page (flip = rotate Y by meta.pageFlip)
// Rest pose = reading: the rear six segments flat on the floor, the front four curving up,
// the book held open under the chin. Animate with BookwormAnim (bottom of this file).
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, blob, ell, cap, tube, line, paint, exposed, thicken, splitInto, finish, mixc, mulc, n01, h01, wetEye, add3, sub3, scl3, norm3, cross3, dot3, sstep, clamp01, rotXYZ, invXYZ } from './ckit';
import type { V3, RigSpec, Col } from './ckit';

const VS = 1 / 160;
const K = 1 / VS;

export type BookwormVariant = 0 | 1 | 2 | 3;
interface WormLook {
  name: string;
  scale: number;
  body: number;
  bodyL: number;
  bodyS: number;
  spot: number;
  belly: number;
  face: number;
  blush: number;
  iris: number;
  specs: 'round' | 'half' | 'thick' | 'monocle';
  cap: 'fez' | 'skullcap' | 'slouch' | 'visor';
  carry: 'book' | 'tome' | 'stack' | 'ledger';
  cover: number;
  elder?: boolean;
}
export const BOOKWORMS: WormLook[] = [
  { name: 'Inkwell', scale: 1, body: 0x9cbf7e, bodyL: 0xbdd89a, bodyS: 0x7a9c62, spot: 0x5e7e4c, belly: 0xdfe6b4, face: 0xb6d292, blush: 0xe8a890, iris: 0x5a3a1c, specs: 'round', cap: 'fez', carry: 'book', cover: 0x7a2a26 },
  { name: 'Old Vellum', scale: 1.12, body: 0xa79cc0, bodyL: 0xc6bedb, bodyS: 0x857aa0, spot: 0x6a5e86, belly: 0xe4deee, face: 0xbdb3d4, blush: 0xd8a0b0, iris: 0x3a4a6a, specs: 'half', cap: 'skullcap', carry: 'tome', cover: 0x24427e, elder: true },
  { name: 'Dog-Ear', scale: 0.82, body: 0xeba98a, bodyL: 0xf6c6aa, bodyS: 0xc98868, spot: 0xb06a50, belly: 0xfbe4cf, face: 0xf3bb9c, blush: 0xe88874, iris: 0x4a2c18, specs: 'thick', cap: 'slouch', carry: 'stack', cover: 0x2e6a52 },
  { name: 'Ledger', scale: 1.04, body: 0xd6b052, bodyL: 0xead07a, bodyS: 0xb08a38, spot: 0x8a6a2a, belly: 0xf3e4ac, face: 0xe4c46c, blush: 0xe09a6a, iris: 0x2e4a2a, specs: 'monocle', cap: 'visor', carry: 'ledger', cover: 0x2f5e3a },
];
const GOLD = { g: 0xe2b24a, l: 0xffe08a, s: 0xa8782a };
const INK = 0x2a1c14;
const PAPER = { p: 0xf0e4c4, s: 0xd8c8a0, line: 0xa8987a };

/** the spine (design metres, rest pose): joints J0 (tail tip) … J10 (base of the head) */
const SPINE: V3[] = [
  [0, 0.03, -0.39],
  [0, 0.04, -0.33],
  [0, 0.05, -0.27],
  [0, 0.056, -0.21],
  [0, 0.06, -0.15],
  [0, 0.062, -0.09],
  [0, 0.063, -0.03],
  [0, 0.082, 0.024],
  [0, 0.126, 0.058],
  [0, 0.18, 0.074],
  [0, 0.236, 0.078],
];
/** body radius of each segment (seg0 … seg9) */
const SEG_R = [0.03, 0.04, 0.048, 0.054, 0.058, 0.061, 0.062, 0.061, 0.059, 0.056];
const HEAD_C: V3 = [0, 0.3, 0.086];
const HEAD_R: V3 = [0.074, 0.068, 0.068];
const EYE: V3 = [0.03, 0.309, 0.141];
const EYE_R = 0.0225;
const LID_REST = -1.1;
const LID_CLOSE = 1.7;
/** the open book: spine axis (x 0, z BOOK_Z), half opening angle */
const BOOK_Z = 0.206;
const BOOK_TH = 0.38;

function build(v: BookwormVariant): RigSpec {
  const L = BOOKWORMS[v];
  const s = L.scale;
  const U = (m: number) => m * s * K;
  const P = (x: number, y: number, z: number): V3 => [x * s * K, y * s * K, z * s * K];
  const Pv = (q: V3): V3 => [q[0] * s * K, q[1] * s * K, q[2] * s * K];
  /** voxel index -> design metres (unscaled) */
  const D = (i: number) => (i + 0.5) / (s * K);
  const rig = new CRig(['bookworm', 'bookworm_elder', 'bookworm_apprentice', 'bookworm_archivist'][v], VS);
  const seed = 11 + v * 7;

  /** fill every cell whose centre (design metres) has f <= 0 */
  const sdf = (m: VoxelModel, lo: V3, hi: V3, f: (x: number, y: number, z: number) => number, col: Col, fl?: number) => {
    for (let i = Math.floor(U(lo[0])); i <= Math.ceil(U(hi[0])); i++)
      for (let j = Math.floor(U(lo[1])); j <= Math.ceil(U(hi[1])); j++)
        for (let k = Math.floor(U(lo[2])); k <= Math.ceil(U(hi[2])); k++) {
          if (f(D(i), D(j), D(k)) > 0) continue;
          const c = typeof col === 'number' ? col : col(i, j, k);
          if (c !== null) m.set(i, j, k, c, fl);
        }
  };

  // ================================================================ body segments
  const bodyCol = (i: number, j: number, k: number, axis: V3, dir: V3, len: number, segI: number) => {
    const p: V3 = [D(i), D(j), D(k)];
    const rel = sub3(p, axis);
    const t = dot3(rel, dir) / len; // 0 at the rear joint, 1 at the front joint
    const radial = sub3(rel, scl3(dir, t * len));
    // the body's "up" is perpendicular to the spine, toward the back
    const up = norm3(cross3([1, 0, 0], dir));
    const back = dot3(norm3(radial), up); // +1 along the back, -1 the belly
    const side = Math.abs(radial[0]) / (Math.hypot(radial[0], radial[1], radial[2]) || 1);
    let c = L.body;
    const n = n01(i, j, k, 0.22, seed);
    if (back < -0.45) c = mixc(L.body, L.belly, sstep(-0.45, -0.75, back));
    else if (back > 0.55 && n > 0.56) c = mixc(c, L.bodyL, 0.5);
    // a soft saddle spot on each segment's back, and a darker crease ring at each joint
    if (back > 0.3 && t > 0.3 && t < 0.72 && Math.abs(radial[0]) < 0.02 * s) c = mixc(c, L.spot, 0.5 * sstep(0.3, 0.75, back));
    if (t < 0.08 || t > 0.94) c = mixc(c, L.bodyS, 0.7);
    // a spiracle: a dark dot with a pale rim on each flank
    if (side > 0.86 && Math.abs(back) < 0.35 && segI > 0 && segI < 9) {
      const d = Math.hypot(t - 0.5, back * 0.3) * len;
      if (d < 0.0055) c = d < 0.0035 ? 0x2a2420 : L.bodyL;
    }
    if (h01(i, j, k, seed) < 0.03) c = mixc(c, L.bodyL, 0.4);
    return c;
  };
  for (let si = 0; si < 10; si++) {
    const a = SPINE[si], b = SPINE[si + 1];
    const dir = norm3(sub3(b, a));
    const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
    const r = SEG_R[si];
    const rPrev = si ? SEG_R[si - 1] : r * 0.7;
    const seg = rig.part('seg' + si, si ? 'seg' + (si - 1) : undefined, Pv(a));
    const mid = scl3(add3(a, b), 0.5);
    const pitch = -Math.atan2(dir[1], dir[2]);
    blob(seg, [
      { a: Pv(sub3(a, scl3(dir, len * 0.12))), b: Pv(add3(b, scl3(dir, len * 0.05))), r0: U((r + rPrev) * 0.47), r1: U(r * 0.9) },
      { c: Pv(mid), r: [U(r * 1.05), U(r * 1.03), U(len * 0.45)], rot: [pitch, 0, 0] },
      ...(si === 0 ? [{ c: Pv(add3(a, scl3(dir, -0.008))), r: [U(r * 0.75), U(r * 0.7), U(0.022)] as V3, rot: [pitch, 0, 0] as V3 }] : []),
    ], (i, j, k) => bodyCol(i, j, k, a, dir, len, si), {
      k: U(0.012),
      disp: (x, y, z) => (n01(x, y, z, 0.4, seed + si) - 0.5) * 0.35,
      keep: (_x, y) => y >= 0,
    });
    // prolegs under the abdomen (and the claspers under the tail), each with a dark crochet sole
    if (si === 0 || (si >= 2 && si <= 5)) {
      for (const sd of [1, -1]) {
        const c: V3 = [sd * r * 0.55, 0.012, mid[2]];
        ell(seg, Pv(c), [U(0.012), U(0.013), U(0.014)], (i, j, k) => (j <= 0 ? 0x3a2a22 : mixc(L.belly, L.bodyS, 0.25 + h01(i, j, k, 2) * 0.2)), { keep: (_a, _b, _c, _x, y) => y >= 0 });
      }
    }
    // tiny jointed true legs on the thorax
    if (si === 7 || si === 8) {
      for (const sd of [1, -1]) {
        const root: V3 = add3(mid, [sd * r * 0.6, -r * 0.4, r * 0.55]);
        const knee: V3 = add3(root, [sd * 0.012, -0.01, 0.014]);
        const tip: V3 = add3(knee, [sd * 0.002, -0.012, 0.01]);
        tube(seg, [Pv(root), Pv(knee), Pv(tip)], [U(0.007), U(0.0055), U(0.0035)], (i, j, k) => (D(j) < tip[1] + 0.004 ? 0x3a2a22 : L.bodyS));
      }
    }
    // a fuzz of fine setae along the back
    for (const sd of [1, -1, 0]) {
      if (h01(si, sd, 3, seed) < 0.35) continue;
      const up = norm3(cross3([1, 0, 0], dir));
      const base = add3(mid, add3(scl3(up, r * 0.95), [sd * r * 0.45, 0, 0]));
      const tip = add3(base, add3(scl3(up, 0.012), [sd * 0.004, 0, -dir[2] * 0.006]));
      line(seg, [Pv(base), Pv(tip)], mixc(L.bodyL, 0xffffff, 0.3));
    }
  }

  // ================================================================ head
  const head = rig.part('head', 'seg9', Pv(SPINE[10]));
  const faceCol = (i: number, j: number, k: number) => {
    const X = D(i), Y = D(j), Z = D(k);
    const n = n01(i, j, k, 0.25, seed + 40);
    let c = Z > HEAD_C[2] + 0.02 ? L.face : L.body;
    if (Z > HEAD_C[2] && Z < HEAD_C[2] + 0.03) c = mixc(L.body, L.face, (Z - HEAD_C[2]) / 0.03);
    if (Y > 0.345) c = mixc(c, L.spot, 0.25);
    if (n > 0.66) c = mixc(c, L.bodyL, 0.4);
    for (const sd of [1, -1]) {
      const d = Math.hypot(X - 0.042 * sd, Y - 0.282, (Z - 0.128) * 1.2);
      if (d < 0.018) c = mixc(c, L.blush, 0.6 * (1 - sstep(0.008, 0.018, d)));
    }
    return c;
  };
  blob(head, [
    { c: Pv(HEAD_C), r: Pv(HEAD_R) },
    { c: P(0.04, 0.279, 0.124), r: P(0.032, 0.028, 0.027) },
    { c: P(-0.04, 0.279, 0.124), r: P(0.032, 0.028, 0.027) },
    { c: P(0, 0.268, 0.135), r: P(0.028, 0.02, 0.022) },
    { a: Pv(SPINE[10]), b: P(0, 0.28, 0.084), r0: U(0.05), r1: U(0.058) },
  ], faceCol, { k: U(0.016), disp: (x, y, z) => (n01(x, y, z, 0.4, seed + 41) - 0.5) * 0.3 });
  // the mouth: a small smile; the lower lip is its own part
  const mouthY = (X: number) => 0.2705 + 9 * X * X;
  const jaw = rig.part('jaw', 'head', P(0, 0.27, 0.118));
  {
    const tmp = new VoxelModel('h');
    head.forEach((x, y, z, c, f) => tmp.set(x, y, z, c, f));
    head.map.clear();
    splitInto(tmp, head, jaw, (x, y, z) => D(z) > 0.122 && D(y) < mouthY(D(x)) && D(y) > 0.248 && Math.abs(D(x)) < 0.034);
    const empty = (x: number, y: number, z: number) => !head.has(x, y, z) && !jaw.has(x, y, z);
    jaw.forEach((x, y, z) => {
      if (!jaw.has(x, y + 1, z)) jaw.set(x, y, z, empty(x, y, z + 1) || empty(x + 1, y, z) || empty(x - 1, y, z) ? 0x3a1e1a : 0xb0565a);
    });
    head.forEach((x, y, z) => {
      if (jaw.has(x, y - 1, z) && (empty(x, y, z + 1) || empty(x + 1, y, z) || empty(x - 1, y, z))) head.set(x, y, z, 0x3a1e1a);
    });
  }
  // eyes behind the spectacles
  const eyeC = Pv(EYE);
  const eyeM: V3 = [-eyeC[0], eyeC[1], eyeC[2]];
  for (const e of [eyeC, eyeM]) ell(head, e, [U(EYE_R) * 1.04, U(EYE_R) * 1.04, U(EYE_R) * 1.04], 0, { carve: true });
  for (const e of [eyeC, eyeM])
    paint(head, (x, y, z) => {
      if (!exposed(head, x, y, z)) return false;
      const d = Math.hypot(x + 0.5 - e[0], y + 0.5 - e[1], z + 0.5 - e[2]);
      return d < U(EYE_R) + 1.2;
    }, mulc(L.face, 0.72));
  const eyeL = rig.part('eye_l', 'head', eyeC);
  wetEye(eyeL, eyeC, U(EYE_R), [0.18, 0.05, 1], { sclera: 0x1c130e, iris: L.iris, pupil: 0x070405, irisR: 0.9, pupilR: 0.55, bigGlint: 2 });
  rig.mirror('eye_l', 'eye_r');
  {
    const lid = rig.part('lid_l', 'head', eyeC, [LID_REST, 0, 0]);
    const R = U(EYE_R), lo = R + 0.4, hi = R + 1.6;
    for (let i = Math.floor(eyeC[0] - hi - 1); i <= Math.ceil(eyeC[0] + hi + 1); i++)
      for (let j = Math.floor(eyeC[1] - hi - 1); j <= Math.ceil(eyeC[1] + hi + 1); j++)
        for (let k = Math.floor(eyeC[2] - hi - 1); k <= Math.ceil(eyeC[2] + hi + 1); k++) {
          const px = i + 0.5 - eyeC[0], py = j + 0.5 - eyeC[1], pz = k + 0.5 - eyeC[2];
          const d = Math.hypot(px, py, pz);
          if (d < lo || d > hi || Math.abs(px) > R * 1.05) continue;
          const th = Math.atan2(py, pz);
          if (th < -0.02 || th > 1.95) continue;
          lid.set(i, j, k, th < 0.1 ? 0x2a1c18 : L.face, VF.SOFTAO);
        }
    rig.mirror('lid_l', 'lid_r');
  }
  // the elder's bushy white brows and drooping whiskers
  if (L.elder) {
    for (const sd of [1, -1]) {
      blob(head, [{ a: P(0.014 * sd, 0.349, 0.147), b: P(0.054 * sd, 0.344, 0.124), r0: U(0.0075), r1: U(0.005) }], (i, j, k) => (h01(i, j, k, 3) < 0.3 ? 0xd8d4e0 : 0xf4f2f8), { k: U(0.003), disp: (x, y, z) => (n01(x, y, z, 0.8, 4) - 0.5) * 0.9 });
      for (let w = 0; w < 3; w++) line(head, [P(0.012 * sd, 0.276 - w * 0.002, 0.152), P(0.03 * sd, 0.268 - w * 0.003, 0.154), P((0.05 + w * 0.004) * sd, 0.252 - w * 0.006, 0.148)], w === 1 ? 0xe8e4f0 : 0xfafafe);
    }
  }

  // ================================================================ spectacles
  {
    const specs = rig.part('specs', 'head', P(0, 0.312, 0.16));
    const wire = L.specs === 'thick' ? (i: number, j: number, k: number) => (n01(i, j, k, 0.6, 5) > 0.55 ? 0x8a4a1c : n01(i, j, k, 0.6, 5) < 0.35 ? 0x3a1a0c : 0x6a3416) : (i: number, j: number, k: number) => (h01(i, j, k, 1) < 0.2 ? GOLD.l : GOLD.g);
    const rimR = L.specs === 'thick' ? 0.03 : 0.027;
    const wireT = L.specs === 'thick' ? 0.0062 : 0.0034;
    const lensY = L.specs === 'half' ? EYE[1] - 0.009 : EYE[1];
    const sides = L.specs === 'monocle' ? [-1] : [1, -1];
    for (const sd of sides) {
      const c: V3 = [EYE[0] * sd, lensY, EYE[2] + 0.02];
      const nrm = norm3([0.22 * sd, 0.02, 1]);
      const ax = norm3(cross3([0, 1, 0], nrm));
      const ay = cross3(nrm, ax);
      sdf(specs, sub3(c, [0.04, 0.04, 0.02]), add3(c, [0.04, 0.04, 0.02]), (x, y, z) => {
        const q = sub3([x, y, z], c);
        const u = dot3(q, ax), w = dot3(q, ay), h = dot3(q, nrm);
        if (L.specs === 'half' && w > 0.004) return 1; // half-moons: the lower half and a flat top bar
        const ringD = Math.hypot(Math.hypot(u, w) - rimR, h);
        const bar = L.specs === 'half' ? Math.hypot(Math.max(Math.abs(u) - rimR, 0), w - 0.002, h) : 1;
        return Math.min(ringD, bar) - wireT * 0.5;
      }, wire, VF.METAL);
      // a glint on the glass edge
      const g = add3(c, add3(scl3(ax, -rimR * 0.5 * sd), scl3(ay, rimR * 0.55)));
      if (L.specs !== 'half') specs.set(Math.floor(U(g[0])), Math.floor(U(g[1])), Math.floor(U(g[2])), 0xf4fbff, VF.SOFTAO);
      // the temple arm back to the side of the head
      const out = add3(c, scl3(ax, (rimR + 0.002) * sd));
      line(specs, [Pv(out), P(0.066 * sd, lensY + 0.004, 0.11), P(0.074 * sd, lensY + 0.002, 0.085)], wire);
    }
    if (L.specs !== 'monocle') {
      // the bridge over the nose
      line(specs, [P(0.008, lensY + (L.specs === 'half' ? 0.0 : 0.006), EYE[2] + 0.024), P(0, lensY + 0.009, EYE[2] + 0.027), P(-0.008, lensY + (L.specs === 'half' ? 0.0 : 0.006), EYE[2] + 0.024)], wire);
    }
    if (L.specs === 'half' || L.specs === 'monocle') {
      // a fine chain looping down from the frames
      const sd = L.specs === 'monocle' ? -1 : 1;
      const pts: V3[] = [];
      for (let q = 0; q <= 10; q++) {
        const t = q / 10;
        pts.push(P((0.055 - t * 0.012) * sd, lensY - 0.02 - Math.sin(t * Math.PI) * 0.05, 0.15 - t * 0.02));
      }
      line(specs, pts, (i, j, k) => ((i + j + k) & 1 ? GOLD.g : GOLD.s), VF.METAL);
    }
  }

  // ================================================================ caps
  const hatTop = HEAD_C[1] + HEAD_R[1];
  if (L.cap === 'fez') {
    const capP = rig.part('cap', 'head', P(0.006, hatTop - 0.012, HEAD_C[2] - 0.006));
    const base: V3 = [0.006, hatTop - 0.016, HEAD_C[2] - 0.006];
    const rot: V3 = [-0.14, 0, -0.16];
    const H = 0.056;
    sdf(capP, sub3(base, [0.06, 0.02, 0.06]), add3(base, [0.06, 0.09, 0.06]), (x, y, z) => {
      const q = invXYZ(sub3([x, y, z], base), rot);
      const t = clamp01(q[1] / H);
      const r = 0.043 - 0.009 * t;
      const dr = Math.hypot(q[0], q[2]) - r, dy = Math.max(q[1] - H, -q[1]);
      return Math.hypot(Math.max(dr + 0.004, 0), Math.max(dy + 0.004, 0)) + Math.min(Math.max(dr, dy), 0) - 0.004;
    }, (i, j, k) => {
      const q = invXYZ(sub3([D(i), D(j), D(k)], base), rot);
      const n = n01(i, j, k, 0.35, 7);
      let c = n > 0.62 ? 0xa83a3a : n < 0.3 ? 0x7a2228 : 0x922e30;
      if (q[1] < 0.008) c = 0x6a1c20;
      if (q[1] > H - 0.003 && Math.hypot(q[0], q[2]) < 0.006) c = 0x1a1414;
      return c;
    }, VF.SOFTAO);
    // the black silk tassel on its cord
    const top = add3(base, rotXYZ([0, H, 0], rot));
    const tassel = rig.part('tassel', 'cap', Pv(top));
    const knot = add3(top, rotXYZ([-0.03, -0.004, 0.004], rot));
    line(tassel, [Pv(top), Pv(knot)], 0x221a1a);
    ell(tassel, Pv(knot), P(0.0042, 0.0042, 0.0042), GOLD.g, { fl: VF.METAL });
    for (let q = 0; q < 7; q++) {
      const a = (q / 7) * Math.PI * 2;
      const o: V3 = [Math.cos(a) * 0.004, 0, Math.sin(a) * 0.004];
      line(tassel, [Pv(add3(knot, o)), Pv(add3(knot, add3(scl3(o, 1.6), [0, -0.032 - (q & 1) * 0.004, 0])))], q & 1 ? 0x2a2020 : 0x141010);
    }
    quill(capP, add3(base, rotXYZ([-0.036, 0.012, 0.006], rot)), add3(base, rotXYZ([-0.07, 0.085, -0.03], rot)), 0xf2eee2, 0x6a8ab0, s);
  } else if (L.cap === 'skullcap') {
    const capP = rig.part('cap', 'head', P(0, hatTop - 0.01, HEAD_C[2] - 0.01));
    const zone = (x: number, y: number, z: number) => D(y) - HEAD_C[1] > 0.038 - (D(z) - HEAD_C[2] < -0.02 ? 0.01 : 0);
    const colAt = (x: number, y: number, z: number) => {
      const X = D(x), Y = D(y) - HEAD_C[1], Z = D(z) - HEAD_C[2];
      const a = Math.atan2(X, Z);
      if (Y < 0.044) return GOLD.g;
      if (Math.abs(((a / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.46) return 0x3a5aa0; // gore seams
      return n01(x, y, z, 0.4, 3) > 0.6 ? 0x2c4c94 : 0x22407e;
    };
    head.forEach((x, y, z) => {
      if (zone(x, y, z) && exposed(head, x, y, z)) capP.set(x, y, z, colAt(x, y, z), VF.SOFTAO);
    });
    thicken(capP, () => true, (x, y, z) => (head.has(x, y, z) ? null : colAt(x, y, z)), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]], VF.SOFTAO);
    paint(capP, (x, y, z) => D(y) - HEAD_C[1] < 0.044, GOLD.g, VF.METAL);
    ell(capP, P(0, hatTop + 0.006, HEAD_C[2] - 0.006), P(0.006, 0.005, 0.006), GOLD.l, { fl: VF.METAL });
    quill(head, [-0.062, 0.318, 0.1], [-0.088, 0.392, 0.046], 0xf6f2ea, 0x8a7aa8, s);
  } else if (L.cap === 'slouch') {
    const capP = rig.part('cap', 'head', P(0, hatTop - 0.01, HEAD_C[2]));
    blob(capP, [
      { c: P(-0.006, hatTop - 0.004, HEAD_C[2] - 0.004), r: P(0.068, 0.028, 0.066), rot: [0, 0, 0.18] },
      { c: P(-0.058, hatTop - 0.018, HEAD_C[2] - 0.006), r: P(0.034, 0.024, 0.048), rot: [0, 0, 0.5] },
    ], (i, j, k) => {
      const n = n01(i, j, k, 0.3, 9);
      return n > 0.6 ? 0xf0e6cc : n < 0.32 ? 0xcfc2a2 : 0xe2d6b8;
    }, { k: U(0.014), keep: (x, y, z) => !head.has(x, y, z) && D(y) > hatTop - 0.032 - (D(x) < -0.03 ? 0.016 : 0) });
    // a stitched band and a little stalk on top
    paint(capP, (x, y, z) => {
      const below = !capP.has(x, y - 1, z) && !head.has(x, y - 1, z);
      return below || (capP.has(x, y - 1, z) && !capP.has(x, y - 2, z) && !head.has(x, y - 2, z));
    }, (i, j, k) => ((i + k) % 3 === 0 ? 0x8a6a4a : 0xc4b28c));
    cap(capP, P(-0.004, hatTop + 0.02, HEAD_C[2] - 0.004), P(-0.002, hatTop + 0.032, HEAD_C[2] - 0.006), U(0.004), U(0.003), 0xb8a47c);
    quill(capP, [0.04, hatTop - 0.006, HEAD_C[2] - 0.02], [0.08, hatTop + 0.06, HEAD_C[2] - 0.05], 0xf4f0e6, 0xd07a4a, s);
  } else {
    // the archivist's green eyeshade: a band round the head and a curved translucent brim
    const capP = rig.part('cap', 'head', P(0, 0.338, HEAD_C[2]));
    const bandY0 = 0.334, bandY1 = 0.346;
    head.forEach((x, y, z) => {
      if (D(y) >= bandY0 && D(y) <= bandY1 && exposed(head, x, y, z)) capP.set(x, y, z, 0x2a5a36);
    });
    thicken(capP, () => true, (x, y, z) => (head.has(x, y, z) ? null : D(y) > bandY1 - 0.003 || D(y) < bandY0 + 0.003 ? 0x1e3e26 : 0x2f6a3e), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
    for (let a = -1.05; a <= 1.05; a += 0.012)
      for (let r = 0.07; r <= 0.118; r += 0.003) {
        const t = (r - 0.07) / 0.048;
        const X = Math.sin(a) * r * 1.02, Z = HEAD_C[2] + Math.cos(a) * r;
        const Y = bandY0 + 0.004 - t * 0.014 - (Math.abs(a) > 0.8 ? (Math.abs(a) - 0.8) * 0.02 : 0);
        const edge = t > 0.88 || Math.abs(a) > 1.0;
        for (const dy of [0, -1]) capP.set(Math.floor(U(X)), Math.floor(U(Y)) + dy, Math.floor(U(Z)), edge ? 0x1e4a2c : dy ? 0x3f8a58 : 0x5eaa76, VF.SOFTAO);
      }
    quill(capP, [0.064, 0.34, 0.07], [0.098, 0.418, 0.02], 0xf6f2e8, 0x3f6a8a, s);
    quill(capP, [0.066, 0.338, 0.08], [0.108, 0.405, 0.05], 0xece4d4, 0xa04a3a, s);
  }

  // ================================================================ arms
  const big = L.carry === 'tome' ? 1.24 : 1;
  const hw = 0.055 * big;
  {
    const sh = P(0.046, 0.226, 0.108);
    const arm = rig.part('hand_l', 'seg9', sh);
    const paw: V3 = L.carry === 'stack' ? [0.05, 0.205, 0.165] : [hw * Math.cos(BOOK_TH) - 0.004, 0.198, BOOK_Z - hw * Math.sin(BOOK_TH) - 0.004];
    const armCol = (i: number, j: number, k: number) => (h01(i, j, k, 6) < 0.1 ? L.bodyL : mixc(L.body, L.belly, 0.35));
    tube(arm, [sh, P(0.06, 0.208, 0.135), Pv(paw)], [U(0.012), U(0.0105), U(0.0095)], armCol);
    ell(arm, Pv(paw), P(0.012, 0.013, 0.012), armCol);
    for (let f = 0; f < 3; f++) {
      const o: V3 = [-0.004 + f * 0.0045, 0.008 - f * 0.006, 0.008];
      cap(arm, Pv(add3(paw, [o[0], o[1], 0.004])), Pv(add3(paw, [o[0] - 0.006, o[1], o[2] + 0.002])), U(0.0042), U(0.0036), armCol);
    }
    rig.mirror('hand_l', 'hand_r');
  }

  // ================================================================ something to read
  const bookPiv = P(0, 0.21, BOOK_Z);
  const book = rig.part('book', 'seg9', bookPiv);
  if (L.carry === 'stack') {
    const books: [number, number, number, number, number][] = [
      // y centre, half width, half height (thickness), half depth, colour
      [0.164, 0.05, 0.016, 0.036, L.cover],
      [0.196, 0.045, 0.015, 0.033, 0x8a3a2a],
      [0.226, 0.047, 0.013, 0.031, 0x34507e],
    ];
    books.forEach(([y, bw, bh, bd, col], bi) => {
      const c: V3 = [0.002 * (bi - 1), y, 0.18];
      const rot = (bi - 1) * 0.12;
      const loc = (x: number, yy: number, z: number): V3 => invXYZ(sub3([x, yy, z], c), [0, rot, 0]);
      sdf(book, sub3(c, [0.07, 0.03, 0.07]), add3(c, [0.07, 0.03, 0.07]), (x, yy, z) => {
        const q = loc(x, yy, z);
        const qx = Math.abs(q[0]) - bw + 0.003, qy = Math.abs(q[1]) - bh + 0.003, qz = Math.abs(q[2]) - bd + 0.003;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.003;
      }, (i, j, k) => {
        const q = loc(D(i), D(j), D(k));
        const coverY = Math.abs(q[1]) > bh - 0.0066;
        const spine = q[2] > bd - 0.004;
        if (!coverY && !spine) return Math.abs(q[1]) % 0.0128 < 0.0064 ? PAPER.s : PAPER.p; // the page edges
        if (spine && Math.abs(Math.abs(q[0]) - bw * 0.5) < 0.003) return GOLD.g; // raised bands, gilt
        if (coverY && Math.abs(Math.abs(q[0]) - (bw - 0.009)) < 0.0035 && Math.abs(q[2]) < bd - 0.006) return GOLD.g;
        return n01(i, j, k, 0.5, bi) > 0.62 ? mixc(col, 0xffffff, 0.12) : col;
      });
    });
  } else {
    const H = (L.carry === 'tome' ? 0.1 : 0.078) / 2;
    const bt = L.carry === 'tome' ? 0.024 : 0.02;
    const ct = 0.0068; // the cover board: a full voxel
    const yC = 0.21;
    const cov = L.cover;
    const half = (m: VoxelModel, sd: number, pageOnly = false) => {
      // a half of the book in the frame of its own leaf: u along the leaf from the spine,
      // h out through its cover (the pages lie on the inner side, toward the reader)
      const dirU: V3 = [Math.cos(BOOK_TH) * sd, 0, -Math.sin(BOOK_TH)];
      const nOut: V3 = [Math.sin(BOOK_TH) * sd, 0, Math.cos(BOOK_TH)];
      const sp: V3 = [0, yC, BOOK_Z];
      sdf(m, [-hw - 0.02, yC - H - 0.01, BOOK_Z - hw - 0.03], [hw + 0.02, yC + H + 0.01, BOOK_Z + 0.03], (x, y, z) => {
        const q = sub3([x, y, z], sp);
        const u = dot3(q, dirU), h = dot3(q, nOut), w = q[1];
        // the loose page is one sheet on the face of the block (hidden there until it turns)
        const th0 = -bt, th1 = pageOnly ? -bt + 0.0068 : 0;
        if (u < 0.0 || u > hw - (pageOnly ? 0.004 : 0)) return 1;
        if (Math.abs(w) > H - (pageOnly ? 0.004 : 0)) return 1;
        if (h < th0 || h > th1) return 1;
        return -1;
      }, (i, j, k) => {
        const q = sub3([D(i), D(j), D(k)], sp);
        const u = dot3(q, dirU), h = dot3(q, nOut), w = q[1];
        if (pageOnly || h < -ct) {
          // pages: text lines on the face, fine page edges on the sides
          if (h < -bt + 0.0034 || pageOnly) {
            const row = Math.floor((w + H) / 0.0052);
            const ln = ((w + H) % 0.0052) < 0.0018 && u > 0.008 && u < hw - 0.01 && h01(row, Math.floor(u / 0.012), sd, 4) > 0.15;
            return ln ? PAPER.line : PAPER.p;
          }
          return (Math.floor(h / 0.0064) & 1) ? PAPER.s : PAPER.p;
        }
        // the cover: leather, a gilt frame, gilt corners, a little gilt eye in the middle
        const fu = u / hw, fw = Math.abs(w) / H;
        if ((Math.abs(fu - 0.86) < 0.07 && fw < 0.9) || (fw > 0.8 && fw < 0.92 && fu < 0.86)) return GOLD.g;
        if (fu > 0.9 && fw > 0.86) return GOLD.l;
        const em = Math.hypot((u - hw * 0.45) / 0.014, w / 0.011);
        if (em < 1 && em > 0.55) return GOLD.g;
        if (em <= 0.35) return GOLD.l;
        if (L.carry === 'ledger' && Math.abs(fw - 0.5) < 0.05 && fu < 0.3) return 0xa83a2a; // a cloth label strip
        return n01(i, j, k, 0.45, 2) > 0.62 ? mixc(cov, 0xffffff, 0.12) : n01(i, j, k, 0.45, 2) < 0.3 ? mixc(cov, 0x000000, 0.2) : cov;
      });
    };
    half(book, 1);
    // the spine: rounded leather with raised gilt bands
    sdf(book, [-0.016, yC - H - 0.004, BOOK_Z - 0.008], [0.016, yC + H + 0.004, BOOK_Z + 0.014], (x, y, z) => {
      if (Math.abs(y - yC) > H) return 1;
      return Math.hypot(x, (z - BOOK_Z + 0.002) * 1.3) - 0.0095;
    }, (i, j) => (Math.abs(((D(j) - yC + H) % (H * 0.5)) - H * 0.25) < 0.0025 ? GOLD.g : mixc(cov, 0x000000, 0.15)));
    // the right half and the loose page hinge at the gutter, where the two page faces meet, so a
    // turn about it lays the right face onto the left one (and closing folds the book shut)
    const gutter = P(0, 0.21, BOOK_Z - bt / Math.cos(BOOK_TH));
    const coverR = rig.part('cover_r', 'book', gutter);
    half(coverR, -1);
    const page = rig.part('page', 'book', gutter);
    half(page, -1, true);
    if (L.carry === 'ledger' || L.carry === 'tome') {
      // a ribbon bookmark trailing from the spine
      line(book, [P(0, yC - H + 0.004, BOOK_Z - 0.006), P(0.004, yC - H - 0.02, BOOK_Z - 0.004), P(-0.002, yC - H - 0.036, BOOK_Z - 0.008)], L.carry === 'ledger' ? 0xb83a2a : 0xd8b040);
    }
  }

  // overlapping parts never share an exposed cell
  for (const p of rig.parts) {
    if (!p.parent || p.name.startsWith('eye_')) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  for (const p of rig.parts) if (!p.name.startsWith('eye_') && p.name !== 'specs') finish(p.model, { top: 1.03, under: 0.92 });

  rig.socket('head_top', 'head', P(0, HEAD_C[1] + HEAD_R[1] + 0.03, HEAD_C[2]));
  rig.socket('book', 'book', bookPiv);
  rig.socket('mouth', 'head', P(0, 0.27, 0.155));
  // the rest pose height (head top) and the full length lying flat
  const pageFlip = 2 * BOOK_TH - Math.PI;
  return rig.build({
    kind: 'bookworm',
    variant: v,
    name: L.name,
    carry: L.carry,
    height: (HEAD_C[1] + HEAD_R[1]) * s,
    length: 0.8 * s,
    segLength: 0.06 * s,
    radius: 0.06 * s,
    scale: s,
    blink: { close: LID_CLOSE, rest: LID_REST },
    pageFlip,
    bookClose: pageFlip * 0.97,
  });
}

/** a feather quill: a pale shaft with a tapering vane and coloured tip (design metres, unscaled points) */
function quill(m: VoxelModel, base: V3, tip: V3, vane: number, tipCol: number, sc: number) {
  const toV = (q: V3): V3 => [q[0] * sc * K, q[1] * sc * K, q[2] * sc * K];
  const d = norm3(sub3(tip, base));
  const side = norm3(cross3(d, [0, 0, 1]));
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = add3(base, scl3(sub3(tip, base), t));
    const v = toV(p);
    m.set(Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]), 0xf4ecd8);
    if (t < 0.25) continue;
    // the vane: wider in the middle, barbs angled toward the tip, a coloured tip
    const w = Math.sin(((t - 0.25) / 0.75) * Math.PI) * 0.0075 + 0.001;
    for (let q = -1; q <= 1; q += 2)
      for (let k = 1; k <= Math.ceil(w * sc * K); k++) {
        const o = add3(p, add3(scl3(side, (q * k) / (sc * K)), scl3(d, (-k * 0.6) / (sc * K))));
        const ov = toV(o);
        const col = t > 0.78 ? tipCol : (i + k) % 4 === 0 ? mixc(vane, 0x000000, 0.12) : vane;
        m.set(Math.floor(ov[0]), Math.floor(ov[1]), Math.floor(ov[2]), col, VF.SOFTAO);
      }
  }
}

const cache = new Map<number, RigSpec>();
/** a bookworm librarian (0 Inkwell, 1 Old Vellum the elder, 2 Dog-Ear the apprentice, 3 Ledger the archivist) */
export function bookwormRig(variant: number = 0): RigSpec {
  const v = (((variant | 0) % 4) + 4) % 4 as BookwormVariant;
  let r = cache.get(v);
  if (!r) cache.set(v, (r = build(v)));
  return r;
}

// =====================================================================================================
// ANIMATION
// =====================================================================================================
export type BookwormMode = 'idle' | 'read' | 'inch' | 'rear' | 'shelve' | 'look' | 'surprised';

const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();

class Spring {
  x = 0;
  v = 0;
  constructor(public k = 120, public c = 10) {}
  step(target: number, dt: number) {
    const h = Math.min(dt, 1 / 30);
    this.v += (this.k * (target - this.x) - this.c * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}
const SEGS = ['seg0', 'seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'seg6', 'seg7', 'seg8', 'seg9'];
const BW_JOINTS = [...SEGS, 'head', 'jaw', 'hand_l', 'hand_r', 'book', 'specs', 'cap'];

/**
 * Bookworm procedural animation: a damped pose per mode on the segment chain, a
 * travelling peristaltic wave for inching, breathing swell, page turns, blinks,
 * spectacle nudges and a springy tassel.
 *
 *   const anim = new BookwormAnim(rig);
 *   anim.mode = 'inch'; anim.speed = 0.25;   // move rig.root forward by anim.speed * dt yourself
 *   anim.mode = 'shelve'; anim.onShelve = () => rig.setPartVisible('book', false);
 *   anim.flipPage();                          // turn one page now ('read' turns them on its own)
 */
export class BookwormAnim {
  t = 0;
  mode: BookwormMode = 'read';
  /** crawl speed for 'inch' (m/s): the caller moves the root */
  speed = 0.22;
  lookAt: THREE.Vector3 | null = null;
  /** called once at the top of the shelving push (hide the book / place it on the shelf) */
  onShelve: (() => void) | null = null;
  /** seconds into the current mode */
  modeT = 0;
  private cur: Record<string, [number, number, number]> = {};
  private tgt: Record<string, [number, number, number]> = {};
  private base: Record<string, THREE.Euler> = {};
  private wave = 0;
  private pageT = -1;
  private nextPage = 2;
  private closeK = 0;
  private closeTgt = 0;
  private blink = 0;
  private nextBlink = 2;
  private tassel = [new Spring(90, 4), new Spring(90, 4)];
  private specsS = new Spring(200, 12);
  private yaw = 0;
  private tYaw = 0;
  private nextLook = 1;
  private prevMode: BookwormMode = 'read';
  private shelved = false;
  private rnd: () => number;
  private flipA: number;
  private closeA: number;
  private lidClose: number;
  private specsBase: THREE.Vector3 | null = null;

  constructor(public rig: RigInstance, seed = 5) {
    for (const p of rig.geo.parts) this.base[p.name] = p.rest.clone();
    const si = rig.geo.index.specs;
    if (si !== undefined) this.specsBase = rig.geo.parts[si].offset.clone();
    for (const n of BW_JOINTS) {
      this.cur[n] = [0, 0, 0];
      this.tgt[n] = [0, 0, 0];
    }
    let s = (seed * 9301 + 49297) % 233280;
    this.rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    this.t = this.rnd() * 10;
    const m = rig.geo.spec.meta ?? {};
    this.flipA = m.pageFlip ?? -2.4;
    this.closeA = m.bookClose ?? -2.3;
    this.lidClose = m.blink?.close ?? LID_CLOSE;
  }

  /** turn a page now (no-op while one is turning, or for a stack of books) */
  flipPage() {
    if (this.pageT < 0 && this.rig.nodes.page) this.pageT = 0;
  }
  /** push the spectacles back up the nose */
  nudgeSpecs() {
    this.specsS.v -= 6;
  }

  private set(n: string, x: number, y = 0, z = 0) {
    const t = this.tgt[n];
    if (t) (t[0] = x), (t[1] = y), (t[2] = z);
  }
  private add(n: string, x: number, y = 0, z = 0) {
    const t = this.tgt[n];
    if (t) (t[0] += x), (t[1] += y), (t[2] += z);
  }

  update(dt: number) {
    const R = this.rnd;
    this.t += dt;
    const t = this.t;
    if (this.mode !== this.prevMode) {
      this.prevMode = this.mode;
      this.modeT = 0;
      this.shelved = false;
      if (this.mode === 'surprised') (this.specsS.v += 9), (this.tassel[0].v += 8);
    }
    this.modeT += dt;
    const mt = this.modeT;
    for (const n of BW_JOINTS) this.set(n, 0, 0, 0);
    let l = 7;
    let lookW = 1;
    let jaw = 0;
    let lids = 0;
    this.closeTgt = 0;
    // ---------------------------------------------------------------- look
    this.nextLook -= dt;
    if (this.lookAt) {
      this.rig.root.updateWorldMatrix(true, false);
      const p = this.rig.root.worldToLocal(_v.copy(this.lookAt));
      this.tYaw = clamp(Math.atan2(p.x, p.z - 0.1), -0.9, 0.9);
    } else if (this.nextLook <= 0) {
      this.nextLook = 1.2 + R() * 2.5;
      this.tYaw = (R() - 0.5) * 0.9;
    }
    this.yaw = damp(this.yaw, this.tYaw, 4, dt);
    // a slow breathing swell travels up the body
    const swell = (i: number) => Math.sin(t * 2.1 - i * 0.5) * 0.02;
    switch (this.mode) {
      case 'idle':
      case 'read': {
        // settled, reading: the front sways a little, eyes scanning the lines
        for (let i = 1; i < 10; i++) this.set(SEGS[i], swell(i) * 0.4, Math.sin(t * 0.7 + i * 0.3) * 0.015, 0);
        this.set('head', 0.26 + Math.sin(t * 1.1) * 0.03, Math.sin(t * (this.mode === 'read' ? 1.6 : 0.5)) * 0.12, 0);
        lookW = this.mode === 'read' ? 0.15 : 0.7;
        if (this.mode === 'read') {
          this.nextPage -= dt;
          if (this.nextPage <= 0) {
            this.nextPage = 2.2 + R() * 2;
            this.flipPage();
          }
        }
        break;
      }
      case 'inch': {
        // a peristaltic wave from the tail to the head; the front is lowered but the head stays up
        const stride = 0.05;
        this.wave += dt * (this.speed / stride) * Math.PI * 2 * 0.25;
        for (let i = 1; i < 10; i++) this.set(SEGS[i], -Math.sin(this.wave - i * 0.85) * 0.32 * (i < 6 ? 1 : 0.5), Math.sin(this.wave * 0.5 - i * 0.4) * 0.04, 0);
        this.add('seg6', 0.2);
        this.add('seg7', 0.3);
        this.add('seg8', 0.15);
        this.set('head', 0.05, 0, 0);
        this.set('hand_l', -0.2 + Math.sin(this.wave) * 0.15);
        this.set('hand_r', -0.2 - Math.sin(this.wave) * 0.15);
        this.set('seg0', 0, Math.sin(this.wave * 0.5) * 0.04, 0);
        lookW = 0.6;
        l = 12;
        break;
      }
      case 'rear':
      case 'look':
      case 'surprised':
      case 'shelve': {
        // stand up tall off the floor
        const tall = this.mode === 'look' ? 0.55 : 1;
        this.set('seg3', -0.12 * tall);
        this.set('seg4', -0.3 * tall);
        this.set('seg5', -0.42 * tall);
        this.set('seg6', -0.4 * tall);
        this.set('seg7', -0.1 * tall);
        this.set('seg8', 0.06 * tall);
        this.set('seg9', 0.1 * tall);
        this.set('head', this.mode === 'look' ? 0 : 0.15);
        if (this.mode === 'surprised') {
          const k = Math.exp(-mt * 4);
          this.add('seg7', -0.4 * k);
          this.add('seg8', -0.25 * k);
          this.add('head', -0.4 * k);
          this.set('hand_l', -0.9 * k, 0, 0.4 * k);
          this.set('hand_r', -0.9 * k, 0, -0.4 * k);
          jaw = 0.5 * k;
          lids = -0.15;
        }
        if (this.mode === 'shelve') {
          // close the book, reach forward and up, push it home, settle back
          const reach = sstep(0.45, 0.9, mt) * (1 - sstep(1.5, 2.0, mt));
          this.closeTgt = sstep(0.1, 0.45, mt) * (1 - sstep(2.0, 2.4, mt));
          this.add('seg8', 0.4 * reach);
          this.add('seg9', 0.35 * reach);
          this.add('head', -0.55 * reach);
          this.set('hand_l', -1.0 * reach, 0, -0.1 * reach);
          this.set('hand_r', -1.0 * reach, 0, 0.1 * reach);
          this.set('book', 0.22 * reach);
          if (!this.shelved && mt > 1.0) {
            this.shelved = true;
            this.onShelve?.();
          }
          if (mt > 2.6) this.mode = 'read';
        }
        l = this.mode === 'surprised' ? 16 : 6;
        lookW = 0.8;
        break;
      }
    }
    // off the floor the head levels itself against the bend of the body, so it never ends up face-down
    if (this.mode !== 'read' && this.mode !== 'idle') {
      let bend = 0;
      for (let i = 1; i < 10; i++) bend += this.tgt[SEGS[i]][0];
      this.add('head', -bend * 0.9, 0, 0);
    }
    this.add('head', 0, this.yaw * lookW, 0);
    this.add('seg9', 0, this.yaw * 0.25 * lookW, 0);
    const k = 1 - Math.exp(-l * dt);
    for (const n of BW_JOINTS) {
      const c = this.cur[n], g = this.tgt[n];
      c[0] += (g[0] - c[0]) * k;
      c[1] += (g[1] - c[1]) * k;
      c[2] += (g[2] - c[2]) * k;
    }
    this.closeK = damp(this.closeK, this.closeTgt, 7, dt);

    // ---------------------------------------------------------------- page turning (hand helps)
    let page = 0;
    let handHelp = 0;
    if (this.pageT >= 0) {
      this.pageT += dt;
      const f = clamp((this.pageT - 0.12) / 0.5, 0, 1);
      page = f * f * (3 - 2 * f);
      handHelp = Math.sin(Math.PI * clamp(this.pageT / 0.62, 0, 1));
      if (this.pageT > 0.7) this.pageT = -1;
    }
    // blinks, chatter-free mouth breathing, spectacles and tassel springs
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 1.8 + R() * 3.4;
      this.blink = 0.15;
      if (R() < 0.18) this.nudgeSpecs();
    }
    this.blink = Math.max(0, this.blink - dt);
    let shut = lids;
    if (this.blink > 0) shut = Math.max(shut, Math.sin((this.blink / 0.15) * Math.PI));
    const sp = this.specsS.step(0, dt);
    const ta = this.tassel[0].step(-this.cur.head[0] * 0.6 - this.cur.seg9[0] * 0.4, dt);
    const tb = this.tassel[1].step(-this.cur.head[1] * 0.5, dt);

    const rot = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n];
      const b = this.base[n];
      if (node && b) node.rotation.set(b.x + x, b.y + y, b.z + z);
    };
    for (const n of SEGS) {
      const c = this.cur[n];
      rot(n, c[0], c[1], c[2]);
    }
    const hc = this.cur.head;
    rot('head', hc[0], hc[1], hc[2]);
    rot('jaw', clamp(jaw + Math.max(0, Math.sin(t * 1.7)) * 0.04, 0, 0.6), 0, 0);
    rot('hand_l', this.cur.hand_l[0], this.cur.hand_l[1], this.cur.hand_l[2]);
    rot('hand_r', this.cur.hand_r[0] - handHelp * 0.35, this.cur.hand_r[1] + handHelp * 0.4, this.cur.hand_r[2]);
    rot('book', this.cur.book[0], this.cur.book[1], this.cur.book[2]);
    rot('cover_r', 0, this.closeK * this.closeA, 0);
    rot('page', 0, page * this.flipA, 0);
    // the loose page only shows while it turns (at rest it lies in the face of the block)
    if (this.rig.nodes.page) this.rig.nodes.page.visible = page > 0.02 && page < 0.98 && this.closeK < 0.05;
    rot('specs', sp * 0.06, 0, 0);
    const so = this.specsBase;
    if (so) this.rig.nodes.specs?.position.set(so.x, so.y - sp * 0.004, so.z);
    rot('cap', 0, 0, 0);
    rot('tassel', ta * 0.5, 0, tb * 0.5 + Math.sin(t * 1.3) * 0.05);
    const lid = clamp(shut, -0.2, 1) * this.lidClose;
    rot('lid_l', lid, 0, 0);
    rot('lid_r', lid, 0, 0);
    // the body swells with each breath, segment by segment
    for (let i = 0; i < 10; i++) {
      const sw = 1 + swell(i) * 0.6;
      this.rig.nodes[SEGS[i]]?.scale.set(sw, sw, 1);
    }
  }
}
