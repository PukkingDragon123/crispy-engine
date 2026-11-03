// Moves: things Sundown can do that are not tarot abilities. The tarot bar holds
// only three active skills (Magician / Tower / Sun) plus the Death ultimate;
// everything else is a move you perform with the board, the gun and timing.
// Base moves are always known; the rest unlock permanently (saved).
import { loadSave, writeSave } from '../meta/Save';

export type TechniqueId = 'push' | 'drift' | 'grapple' | 'kick' | 'neck_slicer' | 'sand_kick' | 'wall_ride' | 'manual' | 'dune_surf';

/** board moves that unlock permanently; the run hooks live in player/BoardMoves */
export const MOVE_UNLOCKS = {
  /** Bounty Rank reached in a run */
  sand_kick: { rank: 3 },
  manual: { rank: 6 },
  /** any boss defeated (not escaped) */
  wall_ride: { boss: true },
  /** a style combo banked at this multiplier or better */
  dune_surf: { combo: 3 },
} as const;

export interface Technique {
  id: TechniqueId;
  name: string;
  /** one line: how to perform it */
  how: string;
  /** shown while locked */
  unlockHint: string;
  /** known from the start */
  base: boolean;
  /** tarot / vignette art key (TarotCards def key or SkillArt key) */
  art: string;
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'push',
    name: 'Kick-Push',
    how: 'Tap SHIFT: plant a foot and kick. Push again as the foot lands back on the deck (on the beat) for a PERFECT PUSH; a perfect streak builds speed, mashing only scuffs. Push right after a clean landing for a LANDING PUSH. W leans in to hold speed, S sits back to brake.',
    unlockHint: '',
    base: true,
    art: '',
  },
  {
    id: 'drift',
    name: 'Sand Drift',
    how: 'Hold SHIFT through an A / D carve: the tail kicks out in a spray of sand, release to sling out of it. JUMP mid-drift for a SPIN LAUNCH. Drift through an enemy to slash it with the board. Chain moves for a style combo.',
    unlockHint: '',
    base: true,
    art: '',
  },
  { id: 'grapple', name: "The Hanged Man's Rope", how: 'Q — lasso a post, a beast or a bounty and swing.', unlockHint: '', base: true, art: 'Q' },
  { id: 'kick', name: 'Strength', how: 'F — a spur kick that knocks the dust out of anything close.', unlockHint: '', base: true, art: 'F' },
  {
    id: 'neck_slicer',
    name: 'The Neck Slicer',
    how: 'Hold JUMP to charge the board near an enemy. When the gold ring snaps shut on its neck, FIRE.',
    unlockHint: 'Defeat the Avatar of Khonsu (wave 5).',
    base: false,
    art: 'neck_slicer',
  },
  {
    id: 'sand_kick',
    name: 'Sand Kick',
    how: 'In the air, tap JUMP: stamp a burst of sand out of nothing and hop again. Once per air (a wall kick gives it back).',
    unlockHint: 'Reach Bounty Rank 3 in a run.',
    base: false,
    art: '',
  },
  {
    id: 'wall_ride',
    name: 'Wall Ride',
    how: 'Jump into a cliff or a ruin wall at an angle (or hold JUMP into it at speed): ride along the face, then JUMP to kick off it.',
    unlockHint: 'Defeat a boss.',
    base: false,
    art: '',
  },
  {
    id: 'manual',
    name: 'Nose Manual',
    how: 'Double-tap W: rock onto the nose and glide with almost no drag. Keep it balanced with W / S, JUMP to pop a nollie out of it, double-tap W to set it down.',
    unlockHint: 'Reach Bounty Rank 6 in a run.',
    base: false,
    art: '',
  },
  {
    id: 'dune_surf',
    name: 'Dune Surf',
    how: 'Hold JUMP to tuck down a dune face or a living-sand wave: the slope pours its speed into the board.',
    unlockHint: 'Bank a x3 style combo.',
    base: false,
    art: '',
  },
];

const KEY = (id: TechniqueId) => 'move:' + id;

function debugAll() {
  try {
    return new URLSearchParams(location.search).get('moves') === 'all';
  } catch {
    return false;
  }
}

export function isUnlocked(id: TechniqueId) {
  const t = TECHNIQUES.find((x) => x.id === id);
  if (!t) return false;
  if (t.base || debugAll()) return true;
  return loadSave().unlocked.includes(KEY(id));
}

/** returns true when this call newly unlocked it */
export function unlock(id: TechniqueId) {
  if (isUnlocked(id)) return false;
  const s = loadSave();
  s.unlocked.push(KEY(id));
  writeSave(s);
  return true;
}

export function technique(id: TechniqueId) {
  return TECHNIQUES.find((x) => x.id === id)!;
}
