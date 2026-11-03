// Character model library (CHARACTERS worker) — PUBLIC API. Import from here.
// STYLE v2: clean hand-made cartoon voxel art, authored directly on the final grid
// (no resampling / texture passes). Humanoids use the shared toon kit (../toon/humanoid.ts).
// Scales: Sundown & merchant 1/30, dumb scarab / dung ball 1/30, Pinch & revolver & dung bomb /
// duck 1/48, boards 1/32, camel 1/24, Anubis & Serket avatar 1/20, attachments 1/30 (hero grid).
import { skeletonCowboyRig as sundownBase, referenceSkeletonRig as refBase, CowboyLook } from './skeleton';
import { revolverRig as revolverBase, GunParts, DEFAULT_GUN } from './revolver';
import { pinchRig as pinchBase } from './pinch';
import { sandboardModel as boardBase, BoardId } from './boards';
import { dungBombModel as bombBase, rubberDuckModel as duckBase, dungBallModel as ballBase, dumbScarabRig as scarabBase } from './smallItems';
import { merchantRig as merchantBase, camelRig as camelBase } from './npc';
import { anubisRig as anubisBase } from './anubis';
import { serketAvatarRig as serketBase } from './serket';
import { attachmentModel as attachmentBase, AttachmentId, Attachment } from './attachments';
import type { RigSpec } from '../../../engine/voxel/Rig';

export { HAT_IDS, OUTFIT_IDS, SUNDOWN_EXPRESSIONS, SUNDOWN_VS, skeletonFigure, figureRig } from './skeleton';
export type { CowboyLook, HatId, OutfitId, SkeletonFigure, FigurePart } from './skeleton';
export { DEFAULT_GUN } from './revolver';
export type { GunParts } from './revolver';
export { PINCH_EXPRESSIONS } from './pinch';
export { BOARD_IDS } from './boards';
export type { BoardId } from './boards';
export { MERCHANT_EXPRESSIONS, CAMEL_EXPRESSIONS } from './npc';
export { ANUBIS_EXPRESSIONS } from './anubis';
export { ATTACHMENT_IDS } from './attachments';
export type { AttachmentId, Attachment } from './attachments';

/** voxels per metre of each family */
export const SCALE = { sundown: 30, pinch: 48, revolver: 48, board: 32, merchant: 30, camel: 24, anubis: 20, serket: 20, attachment: 30, small: 48 };

const memo = <A extends unknown[], R>(fn: (...a: A) => R) => {
  const cache = new Map<string, R>();
  return (...a: A): R => {
    const k = JSON.stringify(a);
    let v = cache.get(k);
    if (!v) cache.set(k, (v = fn(...a)));
    return v;
  };
};

export const skeletonCowboyRig = memo((look: CowboyLook = { hat: 'stetson', outfit: 'bare' }): RigSpec => sundownBase(look));
export const referenceSkeletonRig = memo((): RigSpec => refBase());
export const revolverRig = memo((g: GunParts = DEFAULT_GUN): RigSpec => revolverBase(g));
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
