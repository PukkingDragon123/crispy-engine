// Gold coins, health bandages, boost: physics pop-out, magnet pull, satisfying
// pitch-climbing pickup sounds. Bounty (XP) is no longer a pickup: a kill pays
// it straight onto the bounty meter with a small gold number over the body.
import * as THREE from 'three';
import { SpriteBatch } from '../fx/SpriteBatch';
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
}

const LOOK: Record<PickupKind, { sprite: string; size: number }> = {
  bounty: { sprite: 'chip', size: 0.34 },
  bountyBig: { sprite: 'chip_x2', size: 0.6 },
  gold: { sprite: 'coinspin0', size: 0.3 },
  heart: { sprite: 'bandage_x2', size: 0.55 },
  boost: { sprite: 'bolt', size: 0.4 },
};

export class Pickups {
  list: Pickup[] = [];
  batch = new SpriteBatch(1600);
  private pitchStep = 0;
  private pitchTimer = 0;
  onCollect?: (k: PickupKind, v: number, at: THREE.Vector3) => void;
  /** bounty awarded straight to the meter (wire to RunScene.addBounty); falls back to onCollect('bounty') */
  onBounty?: (v: number, at: THREE.Vector3) => void;
  private bountyPitch = 0;
  private bountyPitchT = 0;
  private hidden = new THREE.Vector3();

  constructor(private ctx: Ctx, private getPlayer: () => { pos: THREE.Vector3; stats: { get(s: string): number }; alive: boolean }) {
    ctx.scene.add(this.batch.mesh);
  }

  drop(kind: PickupKind, value: number, at: { x: number; y: number; z: number }, n = 1) {
    if (kind === 'bounty' || kind === 'bountyBig') {
      this.dropBounty(value * n, at);
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2;
      const s = 1.5 + rnd.next() * 3;
      this.list.push({ kind, value, pos: new THREE.Vector3(at.x, at.y + 0.6, at.z), vel: new THREE.Vector3(Math.cos(a) * s, 4 + rnd.next() * 4, Math.sin(a) * s), t: 0, magnet: false, spin: rnd.next() * 6 });
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

  update(dt: number) {
    const pl = this.getPlayer();
    const range = pl.stats.get('pickupRange');
    const ppos = pl.pos;
    const ctx = this.ctx;
    this.pitchTimer -= dt;
    if (this.pitchTimer <= 0) this.pitchStep = 0;
    this.bountyPitchT -= dt;
    this.batch.begin();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.spin += dt * 5;
      const dx = ppos.x - p.pos.x, dy = ppos.y + 1 - p.pos.y, dz = ppos.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (pl.alive && (d < range || p.magnet) && p.t > 0.35) p.magnet = true;
      if (p.magnet && pl.alive) {
        const sp = 16 + p.t * 12;
        p.vel.set((dx / d) * sp, (dy / d) * sp, (dz / d) * sp);
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
      const L = LOOK[p.kind];
      const bob = p.magnet ? 0 : Math.sin(p.t * 3 + p.spin) * 0.06;
      const sprite = p.kind === 'gold' ? 'coinspin' + (Math.floor(p.spin) % 4) : L.sprite;
      this.batch.push(p.pos.x, p.pos.y + bob, p.pos.z, sprite, L.size, L.size, 0);
    }
    this.batch.end(ctx.world.env.fog);
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
  }

  clear() {
    this.list.length = 0;
  }
}
