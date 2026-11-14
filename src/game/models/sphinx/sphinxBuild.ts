// Builds the Sphinx's geometry at mixed resolutions (worker-safe): the body at
// SPHINX_S, the head family, paws, toes and gem at SPHINX_HI_S, the modelled
// eyes at 48 voxels per metre in three pupil states (slit, wide, shut). Every
// part's offset is carried in metres, so parts of different voxel sizes share
// one rig. Also builds the river gate (pylons + two door leaves).
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { sphinxRig, sphinxEyeModel, SPHINX_S, SPHINX_HI_S, SPHINX_HI } from './sphinxRig';
import { riverGateRig } from './riverGate';

export interface GeoBuffers {
  attrs: Record<string, { array: Float32Array; itemSize: number; normalized: boolean }>;
  index: Uint32Array | Uint16Array | null;
}
export interface PartMsg extends GeoBuffers {
  name: string;
  parent?: string;
  /** pivot offset from the parent's pivot (root: from the rig origin), metres */
  offset: V3;
}
export interface RigMsg {
  name: string;
  parts: PartMsg[];
  sockets: Record<string, { part: string; offset: V3 }>;
  meta: Record<string, unknown>;
}
export interface SphinxMsg {
  sphinx: RigMsg;
  gate: RigMsg;
  eyes: Record<string, GeoBuffers>;
}

function buffers(g: THREE.BufferGeometry, transfer?: Transferable[]): GeoBuffers {
  const attrs: GeoBuffers['attrs'] = {};
  for (const [k, a] of Object.entries(g.attributes)) {
    const arr = (a as THREE.BufferAttribute).array as Float32Array;
    attrs[k] = { array: arr, itemSize: (a as THREE.BufferAttribute).itemSize, normalized: !!(a as THREE.BufferAttribute).normalized };
    transfer?.push(arr.buffer);
  }
  const index = g.index ? (g.index.array as Uint32Array | Uint16Array) : null;
  if (index) transfer?.push(index.buffer);
  return { attrs, index };
}

/** metric pivot of a part built at S (columns are centred on x = i / S) */
const pm = (p: V3, S: number): V3 => [(p[0] - 0.5) / S, p[1] / S, p[2] / S];

/** pack a rig whose parts may come from builds at different resolutions */
function packRig(specs: { spec: RigSpec; S: number; names?: string[] }[], transfer?: Transferable[]): RigMsg {
  const main = specs[specs.length - 1].spec;
  const pick = (name: string) => {
    for (const s of specs) if (!s.names || s.names.includes(name)) {
      const p = s.spec.parts.find((q) => q.name === name);
      if (p) return { p, S: s.S };
    }
    throw new Error('no part ' + name);
  };
  const metric: Record<string, V3> = {};
  for (const p of main.parts) metric[p.name] = pm(p.pivot, 1 / main.voxelSize);
  const parts: PartMsg[] = main.parts.map((mp) => {
    const { p, S } = pick(mp.name);
    const g = buildVoxelGeometry(p.model, { voxelSize: 1 / S, pivot: p.pivot });
    const me = metric[mp.name], pa = mp.parent ? metric[mp.parent] : ([0, 0, 0] as V3);
    return { name: mp.name, parent: mp.parent, offset: [me[0] - pa[0], me[1] - pa[1], me[2] - pa[2]], ...buffers(g, transfer) };
  });
  const sockets: RigMsg['sockets'] = {};
  const S0 = 1 / main.voxelSize;
  for (const [k, s] of Object.entries(main.sockets ?? {})) {
    const at = pm(s.at, S0), me = metric[s.part];
    sockets[k] = { part: s.part, offset: [at[0] - me[0], at[1] - me[1], at[2] - me[2]] };
  }
  return { name: main.name, parts, sockets, meta: main.meta ?? {} };
}

export function buildSphinxMsg(transfer?: Transferable[]): SphinxMsg {
  const hi = sphinxRig({ S: SPHINX_HI_S, only: SPHINX_HI });
  const body = sphinxRig({ S: SPHINX_S, skip: SPHINX_HI });
  const sphinx = packRig([{ spec: hi, S: SPHINX_HI_S, names: SPHINX_HI }, { spec: body, S: SPHINX_S }], transfer);
  const eyes: SphinxMsg['eyes'] = {};
  for (const kind of ['slit', 'wide', 'shut'] as const)
    for (const [sd, s] of [['l', 1], ['r', -1]] as [string, number][]) {
      const e = sphinxEyeModel(kind, s);
      eyes[`${kind}_${sd}`] = buffers(buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot: [0, 0, 0] }), transfer);
    }
  const gs = riverGateRig();
  const gate = packRig([{ spec: gs, S: 1 / gs.voxelSize }], transfer);
  return { sphinx, gate, eyes };
}
