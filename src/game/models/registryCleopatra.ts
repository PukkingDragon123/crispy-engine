// Cleopatra's court (wave 75 of the Nile): the queen, her ram-headed royal
// guards, her tamed lions, the golden royal barge and the sun scarabs.
// Picked up by models/lookup.ts (glob over registry*.ts).
import type { ModelEntry } from './registryCharacters';
import { cleoLionRig } from './cleopatra/lion';
import { cleoGuardRig } from './cleopatra/guard';
import { cleopatraRig } from './cleopatra/cleopatra';
import { cleoBargeRig } from './cleopatra/barge';

export const CLEOPATRA_MODELS: Record<string, ModelEntry> = {
  cleo_lion: () => cleoLionRig({ maned: true }),
  cleo_lioness: () => cleoLionRig({ maned: false }),
  cleo_guard: () => cleoGuardRig(),
  cleopatra: () => cleopatraRig(),
  cleo_barge: () => cleoBargeRig(),
};
