// Thorny (horned) lizards: flat, wide, armoured pancakes with a crown of horns,
// a fringe of spiky scales and desert-camouflage blotches — and they squirt
// blood from their eyes. Normal / alpha / "Old Thornback" (ancient miniboss with
// a cactus growing on its back and a crown of bleached bone).
//
// Rig (all authored in one shared grid, faces +Z):
//   body (root) ─ head ─ jaw, eye_l, eye_r, horn_l, horn_r (occipital pair), crown_l, crown_r (temporal rows)
//              ├ frill_l, frill_r (lateral fringe — rotate to flare)
//              ├ leg_fl ─ foot_fl (… fr, bl, br)
//              └ tail1 ─ tail2 ─ tail3      (boss: + cactus on body, bone_crown on head)
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, blob, smoothVox, lumps, ell, cap, tube, paint, exposed, wetEye, mixc, mulc, n01, jawExpressions, memo, hollow, Prim } from './frog';
import { hash3, noise } from '../../../engine/math/rand';

export interface LizardOpts {
  alpha?: boolean;
  variant?: number;
}

interface LPal {
  base: number;
  pale: number;
  blotch: number;
  rim: number;
  belly: number;
  horn: number;
  hornBase: number;
  head: number;
  claw: number;
  iris: number;
}
const PALS: LPal[] = [
  { base: 0xc2a77f, pale: 0xd8c4a0, blotch: 0x5e4330, rim: 0xecdcb8, belly: 0xefe2c4, horn: 0xeadfc4, hornBase: 0xb89c70, head: 0xcdb48c, claw: 0x3a2a1e, iris: 0xc89a3a },
  { base: 0xb4a48c, pale: 0xcfc2aa, blotch: 0x4e4236, rim: 0xe6dcc6, belly: 0xeee6d2, horn: 0xe6dcc8, hornBase: 0xa8987c, head: 0xc0b098, claw: 0x342a22, iris: 0xbe9440 },
  { base: 0xc8a070, pale: 0xdcbc8c, blotch: 0x6a3e26, rim: 0xf0d6a8, belly: 0xf2e2c2, horn: 0xeedcb8, hornBase: 0xbc9060, head: 0xd2ac7c, claw: 0x3e2a1a, iris: 0xd0a040 },
];
const ALPHA_PAL: LPal = { base: 0xc48a62, pale: 0xd8a87c, blotch: 0x6a2e1e, rim: 0xf0d0a0, belly: 0xf0dcc0, horn: 0xf0e2c4, hornBase: 0xa86a42, head: 0xcc946a, claw: 0x2e1e14, iris: 0xe0a028 };
const BOSS_PAL: LPal = { base: 0x8e8270, pale: 0xa89c86, blotch: 0x463c30, rim: 0xcfc4aa, belly: 0xe2d8c2, horn: 0xeae2cf, hornBase: 0x8a7a60, head: 0x998c78, claw: 0x241e18, iris: 0xd8d2c0 };

interface LCfg {
  name: string;
  vs: number;
  S: number;
  pal: LPal;
  alpha: boolean;
  boss: boolean;
  seed: number;
}

function lizard(c: LCfg): RigSpec {
  const { S, pal, seed } = c;
  const P = (x: number, y: number, z: number): V3 => [x * S, y * S, z * S];
  const rig = new CRig(c.name, c.vs);
  const body = rig.part('body', undefined, P(0, 5.6, 0));
  const hornK = c.boss ? 1.25 : c.alpha ? 1.4 : 1;
  // ---------------------------------------------------------- camouflage pattern (clean regions)
  const blotches: { c: V3; r: number }[] = [
    { c: P(4.6, 9, 10.5), r: 3.4 * S },
    { c: P(-4.6, 9, 10.5), r: 3.4 * S },
    { c: P(5.4, 9, 4), r: 2.9 * S },
    { c: P(-5.4, 9, 4), r: 2.9 * S },
    { c: P(5.6, 9, -2.5), r: 3.1 * S },
    { c: P(-5.6, 9, -2.5), r: 3.1 * S },
    { c: P(4.8, 8.6, -9), r: 2.7 * S },
    { c: P(-4.8, 8.6, -9), r: 2.7 * S },
    { c: P(2.6, 6.5, -17), r: 1.9 * S },
    { c: P(-2.6, 6.5, -17), r: 1.9 * S },
    { c: P(0, 5.4, -22), r: 1.7 * S },
  ];
  const pattern = (x: number, y: number, z: number) => {
    const gx = x + 0.5, gy = y + 0.5, gz = z + 0.5;
    if (gy < 4.2 * S) return pal.belly;
    let best = 1e9;
    for (const b of blotches) {
      const w = noise.n3(gx * 0.25 / S + seed, gy * 0.25 / S, gz * 0.25 / S) * 0.7 * S;
      best = Math.min(best, Math.hypot(gx - b.c[0], (gy - b.c[1]) * 0.4, gz - b.c[2]) - b.r + w);
    }
    if (best < 0) return pal.blotch;
    if (best < 0.9 * S) return pal.rim;
    if (Math.abs(gx) < 1.3 * S && gy > 7.6 * S) return pal.pale; // mid-dorsal stripe
    return pal.base;
  };
  // ---------------------------------------------------------- the armoured pancake body
  const bodyPrims: Prim[] = [
    { c: P(0, 5.8, 0), r: P(13.2, 3.7, 14) },
    { c: P(0, 6.2, 8.5), r: P(11, 3.6, 6.5) }, // shoulders
    { c: P(0, 6.0, -9), r: P(11.8, 3.5, 6.4) }, // hips
    { c: P(0, 4.6, 0), r: P(14.6, 2.2, 13) }, // flat belly flare
    { c: P(0, 7.6, 0), r: P(6.2, 2.0, 12.5) }, // gentle dorsal ridge
  ];
  const lumpy = lumps(0.35 * S, 0.12 / S, seed);
  blob(body, bodyPrims, pattern, { k: 2.4 * S, disp: lumpy, keep: (_x, y) => y >= Math.floor(2.2 * S) });
  smoothVox(body, 2);
  // granular scale texture: tiny raised tubercles in tidy rows (fewer, larger at alpha/boss)
  const tub: V3[] = [];
  for (let z = -11; z <= 11; z += 3.4)
    for (let x = -9.5; x <= 9.5; x += 3.4) {
      const jx = (hash3(x * 3 + seed, z * 5, 1) - 0.5) * 1.4, jz = (hash3(x * 7, z * 3 + seed, 2) - 0.5) * 1.4;
      if ((x / 12) ** 2 + (z / 13) ** 2 > 1) continue;
      tub.push(P(x + jx, 0, z + jz));
    }
  for (const t of tub) {
    let top = -1;
    const xi = Math.floor(t[0]), zi = Math.floor(t[2]);
    for (let y = Math.ceil(16 * S); y >= 0; y--) if (body.has(xi, y, zi)) {
      top = y;
      break;
    }
    if (top < 0) continue;
    const h = (c.alpha || c.boss ? 1.5 : 1.1) * S;
    const base0 = body.get(xi, top, zi)! & 0xffffff;
    cap(body, [xi + 0.5, top + 0.5, zi + 0.5], [xi + 0.5 + (hash3(xi, zi, 3) - 0.5) * 0.6, top + 0.5 + h, zi + 0.5 - 0.5 * S], 0.7 * S, 0.15, (_x, y) => (y > top + h * 0.6 ? pal.rim : base0), { under: true });
  }
  // ---------------------------------------------------------- frill: fringe of pointed scales along each flank (rigged)
  const frillL = rig.part('frill_l', 'body', P(12.5, 5, 0));
  for (let z = -11; z <= 11.5; z += 1.9) {
    const t = z / 13;
    const ex = Math.sqrt(Math.max(0, 1 - t * t)) * 14.4 * S;
    const len = (2.4 + Math.cos(t * 1.4) * 1.3) * S * (c.alpha ? 1.3 : 1);
    for (const row of [0, 1]) {
      const y0 = (4.4 + row * 1.6) * S;
      const base: V3 = [ex - 0.9 * S - row * 0.8 * S, y0, z * S];
      const tip: V3 = [ex + len - row * 0.9 * S, y0 - (row ? 0.2 : 0.8) * S, z * S - 1.1 * S];
      cap(frillL, base, tip, 0.85 * S, 0.15, (_x, _y, _z) => pal.rim, {});
      ell(frillL, base, [0.9 * S, 0.7 * S, 0.9 * S], pal.base, { under: true });
    }
  }
  rig.mirror('frill_l', 'frill_r');
  // ---------------------------------------------------------- head: wide, flat, triangular, with a jaw
  const head = rig.part('head', 'body', P(0, 6.0, 13.5));
  const headPrims: Prim[] = [
    { c: P(0, 6.6, 17.6), r: P(8.6, 3.4, 5.0) }, // cranium (flat-topped)
    { c: P(0, 6.0, 22.3), r: P(5.4, 2.6, 3.6) }, // blunt snout
    { c: P(5.4, 5.4, 18.8), r: P(3.4, 2.2, 4.0) }, // jowls
    { c: P(-5.4, 5.4, 18.8), r: P(3.4, 2.2, 4.0) },
    { c: P(0, 6.2, 14.4), r: P(7.8, 3.2, 3.0) }, // neck merge
  ];
  blob(head, headPrims, (x, y, z) => {
    const gy = y + 0.5, gx = x + 0.5, gz = z + 0.5;
    if (gy < 4.8 * S) return pal.belly;
    // dark bar from the eye back to the temporal horns
    if (Math.abs(Math.abs(gx) - 5.6 * S) < 0.9 * S && gz < 19.5 * S && gz > 15.5 * S && gy > 7.4 * S) return pal.blotch;
    return pal.head;
  }, { k: 1.8 * S, disp: lumps(0.25 * S, 0.15 / S, seed + 3) });
  smoothVox(head, 1);
  // mouth line + jaw split
  const mouthY = (z: number) => 5.2 * S + (z - 18 * S) * 0.04;
  rig.part('jaw', 'head', P(0, 5.2, 16.5));
  rig.move('head', 'jaw', (x, y, z) => y + 0.5 < mouthY(z + 0.5) && z + 0.5 > 15.2 * S);
  const jaw = rig.m('jaw');
  paint(jaw, (x, y, z) => !jaw.has(x, y + 1, z) && jaw.has(x, y, z + 1) && jaw.has(x + 1, y, z) && jaw.has(x - 1, y, z), 0xc8706a);
  paint(head, (x, y, z) => {
    if (head.has(x, y, z + 1) || !head.has(x, y, z - 1)) return false;
    return Math.abs(y + 0.5 - mouthY(z + 0.5)) < 0.8 && z + 0.5 > 17 * S;
  }, 0x3a2620); // dark lip line where visible at the front
  // nostrils
  for (const s of [1, -1]) {
    const xi = Math.floor(s * 1.6 * S + (s < 0 ? -0.5 : 0)), yi = Math.floor(7.0 * S);
    for (let z = Math.ceil(26 * S); z > 0; z--)
      if (head.has(xi, yi, z)) {
        head.set(xi, yi, z, 0x2a1c14);
        break;
      }
  }
  // ---------------------------------------------------------- eyes (golden iris, round pupil) under spiky brow ridges
  const er = 1.7 * S;
  const eL: V3 = P(5.6, 8.0, 19.6);
  ell(head, eL, [er * 1.02, er * 1.02, er * 1.02], 0, { carve: true });
  ell(head, [-eL[0], eL[1], eL[2]], [er * 1.02, er * 1.02, er * 1.02], 0, { carve: true });
  const eyeL = rig.part('eye_l', 'head', eL);
  wetEye(eyeL, eL, er, [0.75, 0.25, 0.6], { sclera: 0x2a1c12, iris: pal.iris, pupil: 0x080604, irisR: 0.92, pupilR: 0.42, cloudy: c.boss ? 0.45 : 0 });
  rig.mirror('eye_l', 'eye_r');
  // brow ridge + supraocular spikes (static, part of the head)
  for (const s of [1, -1]) {
    const e: V3 = [s * eL[0], eL[1], eL[2]];
    blob(head, [{ c: [e[0] * 0.97, e[1] + er * 0.9, e[2] - er * 0.3], r: [er * 1.25, er * 0.5, er * 1.2] }], pal.head, { k: 1, under: true });
    cap(head, [e[0], e[1] + er * 1.1, e[2] - er * 0.4], [e[0] + s * er * 0.9, e[1] + er * 2.1, e[2] - er * 1.0], er * 0.42, 0.2, pal.horn, { under: true });
  }
  // ---------------------------------------------------------- the crown of horns (rigged: occipital pair + temporal rows)
  const hornCol = (base: V3, tip: V3) => (x: number, y: number, z: number) => {
    const d = Math.hypot(x + 0.5 - base[0], y + 0.5 - base[1], z + 0.5 - base[2]);
    const L = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
    const t = d / L;
    // growth rings near the base, ivory tip
    if (t < 0.45 && Math.floor(d / (0.9 * S)) % 2 === 0) return mixc(pal.hornBase, pal.horn, 0.3);
    return mixc(pal.hornBase, pal.horn, Math.min(1, t * 1.6));
  };
  const occBase: V3 = P(2.8, 8.8, 14.6);
  const occTip: V3 = [occBase[0] + 2.2 * S * hornK, occBase[1] + 6.2 * S * hornK, occBase[2] - 4.4 * S * hornK];
  const hornL = rig.part('horn_l', 'head', occBase);
  // slightly curved: two-segment taper
  const occMid: V3 = [(occBase[0] + occTip[0]) / 2 + 0.3 * S, (occBase[1] + occTip[1]) / 2 + 0.5 * S, (occBase[2] + occTip[2]) / 2];
  tube(hornL, [occBase, occMid, occTip], [1.7 * S * Math.sqrt(hornK), 1.05 * S * Math.sqrt(hornK), 0.2], hornCol(occBase, occTip));
  if (!c.boss) rig.mirror('horn_l', 'horn_r');
  else {
    // the old one's right horn snapped off long ago: a jagged stub
    const hornR = rig.part('horn_r', 'head', [-occBase[0], occBase[1], occBase[2]]);
    const stubTip: V3 = [-(occBase[0] + 0.8 * S), occBase[1] + 2.4 * S, occBase[2] - 1.8 * S];
    tube(hornR, [[-occBase[0], occBase[1], occBase[2]], stubTip], [1.5 * S * Math.sqrt(hornK), 1.2 * S], hornCol([-occBase[0], occBase[1], occBase[2]], [-occTip[0], occTip[1], occTip[2]]));
    paint(hornR, (x, y, z) => !hornR.has(x, y + 1, z) && hash3(x, y, z) > 0.5, 0xc8bca4);
  }
  const crownL = rig.part('crown_l', 'head', P(6.2, 8.0, 15.6));
  const temporal: [V3, V3][] = [
    [P(4.8, 8.6, 14.8), P(7.0, 12.0, 11.4)],
    [P(6.6, 8.0, 15.6), P(10.2, 10.0, 12.8)],
    [P(7.8, 7.2, 17.0), P(11.8, 8.0, 15.2)],
    [P(8.4, 6.4, 18.6), P(12.0, 6.6, 17.6)],
  ];
  if (c.alpha || c.boss) temporal.push([P(3.6, 9.0, 14.2), P(4.6, 13.4, 10.8)], [P(8.6, 5.6, 20.0), P(11.6, 5.2, 19.8)]);
  for (const [b, t] of temporal) {
    const tip: V3 = [b[0] + (t[0] - b[0]) * hornK, b[1] + (t[1] - b[1]) * hornK, b[2] + (t[2] - b[2]) * hornK];
    cap(crownL, b, tip, 0.95 * S, 0.15, hornCol(b, tip));
  }
  rig.mirror('crown_l', 'crown_r');
  // ---------------------------------------------------------- splayed legs + clawed feet
  const limb = (side: 'f' | 'b') => {
    const zS = side === 'f' ? 8.5 : -8.2;
    const sh: V3 = P(9.6, 4.6, zS);
    const kn: V3 = P(14.6, 6.0, zS + (side === 'f' ? 1.4 : -0.8));
    const an: V3 = P(16.4, 1.6, zS + (side === 'f' ? 2.6 : 0.4));
    const leg = rig.part('leg_' + side + 'l', 'body', sh);
    tube(leg, [sh, kn, an], [2.2 * S, 1.7 * S, 1.2 * S], (_x, y) => (y + 0.5 < 3.0 * S ? pal.belly : pal.base));
    // scaled knee spike
    cap(leg, kn, [kn[0] + 0.6 * S, kn[1] + 1.8 * S, kn[2] - 0.6 * S], 0.7 * S, 0.15, pal.horn, { under: true });
    const foot = rig.part('foot_' + side + 'l', 'leg_' + side + 'l', an);
    blob(foot, [{ c: [an[0], 1.0 * S, an[2] + 0.8 * S], r: [1.8 * S, 0.9 * S, 2.2 * S] }], pal.base, { k: 1, keep: (_x, y) => y >= 0 });
    for (let t = 0; t < 5; t++) {
      const a = (side === 'f' ? -0.4 : -0.9) + t * 0.42;
      const len = (t === 3 ? 3.6 : t === 4 ? 2.4 : 3.0) * S;
      const tip: V3 = [an[0] + Math.sin(a) * len, 0.6, an[2] + 0.8 * S + Math.cos(a) * len];
      cap(foot, [an[0], 0.9 * S, an[2] + 0.8 * S], tip, 0.55 * S, 0.4 * S, pal.base, { keep: (_a, _b, _c, _x, y) => y >= 0 });
      cap(foot, tip, [tip[0] + Math.sin(a) * 0.9 * S, 0.5, tip[2] + Math.cos(a) * 0.9 * S], 0.35 * S, 0.12, pal.claw, { keep: (_a, _b, _c, _x, y) => y >= 0 });
    }
  };
  limb('f');
  limb('b');
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');
  // ---------------------------------------------------------- short, wide, flattened tail (3 links)
  const tp: V3[] = [P(0, 5.2, -12.5), P(0, 4.4, -18.6), P(0, 3.6, -23.4), P(0, 2.8, -27.4)];
  const tr = [4.6 * S, 3.2 * S, 2.0 * S, 0.7 * S];
  let parent = 'body';
  for (let i = 0; i < 3; i++) {
    const t = rig.part('tail' + (i + 1), parent, tp[i]);
    // flattened cross-section: build as a chain of squashed blobs
    const prims: Prim[] = [];
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const p: V3 = [tp[i][0], tp[i][1] + (tp[i + 1][1] - tp[i][1]) * u, tp[i][2] + (tp[i + 1][2] - tp[i][2]) * u];
      const r = tr[i] + (tr[i + 1] - tr[i]) * u;
      prims.push({ c: p, r: [r * 1.25, r * 0.62, Math.max(1.2, r * 0.9)] });
    }
    blob(t, prims, pattern, { k: 1.2 * S, keep: (_x, y) => y >= 0 });
    // tail fringe spikes at the base
    if (i < 2)
      for (let k = 0; k < 3; k++) {
        const u = (k + 0.5) / 3;
        const z = tp[i][2] + (tp[i + 1][2] - tp[i][2]) * u;
        const r = (tr[i] + (tr[i + 1] - tr[i]) * u) * 1.2;
        for (const s of [1, -1]) cap(t, [s * r * 0.85, tp[i][1] - 0.4 * S, z], [s * (r + 1.2 * S), tp[i][1] - 0.2 * S, z - 0.8 * S], 0.6 * S, 0.12, pal.rim, { under: true });
      }
    parent = 'tail' + (i + 1);
  }
  // ---------------------------------------------------------- alpha & boss extras
  if (c.alpha || c.boss) {
    // battle scars: pale raked lines across the back
    const scars: [V3, V3][] = [[P(-6, 9, 6), P(3, 9, -3)], [P(2, 9, 9), P(9, 8, 2)], [P(-9, 8, -4), P(-2, 9, -11)]];
    for (const [a, b] of scars) {
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const xi = Math.floor(a[0] + (b[0] - a[0]) * u), zi = Math.floor(a[2] + (b[2] - a[2]) * u);
        for (let y = Math.ceil(16 * S); y > 0; y--) if (body.has(xi, y, zi)) {
          body.set(xi, y, zi, 0xd8b4a8);
          break;
        }
      }
    }
  }
  if (c.boss) {
    // lichen crusts on the old back (orange + chartreuse patches)
    paint(body, (x, y, z) => !body.has(x, y + 1, z) && y + 0.5 > 7.4 * S && n01(x, y, z, 0.12 / S, 31) > 0.74, (x, y, z) => (n01(x, y, z, 0.3 / S, 7) > 0.5 ? 0xd88a2a : 0xa8ae46));
    // a little saguaro (and a prickly-pear cluster) growing out of a sand drift on its back
    const cb: V3 = P(-3.2, 9.4, -3.5);
    const cact = rig.part('cactus', 'body', cb);
    ell(cact, [cb[0], cb[1] - 0.6 * S, cb[2]], [3.2 * S, 1.2 * S, 3.0 * S], (x, y, z) => (hash3(x, y, z) > 0.6 ? 0xd8b880 : 0xc8a46c));
    const green = (x: number, y: number, z: number) => {
      const a = Math.atan2(z + 0.5 - cb[2], x + 0.5 - cb[0]);
      return Math.sin(a * 6) > 0.2 ? 0x5e8a3e : 0x4a7432; // ribs as clean stripes
    };
    tube(cact, [cb, [cb[0], cb[1] + 7 * S, cb[2]], [cb[0], cb[1] + 9.2 * S, cb[2]]], [1.5 * S, 1.4 * S, 1.0 * S], green);
    tube(cact, [[cb[0], cb[1] + 3.6 * S, cb[2]], [cb[0] + 2.6 * S, cb[1] + 3.8 * S, cb[2]], [cb[0] + 2.8 * S, cb[1] + 6.8 * S, cb[2]]], [0.95 * S, 0.9 * S, 0.7 * S], green);
    tube(cact, [[cb[0], cb[1] + 5 * S, cb[2]], [cb[0] - 2.2 * S, cb[1] + 5.1 * S, cb[2] + 0.4 * S], [cb[0] - 2.4 * S, cb[1] + 7.2 * S, cb[2] + 0.4 * S]], [0.85 * S, 0.8 * S, 0.6 * S], green);
    // a pink bloom on top
    ell(cact, [cb[0], cb[1] + 9.6 * S, cb[2]], [0.9 * S, 0.55 * S, 0.9 * S], 0xe85a8a);
    // prickly pear pads
    const pp: V3 = P(4.4, 8.8, -7.5);
    for (const [dx, dy, ang] of [[0, 1.8, 0.2], [1.6, 3.4, -0.5], [-1.4, 3.0, 0.7]] as [number, number, number][])
      blob(cact, [{ c: [pp[0] + dx * S, pp[1] + dy * S, pp[2]], r: [1.6 * S, 2.0 * S, 0.55 * S], rot: [0, 0.4, ang] }], (x, y, z) => (hash3(x, y, z) > 0.92 ? 0xf0e8c0 : 0x6c9a44), { k: 1, under: true });
    // the bone crown: a ring of bleached vertebrae + cattle-horn tips around the horns
    const bc = rig.part('bone_crown', 'head', P(0, 9.8, 16.2));
    for (let a = 0; a < 9; a++) {
      const ang = (a / 9) * Math.PI * 2;
      const p: V3 = [Math.sin(ang) * 4.6 * S, 9.6 * S + Math.cos(ang * 2) * 0.3 * S, 16.6 * S + Math.cos(ang) * 3.6 * S];
      blob(bc, [{ c: p, r: [1.0 * S, 0.8 * S, 0.9 * S] }], (x, y, z) => (hash3(x, y, z) > 0.7 ? 0xd8ccb0 : 0xeee6d2), { k: 1 });
      if (a % 2 === 0) cap(bc, [p[0], p[1] + 0.5 * S, p[2]], [p[0] * 1.15, p[1] + 3.2 * S, p[2] - 0.6 * S], 0.7 * S, 0.15, 0xf2ecdc);
    }
  }
  hollow(body, 3);
  // sockets + meta (blood squirts from the front corner of each eye)
  const tipL: V3 = [eL[0] - er * 0.15, eL[1] + er * 0.1, eL[2] + er * 0.95];
  const tipR: V3 = [-tipL[0], tipL[1], tipL[2]];
  rig.socket('eye_tip_l', 'eye_l', tipL);
  rig.socket('eye_tip_r', 'eye_r', tipR);
  rig.socket('mouth', 'jaw', P(0, 5.2, 25.4));
  rig.socket('head_top', 'head', P(0, 10, 17));
  rig.socket('back', 'body', P(0, 9.2, -2));
  const vs = c.vs;
  const m3 = (p: V3) => [p[0] * vs, p[1] * vs, p[2] * vs];
  return rig.build({
    kind: 'lizard',
    height: (c.boss ? 19 : 11.5) * S * vs,
    radius: 13 * S * vs,
    length: (25.9 + 27.4) * S * vs,
    /** blood squirt origin: voxel coords in the eye part's (shared) space, plus metres in rest pose */
    eyeTip_l: tipL,
    eyeTip_r: tipR,
    eyeTipPart_l: 'eye_l',
    eyeTipPart_r: 'eye_r',
    eyeTipM_l: m3(tipL),
    eyeTipM_r: m3(tipR),
    /** frill flare: rotate frill_l about Z by -angle (frill_r +angle); horns can be raised about X */
    frillFlare: 0.5,
    expressions: jawExpressions({ neutral: 0, angry: 0.18, snarl: 0.3, hurt: 0.15, stunned: 0.22, enraged: 0.35, defeated: 0.3, laugh: 0.2, smug: 0.05 }),
  });
}

/** thorny lizard enemy (~1.3 m). variant 0-2 = camouflage morphs */
export const thornyLizardRig = memo((o: LizardOpts = {}): RigSpec => {
  if (o?.alpha) return lizard({ name: 'thorny_lizard_alpha', vs: 1 / 64, S: 1.35 * 1.6, pal: ALPHA_PAL, alpha: true, boss: false, seed: 41 });
  const v = (((o?.variant ?? 0) % PALS.length) + PALS.length) % PALS.length;
  return lizard({ name: 'thorny_lizard_' + v, vs: 1 / 64, S: 1.6, pal: PALS[v], alpha: false, boss: false, seed: 13 + v * 7 });
});
/** "Old Thornback": ancient ~4 m miniboss with a cactus on its back and a bone crown */
export const thornbackRig = memo((_: void): RigSpec => lizard({ name: 'thorny_lizard_boss', vs: 1 / 32, S: 1.55 * 1.6, pal: BOSS_PAL, alpha: true, boss: true, seed: 77 }));

void VF;
void mulc;
void exposed;
void VoxelModel;
