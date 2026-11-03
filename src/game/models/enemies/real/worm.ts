// Dune worm (STYLE v3, realistic): ~3.5 m segmented sand worm. Ridged chitin
// armour saddles over a soft, folded pale belly on every segment, tapering to a
// whip tail; a bulbous head with a four-petal maw (jaw_t, jaw_b, petal_l,
// petal_r) lined with rings of hooked teeth and a probing tongue.
// Rig: head (root) → seg1 … seg12 (chained), jaw_t/jaw_b/petal_l/petal_r/tongue on head.
import type { RigSpec } from '../../../../engine/voxel/Rig';
import { RBm, Sc, M3, mix, mulRGB, hash3, ell, cap, tube, paint, realFinish, lumpy, ridge, tubercles, hollow, bands } from './rk';

const VS = 1 / 40;

export function duneWormRig(o: { alpha?: boolean } = {}): RigSpec {
  const A = !!o.alpha;
  const K = A ? 1.3 : 1;
  const k = (m: number) => m * K;
  const rb = new RBm(A ? 'dune_worm_alpha' : 'dune_worm', VS);
  const plate = A ? bands(0x3a2a1c, 0x5a4430, 0x6a5238, VS, 0.6, 3, -0.5, 0.55) : bands(0x9a6e3e, 0xb88a52, 0xc89a60, VS, 0.6, 3, -0.5, 0.55);
  const plateEdge = A ? 0x1c140e : 0x5a3a20;
  const belly = bands(0xb88070, 0xd0a084, 0xdcb090, VS, 0.6, 5, -0.5, 0.55);
  const fold = 0x9a6252;
  const maw = 0x4a1410;
  const tooth = 0xeadcc0;
  const segN = 12;
  const segL = k(0.255);
  const headL = k(0.42);
  const R0 = k(0.3);
  const radAt = (t: number) => R0 * (1 - t * 0.78) + k(0.03); // t: 0 head .. 1 tail tip
  const Y = (r: number) => r; // body rests on the ground: centre height = radius

  // ------------------------------------------------------------ head: bulbous, plated crown, open maw at the front
  const head = rb.pm('head', undefined, [0, Y(R0), 0]);
  cap(head, [0, Y(R0), -k(0.02)], [0, Y(R0), headL * 0.55], R0 * 0.98, R0 * 1.02, belly);
  ell(head, [0, Y(R0) + R0 * 0.22, headL * 0.32], [R0 * 1.06, R0 * 0.86, headL * 0.62], plate, { keep: (_x, ly) => ly > -0.1 });
  for (let p = 0; p < 3; p++) ridge(head, (x, y, z) => y > Y(R0) + R0 * 0.3 && Math.abs(z - headL * (0.05 + p * 0.22)) < VS * 0.8, plateEdge);
  tubercles(head, 10, k(0.022), plateEdge, (_x, y) => y > Y(R0) + R0 * 0.5, 2);
  lumpy(head.m, 5, 1, 1, 0.45);
  // the maw: carve the front open, dark throat, three rings of inward-hooked teeth
  const rim = headL * 0.95;
  ell(head, [0, Y(R0), headL * 1.2], [R0 * 0.78, R0 * 0.78, headL * 0.62], 0, { carve: true });
  ell(head, [0, Y(R0), headL * 0.58], [R0 * 0.7, R0 * 0.7, k(0.05)], maw, { keep: (_lx, _ly, lz) => lz < 0.2 });
  paint(head, (x, y, z) => z > headL * 0.56 && Math.hypot(x, y - Y(R0)) < R0 * 0.82, maw);
  for (let ring = 0; ring < 3; ring++) {
    const rr = R0 * (0.74 - ring * 0.16), zz = rim - ring * headL * 0.12;
    const n = 14 - ring * 3;
    for (let t = 0; t < n; t++) {
      const a = (t / n) * Math.PI * 2 + ring * 0.3;
      const p0: M3 = [Math.cos(a) * rr, Y(R0) + Math.sin(a) * rr, zz];
      const p1: M3 = [Math.cos(a) * rr * 0.55, Y(R0) + Math.sin(a) * rr * 0.55, zz - k(0.07)];
      cap(head, p0, p1, k(0.018), VS * 0.5, tooth);
    }
  }

  // four maw petals that peel open (each its own part), hinged at the rim
  const petals: [string, number][] = [['jaw_t', Math.PI / 2], ['jaw_b', -Math.PI / 2], ['petal_l', 0], ['petal_r', Math.PI]];
  for (const [name, a] of petals) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const base: M3 = [ca * R0 * 0.85, Y(R0) + sa * R0 * 0.85, rim];
    const pt = rb.pm(name, 'head', base);
    for (let f = 0; f <= 10; f++) {
      const t = f / 10;
      const w = R0 * 0.62 * (1 - t * 0.75);
      const c: M3 = [ca * R0 * (0.85 - t * 0.3), Y(R0) + sa * R0 * (0.85 - t * 0.3), rim + t * headL * 0.42];
      for (let s2 = -1; s2 <= 1; s2 += 0.1) {
        const tx = -sa, ty = ca; // tangent around the maw
        const p: M3 = [c[0] + tx * w * s2, c[1] + ty * w * s2, c[2] - Math.abs(s2) * k(0.03)];
        ell(pt, p, [k(0.024), k(0.024), k(0.024)], Math.abs(s2) > 0.85 ? plateEdge : plate);
      }
      if (t > 0.55) cap(pt, [c[0] * 0.96, Y(R0) + (c[1] - Y(R0)) * 0.96, c[2]], [c[0] * 0.7, Y(R0) + (c[1] - Y(R0)) * 0.7, c[2] + k(0.04)], k(0.017), VS * 0.5, tooth); // hooked fang
    }
    lumpy(pt.m, 3, 1, 5, 0.4);
  }
  // probing tongue
  const tp: M3 = [0, Y(R0), headL * 0.62];
  const tongue = rb.pm('tongue', 'head', tp);
  tube(tongue, [tp, [0, Y(R0) - k(0.02), headL * 0.85], [k(0.03), Y(R0) - k(0.05), headL * 1.1], [k(0.02), Y(R0) - k(0.03), headL * 1.3]], (t) => k(0.05) * (1 - t * 0.7), 0xb04a44);
  ridge(tongue, (x) => Math.abs(x - k(0.01)) < VS * 0.6, 0x8a3434);

  // ------------------------------------------------------------ 12 segments: armour saddle + folded belly, tapering
  let parent = 'head';
  for (let i = 0; i < segN; i++) {
    const t0 = i / segN, t1 = (i + 1) / segN;
    const r0 = radAt(t0), r1 = radAt(t1);
    const z0 = -i * segL, z1 = -(i + 1) * segL;
    const piv: M3 = [0, Y(r0), z0];
    const seg = rb.pm(`seg${i + 1}`, parent, piv);
    // soft body ring (slightly bulging mid-segment) — sits on the ground, so its centre sinks as it tapers
    const mid: M3 = [0, Y((r0 + r1) / 2), (z0 + z1) / 2];
    cap(seg, [0, Y(r0), z0 - VS], mid, r0 * 0.92, (r0 + r1) / 2 * 1.02, belly);
    cap(seg, mid, [0, Y(r1), z1 + VS], (r0 + r1) / 2 * 1.02, r1 * 0.9, belly);
    // belly folds (transverse creases)
    paint(seg, (x, y, z) => y < mid[1] - (r0 + r1) * 0.15 && Math.abs(((z - z1) / ((z0 - z1) / 3)) % 1) < 0.2, fold);
    // armour saddle over the back: thicker plate with a raised rear rim + side flanges
    const pr = (r0 + r1) / 2;
    ell(seg, [0, mid[1] + pr * 0.18, mid[2] + segL * 0.1], [pr * 1.08, pr * 0.92, segL * 0.62], plate, { keep: (lx, ly) => ly > -0.05 && Math.abs(lx) < 0.98 });
    ridge(seg, (x, y, z) => z < mid[2] - segL * 0.34 && y > mid[1] + pr * 0.2, plateEdge);
    ridge(seg, (x, y, z) => Math.abs(x) < VS * 0.7 && y > mid[1] + pr * 0.8, plateEdge); // dorsal keel
    if (A || i % 2 === 0) {
      // backward-raking dorsal spines, bigger on the alpha
      const sp: M3 = [0, mid[1] + pr * 1.05, mid[2]];
      cap(seg, sp, [0, sp[1] + pr * (A ? 0.55 : 0.32), sp[2] - segL * 0.4], k(A ? 0.035 : 0.025) * (1 - t0 * 0.6), VS * 0.5, plateEdge);
    }
    tubercles(seg, 3, k(0.016), plateEdge, (_x, y) => y > mid[1] + pr * 0.5, i + 3);
    lumpy(seg.m, 5, 1, i + 9, 0.48);
    if (A && (i === 2 || i === 5)) {
      // jagged bone spurs erupting through the alpha's armour
      for (let b = 0; b < 3; b++) {
        const bx = (b - 1) * pr * 0.45, base: M3 = [bx, mid[1] + pr * 0.85, mid[2] + (b - 1) * segL * 0.15];
        tube(seg, [base, [bx * 1.3, base[1] + pr * 0.35, base[2] - segL * 0.15], [bx * 1.5, base[1] + pr * 0.55, base[2] - segL * 0.4]], (t) => k(0.03) * (1 - t * 0.85), 0xe0d2b0);
      }
    }
    parent = `seg${i + 1}`;
  }
  // whip tail tip on the last segment
  {
    const last = rb.sc(`seg${segN}`);
    const z1 = -segN * segL, r = radAt(1);
    tube(last, [[0, Y(r), z1 + VS * 2], [0, Y(r) * 0.9, z1 - k(0.12)], [k(0.02), Y(r) * 0.7, z1 - k(0.22)]], (t) => r * 0.9 * (1 - t * 0.85), plate);
  }

  for (const p of rb.parts) if (p.model.count > 5000) hollow(p.model, 3);
  realFinish(rb, 0.6, false);
  rb.sockM('mouth', 'head', [0, Y(R0), rim]);
  rb.sockM('head_top', 'head', [0, Y(R0) + R0 * 1.1, headL * 0.35]);
  return rb.build({ height: k(0.7), radius: R0, length: headL + segN * segL, segLength: segL, kind: 'worm', headY: Y(R0) });
}

export { Sc, mix, mulRGB, hash3 };
