// The Nile's set dressing (world/NileGen.ts places them, world/Props.ts builds them):
//  - seatedColossus: a 13 m seated king on a carved throne facing the river, nemes
//    and double crown, hands on his knees, carved (modelled) eyes, faded paint, cracks,
//    chipped edges, a broken nose (v0) or a split crown and a fallen hand (v1). 1/8 m.
//  - jetty: a weathered cedar landing stage on posts with stringers, cross braces,
//    rope lashings, mooring bollards, a lantern pole, jars and a coiled rope. 1/12 m.
//  - shaduf: the farmers' water lever: mud-brick piers, a forked pivot, a sweep pole
//    with a mud counterweight and a leather bucket on its rope over the water. 1/12 m.
//  - charredPalm / charred(): Ra's fire on the valley's palms and monuments.
//  - obsidianSpire: shards of black volcanic glass with molten veins at the root. 1/10 m.
//  - papyrusClump / cropTuft: flora the foliage layer photographs into pixel sprites.
import { VoxelModel, VF, mix, mulRGB } from '../../../engine/voxel/VoxelModel';
import { RNG, Noise, hash3 } from '../../../engine/math/rand';
import { PR, S, rngOf, blob, glyphPanel, sandDrift, inCircle, type StaticModel } from './helpers';
import { palm } from './nature';

const SS = PR.sandstone;

// ------------------------------------------------------------------ sculpt helpers
type V3 = [number, number, number];
/** a one-voxel line from a to b, coloured along its length (t = 0..1); w > 1 thickens it */
function ray(m: VoxelModel, a: V3, b: V3, col: number | ((t: number) => number), w = 1, flags?: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1) * 1.5);
  const h0 = -Math.floor((w - 1) / 2), h1 = h0 + w - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = typeof col === 'number' ? col : col(t);
    const x = Math.round(a[0] + dx * t), y = Math.round(a[1] + dy * t), z = Math.round(a[2] + dz * t);
    for (let u = h0; u <= h1; u++) for (let v = h0; v <= h1; v++) for (let q = h0; q <= h1; q++) m.set(x + u, y + v, z + q, c, flags);
  }
}
/** filled tapered capsule from a to b (radius r0 -> r1) */
function limb(m: VoxelModel, a: [number, number, number], b: [number, number, number], r0: number, r1: number, col: (x: number, y: number, z: number, t: number) => number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L2 = dx * dx + dy * dy + dz * dz || 1;
  const R = Math.max(r0, r1) + 1;
  const x0 = Math.floor(Math.min(a[0], b[0]) - R), x1 = Math.ceil(Math.max(a[0], b[0]) + R);
  const y0 = Math.floor(Math.min(a[1], b[1]) - R), y1 = Math.ceil(Math.max(a[1], b[1]) + R);
  const z0 = Math.floor(Math.min(a[2], b[2]) - R), z1 = Math.ceil(Math.max(a[2], b[2]) + R);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        let t = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a[0] + dx * t - x, py = a[1] + dy * t - y, pz = a[2] + dz * t - z;
        const r = r0 + (r1 - r0) * t;
        if (px * px + py * py + pz * pz <= r * r) m.set(x, y, z, col(x, y, z, t));
      }
}
/** filled ellipsoid with a colour function */
function ell(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: (x: number, y: number, z: number) => number) {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d <= 1) m.set(x, y, z, col(x, y, z));
      }
}
/** remove interior voxels (all six neighbours present, two deep): far fewer voxels to store */
function hollow(m: VoxelModel) {
  const inner: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) if (!m.has(x + a, y + b, z + c)) return;
    inner.push([x, y, z]);
  });
  for (const [x, y, z] of inner) m.del(x, y, z);
}
/** chip exposed edges: voxels with few neighbours erode away (weathering) */
function erode(m: VoxelModel, rng: RNG, p: number, keepBelow = 0) {
  const gone: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (y < keepBelow) return;
    let open = 0;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (!m.has(x + a, y + b, z + c)) open++;
    if (open >= 3 && rng.chance(p)) gone.push([x, y, z]);
  });
  for (const [x, y, z] of gone) m.del(x, y, z);
}

// ------------------------------------------------------------------ the seated colossus
export function seatedColossus(seed = 0): StaticModel {
  const VS = 1 / 8;
  const rng = rngOf(seed, 913);
  const nz = new Noise(4711 + seed * 17);
  const m = new VoxelModel('nile_colossus' + seed);
  const stone = (x: number, y: number, z: number) => {
    const n = nz.n3(x * 0.09, y * 0.07, z * 0.09);
    const band = Math.floor((y + nz.n2(x * 0.05, z * 0.05) * 3) / 6) % 4;
    let c = band === 1 ? SS.shade : band === 3 ? mix(SS.base, SS.hi, 0.35) : SS.base;
    if (n > 0.45) c = mix(c, SS.hi, 0.5);
    if (n < -0.5) c = mix(c, SS.dark, 0.35);
    return mulRGB(c, 1 + (hash3(x, y, z) - 0.5) * 0.05);
  };
  const skin = (x: number, y: number, z: number) => {
    const c = stone(x, y, z);
    // faded ochre paint clings in the sheltered places
    const p = nz.n3(x * 0.12 + 5, y * 0.12, z * 0.12 - 3);
    return p > 0.25 ? mix(c, 0xb8664a, 0.38) : c;
  };
  // plinth: a stepped block with a chamfered top course and the sema-tawy relief on its sides
  for (let y = 0; y <= 13; y++) {
    const inset = y >= 11 ? y - 10 : 0;
    for (let x = -30 + inset; x <= 30 - inset; x++) for (let z = -34 + inset; z <= 34 - inset; z++) m.set(x, y, z, y >= 11 ? SS.hi : stone(x, y, z));
  }
  glyphPanel(m, 'x+', -24, 24, 3, 10, 30, seed * 3 + 1, { carve: true });
  glyphPanel(m, 'x-', -24, 24, 3, 10, -30, seed * 3 + 2, { carve: true });
  glyphPanel(m, 'z+', -22, 22, 3, 9, 34, seed * 3 + 3, { carve: true, color: PR.lapis.shade });
  // the throne: seat block and a tall back slab, framed edges, a carved side panel
  for (let y = 14; y <= 44; y++) for (let x = -24; x <= 24; x++) for (let z = -30; z <= 4; z++) m.set(x, y, z, Math.abs(x) >= 23 || y === 44 ? SS.hi : stone(x, y, z));
  for (let y = 44; y <= 82; y++) {
    const w = 24 - Math.max(0, y - 76);
    for (let x = -w; x <= w; x++) for (let z = -30; z <= -19; z++) m.set(x, y, z, Math.abs(x) >= w - 1 || y >= 81 ? SS.hi : stone(x, y, z));
  }
  for (const sx of [-1, 1]) {
    // a lion's-paw leg at each front corner of the seat
    for (let y = 14; y <= 30; y++) for (let x = 19; x <= 24; x++) for (let z = 0; z <= 4; z++) m.set(sx * x, y, z, stone(x, y, z));
    for (const t of [-1, 1, 3]) ell(m, sx * (20 + t), 15.5, 6, 1.6, 1.8, 2.2, () => SS.shade);
    glyphPanel(m, sx > 0 ? 'x+' : 'x-', -26, 0, 18, 40, sx * 24, seed + 9 + sx, { carve: false, color: PR.red.shade });
  }
  // ---- the king (facing +z)
  const FY = 14; // feet stand on the plinth
  for (const sx of [-1, 1]) {
    // feet: long, toes rounded, the big toe proud
    for (let z = 15; z <= 31; z++) {
      const w = z > 27 ? 5 - (z - 27) * 0.8 : 5;
      for (let x = -Math.round(w); x <= Math.round(w); x++) for (let y = FY; y <= FY + (z > 25 ? 3 : 5); y++) m.set(sx * 8 + x, y, z, skin(x, y, z));
    }
    for (let t = 0; t < 5; t++) m.set(sx * 8 + (t - 2) * 2 * sx, FY + 3, 32, SS.hi);
    // shins: vertical, a calf swell and a sharp shin ridge
    limb(m, [sx * 8, FY + 4, 21], [sx * 8, FY + 30, 22], 5.2, 5.6, (x, y, z, t) => skin(x, y, z) + 0 * t);
    for (let y = FY + 8; y <= FY + 28; y++) m.set(sx * 8, y, 27, SS.hi);
    // knees, thighs running back to the seat
    ell(m, sx * 8, FY + 32, 22, 6.2, 5.2, 6, skin);
    limb(m, [sx * 8, FY + 32, 22], [sx * 8, FY + 32, -6], 6.2, 7.2, (x, y, z) => skin(x, y, z));
  }
  // the pleated kilt over the lap, its belt and the tab between the knees
  for (let z = -8; z <= 16; z++)
    for (let x = -16; x <= 16; x++)
      for (let y = FY + 29; y <= FY + 39; y++) {
        if (y > FY + 36 && z > 10) continue;
        if (!m.has(x, y, z) && !(y >= FY + 30 && Math.abs(x) <= 15)) continue;
        m.set(x, y, z, Math.abs(x) % 3 === 0 ? SS.shade : mix(SS.base, 0xece0c0, 0.25));
      }
  for (let y = FY + 25; y <= FY + 38; y++) for (let x = -3; x <= 3; x++) m.set(x, y, 17 - Math.max(0, FY + 32 - y) * 0.2, Math.abs(x) === 3 ? SS.shade : SS.hi);
  for (let x = -14; x <= 14; x++) for (let z = -10; z <= 8; z++) m.set(x, FY + 39, z, mix(PR.gold.dark, SS.base, 0.55));
  // torso: waist to broad shoulders, a modelled chest and belly furrow
  const TY0 = FY + 40, TY1 = FY + 66;
  for (let y = TY0; y <= TY1; y++) {
    const t = (y - TY0) / (TY1 - TY0);
    const hw = 11 + t * 6 + Math.sin(t * Math.PI) * 0.6;
    const front = 4 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) * 3 - (t > 0.85 ? (t - 0.85) * 18 : 0);
    for (let x = -Math.round(hw); x <= Math.round(hw); x++) {
      const e = Math.abs(x) / hw;
      const zf = front * Math.sqrt(Math.max(0, 1 - e ** 4)) + (t > 0.55 && t < 0.82 && e < 0.8 && e > 0.12 ? 1 : 0);
      for (let z = -12; z <= Math.round(zf); z++) m.set(x, y, z, skin(x, y, z));
    }
  }
  for (let y = TY0 + 2; y <= TY0 + 14; y++) m.del(0, y, 7);
  // the broad collar: faded turquoise, lapis and gold bands
  for (let y = TY1 - 7; y <= TY1; y++)
    for (let x = -16; x <= 16; x++) {
      const r = Math.hypot(x, (y - TY1) * 2.2);
      if (r > 17 || r < 6) continue;
      const band = Math.floor(r / 2.6) % 3;
      const c = band === 0 ? PR.turquoise.base : band === 1 ? PR.lapis.base : PR.gold.base;
      let zt = -12;
      for (let z = 10; z > -12; z--) if (m.has(x, y, z)) { zt = z; break; }
      m.set(x, y, zt + 1, mix(c, SS.base, 0.5), band === 2 ? VF.METAL : VF.SOLID);
    }
  for (const sx of [-1, 1]) {
    // arms: shoulder, upper arm down the side, forearm along the thigh, a flat hand on the knee
    ell(m, sx * 17, TY1 - 3, -3, 5.5, 5.5, 6, skin);
    limb(m, [sx * 18, TY1 - 4, -3], [sx * 17, TY0 + 2, 0], 4.8, 4.0, (x, y, z) => skin(x, y, z));
    if (!(seed % 2 === 1 && sx < 0)) {
      limb(m, [sx * 16, TY0 + 1, 1], [sx * 10, FY + 39, 17], 3.8, 3.2, (x, y, z) => skin(x, y, z));
      for (let z = 14; z <= 25; z++) for (let x = -4; x <= 4; x++) for (let y = FY + 37; y <= FY + 39; y++) m.set(sx * 9 + x, y, z, skin(x, y, z));
      for (let f = -3; f <= 3; f += 2) for (let z = 21; z <= 25; z++) m.set(sx * 9 + f, FY + 39, z, SS.shade);
    } else {
      // v1: the left forearm has broken away at the elbow; the hand lies on the plinth
      ell(m, sx * 15, TY0 + 1, 2, 3.6, 3.2, 3.6, () => SS.shade);
      for (let z = 0; z <= 9; z++) for (let x = -4; x <= 4; x++) for (let y = 14; y <= 16; y++) m.set(sx * 22 + x, y, z + 12, skin(x, y, z));
    }
  }
  // neck
  for (let y = TY1 + 1; y <= TY1 + 6; y++) for (let x = -6; x <= 6; x++) for (let z = -6; z <= 4; z++) if (inCircle(x, (z + 1) * 1.2, 6.2)) m.set(x, y, z, skin(x, y, z));
  // the head: face (+z), nemes lappets and wings, the brow, carved eyes, nose, lips, ears
  const HY = TY1 + 7;
  ell(m, 0, HY + 8, -1, 8.2, 9.5, 8.4, skin);
  // nemes: striped headcloth over the crown, flaring wings behind the ears, lappets down the chest
  const nem = (x: number, y: number) => (Math.floor(y / 2) % 2 === 0 ? mix(PR.lapis.base, SS.base, 0.55) : mix(PR.gold.base, SS.base, 0.5));
  for (let y = HY + 4; y <= HY + 19; y++)
    for (let x = -13; x <= 13; x++)
      for (let z = -11; z <= 5; z++) {
        const t = (y - HY - 4) / 15;
        const w = 9.2 + (1 - t) * 3.6;
        const r = ((x / w) ** 2 + ((z + 2) / 8.6) ** 2);
        if (r > 1 || r < 0.72 || (z > 1 && y < HY + 15 && Math.abs(x) < 8.4)) continue;
        m.set(x, y, z, nem(x, y));
      }
  for (const sx of [-1, 1]) {
    for (let y = TY1 - 12; y <= HY + 6; y++) {
      const t = (HY + 6 - y) / (HY + 6 - TY1 + 12);
      for (let k = 0; k <= 3; k++) for (let z = 0; z <= 4; z++) m.set(sx * (9 + k + Math.round(t * 1.5)), y, z - 2 + Math.round(t * 2) + 3, nem(k, y));
    }
    // ears in front of the wings
    ell(m, sx * 8.6, HY + 9, 0, 1.4, 2.8, 1.8, skin);
  }
  // the brow, carved almond eyes (a recessed socket around a modelled eyeball), nose, lips
  for (let x = -6; x <= 6; x++) m.set(x, HY + 12, 7, SS.hi);
  for (const sx of [-1, 1]) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) if (Math.abs(dx) + Math.abs(dy) < 3) m.del(sx * 3.5 + dx, HY + 10 + dy, 7);
    m.set(sx * 3.5, HY + 10, 6, mix(SS.dark, 0x2a2018, 0.4));
    m.set(sx * 3.5 + sx, HY + 10, 6, SS.shade);
    // the painted eye line running to the temple
    for (let k = 3; k <= 5; k++) m.set(sx * (3.5 + k), HY + 10 - (k > 4 ? 1 : 0), 6, mix(PR.ink.base, SS.base, 0.45));
  }
  if (seed % 2 === 0) {
    // v0: the nose broken off (a rough scar)
    for (let y = HY + 6; y <= HY + 9; y++) m.set(0, y, 8, SS.shade);
  } else for (let y = HY + 5; y <= HY + 10; y++) for (let x = -1; x <= 1; x++) m.set(x, y, 8 + (y < HY + 7 ? 1 : 0), skin(x, y, 8));
  for (let x = -3; x <= 3; x++) {
    m.set(x, HY + 4, 8, x === 0 ? SS.shade : skin(x, HY + 4, 8));
    if (Math.abs(x) < 3) m.set(x, HY + 3, 8, SS.dark);
  }
  // the plaited false beard
  for (let y = HY - 6; y <= HY + 1; y++) for (let x = -2; x <= 2; x++) for (let z = 5; z <= 7; z++) m.set(x, y, z + (y < HY - 3 ? 1 : 0), y % 2 ? SS.shade : SS.base);
  // the uraeus rearing at the brow
  ell(m, 0, HY + 15, 6.5, 1.6, 2.4, 1.6, () => mix(PR.gold.base, SS.base, 0.4));
  // the double crown: the red crown's flat-backed rim, the tall white crown rising out of it (v1: split)
  const CY = HY + 17;
  for (let y = CY; y <= CY + 6; y++) for (let x = -8; x <= 8; x++) for (let z = -9; z <= 4; z++) if (inCircle(x, z + 2, 8.2) && (y < CY + 2 || !inCircle(x, z + 2, 6.4) || z < -5)) m.set(x, y, z, mix(PR.red.shade, SS.base, 0.55));
  for (let y = CY + 3; y <= CY + 22; y++) {
    const t = (y - CY - 3) / 19;
    const r = 5.4 * (1 - t * 0.55) + (t > 0.85 ? -1 : 0);
    if (seed % 2 === 1 && t > 0.72) continue;
    for (let x = -6; x <= 6; x++) for (let z = -8; z <= 4; z++) if (inCircle(x, (z + 2) * 1.1, r)) m.set(x, y, z, t > 0.9 ? SS.hi : mix(0xf0e8d8, SS.base, 0.45));
  }
  if (seed % 2 === 1) for (let k = 0; k < 6; k++) ell(m, 24 + k * 1.5, 15 + k * 0.2, -12 + k, 2.6, 2, 2.4, () => mix(0xf0e8d8, SS.base, 0.45));
  // weathering: chipped edges, a few deep cracks
  erode(m, rng, 0.18, 14);
  for (let c = 0; c < 5; c++) {
    let x = rng.range(-14, 14), y = rng.range(30, 90), z = 10;
    for (let k = 0; k < 18; k++) {
      x += rng.range(-1, 1);
      y -= rng.range(0.6, 1.4);
      for (let zz = 12; zz > -12; zz--) if (m.has(Math.round(x), Math.round(y), zz)) {
        m.set(Math.round(x), Math.round(y), zz, SS.dark);
        break;
      }
    }
  }
  sandDrift(m, 0, 30, 34, 10, 5, 13, seed);
  sandDrift(m, -30, 0, 8, 30, 6, 13, seed + 1);
  hollow(m);
  return S(m, VS);
}

// ------------------------------------------------------------------ jetty
export function jetty(seed = 0): StaticModel {
  const VS = 1 / 12;
  const rng = rngOf(seed, 471);
  const m = new VoxelModel('nile_jetty' + seed);
  const W = PR.wood, D = PR.woodDark, G = PR.woodGrey;
  const len = 120 + rng.int(0, 2) * 12; // 10-12 m
  const half = 17; // 2.9 m wide
  const deckY = 17;
  const plank = (k: number) => {
    const r = hash3(k, 3, seed);
    return r < 0.3 ? G.base : r < 0.55 ? W.shade : r < 0.85 ? W.base : D.hi;
  };
  // stringers under the deck, along its length
  for (const sx of [-12, 12]) for (let z = -len / 2; z <= len / 2; z++) for (let y = deckY - 3; y <= deckY - 1; y++) for (let x = sx - 1; x <= sx + 1; x++) m.set(x, y, z, D.base);
  // posts every ~2 m, both sides, cross-braced, the outer pair standing tall as mooring bollards
  const posts: number[] = [];
  for (let z = -len / 2 + 2; z <= len / 2 - 2; z += 24) posts.push(z);
  posts.push(len / 2 - 2);
  posts.forEach((pz, pi) => {
    const tall = pi === posts.length - 1 || pi === 0;
    for (const sx of [-1, 1]) {
      const px = sx * 15;
      const top = deckY + (tall ? 12 : 2) + rng.int(0, 2);
      for (let y = 0; y <= top; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        if (Math.abs(x) + Math.abs(z) === 2 && y > top - 1) continue;
        m.set(px + x, y, pz + z, y < 8 ? mix(D.base, 0x3a4a3a, 0.35) : y === top ? D.hi : hash3(px, y, pz) < 0.15 ? D.shade : D.base);
      }
      // rope lashings round the post at the deck and at the bollard head
      for (const ry of tall ? [deckY + 1, top - 3] : [deckY + 1]) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) m.set(px + x, ry, pz + z, (x + z) % 2 ? PR.rope.base : PR.rope.shade);
    }
    // X brace between the pair, above the water line
    if (pi % 2 === 0 && pi < posts.length - 1) {
      ray(m, [-14, 7, pz], [14, deckY - 4, pz], D.shade, 2);
      ray(m, [14, 7, pz], [-14, deckY - 4, pz], D.base, 2);
    }
  });
  // the deck: planks across, gaps, a few sprung or missing near the river end, nail heads
  for (let z = -len / 2; z <= len / 2; z++) {
    const k = Math.floor((z + len / 2) / 3);
    const gap = (z + len / 2) % 3 === 2 && hash3(k, 7, seed) < 0.5;
    if (gap) continue;
    const missing = z > len / 2 - 24 && hash3(k, 11, seed) < 0.16;
    if (missing) continue;
    const sprung = hash3(k, 13, seed) < 0.06 ? 1 : 0;
    const off = Math.round((hash3(k, 5, seed) - 0.5) * 3);
    for (let x = -half + off; x <= half + off; x++) {
      const c = plank(k);
      m.set(x, deckY + (sprung && x > 4 ? 1 : 0), z, (x + 4 * k) % 11 === 0 ? mulRGB(c, 0.92) : c);
      if ((x === -12 || x === 12) && (z + len / 2) % 3 === 1) m.set(x, deckY + 1, z, PR.iron.shade);
    }
  }
  // a lantern pole at the river end: a bent cedar arm and a hanging lamp with a glowing core
  const lz = len / 2 - 6;
  for (let y = deckY + 1; y <= deckY + 26; y++) m.set(-13, y, lz, D.base).set(-12, y, lz, D.shade);
  ray(m, [-13, deckY + 26, lz], [-5, deckY + 28, lz], D.base, 2);
  for (let y = deckY + 20; y <= deckY + 27; y++) m.set(-5, y, lz, PR.rope.shade);
  for (let x = -7; x <= -3; x++) for (let z = lz - 2; z <= lz + 2; z++) {
    m.set(x, deckY + 19, z, PR.brass.dark);
    m.set(x, deckY + 14, z, PR.brass.dark);
  }
  for (let y = deckY + 15; y <= deckY + 18; y++) for (let x = -6; x <= -4; x++) for (let z = lz - 1; z <= lz + 1; z++) m.set(x, y, z, x === -5 && z === lz ? 0xffc860 : 0xe8a040, x === -5 && z === lz ? VF.GLOW : VF.EMISSIVE);
  // jars and a basket by the landing, a coil of rope
  for (let j = 0; j < 3; j++) {
    const jx = 6 + j * 5, jz = -len / 2 + 14 + (j % 2) * 5;
    for (let y = 0; y <= 9; y++) {
      const r = y < 2 ? 2 : y < 7 ? 3.2 - Math.abs(y - 4.5) * 0.25 : 1.6;
      for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (inCircle(x, z, r)) m.set(jx + x, deckY + 1 + y, jz + z, y === 9 ? PR.terracotta.dark : (x + z + y) % 5 === 0 ? PR.terracotta.shade : PR.terracotta.base);
    }
  }
  for (let a = 0; a < 40; a++) {
    const t = a / 40, r = 2 + t * 3;
    const x = Math.round(Math.cos(t * Math.PI * 6) * r) - 8, z = Math.round(Math.sin(t * Math.PI * 6) * r) - len / 2 + 22;
    m.set(x, deckY + 1 + (t > 0.66 ? 1 : 0), z, a % 3 ? PR.rope.base : PR.rope.shade);
  }
  return S(m, VS);
}

// ------------------------------------------------------------------ shaduf
export function shaduf(seed = 0): StaticModel {
  const VS = 1 / 12;
  const rng = rngOf(seed, 619);
  const m = new VoxelModel('nile_shaduf' + seed);
  const MB = PR.adobe, D = PR.woodDark, W = PR.wood;
  // two mud-brick piers with courses and a capping slab
  for (const sx of [-1, 1])
    for (let y = 0; y <= 26; y++) {
      const w = y < 4 ? 5 : 4 - (y > 20 ? 1 : 0);
      for (let x = -w; x <= w; x++)
        for (let z = -4; z <= 4; z++) {
          const row = Math.floor(y / 3), off = row % 2 ? 2 : 0;
          const mortar = y % 3 === 2 || (x + off + 7) % 5 === 0;
          m.set(sx * 9 + x, y, z, mortar ? MB.shade : hash3(x, y, z) < 0.2 ? MB.hi : MB.base);
        }
    }
  // the crossbar pivot and the sweep pole (tilted: bucket end down toward the water at +z)
  for (let x = -9; x <= 9; x++) for (let y = 27; y <= 28; y++) m.set(x, y, 0, D.base);
  const tilt = 0.32 + rng.range(-0.06, 0.06);
  const back = 34, front = 52;
  const P = (d: number): [number, number, number] => [0, 28 + Math.sin(tilt) * -d + 1, Math.cos(tilt) * d];
  ray(m, P(-back), P(front), (t: number) => (t > 0.38 && t < 0.42 ? PR.rope.base : t < 0.1 ? W.shade : W.base), 2);
  // the counterweight: a lump of dried Nile mud bound with rope
  const cw = P(-back);
  ell(m, cw[0], cw[1] - 1, cw[2], 4.2, 4.6, 4.6, (x, y, z) => (Math.abs(y - cw[1] + 1) < 1 ? PR.rope.shade : hash3(x, y, z) < 0.3 ? 0x6e5236 : 0x5a432c));
  // the rope down to a leather bucket
  const tip = P(front);
  for (let y = Math.round(tip[1]); y >= 6; y--) m.set(0, y, Math.round(tip[2]), PR.rope.shade);
  for (let y = 0; y <= 5; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const r = 3 - (y < 2 ? 1 : 0);
    if (inCircle(x, z, r) && (!inCircle(x, z, r - 1) || y === 0)) m.set(x, y + 1, Math.round(tip[2]) + z, y === 5 ? PR.leather.dark : PR.leather.base);
  }
  // a mud basin and channel at its foot
  for (let x = -6; x <= 6; x++) for (let z = 6; z <= 16; z++) if (Math.abs(x) >= 5 || z === 6 || z === 16) m.set(x, 0, z, MB.shade);
  return S(m, VS);
}

// ------------------------------------------------------------------ charring (Ra's fire)
const CHAR = { black: 0x1e1816, coal: 0x2e2622, ash: 0x5a524c, ember: 0xff7a2a, emberHi: 0xffb05a };
/** a model after the fire: soot-black, ash-grey on the tops, gold dulled, a few embers */
export function charred(sm: StaticModel, seed = 0, embers = 0.012): StaticModel {
  const src = sm.model;
  const b = src.bounds();
  const m = new VoxelModel(src.name + '_charred');
  const H = Math.max(1, b.maxY - b.minY);
  src.forEach((x, y, z, c, f) => {
    const lum = (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
    const t = (y - b.minY) / H;
    let out = mix(CHAR.black, CHAR.ash, Math.min(1, lum * 0.9 + t * 0.15));
    if (f & VF.METAL) out = mix(c, CHAR.coal, 0.6);
    if (!src.has(x, y + 1, z) && hash3(x, y, z + seed) < 0.6) out = mix(out, CHAR.ash, 0.45);
    let flags: number = f & VF.METAL ? VF.METAL : VF.SOLID;
    if (hash3(x + seed, y, z) < embers && (!src.has(x + 1, y, z) || !src.has(x - 1, y, z) || !src.has(x, y, z + 1) || !src.has(x, y, z - 1))) {
      out = hash3(x, y + 3, z) < 0.4 ? CHAR.emberHi : CHAR.ember;
      flags = VF.EMISSIVE;
    }
    m.set(x, y, z, out, flags);
  });
  return { ...sm, model: m };
}

/** a burnt date palm: a black trunk split with embers, the crown burnt down to stubs */
export function charredPalm(seed = 0): StaticModel {
  const p = palm(seed);
  const src = p.model;
  const rng = new RNG(5501 + seed * 7);
  const b = src.bounds();
  let topY = 0;
  src.forEach((x, y, z, c) => {
    const g = (c >> 8) & 255, r = (c >> 16) & 255;
    if (!(g > r)) topY = Math.max(topY, y);
  });
  const m = new VoxelModel('charred_palm' + seed);
  src.forEach((x, y, z, c) => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255;
    const leaf = g > r + 10;
    if (leaf) {
      // fronds: only the burnt ribs near the crown survive
      const d = y - topY;
      if (d < -6 || rng.chance(0.78)) return;
      m.set(x, y - (rng.chance(0.3) ? 1 : 0), z, rng.chance(0.15) ? CHAR.ash : CHAR.black);
      return;
    }
    const t = (y - b.minY) / Math.max(1, topY - b.minY);
    const split = hash3(x, Math.floor(y / 3), z) < 0.05 && t > 0.15;
    if (split && (!src.has(x + 1, y, z) || !src.has(x - 1, y, z) || !src.has(x, y, z + 1) || !src.has(x, y, z - 1))) m.set(x, y, z, hash3(x, y, z) < 0.5 ? CHAR.ember : CHAR.emberHi, VF.EMISSIVE);
    else m.set(x, y, z, mix(CHAR.black, CHAR.coal, (Math.floor(y / 4) % 2) * 0.6 + hash3(x, y, z) * 0.2));
  });
  return { model: m, voxelSize: p.voxelSize };
}

// ------------------------------------------------------------------ obsidian
export function obsidianSpire(seed = 0): StaticModel {
  const VS = 1 / 10;
  const rng = rngOf(seed, 733);
  const m = new VoxelModel('obsidian' + seed);
  const OB = { black: 0x141016, deep: 0x221a26, sheen: 0x3e3448, edge: 0x6c6082, vein: 0xff6a1a, veinHi: 0xffb04a };
  const L = [-0.55, 0.75, 0.37];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const n = rng.int(3, 5);
  for (let s = 0; s < n; s++) {
    const H = rng.range(14, 34) * (s === 0 ? 1.3 : 1);
    const R = rng.range(3.2, 5.5) * (s === 0 ? 1.25 : 1);
    const a = (s / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const off = s === 0 ? 0 : rng.range(3, 6);
    const lean = s === 0 ? rng.range(0, 0.15) : rng.range(0.25, 0.55);
    const bx = Math.cos(a) * off, bz = Math.sin(a) * off;
    const sides = rng.int(3, 5);
    const rot = rng.range(0, Math.PI * 2);
    for (let y = 0; y <= H; y++) {
      const t = y / H;
      const r = R * (1 - t) ** 0.9 + 0.4;
      const cx = bx + Math.cos(a) * lean * y, cz = bz + Math.sin(a) * lean * y;
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++)
        for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
          const dx = x - cx, dz = z - cz;
          const ang = Math.atan2(dz, dx) - rot;
          const sector = Math.PI * 2 / sides;
          const k = ((ang % sector) + sector) % sector - sector / 2;
          const pr = r * Math.cos(sector / 2) / Math.cos(k);
          const dd = Math.hypot(dx, dz);
          if (dd > pr) continue;
          // facet shade: each face lit by its own normal
          const fa = rot + (Math.floor(((Math.atan2(dz, dx) - rot) % (Math.PI * 2) + Math.PI * 2) / sector) + 0.5) * sector;
          const nx = Math.cos(fa), nz = Math.sin(fa);
          const ndl = (nx * L[0] + 0.25 * L[1] + nz * L[2]) / ll;
          const edge = dd > pr - 1.05 && Math.abs(k) > sector * 0.38;
          let c = ndl > 0.35 ? OB.sheen : ndl > 0 ? OB.deep : OB.black;
          if (edge && ndl > 0.1) c = OB.edge;
          if (t > 0.92) c = OB.edge;
          m.set(Math.round(x), y, Math.round(z), c);
        }
    }
  }
  // rubble foot with molten veins glowing in the cracks
  for (let k = 0; k < 9; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(2, 8);
    ell(m, Math.cos(a) * r, 0.5, Math.sin(a) * r, rng.range(1.4, 2.8), rng.range(1, 2), rng.range(1.4, 2.8), (x, y, z) => (hash3(x, y, z) < 0.5 ? OB.black : OB.deep));
  }
  m.forEach((x, y, z) => {
    if (y > 4 || hash3(x, y, z + seed) > 0.05) return;
    if (m.has(x, y + 1, z)) return;
    m.set(x, y, z, hash3(x, 5, z) < 0.4 ? OB.veinHi : OB.vein, VF.EMISSIVE);
  });
  return S(m, VS);
}

// ------------------------------------------------------------------ flora for the sprite photographs
/** a clump of papyrus: tall three-sided stems, each crowned by a drooping starburst umbel */
export function papyrusClump(seed = 0): StaticModel {
  const VS = 1 / 30;
  const rng = new RNG(8101 + seed * 13);
  const m = new VoxelModel('papyrus' + seed);
  const G = [0x5e8a3a, 0x6a9a40, 0x4e7a32, 0x76a448];
  const stems = 9 + rng.int(0, 7);
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 5);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const H = rng.range(44, 62) * (i < 3 ? 1.08 : 1);
    const lean = rng.range(0.04, 0.16);
    const col = G[i % G.length];
    let tx = bx, tz = bz;
    for (let y = 0; y <= H; y++) {
      const t = y / H;
      tx = bx + Math.cos(a) * lean * y * t * 1.4;
      tz = bz + Math.sin(a) * lean * y * t * 1.4;
      m.set(Math.round(tx), y, Math.round(tz), t < 0.12 ? 0x8a6a3a : t > 0.9 ? mulRGB(col, 1.08) : col);
      if (t < 0.5 && y % 2 === 0) m.set(Math.round(tx) + 1, y, Math.round(tz), mulRGB(col, 0.86));
    }
    // the umbel: 20-30 rays fanning out and down, yellow-brown tips (young heads stay closed)
    const young = rng.chance(0.2);
    const rays = young ? 8 : 20 + rng.int(0, 10);
    for (let k = 0; k < rays; k++) {
      const ra = rng.range(0, Math.PI * 2), L = young ? rng.range(2, 3) : rng.range(6, 10);
      const up = young ? rng.range(2, 4) : rng.range(-1, 3);
      ray(m, [tx, H, tz], [tx + Math.cos(ra) * L, H + up - (young ? 0 : L * 0.35), tz + Math.sin(ra) * L], (t: number) => (t > 0.82 ? 0xb8b458 : t > 0.6 ? 0x8ab84e : 0x6e9a42));
    }
    blob(m, tx, H, tz, 1.2, 1, 1.2, 0x5a8236);
  }
  // sheath leaves at the foot
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    ray(m, [0, 0, 0], [Math.cos(a) * 4, rng.range(5, 9), Math.sin(a) * 4], (t: number) => (t > 0.7 ? 0x9a7a44 : 0x7a5e34));
  }
  return S(m, VS);
}

/** a tuft of the farmers' crop: barley heavy with ears (v0, v1), flax in blue flower (v2), young green wheat (v3) */
export function cropTuft(seed = 0): StaticModel {
  const VS = 1 / 30;
  const rng = new RNG(9203 + seed * 31);
  const m = new VoxelModel('crop' + seed);
  const kind = seed % 4;
  const stalks = kind === 3 ? 18 : 14 + rng.int(0, 6);
  for (let i = 0; i < stalks; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 4.5);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const H = kind === 3 ? rng.range(12, 20) : kind === 2 ? rng.range(22, 30) : rng.range(24, 33);
    const bend = rng.range(0.1, 0.3);
    let x = bx, z = bz;
    for (let y = 0; y <= H; y++) {
      const t = y / H;
      x = bx + Math.cos(a) * bend * y * t;
      z = bz + Math.sin(a) * bend * y * t;
      const stem = kind === 3 ? (t > 0.7 ? 0x8ac458 : 0x6ea840) : kind === 2 ? 0x6a9a48 : t > 0.6 ? 0xc8b45a : 0x8aa04a;
      m.set(Math.round(x), y, Math.round(z), stem);
      if (kind === 3 && y > 3 && y % 4 === 0) ray(m, [x, y, z], [x + Math.cos(a + 1.4) * 3, y + 2, z + Math.sin(a + 1.4) * 3], 0x7ab84a);
    }
    if (kind <= 1) {
      // an ear of grain nodding over, with bristling awns
      const ex = Math.cos(a) * 2, ez = Math.sin(a) * 2;
      for (let k = 0; k < 6; k++) {
        const px = x + ex * (k / 6), pz = z + ez * (k / 6), py = H + 1 - k * 0.6;
        m.set(Math.round(px), Math.round(py), Math.round(pz), k % 2 ? 0xe0c060 : 0xd0a848);
        if (k % 2 === 0) m.set(Math.round(px + Math.cos(a + 1.6)), Math.round(py + 1), Math.round(pz + Math.sin(a + 1.6)), 0xf0dc8a);
      }
    } else if (kind === 2 && rng.chance(0.7)) {
      m.set(Math.round(x), H + 1, Math.round(z), 0x6a8ae0);
      m.set(Math.round(x) + 1, H + 1, Math.round(z), 0x8aa6f0);
      m.set(Math.round(x), H + 1, Math.round(z) + 1, 0x5a78c8);
    }
  }
  return S(m, VS);
}
