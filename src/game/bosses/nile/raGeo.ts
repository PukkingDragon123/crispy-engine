// Main-thread side of Ra's geometry: sculpted and meshed once per session in a worker
// (raWorker.ts), warmed a few waves ahead through NILE_PREWARM (his wrath apparition at
// wave 75, the fight at 100), so the sun god never stalls a frame when he rises. Ra.ts
// falls back to a synchronous build where workers are unavailable or the warm-up has
// not landed yet.
import type * as THREE from 'three';
import { cachedRigGeo, putRigGeo, type RigGeo } from '../../../engine/voxel/Rig';
import { unpackGeo, unpackRig, type GeoPack, type RigPack } from '../../../engine/voxel/RigTransfer';

export interface RaHD {
  head: THREE.BufferGeometry;
  jaw: THREE.BufferGeometry;
  eyeL: THREE.BufferGeometry;
  eyeR: THREE.BufferGeometry;
  meteors: THREE.BufferGeometry[];
  spires: THREE.BufferGeometry[];
  moon: THREE.BufferGeometry;
}
interface Msg {
  rig: RigPack;
  hd: { head: GeoPack; jaw: GeoPack; eyeL: GeoPack; eyeR: GeoPack; meteors: GeoPack[]; spires: GeoPack[]; moon: GeoPack };
}

/** the cache key the boss (and the wrath apparition) build Ra's body rig under */
export const RA_RIG_KEY = 'boss:ra';
let hd: RaHD | null = null;
let pending: Promise<void> | null = null;

/** the close-up parts from the background build, if it has landed */
export function raHDReady(): RaHD | null {
  return hd;
}

/** start (or join) the background build; resolves when it has landed (or failed: the sync path takes over) */
export function loadRaGeos(): Promise<void> {
  if (pending) return pending;
  if (cachedRigGeo(RA_RIG_KEY) && hd) return (pending = Promise.resolve());
  pending = new Promise<void>((resolve) => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('./raWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    if (!w) {
      resolve();
      return;
    }
    const t0 = performance.now();
    w.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      // a synchronous build that won the race keeps its own geometry
      if (!cachedRigGeo(RA_RIG_KEY)) putRigGeo(RA_RIG_KEY, unpackRig(m.rig) as RigGeo);
      if (!hd) hd = { head: unpackGeo(m.hd.head), jaw: unpackGeo(m.hd.jaw), eyeL: unpackGeo(m.hd.eyeL), eyeR: unpackGeo(m.hd.eyeR), meteors: m.hd.meteors.map(unpackGeo), spires: m.hd.spires.map(unpackGeo), moon: unpackGeo(m.hd.moon) };
      console.log(`[nile] Ra is built (${(performance.now() - t0).toFixed(0)} ms in the background)`);
      w!.terminate();
      resolve();
    };
    w.onerror = (e) => {
      console.warn('[nile] Ra worker failed, he will be built on the main thread', e.message);
      w!.terminate();
      resolve();
    };
    w.postMessage('build');
  });
  return pending;
}
