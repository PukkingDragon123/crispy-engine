// The attack-warning language every enemy and boss speaks:
//   • a "!" in Alagard, extruded into chunky voxel type with a baked ink rim,
//     that pops over the attacker (spins in, bobs, blinks faster as the blow
//     comes, bursts into pixel sparks when it lands)
//       tell  (gold "!")   an ordinary swing / pounce / shot is coming
//       heavy (orange "!!") a big hit or an area attack
//       grab  (red "!!")   a grab / snatch / unblockable — a QTE DODGE may follow
//   • ground markers in pixel dots: rings that can track their target and
//     lock, lanes for charges and sweeps, wedges for cleaves
// Typography is the only thing drawn in 2D here (the Alagard glyph raster);
// the glyph itself is a lit voxel mesh in the world.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { rnd } from '../../engine/math/rand';

export type WarnTier = 'tell' | 'heavy' | 'grab';

export const WARN_COL: Record<WarnTier, number> = { tell: 0xffd040, heavy: 0xff8a2a, grab: 0xff3a2a };
/** the pixel-dot colours of ground markers per tier (calm → hot) */
const DOTS: Record<WarnTier, [number[], number[]]> = {
  tell: [[0xffb040, 0xff8a2a, 0xffe0a0], [0xff6a2a, 0xff3a1a, 0xffd0a0]],
  heavy: [[0xff8a2a, 0xff5a1a, 0xffd0a0], [0xff3a1a, 0xe01a10, 0xffc090]],
  grab: [[0xff4a2a, 0xd8201a, 0xffb0a0], [0xff1a10, 0xb80a0a, 0xffe0d0]],
};

/** a thing a "!" can ride on */
export interface WarnAnchor {
  pos: { x: number; y: number; z: number };
  alive?: boolean;
}

interface Bang {
  core: THREE.Mesh;
  rim: THREE.Mesh;
  mat: VoxelMaterial;
  rimMat: VoxelMaterial;
  on: boolean;
  t: number;
  life: number;
  tier: WarnTier;
  anchor: WarnAnchor | null;
  x: number;
  y: number;
  z: number;
  yOff: number;
  id: number;
  spin: number;
}

interface Mark {
  kind: 'circle' | 'lane' | 'wedge';
  x: number;
  z: number;
  r: number;
  dx: number;
  dz: number;
  len: number;
  half: number;
  t: number;
  dur: number;
  tier: WarnTier;
  follow: (() => { x: number; z: number } | null) | null;
  lockAt: number;
  locked: boolean;
  pulse: number;
  id: number;
}

/** handle to a live ground marker (its centre moves while it tracks) */
export interface MarkHandle {
  id: number;
  x: number;
  z: number;
  locked: boolean;
}

// ------------------------------------------------------------------ the glyphs
const INK = 0x1a0e06;
/** Alagard's "!" at 16 px if the font is not ready yet (same pixels the font draws) */
const FALLBACK_BANG = ['.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '..#.', '....', '.##.', '.##.'];

function glyphMask(text: string): { w: number; h: number; on: (x: number, y: number) => boolean } | null {
  if (typeof document === 'undefined') return null;
  const ok = !!document.fonts?.check?.("16px 'Alagard'");
  if (!ok) {
    if (!/^!+$/.test(text)) return null;
    const rows: string[] = FALLBACK_BANG.map((r) => r.repeat(text.length));
    return { w: rows[0].length, h: rows.length, on: (x, y) => rows[y]?.[x] === '#' };
  }
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 24;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = "16px 'Alagard'";
  c.textBaseline = 'top';
  c.fillStyle = '#fff';
  c.fillText(text, 4, 2);
  const d = c.getImageData(0, 0, 64, 24).data;
  let x0 = 64, x1 = -1, y0 = 24, y1 = -1;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 64; x++)
      if (d[(y * 64 + x) * 4 + 3] >= 110) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, on: (x, y) => x >= 0 && y >= 0 && x <= x1 - x0 && y <= y1 - y0 && d[((y + y0) * 64 + (x + x0)) * 4 + 3] >= 110 };
}

/**
 * Extrude a glyph mask into voxel type: a bright emissive face, a darker bevel
 * row along the lower-right edges (light from the upper left), a two-deep
 * body and an ink rim one voxel wider all round, set back behind the letter.
 */
function glyphModels(text: string) {
  const g = glyphMask(text);
  if (!g) return null;
  const core = new VoxelModel('warn_core');
  const rim = new VoxelModel('warn_rim');
  const H = g.h;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!g.on(x, y)) continue;
      const Y = H - 1 - y;
      // bevel: the pixel's lower / right neighbour is empty → shaded edge
      const edge = !g.on(x + 1, y) || !g.on(x, y + 1);
      const top = !g.on(x, y - 1) || !g.on(x - 1, y);
      core.set(x, Y, 2, edge ? 0xd8c8a8 : top ? 0xffffff : 0xfff4e0, VF.EMISSIVE);
      core.set(x, Y, 1, 0xb8a888, VF.SOLID);
    }
  for (let y = -1; y <= g.h; y++)
    for (let x = -1; x <= g.w; x++) {
      if (g.on(x, y)) continue;
      let near = false;
      for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1; b++) if (g.on(x + a, y + b)) near = true;
      if (!near) continue;
      const Y = H - 1 - y;
      rim.set(x, Y, 1, INK);
      rim.set(x, Y, 0, INK);
    }
  // a one-pixel drop shadow down-right gives the type its depth from the front
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) if (g.on(x, y) && !g.on(x + 1, y + 1)) rim.set(x + 1, H - 2 - y, 0, INK);
  return { core, rim, w: g.w, h: g.h };
}

let NEXT = 1;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Warnings {
  private bangs: Bang[] = [];
  private marks: Mark[] = [];
  private geos = new Map<string, { core: THREE.BufferGeometry; rim: THREE.BufferGeometry; h: number; font: boolean }>();
  /** world height of one glyph voxel at scale 1 */
  private vs = 0.06;

  constructor(private ctx: Ctx, n = 22) {
    for (let i = 0; i < n; i++) {
      const mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.6 });
      const rimMat = makeVoxelMaterial({ fog: false });
      for (const m of [mat, rimMat]) {
        m.depthTest = false;
        m.depthWrite = false;
        m.transparent = true;
      }
      const rim = new THREE.Mesh(new THREE.BufferGeometry(), rimMat);
      const core = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      rim.renderOrder = 44;
      core.renderOrder = 45;
      for (const m of [rim, core]) {
        m.frustumCulled = false;
        m.visible = false;
        m.castShadow = false;
        m.receiveShadow = false;
        ctx.scene.add(m);
      }
      this.bangs.push({ core, rim, mat, rimMat, on: false, t: 0, life: 1, tier: 'tell', anchor: null, x: 0, y: 0, z: 0, yOff: 0, id: 0, spin: 1 });
    }
  }

  private glyph(text: string) {
    const font = typeof document !== 'undefined' && !!document.fonts?.check?.("16px 'Alagard'");
    const hit = this.geos.get(text);
    if (hit && (hit.font || !font)) return hit;
    const m = glyphModels(text);
    if (!m) return hit ?? null;
    hit?.core.dispose();
    hit?.rim.dispose();
    const piv: [number, number, number] = [m.w / 2, 0, 1.5];
    const out = {
      core: buildVoxelGeometry(m.core, { voxelSize: this.vs, pivot: piv }),
      rim: buildVoxelGeometry(m.rim, { voxelSize: this.vs, pivot: piv }),
      h: m.h * this.vs,
      font,
    };
    this.geos.set(text, out);
    return out;
  }

  /** active "!" count (callers can thin out trash warnings in a crowd) */
  get active() {
    let n = 0;
    for (const b of this.bangs) if (b.on) n++;
    return n;
  }

  /**
   * Pop a warning glyph over an attacker. `life` should match the wind-up:
   * the glyph blinks faster toward its end and bursts when it runs out.
   * `y` is the height above the anchor's position. Returns an id for cancel().
   */
  bang(anchor: WarnAnchor | { x: number; y: number; z: number }, o: { tier?: WarnTier; life?: number; y?: number } = {}) {
    const tier = o.tier ?? 'tell';
    const isAnchor = (anchor as WarnAnchor).pos !== undefined;
    const p = isAnchor ? (anchor as WarnAnchor).pos : (anchor as { x: number; y: number; z: number });
    const cam = this.ctx.camera.position;
    if (Math.hypot(p.x - cam.x, p.z - cam.z) > 70) return 0;
    const g = this.glyph(tier === 'tell' ? '!' : '!!');
    if (!g) return 0;
    // the same anchor re-warning restarts its glyph instead of stacking a second one
    let b = isAnchor ? this.bangs.find((q) => q.on && q.anchor === anchor) : undefined;
    if (!b) b = this.bangs.find((q) => !q.on);
    if (!b) {
      // full: steal the oldest ordinary tell (never a grab warning)
      let best: Bang | null = null;
      for (const q of this.bangs) if (q.tier !== 'grab' && (!best || q.t / q.life > best.t / best.life)) best = q;
      if (!best) return 0;
      b = best;
    }
    b.core.geometry = g.core;
    b.rim.geometry = g.rim;
    b.mat.userData.tint.value.setHex(WARN_COL[tier]);
    b.rimMat.userData.tint.value.setHex(0xffffff);
    b.on = true;
    b.t = 0;
    b.life = Math.max(0.35, o.life ?? 0.8);
    b.tier = tier;
    b.anchor = isAnchor ? (anchor as WarnAnchor) : null;
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.yOff = o.y ?? 2.2;
    b.id = NEXT++;
    b.spin = rnd.sign();
    b.core.visible = b.rim.visible = true;
    return b.id;
  }

  cancel(id: number) {
    for (const b of this.bangs) if (b.on && b.id === id) this.off(b, false);
  }
  /** drop every warning riding on this anchor (it died / was interrupted) */
  cancelFor(anchor: WarnAnchor) {
    for (const b of this.bangs) if (b.on && b.anchor === anchor) this.off(b, false);
  }

  private off(b: Bang, burst: boolean) {
    if (burst) {
      const P = this.ctx.particles;
      const c = WARN_COL[b.tier];
      P.emit({ pos: { x: b.x, y: b.y + b.yOff + 0.3, z: b.z }, count: 7, spread: 2.2, up: 1.2, life: [0.25, 0.45], size: [0.09, 0.03], sprite: ['dot3', 'dot4'], color: [c, 0xffffff, c], additive: true, gravity: 4, sizeJitter: 0.2 });
    }
    b.on = false;
    b.anchor = null;
    b.core.visible = b.rim.visible = false;
  }

  // ------------------------------------------------------------------ ground markers
  /**
   * A ring of pixel dots on the sand. With `follow` it tracks a point (the
   * prey) until `lockAt` seconds, then locks in place and tightens: dodge out
   * of it. Returns a live handle (its x/z move while it tracks).
   */
  circle(x: number, z: number, r: number, dur: number, tier: WarnTier = 'heavy', follow: (() => { x: number; z: number } | null) | null = null, lockAt = dur): MarkHandle {
    const m: Mark = { kind: 'circle', x, z, r, dx: 0, dz: 1, len: 0, half: 0, t: 0, dur, tier, follow, lockAt, locked: !follow, pulse: 0, id: NEXT++ };
    this.marks.push(m);
    return m;
  }
  /** a straight lane (charges, sweeps): from (x, z) along (dx, dz), `len` long, `width` wide */
  lane(x: number, z: number, dx: number, dz: number, len: number, width: number, dur: number, tier: WarnTier = 'heavy') {
    const l = Math.hypot(dx, dz) || 1;
    const m: Mark = { kind: 'lane', x, z, r: width / 2, dx: dx / l, dz: dz / l, len, half: 0, t: 0, dur, tier, follow: null, lockAt: dur, locked: true, pulse: 0, id: NEXT++ };
    this.marks.push(m);
    return m as MarkHandle;
  }
  /** a cleave wedge in front of an attacker: apex (x, z), facing yaw, reach `len`, half-angle `half` */
  wedge(x: number, z: number, yaw: number, len: number, half: number, dur: number, tier: WarnTier = 'tell') {
    const m: Mark = { kind: 'wedge', x, z, r: 0, dx: Math.sin(yaw), dz: Math.cos(yaw), len, half, t: 0, dur, tier, follow: null, lockAt: dur, locked: true, pulse: 0, id: NEXT++ };
    this.marks.push(m);
    return m as MarkHandle;
  }
  endMark(h: MarkHandle | null | undefined) {
    if (!h) return;
    this.marks = this.marks.filter((m) => m.id !== h.id);
  }

  private dot(x: number, z: number, edge: boolean, hot: boolean, tier: WarnTier) {
    const y = this.ctx.world.groundAt(x, z) + 0.06;
    const pal = DOTS[tier][hot ? 1 : 0];
    this.ctx.particles.emit({ pos: { x, y, z }, count: 1, vel: { x: 0, y: edge ? 0.15 : 0.35, z: 0 }, life: edge ? [0.14, 0.2] : [0.18, 0.3], size: edge ? [0.13, 0.08] : [0.09, 0.03], sprite: edge ? 'dot3' : 'grain0', additive: edge, color: pal, sizeJitter: 0.2 });
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const ctx = this.ctx;
    const cam = ctx.camera;
    const camP = cam.position;
    const tanH = Math.tan(((cam.fov || 60) * Math.PI) / 360);
    for (const b of this.bangs) {
      if (!b.on) continue;
      b.t += dt;
      if (b.anchor) {
        if (b.anchor.alive === false) {
          this.off(b, false);
          continue;
        }
        b.x = b.anchor.pos.x;
        b.y = b.anchor.pos.y;
        b.z = b.anchor.pos.z;
      }
      if (b.t >= b.life) {
        this.off(b, true);
        continue;
      }
      const u = b.t / b.life;
      // pop: overshoot in, a flip around the vertical axis, then settle
      const k = Math.min(1, b.t / 0.18);
      const pop = k < 1 ? 1.32 * Math.sin(k * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) : 1;
      const settle = k < 1 ? pop : 1 + Math.max(0, 0.32 - (b.t - 0.18) * 2.4) * Math.sin((b.t - 0.18) * 26) * 0.4;
      // urgency: pulses quicker as the blow comes, the last stretch flashes white
      const rate = 8 + u * u * 34;
      const pulse = 1 + 0.07 * Math.sin(b.t * rate) + (u > 0.7 ? 0.08 : 0);
      const flash = u > 0.72 && Math.sin(b.t * rate * 1.3) > 0.2;
      // screen-steady size: ~6% of the view height, never smaller than the in-world letter
      _v.set(b.x, b.y + b.yOff, b.z);
      const dist = _v.distanceTo(camP);
      const want = (2 * dist * tanH * 0.062) / (this.glyphH(b) || 0.6);
      const sc = Math.max(0.9, Math.min(4.2, want)) * settle * pulse * (b.tier === 'grab' ? 1.15 : 1);
      const bob = Math.sin(b.t * 6.5) * 0.06 * sc;
      // face the camera (yaw only, a little lean back), with the spin-in and a lazy wobble
      const yaw = Math.atan2(camP.x - b.x, camP.z - b.z);
      const spinIn = (1 - Math.min(1, b.t / 0.22)) ** 2 * Math.PI * 1.1 * b.spin;
      _e.set(-0.12, yaw + spinIn + Math.sin(b.t * 3.1) * 0.22, Math.sin(b.t * 4.3) * 0.06 * (b.tier === 'tell' ? 1 : 1.8));
      _q.setFromEuler(_e);
      for (const m of [b.rim, b.core]) {
        m.position.set(b.x, b.y + b.yOff + bob, b.z);
        m.quaternion.copy(_q);
        m.scale.setScalar(sc);
      }
      b.mat.userData.fx.value.x = flash ? 0.75 : 0;
      b.mat.userData.fx.value.z = 0.6 + 0.5 * Math.sin(b.t * rate);
      const fade = u > 0.94 ? 1 - (u - 0.94) / 0.06 : 1;
      b.mat.opacity = b.rimMat.opacity = fade;
    }
    // ground markers
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t += dt;
      if (m.t >= m.dur) {
        this.marks.splice(i, 1);
        continue;
      }
      const k = m.t / m.dur;
      const hot = k > 0.7;
      if (m.follow && !m.locked) {
        const p = m.follow();
        if (p) {
          const a = 1 - Math.exp(-4.5 * dt);
          m.x += (p.x - m.x) * a;
          m.z += (p.z - m.z) * a;
        }
        if (m.t >= m.lockAt) {
          m.locked = true;
          ctx.fx.ring({ x: m.x, y: ctx.world.groundAt(m.x, m.z) + 0.12, z: m.z }, WARN_COL[m.tier], m.r * 2.4, 0.3);
          ctx.sfx('rev_hammer', { x: m.x, y: ctx.world.groundAt(m.x, m.z), z: m.z }, 0.35, 0.55);
        }
      }
      if (Math.hypot(m.x - camP.x, m.z - camP.z) > 80) continue;
      const rate = dt * (m.kind === 'lane' ? 60 + 90 * k : 46 + 90 * k) * (m.tier === 'tell' ? 0.8 : 1);
      let n = Math.floor(rate) + (rnd.chance(rate % 1) ? 1 : 0);
      if (m.kind === 'circle') {
        // tightens a touch once locked, so the edge reads as "here, now"
        const R = m.r * (m.locked && m.follow ? 1 - 0.18 * Math.min(1, (m.t - m.lockAt) / Math.max(0.05, m.dur - m.lockAt)) : 1);
        while (n-- > 0) {
          const th = rnd.next() * Math.PI * 2;
          const edge = rnd.chance(0.7);
          const r = edge ? R : Math.sqrt(rnd.next()) * R * (0.25 + 0.75 * k);
          this.dot(m.x + Math.cos(th) * r, m.z + Math.sin(th) * r, edge, hot || m.locked, m.tier);
        }
        // a crisp ring pulse every so often
        m.pulse -= dt;
        if (m.pulse <= 0) {
          m.pulse = 0.38 - k * 0.22;
          ctx.fx.ring({ x: m.x, y: ctx.world.groundAt(m.x, m.z) + 0.1, z: m.z }, WARN_COL[m.tier], R * 2, 0.26);
        }
      } else if (m.kind === 'lane') {
        while (n-- > 0) {
          const s = rnd.next() * m.len * (0.25 + 0.75 * k);
          const edge = rnd.chance(0.65);
          const side = edge ? rnd.sign() * m.r : (rnd.next() * 2 - 1) * m.r;
          this.dot(m.x + m.dx * s + m.dz * side, m.z + m.dz * s - m.dx * side, edge, hot, m.tier);
        }
      } else {
        while (n-- > 0) {
          const edge = rnd.chance(0.55);
          const th = (rnd.next() * 2 - 1) * m.half;
          const r = edge ? m.len : Math.sqrt(rnd.next()) * m.len * (0.4 + 0.6 * k);
          const lx = Math.sin(th) * r, lz = Math.cos(th) * r;
          this.dot(m.x + m.dx * lz + m.dz * lx, m.z + m.dz * lz - m.dx * lx, edge, hot, m.tier);
        }
      }
    }
  }

  private glyphH(b: Bang) {
    return this.geos.get(b.tier === 'tell' ? '!' : '!!')?.h ?? 0.6;
  }

  clear() {
    for (const b of this.bangs) if (b.on) this.off(b, false);
    this.marks.length = 0;
  }
}
