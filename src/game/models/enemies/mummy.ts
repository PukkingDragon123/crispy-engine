// Cursed Mummy: a hulking tank, built on Sundown's skeleton figure
// (characters/skeleton.ts, 1/36) and swaddled in thick diagonal burial bandages:
// layered strips with seams, stains, torn gaps showing dried flesh and loose
// frayed ends, deep eye sockets in the wrapped skull with dim cursed embers, a
// broad usekh collar of gold, lapis, turquoise and carnelian beads, a red heart
// jewel (the weak point, `heart` socket), a bandage kilt with a gold belt and a
// lapis apron. v1: a loose strip over one eye; v2: a gold headband with a cobra.
// Alpha: a gold face mask with kohl, a Set-red sash and spiked gold pauldrons.
// (wrapBands below is the legacy toon helper still used elsewhere.)
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { toonSkull, toonPelvis, boneUpperArm, boneForearm, boneThigh, boneShin, buildHumanoid, defaultExpressions, sleeve, toonHand, JOINT } from '../toon/humanoid';
import { EnemyOpts, roundBox, roundBoxX, autoShade, mirrored, pickV } from './human';
import type { HumanoidParts } from '../toon/humanoid';
import { Fig, finish, figMeta, sections, limbG, lineG, cutG, wrapShell, frayStrip, clothC, ell, hornG, isSurf, mix, mulRGB, hash3, noise, CSpec, ColorFn, G } from './figure/fig';
import { emberEyes, METAL, frontZ } from './figure/gear';


const WRAP: Ramp[] = [
  TOON.bandage,
  { base: 0xdacb9e, shade: 0xb8a77c, hi: 0xeee2bc, dark: 0x8a7a54 },
  { base: 0xd2c8b4, shade: 0xaea48e, hi: 0xe8e0ce, dark: 0x847a66 },
];

/** repaint every voxel of colour `base` with diagonal wrap bands */
export function wrapBands(m: VoxelModel, R: Ramp, period = 4) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (c !== R.base) return;
    const b = (((y * 2 + x + (z >> 1)) % period) + period) % period;
    if (b === 0) hits.push([x, y, z, f]);
  });
  for (const [x, y, z, f] of hits) m.set(x, y, z, R.shade, f || VF.SOLID);
  return m;
}

const WRAP_C = [0xd8ccaa, 0xcfc29c, 0xd2c8b2];
const FLESH = 0x3a2416;

/** burial bandage: slanted strips with dark seams, alternating tones and old stains */
export function wrapC(base: number, seed = 0, slope = 0.45): ColorFn {
  return (x, y, z) => {
    const t = y + slope * x + 0.22 * z + noise.n3(x / 6, y / 6, z / 6 + seed) * 0.9;
    const idx = Math.floor(t / 2.2);
    const ph = t - idx * 2.2;
    if (ph < 0.42) return mix(base, 0x4a3a26, 0.42); // seam between strips
    const h = hash3(idx, seed, 3);
    let c = h < 0.33 ? mulRGB(base, 0.93) : h > 0.75 ? mix(base, 0xfff6e0, 0.18) : base;
    const st = noise.n3(x / 4 + seed, y / 5, z / 4 - seed);
    if (st < -0.45) c = mix(c, 0x8a6a40, 0.3); // old stains
    return c;
  };
}

const MUMMY_TORSO: Record<number, [number, number, number]> = {
  28: [5.6, 2.6, -5.9], 29: [5.8, 2.8, -6.0], 30: [6.0, 3.0, -6.0], 31: [6.3, 3.2, -6.1], 32: [6.6, 3.5, -6.1], 33: [6.9, 3.8, -6.2],
  34: [7.2, 4.1, -6.2], 35: [7.4, 4.3, -6.3], 36: [7.6, 4.5, -6.3], 37: [7.8, 4.7, -6.3], 38: [7.9, 4.8, -6.4], 39: [8.0, 4.9, -6.4],
  40: [8.1, 4.9, -6.4], 41: [8.1, 4.8, -6.3], 42: [8.0, 4.5, -6.2], 43: [7.6, 3.8, -6.0], 44: [6.2, 2.4, -5.2], 45: [4.0, 1.4, -4.6],
  46: [3.2, 1.2, -4.4], 47: [3.0, 1.0, -4.3],
};
const MUMMY_PELVIS: Record<number, [number, number, number]> = {
  20: [5.4, 2.2, -5.0], 21: [6.0, 2.6, -5.6], 22: [6.6, 2.9, -6.1], 23: [7.0, 3.0, -6.4], 24: [7.2, 3.1, -6.6], 25: [7.2, 3.1, -6.5],
  26: [7.1, 3.0, -6.3], 27: [6.8, 2.8, -6.1], 28: [6.2, 2.6, -6.0], 29: [5.8, 2.6, -5.9],
};

export function mummyRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const seed = 5 + v * 7 + (alpha ? 3 : 0);
  const F = new Fig();
  const base = alpha ? 0xc4b48e : WRAP_C[v];
  const W = wrapC(base, seed);
  const Wd = wrapC(mulRGB(base, 0.9), seed + 1, -0.5);
  const G = METAL.gold, LAP = 0x2a4a9a, TURQ = 0x2e9a8a, CARN = 0xa8321e;
  // ---------------------------------------------------------------- body volumes over the bones
  const tr = F.s('torso');
  tr.m.map.clear();
  sections(tr, 28, 47, (y) => {
    const r = MUMMY_TORSO[Math.floor(y)];
    return r ? { a: r[0], f: r[1], b: r[2], p: 2.3 } : null;
  }, W);
  const pv = F.s('pelvis');
  pv.m.map.clear();
  sections(pv, 20, 29, (y) => {
    const r = MUMMY_PELVIS[Math.floor(y)];
    return r ? { a: r[0], f: r[1], b: r[2], p: 2.4 } : null;
  }, Wd);
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    if (s1 < 0) {
      F.boneMirror('arm_l', 'arm_r');
      F.boneMirror('fore_l', 'fore_r');
      F.boneMirror('thigh_l', 'thigh_r');
      F.boneMirror('shin_l', 'shin_r');
    }
    const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
    a.m.map.clear();
    ell(a, [X(8.6), 41.3, 0.0], [2.6, 2.7, 2.6], W);
    limbG(a, [X(8.6), 40.0, 0.0], [X(8.5), 34.4, 0.1], (t) => 2.35 - 0.3 * t, W);
    ell(a, [X(8.5), 33.9, -0.1], [2.25, 1.3, 2.0], W);
    const f = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
    f.m.map.clear();
    ell(f, [X(8.5), 31.9, -0.3], [2.2, 1.3, 2.0], W);
    limbG(f, [X(8.6), 31.6, -0.1], [X(8.9), 26.0, 0.1], (t) => 2.15 - 0.45 * t, W);
    // wrapped hand: palm and the fingers bound together, slightly curled
    ell(f, [X(9.0), 23.2, 0.1], [2.2, 2.4, 2.1], Wd);
    ell(f, [X(9.0), 20.0, 0.9], [2.0, 1.7, 1.6], Wd);
    for (const x of [8, 9, 10]) lineG(f, [[X(x + 0.0), 21.5, 2.4], [X(x + 0.0), 18.8, 2.2]], mix(base, 0x4a3a26, 0.35));
    ell(f, [X(6.8), 22.6, 1.4], [0.9, 1.6, 0.9], Wd); // thumb
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    th.m.map.clear();
    limbG(th, [X(3.8), 23.4, 0.1], [X(3.6), 16.8, 0.3], (t) => 2.85 - 0.5 * t, W);
    ell(th, [X(3.6), 16.6, 0.4], [2.3, 1.5, 2.2], W);
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    sh.m.map.clear();
    ell(sh, [X(3.6), 14.6, 0.3], [2.25, 1.4, 2.1], W);
    limbG(sh, [X(3.6), 13.8, -0.2], [X(3.7), 3.6, -0.2], (t) => 2.25 - 0.45 * t, W);
    ell(sh, [X(3.8), 1.6, -1.5], [2.1, 1.6, 1.8], Wd); // heel
    ell(sh, [X(3.9), 1.2, 1.9], [2.15, 1.25, 3.2], Wd); // wrapped foot
    cutG(sh, (x, y) => y < 0);
  }
  // ---------------------------------------------------------------- the wrapped skull: one layer of bandage over the bone, sockets left open
  const hd = F.s('head');
  const eyeHole = (x: number, y: number, z: number) => z > 1 && y > 51.5 && y < 56.5 && ((x > 0.6 && x < 5.2) || (x < -0.6 && x > -5.2));
  wrapShell(hd, 47, 62, wrapC(base, seed + 2, -0.6), (x, y, z) => !eyeHole(x, y, z));
  for (let x = -6; x <= 5; x++) for (let z = -7; z <= 5; z++) {
    let topY = -1;
    for (let y = 63; y >= 58; y--) if (hd.m.has(x, y, z)) {
      topY = y;
      break;
    }
    if (topY >= 60) hd.m.set(x, topY + 1, z, res(W, x, topY + 1, z));
  }
  // fill the grin and the nose notch: the face is wrapped shut
  for (let x = -5; x <= 4; x++) for (let y = 47; y <= 51; y++) for (let z = 3; z <= 6; z++) if (!hd.m.has(x, y, z) && !eyeHole(x + 0.5, y + 0.5, z + 0.5) && z <= 6 && (z < 6 || Math.abs(x + 0.5) < 5)) hd.m.set(x, y, z, res(Wd, x, y, z));
  // socket rims: dark recesses
  hd.m.forEach((x, y, z) => {
    if (eyeHole(x + 0.5, y + 0.5, z + 0.5 + 1) && z <= 4 && z >= 1) hd.m.set(x, y, z, FLESH);
  });
  const jw = F.s('jaw');
  wrapShell(jw, 43, 48, Wd);
  for (let x = -5; x <= 4; x++) for (let y = 44; y <= 46; y++) jw.m.set(x, y, 6, res(Wd, x, y, 6));
  // cursed embers deep in the sockets
  emberEyes(F, alpha ? 0xff3a10 : 0xd84a1a, { orb: 0x241008 });
  for (const n of ['brow_l', 'brow_r']) {
    const b = F.s(n);
    const pts: G[] = [];
    b.m.forEach((x, y, z) => pts.push([x, y, z]));
    for (const [x, y, z] of pts) b.m.set(x, y, z, res(W, x, y, z)).set(x, y, z + 1, mulRGB(res(W, x, y, z + 1), 0.95));
  }
  // ---------------------------------------------------------------- kilt, gold belt, lapis apron (front panels ride the thighs)
  wrapShell(pv, 20, 27, clothC(0xe8dcc0, seed, { fold: 2, crease: 0xb8a882 }));
  for (let x = -9; x < 9; x++) for (let z = -9; z <= 6; z++) {
    const q = MUMMY_PELVIS[27];
    const zc = (q[1] + q[2]) / 2, zr = (q[1] - q[2]) / 2 + 1.1;
    const d = (Math.abs(x + 0.5) / (q[0] + 1.1)) ** 3 + (Math.abs(z + 0.5 - zc) / zr) ** 3;
    if (d <= 1 && d > 0.55) for (const y of [27, 28]) pv.m.set(x, y, z, y === 28 ? G[0] : G[1], VF.METAL);
  }
  for (const [x, c] of [[-1, LAP], [0, LAP], [-4, TURQ], [3, TURQ], [5, CARN], [-6, CARN]] as [number, number][]) pv.m.set(x, 27, frontZ(pv.m, x, 27), c);
  for (const s1 of [1, -1]) {
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    for (let y = 15; y <= 23; y++) for (const x of s1 > 0 ? [0, 1] : [-2, -1]) th.m.set(x, y, 4, y & 1 ? LAP : G[0], y & 1 ? VF.SOLID : VF.METAL);
    th.m.set(s1 > 0 ? 0 : -1, 14, 4, G[1], VF.METAL);
  }
  // ---------------------------------------------------------------- usekh collar over the shoulders, heart jewel
  const ring = [G[0], LAP, G[2], TURQ, G[0], CARN];
  const collar: [number, number, number, number][] = [];
  tr.m.forEach((x, y, z) => {
    if (y < 39 || y > 45) return;
    const gx = x + 0.5, gz = z + 0.5;
    const r = Math.hypot(gx * 0.9, (gz + 1.2) * 1.1) + (45 - y) * 0.85;
    if (r > 11.5) return;
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]] as [number, number, number][]) {
      if (tr.m.has(x + dx, y + dy, z + dz)) continue;
      const k = Math.floor(r / 1.6);
      collar.push([x + dx, y + dy, z + dz, ring[((k % ring.length) + ring.length) % ring.length]]);
    }
  });
  for (const [x, y, z, c] of collar) tr.m.set(x, y, z, c, c === G[0] || c === G[2] ? VF.METAL : VF.SOLID);
  for (let x = -6; x <= 5; x += 2) {
    const z = frontZ(tr.m, x, 39);
    tr.m.set(x, 38, z, G[0], VF.METAL);
  }
  const hz = frontZ(tr.m, 0, 35) + 1;
  for (const [x, y, c] of [[-1, 36, CARN], [0, 36, CARN], [-1, 35, 0x8a2414], [0, 35, 0x8a2414], [-1, 34, 0x6a1a10], [-2, 36, G[0]], [1, 36, G[0]], [-1, 37, G[0]], [0, 37, G[0]]] as [number, number, number][]) tr.m.set(x, y, hz, c, c === G[0] ? VF.METAL : VF.SOLID);
  tr.m.set(0, 36, hz + 1, 0xff6a4a, VF.EMISSIVE);
  F.sock('heart', 'torso', [0, 35.5, hz + 1]);
  // ---------------------------------------------------------------- torn gaps (dried flesh) and loose frayed ends
  for (const [part, c] of [['torso', [-5.5, 31.5, 2.5]], ['thigh_r', [-5.6, 19.5, 0.5]], ['arm_l', [10.6, 37.5, 0.5]]] as [string, G][]) {
    const s = F.s(part);
    ell(s, c, [1.1, 1.3, 1.1], FLESH);
  }
  const loose = clothC(mulRGB(base, 0.95), seed + 4, { fold: 2 });
  frayStrip(F.s('fore_l'), 10, 10, -1, 27, 4, 7, loose, seed + 5);
  frayStrip(F.s('thigh_r'), -6, -6, -1, 19, 3, 6, loose, seed + 6);
  frayStrip(hd, -2, 1, -9, 55, 5, 10, loose, seed + 7);
  // ---------------------------------------------------------------- variant marks
  if (alpha) {
    // gold face mask with kohl-lined eyes
    for (let x = -6; x <= 5; x++)
      for (let y = 46; y <= 58; y++) {
        const gx = x + 0.5;
        if (Math.abs(gx) > 6 - Math.max(0, 48 - y) * 1.2) continue;
        if (eyeHole(gx, y + 0.5, 6.5)) continue;
        const z = frontZ(hd.m, x, y) + (hd.m.has(x, y, 7) ? 0 : 1);
        const kohl = (y === 56 || y === 51) && Math.abs(gx) > 0.6 && Math.abs(gx) < 6;
        hd.m.set(x, y, z, kohl ? 0x1a1414 : (y === 50 && Math.abs(gx) < 1.2) ? G[1] : G[(x + y) % 5 === 0 ? 2 : 0], kohl ? VF.SOLID : VF.METAL);
      }
    for (const s1 of [1, -1]) {
      const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
      ell(a, [s1 * 9.0, 43.0, 0.0], [3.0, 1.5, 2.9], G[1], { fl: VF.METAL });
      ell(a, [s1 * 9.0, 43.6, 0.0], [2.6, 1.0, 2.5], G[0], { fl: VF.METAL });
      for (const dz of [-1.6, 0.4, 2.0]) hornG(a, [s1 * 10.0, 44.0, dz], [s1 * 0.5, 1, 0], 3.2, 0.8, G[2]);
    }
    for (let y = 29; y <= 43; y++) {
      const x = Math.round(-6 + (y - 29) * 0.9);
      for (const dx of [0, 1, 2]) {
        const X = x + dx;
        tr.m.set(X, y, frontZ(tr.m, X, y) + (dx === 1 ? 1 : 0), dx === 1 ? 0x8a1e16 : 0x6e1812);
      }
    }
  } else if (v === 1) {
    // a loose strip across the right eye
    for (let y = 51; y <= 57; y++) {
      const x = -6 + (57 - y) * 0.8;
      for (const dx of [0, 1]) hd.m.set(Math.floor(x) + dx, y, 7, mix(base, 0xfff6e0, 0.12));
    }
    lineG(hd, [[-6.5, 51.0, 7.0], [-7.4, 47.5, 6.4], [-7.0, 44.5, 5.8]], mix(base, 0xfff6e0, 0.1));
  } else if (v === 2) {
    // gold headband with a rearing cobra
    hd.m.forEach((x, y, z) => {
      if (y === 58 && isSurf(hd.m, x, y, z) && z > -9) hd.m.set(x, y, z, G[0], VF.METAL);
    });
    for (const [x, y, z, c] of [[-1, 59, 7, 0], [0, 59, 7, 0], [-1, 60, 7, 2], [0, 60, 7, 0], [-1, 61, 8, 0], [0, 61, 8, 2], [-1, 62, 8, 1], [0, 62, 8, 1]] as number[][]) hd.m.set(x, y, z, G[c], VF.METAL);
    hd.m.set(-1, 61, 9, CARN).set(0, 61, 9, CARN);
  }
  finish(F);
  let top = 63;
  hd.m.forEach((_x, y) => (top = Math.max(top, y + 1)));
  return F.build(`mummy${alpha ? '_alpha' : ''}_v${v}`, figMeta(F, 'mummy', {
    alpha,
    variant: v,
    height: top * F.vs,
    radius: 0.36,
    armor: true,
    weakPoint: 'heart',
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'dead', 'stunned']),
  }));
}
const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : (c(x, y, z) as number));
void toonSkull;
void toonPelvis;
void boneUpperArm;
void boneForearm;
void boneThigh;
void boneShin;
void buildHumanoid;
void sleeve;
void toonHand;
void JOINT;
void roundBox;
void roundBoxX;
void autoShade;
void mirrored;
void pickV;
void TOON;
