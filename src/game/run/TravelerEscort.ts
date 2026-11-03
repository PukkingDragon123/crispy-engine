// Escort quest: Doc Hapi — the snake-oil peddler from the trail stories — and
// his pack camel are walking to the trading post with a load of tonics, and
// half the desert wants a taste. Ride up and offer an escort [T]; he sets off
// on foot, cowers when trouble gets close, calls you back if you wander, and
// the ambushers that come for him are real enemies that hunt HIM (Enemies
// `focus`). Get him to the trading post alive: bounty, gold, his best tonics.
//
// Also exports HumanNpc, the procedural humanoid NPC animator (walk, idle,
// cower, wave, hat-tip, jig, sit, death) WagonRepair reuses.
//
// INTEGRATION (RunScene — this module does not touch it):
//   import { TravelerEscort } from '../run/TravelerEscort';
//   field:     escort: TravelerEscort | null = null;
//   enter() (or later, e.g. after a wave clears):
//                const route = TravelerEscort.findRoute(this.ctx, this.props, this.player.pos, ['tradingPost', 'saloon', 'ranchBarn']);
//                if (route) this.escort = new TravelerEscort({ ctx: this.ctx, player: this.player, enemies: this.enemies,
//                  inter: this.inter, choice: this.choice, items: this.items, cloth: this.cloth, addBounty: (v) => this.addBounty(v),
//                  card: () => this.picker.request() }, route.start, route.dest, route.name);
//              (landmarks are built per zone: if findRoute returns null, try again after unlockZone()).
//   update():  after this.inter.update(e.input):   this.escort?.update(dt);
//              if (this.escort?.finished) { this.escort.dispose(); this.escort = null; }
//   updateHud(): ...(this.missions.active ? this.missions.hud() : this.escort?.hud() ?? this.missions.hud())
//   exit():    this.escort?.dispose();
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Enemies, FocusTarget } from '../enemies/Enemies';
import type { Interactions, Interactable } from './Interact';
import type { Choice } from '../ui/Choice';
import type { Inventory } from '../player/Items';
import type { Props } from '../world/Props';
import type { ClothRenderer } from '../../engine/physics/Cloth';
import { Garments } from '../player/Garments';
import { modelEntry } from '../models/lookup';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { SpringF } from '../anim/spring';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();

// =================================================================== HumanNpc
export type NpcMode = 'idle' | 'walk' | 'cower' | 'wave' | 'tip' | 'cheer' | 'sit' | 'dead';

/** pick a cowboy look for an NPC that is not the hunter's own */
export function npcLook(player: Player, prefs: string[]) {
  const mine = player.rig.geo.spec.name;
  for (const k of prefs) if (k !== mine && modelEntry(k)) return k;
  return prefs[0];
}

/**
 * A walking, talking humanoid NPC on a live rig (pelvis → torso → head/jaw/hat,
 * arms, legs). Set `mode`, `vel` (for the walk cycle) and `look`; call update().
 */
export class HumanNpc {
  rig: RigInstance;
  root = new THREE.Group();
  pos: THREE.Vector3;
  yaw: number;
  vel = new THREE.Vector3();
  mode: NpcMode = 'idle';
  /** world point to look at (head + upper body follow) */
  look: THREE.Vector3 | null = null;
  /** seconds of jaw chatter left (talking) */
  talk = 0;
  height = 1.75;
  private t = rnd.next() * 10;
  private phase = 0;
  private modeW: Record<NpcMode, number> = { idle: 1, walk: 0, cower: 0, wave: 0, tip: 0, cheer: 0, sit: 0, dead: 0 };
  private flinch = new SpringF(0, 3.2, 0.35);
  private flinchS = new SpringF(0, 3.2, 0.35);
  private headY = new SpringF(0, 2.2, 0.8);
  private deadT = 0;
  private rest: Record<string, THREE.Euler> = {};
  private restP: Record<string, THREE.Vector3> = {};
  /** engine cloth (bandana tail, coat tails) when a ClothRenderer is supplied */
  private garments: Garments | null = null;

  constructor(private ctx: Ctx, key: string, at: THREE.Vector3, yaw = 0, cloth?: ClothRenderer) {
    let spec = modelEntry(key)?.() as RigSpec | undefined;
    if (!spec?.parts) spec = modelEntry('cowboy_stetson_vest')?.() as RigSpec;
    this.rig = new RigInstance(buildRigGeo(spec, key + ':npc'), { castShadow: true });
    this.height = (spec.meta?.height as number) ?? 1.75;
    for (const p of this.rig.geo.parts) {
      this.rest[p.name] = p.rest.clone();
      this.restP[p.name] = p.offset.clone();
    }
    this.root.add(this.rig.root);
    this.pos = at.clone();
    this.yaw = yaw;
    this.root.position.copy(at);
    ctx.scene.add(this.root);
    if (cloth) {
      try {
        this.garments = new Garments(this.rig, cloth, ctx.world.groundAt);
      } catch (e) {
        console.warn('[npc] cloth failed', e);
      }
    }
  }

  /** a hit: the body jerks away from `from` */
  hit(from: THREE.Vector3) {
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    const lz = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / l;
    const lx = (dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw)) / l;
    this.flinch.kick(lz * 9);
    this.flinchS.kick(-lx * 9);
  }

  private R(name: string, x: number, y = 0, z = 0) {
    const n = this.rig.nodes[name];
    const r = this.rest[name];
    if (n && r) n.rotation.set(r.x + x, r.y + y, r.z + z);
  }

  update(dt: number) {
    const t = (this.t += dt);
    for (const k of Object.keys(this.modeW) as NpcMode[]) this.modeW[k] = damp(this.modeW[k], this.mode === k ? 1 : 0, k === 'dead' ? 6 : 5, dt);
    const W = this.modeW;
    this.flinch.step(0, dt);
    this.flinchS.step(0, dt);
    this.talk = Math.max(0, this.talk - dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const walkK = W.walk * clamp(sp / 1.2, 0, 1.3);
    this.phase += (sp / 1.25) * dt * Math.PI;
    const ph = this.phase;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const breath = Math.sin(t * 1.4) * 0.025;
    // ---- legs: walk cycle, cower crouch, sitting, jig kicks
    const crouch = W.cower * 0.9;
    const jig = W.cheer;
    const kickL = Math.max(0, Math.sin(t * 8)), kickR = Math.max(0, Math.sin(t * 8 + Math.PI));
    this.R('thigh_l', -sn * 0.48 * walkK - crouch - W.sit * 1.45 - jig * kickL * 0.85 + W.dead * 0.25, 0, 0.05 * W.sit + 0.12 * W.dead);
    this.R('thigh_r', sn * 0.48 * walkK - crouch - W.sit * 1.45 - jig * kickR * 0.85 + W.dead * 0.1, 0, -0.05 * W.sit - 0.08 * W.dead);
    this.R('shin_l', Math.max(0, Math.sin(ph + 1.15)) * 0.8 * walkK + crouch * 1.55 + jig * kickL * 1.2 + W.dead * 0.3);
    this.R('shin_r', Math.max(0, Math.sin(ph + 1.15 + Math.PI)) * 0.8 * walkK + crouch * 1.55 + jig * kickR * 1.2 + W.dead * 0.5);
    // ---- pelvis: bob and sway with the stride, sinks for the crouch / the sit
    const pel = this.rig.nodes['pelvis'];
    const p0 = this.restP['pelvis'];
    if (pel && p0) {
      const hipY = p0.y;
      const bob = Math.abs(cs) * 0.035 * walkK + (jig > 0.01 ? Math.abs(Math.sin(t * 8)) * 0.07 * jig : 0);
      pel.position.set(p0.x, p0.y + bob - crouch * hipY * 0.38 - W.sit * hipY * 0.72, p0.z);
    }
    this.R('pelvis', 0.04 * walkK + W.sit * 0.0, sn * 0.08 * walkK, sn * 0.04 * walkK + (jig > 0.01 ? Math.sin(t * 4) * 0.08 * jig : 0));
    // ---- torso: counter-twist, hunch when cowering, flinch, lean back sitting
    this.R('torso', 0.06 * walkK + W.cower * 0.55 - W.sit * 0.12 + breath + this.flinch.x * 0.05 - W.dead * 0.1, -sn * 0.1 * walkK + (jig > 0.01 ? Math.sin(t * 4) * 0.15 * jig : 0), this.flinchS.x * 0.05);
    // ---- arms: swing, cover the head, wave, tip the hat, throw them up for the jig
    const tremble = W.cower * Math.sin(t * 41) * 0.04;
    const wave = Math.sin(t * 9) * 0.45;
    this.R('arm_l', sn * 0.38 * walkK - W.cower * 2.3 - W.sit * 0.35 - jig * 0.25 + tremble, 0, 0.1 + W.cower * 0.55 + jig * 2.2 + W.sit * 0.2 + W.dead * 0.9);
    this.R('fore_l', -0.22 - Math.max(0, sn) * 0.25 * walkK - W.cower * 1.5 - jig * 0.4);
    this.R('arm_r', -sn * 0.38 * walkK - W.cower * 2.3 - W.tip * 2.35 - W.wave * 0.3 - W.sit * 0.35 - jig * 0.25 - tremble, 0, -0.1 - W.cower * 0.55 - W.wave * 2.45 - jig * 2.2 - W.sit * 0.2 - W.dead * 0.9);
    this.R('fore_r', -0.22 - Math.max(0, -sn) * 0.25 * walkK - W.cower * 1.5 - W.tip * 1.35 - W.wave * 0.35 - jig * 0.4, 0, W.wave * wave);
    // ---- head: looks at its target, ducks when cowering, nods with the hat tip
    let wantY = 0;
    if (this.look) {
      const dx = this.look.x - this.pos.x, dz = this.look.z - this.pos.z;
      const lx = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
      const lz = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
      wantY = clamp(Math.atan2(lx, Math.max(0.2, lz)), -1, 1);
    } else wantY = Math.sin(t * 0.4) * 0.35;
    this.headY.step(wantY * (1 - W.cower) * (1 - W.dead), dt);
    this.R('head', Math.sin(t * 1.1) * 0.03 + W.cower * 0.45 + W.tip * 0.25 + this.flinch.x * 0.08 - W.dead * 0.2 + (jig > 0.01 ? Math.sin(t * 8) * 0.06 * jig : 0), this.headY.x * 0.75, jig > 0.01 ? Math.sin(t * 4) * 0.12 * jig : W.wave * 0.12);
    const jaw = this.rig.nodes['jaw'];
    if (jaw) jaw.rotation.x = damp(jaw.rotation.x, this.rig.exprJaw + (this.talk > 0 ? Math.abs(Math.sin(t * 13)) * 0.22 : 0) + W.cower * 0.15 + jig * 0.2 + W.dead * 0.35, 14, dt);
    // the hat lifts off the skull for the tip
    const hat = this.rig.nodes['hat'];
    const h0 = this.restP['hat'];
    if (hat && h0) {
      hat.position.set(h0.x, h0.y + W.tip * 0.035, h0.z + W.tip * 0.02);
      this.R('hat', -W.tip * 0.35);
    }
    if (this.rig.nodes['coat']) this.R('coat', -Math.abs(sn) * 0.08 * walkK - W.sit * 0.9 + W.cower * 0.3);
    // ---- the body: placed on the ground, falls flat on its back when dead
    if (this.mode === 'dead') this.deadT += dt;
    const fall = W.dead;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    this.rig.root.rotation.set(-1.42 * Math.min(1, fall * 1.1), 0, 0);
    this.rig.root.position.set(0, 0.12 * fall, 0);
    if (this.garments) {
      this.root.updateMatrixWorld(true);
      const w = this.ctx.world.sa.wind;
      this.garments.update(w.x * 3, w.z * 3, this.vel);
    }
  }

  dispose() {
    this.garments?.dispose();
    this.root.removeFromParent();
  }
}

/** a simple pack-camel walker (pace gait: both legs on a side swing together) */
class PackCamel {
  rig: RigInstance | null = null;
  root = new THREE.Group();
  pos: THREE.Vector3;
  yaw = 0;
  vel = new THREE.Vector3();
  private t = rnd.next() * 10;
  private phase = 0;
  constructor(ctx: Ctx, at: THREE.Vector3) {
    this.pos = at.clone();
    const spec = modelEntry('camel')?.() as RigSpec | undefined;
    if (spec?.parts) {
      this.rig = new RigInstance(buildRigGeo(spec, 'camel:escort'), { castShadow: true });
      this.root.add(this.rig.root);
    }
    ctx.scene.add(this.root);
  }
  update(dt: number, groundAt: (x: number, z: number) => number) {
    this.t += dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.phase += (sp / 1.6) * dt * Math.PI;
    const k = clamp(sp / 1.4, 0, 1);
    const s = Math.sin(this.phase);
    const n = this.rig?.nodes ?? {};
    // pacing: left pair, then right pair
    n['leg_fl']?.rotation.set(s * 0.42 * k, 0, 0);
    n['leg_bl']?.rotation.set(s * 0.38 * k, 0, 0);
    n['leg_fr']?.rotation.set(-s * 0.42 * k, 0, 0);
    n['leg_br']?.rotation.set(-s * 0.38 * k, 0, 0);
    n['body']?.rotation.set(0, 0, s * 0.05 * k);
    n['neck']?.rotation.set(Math.sin(this.phase * 2) * 0.06 * k + Math.sin(this.t * 0.7) * 0.04, Math.sin(this.t * 0.4) * 0.1, 0);
    n['head']?.rotation.set(Math.sin(this.t * 1.1) * 0.05, Math.sin(this.t * 0.6) * 0.15, 0);
    if (n['jaw']) n['jaw'].rotation.x = Math.abs(Math.sin(this.t * 2.6)) * 0.08;
    if (n['tail']) n['tail'].rotation.z = Math.sin(this.t * 2.3) * 0.35;
    this.root.position.set(this.pos.x, groundAt(this.pos.x, this.pos.z) + Math.abs(Math.cos(this.phase)) * 0.03 * k, this.pos.z);
    this.root.rotation.y = this.yaw;
  }
  dispose() {
    this.root.removeFromParent();
  }
}

// =================================================================== escort
export interface EscortDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  inter: Interactions;
  addBounty(v: number): void;
  /** offer card (otherwise the escort starts on the first [T]) */
  choice?: Choice;
  /** reward items */
  items?: Inventory;
  /** reward upgrade card */
  card?(): void;
  /** RunScene.cloth: gives the NPC a fluttering bandana */
  cloth?: ClothRenderer;
}

type Phase = 'waiting' | 'walking' | 'arrived' | 'failed';

export class TravelerEscort {
  /**
   * start 90-140 m out from a landmark door (a trading post by default), on the hunter's side, inside
   * the storm. Pass more landmark types as fallbacks, e.g. ['tradingPost', 'saloon', 'ranchBarn'].
   */
  static findRoute(ctx: Ctx, props: Props, near: THREE.Vector3, types: string[] = ['tradingPost']): { start: THREE.Vector3; dest: THREE.Vector3; name: string } | null {
    const storm = ctx.world.storm;
    let best: { start: THREE.Vector3; dest: THREE.Vector3; score: number; name: string } | null = null;
    for (const lm of props.landmarks) {
      const ti = types.indexOf(lm.extra?.type as string);
      if (ti < 0) continue;
      const meta = lm.extra?.meta ?? {};
      const ent = meta.entrance as [number, number] | undefined;
      const fp = meta.footprint as [number, number] | undefined;
      const door = ent ? props.landmarkPoint(lm, ent[0], ent[1]) : props.landmarkPoint(lm, 0, (fp?.[1] ?? 12) * 0.5 + 2);
      const out = new THREE.Vector3(door.x - lm.anchor.x, 0, door.z - lm.anchor.z).normalize();
      const dest = door.clone().addScaledVector(out, 3);
      dest.y = ctx.world.groundAt(dest.x, dest.z);
      const toNear = Math.atan2(near.x - dest.x, near.z - dest.z);
      for (let k = 0; k < 16; k++) {
        const a = toNear + (rnd.next() - 0.5) * 1.6;
        const L = 90 + rnd.next() * 50;
        let ok = true;
        for (let s = 10; s <= L && ok; s += 10) if (storm.sdf(dest.x + Math.sin(a) * s, dest.z + Math.cos(a) * s) < 7) ok = false;
        if (!ok) continue;
        const start = new THREE.Vector3(dest.x + Math.sin(a) * L, 0, dest.z + Math.cos(a) * L);
        start.y = ctx.world.groundAt(start.x, start.z);
        // earlier types in the list win; then the closest start to the hunter
        const score = ti * 1000 + start.distanceTo(near);
        const name = ti === 0 && types[0] === 'tradingPost' ? 'the trading post' : ((lm.anchor.data?.name as string) ?? 'town');
        if (!best || score < best.score) best = { start, dest, score, name };
      }
    }
    return best ? { start: best.start, dest: best.dest, name: best.name } : null;
  }

  name = 'Doc Hapi';
  phase: Phase = 'waiting';
  npc: HumanNpc;
  camel: PackCamel | null = null;
  hp: number;
  maxHp: number;
  /** done (arrived or failed): dispose() it */
  finished = false;
  private inter: Interactable;
  private target: FocusTarget;
  private t = 0;
  private ambushIn = 9;
  private ambushes = 0;
  private hurtCd = 0;
  private callCd = 0;
  private calm = 0;
  private stuckT = 0;
  private sideStep = 0;
  private lastPos = new THREE.Vector3();
  private endT = 0;
  private startLen = 1;
  private busy = false;

  /** destName: shown in the objective ("to the trading post") */
  constructor(private d: EscortDeps, private start: THREE.Vector3, private dest: THREE.Vector3, private destName = 'the trading post') {
    const ctx = d.ctx;
    start.y = ctx.world.groundAt(start.x, start.z);
    // a vest look: no long coat tails that would need engine cloth
    const key = npcLook(d.player, ['cowboy_tophat_vest', 'cowboy_bandit_vest', 'cowboy_stetson_vest']);
    this.npc = new HumanNpc(ctx, key, start, Math.atan2(dest.x - start.x, dest.z - start.z), d.cloth);
    const behind = start.clone().add(new THREE.Vector3(-Math.sin(this.npc.yaw) * 3, 0, -Math.cos(this.npc.yaw) * 3));
    this.camel = new PackCamel(ctx, behind);
    this.camel.yaw = this.npc.yaw;
    const wave = Math.max(1, ctx.run.wave);
    this.maxHp = this.hp = 260 + wave * 12;
    this.startLen = Math.max(1, Math.hypot(dest.x - start.x, dest.z - start.z));
    const self = this;
    this.target = {
      get pos() {
        return self.npc.pos;
      },
      get alive() {
        return self.phase === 'walking' && self.hp > 0;
      },
      radius: 0.45,
      height: 1.7,
      hurt: (dmg, from) => this.hurt(dmg, from),
    };
    this.inter = { pos: this.npc.pos, radius: 6, label: `Talk to ${this.name}`, enabled: true, promptY: 2.2, use: () => void this.offer() };
    d.inter.add(this.inter);
    this.lastPos.copy(start);
  }

  // ------------------------------------------------------------- verbs
  private async offer() {
    if (this.phase !== 'waiting' || this.busy) return;
    const ctx = this.d.ctx;
    this.npc.talk = 1.6;
    ctx.sfx('merchant_greet', this.npc.pos, 0.6, 1.25);
    const reward = 60 + Math.max(1, ctx.run.wave) * 5;
    if (this.d.choice && !this.d.choice.active) {
      this.busy = true;
      try {
        const pick = await this.d.choice.show(`${this.name}'s Traveling Tonics`, [
          { title: 'Ride Shotgun', body: `"Partner! Walk me and Clementine to the trading post? Every varmint from here to the river smells my tonics." Keep him alive all the way.`, footer: `Reward: ${reward} bounty · gold · Snake Oil ×2`, stamp: 'ESCORT', accent: '#2a6a7a' },
          { title: 'Ride On', body: 'He tips his hat anyway. "Suit yourself. I\'ll take my chances with the wolves."', footer: 'Walk away' },
        ]);
        if (pick !== 0) {
          this.npc.mode = 'tip';
          ctx.engine.tweens.after(1.2, () => this.phase === 'waiting' && (this.npc.mode = 'wave'));
          return;
        }
      } finally {
        this.busy = false;
      }
    }
    this.begin();
  }

  private begin() {
    const ctx = this.d.ctx;
    this.phase = 'walking';
    this.inter.enabled = false;
    this.npc.mode = 'walk';
    this.npc.talk = 1.2;
    this.ambushIn = 7;
    ctx.toast(`ESCORT ${this.name.toUpperCase()}`, '#ffd36b', `Get him to ${this.destName} alive`, true);
    ctx.sfx('poster_slam', null, 0.8);
  }

  private hurt(dmg: number, from: THREE.Vector3) {
    if (this.phase !== 'walking') return;
    const ctx = this.d.ctx;
    this.hp -= dmg;
    this.calm = 0;
    this.npc.hit(from);
    const c = { x: this.npc.pos.x, y: this.npc.pos.y + 1.2, z: this.npc.pos.z };
    ctx.fx.hit(c, { x: this.npc.pos.x - from.x, y: 0.4, z: this.npc.pos.z - from.z }, 'bone', 0.8);
    ctx.fx.number(c, dmg, 0xff8a6a, 0.85);
    ctx.sfx('hit_bone', c, 0.6);
    if (this.hurtCd <= 0 && this.hp > 0) {
      this.hurtCd = 4;
      this.npc.talk = 0.8;
      ctx.toast(`${this.name.toUpperCase()} IS HIT`, '#ff8a6a', `${Math.max(0, Math.round((this.hp / this.maxHp) * 100))}% health — get them off him!`);
    }
    if (this.hp <= 0) this.fail();
  }

  private fail() {
    if (this.phase !== 'walking') return;
    const ctx = this.d.ctx;
    this.phase = 'failed';
    this.hp = 0;
    this.npc.mode = 'dead';
    this.npc.vel.set(0, 0, 0);
    if (this.camel) this.camel.vel.set(0, 0, 0);
    ctx.toast(`${this.name.toUpperCase()} DIDN'T MAKE IT`, '#ff6a3a', 'The tonics spill into the sand.', true);
    ctx.sfx('sting_negative', null, 0.8);
    ctx.sfx('glass_break', this.npc.pos, 0.8);
    ctx.particles.emit({ pos: { x: this.npc.pos.x, y: this.npc.pos.y + 0.6, z: this.npc.pos.z }, count: 16, spread: 2, up: 2, life: [0.4, 0.9], size: [0.07, 0.04], sprite: ['dot3', 'bubble'], color: [0x9a5a2a, 0xc07a42, 0x86c48a], gravity: 12, ground: true });
  }

  private arrive() {
    const ctx = this.d.ctx;
    const pl = this.d.player;
    this.phase = 'arrived';
    this.npc.mode = 'tip';
    this.npc.vel.set(0, 0, 0);
    if (this.camel) this.camel.vel.set(0, 0, 0);
    this.npc.talk = 2;
    const wave = Math.max(1, ctx.run.wave);
    const bounty = 60 + wave * 5, gold = 40 + wave * 3;
    this.d.addBounty(bounty);
    ctx.run.gold += gold;
    ctx.run.totalGold += gold;
    ctx.fx.coins({ x: this.npc.pos.x, y: this.npc.pos.y + 1.2, z: this.npc.pos.z }, 12);
    ctx.toast('SAFE AND SOUND', '#9dff3a', `${this.name} made it · +${bounty} bounty · +${gold} gold`, true);
    ctx.sfx('sting_positive', null, 0.9);
    ctx.sfx('merchant_greet', this.npc.pos, 0.8, 1.2);
    if (this.d.items) {
      const ok = this.d.items.add('snakeoil', 2);
      ctx.engine.tweens.after(1.4, () => ctx.toast(ok ? "DOC HAPI'S SNAKE OIL ×2" : 'POCKETS FULL', ok ? '#9dff3a' : '#ff8a6a', ok ? '"On the house, partner."' : 'He keeps the tonics for next time'));
    }
    if (this.d.card && this.ambushes >= 2 && this.hp > this.maxHp * 0.6) ctx.engine.tweens.after(2.4, () => this.d.card?.());
    ctx.engine.tweens.after(1.6, () => this.phase === 'arrived' && (this.npc.mode = 'cheer'));
    void pl;
  }

  // ------------------------------------------------------------- ambushes
  private ambush() {
    const ctx = this.d.ctx;
    const wave = Math.max(1, ctx.run.wave);
    this.ambushes++;
    const pool = wave < 6 ? ['husk', 'husk', 'sandWolf'] : wave < 12 ? ['sandWolf', 'husk', 'thornyLizard', 'gunslinger'] : ['sandWolf', 'outlaw', 'thornyLizard', 'gunslinger', 'jackal'];
    const kind = rnd.pick(pool);
    const n = kind === 'sandWolf' ? 3 + Math.floor(wave / 10) : kind === 'outlaw' || kind === 'jackal' ? 2 : 3 + Math.floor(wave / 8);
    const p = this.npc.pos;
    const fwd = Math.atan2(this.dest.x - p.x, this.dest.z - p.z);
    const a0 = fwd + (rnd.next() - 0.5) * 2.4;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + (rnd.next() - 0.5) * 0.9, r = 18 + rnd.next() * 8;
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (ctx.world.storm.sdf(x, z) < 4) continue;
      // most of them want the tonics; the rest want the hunter
      const e = this.d.enemies.spawn(kind, x, z, { emerge: kind === 'husk' ? 'sand' : 'run', focus: rnd.chance(0.65) ? this.target : null });
      if (e) spawned++;
    }
    if (spawned) {
      ctx.toast('AMBUSH!', '#ff8a4a', `They're after ${this.name}'s tonics`);
      ctx.sfx('wave_start', p, 0.5, 1.2);
      this.npc.talk = 1;
    }
  }

  // ------------------------------------------------------------- update
  update(dt: number) {
    if (this.finished) return;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    const npc = this.npc;
    this.t += dt;
    this.hurtCd -= dt;
    this.callCd -= dt;
    const pd = Math.hypot(pl.pos.x - npc.pos.x, pl.pos.z - npc.pos.z);
    npc.look = pl.pos;
    if (this.phase === 'waiting') {
      // flags the hunter down when he rides by
      npc.mode = pd < 30 ? 'wave' : 'idle';
      npc.yaw = dampAngle(npc.yaw, Math.atan2(pl.pos.x - npc.pos.x, pl.pos.z - npc.pos.z), pd < 30 ? 2 : 0.3, dt);
      if (pd < 30 && this.callCd <= 0) {
        this.callCd = 9;
        npc.talk = 1.2;
        ctx.sfx('merchant_greet', npc.pos, 0.5, 1.25);
      }
    } else if (this.phase === 'walking') {
      this.walk(dt, pd);
      // enemy shots aimed at him only stop when they hit him
      const c = _v.set(npc.pos.x, npc.pos.y + 1.0, npc.pos.z);
      for (const q of this.d.enemies.proj.list) {
        if (q.owner !== 'enemy' || q.life <= 0) continue;
        if (Math.hypot(q.x - c.x, q.z - c.z) < 0.5 + q.r && Math.abs(q.y - c.y) < 1.0) {
          q.life = 0;
          this.hurt(q.dmg * 0.8, new THREE.Vector3(q.x - q.vx * 0.1, q.y, q.z - q.vz * 0.1));
          if (this.phase !== 'walking') break;
        }
      }
      // breathing room heals: a swig of his own tonic
      this.calm += dt;
      if (this.calm > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02 * dt);
      // the road gets busier the closer he gets
      this.ambushIn -= dt;
      if (this.ambushIn <= 0) {
        this.ambush();
        this.ambushIn = 16 + rnd.next() * 8 - Math.min(6, this.ambushes);
      }
    } else {
      this.endT += dt;
      npc.vel.set(0, 0, 0);
      if (this.phase === 'arrived') {
        npc.yaw = dampAngle(npc.yaw, Math.atan2(pl.pos.x - npc.pos.x, pl.pos.z - npc.pos.z), 2, dt);
        if (this.endT > 30 && pd > 40) this.finished = true;
      } else if (this.endT > 20 && pd > 40) this.finished = true;
    }
    npc.pos.y = ctx.world.groundAt(npc.pos.x, npc.pos.z);
    npc.update(dt);
    if (this.camel) this.followCamel(dt);
  }

  private walk(dt: number, pd: number) {
    const ctx = this.d.ctx;
    const npc = this.npc;
    const dx = this.dest.x - npc.pos.x, dz = this.dest.z - npc.pos.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 4.5) return this.arrive();
    // trouble nearby: he cowers until it is dealt with
    let danger = 0;
    for (const e of this.d.enemies.list) {
      if (!e.alive) continue;
      const ed = Math.hypot(e.pos.x - npc.pos.x, e.pos.z - npc.pos.z);
      if (ed < 7) danger = Math.max(danger, 1 - ed / 7);
    }
    const waiting = pd > 26;
    if (danger > 0.15) {
      npc.mode = 'cower';
      this.calm = 0;
      if (this.callCd <= 0) {
        this.callCd = 7;
        npc.talk = 1;
        ctx.sfx('merchant_greet', npc.pos, 0.5, 1.5);
      }
      npc.vel.multiplyScalar(Math.exp(-8 * dt));
    } else if (waiting) {
      npc.mode = 'wave';
      npc.vel.multiplyScalar(Math.exp(-6 * dt));
      if (this.callCd <= 0) {
        this.callCd = 10;
        npc.talk = 1.4;
        ctx.toast(`${this.name.toUpperCase()}`, '#ffd36b', '"Partner? Don\'t leave me out here!"');
      }
    } else {
      npc.mode = 'walk';
      let ux = dx / dl, uz = dz / dl;
      // stuck on a prop: step sideways for a moment
      if (this.sideStep > 0) {
        this.sideStep -= dt;
        const s = this.sideStep > 0.6 ? 1 : -1;
        ux = ux * 0.3 - uz * s;
        uz = uz * 0.3 + (dx / dl) * s;
      }
      const sd = ctx.world.storm.sdf(npc.pos.x, npc.pos.z);
      if (sd < 4) {
        const inw = ctx.world.storm.inward(npc.pos.x, npc.pos.z, { x: 0, z: 0 });
        ux += inw.x * (4 - sd) * 0.3;
        uz += inw.z * (4 - sd) * 0.3;
      }
      const ul = Math.hypot(ux, uz) || 1;
      const spd = 2.5;
      npc.vel.x = damp(npc.vel.x, (ux / ul) * spd, 4, dt);
      npc.vel.z = damp(npc.vel.z, (uz / ul) * spd, 4, dt);
    }
    npc.pos.x += npc.vel.x * dt;
    npc.pos.z += npc.vel.z * dt;
    const r = ctx.world.colliders.resolve(npc.pos.x, npc.pos.z, npc.pos.y, 1.7, 0.4, { x: 0, z: 0, nx: 0, nz: 0, hit: null });
    npc.pos.x += r.x;
    npc.pos.z += r.z;
    const sp = Math.hypot(npc.vel.x, npc.vel.z);
    if (sp > 0.3) npc.yaw = dampAngle(npc.yaw, Math.atan2(npc.vel.x, npc.vel.z), 5, dt);
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (npc.mode === 'walk' && this.lastPos.distanceTo(npc.pos) < 0.6 && this.sideStep <= 0) this.sideStep = 1.4;
      this.lastPos.copy(npc.pos);
      this.stuckT = 0;
    }
    void TAU;
  }

  private followCamel(dt: number) {
    const c = this.camel!;
    const ctx = this.d.ctx;
    const npc = this.npc;
    const dx = npc.pos.x - c.pos.x, dz = npc.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = d > 3.2 ? Math.min(3, (d - 3.2) * 2) : 0;
    c.vel.x = damp(c.vel.x, (dx / d) * want, 3, dt);
    c.vel.z = damp(c.vel.z, (dz / d) * want, 3, dt);
    c.pos.x += c.vel.x * dt;
    c.pos.z += c.vel.z * dt;
    const r = ctx.world.colliders.resolve(c.pos.x, c.pos.z, c.pos.y, 2.2, 0.7, { x: 0, z: 0, nx: 0, nz: 0, hit: null });
    c.pos.x += r.x;
    c.pos.z += r.z;
    if (Math.hypot(c.vel.x, c.vel.z) > 0.2) c.yaw = dampAngle(c.yaw, Math.atan2(c.vel.x, c.vel.z), 3, dt);
    c.update(dt, ctx.world.groundAt);
  }

  // ------------------------------------------------------------- hud
  hud(): { objective: { text: string; sub: string } | null; marker: THREE.Vector3 | null } | null {
    if (this.phase !== 'walking') return null;
    const left = Math.round(Math.hypot(this.dest.x - this.npc.pos.x, this.dest.z - this.npc.pos.z));
    const hpPct = Math.max(0, Math.round((this.hp / this.maxHp) * 100));
    return {
      objective: { text: `Escort ${this.name}`, sub: `to ${this.destName} — ${left} m · ${hpPct}% health${this.npc.mode === 'cower' ? ' · under attack!' : ''}` },
      marker: this.npc.pos.clone().setY(this.npc.pos.y + 2.6),
    };
  }

  /** progress along the road, 0..1 */
  get progress() {
    return 1 - Math.hypot(this.dest.x - this.npc.pos.x, this.dest.z - this.npc.pos.z) / this.startLen;
  }

  dispose() {
    // harassers still chasing him go back to the hunter
    for (const e of this.d.enemies.list) if (e.focus === this.target) e.focus = null;
    this.d.inter.remove(this.inter);
    this.npc.dispose();
    this.camel?.dispose();
    this.finished = true;
  }
}
