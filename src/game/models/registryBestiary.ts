// Registry of the music-reference bestiary (the BESTIARY worker's models): the Rolling Stone
// (and its elite), the Master of Puppets, the Beetles band and their colossus.
import type { ModelEntry } from './registryCharacters';
import { rollingStoneRig } from './enemies/music/rollingStone';
import { puppeteerRig } from './enemies/music/puppeteer';
import { beetlesBandRig, beetlesColossusRig } from './enemies/music/beetles';

export const BESTIARY_MODELS: Record<string, ModelEntry> = {
  rolling_stone: () => rollingStoneRig(),
  rolling_stone_alpha: () => rollingStoneRig({ alpha: true }),
  master_puppets: () => puppeteerRig(),
  beetles_band: () => beetlesBandRig(),
  beetles_colossus: () => beetlesColossusRig(),
};
