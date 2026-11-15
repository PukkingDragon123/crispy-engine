// Web worker: sculpts and meshes Ra (the body rig, ~170k triangles, and his close-up head,
// jaw, eyes, meteors, spires and eclipse moon, ~110k more) off the main thread, where the
// build took seconds on the spawn frame. Hands back raw buffers (transferred). See raGeo.ts.
import { raRig, raHeadHD, raJawHD, raEyeHD, sunMeteorModel, obsidianSpireModel, eclipseMoonModel } from '../../models/enemies/ra';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { packGeo, packRig } from '../../../engine/voxel/RigTransfer';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = () => {
  const transfer: Transferable[] = [];
  const g = (r: { model: Parameters<typeof buildVoxelGeometry>[0]; voxelSize: number; pivot?: [number, number, number] }, pv: [number, number, number] | 'center' | 'bottom' = 'center') =>
    packGeo(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: r.pivot ?? pv }), transfer);
  const rig = packRig(raRig(), transfer);
  const hd = {
    head: g(raHeadHD()),
    jaw: g(raJawHD()),
    eyeL: g(raEyeHD(false)),
    eyeR: g(raEyeHD(true)),
    meteors: [0, 1, 2].map((s) => g(sunMeteorModel(s))),
    spires: [0, 1, 2, 3].map((s) => g(obsidianSpireModel(s), 'bottom')),
    moon: g(eclipseMoonModel()),
  };
  ctx.postMessage({ rig, hd }, transfer);
};
