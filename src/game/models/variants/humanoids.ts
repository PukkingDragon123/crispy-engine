// Humanoid enemy variants, all built on Sundown's skeleton figure
// (characters/skeleton.ts via enemies/figure/*: 1/36 grid, Sundown's part names,
// joints and proportions, so the shared procedural animation fits every one).
// Husk variants reuse the dried-flesh husk body, the archer reuses the jackal body,
// the whipper the mummy body; the rest are weathered outlaw skeletons in clothes.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import type { VariantOpts } from './kit';
import { defaultExpressions } from '../toon/humanoid';
import {
  Fig, G, Sc, VoxelModel, VF, mix, mulRGB, hash3, noise, ell, cap, tube, sections, limbG, lineG, coatG, cutG, isSurf, wrapShell, frayStrip,
  clothC, leatherC, tones, hornG, finish, figMeta, CSpec,
} from '../enemies/figure/fig';
import {
  ageBones, emberEyes, hatG, addHat, maskBandana, neckerchief, vestG, shirtG, dusterG, sleeveG, bandolierG, gunBeltG, bootG, revolverG, boardG,
  frontZ, METAL,
} from '../enemies/figure/gear';
import { driedBody, driedHead, driedEyes } from '../enemies/figure/flesh';
import { ropeBelt } from '../enemies/real/husk';
import { jackalBody } from '../enemies/jackal';
import { mummyBody } from '../enemies/mummy';
import { liftSpec } from '../enemies/human';

const EXPR = defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead', 'stunned', 'happy']);
const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : (c(x, y, z) as number));
const SPARK = [0xfff2a0, 0xffc040, 0xff7a20];
const CACTUS = [0x5e9440, 0x4a7a34, 0x7aae52];
const DUNG = 0x6a4a2a;
const BH = 2;

function done(F: Fig, name: string, kind: string, o: { alpha: boolean; top: number; radius?: number; meta?: Record<string, unknown> }) {
  finish(F);
  return F.build(name, figMeta(F, kind, { alpha: o.alpha, height: o.top * F.vs, radius: o.radius ?? 0.3, expressions: EXPR, ...(o.meta ?? {}) }));
}
function headTop(F: Fig, min = 63) {
  let top = min;
  for (const n of ['head', 'hat']) if (F.has(n)) F.m(n).forEach((_x, y) => (top = Math.max(top, y + 1)));
  return top;
}
/** a garment layer one voxel out from the existing body between rows y0..y1 */
function garment(s: Sc, y0: number, y1: number, col: CSpec, pred: (x: number, y: number, z: number) => boolean = () => true) {
  wrapShell(s, y0, y1, col, pred);
}
/** loose trousers around the figure's leg bones (pelvis block + thigh/shin tubes); bottom = hem row */
function trousersG(F: Fig, col: CSpec, o: { bottom?: number; flare?: number; skip?: boolean } = {}) {
  const pv = F.s('pelvis');
  sections(pv, 20, 28, (y) => ({ a: y < 22 ? 6.2 : 7.0, f: 2.8, b: -6.0, p: 2.6 }), col);
  const bottom = o.bottom ?? 10;
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    limbG(th, [X(3.8), 23.6, 0.1], [X(3.6), 16.2, 0.3], (t) => 2.5 - 0.3 * t, col);
    ell(th, [X(3.6), 16.4, 0.4], [2.25, 1.4, 2.1], col);
    if (bottom < 15) {
      const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
      limbG(sh, [X(3.6), 15.2, 0.2], [X(3.7), bottom + 0.5, -0.1], (t) => 2.2 + (o.flare ?? 0) * t * t, col);
    }
  }
}
/** a short twisted cord with a spark at the tip (fuse) */
function sparkAt(s: Sc, p: G) {
  const [x, y, z] = p.map(Math.floor) as G;
  s.m.set(x, y, z, SPARK[0], VF.EMISSIVE).set(x, y + 1, z, SPARK[1], VF.EMISSIVE).set(x + 1, y, z, SPARK[2], VF.EMISSIVE).set(x - 1, y + 1, z, SPARK[1], VF.EMISSIVE).set(x, y, z + 1, SPARK[2], VF.EMISSIVE);
}

// ============================================================================ BOMBER HUSK
export function bomberHuskRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  const K = driedBody(F, { skin: a ? 0x5a4a3c : 0x8a6a4a, seed: a ? 41 : 37, noWound: true });
  driedHead(F, K, { seed: 37, patch: 'none', paint: a });
  driedEyes(F, { ember: a });
  // ragged undershirt, open at the front so the ribs show
  const tr = F.s('torso');
  const shirt = clothC(0xd2c6a6, 3, { fold: 3, stain: 0x9a8a62 });
  const open = (x: number, y: number, z: number) => !(Math.abs(x) < 2.6 && z > 1);
  garment(tr, 32, 43, shirt, open);
  garment(tr, 31, 31, shirt, (x, y, z) => open(x, y, z) && hash3(Math.floor(x), Math.floor(z), 3) < 0.6); // tattered hem
  // dynamite bundle strapped to the chest
  const n = a ? 6 : 5;
  const zf = Math.max(...[-3, -2, -1, 0, 1, 2].map((x) => frontZ(tr.m, x, 36))) + 1;
  for (let i = 0; i < n; i++) {
    const x = -Math.floor(n / 2) + i;
    for (let y = 33; y <= 40; y++) tr.m.set(x, y, zf, y === 40 ? 0xe8b0a0 : i & 1 ? 0xb83226 : 0xd03c2c).set(x, y, zf + 1, y === 40 ? 0xe8b0a0 : i & 1 ? 0xa82a20 : 0xc03428);
  }
  for (const y of [34, 38]) for (let x = -Math.floor(n / 2) - 1; x <= n - Math.floor(n / 2); x++) for (const z of [zf, zf + 1, zf + 2]) if (tr.m.has(x, y, z) || z === zf + 2) tr.m.set(x, y, z, 0x3a3230);
  tr.m.set(0, 36, zf + 2, 0xe8dcc0).set(-1, 36, zf + 2, 0xe8dcc0); // label
  // strap over the left shoulder
  for (let y = 34; y <= 44; y++) tr.m.set(4, y, frontZ(tr.m, 4, y) + 1, 0x4a2c18);
  for (let z = -7; z <= 3; z++) {
    let t = 47;
    while (t > 40 && !tr.m.has(4, t, z)) t--;
    if (t > 40) tr.m.set(4, t + 1, z, 0x4a2c18);
  }
  // denim shorts with a rope belt and a linen patch
  const denim = clothC(0x4a6688, 5, { fold: 3, crease: 0x34486a, stain: 0x6a7a8a });
  garment(F.s('pelvis'), 20, 27, denim);
  for (const s1 of [1, -1]) {
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    garment(th, 18, 24, denim);
    garment(th, 17, 17, denim, (x, y, z) => hash3(Math.floor(x), Math.floor(z), 9) < 0.55);
  }
  for (let y = 19; y <= 21; y++) for (let x = 3; x <= 4; x++) F.m('thigh_l').set(x, y, frontZ(F.m('thigh_l'), x, y), 0xd8c8a0);
  ropeBelt(F, 37, { pouch: false, charm: false, y: 27.6 });
  // miner's helmet with a brass lamp
  const top = addHat(F, minerHelmet(a ? 0xb83a2a : 0xe0a830, a));
  // the fuse: from the bundle up over the left collarbone, spark at the tip
  const fz = zf + 1;
  const fuse = F.part('fuse', 'torso', [0.5, 40.5, fz + 0.5]);
  const pts: G[] = [[0.5, 40.5, fz + 0.5], [2.5, 42.0, fz + 0.8], [4.5, 43.6, fz - 0.5], [6.8, 44.6, 2.0], [8.6, 45.8, 0.6], [9.4, 47.6, 0.2]];
  lineG(fuse, pts, (t) => (t > 0.9 ? 0x2a2018 : (Math.floor(t * 14) & 1 ? 0xc9a46a : 0xa07e4a)));
  sparkAt(fuse, [9.4, 48.6, 0.2]);
  F.sock('fuse_tip', 'fuse', [9.4, 49, 0.7]);
  if (a) {
    // a TNT keg on the back
    const keg = (x: number, y: number, z: number) => ((Math.atan2(z + 9.5, x + 0.5) * 6) & 1 ? 0xa06a3a : 0x8a5a30);
    for (let y = 30; y <= 44; y++) {
      const r = 5.2 - ((y - 37) / 7) ** 2 * 0.9;
      for (let x = -6; x < 6; x++) for (let z = -16; z <= -6; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5 + 10.5);
        if (d > r || d < r - 1.4) continue;
        const hoop = y === 31 || y === 37 || y === 43;
        tr.m.set(x, y, z, hoop ? METAL.iron[0] : keg(x, y, z), hoop ? VF.METAL : VF.SOLID);
      }
    }
    for (let x = -2; x <= 1; x++) for (let y = 35; y <= 39; y++) tr.m.set(x, y, -16, y === 37 ? 0xe8dcc0 : 0xb82a20);
    for (const sx of [1, -1]) hornG(F.s('hat'), [sx * 7, 61, -1], [sx * 0.8, 0.7, -0.2], 6, 1.2, 0xe2d2b0, [0, 0.5, -0.4]);
  }
  return done(F, a ? 'bomber_husk_alpha' : 'bomber_husk', 'bomber_husk', { alpha: a, top: a ? top + 6 : top, radius: 0.32 });
}

function minerHelmet(col: number, alpha: boolean) {
  const m = new VoxelModel('hat');
  const s = new Sc(m, 1);
  const C = tones(mulRGB(col, 0.86), col, mix(col, 0xffffff, 0.12), 4, alpha ? 3 : 1);
  for (let y = 56; y <= 65; y++) {
    const t = Math.max(0, (y - 59) / 6.2);
    const k = Math.sqrt(Math.max(0, 1 - t * t));
    const hx = 7.4 * k + 0.3, zf = -1 + 7.6 * k + 0.4, zb = -1 - 7.9 * k - 0.4;
    for (let x = -9; x < 9; x++) for (let z = -10; z <= 8; z++) {
      const u = Math.abs(x + 0.5) / hx, v = Math.abs(z + 0.5 - (zf + zb) / 2) / ((zf - zb) / 2);
      if (u ** 2.1 + v ** 2.1 > 1) continue;
      m.set(x, y, z, y === 56 ? mulRGB(col, 0.78) : res(C, x, y, z));
    }
  }
  // brim lip + visor, centre ridge, brass lamp with a lit lens
  for (let x = -9; x < 9; x++) for (let z = -11; z <= 10; z++) {
    const e = ((x + 0.5) / 8.6) ** 2 + ((z + 0.5 + 0.5) / (z > 0 ? 10.2 : 9.2)) ** 2;
    if (e <= 1 && e > 0.62) m.set(x, 56, z, mulRGB(col, 0.82));
  }
  for (let z = -7; z <= 5; z++) for (const x of [-1, 0]) {
    let t = 66;
    while (t > 56 && !m.has(x, t, z)) t--;
    m.set(x, t + 1, z, mix(col, 0xffffff, 0.2));
  }
  s.rbox([-2.2, 58, 6.6], [2.2, 62, 8.6], 0.8, METAL.brass[0], VF.METAL);
  for (let x = -1; x <= 0; x++) for (let y = 59; y <= 60; y++) m.set(x, y, 8, 0xfff3c0, VF.EMISSIVE);
  return { model: m, top: 67 };
}

// ============================================================================ CACTUS HUSK
function cactusC(seed = 0): (x: number, y: number, z: number) => number {
  return (x, y, z) => ((x + z) & 1 ? CACTUS[1] : noise.n3(x / 3, y / 4, z / 3 + seed) > 0.4 ? CACTUS[2] : CACTUS[0]);
}
/** spines + a flower on everything cactus-green in a part */
function cactusSpines(s: Sc, seed: number) {
  const add: [number, number, number][] = [];
  const green = new Set(CACTUS);
  s.m.forEach((x, y, z, c) => {
    if (!green.has(c) || (y + x * 3 + z * 5 + seed) % 5 !== 0) return;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!s.m.has(x + dx, y, z + dz)) {
      add.push([x + dx, y, z + dz]);
      break;
    }
  });
  for (const [x, y, z] of add) s.m.set(x, y, z, 0xf2ead0);
}
function flowerAt(s: Sc, x: number, y: number, z: number, petal = 0xf06a8a) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s.m.set(x + dx, y, z + dz, petal);
  s.m.set(x, y, z, 0xf2c443).set(x, y + 1, z, 0xffe58a);
}
export function cactusHuskRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  const K = driedBody(F, { skin: a ? 0x5e4a38 : 0x7a5e44, seed: a ? 53 : 51, noWound: true });
  driedHead(F, K, { seed: 51, patch: 'none' });
  driedEyes(F, { ember: a });
  // faded red prospector long-johns, buttoned down the front
  const red = clothC(0xa8503a, 7, { fold: 3, crease: 0x7a3426, stain: 0x8a6048 });
  const tr = F.s('torso');
  garment(tr, 29, 44, red);
  for (let y = 31; y <= 41; y += 3) tr.m.set(-1, y, frontZ(tr.m, -1, y), 0xe8dcc0);
  for (const s1 of [1, -1]) {
    garment(F.s(s1 > 0 ? 'arm_l' : 'arm_r'), 34, 43, red);
    garment(F.s(s1 > 0 ? 'fore_l' : 'fore_r'), 28, 32, red);
  }
  // patched denim trousers, rope belt, bare dried feet
  const denim = clothC(0x4a6688, 9, { fold: 3, crease: 0x34486a, stain: 0x6a7a8a });
  garment(F.s('pelvis'), 20, 27, denim);
  for (const s1 of [1, -1]) {
    garment(F.s(s1 > 0 ? 'thigh_l' : 'thigh_r'), 15, 24, denim);
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    garment(sh, 6, 14, denim);
    garment(sh, 5, 5, denim, (x, y, z) => hash3(Math.floor(x), Math.floor(z), 4) < 0.5);
  }
  for (let y = 18; y <= 20; y++) for (let x = -5; x <= -4; x++) F.m('thigh_r').set(x, y, frontZ(F.m('thigh_r'), x, y), 0xa8503a);
  ropeBelt(F, 51, { charm: false, y: 27.6 });
  // the saguaro that grew out of his back
  const cc = cactusC(a ? 3 : 1);
  const tk = a ? 1.9 : 1.6;
  const zc = -9.6;
  limbG(tr, [0, 30, zc], [0, a ? 70 : 67, zc], () => tk, cc);
  ell(tr, [0, a ? 70 : 67, zc], [tk, 1.4, tk], cc);
  tube(tr, [[1.5, 43, zc], [6, 43.5, zc], [8.5, 46, zc], [9, 55, zc]], () => 1.15, cc);
  ell(tr, [9, 55.2, zc], [1.15, 0.9, 1.15], cc);
  tube(tr, [[-1.5, 37, zc], [-6, 37.5, zc], [-8.2, 40, zc], [-8.6, 47, zc]], () => 1.1, cc);
  ell(tr, [-8.6, 47.2, zc], [1.1, 0.9, 1.1], cc);
  if (a) {
    tube(tr, [[1.5, 33, zc], [5.5, 33.5, zc], [7.0, 36, zc], [7.2, 41, zc]], () => 1.0, cc);
    ell(tr, [7.2, 41.2, zc], [1.0, 0.8, 1.0], cc);
  }
  // prickly-pear pad on the right shoulder
  for (let y = 44; y <= 51; y++) for (let z = -3; z <= 2; z++) if (((y - 47.5) / 3.6) ** 2 + ((z + 0.5) / 2.9) ** 2 <= 1) tr.m.set(-8, y, z, CACTUS[0]).set(-9, y, z, CACTUS[1]);
  cactusSpines(tr, 3);
  flowerAt(tr, 0, a ? 72 : 69, Math.floor(zc));
  flowerAt(tr, 9, 57, Math.floor(zc), 0xf8e070);
  flowerAt(tr, -9, 52, 0);
  if (a) flowerAt(tr, -9, 49, Math.floor(zc));
  // a flower on the skull (he's a romantic) / a cactus crown for the alpha
  const hd = F.s('head');
  flowerAt(hd, 3, 63, 0);
  if (a) {
    for (const [x, z] of [[-3, 0], [2, -3], [-1, 3]] as [number, number][]) limbG(hd, [x + 0.5, 62, z + 0.5], [x + 0.5, 67, z + 0.5], () => 0.9, cc);
    cactusSpines(hd, 5);
  }
  // cactus nubs on the forearms
  for (const s1 of [1, -1]) {
    const f = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
    ell(f, [s1 * 10.8, 29.5, -0.5], [0.9, 1.4, 0.9], cc);
    f.m.set(s1 > 0 ? 11 : -12, 30, 0, 0xf2ead0);
  }
  return done(F, a ? 'cactus_husk_alpha' : 'cactus_husk', 'cactus_husk', { alpha: a, top: a ? 73 : 70, radius: 0.34 });
}

// ============================================================================ DUNG SKELETON
function dungC(seed: number): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    const n = noise.n3(x / 2.4 + seed, y / 2.4, z / 2.4);
    const h = hash3(x, y + seed, z);
    if (h < 0.04) return 0xb8a060; // straw
    return n < -0.3 ? mulRGB(DUNG, 0.78) : n > 0.4 ? mix(DUNG, 0xa07a48, 0.4) : DUNG;
  };
}
function dungBlob(s: Sc, c: G, r: number, seed: number) {
  ell(s, c, [r, r * 0.9, r], dungC(seed));
  for (let k = 0; k < 4; k++) {
    const a = hash3(k, seed, 1) * Math.PI * 2, b = (hash3(k, seed, 2) - 0.5) * 2;
    ell(s, [c[0] + Math.cos(a) * r * 0.7, c[1] + b * r * 0.5, c[2] + Math.sin(a) * r * 0.7], [r * 0.45, r * 0.4, r * 0.45], dungC(seed + k));
  }
}
export function dungSkeletonRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const ballHead = (o.variant ?? 0) === 1;
  const F = new Fig();
  ageBones(F, { seed: 19, tint: 0x9a7a4a, amt: 0.3, grime: 0x5a4024 });
  emberEyes(F, 0xc8e040);
  // dung "boots" caked on the feet and lower shins
  for (const s1 of [1, -1]) {
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    dungBlob(sh, [s1 * 3.9, 1.6, 0.8], 2.6, s1 > 0 ? 3 : 4);
    ell(sh, [s1 * 3.6, 5.5, -0.2], [2.1, 2.4, 2.0], dungC(5));
    cutG(sh, (x, y) => y < 0);
  }
  // the dung diaper: lumps around the hips
  const pv = F.s('pelvis');
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    dungBlob(pv, [Math.sin(t) * 5.6, 23.5 + (i & 1), Math.cos(t) * 4.2 - 1.5], 2.6, i);
  }
  // a smear across the ribs
  const tr = F.s('torso');
  coatG(tr, (x, y, z) => x > 1.5 && x < 6.5 && y > 33 && y < 38 && z > 0, dungC(7), undefined, false);
  dungBlob(tr, [4.2, 34.6, 3.2], 1.2, 8);
  const hd = F.s('head');
  if (ballHead) {
    // his head IS a dung ball, sockets and a grin pressed into it
    hd.m.map.clear();
    dungBlob(hd, [0, 55.5, -1], 7.8, 21);
    for (const s1 of [1, -1]) for (let i = 1; i <= 4; i++) for (let y = 52; y <= 55; y++) {
      const x = s1 > 0 ? i : -1 - i;
      for (let z = 2; z <= 9; z++) hd.m.del(x, y, z);
      hd.m.set(x, y, 1, 0x1a1008);
    }
    for (let x = -4; x <= 3; x++) {
      const z = frontZ(hd.m, x, 48);
      hd.m.set(x, 48, z, (x & 1) ? 0xd8c49c : 0xeadcb8);
      hd.m.set(x, 47, z - 1, 0x1a1008);
    }
    F.remove('brow_l');
    F.remove('brow_r');
  } else {
    // a splat on the skull top with a drip down the side
    dungBlob(hd, [1, 62.5, -1], 3.2, 31);
    dungBlob(hd, [-2.5, 62.2, 1.5], 2.2, 32);
    for (let y = 56; y <= 61; y++) hd.m.set(6, y, 0, dungC(33)(6, y, 0));
    hd.m.set(6, 55, 0, mulRGB(DUNG, 0.8));
    // clothespin on the nose
    for (const x of [-2, 1]) for (let y = 49; y <= 53; y++) hd.m.set(x, y, 6, 0xd8b878);
    hd.m.set(-1, 51, 6, METAL.silver[0], VF.METAL).set(0, 51, 6, METAL.silver[0], VF.METAL).set(-1, 51, 7, METAL.silver[2], VF.METAL);
  }
  if (a) {
    // King Dung: a little gold crown and dung pauldrons
    const cr = new VoxelModel('hat');
    for (let x = -6; x <= 5; x++) for (let z = -7; z <= 5; z++) if (x === -6 || x === 5 || z === -7 || z === 5) cr.set(x, 63, z, METAL.gold[0], VF.METAL).set(x, 64, z, METAL.gold[2], VF.METAL);
    for (const [x, z] of [[-6, 5], [-1, 5], [0, 5], [5, 5], [-6, -7], [5, -7], [-1, -7], [5, -1], [-6, -1]] as [number, number][]) cr.set(x, 65, z, METAL.gold[2], VF.METAL);
    cr.set(-1, 64, 6, 0xb8322a).set(0, 64, 6, 0xb8322a);
    addHat(F, { model: cr, top: 66 });
    for (const s1 of [1, -1]) dungBlob(tr, [s1 * 7.2, 44.0, -0.5], 2.6, s1 > 0 ? 41 : 42);
  }
  // the flies buzzing round his head: dark bodies, glassy wings
  const fl = F.part('flies', 'head', [...F.J.neck] as V3);
  const spots: G[] = a ? [[11, 60, 3], [-12, 57, -2], [7, 67, -4], [-7, 66, 5], [13, 54, -1], [-10, 64, -6], [3, 70, 2]] : [[11, 60, 3], [-12, 57, -2], [7, 66, -4], [-7, 65, 5], [13, 54, -1]];
  for (const [x, y, z] of spots) fl.m.set(x, y, z, 0x141012).set(x + 1, y, z, 0x2a3a2a).set(x - 1, y + 1, z, 0xc8d8e8).set(x + 1, y + 1, z, 0xc8d8e8);
  // the ammunition, in the right fist
  const bl = F.part('ball', 'fore_r', F.J.hand_r);
  dungBlob(bl, [-9, 17.0, 1.5], a ? 4.4 : 3.6, 51);
  const name = ballHead ? 'dung_skeleton_ballhead' : a ? 'dung_skeleton_alpha' : 'dung_skeleton';
  return done(F, name, 'dung_skeleton', { alpha: a, top: headTop(F), radius: 0.3 });
}

// ============================================================================ MARIACHI
function sombrero(felt: number, trim: number, r = 18) {
  const m = new VoxelModel('hat');
  const C = tones(mulRGB(felt, 0.88), felt, mix(felt, 0xffffff, 0.08), 4, 2);
  for (let x = -r - 1; x <= r; x++)
    for (let z = -r - 2; z <= r; z++) {
      const d = Math.hypot(x + 0.5, z + 0.5 + 1);
      if (d > r + 0.3) continue;
      const y = d > r - 1.6 ? 62 : d > r - 3.4 ? 61 : d > r - 5.6 ? 60 : 59;
      m.set(x, y, z, d > r - 1.6 ? trim : res(C, x, y, z));
      for (let yy = 59; yy < y; yy++) if (d > r - 5.6) m.set(x, yy, z, mulRGB(felt, 0.84));
    }
  for (let y = 60; y <= 74; y++) {
    const rr = y <= 62 ? 8.4 : Math.max(2.2, 8.4 - (y - 62) * 0.55);
    for (let x = -9; x < 9; x++) for (let z = -10; z <= 8; z++) if (Math.hypot(x + 0.5, z + 0.5 + 1) <= rr) m.set(x, y, z, y >= 73 ? mix(felt, 0xffffff, 0.1) : res(C, x, y, z));
  }
  m.forEach((x, y, z) => {
    if ((y === 61 || y === 62) && Math.hypot(x + 0.5, z + 1.5) > 7 && Math.hypot(x + 0.5, z + 1.5) < 9.2) m.set(x, y, z, y === 62 && ((x + z) & 1) ? 0xb8322a : trim, VF.METAL);
  });
  for (let k = 0; k < 14; k++) {
    const t = (k / 14) * Math.PI * 2;
    const x = Math.floor(Math.sin(t) * 7.3), z = Math.floor(Math.cos(t) * 7.3 - 1);
    if (m.has(x, 65, z)) m.set(x, 65, z, trim, VF.METAL);
  }
  return { model: m, top: 75 };
}
export function mariachiRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  F.boneMirror('fore_l', 'fore_r'); // open right hand strums, the left frets
  ageBones(F, { seed: 23 });
  emberEyes(F, 0xffa040);
  const trim = a ? METAL.gold : METAL.silver;
  const black = clothC(0x262430, 4, { fold: 3, crease: 0x16141c, stain: 0x34303e });
  // white shirt, short black bolero over it with studded edges, red bow tie
  shirtG(F, 0xf0e8d8, 4);
  const tr = F.s('torso');
  for (let y = 36; y <= 44; y++)
    for (let x = -9; x < 9; x++)
      for (let z = -9; z <= 7; z++) {
        const gx = x + 0.5, gz = z + 0.5, aa = y >= 42 ? 8.6 - (y - 42) * 1.3 : 8.4, f = 5.3, b = -7.6;
        const zc = (f + b) / 2, zr = (f - b) / 2;
        const out = (Math.abs(gx) / aa) ** 2.6 + (Math.abs(gz - zc) / zr) ** 2.6 <= 1;
        const inn = (Math.abs(gx) / (aa - 1.05)) ** 2.6 + (Math.abs(gz - zc) / (zr - 1.05)) ** 2.6 <= 1;
        if (!out || (inn && y < 44) || (gz > 1 && Math.abs(gx) < 3.6) || (y === 44 && Math.abs(gx) < 3.2)) continue;
        tr.m.set(x, y, z, res(black, x, y, z));
      }
  for (let y = 36; y <= 43; y += 2) for (const x of [3, -4]) tr.m.set(x, y, frontZ(tr.m, x, y), trim[0], VF.METAL);
  for (let x = -8; x <= 7; x += 2) tr.m.set(x, 36, frontZ(tr.m, x, 36), trim[2], VF.METAL);
  for (let x = -3; x <= 2; x++) for (let y = 42; y <= 44; y++) {
    const ax = Math.abs(x + 0.5);
    if (ax < 1 ? y === 43 : Math.abs(y - 43) <= ax * 0.6) tr.m.set(x, y, 5, ax < 1 ? 0x8a2018 : ax > 2 ? 0xd8483a : 0xb8322a);
  }
  if (a) bandolierG(F, 0x3a2414);
  for (const s1 of [1, -1]) {
    sleeveG(F, s1, black, { cuff: 0xf0e8d8 });
    for (let y = 35; y <= 42; y += 2) F.m(s1 > 0 ? 'arm_l' : 'arm_r').set(s1 > 0 ? 10 : -11, y, 0, trim[0], VF.METAL);
  }
  // handlebar mustache
  const hd = F.s('head');
  for (let x = -4; x <= 3; x++) hd.m.set(x, 49, 6, 0x2a2220);
  for (const s1 of [1, -1]) {
    const X = (x: number) => (s1 > 0 ? x : -1 - x);
    hd.m.set(X(4), 49, 6, 0x2a2220).set(X(5), 50, 6, 0x2a2220).set(X(6), 51, 5, 0x3e3430).set(X(6), 52, 5, 0x3e3430);
  }
  // charro trousers with stud rows, black boots
  trousersG(F, black, { bottom: 8 });
  for (const s1 of [1, -1]) {
    for (let y = 9; y <= 23; y += 2) {
      const m = F.m(y > 15 ? (s1 > 0 ? 'thigh_l' : 'thigh_r') : s1 > 0 ? 'shin_l' : 'shin_r');
      m.set(s1 > 0 ? 6 : -7, y, 0, trim[0], VF.METAL);
    }
    bootG(F, s1, 0x1e1a1a, { top: 8, spur: trim, seed: 23 });
  }
  gunBeltG(F, 0x1e1a1a, trim, { loops: false, holster: false, y: 27 });
  const top = addHat(F, sombrero(0x2a2830, trim[0], a ? 19 : 17));
  // the guitar (a guitarrón for the alpha): body low on the right, neck up to the left shoulder
  const g = F.part('guitar', 'torso', [0, 33, 6.5]);
  const k = a ? 1.18 : 1;
  const wood = a ? 0x8a5430 : 0xb7834f;
  const ca = Math.cos(0.62), sa = Math.sin(0.62);
  for (let x = -14; x < 22; x++)
    for (let y = 18; y < 56; y++) {
      const dx = x + 0.5 + 2.5, dy = y + 0.5 - 30;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const lower = Math.hypot(u, v) <= 5.6 * k, upper = Math.hypot(u - 6.4 * k, v) <= 4.4 * k;
      let c: number | null = null;
      if (lower || upper) {
        const rim = Math.hypot(u, v) > 4.7 * k && Math.hypot(u - 6.4 * k, v) > 3.5 * k;
        c = Math.hypot(u - 4.2 * k, v) <= 1.6 * k ? 0x140e0a : u > -2.8 * k && u < -1.6 * k && Math.abs(v) <= 2 ? mulRGB(wood, 0.6) : rim ? mulRGB(wood, 0.72) : wood;
        g.m.set(x, y, 6, mulRGB(wood, 0.8));
        g.m.set(x, y, 7, c);
        if (rim) g.m.set(x, y, 8, mulRGB(wood, 0.85));
      } else if (u >= 9.5 * k && u <= 22 * k && Math.abs(v) <= 1.1) g.m.set(x, y, 7, 0x3a2416);
      else if (u > 22 * k && u <= 25.5 * k && Math.abs(v) <= 1.7) g.m.set(x, y, 7, mulRGB(wood, 0.7));
      if (Math.abs(v) < 0.5 && u > -2.2 * k && u < 23 * k && (lower || upper || (u >= 9.5 * k && u <= 22 * k))) g.m.set(x, y, 8, 0xe8e0d0);
    }
  return done(F, a ? 'mariachi_alpha' : 'mariachi', 'mariachi', { alpha: a, top, radius: 0.32 });
}

// ============================================================================ SHARPSHOOTER
function rifle(F: Fig, gold: boolean) {
  const s = F.part('gun', 'fore_r', F.J.hand_r);
  const I = METAL.iron, Wd = 0x7a4a26, Sc_ = gold ? METAL.gold : METAL.brass;
  for (let y = 22; y <= 33; y++) for (const x of [-10, -9]) for (let z = -3; z <= -2; z++) s.m.set(x, y, z - (y > 29 ? 1 : 0), y > 31 ? mulRGB(Wd, 0.8) : Wd); // stock along the forearm
  for (let y = 17; y <= 21; y++) for (const x of [-10, -9]) for (let z = -1; z <= 1; z++) s.m.set(x, y, z, z < 0 ? mulRGB(Wd, 0.85) : I[1], z < 0 ? VF.SOLID : VF.METAL);
  for (let y = -7; y <= 16; y++) {
    for (const x of [-10, -9]) s.m.set(x, y, 1, y % 6 === 0 ? I[2] : I[0], VF.METAL);
    if (y >= 4) for (const x of [-10, -9]) s.m.set(x, y, 0, Wd); // fore-stock
  }
  for (let y = 6; y <= 15; y++) for (const x of [-10, -9]) s.m.set(x, y, 3, Sc_[0], VF.METAL);
  for (const x of [-10, -9]) s.m.set(x, 5, 3, Sc_[2], VF.METAL).set(x, 16, 3, Sc_[2], VF.METAL).set(x, 8, 2, I[1], VF.METAL).set(x, 13, 2, I[1], VF.METAL);
  s.m.set(-10, 5, 4, 0xbfe6ff).set(-9, 5, 4, 0x8ac0e8);
  s.m.set(-10, -8, 1, 0x0c0806).set(-9, -8, 1, 0x0c0806);
  F.sock('muzzle', 'gun', [-9, -8.5, 1.5]);
}
export function sharpshooterRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l');
  ageBones(F, { seed: 29 });
  emberEyes(F, 0xff3a1a);
  F.remove('eye_r'); // one eye, one rifle, one grudge
  const coat = a ? 0x3a3446 : 0x5a4a3e;
  shirtG(F, 0xc8b898, 2);
  dusterG(F, coat, mulRGB(coat, 0.7), { seed: 29, len: 15 });
  for (const s1 of [1, -1]) sleeveG(F, s1, clothC(coat, 30, { fold: 3 }), { cuff: mulRGB(coat, 0.7) });
  bandolierG(F, 0x3a2414);
  maskBandana(F, a ? 0x1e1a1a : 0xa83424, { seed: 3 });
  // eyepatch over the right socket + its strap round the skull
  const hd = F.s('head');
  for (let x = -6; x <= -1; x++) for (let y = 51; y <= 56; y++) hd.m.set(x, y, 6, (x + y) % 5 === 0 ? 0x2a2420 : 0x161210);
  for (const [x, y, z] of [[0, 57, 6], [1, 57, 6], [2, 58, 6], [3, 58, 5], [4, 59, 5], [5, 59, 4], [6, 59, 3], [6, 59, 2], [6, 59, 1], [6, 59, 0], [6, 59, -1], [6, 59, -2], [6, 59, -3], [6, 59, -4], [6, 59, -5]] as G[]) hd.m.set(x, y, z, 0x161210);
  if (a) {
    // trophy cord of tiny skulls across the chest
    const tr = F.s('torso');
    for (const [x, y] of [[-4, 37], [0, 36], [4, 37]] as [number, number][]) {
      const z = frontZ(tr.m, x, y) + 1;
      for (let dx = -1; dx <= 0; dx++) for (let dy = 0; dy <= 1; dy++) tr.m.set(x + dx, y + dy, z, 0xe2d2b0);
      tr.m.set(x - 1, y + 1, z + 1, 0x1a120c).set(x, y + 1, z + 1, 0x1a120c);
    }
  }
  const top = addHat(F, hatG('flat', a ? 0x1e1a1a : 0x3c3434, a ? 0x8a1e16 : 0x8a2a20, { feather: a ? [0x8a1e16, 0x5a1410] : undefined, seed: 9 }));
  gunBeltG(F, 0x4a2c18, METAL.brass, { loops: true, holster: false, seed: 29 });
  for (const s1 of [1, -1]) bootG(F, s1, 0x3e2a1c, { seed: 29 });
  rifle(F, a);
  return done(F, a ? 'sharpshooter_alpha' : 'sharpshooter', 'sharpshooter', { alpha: a, top, radius: 0.3 });
}

// ============================================================================ SHOTGUNNER
function shotgun(F: Fig, triple: boolean) {
  const s = F.part('gun', 'fore_r', F.J.hand_r);
  const I = METAL.iron, Wd = 0x8a5a30;
  for (let y = 22; y <= 28; y++) for (const x of [-10, -9]) for (let z = -3; z <= -2; z++) s.m.set(x, y, z, Wd);
  for (let y = 17; y <= 21; y++) for (let x = -11; x <= -8; x++) for (let z = -1; z <= 1; z++) s.m.set(x, y, z, z < 0 ? mulRGB(Wd, 0.85) : I[1], z < 0 ? VF.SOLID : VF.METAL);
  const xs = triple ? [-11, -10, -9, -8] : [-11, -10, -9, -8];
  for (let y = 2; y <= 16; y++) for (const x of xs) {
    const bore = triple ? x !== -8 : true;
    s.m.set(x, y, 1, I[0], VF.METAL).set(x, y, 0, y > 9 ? Wd : I[1], y > 9 ? VF.SOLID : VF.METAL);
    if (y === 2 && bore && (x & 1)) s.m.set(x, 1, 1, 0x0c0806);
  }
  for (const x of xs) s.m.set(x, 1, 0, I[2], VF.METAL);
  if (triple) for (let y = 2; y <= 16; y++) s.m.set(-10, y, 2, I[0], VF.METAL);
  F.sock('muzzle', 'gun', [-9.5, 0.5, 1.0]);
}
export function shotgunnerRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l');
  ageBones(F, { seed: 31 });
  emberEyes(F, 0xff6a20);
  // the barrel he wears for trousers
  const pv = F.s('pelvis');
  for (let y = 10; y <= 27; y++) {
    const r = 10.4 - ((y - 18.5) / 8.5) ** 2 * 1.8;
    for (let x = -12; x < 12; x++) for (let z = -13; z <= 10; z++) {
      const gx = x + 0.5, gz = z + 0.5 + 1.5;
      const d = Math.hypot(gx, gz);
      if (d > r || d <= r - 1.5) continue;
      const stave = Math.floor(((Math.atan2(gz, gx) + Math.PI) / (Math.PI * 2)) * 22) & 1;
      const hoop = y === 11 || y === 18 || y === 19 || y === 26;
      pv.m.set(x, y, z, hoop ? (a ? METAL.iron[2] : METAL.iron[0]) : stave ? 0xa06a3a : 0x8a5a30, hoop ? VF.METAL : VF.SOLID);
    }
  }
  if (a) {
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2;
      hornG(pv, [Math.cos(t) * 10.6, 18.5, Math.sin(t) * 10.6 - 1.5], [Math.cos(t), 0.1, Math.sin(t)], 3, 0.7, METAL.silver[0]);
    }
    pv.m.forEach((x, y, z) => {
      if ((y === 22 || y === 23) && z > 4 && isSurf(pv.m, x, y, z)) pv.m.set(x, y, z, (x & 1) ? 0xd8b030 : 0x1e1a1a);
    });
  }
  // suspenders over the bare ribs
  const tr = F.s('torso');
  const sus = a ? 0x1e1a1a : 0xa83424;
  for (const s1 of [1, -1]) {
    const X = (x: number) => (s1 > 0 ? x : -1 - x);
    for (let y = 28; y <= 43; y++) {
      tr.m.set(X(3), y, 4, sus);
      tr.m.set(X(3), y, -7, sus);
    }
    for (let z = -7; z <= 4; z++) tr.m.set(X(3), 44, z, sus);
    tr.m.set(X(3), 29, 5, METAL.brass[2], VF.METAL);
  }
  // walrus mustache
  const hd = F.s('head');
  for (let x = -5; x <= 4; x++) hd.m.set(x, 49, 6, Math.abs(x + 0.5) < 1.5 ? 0xd4ccc2 : 0xb8b0a6).set(x, 48, 6, 0xb8b0a6);
  for (const s1 of [1, -1]) {
    const X = (x: number) => (s1 > 0 ? x : -1 - x);
    hd.m.set(X(4), 47, 6, 0x948c82).set(X(4), 46, 6, 0x948c82).set(X(3), 47, 6, 0xb8b0a6);
  }
  const hat = hatG('bowler', a ? 0x1e1a1a : 0x7a5236, a ? 0x8a1e16 : 0x3a2414, { seed: 5 });
  if (a) for (let i = 0; i < 3; i++) for (let y = 61; y <= 66; y++) hat.model.set(4 + i, y, 6 - i, y === 66 ? 0xe8b0a0 : 0xc03428);
  const top = addHat(F, hat);
  for (const s1 of [1, -1]) bootG(F, s1, 0x6a4226, { seed: 31 });
  shotgun(F, a);
  return done(F, a ? 'shotgunner_alpha' : 'shotgunner', 'shotgunner', { alpha: a, top, radius: 0.36 });
}

// ============================================================================ TUMBLEWEED BANDIT
function ringG(s: Sc, c: G, n: G, r: number, th: number, col: CSpec) {
  const L = Math.hypot(n[0], n[1], n[2]);
  const N = [n[0] / L, n[1] / L, n[2] / L];
  const R = Math.ceil(r + th + 1);
  for (let x = Math.floor(c[0] - R); x <= Math.ceil(c[0] + R); x++)
    for (let y = Math.floor(c[1] - R); y <= Math.ceil(c[1] + R); y++)
      for (let z = Math.floor(c[2] - R); z <= Math.ceil(c[2] + R); z++) {
        const px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
        const h = px * N[0] + py * N[1] + pz * N[2];
        const d = Math.hypot(Math.hypot(px - h * N[0], py - h * N[1], pz - h * N[2]) - r, h);
        if (d <= th) s.m.set(x, y, z, res(col, x, y, z));
      }
}
export function tumbleweedBanditRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l');
  ageBones(F, { seed: 37 });
  emberEyes(F, 0xff5a1e);
  // bandit mask across the eyes (sockets stay open), knotted at the back
  const hd = F.s('head');
  for (let x = -7; x <= 6; x++)
    for (let y = 52; y <= 56; y++)
      for (let z = -8; z <= 6; z++) {
        if (hd.m.has(x, y, z)) continue;
        const near = hd.m.has(x - 1, y, z) || hd.m.has(x + 1, y, z) || hd.m.has(x, y, z - 1) || hd.m.has(x, y, z + 1);
        const sock = z >= 2 && ((x >= 1 && x <= 4) || (x >= -5 && x <= -2)) && y >= 52 && y <= 55;
        if (near && !sock) hd.m.set(x, y, z, (x + y) % 6 === 0 ? 0x2a2420 : 0x161210);
      }
  lineG(hd, [[-0.5, 54.5, -8.5], [-1.5, 52.0, -9.4], [-1.0, 49.5, -9.6]], 0x161210);
  lineG(hd, [[0.5, 54.5, -8.5], [1.4, 52.4, -9.2], [2.0, 50.2, -9.0]], 0x2a2420);
  if (a) maskBandana(F, 0xa83424, { seed: 5 });
  const top = addHat(F, hatG('flat', 0x3c3434, METAL.silver[0], { seed: 7 }));
  shirtG(F, 0x8a7a62, 37);
  gunBeltG(F, 0x4a2c18, METAL.silver, { loops: true, holster: true, seed: 37 });
  for (const s1 of [1, -1]) bootG(F, s1, 0x3e2a1c, { seed: 37 });
  revolverG(F, {});
  if (a) revolverG(F, { name: 'gun_l', side: 1 });
  // the disguise: a woven tumbleweed around the whole middle
  const wd = F.part('weed', 'pelvis', [0, 30, -1.5]);
  const R = a ? 16.5 : 15.5;
  const twig = (x: number, y: number, z: number) => (hash3(x, y, z) > 0.55 ? 0xa8844c : hash3(z, x, y) > 0.5 ? 0xc9a46a : 0x8a6a3a);
  const axes: G[] = [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, -1], [0, 1, 0], [1, 1.2, 0], [-1, 1.2, 0], [0, 1.1, 1], [0, 1.1, -1], [1, 0.4, 0.8]];
  axes.forEach((n, i) => ringG(wd, [0, 30, -1.5], n, R - (i % 3) * 0.6, 0.55, twig));
  for (let k = 0; k < 9; k++) {
    const t = hash3(k, 1, 3) * Math.PI * 2, p = (hash3(k, 2, 3) - 0.5) * 2.4;
    const d: G = [Math.cos(t) * Math.cos(p), Math.sin(p), Math.sin(t) * Math.cos(p)];
    lineG(wd, [[d[0] * R, 30 + d[1] * R, -1.5 + d[2] * R], [d[0] * (R + 3.5), 30 + d[1] * (R + 3.5) + 1, -1.5 + d[2] * (R + 3.5)]], 0x7a5c30);
    if (a) wd.m.set(Math.floor(d[0] * (R + 3.5)), Math.floor(30 + d[1] * (R + 3.5) + 1), Math.floor(-1.5 + d[2] * (R + 3.5)), 0xe8dcc0);
  }
  return done(F, a ? 'tumbleweed_bandit_alpha' : 'tumbleweed_bandit', 'tumbleweed_bandit', { alpha: a, top: Math.max(top, 47), radius: 0.45 });
}

// ============================================================================ LASSO RIDER (Lasso Lucy)
export function lassoRiderRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l');
  ageBones(F, { seed: 41 });
  emberEyes(F, 0xff7a30);
  // braided pigtails with ribbon bows
  const hd = F.s('head');
  const yarn = (x: number, y: number, z: number) => ((y + (x & 1)) & 1 ? 0xe0782e : 0xb85a1e);
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    tube(hd, [[X(6.2), 57, -3.0], [X(7.3), 52, -3.4], [X(7.6), 46, -2.6], [X(7.4), 41, -1.6]], (t) => 1.25 - t * 0.35, yarn);
    ell(hd, [X(7.5), 44.5, -2.0], [1.2, 0.8, 1.6], a ? 0x8a1e16 : 0x2a4a9a);
    hd.m.set(Math.floor(X(7.4)), 40, -2, 0xf89a52);
  }
  neckerchief(F, 0x2e9a8a, 4);
  // fringed leather vest
  vestG(F, 0x8a5a30, { seed: 41 });
  const tr = F.s('torso');
  for (let x = -7; x <= 6; x += 2) {
    tr.m.set(x, 30, -7, 0xa86e3e).set(x, 29, -7, 0x8a5a30);
    if (Math.abs(x + 0.5) > 2.6) tr.m.set(x, 30, 4, 0xa86e3e).set(x, 29, 4, 0x8a5a30);
  }
  if (a) bandolierG(F, 0x3a2414);
  // denim trousers under leather chaps with side fringe, red boots
  trousersG(F, clothC(0x4a6688, 3, { fold: 3 }), { bottom: 9 });
  for (const s1 of [1, -1]) {
    const X = (x: number) => (s1 > 0 ? x : -1 - x);
    for (const part of [s1 > 0 ? 'thigh_l' : 'thigh_r', s1 > 0 ? 'shin_l' : 'shin_r']) {
      const s = F.s(part);
      coatG(s, (x, y, z) => s1 * x > 4.2 || z > 1.8, leatherC(0x5a3a22, 41));
    }
    for (let y = 10; y <= 23; y += 2) F.m(y > 15 ? (s1 > 0 ? 'thigh_l' : 'thigh_r') : s1 > 0 ? 'shin_l' : 'shin_r').set(X(6), y, -1, 0xa86e3e);
    bootG(F, s1, 0xa8402c, { seed: 41, spur: a ? METAL.gold : METAL.silver });
  }
  gunBeltG(F, 0x4a2c18, METAL.brass, { loops: false, holster: false, seed: 41 });
  // pink cowgirl hat with a daisy
  const hat = hatG('cowgirl', a ? 0x8a2a3e : 0xd8607a, 0xeee0c0, { seed: 41, feather: a ? [0xf4f0e8, 0xd8d2c6] : undefined });
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) hat.model.set(8, 61 + dz, 3 + dx, 0xf4f0e8);
  hat.model.set(8, 61, 3, 0xf2c443);
  const top = addHat(F, hat);
  // lasso: a coil in the fist and a big open loop
  const ls = F.part('lasso', 'fore_r', F.J.hand_r);
  const rope = (x: number, y: number, z: number) => ((x + y + z) & 1 ? 0xd8bc84 : 0xb49a64);
  for (let i = 0; i < 3; i++) ringG(ls, [-10 - i * 0.8, 18, 1], [1, 0, 0], 3.4, 0.5, rope);
  ringG(ls, [-11, 7, 3.5], [1, 0, 0.35], 7.0, 0.55, rope);
  // the sandboard under her boots
  boardG(F, a ? 0x5a3c2c : 0xb7834f, a ? METAL.gold[0] : 0x93643a, a ? 0x8a1e16 : 0xc0442f, { gold: a, seed: 41 });
  const spec = done(F, a ? 'lasso_rider_alpha' : 'lasso_rider', 'lasso_rider', { alpha: a, top: top + BH, radius: 0.32, meta: { boardTop: BH * F.vs, headY: (F.J.eye[1] + BH) * F.vs } });
  liftSpec(spec, BH, ['board']);
  const bp = spec.parts.find((p) => p.name === 'board');
  if (bp) delete bp.parent;
  return spec;
}

// ============================================================================ JACKAL ARCHER
export function jackalArcherRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  const { top } = jackalBody(F, { alpha: a, variant: 0 });
  const G = METAL.gold;
  // quiver on the back, strap across the chest
  const tr = F.s('torso');
  const L = leatherC(0x7a4a26, 7);
  limbG(tr, [-4, 30, -8.5], [-6.5, 43, -8.0], () => 1.8, L);
  for (const y of [32, 40]) for (let x = -8; x <= -3; x++) for (let z = -11; z <= -6; z++) if (tr.m.has(x, y, z) && isSurf(tr.m, x, y, z)) tr.m.set(x, y, z, G[0], VF.METAL);
  for (const [dx, dz] of [[0, 0], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    const x = -7 + dx, z = -8 + dz;
    for (let y = 44; y <= 46; y++) tr.m.set(x, y, z, 0x8a5a30);
    tr.m.set(x, 47, z, 0xf0e6d0).set(x, 48, z, a ? 0x8a1e16 : 0xf0e6d0);
  }
  for (let y = 31; y <= 43; y++) {
    const x = Math.round(5 - (y - 31) * 0.8);
    tr.m.set(x, y, frontZ(tr.m, x, y) + 1, 0x5a3a22);
  }
  // recurve bow in the left fist, laid along rest Z so it stands upright when the arm raises to aim
  // (rest +Y = toward the archer when aiming: the tips and the string sit on that side)
  const bw = F.part('bow', 'fore_l', F.J.hand);
  const BW = a ? G[0] : 0x5a3a22;
  for (let z = -18; z <= 17; z++) {
    const t = (z + 0.5) / 18;
    const y = Math.round(21 + t * t * 4.2 - (Math.abs(t) > 0.9 ? 1 : 0));
    const c = Math.abs(t) < 0.12 ? 0xb8322a : Math.abs(t) > 0.88 ? G[2] : BW;
    for (const x of [8, 9]) bw.m.set(x, y, z, c, Math.abs(t) > 0.88 || a ? VF.METAL : VF.SOLID);
  }
  for (let z = -16; z <= 15; z++) bw.m.set(9, 25, z, 0xf0e8d8); // string
  return done(F, a ? 'jackal_archer_alpha' : 'jackal_archer', 'jackal_archer', { alpha: a, top, radius: 0.3 });
}

// ============================================================================ BANDAGE WHIPPER (mummy)
export function bandageWhipperRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = new Fig();
  const { base } = mummyBody(F, { alpha: a, variant: 0, boneArmR: true, collar: a });
  // the right arm is unwrapped bone (he made the whip out of it): weathered, torn wraps at the shoulder
  ageBones(F, { seed: 43, skip: ['pelvis', 'torso', 'head', 'jaw', 'eye_l', 'eye_r', 'brow_l', 'brow_r', 'arm_l', 'fore_l', 'thigh_l', 'shin_l', 'thigh_r', 'shin_r'] });
  frayStrip(F.s('arm_r'), -10, -7, -2, 43, 2, 5, clothC(base, 4, { fold: 2 }), 7);
  // gold scarab amulet on the chest (the alpha keeps the full collar)
  const tr = F.s('torso');
  const z = frontZ(tr.m, 0, 37) + 1;
  for (const [x, y, c] of [[-1, 37, 0x2a4a9a], [0, 37, 0x2a4a9a], [-1, 36, 0x2a4a9a], [0, 36, 0x2a4a9a], [-2, 37, METAL.gold[0]], [1, 37, METAL.gold[0]], [-1, 38, 0x2e9a8a], [0, 38, 0x2e9a8a]] as number[][]) tr.m.set(x, y, z, c);
  // broken shackle on the left wrist
  const fl = F.s('fore_l');
  for (const y of [26, 27]) wrapShell(fl, y, y, y === 26 ? METAL.iron[0] : METAL.iron[2], () => true, VF.METAL);
  for (const [x, y, zz] of [[11, 25, 2], [12, 24, 2], [12, 23, 3], [13, 22, 3]] as G[]) fl.m.set(x, y, zz, METAL.iron[1], VF.METAL);
  // canopic jar on the left hip, jackal-head lid
  const pv = F.s('pelvis');
  pv.rbox([7.6, 18.0, -1.5], [10.4, 23.0, 1.5], 0.8, 0xd8b27e);
  pv.rbox([7.8, 23.0, -1.3], [10.2, 25.0, 1.3], 0.6, 0x3a3446);
  pv.m.set(8, 25, 0, 0x3a3446).set(9, 25, -1, 0x3a3446).set(8, 26, -1, 0x3a3446).set(9, 20, 2, 0x2a4a9a);
  // the whip: a long unravelled bandage from the bone fist, trailing forward
  const wp = F.part('whip', 'fore_r', F.J.hand_r);
  const pts: G[] = a
    ? [[-9, 20, 1], [-10, 13, 2], [-11, 6, 4], [-11, 1.5, 9], [-8, 0.5, 16], [-3, 0.5, 21], [2, 1, 24], [5, 1.5, 25]]
    : [[-9, 20, 1], [-10, 13, 2], [-11, 6, 4], [-10, 1.5, 9], [-7, 0.5, 14], [-3, 1, 18], [-1, 1.5, 20]];
  const strip = (t: number): CSpec => (Math.floor(t * 18) % 2 ? mulRGB(base, 0.9) : base);
  lineG(wp, pts, strip);
  lineG(wp, pts.map((p) => [p[0] + 1, p[1], p[2]] as G), strip);
  if (a) {
    // nemes headdress: striped gold/lapis cloth with lappets
    const hat = new VoxelModel('hat');
    for (let y = 50; y <= 64; y++) {
      const hx = y >= 63 ? 6.4 : 8.4;
      for (let x = -9; x < 9; x++) for (let z = -10; z <= 7; z++) {
        const ax = Math.abs(x + 0.5);
        const shell = (ax <= hx && ax > hx - 1.2) || z === -10 || y >= 63;
        if (!shell || ax > hx || (y >= 63 && (z < -9 || z > 6)) || (z > 1 && y < 58 && ax < 7.5)) continue;
        hat.set(x, y, z, (y & 1) ? METAL.gold[0] : 0x2a4a9a, (y & 1) ? VF.METAL : VF.SOLID);
      }
    }
    for (const s1 of [1, -1]) for (let y = 38; y <= 50; y++) for (let x = 7; x <= 8; x++) for (let z = 0; z <= 3; z++) hat.set(s1 > 0 ? x : -1 - x, y, z, (y & 1) ? METAL.gold[0] : 0x2a4a9a, (y & 1) ? VF.METAL : VF.SOLID);
    for (let x = -7; x <= 6; x++) hat.set(x, 58, 7, METAL.gold[2], VF.METAL);
    hat.set(-1, 59, 8, 0xb8322a).set(0, 59, 8, 0xb8322a).set(-1, 60, 8, METAL.gold[2], VF.METAL).set(0, 60, 8, METAL.gold[2], VF.METAL);
    addHat(F, { model: hat, top: 65 });
  }
  return done(F, a ? 'bandage_whipper_alpha' : 'bandage_whipper', 'bandage_whipper', { alpha: a, top: headTop(F), radius: 0.34 });
}

void cap;
void frayStrip;
void dusterG;
