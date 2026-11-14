// Which boss shows up on which wave of the Nile stage. Each Nile boss registers a
// factory here; a wave whose boss is not registered yet falls back to the desert
// roster. Gate bosses: the Sphinx at 50 (the river gate), Cleopatra at 75, Ra at 100.
import type { Boss, BossDeps } from './Boss';
import { CrocodileChampion } from './Crocodile';
import { RaSunKing } from './Ra';
import { Sphinx, prewarmSphinx } from './Sphinx';
import { Cleopatra, prewarmCleopatra } from './Cleopatra';

export type NileBossFactory = (d: BossDeps, tier: number) => Boss;

/** id -> factory; boss modules add themselves with one line each */
export const NILE_BOSSES: Record<string, NileBossFactory> = {};
NILE_BOSSES.crocodile = (d, tier) => new CrocodileChampion(d, tier);
NILE_BOSSES.ra = (d, tier) => new RaSunKing(d, tier);
NILE_BOSSES.sphinx = (d, tier) => new Sphinx(d, tier);
NILE_BOSSES.cleopatra = (d, tier) => new Cleopatra(d, tier);

/** optional warm-ups per boss id (e.g. an off-thread geometry build started a few waves early) */
export const NILE_PREWARM: Record<string, (ctx: BossDeps['ctx']) => void> = {};
NILE_PREWARM.sphinx = (ctx) => prewarmSphinx(ctx);
NILE_PREWARM.cleopatra = () => prewarmCleopatra();
/** call on every Nile wave start: warms the bosses of the next few waves */
export function nilePrewarm(ctx: BossDeps['ctx'], wave: number) {
  for (let w = wave; w <= wave + 5; w++) {
    const id = nileBossAt(w);
    if (id) NILE_PREWARM[id]?.(ctx);
  }
}

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
