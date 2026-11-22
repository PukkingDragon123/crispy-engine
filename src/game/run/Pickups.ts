// Coins are the only drop: full 3D voxel gold coins (CoinRender) that pop out, bounce,
// stand spinning on edge with a gleam, then swoop to the hunter on a magnet arc with
// pitch-climbing chimes. Health and boost drops became coins too: one coin of the
// bundle carries the heal (or the boost) and pays it when it is collected. Bounty (XP)
// is no pickup: a kill pays it straight onto the bounty meter.
import * as THREE from 'three';
import { CoinRender } from '../fx/Coins3D';
import type { Ctx } from '../Ctx';
import { rnd } from '../../engine/math/rand';

export type PickupKind = 'bounty' | 'bountyBig' | 'gold' | 'heart' | 'boost';

interface Pickup {
  kind: PickupKind;
  value: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  magnet: boolean;
  spin: number;
  /** a heal / boost riding on this coin, paid out on collection */
  carry?: { kind: PickupKind; value: number };
  /** seconds since the magnet caught it */
  pull: number;
}

export class Pickups {
  list: Pickup[] = [];
  private coins: CoinRender;
  private pitchStep = 0;
  private pitchTimer = 0;
  onCollect?: (k: PickupKind, v: number, at: THREE.Vector3) => void;
  /** bounty awarded straight to the meter (wire to RunScene.addBounty); falls back to onCollect('bounty') */
  onBounty?: (v: number, at: THREE.Vector3) => void;
  private bountyPitch = 0;
  private bountyPitchT = 0;
  private hidden = new THREE.Vector3();

  constructor(private ctx: Ctx, private getPlayer: () => { pos: THREE.Vector3; stats: { get(s: string): number }; alive: boolean }) {
    this.coins = CoinRender.of(ctx.particles);
  }

  drop(kind: PickupKind, value: number, at: { x: number; y: number; z: number }, n = 1) {
    if (kind === 'bounty' || kind === 'bountyBig') {
      this.dropBounty(value * n, at);
      return;
    }
    // health and boost come as a small bundle of coins; the first carries the effect
    let carry: Pickup['carry'];
    if (kind === 'heart' || kind === 'boost') {
      carry = { kind, value };
      n = kind === 'heart' ? 3 : 2;
      kind = 'gold';
      value = 1;
    }
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2;
      const s = 1.5 + rnd.next() * 3;
      this.list.push({ kind, value, pos: new THREE.Vector3(at.x, at.y + 0.6, at.z), vel: new THREE.Vector3(Math.cos(a) * s, 4 + rnd.next() * 4, Math.sin(a) * s), t: 0, magnet: false, spin: rnd.next() * 6, carry: i === 0 ? carry : undefined, pull: 0 });
    }
    if (this.list.length > 900) this.list.splice(0, this.list.length - 900);
  }

  /**
   * Pay a bounty straight onto the meter: a small gold number rises from the
   * body with a couple of glints and a soft chip click (pitch climbs on
   * multi-kills). Nothing to collect.
   */
  dropBounty(total: number, at: { x: number; y: number; z: number }) {
    if (!(total > 0)) return;
    const ctx = this.ctx;
    const p = new THREE.Vector3(at.x, at.y + 1.15, at.z);
    const big = total >= 20;
    ctx.fx.number(p, '+' + Math.max(1, Math.round(total)), big ? 0xffc94a : 0xf0b43c, big ? 0.82 : 0.6, 0.85);
    ctx.particles.emit({ pos: p, count: big ? 4 : 2, spread: 0.7, up: 0.8, life: [0.25, 0.55], size: [0.1, 0.02], sprite: 'star4', additive: true, color: [0xffd36b, 0xf5c84a, 0xfff2c0], jitter: 0.2 });
    this.bountyPitch = this.bountyPitchT > 0 ? Math.min(this.bountyPitch + 1, 12) : 0;
    this.bountyPitchT = 0.7;
    ctx.sfx('pickup_bounty', null, big ? 0.22 : 0.14, 1 + this.bountyPitch * 0.03);
    if (this.onBounty) this.onBounty(total, p);
    else {
      // legacy wiring: onCollect('bounty') also flies a HUD chip from `at`, so hand it an
      // anchor behind the camera (the HUD skips off-screen anchors) and only the meter fills
      const cam = ctx.camera;
      cam.getWorldDirection(this.hidden).multiplyScalar(-6).add(cam.position);
      this.onCollect?.('bounty', total, this.hidden);
    }
  }

  /** pull every pickup to the player (end of wave vacuum) */
  vacuum() {
    for (const p of this.list) p.magnet = true;
  }
  /** a visual-only shower of real coins (boss hoards): Fx.coins routes here too */
  shower(at: { x: number; y: number; z: number }, n: number) {
    this.coins.burst(at, n);
  }

  update(dt: number) {
    const pl = this.getPlayer();
    const range = pl.stats.get('pickupRange');
    const ppos = pl.pos;
    const ctx = this.ctx;
    this.pitchTimer -= dt;
    if (this.pitchTimer <= 0) this.pitchStep = 0;
    this.bountyPitchT -= dt;
    const C = this.coins;
    C.begin();
    const cam = ctx.camera;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.spin += dt * (p.magnet ? 14 : 3.2);
      const dx = ppos.x - p.pos.x, dy = ppos.y + 1 - p.pos.y, dz = ppos.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (pl.alive && (d < range || p.magnet) && p.t > 0.35) p.magnet = true;
      if (p.magnet && pl.alive) {
        // magnet: a quick hop up, then an accelerating swoop that curls in to the hunter
        p.pull += dt;
        const sp = 9 + p.pull * 34;
        const k = Math.min(1, dt * (5 + p.pull * 10));
        const lift = Math.max(0, 0.35 - p.pull) * 14;
        p.vel.x += ((dx / d) * sp - dz / d * sp * 0.25 - p.vel.x) * k;
        p.vel.y += ((dy / d) * sp + lift - p.vel.y) * k;
        p.vel.z += ((dz / d) * sp + dx / d * sp * 0.25 - p.vel.z) * k;
        p.pos.addScaledVector(p.vel, dt);
        if (d < 0.9) {
          this.collect(p);
          this.list[i] = this.list[this.list.length - 1];
          this.list.pop();
          continue;
        }
      } else {
        p.vel.y -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const g = ctx.world.groundAt(p.pos.x, p.pos.z) + 0.25;
        if (p.pos.y < g) {
          p.pos.y = g;
          p.vel.y = Math.abs(p.vel.y) > 2 ? -p.vel.y * 0.35 : 0;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        }
        if (p.t > 60) {
          this.list.splice(i, 1);
          continue;
        }
      }
      const bob = p.magnet ? 0 : Math.sin(p.t * 2.6 + p.spin * 0.2) * 0.07 + 0.08;
      // gleam: a flash when a face swings square to the camera, plus the odd rim glint
      const yaw = Math.atan2(cam.position.x - p.pos.x, cam.position.z - p.pos.z);
      const face = Math.abs(Math.cos(p.spin - yaw));
      const gleam = Math.pow(face, 24);
      C.push(p.pos.x, p.pos.y + bob, p.pos.z, p.spin, p.carry ? 1.18 : 1, gleam + (p.carry ? 0.35 : 0));
      if (gleam > 0.8 && !p.magnet && rnd.chance(dt * 6)) C.glint(p.pos.x + (rnd.next() - 0.5) * 0.2, p.pos.y + bob + 0.12, p.pos.z, 0.8);
    }
    C.end();
  }

  private collect(p: Pickup) {
    const ctx = this.ctx;
    this.pitchStep = Math.min(this.pitchStep + 1, 16);
    this.pitchTimer = 0.6;
    const pitch = 1 + this.pitchStep * 0.035;
    switch (p.kind) {
      case 'bounty':
      case 'bountyBig':
        ctx.sfx('pickup_bounty', null, p.kind === 'bountyBig' ? 0.55 : 0.32, pitch);
        break;
      case 'gold':
        ctx.sfx('pickup_gold', null, 0.4, pitch);
        break;
      case 'heart':
        ctx.sfx('bandage', null, 0.7);
        break;
      case 'boost':
        ctx.sfx('ult_ready', null, 0.4, 1.4);
        break;
    }
    this.onCollect?.(p.kind, p.value, p.pos);
    if (p.carry) {
      if (p.carry.kind === 'heart') ctx.sfx('bandage', null, 0.55);
      else ctx.sfx('ult_ready', null, 0.35, 1.4);
      this.onCollect?.(p.carry.kind, p.carry.value, p.pos);
    }
    this.coins.glint(p.pos.x, p.pos.y + 0.2, p.pos.z, 1.1);
  }

  clear() {
    this.list.length = 0;
  }
}
