// Admin testing mode: the tables the panel reads. Which boss rides on which wave (a mirror of
// bosses/BossRoster + NileRoster, for labels only), every boss the SPAWN tab can call up, and the
// named attacks each boss's dev hook (`boss.debug(name)`) queues.
import type { StageId } from '../meta/Stage';
import type { Boss, BossDeps } from '../bosses/Boss';
import { nileBossAt, NILE_BOSSES, NILE_PREWARM } from '../bosses/NileRoster';
import { KhonsuAvatar } from '../bosses/Khonsu';
import { KhonsuSandAvatar } from '../bosses/KhonsuSand';
import { BigBertha, DustMarshal, Sunroller, Pharaoh, Sandworm } from '../bosses/Minibosses';
import { Thornback } from '../bosses/Thornback';
import { Ironclad } from '../bosses/Ironclad';
import { Sethos } from '../bosses/Sethos';
import { RaSunKing } from '../bosses/Ra';
import { Sphinx } from '../bosses/Sphinx';
import { Cleopatra } from '../bosses/Cleopatra';

/** every fifth wave carries a boss on both stages */
export const BOSS_WAVES = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

/** the sub-area a wave is fought in (travel happens after 50 and after 75) */
export function areaFor(wave: number): 'A' | 'B' | 'C' {
  return wave > 75 ? 'C' : wave > 50 ? 'B' : 'A';
}

const NILE_NAMES: Record<string, string> = {
  crocodile: 'Sebekhotep, Jaw of the Nile',
  warship: 'The Golden Leviathan',
  sphinx: 'The Sphinx',
  cleopatra: 'Cleopatra',
  ra: 'Ra, the Sun King',
};

/** who fights on a boss wave (null: not a boss wave) */
export function bossLabel(stage: StageId, w: number): string | null {
  if (w % 5 !== 0 && w < 100) return null;
  if (stage === 'nile') {
    const id = nileBossAt(w);
    if (id) return NILE_NAMES[id] ?? id;
  }
  if (w >= 100) return 'Sethos, third form';
  if (w === 85) return 'Sethos, second form';
  if (w === 75) return 'Khonsu of the Sands';
  if (w === 50) return 'Sethos';
  if (w === 5 || w === 35 || w === 65) return 'Avatar of Khonsu';
  if (w === 10 || w === 25 || w === 40) return 'The Dust Marshal';
  const first: Record<number, string> = { 15: 'thornback', 20: 'ironclad', 30: 'sandworm', 45: 'bertha', 55: 'pharaoh', 60: 'sunroller' };
  const rot = ['bertha', 'sunroller', 'ironclad', 'sandworm', 'pharaoh', 'thornback'];
  const k = first[w] ?? rot[Math.floor(w / 5) % rot.length];
  return { thornback: 'Old Thornback', ironclad: 'The Ironclad', sandworm: 'The Sandworm', bertha: 'Big Bertha', pharaoh: 'Pharaoh Nekh-Amun', sunroller: 'The Sunroller' }[k] ?? k;
}

/** a gate boss (the big fights at 50 / 75 / 100, and Sethos at 85 on the dunes) */
export function isMajor(stage: StageId, w: number) {
  return w === 50 || w === 75 || w === 100 || (w === 85 && stage !== 'nile');
}

export interface BossEntry {
  label: string;
  stage: StageId;
  /** a Nile boss id (its geometry warms off-thread first) */
  nile?: string;
  make: (d: BossDeps, tier: number) => Boss;
}

const t3 = (t: number) => Math.max(1, Math.min(3, t)) as 1 | 2 | 3;

export const BOSS_LIST: BossEntry[] = [
  { label: 'Avatar of Khonsu', stage: 'desert', make: (d, t) => new KhonsuAvatar(d, t) },
  { label: 'The Dust Marshal', stage: 'desert', make: (d, t) => new DustMarshal(d, t3(t)) },
  { label: 'Old Thornback', stage: 'desert', make: (d, t) => new Thornback(d, t) },
  { label: 'The Ironclad', stage: 'desert', make: (d, t) => new Ironclad(d, t) },
  { label: 'The Sandworm', stage: 'desert', make: (d, t) => new Sandworm(d, t) },
  { label: 'Big Bertha', stage: 'desert', make: (d, t) => new BigBertha(d, t) },
  { label: 'Pharaoh Nekh-Amun', stage: 'desert', make: (d, t) => new Pharaoh(d, t) },
  { label: 'The Sunroller', stage: 'desert', make: (d, t) => new Sunroller(d, t) },
  { label: 'Sethos', stage: 'desert', make: (d, t) => new Sethos(d, t3(t)) },
  { label: 'Khonsu of the Sands', stage: 'desert', make: (d) => new KhonsuSandAvatar(d) },
  ...Object.keys(NILE_NAMES).map((id): BossEntry => ({ label: NILE_NAMES[id], stage: 'nile', nile: id, make: (d, t) => NILE_BOSSES[id](d, t) })),
];

/** warm a Nile boss's off-thread geometry (no-op for the rest) */
export function prewarmBoss(e: BossEntry, ctx: BossDeps['ctx']) {
  if (e.nile) NILE_PREWARM[e.nile]?.(ctx);
}

// the attacks each dev hook knows (the names in each boss's own debug() notes)
const MOVES_KHONSU = ['moonlightMile', 'midnightRambler', 'timeIsOnMySide', 'paintItBlack', 'mrMoonlight', 'shineALight', 'patience', 'lucyInTheSky', 'tomorrowNeverKnows', 'yesterday', 'twoThousandLightYears', 'novemberRain', 'rubyTuesday', 'deadFlowers', 'acrossTheUniverse', 'outOfTime', 'underMyThumb', 'youCouldBeMine', 'nightTrain', 'knockin'];
const MOVES_KHONSU_SAND = ['helterSkelter', 'mrBrownstone', 'shattered', 'startMeUp', 'brownSugar', 'comeTogether', 'gimmeShelter', 'childOfTheMoon', 'springTide', 'shineALight', 'lucy', 'patience', 'tomorrowNeverKnows', 'novemberRain', 'rubyTuesday', 'yesterday'];
const MOVES_RA = ['hereComesTheSun', 'shineALight', 'jumpinJackFlash', 'longWindingRoad', 'novemberRain', 'paintItBlack', 'liveAndLetDie', 'drift'];
const MOVES_CLEO = ['something', 'universe', 'prudence', 'rainbow', 'strawberry', 'goldenSlumbers', 'goodDay', 'beast', 'letItBleed', 'reinforce'];
const MOVES_SPHINX = ['bat', 'volley', 'pin', 'grab', 'pounce', 'whip', 'roar', 'roll', 'chase', 'riddle', 'flurry'];

/** the named attacks a boss's dev hook can queue (null: it has no hook) */
export function bossMoves(b: Boss): string[] | null {
  if (typeof (b as { debug?: unknown }).debug !== 'function') return null;
  if (b instanceof KhonsuSandAvatar) return MOVES_KHONSU_SAND;
  if (b instanceof KhonsuAvatar) return MOVES_KHONSU;
  if (b instanceof RaSunKing) return MOVES_RA;
  if (b instanceof Cleopatra) return MOVES_CLEO;
  if (b instanceof Sphinx) return MOVES_SPHINX;
  return [];
}

const TITLES: Record<string, string> = {
  knockin: "KNOCKIN' ON HEAVEN'S DOOR",
  twoThousandLightYears: '2000 LIGHT YEARS',
  lucyInTheSky: 'LUCY IN THE SKY',
  lucy: 'LUCY IN THE SKY',
  jumpinJackFlash: "JUMPIN' JACK FLASH",
  mrBrownstone: 'MR. BROWNSTONE',
  mrMoonlight: 'MR. MOONLIGHT',
  goodDay: 'GOOD DAY SUNSHINE',
  universe: 'ACROSS THE UNIVERSE',
  prudence: 'DEAR PRUDENCE',
  strawberry: 'STRAWBERRY FIELDS',
  rainbow: 'SHE IS A RAINBOW',
  beast: 'BEAST OF BURDEN',
  something: 'SOMETHING',
};
/** a camelCase move name as the song title it shouts */
export function moveTitle(id: string) {
  return TITLES[id] ?? id.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}
