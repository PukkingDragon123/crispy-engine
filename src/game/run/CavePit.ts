// The way down: a mysterious SAND PIT at every `cavePit` anchor (RegionGen) — a sinkhole
// funnel dug into the dune, three spiralling sand ridges slowly swirling down into a
// dark throat that glows faintly cyan from below, small crystals poking through the
// slopes, and bones (skulls, a rib arch, scattered bones) half buried around the rim.
// Something leads you to it: as you come near, a jerboa pops up ahead and bounces
// toward the pit, stopping to look back at you, a trail of glowing crystal shards
// rises out of the sand behind it, and whispers drift up from the hole. Ride into the
// funnel and the sand takes you: the board is dragged round the vortex and swallowed,
// the screen goes black … and you wake up in the Glass Hollow (scenes/CaveScene.ts).
// When you come back (the Olm's geyser), the pit erupts and spits you out onto the
// dunes, then slumps shut for good.
//
// CavePit HOSTS the cave stage inside RunScene: while `stage` is set, RunScene forwards
// update / postRender here; the desert stays frozen exactly as it was, and the run goes
// down and comes back up as a RunCarry.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
// (see the hooks in the cave report; the gist)
//   import { CavePit } from '../run/CavePit';
//   cavePit: CavePit | null = null;
//   enter(): after `this.ruins = new RuinNests(...)`:
//     this.cavePit = new CavePit({ ctx: this.ctx, player: this.player, cam: this.camRig, hud: this.hud,
//       look: this.opts.look, gun: this.opts.gun, seed: this.opts.seed,
//       carry: () => this.caveCarry(), restore: (c) => this.caveRestore(c),
//       busy: () => this.bosses.some((b) => b.alive) || this.picker.active || this.choice.active || this.shop.active || !!this.trial });
//   populateZone(z): at the end:  this.cavePit?.populateZone(z);
//   update(): first line after `if (!this.ready) return;`:
//     if (this.cavePit?.stage) { this.cavePit.stageUpdate(dt, rdt); return; }
//   update(): next to `this.ruins?.update(dt);`:  this.cavePit?.update(dt);
//   postRender(): first line:  if (this.cavePit?.stage) { this.cavePit.stage.postRender(renderer); return; }
//   exit(): this.cavePit?.dispose();
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import type { Hud } from '../ui/Hud';
import type { ZoneDef } from '../world/RegionGen';
import type { RunCarry } from '../scenes/RunScene';
import type { GunLoadout } from '../meta/Save';
import { CaveScene, CaveExit } from '../scenes/CaveScene';
import { buildRigGeo, RigInstance, voxelMesh } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { pitVortexArm, pitThroat } from '../models/cave/props';
import { giantJerboaRig } from '../models/creatures/jerboa';
import { JerboaAnim } from '../models/creatures/anim';
import { clamp, rnd } from '../../engine/math/rand';

export interface CavePitHost {
  ctx: Ctx;
  player: Player;
  cam: CameraRig;
  hud: Hud;
  look?: { hat: string; outfit: string; board: string };
  gun?: GunLoadout;
  seed?: number;
  /** RunScene: the run snapshot (the same carry the storm travel builds) */
  carry(): RunCarry;
  /** RunScene: put a carry coming back up into the live run */
  restore(c: RunCarry): void;
  /** RunScene: the hunter is busy (boss fight, modal, cinematic): the pit waits */
  busy?(): boolean;
}

interface Guide {
  rig: RigInstance;
  anim: JerboaAnim;
  pos: THREE.Vector3;
  heading: number;
  hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null;
  pause: number;
  state: 'lead' | 'dive' | 'gone';
  diveT: number;
}
interface Pit {
  x: number;
  z: number;
  y: number;
  r: number;
  group: THREE.Group;
  arms: { mesh: THREE.Mesh; w: number }[];
  light: THREE.PointLight;
  done: boolean;
  guide: Guide | null;
  lured: boolean;
  trail: { mesh: THREE.Mesh; at: number; y0: number }[];
  trailT: number;
  whisperT: number;
  told: boolean;
  t: number;
}

const GUIDE_SCALE = 0.42;
const _v = new THREE.Vector3();

export class CavePit {
  /** the cave stage while the hunter is below (RunScene forwards update / postRender) */
  stage: CaveScene | null = null;
  pits: Pit[] = [];
  private group = new THREE.Group();
  private crystalMat = makeVoxelMaterial({ emissiveStrength: 2.4 });
  private shardGeo: THREE.BufferGeometry | null = null;
  private entering: { pit: Pit; t: number; built: boolean; spin: number } | null = null;
  private returning: { pit: Pit; t: number } | null = null;
  private pendingExit: CaveExit | null = null;
  /** the pit the hunter went down (he comes back up out of it) */
  private below: Pit | null = null;
  private zones = new Set<number>();

  constructor(private h: CavePitHost) {
    this.group.name = 'cave-pits';
    h.ctx.scene.add(this.group);
  }

  get busy() {
    return !!this.stage || !!this.entering || !!this.returning;
  }

  // ---------------------------------------------------------------- building
  populateZone(z: ZoneDef) {
    if (this.zones.has(z.index)) return;
    this.zones.add(z.index);
    for (const a of z.anchors) if (a.kind === 'cavePit') this.addPit(a.x, a.z, a.data?.r ?? 12);
  }

  addPit(x: number, z: number, r = 12) {
    const ctx = this.h.ctx;
    const w = ctx.world as any;
    // dig the funnel: a wide bowl, a steeper cone, a narrow throat
    w.deform(x, z, r * 0.75, 2.2);
    w.deform(x, z, r * 0.38, 2.4);
    w.deform(x, z, 1.7, 2.6);
    const ground = (xx: number, zz: number) => ctx.world.groundAt(xx, zz);
    const rimY = ground(x + r, z) * 0.25 + ground(x - r, z) * 0.25 + ground(x, z + r) * 0.25 + ground(x, z - r) * 0.25;
    const profile = (rr: number) => {
      let s = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        s += ground(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      }
      return s / 8 - rimY;
    };
    const group = new THREE.Group();
    group.position.set(x, rimY, z);
    this.group.add(group);
    // the swirl: three sand ridges spiralling down, each turning at its own pace
    const arms: Pit['arms'] = [];
    for (let i = 0; i < 3; i++) {
      const sm = pitVortexArm(r * 0.7, profile, i, 3, 1.5);
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: [0, 0, 0] });
      const mesh = new THREE.Mesh(geo, sharedVoxelMaterial);
      mesh.receiveShadow = true;
      mesh.position.y = 0.02;
      group.add(mesh);
      arms.push({ mesh, w: 0.32 + i * 0.07 });
    }
    // the throat
    const bottom = profile(0.2);
    const th = pitThroat(1.55, 3.4);
    const tm = new THREE.Mesh(buildVoxelGeometry(th.model, { voxelSize: th.voxelSize, pivot: [0, 0, 0] }), sharedVoxelMaterial);
    tm.position.y = bottom + 0.05;
    group.add(tm);
    // crystals poking through the slopes
    const crystalKeys = ['cave_crystal_cyan_s', 'cave_crystal_violet_s', 'cave_crystal_cyan_s', 'cave_crystal_violet_s', 'cave_crystal_cyan_s'];
    crystalKeys.forEach((k, i) => {
      const sm = modelEntry(k)?.() as { model: VoxelModel; voxelSize: number } | undefined;
      if (!sm?.model) return;
      const a = (i / crystalKeys.length) * Math.PI * 2 + rnd.next() * 0.6;
      const rr = 2.6 + rnd.next() * 3.4;
      const m = voxelMesh(sm.model, sm.voxelSize, 'bottom', this.crystalMat);
      m.position.set(Math.cos(a) * rr, profile(rr) - 0.12, Math.sin(a) * rr);
      m.rotation.set((rnd.next() - 0.5) * 0.5, rnd.next() * 6.28, (rnd.next() - 0.5) * 0.5 + Math.cos(a) * 0.35);
      m.scale.setScalar(0.8 + rnd.next() * 0.7);
      group.add(m);
    });
    // bones half-buried around the rim
    const boneKeys = ['skull_giant', 'rib_arch', 'skull_cow', 'bone_scatter_0', 'bone_scatter_1', 'skull_cow', 'bone_scatter_0'];
    boneKeys.forEach((k, i) => {
      const sm = modelEntry(k)?.() as { model: VoxelModel; voxelSize: number } | undefined;
      if (!sm?.model) return;
      const a = (i / boneKeys.length) * Math.PI * 2 + rnd.next() * 0.5;
      const rr = r * (0.82 + rnd.next() * 0.3);
      const m = voxelMesh(sm.model, sm.voxelSize, 'bottom');
      const gx = x + Math.cos(a) * rr, gz = z + Math.sin(a) * rr;
      m.position.set(gx - x, ground(gx, gz) - rimY - (k.startsWith('rib') ? 0.6 : 0.12), gz - z);
      m.rotation.set((rnd.next() - 0.5) * 0.25, a + Math.PI / 2 + (rnd.next() - 0.5) * 0.8, (rnd.next() - 0.5) * 0.25);
      group.add(m);
    });
    const light = new THREE.PointLight(0x6ae8ff, 22, 16, 1.5);
    light.position.set(0, bottom + 0.6, 0);
    group.add(light);
    const pit: Pit = { x, z, y: rimY, r, group, arms, light, done: false, guide: null, lured: false, trail: [], trailT: 0, whisperT: 2, told: false, t: rnd.next() * 10 };
    this.pits.push(pit);
    return pit;
  }

  private shard() {
    if (!this.shardGeo) {
      const sm = modelEntry('cave_crystal_cyan_s')?.() as { model: VoxelModel; voxelSize: number } | undefined;
      if (sm?.model) this.shardGeo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'bottom' });
    }
    return this.shardGeo;
  }

  // ---------------------------------------------------------------- the lure
  private spawnGuide(p: Pit) {
    const ctx = this.h.ctx;
    const pp = this.h.player.pos;
    const dx = pp.x - p.x, dz = pp.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = Math.max(p.r + 4, d - 13);
    const gx = p.x + (dx / d) * k, gz = p.z + (dz / d) * k;
    const rig = new RigInstance(buildRigGeo(giantJerboaRig(), 'giant_jerboa'));
    rig.root.scale.setScalar(GUIDE_SCALE);
    ctx.scene.add(rig.root);
    const g: Guide = { rig, anim: new JerboaAnim(rig), pos: new THREE.Vector3(gx, ctx.world.groundAt(gx, gz), gz), heading: Math.atan2(p.x - gx, p.z - gz), hop: null, pause: 0.8, state: 'lead', diveT: 0 };
    p.guide = g;
    ctx.sfx('squeak', g.pos, 0.7, 1.5);
    ctx.fx.dust({ x: gx, y: g.pos.y + 0.1, z: gz }, 0.6, 0xe0b373, 3);
    ctx.toast('A JERBOA?', '#9af0ff', 'It bounces off toward a glow in the dunes… follow it.');
    // the crystal trail rises behind it, all the way to the rim
    const geo = this.shard();
    if (geo) {
      const n = Math.floor((k - p.r * 0.9) / 5);
      for (let i = 0; i <= n; i++) {
        const t = 1 - i / Math.max(1, n);
        const tx = p.x + (dx / d) * (p.r * 0.9 + (k - p.r * 0.9) * t) + (rnd.next() - 0.5) * 2.4;
        const tz = p.z + (dz / d) * (p.r * 0.9 + (k - p.r * 0.9) * t) + (rnd.next() - 0.5) * 2.4;
        const m = new THREE.Mesh(geo, this.crystalMat);
        const y0 = ctx.world.groundAt(tx, tz);
        m.position.set(tx, y0 - 0.8, tz);
        m.rotation.set((rnd.next() - 0.5) * 0.6, rnd.next() * 6.28, (rnd.next() - 0.5) * 0.6);
        m.scale.setScalar(0.45 + rnd.next() * 0.3);
        m.visible = false;
        ctx.scene.add(m);
        p.trail.push({ mesh: m, at: 0.6 + i * 0.35, y0 });
      }
    }
  }

  private updateGuide(p: Pit, dt: number) {
    const g = p.guide;
    if (!g || g.state === 'gone') return;
    const ctx = this.h.ctx;
    const pp = this.h.player.pos;
    const toPit = Math.hypot(p.x - g.pos.x, p.z - g.pos.z);
    const pd = Math.hypot(pp.x - g.pos.x, pp.z - g.pos.z);
    let lift = 0;
    if (g.state === 'dive') {
      // one last look back, then down into the swirl
      g.diveT += dt;
      const k = Math.min(1, g.diveT / 1.4);
      g.pos.x += (p.x - g.pos.x) * Math.min(1, dt * 2.2);
      g.pos.z += (p.z - g.pos.z) * Math.min(1, dt * 2.2);
      g.pos.y = ctx.world.groundAt(g.pos.x, g.pos.z) - k * k * 1.6;
      g.heading += dt * 7 * k;
      g.rig.root.scale.setScalar(GUIDE_SCALE * (1 - k * 0.6));
      g.anim.mode = 'startle';
      if (k >= 1) {
        g.state = 'gone';
        g.rig.dispose();
        ctx.sfx('sand_rise', g.pos, 0.5, 1.3);
      }
    } else if (g.hop) {
      const h = g.hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur);
      const air = k > 0.3 && k < 0.85 ? (k - 0.3) / 0.55 : k >= 0.85 ? 1 : 0;
      const e = air * air * (3 - 2 * air);
      g.pos.set(h.from.x + (h.to.x - h.from.x) * e, h.from.y + (h.to.y - h.from.y) * e, h.from.z + (h.to.z - h.from.z) * e);
      lift = Math.sin(Math.PI * air) * h.h * (k < 0.85 ? 1 : 0);
      g.anim.mode = 'hop';
      g.anim.hopK = k;
      g.heading = Math.atan2(h.to.x - h.from.x, h.to.z - h.from.z);
      if (k >= 1) {
        g.hop = null;
        g.pause = 0.12 + rnd.next() * 0.2;
        ctx.fx.dust({ x: g.pos.x, y: g.pos.y + 0.05, z: g.pos.z }, 0.3, 0xe0b373, 2);
      }
    } else {
      g.pause -= dt;
      // wait for the hunter (looking back at him), bolt ahead when he gets close
      const wait = pd > 24;
      g.anim.mode = wait ? 'curious' : 'idle';
      g.anim.lookAt = wait ? _v.set(pp.x, pp.y + 1.2, pp.z).clone() : null;
      if (wait) {
        let dd = Math.atan2(pp.x - g.pos.x, pp.z - g.pos.z) - g.heading;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        g.heading += dd * Math.min(1, dt * 3);
      }
      if (g.pause <= 0 && !wait) {
        if (toPit < p.r * 0.75) {
          g.state = 'dive';
          ctx.sfx('squeak', g.pos, 0.8, 1.7);
        } else {
          const dir = Math.atan2(p.x - g.pos.x, p.z - g.pos.z) + (rnd.next() - 0.5) * 0.5;
          const step = Math.min(toPit - p.r * 0.5, 2.4 + rnd.next() * 1.6) * (pd < 9 ? 1.4 : 1);
          const tx = g.pos.x + Math.sin(dir) * step, tz = g.pos.z + Math.cos(dir) * step;
          g.hop = { from: g.pos.clone(), to: new THREE.Vector3(tx, ctx.world.groundAt(tx, tz), tz), t: 0, dur: 0.42, h: 0.35 + step * 0.12 };
          if (rnd.chance(0.25)) ctx.sfx('squeak', g.pos, 0.35, 1.6 + rnd.next() * 0.3);
        }
      }
    }
    g.anim.update(dt);
    g.rig.root.position.set(g.pos.x, g.pos.y + lift, g.pos.z);
    g.rig.root.rotation.y = g.heading + g.anim.root.yaw;
  }

  // ---------------------------------------------------------------- per frame (desert)
  update(dt: number) {
    if (this.stage || dt <= 0) return;
    const { ctx, player } = this.h;
    const pp = player.pos;
    for (const p of this.pits) {
      p.t += dt;
      if (p.done) continue;
      const d = Math.hypot(pp.x - p.x, pp.z - p.z);
      // the swirl, the glow, sand pouring in
      for (const a of p.arms) a.mesh.rotation.y -= a.w * dt;
      p.light.intensity = 18 + Math.sin(p.t * 1.7) * 5 + Math.sin(p.t * 4.3) * 2;
      if (d < 90) {
        if (Math.random() < dt * 22) {
          const a = Math.random() * Math.PI * 2, rr = p.r * (0.3 + Math.random() * 0.6);
          const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
          const tx = -Math.sin(a), tz = Math.cos(a);
          ctx.particles.emit({ pos: { x, y: ctx.world.groundAt(x, z) + 0.06, z }, count: 3, vel: { x: (tx * 2.2 - Math.cos(a) * 1.4), y: 0.1, z: (tz * 2.2 - Math.sin(a) * 1.4) }, spread: 0.3, jitter: 0.4, gravity: 3, drag: 0.4, life: [0.8, 1.4], size: [0.05, 0.08], sprite: 'dot3', color: [0xe9c890, 0xd9b27a, 0xc89c64], ground: true });
        }
        if (Math.random() < dt * 3) ctx.particles.emit({ pos: { x: p.x, y: p.y + (p.light.position.y) + 0.4, z: p.z }, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.4, jitter: 0.8, gravity: -0.05, life: [1.5, 2.5], size: [0.05, 0.03], sprite: 'dot3', color: [0x8af4ff, 0xc8a0ff], additive: true });
      }
      // the lure: a jerboa, whispers, a crystal trail
      if (!p.lured && d < 75 && d > p.r + 8 && player.alive && !this.h.busy?.()) {
        p.lured = true;
        this.spawnGuide(p);
      }
      if (p.lured) {
        p.trailT += dt;
        for (const tr of p.trail) {
          if (p.trailT < tr.at) continue;
          tr.mesh.visible = true;
          const k = Math.min(1, (p.trailT - tr.at) / 0.6);
          tr.mesh.position.y = tr.y0 - 0.8 + k * 0.82;
          if (k < 1 && Math.random() < dt * 20) ctx.particles.emit({ pos: { x: tr.mesh.position.x, y: tr.y0 + 0.05, z: tr.mesh.position.z }, count: 2, spread: 0.6, up: 1, gravity: 8, life: [0.3, 0.6], size: [0.05, 0.04], sprite: 'dot3', color: [0xd9b27a, 0x8af4ff], ground: true });
        }
      }
      this.updateGuide(p, dt);
      if (d < 60) {
        p.whisperT -= dt;
        if (p.whisperT <= 0) {
          p.whisperT = 6 + Math.random() * 5;
          ctx.sfx('divine_whisper', { x: p.x, y: p.y, z: p.z }, 0.4, 0.62 + Math.random() * 0.1);
        }
      }
      if (d < p.r + 2 && !p.told) {
        p.told = true;
        ctx.toast('A SINKHOLE', '#9af0ff', 'Something glows deep down there. Ride in…?', true);
      }
      // the funnel drags at the board, then swallows it
      if (d < p.r * 0.7 && player.alive && !this.entering && !this.returning) {
        const ux = (p.x - pp.x) / (d || 1), uz = (p.z - pp.z) / (d || 1);
        const k = 1 - d / (p.r * 0.7);
        player.board.vel.x += (ux * 4 + -uz * 2.6) * k * dt;
        player.board.vel.z += (uz * 4 + ux * 2.6) * k * dt;
        if (d < 2.6 && !this.h.busy?.()) this.enter(p);
      }
    }
    if (this.entering) this.updateEnter(dt);
    if (this.returning) this.updateReturn(dt);
  }

  // ---------------------------------------------------------------- going down
  private enter(p: Pit) {
    const { ctx } = this.h;
    const eng = ctx.engine;
    this.entering = { pit: p, t: 0, built: false, spin: 0 };
    eng.input.enabled = false;
    eng.letterbox(true, 0.4);
    this.h.hud.setVisible(false);
    ctx.sfx('sand_rise', { x: p.x, y: p.y, z: p.z }, 1, 0.6);
    ctx.sfx('quake_rumble', { x: p.x, y: p.y, z: p.z }, 0.9, 0.8);
    ctx.sfx('whoosh_big', null, 0.8, 0.6);
    ctx.shake(0.4);
    this.h.cam.setCine({ pos: new THREE.Vector3(p.x + p.r * 0.55, p.y + 7.5, p.z + p.r * 0.55), look: new THREE.Vector3(p.x, p.y - 2, p.z), fov: 55 });
  }

  private updateEnter(dt: number) {
    const en = this.entering!;
    const { ctx, player } = this.h;
    const p = en.pit;
    en.t += dt;
    const t = en.t;
    // killed on the way in: the sand lets go
    if (!player.alive && !en.built) {
      this.entering = null;
      ctx.engine.input.enabled = true;
      ctx.engine.letterbox(false, 0.3);
      this.h.hud.setVisible(true);
      this.h.cam.setCine(null);
      return;
    }
    // round and round the throat, sinking
    const pp = player.pos;
    const dx = pp.x - p.x, dz = pp.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const tang = new THREE.Vector3(-dz / d, 0, dx / d);
    player.board.vel.x = tang.x * 6 - (dx / d) * Math.min(3, d);
    player.board.vel.z = tang.z * 6 - (dz / d) * Math.min(3, d);
    const sink = clamp((t - 0.5) / 1.2, 0, 1);
    en.spin += dt * (4 + sink * 10);
    player.root.position.y -= sink * sink * 2.4;
    player.root.rotation.y = en.spin;
    ctx.particles.emit({ pos: { x: pp.x, y: pp.y + 0.3, z: pp.z }, count: 6, spread: 2.4, up: 2.5, gravity: 7, life: [0.4, 0.9], size: [0.06, 0.12], sprite: ['dot3', 'puff0'], color: [0xe9c890, 0xd9b27a, 0xc89c64], ground: true });
    if (Math.random() < dt * 6) ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 2, vel: { x: 0, y: -1, z: 0 }, spread: 3, jitter: 3, life: [1, 1.8], size: [1.4, 3], sprite: ['puff0', 'cloud0'], color: [0xd8b884, 0xc8a470], alpha: 0.6, drag: 1, rot: 6 });
    if (t > 1.0 && !en.built) {
      en.built = true;
      ctx.sfx('sand_burst', pp, 1, 0.5);
      void ctx.engine.fadeOut(0.6, '#140c06').then(() => this.descend(p));
    }
  }

  private async descend(p: Pit) {
    const { ctx } = this.h;
    const eng = ctx.engine;
    await eng.fadeOut(0.25, '#000', { loading: 'Sinking below the sand' });
    const carry = this.h.carry();
    const stage = new CaveScene(eng, { carry, look: this.h.look, gun: this.h.gun, seed: ((this.h.seed ?? 1) * 7 + Math.round(p.x + p.z)) % 9973, onExit: (out) => (this.pendingExit = out) });
    stage.camera.aspect = eng.width / eng.height;
    stage.camera.updateProjectionMatrix();
    await stage.enter();
    eng.post.setSceneCamera(stage.scene, stage.camera);
    this.stage = stage;
    this.below = p;
    this.entering = null;
    this.h.cam.setCine(null, false);
    p.done = true;
    if (p.guide && p.guide.state !== 'gone') {
      p.guide.rig.dispose();
      p.guide.state = 'gone';
    }
  }

  // ---------------------------------------------------------------- below (hosted stage)
  stageUpdate(dt: number, rdt: number) {
    const st = this.stage;
    if (!st) return;
    const eng = this.h.ctx.engine;
    if (st.camera.aspect !== eng.width / eng.height) {
      st.camera.aspect = eng.width / eng.height;
      st.camera.updateProjectionMatrix();
    }
    st.update(dt, rdt);
    // the engine listens from the host's camera: lend it the cave view
    const hc = this.h.ctx.camera;
    hc.position.copy(st.camera.position);
    hc.quaternion.copy(st.camera.quaternion);
    hc.updateMatrixWorld();
    if (this.pendingExit) {
      const out = this.pendingExit;
      this.pendingExit = null;
      this.surface(out);
    }
  }

  // ---------------------------------------------------------------- coming back up
  private surface(out: CaveExit) {
    const { ctx, player } = this.h;
    const eng = ctx.engine;
    const st = this.stage!;
    st.exit();
    this.stage = null;
    eng.post.setSceneCamera(ctx.scene, ctx.camera);
    const w = ctx.world as any;
    w.env?.apply?.(w.env.preset);
    (window as any).__music?.setMood('explore');
    this.h.restore(out.carry);
    const p = this.below ?? this.pits[0];
    this.below = null;
    if (!p) return;
    if (out.died) {
      player.board.place(p.x + p.r, ctx.world.groundAt(p.x + p.r, p.z), p.z, 0);
      eng.input.enabled = true;
      eng.letterbox(false, 0.2);
      this.h.hud.setVisible(true);
      eng.fadeIn(0.6);
      player.applyDamage(player.hp + 999, 'fall', false);
      this.collapse(p);
      return;
    }
    // the pit erupts and throws him out onto the dunes
    player.board.place(p.x, ctx.world.groundAt(p.x, p.z) + 0.4, p.z, Math.random() * 6.28);
    player.board.impulse.set(4, 21, 3);
    player.invuln = Math.max(player.invuln, 3);
    this.returning = { pit: p, t: 0 };
    eng.letterbox(true, 0.01);
    this.h.cam.setCine({ pos: new THREE.Vector3(p.x + p.r * 1.3, p.y + 3.5, p.z + p.r * 1.1), look: new THREE.Vector3(p.x, p.y + 6, p.z), fov: 58 }, false);
    void eng.fadeIn(1.1);
    ctx.sfx('sand_burst', { x: p.x, y: p.y, z: p.z }, 1, 0.55);
    ctx.sfx('explosion_big', { x: p.x, y: p.y, z: p.z }, 0.6, 0.7);
    ctx.shake(0.8);
  }

  private updateReturn(dt: number) {
    const r = this.returning!;
    const { ctx, player } = this.h;
    const eng = ctx.engine;
    const p = r.pit;
    r.t += dt;
    if (r.t < 1.6) {
      ctx.particles.emit({ pos: { x: p.x, y: p.y - 1, z: p.z }, count: 10, vel: { x: 0, y: 18, z: 0 }, spread: 3, jitter: 1.2, gravity: 10, life: [1, 1.8], size: [0.08, 0.14], sprite: ['dot3', 'puff0'], color: [0xe9c890, 0xd9b27a, 0xc89c64], ground: true });
      if (Math.random() < 0.5) ctx.particles.emit({ pos: { x: p.x, y: p.y + 1, z: p.z }, count: 2, vel: { x: 0, y: 8, z: 0 }, spread: 2, life: [1.4, 2.4], size: [2, 4.5], sprite: ['cloud0', 'cloud1', 'puff0'], color: [0xe6cf9f, 0xd8b884], alpha: 0.7, drag: 1, rot: 6, rotSpeed: 0.5 });
    }
    this.h.cam.setCine({ pos: new THREE.Vector3(p.x + p.r * 1.3, p.y + 3.5, p.z + p.r * 1.1), look: player.pos.clone().add(new THREE.Vector3(0, 1, 0)), fov: 58 });
    if (r.t > 0.6 && p.arms.length) this.collapse(p);
    if (r.t > 2.6) {
      this.returning = null;
      this.h.cam.setCine(null);
      eng.letterbox(false, 0.5);
      eng.input.enabled = true;
      this.h.hud.setVisible(true);
      ctx.toast('BACK IN THE SUN', '#ffd36b', 'The sinkhole slumps shut behind you.', true);
      ctx.sfx('sting_positive', null, 0.6);
    }
  }

  /** the pit slumps shut: the swirl stops, the glow dies, the sand fills back in */
  private collapse(p: Pit) {
    const ctx = this.h.ctx;
    for (const a of p.arms) {
      a.mesh.removeFromParent();
      a.mesh.geometry.dispose();
    }
    p.arms.length = 0;
    p.light.intensity = 0;
    p.light.removeFromParent();
    for (const tr of p.trail) tr.mesh.removeFromParent();
    p.trail.length = 0;
    const w = ctx.world as any;
    for (let i = 0; i < 6; i++) ctx.engine.tweens.after(i * 0.18, () => {
      w.deform?.(p.x, p.z, p.r * (i < 3 ? 0.38 : 0.75), -0.75);
      ctx.fx.dust({ x: p.x + (Math.random() - 0.5) * p.r, y: p.y, z: p.z + (Math.random() - 0.5) * p.r }, 2, 0xe6cf9f, 4);
    });
    p.group.children.forEach((c) => {
      if ((c as THREE.Mesh).material === this.crystalMat) c.visible = false;
    });
  }

  dispose() {
    if (this.stage) {
      this.stage.exit();
      this.stage = null;
    }
    for (const p of this.pits) {
      p.guide?.rig.dispose();
      for (const tr of p.trail) tr.mesh.removeFromParent();
    }
    this.group.removeFromParent();
    this.crystalMat.dispose();
  }
}

// ============================================================================ debug
/**
 * Test the pit inside a running RunScene without editing it (devtools, after ?debug=run):
 *   (await import('/src/game/run/CavePit.ts')).debugPit(__engine.current)
 * Wraps the scene's update / postRender like the real hooks do, digs a pit ~30 m ahead
 * of the hunter and lets the lure, the fall, the cave and the return run end to end.
 */
export function debugPit(run: any, dist = 30) {
  const pl = run.player;
  const yaw = run.camRig.yaw;
  const pit = new CavePit({
    ctx: run.ctx, player: pl, cam: run.camRig, hud: run.hud, look: run.opts.look, gun: run.opts.gun, seed: run.opts.seed,
    carry: () => ({
      run: { ...run.run },
      history: [...run.upgrades.history],
      items: run.items.slots.map((x: any) => (x ? { ...x } : null)),
      hpFrac: pl.hp / pl.maxHp,
      mods: pl.stats.mods.filter((m: any) => !m.source.startsWith('up:') && m.source !== 'gun' && !m.source.startsWith('item:') && !m.source.startsWith('gear:') && !m.source.startsWith('upx:')),
      gear: run.equipment.snapshot(),
      deadHand: run.equipment.deadHandSpent,
      codex: {},
      bosses: [],
      ult: run.ult.variant,
    }),
    restore: (c: RunCarry) => {
      Object.assign(run.run, c.run);
      for (const id of c.history.slice(run.upgrades.history.length)) run.upgrades.apply(id);
      run.items.slots = c.items.map((s) => (s ? { ...s } : null));
      pl.hp = pl.maxHp * Math.max(0.05, c.hpFrac);
    },
    busy: () => run.bosses.some((b: any) => b.alive),
  });
  const p = pl.pos;
  pit.addPit(p.x + Math.sin(yaw) * dist, p.z + Math.cos(yaw) * dist, 12);
  const up = run.update.bind(run), pr = run.postRender.bind(run);
  run.update = (dt: number, rdt: number) => {
    if (pit.stage) return pit.stageUpdate(dt, rdt);
    up(dt, rdt);
    pit.update(dt);
  };
  run.postRender = (r: THREE.WebGLRenderer) => (pit.stage ? pit.stage.postRender(r) : pr(r));
  (window as any).__pit = pit;
  return pit;
}
