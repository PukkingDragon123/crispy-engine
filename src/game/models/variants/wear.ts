// Wearables + props for humanoid variants, authored in the toon kit's rig space
// (1/30 m, origin on the ground, faces +Z, mirror plane = column 0: x -> -x).
// Clean shapes, small palettes, deliberate details — STYLE v2.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { roundBox, roundBoxX, autoShade } from '../toon/humanoid';

export const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
export const W = {
  felt: ramp(0x3c3434, 0x2c2626, 0x544a48, 0x1a1616),
  feltBrown: ramp(0x7a5236, 0x5e3e28, 0x96684a, 0x3e2818),
  feltPink: ramp(0xd8607a, 0xb04660, 0xf08aa0, 0x7a2a3e),
  helmet: ramp(0xf0b830, 0xc89020, 0xffd870, 0x8a5e10),
  straw: ramp(0xe8c47a, 0xc9a25a, 0xf8dc9c, 0x9a7a3a),
  weed: ramp(0xc9a46a, 0xa8844c, 0xe2c48c, 0x7a5c30),
  yarn: ramp(0xe0782e, 0xb85a1e, 0xf89a52, 0x7a3410),
  stick: ramp(0xd8402e, 0xae2c20, 0xf06a50, 0x6e1810),
  tape: ramp(0x3a3230, 0x2a2422, 0x4c4240, 0x161210),
  mustache: ramp(0x2a2220, 0x1c1614, 0x3e3430, 0x100c0a),
  greyStache: ramp(0xb8b0a6, 0x948c82, 0xd4ccc2, 0x6a645c),
  charro: ramp(0x2c2a32, 0x1e1c24, 0x403e48, 0x121016),
  barrel: ramp(0xb07a46, 0x8c5e34, 0xc89460, 0x5e3c1e),
  rope: ramp(0xd8bc84, 0xb49a64, 0xeed6a2, 0x86704a),
};

/** set a voxel and its mirror */
export function both(m: VoxelModel, x: number, y: number, z: number, c: number, f?: number) {
  m.set(x, y, z, c, f);
  m.set(-x, y, z, c, f);
  return m;
}
/** recolour existing voxels in a box */
export function paint(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, f?: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (m.has(x, y, z)) m.set(x, y, z, c, f ?? (m.get(x, y, z)! >>> 24));
  return m;
}
export function paintIf(m: VoxelModel, pred: (x: number, y: number, z: number, rgb: number) => boolean, c: number, f?: number) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, fl) => pred(x, y, z, rgb) && hits.push([x, y, z, f ?? fl]));
  for (const [x, y, z, fl] of hits) m.set(x, y, z, c, fl);
  return m;
}
export function carve(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) m.del(x, y, z);
  return m;
}
/** voxel ball; centre in index space (cx = 0 is the mirror plane), voxel centres at integer indices */
export function ball(m: VoxelModel, cx: number, cy: number, cz: number, r: number, c: number, f?: number, sy = 1) {
  const R = Math.ceil(r + 1);
  for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
    for (let y = Math.floor(cy - R * sy); y <= Math.ceil(cy + R * sy); y++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
        const dx = x - cx, dy = (y - cy) / sy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz <= r * r) m.set(x, y, z, c, f);
      }
  return m;
}
/** polyline of chunky voxels (radius 0 = single voxels, 0.5 = 2x2-ish) */
export function line(m: VoxelModel, pts: [number, number, number][], c: number | ((t: number) => number), rad = 0, f?: number) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len * 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const col = typeof c === 'number' ? c : c((acc + len * t) / (total || 1));
      if (rad <= 0) m.set(Math.round(x), Math.round(y), Math.round(z), col, f);
      else
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) if (Math.hypot(dx, dy, dz) <= rad + 0.01) m.set(Math.round(x + dx), Math.round(y + dy), Math.round(z + dz), col, f);
    }
    acc += len;
  }
  return m;
}
/** ring (torus) of radius r around centre c with unit normal n; tube thickness th */
export function ring(m: VoxelModel, c: [number, number, number], n: [number, number, number], r: number, th: number, col: number | ((x: number, y: number, z: number) => number), f?: number) {
  const nl = Math.hypot(n[0], n[1], n[2]);
  const N = [n[0] / nl, n[1] / nl, n[2] / nl];
  const R = Math.ceil(r + th + 1);
  for (let x = Math.floor(c[0] - R); x <= Math.ceil(c[0] + R); x++)
    for (let y = Math.floor(c[1] - R); y <= Math.ceil(c[1] + R); y++)
      for (let z = Math.floor(c[2] - R); z <= Math.ceil(c[2] + R); z++) {
        const px = x - c[0], py = y - c[1], pz = z - c[2];
        const h = px * N[0] + py * N[1] + pz * N[2];
        const qx = px - h * N[0], qy = py - h * N[1], qz = pz - h * N[2];
        const d = Math.hypot(Math.hypot(qx, qy, qz) - r, h);
        if (d <= th) m.set(x, y, z, typeof col === 'number' ? col : col(x, y, z), f);
      }
  return m;
}

// ================================================================== HATS (part 'hat', joint [0.5, 48, 0])
/** oval brim around the skull at y; `curl` raises the outer sides */
function brim(m: VoxelModel, y: number, rx: number, rz: number, R: Ramp, curl = 0, zOff = 0) {
  for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++)
    for (let z = -Math.ceil(rz) - 1; z <= Math.ceil(rz) + 1; z++) {
      const e = (x * x) / (rx * rx) + ((z - zOff) * (z - zOff)) / (rz * rz);
      if (e > 1) continue;
      const ax = Math.abs(x);
      const yy = curl > 0 && ax >= rx - 1.5 ? y + curl : curl > 0 && ax >= rx - 3.5 ? y + Math.max(0, curl - 1) : y;
      m.set(x, yy, z, e > 0.82 ? R.shade : R.base);
      if (yy > y) m.set(x, yy - 1, z, R.shade);
    }
}
/** rounded crown block */
function crown(m: VoxelModel, y0: number, y1: number, hx: number, zb: number, zf: number, R: Ramp, cut = 2, topCut = 3) {
  for (let y = y0; y <= y1; y++) {
    const top = y === y1;
    const h = top ? hx - 1 : hx, b = top ? zb + 1 : zb, f = top ? zf - 1 : zf, c = top ? topCut : cut;
    for (let x = -h; x <= h; x++)
      for (let z = b; z <= f; z++) {
        const dx = h - Math.abs(x), dz = Math.min(z - b, f - z);
        if (dx + dz < c) continue;
        m.set(x, y, z, R.base);
      }
  }
}
/** hat band: recolour the crown's outer wall on rows y0..y1 */
function band(m: VoxelModel, y0: number, y1: number, c: number, hx: number, zb: number, zf: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = -hx - 1; x <= hx + 1; x++)
      for (let z = zb - 1; z <= zf + 1; z++) {
        if (!m.has(x, y, z)) continue;
        const outer = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
        if (outer) m.set(x, y, z, c);
      }
}

/** flat-crowned outlaw hat (low wide brim) */
export function flatHat(R: Ramp, bandCol: number, o: { rx?: number; rz?: number; crownH?: number } = {}) {
  const m = new VoxelModel('hat');
  brim(m, 48, o.rx ?? 13, o.rz ?? 12, R, 1);
  const top = 49 + (o.crownH ?? 5);
  crown(m, 49, top, 8, -8, 7, R, 2, 3);
  band(m, 49, 50, bandCol, 8, -8, 7);
  autoShade(m, [R]);
  return m;
}
/** cowboy hat with pinched crown + centre crease */
export function cowHat(R: Ramp, bandCol: number) {
  const m = new VoxelModel('hat');
  brim(m, 48, 12.6, 11.4, R, 2);
  crown(m, 49, 55, 8, -8, 7, R, 3, 4);
  for (let z = -6; z <= 5; z++) m.del(0, 55, z);
  for (const s of [1, -1]) for (const [x, y, z] of [[3, 55, 5], [4, 55, 4], [4, 54, 6], [5, 54, 5]] as [number, number, number][]) m.del(s * x, y, z);
  band(m, 49, 50, bandCol, 8, -8, 7);
  autoShade(m, [R]);
  return m;
}
/** bowler / derby */
export function bowler(R: Ramp, bandCol: number) {
  const m = new VoxelModel('hat');
  brim(m, 48, 10.4, 9.6, R, 1);
  for (let y = 49; y <= 56; y++) {
    const rr = y <= 52 ? 8.4 : 8.4 - (y - 52) * (y - 52) * 0.42;
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (x * x + (z + 0.5) * (z + 0.5) <= rr * rr) m.set(x, y, z, R.base);
  }
  band(m, 49, 50, bandCol, 8, -9, 8);
  autoShade(m, [R]);
  return m;
}
/** big sombrero: wide upturned brim, cone crown, embroidered trim */
export function sombreroHat(R: Ramp, trim: Ramp, r = 16) {
  const m = new VoxelModel('hat');
  for (let x = -r - 1; x <= r + 1; x++)
    for (let z = -r - 1; z <= r + 1; z++) {
      const d = Math.hypot(x, z);
      if (d > r + 0.3) continue;
      const y = d > r - 1.6 ? 51 : d > r - 3.2 ? 50 : d > r - 5 ? 49 : 48;
      m.set(x, y, z, d > r - 1.6 ? trim.base : R.base);
      for (let yy = 48; yy < y; yy++) if (d > r - 3.2) m.set(x, yy, z, R.shade);
    }
  for (let y = 49; y <= 60; y++) {
    const rr = y <= 51 ? 8.6 : 8.6 - (y - 51) * 0.6;
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (x * x + z * z <= rr * rr) m.set(x, y, z, y >= 59 ? R.hi : R.base);
  }
  band(m, 49, 51, trim.base, 9, -9, 9);
  // embroidered dots around the crown
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    const x = Math.round(Math.sin(t) * 9), z = Math.round(Math.cos(t) * 9);
    if (m.has(x, 52, z)) m.set(x, 52, z, trim.hi);
  }
  autoShade(m, [R], { hi: false });
  return m;
}
/** miner's helmet with a brass lamp: three clean terraces + lip + visor */
export function minerHelmet(R: Ramp) {
  const m = new VoxelModel('hat');
  roundBox(m, -9, 46, -9, 9, 46, 8, R.shade, 2);
  roundBox(m, -8, 47, -8, 8, 50, 7, R.base, 2);
  roundBox(m, -7, 51, -7, 7, 52, 6, R.base, 2);
  roundBox(m, -5, 53, -5, 5, 53, 4, R.base, 2);
  // visor
  for (let x = -6; x <= 6; x++) for (let z = 9; z <= 10; z++) if (Math.abs(x) <= (z === 10 ? 4 : 6)) m.set(x, 46, z, R.shade);
  // centre ridge strip
  for (let z = -6; z <= 5; z++) m.set(0, z >= -4 && z <= 3 ? 54 : 53, z, R.hi);
  // lamp
  roundBox(m, -2, 48, 8, 2, 51, 9, TOON.brass.base, 1, VF.METAL);
  roundBox(m, -1, 49, 10, 1, 50, 10, 0xfff3c0, 0);
  m.set(-1, 50, 10, 0xffffff);
  autoShade(m, [R]);
  return m;
}

// ================================================================== CLOTHES
/** shirt/jacket shell over the rib cage (pivot waist). openFront = half-width of the opening */
export function jacket(m: VoxelModel, C: Ramp, o: { y0?: number; y1?: number; openFront?: number; sleeveless?: boolean; hem?: number; tatter?: boolean } = {}) {
  const y0 = o.y0 ?? 24, y1 = o.y1 ?? 33;
  for (let y = y0; y <= y1; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -6; z <= 4; z++) {
        const shell = Math.abs(x) === 7 || z === -6 || z === 4;
        if (!shell) continue;
        if (Math.abs(x) === 7 && (z === -6 || z === 4)) continue;
        if (o.openFront && z === 4 && Math.abs(x) < o.openFront) continue;
        if (o.tatter && y === y0 && ((x * 7 + z * 3) & 3) === 0) continue;
        m.set(x, y, z, y === y0 && o.hem !== undefined ? o.hem : C.base);
      }
  // shoulders
  for (let x = -6; x <= 6; x++) for (let z = -5; z <= 3; z++) if (Math.abs(x) >= 3) m.set(x, y1 + 1, z, C.base);
  return m;
}
/** trousers block around the pelvis (pivot pelvis) */
export function trousersTop(m: VoxelModel, C: Ramp, beltCol?: number) {
  for (let y = 17; y <= 23; y++)
    for (let x = -6; x <= 6; x++)
      for (let z = -4; z <= 3; z++) {
        const shell = Math.abs(x) === 6 || z === -4 || z === 3 || y === 17;
        if (!shell) continue;
        if (Math.abs(x) === 6 && (z === -4 || z === 3)) continue;
        if (y === 17 && Math.abs(x) <= 1) continue; // crotch gap
        m.set(x, y, z, y === 23 && beltCol !== undefined ? beltCol : C.base);
      }
  return m;
}
/** clothing sheath on a limb segment (LEFT coords) with optional cuff colour on the lowest row */
export function sheath(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, C: Ramp, cuff?: number) {
  roundBox(m, x0, y0, z0, x1, y1, z1, C.base, 1);
  if (cuff !== undefined) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (m.has(x, y0, z)) m.set(x, y0, z, cuff);
  return m;
}
/** bandana triangle over the lower face (on the jaw part) */
export function maskBandana(jaw: VoxelModel, C: Ramp) {
  for (let y = 33; y <= 38; y++) {
    const hw = y >= 36 ? 6 : y === 35 ? 4 : y === 34 ? 2 : 1;
    for (let x = -hw; x <= hw; x++) {
      jaw.set(x, y, 7, (x + y) % 4 === 0 ? C.hi : C.base);
      if (y >= 36) for (let z = -2; z <= 6; z++) if (Math.abs(x) === hw) jaw.set(x, y, z, C.base);
    }
  }
  return jaw;
}

// ================================================================== WEAPONS (rest pose: barrel along -Y from the fist)
/** revolver for a right fist at hand joint (-7.5, 16.5, 0.5) */
export function revolverDown(hx = -8, metal: Ramp = TOON.iron, grip: Ramp = TOON.wood) {
  const m = new VoxelModel('gun');
  // grip inside/behind the fist
  roundBox(m, hx, 13, -3, hx + 1, 16, -1, grip.base, 0);
  // frame + cylinder
  roundBox(m, hx, 9, -1, hx + 1, 12, 2, metal.base, 0, VF.METAL);
  roundBox(m, hx - 1, 9, 0, hx + 2, 11, 2, metal.shade, 1, VF.METAL);
  // barrel
  for (let y = 2; y <= 8; y++) for (let x = hx; x <= hx + 1; x++) m.set(x, y, 1, metal.base, VF.METAL), m.set(x, y, 2, metal.hi, VF.METAL);
  m.set(hx, 1, 1, TOON.black.base).set(hx + 1, 1, 1, TOON.black.base);
  // front sight (local +z = up when aiming)
  m.set(hx, 2, 3, metal.hi, VF.METAL);
  return m;
}
/** long scoped rifle */
export function rifleDown(hx = -8, gold = false) {
  const m = new VoxelModel('gun');
  const I = TOON.iron, Wd = TOON.wood, Sc = gold ? TOON.gold : TOON.brass;
  // stock behind the forearm (local -z), up along the arm
  roundBox(m, hx, 17, -4, hx + 1, 25, -2, Wd.base, 1);
  roundBox(m, hx, 25, -5, hx + 1, 27, -2, Wd.shade, 1);
  m.set(hx, 27, -5, Wd.dark).set(hx + 1, 27, -5, Wd.dark);
  // grip + receiver inside the fist
  roundBox(m, hx, 12, -2, hx + 1, 17, 0, Wd.shade, 0);
  roundBox(m, hx, 8, -1, hx + 1, 12, 1, I.base, 0, VF.METAL);
  // fore-stock + long barrel
  roundBox(m, hx, 0, -1, hx + 1, 8, 0, Wd.base, 0);
  for (let y = -14; y <= 7; y++) for (let x = hx; x <= hx + 1; x++) m.set(x, y, 1, y % 6 === 0 ? I.hi : I.base, VF.METAL);
  m.set(hx, -15, 1, TOON.black.base).set(hx + 1, -15, 1, TOON.black.base);
  // scope on top (local +z)
  for (let y = 4; y <= 13; y++) for (let x = hx; x <= hx + 1; x++) m.set(x, y, 3, Sc.base, VF.METAL);
  for (let x = hx; x <= hx + 1; x++) {
    m.set(x, 3, 3, Sc.hi, VF.METAL).set(x, 14, 3, Sc.hi, VF.METAL).set(x, 7, 2, I.shade, VF.METAL).set(x, 11, 2, I.shade, VF.METAL);
  }
  m.set(hx, 3, 4, 0xbfe6ff).set(hx + 1, 3, 4, 0x8ac0e8);
  return m;
}
/** chunky double-barrel shotgun */
export function shotgunDown(hx = -9, triple = false) {
  const m = new VoxelModel('gun');
  const I = TOON.iron, Wd = TOON.wood;
  roundBox(m, hx + 1, 17, -4, hx + 2, 22, -2, Wd.base, 1);
  roundBox(m, hx + 1, 12, -2, hx + 2, 17, 0, Wd.shade, 0);
  roundBox(m, hx, 7, -1, hx + 3, 12, 1, I.shade, 1, VF.METAL);
  const n = triple ? 3 : 2;
  for (let b = 0; b < n; b++) {
    const bx = hx + (triple ? b * 1.5 : b * 2);
    for (let y = -1; y <= 7; y++) for (let x = Math.floor(bx); x <= Math.floor(bx) + 1; x++) m.set(x, y, 0, I.base, VF.METAL), m.set(x, y, 1, I.hi, VF.METAL);
    for (let x = Math.floor(bx); x <= Math.floor(bx) + 1; x++) m.set(x, -2, 0, TOON.black.base);
  }
  roundBox(m, hx, 2, -1, hx + 3, 6, -1, Wd.base, 0);
  return m;
}

/** dynamite bundle (sticks + tape) in front of the chest; returns the fuse start */
export function dynamiteBundle(m: VoxelModel, n: number, y0: number, y1: number, z: number) {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(-n + 1 + i * 2);
  for (const x0 of xs)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x0 + 1; x++)
        for (let zz = z; zz <= z + 1; zz++) m.set(x, y, zz, y === y1 ? W.stick.hi : (x === x0 ? W.stick.base : W.stick.shade));
  for (const ty of [y0 + 1, y1 - 2]) for (let x = xs[0] - 1; x <= xs[xs.length - 1] + 2; x++) for (let zz = z - 1; zz <= z + 2; zz++) if (m.has(x, ty, zz) || zz === z + 2) m.set(x, ty, zz, W.tape.base);
  // little label
  m.set(xs[Math.floor(n / 2)], Math.round((y0 + y1) / 2), z + 2, TOON.linen.hi);
  return xs;
}

/** tilted 2D shape rasterised into a plane of constant z (u along `ang`, v across) */
export function tilted(m: VoxelModel, cx: number, cy: number, z0: number, z1: number, ang: number, ext: number, shape: (u: number, v: number) => number | null, f?: number) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let x = Math.floor(cx - ext); x <= Math.ceil(cx + ext); x++)
    for (let y = Math.floor(cy - ext); y <= Math.ceil(cy + ext); y++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const c = shape(u, v);
      if (c === null) continue;
      for (let z = z0; z <= z1; z++) m.set(x, y, z, c, f);
    }
  return m;
}

export { roundBox, roundBoxX, autoShade, VF, TOON };
export type { Ramp };
