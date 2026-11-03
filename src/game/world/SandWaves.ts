// Living sand: transient displacements of the desert floor that the terrain
// renders (vertex shader) AND every ground query feels (World.groundAt /
// normal / slope), so boards ride them, enemies are lifted, props bob.
//   ridge — a travelling dune-wave front (a sand tsunami): steep face ahead,
//           long back slope; the board can surf its back.
//   ring  — a wave expanding from a point (slams, eruptions).
//   mound — a swell rising and falling in place (burrows, pillars, a god
//           breathing under the dunes). Negative height = a sinking pit.
// The same profile math runs on the CPU here and in GLSL (SAND_GLSL), keep
// them in sync.
import * as THREE from 'three';

export type SandKind = 'ridge' | 'ring' | 'mound';

export interface SandShapeOpts {
  kind?: SandKind;
  x: number;
  z: number;
  /** travel direction (ridge), normalised internally */
  dir?: { x: number; z: number };
  /** m/s (ridge / ring) */
  speed?: number;
  /** crest height (m); negative digs a pit */
  height: number;
  /** profile half-thickness (m) */
  width: number;
  /** ridge: half length of the front (m) */
  halfLen?: number;
  /** seconds alive (including rise and fall) */
  life: number;
  rise?: number;
  fall?: number;
  /** seconds before it starts (it still occupies a slot) */
  delay?: number;
  /** spray sand off the crest */
  spray?: boolean;
}

export interface SandShape extends Required<Omit<SandShapeOpts, 'dir'>> {
  dx: number;
  dz: number;
  t: number;
  amp: number;
  travel: number;
  id: number;
}

export const SAND_MAX = 8;

/** profile across the crest: s > 0 is ahead of the crest (steep face) */
function profile(s: number, w: number) {
  const k = s > 0 ? s / (0.55 * w) : s / (1.25 * w);
  return Math.exp(-k * k);
}
function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

let ID = 1;

export class SandWaves {
  shapes: SandShape[] = [];
  /** packed for the terrain shader */
  readonly uA = { value: Array.from({ length: SAND_MAX }, () => new THREE.Vector4()) };
  readonly uB = { value: Array.from({ length: SAND_MAX }, () => new THREE.Vector4()) };
  readonly uN = { value: 0 };
  /** called while a crest sprays: world point, travel dir, strength 0..1 */
  onSpray: ((x: number, y: number, z: number, dx: number, dz: number, k: number) => void) | null = null;
  ground: ((x: number, z: number) => number) | null = null;
  private sprayAcc = 0;

  get n() {
    return this.shapes.length;
  }

  add(o: SandShapeOpts): SandShape {
    const d = o.dir ?? { x: 0, z: 1 };
    const l = Math.hypot(d.x, d.z) || 1;
    const s: SandShape = {
      kind: o.kind ?? 'mound',
      x: o.x,
      z: o.z,
      dx: d.x / l,
      dz: d.z / l,
      speed: o.speed ?? 0,
      height: o.height,
      width: Math.max(0.5, o.width),
      halfLen: o.halfLen ?? 40,
      life: o.life,
      rise: o.rise ?? Math.min(0.8, o.life * 0.25),
      fall: o.fall ?? Math.min(1.2, o.life * 0.3),
      delay: o.delay ?? 0,
      spray: o.spray ?? (o.kind === 'ridge' || o.kind === 'ring'),
      t: -(o.delay ?? 0),
      amp: 0,
      travel: 0,
      id: ID++,
    };
    // full: drop the oldest
    if (this.shapes.length >= SAND_MAX) this.shapes.shift();
    this.shapes.push(s);
    this.pack();
    return s;
  }
  ridge(x: number, z: number, dir: { x: number; z: number }, o: { speed: number; height: number; width: number; halfLen: number; life: number; rise?: number; fall?: number; delay?: number }) {
    return this.add({ kind: 'ridge', x, z, dir, ...o });
  }
  ring(x: number, z: number, o: { speed: number; height: number; width: number; life: number; rise?: number; fall?: number; delay?: number }) {
    return this.add({ kind: 'ring', x, z, ...o });
  }
  mound(x: number, z: number, o: { height: number; width: number; life: number; rise?: number; fall?: number; delay?: number }) {
    return this.add({ kind: 'mound', x, z, ...o });
  }
  remove(s: SandShape) {
    const i = this.shapes.indexOf(s);
    if (i >= 0) this.shapes.splice(i, 1);
    this.pack();
  }
  clear() {
    this.shapes.length = 0;
    this.pack();
  }

  /** extra height at (x, z) */
  offset(x: number, z: number) {
    let h = 0;
    for (const s of this.shapes) {
      if (s.amp === 0) continue;
      const rx = x - s.x,
        rz = z - s.z;
      let f: number;
      if (s.kind === 'ridge') {
        const along = rx * s.dx + rz * s.dz - s.travel;
        if (along > s.width * 2.2 || along < -s.width * 4) continue;
        const lat = Math.abs(-rx * s.dz + rz * s.dx);
        if (lat > s.halfLen) continue;
        f = profile(along, s.width) * smoothstep(s.halfLen, s.halfLen * 0.6, lat);
      } else if (s.kind === 'ring') {
        const r = Math.hypot(rx, rz);
        const ds = r - s.travel;
        if (ds > s.width * 2.2 || ds < -s.width * 4) continue;
        f = profile(ds, s.width) * smoothstep(0, s.width * 1.5, r);
      } else {
        const q2 = (rx * rx + rz * rz) / (s.width * s.width);
        if (q2 > 9) continue;
        f = Math.exp(-q2);
      }
      h += s.amp * f;
    }
    return h;
  }

  /** gradient of offset (central differences) */
  grad(x: number, z: number, out: { x: number; z: number }) {
    const e = 0.35;
    out.x = (this.offset(x + e, z) - this.offset(x - e, z)) / (2 * e);
    out.z = (this.offset(x, z + e) - this.offset(x, z - e)) / (2 * e);
    return out;
  }

  update(dt: number) {
    if (!this.shapes.length) return;
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      s.t += dt;
      if (s.t >= s.life) {
        this.shapes.splice(i, 1);
        continue;
      }
      if (s.t < 0) {
        s.amp = 0;
        continue;
      }
      s.travel = s.speed * s.t;
      const env = smoothstep(0, Math.max(0.01, s.rise), s.t) * (1 - smoothstep(s.life - s.fall, s.life, s.t));
      s.amp = s.height * env;
    }
    this.pack();
    // crest spray: pixel sand blown off the lip of travelling waves
    if (!this.onSpray) return;
    this.sprayAcc += dt;
    if (this.sprayAcc < 1 / 30) return;
    this.sprayAcc = 0;
    for (const s of this.shapes) {
      if (!s.spray || s.amp <= 0.4) continue;
      const k = Math.min(1, s.amp / 6);
      const n = s.kind === 'ridge' ? Math.ceil(2 + k * 6) : Math.ceil(3 + k * 5);
      for (let j = 0; j < n; j++) {
        let px: number, pz: number, dx: number, dz: number;
        if (s.kind === 'ridge') {
          const l = (Math.random() * 2 - 1) * s.halfLen * 0.8;
          px = s.x + s.dx * s.travel - s.dz * l;
          pz = s.z + s.dz * s.travel + s.dx * l;
          dx = s.dx;
          dz = s.dz;
        } else {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a);
          dz = Math.sin(a);
          const r = s.kind === 'ring' ? s.travel : Math.random() * s.width;
          px = s.x + dx * r;
          pz = s.z + dz * r;
        }
        const y = (this.ground ? this.ground(px, pz) : 0) + s.amp * 0.92;
        this.onSpray(px, y, pz, dx, dz, k);
      }
    }
  }

  private pack() {
    const A = this.uA.value,
      B = this.uB.value;
    let n = 0;
    for (const s of this.shapes) {
      if (s.amp === 0) continue;
      A[n].set(s.x, s.z, s.dx, s.dz);
      B[n].set(s.travel, s.amp, s.width, s.kind === 'ridge' ? s.halfLen : s.kind === 'ring' ? -1 : -2);
      n++;
    }
    this.uN.value = n;
  }
}

/** GLSL twin of SandWaves.offset (vertex stage) */
export const SAND_GLSL = /* glsl */ `
uniform vec4 uSWA[${SAND_MAX}];
uniform vec4 uSWB[${SAND_MAX}];
uniform int uSWN;
float swProfile(float s, float w){ float k = s > 0.0 ? s / (0.55 * w) : s / (1.25 * w); return exp(-k * k); }
float sandWave(vec2 p){
  float h = 0.0;
  for (int i = 0; i < ${SAND_MAX}; i++) {
    if (i >= uSWN) break;
    vec4 a = uSWA[i]; vec4 b = uSWB[i];
    vec2 rel = p - a.xy;
    float f;
    if (b.w > 0.0) {
      float along = dot(rel, a.zw) - b.x;
      float lat = abs(dot(rel, vec2(-a.w, a.z)));
      f = swProfile(along, b.z) * smoothstep(b.w, b.w * 0.6, lat);
    } else if (b.w > -1.5) {
      float r = length(rel);
      f = swProfile(r - b.x, b.z) * smoothstep(0.0, b.z * 1.5, r);
    } else {
      float q = length(rel) / b.z;
      f = exp(-q * q);
    }
    h += b.y * f;
  }
  return h;
}
`;
