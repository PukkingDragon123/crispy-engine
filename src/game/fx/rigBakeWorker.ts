// Web worker: sculpts and meshes Thoth or a bookworm off the main thread (their
// organic sculpts take a few hundred milliseconds), then hands back the raw
// geometry buffers (transferred, no copies). Main-thread side: RigBake.ts.
import { thothRig } from '../models/characters/thoth';
import { bookwormRig } from '../models/creatures/bookworm';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = (e: MessageEvent<{ id: number; kind: 'thoth' | 'bookworm'; variant?: number }>) => {
  const { id, kind, variant } = e.data;
  const spec = kind === 'thoth' ? thothRig() : bookwormRig(variant ?? 0);
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
  ctx.postMessage({ id, name: spec.name, voxelSize: spec.voxelSize, parts, sockets: spec.sockets, meta: spec.meta }, transfer);
};
