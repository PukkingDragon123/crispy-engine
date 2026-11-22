// GUNS N' ROSES (X, VI THE LOVERS): a rose-thorn and bullet storm.
// Sundown spins on the deck fanning the hammer: a spiral of rounds sprays out all
// around him (every third one snaps onto the nearest target), while thorned rose
// vines burst out of the sand under the closest prey, coil around them (rooted,
// bleeding) and, when the storm ends, bloom: each bloom bursts in a shower of
// thorns whose damage grows with the bleeding the storm left on its prey.
// Cards hook in through `extraRoses`, `bulletMul`, `bloomMul` and `rain` (s of
// lingering thorn rain after the bloom: November Rain).
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { roseVineRig } from '../models/props/roses';
import { clamp, rnd } from '../../engine/math/rand';

export const ROSES = { bullets: 20, storm: 1.5, range: 17, bulletDmg: 14, roses: 4, rootR: 15, root: 1.6, bloomBase: 34, bloomPerBleed: 9, bloomR: 2.8 };

interface Rose {
  rig: RigInstance;
  host: EnemyLike;
  t: number;
  life: number;
  bloomed: boolean;
  sc: number;
  yaw: number;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class GunsNRoses {
  /** card hooks */
  extraRoses = 0;
  bulletMul = 1;
  bloomMul = 1;
  rain = 0;
  active = 0;
  private roses: Rose[] = [];
  private free: RigInstance[] = [];
  private mat: VoxelMaterial;
  private shots: { t: number; a: number; aimed: boolean }[] = [];
  private stormT = 0;
  private rainT = 0;
  private rainAt = new THREE.Vector3();

  constructor(private ctx: Ctx, private player: Player) {
    this.mat = makeVoxelMaterial();
  }

  private rig() {
    const r = this.free.pop();
    if (r) return r;
    const rig = new RigInstance(buildRigGeo(roseVineRig(), 'rose_vine'), { material: this.mat });
    rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return rig;
  }

  /** the cast: start the spin and plant the roses */
  cast() {
    const ctx = this.ctx;
    const pl = this.player;
    const n = Math.round(ROSES.bullets * this.bulletMul);
    const a0 = Math.atan2(pl.aimPoint.x - pl.pos.x, pl.aimPoint.z - pl.pos.z);
    this.shots = [];
    for (let i = 0; i < n; i++) this.shots.push({ t: (i / n) * ROSES.storm, a: a0 + (i / n) * Math.PI * 3, aimed: i % 3 === 2 });
    this.stormT = 0;
    this.active = ROSES.storm;
    pl.playAction('twirl', 0.75);
    ctx.engine.tweens.after(0.75, () => pl.alive && pl.playAction('twirl', 0.75));
    pl.express('smug', 1.6);
    pl.cam.addTrauma(0.12);
    ctx.sfx('rev_spin', pl.pos, 0.9, 0.9);
    ctx.sfx('whoosh_big', pl.pos, 0.5, 1.2);
    // roses: the nearest prey that stands on the ground
    const cand = ctx.enemies.list.filter((e) => e.alive && !e.flying && e.pos.distanceTo(pl.pos) < ROSES.rootR);
    cand.sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos));
    const k = Math.min(6, ROSES.roses + this.extraRoses);
    cand.slice(0, k).forEach((e, i) => ctx.engine.tweens.after(0.08 + i * 0.07, () => this.plant(e)));
  }

  private plant(e: EnemyLike) {
    if (!e.alive) return;
    const ctx = this.ctx;
    const rig = this.rig();
    ctx.scene.add(rig.root);
    const sc = clamp((e.height || 1.6) / 1.25, 0.8, 2.2);
    this.roses.push({ rig, host: e, t: 0, life: ROSES.storm + 0.9, bloomed: false, sc, yaw: rnd.next() * Math.PI * 2 });
    const g = { x: e.pos.x, y: ctx.world.groundAt(e.pos.x, e.pos.z), z: e.pos.z };
    ctx.fx.sandBurst(g, 0.9);
    ctx.sfx('whoosh', g, 0.45, 0.7);
    ctx.enemies.damage(e, { base: 8, kind: 'phys', source: 'thorns', canCrit: false, tags: ['roses'], status: [{ id: 'stun', stacks: 1, dur: ROSES.root }, { id: 'bleed', stacks: 3, dur: 5 }] });
  }

  update(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    if (this.active > 0) {
      this.active -= dt;
      this.stormT += dt;
      pl.board.vel.multiplyScalar(Math.max(0, 1 - dt * 1.5)); // the spin plants him: commitment
      while (this.shots.length && this.shots[0].t <= this.stormT) this.fire(this.shots.shift()!);
    }
    for (let i = this.roses.length - 1; i >= 0; i--) {
      const r = this.roses[i];
      r.t += dt;
      const e = r.host;
      const n = r.rig.nodes;
      const grow = clamp(r.t / 0.32, 0, 1);
      const ease = 1 - Math.pow(1 - grow, 3);
      const root = r.rig.root;
      root.position.set(e.pos.x, ctx.world.groundAt(e.pos.x, e.pos.z) - 0.05, e.pos.z);
      root.rotation.y = r.yaw + r.t * 0.6;
      root.scale.set(r.sc * (0.6 + ease * 0.4), r.sc * Math.max(0.02, ease), r.sc * (0.6 + ease * 0.4));
      // the vine coils and sways (a lag down the chain), tighter while rooting
      const coil = 0.25 + Math.sin(r.t * 7) * 0.06;
      if (n['stem2']) n['stem2'].rotation.set(Math.sin(r.t * 3.1) * 0.12, coil, Math.sin(r.t * 2.3) * 0.18);
      if (n['stem3']) n['stem3'].rotation.set(Math.sin(r.t * 3.1 - 0.8) * 0.16, coil * 1.3, Math.sin(r.t * 2.3 - 0.8) * 0.22);
      const b = n['bloom'];
      const bud = r.bloomed ? 1.25 + Math.sin(Math.min(1, (r.t - r.life + 0.9) * 3) * Math.PI) * 0.25 : 0.45 + ease * 0.1;
      if (b) {
        b.scale.setScalar(bud);
        b.rotation.y = r.t * 1.4;
      }
      if (!r.bloomed && r.t >= ROSES.storm + 0.15) this.bloom(r);
      if (r.t >= r.life || (!e.alive && r.t > 0.4 && !r.bloomed && this.bloom(r))) {
        if (r.t >= r.life) {
          r.rig.root.removeFromParent();
          this.free.push(r.rig);
          this.roses.splice(i, 1);
        }
      }
    }
    if (this.rainT > 0) {
      this.rainT -= dt;
      if (Math.floor(this.rainT * 6) !== Math.floor((this.rainT + dt) * 6)) {
        ctx.enemies.inRadius(this.rainAt, 7, (e) => ctx.enemies.damage(e, { base: 7, kind: 'phys', source: 'thorns', canCrit: true, tags: ['roses'], status: [{ id: 'bleed', stacks: 1, dur: 3 }] }));
        ctx.particles.emit({ pos: { x: this.rainAt.x, y: this.rainAt.y + 5, z: this.rainAt.z }, count: 8, spread: 6, life: [0.5, 0.8], size: [0.07, 0.04], sprite: ['dot3'], color: [0x9e1428, 0xc8243a, 0x3f6f2a], gravity: 9, drag: 0.5 });
      }
    }
  }

  private fire(s: { a: number; aimed: boolean }) {
    const ctx = this.ctx;
    const pl = this.player;
    pl.center(_o);
    _o.y += 0.15;
    let a = s.a;
    if (s.aimed) {
      const e = ctx.enemies.nearest(pl.pos, ROSES.range);
      if (e) a = Math.atan2(e.pos.x - _o.x, e.pos.z - _o.z);
    }
    _d.set(Math.sin(a), -0.03, Math.cos(a)).normalize();
    const hit = ctx.enemies.raycast(_o, _d, ROSES.range);
    const len = hit?.t ?? ROSES.range;
    const end = _o.clone().addScaledVector(_d, len);
    ctx.fx.bulletTracer(_o.clone(), end, 0xffc8b0, false);
    if (hit?.enemy) ctx.enemies.damage(hit.enemy, { base: ROSES.bulletDmg, kind: 'phys', source: 'gun', canCrit: true, tags: ['roses'], status: [{ id: 'bleed', stacks: 1, dur: 4 }] }, end, _d.clone());
    if (rnd.chance(0.5)) ctx.sfx('rev_shot', pl.pos, 0.35, 1.05 + rnd.next() * 0.1);
  }

  /** the bloom: thorns burst from the rose (damage grows with the prey's bleeding) */
  private bloom(r: Rose) {
    if (r.bloomed) return false;
    r.bloomed = true;
    r.life = Math.max(r.life, r.t + 0.9);
    const ctx = this.ctx;
    const e = r.host;
    const p = new THREE.Vector3(e.pos.x, ctx.world.groundAt(e.pos.x, e.pos.z) + 1.1 * r.sc, e.pos.z);
    const bleed = (e as unknown as { status?: { stacks(id: string): number } }).status?.stacks('bleed') ?? 0;
    const dmg = (ROSES.bloomBase + bleed * ROSES.bloomPerBleed) * this.bloomMul;
    ctx.enemies.inRadius(p, ROSES.bloomR * r.sc, (o) => ctx.enemies.damage(o, { base: o === e ? dmg : dmg * 0.5, kind: 'magic', source: 'divine', canCrit: true, tags: ['roses', 'bloom'], knock: 5, status: [{ id: 'bleed', stacks: 2, dur: 4 }] }));
    ctx.particles.emit({ pos: p, count: 22, spread: 2.2, up: 3, life: [0.5, 0.9], size: [0.08, 0.04], sprite: ['dot3'], color: [0x9e1428, 0xc8243a, 0xe8586a, 0x3e0610], gravity: 5, drag: 1.4 });
    ctx.fx.sparkle(p, 0xff5a6a, 8, 0.8);
    ctx.sfx('poison_burst', p, 0.5, 1.4);
    ctx.events.emit('roseBloom', e, dmg);
    if (this.rain > 0) {
      this.rainT = Math.max(this.rainT, this.rain);
      this.rainAt.copy(this.player.pos);
    }
    return true;
  }

  clear() {
    for (const r of this.roses) r.rig.root.removeFromParent();
    this.roses.length = 0;
    this.active = 0;
    this.shots.length = 0;
  }
}
