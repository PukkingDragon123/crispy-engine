// Boss framework: full (non-instanced) voxel rigs with expression faces and
// cloth capes, weak-point hit spheres, multi-phase coroutine move scripts
// that cancel safely on death/escape, telegraphed attack helpers, QTE hooks,
// dramatic intros, escapes and deaths.
import * as THREE from 'three';
import type { Ctx, RayHit } from '../Ctx';
import type { ExternalTarget, Enemies } from '../enemies/Enemies';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { StatusSet, StatusResist } from '../combat/Status';
import { Hit, resolveHit } from '../combat/Damage';
import type { Player } from '../player/Player';
import type { Qte, QteResult } from '../ui/Qte';
import type { CameraRig } from '../player/CameraRig';
import { modelEntry } from '../models/lookup';
import { placeholderHumanoid } from '../models/placeholder';
import { Cloth, ClothRenderer } from '../../engine/physics/Cloth';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { Spring } from '../../engine/Tween';
import { RigEyes, EyeStyle } from '../fx/FaceFx';
import { Voice, voiceFor } from '../audio/Voice';

export class Cancelled extends Error {}

export interface HitSphere {
  node: string;
  offset?: [number, number, number];
  r: number;
  part: string;
  weak?: number; // damage multiplier
}

export interface BossDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  qte: Qte;
  cam: CameraRig;
  cloth: ClothRenderer;
}

let BOSS_ID = 900000;
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export abstract class Boss implements ExternalTarget {
  id = BOSS_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 1;
  height = 3;
  alive = true;
  isBoss = true;
  hp: number;
  maxHp: number;
  name: string;
  title: string;
  flying = false;
  status = new StatusSet();
  armor = 30;
  physRes = 0.1;
  magicRes = 0.15;
  statusRes: StatusResist = {};
  rig: RigInstance;
  root = new THREE.Group();
  yaw = 0;
  phase = 0;
  phases = [0.66, 0.33];
  escaped = false;
  invulnerable = false;
  frontGuard = 0; // >0: frontal damage multiplier while guarding
  guarding = false;
  hitSpheres: HitSphere[] = [];
  bounty = 150;
  gold = 80;
  expr = 'neutral';
  protected t = 0;
  protected flash = 0;
  protected squash = new Spring(1, 160, 11);
  protected hitT = 9;
  protected hitDir = new THREE.Vector3();
  protected running = false;
  protected cape: Cloth | null = null;
  protected anim = { walk: 0, wind: 0, strike: 0, lean: 0, jaw: 0, aimL: 0, aimR: 0, spin: 0 };
  onDefeated?: (b: Boss, escaped: boolean) => void;
  eyes: RigEyes;
  protected moveTarget: THREE.Vector3 | null = null;
  protected moveSpeed = 0;
  scale = 1;

  constructor(public d: BossDeps, rigKey: string, opts: { name: string; title: string; hp: number; scale?: number; eyes?: [EyeStyle, number] }) {
    this.name = opts.name;
    this.title = opts.title;
    this.maxHp = this.hp = opts.hp;
    this.scale = opts.scale ?? 1;
    const e = modelEntry(rigKey);
    let spec = e?.() as RigSpec | undefined;
    if (!spec?.parts) spec = placeholderHumanoid(0x9a6a4a);
    this.rig = new RigInstance(buildRigGeo(spec, 'boss:' + rigKey), { ownMaterial: true });
    this.root.add(this.rig.root);
    this.root.scale.setScalar(this.scale);
    this.eyes = new RigEyes(this.rig, opts.eyes?.[0] ?? 'glow', opts.eyes?.[1] ?? 0xff5a2a);
    this.height = (spec.meta?.height ?? 3) * this.scale;
    this.radius = (spec.meta?.radius ?? 0.8) * this.scale;
    d.ctx.scene.add(this.root);
    // cloth cape
    const cc = spec.meta?.cloth?.cape as number[] | undefined;
    const anchor = this.rig.sockets['cape_anchor'];
    if (cc && anchor) {
      const W = 7;
      const cape = new Cloth({ w: W, h: 12, width: 0.9 * this.scale, length: 1.5 * this.scale, colors: cc, pattern: 'cape', fray: 0.35, stiffness: 0.9, drag: 2 });
      cape.groundAt = (x, z) => d.ctx.world.groundAt(x, z);
      d.cloth.add(cape);
      this.cape = cape;
    }
    this.setExpr((spec.meta?.defaultExpression as string) ?? 'neutral');
  }

  get ctx() {
    return this.d.ctx;
  }
  get player() {
    return this.d.player;
  }
  get frac() {
    return this.hp / this.maxHp;
  }

  place(x: number, z: number, yaw = 0) {
    this.pos.set(x, this.ctx.world.groundAt(x, z), z);
    this.yaw = yaw;
  }

  setExpr(e: string) {
    this.expr = e;
    this.rig.setExpression(e);
  }

  // ------------------------------------------------------------- coroutine helpers
  protected check() {
    if (!this.alive || this.escaped) throw new Cancelled();
  }
  async wait(s: number) {
    this.check();
    await this.ctx.engine.tweens.wait(s);
    this.check();
  }
  /** walk/run to a point (resolves on arrival or timeout) */
  async moveTo(x: number, z: number, speed: number, timeout = 4) {
    this.moveTarget = new THREE.Vector3(x, 0, z);
    this.moveSpeed = speed;
    const t0 = this.t;
    while (this.moveTarget && this.t - t0 < timeout) {
      await this.wait(0.05);
      if (Math.hypot(this.pos.x - x, this.pos.z - z) < 1.2) break;
    }
    this.moveTarget = null;
  }
  stop() {
    this.moveTarget = null;
  }
  faceTarget(p: THREE.Vector3, rate = 99, dt = 1) {
    const ty = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = rate >= 99 ? ty : dampAngle(this.yaw, ty, rate, dt);
  }
  playerPos() {
    return this.player.pos;
  }
  distToPlayer() {
    return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }
  /** telegraphed AoE: warning ring → impact */
  async slam(at: THREE.Vector3, r: number, dmg: number, warn = 0.8, kind: 'sand' | 'venom' | 'fire' | 'curse' = 'sand') {
    const ctx = this.ctx;
    const y = ctx.world.groundAt(at.x, at.z);
    const p = { x: at.x, y: y + 0.15, z: at.z };
    const steps = Math.max(1, Math.round(warn / 0.25));
    for (let i = 0; i < steps; i++) {
      ctx.fx.ring(p, kind === 'venom' ? 0x8fe03a : kind === 'curse' ? 0xb07ae0 : 0xff6a3a, r * 2, 0.3);
      ctx.particles.emit({ pos: p, count: 6, spread: r * 0.4, up: 1, life: [0.3, 0.6], size: [0.15, 0.3], sprite: ['puff0', 'puff1'], color: 0xe0c08a, alpha: 0.6, jitter: r * 0.7 });
      await this.wait(warn / steps);
    }
    ctx.fx.sandBurst(p, r * 0.6);
    ctx.fx.dust(p, r * 0.5, 0xe6cf9f, 6);
    ctx.sfx('explosion', p, 0.8, 0.8);
    ctx.shake(0.35);
    ctx.world.deform(at.x, at.z, r * 0.4, 0.5);
    if (kind === 'venom') {
      ctx.fx.poisonCloud(p, r * 0.7);
      ctx.events.emit('groundMark', at.x, at.z, r, 3);
    } else ctx.events.emit('groundMark', at.x, at.z, r * 0.8, 1);
    const pd = Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z);
    if (pd < r && this.player.pos.y < y + 2.5) this.player.takeHit({ base: dmg, kind: kind === 'curse' || kind === 'venom' ? 'magic' : 'phys', source: 'contact', knock: 9, status: kind === 'venom' ? [{ id: 'poison', stacks: 6, dur: 5 }] : kind === 'curse' ? [{ id: 'curse', stacks: 4, dur: 6 }] : undefined }, new THREE.Vector3(at.x, y, at.z));
  }
  /** projectile pattern from a socket/offset */
  fire(kind: Parameters<Enemies['proj']['pattern']>[0], o: Parameters<Enemies['proj']['pattern']>[3], from?: THREE.Vector3) {
    const src = from ?? new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    this.d.enemies.proj.pattern(kind, src, this.player.center(new THREE.Vector3()), { ...o, sourceId: this.id });
  }
  summon(type: string, n: number, r = 6, emerge: 'sand' | 'run' = 'sand') {
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2;
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      if (this.ctx.world.storm.sdf(x, z) < 3) continue;
      this.d.enemies.spawn(type, x, z, { emerge });
    }
  }
  taunt(text: string, color = '#ffb070') {
    this.ctx.toast(`${this.name}: “${text}”`, color);
    Voice.say(voiceFor(this.name), text, { pos: this.pos, follow: true, key: `boss:${this.id}` });
  }
  async qte(spec: Parameters<Qte['run']>[0]): Promise<QteResult> {
    this.check();
    const eng = this.ctx.engine;
    eng.slowMo(0.15, 30);
    // the prompt floats over the boss unless the caller anchored it elsewhere
    const r = await this.d.qte.run({ ...spec, at: spec.at ?? (() => ({ x: this.pos.x, y: this.pos.y + this.height * 0.6, z: this.pos.z })) });
    eng.slowMo(1, 6);
    this.check();
    return r;
  }

  // ------------------------------------------------------------- lifecycle
  /** main fight script; subclasses implement phase loops */
  protected abstract fight(): Promise<void>;
  /** intro choreography (camera + pose); override for custom */
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    const look = new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const camPos = look.clone().addScaledVector(dir, this.height * 1.6 + 4).add(new THREE.Vector3(0, this.height * 0.2, 0));
    camPos.y = Math.max(camPos.y, ctx.world.groundAt(camPos.x, camPos.z) + 1.8);
    ctx.engine.letterbox(true, 0.5);
    cam.setCine({ pos: camPos, look, fov: 48 });
    this.setExpr('smug');
    ctx.sfx('boss_roar', this.pos, 1);
    ctx.shake(0.5);
    ctx.events.emit('bossIntro', this);
    await ctx.engine.tweens.wait(2.4);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.setExpr('angry');
  }

  async start() {
    this.running = true;
    try {
      await this.intro();
      await this.fight();
    } catch (e) {
      if (!(e instanceof Cancelled)) console.error(e);
    }
  }

  // ------------------------------------------------------------- targeting API
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || this.escaped) return null;
    let best: RayHit | null = null;
    let bt = maxT;
    const spheres = this.hitSpheres.length ? this.hitSpheres : [{ node: '', r: this.radius, part: 'torso', offset: [0, this.height * 0.5, 0] as [number, number, number] }];
    for (const s of spheres) {
      const c = this.sphereCenter(s, _v);
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - s.r * s.r * this.scale * this.scale;
      const disc = b * b - cc;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: (s.weak ?? 1) > 1.2, part: s.part, surface: 'enemy' };
    }
    return best;
  }

  private sphereCenter(s: HitSphere, out: THREE.Vector3) {
    const n = s.node ? this.rig.nodes[s.node] : null;
    if (n) {
      out.set(...(s.offset ?? [0, 0, 0]));
      n.localToWorld(out);
    } else {
      out.set(this.pos.x, this.pos.y + (s.offset?.[1] ?? this.height * 0.5), this.pos.z);
    }
    return out;
  }

  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive || this.escaped || this.invulnerable) {
      if (point && this.invulnerable) this.ctx.fx.hit(point, { x: 0, y: 1, z: 0 }, 'armor', 0.6);
      return 0;
    }
    let mult = 1;
    const sphere = this.hitSpheres.find((s) => s.part === hit.tags?.[0]);
    if (sphere?.weak) mult *= sphere.weak;
    if (this.guarding && this.frontGuard > 0 && dir) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      if (fx * dir.x + fz * dir.z < -0.3) {
        mult *= this.frontGuard;
        if (point) this.ctx.fx.hit(point, { x: -dir.x, y: 0.3, z: -dir.z }, 'armor', 1);
        this.ctx.sfx('counter_clang', this.pos, 0.4, 1.2);
      }
    }
    const res = resolveHit(this.player.stats, { ...hit, mult: (hit.mult ?? 1) * mult }, { hp: this.hp, maxHp: this.maxHp, armor: this.armor, physRes: this.physRes, magicRes: this.magicRes, statusRes: this.statusRes, status: this.status, isBoss: true }, this.player.speed);
    const amt = res.amount;
    this.hp -= amt;
    this.flash = 1;
    this.hitT = 0;
    if (dir) this.hitDir.copy(dir);
    this.squash.kick(-2);
    const pp = point ?? new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    if (hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      this.ctx.fx.hit(pp, { x: -(dir?.x ?? 0), y: 0.5, z: -(dir?.z ?? 0) }, this.hitKind(), res.crit ? 1.6 : 1);
      this.ctx.sfx('hit_armor', pp, 0.5);
      if (rnd.chance(0.12)) this.ctx.sfx('boss_hurt', this.pos, 0.6);
    }
    this.ctx.fx.number({ x: pp.x, y: pp.y + 0.4, z: pp.z }, amt, res.crit ? 0xffd040 : hit.source === 'poison' ? 0x9dff3a : 0xffffff, res.crit ? 1.5 : 1.15);
    this.ctx.events.emit('enemyHit', this, hit, amt, res);
    if (rnd.chance(0.2) && this.expr !== 'enraged') {
      this.setExpr('hurt');
      this.ctx.engine.tweens.after(0.4, () => this.alive && this.setExpr(this.phase >= 2 ? 'enraged' : 'angry'));
    }
    // phases
    const f = this.frac;
    while (this.phase < this.phases.length && f <= this.phases[this.phase]) {
      this.phase++;
      this.onPhase(this.phase);
    }
    if (this.hp <= 0) this.die();
    return amt;
  }

  protected hitKind(): any {
    return 'bone';
  }

  /** called on phase change (1, 2...) */
  protected onPhase(p: number) {
    this.ctx.shake(0.5);
    this.ctx.sfx('boss_roar', this.pos, 1, 0.9 + p * 0.05);
    this.setExpr(p >= 2 ? 'enraged' : 'angry');
    this.ctx.toast(p >= 2 ? 'ENRAGED' : 'PHASE ' + (p + 1), '#ff6a3a');
    this.ctx.events.emit('bossPhase', this, p);
  }

  /** escape mid-fight (recurring bosses) */
  async escape(line: string) {
    if (this.escaped || !this.alive) return;
    this.escaped = true;
    this.invulnerable = true;
    const ctx = this.ctx;
    this.setExpr('laugh');
    this.taunt(line);
    ctx.sfx('boss_laugh', this.pos, 1);
    ctx.particles.emit({ pos: { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, count: 40, spread: 5, up: 2, life: [2, 3.5], size: [1.5, 4], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x8a8478, 0x6e685e, 0xb0a490], alpha: 0.95, drag: 1.2, rot: 6, rotSpeed: 0.5, jitter: 2 });
    ctx.sfx('smoke_bomb', this.pos, 1);
    await ctx.engine.tweens.wait(1.2);
    this.root.visible = false;
    if (this.cape) this.cape.enabled = false;
    this.ctx.toast(`${this.name.toUpperCase()} ESCAPED`, '#ffb070', 'He will be back… stronger.', true);
    this.alive = false;
    this.onDefeated?.(this, true);
    this.dispose();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    this.setExpr('defeated');
    ctx.engine.slowMo(0.15, 30);
    ctx.engine.tweens.after(1.2, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1);
    ctx.shake(0.9);
    ctx.engine.flash(0xfff2d0, 0.35, 0.6);
    const c = { x: this.pos.x, y: this.pos.y + this.height * 0.5, z: this.pos.z };
    // crumble: debris from every part
    this.ctx.events.emit('bossShatter', this);
    for (let i = 0; i < 4; i++) ctx.engine.tweens.after(i * 0.25, () => {
      ctx.fx.explosion({ x: c.x + (rnd.next() - 0.5) * this.radius * 2, y: c.y + (rnd.next() - 0.5) * this.height * 0.5, z: c.z + (rnd.next() - 0.5) * this.radius * 2 }, 2 + this.scale);
    });
    ctx.engine.tweens.after(1.1, () => {
      this.root.visible = false;
      if (this.cape) this.cape.enabled = false;
      ctx.fx.coins(c, 40);
      this.onDefeated?.(this, false);
      this.dispose();
    });
    ctx.events.emit('bossKilled', this);
  }

  // ------------------------------------------------------------- per-frame
  update(dt: number) {
    if (!this.root.visible && !this.alive) return;
    this.t += dt;
    this.hitT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    // statuses
    const tick = this.status.tick(dt, this.maxHp, this.vel.lengthSq() > 1, true);
    if (tick && this.alive) {
      if (tick.poison > 0) this.takeDamage({ base: tick.poison, kind: 'magic', source: 'poison', canCrit: false });
      if (this.alive && tick.burn > 0) this.takeDamage({ base: tick.burn, kind: 'magic', source: 'burn', canCrit: false });
      if (this.alive && tick.bleed > 0) this.takeDamage({ base: tick.bleed, kind: 'phys', source: 'bleed', canCrit: false });
    }
    // movement toward target
    const g = this.ctx.world.groundAt(this.pos.x, this.pos.z);
    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.pos.x, dz = this.moveTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = this.moveSpeed * this.status.slowMul();
      this.vel.x = damp(this.vel.x, (dx / d) * sp, 6, dt);
      this.vel.z = damp(this.vel.z, (dz / d) * sp, 6, dt);
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 5, dt);
      this.vel.z = damp(this.vel.z, 0, 5, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (!this.flying) this.pos.y = damp(this.pos.y, g, 20, dt);
    // keep inside storm
    const sd = this.ctx.world.storm.sdf(this.pos.x, this.pos.z);
    if (sd < 3) {
      const inw = this.ctx.world.storm.inward(this.pos.x, this.pos.z, { x: 0, z: 0 });
      this.pos.x += inw.x * (3 - sd) * dt * 3;
      this.pos.z += inw.z * (3 - sd) * dt * 3;
    }
    this.squash.update(1, dt);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);
    const sq = this.squash.x;
    this.root.scale.set(this.scale * Math.sqrt(2 - sq), this.scale * sq, this.scale * Math.sqrt(2 - sq));
    this.animate(dt);
    if (this.ctx.faces && this.root.visible) {
      this.root.updateMatrixWorld(true);
      this.eyes.lookAt(this.player.center(_v));
      this.eyes.draw(this.ctx.faces, dt);
    }
    const fx = this.rig.material.userData.fx.value;
    fx.x = this.flash * 0.7;
    // cape anchors
    if (this.cape) {
      const a = this.rig.sockets['cape_anchor'];
      const p = new THREE.Vector3();
      a.getWorldPosition(p);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion()));
      const W = this.cape.anchors.length;
      for (let i = 0; i < W; i++) this.cape.anchors[i].copy(p).addScaledVector(side, (i / (W - 1) - 0.5) * 0.9 * this.scale);
      this.cape.wind.set(this.ctx.world.sa.wind.x * 3 - this.vel.x, 0.5, this.ctx.world.sa.wind.z * 3 - this.vel.z);
    }
    // contact damage
    if (this.alive && !this.escaped && this.distToPlayer() < this.radius + 0.5 && Math.abs(this.player.pos.y - this.pos.y) < this.height) {
      if (this.player.speed > 14) {
        this.takeDamage({ base: this.player.speed * 1.2, kind: 'phys', source: 'board', knock: 0 });
        this.player.board.vel.multiplyScalar(-0.4);
        this.ctx.shake(0.3);
      } else if (this.t % 1 < dt) this.player.takeHit({ base: 12, kind: 'phys', source: 'contact', knock: 10 }, this.pos);
    }
  }

  /** procedural animation hook */
  protected animate(dt: number) {
    const n = this.rig.nodes;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim.walk += dt * (2 + sp * 1.4);
    const w = this.anim.walk;
    const stride = clamp(sp / 4, 0, 1.2);
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    if (n['thigh_l']) {
      n['thigh_l'].rotation.x = -Math.sin(w) * 0.6 * stride;
      n['thigh_r'].rotation.x = Math.sin(w) * 0.6 * stride;
      if (n['shin_l']) n['shin_l'].rotation.x = Math.max(0, Math.sin(w + 1.3)) * 0.8 * stride;
      if (n['shin_r']) n['shin_r'].rotation.x = Math.max(0, Math.sin(w + 1.3 + Math.PI)) * 0.8 * stride;
    }
    if (n['torso']) n['torso'].rotation.set(0.1 * stride - this.anim.wind * 0.4 + this.anim.strike * 0.5 - hitK * 0.3, Math.sin(w) * 0.12 * stride, Math.sin(this.t * 0.8) * 0.04);
    if (n['head']) n['head'].rotation.set(Math.sin(this.t * 1.1) * 0.05 + hitK * 0.3, Math.sin(this.t * 0.7) * 0.15, 0);
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, this.rig.exprJaw + this.anim.jaw, 14, dt);
    if (n['brow_l']) n['brow_l'].rotation.z = damp(n['brow_l'].rotation.z, this.rig.exprBrow[0], 12, dt);
    if (n['brow_r']) n['brow_r'].rotation.z = damp(n['brow_r'].rotation.z, this.rig.exprBrow[1], 12, dt);
    // arms: aim blends (gun bosses) or swing
    if (n['arm_r']) n['arm_r'].rotation.set(-1.45 * this.anim.aimR + (1 - this.anim.aimR) * (Math.sin(w) * 0.4 * stride) + this.anim.wind * 1.8 - this.anim.strike * 2.2, 0, -0.15);
    if (n['arm_l']) n['arm_l'].rotation.set(-1.45 * this.anim.aimL + (1 - this.anim.aimL) * (-Math.sin(w) * 0.4 * stride), 0, 0.15);
    this.anim.strike = Math.max(0, this.anim.strike - dt * 3);
  }

  dispose() {
    this.root.removeFromParent();
    if (this.cape) this.d.cloth.remove(this.cape);
    this.d.enemies.unregisterExternal(this);
  }
}
