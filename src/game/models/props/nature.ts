// Nature props — STYLE v2: clean stylized cacti (seeded generator), chunky
// bevelled rocks, palms, shrubs/reeds, tumbleweeds and cartoon bones. 1/20 m
// (big skulls / rib arches 1/12, boulders 1/16).
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, cylY, cylH, blob, seg, chunk, sandDrift, mixRGB, inCircle, mod } from './helpers';

export type CactusKind = 'saguaro' | 'barrel' | 'prickly' | 'organ';

const VS = 1 / 20;
const FLESH = 0xd2dc94;
const SPINE = 0xfff0c8;

// ---------------------------------------------------------------------------
// cactus generator
// ---------------------------------------------------------------------------
interface CactusOpts {
  /** 0 = intact, 1 = lost an arm + bullet holes, 2 = snapped mid-height, 3 = stump */
  damage: number;
}

/** ribbed column: grooves carved every `ribW` around the circumference, ridge/groove colours, spine dots */
function ribbedColumn(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, r: number, g: Ramp, seed: number, domeTop = true, spineCol = SPINE) {
  const ribs = Math.max(6, Math.round(r * 2.4));
  const domeH = domeTop ? Math.max(2, Math.round(r * 0.9)) : 0;
  for (let y = y0; y <= y1; y++) {
    let rr = r;
    if (domeTop && y > y1 - domeH) {
      const k = (y - (y1 - domeH)) / (domeH + 0.6);
      rr = r * Math.sqrt(Math.max(0, 1 - k * k));
    }
    if (rr < 0.6) {
      m.set(cx, y, cz, g.hi);
      continue;
    }
    const R = Math.ceil(rr) + 1;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        if (!inCircle(x, z, rr)) continue;
        const outer = !inCircle(x, z, rr - 1);
        const a = Math.atan2(z, x);
        const ribK = mod((a / (Math.PI * 2)) * ribs + 0.5, 1);
        const groove = outer && ribK < 0.3;
        if (groove && rr > 2 && y < y1 - 1) continue; // carved groove
        let c = g.base;
        if (outer && ribK > 0.62) c = g.hi; // lit side of each ridge
        if (outer && ribK < 0.4 && ribK >= 0.3) c = g.shade;
        // spine dots on ridges every 5 rows (staggered per rib)
        const ribI = Math.floor(mod((a / (Math.PI * 2)) * ribs + 0.5, ribs));
        if (outer && ribK > 0.45 && ribK < 0.62 && mod(y + ribI * 2 + seed, 5) === 0) c = spineCol;
        m.set(cx + x, y, cz + z, c);
      }
  }
  // the groove floor (darker) so carved grooves read as shadowed lines
  for (let y = y0; y <= y1 - domeH; y++) {
    const R = Math.ceil(r);
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        if (!m.has(cx + x, y, cz + z)) continue;
        if (inCircle(x, z, r - 1) && !inCircle(x, z, r - 2)) {
          const a = Math.atan2(z, x);
          const ribK = mod((a / (Math.PI * 2)) * ribs + 0.5, 1);
          if (ribK < 0.3) m.set(cx + x, y, cz + z, g.dark);
        }
      }
  }
}

/** little cactus flower: petals in a plus, coloured centre */
function flower(m: VoxelModel, x: number, y: number, z: number, petal: number, centre: number) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(x + dx, y, z + dz, petal);
  m.set(x, y, z, centre);
  m.set(x, y + 1, z, petal);
}

/** horizontal arm from the trunk with a rounded elbow turning upward (or a flat-cut stump) */
function tubeArm(m: VoxelModel, d: [number, number], y: number, from: number, out: number, bend: number, ra: number, g: Ramp, stump: boolean) {
  const ball = (cx: number, cy: number, cz: number) => {
    const R = Math.ceil(ra) + 1;
    for (let x = -R; x <= R; x++)
      for (let yy = -R; yy <= R; yy++)
        for (let z = -R; z <= R; z++) {
          if (x * x + yy * yy + z * z > ra * ra + ra * 0.6) continue;
          const px = Math.round(cx + x), py = Math.round(cy + yy), pz = Math.round(cz + z);
          const c = yy > ra * 0.45 ? g.hi : yy < -ra * 0.45 ? g.shade : g.base;
          if (!m.has(px, py, pz)) m.set(px, py, pz, c);
        }
  };
  const straightEnd = stump ? out : out - bend;
  for (let k = from; k <= straightEnd; k += 0.5) ball(d[0] * k, y, d[1] * k);
  if (stump) {
    const k = out + 1;
    for (let u = -3; u <= 3; u++)
      for (let w = -3; w <= 3; w++) {
        if (!inCircle(u, w, ra - 0.5)) continue;
        m.set(d[0] ? d[0] * k : u, y + w, d[1] ? d[1] * k : u, FLESH);
      }
    return;
  }
  for (let a = 0; a <= 16; a++) {
    const t = (a / 16) * Math.PI * 0.5;
    const k = out - bend + Math.sin(t) * bend;
    ball(d[0] * k, y + bend - Math.cos(t) * bend, d[1] * k);
  }
}

function saguaro(seed: number, o: CactusOpts): VoxelModel {
  const r = rngOf(seed, 11);
  const m = new VoxelModel('saguaro');
  const g = PR.cactus;
  const R = r.pick([4, 5, 5]);
  const H = r.int(56, 78);
  const cut = o.damage >= 3 ? Math.round(H * 0.28) : o.damage === 2 ? Math.round(H * 0.6) : H;
  ribbedColumn(m, 0, 0, 0, Math.min(H, cut), R, g, seed, cut >= H);
  // arms
  const nArms = r.pick([0, 1, 2, 2, 2, 3]);
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const used = new Set<number>();
  const arms: { d: [number, number]; y: number; out: number; up: number; ra: number }[] = [];
  for (let i = 0; i < nArms; i++) {
    let di = r.int(0, 3);
    if (i === 1 && arms.length) di = dirs.findIndex((d) => d[0] === -arms[0].d[0] && d[1] === -arms[0].d[1]);
    if (used.has(di)) di = (di + 1) % 4;
    used.add(di);
    const ra = Math.max(2.5, R - 1.5);
    arms.push({ d: dirs[di], y: r.int(Math.round(H * 0.28), Math.round(H * 0.5)), out: Math.round(R + ra + r.int(5, 8)), up: r.int(10, 22), ra });
  }
  arms.forEach((a, ai) => {
    if (o.damage === 1 && ai === 0) {
      // stump of a shot-off arm: short, flat flesh-coloured end
      tubeArm(m, a.d, a.y, R, R + 3, 0, a.ra, g, true);
      return;
    }
    if (a.y > cut) return;
    const bend = Math.round(a.ra + 2);
    const ex = a.d[0] * a.out, ez = a.d[1] * a.out;
    tubeArm(m, a.d, a.y, R - 1, a.out, bend, a.ra, g, false);
    const topY = Math.min(a.y + bend + a.up, o.damage === 2 ? cut + 6 : 999);
    ribbedColumn(m, ex, ez, a.y + bend, topY, a.ra, g, seed + ai, o.damage !== 2 || topY === a.y + bend + a.up);
    if (o.damage === 0 && r.chance(0.5)) flower(m, ex, topY + 1, ez, r.pick([0xffffff, 0xffd8e4]), PR.paintYellow.base);
  });
  if (cut < H) {
    // broken top: stepped jagged flesh
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        if (!inCircle(x, z, R - 1)) continue;
        const top = cut + ((x + z) & 1 ? 1 : 0) + (Math.abs(x) + Math.abs(z) < 3 ? 1 : 0);
        for (let y = cut; y <= top; y++) m.set(x, y, z, y === top ? FLESH : g.base);
      }
  } else if (r.chance(0.65)) {
    // crown of flowers
    const n = r.int(3, 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.next();
      const fx = Math.round(Math.cos(a) * 2), fz = Math.round(Math.sin(a) * 2);
      let y = H;
      while (m.has(fx, y, fz)) y++;
      flower(m, fx, y, fz, r.pick([0xffffff, 0xfff4dc]), PR.paintYellow.base);
    }
  }
  if (o.damage === 1) {
    // three bullet holes
    for (let i = 0; i < 3; i++) {
      const y = r.int(10, Math.min(cut - 4, 40));
      const a = r.next() * Math.PI * 2;
      const x = Math.round(Math.cos(a) * R), z = Math.round(Math.sin(a) * R);
      for (let d = 0; d < R; d++) {
        const px = Math.round(Math.cos(a) * (R - d)), pz = Math.round(Math.sin(a) * (R - d));
        if (m.has(px, y, pz)) {
          m.set(px, y, pz, PR.cactus.dark);
          break;
        }
      }
      void x;
      void z;
    }
  }
  sandDrift(m, 0, 0, R + 3, R + 3, 2, 0, seed);
  return m;
}

function barrelCactus(seed: number, o: CactusOpts): VoxelModel {
  const r = rngOf(seed, 21);
  const m = new VoxelModel('barrel_cactus');
  const g = r.chance(0.5) ? PR.cactus : PR.green;
  const R = r.int(7, 9);
  const H = Math.round(R * r.range(1.3, 1.9)) - (o.damage >= 2 ? R : 0);
  ribbedColumn(m, 0, 0, 0, H, R, g, seed, o.damage < 2, 0xe8584a);
  if (o.damage >= 2) {
    for (let x = -R + 1; x <= R - 1; x++) for (let z = -R + 1; z <= R - 1; z++) if (inCircle(x, z, R - 1)) m.set(x, H + ((x * z) & 1), z, FLESH);
  } else {
    const n = 6;
    const pet = r.pick([0xf2c440, 0xe8584a, 0xf08a3a]);
    let top = H;
    while (m.has(0, top, 0)) top++;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fx = Math.round(Math.cos(a) * 2), fz = Math.round(Math.sin(a) * 2);
      let y = H - 1;
      while (m.has(fx, y, fz)) y++;
      m.set(fx, y, fz, pet);
      m.set(fx, y + 1, fz, mixRGB(pet, 0xffffff, 0.3));
    }
    m.set(0, top, 0, PR.paintYellow.hi);
  }
  sandDrift(m, 0, 0, R + 2, R + 2, 2, 0, seed);
  return m;
}

/** prickly pear: flat oval pads fanning out from each other's upper rims */
function prickly(seed: number, o: CactusOpts): VoxelModel {
  const r = rngOf(seed, 31);
  const m = new VoxelModel('prickly');
  const g = PR.leaf;
  const pad = (cx: number, cy: number, cz: number, rx: number, ry: number, axis: 'x' | 'z', depth: number, idx: number) => {
    // pad lies in the plane spanned by (axis, y); 2 thick; darker rim, lit upper half, spine dots on a grid
    for (let a = -Math.ceil(rx); a <= rx; a++)
      for (let b = -Math.ceil(ry); b <= ry; b++) {
        const d = (a * a) / (rx * rx) + (b * b) / (ry * ry);
        if (d > 1.02) continue;
        const rim = d > 0.74;
        for (let t = -1; t <= 0; t++) {
          const x = axis === 'x' ? cx + a : cx + t, z = axis === 'x' ? cz + t : cz + a;
          let c = rim ? g.shade : b > ry * 0.25 ? g.hi : g.base;
          if (!rim && mod(a + (b >> 2) * 2 + idx, 4) === 0 && mod(b, 4) === 0) c = SPINE;
          m.set(x, cy + b, z, c);
        }
      }
    if (depth <= 0) {
      if (o.damage === 0 && r.chance(0.8)) {
        // tuna fruits along the top rim
        for (const off of [-0.45, 0, 0.45]) {
          const ax = Math.round(off * rx), by = cy + Math.round(ry * Math.sqrt(1 - off * off)) + 1;
          const fx = axis === 'x' ? cx + ax : cx, fz = axis === 'x' ? cz : cz + ax;
          m.box(fx, by, fz - (axis === 'x' ? 1 : 0), fx + (axis === 'x' ? 1 : 0), by + 2, fz + (axis === 'z' ? 1 : 0) - (axis === 'x' ? 0 : 0), off === 0 ? 0xb83a6a : 0xd8487a);
          m.set(fx, by + 3, fz, 0xf8d878);
        }
      }
      return;
    }
    const kids = depth >= 2 ? r.int(2, 3) : r.int(1, 2);
    const angles = kids === 1 ? [r.range(-0.6, 0.6)] : kids === 2 ? [-0.55, 0.55] : [-0.75, 0, 0.75];
    angles.forEach((ang, k) => {
      const nrx = rx * r.range(0.8, 0.95), nry = ry * r.range(0.8, 0.95);
      const flip = r.chance(0.4);
      const nAxis: 'x' | 'z' = flip ? (axis === 'x' ? 'z' : 'x') : axis;
      // point on the parent's rim in its plane, then push the child outward along that direction
      const px = Math.sin(ang) * rx, py = Math.cos(ang) * ry;
      const dist = 0.75;
      const ox = Math.round(px + Math.sin(ang) * nrx * dist), oy = Math.round(py + Math.cos(ang) * nry * dist);
      const nx = axis === 'x' ? cx + ox : cx, nz = axis === 'z' ? cz + ox : cz;
      pad(nx, cy + oy, nz, nrx, nry, nAxis, depth - 1, idx + k + 1);
    });
  };
  const depth = o.damage >= 2 ? 0 : o.damage === 1 ? 1 : 2;
  pad(0, 8, 0, 6, 8, r.chance(0.5) ? 'x' : 'z', depth, seed);
  m.box(-1, 0, -1, 1, 1, 0, g.shade);
  sandDrift(m, 0, 0, 8, 8, 2, 0, seed);
  return m;
}

function organ(seed: number, o: CactusOpts): VoxelModel {
  const r = rngOf(seed, 41);
  const m = new VoxelModel('organ');
  const g = PR.cactus;
  const n = r.int(5, 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.next() * 0.4;
    const d = i === 0 ? 0 : r.range(5, 9);
    const x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
    const rr = r.pick([2.5, 3, 3]);
    let H = i === 0 ? r.int(56, 68) : r.int(26, 58) - Math.round(d);
    if (o.damage >= 2) H = Math.round(H * (o.damage === 3 ? 0.3 : 0.6));
    ribbedColumn(m, x, z, 0, H, rr, g, seed + i, o.damage < 2);
    if (o.damage === 0 && r.chance(0.35)) flower(m, x, H + 1, z, 0xffd8e4, PR.paintYellow.base);
  }
  // shared base
  cylY(m, 0, 0, 0, 3, 8, g.shade);
  sandDrift(m, 0, 0, 9, 9, 2, 0, seed);
  return m;
}

function buildCactus(seed: number, kind: CactusKind, damage: number) {
  const o = { damage };
  switch (kind) {
    case 'barrel':
      return barrelCactus(seed, o);
    case 'prickly':
      return prickly(seed, o);
    case 'organ':
      return organ(seed, o);
    default:
      return saguaro(seed, o);
  }
}

/** seeded procedural cactus (clean ribs, arms, flowers) */
export function cactus(seed = 0, kind: CactusKind = 'saguaro'): StaticModel {
  return S(buildCactus(seed, kind, 0), VS);
}
/** damaged states: 1 = lost an arm + bullet holes, 2 = snapped, 3 = stump */
export function cactusDamaged(seed = 0, kind: CactusKind = 'saguaro', stage: 1 | 2 | 3 = 1): StaticModel {
  return S(buildCactus(seed, kind, stage), VS);
}

// ---------------------------------------------------------------------------
// rocks
// ---------------------------------------------------------------------------
function rockRamp(seed: number): Ramp {
  return [PR.redRock, PR.mesaRock, PR.greyRock, PR.redRock][mod(seed, 4)];
}

/** chunky bevelled rock built from 2–4 overlapping blocks, one clean stratum line */
export function rock(seed = 0, size: 1 | 2 | 3 = 2): StaticModel {
  const r = rngOf(seed, 51 + size);
  const m = new VoxelModel('rock');
  const rr = rockRamp(seed);
  const base = size === 1 ? 8 : size === 2 ? 15 : 26;
  const n = size === 1 ? 2 : size === 2 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const w = Math.round(base * r.range(0.7, 1.1)), d = Math.round(base * r.range(0.6, 1)), h = Math.round(base * r.range(0.5, 0.9) * (i === 0 ? 1 : 0.7));
    const ox = i === 0 ? 0 : Math.round(r.range(-0.5, 0.5) * base), oz = i === 0 ? 0 : Math.round(r.range(-0.45, 0.45) * base);
    chunk(m, ox - (w >> 1), 0, oz - (d >> 1), ox + (w >> 1), h, oz + (d >> 1), rr, 1, false, size + 1, seed * 13 + i);
  }
  // stratum band + darker base row
  const sy = Math.round(base * 0.35);
  m.forEach((x, y, z, c) => {
    if (c === rr.hi) return;
    if (y === sy && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, rr.shade);
    if (y === 0) m.set(x, y, z, rr.shade);
  });
  if (size >= 2) {
    // a couple of pebbles
    for (let i = 0; i < 2; i++) {
      const a = r.next() * Math.PI * 2, d = base * 0.75;
      const px = Math.round(Math.cos(a) * d), pz = Math.round(Math.sin(a) * d);
      chunk(m, px, 0, pz, px + 2, 1, pz + 2, rr, 1, false);
    }
  }
  return S(m, VS);
}

/** big faceted boulder (1/16): stacked bevelled chunks, a stratum line and a crack */
export function boulder(seed = 0): StaticModel {
  const r = rngOf(seed, 61);
  const m = new VoxelModel('boulder');
  const rr = rockRamp(seed + 1);
  chunk(m, -22, 0, -16, 20, 22, 17, rr, 2, false, 3, seed * 5 + 1);
  chunk(m, -14 + r.int(-3, 3), 14, -12, 12 + r.int(-3, 3), 34, 12, rr, 2, false, 3, seed * 5 + 2);
  chunk(m, 12, 0, -10 + r.int(-4, 4), 30, 14, 12, rr, 1, false, 2, seed * 5 + 3);
  chunk(m, -30, 0, 0, -16, 10, 16, rr, 1, false, 2, seed * 5 + 4);
  // stratum line + darker base row
  m.forEach((x, y, z, c) => {
    if (c === rr.hi) return;
    const side = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (side && (y === 9 || y === 25)) m.set(x, y, z, rr.shade);
    else if (y < 2) m.set(x, y, z, rr.shade);
  });
  // crack: zig-zag down the front face
  let cx = r.int(-6, 4);
  for (let y = 33; y > 4; y--) {
    if (y % 4 === 0) cx += r.pick([-1, 1]);
    for (let z = 30; z > -30; z--) {
      if (m.has(cx, y, z)) {
        m.set(cx, y, z, rr.dark);
        break;
      }
    }
  }
  sandDrift(m, -4, 0, 30, 24, 4, 0, seed);
  return S(m, 1 / 16);
}

// ---------------------------------------------------------------------------
// tumbleweed
// ---------------------------------------------------------------------------
export function tumbleweed(seed = 0): StaticModel {
  const r = rngOf(seed, 71);
  const m = new VoxelModel('tumbleweed');
  const R = 8;
  const N = 34;
  const pts: V3[] = [];
  const rot = r.next() * Math.PI;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.399963 + rot;
    const rr = R * r.range(0.82, 1.0);
    pts.push([Math.cos(th) * rad * rr, y * rr * 0.92, Math.sin(th) * rad * rr]);
  }
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const e of near) {
      const q = pts[e.j];
      const col = (i + e.j) % 3 === 0 ? PR.twig.shade : (i + e.j) % 3 === 1 ? PR.twig.base : PR.twig.hi;
      seg(m, [p[0], p[1] + R, p[2]], [q[0], q[1] + R, q[2]], 1, col);
    }
  });
  // a few inner twigs through the middle
  for (let i = 0; i < 6; i++) {
    const a = pts[r.int(0, N - 1)], b = pts[r.int(0, N - 1)];
    seg(m, [a[0] * 0.8, a[1] * 0.8 + R, a[2] * 0.8], [b[0] * 0.8, b[1] * 0.8 + R, b[2] * 0.8], 1, PR.twig.shade);
  }
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// palm
// ---------------------------------------------------------------------------
export function palm(seed = 0): StaticModel {
  const r = rngOf(seed, 81);
  const m = new VoxelModel('palm');
  const H = r.int(64, 92);
  const lean = r.range(4, 12) * r.pick([-1, 1]);
  const leanZ = r.range(-4, 4);
  const bark = { base: 0xb08a5a, shade: 0x8e6c42, hi: 0xc8a272, dark: 0x6a4e2c };
  let topX = 0, topZ = 0;
  for (let y = 0; y <= H; y++) {
    const t = y / H;
    const ox = Math.round(lean * t * t), oz = Math.round(leanZ * t * t);
    const rr = 3.2 - t * 1.0;
    const ring = y % 4 === 0;
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) {
        if (!inCircle(x, z, rr)) continue;
        const outer = !inCircle(x, z, rr - 1);
        m.set(ox + x, y, oz + z, ring && outer ? bark.shade : outer && (x + z + (y >> 2)) % 3 === 0 ? bark.hi : bark.base);
      }
    topX = ox;
    topZ = oz;
  }
  // crown bulb
  blob(m, topX, H + 2, topZ, 3, 3, 3, PR.leaf.shade);
  // fronds
  const n = r.int(7, 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.next() * 0.3;
    const len = r.int(20, 28);
    const ca = Math.cos(a), sa = Math.sin(a);
    const rise = r.range(4, 8);
    for (let k = 0; k <= len; k++) {
      const t = k / len;
      const x = topX + ca * k, z = topZ + sa * k;
      const y = H + 3 + rise * Math.sin(t * Math.PI * 0.55) * 1.4 - t * t * 16;
      m.set(Math.round(x), Math.round(y), Math.round(z), PR.leaf.dark);
      // leaflets both sides, shortening to the tip
      const ll = Math.round((1 - t) * 6 + 1);
      for (let s of [-1, 1])
        for (let q = 1; q <= ll; q++) {
          const lx = x - sa * q * s, lz = z + ca * q * s;
          const ly = y - q * 0.45;
          m.set(Math.round(lx), Math.round(ly), Math.round(lz), q === ll ? PR.leaf.shade : (k + q) % 4 === 0 ? PR.leaf.hi : PR.leaf.base);
        }
    }
  }
  // dates
  for (let i = 0; i < 3; i++) {
    const a = r.next() * Math.PI * 2;
    blob(m, topX + Math.round(Math.cos(a) * 3), H - 1, topZ + Math.round(Math.sin(a) * 3), 1.6, 2.4, 1.6, i % 2 ? 0xc8742a : 0xa85a22);
  }
  sandDrift(m, 0, 0, 6, 6, 2, 0, seed);
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// shrubs & reeds
// ---------------------------------------------------------------------------
export function dryBush(seed = 0): StaticModel {
  const r = rngOf(seed, 91);
  const m = new VoxelModel(seed >= 10 ? 'reeds' : 'bush');
  if (seed >= 10) {
    const n = r.int(12, 18);
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2, d = r.range(0, 5);
      const x0 = Math.round(Math.cos(a) * d), z0 = Math.round(Math.sin(a) * d);
      const h = r.int(18, 34);
      const lx = r.range(-3, 3), lz = r.range(-3, 3);
      for (let y = 0; y <= h; y++) {
        const t = y / h;
        const c = y < 3 ? PR.leaf.shade : t > 0.75 ? PR.hay.base : (y >> 2) % 2 ? PR.leaf.base : PR.leaf.hi;
        m.set(Math.round(x0 + lx * t * t), y, Math.round(z0 + lz * t * t), c);
      }
      if (r.chance(0.45)) {
        const tx = Math.round(x0 + lx), tz = Math.round(z0 + lz);
        m.box(tx, h - 6, tz, tx, h - 2, tz, 0x7a4a26);
        m.set(tx, h - 7, tz, 0x5e3a1c);
      }
    }
    return S(m, VS);
  }
  const yellow = r.chance(0.4);
  const leaf = r.chance(0.5) ? PR.oliveLeaf : PR.leaf;
  const n = r.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.next() * 0.5;
    const len = r.range(7, 11);
    const tip: V3 = [Math.cos(a) * len, r.range(8, 14), Math.sin(a) * len];
    seg(m, [0, 0, 0], tip, 1, PR.twig.shade);
    const br: V3 = [tip[0] * 0.5, tip[1] * 0.55, tip[2] * 0.5];
    seg(m, br, [br[0] + Math.cos(a + 1) * 4, br[1] + 4, br[2] + Math.sin(a + 1) * 4], 1, PR.twig.base);
    blob(m, Math.round(tip[0]), Math.round(tip[1]), Math.round(tip[2]), 3.2, 2.6, 3.2, leaf.base);
    blob(m, Math.round(br[0] + Math.cos(a + 1) * 4), Math.round(br[1] + 4), Math.round(br[2] + Math.sin(a + 1) * 4), 2.2, 2, 2.2, leaf.base);
  }
  // top highlights & under shade on the leaf clumps
  const out: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (c !== leaf.base) return;
    if (!m.has(x, y + 1, z)) out.push([x, y, z, leaf.hi]);
    else if (!m.has(x, y - 1, z)) out.push([x, y, z, leaf.shade]);
  });
  for (const [x, y, z, c] of out) m.set(x, y, z, c);
  if (yellow) {
    m.forEach((x, y, z, c) => {
      if (c === leaf.hi && mod(x * 3 + z * 5 + y, 7) === 0) m.set(x, y + 1, z, PR.paintYellow.hi);
    });
  }
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// bones
// ---------------------------------------------------------------------------
const B = PR.bone;

/** cartoon cow skull with long horns; origin centre; faces +Z */
export function cowSkullModel(): VoxelModel {
  const m = new VoxelModel('cow_skull');
  // cranium + long tapering snout
  m.box(-4, 6, -4, 4, 12, 3, B.base);
  m.box(-3, 4, 3, 3, 10, 9, B.base);
  m.box(-2, 3, 9, 2, 8, 12, B.base);
  // bevel corners
  for (const [x, y, z] of [[-4, 12, -4], [4, 12, -4], [-4, 12, 3], [4, 12, 3], [-3, 10, 9], [3, 10, 9], [-2, 8, 12], [2, 8, 12], [-2, 3, 12], [2, 3, 12]]) m.del(x, y, z);
  m.box(-3, 13, -3, 3, 13, 1, B.hi);
  // eye sockets
  for (const sx of [-1, 1]) {
    m.box(sx * 3 - 1, 8, 2, sx * 3 + 1, 10, 4, B.dark);
    m.box(sx * 3 - 1, 8, 3, sx * 3 + 1, 10, 4, PR.socket.base);
  }
  // nostrils
  m.set(-1, 5, 12, PR.socket.base).set(1, 5, 12, PR.socket.base);
  // horns: out then up and forward
  for (const sx of [-1, 1]) {
    const pts: V3[] = [[sx * 4, 11, -2], [sx * 9, 11, -2], [sx * 13, 13, -1], [sx * 15, 17, 0], [sx * 15, 20, 1]];
    for (let i = 0; i < pts.length - 1; i++) seg(m, pts[i], pts[i + 1], i < 2 ? 2 : 1, i < 2 ? B.shade : 0xfff6e2);
    m.set(sx * 15, 21, 1, 0x8a7a64);
  }
  // seam line on the snout
  m.box(0, 9, 4, 0, 10, 8, B.shade);
  return m;
}

export function skull(kind: 'cow' | 'giant' = 'cow'): StaticModel {
  if (kind === 'cow') {
    const m = cowSkullModel();
    const out = new VoxelModel('skull_cow');
    // lying on the ground, slightly sunk
    m.forEach((x, y, z, c, f) => out.set(x, y - 3, z, c, f));
    out.carveWhere((_x, y) => y < 0);
    sandDrift(out, 0, 0, 7, 9, 2, 0, 3);
    return S(out, VS);
  }
  // giant beast skull half-buried, 1/12
  const m = new VoxelModel('skull_giant');
  const vs = 1 / 12;
  blob(m, 0, 14, -4, 18, 16, 16, B.base);
  m.box(-12, 4, 8, 12, 20, 34, B.base);
  for (let z = 30; z <= 38; z++) m.box(-11 + (z - 30) / 2, 4, z, 11 - (z - 30) / 2, 17 - (z - 30) / 2, z, B.base);
  // brow ridge highlight
  m.box(-16, 27, 4, 16, 28, 10, B.hi);
  // huge sockets
  for (const sx of [-1, 1]) {
    blob(m, sx * 9, 19, 9, 5, 5, 6, PR.socket.base);
    m.carveEllipsoid(sx * 9, 19, 14, 5, 5, 3);
  }
  // nasal
  m.carveBox(-2, 14, 36, 2, 17, 40);
  m.box(-2, 13, 33, 2, 13, 36, PR.socket.base);
  // teeth row
  for (let x = -10; x <= 10; x += 3) {
    m.box(x, 0, 34 - Math.abs(x) / 2, x + 1, 4, 35 - Math.abs(x) / 2, B.hi);
  }
  // horns curling back
  for (const sx of [-1, 1]) {
    let p: V3 = [sx * 14, 24, -6];
    for (let i = 0; i < 9; i++) {
      const np: V3 = [p[0] + sx * 3, p[1] + (i < 5 ? 3 : -1), p[2] - 3 + (i > 5 ? 4 : 0)];
      seg(m, p, np, Math.max(2, 5 - Math.floor(i / 2)), i % 3 === 0 ? B.shade : B.base);
      p = np;
    }
  }
  // crack
  for (let i = 0; i < 10; i++) m.set(-3 + (i % 3), 30 - i, 0 + i, B.dark);
  m.carveWhere((_x, y) => y < 0);
  sandDrift(m, 0, 4, 26, 30, 8, 0, 5);
  return S(m, vs);
}

/** giant rib arch (tunnel of ribs + spine), 1/12. seed 9 = bone gate (tusk arch with skull keystone) */
export function ribArch(seed = 0): StaticModel {
  const vs = 1 / 12;
  const m = new VoxelModel('rib_arch');
  if (seed === 9) {
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const x = sx * (36 - Math.sin(t * Math.PI * 0.5) * 30 - t * 4);
        const y = Math.sin(t * Math.PI * 0.5) * 70;
        const w = 7 - t * 4;
        cylH(m, 'z', -2, 2, Math.round(y), 0, w * 0.5, B.base);
        for (let dx = -Math.ceil(w / 2); dx <= w / 2; dx++) m.box(Math.round(x) + dx, Math.round(y), -2, Math.round(x) + dx, Math.round(y) + 2, 2, i % 8 === 0 ? B.shade : B.base);
      }
    }
    const sk = cowSkullModel();
    sk.forEach((x, y, z, c, f) => {
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) m.set(x * 2 + a, 62 + y * 2 + b, z * 2 + d - 6, c, f);
    });
    sandDrift(m, -36, 0, 10, 10, 5, 0, 1);
    sandDrift(m, 36, 0, 10, 10, 5, 0, 2);
    return S(m, vs);
  }
  const n = 5;
  const spanX = 42, h = 66;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * 22;
    const sc = 1 - Math.abs(i - (n - 1) / 2) * 0.12;
    for (const sx of [-1, 1]) {
      let prev: V3 | null = null;
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const ang = t * Math.PI * 0.5;
        const p: V3 = [sx * spanX * sc * Math.cos(ang), h * sc * Math.sin(ang), z];
        if (prev) seg(m, prev, p, 5 - Math.round(t * 2), k % 6 === 0 ? B.shade : B.base);
        prev = p;
      }
    }
  }
  // spine along the top
  for (let z = -50; z <= 50; z++) {
    const sc = 1 - Math.abs(z / 22) * 0.12;
    const y = Math.round(h * sc);
    m.box(-3, y, z, 3, y + 4, z, z % 7 === 0 ? B.shade : B.base);
    if (z % 7 === 3) m.box(-1, y + 5, z, 1, y + 9, z + 1, B.hi);
  }
  for (const sx of [-1, 1]) sandDrift(m, sx * spanX, 0, 8, 56, 6, 0, sx + 3);
  return S(m, vs);
}

/** small scatter: femur, ribs and a little skull on the sand */
export function boneScatter(seed = 0): StaticModel {
  const r = rngOf(seed, 101);
  const m = new VoxelModel('bone_scatter');
  // femur
  const fa = r.next() * Math.PI;
  const fx = Math.cos(fa), fz = Math.sin(fa);
  for (let k = -7; k <= 7; k++) m.box(Math.round(fx * k), 0, Math.round(fz * k), Math.round(fx * k), 1, Math.round(fz * k), B.base);
  for (const s of [-1, 1]) m.box(Math.round(fx * 8 * s) - 1, 0, Math.round(fz * 8 * s) - 1, Math.round(fx * 8 * s) + 1, 2, Math.round(fz * 8 * s) + 1, B.hi);
  // ribs (curved)
  for (let i = 0; i < 3; i++) {
    const ox = r.int(-10, 10), oz = r.int(5, 12) * r.pick([-1, 1]);
    for (let k = 0; k <= 8; k++) m.set(ox + k, k < 4 ? k >> 1 : (8 - k) >> 1, oz + Math.round(Math.sin(k / 8 * Math.PI) * 2), k % 4 === 0 ? B.shade : B.base);
  }
  // little skull
  const sx = r.int(-8, 8), sz = r.int(-8, 8);
  m.box(sx - 3, 0, sz - 3, sx + 3, 5, sz + 3, B.base);
  for (const [x, y, z] of [[-3, 5, -3], [3, 5, -3], [-3, 5, 3], [3, 5, 3]]) m.del(sx + x, y, sz + z);
  m.box(sx - 2, 3, sz + 3, sx - 1, 4, sz + 3, PR.socket.base);
  m.box(sx + 1, 3, sz + 3, sx + 2, 4, sz + 3, PR.socket.base);
  m.box(sx - 2, 1, sz + 3, sx + 2, 1, sz + 3, B.shade);
  m.box(sx - 2, 6, sz - 2, sx + 2, 6, sz + 2, B.hi);
  return S(m, VS);
}

