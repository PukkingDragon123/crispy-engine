// Registry for the wave-system expansion: the Curse Priests of Khonsu's court and
// THE IRONCLAD miniboss. Picked up automatically by lookup.ts (registry*.ts glob).
import type { ModelEntry } from './registryCharacters';
import { cursePriestRig } from './enemies/cursePriest';
import { ironcladRig } from './enemies/ironclad';

export const HORDE_MODELS: Record<string, ModelEntry> = {
  curse_priest: () => cursePriestRig(),
  curse_priest_alpha: () => cursePriestRig({ alpha: true }),
  ironclad: () => ironcladRig(1),
  ironclad_2: () => ironcladRig(2),
  ironclad_3: () => ironcladRig(3),
};
