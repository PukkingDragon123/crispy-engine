// The new-game order (STORY-B). A save whose forced tutorial is not finished boots into:
//   memory     the loading screen's "collecting pieces of memory"   (STORY-A: playMemoryPieces, optional)
//   backstory  the three-scene backstory cinematic                    (STORY-A: playBackstory)
//   title      the lore title over the dunes                          (cine/TombIntro.ts)
//   tomb       the first bounty, the Weeping Wall, Pinch, Serket      (cine/TombIntro.ts)
//   domain     Serket's domain: the forced tutorial                   (run/SerketDomain.ts)
//   scorpion   (debug) straight into the domain's soul scorpion fight
//   day        the first desert day (the wave director starts)
// Returning players with `tutorialDone` boot to the menu as before. Debug: ?newgame=1 (from the start),
// or ?newgame=<step> to jump into any step above. Thoth stays away until `tutorialDone` (see tutorialDone()).
import type { Engine } from '../../engine/Engine';
import { loadSave, writeSave } from '../meta/Save';
import { playTombIntro } from '../cine/TombIntro';
import { SerketDomain, type DomainHost } from './SerketDomain';

export type NewGameStep = 'memory' | 'backstory' | 'title' | 'tomb' | 'domain' | 'scorpion' | 'day';
const STEPS: NewGameStep[] = ['memory', 'backstory', 'title', 'tomb', 'domain', 'scorpion', 'day'];

/** the forced tutorial (Serket's domain) has been finished on this save */
export function tutorialDone() {
  return !!loadSave().tutorialDone;
}
export function markTutorialDone() {
  const d = loadSave();
  if (d.tutorialDone) return;
  d.tutorialDone = true;
  d.seenIntro = true;
  writeSave(d);
}

/** where the boot should start the new-game flow (null: the menu as usual) */
export function newGameStart(params: URLSearchParams): NewGameStep | null {
  const q = params.get('newgame');
  if (q !== null) return (STEPS as string[]).includes(q) ? (q as NewGameStep) : 'memory';
  if (params.get('debug')) return null;
  return tutorialDone() ? null : 'memory';
}

// STORY-A's pieces, found by name so this builds before (and after) they land
const STORY = import.meta.glob(['/src/game/**/*Backstory*.ts', '/src/game/**/*Memor*.ts']) as Record<string, () => Promise<Record<string, unknown>>>;
async function storyFn(name: string): Promise<((engine: Engine, o?: unknown) => Promise<unknown>) | null> {
  for (const load of Object.values(STORY)) {
    try {
      const m = await load();
      if (typeof m[name] === 'function') return m[name] as (engine: Engine, o?: unknown) => Promise<unknown>;
    } catch (e) {
      console.warn('[newgame] story module', e);
    }
  }
  return null;
}

/** the steps before the run exists (memory pieces, backstory); returns the step the run starts from */
export async function playPreRun(engine: Engine, from: NewGameStep): Promise<NewGameStep> {
  const at = STEPS.indexOf(from);
  if (at <= 0) {
    const mem = await storyFn('playMemoryPieces');
    if (mem) await mem(engine).catch((e) => console.warn('[newgame] memory pieces', e));
  }
  if (at <= 1) {
    const back = await storyFn('playBackstory');
    if (back) await back(engine).catch((e) => console.warn('[newgame] backstory', e));
  }
  return at <= 2 ? 'title' : from;
}

/** inside the run: the title and the tomb, then the domain; resolves when the first desert day may begin */
export async function playInRun(host: DomainHost & { introOn?: boolean }, from: NewGameStep) {
  const eng = host.engine as Engine;
  if (from === 'day') return;
  if (from === 'title' || from === 'tomb') {
    eng.input.enabled = false;
    host.hud?.setVisible ? host.hud.setVisible(false) : (host.hud.visible = false);
    eng.paused = true;
    try {
      await playTombIntro({ engine: eng, player: host.player, from });
    } catch (e) {
      console.error('[newgame] tomb', e);
    }
    eng.paused = false;
    eng.letterbox(false, 0.3);
    eng.flash(0xeafff4, 0.6, 0.5);
    eng.input.enabled = true;
  }
  host.hud?.setVisible ? host.hud.setVisible(true) : (host.hud.visible = true);
  try {
    await new SerketDomain(host, { fightOnly: from === 'scorpion' }).run();
  } catch (e) {
    console.error('[newgame] domain', e);
  }
  markTutorialDone();
  (window as any).__music?.setMood?.('explore');
}
