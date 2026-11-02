import './style.css';
import { Engine } from './engine/Engine';
import { DebugTerrainScene } from './game/scenes/DebugTerrainScene';
import { RunScene } from './game/scenes/RunScene';
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
  if (debug === 'run' || !debug) {
    music.setMood('explore');
    await engine.setScene(
      new RunScene(engine, {
        area: (params.get('area') as 'A' | 'B' | 'C') ?? 'A',
        seed: +(params.get('seed') ?? 7),
        startWave: +(params.get('wave') ?? 1),
      }),
      0.6
    );
    (window as any).__ready = true;
  }
}
main();
