// Wild sights of the open desert (the zone POIs, see world/RegionGen placePois):
//  - rockArch:      a natural sandstone arch you ride under (strata, tafoni pits, wind flutes, varnish)
//  - colossusLegs:  "two vast and trunkless legs of stone" on a cracked, inscribed pedestal
//  - colossusHead:  the shattered visage lying half sunk nearby (nemes with paint traces, carved eyes)
//  - shipwreck:     a galleon run aground in the sea of sand, ribs showing, masts snapped, sail in rags
//  - shrine:        a stepped stone shrine with a Bastet idol (or a recumbent Anubis), offerings, prayer cloths
//  - cairn:         a wayfinder's stone stack on the viewpoints, pole, pennant and a lashed cow skull
// Big forms are signed-distance sculpts voxelised block by block (empty / solid blocks skipped,
// only the blocks the surface passes through are evaluated per voxel), then weathered.
import { VoxelModel, VF, mulRGB, mix } from '../../../engine/voxel/VoxelModel';
import { Noise, RNG, hash3, clamp, smoothstep } from '../../../engine/math/rand';
import { PR } from './helpers';
import type { StaticModel } from './helpers';
import { cowSkullModel } from './nature';
import { NOCOL } from './ruins';

/** drifted sand / cloth never becomes a collider */
const SOFT = () => NOCOL;

type Sdf = (x: number, y: number, z: number) => number;
/** colour (rgb) for a voxel at depth d (<= 0); null leaves it empty */
type Paint = (x: number, y: number, z: number, d: number) => number | null;

/**
 * Voxelise a signed-distance sculpt (voxel units, < 0 inside) over an inclusive box. Blocks
 * whose centre is clearly outside are skipped, blocks clearly inside are filled with `core`
 * without evaluating (never seen), the rest are evaluated per voxel and painted.
 */
function sculpt(m: VoxelModel, b: [number, number, number, number, number, number], sdf: Sdf, paint: Paint, core: number, flags?: (rgb: number) => number) {
  const [x0, y0, z0, x1, y1, z1] = b.map(Math.round) as [number, number, number, number, number, number];
  const BS = 4,
    MARGIN = 6;
  for (let bz = z0; bz <= z1; bz += BS)
    for (let by = y0; by <= y1; by += BS)
      for (let bx = x0; bx <= x1; bx += BS) {
        const c = sdf(bx + 1.5, by + 1.5, bz + 1.5);
        if (c > MARGIN) continue;
        const solid = c < -MARGIN - 2;
        for (let z = bz; z < bz + BS && z <= z1; z++)
          for (let y = by; y < by + BS && y <= y1; y++)
            for (let x = bx; x < bx + BS && x <= x1; x++) {
              if (solid) {
                m.set(x, y, z, core, flags ? flags(core) : VF.SOLID);
                continue;
              }
              const d = sdf(x, y, z);
              if (d > 0) continue;
              const col = paint(x, y, z, d);
              if (col === null) continue;
              m.set(x, y, z, col, flags ? flags(col) : VF.SOLID);
            }
      }
}

const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
/** ellipsoid (approximate distance, good enough for sculpting) */
const sdEll = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
  const k = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz));
  return (k - 1) * Math.min(rx, ry, rz);
};
const sdBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number, r = 0) => {
  const qx = Math.abs(x) - hx + r,
    qy = Math.abs(y) - hy + r,
    qz = Math.abs(z) - hz + r;
  const ox = Math.max(qx, 0),
    oy = Math.max(qy, 0),
    oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
/** tapered capsule from a (radius ra) to b (radius rb) */
const sdCap = (x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) => {
  const px = x - ax, py = y - ay, pz = z - az;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
  const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
  return Math.sqrt(ex * ex + ey * ey + ez * ez) - (ra + (rb - ra) * t);
};
const jit = (c: number, x: number, y: number, z: number, a = 0.06) => mulRGB(c, 1 + (hash3(x, y, z) - 0.5) * a);

/** a wind-shaped sand drift (voxel units): long tail downwind (+x), steep stoss */
function driftSdf(x: number, y: number, z: number, cx: number, cz: number, rx: number, rz: number, h: number, nz: Noise) {
  const lx = x - cx, lz = z - cz;
  const ex = lx > 0 ? lx / (rx * 1.5) : lx / rx;
  const d = Math.sqrt(ex * ex + (lz / rz) ** 2);
  if (d >= 1) return y + 1 + (d - 1) * Math.min(rx, rz);
  const k = Math.pow(1 - d, 1.3);
  const top = h * k * (1 + nz.n2(x * 0.08, z * 0.08) * 0.18);
  return y - top + 0.5;
}
const SAND = { base: 0xeac389, shade: 0xd6aa70, hi: 0xf8dcaa, lo: 0xc89a62 };
const sandCol = (x: number, y: number, z: number, top: boolean) => jit(top ? (hash3(x, 3, z) > 0.7 ? SAND.hi : SAND.base) : SAND.shade, x, y, z, 0.05);

// ---------------------------------------------------------------------------
// Natural sandstone arch (1/5 m). Entrada-red with a pale cap band, 23-27 m span,
// 11-14 m of clearance under the crown. Faces +z/-z; the span runs along x.
const ARCH = { base: 0xc77a4a, shade: 0xa8603c, deep: 0x84462c, hi: 0xe09c68, cream: 0xe2b88c, bleach: 0xf0d0a2, varnish: 0x5a3324 };
export function rockArch(v = 0): StaticModel {
  const vs = 1 / 5;
  const M = (m: number) => m / vs;
  const rng = new RNG(4041 + v * 977);
  const nz = new Noise(812 + v * 31);
  const span = M(rng.range(23, 27)),
    H = M(rng.range(12.5, 15));
  const skew = rng.range(0.82, 1.2);
  const R0 = M(rng.range(2.5, 3.1)),
    R1 = M(rng.range(1.2, 1.55));
  const zs = rng.range(1.25, 1.6);
  const N = 40;
  const P: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const tt = Math.pow(t, skew);
    P.push([(t - 0.5) * span + Math.sin(t * Math.PI * 2) * M(0.8), H * Math.pow(Math.sin(Math.PI * tt), 0.62)]);
  }
  const feet = [P[0], P[N]];
  const X = Math.ceil(span / 2 + M(6)),
    Z = Math.ceil(R0 * zs * 1.5 + M(4)),
    YT = Math.ceil(H + R1 * 1.6 + M(1.2));
  // the arch is a swept section: the (x, y) distance to the spine is tabulated once
  const GW = 2 * X + 1, GH = YT + 1;
  const SD = new Float32Array(GW * GH), ST = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      const x = gx - X, y = gy;
      let best = 1e9, bt = 0;
      for (let i = 0; i < N; i++) {
        const [ax, ay] = P[i], [bx, by] = P[i + 1];
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        const ex = x - ax - dx * t, ey = y - ay - dy * t;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) {
          best = d2;
          bt = (i + t) / N;
        }
      }
      SD[gx + gy * GW] = best;
      ST[gx + gy * GW] = bt;
    }
  const sdf: Sdf = (x, y, z) => {
    const gi = clamp(Math.round(x) + X, 0, GW - 1) + clamp(Math.round(y), 0, GH - 1) * GW;
    const best = SD[gi], bt = ST[gi];
    const zz = z / zs;
    let r = R1 + (R0 - R1) * Math.pow(Math.abs(2 * bt - 1), 2.1);
    r *= 1 + 0.38 * smoothstep(M(3.2), 0, y); // flared feet
    let d = Math.sqrt(best + zz * zz) - r;
    // talus pedestals the legs rise from
    for (const [fx] of feet) d = smin(d, sdEll(x - fx, y + M(0.6), z, M(4.6), M(2.2), M(3.4)), M(1.6));
    if (d > 8) return d;
    // weathering: lumpy erosion, horizontal wind flutes, honeycomb tafoni pits
    d += nz.n3(x * 0.045, y * 0.045, z * 0.045) * M(0.42) + nz.n3(x * 0.16, y * 0.16, z * 0.16) * M(0.12);
    d += (Math.sin(y * 0.42 + nz.n2(x * 0.03, z * 0.03) * 3) * 0.5 + 0.5) * M(0.12);
    const pit = nz.n3(x * 0.1 + 7, y * 0.1, z * 0.1 - 3);
    if (pit > 0.5) d += Math.min(M(0.4), (pit - 0.5) * M(2.2));
    return d;
  };
  const strata = [ARCH.base, ARCH.shade, ARCH.hi, ARCH.base, ARCH.deep, ARCH.base, ARCH.shade, ARCH.hi];
  const capY = H - M(0.4);
  const paint: Paint = (x, y, z) => {
    const sw = nz.n2(x * 0.02, z * 0.02) * M(0.6);
    let c = strata[(((Math.floor((y + sw) / M(0.55)) % strata.length) + strata.length) % strata.length)];
    if (y + sw > capY) c = mix(c, ARCH.cream, 0.7); // the pale cap rock
    return c;
  };
  const m = new VoxelModel('rockArch' + v);
  sculpt(m, [-X, 0, -Z, X, YT, Z], sdf, paint, ARCH.shade);
  // exposure pass: sun-bleached tops and blown sand on the low ledges, desert varnish down the walls
  const recol: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    const top = !m.has(x, y + 1, z);
    const side = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (!top && !side && m.has(x, y - 1, z)) return;
    let k = c;
    if (top) k = y < M(4.5) && nz.n2(x * 0.1, z * 0.1) > -0.2 ? sandCol(x, y, z, true) : mix(c, ARCH.bleach, 0.35);
    else {
      const vs2 = nz.n2(x * 0.09 + 11, z * 0.06 - 4);
      if (vs2 > 0.25 && y > M(2)) k = mix(c, ARCH.varnish, Math.min(0.7, 0.35 + (vs2 - 0.25) * 1.3));
      if (!m.has(x, y - 1, z)) k = mulRGB(k, 0.86); // overhang undersides
    }
    recol.push([x, y, z, jit(k, x, y, z, 0.07)]);
  });
  for (const [x, y, z, c] of recol) m.set(x, y, z, c);
  // drifts piled against the feet
  for (const [fx] of feet) {
    const dz0 = rng.range(-M(1), M(1));
    sculpt(m, [fx - M(9), 0, -Z, fx + M(12), M(3.2), Z], (x, y, z) => (m.has(x, y, z) ? 1 : driftSdf(x, y, z, fx + M(1.5), dz0, M(6), M(4.5), M(2.4), nz)), (x, y, z) => sandCol(x, y, z, !m.has(x, y + 1, z)), SAND.lo, SOFT);
  }
  return { model: m, voxelSize: vs };
}

// ---------------------------------------------------------------------------
// The colossus (1/8 m): striding legs broken at the thigh on an inscribed pedestal, and the
// fallen head lying on its cheek, half sunk.
const COL = { base: 0xd6ae80, shade: 0xb48a5e, deep: 0x8c6646, hi: 0xecca9a, crack: 0x5e422c, glyph: 0x9a744e };
function stoneCol(x: number, y: number, z: number, nz: Noise, top: boolean) {
  const n = nz.n3(x * 0.05, y * 0.05, z * 0.05);
  let c = n > 0.35 ? COL.hi : n < -0.4 ? COL.shade : COL.base;
  if (top) c = mix(c, COL.hi, 0.4);
  return jit(c, x, y, z, 0.06);
}
export function colossusLegs(): StaticModel {
  const vs = 1 / 8;
  const M = (m: number) => m / vs;
  const nz = new Noise(5150);
  const PH = M(2.0); // pedestal height
  const legs = [
    { x: M(1.05), A: [M(1.05), PH + M(0.8), M(1.35)], K: [M(1.05), PH + M(5.2), M(0.8)], Hp: [M(0.9), PH + M(9.6), M(0.1)], br: PH + M(8.3) },
    { x: -M(1.05), A: [-M(1.05), PH + M(0.8), -M(0.9)], K: [-M(1.05), PH + M(5.2), -M(0.65)], Hp: [-M(0.9), PH + M(9.6), -M(0.2)], br: PH + M(6.6) },
  ];
  const hem = PH + M(7.4);
  const foot = (x: number, y: number, z: number, L: (typeof legs)[number]) => {
    const fx = L.A[0], az = L.A[2];
    const heel = az - M(0.85), toe = az + M(2.55);
    const u = clamp((z - heel) / (toe - heel), 0, 1);
    const top = PH + M(0.12) + M(0.95) * Math.pow(1 - u, 1.3) * smoothstep(1, 0.15, u) + M(0.3);
    const halfW = M(0.62) + M(0.12) * Math.sin(u * Math.PI * 0.9);
    let d = Math.max(Math.abs(x - fx) - halfW, PH - y, y - top, heel - z, z - toe);
    // rounded heel and toes
    d = smax(d, Math.hypot(x - fx, z - heel - halfW) - halfW - (z < heel + halfW ? 0 : 99), M(0.15));
    d = Math.min(d, sdEll(x - fx, y - (PH + M(0.85)), z - (az - M(0.15)), M(0.5), M(0.55), M(0.62))); // ankle bones
    // carved toe grooves at the front
    if (z > toe - M(0.55) && y > PH + M(0.08)) {
      const g = ((x - fx + M(0.62)) / M(1.24)) * 5;
      if (Math.abs(g - Math.round(g)) < 0.12 && g > 0.5 && g < 4.5) d = Math.max(d, -0.6);
    }
    return d;
  };
  const sdf: Sdf = (x, y, z) => {
    // pedestal: chamfered block, chipped corners, a crack
    let d = sdBox(x, y - PH / 2, z, M(3.3), PH / 2, M(2.3), M(0.12));
    const edge = Math.min(M(3.3) - Math.abs(x), M(2.3) - Math.abs(z), PH - y);
    if (edge < M(0.5)) d += Math.max(0, nz.n3(x * 0.12, y * 0.12, z * 0.12) - 0.15) * M(0.5);
    for (const L of legs) {
      if (y < PH + M(1.6)) d = Math.min(d, foot(x, y, z, L));
      // shin with a calf bulging behind, knee cap in front, thigh up to the jagged break
      const [ax, ay, az] = L.A, [kx, ky, kz] = L.K, [hx, hy, hz] = L.Hp;
      let leg = sdCap(x, y, z, ax, ay, az, kx, ky, kz, M(0.48), M(0.56));
      leg = smin(leg, sdEll(x - (ax + kx) / 2, y - (ay * 0.45 + ky * 0.55), z - ((az + kz) / 2 - M(0.28)), M(0.55), M(1.4), M(0.5)), M(0.3));
      leg = smin(leg, sdEll(x - kx, y - ky, z - kz - M(0.42), M(0.34), M(0.38), M(0.22)), M(0.12));
      leg = smin(leg, sdCap(x, y, z, kx, ky, kz, hx, hy, hz, M(0.58), M(0.86)), M(0.25));
      const brk = L.br + nz.n2(x * 0.09 + L.x, z * 0.09) * M(0.45) + (x - L.x) * 0.18;
      leg = Math.max(leg, y - brk);
      // the hem of the pleated kilt still clings to the taller leg
      if (L.br > hem) {
        const r = M(1.05) + (y - hem) * 0.05;
        const kilt = Math.max(Math.hypot(x - L.x * 0.8, z - M(0.3)) - r, hem - y, y - brk);
        const pleat = Math.sin(Math.atan2(z - M(0.3), x - L.x * 0.8) * 22) * 0.5 + 0.5;
        leg = Math.min(leg, kilt + pleat * 0.7);
      }
      d = Math.min(d, leg);
    }
    return d + nz.n3(x * 0.2, y * 0.2, z * 0.2) * 0.45;
  };
  const paint: Paint = (x, y, z, d) => {
    const top = d > -1.4 && sdf(x, y + 1.5, z) > 0;
    let c = stoneCol(x, y, z, nz, top);
    // fracture faces: fresher, paler stone
    for (const L of legs) if (Math.abs(x - L.x) < M(1.1) && y > L.br - M(0.7) && top) c = jit(mix(COL.hi, 0xf4e0bc, 0.4), x, y, z);
    // inscription band on the pedestal faces (carved cartouche glyphs)
    if (y > M(0.55) && y < M(1.45) && d > -1.2) {
      const onFront = Math.abs(Math.abs(z) - M(2.3)) < 1.5, onSide = Math.abs(Math.abs(x) - M(3.3)) < 1.5;
      if (onFront || onSide) {
        const u = onFront ? x : z;
        const gx = Math.floor(u / 3), gy = Math.floor((y - M(0.55)) / 3);
        if (hash3(gx, gy, onFront ? 1 : 2) > 0.55 && (u % 3 + 3) % 3 !== 0) c = jit(COL.glyph, x, y, z);
        if (Math.abs(y - M(0.55)) < 1 || Math.abs(y - M(1.45)) < 1) c = jit(COL.deep, x, y, z);
      }
    }
    // a dark crack running up the pedestal and the shorter shin
    const cr = Math.abs(x + M(2.2) - Math.sin(y * 0.1) * M(0.3) - nz.n2(y * 0.2, 1) * 2);
    if (cr < 0.8 && d > -1.5) c = COL.crack;
    // sand-blasted base
    if (y < M(0.5) && d > -1.5) c = mix(c, SAND.shade, 0.35);
    return c;
  };
  const m = new VoxelModel('colossusLegs');
  sculpt(m, [-M(3.6), 0, -M(2.6), M(3.6), PH + M(10), M(4.2)], sdf, paint, COL.shade);
  // drift heaped against the pedestal (up its upwind side, trailing down the lee)
  sculpt(m, [-M(7), 0, -M(5.5), M(9), M(1.8), M(5.5)], (x, y, z) => (m.has(x, y, z) ? 1 : driftSdf(x, y, z, -M(2.6), M(0.6), M(5), M(4.2), M(1.6), nz)), (x, y, z) => sandCol(x, y, z, !m.has(x, y + 1, z)), SAND.lo, SOFT);
  return { model: m, voxelSize: vs };
}

const PAINT_LAPIS = 0x5f7fa6,
  PAINT_GOLD = 0xd9b45e,
  PAINT_SKIN = 0xb8754e;
export function colossusHead(upright = false): StaticModel {
  const vs = 1 / 8;
  const M = (m: number) => m / vs;
  const nz = new Noise(6262);
  // head-local frame: neck base at the origin, face looking +z, crown +y
  const eyeY = M(3.2), eyeX = M(0.62), faceZ = M(1.5);
  const head: Sdf = (x, y, z) => {
    const ax = Math.abs(x);
    // face
    let face = sdEll(x, y - M(2.75), z - M(0.25), M(1.32), M(1.85), M(1.42));
    face = smin(face, sdEll(x, y - M(1.55), z - M(0.75), M(0.78), M(0.62), M(0.85)), M(0.35)); // jaw / chin
    // brow ridge and cheekbones
    face = smin(face, sdEll(x, y - M(3.5), z - M(1.18), M(1.08), M(0.24), M(0.38)), M(0.2));
    face = smin(face, sdEll(ax - M(0.72), y - M(2.62), z - M(1.12), M(0.42), M(0.34), M(0.36)), M(0.25));
    // nose: a broken wedge (the tip is gone, a rough fracture)
    const nose = Math.max(sdBox(x, y - M(2.62), z - M(1.68), M(0.24) - (M(3.15) - y) * -0.04, M(0.62), M(0.3), M(0.06)), z - M(1.86) - nz.n2(x * 0.3, y * 0.3) * 1.2);
    face = smin(face, nose, M(0.12));
    // lips with the mouth line, false beard (broken off half-way)
    face = smin(face, sdEll(x, y - M(1.88), z - M(1.48), M(0.46), M(0.13), M(0.16)), M(0.06));
    face = smin(face, sdEll(x, y - M(1.66), z - M(1.42), M(0.4), M(0.13), M(0.16)), M(0.06));
    if (Math.abs(y - M(1.77)) < 0.6 && ax < M(0.42) && z > M(1.3)) face += 0.9;
    face = Math.min(face, Math.max(sdBox(x, y - M(0.8), z - M(1.0), M(0.3), M(0.6), M(0.26), M(0.06)), M(0.48) - y + nz.n2(x * 0.4, z * 0.4) * 1.5));
    // ears
    face = smin(face, sdEll(ax - M(1.28), y - M(2.75), z - M(0.05), M(0.18), M(0.5), M(0.34)), M(0.1));
    // eyes: an almond socket cut in, a convex eyeball, heavy upper lid, the kohl line to the temple
    const ey = y - eyeY, ex = ax - eyeX;
    const almond = Math.abs(ey) / M(0.2) + (ex * ex) / (M(0.38) * M(0.38));
    if (almond < 1.15 && z > M(0.9)) face = Math.max(face, -(z - (faceZ - M(0.1))));
    face = Math.min(face, sdEll(ex, ey, z - (faceZ - M(0.3)), M(0.34), M(0.17), M(0.22)));
    face = smin(face, sdEll(ex, ey - M(0.2), z - (faceZ - M(0.12)), M(0.42), M(0.07), M(0.14)), M(0.05));
    // nemes: hood over the crown, a front band, lappets falling past the jaw, flaring
    let nem = sdEll(x, y - M(3.35), z + M(0.2), M(1.78), M(1.62), M(1.75));
    nem = smin(nem, sdEll(x, y - M(2.3), z + M(0.75), M(1.45), M(1.5), M(1.05)), M(0.5)); // down over the nape
    nem = Math.max(nem, M(1.0) - y);
    const lw = M(1.55) + (M(2.6) - y) * 0.16;
    const lap = sdBox(ax - lw * 0.9, y - M(1.4), z - M(0.15), M(0.32), M(1.4), M(0.62), M(0.1));
    nem = smin(nem, lap, M(0.4));
    // the face opening (the hood never covers the face)
    nem = Math.max(nem, -sdBox(x, y - M(2.35), z - M(1.6), M(1.12), M(1.35), M(0.9), M(0.2)));
    nem = smin(nem, sdBox(x, y - M(3.92), z - M(0.45), M(1.42), M(0.14), M(1.25), M(0.05)), M(0.08)); // brow band
    // stripes cut into the hood
    const stripe = ((y + Math.max(0, -z) * 0.2) / M(0.36)) % 1;
    if (stripe < 0.22) nem += 0.7;
    let d = Math.min(face, nem);
    // uraeus stump on the band, a great chip knocked out of the crown
    d = Math.min(d, sdEll(x, y - M(4.12), z - M(1.66), M(0.16), M(0.32), M(0.14)));
    d = Math.max(d, -sdEll(x - M(1.0), y - M(4.6), z + M(0.4), M(1.0), M(0.7), M(0.9)) + nz.n3(x * 0.2, y * 0.2, z * 0.2) * 2);
    return d + nz.n3(x * 0.22, y * 0.22, z * 0.22) * 0.35;
  };
  // lying on its left cheek, tipped back, the crown toward -x; sunk a third into the sand
  const roll = upright ? 0 : 0.42, pitch = upright ? 0 : -0.32;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const C = [0, upright ? M(2.6) : M(1.25), 0];
  const local = (x: number, y: number, z: number): [number, number, number] => {
    // inverse of: rotate pitch about x, then roll about z, then translate by C (with the head's own centre offset)
    let px = x - C[0], py = y - C[1], pz = z - C[2];
    // undo roll (z axis)
    const rx = px * cr + py * sr, ry = -px * sr + py * cr;
    px = rx;
    py = ry;
    // undo pitch (x axis)
    const ry2 = py * cp + pz * sp, rz2 = -py * sp + pz * cp;
    return [px, ry2 + M(2.6), rz2];
  };
  const sdf: Sdf = (x, y, z) => {
    const [a, b, c] = local(x, y, z);
    return head(a, b, c);
  };
  const paint: Paint = (x, y, z, d) => {
    const [a, b, c] = local(x, y, z);
    const top = d > -1.4 && sdf(x, y + 1.5, z) > 0;
    let col = stoneCol(x, y, z, nz, top);
    const inHood = sdEll(a, b - M(3.35), c + M(0.2), M(1.9), M(1.75), M(1.9)) < 0 && !(Math.abs(a) < M(1.15) && b < M(3.8) && c > M(0.6));
    if (d > -1.5) {
      const stripe = ((b + Math.max(0, -c) * 0.2) / M(0.36)) % 1;
      // faded paint traces: lapis and gold in the stripes, red ochre on the face, black kohl
      if (inHood && nz.n3(a * 0.08, b * 0.08, c * 0.08) > -0.15) col = mix(col, Math.floor((b + Math.max(0, -c) * 0.2) / M(0.36)) % 2 ? PAINT_LAPIS : PAINT_GOLD, stripe < 0.3 ? 0.65 : 0.38);
      else if (!inHood && nz.n3(a * 0.1 + 4, b * 0.1, c * 0.1) > 0.1) col = mix(col, PAINT_SKIN, 0.35);
      const ey = b - eyeY, ex = Math.abs(a) - eyeX;
      const almond = Math.abs(ey) / M(0.2) + (ex * ex) / (M(0.38) * M(0.38));
      if (almond < 1.35 && almond > 0.85 && c > M(1.1)) col = 0x3a2a20; // kohl rim
      if (ex > M(0.3) && ex < M(0.85) && Math.abs(ey + ex * 0.05) < 1 && c > M(0.9)) col = 0x3a2a20; // kohl line to the temple
      if (ex * ex + ey * ey < M(0.1) * M(0.1) * 1.4 && c > M(1.15)) col = 0x4a3a2e; // carved iris
      if (almond < 0.85 && !(ex * ex + ey * ey < M(0.1) * M(0.1) * 1.4)) col = mix(col, 0xf2e4c8, 0.45); // the white of the eye, bleached
    }
    return col;
  };
  const m = new VoxelModel('colossusHead');
  const R = M(3.6);
  sculpt(m, [-R, 0, -R, R, M(5.2), R], sdf, paint, COL.shade);
  sculpt(m, [-R - M(3), 0, -R - M(2), R + M(4), M(1.8), R + M(2)], (x, y, z) => (m.has(x, y, z) ? 1 : driftSdf(x, y, z, -M(0.5), 0, M(4.2), M(3.6), M(1.7), nz)), (x, y, z) => sandCol(x, y, z, !m.has(x, y + 1, z)), SAND.lo, SOFT);
  return { model: m, voxelSize: vs };
}

// ---------------------------------------------------------------------------
// The sand galleon (1/8 m): 22 m hull run aground bow-up and listing, a side stove in
// showing the ribs, the waist deck fallen into a hold full of sand, masts snapped, the
// mainmast's yard still holding a torn sail, a broken bowsprit, a stern with windows.
const WOOD = { base: 0xa8937a, shade: 0x85725c, hi: 0xc6b498, dark: 0x5c4c3c, rib: 0x6e5844, rail: 0x907a62 };
export function shipwreck(v = 0): StaticModel {
  const vs = 1 / 8;
  const M = (m: number) => m / vs;
  const rng = new RNG(7301 + v * 53);
  const nz = new Noise(919 + v);
  const L = M(22), B = M(6.4), D = M(4.6);
  const hl = L / 2;
  // hull lines tabulated per station (voxel rows along the keel)
  const Z0 = Math.ceil(hl) + 8, NZ = 2 * Z0 + 1;
  const tDeck = new Float32Array(NZ), tKeel = new Float32Array(NZ), tHalf = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    const z = i - Z0;
    tDeck[i] = D + M(0.9) * (z / hl) ** 2 + (z < -hl + M(5.5) ? M(1.8) : 0) + (z > hl - M(4) ? M(1.0) : 0);
    tKeel[i] = M(0.4) * Math.max(0, (z - L / 4) / (L / 4)) ** 2 * 6;
    tHalf[i] = z >= 0 ? (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, z / hl), 1.7)), 0.75) : (B / 2) * (1 - 0.28 * Math.pow(Math.min(1, -z / hl), 4));
  }
  const zi = (z: number) => clamp(Math.round(z) + Z0, 0, NZ - 1);
  const deckY = (z: number) => tDeck[zi(z)];
  const keelY = (z: number) => tKeel[zi(z)];
  const halfB = (z: number) => tHalf[zi(z)];
  const sideX = (y: number, z: number) => {
    const k = keelY(z), dk = deckY(z);
    const t = clamp((y - k) / ((dk - k) * 0.72), 0, 1);
    let xs = halfB(z) * Math.pow(t, 0.42);
    if (y > k + (dk - k) * 0.72) xs *= 1 - 0.07 * ((y - k - (dk - k) * 0.72) / ((dk - k) * 0.28)); // tumblehome
    return Math.max(xs, M(0.25));
  };
  const hole = { z0: -M(2.6), z1: M(3.8), y0: M(1.1), y1: M(3.7) };
  const T = 1.6; // plank thickness (voxels)
  /** ship-local hull + rigging distance */
  const ship = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const k = keelY(z), dk = deckY(z);
    const xs = sideX(y, z);
    const zb = hl;
    const solid = Math.max(ax - xs, k - y, y - dk, z - zb, -hl - z);
    let d = Math.max(solid, -(solid + T)); // the planking shell
    // the waist deck collapsed into the hold
    if (Math.abs(z) < M(5) && y > dk - T - 1 && ax < xs - T) d = Math.max(d, 1);
    // the stove-in side: planks gone in a ragged hole
    const hn = nz.n2(y * 0.08, z * 0.08) * M(0.7);
    if (x > 0 && z > hole.z0 + hn && z < hole.z1 - hn && y > hole.y0 + hn * 0.6 && y < hole.y1 - hn * 0.5) d = Math.max(d, 1);
    // gun ports
    const gp = (((z + M(1.1)) % M(2.2)) + M(2.2)) % M(2.2);
    if (Math.abs(z) < M(6.5) && gp < M(0.7) && y > dk - M(1.5) && y < dk - M(0.85) && ax > xs - T - 1) d = Math.max(d, 1);
    // stern windows
    if (z < -hl + T + 1 && ax < M(2.1) && y > dk - M(1.4) && y < dk - M(0.6) && ((ax / M(0.7)) % 1) > 0.25) d = Math.max(d, 1);
    // ribs (frames) inside the planking
    if ((((z % M(0.7)) + M(0.7)) % M(0.7)) < 2 && ax < xs && ax > xs - T - 2.2 && y > k && y < dk) d = Math.min(d, -0.5);
    // bulwark rail with balusters on the castles, solid bulwark in the waist
    let rail = Math.max(y - dk - M(0.95), dk - y, Math.abs(ax - (xs - 0.75)) - 1.25, -hl - z, z - zb);
    const castle = z < -hl + M(5.5) || z > hl - M(4);
    const post = (((z % M(0.5)) + M(0.5)) % M(0.5)) < 1.5;
    if (castle && !post && y < dk + M(0.8)) rail = Math.max(rail, 1);
    d = Math.min(d, rail);
    // masts: the main snapped at 4.5 m over the deck, fore stump, mizzen at 2.6 m
    const masts: [number, number, number][] = [[M(0.8), M(4.6), M(0.3)], [M(7), M(1.3), M(0.24)], [-M(6.2), M(2.7), M(0.24)]];
    for (const [mz, top, r] of masts) {
      const tt = deckY(mz) + top + nz.n2(x * 0.5, z * 0.5) * M(0.3);
      d = Math.min(d, Math.max(Math.hypot(x, z - mz) - r, keelY(mz) - y, y - tt));
    }
    // the main yard (across), and its sail hanging in rags
    const yardY = deckY(M(0.8)) + M(4.0);
    d = Math.min(d, Math.max(Math.hypot(y - yardY, z - M(1.05)) - M(0.14), ax - M(3.6)));
    // bowsprit (broken)
    const bx0 = hl - M(1), by0 = deckY(hl) - M(0.3);
    d = Math.min(d, sdCap(x, y, z, 0, by0, bx0, 0, by0 + M(1.7), bx0 + M(3.4), M(0.3), M(0.2)));
    return d;
  };
  const sail = (x: number, y: number, z: number) => {
    const yardY = deckY(M(0.8)) + M(4.0);
    if (y > yardY || y < yardY - M(2.8) || Math.abs(x) > M(3.4)) return 9;
    const drop = (yardY - y) / M(2.8);
    // billows out to +z, the torn lower edge hangs in tongues; holes
    const sz = M(1.15) + Math.sin(drop * Math.PI) * M(0.55) * (1 - (x / M(3.4)) ** 2) + nz.n2(x * 0.1, y * 0.1) * 1.2;
    const tongue = drop > 0.55 + 0.35 * (nz.n2(x * 0.18, 4.2) * 0.5 + 0.5);
    if (tongue || nz.n2(x * 0.15 + 9, y * 0.15) > 0.5) return 9;
    return Math.abs(z - sz) - 0.6;
  };
  // world placement: stern down, listing to port, sunk to about the turn of the bilge
  const pitch = 0.17, roll = 0.2;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const sink = M(1.7);
  const local = (x: number, y: number, z: number): [number, number, number] => {
    const py = y + sink;
    // undo roll about z, then pitch about x
    const lx = x * cr + py * sr,
      ly = -x * sr + py * cr;
    return [lx, ly * cp - z * sp, ly * sp + z * cp];
  };
  const sdf: Sdf = (x, y, z) => {
    const [a, b, c] = local(x, y, z);
    return Math.min(ship(a, b, c), sail(a, b, c));
  };
  const paint: Paint = (x, y, z) => {
    const [a, b, c] = local(x, y, z);
    if (sail(a, b, c) <= 0) {
      const band = Math.floor((b - deckY(M(0.8))) / M(0.7)) % 3 === 0;
      return jit(band ? mix(PR.canvasStripe.base, PR.canvas.base, 0.45) : PR.canvas.base, x, y, z, 0.08);
    }
    const k = keelY(c);
    const ax = Math.abs(a);
    const xs = sideX(b, c);
    // ribs / masts / rails: darker structural timber
    if (ax < xs - T - 0.4 && b < deckY(c)) return jit(WOOD.rib, x, y, z);
    if (b > deckY(c) + 0.5) return jit(WOOD.rail, x, y, z);
    // strakes 0.4 m wide with a fine seam and staggered butt joints, sun-bleached up top
    const row = Math.floor((b - k) / 3.2);
    const seam = (((b - k) % 3.2) + 3.2) % 3.2 < 0.8;
    const butt = ((((c + row * 11) % M(3.2)) + M(3.2)) % M(3.2)) < 0.9;
    let col = hash3(row, Math.floor((c + row * 11) / M(3.2)), 7) > 0.62 ? WOOD.shade : WOOD.base;
    if (seam) col = mix(col, WOOD.dark, 0.55);
    else if (butt) col = mix(col, WOOD.dark, 0.35);
    if (b > deckY(c) - M(1.2)) col = mix(col, WOOD.hi, 0.45);
    return jit(col, x, y, z, 0.07);
  };
  const m = new VoxelModel('shipwreck' + v);
  sculpt(m, [-M(5.2), 0, -M(12.5), M(5.2), M(11.5), M(15.5)], sdf, paint, WOOD.dark);
  // the hold half full of sand; drifts against both flanks and over the sunken stern
  const drift = (x: number, y: number, z: number) => {
    const a = driftSdf(x, y, z, -M(3.4), -M(2), M(3.2), M(8), M(1.6), nz);
    const b2 = driftSdf(x, y, z, M(3.2), M(3), M(3), M(6), M(1.2), nz);
    return Math.min(a, b2);
  };
  sculpt(m, [-M(8), 0, -M(11), M(9), M(2), M(10)], (x, y, z) => (m.has(x, y, z) ? 1 : drift(x, y, z)), (x, y, z) => sandCol(x, y, z, !m.has(x, y + 1, z)), SAND.lo, SOFT);
  sculpt(m, [-M(3.5), 0, -M(6), M(3.5), M(2.4), M(6)], (x, y, z) => {
    if (m.has(x, y, z)) return 1;
    const [a, b, c] = local(x, y, z);
    const inHull = Math.abs(a) < sideX(b, c) - T && b > keelY(c) && Math.abs(c) < M(5.5);
    return inHull ? y - M(1.6) - nz.n2(x * 0.1, z * 0.1) * 2 : 1;
  }, (x, y, z) => sandCol(x, y, z, !m.has(x, y + 1, z)), SAND.lo, SOFT);
  void rng;
  return { model: m, voxelSize: vs };
}

// ---------------------------------------------------------------------------
// The shrine (1/12 m): a three-step platform of cracked slabs, a little naos with a
// cavetto cornice and a winged sun on the lintel. v0/v2: a seated Bastet idol inside;
// v1: closed doors with a recumbent black Anubis on the roof. Offering bowls with embers,
// prayer cloths strung between two poles, a fallen piece of the cornice.
const LIME = { base: 0xe0c9a0, shade: 0xbfa47c, deep: 0x95805e, hi: 0xf2e0bc, seam: 0x9c8664 };
export function shrine(v = 0): StaticModel {
  const vs = 1 / 12;
  const M = (m: number) => Math.round(m / vs);
  const rng = new RNG(2207 + v * 41);
  const nz = new Noise(3131 + v);
  const m = new VoxelModel('shrine' + v);
  const stone = (x: number, y: number, z: number, top: boolean) => {
    const n = nz.n3(x * 0.07, y * 0.07, z * 0.07);
    let c = n > 0.3 ? LIME.hi : n < -0.35 ? LIME.shade : LIME.base;
    if (top) c = mix(c, LIME.hi, 0.3);
    return jit(c, x, y, z, 0.05);
  };
  // the steps: chipped slabs with seams
  const steps = 3, SH = M(0.27);
  for (let s = 0; s < steps; s++) {
    const h = M(2.6) - s * M(0.48);
    for (let x = -h; x <= h; x++)
      for (let z = -h; z <= h; z++) {
        const edge = Math.min(h - Math.abs(x), h - Math.abs(z));
        for (let y = s * SH; y < (s + 1) * SH; y++) {
          if (edge < 2 && nz.n3(x * 0.25, y * 0.25, z * 0.25) > 0.35) continue; // chips
          const top = y === (s + 1) * SH - 1;
          const seam = top && (((x + 1000) % M(0.9) === 0) || ((z + 1000) % M(0.9) === 0));
          m.set(x, y, z, seam ? LIME.seam : stone(x, y, z, top));
        }
      }
  }
  const B0 = steps * SH;
  // the naos
  const nw = M(0.85), nd = M(0.75), nh = M(2.1), nzc = -M(0.45);
  const open = v !== 1;
  for (let x = -nw - 1; x <= nw + 1; x++)
    for (let z = nzc - nd; z <= nzc + nd; z++)
      for (let y = B0; y < B0 + nh; y++) {
        const ax = Math.abs(x);
        // torus roll on the corners, opening in the front
        if (ax > nw && (z === nzc - nd || z === nzc + nd)) continue;
        if (open && ax < M(0.5) && y < B0 + M(1.55) && z > nzc - nd + M(0.18)) continue;
        if (ax > nw) {
          if (!(z > nzc - nd && z < nzc + nd)) continue;
        }
        const top = y === B0 + nh - 1;
        m.set(x, y, z, stone(x, y, z, top));
      }
  // cavetto cornice: flaring overhang
  for (let i = 0; i < M(0.32); i++) {
    const o = Math.round(Math.pow(i / M(0.32), 1.8) * M(0.2));
    const y = B0 + nh + i;
    for (let x = -nw - 1 - o; x <= nw + 1 + o; x++)
      for (let z = nzc - nd - o; z <= nzc + nd + o; z++) {
        const shell = Math.abs(x) >= nw - 1 + o || z <= nzc - nd + 1 - o || z >= nzc + nd - 1 + o || i === M(0.32) - 1;
        if (!shell) continue;
        if (v === 2 && x > nw - 2 && z > nzc && nz.n2(x * 0.3, i) > -0.2) continue; // a corner broken off
        m.set(x, y, z, i === M(0.32) - 1 ? LIME.hi : (i & 1 ? LIME.base : LIME.shade));
      }
  }
  // winged sun on the lintel (relief), gold traces
  const lz = nzc + nd + 1, ly = B0 + M(1.78);
  for (let x = -M(0.62); x <= M(0.62); x++) {
    const ax = Math.abs(x);
    const wingH = ax < 2 ? 0 : Math.round(2 - (ax / M(0.62)) * 2);
    for (let y = ly - wingH; y <= ly + (ax < 2 ? 2 : 0); y++) m.set(x, y, lz, ax < 2 ? PR.gold.base : mix(LIME.base, PR.gold.shade, 0.4), ax < 2 ? VF.METAL : VF.SOLID);
  }
  if (open) {
    // seated Bastet: haunches, chest, forelegs, tall ears, tail curled round the feet
    const cz = nzc - M(0.05), cy = B0;
    const cat = new VoxelModel();
    const blk = 0x2e2a28, blkHi = 0x48423c;
    const put = (x: number, y: number, z: number, c: number, f: number = VF.SOLID) => cat.set(x, y, z, c, f);
    for (let x = -4; x <= 4; x++)
      for (let y = 0; y <= 11; y++)
        for (let z = -5; z <= 5; z++) {
          const hips = (x * x) / 16 + ((y - 3) * (y - 3)) / 14 + ((z + 1) * (z + 1)) / 14;
          const chest = (x * x) / 7 + ((y - 7.5) * (y - 7.5)) / 13 + ((z - 1) * (z - 1)) / 7;
          if (hips < 1 || chest < 1) put(x, y, z, (y > 9 || z > 2) && hash3(x, y, z) > 0.5 ? blkHi : blk);
        }
    for (const sx of [-2, 2]) for (let y = 0; y <= 7; y++) put(sx, y, 3, blk).set(sx, y, 4, y < 1 ? blkHi : blk);
    for (let x = -3; x <= 3; x++)
      for (let y = 10; y <= 14; y++)
        for (let z = -1; z <= 4; z++) if ((x * x) / 7 + ((y - 12) * (y - 12)) / 5 + ((z - 1.5) * (z - 1.5)) / 6 < 1) put(x, y, z, blk);
    for (let y = 13; y <= 17; y++) {
      const w = Math.max(0, Math.round((17 - y) / 2.5));
      for (const sx of [-1, 1]) for (let dx = 0; dx <= w; dx++) put(sx * (1 + dx), y, 1, y > 15 ? blkHi : blk);
    }
    put(0, 11, 4, blk).set(0, 11, 5, blkHi).set(0, 10, 4, blk); // muzzle
    for (const sx of [-1, 1]) put(sx * 1, 12, 4, PR.turquoise.hi, VF.GLOW); // gem eyes
    put(3, 11, 1, PR.gold.base, VF.METAL); // earring
    for (let x = -2; x <= 2; x++) put(x, 9, 3, PR.turquoise.base).set(x, 8, 4, PR.gold.base, VF.METAL); // collar
    for (let a = 0; a < 14; a++) {
      const t = a / 13;
      put(Math.round(Math.cos(t * Math.PI) * 4), 0, Math.round(Math.sin(t * Math.PI) * 3) + 2, blk);
    }
    cat.forEach((x, y, z, c, f) => m.set(x, cy + y, cz + z, c, f));
  } else {
    // closed doors with gold bolts, and recumbent Anubis on the roof
    const dz = nzc + nd + 1;
    for (let x = -M(0.5); x <= M(0.5); x++)
      for (let y = B0; y < B0 + M(1.55); y++) m.set(x, y, dz, x === 0 ? PR.woodDark.dark : (y + x) % 7 === 0 ? PR.woodDark.shade : PR.woodDark.base);
    for (const sx of [-2, 2]) m.set(sx, B0 + M(0.8), dz + 1, PR.gold.base, VF.METAL);
    const top = B0 + nh + M(0.32);
    const blk = 0x24201e, blkHi = 0x3c3632;
    const z0 = nzc - M(0.55);
    for (let z = 0; z <= 13; z++)
      for (let x = -3; x <= 3; x++)
        for (let y = 0; y <= 4; y++) if ((x * x) / 10 + ((y - 2) * (y - 2)) / 6 + ((z - 6.5) * (z - 6.5)) / 49 < 1) m.set(x, top + y, z0 + z, y > 3 ? blkHi : blk);
    for (const sx of [-2, 2]) for (let z = 13; z <= 18; z++) m.set(sx, top, z0 + z, blk).set(sx, top + 1, z0 + z, z > 16 ? blkHi : blk);
    for (let y = 4; y <= 10; y++) for (let x = -2; x <= 2; x++) for (let z = 12; z <= 15; z++) if ((x * x) / 5 + ((z - 13.5) * (z - 13.5)) / 4 < 1) m.set(x, top + y, z0 + z, blk);
    for (let z = 15; z <= 19; z++) for (let x = -1; x <= 1; x++) m.set(x, top + 9 - Math.floor((z - 15) / 2), z0 + z, blk);
    for (const sx of [-1, 1]) for (let y = 11; y <= 15; y++) m.set(sx * 2, top + y, z0 + 13, y > 13 ? PR.gold.base : blk, y > 13 ? VF.METAL : VF.SOLID);
    for (const sx of [-1, 1]) m.set(sx, top + 10, z0 + 16, PR.gold.hi, VF.GLOW);
    for (let x = -2; x <= 2; x++) m.set(x, top + 7, z0 + 15, PR.gold.base, VF.METAL);
    for (let x = -3; x <= 3; x++) m.set(x, top + 7, z0 + 2, PR.gold.shade, VF.METAL);
  }
  // offering bowls with embers on the top step's front corners
  for (const sx of [-1, 1]) {
    const bx = sx * M(1.25), bz = M(0.95), by = B0;
    for (let y = 0; y < M(0.4); y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) m.set(bx + x, by + y, bz + z, LIME.shade);
    for (let x = -3; x <= 3; x++)
      for (let z = -3; z <= 3; z++) {
        const r = Math.hypot(x, z);
        if (r > 3.3) continue;
        const y = by + M(0.4) + (r > 2.4 ? 1 : 0);
        m.set(bx + x, y, bz + z, r > 2.4 ? PR.terracotta.hi : PR.terracotta.base);
        if (r < 2.4) m.set(bx + x, y + 1, bz + z, hash3(x, z, sx) > 0.55 ? PR.ember.hi : PR.ember.base, VF.EMISSIVE);
      }
  }
  // prayer cloths strung between two leaning poles
  const pz = M(2.1);
  const poleTop = M(2.6);
  for (const sx of [-1, 1]) for (let y = 0; y <= poleTop; y++) m.set(sx * M(2.2) + Math.round(sx * y * 0.06), y, pz, y % 9 === 0 ? PR.woodDark.shade : PR.woodDark.base);
  const cloths = [PR.cloth.base, PR.canvas.base, PR.turquoise.shade, PR.paintYellow.base, PR.cloth.shade];
  for (let x = -M(2.2) + 2; x <= M(2.2) - 2; x++) {
    const sag = Math.round(((x / M(2.2)) ** 2 - 1) * M(0.35));
    const y = poleTop + sag;
    m.set(x, y, pz, PR.rope.base);
    const slot = Math.floor((x + M(2.2)) / 4);
    if (((x + M(2.2)) % 4) === 0) continue;
    const len = 4 + Math.floor(hash3(slot, 3, v) * 5);
    const col = cloths[slot % cloths.length];
    for (let k = 1; k <= len; k++) {
      if (k > 2 && hash3(x, k, 9) > 0.86) continue;
      m.set(x, y - k, pz + (k > 3 ? 1 : 0), mix(col, 0xe8dcc4, 0.25 + (k / len) * 0.25), NOCOL);
    }
  }
  // a fallen piece of cornice on the bottom step
  {
    const fx = M(1.6) * (rng.chance(0.5) ? 1 : -1), fz = -M(1.6);
    for (let x = -4; x <= 4; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y < 3; y++) if (hash3(x, y, z) > 0.12) m.set(fx + x, SH + y, fz + z, y === 2 ? LIME.hi : LIME.shade);
  }
  // blown sand round the base
  for (let x = -M(3.6); x <= M(3.6); x++)
    for (let z = -M(3.6); z <= M(3.6); z++) {
      const r = Math.hypot(x, z);
      if (r < M(2.4)) continue;
      const h = Math.round(Math.max(0, (M(3.4) - r) * 0.22 + nz.n2(x * 0.1, z * 0.1) * 2 + (x < 0 ? 1.5 : 0)));
      for (let y = 0; y < h; y++) if (!m.has(x, y, z)) m.set(x, y, z, sandCol(x, y, z, y === h - 1), NOCOL);
    }
  return { model: m, voxelSize: vs };
}

// ---------------------------------------------------------------------------
// Cairn on the viewpoints (1/16 m): a stack of weathered flat stones, a pole with a
// crossbar, a lashed cow skull and a frayed red pennant, pebble offerings.
export function cairn(seed = 0): StaticModel {
  const vs = 1 / 16;
  const rng = new RNG(919 + seed * 13);
  const nz = new Noise(70 + seed);
  const m = new VoxelModel('cairn' + seed);
  const tones = [0xb8a48a, 0xa89276, 0xc8b496, 0x9c8468, 0xbfa07a];
  let y = 0;
  let ox = 0, oz = 0;
  const n = rng.int(7, 9);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rx = Math.round(9 - t * 6 + rng.range(-1, 1)), rz = Math.round(rx * rng.range(0.75, 1)), ry = Math.max(2, Math.round(rx * rng.range(0.32, 0.45)));
    const col = tones[rng.int(0, tones.length - 1)];
    const cy = y + ry;
    for (let x = -rx - 1; x <= rx + 1; x++)
      for (let z = -rz - 1; z <= rz + 1; z++)
        for (let yy = -ry; yy <= ry; yy++) {
          const d = (x * x) / (rx * rx) + (z * z) / (rz * rz) + (yy * yy) / (ry * ry) + nz.n3((x + ox) * 0.3, (cy + yy) * 0.3, (z + oz) * 0.3) * 0.25;
          if (d > 1) continue;
          const top = yy > ry * 0.5;
          m.set(ox + x, cy + yy, oz + z, jit(top ? mix(col, 0xe8dcc0, 0.25) : yy < -ry * 0.4 ? mulRGB(col, 0.85) : col, x, yy, z, 0.07));
        }
    y = cy + ry - 1;
    ox += rng.int(-1, 1);
    oz += rng.int(-1, 1);
  }
  // the pole beside it, crossbar, skull, pennant
  const px = 11, pz = -2, top = Math.round(3.6 / vs);
  for (let yy = 0; yy <= top; yy++) {
    const lean = Math.round(yy * 0.04);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) m.set(px + a + lean, yy, pz + b, yy % 11 === 0 ? PR.twig.shade : (a + b) % 2 ? PR.twig.base : PR.twig.hi);
  }
  const bar = top - 12, lean = Math.round(bar * 0.04);
  for (let x = -7; x <= 8; x++) m.set(px + lean + x, bar, pz + 2, PR.twig.shade);
  for (let k = 0; k < 3; k++) m.set(px + lean, bar + 1 - k, pz + 2, PR.rope.base);
  const sk = cowSkullModel();
  sk.forEach((x, yy, z, c, f) => {
    // skull hung facing out (+z), shrunk to fit
    if ((x & 1) || (yy & 1) || (z & 1)) return;
    m.set(px + lean + (x >> 1), bar - 9 + (yy >> 1), pz + 3 + (z >> 1), c, f);
  });
  // pennant: frayed swallowtail with holes, curling in the wind
  const pTop = top - 1;
  const pl = 22;
  for (let i = 0; i < pl; i++) {
    const t = i / pl;
    const h = Math.round(9 * (1 - t * 0.55));
    const curl = Math.round(Math.sin(t * 5 + 1) * 2 * t);
    for (let k = 0; k < h; k++) {
      if (t > 0.7 && Math.abs(k - h / 2) < 1.6) continue; // swallowtail notch
      if (hash3(i, k, 5) > 0.93 || (t > 0.85 && hash3(i, k, 6) > 0.5)) continue; // holes, frayed end
      m.set(px + lean + 2 + i, pTop - k, pz + curl, k === 0 || k === h - 1 ? PR.red.shade : t > 0.6 ? mix(PR.red.base, PR.linen.base, 0.25) : PR.red.base);
    }
  }
  // pebble offerings and a drift on the lee side
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(10, 15);
    const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    m.set(x, 0, z, tones[i % tones.length]).set(x + 1, 0, z, tones[(i + 2) % tones.length]);
    if (i % 3 === 0) m.set(x, 1, z, tones[(i + 1) % tones.length]);
  }
  for (let x = 4; x <= 22; x++)
    for (let z = -9; z <= 9; z++) {
      const h = Math.round(Math.max(0, 4 * (1 - (x - 4) / 18) * (1 - (z / 9) ** 2)));
      for (let yy = 0; yy < h; yy++) if (!m.has(x, yy, z)) m.set(x, yy, z, sandCol(x, yy, z, yy === h - 1), NOCOL);
    }
  return { model: m, voxelSize: vs };
}
