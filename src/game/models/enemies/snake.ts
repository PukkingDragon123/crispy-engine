// The giant bell snake: a ~7 m western diamondback rattlesnake. A broad spade
// head with a frowning brow, slit amber eyes, heat pits, long folding fangs and
// a forked tongue; a heavy loaf-shaped body with cream-bordered diamonds, a
// black-and-white coon tail and a big eight-button rattle.
// The alpha is a horned sidewinder: raised horn scales over the eyes, acid-green
// borders, and bulging, dripping venom sacs (it bursts in acid when it dies).
//
// Rig (shared grid, faces +Z, rest pose lies straight along -Z):
//   head (root) ─ jaw ─ tongue
//              ├ fang_l, fang_r (fold / flick), eye_l, eye_r, (alpha: sac_l, sac_r)
//              └ seg1 ─ seg2 ─ … ─ seg16 ─ rattle ─ rattle2 ─ … ─ rattle8
//                 (alpha: neck_sac_l / neck_sac_r on seg1)
// Each segment's pivot is its front joint on the body axis; its geometry runs
// back toward -Z. A slightly inset joint ball reaches forward into the previous
// segment, so bends (even the 50° wrap coil) never open a gap.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, blob, smoothVox, lumps, ell, cap, tube, paint, wetEye, mixc, n01, jawExpressions, memo, hollow, Prim } from './frog';
import { hash3 } from '../../../engine/math/rand';

export interface SnakeOpts {
  alpha?: boolean;
  variant?: number;
}

interface SPal {
  base: number;
  side: number;
  crown: number;
  core: number;
  dark: number;
  border: number;
  flank: number;
  belly: number;
  scute: number;
  mask: number;
  stripe: number;
  lip: number;
  chin: number;
  ringDark: number;
  ringLight: number;
  rattle: [number, number, number];
  iris: number;
  mouth: [number, number];
}
// western diamondback: dusty grey-brown, dark diamonds with paler centres and a cream border row
const PAL: SPal = {
  base: 0x9a8466, side: 0xb39d7d, crown: 0x87714f, core: 0x7c6045, dark: 0x4a3322, border: 0xeee2c4, flank: 0x7f6850,
  belly: 0xeae0c8, scute: 0xcfc2a2, mask: 0x4a3322, stripe: 0xf2e8ce, lip: 0xe4d8ba, chin: 0xefe7d2,
  ringDark: 0x1f1b17, ringLight: 0xebe6d8, rattle: [0xcaa66c, 0x7a5a32, 0xeed6a4], iris: 0xd0902e, mouth: [0xe8aaae, 0xbf6f78],
};
// horned alpha: pale sidewinder sand, olive-black diamonds, acid-green borders, acid-stained mouth
const ALPHA_PAL: SPal = {
  base: 0xcab38b, side: 0xd8c4a0, crown: 0xb39b72, core: 0x6c6a3a, dark: 0x34341c, border: 0xb2e04a, flank: 0x8c8656,
  belly: 0xefe5cb, scute: 0xd2c6a6, mask: 0x34341c, stripe: 0xc6ec66, lip: 0xe6dcbc, chin: 0xf1e9d4,
  ringDark: 0x22241a, ringLight: 0xdeebb2, rattle: [0xd2b070, 0x80602e, 0xf2daa2], iris: 0xd8ea3c, mouth: [0xbcdc72, 0x6e9e30],
};
const ACID = { body: 0x9ce23c, vein: 0x4c8a1a, hi: 0xe2ffa0, drip: 0xb8f05c };

// ------------------------------------------------------------ body dimensions (voxels at 1/64 m)
const L = 24; // segment length
const NSEG = 16;
const BODY = L * NSEG; // 6 m of body behind the head
const RX = 1.1, RY = 0.92; // loaf cross-section: a touch wider than tall, flat belly
/** body radius along the length (t = 0 at the neck, 1 at the tail tip) */
const radius = (t: number) => {
  if (t < 0.3) return 8 + 4.6 * Math.sin((t / 0.3) * Math.PI * 0.5);
  if (t < 0.62) return 12.6 + 0.25 * Math.sin(((t - 0.3) / 0.32) * Math.PI);
  return 3.8 + 8.8 * Math.cos(((t - 0.62) / 0.38) * Math.PI * 0.5);
};
const cy = (t: number) => radius(t) * RY; // axis height: resting on the belly
const D = 24; // diamond pitch along the spine
const TAIL0 = Math.round((0.86 * BODY) / D) * D; // coon tail starts on a diamond boundary
const RING = 6;

/** march from inside a model to its skin along dir, sink a small dark pit there (nostrils, heat pits) */
function pit(m: VoxelModel, from: V3, dir: V3, r: number, col: number) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  let p: V3 = from;
  for (let i = 0; i < 80; i++) {
    const q: V3 = [from[0] + (dir[0] / l) * i * 0.4, from[1] + (dir[1] / l) * i * 0.4, from[2] + (dir[2] / l) * i * 0.4];
    if (!m.has(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]))) break;
    p = q;
  }
  ell(m, p, [r, r, r], 0, { carve: true });
  ell(m, p, [r + 1, r + 1, r + 1], col, { keep: (_a, _b, _c, i, j, k) => m.has(i, j, k) });
}

function snake(name: string, vs: number, pal: SPal, alpha: boolean): RigSpec {
  const rig = new CRig(name, vs);
  // ---------------------------------------------------------- skin pattern on the body (shared grid)
  const bodyCol = (x: number, y: number, z: number) => {
    const s = Math.max(0, -(z + 0.5)); // distance back from the head joint
    const t = Math.min(1, s / BODY);
    const r = radius(t);
    const th = Math.atan2(x + 0.5, y + 0.5 - cy(t)); // 0 on the spine, ±π under the belly
    const at = Math.abs(th);
    const bellyZone = at > Math.PI * 0.79;
    if (s >= TAIL0) {
      // coon tail: crisp black & white rings, softening across the belly
      const k = Math.floor((s - TAIL0) / RING) % 2;
      if (bellyZone) return k ? pal.belly : mixc(pal.ringDark, pal.belly, 0.6);
      return k ? pal.ringLight : pal.ringDark;
    }
    if (bellyZone) return Math.floor(s) % 5 === 0 ? pal.scute : pal.belly; // broad ventral scutes
    // dorsal diamonds: pale core, dark ring, one row of cream scales around
    const m = Math.floor(s / D);
    const u = s - (m + 0.5) * D;
    const v = th * r;
    const dd = Math.abs(u) / (D * 0.5) + Math.abs(v) / (r * 1.05);
    if (dd < 0.42) return pal.core;
    if (dd < 0.8) return pal.dark;
    if (dd < 0.98) return pal.border;
    // lateral blotches low on the flank, between the diamonds
    const u2 = s - Math.round(s / D) * D;
    if (Math.abs(u2) / (D * 0.32) + Math.abs(at - 1.62) / 0.34 < 1) return pal.flank;
    return at > 1.2 ? pal.side : pal.base;
  };
  const inTube = (x: number, y: number, z: number) => {
    if (y < 0) return false;
    const s = -(z + 0.5);
    if (s < 0 || s > BODY) return false;
    const t = s / BODY, r = radius(t);
    const nx = Math.abs(x + 0.5) / (r * RX), gy = (y + 0.5 - cy(t)) / (r * RY);
    // round back, flat-bottomed belly (superellipse below the axis)
    return gy >= 0 ? nx * nx + gy * gy <= 1 : nx ** 2.6 + (-gy) ** 2.6 <= 1;
  };

  // ---------------------------------------------------------- the head (root)
  const r0 = radius(0);
  rig.part('head', undefined, [0, cy(0), 0]);
  // segments: each a slice of the tube + a hidden joint ball reaching into its parent
  let parent = 'head';
  for (let k = 1; k <= NSEG; k++) {
    const z0 = -(k - 1) * L, z1 = -k * L;
    const t0 = -z0 / BODY;
    const rr = radius(t0);
    const seg = rig.part('seg' + k, parent, [0, cy(t0), z0]);
    const rMax = Math.max(rr, radius(Math.min(1, -z1 / BODY))) + 1;
    for (let z = z1; z < z0; z++)
      for (let y = 0; y <= Math.ceil(rMax * 2); y++)
        for (let x = -Math.ceil(rMax * RX) - 1; x <= Math.ceil(rMax * RX); x++) if (inTube(x, y, z)) seg.set(x, y, z, bodyCol(x, y, z));
    const jr = rr - 0.7;
    ell(seg, [0, cy(t0), z0], [jr * RX, jr * RY, rr * 0.85], bodyCol, { keep: (_lx, _ly, lz, _i, j) => lz > 0 && j >= 0, under: true });
    hollow(seg, 2);
    parent = 'seg' + k;
  }

  // ---------------------------------------------------------- the rattle: 8 interlocking keratin buttons, each rigged
  const tipR = radius(1), rcy = cy(1);
  const NR = 8;
  let rp = 'seg' + NSEG;
  let rz = -BODY + 1.2;
  const rattleParts: string[] = [];
  for (let k = 1; k <= NR; k++) {
    const sc = 1 - (k - 1) * 0.03;
    const w = tipR * 1.3 * sc, h = tipR * 1.08 * sc, len = 5.6 * sc;
    const nm = k === 1 ? 'rattle' : 'rattle' + k;
    const rt = rig.part(nm, rp, [0, rcy, rz]);
    const zc = rz - len * 0.55;
    const age = (k - 1) / (NR - 1); // older buttons toward the tip: paler, drier
    const bodyC = mixc(pal.rattle[0], 0xd9ceb2, age * 0.45);
    const z0 = rz;
    blob(rt, [
      { c: [0, rcy, zc], r: [w * 0.78, h, len * 0.56] },
      { c: [w * 0.44, rcy - h * 0.12, zc + len * 0.04], r: [w * 0.56, h * 0.82, len * 0.5] },
      { c: [-w * 0.44, rcy - h * 0.12, zc + len * 0.04], r: [w * 0.56, h * 0.82, len * 0.5] },
    ], (_x, y, z) => {
      const d = (z0 - (z + 0.5)) / len; // 0 at the lip tucked under the previous button
      if (d < 0.26) return pal.rattle[1];
      if (y + 0.5 > rcy + h * 0.55) return mixc(pal.rattle[2], 0xf4ead0, age * 0.3);
      return bodyC;
    }, { k: 1.0, keep: (_x, y) => y >= 0 });
    rattleParts.push(nm);
    rp = nm;
    rz -= len * 0.72;
  }

  // ---------------------------------------------------------- viper head: broad spade, venom jowls, frowning brows
  const HS = 1.25; // head design units -> voxels
  const U = (v: V3): V3 => [v[0] * HS, v[1] * HS, v[2] * HS];
  const head = rig.m('head');
  const hp: Prim[] = [
    { c: [0, cy(0), 1.2], r: [r0 * RX, r0 * RY, 7] }, // neck, matching the body joint
    { c: U([0, 8.0, 13]), r: U([11.5, 6.0, 10]) }, // broad cranium
    { c: U([9.4, 6.2, 12.5]), r: U([4.6, 5.0, 7.6]) }, // venom-gland jowls
    { c: U([-9.4, 6.2, 12.5]), r: U([4.6, 5.0, 7.6]) },
    { c: U([0, 8.4, 22]), r: U([10.0, 5.6, 8.5]) }, // mid head (eyes)
    { c: U([0, 8.0, 30]), r: U([6.2, 4.5, 6.4]) }, // snout
    { c: U([0, 7.8, 34.2]), r: U([4.6, 3.6, 3.0]) }, // blunt snout tip
    { c: U([6.4, 12.9, 22.6]), r: U([3.8, 1.8, 6.2]), rot: [0.12, -0.22, 0] }, // supraocular brows: the frown
    { c: U([-6.4, 12.9, 22.6]), r: U([3.8, 1.8, 6.2]), rot: [0.12, 0.22, 0] },
    { c: U([4.4, 10.6, 29.5]), r: U([1.8, 1.4, 6.0]), rot: [0.1, -0.15, 0] }, // canthal ridges to the snout
    { c: U([-4.4, 10.6, 29.5]), r: U([1.8, 1.4, 6.0]), rot: [0.1, 0.15, 0] },
    { c: U([0, 3.6, 19]), r: U([9.4, 3.6, 13]) }, // lower jaw
    { c: U([0, 4.0, 30.5]), r: U([5.2, 3.0, 4.6]) }, // chin
    { c: U([8.6, 4.4, 8.5]), r: U([3.6, 3.6, 4.0]) }, // jaw hinges
    { c: U([-8.6, 4.4, 8.5]), r: U([3.6, 3.6, 4.0]) },
    { c: U([0, 14.0, 22]), r: U([2.4, 1.2, 7.0]), sub: true, k: 1.5 }, // groove between the brows
  ];
  // mouth line (design units): long and nearly straight, dipping a touch toward the hinge
  const mouthU = (z: number) => 5.6 - Math.max(0, 30 - z) * 0.022;
  const mouthY = (zv: number) => HS * mouthU(zv / HS);
  const EYE: V3 = [8.1, 10.4, 22.6]; // design units
  const headCol = (x: number, y: number, z: number) => {
    const gx = (x + 0.5) / HS, gy = (y + 0.5) / HS, gz = (z + 0.5) / HS;
    if (gz < 2) return bodyCol(x, y, z); // the neck carries the body pattern
    const ax = Math.abs(gx);
    const ym = mouthU(gz);
    // postocular mask through the eye, bordered by two pale stripes, running down-back to the jaw
    const q = gy - EYE[1] - 0.55 * (gz - EYE[2]);
    const side = ax > 4.4;
    if (gy < ym - 0.2) {
      if (side && gz < 13 && q > -2.1 && q < 2.1) return pal.mask; // the mask reaches the jaw corner
      return gy < 1.9 || ax < 4.5 ? pal.chin : pal.lip;
    }
    if (side) {
      if (gz < EYE[2] + 1.5 && q > -2.1 && q < 2.1) return pal.mask;
      if (gz < EYE[2] - 0.5 && q >= 2.1 && q < 3.5) return pal.stripe;
      if (gz < EYE[2] + 2.4 && q <= -2.1 && q > -3.5) return pal.stripe;
      if (gy < ym + 1.3) return pal.lip; // pale upper-lip scales
    }
    if (gy > 12.2 && ax < 6.2) return pal.crown;
    if (gz > 29) return mixc(pal.base, pal.side, 0.4); // paler snout
    return pal.base;
  };
  blob(head, hp, headCol, { k: 3.2 * HS, keep: (_x, y) => y >= 0 });
  smoothVox(head, 1);
  // a neat row of keeled crown scales: darker scale edges every few voxels on the top
  paint(head, (x, y, z) => !head.has(x, y + 1, z) && (z + 0.5) / HS > 9 && (z + 0.5) / HS < 30 && Math.abs(x + 0.5) / HS < 6 && (x + 2 * z + 64) % 6 === 0, (x, y, z) => mixc(head.get(x, y, z)! & 0xffffff, 0x2a1c12, 0.3));

  // ---------------------------------------------------------- the lower jaw (split along the mouth line)
  const hingeZ = 8.5 * HS;
  rig.part('jaw', 'head', [0, mouthY(hingeZ + 1.5), hingeZ + 1.5]);
  rig.move('head', 'jaw', (x, y, z) => y + 0.5 < mouthY(z + 0.5) && z + 0.5 > hingeZ);
  const jaw = rig.m('jaw');
  // mouth lining on the hidden seam faces (a lip margin of skin is kept)
  const inner2 = (m: VoxelModel, x: number, y: number, z: number) => m.has(x + 2, y, z) && m.has(x - 2, y, z) && m.has(x, y, z + 2);
  paint(jaw, (x, y, z) => !jaw.has(x, y + 1, z) && inner2(jaw, x, y, z), (_x, _y, z) => ((z + 0.5) / HS < 15 ? pal.mouth[1] : pal.mouth[0]));
  paint(head, (x, y, z) => !head.has(x, y - 1, z) && inner2(head, x, y, z) && z + 0.5 > hingeZ, (_x, _y, z) => ((z + 0.5) / HS < 15 ? pal.mouth[1] : pal.mouth[0]));
  // small recurved teeth along both jaw rows
  for (let z = Math.floor(13 * HS); z < Math.floor(33 * HS); z += 3) {
    let edge = -1, top = 0;
    jaw.forEach((x, y, zz) => {
      if (zz !== z || x < 0 || jaw.has(x, y + 1, zz)) return;
      if (x > edge) {
        edge = x;
        top = y;
      }
    });
    if (edge < 3) continue;
    for (const s of [1, -1]) {
      const tx = s > 0 ? edge - 2 : -1 - (edge - 2);
      const hgt = (z + 0.5) / HS > 26 ? 2 : 1;
      for (let j = 1; j <= hgt; j++) jaw.set(tx, top + j, z, j === hgt ? 0xfdf8ec : 0xf2e8d2);
    }
  }
  // forked tongue in its sheath (rigged: flicks out through the lingual notch)
  const mT = (z: number) => mouthU(z) - 0.45;
  cap(jaw, U([0, mT(12), 12]), U([0, mT(33), 33]), 1.05 * HS, 0.9 * HS, 0, { carve: true });
  const tng = rig.part('tongue', 'jaw', U([0, mT(13), 13]));
  tube(tng, [U([0, mT(13), 13]), U([0, mT(22), 22]), U([0, mT(29), 29])], [0.75 * HS, 0.62 * HS, 0.5 * HS], (_x, _y, z) => ((z + 0.5) / HS > 26 ? 0x3c1016 : 0x6a1c26));
  for (const s of [1, -1]) cap(tng, U([0, mT(29), 29]), U([s * 1.15, mT(32.5) + 0.15, 32.5]), 0.42 * HS, 0.16 * HS, 0x2a0a10);
  ell(head, U([0, mouthU(36) + 0.4, 36.2]), U([0.9, 0.8, 1.8]), 0, { carve: true }); // lingual notch

  // ---------------------------------------------------------- folding fangs (rigged), sheathed in jaw grooves
  const fangs: string[] = [];
  for (const s of [1, -1]) {
    const nm = s > 0 ? 'fang_l' : 'fang_r';
    const mb = mouthU(31.5);
    const b = U([s * 2.9, mb + 0.6, 31.5]), mid = U([s * 3.1, mb - 2.2, 32.2]), tip = U([s * 2.8, mb - 3.9, 31.2]);
    const fg = rig.part(nm, 'head', b);
    tube(fg, [b, mid, tip], [0.95 * HS, 0.68 * HS, 0.22 * HS], (_x, y) => (y + 0.5 < tip[1] + 2.2 ? 0xfffaee : 0xe8dcc0));
    if (alpha) ell(fg, [tip[0], tip[1] - 0.7, tip[2]], [0.85, 1.05, 0.85], ACID.drip); // venom bead
    cap(jaw, b, tip, 1.25 * HS, 0.75 * HS, 0, { carve: true });
    fangs.push(nm);
  }
  // heat pits (between eye and nostril) and nostrils
  for (const s of [1, -1]) {
    pit(head, U([s * 3.6, 8.5, 30.4]), [s, 0, 0.15], 0.85 * HS, 0x140c08);
    pit(head, U([s * 2.2, 9.2, 32.5]), [s * 0.25, 0.15, 1], 0.6 * HS, 0x140c08);
  }

  // ---------------------------------------------------------- slit-pupil eyes, hooded by the brows
  const er = 2.2 * HS;
  const eL = U(EYE);
  ell(head, eL, [er * 1.06, er * 1.06, er * 1.06], 0, { carve: true });
  ell(head, [-eL[0], eL[1], eL[2]], [er * 1.06, er * 1.06, er * 1.06], 0, { carve: true });
  const eyeL = rig.part('eye_l', 'head', eL);
  wetEye(eyeL, eL, er, [0.78, 0.02, 0.62], { sclera: 0x2a2010, iris: pal.iris, pupil: 0x050403, irisR: 0.97, slit: true });
  rig.mirror('eye_l', 'eye_r');

  // ---------------------------------------------------------- alpha: horn scales + bulging, dripping acid sacs
  const sacs: string[] = [];
  if (alpha) {
    for (const s of [1, -1]) {
      const a = U([s * 6.6, 13.2, 23.6]), b = U([s * 7.3, 16.4, 22.8]), c = U([s * 7.6, 19.2, 20.4]);
      tube(head, [a, b, c], [1.85 * HS, 1.15 * HS, 0.28 * HS], (_x, y) => {
        const gy = y + 0.5;
        if (gy < a[1] + 1.2) return pal.crown;
        if (gy > c[1] - 1.6) return 0xfff4dc;
        return Math.floor(gy / 1.4) % 2 ? 0xd6c6a0 : 0xe8dcbc; // keratin growth rings
      });
    }
    const acid = (x: number, y: number, z: number) => {
      const n = n01(x, y, z, 0.32, 5);
      if (Math.abs(n - 0.5) < 0.035) return ACID.vein; // veins
      if (n01(x, y, z, 0.6, 11) > 0.8) return ACID.hi; // glossy blisters
      return ACID.body;
    };
    const sac = (nm: string, par: string, c: V3, r: V3, seed: number) => {
      const sm = rig.part(nm, par, c);
      const sx = Math.sign(c[0]) || 1;
      blob(sm, [
        { c, r },
        { c: [c[0] + sx * r[0] * 0.15, c[1] - r[1] * 0.45, c[2] - r[2] * 0.25], r: [r[0] * 0.72, r[1] * 0.6, r[2] * 0.62] },
        { c: [c[0] + sx * r[0] * 0.05, c[1] + r[1] * 0.3, c[2] + r[2] * 0.4], r: [r[0] * 0.6, r[1] * 0.55, r[2] * 0.5] },
      ], acid, { k: 1.6, disp: lumps(0.45, 0.36, seed), keep: (_x, y) => y >= 0 });
      smoothVox(sm, 1);
      // drips hanging under the sac: a thread and a fat droplet
      for (let d = 0; d < 3; d++) {
        const dx = c[0] + (hash3(d, seed, 7) - 0.5) * r[0] * 0.9, dz = c[2] + (hash3(d, 5, seed) - 0.5) * r[2] * 0.9;
        const top = c[1] - r[1] * 0.75;
        const len = 2 + hash3(d, 9, seed) * 3;
        if (top - len < 1) continue;
        cap(sm, [dx, top, dz], [dx, top - len, dz], 0.75, 0.45, ACID.drip);
        ell(sm, [dx, top - len - 0.4, dz], [0.95, 1.2, 0.95], ACID.hi);
      }
      sacs.push(nm);
      return sm;
    };
    sac('sac_l', 'head', U([10.6, 7.6, 13.4]), U([3.4, 3.8, 5.0]), 9);
    rig.mirror('sac_l', 'sac_r');
    sacs.push('sac_r');
    const t1 = 9 / BODY, nr = radius(t1);
    sac('neck_sac_l', 'seg1', [nr * RX + 0.8, cy(t1) + 1.8, -9], [3.0, 3.5, 4.8], 13);
    rig.mirror('neck_sac_l', 'neck_sac_r', 'seg1');
    sacs.push('neck_sac_r');
  }
  hollow(head, 2);
  hollow(jaw, 2);

  // ---------------------------------------------------------- sockets + meta
  const tipF = U([2.8, mouthU(31.5) - 3.9, 31.2]);
  rig.socket('mouth', 'jaw', U([0, mouthU(34), 35.5]));
  rig.socket('fang_l', 'fang_l', tipF);
  rig.socket('fang_r', 'fang_r', [-tipF[0], tipF[1], tipF[2]]);
  rig.socket('tongue_tip', 'tongue', U([0, mT(32.5), 32.5]));
  rig.socket('head_top', 'head', U([0, 14.6, 18]));
  rig.socket('rattle_tip', rp, [0, rcy, rz]);
  if (alpha) {
    rig.socket('venom_l', 'sac_l', U([12.4, 7.6, 13.4]));
    rig.socket('venom_r', 'sac_r', U([-12.4, 7.6, 13.4]));
  }
  const headLen = 37.3 * HS;
  return rig.build({
    kind: 'snake',
    height: 14.6 * HS * vs,
    /** body half-width at its thickest */
    radius: 12.85 * RX * vs,
    segLength: L * vs,
    segments: NSEG,
    headLength: headLen * vs,
    length: (headLen - rz) * vs,
    /** body radius at each segment joint (m) */
    segRadius: Array.from({ length: NSEG }, (_, i) => radius(i / NSEG) * vs),
    /** rattle buttons, base first (shake 'rattle' for the whole rattle) */
    rattleParts,
    fangParts: fangs,
    sacParts: sacs,
    /** the jaw opens about X (positive = open); ~1.9 rad is a full strike gape */
    jawMax: 1.9,
    expressions: jawExpressions({ neutral: 0, angry: 0.3, snarl: 0.6, enraged: 0.95, hurt: 0.3, stunned: 0.2, defeated: 0.5, smug: 0.05, laugh: 0.45 }),
  });
}

/** giant bell snake (~7 m western diamondback); the alpha is the horned acid sidewinder (same base size: the game scales alphas) */
export const bellSnakeRig = memo((o: SnakeOpts = {}): RigSpec => (o?.alpha ? snake('bell_snake_alpha', 1 / 64, ALPHA_PAL, true) : snake('bell_snake', 1 / 64, PAL, false)));
