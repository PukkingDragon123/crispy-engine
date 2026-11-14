// Cleopatra's sun magic in the air: her bullets (sun orbs, ray darts, mirage
// diamonds, rose-petal shot), the sweeping sunbeams, the rose petals that drift
// everywhere she dances, and the golden scarab swarm.
//  - Bullets hug the terrain at chest height once they leave her hands, so a
//    curtain reads as a clean wall of light over the dunes; mandala rings orbit
//    while they expand; every shot has a dark rim so it reads on bright sand.
//  - All 2D here is pixel-art particle work (hand-authored sprites in a private
//    atlas), drawn by two instanced batches: cutout shots and additive light.
//  - The swarm is real 3D: instanced voxel scarabs with two baked wing frames.
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import type { Player } from '../../player/Player';
import type { RayHit } from '../../Ctx';
import type { Hit } from '../../combat/Damage';
import { makeVoxelMaterial, type VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { rnd } from '../../../engine/math/rand';

// ============================================================================ pixel atlas
type Art = { rows: string[]; pal: Record<string, string> };
const SUN_PAL = { r: '#4a1006', O: '#d8481a', y: '#ffa82a', Y: '#ffe07a', W: '#fffbea' };
const ART: Record<string, Art> = {
  sun: { rows: ['...rrr...', '.rrOOOrr.', '.rOyyyOr.', 'rOyYYYyOr', 'rOyYWYyOr', 'rOyYYYyOr', '.rOyyyOr.', '.rrOOOrr.', '...rrr...'], pal: SUN_PAL },
  sunS: { rows: ['.rrr.', 'rOyOr', 'ryWyr', 'rOyOr', '.rrr.'], pal: SUN_PAL },
  ray: { rows: ['..W..', '.YWY.', '.yWy.', 'rOYOr', 'rOYOr', 'rOyOr', '.OyO.', '.rOr.', '..r..', '..r..'], pal: SUN_PAL },
  diamond: { rows: ['...k...', '..kWk..', '.kWYyk.', 'kWYyyOk', 'kWyyyOk', '.kyyOk.', '..kOk..', '...k...'], pal: { k: '#3a1a06', W: '#fffbea', Y: '#fff0a0', y: '#ffc850', O: '#c86a1a' } },
  petal: { rows: ['..cc...', '.cCCc..', 'cCPPCc.', 'cCPPCCc', '.cCCCc.', '..ccc..'], pal: { c: '#5a0c18', C: '#b8203a', P: '#f0607a' } },
  petalB: { rows: ['.cc..', 'cCCc.', 'cPCCc', '.cCCc', '..cc.'], pal: { c: '#6a1020', C: '#d0304a', P: '#ff90a0' } },
  petalE: { rows: ['c', 'C', 'C', 'P', 'C', 'c'], pal: { c: '#5a0c18', C: '#b8203a', P: '#f0607a' } },
  glyph: { rows: ['...w...', '.w.w.w.', '..www..', 'wwwWwww', '..www..', '.w.w.w.', '...w...'], pal: { w: '#ffd890', W: '#ffffff' } },
  mote: { rows: ['.w.', 'wWw', '.w.'], pal: { w: '#d8d8d8', W: '#ffffff' } },
  ember: { rows: ['wW', 'Ww'], pal: { w: '#d0d0d0', W: '#ffffff' } },
  star: { rows: ['..w..', '..W..', 'wWWWw', '..W..', '..w..'], pal: { w: '#c8c8c8', W: '#ffffff' } },
};
interface Frame {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}
let ATLAS: { tex: THREE.CanvasTexture; frames: Record<string, Frame> } | null = null;
function atlas() {
  if (ATLAS) return ATLAS;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const frames: Record<string, Frame> = {};
  let x = 1, y = 1, rowH = 0;
  const place = (name: string, w: number, h: number, draw: (ox: number, oy: number) => void) => {
    if (x + w + 1 > S) {
      x = 1;
      y += rowH + 1;
      rowH = 0;
    }
    draw(x, y);
    frames[name] = { u0: (x + 0.02) / S, v0: 1 - (y + h - 0.02) / S, u1: (x + w - 0.02) / S, v1: 1 - (y + 0.02) / S, w, h };
    x += w + 1;
    rowH = Math.max(rowH, h);
  };
  for (const [name, a] of Object.entries(ART)) {
    const h = a.rows.length, w = Math.max(...a.rows.map((r) => r.length));
    place(name, w, h, (ox, oy) => {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < a.rows[j].length; i++) {
          const ch = a.rows[j][i];
          if (ch === '.' || !a.pal[ch]) continue;
          g.fillStyle = a.pal[ch];
          g.fillRect(ox + i, oy + j, 1, 1);
        }
    });
  }
  // a soft radial light for the additive layer (light, not a picture)
  place('halo', 16, 16, (ox, oy) => {
    for (let j = 0; j < 16; j++)
      for (let i = 0; i < 16; i++) {
        const d = Math.hypot(i - 7.5, j - 7.5) / 8;
        if (d > 1) continue;
        const a = Math.pow(1 - d, 1.8);
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        g.fillRect(ox + i, oy + j, 1, 1);
      }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  ATLAS = { tex, frames };
  return ATLAS;
}

// ============================================================================ instanced pixel batch
class PixBatch {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: Float32Array;
  private iCol: Float32Array;
  private iUV: Float32Array;
  private iSRS: Float32Array;
  private iVel: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  n = 0;
  constructor(public max: number, additive: boolean) {
    const A = atlas();
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    const mk = (n: number, name: string) => {
      const a = new Float32Array(max * n);
      const at = new THREE.InstancedBufferAttribute(a, n);
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, at);
      this.attrs.push(at);
      return a;
    };
    this.iPos = mk(3, 'iPos');
    this.iCol = mk(4, 'iCol');
    this.iUV = mk(4, 'iUV');
    this.iSRS = mk(4, 'iSRS');
    this.iVel = mk(3, 'iVel');
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: A.tex }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iUV; attribute vec4 iSRS; attribute vec3 iVel;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec2 c = position.xy;
          vec2 sz = iSRS.xy;
          if (iSRS.w > 0.0) {
            vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
            vec2 dir = vv.xy; float l = length(dir);
            dir = l > 1e-4 ? dir / l : vec2(0.0, 1.0);
            vec2 perp = vec2(-dir.y, dir.x);
            mv.xy += dir * c.y * (sz.y + l * iSRS.w) + perp * c.x * sz.x;
          } else {
            float cs = cos(iSRS.z), sn = sin(iSRS.z);
            mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * sz;
          }
          vUv = mix(iUV.xy, iUV.zw, c + 0.5);
          vCol = iCol; vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        float bayer(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
          float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
        void main(){
          vec4 c = texture2D(map, vUv) * vCol;
          ${additive ? 'if (c.a < 0.01) discard; c.rgb *= c.a * 1.6;' : 'if (c.a < bayer(gl_FragCoord.xy)) discard; c.a = 1.0;'}
          float f = smoothstep(fogNear, fogFar, vFog);
          c.rgb = mix(c.rgb, ${additive ? 'vec3(0.0)' : 'fogColor'}, f);
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: additive,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 4;
  }
  begin() {
    this.n = 0;
  }
  push(x: number, y: number, z: number, sprite: string, sx: number, sy: number, rot = 0, color = 0xffffff, alpha = 1, vx = 0, vy = 0, vz = 0, stretch = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const f = atlas().frames[sprite] ?? atlas().frames.mote;
    this.iPos[i * 3] = x;
    this.iPos[i * 3 + 1] = y;
    this.iPos[i * 3 + 2] = z;
    this.iCol[i * 4] = ((color >> 16) & 255) / 255;
    this.iCol[i * 4 + 1] = ((color >> 8) & 255) / 255;
    this.iCol[i * 4 + 2] = (color & 255) / 255;
    this.iCol[i * 4 + 3] = alpha;
    this.iUV[i * 4] = f.u0;
    this.iUV[i * 4 + 1] = f.v0;
    this.iUV[i * 4 + 2] = f.u1;
    this.iUV[i * 4 + 3] = f.v1;
    const aspect = f.w / f.h;
    this.iSRS[i * 4] = aspect >= 1 ? sx : sx * aspect;
    this.iSRS[i * 4 + 1] = aspect >= 1 ? sy / aspect : sy;
    this.iSRS[i * 4 + 2] = rot;
    this.iSRS[i * 4 + 3] = stretch;
    this.iVel[i * 3] = vx;
    this.iVel[i * 3 + 1] = vy;
    this.iVel[i * 3 + 2] = vz;
  }
  end(fog?: THREE.Fog | null) {
    this.geo.instanceCount = this.n;
    for (const at of this.attrs) {
      at.needsUpdate = true;
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, this.n) * at.itemSize);
    }
    if (fog) {
      const m = this.mesh.material as THREE.ShaderMaterial;
      m.uniforms.fogColor.value.copy(fog.color);
      m.uniforms.fogNear.value = fog.near;
      m.uniforms.fogFar.value = fog.far;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ============================================================================ shots
export type ShotKind = 'sun' | 'sunS' | 'ray' | 'diamond' | 'petal';
const SHOT: Record<ShotKind, { size: number; r: number; halo: number; stretch: number }> = {
  sun: { size: 0.62, r: 0.3, halo: 0xff9a30, stretch: 0 },
  sunS: { size: 0.42, r: 0.22, halo: 0xffb040, stretch: 0 },
  ray: { size: 0.34, r: 0.2, halo: 0xffc860, stretch: 0.03 },
  diamond: { size: 0.5, r: 0.24, halo: 0xffe090, stretch: 0 },
  petal: { size: 0.46, r: 0.22, halo: 0xff5070, stretch: 0 },
};
export interface Shot {
  kind: ShotKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** speed change (m/s^2) along the heading, clamped to [minSp, maxSp] */
  acc: number;
  minSp: number;
  maxSp: number;
  /** heading turn rate (rad/s, around Y) */
  turn: number;
  /** ease down to chest height over the terrain */
  settle: boolean;
  /** mandala orbit: centre, radius, radial speed, angular speed, angle */
  orb: { cx: number; cz: number; R: number; vr: number; w: number; a: number } | null;
  delay: number;
  life: number;
  dmg: number;
  grazed: boolean;
  spin: number;
  homing: number;
}
interface Beam {
  ox: number;
  oy: number;
  oz: number;
  /** origin follows this (the crown disc), optional */
  from: (() => THREE.Vector3) | null;
  cx: number;
  cz: number;
  ang: number;
  sweep: number;
  len: number;
  width: number;
  t: number;
  dur: number;
  dmg: number;
  scorch: number;
}
interface Petal {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  rs: number;
  flip: number;
  fs: number;
  life: number;
  max: number;
  size: number;
  sprite: string;
  rest: boolean;
}
interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: number;
  sprite: string;
  drag: number;
  grav: number;
}

const _v = new THREE.Vector3();

export class SunShots {
  shots: Shot[] = [];
  beams: Beam[] = [];
  petals: Petal[] = [];
  motes: Mote[] = [];
  private cut = new PixBatch(2600, false);
  private add = new PixBatch(3600, true);
  /** extra per-frame additive pushes from the boss (ward glyphs, tethers) */
  onDraw: ((add: (x: number, y: number, z: number, sprite: string, size: number, color: number, alpha: number, rot?: number) => void) => void) | null = null;
  sourceId = 0;
  private scorchT = 0;
  constructor(private ctx: Ctx, private player: Player) {
    ctx.scene.add(this.cut.mesh, this.add.mesh);
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }

  // ------------------------------------------------------------------ spawning
  fire(kind: ShotKind, x: number, y: number, z: number, vx: number, vz: number, o: Partial<Shot> = {}) {
    if (this.shots.length > 1400) this.shots.shift();
    const s: Shot = { kind, x, y, z, vx, vy: 0, vz, acc: 0, minSp: 0, maxSp: 60, turn: 0, settle: true, orb: null, delay: 0, life: 7, dmg: 14, grazed: false, spin: rnd.next() * 6, homing: 0, ...o };
    this.shots.push(s);
    return s;
  }
  /** a ring of shots around (cx, cz) that will orbit and expand */
  ring(cx: number, y: number, cz: number, n: number, R: number, vr: number, w: number, o: Partial<Shot> & { gaps?: number[]; gapW?: number; phase?: number; kind?: ShotKind } = {}) {
    const gaps = o.gaps ?? [];
    const gw = o.gapW ?? 1;
    const out: Shot[] = [];
    for (let i = 0; i < n; i++) {
      if (gaps.some((g) => Math.min((((i - g) % n) + n) % n, (((g - i) % n) + n) % n) < gw)) continue;
      const a = (o.phase ?? 0) + (i / n) * Math.PI * 2;
      const s = this.fire(o.kind ?? 'sun', cx + Math.sin(a) * R, y, cz + Math.cos(a) * R, 0, 0, { ...o, orb: { cx, cz, R, vr, w, a } });
      out.push(s);
    }
    return out;
  }
  beam(b: Partial<Beam> & { cx: number; cz: number; ang: number; sweep: number; dur: number }) {
    const B: Beam = { ox: b.cx, oy: 4, oz: b.cz, from: null, len: 34, width: 1.1, t: 0, dmg: 22, scorch: 0, ...b };
    this.beams.push(B);
    return B;
  }
  petal(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, life = 4) {
    if (this.petals.length > 900) this.petals.shift();
    this.petals.push({ x, y, z, vx, vy, vz, rot: rnd.next() * 6.28, rs: (rnd.next() - 0.5) * 5, flip: rnd.next() * 6.28, fs: 4 + rnd.next() * 6, life, max: life, size: 0.16 + rnd.next() * 0.12, sprite: rnd.chance(0.5) ? 'petal' : 'petalB', rest: false });
  }
  mote(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: { life?: number; size?: number; color?: number; sprite?: string; drag?: number; grav?: number } = {}) {
    if (this.motes.length > 2200) this.motes.shift();
    const life = o.life ?? 0.8;
    this.motes.push({ x, y, z, vx, vy, vz, life, max: life, size: o.size ?? 0.18, color: o.color ?? 0xffd070, sprite: o.sprite ?? 'mote', drag: o.drag ?? 1.5, grav: o.grav ?? 0 });
  }
  clear() {
    this.shots.length = 0;
    this.beams.length = 0;
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number, time: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const pc = pl.center(_v.clone());
    this.cut.begin();
    this.add.begin();
    const dmgMul = 0.8;
    // ---- shots
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const q = this.shots[i];
      const L = SHOT[q.kind];
      q.spin += dt * 5;
      if (q.delay > 0) {
        q.delay -= dt;
        if (q.orb) {
          q.orb.a += q.orb.w * dt * 0.3;
          q.x = q.orb.cx + Math.sin(q.orb.a) * q.orb.R;
          q.z = q.orb.cz + Math.cos(q.orb.a) * q.orb.R;
        }
        const pulse = 0.55 + 0.45 * Math.sin(time * 18 + i);
        this.cut.push(q.x, q.y, q.z, q.kind === 'petal' ? 'petal' : 'sunS', L.size * 0.7 * pulse, L.size * 0.7 * pulse, q.spin, 0xffffff, 1);
        this.add.push(q.x, q.y, q.z, 'halo', L.size * 2.2, L.size * 2.2, 0, L.halo, 0.5 * pulse);
        continue;
      }
      q.life -= dt;
      if (q.orb) {
        const o = q.orb;
        o.a += o.w * dt;
        o.R += o.vr * dt;
        const nx = o.cx + Math.sin(o.a) * o.R, nz = o.cz + Math.cos(o.a) * o.R;
        q.vx = (nx - q.x) / Math.max(1e-4, dt);
        q.vz = (nz - q.z) / Math.max(1e-4, dt);
        q.x = nx;
        q.z = nz;
      } else {
        if (q.turn) {
          const c = Math.cos(q.turn * dt), s = Math.sin(q.turn * dt);
          const vx = q.vx * c + q.vz * s, vz = -q.vx * s + q.vz * c;
          q.vx = vx;
          q.vz = vz;
        }
        if (q.homing > 0) {
          const hx = pc.x - q.x, hz = pc.z - q.z;
          const hl = Math.hypot(hx, hz) || 1;
          const sp = Math.hypot(q.vx, q.vz);
          q.vx += ((hx / hl) * sp - q.vx) * q.homing * dt;
          q.vz += ((hz / hl) * sp - q.vz) * q.homing * dt;
        }
        if (q.acc) {
          const sp = Math.hypot(q.vx, q.vz) || 1e-4;
          const ns = Math.min(q.maxSp, Math.max(q.minSp, sp + q.acc * dt));
          q.vx *= ns / sp;
          q.vz *= ns / sp;
        }
        q.x += q.vx * dt;
        q.z += q.vz * dt;
        q.y += q.vy * dt;
      }
      const g = this.ground(q.x, q.z);
      if (q.settle) q.y += (g + 1.05 - q.y) * (1 - Math.exp(-7 * dt));
      else q.vy -= 0;
      let dead = q.life <= 0 || (!q.settle && q.y < g + 0.05);
      if (!dead && pl.alive) {
        const dx = q.x - pc.x, dz = q.z - pc.z, dy = q.y - pc.y;
        const dh = Math.hypot(dx, dz);
        if (dh < L.r + 0.42 && Math.abs(dy) < 1.0 + L.r) {
          const dealt = pl.takeHit({ base: q.dmg * dmgMul, kind: 'magic', source: 'projectile', knock: 1.5 }, new THREE.Vector3(q.x - q.vx * 0.05, q.y, q.z - q.vz * 0.05));
          if (dealt > 0) pl.invuln = Math.max(pl.invuln, 0.45);
          dead = true;
          this.burst(q.x, q.y, q.z, L.halo, 6);
        } else if (!q.grazed && dh < L.r + 1.4 && Math.abs(dy) < 1.6) {
          q.grazed = true;
          ctx.events.emit('graze', q);
        }
      }
      if (dead) {
        this.shots[i] = this.shots[this.shots.length - 1];
        this.shots.pop();
        continue;
      }
      const sp = q.kind === 'ray' ? 0 : q.kind === 'petal' ? q.spin : 0;
      this.cut.push(q.x, q.y, q.z, q.kind, L.size, L.size, sp, 0xffffff, 1, q.vx, q.vy, q.vz, L.stretch);
      this.add.push(q.x, q.y, q.z, 'halo', L.size * 2.4, L.size * 2.4, 0, L.halo, 0.42);
    }
    // ---- beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      if (b.t >= b.dur) {
        this.beams.splice(i, 1);
        continue;
      }
      if (b.from) {
        const f = b.from();
        b.ox = f.x;
        b.oy = f.y;
        b.oz = f.z;
      }
      b.ang += b.sweep * dt;
      const k = Math.min(1, b.t / 0.12) * Math.min(1, (b.dur - b.t) / 0.2);
      const dx = Math.sin(b.ang), dz = Math.cos(b.ang);
      // the shaft from the disc down to the first ground point, then the ground line
      const s0 = 5;
      const gx = b.cx + dx * s0, gz = b.cz + dz * s0, gy = this.ground(gx, gz) + 0.5;
      for (let s = 0; s <= 1.0001; s += 0.08) {
        const x = b.ox + (gx - b.ox) * s, y = b.oy + (gy - b.oy) * s, z = b.oz + (gz - b.oz) * s;
        this.add.push(x, y, z, 'halo', 1.6 * b.width * k, 1.6 * b.width * k, 0, 0xffc860, 0.9);
      }
      for (let s = s0; s < b.len; s += 0.55) {
        const x = b.cx + dx * s, z = b.cz + dz * s;
        const y = this.ground(x, z) + 0.45;
        const fl = 0.75 + 0.25 * Math.sin(time * 40 + s * 3);
        this.add.push(x, y, z, 'halo', 2.1 * b.width * k * fl, 1.6 * b.width * k * fl, 0, 0xffa030, 0.95);
        this.add.push(x, y + 0.1, z, 'halo', 0.9 * b.width * k, 0.9 * b.width * k, 0, 0xfff4d0, 1);
      }
      // sparks and scorch where it hits the sand
      this.scorchT += dt;
      if (this.scorchT > 0.05) {
        this.scorchT = 0;
        const s = s0 + rnd.next() * (b.len - s0);
        const x = b.cx + dx * s, z = b.cz + dz * s, y = this.ground(x, z);
        this.mote(x, y + 0.3, z, (rnd.next() - 0.5) * 3, 3 + rnd.next() * 4, (rnd.next() - 0.5) * 3, { life: 0.6, size: 0.14, color: 0xffb040, sprite: 'ember', grav: 9, drag: 0.6 });
        if (rnd.chance(0.5)) ctx.events.emit('groundMark', x, z, 0.9, 1);
        if (rnd.chance(0.25)) ctx.fx.sandBurst({ x, y, z }, 0.4);
      }
      // damage: within the ground line, low enough
      if (k > 0.5 && pl.alive) {
        const px = pl.pos.x - b.cx, pz = pl.pos.z - b.cz;
        const along = px * dx + pz * dz;
        const across = Math.abs(px * dz - pz * dx);
        const gp = this.ground(pl.pos.x, pl.pos.z);
        if (along > 3 && along < b.len && across < b.width && pl.pos.y < gp + 1.4) {
          pl.takeHit({ base: b.dmg * dmgMul, kind: 'magic', source: 'projectile', knock: 7, status: [{ id: 'burn', stacks: 2, dur: 3 }] }, new THREE.Vector3(b.cx, pl.pos.y, b.cz));
        }
      }
    }
    // ---- petals: tumbling, fluttering, resting on the sand
    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.petals[i] = this.petals[this.petals.length - 1];
        this.petals.pop();
        continue;
      }
      if (!p.rest) {
        p.vx *= Math.exp(-1.6 * dt);
        p.vz *= Math.exp(-1.6 * dt);
        p.vy = Math.max(p.vy - 3 * dt, -1.1);
        p.vy *= Math.exp(-0.6 * dt);
        const fl = Math.sin(time * 2.3 + p.flip) * 0.8;
        p.x += (p.vx + fl) * dt;
        p.z += (p.vz + Math.cos(time * 1.9 + p.flip) * 0.6) * dt;
        p.y += p.vy * dt;
        p.rot += p.rs * dt;
        p.flip += p.fs * dt;
        const g = this.ground(p.x, p.z);
        if (p.y < g + 0.04) {
          p.y = g + 0.04;
          p.rest = true;
          p.life = Math.min(p.life, 2.5);
        }
      }
      const fx = p.rest ? 1 : Math.abs(Math.cos(p.flip));
      const a = Math.min(1, p.life / 0.6);
      if (a < 0.98 && ((i * 7 + Math.floor(time * 30)) & 3) === 0 && a < 0.5) continue;
      this.cut.push(p.x, p.y, p.z, fx < 0.3 ? 'petalE' : p.sprite, p.size * Math.max(0.35, fx), p.size, p.rot, 0xffffff, 1);
    }
    // ---- light motes and embers
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.life -= dt;
      if (m.life <= 0) {
        this.motes[i] = this.motes[this.motes.length - 1];
        this.motes.pop();
        continue;
      }
      m.vx *= Math.exp(-m.drag * dt);
      m.vy = (m.vy - m.grav * dt) * Math.exp(-m.drag * dt);
      m.vz *= Math.exp(-m.drag * dt);
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      const k = m.life / m.max;
      this.add.push(m.x, m.y, m.z, m.sprite, m.size * (0.5 + k * 0.5), m.size * (0.5 + k * 0.5), 0, m.color, Math.min(1, k * 1.5));
    }
    this.onDraw?.((x, y, z, sprite, size, color, alpha, rot = 0) => this.add.push(x, y, z, sprite, size, size, rot, color, alpha));
    this.cut.end(ctx.world.env.fog);
    this.add.end(ctx.world.env.fog);
  }
  /** a small burst of light (shot impact, mirage pop) */
  burst(x: number, y: number, z: number, color = 0xffc060, n = 8) {
    for (let k = 0; k < n; k++) this.mote(x, y, z, (rnd.next() - 0.5) * 6, (rnd.next() - 0.2) * 5, (rnd.next() - 0.5) * 6, { life: 0.4 + rnd.next() * 0.3, size: 0.2, color, sprite: rnd.chance(0.5) ? 'star' : 'mote', drag: 3 });
  }
  dispose() {
    this.cut.dispose();
    this.add.dispose();
    this.shots = [];
    this.beams = [];
    this.petals = [];
    this.motes = [];
  }
}

// ============================================================================ golden scarab swarm
interface Bug {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ph: number;
  turn: number;
  alive: boolean;
}
let SWARM_ID = 980500;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _f = new THREE.Vector3(0, 0, 1);

/** the golden scarabs of "Golden Slumbers": a shootable swarm (each bug pops on a hit) */
export class ScarabSwarm {
  id = SWARM_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.4;
  height = 0.6;
  alive = false;
  isBoss = false;
  hp = 1;
  maxHp = 1;
  name = 'Sun Scarabs';
  flying = true;
  bugs: Bug[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private mat: VoxelMaterial;
  private registered = false;
  onPop: ((x: number, y: number, z: number) => void) | null = null;
  constructor(private ctx: Ctx, private player: Player, geos: [THREE.BufferGeometry, THREE.BufferGeometry], private max = 80) {
    this.mat = makeVoxelMaterial({ emissiveStrength: 1.4 });
    for (const g of geos) {
      const m = new THREE.InstancedMesh(g, this.mat, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      ctx.scene.add(m);
      this.meshes.push(m);
    }
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, turn = 1.4, life = 5.5) {
    if (this.bugs.length >= this.max) return;
    this.bugs.push({ x, y, z, vx, vy, vz, life, ph: rnd.next() * 6.28, turn, alive: true });
  }
  /** the boss registers/unregisters the swarm as a shootable target */
  setRegistered(on: boolean, reg: (t: ScarabSwarm) => void, unreg: (t: ScarabSwarm) => void) {
    if (on && !this.registered) reg(this);
    if (!on && this.registered) unreg(this);
    this.registered = on;
  }
  update(dt: number, time: number) {
    const pc = this.player.center(new THREE.Vector3());
    const counts = [0, 0];
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i];
      b.life -= dt;
      if (b.life <= 0 || !b.alive) {
        if (b.alive && b.life <= 0) this.onPop?.(b.x, b.y, b.z);
        this.bugs[i] = this.bugs[this.bugs.length - 1];
        this.bugs.pop();
        continue;
      }
      // steer toward the hunter with a lazy weave; dive in the last second
      const tx = pc.x - b.x, ty = pc.y + (b.life > 1.5 ? 1.2 : 0) - b.y, tz = pc.z - b.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const k = Math.min(1, b.turn * dt);
      b.vx += ((tx / tl) * sp - b.vx) * k;
      b.vy += ((ty / tl) * sp - b.vy) * k;
      b.vz += ((tz / tl) * sp - b.vz) * k;
      const w = Math.sin(time * 6 + b.ph) * 2.2;
      b.x += (b.vx + (-b.vz / sp) * w) * dt;
      b.y += b.vy * dt + Math.cos(time * 9 + b.ph) * 0.6 * dt;
      b.z += (b.vz + (b.vx / sp) * w) * dt;
      const g = this.ctx.world.groundAt(b.x, b.z);
      if (b.y < g + 0.3) b.y = g + 0.3;
      if (this.player.alive && Math.hypot(b.x - pc.x, b.z - pc.z) < 0.55 && Math.abs(b.y - pc.y) < 0.9) {
        this.player.takeHit({ base: 9, kind: 'magic', source: 'projectile', knock: 2 }, new THREE.Vector3(b.x, b.y, b.z));
        b.alive = false;
        this.onPop?.(b.x, b.y, b.z);
        continue;
      }
      const fr = ((time * 16 + b.ph * 3) % 2) < 1 ? 0 : 1;
      const mesh = this.meshes[fr];
      _p.set(b.x, b.y, b.z);
      _q.setFromUnitVectors(_f, new THREE.Vector3(b.vx, b.vy * 0.4, b.vz).normalize());
      _s.setScalar(1.25);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(counts[fr]++, _m);
      cx += b.x;
      cy += b.y;
      cz += b.z;
      n++;
    }
    for (let f = 0; f < 2; f++) {
      this.meshes[f].count = counts[f];
      this.meshes[f].instanceMatrix.needsUpdate = true;
    }
    this.alive = n > 0;
    if (n) this.pos.set(cx / n, cy / n - 0.3, cz / n);
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    let bt = maxT;
    for (const b of this.bugs) {
      if (!b.alive) continue;
      const ox = o.x - b.x, oy = o.y - b.y, oz = o.z - b.z;
      const bb = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - 0.36 * 0.36;
      const disc = bb * bb - c;
      if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(new THREE.Vector3(b.x, b.y, b.z)).normalize(), headshot: false, part: 'scarab', surface: 'enemy' };
    }
    return best;
  }
  takeDamage(_hit: Hit, point?: THREE.Vector3): number {
    if (!point) return 0;
    let best: Bug | null = null, bd = 1.2;
    for (const b of this.bugs) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - point.x, b.y - point.y, b.z - point.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return 0;
    best.alive = false;
    this.onPop?.(best.x, best.y, best.z);
    this.ctx.fx.number({ x: best.x, y: best.y + 0.4, z: best.z }, 'x', 0xffd060, 0.8);
    return 1;
  }
  clear() {
    this.bugs = [];
  }
  dispose() {
    for (const m of this.meshes) m.removeFromParent();
    this.meshes = [];
    this.mat.dispose();
    this.bugs = [];
  }
}
