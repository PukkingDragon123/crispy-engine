// Registry of character/creature rigs for the model viewer and game lookups.
import type { RigSpec } from '../../engine/voxel/Rig';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';

export type ModelEntry = () => RigSpec | { model: VoxelModel; voxelSize: number };
export const CHARACTER_MODELS: Record<string, ModelEntry> = {};
