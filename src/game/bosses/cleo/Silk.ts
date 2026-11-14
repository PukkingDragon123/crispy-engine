// Cleopatra's simulated silk: veils, sleeve streamers, sash ribbons and skirt
// panels on the engine's Verlet cloth, drawn by one instanced renderer of thin
// woven tiles (the game's "high-res blocky cloth") with two extras the shared
// cloth renderer does not have:
//   - sunlight THROUGH the silk: every tile carries its own glow (emissive, caught
//     by the bloom), strongest where the queen's inner light is;
//   - BURNING edges: a burn front eats the silk from its free edges inward, tiles
//     turn to glowing embers, then char, then fall away.
import * as THREE from 'three';
import { Cloth, type ClothOpts } from '../../../engine/physics/Cloth';
import { celify } from '../../../engine/render/VoxelMaterial';
import { hash2 } from '../../../engine/math/rand';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

const lin = (c: number) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
};

export interface SilkLook {
  /** main silk, a second woven tone, the gold hem / edge trim */
  main: number;
  alt: number;
  trim: number;
  /** base inner glow 0..1 and how it falls off toward the free end (0 = even) */
  glow: number;
  glowFall?: number;
  /** 'veil' = woven body with gold side + hem borders; 'ribbon' = solid band with gold edges; 'panel' = sheer pleated panel */
  pattern: 'veil' | 'ribbon' | 'panel';
}

export class Silk {
  cloth: Cloth;
  glow: Float32Array;
  /** per-tile burn 0..1 (0 = whole, 0.5 ember, 0.8 char, 1 gone) */
  burn: Float32Array;
  private burnBias: Float32Array;
  baseCol: Float32Array;
  /** global burn target 0..1 driven by the boss */
  burnLevel = 0;
  glowMul = 1;
  constructor(o: Omit<ClothOpts, 'colors' | 'pattern'>, public look: SilkLook) {
    this.cloth = new Cloth({ ...o, colors: [look.main, look.alt, look.trim], pattern: 'plain', fray: 0 });
    const { w, h } = o;
    const n = (w - 1) * (h - 1);
    this.glow = new Float32Array(n);
    this.burn = new Float32Array(n);
    this.burnBias = new Float32Array(n);
    this.baseCol = new Float32Array(n * 3);
    const M = lin(look.main), A = lin(look.alt), T = lin(look.trim);
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const t = i + j * (w - 1);
        const hs = hash2(i * 13 + 7, j * 31 + 3);
        const v = j / Math.max(1, h - 2), u = i / Math.max(1, w - 2);
        let c = M;
        if (look.pattern === 'veil') {
          if (j === h - 2 || i === 0 || i === w - 2) c = T;
          else if (j === h - 3 && (i & 1)) c = T;
          else if ((i + j * 2) % 5 === 0) c = A;
        } else if (look.pattern === 'ribbon') {
          c = i === 0 || i === w - 2 ? T : j % 6 === 5 ? A : M;
          if (j === h - 2) c = T;
        } else {
          c = (i & 1) ? A : M;
          if (j === h - 2) c = T;
        }
        const jit = 1 + (hs - 0.5) * 0.1;
        this.baseCol[t * 3] = c[0] * jit;
        this.baseCol[t * 3 + 1] = c[1] * jit;
        this.baseCol[t * 3 + 2] = c[2] * jit;
        this.glow[t] = look.glow * (1 - (look.glowFall ?? 0.5) * v) * (c === T ? 0.5 : 1);
        // burn front: free edges (hem, sides) go first, with a ragged noise
        const edge = Math.min(1 - v, Math.min(u, 1 - u) * 1.6);
        this.burnBias[t] = edge * 0.85 + hs * 0.25;
      }
  }
  get anchors() {
    return this.cloth.anchors;
  }
  /** spread the pinned row evenly along a → b */
  pinLine(a: THREE.Vector3, b: THREE.Vector3) {
    const A = this.cloth.anchors;
    const n = A.length;
    for (let i = 0; i < n; i++) A[i].copy(a).lerp(b, n === 1 ? 0.5 : i / (n - 1));
  }
  /** the free end's particles (world) */
  tip(i: number, out: THREE.Vector3) {
    const { w, h } = this.cloth.o;
    const k = Math.min(w - 1, Math.max(0, i)) + (h - 1) * w;
    return out.fromArray(this.cloth.p, k * 3);
  }
  /** particle at column i, row j */
  at(i: number, j: number, out: THREE.Vector3) {
    const w = this.cloth.o.w;
    return out.fromArray(this.cloth.p, (i + j * w) * 3);
  }
  /** advance the burn toward burnLevel */
  tickBurn(dt: number) {
    const L = this.burnLevel;
    for (let t = 0; t < this.burn.length; t++) {
      const target = L <= 0 ? 0 : Math.max(0, Math.min(1, (L - this.burnBias[t]) * 3));
      if (target > this.burn[t]) this.burn[t] = Math.min(target, this.burn[t] + dt * 0.6);
    }
  }
  /** a random tile that is burning right now (centre, world) or null */
  ember(out: THREE.Vector3): boolean {
    const n = this.burn.length;
    for (let tries = 0; tries < 6; tries++) {
      const t = Math.floor(Math.random() * n);
      const b = this.burn[t];
      if (b > 0.05 && b < 0.85) {
        const w = this.cloth.o.w;
        const i = t % (w - 1), j = Math.floor(t / (w - 1));
        this.at(i, j, out);
        return true;
      }
    }
    return false;
  }
  reset() {
    this.cloth.reset();
  }
}

/** one instanced mesh draws all of the queen's silk */
export class SilkRenderer {
  mesh: THREE.InstancedMesh;
  silks: Silk[] = [];
  private colorAttr: THREE.InstancedBufferAttribute;
  private fxAttr: THREE.InstancedBufferAttribute;
  /** global glow multiplier (phase / hit pulses) */
  glow = { value: 1 };
  constructor(scene: THREE.Scene, max = 1600) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const col: number[] = [];
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) {
      const f = Math.abs(nrm.getZ(i)) > 0.5 ? 1 : 0.7;
      col.push(f, f, f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.fxAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.fxAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iSilk', this.fxAttr);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    const glow = this.glow;
    mat.onBeforeCompile = (sh) => {
      celify(sh);
      sh.uniforms.uSilkGlow = glow;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 iSilk;\nvarying vec2 vSilk;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSilk = iSilk;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSilk;\nuniform float uSilkGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSilk.x * uSilkGlow * 1.6 + vec3(1.0, 0.42, 0.08) * vSilk.y * 3.0;');
    };
    mat.customProgramCacheKey = () => 'cleo-silk-v1';
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttr;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  add(s: Silk) {
    this.silks.push(s);
    return s;
  }
  remove(s: Silk) {
    this.silks = this.silks.filter((x) => x !== s);
  }
  update(dt: number, time: number) {
    let o = 0;
    const cap = this.mesh.instanceMatrix.count;
    for (const s of this.silks) {
      const c = s.cloth;
      if (!c.enabled) continue;
      c.step(dt, time);
      s.tickBurn(dt);
      const { w, h } = c.o;
      const P = c.p;
      const th = c.o.thickness ?? 0.018;
      for (let j = 0; j < h - 1; j++)
        for (let i = 0; i < w - 1; i++) {
          const t = i + j * (w - 1);
          const b = s.burn[t];
          if (b >= 0.92 || o >= cap) continue;
          const k00 = i + j * w, k10 = k00 + 1, k01 = k00 + w, k11 = k01 + 1;
          _a.fromArray(P, k00 * 3);
          _b.fromArray(P, k10 * 3);
          _c.fromArray(P, k01 * 3);
          _d.fromArray(P, k11 * 3);
          _x.copy(_b).add(_d).sub(_a).sub(_c).multiplyScalar(0.5);
          _y.copy(_c).add(_d).sub(_a).sub(_b).multiplyScalar(0.5);
          const shrink = b > 0.6 ? 1 - (b - 0.6) * 1.6 : 1;
          const lx = _x.length() * 1.1 * shrink, ly = _y.length() * 1.1 * shrink;
          if (lx < 1e-5 || ly < 1e-5) continue;
          _x.normalize();
          _z.crossVectors(_x, _y).normalize();
          _y.crossVectors(_z, _x).normalize();
          const cx = (_a.x + _b.x + _c.x + _d.x) / 4, cy = (_a.y + _b.y + _c.y + _d.y) / 4, cz = (_a.z + _b.z + _c.z + _d.z) / 4;
          _m.set(_x.x * lx, -_y.x * ly, _z.x * th, cx, _x.y * lx, -_y.y * ly, _z.y * th, cy, _x.z * lx, -_y.z * ly, _z.z * th, cz, 0, 0, 0, 1);
          this.mesh.setMatrixAt(o, _m);
          // whole → ember → char
          let r = s.baseCol[t * 3], g = s.baseCol[t * 3 + 1], bl = s.baseCol[t * 3 + 2];
          let ember = 0;
          if (b > 0.02) {
            const e = Math.min(1, b / 0.5);
            ember = b < 0.7 ? Math.sin(Math.min(1, b / 0.7) * Math.PI) * (0.7 + 0.3 * Math.sin(time * 9 + t)) : 0;
            const ch = Math.max(0, (b - 0.45) / 0.35);
            r = r * (1 - e * 0.4) * (1 - ch) + 0.03 * ch;
            g = g * (1 - e * 0.7) * (1 - ch) + 0.02 * ch;
            bl = bl * (1 - e * 0.9) * (1 - ch) + 0.015 * ch;
          }
          this.colorAttr.setXYZ(o, r, g, bl);
          this.fxAttr.setXY(o, s.glow[t] * s.glowMul * (1 - Math.min(1, b * 2)), ember);
          o++;
        }
    }
    this.mesh.count = o;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.fxAttr.needsUpdate = true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.silks = [];
  }
}
