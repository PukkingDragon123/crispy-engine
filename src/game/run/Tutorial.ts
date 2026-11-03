// Serket's riding lesson: the interactive tutorial that follows the opening
// cinematic. The goddess floats at Sundown's side as a guide (the scorpion-girl
// spirit, models/characters/scorpionGirl.ts) and each step waits for the player
// to actually do it, with a short spoken line and a floating 3D prompt (Alagard)
// naming the keys:
//   1. ride (W A S D), carve (A / D) and tuck (hold SPACE)
//   2. hold SPACE to charge a jump, release, and land it
//   3. aim (RMB) and shoot (LMB) three skull targets she raises from the sand
//   4. reload (R) and hit the timing window (R again) for venom rounds
//   5. kick (F)
//   6. grapple (Q) the scorpion totem she raises
// then "a hundred waves stand between you and your name", she leaves, and the
// run begins. Hold BACKSPACE (or click SKIP) to skip.
//
// API: `new Tutorial({ ctx, player, cam })`, then every frame `update(dt)` until
// `done`, then `dispose()`. It never touches the wave director: the caller starts
// wave 1 when `done` turns true.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import type { LandingInfo } from '../player/Board';
import type { Collider } from '../world/Colliders';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { FloatText3D } from '../fx/FloatText3D';
import { GlyphRings, SandVortex, SerketSpirit, guideSpot, spiritMotes, type SpiritPose } from '../fx/SerketSpirit';

export interface TutorialDeps {
  ctx: Ctx;
  player: Player;
  cam: CameraRig;
}

type Wait = number | (() => boolean);
type Script = Generator<Wait, void, number>;

interface Goal {
  label: string;
  done: boolean;
  text: FloatText3D;
}

interface Totem {
  mesh: THREE.Mesh;
  col: Collider | null;
  at: THREE.Vector3;
  rise: number;
  sink: boolean;
  alive: boolean;
  halo: GlyphRings;
  h: number;
}

const JADE = '#c4ffe0', JADE_GLOW = '#3cff9a';
const KEYS = '#fff3d6', KEY_GLOW = '#ffb070';

export class Tutorial {
  /** true once she has gone (finished or skipped): start the waves */
  done = false;
  /** true when the player skipped */
  skipped = false;
  private ctx: Ctx;
  private player: Player;
  private cam: CameraRig;
  private spirit: SerketSpirit;
  private halo: GlyphRings;
  private sand: SandVortex;
  private texts: FloatText3D[] = [];
  private speech: FloatText3D | null = null;
  private goals: Goal[] = [];
  private co: Script;
  private wait: Wait = 0;
  private t = 0;
  private unsub: (() => void)[] = [];
  private prevJump: ((c: number, b: boolean) => void) | undefined;
  private prevLand: ((l: LandingInfo) => void) | undefined;
  private skipEl: HTMLDivElement;
  /** when BACKSPACE went down (real ms), 0 while up */
  private skipDown = 0;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Backspace') return;
    if (e.type === 'keydown') {
      if (!this.skipDown) this.skipDown = performance.now();
    } else {
      if (this.skipDown && performance.now() - this.skipDown > 600) this.skip();
      this.skipDown = 0;
    }
  };
  private spot = { pos: new THREE.Vector3(), yaw: 0, scale: 0.6 };
  private vel = new THREE.Vector3();
  private leaving = false;
  private props: Totem[] = [];
  private mat = makeVoxelMaterial();
  // what the player has done
  private rideDist = 0;
  private carveT = 0;
  private tuckT = 0;
  private jumpCharged = false;
  private landed: LandingInfo | null = null;
  private bailed = 0;
  private melee = 0;
  private perfect = false;
  private reloads = 0;
  private wasReloading = false;
  private targetsLeft = 0;
  private farT = 0;
  private lastDt = 1 / 60;

  constructor(d: TutorialDeps) {
    this.ctx = d.ctx;
    this.player = d.player;
    this.cam = d.cam;
    const scene = d.ctx.scene;
    guideSpot(this.player.pos, this.cam.yaw, this.ground, this.spot);
    this.spirit = new SerketSpirit(scene, { scale: this.spot.scale });
    this.spirit.root.position.copy(this.spot.pos);
    this.spirit.root.rotation.y = this.spot.yaw;
    this.spirit.form = 0.4;
    this.halo = new GlyphRings(scene, [{ radius: 1.6, y: 0.9, count: 9, speed: 0.6, tilt: [0.18, 0.1] }], 1.6);
    this.halo.appear = 0;
    this.sand = new SandVortex(scene, 380);
    // board callbacks (chained, restored on dispose)
    const b = this.player.board;
    this.prevJump = b.onJump;
    this.prevLand = b.onLand;
    b.onJump = (c, boost) => {
      this.prevJump?.(c, boost);
      if (c >= 0.3) this.jumpCharged = true;
    };
    b.onLand = (l) => {
      this.prevLand?.(l);
      if (this.jumpCharged) this.landed = l;
    };
    const ev = this.ctx.events;
    this.unsub.push(
      ev.on('melee', () => this.melee++),
      ev.on('perfectReload', () => (this.perfect = true)),
      ev.on('propShot', (c: Collider, p: THREE.Vector3) => this.onPropShot(c, p))
    );
    // skipping: hold BACKSPACE, or click
    this.skipEl = document.createElement('div');
    this.skipEl.style.cssText = "position:absolute;right:3vw;top:3vh;font-family:'Alagard';font-size:16px;color:#e8fff2;opacity:.7;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #0a2a1a";
    this.skipEl.textContent = 'hold BACKSPACE to skip the lesson ▸';
    this.skipEl.onpointerdown = (e) => {
      e.stopPropagation();
      this.skip();
    };
    this.ctx.engine.overlay.append(this.skipEl);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.co = this.script();
  }

  private ground = (x: number, z: number) => this.ctx.world.groundAt(x, z);

  // ------------------------------------------------------------------ the lesson
  private *script(): Script {
    const sp = this.spirit;
    this.ctx.sfx('divine_chime', null, 0.6);
    yield 0.7;
    yield* this.line("Ride with me a while, bone-rider. Let's shake the rust off.", 'happy', 'present');

    // 1. ride, carve, tuck
    this.setGoals(['RIDE   W  A  S  D', 'CARVE   A / D  into the turns', 'TUCK   hold SPACE downhill']);
    yield* this.line('Lean into the dunes. W to push, A and D to carve. Hold SPACE to tuck and fly downhill.', 'neutral', 'point');
    yield () => {
      this.check(0, this.rideDist > 26);
      this.check(1, this.carveT > 0.8);
      this.check(2, this.tuckT > 1.0);
      return this.goals.every((g) => g.done);
    };
    yield 0.5;
    this.clearGoals();
    yield* this.line('Ha! The sand still remembers you.', 'laugh', 'open');

    // 2. charge a jump and land it
    this.jumpCharged = false;
    this.landed = null;
    this.setGoals(['JUMP   hold SPACE ... release', 'LAND IT   stay level']);
    yield* this.line('Now hold SPACE to coil those bones, let go to fly, and land it clean.', 'neutral', 'beckon');
    yield () => {
      if (this.jumpCharged) this.check(0, true);
      if (this.landed) {
        if (this.landed.quality === 'bail') {
          this.landed = null;
          this.jumpCharged = false;
          this.bailed++;
          this.retext(0, 'JUMP   hold SPACE ... release', false);
          if (this.bailed <= 2) this.quip(['Ouch. Knees soft, bones. Again.', 'Gravity: one. Skeleton: zero. Again!'][this.bailed - 1]);
        } else this.check(1, true);
      }
      return this.goals.every((g) => g.done);
    };
    yield 0.4;
    this.clearGoals();
    yield* this.line('Graceful. For a corpse.', 'smug', 'present');

    // 3. aim and shoot: three skulls rise out of the sand
    sp.pose = 'raise';
    sp.flick();
    this.raiseTargets();
    yield 1.0;
    this.setGoals(['AIM   hold RIGHT MOUSE', 'SHOOT   LEFT MOUSE', 'SKULLS   0 / 3']);
    yield* this.line('Three old skulls with bad attitudes. Aim with the right mouse, shoot with the left.', 'stern', 'point');
    yield () => {
      if (this.player.aiming) this.check(0, true);
      const hit = 3 - this.targetsLeft;
      if (hit > 0) this.check(1, true);
      this.retext(2, `SKULLS   ${hit} / 3`, hit >= 3);
      this.keepTargetsNear();
      return this.targetsLeft <= 0;
    };
    yield 0.5;
    this.clearGoals();
    yield* this.line('Three for three. Sethos ought to be worried.', 'happy', 'open');

    // 4. reload with the timing ring
    this.perfect = false;
    this.reloads = 0;
    this.player.ammo = Math.min(this.player.ammo, 1);
    this.setGoals(['RELOAD   R', 'VENOM ROUNDS   R again in the bright window']);
    yield* this.line('Your cylinder is nearly dry. Press R, and when the ring flashes in the window, press R again.', 'neutral', 'present');
    yield () => {
      const R = this.player.reload;
      if (R.active) this.check(0, true);
      if (this.wasReloading && !R.active && !this.perfect) {
        this.reloads++;
        if (this.reloads < 3) {
          this.quip(this.reloads === 1 ? 'Too early or too late. Again, and watch the ring.' : 'Closer. Feel the click, then press.');
          this.player.ammo = Math.min(this.player.ammo, 1);
        }
      }
      this.wasReloading = R.active;
      if (this.perfect) this.check(1, true);
      return this.perfect || this.reloads >= 3;
    };
    yield 0.5;
    this.clearGoals();
    yield* this.line(this.perfect ? 'Venom rounds. My own recipe. Mind the aftertaste.' : 'Close enough. Practice makes poison.', 'smug', 'idle');

    // 5. kick
    this.melee = 0;
    this.setGoals(['KICK   F']);
    yield* this.line('Something too close for lead? Kick it. F.', 'stern', 'beckon');
    yield () => {
      this.check(0, this.melee > 0);
      return this.melee > 0;
    };
    yield 0.4;
    this.clearGoals();
    yield* this.line('Lovely form. Very... bony.', 'laugh', 'open');

    // 6. grapple the totem
    sp.pose = 'raise';
    this.raiseTotem();
    yield 1.0;
    this.setGoals(['GRAPPLE   aim at the totem, press Q']);
    yield* this.line('Last trick. Aim at my totem and hook it with Q.', 'neutral', 'point');
    yield () => {
      const hooked = this.player.board.grapple.active;
      this.check(0, hooked);
      this.keepTargetsNear();
      return hooked;
    };
    yield 1.2;
    this.clearGoals();
    this.sinkAll();
    yield* this.line("There. You're ready, or close enough to fake it.", 'happy', 'open');

    // farewell
    sp.pose = 'open';
    yield* this.line('Sethos waits at the eye of the storm. A hundred waves stand between you and your name.', 'stern', 'open', 1.6);
    yield* this.line('Ride well, bone-rider. I will be watching.', 'happy', 'present', 1.0);
    yield* this.depart(false);
  }

  /** she speaks: typed words floating by her head while her jaw moves */
  private *line(s: string, expr = 'neutral', pose: SpiritPose = 'idle', hold = 1.1): Script {
    this.spirit.setExpression(expr);
    this.spirit.pose = pose;
    this.speech?.show(false);
    const t = new FloatText3D(s, { size: 0.12, color: JADE, glow: JADE_GLOW, cps: 40, wrap: 30, hdr: 1.6 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    this.speech = t;
    this.spirit.talking = true;
    this.ctx.sfx('divine_whisper', null, 0.32);
    while (!t.done) yield 0;
    this.spirit.talking = false;
    yield hold + s.length * 0.012;
    t.show(false);
  }

  /** a short aside without blocking the step */
  private quip(s: string) {
    this.speech?.show(false);
    const t = new FloatText3D(s, { size: 0.11, color: JADE, glow: JADE_GLOW, cps: 44, wrap: 30, hdr: 1.5 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    this.speech = t;
    this.spirit.setExpression('sad');
    this.spirit.talking = true;
    this.ctx.engine.tweens.after(1.2, () => (this.spirit.talking = false));
    this.ctx.engine.tweens.after(3.2, () => t.show(false));
  }

  private *depart(fast: boolean): Script {
    this.leaving = true;
    this.clearGoals();
    this.sinkAll();
    const sp = this.spirit;
    sp.pose = 'raise';
    sp.flick();
    this.ctx.sfx('soul_leave', null, 0.8);
    this.sand.center.copy(sp.root.position);
    this.sand.bodyH = sp.height * sp.scale;
    this.sand.bodyR = 0.35;
    this.sand.gather = 1;
    const dur = fast ? 0.6 : 2.2;
    let t = 0;
    while (t < dur) {
      const k = t / dur;
      sp.form = 1 - k;
      this.halo.fade = 1 - k;
      this.sand.intensity = Math.sin(k * Math.PI) * 1.2;
      this.sand.center.copy(sp.root.position);
      if (Math.random() < 0.6) spiritMotes(this.ctx.particles, sp.socket('core'), 2, 0.5 * sp.scale, 2);
      t += yield 0;
    }
    sp.form = 0;
    this.done = true;
  }

  // ------------------------------------------------------------------ goals (floating key prompts by the rider)
  private setGoals(labels: string[]) {
    this.clearGoals();
    this.goals = labels.map((l) => ({ label: l, done: false, text: this.keyText(l, false) }));
  }
  private keyText(s: string, done: boolean) {
    const t = new FloatText3D(s, done ? { size: 0.1, color: '#c8ff9a', glow: '#3cff6a', cps: 0, wrap: 60, hdr: 1.5 } : { size: 0.1, color: KEYS, glow: KEY_GLOW, cps: 60, wrap: 60, hdr: 1.3 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    return t;
  }
  private retext(i: number, s: string, done: boolean) {
    const g = this.goals[i];
    if (!g || (g.label === s && g.done === done)) return;
    g.label = s;
    g.done = done;
    g.text.show(false);
    g.text = this.keyText(done ? `~ ${s} ~` : s, done);
  }
  private check(i: number, ok: boolean) {
    const g = this.goals[i];
    if (!g || g.done || !ok) return;
    this.retext(i, g.label, true);
    this.ctx.sfx('qte_good', null, 0.6);
    this.ctx.fx.sparkle(this.player.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), 0x9dff3a, 8, 0.5);
  }
  private clearGoals() {
    for (const g of this.goals) g.text.show(false);
    this.goals = [];
  }

  // ------------------------------------------------------------------ targets and the totem
  private loadStatic(key: string) {
    const e = modelEntry(key)?.() as { model: VoxelModel; voxelSize: number } | undefined;
    if (!e?.model) return null;
    const g = buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot: 'bottom' });
    const b = e.model.bounds();
    return { g, h: (b.maxY - b.minY + 1) * e.voxelSize };
  }

  private raise(key: string, at: THREE.Vector3, opts: { grapple?: boolean; target?: boolean }) {
    const m = this.loadStatic(key) ?? this.loadStatic('cattle_skull_post');
    if (!m) return;
    at.y = this.ground(at.x, at.z);
    const mesh = new THREE.Mesh(m.g, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(at).add(new THREE.Vector3(0, -m.h - 0.2, 0));
    mesh.rotation.y = Math.atan2(this.player.pos.x - at.x, this.player.pos.z - at.z);
    this.ctx.scene.add(mesh);
    const cols = this.ctx.world.colliders;
    const col = opts.grapple
      ? cols.circle(at.x, at.z, 0.6, at.y, at.y + m.h, { solid: false, bullets: false, tag: 'grapple', data: { tutorial: true } })
      : cols.circle(at.x, at.z, 0.42, at.y, at.y + m.h + 0.1, { solid: false, bullets: true, tag: 'tutorial_target', data: { tutorial: true } });
    const halo = new GlyphRings(this.ctx.scene, [{ radius: opts.grapple ? 0.9 : 0.55, y: 0, count: opts.grapple ? 8 : 6, speed: 1.2, tilt: [0.12, 0] }], 1.8);
    halo.group.position.copy(at).add(new THREE.Vector3(0, m.h + 0.45, 0));
    this.props.push({ mesh, col, at: at.clone(), rise: 0, sink: false, alive: true, halo, h: m.h });
    if (opts.target) this.targetsLeft++;
    this.ctx.sfx('sand_rise', at, 0.8);
    this.ctx.fx.sandBurst(at, 1.1);
    spiritMotes(this.ctx.particles, at, 8, 0.6, 1.5);
  }

  private aheadPoint(dist: number, lateral: number) {
    const f = this.cam.forward();
    const v = this.player.board.vel;
    // lead the rider a little so the targets come up in front of a moving board
    return new THREE.Vector3(this.player.pos.x + f.x * dist - f.z * lateral + v.x * 0.6, 0, this.player.pos.z + f.z * dist + f.x * lateral + v.z * 0.6);
  }

  private raiseTargets() {
    for (const [dd, lat] of [[13, -4], [17, 3.5], [22, -0.5]]) this.raise('cattle_skull_post', this.aheadPoint(dd, lat), { target: true });
  }
  private raiseTotem() {
    this.raise('scorpion_totem', this.aheadPoint(17, 2), { grapple: true });
  }

  /** if he rides off and leaves the lesson behind, the sand brings it back in front of him */
  private keepTargetsNear() {
    const live = this.props.filter((p) => p.alive && !p.sink);
    if (!live.length) return;
    const near = live.some((p) => p.at.distanceTo(this.player.pos) < 45);
    this.farT = near ? 0 : this.farT + this.lastDt;
    if (this.farT < 3) return;
    this.farT = 0;
    const grapple = live.some((p) => p.col?.tag === 'grapple');
    for (const p of live) this.removeProp(p, true);
    this.targetsLeft = 0;
    if (grapple) this.raiseTotem();
    else for (let i = 0; i < live.length; i++) this.raise('cattle_skull_post', this.aheadPoint(13 + i * 4, (i % 2 ? 3 : -3)), { target: true });
    this.quip('Over here, bone-rider.');
  }

  private onPropShot(c: Collider, p: THREE.Vector3) {
    const t = this.props.find((q) => q.col === c && q.alive);
    if (!t) return;
    const at = p ?? t.at;
    this.ctx.fx.hit(at, { x: 0, y: 1, z: 0 }, 'bone', 1.6);
    this.ctx.fx.word(at, 'w_crack');
    this.ctx.sfx('hit_bone', at, 1);
    this.ctx.sfx('rock_crumble', at, 0.6);
    this.ctx.events.emit('gibs', at.x, at.y, at.z, 16, 0.07, [0xf2dcb4, 0xd6b78a, 0xfff1d6, 0x8a6a3a], 5, 3);
    spiritMotes(this.ctx.particles, at, 6, 0.3, 1.2);
    this.removeProp(t, false);
    this.targetsLeft = Math.max(0, this.targetsLeft - 1);
    this.spirit.snip();
  }

  private removeProp(t: Totem, sink: boolean) {
    t.alive = false;
    if (t.col) this.ctx.world.colliders.remove(t.col);
    t.col = null;
    if (sink) t.sink = true;
    else {
      t.mesh.visible = false;
      t.halo.fade = 0;
    }
  }
  private sinkAll() {
    for (const p of this.props) if (p.alive) this.removeProp(p, true);
  }

  // ------------------------------------------------------------------ frame
  skip() {
    if (this.leaving || this.done) return;
    this.skipped = true;
    this.speech?.show(false);
    this.co = this.depart(true);
    this.wait = 0;
  }

  update(dt: number) {
    if (this.done) return;
    this.t += dt;
    this.lastDt = dt;
    const pl = this.player;
    const b = pl.board;
    // what he's doing
    if (b.grounded && b.speed > 3) this.rideDist += b.speed * dt;
    if (b.grounded && b.speed > 4 && Math.abs(b.turnSpeed) > 0.7) this.carveT += dt;
    if (b.grounded && b.tucked && b.speed > 2) this.tuckT += dt;
    // skip by holding Backspace (real time, so a slow frame can't swallow it)
    const held = this.skipDown ? (performance.now() - this.skipDown) / 1000 : 0;
    this.skipEl.style.opacity = String(0.7 + Math.min(0.3, held * 0.5));
    if (held > 0.6) this.skip();
    // the script
    if (typeof this.wait === 'number') {
      this.wait -= dt;
      if (this.wait <= 0) this.step(dt);
    } else if (this.wait()) this.step(dt);
    // the guide floats at his side, leaning into the ride, looking at him
    const sp = this.spirit;
    if (!this.leaving) {
      guideSpot(pl.pos, this.cam.yaw, this.ground, this.spot);
      const k = 1 - Math.exp(-dt * (3.2 + b.speed * 0.4));
      const before = sp.root.position.clone();
      sp.root.position.lerp(this.spot.pos, k);
      this.vel.copy(sp.root.position).sub(before).divideScalar(Math.max(dt, 1e-3));
      sp.form = Math.min(1, sp.form + dt * 1.2);
      sp.scale += (this.spot.scale - sp.scale) * k;
      this.halo.appear = Math.min(1, this.halo.appear + dt * 0.8);
    }
    const yawTo = Math.atan2(pl.pos.x - sp.root.position.x, pl.pos.z - sp.root.position.z);
    let dy = yawTo - sp.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    sp.root.rotation.y += dy * Math.min(1, dt * 4);
    sp.root.rotation.z = THREE.MathUtils.clamp(-this.vel.dot(new THREE.Vector3(Math.cos(sp.root.rotation.y), 0, -Math.sin(sp.root.rotation.y))) * 0.012, -0.25, 0.25);
    sp.look = pl.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0));
    sp.update(dt);
    this.halo.group.position.copy(sp.root.position);
    this.halo.update(dt);
    this.sand.update(dt, this.ctx.world.env.fog);
    if (Math.random() < dt * 6) spiritMotes(this.ctx.particles, sp.socket('core'), 1, 0.4 * sp.scale, 0.8);
    // props rising / sinking
    for (const p of this.props) {
      if (p.sink) p.rise = Math.max(0, p.rise - dt * 1.4);
      else if (p.alive) p.rise = Math.min(1, p.rise + dt * 1.1);
      const e = p.rise * p.rise * (3 - 2 * p.rise);
      p.mesh.position.y = p.at.y - (p.h + 0.2) * (1 - e) + (p.alive ? Math.sin(this.t * 2 + p.at.x) * 0.0 : 0);
      if (p.sink && p.rise > 0 && Math.random() < dt * 12) this.ctx.fx.sandSpray(p.at, { x: 0, y: 1, z: 0 }, 0.4);
      if (p.sink && p.rise <= 0) p.mesh.visible = false;
      p.halo.fade = p.alive ? 1 : Math.max(0, p.halo.fade - dt * 2);
      p.halo.appear = Math.min(1, p.halo.appear + dt * 1.2);
      p.halo.update(dt);
    }
    // floating words, held at a fixed distance from the lens so they always read: her lines
    // beside her head, the key prompts hanging in the air above the rider
    const cam = this.ctx.camera;
    const lens = (at: THREE.Vector3, out: THREE.Vector3) => out.copy(cam.position).addScaledVector(at.sub(cam.position).normalize(), 3.4);
    if (this.speech) lens(sp.socket('head_top').add(new THREE.Vector3(0, 0.3, 0)), this.speech.anchor);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fw = cam.getWorldDirection(new THREE.Vector3());
    const base = cam.position.clone().addScaledVector(fw, 3.4).addScaledVector(up, 0.78);
    this.goals.forEach((g, i) => g.text.anchor.copy(base).addScaledVector(up, -i * 0.15));
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.update(dt, cam, t === this.speech && sp.talking ? () => this.ctx.sfx('ui_hover', null, 0.05, 0.9 + Math.random() * 0.4) : undefined);
      if (t !== this.speech && !this.goals.some((g) => g.text === t) && t.visibleAmount < 0.01) {
        t.dispose();
        this.texts.splice(i, 1);
      }
    }
  }

  private step(dt: number) {
    const r = this.co.next(dt);
    this.wait = r.done ? 1e9 : r.value;
    if (r.done) this.done = true;
  }

  dispose() {
    const b = this.player.board;
    b.onJump = this.prevJump;
    b.onLand = this.prevLand;
    for (const u of this.unsub) u();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.skipEl.remove();
    for (const t of this.texts) t.dispose();
    this.texts = [];
    for (const p of this.props) {
      if (p.col) this.ctx.world.colliders.remove(p.col);
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.halo.dispose();
    }
    this.props = [];
    this.mat.dispose();
    this.spirit.dispose();
    this.halo.dispose();
    this.sand.dispose();
  }
}
