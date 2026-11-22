// THE ROLLING STONE: a rune-carved living boulder that rolls after you, gathers
// moss and sand as it goes, and crashes. 1/17 m voxels, ~1.65 m across (the
// elite "Gathers No Moss" ~1.9 m, basalt with white-gold runes and quartz).
//
// Not a ball: a chiselled granite boulder (lumpy fbm swell cut by a dozen planar
// facets with paler worn arrises), speckled quartz / feldspar / mica, lichen
// blooms, a wavy tread rune running round its rolling circumference (so the roll
// reads at a glance) and five carved glyphs (ankh, wedjat eye, water, sun, a
// tumbling spiral) whose grooves glow amber from inside. On its front facet a
// heavy brow ridge shades two deep pits holding modelled eyes (amber iris, slit
// pupil, glint) and a jagged molten mouth crack.
//
// Rig: `core` (root, pivot at the centre: it rolls about local X) and three
// fracture chunks `chunk_1..3` (a Voronoi split of the same boulder, hairline
// cracks along the seams) so the death ragdoll breaks it into real pieces;
// `eye_l` / `eye_r` (look at the hunter); `moss_1..6` (moss pads and sand crust,
// hidden at spawn and revealed one by one as it rolls, shed when it crashes).
// Sockets: `mouth` (shards fly out of it).
import { TRig, VoxelModel, VF } from '../tk';
import type { RigSpec } from '../tk';
import { hash3, noise } from '../../../../engine/math/rand';

const VS = 1 / 17;

type P3 = [number, number, number];
const norm = (v: P3): P3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function rollingStoneRig(o: { alpha?: boolean } = {}): RigSpec {
  const A = !!o.alpha;
  const R = A ? 16 : 14;
  const K = R / 16.5; // glyph / face scale
  const CY = Math.round(R) + 0.5; // centre height (voxel units); the stone sits on its belly
  const C: P3 = [0.5, CY, 0.5];
  const rig = new TRig(A ? 'rolling_stone_alpha' : 'rolling_stone', VS);
  const seed = A ? 7.3 : 2.1;

  // ---------------------------------------------------------------- palette
  const G = A ? [0x2a2624, 0x353130, 0x3f3a37, 0x4a4542, 0x57514c] : [0x5f554b, 0x6f6356, 0x7f7262, 0x8f816d, 0xa0917b];
  const ARRIS = A ? 0x6e6660 : 0xb9aa92;
  const QUARTZ = A ? 0xc9c0d8 : 0xdcd4c6, FELD = A ? 0x7a5a52 : 0xbc9c86, MICA = 0x2e2a27;
  const LICHEN = [0xb89a3a, 0x9aa078, 0xc8b060];
  const RUNE = A ? 0xfff2c4 : 0xffa43a, RUNE_DEEP = A ? 0xffd27a : 0xe8641a, CRACK = A ? 0xff9a3a : 0x2a221c;
  const SOCKET = 0x1a120c;

  // ---------------------------------------------------------------- the boulder shape (shared by every chunk)
  const facets: { n: P3; o: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const n = norm([hash3(i, 1, seed * 10) - 0.5, hash3(i, 2, seed * 10) - 0.5, hash3(i, 3, seed * 10) - 0.5]);
    facets.push({ n, o: 0.86 + hash3(i, 4, seed * 10) * 0.08 });
  }
  // the face: a broad front facet the eyes and mouth are cut into
  const FACE: P3 = norm([0, 0.12, 1]);
  facets.push({ n: FACE, o: 0.84 });
  const radial = (d: P3) => R * (1 + 0.075 * noise.fbm3(d[0] * 1.5 + seed, d[1] * 1.5, d[2] * 1.5, 3) + 0.025 * noise.n3(d[0] * 4.2, d[1] * 4.2 + seed, d[2] * 4.2));
  const inside = (x: number, y: number, z: number) => {
    const p: P3 = [x + 0.5 - C[0], y + 0.5 - C[1], z + 0.5 - C[2]];
    const l = Math.hypot(p[0], p[1], p[2]);
    if (l < 1) return true;
    const d: P3 = [p[0] / l, p[1] / l, p[2] / l];
    if (l > radial(d)) return false;
    for (const f of facets) if (dot(p, f.n) > R * f.o) return false;
    return true;
  };
  /** how close a surface voxel is to a facet plane (worn pale arrises along the facet edges) */
  const arris = (x: number, y: number, z: number) => {
    const p: P3 = [x + 0.5 - C[0], y + 0.5 - C[1], z + 0.5 - C[2]];
    let k = 0;
    for (const f of facets) if (Math.abs(dot(p, f.n) - R * f.o) < 1.1) k++;
    return k >= 2;
  };
  const stoneCol = (x: number, y: number, z: number) => {
    const h = hash3(x * 3 + 11, y * 5 + 7, z * 7 + 3);
    if (h < 0.016) return QUARTZ;
    if (h < 0.028) return FELD;
    if (h < 0.034) return MICA;
    if (!A && noise.n3(x * 0.08 + 31, y * 0.08, z * 0.08 - 9) > 0.5 && hash3(x, y, z + 99) < 0.75) return LICHEN[(hash3(x, z, y) * 3) | 0];
    const t = 0.5 + 0.5 * noise.n3(x * 0.07 + seed, y * 0.07, z * 0.07);
    return G[Math.max(0, Math.min(4, Math.round(t * 4)))];
  };

  // ---------------------------------------------------------------- fracture chunks (Voronoi in the volume)
  const seeds: P3[] = [
    [0, 2, 9], // core: holds the face
    [10, 4, -4],
    [-10, 3, -5],
    [0, -4, -10],
  ];
  const names = ['core', 'chunk_1', 'chunk_2', 'chunk_3'];
  const models: VoxelModel[] = names.map((n, i) => (i === 0 ? rig.part(n, undefined, C) : rig.part(n, 'core', C)));
  const owner = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const Ri = Math.ceil(R * 1.12) + 1;
  for (let x = -Ri; x <= Ri; x++)
    for (let y = Math.floor(C[1] - Ri); y <= Math.ceil(C[1] + Ri); y++)
      for (let z = -Ri; z <= Ri; z++) {
        if (!inside(x, y, z)) continue;
        const p: P3 = [x + 0.5 - C[0], y + 0.5 - C[1], z + 0.5 - C[2]];
        let b = 0, bd = 1e9, sd = 1e9;
        for (let i = 0; i < seeds.length; i++) {
          const dd = (p[0] - seeds[i][0]) ** 2 + (p[1] - seeds[i][1]) ** 2 + (p[2] - seeds[i][2]) ** 2;
          if (dd < bd) {
            sd = bd;
            bd = dd;
            b = i;
          } else if (dd < sd) sd = dd;
        }
        const seam = Math.sqrt(sd) - Math.sqrt(bd) < 0.9;
        owner.set(key(x, y, z), b);
        let col = stoneCol(x, y, z);
        let fl: number = VF.SOLID;
        if (seam) {
          col = CRACK;
          if (A) fl = VF.SOLID | VF.EMISSIVE;
        } else if (arris(x, y, z)) col = ARRIS;
        models[b].set(x, y, z, col, fl);
      }
  const solid = (x: number, y: number, z: number) => owner.has(key(x, y, z)) && models[owner.get(key(x, y, z))!].has(x, y, z);
  const del = (x: number, y: number, z: number) => {
    const k = key(x, y, z);
    const b = owner.get(k);
    if (b === undefined) return;
    models[b].del(x, y, z);
    owner.delete(k);
  };
  const setAt = (x: number, y: number, z: number, c: number, f: number = VF.SOLID) => {
    const b = owner.get(key(x, y, z));
    if (b !== undefined) models[b].set(x, y, z, c, f);
  };
  /** first solid voxel marching in from outside along d (the surface point) */
  const surf = (d: P3): P3 => {
    for (let r = R * 1.15; r > 2; r -= 0.35) {
      const x = Math.floor(C[0] + d[0] * r - 0.5), y = Math.floor(C[1] + d[1] * r - 0.5), z = Math.floor(C[2] + d[2] * r - 0.5);
      if (solid(x, y, z)) return [C[0] + d[0] * r, C[1] + d[1] * r, C[2] + d[2] * r];
    }
    return [C[0] + d[0] * R, C[1] + d[1] * R, C[2] + d[2] * R];
  };
  /** carve a glowing groove along a surface stroke (points in rig space, projected onto the stone) */
  const groove = (pts: P3[], w = 0.8, glow = RUNE) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(1, Math.ceil(L / 0.35));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const m: P3 = [a[0] + (b[0] - a[0]) * t - C[0], a[1] + (b[1] - a[1]) * t - C[1], a[2] + (b[2] - a[2]) * t - C[2]];
        const q = surf(norm(m));
        const r1 = w + 1.1;
        for (let x = Math.floor(q[0] - r1); x <= Math.ceil(q[0] + r1); x++)
          for (let y = Math.floor(q[1] - r1); y <= Math.ceil(q[1] + r1); y++)
            for (let z = Math.floor(q[2] - r1); z <= Math.ceil(q[2] + r1); z++) {
              const dd = Math.hypot(x + 0.5 - q[0], y + 0.5 - q[1], z + 0.5 - q[2]);
              if (dd < w) del(x, y, z);
              else if (dd < r1 && solid(x, y, z)) setAt(x, y, z, dd < w + 0.55 ? glow : RUNE_DEEP, VF.SOLID | VF.EMISSIVE);
            }
      }
    }
  };
  /** a glyph laid on the surface around direction g: strokes in a local (u, v) frame */
  const glyph = (g: P3, strokes: [number, number][][], scale = 1, w = 0.75) => {
    const n = norm(g);
    const up: P3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = norm(cross(up, n)), t2 = norm(cross(n, t1));
    const q = surf(n);
    for (const s of strokes)
      groove(
        s.map(([u, v]) => [q[0] + (t1[0] * u + t2[0] * v) * scale, q[1] + (t1[1] * u + t2[1] * v) * scale, q[2] + (t1[2] * u + t2[2] * v) * scale] as P3),
        w
      );
  };
  const GS = K;
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    });

  // the tread rune: a wave running all the way round the rolling circumference
  {
    const pts: P3[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      pts.push([C[0] + Math.sin(a * 3) * 2.6, C[1] + Math.cos(a) * R, C[2] + Math.sin(a) * R]);
    }
    groove(pts, 0.7);
  }
  // the glyphs
  glyph([0.85, 0.35, -0.4], [arc(0, 3.8, 2.2, 2.6, -0.5, Math.PI * 2 - 1.1, 14), [[0, 1.4], [0, -6]], [[-3.6, 1.2], [3.6, 1.2]]], GS); // ankh
  glyph([-0.85, 0.3, -0.35], [arc(0, 0, 4, 1.8, 0, Math.PI, 10), arc(0, 0, 4, 1.6, Math.PI, Math.PI * 2, 10), arc(0, 0, 0.9, 0.9, 0, Math.PI * 2, 6), [[-1, -1.6], [-1.6, -4.4]], [[0.4, -1.6], [2.4, -3.2], [4, -2.4], [3.6, -1.2]]], GS); // wedjat
  glyph([0.25, -0.2, -1], [[[-4.4, 2], [-2.2, 3.4], [0, 2], [2.2, 3.4], [4.4, 2]], [[-4.4, -0.5], [-2.2, 0.9], [0, -0.5], [2.2, 0.9], [4.4, -0.5]], [[-4.4, -3], [-2.2, -1.6], [0, -3], [2.2, -1.6], [4.4, -3]]], GS); // water
  glyph([0.1, 1, -0.25], [arc(0, 0, 2.6, 2.6, 0, Math.PI * 2, 14), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k): [number, number][] => [[Math.cos((k * Math.PI) / 4) * 3.6, Math.sin((k * Math.PI) / 4) * 3.6], [Math.cos((k * Math.PI) / 4) * 5.4, Math.sin((k * Math.PI) / 4) * 5.4]])], GS); // sun
  glyph([-0.3, -0.8, 0.5], [Array.from({ length: 22 }, (_, i): [number, number] => [Math.cos(i * 0.55) * (0.4 + i * 0.22), Math.sin(i * 0.55) * (0.4 + i * 0.22)])], GS); // the tumbling spiral

  // ---------------------------------------------------------------- the face (front facet)
  const fz = (x: number, y: number) => {
    for (let z = Ri; z > 0; z--) if (solid(x, y, z)) return z;
    return 0;
  };
  const eyeY = Math.round(C[1] + R * 0.22), eyeX = Math.round(R * 0.3);
  // a heavy brow ridge shading the pits
  for (let x = -eyeX - 4; x <= eyeX + 4; x++) {
    const sag = Math.abs(x) < 2 ? 1 : 0; // a frown notch in the middle
    for (let y = eyeY + 2 - sag; y <= eyeY + 4 - sag; y++) {
      const z0 = fz(x, y);
      if (!z0) continue;
      const out = y === eyeY + 2 - sag ? 2 : 1;
      for (let z = z0 + 1; z <= z0 + out; z++) {
        owner.set(key(x, y, z), 0);
        models[0].set(x, y, z, y === eyeY + 4 - sag ? ARRIS : stoneCol(x, y, z));
      }
    }
  }
  // eye pits
  for (const s of [1, -1]) {
    const ex = s * eyeX + 0.5;
    const ez = fz(Math.round(ex), eyeY);
    for (let x = Math.floor(ex - 3.4); x <= Math.ceil(ex + 3.4); x++)
      for (let y = eyeY - 3; y <= eyeY + 3; y++)
        for (let z = ez - 4; z <= ez + 3; z++) {
          const d = ((x + 0.5 - ex) / 3.0) ** 2 + ((y + 0.5 - eyeY - 0.3) / 2.3) ** 2 + ((z + 0.5 - (ez + 1)) / 3.2) ** 2;
          if (d < 1) del(x, y, z);
          else if (d < 1.6 && solid(x, y, z)) setAt(x, y, z, SOCKET);
        }
  }
  // modelled eyes: a glossy dark ball with a molten iris, a slit pupil and a glint
  {
    const ez = fz(eyeX, eyeY - 3) - 1.2;
    const eye = rig.part('eye_l', 'core', [eyeX + 0.5, eyeY + 0.5, ez]);
    const IRIS = A ? [0xfff6d0, 0xffe08a, 0xffc04a] : [0xffd27a, 0xffa43a, 0xe0621a];
    for (let x = eyeX - 2; x <= eyeX + 2; x++)
      for (let y = eyeY - 2; y <= eyeY + 2; y++)
        for (let z = Math.floor(ez - 2); z <= Math.ceil(ez + 1); z++) {
          const d = ((x - eyeX) / 2.1) ** 2 + ((y - eyeY) / 1.8) ** 2 + ((z + 0.5 - ez) / 1.8) ** 2;
          if (d > 1) continue;
          const front = z + 0.5 > ez + 0.2;
          const r = Math.hypot(x - eyeX, y - eyeY);
          let c = 0x2a1a10, f: number = VF.SOLID | VF.METAL;
          if (front) {
            if (x === eyeX && Math.abs(y - eyeY) <= 1) c = 0x120804; // slit pupil
            else if (r < 1.1) (c = IRIS[0]), (f = VF.SOLID | VF.GLOW);
            else if (r < 1.9) (c = IRIS[1]), (f = VF.SOLID | VF.EMISSIVE);
            else (c = IRIS[2]), (f = VF.SOLID | VF.EMISSIVE);
            if (x === eyeX + 1 && y === eyeY + 1) (c = 0xffffff), (f = VF.SOLID | VF.GLOW);
          }
          eye.set(x, y, z, c, f);
        }
  }
  // the mouth: a jagged crack with a molten throat
  {
    const my = Math.round(C[1] - R * 0.18);
    const pts: P3[] = [];
    for (let i = 0; i <= 12; i++) {
      const x = (-7 + (14 * i) / 12) * K;
      const y = my + (i % 2 ? 1 : -0.6) + Math.cos((x / 7) * 1.6) * 1.5;
      pts.push([x + 0.5, y, fz(Math.round(x), Math.round(y)) + 0.5]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const qx = a[0] + (b[0] - a[0]) * t, qy = a[1] + (b[1] - a[1]) * t, qz = a[2] + (b[2] - a[2]) * t;
        const open = 1 - Math.abs((qx - 0.5) / (7.5 * K));
        for (let x = Math.floor(qx - 1); x <= Math.ceil(qx + 1); x++)
          for (let y = Math.floor(qy - 2); y <= Math.ceil(qy + 2); y++)
            for (let z = Math.floor(qz - 4); z <= Math.ceil(qz + 1); z++) {
              const dy = Math.abs(y + 0.5 - qy), dz = qz - (z + 0.5);
              if (dy < 0.6 + open * 0.9 && dz < 2.6 * open + 0.6) del(x, y, z);
              else if (dy < 1.6 + open && dz < 3.6 && solid(x, y, z)) setAt(x, y, z, dz > 2.2 ? RUNE : RUNE_DEEP, VF.SOLID | VF.EMISSIVE);
            }
      }
    }
    rig.socket('mouth', 'core', [0.5, my, fz(0, my) + 1]);
  }

  // the elite grows quartz: faceted six-sided crystal clusters breaking out of the basalt
  if (A) {
    const clusters: P3[] = [[0.6, 0.75, -0.3], [-0.7, 0.4, -0.6], [0.2, -0.3, -0.95]];
    clusters.forEach((g, ci) => {
      const n = norm(g);
      const base = surf(n);
      for (let k = 0; k < 4; k++) {
        const tilt = norm([n[0] + (hash3(ci, k, 1) - 0.5) * 0.7, n[1] + (hash3(ci, k, 2) - 0.5) * 0.7, n[2] + (hash3(ci, k, 3) - 0.5) * 0.7]);
        const len = 5 + hash3(ci, k, 4) * 5, rad = 1.3 + hash3(ci, k, 5) * 0.9;
        for (let s = -2; s <= len; s += 0.4) {
          const tip = s > len - rad * 1.6 ? (len - s) / (rad * 1.6) : 1;
          const cx = base[0] + tilt[0] * s, cy = base[1] + tilt[1] * s, cz = base[2] + tilt[2] * s;
          const rr = rad * Math.max(0.15, tip);
          for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++)
            for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++)
              for (let z = Math.floor(cz - rr); z <= Math.ceil(cz + rr); z++) {
                if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) > rr) continue;
                const b = owner.get(key(x, y, z)) ?? 0;
                owner.set(key(x, y, z), b);
                const edge = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) > rr - 0.6;
                models[b].set(x, y, z, tip < 0.4 ? 0xfaf6ff : edge ? 0xd8c8f0 : 0xb8a8e0, VF.SOLID | VF.SOFTAO | (tip < 0.5 ? VF.EMISSIVE : 0));
              }
        }
      }
    });
  }

  // ---------------------------------------------------------------- moss pads and sand crust (gathered as it rolls)
  const pads: { g: P3; moss: boolean; r: number }[] = [
    { g: [0.7, 0.6, 0.2], moss: true, r: 4.6 },
    { g: [-0.6, 0.75, 0.1], moss: false, r: 5.2 },
    { g: [0.8, -0.3, -0.5], moss: false, r: 4.4 },
    { g: [-0.75, -0.45, -0.3], moss: true, r: 4.8 },
    { g: [0, 0.4, -0.95], moss: true, r: 5.4 },
    { g: [0.1, -0.95, 0.2], moss: false, r: 5.8 },
  ];
  const MOSS = [0x2f5a22, 0x3f6e2a, 0x55883a, 0x7aa848, 0x9ab85a];
  const SANDC = [0xc89a5c, 0xdcb478, 0xeccb8f, 0xf6dfb0];
  pads.forEach((pd, i) => {
    const m = rig.part(`moss_${i + 1}`, 'core', C);
    const n = norm(pd.g);
    const q = surf(n);
    const rr = pd.r + 1.5;
    for (let x = Math.floor(q[0] - rr); x <= Math.ceil(q[0] + rr); x++)
      for (let y = Math.floor(q[1] - rr); y <= Math.ceil(q[1] + rr); y++)
        for (let z = Math.floor(q[2] - rr); z <= Math.ceil(q[2] + rr); z++) {
          if (solid(x, y, z)) continue;
          const lat = Math.hypot(x + 0.5 - q[0], y + 0.5 - q[1], z + 0.5 - q[2]);
          const ragged = pd.r * (0.78 + 0.32 * noise.n3(x * 0.35 + i * 7, y * 0.35, z * 0.35));
          if (lat > ragged) continue;
          // only the voxels lying on the stone (a neighbour inside it), one or two thick
          const touch = solid(x + 1, y, z) || solid(x - 1, y, z) || solid(x, y + 1, z) || solid(x, y - 1, z) || solid(x, y, z + 1) || solid(x, y, z - 1);
          const p: P3 = [x + 0.5 - C[0], y + 0.5 - C[1], z + 0.5 - C[2]];
          const depth = Math.hypot(p[0], p[1], p[2]) - Math.hypot(q[0] - C[0], q[1] - C[1], q[2] - C[2]);
          const thick = pd.moss ? 1.6 : 2.2 * (1 - lat / ragged) + 0.8;
          if (!touch && depth > thick) continue;
          if (depth > thick + 0.6) continue;
          const h = hash3(x + i * 31, y, z);
          if (pd.moss) m.set(x, y, z, MOSS[Math.min(4, Math.floor((1 - lat / ragged) * 3 + h * 2))], VF.SOLID | VF.SOFTAO);
          else m.set(x, y, z, h < 0.06 ? 0x8a7a68 : h < 0.09 ? 0x6a4a2e : SANDC[Math.min(3, Math.floor((1 - lat / ragged) * 2.4 + h * 1.6))]);
        }
      // moss tufts: little upright blades with pale tips
    if (pd.moss)
      for (let k = 0; k < 9; k++) {
        const a = hash3(i, k, 7) * Math.PI * 2, rr2 = hash3(i, k, 8) * pd.r * 0.8;
        const up: P3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const t1 = norm(cross(up, n)), t2 = norm(cross(n, t1));
        const b: P3 = [q[0] + (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * rr2, q[1] + (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * rr2, q[2] + (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * rr2];
        const L = 2 + Math.floor(hash3(i, k, 9) * 2.5);
        for (let s = 1; s <= L; s++) {
          const x = Math.floor(b[0] + n[0] * (s + 0.6)), y = Math.floor(b[1] + n[1] * (s + 0.6)), z = Math.floor(b[2] + n[2] * (s + 0.6));
          if (!solid(x, y, z)) m.set(x, y, z, s === L ? MOSS[4] : MOSS[2], VF.SOLID | VF.SOFTAO);
        }
      }
  });

  rig.mirrorLR();
  return rig.build({
    height: (CY * 2) * VS,
    radius: R * VS * 0.98,
    kind: 'rolling_stone',
    roll: { radius: CY * VS },
    alpha: A,
  });
}
