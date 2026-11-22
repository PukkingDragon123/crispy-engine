// Which boss shows up on which wave. The Dust Marshal opens at wave 5; the Avatar
// of Khonsu walks at wave 25 (and returns at 35 / 65), minibosses every 5th wave (rotating, tiering up), Sethos
// at 50 / 85 / 100; at 75 Khonsu comes back as the desert itself. The Dust Marshal recurs (escapes at tiers 1-2).
// THE IRONCLAD debuts at 15. BESTIARY: the Beetles (and their colossus) play 45 and return at 90; the Master of
// Puppets hangs over 70; Big Bertha moved to 80.
import type { Boss, BossDeps } from './Boss';
import { BigBertha, DustMarshal, Sunroller, Pharaoh, Sandworm } from './Minibosses';
import { Sethos } from './Sethos';
import { KhonsuAvatar } from './Khonsu';
import { Thornback } from './Thornback';
import { KhonsuSandAvatar } from './KhonsuSand';
import { Ironclad } from './Ironclad';
import { makeNileBoss } from './NileRoster';
import { MasterOfPuppets } from './music/MasterOfPuppets';
import { Beetles } from './music/Beetles';

export function makeBoss(d: BossDeps, wave: number): Boss {
  if (d.stage === 'nile') {
    const nb = makeNileBoss(d, wave);
    if (nb) return nb;
  }
  if (wave >= 100) return new Sethos(d, 3);
  if (wave === 85) return new Sethos(d, 2);
  if (wave === 75) return new KhonsuSandAvatar(d);
  if (wave === 50) return new Sethos(d, 1);
  const tier = 1 + Math.floor(wave / 35);
  // the avatar boss: the Avatar of Khonsu walks at wave 25, and returns stronger at 35 and 65
  if (wave === 25 || wave === 35 || wave === 65) return new KhonsuAvatar(d, wave === 25 ? 1 : wave === 35 ? 2 : 3);
  switch (wave) {
    case 5:
      return new DustMarshal(d, 1);
    case 20:
      return new DustMarshal(d, 2);
    case 40:
      return new DustMarshal(d, 3);
  }
  // Thornback, the thorny-devil matriarch, debuts at 15 (thorny devils roam from wave 7)
  const first: Record<number, string> = { 10: 'thornback', 15: 'ironclad', 30: 'sandworm', 45: 'beetles', 55: 'pharaoh', 60: 'sunroller', 70: 'puppets', 80: 'bertha' };
  // rotation slot = floor(wave / 5) % 6 → 90 the Beetles, 95 Sunroller
  const rot = ['beetles', 'sunroller', 'ironclad', 'sandworm', 'pharaoh', 'thornback'];
  const k = first[wave] ?? rot[Math.floor(wave / 5) % rot.length];
  if (k === 'beetles') return new Beetles(d, tier);
  if (k === 'puppets') return new MasterOfPuppets(d, tier);
  if (k === 'sunroller') return new Sunroller(d, tier);
  if (k === 'pharaoh') return new Pharaoh(d, tier);
  if (k === 'sandworm') return new Sandworm(d, tier);
  if (k === 'thornback') return new Thornback(d, tier);
  if (k === 'ironclad') return new Ironclad(d, tier);
  return new BigBertha(d, tier);
}
