// THE OLM — a giant blind albino cave salamander (boss), STYLE v3 realistic, 1/20 m,
// ~12.5 m nose to tail (the boss scales it up further). Eel-long and pale: translucent
// pink-white skin with violet blood vessels showing through, rosy internal organs
// shadowed along the belly, costal grooves ringing the trunk, a dotted lateral line,
// a long flattened shovel snout, tiny vestigial eyes sunk under a milky film of skin,
// pin-prick nostrils, three pairs of feathery blood-red external gills that flutter,
// a laterally flattened finned tail, and four absurdly small limbs (three toes in
// front, two behind). The mouth is a giant sucker: thick fleshy lips around a wide
// gape, a ribbed palate, rows of tiny hooked teeth and a ring of teeth around the
// gullet; the lower jaw (with its tongue) hinges wide open to inhale.
//
// Rig (faces +Z, origin on the ground under the chest):
//   body (root, chest) → head → jaw; head → gill_l1 … gill_l3 (+ _r);
//   body → spine1 → spine2 → tail1 → tail2 → tail3 → tail4;
//   body → leg_fl / leg_fr; spine2 → leg_bl / leg_br.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, cut, realFinish, hollow, lumpy } from '../enemies/real/rk';
import { finYZ } from './kit';

const VS = 1 / 20;

// [z, half width, half height, centre height]
const PROF: [number, number, number, number][] = [
  [-9.8, 0.03, 0.06, 0.78],
  [-8.4, 0.13, 0.24, 0.82],
  [-7.3, 0.22, 0.33, 0.85],
  [-6.1, 0.34, 0.41, 0.88],
  [-4.8, 0.48, 0.47, 0.9],
  [-4.0, 0.56, 0.5, 0.92],
  [-3.2, 0.6, 0.52, 0.94],
  [-1.3, 0.66, 0.55, 0.96],
  [0.0, 0.62, 0.5, 0.97],
  [0.75, 0.54, 0.4, 0.98],
  [1.1, 0.62, 0.37, 0.96],
  [1.8, 0.62, 0.3, 0.94],
  [2.5, 0.48, 0.21, 0.9],
  [2.95, 0.22, 0.12, 0.88],
];
function prof(z: number): [number, number, number] {
  if (z <= PROF[0][0]) return [PROF[0][1], PROF[0][2], PROF[0][3]];
  for (let i = 0; i < PROF.length - 1; i++) {
    const a = PROF[i], b = PROF[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  const l = PROF[PROF.length - 1];
  return [l[1], l[2], l[3]];
}
/** the mouth line (lip seam) height at z along the head */
const mouthY = (z: number, x: number) => 0.86 + Math.max(0, z - 1.4) * 0.025 - (x * x) * 0.05;

export function olmRig(): RigSpec {
  const rb = new RBm('olm_boss', VS);
  const seed = 77;
  // translucent albino skin: pale pink-white, violet vessels, faint rosy mottling
  const skin = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.07 + seed, y * 0.07, z * 0.05);
    let c = n > 0.35 ? 0xfff0ea : n < -0.4 ? 0xe8c4bc : 0xf6dcd2;
    const v = Math.abs(noise.n3(x * 0.11 - seed, y * 0.11, z * 0.06 + 3.1));
    if (v < 0.03) c = mix(c, 0xb890c0, 0.5); // veins
    else if (v < 0.05) c = mix(c, 0xd8a8c4, 0.25);
    const h = hash3(x, y + seed, z);
    if (h < 0.02) c = mix(c, 0xe0a8a0, 0.5);
    else if (h > 0.985) c = 0xfff8f4;
    return c;
  };
  const SOFT = VF.SOFTAO;

  /** fill the body tube between z0 and z1 into a part (with flattened belly) */
  const fillBody = (s: Sc, z0: number, z1: number, keep?: (x: number, y: number, z: number) => boolean) => {
    for (let k = s.i(z0); k <= s.i(z1); k++) {
      const z = (k + 0.5) * VS;
      const [rx, ry, cy] = prof(z);
      for (let i = s.i(-rx - VS); i <= s.i(rx + VS); i++)
        for (let j = s.i(cy - ry - VS); j <= s.i(cy + ry + VS); j++) {
          const x = (i + 0.5) * VS, y = (j + 0.5) * VS;
          const ryy = y < cy ? ry * 0.82 : ry;
          const d = (x / rx) ** 2 + ((y - cy) / ryy) ** 2;
          if (d > 1) continue;
          if (keep && !keep(x, y, z)) continue;
          s.m.set(i, j, k, skin, SOFT);
        }
    }
  };
  /** costal grooves, lateral line pores and organ shadows on a trunk part */
  const detailTrunk = (s: Sc, z0: number, z1: number) => {
    paint(s, (x, y, z) => z > z0 && z < z1 && Math.abs(Math.sin(z * 10.5)) < 0.09 && y > 0.55 && y < 1.3, (x, y, z) => mulRGB(skin(x, y, z), 0.84), SOFT);
    paint(s, (x, y, z) => {
      const [rx, , cy] = prof(z);
      return Math.abs(Math.abs(x) - rx * 0.97) < VS && Math.abs(y - cy - 0.08) < VS * 0.6 && Math.abs(Math.sin(z * 18)) < 0.3;
    }, 0xc8a0a8, SOFT);
    paint(s, (x, y, z) => {
      const [, , cy] = prof(z);
      return y < cy - 0.12 && noise.n3(x * 2.2, y * 2.2, z * 1.4 + seed) > 0.25;
    }, (x, y, z) => mix(skin(x, y, z), 0xe49c98, 0.32), SOFT);
  };

  // ================================================================ chest (root)
  const body = rb.pm('body', undefined, [0, 0.97, 0]);
  fillBody(body, -1.45, 0.85);
  detailTrunk(body, -1.4, 0.7);
  // throat fold under the neck
  paint(body, (x, y, z) => z > 0.35 && z < 0.55 && y < 0.8, (x, y, z) => mulRGB(skin(x, y, z), 0.85), SOFT);

  // ================================================================ head + jaw
  const head = rb.pm('head', 'body', [0, 0.98, 0.75]);
  const jaw = rb.pm('jaw', 'head', [0, 0.84, 1.15]);
  fillBody(head, 0.62, 2.98, (x, y, z) => !(z > 1.12 && y < mouthY(z, x)));
  fillBody(jaw, 1.12, 2.98, (x, y, z) => y < mouthY(z, x));
  // flatten the skull top into a shovel; a slight brow swell over the buried eyes
  cut(head, (x, y, z) => z > 1.3 && y > prof(z)[2] + prof(z)[1] * 0.78);
  for (const sx of [1, -1]) ell(head, [sx * 0.3, 1.11, 1.72], [0.12, 0.05, 0.14], skin, { fl: SOFT });
  // vestigial eyes: tiny dark beads under a milky film of skin
  for (const sx of [1, -1]) {
    const e: M3 = [sx * 0.32, 1.13, 1.76];
    ell(head, e, [0.045, 0.04, 0.045], 0x5a4660, { fl: VF.SOFTAO });
    ell(head, [e[0], e[1] + 0.012, e[2] + 0.01], [0.03, 0.025, 0.03], 0x2a2030, { fl: VF.SOFTAO });
    paint(head, (x, y, z) => Math.hypot(x - e[0], y - e[1] - 0.03, z - e[2]) < 0.06 && y > e[1] + 0.015, 0xf2e2e8, SOFT); // the film over it
  }
  // nostrils
  for (const sx of [1, -1]) head.dot([sx * 0.12, 1.0, 2.8], 0x9a6a74).dot([sx * 0.12, 0.99, 2.82], 0x6a4450);
  // the lips: a thick fleshy rim along the seam on both halves
  const lipC = (x: number, y: number, z: number) => (hash3(x, y, z) < 0.25 ? 0xe8aaa4 : 0xf2bcb4);
  for (let z = 1.2; z <= 2.95; z += VS * 0.7) {
    const [rx] = prof(z);
    for (const sx of [1, -1]) {
      const x = sx * rx * 0.93;
      ell(head, [x, mouthY(z, x) + 0.035, z], [0.06, 0.04, 0.05], lipC, { fl: SOFT });
      ell(jaw, [x, mouthY(z, x) - 0.035, z], [0.06, 0.04, 0.05], lipC, { fl: SOFT });
    }
  }
  for (let x = -0.22; x <= 0.22; x += VS * 0.7) {
    ell(head, [x, mouthY(2.92, x) + 0.03, 2.92], [0.05, 0.04, 0.05], lipC, { fl: SOFT });
    ell(jaw, [x, mouthY(2.92, x) - 0.03, 2.92], [0.05, 0.04, 0.05], lipC, { fl: SOFT });
  }
  // mouth cavity: ribbed palate above, tongue trough below, gullet with a ring of teeth
  const inner = (x: number, y: number, z: number) => (Math.abs(Math.sin(z * VS * 26)) < 0.18 ? 0x8a2a3a : hash3(x, y, z) < 0.3 ? 0xb84a5a : 0xa63c4c);
  ell(head, [0, 0.9, 2.0], [0.48, 0.13, 0.86], 0, { carve: true });
  ell(jaw, [0, 0.84, 2.0], [0.44, 0.06, 0.8], 0, { carve: true });
  // only the cavity walls take the inner colour: voxels inside the mouth volume that face an empty cell
  const nearCav = (x: number, y: number, z: number, cy: number) => (x / 0.5) ** 2 + ((y - cy) / 0.16) ** 2 + ((z - 2.0) / 0.9) ** 2 < 1.12 || Math.hypot(x, y - 0.86, (z - 1.22) * 0.8) < 0.29;
  for (const [part, cy] of [[head, 0.9], [jaw, 0.84]] as [Sc, number][]) {
    const m = part.m;
    const todo: [number, number, number][] = [];
    m.forEach((i, j, k) => {
      const x = (i + 0.5) * VS, y = (j + 0.5) * VS, z = (k + 0.5) * VS;
      if (z < 1.12 || !nearCav(x, y, z, cy) || Math.abs(x) > prof(z)[0] * 0.86) return;
      if (m.has(i + 1, j, k) && m.has(i - 1, j, k) && m.has(i, j + 1, k) && m.has(i, j - 1, k) && m.has(i, j, k + 1) && m.has(i, j, k - 1)) return;
      todo.push([i, j, k]);
    });
    for (const [i, j, k] of todo) m.set(i, j, k, inner, SOFT);
  }
  // tongue
  ell(jaw, [0, 0.78, 1.95], [0.26, 0.06, 0.55], (x, y, z) => (hash3(x, y, z) < 0.3 ? 0xd06a78 : 0xe07e88), { fl: SOFT });
  // gullet: a dark throat hole ringed with tiny hooked teeth
  ell(head, [0, 0.86, 1.22], [0.26, 0.2, 0.3], 0, { carve: true });
  ell(jaw, [0, 0.84, 1.22], [0.24, 0.12, 0.3], 0, { carve: true });
  ell(body, [0, 0.86, 0.72], [0.2, 0.16, 0.3], 0, { carve: true });
  paint(body, (x, y, z) => z > 0.4 && Math.hypot(x, y - 0.86) < 0.24, 0x200810, SOFT);
  for (let a = 0; a < Math.PI * 2; a += 0.32) {
    const r = 0.25;
    const p: M3 = [Math.cos(a) * r, 0.86 + Math.sin(a) * r * 0.7, 1.32];
    const part = p[1] > 0.86 ? head : jaw;
    cap(part, p, [Math.cos(a) * r * 0.6, 0.86 + Math.sin(a) * r * 0.42, 1.22], 0.022, VS * 0.5, 0xf4ece0, SOFT);
  }
  // rows of tiny teeth along the inner edges of both lips
  for (let z = 1.3; z <= 2.85; z += 0.09) {
    const [rx] = prof(z);
    for (const sx of [1, -1]) {
      const x = sx * rx * 0.82;
      cap(head, [x, mouthY(z, x) + 0.02, z], [x * 0.97, mouthY(z, x) - 0.05, z + 0.02], 0.017, VS * 0.5, 0xf4ece0, SOFT);
      cap(jaw, [x, mouthY(z, x) - 0.02, z], [x * 0.97, mouthY(z, x) + 0.05, z + 0.02], 0.017, VS * 0.5, 0xeee4d6, SOFT);
    }
  }
  // chin wrinkles
  paint(jaw, (x, y, z) => y < 0.72 && Math.abs(Math.sin(z * 14 + x * 3)) < 0.1, (x, y, z) => mulRGB(skin(x, y, z), 0.86), SOFT);

  // ================================================================ gills (left; mirrored)
  for (let g = 0; g < 3; g++) {
    const base: M3 = [0.5 - g * 0.02, 1.08 - g * 0.1, 0.98 - g * 0.13];
    const gill = rb.pm(`gill_l${g + 1}`, 'head', base);
    const L = 1.05 - g * 0.12;
    const dir: M3 = [0.75, 0.55 - g * 0.32, -0.55];
    const pts: M3[] = [];
    for (let t = 0; t <= 6; t++) {
      const q = t / 6;
      const curl = q * q * 0.35;
      pts.push([base[0] + dir[0] * L * q, base[1] + dir[1] * L * q + curl * 0.4, base[2] + dir[2] * L * q - curl * 0.5]);
    }
    tube(gill, pts, (t) => 0.06 * (1 - t * 0.65), (x, y, z) => (hash3(x, y, z) < 0.3 ? 0xb83a4e : 0xc8485c), SOFT);
    // feathery filaments: sparse fronds fanning off the back and both sides of the stalk
    for (let q = 0.14; q <= 0.98; q += 0.055) {
      const i = Math.min(pts.length - 2, Math.floor(q * (pts.length - 1)));
      const f = q * (pts.length - 1) - i;
      const p: M3 = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * f];
      const fl = 0.2 * Math.sin(Math.PI * Math.min(1, q * 1.08)) + 0.05;
      const dirs: M3[] = [[0.25, 0.9, -0.45], [0.25, -0.9, -0.45], [0.9, 0.1, -0.5]];
      dirs.forEach((dd, n) => {
        if ((Math.round(q * 100) + n) % 3 === 0 && n === 2) return;
        const L = fl * (0.8 + hash3(q * 50, n, g) * 0.4);
        const tip: M3 = [p[0] + dd[0] * L, p[1] + dd[1] * L, p[2] + dd[2] * L];
        tube(gill, [p, [(p[0] + tip[0]) / 2 + 0.01, (p[1] + tip[1]) / 2, (p[2] + tip[2]) / 2 - 0.02], tip], () => VS * 0.45, (x, y, z) => {
          const tt = Math.hypot((x + 0.5) * VS - p[0], (y + 0.5) * VS - p[1], (z + 0.5) * VS - p[2]) / Math.max(L, 0.01);
          return tt > 0.75 ? 0xffc4c0 : tt > 0.4 ? 0xf48890 : 0xe0606e;
        }, SOFT);
      });
    }
  }

  // ================================================================ trunk + tail chain
  const sp1 = rb.pm('spine1', 'body', [0, 0.96, -1.3]);
  fillBody(sp1, -3.35, -1.15);
  detailTrunk(sp1, -3.3, -1.2);
  const sp2 = rb.pm('spine2', 'spine1', [0, 0.94, -3.2]);
  fillBody(sp2, -4.95, -3.05);
  detailTrunk(sp2, -4.9, -3.1);
  const TAIL: [number, number][] = [[-4.8, -6.1], [-6.1, -7.3], [-7.3, -8.4], [-8.4, -9.85]];
  let parent = 'spine2';
  TAIL.forEach(([z1, z0], i) => {
    const [, , cy] = prof(z1);
    const t = rb.pm(`tail${i + 1}`, parent, [0, cy, z1]);
    fillBody(t, z0, z1 + 0.14);
    // laterally flattened tail with dorsal and ventral fins
    const finTop = (z: number) => {
      const [, ry, c] = prof(z);
      return c + ry + 0.08 + Math.max(0, (-5 - z) * 0.07);
    };
    finYZ(t, z0, z1 + 0.1, (z) => prof(z)[2] + prof(z)[1] * 0.8, finTop, () => 0, (x, y, z) => (Math.abs(Math.sin(z * 9)) < 0.15 ? 0xe8c8c4 : 0xf8e4de), 0.06, SOFT);
    if (z1 < -5.5) finYZ(t, z0, z1 + 0.1, (z) => prof(z)[2] - prof(z)[1] * 0.82 - 0.06 - Math.max(0, (-6 - z) * 0.05), (z) => prof(z)[2] - prof(z)[1] * 0.6, () => 0, 0xf0dcd6, 0.06, SOFT);
    detailTrunk(t, z0, z1);
    parent = `tail${i + 1}`;
  });
  // dorsal fin begins as a low ridge on the hips
  finYZ(sp2, -4.95, -3.6, (z) => prof(z)[2] + prof(z)[1] * 0.85, (z) => prof(z)[2] + prof(z)[1] + (-3.6 - z) * 0.08, () => 0, 0xf2dcd6, 0.05, SOFT);

  // ================================================================ the small limbs
  const limb = (name: string, parentName: string, sh: M3, elbow: M3, wrist: M3, toes: number) => {
    const L = rb.pm(name, parentName, sh);
    tube(L, [sh, elbow], (t) => 0.13 - t * 0.04, skin, SOFT);
    ell(L, elbow, [0.095, 0.095, 0.095], skin, { fl: SOFT });
    tube(L, [elbow, wrist], (t) => 0.09 - t * 0.025, skin, SOFT);
    ell(L, [wrist[0], wrist[1] - 0.02, wrist[2]], [0.1, 0.05, 0.1], skin, { fl: SOFT });
    for (let t = 0; t < toes; t++) {
      const a = (t - (toes - 1) / 2) * 0.55;
      const tip: M3 = [wrist[0] + Math.sin(a) * 0.24, 0.02, wrist[2] + Math.cos(a) * 0.24];
      tube(L, [[wrist[0], wrist[1] - 0.03, wrist[2]], [(wrist[0] + tip[0]) / 2, 0.06, (wrist[2] + tip[2]) / 2], tip], (q) => 0.045 * (1 - q * 0.45), skin, SOFT);
      ell(L, tip, [0.035, 0.025, 0.04], 0xf8e8e2, { fl: SOFT });
    }
  };
  limb('leg_fl', 'body', [0.5, 0.78, 0.15], [0.95, 0.5, 0.35], [1.08, 0.12, 0.55], 3);
  limb('leg_bl', 'spine2', [0.46, 0.76, -3.9], [0.88, 0.48, -3.95], [1.0, 0.12, -3.8], 2);

  rb.mirrorLR();
  for (const p of rb.parts) {
    if (!/^(gill|head|jaw)/.test(p.name)) lumpy(p.model, 6, 1, seed + p.name.length, 0.55);
    if (p.model.count > 12000) hollow(p.model, 3);
  }
  realFinish(rb, 0.55, false);
  return rb.build({ height: 1.75, radius: 1.1, length: 12.8, kind: 'olm' });
}
