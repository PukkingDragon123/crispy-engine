// Secondary motion for rigged hair locks (Sundown's scraggly hair). Each lock is a
// chain of parts (root -> tip) that hangs from the head. Every frame each segment
// springs toward the direction an effective "down" pulls it, measured in its
// parent's frame: gravity, minus the head's acceleration (inertia), plus the airflow
// of riding (hair streams back at speed) and a little breeze. Segments lag their
// parents, so the motion whips down the chain.
//
// installHairSway(rig) makes it self-driving: the tick runs from the hair meshes'
// onBeforeRender (once per frame, before the meshes take their matrices), so no
// scene has to call anything per frame. The chains come from rig spec
// meta.hair.chains; rigs without hair are left alone.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';

export interface HairChain {
  /** part names, root first; each part's parent is the previous one (the root's is the head) */
  parts: string[];
  /** rotation limits of every segment, radians: [minX, maxX, minZ, maxZ]
   *  (+X swings the tips back, toward -Z; +Z swings them toward +X, the character's left) */
  lim: [number, number, number, number];
  /** spring stiffness (1/s^2) of the root; tips are softer */
  stiff?: number;
  /** damping ratio (default 0.42) */
  zeta?: number;
  /** breeze phase, so locks do not move in unison */
  phase?: number;
}

const G = 9.8;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

interface Seg {
  node: THREE.Object3D;
  x: number;
  z: number;
  vx: number;
  vz: number;
  k: number;
  c: number;
}

export class HairSway {
  private chains: { segs: Seg[]; lim: [number, number, number, number]; phase: number }[] = [];
  private head: THREE.Object3D | null;
  private last = -1;
  private t = 0;
  private prev = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private primed = false;
  /** multiplies the airflow streaming (riding wind) */
  wind = 1;

  constructor(private rig: RigInstance, specs: HairChain[]) {
    this.head = rig.nodes['head'] ?? null;
    for (const s of specs) {
      const segs: Seg[] = [];
      s.parts.forEach((n, i) => {
        const node = rig.nodes[n];
        if (!node) return;
        const k = (s.stiff ?? 110) * Math.pow(0.62, i);
        const zeta = s.zeta ?? 0.42;
        segs.push({ node, x: 0, z: 0, vx: 0, vz: 0, k, c: 2 * zeta * Math.sqrt(k) });
      });
      if (segs.length) this.chains.push({ segs, lim: s.lim, phase: s.phase ?? 0 });
    }
  }

  /** advance the springs by the real time since the last tick and pose the hair */
  tick(now = performance.now()) {
    const head = this.head;
    if (!head || !this.chains.length) return;
    let dt = this.last < 0 ? 0 : (now - this.last) / 1000;
    if (this.last >= 0 && dt < 0.002) return; // another render pass in the same frame
    this.last = now;
    dt = Math.min(dt, 1 / 20);
    this.t += dt;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(_p);
    if (!this.primed || dt <= 0) {
      this.prev.copy(_p);
      this.primed = true;
    } else {
      const raw = _v.copy(_p).sub(this.prev).divideScalar(dt);
      this.prev.copy(_p);
      const kv = 1 - Math.exp(-dt * 18);
      const oldVx = this.vel.x, oldVy = this.vel.y, oldVz = this.vel.z;
      this.vel.lerp(raw, kv);
      _d.set((this.vel.x - oldVx) / dt, (this.vel.y - oldVy) / dt, (this.vel.z - oldVz) / dt);
      this.acc.lerp(_d.clampLength(0, 60), 1 - Math.exp(-dt * 12));
    }
    const t = this.t;
    for (const ch of this.chains) {
      // effective pull in world space: gravity, inertia, riding airflow, breeze
      const ph = ch.phase;
      const bx = Math.sin(t * 1.3 + ph) * 0.9 + Math.sin(t * 2.9 + ph * 1.7) * 0.35;
      const bz = Math.sin(t * 1.7 + 1 + ph) * 0.7 + Math.sin(t * 3.7 + ph) * 0.25;
      const sp = this.vel.length();
      const air = this.wind * 0.55 * Math.min(sp, 30);
      _d.set(-this.acc.x * 0.55 + bx, -G - this.acc.y * 0.4, -this.acc.z * 0.55 + bz);
      if (sp > 0.01) _d.addScaledVector(this.vel, -air / sp);
      const [mnX, mxX, mnZ, mxZ] = ch.lim;
      for (let i = 0; i < ch.segs.length; i++) {
        const s = ch.segs[i];
        const parent = s.node.parent;
        if (!parent) continue;
        // pull direction in the parent's frame -> the rotation that would hang the segment along it
        parent.getWorldQuaternion(_q).invert();
        const dl = _v.copy(_d).applyQuaternion(_q).normalize();
        const tz = Math.asin(Math.max(-1, Math.min(1, dl.x)));
        const tx = Math.atan2(-dl.z, -dl.y);
        const k = s.k, c = s.c;
        s.vx += (k * (tx * 0.9 - s.x) - c * s.vx) * dt;
        s.vz += (k * (tz * 0.9 - s.z) - c * s.vz) * dt;
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        const lx = i ? 0.7 : 1, lo = (v: number) => v * lx;
        if (s.x < lo(mnX)) (s.x = lo(mnX)), (s.vx = Math.max(0, s.vx));
        if (s.x > lo(mxX)) (s.x = lo(mxX)), (s.vx = Math.min(0, s.vx));
        if (s.z < lo(mnZ)) (s.z = lo(mnZ)), (s.vz = Math.max(0, s.vz));
        if (s.z > lo(mxZ)) (s.z = lo(mxZ)), (s.vz = Math.min(0, s.vz));
        s.node.rotation.set(s.x, 0, s.z);
        s.node.updateMatrixWorld(true);
      }
    }
  }

  /** settle the hair straight down (cuts, teleports) */
  reset() {
    for (const ch of this.chains)
      for (const s of ch.segs) {
        s.x = s.z = s.vx = s.vz = 0;
        s.node.rotation.set(0, 0, 0);
      }
    this.primed = false;
    this.vel.set(0, 0, 0);
    this.acc.set(0, 0, 0);
  }
}

const installed = new WeakMap<RigInstance, HairSway>();

/**
 * Make a rig's hair sway on its own (idempotent). Returns the controller, or null when the
 * rig has no `meta.hair` chains. Safe to call on any rig.
 */
export function installHairSway(rig: RigInstance): HairSway | null {
  const have = installed.get(rig);
  if (have) return have;
  const chains = rig.geo.spec.meta?.hair?.chains as HairChain[] | undefined;
  if (!chains?.length) return null;
  const sway = new HairSway(rig, chains);
  installed.set(rig, sway);
  const hook = () => sway.tick();
  for (const ch of chains)
    for (const n of ch.parts) {
      const m = rig.meshes[n];
      if (m) m.onBeforeRender = hook;
    }
  return sway;
}

/** the controller installed on a rig, if any */
export const hairSwayOf = (rig: RigInstance) => installed.get(rig) ?? null;
