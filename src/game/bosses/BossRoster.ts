// Which boss shows up on which wave. The Avatar of Khonsu opens at wave 5 (and
// returns at 35 / 65), minibosses every 5th wave (rotating, tiering up), Sethos
// at 50 / 85 / 100; at 75 Khonsu comes back as the desert itself. The Dust Marshal recurs (escapes at tiers 1-2).
// THE IRONCLAD debuts at 20 and comes back in the rotation (70 in Area B).
import type { Boss, BossDeps } from './Boss';
import { BigBertha, DustMarshal, Sunroller, Pharaoh, Sandworm } from './Minibosses';
import { Sethos } from './Sethos';
import { KhonsuAvatar } from './Khonsu';
import { Thornback } from './Thornback';
import { KhonsuSandAvatar } from './KhonsuSand';
import { Ironclad } from './Ironclad';

export function makeBoss(d: BossDeps, wave: number): Boss {
  if (wave >= 100) return new Sethos(d, 3);
  if (wave === 85) return new Sethos(d, 2);
  if (wave === 75) return new KhonsuSandAvatar(d);
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
  const first: Record<number, string> = { 15: 'thornback', 20: 'ironclad', 30: 'sandworm', 45: 'bertha', 55: 'pharaoh', 60: 'sunroller' };
  // rotation slot = floor(wave / 5) % 6 → 70 Ironclad, 80 Pharaoh, 90 Bertha, 95 Sunroller
  const rot = ['bertha', 'sunroller', 'ironclad', 'sandworm', 'pharaoh', 'thornback'];
  const k = first[wave] ?? rot[Math.floor(wave / 5) % rot.length];
  if (k === 'sunroller') return new Sunroller(d, tier);
  if (k === 'pharaoh') return new Pharaoh(d, tier);
  if (k === 'sandworm') return new Sandworm(d, tier);
  if (k === 'thornback') return new Thornback(d, tier);
  if (k === 'ironclad') return new Ironclad(d, tier);
  return new BigBertha(d, tier);
}
