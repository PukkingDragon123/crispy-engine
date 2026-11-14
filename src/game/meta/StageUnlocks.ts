// Stages and heroes that a deed opens. Beating Khonsu of the Sands (desert wave 75) for
// the first time opens the Nile and frees Mark, the moon-mummy cat. Both are ordinary
// saved unlocks (save.prog.got, track 'feats' in meta/Unlocks), so the reveal card, the
// session list and `?unlocks=all` treat them like every other unlock. The picks
// themselves live in the save: `stage` (the menu's destination boards) and `hero`
// (Mark's crescent board by the hideout's barn doors).
import { Unlocks } from './Unlocks';
import { loadSave, writeSave } from './Save';
import type { HeroId, StageId } from './Stage';

export const NILE_UNLOCK = 'stage:nile';
export const MARK_UNLOCK = 'hero:mark';

export function nileOpen() {
  return Unlocks.has(NILE_UNLOCK);
}
export function markOpen() {
  return Unlocks.has(MARK_UNLOCK);
}

/** the first fall of Khonsu of the Sands: true when it opened something new (play the reveal) */
export function grantKhonsuSand(): boolean {
  const a = Unlocks.grant(NILE_UNLOCK);
  const b = Unlocks.grant(MARK_UNLOCK);
  return a || b;
}

/** the destination for the next ride (a sealed stage falls back to the dunes) */
export function chosenStage(): StageId {
  const s = loadSave().stage ?? 'desert';
  return s === 'nile' && !nileOpen() ? 'desert' : s;
}
export function setStage(s: StageId) {
  const d = loadSave();
  d.stage = s === 'nile' && !nileOpen() ? 'desert' : s;
  writeSave(d);
}

/** the hero for the next ride (a locked hero falls back to Sundown) */
export function chosenHero(): HeroId {
  const h = loadSave().hero ?? 'sundown';
  return h === 'mark' && !markOpen() ? 'sundown' : h;
}
export function setHero(h: HeroId) {
  const d = loadSave();
  d.hero = h === 'mark' && !markOpen() ? 'sundown' : h;
  writeSave(d);
}
