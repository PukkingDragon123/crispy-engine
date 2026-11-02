// Verlet cloth for dusters, ponchos, bandanas, capes, bandage ribbons and flags.
// Simulated in world space (pinned rows follow anchors), collides with body
// spheres and the ground, reacts to wind + airflow from motion. Rendered as
// overlapping blocky fabric tiles (instanced slabs) with woven pixel color
// patterns, seams and frayed hems — "high-res blocky cloth".
import * as THREE from 'three';
import { hash2, noise } from '../math/rand';

export interface ClothOpts {
  w: number; // particles across
  h: number; // particles down
  width: number; // meters
  length: number; // meters
  colors: number[]; // [main, dark, trim]
  thickness?: number;
  stiffness?: number; // 0..1
  damping?: number;
  pattern?: 'duster' | 'poncho' | 'bandana' | 'flag' | 'bandage' | 'cape' | 'plain';
  fray?: number; // fraction of bottom tiles removed/shortened
  /** pin mode: 'top' row pinned (garments) or 'left' column (flags) */
  pin?: 'top' | 'left';
  drag?: number;
  gravity?: number;
}

export interface ClothSphere {
  c: THREE.Vector3;
  r: number;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Cloth {
  n: number;
  p: Float32Array; // current
  q: Float32Array; // previous
  pinned: Uint8Array;
  rest: { a: number; b: number; len: number; k: number }[] = [];
  tileColor: Float32Array;
  tileVisible: Uint8Array;
  tileScaleY: Float32Array;
  /** anchor points (world) for pinned particles, updated by owner each frame */
  anchors: THREE.Vector3[];
  spheres: ClothSphere[] = [];
  groundAt: ((x: number, z: number) => number) | null = null;
  wind = new THREE.Vector3(2, 0, 0);
  enabled = true;
  private initialized = false;

  constructor(public o: ClothOpts) {
    const { w, h } = o;
    this.n = w * h;
    this.p = new Float32Array(this.n * 3);
    this.q = new Float32Array(this.n * 3);
    this.pinned = new Uint8Array(this.n);
    const pinCount = o.pin === 'left' ? h : w;
    this.anchors = Array.from({ length: pinCount }, () => new THREE.Vector3());
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = i + j * w;
        if ((o.pin ?? 'top') === 'top' ? j === 0 : i === 0) this.pinned[k] = 1;
      }
    const dx = o.width / Math.max(1, w - 1), dy = o.length / Math.max(1, h - 1);
    const stiff = o.stiffness ?? 0.9;
    const add = (a: number, b: number, len: number, k: number) => this.rest.push({ a, b, len, k });
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = i + j * w;
        if (i < w - 1) add(k, k + 1, dx, stiff);
        if (j < h - 1) add(k, k + w, dy, stiff);
        if (i < w - 1 && j < h - 1) {
          add(k, k + w + 1, Math.hypot(dx, dy), stiff * 0.6);
          add(k + 1, k + w, Math.hypot(dx, dy), stiff * 0.6);
        }
        if (i < w - 2) add(k, k + 2, dx * 2, stiff * 0.25);
        if (j < h - 2) add(k, k + 2 * w, dy * 2, stiff * 0.25);
      }
    // tiles
    const tiles = (w - 1) * (h - 1);
    this.tileColor = new Float32Array(tiles * 3);
    this.tileVisible = new Uint8Array(tiles).fill(1);
    this.tileScaleY = new Float32Array(tiles).fill(1);
    this.paint();
  }

  get tileCount() {
    return (this.o.w - 1) * (this.o.h - 1);
  }

  private paint() {
    const { w, h, colors } = this.o;
    const lin = (c: number) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
    };
    const main = lin(colors[0]), dark = lin(colors[1] ?? colors[0]), trim = lin(colors[2] ?? colors[1] ?? colors[0]);
    const pat = this.o.pattern ?? 'plain';
    const fray = this.o.fray ?? 0.25;
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const t = i + j * (w - 1);
        const hs = hash2(i * 13 + 7, j * 31 + 3);
        let c = main;
        const lastRow = j === h - 2;
        if (pat === 'duster') {
          if (lastRow || j === h - 3) c = trim; // hem band
          else if ((i + j * 3) % 7 === 0) c = dark; // weave flecks
          if (j === 2) c = dark; // seam
        } else if (pat === 'poncho') {
          const band = Math.floor(j / 2) % 4;
          c = band === 0 ? trim : band === 2 ? dark : main;
          if (band === 0 && (i % 3 === 1)) c = main;
        } else if (pat === 'bandana') {
          c = (i + j) % 3 === 0 ? trim : main;
        } else if (pat === 'flag') {
          c = j < (h - 1) / 2 ? main : dark;
          if (i === 0) c = trim;
        } else if (pat === 'bandage') {
          c = hs > 0.7 ? dark : main;
        } else if (pat === 'cape') {
          c = j % 4 === 3 ? dark : main;
          if (lastRow) c = trim;
        }
        const jit = 1 + (hs - 0.5) * 0.14;
        this.tileColor[t * 3] = c[0] * jit;
        this.tileColor[t * 3 + 1] = c[1] * jit;
        this.tileColor[t * 3 + 2] = c[2] * jit;
        // frayed hem: random missing/shortened tiles on the last rows
        if (lastRow && hs < fray) this.tileVisible[t] = 0;
        else if (lastRow && hs < fray * 2) this.tileScaleY[t] = 0.55;
      }
  }

  /** place all particles hanging from anchors (call once anchors are valid) */
  reset() {
    const { w, h } = this.o;
    const dy = this.o.length / Math.max(1, h - 1);
    const dx = this.o.width / Math.max(1, w - 1);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = i + j * w;
        let x: number, y: number, z: number;
        if ((this.o.pin ?? 'top') === 'top') {
          const a = this.anchors[i];
          x = a.x;
          y = a.y - j * dy;
          z = a.z;
        } else {
          const a = this.anchors[j];
          x = a.x + i * dx;
          y = a.y;
          z = a.z;
        }
        this.p[k * 3] = this.q[k * 3] = x;
        this.p[k * 3 + 1] = this.q[k * 3 + 1] = y;
        this.p[k * 3 + 2] = this.q[k * 3 + 2] = z;
      }
    this.initialized = true;
  }

  step(dt: number, time: number) {
    if (!this.enabled) return;
    if (!this.initialized) this.reset();
    const sub = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90))));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h, time);
  }

  private substep(dt: number, time: number) {
    const { w } = this.o;
    const P = this.p, Q = this.q;
    const damping = this.o.damping ?? 0.985;
    const g = this.o.gravity ?? 9.8;
    const drag = this.o.drag ?? 1.6;
    const dt2 = dt * dt;
    // pins
    const pinTop = (this.o.pin ?? 'top') === 'top';
    for (let k = 0; k < this.n; k++) {
      if (this.pinned[k]) {
        const ai = pinTop ? k % w : Math.floor(k / w);
        const a = this.anchors[ai];
        Q[k * 3] = P[k * 3];
        Q[k * 3 + 1] = P[k * 3 + 1];
        Q[k * 3 + 2] = P[k * 3 + 2];
        P[k * 3] = a.x;
        P[k * 3 + 1] = a.y;
        P[k * 3 + 2] = a.z;
        continue;
      }
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
      const vx = (x - Q[k * 3]) / dt, vy = (y - Q[k * 3 + 1]) / dt, vz = (z - Q[k * 3 + 2]) / dt;
      // wind with gusts + turbulence, airflow drag
      const gust = 0.6 + 0.4 * noise.n2(time * 0.7 + k * 0.01, 3.3);
      const turb = noise.n3(x * 0.8 + time * 2.1, y * 0.8, z * 0.8) * 1.5;
      const wx = this.wind.x * gust + turb, wy = this.wind.y + turb * 0.4, wz = this.wind.z * gust - turb;
      const ax = (wx - vx) * drag, ay = (wy - vy) * drag * 0.5 - g, az = (wz - vz) * drag;
      Q[k * 3] = x;
      Q[k * 3 + 1] = y;
      Q[k * 3 + 2] = z;
      P[k * 3] = x + (x - (x - vx * dt)) * damping + ax * dt2;
      P[k * 3 + 1] = y + vy * dt * damping + ay * dt2;
      P[k * 3 + 2] = z + vz * dt * damping + az * dt2;
    }
    // constraints
    for (let it = 0; it < 4; it++) {
      for (const c of this.rest) {
        const a = c.a * 3, b = c.b * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = ((d - c.len) / d) * c.k;
        const pa = this.pinned[c.a], pb = this.pinned[c.b];
        if (pa && pb) continue;
        const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
        P[a] += dx * diff * wa;
        P[a + 1] += dy * diff * wa;
        P[a + 2] += dz * diff * wa;
        P[b] -= dx * diff * wb;
        P[b + 1] -= dy * diff * wb;
        P[b + 2] -= dz * diff * wb;
      }
      // collisions
      for (let k = 0; k < this.n; k++) {
        if (this.pinned[k]) continue;
        for (const s of this.spheres) {
          const dx = P[k * 3] - s.c.x, dy = P[k * 3 + 1] - s.c.y, dz = P[k * 3 + 2] - s.c.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const r = s.r + 0.02;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 1e-6;
            const f = r / d;
            P[k * 3] = s.c.x + dx * f;
            P[k * 3 + 1] = s.c.y + dy * f;
            P[k * 3 + 2] = s.c.z + dz * f;
          }
        }
        if (this.groundAt) {
          const gy = this.groundAt(P[k * 3], P[k * 3 + 2]) + 0.03;
          if (P[k * 3 + 1] < gy) P[k * 3 + 1] = gy;
        }
      }
    }
  }

  /** write tile matrices into an instanced mesh starting at offset; returns next offset */
  writeTiles(mesh: THREE.InstancedMesh, offset: number, colorAttr: THREE.InstancedBufferAttribute) {
    const { w, h } = this.o;
    const P = this.p;
    const th = this.o.thickness ?? 0.022;
    let o = offset;
    const cap = mesh.instanceMatrix.count;
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const t = i + j * (w - 1);
        if (!this.tileVisible[t] || o >= cap) continue;
        const k00 = i + j * w, k10 = k00 + 1, k01 = k00 + w, k11 = k01 + 1;
        _a.fromArray(P, k00 * 3);
        _b.fromArray(P, k10 * 3);
        _c.fromArray(P, k01 * 3);
        _d.fromArray(P, k11 * 3);
        // basis
        _x.copy(_b).add(_d).sub(_a).sub(_c).multiplyScalar(0.5);
        _y.copy(_c).add(_d).sub(_a).sub(_b).multiplyScalar(0.5);
        const lx = _x.length() * 1.08, ly = _y.length() * 1.08 * this.tileScaleY[t];
        if (lx < 1e-5 || ly < 1e-5) continue;
        _x.normalize();
        _z.crossVectors(_x, _y).normalize();
        _y.crossVectors(_z, _x).normalize();
        const cx = (_a.x + _b.x + _c.x + _d.x) / 4, cy = (_a.y + _b.y + _c.y + _d.y) / 4, cz = (_a.z + _b.z + _c.z + _d.z) / 4;
        const shift = (1 - this.tileScaleY[t]) * 0.5 * ly;
        _m.set(
          _x.x * lx, -_y.x * ly, _z.x * th, cx - _y.x * shift,
          _x.y * lx, -_y.y * ly, _z.y * th, cy - _y.y * shift,
          _x.z * lx, -_y.z * ly, _z.z * th, cz - _y.z * shift,
          0, 0, 0, 1
        );
        mesh.setMatrixAt(o, _m);
        colorAttr.setXYZ(o, this.tileColor[t * 3], this.tileColor[t * 3 + 1], this.tileColor[t * 3 + 2]);
        o++;
      }
    return o;
  }
}

/** One instanced mesh renders every cloth in a scene */
export class ClothRenderer {
  mesh: THREE.InstancedMesh;
  cloths: Cloth[] = [];
  private colorAttr: THREE.InstancedBufferAttribute;
  constructor(max = 2400) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // subtle bevel shading: darken side faces
    const col: number[] = [];
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) {
      const f = Math.abs(nrm.getZ(i)) > 0.5 ? 1 : 0.72;
      col.push(f, f, f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttr;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  add(c: Cloth) {
    this.cloths.push(c);
    return c;
  }
  remove(c: Cloth) {
    this.cloths = this.cloths.filter((x) => x !== c);
  }
  update(dt: number, time: number) {
    let o = 0;
    for (const c of this.cloths) {
      if (!c.enabled) continue;
      c.step(dt, time);
      o = c.writeTiles(this.mesh, o, this.colorAttr);
    }
    this.mesh.count = o;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
