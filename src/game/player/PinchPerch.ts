// Pinch lives on Sundown. A small behaviour state machine that keeps him somewhere on the hunter
// (and scaled to a real scorpion's size) whenever he is not off on an errand:
//   hat      on top of the crown, looking around (clinging when the ride gets rough)
//   (inside) tucked under the back of the brim, out of sight: where he bolts when Sundown is hit
//            or the board is flying, and where he climbs out of again once it is calm
//   eyeR     in the bare skull socket, claws and the point of his tail peeking out (idle, after kills)
//   eyeL     on the living brow, peering down over the shades
//   shoulder on the torn sleeve stump
// Between perches he scuttles along a little graph of waypoints over the head, the brim, the
// temples, the jaw and the neck (tetrapod gait from PinchMotion), every waypoint expressed in the
// frame of a bone so the route rides along with the animation.
//
// Anchors: Sundown's head bone carries empty Object3Ds named `perch_hat`, `perch_eyeL`, `perch_eyeR`
// (looked up by name); without them the rig sockets hat_top / eye_l / eye_r / shoulder_l stand in,
// and without those the head bone plus fixed offsets.
//
// Errands (the sting leap, the reload hop) are driven by their owner: `update(dt, { away: true, mode })`
// only animates; `homeWorld()` is where to come back to; `land()` snaps him back onto the perch.
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';
import type { EventBus } from '../Ctx';
import { PinchMotion, PinchMode } from './PinchMotion';

export type PerchId = 'hat' | 'eyeL' | 'eyeR' | 'shoulder';
type Spot = PerchId | 'hatIn';
type WP = Spot | 'crownL' | 'crownR' | 'crownB' | 'brimL' | 'brimR' | 'brimB' | 'lipL' | 'lipR' | 'templeL' | 'templeR' | 'bridge' | 'jawL' | 'neckL' | 'here';

/** Pinch's scale while he lives on Sundown (rig scale 1 is ~0.55 m long; this makes him ~15 cm, tail and claws included) */
export const PINCH_PERCH_SCALE = 0.27;

export interface PerchHost {
  root: THREE.Object3D;
  nodes: Record<string, THREE.Object3D>;
  sockets: Record<string, THREE.Object3D>;
}
export interface PerchDrive {
  /** Sundown is standing about (eye peeks, grooming, long dozes) */
  idle?: boolean;
  /** riding speed 0..1 of the board's top speed (fast riding sends him into the hat) */
  speed01?: number;
  /** on an errand: animate only, the owner places him */
  away?: boolean;
  /** the motion mode while away (leap, sting, reload) */
  mode?: PinchMode;
  alert?: number;
}

const EDGES: [WP, WP][] = [
  ['hat', 'crownL'], ['hat', 'crownR'], ['hat', 'crownB'],
  ['crownL', 'brimL'], ['crownR', 'brimR'], ['crownB', 'brimB'], ['brimB', 'hatIn'],
  ['brimL', 'lipL'], ['brimR', 'lipR'], ['lipL', 'templeL'], ['lipR', 'templeR'],
  ['templeL', 'eyeL'], ['templeR', 'eyeR'], ['eyeL', 'bridge'], ['bridge', 'eyeR'],
  ['templeL', 'jawL'], ['eyeL', 'jawL'], ['jawL', 'neckL'], ['neckL', 'shoulder'],
];
const ADJ = new Map<WP, WP[]>();
for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, []);
  if (!ADJ.has(b)) ADJ.set(b, []);
  ADJ.get(a)!.push(b);
  ADJ.get(b)!.push(a);
}
function bfs(from: WP, to: WP): WP[] {
  const prev = new Map<WP, WP | null>([[from, null]]);
  const q: WP[] = [from];
  while (q.length) {
    const c = q.shift()!;
    if (c === to) break;
    for (const nb of ADJ.get(c) ?? []) if (!prev.has(nb)) (prev.set(nb, c), q.push(nb));
  }
  if (!prev.has(to)) return [from, to];
  const out: WP[] = [];
  for (let c: WP | null = to; c; c = prev.get(c) ?? null) out.unshift(c);
  return out;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Pt {
  frame: THREE.Object3D;
  p: THREE.Vector3; // frame-local
  n: THREE.Vector3; // frame-local surface normal
}

export class PinchPerch {
  readonly motion: PinchMotion;
  /** where he is (or is heading) */
  spot: Spot;
  private host!: PerchHost;
  private head: THREE.Object3D | null = null;
  private torso: THREE.Object3D | null = null;
  private anchors: Partial<Record<'hat' | 'eyeL' | 'eyeR' | 'shoulder', THREE.Object3D>> = {};
  private hatBox: THREE.Box3 | null = null;
  private route: Pt[] | null = null;
  private routeS = 0;
  private routeLen = 0;
  private routeTo: Spot = 'hat';
  private routeQ0 = new THREE.Quaternion();
  private dwell = rnd(3, 6);
  private danger = 0;
  private fast = 0;
  private calm = 0;
  private eyeKick = false;
  private killCd = 0;
  private idleT = 0;
  private offs: (() => void)[] = [];
  private posW = new THREE.Vector3();
  private quatW = new THREE.Quaternion();
  private scaleW = 1;
  private here: Pt | null = null;

  constructor(
    public rig: RigInstance,
    host: PerchHost,
    /** the object placed on the perch (the rig root, or a holder around it) */
    public obj: THREE.Object3D = rig.root,
    opts: { start?: PerchId; events?: EventBus | null; scale?: number; expressions?: boolean } = {},
  ) {
    this.motion = new PinchMotion(rig);
    this.spot = opts.start ?? 'shoulder';
    this.scale = opts.scale ?? PINCH_PERCH_SCALE;
    this.expressions = opts.expressions ?? true;
    this.setHost(host);
    const ev = opts.events;
    if (ev) {
      this.offs.push(ev.on('playerHurt', () => this.hurt()));
      this.offs.push(ev.on('enemyKilled', () => this.kill()));
    }
  }
  scale: number;
  expressions: boolean;

  /** (re)bind to a Sundown rig (after a look change rebuilt him) */
  setHost(host: PerchHost) {
    this.host = host;
    this.head = host.nodes['head'] ?? null;
    this.torso = host.nodes['torso'] ?? host.nodes['pelvis'] ?? null;
    const by = (n: string) => host.root.getObjectByName(n) ?? null;
    this.anchors = {
      hat: by('perch_hat') ?? host.sockets['hat_top'] ?? host.sockets['head_top'] ?? undefined,
      eyeR: by('perch_eyeR') ?? host.sockets['eye_r'] ?? undefined,
      eyeL: by('perch_eyeL') ?? host.sockets['eye_l'] ?? undefined,
      shoulder: host.sockets['shoulder_l'] ?? undefined,
    };
    // the hat's extent in head space: the brim edge and the back of the crown for the routes
    this.hatBox = null;
    const hat = host.nodes['hat'];
    const mesh = hat?.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    if (hat && mesh && this.head) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      this.head.updateWorldMatrix(true, true);
      _m.copy(this.head.matrixWorld).invert().multiply(mesh.matrixWorld);
      this.hatBox = g.boundingBox!.clone().applyMatrix4(_m);
    }
    this.route = null;
  }

  /** Sundown got hit: into the hat */
  hurt() {
    this.danger = 3.5;
  }
  /** a kill: now and then he pops out to the eye socket to look */
  kill() {
    if (this.killCd > 0) return;
    this.killCd = 6;
    if (Math.random() < 0.35) this.eyeKick = true;
  }
  /** jump to a perch at once (no scuttle) */
  place(id: PerchId) {
    this.spot = id;
    this.route = null;
    this.dwell = rnd(4, 9);
  }
  /** back from an errand: settle on the perch he was heading for */
  land() {
    this.route = null;
    if (this.danger > 0) this.spot = 'hatIn';
    this.dwell = rnd(3, 7);
  }
  get hidden() {
    return this.spot === 'hatIn' && !this.route;
  }

  /** world position of the perch he belongs on right now (the end of the current scuttle) */
  homeWorld(out = new THREE.Vector3()) {
    const s = this.route ? this.routeTo : this.spot;
    const pt = this.spotPt(s);
    return pt ? this.toWorld(pt, out) : this.host.root.getWorldPosition(out).add(_v.set(0, 1.5, 0));
  }
  /** Pinch's world scale on the perch */
  homeScale() {
    const f = this.head ?? this.host.root;
    f.getWorldScale(_s);
    return this.scale * _s.x;
  }

  update(dt: number, d: PerchDrive = {}) {
    dt = Math.min(dt, 0.1);
    this.killCd -= dt;
    this.danger -= dt;
    const sp = d.speed01 ?? 0;
    this.fast = sp > 0.8 ? Math.min(1.5, this.fast + dt) : sp < 0.6 ? Math.max(0, this.fast - dt * 0.6) : this.fast;
    const scared = this.danger > 0 || this.fast > 0.6;
    this.calm = scared ? 0 : this.calm + dt;
    this.idleT = d.idle ? this.idleT + dt : 0;
    if (d.away) {
      this.rig.root.visible = true;
      this.motion.update(dt, { mode: d.mode ?? 'leap', alert: d.alert ?? 0.5, fidget: false });
      return;
    }
    if (!this.head && !this.torso) {
      this.motion.update(dt, { mode: 'idle' });
      return;
    }
    this.head?.updateWorldMatrix(true, false);
    this.torso?.updateWorldMatrix(true, false);
    // ---- decide
    if (!this.route) {
      this.dwell -= dt;
      if (scared && this.spot !== 'hatIn') this.go('hatIn');
      else if (!scared && this.spot === 'hatIn' && this.calm > 2.5) this.go(d.idle ? 'eyeR' : 'hat');
      else if (!scared && this.eyeKick && this.spot !== 'eyeR') {
        this.eyeKick = false;
        this.go('eyeR');
      } else if (!scared && this.dwell <= 0 && this.spot !== 'hatIn') this.go(this.pick(!!d.idle));
    } else if (scared && this.routeTo !== 'hatIn') this.go('hatIn');
    this.eyeKick = this.eyeKick && !scared;
    // ---- place
    let mode: PinchMode = 'idle';
    let speed = 0;
    let hidden = false;
    const scaleW = this.homeScale();
    if (this.route) {
      const v = 0.34 * scaleW / this.scale; // m/s at the host's scale
      this.routeS += v * dt;
      this.walkRoute(this.routeS);
      speed = v / Math.max(0.01, scaleW * (this.rig.geo.spec.meta?.length ?? 0.65));
      mode = 'idle';
      if (this.routeS >= this.routeLen) {
        this.spot = this.routeTo;
        this.route = null;
        this.dwell = this.dwellFor(this.spot, !!d.idle);
        this.arrive(this.spot);
      }
    }
    if (!this.route) {
      const pt = this.spotPt(this.spot);
      if (pt) {
        this.toWorld(pt, this.posW);
        this.spotQuat(this.spot, this.quatW);
      }
      hidden = this.spot === 'hatIn';
      mode = this.spotMode(this.spot, d);
    }
    this.scaleW = scaleW;
    this.apply();
    this.rig.root.visible = !hidden;
    this.motion.update(dt, { mode, speed, alert: (d.alert ?? 0) + (this.spot === 'eyeR' && !this.route ? 0.15 : 0), fidget: !hidden });
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }

  // ------------------------------------------------------------------ internals
  private pick(idle: boolean): PerchId {
    const w: [PerchId, number][] = idle
      ? [['eyeR', 0.42], ['hat', 0.24], ['eyeL', 0.14], ['shoulder', 0.2]]
      : [['hat', 0.42], ['shoulder', 0.42], ['eyeR', 0.1], ['eyeL', 0.06]];
    const opts = w.filter(([id]) => id !== this.spot && this.spotPt(id));
    let r = Math.random() * opts.reduce((a, [, x]) => a + x, 0);
    for (const [id, x] of opts) if ((r -= x) <= 0) return id;
    return opts[0]?.[0] ?? 'shoulder';
  }
  private dwellFor(s: Spot, idle: boolean) {
    if (s === 'eyeR' || s === 'eyeL') return rnd(4.5, 9);
    if (s === 'hat') return rnd(6, 14);
    if (s === 'shoulder') return idle ? rnd(9, 22) : rnd(6, 14);
    return 3;
  }
  private spotMode(s: Spot, d: PerchDrive): PinchMode {
    if (s === 'hatIn') return 'hide';
    if (s === 'eyeR' || s === 'eyeL') return 'peek';
    const rough = (d.speed01 ?? 0) > 0.35;
    if (s === 'hat') return rough ? 'cling' : 'peek';
    if (rough) return 'cling';
    return this.idleT > 25 && this.dwell > 4 ? 'sleep' : 'idle';
  }
  private arrive(s: Spot) {
    if (!this.expressions) return;
    if (s === 'eyeR' || s === 'eyeL') this.rig.setExpression(Math.random() < 0.4 ? 'happy' : 'neutral');
    else if (s === 'hatIn') this.rig.setExpression('surprised');
    else this.rig.setExpression('neutral');
    if (s === 'eyeR') this.motion.snap();
  }

  /** scuttle over to a perch now */
  moveTo(id: PerchId | 'hatIn') {
    this.go(id);
  }
  /** start a scuttle from wherever he is now to `to` */
  private go(to: Spot) {
    if (!this.head) {
      this.spot = to;
      return;
    }
    let path: WP[];
    if (this.route) {
      // re-route mid-scuttle: from the current point, via the nearest waypoint
      this.here = { frame: this.head, p: this.head.worldToLocal(this.posW.clone()), n: UPV.clone() };
      let best: WP = 'hat', bd = 1e9;
      for (const wp of ADJ.keys()) {
        const pt = this.wp(wp);
        if (!pt) continue;
        const dd = this.toWorld(pt, _v).distanceToSquared(this.posW);
        if (dd < bd) (bd = dd), (best = wp);
      }
      path = ['here', ...bfs(best, to)];
    } else path = bfs(this.spot, to);
    const pts = path.map((w) => this.wp(w)).filter((p): p is Pt => !!p);
    if (pts.length < 2) {
      this.spot = to;
      this.route = null;
      return;
    }
    this.route = pts;
    this.routeTo = to;
    this.routeS = 0;
    this.routeQ0.copy(this.quatW);
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += this.toWorld(pts[i], _v).distanceTo(this.toWorld(pts[i - 1], _v2));
    this.routeLen = Math.max(0.02, L);
    if (this.expressions && to === 'hatIn') this.rig.setExpression('surprised');
  }

  /** place along the route at arc length s (positions re-evaluated live in their bone frames) */
  private walkRoute(s: number) {
    const pts = this.route!;
    const W = pts.map((p) => this.toWorld(p, new THREE.Vector3()));
    let acc = 0, i = 1;
    for (; i < W.length; i++) {
      const L = W[i].distanceTo(W[i - 1]);
      if (acc + L >= s || i === W.length - 1) break;
      acc += L;
    }
    i = Math.min(i, W.length - 1);
    const L = Math.max(1e-5, W[i].distanceTo(W[i - 1]));
    const t = Math.min(1, Math.max(0, (s - acc) / L));
    this.posW.lerpVectors(W[i - 1], W[i], t);
    // a little arch off the surface so he never sinks into skin or felt
    const nA = this.normalW(pts[i - 1], new THREE.Vector3()), nB = this.normalW(pts[i], new THREE.Vector3());
    const nrm = nA.lerp(nB, t).normalize();
    this.posW.addScaledVector(nrm, Math.sin(t * Math.PI) * 0.006 * (this.homeScale() / this.scale));
    // heading: along the segment, standing on the surface
    const fwd = _v.subVectors(W[i], W[i - 1]).normalize();
    fwd.addScaledVector(nrm, -fwd.dot(nrm));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const x = _v2.crossVectors(nrm, fwd).normalize();
    _m.makeBasis(x, nrm, fwd);
    _q.setFromRotationMatrix(_m);
    // ease out of the start pose and into the perch pose
    const u = s / this.routeLen;
    if (u < 0.15) _q.slerpQuaternions(this.routeQ0, _q.clone(), u / 0.15);
    else if (u > 0.85) {
      this.spotQuat(this.routeTo, _q2);
      _q.slerp(_q2, (u - 0.85) / 0.15);
    }
    this.quatW.copy(_q);
  }

  private apply() {
    const o = this.obj;
    _s.setScalar(this.scaleW);
    _m.compose(this.posW, this.quatW, _s);
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false);
      _m2.copy(o.parent.matrixWorld).invert().multiply(_m);
      _m2.decompose(o.position, o.quaternion, o.scale);
    } else _m.decompose(o.position, o.quaternion, o.scale);
  }

  private toWorld(pt: Pt, out: THREE.Vector3) {
    return pt.frame.localToWorld(out.copy(pt.p));
  }
  private normalW(pt: Pt, out: THREE.Vector3) {
    pt.frame.getWorldQuaternion(_q2);
    return out.copy(pt.n).applyQuaternion(_q2).normalize();
  }
  /** an anchor's position in a frame's local space */
  private local(frame: THREE.Object3D, a: THREE.Object3D | undefined, fallback: THREE.Vector3) {
    if (!a) return fallback.clone();
    a.updateWorldMatrix(true, false);
    return frame.worldToLocal(a.getWorldPosition(new THREE.Vector3()));
  }

  /** head-space landmarks, recomputed from the anchors (so a re-proportioned Sundown still fits) */
  private geo() {
    const h = this.head!;
    const eR = this.local(h, this.anchors.eyeR, new THREE.Vector3(-0.044, 0.105, 0.09));
    const eL = this.local(h, this.anchors.eyeL, new THREE.Vector3(0.044, 0.105, 0.09));
    const hat = this.local(h, this.anchors.hat, new THREE.Vector3(0, 0.29, -0.01));
    const hc = new THREE.Vector3(0, (eR.y + eL.y) / 2 + 0.012, (eR.z + eL.z) / 2 - 0.088);
    const R = Math.max(0.07, Math.hypot(eR.x, eR.z - hc.z) * 1.02);
    const hb = this.hatBox;
    const brimY = hb ? hb.min.y + 0.012 : hc.y + 0.075;
    const brimX = hb ? Math.max(-hb.min.x, hb.max.x) * 0.9 : R + 0.05;
    const brimZ = hb ? hb.min.z * 0.9 : hc.z - R - 0.04;
    return { eR, eL, hat, hc, R, brimY, brimX, brimZ };
  }
  private spotPt(s: Spot): Pt | null {
    return this.wp(s);
  }
  private wp(w: WP): Pt | null {
    if (w === 'here') return this.here;
    if (w === 'shoulder') {
      const f = this.torso;
      if (!f) return null;
      const p = this.local(f, this.anchors.shoulder, new THREE.Vector3(0.16, 0.42, 0));
      return { frame: f, p: p.add(_v.set(0, 0.004, 0)), n: UPV.clone() };
    }
    if (w === 'neckL') {
      const f = this.torso;
      if (!f) return null;
      const p = this.local(f, this.anchors.shoulder, new THREE.Vector3(0.16, 0.42, 0)).add(_v.set(-0.07, 0.075, 0.015));
      return { frame: f, p, n: new THREE.Vector3(0.6, 0.6, 0.3).normalize() };
    }
    const h = this.head;
    if (!h) return null;
    const g = this.geo();
    const out = (p: THREE.Vector3) => ({ frame: h, p, n: p.clone().sub(g.hc).normalize() });
    switch (w) {
      case 'hat':
        return { frame: h, p: g.hat.clone(), n: UPV.clone() };
      case 'crownL':
      case 'crownR': {
        const s = w === 'crownL' ? 1 : -1;
        return { frame: h, p: g.hat.clone().add(_v.set(s * 0.045, -0.035, 0)), n: new THREE.Vector3(s, 0.4, 0).normalize() };
      }
      case 'crownB':
        return { frame: h, p: g.hat.clone().add(_v.set(0, -0.035, -0.05)), n: new THREE.Vector3(0, 0.4, -1).normalize() };
      case 'brimL':
      case 'brimR': {
        const s = w === 'brimL' ? 1 : -1;
        return { frame: h, p: new THREE.Vector3(s * g.brimX * 0.85, g.brimY + 0.01, g.hc.z), n: UPV.clone() };
      }
      case 'brimB':
        return { frame: h, p: new THREE.Vector3(0, g.brimY + 0.01, g.brimZ), n: UPV.clone() };
      case 'lipL':
      case 'lipR': {
        const s = w === 'lipL' ? 1 : -1;
        return { frame: h, p: new THREE.Vector3(s * (g.brimX * 0.85 + 0.006), g.brimY - 0.012, g.hc.z), n: new THREE.Vector3(s, -0.3, 0).normalize() };
      }
      case 'hatIn':
        return { frame: h, p: new THREE.Vector3(0, g.brimY - 0.03, g.hc.z - g.R * 0.8), n: new THREE.Vector3(0, 0, -1) };
      case 'templeL':
      case 'templeR': {
        const s = w === 'templeL' ? 1 : -1;
        return out(g.hc.clone().add(_v.set(s, 0.3, 0.35).normalize().multiplyScalar(g.R * 1.03)));
      }
      case 'eyeR':
        // tucked in the bare socket behind the cracked lens, front half poking out past its outer rim
        return { frame: h, p: g.eR.clone().add(_v.set(-0.006, -0.016, -0.004)), n: new THREE.Vector3(-0.6, 0.3, 0.7).normalize() };
      case 'eyeL':
        return { frame: h, p: g.eL.clone().add(_v.set(0.012, 0.032, 0.002)), n: new THREE.Vector3(0.2, 1, 0.4).normalize() };
      case 'bridge':
        return out(new THREE.Vector3(0, (g.eR.y + g.eL.y) / 2 + 0.034, (g.eR.z + g.eL.z) / 2 + 0.006));
      case 'jawL':
        return out(g.hc.clone().add(_v.set(0.8, -0.75, 0.25).normalize().multiplyScalar(g.R * 1.05)));
    }
    return null;
  }
  /** the perch pose (world) for a spot */
  private spotQuat(s: Spot, out: THREE.Quaternion) {
    const f = s === 'shoulder' ? this.torso : this.head;
    if (!f) return out.identity();
    f.getWorldQuaternion(out);
    // yaw, pitch (positive: nose down), roll in the bone's frame
    const [yaw, pitch, roll] =
      s === 'eyeR' ? [-1.2, 0.1, 0.1] : s === 'eyeL' ? [-0.3, 0.55, -0.12] : s === 'shoulder' ? [0.3, 0, 0] : s === 'hatIn' ? [Math.PI, 0.4, 0] : [0, 0, 0];
    _e.set(pitch, yaw, roll, 'YXZ');
    return out.multiply(_q2.setFromEuler(_e));
  }
}
