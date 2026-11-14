// Main-menu sign boards (menu only), a step up from menuSet.arrowPlank: each choice is a thick, knotty,
// split arrow board (1/96) with
//  - a routed border groove following the outline, sun-bleached top arris, a charred sawn end;
//  - carved Alagard letters painted deep, edged in gold leaf on their lit side, a sign-painter shadow;
//  - a riveted iron cap sheathing the arrow tip and a riveted, rusted iron strap round the nailed end;
//  - old bullet holes punched through (splintered pale rims, scorch).
// Plus the HIDEOUT board's lock: iron chains (stamped link by link along a line) and a heavy padlock
// whose shackle is its own model, so the lock can spring open and the chains fall away.
// Typography (Alagard) is only ever used as a mask for 3D voxels.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { noise, hash2 } from '../../../engine/math/rand';
import type { Ramp } from '../style';
import { mixRGB } from './helpers';
import { alagardMask } from './menuSet';

export type V3 = [number, number, number];
const IRON = { hi: 0x9a968e, base: 0x6c6a66, shade: 0x4a4846, dark: 0x2a2826 };
const STEEL = { hi: 0xe4e0d6, base: 0xb4b0a6, shade: 0x77736c };
const RUST = { hi: 0xc4743e, base: 0x9c5532, shade: 0x7a4024, dark: 0x4e2614 };
const GILT = { hi: 0xfff0a6, base: 0xe2b24a, shade: 0xa8741e };
const CHAR = 0x2a1a10;

export interface SignBoard {
  model: VoxelModel;
  voxelSize: number;
  /** nail end, back face (build the mesh with this pivot) */
  pivot: V3;
  length: number;
  height: number;
}

/**
 * One menu choice. dir: which way the arrow points (+1 right, -1 left); ink: the letter paint.
 * Letters carry VF.EMISSIVE so the hover can light them; the gold leaf glows a touch more (METAL).
 */
export function signBoard(label: string, dir: 1 | -1, seed: number, wood: Ramp, ink: Ramp): SignBoard {
  const vs = 1 / 96;
  const m = new VoxelModel('menu_sign_' + label);
  const g = alagardMask(label, 32);
  const H = Math.max(38, g.h + 20), T = 8;
  const tip = Math.round(H * 0.5);
  const L = g.w + 40 + tip;
  const mid = (H - 1) / 2;
  const body0 = dir > 0 ? 8 : tip, body1 = dir > 0 ? L - tip : L - 8;
  const tx0 = Math.round((body0 + body1 - g.w) / 2);
  const ty0 = Math.round((H - g.h) / 2);
  const text = (x: number, y: number) => g.on(x - tx0, H - 1 - y - ty0);
  const half = (x: number) => {
    const e = dir > 0 ? L - 1 - x : x; // distance from the tip end
    if (e >= tip) return H / 2;
    return Math.max(2.2, (H / 2) * ((e + 1.4) / tip)) + noise.n2(x * 0.4, seed) * 0.5;
  };
  const inside = (x: number, y: number) => x >= 0 && x < L && Math.abs(y - mid) <= half(x);
  /** distance (px, capped at 6) from the board's outline on the front */
  const edgeDist = (x: number, y: number) => {
    for (let r = 1; r <= 5; r++) if (!inside(x - r, y) || !inside(x + r, y) || !inside(x, y - r) || !inside(x, y + r)) return r;
    return 6;
  };
  const knots = [0, 1, 2].map((k) => ({ x: body0 + 10 + hash2(seed, k) * (body1 - body0 - 20), y: 5 + hash2(seed, k + 7) * (H - 10), on: hash2(seed, k + 3) < 0.6 }));
  // bullet holes: in the margins clear of the letters
  const holes: { x: number; y: number }[] = [];
  for (let k = 0; k < 6 && holes.length < 2; k++) {
    const hx = Math.round(body0 + 6 + hash2(seed * 3, k) * (body1 - body0 - 12)), hy = Math.round(4 + hash2(seed * 5, k) * (H - 8));
    let clear = true;
    for (let dy = -4; dy <= 4 && clear; dy++) for (let dx = -4; dx <= 4; dx++) if (text(hx + dx, hy + dy)) clear = false;
    if (clear && edgeDist(hx, hy) > 4) holes.push({ x: hx, y: hy });
  }
  const crackY = Math.round(H * (0.22 + hash2(seed, 31) * 0.56));
  const strap0 = dir > 0 ? 12 : L - 18, strap1 = strap0 + 5;
  for (let x = 0; x < L; x++) {
    const sq = dir > 0 ? x : L - 1 - x; // distance from the nailed (sawn) end
    const e = dir > 0 ? L - 1 - x : x; // distance from the tip
    const hh = half(x);
    for (let y = 0; y < H; y++) {
      if (Math.abs(y - mid) > hh) continue;
      const edgeRow = Math.abs(y - mid) > hh - 1;
      if (edgeRow && hash2(x * 7 + seed, y) < 0.14) continue; // nicks along the edges
      if (sq < 2 && hash2(y + seed, sq) < 0.35) continue; // splintered sawn end
      const ed = edgeDist(x, y);
      const capped = e < tip + 4 && ed <= 4; // the iron tip cap
      const strap = x >= strap0 && x <= strap1;
      let hole = false;
      for (const h of holes) if (Math.hypot(x - h.x, y - h.y) < 1.6) hole = true;
      if (hole) continue;
      for (let z = 0; z < T; z++) {
        const front = z === T - 1;
        // wood: grain bands that bow round the knots
        let bow = 0;
        for (const k of knots) if (k.on) bow += 2.6 * Math.exp(-((x - k.x) ** 2) / 90 - ((y - k.y) ** 2) / 30) * Math.sign(y - k.y + 0.01);
        const yy = y + bow + 1.6 * Math.sin(x * 0.045 + seed) + noise.n2(x * 0.02, y * 0.3 + seed) * 1.2;
        const hv = hash2(Math.floor(yy / 2.6), seed);
        let c = hv < 0.25 ? wood.shade : hv > 0.82 ? wood.hi : wood.base;
        if (noise.n2(x * 0.008 + seed, y * 0.5) > 0.55) c = mixRGB(c, wood.dark, 0.35);
        for (const k of knots) {
          if (!k.on) continue;
          const kd = Math.hypot((x - k.x) / 3.4, (y - k.y) / 1.9);
          if (kd < 1) c = kd < 0.5 ? wood.dark : mixRGB(wood.shade, wood.dark, 0.5);
        }
        // sun-bleached top, a charred sawn end
        if (y > mid + hh - 3) c = mixRGB(c, 0xf4e6c8, 0.25);
        if (sq < 7) c = mixRGB(c, CHAR, (7 - sq) / 9 + hash2(x, y * 3) * 0.15);
        if (!front) c = z === 0 ? mixRGB(c, wood.dark, 0.3) : mixRGB(c, wood.shade, 0.45);
        else if (edgeRow) c = y > mid ? mixRGB(c, wood.hi, 0.6) : mixRGB(c, wood.dark, 0.3);
        // scorch and splinters round the bullet holes
        for (const h of holes) {
          const r = Math.hypot(x - h.x, y - h.y);
          if (front && r < 2.6) c = hash2(x * 3, y) < 0.5 ? mixRGB(wood.hi, 0xffffff, 0.3) : CHAR;
          else if (front && r < 3.6 && hash2(x, y * 7) < 0.6) c = mixRGB(c, CHAR, 0.5);
        }
        // a crack along the grain
        const crack = y === crackY + Math.round(Math.sin(x * 0.11 + seed) * 1.1) && sq > 10 && sq < L * 0.45;
        if (crack && front) continue;
        if (crack && z === T - 2) c = wood.dark;
        // the routed border groove
        if (front && ed === 3 && !capped && !(x >= strap0 - 1 && x <= strap1 + 1)) {
          m.set(x, y, z - 1, mixRGB(wood.dark, CHAR, 0.3));
          continue;
        }
        let fl: number = VF.SOLID;
        if (text(x, y)) {
          if (front) continue; // carved
          if (z === T - 2) {
            const chipped = hash2(x * 13, y * 7 + seed) < 0.03;
            const lit = !text(x, y + 1) || !text(x - 1, y);
            c = chipped ? wood.shade : lit ? GILT.hi : !text(x, y - 1) ? ink.shade : ink.base;
            if (!chipped) fl = lit ? VF.EMISSIVE | VF.METAL : VF.EMISSIVE;
          }
        } else if (front && text(x - 1, y + 1)) c = 0x2e1c10; // drop shadow
        else if (front && (text(x, y - 1) || text(x + 1, y))) c = mixRGB(c, GILT.shade, 0.5); // gilt bevel on the cut
        m.set(x, y, z, c, fl);
      }
      // iron, proud of the wood on both faces: the tip cap and the strap
      if (capped || strap) {
        for (const z of [-1, T]) {
          let c = noise.n2(x * 0.3 + z, y * 0.3) > 0.3 ? RUST.base : hash2(x, y + z) < 0.2 ? IRON.shade : IRON.base;
          if (y > mid + hh - 1.5) c = IRON.hi;
          if (strap && (x === strap0 || x === strap1)) c = IRON.shade;
          if (strap && z === T && hash2(x, y) < 0.15 && y < mid) c = RUST.hi; // rust running down
          m.set(x, y, z, c, VF.METAL);
        }
      }
    }
  }
  // rivets on the cap and the strap, square nails at the post end
  const cx = dir > 0 ? L - tip - 1 : tip;
  for (const ry of [Math.round(mid) - Math.round(H * 0.3), Math.round(mid) + Math.round(H * 0.3)]) {
    m.set(cx, ry, T + 1, IRON.hi, VF.METAL).set(cx + 1, ry, T + 1, IRON.base, VF.METAL);
  }
  m.set(dir > 0 ? L - 6 : 5, Math.round(mid), T + 1, IRON.hi, VF.METAL);
  for (let y = 4; y < H - 4; y += 7) m.set(strap0 + 2, y, T + 1, IRON.hi, VF.METAL).set(strap0 + 3, y, T + 1, IRON.base, VF.METAL);
  const nx = dir > 0 ? 6 : L - 7;
  for (const ny of [Math.round(mid) - 10, Math.round(mid) + 9]) {
    m.set(nx, ny, T, IRON.base, VF.METAL).set(nx + 1, ny, T, IRON.shade, VF.METAL).set(nx, ny + 1, T, IRON.hi, VF.METAL).set(nx + 1, ny + 1, T, IRON.base, VF.METAL);
    m.set(nx, ny - 1, T - 1, RUST.shade).set(nx + 1, ny - 2, T - 1, RUST.shade);
  }
  const pivot: V3 = [dir > 0 ? 3 : L - 3, mid + 0.5, 0];
  return { model: m, voxelSize: vs, pivot, length: L * vs, height: H * vs };
}

// ============================================================================ the hideout's lock
/** an iron chain stamped link by link from a to b (voxels, 1/96), links alternating face-on / edge-on; pivot at its middle */
export function chainLine(ax: number, ay: number, bx: number, by: number, seed = 0) {
  const m = new VoxelModel('menu_lock_chain');
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  const n = Math.floor(len / 6);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  for (let i = 0; i <= n; i++) {
    const cx = ax + ux * i * 6 - mx, cy = ay + uy * i * 6 - my;
    const flat = i % 2 === 0;
    const rusty = hash2(i, seed) < 0.3;
    // a fat forged link: two rings stamped together
    for (const [ra, rb] of [[4.2, 2.6], [3.3, 1.7]])
      for (let a = 0; a < 34; a++) {
        const th = (a / 34) * Math.PI * 2;
        const along = Math.cos(th) * ra, across = Math.sin(th) * rb;
        const lit = Math.sin(th) > 0.2 && ra > 4;
        const c = rusty ? (lit ? RUST.hi : RUST.base) : lit ? STEEL.hi : Math.sin(th) < -0.4 ? STEEL.shade : STEEL.base;
        if (flat) m.set(Math.round(cx + ux * along - uy * across), Math.round(cy + uy * along + ux * across), 0, c, VF.METAL);
        else m.set(Math.round(cx + ux * along), Math.round(cy + uy * along), Math.round(across), c, VF.METAL);
      }
  }
  return { model: m, voxelSize: 1 / 96 };
}

/** a heavy iron padlock: a rounded, rust-streaked body with a brass keyhole escutcheon (1/96, pivot = centre of the body's top) */
export function padlockBody() {
  const m = new VoxelModel('menu_padlock');
  const W = 8, Hh = 14, D = 3;
  for (let x = -W; x <= W; x++)
    for (let y = -Hh; y <= 0; y++)
      for (let z = -D; z <= D; z++) {
        // a rounded bottom and bevelled edges
        const by = y < -Hh + W ? Math.hypot(x / W, (y + Hh - W) / W) : Math.abs(x / W);
        if (by > 1.02) continue;
        if (Math.abs(z) === D && (by > 0.88 || y > -1)) continue;
        const front = z === D || (z === D - 1 && by > 0.88);
        let c = by > 0.86 ? IRON.shade : IRON.base;
        if (y > -3) c = IRON.hi;
        if (noise.n2(x * 0.4, y * 0.25) > 0.35) c = RUST.base; // rust running down from the shackle holes
        if (front && hash2(x * 5, y * 3) < 0.07) c = RUST.dark;
        m.set(x, y, z, c, VF.METAL);
      }
  // the escutcheon and keyhole
  for (let x = -3; x <= 3; x++)
    for (let y = -10; y <= -3; y++) {
      if (Math.hypot(x / 3.2, (y + 6.5) / 4.2) > 1) continue;
      const hole = (x === 0 && y >= -8 && y <= -5) || (Math.abs(x) <= 1 && y === -5);
      m.set(x, y, D + 1, hole ? 0x0a0806 : y > -6 ? GILT.hi : GILT.base, hole ? VF.SOLID : VF.METAL);
    }
  return { model: m, voxelSize: 1 / 96, pivot: [0.5, 0.5, 0.5] as V3 };
}

/** the padlock's U shackle (1/96, pivot = the hinge leg's foot) */
export function padlockShackle() {
  const m = new VoxelModel('menu_padlock_shackle');
  const R = 5.5;
  for (let a = 0; a <= 40; a++) {
    const th = (a / 40) * Math.PI;
    const x = Math.cos(th) * R, y = 6 + Math.sin(th) * R;
    for (let k = -1; k <= 0; k++) for (let z = -1; z <= 0; z++) m.set(Math.round(x + R) + k, Math.round(y), z, k === 0 && z === 0 ? IRON.hi : IRON.base, VF.METAL);
  }
  for (let y = 0; y <= 6; y++) for (const x of [0, Math.round(2 * R)]) for (let k = -1; k <= 0; k++) for (let z = -1; z <= 0; z++) m.set(x + k, y, z, k === 0 ? IRON.hi : IRON.shade, VF.METAL);
  return { model: m, voxelSize: 1 / 96, pivot: [0, 0, 0] as V3, span: Math.round(2 * R) };
}
