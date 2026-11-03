// The hideout — a small ruined frontier outpost (STYLE v2, see CONTRACT.md).
// Half-collapsed adobe and plank walls, a torn tarp lean-to, junk and supplies
// everywhere. Structure pieces 1/16 m, props 1/20 m, small scatter 1/32 m.
// Fronts face +Z. All built from clean shapes + deliberate wear (no noise).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, board, post, seg, cylY, inCircle, chunk, sandDrift, rope, sagPoints, stampText, textWidth, mod, mixRGB } from './helpers';
import { cowSkullModel } from './nature';
import { hash3 } from '../../../engine/math/rand';
import type { RigSpec } from '../../../engine/voxel/Rig';

const SVS = 1 / 16; // structures
const VS = 1 / 20; // props
const TVS = 1 / 32; // small scatter

// ---------------------------------------------------------------------------
// small shared bits
// ---------------------------------------------------------------------------
/** bullet hole on a face: dark core with a splintered/lighter rim (z+ face at z) */
function bulletHole(m: VoxelModel, x: number, y: number, z: number, rim: number) {
  m.set(x, y, z, PR.socket.dark);
  m.set(x + 1, y, z, rim).set(x, y + 1, z, rim);
}

/** a plain crate body (corner posts + panels + optional cross brace) */
function crateBox(m: VoxelModel, x0: number, y0: number, z0: number, s: number, r: Ramp, frame: Ramp, brace: boolean) {
  const x1 = x0 + s - 1, y1 = y0 + s - 1, z1 = z0 + s - 1;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const ex = x === x0 || x === x1, ey = y === y0 || y === y1, ez = z === z0 || z === z1;
        if (!ex && !ey && !ez) continue;
        const edges = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
        let c = mod(y - y0, 5) === 0 ? r.shade : r.base;
        if (edges >= 2) c = frame.base;
        if (ey && y === y1 && edges < 2) c = mod(x - x0, 5) === 0 ? r.dark : r.hi;
        m.set(x, y, z, c);
      }
  if (brace)
    for (let k = 1; k < s - 1; k++) {
      m.set(x0 + k, y0 + k, z1 + 1, frame.shade);
      m.set(x1 + 1, y0 + k, z0 + k, frame.shade);
    }
  for (const [x, y] of [[x0 + 1, y0 + 1], [x1 - 1, y0 + 1], [x0 + 1, y1 - 1], [x1 - 1, y1 - 1]]) m.set(x, y, z1 + 1, PR.iron.dark, VF.METAL);
}

function lanternBody(m: VoxelModel, cx: number, y0: number, cz: number, lit = true) {
  m.box(cx - 2, y0, cz - 2, cx + 2, y0, cz + 2, PR.iron.dark, VF.METAL);
  for (let y = y0 + 1; y <= y0 + 5; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        const corner = Math.abs(x) === 2 && Math.abs(z) === 2;
        const side = Math.abs(x) === 2 || Math.abs(z) === 2;
        if (corner) m.set(cx + x, y, cz + z, PR.iron.base, VF.METAL);
        else if (side) m.set(cx + x, y, cz + z, lit ? 0xffd27a : PR.glassClear.shade, lit ? VF.EMISSIVE : VF.METAL);
      }
  if (lit) m.set(cx, y0 + 2, cz, 0xffe9a8, VF.GLOW);
  m.box(cx - 2, y0 + 6, cz - 2, cx + 2, y0 + 6, cz + 2, PR.iron.dark, VF.METAL);
  m.box(cx - 1, y0 + 7, cz - 1, cx + 1, y0 + 7, cz + 1, PR.iron.base, VF.METAL);
  m.set(cx, y0 + 8, cz, PR.iron.dark, VF.METAL);
}

// ---------------------------------------------------------------------------
// STRUCTURES (1/16 m)
// ---------------------------------------------------------------------------
/** crumbling adobe wall segment, ~4 m long: jagged stepped top, a window hole, exposed mud bricks,
 *  cracks, protruding roof vigas, sand drifts at the base. Front face at z = +T/2. */
export function ruinWallAdobe(seed = 0): StaticModel {
  const r = rngOf(seed, 401);
  const m = new VoxelModel('ruin_wall_adobe');
  const L = 64, H = 42, T = 6;
  const z0 = -T / 2, z1 = T / 2 - 1;
  // top profile: plateaus that step down (deliberate, never noisy)
  const prof: number[] = [];
  let h = H - r.int(0, 4);
  for (let u = 0; u < L; ) {
    const run = r.int(4, 10);
    const drop = r.chance(0.35) ? r.int(6, 16) : r.int(0, 4);
    const target = Math.max(14, Math.min(H, (r.chance(0.5) ? h - drop : h + r.int(0, 6))));
    for (let k = 0; k < run && u < L; k++, u++) prof.push(target);
    h = target;
  }
  // big breach on one side
  const breachSide = r.chance(0.5);
  for (let u = 0; u < L; u++) {
    const edge = breachSide ? L - 1 - u : u;
    if (edge < 12) prof[u] = Math.min(prof[u], 6 + edge * 2 + (edge % 3));
  }
  const plaster = PR.adobe, brick = PR.terracotta;
  // fallen-plaster patches (show bricks)
  const patches: [number, number, number, number][] = [];
  for (let i = 0; i < 4; i++) patches.push([r.int(4, L - 16), r.int(6, H - 18), r.int(6, 14), r.int(4, 9)]);
  const inPatch = (u: number, y: number) => patches.some(([pu, py, pw, ph]) => u >= pu && u < pu + pw && y >= py && y < py + ph);
  for (let u = 0; u < L; u++) {
    const top = prof[u];
    for (let y = 0; y < top; y++)
      for (let z = z0; z <= z1; z++) {
        const outer = z === z1 || z === z0;
        let c = plaster.base;
        if (y < 4) c = plaster.shade; // splash/dirt band at the foot
        if (outer && inPatch(u, y)) {
          const row = Math.floor(y / 3), off = row % 2 ? 3 : 0;
          c = mod(y, 3) === 0 || mod(u + off, 6) === 0 ? brick.dark : (row + Math.floor((u + off) / 6)) % 3 === 0 ? brick.shade : brick.base;
        } else if (outer && y === top - 1) c = plaster.hi;
        m.set(u - L / 2, y, z, c);
      }
  }
  // window hole with a sagging wooden lintel
  const wu = r.int(16, L - 26), wy = 14, ww = 10, wh = 12;
  for (let u = wu; u < wu + ww; u++) for (let y = wy; y < wy + wh; y++) for (let z = z0; z <= z1; z++) m.del(u - L / 2, y, z);
  // crumbled corners of the opening
  m.del(wu - L / 2 - 1, wy + wh - 1, z1).del(wu + ww - L / 2, wy, z1).del(wu + ww - L / 2, wy + 1, z0);
  for (let u = wu - 2; u < wu + ww + 2; u++) for (let z = z0 - 1; z <= z1 + 1; z++) if (prof[u] > wy + wh + 2) m.set(u - L / 2, wy + wh, z, u === wu + ww + 1 ? PR.woodDark.dark : PR.woodDark.base);
  // a couple of cracks running down from the top
  for (let i = 0; i < 3; i++) {
    let u = r.int(6, L - 6), y = prof[u] - 1;
    for (let k = 0; k < 12 && y > 4; k++) {
      m.set(u - L / 2, y, z1, plaster.dark);
      y--;
      if (k % 3 === 2) u += r.chance(0.5) ? 1 : -1;
    }
  }
  // vigas: round roof beams poking out near the top
  for (let u = 6; u < L - 4; u += 12) {
    if (prof[u] < H - 6) continue;
    for (let z = z1 + 1; z <= z1 + 4; z++) for (const [du, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.set(u + du - L / 2, H - 7 + dy, z, z === z1 + 4 ? PR.woodDark.hi : PR.woodDark.base);
  }
  // bullet holes
  for (let i = 0; i < 5; i++) {
    const u = r.int(4, L - 4), y = r.int(8, 30);
    if (y < prof[u] - 2) bulletHole(m, u - L / 2, y, z1, plaster.hi);
  }
  // fallen chunks + sand drifts at the base, both sides
  for (let i = 0; i < 6; i++) {
    const u = r.int(-L / 2 + 2, L / 2 - 4), zz = r.chance(0.6) ? z1 + r.int(2, 7) : z0 - r.int(2, 6);
    chunk(m, u, 0, zz, u + r.int(2, 4), r.int(1, 3), zz + r.int(2, 3), plaster, 1);
  }
  sandDrift(m, r.int(-20, 0), z1 + 4, 14, 6, 5, 0, seed, 1);
  sandDrift(m, r.int(0, 20), z0 - 4, 12, 5, 4, 0, seed + 1, -1);
  return S(m, SVS);
}

/** L-shaped corner of a plank shack: two walls, missing boards, a hanging board,
 *  broken window, bullet holes, corner posts and a few roof beams, one collapsed. */
export function ruinShackCorner(seed = 0): StaticModel {
  const r = rngOf(seed, 509);
  const m = new VoxelModel('ruin_shack_corner');
  const LX = 56, LZ = 44, H = 44;
  const wood = PR.woodGrey, dark = PR.woodDark;
  // back wall along x (z = 0..1), side wall along z (x = 0..1), corner at origin
  const missingX = new Set([r.int(4, 9), r.int(10, 14)]);
  const missingZ = new Set([r.int(3, 8)]);
  for (let x = 0; x < LX; x++) {
    const bi = Math.floor(x / 4);
    if (missingX.has(bi) && x > 8) continue;
    const top = H - Math.max(0, x - LX + 18) * 1 - (bi % 3 === 0 ? 2 : 0);
    for (let y = 0; y < top; y++) {
      const seam = mod(x, 4) === 0;
      const c = seam ? wood.dark : bi % 2 ? wood.base : mixRGB(wood.base, wood.shade, 0.35);
      m.set(x, y, 0, c).set(x, y, 1, wood.shade);
    }
  }
  for (let z = 0; z < LZ; z++) {
    const bi = Math.floor(z / 4);
    if (missingZ.has(bi) && z > 6) continue;
    const top = H - Math.max(0, z - LZ + 20);
    for (let y = 0; y < top; y++) {
      const seam = mod(z, 4) === 0;
      m.set(0, y, z, seam ? wood.dark : bi % 2 ? wood.base : mixRGB(wood.base, wood.shade, 0.35)).set(1, y, z, wood.shade);
    }
  }
  // rails (horizontal stringers) + nails
  for (const y of [6, H - 8]) {
    for (let x = 0; x < LX - 10; x++) m.set(x, y, 2, dark.base);
    for (let z = 2; z < LZ - 10; z++) m.set(2, y, z, dark.base);
  }
  for (let x = 3; x < LX - 10; x += 4) m.set(x, 6, 3, PR.iron.dark, VF.METAL);
  // window in the back wall: broken glass + one shutter hanging
  const wx = 24, wy = 18;
  for (let x = wx; x < wx + 10; x++) for (let y = wy; y < wy + 10; y++) m.del(x, y, 0).del(x, y, 1);
  for (let x = wx - 1; x <= wx + 10; x++) m.set(x, wy - 1, 2, PR.paintWhite.shade).set(x, wy + 10, 2, PR.paintWhite.base);
  for (let y = wy; y < wy + 10; y++) m.set(wx - 1, y, 2, PR.paintWhite.base).set(wx + 10, y, 2, PR.paintWhite.base);
  for (const [x, y] of [[wx, wy], [wx + 1, wy], [wx, wy + 1], [wx + 9, wy + 9], [wx + 8, wy + 9]]) m.set(x, y, 1, PR.glassClear.base, VF.METAL);
  for (let k = 0; k < 9; k++) for (let y = 0; y < 3; y++) m.set(wx + 11 + k, wy + 6 - Math.floor(k * 0.6) + y, 3, k === 0 ? PR.paintGreen.shade : PR.paintGreen.base);
  // a loose board hanging diagonally across a gap
  seg(m, [10, 30, 3], [18, 12, 3], 2, wood.hi);
  m.set(10, 30, 4, PR.iron.dark, VF.METAL);
  // corner + end posts
  post(m, -2, -2, 0, H + 2, 4, dark, seed);
  post(m, LX - 12, -2, 0, H - 8, 4, dark, seed + 1);
  post(m, -2, LZ - 12, 0, H - 10, 4, dark, seed + 2);
  // roof beams: two intact spanning z, one snapped & fallen to the ground
  for (const x of [12, 30]) board(m, x, H + 2, -2, x + 3, H + 4, LZ - 14, dark, 'z', seed + x, { dashes: 2 });
  seg(m, [44, H - 2, 0], [54, 2, 26], 3, dark.base);
  board(m, 50, 0, 22, 60, 2, 26, dark, 'x', seed + 7);
  // ridge plank on top of the beams + a couple of dangling tin sheets
  for (let z = -2; z < LZ - 16; z++) for (let x = 12; x <= 33; x++) if (mod(z, 7) < 4 && (x + z) % 9 !== 0) m.set(x, H + 5, z, mod(x, 2) ? PR.tin.base : PR.tin.shade, VF.METAL);
  for (let k = 0; k < 10; k++) for (let x = 0; x < 6; x++) m.set(34 + x, H + 4 - k, -1 + Math.floor(k / 3), mod(x, 2) ? PR.rust.base : PR.rust.shade, VF.METAL);
  // bullet holes
  for (let i = 0; i < 8; i++) {
    if (i % 2) bulletHole(m, r.int(4, LX - 14), r.int(8, 36), 2, wood.hi);
    else m.set(2, r.int(8, 36), r.int(4, LZ - 14), PR.socket.dark);
  }
  // debris + sand along the foot
  sandDrift(m, 20, 8, 16, 5, 4, 0, seed);
  sandDrift(m, 8, 24, 5, 12, 4, 0, seed + 3);
  for (let i = 0; i < 5; i++) {
    const x = r.int(6, 40), z = r.int(5, 16);
    board(m, x, 0, z, x + r.int(6, 12), 1, z + 1, i % 2 ? wood : dark, 'x', seed + i * 3);
  }
  return S(m, SVS);
}

/** torn striped canvas lean-to on four posts with rope guy lines (≈3.2 × 2.4 m) */
export function tarpLeanTo(seed = 0): StaticModel {
  const r = rngOf(seed, 613);
  const m = new VoxelModel('tarp_lean_to');
  const W = 64, D = 46, Hb = 54, Hf = 42;
  const pw = 3;
  for (const [x, z, h] of [[-W / 2, -D / 2, Hb], [W / 2 - pw, -D / 2, Hb], [-W / 2, D / 2 - pw, Hf], [W / 2 - pw, D / 2 - pw, Hf]] as const) post(m, x, z, 0, h, pw, PR.woodDark, seed + x);
  // cross beams
  board(m, -W / 2 - 2, Hb, -D / 2, W / 2 + 1, Hb + 2, -D / 2 + 2, PR.woodDark, 'x', seed);
  board(m, -W / 2 - 2, Hf, D / 2 - 3, W / 2 + 1, Hf + 2, D / 2 - 1, PR.woodDark, 'x', seed + 1);
  // sloping canvas with stripes, a torn hole and a ragged front edge
  const holes: [number, number, number][] = [[r.int(-20, 10), r.int(-10, 8), 5], [r.int(12, 22), r.int(-4, 10), 3]];
  for (let x = -W / 2 - 2; x <= W / 2 + 2; x++)
    for (let z = -D / 2 - 1; z <= D / 2 + 3; z++) {
      const t = (z + D / 2 + 1) / (D + 4);
      const sag = Math.sin(((x + W / 2 + 2) / (W + 4)) * Math.PI) * 2.2;
      const y = Math.round(Hb + 3 - t * (Hb - Hf) - sag);
      if (holes.some(([hx, hz, hr]) => (x - hx) ** 2 + (z - hz) ** 2 < hr * hr)) continue;
      if (z > D / 2 && mod(x * 7 + seed, 5) < 2) continue; // ragged edge
      const stripe = mod(x + W, 12) < 6;
      const c = stripe ? PR.canvasStripe.base : PR.canvas.base;
      m.set(x, y, z, z === D / 2 + 3 || z > D / 2 ? (stripe ? PR.canvasStripe.shade : PR.canvas.shade) : c, VF.SOFTAO);
    }
  // frayed flaps hanging off the front edge
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + 6 + i * 15 + r.int(-2, 2);
    for (let k = 0; k < r.int(4, 9); k++) for (let w = 0; w < 3; w++) m.set(x + w, Hf - k, D / 2 + 3, mod(x + w + W, 12) < 6 ? PR.canvasStripe.shade : PR.canvas.shade, VF.SOFTAO);
  }
  // guy lines to stakes
  for (const sx of [-1, 1]) {
    const top: V3 = [sx * (W / 2 + 2), Hb + 2, -D / 2];
    const stake: V3 = [sx * (W / 2 + 16), 0, -D / 2 - 10];
    rope(m, sagPoints(top, stake, 2, 10));
    m.box(stake[0], 0, stake[2], stake[0] + 1, 3, stake[2] + 1, PR.woodDark.base);
  }
  return S(m, VS);
}

/** pile of adobe chunks, mud bricks and broken boards with sand */
export function rubblePile(seed = 0): StaticModel {
  const r = rngOf(seed, 727);
  const m = new VoxelModel('rubble');
  sandDrift(m, 0, 0, 18, 12, 4, 0, seed);
  for (let i = 0; i < 9; i++) {
    const x = r.int(-14, 10), z = r.int(-8, 6), y = r.int(0, 4);
    chunk(m, x, y, z, x + r.int(3, 7), y + r.int(2, 5), z + r.int(3, 6), i % 3 === 0 ? PR.terracotta : PR.adobe, 1, true);
  }
  for (let i = 0; i < 3; i++) {
    const x = r.int(-12, 4), z = r.int(-6, 4);
    seg(m, [x, r.int(3, 7), z], [x + r.int(10, 16), r.int(0, 2), z + r.int(-4, 4)], 2, i % 2 ? PR.woodGrey.base : PR.woodDark.base);
  }
  return S(m, SVS);
}

/** the courtyard: packed earth, worn stone pavers, wheel ruts, sand drifts rising to dunes at the edge.
 *  ~26 × 22 m at 1/8 m. Origin = centre, top surface ≈ y 0. */
export function outpostGround(seed = 0): StaticModel {
  const r = rngOf(seed, 829);
  const m = new VoxelModel('outpost_ground');
  const GX = 104, GZ = 88; // half extents in voxels (13 × 11 m)
  const pavers: [number, number, number, number][] = [];
  for (let i = 0; i < 34; i++) pavers.push([r.int(-48, 40), r.int(-36, 36), r.int(3, 6), r.int(3, 5)]);
  for (let x = -GX; x <= GX; x++)
    for (let z = -GZ; z <= GZ; z++) {
      // flat courtyard, dunes rising past the ruins (smooth, stepped)
      const ex = Math.max(0, Math.abs(x) - 64) / 40, ez = Math.max(0, z < 0 ? -z - 46 : z - 62) / 26;
      const e = Math.min(1, Math.hypot(ex, ez));
      const dune = Math.round(e * e * 14 + Math.sin(x * 0.07 + z * 0.05) * 2 * e);
      const top = 2 + dune;
      for (let y = 0; y <= top; y++) {
        let c: number = y < top ? PR.sand.shade : e > 0.05 ? PR.sand.base : PR.wood.hi;
        if (y === top && e <= 0.05) {
          // packed dirt with a few deliberate tones
          const band = mod(Math.floor(x / 9) + Math.floor(z / 7), 5);
          c = band === 0 ? mixRGB(PR.sand.shade, PR.wood.hi, 0.5) : band === 3 ? PR.sand.shade : mixRGB(PR.sand.base, PR.wood.hi, 0.55);
          // wheel ruts towards the gate
          if ((Math.abs(x - z * 0.4 - 30) < 1.2 || Math.abs(x - z * 0.4 - 22) < 1.2) && z > 10) c = PR.wood.base;
          for (const [px, pz, pw, pd] of pavers) {
            if (x >= px && x < px + pw && z >= pz && z < pz + pd) c = x === px || z === pz ? PR.stone.shade : PR.stone.base;
          }
        }
        if (y > 0 || top > 2) m.set(x, y - 2, z, c);
      }
    }
  return S(m, 1 / 8);
}

// ---------------------------------------------------------------------------
// PROPS (1/20 m)
// ---------------------------------------------------------------------------
/** slumped burlap sack, tied at the top, stencilled, a little grain spilling — 1/24 */
export function sack(seed = 0): StaticModel {
  const r = rngOf(seed, 931);
  const m = new VoxelModel('sack');
  const tone = r.chance(0.5) ? PR.canvas : PR.hay;
  const lean = r.int(-3, 3);
  const H = 19;
  for (let y = 0; y <= H; y++) {
    const t = y / H;
    const rx0 = 8 - t * 2.8 + Math.sin(t * Math.PI) * 1.4, rz0 = 6 - t * 2 + Math.sin(t * Math.PI) * 1;
    const ox = Math.round(lean * t);
    for (let x = -10; x <= 10; x++)
      for (let z = -8; z <= 8; z++) {
        if ((x * x) / (rx0 * rx0) + (z * z) / (rz0 * rz0) > 1) continue;
        // burlap weave: faint checker of two close tones, seams and slump folds
        let c = (x + y) % 2 === 0 ? tone.base : mixRGB(tone.base, tone.shade, 0.3);
        if (y === 0 || mod(y + Math.abs(x), 7) === 0) c = tone.shade;
        if (x === 0 && z > 0) c = tone.shade; // centre seam
        m.set(x + ox, y, z, wear(c, x, y, z, 0.04), VF.SOFTAO);
      }
  }
  for (let y = H + 1; y <= H + 3; y++) for (let x = -3; x <= 3; x++) for (let z = -2; z <= 2; z++) if (inCircle(x, z, 2.6)) m.set(x + lean, y, z, y === H + 1 ? PR.rope.base : tone.hi, VF.SOFTAO);
  for (let x = -3; x <= 3; x += 2) m.set(x + lean, H + 4, 0, tone.hi);
  rope(m, [[2 + lean, H + 1, 3], [5 + lean, H - 3, 5], [4 + lean, H - 7, 6]]);
  const word = ['OATS', 'FLOUR', 'SALT', 'BEANS'][mod(seed, 4)];
  const tw = textWidth(word);
  stampText(m, 'z+', word, -Math.floor(tw / 2), 12, 8, { color: PR.ink.shade });
  // spilled grain
  for (let i = 0; i < 14; i++) m.set(r.int(-12, 12), 0, 7 + r.int(0, 5), tone.hi);
  return S(m, FVS);
}

/** stack of crates (2–4), one askew, one open with straw — 1/24 */
export function crateStack(seed = 0): StaticModel {
  const r = rngOf(seed, 1033);
  const m = new VoxelModel('crate_stack');
  const n = 2 + mod(seed, 3);
  crateBox(m, -17, 0, -8, 17, PR.wood, PR.woodDark, true);
  crateBox(m, 1, 0, -10, 18, PR.woodLight, PR.woodDark, false);
  if (n >= 3) crateBox(m, -11 + r.int(-1, 1), 17, -7, 14, PR.woodLight, PR.woodDark, r.chance(0.5));
  if (n >= 4) {
    crateBox(m, 5, 18, -6, 12, PR.wood, PR.woodDark, false);
    for (let x = 6; x < 16; x++) for (let z = -5; z < 5; z++) m.set(x, 29, z, mod(x + z, 3) ? PR.hay.base : PR.hay.hi);
    board(m, 17, 19, -6, 18, 32, 5, PR.wood, 'y', seed);
  }
  stampText(m, 'z+', 'XX', 5, 11, 9, { color: PR.ink.shade });
  stampText(m, 'z+', 'DRY', -14, 13, 10, { color: PR.ink.shade });
  return S(m, FVS);
}

/** junk pile: busted wheel, planks, bucket, horseshoes, tin cans, chain */
export function junkPile(seed = 0): StaticModel {
  const r = rngOf(seed, 1129);
  const m = new VoxelModel('junk_pile');
  sandDrift(m, 0, 0, 16, 11, 3, 0, seed);
  // a wagon wheel lying tilted against the pile
  const R = 11;
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    if (a % 16 > 13) continue; // broken rim segment
    const x = Math.round(Math.cos(t) * R), y = Math.round(Math.sin(t) * R * 0.9) + R;
    m.set(x - 4, y, 6 + Math.round(y * 0.25), PR.iron.base, VF.METAL).set(x - 4, y, 7 + Math.round(y * 0.25), PR.woodDark.base);
  }
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    seg(m, [-4, R, 7 + Math.round(R * 0.25)], [-4 + Math.round(Math.cos(t) * (R - 1)), R + Math.round(Math.sin(t) * (R - 1) * 0.9), 7 + Math.round((R + Math.sin(t) * R) * 0.25)], 1, PR.woodDark.shade);
  }
  for (let i = 0; i < 4; i++) {
    const x = r.int(-14, 6), z = r.int(-8, 2);
    board(m, x, r.int(0, 3), z, x + r.int(8, 14), r.int(1, 4), z + 2, i % 2 ? PR.woodGrey : PR.wood, 'x', seed + i);
  }
  // bucket on its side, tin cans, horseshoes
  for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) if (inCircle(y, z, 3)) for (let x = 6; x <= 11; x++) if (x === 6 || !inCircle(y, z, 2)) m.set(x, y + 3, z - 4, x === 6 || x === 11 ? PR.iron.base : PR.wood.base, x === 11 ? VF.METAL : 0);
  for (let i = 0; i < 4; i++) {
    const x = r.int(-12, 10), z = r.int(2, 9);
    m.box(x, 0, z, x + 1, 2, z + 1, i % 2 ? PR.tin.base : PR.rust.base, VF.METAL);
  }
  for (let i = 0; i < 3; i++) {
    const x = r.int(-12, 10), z = r.int(-9, 9);
    for (const [dx, dz] of [[0, 0], [1, -1], [2, -1], [3, 0], [0, 1], [3, 1]]) m.set(x + dx, 3, z + dz, PR.iron.shade, VF.METAL);
  }
  // a coil of chain
  for (let k = 0; k < 18; k++) {
    const t = k * 0.5;
    m.set(10 + Math.round(Math.cos(t) * 3), 1 + (k % 2), 6 + Math.round(Math.sin(t) * 3), PR.iron.dark, VF.METAL);
  }
  return S(m, VS);
}

/** hitching rail with a rope and a saddle blanket draped over it */
export function hitchingRail(seed = 0): StaticModel {
  const m = new VoxelModel('hitching_rail');
  post(m, -24, -1, 0, 22, 3, PR.woodDark, seed);
  post(m, 21, -1, 0, 22, 3, PR.woodDark, seed + 1);
  board(m, -26, 20, -1, 25, 22, 1, PR.wood, 'x', seed);
  // blanket
  for (let x = -6; x <= 8; x++) for (let y = 8; y <= 22; y++) for (const z of [-2, 2]) if (y > 8 + mod(x * 5, 3)) m.set(x, y, z, mod(x, 5) < 2 ? PR.red.base : PR.paintWhite.base, VF.SOFTAO);
  for (let x = -6; x <= 8; x++) m.set(x, 23, -1, PR.red.base).set(x, 23, 0, PR.red.base).set(x, 23, 1, PR.red.base);
  rope(m, sagPoints([-18, 21, 2], [-14, 6, 4], 1, 6));
  return S(m, VS);
}

/** rusty hand pump on a stone plinth with a wooden bucket under the spout */
export function waterPump(seed = 0): StaticModel {
  const m = new VoxelModel('water_pump');
  chunk(m, -9, 0, -9, 9, 6, 9, PR.stone, 2, true);
  cylY(m, 0, 0, 7, 28, 2.6, PR.rust.base, VF.METAL);
  cylY(m, 0, 0, 28, 30, 3.4, PR.rust.shade, VF.METAL);
  for (let y = 7; y < 28; y += 5) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (inCircle(x, z, 2.6) && !inCircle(x, z, 1.8)) m.set(x, y, z, PR.iron.base, VF.METAL);
  // spout
  for (let z = 3; z <= 8; z++) m.box(-1, 22, z, 1, 23, z, PR.rust.base, VF.METAL);
  m.box(-1, 20, 8, 1, 21, 8, PR.rust.shade, VF.METAL);
  // handle
  seg(m, [0, 30, -2], [0, 36, -12], 1, PR.iron.dark, VF.METAL);
  m.box(-2, 35, -13, 2, 36, -12, PR.woodDark.base);
  // bucket + a drip of water
  cylY(m, 0, 13, 7, 14, (t) => 3.6 + t * 0.8, PR.wood.base);
  for (let x = -3; x <= 3; x++) for (let z = 10; z <= 16; z++) if (inCircle(x, z - 13, 3.2)) m.set(x, 14, z, PR.water.base);
  for (const y of [9, 13]) for (let x = -5; x <= 5; x++) for (let z = 8; z <= 18; z++) if (inCircle(x, z - 13, 4.3) && !inCircle(x, z - 13, 3.4)) m.set(x, y, z, PR.iron.base, VF.METAL);
  m.set(0, 17, 8, PR.water.hi);
  return S(m, VS);
}

/** scattered bottles (some tipped, one broken) — 1/32 m */
export function bottleCluster(seed = 0): StaticModel {
  const r = rngOf(seed, 1237);
  const m = new VoxelModel('bottle_cluster');
  const glasses = [PR.glassGreen, PR.glassBrown, PR.glassClear];
  for (let i = 0; i < 6; i++) {
    const g = glasses[r.int(0, 2)];
    const x = r.int(-16, 14), z = r.int(-12, 12);
    const tipped = r.chance(0.4);
    const H = r.int(12, 16);
    for (let h = 0; h < H; h++) {
      const neck = h > H * 0.62;
      const rr = neck ? 1 : 2.6;
      for (let a = -3; a <= 3; a++)
        for (let b = -3; b <= 3; b++) {
          if (!inCircle(a, b, rr)) continue;
          const c = h === H - 1 ? PR.wood.base : neck ? g.shade : a === -2 && b === 0 ? g.hi : g.base;
          if (tipped) m.set(x + h, b + 3, z + a, c, VF.METAL);
          else m.set(x + a, h, z + b, c, VF.METAL);
        }
    }
    if (!tipped && r.chance(0.5)) for (let a = -2; a <= 2; a++) m.set(x + a, 6, z + 3, PR.parchment.base); // label
  }
  return S(m, TVS);
}

/** sagging string of lanterns between two leaning poles (meta.lamps: lamp centres in metres, bottom-centre pivot) */
export function lanternString(seed = 0): StaticModel & { meta: { lamps: V3[] } } {
  const m = new VoxelModel('lantern_string');
  const L = 120, H = 54;
  post(m, -L / 2 - 1, -1, 0, H + 2, 3, PR.woodDark, seed);
  post(m, L / 2 - 2, -1, 0, H - 4, 3, PR.woodDark, seed + 1);
  const a: V3 = [-L / 2, H, 0], b: V3 = [L / 2 - 1, H - 5, 0];
  const pts = sagPoints(a, b, 9, 16);
  rope(m, pts, PR.rope.shade);
  const lamps: V3[] = [];
  for (let i = 1; i <= 4; i++) {
    const p = pts[i * 3 + 1];
    const x = Math.round(p[0]), y = Math.round(p[1]);
    rope(m, [[x, y, 0], [x, y - 3, 0]], PR.iron.dark);
    lanternBody(m, x, y - 12, 0, true);
    lamps.push([x, y - 9, 0]);
  }
  // pivot is bottom-centre: convert lamp voxel coords to metres relative to that pivot
  const bnd = m.bounds();
  const px = (bnd.minX + bnd.maxX + 1) / 2, pz = (bnd.minZ + bnd.maxZ + 1) / 2;
  const lm = lamps.map((p) => [(p[0] + 0.5 - px) * VS, (p[1] + 0.5 - bnd.minY) * VS, (p[2] + 0.5 - pz) * VS] as V3);
  return { model: m, voxelSize: VS, meta: { lamps: lm } };
}

/** weathered plank panel with wanted posters nailed on (one torn) — 1/24 m */
export function posterPlank(seed = 0): StaticModel {
  const r = rngOf(seed, 1327);
  const m = new VoxelModel('poster_plank');
  const W = 30, H = 22;
  for (let x = -W / 2; x < W / 2; x++) for (let y = 0; y < H; y++) m.set(x, y, 0, mod(y, 5) === 0 ? PR.woodGrey.dark : Math.floor(y / 5) % 2 ? PR.woodGrey.base : PR.woodGrey.shade);
  const posters: [number, number, number, number][] = [[-13, 4, 9, 13], [-2, 6, 8, 11], [8, 3, 6, 9]];
  posters.forEach(([x0, y0, w, h], i) => {
    for (let x = x0; x < x0 + w; x++)
      for (let y = y0; y < y0 + h; y++) {
        if (i === 1 && x > x0 + w - 3 && y < y0 + 3) continue; // torn corner
        m.set(x, y, 1, y === y0 + h - 2 ? PR.red.shade : PR.parchment.base);
      }
    // tiny portrait
    for (let x = x0 + 2; x < x0 + w - 2; x++) for (let y = y0 + 3; y < y0 + h - 4; y++) m.set(x, y, 1, (x + y) % 3 === 0 ? PR.parchment.shade : PR.parchment.base);
    m.box(x0 + Math.floor(w / 2) - 1, y0 + h - 7, 1, x0 + Math.floor(w / 2), y0 + h - 6, 1, PR.ink.base);
    m.set(x0 + 1, y0 + h - 1, 2, PR.iron.dark, VF.METAL);
    if (r.chance(0.6)) m.set(x0 + w - 2, y0 + h - 1, 2, PR.iron.dark, VF.METAL);
  });
  return S(m, 1 / 24);
}

/** bullet-riddled sign on a post */
export function holeySign(seed = 0): StaticModel {
  const r = rngOf(seed, 1423);
  const m = new VoxelModel('holey_sign');
  post(m, -1, -1, 0, 30, 3, PR.woodDark, seed);
  const word = ['KEEP OUT', 'NO WATER', 'TURN BACK', 'SUNDOWN'][mod(seed, 4)];
  const tw = textWidth(word);
  const W = tw + 6;
  for (let x = -Math.floor(W / 2); x < Math.ceil(W / 2); x++) for (let y = 20; y < 29; y++) m.set(x, y, 2, mod(y, 3) === 0 ? PR.woodLight.shade : PR.woodLight.base).set(x, y, 3, PR.woodLight.shade);
  stampText(m, 'z+', word, -Math.floor(tw / 2), 26, 4, { color: PR.red.shade });
  for (let i = 0; i < 6; i++) bulletHole(m, r.int(-Math.floor(W / 2) + 1, Math.floor(W / 2) - 2), r.int(21, 27), 4, PR.woodLight.hi);
  return S(m, VS);
}

/** striped bedroll laid out with a rolled blanket pillow */
export function bedroll(seed = 0): StaticModel {
  const m = new VoxelModel('bedroll');
  for (let x = -7; x <= 7; x++)
    for (let z = -18; z <= 14; z++) {
      const stripe = mod(z, 8) < 2;
      m.set(x, 0, z, stripe ? PR.red.base : PR.canvas.base, VF.SOFTAO);
      if (Math.abs(x) === 7) m.set(x, 0, z, PR.canvas.shade, VF.SOFTAO);
    }
  // turned-back top + rolled pillow
  for (let x = -7; x <= 7; x++) for (let z = 6; z <= 10; z++) m.set(x, 1, z, PR.canvas.hi, VF.SOFTAO);
  for (let x = -7; x <= 7; x++) for (let y = 1; y <= 5; y++) for (let z = 12; z <= 17; z++) if (inCircle(y - 3, z - 14.5, 2.6)) m.set(x, y, z, x === -7 || x === 7 ? PR.red.shade : PR.red.base, VF.SOFTAO);
  for (const x of [-4, 4]) for (let y = 0; y <= 6; y++) m.set(x, y, 12, PR.leather.dark);
  return S(m, VS);
}

/** wooden bucket with iron bands — 1/32 m */
export function bucket(seed = 0): StaticModel {
  const m = new VoxelModel('bucket');
  cylY(m, 0, 0, 0, 14, (t) => 5.4 + t * 1.4, PR.wood.base);
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) if (inCircle(x, z, 5.6)) m.set(x, 14, z, mod(seed, 2) ? PR.water.base : PR.wood.dark);
  for (const y of [2, 11]) cylY(m, 0, 0, y, y, (y / 14) * 1.4 + 5.6, PR.iron.base, VF.METAL);
  seg(m, [-7, 14, 0], [0, 22, 0], 1, PR.iron.dark, VF.METAL);
  seg(m, [0, 22, 0], [7, 14, 0], 1, PR.iron.dark, VF.METAL);
  return S(m, TVS);
}

/** coil of rope — 1/32 m */
export function ropeCoil(): StaticModel {
  const m = new VoxelModel('rope_coil');
  for (let y = 0; y < 5; y++)
    for (let x = -9; x <= 9; x++)
      for (let z = -9; z <= 9; z++) {
        const d = Math.hypot(x, z);
        if (d > 9 - y * 0.6 || d < 4) continue;
        m.set(x, y, z, mod(Math.round(d * 2) + y, 3) === 0 ? PR.rope.shade : PR.rope.base);
      }
  rope(m, [[8, 2, 0], [14, 0, 4], [18, 0, 2]]);
  return S(m, TVS);
}

/** rickety clothes rack with dusters, a poncho and a leather coat, hats on the post tops (the wardrobe) — 1/24 */
export function clothesRack(seed = 0): StaticModel {
  const m = new VoxelModel('clothes_rack');
  post(m, -24, -1, 0, 48, 3, PR.woodDark, seed);
  post(m, 22, -1, 0, 48, 3, PR.woodDark, seed + 1);
  for (const x of [-26, 21]) board(m, x, 0, -7, x + 6, 1, 7, PR.woodDark, 'z', seed);
  board(m, -25, 46, -1, 25, 47, 1, PR.wood, 'x', seed);
  const coats: [number, Ramp, number][] = [[-16, PR.duster, 0], [-3, PR.poncho, 1], [10, PR.leather, 2]];
  for (const [cx, c, k] of coats) {
    for (let y = 16; y <= 44; y++) {
      const w = y > 39 ? 6 : 5 + (y < 24 ? 1 : 0);
      for (let x = -w; x <= w; x++)
        for (let z = -2; z <= 2; z++) {
          if (!(Math.abs(z) < 2 || Math.abs(x) < w)) continue;
          let col = y % 7 === 0 ? c.shade : x === -w || x === w ? c.shade : c.base;
          if (k === 1 && mod(y, 6) < 2) col = PR.paintWhite.shade; // poncho stripes
          if (k === 1 && mod(y, 6) === 2) col = PR.turquoise.base;
          m.set(cx + x, y, z, wear(col, x, y, z, 0.04), VF.SOFTAO);
        }
    }
    m.box(cx - 1, 45, 0, cx + 1, 46, 0, PR.iron.dark, VF.METAL);
    for (let y = 30; y <= 42; y++) m.set(cx, y, 3, c.dark);
    if (k !== 1) for (let y = 32; y <= 40; y += 3) m.set(cx + 1, y, 3, PR.brass.base, VF.METAL); // buttons
  }
  for (const x of [-23, 23]) {
    cylY(m, x, 0, 49, 49, 6, PR.hat.shade);
    cylY(m, x, 0, 50, 54, 3.6, PR.hat.base);
    cylY(m, x, 0, 50, 50, 3.8, PR.red.base);
  }
  // a belt with a holster hanging off the rail
  for (let y = 28; y <= 46; y++) m.set(19, y, 2, PR.leather.dark);
  m.box(17, 26, 1, 21, 31, 3, PR.leather.base);
  return S(m, FVS);
}

/** steamer trunk, lid open, clothes spilling out — 1/24 */
export function trunk(seed = 0): StaticModel {
  const m = new VoxelModel('trunk');
  const W = 26, D = 14, H = 14;
  for (let x = -W / 2; x <= W / 2; x++)
    for (let y = 0; y <= H; y++)
      for (let z = -D / 2; z <= D / 2; z++) {
        const shell = Math.abs(x) === W / 2 || Math.abs(z) === D / 2 || y === 0;
        if (!shell) continue;
        const band = Math.abs(x) === W / 2 - 5 || y === 2 || y === H;
        const corner = Math.abs(x) >= W / 2 - 1 && (y < 3 || y > H - 2);
        m.set(x, y, z, corner ? PR.brass.hi : band ? PR.brass.shade : wear(PR.leather.base, x, y, z, 0.05), band || corner ? VF.METAL : 0);
      }
  for (let x = -W / 2; x <= W / 2; x++)
    for (let k = 0; k <= 12; k++) {
      const band = Math.abs(x) === W / 2 - 5;
      m.set(x, H + 1 + k, -D / 2 - Math.round(k * 0.35), band ? PR.brass.base : k === 12 ? PR.leather.hi : wear(PR.leather.shade, x, k, 0, 0.05), band ? VF.METAL : 0);
    }
  // lid lining (faded floral)
  for (let x = -W / 2 + 2; x <= W / 2 - 2; x++) for (let k = 2; k <= 10; k++) m.set(x, H + 1 + k, -D / 2 - Math.round(k * 0.35) + 1, (x + k) % 4 === 0 ? 0x8a5a5a : 0xb89a8a, VF.SOFTAO);
  for (let x = -10; x <= 8; x++) for (let y = H - 2; y <= H + 1; y++) for (let z = -5; z <= 5; z++) if (y < H + 1 || (x + z) % 3) m.set(x, y, z, x < -3 ? PR.denim.base : x < 3 ? PR.linen.base : PR.red.base, VF.SOFTAO);
  for (let k = 0; k < 11; k++) for (let x = -4; x <= 1; x++) m.set(x, H - Math.floor(k * 1.2), D / 2 + 1 + Math.floor(k / 3), PR.linen.shade, VF.SOFTAO);
  m.box(-1, 8, D / 2 + 1, 1, 10, D / 2 + 1, PR.brass.base, VF.METAL);
  return S(m, FVS);
}

/** a round log bench with a flattened seat, on two stumps */
export function logBench(seed = 0): StaticModel {
  const m = new VoxelModel('log_bench');
  const R = 4.6, cy = 7;
  for (let x = -22; x <= 22; x++)
    for (let y = -6; y <= 6; y++)
      for (let z = -6; z <= 6; z++) {
        if (!inCircle(y, z, R) || y > 3) continue;
        const end = Math.abs(x) === 22;
        const ring = inCircle(y, z, R - 1.4);
        let c: number = PR.woodDark.base;
        if (end) c = ring ? (inCircle(y, z, 1.6) ? PR.woodLight.shade : PR.woodLight.base) : PR.woodDark.shade;
        else if (y === 3) c = mod(x, 9) === 0 ? PR.woodLight.shade : PR.woodLight.base; // the flat sawn seat
        else if (mod(x * 3 + z * 5 + y, 13) === 0) c = PR.woodDark.dark; // bark fissures
        m.set(x, cy + y, z, c);
      }
  for (const x of [-15, 13]) {
    cylY(m, x, 0, 0, 3, 3.6, PR.woodDark.shade);
    cylY(m, x, 0, 3, 3, 2.8, PR.woodLight.base);
  }
  return S(m, VS);
}

/** stacked firewood (round ends facing front) with an axe stuck in a stump */
export function woodPile(seed = 0): StaticModel {
  const r = rngOf(seed, 1531);
  const m = new VoxelModel('wood_pile');
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 6 - row; i++) {
      const cx = -11 + i * 4.3 + row * 2.15, cy = 2 + row * 3.6;
      const len = r.int(15, 18);
      for (let z = -9; z <= -9 + len; z++)
        for (let a = -2; a <= 2; a++)
          for (let b = -2; b <= 2; b++) {
            if (!inCircle(a, b, 1.9)) continue;
            const front = z === -9 + len;
            const c = front ? (a === 0 && b === 0 ? PR.woodLight.shade : inCircle(a, b, 1.1) ? PR.woodLight.hi : PR.woodLight.base) : mod(z + i, 5) === 0 ? PR.woodDark.shade : PR.woodDark.base;
            m.set(Math.round(cx + a), Math.round(cy + b), z, c);
          }
    }
  // stump + axe
  cylY(m, 18, 2, 0, 7, 4.4, PR.woodDark.base);
  cylY(m, 18, 2, 7, 7, 3.6, PR.woodLight.base);
  seg(m, [18, 8, 2], [24, 22, 2], 1, PR.wood.hi);
  m.box(16, 7, 1, 19, 10, 3, PR.iron.base, VF.METAL);
  return S(m, VS);
}

/** saddle on a short rail */
export function saddleRail(seed = 0): StaticModel {
  const m = new VoxelModel('saddle_rail');
  for (const x of [-12, 10]) post(m, x, -1, 0, 16, 3, PR.woodDark, seed);
  board(m, -13, 16, -1, 13, 17, 1, PR.wood, 'x', seed);
  // saddle: seat, horn, skirts, stirrups
  for (let x = -8; x <= 8; x++)
    for (let z = -6; z <= 6; z++) {
      const seat = Math.abs(z) <= 4;
      const y = 18 + Math.round(Math.abs(x) * 0.25) - (Math.abs(z) > 3 ? 2 : 0);
      m.set(x, y, z, seat ? (Math.abs(x) < 6 ? PR.leather.base : PR.leather.shade) : PR.leather.dark);
      if (!seat) for (let k = 1; k < 7; k++) m.set(x, y - k, z, k % 3 === 0 ? PR.leather.dark : PR.leather.shade);
    }
  m.box(6, 20, -1, 7, 23, 1, PR.leather.hi);
  m.box(5, 24, -1, 8, 24, 1, PR.brass.base, VF.METAL);
  for (const z of [-7, 7]) {
    seg(m, [0, 17, z], [0, 7, z], 1, PR.leather.dark);
    m.box(-2, 5, z, 2, 6, z, PR.iron.base, VF.METAL);
  }
  return S(m, VS);
}

/** cattle skull nailed to a short plank — hangs on walls */
export function skullPlaque(): StaticModel {
  const m = new VoxelModel('skull_plaque');
  for (let x = -10; x <= 10; x++) for (let y = 0; y <= 6; y++) m.set(x, y + 4, -2, mod(y, 3) === 0 ? PR.woodDark.dark : PR.woodDark.base);
  const sk = cowSkullModel();
  sk.forEach((x, y, z, c, f) => m.set(x, y, z + 1, c, f));
  return S(m, VS);
}

/** low crate used as a table, with a burn ring and a tin cup — 1/24 */
export function crateTable(seed = 0): StaticModel {
  const m = new VoxelModel('crate_table');
  crateBox(m, -11, 0, -11, 22, mod(seed, 2) ? PR.woodLight : PR.wood, PR.woodDark, true);
  for (let x = -7; x <= -2; x++) for (let z = 3; z <= 8; z++) if (inCircle(x + 4.5, z - 5.5, 2.5) && !inCircle(x + 4.5, z - 5.5, 1.3)) m.set(x, 21, z, PR.wood.dark);
  cylY(m, 7, -6, 22, 26, 1.8, PR.tin.base, VF.METAL);
  stampText(m, 'z+', 'TOOLS', -10, 14, 12, { color: PR.red.shade });
  return S(m, FVS);
}

/** half-buried cactus in a cracked pot (homey touch) */
export function potCactus(seed = 0): StaticModel {
  const m = new VoxelModel('pot_cactus');
  cylY(m, 0, 0, 0, 7, (t) => 4.2 + t * 1.2, PR.terracotta.base);
  cylY(m, 0, 0, 7, 7, 5.6, PR.terracotta.hi);
  for (let y = 1; y < 6; y++) m.set(3, y + (y % 2), 4, PR.terracotta.dark);
  cylY(m, 0, 0, 7, 20, (t) => 2.6 - t * 0.6, PR.cactus.base);
  for (let y = 9; y < 20; y += 3) m.set(2, y, 0, PR.cactus.hi).set(-2, y + 1, 0, PR.cactus.shade);
  seg(m, [0, 13, 0], [4, 15, 0], 1, PR.cactus.base);
  seg(m, [4, 15, 0], [4, 19, 0], 1, PR.cactus.base);
  m.set(0, 21, 0, PR.flower.base).set(1, 21, 0, PR.flower.hi);
  return S(m, VS);
}

// ===========================================================================
// THE RUINED SALOON — gritty, messy, detailed interior (higher voxel counts)
// Room pieces share one frame (ROOM_PIVOT = floor-top centre); furniture at
// 1/24–1/32 m, scatter (glass, cards, cobwebs) at 1/48 m.
// ===========================================================================
export const ROOM = { W: 12, D: 9, H: 4.2, VS: 1 / 16 };
const RVS = ROOM.VS;
export const RNX = Math.round(ROOM.W / RVS), RNZ = Math.round(ROOM.D / RVS), RNH = Math.round(ROOM.H / RVS);
/** every room piece is built with this pivot so they all line up at world origin */
export const ROOM_PIVOT: V3 = [RNX / 2, 1, RNZ / 2];
/** world metres (room centre origin) → room voxel x/z */
const rx = (mx: number) => Math.round(mx / RVS + RNX / 2);
const rz = (mz: number) => Math.round(mz / RVS + RNZ / 2);

const FVS = 1 / 24; // furniture
const DVS = 1 / 32; // detailed props
const MVS = 1 / 48; // tiny scatter

/** brightness multiply */
function mul(c: number, f: number) {
  const r = Math.max(0, Math.min(255, ((c >> 16) & 255) * f)), g = Math.max(0, Math.min(255, ((c >> 8) & 255) * f)), b = Math.max(0, Math.min(255, (c & 255) * f));
  return ((r << 16) | (g << 8) | b) >>> 0;
}
/** subtle hand-placed wear: deterministic ±amt brightness per voxel */
function wear(c: number, x: number, y: number, z: number, amt = 0.06) {
  return mul(c, 1 + (hash3(x * 1.7, y * 2.3, z * 3.1) - 0.5) * 2 * amt);
}

// interior palette (warm, worn, not cartoony)
const IP = {
  pine: 0x9a6e46,
  pineDark: 0x6e4a2c,
  gap: 0x2a1a10,
  walnut: 0x4e2e1a,
  walnutHi: 0x6e442a,
  walnutDark: 0x2e1a0e,
  paperA: 0xa8906a,
  paperB: 0x927a5a,
  paperDot: 0xbca27a,
  greyBoard: 0x8a7e6c,
  greyDark: 0x5a5246,
  dirt: 0x6a4a30,
  dirtDark: 0x4a3220,
  sawdust: 0xc8a46a,
  brass: 0xc0923a,
  brassHi: 0xe8c068,
  iron: 0x3a3836,
  ironHi: 0x5c5854,
  glass: 0xaccac4,
  web: 0xd8d0c2,
  parch: 0xe2cfa0,
  parchDark: 0xb8a070,
  stain: 0x3e2a18,
};

// ---------------------------------------------------------------------------
// room shell
// ---------------------------------------------------------------------------
export interface RoomHole {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** plank floor: boards run front-to-back with dark gaps, staggered butt joints, joist nails,
 *  a worn path, whiskey stains, sawdust drifts and a few ripped-up boards showing dirt. */
export function saloonFloor(seed = 0): StaticModel {
  const r = rngOf(seed, 2003);
  const m = new VoxelModel('saloon_floor');
  const bw = 3;
  const nb = Math.ceil(RNX / bw);
  const tones = [1, 0.92, 1.06, 0.86, 0.98, 1.1];
  const btone: number[] = [], joints: Set<number>[] = [];
  for (let b = 0; b < nb; b++) {
    btone.push(tones[r.int(0, tones.length - 1)]);
    const js = new Set<number>();
    for (let z = r.int(6, 40); z < RNZ; z += r.int(30, 56)) js.add(z);
    joints.push(js);
  }
  // ripped-up boards (holes) — world metres
  const holes = [
    { b0: Math.floor(rx(-1.2) / bw), b1: Math.floor(rx(-1.2) / bw) + 1, z0: rz(1.1), z1: rz(2.2) },
    { b0: Math.floor(rx(3.0) / bw), b1: Math.floor(rx(3.0) / bw), z0: rz(1.6), z1: rz(2.5) },
    { b0: Math.floor(rx(-3.6) / bw), b1: Math.floor(rx(-3.6) / bw) + 2, z0: rz(-1.0), z1: rz(-0.2) },
  ];
  const inHole = (b: number, z: number) => holes.some((h) => b >= h.b0 && b <= h.b1 && z >= h.z0 && z <= h.z1);
  // worn path: breach → bar, and bar along its front
  const path: [number, number, number, number][] = [
    [rx(-5.8), rz(0.2), rx(0.5), rz(-2.4)],
    [rx(-1.4), rz(-2.6), rx(3.4), rz(-2.6)],
    [rx(0.6), rz(4.4), rx(0.8), rz(-2.4)],
  ];
  const segDist = (x: number, z: number, [ax, az, bx, bz]: [number, number, number, number]) => {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - ax - dx * t, z - az - dz * t);
  };
  const stains: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) stains.push([r.int(10, RNX - 10), r.int(10, RNZ - 10), r.int(3, 8)]);
  stains.push([rx(-4.9), rz(-3.6), 14]); // scorched round the stove
  const dust: [number, number, number][] = [];
  for (let i = 0; i < 14; i++) dust.push([r.int(4, RNX - 4), r.int(4, RNZ - 4), r.int(3, 9)]);
  for (let x = 0; x < RNX; x++)
    for (let z = 0; z < RNZ; z++) {
      const b = Math.floor(x / bw), w = x % bw;
      if (inHole(b, z)) {
        // ripped-up: joist below every 10 voxels, dirt deeper
        if (mod(z, 10) < 2) m.set(x, -3, z, IP.pineDark);
        m.set(x, -5, z, wear(mod(x * 7 + z * 3, 9) === 0 ? IP.dirtDark : IP.dirt, x, 0, z, 0.08));
        continue;
      }
      let c = mul(IP.pine, btone[b]);
      if (w === 0) {
        m.set(x, -1, z, IP.gap); // the gap between boards is a groove
        continue;
      }
      if (joints[b].has(z)) c = IP.pineDark;
      if (mod(z, 10) === 4 && w === 1) c = IP.iron;
      // worn path lightens, edges stay darker
      const pd = Math.min(...path.map((p) => segDist(x, z, p)));
      if (pd < 16) c = mul(c, 1 + 0.16 * (1 - pd / 16));
      if (x < 6 || x > RNX - 7 || z < 6) c = mul(c, 0.82); // dirt along the walls
      for (const [sx, sz, sr] of stains) {
        const d = Math.hypot(x - sx, z - sz);
        if (d < sr) c = mixRGB(c, IP.stain, 0.35 * (1 - d / (sr + 1)) + 0.15);
      }
      for (const [dx, dz, dr] of dust) if (Math.hypot(x - dx, z - dz) < dr && hash3(x, 7, z) > 0.35) c = mixRGB(c, IP.sawdust, 0.7);
      m.set(x, 0, z, wear(c, x, 0, z, 0.05));
      m.set(x, -1, z, IP.pineDark);
    }
  // splintered board ends sticking into the holes
  for (const h of holes) {
    for (let b = h.b0; b <= h.b1; b++)
      for (const zEdge of [h.z0 - 1, h.z1 + 1]) {
        const dir = zEdge < h.z0 ? 1 : -1;
        for (let w = 1; w < bw; w++) {
          const len = (b * 3 + w) % 3;
          for (let k = 1; k <= len; k++) m.set(b * bw + w, 0, zEdge + dir * k, k === len ? 0xd2b48a : IP.pine);
        }
      }
  }
  return S(m, RVS);
}

interface WallOpts {
  axis: 'x' | 'z';
  fixed: number; // interior face coordinate (on the other axis)
  out: 1 | -1; // interior → exterior direction
  u0: number;
  u1: number;
  seed: number;
  breaches?: { u0: number; u1: number; y0: number; y1: number }[];
  windows?: { u0: number; w: number; y0: number; h: number; kind: 'broken' | 'boarded' | 'door' }[];
  posters?: { u: number; y: number }[];
  sign?: { text: string; u: number; y: number };
  stains?: number[];
}

/** an interior wall: beadboard wainscot, chair rail, faded striped wallpaper peeling to planks,
 *  water stains, ragged breaches with splintered boards, windows (broken or boarded), posters. */
function interiorWall(m: VoxelModel, o: WallOpts) {
  const r = rngOf(o.seed, 2111);
  const put = (u: number, y: number, layer: number, c: number, f?: number) => {
    const p = o.fixed + o.out * layer;
    if (o.axis === 'x') m.set(u, y, p, c, f);
    else m.set(p, y, u, c, f);
  };
  const del = (u: number, y: number, layer: number) => {
    const p = o.fixed + o.out * layer;
    if (o.axis === 'x') m.del(u, y, p);
    else m.del(p, y, u);
  };
  const peel: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) peel.push([r.int(o.u0 + 4, o.u1 - 20), r.int(20, RNH - 22), r.int(8, 22), r.int(6, 16)]);
  const inPeel = (u: number, y: number) => peel.some(([pu, py, pw, ph]) => u >= pu && u < pu + pw && y >= py && y < py + ph && !(u === pu && y > py + ph / 2) && hash3(u, y, 3) > 0.08);
  const stainCols = o.stains ?? [];
  for (let u = o.u0; u <= o.u1; u++)
    for (let y = 0; y < RNH; y++) {
      // exterior: weathered horizontal planks
      const row = Math.floor(y / 4);
      const ex = mod(y, 4) === 0 ? IP.greyDark : wear(mul(IP.greyBoard, 0.9 + (hash3(row, 1, Math.floor(u / 40) + o.seed) * 0.2)), u, y, 9, 0.04);
      put(u, y, 1, ex);
      // interior face
      let c: number;
      if (y < 2) c = IP.walnutDark; // baseboard
      else if (y < 16) {
        const bi = Math.floor(u / 3);
        c = mod(u, 3) === 0 ? IP.walnutDark : mul(IP.walnut, 0.92 + hash3(bi, 2, o.seed) * 0.18);
        if (y === 15) c = IP.walnutHi;
      } else if (y < 18) c = y === 17 ? IP.walnutHi : IP.walnut; // chair rail
      else if (y >= RNH - 3) c = y === RNH - 3 ? IP.walnutHi : IP.walnutDark; // crown
      else if (inPeel(u, y)) c = mod(y, 4) === 0 ? IP.pineDark : mul(IP.pine, 0.85 + hash3(Math.floor(y / 4), u >> 4, 5) * 0.2);
      else {
        const stripe = mod(u, 12) < 6;
        c = stripe ? IP.paperA : IP.paperB;
        if (stripe && mod(u, 12) === 3 && mod(y, 6) === 0) c = IP.paperDot;
        c = mul(c, 1.04 - (y / RNH) * 0.1); // smoke-darkened towards the ceiling
      }
      // water stains running down from the roof
      for (const su of stainCols) {
        const len = 18 + (Math.abs(su * 7) % 22);
        if (Math.abs(u - su) <= 2 + ((y * 3) % 2) && y > RNH - len) c = mul(c, 0.72);
      }
      put(u, y, 0, wear(c, u, y, o.seed, 0.035));
    }
  // breaches: ragged per board row on the outside, paper torn wider inside, splinters
  for (const b of o.breaches ?? []) {
    for (let y = b.y0; y <= b.y1; y++) {
      const row = Math.floor(y / 4);
      const topK = (b.y1 - y) / Math.max(1, b.y1 - b.y0);
      const shrink = Math.round(Math.sin((1 - topK) * Math.PI) * 0) + (y > b.y1 - 8 ? Math.round((y - (b.y1 - 8)) * 1.2) : 0);
      const a0 = b.u0 + (hash3(row, 11, o.seed) * 6 | 0) + shrink, a1 = b.u1 - (hash3(row, 13, o.seed) * 6 | 0) - shrink;
      for (let u = a0; u <= a1; u++) {
        del(u, y, 1);
        del(u, y, 0);
      }
      // splintered ends: lighter tips
      if (a0 - 1 >= o.u0) put(a0 - 1, y, 1, 0xc8b08a);
      if (a1 + 1 <= o.u1) put(a1 + 1, y, 1, 0xc8b08a);
      for (let k = 1; k <= 3; k++) {
        if (hash3(row, k, 17) > 0.5) del(a0 - k, y, 0);
        if (hash3(row, k, 19) > 0.5) del(a1 + k, y, 0);
      }
    }
    // broken studs left standing in the gap
    const mid = Math.round((b.u0 + b.u1) / 2);
    for (let y = 0; y < Math.round((b.y1 - b.y0) * 0.45); y++) put(mid, y, 0.5 > 0 ? 1 : 0, IP.pineDark);
  }
  // windows
  for (const w of o.windows ?? []) {
    for (let u = w.u0; u < w.u0 + w.w; u++) for (let y = w.y0; y < w.y0 + w.h; y++) {
      del(u, y, 0);
      del(u, y, 1);
    }
    for (let u = w.u0 - 2; u < w.u0 + w.w + 2; u++) {
      put(u, w.y0 - 1, -1, IP.walnutHi);
      put(u, w.y0 - 2, -1, IP.walnut);
      put(u, w.y0 + w.h, -1, IP.walnut);
      put(u, w.y0 + w.h + 1, -1, IP.walnutDark);
    }
    for (let y = w.y0; y < w.y0 + w.h; y++) {
      put(w.u0 - 1, y, -1, IP.walnut);
      put(w.u0 + w.w, y, -1, IP.walnut);
      if (w.kind !== 'door') put(w.u0 + Math.floor(w.w / 2), y, 1, IP.walnutDark); // muntin
    }
    if (w.kind === 'door') continue;
    for (let u = w.u0; u < w.u0 + w.w; u++) put(u, w.y0 + Math.floor(w.h / 2), 1, IP.walnutDark);
    if (w.kind === 'broken') {
      // jagged shards left in the corners of each pane
      for (const [cu, cy, du, dy] of [[w.u0, w.y0, 1, 1], [w.u0 + w.w - 1, w.y0 + w.h - 1, -1, -1], [w.u0, w.y0 + w.h - 1, 1, -1], [w.u0 + w.w - 1, w.y0, -1, 1]] as const)
        for (let k = 0; k < 4; k++) for (let j = 0; j < 4 - k; j++) put(cu + du * j, cy + dy * k, 1, mul(IP.glass, 0.9 + j * 0.05), VF.METAL);
    } else {
      // planks nailed across (two diagonal-ish, one level)
      for (const [y0, slope] of [[w.y0 + 3, 0.35], [w.y0 + w.h - 6, -0.3], [w.y0 + Math.floor(w.h / 2) - 1, 0]] as const)
        for (let u = w.u0 - 3; u <= w.u0 + w.w + 2; u++) {
          const yy = Math.round(y0 + (u - w.u0) * slope);
          for (let t = 0; t < 3; t++) put(u, yy + t, -1, t === 0 ? 0x7a6a56 : wear(0x9a8a72, u, yy + t, 3, 0.06));
          if (u === w.u0 - 2 || u === w.u0 + w.w + 1) put(u, yy + 1, -2, IP.iron, VF.METAL);
        }
    }
  }
  // posters nailed to the wallpaper
  for (const p of o.posters ?? []) {
    const pw = 10 + (p.u % 3), ph = 14;
    for (let u = p.u; u < p.u + pw; u++)
      for (let y = p.y; y < p.y + ph; y++) {
        if (u > p.u + pw - 3 && y < p.y + 2 && (p.u & 1)) continue; // torn corner
        let c = u === p.u || u === p.u + pw - 1 || y === p.y || y === p.y + ph - 1 ? IP.parchDark : IP.parch;
        if (y === p.y + ph - 3 && u > p.u + 1 && u < p.u + pw - 2) c = 0x5a2a1a; // WANTED band
        if (y >= p.y + 4 && y <= p.y + 8 && u >= p.u + 3 && u <= p.u + pw - 4) c = (u + y) % 3 ? 0x8a7450 : 0x6a5438; // portrait
        if (y === p.y + 2 && u > p.u + 2 && u < p.u + pw - 3) c = 0x6a4a30; // reward line
        put(u, y, -1, wear(c, u, y, 1, 0.05));
      }
    put(p.u + Math.floor(pw / 2), p.y + ph - 1, -2, IP.iron, VF.METAL);
  }
  // a faded painted sign right on the boards
  if (o.sign && o.axis === 'x') {
    const tw = textWidth(o.sign.text, 1, 2);
    stampText(m, o.out < 0 ? 'z+' : 'z-', o.sign.text, o.sign.u - Math.floor(tw / 2), o.sign.y, o.fixed - o.out, { color: 0xd8c08a, scale: 2 });
  }
}

/** back, left and right walls of the saloon (front wall is mostly gone) */
export function saloonWalls(seed = 0): StaticModel {
  const m = new VoxelModel('saloon_walls');
  // back wall: z = 0 (exterior) / 1 (interior)
  interiorWall(m, {
    axis: 'x', fixed: 1, out: -1, u0: 0, u1: RNX - 1, seed: seed + 1,
    windows: [{ u0: rx(4.6), w: 14, y0: 26, h: 18, kind: 'broken' }, { u0: rx(-3.85), w: 15, y0: 0, h: 36, kind: 'door' }],
    posters: [{ u: rx(-5.6), y: 30 }, { u: rx(-2.72), y: 31 }, { u: rx(5.2), y: 24 }],
    sign: { text: 'WHISKEY', u: rx(1.0), y: RNH - 6 },
    stains: [rx(-2.6), rx(0.4), rx(3.9)],
  });
  // left wall: x = 0 / 1 — the big breach to the street + a broken window near the back
  interiorWall(m, {
    axis: 'z', fixed: 1, out: -1, u0: 0, u1: RNZ - 1, seed: seed + 2,
    breaches: [{ u0: rz(-1.25), u1: rz(1.6), y0: 0, y1: 50 }],
    windows: [{ u0: rz(-3.7), w: 12, y0: 26, h: 16, kind: 'broken' }],
    posters: [{ u: rz(2.6), y: 26 }],
    stains: [rz(-2.0), rz(3.0)],
  });
  // right wall: x = RNX-1 / RNX-2 — a boarded window, posters
  interiorWall(m, {
    axis: 'z', fixed: RNX - 2, out: 1, u0: 0, u1: RNZ - 1, seed: seed + 3,
    windows: [{ u0: rz(0.4), w: 14, y0: 24, h: 20, kind: 'boarded' }],
    posters: [{ u: rz(-2.9), y: 30 }, { u: rz(2.6), y: 27 }],
    stains: [rz(1.2)],
  });
  // corner posts + a stub of the front wall on the right with the batwing door frame
  for (const [x, z] of [[0, 0], [RNX - 3, 0], [0, RNZ - 3], [RNX - 3, RNZ - 3]]) post(m, x, z, 0, RNH, 3, PR.woodDark, x + z);
  for (let x = RNX - 40; x < RNX - 2; x++) for (let y = 0; y < RNH - 10 + (x % 5 === 0 ? -6 : 0); y++) m.set(x, y, RNZ - 2, mod(y, 4) === 0 ? IP.greyDark : wear(IP.greyBoard, x, y, 2, 0.05));
  for (let x = rx(1.8); x < rx(3.0); x++) for (let y = 0; y < 34; y++) m.del(x, y, RNZ - 2);
  // the header beam over the old front, cracked and sagging in the middle
  for (let x = 0; x < RNX; x++) {
    const sag = Math.round(Math.max(0, 6 - Math.abs(x - RNX * 0.42) / 9));
    for (let y = 0; y < 4; y++) m.set(x, RNH - 5 - sag + y, RNZ - 3, y === 3 ? IP.walnutHi : IP.walnut);
  }
  return S(m, RVS);
}

/** ceiling + roof: joists, board deck and corrugated tin with big ragged holes (light shafts),
 *  boards dangling from the holes and one joist snapped and fallen into the room.
 *  meta.holes: hole centres/radii in world metres (room frame). */
export function saloonRoof(seed = 0): StaticModel & { meta: { holes: RoomHole[] } } {
  const r = rngOf(seed, 2203);
  const m = new VoxelModel('saloon_roof');
  const holes: RoomHole[] = [
    { x: -2.6, z: -1.6, rx: 0.95, rz: 0.75 },
    { x: 0.4, z: -3.3, rx: 0.55, rz: 0.5 },
    { x: -4.4, z: 0.9, rx: 0.65, rz: 0.95 },
    { x: 2.7, z: -0.6, rx: 0.45, rz: 0.4 },
  ];
  const holeAt = (x: number, z: number, grow = 0) =>
    holes.some((h) => {
      const dx = (x - rx(h.x)) / (h.rx / RVS + grow), dz = (z - rz(h.z)) / (h.rz / RVS + grow);
      const ragged = (hash3(Math.floor(z / 3), 5, Math.floor(x / 9)) - 0.5) * 0.35;
      return dx * dx + dz * dz < 1 + ragged;
    });
  const deckY = RNH, tinY = RNH + 2;
  const fallenX = rx(-4.4);
  for (let x = 0; x < RNX; x++)
    for (let z = 0; z < RNZ; z++) {
      // joists every 20 voxels, spanning front to back
      if (mod(x - 6, 20) < 3 && !(Math.abs(x - fallenX) < 2 && z > rz(-3.9))) for (let y = RNH - 5; y < RNH; y++) m.set(x, y, z, y === RNH - 5 ? IP.walnutDark : wear(IP.walnut, x, y, z, 0.05));
      if (!holeAt(x, z)) {
        const row = Math.floor(z / 3);
        m.set(x, deckY, z, mod(z, 3) === 0 ? IP.walnutDark : wear(mul(IP.pineDark, 0.85 + hash3(row, 3, x >> 5) * 0.25), x, deckY, z, 0.04));
      }
      if (!holeAt(x, z, -1.5)) {
        const corr = mod(x, 4) < 2;
        const rust = hash3(x >> 3, 9, z >> 4) > 0.72;
        m.set(x, tinY, z, rust ? (corr ? 0x8c5a34 : 0x744a2c) : corr ? 0x8e8c86 : 0x76746e, VF.METAL);
      }
    }
  // boards dangling from the holes
  for (const h of holes) {
    const n = 1 + r.int(0, 1);
    for (let i = 0; i < n; i++) {
      const sx = rx(h.x + (r.next() - 0.5) * h.rx), sz = rz(h.z - h.rz * 0.9);
      const len = r.int(10, 18);
      for (let k = 0; k < len; k++) for (let w = 0; w < 3; w++) m.set(sx + w, deckY - k, sz + Math.round(k * 0.45), k === len - 1 ? 0xc8b08a : wear(IP.pineDark, sx + w, k, sz, 0.05));
    }
  }
  // the snapped joist: from the back wall plate down to the floor
  seg(m, [fallenX, RNH - 3, rz(-4.2)], [fallenX + 26, 2, rz(0.1)], 3, IP.walnut);
  for (let k = 0; k < 4; k++) m.set(fallenX + 26 + k, 1, rz(0.1) + k, 0xc8b08a); // splintered end
  // stove pipe hole
  for (let x = rx(-4.95) - 2; x <= rx(-4.95) + 2; x++) for (let z = rz(-3.75) - 2; z <= rz(-3.75) + 2; z++) m.del(x, deckY, z).del(x, tinY, z);
  return { model: m, voxelSize: RVS, meta: { holes } };
}

// ---------------------------------------------------------------------------
// the bar
// ---------------------------------------------------------------------------
/** sagging walnut bar: raised panels, a cracked top with a brass edge, brass foot rail on brackets,
 *  one end kicked in, a brass cash register. ~5 m × 1.1 m at 1/24. Front faces +Z. */
export function barRuin(seed = 0): StaticModel {
  const r = rngOf(seed, 2301);
  const m = new VoxelModel('bar_ruin');
  const L = 120, H = 26, D = 16;
  const sag = (u: number) => Math.round(Math.max(0, 2.6 * Math.sin(((u - 20) / (L - 40)) * Math.PI)) * (u > 20 && u < L - 20 ? 1 : 0));
  const kicked = (u: number, y: number) => u > L - 22 && u < L - 8 && y > 3 && y < H - 7;
  for (let u = 0; u < L; u++) {
    const s = sag(u);
    for (let y = 0; y < H - s; y++)
      for (let z = 0; z < D; z++) {
        const front = z === D - 1, back = z === 0;
        if (!front && !back && u > 0 && u < L - 1 && y > 0) continue; // hollow
        let c = IP.walnut;
        if (front) {
          const pu = mod(u, 20), py = y;
          const frame = pu < 2 || pu > 17 || py < 3 || py > H - s - 6;
          c = frame ? IP.walnutDark : py === 4 || pu === 2 ? IP.walnutHi : mul(IP.walnut, 1.08);
          if (kicked(u, y)) continue;
          if (y < 2) c = 0x2a1a10; // kick plate scuffed dark
        }
        m.set(u - L / 2, y, z - D / 2, wear(c, u, y, z, 0.05));
      }
    // the top: 2 voxels thick, overhanging the front, brass edge strip
    for (let z = -1; z < D + 2; z++)
      for (let t = 0; t < 2; t++) {
        const y = H - s + t;
        const crack = Math.abs(u - L / 2 - 2) < 1 && z > 4;
        let c = t === 1 ? (z === D + 1 ? IP.brassHi : mul(IP.walnutHi, 0.92 + hash3(u >> 3, z, 2) * 0.16)) : IP.walnutDark;
        if (crack) c = 0x1a100a;
        if (z === D + 1 && t === 0) c = IP.brass;
        // ring stains from glasses
        if (t === 1 && mod(u * 7 + z * 13, 97) < 2) c = mul(c, 0.7);
        m.set(u - L / 2, y, z - D / 2, c, z === D + 1 ? VF.METAL : 0);
      }
  }
  // brass foot rail on brackets
  for (let u = 2; u < L - 22; u++) {
    m.set(u - L / 2, 4, D / 2 + 3, u % 16 === 0 ? IP.brassHi : IP.brass, VF.METAL);
    if (u % 24 === 6) for (let k = 1; k <= 3; k++) m.set(u - L / 2, 4, D / 2 + k - 1, IP.brass, VF.METAL);
  }
  // splinters around the kicked-in panel + bottles visible inside it
  for (let y = 4; y < H - 7; y++) {
    if (hash3(y, 1, 1) > 0.4) m.set(L - 22 - L / 2, y, D / 2 - 1, 0xc8b08a);
    if (hash3(y, 2, 1) > 0.5) m.set(L - 8 - L / 2, y, D / 2 - 1, 0xc8b08a);
  }
  for (let i = 0; i < 4; i++) {
    const bx = L - 20 + i * 3 - L / 2;
    for (let y = 1; y < 8 + (i % 2) * 2; y++) m.set(bx, y, 0, y > 6 ? 0x2a3a24 : i % 2 ? 0x5a3418 : 0x3a5a3a, VF.METAL);
  }
  // cash register (brass) near the left end
  const cx = -L / 2 + 14, top = H - sag(14) + 2;
  for (let x = 0; x < 9; x++)
    for (let y = 0; y < 8; y++)
      for (let z = 0; z < 7; z++) {
        if (y > 4 && z < 3) continue;
        const keys = z === 6 && y < 4 && x > 0 && x < 8 && (x + y) % 2 === 0;
        m.set(cx + x, top + y, z - 3, keys ? 0xe8e0c8 : y === 7 || x === 0 || x === 8 ? IP.brassHi : IP.brass, VF.METAL);
      }
  for (let x = 1; x < 8; x++) m.set(cx + x, top + 8, -1, x % 2 ? IP.brassHi : IP.brass, VF.METAL);
  void r;
  return S(m, FVS);
}

/** back bar against the wall: cabinets (one door hanging), a counter, a big cracked mirror in a
 *  carved frame, shelves crammed with bottles (one shelf collapsed), crown moulding. 1/32.
 *  meta.mirror: mirror centre in metres (bottom-centre pivot). */
export function backBar(seed = 0): StaticModel & { meta: { mirror: V3; mirrorSize: [number, number] } } {
  const r = rngOf(seed, 2401);
  const m = new VoxelModel('back_bar');
  const W = 160, H = 86, D = 14;
  const x0 = -W / 2, x1 = W / 2 - 1;
  const wood = (x: number, y: number, z: number, base = IP.walnut) => wear(base, x, y, z, 0.05);
  // carcass: back panel, sides, lower cabinet
  for (let x = x0; x <= x1; x++)
    for (let y = 0; y < H; y++) {
      m.set(x, y, 0, wood(x, y, 0, mod(x, 8) === 0 ? IP.walnutDark : IP.walnut));
      if (x === x0 || x === x1 || x === x0 + 1 || x === x1 - 1) for (let z = 1; z < D; z++) m.set(x, y, z, wood(x, y, z, z === D - 1 ? IP.walnutHi : IP.walnut));
    }
  // lower cabinet with 4 doors (one hanging open)
  for (let x = x0 + 2; x <= x1 - 2; x++)
    for (let y = 0; y < 30; y++) {
      const dIdx = Math.floor((x - x0 - 2) / 39);
      const du = mod(x - x0 - 2, 39);
      const frame = du < 2 || du > 36 || y < 3 || y > 26;
      if (dIdx === 2 && !frame) continue; // open door: shows the dark inside
      m.set(x, y, D - 1, wood(x, y, D, frame ? IP.walnutDark : y === 4 || du === 2 ? IP.walnutHi : IP.walnut));
      if (!frame && du === 32 && y === 15) m.set(x, y, D, IP.brass, VF.METAL); // knob
    }
  // the hanging door (one hinge, swung out and tilted)
  {
    const hx = x0 + 2 + 2 * 39 + 2;
    for (let k = 0; k < 34; k++)
      for (let y = 3; y < 27; y++) {
        const yy = y - Math.floor(k * 0.12);
        m.set(hx, yy, D + k, wood(hx, yy, k, k === 33 || y === 3 || y === 26 ? IP.walnutDark : IP.walnut));
      }
  }
  // inside the open cabinet: jugs
  for (let i = 0; i < 3; i++) cylY(m, x0 + 82 + i * 9, D - 6, 1, 9 + i, 2.6, i % 2 ? 0x8a6a48 : 0x6a5038);
  // counter top
  for (let x = x0; x <= x1; x++) for (let z = 0; z < D + 2; z++) m.set(x, 30, z, z === D + 1 ? IP.walnutHi : wood(x, 30, z, IP.walnutDark));
  // mirror (centre), carved frame
  const mw = 54, mh = 36, mx0 = -mw / 2, my0 = 36;
  const hit: [number, number] = [8, 26]; // impact point (in mirror coords)
  for (let x = mx0 - 3; x < mx0 + mw + 3; x++)
    for (let y = my0 - 3; y < my0 + mh + 3; y++) {
      const inside = x >= mx0 && x < mx0 + mw && y >= my0 && y < my0 + mh;
      if (!inside) {
        m.set(x, y, 1, wood(x, y, 1, (x + y) % 5 === 0 ? IP.walnutDark : IP.walnutHi));
        m.set(x, y, 2, wood(x, y, 2, IP.walnut));
        continue;
      }
      const lx = x - mx0, ly = y - my0;
      // radial cracks from the impact
      const ang = Math.atan2(ly - hit[1], lx - hit[0]);
      const dd = Math.hypot(lx - hit[0], ly - hit[1]);
      let crack = false;
      for (const [ra, rl] of [[0.25, 30], [1.15, 18], [2.05, 26], [2.85, 12], [3.75, 22], [4.6, 34], [5.45, 15]] as const) {
        const da = Math.abs(mod(ang - ra + Math.PI, Math.PI * 2) - Math.PI);
        if (da * dd < 0.55 && dd < rl) crack = true;
      }
      if (Math.abs(dd - 5) < 0.45 && Math.sin(ang * 3) > -0.3) crack = true;
      if (dd < 1.5) crack = true;
      const silver = 0xb8c4c4;
      const grad = 0.82 + (ly / mh) * 0.2 - (lx / mw) * 0.06;
      m.set(x, y, 1, crack ? 0x3a4448 : mul(silver, grad), VF.METAL);
    }
  // shelves left and right of the mirror, crammed with bottles
  const glass = [0x3a5a2a, 0x5a3418, 0x8aa8a0, 0x2a3a4a, 0x7a2a1a, 0x9a7a3a];
  const shelfXs: [number, number][] = [[x0 + 3, mx0 - 5], [mx0 + mw + 4, x1 - 3]];
  shelfXs.forEach(([a, b], side) => {
    for (let level = 0; level < 3; level++) {
      const sy = 38 + level * 16;
      const collapsed = side === 1 && level === 1;
      for (let x = a; x <= b; x++) {
        const tilt = collapsed ? Math.round((x - a) * 0.22) : 0;
        for (let z = 1; z < D - 2; z++) m.set(x, sy - tilt, z, z === D - 3 ? IP.walnutHi : wood(x, sy, z, IP.walnutDark));
      }
      // bottles: hand-blown, mixed kinds; the collapsed shelf has them slid over and tipped
      const kinds: BottleKind[] = ['whiskey', 'wine', 'whiskey', 'tonic', 'flask', 'wine', 'broken'];
      for (let x = a + 3; x < b - 3; ) {
        const tilt = collapsed ? Math.round((x - a) * 0.22) : 0;
        const kind = kinds[r.int(0, kinds.length - 1)];
        const tipped = collapsed && r.chance(0.5);
        bottleShape(m, x, sy - tilt + 1, 6, kind, seed * 97 + level * 13 + x, tipped);
        x += tipped ? 12 : r.int(5, 7);
      }
    }
  });
  // crown moulding with dentils
  for (let x = x0 - 2; x <= x1 + 2; x++)
    for (let y = H; y < H + 5; y++) for (let z = 0; z < D + 2 - (H + 4 - y); z++) m.set(x, y, z, y === H + 1 && mod(x, 4) === 0 ? IP.walnutDark : y === H + 4 ? IP.walnutHi : IP.walnut);
  // fluted pilasters at the outer sides
  for (const px of [x0 - 1, x1 + 1]) for (let y = 30; y < H; y++) for (let z = 0; z < D + 1; z++) m.set(px, y, z, z === D && mod(y, 3) === 0 ? IP.walnutDark : z === D ? IP.walnutHi : IP.walnut);
  // brass candle sconces flanking the mirror
  for (const sx of [mx0 - 3, mx0 + mw + 2]) {
    for (let k = 0; k < 5; k++) m.set(sx, 52 - k, 2 + k, IP.brass, VF.METAL);
    m.box(sx - 1, 48, 6, sx + 1, 48, 8, IP.brassHi, VF.METAL);
    for (let y = 49; y < 53; y++) m.set(sx, y, 7, 0xe8dcc0);
  }
  // a mounted cattle skull on the crown
  const sk = cowSkullModel();
  sk.forEach((x, y, z, c, f) => m.set(x, H + 5 + y, D - 4 + z, c, f));
  // counter clutter: a pyramid of glasses, a decanter, a cash box, a bar towel
  for (let row = 0; row < 3; row++) for (let i = 0; i <= 2 - row; i++) lathe(m, -40 + i * 4 + row * 2, 8, 31 + row * 3, 33 + row * 3, () => 1.4, (_x, _y, _z, outer) => (outer ? 0xc8dcd8 : null), { hollow: true }, VF.METAL);
  lathe(m, -18, 8, 31, 38, (t) => (t < 0.6 ? 2.8 - t : 1.1), (_x, y, _z, outer) => (outer ? 0xb8d0c8 : y < 35 ? 0x9a4a18 : null), {}, VF.METAL);
  m.box(24, 31, 4, 33, 34, 11, 0x3a2414);
  m.box(24, 34, 4, 33, 34, 11, 0x5a3820);
  m.box(28, 32, 12, 29, 32, 12, IP.brassHi, VF.METAL);
  for (let x = 40; x < 50; x++) for (let z = 8; z < 14; z++) m.set(x, 31, z, mod(x, 3) ? 0xe4d8c0 : 0xb03a2a, VF.SOFTAO);
  const bb = m.bounds();
  const px = (bb.minX + bb.maxX + 1) / 2, pz = (bb.minZ + bb.maxZ + 1) / 2;
  const mirror: V3 = [(0 - px) * DVS, (my0 + mh / 2 - bb.minY) * DVS, (1 - pz) * DVS];
  return { model: m, voxelSize: DVS, meta: { mirror, mirrorSize: [mw * DVS, mh * DVS] } };
}

// ---------------------------------------------------------------------------
// furniture + clutter (1/32 unless noted)
// ---------------------------------------------------------------------------
/** rotate a model 90° about X (k quarter turns) and drop it onto y = 0 */
function rotX(src: VoxelModel, k: number) {
  const out = new VoxelModel(src.name);
  src.forEach((x, y, z, c, f) => {
    const [ny, nz] = mod(k, 4) === 1 ? [z, -y] : mod(k, 4) === 2 ? [-y, -z] : mod(k, 4) === 3 ? [-z, y] : [y, z];
    out.set(x, ny, nz, c, f);
  });
  return drop(out);
}
function rotZ(src: VoxelModel, k: number) {
  const out = new VoxelModel(src.name);
  src.forEach((x, y, z, c, f) => {
    const [nx, ny] = mod(k, 4) === 1 ? [-y, x] : mod(k, 4) === 2 ? [-x, -y] : mod(k, 4) === 3 ? [y, -x] : [x, y];
    out.set(nx, ny, z, c, f);
  });
  return drop(out);
}
function drop(m: VoxelModel) {
  const b = m.bounds();
  if (b.minY === 0) return m;
  const out = new VoxelModel(m.name);
  m.forEach((x, y, z, c, f) => out.set(x, y - b.minY, z, c, f));
  return out;
}

/** bentwood saloon chair; state 'up' | 'tipped' (on its back) | 'side' (on its side) | 'broken' (leg gone, leaning) */
export function saloonChair(seed = 0, state: 'up' | 'tipped' | 'side' | 'broken' = 'up'): StaticModel {
  const m = new VoxelModel('saloon_chair');
  const tone = [IP.walnut, 0x6a4a30, 0x5a3e28][mod(seed, 3)];
  const W = 14, sy = 14, bh = 30;
  const legs: [number, number][] = [[0, 0], [W - 2, 0], [0, W - 2], [W - 2, W - 2]];
  legs.forEach(([x, z], i) => {
    if (state === 'broken' && i === 3) {
      for (let y = 0; y < 5; y++) m.set(x, y, z, wear(tone, x, y, z), 0), m.set(x + 1, y, z, 0xc8b08a);
      return;
    }
    for (let y = 0; y < sy; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) m.set(x + a, y, z + b, wear(y === 0 ? IP.walnutDark : tone, x + a, y, z + b));
  });
  // stretchers
  for (let x = 1; x < W - 1; x++) m.set(x, 4, 0, tone).set(x, 4, W - 1, tone);
  // round-ish seat
  for (let x = -1; x <= W; x++) for (let z = -1; z <= W; z++) if (inCircle(x - W / 2 + 0.5, z - W / 2 + 0.5, W / 2 + 0.6)) m.set(x, sy, z, wear(mod(x + 1, 4) === 0 ? mul(tone, 0.8) : mul(tone, 1.15), x, sy, z, 0.04));
  // back: two posts + bent top rail + 3 spindles (top rail snapped on 'broken')
  for (const x of [0, W - 2]) for (let y = sy + 1; y < bh; y++) for (let a = 0; a < 2; a++) m.set(x + a, y, 0, wear(tone, x, y, 0));
  for (let x = 0; x < W; x++) if (!(state === 'broken' && x > W / 2)) for (let y = bh - 3; y < bh; y++) m.set(x, y, -Math.round(Math.sin((x / (W - 1)) * Math.PI) * 1.5), y === bh - 1 ? mul(tone, 1.2) : tone);
  for (const x of [4, 7, 10]) for (let y = sy + 1; y < bh - 3; y++) m.set(x, y, 0, mul(tone, 0.92));
  // pegged joints (lighter dowel ends), a carved notch pattern on the crest rail, worn seat front
  for (const [x, y, z] of [[0, 4, -1], [W - 2, 4, -1], [0, sy - 1, -1], [W - 2, sy - 1, -1], [-1, 4, 2], [W - 1, 4, 2]] as const) m.set(x, y, z, 0xa8805a);
  for (let x = 2; x < W - 2; x += 3) if (!(state === 'broken' && x > W / 2)) m.set(x, bh - 2, 1, mul(tone, 0.7));
  for (let x = 2; x < W - 2; x++) m.set(x, sy, W, mul(tone, 1.3));
  let out: VoxelModel = m;
  if (state === 'tipped') out = rotX(m, 1);
  else if (state === 'side') out = rotZ(m, 1);
  else if (state === 'broken') out = rotZ(m, 0);
  return S(out, DVS);
}

/** round card table; mode 'cards' (cards, chips, bottle, glasses, coins) | 'bare' | 'tipped' */
export function saloonTable(seed = 0, mode: 'cards' | 'bare' | 'tipped' = 'bare'): StaticModel {
  const r = rngOf(seed, 2503);
  const m = new VoxelModel('saloon_table');
  const R = 14, H = 23;
  // pedestal + 4 feet
  for (let y = 0; y < H; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) m.set(x, y, z, wear(y < 3 ? IP.walnutDark : IP.walnut, x, y, z));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 2; k < 9; k++) m.set(dx * k, k < 5 ? 1 : 0, dz * k, IP.walnutDark);
  // top with felt? no — worn wood with a darker rim
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      if (!inCircle(x, z, R)) continue;
      const rim = !inCircle(x, z, R - 1.5);
      m.set(x, H, z, rim ? IP.walnutDark : wear(mod(x, 5) === 0 ? mul(IP.walnutHi, 0.9) : IP.walnutHi, x, H, z, 0.05));
      m.set(x, H - 1, z, IP.walnutDark);
    }
  // apron ring under the top, a carved bead along the edge, glass rings, carved initials, a crack
  for (let a = 0; a < 80; a++) {
    const t = (a / 80) * Math.PI * 2;
    m.set(Math.round(Math.cos(t) * (R - 3)), H - 2, Math.round(Math.sin(t) * (R - 3)), IP.walnutDark);
    m.set(Math.round(Math.cos(t) * (R - 3)), H - 3, Math.round(Math.sin(t) * (R - 3)), IP.walnut);
    if (a % 2 === 0) m.set(Math.round(Math.cos(t) * R), H, Math.round(Math.sin(t) * R), IP.walnutHi);
  }
  for (let i = 0; i < 4; i++) {
    const cx = r.int(-9, 9), cz = r.int(-9, 9);
    for (let a = 0; a < 12; a++) m.set(cx + Math.round(Math.cos((a / 12) * 6.28) * 1.6), H, cz + Math.round(Math.sin((a / 12) * 6.28) * 1.6), 0x3a2010);
  }
  for (const [x, z] of [[-3, -8], [-3, -7], [-3, -6], [-2, -6], [0, -8], [0, -7], [0, -6], [1, -7], [2, -8], [2, -6]] as const) m.set(x, H, z, 0x1e1008);
  for (let k = 0; k < R; k++) m.set(k - 2, H, Math.round(k * 0.4) + 2, 0x140a04);
  if (mode === 'cards') {
    // cards (2×3), chips stacks, a bottle, glasses, coins
    for (let i = 0; i < 9; i++) {
      const x = r.int(-10, 8), z = r.int(-10, 8);
      const rot = r.chance(0.5);
      for (let a = 0; a < (rot ? 3 : 2); a++) for (let b = 0; b < (rot ? 2 : 3); b++) m.set(x + a, H + 1, z + b, (a + b === 1 && i % 2) ? 0xb02a1a : i % 3 === 0 && a + b === 2 ? 0x1a1a1a : 0xf0ece0);
    }
    const chip = [0xb02a1a, 0xe8e4d8, 0x2a4a8a];
    for (let i = 0; i < 5; i++) {
      const x = r.int(-8, 8), z = r.int(-8, 8), h = r.int(1, 4);
      for (let k = 0; k < h; k++) m.set(x, H + 1 + k, z, chip[(i + k) % 3]);
    }
    cylY(m, 6, 5, H + 1, H + 7, 1.6, 0x3a5a2a, VF.METAL);
    m.box(6, H + 8, 5, 6, H + 9, 5, 0x3a5a2a, VF.METAL);
    m.set(6, H + 10, 5, 0x7a5a3a);
    for (const [x, z] of [[-4, 6], [2, -7]]) m.box(x, H + 1, z, x + 1, H + 3, z + 1, IP.glass, VF.METAL);
    for (let i = 0; i < 6; i++) m.set(r.int(-9, 9), H + 1, r.int(-9, 9), 0xd8a840, VF.METAL);
  }
  let out: VoxelModel = m;
  if (mode === 'tipped') out = rotX(m, 1);
  return S(out, DVS);
}

/** broken glass on the floor: shards + a bottle neck — 1/48 */
export function brokenGlass(seed = 0): StaticModel {
  const r = rngOf(seed, 2603);
  const m = new VoxelModel('broken_glass');
  const cols = [0xaac8c0, 0x5a8a50, 0x8a5a2a, 0xd0e4e0];
  for (let i = 0; i < 26; i++) {
    const x = r.int(-22, 22), z = r.int(-16, 16), c = cols[r.int(0, 3)];
    const n = r.int(1, 4);
    for (let k = 0; k < n; k++) m.set(x + (k % 2), 0, z + Math.floor(k / 2), k === 0 ? mul(c, 1.25) : c, VF.METAL);
    if (r.chance(0.2)) m.set(x, 1, z, c, VF.METAL);
  }
  // a bottle neck with a jagged rim
  for (let k = 0; k < 7; k++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!(k === 6 && a + b === 1)) m.set(4 + k, a + 1, b - 1, 0x4a7a40, VF.METAL);
  return S(m, MVS);
}

/** sawdust drift with a darker trodden middle — 1/32 */
export function sawdust(seed = 0): StaticModel {
  const r = rngOf(seed, 2703);
  const m = new VoxelModel('sawdust');
  const R = 14 + r.int(0, 6);
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x * 0.8, z) + (hash3(x, 1, z) - 0.5) * 4;
      if (d > R) continue;
      const h = d < R * 0.35 ? 2 : 1;
      for (let y = 0; y < h; y++) m.set(x, y, z, hash3(x, y, z) > 0.8 ? 0x9a7a4a : d < R * 0.25 ? 0xa88a5a : IP.sawdust);
    }
  return S(m, DVS);
}

/** cobweb for a wall corner: radial threads + spiral, in the corner between +x and +z walls — 1/48 */
export function cobweb(seed = 0): StaticModel {
  const m = new VoxelModel('cobweb');
  const R = 22 + mod(seed, 3) * 4;
  // the web lies on the diagonal plane spanning (corner) → (x, y) and (z, y)
  const put = (a: number, y: number) => {
    // a: 0..R along the corner bisector outward, y downward
    const x = Math.round(a * 0.7071), z = Math.round(a * 0.7071);
    m.set(x, -y, z, IP.web, VF.SOFTAO);
  };
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * (Math.PI / 2);
    for (let k = 0; k < R; k++) {
      const u = Math.cos(t) * k, v = Math.sin(t) * k;
      if ((k + i) % 2 === 0 || k < 6) {
        // u along x-wall, v down
        m.set(Math.round(u * 0.9), -Math.round(v), Math.round(u * 0.25), IP.web, VF.SOFTAO);
        m.set(Math.round(u * 0.25), -Math.round(v), Math.round(u * 0.9), IP.web, VF.SOFTAO);
      }
    }
  }
  for (let ring = 4; ring < R; ring += 4)
    for (let a = 0; a <= 24; a++) {
      const t = (a / 24) * (Math.PI / 2);
      if ((a + ring) % 3 === 0) continue;
      put(Math.cos(t) * ring * 0.9, Math.round(Math.sin(t) * ring));
    }
  // a few loose strands drooping
  for (let k = 0; k < 10; k++) m.set(6, -R + 2 - k, 6, IP.web, VF.SOFTAO);
  return S(m, MVS);
}

/** playing cards + chips + a coin purse scattered on the floor — 1/48 */
export function cardScatter(seed = 0): StaticModel {
  const r = rngOf(seed, 2803);
  const m = new VoxelModel('card_scatter');
  for (let i = 0; i < 16; i++) {
    const x = r.int(-24, 22), z = r.int(-18, 18);
    const rot = r.chance(0.5);
    const face = r.chance(0.6);
    for (let a = 0; a < (rot ? 4 : 3); a++)
      for (let b = 0; b < (rot ? 3 : 4); b++) {
        let c = face ? 0xf0ece0 : (a + b) % 2 ? 0x8a2a1a : 0x6a1a10;
        if (face && a === 1 && b === 1) c = i % 2 ? 0xb02a1a : 0x1a1a1a;
        m.set(x + a, i % 4 === 0 ? 1 : 0, z + b, c);
      }
  }
  for (let i = 0; i < 10; i++) {
    const x = r.int(-20, 20), z = r.int(-14, 14);
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.set(x + a, 0, z + b, [0xb02a1a, 0xe8e4d8, 0x2a4a8a, 0xd8a840][i % 4], i % 4 === 3 ? VF.METAL : 0);
  }
  return S(m, MVS);
}

/** brass spittoon — 1/32 */
export function spittoon(): StaticModel {
  const m = new VoxelModel('spittoon');
  cylY(m, 0, 0, 0, 7, (t) => 3.2 + Math.sin(t * Math.PI) * 1.4 - t * 1.2, IP.brass, VF.METAL);
  cylY(m, 0, 0, 8, 8, 3.4, IP.brassHi, VF.METAL);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (inCircle(x, z, 2)) m.set(x, 8, z, 0x2a1a10);
  return S(m, DVS);
}

/** wall shelf (two boards on iron brackets) full of junk: jars, rusty tins, books, a skull,
 *  a lantern, rope, bottles. Back faces -Z (hang on a wall). */
export function junkShelf(seed = 0): StaticModel {
  const r = rngOf(seed, 2903);
  const m = new VoxelModel('junk_shelf');
  const W = 52, D = 9;
  for (const sy of [0, 18]) {
    for (let x = -W / 2; x < W / 2; x++) for (let z = 0; z < D; z++) m.set(x, sy, z, z === D - 1 ? IP.walnutHi : wear(IP.walnut, x, sy, z));
    for (const bx of [-W / 2 + 4, W / 2 - 5]) for (let k = 0; k < 6; k++) m.set(bx, sy - k, Math.min(D - 1, Math.floor(k * 1.2)), IP.iron, VF.METAL), m.set(bx, sy - 1 - k, 0, IP.iron, VF.METAL);
  }
  const items = (sy: number) => {
    for (let x = -W / 2 + 1; x < W / 2 - 4; ) {
      const kind = r.int(0, 6);
      const y0 = sy + 1;
      if (kind === 0) { // jar with pickled something
        cylY(m, x + 2, 4, y0, y0 + 6, 2, IP.glass, VF.METAL);
        for (let y = y0; y < y0 + 4; y++) m.set(x + 2, y, 4, 0x7a8a3a);
        cylY(m, x + 2, 4, y0 + 7, y0 + 7, 2, IP.iron, VF.METAL);
        x += 6;
      } else if (kind === 1) { // rusty tins
        for (let k = 0; k < 2; k++) cylY(m, x + 2 + k * 4, 4, y0, y0 + 4 + k, 1.6, k ? 0x8c5a34 : 0x9a8a6a, VF.METAL);
        x += 9;
      } else if (kind === 2) { // books leaning
        const n = r.int(2, 4);
        for (let k = 0; k < n; k++) for (let y = 0; y < 8 - (k % 2); y++) for (let z = 1; z < 7; z++) m.set(x + k * 2, y0 + y, z, [0x6a1a10, 0x2a3a5a, 0x3a4a2a, 0x5a3a1a][k % 4]), m.set(x + k * 2 + 1, y0 + y, z, [0x8a2a1a, 0x3a4a6a, 0x4a5a3a, 0x6a4a2a][k % 4]);
        x += n * 2 + 2;
      } else if (kind === 3) { // a small skull
        m.box(x, y0, 2, x + 4, y0 + 4, 6, 0xe8dcc0);
        m.set(x + 1, y0 + 2, 6, 0x2a1a10).set(x + 3, y0 + 2, 6, 0x2a1a10).set(x + 2, y0 + 1, 6, 0x4a3a2a);
        x += 7;
      } else if (kind === 4) { // lantern (unlit)
        lanternBody(m, x + 2, y0, 4, false);
        x += 7;
      } else if (kind === 5) { // rope coil
        for (let a = 0; a < 24; a++) {
          const t = (a / 24) * Math.PI * 2;
          m.set(x + 3 + Math.round(Math.cos(t) * 3), y0 + 3 + Math.round(Math.sin(t) * 3), 2 + (a % 2), a % 3 ? PR.rope.base : PR.rope.shade);
        }
        x += 8;
      } else { // bottles
        for (let k = 0; k < 2; k++) {
          const h = r.int(7, 10);
          for (let y = 0; y < h; y++) m.set(x + k * 3, y0 + y, 4, y > h * 0.65 ? 0x2a3a24 : k ? 0x5a3418 : 0x3a5a2a, VF.METAL), y <= h * 0.65 && m.set(x + k * 3 + 1, y0 + y, 4, k ? 0x6a4428 : 0x4a6a3a, VF.METAL);
        }
        x += 7;
      }
    }
  };
  items(0);
  items(18);
  return S(m, DVS);
}

/** lantern hanging on a chain (chain length in metres); meta.light: flame position (bottom-centre pivot is the lantern base) */
export function hangingLantern(chainM = 0.8, lit = true): StaticModel & { meta: { light: V3; top: number } } {
  const m = new VoxelModel('hanging_lantern');
  lanternBody(m, 0, 0, 0, lit);
  const n = Math.round(chainM / DVS);
  for (let k = 0; k < n; k++) m.set(0, 9 + k, 0, k % 2 ? IP.iron : IP.ironHi, VF.METAL);
  return { model: m, voxelSize: DVS, meta: { light: [0, 2.5 * DVS, 0], top: (9 + n) * DVS } };
}

/** old wagon-wheel chandelier with candle stubs (2 still burning), hanging crooked — 1/32 */
export function wheelChandelier(): StaticModel & { meta: { candles: V3[] } } {
  const m = new VoxelModel('wheel_chandelier');
  const R = 16;
  const candles: V3[] = [];
  for (let a = 0; a < 96; a++) {
    const t = (a / 96) * Math.PI * 2;
    for (let w = 0; w < 2; w++) m.set(Math.round(Math.cos(t) * (R - w)), 0, Math.round(Math.sin(t) * (R - w)), w ? IP.walnut : IP.iron, w ? 0 : VF.METAL);
  }
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    for (let k = 2; k < R - 1; k++) m.set(Math.round(Math.cos(t) * k), 0, Math.round(Math.sin(t) * k), IP.walnutDark);
    // candle stubs on the rim
    const cx = Math.round(Math.cos(t + 0.2) * (R - 1)), cz = Math.round(Math.sin(t + 0.2) * (R - 1));
    const h = 2 + (i % 3);
    for (let y = 1; y <= h; y++) m.set(cx, y, cz, 0xe8dcc0);
    if (i === 1 || i === 5) {
      m.set(cx, h + 1, cz, 0xffd27a, VF.GLOW);
      candles.push([cx * DVS, (h + 1.5) * DVS, cz * DVS]);
    } else for (let y = 0; y < 2; y++) m.set(cx + (i % 2), 1 - y, cz, 0xe8dcc0); // wax drips
  }
  m.box(-2, 0, -2, 2, 2, 2, IP.walnut);
  // three chains up to a hook (one snapped — the wheel hangs crooked)
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2;
    const ax = Math.round(Math.cos(t) * (R - 2)), az = Math.round(Math.sin(t) * (R - 2));
    const len = i === 2 ? 8 : 24;
    for (let k = 0; k < len; k++) m.set(Math.round(ax * (1 - k / 24)), k, Math.round(az * (1 - k / 24)), k % 2 ? IP.iron : IP.ironHi, VF.METAL);
  }
  for (let k = 24; k < 30; k++) m.set(0, k, 0, IP.iron, VF.METAL);
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2;
  return { model: m, voxelSize: DVS, meta: { candles: candles.map(([x, y, z]) => [x - px * DVS, y - b.minY * DVS, z - pz * DVS] as V3) } };
}

/** cast-iron pot-belly stove with a glowing grate, a kettle, the pipe up through the roof, and a coal scuttle — 1/24.
 *  meta.fire: grate position (metres, bottom-centre pivot). */
export function potBellyStove(pipeM = 3.6): StaticModel & { meta: { fire: V3 } } {
  const m = new VoxelModel('potbelly_stove');
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) m.box(x, 0, z, x, 2, z, IP.iron, VF.METAL);
  cylY(m, 0, 0, 3, 5, 5.6, IP.iron, VF.METAL);
  cylY(m, 0, 0, 6, 18, (t) => 5 + Math.sin(t * Math.PI) * 1.4, IP.iron, VF.METAL);
  cylY(m, 0, 0, 19, 20, 5.4, IP.ironHi, VF.METAL);
  // grate door glowing
  for (let x = -2; x <= 2; x++) for (let y = 7; y <= 11; y++) m.set(x, y, 6, (x + y) % 2 ? 0xff7a2a : 0xffb04a, VF.EMISSIVE);
  for (let x = -3; x <= 3; x++) m.set(x, 6, 6, IP.ironHi, VF.METAL).set(x, 12, 6, IP.ironHi, VF.METAL);
  // ornament band + embers glow through the seams
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    if (a % 5 === 0) m.set(Math.round(Math.cos(t) * 6.3), 14, Math.round(Math.sin(t) * 6.3), 0xff8a3a, VF.EMISSIVE);
  }
  // kettle
  cylY(m, 2, 0, 21, 24, (t) => 2.6 - t * 0.8, 0x5a5650, VF.METAL);
  seg(m, [4, 23, 0], [6, 24, 0], 1, 0x5a5650, VF.METAL);
  // pipe straight up
  const top = 21 + Math.round(pipeM / FVS);
  cylY(m, -2, 0, 21, top, 1.6, IP.iron, VF.METAL);
  for (let y = 30; y < top; y += 14) cylY(m, -2, 0, y, y, 2, IP.ironHi, VF.METAL);
  // coal scuttle + spilled coal
  for (let y = 0; y < 5; y++) for (let x = 7; x <= 11; x++) for (let z = -2; z <= 2; z++) if (x === 7 || x === 11 || z === -2 || z === 2 || y === 0) m.set(x, y, z, 0x4a4844, VF.METAL);
  for (let x = 8; x <= 10; x++) for (let z = -1; z <= 1; z++) m.set(x, 5, z, 0x1a1816);
  for (let i = 0; i < 6; i++) m.set(6 + (i % 3) * 2, 0, 4 + Math.floor(i / 3), 0x1a1816);
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2;
  return { model: m, voxelSize: FVS, meta: { fire: [(0 - px) * FVS, (9 - b.minY) * FVS, (7 - pz) * FVS] } };
}

/** whiskey keg — 1/24 */
export function keg(seed = 0): StaticModel {
  const m = new VoxelModel('keg');
  const H = 22, R = 8;
  for (let y = 0; y <= H; y++) {
    const t = y / H;
    const rr = R - 1.2 + Math.sin(t * Math.PI) * 1.6;
    const hoop = [2, Math.round(H / 2), H - 2].some((h) => Math.abs(y - h) <= 0);
    const RR = Math.ceil(rr) + 1;
    for (let x = -RR; x <= RR; x++)
      for (let z = -RR; z <= RR; z++) {
        if (!inCircle(x, z, rr)) continue;
        const outer = !inCircle(x, z, rr - 1);
        if (!outer && y !== H && y !== 0) continue;
        const a = Math.atan2(z, x);
        const stave = mod((a / (Math.PI * 2)) * 14, 1) < 0.1;
        let c = stave ? IP.walnutDark : wear(mod(seed, 2) ? IP.walnut : 0x7a5434, x, y, z, 0.06);
        if (hoop && outer) c = y === 2 ? IP.ironHi : IP.iron;
        if (y === H) c = mod(x, 4) === 0 ? IP.walnutDark : 0x8a6440;
        m.set(x, y, z, c, hoop && outer ? VF.METAL : 0);
      }
  }
  stampText(m, 'z+', 'XXX', -5, 15, Math.ceil(R + 0.5), { color: 0x2a1a10 });
  m.box(-1, 5, R + 1, 0, 6, R + 2, IP.brass, VF.METAL);
  return S(m, FVS);
}

/** dry grass tufts on dusty ground (for the street outside) — 1/32 */
export function grassTuft(seed = 0): StaticModel {
  const r = rngOf(seed, 3003);
  const m = new VoxelModel('grass_tuft');
  const n = 7 + r.int(0, 6);
  for (let i = 0; i < n; i++) {
    const bx = r.int(-5, 5), bz = r.int(-5, 5);
    const h = r.int(5, 12);
    const lean = r.range(-0.4, 0.4), leanZ = r.range(-0.4, 0.4);
    for (let y = 0; y < h; y++) m.set(bx + Math.round(lean * y), y, bz + Math.round(leanZ * y), y > h - 3 ? 0xd8c080 : y < 2 ? 0x8a7a40 : 0xb8a058);
  }
  return S(m, DVS);
}

/** plank boardwalk with posts and a step (street side) — 1/16, along X, length in metres */
export function boardwalk(lenM = 10, seed = 0): StaticModel {
  const m = new VoxelModel('boardwalk');
  const L = Math.round(lenM / RVS), D = 30;
  for (let x = 0; x < L; x++)
    for (let z = 0; z < D; z++) {
      const b = Math.floor(x / 3);
      if (mod(x, 3) === 0) {
        m.set(x, 4, z, IP.gap);
        continue;
      }
      const missing = hash3(b, 1, seed) > 0.93 && z > 8 && z < 20;
      if (missing) continue;
      m.set(x, 5, z, wear(mul(IP.greyBoard, 0.9 + hash3(b, 2, seed) * 0.2), x, 5, z, 0.05));
    }
  for (let x = 0; x < L; x += 32) for (const z of [0, D - 3]) post(m, x, z, 0, 5, 3, PR.woodGrey, x);
  for (let x = 0; x < L; x++) for (let z = D; z < D + 6; z++) if (z < D + 3) m.set(x, 2, z, IP.greyBoard);
  return S(m, RVS);
}

/** the dusty street outside the saloon's caved-in wall: flat packed dirt with wagon ruts, hoof prints,
 *  stones and sand drifted against the boardwalk. Spans x 0..-L (towards -X), z ±D/2. 1/8 m. */
export function streetGround(lenM = 16, widthM = 36): StaticModel {
  const m = new VoxelModel('street_ground');
  const L = Math.round(lenM * 8), D = Math.round(widthM * 8);
  for (let x = 0; x < L; x++)
    for (let z = -D / 2; z < D / 2; z++) {
      const rut = Math.abs(x - L * 0.42) < 1.2 || Math.abs(x - L * 0.42 - 9) < 1.2;
      const hoof = mod(x * 13 + z * 7, 41) === 0;
      let c = mixRGB(PR.sand.base, PR.wood.hi, 0.5);
      const band = hash3(Math.floor(x / 6), 2, Math.floor(z / 6));
      if (band < 0.25) c = mixRGB(PR.sand.shade, PR.wood.hi, 0.5);
      else if (band > 0.85) c = PR.sand.base;
      if (rut) c = mixRGB(PR.wood.base, PR.sand.shade, 0.4);
      if (hoof) c = PR.wood.base;
      if (hash3(x, 5, z) > 0.985) c = PR.stone.base;
      m.set(-x, 0, z, wear(c, x, 0, z, 0.04));
      m.set(-x, -1, z, PR.sand.shade);
    }
  return S(m, 1 / 8);
}

// ===========================================================================
// CRAFTED PIECES (1/32 and finer): joinery, carved trim, worn edges, brass,
// dents, cracks, glass rings, clutter. Organic, hand-made, asymmetric shapes.
// ===========================================================================

const CVS = 1 / 32; // crafted furniture
const SMV = 1 / 48; // small crafted objects

interface LatheOpts {
  sx?: number; // x squash (oval sections)
  sz?: number;
  tiltX?: number; // lean (voxels of offset per voxel of height)
  tiltZ?: number;
  dents?: { a: number; y0: number; y1: number; depth: number; width: number }[];
  hollow?: boolean; // keep only a 1-voxel skin (+ ends)
}
/** hand-turned round form: oval sections, lean, dents — never a perfect primitive */
function lathe(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, prof: (t: number) => number, col: (x: number, y: number, z: number, outer: boolean, ang: number, t: number) => number | null, o: LatheOpts = {}, flags = 0) {
  const sx = o.sx ?? 1, sz = o.sz ?? 1;
  for (let y = y0; y <= y1; y++) {
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const r = prof(t);
    if (r <= 0) continue;
    const ox = (o.tiltX ?? 0) * (y - y0), oz = (o.tiltZ ?? 0) * (y - y0);
    const R = Math.ceil(r * Math.max(sx, sz)) + 2;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const dx = (x - ox) / sx, dz = (z - oz) / sz;
        const d = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        let rr = r;
        for (const dn of o.dents ?? []) {
          if (y < dn.y0 || y > dn.y1) continue;
          const da = Math.abs(mod(ang - dn.a + Math.PI, Math.PI * 2) - Math.PI);
          if (da < dn.width) rr -= dn.depth * Math.cos((da / dn.width) * (Math.PI / 2)) * Math.sin(((y - dn.y0) / Math.max(1, dn.y1 - dn.y0)) * Math.PI);
        }
        if (d > rr + 0.35) continue;
        const outer = d > rr - 1.1;
        if (o.hollow && !outer && y !== y0 && y !== y1) continue;
        const c = col(x, y, z, outer, ang, t);
        if (c === null) continue;
        m.set(cx + x, y, cz + z, c, flags);
      }
  }
}

/** a hand-blown bottle (organic: off-centre neck, lean, wobble), standing or tipped (+x) */
export type BottleKind = 'whiskey' | 'wine' | 'flask' | 'jug' | 'tonic' | 'broken';
function bottleShape(m: VoxelModel, x0: number, y0: number, z0: number, kind: BottleKind, seed: number, tipped = false) {
  const r = rngOf(seed, 3101);
  const glass = { whiskey: 0x6a3a18, wine: 0x2e4a24, flask: 0x8aa8a0, jug: 0x9a7a5a, tonic: 0x3a4a6a, broken: 0x4a6a3a }[kind];
  const H = { whiskey: 11, wine: 13, flask: 8, jug: 10, tonic: 7, broken: 7 }[kind] + r.int(-1, 1);
  const body = { whiskey: 2.6, wine: 2.2, flask: 2.4, jug: 3.2, tonic: 1.7, broken: 2.3 }[kind];
  const neckStart = { whiskey: 0.62, wine: 0.55, flask: 0.7, jug: 0.75, tonic: 0.7, broken: 1 }[kind];
  const lean = r.range(-0.06, 0.06);
  const tmp = new VoxelModel('b');
  lathe(
    tmp, 0, 0, 0, H - 1,
    (t) => (t < neckStart ? body * (kind === 'wine' && t > neckStart - 0.15 ? 1 - (t - (neckStart - 0.15)) * 3 : 1) : kind === 'jug' ? 1.6 : 0.9 + (t > 0.95 ? 0.4 : 0)),
    (x, y, z, outer, _a, t) => {
      if (kind === 'broken' && t > 0.85 && hash3(x, y, z) > 0.4) return null; // jagged
      if (t < 0.05) return mul(glass, 0.75);
      if (kind !== 'jug' && t > 0.2 && t < 0.45 && outer && z >= 0) return hash3(Math.round(t * 9), 1, seed) > 0.85 ? IP.parchDark : IP.parch; // label (scuffed)
      if (kind === 'jug' && t > 0.3 && t < 0.4) return 0x5a3a24;
      if (t > 0.97) return kind === 'jug' ? 0x5a3a24 : 0x8a6440; // cork / stopper
      return outer && x <= -1 ? mul(glass, 1.3) : glass; // a highlight down one side
    },
    { sx: kind === 'flask' ? 1.25 : 1, sz: kind === 'flask' ? 0.6 : 1, tiltX: lean, dents: kind === 'jug' ? [] : [{ a: r.range(0, 6.28), y0: 1, y1: Math.round(H * 0.5), depth: 0.6, width: 0.5 }] }
  );
  if (kind === 'jug') for (let y = 3; y < H - 2; y++) tmp.set(3 + (y > 4 && y < H - 4 ? 1 : 0), y, 0, 0x8a6a4a); // handle
  tmp.forEach((x, y, z, c, f) => {
    if (tipped) m.set(x0 + y, y0 + Math.round(body) + x, z0 + z, c, f | VF.METAL);
    else m.set(x0 + x, y0 + y, z0 + z, c, f | VF.METAL);
  });
}

/** whiskey keg: bulging oval staves, a sprung stave, one dent, a slipped rusty hoop, head boards, bung + spigot — 1/32 */
export function kegCraft(seed = 0): StaticModel {
  const r = rngOf(seed, 3201);
  const m = new VoxelModel('keg');
  const H = 29, R = 9.6;
  const staves = 16;
  const sprung = r.int(0, staves - 1);
  const wood = mod(seed, 2) ? 0x7a5232 : 0x6a4628;
  const hoops = [3, 9, H - 9, H - 3];
  const slip = r.int(0, 3);
  lathe(
    m, 0, 0, 0, H,
    (t) => R - 1.6 + Math.sin(t * Math.PI) * 1.9,
    (x, y, z, outer, ang, t) => {
      const si = Math.floor(mod((ang / (Math.PI * 2)) * staves, staves));
      const seam = mod((ang / (Math.PI * 2)) * staves, 1) < 0.09;
      if (y === H) return mod(x, 5) === 0 ? 0x3a2414 : mul(0x8a6440, 0.95 + hash3(Math.floor(x / 5), 1, seed) * 0.1); // head boards
      if (y === 0) return 0x3a2414;
      if (!outer) return null;
      // hoops (one slipped and tilted)
      for (let h = 0; h < hoops.length; h++) {
        const hy = hoops[h] + (h === slip ? Math.round(Math.sin(ang) * 1.5) - 1 : 0);
        if (y === hy || y === hy + 1) return hash3(Math.round(ang * 8), y, seed) > 0.75 ? 0x7a4a2a : y === hy + 1 ? 0x5a5650 : 0x3e3c3a;
      }
      let c = mul(wood, 0.88 + hash3(si, 3, seed) * 0.24);
      if (seam) c = 0x2e1c10;
      if (si === sprung) c = mul(c, 1.25);
      return wear(c, x, y, z, 0.05);
    },
    { sz: 0.94, tiltX: r.range(-0.03, 0.03), dents: [{ a: r.range(0, 6.28), y0: 12, y1: 22, depth: 1.4, width: 0.45 }], hollow: true }
  );
  // the sprung stave sticks out
  {
    const a = ((sprung + 0.5) / staves) * Math.PI * 2;
    for (let y = 4; y < H - 4; y++) m.set(Math.round(Math.cos(a) * (R + 1)), y, Math.round(Math.sin(a) * (R + 1) * 0.94), 0x9a7048);
  }
  // rivets on the hoops
  for (const hy of hoops) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    m.set(Math.round(Math.cos(a) * (R + 0.4)), hy, Math.round(Math.sin(a) * (R + 0.4) * 0.94), 0x8a8680, VF.METAL);
  }
  // bung + cork on the head, spigot on the front, stencil
  m.box(3, H + 1, -2, 4, H + 1, -1, 0x9a7a4a);
  m.box(-1, 7, Math.ceil(R) + 1, 0, 8, Math.ceil(R) + 3, IP.brass, VF.METAL);
  m.set(-1, 6, Math.ceil(R) + 3, IP.brassHi, VF.METAL);
  stampText(m, 'z+', 'XXX', -5, 21, Math.ceil(R * 0.94) + 1, { color: 0x2a1a10 });
  return S(m, CVS);
}

/** bar stool: turned legs with rings, splayed, a brass foot ring, a tufted leather seat with brass nails;
 *  'torn' = gashed seat with stuffing poking out — 1/32 */
export function barStool(seed = 0, state: 'ok' | 'torn' = 'ok'): StaticModel {
  const r = rngOf(seed, 3301);
  const m = new VoxelModel('bar_stool');
  const H = 24; // seat top ≈ 0.78 m
  const legW = 0x5e3c22;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fx = Math.cos(a) * 6.4, fz = Math.sin(a) * 6.4, tx = Math.cos(a) * 3.6, tz = Math.sin(a) * 3.6;
    for (let y = 0; y < H - 2; y++) {
      const k = y / (H - 2);
      const x = Math.round(fx + (tx - fx) * k), z = Math.round(fz + (tz - fz) * k);
      // turned profile: rings at 1/3 and 2/3, a little foot
      const ring = Math.abs(y - 7) < 1 || Math.abs(y - 15) < 1;
      m.set(x, y, z, wear(y === 0 ? 0x2e1c10 : ring ? 0x7a5232 : legW, x, y, z, 0.06));
      if (ring || y < 2) for (const [dx, dz] of [[1, 0], [0, 1]]) m.set(x + dx, y, z + dz, ring ? 0x7a5232 : 0x2e1c10);
      m.set(x + 1, y, z, legW);
    }
  }
  // brass foot ring (dented on one side)
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    const rr = 5.4 - (a > 30 && a < 36 ? 0.6 : 0);
    m.set(Math.round(Math.cos(t) * rr), 7, Math.round(Math.sin(t) * rr), a % 8 === 0 ? IP.brassHi : IP.brass, VF.METAL);
  }
  // seat: wooden ring + tufted leather cushion
  lathe(m, 0, 0, H - 2, H - 1, () => 6.6, (x, y, z) => (y === H - 2 ? 0x4a2e1a : 0x5e3c22), { sx: 1, sz: 0.96 });
  const torn = state === 'torn';
  const gashA = r.range(0, 6.28);
  lathe(
    m, 0, 0, H, H + 2,
    (t) => 6.2 - t * 1.6,
    (x, y, z, outer, ang, t) => {
      const d = Math.hypot(x, z);
      const tuft = (mod(Math.round(x + 9), 3) === 0 && mod(Math.round(z + 9), 3) === 0 && d < 5) ? 0x3a1a10 : null; // buttons
      if (torn && Math.abs(mod(ang - gashA + Math.PI, Math.PI * 2) - Math.PI) < 0.35 && d > 1.5) return y === H + 2 || t > 0.4 ? null : 0xe8dcc0; // gash: stuffing
      if (tuft && y === H + 2) return tuft;
      return wear(y === H + 2 && !outer ? 0x7a2a1a : 0x5e2014, x, y, z, 0.07);
    },
    {}
  );
  if (torn) for (let k = 0; k < 6; k++) m.set(Math.round(Math.cos(gashA) * (2 + k * 0.6)), H + 3 + (k % 2), Math.round(Math.sin(gashA) * (2 + k * 0.6)), 0xf0e6d0); // stuffing tufts
  // brass nail heads round the seat rim
  for (let a = 0; a < 20; a++) {
    const t = (a / 20) * Math.PI * 2;
    m.set(Math.round(Math.cos(t) * 6.6), H, Math.round(Math.sin(t) * 6.6 * 0.96), IP.brassHi, VF.METAL);
  }
  return S(m, CVS);
}

/** upright piano: carved case with scroll cheeks, raised panels, brass candle sconces, yellowed keys
 *  (some missing), an open fallboard, sheet music, a cracked side, clutter on top — 1/32. Front faces +Z. */
export function uprightPiano(seed = 0): StaticModel & { meta: { top: number } } {
  const r = rngOf(seed, 3401);
  const m = new VoxelModel('upright_piano');
  const W = 48, H = 42, D = 19;
  const x0 = -W / 2, x1 = W / 2 - 1;
  const case_ = 0x3e2416, caseHi = 0x5a3820, caseDark = 0x22140a;
  // carcass (shell)
  for (let x = x0; x <= x1; x++)
    for (let y = 2; y <= H; y++)
      for (let z = 0; z < D - 8; z++) {
        const shell = x === x0 || x === x1 || y === H || z === 0 || z === D - 9;
        if (!shell) continue;
        m.set(x, y, z, wear(z === D - 9 ? case_ : caseDark, x, y, z, 0.05));
      }
  // front panels (upper + lower) with carved frames and a centre rosette
  const panel = (px0: number, px1: number, py0: number, py1: number, zf: number) => {
    for (let x = px0; x <= px1; x++)
      for (let y = py0; y <= py1; y++) {
        const edge = x === px0 || x === px1 || y === py0 || y === py1;
        const bevelHi = x === px0 + 1 || y === py1 - 1;
        const bevelLo = x === px1 - 1 || y === py0 + 1;
        m.set(x, y, zf, edge ? caseDark : bevelHi ? caseHi : bevelLo ? caseDark : wear(case_, x, y, zf, 0.04));
      }
    const cx = Math.round((px0 + px1) / 2), cy = Math.round((py0 + py1) / 2);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2], [-2, -2], [2, -2], [-2, 2]]) m.set(cx + dx, cy + dy, zf + 1, dx === 0 && dy === 0 ? IP.brassHi : caseHi);
  };
  panel(x0 + 3, -2, 24, H - 3, D - 8);
  panel(1, x1 - 3, 24, H - 3, D - 8);
  panel(x0 + 3, x1 - 3, 4, 12, D - 8);
  // key bed + keys (yellowed ivory, black sharps, some missing / chipped)
  for (let x = x0 + 2; x <= x1 - 2; x++)
    for (let z = D - 8; z < D; z++) {
      m.set(x, 14, z, caseDark);
      m.set(x, 15, z, case_);
    }
  for (let x = x0 + 3; x <= x1 - 3; x++) {
    const missing = hash3(x, 1, seed) > 0.93;
    const white = mod(x - x0, 2) === 0 ? 0xe8dcb8 : 0xd8c8a0;
    for (let z = D - 7; z < D - 1; z++) if (!missing) m.set(x, 16, z, z === D - 2 ? mul(white, 0.85) : white);
    const oct = mod(x - x0 - 3, 14);
    if ([1, 3, 7, 9, 11].includes(oct) && !missing) for (let z = D - 7; z < D - 4; z++) m.set(x, 17, z, 0x1a1410);
  }
  // fallboard (open, leaning back) + music desk with sheet music
  for (let x = x0 + 2; x <= x1 - 2; x++) for (let y = 17; y <= 21; y++) m.set(x, y, D - 9 - (y - 17 > 2 ? 1 : 0), y === 21 ? caseHi : case_);
  for (let x = -10; x <= 9; x++) for (let y = 22; y <= 31; y++) if ((x < -1 || x > 0) && !(x > 6 && y > 29)) m.set(x, y, D - 7, (y - 22) % 2 === 0 && Math.abs(x) % 4 !== 0 ? 0x9a8a6a : IP.parch);
  // scroll cheeks + carved legs
  for (const sx of [x0 - 1, x1 + 1]) {
    for (let y = 0; y <= 16; y++) for (let z = D - 9; z < D; z++) {
      const curl = y > 12 && z > D - 5 ? (z - (D - 5)) > (16 - y) : false;
      if (curl) continue;
      m.set(sx, y, z, y < 3 ? caseDark : z === D - 1 ? caseHi : case_);
    }
    for (let k = 0; k < 4; k++) m.set(sx, 14 + k, D - 3 + Math.round(k * 0.5), caseHi); // the scroll
  }
  // brass candle sconces with stubs (one candle snapped)
  for (const [sx, h] of [[x0 + 6, 5], [x1 - 6, 2]] as const) {
    for (let k = 0; k < 4; k++) m.set(sx, 30 - k, D - 8 + k, IP.brass, VF.METAL);
    m.box(sx - 1, 27, D - 4, sx + 1, 27, D - 2, IP.brassHi, VF.METAL);
    for (let y = 28; y < 28 + h; y++) m.set(sx, y, D - 3, 0xe8dcc0);
    m.set(sx + 1, 27, D - 2, 0xe8dcc0); // wax drip
  }
  // crack down the right side + a chipped top corner
  for (let y = 4; y < H - 4; y++) m.set(x1, y, 4 + Math.round(Math.sin(y * 0.4) * 1.5) + 2, 0x0e0806);
  for (let k = 0; k < 3; k++) m.del(x0 + k, H, D - 9).del(x0, H - k, D - 9);
  // top: a lid moulding + clutter (bottle, glass, ashtray, a framed photo)
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = -1; z < D - 7; z++) m.set(x, H + 1, z, z === D - 8 ? caseHi : case_);
  bottleShape(m, x0 + 8, H + 2, 5, 'whiskey', seed + 1);
  m.box(x0 + 14, H + 2, 6, x0 + 15, H + 4, 7, IP.glass, VF.METAL);
  lathe(m, x1 - 10, 5, H + 2, H + 3, (t) => 2.6 - t, (x, y) => (y === H + 3 ? 0x2a2420 : 0x5a5650), {});
  for (let x = 0; x < 6; x++) for (let y = 0; y < 7; y++) m.set(-4 + x, H + 2 + y, 2 + Math.round(y * 0.3), x === 0 || x === 5 || y === 0 || y === 6 ? IP.brass : (x + y) % 3 ? 0x6a5a4a : 0x8a7a6a, x === 0 || x === 5 || y === 0 || y === 6 ? VF.METAL : 0);
  void r;
  return { model: m, voxelSize: CVS, meta: { top: (H + 2) * CVS } };
}

/** gramophone: walnut box with a crank, a record on the turntable, tone arm, and a big flared
 *  petal horn curving up — 1/48 */
export function gramophoneCraft(): StaticModel {
  const m = new VoxelModel('gramophone');
  const B = 14;
  for (let x = -B; x <= B; x++)
    for (let y = 0; y <= 10; y++)
      for (let z = -B; z <= B; z++) {
        const shell = Math.abs(x) === B || Math.abs(z) === B || y === 0 || y === 10;
        if (!shell) continue;
        const trim = y === 10 || y === 0 || y === 1;
        m.set(x, y, z, trim ? 0x3a2212 : wear(mod(x + z, 6) === 0 ? 0x5a3820 : 0x6e4428, x, y, z, 0.05));
      }
  for (let x = -B + 3; x <= B - 3; x++) for (let y = 3; y <= 7; y++) if (Math.abs(x) === B - 3 || y === 3 || y === 7) m.set(x, y, B + 1, IP.brass, VF.METAL);
  // turntable + record with grooves + label
  lathe(m, 0, 0, 11, 11, () => 11, (x, y, z) => {
    const d = Math.hypot(x, z);
    return d < 3 ? 0xb02a1a : mod(Math.round(d * 2), 3) === 0 ? 0x2a2624 : 0x141210;
  }, {});
  m.set(0, 12, 0, IP.brassHi, VF.METAL);
  // crank
  for (let k = 0; k < 6; k++) m.set(B + 1 + k, 6, 2, 0x5a5650, VF.METAL);
  m.box(B + 6, 6, 2, B + 6, 9, 2, 0x5a5650, VF.METAL);
  m.box(B + 6, 10, 1, B + 6, 11, 3, 0x2a1a10);
  // tone arm (bent) + the horn: curved path rising and flaring into petals
  for (let k = 0; k < 10; k++) m.set(-8 + Math.round(k * 0.4), 13 + Math.round(k * 0.3), -9 + k, IP.brass, VF.METAL);
  const path: [number, number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    path.push([-6 - Math.sin(t * 1.2) * 4, 14 + t * 30, -10 + Math.sin(t * Math.PI * 0.8) * -6 + t * 6]);
  }
  path.forEach(([px, py, pz], i) => {
    const t = i / 40;
    const rr = 1.2 + Math.pow(t, 3.2) * 15;
    const R = Math.ceil(rr) + 1;
    for (let a = -R; a <= R; a++)
      for (let b = -R; b <= R; b++) {
        const d = Math.hypot(a, b);
        if (d > rr || d < rr - (t > 0.8 ? 1.2 : 1.6)) continue;
        // petals: 8 lobes with dark seams, a brass rim at the mouth
        const ang = Math.atan2(b, a);
        const seam = t > 0.5 && mod((ang / (Math.PI * 2)) * 8, 1) < 0.08;
        const c = i >= 39 ? IP.brassHi : seam ? 0x6a3a1a : t > 0.5 ? (mod(Math.floor((ang / (Math.PI * 2)) * 8), 2) ? 0xa85a2a : 0x8a4420) : IP.brass;
        m.set(Math.round(px + a), Math.round(py + b * 0.35), Math.round(pz + b * 0.94), c, t <= 0.5 || i >= 39 ? VF.METAL : 0);
      }
  });
  return S(m, SMV);
}

/** gunsmith's workbench: thick dinged top with a vise and clamps, drawers with brass pulls, a lower shelf
 *  with tool boxes, a back board of hanging tools, cartridges, rags, an oil can and a cleaning rod — 1/32.
 *  Front faces +Z. meta.top: work-surface height (m). */
export function workbenchCraft(seed = 0): StaticModel & { meta: { top: number } } {
  const r = rngOf(seed, 3501);
  const m = new VoxelModel('workbench');
  const W = 56, D = 22, T = 28;
  const wood = 0x7a5434, woodDark = 0x4a3020, woodHi = 0x946a44;
  // legs (heavy, chamfered) + stretchers with pegged joints
  for (const [x, z] of [[-W / 2, 0], [W / 2 - 3, 0], [-W / 2, D - 3], [W / 2 - 3, D - 3]]) {
    for (let y = 0; y < T; y++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (!(a !== 1 && b !== 1 && (y < 1 || y > T - 2))) m.set(x + a, y, z + b, wear(a === 1 && b === 1 ? woodDark : wood, x + a, y, z + b, 0.05));
  }
  for (const y of [4, 5]) {
    for (let x = -W / 2; x < W / 2; x++) m.set(x, y, 1, woodDark).set(x, y, D - 2, woodDark);
    for (let z = 0; z < D; z++) m.set(-W / 2 + 1, y, z, woodDark).set(W / 2 - 2, y, z, woodDark);
  }
  for (const [x, z] of [[-W / 2 + 1, -1], [W / 2 - 2, -1]]) m.set(x, 5, z, woodHi); // pegs
  // lower shelf with two tool boxes + a cartridge crate
  for (let x = -W / 2 + 3; x < W / 2 - 3; x++) for (let z = 3; z < D - 3; z++) m.set(x, 6, z, mod(x, 5) === 0 ? woodDark : wood);
  m.box(-20, 7, 5, -9, 12, 14, 0x5a2a1a);
  m.box(-20, 12, 5, -9, 12, 14, 0x6a3a22);
  m.box(-16, 13, 9, -13, 13, 10, IP.iron, VF.METAL);
  m.box(6, 7, 6, 16, 11, 15, 0x8a6440);
  stampText(m, 'z+', 'AMMO', 6, 10, 16, { color: 0x2a1a10 });
  // drawers under the top (one hanging open)
  for (let i = 0; i < 3; i++) {
    const dx0 = -W / 2 + 4 + i * 17;
    const open = i === 1 ? 4 : 0;
    for (let x = dx0; x < dx0 + 15; x++) for (let y = T - 6; y < T - 1; y++) m.set(x, y, D - 1 + open, x === dx0 || x === dx0 + 14 || y === T - 6 ? woodDark : wood);
    m.box(dx0 + 6, T - 4, D + open, dx0 + 8, T - 4, D + open, IP.brassHi, VF.METAL);
    if (open) for (let x = dx0 + 2; x < dx0 + 13; x += 3) m.set(x, T - 2, D + 1, 0xc8a040, VF.METAL); // bullets in the drawer
  }
  // the top: 4 thick planks, dings, a burn, oil stains
  for (let x = -W / 2 - 2; x < W / 2 + 2; x++)
    for (let z = -1; z < D + 1; z++)
      for (let t = 0; t < 2; t++) {
        let c = t === 1 ? mul(woodHi, 0.9 + hash3(Math.floor(z / 6), 1, seed) * 0.2) : woodDark;
        if (t === 1 && mod(z + 1, 6) === 0) c = woodDark;
        if (t === 1 && hash3(x, z, 7) > 0.97) c = mul(c, 0.7); // dings
        if (t === 1 && Math.hypot(x - 14, z - 8) < 3) c = mixRGB(c, 0x2a1a10, 0.6); // oil stain
        m.set(x, T + t, z, c);
      }
  // vise on the left corner
  m.box(-W / 2 - 4, T - 2, D - 4, -W / 2 + 2, T + 4, D + 2, 0x3a4048, VF.METAL);
  m.box(-W / 2 - 4, T + 2, D + 3, -W / 2 + 2, T + 4, D + 4, 0x4a5058, VF.METAL);
  for (let k = 0; k < 8; k++) m.set(-W / 2 - 1, T + 1, D + 5 + k, 0x5a5650, VF.METAL); // screw handle
  // back board with hanging tools
  for (let x = -W / 2; x < W / 2; x++) for (let y = T + 2; y < T + 30; y++) m.set(x, y, -2, mod(y, 5) === 0 ? woodDark : wear(0x6a4a30, x, y, 2, 0.05));
  const hang = (x: number, y: number, tool: string[], cols: Record<string, number>) => {
    tool.forEach((row, i) => [...row].forEach((ch, j) => ch !== '.' && m.set(x + j, y - i, -1, cols[ch], ch === 'i' ? VF.METAL : 0)));
    m.set(x + Math.floor(tool[0].length / 2), y + 1, -1, IP.iron, VF.METAL);
  };
  hang(-24, T + 26, ['iii', '.w.', '.w.', '.w.', '.w.', '.w.'], { i: 0x5a5650, w: 0x8a5a30 }); // hammer
  hang(-18, T + 26, ['wwiiiiiii', 'ww.iiiiii', '....iiiii'], { i: 0x8a8680, w: 0x7a4a24 }); // saw
  hang(-5, T + 26, ['i.i', 'i.i', '.i.', 'w.w', 'w.w', 'w.w'], { i: 0x5a5650, w: 0xa83a2a }); // pliers
  hang(2, T + 26, ['iii', 'i.i', '.i.', '.i.', '.i.', '.i.', 'iii'], { i: 0x6a6660 }); // wrench
  hang(10, T + 25, ['wwwwwwiiiiiiii'], { i: 0x3a3836, w: 0x7a4a24 }); // cleaning rod
  hang(18, T + 26, ['.ii.', 'iiii', 'i..i', 'iiii'], { i: 0x6a5a40 }); // horseshoe
  // on the top: cartridges, a rag, an oil can, a gun box, a coffee tin of screws
  for (let i = 0; i < 9; i++) {
    const x = r.int(-W / 2 + 6, W / 2 - 6), z = r.int(2, D - 3);
    m.set(x, T + 2, z, 0xc89a40, VF.METAL).set(x, T + 3, z, 0x8a6a40, VF.METAL);
  }
  for (let x = -4; x <= 3; x++) for (let z = 10; z <= 15; z++) if (hash3(x, 2, z) > 0.2) m.set(x, T + 2 + (x === 0 ? 1 : 0), z, mod(x + z, 3) ? 0xa83a2a : 0xd8c8b0); // rag
  lathe(m, 20, 8, T + 2, T + 8, (t) => 2.6 - t * 1.2, (_x, y) => (y > T + 6 ? 0x6a2a1a : 0xb0402a), { dents: [{ a: 1, y0: T + 3, y1: T + 6, depth: 0.7, width: 0.6 }] }, VF.METAL);
  seg(m, [20, T + 8, 8], [25, T + 12, 8], 1, 0x6a2a1a, VF.METAL);
  m.box(-18, T + 2, 3, -8, T + 5, 10, 0x4a2e1c);
  m.box(-17, T + 5, 4, -9, T + 5, 9, 0x2a3a2a);
  lathe(m, -22, 16, T + 2, T + 6, () => 2.2, (_x, y) => (y === T + 6 ? 0x8a8680 : 0x9a5a30), {}, VF.METAL);
  return { model: m, voxelSize: CVS, meta: { top: (T + 2) * CVS } };
}

/** notice board: plank board on posts under a little shingle roof, pinned notices / wanted posters /
 *  a map with red string, a painted RIDE OUT header, bullet holes — 1/32. Front faces +Z. */
export function noticeBoardCraft(seed = 0): StaticModel {
  const r = rngOf(seed, 3601);
  const m = new VoxelModel('notice_board');
  const W = 40, B0 = 18, B1 = 52;
  for (const x of [-W / 2 - 3, W / 2]) post(m, x, -1, 0, B1 + 6, 3, PR.woodDark, x);
  // board
  for (let x = -W / 2; x < W / 2; x++)
    for (let y = B0; y <= B1; y++) {
      const c = mod(y - B0, 6) === 0 ? 0x4a3220 : wear(mul(0x8a6a48, 0.9 + hash3(Math.floor((y - B0) / 6), 1, seed) * 0.2), x, y, 1, 0.05);
      m.set(x, y, 0, c).set(x, y, -1, 0x5a4028);
    }
  // frame
  for (let x = -W / 2 - 1; x <= W / 2; x++) for (const y of [B0 - 1, B1 + 1]) m.set(x, y, 1, 0x3a2414);
  for (let y = B0 - 1; y <= B1 + 1; y++) for (const x of [-W / 2 - 1, W / 2]) m.set(x, y, 1, 0x3a2414);
  // little roof
  for (let x = -W / 2 - 5; x <= W / 2 + 4; x++)
    for (let k = 0; k < 8; k++) {
      const y = B1 + 7 - Math.round(k * 0.6), z = -3 + k;
      m.set(x, y, z, mod(x + (k % 2) * 2, 5) === 0 ? 0x3a2414 : k % 2 ? 0x6a4428 : 0x7a5232);
    }
  // header plank
  for (let x = -16; x <= 15; x++) for (let y = B1 - 7; y <= B1 - 1; y++) m.set(x, y, 1, y === B1 - 7 || y === B1 - 1 ? 0x4a3220 : 0xc0a070);
  stampText(m, 'z+', 'RIDE OUT', -15, B1 - 2, 2, { color: 0x6a1a10 });
  // pinned notices: wanted posters, a list, a torn one, the map with red string
  const notes: [number, number, number, number, string][] = [[-18, B0 + 14, 10, 13, 'wanted'], [-6, B0 + 16, 9, 11, 'list'], [5, B0 + 15, 12, 10, 'map'], [-17, B0 + 2, 9, 10, 'torn'], [-5, B0 + 2, 10, 12, 'wanted'], [8, B0 + 2, 9, 10, 'list']];
  for (const [nx, ny, nw, nh, kind] of notes) {
    for (let x = nx; x < nx + nw; x++)
      for (let y = ny; y < ny + nh; y++) {
        if (kind === 'torn' && y > ny + nh - 4 && x > nx + 4) continue;
        let c = IP.parch;
        if (kind === 'wanted') {
          if (y === ny + nh - 2) c = 0x6a1a10;
          else if (y > ny + 3 && y < ny + nh - 3 && x > nx + 1 && x < nx + nw - 2) c = (x + y) % 3 ? 0x8a7450 : 0x6a5438;
        } else if (kind === 'list') {
          if (mod(y - ny, 2) === 1 && x > nx && x < nx + nw - 1 - ((y * 3) % 3)) c = 0x5a4a3a;
        } else if (kind === 'map') {
          c = hash3(Math.floor(x / 3), Math.floor(y / 3), 9) > 0.5 ? 0xd8c090 : 0xc8ae78;
        }
        m.set(x, y, 1, mul(c, 0.94 + hash3(x, y, 3) * 0.1));
      }
    m.set(nx + Math.floor(nw / 2), ny + nh - 1, 2, kind === 'map' ? 0xb02a1a : IP.iron, VF.METAL);
  }
  // red string across the map between pins
  const pins: [number, number][] = [[7, B0 + 22], [13, B0 + 18], [9, B0 + 16], [15, B0 + 23]];
  for (const [px, py] of pins) m.set(px, py, 2, 0xe02a1a);
  for (let i = 0; i < pins.length - 1; i++) {
    const [ax, ay] = pins[i], [bx, by] = pins[i + 1];
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k <= n; k++) m.set(Math.round(ax + ((bx - ax) * k) / n), Math.round(ay + ((by - ay) * k) / n), 2, 0xb02a1a);
  }
  // bullet holes + a knife stuck in the board
  for (let i = 0; i < 5; i++) bulletHole(m, r.int(-W / 2 + 2, W / 2 - 3), r.int(B0 + 1, B1 - 9), 1, 0xb09070);
  seg(m, [17, B0 + 9, 2], [17, B0 + 9, 6], 1, 0x8a8680, VF.METAL);
  m.box(16, B0 + 8, 6, 18, B0 + 10, 7, 0x4a2a14);
  return S(m, CVS);
}

/** dartboard: bristle rings with wire, three darts stuck in it, nailed to a plank with a chalk tally board — 1/48 */
export function dartboardCraft(): StaticModel {
  const m = new VoxelModel('dartboard');
  const R = 17;
  // backing plank
  for (let x = -24; x <= 24; x++) for (let y = -34; y <= 22; y++) m.set(x, y, -2, mod(x + 30, 7) === 0 ? 0x3a2414 : wear(0x6a4a30, x, y, 1, 0.05));
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const d = Math.hypot(x, y);
      if (d > R + 0.4) continue;
      const seg20 = Math.floor(mod(Math.atan2(y, x) / (Math.PI * 2) * 20 + 0.5, 20));
      let c = seg20 % 2 ? 0x1e1a16 : 0xe0d2b0;
      if (d > R - 3) c = 0x2a2420; // number ring
      else if (Math.abs(d - (R - 4)) < 1) c = seg20 % 2 ? 0xb02a1a : 0x2a6a3a; // double
      else if (Math.abs(d - R * 0.5) < 0.9) c = seg20 % 2 ? 0xb02a1a : 0x2a6a3a; // treble
      if (d < 2.2) c = 0xb02a1a;
      if (d < 1.1) c = 0x2a6a3a;
      if (mod(Math.atan2(y, x) / (Math.PI * 2) * 20 + 0.5, 1) < 0.06 && d > 2 && d < R - 3) c = 0xa8a8a0; // wire
      m.set(x, y, 0, wear(c, x, y, 0, 0.04)).set(x, y, -1, 0x2a2420);
      if (d > R - 3 && d < R - 2 && mod(seg20, 2) === 0 && mod(Math.round(Math.atan2(y, x) * 9), 3) === 0) m.set(x, y, 1, 0xd8d0c0); // numbers
    }
  // darts: tips buried, barrels + coloured flights sticking out
  for (const [x, y, col] of [[3, 2, 0xb02a1a], [-6, -4, 0x2a5a9a], [9, -9, 0xd8a840]] as const) {
    for (let k = 1; k <= 6; k++) m.set(x, y + Math.round(k * 0.2), k, k < 4 ? 0x8a8680 : 0x3a3836, VF.METAL);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(x + a, y + 1 + b, 7, col);
  }
  // chalk tally board below
  for (let x = -16; x <= 16; x++) for (let y = -33; y <= -21; y++) m.set(x, y, -1, x === -16 || x === 16 || y === -33 || y === -21 ? 0x5a3a20 : 0x1e2420);
  for (let g = 0; g < 4; g++) {
    for (let k = 0; k < 4; k++) for (let y = -31; y <= -26; y++) m.set(-13 + g * 7 + k, y, 0, 0xd8d8d0);
    if (g < 3) for (let k = 0; k < 5; k++) m.set(-13 + g * 7 + k, -31 + k, 0, 0xd8d8d0);
  }
  return S(m, SMV);
}

/** Thoth's codex: a thick leather tome with brass corners and clasp, an embossed ibis eye, ribbon,
 *  page block, beside a candle stub and reading spectacles — 1/48 */
export function codexTome(): StaticModel {
  const m = new VoxelModel('codex');
  const W = 16, D = 22, H = 7;
  for (let x = -W; x <= W; x++)
    for (let z = -D / 2; z <= D / 2; z++)
      for (let y = 0; y <= H; y++) {
        const cover = y === 0 || y === H || x === -W;
        const pages = !cover && x > -W && x < W && Math.abs(z) < D / 2;
        if (!cover && !pages) continue;
        let c = cover ? wear(0x5a2414, x, y, z, 0.06) : (y % 2 ? 0xe8dcc0 : 0xd8c8a0);
        if (cover && (Math.abs(x) > W - 3 && Math.abs(z) > D / 2 - 3)) c = IP.brassHi; // corners
        if (cover && x === -W && y > 1 && y < H - 1 && mod(z, 4) === 0) c = 0x3a1408; // spine bands
        m.set(x, y, z, c, c === IP.brassHi ? VF.METAL : 0);
      }
  // embossed ibis eye on the cover
  const eye = ['..gggg..', '.g....g.', 'g..gg..g', '.g....g.', '..gggg..', '...g....', '...g.g..'];
  eye.forEach((row, i) => [...row].forEach((ch, j) => ch === 'g' && m.set(-4 + j, H + 1, 3 - i, IP.brass, VF.METAL)));
  // clasp + ribbon
  m.box(W - 1, 2, -2, W + 1, H, 2, IP.brass, VF.METAL);
  for (let k = 0; k < 8; k++) m.set(2 + (k % 2), 1 - (k > 3 ? 1 : 0), D / 2 + 1 + Math.floor(k / 2), 0xa82a1a);
  // candle stub on a dish + spectacles
  lathe(m, W + 9, -6, 0, 1, () => 4, () => 0x8a6a3a, {}, VF.METAL);
  lathe(m, W + 9, -6, 2, 9, (t) => 1.6 - t * 0.2, (_x, y) => (y === 9 ? 0x3a2a20 : 0xe8dcc0), { tiltX: 0.06 });
  m.set(W + 9, 10, -6, 0xffd27a, VF.GLOW);
  for (const cx of [W + 4, W + 11]) for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    m.set(cx + Math.round(Math.cos(t) * 2.4), 0, 8 + Math.round(Math.sin(t) * 2.4), 0x8a8680, VF.METAL);
  }
  m.box(W + 7, 0, 8, W + 8, 0, 8, 0x8a8680, VF.METAL);
  return S(m, SMV);
}

/** tall armoire (the wardrobe): carved crown, a cracked mirror door, the other door ajar showing coats,
 *  hats on the top shelf, boots below, a drawer with brass pulls, hat box on top — 1/32. Front faces +Z. */
export function armoire(seed = 0): StaticModel {
  const m = new VoxelModel('armoire');
  const W = 36, H = 70, D = 18;
  const x0 = -W / 2, x1 = W / 2 - 1;
  const wood = 0x5a3820, dark = 0x2e1c10, hi = 0x7a5232;
  for (let x = x0; x <= x1; x++)
    for (let y = 2; y <= H; y++)
      for (let z = 0; z < D; z++) {
        const shell = x === x0 || x === x1 || y === H || y === 2 || z === 0;
        if (shell) m.set(x, y, z, wear(z === 0 ? dark : wood, x, y, z, 0.05));
      }
  // feet (carved bun feet) + plinth
  for (const fx of [x0 + 2, x1 - 2]) lathe(m, fx, D - 3, 0, 2, (t) => 2.2 - t * 0.6, () => dark, {});
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = 0; z <= D; z++) m.set(x, 3, z, hi);
  // drawer
  for (let x = x0 + 1; x <= x1 - 1; x++) for (let y = 4; y <= 11; y++) m.set(x, y, D, x === x0 + 1 || x === x1 - 1 || y === 4 || y === 11 ? dark : wear(wood, x, y, D, 0.04));
  for (const px of [-8, 7]) m.box(px, 7, D + 1, px + 1, 8, D + 1, IP.brassHi, VF.METAL);
  // inside (visible through the open door): coats, hats, boots
  for (let x = 1; x <= x1 - 1; x++) for (let y = 13; y <= H - 2; y++) m.set(x, y, 2, 0x1e140c);
  const coat = (cx: number, col: number) => {
    for (let y = 26; y <= H - 8; y++) for (let x = -3; x <= 3; x++) for (let z = 4; z <= 9; z++) if (Math.abs(x) < 3 || (z > 5 && z < 9)) m.set(cx + x, y, z, y % 6 === 0 ? mul(col, 0.8) : col, VF.SOFTAO);
    m.box(cx - 1, H - 7, 6, cx + 1, H - 6, 6, 0x5a5650, VF.METAL);
  };
  coat(6, 0x6a4428);
  coat(13, 0x3a4a6a);
  for (let x = 1; x <= x1 - 1; x++) m.set(x, H - 6, 6, 0x8a8680, VF.METAL); // rail
  for (const bx of [3, 10]) {
    m.box(bx, 13, 5, bx + 3, 19, 9, 0x4a2e1a);
    m.box(bx, 13, 9, bx + 3, 14, 12, 0x4a2e1a);
    m.box(bx, 19, 5, bx + 3, 19, 9, 0x6a4428);
  }
  // left door (closed) with a cracked mirror panel + carved frame
  for (let x = x0 + 1; x <= -1; x++)
    for (let y = 13; y <= H - 2; y++) {
      const frame = x === x0 + 1 || x === -1 || y === 13 || y === H - 2;
      const inner = x > x0 + 3 && x < -3 && y > 18 && y < H - 7;
      let c = frame ? dark : wear(wood, x, y, D, 0.04);
      if (inner) {
        const lx = x - (x0 + 4), ly = y - 19;
        const crack = Math.abs(lx - ly * 0.35 - 3) < 0.5 || Math.abs(lx + ly * 0.5 - 12) < 0.5;
        c = crack ? 0x2a3438 : mul(0xb0bcbc, 0.86 + (ly / 40) * 0.2);
      }
      m.set(x, y, D, c, inner ? VF.METAL : 0);
    }
  m.box(-3, 40, D + 1, -3, 42, D + 1, IP.brassHi, VF.METAL);
  // right door: swung open on its hinge
  for (let k = 0; k < 17; k++)
    for (let y = 13; y <= H - 2; y++) {
      const x = x1 + Math.round(k * 0.62), z = D + Math.round(k * 0.78);
      m.set(x, y, z, k === 16 || y === 13 || y === H - 2 || k === 0 ? dark : mod(y, 9) === 0 ? hi : wood);
    }
  // carved crown + hat box on top
  for (let x = x0 - 2; x <= x1 + 2; x++)
    for (let y = H + 1; y <= H + 5; y++)
      for (let z = 0; z <= D + 2 - (H + 5 - y); z++) {
        const dentil = y === H + 2 && mod(x, 3) === 0;
        m.set(x, y, z, dentil ? dark : y === H + 5 ? hi : wood);
      }
  for (let x = -4; x <= 4; x++) for (let y = H + 7; y <= H + 9; y++) m.set(x, y, D - 2, hi); // pediment scroll
  lathe(m, -10, 8, H + 6, H + 13, () => 6, (_x, y) => (y === H + 13 || y === H + 6 ? 0x6a2a2a : y === H + 11 ? 0xd8c8a0 : 0x8a4a3a), { sz: 0.9 });
  void seed;
  return S(m, CVS);
}

/** steamer trunk (1/32): leather + brass corners, straps, travel labels, lid open with floral lining,
 *  clothes and a revolver case spilling out */
export function steamerTrunk(seed = 0): StaticModel {
  const m = new VoxelModel('steamer_trunk');
  const W = 34, D = 18, H = 18;
  for (let x = -W / 2; x <= W / 2; x++)
    for (let y = 0; y <= H; y++)
      for (let z = -D / 2; z <= D / 2; z++) {
        const shell = Math.abs(x) === W / 2 || Math.abs(z) === D / 2 || y === 0;
        if (!shell) continue;
        const strap = Math.abs(x - 9) < 1.5 || Math.abs(x + 9) < 1.5;
        const corner = Math.abs(x) >= W / 2 - 2 && (y < 3 || y > H - 3) && Math.abs(z) >= D / 2 - 2;
        const band = y === 2 || y === H;
        let c = wear(0x6a3e22, x, y, z, 0.06);
        if (strap) c = 0x3a2010;
        if (band) c = 0x8a6a3a;
        if (corner) c = IP.brassHi;
        m.set(x, y, z, c, corner || band ? VF.METAL : 0);
      }
  // travel labels on the front
  for (const [lx, ly, col] of [[-14, 6, 0xc8a050], [-4, 10, 0xb04a3a], [3, 4, 0x4a7a8a]] as const) for (let x = 0; x < 6; x++) for (let y = 0; y < 4; y++) m.set(lx + x, ly + y, D / 2 + 1, (x + y) % 4 === 0 ? 0xe8dcc0 : col);
  // lid open, leaning back, floral lining
  for (let x = -W / 2; x <= W / 2; x++)
    for (let k = 0; k <= 16; k++) {
      const y = H + 1 + k, z = -D / 2 - Math.round(k * 0.38);
      m.set(x, y, z, Math.abs(x) >= W / 2 - 1 || k === 16 ? IP.brass : wear(0x5a3420, x, y, z, 0.05), Math.abs(x) >= W / 2 - 1 || k === 16 ? VF.METAL : 0);
      if (k > 1 && k < 15 && Math.abs(x) < W / 2 - 2) m.set(x, y, z + 1, mod(x + k * 2, 5) === 0 ? 0x8a4a5a : mod(x - k, 7) === 0 ? 0x5a7a4a : 0xc8b09a, VF.SOFTAO);
    }
  // clothes + revolver case spilling out
  for (let x = -13; x <= 11; x++) for (let y = H - 3; y <= H + 1; y++) for (let z = -7; z <= 7; z++) if (y < H + 1 || hash3(x, y, z) > 0.35) m.set(x, y, z, x < -4 ? 0x3e5270 : x < 4 ? 0xe4d8c0 : 0xa83a2a, VF.SOFTAO);
  for (let k = 0; k < 14; k++) for (let x = -5; x <= 0; x++) m.set(x, H - Math.floor(k * 1.15), D / 2 + 1 + Math.floor(k / 3), 0xd4c8b0, VF.SOFTAO);
  m.box(5, H + 1, -2, 13, H + 3, 4, 0x3a2414);
  m.box(6, H + 3, -1, 12, H + 3, 3, 0x7a2a2a);
  m.box(-1, 9, D / 2 + 1, 1, 12, D / 2 + 1, IP.brassHi, VF.METAL);
  void seed;
  return S(m, CVS);
}

/** brass oil lamp with a tall glass chimney (sooty top) — 1/48; meta.flame (m, bottom-centre pivot) */
export function oilLamp(): StaticModel & { meta: { flame: V3 } } {
  const m = new VoxelModel('oil_lamp');
  lathe(m, 0, 0, 0, 2, (t) => 5 - t, () => IP.brass, {}, VF.METAL);
  lathe(m, 0, 0, 3, 5, () => 1.6, () => IP.brassHi, {}, VF.METAL);
  lathe(m, 0, 0, 6, 12, (t) => 3 + Math.sin(t * Math.PI) * 1.6, (x, y, z, outer) => (outer ? (y > 8 ? 0x9ac0a8 : 0x7aa088) : 0x6a8a4a), { hollow: true, dents: [{ a: 2, y0: 7, y1: 11, depth: 0.5, width: 0.6 }] });
  lathe(m, 0, 0, 13, 14, () => 2.4, () => IP.brass, {}, VF.METAL);
  lathe(m, 0, 0, 15, 26, (t) => 1.9 + Math.sin(Math.min(1, t * 2.2) * Math.PI) * 1.3 - t * 0.3, (_x, y, z, outer) => (!outer ? null : y > 23 ? 0x4a4440 : 0xd0e4e0), { hollow: true });
  m.set(0, 16, 0, 0xffd27a, VF.GLOW).set(0, 17, 0, 0xffb84a, VF.GLOW);
  for (let k = 0; k < 4; k++) m.set(4 + k, 4, 0, IP.brassHi, VF.METAL); // wick knob
  return { model: m, voxelSize: SMV, meta: { flame: [0, 16.5 * SMV, 0] } };
}

/** the bar (1/32, ~4.7 m): recessed kick plinth, fluted stiles, bevelled raised panels with brass
 *  rosettes, dentil rail, a thick bullnosed top that sags in the middle with a crack, glass rings,
 *  carved initials, knife scratches, a whiskey spill, a brass foot rail on brackets (one broken),
 *  a kicked-in panel — and clutter: bottles, shot glasses, a beer mug, cards, coins, a hat, a brass
 *  cash register. Front faces +Z. meta.top: counter height (m) at the middle. */
export function barCounterCraft(seed = 0): StaticModel & { meta: { top: number; length: number } } {
  const r = rngOf(seed, 3701);
  const m = new VoxelModel('bar_counter');
  const L = 150, H = 35, D = 22;
  const X = (u: number) => u - L / 2;
  const wal = 0x4a2a16, walHi = 0x6a4024, walDark = 0x26160a, panel = 0x553220;
  const sag = (u: number) => (u > 30 && u < L - 30 ? Math.round(2.8 * Math.sin(((u - 30) / (L - 60)) * Math.PI)) : 0);
  const kicked = (u: number, y: number) => u > L - 34 && u < L - 14 && y > 6 && y < H - 9;
  for (let u = 0; u < L; u++) {
    const s = sag(u);
    for (let y = 0; y < H - s; y++)
      for (let z = 0; z < D; z++) {
        const front = z === D - 1, back = z === 0, end = u === 0 || u === L - 1;
        if (!front && !back && !end) continue;
        let c = wal;
        if (front) {
          if (y < 4) {
            // recessed kick plinth (one voxel back), scuffed
            m.set(X(u), y, z - 1, wear(hash3(u, y, 1) > 0.8 ? 0x3a2414 : walDark, u, y, z, 0.05));
            continue;
          }
          if (kicked(u, y)) continue;
          const pu = mod(u, 25), py = y - 4;
          const top = H - s - 7;
          if (pu < 3) c = pu === 1 ? walDark : walHi; // fluted stile
          else if (py < 2 || y > top) c = walDark;
          else {
            // bevelled raised panel
            const lx = pu - 3, ly = py - 2, pw = 21, ph = top - 6;
            if (lx === 0 || ly === 0) c = walHi;
            else if (lx === pw - 1 || ly === ph - 1) c = walDark;
            else if (lx === 1 || ly === 1) c = mul(walHi, 0.9);
            else c = wear(panel, u, y, z, 0.05);
            const cx = 3 + Math.floor(pw / 2), cy = 2 + Math.floor(ph / 2) + 4;
            if (Math.abs(pu - cx) + Math.abs(y - cy) <= 1) c = Math.abs(pu - cx) + Math.abs(y - cy) === 0 ? IP.brassHi : IP.brass;
          }
          // dentil rail under the top
          if (y === H - s - 5 && mod(u, 3) === 0) c = walHi;
        } else if (end) c = wear(wal, u, y, z, 0.05);
        else c = walDark;
        m.set(X(u), y, z, c, c === IP.brass || c === IP.brassHi ? VF.METAL : 0);
      }
    // the top: 3 voxels thick, overhang 3 at the front, bullnose
    for (let z = -1; z < D + 3; z++)
      for (let t = 0; t < 3; t++) {
        const y = H - s + t;
        if (z === D + 2 && t !== 1) continue; // bullnose
        let c = t < 2 ? walDark : mul(walHi, 0.88 + hash3(Math.floor(z / 8), 2, seed) * 0.18);
        if (t === 2 && mod(z + 1, 8) === 0) c = walDark; // plank seams
        if (t === 2 && Math.abs(u - L / 2 + 3) < 1 && z > 5) c = 0x140a04; // crack across the sag
        if (z === D + 2) c = walHi;
        m.set(X(u), y, z, wear(c, u, y, z, 0.03));
      }
  }
  const topY = (u: number) => H - sag(u) + 3;
  // glass rings, scratches, initials, a spill, cigarette burns
  for (let i = 0; i < 9; i++) {
    const cu = r.int(8, L - 8), cz = r.int(4, D - 2);
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const uu = cu + Math.round(Math.cos(t) * 2), zz = cz + Math.round(Math.sin(t) * 2);
      m.set(X(uu), topY(uu) - 1, zz, 0x3a2010);
    }
  }
  for (let i = 0; i < 6; i++) {
    const u0 = r.int(6, L - 20), z0 = r.int(2, D);
    for (let k = 0; k < r.int(5, 10); k++) m.set(X(u0 + k), topY(u0 + k) - 1, z0 + Math.round(k * 0.3), 0x8a6040);
  }
  for (const [u, z] of [[44, 14], [45, 14], [46, 15], [44, 16], [48, 14], [48, 15], [48, 16], [50, 14], [51, 15], [52, 14], [50, 16], [52, 16]] as const) m.set(X(u), topY(u) - 1, z, 0x1e1008); // carved "J+M"
  for (let u = 92; u < 104; u++) for (let z = 8; z < 15; z++) if (Math.hypot((u - 98) / 6, (z - 11) / 3.5) < 1 && hash3(u, z, 4) > 0.15) m.set(X(u), topY(u), z, 0x8a4a12, VF.METAL); // whiskey spill
  for (let i = 0; i < 5; i++) m.set(X(r.int(10, L - 10)), topY(10) - 1, r.int(2, D), 0x0a0604);
  // brass foot rail on brackets (the last bracket broke: the rail drops at the end)
  for (let u = 3; u < L - 3; u++) {
    const drop = u > L - 26 ? Math.round((u - (L - 26)) * 0.18) : 0;
    m.set(X(u), 6 - drop, D + 5, mod(u, 20) === 0 ? IP.brassHi : IP.brass, VF.METAL);
    m.set(X(u), 7 - drop, D + 5, IP.brassHi, VF.METAL);
    if (mod(u, 30) === 8 && u < L - 30) for (let k = 0; k < 5; k++) m.set(X(u), 6 + (k < 2 ? 0 : 1), D - 1 + k, IP.brass, VF.METAL);
  }
  // splintered edges of the kicked-in panel + bottles inside it
  for (let y = 7; y < H - 9; y++) {
    if (hash3(y, 1, 9) > 0.35) m.set(X(L - 34), y, D, 0xc8a87a);
    if (hash3(y, 2, 9) > 0.45) m.set(X(L - 14), y, D, 0xc8a87a);
  }
  for (let k = 0; k < 5; k++) for (let y = 0; y < 4; y++) m.set(X(L - 32 + k * 4), 7 + y + (k % 2), D - 2 - y, 0xc8a87a); // broken boards hanging inward
  for (let i = 0; i < 4; i++) bottleShape(m, X(L - 30 + i * 4), 1, 4, i % 2 ? 'whiskey' : 'wine', seed + i);
  // clutter on the top
  const at = (u: number) => topY(u);
  bottleShape(m, X(24), at(24), 12, 'whiskey', seed + 11);
  bottleShape(m, X(70), at(70), 9, 'wine', seed + 12);
  bottleShape(m, X(84), at(84), 15, 'whiskey', seed + 13, true);
  for (const [u, z] of [[30, 16], [34, 13], [62, 17], [66, 12], [110, 16]] as const) lathe(m, X(u), z, at(u), at(u) + 2, (t) => 1.4 + t * 0.3, (_x, y, _z, outer) => (outer ? (y === at(u) ? 0xa8c4bc : 0xc8dcd8) : y < at(u) + 2 ? 0x9a5a18 : null), {}, VF.METAL); // shot glasses (some full)
  lathe(m, X(120), 12, at(120), at(120) + 5, () => 2.6, (_x, y, _z, outer) => (outer ? 0xd0e0dc : y > at(120) + 3 ? 0xf0ece0 : 0xc89a3a), { hollow: false }, VF.METAL); // beer mug with foam
  for (let k = 0; k < 4; k++) m.set(X(123), at(120) + 1 + k, 12, 0xd0e0dc, VF.METAL);
  for (let i = 0; i < 6; i++) {
    const u = r.int(36, 60), z = r.int(5, D - 1);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) m.set(X(u + a), at(u), z + b, a + b === 1 && i % 2 ? 0xb02a1a : 0xf0ece0);
  }
  for (let i = 0; i < 7; i++) m.set(X(r.int(26, 120)), at(60), r.int(4, D), 0xd8a840, VF.METAL);
  // a dusty stetson left on the bar
  lathe(m, X(100), 7, at(100), at(100), () => 7, () => 0x6a4428, { sx: 1.1, sz: 0.9 });
  lathe(m, X(100), 7, at(100) + 1, at(100) + 5, (t) => 4 - t * 0.8, (_x, y) => (y === at(100) + 1 ? 0x2a1a10 : 0x7a5232), { sx: 1.1, sz: 0.85 });
  // brass cash register (left end), drawer ajar, NO SALE flag up
  const cu = 14, cy = at(cu);
  for (let x = 0; x < 13; x++)
    for (let y = 0; y < 12; y++)
      for (let z = 0; z < 11; z++) {
        if (y > 6 && z < 4) continue;
        const keys = z === 10 && y > 1 && y < 6 && x > 0 && x < 12 && (x + y) % 2 === 0;
        const edge = x === 0 || x === 12 || y === 11 || y === 0;
        m.set(X(cu) + x, cy + y, 5 + z, keys ? 0xe8e0c8 : edge ? IP.brassHi : mod(x + y * 2, 5) === 0 ? 0x8a6420 : IP.brass, VF.METAL);
      }
  for (let x = 1; x < 12; x++) m.set(X(cu) + x, cy + 1, 17, IP.brassHi, VF.METAL); // drawer ajar
  for (let x = 3; x < 10; x++) for (let y = 12; y < 15; y++) m.set(X(cu) + x, cy + y, 9, x === 3 || x === 9 ? IP.brass : 0xe8dcc0, x === 3 || x === 9 ? VF.METAL : 0);
  return { model: m, voxelSize: CVS, meta: { top: (H + 3 - 2.8) * CVS, length: L * CVS } };
}

/** burlap sack (organic): uneven lumps, slumped to one side, a sewn patch, rope-tied neck, grain spill — 1/32 */
export function sackCraft(seed = 0): StaticModel {
  const r = rngOf(seed, 3801);
  const m = new VoxelModel('sack');
  const tone = r.chance(0.5) ? 0xc8b088 : 0xb89a68;
  const H = 25;
  const lean = r.range(-0.18, 0.18), leanZ = r.range(-0.1, 0.1);
  const lumps: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) lumps.push([r.range(0, 6.28), r.int(3, 18), r.range(0.8, 1.8), r.range(0.4, 0.9)]);
  lathe(
    m, 0, 0, 0, H,
    (t) => (t < 0.85 ? 9.5 - t * 3.6 + Math.sin(t * Math.PI * 0.9) * 1.4 - (t < 0.06 ? 1.2 : 0) : 3 - (t - 0.85) * 6),
    (x, y, z, outer, ang, t) => {
      let c = (x + y) % 2 === 0 ? tone : mul(tone, 0.93);
      if (mod(y + Math.round(Math.sin(ang * 3) * 2), 8) === 0) c = mul(tone, 0.78); // folds
      if (t > 0.82 && t < 0.88) return 0xa8884e; // rope
      if (outer && t > 0.3 && t < 0.55 && ang > 0.4 && ang < 1.2) return (x + y) % 3 ? 0x7a6a50 : 0x5a4a38; // sewn patch
      return wear(c, x, y, z, 0.04);
    },
    { sx: 1.08, sz: 0.86, tiltX: lean, tiltZ: leanZ, dents: lumps.map(([a, y, d, w]) => ({ a, y0: y - 4, y1: y + 4, depth: -d, width: w })) },
    VF.SOFTAO
  );
  stampText(m, 'z+', ['OATS', 'FLOUR', 'SALT', 'BEANS'][mod(seed, 4)], -7, 14, 9, { color: 0x4a2a1a });
  for (let i = 0; i < 18; i++) m.set(r.int(-14, 14), 0, 8 + r.int(0, 6), 0xe0c890);
  return S(m, CVS);
}

/** cluster of hand-blown bottles on the floor (some tipped, one broken) — 1/32 */
export function bottlesCraft(seed = 0): StaticModel {
  const r = rngOf(seed, 3901);
  const m = new VoxelModel('bottles');
  const kinds: BottleKind[] = ['whiskey', 'wine', 'flask', 'jug', 'tonic', 'broken'];
  for (let i = 0; i < 7; i++) bottleShape(m, r.int(-18, 14), 0, r.int(-12, 12), kinds[r.int(0, kinds.length - 1)], seed * 31 + i, r.chance(0.35));
  return S(m, CVS);
}

// ---------------------------------------------------------------------------
// RIGGED pieces (anything that swings or creaks)
// ---------------------------------------------------------------------------
/** chain: alternating oval links from y=0 down to y=-(n-1) */
function chainLinks(m: VoxelModel, n: number, x = 0, z = 0) {
  for (let k = 0; k < n; k++) {
    const flat = Math.floor(k / 3) % 2 === 0;
    const c = k % 3 === 1 ? 0x2e2c2a : 0x5a5650;
    m.set(x, -k, z, c, VF.METAL);
    if (k % 3 !== 1) m.set(flat ? x + 1 : x, -k, flat ? z : z + 1, c, VF.METAL);
  }
}

/** a dented tin lantern on a chain — rig: 'chain' (pivot at the ceiling hook) → 'lamp' (pivot at the bail).
 *  1/48. meta.light: flame offset from the lamp pivot (m); meta.length: hook → lamp base (m). */
export function lanternRig(chainM = 0.7, seed = 0): RigSpec {
  const r = rngOf(seed, 4001);
  const n = Math.max(3, Math.round(chainM / SMV));
  const chain = new VoxelModel('lantern_chain');
  chainLinks(chain, n);
  chain.box(-1, 1, -1, 1, 1, 1, 0x3a3836, VF.METAL); // ceiling plate
  const lamp = new VoxelModel('lantern_lamp');
  // bail handle (bent)
  for (let a = 0; a <= 12; a++) {
    const t = (a / 12) * Math.PI;
    lamp.set(Math.round(Math.cos(t) * 4), -Math.round(Math.sin(t) * 3) - (a === 3 ? 1 : 0), 0, 0x3a3836, VF.METAL);
  }
  const dent = r.range(0, 6.28);
  // cap: stepped cone with vents
  lathe(lamp, 0, 0, -9, -5, (t) => 5.2 - t * 3, (x, y, z, outer, ang) => (y === -7 && mod(Math.round(ang * 4), 2) === 0 && outer ? 0x1a1816 : wear(0x6a5a44, x, y, z, 0.06)), { dents: [{ a: dent, y0: -9, y1: -6, depth: 0.8, width: 0.7 }] }, VF.METAL);
  // glass globe with wire guard and soot
  lathe(lamp, 0, 0, -20, -10, (t) => 3.2 + Math.sin(t * Math.PI) * 1.4, (x, y, z, outer, ang) => {
    if (!outer) return null;
    const guard = mod(Math.round((ang / (Math.PI * 2)) * 4 * 6), 6) === 0 || y === -13 || y === -17;
    if (guard) return 0x3a3836;
    return y > -12 ? 0x5a4a3a : 0xe8d8a0; // soot at the top, warm glass
  }, { hollow: true }, VF.METAL);
  lamp.set(0, -15, 0, 0xffe2a0, VF.GLOW).set(0, -16, 0, 0xffb84a, VF.GLOW).set(0, -17, 0, 0x8a6a3a);
  // burner collar + fuel font (dented, rusty)
  lathe(lamp, 0, 0, -22, -21, () => 3.2, () => IP.brass, {}, VF.METAL);
  lathe(lamp, 0, 0, -26, -23, (t) => 5 - Math.abs(t - 0.5) * 1.6, (x, y, z) => (hash3(x, y, z) > 0.82 ? 0x7a4a2a : 0x5a5246), { dents: [{ a: dent + 2, y0: -26, y1: -23, depth: 0.9, width: 0.6 }] }, VF.METAL);
  return {
    name: 'lantern_rig_' + seed,
    voxelSize: SMV,
    parts: [
      { name: 'chain', model: chain, pivot: [0.5, 0.5, 0.5], attach: [0, 0, 0] },
      { name: 'lamp', model: lamp, pivot: [0.5, 0.5, 0.5], parent: 'chain', attach: [0, -n, 0] },
    ],
    meta: { light: [0, -15.5 * SMV, 0], length: (n + 26) * SMV },
  };
}

/** wagon-wheel chandelier, hanging crooked from one snapped chain — rig: 'chains' (pivot at hook) → 'wheel'. 1/32.
 *  meta.candles: flame offsets from the wheel pivot (m) */
export function chandelierRig(): RigSpec {
  const chains = new VoxelModel('chandelier_chains');
  const wheel = new VoxelModel('chandelier_wheel');
  const R = 16, L = 22;
  // three chains from the hook spreading to the rim (one snapped short)
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2;
    const len = i === 2 ? 7 : L;
    for (let k = 0; k < len; k++) {
      const f = k / L;
      chains.set(Math.round(Math.cos(t) * (R - 2) * f), -k, Math.round(Math.sin(t) * (R - 2) * f), k % 2 ? 0x2e2c2a : 0x5a5650, VF.METAL);
    }
  }
  chains.box(-1, 1, -1, 1, 1, 1, 0x3a3836, VF.METAL);
  // the wheel: iron tyre over a wooden felloe, spokes, hub, candle stubs with wax drips
  for (let a = 0; a < 104; a++) {
    const t = (a / 104) * Math.PI * 2;
    for (let w = 0; w < 3; w++) {
      const rr = R - w;
      const c = w === 0 ? (hash3(a, 1, 1) > 0.8 ? 0x7a4a2a : 0x3a3836) : wear(0x5a3820, a, w, 0, 0.06);
      wheel.set(Math.round(Math.cos(t) * rr), 0, Math.round(Math.sin(t) * rr), c, w === 0 ? VF.METAL : 0);
      if (w === 1) wheel.set(Math.round(Math.cos(t) * rr), 1, Math.round(Math.sin(t) * rr), 0x4a2e1a);
    }
  }
  const candles: V3[] = [];
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    if (i % 2 === 0) for (let k = 3; k < R - 2; k++) wheel.set(Math.round(Math.cos(t) * k), 0, Math.round(Math.sin(t) * k), 0x3e2616);
    const cx = Math.round(Math.cos(t + 0.15) * (R - 1)), cz = Math.round(Math.sin(t + 0.15) * (R - 1));
    const h = 2 + (i * 7) % 4;
    for (let y = 2; y <= 1 + h; y++) wheel.set(cx, y, cz, y === 1 + h ? 0xd8ccb0 : 0xe8dcc0);
    for (let y = 0; y > -2 - (i % 3); y--) wheel.set(cx + (i % 2), y, cz, 0xe8dcc0); // drips
    if (i === 1 || i === 4 || i === 8) {
      wheel.set(cx, 2 + h, cz, 0xffd27a, VF.GLOW);
      candles.push([cx * CVS, (2.5 + h) * CVS, cz * CVS]);
    }
  }
  lathe(wheel, 0, 0, -1, 2, (t) => 2.6 - Math.abs(t - 0.5), () => 0x3e2616, {});
  return {
    name: 'chandelier_rig',
    voxelSize: CVS,
    parts: [
      { name: 'chains', model: chains, pivot: [0.5, 0.5, 0.5], attach: [0, 0, 0] },
      { name: 'wheel', model: wheel, pivot: [0.5, 0.5, 0.5], parent: 'chains', attach: [0, -L, 0], rest: [0.16, 0, -0.1] },
    ],
    meta: { candles, length: (L + 2) * CVS },
  };
}

/** sign swinging on chains under an iron bracket — rig: 'bracket' (pivot at the wall) → 'board' (pivot at the
 *  bracket bar; swings about Z). The bracket sticks out along +Z from the wall. 1/32 */
export function hangingSignRig(text = 'LAST CHANCE'): RigSpec {
  const br = new VoxelModel('sign_bracket');
  const arm = 34;
  for (let z = 0; z < arm; z++) br.set(0, 0, z, 0x3a3836, VF.METAL).set(0, 1, z, 0x2e2c2a, VF.METAL);
  for (let k = 0; k < 14; k++) br.set(0, -Math.round(k * 0.9), Math.round(k * 0.9), 0x3a3836, VF.METAL); // brace
  for (let a = 0; a < 10; a++) br.set(0, 2 + Math.round(Math.sin((a / 10) * Math.PI) * 3), arm - 10 + a, 0x3a3836, VF.METAL); // scroll
  br.box(-1, -14, -1, 1, 3, 0, 0x2e2c2a, VF.METAL); // wall plate
  const bd = new VoxelModel('sign_board');
  const W = 30, H = 13;
  // chains + board (hanging below the bar), text on both faces
  for (const cz of [4, W - 3]) for (let k = 0; k < 6; k++) bd.set(0, -k, cz, k % 2 ? 0x2e2c2a : 0x5a5650, VF.METAL);
  for (let z = 1; z <= W; z++)
    for (let y = -6 - H; y <= -6; y++)
      for (const x of [-1, 0, 1]) {
        const edge = y === -6 || y === -6 - H || z === 1 || z === W;
        const missing = z > W - 4 && y < -6 - H + 4; // broken corner
        if (missing) continue;
        bd.set(x, y, z, edge ? 0x3a2414 : x === 0 ? 0x5a3820 : wear(mod(y, 4) === 0 ? 0x6a4a2a : 0x8a6440, x, y, z, 0.06));
      }
  const tw = textWidth(text);
  stampText(bd, 'x+', text, Math.floor((W + tw) / 2) + 1, -9, 2, { color: 0xe8d8a8 });
  stampText(bd, 'x-', text, Math.floor((W - tw) / 2) + 1, -9, -2, { color: 0xe8d8a8 });
  return {
    name: 'hanging_sign_rig',
    voxelSize: CVS,
    parts: [
      { name: 'bracket', model: br, pivot: [0.5, 0.5, 0.5], attach: [0, 0, 0] },
      { name: 'board', model: bd, pivot: [0.5, 0.5, 0.5], parent: 'bracket', attach: [0, 0, arm - 33] },
    ],
  };
}

/** a creaky plank door in its frame — rig: 'frame' → 'door' (pivot on the hinge edge, swings about Y).
 *  ~0.95 × 2.2 m at 1/32; the door hangs into +Z */
export function creakyDoorRig(): RigSpec {
  const fr = new VoxelModel('door_frame');
  const W = 30, H = 70;
  for (let y = 0; y <= H + 2; y++) for (const x of [-2, -1, W, W + 1]) fr.set(x, y, 0, x === -2 || x === W + 1 ? 0x3a2414 : 0x5a3820);
  for (let x = -3; x <= W + 2; x++) for (let y = H + 1; y <= H + 3; y++) fr.set(x, y, 0, y === H + 3 ? 0x6a4428 : 0x3a2414);
  for (let x = 0; x < W; x++) fr.set(x, 0, 1, 0x4a3020); // threshold
  const dr = new VoxelModel('door');
  for (let x = 0; x < W; x++)
    for (let y = 1; y <= H; y++) {
      const b = Math.floor(x / 5);
      let c = mod(x, 5) === 0 ? 0x2e1c10 : wear(mul(0x6a4a30, 0.9 + hash3(b, 1, 3) * 0.2), x, y, 0, 0.05);
      if (y > H - 3 && b === 4) continue; // a split board end
      dr.set(x, y, 0, c);
    }
  // Z-brace + strap hinges + knob + a bullet hole
  for (const yy of [8, H - 10]) for (let x = 0; x < W; x++) dr.set(x, yy, 1, 0x4a3220).set(x, yy + 1, 1, 0x4a3220);
  for (let k = 0; k < H - 20; k++) dr.set(Math.round((k / (H - 20)) * (W - 2)), 10 + k, 1, 0x4a3220);
  for (const yy of [10, H - 8]) for (let x = 0; x < 12; x++) dr.set(x, yy, 2, x === 11 ? 0x5a5650 : 0x2e2c2a, VF.METAL);
  dr.box(W - 4, 34, 1, W - 3, 36, 2, IP.brass, VF.METAL);
  bulletHole(dr, 18, 48, 1, 0xb09070);
  return {
    name: 'creaky_door_rig',
    voxelSize: CVS,
    parts: [
      { name: 'frame', model: fr, pivot: [0.5, 0, 0.5], attach: [0, 0, 0] },
      { name: 'door', model: dr, pivot: [0, 0, 0.5], parent: 'frame', attach: [0, 0, 0.5] },
    ],
  };
}

// ---------------------------------------------------------------------------
// the stove, the porch, the back room
// ---------------------------------------------------------------------------
/** cast-iron pot-belly stove (1/32): claw feet, ash drawer, a bulging dented belly with a nickel band and
 *  cast ribs, a glowing mica door, a brass QUEEN nameplate, an urn finial, a dented kettle with a bent spout,
 *  the flue with a damper, a coal scuttle, spilled coal and a poker. meta.fire (m, bottom-centre pivot). */
export function stoveCraft(pipeM = 3.2): StaticModel & { meta: { fire: V3 } } {
  const m = new VoxelModel('stove');
  const iron = 0x2e2c2a, ironHi = 0x4a4846, nickel = 0xa8aca8;
  // claw feet
  for (const [fx, fz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
    for (let y = 0; y < 4; y++) m.set(fx, y, fz, iron, VF.METAL);
    m.set(fx + Math.sign(fx), 0, fz, ironHi, VF.METAL).set(fx, 0, fz + Math.sign(fz), ironHi, VF.METAL);
  }
  // base + ash drawer
  lathe(m, 0, 0, 4, 7, () => 7.4, (x, y, z, outer) => (z > 5 && y < 7 && Math.abs(x) < 4 ? (y === 5 ? nickel : iron) : outer ? ironHi : iron), {}, VF.METAL);
  // belly
  lathe(m, 0, 0, 8, 26, (t) => 6.2 + Math.sin(t * Math.PI) * 2, (x, y, z, outer, ang, t) => {
    if (!outer) return null;
    if (y === 15 || y === 16) return nickel; // nickel band
    if (mod(Math.round((ang / (Math.PI * 2)) * 24), 3) === 0 && t > 0.55) return ironHi; // cast ribs
    // the glowing door
    if (z > 5 && Math.abs(x) <= 3 && y >= 9 && y <= 14) return x === -3 || x === 3 || y === 9 || y === 14 ? ironHi : (x + y) % 2 ? 0xff6a1a : 0xffa03a;
    return wear(iron, x, y, z, 0.08);
  }, { dents: [{ a: 2.4, y0: 17, y1: 24, depth: 0.9, width: 0.5 }], hollow: true }, VF.METAL);
  for (let x = -2; x <= 2; x++) for (let y = 10; y <= 13; y++) m.set(x, y, 8, (x + y) % 2 ? 0xff6a1a : 0xffa03a, VF.EMISSIVE);
  m.box(4, 11, 8, 5, 12, 8, nickel, VF.METAL); // latch
  // nameplate
  for (let x = -5; x <= 5; x++) for (let y = 19; y <= 22; y++) m.set(x, y, 9, x === -5 || x === 5 || y === 19 || y === 22 ? 0x8a6420 : IP.brass, VF.METAL);
  // top plate, urn finial, kettle
  lathe(m, 0, 0, 27, 28, () => 7.6, (_x, y) => (y === 28 ? ironHi : iron), {}, VF.METAL);
  lathe(m, 3, 0, 29, 34, (t) => 2 + Math.sin(t * Math.PI) * 1.2, () => nickel, {}, VF.METAL);
  lathe(m, -3, -2, 29, 33, (t) => 3.2 - t * 0.8, (x, y, z) => wear(0x5a5650, x, y, z, 0.06), { dents: [{ a: 0.5, y0: 30, y1: 33, depth: 0.8, width: 0.6 }], tiltX: 0.05 }, VF.METAL);
  seg(m, [-6, 31, -2], [-9, 33, -1], 1, 0x5a5650, VF.METAL);
  seg(m, [-9, 33, -1], [-10, 33, 1], 1, 0x5a5650, VF.METAL); // bent spout
  for (let a = 0; a <= 8; a++) m.set(-3 + Math.round(Math.cos((a / 8) * Math.PI) * 2), 34 + Math.round(Math.sin((a / 8) * Math.PI) * 2), -2, 0x2e2c2a, VF.METAL);
  // flue: leaning slightly, joint rings, a damper handle
  const top = 29 + Math.round(pipeM / CVS);
  for (let y = 29; y <= top; y++) {
    const off = Math.round(((y - 29) / (top - 29)) * 1.5);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const d = Math.hypot(x, z);
      if (d > 2.3) continue;
      const ring = mod(y - 29, 22) === 0;
      m.set(5 + x + off, y, -1 + z, ring ? ironHi : wear(0x262422, x, y, z, 0.08), VF.METAL);
    }
  }
  m.box(8, 40, -1, 11, 40, -1, nickel, VF.METAL);
  // coal scuttle (dented), spilled coal, a poker leaning on the stove
  lathe(m, 13, 6, 0, 7, (t) => 3.4 + t * 0.8, (x, y, z, outer) => (outer || y === 0 ? wear(0x4a4844, x, y, z, 0.08) : y === 7 ? null : 0x141210), { dents: [{ a: 0, y0: 2, y1: 6, depth: 0.8, width: 0.6 }] }, VF.METAL);
  for (let x = 11; x <= 15; x++) for (let z = 4; z <= 8; z++) if (hash3(x, 8, z) > 0.3) m.set(x, 8, z, 0x141210);
  for (let i = 0; i < 9; i++) m.set(9 + (i * 3) % 7, 0, 9 + (i % 4), 0x1a1816);
  seg(m, [-9, 0, 7], [-7, 22, 5], 1, 0x3a3836, VF.METAL);
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2;
  return { model: m, voxelSize: CVS, meta: { fire: [(0 - px) * CVS, (12 - b.minY) * CVS, (8 - pz) * CVS] } };
}

/** covered porch along the saloon's street side (outside the left wall), room frame, 1/16:
 *  boardwalk, posts, a sloping shingle roof with gaps, one post knocked out so the roof sags. */
export function porchAwning(seed = 0): StaticModel {
  const m = new VoxelModel('porch');
  const out = -34; // 2.1 m out from the wall's outer face
  for (let z = 4; z < RNZ - 4; z++) {
    // boardwalk
    for (let x = out; x < 0; x++) {
      const b = Math.floor(z / 3);
      if (mod(z, 3) === 0) m.set(x, 2, z, IP.gap);
      else if (!(hash3(b, Math.floor(x / 8), seed) > 0.94)) m.set(x, 3, z, wear(mul(IP.greyBoard, 0.88 + hash3(b, 2, seed) * 0.22), x, 3, z, 0.05));
    }
    for (let x = out; x < 0; x += 10) m.set(x, 2, z, 0x4a4236);
  }
  // posts (one knocked out → the roof sags towards it)
  const posts = [10, 48, 86, 124];
  posts.forEach((pz, i) => {
    if (i === 2) {
      seg(m, [out + 1, 3, pz], [out - 14, 1, pz + 18], 3, 0x6a5a48); // fallen post in the street
      return;
    }
    post(m, out, pz, 3, 56, 3, PR.woodGrey, pz);
  });
  // roof: slopes from the wall (y 60) down to the beam over the posts (y 54), sagging near the missing post
  for (let z = 2; z < RNZ - 2; z++) {
    const sag = Math.max(0, 10 - Math.abs(z - 86) / 3.5);
    for (let x = out - 3; x < 0; x++) {
      const t = (x - (out - 3)) / -(out - 3);
      const y = Math.round(54 + (1 - t) * 0 + t * 6 - sag * (1 - t));
      const row = Math.floor(x / 3);
      const gap = hash3(row, Math.floor(z / 7), seed) > 0.9;
      if (gap) continue;
      m.set(x, y, z, mod(x, 3) === 0 ? 0x3a3024 : mod(z + row * 2, 6) === 0 ? 0x5a4a38 : wear(0x7a6a52, x, y, z, 0.06));
      m.set(x, y - 1, z, 0x4a3e30);
    }
    // beam over the posts
    for (let y = 51; y < 54; y++) m.set(out, y - Math.round(sag), z, 0x5a4a38);
  }
  return S(m, RVS);
}

/** the dark back room behind the creaky door: plank box with a few crates and a bedframe (room frame, 1/16) */
export function backRoom(seed = 0): StaticModel {
  const m = new VoxelModel('back_room');
  const x0 = rx(-4.9), x1 = rx(-1.9), z0 = -40, z1 = 0;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      m.set(x, 0, z, mod(x, 3) === 0 ? IP.gap : wear(IP.pineDark, x, 0, z, 0.06));
      m.set(x, RNH - 4, z, IP.walnutDark);
    }
  for (let y = 0; y < RNH - 4; y++) {
    for (let x = x0; x <= x1; x++) m.set(x, y, z0, mod(y, 4) === 0 ? IP.walnutDark : 0x5a4028);
    for (let z = z0; z <= z1; z++) {
      m.set(x0, y, z, mod(y, 4) === 0 ? IP.walnutDark : 0x5a4028);
      m.set(x1, y, z, mod(y, 4) === 0 ? IP.walnutDark : 0x5a4028);
    }
  }
  for (let i = 0; i < 3; i++) crateBox(m, x0 + 4 + i * 13, 1, z0 + 3 + (i % 2) * 6, 11, PR.wood, PR.woodDark, i === 1);
  for (let x = x1 - 22; x < x1 - 2; x++) for (let z = z0 + 4; z < z0 + 34; z++) if (x === x1 - 22 || x === x1 - 3 || z === z0 + 4 || z === z0 + 33) m.set(x, 6, z, 0x4a3020); // bed frame
  void seed;
  return S(m, RVS);
}

// ===========================================================================
// THE CABIN (v3) — a lived-in pine log house at the edge of the ruined outpost.
// Honey tongue-and-groove walls with dark knots, a lapped angled ceiling on log
// beams, a stone fireplace, a workshop corner, a garage bay behind big barn
// doors open to the sunset, one ragged hole in the roof. The shell shares one
// frame (CABIN_PIVOT, 1/20 m); furniture is 1/32, small things 1/48–1/64.
// Everything is sculpted from smooth signed-distance forms: rounded, sagging,
// worn, asymmetric. Anything that moves is a rig.
// ===========================================================================
type SDF = (x: number, y: number, z: number) => number;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** polynomial smooth union (k = blend width in voxels) */
function smin(a: number, b: number, k: number) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b * (1 - h) + a * h - k * h * (1 - h);
}
/** ellipsoid (approximate distance, voxel units) */
function dEll(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const ax = (x - cx) / rx, ay = (y - cy) / ry, az = (z - cz) / rz;
  const k0 = Math.hypot(ax, ay, az);
  const k1 = Math.hypot(ax / rx, ay / ry, az / rz);
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** tapered capsule a→b (radii ra→rb) */
function dCap(x: number, y: number, z: number, a: V3, b: V3, ra: number, rb: number) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const h = clamp01((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz || 1));
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
}
/** rounded box (half extents h*, corner radius r) */
function dRBox(x: number, y: number, z: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r: number) {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** fill every voxel of the box where f < 0 */
function sculpt(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: SDF, col: (x: number, y: number, z: number, d: number) => number | null, flags = 0) {
  for (let x = Math.floor(x0); x <= x1; x++)
    for (let y = Math.floor(y0); y <= y1; y++)
      for (let z = Math.floor(z0); z <= z1; z++) {
        const d = f(x, y, z);
        if (d >= 0) continue;
        const c = col(x, y, z, d);
        if (c !== null) m.set(x, y, z, c, flags);
      }
}
/** smooth low-frequency unevenness for hand-made forms (−1..1) */
function lump(x: number, y: number, z: number, s: number, seed: number) {
  return Math.sin(x * s + seed) * Math.sin(y * s * 1.31 + seed * 2.1) * Math.sin(z * s * 0.87 + seed * 0.7);
}
/** is this voxel on the surface (any face exposed)? */
function exposedV(m: VoxelModel, x: number, y: number, z: number) {
  return !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
}
/** a natural log along an axis: oval, slightly crooked, adze facets, bark seams, a check crack */
function logAlong(m: VoxelModel, axis: 'x' | 'y' | 'z', a0: number, a1: number, c1: number, c2: number, r: number, seed: number, tone = 0x8a5a32, flags = 0) {
  const R = Math.ceil(r) + 2;
  for (let a = a0; a <= a1; a++) {
    const t = (a - a0) / Math.max(1, a1 - a0);
    const bow = Math.sin(t * Math.PI) * r * 0.18 * (hash3(seed, 1, 2) - 0.5) * 2;
    const rr = r * (1 + lump(a, seed, 0, 0.21, seed) * 0.06) * (1 - t * 0.04);
    for (let u = -R; u <= R; u++)
      for (let v = -R; v <= R; v++) {
        const d = Math.hypot(u, (v - bow) * 1.08);
        if (d > rr) continue;
        const ang = Math.atan2(v, u);
        const facet = mod(Math.round(ang * 3.2 + a * 0.05), 2) === 0 ? 1.04 : 0.96; // adze facets
        let c = mul(tone, facet * (1 + lump(a, u, v, 0.4, seed) * 0.05));
        if (d > rr - 1 && hash3(Math.floor(a / 7), Math.round(ang * 5), seed) > 0.86) c = mul(tone, 0.62); // bark seam
        if (d > rr - 1 && Math.abs(ang - 1.1) < 0.12 && mod(a + seed * 13, 90) < 55) c = mul(tone, 0.45); // check crack
        if (a === a0 || a === a1) c = d < rr * 0.35 ? mul(tone, 0.8) : mod(Math.round(d), 2) ? mul(tone, 1.12) : mul(tone, 0.9); // end-grain rings
        if (axis === 'x') m.set(a, c1 + v, c2 + u, c, flags);
        else if (axis === 'y') m.set(c1 + u, a, c2 + v, c, flags);
        else m.set(c1 + u, c2 + v, a, c, flags);
      }
  }
}

// ---------------------------------------------------------------------------
// the cabin frame
// ---------------------------------------------------------------------------
export const CABIN = { W: 10, D: 7, EAVE: 2.5, VS: 1 / 20 };
const KV = CABIN.VS;
export const KNX = 200, KNZ = 140;
const KT = 4; // wall thickness (voxels)
const KYE = 51; // lowest ceiling row at the eaves (world 2.5 m)
/** every cabin shell piece is meshed with this pivot so they all line up at the world origin */
export const CABIN_PIVOT: V3 = [KNX / 2, 1, KNZ / 2];
/** interior wall faces (world m) */
export const CABIN_IN = { left: (KT - KNX / 2) * KV, right: (KNX / 2 - KT) * KV, back: (KT - KNZ / 2) * KV, front: (KNZ / 2 - KT) * KV };
const kx = (mx: number) => Math.round(mx / KV + KNX / 2);
const kz = (mz: number) => Math.round(mz / KV + KNZ / 2);
const ky = (my: number) => Math.round(my / KV) + 1;
/** lowest ceiling voxel row over cabin voxel z (lapped boards step up one row every two) */
const ceilRow = (iz: number) => KYE + Math.floor(Math.max(0, Math.min(iz - KT, KNZ - 1 - KT - iz)) / 2);
/** ceiling underside height (world m) above world z */
export function cabinCeil(zm: number) {
  return (ceilRow(Math.max(KT, Math.min(KNZ - 1 - KT, kz(zm)))) - 1) * KV;
}
/** the openings (world m) — the scene builds its sun shafts from these */
export const CABIN_OPEN = {
  barn: { z0: -1.4, z1: 1.4, y0: 0, y1: 3.0 }, // left gable, big barn doors to the street
  gable: { z0: -0.4, z1: 0.4, y0: 3.3, y1: 3.75 }, // little window over the barn doors
  backWin: { x0: 0.85, x1: 2.05, y0: 1.3, y1: 2.15 }, // back wall, over the couch
  rightWin: { z0: -0.15, z1: 0.75, y0: 1.2, y1: 2.05 },
  door: { z0: 1.07, z1: 2.15, y1: 2.3 }, // right gable entry (the Z-brace door rig fills it)
  frontWin: [{ x0: -1.7, x1: -0.7 }, { x0: 2.5, x1: 3.5 }],
  frontWinY: [1.2, 2.05] as [number, number],
  roofHole: { x: -1.35, z: -1.75, rx: 0.5, rz: 0.36 },
  garageX: -2.45, // garage / living split (tie beam + corner posts)
};
const HONEY = [0xc98a46, 0xd29550, 0xbf7f3c, 0xcc8c42, 0xd89c58, 0xc28440, 0xd08e4a];
/** knotty tongue-and-groove pine (vertical boards bw wide): seams, knots with amber rings, long grain */
function pineAt(u: number, y: number, seed: number, bw = 4, dim = 1) {
  const b = Math.floor(u / bw), lu = mod(u, bw);
  const tone = mul(HONEY[Math.floor(hash3(b, seed, 17) * HONEY.length)], dim);
  if (lu === 0) return mul(tone, 0.7); // V-groove
  for (let k = 0; k < 3; k++) {
    if (hash3(b, k, seed + 3) > 0.42) continue;
    const ky0 = 4 + Math.floor(hash3(b, k + 5, seed) * 74);
    const dx = (lu - bw / 2) / 1.0, dy = (y - ky0) / 1.7;
    const d = Math.hypot(dx, dy);
    if (d < 0.75) return 0x4a2410;
    if (d < 1.55) return mul(tone, 0.68);
    if (d < 2.3 && Math.abs(dx) < 1.4) return mul(tone, 0.86); // grain flowing round the knot
  }
  if (hash3(b, lu, Math.floor((y + b * 7) / 11)) > 0.8) return mul(tone, 0.9); // long grain streak
  return tone;
}
const WEATHER = [0x7a6a58, 0x84725e, 0x6e604f, 0x8a7a64, 0x76664f];
/** sun-bleached outside board-and-batten */
function weatherAt(u: number, y: number, seed: number) {
  const b = Math.floor(u / 6);
  const tone = WEATHER[Math.floor(hash3(b, seed, 41) * WEATHER.length)];
  if (hash3(b, Math.floor(y / 13), seed) > 0.85) return mul(tone, 0.88);
  return y < 6 ? mul(tone, 0.8) : tone; // splash grime at the foot
}

/** worn plank floor: honey-brown boards along X with gaps, staggered joints and nail lines on the joists; a worn
 *  path from the barn doors to the couch; the garage end greyer, oil-stained, with sand blown in under the doors */
export function cabinFloor(seed = 0): StaticModel {
  const m = new VoxelModel('cabin_floor');
  const gx = kx(CABIN_OPEN.garageX);
  const LIV = [0x9c5e2e, 0xa86a36, 0x925628, 0xa46632, 0x8f5a2c, 0xa0602f];
  const GAR = [0x8a7058, 0x7e664e, 0x92785e, 0x86705a];
  const path: [number, number][] = [[-5.2, 0], [-2.6, 0.4], [-0.6, -0.6], [1.2, -1.6], [3.2, -1.7]];
  const pathD = (wx: number, wz: number) => {
    let best = 9;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const vx = bx - ax, vz = bz - az;
      const h = clamp01(((wx - ax) * vx + (wz - az) * vz) / (vx * vx + vz * vz));
      best = Math.min(best, Math.hypot(wx - ax - vx * h, wz - az - vz * h));
    }
    return best;
  };
  const stains: [number, number, number][] = [[-3.7, -0.5, 0.32], [-3.0, 1.05, 0.2], [-4.2, 1.6, 0.16], [0.4, -1.2, 0.12]];
  for (let x = -1; x <= KNX; x++)
    for (let z = -1; z <= KNZ; z++) {
      const row = Math.floor(z / 3), lz = mod(z, 3);
      const off = Math.floor(hash3(row, seed, 5) * 64);
      const sg = Math.floor((x + off) / 64);
      const garage = x < gx;
      const pal = garage ? GAR : LIV;
      let c = pal[Math.floor(hash3(row, sg, seed + (garage ? 3 : 0)) * pal.length)];
      const wx = (x - KNX / 2) * KV, wz = (z - KNZ / 2) * KV;
      if (lz === 0) c = mul(c, 0.6); // gap between boards
      else if (mod(x + off, 64) === 0) c = mul(c, 0.55); // butt joint
      else if (mod(x, 16) === 8 && lz === 1) c = garage ? 0x4a3e36 : 0x3a2c22; // nail line on the joist
      else {
        if (hash3(Math.floor((x + row * 5) / 10), row, seed + 9) > 0.84) c = mul(c, 0.92); // grain
        const pd = pathD(wx, wz);
        if (pd < 0.55) c = mixRGB(c, garage ? 0xa89478 : 0xc08a56, 0.3 * (1 - pd / 0.55)); // worn bare by boots
        for (const [sx, sz, sr] of stains) {
          const d = Math.hypot(wx - sx, (wz - sz) * 1.3) / sr + lump(x, 0, z, 0.7, seed) * 0.25;
          if (d < 1) c = mixRGB(c, garage ? 0x3a3028 : 0x5a3420, 0.55 * (1 - d * d));
        }
      }
      m.set(x, 0, z, c);
      m.set(x, -1, z, 0x3a2414);
    }
  // sand blown in under the barn doors: a soft rippled drift fanning into the garage
  const dz0 = kz(CABIN_OPEN.barn.z0), dz1 = kz(CABIN_OPEN.barn.z1);
  for (let x = -1; x < KT + 46; x++)
    for (let z = dz0 - 14; z < dz1 + 10; z++) {
      const fx = (x + 1) / 46, mid = (dz0 + dz1) / 2 + fx * 8;
      const half = (dz1 - dz0) / 2 + 4 + fx * 10;
      const w = 1 - Math.abs(z - mid) / half;
      if (w <= 0) continue;
      const h = (1 - fx) * 3.2 * Math.sqrt(w) + lump(x, 0, z, 0.35, seed) * 0.8 - fx * 0.6;
      const ripple = Math.sin(x * 0.9 + z * 0.25) > 0.6;
      for (let y = 1; y <= Math.round(h); y++) m.set(x, y, z, y === Math.round(h) ? (ripple ? 0xe2bc88 : 0xd8b07a) : 0xc89e6a);
      if (h > 0.2 && h < 1 && hash3(x, 1, z) > 0.55) m.set(x, 1, z, 0xd8b07a); // scattered grains at the fringe
    }
  return S(m, KV);
}

/** the four walls: knotty honey T&G pine inside (baseboards, corner logs, log top plates, window frames with sills
 *  and cream sashes), bleached board-and-batten outside; barn-door posts and header; gable window; entry door frame */
export function cabinWalls(seed = 0): StaticModel {
  const m = new VoxelModel('cabin_walls');
  const O = CABIN_OPEN;
  type Op = { u0: number; u1: number; y0: number; y1: number };
  const barn: Op = { u0: kz(O.barn.z0), u1: kz(O.barn.z1), y0: 1, y1: ky(O.barn.y1) };
  const gable: Op = { u0: kz(O.gable.z0), u1: kz(O.gable.z1), y0: ky(O.gable.y0), y1: ky(O.gable.y1) };
  const back: Op = { u0: kx(O.backWin.x0), u1: kx(O.backWin.x1), y0: ky(O.backWin.y0), y1: ky(O.backWin.y1) };
  const right: Op = { u0: kz(O.rightWin.z0), u1: kz(O.rightWin.z1), y0: ky(O.rightWin.y0), y1: ky(O.rightWin.y1) };
  const door: Op = { u0: kz(O.door.z0), u1: kz(O.door.z1), y0: 1, y1: ky(O.door.y1) };
  const fronts: Op[] = O.frontWin.map((w) => ({ u0: kx(w.x0), u1: kx(w.x1), y0: ky(O.frontWinY[0]), y1: ky(O.frontWinY[1]) }));
  const inOp = (o: Op, u: number, y: number) => u >= o.u0 && u < o.u1 && y >= o.y0 && y < o.y1;
  /** set a voxel in wall-local coords: u along the wall, d = depth (0 outside .. KT-1 inside, KT.. protruding in) */
  const W = (side: 'back' | 'front' | 'left' | 'right', u: number, y: number, d: number, c: number, f = 0) => {
    if (side === 'back') m.set(u, y, d, c, f);
    else if (side === 'front') m.set(u, y, KNZ - 1 - d, c, f);
    else if (side === 'left') m.set(d, y, u, c, f);
    else m.set(KNX - 1 - d, y, u, c, f);
  };
  const walls: { side: 'back' | 'front' | 'left' | 'right'; len: number; top: (u: number) => number; ops: Op[]; s: number }[] = [
    { side: 'back', len: KNX, top: () => KYE + 1, ops: [back], s: seed },
    { side: 'front', len: KNX, top: () => KYE + 1, ops: fronts, s: seed + 7 },
    { side: 'left', len: KNZ, top: (u) => ceilRow(Math.max(KT, Math.min(KNZ - 1 - KT, u))) + 2, ops: [barn, gable], s: seed + 13 },
    { side: 'right', len: KNZ, top: (u) => ceilRow(Math.max(KT, Math.min(KNZ - 1 - KT, u))) + 2, ops: [right, door], s: seed + 21 },
  ];
  for (const w of walls) {
    for (let u = 0; u < w.len; u++) {
      const top = w.top(u);
      for (let y = 1; y <= top; y++) {
        if (w.ops.some((o) => inOp(o, u, y))) continue;
        for (let d = 0; d < KT; d++) W(w.side, u, y, d, d === KT - 1 ? pineAt(u, y, w.s) : d === 0 ? weatherAt(u, y, w.s) : 0x5a3a22);
        if (mod(u, 6) === 0 && hash3(u, w.s, 3) > 0.08) W(w.side, u, y, -1, mul(weatherAt(u, y, w.s + 1), 0.86)); // battens
      }
      // baseboard (skipped across door openings)
      if (!w.ops.some((o) => o.y0 <= 1 && u >= o.u0 - 1 && u < o.u1 + 1) && u >= KT && u < w.len - KT)
        for (let y = 1; y <= 3; y++) W(w.side, u, y, KT, y === 3 ? 0x9a6232 : wear(0x7a4a24, u, y, 0, 0.05));
    }
    // frames round every opening: chunky pine casing, a deep sill (windows), a cream sash with a cross muntin
    for (const o of w.ops) {
      const isDoor = o.y0 <= 1;
      for (let u = o.u0 - 2; u < o.u1 + 2; u++)
        for (let y = Math.max(1, o.y0 - 2); y < o.y1 + 2; y++) {
          if (inOp(o, u, y)) continue;
          const edge = u === o.u0 - 2 || u === o.u1 + 1 || y === o.y1 + 1;
          W(w.side, u, y, KT, edge ? 0x7a4620 : wear(0x9a5c2c, u, y, 1, 0.06));
          if (w.side === 'left' || w.side === 'right') W(w.side, u, y, -1, 0x5e5044); // outside casing
        }
      if (!isDoor) {
        for (let u = o.u0 - 3; u < o.u1 + 3; u++)
          for (let d = KT - 1; d <= KT + 2; d++) {
            W(w.side, u, o.y0 - 1, d, d === KT + 2 ? 0x8a5026 : 0xa86a36);
            W(w.side, u, o.y0 - 2, d, 0x7a4620);
          }
        const mu = Math.floor((o.u0 + o.u1) / 2), my = Math.floor((o.y0 + o.y1) / 2);
        for (let u = o.u0; u < o.u1; u++)
          for (let y = o.y0; y < o.y1; y++) {
            const sash = u === o.u0 || u === o.u1 - 1 || y === o.y0 || y === o.y1 - 1;
            const mun = u === mu || y === my;
            if (sash || mun) W(w.side, u, y, 2, sash ? 0xd8c8a4 : 0xe6d8b6);
          }
      }
    }
  }
  // barn-door posts and the big header log
  for (const zc of [barn.u0 - 3, barn.u1 + 2]) logAlong(m, 'y', 1, barn.y1 + 2, 2, zc, 3.2, seed + zc, 0x7a5232);
  logAlong(m, 'z', barn.u0 - 9, barn.u1 + 8, 2, barn.y1 + 2, 3.4, seed + 5, 0x6e4a2c);
  // corner logs (inside) and log top plates along the eave walls
  for (const [cx, cz] of [[KT, KT], [KNX - 1 - KT, KT], [KT, KNZ - 1 - KT], [KNX - 1 - KT, KNZ - 1 - KT]]) logAlong(m, 'y', 1, KYE + 1, cx, cz, 3.3, seed + cx + cz, 0x8a5a32);
  logAlong(m, 'x', KT, KNX - 1 - KT, KYE - 2, KT, 2.8, seed + 31, 0x8a5a32);
  logAlong(m, 'x', KT, KNX - 1 - KT, KYE - 2, KNZ - 1 - KT, 2.8, seed + 37, 0x8a5a32);
  // peg rail by the entry door (right wall, front corner): a moulded board with three turned pegs
  const pr0 = kz(2.35), pr1 = kz(3.15), py = ky(1.62);
  for (let u = pr0; u <= pr1; u++)
    for (let y = py - 2; y <= py + 2; y++) W('right', u, y, KT, y === py + 2 ? 0xb07440 : y === py - 2 ? 0x6e4220 : 0x96582a);
  for (const u of [pr0 + 3, Math.round((pr0 + pr1) / 2), pr1 - 3])
    for (let d = KT + 1; d <= KT + 4; d++) W('right', u, py + (d === KT + 4 ? 1 : 0), d, d === KT + 4 ? 0xb88050 : 0x8a5228);
  return S(m, KV);
}

/** lapped honey ceiling boards on log beams (ridge, purlins, two tie beams with king posts and garage posts), cedar
 *  shingles outside with gaps, soot over the hearth — and a ragged hole in the back slope with dangling boards */
export function cabinRoof(seed = 0): StaticModel & { meta: { hole: { x: number; z: number; rx: number; rz: number } } } {
  const m = new VoxelModel('cabin_roof');
  const H = CABIN_OPEN.roofHole;
  const hx = kx(H.x), hz = kz(H.z), hrx = H.rx / KV, hrz = H.rz / KV;
  const holeD = (x: number, z: number) => Math.hypot((x - hx) / hrx, (z - hz) / hrz) - (hash3(x, 3, z) - 0.5) * 0.3 - lump(x, 0, z, 0.45, seed) * 0.18;
  const OV = 7;
  const fx0 = kx(2.75), fx1 = kx(4.55); // fireplace chimney span (soot)
  const SH = [0x6e5a48, 0x7a6450, 0x645040, 0x72604c, 0x806a54];
  for (let x = -OV; x < KNX + OV; x++)
    for (let z = -OV; z < KNZ + OV; z++) {
      let row: number;
      if (z < KT) row = KYE - Math.ceil((KT - z) / 2);
      else if (z > KNZ - 1 - KT) row = KYE - Math.ceil((z - (KNZ - 1 - KT)) / 2);
      else row = ceilRow(z);
      const hd = holeD(x, z);
      if (hd < 1) continue;
      const k = Math.floor(Math.max(0, Math.min(z - KT, KNZ - 1 - KT - z)) / 2); // lapped board index
      const off = Math.floor(hash3(k, seed, 77) * 90);
      let tone = mul(HONEY[Math.floor(hash3(k, Math.floor((x + off) / 90), seed + 2) * HONEY.length)], 0.88);
      if (mod(x + off, 90) === 0) tone = mul(tone, 0.6);
      else if (mod(x + k * 7, 23) === 11 && hash3(Math.floor(x / 23), k, seed + 5) > 0.7) tone = 0x4a2410; // knot
      else if (hash3(Math.floor((x + k * 3) / 13), k, seed + 6) > 0.8) tone = mul(tone, 0.9);
      if (x >= fx0 - 6 && x <= fx1 + 6 && z < KT + 26) tone = mixRGB(tone, 0x2a1a12, 0.45 * (1 - (z - KT) / 26) * (1 - Math.max(0, Math.max(fx0 - x, x - fx1)) / 7)); // soot
      if (hd < 1.35) tone = mixRGB(tone, 0x3a2416, 0.5); // splintered, rain-stained edge
      const outside = x < 0 || x >= KNX || z < 0 || z >= KNZ;
      m.set(x, row, z, outside ? 0x5e4e40 : tone);
      m.set(x, row + 1, z, 0x5a3a22);
      const sh = SH[Math.floor(hash3(Math.floor((x + (row % 2) * 3) / 5), row, seed) * SH.length)];
      const missing = hash3(Math.floor(x / 5), row, seed + 11) > 0.965;
      if (!missing) m.set(x, row + 2, z, mod(x + (row % 2) * 3, 5) === 0 ? mul(sh, 0.78) : sh);
    }
  // ridge cap
  for (let x = -OV; x < KNX + OV; x++) for (let z = 67; z <= 72; z++) m.set(x, 86, z, z === 67 || z === 72 ? 0x5a4838 : 0x6a5644);
  // dangling broken boards at the hole's edge
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const bx = Math.round(hx + Math.cos(a) * hrx * 1.05), bz = Math.round(hz + Math.sin(a) * hrz * 1.05);
    const row = ceilRow(bz);
    const len = 6 + i * 2;
    for (let s = 0; s < len; s++) {
      const yy = row - Math.round(s * 0.8), xx = bx + Math.round(Math.cos(a) * -s * 0.35), zz = bz + Math.round(Math.sin(a) * -s * 0.2);
      for (let w = 0; w < 2; w++) m.set(xx + w, yy, zz, s === len - 1 ? 0x3a2416 : mul(HONEY[i % HONEY.length], 0.8));
    }
  }
  // beams: ridge, purlins, tie beams with king posts, garage posts
  logAlong(m, 'x', -OV + 2, KNX + OV - 3, 80, 70, 3.6, seed + 1, 0x7a4e2c);
  logAlong(m, 'x', -OV + 2, KNX + OV - 3, 60, 26, 2.6, seed + 2, 0x845532);
  logAlong(m, 'x', -OV + 2, KNX + OV - 3, 60, 113, 2.6, seed + 3, 0x845532);
  for (const bx of [kx(CABIN_OPEN.garageX), kx(2.3)]) {
    logAlong(m, 'z', 1, KNZ - 2, bx, 48, 2.9, seed + bx, 0x7e5030);
    logAlong(m, 'y', 50, 79, bx, 70, 2.4, seed + bx + 1, 0x7e5030);
  }
  const gx = kx(CABIN_OPEN.garageX);
  for (const pz of [KT + 4, KNZ - KT - 5]) logAlong(m, 'y', 1, 47, gx, pz, 2.7, seed + pz, 0x7a5232);
  return { model: m, voxelSize: KV, meta: { hole: { x: H.x, z: H.z, rx: H.rx, rz: H.rz } } };
}

// ---------------------------------------------------------------------------
// the hearth
// ---------------------------------------------------------------------------
const STONES = [0x8a8076, 0x9a8a78, 0x7a7068, 0xa69078, 0x6e6660, 0x8e7a66, 0xb09a80, 0x7e6a58, 0x948472];
/** fieldstone masonry: jittered cells → stone id + distance to the mortar line (voxels) */
function stoneAt(u: number, v: number, seed: number, cw = 8, ch = 6) {
  const gj = Math.floor(v / ch);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let j = gj - 1; j <= gj + 1; j++) {
    const ox = mod(j, 2) ? cw / 2 : 0;
    const gi = Math.floor((u - ox) / cw);
    for (let i = gi - 1; i <= gi + 1; i++) {
      const cx = i * cw + ox + cw * (0.25 + hash3(i, j, seed) * 0.5);
      const cy = j * ch + ch * (0.25 + hash3(j, i, seed + 1) * 0.5);
      const d = Math.hypot((u - cx) / cw, (v - cy) / ch);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = i * 7919 + j * 104729;
      } else if (d < d2) d2 = d;
    }
  }
  return { id, edge: (d2 - d1) * Math.min(cw, ch) * 0.9 };
}
const stoneCol = (id: number, seed: number, u: number, v: number) => wear(STONES[Math.floor(hash3(id, seed, 3) * STONES.length)], u, v, id, 0.05);

/** stone fireplace (1/32) against the back wall: rounded fieldstones in recessed mortar, an arched firebox with a
 *  sooty firebrick back and a keystone, a flagstone hearth, a hand-hewn mantel on stone corbels with candles, a tin
 *  and a jar, andirons, three logs with glowing cracks on an ember bed, the chimney breast up into the roof.
 *  meta (m, bottom-centre pivot): fire, crane (hinge), panHook, clock (centre of the breast above the mantel), mantel */
export function fireplaceCraft(seed = 0): StaticModel & { meta: { fire: V3; crane: V3; panHook: V3; clock: V3; mantel: number } } {
  const m = new VoxelModel('fireplace');
  const X0 = -29, X1 = 28, TOP = 92;
  const opTop = (x: number) => 26 + Math.round(3.5 * Math.cos((x / 16) * (Math.PI / 2)));
  const inOpening = (x: number, y: number) => x >= -15 && x <= 15 && y >= 4 && y <= opTop(x);
  for (let y = 0; y <= TOP; y++) {
    const zf = y < 46 ? 18 : 16; // the breast steps back above the mantel
    for (let x = X0; x <= X1; x++) {
      for (let z = 0; z <= zf; z++) {
        if (inOpening(x, y) && z > 6) continue; // the firebox
        let c: number;
        if (inOpening(x, y) || (z > 6 && x >= -16 && x <= 16 && y >= 4 && y <= opTop(x) + 1)) c = 0x2a2420;
        else c = 0x6a6058;
        m.set(x, y, z, c);
      }
      // front face masonry (recessed mortar, stones bulge)
      if (!inOpening(x, y)) {
        const nearArch = x >= -20 && x <= 20 && y > opTop(x) && y <= opTop(x) + 7 && y < 46;
        let st;
        if (nearArch) {
          // voussoirs: cells in polar coordinates round the arch centre
          const a = Math.atan2(y - 14, x), r = Math.hypot(x, y - 14);
          st = stoneAt(a * 18, r, seed + 4, 5, 9);
        } else st = stoneAt(x, y, seed, 8, 6);
        if (st.edge < 0.85) m.set(x, y, zf, 0x4e463e);
        else {
          let c = stoneCol(st.id, seed, x, y);
          if (y > opTop(x) - 1 && y < opTop(x) + 22 && Math.abs(x) < 18) c = mixRGB(c, 0x1e1814, 0.55 * (1 - (y - opTop(x)) / 22) * (1 - Math.abs(x) / 18)); // soot plume
          m.set(x, y, zf + 1, c);
          if (st.edge > 2.3) m.set(x, y, zf + 2, mul(c, 1.06));
        }
      }
    }
    // side faces
    for (const sx of [X0, X1])
      for (let z = 0; z <= (y < 46 ? 18 : 16); z++) {
        const st = stoneAt(z + (sx > 0 ? 40 : 0), y, seed + 2, 8, 6);
        const ox = sx + (sx > 0 ? 1 : -1);
        if (st.edge < 0.85) continue;
        m.set(ox, y, z, stoneCol(st.id, seed + 2, z, y));
        if (st.edge > 2.3 && z > 1) m.set(ox + (sx > 0 ? 1 : -1), y, z, mul(stoneCol(st.id, seed + 2, z, y), 1.05));
      }
  }
  // keystone
  sculpt(m, -3, opTop(0), 18, 3, opTop(0) + 8, 22, (x, y, z) => dRBox(x, y, z, 0, opTop(0) + 4, 19.5, 2.2 + (y - opTop(0)) * 0.12, 3.6, 1.6, 1), (x, y, z) => wear(0xa89478, x, y, z, 0.05));
  // firebrick back (sooty running bond)
  for (let x = -15; x <= 15; x++)
    for (let y = 4; y <= opTop(x); y++) {
      const row = Math.floor(y / 2), off = mod(row, 2) * 3;
      const mort = mod(y, 2) === 0 || mod(x + off, 6) === 0;
      m.set(x, y, 6, mort ? 0x1e1612 : mixRGB(hash3(Math.floor((x + off) / 6), row, seed) > 0.5 ? 0x5a2e22 : 0x4a2418, 0x141010, clamp01((y - 8) / 20) * 0.7));
    }
  // flagstone hearth
  for (let x = X0 - 6; x <= X1 + 6; x++)
    for (let z = 7; z <= 34; z++) {
      if (z < 19 && !(x >= -15 && x <= 15)) continue;
      const st = stoneAt(x, z, seed + 9, 15, 11);
      const edgeIn = Math.min(x - (X0 - 6), X1 + 6 - x, 34 - z);
      const raised = hash3(st.id, 1, seed) > 0.6 ? 1 : 0;
      for (let y = 0; y <= 2; y++) m.set(x, y, z, 0x5a5048);
      if (st.edge < 0.8) continue;
      let c = stoneCol(st.id, seed + 9, x, z);
      if (z < 24 && Math.abs(x) < 20) c = mixRGB(c, 0x8a8480, 0.3 * (1 - Math.abs(x) / 20)); // ash dust
      if (edgeIn > 0 || st.edge > 1.6) m.set(x, 3, z, c);
      if (raised && st.edge > 1.8 && edgeIn > 1) m.set(x, 4, z, mul(c, 1.05));
    }
  // ember bed, andirons, logs (charred, with glowing cracks)
  for (let x = -14; x <= 14; x++)
    for (let z = 7; z <= 18; z++) {
      const h = 4 + (hash3(x, 2, z) > 0.55 ? 1 : 0);
      for (let y = 4; y <= h; y++) m.set(x, y, z, 0x5a5652);
      if (hash3(x, 3, z) > 0.72) m.set(x, h, z, hash3(x, 4, z) > 0.5 ? 0xff7a2a : 0xffb04a, VF.GLOW);
      else if (hash3(x, 5, z) > 0.5) m.set(x, h, z, 0x2a2624);
    }
  for (const ax of [-9, 9]) {
    for (let y = 5; y <= 9; y++) m.set(ax, y, 10, 0x2a2826, VF.METAL);
    for (let z = 10; z <= 19; z++) m.set(ax, 6, z, 0x2a2826, VF.METAL);
    lathe(m, ax, 19, 6, 13, (t) => 1.2 + Math.sin(t * Math.PI) * 0.8, (_x, y) => (y > 11 ? 0x4a4642 : 0x2a2826), {}, VF.METAL);
    m.set(ax, 14, 19, 0x6a6460, VF.METAL);
  }
  const fireLog = (a: V3, b: V3, r: number, sd: number) => {
    const tmp = new VoxelModel('log');
    sculpt(tmp, Math.min(a[0], b[0]) - r - 1, Math.min(a[1], b[1]) - r - 1, Math.min(a[2], b[2]) - r - 1, Math.max(a[0], b[0]) + r + 1, Math.max(a[1], b[1]) + r + 1, Math.max(a[2], b[2]) + r + 1,
      (x, y, z) => dCap(x, y, z, a, b, r, r * 0.85) + lump(x, y, z, 0.6, sd) * 0.4,
      (x, y, z, d) => {
        const under = y < (a[1] + b[1]) / 2 - r * 0.2;
        if (d > -1.1 && under && hash3(x, y, z + sd) > 0.45) return hash3(x, y + 1, z) > 0.5 ? 0xff6a1a : 0xffa03a; // glowing cracks
        if (d > -1.1) return under ? 0x1a1410 : hash3(Math.floor(x / 2), y, z) > 0.6 ? 0x3a2416 : 0x4a3020; // bark / char
        return 0x8a5a32;
      });
    tmp.forEach((x, y, z, c) => m.set(x, y, z, c, c === 0xff6a1a || c === 0xffa03a ? VF.GLOW : 0));
  };
  fireLog([-12, 8, 10], [11, 9, 11], 2.6, 1);
  fireLog([-11, 8, 15], [12, 8, 14], 2.4, 2);
  fireLog([-6, 12, 9], [8, 11, 15], 2.2, 3);
  // hand-hewn mantel on carved stone corbels
  sculpt(m, X0 - 6, 38, 14, X1 + 6, 44, 25, (x, y, z) => dRBox(x, y, z, -0.5, 41, 19.5, 34, 2.8, 5.2, 1.2) + lump(x, y, z, 0.3, seed) * 0.3, (x, y, z, d) => {
    if (x <= X0 - 5 || x >= X1 + 5) return mod(Math.round(Math.hypot(y - 41, z - 19.5)), 2) ? 0x6a4426 : 0x4e301a; // end grain
    const facet = mod(Math.floor((x + 40) / 5), 2) ? 1.05 : 0.95; // adze scallops
    let c = mul(0x5e3c22, facet);
    if (d > -1 && y === 44) c = mul(c, 1.15);
    if (Math.abs(z - 21) < 1 && mod(x, 29) < 12 && d > -1) c = 0x2a180c; // a check crack
    return c;
  });
  for (const cx of [X0 + 3, X1 - 3]) sculpt(m, cx - 3, 30, 15, cx + 3, 38, 23, (x, y, z) => dRBox(x, y, z, cx, 34, 19, 2.6 - (38 - y) * 0.06, 3.8, 3.4, 1.3), (x, y, z) => wear(0x9a8a78, x, y, z, 0.05));
  // mantel clutter: two drippy candles in brass sticks, a tin, a jar of matches
  for (const [cx, h] of [[-26, 7], [25, 5]]) {
    lathe(m, cx, 19, 45, 46, (t) => 2.2 - t * 0.6, () => IP.brass, {}, VF.METAL);
    lathe(m, cx, 19, 47, 46 + h, () => 1.0, (x, y, z) => (y === 46 + h ? 0xfff0d0 : hash3(x, y, z) > 0.75 ? 0xe8dcc0 : 0xf2e8d0), {});
    m.set(cx + 1, 47 + Math.floor(h / 2), 19, 0xe8dcc0);
    m.set(cx, 47 + h, 19, 0xffd890, VF.GLOW);
  }
  lathe(m, -18, 18, 45, 49, () => 2.1, (x, y, z, o) => (y === 49 ? 0x8a8a86 : o && y === 47 ? 0xb83a2a : 0x9a9a96), { dents: [{ a: 1, y0: 45, y1: 49, depth: 0.6, width: 0.6 }] }, VF.METAL);
  lathe(m, 15, 20, 45, 50, (t) => 1.9 - (t > 0.85 ? 0.5 : 0), (x, y, z, o) => (y === 50 ? 0x8a6440 : o ? 0xa8c0b8 : 0xc8b890), { hollow: false }, VF.SOFTAO);
  // forged hook for the pan (left side face) — the rig hangs from it
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2, py = b.minY;
  const P = (x: number, y: number, z: number): V3 => [(x - px) * CVS, (y - py) * CVS, (z - pz) * CVS];
  return { model: m, voxelSize: CVS, meta: { fire: P(0, 12, 12), crane: P(-14, 7, 15), panHook: P(X0 - 2, 52, 12), clock: P(0, 66, 19), mantel: (45 - py) * CVS } };
}

// the organic sculpting kit, shared with the workshop furniture (props/workshop.ts)
export { smin, dEll, dCap, dRBox, sculpt, lump, exposedV, logAlong, lathe, mul, wear, IP, HONEY, pineAt, clamp01, stoneAt, stoneCol, chainLinks, CVS, SMV };
export type { SDF, LatheOpts };
