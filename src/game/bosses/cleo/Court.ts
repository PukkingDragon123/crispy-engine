// Cleopatra's court on the field: her ram-headed royal guards and her tamed
// lions. Both are full rigs driven by procedural animation and their own little
// fight scripts, targetable like any enemy (registered as external targets).
//
// ROYAL GUARD ("Ram of Amun")
//   - holds a post between the queen and the hunter, shield raised toward you;
//     the shield takes frontal hits until it SHATTERS (then a short stagger);
//   - "Nightrain": a telegraphed shield-bash charge (stomp, a line of light
//     on the sand, then a rush that bowls you over);
//   - "It's So Easy": a wide glaive sweep when you come close;
//   - while it lives it feeds the queen's SUN WARD (a stream of light from its
//     glaive to her heart): she shrugs off most damage until her guards fall.
// TAMED LION
//   - prowls around you at a lope, flanking; tail lashes when it means it;
//   - "Stray Cat Blues": crouch (a ring marks where it will land), then a long
//     pounce that lands with a maul;
//   - "Hey Bulldog": rears up and rakes twice with its forepaws;
//   - "Get Off of My Cloud": a roar whose shockwave knocks you back (jump it).
import * as THREE from 'three';
import type { Ctx, RayHit } from '../../Ctx';
import type { Player } from '../../player/Player';
import type { Enemies, ExternalTarget } from '../../enemies/Enemies';
import { RigInstance, type RigGeo } from '../../../engine/voxel/Rig';
import { Cloth, type ClothRenderer } from '../../../engine/physics/Cloth';
import { StatusSet } from '../../combat/Status';
import { resolveHit, type Hit } from '../../combat/Damage';
import { clamp, damp, dampAngle, rnd } from '../../../engine/math/rand';
import { leg, GAITS, type LegSample } from '../../anim/gait';
import { SpringF } from '../../anim/spring';
import type { SunShots } from './SunShots';

let COURT_ID = 981000;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _ls: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };

export interface CourtDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  cloth: ClothRenderer;
  shots: SunShots;
  /** the queen: where to guard, whom to feed the ward to */
  queen: { pos: THREE.Vector3; alive: boolean; heart(out: THREE.Vector3): THREE.Vector3 };
  callout(song: string, who: string): void;
}

interface Sphere {
  node: string;
  off: THREE.Vector3;
  r: number;
  part: string;
  weak: number;
}

/** shared body: rig, hit spheres, damage, dissolve-out death */
abstract class CourtActor implements ExternalTarget {
  id = COURT_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.6;
  height = 2;
  alive = true;
  isBoss = false;
  hp: number;
  maxHp: number;
  flying = false;
  rig: RigInstance;
  root = new THREE.Group();
  yaw = 0;
  t = 0;
  hitT = 9;
  status = new StatusSet();
  armor = 25;
  physRes = 0.08;
  magicRes = 0.12;
  spheres: Sphere[] = [];
  registered = false;
  /** scripted: the boss moves it (intro on the barge), no AI */
  scripted = false;
  deadT = 0;
  protected flash = 0;
  protected fx: THREE.Vector4;
  constructor(public d: CourtDeps, geo: RigGeo, public name: string, hp: number) {
    this.hp = this.maxHp = hp;
    this.rig = new RigInstance(geo, { ownMaterial: true });
    this.root.add(this.rig.root);
    d.ctx.scene.add(this.root);
    this.fx = this.rig.material.userData.fx.value;
  }
  get ctx() {
    return this.d.ctx;
  }
  get player() {
    return this.d.player;
  }
  ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  register() {
    if (this.registered) return;
    this.registered = true;
    this.d.enemies.registerExternal(this);
  }
  unregister() {
    if (!this.registered) return;
    this.registered = false;
    this.d.enemies.unregisterExternal(this);
  }
  distToPlayer() {
    return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }
  angleToPlayer() {
    return Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }
  /** facing dot toward a world direction (1 = in front) */
  facing(dx: number, dz: number) {
    const l = Math.hypot(dx, dz) || 1;
    return (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / l;
  }
  sphereCenter(s: Sphere, out: THREE.Vector3) {
    const n = this.rig.nodes[s.node];
    out.copy(s.off);
    if (n) n.localToWorld(out);
    else out.add(this.pos);
    return out;
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || !this.registered) return null;
    let best: RayHit | null = null;
    let bt = maxT;
    for (const s of this.spheres) {
      if (s.r <= 0) continue;
      const c = this.sphereCenter(s, _v);
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const disc = b * b - (ox * ox + oy * oy + oz * oz - s.r * s.r);
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: s.weak > 1.2, part: s.part, surface: 'enemy' };
    }
    return best;
  }
  /** a hit on a special part (shield) can be absorbed: return true when handled */
  protected absorb(_hit: Hit, _part: string | undefined, _point?: THREE.Vector3, _dir?: THREE.Vector3): boolean {
    return false;
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3): number {
    if (!this.alive) return 0;
    const part = hit.tags?.[0];
    if (this.absorb(hit, part, point, dir)) return 0;
    const sp = this.spheres.find((s) => s.part === part);
    const res = resolveHit(this.player.stats, { ...hit, mult: (hit.mult ?? 1) * (sp?.weak ?? 1) }, { hp: this.hp, maxHp: this.maxHp, armor: this.armor, physRes: this.physRes, magicRes: this.magicRes, statusRes: {}, status: this.status, isBoss: false }, this.player.speed);
    const amt = res.amount;
    this.hp -= amt;
    this.hitT = 0;
    this.flash = 1;
    const pp = point ?? _v.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z).clone();
    if (hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      this.ctx.fx.hit(pp, { x: -(dir?.x ?? 0), y: 0.5, z: -(dir?.z ?? 0) }, this.hitKind(part), res.crit ? 1.5 : 1);
      this.ctx.sfx('hit_flesh', pp, 0.45);
    }
    this.ctx.fx.number({ x: pp.x, y: pp.y + 0.4, z: pp.z }, amt, res.crit ? 0xffd040 : 0xffffff, res.crit ? 1.4 : 1.05);
    this.ctx.events.emit('enemyHit', this, hit, amt, res);
    this.onHurt(amt, dir);
    if (this.hp <= 0) this.die();
    return amt;
  }
  protected hitKind(_part?: string): any {
    return 'flesh';
  }
  protected onHurt(_amt: number, _dir?: THREE.Vector3) {}
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0;
    this.unregister();
    this.ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 10);
    this.ctx.events.emit('courtFell', this);
  }
  /** called every frame by the queen */
  update(dt: number) {
    this.t += dt;
    this.hitT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    const tick = this.status.tick(dt, this.maxHp, this.vel.lengthSq() > 1, false);
    if (tick && this.alive) {
      const dot = tick.poison + tick.burn + tick.bleed;
      if (dot > 0) this.takeDamage({ base: dot, kind: 'magic', source: 'burn', canCrit: false });
    }
    if (!this.alive) {
      this.deadT += dt;
      // dissolve into golden sand after lying still
      const k = clamp((this.deadT - 3.2) / 1.6, 0, 1);
      this.fx.y = k * 1.02;
      if (k >= 1) this.root.visible = false;
    }
    this.fx.x = this.flash * 0.7;
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);
  }
  get gone() {
    return !this.alive && !this.root.visible;
  }
  dispose() {
    this.unregister();
    this.root.removeFromParent();
    this.rig.material.dispose();
  }
}

// =============================================================================== the royal guard
type GState = 'post' | 'sweep' | 'bash' | 'stagger' | 'deck' | 'leap' | 'kneel';
export class RoyalGuard extends CourtActor {
  state: GState = 'post';
  st = 0;
  side: number;
  shieldHp: number;
  shieldMax: number;
  shieldUp = true;
  private raise = 1;
  private cd = 2 + rnd.next() * 2;
  private bashCd = 5 + rnd.next() * 4;
  private walk = 0;
  private sweepYaw = 0;
  private hitDone = false;
  private bashDir = new THREE.Vector3();
  private cape: Cloth;
  private tetherT = 0;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private apron = new SpringF(0, 2.4, 0.35);
  private glaivePose = 0;
  constructor(d: CourtDeps, geo: RigGeo, side: number, tier: number) {
    super(d, geo, 'Ram of Amun', 900 + 300 * tier);
    this.side = side;
    this.shieldHp = this.shieldMax = 520 + 160 * tier;
    this.height = 2.5;
    this.radius = 0.6;
    this.armor = 34;
    this.spheres = [
      { node: 'head', off: new THREE.Vector3(0, 0.2, 0.08), r: 0.2, part: 'head', weak: 1.6 },
      { node: 'torso', off: new THREE.Vector3(0, 0.27, 0), r: 0.34, part: 'torso', weak: 1 },
      { node: 'pelvis', off: new THREE.Vector3(0, -0.05, 0), r: 0.3, part: 'pelvis', weak: 0.9 },
      { node: 'shield', off: new THREE.Vector3(-0.13, 0.0, 0.16), r: 0.5, part: 'shield', weak: 1 },
    ];
    this.cape = new Cloth({ w: 6, h: 10, width: 0.62, length: 1.35, colors: [0xa8203a, 0x761428, 0xe2b44c], pattern: 'cape', fray: 0.15, stiffness: 0.9, drag: 2 });
    this.cape.groundAt = (x, z) => this.ground(x, z);
    this.cape.enabled = false;
    d.cloth.add(this.cape);
  }
  protected hitKind(part?: string): any {
    return part === 'shield' || part === 'torso' ? 'armor' : 'flesh';
  }
  protected absorb(hit: Hit, part: string | undefined, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (part !== 'shield' || !this.shieldUp) return false;
    // frontal hits ring off the gold
    const res = resolveHit(this.player.stats, hit, { hp: this.shieldHp, maxHp: this.shieldMax, armor: 10, physRes: 0, magicRes: 0, statusRes: {}, status: this.status, isBoss: false }, this.player.speed);
    this.shieldHp -= res.amount;
    const pp = point ?? this.pos;
    this.ctx.fx.hit(pp, { x: -(dir?.x ?? 0), y: 0.4, z: -(dir?.z ?? 0) }, 'armor', 1.1);
    this.ctx.sfx('counter_clang', pp, 0.35, 1.1 + rnd.next() * 0.2);
    this.ctx.fx.number({ x: pp.x, y: pp.y + 0.3, z: pp.z }, Math.round(res.amount), 0xffd27a, 0.85);
    this.flash = 0.5;
    if (this.shieldHp <= 0) this.breakShield();
    return true;
  }
  breakShield() {
    if (!this.shieldUp) return;
    this.shieldUp = false;
    this.rig.setPartVisible('shield', false);
    const s = this.spheres.find((q) => q.part === 'shield');
    if (s) s.r = 0;
    const c = this.rig.nodes['shield'].localToWorld(_v.set(-0.13, 0, 0.16));
    this.ctx.events.emit('gibs', c.x, c.y, c.z, 26, 0.14, [0xffe08a, 0xe2b44c, 0xb07e26, 0x6a4228], 7, 4);
    this.ctx.fx.explosion({ x: c.x, y: c.y, z: c.z }, 1.4, 'divine');
    this.ctx.sfx('glass_break', c, 0.9, 0.6);
    this.ctx.sfx('counter_clang', c, 1, 0.6);
    this.ctx.shake(0.3);
    this.ctx.toast('SHIELD SHATTERED', '#ffd36b', 'The ram staggers');
    this.state = 'stagger';
    this.st = 0;
  }
  protected onHurt() {
    if (this.state === 'post' && rnd.chance(0.25)) this.raise = 1.25;
  }
  die() {
    if (!this.alive) return;
    super.die();
    this.state = 'kneel';
    this.st = 0;
    this.ctx.sfx('boss_hurt', this.pos, 0.6, 1.3);
    this.ctx.toast('A RAM OF AMUN FALLS', '#ffd36b', 'Her sun ward weakens');
  }
  /** start a scripted leap from the barge deck to the shore */
  leap(to: THREE.Vector3) {
    this.state = 'leap';
    this.st = 0;
    this.leapFrom.copy(this.pos);
    this.leapTo.copy(to);
    this.scripted = true;
  }
  private post(out: THREE.Vector3) {
    const q = this.d.queen.pos;
    const dx = this.player.pos.x - q.x, dz = this.player.pos.z - q.z;
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    const R = Math.min(5, l * 0.5);
    return out.set(q.x + fx * R + -fz * this.side * 2.4, 0, q.z + fz * R + fx * this.side * 2.4);
  }
  update(dt: number) {
    const ctx = this.ctx;
    this.st += dt;
    this.cd -= dt;
    this.bashCd -= dt;
    const pl = this.player;
    let speed = 0;
    if (this.alive && !this.scripted) {
      const dpl = this.distToPlayer();
      switch (this.state) {
        case 'post': {
          const p = this.post(_w);
          const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.6) {
            speed = Math.min(4.6, d * 1.5);
            this.vel.set((dx / d) * speed, 0, (dz / d) * speed);
          } else this.vel.multiplyScalar(Math.exp(-6 * dt));
          this.yaw = dampAngle(this.yaw, this.angleToPlayer(), 5, dt);
          this.raise = damp(this.raise, 1, 3, dt);
          if (this.cd <= 0 && dpl < 4.6) {
            this.state = 'sweep';
            this.st = 0;
            this.hitDone = false;
            this.d.callout("It's So Easy", 'Ram of Amun');
          } else if (this.cd <= 0 && this.bashCd <= 0 && dpl < 17 && dpl > 5) {
            this.state = 'bash';
            this.st = 0;
            this.hitDone = false;
            this.bashDir.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
            this.d.callout('Nightrain', 'Ram of Amun');
            ctx.sfx('shield_up', this.pos, 0.8, 0.8);
          }
          break;
        }
        case 'sweep': {
          this.vel.multiplyScalar(Math.exp(-8 * dt));
          if (this.st < 0.55) {
            this.yaw = dampAngle(this.yaw, this.angleToPlayer(), 6, dt);
            this.sweepYaw = damp(this.sweepYaw, 1.1, 8, dt);
            if (rnd.chance(0.5)) {
              const b = this.rig.sockets['blade']?.getWorldPosition(_v);
              if (b) this.d.shots.mote(b.x, b.y, b.z, 0, 0.5, 0, { life: 0.3, size: 0.25, color: 0xfff0c0, sprite: 'star' });
            }
          } else if (this.st < 0.85) {
            if (!this.hitDone) {
              this.hitDone = true;
              ctx.sfx('whoosh_big', this.pos, 0.8, 1.1);
            }
            this.sweepYaw = damp(this.sweepYaw, -1.3, 14, dt);
            const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
            if (pl.alive && dpl < 4.4 && this.facing(dx, dz) > 0.2 && Math.abs(pl.pos.y - this.pos.y) < 2.2 && this.st < 0.75) pl.takeHit({ base: 22, kind: 'phys', source: 'contact', knock: 11 }, this.pos);
          } else {
            this.sweepYaw = damp(this.sweepYaw, 0, 4, dt);
            if (this.st > 1.5) {
              this.state = 'post';
              this.cd = 2.4 + rnd.next() * 1.5;
            }
          }
          break;
        }
        case 'bash': {
          if (this.st < 0.7) {
            // stomp and a line of light toward you
            this.vel.multiplyScalar(Math.exp(-8 * dt));
            this.yaw = dampAngle(this.yaw, Math.atan2(this.bashDir.x, this.bashDir.z), 8, dt);
            this.raise = damp(this.raise, 1.5, 6, dt);
            if (rnd.chance(0.6)) {
              const s = 1 + rnd.next() * 12;
              const x = this.pos.x + this.bashDir.x * s, z = this.pos.z + this.bashDir.z * s;
              this.d.shots.mote(x, this.ground(x, z) + 0.15, z, 0, 0.6, 0, { life: 0.5, size: 0.3, color: 0xff7a30, sprite: 'glyph' });
            }
            if (this.st > 0.3 && this.st - dt <= 0.3) {
              ctx.fx.dust({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 1.2, 0xe6cf9f, 6);
              ctx.sfx('kick', this.pos, 0.8, 0.7);
            }
          } else if (this.st < 1.75) {
            speed = 13;
            this.vel.set(this.bashDir.x * speed, 0, this.bashDir.z * speed);
            if (rnd.chance(0.5)) ctx.fx.sandSpray({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, { x: -this.bashDir.x * 3, y: 2, z: -this.bashDir.z * 3 }, 1);
            if (!this.hitDone && pl.alive && dpl < 1.6 && Math.abs(pl.pos.y - this.pos.y) < 2) {
              this.hitDone = true;
              pl.takeHit({ base: 18, kind: 'phys', source: 'contact', knock: 17 }, this.pos);
              ctx.shake(0.35);
              ctx.sfx('punch', this.pos, 1, 0.7);
            }
            if (this.hitDone) this.st = Math.max(this.st, 1.75);
          } else {
            this.vel.multiplyScalar(Math.exp(-5 * dt));
            this.raise = damp(this.raise, 1, 4, dt);
            if (this.st > 2.5) {
              this.state = 'post';
              this.bashCd = 7 + rnd.next() * 4;
              this.cd = 1.5;
            }
          }
          break;
        }
        case 'stagger':
          this.vel.multiplyScalar(Math.exp(-6 * dt));
          this.raise = damp(this.raise, -0.3, 6, dt);
          if (this.st > 2.2) {
            this.state = 'post';
            this.cd = 1;
          }
          break;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = damp(this.pos.y, this.ground(this.pos.x, this.pos.z), 18, dt);
      // the sun ward: light streams from the glaive into the queen's heart
      if (this.d.queen.alive) {
        this.tetherT += dt;
        if (this.tetherT > 0.045) {
          this.tetherT = 0;
          const b = this.rig.sockets['blade']?.getWorldPosition(_v);
          const h = this.d.queen.heart(_w);
          if (b) this.d.shots.mote(b.x, b.y, b.z, (h.x - b.x) * 2.2, (h.y - b.y) * 2.2, (h.z - b.z) * 2.2, { life: 0.45, size: 0.2, color: 0xffd070, drag: 0 });
        }
      }
    } else if (this.state === 'leap') {
      const k = clamp(this.st / 1.0, 0, 1);
      this.pos.lerpVectors(this.leapFrom, this.leapTo, k);
      this.pos.y += Math.sin(k * Math.PI) * 3.2;
      this.yaw = dampAngle(this.yaw, Math.atan2(this.leapTo.x - this.leapFrom.x, this.leapTo.z - this.leapFrom.z), 6, dt);
      if (k >= 1) {
        this.pos.y = this.ground(this.pos.x, this.pos.z);
        ctx.fx.dust({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 1.4, 0xe6cf9f, 8);
        ctx.sfx('board_land', this.pos, 0.9, 0.6);
        ctx.shake(0.2);
        this.state = 'post';
        this.scripted = false;
        this.cd = 1.5;
      }
    }
    if (this.alive && !this.cape.enabled && this.root.visible) {
      this.cape.enabled = true;
    }
    super.update(dt);
    this.animate(dt, speed);
    // cape anchors across the shoulder blades
    const a = this.rig.sockets['cape_anchor'];
    if (a && this.cape.enabled) {
      a.getWorldPosition(_v);
      const side = _w.set(1, 0, 0).applyQuaternion(this.root.quaternion);
      const W = this.cape.anchors.length;
      for (let i = 0; i < W; i++) this.cape.anchors[i].copy(_v).addScaledVector(side, (i / (W - 1) - 0.5) * 0.55);
      this.cape.wind.set(ctx.world.sa.wind.x * 3 - this.vel.x, 0.4, ctx.world.sa.wind.z * 3 - this.vel.z);
      this.cape.spheres = [{ c: this.sphereCenter(this.spheres[1], new THREE.Vector3()), r: 0.36 }];
    }
    if (!this.root.visible) this.cape.enabled = false;
  }
  private animate(dt: number, speed: number) {
    const n = this.rig.nodes;
    const t = this.t;
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    this.walk += dt * (1.2 + speed * 1.15);
    const w = this.walk;
    const stride = clamp(speed / 4, 0, 1.3);
    let thL = -Math.sin(w) * 0.55 * stride, thR = Math.sin(w) * 0.55 * stride;
    let shL = Math.max(0, Math.sin(w + 1.4)) * 0.85 * stride, shR = Math.max(0, Math.sin(w + 1.4 + Math.PI)) * 0.85 * stride;
    let torsoX = 0.05 * stride - hitK * 0.15, torsoY = Math.sin(w) * 0.1 * stride, pelvisY = 0, bob = Math.abs(Math.cos(w)) * 0.05 * stride;
    let headX = Math.sin(t * 1.1) * 0.04;
    let armLx = -0.55 * this.raise, foreLx = 0.55 * this.raise, armRx = 0, foreRx = 0, armRz = 0;
    this.glaivePose = damp(this.glaivePose, this.state === 'sweep' ? 1 : this.state === 'bash' && this.st > 0.7 ? 0.6 : 0, 10, dt);
    if (this.state === 'sweep') {
      torsoY = this.sweepYaw * 0.9;
      armRx = -1.1 * this.glaivePose;
      foreRx = 1.35 * this.glaivePose;
      armRz = -0.3 * this.glaivePose;
      thL = -0.35;
      thR = 0.3;
      shL = 0.2;
    }
    if (this.state === 'bash' && this.st > 0.7 && this.st < 1.75) {
      torsoX = 0.32;
      armLx = -0.95;
      foreLx = 0.85;
    }
    if (this.state === 'stagger') {
      torsoX = -0.25 + Math.sin(this.st * 9) * 0.08 * Math.max(0, 1 - this.st);
      headX = 0.3;
    }
    if (this.state === 'leap') {
      const k = clamp(this.st, 0, 1);
      thL = thR = -0.9 * Math.sin(k * Math.PI);
      shL = shR = 1.2 * Math.sin(k * Math.PI);
      torsoX = 0.2;
    }
    if (!this.alive) {
      // drop to the knees, then fall forward
      const k = clamp(this.deadT / 0.6, 0, 1), f = clamp((this.deadT - 0.9) / 0.6, 0, 1);
      thL = thR = -1.45 * k;
      shL = shR = 1.6 * k;
      bob = -0.62 * k - f * 0.5;
      torsoX = 0.35 * k + f * 1.1;
      headX = 0.4 * k;
      armLx = 0.2;
      foreLx = 0;
      armRx = 0.1;
    }
    n['thigh_l'].rotation.set(thL, 0, 0);
    n['thigh_r'].rotation.set(thR, 0, 0);
    n['shin_l'].rotation.set(shL, 0, 0);
    n['shin_r'].rotation.set(shR, 0, 0);
    n['pelvis'].position.y = this.rig.geo.parts[this.rig.geo.index['pelvis']].offset.y + bob;
    n['pelvis'].rotation.set(0, pelvisY - torsoY * 0.3, 0);
    n['torso'].rotation.set(torsoX + Math.sin(t * 1.3) * 0.015, torsoY, 0);
    // the head finds the hunter
    if (this.alive) {
      const lp = this.rig.nodes['torso'].worldToLocal(this.player.center(_v));
      const yaw = clamp(Math.atan2(lp.x, lp.z), -0.8, 0.8);
      n['head'].rotation.set(headX, damp(n['head'].rotation.y, yaw - torsoY * 0.5, 6, dt), 0);
    } else n['head'].rotation.set(headX, 0, 0);
    n['jaw'].rotation.x = this.state === 'bash' && this.st < 0.7 ? 0.35 : 0;
    n['arm_l'].rotation.set(armLx - hitK * 0.1, 0, 0);
    n['fore_l'].rotation.set(foreLx, 0, 0);
    n['arm_r'].rotation.set(armRx + Math.sin(w) * 0.12 * stride, 0, armRz);
    n['fore_r'].rotation.set(foreRx, 0, 0);
    // the stiff apron swings with the stride
    const sw = this.apron.step(-thL * 0.3 - thR * 0.3 + torsoX * 0.4, dt);
    n['apron'].rotation.x = clamp(sw, -0.5, 0.6);
    n['ear_l'].rotation.z = Math.sin(t * 2.1) * 0.05;
    n['ear_r'].rotation.z = -Math.sin(t * 2.3) * 0.05;
  }
  dispose() {
    super.dispose();
    this.d.cloth.remove(this.cape);
  }
}

// =============================================================================== the tamed lion
type LState = 'prowl' | 'crouch' | 'pounce' | 'maul' | 'roar' | 'recover' | 'deck' | 'leap' | 'down';
export class TamedLion extends CourtActor {
  state: LState = 'prowl';
  st = 0;
  K: number;
  private cd = 2.5 + rnd.next() * 2;
  private roarCd = 6 + rnd.next() * 6;
  private orbit = rnd.next() * Math.PI * 2;
  private orbitDir = rnd.chance(0.5) ? 1 : -1;
  private gaitP = rnd.next();
  private spd = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private hitDone = 0;
  private lash = 0;
  private tailS = [new SpringF(0, 1.6, 0.4), new SpringF(0, 1.6, 0.4), new SpringF(0, 1.4, 0.35)];
  private yawPrev = 0;
  private legF: { upper: number; lower: number; hip: number };
  private legB: { upper: number; lower: number; hip: number };
  constructor(d: CourtDeps, geo: RigGeo, public maned: boolean, tier: number) {
    super(d, geo, maned ? 'Sekhem, the Queen\'s Lion' : 'Daughter of Bast', (maned ? 1200 : 1000) + 200 * tier);
    this.K = maned ? 1 : 0.9;
    this.height = 1.3 * this.K;
    this.radius = 0.75 * this.K;
    this.armor = 22;
    const K = this.K;
    this.spheres = [
      { node: 'head', off: new THREE.Vector3(0, 0.05 * K, 0.22 * K), r: 0.22 * K, part: 'head', weak: 1.5 },
      { node: 'neck', off: new THREE.Vector3(0, 0.1 * K, 0.2 * K), r: (maned ? 0.36 : 0.24) * K, part: 'neck', weak: 1 },
      { node: 'chest', off: new THREE.Vector3(0, -0.04 * K, 0.66 * K), r: 0.36 * K, part: 'chest', weak: 1 },
      { node: 'hips', off: new THREE.Vector3(0, -0.04 * K, -0.3 * K), r: 0.33 * K, part: 'hips', weak: 0.9 },
    ];
    const meta = geo.spec.meta ?? {};
    this.legF = meta.legF ?? { upper: 0.36, lower: 0.38, hip: 0.84 };
    this.legB = meta.legB ?? { upper: 0.36, lower: 0.42, hip: 0.84 };
  }
  protected onHurt() {
    if (this.state === 'prowl' && rnd.chance(0.3)) this.lash = 1;
  }
  die() {
    if (!this.alive) return;
    super.die();
    this.state = 'down';
    this.st = 0;
    this.ctx.sfx('jackal_growl', this.pos, 0.8, 0.55);
    this.ctx.toast(this.maned ? 'SEKHEM FALLS' : 'THE LIONESS FALLS', '#ffd36b');
  }
  /** the queen's command (Welcome to the Jungle) */
  command(kind: 'roar' | 'pounce') {
    if (!this.alive || this.scripted) return;
    this.state = kind === 'roar' ? 'roar' : 'crouch';
    this.st = 0;
    this.hitDone = 0;
    if (kind === 'pounce') this.aimPounce();
  }
  leapTo(to: THREE.Vector3) {
    this.state = 'leap';
    this.st = 0;
    this.from.copy(this.pos);
    this.to.copy(to);
    this.scripted = true;
  }
  private aimPounce() {
    const pl = this.player;
    const v = pl.board.vel;
    const tx = pl.pos.x + v.x * 0.55, tz = pl.pos.z + v.z * 0.55;
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const r = Math.min(13, d);
    this.from.copy(this.pos);
    this.to.set(this.pos.x + (dx / d) * r, 0, this.pos.z + (dz / d) * r);
    this.to.y = this.ground(this.to.x, this.to.z);
  }
  update(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    this.st += dt;
    this.cd -= dt;
    this.roarCd -= dt;
    this.lash = Math.max(0, this.lash - dt * 0.5);
    let want = 0;
    if (this.alive && !this.scripted) {
      const dpl = this.distToPlayer();
      switch (this.state) {
        case 'prowl': {
          // circle the hunter, flanking, at a lope
          this.orbit += this.orbitDir * dt * 0.35;
          const R = 9 + Math.sin(this.t * 0.4) * 2;
          const tx = pl.pos.x + Math.sin(this.orbit) * R, tz = pl.pos.z + Math.cos(this.orbit) * R;
          const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
          want = d > 1 ? Math.min(9.5, 2 + d * 0.9) : 0;
          if (d > 0.5) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 3.2, dt);
          if (this.cd <= 0) {
            if (dpl < 3.4) {
              this.state = 'maul';
              this.st = 0;
              this.hitDone = 0;
              this.d.callout('Hey Bulldog', this.name);
            } else if (this.roarCd <= 0 && dpl < 10) {
              this.state = 'roar';
              this.st = 0;
              this.hitDone = 0;
              this.d.callout('Get Off of My Cloud', this.name);
            } else if (dpl < 15 && dpl > 4) {
              this.state = 'crouch';
              this.st = 0;
              this.hitDone = 0;
              this.aimPounce();
              this.d.callout('Stray Cat Blues', this.name);
            }
          }
          break;
        }
        case 'crouch': {
          want = 0;
          this.lash = 1;
          this.yaw = dampAngle(this.yaw, Math.atan2(this.to.x - this.pos.x, this.to.z - this.pos.z), 8, dt);
          if (this.st < dt * 1.5) ctx.sfx('jackal_growl', this.pos, 0.8, 0.6);
          if (Math.floor(this.st / 0.2) !== Math.floor((this.st - dt) / 0.2)) ctx.fx.ring({ x: this.to.x, y: this.to.y + 0.15, z: this.to.z }, 0xff6a3a, 4.2, 0.3);
          if (this.st > 0.7) {
            this.state = 'pounce';
            this.st = 0;
            this.from.copy(this.pos);
            ctx.sfx('whoosh_big', this.pos, 0.8, 0.8);
          }
          break;
        }
        case 'pounce': {
          const T = 0.72;
          const k = clamp(this.st / T, 0, 1);
          this.pos.x = this.from.x + (this.to.x - this.from.x) * k;
          this.pos.z = this.from.z + (this.to.z - this.from.z) * k;
          this.pos.y = this.from.y + (this.to.y - this.from.y) * k + Math.sin(k * Math.PI) * 1.7;
          if (k >= 1) {
            ctx.fx.dust({ x: this.pos.x, y: this.to.y, z: this.pos.z }, 1.6, 0xe6cf9f, 8);
            ctx.fx.sandBurst({ x: this.pos.x, y: this.to.y, z: this.pos.z }, 0.8);
            ctx.shake(0.3);
            ctx.sfx('board_land', this.pos, 1, 0.5);
            if (pl.alive && Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 2.3 && Math.abs(pl.pos.y - this.to.y) < 1.8) pl.takeHit({ base: 26, kind: 'phys', source: 'contact', knock: 13, status: [{ id: 'bleed', stacks: 2, dur: 3 }] }, this.pos);
            this.state = dpl < 3.2 ? 'maul' : 'recover';
            this.st = 0;
            this.hitDone = 0;
          }
          break;
        }
        case 'maul': {
          want = 0;
          this.yaw = dampAngle(this.yaw, this.angleToPlayer(), 6, dt);
          for (const [t0, idx] of [[0.42, 1], [0.78, 2]] as [number, number][]) {
            if (this.st > t0 && this.hitDone < idx) {
              this.hitDone = idx;
              ctx.sfx('melee_whoosh', this.pos, 0.9, 0.7);
              const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
              const head = this.rig.nodes['head'].getWorldPosition(_v);
              this.d.shots.burst(head.x, head.y - 0.3, head.z, 0xfff0d0, 6);
              if (pl.alive && Math.hypot(dx, dz) < 3.3 && this.facing(dx, dz) > 0.3) pl.takeHit({ base: 17, kind: 'phys', source: 'contact', knock: 7, status: [{ id: 'bleed', stacks: 1, dur: 3 }] }, this.pos);
            }
          }
          if (this.st > 1.25) {
            this.state = 'recover';
            this.st = 0;
          }
          break;
        }
        case 'roar': {
          want = 0;
          this.yaw = dampAngle(this.yaw, this.angleToPlayer(), 5, dt);
          if (this.st > 0.6 && this.hitDone < 1) {
            this.hitDone = 1;
            const m = this.rig.sockets['mouth']?.getWorldPosition(_v) ?? this.pos;
            ctx.sfx('boss_roar', m, 1, 1.35);
            ctx.sfx('anubis_roar', m, 0.6, 1.5);
            ctx.shake(0.45);
            const g = this.ground(this.pos.x, this.pos.z);
            for (let r = 0; r < 3; r++) ctx.engine.tweens.after(r * 0.12, () => ctx.fx.ring({ x: this.pos.x, y: g + 0.3, z: this.pos.z }, 0xffe0a0, 6 + r * 6, 0.45));
            ctx.fx.dust({ x: this.pos.x, y: g, z: this.pos.z }, 3, 0xe6cf9f, 10);
            const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
            const air = pl.pos.y > this.ground(pl.pos.x, pl.pos.z) + 1.2;
            if (pl.alive && d < 9.5 && !air) {
              pl.takeHit({ base: 8, kind: 'phys', source: 'contact', knock: 4 }, this.pos);
              pl.board.impulse.add(new THREE.Vector3((dx / d) * 17, 4, (dz / d) * 17));
            }
          }
          if (this.st > 1.7) {
            this.state = 'recover';
            this.st = 0;
            this.roarCd = 9 + rnd.next() * 5;
          }
          break;
        }
        case 'recover':
          want = 0;
          if (this.st > 0.7) {
            this.state = 'prowl';
            this.cd = 2.2 + rnd.next() * 2.4;
            this.orbit = Math.atan2(this.pos.x - pl.pos.x, this.pos.z - pl.pos.z);
          }
          break;
      }
      if (this.state !== 'pounce') {
        this.spd = damp(this.spd, want, 3, dt);
        this.pos.x += Math.sin(this.yaw) * this.spd * dt;
        this.pos.z += Math.cos(this.yaw) * this.spd * dt;
        this.pos.y = damp(this.pos.y, this.ground(this.pos.x, this.pos.z), 16, dt);
      }
      this.vel.set(Math.sin(this.yaw) * this.spd, 0, Math.cos(this.yaw) * this.spd);
    } else if (this.state === 'leap') {
      const k = clamp(this.st / 0.95, 0, 1);
      this.pos.lerpVectors(this.from, this.to, k);
      this.pos.y += Math.sin(k * Math.PI) * 2.6;
      this.yaw = dampAngle(this.yaw, Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z), 8, dt);
      if (k >= 1) {
        this.pos.y = this.ground(this.pos.x, this.pos.z);
        ctx.fx.dust({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 1.6, 0xe6cf9f, 8);
        ctx.sfx('board_land', this.pos, 0.9, 0.55);
        this.state = 'roar';
        this.st = 0.3;
        this.hitDone = 0;
        this.scripted = false;
      }
    }
    super.update(dt);
    this.animate(dt);
  }
  private animate(dt: number) {
    const n = this.rig.nodes;
    const t = this.t, K = this.K;
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    // gait: walk / trot / gallop by speed
    const sp = this.state === 'pounce' || this.state === 'leap' ? 0 : this.spd;
    const gallop = clamp((sp - 5.5) / 2.5, 0, 1), trot = clamp((sp - 1.8) / 1.5, 0, 1) * (1 - gallop);
    const amp = 0.22 + 0.25 * gallop;
    const duty = 0.62 - 0.2 * gallop;
    this.gaitP += dt * Math.max(0.45, (sp * duty) / (2 * amp) * 0.55);
    const ph = (k: 'fl' | 'fr' | 'bl' | 'br') => {
      const w4 = GAITS.walk4[k], tr = GAITS.trot[k], ga = GAITS.gallop[k];
      return w4 * (1 - trot - gallop) + tr * trot + ga * gallop;
    };
    const moving = clamp(sp / 1.2, 0, 1);
    const legs: [string, 'fl' | 'fr' | 'bl' | 'br', boolean][] = [['_fl', 'fl', true], ['_fr', 'fr', true], ['_bl', 'bl', false], ['_br', 'br', false]];
    let rootDrop = 0, pitch = 0, chestX = 0, headX = 0, jaw = 0, tailUp = 0;
    const st = this.st;
    for (const [sf, key, front] of legs) {
      leg(this.gaitP + ph(key), duty, _ls);
      let up = -_ls.sweep * (front ? 0.42 : 0.4) * (0.6 + gallop * 0.6) * moving;
      let lo = 0, paw = 0;
      if (front) {
        lo = _ls.lift * 0.55 * moving;
        paw = _ls.lift * 1.0 * moving;
      } else {
        lo = -_ls.lift * 0.5 * moving;
        paw = _ls.lift * 0.8 * moving;
      }
      // poses
      if (this.state === 'crouch') {
        const k = clamp(st / 0.35, 0, 1);
        up = front ? -0.55 * k : 0.55 * k;
        lo = front ? 1.0 * k : -1.1 * k;
        paw = front ? -0.5 * k : 0.6 * k;
      } else if (this.state === 'pounce' || this.state === 'leap') {
        const k = clamp(st / 0.7, 0, 1);
        up = front ? -1.05 + k * 0.6 : 0.9 - k * 0.7;
        lo = front ? -0.15 : 0.15;
        paw = front ? 0.3 : -0.3;
      } else if (this.state === 'maul') {
        const rear = Math.sin(clamp(st / 1.2, 0, 1) * Math.PI);
        if (front) {
          const sw = sf === '_fl' ? Math.sin(st * 9) : Math.sin(st * 9 + Math.PI);
          up = -1.3 * rear + sw * 0.5 * rear;
          lo = 0.4 * rear;
          paw = -0.6 * rear;
        } else {
          up = -0.45 * rear;
          lo = -0.5 * rear;
          paw = 0.5 * rear;
        }
      } else if (this.state === 'deck') {
        up = front ? -1.3 : -0.9;
        lo = front ? 0.15 : -1.9;
        paw = front ? -0.1 : 1.5;
      } else if (this.state === 'down') {
        const k = clamp(this.deadT / 0.6, 0, 1);
        up = up * (1 - k) + (front ? -0.4 : 0.3) * k;
        lo = lo * (1 - k);
        paw = paw * (1 - k) + 0.3 * k;
      }
      n['leg' + sf].rotation.set(up, 0, 0);
      n['shin' + sf].rotation.set(lo, 0, 0);
      n['paw' + sf].rotation.set(paw, 0, 0);
    }
    // body
    const bob = -Math.abs(Math.sin(this.gaitP * Math.PI * 2)) * (0.025 + 0.05 * gallop) * moving;
    chestX = Math.sin(this.gaitP * Math.PI * 2) * 0.07 * gallop;
    if (this.state === 'crouch') {
      rootDrop = -0.22 * clamp(st / 0.35, 0, 1) * K;
      headX = 0.15;
      tailUp = 0.2;
    } else if (this.state === 'pounce' || this.state === 'leap') {
      pitch = -0.35 + clamp(st / 0.7, 0, 1) * 0.6;
      jaw = 0.45;
    } else if (this.state === 'maul') {
      const rear = Math.sin(clamp(st / 1.2, 0, 1) * Math.PI);
      pitch = -0.7 * rear;
      rootDrop = -0.05 * rear;
      jaw = 0.5 * rear;
      headX = 0.2 * rear;
    } else if (this.state === 'roar') {
      const inhale = clamp(st / 0.6, 0, 1), out = st > 0.6 ? Math.sin(clamp((st - 0.6) / 1.0, 0, 1) * Math.PI) : 0;
      headX = 0.25 * inhale * (1 - out) - 0.45 * out;
      jaw = 0.62 * out;
      chestX = -0.08 * out;
      rootDrop = -0.04 * inhale * (1 - out);
    } else if (this.state === 'deck') {
      rootDrop = -0.5 * K;
      headX = -0.05;
    }
    // breathing and hit flinch
    const breath = Math.sin(t * (this.state === 'prowl' ? 2.4 : 1.6)) * 0.012;
    n['chest'].scale.setScalar(1 + breath);
    const hips = n['hips'];
    const base = this.rig.geo.parts[this.rig.geo.index['hips']].offset;
    hips.position.set(base.x, base.y + bob + rootDrop, base.z);
    let roll = 0;
    if (!this.alive) {
      const k = clamp(this.deadT / 0.6, 0, 1);
      roll = 1.35 * (k * k);
      hips.position.y = base.y - 0.38 * K * k;
      jaw = 0.25 * k;
      headX = 0.3 * k;
    }
    // bank into turns
    const turn = ((this.yaw - this.yawPrev + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yawPrev = this.yaw;
    const bank = clamp(-turn / Math.max(dt, 1e-3) * 0.05, -0.18, 0.18) * moving;
    hips.rotation.set(pitch - hitK * 0.08, 0, roll + bank);
    n['chest'].rotation.set(chestX + (pitch < -0.2 ? pitch * 0.25 : 0), Math.sin(this.gaitP * Math.PI * 2) * 0.05 * moving, -bank * 0.5);
    // head and neck find the hunter (heads stay level while the body bobs)
    if (this.alive && this.state !== 'deck') {
      const nk = n['neck'];
      nk.parent!.updateWorldMatrix(true, false);
      const lp = nk.parent!.worldToLocal(this.player.center(_v));
      const yaw = clamp(Math.atan2(lp.x, lp.z - nk.position.z), -0.7, 0.7);
      nk.rotation.set(-pitch * 0.5 + headX * 0.4, damp(nk.rotation.y, yaw * 0.5, 4, dt), 0);
      n['head'].rotation.set(headX - pitch * 0.3 - chestX, damp(n['head'].rotation.y, yaw * 0.5, 5, dt), Math.sin(t * 0.7) * 0.03);
    } else {
      n['neck'].rotation.set(headX * 0.4, 0, 0);
      n['head'].rotation.set(headX, 0, 0);
    }
    n['jaw'].rotation.x = damp(n['jaw'].rotation.x, jaw, 14, dt);
    for (const s of ['_l', '_r']) n['ear' + s].rotation.set(this.state === 'crouch' || this.state === 'roar' ? 0.5 : Math.sin(t * 1.7 + (s === '_l' ? 0 : 2)) * 0.06, 0, 0);
    // tail: hangs in a curve, sways; lashes when it means it
    const lash = this.lash + (this.state === 'crouch' ? 1 : 0);
    const sway = Math.sin(t * (1.4 + lash * 4)) * (0.25 + lash * 0.5);
    const tY = this.tailS[0].step(sway, dt), tY2 = this.tailS[1].step(tY * 1.2, dt), tY3 = this.tailS[2].step(tY2 * 1.3, dt);
    n['tail1'].rotation.set(-0.15 - tailUp - gallop * 0.35, tY, 0);
    n['tail2'].rotation.set(-0.1 - gallop * 0.25, tY2 * 0.8, 0);
    n['tail3'].rotation.set(-gallop * 0.2, tY3 * 0.7, 0);
    n['tail4'].rotation.set(0, tY3 * 0.5, 0);
  }
}
