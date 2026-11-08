// The bookworms: the librarians of Thoth's Hall, who are EARTHWORMS. Long, soft,
// moist and eyeless, they read by touch and carry the books about in their mouths.
//
// The body (sculpted, one part per physics segment):
//   - a ringed body of annuli (three real grooves per segment) in dusky pink-brown,
//     darker along the back with the dorsal blood vessel showing, paler below;
//   - the saddle (clitellum): a smooth, swollen, orange-pink band a third of the
//     way back, with no rings;
//   - a moist sheen (glossy glints along the back), fine pale bristles (setae) in
//     pairs on every annulus, a tail that tapers to a blunt, slightly flat end;
//   - a blunt, eyeless head: a rounded prostomium lobe overhanging a small mouth
//     with its own lower lip. No eyes, no spectacles.
// The props stay: a tiny cap on the head, a quill tucked into a fold of the saddle,
// and something to read (an open book that lies on the floor while it reads and is
// carried shut in the mouth when it moves; the apprentice balances a stack of books
// on its saddle).
//
// Variants (bookwormRig(v)):
//   0 bookworm             "Inkwell"    dusky pink-brown, a maroon fez with a tassel, an open book
//   1 bookworm_elder       "Old Vellum"  long and pale mauve, a lapis skullcap, a big old tome
//   2 bookworm_apprentice  "Dog-Ear"    small and bright pink, a floppy linen cap, a stack of books on its saddle
//   3 bookworm_archivist   "Ledger"     deep red-brown, a green eyeshade (it has no eyes, it likes the look), a ledger
//
// RIG (faces +Z, LEFT = +X, origin on the floor under the head joint, 1/160 m). The
// hierarchy is FLAT so the physics can place every segment:
//   body (root, empty) → head (→ jaw, cap → tassel), seg1 … seg12 (head to tail), book (→ cover_r, page)
// meta.restPts: the physics particles at rest (root-local metres; 0 = head joint, 12 = tail tip),
// meta.radii: their radii. Each seg{i} spans particles i-1 (front) … i (rear).
// BookwormAnim (bottom of this file) runs a position-based physics chain: length and
// bending constraints, gravity, ground contact with bristle friction (they slide
// forward, grip backward), peristaltic contraction waves that push the body along,
// muscles that lift the front to rear up (and sag under their own weight), and a
// wobbly settle. The caller moves rig.root (the head goes where the root is).
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, blob, ell, cap, line, paint, exposed, thicken, splitInto, finish, mixc, n01, h01, add3, sub3, scl3, norm3, cross3, dot3, sstep, clamp01, rotXYZ, invXYZ } from './ckit';
import type { V3, RigSpec, Col } from './ckit';

const VS = 1 / 160;
const K = 1 / VS;

export type BookwormVariant = 0 | 1 | 2 | 3;
interface WormLook {
  name: string;
  scale: number;
  base: number;
  back: number;
  belly: number;
  saddle: number;
  groove: number;
  glint: number;
  cap: 'fez' | 'skullcap' | 'slouch' | 'visor';
  carry: 'book' | 'tome' | 'stack' | 'ledger';
  cover: number;
}
export const BOOKWORMS: WormLook[] = [
  { name: 'Inkwell', scale: 1, base: 0xc27a6a, back: 0x9a524a, belly: 0xe2ab98, saddle: 0xdc8a62, groove: 0x7e403a, glint: 0xf6ccbc, cap: 'fez', carry: 'book', cover: 0x7a2a26 },
  { name: 'Old Vellum', scale: 1.15, base: 0xb48a8a, back: 0x8a6264, belly: 0xdcbcb6, saddle: 0xc89480, groove: 0x6e4c4e, glint: 0xf0dad4, cap: 'skullcap', carry: 'tome', cover: 0x24427e },
  { name: 'Dog-Ear', scale: 0.8, base: 0xe0868a, back: 0xbc5e66, belly: 0xf6b8b4, saddle: 0xf09a78, groove: 0x9a4650, glint: 0xffdcda, cap: 'slouch', carry: 'stack', cover: 0x2e6a52 },
  { name: 'Ledger', scale: 1.05, base: 0xa45a4c, back: 0x7a3a34, belly: 0xcc8a78, saddle: 0xc8704c, groove: 0x5e2a26, glint: 0xeab0a0, cap: 'visor', carry: 'ledger', cover: 0x2f5e3a },
];
const GOLD = { g: 0xe2b24a, l: 0xffe08a, s: 0xa8782a };
const PAPER = { p: 0xf0e4c4, s: 0xd8c8a0, line: 0xa8987a };

// ---------------------------------------------------------------- body plan (design metres, unscaled)
const NS = 12;
const SEG_L = 0.058;
/** segment radii, head to tail; seg3 and seg4 are the swollen saddle */
const SEG_R = [0.034, 0.036, 0.042, 0.043, 0.037, 0.036, 0.035, 0.034, 0.032, 0.029, 0.025, 0.02];
const SADDLE = [3, 4];
/** particle radii (0 = head joint … NS = tail tip) */
const PART_R = Array.from({ length: NS + 1 }, (_, i) => (i === 0 ? 0.034 : i === NS ? 0.017 : (SEG_R[i - 1] + SEG_R[i]) / 2));
/** the book: half opening angle, and where it lies open on the floor while being read (spine point) */
const BOOK_TH = 0.22;
const BOOK_AT: V3 = [0, 0.004, 0.088];

function build(v: BookwormVariant): RigSpec {
  const L = BOOKWORMS[v];
  const s = L.scale;
  const U = (m: number) => m * s * K;
  const P = (x: number, y: number, z: number): V3 => [x * s * K, y * s * K, z * s * K];
  const Pv = (q: V3): V3 => [q[0] * s * K, q[1] * s * K, q[2] * s * K];
  const D = (i: number) => (i + 0.5) / (s * K);
  const rig = new CRig(['bookworm', 'bookworm_elder', 'bookworm_apprentice', 'bookworm_archivist'][v], VS);
  const seed = 11 + v * 7;
  const sdf = (m: VoxelModel, lo: V3, hi: V3, f: (x: number, y: number, z: number) => number, col: Col, fl?: number) => {
    for (let i = Math.floor(U(lo[0])); i <= Math.ceil(U(hi[0])); i++)
      for (let j = Math.floor(U(lo[1])); j <= Math.ceil(U(hi[1])); j++)
        for (let k = Math.floor(U(lo[2])); k <= Math.ceil(U(hi[2])); k++) {
          if (f(D(i), D(j), D(k)) > 0) continue;
          const c = typeof col === 'number' ? col : col(i, j, k);
          if (c !== null) m.set(i, j, k, c, fl);
        }
  };
  const pts: V3[] = PART_R.map((r, i) => [0, r, -i * SEG_L]);

  rig.part('body', undefined, [0, 0, 0]);

  // ================================================================ the ringed body
  /** colour of the skin at a point, given the segment axis */
  const skin = (i: number, j: number, k: number, a: V3, dir: V3, len: number, saddle: boolean) => {
    const p: V3 = [D(i), D(j), D(k)];
    const rel = sub3(p, a);
    const t = dot3(rel, dir) / len;
    const rad = sub3(rel, scl3(dir, t * len));
    const up = norm3(cross3([1, 0, 0], dir));
    const rl = Math.hypot(rad[0], rad[1], rad[2]) || 1;
    const back = dot3(rad, up) / rl; // +1 along the back, -1 the belly
    const n = n01(i, j, k, 0.3, seed);
    let c = L.base;
    if (back > 0.25) c = mixc(L.base, L.back, sstep(0.25, 0.85, back) * 0.85);
    else if (back < -0.3) c = mixc(L.base, L.belly, sstep(-0.3, -0.8, back));
    if (saddle) c = mixc(c, L.saddle, 0.8);
    // the dorsal blood vessel along the spine
    if (!saddle && back > 0.93 && Math.abs(rad[0]) < 0.0045) c = mixc(L.back, 0x7a2424, 0.5);
    if (n > 0.68) c = mixc(c, L.glint, 0.18);
    else if (n < 0.28) c = mixc(c, L.groove, 0.12);
    return c;
  };
  for (let si = 1; si <= NS; si++) {
    const a = pts[si], b = pts[si - 1]; // rear, front
    const dir = norm3(sub3(b, a));
    const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
    const R = SEG_R[si - 1];
    const saddle = SADDLE.includes(si);
    const c = scl3(add3(a, b), 0.5);
    const seg = rig.part('seg' + si, 'body', Pv(c));
    const pitch = -Math.atan2(dir[1], dir[2]);
    const tail = si === NS;
    blob(seg, [
      { a: Pv(sub3(a, scl3(dir, tail ? 0 : len * 0.1))), b: Pv(add3(b, scl3(dir, len * 0.1))), r0: U(tail ? R * 0.7 : R * 0.9), r1: U(R * 0.92) },
      { c: Pv(c), r: [U(R * (saddle ? 1.06 : 1.02)), U(R * (saddle ? 1.04 : 1.0)), U(len * 0.5)], rot: [pitch, 0, 0] },
      ...(tail ? [{ c: Pv(add3(a, scl3(dir, -0.006))), r: [U(R * 0.9), U(R * 0.62), U(0.016)] as V3, rot: [pitch, 0, 0] as V3 }] : []),
    ], (i, j, k) => skin(i, j, k, a, dir, len, saddle), { k: U(0.01), keep: (_x, y) => D(y) > c[1] - R * 0.92 - 0.002 });
    // annuli: three real grooves per segment (the saddle is smooth), with paired bristles on each ring
    if (!saddle) {
      const aV = Pv(a), lenV = U(len), RV = U(R);
      for (const f of [0.17, 0.5, 0.83]) {
        const del: V3[] = [];
        seg.forEach((x, y, z) => {
          const rel = sub3([x + 0.5, y + 0.5, z + 0.5], aV);
          const t = dot3(rel, dir) / lenV;
          if (Math.abs(t - f) * lenV > 0.55 || !exposed(seg, x, y, z)) return;
          const rad = sub3(rel, scl3(dir, t * lenV));
          if (Math.hypot(rad[0], rad[1], rad[2]) > RV * 0.8) del.push([x, y, z]);
        });
        for (const [x, y, z] of del) seg.del(x, y, z);
        // the groove floor goes dark
        for (const [x, y, z] of del)
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[])
            if (seg.has(x + dx, y + dy, z + dz)) seg.set(x + dx, y + dy, z + dz, L.groove);
        // bristles: two pairs low on each flank, a pale voxel standing out of the ring between the grooves
        if (f < 0.8) {
          const mid = add3(a, scl3(dir, (f + 0.17) * len));
          const up = norm3(cross3([1, 0, 0], dir));
          for (const ang of [2.2, -2.2]) {
            const o = add3(scl3(up, Math.cos(ang)), [Math.sin(ang), 0, 0]);
            const vq = Pv(add3(mid, scl3(o, R * 1.06)));
            seg.set(Math.floor(vq[0]), Math.floor(vq[1]), Math.floor(vq[2]), mixc(L.belly, 0xfff4ea, 0.35));
          }
        }
      }
    }
    // the moist sheen: wet glints along the back
    paint(seg, (x, y, z) => !seg.has(x, y + 1, z) && h01(x, y, z, seed + si) < 0.12, L.glint, VF.METAL);
    if (si === 3) {
      // a quill tucked into a fold of the saddle
      const R3 = SEG_R[2];
      quill(seg, add3(c, [0.012, R3 * 0.95, 0.014]), add3(c, [0.042, R3 + 0.052, -0.04]), 0xf4ecdc, L.carry === 'ledger' ? 0x3f6a8a : 0xa04a3a, s);
    }
  }
  // the apprentice balances a stack of books on its saddle (part of seg3, so it rides along)
  if (L.carry === 'stack') {
    const seg = rig.m('seg3');
    const c = scl3(add3(pts[2], pts[3]), 0.5);
    const top = c[1] + SEG_R[2] * 0.95;
    const books: [number, number, number, number, number][] = [
      [top + 0.012, 0.034, 0.012, 0.046, L.cover],
      [top + 0.035, 0.03, 0.011, 0.042, 0x8a3a2a],
      [top + 0.056, 0.032, 0.01, 0.04, 0x34507e],
    ];
    books.forEach(([y, bw, bh, bd, col], bi) => {
      const cc: V3 = [0.002 * (bi - 1), y, c[2]];
      const rot = (bi - 1) * 0.16;
      const loc = (x: number, yy: number, z: number): V3 => invXYZ(sub3([x, yy, z], cc), [0, rot, 0]);
      sdf(seg, sub3(cc, [0.06, 0.02, 0.06]), add3(cc, [0.06, 0.02, 0.06]), (x, yy, z) => {
        const q = loc(x, yy, z);
        const qx = Math.abs(q[0]) - bw + 0.003, qy = Math.abs(q[1]) - bh + 0.003, qz = Math.abs(q[2]) - bd + 0.003;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.003;
      }, (i, j, k) => {
        const q = loc(D(i), D(j), D(k));
        const coverY = Math.abs(q[1]) > bh - 0.0066;
        const spine = q[0] > bw - 0.0066;
        if (!coverY && !spine) return Math.abs(q[1]) % 0.0128 < 0.0064 ? PAPER.s : PAPER.p;
        if (spine && Math.abs(Math.abs(q[2]) - bd * 0.5) < 0.004) return GOLD.g;
        if (coverY && Math.abs(Math.abs(q[2]) - (bd - 0.009)) < 0.0035 && Math.abs(q[0]) < bw - 0.006) return GOLD.g;
        return n01(i, j, k, 0.5, bi) > 0.62 ? mixc(col, 0xffffff, 0.12) : col;
      });
    });
  }

  // ================================================================ the head: blunt, eyeless, a small mouth
  const r0 = PART_R[0];
  const head = rig.part('head', 'body', Pv(pts[0]));
  const headCol = (i: number, j: number, k: number) => {
    const Y = D(j), Z = D(k);
    const n = n01(i, j, k, 0.3, seed + 40);
    let c = Y > r0 + 0.012 ? mixc(L.base, L.back, 0.7) : Y < r0 - 0.014 ? mixc(L.base, L.belly, 0.7) : L.base;
    if (Z > 0.04) c = mixc(c, L.glint, 0.25); // the soft pink tip of the prostomium
    if (n > 0.66) c = mixc(c, L.glint, 0.2);
    return c;
  };
  blob(head, [
    { a: P(0, r0, -0.024), b: P(0, r0 + 0.002, 0.028), r0: U(0.034), r1: U(0.03) },
    { c: P(0, r0 + 0.006, 0.048), r: P(0.023, 0.021, 0.025) }, // the prostomium lobe
    { c: P(0, r0 - 0.012, 0.04), r: P(0.024, 0.016, 0.021) }, // the chin under the mouth
  ], headCol, { k: U(0.012), keep: (_x, y) => D(y) > 0.001 });
  // two rings on the head too
  for (const z0 of [-0.006, 0.013]) {
    const del: V3[] = [];
    head.forEach((x, y, z) => {
      if (Math.abs(D(z) - z0) * s * K < 0.55 && exposed(head, x, y, z) && Math.hypot(D(x), D(y) - r0) > 0.026) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) head.del(x, y, z);
  }
  paint(head, (x, y, z) => !head.has(x, y + 1, z) && h01(x, y, z, seed + 50) < 0.16, L.glint, VF.METAL);
  // the mouth: a small curved smile under the lobe; the lower lip is its own part
  const mouthY = (X: number) => r0 - 0.005 + 40 * X * X;
  const jaw = rig.part('jaw', 'head', P(0, r0 - 0.01, 0.022));
  {
    const tmp = new VoxelModel('h');
    head.forEach((x, y, z, c, f) => tmp.set(x, y, z, c, f));
    head.map.clear();
    splitInto(tmp, head, jaw, (x, y, z) => D(z) > 0.024 && D(y) < mouthY(D(x)) && Math.abs(D(x)) < 0.02);
    const empty = (x: number, y: number, z: number) => !head.has(x, y, z) && !jaw.has(x, y, z);
    jaw.forEach((x, y, z) => {
      if (!jaw.has(x, y + 1, z)) jaw.set(x, y, z, empty(x, y, z + 1) || empty(x + 1, y, z) || empty(x - 1, y, z) ? 0x4a1e1e : 0xc0606a);
    });
    head.forEach((x, y, z) => {
      if (jaw.has(x, y - 1, z) && (empty(x, y, z + 1) || empty(x + 1, y, z) || empty(x - 1, y, z))) head.set(x, y, z, 0x4a1e1e);
    });
  }

  // ================================================================ caps
  const hatTop = r0 + 0.031;
  if (L.cap === 'fez') {
    const capP = rig.part('cap', 'head', P(0, hatTop - 0.006, 0.01));
    const base: V3 = [0, hatTop - 0.01, 0.01];
    const rot: V3 = [-0.16, 0, -0.14];
    const H = 0.042;
    sdf(capP, sub3(base, [0.05, 0.02, 0.05]), add3(base, [0.05, 0.07, 0.05]), (x, y, z) => {
      const q = invXYZ(sub3([x, y, z], base), rot);
      const t = clamp01(q[1] / H);
      const r = 0.031 - 0.007 * t;
      const dr = Math.hypot(q[0], q[2]) - r, dy = Math.max(q[1] - H, -q[1]);
      return Math.hypot(Math.max(dr + 0.004, 0), Math.max(dy + 0.004, 0)) + Math.min(Math.max(dr, dy), 0) - 0.004;
    }, (i, j, k) => {
      const q = invXYZ(sub3([D(i), D(j), D(k)], base), rot);
      const n = n01(i, j, k, 0.35, 7);
      let c = n > 0.62 ? 0xa83a3a : n < 0.3 ? 0x7a2228 : 0x922e30;
      if (q[1] < 0.007) c = 0x6a1c20;
      if (q[1] > H - 0.003 && Math.hypot(q[0], q[2]) < 0.006) c = 0x1a1414;
      return c;
    }, VF.SOFTAO);
    const top = add3(base, rotXYZ([0, H, 0], rot));
    const tassel = rig.part('tassel', 'cap', Pv(top));
    const knot = add3(top, rotXYZ([-0.024, -0.004, 0.004], rot));
    line(tassel, [Pv(top), Pv(knot)], 0x221a1a);
    ell(tassel, Pv(knot), P(0.004, 0.004, 0.004), GOLD.g, { fl: VF.METAL });
    for (let q = 0; q < 7; q++) {
      const a = (q / 7) * Math.PI * 2;
      const o: V3 = [Math.cos(a) * 0.0036, 0, Math.sin(a) * 0.0036];
      line(tassel, [Pv(add3(knot, o)), Pv(add3(knot, add3(scl3(o, 1.6), [0, -0.028 - (q & 1) * 0.004, 0])))], q & 1 ? 0x2a2020 : 0x141010);
    }
  } else if (L.cap === 'skullcap') {
    const capP = rig.part('cap', 'head', P(0, hatTop - 0.004, 0.004));
    const colAt = (x: number, y: number, z: number) => {
      const X = D(x), Y = D(y), Z = D(z) - 0.004;
      if (Y < r0 + 0.021) return GOLD.g;
      const a = Math.atan2(X, Z);
      if (Math.abs((((a / (Math.PI / 3)) % 1) + 1) % 1 - 0.5) > 0.44) return 0x3a5aa0;
      return n01(x, y, z, 0.4, 3) > 0.6 ? 0x2c4c94 : 0x22407e;
    };
    head.forEach((x, y, z) => {
      if (D(y) > r0 + 0.017 && exposed(head, x, y, z) && D(z) < 0.034) capP.set(x, y, z, colAt(x, y, z), VF.SOFTAO);
    });
    thicken(capP, () => true, (x, y, z) => (head.has(x, y, z) ? null : colAt(x, y, z)), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]], VF.SOFTAO);
    paint(capP, (_x, y) => D(y) < r0 + 0.021, GOLD.g, VF.METAL);
    ell(capP, P(0, hatTop + 0.006, 0.006), P(0.005, 0.0045, 0.005), GOLD.l, { fl: VF.METAL });
  } else if (L.cap === 'slouch') {
    const capP = rig.part('cap', 'head', P(0, hatTop - 0.006, 0.006));
    blob(capP, [
      { c: P(-0.004, hatTop - 0.002, 0.006), r: P(0.044, 0.02, 0.044), rot: [0, 0, 0.2] },
      { c: P(-0.038, hatTop - 0.012, 0.004), r: P(0.022, 0.017, 0.032), rot: [0, 0, 0.55] },
    ], (i, j, k) => {
      const n = n01(i, j, k, 0.3, 9);
      return n > 0.6 ? 0xf0e6cc : n < 0.32 ? 0xcfc2a2 : 0xe2d6b8;
    }, { k: U(0.01), keep: (x, y, z) => !head.has(x, y, z) && D(y) > hatTop - 0.022 - (D(x) < -0.02 ? 0.012 : 0) });
    paint(capP, (x, y, z) => !capP.has(x, y - 1, z) && !head.has(x, y - 1, z), (i, _j, k) => ((i + k) % 3 === 0 ? 0x8a6a4a : 0xc4b28c));
    cap(capP, P(-0.003, hatTop + 0.014, 0.004), P(-0.002, hatTop + 0.024, 0.003), U(0.0035), U(0.0028), 0xb8a47c);
  } else {
    // the green eyeshade: a band round the head and a curved translucent brim (no eyes to shade; it likes the look)
    const capP = rig.part('cap', 'head', P(0, r0 + 0.016, 0.006));
    const bandY0 = r0 + 0.012, bandY1 = r0 + 0.021;
    head.forEach((x, y, z) => {
      if (D(y) >= bandY0 && D(y) <= bandY1 && exposed(head, x, y, z)) capP.set(x, y, z, 0x2a5a36);
    });
    thicken(capP, () => true, (x, y, z) => (head.has(x, y, z) ? null : 0x2f6a3e), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
    for (let a = -1.0; a <= 1.0; a += 0.015)
      for (let r = 0.03; r <= 0.062; r += 0.003) {
        const t = (r - 0.03) / 0.032;
        const X = Math.sin(a) * r, Z = 0.012 + Math.cos(a) * r;
        const Y = bandY0 + 0.004 - t * 0.01;
        const edge = t > 0.86 || Math.abs(a) > 0.94;
        for (const dy of [0, -1]) capP.set(Math.floor(U(X)), Math.floor(U(Y)) + dy, Math.floor(U(Z)), edge ? 0x1e4a2c : dy ? 0x3f8a58 : 0x5eaa76, VF.SOFTAO);
      }
    quill(capP, [0.026, r0 + 0.016, 0.0], [0.05, r0 + 0.075, -0.03], 0xf6f2e8, 0xa04a3a, s);
  }

  // ================================================================ the book (opens flat on the floor, shuts to be carried)
  let bookInfo: { pageFlip: number; bookClose: number } | null = null;
  if (L.carry !== 'stack') {
    const hw = L.carry === 'tome' ? 0.062 : 0.05;
    const H = (L.carry === 'tome' ? 0.088 : 0.07) / 2;
    const bt = L.carry === 'tome' ? 0.022 : 0.018;
    const ct = 0.0068;
    const S = BOOK_AT;
    const cov = L.cover;
    const book = rig.part('book', 'body', Pv(S));
    const half = (m: VoxelModel, sd: number, pageOnly = false) => {
      // leaf frame: u from the spine along the leaf, h out through the cover (the pages face up)
      const dirU: V3 = [Math.cos(BOOK_TH) * sd, Math.sin(BOOK_TH), 0];
      const nOut: V3 = [Math.sin(BOOK_TH) * sd, -Math.cos(BOOK_TH), 0];
      sdf(m, [S[0] - hw - 0.02, S[1] - 0.02, S[2] - H - 0.01], [S[0] + hw + 0.02, S[1] + 0.05, S[2] + H + 0.01], (x, y, z) => {
        const q = sub3([x, y, z], S);
        const u = dot3(q, dirU), h = dot3(q, nOut), w = q[2];
        const th1 = pageOnly ? -bt + 0.0068 : 0;
        if (u < 0 || u > hw - (pageOnly ? 0.004 : 0)) return 1;
        if (Math.abs(w) > H - (pageOnly ? 0.004 : 0)) return 1;
        if (h < -bt || h > th1) return 1;
        return -1;
      }, (i, j, k) => {
        const q = sub3([D(i), D(j), D(k)], S);
        const u = dot3(q, dirU), h = dot3(q, nOut), w = q[2];
        if (pageOnly || h < -ct) {
          if (h < -bt + 0.0034 || pageOnly) {
            const row = Math.floor((w + H) / 0.0064);
            const ln = (w + H) % 0.0064 < 0.0024 && u > 0.008 && u < hw - 0.01 && h01(row, Math.floor(u / 0.012), sd, 4) > 0.15;
            return ln ? PAPER.line : PAPER.p;
          }
          return Math.floor(h / 0.0064) & 1 ? PAPER.s : PAPER.p;
        }
        const fu = u / hw, fw = Math.abs(w) / H;
        if ((Math.abs(fu - 0.86) < 0.07 && fw < 0.9) || (fw > 0.8 && fw < 0.92 && fu < 0.86)) return GOLD.g;
        if (fu > 0.9 && fw > 0.86) return GOLD.l;
        const em = Math.hypot((u - hw * 0.45) / 0.014, w / 0.011);
        if (em < 1 && em > 0.55) return GOLD.g;
        if (em <= 0.35) return GOLD.l;
        if (L.carry === 'ledger' && Math.abs(fw - 0.5) < 0.06 && fu < 0.3) return 0xa83a2a;
        const n = n01(i, j, k, 0.45, 2);
        return n > 0.62 ? mixc(cov, 0xffffff, 0.12) : n < 0.3 ? mixc(cov, 0x000000, 0.2) : cov;
      });
    };
    half(book, 1);
    // the spine: rounded leather with gilt bands
    sdf(book, [S[0] - 0.014, S[1] - 0.01, S[2] - H - 0.004], [S[0] + 0.014, S[1] + 0.02, S[2] + H + 0.004], (x, y, z) => {
      if (Math.abs(z - S[2]) > H) return 1;
      return Math.hypot(x - S[0], (y - S[1] - 0.003) * 1.3) - 0.009;
    }, (_i, _j, k) => (Math.abs(((D(k) - S[2] + H) % (H * 0.5)) - H * 0.25) < 0.0028 ? GOLD.g : mixc(cov, 0x000000, 0.15)));
    // the right half and the loose page hinge at the gutter, where the two page faces meet
    const gutter = P(S[0], S[1] + bt / Math.cos(BOOK_TH), S[2]);
    half(rig.part('cover_r', 'book', gutter), -1);
    half(rig.part('page', 'book', gutter), -1, true);
    if (L.carry !== 'book') line(book, [P(S[0], S[1] + 0.006, S[2] - H + 0.004), P(S[0] + 0.004, S[1] + 0.004, S[2] - H - 0.02), P(S[0] - 0.002, S[1] + 0.002, S[2] - H - 0.034)], L.carry === 'ledger' ? 0xb83a2a : 0xd8b040);
    const flip = 2 * BOOK_TH - Math.PI;
    bookInfo = { pageFlip: flip, bookClose: flip * 0.97 };
  }

  // overlapping parts never share an exposed cell (seams stay clean)
  for (const p of rig.parts) {
    if (!p.parent || p.parent === 'body') continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  for (const p of rig.parts) if (p.name !== 'body') finish(p.model, { top: 1.03, under: 0.9 });

  rig.socket('head_top', 'head', P(0, hatTop + 0.02, 0.01));
  rig.socket('mouth', 'head', P(0, r0 - 0.012, 0.06));
  return rig.build({
    kind: 'bookworm',
    variant: v,
    name: L.name,
    carry: L.carry,
    height: (r0 * 2 + 0.03) * s,
    length: (NS * SEG_L + 0.075) * s,
    segLength: SEG_L * s,
    radius: 0.04 * s,
    scale: s,
    segments: NS,
    restPts: pts.map((q) => scl3(q, s)),
    radii: PART_R.map((r) => r * s),
    bookAt: scl3(BOOK_AT, s),
    pageFlip: bookInfo?.pageFlip ?? 0,
    bookClose: bookInfo?.bookClose ?? 0,
  });
}

/** a feather quill: a pale shaft, a tapering vane with barbs and a coloured tip (design metres, unscaled) */
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
  const v = ((((variant | 0) % 4) + 4) % 4) as BookwormVariant;
  let r = cache.get(v);
  if (!r) cache.set(v, (r = build(v)));
  return r;
}

// =====================================================================================================
// PHYSICS + ANIMATION
// =====================================================================================================
export type BookwormMode = 'idle' | 'read' | 'inch' | 'rear' | 'shelve' | 'look' | 'surprised';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _inv = new THREE.Matrix4();

/** the rotation of an orthonormal frame looking along `fwd` with its up kept as close to world up as it can */
function frame(fwd: THREE.Vector3, prevSide: THREE.Vector3, out: THREE.Quaternion) {
  const side = _c.crossVectors(UP, fwd);
  if (side.lengthSq() < 1e-6) side.copy(prevSide);
  side.normalize();
  prevSide.copy(side);
  const up = _d.crossVectors(fwd, side).normalize();
  _m.makeBasis(side, up, fwd);
  return out.setFromRotationMatrix(_m);
}

/**
 * The earthworm's body is a position-based physics chain (world space, fixed
 * 120 Hz sub-steps): Verlet integration with gravity, link-length constraints
 * whose rest lengths pulse in peristaltic waves running head to tail, soft bending
 * constraints, ground contact with bristle friction (forward slides, backward
 * grips: the waves ratchet the body along), a head that seeks the rig root, and
 * muscles that lift the front end to rear up (it sags under its own weight and
 * wobbles as it settles). The segment parts are then placed on the chain,
 * swelling as they contract and thinning as they stretch.
 *
 *   const anim = new BookwormAnim(rig);
 *   anim.mode = 'inch'; anim.speed = 0.22;   // move rig.root yourself: the head follows it, the body crawls after
 *   anim.mode = 'shelve'; anim.onShelve = () => ...;
 *   anim.flipPage();                          // turn one page now ('read' turns them on its own)
 */
export class BookwormAnim {
  t = 0;
  mode: BookwormMode = 'read';
  /** crawl speed for 'inch' (m/s): the caller moves the root, this paces the contraction waves */
  speed = 0.22;
  /** world point to look toward ('look', 'rear', 'idle', 'surprised') */
  lookAt: THREE.Vector3 | null = null;
  /** called once at the top of the shelving push */
  onShelve: (() => void) | null = null;
  /** seconds into the current mode */
  modeT = 0;
  private n: number;
  private p: THREE.Vector3[] = [];
  private q: THREE.Vector3[] = [];
  private rest: THREE.Vector3[] = [];
  private rad: number[];
  private len0: number[] = [];
  private len: number[] = [];
  private restQ: THREE.Quaternion[] = [];
  private sides: THREE.Vector3[] = [];
  private headSide = new THREE.Vector3(1, 0, 0);
  private segN: (THREE.Object3D | undefined)[] = [];
  private inited = false;
  private lastRoot = new THREE.Vector3();
  private phase = 0;
  private amp = 0.03;
  private rearH = 0;
  private rearM = 4;
  private push = 0;
  private nod = 0;
  private turn = 0;
  private carry = 0;
  private pageT = -1;
  private nextPage = 2;
  private prevMode: BookwormMode = 'read';
  private shelved = false;
  private tassel = { x: 0, v: 0 };
  private rnd: () => number;
  private scale: number;
  private bookAt: THREE.Vector3;
  private flipA: number;
  private closeA: number;
  private acc = 0;

  constructor(public rig: RigInstance, seed = 5) {
    const m = rig.geo.spec.meta ?? {};
    const pts: V3[] = m.restPts ?? [];
    this.n = pts.length;
    this.rad = m.radii ?? pts.map(() => 0.03);
    this.scale = m.scale ?? 1;
    this.bookAt = new THREE.Vector3(...((m.bookAt as V3) ?? [0, 0, 0.1]));
    this.flipA = m.pageFlip ?? -2.7;
    this.closeA = m.bookClose ?? -2.6;
    for (const r of pts) {
      this.rest.push(new THREE.Vector3(r[0], r[1], r[2]));
      this.p.push(new THREE.Vector3());
      this.q.push(new THREE.Vector3());
    }
    for (let i = 0; i < this.n - 1; i++) {
      this.len0.push(this.rest[i].distanceTo(this.rest[i + 1]));
      this.len.push(this.len0[i]);
    }
    // each segment's rest frame (its sculpted orientation)
    for (let i = 1; i < this.n; i++) {
      const f = new THREE.Vector3().subVectors(this.rest[i - 1], this.rest[i]).normalize();
      const sd = new THREE.Vector3(1, 0, 0);
      this.restQ.push(frame(f, sd, new THREE.Quaternion()));
      this.sides.push(sd);
      this.segN.push(rig.nodes['seg' + i]);
    }
    if (rig.meshes.body) rig.meshes.body.visible = false;
    let s = (seed * 9301 + 49297) % 233280;
    this.rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    this.t = this.rnd() * 10;
    this.phase = this.rnd() * 6;
  }

  /** turn a page now (no-op while one is turning, or with no open book) */
  flipPage() {
    if (this.pageT < 0 && this.rig.nodes.page && this.carry < 0.05) this.pageT = 0;
  }

  /** lay the chain out at rest under the root (first frame, or after a teleport) */
  private reset() {
    const M = this.rig.root.matrixWorld;
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(this.rest[i]).applyMatrix4(M);
      this.q[i].copy(this.p[i]);
    }
    this.inited = true;
  }

  update(dt: number) {
    if (this.n < 3) return;
    const R = this.rnd;
    this.t += dt;
    const t = this.t;
    const root = this.rig.root;
    root.updateWorldMatrix(true, false);
    const rp = _e.setFromMatrixPosition(root.matrixWorld);
    if (!this.inited || rp.distanceTo(this.lastRoot) > 1.5) this.reset();
    this.lastRoot.copy(rp);
    if (this.mode !== this.prevMode) {
      this.prevMode = this.mode;
      this.modeT = 0;
      this.shelved = false;
      if (this.mode === 'surprised') for (let i = 0; i < 4; i++) this.q[i].y -= 0.006 * this.scale * (1 - i / 4); // a jolt upward
    }
    this.modeT += dt;
    const mt = this.modeT;
    const s = this.scale;

    // ---------------------------------------------------------------- what the muscles want
    let rearH = 0.05, rearM = 4, amp = 0.035, freq = 0.35, push = 0, nod = 0, turn = 0, carry = 1;
    switch (this.mode) {
      case 'idle':
        rearH = 0.07 + Math.sin(t * 0.9) * 0.025;
        nod = Math.sin(t * 1.3) * 0.25;
        turn = Math.sin(t * 0.7) * 0.5; // the searching sway of a worm's front end
        carry = 0;
        break;
      case 'read': {
        rearH = 0.1;
        rearM = 4;
        // feeling along the lines: the head sweeps across the page and taps down now and then
        turn = (((t * 0.55) % 1) - 0.5) * 0.9;
        nod = 0.85 + Math.max(0, Math.sin(t * 5.5)) ** 8 * 0.35;
        carry = 0;
        this.nextPage -= dt;
        if (this.nextPage <= 0) {
          this.nextPage = 2.4 + R() * 2;
          this.flipPage();
        }
        break;
      }
      case 'inch':
        rearH = 0.012;
        rearM = 3;
        amp = 0.24;
        freq = clamp(0.8 + (this.speed / s) * 4, 0.8, 3);
        nod = -0.1;
        break;
      case 'rear':
        rearH = 0.3;
        rearM = 6;
        turn = Math.sin(t * 0.8) * 0.4;
        nod = -0.1;
        break;
      case 'look':
        rearH = 0.2;
        rearM = 5;
        break;
      case 'surprised':
        rearH = 0.34 + Math.exp(-mt * 5) * 0.1;
        rearM = 6;
        nod = -0.45 * Math.exp(-mt * 3);
        break;
      case 'shelve': {
        // up high, a push forward at the top (the book goes onto the shelf), and back down
        const up = clamp(mt / 0.6, 0, 1) * (1 - clamp((mt - 1.7) / 0.7, 0, 1));
        rearH = 0.06 + 0.38 * up;
        rearM = 7;
        push = Math.sin(Math.PI * clamp((mt - 0.6) / 0.9, 0, 1)) * 0.09;
        nod = -0.25 * up + push * 3;
        if (!this.shelved && mt > 1.05) {
          this.shelved = true;
          this.onShelve?.();
        }
        if (mt > 2.6) this.mode = 'read';
        break;
      }
    }
    if (this.lookAt && (this.mode === 'look' || this.mode === 'rear' || this.mode === 'idle' || this.mode === 'surprised')) {
      _a.copy(this.lookAt);
      root.worldToLocal(_a);
      turn = clamp(Math.atan2(_a.x, _a.z), -1.1, 1.1) * 0.8;
      nod = clamp(-Math.atan2(_a.y - this.rearH * s, Math.hypot(_a.x, _a.z)), -0.6, 0.6);
    }
    this.rearH = damp(this.rearH, rearH, 3.5, dt);
    this.rearM = rearM;
    this.amp = damp(this.amp, amp, 3, dt);
    this.push = damp(this.push, push, 6, dt);
    this.nod = damp(this.nod, nod, 6, dt);
    this.turn = damp(this.turn, turn, 3, dt);
    this.carry = damp(this.carry, carry, 4, dt);

    // ---------------------------------------------------------------- the physics (fixed sub-steps)
    const H = 1 / 120;
    this.acc = Math.min(this.acc + dt, H * 6);
    const fwd = _b.set(0, 0, 1).transformDirection(root.matrixWorld);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    while (this.acc >= H) {
      this.acc -= H;
      this.step(H, rp, fx, fz, freq);
    }

    // ---------------------------------------------------------------- place the parts on the chain
    _inv.copy(root.matrixWorld).invert();
    root.getWorldQuaternion(_qi).invert();
    for (let i = 1; i < this.n; i++) {
      const node = this.segN[i - 1];
      if (!node) continue;
      const a = this.p[i - 1], b = this.p[i];
      node.position.addVectors(a, b).multiplyScalar(0.5).applyMatrix4(_inv);
      const f = _a.subVectors(a, b);
      const l = f.length();
      f.divideScalar(l || 1).applyQuaternion(_qi);
      frame(f, this.sides[i - 1], node.quaternion);
      node.quaternion.multiply(_q.copy(this.restQ[i - 1]).invert());
      // contracted segments swell, stretched ones thin (the volume is kept)
      const k = clamp(l / this.len0[i - 1], 0.6, 1.5);
      const w = 1 / Math.sqrt(k);
      node.scale.set(w, w, k);
    }
    // the head rides the front of the chain, turned and nodded by the mood
    const hn = this.rig.nodes.head;
    if (hn) {
      hn.position.copy(this.p[0]).applyMatrix4(_inv);
      const f = _a.subVectors(this.p[0], this.p[1]).normalize().applyQuaternion(_qi);
      f.applyAxisAngle(UP, this.turn * 0.6);
      const side = _b.crossVectors(UP, f);
      if (side.lengthSq() > 1e-6) f.applyAxisAngle(side.normalize(), this.nod);
      frame(f, this.headSide, hn.quaternion);
    }
    // the mouth works a little (nibbling over a page, a gasp)
    const jaw = this.rig.nodes.jaw;
    if (jaw) jaw.rotation.x = (this.mode === 'read' ? Math.max(0, Math.sin(t * 3.1)) * 0.25 : 0) + (this.mode === 'surprised' ? 0.5 * Math.exp(-mt * 3) : 0);
    // the fez tassel swings with the head
    const tn = this.rig.nodes.tassel;
    if (tn) {
      const tg = -this.nod * 0.8 + this.turn * 0.3;
      this.tassel.v += (90 * (tg - this.tassel.x) - 4 * this.tassel.v) * Math.min(dt, 1 / 30);
      this.tassel.x += this.tassel.v * Math.min(dt, 1 / 30);
      tn.rotation.set(this.tassel.x * 0.6, 0, Math.sin(t * 1.3) * 0.06 + this.turn * 0.2);
    }
    this.placeBook(dt);
  }

  private step(h: number, rp: THREE.Vector3, fx: number, fz: number, freq: number) {
    const n = this.n, p = this.p, q = this.q, s = this.scale;
    const g = rp.y;
    // peristalsis: link rest lengths pulse in a wave running from the head to the tail
    this.phase += h * Math.PI * 2 * freq;
    for (let i = 0; i < n - 1; i++) this.len[i] = this.len0[i] * (1 + this.amp * Math.sin(this.phase - i * 0.75));
    // Verlet: inertia, a little damping, gravity
    for (let i = 0; i < n; i++) {
      const vx = (p[i].x - q[i].x) * 0.985, vy = (p[i].y - q[i].y) * 0.985, vz = (p[i].z - q[i].z) * 0.985;
      q[i].copy(p[i]);
      p[i].x += vx;
      p[i].y += vy - 9.8 * h * h;
      p[i].z += vz;
    }
    // the head seeks the root (pushing in pulses while it crawls); the neck lines up with the root's heading
    const pulse = this.mode === 'inch' ? 0.45 + 0.55 * Math.max(0, Math.sin(this.phase)) : 1;
    const hx = rp.x + fx * this.push * s, hz = rp.z + fz * this.push * s;
    const hy = g + this.rad[0] + this.rearH * s;
    const kH = 0.2 * pulse;
    p[0].x += (hx - p[0].x) * kH;
    p[0].z += (hz - p[0].z) * kH;
    p[0].y += (hy - p[0].y) * 0.28;
    const l0 = this.len0[0];
    p[1].x += (hx - fx * l0 - p[1].x) * 0.06;
    p[1].z += (hz - fz * l0 - p[1].z) * 0.06;
    // muscles: the front end lifts toward its posture (and sags between steps under gravity)
    const m = this.rearM;
    for (let i = 1; i < Math.min(m, n); i++) {
      const w = Math.pow(1 - i / m, 1.6);
      const ty = g + this.rad[i] + this.rearH * s * w;
      if (p[i].y < ty) p[i].y += (ty - p[i].y) * 0.16 * (0.4 + w);
    }
    // constraints: lengths, bending, the floor
    const bend = this.rearH > 0.08 ? 0.35 : 0.14;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = p[i], b = p[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const k = ((d - this.len[i]) / d) * 0.5;
        a.x += dx * k;
        a.y += dy * k;
        a.z += dz * k;
        b.x -= dx * k;
        b.y -= dy * k;
        b.z -= dz * k;
      }
      for (let i = 0; i < n - 2; i++) {
        const a = p[i], b = p[i + 2];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const target = (this.len[i] + this.len[i + 1]) * 0.985;
        if (d >= target) continue;
        const k = ((d - target) / d) * 0.5 * bend;
        a.x += dx * k;
        a.y += dy * k;
        a.z += dz * k;
        b.x -= dx * k;
        b.y -= dy * k;
        b.z -= dz * k;
      }
      for (let i = 0; i < n; i++) if (p[i].y < g + this.rad[i]) p[i].y = g + this.rad[i];
    }
    // bristle friction on the floor: forward slides, backward grips, sideways drags
    for (let i = 1; i < n; i++) {
      if (p[i].y > g + this.rad[i] + 0.004 * s) continue;
      const a = p[i - 1], b = p[Math.min(n - 1, i + 1)];
      let tx = a.x - b.x, tz = a.z - b.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const dx = p[i].x - q[i].x, dz = p[i].z - q[i].z;
      const along = dx * tx + dz * tz;
      const lx = dx - tx * along, lz = dz - tz * along;
      const back = along < 0 ? along * 0.92 : along * 0.12;
      p[i].x -= tx * back + lx * 0.5;
      p[i].z -= tz * back + lz * 0.5;
    }
  }

  /** the book: open on the floor in front while it reads, shut and carried in the mouth otherwise */
  private placeBook(dt: number) {
    const bn = this.rig.nodes.book;
    if (!bn) return;
    const k = this.carry;
    const hn = this.rig.nodes.head;
    const s = this.scale;
    if (hn) {
      // carried: the spine across the mouth, the shut book hanging below it
      const mouth = _a.set(0, -0.014 * s, 0.05 * s).applyQuaternion(hn.quaternion).add(hn.position);
      const side = _c.set(1, 0, 0).applyQuaternion(hn.quaternion);
      const up = _d.set(0, 1, 0).applyQuaternion(hn.quaternion);
      const fw = _b.crossVectors(side, up);
      _m.makeBasis(up.negate(), fw.negate(), side);
      _q.setFromRotationMatrix(_m);
      bn.position.lerpVectors(this.bookAt, mouth, k);
      bn.quaternion.identity().slerp(_q, k);
    }
    // shut while carried; pages turn only while it lies open
    const cr = this.rig.nodes.cover_r;
    if (cr) cr.rotation.set(0, 0, this.closeA * sstep(0.15, 0.85, k));
    let page = 0;
    if (this.pageT >= 0) {
      this.pageT += dt;
      const f = clamp((this.pageT - 0.1) / 0.55, 0, 1);
      page = f * f * (3 - 2 * f);
      if (this.pageT > 0.7) this.pageT = -1;
    }
    const pn = this.rig.nodes.page;
    if (pn) {
      pn.rotation.set(0, 0, page * this.flipA);
      pn.visible = page > 0.02 && page < 0.98 && k < 0.05;
    }
  }
}
