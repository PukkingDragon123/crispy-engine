// THE GLASS HOLLOW — the giant sand cave under the desert (a stage of its own).
//
// The hunter falls through the sinkhole (run/CavePit.ts), tumbles down a sand chute
// and wakes up in a vast cavern: rippled sand floors to ride, strata walls, rock
// columns, a vault hung with stalactites and pierced by sky cracks that drop dusty
// beams of daylight, crystal clusters lighting the dark cyan and violet, a black lake
// glowing with plankton. Giant bats roost on the vault, crystal goblins hide in the
// sand of their dens, crystal crabs lie burrowed on the shore (run/CaveBestiary.ts),
// and in the lake sleeps THE OLM (bosses/Olm.ts), a blind albino salamander that hunts
// by vibration: loud riding draws it. Slay it and its death cracks the lakebed: a
// geyser roars up under the exit crack and blasts the hunter back to the surface.
//
// The same player / board / gun / skills / items / upgrades / gear / enemies / pickups
// systems run here as in RunScene, on a World-shaped CaveWorld (world/CaveGen.ts). The
// run comes in and goes out as a RunCarry (the same snapshot the storm travel uses).
//
// Two ways to run it:
//   hosted (the real game): CavePit builds it, calls enter(), points the post stack at
//     its scene / camera and forwards update / postRender while it lives; onExit hands
//     the carry back (died / olm slain flags) and CavePit plays the return.
//   standalone (debug): debugCave(engine) sets it as the engine scene with a fresh run.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { CaveWorld } from '../world/CaveGen';
import { Particles } from '../fx/Particles';
import { Fx } from '../fx/Fx';
import { Debris } from '../fx/Debris';
import { GroundMarks, MARK_AREA, MarkChannel } from '../fx/GroundMarks';
import { ClothRenderer } from '../../engine/physics/Cloth';
import { Player, PlayerVisuals } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { Enemies, Enemy } from '../enemies/Enemies';
import { Pickups } from '../run/Pickups';
import { Hud, HudState } from '../ui/Hud';
import { Hud3D, CutInOpts } from '../ui/Hud3D';
import { Ctx, EventBus, RunState } from '../Ctx';
import { modelEntry } from '../models/lookup';
import { placeholderBoard, placeholderHumanoid, placeholderRevolver } from '../models/placeholder';
import type { RigSpec } from '../../engine/voxel/Rig';
import { clamp, damp, rnd, lerp } from '../../engine/math/rand';
import { StatusId } from '../combat/Status';
import { Qte } from '../ui/Qte';
import { Skills } from '../player/Skills';
import { Inventory, ITEMS } from '../player/Items';
import { Ultimate } from '../player/Ultimate';
import { UpgradeManager, UpgradeEffects } from '../run/Upgrades';
import { registerExtraUpgrades, ExtraUpgradeEffects } from '../run/UpgradesExtra';
import { CardPicker } from '../ui/CardPicker';
import { Garments } from '../player/Garments';
import { Interactions, Chest } from '../run/Interact';
import { Equipment } from '../player/Equipment';
import { GearPickups } from '../run/GearLoot';
import { GearHud } from '../ui/GearHud';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { loadSave, GunLoadout, gunMods } from '../meta/Save';
import * as CH from '../models/characters';
import { FaceQuads } from '../fx/FaceFx';
import { CaveBestiary } from '../run/CaveBestiary';
import { Olm } from '../bosses/Olm';
import type { Boss } from '../bosses/Boss';
import { ATMO } from '../../engine/render/VoxelMaterial';
import { nav } from '../Nav';
import type { RunCarry } from './RunScene';

export interface CaveExit {
  carry: RunCarry;
  died: boolean;
  olmSlain: boolean;
}
export interface CaveSceneOpts {
  carry: RunCarry;
  look?: { hat: string; outfit: string; board: string };
  gun?: GunLoadout;
  seed?: number;
  /** hosted inside RunScene (CavePit): hand the run back when the hunter leaves */
  onExit?: (out: CaveExit) => void;
  /** debug: skip the fall / wake-up */
  skipIntro?: boolean;
  /** debug: wake the Olm straight away */
  olmNow?: boolean;
}

function resolveRig(keys: string[], fallback: () => RigSpec): RigSpec {
  for (const k of keys) {
    const e = modelEntry(k);
    if (e) {
      const r = e();
      if ((r as RigSpec).parts) return r as RigSpec;
    }
  }
  return fallback();
}
function resolveStatic(keys: string[], fallback: () => { model: any; voxelSize: number }) {
  for (const k of keys) {
    const e = modelEntry(k);
    if (e) {
      const r = e() as any;
      if (r.model) return r as { model: any; voxelSize: number };
    }
  }
  return fallback();
}

type J = Record<string, [number, number, number]>;
/** Sundown's wake-up keys: lying on his back → propped up → rubbing his skull → crouch → standing (offsets on the rest pose) */
const K_LIE: J = { arm_l: [0.35, 0, 0.95], fore_l: [-0.5, 0, 0], arm_r: [0.2, 0, -1.05], fore_r: [-0.35, 0, 0], thigh_l: [-0.2, 0, 0.14], shin_l: [0.45, 0, 0], thigh_r: [0.08, 0, -0.1], shin_r: [0.18, 0, 0], head: [0.05, 0.55, 0], jaw: [0.3, 0, 0], hat: [0.4, 0, 0.2] };
const K_PROP: J = { thigh_l: [-1.45, 0, 0.18], shin_l: [0.2, 0, 0], thigh_r: [-1.35, 0, -0.12], shin_r: [0.55, 0, 0], torso: [-0.35, 0, 0], head: [0.25, 0.2, 0], arm_l: [0.75, 0, 0.3], fore_l: [-0.15, 0, 0], arm_r: [0.75, 0, -0.3], fore_r: [-0.15, 0, 0], jaw: [0.15, 0, 0] };
const K_RUB: J = { thigh_l: [-1.45, 0, 0.18], shin_l: [0.25, 0, 0], thigh_r: [-1.2, 0, -0.12], shin_r: [0.9, 0, 0], torso: [0.25, 0, 0.05], head: [0.15, -0.35, 0.18], arm_l: [0.45, 0, 0.35], fore_l: [-0.3, 0, 0], arm_r: [-2.2, 0, -0.32], fore_r: [-2.05, 0, 0], jaw: [0.1, 0, 0] };
const K_CROUCH: J = { thigh_l: [-1.25, 0, 0.1], shin_l: [1.85, 0, 0], thigh_r: [-0.6, 0, -0.08], shin_r: [1.35, 0, 0], torso: [0.5, 0, 0], head: [-0.2, 0.3, 0], arm_l: [-0.4, 0, 0.2], fore_l: [-0.6, 0, 0], arm_r: [-0.2, 0, -0.25], fore_r: [-0.4, 0, 0] };
const K_STAND: J = { arm_l: [0.04, 0, 0.09], arm_r: [0.04, 0, -0.09], fore_l: [-0.2, 0, 0], fore_r: [-0.2, 0, 0], head: [0, -0.5, 0] };
/** root offset (y, pitch) per key: on his back, sitting, crouched, standing */
const ROOT: Record<string, [number, number]> = { lie: [0.16, -1.5], prop: [-0.48, 0], rub: [-0.48, 0], crouch: [-0.42, 0], stand: [0, 0] };

export class CaveScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
  ctx!: Ctx;
  world!: CaveWorld;
  particles!: Particles;
  fx!: Fx;
  debris!: Debris;
  marks!: GroundMarks;
  cloth!: ClothRenderer;
  player!: Player;
  camRig!: CameraRig;
  enemies!: Enemies;
  pickups!: Pickups;
  hud!: Hud;
  hud3d!: Hud3D;
  faces = new FaceQuads();
  qte!: Qte;
  skills!: Skills;
  items!: Inventory;
  ult!: Ultimate;
  upgrades!: UpgradeManager;
  upFx!: UpgradeEffects;
  upFx2!: ExtraUpgradeEffects;
  picker!: CardPicker;
  garments!: Garments;
  inter!: Interactions;
  equipment!: Equipment;
  gearLoot!: GearPickups;
  gearHud!: GearHud;
  bestiary!: CaveBestiary;
  touch: TouchControls | null = null;
  events = new EventBus();
  run: RunState = { wave: 0, bounty: 0, rank: 1, bountyToNext: 12, gold: 0, kills: 0, totalBounty: 0, totalGold: 0, time: 0, ultCharge: 0, revived: false, combo: 0, comboTimer: 0, style: 0 };
  bosses: Boss[] = [];
  olm: Olm | null = null;
  chests: Chest[] = [];
  ready = false;
  /** where the stage is: the fall + wake-up, roaming, the Olm, the geyser, leaving */
  phase: 'arrive' | 'explore' | 'olm' | 'geyser' | 'leave' | 'gone' = 'arrive';
  private codexKills: Record<string, number> = {};
  private bossNames: string[] = [];
  private hitMarker = 0;
  private killMarker = 0;
  private lastRdt = 1 / 60;
  private pausedByUser = false;
  private cineHudHidden = false;
  private pickerShown = false;
  /** wake-up / launch cinematics own the hunter's rig and the camera */
  private cine: { kind: 'fall' | 'wake' | 'launch'; t: number; skip?: boolean } | null = null;
  private loops: { amb: any; water: any; slide: any; wind: any } = { amb: null, water: null, slide: null, wind: null };
  private lastTrack = new THREE.Vector3();
  private hasTrack = false;
  private exploreT = 0;
  private disturb = 0;
  private wasGrounded = true;
  private airT = 0;
  private geyserT = 0;
  private olmSlain = false;
  private fill!: THREE.PointLight;
  private bloomSave = { s: 0, t: 0, r: 0 };
  private told = new Set<string>();
  private leaving = false;
  private unsub: (() => void)[] = [];

  constructor(public engine: Engine, public opts: CaveSceneOpts) {}

  async enter() {
    const e = this.engine;
    this.world = new CaveWorld(this.scene, this.opts.seed ?? 1);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.fx = new Fx(this.particles, this.scene);
    this.debris = new Debris();
    this.scene.add(this.debris.mesh);
    this.marks = new GroundMarks(e.renderer);
    this.world.terrain.setMarks(this.marks.rt.texture, MARK_AREA);
    this.cloth = new ClothRenderer();
    this.scene.add(this.cloth.mesh);
    this.particles.groundAt = this.world.groundAt;
    this.debris.groundAt = this.world.groundAt;
    this.camRig = new CameraRig(this.camera, this.world.groundAt);
    this.hud = new Hud(e.overlay);
    this.hud3d = new Hud3D(this.hud);
    this.scene.add(this.faces.mesh);
    const self = this;
    this.ctx = {
      engine: e,
      scene: this.scene,
      camera: this.camera,
      world: this.world as any,
      particles: this.particles,
      fx: this.fx,
      audio: e.audio,
      enemies: null as any,
      run: this.run,
      sfx(id, pos, vol = 1, pitch = 1) {
        e.audio.play(id, { pos: pos ?? undefined, volume: vol, pitch });
      },
      shake(a) {
        self.camRig.addTrauma(a);
      },
      toast(text, color, sub, big) {
        self.hud.toast(text, color, sub, big);
      },
      events: this.events,
      faces: this.faces,
    };
    // ---- the hunter
    const sv = loadSave();
    const look = this.opts.look ?? sv.look;
    const gun = this.opts.gun ?? sv.gun;
    const vis: PlayerVisuals = {
      rig: resolveRig([`cowboy_${look.hat}_${look.outfit}`, 'cowboy_stetson_punk'], () => placeholderHumanoid()),
      gun: (() => {
        try {
          const g = gun ? ((CH as any).revolverRig?.(gun) as RigSpec | undefined) : undefined;
          if (g?.parts) return g;
        } catch (err) {
          console.warn('gun build failed', err);
        }
        return resolveRig(['revolver_standard', 'revolver'], placeholderRevolver);
      })(),
      board: resolveStatic([`board_${look.board}`, 'board_driftwood'], placeholderBoard),
    };
    this.player = new Player(this.ctx, vis, this.camRig, e.input);
    this.hud3d.setBust(vis.rig, vis.rig.name + ':player', vis.gun);
    this.hud3d.scene.environment = this.scene.environment;
    if (gun) this.player.stats.add(gunMods(gun) as any);
    this.enemies = new Enemies(this.ctx, this.player as any);
    this.ctx.enemies = this.enemies;
    this.qte = new Qte(e.overlay, e.input, e.audio);
    this.enemies.qte = this.qte;
    this.skills = new Skills(this.ctx, this.player, e.input);
    this.items = new Inventory(this.ctx, this.player);
    this.ult = new Ultimate(this.ctx, this.player, this.qte, this.camRig);
    this.upgrades = new UpgradeManager(this.player.stats);
    this.upFx = new UpgradeEffects(this.ctx, this.upgrades, this.player, this.skills);
    registerExtraUpgrades();
    this.upFx2 = new ExtraUpgradeEffects(this.ctx, this.upgrades, this.player, this.skills);
    this.equipment = new Equipment(this.ctx, this.player);
    this.gearLoot = new GearPickups(this.ctx, this.player, this.equipment, e.input, this.hud);
    this.gearHud = new GearHud(this.hud3d.scene, this.hud, this.equipment);
    this.picker = new CardPicker(this.ctx, this.upgrades, e.input, () => this.player.pos, { cam: this.camRig, hero: () => this.player });
    this.inter = new Interactions(this.player);
    this.garments = new Garments(this.player.rig, this.cloth, this.world.groundAt);
    if (isTouchDevice()) {
      this.touch = new TouchControls(e.overlay, e.input, this.qte);
      e.input.lockFailed = true;
      e.input.setWantLock(true);
    }
    // ---- the run comes in
    const cy = this.opts.carry;
    Object.assign(this.run, cy.run);
    this.ctx.run = this.run;
    for (const id of cy.history) this.upgrades.apply(id);
    this.player.stats.add(cy.mods);
    this.items.slots = cy.items.map((s) => (s ? { ...s } : null)) as any;
    this.player.hp = this.player.maxHp * Math.max(0.3, cy.hpFrac);
    this.player.ammo = this.player.maxAmmo;
    this.codexKills = { ...cy.codex };
    this.bossNames = [...cy.bosses];
    this.ult.variant = cy.ult as any;
    this.equipment.restore((cy.gear ?? []) as any);
    this.equipment.deadHandSpent = !!cy.deadHand;
    const v3 = new THREE.Vector3();
    this.hud.project = (p) => {
      v3.set(p.x, p.y, p.z).project(this.camera);
      return { x: (v3.x * 0.5 + 0.5) * e.width, y: (-v3.y * 0.5 + 0.5) * e.height, visible: v3.z < 1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2 };
    };
    this.pickups = new Pickups(this.ctx, () => this.player);
    this.pickups.onBounty = (v) => this.addBounty(v);
    this.bestiary = new CaveBestiary({ ctx: this.ctx, enemies: this.enemies, player: this.player as any });
    this.populate();
    this.wireEvents();
    // a soft cool fill riding with the hunter keeps him readable in the dark
    this.fill = new THREE.PointLight(0xb8d4ff, 7, 11, 1.6);
    this.scene.add(this.fill);
    // ---- place him on the mound under the chute
    const L = this.world.layout;
    const sx = L.start.x, sz = L.start.z;
    this.player.board.place(sx, this.world.groundAt(sx, sz), sz, L.start.heading);
    this.camRig.yaw = L.start.heading;
    this.world.terrain.buildAll(this.player.pos);
    this.world.ceiling.buildAll(this.player.pos);
    // ---- the cave look: lower bloom threshold so the crystals glow
    const b = e.post.bloom;
    this.bloomSave = { s: b.strength, t: b.threshold, r: b.radius };
    b.strength = 0.42;
    b.threshold = 0.62;
    b.radius = 0.55;
    // ---- sound
    this.loops.amb = e.audio.loop('underworld_loop', 0.45);
    this.loops.water = e.audio.loop('water_loop', 0);
    this.loops.slide = e.audio.loop('board_slide_loop', 0);
    this.loops.wind = e.audio.loop('wind_loop', 0.08);
    (window as any).__music?.setMood('underworld');
    (window as any).__cave = this;
    e.input.setWantLock(true);
    this.ready = true;
    if (this.opts.skipIntro) {
      this.phase = 'explore';
      this.hud.setVisible(true);
      e.fadeIn(0.4);
    } else this.startArrival();
    if (this.opts.olmNow) e.tweens.after(1, () => this.wakeOlm());
  }

  /** dens, beds, roosts, a goblin hoard chest */
  private populate() {
    const L = this.world.layout;
    const bs = this.bestiary;
    bs.addRoost(L.roosts, 0);
    bs.addDen(L.dens[0].x, L.dens[0].z, L.dens[0].r ?? 9, 4, 2, false);
    bs.addDen(L.dens[1].x, L.dens[1].z, L.dens[1].r ?? 9, 5, 2, true);
    bs.addCrabBed(L.crabBeds[0].x, L.crabBeds[0].z, 6, 1, false);
    bs.addCrabBed(L.crabBeds[1].x, L.crabBeds[1].z, 6, 2, true);
    bs.addCrabBed(L.crabBeds[2].x, L.crabBeds[2].z, 6, 1, false);
    const d1 = L.dens[1];
    this.spawnChest(d1.x + 3, d1.z - 2, 'silver');
  }

  spawnChest(x: number, z: number, tier: 'wood' | 'silver' | 'gold' | 'divine', rot = rnd.next() * 6.28) {
    const c = new Chest(this.ctx, x, z, rot, tier, (ch) => {
      const l = ch.loot();
      const at = { x: ch.root.position.x, y: ch.root.position.y + 0.8, z: ch.root.position.z };
      this.pickups.drop('gold', 1, at, Math.min(30, Math.ceil(l.gold / 3)));
      if (l.item) {
        if (this.items.add(l.item)) this.hud.toast(ITEMS[l.item].name.toUpperCase(), '#9dff3a', 'Found in the chest');
        else this.hud.toast('POCKETS FULL', '#ff8a6a', ITEMS[l.item].name + ' left behind');
      }
      if (l.card) this.engine.tweens.after(0.7, () => this.picker.request());
      this.gearLoot.onChest(ch.tier, at);
    });
    this.chests.push(c);
    this.inter.add(c.inter);
    return c;
  }

  // ------------------------------------------------------------------ events
  private wireEvents() {
    const ev = this.events;
    ev.on('shot', (hit: any) => {
      if (hit?.enemy) this.hitMarker = 0.12;
      this.hud.onShot();
      this.olm?.hear(this.player.pos.x, this.player.pos.z, 0.14);
      this.disturb += 0.08;
    });
    ev.on('explosion', (p: { x: number; z: number }) => {
      this.olm?.hear(p.x, p.z, 0.5);
      this.disturb += 0.25;
    });
    ev.on('rankUp', () => this.picker.request());
    ev.on('cutin', (title: string, color?: string, expr?: string, opts?: CutInOpts) => this.hud3d.cutIn(title, color, expr, opts));
    ev.on('bossIntro', (b: Boss) => this.hud3d.cutIn(b.name.toUpperCase(), '#9af0ff', 'surprised', { geo: b.rig.geo, eyes: [b.eyes.state.style, b.eyes.state.color], height: b.height / b.scale, flip: true }));
    ev.on('enemyKilled', (en: Enemy) => {
      this.killMarker = 0.2;
      this.run.kills++;
      this.codexKills[en.def.id] = (this.codexKills[en.def.id] ?? 0) + 1;
      this.run.combo++;
      this.run.comboTimer = 3;
      const wave = Math.max(1, this.run.wave);
      const b = en.def.bounty * (en.alpha ? 8 : 1) * this.player.stats.get('bountyGain') * (1 + wave * 0.04);
      this.pickups.dropBounty(b, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z });
      const [g0, g1] = en.def.gold;
      const gold = Math.round((g0 + rnd.next() * (g1 - g0)) * (en.alpha ? 5 : 1) * this.player.stats.get('goldGain'));
      if (gold > 0) this.pickups.drop('gold', 1, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z }, Math.min(gold, 12));
      if (rnd.chance(0.03 + (en.alpha ? 0.5 : 0))) this.pickups.drop('heart', 25, en.pos);
      this.run.ultCharge = Math.min(1, this.run.ultCharge + 0.006 * this.player.stats.get('ultCharge') * (en.alpha ? 6 : 1));
      if (this.run.combo === 10 || this.run.combo === 25 || this.run.combo % 50 === 0) {
        this.hud.toast(`${this.run.combo} STREAK!`, '#ffd36b');
        this.player.express('laugh', 1);
      }
    });
    this.pickups.onCollect = (k, v, at) => {
      if (k === 'gold') this.hud.fly('coin', at);
      if (k === 'bounty' || k === 'bountyBig') this.addBounty(v);
      else if (k === 'gold') {
        this.run.gold += v;
        this.run.totalGold += v;
      } else if (k === 'heart') this.player.heal(v);
      else if (k === 'boost') this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.3);
    };
    ev.on('trick', (l: any) => {
      this.hud.toast(l.trickName || 'TRICK', l.quality === 'perfect' ? '#ffd36b' : l.quality === 'sketchy' ? '#e0b373' : '#6fe3cf', `+${l.score} style`);
      this.run.style += l.score;
      this.run.ultCharge = Math.min(1, this.run.ultCharge + l.score / 6000);
      this.ctx.sfx('trick_spin', null, 0.6);
    });
    ev.on('graze', () => {
      this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.02);
      this.run.ultCharge = Math.min(1, this.run.ultCharge + 0.002);
    });
    ev.on('groundMark', (x: number, z: number, r: number, ch: MarkChannel) => this.marks.splat(x, z, r, ch));
    ev.on('gibs', (x: number, y: number, z: number, n: number, size: number, cols: number[], speed: number, up: number) => this.debris.burst(x, y, z, n, size, cols, speed, up));
    ev.on('playerHurt', (a: number) => {
      this.engine.post.u.uDamage.value = Math.min(1, this.engine.post.u.uDamage.value + a / 40);
    });
    ev.on('playerDeath', () => this.onPlayerDeath());
    this.bestiary.onEncounter = (kind) => {
      if (kind === 'bats') this.hud.toast('THE VAULT IS ALIVE', '#c8a0ff', 'Giant bats! Hovering ones are about to screech.', true);
      else if (kind === 'goblins') this.hud.toast('AMBUSH', '#8af4ff', 'Crystal goblins came up out of the sand behind you!', true);
      else this.hud.toast('CRYSTAL CRABS', '#8af4ff', 'Shoot the crystals off their backs: they reflect your shots.', true);
      (window as any).__music?.setMood('combat');
    };
  }

  addBounty(v: number) {
    const r = this.run;
    r.bounty += v;
    r.totalBounty += v;
    while (r.bounty >= r.bountyToNext) {
      r.bounty -= r.bountyToNext;
      r.rank++;
      r.bountyToNext = Math.round(12 + r.rank * 9 + Math.pow(r.rank, 1.6) * 2);
      this.hud.toast(`BOUNTY RANK ${r.rank}`, '#9dff3a', 'Upgrade earned', true);
      this.ctx.sfx('rank_up', null, 0.8);
      this.events.emit('rankUp', r.rank);
    }
  }

  // ------------------------------------------------------------------ the carry out
  snapshot(): RunCarry {
    return {
      run: { ...this.run },
      history: [...this.upgrades.history],
      items: this.items.slots.map((x) => (x ? { ...x } : null)),
      hpFrac: this.player.alive ? this.player.hp / this.player.maxHp : 0,
      mods: this.player.stats.mods.filter((m) => !m.source.startsWith('up:') && m.source !== 'gun' && !m.source.startsWith('item:') && !m.source.startsWith('gear:') && !m.source.startsWith('upx:')),
      gear: this.equipment.snapshot(),
      deadHand: this.equipment.deadHandSpent,
      codex: { ...this.codexKills },
      bosses: [...this.bossNames],
      ult: this.ult.variant,
    };
  }

  private leave(died: boolean) {
    if (this.leaving) return;
    this.leaving = true;
    this.phase = 'gone';
    const out: CaveExit = { carry: this.snapshot(), died, olmSlain: this.olmSlain };
    if (this.opts.onExit) this.opts.onExit(out);
    else nav.menu();
  }

  private async onPlayerDeath() {
    const eng = this.engine;
    this.hud.toast('YOU DIED', '#ff5a3a', 'The dark keeps your bones…', true);
    this.ctx.sfx('sting_negative', null, 0.8);
    eng.slowMo(0.2, 6);
    await eng.tweens.wait(2.2, true);
    await eng.fadeOut(0.9);
    eng.slowMo(1, 50);
    this.leave(true);
  }

  // ------------------------------------------------------------------ arrival: the fall and the wake-up
  private rest: Record<string, THREE.Euler> = {};
  private startArrival() {
    const e = this.engine;
    this.hud.setVisible(false);
    e.letterbox(true, 0.01);
    e.input.enabled = false;
    for (const p of this.player.rig.geo.parts) this.rest[p.name] = p.rest.clone();
    this.cine = { kind: 'fall', t: 0 };
    e.fadeIn(0.35);
    this.ctx.sfx('sand_rise', null, 0.9, 0.7);
    this.ctx.sfx('whoosh_big', null, 0.8, 0.6);
  }

  /** pose the rig from a blend of two keys (offsets on the rest pose) and a root (y, pitch) */
  private pose(a: J, b: J, k: number, ra: [number, number], rb: [number, number]) {
    const n = this.player.rig.nodes;
    for (const [name, r] of Object.entries(this.rest)) {
      const nd = n[name];
      if (!nd) continue;
      const oa = a[name] ?? [0, 0, 0], ob = b[name] ?? [0, 0, 0];
      nd.rotation.set(r.x + lerp(oa[0], ob[0], k), r.y + lerp(oa[1], ob[1], k), r.z + lerp(oa[2], ob[2], k));
    }
    const root = this.player.rig.root;
    root.position.set(0, lerp(ra[0], rb[0], k), 0);
    root.rotation.set(lerp(ra[1], rb[1], k), 0, 0);
  }

  private updateArrival(dt: number, rdt: number) {
    const c = this.cine!;
    const e = this.engine;
    const L = this.world.layout;
    const P = this.player;
    c.t += rdt;
    const t = c.t;
    const pu = e.post.u;
    const g = this.world.groundAt(L.start.x, L.start.z);
    const skip = (e.input.wasPressed('Space') || e.input.wasPressed('Escape') || e.input.wasPressed('Enter')) && t > 0.6;
    if (c.kind === 'fall') {
      // tumbling down the chute in a cascade of sand, toward the mound
      const k = Math.min(1, t / 1.5);
      const y = lerp(L.chute.top - 3, g + 0.3, k * k);
      P.root.position.set(L.chute.x + Math.sin(t * 3) * 0.3, y, L.chute.z + 0.6);
      P.root.rotation.set(t * 5.2, t * 2.1, t * 3.3);
      P.boardMesh.visible = false;
      this.camRig.setCine({ pos: new THREE.Vector3(L.chute.x + 7, g + 1.6, L.chute.z + 8), look: new THREE.Vector3(L.chute.x, lerp(L.chute.top - 6, g + 2, k), L.chute.z), fov: 62 }, false);
      this.fx.p.emit({ pos: { x: P.root.position.x, y: y + 1, z: P.root.position.z }, count: 8, vel: { x: 0, y: -6, z: 0 }, spread: 2, jitter: 1, gravity: 9, life: [0.6, 1.2], size: [0.06, 0.1], sprite: 'dot3', color: [0xd8b47c, 0xc89c64, 0xe6c48e], ground: true });
      if (k >= 1 || skip) {
        this.ctx.sfx('board_land', null, 1, 0.5);
        this.ctx.sfx('sand_burst', null, 0.9, 0.7);
        this.ctx.shake(0.7);
        this.fx.sandBurst({ x: L.start.x, y: g, z: L.start.z }, 2.4);
        e.fadeOut(0.12, '#000');
        this.ctx.sfx('heartbeat', null, 0.8, 0.85);
        c.kind = 'wake';
        c.t = 0;
        c.skip = skip;
      }
      return;
    }
    if (c.kind !== 'wake') return;
    // black, a heartbeat, water dripping; the eyes open on a blur that slowly clears
    const T0 = c.skip ? 0.1 : 1.6;
    const lieAt = new THREE.Vector3(L.start.x, g, L.start.z);
    P.root.position.copy(lieAt);
    P.root.rotation.set(0, L.start.heading, 0);
    P.stance.rotation.y = 0;
    P.stance.position.y = 0;
    P.boardMesh.visible = true;
    P.boardMesh.position.set(-1.1, 0.04, 0.3);
    P.boardMesh.rotation.set(0.12, 0.6, 0.18);
    if (t < T0) {
      this.pose(K_LIE, K_LIE, 0, ROOT.lie, ROOT.lie);
      if (t > 0.7 && !this.told.has('beat2')) {
        this.told.add('beat2');
        this.ctx.sfx('heartbeat', null, 0.7, 0.8);
      }
      return;
    }
    if (!this.told.has('open')) {
      this.told.add('open');
      void e.fadeIn(2.2);
      pu.uRadial.value = 1;
      pu.uDesat.value = 0.75;
      this.ctx.sfx('gem_chime', null, 0.25, 0.6);
    }
    const w = t - T0;
    const blurK = clamp(1 - w / 3.2, 0, 1);
    pu.uRadial.value = blurK * 1.1;
    pu.uRadialCenter.value.set(0.5, 0.55);
    pu.uDesat.value = blurK * 0.75;
    pu.uVignette.value = 0.32 + blurK * 0.6;
    const head = new THREE.Vector3(lieAt.x - Math.sin(L.start.heading) * 1.4, g + 0.35, lieAt.z - Math.cos(L.start.heading) * 1.4);
    // keys: lying 0-2.2, propped up 2.2-3.2, rub 3.2-4.6, crouch 4.6-5.6, stand 5.6-6.6
    const seg = (a: number, b: number) => clamp((w - a) / (b - a), 0, 1);
    const s = (x: number) => x * x * (3 - 2 * x);
    if (w < 2.2) this.pose(K_LIE, K_LIE, 0, ROOT.lie, ROOT.lie);
    else if (w < 3.2) this.pose(K_LIE, K_PROP, s(seg(2.2, 3.2)), ROOT.lie, ROOT.prop);
    else if (w < 4.6) this.pose(K_PROP, K_RUB, s(seg(3.2, 3.8)), ROOT.prop, ROOT.rub);
    else if (w < 5.6) this.pose(K_RUB, K_CROUCH, s(seg(4.6, 5.6)), ROOT.rub, ROOT.crouch);
    else this.pose(K_CROUCH, K_STAND, s(seg(5.6, 6.5)), ROOT.crouch, ROOT.stand);
    if (w > 3.4 && w < 4.6) {
      const n = P.rig.nodes['fore_r'];
      if (n) n.rotation.z += Math.sin(w * 14) * 0.15; // rubbing the dent in his skull
    }
    P.rig.setExpression(w < 4.6 ? 'hurt' : w < 6 ? 'surprised' : 'determined');
    if (w > 2.2 && !this.told.has('groan')) {
      this.told.add('groan');
      this.ctx.sfx('skeleton_rattle', P.pos, 0.6, 0.8);
    }
    // camera: his eyes first (looking up at the vault, a drop falling), then a low side shot
    if (w < 2.2) {
      const up = new THREE.Vector3(head.x + 0.4, head.y + 20, head.z + 2);
      this.camRig.setCine({ pos: head.clone().add(new THREE.Vector3(0, 0.25, 0)), look: up, fov: 64 }, false);
      if (w > 0.6 && !this.told.has('drop')) {
        this.told.add('drop');
        this.fx.p.emit({ pos: { x: head.x + 0.05, y: head.y + 9, z: head.z + 0.1 }, count: 1, vel: { x: 0, y: -3, z: 0 }, gravity: 9.8, life: [1.1, 1.1], size: [0.06, 0.09], sprite: 'dot3', color: 0xd6f0ff, stretch: 0.03 });
        e.tweens.after(1.05, () => {
          e.flash(0xd6f0ff, 0.25, 0.25);
          this.ctx.sfx('gem_chime', null, 0.3, 1.6);
        }, true);
      }
    } else {
      const side = new THREE.Vector3(Math.cos(L.start.heading), 0, -Math.sin(L.start.heading));
      const cp = lieAt.clone().addScaledVector(side, 3.3).add(new THREE.Vector3(0, 0.75 + seg(4.6, 6.6) * 0.6, 0)).addScaledVector(new THREE.Vector3(Math.sin(L.start.heading), 0, Math.cos(L.start.heading)), 0.8);
      const lk = lieAt.clone().add(new THREE.Vector3(0, 0.55 + seg(4.6, 6.6) * 0.6, 0));
      this.camRig.setCine({ pos: cp, look: lk, fov: 50 - seg(5.6, 7) * 6 }, this.told.has('cut'));
      this.told.add('cut');
    }
    if (w > 6.6 && !this.told.has('title')) {
      this.told.add('title');
      this.hud3d.cutIn('THE GLASS HOLLOW', '#8af4ff', 'surprised');
      this.ctx.sfx('sting_positive', null, 0.5, 0.7);
    }
    if (w > 7.6 || (skip && w > 0.2)) this.endArrival();
  }

  private endArrival() {
    const e = this.engine;
    const P = this.player;
    const L = this.world.layout;
    this.cine = null;
    P.rig.resetPose();
    P.rig.root.position.set(0, 0, 0);
    P.rig.root.rotation.set(0, 0, 0);
    P.stance.rotation.y = -Math.PI / 2;
    P.stance.position.y = 0.1;
    P.boardMesh.position.set(0, 0.06, 0);
    P.boardMesh.rotation.set(0, 0, 0);
    P.boardMesh.visible = true;
    P.root.rotation.set(0, 0, 0);
    P.board.place(L.start.x, this.world.groundAt(L.start.x, L.start.z), L.start.z, L.start.heading);
    P.rig.setExpression('determined');
    this.camRig.yaw = L.start.heading;
    this.camRig.setCine(null);
    const pu = e.post.u;
    pu.uRadial.value = 0;
    pu.uDesat.value = 0;
    e.letterbox(false, 0.5);
    e.input.enabled = true;
    e.fadeIn(0.3);
    this.hud.setVisible(true);
    this.phase = 'explore';
    this.hud.toast('THE GLASS HOLLOW', '#8af4ff', 'Somewhere under the desert. Find a way back up.', true);
  }

  // ------------------------------------------------------------------ the Olm
  private wakeOlm() {
    if (this.olm || this.phase === 'geyser' || this.phase === 'leave' || this.phase === 'gone') return;
    this.phase = 'olm';
    const L = this.world.layout;
    const w = Math.max(1, this.run.wave);
    const o = new Olm({ ctx: this.ctx, player: this.player, enemies: this.enemies, qte: this.qte, cam: this.camRig, cloth: this.cloth }, {
      lake: L.lake, water: -0.45, hp: Math.round(3000 * (1 + w * 0.025)),
      stir: (k) => (this.world.stir = Math.max(this.world.stir, k)),
      ripple: (x, z, k) => this.world.ripple(x, z, k),
      ceilingAt: (x, z) => this.world.ceilingAt(x, z),
    });
    o.place(L.lake.x, L.lake.z, 0);
    this.olm = o;
    this.enemies.registerExternal(o);
    this.bosses.push(o);
    (window as any).__music?.setMood('boss');
    o.onDefeated = (bb, escaped) => {
      const at = { x: bb.pos.x, y: Math.max(bb.pos.y, -0.4) + 1, z: bb.pos.z };
      this.pickups.dropBounty(bb.bounty * this.player.stats.get('bountyGain'), at);
      this.pickups.drop('gold', 1, at, Math.min(40, Math.round(bb.gold / 4)));
      this.pickups.drop('heart', 40, at);
      this.run.ultCharge = Math.min(1, this.run.ultCharge + 0.25);
      if (!escaped) {
        this.bossNames.push(bb.name);
        this.codexKills['olm'] = (this.codexKills['olm'] ?? 0) + 1;
        this.hud.toast(`${bb.name.toUpperCase()}: BOUNTY CLAIMED`, '#ffd36b', `+${Math.round(bb.bounty)} bounty`, true);
      }
      this.olmSlain = true;
      (window as any).__music?.setMood('explore');
      this.openGeyser();
    };
    void o.start();
  }

  /** the dying Olm cracked the lakebed: a geyser builds under the exit crack */
  private openGeyser() {
    this.phase = 'geyser';
    this.geyserT = 0;
    const L = this.world.layout;
    for (const s of this.world.shafts) if (s.exit) (s.mesh.material as THREE.ShaderMaterial).uniforms.uK.value = 2.4;
    const ex = this.world.layout.exit;
    this.spawnChest(L.lake.x - (L.lake.r + 3), L.lake.z - 4, 'gold');
    this.engine.tweens.after(2.5, () => {
      this.hud.toast('THE LAKEBED CRACKS', '#9af0ff', 'A geyser is building under the light. Ride into it!', true);
      this.ctx.sfx('quake_rumble', { x: ex.x, y: 0, z: ex.z }, 1, 0.7);
      this.ctx.shake(0.5);
    });
  }

  private updateGeyser(dt: number) {
    const ex = this.world.layout.exit;
    this.geyserT += dt;
    const fx = this.fx;
    const y = -0.45;
    this.world.stir = Math.max(this.world.stir, 0.6);
    // bubbling, pulses of spray, steam
    if (Math.random() < dt * 14) fx.p.emit({ pos: { x: ex.x + (Math.random() - 0.5) * 3, y: y + 0.05, z: ex.z + (Math.random() - 0.5) * 3 }, count: 3, spread: 0.8, up: 1.5, life: [0.4, 0.8], size: [0.1, 0.18], sprite: 'bubble', color: [0xbfefff, 0x8ad8f0] });
    const pulse = (this.geyserT % 2.6) < 0.9;
    if (pulse && this.geyserT > 2) {
      fx.p.emit({ pos: { x: ex.x, y: y + 0.2, z: ex.z }, count: 10, vel: { x: 0, y: 16 + Math.random() * 6, z: 0 }, spread: 2, jitter: 0.8, gravity: 9, life: [1.2, 2], size: [0.1, 0.06], sprite: 'dot3', color: [0xffffff, 0xd6f0ff, 0x9ad8f0] });
      if (Math.random() < 0.5) fx.p.emit({ pos: { x: ex.x, y: y + 2, z: ex.z }, count: 2, vel: { x: 0, y: 6, z: 0 }, spread: 1.5, life: [1.5, 2.6], size: [1.4, 3.4], sprite: ['cloud0', 'puff0', 'cloud1'], color: [0xe8f4f8, 0xc8e0e8], alpha: 0.55, drag: 0.8, rot: 6, rotSpeed: 0.4 });
      if (Math.random() < dt * 3) this.world.ripple(ex.x, ex.z, 1.2);
    }
    const pp = this.player.pos;
    if (this.player.alive && this.geyserT > 2 && Math.hypot(pp.x - ex.x, pp.z - ex.z) < 3.8) this.launch();
  }

  /** the geyser erupts under him and blasts him up through the crack into the daylight */
  private launch() {
    if (this.phase === 'leave') return;
    this.phase = 'leave';
    const e = this.engine;
    e.input.enabled = false;
    e.letterbox(true, 0.4);
    this.hud.setVisible(false);
    this.cine = { kind: 'launch', t: 0 };
    this.ctx.sfx('explosion_big', this.player.pos, 0.8, 0.7);
    this.ctx.sfx('sand_burst', this.player.pos, 1, 0.5);
    this.ctx.sfx('whoosh_big', this.player.pos, 1, 0.8);
    this.ctx.shake(1);
    this.player.invuln = 99;
    (window as any).__music?.setMood('victory');
  }

  private updateLaunch(dt: number, rdt: number) {
    const c = this.cine!;
    const e = this.engine;
    const ex = this.world.layout.exit;
    const P = this.player;
    c.t += rdt;
    const t = c.t;
    const top = this.world.ceilingAt(ex.x, ex.z) > 80 ? 46 : 40;
    const k = Math.min(1, t / 2.4);
    const y = lerp(-0.2, top + 8, k * k);
    P.board.pos.set(ex.x, y, ex.z);
    P.board.vel.set(0, 0, 0);
    P.root.position.set(ex.x, y, ex.z);
    P.root.rotation.y += rdt * 9;
    // a roaring column of water and steam
    this.fx.p.emit({ pos: { x: ex.x, y: -0.2, z: ex.z }, count: 14, vel: { x: 0, y: 24, z: 0 }, spread: 2.5, jitter: 1, gravity: 6, life: [1.2, 2.2], size: [0.12, 0.08], sprite: 'dot3', color: [0xffffff, 0xd6f0ff, 0x9ad8f0] });
    this.fx.p.emit({ pos: { x: ex.x, y: Math.max(0, y - 3), z: ex.z }, count: 3, vel: { x: 0, y: 10, z: 0 }, spread: 2, life: [1.2, 2], size: [2, 4.5], sprite: ['cloud0', 'cloud1', 'puff0'], color: [0xf0f8fc, 0xd8e8ee], alpha: 0.6, drag: 1, rot: 6, rotSpeed: 0.5 });
    this.camRig.setCine({ pos: new THREE.Vector3(ex.x + 9, 1.6 + t * 4, ex.z + 9), look: new THREE.Vector3(ex.x, y, ex.z), fov: 58 + t * 6 }, t > 0.05);
    if (t > 1.7 && !this.told.has('white')) {
      this.told.add('white');
      void e.fadeOut(0.7, '#fff4e0');
    }
    if (t > 2.5) {
      this.cine = null;
      this.leave(false);
    }
  }

  // ------------------------------------------------------------------ pause
  setPaused(p: boolean) {
    const e = this.engine;
    if (p === this.pausedByUser) return;
    this.pausedByUser = p;
    e.paused = p;
    e.input.setWantLock(!p);
    e.audio.setMuffle(p ? 0.6 : 0);
    e.audio.play(p ? 'paper_flutter' : 'ui_close', { volume: 0.7 });
    this.hud3d.showPause(p, [
      { label: 'RESUME', fn: () => this.setPaused(false) },
      { label: 'MAIN MENU', fn: () => {
        this.setPaused(false);
        nav.menu();
      } },
    ]);
  }

  // ------------------------------------------------------------------ update
  update(dt: number, rdt: number) {
    if (!this.ready || this.phase === 'gone') return;
    const e = this.engine;
    this.run.time += dt;
    this.touch?.update(this.picker.active || this.pausedByUser);
    if (!this.picker.active && !this.gearLoot.active && !this.cine && e.input.hit('pause')) this.setPaused(!this.pausedByUser);
    this.qte.update(rdt);
    this.picker.update(rdt);
    this.gearLoot.update(dt, rdt);
    const cineHud = this.picker.active || this.gearLoot.active;
    if (cineHud !== this.cineHudHidden) {
      this.cineHudHidden = cineHud;
      this.hud.setVisible(!cineHud && !this.cine);
    }
    if (this.picker.active !== this.pickerShown) {
      this.pickerShown = this.picker.active;
      this.skills.pinchRoot.visible = !this.pickerShown;
    }
    if (this.picker.active) {
      this.cloth.update(rdt * 0.2, e.realTime);
      this.updateHud(rdt);
      return;
    }
    this.faces.begin();
    const P = this.player;
    const pp = P.pos;
    if (this.cine) {
      if (this.cine.kind === 'launch') this.updateLaunch(dt, rdt);
      else this.updateArrival(dt, rdt);
      P.rig.root.updateMatrixWorld(true);
    } else {
      if (e.input.hit('ultimate') && this.run.ultCharge >= 1 && P.alive && !this.ult.active) this.ult.trigger();
      P.update(dt);
      this.skills.update(dt);
      this.items.update(dt, e.input);
      this.upFx.update(dt);
      this.upFx2.update(dt);
      this.equipment.update(dt);
    }
    this.garments.update(0.3, 0.1, P.board.vel);
    this.enemies.update(dt, this.run.time);
    this.pickups.update(dt);
    this.inter.update(e.input);
    this.bestiary.update(dt);
    for (let i = this.bosses.length - 1; i >= 0; i--) {
      const b = this.bosses[i];
      b.update(dt);
      if (!b.alive && !b.root.parent) this.bosses.splice(i, 1);
    }
    this.world.update(dt, pp, e.realTime, this.fx);
    this.fill.position.set(pp.x - Math.sin(this.camRig.yaw) * 1.2, pp.y + 2.4, pp.z - Math.cos(this.camRig.yaw) * 1.2);
    if (!this.cine) {
      this.direct(dt);
      this.listen(dt);
      if (this.phase === 'geyser') this.updateGeyser(dt);
    }
    // board sound + tracks
    const sp = P.speed;
    this.loops.slide?.setVolume(P.board.grounded && !this.cine ? clamp(sp / 13, 0, 1) * 0.5 : 0, 0.08);
    this.loops.slide?.setRate(0.8 + clamp(sp / 40, 0, 0.6));
    const L = this.world.layout;
    const dl = Math.hypot(pp.x - L.lake.x, pp.z - L.lake.z);
    this.loops.water?.setVolume(clamp(1 - (dl - L.lake.r) / 40, 0, 1) * 0.6, 0.3);
    if (P.board.grounded && sp > 2 && P.board.lastSurface.kind !== 'water' && !this.cine) {
      const carveW = 0.4 + Math.min(0.22, Math.abs(P.board.lean) * 0.25) + (P.board.drifting ? 0.18 : 0);
      if (this.hasTrack) this.marks.segment(this.lastTrack.x, this.lastTrack.z, pp.x, pp.z, carveW, 0);
      this.lastTrack.copy(pp);
      this.hasTrack = true;
    } else this.hasTrack = false;
    if (!this.cine) this.emitSand(dt, sp);
    this.particles.update(dt, this.world.env.fog);
    this.debris.update(dt);
    this.fx.update(dt);
    this.cloth.update(dt, e.realTime);
    this.marks.flush(dt);
    this.world.terrain.setMarkClock(this.marks.clock);
    this.camRig.update(rdt, pp, sp, !P.board.grounded, P.board.lean);
    // post moods
    const pu = e.post.u;
    pu.uDamage.value = Math.max(0, pu.uDamage.value - rdt * 1.5);
    pu.uPoison.value = P.status.has('poison') ? 0.6 : Math.max(0, pu.uPoison.value - rdt);
    if (!this.cine) {
      pu.uRadial.value = clamp((sp - 11) / 10, 0, 0.6) + (P.board.boosting ? 0.25 : 0) + this.bestiary.pulse;
      pu.uRadialCenter.value.set(0.5, 0.5);
      pu.uVignette.value = 0.42;
    }
    this.run.comboTimer -= dt;
    if (this.run.comboTimer <= 0) this.run.combo = 0;
    this.hitMarker = Math.max(0, this.hitMarker - rdt);
    this.killMarker = Math.max(0, this.killMarker - rdt);
    this.faces.end(this.world.env.fog);
    this.updateHud(rdt);
  }

  /** paces the cave: the Olm wakes when the shore is reached after a fight or two, or when the lake is disturbed */
  private direct(dt: number) {
    if (this.phase !== 'explore') return;
    this.exploreT += dt;
    const L = this.world.layout;
    const pp = this.player.pos;
    const dl = Math.hypot(pp.x - L.lake.x, pp.z - L.lake.z);
    const fighting = this.enemies.list.some((x) => x.alive);
    // pushing hard near the water carries through the stone
    if (dl < L.lake.r + 40) this.disturb += this.loudness(dt) * clamp(1.3 - (dl - L.lake.r) / 40, 0.2, 1.2);
    this.disturb = Math.max(0, this.disturb - dt * 0.05);
    if (dl < L.lake.r + 30 && !this.told.has('lake')) {
      this.told.add('lake');
      this.hud.toast('A BLACK LAKE', '#9af0ff', 'Something vast moves under it. It feels the board: ride softly…', true);
    }
    if (this.disturb > 0.55 && !this.told.has('stir')) {
      this.told.add('stir');
      this.world.stir = 1;
      this.ctx.sfx('quake_rumble', { x: L.lake.x, y: 0, z: L.lake.z }, 0.8, 0.6);
      this.hud.toast('THE WATER TREMBLES', '#9af0ff', 'It heard that.');
    }
    const ready = (this.bestiary.triggered >= 3 || this.exploreT > 170) && !fighting;
    if ((ready && dl < L.lake.r + 10) || this.disturb > 1 || (this.exploreT > 260 && !fighting)) this.wakeOlm();
  }

  /** how loud the hunter is this frame (vibrations through the sand) */
  private loudness(dt: number) {
    const P = this.player;
    const inp = this.engine.input;
    let loud = 0;
    if (inp.hit('push') && P.board.grounded) loud += 0.2;
    if (P.board.boosting) loud += dt * 0.7;
    if (P.speed > 12) loud += dt * 0.1 * ((P.speed - 12) / 8);
    if (!P.board.grounded) this.airT += dt;
    else {
      if (!this.wasGrounded && this.airT > 0.45) loud += 0.25 + Math.min(0.3, this.airT * 0.15);
      this.airT = 0;
    }
    this.wasGrounded = P.board.grounded;
    return loud;
  }
  /** feed the Olm what it hears */
  private listen(dt: number) {
    const loud = this.phase === 'olm' ? this.loudness(dt) : 0;
    if (this.olm && loud > 0) this.olm.hear(this.player.pos.x, this.player.pos.z, loud);
  }

  /** cave sand: board spray, skittering grains, dust drifting in the still air */
  private emitSand(dt: number, sp: number) {
    const b = this.player.board;
    const p = this.player.pos;
    const pa = this.particles;
    const SAND = [0xd8b884, 0xc8a470, 0xb8925e, 0xe8cc98];
    if (b.grounded && sp > 2.5 && b.lastSurface.kind !== 'water') {
      const f = b.forward;
      const side = Math.sign(b.lean || 1);
      const carve = Math.min(1, Math.abs(b.lean) * 1.6) + (b.drifting ? 1 : 0) + (b.boosting ? 0.6 : 0);
      const rate = Math.min(80, sp * 2 + carve * 36);
      const n = Math.floor(rate * dt) + (Math.random() < (rate * dt) % 1 ? 1 : 0);
      if (n > 0) {
        const back = { x: p.x - f.x * 0.55, y: p.y + 0.05, z: p.z - f.z * 0.55 };
        pa.emit({ pos: back, count: n, spread: 0.25, vel: { x: -f.x * sp * 0.22 + f.z * side * carve * 2.5, y: 1.5 + carve * 1.5 + sp * 0.04, z: -f.z * sp * 0.22 - f.x * side * carve * 2.5 }, jitter: 1.2 + carve, gravity: 9, drag: 1.2, life: [0.35, 0.8], size: [0.05, 0.11], sprite: ['dot3', 'dot3', 'puff0'], color: SAND, ground: true });
      }
    } else if (b.grounded && b.lastSurface.kind === 'water' && sp > 3 && Math.random() < dt * 12) {
      pa.emit({ pos: { x: p.x, y: -0.4, z: p.z }, count: 3, spread: 1.2, up: 1.6, gravity: 9, life: [0.3, 0.6], size: [0.05, 0.03], sprite: 'dot3', color: [0xd6f0ff, 0x8ad8f0] });
      if (Math.random() < 0.3) this.world.ripple(p.x, p.z, 0.4);
    }
    // dust motes hanging in the still cave air
    if (Math.random() < dt * 7) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 10;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      pa.emit({ pos: { x, y: this.world.groundAt(x, z) + 0.5 + Math.random() * 3, z }, count: 1, vel: { x: 0.08, y: 0.03, z: 0.05 }, jitter: 0.1, gravity: -0.01, drag: 0.1, life: [3, 5], size: [0.025, 0.04], sprite: 'dot3', color: [0xcfe0ff, 0xe8dcc8], alpha: 0.7 });
    }
  }

  postRender(renderer: THREE.WebGLRenderer) {
    if (!this.ready || this.phase === 'gone') return;
    this.hud3d.update(this.lastRdt);
    this.gearHud.update(this.lastRdt);
    this.hud3d.render(renderer);
  }

  private objective(): { text: string; sub: string } | null {
    if (this.phase === 'explore') {
      const loud = this.disturb > 0.7 ? 'LOUD' : this.disturb > 0.35 ? 'uneasy' : 'quiet';
      return { text: 'Find a way out of the Glass Hollow', sub: this.told.has('lake') ? `The lake listens: ${loud}` : 'Follow the light and the crystals' };
    }
    if (this.phase === 'olm' && this.olm?.alive) {
      const h = this.olm.hearing;
      return { text: 'Slay the Olm', sub: this.olm.searching ? 'It lost you: shoot the gills!' : h > 0.6 ? 'It hears every push: coast to lose it' : 'Shoot the gills, ride softly' };
    }
    if (this.phase === 'geyser') return { text: 'Ride into the geyser', sub: 'Up through the crack, back to the sun' };
    return null;
  }

  private updateHud(rdt: number) {
    this.lastRdt = rdt;
    const p = this.player;
    const st: HudState = {
      hp: p.hp,
      maxHp: p.maxHp,
      shield: p.shield,
      ammo: p.ammo,
      maxAmmo: p.maxAmmo,
      venom: p.venomRounds,
      reload: { active: p.reload.active, t: p.reload.t, window: p.reload.window, jam: p.reload.jam, phase: p.reload.phase },
      boost: p.board.boostMeter,
      speed: p.speed,
      rank: this.run.rank,
      bountyFrac: this.run.bounty / this.run.bountyToNext,
      bountyTotal: this.run.totalBounty,
      gold: this.run.gold,
      wave: this.run.wave,
      waveTime: 0,
      waveLabel: 'THE GLASS HOLLOW',
      boss: (() => {
        const b = this.bosses.find((x) => x.alive && !x.escaped && x.root.visible);
        return b ? { name: b.name, frac: Math.max(0, b.frac), title: b.title } : null;
      })(),
      ult: this.run.ultCharge,
      skills: (() => {
        const cd = this.skills.cooldowns();
        return [
          { key: 'Q', icon: 'twig', cd: Math.max(0, p.grappleCd), max: 2.2 },
          { key: 'E', icon: 'scorp', cd: cd.scorp, max: this.skills.constants.scorpCd },
          { key: 'C', icon: 'scarab', cd: cd.swarm, max: this.skills.constants.swarmCd },
          { key: 'G', icon: 'dung', cd: cd.bomb, max: this.skills.constants.bombRecharge, charges: cd.bombCharges },
          { key: 'F', icon: 'bone', cd: Math.max(0, p.meleeCd), max: 0.55 },
        ];
      })(),
      items: this.items.slots.map((sl, i) => ({ key: String(i + 1), icon: sl ? ITEMS[sl.id].icon : '', count: sl?.count ?? 0, model: sl ? ITEMS[sl.id].model : '' })),
      status: (['poison', 'bleed', 'burn', 'curse', 'slow', 'stun'] as StatusId[]).map((id) => ({ id, stacks: p.status.stacks(id) })),
      hitMarker: this.hitMarker,
      killMarker: this.killMarker,
      spreadPx: p.spreadPx(window.innerHeight / this.hud.scale),
      reticle: p.reticle,
      combo: this.run.combo,
      locked: this.engine.input.lookActive,
      aiming: p.aiming,
      zone: 'The Glass Hollow',
      prompt: this.picker.active ? null : this.inter.prompt(),
      objective: this.objective(),
      marker: this.phase === 'geyser' ? { x: this.world.layout.exit.x, y: 1.5, z: this.world.layout.exit.z } : null,
    };
    this.hud.update(rdt, st);
  }

  exit() {
    for (const l of Object.values(this.loops)) l?.stop(0.5);
    for (const u of this.unsub) u();
    this.hud3d.dispose();
    this.hud.dispose();
    this.touch?.dispose();
    this.picker?.dispose();
    this.qte.dispose();
    this.gearLoot?.dispose();
    this.gearHud?.dispose();
    this.equipment?.dispose();
    this.upFx2?.dispose();
    this.bestiary?.dispose();
    for (const b of this.bosses) b.dispose();
    this.events.clear();
    this.world.dispose();
    const e = this.engine;
    const b = e.post.bloom;
    b.strength = this.bloomSave.s;
    b.threshold = this.bloomSave.t;
    b.radius = this.bloomSave.r;
    e.paused = false;
    e.post.u.uDesat.value = 0;
    e.post.u.uRadial.value = 0;
    ATMO.shafts = 0.45;
    if ((window as any).__cave === this) (window as any).__cave = null;
  }
}

// ============================================================================ debug
/** a fresh run's carry (standalone cave / debug) */
export function freshCarry(wave = 12): RunCarry {
  return {
    run: { wave, bounty: 0, rank: 4, bountyToNext: 60, gold: 40, kills: 0, totalBounty: 0, totalGold: 40, time: 0, ultCharge: 0.4, revived: false, combo: 0, comboTimer: 0, style: 0 },
    history: [],
    items: [{ id: 'bandage' as any, count: 2 }, null, null],
    hpFrac: 1,
    mods: [],
    codex: {},
    bosses: [],
    ult: 'serket',
  };
}
/**
 * Standalone cave for testing: `debugCave(engine)` (devtools: `await import('/src/game/scenes/CaveScene.ts')
 * .then(m => m.debugCave(__engine))`). opts.skipIntro / opts.olmNow jump ahead.
 */
export function debugCave(engine: Engine, o: { skipIntro?: boolean; olmNow?: boolean; seed?: number } = {}) {
  const sv = loadSave();
  return engine.setScene(new CaveScene(engine, { carry: freshCarry(), look: sv.look, gun: sv.gun, seed: o.seed ?? 1, skipIntro: o.skipIntro, olmNow: o.olmNow }), 0.3);
}
