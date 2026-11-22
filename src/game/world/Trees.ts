// True 3D trees and bushes from the plant kit (PlantKit): sculpted, bark-textured trunks
// and branches (instanced Bezier tubes) dressed with hundreds of small pixel-art leaf
// cards placed and angled in 3D round the branches, so every crown has volume from every
// side. Species:
//  - date palm: a leaning, curved trunk of bulging leaf-base segments, a fibrous crown
//    boss, three tiers of arching fronds (a 3D spine with V-set leaflet strips on both
//    sides), a few dead hanging fronds and beaded date clusters on stalks;
//  - acacia: a short flared trunk forking into crooked limbs and twigs under a flat,
//    layered umbrella of bipinnate leaf sprays (some in golden puff-flower);
//  - tamarisk: slender gnarled stems with drooping feathery plumes, some flowering pink;
//  - desert scrub and flowering oasis shrubs: twiggy mounds of small leaf cards.
// Two instanced draws (wood, leaves) carry every tree; wind sways each one from its root,
// fronds and sprays bounce on their own, and angry trees (WorldLife) lean, lash and
// shudder through the shake slots. Small inner cards and twigs are LOD detail.
import * as THREE from 'three';
import { L } from './PlantArt';
import { PlantLayer, PlantWriter, plantUniforms, SLOTS, STRIDE, type V3, type Wind, add, dir, norm, cross, bez, lerp3, sc3, len3, perpH, rotAx, thru } from './PlantKit';
import type { World } from './World';
import type { Collider } from './Colliders';

export { SLOTS };
export type TreeKind = 'palm' | 'acacia' | 'tamarisk' | 'scrub' | 'shrub';
export const TREE_KINDS = new Set(['palm', 'acacia', 'tamarisk', 'bush', 'shrub']);

export interface TreeRef {
  id: number;
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  h: number;
  /** instance ranges in the wood / leaf buffers */
  w0: number;
  w1: number;
  c0: number;
  c1: number;
  collider: Collider | null;
  /** shake slot (-1 none) driven by WorldLife */
  slot: number;
  /** some trees wake up angry when attacked */
  ornery: boolean;
}

const UP: V3 = [0, 1, 0];

export class Trees {
  /** both draws (wood + leaves) */
  mesh = new THREE.Group();
  list: TreeRef[] = [];
  private U = plantUniforms(0.04, 72, 0.82);
  /** shake slots: xy lean (m at the crown), z shudder amplitude */
  uShake = this.U.uShake;
  private wood: PlantLayer;
  private leaves: PlantLayer;
  private W = new PlantWriter();
  private dirty = false;
  private static by = new WeakMap<World, Trees>();
  static of(w: World) {
    return Trees.by.get(w) ?? null;
  }

  constructor(private world: World) {
    this.U.uWind.value.set(world.sa.wind.x, world.sa.wind.z);
    this.wood = new PlantLayer(true, true, this.U, { shadow: true, name: 'trees-wood' });
    this.leaves = new PlantLayer(false, true, this.U, { shadow: true, name: 'trees-leaves' });
    this.mesh.name = 'trees';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.add(this.wood.mesh, this.leaves.mesh);
    Trees.by.set(world, this);
  }

  /** plant a tree or bush (anchor kinds: palm, acacia, tamarisk, bush = desert scrub, shrub) */
  add(anchorKind: string, variant: number, x: number, z: number, rot: number, scale: number) {
    const kind: TreeKind = anchorKind === 'bush' ? 'scrub' : (anchorKind as TreeKind);
    const y = this.world.groundAt(x, z) - 0.06;
    let seed = (Math.imul(Math.round(x * 13), 73856093) ^ Math.imul(Math.round(z * 13), 19349663) ^ Math.imul(variant + 1, 83492791)) >>> 0;
    const rnd = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
      return seed / 4294967296;
    };
    const W = this.W;
    W.slot = -1;
    const w0 = W.wood.length / STRIDE, c0 = W.card.length / STRIDE;
    const ph = rnd() * 6.28;
    const base: V3 = [x, y, z];
    let H = 1, colR = 0;
    const wind = (Hh: number, phB = 0, fl = 0, bA = 0, bB = 0): Wind => ({ baseY: y, H: Hh, phT: ph, phB, fl, bA, bB });
    switch (kind) {
      case 'palm':
        H = (5.3 + rnd() * 1.9) * scale;
        this.palm(base, H, scale, rot, rnd, wind);
        colR = 0.32;
        break;
      case 'acacia':
        H = (4.2 + rnd() * 1.1) * scale;
        this.acacia(base, H, scale, rot, rnd, wind);
        colR = 0.34;
        break;
      case 'tamarisk':
        H = (3.5 + rnd() * 1.0) * scale;
        this.tamarisk(base, H, scale, rot, rnd, wind);
        colR = 0.38;
        break;
      case 'scrub':
        H = 0.85 * scale;
        this.mound(base, H, scale, rot, rnd, wind, false);
        break;
      case 'shrub':
        H = 1.1 * scale;
        this.mound(base, H, scale, rot, rnd, wind, true);
        break;
    }
    const t: TreeRef = { id: this.list.length, kind, x, y, z, h: H, w0, w1: W.wood.length / STRIDE, c0, c1: W.card.length / STRIDE, collider: null, slot: -1, ornery: false };
    // about a third of the big trees are ornery: shoot one and it wakes up swinging
    t.ornery = H > 3 && rnd() < 0.36;
    if (colR > 0) t.collider = this.world.colliders.circle(x, z, colR * scale, y, y + H * 0.7, { data: { material: 'wood', tree: t } });
    this.list.push(t);
    this.dirty = true;
    return t;
  }

  // ------------------------------------------------------------------ species
  private palm(base: V3, H: number, s: number, rot: number, rnd: () => number, wind: (h: number, phB?: number, fl?: number, bA?: number, bB?: number) => Wind) {
    const W = this.W;
    const wT = wind(H);
    const lyaw = rot + rnd() * 0.8, lean = (0.35 + rnd() * 0.6) * (H / 6), wob = (rnd() - 0.5) * 0.25;
    const at = (t: number): V3 => {
      const b = lean * Math.pow(t, 1.7);
      const w = Math.sin(t * Math.PI) * wob;
      return [base[0] + Math.cos(lyaw) * b - Math.sin(lyaw) * w, base[1] + t * H, base[2] + Math.sin(lyaw) * b + Math.cos(lyaw) * w];
    };
    const rk = Math.sqrt(H / 6) * s;
    const rad = (t: number) => (0.15 + 0.05 * (1 - t) + 0.13 * Math.pow(Math.max(0, 1 - t * 9), 2)) * rk;
    const nSeg = 9;
    for (let i = 0; i < nSeg; i++) {
      const t0 = i / nSeg, t1 = (i + 1) / nSeg;
      const a = at(t0), b = at(t1);
      W.tube(a, thru(a, at((t0 + t1) / 2), b), b, rad(t0), rad(t1), 2, L.B_PALM, len3(a, b) / 1.6, 0.95 + rnd() * 0.1, wT, { ink: 1 });
    }
    const top = at(1);
    // fibrous crown boss
    W.tube(at(0.95), add(top, UP, 0.12 * s), add(top, UP, 0.5 * s), 0.25 * rk, 0.22 * rk, 1, L.B_PALM, 0.6, 0.7, wT, { ink: 1 });
    const crown = add(top, UP, 0.35 * s);
    const nF = 15 + Math.floor(rnd() * 4);
    for (let i = 0; i < nF; i++) {
      const tier = i % 3;
      const yaw = rot + i * 2.39996 + (rnd() - 0.5) * 0.3;
      const dead = i >= nF - 3 && rnd() < 0.6;
      const el = dead ? -1.05 - rnd() * 0.35 : tier === 0 ? 0.8 + rnd() * 0.25 : tier === 1 ? 0.32 + rnd() * 0.2 : -0.02 - rnd() * 0.22;
      const Lf = (2.5 + rnd() * 0.8) * (H / 6.2) * (tier === 0 ? 0.82 : 1) * (dead ? 0.85 : 1);
      const d = dir(yaw, el);
      const p0 = add(add(top, [d[0] * 0.14, 0, d[2] * 0.14]), UP, (tier === 0 ? 0.42 : tier === 1 ? 0.3 : 0.18) * s);
      const c = add(p0, d, Lf * 0.5);
      const droop = dead ? Lf * 0.12 : Lf * (0.24 + 0.2 * Math.cos(el));
      const p1 = add(add(p0, d, Lf * 0.92), UP, -droop);
      const wF = wind(H, wT.phT + i * 1.7, 0.1 * (Lf / 2.8), 0, 1);
      W.tube(p0, c, p1, 0.045 * s, 0.01 * s, 0, dead ? L.B_STRAW : L.B_RACHIS, Lf * 0.9, dead ? 0.8 : 1, wF);
      const sh = perpH(d);
      let upF = norm(cross(sh, d));
      if (upF[1] < 0) upF = sc3(upF, -1);
      const wl = 0.62 * (Lf / 2.8);
      const mid = bez(p0, c, p1, 0.5);
      const vn = norm(add(sc3(add(mid, crown, -1), 1), UP, 0.5));
      const tint = (tier === 0 ? 1.06 : tier === 1 ? 0.96 : 0.86) + rnd() * 0.08;
      const layer = dead ? L.PALM_DRY : tier === 2 && rnd() < 0.3 ? L.PALM_DRY : L.PALM;
      for (const side of [-1, 1])
        for (const upper of [true, false]) {
          const v = upper ? 0.5 + rnd() * 0.15 : -0.22 - rnd() * 0.12;
          const sv = add(sc3(sh, side * Math.cos(v)), upF, Math.sin(v));
          W.leaf(p0, c, p1, sc3(sv, wl * (upper ? 1 : 0.92)), true, layer, tint * (upper ? 1 : 0.88), wF, vn, !upper && i % 2 === 1);
        }
    }
    // date clusters on stalks, hanging between the fronds
    if (rnd() < 0.72) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const yaw = rot + j * 2.2 + rnd() * 0.6;
        const dh: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
        const p0 = add(add(top, dh, 0.18 * s), UP, 0.05 * s);
        const p1 = add(add(p0, dh, 0.55 * s), UP, -0.4 * s);
        const wD = wind(H, wT.phT + j * 2.3, 0.05, 0, 1);
        W.tube(p0, add(add(p0, dh, 0.4 * s), UP, 0.08 * s), p1, 0.028 * s, 0.02 * s, 0, L.B_STRAW, 1, 1.05, wD);
        for (let k = 0; k < 2; k++) {
          const o: V3 = [(rnd() - 0.5) * 0.12 * s, -k * 0.08 * s, (rnd() - 0.5) * 0.12 * s];
          const q0 = add(p1, o), q1 = add(add(q0, dh, 0.06 * s), UP, -(0.62 - k * 0.15) * s);
          W.tube(q0, lerp3(q0, q1, 0.5), q1, (0.16 - k * 0.04) * s, (0.11 - k * 0.03) * s, 3, L.B_DATES, 1, 0.92 + rnd() * 0.15, { ...wD, bA: 1, bB: 1.2 }, { uRep: 3, lod: k === 1 });
        }
      }
    }
  }

  private acacia(base: V3, H: number, s: number, rot: number, rnd: () => number, wind: (h: number, phB?: number, fl?: number, bA?: number, bB?: number) => Wind) {
    const W = this.W;
    const wT = wind(H);
    const Rc = (2.6 + rnd() * 0.9) * s;
    const ly = rnd() * 6.28;
    const fork: V3 = [base[0] + Math.cos(ly) * 0.28 * s, base[1] + H * (0.34 + rnd() * 0.08), base[2] + Math.sin(ly) * 0.28 * s];
    const knee = add(lerp3(base, fork, 0.5), [Math.cos(ly + 1.6) * 0.12 * s, 0, Math.sin(ly + 1.6) * 0.12 * s]);
    // root flare, then the crooked bole
    W.tube(add(base, UP, -0.1), add(base, UP, 0.25 * s), add(base, UP, 0.55 * s), 0.34 * s, 0.19 * s, 2, L.B_ACACIA, 0.5, 0.95, wT, { ink: 1 });
    W.tube(add(base, UP, 0.5 * s), knee, fork, 0.19 * s, 0.15 * s, 2, L.B_ACACIA, 1.2, 1, wT, { ink: 1 });
    const centre: V3 = [fork[0], base[1] + H * 0.88, fork[2]];
    const nL = 3 + (rnd() < 0.55 ? 1 : 0);
    const pad = (anchor: V3, yaw: number, under: boolean, lod: boolean, k: number) => {
      const d = dir(yaw + (rnd() - 0.5) * 2.2, under ? -0.05 - rnd() * 0.12 : 0.02 + rnd() * 0.3);
      const lc = (1.0 + rnd() * 0.45) * s;
      const p0 = add(anchor, UP, under ? -0.12 : 0.06);
      const p1 = add(add(p0, d, lc), UP, -0.1 * s);
      const c = add(add(p0, d, lc * 0.5), UP, 0.07 * s);
      const sd = rotAx(perpH(d), norm(d), (rnd() - 0.5) * 0.9);
      const mid = bez(p0, c, p1, 0.5);
      const vn = norm([mid[0] - centre[0], (mid[1] - centre[1]) * 2.4 + (under ? -0.2 : 0.6), mid[2] - centre[2]]);
      const tint = (under ? 0.76 : 0.94 + 0.12 * k) + rnd() * 0.06;
      W.leaf(p0, c, p1, sc3(sd, (0.62 + rnd() * 0.16) * s), false, rnd() < 0.18 ? L.ACACIA_BLOOM : L.ACACIA, tint, wind(H, rnd() * 6.28, 0.05, 0, 1), vn, lod);
    };
    for (let j = 0; j < nL; j++) {
      const yaw = rot + (j / nL) * Math.PI * 2 + rnd() * 0.5;
      const dh: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const reach = Rc * (0.42 + rnd() * 0.2);
      const end: V3 = [fork[0] + dh[0] * reach, base[1] + H * (0.8 + rnd() * 0.06), fork[2] + dh[2] * reach];
      const zig = (rnd() - 0.5) * 0.7 * s;
      const c = add(lerp3(fork, end, 0.5), [-dh[2] * zig - dh[0] * 0.2 * reach, 0.1 * s, dh[0] * zig - dh[2] * 0.2 * reach]);
      W.tube(fork, c, end, 0.12 * s, 0.06 * s, 0, L.B_ACACIA, len3(fork, end) * 0.8, 1, wT, { ink: 1 });
      for (let k = 0; k < 3; k++) {
        const ty = yaw + (k - 1) * 0.75 + (rnd() - 0.5) * 0.3;
        const td: V3 = [Math.cos(ty), 0, Math.sin(ty)];
        const tl = Rc * (0.32 + rnd() * 0.25);
        const from = k === 1 ? end : bez(fork, c, end, 0.82);
        const tEnd: V3 = [from[0] + td[0] * tl, base[1] + H * (0.9 + rnd() * 0.06), from[2] + td[2] * tl];
        const tc = add(lerp3(from, tEnd, 0.5), UP, 0.08 * s);
        W.tube(from, tc, tEnd, 0.055 * s, 0.016 * s, 0, L.B_ACACIA, tl, 0.95, wT, { lod: k !== 1 });
        // the flat umbrella: a top layer and a shaded underside of leaf sprays along the twig
        for (let m = 0; m < 6; m++) {
          const tt = 0.3 + (m / 5) * 0.75;
          const a = bez(from, tc, tEnd, Math.min(1, tt));
          pad(add(a, [(rnd() - 0.5) * 0.4 * s, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.4 * s]), ty, m % 3 === 2, m >= 4, tt);
        }
      }
      for (let m = 0; m < 3; m++) pad(add(end, [(rnd() - 0.5) * 0.6 * s, 0.1, (rnd() - 0.5) * 0.6 * s]), yaw + rnd() * 3, m === 2, m === 1, 0.6);
    }
    for (let m = 0; m < 56; m++) {
      const a = rnd() * Math.PI * 2, r = Rc * Math.sqrt(rnd()) * 0.95, f = r / Rc;
      const under = m % 3 === 0;
      const p: V3 = [fork[0] + Math.cos(a) * r, base[1] + H * (0.86 + 0.07 * (1 - f * f)) + (rnd() - 0.5) * 0.12 * s, fork[2] + Math.sin(a) * r];
      pad(p, a, under, under || m % 4 === 1, 1 - f * 0.5);
    }
  }

  private tamarisk(base: V3, H: number, s: number, rot: number, rnd: () => number, wind: (h: number, phB?: number, fl?: number, bA?: number, bB?: number) => Wind) {
    const W = this.W;
    const wT = wind(H);
    const centre: V3 = add(base, UP, H * 0.62);
    const nS = 4 + Math.floor(rnd() * 3);
    const plume = (a: V3, yaw: number, lod: boolean) => {
      const od: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const lc = (0.95 + rnd() * 0.5) * s;
      const p0 = a;
      const c = add(add(p0, od, lc * 0.45), UP, lc * 0.32);
      const p1 = add(add(p0, od, lc * 0.82), UP, -lc * (0.2 + rnd() * 0.2));
      const sd = rotAx(perpH(od), norm(add(p1, p0, -1)), (rnd() - 0.5) * 1.6);
      const mid = bez(p0, c, p1, 0.5);
      const vn = norm([mid[0] - centre[0], (mid[1] - centre[1]) * 1.4 + 0.3, mid[2] - centre[2]]);
      const tint = 0.84 + 0.22 * Math.min(1, Math.max(0, (mid[1] - base[1]) / H)) + rnd() * 0.06;
      W.leaf(p0, c, p1, sc3(sd, (0.55 + rnd() * 0.15) * s), false, rnd() < 0.3 ? L.TAMA_PINK : L.TAMA, tint, wind(H, rnd() * 6.28, 0.07, 0, 1), vn, lod);
    };
    for (let j = 0; j < nS; j++) {
      const yaw = rot + (j / nS) * Math.PI * 2 + rnd() * 0.6;
      const dh: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const out = (0.45 + rnd() * 0.6) * s;
      const p0 = add(base, dh, 0.06 * s);
      const top = add(add(base, dh, out), UP, H * (0.6 + rnd() * 0.22));
      const wig = (rnd() - 0.5) * 0.5 * s;
      const c = add(add(add(base, dh, out * 0.2), [-dh[2] * wig, 0, dh[0] * wig]), UP, H * 0.35);
      W.tube(p0, c, top, 0.075 * s, 0.032 * s, 0, L.B_TAMA, len3(p0, top) * 0.9, 1, wT, { ink: 1 });
      const fromT = 0.55 + rnd() * 0.15;
      const sp = bez(p0, c, top, fromT);
      const sy = yaw + (rnd() < 0.5 ? -0.8 : 0.8);
      const sEnd = add(add(sp, [Math.cos(sy), 0, Math.sin(sy)], 0.6 * s), UP, 0.5 * s);
      W.tube(sp, add(lerp3(sp, sEnd, 0.5), UP, 0.08), sEnd, 0.035 * s, 0.014 * s, 0, L.B_TAMA, 0.8, 0.95, wT, { lod: true });
      for (let m = 0; m < 7; m++) plume(add(top, [(rnd() - 0.5) * 0.4 * s, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4 * s]), yaw + (rnd() - 0.5) * 3.2, m >= 5);
      for (let m = 0; m < 4; m++) plume(add(sEnd, [(rnd() - 0.5) * 0.3 * s, 0, (rnd() - 0.5) * 0.3 * s]), sy + (rnd() - 0.5) * 2.4, m === 3);
      for (let m = 0; m < 4; m++) plume(bez(p0, c, top, 0.4 + m * 0.14), yaw + (rnd() - 0.5) * 2.8, m === 0);
    }
  }

  /** desert scrub (grey-green, yellow flowers) or a flowering oasis shrub: twigs under a mound of leaf cards */
  private mound(base: V3, H: number, s: number, rot: number, rnd: () => number, wind: (h: number, phB?: number, fl?: number, bA?: number, bB?: number) => Wind, shrub: boolean) {
    const W = this.W;
    const wT = wind(H);
    const rx = (shrub ? 0.62 : 0.55) * s, ry = H * 0.5;
    const centre = add(base, UP, H * 0.42);
    const nT = shrub ? 6 : 7;
    for (let j = 0; j < nT; j++) {
      const yaw = rot + (j / nT) * Math.PI * 2 + rnd() * 0.5;
      const dh: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const e = add(add(base, dh, rx * (0.45 + rnd() * 0.4)), UP, H * (0.45 + rnd() * 0.45));
      W.tube(add(base, dh, 0.03), add(add(base, dh, rx * 0.15), UP, H * 0.35), e, 0.026 * s, 0.008 * s, 0, shrub ? L.B_TAMA : L.B_TWIG, 0.6, 0.9, wT, { lod: j % 2 === 1 });
    }
    const n = shrub ? 44 : 40;
    for (let i = 0; i < n; i++) {
      const yaw = rnd() * Math.PI * 2, el = Math.asin(rnd() * 1.15 - 0.2);
      const nd = dir(yaw, Math.min(1.45, el));
      const a: V3 = [centre[0] + nd[0] * rx * 0.55, centre[1] + nd[1] * ry * 0.5, centre[2] + nd[2] * rx * 0.55];
      const lc = (shrub ? 0.55 + rnd() * 0.2 : 0.46 + rnd() * 0.2) * s;
      const od = norm(add(nd, UP, 0.35));
      const p1 = add(add(a, od, lc), UP, -0.05 * s);
      const c = add(add(a, od, lc * 0.5), UP, 0.05 * s);
      const sd = rotAx(perpH(od), od, (rnd() - 0.5) * 2.4);
      const layer = shrub ? (rnd() < 0.38 ? L.SHRUB_BLOOM : L.SHRUB) : L.SCRUB;
      const tint = 0.78 + 0.28 * Math.max(0, nd[1]) + rnd() * 0.06;
      W.leaf(a, c, p1, sc3(sd, (shrub ? 0.46 : 0.42) * s), false, layer, tint, wind(H, rnd() * 6.28, 0.035, 0, 1), norm(add(nd, UP, 0.4)), i % 4 === 3);
    }
  }

  /** route a tree into (or out of) a shake slot */
  setSlot(t: TreeRef, slot: number) {
    t.slot = slot;
    const write = (a: number[] | Float32Array | null, i0: number, i1: number) => {
      if (a) for (let i = i0; i < i1; i++) a[i * STRIDE + 15] = slot;
    };
    write(this.W.wood, t.w0, t.w1);
    write(this.W.card, t.c0, t.c1);
    write(this.wood.array, t.w0, t.w1);
    write(this.leaves.array, t.c0, t.c1);
    this.wood.touch();
    this.leaves.touch();
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.wood.set(new Float32Array(this.W.wood));
    this.leaves.set(new Float32Array(this.W.card));
  }

  dispose() {
    this.wood.dispose();
    this.leaves.dispose();
    this.mesh.removeFromParent();
  }
}
