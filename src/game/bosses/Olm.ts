// THE OLM — the blind albino mother of the Glass Hollow (cave boss).
//
// A ~16 m pale salamander that lives in the cave lake. It is BLIND: it hunts by
// vibration. Every push of the board, every boost, landing and gunshot is "heard"
// (CaveScene calls hear()); loud riding draws it straight to you, quiet coasting
// makes it lose you, and while it SEARCHES (head swaying, gills flared) it takes
// extra damage from a hunter it cannot find. Its feathery gills are the weak spot.
//
// Moves (song titles, called out over its head):
//   "Octopus's Garden"            the intro: the lake boils and it erupts from the water.
//   "Can't You Hear Me Knocking"  dives into the sand, tunnels toward the loudest noise
//                                 (a travelling sand swell), a ring marks where it will
//                                 burst up, then it erupts and snaps.
//   "I Want You (She's So Heavy)" rears up and INHALES with its giant sucking mouth: the
//                                 hunter is dragged in; caught at the lips -> a mash QTE
//                                 to RESIST (kick free, the Olm is left gagging and open)
//                                 or be swallowed and spat out.
//   "Rain"                        arcs volleys of slime from its gills and mouth.
//   "The Long and Winding Road"   a sinuous S-curve charge through the hunter.
//   "Rain Fall Down"              (phase 2+) slams the cave: stalactites fall on red rings.
//   "The End"                     its death: it thrashes, rears and sinks into the lake.
//
// Integration: CaveScene spawns it (new Olm(deps, { lake, hp })), registers it with
// enemies.registerExternal, places it in the lake and awaits start(); onDefeated fires
// after the death sequence. hear(x, z, loudness) feeds it vibrations.
import * as THREE from 'three';
import { Boss, BossDeps } from './Boss';
import type { Hit } from '../combat/Damage';
import { clamp, damp, dampAngle, lerp, rnd } from '../../engine/math/rand';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const SLIME = [{ id: 'slow' as const, stacks: 1, dur: 2.2 }];

export interface OlmOpts {
  lake: { x: number; z: number; r: number };
  water: number;
  hp: number;
  /** stir / ripple the lake surface (the cave world) */
  stir?: (k: number) => void;
  ripple?: (x: number, z: number, k: number) => void;
  /** ceiling height for falling stalactites */
  ceilingAt?: (x: number, z: number) => number;
  /** a pre-allocated light that keeps the pale hide readable in the dark */
  light?: THREE.PointLight;
}

let stalGeo: THREE.BufferGeometry[] | null = null;
function stalactiteGeos() {
  if (!stalGeo) {
    stalGeo = [];
    for (const k of ['stalactite_0', 'stalactite_3', 'stalactite_1']) {
      const sm = modelEntry(k)?.() as { model: VoxelModel; voxelSize: number } | undefined;
      if (sm?.model) stalGeo.push(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: [0, 0, 0] }));
    }
  }
  return stalGeo;
}

export class Olm extends Boss {
  /** 0 surfaced … 1 sunk under the sand / water */
  sub = 1;
  private subT = 1;
  private subRate = 2;
  private swim = 0;
  private jaw = 0;
  private jawT = 0;
  private flare = 0;
  private flareT = 0;
  private rear = 0;
  private rearT = 0;
  private lastYaw = 0;
  private turn = 0;
  private headYaw = 0;
  /** how well it can hear the hunter right now (0..1) and where it last heard him */
  hearing = 0;
  heard = new THREE.Vector3();
  private quietT = 0;
  searching = false;
  private dazed = 0;
  private trailT = 0;
  private told = false;
  private falling: { mesh: THREE.Mesh; vy: number; x: number; z: number; g: number }[] = [];
  private deadT = -1;
  private chargeHit = false;
  constructor(d: BossDeps, private o: OlmOpts) {
    super(d, 'olm_boss', { name: 'The Olm', title: 'Blind Mother of the Glass Hollow', hp: o.hp, scale: 1.3 });
    this.flying = true;
    this.armor = 40;
    this.physRes = 0.08;
    this.magicRes = 0.12;
    this.statusRes = { poison: 0.4, bleed: 0.2 };
    this.bounty = 420;
    this.gold = 220;
    this.phases = [0.66, 0.33];
    this.hitSpheres = [
      { node: 'head', r: 0.85, part: 'head', offset: [0, -0.05, 1.0], weak: 1.25 },
      { node: 'gill_l1', r: 0.36, part: 'gills', offset: [0.35, 0.15, -0.25], weak: 1.9 },
      { node: 'gill_l2', r: 0.36, part: 'gills', offset: [0.35, 0.0, -0.25], weak: 1.9 },
      { node: 'gill_l3', r: 0.34, part: 'gills', offset: [0.3, -0.15, -0.25], weak: 1.9 },
      { node: 'gill_r1', r: 0.36, part: 'gills', offset: [-0.35, 0.15, -0.25], weak: 1.9 },
      { node: 'gill_r2', r: 0.36, part: 'gills', offset: [-0.35, 0.0, -0.25], weak: 1.9 },
      { node: 'gill_r3', r: 0.34, part: 'gills', offset: [-0.3, -0.15, -0.25], weak: 1.9 },
      { node: 'body', r: 0.85, part: 'body', offset: [0, 0, -0.3] },
      { node: 'spine1', r: 0.85, part: 'body', offset: [0, 0, -0.95] },
      { node: 'spine2', r: 0.75, part: 'body', offset: [0, 0, -0.8] },
      { node: 'tail1', r: 0.55, part: 'tail', offset: [0, 0, -0.6] },
      { node: 'tail2', r: 0.42, part: 'tail', offset: [0, 0, -0.55] },
    ];
    this.heard.set(o.lake.x, 0, o.lake.z);
    this.root.visible = false;
    this.invulnerable = true;
    // translucent albino hide: a faint glow of its own under the skin
    this.rig.material.emissive.setRGB(0.07, 0.05, 0.055);
  }

  protected hitKind() {
    return 'flesh' as any;
  }

  // ------------------------------------------------------------- senses
  /** a vibration at (x, z): loud riding / gunfire close by is heard best */
  hear(x: number, z: number, loud: number) {
    if (!this.alive) return;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    const k = loud * clamp(1.4 - d / 70, 0.25, 1.2);
    if (k < 0.02) return;
    this.hearing = Math.min(1, this.hearing + k);
    this.heard.set(x, 0, z);
    this.quietT = 0;
    if (this.searching && this.hearing > 0.45) {
      this.searching = false;
      this.ctx.sfx('boss_roar', this.pos, 0.5, 0.7);
    }
  }
  private mouth(out: THREE.Vector3) {
    out.set(0, -0.08, 2.05);
    this.rig.nodes['head'].localToWorld(out);
    return out;
  }
  private callout(title: string) {
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 0.9, z: this.pos.z };
    this.d.enemies.callout(title, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title, enemy: this, pos, tier: 'boss' });
  }
  private surfY(x: number, z: number) {
    return Math.max(this.ctx.world.groundAt(x, z), this.o.water - 0.2) - 0.2;
  }

  // ------------------------------------------------------------- damage
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    const m = (this.searching ? 1.4 : 1) * (this.dazed > 0 ? 2 : 1);
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * m }, point, dir);
    if (amt > 0 && hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      this.flare = Math.min(1.4, this.flare + 0.3);
      if (this.searching && !this.told) {
        this.told = true;
        this.ctx.toast('IT CANNOT SEE YOU', '#9af0ff', 'Coast quietly and it loses you: shots from the dark hit harder.');
      }
      // it hears where the shots come from
      this.hear(this.player.pos.x, this.player.pos.z, 0.18);
    }
    return amt;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    this.callout(p >= 2 ? 'Gimme Shelter' : 'Under My Thumb');
    this.o.stir?.(1);
    if (p === 1) this.summon('crystalCrab', 2, 9, 'sand');
    else this.summon('caveBat', 3, 8, 'run');
  }

  // ------------------------------------------------------------- intro: it erupts from the lake
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    const eng = ctx.engine;
    const L = this.o.lake;
    const pp = this.player.pos.clone();
    const toP = new THREE.Vector3(pp.x - L.x, 0, pp.z - L.z).normalize();
    this.pos.set(L.x + toP.x * 3, this.o.water - 4, L.z + toP.z * 3);
    this.yaw = Math.atan2(toP.x, toP.z);
    this.sub = this.subT = 1;
    eng.letterbox(true, 0.5);
    const camPos = new THREE.Vector3(L.x + toP.x * (L.r + 6) - toP.z * 6, this.o.water + 3.2, L.z + toP.z * (L.r + 6) + toP.x * 6);
    cam.setCine({ pos: camPos, look: new THREE.Vector3(L.x, this.o.water + 2, L.z), fov: 52 });
    ctx.sfx('quake_rumble', this.pos, 1, 0.7);
    ctx.shake(0.3);
    // the lake boils
    for (let i = 0; i < 18; i++) {
      this.o.stir?.(1);
      if (i % 3 === 0) this.o.ripple?.(L.x + (rnd.next() - 0.5) * 6, L.z + (rnd.next() - 0.5) * 6, 1);
      ctx.particles.emit({ pos: { x: L.x + (rnd.next() - 0.5) * 8, y: this.o.water + 0.05, z: L.z + (rnd.next() - 0.5) * 8 }, count: 4, spread: 1, up: 1.5, life: [0.4, 0.9], size: [0.12, 0.2], sprite: 'bubble', color: [0xbfefff, 0x8ad8f0] });
      await ctx.engine.tweens.wait(0.08);
    }
    this.callout("Octopus's Garden");
    // ERUPTION
    this.root.visible = true;
    this.subT = 0;
    this.subRate = 3.2;
    this.rearT = 1;
    this.flareT = 1;
    this.jawT = 0.8;
    eng.slowMo(0.35, 10);
    ctx.sfx('sand_burst', this.pos, 1, 0.6);
    ctx.sfx('boss_roar', this.pos, 1, 0.62);
    ctx.shake(0.8);
    const wp = { x: this.pos.x, y: this.o.water + 0.3, z: this.pos.z };
    ctx.particles.emit({ pos: wp, count: 70, spread: 9, up: 14, gravity: 14, life: [0.8, 1.6], size: [0.1, 0.06], sprite: 'dot3', color: [0xd6f0ff, 0x9ad8f0, 0xffffff], ground: true });
    ctx.particles.emit({ pos: wp, count: 18, spread: 4, up: 6, life: [1.2, 2.2], size: [1.6, 3.6], sprite: ['cloud0', 'cloud1', 'puff0'], color: [0xcfe8f0, 0xa8d0dc], alpha: 0.75, drag: 1.4, rot: 6, rotSpeed: 0.6 });
    for (let k = 0; k < 4; k++) this.o.ripple?.(this.pos.x, this.pos.z, 1.4);
    ctx.events.emit('bossIntro', this);
    await ctx.engine.tweens.wait(0.6);
    // the camera climbs to frame the head against the vault
    const head = this.rig.nodes['head'].getWorldPosition(new THREE.Vector3());
    cam.setCine({ pos: camPos.clone().lerp(head, 0.45).add(new THREE.Vector3(0, 1.5, 0)), look: head, fov: 44 });
    await ctx.engine.tweens.wait(1.6);
    eng.slowMo(1, 4);
    this.jawT = 0;
    this.rearT = 0;
    this.flareT = 0;
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.invulnerable = false;
    this.hearing = 1;
    this.heard.copy(this.player.pos);
  }

  // ------------------------------------------------------------- the fight
  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      // lost him: search (the opening)
      if (this.hearing < 0.22) {
        await this.search();
        continue;
      }
      const d = this.distToPlayer();
      const r = rnd.next();
      if (d > 26 || (r < 0.25 && d > 10)) await this.knocking();
      else if (r < 0.48 && d < 24) await this.inhale();
      else if (p >= 1 && r < 0.62) await this.rainFallDown();
      else if (r < 0.8) await this.rain();
      else await this.windingRoad();
      await this.wait(p >= 2 ? 0.35 : 0.7);
    }
  }

  /** blind: wander to where it last heard him, head swaying, gills flared, listening */
  private async search() {
    this.searching = true;
    this.flareT = 0.6;
    const ctx = this.ctx;
    ctx.sfx('boss_hurt', this.pos, 0.35, 0.55);
    const t0 = this.t;
    while (this.searching && this.t - t0 < 7) {
      const a = rnd.next() * Math.PI * 2;
      const x = this.heard.x + Math.cos(a) * 6, z = this.heard.z + Math.sin(a) * 6;
      await this.moveTo(x, z, 3.2, 2.2);
      this.stop();
      await this.wait(0.6);
    }
    this.searching = false;
    this.flareT = 0;
    this.hearing = Math.max(this.hearing, 0.5);
  }

  /** dive and tunnel toward the noise, then burst up under it */
  private async knocking() {
    const ctx = this.ctx;
    this.callout("Can't You Hear Me Knocking");
    this.subT = 1;
    this.subRate = 1.6;
    ctx.sfx('sand_rise', this.pos, 1, 0.6);
    ctx.fx.sandBurst({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 2);
    await this.wait(0.7);
    this.invulnerable = true;
    const t0 = this.t;
    while (this.t - t0 < 4.2) {
      const tx = this.heard.x, tz = this.heard.z;
      this.moveTarget = new THREE.Vector3(tx, 0, tz);
      this.moveSpeed = 14 + this.phase * 2;
      await this.wait(0.1);
      if (Math.hypot(this.pos.x - tx, this.pos.z - tz) < 3) break;
    }
    this.stop();
    // where it will come up
    const at = new THREE.Vector3(this.heard.x, 0, this.heard.z);
    at.y = ctx.world.groundAt(at.x, at.z);
    for (let i = 0; i < 4; i++) {
      ctx.fx.ring({ x: at.x, y: at.y + 0.15, z: at.z }, 0xff6a3a, 7, 0.3);
      ctx.fx.sandSpray({ x: at.x, y: at.y + 0.1, z: at.z }, { x: 0, y: 3, z: 0 }, 2);
      ctx.shake(0.12);
      await this.wait(0.2);
    }
    this.pos.x = at.x;
    this.pos.z = at.z;
    this.subT = 0;
    this.subRate = 5;
    this.rearT = 1;
    this.jawT = 1;
    this.invulnerable = false;
    ctx.sfx('sand_burst', at, 1, 0.55);
    ctx.sfx('boss_roar', at, 0.9, 0.7);
    ctx.fx.sandBurst({ x: at.x, y: at.y, z: at.z }, 3);
    ctx.fx.dust({ x: at.x, y: at.y + 1, z: at.z }, 3, 0xd9b27a, 8);
    ctx.shake(0.7);
    ctx.world.deform(at.x, at.z, 3.5, 0.6);
    ctx.events.emit('groundMark', at.x, at.z, 4, 1);
    if (this.o.ripple && at.y <= this.o.water + 0.05) this.o.ripple(at.x, at.z, 1.5);
    const pd = Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z);
    if (pd < 3.8) this.player.takeHit({ base: 26, kind: 'phys', source: 'contact', knock: 15 }, at);
    await this.wait(0.5);
    this.jawT = 0;
    this.rearT = 0;
    await this.wait(0.4);
  }

  /** rear up and inhale: drag the hunter into the mouth; a mash QTE to resist */
  private async inhale() {
    const ctx = this.ctx;
    this.stop();
    this.callout('I Want You (She’s So Heavy)');
    this.rearT = 0.55;
    this.flareT = 1;
    for (let i = 0; i < 10; i++) {
      this.faceTarget(this.player.pos, 6, 0.06);
      this.jawT = (i + 1) / 10;
      await this.wait(0.06);
    }
    ctx.sfx('storm_loop', this.pos, 0.6, 0.6);
    ctx.sfx('whoosh_big', this.pos, 1, 0.5);
    const t0 = this.t;
    const dur = 3.2 + this.phase * 0.6;
    let caught = false;
    while (this.t - t0 < dur) {
      this.faceTarget(this.player.pos, 2.5, 0.05);
      const m = this.mouth(_v);
      const pp = this.player.pos;
      const dx = m.x - pp.x, dz = m.z - pp.z;
      const d = Math.hypot(dx, dz) || 1;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const front = -(dx * fx + dz * fz) / d;
      if (d < 28 && front > 0.2 && this.player.alive) {
        const pull = (12 + this.phase * 3) * clamp(1.4 - d / 28, 0.35, 1.2);
        this.player.board.vel.x += (dx / d) * pull * 0.05;
        this.player.board.vel.z += (dz / d) * pull * 0.05;
        if (d < 4.6 && !caught && (this.player.invuln ?? 0) <= 0) {
          caught = true;
          break;
        }
      }
      // everything loose streams into the mouth
      for (let k = 0; k < 3; k++) {
        const a = this.yaw + (rnd.next() - 0.5) * 1.4, r = 4 + rnd.next() * 14;
        const x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r;
        const y = ctx.world.groundAt(x, z) + 0.2 + rnd.next() * 2;
        const vx = (m.x - x) * 1.6, vy = (m.y - y) * 1.6, vz = (m.z - z) * 1.6;
        ctx.particles.emit({ pos: { x, y, z }, count: 2, vel: { x: vx, y: vy, z: vz }, life: [0.45, 0.6], size: [0.06, 0.03], sprite: 'dot3', color: [0xd9b27a, 0xe8d0a0, 0xbfe8f0], drag: 0.2, stretch: 0.04 });
        if (rnd.chance(0.3)) ctx.particles.emit({ pos: { x, y, z }, count: 1, vel: { x: vx * 0.7, y: vy * 0.7, z: vz * 0.7 }, life: [0.5, 0.7], size: [0.8, 0.2], sprite: ['puff0', 'puff1'], color: 0xd8c8a8, alpha: 0.35 });
      }
      if (rnd.chance(0.2)) ctx.shake(0.06);
      await this.wait(0.05);
    }
    if (caught) {
      this.player.board.vel.multiplyScalar(0.1);
      const r = await this.qte({ kind: 'mash', key: 'KeyE', label: 'RESIST!', duration: 2.3, target: 13 + this.phase * 2 });
      const m = this.mouth(_v2);
      const away = new THREE.Vector3(this.player.pos.x - m.x, 0, this.player.pos.z - m.z).normalize();
      if (r === 'good' || r === 'perfect') {
        // he braces on the lips and kicks free; it gags, jaw hanging open
        this.player.board.vel.set(away.x * 24, 6, away.z * 24);
        this.player.invuln = Math.max(this.player.invuln, 1);
        ctx.sfx('kick', m, 1, 0.8);
        ctx.sfx('boss_hurt', this.pos, 1, 0.6);
        ctx.toast(r === 'perfect' ? 'KICKED RIGHT IN THE GULLET' : 'BROKE FREE', '#9af0ff', 'It is gagging: hit the gills!', true);
        this.takeDamage({ base: r === 'perfect' ? 140 : 80, kind: 'phys', source: 'counter', canCrit: false }, m);
        this.dazed = 3.2;
        this.jawT = 1;
        this.rearT = 0;
        await this.wait(this.dazed);
      } else {
        // swallowed… and spat back out
        this.player.root.visible = false;
        this.jawT = 0;
        ctx.sfx('gore_splat', m, 1, 0.6);
        ctx.shake(0.6);
        await this.wait(0.9);
        this.jawT = 1;
        this.player.root.visible = true;
        this.player.board.vel.set(away.x * 18, 8, away.z * 18);
        this.player.takeHit({ base: Math.max(30, this.player.maxHp * 0.3), kind: 'phys', source: 'contact', knock: 6 }, m);
        ctx.particles.emit({ pos: m, count: 30, spread: 5, up: 3, gravity: 12, life: [0.5, 1.1], size: [0.12, 0.06], sprite: ['ichor', 'dot3'], color: [0xd8f0d0, 0xc8e8c0, 0xf0f0e0], ground: true });
        ctx.toast('SWALLOWED… AND SPAT OUT', '#ffb0a0');
        await this.wait(0.5);
      }
    }
    this.jawT = 0;
    this.rearT = 0;
    this.flareT = 0;
    await this.wait(0.4);
  }

  /** arcing volleys of slime from the gills and mouth */
  private async rain() {
    const ctx = this.ctx;
    this.stop();
    this.callout('Rain');
    this.flareT = 1.2;
    this.jawT = 0.45;
    const n = 5 + this.phase * 2;
    for (let i = 0; i < n; i++) {
      this.faceTarget(this.player.pos, 5, 0.05);
      const m = this.mouth(_v);
      const pv = this.player.board.vel;
      const tgt = this.player.center(_v2).add(new THREE.Vector3(pv.x * 0.6, 0, pv.z * 0.6));
      this.d.enemies.proj.pattern('lob', m, tgt, { count: 3 + this.phase, spread: 0.55, speed: 15, dmg: 8 + this.phase * 2, proj: 'venom', status: SLIME, sourceId: this.id });
      ctx.sfx('poison_burst', m, 0.6, 0.7 + rnd.next() * 0.2);
      ctx.particles.emit({ pos: m, count: 6, spread: 2, up: 2, gravity: 10, life: [0.3, 0.6], size: [0.1, 0.05], sprite: 'dot3', color: [0xd8f0d0, 0xbfe8c0] });
      await this.wait(0.32);
    }
    this.flareT = 0;
    this.jawT = 0;
    await this.wait(0.4);
  }

  /** a winding S-charge through the hunter */
  private async windingRoad() {
    const ctx = this.ctx;
    this.callout('The Long and Winding Road');
    this.rearT = 0.2;
    ctx.sfx('boss_roar', this.pos, 0.8, 0.8);
    await this.wait(0.4);
    this.rearT = 0;
    const pp = this.player.pos.clone();
    const dir = new THREE.Vector3(pp.x - this.pos.x, 0, pp.z - this.pos.z);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const total = len + 12;
    this.chargeHit = false;
    for (let k = 1; k <= 4; k++) {
      const along = (total * k) / 4;
      const sway = (k % 2 ? 1 : -1) * (k === 4 ? 0 : 4.5);
      const x = this.pos.x + dir.x * (total / 4) + side.x * sway, z = this.pos.z + dir.z * (total / 4) + side.z * sway;
      void along;
      await this.moveTo(x, z, 15 + this.phase * 2.5, 1.2);
    }
    this.stop();
    await this.wait(0.5);
  }

  /** slam the cave: stalactites rain down on red rings */
  private async rainFallDown() {
    const ctx = this.ctx;
    this.stop();
    this.callout('Rain Fall Down');
    this.rearT = 1;
    await this.wait(0.55);
    this.rearT = 0;
    ctx.sfx('explosion_big', this.pos, 0.7, 0.6);
    ctx.sfx('quake_rumble', this.pos, 1, 0.8);
    ctx.shake(0.9);
    ctx.fx.sandBurst({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, 3);
    const geos = stalactiteGeos();
    const n = 6 + this.phase * 3;
    const pp = this.player.pos;
    const pv = this.player.board.vel;
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2, r = i === 0 ? 0 : 2 + rnd.next() * 9;
      const x = pp.x + pv.x * 0.8 + Math.cos(a) * r, z = pp.z + pv.z * 0.8 + Math.sin(a) * r;
      const g = ctx.world.groundAt(x, z);
      ctx.fx.ring({ x, y: g + 0.15, z }, 0xff4a2a, 4.2, 1.2);
      ctx.engine.tweens.after(0.1 * i, () => ctx.fx.ring({ x, y: g + 0.15, z }, 0xff4a2a, 4.2, 0.9));
      const top = this.o.ceilingAt ? Math.min(60, this.o.ceilingAt(x, z)) : g + 24;
      if (geos.length) {
        const mesh = new THREE.Mesh(geos[i % geos.length], sharedVoxelMaterial);
        mesh.castShadow = true;
        mesh.position.set(x, top + 6, z);
        mesh.rotation.y = rnd.next() * 6.28;
        mesh.visible = false;
        ctx.scene.add(mesh);
        ctx.engine.tweens.after(0.35 + i * 0.08, () => {
          mesh.visible = true;
          mesh.position.y = top;
          this.falling.push({ mesh, vy: -2, x, z, g });
          ctx.sfx('rock_crumble', { x, y: top, z }, 0.5, 1.1);
        });
      }
    }
    await this.wait(1.6);
  }

  // ------------------------------------------------------------- death: "The End"
  die() {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    this.callout('The End');
    ctx.engine.slowMo(0.2, 20);
    ctx.engine.tweens.after(1.6, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.7);
    ctx.sfx('boss_roar', this.pos, 1, 0.5);
    ctx.shake(1);
    ctx.engine.flash(0xe8f8ff, 0.3, 0.6);
    this.deadT = 0;
    this.jawT = 1;
    this.rearT = 1;
    this.flareT = 1.4;
    this.invulnerable = true;
    this.stop();
    ctx.events.emit('bossKilled', this);
  }

  // ------------------------------------------------------------- per frame
  update(dt: number) {
    if (this.deadT >= 0) this.updateDeath(dt);
    // the senses fade; quiet long enough and it loses the hunter
    this.hearing = Math.max(0, this.hearing - dt * 0.09);
    this.quietT += dt;
    this.dazed = Math.max(0, this.dazed - dt);
    // depth: surfaced on the sand or floating in the lake, or sunk out of sight
    this.sub = damp(this.sub, this.subT, this.subRate, dt);
    const sy = this.surfY(this.pos.x, this.pos.z);
    const sunk = Math.min(this.ctx.world.groundAt(this.pos.x, this.pos.z), this.o.water) - 3.6 * this.scale;
    this.pos.y = lerp(sy, sunk, this.sub);
    this.invulnerable = this.invulnerable || (this.sub > 0.75 && this.deadT < 0);
    if (this.sub < 0.6 && this.deadT < 0 && this.alive && this.running && this.root.visible) this.invulnerable = false;
    super.update(dt);
    // a cold light hangs over its head so the pale hide reads in the dark
    const lt = this.o.light;
    if (lt) {
      const on = this.root.visible && this.sub < 0.7 ? 1 : 0;
      lt.intensity = damp(lt.intensity, on * 34, 3, dt);
      if (on) {
        this.rig.nodes['head'].localToWorld(lt.position.set(0, 2.2, 0.6));
      }
    }
    // the swell it pushes through the sand while tunnelling; the wake in the lake
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 2) {
      this.trailT = 0.18;
      const g = this.ctx.world.groundAt(this.pos.x, this.pos.z);
      const inLake = g <= this.o.water + 0.05;
      if (this.sub > 0.5) {
        if (!inLake) {
          (this.ctx.world as any).sand?.mound?.(this.pos.x, this.pos.z, { height: 0.55, width: 2.4, life: 1.1, rise: 0.25, fall: 0.6 });
          this.ctx.fx.sandSpray({ x: this.pos.x, y: g + 0.1, z: this.pos.z }, { x: this.vel.x * 0.1, y: 2.5, z: this.vel.z * 0.1 }, 1.6);
          if (rnd.chance(0.4)) this.ctx.sfx('sand_rise', this.pos, 0.35, 0.7);
        } else this.o.ripple?.(this.pos.x, this.pos.z, 0.7);
      } else if (inLake) {
        this.o.ripple?.(this.pos.x - Math.sin(this.yaw) * 2, this.pos.z - Math.cos(this.yaw) * 2, 0.5);
        this.o.stir?.(0.4);
      } else this.ctx.fx.sandSpray({ x: this.pos.x, y: g + 0.05, z: this.pos.z }, { x: -this.vel.x * 0.15, y: 1.2, z: -this.vel.z * 0.15 }, 1);
    }
    // the S-charge flattens what it hits
    if (this.alive && sp > 10 && this.sub < 0.4 && !this.chargeHit) {
      const h = this.rig.nodes['head'].getWorldPosition(_v);
      if (Math.hypot(this.player.pos.x - h.x, this.player.pos.z - h.z) < 2.8) {
        this.chargeHit = true;
        this.player.takeHit({ base: 22, kind: 'phys', source: 'contact', knock: 16 }, h);
      }
    }
    // falling stalactites
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.vy -= 26 * dt;
      f.mesh.position.y += f.vy * dt;
      if (f.mesh.position.y > f.g + 0.6) continue;
      this.falling.splice(i, 1);
      const ctx = this.ctx;
      const p = { x: f.x, y: f.g + 0.4, z: f.z };
      ctx.events.emit('gibs', p.x, p.y + 0.5, p.z, 16, 0.3, [0xb8a080, 0x8a7864, 0xd2c0a0], 8, 6);
      ctx.fx.dust(p, 2, 0xb8a080, 6);
      ctx.sfx('rock_crumble', p, 1, 0.8);
      ctx.shake(0.2);
      if (Math.hypot(this.player.pos.x - f.x, this.player.pos.z - f.z) < 2.6) this.player.takeHit({ base: 22 + this.phase * 4, kind: 'phys', source: 'contact', knock: 10 }, new THREE.Vector3(f.x, f.g, f.z));
      f.mesh.removeFromParent();
    }
  }

  private updateDeath(dt: number) {
    const ctx = this.ctx;
    this.deadT += dt;
    const t = this.deadT;
    this.vel.set(0, 0, 0);
    // thrash, rear, then sink
    this.yaw += Math.sin(t * 7) * dt * 1.6 * Math.max(0, 1 - t / 2.5);
    if (t > 1.6) {
      this.rearT = 0;
      this.subT = 1;
      this.subRate = 0.7;
    }
    if (Math.random() < dt * 8 && t < 3.5) {
      const m = this.mouth(_v);
      ctx.particles.emit({ pos: m, count: 4, spread: 3, up: 2, gravity: 10, life: [0.4, 0.9], size: [0.1, 0.05], sprite: 'dot3', color: [0xd6f0ff, 0xf0d8d8] });
      this.o.ripple?.(this.pos.x, this.pos.z, 1);
      this.o.stir?.(1);
    }
    if (t > 4.2 && this.root.visible) {
      this.root.visible = false;
      ctx.fx.coins({ x: this.pos.x, y: this.surfY(this.pos.x, this.pos.z) + 1.2, z: this.pos.z }, 40);
      this.onDefeated?.(this, false);
      this.deadT = -1;
      this.dispose();
    }
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // turning: the chain lags behind the head
    let dy = this.yaw - this.lastYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.lastYaw = this.yaw;
    this.turn = damp(this.turn, clamp(dy / Math.max(dt, 1e-3), -2.5, 2.5), 5, dt);
    const moving = clamp(sp / 6, 0.15, 1.3);
    this.swim += dt * (1.6 + sp * 0.45);
    this.jaw = damp(this.jaw, this.jawT, 9, dt);
    this.flare = damp(this.flare, this.flareT, 4, dt);
    this.rear = damp(this.rear, this.rearT, 3.5, dt);
    const chain = ['spine1', 'spine2', 'tail1', 'tail2', 'tail3', 'tail4'];
    chain.forEach((k, i) => {
      const nd = n[k];
      if (!nd) return;
      const A = (0.05 + i * 0.045) * moving;
      nd.rotation.y = Math.sin(this.swim - (i + 1) * 0.85) * A - this.turn * 0.09 * (i + 1) * 0.6;
      nd.rotation.x = (i < 2 ? this.rear * 0.12 : 0) + (this.deadT >= 0 ? Math.sin(this.t * 9 + i) * 0.12 : 0);
    });
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    // head: steadier than the body, turned toward what it hears; rears up to inhale
    const tx = (this.searching ? Math.sin(this.t * 1.3) * 0.5 : 0) + clamp(Math.atan2(this.heard.x - this.pos.x, this.heard.z - this.pos.z) - this.yaw, -0.6, 0.6) * (this.searching ? 0 : 0.3);
    this.headYaw = damp(this.headYaw, Number.isFinite(tx) ? tx : 0, 3, dt);
    if (n['body']) n['body'].rotation.set(-this.rear * 0.42 + hitK * 0.05, Math.sin(this.swim) * 0.05 * moving, Math.sin(this.swim * 0.5) * 0.03);
    if (n['head']) n['head'].rotation.set(this.rear * 0.15 - this.jaw * 0.12 + hitK * 0.1 + Math.sin(this.t * 0.9) * 0.03, -Math.sin(this.swim + 0.4) * 0.06 * moving + this.headYaw, (this.dazed > 0 ? Math.sin(this.t * 6) * 0.12 : 0));
    if (n['jaw']) n['jaw'].rotation.x = this.jaw * 0.8 + (this.dazed > 0 ? 0.15 + Math.sin(this.t * 5) * 0.08 : 0);
    // gills breathe and flutter, flaring wide when it hunts, gags or hurts
    for (let g = 1; g <= 3; g++) {
      const ph = this.t * (2.2 + this.flare * 2) + g * 0.9;
      const f = Math.sin(ph) * (0.1 + this.flare * 0.12) + this.flare * 0.35;
      if (n['gill_l' + g]) n['gill_l' + g].rotation.set(Math.sin(ph * 0.7) * 0.08, -f * 0.6, f);
      if (n['gill_r' + g]) n['gill_r' + g].rotation.set(Math.sin(ph * 0.7) * 0.08, f * 0.6, -f);
    }
    // the little legs paddle when it moves on land, fold back when it swims or sinks
    const pad = this.sub > 0.4 ? 0 : moving;
    const legs: [string, number][] = [['leg_fl', 0], ['leg_fr', Math.PI], ['leg_bl', Math.PI], ['leg_br', 0]];
    for (const [k, off] of legs) {
      const nd = n[k];
      if (!nd) continue;
      const s = k.endsWith('l') ? 1 : -1;
      nd.rotation.set(Math.sin(this.swim * 1.3 + off) * 0.45 * pad, Math.cos(this.swim * 1.3 + off) * 0.2 * pad, s * (this.sub > 0.4 ? 0.9 : 0.05));
    }
  }

  dispose() {
    for (const f of this.falling) f.mesh.removeFromParent();
    this.falling.length = 0;
    super.dispose();
  }
}
