// Which boss shows up on which wave. The Avatar of Khonsu opens at wave 5 (and
// returns at 35 / 65), minibosses every 5th wave (rotating, tiering up), Sethos
// at 50 / 75 / 100. The Dust Marshal recurs (escapes at tiers 1-2).
import type { Boss, BossDeps } from './Boss';
import { BigBertha, DustMarshal, Sunroller, Pharaoh, Sandworm } from './Minibosses';
import { Sethos } from './Sethos';
import { KhonsuAvatar } from './Khonsu';
import { Thornback } from './Thornback';

export function makeBoss(d: BossDeps, wave: number): Boss {
  if (wave >= 100) return new Sethos(d, 3);
  if (wave === 75) return new Sethos(d, 2);
  if (wave === 50) return new Sethos(d, 1);
  const tier = 1 + Math.floor(wave / 35);
  // the first boss is always the Avatar of Khonsu; he returns stronger at 35 and 65
  if (wave === 5 || wave === 35 || wave === 65) return new KhonsuAvatar(d, wave === 5 ? 1 : wave === 35 ? 2 : 3);
  switch (wave) {
    case 10:
      return new DustMarshal(d, 1);
    case 25:
      return new DustMarshal(d, 2);
    case 40:
      return new DustMarshal(d, 3);
  }
  // Thornback, the thorny-devil matriarch, debuts at 15 (thorny devils roam from wave 7)
  const first: Record<number, string> = { 15: 'thornback', 20: 'pharaoh', 30: 'sandworm', 45: 'bertha', 55: 'sunroller' };
  const rot = ['bertha', 'sunroller', 'pharaoh', 'sandworm', 'thornback'];
  const k = first[wave] ?? rot[Math.floor(wave / 5) % rot.length];
  if (k === 'sunroller') return new Sunroller(d, tier);
  if (k === 'pharaoh') return new Pharaoh(d, tier);
  if (k === 'sandworm') return new Sandworm(d, tier);
  if (k === 'thornback') return new Thornback(d, tier);
  return new BigBertha(d, tier);
}
