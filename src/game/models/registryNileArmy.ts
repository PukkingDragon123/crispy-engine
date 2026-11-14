// Registry of Cleopatra's Nile army: soldiers, vessels, cannons and the two river captains.
import type { ModelEntry } from './registryCharacters';
import { crocChampionRig } from './nile/crocodile';
import { reedBoatRig, warBargeRig, bankCannonRig } from './nile/boats';
import { wolfLegionaryRig, jackalSpearmanRig, hippoShieldRig, falconArcherRig, baboonGunnerRig, ramDrummerRig } from './nile/soldiers';

export const NILE_ARMY_MODELS: Record<string, ModelEntry> = {
  nile_wolf: () => wolfLegionaryRig(),
  nile_wolf_v1: () => wolfLegionaryRig({ variant: 1 }),
  nile_wolf_v2: () => wolfLegionaryRig({ variant: 2 }),
  nile_wolf_alpha: () => wolfLegionaryRig({ alpha: true }),
  nile_jackal_spear: () => jackalSpearmanRig(),
  nile_jackal_spear_v1: () => jackalSpearmanRig({ variant: 1 }),
  nile_jackal_spear_alpha: () => jackalSpearmanRig({ alpha: true }),
  nile_hippo: () => hippoShieldRig(),
  nile_hippo_v1: () => hippoShieldRig({ variant: 1 }),
  nile_hippo_alpha: () => hippoShieldRig({ alpha: true }),
  nile_falcon: () => falconArcherRig(),
  nile_falcon_v1: () => falconArcherRig({ variant: 1 }),
  nile_falcon_alpha: () => falconArcherRig({ alpha: true }),
  nile_baboon: () => baboonGunnerRig(),
  nile_baboon_v1: () => baboonGunnerRig({ variant: 1 }),
  nile_baboon_alpha: () => baboonGunnerRig({ alpha: true }),
  nile_ram: () => ramDrummerRig(),
  nile_ram_v1: () => ramDrummerRig({ variant: 1 }),
  nile_ram_alpha: () => ramDrummerRig({ alpha: true }),
  nile_reed_boat: () => reedBoatRig(),
  nile_war_barge: () => warBargeRig(),
  nile_cannon: () => bankCannonRig(),
  nile_crocodile: () => crocChampionRig(),
  nile_crocodile_enraged: () => crocChampionRig({ enraged: true }),
};
