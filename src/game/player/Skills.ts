// Sundown's Serket kit: Pinch (shoulder companion that leaps to sting and helps
// reload), Scorpion Toss (E), Locust Swarm (C), Dung Bomb (G, bouncing physics
// grenade with a stink cloud).
// A new hunt starts with only the pistol: the three tarot skills are SEALED until
// learned from a rank-up card (run/Upgrades.ts `learn*` cards -> Skills.learn).
// `echo` (a quest reward) makes every cast repeat once ~0.3 s later.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, vary } from '../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { SpriteBatch } from '../fx/SpriteBatch';
import { modelEntry } from '../models/lookup';
import { P } from '../../engine/voxel/palette';
import { VF } from '../../engine/voxel/VoxelModel';
import { clamp, damp, rnd } from '../../engine/math/rand';
import { Input } from '../../engine/Input';

const _v = new THREE.Vector3();

export type SkillKey = 'E' | 'C' | 'G';
/** the three tarot skills: card title and skill name */
export const SKILL_INFO: Record<SkillKey, { card: string; name: string }> = {
  E: { card: 'THE MAGICIAN', name: 'Scorpion Toss' },
  C: { card: 'THE TOWER', name: 'Locust Swarm' },
  G: { card: 'THE SUN', name: 'Dung Bomb' },
};
/** has the running hunt learned this tarot skill? (keys that aren't sealable, like Z, always are) */
export function isSkillLearned(key: string) {
  const s = Skills.current;
  if (!s || !(key in SKILL_INFO)) return true;
  return s.learned.has(key as SkillKey);
}

/** small blocky scorpion used for thrown brood (fallback if no model registered) */
function broodModel() {
  const m = new VoxelModel('brood');
  const shell = vary(0xb8742c, 0.06);
  m.box(-2, 0, -3, 2, 1, 2, shell);
  m.box(-1, 2, -2, 1, 2, 1, vary(0xd08a38, 0.05));
  for (let i = 0; i < 5; i++) m.box(0, 1 + i, -4 - i, 0, 2 + i, -4 - i, vary(0xa8622a, 0.06));
  m.box(0, 7, -9, 0, 8, -8, P.poison2);
  m.box(-4, 0, 3, -3, 1, 5, shell);
  m.box(3, 0, 3, 4, 1, 5, shell);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) m.box(s * 3, 0, -2 + k * 2, s * 4, 0, -2 + k * 2, 0x6a3a18);
  m.set(-1, 2, 2, P.black).set(1, 2, 2, P.black);
  return m;
}

interface Brood {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  state: 'fly' | 'seek' | 'latched';
  target: EnemyLike | null;
  life: number;
  stingT: number;
  off: THREE.Vector3;
}

interface Bomb {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  spin: number;
  bounces: number;
}

interface Cloud {
  pos: THREE.Vector3;
  r: number;
  life: number;
  tick: number;
}

export class Skills {
  /** the hunt's live skill kit (HUD / cinematics read it) */
  static current: Skills | null = null;
  /** tarot skills learned this hunt (a new hunt starts with none) */
  learned = new Set<SkillKey>();
  /** quest reward: every cast repeats once ~0.3 s later */
  echo = false;
  private sealedNag = 0;
  scorpCd = 0;
  swarmCd = 0;
  bombCharges = 2;
  bombRecharge = 0;
  brood: Brood[] = [];
  bombs: Bomb[] = [];
  clouds: Cloud[] = [];
  swarmT = 0;
  swarmBugs: { a: number; r: number; h: number; sp: number; dive: number; target: EnemyLike | null; p: THREE.Vector3 }[] = [];
  private broodMesh: THREE.InstancedMesh;
  private bombMesh: THREE.Mesh;
  private bombPool: THREE.Mesh[] = [];
  private bugBatch = new SpriteBatch(300);
  private swarmLoop: any = null;
  // Pinch
  pinch: RigInstance | null = null;
  pinchRoot = new THREE.Group();
  pinchState: 'shoulder' | 'leap' | 'sting' | 'return' | 'reload' = 'shoulder';
  pinchT = 0;
  pinchCd = 2;
  pinchTarget: EnemyLike | null = null;
  private pinchFrom = new THREE.Vector3();
  private pinchPos = new THREE.Vector3();
  constants = { scorpCd: 8, swarmCd: 16, bombRecharge: 7 };

  constructor(private ctx: Ctx, private player: Player, private input: Input) {
    Skills.current = this;
    const vs = 1 / 48;
    const g = buildVoxelGeometry(broodModel(), { voxelSize: vs, pivot: 'bottom' });
    this.broodMesh = new THREE.InstancedMesh(g, sharedVoxelMaterial, 48);
    this.broodMesh.count = 0;
    this.broodMesh.castShadow = true;
    this.broodMesh.frustumCulled = false;
    ctx.scene.add(this.broodMesh);
    // dung bomb visual
    const db = modelEntry('dung_bomb') ?? modelEntry('dungBomb');
    let bg: THREE.BufferGeometry;
    const r = db?.() as any;
    if (r?.model) bg = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'center' });
    else {
      const m = new VoxelModel('dungbomb');
      m.box(-3, -3, -3, 3, 3, 3, vary(0x6a4424, 0.12));
      m.carveBox(-3, -3, -3, -3, -3, -3).carveBox(3, 3, 3, 3, 3, 3).carveBox(-3, 3, 3, -3, 3, 3).carveBox(3, -3, -3, 3, -3, -3);
      m.box(0, 4, 0, 0, 6, 0, 0xd8c8a0);
      m.set(0, 7, 0, P.fire1, VF.EMISSIVE);
      bg = buildVoxelGeometry(m, { voxelSize: 1 / 24, pivot: 'center' });
    }
    this.bombMesh = new THREE.Mesh(bg, sharedVoxelMaterial);
    this.bombMesh.castShadow = true;
    ctx.scene.add(this.bugBatch.mesh);
    // Pinch
    const pe = modelEntry('pinch');
    const spec = pe?.() as RigSpec | undefined;
    if (spec?.parts) {
      this.pinch = new RigInstance(buildRigGeo(spec, 'pinch:player'));
      this.pinchRoot.add(this.pinch.root);
    } else {
      const m = new THREE.Mesh(g, sharedVoxelMaterial);
      m.scale.setScalar(1.4);
      this.pinchRoot.add(m);
    }
    ctx.scene.add(this.pinchRoot);
  }

  get stats() {
    return this.player.stats;
  }

  update(dt: number) {
    const inp = this.input;
    const cdr = 1 - this.stats.get('cdr');
    this.scorpCd -= dt;
    this.swarmCd -= dt;
    if (this.bombCharges < 2) {
      this.bombRecharge -= dt;
      if (this.bombRecharge <= 0) {
        this.bombCharges++;
        this.bombRecharge = this.constants.bombRecharge * cdr;
      }
    }
    this.sealedNag -= dt;
    if (this.player.alive) {
      if (inp.hit('skill1')) this.tryCast('E');
      if (inp.hit('skill2')) this.tryCast('C');
      if (inp.hit('grenade')) this.tryCast('G');
    }
    this.updateBrood(dt);
    this.updateBombs(dt);
    this.updateClouds(dt);
    this.updateSwarm(dt);
    this.updatePinch(dt);
  }

  // ----------------------------------------------------------- learning, sealing, echo
  /** learn a tarot skill (from a rank-up card); `quiet` skips the fanfare (e.g. restoring a carried run) */
  learn(k: SkillKey, quiet = false) {
    if (this.learned.has(k)) return;
    this.learned.add(k);
    if (k === 'G') this.bombCharges = 2;
    if (quiet) return;
    const info = SKILL_INFO[k];
    const c = this.player.center(new THREE.Vector3());
    this.ctx.toast(`${info.card} AWAKENS`, '#c8ff5a', `${info.name}  ·  ${k}`, true);
    this.ctx.sfx('card_flip', null, 0.9);
    this.ctx.sfx('divine_chime', null, 0.7);
    this.ctx.fx.glyphs(c, 0x9dff3a, 10, 1.4);
    this.ctx.fx.sparkle(c, 0xffd36b, 12, 0.9);
    this.player.express('smug', 1.2);
  }

  private tryCast(k: SkillKey) {
    if (!this.learned.has(k)) {
      if (this.sealedNag <= 0) {
        this.sealedNag = 1.2;
        this.ctx.sfx('ui_error', null, 0.5);
        this.ctx.toast(`${SKILL_INFO[k].card} IS SEALED`, '#d8c8a8', 'Earn it at a bounty rank-up');
      }
      return;
    }
    if (k === 'E' && this.scorpCd <= 0) this.tossScorpions();
    else if (k === 'C' && this.swarmCd <= 0) this.summonSwarm();
    else if (k === 'G' && this.bombCharges > 0) this.throwBomb();
    else return;
    if (this.echo) this.ctx.engine.tweens.after(0.3, () => this.echoCast(k));
  }

  /** the echo: the same skill again, free, with a jade shimmer */
  private echoCast(k: SkillKey) {
    if (!this.player.alive) return;
    const c = this.player.center(new THREE.Vector3());
    this.ctx.fx.sparkle(c, 0x9dff3a, 10, 0.7);
    this.ctx.sfx('divine_chime', c, 0.35, 1.4);
    if (k === 'E') this.tossScorpions(true);
    else if (k === 'C') this.summonSwarm(true);
    else this.throwBomb(true);
  }

  // ----------------------------------------------------------- scorpion toss
  tossScorpions(echo = false) {
    const n = 2 + Math.round(this.stats.get('scorpions'));
    if (!echo) this.scorpCd = this.constants.scorpCd * (1 - this.stats.get('cdr'));
    const o = this.player.center(new THREE.Vector3());
    const aim = this.player.aimPoint;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.22 + (echo ? 0.11 : 0);
      const dx = aim.x - o.x, dz = aim.z - o.z;
      const d = Math.min(26, Math.hypot(dx, dz)) || 1;
      const ang = Math.atan2(dx, dz) + spread;
      const T = 0.55 + d / 40;
      const v = new THREE.Vector3((Math.sin(ang) * d) / T, 6 + rnd.next() * 2, (Math.cos(ang) * d) / T);
      this.brood.push({ pos: o.clone(), vel: v, yaw: ang, state: 'fly', target: null, life: 7 + this.stats.get('magic') * 0.2, stingT: 0, off: new THREE.Vector3((rnd.next() - 0.5) * 0.5, 0, (rnd.next() - 0.5) * 0.5) });
    }
    this.ctx.sfx('scorpion_throw', o, 0.9);
    this.ctx.sfx('scorpion_chitter', o, 0.6);
    this.player.express('determined', 0.6);
    this.player.playAction('throw', 0.5);
    this.ctx.engine.tweens.after(0.18, () => this.player.smear(o.clone().add(new THREE.Vector3(0, 0.4, 0)), 1.3));
  }

  private updateBrood(dt: number) {
    const ctx = this.ctx;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let i = this.brood.length - 1; i >= 0; i--) {
      const b = this.brood[i];
      b.life -= dt;
      if (b.life <= 0 || (b.target && !b.target.alive && b.state === 'latched')) {
        if (b.life <= 0) {
          ctx.fx.sandBurst(b.pos, 0.25);
          this.brood.splice(i, 1);
          continue;
        }
        b.state = 'seek';
        b.target = null;
      }
      const g = ctx.world.groundAt(b.pos.x, b.pos.z);
      if (b.state === 'fly') {
        b.vel.y -= 22 * dt;
        b.pos.addScaledVector(b.vel, dt);
        if (b.pos.y <= g) {
          b.pos.y = g;
          b.state = 'seek';
          ctx.fx.sandBurst(b.pos, 0.2);
        }
      } else if (b.state === 'seek') {
        if (!b.target || !b.target.alive) b.target = ctx.enemies.nearest(b.pos, 14, (e) => !e.flying);
        if (b.target) {
          const dx = b.target.pos.x - b.pos.x, dz = b.target.pos.z - b.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          b.yaw = Math.atan2(dx, dz);
          const sp = 9;
          b.pos.x += (dx / d) * sp * dt;
          b.pos.z += (dz / d) * sp * dt;
          b.pos.y = g;
          if (d < b.target.radius + 0.3) {
            b.state = 'latched';
            ctx.sfx('scorpion_chitter', b.pos, 0.4);
          }
        } else {
          b.pos.y = g;
          b.yaw += dt * 3;
        }
        if (rnd.chance(0.25)) ctx.fx.sandSpray(b.pos, { x: 0, y: 0, z: 0 }, 0.15);
      } else if (b.state === 'latched' && b.target) {
        const t = b.target;
        b.pos.set(t.pos.x + b.off.x * t.radius * 2, t.pos.y + t.height * (0.4 + b.off.z), t.pos.z + b.off.x * t.radius);
        b.stingT -= dt;
        if (b.stingT <= 0) {
          b.stingT = 0.7;
          ctx.enemies.damage(t, { base: 6, kind: 'magic', source: 'scorpion', status: [{ id: 'poison', stacks: 2, dur: 4, power: 2.2 }], canCrit: true }, b.pos.clone());
          ctx.sfx('scorpion_sting', b.pos, 0.35);
        }
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      const wig = b.state === 'seek' ? Math.sin(performance.now() / 40 + i) * 0.04 : 0;
      m.compose(b.pos.clone().add(new THREE.Vector3(0, wig > 0 ? wig : 0, 0)), q, new THREE.Vector3(1, 1, 1));
      if (n < 48) this.broodMesh.setMatrixAt(n++, m);
    }
    this.broodMesh.count = n;
    this.broodMesh.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------- swarm
  summonSwarm(echo = false) {
    const count = Math.round(36 * this.stats.get('swarmSize'));
    if (echo && this.swarmT > 0) {
      // the echo thickens the cloud already circling and keeps it a little longer
      this.swarmT += 2;
      for (let i = 0; i < Math.round(count * 0.6); i++) this.swarmBugs.push({ a: rnd.next() * Math.PI * 2, r: 1.5 + rnd.next() * 3, h: 0.5 + rnd.next() * 2, sp: (1.5 + rnd.next() * 2) * rnd.sign(), dive: 0, target: null, p: this.player.center(new THREE.Vector3()) });
      this.ctx.sfx('divine_power', this.player.pos, 0.35, 1.2);
      return;
    }
    if (!echo) this.swarmCd = this.constants.swarmCd * (1 - this.stats.get('cdr'));
    this.swarmT = 8 * Math.sqrt(this.stats.get('swarmSize'));
    this.swarmBugs = [];
    for (let i = 0; i < count; i++) this.swarmBugs.push({ a: rnd.next() * Math.PI * 2, r: 1.5 + rnd.next() * 3, h: 0.5 + rnd.next() * 2, sp: (1.5 + rnd.next() * 2) * rnd.sign(), dive: 0, target: null, p: this.player.center(new THREE.Vector3()) });
    this.ctx.sfx('divine_power', this.player.pos, 0.6);
    this.player.playAction('summon', 0.9);
    this.player.express('laugh', 0.9);
    this.swarmLoop?.stop(0.2);
    this.swarmLoop = this.ctx.audio.loop('swarm_loop', 0.7);
    this.ctx.toast('LOCUST SWARM', '#c8d870');
  }

  private updateSwarm(dt: number) {
    this.bugBatch.begin();
    if (this.swarmT > 0) {
      this.swarmT -= dt;
      const c = this.player.center(new THREE.Vector3());
      const t = performance.now() / 1000;
      for (const b of this.swarmBugs) {
        b.a += b.sp * dt;
        if (b.dive > 0) {
          b.dive -= dt;
          if (b.target && b.target.alive) {
            _v.set(b.target.pos.x, b.target.pos.y + b.target.height * 0.6, b.target.pos.z);
            b.p.lerp(_v, Math.min(1, dt * 8));
            if (b.p.distanceTo(_v) < 0.6 && rnd.chance(dt * 4)) {
              this.ctx.enemies.damage(b.target, { base: 2.2, kind: 'magic', source: 'swarm', status: [{ id: 'slow', stacks: 1, dur: 1 }, { id: 'bleed', stacks: 1, dur: 2, chance: 0.15 }], canCrit: false });
            }
          } else b.dive = 0;
        } else {
          const tx = c.x + Math.cos(b.a) * b.r, ty = c.y + b.h + Math.sin(t * 3 + b.a) * 0.3, tz = c.z + Math.sin(b.a) * b.r;
          b.p.lerp(_v.set(tx, ty, tz), Math.min(1, dt * 6));
          if (rnd.chance(dt * 1.2)) {
            b.target = this.ctx.enemies.nearest(c, 9);
            if (b.target) b.dive = 1.2;
          }
        }
        const frame = Math.floor(t * 20 + b.a * 3) % 2 === 0 ? 'fly0' : 'locust';
        this.bugBatch.push(b.p.x, b.p.y, b.p.z, frame, 0.12, 0.12, 0, 0xffffff);
      }
      if (this.swarmT <= 0) {
        this.swarmLoop?.stop(0.6);
        this.swarmLoop = null;
      }
    }
    this.bugBatch.end(this.ctx.world.env.fog);
  }

  // ----------------------------------------------------------- dung bomb
  throwBomb(echo = false) {
    if (!echo) {
      this.bombCharges--;
      if (this.bombRecharge <= 0) this.bombRecharge = this.constants.bombRecharge * (1 - this.stats.get('cdr'));
    }
    const o = this.player.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0));
    const aim = this.player.aimPoint;
    const jit = echo ? 1.6 : 0;
    const dx = aim.x - o.x + (rnd.next() - 0.5) * jit, dz = aim.z - o.z + (rnd.next() - 0.5) * jit;
    const d = Math.min(30, Math.hypot(dx, dz)) || 1;
    const T = 0.5 + d / 30;
    const v = new THREE.Vector3((dx / Math.hypot(dx, dz)) * (d / T), 5 + d * 0.18, (dz / Math.hypot(dx, dz)) * (d / T));
    v.add(this.player.board.vel.clone().multiplyScalar(0.6));
    this.bombs.push({ pos: o, vel: v, fuse: 1.5, spin: 0, bounces: 0 });
    this.ctx.sfx('whoosh', o, 0.7);
    this.ctx.sfx('dynamite_fuse', o, 0.5);
    this.player.playAction('lob', 0.45);
  }

  private updateBombs(dt: number) {
    const ctx = this.ctx;
    while (this.bombPool.length < this.bombs.length) {
      const m = this.bombMesh.clone();
      ctx.scene.add(m);
      this.bombPool.push(m);
    }
    for (let i = 0; i < this.bombPool.length; i++) this.bombPool[i].visible = i < this.bombs.length;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.fuse -= dt;
      b.vel.y -= 20 * dt;
      b.pos.addScaledVector(b.vel, dt);
      const g = ctx.world.groundAt(b.pos.x, b.pos.z) + 0.15;
      if (b.pos.y < g) {
        b.pos.y = g;
        if (b.vel.y < -2) {
          b.vel.y *= -0.42;
          b.bounces++;
          ctx.sfx('dung_kick', b.pos, 0.4);
          ctx.fx.sandBurst(b.pos, 0.25);
        } else b.vel.y = 0;
        // roll downhill
        const n = new THREE.Vector3();
        ctx.world.normal(b.pos.x, b.pos.z, n);
        b.vel.x += n.x * 9 * dt;
        b.vel.z += n.z * 9 * dt;
        b.vel.x *= 1 - dt * 1.2;
        b.vel.z *= 1 - dt * 1.2;
      }
      b.spin += dt * Math.hypot(b.vel.x, b.vel.z) * 3;
      if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.25, z: b.pos.z }, count: 1, vel: { x: 0, y: 1, z: 0 }, spread: 0.6, life: [0.15, 0.3], size: [0.06, 0.02], sprite: 'spark', additive: true, color: 0xffc060 });
      const mesh = this.bombPool[i];
      mesh.position.copy(b.pos);
      mesh.rotation.set(b.spin, b.spin * 0.6, 0);
      if (b.fuse <= 0) {
        const r = 4.2 * this.stats.get('explosionRadius');
        ctx.fx.explosion(b.pos, r * 0.75);
        ctx.fx.word(b.pos, r > 5 ? 'w_kaboom' : 'w_boom');
        ctx.sfx('explosion', b.pos, 1);
        ctx.shake(0.35);
        const dmg = 40;
        ctx.events.emit('explosion', { x: b.pos.x, y: b.pos.y, z: b.pos.z }, r, dmg, 'player');
        ctx.enemies.inRadius(b.pos, r, (e) => ctx.enemies.damage(e, { base: 0.01, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 5, dur: 5, power: 2.4 }, { id: 'burn', stacks: 1, dur: 3, power: 1.5 }], canCrit: false }));
        this.clouds.push({ pos: b.pos.clone(), r: r * 0.8, life: 3.5, tick: 0 });
        ctx.fx.poisonCloud(b.pos, r * 0.7);
        this.bombs.splice(i, 1);
      }
    }
  }

  private updateClouds(dt: number) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= dt;
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick = 0.5;
        this.ctx.enemies.inRadius(c.pos, c.r, (e) => this.ctx.enemies.damage(e, { base: 0.01, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 1, dur: 3, power: 2 }], canCrit: false }));
        if (this.ctx.world) this.ctx.fx.poisonCloud(c.pos, c.r * 0.5);
      }
      if (c.life <= 0) this.clouds.splice(i, 1);
    }
  }

  // ----------------------------------------------------------- Pinch
  private updatePinch(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const shoulder = pl.rig.sockets['shoulder_l'];
    const hand = pl.rig.sockets['hand_r'];
    const home = new THREE.Vector3();
    if (shoulder) shoulder.getWorldPosition(home);
    else pl.center(home).add(new THREE.Vector3(0, 0.5, 0));
    this.pinchT += dt;
    this.pinchCd -= dt;
    const reload = pl.reload.active;
    if (reload && (this.pinchState === 'shoulder' || this.pinchState === 'return')) {
      this.pinchState = 'reload';
      this.pinchT = 0;
      this.pinch?.setExpression('determined');
    }
    switch (this.pinchState) {
      case 'shoulder': {
        this.pinchPos.copy(home);
        this.pinchRoot.quaternion.copy(pl.root.quaternion);
        this.pinchRoot.rotateY(Math.sin(this.pinchT * 1.3) * 0.3);
        if (this.pinchCd <= 0 && pl.alive) {
          const t = ctx.enemies.nearest(pl.pos, 9, (e) => !e.flying);
          if (t) {
            this.pinchTarget = t;
            this.pinchState = 'leap';
            this.pinchT = 0;
            this.pinchFrom.copy(home);
            ctx.sfx('scorpion_chitter', home, 0.5, 1.3);
            this.pinch?.setExpression('angry');
          }
        }
        break;
      }
      case 'leap': {
        const t = this.pinchTarget;
        if (!t || !t.alive) {
          this.pinchState = 'return';
          this.pinchT = 0;
          break;
        }
        const k = clamp(this.pinchT / 0.45, 0, 1);
        const to = _v.set(t.pos.x, t.pos.y + t.height * 0.7, t.pos.z);
        this.pinchPos.lerpVectors(this.pinchFrom, to, k);
        this.pinchPos.y += Math.sin(k * Math.PI) * 2;
        this.pinchRoot.lookAt(to.x, this.pinchPos.y, to.z);
        if (k >= 1) {
          this.pinchState = 'sting';
          this.pinchT = 0;
        }
        break;
      }
      case 'sting': {
        const t = this.pinchTarget;
        if (!t || !t.alive || this.pinchT > 1.6) {
          this.pinchState = 'return';
          this.pinchT = 0;
          this.pinchFrom.copy(this.pinchPos);
          break;
        }
        this.pinchPos.set(t.pos.x, t.pos.y + t.height * 0.75, t.pos.z);
        const st = Math.floor(this.pinchT / 0.5);
        if (Math.floor((this.pinchT - dt) / 0.5) !== st || this.pinchT === dt) {
          ctx.enemies.damage(t, { base: 8, kind: 'magic', source: 'scorpion', status: [{ id: 'poison', stacks: 3, dur: 4, power: 2.4 }], canCrit: true }, this.pinchPos.clone());
          ctx.sfx('scorpion_sting', this.pinchPos, 0.5);
        }
        break;
      }
      case 'return': {
        const k = clamp(this.pinchT / 0.4, 0, 1);
        this.pinchPos.lerpVectors(this.pinchFrom, home, k);
        this.pinchPos.y += Math.sin(k * Math.PI) * 1.5;
        if (k >= 1) {
          this.pinchState = 'shoulder';
          this.pinchCd = 3.2 / (1 + this.stats.get('magic') * 0.03);
          this.pinch?.setExpression('happy');
          ctx.engine.tweens.after(1, () => this.pinch?.setExpression('neutral'));
        }
        break;
      }
      case 'reload': {
        const gun = new THREE.Vector3();
        if (hand) hand.getWorldPosition(gun);
        else gun.copy(home);
        this.pinchPos.lerp(gun.add(new THREE.Vector3(0, 0.12 + Math.abs(Math.sin(this.pinchT * 18)) * 0.05, 0)), Math.min(1, dt * 14));
        if (!reload) {
          this.pinchState = 'return';
          this.pinchT = 0;
          this.pinchFrom.copy(this.pinchPos);
        }
        break;
      }
    }
    this.pinchRoot.position.copy(this.pinchPos);
    // pinch idle animation
    if (this.pinch) {
      const n = this.pinch.nodes;
      const t = this.pinchT;
      const busy = this.pinchState === 'sting' || this.pinchState === 'reload';
      for (let k = 1; k <= 5; k++) if (n['tail' + k]) n['tail' + k].rotation.x = -0.3 - (busy ? Math.sin(t * 20) * 0.25 : Math.sin(t * 2 + k) * 0.05);
      if (n['pincer_l']) n['pincer_l'].rotation.y = -Math.max(0, Math.sin(t * (busy ? 16 : 3))) * 0.5;
      if (n['pincer_r']) n['pincer_r'].rotation.y = Math.max(0, Math.sin(t * (busy ? 16 : 3) + 1)) * 0.5;
      for (let k = 1; k <= 4; k++) {
        if (n['leg_l' + k]) n['leg_l' + k].rotation.z = Math.sin(t * 12 + k) * (this.pinchState === 'leap' ? 0.4 : 0.05);
        if (n['leg_r' + k]) n['leg_r' + k].rotation.z = -Math.sin(t * 12 + k) * (this.pinchState === 'leap' ? 0.4 : 0.05);
      }
    }
    void damp;
  }

  cooldowns() {
    return {
      scorp: Math.max(0, this.scorpCd),
      swarm: Math.max(0, this.swarmCd),
      bomb: this.bombCharges > 0 ? 0 : Math.max(0, this.bombRecharge),
      bombCharges: this.bombCharges,
    };
  }
}
