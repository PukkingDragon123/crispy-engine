// Consumable item models (Sundown's pockets): HD props looked up by key (ITEMS[].model).
import type { ModelEntry } from './registryCharacters';
import { CONSUMABLES, consumable } from './characters/consumables';

export const ITEM_MODELS: Record<string, ModelEntry> = {};
for (const k of Object.keys(CONSUMABLES)) ITEM_MODELS[k] = () => consumable(k)!;
