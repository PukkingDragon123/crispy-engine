// Main-thread side of the Sphinx's geometry: sculpted once in a worker
// (models/sphinx/sphinxWorker.ts) so the colossus never stalls a frame, then
// assembled into RigGeos (the Sphinx, the river gate) plus the modelled eye
// geometries. Warmed a few waves early (NILE_PREWARM), released after the
// fight. Falls back to a synchronous build where workers are unavailable.
import * as THREE from 'three';
import type { RigGeo, RigPartGeo, RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { buildSphinxMsg, type RigMsg, type SphinxMsg, type GeoBuffers } from '../../models/sphinx/sphinxBuild';

export interface SphinxGeos {
  sphinx: RigGeo;
  gate: RigGeo;
  /** modelled eyes: `${'slit' | 'wide' | 'shut'}_${'l' | 'r'}` */
  eyes: Record<string, THREE.BufferGeometry>;
}

let geos: SphinxGeos | null = null;
let pending: Promise<SphinxGeos> | null = null;

export function sphinxGeos(): SphinxGeos | null {
  return geos;
}

/** start (or join) the background build */
export function loadSphinxGeos(): Promise<SphinxGeos> {
  if (geos) return Promise.resolve(geos);
  if (pending) return pending;
  pending = new Promise<SphinxGeos>((resolve) => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('../../models/sphinx/sphinxWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    const done = (m: SphinxMsg) => {
      geos = { sphinx: assemble(m.sphinx), gate: assemble(m.gate), eyes: Object.fromEntries(Object.entries(m.eyes).map(([k, b]) => [k, geometry(b)])) };
      pending = null;
      resolve(geos);
    };
    if (!w) {
      done(buildSphinxMsg());
      return;
    }
    const t0 = performance.now();
    w.onmessage = (ev: MessageEvent<SphinxMsg>) => {
      console.log(`[sphinx] the colossus is carved (${(performance.now() - t0).toFixed(0)} ms in the background)`);
      w!.terminate();
      done(ev.data);
    };
    w.onerror = (e) => {
      console.warn('[sphinx] worker failed, carving on the main thread', e.message);
      w!.terminate();
      done(buildSphinxMsg());
    };
    w.postMessage('build');
  });
  return pending;
}

/** free the GPU buffers once the gate is passed (the run never meets this Sphinx again) */
export function releaseSphinxGeos() {
  if (!geos) return;
  for (const g of [geos.sphinx, geos.gate]) for (const p of g.parts) p.geo.dispose();
  for (const e of Object.values(geos.eyes)) e.dispose();
  geos = null;
}

function geometry(b: GeoBuffers) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(b.attrs)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (b.index) g.setIndex(new THREE.BufferAttribute(b.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function assemble(m: RigMsg): RigGeo {
  const index: Record<string, number> = {};
  m.parts.forEach((p, i) => (index[p.name] = i));
  const spec: RigSpec = {
    name: m.name,
    voxelSize: 1,
    parts: m.parts.map((p) => ({ name: p.name, model: new VoxelModel(p.name), pivot: [0, 0, 0], parent: p.parent, attach: p.offset })),
    sockets: {},
    meta: m.meta,
  };
  const parts: RigPartGeo[] = m.parts.map((p, i) => ({
    name: p.name,
    geo: geometry(p),
    parent: p.parent ? index[p.parent] : -1,
    offset: new THREE.Vector3(p.offset[0], p.offset[1], p.offset[2]),
    rest: new THREE.Euler(),
    model: spec.parts[i].model,
    pivot: [0, 0, 0],
  }));
  const sockets: RigGeo['sockets'] = {};
  for (const [k, s] of Object.entries(m.sockets)) {
    const pi = index[s.part];
    if (pi === undefined) continue;
    sockets[k] = { part: pi, offset: new THREE.Vector3(s.offset[0], s.offset[1], s.offset[2]), rot: new THREE.Euler() };
  }
  return { spec, parts, index, sockets, exprGeos: {} };
}
