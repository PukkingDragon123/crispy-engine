// Registry of props / structures / items for the model viewer and game lookups.
import type { ModelEntry } from './registryCharacters';
import { VoxelModel, vary, mix } from '../../engine/voxel/VoxelModel';
import { P } from '../../engine/voxel/palette';
import { VF } from '../../engine/voxel/VoxelModel';

function testCrate() {
  const m = new VoxelModel('crate');
  const S = 13;
  m.box(0, 0, 0, S, S, S, vary(P.wood1, 0.1));
  // planks frame
  for (const [a, b] of [[0, 0], [0, S], [S, 0], [S, S]]) {
    m.box(a, 0, b, a, S, b, vary(P.wood3, 0.08));
  }
  m.box(0, S, 0, S, S, S, (x, y, z) => ((x + z) % 4 === 0 ? P.wood2 : mix(P.wood0, P.wood1, ((x * 7 + z * 3) % 5) / 5)));
  m.box(6, 6, -1, 7, 7, -1, P.gold1, VF.METAL);
  m.box(2, 3, -1, 3, 3, -1, P.poison1, VF.EMISSIVE);
  return { model: m, voxelSize: 1 / 16 };
}

export const PROP_MODELS: Record<string, ModelEntry> = {
  test_crate: testCrate,
};
