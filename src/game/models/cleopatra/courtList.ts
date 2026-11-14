// The rigs of Cleopatra's court, by key, in the order the arrival needs them.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { cleopatraRig } from './cleopatra';
import { cleoGuardRig } from './guard';
import { cleoLionRig } from './lion';
import { cleoBargeRig } from './barge';
import { cleoScarabRig } from './scarab';

export const COURT_BUILDERS: Record<string, () => RigSpec> = {
  cleo_barge: () => cleoBargeRig(),
  cleopatra: () => cleopatraRig(),
  cleo_guard: () => cleoGuardRig(),
  cleo_lion: () => cleoLionRig({ maned: true }),
  cleo_lioness: () => cleoLionRig({ maned: false }),
  cleo_scarab0: () => cleoScarabRig(0),
  cleo_scarab1: () => cleoScarabRig(1),
};
export const COURT_ORDER = ['cleo_barge', 'cleopatra', 'cleo_guard', 'cleo_lion', 'cleo_lioness', 'cleo_scarab0', 'cleo_scarab1'];
