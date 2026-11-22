// The new-game set pieces (STORY-B): the Weeping Wall tomb and Serket's domain.
//   tombCliff      the towering mountain wall (0.5 m blocks): columnar fluting, strata ledges, desert-varnish
//                  streaks, wings that curve forward round the approach, a recess for the carved facade
//   tombPortal     the carved facade (1/8 m): a pylon with five nested door frames, each one turned a few
//                  degrees off the last (the "wrong" geometry), glyph columns, a fluted cornice and the
//                  sigil of the scorpion holding the sun; steps up to the threshold
//   tombDoorSlab   the stone slab that drops shut behind him
//   tombChamber    the hall inside (1/4 m): flagstones, ashlar walls, a scorpion frieze, papyrus columns,
//                  a starred ceiling, the dais and the great sigil on the back wall
//   torchSconce, pinchAltar, carvedBlock (the strange cubes and hovering shards), tombGround
//   domainFloor    her arena: a floating disc of slate with a riding bowl, jade inlay rings and her mark
//   standingStone  the megaliths round the ring; stingerPointer (the tutorial marker); soulShard (a bolt)
// All authored on their final grid; stone texture comes from the sandstone material and carved relief.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { noise, hash3 } from '../../../engine/math/rand';
import { sandstone } from '../materials';

export interface SetModel {
  model: VoxelModel;
  voxelSize: number;
}

const fbm = (x: number, y: number, s: number, o = 3) => {
  let a = 1, f = 1, t = 0, n = 0;
  for (let i = 0; i < o; i++) {
    t += a * noise.n2(x * f + s * 13.1 + i * 7, y * f - s * 5.3);
    n += a;
    a *= 0.5;
    f *= 2.07;
  }
  return t / n;
};
const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function mixC(a: number, b: number, t: number) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
const mulC = (c: number, k: number) => mixC(0, c, Math.min(1, k)) | 0;

// ------------------------------------------------------------------ carved glyphs (relief patterns, 5 x 7)
const GLYPHS = [
  // ankh
  ['.###.', '#...#', '#...#', '.###.', '#####', '..#..', '..#..'],
  // eye of the scribe
  ['.....', '.###.', '#.#.#', '.###.', '..#..', '.#.#.', '#...#'],
  // scorpion
  ['#...#', '.#.#.', '..#..', '.###.', '..#..', '..##.', '...#.'],
  // feather of Ma'at
  ['..#..', '.##..', '.##..', '.###.', '.##..', '.#...', '.#...'],
  // reed
  ['..#..', '.##..', '..#..', '..##.', '..#..', '..#..', '.###.'],
  // water
  ['.....', '#.#.#', '.#.#.', '.....', '#.#.#', '.#.#.', '.....'],
  // sun with rays
  ['#.#.#', '.###.', '##.##', '.###.', '#.#.#', '.....', '.....'],
  // ibis
  ['.##..', '#.#..', '..#..', '.###.', '#####', '.#.#.', '.#.#.'],
];
const glyphAt = (g: number, u: number, v: number) => GLYPHS[g % GLYPHS.length][6 - v]?.[u] === '#';

/** the scorpion holding the sun, as a relief height (0 = none) in a unit frame (u right, v up, radius ~1.2) */
export function sigilRelief(u: number, v: number): { h: number; inlay: boolean } {
  const r = Math.hypot(u, v);
  // the disc: a raised sun with a sunk ring and a boss
  if (r < 0.1) return { h: 4, inlay: false };
  if (r >= 0.3 && r < 0.35) return { h: 1, inlay: true };
  if (r < 0.42) return { h: 3, inlay: false };
  // the claws, curling up either side to meet over the disc
  const au = Math.abs(u);
  const th = Math.atan2(v, au); // 0 = out to the side, +pi/2 = top
  if (th > -1.25 && th < 1.42) {
    const k = (th + 1.25) / 2.67; // 0 at the arm root (below), 1 at the tip
    const R = 0.74 - k * 0.1;
    const w = 0.15 - k * 0.085;
    const d = Math.abs(r - R);
    // the tip forks into the two fingers of a pincer
    if (k > 0.78) {
      const fd = Math.abs(d - 0.05);
      if (fd < 0.032 + (1 - k) * 0.06) return { h: 2, inlay: false };
    } else if (d < w) return { h: d < w * 0.35 ? 3 : 2, inlay: false };
  }
  // the body below the disc, then the tail beads curling to one side and the stinger
  if (v < -0.4 && v > -0.95 && au < 0.22 - (-0.4 - v) * 0.2) return { h: 2, inlay: false };
  for (let i = 0; i < 6; i++) {
    const bv = -1.02 - i * 0.13 + i * i * 0.018;
    const bu = Math.sin(i * 0.45) * 0.32;
    const br = 0.085 - i * 0.006;
    if (Math.hypot(u - bu, v - bv) < br) return { h: 2, inlay: i === 5 };
  }
  const su = Math.sin(6 * 0.45) * 0.32 + 0.1, sv = -1.36;
  if (Math.hypot(u - su, v - sv) < 0.07 && u > su - 0.04) return { h: 2, inlay: true };
  return { h: 0, inlay: false };
}

// ------------------------------------------------------------------ the mountain wall
const CLIFF_TONES = [0x7a5236, 0xa06c44, 0xbd8a58, 0xcf9e68, 0xdfb27c];

/** the cliff face height-in-depth: z of the face (voxels) at (x, y) */
function cliffFace(x: number, y: number) {
  const ax = Math.abs(x) / 150;
  let f = ax * ax * 46;
  const cx = x + noise.n2(y * 0.02, 3.3) * 6;
  f += Math.abs(Math.sin(cx * 0.42)) * 1.6 + Math.abs(Math.sin(cx * 0.13 + 1.3)) * 2.8;
  const sy = (((y + noise.n2(x * 0.03, 1.7) * 3) % 13) + 13) % 13;
  f += sy < 2 ? 1.6 : sy < 3 ? 0.6 : 0;
  f += fbm(x * 0.035, y * 0.035, 2) * 5.5 + fbm(x * 0.12, y * 0.12, 5, 2) * 1.4;
  // the upper half leans out a little over the approach
  f += Math.max(0, y - 60) * 0.06;
  // the recess the facade is carved into (flat, worked stone)
  const rec = (1 - sm(30, 40, Math.abs(x))) * (1 - sm(40, 48, y));
  return f * (1 - rec) + -6 * rec;
}

export function tombCliff(): SetModel {
  const m = new VoxelModel('tomb_cliff');
  const stone = sandstone({ seed: 31, tones: CLIFF_TONES, bed: 9, oxide: 0.6, pits: 0.4 });
  for (let x = -124; x <= 124; x++) {
    const crest = 104 + 18 * noise.n2(x * 0.012, 8.1) + 7 * noise.n2(x * 0.05, 2.2) + 22 * Math.exp(-((x / 52) ** 2)) - (Math.abs(x) / 150) ** 2 * 26;
    for (let y = -4; y <= crest; y++) {
      // the passage into the mountain
      if (Math.abs(x) <= 7 && y >= 0 && y <= 20) continue;
      const f = Math.round(cliffFace(x, y));
      const top = y > crest - 3;
      const depth = top ? 6 : 3;
      for (let z = f - depth; z <= f; z++) {
        let c = stone(x, y, z) ?? CLIFF_TONES[2];
        // desert varnish: dark streaks running down from the crest
        const streak = hash3(x >> 1, 7, 3);
        if (streak > 0.82 && y > crest - 40 * streak) c = mixC(c, 0x4a2e1e, 0.45 * (1 - (crest - y) / 40));
        // the base is buried in drifted sand
        if (y < 3 + noise.n2(x * 0.08, 4) * 2) c = mixC(c, 0xe2b77c, 0.7);
        m.set(x, y, z, c);
      }
    }
  }
  return { model: m, voxelSize: 0.5 };
}

// ------------------------------------------------------------------ the carved facade
const WORKED = [0x8e6a48, 0xb8906a, 0xceaa7e, 0xdcba8c, 0xead0a2];
const JADE_INLAY = 0x3aa27a;

/** distance (voxels, rough) outside the tapered door opening, in a frame turned by `a` round the door's centre */
function doorDist(x: number, y: number, a: number) {
  const cy = 44;
  const c = Math.cos(a), s = Math.sin(a);
  const xr = c * x + s * (y - cy), yr = -s * x + c * (y - cy) + cy;
  const w = 15 - (yr - 12) * 0.06;
  return Math.max(Math.abs(xr) - w, yr - 76);
}

export function tombPortal(): SetModel {
  const m = new VoxelModel('tomb_portal');
  const stone = sandstone({ seed: 47, tones: WORKED, bed: 14, oxide: 0.15, pits: 0.15 });
  const HALF = (y: number) => 60 - y * 0.1;
  for (let y = 0; y <= 136; y++) {
    const corn = y >= 116;
    const flare = corn ? Math.min(6, (y - 116) * 0.5) : 0;
    const half = Math.round(HALF(y) + flare);
    for (let x = -half; x <= half; x++) {
      const inDoor = y >= 12 && doorDist(x, y, 0) < 0;
      if (inDoor) continue;
      // which nested frame (0 inner .. 4 outer) this point sits in, each turned a little more
      let front = 14;
      let frame = -1;
      if (y >= 12)
        for (let k = 0; k < 5; k++) {
          const d = doorDist(x, y, (k - 2) * 0.035);
          const o = 1 + k * 4;
          if (d >= o - 1 && d < o + 3) {
            frame = k;
            front = 6 + k * 3.5;
            break;
          }
        }
      // the hollow between the frames: the step back
      if (frame < 0 && y >= 12 && doorDist(x, y, 0) < 21) front = 8;
      if (corn) front = 14 + Math.min(8, (y - 116) * 0.6);
      // the torus roll under the cornice
      if (y >= 113 && y < 116) front = 16;
      // the fluted cornice
      if (corn && ((x + 300) % 4) === 0) front -= 1;
      const zf = Math.round(front);
      let back = Math.max(0, zf - 4);
      if (y < 12) back = 0;
      for (let z = back; z <= zf; z++) {
        let c = stone(x, y, z) ?? WORKED[2];
        if (frame >= 0) c = mixC(c, frame & 1 ? 0xd8b488 : 0xc29a6e, 0.35);
        let f: number = VF.SOLID;
        // glyph columns down the pylon (incised one voxel)
        if (z === zf && frame < 0 && !corn && y > 20 && y < 108) {
          const ax = Math.abs(x);
          for (const c0 of [24, 36]) {
            if (ax >= c0 && ax < c0 + 7) {
              const cell = Math.floor((y - 20) / 9), v = (y - 20) % 9 - 1, u = ax - c0 - 1;
              if (u >= 0 && u < 5 && v >= 0 && v < 7 && glyphAt(cell * 3 + (c0 >> 3) + (x < 0 ? 2 : 0), u, v)) {
                c = mulC(c, 0.62);
                if (hash3(x, y, 9) < 0.5) continue;
              }
              if (u === -1 || u === 5) c = mulC(c, 0.82);
            }
          }
        }
        // weathering at the foot, chips on the pylon's edges
        if (y < 18) c = mixC(c, 0x9a7650, (18 - y) / 40);
        if (Math.abs(x) >= half - 1 && hash3(x, y, z) < 0.3) continue;
        m.set(x, y, z, c, f);
      }
      // the sigil over the door: a scorpion holding the sun, raised off the face
      if (!corn && y > 78 && y < 114 && Math.abs(x) < 30) {
        const s = sigilRelief(x / 24, (y - 98) / 24);
        for (let h = 1; h <= s.h; h++) {
          const deep = h === s.h;
          m.set(x, y, 14 + h, s.inlay && deep ? JADE_INLAY : mixC(WORKED[3], 0xfff0cc, deep ? 0.25 : 0), s.inlay && deep ? VF.SOLID | VF.EMISSIVE : VF.SOLID);
        }
      }
    }
  }
  // the threshold slab and the steps up to it
  for (let i = 0; i < 4; i++) {
    const top = 12 - i * 3;
    const w = 22 + i * 2;
    for (let z = 22 + i * 9; z < 31 + i * 9; z++)
      for (let x = -w; x <= w; x++)
        for (let y = 0; y < top; y++) {
          let c = stone(x, y, z) ?? WORKED[2];
          if (y === top - 1) c = mixC(c, 0xe8cfa2, 0.3);
          if (y === top - 1 && Math.abs(x) >= w - 1 && hash3(x, z, i) < 0.4) continue;
          m.set(x, y, z, c);
        }
  }
  for (let z = 0; z < 22; z++) for (let x = -20; x <= 20; x++) for (let y = 0; y < 12; y++) m.set(x, y, z, stone(x, y, z) ?? WORKED[2]);
  return { model: m, voxelSize: 1 / 8 };
}

/** the slab that drops shut behind him (origin bottom centre, faces +Z into the hall... and -Z out) */
export function tombDoorSlab(): SetModel {
  const m = new VoxelModel('tomb_door');
  const stone = sandstone({ seed: 53, tones: [0x6e5038, 0x8e6c4c, 0xa27e5a, 0xb48e66, 0xc49e74], bed: 10, oxide: 0.1, pits: 0.2 });
  for (let y = 0; y < 66; y++)
    for (let x = -17; x <= 17; x++) {
      const border = Math.abs(x) > 14 || y < 3 || y > 62;
      const s = sigilRelief(x / 12, (y - 34) / 12);
      for (let z = 0; z <= 4 + (border ? 1 : 0); z++) m.set(x, y, z, stone(x, y, z) ?? 0x8e6c4c);
      for (let h = 1; h <= Math.min(2, s.h); h++) m.set(x, y, 4 + h, s.inlay ? JADE_INLAY : 0xb8966e, s.inlay ? VF.SOLID | VF.EMISSIVE : VF.SOLID);
      // bronze studs in two rows each side
      if ((Math.abs(x) === 11 || Math.abs(x) === 7) && y % 9 === 5 && y > 8 && y < 60 && Math.abs(y - 34) > 14) m.set(x, y, 6, 0x9a6a2a, VF.SOLID | VF.METAL);
      // the same face on the hall side
      if (s.h > 0 && !border) m.set(x, y, -1, 0x9a7a56);
    }
  return { model: m, voxelSize: 1 / 8 };
}

// ------------------------------------------------------------------ the hall inside the mountain
export const CHAMBER = { vs: 1 / 4, half: 22, height: 36, depth: 86, corridor: 10, corridorHalf: 8, corridorH: 32 };

export function tombChamber(): SetModel {
  const m = new VoxelModel('tomb_chamber');
  const C = CHAMBER;
  const wallStone = sandstone({ seed: 61, tones: [0x6a4a32, 0x8a6446, 0xa47a54, 0xb48a60, 0xc49a6c], bed: 4, oxide: 0.2, pits: 0.3 });
  const inHall = (x: number, z: number) => z <= -C.corridor - 1 && z >= -C.depth && Math.abs(x) <= C.half;
  const inCorr = (x: number, z: number) => z > -C.corridor - 1 && z <= 0 && Math.abs(x) <= C.corridorHalf;
  for (let z = -C.depth - 2; z <= 0; z++)
    for (let x = -C.half - 2; x <= C.half + 2; x++) {
      const hall = inHall(x, z), corr = inCorr(x, z);
      const H = hall ? C.height : corr ? C.corridorH : -1;
      // floor (two thick) under any open cell, flagstones on top
      if (hall || corr) {
        const tx = Math.floor((x + 300) / 6), tz = Math.floor((z + 300) / 6);
        const grout = (x + 300) % 6 === 0 || (z + 300) % 6 === 0;
        const tileT = hash3(tx, tz, 4);
        let c = grout ? 0x5a4630 : mixC(0x8e7052, 0xb8946c, tileT);
        if (!grout && hash3(x, z, 11) < 0.05) c = mulC(c, 0.85);
        m.set(x, -2, z, 0x6a5038);
        m.set(x, -1, z, c);
        // sand drifts: along the walls and blown in through the door
        const wallD = hall ? C.half - Math.abs(x) : C.corridorHalf - Math.abs(x);
        const drift = Math.max(0, 2.2 - wallD * 0.5) + Math.max(0, (z + 22) * 0.12) + noise.n2(x * 0.2, z * 0.2) * 0.8;
        for (let y = 0; y < Math.floor(drift); y++) m.set(x, y, z, y === Math.floor(drift) - 1 ? 0xe6c08a : 0xd4a870);
        // the ceiling
        for (let y = H + 1; y <= H + 2; y++) m.set(x, y, z, 0x5a4232);
        if (hall) {
          const sx = (x + 300) % 7, sz = (z + 300) % 7;
          const beam = (z + 300) % 14 === 0;
          let cc = beam ? 0x6a4e36 : 0x1e2c5a;
          // the starred vault: little carved five-point stars, gilded
          if (!beam && ((sx === 3 && sz >= 2 && sz <= 4) || (sz === 3 && sx >= 2 && sx <= 4))) cc = 0xe8c060;
          m.set(x, H, z, cc, cc === 0xe8c060 ? VF.SOLID | VF.METAL : VF.SOLID);
        } else m.set(x, H, z, 0x6a4e36);
        continue;
      }
      // walls: any cell next to an open one, ashlar courses up to the ceiling
      let near = false, hNear = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const ox = x + dx, oz = z + dz;
        if (inHall(ox, oz)) (near = true), (hNear = Math.max(hNear, C.height));
        else if (inCorr(ox, oz)) (near = true), (hNear = Math.max(hNear, C.corridorH));
      }
      if (!near) continue;
      const facing = inHall(x + 1, z) || inHall(x - 1, z) || inHall(x, z + 1) || inHall(x, z - 1) || inCorr(x + 1, z) || inCorr(x - 1, z) || inCorr(x, z - 1);
      for (let y = -2; y <= hNear + 2; y++) {
        const along = Math.abs(x) >= C.half ? z : x;
        const course = Math.floor((y + 40) / 4);
        const joint = (y + 40) % 4 === 0 || (along + 300 + (course & 1) * 4) % 8 === 0;
        let c = wallStone(x, y, z) ?? 0x9a7050;
        if (facing && joint) c = mulC(c, 0.72);
        if (y < 3) c = mulC(c, 0.85);
        // soot above the torches
        if (facing && Math.abs(x) >= C.half && [20, 38, 56, 72].some((tz) => Math.abs(-tz - z) < 2 + (y - 14) * 0.15 && y > 13 && y < 30)) c = mixC(c, 0x2a1e16, 0.5);
        m.set(x, y, z, c);
      }
    }
  // the frieze: a procession of carved scorpions and glyphs along both side walls (raised into the hall)
  for (const sx of [1, -1])
    for (let z = -C.depth + 4; z <= -C.corridor - 4; z++)
      for (let y = 17; y <= 25; y++) {
        const u = ((z + 300) % 9) - 2, v = y - 18;
        const band = y === 17 || y === 25;
        if (band) m.set(sx * (C.half - 0) , y, z, 0x7a5a3e);
        if (!band && u >= 0 && u < 5 && v >= 0 && v < 7 && glyphAt(((z + 300) / 9) | 0, u, v)) m.set(sx * C.half, y, z, 0xc8a274);
      }
  // papyrus-bundle columns
  for (const cx of [-13, 13])
    for (const cz of [-26, -44, -62]) {
      for (let y = 0; y <= C.height - 1; y++) {
        const cap = y >= 26 && y < 32;
        const abacus = y >= 32;
        for (let dx = -6; dx <= 6; dx++)
          for (let dz = -6; dz <= 6; dz++) {
            const th = Math.atan2(dz, dx), r = Math.hypot(dx, dz);
            let R = 2.5 + 0.55 * Math.abs(Math.cos(th * 4));
            if (y < 2) R = 3.6;
            if (cap) R = 2.9 + (y - 26) * 0.45 + 0.4 * Math.abs(Math.cos(th * 4));
            if (abacus) R = Math.max(Math.abs(dx), Math.abs(dz)) <= 4 ? 99 : 0;
            if (!abacus && r > R) continue;
            if (abacus && R === 0) continue;
            let c = mixC(0xa27a52, 0xd0aa7c, 0.5 + 0.5 * Math.cos(th * 4));
            if (y % 7 === 3 && !cap) c = 0x8a6440; // binding bands
            if (cap && (y & 1)) c = mixC(c, 0x3a8a6a, 0.35); // traces of old green paint
            m.set(cx + dx, y, cz + dz, c);
          }
      }
    }
  // the dais at the back and the great sigil on the back wall
  for (let z = -C.depth; z <= -C.depth + 12; z++)
    for (let x = -14; x <= 14; x++) {
      const step = z > -C.depth + 8 ? 2 : 4;
      for (let y = 0; y < step; y++) m.set(x, y, z, y === step - 1 ? 0xc49e74 : 0x9a7652);
    }
  for (let y = 6; y <= 34; y++)
    for (let x = -18; x <= 18; x++) {
      const s = sigilRelief(x / 11, (y - 22) / 11);
      for (let h = 1; h <= Math.min(2, s.h); h++) m.set(x, y, -C.depth + h - 1 + 1, s.inlay && h === s.h ? JADE_INLAY : 0xc8a274, s.inlay && h === s.h ? VF.SOLID | VF.EMISSIVE : VF.SOLID);
    }
  return { model: m, voxelSize: C.vs };
}

/** a bronze wall sconce with its fire bowl (origin at the wall, bowl out along +Z); flame at `flame` (m) */
export function torchSconce(): SetModel & { flame: [number, number, number] } {
  const m = new VoxelModel('tomb_sconce');
  const BR = [0x5a3a1a, 0x8a5a24, 0xb07a34, 0xd8a050];
  // the wall plate and the bracket arm curling out and up
  for (let y = -6; y <= 6; y++) for (let x = -2; x <= 2; x++) m.set(x, y, 0, BR[1 + ((x + y) & 1)], VF.SOLID | VF.METAL);
  for (let i = 0; i < 10; i++) {
    const z = 1 + i, y = -4 + Math.round(Math.pow(i / 9, 2) * 9);
    m.set(0, y, z, BR[2], VF.SOLID | VF.METAL).set(0, y + 1, z, BR[1], VF.SOLID | VF.METAL);
  }
  // the bowl: a lipped, fluted cup with a ring of embers
  for (let y = 5; y <= 9; y++)
    for (let x = -5; x <= 5; x++)
      for (let z = 6; z <= 16; z++) {
        const r = Math.hypot(x, z - 11), R = 2.4 + (y - 5) * 0.65;
        if (r > R || (y > 6 && r < R - 1.2)) continue;
        const flute = Math.abs(Math.cos(Math.atan2(z - 11, x) * 6)) > 0.7;
        m.set(x, y, z, y === 9 ? BR[3] : flute ? BR[2] : BR[1], VF.SOLID | VF.METAL);
      }
  for (let x = -3; x <= 3; x++) for (let z = 8; z <= 14; z++) if (Math.hypot(x, z - 11) < 3) m.set(x, 8, z, hash3(x, z, 2) < 0.5 ? 0xff7a2a : 0xffc050, VF.SOLID | VF.GLOW);
  return { model: m, voxelSize: 1 / 24, flame: [0, 10 / 24, 11 / 24] };
}

/** Pinch's pedestal: square base, fluted stem, a basin with little scorpions carved round it (1/16 m) */
export function pinchAltar(): SetModel & { top: number } {
  const m = new VoxelModel('pinch_altar');
  const st = sandstone({ seed: 71, tones: [0x7a5a3c, 0x9a7652, 0xb48e66, 0xc8a274, 0xdab888], bed: 5, oxide: 0, pits: 0.2 });
  for (let y = 0; y <= 18; y++) {
    const half = y < 3 ? 7 : y < 5 ? 6 : 0;
    const R = y >= 5 ? 3.2 + 0.4 * Math.sin(y * 0.6) : 0;
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const th = Math.atan2(z, x), r = Math.hypot(x, z);
        if (half ? Math.max(Math.abs(x), Math.abs(z)) > half : r > R + 0.5 * Math.abs(Math.cos(th * 5))) continue;
        m.set(x, y, z, st(x, y, z) ?? 0xb48e66);
      }
  }
  // the basin
  for (let y = 19; y <= 23; y++)
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const r = Math.hypot(x, z), R = 4 + (y - 19) * 0.9;
        if (r > R || (y > 20 && r < R - 1.5)) continue;
        let c = st(x, y, z) ?? 0xc8a274;
        // a ring of tiny carved scorpions round the rim band
        if (y === 21 && r > R - 1) {
          const a = ((Math.atan2(z, x) / (Math.PI * 2)) * 10 + 10) % 1;
          if (a < 0.35) c = mulC(c, 0.7);
        }
        m.set(x, y, z, c);
      }
  return { model: m, voxelSize: 1 / 16, top: 21 / 16 };
}

/** a strange carved block: a chamfered, eroded cube with concentric rings cut in its faces (1/8 m) */
export function carvedBlock(seed: number, size = 20): SetModel {
  const m = new VoxelModel('carved_block_' + seed);
  const st = sandstone({ seed: 80 + seed, tones: WORKED, bed: 7, oxide: 0.3, pits: 0.35 });
  const h = size / 2;
  for (let x = -h; x <= h; x++)
    for (let y = -h; y <= h; y++)
      for (let z = -h; z <= h; z++) {
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        const shell = Math.max(ax, ay, az);
        if (shell < h - 2) continue;
        // chamfered edges, eroded corners
        if (ax + ay > 2 * h - 3 || ay + az > 2 * h - 3 || ax + az > 2 * h - 3) continue;
        if (ax + ay + az > 3 * h - 6 - hash3(x, y, z + seed) * 3) continue;
        let c = st(x, y, z) ?? WORKED[2];
        // rings cut into each face
        const face = ax === h ? Math.hypot(y, z) : ay === h ? Math.hypot(x, z) : az === h ? Math.hypot(x, y) : -1;
        if (face >= 0 && (Math.floor(face) % 4 === 1)) {
          if (hash3(x, y, z) < 0.85) continue;
          c = mulC(c, 0.7);
        }
        m.set(x, y, z, c);
      }
  return { model: m, voxelSize: 1 / 8 };
}

/** the sand in front of the wall: a gentle heightfield (m), flat by the steps, dunes further out */
export function tombGroundH(x: number, z: number) {
  const flat = (1 - sm(10, 22, Math.abs(x))) * (1 - sm(14, 30, z));
  const dunes = 0.9 * noise.n2(x * 0.035, z * 0.035) + 0.45 * noise.n2(x * 0.09 + 3, z * 0.07) + Math.max(0, z - 40) * 0.06 + (Math.abs(x) > 30 ? (Math.abs(x) - 30) * 0.05 : 0);
  return dunes * (1 - flat) - 0.05;
}

export function tombGround(x0: number, x1: number, z0: number, z1: number, vs: number): SetModel {
  const m = new VoxelModel('tomb_ground');
  const S = [0xc08a52, 0xd29e62, 0xe2b276, 0xeec48a];
  for (let ix = Math.round(x0 / vs); ix <= Math.round(x1 / vs); ix++)
    for (let iz = Math.round(z0 / vs); iz <= Math.round(z1 / vs); iz++) {
      const x = ix * vs, z = iz * vs;
      const hy = Math.round(tombGroundH(x, z) / vs);
      // ripples running across the wind, darker in the troughs
      const rip = Math.sin(x * 2.1 + z * 0.9 + noise.n2(x * 0.1, z * 0.1) * 3);
      const t = 0.5 + 0.35 * noise.n2(x * 0.05, z * 0.05) + (rip > 0.6 ? 0.15 : rip < -0.7 ? -0.18 : 0);
      for (let y = hy - (vs > 0.6 ? 0 : 2); y <= hy; y++) m.set(ix, y, iz, S[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
    }
  return { model: m, voxelSize: vs };
}

// ------------------------------------------------------------------ Serket's domain
export const ARENA = { radius: 34, lipFrom: 18, lipTo: 31, lipH: 3.2, edge: 33.4 };

/** the arena floor height above its centre (m) at radius r: flat, then a riding bowl up to a rim */
export function arenaProfile(r: number) {
  if (r <= ARENA.lipFrom) return 0;
  if (r >= ARENA.lipTo) return ARENA.lipH;
  const k = (r - ARENA.lipFrom) / (ARENA.lipTo - ARENA.lipFrom);
  return ARENA.lipH * k * k;
}
/** its slope dh/dr */
export function arenaSlope(r: number) {
  if (r <= ARENA.lipFrom || r >= ARENA.lipTo) return 0;
  const k = (r - ARENA.lipFrom) / (ARENA.lipTo - ARENA.lipFrom);
  return (2 * ARENA.lipH * k) / (ARENA.lipTo - ARENA.lipFrom);
}

const SLATE = [0x2a3038, 0x363e48, 0x424a56, 0x4e5866, 0x5c6878];

export function domainFloor(): SetModel {
  const m = new VoxelModel('domain_floor');
  const vs = 0.5;
  const R = ARENA.radius / vs;
  for (let ix = -R - 2; ix <= R + 2; ix++)
    for (let iz = -R - 2; iz <= R + 2; iz++) {
      const x = ix * vs, z = iz * vs;
      const r = Math.hypot(x, z);
      const edgeR = ARENA.radius + noise.n2(Math.atan2(z, x) * 3, 1.1) * 0.9;
      if (r > edgeR) continue;
      const top = Math.round(arenaProfile(r) / vs);
      // concentric courses of slate flags, each ring cut into blocks
      const ring = Math.floor(r / 2.2);
      const seg = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * (8 + ring * 5));
      const joint = r % 2.2 < 0.5 || ((((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * (8 + ring * 5)) % 1) < 0.5 / Math.max(1, r * 0.9);
      let c = SLATE[1 + Math.floor(hash3(ring, seg, 3) * 3)];
      if (joint) c = SLATE[0];
      if (hash3(ix, iz, 5) < 0.04) c = mixC(c, 0x7a8a8a, 0.3);
      let f: number = VF.SOLID;
      // jade inlay: rings, twelve spokes, and her mark at the heart of the floor
      const spoke = (((Math.atan2(z, x) / (Math.PI * 2)) * 12) % 1 + 1) % 1;
      const inlayRing = [8.5, 15.5].some((rr) => Math.abs(r - rr) < 0.3);
      const inlaySpoke = r > 9 && r < 15 && (spoke < 0.018 || spoke > 0.982);
      const s = r < 7.6 ? sigilRelief(x / 5.4, -z / 5.4) : { h: 0, inlay: false };
      if (inlayRing || inlaySpoke || (s.h >= 2 && s.h <= 3)) {
        c = r < 7.6 && s.h === 3 ? 0x7ad8a8 : 0x2e9a70;
        f = VF.SOLID | VF.EMISSIVE;
      }
      for (let y = top - 2; y <= top; y++) m.set(ix, y, iz, y === top ? c : SLATE[0], y === top ? f : VF.SOLID);
      // the broken underside of a floating island, hanging below the rim
      if (r > ARENA.radius - 6) {
        const hang = Math.round((2 + Math.max(0, noise.n2(x * 0.15, z * 0.15)) * 8 + (r - ARENA.radius + 6) * 0.6) / vs);
        for (let y = top - 3; y > top - 3 - hang; y--) m.set(ix, y, iz, hash3(ix, y, iz) < 0.5 ? 0x3a3430 : 0x4a4038);
      }
    }
  return { model: m, voxelSize: vs };
}

/** one megalith of the ring (1/4 m): tapered, leaning, eroded, her scorpion glyph cut glowing into the inner face (-Z) */
export function standingStone(seed: number): SetModel & { height: number } {
  const m = new VoxelModel('domain_stone_' + seed);
  const H = 26 + Math.floor(hash3(seed, 1, 1) * 12);
  const W = 4 + Math.floor(hash3(seed, 2, 1) * 2), D = 2 + Math.floor(hash3(seed, 3, 1) * 2);
  const lean = (hash3(seed, 4, 1) - 0.5) * 0.12;
  for (let y = -3; y <= H; y++) {
    const k = y / H;
    const w = W * (1 - k * 0.35) - (y > H - 3 ? (y - H + 3) * 1.2 : 0);
    const d = D * (1 - k * 0.25);
    const ox = Math.round(y * lean);
    for (let x = -Math.ceil(w); x <= Math.ceil(w); x++)
      for (let z = -Math.ceil(d); z <= Math.ceil(d); z++) {
        const ex = Math.abs(x) / Math.max(0.5, w), ez = Math.abs(z) / Math.max(0.5, d);
        if (ex + ez * 0.5 > 1.25 + noise.n2(y * 0.2 + seed, x * 0.3) * 0.18) continue;
        let c = SLATE[1 + Math.floor((noise.n2(x * 0.3 + seed, y * 0.15) * 0.5 + 0.5) * 3.5)];
        if (hash3(x, y, z + seed) < 0.06) c = 0x6a7a72; // lichen
        let f: number = VF.SOLID;
        // her glyph on the face toward the ring's heart
        if (z === -Math.ceil(d) && y > H * 0.45 && y < H * 0.45 + 7 && Math.abs(x) <= 2 && glyphAt(2, x + 2, y - Math.round(H * 0.45))) {
          c = 0x48c896;
          f = VF.SOLID | VF.EMISSIVE;
        }
        m.set(x + ox, y, z, c, f);
      }
  }
  return { model: m, voxelSize: 1 / 4, height: H / 4 };
}

/** the tutorial's marker: a jade scorpion stinger (telson bulb, hooked barb, two tail rings), tip along +Z (1/160 m) */
export function stingerPointer(): SetModel {
  const m = new VoxelModel('stinger_pointer');
  for (let z = -30; z <= 18; z++)
    for (let x = -9; x <= 9; x++)
      for (let y = -9; y <= 12; y++) {
        let R = 0, cy = 0;
        if (z < -20) R = 5.2 - Math.abs(z + 25) * 0.25; // tail ring
        else if (z < -16) R = 4.4;
        else if (z < 4) {
          R = 7.4 * Math.sin(((z + 16) / 20) * Math.PI) + 1.2; // the bulb
          cy = 0;
        } else {
          const k = (z - 4) / 14; // the hooked barb, curving down to the point
          R = 3.2 * (1 - k) + 0.4;
          cy = -k * k * 6;
        }
        if (R <= 0 || Math.hypot(x, (y - cy) * 1.05) > R) continue;
        const core = Math.hypot(x, y - cy) < R - 2.2 && z > -14 && z < 2;
        const lit = y - cy > R * 0.45;
        m.set(x, y, z, core ? 0xbaffdc : lit ? 0x6ae8b0 : z < -16 ? 0x1e7a58 : 0x2eb282, core ? VF.SOLID | VF.GLOW : VF.SOLID | VF.EMISSIVE);
      }
  return { model: m, voxelSize: 1 / 160 };
}

/** a soul bolt: a jagged spectral shard (1/48 m), long axis +Z */
export function soulShard(): SetModel {
  const m = new VoxelModel('soul_shard');
  for (let z = -7; z <= 9; z++)
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++) {
        const k = z < 0 ? 1 + z / 8 : 1 - z / 10;
        const R = 2.8 * k + hash3(x, y, z) * 0.6;
        if (Math.abs(x) + Math.abs(y) > R) continue;
        const core = Math.abs(x) + Math.abs(y) < R - 1.5;
        m.set(x, y, z, core ? 0xeafff6 : 0x7af0c8, core ? VF.SOLID | VF.GLOW : VF.SOLID | VF.EMISSIVE);
      }
  return { model: m, voxelSize: 1 / 48 };
}
