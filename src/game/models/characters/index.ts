// Character model library (CHARACTERS worker) — PUBLIC API. Import from here.
// STYLE v2: clean hand-made cartoon voxel art, authored directly on the final grid
// (no resampling / texture passes). Humanoids use the shared toon kit (../toon/humanoid.ts).
// Scales: Sundown & merchant 1/30, dumb scarab / dung ball 1/30, Pinch & dung bomb / duck 1/48,
// boards 1/32, camel 1/24, Anubis & Serket avatar 1/20, attachments 1/30 (hero grid).
// Guns (revolver.ts, longguns.ts, gunkit.ts): 1/256 close-up builds, 1/128 in-run LOD.
import { referenceSkeletonRig as refBase, CowboyLook } from './skeleton';
import { skeletonCowboyRig as sundownBase } from './sundown';
import { revolverRig as revolverBase, GunParts, DEFAULT_GUN } from './revolver';
import type { GunLod } from './gunkit';
import { pinchRig as pinchBase } from './pinch';
import { sandboardModel as boardBase, BoardId } from './boards';
import { dungBombModel as bombBase, rubberDuckModel as duckBase, dungBallModel as ballBase, dumbScarabRig as scarabBase } from './smallItems';
import { merchantRig as merchantBase, camelRig as camelBase } from './npc';
import { anubisRig as anubisBase } from './anubis';
import { serketAvatarRig as serketBase } from './serket';
import { attachmentModel as attachmentBase, AttachmentId, Attachment } from './attachments';
import type { RigSpec } from '../../../engine/voxel/Rig';

export { HAT_IDS, OUTFIT_IDS, SUNDOWN_EXPRESSIONS, SUNDOWN_VS, skeletonFigure, figureRig } from './skeleton';
export { SUNDOWN_HD_VS, BOARD_BACK_SOCKET, attachBoardOnBack } from './sundown';
export type { BoardBackOpts } from './sundown';
export type { CowboyLook, HatId, OutfitId, SkeletonFigure, FigurePart } from './skeleton';
export { DEFAULT_GUN } from './revolver';
export type { GunParts } from './revolver';
export { GUN_RES, gunK, gunVS } from './gunkit';
export type { GunLod } from './gunkit';
export { PINCH_EXPRESSIONS } from './pinch';
export { BOARD_IDS } from './boards';
export type { BoardId } from './boards';
export { MERCHANT_EXPRESSIONS, CAMEL_EXPRESSIONS } from './npc';
export { ANUBIS_EXPRESSIONS } from './anubis';
export { ATTACHMENT_IDS } from './attachments';
export type { AttachmentId, Attachment } from './attachments';

/** voxels per metre of each family */
export const SCALE = { sundown: 114, pinch: 72, revolver: 256, board: 32, merchant: 30, camel: 24, anubis: 20, serket: 20, attachment: 30, small: 48 };

const memo = <A extends unknown[], R>(fn: (...a: A) => R) => {
  const cache = new Map<string, R>();
  return (...a: A): R => {
    const k = JSON.stringify(a);
    let v = cache.get(k);
    if (!v) cache.set(k, (v = fn(...a)));
    return v;
  };
};

/** Sundown, the player (HD build, 1/114 m, realistic proportions). Default look: the punk biker jacket. */
export const skeletonCowboyRig = memo((look: CowboyLook = { hat: 'stetson', outfit: 'punk' }): RigSpec => sundownBase(look));
export const referenceSkeletonRig = memo((): RigSpec => refBase());
const revCache = new Map<string, RigSpec>();
/** the six-shooter: 'hd' (default, close-ups) or the in-run 'lo' LOD; memoised per configuration */
export const revolverRig = (gi: Partial<GunParts> = DEFAULT_GUN, lod: GunLod = 'hd'): RigSpec => {
  const g = { ...DEFAULT_GUN, ...gi };
  const k = `${g.barrel}|${g.cylinder}|${g.grip}|${g.sight}|${lod}`;
  let v = revCache.get(k);
  if (!v) revCache.set(k, (v = revolverBase(g, lod)));
  return v;
};
export const pinchRig = memo((): RigSpec => pinchBase());
export const sandboardModel = memo((style: BoardId = 'driftwood') => boardBase(style));
export const dungBombModel = memo(() => bombBase());
export const rubberDuckModel = memo(() => duckBase());
export const dungBallModel = memo(() => ballBase());
export const dumbScarabRig = memo((): RigSpec => scarabBase());
export const merchantRig = memo((): RigSpec => merchantBase());
export const camelRig = memo((): RigSpec => camelBase());
export const anubisRig = memo((): RigSpec => anubisBase());
export const serketAvatarRig = memo((): RigSpec => serketBase());
export const attachmentModel = memo((id: AttachmentId): Attachment => attachmentBase(id));
