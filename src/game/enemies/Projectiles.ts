// Bullet-hell projectile system: enemy bullets, venom globs, arrows, dung,
// needles, dynamite. Readable pixel sprites (no glow), grazing near-misses
// reward the player, melee parries reflect them back as player shots.
import * as THREE from 'three';
import { SpriteBatch } from '../fx/SpriteBatch';
import type { ProjKind } from './EnemyDefs';
import type { Ctx } from '../Ctx';
import type { StatusApply } from '../combat/Damage';
import { rnd } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';

export interface Proj {
  kind: ProjKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number;
  dmg: number;
  life: number;
  grav: number;
  status?: StatusApply[];
  owner: 'enemy' | 'player';
  grazed: boolean;
  spin: number;
  homing?: number;
  sourceId?: number;
  /** alpha thorny-lizard blood: bursts into an acid splash wherever it lands */
  acid?: boolean;
}

const LOOK: Record<ProjKind, { sprite: string; size: number; color: number; stretch: number; grav: number; trail?: number }> = {
  bullet: { sprite: 'bullet', size: 0.32, color: 0xffffff, stretch: 0.012, grav: 0 },
  venom: { sprite: 'ichor', size: 0.55, color: 0xffffff, stretch: 0, grav: 14, trail: 0x7fd03a },
  curse: { sprite: 'skull', size: 0.45, color: 0xd8b0ff, stretch: 0, grav: 0 },
  dung: { sprite: 'dung', size: 0.6, color: 0xffffff, stretch: 0, grav: 15, trail: 0x6a4a2a },
  arrow: { sprite: 'streak', size: 0.12, color: 0xd2b48c, stretch: 0.02, grav: 6 },
  sand: { sprite: 'pebble', size: 0.45, color: 0xffffff, stretch: 0, grav: 0, trail: 0xe0b77a },
  needle: { sprite: 'twig', size: 0.3, color: 0x9fd060, stretch: 0.01, grav: 0 },
  dynamite: { sprite: 'bullet', size: 0.5, color: 0xff6040, stretch: 0, grav: 16, trail: 0xffb233 },
  bone: { sprite: 'bone', size: 0.4, color: 0xffffff, stretch: 0, grav: 4 },
  blood: { sprite: 'dot4', size: 0.24, color: 0xa81414, stretch: 0.03, grav: 15, trail: 0x6e0a0a },
};
/** red pixel trail of a blood squirt (bright arterial + dark clot), acid blood adds sickly green */
const BLOOD_TRAIL = [0xc81e1e, 0x9a1010, 0x6e0a0a, 0xe03a2a];
const ACID_TRAIL = [0xb8f05c, 0x9dff3a, 0x9a1010, 0x6ec02a];

const _v = new THREE.Vector3();

export class Projectiles {
  list: Proj[] = [];
  batch = new SpriteBatch(2400);
  onDeflect?: (p: Proj) => void;
  /** an acid splash landed (the enemy manager may leave a small fizzing pool) */
  onAcid?: (x: number, y: number, z: number, dmg: number, sourceId: number) => void;

  constructor(private ctx: Ctx, private getPlayer: () => { center(out: THREE.Vector3): THREE.Vector3; takeHit: (h: any, from?: THREE.Vector3) => number; status: any; alive: boolean; pos: THREE.Vector3 }) {
    ctx.scene.add(this.batch.mesh);
  }

  /**
   * Straight-flying enemy shots (bullets, needles, pebbles, curses) are scaled by this:
   * the enemy manager eases it from ~0.8 on the first waves up to 1, so early shots are
   * easy to read and side-step. Arcing shots keep their solved trajectories.
   */
  speedMul = 1;

  spawn(p: Partial<Proj> & { kind: ProjKind; x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number }) {
    if (this.list.length > 2200) this.list.shift();
    const L = LOOK[p.kind];
    const q = { r: L.size * 0.45, life: 6, grav: L.grav, owner: 'enemy', grazed: false, spin: 0, ...p } as Proj;
    if (q.owner === 'enemy' && q.grav === 0 && this.speedMul !== 1) {
      q.vx *= this.speedMul;
      q.vy *= this.speedMul;
      q.vz *= this.speedMul;
      q.life /= this.speedMul;
    }
    this.list.push(q);
  }

  /** helper: fire pattern from a point toward a target */
  pattern(kind: 'burst' | 'fan' | 'ring' | 'spiral' | 'volley' | 'lob' | 'snipe' | 'stream', from: THREE.Vector3, target: THREE.Vector3, o: { count?: number; spread?: number; speed?: number; dmg: number; proj?: ProjKind; status?: StatusApply[]; phase?: number; delay?: number; sourceId?: number; acid?: boolean }) {
    const proj = o.proj ?? 'bullet';
    const speed = o.speed ?? 18;
    const dx = target.x - from.x, dz = target.z - from.z;
    const flat = Math.hypot(dx, dz) || 1;
    const base = Math.atan2(dx, dz);
    const dy = target.y - from.y;
    const n = o.count ?? 1;
    const mk = (ang: number, sp: number, vy: number, delay = 0) => {
      const fire = () => this.spawn({ kind: proj, x: from.x, y: from.y, z: from.z, vx: Math.sin(ang) * sp, vy, vz: Math.cos(ang) * sp, dmg: o.dmg, status: o.status, sourceId: o.sourceId, acid: o.acid });
      if (delay > 0) this.ctx.engine.tweens.after(delay, fire);
      else fire();
    };
    if (kind === 'burst') {
      for (let i = 0; i < n; i++) mk(base + (rnd.next() - 0.5) * 0.05, speed, (dy / flat) * speed, i * 0.12);
    } else if (kind === 'fan' || kind === 'volley') {
      const spread = o.spread ?? 0.6;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        if (kind === 'volley') {
          // arcing arrows: solve vy for flight time
          const T = flat / speed;
          mk(base + t * spread, speed, dy / T + 0.5 * LOOK[proj].grav * T, i * 0.05);
        } else mk(base + t * spread, speed, (dy / flat) * speed);
      }
    } else if (kind === 'ring') {
      const ph = o.phase ?? rnd.next();
      for (let i = 0; i < n; i++) mk(((i + ph) / n) * Math.PI * 2, speed, 0);
    } else if (kind === 'spiral') {
      for (let i = 0; i < n; i++) mk(base + i * 0.55, speed, 0, i * 0.06);
    } else if (kind === 'lob') {
      for (let i = 0; i < n; i++) {
        const lead = 0.6 + rnd.next() * 0.4;
        const tx = target.x + (rnd.next() - 0.5) * 3 * i, tz = target.z + (rnd.next() - 0.5) * 3 * i;
        const ddx = tx - from.x, ddz = tz - from.z;
        const d = Math.hypot(ddx, ddz) || 1;
        const T = Math.max(0.6, d / speed) * lead + 0.3;
        const g = LOOK[proj].grav;
        this.ctx.engine.tweens.after(i * 0.15, () =>
          this.spawn({ kind: proj, x: from.x, y: from.y, z: from.z, vx: ddx / T, vy: (target.y - from.y) / T + 0.5 * g * T, vz: ddz / T, dmg: o.dmg, status: o.status, life: T + 2, sourceId: o.sourceId, acid: o.acid })
        );
      }
    } else if (kind === 'stream') {
      // a continuous arcing squirt: drops in quick succession, slightly jittered, leading the target.
      // `spread` sweeps the squirt across the target (the head turning while it cries)
      const T = Math.max(0.35, flat / speed);
      const g = LOOK[proj].grav;
      const sweep = o.spread ?? 0;
      const d0 = o.delay ?? 0;
      for (let i = 0; i < n; i++) {
        const j = (rnd.next() - 0.5) * 0.08 + (n > 1 ? (i / (n - 1) - 0.5) * sweep : 0);
        const sp = speed * (0.94 + rnd.next() * 0.12);
        this.ctx.engine.tweens.after(d0 + i * 0.045, () =>
          this.spawn({ kind: proj, x: from.x, y: from.y, z: from.z, vx: Math.sin(base + j) * sp, vy: dy / T + 0.5 * g * T * (0.92 + rnd.next() * 0.16), vz: Math.cos(base + j) * sp, dmg: o.dmg, status: o.status, sourceId: o.sourceId, life: T + 2, acid: o.acid })
        );
      }
    } else if (kind === 'snipe') {
      const d3 = Math.hypot(dx, dy, dz) || 1;
      this.spawn({ kind: proj, x: from.x, y: from.y, z: from.z, vx: (dx / d3) * speed, vy: (dy / d3) * speed, vz: (dz / d3) * speed, dmg: o.dmg, r: 0.25, sourceId: o.sourceId });
    }
  }

  /** reflect enemy projectiles near p (melee parry). Returns count */
  deflect(p: THREE.Vector3, radius: number, dirX: number, dirZ: number) {
    let n = 0;
    for (const q of this.list) {
      if (q.owner !== 'enemy') continue;
      if (Math.hypot(q.x - p.x, q.y - p.y - 1, q.z - p.z) > radius) continue;
      const sp = Math.hypot(q.vx, q.vy, q.vz) * 1.4 + 8;
      q.vx = dirX * sp;
      q.vz = dirZ * sp;
      q.vy = Math.max(0, q.vy * 0.2);
      q.owner = 'player';
      q.dmg *= 2.5;
      q.life = 3;
      n++;
      this.onDeflect?.(q);
    }
    return n;
  }

  update(dt: number) {
    const ctx = this.ctx;
    const pl = this.getPlayer();
    const pc = pl.center(_v.clone());
    const field = ctx.world.field;
    const colRes = { t: -1, c: null as any, nx: 0, nz: 0 };
    this.batch.begin();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      q.life -= dt;
      q.vy -= q.grav * dt;
      if (q.homing && q.owner === 'enemy') {
        const hx = pc.x - q.x, hz = pc.z - q.z;
        const hl = Math.hypot(hx, hz) || 1;
        const sp = Math.hypot(q.vx, q.vz);
        q.vx += ((hx / hl) * sp - q.vx) * q.homing * dt;
        q.vz += ((hz / hl) * sp - q.vz) * q.homing * dt;
      }
      const nx = q.x + q.vx * dt, ny = q.y + q.vy * dt, nz = q.z + q.vz * dt;
      let dead = q.life <= 0;
      // terrain
      const g = Math.max(field.heightAt(nx, nz), ctx.world.sa.waterLevel);
      if (ny < g) {
        dead = true;
        this.impact(q, nx, g, nz);
      }
      // props
      if (!dead) {
        const sdx = nx - q.x, sdy = ny - q.y, sdz = nz - q.z;
        const L = Math.hypot(sdx, sdy, sdz);
        if (L > 1e-5) {
          ctx.world.colliders.raycast(q.x, q.y, q.z, sdx / L, sdy / L, sdz / L, L, colRes);
          if (colRes.t >= 0) {
            dead = true;
            this.impact(q, q.x + (sdx / L) * colRes.t, q.y + (sdy / L) * colRes.t, q.z + (sdz / L) * colRes.t);
          }
        }
      }
      q.x = nx;
      q.y = ny;
      q.z = nz;
      q.spin += dt * 10;
      if (!dead && q.owner === 'enemy' && pl.alive) {
        const dx = q.x - pc.x, dz = q.z - pc.z;
        const dy = q.y - pc.y;
        const dh = Math.hypot(dx, dz);
        if (dh < q.r + 0.42 && Math.abs(dy) < 1.0 + q.r) {
          const dealt = pl.takeHit({ base: q.dmg, kind: q.kind === 'curse' || q.kind === 'venom' ? 'magic' : 'phys', source: 'projectile', status: q.status, knock: q.kind === 'dynamite' ? 8 : 1.5 }, new THREE.Vector3(q.x - q.vx * 0.05, q.y, q.z - q.vz * 0.05));
          if (dealt > 0 && q.status) for (const s of q.status) pl.status.apply(s.id, s.stacks, s.dur, 2, 30, {});
          dead = true;
          this.impact(q, q.x, q.y, q.z, true);
        } else if (!q.grazed && dh < q.r + 1.4 && Math.abs(dy) < 1.6) {
          q.grazed = true;
          ctx.events.emit('graze', q);
        }
      } else if (!dead && q.owner === 'player') {
        // reflected shots hit enemies
        ctx.enemies.inRadius(_v.set(q.x, q.y, q.z), 1.2, (e) => {
          if (dead) return;
          ctx.enemies.damage(e, { base: q.dmg, kind: 'phys', source: 'counter', canCrit: true, knock: 4, dirX: q.vx, dirZ: q.vz }, _v.clone(), new THREE.Vector3(q.vx, q.vy, q.vz).normalize());
          dead = true;
        });
      }
      if (dead) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      const L = LOOK[q.kind];
      const col = q.owner === 'player' ? 0x9dff3a : L.color;
      this.batch.push(q.x, q.y, q.z, L.sprite, L.size, L.size, q.kind === 'dynamite' || q.kind === 'dung' || q.kind === 'bone' ? q.spin : 0, col, 1, { x: q.vx, y: q.vy, z: q.vz }, L.stretch);
      if (q.kind === 'blood') {
        // a red pixel trail that drips: every drop sheds droplets, some fall away as they cool
        if (rnd.chance(0.85)) ctx.particles.emit({ pos: { x: q.x, y: q.y, z: q.z }, count: 1, vel: { x: q.vx * 0.12, y: q.vy * 0.1, z: q.vz * 0.12 }, life: [0.25, 0.55], size: [0.1, 0.035], sprite: ['dot3', 'dot4', 'blood0'], color: q.acid ? ACID_TRAIL : BLOOD_TRAIL, gravity: 7, drag: 1.6, jitter: 0.03 });
        if (rnd.chance(0.12)) ctx.particles.emit({ pos: { x: q.x, y: q.y, z: q.z }, count: 1, vel: { x: q.vx * 0.3, y: 0, z: q.vz * 0.3 }, life: [0.5, 0.8], size: [0.05, 0.05], sprite: 'dot3', color: q.acid ? 0x9dff3a : 0x7e1410, gravity: 16, ground: true });
      } else if (L.trail && rnd.chance(0.5)) ctx.particles.emit({ pos: { x: q.x, y: q.y, z: q.z }, count: 1, life: [0.2, 0.4], size: [0.12, 0.04], sprite: q.kind === 'dynamite' ? 'spark' : 'dot3', color: L.trail, additive: q.kind === 'dynamite', drag: 2 });
    }
    this.batch.end(ctx.world.env.fog);
  }

  private impact(q: Proj, x: number, y: number, z: number, onPlayer = false) {
    const ctx = this.ctx;
    const pos = { x, y, z };
    switch (q.kind) {
      case 'venom':
        ctx.fx.hit(pos, { x: 0, y: 1, z: 0 }, 'poison', 0.8);
        ctx.events.emit('groundMark', x, z, 1.1, 3);
        ctx.sfx('poison_hit', pos, 0.5);
        break;
      case 'dung':
        ctx.particles.emit({ pos, count: 10, spread: 3, up: 3, life: [0.4, 0.8], size: [0.1, 0.06], sprite: 'pebble', color: [0x6a4a2a, 0x8a5a32, 0x4a3018], gravity: 14, ground: true });
        ctx.fx.dust(pos, 0.6, 0x8a6a3a, 2);
        ctx.sfx('scarab_squish', pos, 0.6);
        break;
      case 'dynamite': {
        ctx.fx.explosion(pos, 3.2);
        ctx.sfx('explosion', pos, 1);
        ctx.events.emit('explosion', pos, 3.2, q.dmg, 'enemy');
        break;
      }
      case 'bullet':
      case 'arrow':
      case 'needle':
      case 'bone':
        if (!onPlayer) ctx.fx.hit(pos, { x: -q.vx * 0.05, y: 0.6, z: -q.vz * 0.05 }, 'sand', 0.5);
        else ctx.fx.hit(pos, { x: -q.vx * 0.05, y: 0.4, z: -q.vz * 0.05 }, 'bone', 0.6);
        break;
      case 'blood':
        ctx.events.emit('groundMark', x, z, onPlayer ? 0.35 : 0.55, 2);
        ctx.particles.emit({ pos, count: 6, spread: 1.4, up: 1.6, life: [0.3, 0.6], size: [0.07, 0.04], sprite: ['dot3', 'dot4'], color: [0x9a1010, 0x6e0a0a, 0xc02020], gravity: 14, ground: true });
        if (rnd.chance(0.3)) ctx.sfx('gore_splat', pos, 0.25, 1.3);
        break;
      default:
        ctx.fx.hit(pos, { x: 0, y: 1, z: 0 }, 'sand', 0.5);
    }
    if (q.acid) this.acidSplash(x, y, z, q.dmg, onPlayer, q.sourceId ?? 0);
    void P;
  }

  /** acid: a fizzing green splash that scalds whoever stands close (alpha thorny devils / bell snakes) */
  acidSplash(x: number, y: number, z: number, dmg: number, onPlayer = false, sourceId = 0) {
    const ctx = this.ctx;
    const pos = { x, y: y + 0.05, z };
    ctx.particles.emit({ pos, count: 9, spread: 2.2, up: 2.4, life: [0.35, 0.7], size: [0.09, 0.04], sprite: ['ichor', 'dot3', 'bubble'], color: [0xffffff, 0xc8ff5a, 0x9dff3a], gravity: 13, ground: true });
    ctx.particles.emit({ pos, count: 1, life: [0.16, 0.2], size: [0.5, 0.8], sprite: 'venomSplat', color: 0xffffff, additive: true, rot: 6.28 });
    ctx.particles.emit({ pos, count: 2, spread: 0.3, up: 0.6, life: [0.6, 1.1], size: [0.2, 0.5], sprite: ['puff0', 'puff1'], color: [0x9dcf4a, 0x7fae3a], alpha: 0.45, drag: 2, rot: 6, rotSpeed: 0.6 });
    ctx.events.emit('groundMark', x, z, 0.75, 3);
    if (rnd.chance(0.35)) ctx.sfx('poison_hit', pos, 0.35, 1.2);
    const pl = this.getPlayer();
    if (!onPlayer && pl.alive && Math.hypot(pl.pos.x - x, pl.pos.z - z) < 1.3 && Math.abs(pl.pos.y - y) < 1.5)
      pl.takeHit({ base: dmg * 0.6, kind: 'magic', source: 'projectile', status: [{ id: 'poison', stacks: 1, dur: 3 }] }, new THREE.Vector3(x, y, z));
    this.onAcid?.(x, y, z, dmg, sourceId);
  }

  clear() {
    this.list.length = 0;
  }
}
