// Outlaw HUD furniture — the sheriff's-office readouts as real 3D pieces in the
// HUD overlay, sculpted on dense voxel grids with realistic materials:
//  • TIN STAR: a pressed-tin six-point star with ball tips, a stamped border,
//    a raised boss with the rank struck into it; spins and rings on rank-up
//  • TALLY BOARD: two weathered, nailed pine planks (grain, knots, cracks,
//    splintered ends, a bent nail) with the bounty painted on in chipped paint;
//    it jolts and the figure counts up as reward money comes in
//  • WAVE PLAQUE: a branded leather plaque (burnished edge, saddle stitching,
//    brass tacks, D-rings) hanging on two iron chains, the wave burnt into it;
//    a riveted brass tag below carries the wave clock
//  • POCKET STOPWATCH: during the 30 s break between waves a brass hunter-case
//    stopwatch drops in on its chain under the plaque, lid sprung open: the
//    enamel dial's jade wedge is the time left (the hand points at the seconds,
//    big numerals underneath), the rim fills while the bell is being rung, and
//    the last five seconds tick red and shake it.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VF } from '../../engine/voxel/VoxelModel';
import {
  sculpt, JobQueue, Surf, TextPlane, PixelFx, inkText, measureInk, fbm3, h3, mixc, mulc, clamp, clamp01, sstep, len2, len3, segD, sdRoundBox2, TAU, uiSfx, METAL, KNZ,
} from './HudKit';

const V2 = 2; // voxels per HUD px for the big pieces
const geoOf = (m: ReturnType<typeof sculpt>, vph: number) => buildVoxelGeometry(m, { voxelSize: 1 / vph, pivot: [0, 0, 0] });

// ------------------------------------------------------------------ tin star
function sdStar2(x: number, y: number, r: number, n: number, m: number) {
  const an = Math.PI / n, en = Math.PI / m;
  const acx = Math.cos(an), acy = Math.sin(an), ecx = Math.cos(en), ecy = Math.sin(en);
  const a = Math.atan2(x, y);
  const bn = ((a % (2 * an)) + 2 * an) % (2 * an) - an;
  const L = len2(x, y);
  let px = L * Math.cos(bn), py = L * Math.abs(Math.sin(bn));
  px -= r * acx;
  py -= r * acy;
  const t = clamp(-(px * ecx + py * ecy), 0, (r * acy) / ecy);
  px += ecx * t;
  py += ecy * t;
  return len2(px, py) * Math.sign(px);
}

const TIN = { base: 0xbdb9ae, shade: 0x8a867c, hi: 0xf2efe6, dark: 0x4e4a44, tarnish: 0x9a8656 };
function starModel() {
  const R = 13.2;
  const tips: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    tips.push([Math.sin(a) * (R + 0.6), Math.cos(a) * (R + 0.6)]);
  }
  const top = (X: number, Y: number, d2: number) => {
    const r = len2(X, Y);
    let z = 1.0 + clamp(-d2, 0, 3.4) * 0.5;
    if (d2 > -1.25 && d2 < -0.55) z += 0.35; // stamped border bead
    if (r < 6.9) z = Math.max(z, 2.9 + 0.7 * (1 - (r / 6.9) ** 2));
    if (r > 5.4 && r < 6.1) z -= 0.55; // struck ring round the boss
    return z + 0.18 * fbm3(X * 0.25, Y * 0.25, 2); // little dents
  };
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    const d2 = sdStar2(X, Y, R, 6, 3.3);
    let tip = 99;
    for (const [tx, ty] of tips) tip = Math.min(tip, len2(X - tx, Y - ty));
    return { d2, top: d2 < 0.5 ? top(X, Y, d2) : 0, tip };
  };
  const sd = (x: number, y: number, z: number, c: { d2: number; top: number; tip: number }) => {
    const Z = z / V2;
    if (c.d2 > 0.5 && c.tip > 2.4) return 1;
    let d = Math.max(c.d2, Z - c.top, -Z);
    if (c.tip < 2.4) d = Math.min(d, len2(c.tip, (Z - 1.5) * 1.25) - 2.2);
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.86 ? TIN.hi : lit > 0.55 ? TIN.base : lit > 0.2 ? mixc(TIN.base, TIN.shade, 0.6) : TIN.shade;
    const n = fbm3(x * 0.08, y * 0.08, 1);
    if (s.exp < 0.3) c = mixc(c, n > 0 ? TIN.tarnish : TIN.dark, 0.5);
    else if (n > 0.35) c = mixc(c, TIN.tarnish, (n - 0.35) * 0.9);
    if (s.exp > 0.5) c = mixc(c, TIN.hi, 0.5);
    if (h3(Math.floor(x * 0.4 + y * 0.9), Math.floor(y * 0.35 - x * 0.2), 3) > 0.985) c = TIN.hi; // scratches
    return [mulc(c, 0.94 + h3(x, y, z, 2) * 0.1), METAL];
  };
  return sculpt('hud_tinstar', [-32, -30, 0, 32, 32, 10], sd, paint, VF.SOLID, col);
}

// ------------------------------------------------------------------ tally board
const BOARD_W = 88, BOARD_H = 28;
function boardModel() {
  const planks = [
    { cx: -1.2, cy: 6.9, hw: 43.5, hh: 6.3, s: 1.7 },
    { cx: 1.4, cy: -6.9, hw: 43.8, hh: 6.3, s: 5.3 },
  ];
  const nails: [number, number][] = [];
  for (const p of planks) nails.push([p.cx - p.hw + 3.4, p.cy + 0.6], [p.cx + p.hw - 3.6, p.cy - 0.5]);
  const grain = (lx: number, ly: number, s: number) => Math.abs(Math.sin((ly + fbm3(lx * 0.035, ly * 0.08, s) * 4.5) * 1.75));
  const knot = (lx: number, ly: number, s: number) => len2((lx - (s > 3 ? 18 : -22)) / 2.2, (ly - (s > 3 ? 1.2 : -1.5)) / 1.4);
  // per column: the plank under it (outline distance + carved height) and the nearest nail
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    let best = { d2: 9, zt: 0 };
    for (const p of planks) {
      const lx = X - p.cx, ly = Y - p.cy;
      if (Math.abs(ly) > p.hh + 1 || Math.abs(lx) > p.hw + 3) continue;
      const rag = KNZ.n2(ly * 0.5 + p.s, p.s) * 1.3 + KNZ.n2(ly * 1.7, p.s * 3) * 0.5;
      const d2 = sdRoundBox2(lx, ly, p.hw + rag * Math.sign(lx), p.hh, 0.8);
      if (d2 > 0.5) continue;
      let zt = 2.7 - 0.5 * sstep(0.82, 1, grain(lx, ly, p.s)) - 0.7 * sstep(-1.4, 0, d2);
      const kn = knot(lx, ly, p.s);
      if (kn < 1.6) zt -= 0.35 * (1 - Math.abs(kn - 1) * 1.5);
      // a crack running in from one end along the grain
      const cy0 = p.s > 3 ? 1.6 : -1.9;
      if ((p.s > 3 ? lx < -p.hw + 20 : lx > p.hw - 17) && Math.abs(ly - cy0 - KNZ.n2(lx * 0.2, p.s) * 0.8) < 0.32) zt -= 1.6;
      if (d2 < best.d2) best = { d2, zt };
    }
    let nail = 99;
    for (const [nx, ny] of nails) nail = Math.min(nail, len2(X - nx, Y - ny));
    const bent = X > 28.5 && X < 36.5 && Y > -6 && Y < -0.5;
    return { ...best, nail, bent };
  };
  const sd = (x: number, y: number, z: number, c: { d2: number; zt: number; nail: number; bent: boolean }) => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    let d = Math.max(c.d2, Z - c.zt, -Z);
    if (c.nail < 1.5) d = Math.min(d, len2(c.nail / 1.35, (Z - 2.6) / 0.75) - 1);
    // a bent nail sticking out of the lower plank
    if (c.bent) d = Math.min(d, segD(X, Y, Z, 30, -4.5, 2.5, 31.6, -3.6, 5.6) - 0.42, segD(X, Y, Z, 31.6, -3.6, 5.6, 34.4, -2.2, 6.4) - 0.42, len3(X - 34.7, Y + 2.1, Z - 6.4) - 0.8);
    return d * V2;
  };
  const W = { base: 0x8c6440, grey: 0x9d958a, dark: 0x4a3220, hi: 0xc4a47a, knot: 0x5a3a20 };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    const nailHit = nails.some(([nx, ny]) => len2(X - nx, Y - ny) < 1.6 && Z > 2.2) || (X > 29.5 && X < 36 && Y > -5 && Y < -0.5 && Z > 2.75);
    if (nailHit) {
      const lit = s.nx * -0.4 + s.ny * 0.55 + s.nz * 0.7;
      const n = fbm3(x * 0.2, y * 0.2, 4);
      let c = lit > 0.75 ? 0x9a948c : lit > 0.35 ? 0x5e5652 : 0x3a3230;
      if (n > 0.1) c = mixc(c, 0x8a4a22, 0.6);
      return [c, METAL];
    }
    const p = Y > 0 ? { cx: -1.2, cy: 6.9, s: 1.7 } : { cx: 1.4, cy: -6.9, s: 5.3 };
    const lx = X - p.cx, ly = Y - p.cy;
    const g = grain(lx, ly, p.s);
    const weather = sstep(-0.2, 0.6, fbm3(X * 0.05, Y * 0.12, p.s));
    let c = mixc(W.base, W.grey, weather * 0.75);
    c = mixc(c, W.dark, sstep(0.7, 1, g) * 0.6);
    const kn = knot(lx, ly, p.s);
    if (kn < 1.8) c = mixc(c, W.knot, 0.7 * (1 - Math.abs(Math.sin(kn * 6)) * 0.4));
    if (s.exp < 0.3 || s.nz < 0.2) c = mixc(c, W.dark, 0.55);
    if (s.exp > 0.5 && s.nz > 0.3) c = mixc(c, W.hi, 0.35);
    return [mulc(c, 0.9 + h3(x, y, z, 5) * 0.16), VF.SOLID];
  };
  return sculpt('hud_tally', [-92, -30, 0, 92, 30, 14], sd, paint, VF.SOLID, col);
}

// ------------------------------------------------------------------ leather plaque
const PLQ_W = 132, PLQ_H = 30;
const TACKS: [number, number][] = [[-60.5, 10.5], [60.5, 10.5], [-60.5, -10.5], [60.5, -10.5]];
const RINGS: [number, number][] = [[-46, 16.8], [46, 16.8]];
function plaqueModel() {
  const hw = PLQ_W / 2, hh = PLQ_H / 2;
  const outline = (X: number, Y: number) => {
    let d = sdRoundBox2(X, Y, hw, hh, 5.5) + 0.35 * fbm3(X * 0.3, Y * 0.3, 7);
    d = Math.max(d, -(len2(Math.abs(X) - hw - 0.5, Y) - 3.4)); // V-notches mid-sides
    return d;
  };
  // per column: outline distance, carved height (dome, burnished edge, stitch groove + stitches), tack / ring nearby
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    const d2 = outline(X, Y);
    let zt = 2.0 + 0.6 * clamp01(-d2 / 7) - 0.8 * sstep(1.1, 0, -d2);
    const gd = Math.abs(d2 + 3.0);
    if (gd < 0.42) zt -= 0.55; // stitching groove
    if (d2 < 0.5) zt += 0.12 * fbm3(X * 0.4, Y * 0.4, 1); // grain / wrinkles
    let stitch = false;
    if (gd < 0.5) {
      const along = Math.atan2(Y, X * 0.25) * 30;
      stitch = ((along % 1) + 1) % 1 < 0.55;
    }
    let tack = 99;
    for (const [tx, ty] of TACKS) tack = Math.min(tack, len2(X - tx, Y - ty));
    let ring = -1;
    for (let i = 0; i < RINGS.length; i++) if (Math.abs(X - RINGS[i][0]) < 4 && Math.abs(Y - RINGS[i][1]) < 6.5) ring = i;
    return { d2, zt, stitch, tack, ring };
  };
  const sd = (x: number, y: number, z: number, c: { d2: number; zt: number; stitch: boolean; tack: number; ring: number }) => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    let d = Math.max(c.d2, Z - c.zt, -Z);
    // saddle stitches proud of the groove
    if (c.stitch) d = Math.min(d, Math.max(c.d2, Z - (c.zt + 0.45), -Z));
    if (c.tack < 1.8) d = Math.min(d, len2(c.tack / 1.75, (Z - 2.3) / 1.0) - 1);
    // D-rings on riveted leather tabs
    if (c.ring >= 0) {
      const [rx, ry] = RINGS[c.ring];
      d = Math.min(d, len2(len2(X - rx, (Y - ry) * 1.15) - 2.6, Z - 2.4) - 0.62);
      d = Math.min(d, Math.max(sdRoundBox2(X - rx, Y - ry + 3.2, 2.6, 2.4, 0.9), Z - 2.9, -Z));
    }
    return d * V2;
  };
  const L = { base: 0x7a4526, shade: 0x55301a, hi: 0x9c6238, edge: 0x3a1c0c, thread: 0xe8d2a0 };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    for (const [tx, ty] of TACKS)
      if (len2(X - tx, Y - ty) < 1.9 && Z > 1.6) return [lit > 0.8 ? 0xffe9a0 : lit > 0.45 ? 0xd9a640 : 0x8a5e1c, METAL];
    for (const [rx, ry] of RINGS)
      if (Math.abs(len2(X - rx, (Y - ry) * 1.15) - 2.6) < 1.0 && Y > ry - 1.2) return [lit > 0.7 ? 0xb8b2a8 : lit > 0.3 ? 0x6e6a66 : 0x3e3a38, METAL];
    const d2 = outline(X, Y);
    const gd = Math.abs(d2 + 3.0);
    if (gd < 0.5 && Z > 1.8) return [mulc(L.thread, 0.85 + 0.2 * clamp01(lit)), VF.SOLID];
    const n = fbm3(X * 0.12, Y * 0.18, 3);
    let c = lit > 0.75 ? L.hi : lit > 0.3 ? L.base : L.shade;
    c = mixc(c, n > 0 ? L.hi : L.shade, Math.abs(n) * 0.35);
    c = mixc(c, L.edge, sstep(-2.2, 0, d2) * 0.75); // burnished edge
    if (s.exp < 0.3) c = mixc(c, L.edge, 0.45);
    return [mulc(c, 0.92 + h3(x, y, z, 8) * 0.12), VF.SOLID | VF.SOFTAO];
  };
  return sculpt('hud_plaque', [-136, -34, 0, 136, 42, 10], sd, paint, VF.SOLID, col);
}

/** riveted brass tag for the wave clock (hangs under the plaque) */
const TAG_W = 36, TAG_H = 13;
function tagModel() {
  const sd = (x: number, y: number, z: number) => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    const d2 = sdRoundBox2(X, Y, TAG_W / 2, TAG_H / 2, 2.4);
    let d = Math.max(d2, Z - (1.3 + 0.35 * sstep(0, -1.4, d2)), -Z);
    for (const sx of [-1, 1]) d = Math.min(d, len3((X - sx * (TAG_W / 2 - 3)) / 1.2, (Y - 0) / 1.2, (Z - 1.5) / 0.7) - 1);
    // the strap that ties it to the plaque
    d = Math.min(d, Math.max(sdRoundBox2(X, Y - 8.5, 3.6, 4, 1), Z - 1.0, -Z));
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const Y = y / V2;
    if (Y > TAG_H / 2 - 0.4) return [s.nz > 0.5 ? 0x6a3a1e : 0x4a2412, VF.SOLID];
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.85 ? 0xf6d27c : lit > 0.5 ? 0xc79236 : 0x8c5a1e;
    const n = fbm3(x * 0.1, y * 0.1, 6);
    if (s.exp < 0.3 || n > 0.45) c = mixc(c, 0x4f9e86, 0.35);
    if (s.exp > 0.5) c = mixc(c, 0xf6d27c, 0.4);
    return [mulc(c, 0.93 + h3(x, y, z, 4) * 0.12), METAL];
  };
  return sculpt('hud_tag', [-40, -16, 0, 40, 26, 6], sd, paint);
}

/** one forged chain link (a stadium ring), 4 voxels per HUD px, long axis y */
function linkModel() {
  const V = 4;
  const sd = (x: number, y: number, z: number) => {
    const X = x / V, Y = y / V, Z = z / V;
    const dc = segD(X, Y, 0, 0, -1.0, 0, 0, 1.0, 0) - 1.25;
    return (len2(dc, Z) - 0.52) * V;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.7 ? 0x8e8a86 : lit > 0.25 ? 0x56504c : 0x2e2a28;
    if (fbm3(x * 0.15, y * 0.15, z * 0.15) > 0.15) c = mixc(c, 0x7a3e1c, 0.55);
    return [c, METAL];
  };
  return sculpt('hud_link', [-9, -14, -4, 9, 14, 4], sd, paint);
}

// ------------------------------------------------------------------ pocket stopwatch
const WR = 19; // case radius (HUD px)
/** the stopwatch is shown a little larger than modelled */
export const WATCH_S = 1.1;
/** HUD px from the plaque's bottom edge to the watch centre (chain + bow), at k = 1 */
export const WATCH_DROP = (4 * 4.3 + WR + 9.6) * WATCH_S;
function watchModel() {
  const sd = (x: number, y: number, z: number) => {
    const X = x / V2, Y = y / V2, Z = z / V2;
    const r = len2(X, Y);
    // the case: a disc with a fully rounded edge, knurled bezel, recessed dial seat
    const rr = 2.7, H = 3.3;
    const qx = r - (WR - rr), qz = Math.abs(Z) - (H - rr);
    let d = len2(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rr;
    if (r > WR - 3.4 && Z > 0) d -= 0.22 * Math.abs(Math.sin(Math.atan2(Y, X) * 38)) * sstep(WR - 3.4, WR - 2.4, r);
    if (r < WR - 3.2) d = Math.max(d, Z - 1.4); // dial seat
    // pendant, crown (fluted) and bow
    d = Math.min(d, Math.max(len2(X, Z) - 1.7, Math.max(WR - 1.5 - Y, Y - (WR + 3.2))));
    const crR = 2.7 + 0.28 * Math.abs(Math.sin(Math.atan2(Z, X) * 9));
    d = Math.min(d, Math.max(len2(X, Z) - crR, Math.max(WR + 3.0 - Y, Y - (WR + 6.6))) - 0.15);
    d = Math.min(d, len2(len2(X, (Y - (WR + 5.2)) * 0.92) - 5.0, Z) - 0.85);
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.86 ? 0xfff0b0 : lit > 0.6 ? 0xe8b850 : lit > 0.25 ? 0xb88426 : 0x7a5214;
    const n = fbm3(x * 0.07, y * 0.07, z * 0.07 + 2);
    if (s.exp < 0.3) c = mixc(c, n > 0 ? 0x4f8a6e : 0x4a300c, 0.5);
    if (s.exp > 0.5) c = mixc(c, 0xfff0b0, 0.45);
    if (h3(Math.floor(x * 0.5 - y * 0.8), Math.floor(y * 0.3 + x * 0.25), 11) > 0.988) c = 0xfff4c8;
    return [mulc(c, 0.94 + h3(x, y, z, 6) * 0.1), METAL];
  };
  return sculpt('hud_watch', [-40, -40, -8, 40, 64, 8], sd, paint);
}

/** the hunter lid, sprung open (its inside engraved with a guilloché rosette); hinge at x = 0 */
function lidModel() {
  const sd = (x: number, y: number, z: number) => {
    const X = x / V2 - WR, Y = y / V2, Z = z / V2;
    const r = len2(X, Y);
    const rr = 1.4;
    const qx = r - (WR - rr), qz = Math.abs(Z - 0.5) - (1.5 - rr);
    let d = len2(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rr;
    if (r < WR - 2 && Z > 0.4) {
      const g = Math.sin(r * 2.2 + Math.sin(Math.atan2(Y, X) * 12) * 1.2);
      d += 0.25 * sstep(0.3, 1, g);
    }
    d = Math.min(d, len3(X + WR, Y, Z - 0.5) - 1.6); // hinge knuckle
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.82 ? 0xfff0b0 : lit > 0.5 ? 0xe0ae48 : lit > 0.15 ? 0xb07c22 : 0x6e4810;
    if (s.exp < 0.3) c = mixc(c, 0x5a3a0c, 0.45);
    return [mulc(c, 0.94 + h3(x, y, z, 12) * 0.1), METAL];
  };
  return sculpt('hud_watch_lid', [-4, -40, -2, 80, 40, 6], sd, paint);
}

/** a blued-steel spade hand with a counterweight tail (4 vox/px), pointing +y, pivot at 0 */
function handModel() {
  const V = 4;
  const sd = (x: number, y: number, z: number) => {
    const X = x / V, Y = y / V, Z = z / V;
    let d = Math.max(segD(X, Y, 0, 0, -4.5, 0, 0, 13.5, 0) - 0.42, Math.abs(Z) - 0.3);
    d = Math.min(d, Math.max(len2(X / 1.5, (Y - 11) / 2.4) - 1, Math.abs(Z) - 0.3)); // spade
    d = Math.min(d, Math.max(Math.abs(len2(X, Y + 4.2) - 1.3) - 0.45, Math.abs(Z) - 0.3)); // counterweight ring
    d = Math.min(d, len3(X, Y, Z * 0.8) - 1.4); // cannon pinion cap
    return d * V;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / V, Y = y / V;
    if (len2(X, Y) < 1.5) return [s.nz > 0.6 ? 0xffe9a0 : 0xb88426, METAL];
    const lit = s.nx * -0.4 + s.ny * 0.5 + s.nz * 0.75;
    return [lit > 0.8 ? 0x6a8ad8 : lit > 0.4 ? 0x2a3e8a : 0x141c44, METAL];
  };
  return sculpt('hud_watch_hand', [-8, -24, -2, 8, 58, 2], sd, paint);
}

const DIAL_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DIAL_FS = /* glsl */ `
uniform sampler2D map;
uniform float uLeft, uBell, uRed, uT;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.x, p.y); // 0 at 12 o'clock, clockwise positive
  float ca = a < 0.0 ? a + 6.28318 : a;
  // enamel with fine crazing and age at the rim
  vec3 col = mix(vec3(0.97, 0.93, 0.83), vec3(0.88, 0.80, 0.64), smoothstep(0.6, 1.0, r));
  float craze = smoothstep(0.035, 0.0, abs(n2(p * 9.0) - 0.5)) * 0.12 + smoothstep(0.02, 0.0, abs(n2(p * 17.0 + 3.0) - 0.5)) * 0.08;
  col -= craze;
  // time left: a jade wedge from the hand clockwise back up to 12 (red in the last seconds)
  float elapsed = (1.0 - uLeft) * 6.28318;
  vec3 wedge = mix(vec3(0.2, 0.75, 0.5), vec3(0.85, 0.15, 0.08), uRed);
  float inW = step(elapsed, ca) * smoothstep(0.86, 0.83, r) * step(0.001, uLeft);
  col = mix(col, mix(col, wedge, 0.55), inW);
  // minute track: 60 ticks, every 10th bold (30 s per turn: 2 ticks per second)
  float tick = fract(ca / 6.28318 * 60.0 + 0.5) - 0.5;
  float major = step(0.5, fract(floor(ca / 6.28318 * 60.0 + 0.5) / 10.0 + 0.05) < 0.1 ? 1.0 : 0.0);
  float tw = mix(0.06, 0.14, major);
  float tl = mix(0.86, 0.76, major);
  col = mix(col, vec3(0.12, 0.08, 0.06), smoothstep(tw, tw * 0.6, abs(tick)) * step(tl, r) * step(r, 0.93));
  col = mix(col, vec3(0.12, 0.08, 0.06), smoothstep(0.012, 0.0, abs(r - 0.94)));
  // the bell being rung: a gold rim fills
  float bellOn = step(ca, uBell * 6.28318) * smoothstep(0.95, 0.965, r) * step(r, 0.995) * step(0.01, uBell);
  col = mix(col, vec3(1.0, 0.82, 0.3), bellOn);
  // numerals (Alagard)
  vec4 ink = texture2D(map, vUv);
  col = mix(col, ink.rgb, ink.a);
  // the crystal: a hard anime reflection streak + a soft one
  float s1 = smoothstep(0.03, 0.0, abs(p.x * 0.8 + p.y * 0.6 + 0.35) - 0.07) * smoothstep(0.95, 0.6, r);
  float s2 = smoothstep(0.02, 0.0, abs(p.x * 0.8 + p.y * 0.6 + 0.55) - 0.025) * smoothstep(0.95, 0.6, r);
  col = mix(col, vec3(1.0), s1 * 0.32 + s2 * 0.25);
  col *= 0.86 + 0.14 * smoothstep(1.0, 0.75, r);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ the HUD furniture

export interface OutlawAnchors {
  /** size factor (small screens) */
  k: number;
  star: { x: number; y: number; rank: number };
  tally: { x: number; y: number; amount: number };
  /** null while the boss banner owns the top centre */
  plaque: { x: number; y: number; label: string; time: string | null; drop: number } | null;
  /** the break between waves */
  watch: { left: number; total: number; bell: number } | null;
}

interface Swing {
  a: number;
  v: number;
}
const swing = (s: Swing, dt: number, k = 40, c = 2.2) => {
  s.v += (-s.a * k - s.v * c) * dt;
  s.a += s.v * dt;
};

export class OutlawHud {
  private mat: VoxelMaterial;
  private built = false;
  private jobs = new JobQueue();
  private linkGeo: THREE.BufferGeometry | null = null;
  // star
  private star = new THREE.Group();
  private starNum = new TextPlane(14, 14, 1);
  private starSpin = 0;
  private lastRank = -1;
  // tally
  private board = new THREE.Group();
  private boardText = new TextPlane(BOARD_W, BOARD_H, 1);
  private shown = -1;
  private boardKick: Swing = { a: 0, v: 0 };
  private chalkAcc = 0;
  // plaque
  private plaque = new THREE.Group();
  private plaqueText = new TextPlane(PLQ_W - 16, PLQ_H - 6, 1);
  private chains: THREE.Mesh[] = [];
  private tag = new THREE.Group();
  private tagText = new TextPlane(TAG_W - 10, TAG_H - 1, 1);
  private sw: Swing = { a: 0, v: 0 };
  private lastLabel = '';
  private dropY = 0;
  private tagShow = 0;
  // watch
  private watch = new THREE.Group();
  private watchBody = new THREE.Group();
  private watchLid = new THREE.Group();
  private hand = new THREE.Group();
  private dial: THREE.Mesh;
  private dialMat: THREE.ShaderMaterial;
  private dialTex: THREE.CanvasTexture | null = null;
  private watchNum = new TextPlane(26, 18, 3);
  private watchChain: THREE.Mesh[] = [];
  private watchShow = 0;
  private watchSw: Swing = { a: 0, v: 0 };
  private lastSec = -1;
  private lidOpen = 0;
  private fx = new PixelFx(240, false, 8);
  private glow = new PixelFx(160, true, 8);
  private t = 0;

  constructor(private scene: THREE.Scene) {
    this.mat = makeVoxelMaterial({ fog: false });
    this.dialMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uLeft: { value: 1 }, uBell: { value: 0 }, uRed: { value: 0 }, uT: { value: 0 } },
      vertexShader: DIAL_VS,
      fragmentShader: DIAL_FS,
    });
    this.dial = new THREE.Mesh(new THREE.CircleGeometry(WR - 3.1, 64), this.dialMat);
    this.dial.position.z = 1.45;
    for (const g of [this.star, this.board, this.plaque, this.watch]) {
      g.visible = false;
      scene.add(g);
    }
    scene.add(this.fx.points, this.glow.points);
  }

  /** queue the sculpting: one piece per frame so the run never hitches */
  private build() {
    this.built = true;
    const mk = (fn: () => ReturnType<typeof sculpt>, vph: number) => new THREE.Mesh(geoOf(fn(), vph), this.mat);
    const J = this.jobs;
    J.add(() => {
      this.star.add(mk(starModel, V2));
      this.starNum.mesh.position.z = 4.05;
      this.star.add(this.starNum.mesh);
    });
    J.add(() => {
      this.board.add(mk(boardModel, V2));
      this.boardText.mesh.position.z = 2.75;
      this.board.add(this.boardText.mesh);
    });
    J.add(() => {
      this.plaque.add(mk(plaqueModel, V2));
      this.plaqueText.mesh.position.set(0, -0.5, 3.05);
      this.plaque.add(this.plaqueText.mesh);
      this.linkGeo = geoOf(linkModel(), 4);
      for (const [rx, ry] of RINGS)
        for (let i = 0; i < 7; i++) {
          const l = new THREE.Mesh(this.linkGeo, this.mat);
          l.position.set(rx, ry + 3.4 + i * 4.3, 2.4);
          l.rotation.y = i % 2 ? Math.PI / 2 : 0.15;
          this.plaque.add(l);
        }
    });
    J.add(() => {
      this.tag.add(mk(tagModel, V2));
      this.tagText.mesh.position.z = 1.75;
      this.tag.add(this.tagText.mesh);
      this.tag.position.set(0, -PLQ_H / 2 - TAG_H / 2 + 2.5, 0.8);
      this.plaque.add(this.tag);
    });
    J.add(() => {
      this.watchBody.add(mk(watchModel, V2));
      this.watchBody.add(this.dial);
      this.watchNum.mesh.position.set(0, -6.5, 2.6);
      this.watchBody.add(this.watchNum.mesh);
      this.watch.add(this.watchBody);
      for (let i = 0; i < 4; i++) {
        const l = new THREE.Mesh(this.linkGeo ?? geoOf(linkModel(), 4), this.mat);
        l.rotation.y = i % 2 ? Math.PI / 2 : 0.1;
        this.watch.add(l);
        this.watchChain.push(l);
      }
    });
    J.add(() => {
      const hand = mk(handModel, 4);
      hand.position.z = 2.0;
      this.hand.add(hand);
      this.watchBody.add(this.hand);
      this.watchLid.add(mk(lidModel, V2));
      // hinged on the right; open, its engraved inner face turns to us beside the dial
      this.watchLid.position.set(WR - 0.4, 0, 3.6);
      this.watchBody.add(this.watchLid);
    });
  }

  private dialNumerals(q: number) {
    const cv = document.createElement('canvas');
    const S = Math.round((WR - 3.1) * 2 * q);
    cv.width = cv.height = S;
    const c = cv.getContext('2d')!;
    const R = (WR - 3.1) * q;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const label = String(30 - i * 5);
      const x = S / 2 + Math.sin(a) * R * 0.6, y = S / 2 - Math.cos(a) * R * 0.6;
      inkText(c, q, { text: label, x: x / q, y: y / q - 6, color: '#2a1608', align: 'center' });
    }
    this.dialTex?.dispose();
    this.dialTex = new THREE.CanvasTexture(cv);
    this.dialTex.colorSpace = THREE.SRGBColorSpace;
    this.dialMat.uniforms.map.value = this.dialTex;
  }

  update(dt: number, A: OutlawAnchors, visible: boolean, s: number) {
    this.t += dt;
    const k = A.k;
    const q = Math.max(1, Math.round(s * k));
    this.fx.update(dt, s);
    this.glow.update(dt, s);
    for (const g of [this.star, this.board]) g.visible = visible;
    if (!visible) {
      this.plaque.visible = this.watch.visible = false;
      return;
    }
    if (!this.built) this.build();
    this.jobs.step();

    // ---------------------------------------------------- tin star
    {
      const st = A.star;
      if (this.lastRank >= 0 && st.rank !== this.lastRank) {
        this.starSpin = 1;
        uiSfx('counter_clang', 0.35, 1.5);
        for (let i = 0; i < 26; i++) {
          const ang = Math.random() * TAU, v = 40 + Math.random() * 70;
          this.glow.emit({ x: st.x, y: st.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, drag: 3, life: 0.4 + Math.random() * 0.5, size: Math.random() < 0.3 ? 2 : 1, c0: 0xffffff, c1: 0xffd36b, alpha: 1, flick: 0.4 });
        }
      }
      this.lastRank = st.rank;
      this.starSpin = Math.max(0, this.starSpin - dt * 1.4);
      const sp = 1 - this.starSpin;
      const spin = this.starSpin > 0 ? (1 - Math.pow(sp, 3)) * TAU * 2 : 0;
      const bounce = Math.sin(this.starSpin * Math.PI) * 4;
      this.star.position.set(st.x * s, -(st.y - bounce) * s, 30);
      this.star.scale.setScalar(s * k * (1 + Math.sin(this.starSpin * Math.PI) * 0.25));
      this.star.rotation.set(0.12 + Math.sin(this.t * 0.7) * 0.05, spin + Math.sin(this.t * 0.9) * 0.28, Math.sin(this.t * 0.5) * 0.04);
      this.starNum.draw(`${st.rank}`, q, (c, qq) => inkText(c, qq, { text: String(st.rank), x: 7, y: -0.5, color: '#2c241c', align: 'center', style: 'emboss', alt: 'rgba(255,255,255,0.55)' }));
    }

    // ---------------------------------------------------- tally board
    {
      const tb = A.tally;
      if (this.shown < 0) this.shown = tb.amount;
      const before = Math.round(this.shown);
      this.shown += (tb.amount - this.shown) * Math.min(1, dt * 6);
      if (Math.abs(tb.amount - this.shown) < 0.5) this.shown = tb.amount;
      const now = Math.round(this.shown);
      if (now > before) {
        this.boardKick.v += Math.min(1.2, 0.15 + (now - before) * 0.02);
        this.chalkAcc += dt * 30;
      }
      swing(this.boardKick, dt, 260, 9);
      this.board.position.set(tb.x * s, -tb.y * s, 20);
      this.board.scale.setScalar(s * k);
      this.board.rotation.set(0.08 + this.boardKick.a * 0.1, -0.18 + Math.sin(this.t * 0.6) * 0.05, -0.02 + this.boardKick.a * 0.05);
      while (this.chalkAcc > 1) {
        this.chalkAcc -= 1;
        this.fx.emit({ x: tb.x + (Math.random() - 0.3) * 50 * k, y: tb.y + 4 * k, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20, ay: 60, drag: 1.5, life: 0.4 + Math.random() * 0.4, size: 1, c0: 0xfff3d6, c1: 0xc9a97c, alpha: 0.8 });
      }
      const amt = '$' + now.toLocaleString('en-US');
      this.boardText.draw(amt, q, (c, qq) => {
        inkText(c, qq, { text: 'BOUNTY', x: BOARD_W / 2 - 1, y: 1, color: '#e2c48c', align: 'center', style: 'paint', chip: 0.62 });
        inkText(c, qq, { text: amt, x: BOARD_W / 2 + 1, y: 14.5, color: '#fff2cc', align: 'center', style: 'paint', chip: 0.56 });
      });
    }

    // ---------------------------------------------------- plaque
    const pq = A.plaque;
    this.plaque.visible = !!pq;
    let watchTop = 0;
    if (pq) {
      if (pq.label !== this.lastLabel) {
        if (this.lastLabel) {
          this.sw.v += 1.4;
          this.dropY = -34;
          uiSfx('counter_clang', 0.25, 0.7);
        }
        this.lastLabel = pq.label;
      }
      this.dropY += (0 - this.dropY) * Math.min(1, dt * 7);
      swing(this.sw, dt, 18, 1.4);
      const lean = this.sw.a * 0.08 + Math.sin(this.t * 0.8) * 0.012;
      const py = pq.y - pq.drop + this.dropY;
      // pivot at the top of the chains: rotate round it
      const ox = Math.sin(lean) * 30, oy = (1 - Math.cos(lean)) * 30;
      this.plaque.position.set((pq.x + ox) * s, -(py - oy) * s, 10);
      this.plaque.scale.setScalar(s * k);
      this.plaque.rotation.set(0.06, Math.sin(this.t * 0.55) * 0.04, -lean);
      const big = measureInk(pq.label, 32) <= PLQ_W - 26;
      this.plaqueText.draw(`${pq.label}|${big}`, q, (c, qq) =>
        inkText(c, qq, { text: pq.label, x: (PLQ_W - 16) / 2, y: big ? -3 : 4, size: big ? 32 : 16, color: 'rgba(30,10,2,0.92)', align: 'center', style: 'brand' })
      );
      // the clock tag
      const wantTag = !!pq.time && !A.watch;
      this.tagShow += ((wantTag ? 1 : 0) - this.tagShow) * Math.min(1, dt * 8);
      this.tag.visible = this.tagShow > 0.02;
      this.tag.scale.setScalar(Math.max(0.01, this.tagShow));
      this.tag.rotation.set(0, 0, Math.sin(this.t * 1.3) * 0.04 + this.sw.a * 0.05);
      if (pq.time) this.tagText.draw(pq.time, q, (c, qq) => inkText(c, qq, { text: pq.time!, x: (TAG_W - 10) / 2, y: -2, color: '#3a2208', align: 'center', style: 'emboss', alt: 'rgba(255,240,190,0.6)' }));
      watchTop = py + (PLQ_H / 2 - 1) * k;
    }

    // ---------------------------------------------------- pocket stopwatch
    const w = A.watch;
    const want = w && pq ? 1 : 0;
    this.watchShow += (want - this.watchShow) * Math.min(1, dt * (want ? 4 : 7));
    this.watch.visible = this.watchShow > 0.01;
    if (this.watch.visible && pq) {
      if (!this.dialTex) this.dialNumerals(q);
      const left = w ? Math.max(0, w.left) : 0;
      const total = w?.total || 30;
      const sec = Math.ceil(left);
      const last = left <= 5.0 && left > 0;
      if (sec !== this.lastSec && w) {
        if (this.lastSec >= 0 && last) {
          this.watchSw.v += 1.2;
          uiSfx('ui_click', 0.35, 1.6);
        }
        this.lastSec = sec;
      }
      swing(this.watchSw, dt, 30, 2);
      const bell = w?.bell ?? 0;
      const shake = bell > 0 ? (Math.random() - 0.5) * bell * 0.08 : 0;
      this.lidOpen += ((w ? 1 : 0) - this.lidOpen) * Math.min(1, dt * 5);
      // hangs on its chain under the plaque, swinging gently: the group pivots at the plaque
      const ang = Math.sin(this.t * 1.1) * 0.05 + this.watchSw.a * 0.12 + shake;
      const top = watchTop + (1 - this.watchShow) * -80 * k;
      const drop = this.watchChain.length * 4.3 + WR + 9.6;
      this.watch.position.set(pq.x * s, -top * s, 60);
      this.watch.scale.setScalar(s * k * WATCH_S);
      this.watch.rotation.set(0, 0, ang);
      this.watchBody.position.set(0, -drop, 0);
      this.watchBody.rotation.set(0.1, 0.32 + Math.sin(this.t * 0.6) * 0.06, 0);
      for (let i = 0; i < this.watchChain.length; i++) this.watchChain[i].position.set(0, -2.15 - i * 4.3, 0.5);
      const rx = pq.x - Math.sin(ang) * drop * k * WATCH_S, ry = top + Math.cos(ang) * drop * k * WATCH_S;
      this.watchLid.rotation.y = -Math.PI + 0.02 + this.lidOpen * (Math.PI - 0.62);
      // the hand points at the seconds left (one turn = the whole break)
      const frac = clamp01(left / total);
      this.hand.rotation.z = -(1 - frac) * TAU;
      const u = this.dialMat.uniforms;
      u.uLeft.value = frac;
      u.uBell.value = bell;
      u.uRed.value += ((last ? 1 : 0) - u.uRed.value) * Math.min(1, dt * 6);
      u.uT.value = this.t;
      const num = String(Math.max(0, sec));
      const red = last && Math.sin(this.t * 12) > -0.3;
      this.watchNum.draw(`${num}|${red}`, q, (c, qq) => inkText(c, qq, { text: num, x: 13, y: 0, size: 16, color: red ? '#b01a10' : '#2a1608', align: 'center', style: 'ink' }));
      if (bell > 0.05 && Math.random() < dt * 20 * bell)
        this.glow.emit({ x: rx + (Math.random() - 0.5) * 30 * k, y: ry + (Math.random() - 0.5) * 30 * k, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, drag: 2, life: 0.4 + Math.random() * 0.3, size: 1, c0: 0xfff0b0, c1: 0xffb030, alpha: 1 });
    } else {
      this.lastSec = -1;
      this.lidOpen = 0;
    }
  }

  dispose() {
    for (const g of [this.star, this.board, this.plaque, this.watch]) g.removeFromParent();
    for (const t of [this.starNum, this.boardText, this.plaqueText, this.tagText, this.watchNum]) t.dispose();
    this.fx.dispose();
    this.glow.dispose();
    this.dialTex?.dispose();
    this.dialMat.dispose();
    void this.scene;
  }
}
