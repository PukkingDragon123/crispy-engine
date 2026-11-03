// Life in the abandoned desert: the ruin spiders, the lookout towers' loot and the
// oases.
//
//  RUINS (every ruined landmark / building; spots come from Props.ruinDecor):
//   - a chest at the back of the room (sits on the floorboards / drifted sand);
//   - a funnel-web nest: ride within ~7 m and a RUIN SPIDER bursts out of it in a
//     lunge ("Pretty Tied Up"); big ruins can hide the brood mother (alpha);
//   - egg sacs: ride close and they twitch, swell and burst, spilling a small
//     ambush of spiders ("Hold Me Tight");
//   - webs high in the corners / across the doorway: a spider drops on its silk
//     line in front of you ("Don't Let Me Down");
//   - during fights near a ruin, more spiders drop out of its webs now and then.
//  OUTPOSTS: a chest waits on each lookout platform; grapple up and it bursts open.
//  OASES: drink at the water's edge (heals fully, then the pool settles for a
//   minute), rest by the water (slow regeneration while nothing hunts you), camels
//   resting (one kneeling, one standing) chewing cud, blinking, flicking ears and
//   swishing their tails, dragonflies over the water, rain frogs on the bank.
//
// The RUIN SPIDER enemy def is registered into ENEMIES when this module loads
// (weight 0: it only comes out of the ruins, never from the normal wave roster).
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { RuinNests } from '../run/RuinNests';
//   field:   ruins: RuinNests | null = null;
//   enter(): right after `this.missions = new Missions({...})` (before the first populateZone):
//              this.ruins = new RuinNests({ ctx: this.ctx, player: this.player, enemies: this.enemies, props: this.props,
//                inter: this.inter, chest: (x, z, t, r) => this.spawnChest(x, z, t, r) });
//   populateZone(z): at the end:   this.ruins?.populateZone(z);
//   update():  next to `this.missions.update(dt);`:   this.ruins?.update(dt);
//   exit():    this.ruins?.dispose();
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { ENEMIES, type EnemyDef } from '../enemies/EnemyDefs';
import type { Enemies, Enemy } from '../enemies/Enemies';
import type { Props } from '../world/Props';
import type { Anchor, ZoneDef } from '../world/RegionGen';
import type { Interactable } from './Interact';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { rnd } from '../../engine/math/rand';
import { eggSacs, dragonflyRig } from '../models/props/ruins';
import { ruinSpiderRig } from '../models/enemies/ruinSpider';
import { camelRig, CamelIdle } from '../models/creatures/camel';
import { modelEntry } from '../models/lookup';

// ============================================================================ the enemy
export const RUIN_SPIDER: EnemyDef = {
  id: 'ruinSpider',
  name: 'Ruin Spider',
  title: 'Eight Legs, No Manners',
  rig: 'ruin_spider',
  rigAlpha: 'ruin_spider_alpha',
  hp: 30,
  armor: 3,
  physRes: 0,
  magicRes: 0.05,
  statusRes: { poison: 0.7 },
  speed: 6.4,
  radius: 0.55,
  height: 0.62,
  ai: 'pack',
  attacks: [
    { kind: 'melee', range: 1.9, cooldown: 1.25, windup: 0.36, dmg: 8, status: [{ id: 'poison', stacks: 2, dur: 4 }], title: 'The Spider and the Fly' },
    { kind: 'leap', range: 9, minRange: 3.2, cooldown: 4.4, windup: 0.5, dmg: 11, title: 'Out Ta Get Me' },
    { kind: 'lob', range: 15, minRange: 4, cooldown: 5.2, windup: 0.7, dmg: 6, count: 3, spread: 0.35, speed: 12, proj: 'venom', status: [{ id: 'poison', stacks: 2, dur: 4 }], alphaOnly: true, title: 'Dead Flowers' },
  ],
  contact: 4,
  bounty: 4,
  gold: [0, 3],
  hitKind: 'chitin',
  weakness: 'Fast, fragile, hairy: it burns. Its bite poisons, so break off when it rears up and shoot it as it lunges.',
  firstWave: 1,
  weight: 0,
  group: [2, 4],
  burnMul: 1.5,
  variants: ['ruin_spider', 'ruin_spider_v1'],
  moveTitles: { drop: "Don't Let Me Down", nest: 'Pretty Tied Up', eggs: 'Hold Me Tight' },
  lore: 'When the towns died, the spiders moved in. They grew fat on lizards and lost prospectors, and now they guard every last gold tooth in the ruins.',
};
if (!ENEMIES.ruinSpider) ENEMIES.ruinSpider = RUIN_SPIDER;

// ============================================================================ deps
type V3 = { x: number; y: number; z: number };
export interface RuinChest {
  root: THREE.Object3D;
  inter: Interactable;
  opened: boolean;
  open(): unknown;
}
export interface RuinNestsDeps {
  ctx: Ctx;
  player: { pos: THREE.Vector3; alive: boolean; hp: number; maxHp: number; heal(n: number): number; board: { vel: THREE.Vector3 } };
  enemies: Enemies;
  props: Props;
  inter: { add(i: Interactable): unknown; remove(i: Interactable): void };
  /** RunScene.spawnChest */
  chest(x: number, z: number, tier: 'wood' | 'silver' | 'gold' | 'divine', rot?: number): RuinChest;
}

interface Egg {
  pos: V3;
  mesh: THREE.Mesh;
  t: number;
  done: boolean;
}
interface Ruin {
  x: number;
  z: number;
  r: number;
  zone: number;
  big: boolean;
  nests: { pos: V3; alpha: boolean; done: boolean }[];
  eggs: Egg[];
  drops: { pos: V3; done: boolean }[];
  reinforceT: number;
}
interface Drop {
  rig: RigInstance;
  line: THREE.Line;
  from: V3;
  to: V3;
  t: number;
  alpha: boolean;
}
interface Outpost {
  top: V3;
  chest: RuinChest;
  done: boolean;
}
interface Critter {
  rig: RigInstance;
  kind: 'fly' | 'frog';
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  phase: number;
}
interface Oasis {
  x: number;
  z: number;
  r: number;
  level: number;
  drink: Interactable;
  cool: number;
  camels: { rig: RigInstance; idle: CamelIdle; col: unknown; grunt: number }[];
  critters: Critter[];
  regenT: number;
}

const SILK = 0xece8de;
const _v = new THREE.Vector3();

let spiderSpec: RigSpec | null = null;
const eggGeo: { intact: THREE.BufferGeometry; burst: THREE.BufferGeometry }[] = [];
function eggGeometry(i: number) {
  if (!eggGeo[i]) {
    const a = eggSacs(i, false), b = eggSacs(i, true);
    const pv = (m: typeof a.model): [number, number, number] => {
      const bb = m.bounds();
      return [(bb.minX + bb.maxX + 1) / 2, bb.minY, (bb.minZ + bb.maxZ + 1) / 2];
    };
    eggGeo[i] = { intact: buildVoxelGeometry(a.model, { voxelSize: a.voxelSize, pivot: pv(a.model) }), burst: buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: pv(a.model) }) };
  }
  return eggGeo[i];
}

export class RuinNests {
  private ruins: Ruin[] = [];
  private drops: Drop[] = [];
  private outposts: Outpost[] = [];
  private oases: Oasis[] = [];
  private done = new Set<number>();
  private group = new THREE.Group();
  private t = 0;
  private silkMat = new THREE.LineBasicMaterial({ color: SILK, transparent: true, opacity: 0.75 });

  constructor(private d: RuinNestsDeps) {
    this.group.name = 'ruin-nests';
    d.ctx.scene.add(this.group);
  }

  // ---------------------------------------------------------------- per zone
  populateZone(z: ZoneDef) {
    if (this.done.has(z.index)) return;
    this.done.add(z.index);
    for (const p of this.d.props.list) {
      if (p.zone !== z.index) continue;
      const ruin = p.anchor.data?.ruin;
      if (ruin) this.addRuin(z, ruin);
      if (p.kind === 'outpost' && p.anchor.data?.top) this.addOutpost(z, p.anchor);
    }
    for (const a of z.anchors) if (a.kind === 'oasisPool') this.addOasis(a);
  }

  private addRuin(z: ZoneDef, info: any) {
    const d = this.d;
    const R: Ruin = { x: info.cx, z: info.cz, r: info.r, zone: z.index, big: !!info.big, nests: [], eggs: [], drops: [], reinforceT: 8 + rnd.next() * 10 };
    if (info.chest) {
      const c = info.chest;
      const tier = info.big ? (z.index >= 4 && rnd.chance(0.35) ? 'gold' : 'silver') : z.index >= 3 && rnd.chance(0.3) ? 'silver' : 'wood';
      const ch = d.chest(c.x, c.z, tier, c.rot);
      ch.root.position.y = Math.max(ch.root.position.y, c.y - 0.02);
      ch.inter.pos.y = ch.root.position.y;
    }
    for (const n of info.nests ?? []) R.nests.push({ pos: n, alpha: !!n.alpha && z.index >= 1, done: false });
    (info.eggs ?? []).forEach((e: any, i: number) => {
      const g = eggGeometry((Math.round(e.x * 3) + i) & 1);
      const mesh = new THREE.Mesh(g.intact, sharedVoxelMaterial);
      mesh.position.set(e.x, e.y - 0.02, e.z);
      mesh.rotation.y = e.rot ?? 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.burst = g.burst;
      this.group.add(mesh);
      R.eggs.push({ pos: { x: e.x, y: e.y, z: e.z }, mesh, t: -1, done: false });
    });
    for (const p of (info.drops ?? []).slice(0, info.big ? 3 : 1)) R.drops.push({ pos: p, done: false });
    if (R.nests.length || R.eggs.length || R.drops.length) this.ruins.push(R);
  }

  private addOutpost(z: ZoneDef, a: Anchor) {
    const top = a.data.top as V3;
    const ch = this.d.chest(top.x, top.z, z.index >= 3 && rnd.chance(0.4) ? 'gold' : 'silver', rnd.next() * 6.28);
    ch.root.position.y = top.y;
    ch.inter.pos.y = top.y;
    ch.inter.enabled = false; // nobody opens it from the ground: climb (grapple) up
    this.outposts.push({ top, chest: ch, done: false });
  }

  private addOasis(a: Anchor) {
    const d = this.d, ctx = d.ctx;
    const data = a.data ?? {};
    const r = data.r ?? 9;
    const level = data.level ?? ctx.world.groundAt(a.x, a.z);
    const drinkAt = data.drink ?? { x: a.x + r, z: a.z };
    const O: Oasis = { x: a.x, z: a.z, r, level, cool: 0, camels: [], critters: [], regenT: 0, drink: null as unknown as Interactable };
    const pos = new THREE.Vector3(drinkAt.x, ctx.world.groundAt(drinkAt.x, drinkAt.z), drinkAt.z);
    O.drink = {
      pos,
      radius: 3.4,
      label: 'Drink from the Oasis',
      enabled: true,
      promptY: 1.3,
      use: () => this.drink(O),
    };
    d.inter.add(O.drink);
    // camels resting by the water: one kneeling (cush) on the resting spot, one standing in the palms
    try {
      const spec = camelRig();
      const geo = buildRigGeo(spec, 'camel:oasis');
      const rest = data.rest ?? { x: a.x + r * 1.4, z: a.z, rot: Math.PI };
      const spots = [
        { x: rest.x + Math.cos(rest.rot + Math.PI / 2) * 2.6, z: rest.z - Math.sin(rest.rot + Math.PI / 2) * 2.6, yaw: rest.rot + 0.5, kneel: 1 },
        { x: a.x + Math.cos(rest.rot - 1.2) * r * 1.5, z: a.z + Math.sin(rest.rot - 1.2) * r * 1.5, yaw: rest.rot + 2.2, kneel: 0 },
      ];
      for (const s of spots) {
        const rig = new RigInstance(geo, { castShadow: true });
        rig.root.position.set(s.x, ctx.world.groundAt(s.x, s.z) - 0.03, s.z);
        rig.root.rotation.y = s.yaw;
        const idle = new CamelIdle(rig);
        idle.kneel = idle.kneelTarget = s.kneel;
        this.group.add(rig.root);
        const col = ctx.world.colliders.circle(s.x, s.z, s.kneel ? 1.0 : 0.75, rig.root.position.y - 0.5, rig.root.position.y + (s.kneel ? 1.2 : 2.1), {});
        O.camels.push({ rig, idle, col, grunt: 0 });
      }
    } catch (e) {
      console.warn('[ruins] camel failed', e);
    }
    // dragonflies over the water, rain frogs on the bank
    for (let i = 0; i < 3; i++) {
      const rig = new RigInstance(buildRigGeo(dragonflyRig(i), 'dragonfly' + i), { castShadow: false });
      const p = new THREE.Vector3(a.x + (rnd.next() - 0.5) * r, level + 0.6, a.z + (rnd.next() - 0.5) * r);
      rig.root.position.copy(p);
      this.group.add(rig.root);
      O.critters.push({ rig, kind: 'fly', pos: p.clone(), from: p.clone(), to: p.clone(), t: 1, dur: 1, phase: rnd.next() * 10 });
    }
    const frog = modelEntry('rain_frog_baby');
    if (frog) {
      for (let i = 0; i < 3; i++) {
        const key = i === 0 ? 'rain_frog_baby' : 'rain_frog_baby_v' + i;
        const spec = (modelEntry(key) ?? frog)() as RigSpec;
        if (!spec?.parts) continue;
        const rig = new RigInstance(buildRigGeo(spec, key + ':critter'), { castShadow: true });
        const ang = rnd.next() * Math.PI * 2;
        const p = new THREE.Vector3(a.x + Math.cos(ang) * r * 1.08, 0, a.z + Math.sin(ang) * r * 1.08);
        p.y = ctx.world.groundAt(p.x, p.z);
        rig.root.position.copy(p);
        rig.root.rotation.y = Math.atan2(a.x - p.x, a.z - p.z);
        rig.root.scale.setScalar(0.8);
        this.group.add(rig.root);
        O.critters.push({ rig, kind: 'frog', pos: p.clone(), from: p.clone(), to: p.clone(), t: 1, dur: 0.5, phase: rnd.next() * 6 });
      }
    }
    this.oases.push(O);
  }

  private drink(O: Oasis) {
    const d = this.d, ctx = d.ctx;
    if (O.cool > 0) return;
    const healed = d.player.heal(d.player.maxHp);
    O.cool = 60;
    O.drink.enabled = false;
    const p = O.drink.pos;
    ctx.sfx('heal', p, 0.8);
    ctx.sfx('water_loop', p, 0.4, 1.3);
    ctx.fx.bubbles({ x: p.x, y: p.y + 0.2, z: p.z }, 6);
    ctx.fx.sparkle({ x: d.player.pos.x, y: d.player.pos.y + 1.2, z: d.player.pos.z }, 0x9dff3a, 10, 0.9);
    ctx.toast('REFRESHED', '#7fe0d0', healed > 0.5 ? 'The oasis heals you' : 'Cool, sweet water');
  }

  // ---------------------------------------------------------------- spiders
  private liveSpiders() {
    let n = 0;
    for (const e of this.d.enemies.list) if (e.alive && e.def.id === 'ruinSpider') n++;
    return n;
  }

  private spawnSpider(x: number, z: number, alpha = false, emerge: Enemy['emerge'] = 'run') {
    if (!ENEMIES.ruinSpider) ENEMIES.ruinSpider = RUIN_SPIDER;
    return this.d.enemies.spawn('ruinSpider', x, z, { alpha, emerge });
  }

  /** a spider bursts out of its funnel nest and lunges at the hunter */
  private burstNest(R: Ruin, n: Ruin['nests'][number]) {
    const ctx = this.d.ctx, pp = this.d.player.pos;
    n.done = true;
    const p = n.pos;
    ctx.fx.sandBurst({ x: p.x, y: p.y, z: p.z }, 1.1);
    this.silk(p, 16);
    ctx.sfx('sand_burst', p, 0.8, 1.1);
    ctx.sfx('giant_scorpion_hiss', p, 0.7, 1.55);
    const e = this.spawnSpider(p.x, p.z, n.alpha);
    if (!e) return;
    // the lunge: straight out of the hole, landing just short of the hunter
    const dx = pp.x - p.x, dz = pp.z - p.z, L = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, L - 1.2) / L;
    e.state = 'leap';
    e.stateT = 0;
    e.leapDur = 0.55;
    e.leapFrom.copy(e.pos);
    e.leapTo.set(p.x + dx * k, ctx.world.groundAt(p.x + dx * k, p.z + dz * k), p.z + dz * k);
    e.yaw = Math.atan2(dx, dz);
    this.d.enemies.skill(e, RUIN_SPIDER.moveTitles!.nest, undefined, true);
    if (R.big) this.d.ctx.engine.tweens.after(0.5, () => this.spawnSpider(p.x + (rnd.next() - 0.5), p.z + (rnd.next() - 0.5)));
  }

  /** egg sacs twitch, swell and burst: a small ambush skitters out */
  private hatch(R: Ruin, g: Egg) {
    const ctx = this.d.ctx;
    g.done = true;
    g.mesh.geometry = g.mesh.userData.burst;
    g.mesh.scale.setScalar(1);
    const p = g.pos;
    ctx.sfx('scarab_squish', p, 0.9, 0.8);
    ctx.sfx('poison_burst', p, 0.6, 1.3);
    ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.3, z: p.z }, count: 18, vel: { x: 0, y: 3.2, z: 0 }, spread: 2.6, gravity: 12, drag: 0.6, life: [0.5, 0.9], size: [0.12, 0.05], sprite: ['venomSplat', 'dot3'], color: [0xd8e070, 0xa8b848, 0xf2ecd8], ground: true });
    this.silk(p, 12);
    const n = R.big ? 3 : 2;
    let first: Enemy | null = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd.next();
      const e = this.spawnSpider(p.x + Math.cos(a) * 0.8, p.z + Math.sin(a) * 0.8);
      first ??= e;
    }
    if (first) this.d.enemies.skill(first, RUIN_SPIDER.moveTitles!.eggs, undefined, true);
  }

  /** a spider lowers itself on a silk line from a web, then drops the last bit */
  private startDrop(p: V3, alpha = false) {
    const ctx = this.d.ctx;
    spiderSpec ??= ruinSpiderRig();
    const rig = new RigInstance(buildRigGeo(spiderSpec, 'ruin_spider:drop'), { castShadow: true });
    const to = { x: p.x + (rnd.next() - 0.5) * 0.8, y: 0, z: p.z + (rnd.next() - 0.5) * 0.8 };
    to.y = ctx.world.groundAt(to.x, to.z);
    const from = { x: to.x, y: Math.max(to.y + 2.2, p.y), z: to.z };
    rig.root.position.set(from.x, from.y, from.z);
    rig.root.rotation.set(Math.PI * 0.5, rnd.next() * 6.28, 0, 'YXZ');
    if (alpha) rig.root.scale.setScalar(1.32);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y + 0.6, from.z), new THREE.Vector3(from.x, from.y, from.z)]);
    const line = new THREE.Line(geo, this.silkMat);
    this.group.add(rig.root, line);
    this.drops.push({ rig, line, from, to, t: 0, alpha });
    ctx.sfx('scorpion_chitter', from, 0.55, 1.6);
  }

  private updateDrops(dt: number) {
    const ctx = this.d.ctx;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const D = this.drops[i];
      D.t += dt;
      const T = 1.1;
      const k = Math.min(1, D.t / T);
      // abseil: quick, jerky descent, legs splayed and paddling
      const ease = k < 0.75 ? (k / 0.75) * 0.8 + Math.sin(k * 30) * 0.015 : 0.8 + ((k - 0.75) / 0.25) ** 2 * 0.2;
      const y = D.from.y + (D.to.y - D.from.y) * ease;
      D.rig.root.position.set(D.to.x, y, D.to.z);
      D.rig.root.rotation.x = Math.PI * 0.5 * (1 - Math.max(0, (k - 0.7) / 0.3));
      D.rig.root.rotation.y += dt * 1.6;
      const n = D.rig.nodes;
      for (let l = 1; l <= 4; l++) {
        const w = Math.sin(this.t * 22 + l * 1.3) * 0.35;
        n['leg_l' + l]?.rotation.set(0, w * 0.4, 0.25 + w);
        n['leg_r' + l]?.rotation.set(0, -w * 0.4, -0.25 - w);
      }
      const pts = (D.line.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      pts.setXYZ(1, D.to.x, y + 0.35, D.to.z);
      pts.needsUpdate = true;
      if (k >= 1) {
        D.rig.root.removeFromParent();
        D.line.geometry.dispose();
        D.line.removeFromParent();
        this.drops.splice(i, 1);
        ctx.fx.dust({ x: D.to.x, y: D.to.y + 0.1, z: D.to.z }, 0.7, undefined, 4);
        const e = this.spawnSpider(D.to.x, D.to.z, D.alpha);
        if (e) {
          e.yaw = Math.atan2(this.d.player.pos.x - D.to.x, this.d.player.pos.z - D.to.z);
          this.d.enemies.skill(e, RUIN_SPIDER.moveTitles!.drop, undefined, false);
        }
      }
    }
  }

  /** silk shreds drifting off a burst nest / sac */
  private silk(p: V3, n: number) {
    this.d.ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.4, z: p.z }, count: n, vel: { x: 0, y: 1.6, z: 0 }, spread: 2.2, gravity: 1.2, drag: 2.2, life: [0.8, 1.6], size: [0.16, 0.06], sprite: ['linen', 'dot3'], color: [0xf2eee4, 0xdcd6c8], rot: 3, rotSpeed: 4 });
  }

  // ---------------------------------------------------------------- frame
  update(dt: number) {
    this.t += dt;
    const d = this.d, ctx = d.ctx, pp = d.player.pos;
    const alive = d.player.alive;
    let live = -1;
    // ---- ruins: nests, egg sacs, web drops, reinforcements during fights
    for (const R of this.ruins) {
      const dist = Math.hypot(R.x - pp.x, R.z - pp.z);
      if (dist > R.r + 40) continue;
      if (alive) {
        for (const n of R.nests) if (!n.done && Math.hypot(n.pos.x - pp.x, n.pos.z - pp.z) < 7.5 && Math.abs(n.pos.y - pp.y) < 4) this.burstNest(R, n);
        for (const g of R.eggs) {
          if (g.done) continue;
          if (g.t < 0 && Math.hypot(g.pos.x - pp.x, g.pos.z - pp.z) < 6.5) {
            g.t = 0;
            ctx.sfx('scorpion_chitter', g.pos, 0.6, 1.9);
          }
          if (g.t >= 0) {
            g.t += dt;
            const sw = 1 + Math.sin(g.t * 26) * 0.04 * g.t + g.t * 0.14;
            g.mesh.scale.set(sw, 1 + g.t * 0.2, sw);
            g.mesh.rotation.z = Math.sin(g.t * 31) * 0.05 * g.t;
            if (g.t > 0.95) {
              g.mesh.rotation.z = 0;
              this.hatch(R, g);
            }
          }
        }
        for (const dr of R.drops) {
          if (dr.done || Math.hypot(dr.pos.x - pp.x, dr.pos.z - pp.z) > 7) continue;
          dr.done = true;
          this.startDrop(dr.pos, false);
        }
      }
      // fights near the ruin wake the rest of the colony: spiders drop out of its webs
      R.reinforceT -= dt;
      if (R.reinforceT <= 0) {
        R.reinforceT = 18 + rnd.next() * 14;
        if (live < 0) live = this.liveSpiders();
        const fight = d.enemies.alive > 2;
        if (alive && fight && dist > 8 && dist < R.r + 32 && live < 5) {
          const src = R.drops.length ? R.drops[Math.floor(rnd.next() * R.drops.length)].pos : { x: R.x, y: ctx.world.groundAt(R.x, R.z) + 3, z: R.z };
          this.startDrop(src, false);
          this.d.ctx.engine.tweens.after(0.6, () => this.startDrop({ x: src.x + (rnd.next() - 0.5) * 2, y: src.y, z: src.z + (rnd.next() - 0.5) * 2 }, false));
          live += 2;
        }
      }
    }
    this.updateDrops(dt);
    // ---- outposts: reach the lookout and its chest bursts open
    for (const o of this.outposts) {
      if (o.done || o.chest.opened) continue;
      if (Math.hypot(o.top.x - pp.x, o.top.z - pp.z) < 5 && pp.y > o.top.y - 3.2) {
        o.done = true;
        o.chest.inter.enabled = true;
        void o.chest.open();
        ctx.toast('LOOKOUT LOOT', '#ffd36b', 'Somebody stashed this up here');
      }
    }
    // ---- oases
    for (const O of this.oases) {
      const dist = Math.hypot(O.x - pp.x, O.z - pp.z);
      if (O.cool > 0) {
        O.cool -= dt;
        if (O.cool <= 0) O.drink.enabled = true;
      }
      if (dist > O.r + 70) continue;
      // resting by the water: slow regeneration while nothing hunts you
      if (alive && dist < O.r * 1.7 && d.player.hp < d.player.maxHp) {
        const still = Math.hypot(d.player.board.vel.x, d.player.board.vel.z) < 2.5;
        let threat = false;
        for (const e of d.enemies.list) if (e.alive && e.pos.distanceToSquared(pp) < 400) {
          threat = true;
          break;
        }
        if (still && !threat) {
          O.regenT += dt;
          if (O.regenT > 1) {
            O.regenT = 0;
            d.player.heal(d.player.maxHp * 0.03);
            ctx.fx.sparkle({ x: pp.x, y: pp.y + 1, z: pp.z }, 0x9dff3a, 3, 0.6);
          }
        }
      }
      for (const c of O.camels) {
        c.idle.update(dt, pp);
        c.grunt -= dt;
        const cd = c.rig.root.position.distanceTo(pp);
        if (cd < 3.2 && c.grunt <= 0) {
          c.grunt = 6 + rnd.next() * 4;
          ctx.sfx(rnd.chance(0.3) ? 'camel_spit' : 'camel_grunt', c.rig.root.position, 0.7, 0.9 + rnd.next() * 0.2);
        }
      }
      for (const cr of O.critters) this.critter(O, cr, dt);
    }
  }

  private critter(O: Oasis, c: Critter, dt: number) {
    const ctx = this.d.ctx, pp = this.d.player.pos;
    c.phase += dt;
    c.t += dt / c.dur;
    if (c.kind === 'fly') {
      if (c.t >= 1) {
        // dart to a new hover point over the water / reeds
        c.from.copy(c.pos);
        const a = rnd.next() * Math.PI * 2, r = O.r * (0.2 + rnd.next() * 0.85);
        c.to.set(O.x + Math.cos(a) * r, O.level + 0.35 + rnd.next() * 1.1, O.z + Math.sin(a) * r);
        c.dur = 0.35 + rnd.next() * 0.5;
        c.t = -rnd.next() * 1.8; // hover a while first
      }
      const k = Math.max(0, Math.min(1, c.t));
      const e = k * k * (3 - 2 * k);
      c.pos.lerpVectors(c.from, c.to, e);
      c.rig.root.position.set(c.pos.x, c.pos.y + Math.sin(c.phase * 3) * 0.04, c.pos.z);
      if (c.t > 0 && c.t < 1) c.rig.root.rotation.y = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
      const f = Math.sin(c.phase * 70) * 0.6;
      c.rig.nodes['wing_l']?.rotation.set(0, 0, f);
      c.rig.nodes['wing_r']?.rotation.set(0, 0, -f);
      return;
    }
    // frogs: sit, blink at you, hop along the bank; scatter when the hunter rides close
    const near = c.pos.distanceTo(pp) < 4;
    if (c.t >= 1 && (near || rnd.chance(dt * 0.25))) {
      c.from.copy(c.pos);
      const ang = Math.atan2(c.pos.z - O.z, c.pos.x - O.x) + (rnd.next() - 0.5) * 0.9 + (near ? 0 : 0);
      const rr = O.r * (0.95 + rnd.next() * 0.3);
      c.to.set(O.x + Math.cos(ang) * rr, 0, O.z + Math.sin(ang) * rr);
      if (near) c.to.addScaledVector(_v.set(c.pos.x - pp.x, 0, c.pos.z - pp.z).normalize(), 1.2);
      c.to.y = ctx.world.groundAt(c.to.x, c.to.z);
      c.t = 0;
      c.dur = 0.45;
      c.rig.root.rotation.y = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
    }
    if (c.t < 1) {
      const k = Math.max(0, c.t);
      c.pos.lerpVectors(c.from, c.to, k);
      c.pos.y += Math.sin(k * Math.PI) * 0.45;
      c.rig.root.scale.set(0.8, 0.8 * (1 + Math.sin(k * Math.PI) * 0.25), 0.8);
    } else c.rig.root.scale.set(0.8 * (1 + Math.sin(c.phase * 2.2) * 0.02), 0.8 * (1 - Math.sin(c.phase * 2.2) * 0.03), 0.8);
    c.rig.root.position.copy(c.pos);
  }

  dispose() {
    const d = this.d;
    for (const O of this.oases) {
      d.inter.remove(O.drink);
      for (const c of O.camels) if (c.col) d.ctx.world.colliders.remove(c.col as never);
    }
    for (const D of this.drops) D.line.geometry.dispose();
    this.group.removeFromParent();
    this.ruins = [];
    this.drops = [];
    this.oases = [];
    this.outposts = [];
  }
}
