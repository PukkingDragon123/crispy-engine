// Registry of enemies / alphas / minibosses / major bosses for the model viewer and game lookups.
import type { ModelEntry } from './registryCharacters';
import { huskRig } from './enemies/husk';
import { gunslingerRig } from './enemies/gunslinger';
import { mummyRig } from './enemies/mummy';
import { jackalRig } from './enemies/jackal';
import { scarabRig } from './enemies/scarab';
import { giantScorpionRig, bigBerthaRig } from './enemies/scorpion';
import { vultureRig } from './enemies/vulture';
import { outlawRiderRig } from './enemies/outlaw';
import { dustMarshalRig } from './enemies/marshal';
import { pharaohRig } from './enemies/pharaoh';
import { sethosRig } from './enemies/sethos';
import { sunrollerRig, sunBallModel, sunBallRig } from './enemies/sunroller';
import { sandWolfRig } from './enemies/wolf';
import { duneWormRig } from './enemies/worm';
import { sandwormRig } from './enemies/sandworm';
import { khonsuAvatarRig, khonsuHandRig } from './enemies/khonsu';
import { rainFrogMamaRig, rainFrogBabyRig, desertMothRig, frogWigHat, FROG_WIG_VS } from './enemies/frog';
import { thornyLizardRig, thornbackRig } from './enemies/lizard';
import { bellSnakeRig } from './enemies/snake';
import { khonsuSandRig, khonsuSandSpikeModel } from './enemies/khonsuSand';

export const ENEMY_MODELS: Record<string, ModelEntry> = {
  husk: () => huskRig(),
  husk_v1: () => huskRig({ variant: 1 }),
  husk_v2: () => huskRig({ variant: 2 }),
  husk_alpha: () => huskRig({ alpha: true }),
  gunslinger: () => gunslingerRig(),
  gunslinger_v1: () => gunslingerRig({ variant: 1 }),
  gunslinger_v2: () => gunslingerRig({ variant: 2 }),
  gunslinger_alpha: () => gunslingerRig({ alpha: true }),
  mummy: () => mummyRig(),
  mummy_v1: () => mummyRig({ variant: 1 }),
  mummy_v2: () => mummyRig({ variant: 2 }),
  mummy_alpha: () => mummyRig({ alpha: true }),
  jackal: () => jackalRig(),
  jackal_v1: () => jackalRig({ variant: 1 }),
  jackal_v2: () => jackalRig({ variant: 2 }),
  jackal_alpha: () => jackalRig({ alpha: true }),
  scarab: () => scarabRig(),
  scarab_v1: () => scarabRig({ variant: 1 }),
  scarab_v2: () => scarabRig({ variant: 2 }),
  scarab_alpha: () => scarabRig({ alpha: true }),
  giant_scorpion: () => giantScorpionRig(),
  giant_scorpion_v1: () => giantScorpionRig({ variant: 1 }),
  giant_scorpion_v2: () => giantScorpionRig({ variant: 2 }),
  giant_scorpion_alpha: () => giantScorpionRig({ alpha: true }),
  vulture: () => vultureRig(),
  vulture_v1: () => vultureRig({ variant: 1 }),
  vulture_alpha: () => vultureRig({ alpha: true }),
  outlaw_rider: () => outlawRiderRig(),
  outlaw_rider_v1: () => outlawRiderRig({ variant: 1 }),
  outlaw_rider_v2: () => outlawRiderRig({ variant: 2 }),
  outlaw_rider_alpha: () => outlawRiderRig({ alpha: true }),
  big_bertha: () => bigBerthaRig(),
  dust_marshal_1: () => dustMarshalRig(1),
  dust_marshal_2: () => dustMarshalRig(2),
  dust_marshal_3: () => dustMarshalRig(3),
  sunroller: () => sunrollerRig(),
  sun_ball: () => sunBallModel(),
  sun_ball_rig: () => sunBallRig(),
  sand_wolf: () => sandWolfRig(),
  sand_wolf_alpha: () => sandWolfRig({ alpha: true }),
  dune_worm: () => duneWormRig(),
  dune_worm_alpha: () => duneWormRig({ alpha: true }),
  pharaoh: () => pharaohRig(),
  sandworm: () => sandwormRig({ segments: 8, scale: 1 }),
  sandworm_big: () => sandwormRig({ segments: 12, scale: 1.5 }),
  sethos_1: () => sethosRig(1),
  sethos_2: () => sethosRig(2),
  sethos_3: () => sethosRig(3),
  khonsu_avatar: () => khonsuAvatarRig(),
  khonsu_avatar_enraged: () => khonsuAvatarRig({ enraged: true }),
  khonsu_hand: () => khonsuHandRig(),
  // rain-frog family event, thorny lizards (+ Old Thornback miniboss), bell snakes
  rain_frog_mama: () => rainFrogMamaRig(),
  rain_frog_baby: () => rainFrogBabyRig({ variant: 0 }),
  rain_frog_baby_v1: () => rainFrogBabyRig({ variant: 1 }),
  rain_frog_baby_v2: () => rainFrogBabyRig({ variant: 2 }),
  rain_frog_baby_v3: () => rainFrogBabyRig({ variant: 3 }),
  rain_frog_baby_v4: () => rainFrogBabyRig({ variant: 4 }),
  rain_frog_moth: () => desertMothRig(),
  rain_frog_wig: () => ({ model: frogWigHat(), voxelSize: FROG_WIG_VS }),
  rain_frog_wig_hd: () => ({ model: frogWigHat(54), voxelSize: 1 / 54 }),
  thorny_lizard: () => thornyLizardRig(),
  thorny_lizard_v1: () => thornyLizardRig({ variant: 1 }),
  thorny_lizard_v2: () => thornyLizardRig({ variant: 2 }),
  thorny_lizard_alpha: () => thornyLizardRig({ alpha: true }),
  thorny_lizard_boss: () => thornbackRig(),
  bell_snake: () => bellSnakeRig(),
  bell_snake_alpha: () => bellSnakeRig({ alpha: true }),
  // wave 75: Khonsu returns as the desert itself (+ the sandstone spikes he raises)
  khonsu_sand: () => khonsuSandRig(),
  khonsu_sand_spike: () => khonsuSandSpikeModel(0),
};

// ---- ruin spiders (enemies/ruinSpider.ts): big hairy desert tarantulas nesting in the
// abandoned buildings (two colour morphs) and their brood mother (alpha). Def: run/RuinNests.ts
import { ruinSpiderRig } from './enemies/ruinSpider';
export const RUIN_SPIDER_MODELS: Record<string, ModelEntry> = {
  ruin_spider: () => ruinSpiderRig(),
  ruin_spider_v1: () => ruinSpiderRig({ variant: 1 }),
  ruin_spider_alpha: () => ruinSpiderRig({ alpha: true }),
};

// ---- the Heart of the Oasis army (creatures/oasis*.ts): crocodiles, land catfish on stumpy
// legs and walking flytraps (two colour morphs each, alphas). Defs: run/OasisHeart.ts
import { oasisCrocRig } from './creatures/oasisCroc';
import { oasisCatfishRig } from './creatures/oasisCatfish';
import { oasisFlytrapRig } from './creatures/oasisFlytrap';
export const OASIS_ARMY_MODELS: Record<string, ModelEntry> = {
  oasis_croc: () => oasisCrocRig(),
  oasis_croc_alpha: () => oasisCrocRig({ alpha: true }),
  oasis_catfish: () => oasisCatfishRig(),
  oasis_catfish_v1: () => oasisCatfishRig({ variant: 1 }),
  oasis_catfish_alpha: () => oasisCatfishRig({ alpha: true }),
  oasis_flytrap: () => oasisFlytrapRig(),
  oasis_flytrap_v1: () => oasisFlytrapRig({ variant: 1 }),
  oasis_flytrap_alpha: () => oasisFlytrapRig({ alpha: true }),
};
