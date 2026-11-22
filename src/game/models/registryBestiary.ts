// Registry of the music-reference bestiary (the BESTIARY worker's models): the Rolling Stone
// (and its elite), the Master of Puppets, the Beetles band and their colossus. Every rig gets
// the shared weathering pass (models/wear.ts: edge wear, grime in creases, sand dust).
import type { ModelEntry } from './registryCharacters';
import { weatherEntry, WEAR_ENEMY } from './wear';
import { rollingStoneRig } from './enemies/music/rollingStone';
import { puppeteerRig } from './enemies/music/puppeteer';
import { beetlesBandRig, beetlesColossusRig } from './enemies/music/beetles';

const W = { ...WEAR_ENEMY, dirtTo: 0 };
export const BESTIARY_MODELS: Record<string, ModelEntry> = {
  rolling_stone: () => weatherEntry(rollingStoneRig(), { ...W, scuffs: 0.3 }),
  rolling_stone_alpha: () => weatherEntry(rollingStoneRig({ alpha: true }), { ...W, scuffs: 0.3 }),
  master_puppets: () => weatherEntry(puppeteerRig(), W),
  beetles_band: () => weatherEntry(beetlesBandRig(), W),
  beetles_colossus: () => weatherEntry(beetlesColossusRig(), W),
};
