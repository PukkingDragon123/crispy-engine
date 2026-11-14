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

// THOTH'S HALL wakes on the same ride: until a run has ended the temple door in the menu's dune stays
// shut, bound with cords and a clay seal, and nothing opens the hall. The first time the menu is shown
// after that, the seal breaks and the door swings in (remembered here, apart from the save).
const HALL_KEY = 'dustup-hall-awake';

/** the hall opens on the same "first ride is over" as the hideout */
export function hallOpen() {
  return hideoutOpen();
}

/** open, but the menu has not yet shown the door waking */
export function hallRevealPending() {
  if (!hallOpen()) return false;
  try {
    return localStorage.getItem(HALL_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markHallRevealed() {
  try {
    localStorage.setItem(HALL_KEY, '1');
  } catch {
    /* storage blocked: the door may wake again */
  }
}
