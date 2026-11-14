// Web worker: sculpts and meshes the Golden Leviathan (~110k voxels) off the main
// thread and hands back the raw geometry buffers (transferred). See warshipGeo.ts.
import { warshipRig } from '../../models/nile/warship';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = () => {
  const spec = warshipRig();
  const transfer: Transferable[] = [];
  const parts = spec.parts.map((p) => {
    const g = buildVoxelGeometry(p.model, { voxelSize: spec.voxelSize, pivot: p.pivot });
    const attrs: Record<string, { array: ArrayLike<number>; itemSize: number; normalized: boolean }> = {};
    for (const [k, a] of Object.entries(g.attributes)) {
      const arr = (a as { array: Float32Array }).array;
      attrs[k] = { array: arr, itemSize: (a as { itemSize: number }).itemSize, normalized: !!(a as { normalized?: boolean }).normalized };
      transfer.push(arr.buffer);
    }
    const index = g.index ? (g.index.array as Uint32Array | Uint16Array) : null;
    if (index) transfer.push(index.buffer);
    return { name: p.name, parent: p.parent, pivot: p.pivot, attach: p.attach, rest: p.rest, attrs, index };
  });
  ctx.postMessage({ name: spec.name, voxelSize: spec.voxelSize, parts, sockets: spec.sockets, meta: spec.meta }, transfer);
};
