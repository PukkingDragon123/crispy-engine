// The hideout opens after the first ride: until a run has ended (Save.runs, counted in awardRun at the
// end of every run) the menu's HIDEOUT board hangs in chains and every way into the hub routes to a ride
// instead (`?debug=hub` is exempt). The first time the menu is shown after that, the chains drop off with
// a small reveal; that moment is remembered here, apart from the save.
import { loadSave } from './Save';

const KEY = 'dustup-hideout-revealed';

export function hideoutOpen() {
  return loadSave().runs >= 1;
}

/** open, but the menu has not yet shown its chains falling away */
export function hideoutRevealPending() {
  if (!hideoutOpen()) return false;
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

export function markHideoutRevealed() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: the reveal may play again */
  }
}
