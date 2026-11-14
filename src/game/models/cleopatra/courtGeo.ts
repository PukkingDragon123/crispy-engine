// Main-thread side of Cleopatra's court geometry: every rig is sculpted and
// meshed in a worker (courtWorker.ts) so the 3 m queen, her lions, guards and
// the 15 m barge never stall a frame; each RigGeo is assembled as it arrives
// and shared by every RigInstance (the boss, her mirage clones and dancers, the
// HUD cut-in). Falls back to a synchronous build where workers are unavailable.
// prewarmCourt() may be called early (e.g. when a Nile run reaches region B).
import * as THREE from 'three';
import { buildRigGeo, type RigGeo, type RigPartGeo, type RigSpec, type V3 } from '../../../engine/voxel/Rig';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { COURT_BUILDERS, COURT_ORDER } from './courtList';

interface PartMsg {
  name: string;
  parent?: string;
  pivot: V3;
  attach: V3;
  rest?: V3;
  attrs: Record<string, { array: Float32Array; itemSize: number; normalized: boolean }>;
  index: Uint32Array | Uint16Array | null;
}
interface GeoMsg {
  name: string;
  voxelSize: number;
  parts: PartMsg[];
  sockets: RigSpec['sockets'];
  meta: RigSpec['meta'];
}

const ready = new Map<string, RigGeo>();
const waiters = new Map<string, ((g: RigGeo) => void)[]>();
let started = false;

/** a court rig's geometry if it is ready */
export function courtGeo(key: string): RigGeo | null {
  return ready.get(key) ?? null;
}

function deliver(key: string, g: RigGeo) {
  ready.set(key, g);
  for (const w of waiters.get(key) ?? []) w(g);
  waiters.delete(key);
}

function syncBuild(keys: string[]) {
  for (const k of keys) if (!ready.has(k)) deliver(k, buildRigGeo(COURT_BUILDERS[k](), 'court:' + k));
}

/** start (or join) the background build of the whole court */
export function prewarmCourt() {
  if (started) return;
  started = true;
  let w: Worker | null = null;
  try {
    w = new Worker(new URL('./courtWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    w = null;
  }
  if (!w) {
    // no workers: carve one rig per idle slice so a frame never carries more than one
    const left = [...COURT_ORDER];
    const step = () => {
      const k = left.shift();
      if (!k) return;
      syncBuild([k]);
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
    return;
  }
  const t0 = performance.now();
  w.onmessage = (ev: MessageEvent<{ key?: string; ms?: number; geo?: GeoMsg; done?: boolean }>) => {
    const m = ev.data;
    if (m.done) {
      console.log(`[cleopatra] the court is carved (${(performance.now() - t0).toFixed(0)} ms in the background)`);
      w!.terminate();
      return;
    }
    if (m.key && m.geo) deliver(m.key, assemble(m.geo));
  };
  w.onerror = (e) => {
    console.warn('[cleopatra] court worker failed, carving on the main thread', e.message);
    w!.terminate();
    syncBuild(COURT_ORDER);
  };
  w.postMessage(COURT_ORDER);
}

/** resolves with the rig geometry once carved (starts the build if needed) */
export function loadCourtGeo(key: string): Promise<RigGeo> {
  const g = ready.get(key);
  if (g) return Promise.resolve(g);
  prewarmCourt();
  return new Promise((res) => {
    const l = waiters.get(key) ?? [];
    l.push(res);
    waiters.set(key, l);
  });
}

function assemble(m: GeoMsg): RigGeo {
  const vs = m.voxelSize;
  const index: Record<string, number> = {};
  m.parts.forEach((p, i) => (index[p.name] = i));
  const spec: RigSpec = {
    name: m.name,
    voxelSize: vs,
    parts: m.parts.map((p) => ({ name: p.name, model: new VoxelModel(p.name), pivot: p.pivot, parent: p.parent, attach: p.attach, rest: p.rest })),
    sockets: m.sockets,
    meta: m.meta,
  };
  const parts: RigPartGeo[] = m.parts.map((p) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(p.attrs)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const pi = p.parent ? index[p.parent] : -1;
    const pp = pi >= 0 ? m.parts[pi] : null;
    const offset = pp
      ? new THREE.Vector3((p.attach[0] - pp.pivot[0]) * vs, (p.attach[1] - pp.pivot[1]) * vs, (p.attach[2] - pp.pivot[2]) * vs)
      : new THREE.Vector3(p.attach[0] * vs, p.attach[1] * vs, p.attach[2] * vs);
    return { name: p.name, geo: g, parent: pi, offset, rest: new THREE.Euler(...(p.rest ?? [0, 0, 0])), model: spec.parts[index[p.name]].model, pivot: p.pivot };
  });
  const sockets: RigGeo['sockets'] = {};
  for (const [k, s] of Object.entries(m.sockets ?? {})) {
    const pi = index[s.part];
    if (pi === undefined) continue;
    const pp = m.parts[pi];
    sockets[k] = { part: pi, offset: new THREE.Vector3((s.at[0] - pp.pivot[0]) * vs, (s.at[1] - pp.pivot[1]) * vs, (s.at[2] - pp.pivot[2]) * vs), rot: new THREE.Euler(...(s.rot ?? [0, 0, 0])) };
  }
  return { spec, parts, index, sockets, exprGeos: {} };
}
