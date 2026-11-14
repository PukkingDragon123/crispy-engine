// Web worker: sculpts and meshes Cleopatra's court (the barge first, so the
// arrival can start while the rest is still being carved), posting each rig's
// raw geometry buffers back as soon as it is done (transferred, no copies).
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { COURT_BUILDERS, COURT_ORDER } from './courtList';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
ctx.onmessage = (ev: MessageEvent<string[] | string>) => {
  const keys = Array.isArray(ev.data) ? ev.data : COURT_ORDER;
  for (const key of keys) {
    const build = COURT_BUILDERS[key];
    if (!build) continue;
    const t0 = performance.now();
    const spec = build();
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
    ctx.postMessage({ key, ms: performance.now() - t0, geo: { name: spec.name, voxelSize: spec.voxelSize, parts, sockets: spec.sockets, meta: spec.meta } }, transfer);
  }
  ctx.postMessage({ done: true });
};
