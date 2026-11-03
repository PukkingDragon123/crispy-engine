// Run gear (Equipment) showcase models: `gear_<id>` keys for the tortoise-shop rug,
// the model viewer and any modelEntry() lookup. Picked up automatically by
// lookup.ts (glob over ./registry*.ts).
import type { ModelEntry } from './registryCharacters';
import { GEAR_MODEL_IDS, gearStatic } from './props/gear';

export const GEAR_MODELS: Record<string, ModelEntry> = Object.fromEntries(GEAR_MODEL_IDS.map((id) => [`gear_${id}`, () => gearStatic(id)]));
