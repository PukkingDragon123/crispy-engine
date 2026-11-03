// Cinema: the in-world cutscene director that replaced the old screen-space
// cut-in band (Hud3D.cutIn now hands every call to it).
//
//  - BOSS ARRIVAL (on every 'bossIntro'): letterbox, slow motion, a hard cut to
//    a low wide shot past the hunter as the boss erupts in an explosion - voxel
//    fire and smoke billows, a shock ring rolling through the living sand,
//    flying voxel debris, a light flash, shake, sparks, embers, sand and ash -
//    then a close hero reaction shot lit by the fire, then the boss's name as
//    big voxel-cast Alagard letters bursting up out of the sand in front of it
//    with its title typed above. ~4.9 s, skippable (Space / Enter / E / click).
//  - AREA TITLES (a sub-area's name): a sweeping establishing crane that ends
//    on the name standing in the dunes ahead, ~4.2 s, skippable.
//  - SMALL BEATS (MOVE UNLOCKED, NECK SLICER, ultimates, boss call-outs):
//    a short voxel title stamp that punches into the world just above the
//    hunter's line of sight and crumbles to sand. No camera takeover.
// While a cutscene plays the world is safe: time all but stops (the cutscene's
// own effects keep their pace on a private particle / debris / billow stage),
// the hunter cannot be hurt, input is off and the HUD hides.
//
// Self-driving (engine.onAfterUpdate) and self-binding: the run's Skills
// instance provides ctx + player, Hud3D.update() provides the HUD, and it tears
// itself down when its scene is no longer current. A scene can also bind it
// explicitly with Cinema.attach({ ctx, player, hud }).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import { Skills } from '../player/Skills';
import { SUBAREAS } from '../world/RegionGen';
import { FloatText3D } from '../fx/FloatText3D';
import { CineKit, KitWorld, SAND, GRAIN, cineFlags } from './CineKit';
import { CineCam } from './CineCam';
import { VoxelWord, styleForColor, LetterStyle, warmLetters } from './VoxelLetters';

export interface HudLike {
  visible: boolean;
  setVisible(v: boolean): void;
}

export interface CinemaDeps {
  ctx: Ctx;
  player: Player;
  cam?: CameraRig;
  hud?: HudLike;
}

/** what a boss arrival needs (Boss fits) */
export interface BossLike {
  pos: THREE.Vector3;
  height: number;
  name: string;
  title?: string;
  radius?: number;
  scale?: number;
  rig?: { geo?: unknown };
}

export interface CutInLike {
  geo?: unknown;
  height?: number;
  flip?: boolean;
  /** where a small beat should stand (default: in front of the hunter) */
  at?: THREE.Vector3;
  /** the boss, when the caller has it */
  boss?: BossLike;
}

interface Seq {
  name: string;
  t: number;
  /** when the outro starts (skip jumps here) */
  outro: number;
  dur: number;
  /** world time scale while it runs */
  worldRate: number;
  /** effects time scale (relative to real time) */
  fxRate: number;
  update(rdt: number): void;
  late(rdt: number): void;
  end(): void;
}

interface Beat {
  word: VoxelWord;
  t: number;
  hold: number;
  follow: boolean;
  out: 'crumble' | 'sink';
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const ease = (k: number) => {
  k = sat(k);
  return k * k * (3 - 2 * k);
};
const AREA_NAMES = new Set(Object.values(SUBAREAS).map((s) => s.name.toUpperCase()));

export class Cinema {
  private static inst: Cinema | null = null;
  private static hudRef: HudLike | null = null;

  /** bind explicitly (optional: the run binds itself through Skills.current) */
  static attach(d: CinemaDeps) {
    if (d.hud) Cinema.hudRef = d.hud;
    if (Cinema.inst?.ctx === d.ctx) {
      if (d.hud) Cinema.inst.hud = d.hud;
      return Cinema.inst;
    }
    Cinema.inst?.dispose();
    Cinema.inst = new Cinema(d);
    return Cinema.inst;
  }

  /** called every frame by Hud3D: keeps a director alive for the current run scene */
  static poll(hud?: HudLike) {
    if (hud) Cinema.hudRef = hud;
    const cur = Cinema.inst;
    if (cur && !cur.valid()) {
      cur.dispose();
      Cinema.inst = null;
    }
    if (Cinema.inst) {
      if (hud) Cinema.inst.hud = hud;
      return;
    }
    const s = Skills.current as unknown as { ctx?: Ctx; player?: Player } | null;
    const ctx = s?.ctx, player = s?.player;
    if (!ctx || !player || !ctx.engine || ctx.engine.current?.scene !== ctx.scene) return;
    Cinema.inst = new Cinema({ ctx, player, hud: Cinema.hudRef ?? undefined });
  }

  static get(): Cinema | null {
    Cinema.poll();
    return Cinema.inst;
  }

  /** a camera-owning cutscene is playing */
  static busy() {
    return !!Cinema.inst?.seq;
  }

  /** the old Hud3D.cutIn entry point: routes to the right in-world cinematic */
  static cutIn(title: string, color?: string, _expr?: string, opts: CutInLike = {}) {
    const c = Cinema.get();
    if (!c) return false;
    c.cutIn(title, color, opts);
    return true;
  }

  ctx: Ctx;
  player: Player;
  cam: CameraRig;
  hud: HudLike | null;
  kit: CineKit;
  ccam: CineCam;
  private seq: Seq | null = null;
  private beats: Beat[] = [];
  /** per-frame hooks run after the camera is final (billboarded text) */
  late = new Set<(rdt: number) => void>();
  private disposed = false;
  private offBoss: (() => void) | null = null;
  private lastBoss = -1e9;
  private pendingGeo: { title: string; color?: string; t: number } | null = null;
  private skipEl: HTMLDivElement | null = null;
  private hudWas = true;
  private readonly tick = (dt: number, rdt: number) => this.update(dt, rdt);
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') this.skip();
  };
  private readonly onDown = () => this.skip();

  private constructor(d: CinemaDeps) {
    this.ctx = d.ctx;
    this.player = d.player;
    this.cam = d.cam ?? d.player.cam;
    this.hud = d.hud ?? Cinema.hudRef;
    this.kit = new CineKit(d.ctx.engine, d.ctx.scene, d.ctx.world as unknown as KitWorld);
    this.ccam = new CineCam(d.ctx.camera);
    this.ccam.groundAt = (x, z) => d.ctx.world.groundAt(x, z);
    this.kit.onShake = (a) => (this.seq ? this.ccam.shake(a) : this.cam.addTrauma(a * 0.5));
    d.ctx.engine.onAfterUpdate.push(this.tick);
    this.offBoss = d.ctx.events.on('bossIntro', (b: BossLike) => this.bossArrival(b));
    warmLetters();
    (window as any).__cine = this; // dev handle: __cine.stamp('HIGH NOON'), __cine.area('THE BONEWIND DUNES'), __cine.bossArrival({...})
  }

  private valid() {
    return !this.disposed && this.ctx.engine.current?.scene === this.ctx.scene;
  }

  /** a cutscene may take the screen now */
  private free(strict = false) {
    const eng = this.ctx.engine;
    if (this.seq || eng.paused || !this.player.alive) return false;
    if (!eng.input.enabled) return false; // someone else's cinematic (intro, zone flyover, neck slicer) owns it
    if (cineFlags.choice || cineFlags.zone) return false;
    if (strict && this.cam.cine) return false;
    return true;
  }

  // ------------------------------------------------------------------ routing
  cutIn(title: string, color?: string, opts: CutInLike = {}) {
    if (opts.boss) return this.bossArrival(opts.boss, color);
    if (opts.geo) {
      // a boss cut-in: the 'bossIntro' listener normally already started the arrival
      if (performance.now() - this.lastBoss < 1500 || this.seq?.name === 'boss') return;
      this.pendingGeo = { title, color, t: performance.now() };
      return;
    }
    const up = title.toUpperCase();
    if (AREA_NAMES.has(up)) return this.area(title, undefined, color);
    // inside someone else's shot (a landmark crane, the cave arrival) it stands in the shot as a title;
    // in play it is a small stamp riding along in front of the hunter
    this.stamp(title, color, { at: opts.at, title: !!this.cam.cine && !opts.at });
  }

  // ------------------------------------------------------------------ boss arrival
  bossArrival(b: BossLike, color?: string) {
    this.lastBoss = performance.now();
    this.pendingGeo = null;
    if (!this.free()) {
      this.stamp(b.name.toUpperCase(), color ?? '#ff6a3a');
      return;
    }
    const ctx = this.ctx, w = ctx.world, kit = this.kit, P = this.player;
    const gAt = (x: number, z: number) => w.groundAt(x, z);
    const B0 = b.pos.clone();
    const gB = gAt(B0.x, B0.z);
    const H = THREE.MathUtils.clamp(b.height || 3, 1.6, 14);
    const bR = THREE.MathUtils.clamp(b.radius ?? H * 0.3, 0.6, 6);
    const pp = P.pos.clone();
    const u = new THREE.Vector3(B0.x - pp.x, 0, B0.z - pp.z);
    if (u.lengthSq() < 0.5) u.set(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    u.normalize();
    const s = new THREE.Vector3(u.z, 0, -u.x);
    const r = THREE.MathUtils.clamp(H * 0.55, 2.2, 6);
    // forged iron with a molten core out in the desert; moon-silver in the caves
    const style: LetterStyle = color ? styleForColor(color) : (w as unknown as { ceiling?: unknown }).ceiling ? 'moon' : 'ember';
    // ---- the shots
    const aPos = pp.clone().addScaledVector(u, -2.8).addScaledVector(s, 1.7);
    aPos.y = gAt(aPos.x, aPos.z) + 0.8;
    const bossLook = () => _w.set(b.pos.x, Math.max(gB, b.pos.y) + H * 0.55, b.pos.z);
    const head = () => {
      const n = (P.rig.nodes['head'] ?? P.rig.root) as THREE.Object3D;
      n.updateWorldMatrix(true, false);
      return n.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.24, 0));
    };
    // ---- the name, cast in voxels, standing in the sand in front of the boss
    const name = b.name.toUpperCase();
    const lines = splitTitle(name, 12);
    const longest = Math.max(...lines.split('\n').map((l) => l.length));
    const lh = Math.min(THREE.MathUtils.clamp(H * 0.32, 1.1, 2.4), 12 / Math.max(4, longest * 0.68));
    const word = new VoxelWord(lines, { height: lh, style, fog: false, glow: 0.45 });
    const L = new THREE.Vector3(b.pos.x, 0, b.pos.z).addScaledVector(u, -(bR + 2.4 + H * 0.12));
    L.y = gAt(L.x, L.z);
    const Dl = Math.max(word.width * 0.62 + 2.5, lh * 3.4 + 3);
    const cPos = L.clone().addScaledVector(u, -Dl).addScaledVector(s, Dl * 0.24);
    cPos.y = gAt(cPos.x, cPos.z) + lh * 0.45 + 0.4;
    word.group.position.copy(L);
    word.group.rotation.y = Math.atan2(cPos.x - L.x, cPos.z - L.z);
    word.plant(gAt);
    word.onLand = (_l, at, i) => {
      kit.sandPop(at, 0.6, true);
      kit.sfx(i % 2 ? 'sand_burst' : 'rock_crumble', at, 0.55, 0.8 + Math.random() * 0.3);
      this.ccam.shake(0.08);
    };
    word.onCrumble = (at) => kit.particles.emit({ pos: at, count: 2, vel: { x: 0, y: -0.4, z: 0 }, spread: 0.8, life: [0.6, 1.2], size: [0.06, 0.04], sprite: GRAIN, color: style === 'ember' ? [0x3a2e28, 0xff7a2a, 0x6e5a4c] : SAND, gravity: 6, ground: true });
    let sub: FloatText3D | null = null;
    let entered = false;
    const T1 = 1.45, T2 = 2.55, OUT = 4.35;
    const seq: Seq = {
      name: 'boss',
      t: 0,
      outro: OUT,
      dur: OUT + 0.55,
      worldRate: 0.12,
      fxRate: 0.42,
      update: (rdt) => {
        const t = seq.t;
        if (t < T1) {
          // A: low past the hunter, the eruption beyond him; a slow push and roll
          const k = t / T1;
          const pos = aPos.clone().addScaledVector(u, k * 0.9).add(new THREE.Vector3(0, k * 0.15, 0));
          this.ccam.set(pos, bossLook(), 46 - k * 6, 0.05 - k * 0.03);
          seq.worldRate = 0.12;
          seq.fxRate = 0.42;
        } else if (t < T2) {
          // B: the hero reaction, lit by the fire behind the lens
          const k = (t - T1) / (T2 - T1);
          const h = head();
          const pos = h.clone().addScaledVector(u, 2.7 - k * 0.45).addScaledVector(s, 0.8).add(new THREE.Vector3(0, -0.22, 0));
          this.ccam.set(pos, h.clone().add(new THREE.Vector3(0, -0.12, 0)), 34 - k * 4, -0.04);
          seq.worldRate = 0.03;
          seq.fxRate = 0.3;
          if (Math.random() < rdt * 14) kit.ash(h.clone().addScaledVector(u, 0.6), 3, { x: s.x * 1.4, y: 0, z: s.z * 1.4 });
        } else {
          // C: the name rises out of the sand in front of the boss; a slow crane
          const k = sat((t - T2) / (OUT + 0.5 - T2));
          const pos = cPos.clone().addScaledVector(u, -k * 1.2).add(new THREE.Vector3(0, k * lh * 0.5, 0));
          const look = L.clone().add(new THREE.Vector3(0, lh * 0.6, 0)).lerp(bossLook(), 0.38);
          this.ccam.set(pos, look, 50 - k * 3, 0.02);
          seq.worldRate = 0.03;
          seq.fxRate = 0.55;
          if (!entered) {
            entered = true;
            ctx.scene.add(word.group);
            word.enter('rise', 0.065, 0.1);
            kit.billows.thin(L, 7);
            kit.sfx('quake_rumble', L, 0.7, 1.2);
          }
          if (!sub && t > T2 + 0.6 && b.title) {
            sub = new FloatText3D(b.title, { size: lh * 0.38, px: 72, cps: 30, wrap: 34, color: '#fff0d8', glow: style === 'moon' ? '#46d8ff' : '#ff8a3a', hdr: 1.4 });
            (sub.mesh.material as THREE.MeshBasicMaterial).fog = false;
            sub.anchor.copy(L).add(new THREE.Vector3(0, word.height + lh * 0.55, 0));
            ctx.scene.add(sub.mesh);
          }
        }
        // cut moments
        if (t >= T1 && t - rdt < T1) {
          P.express('determined', 4);
          kit.sfx('whoosh', null, 0.6, 0.7);
          kit.after(0.4 * seq.fxRate + 0.05, () => kit.sfx('rev_hammer', P.pos, 0.9, 0.9));
        }
        if (t >= OUT && !word.leaving) {
          word.leave('crumble');
          sub?.show(false);
          this.ccam.release(2.4);
          this.restoreWorld();
        }
      },
      late: (rdt) => {
        word.update(rdt);
        sub?.update(rdt, ctx.camera);
      },
      end: () => {
        word.dispose();
        sub?.dispose();
      },
    };
    // ---- the eruption
    const at = new THREE.Vector3(B0.x, gB, B0.z);
    kit.blast(at, r, { debris: Math.round(30 + r * 8) });
    kit.after(0.28, () => kit.blast(at.clone().addScaledVector(s, r * 0.7).addScaledVector(u, -r * 0.3), r * 0.55, { ring: false, flash: false, sound: false }));
    kit.after(0.5, () => kit.blast(at.clone().addScaledVector(s, -r * 0.8).addScaledVector(u, r * 0.2), r * 0.5, { ring: false, flash: false, sound: false }));
    kit.burn(at, r * 0.7, 9);
    kit.sfx('time_slow', null, 0.7, 0.9);
    this.ccam.shake(0.7);
    this.start(seq);
  }

  // ------------------------------------------------------------------ area title
  area(title: string, sub?: string, color = '#ffd36b') {
    if (!this.free(true)) {
      this.stamp(title, color, { title: true });
      return;
    }
    const ctx = this.ctx, w = ctx.world, kit = this.kit, P = this.player;
    const gAt = (x: number, z: number) => w.groundAt(x, z);
    const pp = P.pos.clone();
    const f = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    const s = new THREE.Vector3(f.z, 0, -f.x);
    const text = splitTitle(title.toUpperCase(), 14);
    const longest = Math.max(...text.split('\n').map((l) => l.length));
    const lh = Math.min(1.6, 11 / Math.max(4, longest * 0.68));
    const word = new VoxelWord(text, { height: lh, style: color ? styleForColor(color) : 'gold', fog: false, glow: 0.35 });
    const L = pp.clone().addScaledVector(f, 15);
    L.y = gAt(L.x, L.z);
    const D = Math.max(word.width * 0.7 + 2, 7.5);
    const c1 = L.clone().addScaledVector(f, -D).addScaledVector(s, D * 0.22);
    c1.y = gAt(c1.x, c1.z) + lh * 0.5 + 0.5;
    word.group.position.copy(L);
    word.group.rotation.y = Math.atan2(c1.x - L.x, c1.z - L.z);
    word.plant(gAt);
    word.onLand = (_l, at, i) => {
      kit.sandPop(at, 0.6, true);
      if (i % 2 === 0) kit.sfx('sand_burst', at, 0.45, 0.9 + Math.random() * 0.2);
    };
    const c0 = pp.clone().addScaledVector(f, -5).addScaledVector(s, 9).add(new THREE.Vector3(0, 14, 0));
    const cm = pp.clone().addScaledVector(f, 4).addScaledVector(s, 7).add(new THREE.Vector3(0, 6, 0));
    const look0 = pp.clone().addScaledVector(f, 55).add(new THREE.Vector3(0, 3, 0));
    const lookL = L.clone().add(new THREE.Vector3(0, word.height * 0.55, 0));
    let subT: FloatText3D | null = null;
    let entered = false;
    const zoneName = sub ?? (w as unknown as { sa?: { zones?: { name: string }[] } }).sa?.zones?.[0]?.name;
    const OUT = 3.6;
    const seq: Seq = {
      name: 'area',
      t: 0,
      outro: OUT,
      dur: OUT + 0.6,
      worldRate: 0.03,
      fxRate: 1,
      update: () => {
        const t = seq.t;
        const k = ease(t / 3.4);
        // quadratic bezier crane: high and wide, sweeping down to the name
        const a = c0.clone().multiplyScalar((1 - k) * (1 - k)).addScaledVector(cm, 2 * k * (1 - k)).addScaledVector(c1, k * k);
        const look = look0.clone().lerp(lookL, ease(t / 2.6));
        this.ccam.set(a, look, 58 - 14 * k, 0.04 * (1 - k));
        if (!entered && t > 1.0) {
          entered = true;
          ctx.scene.add(word.group);
          word.enter('rise', 0.075);
          kit.sfx('quake_rumble', L, 0.5, 1.3);
        }
        if (!subT && t > 1.9 && zoneName) {
          subT = new FloatText3D(zoneName.toUpperCase(), { size: lh * 0.28, px: 64, cps: 26, wrap: 40, color: '#fff3d6', glow: '#ffb070', hdr: 1.3 });
          (subT.mesh.material as THREE.MeshBasicMaterial).fog = false;
          subT.anchor.copy(L).add(new THREE.Vector3(0, word.height + lh * 0.5, 0));
          ctx.scene.add(subT.mesh);
          kit.sfx('divine_chime', null, 0.4);
        }
        if (t >= OUT && !word.leaving) {
          word.leave('sink');
          subT?.show(false);
          this.ccam.release(2.2);
          this.restoreWorld();
        }
      },
      late: (rdt) => {
        word.update(rdt);
        subT?.update(rdt, ctx.camera);
      },
      end: () => {
        word.dispose();
        subT?.dispose();
      },
    };
    this.ccam.take(false, 3);
    this.ccam.set(c0, look0, 58);
    kit.sfx('whoosh_big', null, 0.5);
    this.start(seq, false);
  }

  // ------------------------------------------------------------------ small beats
  /** a voxel title stamp that punches into the world and crumbles away (no camera takeover) */
  stamp(title: string, color?: string, o: { at?: THREE.Vector3; title?: boolean; hold?: number; follow?: boolean } = {}) {
    // one at a time
    for (const b of this.beats) if (!b.word.leaving) b.word.leave('crumble');
    const style = styleForColor(color);
    const cine = this.cam.cine;
    const big = !!o.title;
    const text = splitTitle(title.toUpperCase(), big ? 14 : 16);
    // a title standing in someone else's shot is sized to that shot
    let lh = big ? 0.9 : 0.6;
    if (big && cine && !o.at) {
      const dist = cine.look.distanceTo(cine.pos) * 0.55;
      const longest = Math.max(...text.split('\n').map((l) => l.length));
      lh = Math.min(THREE.MathUtils.clamp(dist * 0.16, 0.25, 1.8), (dist * 0.85) / Math.max(4, longest * 0.68));
    }
    const word = new VoxelWord(text, { height: lh, style, fog: false, castShadow: big });
    const beat: Beat = { word, t: 0, hold: o.hold ?? (big ? 2.6 : 1.5), follow: o.follow ?? (!o.at && !cine && !big), out: big ? 'sink' : 'crumble' };
    const cam = this.ctx.camera;
    if (beat.follow) this.placeBeat(beat);
    else if (o.at) word.group.position.copy(o.at);
    else if (big && !cine) {
      const P = this.player.pos, yaw = this.cam.yaw;
      const at = new THREE.Vector3(P.x + Math.sin(yaw) * 9, 0, P.z + Math.cos(yaw) * 9);
      at.y = this.ctx.world.groundAt(at.x, at.z);
      word.group.position.copy(at);
    } else if (cine) {
      // someone else's shot owns the camera: stand the words in it, between the lens and its subject
      const at = cine.look.clone().lerp(cine.pos, big ? 0.45 : 0.6);
      at.y = this.ctx.world.groundAt(at.x, at.z) + (big ? 0 : 0.9);
      word.group.position.copy(at);
    } else this.placeBeat(beat);
    word.group.rotation.y = Math.atan2(cam.position.x - word.group.position.x, cam.position.z - word.group.position.z);
    if (big && !o.at) word.plant((x, z) => this.ctx.world.groundAt(x, z));
    word.onLand = (_l, at, i) => {
      const P = this.kit.particles;
      P.emit({ pos: at.clone().add(new THREE.Vector3(0, 0.2, 0)), count: 6, spread: 3, up: 1.2, life: [0.25, 0.6], size: [0.07, 0.015], sprite: ['spark', 'star4'], additive: true, color: [0xffffff, 0xfff0c0, 0xffd36b], drag: 3, stretch: 0.03 });
      if (big) this.kit.sandPop(at, 0.7);
      if (i === 0) {
        this.kit.sfx('poster_slam', null, 0.45, 1.1);
        this.kit.sfx('counter_clang', null, 0.25, 1.4);
      }
    };
    word.onCrumble = (at) => this.kit.particles.emit({ pos: at, count: 1, vel: { x: 0, y: 0.5, z: 0 }, spread: 0.6, life: [0.5, 1.0], size: [0.04, 0.02], sprite: ['grain0', 'grain1', 'star4'], color: [0xffd36b, 0xf6dfb0, 0xffffff], additive: Math.random() < 0.4, drag: 1.4, gravity: -0.3 });
    this.ctx.scene.add(word.group);
    word.enter(big ? 'rise' : 'stamp', big ? 0.07 : 0.035);
    this.beats.push(beat);
  }

  private placeBeat(b: Beat) {
    const P = this.player.pos, yaw = this.cam.yaw;
    const f = _v.set(Math.sin(yaw), 0, Math.cos(yaw));
    b.word.group.position.set(P.x + f.x * 4.4 + f.z * 0.25, P.y + 1.95, P.z + f.z * 4.4 - f.x * 0.25);
    const cam = this.ctx.camera;
    b.word.group.rotation.y = Math.atan2(cam.position.x - b.word.group.position.x, cam.position.z - b.word.group.position.z);
  }

  // ------------------------------------------------------------------ the running cutscene
  private start(seq: Seq, cut = true) {
    if (this.seq) this.finish();
    const eng = this.ctx.engine;
    this.seq = seq;
    this.hudWas = this.hud?.visible ?? true;
    this.hud?.setVisible(false);
    eng.letterbox(true, 0.35);
    eng.input.enabled = false;
    if (cut) this.ccam.take(true);
    this.secure();
    const el = document.createElement('div');
    el.style.cssText = "position:absolute;right:3vw;bottom:4vh;font-family:'Alagard';font-size:18px;color:#fff3d6;opacity:.7;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #2a1408";
    el.textContent = 'SKIP >';
    el.onpointerdown = (e) => {
      e.stopPropagation();
      this.skip();
    };
    eng.overlay.append(el);
    this.skipEl = el;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onDown);
  }

  /** world safety while a cutscene plays */
  private secure() {
    const s = this.seq;
    if (!s || s.t >= s.outro) return;
    const eng = this.ctx.engine;
    eng.slowMo(s.worldRate, 40);
    this.player.invuln = Math.max(this.player.invuln, 0.6);
    eng.input.enabled = false;
  }

  private restoreWorld() {
    const eng = this.ctx.engine;
    eng.slowMo(1, 5);
    eng.input.enabled = true;
    this.player.invuln = Math.max(this.player.invuln, 0.8);
    this.hud?.setVisible(this.hudWas);
    // a boss's own intro shot may still be running: it opens its letterbox itself
    if (!(this.cam as unknown as { cineTarget?: number }).cineTarget) eng.letterbox(false, 0.5);
    this.skipEl?.remove();
    this.skipEl = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onDown);
  }

  skip() {
    const s = this.seq;
    if (!s || s.t >= s.outro || this.ctx.engine.paused) return;
    s.t = s.outro - 1e-3;
  }

  private finish() {
    const s = this.seq;
    if (!s) return;
    this.seq = null;
    if (s.t < s.outro) this.restoreWorld();
    this.ccam.release(2.4);
    try {
      s.end();
    } catch (e) {
      console.warn('[cine] end failed', e);
    }
  }

  private update(dt: number, rdt: number) {
    if (!this.valid()) {
      this.dispose();
      return;
    }
    const eng = this.ctx.engine;
    let fxRate = 1;
    const s = this.seq;
    if (s) {
      // the pause menu freezes the cutscene too (and window.__cineHold, for screenshots)
      const hold = !!(window as any).__cineHold;
      const step = eng.paused || hold ? 0 : rdt;
      s.t += step;
      try {
        s.update(step);
      } catch (e) {
        console.warn('[cine] cutscene failed', e);
        s.t = s.dur;
      }
      this.secure();
      fxRate = hold ? 0 : s.fxRate;
    }
    // a boss cut-in nobody claimed (no 'bossIntro' listener got it): a beat instead
    if (this.pendingGeo && performance.now() - this.pendingGeo.t > 200) {
      const p = this.pendingGeo;
      this.pendingGeo = null;
      if (performance.now() - this.lastBoss > 1500) this.stamp(p.title, p.color);
    }
    // the effects stage keeps its own clock (the choice stage pauses the world on purpose)
    const frozen = (eng.paused && !cineFlags.choice) || !!(window as any).__cineHold;
    this.kit.update(frozen ? 0 : rdt * fxRate, dt);
    for (let i = this.beats.length - 1; i >= 0; i--) {
      const b = this.beats[i];
      const bdt = (window as any).__cineHold ? 0 : rdt;
      b.t += bdt;
      if (b.follow && !b.word.leaving) this.placeBeat(b);
      if (b.t > b.hold && !b.word.leaving) b.word.leave(b.out);
      b.word.update(bdt);
      if (b.word.done) {
        b.word.dispose();
        this.beats.splice(i, 1);
      }
    }
    this.ccam.apply(rdt);
    for (const f of this.late) f(rdt);
    if (s) {
      s.late(eng.paused || (window as any).__cineHold ? 0 : rdt);
      if (s.t >= s.dur) this.finish();
    }
  }

  dispose() {
    if (this.disposed) return;
    if (this.seq) this.finish();
    this.disposed = true;
    for (const b of this.beats) b.word.dispose();
    this.beats.length = 0;
    this.offBoss?.();
    this.kit.dispose();
    this.skipEl?.remove();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onDown);
    if (Cinema.inst === this) Cinema.inst = null;
    if ((window as any).__cine === this) (window as any).__cine = null;
    const list = this.ctx.engine.onAfterUpdate;
    setTimeout(() => {
      const i = list.indexOf(this.tick);
      if (i >= 0) list.splice(i, 1);
    }, 0);
  }
}

/** break a long title into two balanced lines at a space */
export function splitTitle(s: string, max: number) {
  if (s.length <= max || !s.includes(' ')) return s;
  const mid = s.length / 2;
  let best = -1, bd = 1e9;
  for (let i = 0; i < s.length; i++)
    if (s[i] === ' ' && Math.abs(i - mid) < bd) {
      bd = Math.abs(i - mid);
      best = i;
    }
  return best < 0 ? s : s.slice(0, best) + '\n' + s.slice(best + 1);
}
