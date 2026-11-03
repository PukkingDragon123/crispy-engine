// Wild West props — STYLE v2. Chunky clean planks with dark seams, a few nail
// heads, iron hoops, painted lettering. Small/medium props 1/20 m, buildings
// 1/12 m (wagon & gallows 1/16 m). Fronts face +Z.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, meters, board, post, seg, cylY, inCircle, chunk, sandDrift, rope, sagPoints, Wall, plankWall, windowW, doorW, tinRoof, shingleRoof, stampText, textWidth, toMeters, masonry, mod, mixRGB } from './helpers';
import { cowSkullModel } from './nature';
import { NOCOL } from './ruins';
import { hash3, noise as noiseField } from '../../../engine/math/rand';
import { WOOD, WoodName, WoodSpecies, agedPaper, blackIron, rustedIron, tin, brass, leather, weathered, darkWood, timber, split, wrapBand, nailHead, ironStrap, knotHole, wormHoles, bulletHole, bolt, chainLinks, sandMat, fieldStone, sandstone } from '../materials';

const VS = 1 / 20;
const BVS = 1 / 12;

// ---------------------------------------------------------------------------
// shared building kit (also used by landmarks)
// ---------------------------------------------------------------------------
export interface Bldg {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  fy: number;
  top: number;
  front: Wall;
  back: Wall;
  left: Wall;
  right: Wall;
}

/** four plank walls on a raised plank floor (voxel units). cx,cz = centre. */
export function building(m: VoxelModel, cx: number, cz: number, wd: number, dp: number, h: number, o: { fy?: number; vertical?: boolean; r?: Ramp; bw?: number; seed?: number; corner?: Ramp } = {}): Bldg {
  const x0 = cx - Math.round(wd / 2), x1 = x0 + wd, z0 = cz - Math.round(dp / 2), z1 = z0 + dp;
  const fy = o.fy ?? 3;
  const r = o.r ?? PR.wood;
  const seed = o.seed ?? 0;
  // stilts + floor
  for (let x = x0; x <= x1 - 1; x += 9) for (const z of [z0, z1 - 2]) m.box(x, 0, z, x + 1, fy - 1, z + 1, PR.woodDark.shade);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) m.set(x, fy, z, mod(x - x0, 4) === 0 ? PR.woodDark.dark : PR.woodDark.base);
  const front: Wall = { axis: 'x', out: z1, sign: 1, thick: 2 };
  const back: Wall = { axis: 'x', out: z0, sign: -1, thick: 2 };
  const left: Wall = { axis: 'z', out: x1, sign: 1, thick: 2 };
  const right: Wall = { axis: 'z', out: x0, sign: -1, thick: 2 };
  const vert = o.vertical ?? true;
  let s = 0;
  for (const [w, a, b] of [[front, x0, x1], [back, x0, x1], [left, z0, z1], [right, z0, z1]] as [Wall, number, number][])
    plankWall(m, w, a, b, fy + 1, fy + h, { vertical: vert, r, bw: o.bw ?? 3, seed: seed + s++ });
  // corner boards
  const cr = o.corner ?? PR.woodDark;
  for (const [x, z] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]]) m.box(x, fy, z, x, fy + h, z, cr.base);
  return { x0, x1, z0, z1, fy, top: fy + h, front, back, left, right };
}

/** gable roof over a building, ridge along `ridge`, tin or shingles, with gable-end infill */
export function gableRoof(m: VoxelModel, b: Bldg, ridge: 'x' | 'z', rise: number, o: { tin?: boolean; over?: number; seed?: number; r?: Ramp; gable?: Ramp } = {}) {
  const over = o.over ?? 3;
  const halfSpan = ridge === 'x' ? (b.z1 - b.z0) / 2 + over : (b.x1 - b.x0) / 2 + over;
  const cA = ridge === 'x' ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
  const yAt = (x: number, z: number) => b.top + 1 + Math.round(rise * (1 - Math.abs((ridge === 'x' ? z : x) - cA) / halfSpan));
  const gr = o.gable ?? PR.wood;
  // gable ends
  for (let a = ridge === 'x' ? b.z0 : b.x0; a <= (ridge === 'x' ? b.z1 : b.x1); a++) {
    const yy = ridge === 'x' ? yAt(b.x0, a) : yAt(a, b.z0);
    for (let y = b.top + 1; y < yy; y++) {
      const c = mod(a, 3) === 0 ? gr.dark : gr.base;
      if (ridge === 'x') {
        m.set(b.x0, y, a, c).set(b.x1, y, a, c);
      } else {
        m.set(a, y, b.z0, c).set(a, y, b.z1, c);
      }
    }
  }
  const X0 = ridge === 'x' ? b.x0 - over : b.x0 - over, X1 = b.x1 + over, Z0 = b.z0 - over, Z1 = b.z1 + over;
  if (o.tin) tinRoof(m, X0, X1, Z0, Z1, yAt, ridge === 'x' ? 'x' : 'z', o.seed ?? 0, 2);
  else shingleRoof(m, X0, X1, Z0, Z1, yAt, ridge, o.r ?? PR.woodDark);
  // ridge cap
  const cap = o.tin ? PR.tin.dark : PR.woodDark.dark;
  if (ridge === 'x') for (let x = X0; x <= X1; x++) m.set(x, yAt(x, Math.round(cA)) + 1, Math.round(cA), cap, o.tin ? VF.METAL : 0);
  else for (let z = Z0; z <= Z1; z++) m.set(Math.round(cA), yAt(Math.round(cA), z) + 1, z, cap, o.tin ? VF.METAL : 0);
  return yAt;
}

/** flat sloped roof (lean-to): high at the back, low at the front */
export function shedRoof(m: VoxelModel, b: Bldg, drop: number, o: { tin?: boolean; over?: number; seed?: number } = {}) {
  const over = o.over ?? 3;
  const yAt = (_x: number, z: number) => b.top + 1 + Math.round(drop * (1 - (z - (b.z0 - over)) / (b.z1 - b.z0 + over * 2)));
  for (let z = b.z0; z <= b.z1; z++) {
    const yy = yAt(0, z);
    for (let y = b.top + 1; y < yy; y++) {
      m.set(b.x0, y, z, PR.wood.base).set(b.x1, y, z, PR.wood.base);
    }
  }
  for (let x = b.x0; x <= b.x1; x++) for (let y = b.top + 1; y < yAt(0, b.z0); y++) m.set(x, y, b.z0, mod(x, 3) ? PR.wood.base : PR.wood.dark);
  if (o.tin ?? true) tinRoof(m, b.x0 - over, b.x1 + over, b.z0 - over, b.z1 + over, yAt, 'x', o.seed ?? 0, 2);
  else shingleRoof(m, b.x0 - over, b.x1 + over, b.z0 - over, b.z1 + over, yAt, 'x');
  return yAt;
}

/** boardwalk porch in front of a wall (z+ front only) with posts and a sloped tin/shingle roof */
export function porchFront(m: VoxelModel, b: Bldg, u0: number, u1: number, depth: number, roofY: number, o: { tin?: boolean; seed?: number; rail?: boolean; steps?: boolean; postR?: Ramp } = {}) {
  const z0 = b.z1 + 1, z1 = b.z1 + depth;
  for (let x = u0; x <= u1; x++) for (let z = z0; z <= z1; z++) m.set(x, b.fy, z, mod(x, 4) === 0 ? PR.wood.dark : (z === z1 ? PR.wood.hi : PR.wood.base));
  for (let x = u0; x <= u1; x += 4) m.box(x, 0, z1 - 1, x, b.fy - 1, z1 - 1, PR.woodDark.shade);
  const pr = o.postR ?? PR.woodDark;
  const posts = [u0, u1 - 1, ...(u1 - u0 > 40 ? [Math.round((u0 + u1) / 2)] : [])];
  for (const x of posts) post(m, x, z1 - 2, b.fy + 1, roofY, 2, pr, x);
  // roof
  const yAt = (_x: number, z: number) => roofY + Math.round(3 * (1 - (z - z0) / Math.max(1, z1 + 2 - z0)));
  if (o.tin ?? true) tinRoof(m, u0 - 1, u1 + 1, z0, z1 + 2, yAt, 'x', o.seed ?? 0, 1);
  else shingleRoof(m, u0 - 1, u1 + 1, z0, z1 + 2, yAt, 'x');
  // beam
  for (let x = u0; x <= u1; x++) m.set(x, roofY - 1, z1 - 1, pr.base);
  if (o.rail) {
    for (let x = u0; x <= u1; x++) if (x < (u0 + u1) / 2 - 5 || x > (u0 + u1) / 2 + 5) m.set(x, b.fy + 6, z1 - 1, PR.wood.hi);
    for (let x = u0; x <= u1; x += 3) if (x < (u0 + u1) / 2 - 5 || x > (u0 + u1) / 2 + 5) m.box(x, b.fy + 1, z1 - 1, x, b.fy + 5, z1 - 1, PR.wood.base);
  }
  if (o.steps ?? true) {
    const mid = Math.round((u0 + u1) / 2);
    for (let s = 0; s < b.fy; s++) m.box(mid - 4, s, z1 + 1 + (b.fy - 1 - s), mid + 4, s, z1 + 1 + (b.fy - 1 - s), s % 2 ? PR.wood.base : PR.wood.shade);
  }
}

/** sign board (planks + frame) with painted text, front face at zf (facing +Z). returns width */
export function signPanel(m: VoxelModel, cx: number, yBot: number, zf: number, lines: string[], o: { bg?: Ramp; ink?: number; pad?: number; thick?: number; scale?: number } = {}) {
  const bg = o.bg ?? PR.paintWhite;
  const ink = o.ink ?? PR.ink.base;
  const pad = o.pad ?? 2;
  const sc = o.scale ?? 1;
  const tw = Math.max(...lines.map((l) => textWidth(l, 1, sc)));
  const W = tw + pad * 2 + 2, H = lines.length * 6 * sc - sc + pad * 2 + 2;
  const x0 = cx - Math.floor(W / 2);
  const th = o.thick ?? 2;
  for (let x = x0; x < x0 + W; x++)
    for (let y = yBot; y < yBot + H; y++) {
      const frame = x === x0 || x === x0 + W - 1 || y === yBot || y === yBot + H - 1;
      for (let d = 0; d < th; d++) m.set(x, y, zf - d, frame ? PR.woodDark.base : mod(y - yBot, 4) === 0 ? bg.shade : bg.base);
    }
  lines.forEach((l, i) => stampText(m, 'z+', l, cx - Math.floor(textWidth(l, 1, sc) / 2), yBot + H - 2 - pad - i * 6 * sc, zf + 1, { color: ink, scale: sc }));
  return W;
}

// ---------------------------------------------------------------------------
// crates & barrels (1/20)
// ---------------------------------------------------------------------------
/** crate body: frame boards on every edge, horizontal planks, optional X-brace on sides */
function crateBody(m: VoxelModel, x0: number, y0: number, z0: number, s: number, panel: Ramp, frame: Ramp, brace: 'x' | '/' | 'none', seed: number) {
  const x1 = x0 + s - 1, y1 = y0 + s - 1, z1 = z0 + s - 1;
  const fw = 2;
  const rng = rngOf(seed, 7);
  const dashRows = new Set([rng.int(1, 3), rng.int(5, 7), rng.int(9, 11)]);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const ex = x - x0 < fw || x1 - x < fw, ey = y - y0 < fw || y1 - y < fw, ez = z - z0 < fw || z1 - z < fw;
        const onSurf = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        if (!onSurf) {
          m.set(x, y, z, panel.shade);
          continue;
        }
        const frameV = (ex && ey) || (ex && ez) || (ey && ez);
        if (frameV) {
          const topEdge = y === y1;
          m.set(x, y, z, topEdge ? frame.hi : frame.base);
          continue;
        }
        // panel planks: horizontal on the sides, along x on the top
        const row = y === y1 || y === y0 ? z - z0 : y - y0;
        let c = mod(row, 4) === 0 ? panel.dark : panel.base;
        if (c === panel.base && dashRows.has(mod(row, 12)) && mod((x + z) * 3 + row, 11) < 3) c = panel.shade;
        m.set(x, y, z, c);
      }
  // braces on the four sides
  if (brace !== 'none') {
    const L = s - fw * 2;
    for (let k = 0; k < L; k++) {
      const a = fw + k, b1 = fw + Math.round((k * (L - 1)) / Math.max(1, L - 1));
      const b2 = s - 1 - b1;
      for (const [fx, fz, out] of [[1, 0, z1 + 1], [1, 0, z0 - 1], [0, 1, x1 + 1], [0, 1, x0 - 1]] as const) {
        const ps = brace === 'x' ? [b1, b2] : [b1];
        for (const bb of ps) {
          for (let t = 0; t < 2; t++) {
            const yy = y0 + bb;
            if (fx) m.set(x0 + a, yy + t - (t ? 1 : 0), out === z1 + 1 ? z1 : z0, frame.shade);
            else m.set(out === x1 + 1 ? x1 : x0, yy + t - (t ? 1 : 0), z0 + a, frame.shade);
          }
        }
        void fz;
      }
    }
  }
  // nail heads at frame corners on front/back
  for (const [x, z] of [[x0, z1], [x1, z1], [x0, z0], [x1, z0]])
    for (const y of [y0 + 1, y1 - 1]) {
      const nx = x === x0 ? x0 + 1 : x1 - 1;
      m.set(nx, y, z === z1 ? z1 + 1 : z0 - 1, PR.iron.dark, VF.METAL);
    }
}

export function crate(seed = 0): StaticModel {
  const m = new VoxelModel('crate');
  const r = rngOf(seed, 3);
  const k = mod(seed, 4);
  const panel = k === 2 ? PR.woodLight : PR.wood;
  const s = 18;
  crateBody(m, -9, 0, -9, s, panel, PR.woodDark, k === 1 ? '/' : k === 3 ? 'none' : 'x', seed);
  if (k === 2) {
    // stencilled SUPPLY + arrow on the front panel
    for (let x = -6; x <= 5; x++) for (let y = 5; y <= 12; y++) m.set(x, y, 8, panel.base);
    stampText(m, 'z+', 'AMMO', -7, 11, 10, { color: PR.ink.shade });
    for (let x = -6; x <= 5; x++) m.set(x, 5, 9, PR.ink.shade);
  }
  if (k === 3) {
    // a smaller crate stacked on top, rotated a little by offset
    crateBody(m, -6 + r.int(-1, 1), s, -5, 12, PR.woodLight, PR.woodDark, 'none', seed + 9);
  }
  return S(m, VS);
}

export function tntCrate(seed = 0): StaticModel {
  const m = new VoxelModel('tnt_crate');
  const s = 18;
  crateBody(m, -9, 0, -9, s, PR.barnRed, PR.woodDark, 'none', seed);
  // cream TNT stencil on all four sides
  const tw = textWidth('TNT');
  stampText(m, 'z+', 'TNT', -Math.floor(tw / 2), 11, 10, { color: PR.paintWhite.base });
  stampText(m, 'z-', 'TNT', Math.floor(tw / 2) - 1, 11, -11, { color: PR.paintWhite.base });
  stampText(m, 'x+', 'TNT', Math.floor(tw / 2) - 1, 11, 10, { color: PR.paintWhite.base });
  stampText(m, 'x-', 'TNT', -Math.floor(tw / 2), 11, -11, { color: PR.paintWhite.base });
  // warning stripe band under the text
  for (let x = -7; x <= 6; x++) m.set(x, 4, 9, mod(x, 4) < 2 ? PR.paintYellow.base : PR.ink.base);
  // dynamite sticks poking out of the lid
  const sticks: [number, number, number][] = seed % 2 ? [[-5, -3, 7], [-1, 1, 9], [3, -4, 6], [2, 3, 8]] : [[-4, 0, 8], [0, -3, 6], [3, 2, 9]];
  for (const [x, z, h] of sticks) {
    for (let y = s - 2; y < s + h; y++) m.box(x, y, z, x + 1, y, z + 1, y === s + h - 1 ? PR.red.hi : mod(y, 5) === 0 ? PR.paintWhite.shade : PR.red.base);
    // fuse
    m.set(x, s + h, z, PR.ink.base).set(x, s + h + 1, z + 1, PR.ink.base).set(x + 1, s + h + 2, z + 1, PR.rope.shade);
  }
  return S(m, VS);
}

/** stave barrel body: bulging stepped cylinder, stave seams, 3 iron hoops, lid with chime */
function barrelBody(m: VoxelModel, cx: number, cz: number, y0: number, H: number, R: number, wood: Ramp, o: { band?: Ramp; lid?: boolean } = {}) {
  const staves = 12;
  const hoops = [y0 + 2, y0 + Math.round(H * 0.5), y0 + H - 3];
  for (let y = y0; y <= y0 + H; y++) {
    const t = (y - y0) / H;
    const rr = R - 1.2 + Math.sin(t * Math.PI) * 1.4;
    const RR = Math.ceil(rr) + 1;
    const hoop = hoops.includes(y) || hoops.includes(y - 1);
    for (let x = -RR; x <= RR; x++)
      for (let z = -RR; z <= RR; z++) {
        if (!inCircle(x, z, rr)) continue;
        const outer = !inCircle(x, z, rr - 1);
        let c = wood.base;
        if (outer) {
          const a = Math.atan2(z, x);
          const sk = mod((a / (Math.PI * 2)) * staves, 1);
          c = sk < 0.1 ? wood.shade : y > y0 + H - 2 ? wood.hi : wood.base;
          if (hoop) c = o.band ? o.band.base : PR.iron.base;
          if (hoop && hoops.includes(y)) c = o.band ? o.band.hi : PR.iron.hi;
        }
        m.set(cx + x, y, cz + z, c, outer && hoop && !o.band ? VF.METAL : 0);
      }
  }
  if (o.lid ?? true) {
    const top = y0 + H;
    const rr = R - 1.2;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        if (!inCircle(x, z, rr)) continue;
        const rim = !inCircle(x, z, rr - 1);
        m.set(cx + x, top + (rim ? 1 : 0), cz + z, rim ? wood.hi : mod(x, 4) === 0 ? wood.dark : wood.base);
      }
  }
}

export function barrel(seed = 0): StaticModel {
  const m = new VoxelModel('barrel');
  const k = mod(seed, 2);
  barrelBody(m, 0, 0, 0, 20, 8, k ? PR.woodDark : PR.wood, k ? { band: PR.red } : {});
  return S(m, VS);
}

/** whiskey barrel lying in a cradle with a brass spigot (seed 2: standing with a tap and tin cup) */
export function whiskeyBarrel(seed = 0): StaticModel {
  const m = new VoxelModel('whiskey_barrel');
  const R = 7, L = 18;
  if (mod(seed, 2) === 0) {
    barrelBody(m, 0, 0, 0, 19, 7, PR.wood);
    stampText(m, 'z+', 'XXX', -5, 13, 9, { color: PR.ink.base });
    m.box(-1, 5, 8, 0, 6, 10, PR.brass.base, VF.METAL);
    m.set(-1, 4, 10, PR.brass.shade, VF.METAL);
    // tin cup hanging on the hoop
    m.box(4, 9, 7, 5, 11, 8, PR.tin.base, VF.METAL);
    return S(m, VS);
  }
  // lying along z: a standing barrel rotated onto its side, axis at y = cy
  const cy = R + 3;
  const tmp = new VoxelModel('t');
  barrelBody(tmp, 0, 0, 0, L, R, PR.wood);
  tmp.forEach((x, y, z, c, f) => m.set(x, cy + z, y - L / 2, c, f));
  // spigot on the front end
  m.box(-1, cy - 3, L / 2 + 2, 0, cy - 2, L / 2 + 4, PR.brass.base, VF.METAL);
  m.set(-1, cy - 4, L / 2 + 4, PR.brass.shade, VF.METAL);
  m.box(-1, cy - 1, L / 2 + 3, 0, cy - 1, L / 2 + 3, PR.brass.hi, VF.METAL);
  stampText(m, 'x+', 'XXX', 5, cy + 2, R + 3, { color: PR.ink.base });
  // cradle saddles
  for (const z of [-6, 5]) {
    m.box(-9, 0, z, 8, 2, z + 1, PR.woodDark.base);
    for (let x = -8; x <= 7; x++) {
      const yTop = cy - Math.round(Math.sqrt(Math.max(0, R * R - x * x)));
      for (let y = 3; y < yTop; y++) m.set(x, y, z, PR.woodDark.base);
    }
  }
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// fences, posts & signs (1/20)
// ---------------------------------------------------------------------------
function fenceCore(len: number, seed: number, damage: 0 | 1 | 2) {
  const m = new VoxelModel('fence');
  const L = Math.round(len / VS);
  const r = rngOf(seed, 17);
  const step = 30;
  const xs: number[] = [];
  for (let x = -Math.floor(L / 2); x <= Math.floor(L / 2); x += step) xs.push(x);
  if (xs[xs.length - 1] < Math.floor(L / 2) - 4) xs.push(Math.floor(L / 2));
  const lean = damage === 2 ? r.int(1, xs.length - 2) : -1;
  xs.forEach((x, i) => {
    if (i === lean) {
      seg(m, [x, 0, 0], [x + 9, 20, 0], 3, PR.woodGrey.base);
      m.box(x + 8, 20, -1, x + 10, 21, 1, PR.woodGrey.hi);
      return;
    }
    post(m, x - 1, -1, 0, 24, 3, PR.woodGrey, seed + i);
    m.set(x, 25, 0, PR.woodGrey.hi);
  });
  for (let i = 0; i < xs.length - 1; i++) {
    for (const [y, ri] of [[8, 0], [17, 1]] as const) {
      const a = xs[i] - 1, b = xs[i + 1] + 1;
      const broken = (damage === 1 && i === 1 && ri === 1) || (damage === 2 && (i === lean || i + 1 === lean) && ri === 0) || (damage === 2 && i === lean - 1);
      if (broken) {
        // splintered halves hanging down
        const mid = Math.round((a + b) / 2);
        for (let x = a; x < mid - 2; x++) m.box(x, y - Math.max(0, Math.floor((x - (mid - 8)) / 2)), 2, x, y + 1 - Math.max(0, Math.floor((x - (mid - 8)) / 2)), 2, PR.woodGrey.base);
        m.set(mid - 2, y, 2, PR.woodGrey.hi).set(mid - 3, y + 1, 2, PR.woodGrey.hi);
        continue;
      }
      board(m, a, y, 2, b, y + 2, 3, PR.woodGrey, 'x', seed * 7 + i * 3 + ri);
      for (const x of [xs[i], xs[i + 1]]) m.set(x, y + 1, 4, PR.iron.dark, VF.METAL);
    }
  }
  return m;
}
export function fence(len = 4, seed = 0): StaticModel {
  return S(fenceCore(len, seed, 0), VS);
}
export function fenceBroken(seed = 0, len = 4, damage: 1 | 2 = 1): StaticModel {
  return S(fenceCore(len, seed, damage), VS);
}

const SIGN_WORDS = ['TOWN', 'MINE', 'GOLD', 'WATER', 'FORT', 'DANGER', 'RANCH', 'BOOT HILL', 'SALOON', 'NO HOPE'];
export function signpost(seed = 0): StaticModel {
  const r = rngOf(seed, 23);
  const m = new VoxelModel('signpost');
  post(m, -1, -1, 0, 50, 3, PR.woodGrey, seed);
  m.box(-2, 51, -2, 2, 51, 2, PR.woodGrey.dark);
  const n = r.int(1, 3);
  const words = [...SIGN_WORDS].sort(() => r.next() - 0.5).slice(0, n);
  words.forEach((w, i) => {
    const dir = r.pick([-1, 1]);
    const tw = textWidth(w);
    const L = tw + 6;
    const y0 = 40 - i * 9;
    const x0 = dir > 0 ? 1 : -L;
    const x1 = dir > 0 ? L : -1;
    const ramp = i % 2 ? PR.woodLight : PR.wood;
    for (let x = x0; x <= x1; x++) {
      // arrow tip: taper the last 3 columns
      const tipD = dir > 0 ? x1 - x : x - x0;
      const shrink = tipD < 3 ? 3 - tipD : 0;
      for (let y = y0 + shrink; y <= y0 + 6 - shrink; y++) for (const z of [1, 2]) m.set(x, y, z, y === y0 + 6 - shrink ? ramp.hi : y === y0 + shrink ? ramp.shade : ramp.base);
    }
    stampText(m, 'z+', w, dir > 0 ? 2 : -L + 1, y0 + 5, 3, { color: PR.ink.base });
    m.set(dir > 0 ? 2 : -2, y0 + 3, 3, PR.iron.dark, VF.METAL);
  });
  sandDrift(m, 0, 0, 4, 4, 2, 0, seed);
  return S(m, VS);
}

export function hitchingPost(seed = 0): StaticModel {
  const m = new VoxelModel('hitching_post');
  for (const x of [-20, 18]) post(m, x, -1, 0, 22, 3, PR.woodGrey, seed + x);
  board(m, -21, 20, -1, 21, 22, 1, PR.woodGrey, 'x', seed);
  // rope tied loosely
  rope(m, sagPoints([-8, 20, 2], [-2, 20, 2], 5, 6));
  m.box(-9, 18, 2, -8, 21, 2, PR.rope.base);
  // water bucket
  cylY(m, 8, 6, 0, 6, 3.4, PR.wood.base);
  cylY(m, 8, 6, 1, 6, 2.4, PR.water.base);
  for (const y of [1, 5]) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (inCircle(x, z, 3.4) && !inCircle(x, z, 2.4)) m.set(8 + x, y, 6 + z, PR.iron.base, VF.METAL);
  rope(m, sagPoints([5, 7, 6], [11, 7, 6], -3, 6), PR.iron.dark);
  return S(m, VS);
}

/** wagon wheel model in the XY plane centred at origin (radius in voxels) */
function wheelModel(R: number, wood: Ramp = PR.wood, spokes = 10): VoxelModel {
  const m = new VoxelModel('wheel');
  for (let x = -R - 1; x <= R + 1; x++)
    for (let y = -R - 1; y <= R + 1; y++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= R + 0.5 && d > R - 0.5) for (const z of [-1, 0, 1]) m.set(x, y, z, PR.iron.base, VF.METAL);
      else if (d <= R - 0.5 && d > R - 2.5) for (const z of [-1, 0, 1]) m.set(x, y, z, y > 0 ? wood.hi : wood.base);
    }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (let k = 2; k <= R - 2; k++) m.set(Math.round(Math.cos(a) * k), Math.round(Math.sin(a) * k), 0, k < 4 ? wood.shade : wood.base);
  }
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (inCircle(x, y, 2.6)) for (let z = -2; z <= 2; z++) m.set(x, y, z, Math.abs(z) === 2 ? PR.iron.dark : wood.shade, Math.abs(z) === 2 ? VF.METAL : 0);
  return m;
}

export function wagonWheel(seed = 0): StaticModel {
  const m = new VoxelModel('wagon_wheel');
  const R = 13;
  const w = wheelModel(R, PR.wood, 10);
  if (mod(seed, 2) === 1) {
    // leaning upright against nothing — standing slightly sunk in sand
    w.forEach((x, y, z, c, f) => m.set(x, y + R - 1, z, c, f));
    m.carveWhere((_x, y) => y < 0);
    sandDrift(m, 0, 0, 6, 4, 3, 0, seed);
  } else {
    // lying flat
    w.forEach((x, y, z, c, f) => m.set(x, z + 2, y, c, f));
    sandDrift(m, 0, 0, R + 3, R + 3, 2, 0, seed);
  }
  return S(m, VS);
}

/** covered wagon (1/16): bed, four wheels, canvas bonnet on hoops, seat & tongue. seed 2 = broken */
export function wagon(seed = 0): StaticModel {
  const vs = 1 / 16;
  const m = new VoxelModel('wagon');
  const broken = mod(seed, 2) === 0;
  const bw = 12, bl = 30, by = 13;
  // bed box
  for (let x = -bw; x <= bw; x++)
    for (let z = -bl; z <= bl; z++)
      for (let y = by; y <= by + 7; y++) {
        const side = Math.abs(x) === bw || Math.abs(z) === bl;
        if (y === by || side) m.set(x, y, z, side ? (mod(y - by, 3) === 0 ? PR.wood.dark : y === by + 7 ? PR.wood.hi : PR.wood.base) : PR.wood.shade);
      }
  // axles + wheels
  for (const [z, R] of [[-bl + 7, 12], [bl - 8, 9]] as const) {
    m.box(-bw - 3, Math.max(R, 9), z - 1, bw + 3, Math.max(R, 9) + 1, z, PR.woodDark.base);
    for (const sx of [-1, 1]) {
      if (broken && sx === 1 && R === 9) continue;
      const wh = wheelModel(R, PR.wood, 10);
      wh.forEach((x, y, zz, c, f) => m.set(sx * (bw + 3) + zz, R + y, z + x, c, f));
    }
  }
  if (broken) {
    const wh = wheelModel(9, PR.wood, 10);
    wh.forEach((x, y, zz, c, f) => m.set(bw + 14 + x, zz + 2, bl - 4 + y, c, f));
    // crate propping the corner
    m.box(bw - 4, 0, bl - 12, bw + 2, by - 1, bl - 5, PR.woodLight.base);
    m.box(bw - 4, by - 1, bl - 12, bw + 2, by - 1, bl - 5, PR.woodLight.hi);
  }
  // canvas bonnet: hoops + cover, open at the back
  const hoopZ = [-bl + 2, -bl + 14, -2, 10, bl - 3];
  for (let z = -bl + 2; z <= bl - 3; z++) {
    const isHoop = hoopZ.includes(z);
    for (let a = 0; a <= 120; a++) {
      const t = (a / 120) * Math.PI;
      for (const rr of [0, 1]) {
        const x = Math.round(Math.cos(t) * (bw + 1 - rr)), y = by + 7 + Math.round(Math.sin(t) * (15 - rr));
        const torn = broken && z > 4 && z < 14 && y > by + 14 && x > 0;
        if (torn && !isHoop) continue;
        if (rr === 1 && m.has(x, y, z)) continue;
        m.set(x, y, z, rr === 1 ? PR.canvas.shade : isHoop ? PR.woodDark.base : y > by + 18 ? PR.canvas.hi : PR.canvas.base);
      }
    }
  }
  // end fans (closed front with a round opening, open back with dark interior)
  for (let a = 0; a <= 40; a++)
    for (let rr = 0; rr <= 15; rr++) {
      const t = (a / 40) * Math.PI;
      const x = Math.round(Math.cos(t) * Math.min(bw + 1, rr)), y = by + 7 + Math.round(Math.sin(t) * rr);
      if (rr < 9) m.set(x, y, bl - 3, PR.socket.base);
      else m.set(x, y, bl - 3, PR.canvas.shade);
      m.set(x, y, -bl + 3, PR.socket.base);
    }
  // seat + tongue
  m.box(-bw + 2, by + 8, bl + 1, bw - 2, by + 9, bl + 3, PR.woodDark.base);
  m.box(-bw + 2, by + 10, bl + 3, bw - 2, by + 13, bl + 3, PR.woodDark.shade);
  m.box(-1, 9, bl, 0, 10, bl + 26, PR.woodDark.base);
  m.box(-6, 9, bl + 24, 5, 10, bl + 25, PR.woodDark.base);
  // water barrel strapped to the side
  barrelBody(m, -bw - 5, -8, by - 2, 12, 4, PR.wood, { lid: true });
  return S(m, vs);
}

export function mineCart(seed = 0): StaticModel {
  const m = new VoxelModel('mine_cart');
  const gold = mod(seed, 2) === 0;
  // tub: wider at the top
  for (let y = 4; y <= 15; y++) {
    const t = (y - 4) / 11;
    const hx = Math.round(9 + t * 2), hz = Math.round(12 + t * 2);
    for (let x = -hx; x <= hx; x++)
      for (let z = -hz; z <= hz; z++) {
        const wall = Math.abs(x) === hx || Math.abs(z) === hz;
        if (!wall && y > 4) continue;
        const rivet = wall && mod(x + z, 5) === 0 && (y === 6 || y === 13);
        m.set(x, y, z, rivet ? PR.iron.hi : y === 15 ? PR.iron.hi : y === 4 ? PR.iron.dark : mod(y, 5) === 0 ? PR.rust.shade : PR.iron.base, VF.METAL);
      }
  }
  // ore heap
  for (let x = -9; x <= 9; x++)
    for (let z = -12; z <= 12; z++) {
      const h = Math.round(15 - (Math.abs(x) / 9) * 3 - (Math.abs(z) / 12) * 3 + 2);
      for (let y = 5; y <= h; y++) {
        const k = mod(x * 7 + z * 3 + y * 5, 9);
        const c = gold ? (k < 2 ? PR.gold.hi : k < 4 ? PR.gold.base : PR.stone.shade) : k < 3 ? PR.coal.hi : PR.coal.base;
        m.set(x, y, z, c, gold && k < 4 ? VF.METAL : 0);
      }
    }
  // wheels
  for (const sx of [-1, 1])
    for (const z of [-8, 8]) {
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (inCircle(a, b, 3)) m.set(sx * 10, 3 + b, z + a, inCircle(a, b, 1) ? PR.iron.hi : PR.iron.dark, VF.METAL);
    }
  return S(m, VS);
}

export function railSegment(len = 4, seed = 0): StaticModel {
  const m = new VoxelModel('rails');
  const L = Math.round(len / VS);
  for (let z = -Math.floor(L / 2); z <= Math.floor(L / 2); z++) {
    if (mod(z, 12) < 3) m.box(-14, 0, z, 14, 1, z, mod(z, 12) === 1 ? PR.woodDark.base : PR.woodDark.shade);
    for (const x of [-9, 8]) {
      m.box(x, 2, z, x + 1, 2, z, PR.iron.hi, VF.METAL);
      m.box(x, 1, z, x + 1, 1, z, PR.iron.base, VF.METAL);
    }
  }
  if (seed >= 2) {
    // timber mine portal at the far end
    const z = -Math.floor(L / 2) + 2;
    for (const x of [-18, 15]) post(m, x, z - 1, 0, 50, 4, PR.woodDark, seed + x);
    board(m, -20, 51, z - 2, 20, 55, z + 2, PR.woodDark, 'x', seed);
    signPanel(m, 0, 44, z + 3, ['MINE'], { bg: PR.woodLight, ink: PR.ink.base });
    for (let x = -14; x <= 14; x++) for (let y = 0; y <= 50; y++) m.set(x, y, z - 3, PR.socket.base);
  }
  return S(m, VS);
}

export function trough(seed = 0): StaticModel {
  const m = new VoxelModel('trough');
  const L = 20, W = 7;
  for (let x = -L; x <= L; x++)
    for (let z = -W; z <= W; z++)
      for (let y = 3; y <= 11; y++) {
        const wall = Math.abs(x) === L || Math.abs(z) === W;
        if (y === 3 || wall) m.set(x, y, z, wall ? (y === 11 ? PR.wood.hi : mod(y, 4) === 3 ? PR.wood.dark : PR.wood.base) : PR.wood.shade);
        else if (y === 9) m.set(x, y, z, mod(x + z, 9) === 0 ? PR.water.hi : PR.water.base);
        else if (y < 9) m.set(x, y, z, PR.water.shade);
      }
  for (const x of [-L + 2, L - 3]) m.box(x, 0, -W, x + 1, 2, W, PR.woodDark.base);
  for (const x of [-L + 6, 0, L - 6]) for (let z = -W; z <= W; z++) for (const y of [11]) m.set(x, y, z, PR.iron.base, VF.METAL);
  void seed;
  return S(m, VS);
}

export function campfire(seed = 0): StaticModel {
  const r = rngOf(seed, 29);
  const m = new VoxelModel('campfire');
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * 9), z = Math.round(Math.sin(a) * 9);
    chunk(m, x - 2, 0, z - 2, x + 2, r.int(2, 4), z + 2, PR.stone, 1);
  }
  // ash bed + embers
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (inCircle(x, z, 6)) m.set(x, 0, z, mod(x * 3 + z * 5, 7) === 0 ? PR.ember.base : PR.coal.base, mod(x * 3 + z * 5, 7) === 0 ? VF.EMISSIVE : 0);
  // crossed logs (teepee)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    seg(m, [Math.cos(a) * 6, 1, Math.sin(a) * 6], [Math.cos(a) * 1, 9, Math.sin(a) * 1], 2, i % 2 ? PR.woodDark.base : PR.wood.shade);
  }
  for (const [x, z] of [[0, 0], [1, -1], [-1, 1]]) m.set(x, 2, z, PR.ember.hi, VF.EMISSIVE);
  // tripod + pot
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    seg(m, [Math.cos(a) * 11, 0, Math.sin(a) * 11], [0, 22, 0], 1, PR.woodDark.base);
  }
  rope(m, [[0, 22, 0], [0, 16, 0]], PR.iron.dark);
  cylY(m, 0, 0, 11, 15, 3.2, PR.iron.base, VF.METAL);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (inCircle(x, z, 2.2)) m.set(x, 15, z, 0x9a6a3a);
  return S(m, VS);
}

export function tent(seed = 0): StaticModel {
  const m = new VoxelModel('tent');
  const striped = mod(seed, 2) === 1;
  const W = 20, L = 26, H = 30;
  for (let z = -L; z <= L; z++)
    for (let x = -W; x <= W; x++) {
      const y = Math.round(H * (1 - Math.abs(x) / W));
      const edge = Math.abs(z) === L;
      const stripe = striped && mod(x + 40, 8) < 3;
      const cr = stripe ? PR.canvasStripe : PR.canvas;
      m.set(x, y, z, x === 0 ? cr.shade : Math.abs(x) < W / 3 ? cr.hi : cr.base);
      m.set(x, y - 1, z, cr.shade);
      if (edge && z > 0) {
        // front flaps folded open: triangle doorway
        for (let yy = 0; yy < y - 1; yy++) {
          const open = Math.abs(x) < (H - yy) * 0.36;
          if (!open) m.set(x, yy, z, cr.base);
          else m.set(x, yy, z - 3, PR.socket.base);
        }
      } else if (edge) for (let yy = 0; yy < y; yy++) m.set(x, yy, z, cr.shade);
    }
  // folded flaps (rolled canvas) beside the door
  for (const sx of [-1, 1]) m.box(sx * 9, 0, L + 1, sx * 9 + sx * 2, 18, L + 2, PR.canvas.shade);
  // poles + ridge
  for (const z of [-L - 1, L + 1]) m.box(0, 0, z, 0, H + 4, z, PR.woodDark.base);
  // guy ropes + stakes
  for (const z of [-L - 1, L + 1]) {
    const dz = z > 0 ? 1 : -1;
    rope(m, [[0, H + 3, z], [0, 0, z + dz * 12]]);
    m.box(0, 0, z + dz * 12, 0, 2, z + dz * 12, PR.woodDark.base);
  }
  // bedroll peeking out
  m.box(-6, 0, L - 6, 6, 2, L - 1, PR.red.base);
  m.box(-6, 3, L - 6, 6, 3, L - 1, PR.red.hi);
  return S(m, VS);
}

export function outhouse(seed = 0): StaticModel {
  const m = new VoxelModel('outhouse');
  const b = building(m, 0, 0, 22, 22, 40, { fy: 1, r: PR.woodGrey, seed, bw: 4 });
  shedRoof(m, b, 6, { tin: false });
  doorW(m, b.front, -6, b.fy + 1, 12, 32, { r: PR.wood });
  // crescent moon cut-out on the door
  const moon = ['.##.', '#...', '#...', '#...', '.##.'];
  moon.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && m.set(-1 + j, b.fy + 28 - i, b.z1 - 1, PR.socket.base)));
  // toilet paper roll on a nail outside (a joke)
  m.box(12, 22, 6, 13, 24, 8, 0xffffff);
  return S(m, VS);
}

export function gallows(seed = 0): StaticModel {
  const vs = 1 / 16;
  const m = new VoxelModel('gallows');
  const PH = 26, s = 24;
  // platform posts + deck
  for (const x of [-s, s - 2]) for (const z of [-s, s - 2]) post(m, x, z, 0, PH, 3, PR.woodDark, seed + x + z);
  for (let x = -s; x <= s; x++) for (let z = -s; z <= s; z++) m.set(x, PH, z, mod(x, 4) === 0 ? PR.wood.dark : PR.wood.base);
  // trapdoor
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (Math.abs(x) === 5 || Math.abs(z) === 5) m.set(x, PH, z, PR.woodDark.dark);
  // stairs down the front
  for (let st = 0; st < 9; st++) m.box(-8, PH - 3 - st * 3, s + 1 + st * 3, 8, PH - 1 - st * 3, s + 3 + st * 3, st % 2 ? PR.wood.base : PR.wood.shade);
  // upright, beam, brace
  post(m, -14, -2, PH + 1, PH + 60, 4, PR.woodDark, seed);
  board(m, -14, PH + 57, -2, 6, PH + 60, 1, PR.woodDark, 'x', seed + 1);
  seg(m, [-12, PH + 44, 0], [-1, PH + 56, 0], 2, PR.woodDark.base);
  // noose
  rope(m, [[2, PH + 56, 0], [2, PH + 40, 0]]);
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    m.set(2 + Math.round(Math.cos(t) * 3), PH + 36 + Math.round(Math.sin(t) * 4), 0, PR.rope.base);
  }
  m.box(1, PR.rope ? PH + 40 : 0, -1, 3, PH + 42, 1, PR.rope.shade);
  // sign
  signPanel(m, -24, PH + 6, s + 2, ['HANGIN', 'TODAY'], { bg: PR.parchment, ink: PR.red.dark });
  sandDrift(m, 0, 0, 30, 30, 4, 0, seed);
  return S(m, vs);
}

export interface RotorModel extends StaticModel {
  /** separate rotating fan; build with pivot = rotorPivot (voxel coords in rotor model) */
  rotor: VoxelModel;
  rotorPivot: V3;
  /** where the rotor hub sits, meters relative to the main model's bottom pivot */
  rotorAt: V3;
}

/** farm windmill: tapered lattice tower ≈8.5 m, separate 16-blade rotor (spins about Z), tail vane, stock tank. 1/12 */
export function windmill(seed = 0): RotorModel {
  const vs = BVS;
  const m = new VoxelModel('windmill');
  const H = 96;
  const legAt = (y: number) => Math.round(14 - (y / H) * 10);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      for (let y = 0; y <= H; y++) {
        const o = legAt(y);
        m.box(sx * o, y, sz * o, sx * o + (sx > 0 ? -1 : 1), y, sz * o + (sz > 0 ? -1 : 1), y % 12 === 0 ? PR.woodDark.dark : PR.woodGrey.base);
      }
    }
  // cross bracing every 16 voxels on all four faces
  for (let y = 0; y < H - 8; y += 16) {
    const a = legAt(y), b = legAt(y + 16);
    for (const s of [-1, 1]) {
      seg(m, [-a, y, s * a], [b, y + 16, s * b], 1, PR.woodGrey.shade);
      seg(m, [a, y, s * a], [-b, y + 16, s * b], 1, PR.woodGrey.shade);
      seg(m, [s * a, y, -a], [s * b, y + 16, b], 1, PR.woodGrey.shade);
      seg(m, [s * a, y, a], [s * b, y + 16, -b], 1, PR.woodGrey.shade);
    }
    for (let x = -a; x <= a; x++) for (const s of [-1, 1]) m.set(x, y, s * a, PR.woodGrey.base).set(s * a, y, x, PR.woodGrey.base);
  }
  // platform + gearbox + tail vane
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) m.set(x, H, z, mod(x, 3) === 0 ? PR.wood.dark : PR.wood.base);
  m.box(-2, H + 1, -3, 2, H + 6, 4, PR.iron.base, VF.METAL);
  m.box(-1, H + 3, -18, 0, H + 4, -3, PR.iron.dark, VF.METAL);
  for (let z = -30; z <= -18; z++) for (let y = H - 2; y <= H + 10 - Math.round((z + 30) * 0.3); y++) m.set(0, y, z, y > H + 6 ? PR.paintWhite.base : PR.red.base);
  m.box(0, H + 4, -30, 0, H + 4, -18, PR.woodDark.base);
  // pump rod + stock tank
  m.box(0, 4, 0, 0, H, 0, PR.iron.dark, VF.METAL);
  cylY(m, 22, 6, 0, 8, 10, PR.iron.base, VF.METAL);
  cylY(m, 22, 6, 1, 7, 9, PR.water.base);
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) if (inCircle(x, z, 10) && !inCircle(x, z, 9)) m.set(22 + x, 8, 6 + z, PR.iron.hi, VF.METAL);
  // rotor
  const rotor = new VoxelModel('windmill_rotor');
  const blades = 12, R = 20;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 5; k <= R; k++) {
      const w = 0.6 + (k / R) * 2.2;
      for (let q = -3; q <= 3; q++) {
        if (Math.abs(q) > w) continue;
        const x = Math.round(ca * k - sa * q * 0.9), y = Math.round(sa * k + ca * q * 0.9);
        const tip = k > R - 4;
        rotor.set(x, y, 0, tip && i % 2 === 0 ? PR.red.base : q >= w - 1 ? PR.tin.shade : PR.tin.base, VF.METAL);
      }
    }
  }
  for (let a = 0; a < 160; a++) {
    const t = (a / 160) * Math.PI * 2;
    rotor.set(Math.round(Math.cos(t) * 11), Math.round(Math.sin(t) * 11), -1, PR.iron.dark, VF.METAL);
  }
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (inCircle(x, y, 3)) for (let z = -2; z <= 2; z++) rotor.set(x, y, z, z === 2 ? PR.iron.hi : PR.iron.base, VF.METAL);
  const hub: V3 = [0, H + 4, 8];
  sandDrift(m, 0, 0, 18, 18, 4, 0, seed);
  return { model: m, voxelSize: vs, rotor, rotorPivot: [0.5, 0.5, 0.5], rotorAt: toMeters(m, vs, hub) };
}

/** water tower: four legs with X bracing, hooped plank tank, conical roof, ladder, spout. 1/12 */
export function waterTower(seed = 0): StaticModel {
  const vs = BVS;
  const m = new VoxelModel('water_tower');
  const LH = 56, TR = 18, TH = 26;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(m, sx * 14 - 1, sz * 14 - 1, 0, LH, 3, PR.woodDark, seed + sx * 3 + sz);
  for (let y = 4; y < LH - 6; y += 18)
    for (const s of [-1, 1]) {
      seg(m, [-14, y, s * 14], [14, y + 18, s * 14], 1, PR.woodDark.shade);
      seg(m, [14, y, s * 14], [-14, y + 18, s * 14], 1, PR.woodDark.shade);
      seg(m, [s * 14, y, -14], [s * 14, y + 18, 14], 1, PR.woodDark.shade);
      seg(m, [s * 14, y, 14], [s * 14, y + 18, -14], 1, PR.woodDark.shade);
    }
  // deck
  for (let x = -TR - 2; x <= TR + 2; x++) for (let z = -TR - 2; z <= TR + 2; z++) if (inCircle(x, z, TR + 2)) m.set(x, LH, z, mod(x, 3) === 0 ? PR.wood.dark : PR.wood.base);
  barrelBody(m, 0, 0, LH + 1, TH, TR, PR.wood, { lid: false });
  // conical roof
  for (let y = 0; y <= 12; y++) {
    const rr = TR + 1 - (y / 12) * (TR + 1);
    for (let x = -TR - 2; x <= TR + 2; x++)
      for (let z = -TR - 2; z <= TR + 2; z++) {
        if (!inCircle(x, z, rr) || inCircle(x, z, rr - 2)) continue;
        m.set(x, LH + TH + 1 + y, z, mod(Math.round(Math.atan2(z, x) * 8), 2) ? PR.woodDark.base : PR.woodDark.shade);
      }
  }
  m.box(0, LH + TH + 13, 0, 0, LH + TH + 16, 0, PR.iron.dark, VF.METAL);
  // ladder
  for (let y = 0; y <= LH + TH; y++) {
    m.set(-3, y, TR + 4, PR.woodDark.base).set(3, y, TR + 4, PR.woodDark.base);
    if (y % 4 === 0) m.box(-2, y, TR + 4, 2, y, TR + 4, PR.wood.base);
  }
  // spout
  m.box(TR, LH + 4, -1, TR + 8, LH + 5, 0, PR.iron.base, VF.METAL);
  m.box(TR + 8, LH - 4, -1, TR + 9, LH + 5, 0, PR.iron.base, VF.METAL);
  stampText(m, 'z+', 'H2O', -5, LH + 18, TR + 3, { color: PR.paintWhite.base });
  sandDrift(m, 0, 0, 20, 20, 4, 0, seed);
  return S(m, vs);
}

/** lookout tower with platform, rail, shingle roof, ladder and a flag pole. 1/12 */
export function watchtower(seed = 0): StaticModel & { meta: { flagAnchor: V3 } } {
  const vs = BVS;
  const m = new VoxelModel('watchtower');
  const PH = 62;
  const legAt = (y: number) => Math.round(16 - (y / PH) * 5);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (let y = 0; y <= PH + 26; y++) {
        const o = y <= PH ? legAt(y) : legAt(PH);
        m.box(sx * o, y, sz * o, sx * o - sx * 2, y, sz * o - sz * 2, y > PH ? PR.woodDark.base : PR.woodDark.base);
      }
  for (let y = 4; y < PH - 4; y += 19) {
    const a = legAt(y), b = legAt(y + 19);
    for (const s of [-1, 1]) {
      seg(m, [-a, y, s * a], [b, y + 19, s * b], 2, PR.wood.shade);
      seg(m, [s * a, y, -a], [s * b, y + 19, b], 2, PR.wood.shade);
    }
  }
  const P0 = legAt(PH) + 4;
  for (let x = -P0; x <= P0; x++) for (let z = -P0; z <= P0; z++) m.set(x, PH, z, mod(x, 4) === 0 ? PR.wood.dark : PR.wood.base);
  // railing with plank skirt
  for (let x = -P0; x <= P0; x++)
    for (const z of [-P0, P0]) {
      for (let y = PH + 1; y <= PH + 9; y++) {
        m.set(x, y, z, y === PH + 9 ? PR.wood.hi : mod(x, 3) === 0 ? PR.wood.dark : PR.wood.base);
        m.set(z, y, x, y === PH + 9 ? PR.wood.hi : mod(x, 3) === 0 ? PR.wood.dark : PR.wood.base);
      }
    }
  // pyramid roof
  const RY = PH + 27;
  for (let y = 0; y <= 12; y++) {
    const e = P0 + 3 - Math.round(y * ((P0 + 3) / 12));
    for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) if (Math.abs(x) === e || Math.abs(z) === e) m.set(x, RY + y, z, mod(y, 3) === 0 ? PR.woodDark.dark : PR.woodDark.base);
  }
  // ladder on the front
  for (let y = 0; y <= PH; y++) {
    const z = legAt(y) + 2;
    m.set(-3, y, z, PR.wood.base).set(3, y, z, PR.wood.base);
    if (y % 4 === 0) m.box(-2, y, z, 2, y, z, PR.wood.hi);
  }
  // flag pole + pennant
  const fp: V3 = [0, RY + 30, 0];
  m.box(0, RY + 12, 0, 0, RY + 30, 0, PR.woodDark.dark);
  for (let x = 1; x <= 10; x++) for (let y = RY + 28 - Math.round((10 - x) * 0.6); y >= RY + 22 + Math.round((10 - x) * 0.0); y--) if (y >= RY + 22 + Math.round(x * 0.4)) m.set(x, y, 0, y > RY + 25 ? PR.red.base : PR.red.shade);
  sandDrift(m, 0, 0, 20, 20, 3, 0, seed);
  return { model: m, voxelSize: vs, meta: { flagAnchor: toMeters(m, vs, [fp[0], fp[1] - 1, fp[2]]) } };
}

const SHACK_SIGNS = [['ASSAY'], ['GUNS'], ['BATHS', '5 CENTS'], ['DENTIST'], ['UNDERTAKER'], ['BAIT'], ['LAUNDRY'], ['TELEGRAPH']];
/** plank shack ≈4.5×3.5 m: gable tin roof, porch, door, window, sign, stovepipe. 1/12 */
export function shack(seed = 0): StaticModel & { meta: { entrance: [number, number]; footprint: [number, number]; height: number } } {
  const vs = BVS;
  const v = meters(vs);
  const m = new VoxelModel('shack');
  const paint = [PR.wood, PR.woodGrey, PR.woodLight, PR.barnRed][mod(seed, 4)];
  const b = building(m, 0, 0, v(4.6), v(3.4), v(2.6), { fy: 3, r: paint, seed, vertical: mod(seed, 2) === 0 });
  gableRoof(m, b, 'x', v(1.2), { tin: mod(seed, 3) !== 1, seed, gable: paint });
  const doorU = b.x0 + 8;
  doorW(m, b.front, doorU, b.fy + 1, 9, 25, { r: PR.woodDark });
  windowW(m, b.front, b.x1 - 18, b.fy + 9, 10, 9, { frame: PR.paintWhite, shutters: mod(seed, 2) ? PR.paintGreen : undefined });
  windowW(m, b.left, b.z0 + 12, b.fy + 9, 9, 9, { frame: PR.paintWhite });
  porchFront(m, b, b.x0 - 1, b.x1 + 1, 14, b.top - 1, { tin: true, seed, steps: true });
  const sign = SHACK_SIGNS[mod(seed * 3 + 1, SHACK_SIGNS.length)];
  signPanel(m, Math.round((b.x0 + b.x1) / 2), b.top + 6, b.z1 + 2, sign, { bg: PR.paintWhite, ink: PR.ink.base });
  // stovepipe
  m.box(b.x1 - 10, b.top - 2, b.z0 + 8, b.x1 - 8, b.top + v(1.9), b.z0 + 10, PR.coal.hi, VF.METAL);
  m.box(b.x1 - 11, b.top + v(1.9) + 1, b.z0 + 7, b.x1 - 7, b.top + v(1.9) + 1, b.z0 + 11, PR.coal.base, VF.METAL);
  // rain barrel + crate by the porch
  barrelBody(m, b.x1 + 6, b.z1 - 4, 0, 13, 5, PR.wood);
  sandDrift(m, b.x0 - 4, b.z0, 14, 20, 5, 0, seed);
  const W = b.x1 - b.x0, D = b.z1 + 14 - b.z0;
  return {
    model: m,
    voxelSize: vs,
    meta: { entrance: [(doorU + 4.5 - (b.x0 + b.x1) / 2) * vs, (b.z1 + 14 + v(1.0) - (b.z0 + b.z1 + 14) / 2) * vs], footprint: [W * vs, D * vs], height: (b.top + v(1.4)) * vs },
  };
}

// ---------------------------------------------------------------------------
// WANTED board (1/40): two hand-hewn, sun-silvered posts with rusty tin caps
// poking through a shingled gable roof; a planked board (gaps, a split, a knot
// hole, worm holes) nailed on with rust-bleeding nails and iron corner straps;
// layered posters (a faded one ripped half away under two fresh WANTED sheets
// with relief-printed portraits, a knife-pinned notice, torn scraps round old
// nails); bullet holes punched clean through; a lantern on a chain from a
// wrought bracket; a padlocked chain; stones and drifted sand at the feet.
// ---------------------------------------------------------------------------
const WVS = 1 / 40;
/** weathered grey with a little brown left in it */
const BROWN_GREY: WoodSpecies = { ...WOOD.weathered, tones: WOOD.weathered.tones.map((c) => mixRGB(c, 0x8a6a48, 0.18)) };
const INK = 0x2a1d14;
const RED_INK = 0x8e2a1a;

type SheetKind = 'wanted' | 'old' | 'notice';
/** a paper sheet built flat in its own coords (paper z=0, relief z=1..2), origin bottom-left */
function posterSheet(kind: SheetKind, w: number, h: number, seed: number, o: { look?: number; reward?: string; tear?: 'half' | 'corner' | 'strip' | 'none'; dogEar?: boolean; lines?: string[] } = {}) {
  const p = new VoxelModel('sheet');
  const paperTone = kind === 'old' ? 0xd2bc90 : kind === 'notice' ? 0xf2e6c8 : 0xecd9aa;
  const paper = agedPaper({ seed, tone: paperTone, rect: [0, 0, w - 1, h - 1], age: kind === 'old' ? 1 : 0.45 });
  const ink = kind === 'old' ? mixRGB(INK, paperTone, 0.45) : kind === 'notice' ? 0x45372c : INK;
  const red = kind === 'old' ? mixRGB(RED_INK, paperTone, 0.45) : RED_INK;
  const jag = (k: number) => Math.round((hash3(k, seed, 41) - 0.5) * 3);
  const torn = (x: number, y: number) => {
    const t = o.tear ?? 'none';
    if (t === 'half') return y - h * 0.42 > (x - w * 0.25) * 0.9 + jag(x + y * 3);
    if (t === 'corner') return x + y < 12 + jag(x - y);
    if (t === 'strip') return y < 7 + jag(x);
    return false;
  };
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
      if (edge === 0 && hash3(x, y, seed) < 0.24) continue; // deckled, weathered edge
      if (torn(x, y)) continue;
      p.set(x, y, 0, paper);
    }
  // fresh torn edges show pale paper fibre
  p.forEach((x, y) => {
    if (torn(x + 1, y) || torn(x - 1, y) || torn(x, y + 1) || torn(x, y - 1)) p.set(x, y, 0, mixRGB(paperTone, 0xfff6e2, 0.55));
  });
  const txt = (s: string, yTop: number, col: number) => stampText(p, 'z+', s, Math.floor((w - textWidth(s)) / 2), yTop, 0, { color: col });
  if (kind === 'notice') {
    (o.lines ?? ['LOST', 'MULE']).forEach((l, i) => txt(l, h - 3 - i * 6, ink));
  } else {
    txt('WANTED', h - 3, ink);
    for (let x = 2; x < w - 2; x++) if (p.has(x, h - 9, 0)) p.set(x, h - 9, 0, ink);
    // portrait frame (printed rule) + relief-printed bust
    const cx = Math.floor(w / 2), cy = h - 18;
    for (let x = cx - 7; x <= cx + 7; x++) for (const y of [cy - 7, cy + 7]) if (p.has(x, y, 0)) p.set(x, y, 0, ink);
    for (let y = cy - 7; y <= cy + 7; y++) for (const x of [cx - 7, cx + 7]) if (p.has(x, y, 0)) p.set(x, y, 0, ink);
    bustRelief(p, cx, cy, o.look ?? 0, ink, paperTone, red, torn);
    txt(o.reward ?? '$500', 7, red);
  }
  if (o.dogEar) {
    // bottom-right corner folded forward: the flap shows the paper's back
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4 - i; j++) {
        const x = w - 1 - i, y = j;
        if (!p.has(x, y, 0)) continue;
        p.del(x, y, 0);
        const fi = 3 - j, fj = 3 - i;
        if (fi + fj > 3) p.set(w - 1 - fi, fj, 1, mixRGB(paperTone, 0x8a7048, 0.22));
      }
  }
  return p;
}

/** the poster portrait: a shallow relief (2 voxels) of a skull outlaw, tinted like an ink wash; lit, not drawn */
function bustRelief(p: VoxelModel, cx: number, cy: number, look: number, ink: number, paper: number, red: number, torn: (x: number, y: number) => boolean) {
  const r1 = mixRGB(paper, ink, 0.4), r2 = mixRGB(paper, ink, 0.2), dk = ink;
  const put = (x: number, y: number, z: number, c: number) => {
    if (torn(cx + x, cy + y) || !p.has(cx + x, cy + y, 0)) return;
    p.set(cx + x, cy + y, z, c);
  };
  const hole = (x: number, y: number) => {
    p.del(cx + x, cy + y, 2);
    p.del(cx + x, cy + y, 1);
    if (p.has(cx + x, cy + y, 0)) p.set(cx + x, cy + y, 0, dk);
  };
  // coat shoulders + collar
  for (let x = -6; x <= 6; x++) put(x, -6, 1, r1);
  for (let x = -5; x <= 5; x++) if (x !== 0) put(x, -5, 1, r1);
  put(-1, -5, 2, r2);
  put(1, -5, 2, r2);
  for (let x = -1; x <= 1; x++) put(x, -4, 1, r1);
  // skull: wider cranium, narrower jaw, raised centre
  for (let x = -4; x <= 4; x++)
    for (let y = -3; y <= 3; y++) {
      const rx = y > 0 ? 3.7 : y < -1 ? 2.6 : 3.3;
      if ((x * x) / (rx * rx) + (y * y) / 12.5 > 1) continue;
      put(x, y, 1, r1);
      if ((x * x) / ((rx - 1.1) * (rx - 1.1)) + (y * y) / 6 <= 1) put(x, y, 2, r2);
    }
  for (const sx of [-1, 1]) for (const [x, y] of [[sx, 0], [sx * 2, 0], [sx, 1], [sx * 2, 1]]) hole(x, y); // eye sockets (empty, modelled)
  hole(0, -1); // nose
  for (let x = -2; x <= 2; x++) {
    p.del(cx + x, cy - 2, 2);
    put(x, -2, 1, x % 2 ? r2 : dk); // teeth
  }
  if (look === 1) {
    // bandit: bandana up over the jaw, knot at the side; flat cap
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= -1; y++) if (!(y === -1 && Math.abs(x) < 1)) put(x, y, 2, mixRGB(red, paper, 0.25));
    put(4, -2, 2, red);
    put(5, -3, 1, red);
    for (let x = -5; x <= 5; x++) put(x, 3, 2, mixRGB(dk, paper, 0.3));
    for (let x = -3; x <= 3; x++)
      for (let y = 4; y <= 5; y++) {
        put(x, y, 1, r1);
        if (Math.abs(x) < 3) put(x, y, 2, r2);
      }
  } else if (look === 2) {
    // sombrero: wide double brim, peaked crown
    for (let x = -6; x <= 6; x++) put(x, 3, 2, mixRGB(dk, paper, 0.3));
    for (let x = -5; x <= 5; x++) put(x, 4, 1, r1);
    for (let x = -2; x <= 2; x++) {
      put(x, 5, 1, r1);
      put(x, 5, 2, r2);
    }
    put(0, 6, 1, r1);
    put(0, 6, 2, r2);
  } else {
    // stetson: brim, pinched crown, dark band
    for (let x = -6; x <= 6; x++) put(x, 3, 2, mixRGB(dk, paper, 0.3));
    for (let x = -3; x <= 3; x++) put(x, 4, 1, dk);
    for (let x = -3; x <= 3; x++)
      for (let y = 5; y <= 6; y++) {
        if (y === 6 && x === 0) continue; // pinched crown
        put(x, y, 1, r1);
        if (Math.abs(x) < 3) put(x, y, 2, r2);
      }
  }
}

/** paste a sheet onto the board: paper plane at zBase, tilted by `tilt` (y shear). returns local->world mapper */
function placeSheet(m: VoxelModel, sheet: VoxelModel, px: number, py: number, zBase: number, tilt: number) {
  const b = sheet.bounds();
  const w = b.maxX + 1;
  const at = (lx: number, ly: number, lz = 0): V3 => [px + lx, py + ly + Math.round((lx - w / 2) * tilt), zBase + lz];
  sheet.forEach((x, y, z, c, f) => {
    const [X, Y, Z] = at(x, y, z);
    m.set(X, Y, Z, c, f | VF.SOFTAO);
  });
  return at;
}

/** a hanging barn lantern: bail, vented cone cap, corner posts, sooty glass (front pane broken), candle with a small flame */
function hangingLantern(m: VoxelModel, cx: number, top: number, cz: number, seed: number) {
  const iron = blackIron(seed, 0.35);
  const tn = tin({ seed: seed + 3, rust: 0.35 });
  const glass = (_x: number, y: number) => (y > top - 7 ? 0x6e6a5c : 0xb8c8bc); // soot clouds the top of the glass
  // bail loop
  m.set(cx - 1, top, cz, iron, VF.METAL).set(cx + 1, top, cz, iron, VF.METAL).set(cx, top + 1, cz, iron, VF.METAL);
  // cone cap with vent gaps
  m.set(cx, top - 1, cz, tn, VF.METAL);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) m.set(cx + x, top - 2, cz + z, tn, VF.METAL);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!(Math.abs(x) === 2 && Math.abs(z) === 2) && !((x === 0 || z === 0) && (Math.abs(x) === 2 || Math.abs(z) === 2))) m.set(cx + x, top - 3, cz + z, tn, VF.METAL);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.abs(x) === 3 || Math.abs(z) === 3) m.set(cx + x, top - 4, cz + z, tn, VF.METAL);
  // body
  const yb = top - 13;
  for (let y = yb + 1; y <= top - 5; y++)
    for (let x = -3; x <= 3; x++)
      for (let z = -3; z <= 3; z++) {
        const side = Math.abs(x) === 3 || Math.abs(z) === 3;
        if (!side) continue;
        const corner = Math.abs(x) === 3 && Math.abs(z) === 3;
        if (corner) {
          m.set(cx + x, y, cz + z, iron, VF.METAL);
          continue;
        }
        const guard = y === top - 9 || ((x === 0 || z === 0) && y < top - 5);
        if (guard) {
          m.set(cx + x, y, cz + z, iron, VF.METAL);
          continue;
        }
        // the front pane (+z) is broken out: jagged shards remain at the frame
        if (z === 3 && Math.abs(x) <= 2 && !(y === yb + 1 || (Math.abs(x) === 2 && hash3(x, y, seed) < 0.5))) continue;
        m.set(cx + x, y, cz + z, glass(x, y), VF.SOFTAO);
      }
  // base: drip pan + fuel font
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) m.set(cx + x, yb, cz + z, tn, VF.METAL);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) < 4) m.set(cx + x, yb - 1, cz + z, tn, VF.METAL);
  // candle stub + wax drips + tiny flame
  for (let y = yb + 1; y <= yb + 4; y++) m.set(cx, y, cz, y === yb + 1 ? 0xd8c8a0 : 0xeee0c0);
  m.set(cx + 1, yb + 1, cz, 0xe6d6b0);
  m.set(cx, yb + 5, cz, 0x3a2a1a);
  m.set(cx, yb + 6, cz, 0xffc45a, VF.EMISSIVE);
}

/** lantern bracket on a post side face (sx = +1: x+ face at faceX) with a chain down to the lantern */
function lanternOnBracket(m: VoxelModel, faceX: number, sx: 1 | -1, y: number, seed: number) {
  const iron = blackIron(seed + 7, 0.4);
  const X = (d: number) => faceX + sx * d;
  for (let yy = y - 7; yy <= y + 1; yy++) for (let z = -1; z <= 1; z++) m.set(X(0), yy, z, iron, VF.METAL); // mounting plate
  bolt(m, [X(0), y - 1, 0], sx > 0 ? 'x+' : 'x-', { size: 2, washer: false, mat: iron });
  bolt(m, [X(0), y - 6, 0], sx > 0 ? 'x+' : 'x-', { size: 2, washer: false, mat: iron });
  for (let d = 1; d <= 5; d++) m.set(X(d), y, 0, iron, VF.METAL); // arm
  for (let d = 1; d <= 4; d++) m.set(X(d), y - 5 + d, 0, iron, VF.METAL); // diagonal stay
  // scroll curl at the tip + drop hook
  m.set(X(6), y + 1, 0, iron, VF.METAL).set(X(5), y + 2, 0, iron, VF.METAL).set(X(4), y + 1, 0, iron, VF.METAL);
  m.set(X(4), y - 1, 0, iron, VF.METAL);
  chainLinks(m, [[X(4), y - 2, 0], [X(4), y - 8, 0]], { mat: iron, link: 3 });
  hangingLantern(m, X(4), y - 10, 0, seed);
}

/** wanted board: see the block comment above. 1/40, footprint ~2.4 x 2.5 m */
export function wantedBoard(seed = 0): StaticModel {
  const m = new VoxelModel('wanted_board');
  const flip = mod(seed, 2) === 1;
  const PX = 37; // post centres at x = +-PX, 7 x 7 section
  const yS = (z: number) => 93 - Math.round(Math.abs(z) * 0.6); // roof surface
  // ---- frame: lintel, ridge beam, knee braces, rafters
  timber(m, [-46, 84, -2, 46, 88, 2], 'x', { seed: seed + 11, hewn: 0.2, wear: 0.1 });
  timber(m, [-47, 89, -1, 46, 91, 1], 'x', { seed: seed + 12, chamfer: 0 });
  for (const sx of [-1, 1]) seg(m, [sx * (PX - 4), 71, 0], [sx * 22, 83, 0], 3, weathered({ along: 'y', seed: seed + 13 + sx }));
  for (const rx of [-46, -16, 14, 45]) for (let z = -11; z <= 11; z++) for (const x of [rx, rx + 1]) m.set(x, yS(z) - 2, z, mixRGB(WOOD.weathered.tones[1], 0x3a3028, 0.25));
  // ---- roof: dark deck boards under staggered weathered shingles (courses with proud butts), barge boards, ridge cap
  const deck = darkWood({ along: 'x', seed: seed + 14, bleach: 0.35, knots: 0 });
  for (let x = -47; x <= 46; x++)
    for (let z = -11; z <= 11; z++) m.set(x, yS(z) - 1, z, deck);
  for (const side of [-1, 1]) {
    for (let c = 0; c < 4; c++) {
      // course c: |z| in (11-3c-2 .. 11-3c)
      let x = -47 - ((c * 3 + (side > 0 ? 1 : 0)) % 5);
      let sh = 0;
      while (x <= 46) {
        const wdt = 4 + Math.floor(hash3(c, sh, seed + side * 7) * 4);
        const id = c * 97 + sh * 13 + side * 5 + seed * 1000;
        const gone = hash3(id, 1, 2) < 0.05;
        const lift = hash3(id, 3, 4) < 0.08 ? 1 : 0;
        const mat = weathered({ along: 'z', seed: id, checks: 0.5, knots: 0, species: hash3(id, 5, 6) < 0.3 ? 'bleached' : 'weathered' });
        for (let xx = Math.max(-47, x); xx <= Math.min(46, x + wdt - 1); xx++)
          for (let k = 0; k < 3; k++) {
            const az = 11 - 3 * c - k;
            if (az < 0) continue;
            const z = side * az;
            if (side < 0 && az === 0) continue;
            if (gone) continue;
            const butt = k === 0 ? 1 : 0;
            const seam = xx === x + wdt - 1;
            m.set(xx, yS(z) + butt + lift * (k === 0 ? 1 : 0), z, seam ? 0x3a3129 : mat);
            if (butt) m.set(xx, yS(z), z, seam ? 0x2e2620 : mat);
          }
        x += wdt;
        sh++;
      }
    }
  }
  const ridge = weathered({ along: 'x', seed: seed + 15, species: 'walnut', checks: 0.4 });
  for (let x = -48; x <= 47; x++) {
    for (let z = -2; z <= 2; z++) m.set(x, 94, z, ridge);
    for (let z = -1; z <= 1; z++) m.set(x, 95, z, ridge);
  }
  for (const bx of [-48, 47]) for (let z = -12; z <= 12; z++) for (let y = yS(z) - 2; y <= yS(z) + 1; y++) m.set(bx, y, z, weathered({ along: 'z', seed: seed + bx }));
  // ---- posts (after the roof so they pierce it cleanly), tin-capped, bolted to the lintel
  for (const sx of [-1, 1]) {
    const cx = sx * PX;
    timber(m, [cx - 3, 0, -3, cx + 3, 99, 3], 'y', { mat: weathered({ along: 'y', seed: seed * 5 + sx + 2, ends: [0, 99], checks: 0.9, rotBelow: 7, rotFrom: 0 }), chamfer: 1, hewn: 0.28, wear: 0.12, seed: seed + sx });
    split(m, [cx + 1, 99, 3], 'z+', [0, -1, 0], 14, { seed: seed + sx * 3, depth: 2 });
    const cap = tin({ seed: seed + sx, rust: 0.55 });
    for (let k = 0; k <= 3; k++) {
      const r = 4 - k;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) m.set(cx + x, 100 + k, z, cap, VF.METAL);
    }
    for (const [x, z] of [[-4, -4], [4, 4], [-4, 4]] as [number, number][]) m.set(cx + x, 99, z, cap, VF.METAL); // bent drip corners
    wrapBand(m, 'y', [cx - 3, -3, cx + 3, 3], 13, 15, { mat: blackIron(seed + sx) });
    bolt(m, [cx, 86, 3], 'z+', { size: 2, mat: rustedIron({ seed: seed + sx, rust: 0.6 }) });
    bolt(m, [cx, 86, -3], 'z-', { size: 2, mat: rustedIron({ seed: seed + sx + 1, rust: 0.6 }) });
  }
  // ---- the board: seven planks with gaps, nailed to the posts' front faces
  for (let i = 0; i < 7; i++) {
    const y0 = 30 + i * 7;
    const tall = i === 6 || hash3(i, seed, 1) < 0.35 ? 6 : 5; // some seams closed, some open (light shows through)
    const broken = flip && i === 4;
    const x0 = -43 + (hash3(i, seed, 2) < 0.4 ? 1 : 0), x1 = broken ? 26 : 43 - (hash3(i, seed, 3) < 0.4 ? 1 : 0);
    const sp: WoodName | WoodSpecies = i % 3 === 1 ? 'bleached' : i % 3 === 2 ? WOOD.weathered : BROWN_GREY;
    timber(m, [x0, y0, 4, x1, y0 + tall, 5], 'x', { mat: weathered({ along: 'x', seed: seed * 31 + i, ends: [x0, x1], checks: 0.8, species: sp }), chamfer: 0, wear: 0.1, seed: seed + i });
    if (broken) for (let y = y0; y <= y0 + tall; y++) for (let k = 0; k < 1 + Math.floor(hash3(y, seed, 9) * 5); k++) m.set(x1 + 1 + k, y, 4 + (k % 2), WOOD.bleached.tones[4]); // splintered end
    for (const sx of [-1, 1]) {
      for (const [dx, dy] of [[-2, 1], [2, tall - 1]]) nailHead(m, [sx * PX + dx * sx, y0 + dy, 5], 'z+', { rust: 0.7, seed: i });
    }
    if (hash3(i, seed, 4) < 0.5) split(m, [hash3(i, seed, 5) < 0.5 ? x0 : x1, y0 + 2, 5], 'z+', [hash3(i, seed, 5) < 0.5 ? 1 : -1, 0, 0], 8 + Math.floor(hash3(i, seed, 6) * 10), { seed: seed + i, depth: 2 });
  }
  timber(m, [-2, 31, 2, 1, 77, 3], 'y', { seed: seed + 16, chamfer: 0 }); // centre batten behind the gaps
  knotHole(m, [flip ? -20 : 18, 34, 5], 'z+', { r: 1.3, through: 2 });
  wormHoles(m, [-43, 30, 5, 43, 36, 5], 'z+', { density: 0.03, seed, galleries: true });
  // top drip ledge + bottom ledge
  timber(m, [-45, 79, 3, 45, 80, 8], 'x', { seed: seed + 17, chamfer: 0, wear: 0.15 });
  timber(m, [-44, 27, 3, 44, 28, 7], 'x', { seed: seed + 18, chamfer: 0, wear: 0.15 });
  // iron corner straps over the post lines
  for (const sx of [-1, 1])
    for (const [yy, dy] of [[77, -1], [31, 1]] as [number, number][]) {
      ironStrap(m, [sx * 43, yy, 5], [sx * 31, yy, 5], 'z+', { width: 2, rivetEvery: 5, mat: blackIron(seed + sx + yy) });
      ironStrap(m, [sx * 42, yy + dy, 5], [sx * 42, yy + dy * 11, 5], 'z+', { width: 2, rivetEvery: 5, mat: blackIron(seed + sx + yy + 1) });
    }
  // ---- posters (oldest first; later sheets overlap earlier ones)
  const L = flip
    ? { old: [14, 36] as [number, number], A: [-31, 40], B: [4, 38], N: [-40, 33], lookA: 2, lookB: 1, rewA: '$250', rewB: '$900', tearB: 'corner' as const }
    : { old: [-40, 36] as [number, number], A: [-30, 38], B: [4, 41], N: [22, 33], lookA: 0, lookB: 1, rewA: '$500', rewB: '$750', tearB: 'none' as const };
  placeSheet(m, posterSheet('old', 25, 34, seed + 101, { look: 2, reward: '$100', tear: 'half' }), L.old[0], L.old[1], 6, flip ? 0.05 : -0.04);
  const atA = placeSheet(m, posterSheet('wanted', 25, 34, seed + 102, { look: L.lookA, reward: L.rewA, dogEar: !flip }), L.A[0], L.A[1], 6, flip ? -0.03 : 0.035);
  const atB = placeSheet(m, posterSheet('wanted', 25, 34, seed + 103, { look: L.lookB, reward: L.rewB, tear: L.tearB, dogEar: flip }), L.B[0], L.B[1], 6, flip ? 0.04 : -0.025);
  const atN = placeSheet(m, posterSheet('notice', 17, 15, seed + 104, { lines: flip ? ['GOLD', 'MINE'] : ['LOST', 'MULE'] }), L.N[0], L.N[1], 6, flip ? 0.06 : -0.07);
  // nails pinning the sheets (top corners; the old one hangs from one)
  for (const at of [atA, atB]) for (const lx of [1, 23]) nailHead(m, at(lx, 32), 'z+', { rust: 0.5, streak: 0 });
  nailHead(m, atN(1, 13), 'z+', { rust: 0.5, streak: 0 });
  nailHead(m, [L.old[0] + 1, L.old[1] + 32 + (flip ? -1 : 1), 6], 'z+', { rust: 0.8, streak: 0 });
  // a knife pinning the notice: blade in the board, brass guard, leather grip, pommel
  {
    const [kx, ky] = atN(13, 9);
    const grip = leather({ seed, tone: 0x5a3820, wear: 0.4 });
    m.set(kx, ky, 6, 0xc8ccd0, VF.METAL).set(kx, ky + 1, 6, 0xc8ccd0, VF.METAL);
    for (let y = ky - 2; y <= ky + 3; y++) m.set(kx, y, 7, brass({ seed }), VF.METAL);
    for (let z = 8; z <= 12; z++) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.set(kx + dx, ky + dy - (z > 10 ? 1 : 0), z, mod(z, 2) ? grip : mixRGB(0x5a3820, 0x2a1a10, 0.4));
    m.set(kx, ky - 1, 13, brass({ seed: seed + 1 }), VF.METAL).set(kx + 1, ky - 1, 13, brass({ seed: seed + 1 }), VF.METAL);
  }
  // torn scraps left round old nails along the top
  for (const [sx0, sy0, w, hh] of (flip ? [[-12, 74, 4, 3], [30, 72, 3, 4]] : [[-3, 75, 4, 3], [33, 70, 3, 5]]) as [number, number, number, number][]) {
    for (let x = 0; x < w; x++) for (let y = 0; y < hh; y++) if (x + (hh - 1 - y) < w + 1 - (hash3(x, y, seed) < 0.4 ? 1 : 0)) m.set(sx0 + x, sy0 + y, 6, mixRGB(0xd8c49a, 0xfff2da, 0.3), VF.SOFTAO);
    nailHead(m, [sx0 + 1, sy0 + hh - 1, 6], 'z+', { rust: 0.9, streak: 0 });
  }
  // ---- bullet holes: a grouping through poster A's portrait, the rest scattered
  const shots: [number, number][] = [];
  for (const [lx, ly] of [[11, 17], [14, 15], [12, 13]]) {
    const p = atA(lx, ly);
    shots.push([p[0], p[1]]);
  }
  for (let i = 0; i < 8; i++) shots.push([Math.round(-40 + hash3(i, seed, 51) * 80), Math.round(31 + hash3(i, seed, 52) * 45)]);
  shots.forEach(([x, y], i) => {
    if (m.has(x, y, 8)) return; // not into the knife or a ledge
    let z = 7;
    while (z > 2 && !m.has(x, y, z)) z--;
    if (z < 4) return;
    const paper = z >= 6;
    bulletHole(m, [x, y, z], 'z+', { through: z - 3, seed: seed + i, paper, big: i === 4 });
    // splintered exit on the back of the board
    if (!m.has(x, y, 3)) for (const [dx, dy] of [[1, 0], [-1, 1], [0, -1]]) if (hash3(i, dx, dy) < 0.6) m.set(x + dx, y + dy, 3, WOOD.bleached.tones[4]);
  });
  // ---- lantern on a wrought bracket (outer face of one post), padlocked chain on the other
  const ls: 1 | -1 = flip ? -1 : 1;
  lanternOnBracket(m, ls * (PX + 4), ls, 77, seed);
  {
    const cx = -ls * PX;
    const iron = blackIron(seed + 21, 0.5);
    m.set(cx - 1, 23, 4, iron, VF.METAL).set(cx + 1, 23, 4, iron, VF.METAL);
    for (let x = cx - 1; x <= cx + 1; x++) m.set(x, 23, 5, iron, VF.METAL);
    chainLinks(m, [[cx, 22, 5], [cx, 14, 5]], { mat: iron, link: 3 });
    const lock = brass({ seed: seed + 22, patina: 0.5 });
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = 7; y <= 11; y++) for (let z = 4; z <= 6; z++) if (!(Math.abs(x - cx) === 2 && (y === 7 || y === 11))) m.set(x, y, z, lock, VF.METAL);
    m.set(cx, 8, 7, 0x1a120c).set(cx, 9, 7, 0x1a120c);
    m.set(cx - 1, 12, 5, iron, VF.METAL).set(cx + 1, 12, 5, iron, VF.METAL).set(cx - 1, 13, 5, iron, VF.METAL).set(cx + 1, 13, 5, iron, VF.METAL);
  }
  // a dented tin can on the bottom ledge
  {
    const cx = flip ? 30 : -18, cz = 5;
    const can = tin({ seed: seed + 23, rust: 0.6, rustBelow: 31 });
    for (let y = 29; y <= 33; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 5 && !(y === 33 && x * x + z * z <= 1)) m.set(cx + x, y, cz + z, y === 31 ? mixRGB(RED_INK, 0xd8c8a0, 0.3) : can, VF.METAL);
    m.set(cx + 1, 34, cz - 1, can, VF.METAL).set(cx + 1, 35, cz - 2, can, VF.METAL); // peeled lid
  }
  // ---- feet: drifted sand mounds and wedge stones round each post, a dropped scrap
  const sand = sandMat({ seed });
  for (const sx of [-1, 1]) {
    const cx = sx * PX;
    for (let x = -12; x <= 12; x++)
      for (let z = -10; z <= 11; z++) {
        const d = Math.hypot(x / 12, z / (z > 0 ? 11 : 9));
        if (d > 1) continue;
        const h = Math.round(4.6 * Math.pow(1 - d, 1.3) + n3s(cx + x, z, seed) * 0.9);
        for (let y = 0; y < h; y++) if (!m.has(cx + x, y, z)) m.set(cx + x, y, z, sand, NOCOL);
      }
    for (let k = 0; k < 4; k++) {
      const a = hash3(sx, k, seed) * Math.PI * 2;
      fieldStone(m, [cx + Math.round(Math.cos(a) * 6), 2, Math.round(Math.sin(a) * 6)], [2.2 + hash3(k, sx, 1) * 1.8, 1.6 + hash3(k, sx, 2), 2 + hash3(k, sx, 3) * 1.5], { seed: seed * 9 + k + sx * 4, mat: sandstone({ seed: seed + k, bed: 2 }), flags: NOCOL });
    }
  }
  for (let x = 0; x < 6; x++) for (let z = 0; z < 4; z++) if (x + z < 7 && hash3(x, z, seed + 5) > 0.15) m.set((flip ? 6 : -10) + x, 0, 9 + z - (x >> 2), mixRGB(0xd2bc90, 0xfff2da, 0.2), NOCOL | VF.SOFTAO);
  return S(m, WVS);
}
/** seeded 2D noise helper (-1..1) for the props in this file */
const n3s = (x: number, z: number, seed: number) => noiseField.n2(x * 0.21 + seed * 3.1, z * 0.21 - seed * 1.7);

/** stone well with a little gable roof, crank, rope and bucket. 1/20 */
export function well(seed = 0): StaticModel {
  const m = new VoxelModel('well');
  const ms = masonry(PR.stone, 5, 3, PR.stone.dark, seed);
  for (let y = 0; y <= 12; y++)
    for (let x = -11; x <= 11; x++)
      for (let z = -11; z <= 11; z++) {
        if (!inCircle(x, z, 10.5) || inCircle(x, z, 7.5)) continue;
        m.set(x, y, z, y === 12 ? PR.stone.hi : ms(x, y, z));
      }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (inCircle(x, z, 7.5)) m.set(x, 4, z, PR.water.dark);
  for (const x of [-10, 9]) post(m, x, -1, 12, 40, 2, PR.woodDark, seed + x);
  for (let x = -14; x <= 14; x++)
    for (let z = -8; z <= 8; z++) {
      const y = 46 - Math.round(Math.abs(z) * 0.7);
      m.set(x, y, z, mod(z, 3) === 0 ? PR.woodDark.dark : PR.woodDark.base);
      if (Math.abs(x) === 14) for (let yy = 40; yy < y; yy++) m.set(x, yy, z, PR.wood.base);
    }
  // crank axle + handle
  m.box(-11, 32, 0, 11, 33, 1, PR.woodDark.base);
  m.box(12, 30, 0, 12, 33, 1, PR.iron.base, VF.METAL);
  m.box(12, 30, 2, 12, 30, 4, PR.iron.base, VF.METAL);
  rope(m, [[0, 31, 0], [0, 18, 0]]);
  cylY(m, 0, 0, 13, 17, 2.4, PR.wood.base);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (inCircle(x, z, 2.4) && !inCircle(x, z, 1.4)) m.set(x, 15, z, PR.iron.base, VF.METAL);
  return S(m, VS);
}

export function cattleSkullPost(seed = 0): StaticModel {
  const m = new VoxelModel('cattle_skull_post');
  post(m, -1, -2, 0, 32, 3, PR.woodGrey, seed);
  const sk = cowSkullModel();
  sk.forEach((x, y, z, c, f) => m.set(x, y + 24, z, c, f));
  sandDrift(m, 0, 0, 4, 4, 2, 0, seed);
  return S(m, VS);
}

/** terracotta pots: 0 amphora, 1 round jar with lid, 2 pair of small pots. painted band */
export function pot(seed = 0): StaticModel {
  const m = new VoxelModel('pot');
  const k = mod(seed, 3);
  const tc = PR.terracotta;
  const band = (y: number, x: number, z: number) => {
    const a = Math.atan2(z, x);
    return mod(Math.round((a / (Math.PI * 2)) * 24) + y, 4) < 2 ? PR.paintWhite.base : PR.ink.base;
  };
  const vase = (cx: number, cz: number, H: number, prof: (t: number) => number, bandY: number[]) => {
    for (let y = 0; y <= H; y++) {
      const rr = prof(y / H);
      const R = Math.ceil(rr) + 1;
      for (let x = -R; x <= R; x++)
        for (let z = -R; z <= R; z++) {
          if (!inCircle(x, z, rr)) continue;
          const outer = !inCircle(x, z, rr - 1);
          if (!outer && y > 1 && y < H) continue;
          let c = outer && y > H * 0.6 ? tc.hi : tc.base;
          if (bandY.includes(y) && outer) c = band(y, x, z);
          if (y === H && !outer) c = tc.dark;
          m.set(cx + x, y, cz + z, c);
        }
    }
  };
  if (k === 0) {
    vase(0, 0, 22, (t) => 2.5 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 5 - (t > 0.82 ? 2.5 : 0), [9, 10]);
    for (const sx of [-1, 1]) {
      m.box(sx * 5, 15, 0, sx * 6, 15, 0, tc.shade);
      m.box(sx * 6, 15, 0, sx * 6, 19, 0, tc.shade);
      m.box(sx * 4, 19, 0, sx * 6, 19, 0, tc.shade);
    }
  } else if (k === 1) {
    vase(0, 0, 14, (t) => 3 + Math.sin(t * Math.PI) * 5, [6, 7]);
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (inCircle(x, z, 3.6)) m.set(x, 15, z, tc.shade);
    m.box(0, 16, 0, 0, 17, 0, tc.dark);
  } else {
    vase(-4, 0, 12, (t) => 2 + Math.sin(t * Math.PI) * 3.5, [5]);
    vase(5, 2, 8, (t) => 2 + Math.sin(t * Math.PI) * 3, [4]);
  }
  return S(m, VS);
}

/** woven rug, 1 voxel thick, Navajo-style diamonds, tassels. 1/20 */
export function rug(seed = 0): StaticModel {
  const m = new VoxelModel('rug');
  const L = 22, W = 14;
  const pal = mod(seed, 2) ? [PR.red.base, PR.paintWhite.base, PR.ink.base, PR.paintYellow.base] : [PR.lapis.base, PR.paintWhite.base, PR.red.shade, PR.turquoise.base];
  for (let x = -L; x <= L; x++)
    for (let z = -W; z <= W; z++) {
      const bx = Math.abs(x), bz = Math.abs(z);
      let c = pal[0];
      if (bz === W || bx === L) c = pal[2];
      else if (bz === W - 2 || bx === L - 2) c = pal[1];
      else {
        const cx = mod(x + L, 14) - 7;
        const d = Math.abs(cx) + bz;
        if (d < 4) c = pal[3];
        else if (d < 6) c = pal[1];
        else if (d === 8 || d === 9) c = pal[2];
      }
      m.set(x, 0, z, c);
    }
  for (const sx of [-1, 1]) for (let z = -W + 1; z <= W - 1; z += 2) m.set(sx * (L + 1), 0, z, PR.paintWhite.shade);
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// false-front facades (1/12)
// ---------------------------------------------------------------------------
type FacadeMeta = { entrance: [number, number]; footprint: [number, number]; height: number };

function facade(name: string, seed: number, wM: number, dM: number, hM: number, frontExtraM: number, paint: Ramp, sign: string[], signBg: Ramp, opts: { batwing?: boolean; bars?: boolean; balcony?: boolean; goods?: boolean; star?: boolean } = {}): StaticModel & { meta: FacadeMeta } {
  const vs = BVS;
  const v = meters(vs);
  const m = new VoxelModel(name);
  const b = building(m, 0, 0, v(wM), v(dM), v(hM), { fy: 4, r: paint, seed, vertical: false, bw: 3 });
  shedRoof(m, b, 8, { tin: true, seed });
  // false front rising above the roof with a stepped top + cornice
  const FT = b.top + v(frontExtraM);
  for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
    const step = Math.abs(x - (b.x0 + b.x1) / 2) < (b.x1 - b.x0) * 0.22 ? 4 : 0;
    for (let y = b.top + 1; y <= FT + step; y++) {
      const a = y - b.top;
      const c = mod(a, 3) === 0 ? paint.dark : paint.base;
      m.set(x, y, b.z1, c).set(x, y, b.z1 - 1, paint.shade);
    }
    m.set(x, FT + step + 1, b.z1 + 1, PR.woodDark.base).set(x, FT + step + 1, b.z1, PR.woodDark.base).set(x, FT + step + 2, b.z1, PR.woodDark.hi);
  }
  for (let x = b.x0 - 2; x <= b.x1 + 2; x++) m.set(x, b.top + 1, b.z1 + 1, PR.woodDark.base);
  // big painted sign on the false front
  const cx = Math.round((b.x0 + b.x1) / 2);
  signPanel(m, cx, b.top + 3, b.z1 + 2, sign, { bg: signBg, ink: signBg === PR.paintWhite ? PR.red.dark : PR.paintWhite.hi, pad: 2, thick: 2, scale: sign[0].length > 10 ? 1 : 2 });
  const doorW0 = opts.batwing ? 12 : 10;
  doorW(m, b.front, cx - Math.floor(doorW0 / 2), b.fy + 1, doorW0, 26, { batwing: opts.batwing, r: PR.woodDark, trim: PR.paintWhite });
  for (const sx of [-1, 1]) windowW(m, b.front, sx < 0 ? b.x0 + 6 : b.x1 - 17, b.fy + 8, 11, 12, { frame: PR.paintWhite, cross: true });
  if (opts.bars) for (const sx of [-1, 1]) for (let k = 0; k < 11; k += 2) for (let y = b.fy + 8; y < b.fy + 20; y++) m.set((sx < 0 ? b.x0 + 6 : b.x1 - 17) + k, y, b.z1 + 1, PR.iron.base, VF.METAL);
  porchFront(m, b, b.x0 - 1, b.x1 + 1, 16, b.top - 2, { tin: false, seed, rail: true });
  if (opts.balcony) {
    for (let x = b.x0; x <= b.x1; x++) for (let y = b.top - 1; y <= b.top + 5; y++) if (y === b.top + 5 || mod(x, 3) === 0) m.set(x, y, b.z1 + 15, y === b.top + 5 ? PR.wood.hi : PR.wood.base);
  }
  if (opts.goods) {
    barrelBody(m, b.x0 + 4, b.z1 + 8, b.fy + 1, 11, 4, PR.wood);
    m.box(b.x1 - 12, b.fy + 1, b.z1 + 5, b.x1 - 4, b.fy + 9, b.z1 + 12, PR.woodLight.base);
    m.box(b.x1 - 12, b.fy + 9, b.z1 + 5, b.x1 - 4, b.fy + 9, b.z1 + 12, PR.woodLight.hi);
    m.box(b.x1 - 10, b.fy + 10, b.z1 + 7, b.x1 - 5, b.fy + 14, b.z1 + 11, PR.wood.base);
  }
  if (opts.star) {
    const sy = b.top - 5, sz = b.z1 + 1;
    const star = ['..#..', '.###.', '#####', '.###.', '##.##'];
    star.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && m.set(cx + 10 + j, sy - i, sz, PR.gold.base, VF.METAL)));
  }
  sandDrift(m, b.x1 + 6, b.z0, 16, 24, 6, 0, seed);
  const W = b.x1 - b.x0 + 4, D = b.z1 + 18 - b.z0;
  return {
    model: m,
    voxelSize: vs,
    meta: { entrance: [0, (b.z1 + 16 + v(1.5) - (b.z0 + b.z1 + 18) / 2) * vs], footprint: [W * vs, D * vs], height: (FT + 6) * vs },
  };
}

export function saloonFacade(seed = 0): StaticModel & { meta: FacadeMeta } {
  return facade('saloon_facade', seed, 8.4, 7, 4.2, 2.2, PR.barnRed, ['SALOON'], PR.paintWhite, { batwing: true, balcony: true });
}
export function sheriffFacade(seed = 0): StaticModel & { meta: FacadeMeta } {
  return facade('sheriff_facade', seed, 7.4, 7, 3.8, 1.8, PR.woodLight, ['SHERIFF'], PR.paintWhite, { bars: true, star: true });
}
export function generalStoreFacade(seed = 0): StaticModel & { meta: FacadeMeta } {
  return facade('general_store_facade', seed, 9.4, 7, 4, 2.0, PR.paintGreen, ['GENERAL STORE'], PR.paintWhite, { goods: true });
}

export { barrelBody, wheelModel, crateBody };
