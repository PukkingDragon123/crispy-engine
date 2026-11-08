// Registry of character/creature rigs for the model viewer and game lookups.
import type { RigSpec } from '../../engine/voxel/Rig';
import { toonSkeletonRig } from './toon/humanoid';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import {
  skeletonCowboyRig, HAT_IDS, OUTFIT_IDS, pinchRig, revolverRig, sandboardModel, BOARD_IDS,
  dungBombModel, rubberDuckModel, dungBallModel, dumbScarabRig, merchantRig, camelRig, anubisRig,
  serketAvatarRig, attachmentModel, ATTACHMENT_IDS, referenceSkeletonRig,
} from './characters';

export type ModelEntry = () => RigSpec | { model: VoxelModel; voxelSize: number };
export const CHARACTER_MODELS: Record<string, ModelEntry> = {};

// Sundown: every hat x outfit combination (cowboy_<hat>_<outfit>)
for (const h of HAT_IDS) for (const o of OUTFIT_IDS) CHARACTER_MODELS[`cowboy_${h}_${o}`] = () => skeletonCowboyRig({ hat: h, outfit: o });
CHARACTER_MODELS['pinch'] = pinchRig;
// the bare skeleton exactly as in the user's reference (no hat / gear)
CHARACTER_MODELS['sundown_reference'] = () => referenceSkeletonRig();
// plain toon skeleton (style reference for every humanoid)
CHARACTER_MODELS['toon_skeleton'] = () => toonSkeletonRig();
CHARACTER_MODELS['revolver_standard'] = () => revolverRig({ barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'iron' });
CHARACTER_MODELS['revolver_long_gold_ivory'] = () => revolverRig({ barrel: 'long', cylinder: 'gold', grip: 'ivory', sight: 'scope' });
CHARACTER_MODELS['revolver_snub_bone_bone'] = () => revolverRig({ barrel: 'snub', cylinder: 'bone', grip: 'bone', sight: 'none' });
CHARACTER_MODELS['revolver_serket_venom_scarab'] = () => revolverRig({ barrel: 'serket', cylinder: 'venom', grip: 'scarab', sight: 'iron' });
for (const b of BOARD_IDS) CHARACTER_MODELS['board_' + b] = () => sandboardModel(b);
CHARACTER_MODELS['dung_bomb'] = dungBombModel;
CHARACTER_MODELS['rubber_duck'] = rubberDuckModel;
CHARACTER_MODELS['dung_ball'] = dungBallModel;
CHARACTER_MODELS['dumb_scarab'] = dumbScarabRig;
CHARACTER_MODELS['merchant'] = merchantRig; // Old Mother Tamsin, the tortoise shopkeeper
CHARACTER_MODELS['tortoise_merchant'] = merchantRig;
CHARACTER_MODELS['camel'] = camelRig;
CHARACTER_MODELS['anubis'] = anubisRig;
CHARACTER_MODELS['serket_avatar'] = serketAvatarRig;
for (const a of ATTACHMENT_IDS) CHARACTER_MODELS['att_' + a] = () => attachmentModel(a);
// Serket's spirit avatar as the scorpion girl (opening cinematic + tutorial guide)
import { scorpionGirlRig } from './characters/scorpionGirl';
CHARACTER_MODELS['serket_girl'] = scorpionGirlRig;
// the realm of spirits: the Anubis trial's tomb gate, hall, scales, soul avatar and the dead
import { REALM_MODELS } from './anubis/realm';
Object.assign(CHARACTER_MODELS, REALM_MODELS);
// Thoth, keeper of the Hall: the tiny ibis-headed scribe god (characters/thoth.ts; animate with ThothAnim)
import { thothRig } from './characters/thoth';
CHARACTER_MODELS['thoth'] = thothRig;
// the bookworms, librarians of Thoth's Hall (creatures/bookworm.ts; animate with BookwormAnim)
import { bookwormRig } from './creatures/bookworm';
CHARACTER_MODELS['bookworm'] = () => bookwormRig(0);
CHARACTER_MODELS['bookworm_elder'] = () => bookwormRig(1);
CHARACTER_MODELS['bookworm_apprentice'] = () => bookwormRig(2);
CHARACTER_MODELS['bookworm_archivist'] = () => bookwormRig(3);
