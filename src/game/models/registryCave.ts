// Registry of the sand-cave models (models/cave/*), picked up by lookup.ts like every
// registry*.ts. Only the records are exported: lookup.ts merges every exported object.
//   creatures: giant cave bats, crystal goblins (spear / slinger), crystal crabs, the Olm
//   props:     crystal clusters, stalactites (origin = ceiling attachment, pivot [0,0,0]),
//              stalagmites, glowing mushrooms
import type { ModelEntry } from './registryCharacters';
import { caveBatRig } from './cave/bat';
import { caveGoblinRig } from './cave/goblin';
import { crystalCrabRig } from './cave/crab';
import { olmRig } from './cave/olm';
import { caveCrystalCluster, stalactite, stalagmite, caveMushrooms } from './cave/props';

export const CAVE_CREATURE_MODELS: Record<string, ModelEntry> = {
  cave_bat: () => caveBatRig(),
  cave_bat_v1: () => caveBatRig({ variant: 1 }),
  cave_bat_alpha: () => caveBatRig({ alpha: true }),
  cave_goblin: () => caveGoblinRig(),
  cave_goblin_v1: () => caveGoblinRig({ variant: 1 }),
  cave_goblin_alpha: () => caveGoblinRig({ alpha: true }),
  cave_goblin_slinger: () => caveGoblinRig({ slinger: true }),
  cave_goblin_slinger_v1: () => caveGoblinRig({ slinger: true, variant: 1 }),
  cave_goblin_slinger_alpha: () => caveGoblinRig({ slinger: true, alpha: true }),
  crystal_crab: () => crystalCrabRig(),
  crystal_crab_v1: () => crystalCrabRig({ variant: 1 }),
  crystal_crab_alpha: () => crystalCrabRig({ alpha: true }),
  olm_boss: () => olmRig(),
};

export const CAVE_PROP_MODELS: Record<string, ModelEntry> = {
  cave_crystal_cyan_s: () => caveCrystalCluster('cyan', 0, 1),
  cave_crystal_cyan_m: () => caveCrystalCluster('cyan', 1, 2),
  cave_crystal_cyan_l: () => caveCrystalCluster('cyan', 2, 3),
  cave_crystal_violet_s: () => caveCrystalCluster('violet', 0, 4),
  cave_crystal_violet_m: () => caveCrystalCluster('violet', 1, 5),
  cave_crystal_violet_l: () => caveCrystalCluster('violet', 2, 6),
  cave_crystal_teal_m: () => caveCrystalCluster('teal', 1, 7),
  stalactite_0: () => stalactite(0),
  stalactite_1: () => stalactite(1),
  stalactite_2: () => stalactite(2),
  stalactite_3: () => stalactite(3),
  stalactite_curtain_0: () => stalactite(4),
  stalactite_curtain_1: () => stalactite(5),
  stalagmite_0: () => stalagmite(0),
  stalagmite_1: () => stalagmite(1),
  stalagmite_2: () => stalagmite(2),
  stalagmite_3: () => stalagmite(3),
  cave_mushrooms_0: () => caveMushrooms(0),
  cave_mushrooms_1: () => caveMushrooms(1),
  cave_mushrooms_2: () => caveMushrooms(2),
};
