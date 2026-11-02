// Voxel-chunk debris: break any VoxelModel (cactus, crate, barrel, wall, enemy
// limb) into colored blocky chunks that tumble, bounce on the heightfield,
// settle and sink into the sand. Fully instanced (one draw call).
import * as THREE from 'three';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { rnd } from '../../engine/math/rand';

const MAX = 3000;

export class Debris {
  mesh: THREE.InstancedMesh;
  private n = 0;
  private px = new Float32Array(MAX); private py = new Float32Array(MAX); private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX); private vy = new Float32Array(MAX); private vz = new Float32Array(MAX);
  private ax = new Float32Array(MAX); private ay = new Float32Array(MAX); private az = new Float32Array(MAX);
  private wx = new Float32Array(MAX); private wy = new Float32Array(MAX); private wz = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private rest = new Uint8Array(MAX);
  private cr = new Float32Array(MAX); private cg = new Float32Array(MAX); private cb = new Float32Array(MAX);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  groundAt: (x: number, z: number) => number = () => 0;

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // bake a tiny bevel-ish shading via vertex colors (top lighter)
    const col: number[] = [];
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = y > 0 ? 1.0 : 0.78;
      col.push(f, f, f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /**
   * Shatter a voxel model placed with a world transform. chunk = voxels per chunk side.
   * impulse: center + outward speed; dir adds a directional push (bullet / board).
   */
  shatter(model: VoxelModel, voxelSize: number, transform: THREE.Matrix4, pivot: [number, number, number], opts: { chunk?: number; speed?: number; dir?: { x: number; y: number; z: number }; max?: number; up?: number } = {}) {
    const chunk = opts.chunk ?? 3;
    const groups = new Map<number, { x: number; y: number; z: number; r: number; g: number; b: number; n: number }>();
    model.forEach((x, y, z, rgbv) => {
      const k = ((Math.floor(x / chunk) + 512) << 20) | ((Math.floor(y / chunk) + 512) << 10) | (Math.floor(z / chunk) + 512);
      let gp = groups.get(k);
      if (!gp) groups.set(k, (gp = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, n: 0 }));
      gp.x += x; gp.y += y; gp.z += z;
      gp.r += (rgbv >> 16) & 255; gp.g += (rgbv >> 8) & 255; gp.b += rgbv & 255;
      gp.n++;
    });
    const list = [...groups.values()].filter((g) => g.n >= Math.max(1, chunk * chunk * 0.6));
    const max = opts.max ?? 140;
    const step = Math.max(1, list.length / max);
    const center = new THREE.Vector3().setFromMatrixPosition(transform);
    const speed = opts.speed ?? 5;
    for (let i = 0; i < list.length; i += step) {
      const g = list[Math.floor(i)];
      const lx = (g.x / g.n + 0.5 - pivot[0]) * voxelSize, ly = (g.y / g.n + 0.5 - pivot[1]) * voxelSize, lz = (g.z / g.n + 0.5 - pivot[2]) * voxelSize;
      this.p.set(lx, ly, lz).applyMatrix4(transform);
      const out = this.s.copy(this.p).sub(center);
      out.y = Math.max(0, out.y) * 0.4 + 0.3;
      out.normalize();
      const sz = chunk * voxelSize * (0.85 + rnd.next() * 0.3);
      this.spawn(this.p.x, this.p.y, this.p.z,
        out.x * speed * (0.4 + rnd.next()) + (opts.dir?.x ?? 0),
        out.y * speed * (0.5 + rnd.next()) + (opts.up ?? 2) + (opts.dir?.y ?? 0),
        out.z * speed * (0.4 + rnd.next()) + (opts.dir?.z ?? 0),
        sz, srgb(g.r / g.n), srgb(g.g / g.n), srgb(g.b / g.n));
    }
  }

  /** simple chunk burst (no model): colors list */
  burst(x: number, y: number, z: number, count: number, size: number, colors: number[], speed = 5, up = 3) {
    for (let i = 0; i < count; i++) {
      const c = colors[Math.floor(rnd.next() * colors.length)];
      const a = rnd.next() * Math.PI * 2;
      const s = speed * (0.3 + rnd.next());
      this.spawn(x + (rnd.next() - 0.5) * size * 2, y + rnd.next() * size, z + (rnd.next() - 0.5) * size * 2, Math.cos(a) * s, up * (0.5 + rnd.next()), Math.sin(a) * s, size * (0.6 + rnd.next() * 0.7), srgb((c >> 16) & 255), srgb((c >> 8) & 255), srgb(c & 255));
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, r: number, g: number, b: number) {
    let i = this.n;
    if (i >= MAX) {
      i = Math.floor(rnd.next() * MAX);
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.ax[i] = rnd.next() * 6; this.ay[i] = rnd.next() * 6; this.az[i] = rnd.next() * 6;
    this.wx[i] = (rnd.next() - 0.5) * 14; this.wy[i] = (rnd.next() - 0.5) * 14; this.wz[i] = (rnd.next() - 0.5) * 14;
    this.size[i] = size;
    this.life[i] = 4 + rnd.next() * 3;
    this.rest[i] = 0;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b;
  }

  private kill(i: number) {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.ax[i] = this.ax[l]; this.ay[i] = this.ay[l]; this.az[i] = this.az[l];
    this.wx[i] = this.wx[l]; this.wy[i] = this.wy[l]; this.wz[i] = this.wz[l];
    this.size[i] = this.size[l]; this.life[i] = this.life[l]; this.rest[i] = this.rest[l];
    this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l];
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        i--;
        continue;
      }
      if (!this.rest[i]) {
        this.vy[i] -= 20 * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        this.ax[i] += this.wx[i] * dt;
        this.ay[i] += this.wy[i] * dt;
        this.az[i] += this.wz[i] * dt;
        const g = this.groundAt(this.px[i], this.pz[i]) + this.size[i] * 0.45;
        if (this.py[i] < g) {
          this.py[i] = g;
          if (this.vy[i] < -1.5) {
            this.vy[i] *= -0.32;
            this.vx[i] *= 0.6;
            this.vz[i] *= 0.6;
            this.wx[i] *= 0.5; this.wy[i] *= 0.5; this.wz[i] *= 0.5;
          } else {
            this.vy[i] = 0;
            this.vx[i] *= 0.8;
            this.vz[i] *= 0.8;
            if (Math.abs(this.vx[i]) + Math.abs(this.vz[i]) < 0.3) {
              this.rest[i] = 1;
              // settle flat-ish
              this.ax[i] = Math.round(this.ax[i] / (Math.PI / 2)) * (Math.PI / 2);
              this.az[i] = Math.round(this.az[i] / (Math.PI / 2)) * (Math.PI / 2);
            }
          }
        }
      } else if (this.life[i] < 1.5) {
        // sink into sand
        this.py[i] -= dt * 0.35;
      }
      const sc = this.size[i] * Math.min(1, this.life[i] / 0.6 + 0.0001);
      this.e.set(this.ax[i], this.ay[i], this.az[i]);
      this.q.setFromEuler(this.e);
      this.s.set(sc, sc, sc);
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.c.setRGB(this.cr[i], this.cg[i], this.cb[i]);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

function srgb(v: number) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
