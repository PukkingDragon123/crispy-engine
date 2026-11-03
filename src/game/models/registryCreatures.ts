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
