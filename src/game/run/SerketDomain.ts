// SERKET'S DOMAIN (new game, STORY-B): the forced tutorial, played for real inside the run.
// Her ring floats high over the start of the ride (the desert far below is lost in her night fog): a disc
// of slate with a riding bowl round its rim, megaliths, drifting shards, scorpion constellations overhead.
// While it is up the world's ground, normal, slope and surface answer for the ring (restored after).
//   1. she marks the HUD, one piece at a time: a ring of glyphs and her jade stinger point at it, its
//      name floats beside it in 3D (heart, bullets, tarot cards, the ultimate card, bounty bar, hourglass)
//   2. the board: ride and carve, a jump, the SHIFT charged jump, a flip in the air (BOARD worker's events,
//      each step with a timeout so it always moves on), and a word on balance
//   3. shooting (three skulls rise from the slate), reloading, a skill (she lends THE SUN), the ultimate
//   4. she summons a SOUL SCORPION (spectral, boss-lite: claws, a telegraphed tail strike with a ring on the
//      floor, volleys of soul shards, skitter dashes; it never kills him, she will not let it). Put it down.
//   5. the scorpion's soul goes up into the stars; she shrinks back into Pinch, who climbs up Sundown's leg,
//      coat and collar onto his hat, whispers, and the domain opens onto the first desert day
// Every step's goal hangs in the air as 3D text; all her words are floating 3D text. No 2D boxes.
// Events listened for on the run's bus: 'jump', 'chargeJump', 'flip', 'trick', 'wipeout', 'boardRecovered',
// 'skillCast', 'cast', 'ultimate', 'propShot'. Also the board's onJump callback (charge >= 0.3 = charged).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import type { ExternalTarget } from '../enemies/Enemies';
import type { Hit } from '../combat/Damage';
import type { RayHit } from '../Ctx';
import type { Collider } from '../world/Colliders';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { FloatText3D, type FloatTextOpts } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { GlyphRings, SandVortex, SerketSpirit, guideSpot, spiritMaterial, spiritMotes, spiritShell } from '../fx/SerketSpirit';
import { PinchMotion } from '../player/PinchMotion';
import { PINCH_PERCH_SCALE } from '../player/PinchPerch';
import { Skills } from '../player/Skills';
import { isTouchDevice } from '../ui/TouchControls';
import { PRESETS } from '../world/Env';
import { realScorpionRig } from '../models/enemies/real/rscorpion';
import { chitin } from '../models/enemies/real/rk';
import { ARENA, arenaProfile, arenaSlope, soulShard, stingerPointer } from '../models/props/serketDomain';
import { buildArena, DomainSky, setMaterial, setUniforms, type Arena } from '../cine/DomainSet';

const TOUCH = isTouchDevice();
const tk = (keys: string, touch: string) => (TOUCH ? touch : keys);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const JADE = '#c8ffe4', JADE_GLOW = '#2fd88a';
const KEYS = '#fff3d6', KEY_GLOW = '#8a5a2a';
/** how high the ring floats over the start of the ride */
const LIFT = 240;

type Wait = number | (() => boolean);
type Script = Generator<Wait, void, number>;
export type MarkId = 'heart' | 'bullets' | 'cards' | 'ult' | 'bounty' | 'hourglass';

/** where each HUD piece sits when the HUD does not say (fractions of the screen) */
const MARK_FALLBACK: Record<MarkId, [number, number]> = { heart: [0.08, 0.86], bullets: [0.84, 0.72], cards: [0.8, 0.88], ult: [0.93, 0.86], bounty: [0.5, 0.06], hourglass: [0.92, 0.13] };
/** the hud.anchors keys to try for each piece (HUD and TIME workers' anchors first) */
const MARK_KEYS: Record<MarkId, string[]> = { heart: ['heart'], bullets: ['bullets', 'cyl'], cards: ['cards', 'tarot', 'deck'], ult: ['ultCard', 'ult'], bounty: ['bounty', 'bountyBar'], hourglass: ['hourglass', 'clock', 'time'] };

const MARKS: { id: MarkId; label: string; line: string }[] = [
  { id: 'heart', label: 'YOUR HEART', line: 'Your heart. While it beats, you ride. Let it run dry and Anubis gets to weigh it.' },
  { id: 'bullets', label: 'BULLETS', line: 'Six rounds riding on your cards. Count them. The dead will not wait while you fumble.' },
  { id: 'cards', label: 'TAROT CARDS', line: 'The tarot. Every card is a skill of yours. More wake when you rank up.' },
  { id: 'ult', label: 'THE ULTIMATE', line: 'And this card is me. When it burns bright, call me, and I come in person.' },
  { id: 'bounty', label: 'BOUNTY', line: 'The bounty bar. Every soul you put down fills it. Fill it and you rank up.' },
  { id: 'hourglass', label: 'THE HOURGLASS', line: 'The hourglass. Days run through it, the waves ride in on it, and the nights bite harder.' },
];

export interface DomainHost {
  engine: any;
  ctx: Ctx;
  player: Player;
  camRig: CameraRig;
  hud: any;
  world: any;
  scene: THREE.Scene;
  enemies: any;
  skills?: Skills;
  ult?: { active: boolean };
}

interface Goal {
  label: string;
  done: boolean;
  text: FloatText3D;
}

// =============================================================================================== the soul scorpion
class SoulScorpion implements ExternalTarget {
  id = -77001;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius: number;
  height: number;
  alive = true;
  isBoss = true;
  hp = 560;
  maxHp = 560;
  name = 'Soul Scorpion';
  title = "Serket's Keepsake";
  rig: RigInstance;
  private mat = spiritMaterial();
  private shell = spiritShell();
  private light = new THREE.PointLight(0x6affd8, 0, 9, 2);
  private len: number;
  yaw = 0;
  form = 0;
  private t = 0;
  private gaitPh = 0;
  private state: 'rise' | 'stalk' | 'claw' | 'tail' | 'volley' | 'skitter' | 'dead' = 'rise';
  private stT = 0;
  private cd = 1.6;
  private hitFlash = 0;
  private strikeAt = new THREE.Vector3();
  private marker: GlyphRings;
  private skitTo = new THREE.Vector3();
  private shards: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private shardGeo: THREE.BufferGeometry;
  private shardMat = makeVoxelMaterial();
  private struck = false;
  /** the first tail strike: she warns him once */
  onFirstTail: (() => void) | null = null;
  deadT = 0;

  constructor(private d: SerketDomain, at: THREE.Vector3) {
    const spec = realScorpionRig({ name: 'soul_scorpion', vs: 1 / 36, k: 1.45, shell: chitin(0x86c8b8, 0xe2fff4, 1 / 36, 9, { cell: 0.24, punct: 0.03 }), shellLight: 0xd8fff0, dark: 0x1e5a4c, tailTip: 0x163a34, telson: 0x6affc4 });
    this.rig = new RigInstance(buildRigGeo(spec, 'soul_scorpion'), { material: this.mat, castShadow: true });
    for (const m of Object.values(this.rig.meshes)) {
      const s = new THREE.Mesh(m.geometry, this.shell);
      s.renderOrder = 6;
      m.add(s);
    }
    (this.shell.uniforms.uA.value as THREE.Color).set(0x3affd0);
    (this.shell.uniforms.uB.value as THREE.Color).set(0xf0fffa);
    const meta = spec.meta ?? {};
    this.height = (meta.height as number) ?? 1.7;
    this.radius = (meta.radius as number) ?? 1.2;
    this.len = (meta.length as number) ?? 3.4;
    this.rig.root.add(this.light);
    this.light.position.set(0, this.height * 0.5, 0);
    d.ctx.scene.add(this.rig.root);
    this.pos.copy(at);
    this.marker = new GlyphRings(d.ctx.scene, [{ radius: 2.3, y: 0.05, count: 12, speed: 2.4, tilt: [0, 0] }], 2.0);
    this.marker.appear = 0;
    this.marker.fade = 0;
    const sh = soulShard();
    this.shardGeo = buildVoxelGeometry(sh.model, { voxelSize: sh.voxelSize, pivot: 'center' });
  }

  private fwd(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  update(dt: number) {
    this.t += dt;
    const d = this.d, pl = d.player, ctx = d.ctx;
    const toP = pl.pos.clone().sub(this.pos).setY(0);
    const dist = toP.length();
    const want = Math.atan2(toP.x, toP.z);
    const phase2 = this.hp < this.maxHp * 0.5;
    this.stT += dt;
    this.cd -= dt;
    let speed = 0;
    let turnK = 4;
    let tailStrike = 0, claw = 0, rear = 0;
    switch (this.state) {
      case 'rise':
        this.form = Math.min(1, this.form + dt * 0.6);
        if (this.form >= 1) this.go('stalk');
        break;
      case 'stalk': {
        // circle him at striking range, closing in when he strays
        const side = Math.sin(this.t * 0.7) > 0 ? 1 : -1;
        const pref = 5.5;
        const dir = toP.clone().normalize();
        const tang = V(dir.z * side, 0, -dir.x * side);
        const mv = dir.multiplyScalar(THREE.MathUtils.clamp((dist - pref) * 0.6, -1, 1)).addScaledVector(tang, 0.6);
        speed = (phase2 ? 5.6 : 4.4) * Math.min(1, mv.length());
        this.vel.lerp(mv.normalize().multiplyScalar(speed), 1 - Math.exp(-dt * 4));
        if (this.cd <= 0) {
          if (dist < 4.6) this.go('claw');
          else if (dist > 16) this.go('skitter');
          else if (Math.random() < 0.5) this.go('tail');
          else this.go('volley');
        }
        break;
      }
      case 'claw': {
        claw = Math.min(1, this.stT / 0.5);
        this.vel.multiplyScalar(Math.exp(-dt * 6));
        if (this.stT > 0.5 && !this.struck) {
          this.struck = true;
          d.sfx('scorpion_sting', this.pos, 0.9, 0.8);
          const f = this.fwd();
          if (dist < 5.2 && toP.normalize().dot(f) > 0.2) d.hurt(12, this.pos, 7);
          ctx.fx.sandBurst(this.pos.clone().addScaledVector(f, 2), 0.5, 0x9dffd8);
        }
        if (this.stT > 0.9) this.go('stalk', phase2 ? 0.9 : 1.4);
        break;
      }
      case 'tail': {
        const tel = phase2 ? 0.7 : 0.95;
        rear = Math.min(1, this.stT / tel);
        this.vel.multiplyScalar(Math.exp(-dt * 5));
        if (!this.entered) {
          this.entered = true;
          this.strikeAt.copy(pl.pos);
          this.strikeAt.y = d.groundAt(this.strikeAt.x, this.strikeAt.z);
          this.marker.group.position.copy(this.strikeAt).add(V(0, 0.08, 0));
          this.marker.appear = 0;
          this.marker.fade = 1;
          this.onFirstTail?.();
          this.onFirstTail = null;
          d.sfx('spectral_scorpion', this.pos, 0.6, 1.2);
        }
        this.marker.appear = Math.min(1, this.marker.appear + dt * 3);
        if (this.stT > tel && !this.struck) {
          this.struck = true;
          tailStrike = 1;
          d.sfx('explosion', this.strikeAt, 0.6, 1.4);
          d.ctx.shake(0.35);
          ctx.fx.ring(this.strikeAt, 0x7affd8, 4.5, 0.5);
          ctx.fx.sandBurst(this.strikeAt, 0.9, 0x9dffd8);
          spiritMotes(ctx.particles, this.strikeAt, 10, 1.2, 2);
          if (pl.pos.distanceTo(this.strikeAt) < 2.6) d.hurt(16, this.strikeAt, 9);
          this.marker.fade = 0;
        }
        if (this.stT > tel) tailStrike = Math.max(0, 1 - (this.stT - tel) / 0.5);
        if (this.stT > tel + 0.6) {
          if (phase2 && !this.d.flags.double) {
            this.d.flags.double = true;
            this.go('tail');
          } else {
            this.d.flags.double = false;
            this.go('stalk', phase2 ? 1.0 : 1.6);
          }
        }
        break;
      }
      case 'volley': {
        rear = Math.min(0.6, this.stT * 1.5);
        this.vel.multiplyScalar(Math.exp(-dt * 5));
        const n = phase2 ? 5 : 3;
        if (this.stT > 0.4 + this.fired * 0.22 && this.fired < n) {
          this.fired++;
          this.fire();
        }
        if (this.stT > 0.5 + n * 0.22) this.go('stalk', phase2 ? 1.1 : 1.6);
        break;
      }
      case 'skitter': {
        if (!this.entered) {
          this.entered = true;
          const lead = pl.board.vel.clone().multiplyScalar(0.5);
          this.skitTo.copy(pl.pos).add(lead).add(V((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
          d.clampIn(this.skitTo, 2);
          d.sfx('scorpion_chitter', this.pos, 0.8, 0.8);
        }
        const to = this.skitTo.clone().sub(this.pos).setY(0);
        speed = 15;
        this.vel.copy(to.normalize().multiplyScalar(speed));
        turnK = 10;
        if (Math.random() < dt * 30) spiritMotes(ctx.particles, this.pos.clone().add(V(0, 0.4, 0)), 1, 0.8, 0.6);
        if (to.length() < 1.5 || this.stT > 0.9) this.go('stalk', 0.6);
        break;
      }
      case 'dead': {
        this.deadT += dt;
        this.vel.multiplyScalar(Math.exp(-dt * 8));
        this.form = Math.max(0, 1 - this.deadT / 2.4);
        if (Math.random() < dt * 40) spiritMotes(ctx.particles, this.pos.clone().add(V((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)), 1, 0.4, 4);
        break;
      }
    }
    // move, face, keep in the ring
    this.pos.addScaledVector(this.vel, dt);
    d.clampIn(this.pos, 1.5);
    this.pos.y = d.groundAt(this.pos.x, this.pos.z);
    const faceTo = this.state === 'skitter' ? Math.atan2(this.vel.x, this.vel.z) : want;
    let dy = faceTo - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (this.state !== 'dead') this.yaw += dy * Math.min(1, dt * turnK);
    // the rig: a scuttling eight-legged gait, pincers, the tail rearing and striking
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    const n = this.rig.nodes;
    const mv = this.vel.length();
    this.gaitPh += dt * (3 + mv * 2.2);
    const g = Math.min(1, mv / 3);
    for (let i = 1; i <= 4; i++)
      for (const [s, sg] of [['l', 1], ['r', -1]] as const) {
        const leg = n[`leg_${s}${i}`];
        if (!leg) continue;
        const ph = this.gaitPh + i * Math.PI * 0.5 + (s === 'r' ? Math.PI : 0);
        leg.rotation.set(0, Math.sin(ph) * 0.32 * g * sg, Math.max(0, Math.cos(ph)) * 0.22 * g * sg + (this.state === 'dead' ? -0.4 * sg * Math.min(1, this.deadT) : 0));
      }
    const bob = Math.sin(this.gaitPh * 2) * 0.03 * g;
    if (n.body) n.body.position.y = (n.body.userData.restY ??= n.body.position.y) + bob - (this.state === 'dead' ? Math.min(1, this.deadT) * 0.25 : 0);
    const open = 0.15 + claw * 0.55 + Math.max(0, Math.sin(this.t * 1.3)) * 0.1;
    n.arm_l?.rotation.set(-claw * 0.6, -0.1 - claw * 0.35 + (this.state === 'claw' && this.stT > 0.5 ? 0.9 : 0), 0);
    n.arm_r?.rotation.set(-claw * 0.6, 0.1 + claw * 0.35 - (this.state === 'claw' && this.stT > 0.5 ? 0.9 : 0), 0);
    n.pincer_l?.rotation.set(0, open, 0);
    n.pincer_r?.rotation.set(0, -open, 0);
    for (let i = 1; i <= 5; i++) {
      const s = n['tail' + i];
      if (!s) continue;
      s.rotation.set(Math.sin(this.t * 1.6 - i * 0.6) * 0.05 - rear * 0.12 + tailStrike * 0.34, Math.sin(this.t * 0.9 - i * 0.4) * 0.05, 0);
    }
    n.stinger?.rotation.set(-rear * 0.3 + tailStrike * 0.6, 0, 0);
    // spectral body: forming, a heartbeat of light, a flare when hit
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    r.updateMatrixWorld(true);
    const su = this.mat.userData.spirit;
    // (the forming field is sized for a person: stretched so the whole scorpion sits inside it)
    su.uOrigin.value.copy(this.pos).add(V(0, 0.8 - 1.38 / 0.45, 0));
    su.uInvScale.value = 0.45;
    su.uForm.value = this.form;
    su.uSpirit.value = 1;
    su.uGlowK.value = 1 + this.hitFlash * 1.5 + (phase2 ? 0.3 : 0);
    this.shell.uniforms.uForm.value = this.form;
    this.shell.uniforms.uOrigin.value.copy(su.uOrigin.value);
    this.shell.uniforms.uInvScale.value = 0.45;
    this.shell.uniforms.uFade.value = Math.min(1, this.form * 1.3) * (0.8 + this.hitFlash);
    this.light.intensity = (2.4 + Math.sin(this.t * 6) * 0.6 + this.hitFlash * 4) * this.form;
    r.visible = this.form > 0.01;
    if (this.alive && Math.random() < dt * 8) spiritMotes(ctx.particles, this.pos.clone().add(V(0, this.height * 0.6, 0)).addScaledVector(this.fwd(), -this.len * 0.3), 1, 0.5, 0.8);
    this.marker.update(dt);
    // the soul shards
    for (const s of this.shards) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const toPl = pl.center(new THREE.Vector3()).sub(s.m.position);
      if (s.life > 1.2) s.v.lerp(toPl.normalize().multiplyScalar(13), 1 - Math.exp(-dt * 2));
      s.m.position.addScaledVector(s.v, dt);
      s.m.lookAt(s.m.position.clone().add(s.v));
      if (Math.random() < dt * 30) ctx.particles.emit({ pos: s.m.position, count: 1, spread: 0.2, life: [0.2, 0.4], size: [0.08, 0.02], sprite: ['glow8'], color: [0x9dffd8, 0x3affc0], additive: true, drag: 3 });
      if (pl.center(new THREE.Vector3()).distanceTo(s.m.position) < 0.85) {
        d.hurt(7, s.m.position, 3);
        s.life = 0;
      }
      if (s.life <= 0 || s.m.position.y < d.groundAt(s.m.position.x, s.m.position.z)) {
        s.life = 0;
        s.m.visible = false;
        ctx.fx.sparkle(s.m.position, 0x9dffd8, 5, 0.4);
      }
    }
  }

  private fired = 0;
  private entered = false;
  private fire() {
    const sock = this.rig.sockets['stinger_tip'] ?? this.rig.nodes['stinger'];
    const at = sock ? sock.getWorldPosition(new THREE.Vector3()) : this.pos.clone().add(V(0, this.height, 0));
    let s = this.shards.find((q) => q.life <= 0);
    if (!s) {
      const m = new THREE.Mesh(this.shardGeo, this.shardMat);
      this.d.ctx.scene.add(m);
      s = { m, v: new THREE.Vector3(), life: 0 };
      this.shards.push(s);
    }
    s.m.visible = true;
    s.m.position.copy(at);
    const spread = (this.fired - 1) * 0.3 * (this.fired & 1 ? 1 : -1);
    s.v.copy(this.fwd()).applyAxisAngle(UP, spread).multiplyScalar(9).add(V(0, 4, 0));
    s.life = 2.4;
    this.d.sfx('scorpion_throw', at, 0.6, 1.3);
  }

  private go(s: SoulScorpion['state'], cd = 0) {
    this.state = s;
    this.stT = 0;
    this.struck = false;
    this.fired = 0;
    this.entered = false;
    if (cd) this.cd = cd;
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || this.form < 0.6) return null;
    const f = this.fwd(), H = this.height, L = this.len;
    const parts: [THREE.Vector3, number, string, boolean][] = [
      [this.pos.clone().addScaledVector(f, L * 0.36).add(V(0, H * 0.3, 0)), L * 0.15, 'head', true],
      [this.pos.clone().addScaledVector(f, 0.05 * L).add(V(0, H * 0.33, 0)), L * 0.27, 'body', false],
      [this.pos.clone().addScaledVector(f, -0.22 * L).add(V(0, H * 0.82, 0)), L * 0.17, 'tail', false],
    ];
    let best: RayHit | null = null;
    for (const [c, r, part, head] of parts) {
      const oc = o.clone().sub(c);
      const b = oc.dot(d), cc = oc.lengthSq() - r * r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxT || (best && t >= best.t)) continue;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: head, part, surface: 'enemy' };
    }
    return best;
  }

  takeDamage(hit: Hit, point?: THREE.Vector3) {
    if (!this.alive || this.form < 0.6) return 0;
    const amt = Math.min(this.maxHp * 0.12, Math.max(1, (hit.base ?? 10) * (hit.mult ?? 1) * (hit.headshot ? 1.6 : 1)));
    this.hp -= amt;
    this.hitFlash = 1;
    const at = point ?? this.pos.clone().add(V(0, this.height * 0.5, 0));
    this.d.ctx.fx.number(at, Math.round(amt), hit.headshot ? 0xfff0a6 : 0x9dffd8, hit.headshot ? 1.2 : 0.9);
    spiritMotes(this.d.ctx.particles, at, 3, 0.3, 1);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.go('dead');
      this.marker.fade = 0;
      this.d.sfx('spectral_scorpion', this.pos, 1, 0.6);
      this.d.sfx('soul_leave', this.pos, 1, 0.8);
      this.d.ctx.fx.ring(this.pos, 0x9dffd8, 9, 0.8);
      this.d.ctx.shake(0.4);
    }
    return amt;
  }

  dispose() {
    this.rig.root.removeFromParent();
    this.marker.dispose();
    for (const s of this.shards) s.m.removeFromParent();
    this.shardGeo.dispose();
    this.shardMat.dispose();
    this.mat.dispose();
    this.shell.dispose();
  }
}

// =============================================================================================== the domain
export class SerketDomain {
  ctx: Ctx;
  player: Player;
  cam: CameraRig;
  /** the ring's centre (floor height) */
  center = new THREE.Vector3();
  flags = { double: false };
  done = false;
  private eng: any;
  private arena: Arena;
  private sky: DomainSky;
  private setU = setUniforms();
  private mat: THREE.Material;
  private spirit: SerketSpirit;
  private halo: GlyphRings;
  private sand: SandVortex;
  private spot = { pos: new THREE.Vector3(), yaw: 0, scale: 0.85 };
  private guide = true;
  private texts: FloatText3D[] = [];
  private speech: FloatText3D | null = null;
  private goals: Goal[] = [];
  private co: Script;
  private wait: Wait = 0;
  private lastDt = 1 / 60;
  private t = 0;
  private unsub: (() => void)[] = [];
  private restore: (() => void)[] = [];
  private ev = { jump: 0, charge: 0, flip: 0, wipe: 0, recover: 0, cast: 0, ult: 0 };
  private rideDist = 0;
  private carveT = 0;
  private scorp: SoulScorpion | null = null;
  private healCd = 0;
  private mark: { id: MarkId; ring: GlyphRings; pointer: THREE.Mesh; label: FloatText3D; k: number } | null = null;
  private pointerGeo: THREE.BufferGeometry;
  private pointerMat = makeVoxelMaterial();
  private targets: { mesh: THREE.Mesh; col: Collider | null; at: THREE.Vector3; rise: number; alive: boolean; h: number }[] = [];
  private targetMat = makeVoxelMaterial();
  private stepSkip = false;
  private devSkip = new URLSearchParams(location.search).has('tutskip');
  private cineOn = false;
  private pinch: { rig: RigInstance; pm: PinchMotion } | null = null;
  private hook = (dt: number, rdt: number) => this.update(this.eng.paused ? 0 : dt, rdt);
  private resolve: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (this.devSkip && e.code === 'KeyN' && !e.repeat) this.stepSkip = true;
  };
  private basePreset: any;

  constructor(private host: DomainHost, private o: { fightOnly?: boolean } = {}) {
    this.ctx = host.ctx;
    this.player = host.player;
    this.cam = host.camRig;
    this.eng = host.engine;
    const w = host.world;
    const pp = this.player.pos;
    this.center.set(pp.x, w.groundAt(pp.x, pp.z) + LIFT, pp.z);
    // the ring and its night
    this.setU.uDis.value = 0;
    this.mat = setMaterial(this.setU);
    this.arena = buildArena(this.ctx.scene, this.center, this.mat);
    this.sky = new DomainSky(this.ctx.scene);
    this.sky.fade = 1;
    const env = w.env as { preset?: any; apply?: (p: any) => void };
    this.basePreset = env.preset ? { ...env.preset } : null;
    this.applyNight();
    // the world answers for the ring while it stands
    const C = this.center;
    const orig = { groundAt: w.groundAt, groundSmooth: w.groundSmooth, surface: w.surface, normal: w.normal, slope: w.slope };
    const inside = (x: number, z: number) => Math.hypot(x - C.x, z - C.z) < ARENA.radius;
    const H = (x: number, z: number) => (inside(x, z) ? C.y + arenaProfile(Math.hypot(x - C.x, z - C.z)) : C.y - 60);
    w.groundAt = H;
    w.groundSmooth = H;
    w.surface = (x: number, z: number, out: any) => {
      out.h = H(x, z);
      out.drag = 0.006;
      out.speedMul = 1.02;
      out.kind = 'hard';
      out.flowX = 0;
      out.flowZ = 0;
      out.roll = 0;
      out.lava = false;
      return out;
    };
    w.normal = (x: number, z: number, out: THREE.Vector3) => {
      const dx = x - C.x, dz = z - C.z, r = Math.hypot(dx, dz) || 1;
      const s = inside(x, z) ? arenaSlope(r) : 0;
      return out.set((-s * dx) / r, 1, (-s * dz) / r).normalize();
    };
    w.slope = (x: number, z: number) => (inside(x, z) ? arenaSlope(Math.hypot(x - C.x, z - C.z)) : 0);
    this.restore.push(() => Object.assign(w, orig));
    // (the camera, particles and debris took their own copies of the ground at build time)
    const holders = [this.cam, this.ctx.particles, (host as any).debris].filter((o) => o && typeof o.groundAt === 'function');
    for (const o of holders) {
      const g0 = o.groundAt;
      o.groundAt = H;
      this.restore.push(() => (o.groundAt = g0));
    }
    // Sundown at the ring's heart, facing her; Pinch is not on him (Pinch is her)
    const st = { x: pp.x, z: pp.z, heading: this.player.board.heading };
    this.player.board.place(C.x, C.y, C.z + 7, Math.PI);
    this.cam.yaw = Math.PI;
    const sk = host.skills ?? Skills.current;
    if (sk) {
      const was = sk.pinchRoot.visible;
      sk.pinchRoot.visible = false;
      this.restore.push(() => (sk.pinchRoot.visible = was));
    }
    this.restore.push(() => {
      const y = orig.groundAt(st.x, st.z);
      this.player.board.place(st.x, y, st.z, st.heading);
      this.cam.yaw = st.heading;
    });
    // her guide form
    this.spirit = new SerketSpirit(this.ctx.scene, { scale: 1.1 });
    this.spirit.root.position.copy(C).add(V(0, 0.3, 0));
    this.spirit.form = 1;
    this.halo = new GlyphRings(this.ctx.scene, [{ radius: 1.7, y: 0.9, count: 10, speed: 0.6, tilt: [0.18, 0.1] }], 1.4);
    this.halo.appear = 1;
    this.sand = new SandVortex(this.ctx.scene, 420);
    // the marker's stinger
    const sp = stingerPointer();
    this.pointerGeo = buildVoxelGeometry(sp.model, { voxelSize: sp.voxelSize, pivot: 'center' });
    this.pointerMat.depthTest = false;
    this.pointerMat.transparent = true;
    // what he does
    const ev = this.ctx.events;
    const E = this.ev;
    this.unsub.push(
      ev.on('jump', () => E.jump++),
      ev.on('chargeJump', () => E.charge++),
      ev.on('flip', () => E.flip++),
      ev.on('trick', () => E.flip++),
      ev.on('wipeout', () => E.wipe++),
      ev.on('boardRecovered', () => E.recover++),
      ev.on('skillCast', () => E.cast++),
      ev.on('cast', () => E.cast++),
      ev.on('ultimate', () => E.ult++),
      ev.on('propShot', (c: Collider, p: THREE.Vector3) => this.onPropShot(c, p))
    );
    const b = this.player.board as any;
    const prevJump = b.onJump;
    b.onJump = (c: number, boost: boolean) => {
      prevJump?.(c, boost);
      if (c >= 0.3) E.charge++;
      else E.jump++;
    };
    this.restore.push(() => (b.onJump = prevJump));
    window.addEventListener('keydown', this.onKey);
    (window as any).__domain = this;
    this.co = this.script();
  }

  /** start: resolves once the domain has opened onto the first day */
  run() {
    this.eng.onAfterUpdate.push(this.hook);
    return new Promise<void>((r) => (this.resolve = r));
  }

  // ------------------------------------------------------------------ helpers for the scorpion
  groundAt = (x: number, z: number) => this.center.y + arenaProfile(Math.hypot(x - this.center.x, z - this.center.z));
  clampIn(p: THREE.Vector3, margin = 0) {
    const dx = p.x - this.center.x, dz = p.z - this.center.z, r = Math.hypot(dx, dz), R = ARENA.edge - margin;
    if (r > R) {
      p.x = this.center.x + (dx / r) * R;
      p.z = this.center.z + (dz / r) * R;
    }
  }
  sfx(id: string, at: THREE.Vector3 | null, v = 1, p = 1) {
    this.ctx.sfx(id, at, v, p);
  }
  /** a blow from the scorpion: it hurts, it throws him, it never kills him (she will not allow it) */
  hurt(dmg: number, from: THREE.Vector3, knock: number) {
    const pl = this.player;
    const d = Math.min(dmg, Math.max(0, pl.hp - pl.maxHp * 0.12));
    if (d > 0) pl.takeHit({ base: d, kind: 'magic', source: 'scorpion', knock } as Hit, from);
  }

  private applyNight() {
    const env = this.host.world.env as { apply?: (p: any) => void; preset?: any };
    if (!this.basePreset || !env.apply) return;
    env.apply({ ...this.basePreset, ...PRESETS.night, zenith: 0x060c1e, horizon: 0x16243a, fog: 0x0a1424, fogNear: 28, fogFar: 170, sunColor: 0xa8c0ff, sunIntensity: 1.25, sunElev: 52, hemiIntensity: 0.62, stars: 1, clouds: 0.05, exposure: 1.12 });
  }

  // ------------------------------------------------------------------ the lesson
  private *script(): Script {
    const sp = this.spirit;
    yield 0.3;
    // arrival: a slow look round her ring, then her
    this.cine(true);
    const C = this.center;
    let t = 0;
    while (t < 2.6) {
      const k = t / 2.6;
      const a = 2.4 + k * 1.2;
      this.shot(C.clone().add(V(Math.sin(a) * 15, 4.5 - k * 2, Math.cos(a) * 15)), C.clone().add(V(0, 1.8, 0)), 52);
      t += yield 0;
    }
    this.guide = false;
    this.spirit.root.position.copy(C).add(V(0, 0.3, 0));
    this.shot(this.player.pos.clone().add(V(1.6, 1.9, 2.8)), C.clone().add(V(0, 2.2, 0)), 46);
    yield* this.line('My domain. Nothing leaves it unless I open the way. Let us see what the sand made of you.', 'smug', 'open');
    this.cine(false);
    this.guide = true;
    if (!this.o.fightOnly) {
      // 1. the HUD, piece by piece
      yield* this.line('First, learn to read yourself.', 'neutral', 'present', 0.5);
      for (const m of MARKS) {
        this.showMark(m.id, m.label);
        yield 0.5;
        yield* this.line(m.line, 'neutral', 'point', 0.9);
        this.hideMark();
        yield 0.3;
      }
      // 2. the board
      this.rideDist = 0;
      this.carveT = 0;
      this.setGoals([tk('RIDE   W, steer with A / D', 'RIDE   hold your left thumb down'), tk('CARVE   lean into the bowl', 'CARVE   drag into the turns')]);
      yield* this.line('Ride. My ring has a bowl round its rim: carve up it and let it throw you back.', 'happy', 'beckon', 0.5);
      yield this.until(25, () => {
        this.check(0, this.rideDist > 30);
        this.check(1, this.carveT > 0.7);
        return this.goals.every((g) => g.done);
      });
      yield* this.passGoals('The sand remembers you.');
      this.ev.jump = 0;
      this.setGoals([tk('JUMP   tap SPACE', 'JUMP   flick up')]);
      yield* this.line(tk('A hop first. Tap SPACE.', 'A hop first. Flick your thumb up.'), 'neutral', 'point', 0.4);
      yield this.until(20, () => this.check(0, this.ev.jump + this.ev.charge > 0));
      yield* this.passGoals('Light on your feet.');
      this.ev.charge = 0;
      this.setGoals([tk('CHARGED JUMP   hold SHIFT, then SPACE', 'CHARGED JUMP   hold, then flick up'), tk('FARTHER   hold it longer', 'FARTHER   hold it longer')]);
      yield* this.line(tk('Now coil those bones. Hold SHIFT and jump: the longer you hold, the farther you fly.', 'Now coil those bones. Hold, then jump: the longer you hold, the farther you fly.'), 'neutral', 'beckon', 0.4);
      yield this.until(25, () => {
        if (this.ev.charge > 0) (this.check(0, true), this.check(1, true));
        return this.ev.charge > 0;
      });
      yield* this.passGoals('Graceful. For a scorpion.');
      this.ev.flip = 0;
      this.ev.wipe = 0;
      this.setGoals([tk('FLIP   in the air, hold SHIFT', 'FLIP   in the air, hold'), 'LAND IT   come down straight']);
      yield* this.line(tk('Up in the air, hold SHIFT to throw a flip. Land it straight, or eat my slate.', 'Up in the air, hold to throw a flip. Land it straight, or eat my slate.'), 'smug', 'beckon', 0.4);
      let wipes = 0;
      yield this.until(30, () => {
        if (this.ev.wipe > wipes) {
          wipes = this.ev.wipe;
          this.quip(['Up you get. The board waits for nobody.', 'Gravity: one. You: zero. Again.'][Math.min(1, wipes - 1)]);
        }
        if (this.ev.flip > 0) (this.check(0, true), this.check(1, true));
        return this.ev.flip > 0;
      });
      yield* this.passGoals('Show-off. I love it.');
      if (wipes > 0 && this.ev.recover < wipes) yield this.until(10, () => this.ev.recover >= wipes);
      yield* this.line('Speed is a friend with a temper. Go too fast, land crooked, and the sand throws you off. Keep your balance.', 'stern', 'open', 0.6);
      // 3. the gun
      this.spirit.pose = 'raise';
      this.spirit.flick();
      this.raiseTargets();
      yield 0.8;
      this.setGoals([tk('AIM   hold RIGHT MOUSE', 'AIM   drag right, hold still'), tk('SHOOT   LEFT MOUSE', 'SHOOT   keep the sights on a skull'), 'SKULLS   0 / 3']);
      yield* this.line(tk('Three old skulls. Aim with the right mouse, shoot with the left. Heads hit hardest.', 'Three old skulls. Drag your right thumb to aim and hold it still. Heads hit hardest.'), 'stern', 'point', 0.4);
      yield this.until(45, () => {
        if (this.player.aiming) this.check(0, true);
        const left = this.targets.filter((q) => q.alive).length;
        if (left < 3) this.check(1, true);
        this.retext(2, `SKULLS   ${3 - left} / 3`, left === 0);
        return left === 0;
      });
      this.sinkTargets();
      yield* this.passGoals('Three for three.');
      this.player.ammo = Math.min(this.player.ammo, 1);
      let saw = false;
      this.setGoals([tk('RELOAD   R', 'RELOAD   tap the cylinder')]);
      yield* this.line(tk('Nearly dry. R to reload.', 'Nearly dry. Tap the cylinder to reload.'), 'neutral', 'present', 0.3);
      yield this.until(20, () => {
        if (this.player.reload.active) saw = true;
        return saw && !this.player.reload.active && this.check(0, true);
      });
      yield* this.passGoals('Never ride on an empty gun.');
      // a skill: she lends him THE SUN
      const sk = this.host.skills ?? Skills.current;
      let lent = false;
      if (sk && !sk.learned.has('G')) {
        sk.learn('G', true);
        lent = true;
      }
      if (sk) sk.bombCharges = 2;
      let charges = sk?.bombCharges ?? 0;
      this.ev.cast = 0;
      this.setGoals([tk('SKILL   G   THE SUN', 'SKILL   tap THE SUN card'), tk('AIM IT   hold RIGHT MOUSE first', 'AIM IT   drag first')]);
      yield* this.line(tk('Borrow my Sun. Hold the right mouse to pick your spot, then G to throw it.', 'Borrow my Sun. Tap its card to throw it.'), 'happy', 'raise', 0.4);
      yield this.until(25, () => {
        const c = sk?.bombCharges ?? 0;
        if (c < charges || this.ev.cast > 0) (this.check(0, true), this.check(1, true));
        charges = c;
        return this.goals.every((g) => g.done);
      });
      yield* this.passGoals('Pretty, isn’t it?');
      if (lent) sk?.learned.delete('G');
      // the ultimate
      const run = this.ctx.run;
      run.ultCharge = 1;
      this.ctx.sfx('ult_ready', null, 0.7);
      this.showMark('ult', 'THE ULTIMATE');
      this.ev.ult = 0;
      this.setGoals([tk('ULTIMATE   Z', 'ULTIMATE   tap the burning card')]);
      yield* this.line(tk('The card is burning. Call me. Press Z.', 'The card is burning. Call me. Tap it.'), 'stern', 'beckon', 0.3);
      let seen = false;
      yield this.until(25, () => {
        const a = !!this.host.ult?.active;
        if (a || this.ev.ult > 0 || run.ultCharge < 0.5) (seen = true), this.check(0, true);
        return seen && !a;
      });
      this.hideMark();
      yield* this.passGoals('Did you feel that? That was me holding back.');
    }
    // 4. the soul scorpion
    yield* this.summon();
    const sc = this.scorp!;
    sc.onFirstTail = () => this.quip('Watch the floor. When my glyphs ring you, move!');
    this.setGoals(['THE SOUL SCORPION   100%', tk('SHOOT IT   go for the head', 'SHOOT IT   go for the head')]);
    yield* this.line('One last lesson. This is a soul I keep in a jar. Put it down, and the door opens.', 'stern', 'point', 0.3);
    let half = false;
    yield () => {
      this.retext(0, `THE SOUL SCORPION   ${Math.ceil((sc.hp / sc.maxHp) * 100)}%`, !sc.alive);
      if (!half && sc.hp < sc.maxHp * 0.5) {
        half = true;
        this.quip('It is angry now. Good. So am I.');
      }
      return !sc.alive;
    };
    this.clearGoals();
    // its soul goes up into the stars
    yield* this.line('There. You will do.', 'happy', 'open', 0.4);
    yield* this.ending();
  }

  private *passGoals(praise: string): Script {
    this.stepSkip = false;
    for (let i = 0; i < this.goals.length; i++) this.check(i, true);
    yield 0.45;
    this.clearGoals();
    yield* this.line(praise, 'laugh', 'open', 0.3);
  }

  private *summon(): Script {
    this.cine(true);
    const C = this.center;
    const at = C.clone().add(V(0, 0, -4));
    at.y = this.groundAt(at.x, at.z);
    this.spirit.pose = 'raise';
    this.spirit.flick();
    this.sfx('divine_power', at, 0.8, 0.7);
    this.sfx('spectral_scorpion', at, 0.9, 0.6);
    this.sand.center.copy(at);
    this.sand.bodyH = 1.8;
    this.sand.bodyR = 1.4;
    this.scorp = new SoulScorpion(this, at);
    this.scorp.yaw = Math.atan2(this.player.pos.x - at.x, this.player.pos.z - at.z);
    this.host.enemies?.registerExternal?.(this.scorp);
    let t = 0;
    while (t < 2.8) {
      const k = t / 2.8;
      this.sand.intensity = Math.sin(k * Math.PI) * 1.2;
      this.sand.gather = k;
      const a = this.scorp.yaw + 0.7 - k * 0.5;
      this.shot(at.clone().add(V(Math.sin(a) * (7 - k * 1.5), 1.0 + k * 0.8, Math.cos(a) * (7 - k * 1.5))), at.clone().add(V(0, 0.9, 0)), 46);
      if (Math.random() < 0.5) spiritMotes(this.ctx.particles, at.clone().add(V((Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3)), 1, 0.6, 1.5);
      t += yield 0;
    }
    this.sand.intensity = 0;
    this.eng.flash?.(0x9dffd8, 0.4, 0.4);
    this.cine(false);
    this.spirit.pose = 'idle';
  }

  private *ending(): Script {
    this.cine(true);
    const pl = this.player;
    pl.board.vel.set(0, 0, 0);
    const sc = this.scorp!;
    // the scorpion's soul rises into her constellations
    let t = 0;
    while (t < 2.6) {
      this.sky.burn = Math.min(1, t / 1.5);
      this.shot(sc.pos.clone().add(V(4, 2.5 + t, 5)), sc.pos.clone().add(V(0, 1 + t * 3, 0)), 50);
      t += yield 0;
    }
    // she comes down before him and lets go of her tall shape
    this.guide = false;
    const sp = this.spirit;
    const f = V(Math.sin(pl.board.heading), 0, Math.cos(pl.board.heading));
    const before = pl.pos.clone().addScaledVector(f, 2.6);
    before.y = this.groundAt(before.x, before.z);
    const from = sp.root.position.clone(), s0 = sp.scale;
    sp.look = pl.center(new THREE.Vector3());
    const close = () => this.shot(pl.pos.clone().add(V(0, 0, 0)).addScaledVector(f, 4.6).add(V(1.6, 1.3, 0)), pl.pos.clone().addScaledVector(f, 1.3).add(V(0, 0.9, 0)), 44);
    t = 0;
    while (t < 1.4) {
      const k = Math.min(1, t / 1.4);
      sp.root.position.lerpVectors(from, before, k * k * (3 - 2 * k));
      sp.root.rotation.y = Math.atan2(-f.x, -f.z);
      close();
      t += yield 0;
    }
    yield* this.line('Now. I am a little tired of being tall.', 'smug', 'present', 0.3);
    this.sfx('soul_leave', before, 0.8, 1.4);
    this.sand.center.copy(before);
    this.sand.bodyH = 2;
    this.sand.bodyR = 0.5;
    const spec = modelEntry('pinch')?.() as RigSpec | undefined;
    if (spec?.parts) {
      const rig = new RigInstance(buildRigGeo(spec, 'pinch:domain'), { material: (pl as any).material, castShadow: true });
      rig.root.position.copy(before);
      rig.root.scale.setScalar(0.001);
      this.ctx.scene.add(rig.root);
      this.pinch = { rig, pm: new PinchMotion(rig) };
    }
    t = 0;
    while (t < 1.8) {
      const k = Math.min(1, t / 1.8);
      sp.scale = s0 * (1 - k * 0.97);
      sp.form = 1 - Math.max(0, (k - 0.6) / 0.4);
      this.halo.fade = 1 - k;
      this.sand.intensity = Math.sin(k * Math.PI) * 1.3;
      if (this.pinch) this.pinch.rig.root.scale.setScalar(PINCH_PERCH_SCALE * 1.2 * Math.max(0.001, (k - 0.5) / 0.5));
      if (Math.random() < 0.6) spiritMotes(this.ctx.particles, before.clone().add(V(0, 0.4 + (1 - k) * 1.5, 0)), 2, 0.5, 1.2);
      this.shot(pl.pos.clone().addScaledVector(f, 3.6).add(V(1.2, 0.8, 0)), before.clone().add(V(0, 0.3 + (1 - k) * 1.2, 0)), 42);
      t += yield 0;
    }
    sp.form = 0;
    this.sand.intensity = 0;
    // the little scorpion runs to his boot and climbs him to the hat
    if (this.pinch) {
      const { rig, pm } = this.pinch;
      rig.setExpression?.('happy');
      const N = (pl as any).rig as RigInstance;
      const pt = (name: string, sock = false) => {
        const o = sock ? N.sockets[name] : N.nodes[name];
        return o ? o.getWorldPosition(new THREE.Vector3()) : pl.pos.clone().add(V(0, 1, 0));
      };
      const foot = pl.pos.clone().addScaledVector(f, 0.35);
      t = 0;
      const start = rig.root.position.clone();
      while (t < 1.1) {
        const k = t / 1.1;
        rig.root.position.lerpVectors(start, foot, k);
        rig.root.position.y = this.groundAt(rig.root.position.x, rig.root.position.z);
        rig.root.rotation.set(0, Math.atan2(foot.x - start.x, foot.z - start.z), 0);
        pm.update(this.lastDt, { speed: 4, mode: 'idle' });
        this.shot(pl.pos.clone().addScaledVector(f, 2.4).add(V(0.8, 0.5, 0)), rig.root.position.clone().add(V(0, 0.2, 0)), 40);
        t += yield 0;
      }
      this.sfx('scorpion_chitter', foot, 0.7, 1.4);
      t = 0;
      while (t < 2.2) {
        const k = Math.min(1, t / 2.2);
        const path = [foot, pt('shin_l'), pt('pelvis'), pt('torso'), pt('head'), pt('perch_hat', true)];
        const f2 = k * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f2)), u = f2 - i;
        const p = path[i].clone().lerp(path[i + 1], u).addScaledVector(f, 0.12 * Math.sin(u * Math.PI));
        const dir = path[i + 1].clone().sub(path[i]).normalize();
        rig.root.position.copy(p);
        rig.root.quaternion.setFromUnitVectors(V(0, 0, 1), dir);
        pm.update(this.lastDt, { speed: 5, mode: 'cling' });
        this.shot(pl.pos.clone().addScaledVector(f, 3.0).add(V(1.0, 1.2 + k * 0.6, 0)), p, 42);
        t += yield 0;
      }
      rig.root.removeFromParent();
      this.pinch = null;
    }
    const sk = this.host.skills ?? Skills.current;
    if (sk) {
      sk.pinchRoot.visible = true;
      sk.perch?.place('hat');
    }
    this.shot(pl.pos.clone().addScaledVector(f, 2.6).add(V(0.9, 2.0, 0)), pl.pos.clone().add(V(0, 1.8, 0)), 40);
    yield* this.whisper('*click*  I will ride up here from now on. Do not tell anyone a goddess lives in your hat.');
    yield* this.say('sundown', 'Wouldn’t dream of it.');
    // the domain opens onto the first desert day
    this.eng.audio.play('whoosh_big', { volume: 0.8, pitch: 0.8 });
    void this.eng.fadeOut?.(0.8, '#eafff4');
    yield 0.85;
    this.teardownSet();
    void this.eng.fadeIn?.(1.2);
    this.cine(false);
    yield 0.2;
    this.done = true;
  }

  // ------------------------------------------------------------------ talking
  private *line(s: string, expr = 'neutral', pose: any = 'idle', hold = 1.0): Script {
    this.spirit.setExpression(expr);
    this.spirit.pose = pose;
    this.speech?.show(false);
    const t = this.text(s, { size: 0.12, color: JADE, glow: JADE_GLOW, cps: 40, wrap: 32, hdr: 1.12 });
    this.speech = t;
    this.spirit.talking = true;
    this.ctx.sfx('divine_whisper', null, 0.3);
    while (!t.done) yield 0;
    this.spirit.talking = false;
    yield hold + s.length * 0.012;
    t.show(false);
    if (this.speech === t) this.speech = null;
  }
  private quip(s: string) {
    this.speech?.show(false);
    const t = this.text(s, { size: 0.11, color: JADE, glow: JADE_GLOW, cps: 44, wrap: 32, hdr: 1.1 });
    this.speech = t;
    this.spirit.talking = true;
    this.eng.tweens.after(1.2, () => (this.spirit.talking = false));
    this.eng.tweens.after(3.4, () => t.show(false));
  }
  private whisperT: FloatText3D | null = null;
  private *whisper(s: string): Script {
    const t = this.text(s, { size: 0.085, color: '#d6ffa8', glow: '#58c81a', cps: 36, wrap: 30, hdr: 1.0 });
    this.whisperT = t;
    while (!t.done) yield 0;
    yield 1.6;
    t.show(false);
    this.whisperT = null;
  }
  private sundownT: FloatText3D | null = null;
  private *say(_who: 'sundown', s: string): Script {
    const t = this.text(s, { size: 0.1, color: '#fff3d6', glow: '#a86a3a', cps: 38, wrap: 30, hdr: 1.0 });
    this.sundownT = t;
    while (!t.done) yield 0;
    yield 1.2;
    t.show(false);
    this.sundownT = null;
  }
  private text(s: string, o: FloatTextOpts) {
    const t = new FloatText3D(s, o);
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    return t;
  }

  // ------------------------------------------------------------------ goals: hanging over the ride
  private setGoals(labels: string[]) {
    this.clearGoals();
    this.stepSkip = false;
    this.goals = labels.map((l) => ({ label: l, done: false, text: this.goalText(l, false) }));
  }
  private goalText(s: string, done: boolean) {
    return this.text(s, done ? { size: 0.085, color: '#c8ff9a', glow: '#2a6a1a', cps: 0, wrap: 60, hdr: 1.05 } : { size: 0.085, color: KEYS, glow: KEY_GLOW, cps: 60, wrap: 60, hdr: 1.0 });
  }
  private retext(i: number, s: string, done: boolean) {
    const g = this.goals[i];
    if (!g || (g.label === s && g.done === done)) return;
    g.label = s;
    g.done = done;
    g.text.show(false);
    g.text = this.goalText(done ? `~ ${s} ~` : s, done);
  }
  private check(i: number, ok: boolean) {
    const g = this.goals[i];
    if (!g || g.done || !ok) return ok;
    this.retext(i, g.label, true);
    this.ctx.sfx('qte_good', null, 0.6);
    this.ctx.fx.sparkle(this.player.center(new THREE.Vector3()).add(V(0, 0.9, 0)), 0x9dff3a, 8, 0.5);
    return true;
  }
  private clearGoals() {
    for (const g of this.goals) g.text.show(false);
    this.goals = [];
  }
  /** a step's wait: passes when done, after `limit` seconds, or (dev, ?tutskip) on N */
  private until(limit: number, fn: () => boolean): () => boolean {
    let w = 0;
    return () => {
      w += this.lastDt;
      if (fn() || w > limit) return true;
      if (!this.stepSkip) return false;
      this.stepSkip = false;
      return true;
    };
  }

  // ------------------------------------------------------------------ the HUD marks
  private showMark(id: MarkId, label: string) {
    this.hideMark();
    const ring = new GlyphRings(this.ctx.scene, [{ radius: 1, y: 0, count: 10, speed: 1.4, tilt: [0, 0] }], 1.6);
    ring.appear = 0;
    ring.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.depthTest = false;
      o.renderOrder = 998;
    });
    const pointer = new THREE.Mesh(this.pointerGeo, this.pointerMat);
    pointer.renderOrder = 999;
    pointer.frustumCulled = false;
    this.ctx.scene.add(pointer);
    const lab = this.text(label, { size: 0.07, color: '#eafff4', glow: '#1e8a5a', cps: 30, wrap: 30, hdr: 1.05 });
    lab.mesh.renderOrder = 999;
    this.mark = { id, ring, pointer, label: lab, k: 0 };
    this.sfx('divine_chime', null, 0.45, 1.3);
  }
  private hideMark() {
    const m = this.mark;
    if (!m) return;
    m.ring.dispose();
    m.pointer.removeFromParent();
    m.label.show(false);
    this.mark = null;
  }
  /** where a HUD piece is on screen (px): the HUD's own anchor when it has one, else a fallback */
  anchorPx(id: MarkId) {
    const hud = this.host.hud as any;
    const fn = hud?.anchorOf ?? (this.host as any).hud3d?.anchorOf;
    if (typeof fn === 'function') {
      const p = fn.call(fn === hud?.anchorOf ? hud : (this.host as any).hud3d, id);
      if (p && (p.x || p.y)) return { x: p.x, y: p.y };
    }
    const A = hud?.anchors ?? {};
    for (const k of MARK_KEYS[id]) {
      const a = A[k];
      if (a && !a.hidden && (a.x || a.y)) return { x: a.x, y: a.y };
    }
    const [fx, fy] = MARK_FALLBACK[id];
    return { x: fx * this.eng.width, y: fy * this.eng.height };
  }
  private placeMark(dt: number) {
    const m = this.mark;
    if (!m) return;
    m.k = Math.min(1, m.k + dt * 2.5);
    const cam = this.ctx.camera;
    const px = this.anchorPx(m.id);
    const ndc = V((px.x / this.eng.width) * 2 - 1, -((px.y / this.eng.height) * 2 - 1), 0.5);
    const D = 2.2;
    const fw = cam.getWorldDirection(new THREE.Vector3());
    const dir = ndc.unproject(cam).sub(cam.position).normalize();
    const at = cam.position.clone().addScaledVector(dir, D / Math.max(0.2, dir.dot(fw)));
    // ring: about 70 px across, facing the lens, pulsing
    const worldPerPx = (2 * D * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / this.eng.height;
    const R = 46 * worldPerPx * (1 + 0.06 * Math.sin(this.t * 5));
    m.ring.group.position.copy(at);
    m.ring.group.quaternion.setFromUnitVectors(UP, cam.position.clone().sub(at).normalize());
    m.ring.group.scale.setScalar(R * m.k);
    m.ring.appear = m.k;
    m.ring.update(dt);
    // the stinger points in at it from the screen's centre side, bobbing
    const camUp = V(0, 1, 0).applyQuaternion(cam.quaternion), camR = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const toC = V(-ndc.x, -ndc.y * 0.6, 0).normalize();
    const off = camR.clone().multiplyScalar(toC.x).addScaledVector(camUp, toC.y).normalize();
    const bob = 1 + 0.15 * Math.sin(this.t * 6);
    const pp = at.clone().addScaledVector(off, R * 2.1 * bob);
    m.pointer.position.copy(pp);
    m.pointer.lookAt(at);
    m.pointer.scale.setScalar(0.28 * m.k * (worldPerPx / 0.0012));
    // the name, beyond the stinger
    m.label.anchor.copy(at).addScaledVector(off, R * 4.2).addScaledVector(camUp, R * 0.4);
  }

  // ------------------------------------------------------------------ the skull targets
  private raiseTargets() {
    const e = modelEntry('cattle_skull_post')?.() as { model: VoxelModel; voxelSize: number } | undefined;
    if (!e?.model) return;
    const g = buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot: 'bottom' });
    const b = e.model.bounds();
    const h = (b.maxY - b.minY + 1) * e.voxelSize;
    const C = this.center;
    const base = Math.atan2(this.player.pos.x - C.x, this.player.pos.z - C.z) + Math.PI;
    for (let i = 0; i < 3; i++) {
      const a = base + (i - 1) * 0.55;
      const at = C.clone().add(V(Math.sin(a) * 11, 0, Math.cos(a) * 11));
      at.y = this.groundAt(at.x, at.z);
      const mesh = new THREE.Mesh(g, this.targetMat);
      mesh.castShadow = true;
      mesh.position.copy(at).add(V(0, -h - 0.2, 0));
      mesh.rotation.y = Math.atan2(C.x - at.x, C.z - at.z);
      this.ctx.scene.add(mesh);
      const col = this.ctx.world.colliders.circle(at.x, at.z, 0.42, at.y, at.y + h + 0.1, { solid: false, bullets: true, tag: 'tutorial_target', data: { tutorial: true } });
      this.targets.push({ mesh, col, at, rise: 0, alive: true, h });
      this.ctx.fx.sandBurst(at, 0.8, 0x8a9aa8);
      spiritMotes(this.ctx.particles, at, 8, 0.6, 1.5);
    }
    this.sfx('sand_rise', C, 0.7);
  }
  private onPropShot(c: Collider, p: THREE.Vector3) {
    const t = this.targets.find((q) => q.col === c && q.alive);
    if (!t) return;
    const at = p ?? t.at;
    this.ctx.fx.hit(at, { x: 0, y: 1, z: 0 }, 'bone', 1.6);
    this.ctx.sfx('hit_bone', at, 1);
    this.ctx.events.emit('gibs', at.x, at.y, at.z, 16, 0.07, [0xf2dcb4, 0xd6b78a, 0xfff1d6, 0x8a6a3a], 5, 3);
    spiritMotes(this.ctx.particles, at, 6, 0.3, 1.2);
    t.alive = false;
    if (t.col) this.ctx.world.colliders.remove(t.col);
    t.col = null;
    t.mesh.visible = false;
    this.spirit.snip();
  }
  private sinkTargets() {
    for (const t of this.targets) {
      t.alive = false;
      if (t.col) this.ctx.world.colliders.remove(t.col);
      t.col = null;
    }
  }

  // ------------------------------------------------------------------ cinematic beats
  private cine(on: boolean) {
    if (on === this.cineOn) return;
    this.cineOn = on;
    this.eng.input.enabled = !on;
    this.eng.letterbox?.(on, 0.4);
    if (this.host.hud?.setVisible) this.host.hud.setVisible(!on);
    else if (this.host.hud) this.host.hud.visible = !on;
    if (!on) this.cam.setCine(null);
  }
  private shot(pos: THREE.Vector3, look: THREE.Vector3, fov: number) {
    pos.y = Math.max(pos.y, this.groundAt(pos.x, pos.z) + 0.3);
    this.cam.setCine({ pos, look, fov } as any, true);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, _rdt: number) {
    if (this.done) return this.finish();
    this.lastDt = dt;
    this.t += dt;
    const pl = this.player, b = pl.board;
    // what he does on the slate
    if (b.grounded && b.speed > 3) this.rideDist += b.speed * dt;
    if (b.grounded && b.speed > 4 && (Math.abs(b.turnSpeed) > 0.6 || Math.hypot(pl.pos.x - this.center.x, pl.pos.z - this.center.z) > ARENA.lipFrom + 1)) this.carveT += dt;
    // the ring holds him: the rim throws him back in
    const dx = pl.pos.x - this.center.x, dz = pl.pos.z - this.center.z, r = Math.hypot(dx, dz);
    if (r > ARENA.edge) {
      const nx = dx / r, nz = dz / r;
      pl.pos.x = this.center.x + nx * ARENA.edge;
      pl.pos.z = this.center.z + nz * ARENA.edge;
      const vo = b.vel.x * nx + b.vel.z * nz;
      if (vo > 0) {
        b.vel.x -= nx * vo * 1.5;
        b.vel.z -= nz * vo * 1.5;
      }
    }
    if (pl.pos.y < this.center.y - 8) b.place(this.center.x, this.center.y, this.center.z + 4, b.heading);
    // she never lets him die in here
    this.healCd -= dt;
    if (pl.hp < pl.maxHp * 0.3 && this.healCd <= 0) {
      this.healCd = 6;
      pl.hp = pl.maxHp * 0.7;
      this.ctx.fx.sparkle(pl.center(new THREE.Vector3()), 0x9dffd8, 14, 0.9);
      this.sfx('heal', pl.pos, 0.7, 1.1);
      this.quip('Not yet. I am not finished with you.');
    }
    // the script
    if (typeof this.wait === 'number') {
      this.wait -= dt;
      if (this.wait <= 0) this.step(dt);
    } else if (this.wait()) this.step(dt);
    // the night holds (the day cycle may try to take it back)
    if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) {
      const env = this.host.world.env as { preset?: any };
      if (env.preset && env.preset.stars < 0.9) this.applyNight();
    }
    // her: at his side as a guide, or where the beat put her
    const sp = this.spirit;
    if (this.guide && sp.form > 0) {
      guideSpot(pl.pos, this.cam.yaw, this.groundAt, this.spot);
      this.spot.scale = 0.85;
      const k = 1 - Math.exp(-dt * (3.2 + b.speed * 0.4));
      sp.root.position.lerp(this.spot.pos, k);
      sp.scale += (this.spot.scale - sp.scale) * k;
    }
    const yawTo = Math.atan2(pl.pos.x - sp.root.position.x, pl.pos.z - sp.root.position.z);
    let dy = yawTo - sp.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    sp.root.rotation.y += dy * Math.min(1, dt * 4);
    sp.look = pl.center(new THREE.Vector3()).add(V(0, 0.4, 0));
    sp.update(dt);
    this.halo.group.position.copy(sp.root.position);
    this.halo.group.scale.setScalar(sp.scale / 0.85);
    this.halo.update(dt);
    this.sand.update(dt, this.ctx.world.env.fog);
    if (sp.form > 0 && Math.random() < dt * 5) spiritMotes(this.ctx.particles, sp.socket('core'), 1, 0.4 * sp.scale, 0.8);
    this.scorp?.update(dt);
    this.pinch?.pm.update(0, {});
    this.arena.update(dt, this.t);
    this.sky.update(this.ctx.camera);
    // skull targets rising out of the slate
    for (const q of this.targets) {
      if (!q.alive && q.mesh.visible) q.rise = Math.max(0, q.rise - dt * 1.5);
      else if (q.alive) q.rise = Math.min(1, q.rise + dt * 1.1);
      const e = q.rise * q.rise * (3 - 2 * q.rise);
      q.mesh.position.y = q.at.y - (q.h + 0.2) * (1 - e);
    }
    // words: hers by her head (or up top when she is out of shot), the goals over the ride, the marks
    const cam = this.ctx.camera;
    const lens = (at: THREE.Vector3, out: THREE.Vector3, D = 3.4) => out.copy(cam.position).addScaledVector(at.sub(cam.position).normalize(), D);
    const fw = cam.getWorldDirection(new THREE.Vector3());
    const up = V(0, 1, 0).applyQuaternion(cam.quaternion);
    if (this.speech) {
      const hp = sp.socket('head_top').add(V(0, 0.35, 0));
      const inView = sp.form > 0.5 && hp.clone().sub(cam.position).normalize().dot(fw) > 0.82;
      if (inView) lens(hp, this.speech.anchor);
      else this.speech.anchor.copy(cam.position).addScaledVector(fw, 3.4).addScaledVector(up, 0.55);
    }
    const hat = pl.center(new THREE.Vector3()).add(V(0, 1.15, 0));
    if (this.whisperT) lens(hat.clone().add(V(0, 0.2, 0)), this.whisperT.anchor, 2.6);
    if (this.sundownT) lens(hat.clone().add(V(0, -0.15, 0)), this.sundownT.anchor, 2.6);
    const base = cam.position.clone().addScaledVector(fw, 3.4).addScaledVector(up, 0.86);
    this.goals.forEach((g, i) => g.text.anchor.copy(base).addScaledVector(up, -i * 0.13));
    this.placeMark(dt);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.update(dt, cam, t === this.speech && sp.talking ? (c, k, s) => Voice.syllable('serket', c, { index: k, text: s }) : undefined);
      if (t !== this.speech && t !== this.mark?.label && !this.goals.some((g) => g.text === t) && t.visibleAmount < 0.01 && t !== this.whisperT && t !== this.sundownT) {
        t.dispose();
        this.texts.splice(i, 1);
      }
    }
  }

  private step(dt: number) {
    const r = this.co.next(dt);
    this.wait = r.done ? 1e9 : r.value;
    if (r.done) this.done = true;
  }

  /** the ring, the night and the borrowed ground go away; the desert comes back */
  private torn = false;
  private teardownSet() {
    if (this.torn) return;
    this.torn = true;
    this.hideMark();
    this.clearGoals();
    this.sinkTargets();
    if (this.scorp) {
      this.host.enemies?.unregisterExternal?.(this.scorp);
      this.scorp.dispose();
      this.scorp = null;
    }
    for (const f of this.restore.reverse()) f();
    this.restore = [];
    const env = this.host.world.env as { apply?: (p: any) => void };
    if (this.basePreset) env.apply?.(this.basePreset);
    this.arena.dispose();
    this.sky.dispose();
    this.spirit.form = 0;
  }

  private finish() {
    const i = this.eng.onAfterUpdate.indexOf(this.hook);
    if (i >= 0) this.eng.onAfterUpdate.splice(i, 1);
    this.teardownSet();
    this.cine(false);
    for (const u of this.unsub) u();
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.texts) t.dispose();
    this.texts = [];
    for (const q of this.targets) q.mesh.removeFromParent();
    this.targets = [];
    this.pinch?.rig.root.removeFromParent();
    this.spirit.dispose();
    this.halo.dispose();
    this.sand.dispose();
    this.pointerGeo.dispose();
    this.pointerMat.dispose();
    this.targetMat.dispose();
    (this.mat as THREE.Material).dispose();
    if ((window as any).__domain === this) delete (window as any).__domain;
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}
