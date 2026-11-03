// Clothing and gear tailored to Sundown's figure (1/36 grid, geometric voxel coords,
// see fig.ts). Everything is fitted around the figure's real bones: hats sit on the
// 12-wide skull dome (brim at row 59), neckwear rings the neck vertebrae, vests and
// dusters hang off the rib cage, belts ride the hip bones, boots enclose the shin.
import { BONE } from '../../characters/skeleton';
import {
  Fig, G, Sc, VoxelModel, VF, mix, mulRGB, hash3, noise, ell, CSpec, sections, lineG, coatG, cutG, isSurf, clothC, leatherC, tones,
  wrapShell, frayStrip,
} from './fig';

const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : (c(x, y, z) as number));
const BONES = new Set([BONE.base, BONE.shade, BONE.hi, BONE.dark].map((c) => c & 0xffffff));
export const METAL = {
  iron: [0x5e6066, 0x46484e, 0x8a8d94],
  steel: [0x9aa0a8, 0x6e737c, 0xd2d6dc],
  brass: [0xc79a46, 0x9a7428, 0xe8c070],
  gold: [0xe8b43a, 0xb8862a, 0xffe08a],
  silver: [0xc9cdd4, 0x9ca1aa, 0xf0f2f6],
  bronze: [0xb07a3a, 0x86582a, 0xd8a060],
};

// ============================================================================ bones & eyes
/** weather Sundown's clean cream bones into an outlaw's: ivory with grime patches and hairline cracks */
export function ageBones(F: Fig, o: { tint?: number; amt?: number; grime?: number; seed?: number; skip?: string[] } = {}) {
  const tint = o.tint ?? 0xb89a6a, amt = o.amt ?? 0.22, grime = o.grime ?? 0x7a6040, seed = o.seed ?? 0;
  const skip = new Set(o.skip ?? ['eye_l', 'eye_r']);
  for (const [n, p] of Object.entries(F.fig.parts)) {
    if (skip.has(n)) continue;
    const m = p.model;
    const todo: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (!BONES.has(c)) return;
      let k = mix(c, tint, amt);
      const nn = noise.n3(x / 3.2 + seed, y / 3.6, z / 3.2 - seed);
      if (nn < -0.34) k = mix(k, grime, 0.3);
      else if (nn > 0.48) k = mix(k, 0xfff2d8, 0.12);
      if (Math.abs(noise.n3(x / 1.9 + seed * 2, y / 1.9, z / 1.9)) < 0.028) k = mix(k, grime, 0.55);
      todo.push([x, y, z, k, f]);
    });
    for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  }
}

/** a dark wet orb deep in each socket with a pinpoint ember pupil (modelled, not 2D) */
export function emberEyes(F: Fig, ember = 0xff5a1e, o: { orb?: number } = {}) {
  const orb = o.orb ?? 0x1a0f09;
  for (const sx of [1, -1]) {
    const name = sx > 0 ? 'eye_l' : 'eye_r';
    const m = new VoxelModel(name);
    const X = (i: number) => (sx > 0 ? i : -1 - i);
    for (const i of [2, 3])
      for (const y of [53, 54]) {
        m.set(X(i), y, 2, 0x100906);
        m.set(X(i), y, 3, y === 54 ? (i === (sx > 0 ? 2 : 3) ? 0x4a3628 : orb) : orb);
      }
    m.set(X(sx > 0 ? 3 : 2), 53, 3, ember, VF.EMISSIVE);
    m.set(X(sx > 0 ? 2 : 3), 53, 3, mix(ember, 0x140b07, 0.6));
    F.setModel(name, m);
  }
}

/** a forked crack across the left temple of the skull */
export function skullCrack(F: Fig, col = 0x5a4228) {
  const m = F.m('head');
  for (const [x, y, z] of [[5, 60, 2], [5, 59, 3], [5, 58, 3], [5, 57, 4], [4, 58, 5], [5, 56, 4], [3, 59, 5], [4, 61, 1]] as G[]) if (m.has(x, y, z)) m.set(x, y, z, col);
}
/** two long fangs on the upper teeth row */
export function fangs(F: Fig, col = 0xe8dcc0) {
  const h = F.m('head'), j = F.m('jaw');
  for (const x of [-4, 3]) {
    h.set(x, 47, 5, col);
    j.del(x, 46, 5);
  }
}

// ============================================================================ hats (part 'hat' on the head, pivot J.hat)
export type HatKind = 'cowboy' | 'cowgirl' | 'wide' | 'flat' | 'bowler' | 'tall';
export interface HatOpts {
  bullet?: boolean;
  star?: number[];
  feather?: [number, number];
  concho?: number[];
  seed?: number;
  stain?: boolean;
}
/** felt hat fitted over the 12-wide skull dome; returns { model, top } */
export function hatG(kind: HatKind, felt: number, band: number, o: HatOpts = {}) {
  const m = new VoxelModel('hat');
  const seed = o.seed ?? 3;
  const Fc = tones(mulRGB(felt, 0.88), felt, mix(felt, 0xffffff, 0.07), 4.5, seed);
  const y0 = 59;
  const spec = {
    cowboy: { rx: 14.2, rz: 12.6, roll: 2, dip: 1, H: 7, hx: 7.4, crease: true },
    cowgirl: { rx: 13.4, rz: 12.0, roll: 3, dip: 1, H: 6, hx: 7.3, crease: true },
    wide: { rx: 16.2, rz: 14.6, roll: 0, dip: -1, H: 6, hx: 7.5, crease: false },
    flat: { rx: 14.6, rz: 13.2, roll: 0, dip: 0, H: 5, hx: 7.4, crease: false },
    bowler: { rx: 10.8, rz: 10.0, roll: 1, dip: 0, H: 8, hx: 7.5, crease: false },
    tall: { rx: 13.6, rz: 12.2, roll: 1, dip: 0, H: 11, hx: 7.3, crease: false },
  }[kind];
  // ---- brim
  for (let x = -18; x < 18; x++)
    for (let z = -17; z <= 15; z++) {
      const gx = x + 0.5, gz = z + 0.5 + 1;
      const e = (gx / spec.rx) ** 2 + (gz / spec.rz) ** 2;
      if (e > 1) continue;
      const ax = Math.abs(gx) / spec.rx;
      let y = y0;
      if (spec.roll > 0 && ax > 0.68) y += ax > 0.84 && spec.roll > 1 ? spec.roll : 1;
      if (spec.dip > 0 && Math.abs(gx) < spec.rx * 0.5 && Math.abs(gz) > spec.rz * 0.72) y -= 1; // front/back dip
      if (spec.dip < 0 && e > 0.72) y -= 1; // droop all round (wide brim)
      const edge = e > 0.84;
      m.set(x, y, z, edge ? mulRGB(res(Fc, x, y, z), 0.8) : res(Fc, x, y, z));
      if (y > y0) for (let yy = y0; yy < y; yy++) m.set(x, yy, z, mulRGB(res(Fc, x, yy, z), 0.86));
      if (y < y0) m.set(x, y0, z, res(Fc, x, y0, z));
    }
  // ---- crown
  const top = y0 + spec.H;
  for (let y = y0 + 1; y <= top; y++) {
    const t = (y - y0) / spec.H;
    let hx = spec.hx - t * (kind === 'tall' ? 0.5 : 0.9), zf = 6.8 - t * 0.9, zb = -8.8 + t * 0.9;
    if (kind === 'bowler') {
      const k = Math.max(0, (y - (y0 + 4)) / 4.2);
      const sh = Math.sqrt(Math.max(0, 1 - k * k));
      hx = 7.6 * sh + 0.4;
      zf = -1 + 7.7 * sh + 0.3;
      zb = -1 - 7.7 * sh - 0.3;
    }
    const p = kind === 'bowler' ? 2.0 : 2.6;
    for (let x = -10; x < 10; x++)
      for (let z = -11; z <= 9; z++) {
        const u = Math.abs(x + 0.5) / hx, v = Math.abs(z + 0.5 - (zf + zb) / 2) / ((zf - zb) / 2);
        if (u ** p + v ** p > 1) continue;
        m.set(x, y, z, y === top ? mix(res(Fc, x, y, z), 0xffffff, 0.05) : res(Fc, x, y, z));
      }
  }
  if (spec.crease) {
    for (let z = -6; z <= 4; z++) for (const x of [-1, 0]) m.del(x, top, z).set(x, top - 1, z, mulRGB(felt, 0.8));
    for (const s of [1, -1]) for (const [x, y, z] of [[3, top, 4], [4, top, 3], [4, top - 1, 5], [5, top - 1, 4], [5, top, 3]] as G[]) m.del(s > 0 ? x : -1 - x, y, z);
  }
  // ---- band (+ sweat stain just above it)
  const inCrown = (x: number, z: number) => Math.abs(x + 0.5) < spec.hx + 0.6 && z + 0.5 > -9.6 && z + 0.5 < 7.6;
  for (let y = y0 + 1; y <= y0 + 2; y++)
    m.forEach((x, yy, z) => {
      if (yy !== y || !inCrown(x, z)) return;
      if (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)) m.set(x, y, z, y === y0 + 1 ? mulRGB(band, 0.85) : band);
    });
  if (o.stain !== false)
    m.forEach((x, y, z, c) => {
      if (y === y0 + 3 && inCrown(x, z) && isSurf(m, x, y, z) && noise.n2(x * 0.4 + seed, z * 0.4) > 0.1) m.set(x, y, z, mix(c, 0x2a1c12, 0.18));
    });
  if (o.concho) for (const [x, c] of [[-1, 1], [0, 2], [-1, 2], [0, 1]] as [number, number][]) m.set(x, y0 + c, 8, c === 2 ? o.concho[2] : o.concho[0], VF.METAL);
  if (o.star) {
    const S = o.star;
    for (const [x, y, c] of [[0, 3, 2], [-1, 2, 0], [0, 2, 0], [1, 2, 0], [-2, 2, 1], [2, 2, 1], [0, 1, 0], [-1, 0, 0], [1, 0, 0]] as [number, number, number][]) m.set(x - 1, y0 + 2 + y, 8 - (Math.abs(x) > 1 ? 1 : 0), S[c], VF.METAL);
  }
  if (o.feather) {
    const [a, b] = o.feather;
    for (let i = 0; i < 9; i++) m.set(-8 - (i >> 2), y0 + 2 + i, -3 - (i >> 1), i > 6 ? mix(a, 0xffffff, 0.3) : i & 1 ? a : b);
  }
  if (o.bullet) {
    m.del(4, y0 + 4, 6).del(4, y0 + 4, 5);
    m.set(4, y0 + 4, 4, 0x140c08);
    m.set(5, y0 + 4, 6, mulRGB(felt, 0.7));
  }
  return { model: m, top: top + 1 };
}
export function addHat(F: Fig, hat: { model: VoxelModel; top: number }) {
  F.fig.parts['hat'] = { model: hat.model, pivot: [...F.J.hat] as [number, number, number], parent: 'head' };
  F.sock('hat_top', 'hat', [0, hat.top, -1]);
  F.sock('head_top', 'hat', [0, hat.top, -1]);
  return hat.top;
}

// ============================================================================ neckwear (torso)
/** neckerchief: knotted ring around the neck vertebrae, folded triangle over the breastbone */
export function neckerchief(F: Fig, col: number, seed = 0) {
  const s = F.s('torso');
  const C = clothC(col, seed, { fold: 3, crease: mulRGB(col, 0.72), stain: mulRGB(col, 0.85) });
  for (const [y, x0, x1, z0, z1] of [[44, -3, 2, -4, 0], [43, -4, 3, -5, 2]] as number[][])
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (x === x0 || x === x1 || z === z0 || z === z1) s.m.set(x, y, z, res(C, x, y, z));
  // folded triangle (fold creases as darker lines)
  for (const [y, w] of [[42, 4], [41, 3], [40, 2], [39, 1]] as [number, number][])
    for (let x = -w; x < w; x++) s.m.set(x, y, 4, x === -w || x === w - 1 ? mulRGB(col, 0.8) : (x + y) % 3 === 0 ? mulRGB(col, 0.88) : res(C, x, y, 4));
  for (let x = -4; x <= 3; x++) s.m.set(x, 43, 3, res(C, x, 43, 3));
  // knot at the front-left with two short tails
  ell(s, [3.0, 43.5, 2.6], [1.0, 0.9, 0.9], mulRGB(col, 0.9));
  s.m.set(4, 42, 3, mulRGB(col, 0.82)).set(4, 41, 3, mulRGB(col, 0.76)).set(3, 41, 3, mulRGB(col, 0.86));
}

/** bandana mask over the nose and mouth: upper edge on the skull, the rest rides the jaw */
export function maskBandana(F: Fig, col: number, o: { teeth?: boolean; seed?: number } = {}) {
  const C = clothC(col, o.seed ?? 2, { fold: 3, crease: mulRGB(col, 0.74) });
  const h = F.s('head'), j = F.s('jaw');
  for (let y = 49; y <= 51; y++)
    for (let x = -7; x <= 6; x++)
      for (let z = -4; z <= 7; z++) {
        if (!(h.m.has(x, y, z) && isSurf(h.m, x, y, z)) || z < -3) continue;
        // a shell one voxel out from the face and cheeks
        for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0]] as [number, number][]) if (!h.m.has(x + dx, y, z + dz) && (dz > 0 || z > -3)) h.m.set(x + dx, y, z + dz, res(C, x + dx, y, z + dz));
      }
  for (let x = -6; x <= 5; x++) h.m.set(x, 51, 7, mulRGB(col, 0.82)); // top hem
  // the jaw half: covers the chin and hangs to a point below it
  for (let y = 44; y <= 48; y++) for (let x = -6; x <= 5; x++) for (const z of [6, 7]) if (z === 6 || (y <= 46 && Math.abs(x + 0.5) < 5)) j.m.set(x, y, z, res(C, x, y, z));
  for (let y = 44; y <= 48; y++) for (const x of [-6, 5]) for (let z = -1; z <= 5; z++) j.m.set(x, y, z, res(C, x, y, z));
  for (const [y, w] of [[43, 4], [42, 3], [41, 2], [40, 1]] as [number, number][]) for (let x = -w; x < w; x++) j.m.set(x, y, 7, x === -w || x === w - 1 ? mulRGB(col, 0.78) : res(C, x, y, 7));
  if (o.teeth) for (const [x, y] of [[-3, 46], [-1, 46], [1, 46], [-2, 45], [0, 45], [2, 46]] as [number, number][]) j.m.set(x, y, 8, 0xe8dcc0);
}

// ============================================================================ vest / shirt / duster (torso + arms)
/** open leather vest hanging off the rib cage: stitched edges, pockets, buttons, open armholes */
export function vestG(F: Fig, leather: number, o: { buttons?: number[]; seed?: number; long?: boolean } = {}) {
  const s = F.s('torso');
  const L = leatherC(leather, o.seed ?? 4);
  const y0 = o.long ? 29 : 31;
  const sec = (y: number) => ({ a: y >= 37 ? 7.8 : y >= 33 ? 7.5 : 7.2, f: y >= 36 ? 5.0 : 4.7, b: -7.1 });
  const inShell = (x: number, y: number, z: number) => {
    const q = sec(y), zc = (q.f + q.b) / 2, zr = (q.f - q.b) / 2;
    const out = (Math.abs(x) / q.a) ** 2.6 + (Math.abs(z - zc) / zr) ** 2.6 <= 1;
    const inn = (Math.abs(x) / (q.a - 1)) ** 2.6 + (Math.abs(z - zc) / (zr - 1)) ** 2.6 <= 1;
    return out && !inn;
  };
  for (let y = y0; y <= 43; y++)
    for (let x = -9; x < 9; x++)
      for (let z = -9; z <= 7; z++) {
        const gx = x + 0.5, gy = y + 0.5, gz = z + 0.5;
        if (!inShell(gx, gy, gz)) continue;
        if (gz > 1.5 && Math.abs(gx) < 2.6) continue; // open front
        if (y >= 41 && gz > 0 && Math.abs(gx) < 3.6 + (y - 41)) continue; // V neckline
        if (y >= 38 && Math.abs(gx) > 6.3 && gz > -3.5 && gz < 2.5) continue; // armholes
        s.m.set(x, y, z, res(L, x, y, z));
      }
  // shoulder seams over the clavicles + back collar
  for (const sx of [1, -1]) for (let x = 3; x <= 6; x++) for (let z = -6; z <= 3; z++) s.m.set(sx > 0 ? x : -1 - x, 44, z, res(L, x, 44, z));
  for (let x = -3; x <= 2; x++) s.m.set(x, 44, -6, mulRGB(leather, 0.9)).set(x, 45, -6, mulRGB(leather, 0.82));
  // stitched front edges, pockets with flaps, buttons
  for (let y = y0; y <= 42; y++)
    for (const sx of [1, -1]) {
      const x = sx > 0 ? 2 : -3;
      const z = Math.floor(sec(y).f - 0.5);
      if (s.m.has(x, y, z)) s.m.set(x, y, z, mix(leather, 0x1a0e08, 0.3));
      if ((y & 1) === 0 && s.m.has(x + sx, y, z)) s.m.set(x + sx, y, z, mix(leather, 0xe0c890, 0.35));
    }
  for (const sx of [1, -1])
    for (let x = 4; x <= 6; x++) {
      const X = sx > 0 ? x : -1 - x;
      s.m.set(X, 36, 5, mulRGB(leather, 0.78)).set(X, 35, 5, mulRGB(leather, 0.9));
    }
  const B = o.buttons ?? METAL.brass;
  for (const y of [33, 36, 39]) s.m.set(-4, y, 5, B[0], VF.METAL);
  s.m.set(-5, 36, 6, B[2], VF.METAL);
  // hem
  for (let x = -9; x < 9; x++) for (let z = -9; z <= 7; z++) if (s.m.has(x, y0, z) && (s.m.get(x, y0, z)! & 0xffffff) !== 0) {
    const c = s.m.get(x, y0, z)! & 0xffffff;
    if (Math.abs(x + 0.5) > 2 || z < 2) s.m.set(x, y0, z, mulRGB(c, 0.85));
  }
}

/** sleeve tube around the upper arm (LEFT coords mirrored by side) */
export function sleeveG(F: Fig, side: number, col: CSpec, o: { fore?: boolean; cuff?: number; y0?: number } = {}) {
  const X = (x: number) => side * x;
  const a = F.s(side > 0 ? 'arm_l' : 'arm_r');
  ell(a, [X(8.5), 41.6, 0.0], [2.3, 2.4, 2.3], col);
  for (let y = 34; y <= 41; y++) ell(a, [X(8.5), y + 0.5, 0.0], [1.95, 0.6, 1.95], col);
  if (o.fore !== false) {
    const f = F.s(side > 0 ? 'fore_l' : 'fore_r');
    const y0 = o.y0 ?? 26;
    for (let y = y0; y <= 32; y++) ell(f, [X(8.6), y + 0.5, -0.1], [y < y0 + 1.5 ? 2.15 : 1.9, 0.6, y < y0 + 1.5 ? 2.0 : 1.8], y === y0 && o.cuff !== undefined ? o.cuff : col);
  }
}

/** linen shirt under a coat: a thin shell on the rib cage with an open collar */
export function shirtG(F: Fig, col: number, seed = 0) {
  const s = F.s('torso');
  const C = clothC(col, seed, { fold: 3 });
  for (let y = 30; y <= 43; y++)
    for (let x = -8; x < 8; x++)
      for (let z = -8; z <= 6; z++) {
        const gx = x + 0.5, gz = z + 0.5;
        const a = y >= 37 ? 7.3 : 6.9, f = y >= 36 ? 4.4 : 4.0, b = -6.6;
        const zc = (f + b) / 2, zr = (f - b) / 2;
        const out = (Math.abs(gx) / a) ** 2.4 + (Math.abs(gz - zc) / zr) ** 2.4 <= 1;
        const inn = (Math.abs(gx) / (a - 1)) ** 2.4 + (Math.abs(gz - zc) / (zr - 1)) ** 2.4 <= 1;
        if (!out || inn) continue;
        if (y >= 38 && gz > 1 && Math.abs(gx) < 1.5 + (y - 38) * 0.6) continue; // open collar
        s.m.set(x, y, z, res(C, x, y, z));
      }
  for (let y = 31; y <= 37; y += 3) s.m.set(-1, y, 4, 0xe8dcc0);
}

/** stiff duster: shoulders, back, side panels and lapels on the torso; long tails as the swaying `coat` part */
export function dusterG(F: Fig, col: number, trim: number, o: { seed?: number; len?: number } = {}) {
  const s = F.s('torso');
  const C = clothC(col, o.seed ?? 6, { fold: 4, crease: mulRGB(col, 0.78), stain: mix(col, 0x3a2a1a, 0.25) });
  for (let y = 29; y <= 44; y++)
    for (let x = -10; x < 10; x++)
      for (let z = -9; z <= 7; z++) {
        const gx = x + 0.5, gz = z + 0.5;
        const a = y >= 42 ? 8.9 - (y - 42) * 1.0 : y >= 36 ? 8.4 : 8.0, f = 5.3, b = -7.6;
        const zc = (f + b) / 2, zr = (f - b) / 2;
        const out = (Math.abs(gx) / a) ** 2.6 + (Math.abs(gz - zc) / zr) ** 2.6 <= 1;
        const inn = (Math.abs(gx) / (a - 1.05)) ** 2.6 + (Math.abs(gz - zc) / (zr - 1.05)) ** 2.6 <= 1;
        if (!out || (inn && y < 44)) continue;
        if (gz > 1.0 && Math.abs(gx) < 3.4 + Math.max(0, y - 38) * 0.35) continue; // open front
        if (y === 44 && Math.abs(gx) < 3.2 && gz > -5) continue; // neck
        s.m.set(x, y, z, res(C, x, y, z));
      }
  // turned lapels + stand-up collar
  for (let y = 36; y <= 43; y++) for (const sx of [1, -1]) s.m.set(sx > 0 ? 3 : -4, y, 6, mix(trim, col, 0.3)).set(sx > 0 ? 4 : -5, y, 6, y > 39 ? trim : mulRGB(col, 0.9));
  for (let x = -4; x <= 3; x++) s.m.set(x, 45, -6, mulRGB(col, 0.85)).set(x, 46, -6, mulRGB(col, 0.78));
  // back yoke seam
  for (let x = -7; x <= 6; x++) if (s.m.has(x, 41, -8)) s.m.set(x, 41, -8, mulRGB(col, 0.82));
  // coat tails
  const cp = F.part('coat', 'pelvis', [0, 29.5, -6.5]);
  const yBot = 29 - (o.len ?? 14);
  for (let y = yBot; y <= 29; y++)
    for (let x = -11; x < 11; x++)
      for (let z = -10; z <= 5; z++) {
        const gx = x + 0.5, gz = z + 0.5;
        const t = (29 - y) / (29 - yBot);
        const a = 8.4 + t * 2.0, f = 4.6, b = -7.6 - t * 1.6;
        const zc = (f + b) / 2, zr = (f - b) / 2;
        const out = (Math.abs(gx) / a) ** 2.6 + (Math.abs(gz - zc) / zr) ** 2.6 <= 1;
        const inn = (Math.abs(gx) / (a - 1)) ** 2.6 + (Math.abs(gz - zc) / (zr - 1)) ** 2.6 <= 1;
        if (!out || inn) continue;
        if (gz > -1.0) continue; // open front: only the back and sides hang as tails
        if (y < yBot + 7 && Math.abs(gx) < 0.9) continue; // back vent
        cp.m.set(x, y, z, y === yBot ? mulRGB(res(C, x, y, z), 0.8) : res(C, x, y, z));
      }
  return cp;
}

/** diagonal bandolier from the left shoulder to the right hip, brass rounds in the loops */
export function bandolierG(F: Fig, leather: number, round = METAL.brass) {
  const s = F.s('torso');
  for (let y = 30; y <= 43; y++) {
    const x = Math.round(6 - (43 - y) * 0.95);
    for (let dx = 0; dx <= 1; dx++) {
      const X = x - dx;
      const z = frontZ(s.m, X, y) + 1;
      s.m.set(X, y, z, mulRGB(leather, dx ? 0.85 : 1));
      if (dx === 0 && (y & 1) === 0) s.m.set(X, y, z + 1, round[0], VF.METAL);
    }
  }
}
export function frontZ(m: VoxelModel, x: number, y: number) {
  for (let z = 16; z >= -16; z--) if (m.has(x, y, z)) return z;
  return 0;
}

// ============================================================================ belts (pelvis)
/** gun belt on the hip bones: cartridge loops, a buckle, an (empty) holster on the right hip */
export function gunBeltG(F: Fig, leather: number, buckle: number[], o: { loops?: boolean; holster?: boolean; y?: number; seed?: number } = {}) {
  const s = F.s('pelvis');
  const L = leatherC(leather, o.seed ?? 8);
  const y0 = o.y ?? 25;
  for (let y = y0; y <= y0 + 1; y++)
    for (let x = -9; x < 9; x++)
      for (let z = -8; z <= 4; z++) {
        const gx = x + 0.5, gz = z + 0.5;
        const a = 7.9, f = 3.7, b = -6.9;
        const zc = (f + b) / 2, zr = (f - b) / 2;
        const out = (Math.abs(gx) / a) ** 3 + (Math.abs(gz - zc) / zr) ** 3 <= 1;
        const inn = (Math.abs(gx) / (a - 1)) ** 3 + (Math.abs(gz - zc) / (zr - 1)) ** 3 <= 1;
        if (out && !inn) s.m.set(x, y, z, y === y0 ? mulRGB(res(L, x, y, z), 0.88) : res(L, x, y, z));
      }
  // buckle: a frame with a dark centre and a tongue
  for (let x = -2; x <= 1; x++) for (let y = y0 - 1; y <= y0 + 2; y++) {
    const edge = x === -2 || x === 1 || y === y0 - 1 || y === y0 + 2;
    s.m.set(x, y, 4, edge ? buckle[0] : mulRGB(leather, 0.7), edge ? VF.METAL : VF.SOLID);
  }
  s.m.set(-1, y0 + 1, 5, buckle[2], VF.METAL).set(0, y0, 4, buckle[1], VF.METAL);
  if (o.loops !== false)
    for (const [x, z] of [[2, 4], [4, 3], [6, 2], [7, 0], [7, -2], [7, -4], [5, -6], [3, -7], [-4, -7], [-6, -6]] as [number, number][]) {
      const X = x, Z = z + (x >= 7 ? 0 : 1);
      const px = x >= 7 ? X + 1 : X, pz = x >= 7 ? z : Z;
      s.m.set(px, y0 + 1, pz, METAL.brass[0], VF.METAL).set(px, y0, pz, METAL.brass[1], VF.METAL);
    }
  if (o.holster !== false) {
    const H = leatherC(mulRGB(leather, 0.92), 5);
    for (let y = 15; y <= y0 - 1; y++)
      for (let x = -11; x <= -9; x++)
        for (let z = -2; z <= 1; z++) {
          const narrow = y < 18 && (x === -11 || z === 1);
          if (narrow) continue;
          s.m.set(x, y, z, y === y0 - 1 ? mulRGB(leather, 0.75) : res(H, x, y, z));
        }
    for (let y = 16; y <= 22; y += 2) s.m.set(-12, y, -1, mix(leather, 0xe0c890, 0.3)); // stitched welt
    s.m.set(-11, 20, 2, METAL.silver[0], VF.METAL); // concho
    lineG(s, [[-10, 24.5, -1.5], [-9, 25.5, -2.5]], mulRGB(leather, 0.8));
  }
}

// ============================================================================ boots (shins)
/** cowboy boot around the shin bone: pointed toe, stacked heel, stitched shaft, cuff, pull tabs, spur */
export function bootG(F: Fig, side: number, leather: number, o: { spur?: number[] | null; sole?: number; top?: number; seed?: number; stitch?: number } = {}) {
  const name = side > 0 ? 'shin_l' : 'shin_r';
  const s = F.s(name);
  const X = (x: number) => (side > 0 ? x : -1 - x); // voxel index mirror
  const L = leatherC(leather, (o.seed ?? 2) + (side > 0 ? 0 : 5));
  const sole = o.sole ?? 0x2a1a10;
  const top = o.top ?? 10;
  // the boot replaces the bone foot and wraps the lower shin
  cutG(s, (x, y) => y < 5);
  // sole + stacked heel (arch gap under the instep)
  for (let z = -3; z <= 5; z++)
    for (let x = 2; x <= 5; x++) {
      if (z === 5 && (x === 2 || x === 5)) continue;
      if (z === 4 && (x === 2 || x === 5) && false) continue;
      if (z === 0) continue;
      s.m.set(X(x), 0, z, z < 0 ? mulRGB(sole, 1.25) : sole);
    }
  for (let z = -3; z <= -1; z++) for (let x = 2; x <= 5; x++) s.m.set(X(x), 1, z, mulRGB(sole, 1.4));
  // vamp + toe box
  for (let z = -3; z <= 4; z++)
    for (let x = 2; x <= 5; x++) {
      if (z === 4 && (x === 2 || x === 5)) continue;
      s.m.set(X(x), z < 0 ? 2 : 1, z, res(L, X(x), 1, z));
      if (z <= 3 && !(z === 3 && (x === 2 || x === 5))) s.m.set(X(x), 2, z, res(L, X(x), 2, z));
    }
  s.m.set(X(3), 1, 5, res(L, X(3), 1, 5)).set(X(4), 1, 5, res(L, X(4), 1, 5));
  for (let z = -3; z <= 1; z++) for (let x = 2; x <= 5; x++) s.m.set(X(x), 3, z, res(L, X(x), 3, z));
  // shaft (slight flare at the top)
  for (let y = 3; y <= top; y++) {
    const fl = y >= top - 1 ? 0.35 : 0;
    for (let x = 1; x <= 6; x++)
      for (let z = -4; z <= 3; z++) {
        const u = Math.abs(x + 0.5 - 3.8) / (2.05 + fl), v = Math.abs(z + 0.5 + 0.2) / (2.1 + fl);
        if (u ** 2.6 + v ** 2.6 > 1) continue;
        s.m.set(X(x), y, z, y === top ? mix(leather, 0xffffff, 0.08) : res(L, X(x), y, z));
      }
  }
  // pull tabs, decorative stitch on the shaft front, welt stitching
  s.m.set(X(2), top + 1, 0, mulRGB(leather, 0.8)).set(X(5), top + 1, -1, mulRGB(leather, 0.8));
  const st = o.stitch ?? mix(leather, 0xe8d0a0, 0.55);
  for (const [x, y] of [[3, 5], [4, 5], [3, 7], [4, 7], [2, 6], [5, 6], [3, 9], [4, 9]] as [number, number][]) {
    const z = frontZ(s.m, X(x), y);
    if (z >= 1) s.m.set(X(x), y, z, st);
  }
  for (let z = -2; z <= 4; z += 2) for (const x of [2, 5]) if (s.m.has(X(x), 1, z)) s.m.set(X(x), 1, z, mix(leather, 0xe8d0a0, 0.3));
  if (o.spur !== null) {
    const S = o.spur ?? METAL.silver;
    for (const x of [1, 6]) for (let z = -3; z <= 1; z++) if (z === -3 || z === 1) s.m.set(X(x), 2, z, 0x2a1a10);
    s.m.set(X(3), 2, -4, S[1], VF.METAL).set(X(4), 2, -4, S[1], VF.METAL);
    const cz = -6, cy = 2;
    for (const [dy, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][])
      s.m.set(X(3), cy + dy, cz + dz, Math.abs(dy) === 2 || dz === -2 ? S[2] : S[0], VF.METAL);
  }
}

// ============================================================================ weapons (right fist, rest pose: barrel along -Y, top toward +Z)
/** single-action revolver held in the right fist (part `gun`, pivot = hand_r). Returns the muzzle point. */
export function revolverG(F: Fig, o: { long?: boolean; metal?: number[]; grip?: number; name?: string; side?: number } = {}): G {
  const side = o.side ?? -1;
  const name = o.name ?? 'gun';
  const hand = side < 0 ? F.J.hand_r : F.J.hand;
  const s = F.part(name, side < 0 ? 'fore_r' : 'fore_l', hand);
  const M = o.metal ?? METAL.iron;
  const grip = o.grip ?? 0x6a4226;
  const xa = side < 0 ? -10 : 8, xb = xa + 1;
  // grip: from inside the fist out the back of the hand (butt behind the knuckles)
  for (const [y, z] of [[21, 0], [21, -1], [22, -1], [22, -2], [23, -2], [22, -3], [23, -3]] as [number, number][]) for (const x of [xa, xb]) s.m.set(x, y, z, (y + z) & 1 ? grip : mulRGB(grip, 0.82));
  s.m.set(xa, 22, -4, M[1], VF.METAL).set(xb, 22, -4, M[1], VF.METAL); // butt cap
  // frame, hammer, trigger guard
  for (let y = 18; y <= 20; y++) for (const x of [xa, xb]) for (let z = 0; z <= 1; z++) s.m.set(x, y, z, M[1], VF.METAL);
  s.m.set(xa, 19, 2, M[2], VF.METAL).set(xb, 19, 2, M[1], VF.METAL); // hammer spur, just under the knuckles
  s.m.set(xa, 18, -1, M[0], VF.METAL).set(xa, 17, -1, M[0], VF.METAL).set(xb, 18, -1, M[0], VF.METAL);
  // cylinder (fluted)
  for (let y = 15; y <= 17; y++) for (const x of [xa, xb]) for (let z = 0; z <= 1; z++) s.m.set(x, y, z, y === 16 ? M[2] : M[0], VF.METAL);
  // barrel + ejector housing + front sight
  const bot = o.long ? 6 : 10;
  for (let y = bot; y <= 14; y++) {
    for (const x of [xa, xb]) s.m.set(x, y, 1, y % 4 === 0 ? M[2] : M[0], VF.METAL);
    if (y >= 11) s.m.set(xa, y, 0, M[1], VF.METAL);
  }
  s.m.set(xa, bot, 2, M[2], VF.METAL);
  s.m.set(xa, bot - 1, 1, 0x0c0806).set(xb, bot - 1, 1, 0x0c0806); // bore
  const muzzle: G = [side < 0 ? -9 : 9, bot - 0.5, 1.5];
  F.sock(name === 'gun' ? 'muzzle' : name + '_muzzle', name, muzzle);
  return muzzle;
}

// ============================================================================ sandboard (root-level `board`)
export function boardG(F: Fig, wood: number, trim: number, stripe: number, o: { gold?: boolean; seed?: number } = {}) {
  const s = F.part('board', undefined, [0, 1, 0]);
  const W = tones(mulRGB(wood, 0.86), wood, mix(wood, 0xffffff, 0.08), 3.5, o.seed ?? 4);
  for (let z = -25; z <= 24; z++) {
    const az = Math.abs(z + 0.5);
    const w = az > 21 ? 6 - Math.round((az - 21) * 0.9) : 6;
    const lift = az > 18 ? Math.min(3, Math.round((az - 18) * 0.6)) : 0;
    for (let x = -w; x < w; x++) {
      const edge = x === -w || x === w - 1;
      const plank = ((x + 6) >> 2) & 1;
      const c = Math.abs(x + 0.5) < 1.6 && az < 17 ? stripe : plank ? mulRGB(res(W, x, 0, z), 0.94) : res(W, x, 0, z);
      s.m.set(x, lift, z, edge ? mulRGB(wood, 0.78) : mulRGB(c, 0.9));
      s.m.set(x, lift + 1, z, az > 24 || edge ? trim : c, (az > 24 || edge) && o.gold ? VF.METAL : VF.SOLID);
    }
  }
  for (const zb of [-14, 13]) for (let x = -6; x < 6; x++) s.m.set(x, 2, zb, METAL.iron[0], VF.METAL);
  for (const zf of [-7, 6]) for (let x = -5; x < 5; x++) if (Math.abs(x + 0.5) >= 3) s.m.set(x, 2, zf, 0x3a2414).set(x, 2, zf + 1, 0x3a2414);
  return s;
}

export { res as resolveC };
void sections;
void coatG;
void wrapShell;
void frayStrip;
void hash3;
