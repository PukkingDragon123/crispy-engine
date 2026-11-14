// The Nile fleet: Cleopatra's reed skiffs, war barges and shore cannons.
//
//  - Vessels float on the river (world.water: heightAt / isWater / wake / splash,
//    the channel network for steering). Without a river they ride a flat fallback
//    level, or glide over the sand like sand-yachts where the ground rises above it.
//  - The crew are ordinary horde enemies standing on the deck: the hull carries
//    them every frame (Enemy.mount), they fight from their stations, and when the
//    hunter jumps aboard they walk the deck to meet the boarder.
//  - Decks are real floors: the fleet layers them into world.groundAt / surface /
//    normal, so the board lands on a deck, rides it, and is carried along; from
//    the water the hull is a wall (ride it, or jump it).
//  - Hulls break by section (bow / waist / stern, skiff halves): splinters, a list
//    toward the breach, then the boat founders; crew still aboard drown.
//  - Guns: the barge's bow gun and the shore batteries fire telegraphed arcing
//    shots (a red ring on the water first) while a baboon gunner lives.
// Spawned through Enemies.spawn('reedBoat' | 'warBarge' | 'bankCannon', ...).
import * as THREE from 'three';
import type { Ctx, RayHit } from '../Ctx';
import type { Enemies, Enemy, ExternalTarget, PlayerLink } from './Enemies';
import { ENEMIES, EnemyDef, waveScale } from './EnemyDefs';
import { NILE_SOLDIERS } from './NileArmyDefs';
import type { Hit } from '../combat/Damage';
import { StatusSet } from '../combat/Status';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const SPRAY = [0xf2fbff, 0xcfe9ea, 0xa8d4d2, 0xffffff];
const SPLINTER = [0x8a4a2a, 0x6a3a1e, 0xa86a3a, 0xc8b064, 0x5a3a1e];
const REEDS = [0xb8a248, 0x9a8a38, 0xd2bc62, 0x5a3a1e];

/** what the fleet needs from the water (NileWater / FlatWater fit) */
interface WaterLike {
  heightAt(x: number, z: number): number;
  isWater?(x: number, z: number, minDepth?: number): boolean;
  wake?(x: number, z: number, vx: number, vz: number, size?: number): void;
  splash?(x: number, z: number, size?: number): void;
}
interface RiverHitLike {
  u: number;
  hw: number;
  tx: number;
  tz: number;
}

/** what a crewman's mount does each frame (Enemies calls it right after the enemy thinks) */
export interface Mount {
  place(e: Enemy, dt: number): void;
}

type Kind = 'reed' | 'barge' | 'battery';

interface Section {
  part: string;
  z0: number;
  z1: number;
  hp: number;
  max: number;
  broken: boolean;
}
interface Crew {
  e: Enemy;
  /** where it stands now / its station, boat space (m) */
  local: THREE.Vector3;
  station: THREE.Vector3;
  gunner: boolean;
}
interface Gun {
  /** the barrel (pitch) and what turns it (yaw: the carriage, or the barrel itself) */
  pitch: THREE.Object3D;
  yaw: THREE.Object3D;
  cd: number;
  aimYaw: number;
  aimPitch: number;
  recoil: number;
  busy: boolean;
}

// ============================================================================ one hull
export class Hull implements ExternalTarget, Mount {
  id: number;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius: number;
  height: number;
  alive = true;
  isBoss = false;
  alpha = false;
  hp: number;
  maxHp: number;
  name: string;
  flying = false;
  status = new StatusSet();
  yaw = 0;
  speed = 0;
  rig: RigInstance;
  root = new THREE.Group();
  meta: Record<string, any>;
  /** boat space -> world, this frame and last frame */
  M = new THREE.Matrix4();
  private Mprev = new THREE.Matrix4();
  private MprevInv = new THREE.Matrix4();
  private MInv = new THREE.Matrix4();
  sections: Section[] = [];
  crew: Crew[] = [];
  guns: Gun[] = [];
  /** the hull is going down (0..1) */
  sink = 0;
  sinking = false;
  /** between waves: sail off and vanish */
  leaving = false;
  private t = rnd.next() * 10;
  private flash = 0;
  private list = 0;
  private trim = 0;
  private listT = 0;
  private trimT = 0;
  private turn = 0;
  private ramT = 0;
  private ramCd = 6 + rnd.next() * 5;
  private ramHit = false;
  private surface = 0;
  private draft: number;
  private len: number;
  private beam: number;
  private wave = 1;
  private side = rnd.sign();
  private wakeT = 0;
  private creakT = 3;
  private hit = { u: 0, hw: 0, tx: 0, tz: 1 } as RiverHitLike;
  aboard = false;

  constructor(public fleet: NileFleet, public def: EnemyDef, public kind: Kind, spec: RigSpec, x: number, z: number, yaw: number) {
    this.id = NileFleet.nextId++;
    this.name = def.name;
    this.meta = spec.meta ?? {};
    const sc = waveScale(fleet.enemies.wave);
    this.wave = fleet.enemies.wave;
    this.maxHp = this.hp = def.hp * (0.6 + sc.hp * 0.4);
    this.radius = def.radius;
    this.height = def.height;
    this.len = (this.meta.length as number) ?? 4;
    this.beam = (this.meta.beam as number) ?? 2;
    this.draft = (this.meta.draft as number) ?? 0.3;
    this.rig = new RigInstance(buildRigGeo(spec, 'fleet:' + spec.name), { ownMaterial: true });
    this.root.add(this.rig.root);
    fleet.ctx.scene.add(this.root);
    for (const s of (this.meta.sections as { part: string; z0: number; z1: number; share: number }[]) ?? []) {
      const mx = this.maxHp * s.share * 1.35;
      this.sections.push({ part: s.part, z0: s.z0, z1: s.z1, hp: mx, max: mx, broken: false });
    }
    for (const g of (this.meta.guns as { part: string }[]) ?? []) {
      const p = this.rig.nodes[g.part];
      if (!p) continue;
      const yawN = kind === 'battery' ? this.rig.nodes['carriage'] ?? p : p;
      this.guns.push({ pitch: p, yaw: yawN, cd: 2.5 + rnd.next() * 2, aimYaw: 0, aimPitch: 0, recoil: 0, busy: false });
    }
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.surface = this.waterY(x, z);
    this.pos.y = this.surface;
    this.place(null, 0);
    this.Mprev.copy(this.M);
    fleet.enemies.registerExternal(this);
  }

  // ------------------------------------------------------------------ water
  private waterY(x: number, z: number) {
    return this.fleet.waterAt(x, z);
  }
  private navigable(x: number, z: number) {
    if (this.fleet.world.storm.sdf(x, z) < 6) return false;
    return this.fleet.wet(x, z, this.draft + 0.25);
  }

  // ------------------------------------------------------------------ boat space
  /** world -> boat space (current frame) */
  toLocal(p: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(p).applyMatrix4(this.MInv);
  }
  /** the deck under a world point (null if none) */
  deckAt(x: number, z: number): number | null {
    if (!this.alive || this.sink > 0.85) return null;
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (dx * dx + dz * dz > (this.len * 0.6) ** 2) return null;
    _v.set(x, this.pos.y, z).applyMatrix4(this.MInv);
    let best: number | null = null;
    const e = this.M.elements;
    for (const r of (this.meta.deck as number[][]) ?? []) {
      if (_v.x < r[0] || _v.x > r[1] || _v.z < r[2] || _v.z > r[3]) continue;
      if (this.brokenAt(_v.z)) continue;
      const y = e[1] * _v.x + e[5] * r[4] + e[9] * _v.z + e[13];
      if (best === null || y > best) best = y;
    }
    return best;
  }
  private brokenAt(lz: number) {
    for (const s of this.sections) if (s.broken && lz >= s.z0 && lz <= s.z1) return true;
    return false;
  }
  /** clamp a boat-space point onto the walkable deck */
  private clampDeck(p: THREE.Vector3) {
    let best: number[] | null = null, bd = 1e9;
    for (const r of (this.meta.deck as number[][]) ?? []) {
      const cx = clamp(p.x, r[0] + 0.25, r[1] - 0.25), cz = clamp(p.z, r[2] + 0.25, r[3] - 0.25);
      const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = [cx, r[4], cz];
      }
    }
    if (best) p.set(best[0], best[1], best[2]);
    return p;
  }

  // ------------------------------------------------------------------ the crew
  addCrew(e: Enemy, station: THREE.Vector3, gunner: boolean) {
    e.mount = this;
    e.state = 'move';
    e.stateT = 0;
    this.crew.push({ e, local: station.clone(), station: station.clone(), gunner });
    _v.copy(station).applyMatrix4(this.M);
    e.pos.copy(_v);
  }
  /** Enemies calls this right after the crewman thinks: carry it with the hull, keep it on the deck */
  place(e: Enemy | null, dt: number) {
    if (!e) {
      // (re)build this frame's transform
      this.root.position.copy(this.pos);
      _e.set(this.trim, this.yaw, this.list, 'YXZ');
      this.root.quaternion.setFromEuler(_e);
      this.root.updateMatrixWorld(true);
      this.M.copy(this.root.matrixWorld);
      this.MInv.copy(this.M).invert();
      return;
    }
    const c = this.crew.find((k) => k.e === e);
    if (!c) {
      e.mount = null;
      return;
    }
    if (!e.alive) return;
    // leaving the boat on purpose (a pounce or a charge at a boarder on the bank / another deck)
    const freeMove = e.state === 'leap' || e.state === 'charge' || e.state === 'dive';
    if (freeMove) {
      if (!this.aboard && !this.fleet.playerOnLand()) {
        // nothing to leap at but water: stay aboard
        e.state = 'recover';
        e.stateT = 0;
      } else return;
    }
    // where the AI moved it this frame, in last frame's boat space, carried into this frame's
    _v.copy(e.pos).applyMatrix4(this.MprevInv);
    const offDeck = this.fleet.deckOf(e.pos.x, e.pos.z) !== this && (e.state === 'recover' || e.state === 'move');
    if (offDeck && c.local.distanceTo(_v) > 1.5) {
      // it jumped off: on land it fights on as a soldier, in deep water it drowns
      this.dismount(c);
      return;
    }
    if (!this.aboard) {
      // no boarder: back to the station, standing, facing the hunter
      _v.lerp(c.station, clamp(dt * 3, 0, 1));
      e.vel.x = 0;
      e.vel.z = 0;
      if (e.state === 'windup' && e.atk && (e.atk.kind === 'leap' || e.atk.kind === 'charge') && !this.fleet.playerOnLand()) {
        e.state = 'move';
        e.stateT = 0;
        this.fleet.enemies.warn.cancelFor(e);
      }
    }
    this.clampDeck(_v);
    c.local.copy(_v);
    _w.copy(_v).applyMatrix4(this.M);
    e.pos.x = _w.x;
    e.pos.z = _w.z;
    e.pos.y = Math.max(_w.y, e.pos.y > _w.y + 0.05 && e.vel.y > 0 ? e.pos.y : _w.y);
    if (!this.aboard) e.yaw = dampAngle(e.yaw, Math.atan2(this.fleet.player.pos.x - e.pos.x, this.fleet.player.pos.z - e.pos.z), 5, dt);
  }
  private dismount(c: Crew) {
    const e = c.e;
    e.mount = null;
    this.crew = this.crew.filter((k) => k !== c);
    if (this.fleet.wet(e.pos.x, e.pos.z, 0.6)) this.fleet.drown(e);
  }

  // ------------------------------------------------------------------ targeting
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || this.sink > 0.7) return null;
    let best: RayHit | null = null;
    let bt = maxT;
    const n = this.kind === 'battery' ? 1 : this.kind === 'reed' ? 4 : 6;
    const r = this.kind === 'battery' ? 1.3 : this.beam * 0.52;
    for (let i = 0; i < n; i++) {
      const lz = n === 1 ? 0 : (i / (n - 1) - 0.5) * this.len * 0.82;
      if (this.brokenAt(lz)) continue;
      _v.set(0, this.kind === 'battery' ? 0.8 : 0.35, lz).applyMatrix4(this.M);
      const ox = o.x - _v.x, oy = o.y - _v.y, oz = o.z - _v.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(_v).normalize(), headshot: false, part: 'hull', surface: 'enemy' };
    }
    return best;
  }

  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive || this.sinking) return 0;
    const src = hit.source;
    // hulls shrug off bullets, splinter under blasts, burn when they are reed
    let mult = src === 'explosion' ? 2.6 : src === 'board' ? 0.35 : src === 'gun' || src === 'projectile' ? 0.55 : 1;
    if (src === 'burn' && this.kind === 'reed') mult = 2.2;
    const base = (hit.base ?? 0) * (hit.mult ?? 1) * mult;
    const amt = Math.max(0, base * (1 - Math.min(0.6, this.def.armor / 200)));
    if (amt <= 0) return 0;
    this.hp -= amt;
    this.flash = 1;
    const p = point ?? _v.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
    const ctx = this.fleet.ctx;
    ctx.fx.hit(p, { x: -(dir?.x ?? 0), y: 0.5, z: -(dir?.z ?? 0) }, this.kind === 'battery' ? 'armor' : 'wood', 0.8);
    ctx.fx.number({ x: p.x, y: p.y + 0.4, z: p.z }, amt, 0xe8c890, 1.0);
    if (rnd.chance(0.35)) ctx.sfx(this.kind === 'battery' ? 'hit_armor' : 'crate_break', p, 0.35, 0.8 + rnd.next() * 0.3);
    if (rnd.chance(0.5)) ctx.events.emit('gibs', p.x, p.y, p.z, 3, 0.07, this.kind === 'reed' ? REEDS : SPLINTER, 4, 3);
    // which section took it
    if (this.sections.length) {
      this.toLocal(p as THREE.Vector3, _w);
      let s = this.sections.find((k) => !k.broken && _w.z >= k.z0 && _w.z <= k.z1);
      if (!s) s = this.sections.filter((k) => !k.broken).sort((a, b) => Math.abs((a.z0 + a.z1) / 2 - _w.z) - Math.abs((b.z0 + b.z1) / 2 - _w.z))[0];
      if (s) {
        s.hp -= amt;
        if (s.hp <= 0) this.breakSection(s);
      }
    }
    if (this.hp <= 0 && !this.sinking) this.founder(true);
    return amt;
  }

  private breakSection(s: Section) {
    if (s.broken) return;
    s.broken = true;
    const ctx = this.fleet.ctx;
    const mid = (s.z0 + s.z1) / 2;
    _v.set(0, 0.6, mid).applyMatrix4(this.M);
    // the section bursts into planks / reed bundles, the river rushes in
    ctx.events.emit('gibs', _v.x, _v.y, _v.z, this.kind === 'reed' ? 22 : 34, 0.16, this.kind === 'reed' ? REEDS : SPLINTER, 7, 6);
    ctx.fx.explosion({ x: _v.x, y: _v.y, z: _v.z }, this.kind === 'reed' ? 1.6 : 2.4);
    this.fleet.splash(_v.x, _v.z, 2.2);
    ctx.sfx('barrel_break', _v, 1, 0.6);
    ctx.sfx('crate_break', _v, 0.9, 0.5);
    ctx.shake(0.25);
    if (this.rig.nodes[s.part] && s.part !== this.rig.geo.parts[0].name) this.rig.setPartVisible(s.part, false);
    // crew standing on the lost section go into the river
    for (const c of [...this.crew]) if (c.local.z >= s.z0 - 0.3 && c.local.z <= s.z1 + 0.3) {
      c.e.mount = null;
      this.crew = this.crew.filter((k) => k !== c);
      this.fleet.drown(c.e);
    }
    // she lists toward the breach
    this.trimT += mid > 0 ? 0.14 : -0.16;
    this.listT += rnd.sign() * 0.08;
    const broken = this.sections.filter((k) => k.broken).length;
    const mainLost = s.part === this.rig.geo.parts[0].name;
    if (this.kind === 'reed' || broken >= 2 || mainLost) this.founder(true);
  }

  /** she goes down: the stern or bow rises, bubbles, the crew drown */
  founder(byHunter: boolean) {
    if (this.sinking) return;
    this.sinking = true;
    const ctx = this.fleet.ctx;
    ctx.sfx('quake_rumble', this.pos, 0.6, 1.3);
    ctx.sfx('door_creak', this.pos, 0.8, 0.6);
    this.fleet.enemies.callout(`${this.def.name.toUpperCase()} SUNK`, { x: this.pos.x, y: this.pos.y + this.height + 1, z: this.pos.z }, 'elite');
    for (const c of [...this.crew]) {
      c.e.mount = null;
      this.fleet.drown(c.e);
    }
    this.crew = [];
    for (const g of this.guns) g.busy = true;
    if (byHunter) ctx.events.emit('enemyKilled', this, null);
    this.listT += rnd.sign() * 0.35;
    this.trimT += rnd.sign() * 0.25;
  }

  /** a song-title callout over the hull */
  say(title: string) {
    const pos = { x: this.pos.x, y: this.pos.y + this.height * 0.7 + 0.5, z: this.pos.z };
    this.fleet.ctx.events.emit('enemySkill', { title, enemy: this, pos, tier: 'elite' });
    if (this.fleet.ctx.camera.position.distanceTo(this.pos) < 60) this.fleet.enemies.callout(title, pos, 'elite');
  }

  // ------------------------------------------------------------------ guns
  private gunnerAlive() {
    return this.crew.some((c) => c.gunner && c.e.alive && c.e.state !== 'stagger' && !c.e.status.stunned());
  }
  private fireGuns(dt: number) {
    const fl = this.fleet;
    const pl = fl.player;
    for (const g of this.guns) {
      g.recoil = damp(g.recoil, 0, 6, dt);
      // aim at the hunter (yaw relative to the hull, a ballistic pitch)
      g.pitch.updateWorldMatrix(true, false);
      g.pitch.getWorldPosition(_v);
      const dx = pl.pos.x - _v.x, dz = pl.pos.z - _v.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz) - this.yaw;
      let rel = want;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      const arc = this.kind === 'battery' ? 1.25 : 1.05;
      g.aimYaw = dampAngle(g.aimYaw, clamp(rel, -arc, arc), 2.2, dt);
      g.aimPitch = damp(g.aimPitch, -clamp(0.08 + dist * 0.006, 0.08, 0.5), 2, dt);
      if (g.yaw === g.pitch) g.pitch.rotation.set(g.aimPitch - g.recoil * 0.25, g.aimYaw, 0);
      else {
        g.yaw.rotation.y = g.aimYaw;
        g.pitch.rotation.x = g.aimPitch - g.recoil * 0.25;
      }
      g.pitch.position.z = (this.rig.geo.parts[this.rig.geo.index[g.pitch.name]]?.offset.z ?? g.pitch.position.z) - g.recoil * 0.25;
      if (g.busy || this.sinking || this.leaving || !pl.alive) continue;
      g.cd -= dt;
      if (g.cd > 0 || !this.gunnerAlive() || dist < 9 || dist > 70 || Math.abs(rel) > arc + 0.15) continue;
      g.cd = (this.kind === 'battery' ? 5.2 : 6.5) + rnd.next() * 2.5;
      void this.volley(g, dist);
    }
  }
  private async volley(g: Gun, dist: number) {
    const fl = this.fleet;
    const ctx = fl.ctx;
    g.busy = true;
    const salvo = this.kind === 'barge' && rnd.chance(0.45) ? 3 : 1;
    const title = this.kind === 'battery' ? this.def.moveTitles?.fire ?? 'Shine a Light' : salvo > 1 ? this.def.moveTitles?.broadside ?? 'Revolution' : (ENEMIES.nileBaboon?.moveTitles?.cannon ?? "Can't You Hear Me Knocking");
    this.say(title);
    const W = 0.95;
    const T = 1.05 + dist / 38;
    const pl = fl.player;
    const v = pl.board.vel;
    const marks: THREE.Vector3[] = [];
    for (let i = 0; i < salvo; i++) {
      const lead = W + T + i * 0.35;
      const side = (i - (salvo - 1) / 2) * 4.5;
      const fx = -v.z, fz = v.x;
      const fl2 = Math.hypot(fx, fz) || 1;
      const p = new THREE.Vector3(pl.pos.x + v.x * lead * 0.8 + (fx / fl2) * side, 0, pl.pos.z + v.z * lead * 0.8 + (fz / fl2) * side);
      p.y = fl.surfaceAt(p.x, p.z);
      marks.push(p);
      fl.enemies.warn.circle(p.x, p.z, 3.1, W + T + i * 0.35, 'heavy');
    }
    ctx.sfx('dynamite_fuse', this.pos, 0.7, 0.8);
    try {
      await fl.wait(W);
      for (let i = 0; i < salvo; i++) {
        if (!this.alive || this.sinking) break;
        this.shoot(g, marks[i], T);
        if (i < salvo - 1) await fl.wait(0.35);
      }
    } finally {
      g.busy = false;
    }
  }
  private shoot(g: Gun, at: THREE.Vector3, T: number) {
    const fl = this.fleet, ctx = fl.ctx;
    const s = this.rig.sockets['muzzle'];
    const from = new THREE.Vector3();
    if (s) {
      s.updateWorldMatrix(true, false);
      s.getWorldPosition(from);
    } else from.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    const grav = 14;
    const vx = (at.x - from.x) / T, vz = (at.z - from.z) / T, vy = (at.y - from.y) / T + 0.5 * grav * T;
    const dmg = 17 * waveScale(this.wave).dmg;
    fl.enemies.proj.spawn({ kind: 'cannon', x: from.x, y: from.y, z: from.z, vx, vy, vz, dmg, life: T + 2, sourceId: this.id, r: 0.5 });
    g.recoil = 1;
    const dir = { x: vx / Math.hypot(vx, vz), y: 0.15, z: vz / Math.hypot(vx, vz) };
    ctx.fx.muzzle(from, dir, 0xffd890, true);
    ctx.fx.light(from, 0xffb050, 6, 0.18, 14);
    ctx.particles.emit({ pos: from, count: 9, vel: { x: dir.x * 4, y: 1.2, z: dir.z * 4 }, spread: 1.4, life: [0.8, 1.6], size: [0.6, 1.6], sprite: ['puff0', 'puff1', 'cloud0'], color: [0xd8d0c4, 0xb8b0a4, 0x9a9288], alpha: 0.7, drag: 1.6, rot: 6, rotSpeed: 0.6 });
    ctx.particles.emit({ pos: from, count: 8, vel: { x: dir.x * 9, y: 2, z: dir.z * 9 }, spread: 1.2, life: [0.15, 0.35], size: [0.12, 0.04], sprite: 'spark', color: [0xffd070, 0xff9a3a], additive: true, drag: 2 });
    ctx.sfx('explosion_big', from, 0.55, 1.35);
    ctx.shake(0.12);
    // the recoil rocks the hull
    this.listT += (this.kind === 'battery' ? 0 : 0.04) * rnd.sign();
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const fl = this.fleet;
    const ctx = fl.ctx;
    const pl = fl.player;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.Mprev.copy(this.M);
    this.MprevInv.copy(this.MInv);
    this.crew = this.crew.filter((c) => c.e.alive && c.e.mount === this);
    // keep the crew from slinking into the river between waves: the hull takes them away
    for (const c of this.crew) if (c.e.retreat > 0) {
      c.e.retreat = 0.001;
      this.leaving = true;
    }
    if (this.kind !== 'battery') this.sail(dt);
    if (!this.alive) return;
    // float: the swell under the bow, the stern and both sides
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const L = this.len * 0.38, B = this.beam * 0.45;
    const hB = this.waterY(this.pos.x + sy * L, this.pos.z + cy * L), hS = this.waterY(this.pos.x - sy * L, this.pos.z - cy * L);
    const hP = this.waterY(this.pos.x + cy * B, this.pos.z - sy * B), hR = this.waterY(this.pos.x - cy * B, this.pos.z + sy * B);
    const h = (hB + hS + hP + hR) * 0.25;
    this.surface = damp(this.surface, h, 6, dt);
    const sinkDepth = this.sink * (this.height * 0.9 + 1.5);
    const bob = this.kind === 'battery' ? 0 : Math.sin(this.t * 1.4) * 0.05;
    this.pos.y = this.surface - (this.kind === 'battery' ? 0 : this.draft * 0.35) + bob - sinkDepth;
    const pitchW = this.kind === 'battery' ? 0 : Math.atan2(hS - hB, L * 2) * 0.8 + Math.sin(this.t * 1.1 + 1) * 0.015;
    const rollW = this.kind === 'battery' ? 0 : Math.atan2(hR - hP, B * 2) * 0.8 + Math.sin(this.t * 0.9) * 0.025 - this.turn * this.speed * 0.012;
    if (this.sinking) {
      this.sink = Math.min(1, this.sink + dt / (this.kind === 'reed' ? 4.5 : this.kind === 'battery' ? 2.5 : 7));
      this.listT += Math.sign(this.listT || 1) * dt * 0.05;
      this.trimT += Math.sign(this.trimT || 1) * dt * 0.06;
      if (rnd.chance(dt * 14)) {
        const lz = (rnd.next() - 0.5) * this.len * 0.8;
        _v.set((rnd.next() - 0.5) * this.beam, 0, lz).applyMatrix4(this.M);
        ctx.fx.bubbles({ x: _v.x, y: this.surface + 0.05, z: _v.z }, 3);
        if (rnd.chance(0.3)) fl.splash(_v.x, _v.z, 0.8);
      }
      if (this.kind === 'battery' && this.sink > 0.05 && rnd.chance(dt * 6)) ctx.fx.dust({ x: this.pos.x, y: this.surface + 0.5, z: this.pos.z }, 1.2, 0xc8b08a, 3);
      if (this.sink >= 1) {
        this.dispose();
        return;
      }
    }
    this.list = damp(this.list, this.listT, 1.5, dt);
    this.trim = damp(this.trim, this.trimT, 1.5, dt);
    _e.set(this.trim + pitchW, this.yaw, this.list + rollW, 'YXZ');
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromEuler(_e);
    this.root.updateMatrixWorld(true);
    this.M.copy(this.root.matrixWorld);
    this.MInv.copy(this.M).invert();
    // flash on hits
    const fxu = this.rig.material.userData.fx?.value;
    if (fxu) fxu.x = this.flash * 0.6;
    this.animateRig(dt);
    // the hunter aboard: carried with the deck
    this.aboard = false;
    const b = pl.board;
    if (pl.alive && b.grounded && fl.deckOf(pl.pos.x, pl.pos.z) === this) {
      const dy = (this.deckAt(pl.pos.x, pl.pos.z) ?? -99) - pl.pos.y;
      if (Math.abs(dy) < 0.6) {
        this.aboard = true;
        _v.copy(pl.pos).applyMatrix4(this.MprevInv).applyMatrix4(this.M);
        b.pos.x = _v.x;
        b.pos.z = _v.z;
        b.pos.y = Math.max(b.pos.y, _v.y);
      }
    }
    if (this.kind !== 'battery') this.fireGuns(dt);
    else if (!this.sinking) this.fireGuns(dt);
    // spray and the V wake
    if (this.kind !== 'battery' && !this.sinking && this.speed > 1.5) {
      this.wakeT -= dt;
      fl.water?.wake?.(this.pos.x, this.pos.z, this.vel.x, this.vel.z, this.kind === 'barge' ? 2.2 : 1.3);
      if (this.wakeT <= 0) {
        this.wakeT = 0.06;
        _v.set((rnd.next() - 0.5) * this.beam * 0.4, 0, this.len * 0.5).applyMatrix4(this.M);
        ctx.particles.emit({ pos: { x: _v.x, y: this.surface + 0.15, z: _v.z }, count: 2, vel: { x: this.vel.x * 0.5, y: 1.6 + this.speed * 0.15, z: this.vel.z * 0.5 }, spread: 1.6, gravity: 12, drag: 0.6, life: [0.35, 0.7], size: [0.12, 0.05], sprite: ['dot3', 'dot4'], color: SPRAY, ground: true });
        if (rnd.chance(0.25)) {
          _v.set((rnd.next() - 0.5) * this.beam, 0, -this.len * 0.45).applyMatrix4(this.M);
          ctx.particles.emit({ pos: { x: _v.x, y: this.surface + 0.05, z: _v.z }, count: 1, life: [0.8, 1.4], size: [0.4, 1.2], sprite: ['puff0', 'puff1'], color: [0xf4fcff, 0xdcefee], alpha: 0.35, drag: 2, rot: 6, rotSpeed: 0.3 });
        }
      }
    }
    // hull creaks under load
    this.creakT -= dt;
    if (this.creakT <= 0 && this.kind !== 'battery') {
      this.creakT = 5 + rnd.next() * 6;
      if (ctx.camera.position.distanceTo(this.pos) < 40) ctx.sfx('door_creak', this.pos, 0.25, 0.55 + rnd.next() * 0.2);
    }
    // a skiff's ram ("Sway"): the bronze prow at a hunter in the water
    if (this.kind === 'reed' && this.ramT > 0 && !this.ramHit && pl.alive) {
      this.toLocal(pl.pos, _w);
      if (Math.abs(_w.x) < this.beam * 0.6 && Math.abs(_w.z) < this.len * 0.5 && _w.y < 0.9) {
        this.ramHit = true;
        pl.takeHit({ base: 20 * waveScale(this.wave).dmg, kind: 'phys', source: 'contact', knock: 13 }, this.pos);
        _v.set(Math.sign(_w.x || 1), 0, 0).transformDirection(this.M);
        b.impulse.add(_v.multiplyScalar(11).setY(4));
        ctx.shake(0.4);
        ctx.sfx('crate_break', pl.pos, 0.9, 0.7);
        fl.splash(pl.pos.x, pl.pos.z, 1.6);
      }
    }
  }

  /** steer along the river around the hunter, keep off the banks, ram now and then */
  private sail(dt: number) {
    const fl = this.fleet;
    const pl = fl.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    let want = this.yaw;
    let topSpeed = this.kind === 'reed' ? 7.5 : 5.2;
    if (this.sinking) topSpeed = 0;
    else if (this.leaving) {
      want = Math.atan2(-dx, -dz);
      topSpeed *= 1.2;
    } else if (this.ramT > 0) {
      this.ramT -= dt;
      want = Math.atan2(dx + pl.board.vel.x * 0.4, dz + pl.board.vel.z * 0.4);
      topSpeed = 13;
    } else {
      // circle the hunter at a standoff, broadside on, following the channel where there is one
      const R = this.kind === 'reed' ? 15 : 22;
      const to = Math.atan2(dx, dz);
      const k = clamp((dist - R) / 14, -1, 1);
      want = to - this.side * (Math.PI / 2) * (1 - k * 0.75);
      const riv = fl.riverAt(this.pos.x, this.pos.z, this.hit);
      if (riv) {
        // follow the channel (with or against the flow, whichever is nearer), stay off the banks
        const a1 = Math.atan2(riv.tx, riv.tz), a2 = a1 + Math.PI;
        const da1 = Math.abs(wrap(a1 - want)), da2 = Math.abs(wrap(a2 - want));
        const ch = da1 < da2 ? a1 : a2;
        const across = clamp(riv.u / Math.max(4, riv.hw - this.beam * 2), -1.4, 1.4);
        const toCentre = (ch === a1 ? 1 : -1) * across * 0.5;
        want = blendAngle(want, ch + toCentre, dist > R + 10 ? 0.35 : 0.65);
      }
      this.ramCd -= dt;
      if (this.kind === 'reed' && this.ramCd <= 0 && dist > 9 && dist < 28 && !fl.playerOnLand() && this.crew.length > 0) {
        this.ramCd = 9 + rnd.next() * 6;
        this.ramT = 2.6;
        this.ramHit = false;
        this.say(this.def.moveTitles?.ram ?? 'Sway');
        fl.enemies.warn.lane(this.pos.x, this.pos.z, dx / dist, dz / dist, Math.min(30, dist + 6), 3.2, 0.9, 'heavy');
        fl.ctx.sfx('whoosh_big', this.pos, 0.7, 0.7);
      }
    }
    // pick the first navigable heading near the wish
    const look = this.kind === 'reed' ? [5, 11] : [8, 16];
    let pick = want;
    let ok = false;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, Math.PI]) {
      const a = want + off;
      const sx = Math.sin(a), sz = Math.cos(a);
      if (this.navigable(this.pos.x + sx * look[0], this.pos.z + sz * look[0]) && this.navigable(this.pos.x + sx * look[1], this.pos.z + sz * look[1])) {
        pick = a;
        ok = true;
        if (off !== 0 && rnd.chance(dt * 0.4)) this.side = -this.side;
        break;
      }
    }
    if (!ok) topSpeed *= 0.3;
    const rate = this.kind === 'reed' ? (this.ramT > 0 ? 1.4 : 0.9) : 0.42;
    const prev = this.yaw;
    const dd = clamp(wrap(pick - this.yaw), -rate * dt, rate * dt);
    this.yaw += dd;
    this.turn = damp(this.turn, dd / Math.max(dt, 1e-3), 4, dt);
    const sharp = Math.abs(wrap(pick - this.yaw));
    const target = topSpeed * (1 - clamp(sharp / 1.6, 0, 0.6));
    this.speed = damp(this.speed, target, this.kind === 'reed' ? 1.4 : 0.6, dt);
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    if (this.navigable(nx, nz) || !ok) {
      this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.speed *= 0.5;
      this.vel.set(0, 0, 0);
    }
    void prev;
    // keep clear of the other hulls
    for (const o of fl.hulls) {
      if (o === this || o.kind === 'battery' || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d = Math.hypot(ox, oz);
      const min = (this.len + o.len) * 0.4;
      if (d < min && d > 1e-3) {
        this.pos.x += (ox / d) * (min - d) * dt * 2;
        this.pos.z += (oz / d) * (min - d) * dt * 2;
      }
    }
    if (this.leaving && (dist > 75 || this.t > 600)) this.dispose();
  }

  private animateRig(dt: number) {
    const n = this.rig.nodes;
    const t = this.t;
    // oars sweep in time (the drummer's beat), lift on the recovery
    const stroke = this.speed > 0.5 && !this.sinking;
    for (let i = 1; i <= 8; i++)
      for (const s of ['l', 'r']) {
        const o = n[`oar_${s}${i}`];
        if (!o) continue;
        const ph = t * 2.2 - i * 0.12;
        const sg = s === 'l' ? 1 : -1;
        o.rotation.y = stroke ? Math.sin(ph) * 0.38 * sg : damp(o.rotation.y, 0, 2, dt);
        o.rotation.z = stroke ? (Math.cos(ph) > 0 ? 0.12 : -0.05) * sg : damp(o.rotation.z, -0.25 * sg, 2, dt);
      }
    if (n['sail']) {
      n['sail'].rotation.y = Math.sin(t * 0.3) * 0.12 + this.turn * 0.4;
      n['sail'].scale.z = 1 + Math.sin(t * 2.1) * 0.06 + this.speed * 0.02;
    }
    if (n['oar_st']) n['oar_st'].rotation.y = clamp(-this.turn * 0.8, -0.5, 0.5);
    for (const s of ['rudder_l', 'rudder_r']) if (n[s]) n[s].rotation.y = clamp(-this.turn * 0.7, -0.4, 0.4);
    for (const s of ['wheel_l', 'wheel_r']) if (n[s]) n[s].rotation.x = -(this.guns[0]?.aimYaw ?? 0) * 2;
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    for (const c of this.crew) {
      c.e.mount = null;
      if (this.leaving) c.e.alive = false;
    }
    this.crew = [];
    this.root.removeFromParent();
    this.rig.material.dispose();
    this.fleet.enemies.unregisterExternal(this);
  }
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
const blendAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;

// ============================================================================ the fleet
export interface FleetDeps {
  ctx: Ctx;
  player: PlayerLink & { alive: boolean };
  enemies: Enemies;
}

/** crew rosters per vessel (station order: bow first) */
const CREWS: Record<Kind, string[][]> = {
  reed: [
    ['nileFalcon', 'nileJackalSpear', 'nileWolf'],
    ['nileFalcon', 'nileFalcon', 'nileWolf'],
    ['nileJackalSpear', 'nileFalcon', 'nileJackalSpear'],
  ],
  barge: [
    ['nileBaboon', 'nileFalcon', 'nileFalcon', 'nileWolf', 'nileJackalSpear', 'nileRam'],
    ['nileBaboon', 'nileWolf', 'nileFalcon', 'nileHippo', 'nileFalcon', 'nileRam'],
  ],
  battery: [['nileBaboon', 'nileBaboon'], ['nileBaboon', 'nileFalcon']],
};

export class NileFleet {
  static nextId = 950000;
  hulls: Hull[] = [];
  readonly ctx: Ctx;
  readonly player: FleetDeps['player'];
  readonly enemies: Enemies;
  private hooked: { world: any; groundAt: any; surface: any; normal: any } | null = null;
  private flatLevel: number | null = null;
  private riverOut = { u: 0, hw: 0, tx: 0, tz: 1 };

  constructor(d: FleetDeps) {
    this.ctx = d.ctx;
    this.player = d.player;
    this.enemies = d.enemies;
    this.enemies.vesselSpawner = (id, x, z, o) => this.spawn(id, x, z, o);
    this.hook();
    if (typeof window !== 'undefined') {
      (window as any).__fleet = this; // dev: __fleet.spawn('warBarge', x, z), __fleet.lineup(), __fleet.review()
      // ?army=soldiers | boats | all: a review of the Queen's army near the hunter (screenshots)
      const army = new URLSearchParams(location.search).get('army');
      if (army) this.ctx.engine.tweens.after(2.5, () => {
        if (army === 'soldiers' || army === 'all') this.lineup();
        if (army === 'boats' || army === 'all') this.review();
      });
    }
  }

  /** dev: every soldier type in a row in front of the camera, pinned and holding fire */
  lineup(ids = NILE_SOLDIERS, dist = 8) {
    const pp = this.player.pos;
    this.ctx.camera.getWorldDirection(_v);
    const yaw = Math.atan2(_v.x, _v.z);
    const out: Enemy[] = [];
    ids.forEach((id, i) => {
      const a = yaw + (i - (ids.length - 1) / 2) * 0.2;
      const x = pp.x + Math.sin(a) * dist, z = pp.z + Math.cos(a) * dist;
      const e = this.enemies.spawn(id, x, z, { emerge: 'run' });
      if (!e) return;
      e.cds.fill(999);
      const at = e.pos.clone();
      e.mount = {
        place: (en: Enemy) => {
          en.pos.x = at.x;
          en.pos.z = at.z;
          en.vel.x = 0;
          en.vel.z = 0;
          en.yaw = Math.atan2(this.player.pos.x - en.pos.x, this.player.pos.z - en.pos.z);
          if (en.state === 'windup' || en.state === 'charge' || en.state === 'leap') en.state = 'move';
        },
      };
      out.push(e);
    });
    return out;
  }
  /** dev: a war barge, a reed skiff and a shore cannon near the hunter */
  review() {
    const pp = this.player.pos;
    this.ctx.camera.getWorldDirection(_v);
    const yaw = Math.atan2(_v.x, _v.z);
    const at = (a: number, d: number) => ({ x: pp.x + Math.sin(yaw + a) * d, z: pp.z + Math.cos(yaw + a) * d });
    const b = at(0.1, 26), r = at(-0.6, 20), c = at(0.7, 22);
    return [this.spawn('warBarge', b.x, b.z), this.spawn('reedBoat', r.x, r.z), this.spawn('bankCannon', c.x, c.z)];
  }

  get world() {
    return this.ctx.world;
  }
  get water(): WaterLike | null {
    const w = (this.world as unknown as { water?: unknown }).water as WaterLike | null | undefined;
    return w && typeof w.heightAt === 'function' ? w : null;
  }
  /** the river (or the fallback level) under a point */
  waterAt(x: number, z: number) {
    const w = this.water;
    if (w) return Math.max(w.heightAt(x, z), this.baseGround(x, z) - 0.2);
    // no river here: a flat fallback level; where the sand rises above it, boats glide over the sand
    if (this.flatLevel === null) this.flatLevel = (this.world.sa.waterLevel ?? -1e9) > -100 ? this.world.sa.waterLevel : this.baseGround(this.player.pos.x, this.player.pos.z) - 0.3;
    return Math.max(this.flatLevel, this.baseGround(x, z) + 0.15);
  }
  /** the water surface (or ground) height where a ball lands */
  surfaceAt(x: number, z: number) {
    return Math.max(this.waterAt(x, z), this.baseGround(x, z));
  }
  /** deep enough water to float on (always true without a river: the sand-yacht fallback) */
  wet(x: number, z: number, depth = 0.5) {
    const w = this.water;
    if (!w) return true;
    if (w.isWater) return w.isWater(x, z, depth);
    return w.heightAt(x, z) - this.baseGround(x, z) > depth;
  }
  riverAt(x: number, z: number, out: RiverHitLike): RiverHitLike | null {
    const net = (this.world as unknown as { nile?: { river?: { hit?(x: number, z: number, o: unknown): unknown } } }).nile?.river;
    if (!net?.hit) return null;
    const h = net.hit(x, z, out) as RiverHitLike | null;
    return h ?? null;
  }
  splash(x: number, z: number, size = 1) {
    const w = this.water;
    const y = this.waterAt(x, z);
    if (w?.splash) w.splash(x, z, size);
    const P = this.ctx.particles;
    P.emit({ pos: { x, y: y + 0.1, z }, count: Math.round(16 * size), vel: { x: 0, y: 4.2 * Math.sqrt(size), z: 0 }, spread: 2.6 * size, gravity: 14, drag: 0.3, life: [0.5, 1.0], size: [0.14, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: SPRAY, ground: true, jitter: 0.5 * size });
    P.emit({ pos: { x, y: y + 0.3, z }, count: Math.round(3 * size), spread: 1.0 * size, up: 1.2, life: [0.6, 1.2], size: [0.5 * size, 1.3 * size], sprite: ['puff0', 'puff1'], color: [0xf0fbff, 0xd0eef0], alpha: 0.5, drag: 2.2, rot: 6, rotSpeed: 0.5 });
  }
  /** the hunter is on dry land (crew may leap / charge at him) */
  playerOnLand() {
    const p = this.player.pos;
    return !this.wet(p.x, p.z, 0.3) && !this.deckOf(p.x, p.z);
  }
  /** a crewman thrown into deep water: splash, sinks, gone */
  drown(e: Enemy) {
    if (!e.alive) return;
    this.splash(e.pos.x, e.pos.z, 1.1);
    this.enemies.damage(e, { base: 99999, kind: 'phys', source: 'explosion', knock: 2, canCrit: false });
  }
  wait(s: number) {
    return this.ctx.engine.tweens.wait(s);
  }

  // ------------------------------------------------------------------ the deck layer of the world
  private baseGround(x: number, z: number): number {
    return this.hooked ? this.hooked.groundAt(x, z) : this.world.groundAt(x, z);
  }
  deckOf(x: number, z: number): Hull | null {
    for (const h of this.hulls) if (h.alive && h.kind !== 'battery' && h.deckAt(x, z) !== null) return h;
    return null;
  }
  deckHeight(x: number, z: number): number | null {
    let best: number | null = null;
    for (const h of this.hulls) {
      if (!h.alive || h.kind === 'battery') continue;
      const d = h.deckAt(x, z);
      if (d !== null && (best === null || d > best)) best = d;
    }
    return best;
  }
  /** layer the decks into the world's ground / board surface / normal (re-hooks if the world changes) */
  private hook() {
    const w = this.world as any;
    if (this.hooked?.world === w) return;
    this.unhook();
    const groundAt = w.groundAt, surface = w.surface, normal = w.normal;
    this.hooked = { world: w, groundAt, surface, normal };
    w.groundAt = (x: number, z: number) => {
      const g = groundAt(x, z);
      if (!this.hulls.length) return g;
      const d = this.deckHeight(x, z);
      return d !== null && d > g ? d : g;
    };
    w.surface = (x: number, z: number, out: any) => {
      surface(x, z, out);
      if (!this.hulls.length) return out;
      const d = this.deckHeight(x, z);
      if (d !== null && d > out.h) {
        out.h = d;
        out.kind = 'hard';
        out.drag = 0.003;
        out.speedMul = 1.04;
        out.flowX = 0;
        out.flowZ = 0;
        out.roll = 0;
        out.lava = false;
      }
      return out;
    };
    w.normal = (x: number, z: number, out: THREE.Vector3) => {
      if (this.hulls.length) {
        const d = this.deckHeight(x, z);
        if (d !== null && d > groundAt(x, z)) return out.set(0, 1, 0);
      }
      return normal(x, z, out);
    };
  }
  private unhook() {
    const h = this.hooked;
    if (!h) return;
    h.world.groundAt = h.groundAt;
    h.world.surface = h.surface;
    h.world.normal = h.normal;
    this.hooked = null;
  }

  // ------------------------------------------------------------------ spawning
  /** find a spot on the river near (x, z) (deep enough, out from the banks), or null */
  private findWater(x: number, z: number, depth: number, minR = 0): { x: number; z: number } | null {
    if (!this.water) return { x, z };
    const pp = this.player.pos;
    for (let r = 0; r <= 90; r += 6)
      for (let k = 0; k < Math.max(1, Math.round(r / 3)); k++) {
        const a = (k / Math.max(1, Math.round(r / 3))) * TAU + r * 0.37;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (Math.hypot(px - pp.x, pz - pp.z) < minR) continue;
        if (this.world.storm.sdf(px, pz) < 8) continue;
        if (this.wet(px, pz, depth) && this.wet(px + 4, pz, depth) && this.wet(px - 4, pz, depth) && this.wet(px, pz + 4, depth) && this.wet(px, pz - 4, depth)) return { x: px, z: pz };
      }
    return null;
  }
  /** a dry bank spot looking over the water near (x, z) */
  private findBank(x: number, z: number): { x: number; z: number; yaw: number } | null {
    const pp = this.player.pos;
    if (!this.water) return { x, z, yaw: Math.atan2(pp.x - x, pp.z - z) };
    for (let r = 0; r <= 80; r += 5)
      for (let k = 0; k < Math.max(1, Math.round(r / 2.5)); k++) {
        const a = (k / Math.max(1, Math.round(r / 2.5))) * TAU + r * 0.21;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (Math.hypot(px - pp.x, pz - pp.z) < 16 || this.world.storm.sdf(px, pz) < 8) continue;
        if (this.wet(px, pz, 0.05)) continue;
        // water within reach, flat enough to stand a gun on
        let wx = 0, wz = 0, n = 0;
        for (let j = 0; j < 12; j++) {
          const b = (j / 12) * TAU;
          for (const d of [7, 12, 18])
            if (this.wet(px + Math.sin(b) * d, pz + Math.cos(b) * d, 0.6)) {
              wx += Math.sin(b);
              wz += Math.cos(b);
              n++;
              break;
            }
        }
        if (!n) continue;
        const g0 = this.baseGround(px, pz);
        if (Math.abs(this.baseGround(px + 1.5, pz) - g0) > 0.8 || Math.abs(this.baseGround(px, pz + 1.5) - g0) > 0.8) continue;
        return { x: px, z: pz, yaw: Math.atan2(wx, wz) };
      }
    return null;
  }

  spawn(id: string, x: number, z: number, o: { alpha?: boolean } = {}): Enemy | null {
    const def = ENEMIES[id];
    if (!def) return null;
    this.hook();
    const kind: Kind = id === 'warBarge' ? 'barge' : id === 'bankCannon' ? 'battery' : 'reed';
    const entry = modelEntry(def.rig);
    const spec = entry?.() as RigSpec | undefined;
    if (!spec?.parts) return null;
    const pp = this.player.pos;
    let at: { x: number; z: number; yaw?: number } | null;
    if (kind === 'battery') at = this.findBank(x, z);
    else at = this.findWater(x, z, ((spec.meta?.draft as number) ?? 0.3) + 0.6, kind === 'barge' ? 20 : 14);
    if (!at) return null;
    const yaw = at.yaw ?? Math.atan2(pp.x - at.x, pp.z - at.z) + (rnd.next() - 0.5) * 1.2 + Math.PI / 2;
    const h = new Hull(this, def, kind, spec, at.x, at.z, yaw);
    this.hulls.push(h);
    // the crew
    const roster = rnd.pick(CREWS[kind]);
    const stations = (spec.meta?.stations as number[][]) ?? [];
    let first: Enemy | null = null;
    roster.forEach((cid, i) => {
      const st = stations[i];
      if (!st) return;
      const loc = new THREE.Vector3(st[0], st[1], st[2]);
      _v.copy(loc).applyMatrix4(h.M);
      const e = this.enemies.spawn(cid, _v.x, _v.z, { alpha: !!o.alpha && i === 0, emerge: 'run' });
      if (!e) return;
      h.addCrew(e, loc, cid === 'nileBaboon');
      first = first ?? e;
    });
    if (kind !== 'battery') this.splash(at.x, at.z, kind === 'barge' ? 2.2 : 1.4);
    else this.ctx.fx.dust({ x: at.x, y: this.baseGround(at.x, at.z) + 0.3, z: at.z }, 1.4, 0xd8bc8a, 4);
    return first;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    if (!this.hulls.length) return;
    this.hook();
    for (const h of this.hulls) if (h.alive) h.update(dt);
    this.hulls = this.hulls.filter((h) => h.alive);
  }

  clear() {
    for (const h of [...this.hulls]) h.dispose();
    this.hulls = [];
  }

  dispose() {
    this.clear();
    this.unhook();
    if (this.enemies.vesselSpawner) this.enemies.vesselSpawner = null;
    if (typeof window !== 'undefined' && (window as any).__fleet === this) delete (window as any).__fleet;
  }
}

/** Mount type guard for Enemies */
export function isHull(x: unknown): x is Hull {
  return x instanceof Hull;
}
void UP;
void _q;
void _m;
