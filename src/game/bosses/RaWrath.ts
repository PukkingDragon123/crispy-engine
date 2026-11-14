// RA'S WRATH — the beat right after Cleopatra falls (Nile, wave 75). She was
// his vessel. The sun swells red and Ra rises out of it, colossal over the
// horizon; his eyes open, he roars, and twin beams lance down across the land:
// the desert catches, the river boils, and the world burns into the lava land of
// region C. Then the run travels on (RunScene.travel waits for raWrathDone).
//
// Trigger: the Cleopatra boss emits 'raEnraged' on ctx.events (any args). As a
// fallback, a 'bossDefeated' for a boss named like Cleopatra on the Nile starts
// it too. The world burn goes through `world.burnToLava(k)` (NILE WORLD) when
// it exists; without it only the sky, the fire and the beams play.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { EnvPreset } from '../world/Env';
import { RigInstance } from '../../engine/voxel/Rig';
import { raGeos, raRigGeo } from './Ra';
import { raMaterial, Ribbon, EMBERS, FIRE_COLS } from './RaFx';
import { speak3D } from '../fx/WorldSpeech';
import { rnd } from '../../engine/math/rand';

const WRATH: Partial<EnvPreset> = {
  zenith: 0x2a0a0c, horizon: 0xff5a1e, ground: 0x4a1408, sunColor: 0xff8a40, sunIntensity: 3.4, hemiSky: 0xc04a2a, hemiGround: 0x7a2208, hemiIntensity: 1.1,
  fog: 0x8a2a14, fogNear: 40, fogFar: 340, exposure: 1.06, stars: 0, clouds: 0.6, cloudColor: 0xff7a3a,
};
const SMOKE = [0x4a3a34, 0x3a2c28, 0x6a5246];

interface WrathDeps {
  ctx: Ctx;
  cam: CameraRig;
  player: Player;
}
const PENDING = new WeakMap<Ctx, Promise<void>>();

/** RunScene.travel awaits this before it leaves for region C (resolves at once if nothing is playing) */
export function raWrathDone(ctx: Ctx): Promise<void> {
  return PENDING.get(ctx) ?? Promise.resolve();
}

/** listen for Cleopatra's fall on the Nile stage; returns the unsubscribe */
export function installRaWrath(d: WrathDeps): () => void {
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    const p = playRaWrath(d).catch((e) => console.warn('[ra wrath]', e));
    PENDING.set(d.ctx, p);
    void p.then(() => PENDING.delete(d.ctx));
  };
  const offs = [
    d.ctx.events.on('raEnraged', () => go()),
    d.ctx.events.on('bossDefeated', (b: { name?: string }, escaped: boolean) => {
      if (!escaped && /cleopatra/i.test(b?.name ?? '')) d.ctx.engine.tweens.after(0.6, go, true);
    }),
  ];
  (window as any).__raWrath = go; // dev handle: __raWrath()
  return () => {
    for (const o of offs) o();
    if ((window as any).__raWrath === go) (window as any).__raWrath = null;
  };
}

function mixEnv(a: EnvPreset, b: Partial<EnvPreset>, k: number): EnvPreset {
  const o = { ...a } as EnvPreset;
  const c = new THREE.Color(), e = new THREE.Color();
  for (const key of ['zenith', 'horizon', 'ground', 'sunColor', 'hemiSky', 'hemiGround', 'fog', 'cloudColor'] as const) if (b[key] !== undefined) o[key] = c.setHex(a[key]).lerp(e.setHex(b[key]!), k).getHex();
  for (const key of ['sunIntensity', 'hemiIntensity', 'fogNear', 'fogFar', 'exposure', 'stars', 'clouds'] as const) if (b[key] !== undefined) o[key] = a[key] + (b[key]! - a[key]) * k;
  return o;
}

async function playRaWrath(d: WrathDeps) {
  const { ctx, cam, player } = d;
  const eng = ctx.engine;
  const tw = eng.tweens;
  const world = ctx.world as unknown as { burnToLava?: (k: number) => void };
  const wait = (s: number) => tw.wait(s, true);
  eng.input.enabled = false;
  eng.letterbox(true, 0.6);
  // the apparition: Ra himself, colossal, rising out of the sun on the horizon
  const geo = raRigGeo();
  const G = raGeos();
  const fx = { value: new THREE.Vector4(0, 1, 0.6, 0) };
  const ra = { value: new THREE.Vector4(1.3, 1, 1.6, 1.4) };
  const mat = raMaterial(fx, ra, 'wrath', { fog: false });
  const rig = new RigInstance(geo, { material: mat, castShadow: false });
  for (const [part, g] of [['head', G.head], ['jaw', G.jaw], ['eye_l', G.eyeL], ['eye_r', G.eyeR]] as const) {
    const m = new THREE.Mesh(g, mat);
    rig.nodes[part].add(m);
    rig.meshes[part].visible = false;
  }
  const env = ctx.world.env;
  const base = { ...env.preset };
  const sun = env.sunDir.clone();
  const pp = player.pos.clone();
  // he stands where the sun is, low over the horizon
  const flat = new THREE.Vector3(sun.x, 0, sun.z);
  if (flat.lengthSq() < 1e-4) flat.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  flat.normalize();
  const D = 240, SC = 2.6;
  const at = pp.clone().addScaledVector(flat, D);
  at.y = pp.y - 18;
  rig.root.position.copy(at);
  rig.root.scale.setScalar(SC);
  rig.root.rotation.y = Math.atan2(pp.x - at.x, pp.z - at.z);
  rig.root.visible = false;
  ctx.scene.add(rig.root);
  const n = rig.nodes;
  const side = new THREE.Vector3(flat.z, 0, -flat.x);
  let t = 0, jaw = 0, eye = 0.2, beat = 0.4;
  const pose = (dt: number) => {
    t += dt;
    const ph = t * (2 + beat);
    for (const s of [1, -1]) {
      const f = s > 0 ? '_l' : '_r';
      n['wing' + f].rotation.set(0, 0, s * (Math.sin(ph) * (0.1 + beat * 0.12) + 0.08));
      n['wing2' + f].rotation.set(0, 0, s * Math.sin(ph - 0.7) * (0.07 + beat * 0.08));
      n['wing3' + f].rotation.set(0, 0, s * Math.sin(ph - 1.3) * (0.06 + beat * 0.07));
    }
    for (let i = 1; i <= 4; i++) n['tail' + i].rotation.set(0.05 * Math.sin(t * 1.3 - i * 0.8), 0, 0.07 * Math.sin(t * 0.95 - i * 0.7));
    n['torso'].rotation.set(0.12 + Math.sin(t * 0.8) * 0.02, 0, 0);
    n['head'].rotation.set(0.32 + Math.sin(t * 0.5) * 0.02, 0, Math.sin(t * 0.4) * 0.03);
    n['jaw'].rotation.x = jaw + (jaw > 0.2 ? Math.sin(t * 30) * 0.03 : 0);
    n['brow_l'].rotation.z = 0.26;
    n['brow_r'].rotation.z = -0.26;
    n['core'].rotation.z += dt * 0.2;
    for (const s of [0, 1]) {
      const a = n[s === 0 ? 'arm_l' : 'arm_r'];
      a.rotation.set(-0.3, 0, (s === 0 ? 1 : -1) * 0.45);
      n[s === 0 ? 'fore_l' : 'fore_r'].rotation.set(-0.5, 0, 0);
    }
    // the eyes kindle: the whole god burns brighter as he wakes
    ra.value.x = 1.0 + eye * 0.5;
    fx.value.z = 0.3 + eye * 0.5;
  };
  const tick = (dt: number, rdt: number) => {
    void dt;
    pose(rdt);
  };
  eng.onAfterUpdate.push(tick);
  const eyeWorld = (s: number, out: THREE.Vector3) => {
    const e = n[s === 0 ? 'eye_l' : 'eye_r'];
    e.updateWorldMatrix(true, false);
    return e.getWorldPosition(out);
  };
  const head = () => {
    rig.root.updateMatrixWorld(true);
    return n['head'].localToWorld(new THREE.Vector3(0, 2.4, 1.2));
  };
  const beams = [new Ribbon(28, { core: 0xfff6e0, edge: 0xff7a22, flow: 9 }), new Ribbon(28, { core: 0xfff6e0, edge: 0xff7a22, flow: 9 })];
  for (const b of beams) {
    b.intensity = 0;
    ctx.scene.add(b.mesh);
  }
  try {
    // 1) the sun swells and reddens; something rises out of it
    ctx.sfx('quake_rumble', pp, 1, 0.45);
    ctx.sfx('thunder', null, 1, 0.5);
    const camA = pp.clone().addScaledVector(flat, -7).addScaledVector(side, 2.5);
    camA.y = Math.max(pp.y, ctx.world.groundAt(camA.x, camA.z)) + 1.5;
    rig.root.visible = true;
    for (let k = 0; k < 1; k += 1 / 75) {
      env.apply(mixEnv(base, WRATH, k));
      fx.value.y = 1 - k; // he burns in out of the glare
      rig.root.position.y = at.y - 60 * (1 - k) * (1 - k);
      cam.setCine({ pos: camA, look: head().lerp(pp, 0.35), fov: 54 });
      if (rnd.chance(0.3)) ctx.shake(0.1);
      await wait(1 / 30);
    }
    fx.value.y = 0;
    eng.flash(0xffc080, 0.4, 0.6);
    // 2) the eyes open; the roar
    const h = head();
    const camB = pp.clone().addScaledVector(flat, -3).add(new THREE.Vector3(0, 1.4, 0));
    camB.y = Math.max(camB.y, ctx.world.groundAt(camB.x, camB.z) + 1.4);
    ctx.sfx('divine_power', pp, 1, 0.45);
    for (let k = 0; k < 1; k += 1 / 30) {
      eye = k;
      cam.setCine({ pos: camB, look: h, fov: 16 - k * 3 });
      await wait(1 / 30);
    }
    jaw = 0.42;
    beat = 1.6;
    ctx.sfx('boss_roar', pp, 1, 0.4);
    ctx.sfx('anubis_roar', pp, 1, 0.5);
    ctx.shake(0.9);
    speak3D(eng, 'setAvatar', 'You broke my vessel. Then I come myself, and the river burns.', n['head'], { key: 'ra:wrath', lift: 4 * SC, side: 6 * SC, size: 0.3, px: 64, wrap: 26, color: '#fff1dc', glow: '#ffb050', hdr: 1.8, hold: 3.4 });
    ctx.toast('« Sympathy for the Devil »', '#ffc860', 'Ra');
    for (let k = 0; k < 2.6; k += 1 / 30) {
      cam.setCine({ pos: camB, look: h, fov: 13 });
      await wait(1 / 30);
    }
    jaw = 0.12;
    // 3) the eyes lance down: the land catches, the river boils into lava
    const camC = pp.clone().addScaledVector(flat, -16).addScaledVector(side, -10);
    camC.y = Math.max(pp.y, ctx.world.groundAt(camC.x, camC.z)) + 12;
    const strikes: THREE.Vector3[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2, r = 14 + i * 7;
      const p = pp.clone().addScaledVector(flat, Math.cos(a) * r * 0.8).addScaledVector(side, Math.sin(a) * r);
      p.y = ctx.world.groundAt(p.x, p.z);
      strikes.push(p);
    }
    let si = 0, ts = 0;
    for (let k = 0; k < 5.2; k += 1 / 30) {
      const kk = k / 5.2;
      world.burnToLava?.(Math.min(1, kk * 1.25));
      cam.setCine({ pos: camC.clone().add(new THREE.Vector3(0, kk * 6, 0)), look: pp.clone().addScaledVector(flat, 20).add(new THREE.Vector3(0, 6 + kk * 10, 0)), fov: 60 + kk * 8 });
      // the beams walk across the land
      ts += 1 / 30;
      const hit = strikes[Math.min(strikes.length - 1, si)];
      for (let j = 0; j < 2; j++) {
        const eyeP = eyeWorld(j, new THREE.Vector3());
        beams[j].beam(eyeP, hit.clone().addScaledVector(side, j === 0 ? 1 : -1), 6, 3, 1.5, t);
        beams[j].intensity = k < 4.6 ? 1 : Math.max(0, 1 - (k - 4.6) * 2);
        beams[j].update(ctx.camera);
      }
      if (ts > 0.65 && si < strikes.length) {
        ts = 0;
        const p = strikes[si++];
        ctx.fx.explosion({ x: p.x, y: p.y + 1, z: p.z }, 4.5);
        ctx.sfx('explosion_big', p, 0.9, 0.6 + rnd.next() * 0.2);
        ctx.events.emit('groundMark', p.x, p.z, 5, 1);
        ctx.world.deform(p.x, p.z, 3, 0.7);
        ctx.shake(0.4);
      }
      // the field catches fire
      for (let i = 0; i < 6; i++) {
        const x = pp.x + (rnd.next() - 0.5) * 90, z = pp.z + (rnd.next() - 0.5) * 90;
        const y = ctx.world.groundAt(x, z);
        if (rnd.chance(kk + 0.2)) ctx.particles.emit({ pos: { x, y: y + 0.2, z }, count: 2, spread: 1.5, up: 4 + kk * 4, life: [0.5, 1.1], size: [1.6, 0.2], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 1.2, gravity: -2 });
        if (rnd.chance(0.15)) ctx.particles.emit({ pos: { x, y: y + 1, z }, count: 1, spread: 1.5, up: 2.5, life: [2, 3.5], size: [3, 8], sprite: ['cloud0', 'cloud1', 'cloud2'], color: SMOKE, alpha: 0.6, drag: 0.8, rot: 6, rotSpeed: 0.3 });
      }
      await wait(1 / 30);
    }
    world.burnToLava?.(1);
    // 4) he sinks back into the sun; the land is burning
    jaw = 0;
    for (let k = 0; k < 1; k += 1 / 45) {
      fx.value.y = k;
      cam.setCine({ pos: camC.clone().add(new THREE.Vector3(0, 6, 0)), look: pp.clone().addScaledVector(flat, 20).add(new THREE.Vector3(0, 16, 0)), fov: 68 });
      await wait(1 / 30);
    }
  } finally {
    const i = eng.onAfterUpdate.indexOf(tick);
    if (i >= 0) eng.onAfterUpdate.splice(i, 1);
    for (const b of beams) b.dispose();
    rig.root.removeFromParent();
    mat.dispose();
    cam.setCine(null);
    eng.letterbox(false, 0.4);
    eng.input.enabled = true;
  }
}
