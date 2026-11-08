// Background baking for the Hall's folk: Thoth and the bookworm librarians are
// sculpted and meshed in a worker (rigBakeWorker.ts) so their organic sculpts
// never stall a frame, then assembled into a RigGeo that every RigInstance can
// share. Falls back to a synchronous build where workers are unavailable.
//
//   const geo = await bakeRig('thoth');            // or bakeRig('bookworm', 2)
//   const rig = new RigInstance(geo);  const anim = new ThothAnim(rig);
//   bakedRig('thoth')                               // the RigGeo if it is ready, else null
import * as THREE from 'three';
import { buildRigGeo, type RigGeo, type RigPartGeo, type RigSpec, type V3 } from '../../engine/voxel/Rig';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { thothRig } from '../models/characters/thoth';
import { bookwormRig } from '../models/creatures/bookworm';

export type BakeKind = 'thoth' | 'bookworm';

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
  id: number;
  name: string;
  voxelSize: number;
  parts: PartMsg[];
  sockets: RigSpec['sockets'];
  meta: RigSpec['meta'];
}

const ready = new Map<string, RigGeo>();
const pending = new Map<string, Promise<RigGeo>>();
let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const waiting = new Map<number, { key: string; resolve: (g: RigGeo) => void; sync: () => void }>();

const keyOf = (kind: BakeKind, variant = 0) => (kind === 'thoth' ? 'thoth' : `bookworm:${variant | 0}`);

/** the baked rig geometry if it is ready */
export function bakedRig(kind: BakeKind, variant = 0): RigGeo | null {
  return ready.get(keyOf(kind, variant)) ?? null;
}

/** start (or join) a background bake */
export function bakeRig(kind: BakeKind, variant = 0): Promise<RigGeo> {
  const key = keyOf(kind, variant);
  const hit = ready.get(key);
  if (hit) return Promise.resolve(hit);
  const p0 = pending.get(key);
  if (p0) return p0;
  const p = new Promise<RigGeo>((resolve) => {
    const sync = () => {
      const g = buildRigGeo(kind === 'thoth' ? thothRig() : bookwormRig(variant), 'bake:' + key);
      ready.set(key, g);
      resolve(g);
    };
    const w = getWorker();
    if (!w) {
      sync();
      return;
    }
    const id = nextId++;
    waiting.set(id, { key, resolve, sync });
    w.postMessage({ id, kind, variant });
  });
  pending.set(key, p);
  return p;
}

function getWorker(): Worker | null {
  if (worker || workerDead) return worker;
  try {
    worker = new Worker(new URL('./rigBakeWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerDead = true;
    return null;
  }
  worker.onmessage = (ev: MessageEvent<GeoMsg>) => {
    const w = waiting.get(ev.data.id);
    if (!w) return;
    waiting.delete(ev.data.id);
    const g = assemble(ev.data);
    ready.set(w.key, g);
    w.resolve(g);
  };
  worker.onerror = (e) => {
    console.warn('[bake] worker failed, building on the main thread', e.message);
    worker?.terminate();
    worker = null;
    workerDead = true;
    for (const w of waiting.values()) w.sync();
    waiting.clear();
  };
  return worker;
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
