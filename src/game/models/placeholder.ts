// Minimal stand-in rigs used only while real models are missing (dev safety net).
import { VoxelModel, vary } from '../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../engine/voxel/Rig';
import { P } from '../../engine/voxel/palette';
import { VF } from '../../engine/voxel/VoxelModel';

export function placeholderHumanoid(color: number = P.bone1): RigSpec {
  const box = (w: number, h: number, d: number, c: number) => {
    const m = new VoxelModel();
    m.box(0, 0, 0, w - 1, h - 1, d - 1, vary(c, 0.08));
    return m;
  };
  const head = box(6, 6, 6, P.bone0);
  head.set(1, 3, 6, P.eyeGlow, VF.GLOW).set(4, 3, 6, P.eyeGlow, VF.GLOW);
  return {
    name: 'placeholder_humanoid',
    voxelSize: 1 / 16,
    parts: [
      { name: 'pelvis', model: box(6, 3, 4, P.leather1), pivot: [3, 1.5, 2], attach: [0, 14, 0] },
      { name: 'torso', model: box(7, 8, 4, P.dusterBrown), pivot: [3.5, 0, 2], parent: 'pelvis', attach: [3, 3, 2] },
      { name: 'head', model: head, pivot: [3, 0, 3], parent: 'torso', attach: [3.5, 8, 2] },
      { name: 'jaw', model: box(4, 1, 4, P.bone2), pivot: [2, 1, 0], parent: 'head', attach: [3, 0, 4] },
      { name: 'hat', model: box(10, 3, 10, P.leather2), pivot: [5, 0, 5], parent: 'head', attach: [3, 6, 3] },
      { name: 'arm_l', model: box(2, 6, 2, P.dusterBrown), pivot: [1, 6, 1], parent: 'torso', attach: [8, 8, 2] },
      { name: 'fore_l', model: box(2, 6, 2, color), pivot: [1, 6, 1], parent: 'arm_l', attach: [1, 0, 1] },
      { name: 'arm_r', model: box(2, 6, 2, P.dusterBrown), pivot: [1, 6, 1], parent: 'torso', attach: [-1, 8, 2] },
      { name: 'fore_r', model: box(2, 6, 2, color), pivot: [1, 6, 1], parent: 'arm_r', attach: [1, 0, 1] },
      { name: 'thigh_l', model: box(3, 7, 3, P.leather2), pivot: [1.5, 7, 1.5], parent: 'pelvis', attach: [4.5, 0, 2] },
      { name: 'shin_l', model: box(3, 7, 3, P.leather3), pivot: [1.5, 7, 1.5], parent: 'thigh_l', attach: [1.5, 0, 1.5] },
      { name: 'thigh_r', model: box(3, 7, 3, P.leather2), pivot: [1.5, 7, 1.5], parent: 'pelvis', attach: [1.5, 0, 2] },
      { name: 'shin_r', model: box(3, 7, 3, P.leather3), pivot: [1.5, 7, 1.5], parent: 'thigh_r', attach: [1.5, 0, 1.5] },
      { name: 'coat', model: box(7, 6, 1, P.dusterDark), pivot: [3.5, 6, 0], parent: 'pelvis', attach: [3, 2, 0] },
    ],
    sockets: {
      hand_r: { part: 'fore_r', at: [1, 0, 1] },
      hand_l: { part: 'fore_l', at: [1, 0, 1] },
      shoulder_l: { part: 'torso', at: [6, 8, 2] },
      head_top: { part: 'head', at: [3, 6, 3] },
      back: { part: 'torso', at: [3.5, 5, 0] },
    },
    meta: { height: 1.8, radius: 0.4 },
  };
}

export function placeholderRevolver(): RigSpec {
  const m = new VoxelModel();
  m.box(0, 0, 0, 1, 1, 9, vary(P.iron1, 0.1), VF.METAL);
  const c = new VoxelModel();
  c.box(-1, -1, -1, 1, 1, 1, vary(P.silver1, 0.1), VF.METAL);
  const g = new VoxelModel();
  g.box(0, -4, -1, 1, 0, 1, vary(P.wood2, 0.1));
  return {
    name: 'placeholder_revolver',
    voxelSize: 1 / 32,
    parts: [
      { name: 'frame', model: g.merge(m), pivot: [0.5, -2, 0], attach: [0, 0, 0] },
      { name: 'cylinder', model: c, pivot: [0, 0, 0], parent: 'frame', attach: [0.5, 0.5, 2] },
      { name: 'hammer', model: new VoxelModel().box(0, 0, 0, 0, 1, 0, P.iron2), pivot: [0, 0, 0], parent: 'frame', attach: [0.5, 1.5, -1] },
    ],
    meta: { muzzle: [0.5, 0.5, 10] },
  };
}

export function placeholderBoard() {
  const m = new VoxelModel();
  m.box(-3, 0, -11, 3, 0, 11, vary(P.wood1, 0.1));
  m.box(-2, 0, 12, 2, 1, 12, P.wood2);
  return { model: m, voxelSize: 1 / 16 };
}
