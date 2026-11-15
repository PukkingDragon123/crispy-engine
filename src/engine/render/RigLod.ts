// Distance LOD for live voxel rigs (bosses, wildlife, NPCs, nests, set pieces built as rigs).
// Far enough away that one voxel covers well under a pixel, a rig draws a 2x merged version of
// each heavy part (an eighth of the voxels, about a quarter of the triangles), in the main and the
// shadow pass. The swap is made just for the draw: before the frame renders, far rigs get their
// distant geometry; right after, every mesh gets back exactly the geometry it had, so expressions,
// limb swaps and anything else that sets geometry in game code never sees the LOD.
// Distant parts are meshed in a worker the first time a rig is seen far away; until they land
// the rig simply draws at full detail. Up close nothing changes.
import * as THREE from 'three';
import type { RigGeo, RigInstance } from '../voxel/Rig';
import { unpackGeo, type GeoPack } from '../voxel/RigTransfer';

/** parts smaller than this many voxels are not worth a distant version */
const MIN_VOXELS = 1500;
/** a source voxel smaller than this on screen (px) switches the rig to its distant version... */
const PX_IN = 0.6;
/** ...and larger than this switches it back (hysteresis: no flicker at the threshold) */
const PX_OUT = 0.72;

interface PartLod {
  /** per part: the distant geometry, null = none (small or no voxels), undefined = not built yet */
  geos: (THREE.BufferGeometry | null | undefined)[];
  pending: number;
  requested: boolean;
}
interface Tracked {
  ref: WeakRef<RigInstance>;
  far: boolean;
}

const lods = new WeakMap<RigGeo, PartLod>();
const tracked: Tracked[] = [];
let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const waiting = new Map<number, (g: GeoPack | null) => void>();
const swapped: { mesh: THREE.Mesh; geo: THREE.BufferGeometry }[] = [];
let enabled = (() => {
  try {
    return new URLSearchParams(location.search).get('lod') !== '0';
  } catch {
    return true;
  }
})();

/** turn the distant versions on / off (debug and A/B checks) */
export function setRigLod(on: boolean) {
  enabled = on;
}

/** a rig to watch (called by every RigInstance) */
export function trackRig(r: RigInstance) {
  tracked.push({ ref: new WeakRef(r), far: false });
}

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; geo: GeoPack | null }>) => {
      const f = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      f?.(e.data.geo);
    };
    worker.onerror = (e) => {
      console.warn('[lod] worker failed; rigs keep full detail at every distance', e.message);
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const f of waiting.values()) f(null);
      waiting.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** start meshing a rig's distant parts (once per rig geometry, shared by every instance) */
function request(geo: RigGeo): PartLod {
  let L = lods.get(geo);
  if (!L) {
    L = { geos: geo.parts.map(() => undefined), pending: 0, requested: false };
    lods.set(geo, L);
  }
  if (L.requested) return L;
  L.requested = true;
  const w = getWorker();
  const vs = geo.spec.voxelSize;
  geo.parts.forEach((p, i) => {
    const n = p.model.count;
    if (!w || n < MIN_VOXELS) {
      L!.geos[i] = null;
      return;
    }
    const keys = new Int32Array(n), vals = new Uint32Array(n);
    let k = 0;
    for (const [kk, v] of p.model.map) {
      keys[k] = kk;
      vals[k++] = v;
    }
    const id = nextId++;
    L!.pending++;
    waiting.set(id, (g) => {
      L!.pending--;
      L!.geos[i] = g ? unpackGeo(g) : null;
    });
    w.postMessage({ id, keys, vals, voxelSize: vs, pivot: p.pivot }, [keys.buffer, vals.buffer]);
  });
  return L;
}

const _p = new THREE.Vector3();

/** inside the scene being drawn (and shown)? */
function inScene(o: THREE.Object3D, scene: THREE.Object3D) {
  let x: THREE.Object3D | null = o;
  while (x) {
    if (!x.visible) return false;
    if (x === scene) return true;
    x = x.parent;
  }
  return false;
}

/**
 * Before the frame renders: far rigs in `scene` get their distant geometry. `bufferH` is the
 * height of the target the scene draws into (device pixels).
 */
export function lodBefore(scene: THREE.Object3D, camera: THREE.Camera, bufferH: number) {
  if (!enabled || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
  const cam = camera as THREE.PerspectiveCamera;
  const k = (bufferH * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / (cam.zoom || 1);
  cam.getWorldPosition(_p);
  const cx = _p.x, cy = _p.y, cz = _p.z;
  let w = 0;
  for (let i = 0; i < tracked.length; i++) {
    const t = tracked[i];
    const r = t.ref.deref();
    if (!r) continue;
    tracked[w++] = t;
    if (!inScene(r.root, scene)) continue;
    const vs0 = r.geo.spec.voxelSize;
    const e = r.root.matrixWorld.elements;
    const d = Math.hypot(e[12] - cx, e[13] - cy, e[14] - cz);
    const scale = Math.hypot(e[0], e[1], e[2]);
    const px = (vs0 * scale * k) / Math.max(d, 0.01);
    t.far = t.far ? px < PX_OUT : px < PX_IN;
    if (!t.far) continue;
    const L = request(r.geo);
    if (L.pending > 0) continue; // all parts land together: no mixed rig
    r.geo.parts.forEach((p, pi) => {
      const lg = L.geos[pi];
      if (!lg) return;
      const m = r.meshes[p.name];
      if (!m || m.geometry !== p.geo) return; // an expression or game swap: leave it as it is
      swapped.push({ mesh: m, geo: p.geo });
      m.geometry = lg;
    });
  }
  tracked.length = w;
}

/** right after the frame: every swapped mesh gets its own geometry back */
export function lodAfter() {
  for (let i = swapped.length - 1; i >= 0; i--) swapped[i].mesh.geometry = swapped[i].geo;
  swapped.length = 0;
}

/** how many rigs are drawn distant right now (debug) */
export function lodStats() {
  let live = 0, far = 0;
  for (const t of tracked) if (t.ref.deref()) {
    live++;
    if (t.far) far++;
  }
  return { tracked: live, far };
}
