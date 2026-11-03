import './style.css';
import { Engine } from './engine/Engine';
import { DebugTerrainScene } from './game/scenes/DebugTerrainScene';
import { RunScene } from './game/scenes/RunScene';
import { MenuScene } from './game/scenes/MenuScene';
import { HubScene } from './game/scenes/HubScene';
import { nav } from './game/Nav';
import { loadSave, writeSave } from './game/meta/Save';
import { SOUNDS } from './game/audio/manifest';
import { Music } from './game/audio/Music';

const params = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('app')!);
if (params.get('q') === 'low') engine.applyQuality({ shadows: false, pixelRatio: 0.5, bloom: false, shadowSize: 512 });
(window as any).__engine = engine;
export const music = new Music(engine.audio, 'audio/');
(window as any).__music = music;
engine.onAfterUpdate.push((dt, rdt) => music.update(rdt));
engine.start();

const boot = document.getElementById('boot')!;
const fill = document.getElementById('boot-fill')!;
const msg = document.getElementById('boot-msg')!;
const LINES = ['Saddling up…', 'Polishing the revolver…', 'Waking Pinch…', 'Counting bounties…', 'Sweeping sand off the dunes…', 'Consulting Serket…'];

async function bootAssets() {
  // the pixel atlas renders onomatopoeia with Alagard: make sure it is decoded first
  await Promise.race([document.fonts.load('16px Alagard'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  let i = 0;
  const tick = setInterval(() => (msg.textContent = LINES[i++ % LINES.length]), 900);
  const noAudio = params.get('mute') === '1';
  if (!noAudio) {
    await engine.audio.loadManifest(SOUNDS, 'audio/', (f) => (fill.style.width = `${Math.round(f * 80)}%`));
    await music.load().catch((e) => console.warn('music load failed', e));
  }
  fill.style.width = '100%';
  clearInterval(tick);
  boot.style.opacity = '0';
  setTimeout(() => (boot.style.display = 'none'), 800);
}

async function main() {
  const debug = params.get('debug');
  if (debug === 'terrain') {
    boot.style.display = 'none';
    await engine.setScene(new DebugTerrainScene(engine, params), 0);
    return;
  }
  await bootAssets();
  nav.ride = (intro = false) => {
    const d = loadSave();
    if (intro) {
      d.seenIntro = true;
      writeSave(d);
    }
    void engine.setScene(
      new RunScene(engine, {
        area: (params.get('area') as 'A' | 'B' | 'C') ?? 'A',
        seed: params.get('seed') ? +params.get('seed')! : Math.floor(Math.random() * 99999),
        startWave: +(params.get('wave') ?? 1),
        intro,
        look: d.look,
        gun: d.gun,
      }),
      0.6,
      // the menu zooms up into a blinding sky; the intro comes back down out of it
      intro ? '#fff4e0' : '#000'
    );
  };
  nav.menu = () => void engine.setScene(new MenuScene(engine, () => nav.ride(true)), 0.6);
  nav.hub = () => void engine.setScene(new HubScene(engine, () => nav.ride(false), () => nav.menu()), 0.6);
  if (debug === 'run') {
    music.setMood('explore');
    nav.ride(params.get('intro') === '1');
  } else if (debug === 'hub') nav.hub();
  else nav.menu();
  // ready once the first scene has finished building
  while (!engine.current || (engine.current as any).ready === false) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  (window as any).__ready = true;
}
main();
