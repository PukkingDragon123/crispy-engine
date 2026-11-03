// Moves: things Sundown can do that are not tarot abilities. The tarot bar holds
// only three active skills (Magician / Tower / Sun) plus the Death ultimate;
// everything else is a move you perform with the board, the gun and timing.
// Base moves are always known; the rest unlock permanently (saved).
import { loadSave, writeSave } from '../meta/Save';

export type TechniqueId = 'grapple' | 'kick' | 'neck_slicer';

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
