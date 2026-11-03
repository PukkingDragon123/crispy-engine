// Landmark encounter sites — STYLE v2. Big, tall, readable from far away, clean
// chunky planks and logs. 1/12 m (fort 1/10 m). Fronts face +Z.
// Each returns { model, voxelSize, meta: { entrance:[x,z] m, footprint:[w,d] m, height m, flagAnchors?, merchantSpot? } }
// (metres relative to the model's bottom-centre pivot).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { V3, PR, meters, board, post, seg, inCircle, chunk, sandDrift, rope, plankWall, windowW, doorW, toMeters, mod, Wall, stampText } from './helpers';
import { building, gableRoof, shedRoof, porchFront, signPanel, barrelBody, wheelModel, crateBody } from './western';

export interface LandmarkMeta {
  entrance: [number, number];
  footprint: [number, number];
  height: number;
  flagAnchors?: V3[];
  merchantSpot?: [number, number];
  [k: string]: unknown;
}
export interface Landmark {
  model: VoxelModel;
  voxelSize: number;
  meta: LandmarkMeta;
}

function finish(m: VoxelModel, vs: number, entrance: V3, extra: { flags?: V3[]; merchant?: V3 } = {}): Landmark {
  const b = m.bounds();
  const e = toMeters(m, vs, entrance);
  const meta: LandmarkMeta = {
    entrance: [e[0], e[2]],
    footprint: [(b.maxX - b.minX + 1) * vs, (b.maxZ - b.minZ + 1) * vs],
    height: (b.maxY - b.minY + 1) * vs,
  };
  if (extra.flags) meta.flagAnchors = extra.flags.map((p) => toMeters(m, vs, p));
  if (extra.merchant) {
    const q = toMeters(m, vs, extra.merchant);
    meta.merchantSpot = [q[0], q[2]];
  }
  return { model: m, voxelSize: vs, meta };
}

/** vertical log with a pointed top; r≈1.5 voxels */
function log(m: VoxelModel, x: number, z: number, y0: number, h: number, r: Ramp, point = true, i = 0) {
  for (let y = y0; y <= y0 + h; y++) {
    const tipK = point ? Math.max(0, y - (y0 + h - 3)) : 0;
    const rr = 1.6 - tipK * 0.55;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        if (!inCircle(a, b, rr)) continue;
        const outer = !inCircle(a, b, rr - 1);
        const ring = mod(y + i * 3, 11) === 0;
        m.set(x + a, y, z + b, tipK > 0 ? r.hi : ring && outer ? r.shade : a + b > 0 && outer ? r.hi : r.base);
      }
  }
}

/** a flag on a pole; returns the anchor (pole top) in voxels */
function flagPole(m: VoxelModel, x: number, y: number, z: number, h: number, cloth: Ramp): V3 {
  m.box(x, y, z, x, y + h, z, PR.woodDark.dark);
  m.set(x, y + h + 1, z, PR.brass.base, VF.METAL);
  for (let u = 1; u <= 12; u++) for (let w = 0; w < 7 - Math.floor(u / 4); w++) m.set(x + u, y + h - 1 - w - Math.floor(u / 6), z, w === 0 ? cloth.hi : cloth.base);
  return [x, y + h, z];
}

// ---------------------------------------------------------------------------
/** log palisade fort ≈26×22 m: 9 m gate (+Z) with open doors, 2 gate towers with flags, catwalk, corner bastions, cabin. 1/10 */
export function outlawFort(seed = 0): Landmark {
  const vs = 1 / 10;
  const v = meters(vs);
  const m = new VoxelModel('outlaw_fort');
  const HX = v(13), HZ = v(11);
  const WH = v(5.2);
  const gateHalf = v(4.6);
  const logR = PR.wood;
  // palisade (logs every 3 voxels)
  let i = 0;
  for (let x = -HX; x <= HX; x += 3) {
    log(m, x, -HZ, 0, WH + (mod(i, 2) ? 0 : 2), logR, true, i++);
    if (Math.abs(x) > gateHalf + 1) log(m, x, HZ, 0, WH + (mod(i, 2) ? 0 : 2), logR, true, i++);
  }
  for (let z = -HZ + 3; z <= HZ - 3; z += 3) {
    log(m, -HX, z, 0, WH + (mod(i, 2) ? 0 : 2), logR, true, i++);
    log(m, HX, z, 0, WH + (mod(i, 2) ? 0 : 2), logR, true, i++);
  }
  // horizontal tie rails on the outside
  for (const y of [v(1.2), v(4.0)]) {
    for (let x = -HX; x <= HX; x++) {
      m.set(x, y, -HZ - 2, PR.woodDark.base);
      if (Math.abs(x) > gateHalf + 1) m.set(x, y, HZ + 2, PR.woodDark.base);
    }
    for (let z = -HZ; z <= HZ; z++) m.set(-HX - 2, y, z, PR.woodDark.base).set(HX + 2, y, z, PR.woodDark.base);
  }
  // gate towers either side of the opening
  const flags: V3[] = [];
  for (const sx of [-1, 1]) {
    const cx = sx * (gateHalf + v(1.5));
    const s = v(1.5);
    for (const ox of [-s, s]) for (const oz of [-s, s]) post(m, cx + ox - 1, HZ + oz - 1, 0, WH + v(3.6), 3, PR.woodDark, ox + oz);
    // tower cabin (plank walls)
    const yB = WH + v(1.0);
    for (let x = cx - s - 1; x <= cx + s + 1; x++) for (let z = HZ - s - 1; z <= HZ + s + 1; z++) m.set(x, yB, z, mod(x, 3) ? PR.wood.base : PR.wood.dark);
    for (let y = yB + 1; y <= yB + 9; y++)
      for (let k = -s - 1; k <= s + 1; k++) {
        const c = y === yB + 9 ? PR.wood.hi : mod(y, 3) === 0 ? PR.wood.dark : PR.wood.base;
        m.set(cx + k, y, HZ + s + 1, c).set(cx + k, y, HZ - s - 1, c).set(cx - s - 1, y, HZ + k, c).set(cx + s + 1, y, HZ + k, c);
      }
    // pyramid roof
    const RH = s + 3;
    for (let y = 0; y <= RH; y++) {
      const e = s + 3 - y;
      for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) m.set(cx + x, yB + 10 + y, HZ + z, Math.abs(x) === e || Math.abs(z) === e ? (mod(y, 3) === 0 ? PR.woodDark.dark : PR.woodDark.base) : PR.woodDark.shade);
    }
    flags.push(flagPole(m, cx, yB + 10 + RH, HZ, 14, PR.red));
  }
  // gate beam with a skull and sign
  board(m, -gateHalf - 4, WH + v(2.6), HZ - 1, gateHalf + 4, WH + v(2.6) + 4, HZ + 1, PR.woodDark, 'x', seed);
  signPanel(m, 0, WH + v(0.6), HZ + 2, ['RED SAND GANG'], { bg: PR.woodLight, ink: PR.red.dark, scale: 2, weathered: true });
  // open gate doors swung inward
  for (const sx of [-1, 1]) {
    for (let k = 0; k <= gateHalf - 2; k++) {
      const x = sx * (gateHalf - 1), z = HZ - 2 - k;
      for (let y = 1; y <= WH - 6; y++) m.set(x, y, z, mod(k, 3) === 0 ? PR.woodDark.dark : PR.wood.base);
    }
    for (const y of [6, WH - 10]) for (let k = 0; k <= gateHalf - 2; k++) m.set(sx * (gateHalf - 1) - sx, y, HZ - 2 - k, PR.iron.base, VF.METAL);
  }
  // catwalk along the inside of the back and side walls
  const cwY = WH - v(1.6);
  for (let x = -HX + 3; x <= HX - 3; x++) for (let z = -HZ + 3; z <= -HZ + 7; z++) m.set(x, cwY, z, mod(x, 4) === 0 ? PR.wood.dark : PR.wood.base);
  for (let x = -HX + 4; x <= HX - 4; x += 12) m.box(x, 0, -HZ + 6, x + 1, cwY - 1, -HZ + 7, PR.woodDark.base);
  for (let st = 0; st < 10; st++) m.box(HX - 12 - st * 2, 0, -HZ + 8 + st, HX - 6 - st * 2, Math.round((cwY * (10 - st)) / 10), -HZ + 8 + st, st % 2 ? PR.wood.base : PR.wood.shade);
  // corner bastions (squat log towers)
  for (const [sx, sz] of [[-1, -1], [1, -1]] as const) {
    const cx = sx * HX, cz = sz * HZ;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      log(m, cx + Math.round(Math.cos(t) * 8), cz + Math.round(Math.sin(t) * 8), 0, WH + 8, logR, true, a);
    }
  }
  // cabin inside at the back
  const cab = building(m, -v(4), -v(5.5), v(7), v(4.5), v(2.8), { fy: 1, r: PR.wood, seed, vertical: false });
  shedRoof(m, cab, 6, { tin: true, seed });
  doorW(m, cab.front, -v(4) - 4, cab.fy + 1, 9, 22);
  windowW(m, cab.front, -v(4) + 10, cab.fy + 9, 8, 7, { shutters: PR.woodDark });
  // campfire, crates and a hitching rail in the yard
  for (let a = 0; a < 8; a++) chunk(m, v(4) + Math.round(Math.cos(a) * 5) - 1, 0, Math.round(Math.sin(a) * 5) - 1, v(4) + Math.round(Math.cos(a) * 5) + 1, 2, Math.round(Math.sin(a) * 5) + 1, PR.stone, 0);
  m.box(v(4) - 1, 0, -1, v(4) + 1, 2, 1, PR.ember.base, VF.EMISSIVE);
  crateBody(m, v(9), 0, -v(6), 9, PR.wood, PR.woodDark, 'x', seed);
  crateBody(m, v(9) - 2, 9, -v(6) + 1, 7, PR.woodLight, PR.woodDark, 'none', seed + 1);
  crateBody(m, v(9), 0, -v(6) + 11, 9, PR.barnRed, PR.woodDark, 'none', seed + 2);
  sandDrift(m, -HX - 4, 0, 14, 40, 8, 0, seed);
  sandDrift(m, HX + 3, HZ - 6, 12, 18, 6, 0, seed + 1);
  return finish(m, vs, [0, 0, HZ + v(2.5)], { flags });
}

// ---------------------------------------------------------------------------
/** two-storey trading post with porch, balcony, goods, merchant spot by the door. 1/12 */
export function tradingPost(seed = 0): Landmark {
  const vs = 1 / 12;
  const v = meters(vs);
  const m = new VoxelModel('trading_post');
  const b = building(m, 0, 0, v(10), v(7.5), v(3.2), { fy: 4, r: PR.wood, seed, vertical: false });
  // second storey
  const fy2 = b.top + 1;
  for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) m.set(x, b.top + 1, z, PR.woodDark.base);
  const walls: [Wall, number, number][] = [[b.front, b.x0, b.x1], [b.back, b.x0, b.x1], [b.left, b.z0, b.z1], [b.right, b.z0, b.z1]];
  walls.forEach(([w, a, c], i) => plankWall(m, w, a, c, fy2 + 1, fy2 + v(2.8), { r: PR.woodLight, seed: seed + 10 + i }));
  const top2: typeof b = { ...b, top: fy2 + v(2.8) };
  gableRoof(m, top2, 'x', v(2.2), { tin: false, seed, gable: PR.woodLight, r: PR.woodDark });
  // doors & windows
  const cx = Math.round((b.x0 + b.x1) / 2);
  doorW(m, b.front, cx - 6, b.fy + 1, 12, 28, { r: PR.woodDark, trim: PR.paintWhite });
  for (const sx of [-1, 1]) windowW(m, b.front, sx < 0 ? b.x0 + 8 : b.x1 - 21, b.fy + 9, 13, 13, { frame: PR.paintWhite, shutters: PR.paintGreen });
  for (const sx of [-1, 0, 1]) windowW(m, b.front, cx + sx * 30 - 5, fy2 + 9, 10, 12, { frame: PR.paintWhite });
  windowW(m, b.left, b.z0 + 20, b.fy + 9, 12, 12, { frame: PR.paintWhite });
  // porch + balcony on top of the porch roof
  porchFront(m, b, b.x0 - 2, b.x1 + 2, 22, b.top - 1, { tin: false, seed, rail: false });
  for (let x = b.x0 - 2; x <= b.x1 + 2; x++)
    for (let y = b.top + 3; y <= b.top + 9; y++) if (y === b.top + 9 || mod(x, 3) === 0) m.set(x, y, b.z1 + 21, y === b.top + 9 ? PR.paintWhite.hi : PR.paintWhite.base);
  // big sign across the balcony
  signPanel(m, cx, fy2 + v(2.8) + 2, b.z1 + 2, ['TRADING POST'], { bg: PR.paintWhite, ink: PR.red.dark, scale: 2, weathered: true });
  signPanel(m, cx, b.top + 11, b.z1 + 22, ['GOODS & GUNS'], { bg: PR.woodLight, ink: PR.ink.base, weathered: true });
  // goods on the porch: barrels, crates, hanging rug
  barrelBody(m, b.x0 + 5, b.z1 + 12, b.fy + 1, 12, 5, PR.wood);
  barrelBody(m, b.x0 + 15, b.z1 + 14, b.fy + 1, 12, 5, PR.woodDark);
  crateBody(m, b.x1 - 16, b.fy + 1, b.z1 + 8, 10, PR.woodLight, PR.woodDark, 'x', seed);
  crateBody(m, b.x1 - 14, b.fy + 11, b.z1 + 9, 7, PR.wood, PR.woodDark, 'none', seed + 3);
  for (let x = b.x1 - 30; x <= b.x1 - 20; x++) for (let y = b.fy + 8; y <= b.fy + 22; y++) m.set(x, y, b.z1 + 1, mod(y + Math.abs(x - (b.x1 - 25)), 6) < 2 ? PR.red.base : mod(y, 6) === 3 ? PR.paintWhite.base : PR.lapis.base);
  // hitching rail out front
  for (const x of [-v(3), v(3)]) post(m, x, b.z1 + 30, 0, 14, 2, PR.woodDark, x);
  board(m, -v(3), 13, b.z1 + 30, v(3) + 1, 14, b.z1 + 31, PR.woodDark, 'x', seed);
  sandDrift(m, b.x1 + 8, b.z0, 16, 30, 7, 0, seed);
  return finish(m, vs, [cx, 0, b.z1 + 30], { merchant: [cx + 14, 0, b.z1 + 12] });
}

// ---------------------------------------------------------------------------
/** timber mine headframe ≈15 m with sheave wheel, hoist house, rails, carts, ore pile, portal in a rock. 1/12 */
export function mineHeadframe(seed = 0): Landmark {
  const vs = 1 / 12;
  const v = meters(vs);
  const m = new VoxelModel('mine_headframe');
  const H = v(14.5);
  const leg = (x0: number, z0: number, x1: number, z1: number) => seg(m, [x0, 0, z0], [x1, H, z1], 3, PR.woodDark.base);
  const s0 = v(2.6), s1 = v(1.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * s0, sz * s0, sx * s1, sz * s1);
  // horizontal girts + X braces
  for (let y = v(2); y < H - 4; y += v(3)) {
    const k = s0 + ((s1 - s0) * y) / H;
    const k2 = s0 + ((s1 - s0) * (y + v(3))) / H;
    for (const s of [-1, 1]) {
      seg(m, [-k, y, s * k], [k, y, s * k], 2, PR.wood.base);
      seg(m, [s * k, y, -k], [s * k, y, k], 2, PR.wood.base);
      if (y + v(3) < H) {
        seg(m, [-k, y, s * k], [k2, y + v(3), s * k2], 1, PR.wood.shade);
        seg(m, [s * k, y, -k], [s * k2, y + v(3), k2], 1, PR.wood.shade);
      }
    }
  }
  // back legs leaning to the hoist house
  for (const sz of [-1, 1]) seg(m, [-v(9), 0, sz * s1], [-s1, H - 6, sz * s1], 3, PR.woodDark.base);
  // top deck + sheave wheel
  for (let x = -s1 - 4; x <= s1 + 4; x++) for (let z = -s1 - 4; z <= s1 + 4; z++) m.set(x, H, z, mod(x, 3) ? PR.wood.base : PR.wood.dark);
  const wh = wheelModel(v(1.6), PR.woodDark, 8);
  wh.forEach((x, y, z, c, f) => m.set(z, H + v(1.6) + 3 + y, x, c, f));
  m.box(-1, H + 1, -2, 1, H + 3, 2, PR.iron.dark, VF.METAL);
  // hoist cable to the hoist house
  rope(m, [[0, H + v(3.2), 0], [-v(9), v(4.2), 0]], PR.iron.dark);
  rope(m, [[0, H + 2, 0], [0, v(3.5), 0]], PR.iron.dark);
  // cage / collar at the shaft
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.abs(x) === 6 || Math.abs(z) === 6) m.box(x, 0, z, x, 1, z, PR.woodDark.base);
  for (let y = 2; y <= v(3.3); y++) for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) m.set(x, y, z, PR.iron.base, VF.METAL);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) m.set(x, v(3.3), z, PR.iron.shade, VF.METAL);
  // hoist house
  const hh = building(m, -v(12), 0, v(5), v(4.5), v(3), { fy: 1, r: PR.barnRed, seed, vertical: true });
  gableRoof(m, hh, 'z', v(1.4), { tin: true, seed });
  doorW(m, hh.front, -v(12) - 5, hh.fy + 1, 10, 24);
  m.box(-v(12) + 10, hh.top, -8, -v(12) + 12, hh.top + v(2.6), -6, PR.coal.hi, VF.METAL);
  // rails, carts and ore pile toward the front
  for (let z = 6; z <= v(12); z++) {
    if (mod(z, 7) < 2) m.box(-8, 0, z, 8, 0, z, PR.woodDark.shade);
    for (const x of [-5, 4]) m.box(x, 1, z, x + 1, 1, z, PR.iron.hi, VF.METAL);
  }
  for (const [z, gold] of [[v(6), true], [v(10), false]] as const) {
    for (let y = 2; y <= 9; y++) for (let x = -7; x <= 7; x++) for (let zz = z - 8; zz <= z + 8; zz++) if (Math.abs(x) === 7 || Math.abs(zz - z) === 8 || y === 2) m.set(x, y, zz, y === 9 ? PR.iron.hi : PR.iron.base, VF.METAL);
    for (let x = -6; x <= 6; x++) for (let zz = z - 7; zz <= z + 7; zz++) m.set(x, 9 + (mod(x + zz, 3) === 0 ? 1 : 0), zz, gold ? (mod(x * 3 + zz, 4) === 0 ? PR.gold.hi : PR.stone.shade) : PR.coal.base, gold && mod(x * 3 + zz, 4) === 0 ? VF.METAL : 0);
  }
  for (let x = -16; x <= 16; x++)
    for (let z = -16; z <= 16; z++) {
      const d = Math.sqrt(x * x + z * z) / 16;
      if (d > 1) continue;
      const h = Math.round((1 - d * d) * 12);
      for (let y = 0; y < h; y++) m.set(v(7) + x, y, v(7) + z, y === h - 1 ? (mod(x * 5 + z * 3, 11) === 0 ? PR.gold.base : mod(x + z, 2) ? PR.greyRock.base : PR.greyRock.hi) : PR.greyRock.shade, mod(x * 5 + z * 3, 11) === 0 && y === h - 1 ? VF.METAL : 0);
    }
  // faceted red-rock outcrop with the mine portal cut into its face (behind the headframe, to the right)
  const ox = v(6), oz = -v(5);
  chunk(m, ox - 34, 0, oz - 22, ox + 34, 40, oz + 16, PR.redRock, 2, false, 3, seed + 31);
  chunk(m, ox - 20, 30, oz - 18, ox + 22, 58, oz + 8, PR.redRock, 2, false, 3, seed + 32);
  chunk(m, ox + 26, 0, oz - 14, ox + 50, 24, oz + 12, PR.mesaRock, 1, false, 2, seed + 33);
  m.forEach((x, y, z, c) => {
    if ((c === PR.redRock.base || c === PR.mesaRock.base) && (y === 14 || y === 34) && (!m.has(x, y, z + 1) || !m.has(x + 1, y, z) || !m.has(x - 1, y, z))) m.set(x, y, z, PR.redRock.shade);
  });
  const pz = oz + 16;
  for (let x = ox - 9; x <= ox + 9; x++) for (let y = 0; y <= 30; y++) for (let z = pz - 10; z <= pz + 2; z++) m.del(x, y, z);
  for (let x = ox - 9; x <= ox + 9; x++) for (let y = 0; y <= 30; y++) m.set(x, y, pz - 11, PR.socket.base);
  for (const x of [ox - 12, ox + 9]) post(m, x, pz - 1, 0, 31, 3, PR.woodDark, x);
  board(m, ox - 13, 32, pz - 2, ox + 13, 35, pz + 1, PR.woodDark, 'x', seed);
  signPanel(m, ox, 37, pz + 2, ['LUCKY SCARAB', 'MINE'], { bg: PR.woodLight, ink: PR.ink.base, weathered: true });
  sandDrift(m, v(14), v(4), 14, 20, 6, 0, seed);
  return finish(m, vs, [0, 0, v(14)]);
}

// ---------------------------------------------------------------------------
/** big red gambrel barn + corral fence + hay. 1/12 */
export function ranchBarn(seed = 0): Landmark {
  const vs = 1 / 12;
  const v = meters(vs);
  const m = new VoxelModel('ranch_barn');
  const b = building(m, 0, -v(3), v(11), v(9), v(4.2), { fy: 1, r: PR.barnRed, seed, vertical: true, corner: PR.paintWhite });
  // gambrel roof: two pitches per side
  const half = (b.x1 - b.x0) / 2 + 3;
  const cxr = (b.x0 + b.x1) / 2;
  const yAt = (x: number) => {
    const d = Math.abs(x - cxr) / half;
    return b.top + 1 + Math.round(d > 0.55 ? (1 - d) * 2.2 * v(3.4) : v(3.4) * 0.99 + (0.55 - d) * v(1.6));
  };
  for (let z = b.z0 - 3; z <= b.z1 + 3; z++)
    for (let x = b.x0 - 3; x <= b.x1 + 3; x++) {
      const y = yAt(x);
      const edge = z === b.z0 - 3 || z === b.z1 + 3;
      m.set(x, y, z, edge ? PR.woodDark.dark : mod(Math.round(Math.abs(x - cxr)), 3) === 0 ? PR.woodDark.dark : PR.woodDark.base);
      m.set(x, y - 1, z, PR.woodDark.shade);
    }
  for (const z of [b.z0, b.z1])
    for (let x = b.x0; x <= b.x1; x++)
      for (let y = b.top + 1; y < yAt(x); y++) m.set(x, y, z, mod(x, 3) === 0 ? PR.barnRed.dark : PR.barnRed.base);
  // big X-braced double doors (white trim) + hay loft door with pulley beam
  const cx = Math.round(cxr);
  doorW(m, b.front, cx - 14, b.fy + 1, 28, 34, { open: true, trim: PR.paintWhite });
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? cx - 30 : cx + 15;
    for (let x = x0; x < x0 + 15; x++)
      for (let y = b.fy + 1; y <= b.fy + 34; y++) {
        const edge = x === x0 || x === x0 + 14 || y === b.fy + 1 || y === b.fy + 34;
        const diag = Math.abs((x - x0) * 34 / 15 - (y - b.fy - 1)) < 2 || Math.abs((x0 + 14 - x) * 34 / 15 - (y - b.fy - 1)) < 2;
        m.set(x, y, b.z1 + 1, edge || diag ? PR.paintWhite.base : mod(x, 3) === 0 ? PR.barnRed.dark : PR.barnRed.base);
      }
  }
  windowW(m, b.front, cx - 6, b.top + 6, 12, 12, { frame: PR.paintWhite, glass: false, cross: false });
  for (let y = b.top + 7; y < b.top + 18; y++) for (let x = cx - 6; x < cx + 6; x++) m.set(x, y, b.z1 - 2, mod(x + y, 3) === 0 ? PR.hay.shade : PR.hay.base);
  board(m, cx - 1, b.top + 21, b.z1, cx + 1, b.top + 23, b.z1 + 8, PR.woodDark, 'z', seed);
  rope(m, [[cx, b.top + 20, b.z1 + 7], [cx, b.top + 4, b.z1 + 7]]);
  // corral fence on the front-right
  const fx0 = b.x1 + 6, fx1 = b.x1 + v(9), fz0 = b.z0 + 6, fz1 = b.z1 + v(5);
  const fencePost = (x: number, z: number) => post(m, x, z, 0, 16, 2, PR.woodGrey, x + z);
  for (let x = fx0; x <= fx1; x += 16) {
    fencePost(x, fz0);
    fencePost(x, fz1);
  }
  for (let z = fz0; z <= fz1; z += 16) fencePost(fx1, z);
  for (const y of [6, 13]) {
    for (let x = fx0; x <= fx1; x++) m.set(x, y, fz0 + 2, PR.woodGrey.base).set(x, y, fz1 + 2, PR.woodGrey.base);
    for (let z = fz0; z <= fz1; z++) m.set(fx1 + 2, y, z, PR.woodGrey.base);
  }
  // hay bales
  for (const [x, z, y] of [[fx0 + 10, fz1 - 14, 0], [fx0 + 22, fz1 - 14, 0], [fx0 + 16, fz1 - 14, 8]] as const) {
    for (let a = 0; a < 11; a++) for (let yy = 0; yy < 8; yy++) for (let c = 0; c < 8; c++) m.set(x + a, y + yy, z + c, a === 3 || a === 7 ? PR.rope.shade : yy === 7 ? PR.hay.hi : mod(a + c + yy, 4) === 0 ? PR.hay.shade : PR.hay.base);
  }
  // water trough in the corral
  for (let x = fx0 + 30; x <= fx0 + 50; x++) for (let z = fz0 + 20; z <= fz0 + 26; z++) for (let y = 0; y <= 5; y++) m.set(x, y, z, y === 4 && x > fx0 + 30 && x < fx0 + 50 && z > fz0 + 20 && z < fz0 + 26 ? PR.water.base : PR.wood.base);
  // weathervane
  m.box(cx, yAt(cx) + 1, Math.round((b.z0 + b.z1) / 2), cx, yAt(cx) + 12, Math.round((b.z0 + b.z1) / 2), PR.iron.dark, VF.METAL);
  for (let x = -5; x <= 5; x++) m.set(cx + x, yAt(cx) + 10, Math.round((b.z0 + b.z1) / 2), PR.iron.dark, VF.METAL);
  m.box(cx + 3, yAt(cx) + 11, Math.round((b.z0 + b.z1) / 2), cx + 6, yAt(cx) + 13, Math.round((b.z0 + b.z1) / 2), PR.iron.base, VF.METAL);
  sandDrift(m, b.x0 - 6, b.z0, 14, 30, 6, 0, seed);
  return finish(m, vs, [cx, 0, b.z1 + v(3)]);
}

// ---------------------------------------------------------------------------
/** sheriff's office with jail wing: barred cells, porch, star, wanted board. 1/12 */
export function sheriffOffice(seed = 0): Landmark {
  const vs = 1 / 12;
  const v = meters(vs);
  const m = new VoxelModel('sheriff_office');
  const b = building(m, -v(2), 0, v(7.5), v(7), v(3.6), { fy: 4, r: PR.woodLight, seed, vertical: false });
  // false front
  const FT = b.top + v(1.8);
  for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
    for (let y = b.top + 1; y <= FT; y++) m.set(x, y, b.z1, mod(y, 3) === 0 ? PR.woodLight.dark : PR.woodLight.base).set(x, y, b.z1 - 1, PR.woodLight.shade);
    m.set(x, FT + 1, b.z1 + 1, PR.woodDark.base).set(x, FT + 2, b.z1, PR.woodDark.hi);
  }
  shedRoof(m, b, 8, { tin: true, seed });
  const cx = Math.round((b.x0 + b.x1) / 2);
  signPanel(m, cx, b.top + 3, b.z1 + 2, ['SHERIFF'], { bg: PR.paintWhite, ink: PR.ink.base, scale: 2, weathered: true });
  doorW(m, b.front, cx - 5, b.fy + 1, 10, 26, { trim: PR.paintWhite });
  windowW(m, b.front, b.x0 + 6, b.fy + 9, 11, 12, { frame: PR.paintWhite, shutters: PR.paintBlue });
  // star on the front
  const star = ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'];
  star.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && m.set(b.x1 - 14 + j, b.fy + 22 - i, b.z1 + 1, i < 2 ? PR.gold.hi : PR.gold.base, VF.METAL)));
  porchFront(m, b, b.x0 - 1, b.x1 + 1, 16, b.top - 2, { tin: true, seed, rail: true });
  // jail wing (stone) to the right
  const jx0 = b.x1 + 2, jx1 = jx0 + v(4.2), jz0 = b.z0 + 6, jz1 = b.z1 - 4;
  for (let x = jx0; x <= jx1; x++)
    for (let z = jz0; z <= jz1; z++)
      for (let y = 0; y <= v(3.2); y++) {
        const wall = x === jx0 || x === jx1 || z === jz0 || z === jz1 || x === jx0 + 1 || x === jx1 - 1 || z === jz0 + 1 || z === jz1 - 1;
        if (!wall && y > 0) continue;
        const row = Math.floor(y / 3), off = row % 2 ? 3 : 0;
        const seam = mod(y, 3) === 0 || mod((x + z) + off, 6) === 0;
        m.set(x, y, z, seam ? PR.greyRock.dark : PR.greyRock.base);
      }
  for (let x = jx0 - 1; x <= jx1 + 1; x++) for (let z = jz0 - 1; z <= jz1 + 1; z++) m.set(x, v(3.2) + 1, z, Math.abs(x - jx0 + 1) < 1 || x === jx1 + 1 || z === jz0 - 1 || z === jz1 + 1 ? PR.greyRock.shade : PR.greyRock.hi);
  // barred cell windows
  for (const wx of [jx0 + 8, jx0 + 26]) {
    for (let x = wx; x < wx + 10; x++) for (let y = 18; y < 28; y++) {
      m.del(x, y, jz1);
      m.del(x, y, jz1 - 1);
      m.set(x, y, jz1 - 2, PR.socket.base);
      if (mod(x - wx, 3) === 1) m.set(x, y, jz1, PR.iron.base, VF.METAL);
    }
  }
  stampText(m, 'z+', 'JAIL', Math.round((jx0 + jx1) / 2) - 7, 34, jz1 + 1, { color: PR.ink.base });
  // wanted board on the porch post
  for (let x = b.x1 - 6; x <= b.x1 + 4; x++) for (let y = b.fy + 10; y <= b.fy + 22; y++) m.set(x, y, b.z1 + 17, y === b.fy + 20 ? PR.ink.base : PR.parchment.base);
  sandDrift(m, b.x0 - 6, b.z0, 14, 24, 6, 0, seed);
  return finish(m, vs, [cx, 0, b.z1 + v(3)]);
}

// ---------------------------------------------------------------------------
/** two-storey saloon: balcony, batwing doors, big false front, piano player's window. 1/12 */
export function saloon(seed = 0): Landmark {
  const vs = 1 / 12;
  const v = meters(vs);
  const m = new VoxelModel('saloon');
  const b = building(m, 0, 0, v(11), v(9), v(3.4), { fy: 4, r: PR.barnRed, seed, vertical: false });
  // upper storey
  const fy2 = b.top + 1;
  for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) m.set(x, fy2, z, PR.woodDark.base);
  ([[b.front, b.x0, b.x1], [b.back, b.x0, b.x1], [b.left, b.z0, b.z1], [b.right, b.z0, b.z1]] as [Wall, number, number][]).forEach(([w, a, c], i) =>
    plankWall(m, w, a, c, fy2 + 1, fy2 + v(3), { r: PR.barnRed, seed: seed + 20 + i }),
  );
  const top: typeof b = { ...b, top: fy2 + v(3) };
  shedRoof(m, top, 8, { tin: true, seed });
  // tall stepped false front with a cornice
  const FT = top.top + v(2.6);
  const cx = Math.round((b.x0 + b.x1) / 2);
  for (let x = b.x0 - 2; x <= b.x1 + 2; x++) {
    const step = Math.abs(x - cx) < 18 ? 8 : Math.abs(x - cx) < 34 ? 4 : 0;
    for (let y = top.top + 1; y <= FT + step; y++) m.set(x, y, b.z1, mod(y, 3) === 0 ? PR.barnRed.dark : PR.barnRed.base).set(x, y, b.z1 - 1, PR.barnRed.shade);
    m.set(x, FT + step + 1, b.z1 + 1, PR.paintWhite.base).set(x, FT + step + 2, b.z1, PR.paintWhite.hi);
  }
  signPanel(m, cx, top.top + 4, b.z1 + 2, ['SALOON'], { bg: PR.paintYellow, ink: PR.red.dark, pad: 3, scale: 3, weathered: true });
  // batwing doors + windows
  doorW(m, b.front, cx - 7, b.fy + 1, 14, 30, { batwing: true, trim: PR.paintWhite });
  for (const sx of [-1, 1]) windowW(m, b.front, sx < 0 ? b.x0 + 8 : b.x1 - 22, b.fy + 9, 14, 14, { frame: PR.paintWhite });
  for (const k of [-2, -1, 0, 1, 2]) {
    const wx = cx + k * 22 - 4;
    doorW(m, b.front, wx, fy2 + 1, 8, 22, { r: PR.woodDark, trim: PR.paintWhite });
  }
  // porch with balcony above
  porchFront(m, b, b.x0 - 2, b.x1 + 2, 20, b.top - 1, { tin: false, seed });
  for (let x = b.x0 - 2; x <= b.x1 + 2; x++) {
    for (let z = b.z1 + 1; z <= b.z1 + 19; z++) m.set(x, b.top + 2, z, mod(x, 4) === 0 ? PR.wood.dark : PR.wood.base);
    for (let y = b.top + 3; y <= b.top + 10; y++) if (y === b.top + 10 || mod(x, 3) === 0) m.set(x, y, b.z1 + 19, y === b.top + 10 ? PR.paintWhite.hi : PR.paintWhite.base);
  }
  // balcony roof
  for (let x = b.x0 - 2; x <= b.x1 + 2; x++) for (let z = b.z1 + 1; z <= b.z1 + 20; z++) m.set(x, top.top - 2 - Math.round((z - b.z1) * 0.15), z, mod(x, 2) ? PR.tin.base : PR.tin.shade, VF.METAL);
  for (const x of [b.x0 - 2, cx, b.x1 + 1]) post(m, x, b.z1 + 18, b.top + 3, top.top - 3, 2, PR.woodDark, x);
  // barrels & a lantern
  barrelBody(m, b.x0 + 4, b.z1 + 10, b.fy + 1, 12, 5, PR.wood);
  m.box(cx + 10, b.fy + 22, b.z1 + 2, cx + 12, b.fy + 25, b.z1 + 4, PR.ember.hi, VF.EMISSIVE);
  m.box(cx + 10, b.fy + 26, b.z1 + 2, cx + 12, b.fy + 26, b.z1 + 4, PR.iron.dark, VF.METAL);
  sandDrift(m, b.x1 + 8, b.z0, 14, 30, 6, 0, seed);
  return finish(m, vs, [cx, 0, b.z1 + v(3.5)]);
}

