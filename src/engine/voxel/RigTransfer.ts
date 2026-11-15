// Moving built voxel geometry between a worker and the main thread: a worker sculpts and
// meshes a heavy model, packs the raw buffers (transferred, not copied) and the main thread
// rebuilds BufferGeometries and a RigGeo around them. The rebuilt rig carries empty
// VoxelModels (the voxels stay in the worker); nothing that animates or draws a rig reads them.
import * as THREE from 'three';
import { VoxelModel } from './VoxelModel';
import { buildVoxelGeometry } from './Mesher';
import type { RigGeo, RigPartGeo, RigSpec, V3 } from './Rig';

export interface GeoPack {
  attrs: Record<string, { array: Float32Array | Uint8Array | Uint16Array | Uint32Array; itemSize: number; normalized: boolean }>;
  index: Uint32Array | Uint16Array | null;
  userData: Record<string, unknown>;
}
export interface RigPack {
  name: string;
  voxelSize: number;
  parts: { name: string; parent?: string; pivot: V3; attach: V3; rest?: V3; geo: GeoPack }[];
  sockets: RigSpec['sockets'];
  /** meta without expression part models (those are packed as geometry below) */
  meta: RigSpec['meta'];
  /** expression name -> part index -> geometry */
  expr: Record<string, Record<number, GeoPack>>;
}

/** worker side: one geometry's buffers (their ArrayBuffers are pushed onto `transfer`) */
export function packGeo(g: THREE.BufferGeometry, transfer: Transferable[]): GeoPack {
  const attrs: GeoPack['attrs'] = {};
  for (const [k, a] of Object.entries(g.attributes)) {
    const ba = a as THREE.BufferAttribute;
    attrs[k] = { array: ba.array as GeoPack['attrs'][string]['array'], itemSize: ba.itemSize, normalized: ba.normalized };
    transfer.push((ba.array as Float32Array).buffer);
  }
  const index = g.index ? (g.index.array as Uint32Array | Uint16Array) : null;
  if (index) transfer.push(index.buffer);
  return { attrs, index, userData: { ...g.userData } };
}

/** worker side: mesh a rig spec and pack it */
export function packRig(spec: RigSpec, transfer: Transferable[]): RigPack {
  const vs = spec.voxelSize;
  const index: Record<string, number> = {};
  spec.parts.forEach((p, i) => (index[p.name] = i));
  const parts = spec.parts.map((p) => ({
    name: p.name, parent: p.parent, pivot: p.pivot, attach: p.attach, rest: p.rest,
    geo: packGeo(buildVoxelGeometry(p.model, { voxelSize: vs, pivot: p.pivot }), transfer),
  }));
  const expr: RigPack['expr'] = {};
  const meta = { ...(spec.meta ?? {}) };
  const exprs = (meta.expressions ?? {}) as Record<string, { parts?: Record<string, VoxelModel> }>;
  const plain: Record<string, unknown> = {};
  for (const [en, e] of Object.entries(exprs)) {
    expr[en] = {};
    for (const [pn, model] of Object.entries(e.parts ?? {})) {
      const pi = index[pn];
      if (pi !== undefined) expr[en][pi] = packGeo(buildVoxelGeometry(model, { voxelSize: vs, pivot: spec.parts[pi].pivot }), transfer);
    }
    const { parts: _drop, ...rest } = e;
    plain[en] = rest;
  }
  if (meta.expressions) meta.expressions = plain;
  return { name: spec.name, voxelSize: vs, parts, sockets: spec.sockets, meta, expr };
}

/** main thread: a BufferGeometry around packed buffers */
export function unpackGeo(p: GeoPack): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(p.attrs)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  Object.assign(g.userData, p.userData);
  return g;
}

/** main thread: the RigGeo a packed rig stands for (same layout buildRigGeo makes) */
export function unpackRig(m: RigPack): RigGeo {
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
  const parts: RigPartGeo[] = m.parts.map((p, i) => {
    const pi = p.parent ? index[p.parent] : -1;
    const pp = pi >= 0 ? m.parts[pi] : null;
    const offset = pp
      ? new THREE.Vector3((p.attach[0] - pp.pivot[0]) * vs, (p.attach[1] - pp.pivot[1]) * vs, (p.attach[2] - pp.pivot[2]) * vs)
      : new THREE.Vector3(p.attach[0] * vs, p.attach[1] * vs, p.attach[2] * vs);
    return { name: p.name, geo: unpackGeo(p.geo), parent: pi, offset, rest: new THREE.Euler(...(p.rest ?? [0, 0, 0])), model: spec.parts[i].model, pivot: p.pivot };
  });
  const sockets: RigGeo['sockets'] = {};
  for (const [k, s] of Object.entries(m.sockets ?? {})) {
    const pi = index[s.part];
    if (pi === undefined) continue;
    const pp = m.parts[pi];
    sockets[k] = { part: pi, offset: new THREE.Vector3((s.at[0] - pp.pivot[0]) * vs, (s.at[1] - pp.pivot[1]) * vs, (s.at[2] - pp.pivot[2]) * vs), rot: new THREE.Euler(...(s.rot ?? [0, 0, 0])) };
  }
  const exprGeos: RigGeo['exprGeos'] = {};
  for (const [en, byPart] of Object.entries(m.expr)) {
    exprGeos[en] = {};
    for (const [pi, gp] of Object.entries(byPart)) exprGeos[en][+pi] = unpackGeo(gp);
  }
  return { spec, parts, index, sockets, exprGeos };
}
