import { Ultimate } from './game/player/Ultimate';
import './style.css';
import type { StageId, HeroId } from './game/meta/Stage';
import { Engine } from './engine/Engine';
import { DebugTerrainScene } from './game/scenes/DebugTerrainScene';
import { RunScene } from './game/scenes/RunScene';
import { MenuScene } from './game/scenes/MenuScene';
import { HubScene } from './game/scenes/HubScene';
import { nav } from './game/Nav';
import { loadSave, writeSave } from './game/meta/Save';
import { SOUNDS } from './game/audio/manifest';
import { Music } from './game/audio/Music';
import { voice } from './game/audio/BattleVoice';
import { LoadingScreen } from './game/ui/LoadingScreen';
import { hideoutOpen } from './game/meta/HideoutGate';
import { newGameStart, playPreRun, type NewGameStep } from './game/run/NewGame';
import { applySettings } from './game/ui/Settings';
import { gateAdmin } from './game/admin/AdminGate';
import { firstWaveOfDay } from './game/run/Days';

const params = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('app')!);
if (params.get('q') === 'low') engine.applyQuality({ shadows: false, pixelRatio: 0.5, bloom: false, shadowSize: 512 });
// phones and tablets: a 1024 sun shadow map (scenes ask for 2048 to 4096; the adaptive resolution does the rest)
else if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) engine.applyQuality({ shadowSize: 1024 });
(window as any).__engine = engine;
// anything that still escapes (a rejected cinematic promise, an event handler) is logged, never fatal
window.addEventListener('unhandledrejection', (e) => console.error('[dustUP] unhandled rejection', e.reason));
window.addEventListener('error', (e) => console.error('[dustUP] uncaught', e.error ?? e.message));
// the hourglass takes over the plain dark boot cover from index.html and stays up until the first scene is built
const loading = new LoadingScreen(document.getElementById('boot')!, { dpr: params.get('q') === 'low' ? 0.75 : 1.25, memory: newGameStart(params) === 'memory' || params.get('debug') === 'memory' });
engine.loader = loading;
(window as any).__loading = loading;
export const music = new Music(engine.audio, 'audio/');
(window as any).__music = music;
voice.attach(engine.audio, 'audio/');
Ultimate.onVoice = (cue) => { if (cue === 'cast') voice.play('ult'); };
engine.onAfterUpdate.push((dt, rdt) => music.update(rdt));
engine.start();
applySettings(engine);
// the admin testing mode: its own chunk, never loaded otherwise (game/admin/AdminGate: a VITE_ADMIN=1 build,
// ?admin=1 or #admin, the desktop app's --admin, or typing ADMIN anywhere, which also works inside an artifact frame)
gateAdmin(engine, params);

async function bootAssets() {
  // the pixel atlas renders onomatopoeia with Alagard: make sure it is decoded first
  await Promise.race([document.fonts.load('16px Alagard'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  loading.setProgress(0.05);
  const noAudio = params.get('mute') === '1';
  if (!noAudio) {
    await engine.audio.loadManifest(SOUNDS, 'audio/', (f) => loading.setProgress(0.05 + f * 0.6));
    await music.load().catch((e) => console.warn('music load failed', e));
    void voice.load();
  }
  // the rest of the glass runs while the first scene builds (Engine.setScene keeps the cover up)
  loading.setProgress(0.7);
}

async function main() {
  const debug = params.get('debug');
  if (debug === 'loading') {
    // the loading screen alone, held up: ?debug=loading&p=0.4 (a fixed fraction) or the sand cycling
    const p = params.get('p');
    if (p !== null) loading.setProgress(+p);
    else {
      void loading.show('Turning the glass');
      setInterval(() => void loading.hide().then(() => loading.show('Turning the glass')), 9000);
    }
    return;
  }
  // STORY-A: ?debug=memory holds the first-boot memory cover; ?debug=backstory plays the backstory (&bt=seconds, &contact=1)
  if (debug === 'memory') return void loading.show();
  if (debug === 'terrain') {
    await engine.setScene(new DebugTerrainScene(engine, params), 0, '#000', { loading: false });
    void loading.hide();
    return;
  }
  await bootAssets();
  const ride = (intro = false, newGame?: NewGameStep) => {
    const d = loadSave();
    if (intro) {
      d.seenIntro = true;
      writeSave(d);
    }
    void engine.setScene(
      new RunScene(engine, {
        area: (params.get('area') as 'A' | 'B' | 'C') ?? 'A',
        seed: params.get('seed') ? +params.get('seed')! : Math.floor(Math.random() * 99999),
        // ?day=N starts at the first wave of day N (WAVES_PER_DAY waves a day); ?wave=N still works
        startWave: params.get('day') ? firstWaveOfDay(+params.get('day')!) : +(params.get('wave') ?? 1),
        stage: (params.get('stage') as StageId) ?? d.stage ?? 'desert',
        hero: (params.get('hero') as HeroId) ?? d.hero ?? 'sundown',
        intro,
        newGame,
        look: d.look,
        gun: d.gun,
      }),
      0.6,
      // the menu zooms up into a blinding sky; the intro comes back down out of it
      intro ? '#fff4e0' : '#000',
      { loading: newGame ? 'The Weeping Wall' : 'Riding into the dunes' }
    );
  };
  nav.ride = ride;
  nav.menu = () => void engine.setScene(new MenuScene(engine, () => nav.ride(true)), 0.6, '#000', { loading: engine.current ? 'Back to camp' : 'Gathering souls' });
  nav.hub = () => {
    // the hideout is found on the first ride: until a run has ended, the way home leads out into the dunes
    if (!hideoutOpen() && debug !== 'hub') return nav.ride(false);
    void engine.setScene(new HubScene(engine, () => nav.ride(false), () => nav.menu()), 0.6, '#000', { loading: 'Back to the hideout' });
  };
  // a save that has not finished Serket's tutorial starts the new game (STORY-B, run/NewGame.ts); ?newgame=<step> jumps in
  const ng = newGameStart(params);
  if (ng) void playPreRun(engine, ng).then((s) => ride(false, s));
  else if (debug === 'run') {
    music.setMood('explore');
    nav.ride(params.get('intro') === '1');
  } else if (debug === 'hub') nav.hub();
  else if (debug === 'backstory') void import('./game/cine/Backstory').then((m) => m.playBackstory(engine, { contact: params.get('contact') === '1' })).then(() => nav.menu());
  else if (debug === 'death') void import('./game/scenes/DeathCine').then((m) => m.debugDeath(engine, params));
  else if (debug === 'cave') void import('./game/scenes/CaveScene').then((m) => m.debugCave(engine, { skipIntro: params.get('intro') === '0', olmNow: params.has('olm') }));
  else nav.menu();
  // ready once the first scene has finished building
  while (!engine.current || (engine.current as any).ready === false || loading.shown) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  (window as any).__ready = true;
}
main();
