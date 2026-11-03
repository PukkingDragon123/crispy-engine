// THE OASIS KING — a giant land-walking catfish, ~17.5 m from snout to tail
// fin (1/20 m voxels). Sculpted as ONE continuous slimy hide, then cut into a
// rig so every joint stays sealed (plugs hidden inside the neighbour):
//   body (root) → head → jaw (+ chin barbels), eye_l/eye_r (glossy amber
//   modelled eyes in fleshy sockets), gill_l/gill_r (opercula over red gills),
//   whisker_l1→l2→l3 / whisker_r1→r2→r3 (the 6 m maxillary barbels, gold rings)
//   body → belly (swells when it has swallowed something), fin_pec_l/r (serrated
//   spines), fin_dorsal, leg_fl/fr → foot_fl/fr, leg_bl/br → foot_bl/br (stubby
//   salamander legs with webbed, clawed toes — adapted to land),
//   body → tail1 → tail2 → tail3 (adipose + anal fins, forked caudal fin).
// Hide: pale belly → olive flanks → dark mottled back, a dotted lateral line,
// wet glints, old scars, leeches, two rusted harpoons with frayed rope, and a
// crown of moss, lily pads and a lotus growing on its flat head.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import {
  CRig, VoxelModel, VF, units, sculpt, mottledHide, wetGlints, paintM, fin, spine, tooth, barbel, curve, leaf, band, wetEye, mixc, mulc, sstep, clamp01, exposed, cap, ell, hash3, noise, norm3, sub3, add3, scl3, type SPrim,
} from './oasisKit';

const VS = 1 / 16;
const U = units(VS);
const v = U.v;
const n = U.n;

const HIDE = { back: 0x34371f, side: 0x6b6a3b, belly: 0xd8cd9b, blotch: 0x1d2014, fleck: 0xbab58a };
const LIP = 0xb79a76, LIP_D = 0x8e7254;
const MOUTH = { palate: 0x9a3c3a, ridge: 0x7a2a2c, throat: 0x2a0a0c, tongue: 0xb65c52, teeth: 0xe9dcc0, teethD: 0xc4b292 };
const FIN = { membrane: 0x484328, ray: 0x29261a, edge: 0x7c7656 };
const WHISK = { top: 0x29231a, under: 0x5c5238, tip: 0xa29470 };
const GOLD = 0xe2b244, GOLD_D = 0xa87a22;
const GILL = 0x8a1e22, GILL_D = 0x4a0c10;

const E = (c: [number, number, number], r: [number, number, number], rot?: V3, sub = false, k?: number): SPrim => ({ c: v(...c), r: [n(r[0]), n(r[1]), n(r[2])], rot, sub, k });
const C = (a: [number, number, number], b: [number, number, number], r0: number, r1: number): SPrim => ({ a: v(...a), b: v(...b), r0: n(r0), r1: n(r1) });
const M = (i: number) => (i + 0.5) * VS;

// joint cuts (metres)
const HEAD_Z = 3.7;
const T1 = -2.2, T2 = -4.6, T3 = -6.6;
const JAW_Z = 4.55;
const lipY = (X: number, Z: number) => 1.64 - 0.03 * X * X - Math.max(0, 6.2 - Z) * 0.02;
/** the mouth cavity (metres) */
const inCavity = (X: number, Y: number, Z: number, s = 1) => {
  const a = (X / (1.78 * s)) ** 2 + ((Y - 1.62) / (0.6 * s)) ** 2 + ((Z - 5.75) / (1.85 * s)) ** 2;
  const b = (X / (1.0 * s)) ** 2 + ((Y - 1.7) / (0.52 * s)) ** 2 + ((Z - 4.45) / (0.95 * s)) ** 2;
  return a < 1 || b < 1;
};

function partOf(X: number, Y: number, Z: number): string {
  if (Z > HEAD_Z) {
    if (Z > JAW_Z && Y < lipY(X, Z)) return 'jaw';
    if (Math.abs(X) > 1.45 && Z > 3.72 && Z < 4.35 && Y > 1.2 && Y < 2.75) return X > 0 ? 'gillzone_l' : 'gillzone_r';
    return 'head';
  }
  if (Z < T3) return 'tail3';
  if (Z < T2) return 'tail2';
  if (Z < T1) return 'tail1';
  if (Y < 1.22 && Z > -0.9 && Z < 3.3) return 'belly';
  return 'body';
}

function build(): RigSpec {
  const rig = new CRig('oasis_king', VS);
  // ------------------------------------------------------------- the whole hide
  const whole = new VoxelModel('whole');
  const prims: SPrim[] = [
    // trunk
    E([0, 2.0, 1.4], [2.1, 1.4, 2.9]),
    E([0, 1.45, 1.7], [2.2, 0.95, 2.4]),
    E([0, 2.52, 0.8], [1.45, 1.0, 2.6]),
    E([0, 2.05, 3.35], [2.15, 1.25, 1.15]),
    C([0, 1.95, -0.6], [0, 1.95, -2.5], 1.6, 1.32),
    // head: broad, flat, heavy-lipped
    E([0, 2.05, 5.2], [2.35, 1.08, 2.0]),
    E([0, 1.92, 6.75], [2.1, 0.82, 1.25]),
    E([0, 1.45, 6.35], [2.0, 0.56, 1.5]),
    E([1.55, 1.75, 4.9], [0.95, 0.9, 1.3]),
    E([-1.55, 1.75, 4.9], [0.95, 0.9, 1.3]),
    E([0, 1.35, 4.6], [1.6, 0.72, 1.3]),
    E([1.82, 2.48, 6.0], [0.46, 0.4, 0.48]),
    E([-1.82, 2.48, 6.0], [0.46, 0.4, 0.48]),
    E([0, 3.22, 5.6], [1.1, 0.28, 1.5], undefined, true, n(0.3)),
    // tail: laterally compressed, tapering to the peduncle
    E([0, 1.96, -2.9], [1.28, 1.36, 1.45]),
    E([0, 1.92, -4.3], [0.96, 1.16, 1.5]),
    E([0, 1.89, -5.7], [0.7, 0.96, 1.3]),
    E([0, 1.87, -6.9], [0.48, 0.72, 1.0]),
    E([0, 1.86, -7.75], [0.3, 0.5, 0.62]),
    // adipose fin: a fleshy ridge on the back of the tail
    E([0, 3.05, -3.6], [0.16, 0.38, 0.95], [0.18, 0, 0]),
  ];
  const hide = mottledHide({ ...HIDE, bellyTop: 1.25, backLow: 2.35, cell: 1.1, seed: 7, vs: VS });
  // skin folds behind the head, faint wrinkles everywhere (organic, never a bare primitive)
  const disp = (x: number, y: number, z: number) => {
    const X = x * VS, Y = y * VS, Z = z * VS;
    let d = noise.n3(X * 1.4, Y * 1.4, Z * 1.1) * 1.1;
    if (Z > 2.6 && Z < 4.2) d += Math.max(0, Math.sin(Z * 13 + Math.sin(X * 2.1) * 1.2)) * 0.9 * sstep(1.1, 2.2, Math.abs(X) + (Y > 2.8 ? 1 : 0));
    return d;
  };
  // solid flesh (no inner faces to draw; the joints and the mouth walls stay sealed)
  sculpt(whole, prims, hide, {
    k: n(0.55),
    disp,
    dispMax: 2,
    interior: 0x3a3424,
  });
  // the mouth: cavity, lip slit, palate ridges, teeth pads, throat
  // (and the slit between the lips all around the gape)
  const gone: [number, number, number][] = [];
  whole.forEach((x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    if (inCavity(X, Y, Z) || (Z > JAW_Z + 0.15 && Math.abs(Y - lipY(X, Z)) < 0.04 && inCavity(X, Y, Z, 1.6))) gone.push([x, y, z]);
  });
  for (const [x, y, z] of gone) whole.del(x, y, z);
  paintM(whole, VS, (X, Y, Z) => Z > JAW_Z && inCavity(X, Y, Z, 1.18), (c, x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    const lip = lipY(X, Z);
    const depth = 1 - clamp01((Z - 4.2) / 3.2);
    // cardiform teeth pads just inside both lips
    if (Math.abs(Y - lip) < 0.28 && Math.abs(Y - lip) > 0.05 && (Z > 6.6 || Math.abs(X) > 1.45)) return hash3(x, y, z) > 0.45 ? MOUTH.teeth : MOUTH.teethD;
    if (Y > lip) return mixc(Math.sin(Z * 9) > 0.4 ? MOUTH.ridge : MOUTH.palate, MOUTH.throat, depth * depth);
    return mixc(MOUTH.palate, MOUTH.throat, depth * depth * 0.9);
  }, false);
  // thick fleshy lips around the whole gape
  paintM(whole, VS, (X, Y, Z) => Z > 5.2 && Math.abs(Y - lipY(X, Z)) < 0.2 && !inCavity(X, Y, Z, 1.12), (c, x, y, z) => mixc(c, hash3(x, y, z) > 0.7 ? LIP_D : LIP, 0.75), false);
  // tongue on the jaw floor
  sculpt(whole, [E([0, 1.12, 5.9], [0.95, 0.2, 1.25]), E([0, 1.15, 6.6], [0.75, 0.16, 0.6])], (x, y, z) => (hash3(x, y, z) > 0.8 ? mulc(MOUTH.tongue, 0.86) : MOUTH.tongue), { k: n(0.2), under: true });
  // the dotted lateral line from the gill to the tail
  paintM(whole, VS, (X, Y, Z) => Z < 3.7 && Z > -7.6 && Math.abs(X) > 0.25 && Math.abs(Y - (1.92 + ((Z + 7.5) / 11.3) * 0.5)) < 0.035, (c, x, y, z) => (hash3(x, y, z) > 0.35 ? mixc(c, 0xdcd8b4, 0.55) : c), false);
  // old scars across the back (pale, puckered edges)
  const scars: [number, number, number, number][] = [[0.5, 2.3, 1.7, 0.6], [-0.9, 1.4, -1.8, -0.3], [0.2, -3.0, 0.9, -4.2], [-1.4, 4.6, -0.6, 5.6]];
  paintM(whole, VS, (X, Y, Z) => {
    if (Y < 2.4) return false;
    for (const [x0, z0, x1, z1] of scars) {
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
      const t = clamp01(((X - x0) * dx + (Z - z0) * dz) / l2);
      if (Math.hypot(X - x0 - dx * t, Z - z0 - dz * t) < 0.075) return true;
    }
    return false;
  }, (c, x, y, z) => (hash3(x, y, z) > 0.5 ? 0xb89c86 : 0x9a7c6a), false);
  // ------------------------------------------------------------- cut into parts
  const body = rig.part('body', undefined, v(0, 1.95, 0.4));
  const belly = rig.part('belly', 'body', v(0, 1.22, 1.2));
  const head = rig.part('head', 'body', v(0, 2.0, HEAD_Z));
  const jaw = rig.part('jaw', 'head', v(0, 1.62, 4.7));
  const tail1 = rig.part('tail1', 'body', v(0, 1.95, T1));
  const tail2 = rig.part('tail2', 'tail1', v(0, 1.9, T2));
  const tail3 = rig.part('tail3', 'tail2', v(0, 1.86, T3));
  const gillL = rig.part('gill_l', 'head', v(2.08, 2.0, 4.32));
  const gillR = rig.part('gill_r', 'head', v(-2.08, 2.0, 4.32));
  const parts: Record<string, VoxelModel> = { body, belly, head, jaw, tail1, tail2, tail3 };
  whole.forEach((x, y, z, c, f) => {
    const X = M(x), Y = M(y), Z = M(z);
    let p = partOf(X, Y, Z);
    if (p === 'gillzone_l' || p === 'gillzone_r') {
      // the operculum = the outer 3 voxels of the gill zone; beneath it, red gill filaments
      const s = X > 0 ? 1 : -1;
      const outer = !whole.has(x + s, y, z) || !whole.has(x + s * 2, y, z) || !whole.has(x + s * 3, y, z);
      if (outer) {
        (s > 0 ? gillL : gillR).set(x, y, z, Z > 4.25 ? c : mixc(c, 0x2a2618, 0.25), f);
        return;
      }
      head.set(x, y, z, Math.sin(Y * 38) > 0.1 ? GILL : GILL_D, VF.SOFTAO);
      return;
    }
    parts[p].set(x, y, z, c, f);
    // joint plugs: deep voxels just on the parent side of a cut also live in the child
    const nearJoint = (Z > HEAD_Z - 0.2 && Z <= HEAD_Z) || (Z < T1 + 0.2 && Z >= T1) || (Z < T2 + 0.2 && Z >= T2) || (Z < T3 + 0.2 && Z >= T3) || (Y > 1.22 && Y < 1.42);
    if (!nearJoint) return;
    const deep = !exposed(whole, x, y, z) && whole.has(x, y + 2, z) && whole.has(x, y - 2, z) && whole.has(x + 2, y, z) && whole.has(x - 2, y, z);
    if (!deep) return;
    if (p === 'body' && Z > HEAD_Z - 0.2 && Z <= HEAD_Z) head.set(x, y, z, c, f);
    if (p === 'body' && Z < T1 + 0.2 && Z >= T1) tail1.set(x, y, z, c, f);
    if (p === 'tail1' && Z < T2 + 0.2 && Z >= T2) tail2.set(x, y, z, c, f);
    if (p === 'tail2' && Z < T3 + 0.2 && Z >= T3) tail3.set(x, y, z, c, f);
    if (p === 'body' && Y > 1.22 && Y < 1.42 && Z > -0.9 && Z < 3.3) belly.set(x, y, z, c, f);
  });
  // a dark slit behind each operculum
  for (const g of [gillL, gillR]) paintM(g, VS, (_X, _Y, Z) => Z < 3.8, () => 0x1e140e);

  // ------------------------------------------------------------- eyes in fleshy sockets
  for (const s of [1, -1]) {
    const ec: V3 = v(1.96 * s, 2.56, 6.05);
    const er = n(0.25);
    ell(head, ec, [er * 1.12, er * 1.12, er * 1.12], 0, { carve: true });
    // a raised fleshy rim around the socket
    ell(head, ec, [er * 1.45, er * 1.3, er * 1.4], (x, y, z) => mixc(HIDE.side, 0x8e8458, hash3(x, y, z) * 0.5), {
      keep: (lx) => lx * s > 0.25,
      under: true,
    });
    ell(head, ec, [er * 1.08, er * 1.08, er * 1.08], 0, { carve: true });
    const eye = rig.part(s > 0 ? 'eye_l' : 'eye_r', 'head', ec);
    wetEye(eye, ec, er, [0.88 * s, 0.32, 0.36], { sclera: 0x2a2012, iris: 0xc9952c, irisEdge: 0x6a4210, pupil: 0x060404, irisR: 0.9, pupilR: 0.42 });
  }
  // nostrils: front tubes and rear pits with short nasal barbels
  for (const s of [1, -1]) {
    cap(head, v(0.78 * s, 2.55, 7.32), v(0.8 * s, 2.78, 7.42), n(0.09), n(0.07), HIDE.back);
    ell(head, v(0.8 * s, 2.79, 7.43), [n(0.05), n(0.05), n(0.05)], 0, { carve: true });
    ell(head, v(0.68 * s, 2.86, 6.75), [n(0.07), n(0.05), n(0.07)], 0x14120c);
    barbel(head, curve([v(0.7 * s, 2.86, 6.7), v(0.82 * s, 3.25, 6.45), v(0.98 * s, 3.45, 6.0)], 6), n(0.07), n(0.025), (t) => mixc(WHISK.top, WHISK.tip, t * t));
  }

  // ------------------------------------------------------------- the long maxillary barbels (3-link chains)
  const wcol = (t: number, x: number, y: number, z: number) => {
    let c = mixc(WHISK.top, WHISK.tip, t * t * 0.9);
    if (Math.sin(t * 90) > 0.82) c = mulc(c, 0.82); // annulations
    if (hash3(x, y, z) > 0.93) c = mixc(c, WHISK.under, 0.6);
    return c;
  };
  for (const s of [1, -1]) {
    const L = (x: number, y: number, z: number): V3 => v(x * s, y, z);
    const segs: V3[][] = [
      [L(2.0, 1.72, 6.6), L(2.7, 1.8, 6.95), L(3.5, 1.74, 7.05), L(4.1, 1.62, 6.85)],
      [L(4.1, 1.62, 6.85), L(4.75, 1.44, 6.4), L(5.25, 1.22, 5.75), L(5.6, 1.02, 5.0)],
      [L(5.6, 1.02, 5.0), L(5.85, 0.84, 4.2), L(5.95, 0.72, 3.4), L(5.9, 0.64, 2.6)],
    ];
    const rad = [[0.18, 0.12], [0.12, 0.07], [0.07, 0.028]];
    const tot = [0, 1 / 3, 2 / 3, 1];
    let parent = 'head';
    for (let i = 0; i < 3; i++) {
      const name = `whisker_${s > 0 ? 'l' : 'r'}${i + 1}`;
      const m = rig.part(name, parent, segs[i][0]);
      const pts = curve(segs[i], 8);
      barbel(m, pts, n(rad[i][0]), n(rad[i][1]), (t, x, y, z) => wcol(tot[i] + (tot[i + 1] - tot[i]) * t, x, y, z));
      // gold rings pierced through the barbels (a sacred fish of the old temples)
      if (i < 2) {
        const k = i === 0 ? 4 : 3;
        const p = pts[k], q = pts[k + 1];
        band(m, p, sub3(q, p), n(rad[i][0] * 1.25 + 0.03), n(0.035), (x, y, z) => (hash3(x, y, z) > 0.75 ? GOLD_D : GOLD));
      }
      parent = name;
    }
  }
  // chin barbels (two each side, hanging from the lower jaw)
  for (const s of [1, -1]) {
    const m = rig.part(s > 0 ? 'chin_l' : 'chin_r', 'jaw', v(0.9 * s, 0.98, 6.95));
    barbel(m, curve([v(1.32 * s, 1.0, 6.7), v(1.5 * s, 0.68, 7.0), v(1.62 * s, 0.38, 7.3), v(1.7 * s, 0.2, 7.55)], 8), n(0.075), n(0.025), (t) => mixc(WHISK.under, WHISK.tip, t));
    barbel(m, curve([v(0.52 * s, 0.95, 7.15), v(0.6 * s, 0.62, 7.45), v(0.66 * s, 0.36, 7.7), v(0.7 * s, 0.22, 7.82)], 8), n(0.065), n(0.022), (t) => mixc(WHISK.under, WHISK.tip, t));
  }
  // algae strands trailing from the lips (slime)
  for (const [x0, z0, len] of [[1.2, 7.4, 0.5], [-0.4, 7.8, 0.65], [-1.5, 7.2, 0.4], [0.5, 7.75, 0.35]] as [number, number, number][]) {
    const pts = curve([v(x0, 1.05, z0), v(x0 + 0.05, 1.05 - len * 0.5, z0 + 0.06), v(x0 - 0.03, 1.05 - len, z0 + 0.03)], 5);
    barbel(jaw, pts, n(0.04), n(0.02), (t) => mixc(0x4e6a26, 0x2e4416, t));
  }

  // ------------------------------------------------------------- fins
  for (const s of [1, -1]) {
    const pf = rig.part(s > 0 ? 'fin_pec_l' : 'fin_pec_r', 'body', v(2.0 * s, 1.4, 3.05));
    const L = (x: number, y: number, z: number): V3 => v(x * s, y, z);
    const rays: [V3, V3][] = [
      [L(2.0, 1.44, 3.3), L(3.45, 1.02, 1.95)],
      [L(2.0, 1.42, 3.12), L(3.3, 0.96, 1.5)],
      [L(2.0, 1.4, 2.95), L(3.05, 0.95, 1.15)],
      [L(2.0, 1.38, 2.78), L(2.75, 1.0, 0.98)],
      [L(2.0, 1.36, 2.62), L(2.4, 1.1, 1.0)],
    ];
    fin(pf, rays, { ...FIN, th: 1.2, seed: s > 0 ? 3 : 4, bulge: [0, n(0.18), 0] });
    spine(pf, L(2.02, 1.48, 3.36), L(3.5, 1.04, 1.95), n(0.1), 0x3a3424, L(0, 0, -1), 0x5a5034);
    sculpt(pf, [E([2.05 * s, 1.4, 2.98], [0.28, 0.2, 0.42])], hide, { k: 2 });
  }
  const df = rig.part('fin_dorsal', 'body', v(0, 3.25, 1.45));
  fin(df, [
    [v(0, 3.32, 1.55), v(0, 4.85, 0.95)],
    [v(0, 3.34, 1.15), v(0, 4.55, 0.55)],
    [v(0, 3.34, 0.8), v(0, 4.15, 0.15)],
    [v(0, 3.32, 0.45), v(0, 3.8, -0.15)],
    [v(0, 3.28, 0.15), v(0, 3.5, -0.32)],
  ], { ...FIN, th: 1.4, seed: 9, bulge: [n(0.12), 0, 0] });
  spine(df, v(0, 3.2, 1.6), v(0, 4.92, 0.95), n(0.13), 0x3a3424, [0, 0, -1], 0x5a5034);
  // anal fin along the underside of the tail (one fin per tail part so it bends with it)
  fin(tail1, [
    [v(0, 0.86, -2.4), v(0, 0.42, -2.9)],
    [v(0, 0.84, -3.2), v(0, 0.36, -3.75)],
    [v(0, 0.86, -4.0), v(0, 0.4, -4.5)],
    [v(0, 0.92, -4.55), v(0, 0.55, -4.95)],
  ], { ...FIN, th: 1, seed: 2 });
  fin(tail2, [
    [v(0, 0.94, -4.65), v(0, 0.55, -5.05)],
    [v(0, 1.0, -5.4), v(0, 0.6, -5.85)],
    [v(0, 1.1, -6.2), v(0, 0.78, -6.6)],
    [v(0, 1.25, -6.55), v(0, 1.05, -6.75)],
  ], { ...FIN, th: 1, seed: 5 });
  // the forked caudal fin
  fin(tail3, [
    [v(0, 2.3, -8.05), v(0, 3.3, -9.55)],
    [v(0, 2.15, -8.15), v(0, 2.9, -9.65)],
    [v(0, 2.0, -8.2), v(0, 2.42, -9.25)],
    [v(0, 1.88, -8.22), v(0, 1.9, -8.85)],
    [v(0, 1.74, -8.2), v(0, 1.38, -9.2)],
    [v(0, 1.6, -8.15), v(0, 0.94, -9.55)],
    [v(0, 1.45, -8.05), v(0, 0.62, -9.45)],
  ], { ...FIN, th: 2, ragged: 0.2, seed: 7, bulge: [n(0.15), 0, 0] });

  // ------------------------------------------------------------- stubby walking legs (webbed, clawed)
  const skin = (x: number, y: number, z: number) => mixc(hide(x, y, z), HIDE.side, 0.25);
  const legDef: { name: string; hip: [number, number, number]; knee: [number, number, number]; palm: [number, number, number]; toes: number[]; size: number }[] = [
    { name: 'f', hip: [1.62, 1.18, 2.3], knee: [2.4, 0.72, 2.42], palm: [2.56, 0.13, 2.7], toes: [-0.15, 0.3, 0.75, 1.2], size: 1 },
    { name: 'b', hip: [1.45, 1.12, -1.4], knee: [2.15, 0.68, -1.5], palm: [2.32, 0.13, -1.38], toes: [0.15, 0.6, 1.05, 1.5], size: 1.08 },
  ];
  for (const L of legDef) {
    const up = rig.part('leg_' + L.name + 'l', 'body', v(...L.hip));
    const ft = rig.part('foot_' + L.name + 'l', 'leg_' + L.name + 'l', v(...L.knee));
    const s = L.size;
    sculpt(up, [C(L.hip, L.knee, 0.44 * s, 0.33 * s), E([(L.hip[0] + L.knee[0]) / 2, (L.hip[1] + L.knee[1]) / 2 + 0.05, (L.hip[2] + L.knee[2]) / 2], [0.46 * s, 0.38 * s, 0.42 * s])], skin, { k: n(0.2) });
    const ank: [number, number, number] = [L.palm[0] - 0.08, 0.26, L.palm[2] - 0.12];
    sculpt(ft, [C(L.knee, ank, 0.33 * s, 0.25 * s), E(L.palm, [0.42 * s, 0.14, 0.44 * s]), E([L.knee[0], L.knee[1] + 0.02, L.knee[2]], [0.34 * s, 0.3 * s, 0.34 * s])], skin, { k: n(0.16) });
    // elbow wrinkles
    paintM(ft, VS, (_X, Y) => Y > 0.4 && Y < 0.7 && Math.sin(Y * 60) > 0.6, (c) => mulc(c, 0.84));
    // toes fanning out, webbing between them, dark hooked claws
    const tips: V3[] = [];
    const bases: V3[] = [];
    for (const a of L.toes) {
      const d = [Math.sin(a), 0, Math.cos(a)];
      const base: [number, number, number] = [L.palm[0] + d[0] * 0.3 * s, 0.12, L.palm[2] + d[2] * 0.3 * s];
      const tip: [number, number, number] = [L.palm[0] + d[0] * 0.78 * s, 0.07, L.palm[2] + d[2] * 0.78 * s];
      sculpt(ft, [C(base, tip, 0.12 * s, 0.085 * s), E([(base[0] + tip[0]) / 2, 0.12, (base[2] + tip[2]) / 2], [0.11 * s, 0.1, 0.11 * s])], skin, { k: n(0.08) });
      tooth(ft, v(tip[0] + d[0] * 0.03, 0.08, tip[2] + d[2] * 0.03), v(tip[0] + d[0] * 0.2, 0.0, tip[2] + d[2] * 0.2), n(0.06), 0x2a2216, [0, n(0.03), 0]);
      tips.push(v(tip[0], 0.1, tip[2]));
      bases.push(v(base[0], 0.13, base[2]));
    }
    for (let i = 0; i < tips.length - 1; i++)
      fin(ft, [[bases[i], tips[i]], [bases[i + 1], tips[i + 1]]], { membrane: 0x8a7a58, ray: 0x6e6046, edge: 0xa8986e, th: 1, ragged: 0.35 });
  }
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');

  // ------------------------------------------------------------- a crown of moss, lily pads and a lotus
  const headTop = (x: number, z: number) => {
    // highest head voxel in a column (metres)
    let best = -1;
    for (let y = n(3.6); y > n(1.8); y--)
      if (head.has(x, y, z)) {
        best = y;
        break;
      }
    return best;
  };
  const moss: [number, number, number, number][] = [];
  head.forEach((x, y, z) => {
    if (head.has(x, y + 1, z)) return;
    const X = M(x), Z = M(z);
    const r = Math.hypot(X / 1.25, (Z - 5.0) / 1.15) + noise.n2(X * 2.3, Z * 2.3) * 0.25;
    if (r > 1) return;
    const h = 1 + (hash3(x, y, z) > 0.55 ? 1 : 0) + (r < 0.6 && hash3(x * 3, y, z) > 0.6 ? 1 : 0);
    for (let k = 1; k <= h; k++) moss.push([x, y + k, z, hash3(x, y + k, z) > 0.6 ? 0x5a7a2e : hash3(x, z, y) > 0.5 ? 0x3e5c22 : 0x6e8e38]);
  });
  for (const [x, y, z, c] of moss) head.set(x, y, z, c, VF.SOFTAO);
  const pads: [number, number, number, number][] = [[-0.95, 4.55, 0.62, 0.4], [1.0, 4.95, 0.55, 2.1], [0.15, 3.95, 0.5, 4.0]];
  for (const [px, pz, R, rot] of pads) {
    const cx = Math.round(n(px)), cz = Math.round(n(pz));
    const top = headTop(cx, cz);
    if (top < 0) continue;
    const cy = top + 2.2;
    const RR = n(R);
    for (let x = Math.floor(cx - RR); x <= cx + RR; x++)
      for (let z = Math.floor(cz - RR); z <= cz + RR; z++) {
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz) / RR;
        const a = Math.atan2(dz, dx) - rot;
        const notch = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.22 && d > 0.08;
        if (d > 1 || notch) continue;
        const yy = Math.round(cy + d * d * 1.4 - hash3(x, z, 2) * 0.4);
        const vein = Math.abs(Math.sin(a * 7)) < 0.18;
        head.set(x, yy, z, d > 0.9 ? 0x7aae46 : vein ? 0x3e6e24 : hash3(x, z, 5) > 0.9 ? 0x9ac65a : 0x4f8a2e, VF.SOFTAO);
        head.set(x, yy - 1, z, 0x6a2a3a);
      }
  }
  // the lotus on the crown: two whorls of cupped petals around a golden seed pod
  {
    const lx = Math.round(n(0.12)), lz = Math.round(n(5.05));
    const top = headTop(lx, lz);
    const base: V3 = [lx + 0.5, top + 3, lz + 0.5];
    ell(head, base, [n(0.18), n(0.12), n(0.18)], 0x5a7a2e);
    for (let w = 0; w < 2; w++) {
      const N = w ? 6 : 8;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + w * 0.4;
        const out: V3 = [Math.cos(a), 0, Math.sin(a)];
        const len = n(w ? 0.42 : 0.55), lift = w ? 1.25 : 0.75;
        const rib = curve([add3(base, scl3(out, n(0.06))), add3(base, add3(scl3(out, len * 0.55), [0, len * 0.35 * lift, 0])), add3(base, add3(scl3(out, len * 0.75), [0, len * 0.95 * lift, 0]))], 6);
        leaf(head, rib, (t) => n(0.13) * Math.sin(Math.min(1, t * 1.15) * Math.PI) + 0.6, [-out[0], 0.6, -out[2]], { blade: w ? 0xfbe2ea : 0xf4c2d2, vein: w ? 0xf0b2c4 : 0xe48aa8, margin: 0xe0607e, cup: 1.4, th: 1 });
      }
    }
    ell(head, add3(base, [0, n(0.16), 0]), [n(0.12), n(0.08), n(0.12)], (x, y, z) => (hash3(x, y, z) > 0.6 ? 0xd8a830 : 0xc8d050));
  }

  // ------------------------------------------------------------- old harpoons, rope, leeches
  const harpoon = (entry: [number, number, number], dir: [number, number, number], len: number, broken: boolean) => {
    const d = norm3(dir as V3);
    const a = v(...entry);
    const b = add3(a, scl3(d, n(len)));
    cap(body, add3(a, scl3(d, -n(0.25))), b, n(0.055), n(0.05), (x, y, z) => (Math.sin((x + y + z) * 0.9) > 0.3 ? 0x5e4026 : 0x7a5634));
    // an iron collar at the wound, scar tissue ringing it
    cap(body, a, add3(a, scl3(d, n(0.22))), n(0.085), n(0.07), (x, y, z) => (hash3(x, y, z) > 0.6 ? 0x6a3a1e : 0x8a4c22), { fl: VF.METAL });
    paintM(body, VS, (X, Y, Z) => Math.hypot(X - entry[0], Y - entry[1], Z - entry[2]) < 0.32, (c) => mixc(c, 0x9a7a66, 0.6));
    if (broken) {
      for (let i = 0; i < 6; i++) cap(body, b, add3(b, add3(scl3(d, n(0.08 + hash3(i, 1, 2) * 0.1)), [n((hash3(i, 2, 3) - 0.5) * 0.08), 0, n((hash3(i, 4, 1) - 0.5) * 0.08)])), 1.2, 0.5, 0x8a6a42);
    } else {
      // a frayed rope tied under the end, sagging down the flank
      const side = entry[0] >= 0 ? 1 : -1;
      const pts = curve([b, add3(b, v(0.25 * side, -0.35, -0.2)), add3(b, v(0.55 * side, -0.95, -0.55)), add3(b, v(0.8 * side, -1.45, -0.7))], 14);
      barbel(body, pts, n(0.045), n(0.03), (t, x, y, z) => ((x + y + z) % 3 === 0 ? 0x8a7448 : t > 0.85 ? 0xb8a478 : 0xa48c5a));
    }
  };
  harpoon([0.85, 3.12, 0.3], [0.35, 0.8, -0.45], 2.1, false);
  harpoon([-0.7, 2.98, -1.5], [-0.32, 0.85, 0.3], 1.3, true);
  for (const [lx, ly, lz, rot] of [[2.0, 1.75, 0.6, 0.4], [-2.05, 1.9, 1.9, -0.3], [1.15, 1.6, -3.2, 0.9], [-1.95, 1.3, -0.8, 1.2]] as [number, number, number, number][]) {
    const part = lz < T1 ? tail1 : body;
    const s = lx > 0 ? 1 : -1;
    sculpt(part, [E([lx + 0.04 * s, ly, lz], [0.07, 0.11, 0.24], [rot, 0, 0]), E([lx + 0.05 * s, ly + 0.1 * Math.sin(rot), lz + 0.14], [0.06, 0.08, 0.1])], (x, y, z) => (hash3(x, y, z) > 0.8 ? 0x3a2a20 : 0x1a1410), { k: 1.5, fl: VF.METAL });
  }

  // ------------------------------------------------------------- finishing
  for (const name of ['body', 'belly', 'head', 'tail1', 'tail2', 'tail3', 'gill_l', 'gill_r', 'leg_fl', 'foot_fl', 'leg_bl', 'foot_bl', 'leg_fr', 'foot_fr', 'leg_br', 'foot_br']) {
    const m = rig.m(name);
    wetGlints(m, 0.035, name.length * 7, (_x, y) => y * VS > 1.3 || name.startsWith('foot') || name.startsWith('leg'));
  }
  // sockets
  rig.socket('mouth', 'head', v(0, 1.62, 7.3));
  rig.socket('throat', 'head', v(0, 1.72, 4.9));
  rig.socket('head_top', 'head', v(0, 3.4, 5.1));
  rig.socket('belly', 'body', v(0, 1.35, 1.3));
  rig.socket('dorsal_tip', 'fin_dorsal', v(0, 4.85, 0.95));
  rig.socket('tail_tip', 'tail3', v(0, 1.9, -9.1));
  rig.socket('whisker_tip_l', 'whisker_l3', v(5.9, 0.64, 2.6));
  rig.socket('whisker_tip_r', 'whisker_r3', v(-5.9, 0.64, 2.6));
  void gillR;
  const jawE = (j: number) => ({ jaw: j });
  return rig.build({
    kind: 'catfish',
    height: 3.6,
    radius: 2.4,
    length: 17.6,
    expressions: { neutral: jawE(0), angry: jawE(0.06), enraged: jawE(0.14), hurt: jawE(0.18), smug: jawE(0.02), laugh: jawE(0.24), stunned: jawE(0.26), defeated: jawE(0.32) },
    defaultExpression: 'angry',
    swing: ['chin_l', 'chin_r'],
  });
}

let cached: RigSpec | null = null;
/** the Oasis King (memoised: building the 17 m hide takes a moment) */
export function oasisKingRig(): RigSpec {
  return (cached ??= build());
}
