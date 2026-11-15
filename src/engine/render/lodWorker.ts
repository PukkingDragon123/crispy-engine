// Web worker: the distant version of a rig part. Rebuilds the part's voxels from the flat
// key / value arrays it is sent, merges them 2x2x2 and meshes the result, then hands the raw
// buffers back (transferred). See RigLod.ts.
import { VoxelModel, downsampleModel } from '../voxel/VoxelModel';
import { buildVoxelGeometry } from '../voxel/Mesher';
import { packGeo } from '../voxel/RigTransfer';

interface Job {
  id: number;
  keys: Int32Array;
  vals: Uint32Array;
  voxelSize: number;
  pivot: [number, number, number];
}
const ctx = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = (e) => {
  const j = e.data;
  const m = new VoxelModel();
  for (let i = 0; i < j.keys.length; i++) m.map.set(j.keys[i], j.vals[i]);
  // a cell keeps a voxel when any of its eight is filled: thin shells and limbs never open up
  const ds = downsampleModel(m, 2, 0.1);
  const transfer: Transferable[] = [];
  const geo = ds.count > 0 ? packGeo(buildVoxelGeometry(ds, { voxelSize: j.voxelSize * 2, pivot: [j.pivot[0] / 2, j.pivot[1] / 2, j.pivot[2] / 2] }), transfer) : null;
  ctx.postMessage({ id: j.id, geo }, transfer);
};
