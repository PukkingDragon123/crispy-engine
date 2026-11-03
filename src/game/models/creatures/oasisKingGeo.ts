// Main-thread side of the Oasis King's geometry: built once per session in a
// worker (oasisKingWorker.ts) so the 17.5 m hide never stalls a frame, then
// assembled into a RigGeo every RigInstance can share (the boss, the lurking
// silhouette in the pond, the HUD cut-in). Falls back to a synchronous build
// where workers are unavailable.
import * as THREE from 'three';
import { buildRigGeo, type RigGeo, type RigPartGeo, type RigSpec, type V3 } from '../../../engine/voxel/Rig';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { oasisKingRig } from './oasisKingRig';

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

let geo: RigGeo | null = null;
let pending: Promise<RigGeo> | null = null;

/** the King's rig geometry if it is ready */
export function kingGeo(): RigGeo | null {
  return geo;
}

/** start (or join) the background build */
export function loadKingGeo(): Promise<RigGeo> {
  if (geo) return Promise.resolve(geo);
  if (pending) return pending;
  pending = new Promise<RigGeo>((resolve) => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('./oasisKingWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    const sync = () => {
      geo = buildRigGeo(oasisKingRig(), 'oasis_king:sync');
      resolve(geo);
    };
    if (!w) {
      sync();
      return;
    }
    const t0 = performance.now();
    w.onmessage = (ev: MessageEvent<GeoMsg>) => {
      geo = assemble(ev.data);
      console.log(`[oasis] the King's hide is ready (${(performance.now() - t0).toFixed(0)} ms in the background)`);
      w!.terminate();
      resolve(geo);
    };
    w.onerror = (e) => {
      console.warn('[oasis] King worker failed, building on the main thread', e.message);
      w!.terminate();
      sync();
    };
    w.postMessage('build');
  });
  return pending;
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
