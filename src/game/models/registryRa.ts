// Registry of Ra, the Sun King (the Nile stage's wave-100 boss) and the things he
// throws (picked up by lookup.ts; only the record is exported).
import type { ModelEntry } from './registryCharacters';
import { raRig, fireFalconRig, sunMeteorModel, obsidianSpireModel, eclipseMoonModel } from './enemies/ra';

export const RA_MODELS: Record<string, ModelEntry> = {
  ra: () => raRig(),
  ra_falcon: () => fireFalconRig(),
  ra_meteor: () => sunMeteorModel(0),
  /** origin = ground under the spire */
  ra_spire: () => obsidianSpireModel(0),
  ra_moon: () => eclipseMoonModel(),
};
