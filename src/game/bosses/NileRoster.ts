// Which boss shows up on which wave of the Nile stage. Each Nile boss registers a
// factory here; a wave whose boss is not registered yet falls back to the desert
// roster. Gate bosses: the Sphinx at 50 (the river gate), Cleopatra at 75, Ra at 100.
import type { Boss, BossDeps } from './Boss';

export type NileBossFactory = (d: BossDeps, tier: number) => Boss;

/** id -> factory; boss modules add themselves with one line each */
export const NILE_BOSSES: Record<string, NileBossFactory> = {};

/** which Nile boss id fights on a given wave (null = desert roster) */
export function nileBossAt(wave: number): string | null {
  if (wave >= 100) return 'ra';
  if (wave === 75) return 'cleopatra';
  if (wave === 50) return 'sphinx';
  if (wave % 5 !== 0) return null;
  // every 5th wave between the gates: Cleopatra's captains in rotation
  const rot = ['crocodile', 'warship'];
  return rot[Math.floor(wave / 5) % rot.length];
}

export function makeNileBoss(d: BossDeps, wave: number): Boss | null {
  const id = nileBossAt(wave);
  const f = id ? NILE_BOSSES[id] : undefined;
  return f ? f(d, 1 + Math.floor(wave / 35)) : null;
}
