// 3D ground cover: grass tufts, dry grass, desert wildflowers, flowering oasis shrubs,
// leafy scrub, dead brush, cattail reeds, papyrus and field crops, scattered densely over
// oasis turf, along the zone rims, round the ruins and over the Nile's banks and fields.
//
// Every tuft is built from the plant kit (PlantKit): splayed, arching pixel-art blade
// cards (PlantArt) round a common root, each bent along its own spine and set at its own
// angle, so a tuft has volume from every side; reeds and papyrus stand on modelled 3D
// stems carrying 3D cattail heads or umbels of ray cards; dead brush is a tangle of
// twig tubes. Two instanced draws (cards, stems) carry it all. Cells of scatter are
// generated deterministically round the focus; near cells add their detail pieces, far
// cells keep only the main ones (the LOD), and the edge of the radius grows out of the
// sand instead of popping.
import * as THREE from 'three';
import { MAT } from './Heightfield';
import type { World } from './World';
import { Trees } from './Trees';
import { L } from './PlantArt';
import { PlantLayer, PlantWriter, plantUniforms, STRIDE, type V3, type Wind, add, dir, norm, bez, lerp3, sc3, perpH, rotAx } from './PlantKit';

const UP: V3 = [0, 1, 0];

// ------------------------------------------------------------------ tufts
/** ground-cover groups and their base scale */
const GROUP = { dry: 1.0, dead: 0.85, flower: 0.8, reed: 1.0, turf: 1.0, wild: 1.0, scrub: 0.8, papyrus: 1.0, crop: 0.9 } as const;
type GroupId = keyof typeof GROUP;
const CROPS = [L.BARLEY, L.BARLEY, L.FLAX, L.WHEAT, L.WHEAT];

/**
 * One tuft at (x, y, z): main pieces go to `B`, near-only detail pieces to `D`.
 * `k` scales it, `seed` (0..1) picks its shape.
 */
function tuft(B: PlantWriter, D: PlantWriter, g: GroupId, x: number, y: number, z: number, yaw0: number, k: number, seed: number) {
  let s = Math.floor(seed * 4294967295) >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  const root: V3 = [x, y, z];
  const phT = seed * 6.28 + x * 0.29 + z * 0.21;
  const jit = (r: number): V3 => [x + (rnd() - 0.5) * r * k, y, z + (rnd() - 0.5) * r * k];
  /** splayed, arching blade cards round the root */
  const blades = (n: number, nBase: number, layer: () => number, h0: number, h1: number, wid: number, lean0: number, lean1: number, arch: number, vn = false) => {
    for (let i = 0; i < n; i++) {
      const yaw = yaw0 + (i / n) * Math.PI * 2 + rnd() * 0.6;
      const lean = lean0 + rnd() * (lean1 - lean0);
      const h = (h0 + rnd() * (h1 - h0)) * k;
      const d = dir(yaw, Math.PI / 2 - lean);
      const p0 = jit(0.08);
      const p1 = add(add(p0, d, h), UP, -h * arch * Math.sin(lean));
      const c = add(add(p0, d, h * 0.55), UP, h * 0.1);
      const sd = rotAx(perpH(d), d, (rnd() - 0.5) * 0.9);
      const w: Wind = { baseY: y, H: h1 * k, phT, phB: phT * 2 + i * 1.3, fl: 0.03 * k + h * 0.05, bA: 0, bB: 1 };
      const nv: V3 | null = vn ? norm(add([d[0], 0, d[2]], UP, 1.2)) : null;
      (i < nBase ? B : D).leaf(p0, c, p1, sc3(sd, wid * k), false, layer(), 0.86 + rnd() * 0.24, w, nv);
    }
  };
  const stem = (W: PlantWriter, p0: V3, yaw: number, lean: number, h: number, r0: number, r1: number, layer: number, i: number) => {
    const d = dir(yaw, Math.PI / 2 - lean);
    const p1 = add(p0, d, h);
    const c = add(lerp3(p0, p1, 0.5), [(rnd() - 0.5) * 0.06 * k, 0, (rnd() - 0.5) * 0.06 * k]);
    const w: Wind = { baseY: y, H: h, phT, phB: phT * 3 + i * 2.1, fl: 0.035 + h * 0.03, bA: 0, bB: 1 };
    W.tube(p0, c, p1, r0 * k, r1 * k, 0, layer, h * 1.5, 0.9 + rnd() * 0.2, w);
    return { p0, c, p1, w };
  };
  switch (g) {
    case 'turf':
      blades(6, 4, () => (rnd() < 0.75 ? L.TURF : L.TURF_SEED), 0.34, 0.58, 0.3, 0.2, 0.62, 0.35);
      break;
    case 'dry':
      blades(5, 3, () => (rnd() < 0.7 ? L.DRY : L.DRY_SEED), 0.4, 0.72, 0.34, 0.3, 0.85, 0.45);
      break;
    case 'wild':
      blades(2, 1, () => L.TURF, 0.24, 0.38, 0.26, 0.3, 0.7, 0.3);
      blades(3, 2, () => (rnd() < 0.5 ? L.WILD : L.WILD_B), 0.38, 0.58, 0.3, 0.1, 0.5, 0.15);
      break;
    case 'crop': {
      const lay = CROPS[Math.floor(rnd() * CROPS.length)];
      blades(4, 3, () => lay, 0.6, 0.9, 0.32, 0.05, 0.28, 0.12);
      break;
    }
    case 'scrub':
      blades(6, 4, () => L.SCRUB, 0.4, 0.6, 0.36, 0.4, 1.0, 0.2, true);
      for (let i = 0; i < 2; i++) stem(B, jit(0.05), yaw0 + i * 3.1, 0.6, 0.38 * k, 0.016, 0.005, L.B_TWIG, i);
      break;
    case 'flower':
      blades(7, 5, () => (rnd() < 0.5 ? L.SHRUB_BLOOM : L.SHRUB), 0.42, 0.6, 0.36, 0.5, 1.2, 0.25, true);
      break;
    case 'reed': {
      // cattails: 3D stems with velvety 3D heads and a spike, long arching blade leaves
      for (let i = 0; i < 3; i++) {
        const W = i < 2 ? B : D;
        const st = stem(W, jit(0.14), yaw0 + i * 2.2 + rnd(), 0.04 + rnd() * 0.16, (1.05 + rnd() * 0.55) * k, 0.011, 0.005, L.B_STEM, i);
        if (i < 2 || rnd() < 0.5) {
          const ta = 0.68 + rnd() * 0.08, tb = ta + 0.17;
          const a = bez(st.p0, st.c, st.p1, ta), b = bez(st.p0, st.c, st.p1, tb);
          W.tube(a, lerp3(a, b, 0.5), b, 0.034 * k, 0.03 * k, 1, L.B_CATTAIL, 1, 0.9 + rnd() * 0.2, { ...st.w, bA: ta, bB: tb });
        }
      }
      blades(5, 3, () => L.REED, 0.8, 1.3, 0.17, 0.15, 0.55, 0.5);
      break;
    }
    case 'papyrus': {
      // tall 3D stems, each crowned by a starburst umbel of ray cards
      const n = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const W = i < 3 ? B : D;
        const st = stem(W, jit(0.18), yaw0 + i * 2.4 + rnd(), 0.06 + rnd() * 0.28, (1.3 + rnd() * 0.8) * k, 0.017, 0.009, L.B_STEM, i);
        for (let j = 0; j < 5; j++) {
          const yaw = (j / 5) * Math.PI * 2 + rnd() * 0.6;
          const Lr = (0.5 + rnd() * 0.2) * k;
          const d = dir(yaw, 0.3 + rnd() * 0.5);
          const p1 = add(add(st.p1, d, Lr * 0.9), UP, -Lr * 0.28);
          const c = add(add(st.p1, d, Lr * 0.5), UP, 0.04 * k);
          const sd = rotAx(perpH(d), d, (rnd() - 0.5) * 1.2);
          (j < 3 ? W : D).leaf(st.p1, c, p1, sc3(sd, 0.42 * k), false, L.PAPYRUS, 0.9 + rnd() * 0.2, { ...st.w, bA: 1, bB: 1.5 }, norm(add(d, UP, 0.8)));
        }
      }
      break;
    }
    case 'dead': {
      // a dry tangle of twigs, forking, with a few twiglet sprays
      for (let i = 0; i < 4; i++) {
        const yaw = yaw0 + (i / 4) * Math.PI * 2 + rnd() * 0.7;
        const st = stem(B, jit(0.06), yaw, 0.45 + rnd() * 0.5, (0.38 + rnd() * 0.3) * k, 0.017, 0.005, L.B_TWIG, i);
        const fp = bez(st.p0, st.c, st.p1, 0.55);
        if (i < 3) stem(D, fp, yaw + (rnd() < 0.5 ? -0.7 : 0.7), 0.5 + rnd() * 0.4, (0.2 + rnd() * 0.14) * k, 0.008, 0.003, L.B_TWIG, i + 4);
        if (i < 3) {
          const d = norm(add(st.p1, st.p0, -1));
          const q1 = add(fp, d, 0.4 * k);
          (i < 2 ? B : D).leaf(fp, lerp3(fp, q1, 0.5), q1, sc3(rotAx(perpH(d), d, rnd() * 3), 0.34 * k), false, L.DEAD, 0.9 + rnd() * 0.2, st.w, null);
        }
      }
      break;
    }
  }
}

interface Cell {
  cb: Float32Array;
  cd: Float32Array;
  wb: Float32Array;
  wd: Float32Array;
}
const pack = (B: PlantWriter, D: PlantWriter): Cell => ({ cb: new Float32Array(B.card), cd: new Float32Array(D.card), wb: new Float32Array(B.wood), wd: new Float32Array(D.wood) });

// ------------------------------------------------------------------ scatter
const CELL = 8;
/** cells nearer than this add their detail pieces */
const NEAR = 26;
/** anchors that leave the ground round them overgrown (ruins, wrecks, standing stones) */
const OVERGROWN = new Set(['shack', 'saloonFacade', 'sheriffFacade', 'storeFacade', 'tent', 'outpost', 'ruinWall', 'hieroglyphWall', 'landmark', 'windmill', 'waterTower', 'watchtower', 'outhouse', 'gallows', 'wagon', 'shipwreck', 'shrine', 'colossusLegs', 'colossusHead', 'rockArch', 'stoneGate', 'obeliskBroken', 'column', 'sphinx', 'statue', 'well', 'trough', 'giantSkull', 'ribArch', 'cairn']);
const FOOT: Record<string, number> = { shack: 4, saloonFacade: 4.5, sheriffFacade: 4.5, storeFacade: 4.5, landmark: 10, outpost: 4, shipwreck: 8, rockArch: 6, colossusLegs: 4, colossusHead: 4, shrine: 4, sphinx: 4, stoneGate: 5, windmill: 3, waterTower: 3, watchtower: 3 };

interface Ctx {
  oasis: { x: number; z: number; r: number; level: number } | null;
  arenas: { x: number; z: number; r: number }[];
  ruins: { x: number; z: number; foot: number }[];
  rims: { cx: number; cz: number; r: number }[];
}

export class Foliage {
  /** both draws (blade cards + stems) */
  mesh = new THREE.Group();
  /** the 3D trees and bushes (palms, acacias, tamarisks, scrub, oasis shrubs) */
  trees: Trees;
  private cards: PlantLayer;
  private wood: PlantLayer;
  private capC = 64000;
  private capW = 12000;
  private cells = new Map<number, Cell>();
  private anchors: (Cell & { x: number; z: number })[] = [];
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private dirty = true;
  private U = plantUniforms(0.13, 1e6, 0.58);
  private ruins: { x: number; z: number; foot: number }[] = [];
  private oases: { x: number; z: number; r: number; level: number }[] = [];
  /** boss arenas: the cover is kept low there so nothing hides in it */
  private arenas: { x: number; z: number; r: number }[] = [];
  /** radius (m) the scatter reaches */
  radius = 62;

  constructor(private world: World) {
    this.trees = new Trees(world);
    this.U.uWind.value.set(world.sa.wind.x, world.sa.wind.z);
    this.cards = new PlantLayer(false, false, this.U, { fade: true, name: 'foliage-cards' });
    this.wood = new PlantLayer(true, false, this.U, { fade: true, name: 'foliage-stems' });
    this.cards.alloc(this.capC);
    this.wood.alloc(this.capW);
    this.mesh.name = 'foliage';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.add(this.cards.mesh, this.wood.mesh);
    for (const z of world.sa.zones) {
      for (const p of z.pois) if (p.kind === 'oasis') this.oases.push({ x: p.x, z: p.z, r: p.r / 1.6, level: p.data?.level ?? world.sa.waterLevel });
      for (const a of z.anchors) {
        if (OVERGROWN.has(a.kind)) this.ruins.push({ x: a.x, z: a.z, foot: FOOT[a.kind] ?? 2.5 });
        else if (a.kind === 'bossArena') this.arenas.push({ x: a.x, z: a.z, r: a.data?.r ?? 20 });
      }
    }
    // terrain edits (craters, rising temples, collapsing walls) regrow the cells they touch
    world.field.onDirty.push((x0, z0, x1, z1) => {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) this.cells.delete(i + j * 4096);
      this.dirty = true;
    });
  }

  /** a placed plant from a zone anchor (dead brush, dry grass, reeds, papyrus, flowering shrubs) */
  addAnchor(kind: string, variant: number, x: number, z: number, rot: number, scale: number) {
    const g: GroupId | null = kind === 'deadBush' ? 'dead' : kind === 'dryGrass' ? 'dry' : kind === 'oasisReeds' || kind === 'reeds' ? 'reed' : kind === 'oasisFlowers' ? 'flower' : kind === 'papyrus' ? 'papyrus' : kind in GROUP ? (kind as GroupId) : null;
    if (!g) return false;
    const y = this.world.groundAt(x, z) - 0.04;
    const k = scale * (g === 'flower' ? 1.0 : GROUP[g] * 1.15);
    const B = new PlantWriter(), D = new PlantWriter();
    // a placed plant is a fuller clump: the tuft plus two smaller ones beside it
    tuft(B, D, g, x, y, z, rot, k, ((variant * 0.618) % 1) + 0.001);
    for (let i = 0; i < 2; i++) {
      const a = rot + i * 2.6 + 0.8, r = 0.32 * k;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      tuft(B, D, g, px, this.world.groundAt(px, pz) - 0.04, pz, rot + i, k * 0.72, ((variant * 0.618 + 0.31 * (i + 1)) % 1) + 0.001);
    }
    this.anchors.push({ x, z, ...pack(B, D) });
    this.dirty = true;
    return true;
  }

  private ctxAt(x: number, z: number): Ctx {
    let oasis: Ctx['oasis'] = null;
    for (const o of this.oases) if (Math.hypot(o.x - x, o.z - z) < o.r * 1.9 + CELL) oasis = o;
    const ruins = this.ruins.filter((r) => Math.hypot(r.x - x, r.z - z) < r.foot + 12 + CELL);
    const rims: Ctx['rims'] = [];
    for (const zn of this.world.sa.zones) {
      const d = Math.hypot(zn.cx - x, zn.cz - z);
      if (Math.abs(d - (zn.r + 3.5)) < 8 + CELL) rims.push({ cx: zn.cx, cz: zn.cz, r: zn.r + 3.5 });
    }
    const arenas = this.arenas.filter((r) => Math.hypot(r.x - x, r.z - z) < r.r + CELL);
    return { oasis, ruins, rims, arenas };
  }

  /** deterministic scatter for one 8 m cell */
  private genCell(ci: number, cj: number): Cell {
    const f = this.world.field;
    const sa = this.world.sa;
    const x0 = ci * CELL, z0 = cj * CELL;
    const ctx = this.ctxAt(x0 + CELL / 2, z0 + CELL / 2);
    // probe: lush ground in the cell (turf, mud, dirt, damp sand) needs the dense pass
    const nileF = sa.nile ? sa.nile.foliage : null;
    let lush = !!ctx.oasis || ctx.ruins.length > 0 || ctx.rims.length > 0 || (!!sa.nile && Math.abs(sa.nile.river.bankDist(x0 + CELL / 2, z0 + CELL / 2)) < CELL + 8);
    if (!lush)
      for (let k = 0; k < 9 && !lush; k++) {
        const m = f.matAt(x0 + (k % 3) * 3.5 + 0.5, z0 + Math.floor(k / 3) * 3.5 + 0.5);
        if (m === MAT.GRASS || m === MAT.MUD || m === MAT.DIRT || m === MAT.SAND_DARK) lush = true;
      }
    const nCand = lush ? 200 : 10;
    const candD = nCand / (CELL * CELL);
    const B = new PlantWriter(), D = new PlantWriter();
    const H = (i: number, s: number) => {
      let h = Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663) ^ Math.imul(i, 83492791) ^ Math.imul(s, 2654435761);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < nCand; i++) {
      const x = x0 + H(i, 1) * CELL, z = z0 + H(i, 2) * CELL;
      if (!f.inBounds(x, z, 1)) continue;
      const h = f.heightAt(x, z);
      // the Nile: papyrus beds, reeds in the shallows, planted rows in the fields, burnt stubble
      const nh = nileF ? nileF(x, z, h, f.matAt(x, z), H(i, 3)) : null;
      if (nh) {
        if (nh.dens <= 0 || H(i, 4) * candD >= nh.dens * 0.8 || f.slopeAt(x, z) > 1.1) continue;
        tuft(B, D, nh.grp, x, h - 0.03, z, H(i, 7) * Math.PI * 2, GROUP[nh.grp] * (0.78 + H(i, 6) * 0.5), H(i, 8));
        continue;
      }
      if (h < sa.waterLevel + 0.06) continue;
      const m = f.matAt(x, z);
      if (m >= MAT.BONE) continue;
      if (f.slopeAt(x, z) > 1.1) continue;
      let dens = 0;
      let grp: GroupId = 'dry';
      const pick = H(i, 3);
      const o = ctx.oasis;
      if (o && h < o.level + 0.05) {
        // in the pool: reeds stand in the shallows along the bank only
        if (m === MAT.MUD && h > o.level - 0.32) {
          dens = 0.5;
          grp = 'reed';
        }
      } else if (m === MAT.GRASS) {
        dens = 2.6;
        grp = pick < 0.8 ? 'turf' : pick < 0.89 ? 'wild' : pick < 0.94 ? 'flower' : 'dry';
      } else if (m === MAT.MUD) {
        dens = 0.36;
        grp = pick < 0.6 ? 'reed' : 'turf';
      } else if (m === MAT.SAND_DARK) {
        dens = o ? 0.7 : 0.12;
        grp = pick < 0.42 ? 'dry' : pick < 0.74 ? (o ? 'turf' : 'dry') : pick < 0.86 ? 'wild' : 'scrub';
      } else if (m === MAT.DIRT) {
        dens = 0.28;
        grp = pick < 0.58 ? 'dry' : pick < 0.78 ? 'scrub' : pick < 0.9 ? 'dead' : 'wild';
      } else if (m === MAT.ROCK || m === MAT.DARK_ROCK) {
        dens = 0.05;
        grp = pick < 0.8 ? 'dry' : 'scrub';
      } else if (m === MAT.TILE) {
        dens = 0.03;
        grp = pick < 0.7 ? 'dry' : 'wild';
      } else {
        dens = 0.02;
        grp = pick < 0.74 ? 'dry' : 'dead';
      }
      // overgrown ground round the ruins (never inside them) and along the zone rims
      for (const r of ctx.ruins) {
        const d = Math.hypot(r.x - x, r.z - z);
        if (d < r.foot * 0.75) {
          dens = 0;
          break;
        }
        const k = 1 - Math.min(1, Math.max(0, (d - r.foot) / 10));
        if (k > 0 && m !== MAT.GRASS && m !== MAT.MUD) {
          dens = Math.max(dens, 0.5 * k);
          if (pick < 0.62) grp = 'dry';
          else if (pick < 0.82) grp = 'dead';
          else if (pick < 0.92) grp = 'scrub';
          else grp = 'wild';
        }
      }
      for (const rm of ctx.rims) {
        const d = Math.abs(Math.hypot(rm.cx - x, rm.cz - z) - rm.r);
        const k = 1 - Math.min(1, d / 6);
        if (k > 0 && dens < 0.36 * k && m !== MAT.MUD) {
          dens = 0.36 * k;
          grp = pick < 0.7 ? 'dry' : pick < 0.9 ? 'dead' : 'scrub';
        }
      }
      for (const ar of ctx.arenas) if (Math.hypot(ar.x - x, ar.z - z) < ar.r) dens *= 0.25;
      if (H(i, 4) * candD >= dens) continue;
      tuft(B, D, grp, x, h - 0.03, z, H(i, 7) * Math.PI * 2, GROUP[grp] * (0.78 + H(i, 6) * 0.5), H(i, 8));
    }
    return pack(B, D);
  }

  update(focus: THREE.Vector3) {
    this.trees.update();
    this.U.uFocus.value.copy(focus);
    const moved = Math.hypot(focus.x - this.last.x, focus.z - this.last.z);
    if (!this.dirty && moved < 4) return;
    const R = this.radius;
    this.U.uRad.value = R;
    const i0 = Math.floor((focus.x - R) / CELL), i1 = Math.floor((focus.x + R) / CELL);
    const j0 = Math.floor((focus.z - R) / CELL), j1 = Math.floor((focus.z + R) / CELL);
    // generate a bounded number of new cells per frame (nearest first) so riding never hitches
    const live: [number, number][] = [];
    const missing: [number, number, number][] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = Math.max(0, Math.abs((i + 0.5) * CELL - focus.x) - CELL / 2), dz = Math.max(0, Math.abs((j + 0.5) * CELL - focus.z) - CELL / 2);
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        live.push([i + j * 4096, d2]);
        if (!this.cells.has(i + j * 4096)) missing.push([i, j, d2]);
      }
    missing.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    let made = 0;
    for (const [i, j] of missing) {
      if (made > 0 && performance.now() - t0 > 2.5) break;
      this.cells.set(i + j * 4096, this.genCell(i, j));
      made++;
    }
    this.dirty = made < missing.length;
    this.last.copy(focus);
    // forget cells far behind
    if (this.cells.size > 1600)
      for (const k of this.cells.keys()) {
        const i = ((k % 4096) + 4096) % 4096, j = Math.round((k - i) / 4096);
        if (Math.hypot((i + 0.5) * CELL - focus.x, (j + 0.5) * CELL - focus.z) > R * 2.2) this.cells.delete(k);
      }
    // pack the live instances, nearest cells first (so the caps only ever trim the far edge)
    live.sort((a, b) => a[1] - b[1]);
    const ca = this.cards.array!, wa = this.wood.array!;
    let nc = 0, nw = 0;
    const put = (c: Cell, near: boolean) => {
      const add = (src: Float32Array, dst: Float32Array, n: number, cap: number) => {
        const m = src.length / STRIDE;
        if (!m || n + m > cap) return n;
        dst.set(src, n * STRIDE);
        return n + m;
      };
      nc = add(c.cb, ca, nc, this.capC);
      nw = add(c.wb, wa, nw, this.capW);
      if (near) {
        nc = add(c.cd, ca, nc, this.capC);
        nw = add(c.wd, wa, nw, this.capW);
      }
    };
    for (const a of this.anchors) {
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (d < R) put(a, d < NEAR + 10);
    }
    for (const [key, d2] of live) {
      const c = this.cells.get(key);
      if (c) put(c, d2 < NEAR * NEAR);
    }
    this.cards.commit(nc);
    this.wood.commit(nw);
  }

  get count() {
    return this.cards.geo.instanceCount + this.wood.geo.instanceCount;
  }

  dispose() {
    this.trees.dispose();
    this.cards.dispose();
    this.wood.dispose();
    this.mesh.removeFromParent();
  }
}
