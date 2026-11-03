// Registry of the meerkat colony + giant jerboa models (picked up by lookup.ts).
// Only the record is exported: lookup.ts merges every exported object.
import type { ModelEntry } from './registryCharacters';
import { meerkatRig, beatleMeerkatRig } from './creatures/meerkat';
import { giantJerboaRig } from './creatures/jerboa';
import { meerkatWarrenModel, meerkatStallModel } from './creatures/colony';

export const CREATURE_MODELS: Record<string, ModelEntry> = {
  meerkat: () => meerkatRig(0),
  meerkat_b: () => meerkatRig(1),
  meerkat_trader: () => meerkatRig(2),
  meerkat_beatle_lime: () => beatleMeerkatRig('lime'),
  meerkat_beatle_sky: () => beatleMeerkatRig('sky'),
  meerkat_beatle_scarlet: () => beatleMeerkatRig('scarlet'),
  meerkat_beatle_pink: () => beatleMeerkatRig('pink'),
  /** NOTE: origin is the colony centre on the ground — mesh with pivot [0, 0, 0], not 'bottom' */
  meerkat_warren: () => meerkatWarrenModel(),
  meerkat_stall: () => meerkatStallModel(),
  giant_jerboa: () => giantJerboaRig(),
};

// ---- the hideout toads (creatures/toad.ts): Mama Toad by the hearth and her toadlets
import { mamaToadRig, toadletRig } from './creatures/toad';
export const TOAD_MODELS: Record<string, ModelEntry> = {
  mama_toad: () => mamaToadRig(undefined),
  toadlet: () => toadletRig({ variant: 0 }),
  toadlet_v1: () => toadletRig({ variant: 1 }),
  toadlet_v2: () => toadletRig({ variant: 2 }),
  toadlet_v3: () => toadletRig({ variant: 3 }),
};

// ---- the travelling trading post (creatures/turtleHouse.ts): Gobi, a giant turtle with
// a shop-house and an acacia on his shell, and Ozymandias, the tortoise who keeps it
import { turtleHouseRig, tortoiseGuyRig } from './creatures/turtleHouse';
export const TURTLE_HOUSE_MODELS: Record<string, ModelEntry> = {
  turtle_house: () => turtleHouseRig(),
  tortoise_guy: () => tortoiseGuyRig(),
};

// ---- the dromedary (creatures/camel.ts): a realistic pack camel (hump tufts, knobbly knees,
// lashed lids over modelled eyes, split lip, kilim blanket and packs; animate with CamelIdle).
// It replaces the old characters/npc.ts camel under the same key: lookup.ts merges the
// registries in file-name order, and registryCreatures loads after registryCharacters.
import { camelRig as dromedaryRig } from './creatures/camel';
export const CAMEL_MODELS: Record<string, ModelEntry> = {
  camel: () => dromedaryRig(),
};

// ---- desert wildlife (run/Wildlife.ts): sand hippos + calves (animate with HippoAnim), the
// little hopping jerboa (JerboaPupAnim) and the healing cacti (CactusSway; seeded variants).
// The cacti's origin is the stem on the ground (mesh the rig as-is, not 'bottom').
import { sandHippoRig, babyHippoRig } from './creatures/hippo';
import { jerboaPupRig } from './creatures/jerboaSmall';
import { healCactusRig } from './creatures/healCactus';
export const WILDLIFE_MODELS: Record<string, ModelEntry> = {
  sand_hippo: () => sandHippoRig(),
  sand_hippo_calf: () => babyHippoRig(),
  jerboa_pup: () => jerboaPupRig(),
  heal_cactus: () => healCactusRig(0, 'pear'),
  heal_cactus_v1: () => healCactusRig(1, 'pear'),
  heal_cactus_v2: () => healCactusRig(2, 'pear'),
  heal_cactus_barrel: () => healCactusRig(0, 'barrel'),
  heal_cactus_barrel_v1: () => healCactusRig(1, 'barrel'),
};
