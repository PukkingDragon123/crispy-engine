// Desert wildlife: sand hippo herds, little jerboas and healing cacti.
//
//  SAND HIPPOS (one herd per zone, on the first `wildlifeSpot`): 2-3 adults and
//   1-2 calves roam round their home spot, idle (ear twirls, blinks, honks),
//   wallow (lie sunk in the sand), burrow (sink until only the eyes, ears,
//   nostrils and a hump of back show), yawn (the wide tusky gape). Neutral to
//   the hunter. Enemies that come near the herd get charged and bitten ("You
//   Could Be Mine"): thrown flat, heavy damage.
//   BOUNCE: land on a hippo's back and it springs you high like a trampoline
//   (big air for tricks, chains "HIPPO HOP xN" into the style combo); ride into
//   its flank fast and it pops you up over it.
//   CALVES: [T] pick one up (it sits on your head, legs paddling), [T] again to
//   throw it ("Sweet Child o' Mine") — at the enemy nearest your aim, else at the
//   aim point. It bowls over whatever it hits and bounces off unharmed, squeals,
//   and every adult within 45 m is ENRAGED: they bellow and STAMPEDE ("Wild
//   Horses") through the enemies there for ~14 s, trampling and biting. While
//   enraged they flatten the hunter too if he gets in the way.
//  JERBOAS (one group per zone, on the second `wildlifeSpot`): hop about in
//   bouncy chains, sit, sit up like periscopes, wash their faces; scatter from
//   the hunter, enemies and charging hippos, then crouch and calm down.
//  HEALING CACTI (clusters by every oasis and camp): prickly pears and barrels.
//   Shoot, kick or ride through one and it bursts in a splash of sap that heals
//   the hunter (within 5 m) by 30% of max HP; it sprouts back after ~50 s.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { Wildlife } from '../run/Wildlife';
//   field:   wildlife: Wildlife | null = null;
//   enter(): right after `this.ruins = new RuinNests({...})` (before the first populateZone):
//              this.wildlife = new Wildlife({ ctx: this.ctx, player: this.player, enemies: this.enemies, inter: this.inter });
//   populateZone(z): at the end:   this.wildlife?.populateZone(z);
//   update():  next to `this.ruins?.update(dt);`:   this.wildlife?.update(dt);
//   exit():    this.wildlife?.dispose();
import * as THREE from 'three';
import type { Ctx, RayHit } from '../Ctx';
import type { Enemies, Enemy, ExternalTarget } from '../enemies/Enemies';
import type { Player } from '../player/Player';
import type { ZoneDef } from '../world/RegionGen';
import type { Interactable } from './Interact';
import type { Hit } from '../combat/Damage';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { clamp, damp, dampAngle, rnd, wrapAngle } from '../../engine/math/rand';
import { sandHippoRig, babyHippoRig, HippoAnim } from '../models/creatures/hippo';
import { jerboaPupRig, JerboaPupAnim, type PupMode } from '../models/creatures/jerboaSmall';
import { healCactusRig, CactusSway } from '../models/creatures/healCactus';

export interface WildlifeDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  inter: { add(i: Interactable): unknown; remove(i: Interactable): void };
}

const TITLES = { bite: 'You Could Be Mine', throw: "Sweet Child o' Mine", stampede: 'Wild Horses', bounce: "Jumpin' Jack Flash" };
const GRAV = 22;
const TERRITORY = 13;
const ENRAGE_R = 45;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _res = { x: 0, z: 0, nx: 0, nz: 0, hit: null as unknown };

// ============================================================================ hippos
type HState = 'idle' | 'walk' | 'wallow' | 'burrow' | 'yawn' | 'alert' | 'charge' | 'bite' | 'recover' | 'stampede' | 'follow' | 'play' | 'carried' | 'thrown' | 'dizzy';
interface HMeta {
  s: number;
  backY: number;
  halfLen: number;
  halfWid: number;
  radius: number;
  height: number;
}
interface Hippo {
  rig: RigInstance;
  anim: HippoAnim;
  baby: boolean;
  herd: Herd;
  mother: Hippo | null;
  m: HMeta;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  turn: number;
  pitch: number;
  roll: number;
  st: HState;
  t: number;
  dur: number;
  goal: THREE.Vector3;
  foe: Enemy | null;
  bites: number;
  bitDone: boolean;
  sink: number;
  yawn: number;
  bite: number;
  rage: number;
  look: number;
  rageT: number;
  rageAt: THREE.Vector3;
  bounceCd: number;
  bounced: number;
  gruntCd: number;
  thinkT: number;
  stepT: number;
  hurtCd: number;
  trampled: Map<number, number>;
  inter: Interactable | null;
  vel: THREE.Vector3;
  hops: number;
  spin: number;
  tumble: number;
  hitIds: Set<number>;
  enraged: boolean;
  /** seconds into a stampede before it will run the hunter down (he just threw the calf) */
  grace: number;
}
interface Herd {
  home: THREE.Vector3;
  r: number;
  members: Hippo[];
  group: THREE.Group;
  calloutT: number;
}

// ============================================================================ jerboas
interface Pup {
  rig: RigInstance;
  anim: JerboaPupAnim;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  st: PupMode | 'flee';
  t: number;
  dur: number;
  hopT: number;
  hopDur: number;
  hopH: number;
  hops: number;
  fleeT: number;
  threat: THREE.Vector3;
  thinkT: number;
}
interface Colony {
  home: THREE.Vector3;
  r: number;
  pups: Pup[];
  group: THREE.Group;
}

// ============================================================================ healing cacti
let CACTUS_ID = 910000;
class HealCactus implements ExternalTarget {
  id = CACTUS_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius: number;
  height: number;
  alive = true;
  isBoss = false;
  hp = 1;
  maxHp = 1;
  name = 'Healing Cactus';
  rig: RigInstance;
  sway: CactusSway;
  broken = false;
  regrowT = 0;
  growing = false;
  registered = false;
  touchCd = 0;
  kind: 'pear' | 'barrel';
  constructor(private wl: Wildlife, x: number, y: number, z: number, seed: number, kind: 'pear' | 'barrel', group: THREE.Group) {
    this.kind = kind;
    const spec = healCactusRig(seed, kind);
    this.rig = new RigInstance(buildRigGeo(spec, spec.name), { castShadow: true });
    this.rig.root.position.set(x, y - 0.03, z);
    this.rig.root.rotation.y = rnd.next() * Math.PI * 2;
    group.add(this.rig.root);
    this.sway = new CactusSway(this.rig);
    this.pos.set(x, y, z);
    this.radius = spec.meta?.radius ?? 0.45;
    this.height = spec.meta?.height ?? 1;
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive) return null;
    // vertical capsule round the stem
    const r = this.radius * 0.85;
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z;
    const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-9) return null;
    let t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) t = (-b + Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxT) return null;
    const y = o.y + d.y * t;
    if (y < this.pos.y || y > this.pos.y + this.height) return null;
    const point = new THREE.Vector3(o.x + d.x * t, y, o.z + d.z * t);
    return { enemy: this, t, point, normal: new THREE.Vector3(point.x - this.pos.x, 0, point.z - this.pos.z).normalize(), headshot: false, part: 'body', surface: 'enemy' };
  }
  takeDamage(hit: Hit, _point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive) return 0;
    this.wl.burstCactus(this, dir ? dir.x : hit.dirX ?? 0, dir ? dir.z : hit.dirZ ?? 0);
    return 1;
  }
}

export class Wildlife {
  private herds: Herd[] = [];
  private colonies: Colony[] = [];
  private cacti: HealCactus[] = [];
  private done = new Set<number>();
  private group = new THREE.Group();
  private t = 0;
  private carry: Hippo | null = null;
  private throwInter: Interactable;
  private bounceChain = 0;
  private bounceAt = -99;
  private firstBounce = true;
  private firstCarry = true;
  private firstSap = true;
  private stampedeT = -99;
  private offExplosion: () => void;

  constructor(private d: WildlifeDeps) {
    this.group.name = 'wildlife';
    d.ctx.scene.add(this.group);
    this.throwInter = {
      pos: new THREE.Vector3(),
      radius: 60,
      label: 'Throw the Hippo Calf',
      enabled: false,
      promptY: 2.6,
      use: () => this.throwCalf(),
    };
    d.inter.add(this.throwInter);
    // blasts burst healing cacti wherever they are (the shootable target is only registered near the hunter)
    this.offExplosion = d.ctx.events.on('explosion', (pos: { x: number; y: number; z: number }, r: number) => {
      for (const c of this.cacti) {
        if (!c.alive) continue;
        const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
        if (Math.hypot(dx, dz) < r + c.radius && Math.abs(c.pos.y - pos.y) < r + c.height) this.burstCactus(c, dx, dz);
      }
    });
  }

  // ======================================================================== per zone
  populateZone(z: ZoneDef) {
    if (this.done.has(z.index)) return;
    this.done.add(z.index);
    if (z.theme === 'arena' || z.theme === 'apex') return;
    const world = this.d.ctx.world;
    const spots = z.anchors.filter((a) => a.kind === 'wildlifeSpot');
    try {
      const hs = spots[0] ? { x: spots[0].x, z: spots[0].z } : world.findOpenSpot(z, 14, { strict: false, minDist: z.r * 0.25 });
      if (hs && (spots[0]?.data?.habitat !== 'rocks' || rnd.chance(0.5))) this.addHerd(hs.x, hs.z, z.index === 0 ? 2 : 2 + (rnd.chance(0.5) ? 1 : 0));
    } catch (e) {
      console.warn('[wildlife] herd failed', e);
    }
    try {
      const js = spots[1] ? { x: spots[1].x, z: spots[1].z } : world.findOpenSpot(z, 8, { strict: false });
      if (js) this.addColony(js.x, js.z, 4 + Math.floor(rnd.next() * 3));
    } catch (e) {
      console.warn('[wildlife] jerboas failed', e);
    }
    try {
      let clusters = 0;
      for (const a of z.anchors) {
        if (a.kind !== 'oasisPool') continue;
        const r = a.data?.r ?? 9;
        this.addCluster(z, a.x, a.z, r * 1.3, r * 1.75, 3 + Math.floor(rnd.next() * 3));
        clusters++;
      }
      for (const p of z.pois) {
        if (p.kind !== 'camp') continue;
        this.addCluster(z, p.x, p.z, Math.max(9, p.r * 0.8), Math.max(14, p.r * 1.2), 2 + Math.floor(rnd.next() * 3));
        clusters++;
      }
      if (!clusters) {
        const sp = world.findOpenSpot(z, 4, { strict: false, minDist: z.r * 0.2, maxDist: z.r * 0.8 });
        if (sp) this.addCluster(z, sp.x, sp.z, 0, 3.5, 3);
      }
    } catch (e) {
      console.warn('[wildlife] cacti failed', e);
    }
  }

  private addHerd(x: number, z: number, adults: number) {
    const world = this.d.ctx.world;
    const herd: Herd = { home: new THREE.Vector3(x, world.groundAt(x, z), z), r: 14, members: [], group: new THREE.Group(), calloutT: -99 };
    this.group.add(herd.group);
    const aSpec = sandHippoRig(), bSpec = babyHippoRig();
    const aGeo = buildRigGeo(aSpec, 'sand_hippo'), bGeo = buildRigGeo(bSpec, 'baby_hippo');
    const mothers: Hippo[] = [];
    for (let i = 0; i < adults; i++) {
      const a = (i / adults) * Math.PI * 2 + rnd.next();
      const h = this.makeHippo(herd, aGeo, false, x + Math.cos(a) * 4, z + Math.sin(a) * 4);
      mothers.push(h);
      if (rnd.chance(0.35)) this.setState(h, rnd.chance(0.6) ? 'wallow' : 'burrow');
    }
    const calves = 1 + (adults > 2 || rnd.chance(0.4) ? 1 : 0);
    for (let i = 0; i < calves; i++) {
      const mom = mothers[i % mothers.length];
      const b = this.makeHippo(herd, bGeo, true, mom.pos.x + 1.8, mom.pos.z + 1.2);
      b.mother = mom;
      this.setState(b, 'follow');
      b.inter = {
        pos: b.pos.clone(),
        radius: 2.4,
        label: 'Pick up the Hippo Calf',
        enabled: true,
        promptY: 1.0,
        use: () => this.pickUp(b),
      };
      this.d.inter.add(b.inter);
    }
    this.herds.push(herd);
  }

  private makeHippo(herd: Herd, geo: ReturnType<typeof buildRigGeo>, baby: boolean, x: number, z: number): Hippo {
    const world = this.d.ctx.world;
    const rig = new RigInstance(geo, { castShadow: true });
    rig.root.rotation.order = 'YXZ';
    herd.group.add(rig.root);
    const meta = geo.spec.meta ?? {};
    const pos = new THREE.Vector3(x, world.groundAt(x, z), z);
    const h: Hippo = {
      rig,
      anim: new HippoAnim(rig),
      baby,
      herd,
      mother: null,
      m: { s: meta.scale ?? 1, backY: meta.backY ?? 1.58, halfLen: meta.halfLen ?? 1.5, halfWid: meta.halfWid ?? 0.78, radius: meta.radius ?? 0.85, height: meta.height ?? 1.7 },
      pos,
      yaw: rnd.next() * Math.PI * 2,
      speed: 0,
      turn: 0,
      pitch: 0,
      roll: 0,
      st: 'idle',
      t: 0,
      dur: 2 + rnd.next() * 4,
      goal: pos.clone(),
      foe: null,
      bites: 0,
      bitDone: false,
      sink: 0,
      yawn: 0,
      bite: -1,
      rage: 0,
      look: 0,
      rageT: 0,
      rageAt: new THREE.Vector3(),
      bounceCd: 0,
      bounced: 0,
      gruntCd: 4 + rnd.next() * 8,
      thinkT: rnd.next() * 0.3,
      stepT: 0,
      hurtCd: 0,
      trampled: new Map(),
      inter: null,
      vel: new THREE.Vector3(),
      hops: 0,
      spin: 0,
      tumble: 0,
      hitIds: new Set(),
      enraged: false,
      grace: 0,
    };
    herd.members.push(h);
    this.place(h, 1);
    return h;
  }

  private addColony(x: number, z: number, n: number) {
    const world = this.d.ctx.world;
    const col: Colony = { home: new THREE.Vector3(x, world.groundAt(x, z), z), r: 7, pups: [], group: new THREE.Group() };
    this.group.add(col.group);
    const spec = jerboaPupRig();
    const geo = buildRigGeo(spec, 'jerboa_pup');
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * 4;
      const p = new THREE.Vector3(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
      p.y = world.groundAt(p.x, p.z);
      const rig = new RigInstance(geo, { castShadow: true });
      rig.root.position.copy(p);
      const yaw = rnd.next() * Math.PI * 2;
      rig.root.rotation.y = yaw;
      rig.root.scale.setScalar(0.9 + rnd.next() * 0.2);
      col.group.add(rig.root);
      const pup: Pup = { rig, anim: new JerboaPupAnim(rig), pos: p, from: p.clone(), to: p.clone(), yaw, st: 'sit', t: 0, dur: 1 + rnd.next() * 3, hopT: 0, hopDur: 0.4, hopH: 0.2, hops: 0, fleeT: 0, threat: new THREE.Vector3(), thinkT: rnd.next() * 0.2 };
      col.pups.push(pup);
    }
    this.colonies.push(col);
  }

  private addCluster(z: ZoneDef, cx: number, cz: number, r0: number, r1: number, n: number) {
    const world = this.d.ctx.world;
    // the clump sits in one patch on the ring; its plants a metre or two apart
    const ang = rnd.next() * Math.PI * 2;
    const rr = r0 + (r1 - r0) * rnd.next();
    const ax = cx + Math.cos(ang) * rr, az = cz + Math.sin(ang) * rr;
    for (let i = 0; i < n; i++) {
      const sp = world.findOpenSpot(z, 0.8, { near: { x: ax, z: az }, minDist: i ? 1.2 : 0, maxDist: 3.2 + i * 0.6, strict: true, maxSlope: 0.5, tries: 24 });
      if (!sp) continue;
      if (this.cacti.some((c) => Math.hypot(c.pos.x - sp.x, c.pos.z - sp.z) < 1.3)) continue;
      const kind: 'pear' | 'barrel' = rnd.chance(0.3) ? 'barrel' : 'pear';
      const seed = Math.floor(rnd.next() * (kind === 'pear' ? 6 : 3));
      this.cacti.push(new HealCactus(this, sp.x, world.groundAt(sp.x, sp.z), sp.z, seed, kind, this.group));
    }
  }

  // ======================================================================== frame
  update(dt: number) {
    this.t += dt;
    const pl = this.d.player;
    this.throwInter.enabled = !!this.carry && pl.alive;
    this.throwInter.pos.copy(pl.pos);
    for (const herd of this.herds) {
      const dist = Math.hypot(herd.home.x - pl.pos.x, herd.home.z - pl.pos.z);
      let busy = false;
      for (const h of herd.members) if (h.st === 'carried' || h.st === 'thrown' || h.st === 'dizzy' || h.rageT > 0 || h.st === 'charge') busy = true;
      herd.group.visible = dist < 170 || busy;
      if (dist > 150 && !busy) continue;
      for (const h of herd.members) this.updateHippo(h, dt);
      this.separate(herd);
    }
    for (const c of this.colonies) {
      const dist = Math.hypot(c.home.x - pl.pos.x, c.home.z - pl.pos.z);
      c.group.visible = dist < 95;
      if (dist > 85) continue;
      for (const p of c.pups) this.updatePup(c, p, dt);
    }
    this.updateCacti(dt);
  }

  // ======================================================================== hippo brain
  private setState(h: Hippo, st: HState, dur = 0) {
    h.st = st;
    h.t = 0;
    h.dur = dur;
    h.bitDone = false;
    if (st === 'idle') h.dur = dur || 2.5 + rnd.next() * 4.5;
    if (st === 'walk') {
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * h.herd.r;
      h.goal.set(h.herd.home.x + Math.cos(a) * r, 0, h.herd.home.z + Math.sin(a) * r);
      h.dur = dur || 14;
    }
    if (st === 'wallow') h.dur = dur || 9 + rnd.next() * 8;
    if (st === 'burrow') h.dur = dur || 12 + rnd.next() * 12;
    if (st === 'yawn') h.dur = 2.6;
    if (st === 'alert') h.dur = h.rageT > 0 ? 0.9 : 0.7;
    if (st === 'bite') h.dur = 0.72;
    if (st === 'recover') h.dur = 0.55;
  }

  /** an enemy worth charging: alive, on the ground, not a boss */
  private fair(e: Enemy) {
    return e.alive && !e.isBoss && !e.flying && e.state !== 'hidden' && e.state !== 'burrow';
  }
  private nearestFoe(p: THREE.Vector3, r: number, around?: THREE.Vector3, aroundR = 0): Enemy | null {
    let best: Enemy | null = null, bd = r;
    for (const e of this.d.enemies.list) {
      if (!this.fair(e)) continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (around && Math.hypot(e.pos.x - around.x, e.pos.z - around.z) > aroundR) continue;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updateHippo(h: Hippo, dt: number) {
    const ctx = this.d.ctx, pl = this.d.player, pp = pl.pos;
    h.t += dt;
    h.bounceCd -= dt;
    h.gruntCd -= dt;
    h.thinkT -= dt;
    h.hurtCd -= dt;
    h.grace -= dt;
    if (h.rageT > 0) h.rageT -= dt;
    let target = 0; // desired speed
    let maxTurn = h.baby ? 3.2 : 1.5;
    let mode: 'normal' | 'carried' | 'thrown' | 'dizzy' = 'normal';
    h.sink = 0;
    h.yawn = damp(h.yawn, 0, 3, dt);
    h.bite = -1;
    let lookTarget: THREE.Vector3 | null = null;
    const s = h.m.s;

    if (h.baby) {
      if (h.st === 'carried') return this.updateCarried(h, dt);
      if (h.st === 'thrown') return this.updateThrown(h, dt);
    } else if (h.thinkT <= 0) {
      h.thinkT = 0.25;
      this.think(h);
    }

    switch (h.st) {
      case 'idle':
        if (Math.hypot(pp.x - h.pos.x, pp.z - h.pos.z) < 12) lookTarget = pp;
        if (h.t > h.dur) this.pickIdle(h);
        break;
      case 'walk':
        target = 1.15 * (h.baby ? 0.8 : 1);
        if (Math.hypot(h.goal.x - h.pos.x, h.goal.z - h.pos.z) < 1.4 || h.t > h.dur) this.setState(h, 'idle');
        break;
      case 'wallow':
        h.sink = 1;
        if (h.t > h.dur) this.setState(h, 'idle', 2);
        break;
      case 'burrow':
        h.sink = 2;
        if (h.t > h.dur) {
          this.setState(h, 'idle', 2.5);
          ctx.fx.sandBurst({ x: h.pos.x, y: h.pos.y + 0.3, z: h.pos.z }, 0.8 * s + 0.3);
        }
        break;
      case 'yawn': {
        const k = h.t / h.dur;
        h.yawn = k < 0.25 ? k / 0.25 : k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        if (h.t - dt < 0.6 && h.t >= 0.6) ctx.sfx('camel_grunt', h.pos, 0.85, h.baby ? 1.2 : 0.42);
        if (h.t > h.dur) this.setState(h, 'idle');
        break;
      }
      case 'alert': {
        // face the trouble, gape a threat, snort sand
        const f = h.foe;
        if (f) lookTarget = f.pos;
        else lookTarget = h.rageAt;
        h.yawn = Math.max(h.yawn, Math.sin(Math.min(1, h.t / h.dur) * Math.PI) * (h.rageT > 0 ? 1 : 0.65));
        h.rage = Math.max(h.rage, 0.6);
        if (lookTarget) h.goal.copy(lookTarget);
        maxTurn = 3;
        if (h.t - dt <= 0.1 && h.t > 0.1) {
          ctx.sfx('camel_grunt', h.pos, 0.9, 0.38);
          if (h.rageT > 0) ctx.sfx('jackal_growl', h.pos, 0.6, 0.45);
          this.snort(h, 6);
        }
        if (h.t > h.dur) this.setState(h, h.rageT > 0 ? 'stampede' : 'charge');
        break;
      }
      case 'charge': {
        const f = h.foe;
        if (!f || !f.alive || Math.hypot(h.pos.x - h.herd.home.x, h.pos.z - h.herd.home.z) > h.herd.r + 18) {
          h.foe = null;
          this.setState(h, 'walk', 10);
          h.goal.copy(h.herd.home);
          break;
        }
        h.goal.copy(f.pos);
        target = 7.6;
        maxTurn = 2.4;
        h.rage = Math.max(h.rage, 0.7);
        if (this.reach(h, f)) this.setState(h, 'bite');
        break;
      }
      case 'stampede': {
        h.rage = 1;
        maxTurn = 2.6;
        target = 9;
        let f = h.foe;
        if (!f || !f.alive) f = h.foe = this.nearestFoe(h.pos, 40, h.rageAt, 42);
        if (f) {
          h.goal.copy(f.pos);
          if (this.reach(h, f)) this.setState(h, 'bite');
        } else if (Math.hypot(h.goal.x - h.pos.x, h.goal.z - h.pos.z) < 3 || h.t > 4) {
          // nothing to flatten: mill round the calf's landing spot, bellowing
          const a = rnd.next() * Math.PI * 2;
          h.goal.set(h.rageAt.x + Math.cos(a) * 7, 0, h.rageAt.z + Math.sin(a) * 7);
          h.t = 0;
          target = 5;
        }
        if (h.rageT <= 0) this.calm(h);
        break;
      }
      case 'bite': {
        const k = h.t / h.dur;
        h.bite = k;
        h.rage = Math.max(h.rage, 0.6);
        target = 0.6;
        if (h.foe) h.goal.copy(h.foe.pos);
        maxTurn = 3;
        if (!h.bitDone && k >= 0.4) {
          h.bitDone = true;
          this.chomp(h);
        }
        if (h.t > h.dur) this.setState(h, 'recover');
        break;
      }
      case 'recover':
        h.rage = Math.max(h.rage, 0.4);
        if (h.t > h.dur) {
          const f = h.foe;
          if (h.rageT > 0) this.setState(h, 'stampede');
          else if (f && f.alive && h.bites < 3 && Math.hypot(f.pos.x - h.herd.home.x, f.pos.z - h.herd.home.z) < h.herd.r + 14) this.setState(h, 'charge');
          else this.calm(h);
        }
        break;
      case 'follow':
      case 'play': {
        const mom = h.mother;
        if (!mom) {
          this.pickIdle(h);
          break;
        }
        // stick by mum (behind her shoulder), lie down when she does
        const side = h.herd.members.indexOf(h) % 2 ? 1 : -1;
        const fx = Math.sin(mom.yaw), fz = Math.cos(mom.yaw);
        const ox = Math.cos(mom.yaw) * side, oz = -Math.sin(mom.yaw) * side;
        if (h.st === 'play') {
          const a = h.t * 2.2 * side;
          h.goal.set(mom.pos.x + Math.cos(a) * 3.2, 0, mom.pos.z + Math.sin(a) * 3.2);
          target = 2.6;
          if (h.t > h.dur) this.setState(h, 'follow');
        } else {
          h.goal.set(mom.pos.x - fx * 1.0 + ox * 1.6, 0, mom.pos.z - fz * 1.0 + oz * 1.6);
          const dd = Math.hypot(h.goal.x - h.pos.x, h.goal.z - h.pos.z);
          target = dd > 6 ? 3.4 : dd > 1.2 ? 1.2 + dd * 0.35 : 0;
          if (dd < 1.2) h.sink = mom.st === 'wallow' || mom.st === 'burrow' ? 1 : 0;
          if (dd < 1.2 && rnd.chance(dt * 0.04)) this.setState(h, 'play', 3 + rnd.next() * 2);
          if (Math.hypot(pp.x - h.pos.x, pp.z - h.pos.z) < 6) lookTarget = pp;
          if (h.inter && h.t > 1 && rnd.chance(dt * 0.03)) ctx.sfx('squeak', h.pos, 0.35, 0.8);
        }
        break;
      }
      case 'dizzy':
        mode = 'dizzy';
        if (h.t > 1.6) {
          this.setState(h, 'follow');
          if (h.inter) h.inter.enabled = true;
        }
        break;
    }
    if (h.st !== 'alert' && h.st !== 'charge' && h.st !== 'bite' && h.st !== 'recover' && h.st !== 'stampede') h.rage = damp(h.rage, 0, 1.5, dt);
    // the body can only move once it has heaved itself out of the sand
    const sunk = h.anim.sunk;
    if (sunk > 0.25 && target > 0) target *= 0.05;
    if (h.st === 'alert') target = 0;
    this.steer(h, dt, target, maxTurn, h.st === 'idle' || h.st === 'wallow' || h.st === 'burrow' || h.st === 'yawn' || h.st === 'dizzy');
    // look
    if (lookTarget) {
      const want = Math.atan2(lookTarget.x - h.pos.x, lookTarget.z - h.pos.z);
      h.look = wrapAngle(want - h.yaw);
    } else h.look = Math.sin(this.t * 0.31 + h.pos.x) * 0.25;
    h.anim.update(dt, { speed: h.speed, turn: h.turn, sink: h.sink, yawn: h.yawn, bite: h.bite, rage: h.rage, look: h.look, mode });
    this.place(h, dt);
    this.hippoFx(h, dt);
    if (!h.baby) {
      this.bounceCheck(h);
      if (h.st === 'stampede' || (h.st === 'charge' && h.speed > 5)) this.trample(h);
    }
    if (h.inter) {
      h.inter.pos.copy(h.pos);
      h.inter.enabled = (h.st === 'follow' || h.st === 'play' || h.st === 'idle') && !this.carry && pl.alive;
    }
    // idle honks while the hunter is about
    if (h.gruntCd <= 0) {
      h.gruntCd = 8 + rnd.next() * 10;
      if (h.pos.distanceTo(pp) < 32 && (h.st === 'idle' || h.st === 'walk' || h.st === 'wallow')) ctx.sfx(h.baby ? 'squeak' : 'camel_grunt', h.pos, h.baby ? 0.4 : 0.6, h.baby ? 0.75 : 0.5 + rnd.next() * 0.08);
    }
  }

  /** perception: enemies in the territory get charged; rage turns into a stampede */
  private think(h: Hippo) {
    if (h.st === 'bite' || h.st === 'recover' || h.st === 'alert') return;
    if (h.rageT > 0) {
      if (h.st !== 'stampede') {
        h.foe = this.nearestFoe(h.pos, 40, h.rageAt, 42);
        this.setState(h, 'alert');
      }
      return;
    }
    if (h.st === 'charge') return;
    let foe = this.nearestFoe(h.pos, TERRITORY);
    if (!foe) foe = this.nearestFoe(h.herd.home, h.herd.r + 4);
    if (!foe)
      for (const b of h.herd.members) if (b.baby && b.st !== 'carried' && b.st !== 'thrown') foe = foe ?? this.nearestFoe(b.pos, 9);
    if (foe) {
      h.foe = foe;
      h.bites = 0;
      h.sink = 0;
      this.setState(h, 'alert');
    }
  }

  private pickIdle(h: Hippo) {
    if (h.baby) return this.setState(h, h.mother ? 'follow' : 'idle');
    const r = rnd.next();
    this.setState(h, r < 0.5 ? 'walk' : r < 0.66 ? 'wallow' : r < 0.74 ? 'burrow' : r < 0.86 ? 'yawn' : 'idle');
  }

  private calm(h: Hippo) {
    h.foe = null;
    h.rageT = 0;
    h.enraged = false;
    this.setState(h, 'walk', 16);
    h.goal.copy(h.herd.home);
  }

  private reach(h: Hippo, e: Enemy) {
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const mx = h.pos.x + fx * (h.m.halfLen + 0.55), mz = h.pos.z + fz * (h.m.halfLen + 0.55);
    return Math.hypot(e.pos.x - mx, e.pos.z - mz) < 1.1 + e.radius;
  }

  /** the jaws snap shut */
  private chomp(h: Hippo) {
    const ctx = this.d.ctx, en = this.d.enemies;
    const e = h.foe;
    const mouth = h.rig.sockets['mouth']?.getWorldPosition(_v) ?? _v.copy(h.pos);
    ctx.sfx('jackal_attack', mouth, 0.9, 0.55);
    ctx.sfx('punch', mouth, 0.8, 0.6);
    ctx.fx.sandSpray({ x: mouth.x, y: mouth.y - 0.4, z: mouth.z }, { x: Math.sin(h.yaw) * 2, y: 2, z: Math.cos(h.yaw) * 2 }, 1.2);
    if (h.pos.distanceTo(this.d.player.pos) < 16) ctx.shake(0.2);
    if (!e || !e.alive) return;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const mx = h.pos.x + fx * (h.m.halfLen + 0.55), mz = h.pos.z + fz * (h.m.halfLen + 0.55);
    if (Math.hypot(e.pos.x - mx, e.pos.z - mz) > 2.3 + e.radius) return;
    h.bites++;
    const dmg = (h.rageT > 0 ? 34 : 24) + e.maxHp * (h.rageT > 0 ? 0.4 : 0.3);
    const dir = _v2.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z).normalize();
    en.damage(e, { base: dmg, kind: 'phys', source: 'contact', knock: 10, dirX: dir.x, dirZ: dir.z, canCrit: false, tags: ['torso'] }, new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), dir.clone());
    if (e.alive) en.knockdown(e, dir.x, dir.z, 'counter');
    if (this.t - h.herd.calloutT > 18) {
      h.herd.calloutT = this.t;
      en.callout(TITLES.bite, { x: h.pos.x, y: h.pos.y + h.m.height + 0.8, z: h.pos.z }, 'elite');
    }
  }

  /** a stampeding hippo flattens whatever is in front of it (the hunter too, if he's in the way) */
  private trample(h: Hippo) {
    const en = this.d.enemies, pl = this.d.player;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const cx = h.pos.x + fx * h.m.halfLen * 0.6, cz = h.pos.z + fz * h.m.halfLen * 0.6;
    const r = h.m.halfWid + 0.35;
    for (const e of en.list) {
      if (!this.fair(e) || e === h.foe) continue;
      if (Math.hypot(e.pos.x - cx, e.pos.z - cz) > r + e.radius) continue;
      const last = h.trampled.get(e.id) ?? -9;
      if (this.t - last < 0.9) continue;
      h.trampled.set(e.id, this.t);
      en.damage(e, { base: 14 + e.maxHp * 0.18, kind: 'phys', source: 'contact', knock: 12, dirX: fx, dirZ: fz, canCrit: false }, undefined, new THREE.Vector3(fx, 0, fz));
      if (e.alive) en.knockdown(e, fx, fz, 'board');
      this.d.ctx.sfx('punch', e.pos, 0.7, 0.7);
    }
    // stampedes trample healing cacti too (sap for whoever is close)
    for (const c of this.cacti) if (c.alive && Math.hypot(c.pos.x - cx, c.pos.z - cz) < r + c.radius) this.burstCactus(c, fx, fz);
    if (h.st !== 'stampede' || !pl.alive || h.hurtCd > 0) return;
    if (Math.hypot(pl.pos.x - cx, pl.pos.z - cz) < r + 0.4 && pl.pos.y < h.pos.y + h.m.backY - 0.4) {
      h.hurtCd = 1.2;
      if (h.grace <= 0 && h.speed > 6) {
        // in its way at full tilt: run down
        pl.takeHit({ base: 12, kind: 'phys', source: 'contact', knock: 11 }, h.pos);
        this.d.ctx.sfx('punch', pl.pos, 0.9, 0.55);
      } else {
        // otherwise just shouldered aside
        const sx = Math.cos(h.yaw), sz = -Math.sin(h.yaw);
        const side = (pl.pos.x - h.pos.x) * sx + (pl.pos.z - h.pos.z) * sz >= 0 ? 1 : -1;
        pl.board.impulse.x += sx * side * 6;
        pl.board.impulse.z += sz * side * 6;
        pl.board.impulse.y += 2.5;
        this.d.ctx.sfx('camel_grunt', h.pos, 0.6, 0.45);
      }
    }
  }

  /** the herd goes berserk: every adult near `at` (or near `also`, the thrower) bellows and stampedes the enemies round `at` */
  private enrage(at: THREE.Vector3, also?: THREE.Vector3) {
    const ctx = this.d.ctx;
    let first: Hippo | null = null;
    for (const herd of this.herds)
      for (const h of herd.members) {
        if (h.baby) continue;
        if (Math.hypot(h.pos.x - at.x, h.pos.z - at.z) > ENRAGE_R && !(also && Math.hypot(h.pos.x - also.x, h.pos.z - also.z) < ENRAGE_R)) continue;
        const was = h.rageT > 0;
        h.rageT = 14;
        h.rageAt.copy(at);
        h.enraged = true;
        if (!was) {
          h.grace = 2.2;
          h.foe = this.nearestFoe(h.pos, 40, at, 42);
          this.setState(h, 'alert');
        }
        first ??= h;
      }
    if (!first) return;
    if (this.t - this.stampedeT > 6) {
      this.stampedeT = this.t;
      ctx.sfx('anubis_roar', first.pos, 0.45, 1.7);
      ctx.sfx('quake_rumble', first.pos, 0.7, 0.8);
      ctx.shake(0.3);
      this.d.enemies.callout(TITLES.stampede, { x: first.pos.x, y: first.pos.y + first.m.height + 1, z: first.pos.z }, 'alpha');
      ctx.toast('STAMPEDE!', '#ff8a4a', 'You made the hippos very, very angry');
    }
  }

  // ---------------------------------------------------------------- locomotion
  private steer(h: Hippo, dt: number, target: number, maxTurn: number, still: boolean) {
    const world = this.d.ctx.world;
    const dx = h.goal.x - h.pos.x, dz = h.goal.z - h.pos.z;
    let turn = 0;
    if ((target > 0 || h.st === 'alert' || h.st === 'bite') && Math.hypot(dx, dz) > 0.3) {
      const want = Math.atan2(dx, dz);
      const err = wrapAngle(want - h.yaw);
      turn = clamp(err, -maxTurn * dt, maxTurn * dt);
      h.yaw += turn;
      // slow down to turn: a hippo can't corner at full tilt
      target *= clamp(1 - Math.abs(err) / 2.2, 0.25, 1);
    }
    h.turn = damp(h.turn, turn / Math.max(dt, 1e-4), 6, dt);
    const accel = target > h.speed ? (h.st === 'stampede' || h.st === 'charge' ? 7 : 2.5) : 5;
    h.speed = still ? damp(h.speed, 0, 5, dt) : Math.max(0, h.speed + clamp(target - h.speed, -accel * dt, accel * dt));
    if (h.speed < 1e-3) return;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    h.pos.x += fx * h.speed * dt;
    h.pos.z += fz * h.speed * dt;
    // don't walk through buildings / rocks: push the body (and the head end) out of colliders
    const cols = world.colliders;
    const y = h.pos.y;
    for (const k of [0, 0.75]) {
      const px = h.pos.x + fx * h.m.halfLen * k, pz = h.pos.z + fz * h.m.halfLen * k;
      cols.resolve(px, pz, y, h.m.backY, h.m.halfWid * (k ? 0.75 : 1), _res as never);
      if (_res.x || _res.z) {
        h.pos.x += _res.x;
        h.pos.z += _res.z;
      }
    }
  }

  private separate(herd: Herd) {
    const ms = herd.members;
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i], b = ms[j];
        if (a.st === 'carried' || b.st === 'carried' || a.st === 'thrown' || b.st === 'thrown') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz) || 1e-3;
        const min = a.m.halfWid + b.m.halfWid + (a.baby || b.baby ? 0.3 : 0.9);
        if (d >= min) continue;
        const push = (min - d) * 0.5;
        const wa = a.baby ? 0.8 : b.baby ? 0.2 : 0.5;
        a.pos.x -= (dx / d) * push * wa * 2;
        a.pos.z -= (dz / d) * push * wa * 2;
        b.pos.x += (dx / d) * push * (1 - wa) * 2;
        b.pos.z += (dz / d) * push * (1 - wa) * 2;
      }
  }

  /** stand on the sand: ground height, pitch and roll from the slope under the feet */
  private place(h: Hippo, dt: number) {
    const g = this.d.ctx.world.groundAt;
    h.pos.y = g(h.pos.x, h.pos.z);
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const L = h.m.halfLen * 0.7, W = h.m.halfWid * 0.8;
    const hf = g(h.pos.x + fx * L, h.pos.z + fz * L), hb = g(h.pos.x - fx * L, h.pos.z - fz * L);
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);
    const hl = g(h.pos.x + lx * W, h.pos.z + lz * W), hr = g(h.pos.x - lx * W, h.pos.z - lz * W);
    h.pitch = damp(h.pitch, Math.atan2(hf - hb, 2 * L), 6, dt);
    h.roll = damp(h.roll, Math.atan2(hl - hr, 2 * W) * 0.7, 6, dt);
    const y = Math.min(h.pos.y, (hf + hb) * 0.5 + 0.02);
    h.rig.root.position.set(h.pos.x, y - 0.03, h.pos.z);
    h.rig.root.rotation.set(-h.pitch, h.yaw, h.roll, 'YXZ');
  }

  /** dust from the feet, sand off the back when digging in / heaving out, snorts */
  private hippoFx(h: Hippo, dt: number) {
    const ctx = this.d.ctx, pp = this.d.player.pos;
    const near = h.pos.distanceTo(pp);
    if (near > 70) return;
    const s = h.m.s;
    if (h.speed > 1.6) {
      h.stepT -= dt * h.speed;
      if (h.stepT <= 0) {
        h.stepT = 0.85 * (h.baby ? 0.5 : 1);
        const side = rnd.sign(), fwd = rnd.next() < 0.5 ? 0.55 : -0.6;
        const lx = Math.cos(h.yaw) * side * h.m.halfWid * 0.7, lz = -Math.sin(h.yaw) * side * h.m.halfWid * 0.7;
        const p = { x: h.pos.x + Math.sin(h.yaw) * h.m.halfLen * fwd + lx, y: h.pos.y + 0.05, z: h.pos.z + Math.cos(h.yaw) * h.m.halfLen * fwd + lz };
        ctx.fx.dust(p, (h.speed > 6 ? 1.1 : 0.6) * (h.baby ? 0.5 : 1), undefined, h.speed > 6 ? 4 : 2);
        if (h.speed > 6) {
          ctx.particles.emit({ pos: p, count: 3, vel: { x: -Math.sin(h.yaw) * 2, y: 1.6, z: -Math.cos(h.yaw) * 2 }, spread: 1.8, gravity: 9, drag: 0.8, life: [0.5, 1], size: [0.06, 0.12], sprite: ['dot3', 'grain0', 'grain1'], color: [0xe6cf9f, 0xd9b98a, 0xc8a46e], ground: true });
          if (!h.baby && near < 22 && rnd.chance(0.35)) ctx.shake(0.05 * (1 - near / 22));
        }
      }
    }
    if (h.anim.digging > 0.15 && rnd.chance(dt * 18)) {
      const a = rnd.next() * Math.PI * 2;
      const r = h.m.halfWid * 1.05;
      const p = { x: h.pos.x + Math.cos(a) * r + Math.sin(h.yaw) * (rnd.next() - 0.5) * h.m.halfLen * 1.6, y: h.pos.y + 0.1, z: h.pos.z + Math.sin(a) * r + Math.cos(h.yaw) * (rnd.next() - 0.5) * h.m.halfLen * 1.6 };
      ctx.particles.emit({ pos: p, count: 4, vel: { x: Math.cos(a) * 1.4, y: 2.2, z: Math.sin(a) * 1.4 }, spread: 1.2, gravity: 10, drag: 0.6, life: [0.5, 0.9], size: [0.05, 0.1], sprite: ['grain0', 'grain1', 'grain2', 'dot3'], color: [0xe6cf9f, 0xd9b98a], ground: true });
      if (rnd.chance(0.3)) ctx.fx.dust(p, 0.6 * s + 0.3, undefined, 2);
    }
    if (h.rage > 0.5 && !h.baby && rnd.chance(dt * 2.2)) this.snort(h, 3);
  }

  private snort(h: Hippo, n: number) {
    const ctx = this.d.ctx;
    for (const k of ['nostril_l', 'nostril_r']) {
      const p = h.rig.sockets[k]?.getWorldPosition(_v);
      if (!p) continue;
      ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: n, vel: { x: Math.sin(h.yaw) * 1.2, y: 1.4, z: Math.cos(h.yaw) * 1.2 }, spread: 0.8, life: [0.4, 0.8], size: [0.12, 0.4], sprite: ['puff0', 'puff1'], color: [0xe9d3a4, 0xdcc08c], alpha: 0.55, drag: 2.5 });
    }
  }

  // ---------------------------------------------------------------- the trampoline
  private bounceCheck(h: Hippo) {
    const pl = this.d.player;
    if (!pl.alive || h.bounceCd > 0) return;
    const b = pl.board, pp = pl.pos;
    const dx = pp.x - h.pos.x, dz = pp.z - h.pos.z;
    if (dx * dx + dz * dz > 16) return;
    const sy = Math.sin(h.yaw), cy = Math.cos(h.yaw);
    const lz = dx * sy + dz * cy, lx = dx * cy - dz * sy;
    const hl = h.m.halfLen * 1.05, hw = h.m.halfWid * 1.0;
    const e2 = (lx / hw) ** 2 + (lz / hl) ** 2;
    if (e2 > 1) return;
    const top = h.rig.root.position.y + (h.m.backY - h.anim.drop) * (1 - 0.3 * (lz / hl) ** 2 - 0.25 * (lx / hw) ** 2) * h.rig.root.scale.y;
    if (!b.grounded && b.vel.y < 1.5 && pp.y > top - 0.6 && pp.y < top + 0.55) {
      this.bounce(h, top, false);
    } else if (pp.y < top - 0.6) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 5.5 && h.anim.sunk < 1.5) this.bounce(h, top, true);
      else {
        // too slow: the big body just shoulders you aside
        const k = (1 - e2) * 6;
        const ox = dx / (Math.hypot(dx, dz) || 1), oz = dz / (Math.hypot(dx, dz) || 1);
        b.vel.x += ox * k * 0.12;
        b.vel.z += oz * k * 0.12;
        b.pos.x += ox * (1 - e2) * 0.08;
        b.pos.z += oz * (1 - e2) * 0.08;
        if (h.gruntCd > 3) {
          h.gruntCd = 2.5;
          this.d.ctx.sfx('camel_grunt', h.pos, 0.6, 0.48);
        }
      }
    } else if (b.grounded && pp.y >= top - 0.6) {
      // standing on a buried / wallowing hippo's back: it heaves you off
      this.bounce(h, top, false);
    }
  }

  private bounce(h: Hippo, top: number, ramp: boolean) {
    const ctx = this.d.ctx, pl = this.d.player, b = pl.board;
    const vy = b.vel.y;
    b.vel.y = ramp ? 9 + Math.hypot(b.vel.x, b.vel.z) * 0.2 : clamp(12.5 + Math.abs(vy) * 0.35, 12.5, 17);
    b.grounded = false;
    b.airTime = 0;
    b.airJumps = Math.max(b.airJumps, 1);
    b.pos.y = Math.max(b.pos.y, ramp ? b.pos.y + 0.15 : top + 0.05);
    if (!ramp) {
      b.vel.x += Math.sin(b.heading) * 1.4;
      b.vel.z += Math.cos(b.heading) * 1.4;
    }
    h.bounceCd = 0.4;
    h.bounced++;
    h.anim.kick(ramp ? -3 : -7);
    // chain bounces into the style combo
    this.bounceChain = this.t - this.bounceAt < 4 ? this.bounceChain + 1 : 1;
    this.bounceAt = this.t;
    const n = this.bounceChain;
    pl.moves?.link(n > 1 ? `HIPPO HOP x${n}` : ramp ? 'HIPPO VAULT' : 'HIPPO BOUNCE', 110 + n * 45, 1, 'HIPPO');
    ctx.sfx('board_jump', b.pos, 1, 0.7);
    ctx.sfx('camel_grunt', h.pos, 0.55, 0.55 + rnd.next() * 0.1);
    ctx.sfx('whoosh', b.pos, 0.5, 0.9);
    ctx.shake(0.12);
    ctx.particles.emit({ pos: { x: b.pos.x, y: top, z: b.pos.z }, count: 10, spread: 2.6, up: 1.2, life: [0.4, 0.8], size: [0.25, 0.7], sprite: ['puff0', 'puff1'], color: [0xe9d3a4, 0xdcc08c], alpha: 0.6, drag: 3 });
    ctx.particles.emit({ pos: { x: b.pos.x, y: top, z: b.pos.z }, count: 5, spread: 1.6, up: 1.4, life: [0.25, 0.5], size: [0.14, 0.02], sprite: ['star4', 'spark'], additive: true, color: [0xffe39a, 0xfff6d0] });
    ctx.fx.dust({ x: h.pos.x, y: h.pos.y + 0.05, z: h.pos.z }, 1.4, undefined, 6);
    if (this.firstBounce) {
      this.firstBounce = false;
      this.d.enemies.callout(TITLES.bounce, { x: h.pos.x, y: top + 1.6, z: h.pos.z });
      ctx.toast('HIPPO BOUNCE', '#ffd36b', 'Trick off the big air!');
    }
    // it doesn't mind... up to a point: a few bounces in a row earn a grumpy yawn (or a heave out of the sand)
    if (h.st === 'burrow' || h.st === 'wallow') {
      if (h.bounced >= 2) this.setState(h, 'yawn');
    } else if (h.bounced >= 4 && h.st !== 'stampede' && h.st !== 'charge' && h.st !== 'bite') {
      h.bounced = 0;
      this.setState(h, 'yawn');
    }
  }

  // ---------------------------------------------------------------- the calves: pick up, carry, throw
  private pickUp(b: Hippo) {
    if (this.carry || b.st === 'carried' || b.st === 'thrown') return;
    const ctx = this.d.ctx;
    this.carry = b;
    this.setState(b, 'carried');
    if (b.inter) b.inter.enabled = false;
    ctx.sfx('squeak', b.pos, 0.8, 1.35);
    ctx.sfx('camel_grunt', b.pos, 0.45, 1.25);
    if (b.mother) b.mother.look = 0;
    if (this.firstCarry) {
      this.firstCarry = false;
      ctx.toast('HIPPO CALF', '#ffd36b', '[T] throw it at enemies: the whole herd will stampede them');
    }
  }

  private updateCarried(b: Hippo, dt: number) {
    const pl = this.d.player;
    if (!pl.alive) {
      // dropped
      this.carry = null;
      b.pos.set(pl.pos.x + 1, 0, pl.pos.z);
      this.setState(b, 'dizzy');
      this.place(b, 1);
      return;
    }
    // sitting on the hunter's head, legs paddling
    const head = pl.rig.nodes['head'];
    if (head) head.getWorldPosition(_v);
    else _v.set(pl.pos.x, pl.pos.y + 1.6, pl.pos.z);
    b.pos.set(_v.x, _v.y + 0.18, _v.z);
    b.yaw = dampAngle(b.yaw, pl.board.heading + Math.sin(this.t * 1.7) * 0.4, 6, dt);
    b.rig.root.position.copy(b.pos);
    b.rig.root.rotation.set(Math.sin(this.t * 7) * 0.05, b.yaw, Math.sin(this.t * 5.3) * 0.08, 'YXZ');
    b.anim.update(dt, { speed: 0, sink: 0, yawn: 0, bite: -1, rage: 0, look: 0, mode: 'carried' });
    if (rnd.chance(dt * 0.5)) this.d.ctx.sfx('squeak', b.pos, 0.35, 1.2 + rnd.next() * 0.3);
  }

  private throwCalf() {
    const b = this.carry;
    if (!b) return;
    const ctx = this.d.ctx, pl = this.d.player;
    this.carry = null;
    const from = b.pos.clone();
    // aim: the enemy nearest the aim line, else the aim point
    const aim = pl.aimPoint;
    let ax = aim.x - from.x, az = aim.z - from.z;
    let al = Math.hypot(ax, az);
    if (al < 0.5) {
      ax = Math.sin(pl.board.heading);
      az = Math.cos(pl.board.heading);
      al = 1;
    }
    ax /= al;
    az /= al;
    let best: Enemy | null = null, bs = -1;
    for (const e of this.d.enemies.list) {
      if (!this.fair(e)) continue;
      const dx = e.pos.x - from.x, dz = e.pos.z - from.z, d = Math.hypot(dx, dz);
      if (d > 32 || d < 1) continue;
      const c = (dx * ax + dz * az) / d;
      if (c < 0.82) continue;
      const score = c * 2 - d / 32;
      if (score > bs) {
        bs = score;
        best = e;
      }
    }
    const to = best ? new THREE.Vector3(best.pos.x, best.pos.y + best.height * 0.45, best.pos.z) : new THREE.Vector3(from.x + ax * clamp(al, 6, 20), 0, from.z + az * clamp(al, 6, 20));
    if (!best) to.y = ctx.world.groundAt(to.x, to.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const T = clamp(dist / 15, 0.45, 1.1);
    b.vel.set((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * GRAV * T, (to.z - from.z) / T);
    b.vel.x += pl.board.vel.x * 0.3;
    b.vel.z += pl.board.vel.z * 0.3;
    b.hops = 2;
    b.spin = (4 + rnd.next() * 3) * rnd.sign();
    b.tumble = 0;
    b.hitIds.clear();
    b.enraged = false;
    this.setState(b, 'thrown');
    b.yaw = Math.atan2(ax, az);
    ctx.sfx('whoosh_big', from, 0.7, 1.1);
    ctx.sfx('squeak', from, 0.9, 1.7);
    // throwing a calf is enough: the herd goes berserk at once (the landing squeal re-aims them)
    this.enrage(to, from);
    pl.express?.('smug', 1);
    this.d.enemies.callout(TITLES.throw, { x: from.x, y: from.y + 1.2, z: from.z });
  }

  private updateThrown(b: Hippo, dt: number) {
    const ctx = this.d.ctx, en = this.d.enemies;
    b.t += dt;
    b.vel.y -= GRAV * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.tumble += b.spin * dt;
    // bowl over what it hits, bounce off unharmed
    const r = 0.45;
    for (const e of en.list) {
      if (!e.alive || b.hitIds.has(e.id) || e.state === 'hidden' || e.state === 'burrow') continue;
      const cy = e.pos.y + e.height * 0.5;
      if (Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) > e.radius + r || Math.abs(cy - b.pos.y) > e.height * 0.5 + r) continue;
      b.hitIds.add(e.id);
      const hl = Math.hypot(b.vel.x, b.vel.z) || 1;
      const dx = b.vel.x / hl, dz = b.vel.z / hl;
      en.damage(e, { base: 12, kind: 'phys', source: 'projectile', knock: 9, dirX: dx, dirZ: dz, canCrit: false }, b.pos.clone(), new THREE.Vector3(dx, 0, dz));
      if (e.alive) en.knockdown(e, dx, dz, 'board');
      ctx.sfx('board_jump', b.pos, 0.9, 1.6);
      ctx.sfx('punch', b.pos, 0.7, 1.1);
      ctx.sfx('squeak', b.pos, 0.8, 1.9);
      ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.3, z: b.pos.z }, count: 8, spread: 2.2, up: 1.5, life: [0.3, 0.6], size: [0.16, 0.03], sprite: ['star4', 'spark'], additive: true, color: [0xffe39a, 0xfff6d0] });
      b.vel.set(-b.vel.x * 0.25, 5.5, -b.vel.z * 0.25);
      b.spin *= -1.3;
      this.squealAndEnrage(b);
    }
    const g = ctx.world.groundAt(b.pos.x, b.pos.z);
    if (b.pos.y <= g && b.vel.y < 0) {
      b.pos.y = g;
      ctx.fx.dust({ x: b.pos.x, y: g + 0.05, z: b.pos.z }, 0.8, undefined, 4);
      ctx.sfx('board_land', b.pos, 0.6, 1.5);
      b.anim.kick(-6);
      this.squealAndEnrage(b);
      if (b.hops > 0) {
        b.hops--;
        b.vel.set(b.vel.x * 0.55, Math.min(6, -b.vel.y * 0.42), b.vel.z * 0.55);
        b.spin *= 0.6;
      } else {
        b.vel.set(0, 0, 0);
        b.tumble = 0;
        this.setState(b, 'dizzy');
        ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.7, z: b.pos.z }, count: 5, spread: 0.6, up: 0.8, life: [0.6, 1], size: [0.12, 0.05], sprite: 'star4', additive: true, color: [0xfff0b0, 0xffe39a] });
      }
    }
    b.rig.root.position.copy(b.pos);
    b.rig.root.rotation.set(b.tumble, b.yaw, Math.sin(b.tumble * 0.7) * 0.4, 'YXZ');
    b.anim.update(dt, { speed: 0, sink: 0, yawn: 0, bite: -1, rage: 0, look: 0, mode: 'thrown' });
    if (b.t > 6) this.setState(b, 'dizzy');
  }

  private squealAndEnrage(b: Hippo) {
    if (b.enraged) return;
    b.enraged = true;
    this.d.ctx.sfx('squeak', b.pos, 1, 1.5);
    this.enrage(b.pos.clone(), this.d.player.pos);
  }

  // ======================================================================== jerboas
  private updatePup(c: Colony, p: Pup, dt: number) {
    const ctx = this.d.ctx, pl = this.d.player, pp = pl.pos;
    p.t += dt;
    p.thinkT -= dt;
    // danger: the hunter close by, an enemy, a charging hippo
    if (p.thinkT <= 0 && p.st !== 'flee') {
      p.thinkT = 0.2;
      let threat: THREE.Vector3 | null = null;
      const dp = Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z);
      if (pl.alive && (dp < 3.5 || (dp < 7 && pl.board.speed > 3))) threat = pp;
      if (!threat) for (const e of this.d.enemies.list) if (e.alive && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 7) {
        threat = e.pos;
        break;
      }
      if (!threat) for (const herd of this.herds) for (const h of herd.members) if (h.speed > 4 && Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) < 7) threat = h.pos;
      if (threat) {
        p.threat.copy(threat);
        p.st = 'flee';
        p.fleeT = 2 + rnd.next() * 1.5;
        p.hops = 0;
        p.hopT = p.hopDur;
        if (rnd.chance(0.5)) ctx.sfx('squeak', p.pos, 0.25, 2.1 + rnd.next() * 0.3);
      }
    }
    const a = p.anim;
    const startHop = (dist: number, h: number, dur: number, dir: number) => {
      p.from.copy(p.pos);
      p.to.set(p.pos.x + Math.sin(dir) * dist, 0, p.pos.z + Math.cos(dir) * dist);
      // stay near home
      const hx = p.to.x - c.home.x, hz = p.to.z - c.home.z, hd = Math.hypot(hx, hz);
      if (p.st !== 'flee' && hd > c.r) {
        p.to.x = c.home.x + (hx / hd) * c.r;
        p.to.z = c.home.z + (hz / hd) * c.r;
      }
      p.to.y = ctx.world.groundAt(p.to.x, p.to.z);
      p.hopT = 0;
      p.hopDur = dur;
      p.hopH = h;
      p.yaw = Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z);
    };
    if (p.st === 'flee') {
      p.fleeT -= dt;
      if (p.hopT >= p.hopDur) {
        if (p.fleeT <= 0) {
          p.st = 'crouch';
          p.t = 0;
          p.dur = 0.8 + rnd.next() * 1.2;
        } else {
          const away = Math.atan2(p.pos.x - p.threat.x, p.pos.z - p.threat.z) + (rnd.next() - 0.5) * 1.4;
          startHop(1.2 + rnd.next() * 0.8, 0.35 + rnd.next() * 0.2, 0.3 + rnd.next() * 0.06, away);
        }
      }
    } else if (p.st === 'hop') {
      if (p.hopT >= p.hopDur) {
        if (p.hops > 0) {
          p.hops--;
          startHop(0.35 + rnd.next() * 0.55, 0.12 + rnd.next() * 0.18, 0.36 + rnd.next() * 0.08, p.yaw + (rnd.next() - 0.5) * 1.6);
        } else {
          p.st = rnd.chance(0.3) ? 'upright' : rnd.chance(0.35) ? 'wash' : 'sit';
          p.t = 0;
          p.dur = p.st === 'wash' ? 2.5 + rnd.next() * 2 : 1.2 + rnd.next() * 3;
        }
      }
    } else if (p.t > p.dur) {
      // pick the next thing: mostly bouncing about in little chains
      p.st = 'hop';
      p.hops = 1 + Math.floor(rnd.next() * 4);
      p.hopT = p.hopDur = 0;
    }
    // hop motion
    let k = -1;
    if (p.hopT < p.hopDur) {
      p.hopT += dt;
      k = Math.min(1, p.hopT / p.hopDur);
      const q = Math.max(0, Math.min(1, (k - 0.15) / 0.65));
      const e = q * q * (3 - 2 * q);
      p.pos.lerpVectors(p.from, p.to, e);
      p.pos.y = ctx.world.groundAt(p.pos.x, p.pos.z) + Math.sin(q * Math.PI) * p.hopH;
      if (k >= 1 && p.hopH > 0.25) ctx.fx.dust({ x: p.pos.x, y: p.pos.y + 0.02, z: p.pos.z }, 0.25, undefined, 1);
    } else p.pos.y = ctx.world.groundAt(p.pos.x, p.pos.z);
    const hopping = k >= 0 && k < 1;
    a.mode = hopping ? 'hop' : p.st === 'flee' || p.st === 'hop' ? 'sit' : (p.st as PupMode);
    a.hopK = hopping ? k : 0;
    // turn to face the hop; sitting up, they watch the hunter
    const curYaw = p.rig.root.rotation.y;
    p.rig.root.rotation.y = dampAngle(curYaw, p.yaw, 14, dt);
    a.look = p.st === 'upright' ? clamp(wrapAngle(Math.atan2(pp.x - p.pos.x, pp.z - p.pos.z) - p.rig.root.rotation.y), -1, 1) : 0;
    p.rig.root.position.copy(p.pos);
    a.update(dt);
  }

  // ======================================================================== healing cacti
  private updateCacti(dt: number) {
    const pl = this.d.player, pp = pl.pos, en = this.d.enemies;
    const sp = Math.hypot(pl.board.vel.x, pl.board.vel.z);
    for (const c of this.cacti) {
      const dx = c.pos.x - pp.x, dz = c.pos.z - pp.z;
      const dist = Math.hypot(dx, dz);
      c.rig.root.visible = dist < 110;
      // only shootable / kickable while the hunter is near (keeps them out of far-off target searches)
      const want = c.alive && dist < 42;
      if (want !== c.registered) {
        c.registered = want;
        if (want) en.registerExternal(c);
        else en.unregisterExternal(c);
      }
      if (dist > 110) continue;
      c.touchCd -= dt;
      if (c.alive && pl.alive && dist < c.radius + 0.55 && Math.abs(pp.y - c.pos.y) < c.height + 0.2) {
        if (sp > 3.5) this.burstCactus(c, pl.board.vel.x / sp, pl.board.vel.z / sp);
        else if (c.touchCd <= 0) {
          c.touchCd = 0.6;
          c.sway.push(-dx / (dist || 1), -dz / (dist || 1), 0.8);
        }
      }
      if (c.broken) {
        c.regrowT -= dt;
        if (c.regrowT <= 0 && !c.growing) {
          c.growing = true;
          if (dist < 40) this.d.ctx.sfx('sand_rise', c.pos, 0.35, 1.5);
        }
        if (c.growing) {
          c.sway.grow = Math.min(1, c.sway.grow + dt / 3.2);
          if (rnd.chance(dt * 6) && dist < 50) this.d.ctx.particles.emit({ pos: { x: c.pos.x, y: c.pos.y + c.height * c.sway.grow * 0.6, z: c.pos.z }, count: 1, spread: 0.6, up: 0.6, life: [0.5, 0.9], size: [0.1, 0.02], sprite: ['star4', 'spark'], additive: true, color: [0xc8ff9a, 0x9dff3a] });
          if (c.sway.grow >= 1) {
            c.broken = false;
            c.growing = false;
            c.alive = true;
          }
        }
      } else if (dist < 30 && rnd.chance(dt * 0.25)) {
        // a sap bead glints now and then (tells it apart from an ordinary cactus)
        this.d.ctx.particles.emit({ pos: { x: c.pos.x + (rnd.next() - 0.5) * c.radius, y: c.pos.y + c.height * (0.35 + rnd.next() * 0.5), z: c.pos.z + (rnd.next() - 0.5) * c.radius }, count: 1, life: [0.35, 0.5], size: [0.16, 0.02], sprite: 'star4', additive: true, color: 0xd6ffb0 });
      }
      c.sway.update(dt);
    }
  }

  /** a healing cactus bursts: chunks, a fountain of sap, a green splash on the sand, heals the hunter nearby */
  burstCactus(c: HealCactus, dx: number, dz: number) {
    if (!c.alive) return;
    const ctx = this.d.ctx, pl = this.d.player;
    c.alive = false;
    c.broken = true;
    c.growing = false;
    c.regrowT = 45 + rnd.next() * 20;
    c.sway.grow = 0;
    if (c.registered) {
      c.registered = false;
      this.d.enemies.unregisterExternal(c);
    }
    const p = { x: c.pos.x, y: c.pos.y + c.height * 0.45, z: c.pos.z };
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    ctx.sfx('cactus_hit', p, 1, 0.9);
    ctx.sfx('gore_splat', p, 0.7, 1.55);
    ctx.sfx('water_loop', p, 0.3, 1.6);
    // flesh and fruit chunks
    ctx.particles.emit({ pos: p, count: 16, vel: { x: ux * 3, y: 3.5, z: uz * 3 }, spread: 4, gravity: 13, drag: 0.4, life: [0.6, 1.2], size: [0.14, 0.08], sprite: ['dot4', 'dot3', 'twig'], color: c.kind === 'pear' ? [0x6c9c56, 0x8fbe72, 0xc8dc9a, 0xc82c5c] : [0x5f9548, 0x86b866, 0xc8dc9a, 0xe8c43a], ground: true, bounce: 0.2, rot: 6, rotSpeed: 8 });
    // the sap: a fountain of juice blobs and droplets, a sweet mist, bubbles
    ctx.particles.emit({ pos: p, count: 22, vel: { x: ux * 2, y: 5, z: uz * 2 }, spread: 3.2, gravity: 14, drag: 0.3, life: [0.6, 1.1], size: [0.2, 0.08], sprite: ['ichor', 'fx_drop', 'dot3'], color: [0xffffff, 0xd6ffb0, 0xb8f07a], ground: true, stretch: 0.6 });
    ctx.particles.emit({ pos: p, count: 8, spread: 1.6, up: 0.8, life: [0.8, 1.4], size: [0.4, 1.3], sprite: ['puff0', 'puff1', 'puff2'], color: [0xd6f6aa, 0xc0e890], alpha: 0.45, drag: 2.5, rot: 6, rotSpeed: 0.8 });
    ctx.fx.bubbles({ x: p.x, y: p.y, z: p.z }, 6);
    ctx.fx.light({ x: p.x, y: p.y + 0.5, z: p.z }, 0x9dff3a, 2.2, 0.35, 7);
    ctx.events.emit('groundMark', c.pos.x + ux * 0.4, c.pos.z + uz * 0.4, 1.3, 3);
    c.sway.push(ux, uz, 2);
    // heal
    if (pl.alive && Math.hypot(pl.pos.x - c.pos.x, pl.pos.z - c.pos.z) < 5 && Math.abs(pl.pos.y - c.pos.y) < 4) {
      const healed = pl.heal(pl.maxHp * 0.3);
      ctx.fx.sparkle({ x: pl.pos.x, y: pl.pos.y + 1.2, z: pl.pos.z }, 0x9dff3a, 12, 0.9);
      ctx.particles.emit({ pos: { x: pl.pos.x, y: pl.pos.y + 0.6, z: pl.pos.z }, count: 10, spread: 0.8, up: 2.2, life: [0.6, 1], size: [0.14, 0.03], sprite: ['star4', 'spark'], additive: true, color: [0xc8ff9a, 0x9dff3a] });
      if (healed > 0.5) {
        ctx.sfx('heal', pl.pos, 0.7, 1.15);
        if (this.firstSap) {
          this.firstSap = false;
          ctx.toast('SWEET SAP', '#9dff3a', 'Healing cactus: it grows back');
        }
      }
    }
  }

  // ======================================================================== teardown
  dispose() {
    const d = this.d;
    d.inter.remove(this.throwInter);
    this.offExplosion();
    for (const herd of this.herds) for (const h of herd.members) if (h.inter) d.inter.remove(h.inter);
    for (const c of this.cacti) if (c.registered) d.enemies.unregisterExternal(c);
    this.group.removeFromParent();
    this.herds = [];
    this.colonies = [];
    this.cacti = [];
    this.carry = null;
  }
}
