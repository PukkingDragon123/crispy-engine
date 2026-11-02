// Which boss shows up on which wave. Minibosses every 5th wave (rotating, tiering
// up), Sethos at 50 / 75 / 100. The Dust Marshal recurs (escapes at tiers 1-2).
import type { Boss, BossDeps } from './Boss';
import { BigBertha, DustMarshal, Sunroller, Pharaoh, Sandworm } from './Minibosses';
import { Sethos } from './Sethos';

export function makeBoss(d: BossDeps, wave: number): Boss {
  if (wave >= 100) return new Sethos(d, 3);
  if (wave === 75) return new Sethos(d, 2);
  if (wave === 50) return new Sethos(d, 1);
  const tier = 1 + Math.floor(wave / 35);
  switch (wave) {
    case 10:
      return new DustMarshal(d, 1);
    case 25:
      return new DustMarshal(d, 2);
    case 40:
      return new DustMarshal(d, 3);
  }
  const first: Record<number, string> = { 5: 'bertha', 15: 'sunroller', 20: 'pharaoh', 30: 'sandworm' };
  const rot = ['bertha', 'sunroller', 'pharaoh', 'sandworm'];
  const k = first[wave] ?? rot[Math.floor(wave / 5) % rot.length];
  if (k === 'sunroller') return new Sunroller(d, tier);
  if (k === 'pharaoh') return new Pharaoh(d, tier);
  if (k === 'sandworm') return new Sandworm(d, tier);
  return new BigBertha(d, tier);
}
