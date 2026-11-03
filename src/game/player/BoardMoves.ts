// Board moves glue (lives beside player/Board): the feel and the reward layer of
// push-to-ride.
//  - kick-push feedback: a footfall per stroke, a PERFECT PUSH pops (sand burst,
//    star glints, a rising tick that climbs with the streak, an FOV pop), a
//    LANDING PUSH booms
//  - drift: a rooster tail of sand flung off the sliding rail, charge glints,
//    and the BOARD SLASH (drift through an enemy: the swinging tail cuts it)
//  - spin launch / sand kick / wall ride / manual / dune surf effects
//  - the STYLE COMBO: every move is a link, links raise the multiplier, the chain
//    stays open while you are mid-move and banks (pool x multiplier) as a 'trick'
//    event when it lapses; a bail or a hit loses it. A small Alagard style meter
//    floats beside the rider while a chain is open.
//  - permanent move unlocks (player/Techniques MOVE_UNLOCKS) from the run's own
//    'rankUp' / 'bossDefeated' events and banked combos
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Board, LandingInfo, PushGrade } from './Board';
import { FloatText3D } from '../fx/FloatText3D';
import { isUnlocked, unlock, technique, MOVE_UNLOCKS, TechniqueId } from './Techniques';
import { P } from '../../engine/voxel/palette';

export const CHAIN = {
  /** seconds a combo stays open after its last link (paused while mid-move) */
  window: 2.6,
  /** multiplier gained per whole link */
  step: 0.25,
  maxMult: 4,
};

/** what the moves layer needs from the player */
export interface MovesHost {
  board: Board;
  alive: boolean;
  cam: { punch(pitch: number, yaw?: number, fov?: number, roll?: number): void; addTrauma?(t: number): void };
  express(name: string, dur?: number): void;
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();

export class BoardMoves {
  private b: Board;
  private clock = 0;
  // style chain
  private weight = 0;
  private pool = 0;
  private awarded = 0;
  private timer = 0;
  private names: string[] = [];
  private seenLand = 0;
  // drift
  private slashCd = new Map<number, number>();
  private slashes = 0;
  private wasDrifting = false;
  private chargeTier = 0;
  private sprayCd = 0;
  private surfT = 0;
  private wallFx = 0;
  // the little style meter
  private big: FloatText3D | null = null;
  private small: FloatText3D | null = null;
  private key = '';
  private pulse = 0;

  constructor(private ctx: Ctx, private host: MovesHost) {
    const b = (this.b = host.board);
    this.seenLand = b.landSeq;
    this.refreshUnlocks();
    b.onPush = (g, pow, streak) => this.onPush(g, pow, streak);
    b.onSpinLaunch = (half) => this.onSpinLaunch(half);
    b.onSandKick = () => this.onSandKick();
    b.onWallRide = (on, kicked, t) => this.onWallRide(on, kicked, t);
    b.onManual = (on, how, t) => this.onManual(on, how, t);
    // run milestones teach moves for good
    ctx.events.on('rankUp', (rank: number) => {
      if (rank >= MOVE_UNLOCKS.sand_kick.rank) this.learn('sand_kick');
      if (rank >= MOVE_UNLOCKS.manual.rank) this.learn('manual');
    });
    ctx.events.on('bossDefeated', (_boss: unknown, escaped: boolean) => {
      if (!escaped) this.learn('wall_ride');
    });
    ctx.events.on('driftBoost', (p: number) => this.onDriftRelease(p));
    ctx.events.on('playerHurt', () => this.lose());
  }

  /** copy the permanent unlocks onto the board */
  refreshUnlocks() {
    const m = this.b.moves;
    m.sandKick = isUnlocked('sand_kick');
    m.wallRide = isUnlocked('wall_ride');
    m.manual = isUnlocked('manual');
    m.duneSurf = isUnlocked('dune_surf');
  }

  private learn(id: TechniqueId) {
    if (!unlock(id)) return;
    this.refreshUnlocks();
    const t = technique(id);
    this.ctx.engine.tweens.after(1.2, () => {
      this.ctx.toast('MOVE LEARNED · ' + t.name.toUpperCase(), '#ffd36b', t.how, true);
      this.ctx.sfx('qte_perfect', null, 0.75);
      this.host.express('smug', 1.4);
    }, true);
  }

  get mult() {
    return Math.min(CHAIN.maxMult, 1 + CHAIN.step * Math.floor(this.weight));
  }

  // ------------------------------------------------------------------ chain
  /** add a link: name shown on the meter, style points, link weight; merge = replace a same-kind last link */
  link(name: string, pts: number, weight = 1, merge?: string) {
    if (!this.host.alive) return;
    this.weight += weight;
    this.pool += Math.round(pts);
    this.timer = CHAIN.window;
    if (merge && this.names.length && this.names[this.names.length - 1].startsWith(merge)) this.names[this.names.length - 1] = name;
    else this.names.push(name);
    if (this.names.length > 6) this.names.shift();
    this.pulse = 1;
  }

  /** the chain lapsed: bank it as one 'trick' (RunScene toasts it and adds the style) */
  private bank() {
    const m = this.mult;
    const bonus = Math.round(this.pool * m) - this.awarded;
    if (this.weight >= 2 && bonus > 0) {
      const l: LandingInfo = { airTime: 0, spins: 0, flips: 0, clean: true, impact: 0, transition: 0, trickName: `STYLE COMBO x${fmt(m)}`, score: bonus, grab: false, quality: 'clean' };
      this.ctx.events.emit('trick', l);
      if (m >= 3) this.ctx.sfx('sting_positive', null, 0.45);
      if (m >= MOVE_UNLOCKS.dune_surf.combo) this.learn('dune_surf');
    }
    this.reset();
  }

  /** bail / hit: the chain is gone */
  lose() {
    if (this.weight >= 2) this.ctx.toast('COMBO LOST', '#ff7a5a');
    this.reset();
  }

  private reset() {
    this.weight = this.pool = this.awarded = 0;
    this.timer = 0;
    this.names.length = 0;
  }

  // ------------------------------------------------------------------ events
  private footPoint(out: THREE.Vector3) {
    const b = this.b, f = b.forward;
    // the push foot plants on the toe side, just behind the front foot
    return out.set(b.pos.x + f.x * 0.05 - Math.cos(b.heading) * 0.34, b.pos.y + 0.04, b.pos.z + f.z * 0.05 + Math.sin(b.heading) * 0.34);
  }

  private onPush(g: PushGrade, pow: number, streak: number) {
    const ctx = this.ctx;
    // the footfall lands with the plant, a beat after the press
    ctx.engine.tweens.after(0.1, () => {
      if (!this.b.grounded) return;
      const at = this.footPoint(_v);
      const f = this.b.forward;
      ctx.sfx('footstep_sand', at, g === 'rushed' ? 0.35 : 0.6, g === 'rushed' ? 0.85 : 1);
      ctx.fx.sandSpray(at, { x: -f.x * 2.2, y: 0.6, z: -f.z * 2.2 }, g === 'rushed' ? 0.4 : 0.8 + pow * 0.3);
      if (g === 'perfect' || g === 'landing') {
        ctx.fx.sandBurst(at, g === 'landing' ? 0.75 : 0.32 + streak * 0.06);
        ctx.particles.emit({ pos: { x: at.x, y: at.y + 0.25, z: at.z }, count: 3 + streak * 2, spread: 1.4, up: 1.8, life: [0.25, 0.5], size: [0.12, 0.02], sprite: ['star4', 'spark'], additive: true, color: [0xffe39a, 0xfff6d0], jitter: 0.2 });
        // the tick climbs with the streak: push, push, PUSH
        ctx.sfx('qte_good', null, g === 'landing' ? 0.4 : 0.22, g === 'landing' ? 1.1 : 1.3 + streak * 0.09);
        if (g === 'landing') ctx.sfx('whoosh_big', at, 0.45, 1.25);
        this.host.cam.punch(0, 0, g === 'landing' ? 1.8 : 0.5 + streak * 0.22);
      }
    });
    if (g === 'landing') this.link('LANDING PUSH', 80, 1);
    else if (g === 'perfect' && streak >= 2) this.link(`PERFECT PUSH x${streak}`, 20 * streak, 0.5, 'PERFECT PUSH');
  }

  private onSpinLaunch(half: number) {
    const b = this.b, ctx = this.ctx;
    ctx.fx.sandBurst(b.pos, 0.9 + half * 0.25);
    ctx.sfx('whoosh_big', b.pos, 0.6, 1.1);
    ctx.sfx('trick_spin', null, 0.5, 1.1);
    this.host.cam.punch(-0.01, 0, 1.4);
  }

  private onSandKick() {
    const b = this.b, ctx = this.ctx;
    const at = { x: b.pos.x, y: b.pos.y - 0.15, z: b.pos.z };
    // a stamp of sand out of thin air: grains blasted down and out, a puff ring
    ctx.particles.emit({ pos: at, count: 26, spread: 3.2, up: -2.5, life: [0.45, 0.9], size: [0.06, 0.04], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [P.sand1, P.sand0, P.sand2], gravity: 12, drag: 1.2, ground: true, bounce: 0.1 });
    ctx.particles.emit({ pos: at, count: 7, spread: 2.4, up: -0.6, life: [0.5, 1.0], size: [0.4, 1.3], sprite: ['puff0', 'puff1', 'puff2', 'cloud0'], color: [P.sand0, P.sand1], alpha: 0.8, drag: 3, rot: 6, rotSpeed: 1 });
    ctx.sfx('sand_burst', at, 0.6, 1.2);
    ctx.sfx('board_jump', at, 0.7, 1.2);
    this.link('SAND KICK', 50, 0.5);
  }

  private onWallRide(on: boolean, kicked: boolean, t: number) {
    const b = this.b, ctx = this.ctx;
    if (on) {
      ctx.sfx('board_land', b.pos, 0.55, 1.15);
      ctx.sfx('sand_spray', b.pos, 0.6, 1.1);
      ctx.fx.hit({ x: b.pos.x - b.wall.nx * 0.4, y: b.pos.y + 0.3, z: b.pos.z - b.wall.nz * 0.4 }, { x: b.wall.nx, y: 0.3, z: b.wall.nz }, 'rock', 1);
      this.host.express('determined', 0.8);
      return;
    }
    if (t > 0.15) this.link('WALL RIDE', 80 + t * 100, 1);
    if (kicked) {
      ctx.sfx('kick', b.pos, 0.6, 1.1);
      ctx.sfx('whoosh', b.pos, 0.6, 1.1);
      ctx.fx.hit({ x: b.pos.x - b.wall.nx * 0.5, y: b.pos.y + 0.2, z: b.pos.z - b.wall.nz * 0.5 }, { x: b.wall.nx, y: 0.2, z: b.wall.nz }, 'rock', 1.3);
      this.link('WALL KICK', 60, 0.5);
    }
  }

  private onManual(on: boolean, how: string, t: number) {
    const b = this.b, ctx = this.ctx;
    if (on) {
      ctx.sfx('board_land', b.pos, 0.35, 1.3);
      return;
    }
    if (how === 'scrub') {
      ctx.sfx('board_land', b.pos, 0.6, 0.9);
      ctx.fx.sandBurst(b.pos, 0.5);
      return;
    }
    if (t > 0.4) this.link(`MANUAL ${t.toFixed(1)}s`, 60 * t, Math.min(3, 1 + t * 0.4));
  }

  private onDriftRelease(p: number) {
    this.ctx.sfx('sand_spray', this.b.pos, 0.4 + p * 0.4, 1.25);
    if (p > 0.15) this.link('DRIFT', 50 + 150 * p, 1);
  }

  private onLand(l: LandingInfo) {
    if (l.quality === 'bail') {
      this.lose();
      return;
    }
    if (l.score > 0 && l.quality !== 'sketchy') {
      // the trick already scored on its own; the bank multiplies it again
      this.awarded += l.score;
      this.link(l.trickName.replace('PERFECT ', '') || 'AIR', l.score, 1 + (l.spins >= 2 ? 0.5 : 0) + l.flips * 0.5);
    } else if (l.quality === 'perfect') this.link('STOMPED', 30, 0.5);
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const b = this.b, ctx = this.ctx;
    this.clock += dt;
    if (b.landSeq !== this.seenLand) {
      this.seenLand = b.landSeq;
      if (b.lastLand) this.onLand(b.lastLand);
    }
    this.driftFx(dt);
    this.slash();
    // wall ride: sand ground off the face
    if (b.wall.on) {
      this.wallFx -= dt;
      if (this.wallFx <= 0) {
        this.wallFx = 0.05;
        ctx.fx.sandSpray({ x: b.pos.x - b.wall.nx * 0.3, y: b.pos.y + 0.1, z: b.pos.z - b.wall.nz * 0.3 }, { x: b.wall.nx * 2 - b.vel.x * 0.2, y: -1, z: b.wall.nz * 2 - b.vel.z * 0.2 }, 0.9, P.sand2);
      }
    }
    // dune surf: a link per second on the face
    if (b.surfing) {
      this.surfT += dt;
      if (this.surfT >= 1) {
        this.surfT -= 1;
        this.link('DUNE SURF', 40, 0.5, 'DUNE SURF');
      }
    } else this.surfT = 0;
    // the chain clock runs only between moves
    if (this.weight > 0) {
      const mid = !b.grounded || b.drifting || b.manual || b.wall.on || b.surfing;
      if (!mid) this.timer -= dt;
      if (this.timer <= 0) this.bank();
    }
    this.meter(dt);
  }

  private driftFx(dt: number) {
    const b = this.b, ctx = this.ctx;
    const on = b.drifting && b.grounded;
    if (on && !this.wasDrifting) {
      this.slashes = 0;
      this.chargeTier = 0;
      ctx.sfx('sand_spray', b.pos, 0.55, 0.95);
      this.host.cam.punch(0, 0, 0.6, -b.driftDir * 0.012);
    }
    this.wasDrifting = on;
    if (!on) return;
    const f = b.forward, sp = b.speed;
    const along = b.vel.x * f.x + b.vel.z * f.z;
    let lx = b.vel.x - f.x * along, lz = b.vel.z - f.z * along;
    const ll = Math.hypot(lx, lz);
    if (ll > 1e-3) {
      lx /= ll;
      lz /= ll;
    } else {
      lx = Math.cos(b.heading) * b.driftDir;
      lz = -Math.sin(b.heading) * b.driftDir;
    }
    // rooster tail off the sliding rail, thrown out with the slide
    const tail = _v.set(b.pos.x - f.x * 0.55 + lx * 0.2, b.pos.y + 0.06, b.pos.z - f.z * 0.55 + lz * 0.2);
    const k = Math.min(1.6, 0.6 + b.driftCharge * 0.6) * Math.min(1, sp / 6);
    ctx.fx.sandSpray(tail, { x: lx * (2.5 + sp * 0.45) - f.x * 1.2, y: 1.2 + sp * 0.12, z: lz * (2.5 + sp * 0.45) - f.z * 1.2 }, k * dt * 60 * 0.55);
    this.sprayCd -= dt;
    if (this.sprayCd <= 0) {
      this.sprayCd = 0.32;
      ctx.sfx('sand_spray', tail, 0.25 + k * 0.15, 1 + Math.random() * 0.1);
    }
    // charge tiers glint at the tail: ready to sling
    const tier = b.driftCharge > 1.6 ? 2 : b.driftCharge > 0.8 ? 1 : 0;
    if (tier > this.chargeTier) {
      this.chargeTier = tier;
      ctx.particles.emit({ pos: { x: tail.x, y: tail.y + 0.2, z: tail.z }, count: 6 + tier * 4, spread: 1.6, up: 1.4, life: [0.25, 0.55], size: [0.14, 0.02], sprite: ['star4', 'spark'], additive: true, color: tier === 2 ? [0xffd36b, 0xfff6d0] : [0xfff0c0, 0xffe39a], jitter: 0.25 });
      ctx.sfx('qte_good', null, 0.16, 1.5 + tier * 0.2);
    }
  }

  /** drift through enemies: the swinging tail cuts them (once per enemy per pass) */
  private slash() {
    const b = this.b, ctx = this.ctx;
    if (!b.drifting || !b.grounded || b.speed < 4.5 || !this.host.alive) return;
    const now = this.clock;
    const f = b.forward;
    ctx.enemies.inRadius(b.pos, 2.4, (e: EnemyLike, d: number) => {
      if (!e.alive || d > e.radius + 1.35 || Math.abs(e.pos.y - b.pos.y) > e.height + 0.6) return;
      const last = this.slashCd.get(e.id) ?? -9;
      if (now - last < 0.6) return;
      this.slashCd.set(e.id, now);
      const sp = b.speed;
      let dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const at = _r.set(e.pos.x, e.pos.y + Math.min(1.2, e.height * 0.45), e.pos.z);
      ctx.enemies.damage(e, { base: 16 + sp * 1.6 + b.driftCharge * 6, kind: 'phys', source: 'board', knock: 6 + sp * 0.4, dirX: dx, dirZ: dz, canCrit: true, tags: ['slash'] }, at.clone(), new THREE.Vector3(dx, 0.2, dz));
      ctx.particles.emit({ pos: at, count: 1, life: [0.12, 0.14], size: [1.5, 1.7], sprite: ['smear0', 'smear1', 'smear2'], animate: true, color: 0xfff6e0, rot: 0, sizeJitter: 0 });
      ctx.fx.sandSpray({ x: e.pos.x, y: e.pos.y + 0.1, z: e.pos.z }, { x: dx * 4 + f.x * 2, y: 2, z: dz * 4 + f.z * 2 }, 2.2);
      ctx.sfx('melee_whoosh', at, 0.7, 1.15);
      ctx.sfx('punch', at, 0.6, 1.1);
      ctx.engine.hitStop(0.035);
      ctx.shake(0.12);
      b.slashT = 0;
      b.driftCharge += 0.25; // a cut feeds the sling
      this.slashes++;
      if (this.slashes <= 3) this.link('BOARD SLASH', 70, 1, this.slashes > 1 ? 'BOARD SLASH' : undefined);
      ctx.events.emit('boardSlash', e);
    });
  }

  // ------------------------------------------------------------------ meter
  private meter(dt: number) {
    const open = this.weight > 0 && this.host.alive;
    if (!open) {
      this.big?.show(false);
      this.small?.show(false);
    } else if (!this.big) {
      this.big = new FloatText3D('', { size: 0.26, color: '#ffe39a', glow: '#ff9a3a', cps: 0, wrap: 40, hdr: 1.5 });
      this.small = new FloatText3D('', { size: 0.15, color: '#fff3d6', glow: '#d8a050', cps: 0, wrap: 60, hdr: 1.3 });
      this.ctx.scene.add(this.big.mesh, this.small.mesh);
    }
    const big = this.big, small = this.small;
    if (!big || !small) return;
    if (open) {
      const b = this.b;
      const mid = !b.grounded || b.drifting || b.manual || b.wall.on || b.surfing;
      const pips = mid ? 10 : Math.max(0, Math.ceil((this.timer / CHAIN.window) * 10));
      const m = this.mult;
      const key = `${m}|${this.pool}|${this.names.join(',')}|${pips}`;
      if (key !== this.key) {
        this.key = key;
        big.setText(`x${fmt(m)}  ${Math.round(this.pool * m)}`, true);
        small.setText(`${this.names.slice(-3).join(' + ')}\n${'= '.repeat(pips).trim()}`, true);
      }
      big.show(true);
      small.show(true);
    }
    // beside the rider on the open side of the over-the-shoulder view (camera-left),
    // clear of the crosshair and the wave banner
    const cam = this.ctx.camera;
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const p = this.b.pos;
    big.anchor.set(p.x - _r.x * 1.45, p.y + 1.6, p.z - _r.z * 1.45);
    small.anchor.set(p.x - _r.x * 1.45, p.y + 1.28, p.z - _r.z * 1.45);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    big.hover = this.pulse;
    big.update(dt, cam);
    small.update(dt, cam);
  }

  dispose() {
    this.big?.dispose();
    this.small?.dispose();
  }
}

function fmt(m: number) {
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/0$/, '');
}
