// THOTH'S HALL, the main menu's way in: a mysterious temple door half swallowed by the dunes.
// A weathered sandstone outcrop (strata, cracks, wind-cut ledges, sand drifted over its shoulders)
// has an Egyptian doorway cut into its face: dressed ashlar round a battered jamb frame carved with
// glowing glyph columns, a rope-bound torus bead, a winged sun disc on the lintel and a flared cavetto
// cornice. Three half-buried steps climb to a worn threshold. Behind it a pair of bronze-strapped
// cedar leaves (gold studs, inlaid ibises, ring pulls) stand ajar on their hinges: the left one barely,
// the right one swung inward, and through the gap cold blue light pours from stairs that sink into a
// glowing passage where Thoth's ibis shines on the far wall. Flying books (rigged, flapping) drift out
// of the gap, glyph motes and light dust spill onto the sand.
// Hover: the glyphs and the light flare, the door swings a little wider, the books stir. Click: the
// door swings open and a shower of glyphs bursts out (MenuScene then opens the hall).
//
//   const sign = new KnowledgeSign(particles);  scene.add(sign.group);  sign.group.position...
//   sign.update(dt, hot)   (hot 0..1)
//   sign.proxy             an invisible box for raycasts
//   sign.burst()           the click
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildRigGeo, RigInstance, RigSpec } from '../../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { noise, hash2, hash3 } from '../../../engine/math/rand';
import { mixRGB } from '../../models/props/helpers';
import type { Particles } from '../../fx/Particles';
import { flyingBookRig, GLYPH_BITMAPS } from './HallModels';

const VS = 1 / 48;
/** model y of the threshold above the ground (the outcrop is raised on its buried steps) */
const LIFT = 16;
const OW = 20, OH = 78; // the opening: x -OW..OW-1, y 0..OH-1
const PZ = -44; // the passage's far wall

const ROCK = [0xc89a66, 0xbd8d5a, 0xd4a872, 0xb07e50, 0xc49460];
const ROCK_DARK = 0x6a4a30;
const ASHLAR = [0xdcbc8c, 0xd2b07e, 0xe4c898];
const SAND = { base: 0xeac28a, shade: 0xdcae70, hi: 0xf6d6a2, dark: 0xbc8e56 };
const GOLD = { hi: 0xffe6a0, base: 0xe2b24a, shade: 0xa8741e, dark: 0x6a4410 };
const LAPIS = 0x24407e;
const BRONZE = { hi: 0xd09a5a, base: 0xa8743a, shade: 0x7a5026, verd: 0x4f9a82, verdDark: 0x2f6a5a };
const CEDAR = [0x6a4428, 0x5a3a22, 0x7a5030, 0x4e321c];
const ICE = { deep: 0x2a2a44, mid: 0x2f6ab8, lit: 0x5ac8f8, pale: 0xbfefff, white: 0xeefcff };

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) => {
  const l = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
  return (l - 1) * Math.min(rx, ry, rz);
};
/** the passage floor: level at the threshold, then five steps down into the light */
const floorAt = (z: number) => (z >= -2 ? 0 : Math.max(-15, -3 * Math.floor((-z + 1) / 4)));
const inPassage = (x: number, y: number, z: number) => x >= -OW && x < OW && z < 8 && z >= PZ && y >= floorAt(z) && y < OH;
/** the outer edge of the battered jamb at height y */
const jambOut = (y: number) => 33 - Math.floor(y * 0.045);

function glyphOn(k: number, gx: number, gy: number, flip = false) {
  const g = GLYPH_BITMAPS[k % GLYPH_BITMAPS.length];
  const row = g[gy];
  if (!row) return false;
  const i = flip ? row.length - 1 - gx : gx;
  return row[i] === '#';
}

// ============================================================================ the outcrop + doorway
function outcrop(): VoxelModel {
  const m = new VoxelModel('thoth_door_frame');
  const X0 = -80, X1 = 72, Y0 = -LIFT - 6, Y1 = 108, Z0 = PZ - 6, Z1 = 14;
  const NX = X1 - X0 + 1, NY = Y1 - Y0 + 1, NZ = Z1 - Z0 + 1;
  const sd = new Float32Array(NX * NY * NZ);
  const idx = (x: number, y: number, z: number) => x - X0 + NX * (y - Y0 + NY * (z - Z0));
  // ---- the rock's distance field (voxel units), noise only near the surface
  for (let z = Z0; z <= Z1; z++)
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        // only the faces the camera can see are kept: nothing far behind the facade
        if (z < -36 && !(x >= -OW - 3 && x < OW + 3)) {
          sd[idx(x, y, z)] = 1;
          continue;
        }
        let d = ell(x, y, z, 0, 40, -16, 60, 62, 26);
        d = smin(d, ell(x, y, z, -48, 14, -10, 34, 32, 20), 14);
        d = smin(d, ell(x, y, z, 44, 18, -12, 26, 38, 18), 14);
        // the temple block around the passage
        const bx = Math.abs(x) - 34, by = Math.abs(y - 40) - 66, bz = Math.abs(z - (PZ - 2) / 2) - (-(PZ - 2) / 2 + 2);
        d = smin(d, Math.max(bx, by, bz), 8);
        if (Math.abs(d) < 14) {
          d += noise.n3(x * 0.045, y * 0.05, z * 0.045) * 7 + noise.n3(x * 0.1 + 7, y * 0.1, z * 0.1) * 1.3;
          d += Math.sin(y * 0.5 + noise.n2(x * 0.03, z * 0.03) * 2) * 0.5; // wind-cut strata ledges
        }
        // the dressed facade round the doorway: a flat face at z = 0 inside a ragged border
        const fx = Math.abs(x) - 46 - noise.n2(y * 0.09, 3) * 4, fy = y - 110 - noise.n2(x * 0.09, 5) * 4;
        if (fx < 0 && fy < 0 && y > -LIFT - 2) d = Math.max(d, z);
        // the passage
        if (inPassage(x, y, z)) d = Math.max(d, 1);
        if (y < -LIFT - 4) d = Math.max(d, 1);
        sd[idx(x, y, z)] = d;
      }
  const solid = (x: number, y: number, z: number) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && z >= Z0 && z <= Z1 && sd[idx(x, y, z)] <= 0;
  for (let z = Z0; z <= Z1; z++)
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const d = sd[idx(x, y, z)];
        if (d > 0 || d < -5) continue;
        // only a shell: skip voxels with every neighbour solid
        if (solid(x + 1, y, z) && solid(x - 1, y, z) && solid(x, y + 1, z) && solid(x, y - 1, z) && solid(x, y, z + 1) && solid(x, y, z - 1)) continue;
        const nearPassage = x >= -OW - 2 && x < OW + 2 && z < 6 && z >= PZ - 2 && y >= floorAt(z) - 2 && y < OH + 2;
        let c: number;
        let f: number = VF.SOLID;
        if (nearPassage && z < 0) {
          // inside: cold stone that sinks into blue light; gold glyph bands on the walls
          const k = Math.min(1, -z / 34);
          c = k < 0.18 ? mixRGB(ICE.deep, ICE.mid, k / 0.18 * 0.4) : k < 0.7 ? mixRGB(ICE.mid, ICE.lit, (k - 0.18) / 0.52) : mixRGB(ICE.lit, ICE.pale, (k - 0.7) / 0.3);
          if (hash3(x, y, z) < 0.15) c = mixRGB(c, 0x000000, 0.18);
          if (k > 0.2) f = VF.EMISSIVE;
          const wall = x === -OW - 1 || x === OW;
          if (wall && -z > 8 && -z < 40) {
            const gy = (((y - 6) % 12) + 12) % 12, gx = ((-z - 8) % 9 + 9) % 9;
            if (gy < 9 && gx < 7 && glyphOn(Math.floor((-z - 8) / 9) + Math.floor((y - 6) / 12) * 2, gx, 8 - gy)) (c = GOLD.hi), (f = VF.GLOW);
            if (gy === 10) c = mixRGB(c, GOLD.base, 0.6);
          }
          if (y === floorAt(z) && floorAt(z - 1) !== floorAt(z)) c = mixRGB(c, ICE.white, 0.35); // lit step nosings
        } else if (z >= -1 && z <= 1 && Math.abs(x) <= 48 && y > -LIFT && y < 112 && !nearPassage) {
          // dressed ashlar round the frame, eroding into the raw rock at its border
          const course = Math.floor((y + 200) / 12), joint = (y + 200) % 12 === 0;
          const vj = (x + 200 + (course & 1) * 9) % 18 === 0;
          c = ASHLAR[Math.floor(hash2(course, Math.floor((x + 200 + (course & 1) * 9) / 18)) * 3)];
          if (joint || vj) c = mixRGB(c, ROCK_DARK, 0.45);
          if (hash3(x, y, 9) < 0.08) c = mixRGB(c, ROCK[3], 0.5);
          if (noise.n2(x * 0.06, y * 0.06) > 0.5) c = mixRGB(c, ROCK[1], 0.4);
        } else {
          const band = Math.floor((y + 200 + noise.n2(x * 0.04, z * 0.04) * 5) / 5);
          c = ROCK[Math.floor(hash2(band, 3) * ROCK.length)];
          if (hash3(x, y, z) < 0.12) c = mixRGB(c, ROCK[3], 0.6);
          if (Math.abs(noise.n3(x * 0.06, y * 0.015, z * 0.06)) < 0.025) c = ROCK_DARK; // cracks
          // drifted sand on every ledge that faces up, more on the windward (left) side
          if (!solid(x, y + 1, z) && !solid(x, y + 2, z) && noise.n2(x * 0.08, z * 0.08) + (x < 0 ? 0.35 : -0.1) > -0.2) {
            const r = noise.n2(x * 0.4 + z * 0.15, z * 0.1);
            c = r > 0.45 ? SAND.hi : r < -0.45 ? SAND.shade : SAND.base;
          }
          if (y < -LIFT + 4) c = mixRGB(c, SAND.dark, 0.4);
        }
        m.set(x, y, z, c, f);
      }
  // ---- the far wall: Thoth's ibis shining out of pale light
  for (let y = -15; y < OH; y++)
    for (let x = -OW; x < OW; x++) {
      const gx = Math.floor((x + 10) / 3), gy = Math.floor((60 - y) / 4);
      const ibis = x >= -10 && x < 11 && y > 24 && y <= 60 && glyphOn(0, gx, gy);
      m.set(x, y, PZ - 1, ibis ? GOLD.hi : mixRGB(ICE.lit, ICE.pale, 0.35 + hash2(x, y) * 0.3), ibis ? VF.GLOW : VF.EMISSIVE);
    }
  // ---- the jambs (battered), glyph columns, rope-bound torus bead
  for (const s of [-1, 1]) {
    for (let y = 0; y < 90; y++) {
      const out = jambOut(y);
      for (let a = OW; a <= out; a++) {
        const x = s > 0 ? a : -a - 1;
        for (let z = -6; z <= 5; z++) {
          const front = z === 5;
          let c = ASHLAR[(Math.floor(y / 6) + a) % 3];
          let f: number = VF.SOLID;
          if (hash3(x, y, z) < 0.1) c = mixRGB(c, ROCK[3], 0.5);
          if (front) {
            // the torus bead on the outer edge: a rope binding wound round it
            if (a >= out - 1) c = (y + a) % 4 < 2 ? GOLD.shade : 0xc8a070;
            // incised border lines and the glyph column between them
            const u = a - OW; // 0 at the opening
            if (u === 2 || u === out - OW - 3) c = mixRGB(c, ROCK_DARK, 0.6);
            const gx = u - 3, gy = (y - 4) % 11;
            if (gx >= 0 && gx < 7 && y >= 4 && y < 81 && gy < 9) {
              const k = Math.floor((y - 4) / 11) * 3 + (s > 0 ? 1 : 0);
              if (glyphOn(k, s > 0 ? gx : 6 - gx, 8 - gy)) {
                // carved and filled with light: ibises in gold, the rest in cold blue
                m.set(x, y, 4, k % GLYPH_BITMAPS.length === 0 ? GOLD.hi : ICE.lit, VF.GLOW);
                continue;
              }
            }
            if (gy === 10 && gx >= -1 && gx < 8 && y < 81) c = mixRGB(c, LAPIS, 0.5); // register lines
            // chips and wear
            if (hash3(x, y, 77) < 0.05) continue;
          }
          m.set(x, y, z, c, f);
        }
      }
      // the opening's reveal: a gold fillet down the inner edge
      m.set(s > 0 ? OW : -OW - 1, y, 5, y < OH ? GOLD.base : ASHLAR[0], y < OH ? VF.METAL : VF.SOLID);
    }
  }
  // ---- the lintel and its winged sun disc
  for (let y = OH; y < 92; y++)
    for (let x = -36; x < 36; x++)
      for (let z = -6; z <= 6; z++) {
        let c = ASHLAR[(Math.floor(x / 9) + 9 + Math.floor(y / 7)) % 3];
        if (z === 6 && (y === OH || y === 91)) c = mixRGB(c, ROCK_DARK, 0.5);
        if (hash3(x, y, z) < 0.08) c = mixRGB(c, ROCK[3], 0.5);
        m.set(x, y, z, c);
      }
  for (let y = OH + 1; y < 91; y++)
    for (let x = -34; x < 34; x++) {
      const ax = Math.abs(x + 0.5);
      const dy = y - 85;
      // the sun disc with a lapis rim
      const r = Math.hypot(x + 0.5, dy);
      if (r < 5.2) {
        m.set(x, y, 7, r < 4 ? (r < 2 ? 0xfff6d0 : GOLD.hi) : GOLD.base, VF.GLOW);
        continue;
      }
      if (r < 6.2) {
        m.set(x, y, 7, LAPIS, VF.METAL);
        continue;
      }
      // twin uraei rising either side of it
      if (ax >= 6 && ax < 8 && dy >= -4 && dy <= 3) {
        m.set(x, y, 7, dy === 3 ? GOLD.hi : GOLD.shade, VF.METAL);
        continue;
      }
      // the wings: tapered, three feather rows (gold coverts, lapis and turquoise flights)
      const top = 90 - (ax - 7) * 0.13, bot = 81 + (ax - 7) * 0.2;
      if (ax >= 7 && ax < 34 && y <= top && y >= bot) {
        const k = (y - bot) / Math.max(1, top - bot);
        const feather = Math.floor(ax) % 3 === 0;
        let c = k > 0.66 ? GOLD.base : k > 0.33 ? LAPIS : 0x3aa8a0;
        if (feather) c = mixRGB(c, 0x000000, 0.35);
        if (k > 0.9) c = GOLD.hi;
        m.set(x, y, 7, c, k > 0.66 ? VF.METAL | VF.EMISSIVE : VF.EMISSIVE);
      }
    }
  // ---- the cavetto cornice: flared, fluted, its old paint half gone
  for (let y = 92; y <= 104; y++) {
    const k = Math.min(1, (y - 92) / 10);
    const flare = Math.round(k * k * 6);
    for (let x = -38 - flare; x < 38 + flare; x++)
      for (let z = -8; z <= 7 + flare; z++) {
        const fl = ((x + 400) % 4) < 2;
        let c = y >= 103 ? ASHLAR[2] : fl ? 0xc8a070 : 0xb08458;
        if (y < 103 && fl && noise.n2(x * 0.2, y * 0.3) > 0.1) c = (x + 400) % 8 < 4 ? 0x4a6a8a : 0xa8442a; // faded paint
        if (y === 92) c = (x + y) % 3 === 0 ? GOLD.shade : 0xc8a070; // the torus bead under it
        if (hash3(x, y, z) < 0.06) continue;
        m.set(x, y, z, c);
      }
  }
  // ---- the threshold and three steps half buried in sand
  for (let x = -OW - 4; x < OW + 4; x++)
    for (let z = -2; z <= 7; z++)
      for (let y = -3; y <= 0; y++) {
        const worn = y === 0 && Math.abs(x) < 12 && z > 0 && z < 6 && hash2(x, z) < 0.5;
        if (worn) continue;
        m.set(x, y, z, y === 0 ? (hash2(x, z * 3) < 0.2 ? ASHLAR[1] : ASHLAR[2]) : ASHLAR[0]);
      }
  for (let s = 0; s < 3; s++) {
    const y1 = -4 - s * 5, z0 = 8 + s * 7, z1 = 14 + s * 7, w = OW + 6 + s * 3;
    for (let x = -w; x < w; x++)
      for (let z = z0 - 8; z <= z1; z++)
        for (let y = y1 - 5; y <= y1; y++) {
          if (z < 6) continue;
          // a corner broken off one step, cracks in another
          if (s === 1 && x > w - 9 && z > z1 - 4 && y > y1 - 3) continue;
          let c = y === y1 ? ASHLAR[(x + s) % 3 === 0 ? 0 : 2] : ASHLAR[1];
          if (z === z1 && y === y1) c = mixRGB(c, 0xffffff, 0.12);
          if (s === 2 && Math.abs(x - 6 - Math.round(Math.sin(z * 0.7) * 2)) < 1 && y === y1) c = ROCK_DARK;
          m.set(x, y, z, c);
        }
  }
  // ---- the dune drifted against it all
  for (let x = -90; x <= 90; x++)
    for (let z = -8; z <= 44; z++) {
      const left = 30 * Math.exp(-((x + 50) ** 2) / 700 - ((z - 4) ** 2) / 260);
      const right = 16 * Math.exp(-((x - 54) ** 2) / 400 - ((z - 6) ** 2) / 200);
      const apron = 9 * Math.exp(-((z - 14) ** 2) / 220) * (0.7 + 0.3 * noise.n2(x * 0.05, 1));
      const onSteps = Math.abs(x) < OW + 14 ? 6 * Math.exp(-((x + 18) ** 2) / 120) * Math.exp(-((z - 20) ** 2) / 90) : 0;
      const h = Math.round(-LIFT - 4 + left + right + apron + onSteps + noise.n2(x * 0.07, z * 0.07) * 2);
      if (h < -LIFT) continue;
      for (let y = h - 2; y <= h; y++) {
        if (y < h - 1 && (m.has(x, y, z) || solidRock(sd, idx, x, y, z, X0, X1, Y0, Y1, Z0, Z1))) continue;
        if (inPassage(x, y, z) && z < 6) continue;
        const r = Math.sin(x * 0.45 + z * 0.18 + noise.n2(x * 0.05, z * 0.05) * 3);
        const c = y < h ? SAND.shade : r > 0.6 ? SAND.hi : r < -0.7 ? SAND.dark : SAND.base;
        m.set(x, y, z, c);
      }
    }
  return m;
}
function solidRock(sd: Float32Array, idx: (x: number, y: number, z: number) => number, x: number, y: number, z: number, X0: number, X1: number, Y0: number, Y1: number, Z0: number, Z1: number) {
  return x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && z >= Z0 && z <= Z1 && sd[idx(x, y, z)] <= 0;
}

/** one cedar leaf, hinge at x = 0, swinging into -z; side -1 mirrors it for the right leaf */
function leaf(side: 1 | -1): VoxelModel {
  const m = new VoxelModel('thoth_door_leaf');
  const W = OW;
  for (let u = 0; u < W; u++)
    for (let y = 0; y < OH - 1; y++)
      for (let z = 0; z <= 3; z++) {
        const x = side > 0 ? u : -u - 1;
        const front = z === 3;
        const plank = Math.floor(u / 5);
        let c = CEDAR[(plank * 3 + (hash2(u, Math.floor(y / 9)) < 0.3 ? 1 : 0)) % 4];
        if (u % 5 === 0) c = mixRGB(c, 0x000000, 0.35); // plank seams
        if (noise.n2(u * 0.3, y * 0.05 + plank) > 0.5) c = mixRGB(c, CEDAR[3], 0.5); // grain
        let f: number = VF.SOLID;
        if (front) {
          const edge = u < 2 || u >= W - 2 || y < 2 || y >= OH - 3;
          const strap = Math.abs(y - 14) < 2 || Math.abs(y - 40) < 2 || Math.abs(y - 66) < 2;
          if (edge || strap) {
            // bronze, green where the weather got at it
            const v = noise.n2(u * 0.25 + side * 5, y * 0.25);
            c = v > 0.25 ? BRONZE.verd : v < -0.4 ? BRONZE.shade : BRONZE.base;
            if (hash2(u * 7, y) < 0.08) c = BRONZE.verdDark;
            f = VF.METAL;
            // gold studs along the straps
            if (strap && (y === 14 || y === 40 || y === 66) && u % 4 === 2) {
              m.set(x, y, 4, GOLD.hi, VF.METAL);
              c = GOLD.base;
            }
          } else {
            // the inlaid ibis on the upper panel (the two leaves face each other), an eye below it
            const ib = y >= 44 && y < 62 && u >= 3 && u < 17;
            if (ib && glyphOn(0, Math.floor((u - 3) / 2), 8 - Math.floor((y - 44) / 2), side < 0)) (c = GOLD.base), (f = VF.METAL | VF.EMISSIVE);
            const ey = y >= 20 && y < 36 && u >= 3 && u < 17;
            if (ey && glyphOn(1, Math.floor((u - 3) / 2), 8 - Math.floor((y - 20) / 2), side < 0)) (c = 0x5ac8f8), (f = VF.EMISSIVE);
          }
        }
        m.set(x, y, z, c, f);
      }
  // hinge knuckles and the ring pull on the meeting edge
  for (const hy of [8, 38, 68]) for (let y = hy; y < hy + 6; y++) m.set(side > 0 ? -1 : 0, y, 2, BRONZE.base, VF.METAL).set(side > 0 ? -1 : 0, y, 1, BRONZE.shade, VF.METAL);
  const rx = side > 0 ? W - 4 : -W + 3;
  for (let a = 0; a < 20; a++) {
    const th = (a / 20) * Math.PI * 2;
    m.set(rx + Math.round(Math.cos(th) * 2.4), 38 + Math.round(Math.sin(th) * 3.4), 4, Math.sin(th) > 0 ? BRONZE.hi : BRONZE.shade, VF.METAL);
  }
  m.set(rx, 41, 4, GOLD.hi, VF.METAL);
  return m;
}

function timed(f: () => VoxelModel) {
  const t0 = performance.now();
  const m = f();
  console.log('[door] outcrop', Math.round(performance.now() - t0), 'ms', m.map.size, 'voxels');
  return m;
}
/** the door as a rig: the outcrop and frame, and the two leaves on their hinges */
function templeDoorRig(): RigSpec {
  return {
    name: 'thoth_door',
    voxelSize: VS,
    parts: [
      { name: 'frame', model: timed(outcrop), pivot: [0, 0, 0], attach: [0, LIFT, 0] },
      { name: 'leaf_l', model: leaf(1), pivot: [0, 0, 2], parent: 'frame', attach: [-OW, 0, -2], rest: [0, 0.22, 0] },
      { name: 'leaf_r', model: leaf(-1), pivot: [0, 0, 2], parent: 'frame', attach: [OW, 0, -2], rest: [0, -1.15, 0] },
    ],
    meta: { height: (104 + LIFT) * VS, radius: 1.7 },
  };
}

interface Book {
  rig: RigInstance;
  t: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  flap: number;
  spin: number;
}

export class KnowledgeSign {
  group = new THREE.Group();
  /** raycast target (invisible) */
  proxy: THREE.Mesh;
  private door: RigInstance;
  private mat: VoxelMaterial;
  private books: Book[] = [];
  private light: THREE.PointLight;
  private spill: THREE.PointLight;
  private t = 0;
  private hot = 0;
  private burstT = -1;
  private open = 1.15;
  /** the gap the light pours out of (group space) */
  private gap = new THREE.Vector3(0.12, (LIFT + 34) * VS, -0.05);

  constructor(private particles: Particles) {
    this.mat = makeVoxelMaterial({ emissiveStrength: 1 });
    this.door = new RigInstance(buildRigGeo(templeDoorRig(), 'thoth_door'), { material: this.mat, castShadow: true });
    this.group.add(this.door.root);
    // the hit box: the doorway and its frame
    const W = 76 * VS * 2, H = (106 + LIFT) * VS;
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.set(0, H / 2, 0.15);
    this.group.add(this.proxy);
    // books that wander out of the gap, one after another
    for (let k = 0; k < 3; k++) {
      const rig = new RigInstance(buildRigGeo(flyingBookRig((k * 2 + 1) % 5), 'sign:book:' + ((k * 2 + 1) % 5)), { castShadow: false });
      rig.root.scale.setScalar(0.001);
      this.group.add(rig.root);
      this.books.push({ rig, t: -1.5 - k * 2.6, life: 7 + k, p: new THREE.Vector3(), v: new THREE.Vector3(), flap: k, spin: 0 });
    }
    // cold light spilling onto the sand in front, and a glow held in the doorway
    this.light = new THREE.PointLight(0x8ad0ff, 0, 6.5, 2);
    this.light.position.set(0.15, (LIFT + 30) * VS, 0.75);
    this.group.add(this.light);
    this.spill = new THREE.PointLight(0x5ab0ff, 0, 3, 2);
    this.spill.position.set(0.1, (LIFT + 10) * VS, -0.35);
    this.group.add(this.spill);
  }

  /** a click: the door swings wide and a shower of glyphs and light bursts out */
  burst() {
    this.burstT = 0;
    const p = this.group.localToWorld(this.gap.clone());
    this.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 50, spread: 1.6, up: 1.2, life: [0.6, 1.4], size: [0.1, 0.02], sprite: ['ankh', 'eye', 'feather', 'scarab', 'star4'], color: [0xffe08a, 0xbfe0ff, 0xffffff], additive: true, drag: 1.4 });
    this.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 6, spread: 0.4, life: [0.6, 1.0], size: [0.9, 1.6], sprite: 'glow32', color: 0x7ad0ff, alpha: 0.35, additive: true, fadeIn: 0.1 });
  }

  update(dt: number, hot: number) {
    this.t += dt;
    const t = this.t;
    this.hot += (hot - this.hot) * (1 - Math.exp(-dt * 6));
    const h = this.hot;
    this.group.updateMatrixWorld(true);
    // the right leaf breathes on its hinge (as if a draught pulled at it); hover swings it wider, the click wide open
    const want = 1.15 + h * 0.25 + Math.sin(t * 0.7) * 0.04 + (this.burstT >= 0 ? 0.3 : 0);
    this.open += (want - this.open) * (1 - Math.exp(-dt * (this.burstT >= 0 ? 6 : 2.5)));
    const nr = this.door.nodes['leaf_r'], nl = this.door.nodes['leaf_l'];
    if (nr) nr.rotation.y = -this.open;
    if (nl) nl.rotation.y = 0.22 + h * 0.08 + Math.sin(t * 0.9 + 1) * 0.012 + (this.burstT >= 0 ? 0.4 : 0);
    if (this.burstT >= 0) {
      this.burstT += dt;
      if (this.burstT > 1.4) this.burstT = -1;
    }
    // glyphs and light: a slow pulse, flaring on hover
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6) * Math.sin(t * 0.43 + 1);
    (this.mat.userData.emissiveStrength as { value: number }).value = 0.95 + pulse * 0.25 + h * 0.9 + (this.burstT >= 0 ? 0.8 : 0);
    this.light.intensity = 2.4 + pulse * 0.8 + h * 3.2 + (this.burstT >= 0 ? 3 : 0) + Math.sin(t * 7.3) * 0.08;
    this.spill.intensity = 1.6 + h * 1.6;
    const gp = this.group.localToWorld(this.gap.clone());
    // light dust drifting out of the gap, glyph motes now and then, a soft glow held in the doorway
    if (Math.random() < dt * (7 + h * 16)) {
      const s = this.group.localToWorld(new THREE.Vector3(0.05 + Math.random() * 0.35, (LIFT + 4 + Math.random() * 64) * VS, -0.1));
      const out = new THREE.Vector3(0, 0, 0.25 + Math.random() * 0.3).applyQuaternion(this.group.quaternion);
      this.particles.emit({ pos: s, vel: { x: out.x + (Math.random() - 0.5) * 0.1, y: 0.04 + Math.random() * 0.1, z: out.z }, count: 1, life: [2, 3.4], size: [0.035, 0.015], sprite: Math.random() < 0.7 ? 'dot2' : 'star4', color: Math.random() < 0.75 ? 0xbfe8ff : 0xffe6a0, additive: true, drag: 0.4, fadeIn: 0.4 });
    }
    if (Math.random() < dt * (0.9 + h * 3)) {
      const out = new THREE.Vector3((Math.random() - 0.3) * 0.25, 0.12 + Math.random() * 0.2, 0.3 + Math.random() * 0.25).applyQuaternion(this.group.quaternion);
      this.particles.emit({ pos: gp, vel: out, count: 1, life: [2.2, 3.2], size: [0.09, 0.05], sprite: ['ankh', 'eye', 'feather', 'scarab'], color: [0xffe08a, 0xbfe0ff], additive: true, drag: 0.3, fadeIn: 0.3 });
    }
    if (Math.random() < dt * 2.2) {
      this.particles.emit({ pos: { x: gp.x, y: gp.y - 0.1 + Math.random() * 0.4, z: gp.z }, count: 1, life: [1.6, 2.4], size: [0.8, 1.1], sprite: 'glow32', color: 0x5ab8ff, alpha: 0.12 + h * 0.1, additive: true, fadeIn: 0.8 });
    }
    // books: slip out of the gap, flap up and away in a lazy arc, fade; then the next one
    for (const b of this.books) {
      b.t += dt;
      if (b.t < 0) continue;
      if (b.t === dt || b.t - dt < 0) {
        b.p.set(0.12 + Math.random() * 0.2, (LIFT + 26 + Math.random() * 30) * VS, -0.45);
        b.v.set((Math.random() - 0.4) * 0.25, 0.08, 0.3 + Math.random() * 0.12);
        b.spin = (Math.random() - 0.5) * 0.6;
      }
      const k = b.t / b.life;
      if (k >= 1) {
        b.t = -2 - Math.random() * 3;
        b.rig.root.scale.setScalar(0.001);
        continue;
      }
      // a slow climb that curls away from the door
      b.v.y += dt * (0.05 + h * 0.08);
      b.v.x += Math.sin(t * 0.5 + b.flap) * dt * 0.08;
      b.v.multiplyScalar(1 - dt * 0.12);
      b.p.addScaledVector(b.v, dt * (1 + h * 0.6));
      b.rig.root.position.set(b.p.x, b.p.y + Math.sin(t * 2.2 + b.flap) * 0.04, b.p.z);
      b.rig.root.rotation.set(0.35, Math.atan2(b.v.x, b.v.z) + Math.PI / 2 + Math.sin(t + b.flap) * 0.2, Math.sin(t * 1.3 + b.flap) * 0.18, 'YXZ');
      const grow = Math.min(1, b.t / 0.8), fade = Math.min(1, (1 - k) * 4);
      b.rig.root.scale.setScalar(Math.max(0.001, 0.85 * grow * fade));
      b.flap += dt * (4 + h * 5);
      const fl = 0.5 + Math.sin(b.flap) * 0.5;
      b.rig.nodes['cover_l'].rotation.z = 0.5 + fl * 0.8;
      b.rig.nodes['cover_r'].rotation.z = -(0.5 + fl * 0.8);
      b.rig.nodes['leaf'].rotation.z = 0.6 - Math.sin(b.flap * 0.37) * 0.6;
      // a thread of light behind it
      if (Math.random() < dt * 6) {
        const wp = this.group.localToWorld(b.p.clone());
        this.particles.emit({ pos: wp, count: 1, spread: 0.04, life: [0.6, 1.0], size: [0.03, 0.01], sprite: 'dot2', color: 0xbfe0ff, additive: true, drag: 1 });
      }
    }
  }

  dispose() {
    this.proxy.geometry.dispose();
    this.door.dispose();
    this.mat.dispose();
    for (const b of this.books) b.rig.dispose();
    this.group.removeFromParent();
  }
}
