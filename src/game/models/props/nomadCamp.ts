// The travellers' camp of the backstory: a Bedouin "house of hair" tent (woven goat-hair panels
// sagging between forked poles, a back wall, half side walls, a tasselled valance, guy ropes and
// stakes, kilim rugs, striped bolsters, a brass tray with a teapot) and a cold-fire variant helper.
// 1/24 m, pivot bottom-centre, the open front faces +Z. meta.hooks: lantern hooks under the front poles (m).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { hash3, noise } from '../../../engine/math/rand';
import { Sc, type M3, mulRGB, mix } from '../enemies/real/sculpt';
import { ell, cap, tube } from '../enemies/real/rk';

const VS = 1 / 24;
const HAIR = [0x2c2119, 0x1d1712, 0x3a2c21];
const CREAM = 0x9c8868;
const WOOD = [0x6a4a30, 0x4e3420, 0x86603e];
const ROPE = 0xa89068;
const KILIM = { red: 0x8e2a1e, indigo: 0x26305a, ochre: 0xc08a32, cream: 0xe0cfa8, black: 0x231a16 };

export interface NomadTent {
  model: VoxelModel;
  voxelSize: number;
  meta: { hooks: M3[]; width: number; depth: number };
}

/** woven goat hair: panels across the width, weft speckle, a cream thread now and then */
function hairCol(x: number, y: number, z: number, seed: number) {
  const X = x * VS;
  const panel = Math.floor((X + 6) / 0.55);
  const inPanel = ((X + 6) % 0.55) / 0.55;
  let c = HAIR[(panel + seed) % 2];
  if (inPanel < 0.04) c = HAIR[2]; // the seam between panels
  if (((panel * 7 + seed) % 5 === 0) && inPanel > 0.44 && inPanel < 0.5) c = CREAM;
  const w = noise.n3(x * 0.4, y * 0.6, z * 0.4) * 0.08 + (hash3(x, y, z) - 0.5) * 0.06;
  return mulRGB(c, 1 + w);
}

function kilimCol(u: number, v: number) {
  // a woven kilim: border bands, a row of diamonds, a red field
  const bu = Math.min(u, 1 - u), bv = Math.min(v, 1 - v);
  const b = Math.min(bu, bv);
  if (b < 0.04) return KILIM.black;
  if (b < 0.08) return (Math.floor(u * 40) + Math.floor(v * 40)) % 2 ? KILIM.ochre : KILIM.cream;
  if (b < 0.11) return KILIM.indigo;
  const du = Math.abs(((u * 5) % 1) - 0.5) * 2, dv = Math.abs(v - 0.5) * 2;
  if (du + dv < 0.55) return du + dv < 0.25 ? KILIM.ochre : KILIM.indigo;
  if (du + dv < 0.65) return KILIM.cream;
  return KILIM.red;
}

export function nomadTent(seed = 1): NomadTent {
  const m = new VoxelModel('nomad_tent_' + seed);
  const s = new Sc(m, VS);
  const W = 2.9, Z0 = -1.6, Z1 = 1.45;
  const poles: { x: number; z: number; h: number }[] = [];
  for (const x of [-1.9, 0, 1.9]) {
    poles.push({ x, z: -0.75, h: 1.95 + (x === 0 ? 0.12 : 0) });
    poles.push({ x, z: Z1, h: 1.55 });
  }
  const roof = (x: number, z: number) => {
    let y = 0;
    for (const p of poles) y = Math.max(y, p.h - 0.34 * Math.pow(Math.hypot(x - p.x, (z - p.z) * 1.15), 1.15));
    // the edges drop toward the walls
    const ex = Math.max(0, Math.abs(x) - (W - 0.5)) * 0.9, ez = Math.max(0, Z0 + 0.4 - z) * 0.9;
    return Math.max(0.9, y - ex - ez);
  };
  // ---- roof (two layers thick), a darker underside
  for (let x = -W; x <= W; x += VS)
    for (let z = Z0; z <= Z1; z += VS) {
      const y = roof(x, z);
      const i = Math.floor(x / VS), j = Math.floor(y / VS), k = Math.floor(z / VS);
      m.set(i, j, k, hairCol(i, j, k, seed));
      m.set(i, j - 1, k, mulRGB(hairCol(i, j - 1, k, seed), 0.72));
      // fill steep steps so the cloth never shows a hole
      const yn = roof(x + VS, z), zn = roof(x, z + VS);
      for (let jj = Math.min(Math.floor(yn / VS), Math.floor(zn / VS)); jj < j - 1; jj++) m.set(i, jj, k, hairCol(i, jj, k, seed));
    }
  // ---- back wall and the back halves of the side walls, hanging in slight folds
  for (let x = -W; x <= W; x += VS) {
    const top = roof(x, Z0);
    for (let y = 0; y <= top; y += VS) {
      const z = Z0 - 0.04 * Math.sin(x * 5.3 + seed) - (1 - y / top) * 0.12;
      m.set(Math.floor(x / VS), Math.floor(y / VS), Math.floor(z / VS), hairCol(Math.floor(x / VS), Math.floor(y / VS), 0, seed));
    }
  }
  for (const sx of [1, -1])
    for (let z = Z0; z <= 0.15; z += VS) {
      const top = roof(sx * W, z);
      for (let y = 0; y <= top; y += VS) {
        const x = sx * (W + 0.03 * Math.sin(z * 6 + seed) + (1 - y / top) * 0.1);
        m.set(Math.floor(x / VS), Math.floor(y / VS), Math.floor(z / VS), hairCol(0, Math.floor(y / VS), Math.floor(z / VS), seed + 1));
      }
      // the front corner of the side wall is rolled up into a bundle
      if (z > 0.1) for (let y = 0.15; y <= top; y += VS * 2) ell(s, [sx * W, y, 0.15], [0.07, 0.07, 0.07], (a, b, c) => hairCol(a, b, c, seed));
    }
  // ---- the front valance with tassels
  for (let x = -W + 0.1; x <= W - 0.1; x += VS) {
    const y0 = roof(x, Z1);
    for (let y = y0 - 0.22; y <= y0; y += VS) m.set(Math.floor(x / VS), Math.floor(y / VS), Math.floor((Z1 + 0.03) / VS), y < y0 - 0.18 && Math.floor(x / VS) % 3 === 0 ? KILIM.red : hairCol(Math.floor(x / VS), Math.floor(y / VS), 0, seed));
    if (Math.floor(x / VS) % 6 === 0) {
      cap(s, [x, y0 - 0.22, Z1 + 0.03], [x + 0.01, y0 - 0.36, Z1 + 0.04], 0.012, 0.008, KILIM.ochre);
      ell(s, [x + 0.01, y0 - 0.38, Z1 + 0.04], [0.02, 0.03, 0.02], KILIM.red);
    }
  }
  // ---- forked poles (a little crooked, rope-bound), guy ropes and stakes
  const hooks: M3[] = [];
  for (const p of poles) {
    const lean = (hash3(p.x * 10, p.z * 10, seed) - 0.5) * 0.06;
    tube(s, [[p.x, 0, p.z], [p.x + lean * 0.5, p.h * 0.5, p.z + 0.01], [p.x + lean, p.h + 0.05, p.z]], (t) => 0.045 - t * 0.012, (a, b, c) => mulRGB(WOOD[(a + c) & 1 ? 0 : 1], 0.95 + hash3(a, b, c) * 0.1));
    for (const sx of [1, -1]) cap(s, [p.x + lean, p.h, p.z], [p.x + lean + sx * 0.05, p.h + 0.12, p.z], 0.02, 0.014, WOOD[2]);
    for (let y = 0.9; y < 1.05; y += VS) ell(s, [p.x + lean * 0.5, y, p.z], [0.052, 0.012, 0.052], ROPE);
    if (p.z > 0) {
      hooks.push([p.x + lean, p.h - 0.08, p.z + 0.06]);
      // guy rope forward to a stake
      const a: M3 = [p.x + lean, p.h + 0.02, p.z], b: M3 = [p.x * 1.15, 0.05, p.z + 1.25];
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sag = Math.sin(t * Math.PI) * 0.07;
        m.set(Math.floor((a[0] + (b[0] - a[0]) * t) / VS), Math.floor((a[1] + (b[1] - a[1]) * t - sag) / VS), Math.floor((a[2] + (b[2] - a[2]) * t) / VS), ROPE);
      }
      cap(s, [b[0], -0.02, b[2]], [b[0] - 0.02, 0.14, b[2] - 0.03], 0.025, 0.018, WOOD[1]);
    }
  }
  for (const sx of [1, -1]) {
    const a: M3 = [sx * W, roof(sx * W, -0.75) + 0.02, -0.75], b: M3 = [sx * (W + 1.2), 0.05, -0.9];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      m.set(Math.floor((a[0] + (b[0] - a[0]) * t) / VS), Math.floor((a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.06) / VS), Math.floor((a[2] + (b[2] - a[2]) * t) / VS), ROPE);
    }
    cap(s, [b[0], -0.02, b[2]], [b[0] + sx * 0.03, 0.14, b[2]], 0.025, 0.018, WOOD[1]);
  }
  // ---- the floor: two kilims, striped bolsters, a brass tray with a teapot and glasses, a chest
  const rug = (x0: number, z0: number, x1: number, z1: number) => {
    for (let x = x0; x <= x1; x += VS)
      for (let z = z0; z <= z1; z += VS) {
        const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
        const c = kilimCol(u, v);
        m.set(Math.floor(x / VS), 0, Math.floor(z / VS), mulRGB(c, 0.95 + hash3(Math.floor(x / VS), 0, Math.floor(z / VS)) * 0.08));
      }
    for (let x = x0; x <= x1; x += VS * 2) for (const z of [z0 - VS, z1 + VS]) m.set(Math.floor(x / VS), 0, Math.floor(z / VS), KILIM.cream); // fringe
  };
  rug(-2.4, -1.4, -0.2, 1.2);
  rug(0.1, -1.3, 2.4, 0.9);
  for (const [x, z, ry] of [[-2.1, -1.2, 0], [-0.6, -1.25, 0], [1.2, -1.15, 0], [2.4, -0.2, 1.57]] as [number, number, number][]) {
    const len = 0.5, r = 0.14;
    const dx = Math.cos(ry) * len, dz = Math.sin(ry) * len;
    cap(s, [x - dx, r, z - dz], [x + dx, r, z + dz], r, r, (a, b, c) => (Math.floor((a + c) / 2) % 3 === 0 ? KILIM.ochre : (b % 4 < 2 ? KILIM.red : KILIM.indigo)));
  }
  // tray, teapot and two small glasses
  ell(s, [0.8, 0.03, 0.35], [0.24, 0.02, 0.24], 0xb08a3a, { fl: VF.METAL });
  ell(s, [0.8, 0.12, 0.35], [0.07, 0.08, 0.07], 0xc8a050, { fl: VF.METAL });
  tube(s, [[0.86, 0.12, 0.35], [0.94, 0.16, 0.35], [0.98, 0.2, 0.35]], (t) => 0.014 - t * 0.006, 0xc8a050, VF.METAL);
  ell(s, [0.8, 0.21, 0.35], [0.03, 0.02, 0.03], 0xe0c070, { fl: VF.METAL });
  for (const gx of [0.62, 0.68]) ell(s, [gx, 0.07, 0.48], [0.022, 0.035, 0.022], 0xd8a868, { fl: VF.METAL });
  // a painted chest at the back
  s.rbox([-1.5, 0, -1.45], [-0.8, 0.42, -1.05], 0.03, (a, b, c) => (b % 6 === 0 ? 0xb08a3a : mix(0x6a2a1e, 0x4a1a14, hash3(a, b, c) * 0.5)));
  return { model: m, voxelSize: VS, meta: { hooks, width: W * 2, depth: Z1 - Z0 } };
}

/** the same fire pit gone cold: the glowing coals turned to grey ash (a copy; the original is untouched) */
export function coldFire(src: VoxelModel): VoxelModel {
  const m = src.clone();
  m.forEach((x, y, z, c, f) => {
    if (f & VF.EMISSIVE) m.set(x, y, z, mix(0x6a625a, 0x8a827a, hash3(x, y, z)), 0);
  });
  return m;
}

/** a rolled tent bundle with rope ties (for the loaded camel), 1/24, pivot centre; lies along X */
export function tentBundle(seed = 0) {
  const m = new VoxelModel('tent_bundle');
  const s = new Sc(m, VS);
  tube(s, [[-0.55, 0, 0], [-0.2, 0.02, 0], [0.2, -0.01, 0], [0.55, 0, 0]], (t) => 0.15 + Math.sin(t * Math.PI) * 0.03, (a, b, c) => hairCol(a, b, c, seed));
  for (const x of [-0.3, 0.05, 0.36]) for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    m.set(Math.floor(x / VS), Math.floor((Math.cos(a) * 0.185) / VS), Math.floor((Math.sin(a) * 0.185) / VS), ROPE);
  }
  return { model: m, voxelSize: VS };
}
