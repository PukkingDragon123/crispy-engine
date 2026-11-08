// The run: one sub-area of Serket's Reach, 100-wave structure, player,
// enemies, pickups, HUD, world transformations. Orchestrates all systems.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { World } from '../world/World';
import { Particles } from '../fx/Particles';
import { Fx } from '../fx/Fx';
import { Debris } from '../fx/Debris';
import { GroundMarks, MARK_AREA, MarkChannel } from '../fx/GroundMarks';
import { ClothRenderer } from '../../engine/physics/Cloth';
import { Player, PlayerVisuals } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { Enemies } from '../enemies/Enemies';
import { Pickups } from '../run/Pickups';
import { WaveDirector, WaveSpec } from '../run/WaveDirector';
import { Hud, HudState, HudQuest } from '../ui/Hud';
import { questFromObjective } from '../ui/MissionPaper';
import { Ctx, EventBus, RunState } from '../Ctx';
import { modelEntry } from '../models/lookup';
import { placeholderBoard, placeholderHumanoid, placeholderRevolver } from '../models/placeholder';
import type { RigSpec } from '../../engine/voxel/Rig';
import { clamp, rnd } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';
import type { Enemy } from '../enemies/Enemies';
import { StatusId } from '../combat/Status';
import { Qte } from '../ui/Qte';
import { Skills } from '../player/Skills';
import { Inventory, ITEMS } from '../player/Items';
import { Ultimate } from '../player/Ultimate';
import { UpgradeManager, UpgradeEffects } from '../run/Upgrades';
import { CardPicker } from '../ui/CardPicker';
import { Garments } from '../player/Garments';
import { Props, PropInst } from '../world/Props';
import { Ease } from '../../engine/Tween';
import { Hud3D, CutInOpts } from '../ui/Hud3D';
import type { Boss } from '../bosses/Boss';
import { makeBoss } from '../bosses/BossRoster';
import { Interactions, Chest, DumbScarab } from '../run/Interact';
import { Missions } from '../run/Missions';
import { Choice } from '../ui/Choice';
import { Shop } from '../ui/Shop';
import type { ZoneDef } from '../world/RegionGen';
import { SUBAREAS } from '../world/RegionGen';
import { AnubisTrial } from './AnubisTrial';
import { Ledger } from '../ui/Ledger';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { TrailEvents } from '../run/TrailEvents';
import { ResultsScene } from './ResultsScene';
import { playIntro } from './IntroCine';
import { nav } from '../Nav';
import { awardRun, loadSave, writeSave, GunLoadout, gunMods } from '../meta/Save';
import * as CH from '../models/characters';
import { Cinema } from '../cine/Cinema';
import { cineFlags } from '../cine/CineKit';
import { FaceQuads } from '../fx/FaceFx';
import { MeerkatColony, findClearSpot } from '../run/MeerkatColony';
import { JerboaDance } from '../run/JerboaDance';
import { FrogFamily } from '../run/FrogFamily';
import { TravelerEscort } from '../run/TravelerEscort';
import { WagonRepair } from '../run/WagonRepair';
import { NeckSlicer } from '../player/NeckSlicer';
import { ZoneCine } from './ZoneCine';
import { Tutorial } from '../run/Tutorial';
import { RuinNests } from '../run/RuinNests';
import { Wildlife } from '../run/Wildlife';
import { TreasureHunt } from '../run/TreasureHunt';
import { CavePit } from '../run/CavePit';
import { SoulReaping, prewarmReaping } from './SoulReaping';
import { BountyRip } from '../run/BountyRip';
import { OasisHeart } from '../run/OasisHeart';
import { Barks } from '../audio/Barks';
import { DeathCine, deathCineFromRun } from './DeathCine';
import { CodexRun } from '../ui/codex/CodexRun';
import { Equipment } from '../player/Equipment';
import { GearPickups } from '../run/GearLoot';
import { GearHud } from '../ui/GearHud';
import { registerExtraUpgrades, ExtraUpgradeEffects } from '../run/UpgradesExtra';
import { unlock, technique } from '../player/Techniques';
import { KhonsuAvatar } from '../bosses/Khonsu';
import { ULT_INFO } from '../player/Ultimate';

export interface RunOptions {
  area: 'A' | 'B' | 'C';
  seed: number;
  startWave?: number;
  look?: { hat: string; outfit: string; board: string };
  /** play the Serket opening cinematic */
  intro?: boolean;
  gun?: GunLoadout;
  /** state carried across sub-area travel (waves 50 → 51, 75 → 76) */
  carry?: RunCarry;
}

export interface RunCarry {
  run: RunState;
  history: string[];
  items: ({ id: any; count: number } | null)[];
  hpFrac: number;
  mods: any[];
  codex: Record<string, number>;
  bosses: string[];
  ult: string;
  gear?: string[];
  deadHand?: boolean;
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

/** bounty needed to clear a rank: slow early ranks (each one feels earned),
 *  converging on the old curve from about rank 8 on */
export function rankCost(rank: number) {
  return Math.round(12 + rank * 9 + Math.pow(rank, 1.6) * 2 + 30 * Math.exp(-(rank - 1) / 4));
}

export class RunScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 1, 0.08, 1400);
  ctx!: Ctx;
  world!: World;
  particles!: Particles;
  fx!: Fx;
  debris!: Debris;
  marks!: GroundMarks;
  cloth!: ClothRenderer;
  player!: Player;
  camRig!: CameraRig;
  enemies!: Enemies;
  pickups!: Pickups;
  director!: WaveDirector;
  hud!: Hud;
  hud3d!: Hud3D;
  faces = new FaceQuads();
  bosses: Boss[] = [];
  inter!: Interactions;
  choice!: Choice;
  shop!: Shop;
  missions!: Missions;
  ledger!: Ledger;
  touch: TouchControls | null = null;
  trailEvents!: TrailEvents;
  chests: Chest[] = [];
  scarabs: DumbScarab[] = [];
  private populated = new Set<number>();
  private trial: AnubisTrial | null = null;
  private trail: { x: number; z: number }[] = [];
  private trailT = 0;
  private bossNames: string[] = [];
  private codexKills: Record<string, number> = {};
  private lastRdt = 1 / 60;
  qte!: Qte;
  skills!: Skills;
  items!: Inventory;
  ult!: Ultimate;
  upgrades!: UpgradeManager;
  upFx!: UpgradeEffects;
  picker!: CardPicker;
  garments!: Garments;
  props!: Props;
  events = new EventBus();
  run: RunState = { wave: 0, bounty: 0, rank: 1, bountyToNext: rankCost(1), gold: 0, kills: 0, totalBounty: 0, totalGold: 0, time: 0, ultCharge: 0, revived: false, combo: 0, comboTimer: 0, style: 0 };
  private hitMarker = 0;
  private killMarker = 0;
  private windLoop: any = null;
  private slideLoop: any = null;
  private stormLoop: any = null;
  private lastTrack = new THREE.Vector3();
  private hasTrack = false;
  private gustT = 3;
  colony: MeerkatColony | null = null;
  jerboa: JerboaDance | null = null;
  frogs: FrogFamily | null = null;
  escort: TravelerEscort | null = null;
  wagon: WagonRepair | null = null;
  slicer!: NeckSlicer;
  private pickerShown = false;
  private cineHudHidden = false;
  private hudHero = new THREE.Vector3();
  /** the opening (cold open, sun shot, poster, Serket) is playing: codex cards wait */
  private introOn = false;
  private zoneCine: ZoneCine | null = null;
  tutorial: Tutorial | null = null;
  ruins: RuinNests | null = null;
  wildlife: Wildlife | null = null;
  treasure: TreasureHunt | null = null;
  cavePit: CavePit | null = null;
  private bountyRip: BountyRip | null = null;
  oasis: OasisHeart | null = null;
  private codexRun: CodexRun | null = null;
  equipment!: Equipment;
  gearLoot!: GearPickups;
  gearHud!: GearHud;
  upFx2!: ExtraUpgradeEffects;
  private waveIntroT = 0;
  private gameOver = false;
  ready = false;

  constructor(public engine: Engine, public opts: RunOptions) {}

  async enter() {
    const e = this.engine;
    this.scene.background = null;
    this.world = new World(this.scene, this.opts.area, this.opts.seed);
    this.world.env.applyEnvMap(e.renderer);
    this.props = new Props(this.world);
    this.world.props = { update: () => {}, riseFor: (id, k) => this.props.riseFor(id, k), group: this.props.group };
    this.props.buildZone(this.world.sa.zones[0]);
    if (this.world.sa.zones[1]) this.props.buildZone(this.world.sa.zones[1]);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.fx = new Fx(this.particles, this.scene);
    this.debris = new Debris();
    this.scene.add(this.debris.mesh);
    this.marks = new GroundMarks(e.renderer);
    this.world.terrain.setMarks(this.marks.rt.texture, MARK_AREA);
    // living sand: travelling crests throw pixel sand forward and up
    this.world.sand.onSpray = (x, y, z, dx, dz, k) => {
      const SAND = [0xf0d29a, 0xe3bd80, 0xd6a968, 0xfbe6b8];
      this.particles.emit({ pos: { x, y, z }, count: 2 + Math.round(k * 3), vel: { x: dx * (4 + k * 6), y: 3 + k * 5, z: dz * (4 + k * 6) }, spread: 1.6, jitter: 0.8, gravity: 9, drag: 0.8, life: [0.5, 1.1], size: [0.06, 0.13], sprite: ['dot3', 'dot3', 'puff0'], color: SAND, ground: true });
      if (Math.random() < 0.35) this.particles.emit({ pos: { x, y: y + 0.4, z }, count: 1, vel: { x: dx * 2, y: 1.2, z: dz * 2 }, spread: 0.6, life: [0.8, 1.5], size: [0.8, 1.6], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.45, drag: 1.5 });
    };
    this.cloth = new ClothRenderer();
    this.scene.add(this.cloth.mesh);
    this.particles.groundAt = this.world.groundAt;
    this.debris.groundAt = this.world.groundAt;
    this.camRig = new CameraRig(this.camera, this.world.groundAt);
    this.hud = new Hud(e.overlay);
    this.hud3d = new Hud3D(this.hud);
    this.zoneCine = new ZoneCine({
      engine: e, world: this.world, camRig: this.camRig, scene: this.scene, camera: this.camera,
      player: () => this.player?.pos,
      hud: (on) => this.hud.setVisible(on),
      canPlay: () => !this.gameOver && !!this.player?.alive && !this.trial && !this.picker?.active && !this.choice?.active && !this.shop?.active && !this.ledger?.open && !this.pausedByUser && !this.slicer?.active,
    });
    this.hud3d.scene.environment = this.scene.environment;
    this.scene.add(this.faces.mesh);

    const self = this;
    this.ctx = {
      engine: e,
      scene: this.scene,
      camera: this.camera,
      world: this.world,
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

    // player visuals
    const look = this.opts.look ?? loadSave().look;
    const vis: PlayerVisuals = {
      rig: (() => {
        // the wardrobe can take the bandana mask or the shades off: build that look directly
        const lk = look as { hat: string; outfit: string; mask?: boolean; shades?: boolean };
        if (lk.mask === false || lk.shades === false) {
          try {
            return CH.skeletonCowboyRig({ hat: lk.hat, outfit: lk.outfit, mask: lk.mask, shades: lk.shades } as any);
          } catch {
            /* fall through to the registry look */
          }
        }
        return resolveRig([`cowboy_${look.hat}_${look.outfit}`, 'cowboy_stetson_punk'], () => placeholderHumanoid());
      })(),
      gun: (() => {
        try {
          const g = this.opts.gun ? ((CH as any).revolverRig?.(this.opts.gun) as RigSpec | undefined) : undefined;
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
    Cinema.attach({ ctx: this.ctx, player: this.player, hud: this.hud });
    if (this.opts.gun) this.player.stats.add(gunMods(this.opts.gun) as any);
    this.enemies = new Enemies(this.ctx, this.player as any);
    this.slicer = new NeckSlicer({
      engine: e, ctx: this.ctx, player: this.player, enemies: this.enemies, cam: this.camRig,
      cutIn: (t, c) => this.hud3d.cutIn(t, c, 'determined'),
      hud: (on) => this.hud.setVisible(on),
      onStyle: (v) => {
        this.run.style += v;
        this.addBounty(4);
      },
    });
    this.ctx.enemies = this.enemies;
    this.qte = new Qte(e.overlay, e.input, e.audio);
    this.skills = new Skills(this.ctx, this.player, e.input);
    this.items = new Inventory(this.ctx, this.player);
    this.ult = new Ultimate(this.ctx, this.player, this.qte, this.camRig);
    void ULT_INFO;
    this.upgrades = new UpgradeManager(this.player.stats);
    this.upFx = new UpgradeEffects(this.ctx, this.upgrades, this.player, this.skills);
    registerExtraUpgrades();
    this.upFx2 = new ExtraUpgradeEffects(this.ctx, this.upgrades, this.player, this.skills);
    this.equipment = new Equipment(this.ctx, this.player);
    this.gearLoot = new GearPickups(this.ctx, this.player, this.equipment, e.input, this.hud);
    this.gearHud = new GearHud(this.hud3d.scene, this.hud, this.equipment);
    this.picker = new CardPicker(this.ctx, this.upgrades, e.input, () => this.player.pos, {
      cam: this.camRig,
      hero: () => this.player,
      bulletCam: () => ({ shooter: this.player, hud: (on) => this.hud.setVisible(on), held: () => this.pausedByUser }),
    });
    this.inter = new Interactions(this.player);
    this.choice = new Choice(this.ctx, e.input);
    this.shop = new Shop(this.ctx, e.input, this.camRig);
    this.missions = new Missions({
      ctx: this.ctx, player: this.player, enemies: this.enemies, props: this.props, inter: this.inter, choice: this.choice, shop: this.shop, qte: this.qte, cam: this.camRig, items: this.items,
      gearWares: () => this.gearLoot.shopWares(2),
      card: () => this.picker.request(),
      chest: (x, z, tier) => this.spawnChest(x, z, tier),
      addBounty: (v) => this.addBounty(v),
    });
    this.ruins = new RuinNests({ ctx: this.ctx, player: this.player, enemies: this.enemies, props: this.props, inter: this.inter, chest: (x, z, t, r) => this.spawnChest(x, z, t, r) });
    // the Heart of the Oasis (area B): the Oasis King owns the pond until he falls
    this.oasis = OasisHeart.create({
      ctx: this.ctx, player: this.player, enemies: this.enemies, qte: this.qte,
      cam: this.camRig, cloth: this.cloth, props: this.props, adoptBoss: (b) => this.adoptBoss(b),
    });
    this.cavePit = new CavePit({
      ctx: this.ctx, player: this.player, cam: this.camRig, hud: this.hud,
      look: this.opts.look, gun: this.opts.gun, seed: this.opts.seed,
      carry: () => this.caveCarry(),
      restore: (c) => this.caveRestore(c),
      busy: () => this.gameOver || !!this.trial || this.bosses.some((b) => b.alive) || this.picker.active || this.choice.active || this.shop.active || this.slicer.active,
    });
    this.treasure = new TreasureHunt({
      ctx: this.ctx, player: this.player, inter: this.inter, input: e.input, area: this.opts.area, hud: this.hud, items: this.items,
      pickups: { drop: (k, v, at, n) => this.pickups?.drop(k, v, at, n) },
      chest: (x, z, t, r) => this.spawnChest(x, z, t, r),
    });
    this.wildlife = new Wildlife({ ctx: this.ctx, player: this.player, enemies: this.enemies, inter: this.inter });
    this.populateZone(this.world.sa.zones[0]);
    if (this.world.sa.zones[1]) this.populateZone(this.world.sa.zones[1]);
    this.spawnQuests();
    this.ledger = new Ledger(e.overlay, this.player.stats);
    if (isTouchDevice()) {
      this.touch = new TouchControls(e.overlay, e.input, this.qte);
      this.touch.attach({ hud: this.hud, hudScene: this.hud3d.scene, player: this.player, pinch: this.skills.pinchRoot, enemies: this.enemies });
      e.input.lockFailed = true; // phones: no pointer lock, the touch layer drives the camera
      e.input.setWantLock(true);
    }
    // arriving from another sub-area: restore the run
    const cy = this.opts.carry;
    if (cy) {
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
      e.tweens.after(1.6, () => this.hud3d.cutIn(SUBAREAS[this.opts.area].name.toUpperCase(), '#ffd36b', 'determined'), true);
    }
    this.trailEvents = new TrailEvents({
      ctx: this.ctx, player: this.player, choice: this.choice,
      card: () => this.picker.request(),
      chest: (tier) => {
        const p = this.player.pos, a = this.camRig.yaw;
        this.spawnChest(p.x + Math.sin(a) * 4, p.z + Math.cos(a) * 4, tier);
      },
      ambush: (kind, n) => {
        for (let i = 0; i < n; i++) {
          const sp = this.director.spawnPoint(8, 16);
          if (sp) this.enemies.spawn(kind, sp.x, sp.z, { emerge: 'sand' });
        }
      },
      addBounty: (v) => this.addBounty(v),
    });
    this.garments = new Garments(this.player.rig, this.cloth, this.world.groundAt);
    const v3 = new THREE.Vector3();
    this.hud.project = (p) => {
      v3.set(p.x, p.y, p.z).project(this.camera);
      return { x: (v3.x * 0.5 + 0.5) * e.width, y: (-v3.y * 0.5 + 0.5) * e.height, visible: v3.z < 1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2, behind: v3.z > 1 };
    };
    this.pickups = new Pickups(this.ctx, () => this.player);
    this.pickups.onBounty = (v) => this.addBounty(v);
    this.director = new WaveDirector(this.ctx, this.enemies, () => this.player);
    this.wireEvents();
    new Barks(this.ctx, this.player); // Sundown's voiced quips; tears itself down with the scene
    this.codexRun = new CodexRun(this.ctx, this);

    // place player
    const st = this.world.sa.start;
    const y = this.world.groundAt(st.x, st.z);
    this.player.board.place(st.x, y, st.z, st.heading);
    this.camRig.yaw = st.heading;
    this.world.terrain.buildAll(this.player.pos);

    // audio beds
    this.windLoop = e.audio.loop('wind_loop', 0.55);
    this.slideLoop = e.audio.loop('board_slide_loop', 0);
    this.stormLoop = e.audio.loop('storm_loop', 0);
    e.input.setWantLock(true);
    this.ready = true;
    if (this.opts.intro) {
      // the HUD stays hidden for the whole cinematic
      this.hud.visible = false;
      this.introOn = true;
      void playIntro({ engine: e, cam: this.camRig, player: this.player, fx: this.fx, particles: this.particles, world: this.world, scene: this.scene, cutIn: (t, c, x) => this.hud3d.cutIn(t, c, x) }).then((r) => {
        this.introOn = false;
        this.hud.visible = true;
        // Serket stays to teach the ropes (skipping the intro skips the lesson)
        if (r.skipped) this.director.start(this.opts.startWave ?? 1);
        else this.tutorial = new Tutorial({ ctx: this.ctx, player: this.player, cam: this.camRig });
      });
    } else this.director.start(this.opts.startWave ?? 1);
  }

  exit() {
    this.windLoop?.stop(0.5);
    this.slideLoop?.stop(0.5);
    this.stormLoop?.stop(0.5);
    this.hud3d.dispose();
    this.hud.dispose();
    this.choice?.dispose();
    this.ledger?.dispose();
    this.touch?.dispose();
    this.shop?.dispose();
    this.picker?.dispose();
    this.colony?.dispose();
    this.jerboa?.dispose();
    this.frogs?.dispose();
    this.escort?.dispose();
    this.wagon?.dispose();
    this.slicer?.cancel();
    this.zoneCine?.dispose();
    this.tutorial?.dispose();
    this.ruins?.dispose();
    this.wildlife?.dispose();
    this.treasure?.dispose();
    this.cavePit?.dispose();
    this.oasis?.dispose();
    this.bountyRip?.dispose();
    this.codexRun?.dispose();
    this.engine.paused = false;
    this.engine.post.u.uDesat.value = 0;
    this.qte.dispose();
    this.engine.input.setWantLock(false);
    this.gearLoot?.dispose();
    this.gearHud?.dispose();
    this.equipment?.dispose();
    this.upFx2?.dispose();
    this.events.clear();
  }

  // ------------------------------------------------------------------ events
  private wireEvents() {
    const ev = this.events;
    const ctx = this.ctx;
    // the rain-frog family's thanks: skills cast twice for the rest of the run, and Mama's wig (kept forever)
    ev.on('frogBlessing', () => (this.skills.echo = true));
    ev.on('frogWig', () => {
      const sv = loadSave();
      if (!sv.unlocked.includes('hat:wig')) sv.unlocked.push('hat:wig');
      sv.look.hat = 'wig';
      writeSave(sv);
    });
    // a bell snake coils around the board: mash to break free
    ev.on('snakeWrap', async (sn: any) => {
      const r = await this.qte.run({ kind: 'mash', key: 'KeyE', label: 'BREAK FREE', duration: 2.2, target: 12, at: () => this.player.center(this.hudHero) });
      if (this.enemies.wrapping !== sn) return;
      ev.emit(r === 'fail' ? 'snakeWrapCrush' : 'snakeWrapBreak', sn, r === 'perfect' ? 1.8 : 1);
    });
    this.props.onBreak = (p: PropInst, spd: number, dir?: THREE.Vector3) => this.onPropBroken(p, spd, dir);
    ev.on('explosion', (pos: { x: number; y: number; z: number }, r: number) => {
      this.world.colliders.query(pos.x, pos.z, r + 1, (c) => {
        const pr = c.data?.prop as PropInst | undefined;
        if (!pr || pr.broken || !c.data?.destructible) return;
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (d < r + c.r) this.engine.tweens.after(0.05 + d * 0.03, () => this.props.breakProp(pr, 14, new THREE.Vector3(c.x - pos.x, 0.5, c.z - pos.z).normalize()));
      });
    });
    ev.on('shot', (hit: any) => {
      if (hit?.enemy) this.hitMarker = 0.12;
      this.hud.onShot();
    });
    ev.on('rankUp', () => this.picker.request());
    ev.on('melee', () => {
      for (const s of this.scarabs) s.onMelee(this.player);
    });
    ev.on('cutin', (title: string, color?: string, expr?: string, opts?: CutInOpts) => this.hud3d.cutIn(title, color, expr, opts));
    ev.on('bossIntro', (b: Boss) => this.hud3d.cutIn(b.name.toUpperCase(), '#ff6a3a', 'smug', { geo: b.rig.geo, eyes: [b.eyes.state.style, b.eyes.state.color], height: b.height / b.scale, flip: true }));
    ev.on('bossPlow', (p: { x: number; z: number }, r: number) => {
      this.world.colliders.query(p.x, p.z, r + 1, (c) => {
        const pr = c.data?.prop as PropInst | undefined;
        if (!pr || pr.broken || !c.data?.destructible) return;
        if (Math.hypot(c.x - p.x, c.z - p.z) < r + c.r) this.props.breakProp(pr, 16, new THREE.Vector3(c.x - p.x, 0.5, c.z - p.z).normalize());
      });
    });
    ev.on('upgradePicked', (id: string) => {
      if (id === 'extraChamber' || id === 'bandolier') this.player.ammo = this.player.maxAmmo;
    });
    ev.on('enemyKilled', (en: Enemy) => {
      this.killMarker = 0.2;
      this.run.kills++;
      this.codexKills[en.def.id] = (this.codexKills[en.def.id] ?? 0) + 1;
      this.run.combo++;
      this.run.comboTimer = 3;
      const bountyMul = this.player.stats.get('bountyGain');
      const b = en.def.bounty * (en.alpha ? 8 : 1) * bountyMul * (1 + this.run.wave * 0.04);
      this.pickups.dropBounty(b, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z });
      const [g0, g1] = en.def.gold;
      const gold = Math.round((g0 + rnd.next() * (g1 - g0)) * (en.alpha ? 5 : 1) * this.player.stats.get('goldGain'));
      if (gold > 0) this.pickups.drop('gold', 1, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z }, Math.min(gold, 12));
      if (rnd.chance(0.012 + (en.alpha ? 0.5 : 0))) this.pickups.drop('heart', 25, en.pos);
      this.ult.chargeKill(this.run.combo, !!en.alpha);
      if (this.run.combo === 10 || this.run.combo === 25 || this.run.combo % 50 === 0) {
        this.hud.toast(`${this.run.combo} STREAK!`, '#ffd36b');
        this.player.express('laugh', 1);
      }
    });
    this.pickups.onCollect = (k, v, at) => {
      if (k === 'gold') this.hud.fly(k === 'gold' ? 'coin' : 'chip', at);
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
      this.ult.chargeStyle(l.score);
      ctx.sfx('trick_spin', null, 0.6);
      if (l.score > 400) ctx.sfx('sting_positive', null, 0.4);
    });
    ev.on('graze', () => {
      this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.02);
      this.ult.chargeGraze();
    });
    ev.on('groundMark', (x: number, z: number, r: number, ch: MarkChannel) => this.marks.splat(x, z, r, ch));
    ev.on('gibs', (x: number, y: number, z: number, n: number, size: number, cols: number[], speed: number, up: number) => this.debris.burst(x, y, z, n, size, cols, speed, up));
    ev.on('plow', (c: any, spd: number) => this.breakProp(c, spd));
    ev.on('propShot', (c: any, p: THREE.Vector3, d: THREE.Vector3) => {
      if (c?.data?.destructible) {
        c.data.hp = (c.data.hp ?? 30) - 18;
        if (c.data.hp <= 0) this.breakProp(c, 8, d);
      }
    });
    ev.on('playerHurt', (a: number) => {
      this.engine.post.u.uDamage.value = Math.min(1, this.engine.post.u.uDamage.value + a / 40);
    });
    ev.on('playerDeath', () => this.onPlayerDeath());
    // bosses and alphas leave a WANTED poster by the body: rip it off for a bonus
    this.bountyRip = new BountyRip({
      ctx: this.ctx, player: this.player, qte: this.qte, addBounty: (v) => this.addBounty(v),
      addGold: (v) => {
        this.run.gold += v;
        this.run.totalGold += v;
      },
    });
    prewarmReaping();
    this.director.onWaveStart = (s) => this.onWaveStart(s);
    this.director.spawnBoss = (wave) => this.spawnBoss(wave);
    this.director.onWaveEnd = (s) => this.onWaveEnd(s);
    this.enemies.qte = this.qte;
    this.director.cam = this.camRig;
    ev.on('oasisKingStart', () => (this.director.paused = true));
    ev.on('oasisKingDefeated', () => (this.director.paused = false));
    this.director.bellBlocked = () => !!this.inter.current || this.shop.active || this.choice.active;
  }

  private spawnBoss(wave: number) {
    const b = makeBoss({ ctx: this.ctx, player: this.player, enemies: this.enemies, qte: this.qte, cam: this.camRig, cloth: this.cloth }, wave);
    const p = this.director.spawnPoint(18, 26) ?? { x: this.player.pos.x + 20, z: this.player.pos.z };
    b.place(p.x, p.z, Math.atan2(this.player.pos.x - p.x, this.player.pos.z - p.z));
    this.adoptBoss(b);
    return b;
  }

  /** a boss joins the run: targetable, music, rewards on defeat, then its fight starts */
  adoptBoss(b: Boss) {
    this.enemies.registerExternal(b);
    this.bosses.push(b);
    (window as any).__music?.setMood('boss');
    b.onDefeated = (bb, escaped) => {
      const at = { x: bb.pos.x, y: bb.pos.y + 1, z: bb.pos.z };
      const k = escaped ? 0.5 : 1;
      this.pickups.dropBounty(bb.bounty * k * this.player.stats.get('bountyGain'), at);
      this.pickups.drop('gold', 1, at, Math.min(40, Math.round((bb.gold * k) / 4)));
      this.pickups.drop('heart', 40, at);
      this.ult.chargeBoss();
      if (!escaped) this.hud.toast(`${bb.name.toUpperCase()} — BOUNTY CLAIMED`, '#ffd36b', `+${Math.round(bb.bounty)} bounty`, true);
      (window as any).__music?.setMood('explore');
      if (!escaped) this.bossNames.push(bb.name);
      this.events.emit('bossDefeated', bb, escaped);
      // beating the Avatar of Khonsu teaches the Neck Slicer (kept forever)
      if (!escaped && bb instanceof KhonsuAvatar && unlock('neck_slicer')) {
        this.engine.tweens.after(3.2, () => {
          this.hud3d.cutIn('MOVE UNLOCKED', '#ffd36b', 'determined');
          this.hud.toast('THE NECK SLICER', '#ffd36b', technique('neck_slicer').how, true);
          this.ctx.sfx('qte_perfect', null, 0.8);
        }, true);
      }
    };
    void b.start();
  }

  /** chests and the dumb scarab live outside the prop batches */
  /** side quests: the rain-frog family, a broken wagon, a traveler who needs an escort */
  private spawnQuests() {
    const pp = this.player.pos;
    const chest = (x: number, z: number, t: any) => this.spawnChest(x, z, t);
    if (!this.frogs) {
      const at = FrogFamily.findSpot(this.ctx, pp);
      if (at) this.frogs = new FrogFamily({ ctx: this.ctx, player: this.player, inter: this.inter, addBounty: (v) => this.addBounty(v), chest }, at);
    }
    if (!this.wagon) {
      const at = WagonRepair.findSpot(this.ctx, pp);
      if (at) this.wagon = new WagonRepair({ ctx: this.ctx, player: this.player, enemies: this.enemies, inter: this.inter, qte: this.qte, cloth: this.cloth, addBounty: (v) => this.addBounty(v), chest }, at);
    }
    if (!this.escort) {
      const route = TravelerEscort.findRoute(this.ctx, this.props, pp, ['tradingPost', 'saloon', 'ranchBarn']);
      if (route)
        this.escort = new TravelerEscort(
          { ctx: this.ctx, player: this.player, enemies: this.enemies, inter: this.inter, choice: this.choice, items: this.items, cloth: this.cloth, addBounty: (v) => this.addBounty(v), card: () => this.picker.request() },
          route.start, route.dest, route.name
        );
    }
  }

  private questList(): HudQuest[] {
    const out: HudQuest[] = [];
    for (const q of [this.frogs, this.wagon, this.escort]) {
      const h = q?.hud();
      if (h?.objective) out.push(questFromObjective(h.objective));
    }
    const m = this.missions.hud();
    if (m?.objective) out.push(questFromObjective(m.objective));
    return out;
  }

  private questHud() {
    if (!this.missions.active)
      for (const q of [this.escort, this.wagon, this.frogs]) {
        const h = q?.hud();
        if (h) return h;
      }
    return this.missions.hud();
  }

  private populateZone(z: ZoneDef) {
    if (this.populated.has(z.index)) return;
    this.populated.add(z.index);
    for (const a of z.anchors) {
      if (a.kind === 'chest') {
        const tier = z.index >= 4 && rnd.chance(0.3) ? 'gold' : z.index >= 2 && rnd.chance(0.4) ? 'silver' : 'wood';
        this.spawnChest(a.x, a.z, tier, a.rot);
      } else if (a.kind === 'dumbScarab' && this.scarabs.length < 3) {
        this.scarabs.push(new DumbScarab(this.ctx, this.enemies, new THREE.Vector3(a.x, 0, a.z)));
      }
    }
    // the meerkat colony (traders + their band) lives in the second zone
    if (!this.colony && z.index === 1) {
      const sp = findClearSpot(this.ctx, z);
      if (sp)
        this.colony = new MeerkatColony({ ctx: this.ctx, player: this.player, inter: this.inter, items: this.items, cam: this.camRig, input: this.engine.input, x: sp.x, z: sp.z, rot: sp.rot });
    }
    // now and then a giant jerboa wants to dance
    if (!this.jerboa && z.index >= 1 && (rnd.chance(0.15) || new URLSearchParams(location.search).has('jerboa'))) {
      const sp = findClearSpot(this.ctx, z, 3);
      if (sp)
        this.jerboa = new JerboaDance({
          ctx: this.ctx, player: this.player, inter: this.inter, qte: this.qte, cam: this.camRig, items: this.items,
          pickups: { drop: (k: any, v: number, at: any, n?: number) => this.pickups?.drop(k, v, at, n) },
          x: sp.x, z: sp.z,
        });
    }
    // ruins: chests, webs, nests and egg sacs; outposts; oasis drinking
    this.ruins?.populateZone(z);
    this.wildlife?.populateZone(z);
    this.treasure?.populateZone(z);
    this.cavePit?.populateZone(z);
    this.oasis?.populateZone(z);
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

  addBounty(v: number) {
    const r = this.run;
    r.bounty += v;
    r.totalBounty += v;
    while (r.bounty >= r.bountyToNext) {
      r.bounty -= r.bountyToNext;
      r.rank++;
      r.bountyToNext = rankCost(r.rank);
      this.onRankUp();
    }
  }

  onRankUp() {
    this.hud.toast(`BOUNTY RANK ${this.run.rank}`, '#9dff3a', 'Upgrade earned', true);
    this.ctx.sfx('rank_up', null, 0.8);
    this.events.emit('rankUp', this.run.rank);
  }

  breakProp(c: any, spd: number, dir?: THREE.Vector3) {
    const pr = c?.data?.prop as PropInst | undefined;
    if (pr) this.props.breakProp(pr, spd, dir);
  }

  private onPropBroken(p: PropInst, spd: number, dir?: THREE.Vector3) {
    const def = p.colliders[0]?.data ?? {};
    const mat = def.material ?? 'wood';
    const pos = new THREE.Vector3().setFromMatrixPosition(p.matrix);
    const center = { x: pos.x, y: pos.y + p.variant.height * 0.5, z: pos.z };
    const d = dir ?? new THREE.Vector3(this.player.board.vel.x, 0.3, this.player.board.vel.z).normalize();
    const vs = p.variant.sm.voxelSize;
    const b = p.variant.sm.model.bounds();
    const pivot: [number, number, number] = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
    this.debris.shatter(p.variant.sm.model, vs, p.matrix, pivot, { chunk: Math.max(2, Math.round(0.09 / vs)), speed: 3 + spd * 0.25, dir: { x: d.x * spd * 0.35, y: 1, z: d.z * spd * 0.35 }, max: 120, up: 2.5 });
    const sfx = mat === 'cactus' ? 'cactus_hit' : mat === 'pottery' ? 'glass_break' : mat === 'bone' ? 'hit_bone' : mat === 'rock' ? 'rock_crumble' : p.kind.includes('arrel') ? 'barrel_break' : 'crate_break';
    this.ctx.sfx(sfx, center, 0.9);
    this.fx.dust(center, 0.8, mat === 'cactus' ? 0xc8d8a0 : 0xe6cf9f, 3);
    if (mat === 'cactus') this.particles.emit({ pos: center, count: 14, spread: 4, up: 3, life: [0.5, 1], size: [0.08, 0.05], sprite: ['twig', 'dot3'], color: [0x6b9e45, 0x8fbf5a, 0xf0e8c0], gravity: 12, ground: true });
    this.ctx.shake(0.1);
    // TNT goes boom
    if (p.kind === 'tntCrate') {
      this.engine.tweens.after(0.12, () => {
        this.fx.explosion(center, 3.6);
        this.ctx.sfx('explosion_big', center, 1);
        this.ctx.shake(0.45);
        this.events.emit('explosion', center, 4.5, 60, 'player');
      });
    }
    // loot from crates/pots/barrels
    if (p.kind === 'crate' || p.kind === 'pot' || p.kind.includes('arrel')) {
      if (rnd.chance(0.55)) this.pickups.drop('gold', 1, center, 1 + Math.floor(rnd.next() * 4));
      if (rnd.chance(0.08)) this.pickups.drop('heart', 15, center);
      if (rnd.chance(0.06)) this.pickups.drop('boost', 1, center);
    }
    this.events.emit('propBroken', p);
  }

  // ------------------------------------------------------------------ waves
  private onWaveStart(s: WaveSpec) {
    this.waveIntroT = 0;
    const label = s.boss === 'major' ? 'THE RECKONING' : s.boss === 'mini' ? 'WANTED' : s.theme ? s.theme.name : `WAVE ${s.n}`;
    // the wave title is cast in voxel letters in the world, not a flat banner
    this.hud3d.cutIn(label, s.boss !== 'none' ? '#ff8a4a' : '#ffd36b', 'determined');
    this.ctx.sfx('wave_start', null, 0.7);
    this.ctx.shake(0.25);
    this.ctx.sfx('quake_rumble', null, 0.4);
    // husks crawl out of the sand around the player as a wave intro
    const n = Math.min(6, 2 + Math.floor(s.n / 6));
    for (let i = 0; i < n; i++) {
      const p = this.director.spawnPoint(16, 30);
      if (p) this.engine.tweens.after(0.4 + i * 0.25, () => this.enemies.spawn('husk', p.x, p.z, { emerge: 'sand' }));
    }
    this.engine.tweens.after(1.2, () => this.director.beginCombat());
  }

  private onWaveEnd(s: WaveSpec) {
    // the storm parts after Sethos falls: ride on to the next sub-area
    if ((s.n === 50 && this.opts.area === 'A') || (s.n === 75 && this.opts.area === 'B')) {
      this.pickups.vacuum();
      void this.travel(this.opts.area === 'A' ? 'B' : 'C', s.n + 1);
      return;
    }
    if (s.n >= 100) {
      this.hud.toast('THE STORM BREAKS', '#ffd36b', 'Serket\'s Reach is free.', true);
      this.engine.tweens.after(3, () => this.endRun(true));
      return;
    }
    this.pickups.vacuum();
    this.hud.toast('WAVE CLEARED', '#9dff3a', `+${10 + s.n * 2} gold`);
    this.run.gold += 10 + s.n * 2;
    this.ctx.sfx('wave_clear', null, 0.7);
    this.engine.tweens.after(1.4, () => {
      if (!this.gameOver && this.player.alive) void this.trailEvents.maybe(s.n);
    });
    // zone transformation after each 5th wave
    if (s.n % 5 === 0) this.engine.tweens.after(1.5, () => this.unlockZone());
    this.engine.tweens.after(s.n % 5 === 0 ? 9 : 3.5, () => {
      if (!this.gameOver) this.director.start(s.n + 1);
    });
  }

  unlockZone() {
    const zone = this.world.unlockNext();
    if (!zone) return;
    this.hud.toast(zone.name.toUpperCase(), '#ffd36b', 'The desert shifts…', true);
    this.ctx.sfx('rock_crumble', null, 1);
    this.ctx.sfx('quake_rumble', null, 0.9);
    this.ctx.shake(0.6);
    this.world.openStormFor(zone);
    const nextZ = this.world.sa.zones[zone.index + 1];
    if (nextZ) this.engine.tweens.after(0.2, () => {
      this.props.buildZone(nextZ);
      this.populateZone(nextZ);
      this.spawnQuests();
    });
    const prev = this.world.activeZone;
    this.engine.tweens.run(4, (k) => this.world.setTransform(zone, k), (t) => t * t * (3 - 2 * t));
    if (zone.corridor) {
      const c = zone.corridor;
      for (let i = 0; i < 10; i++)
        this.engine.tweens.after(i * 0.3, () => {
          const t = rnd.next();
          const x = c.mx + (rnd.next() - 0.5) * 20, z = c.mz + (rnd.next() - 0.5) * 20;
          void t;
          const y = this.world.groundAt(x, z);
          this.fx.explosion({ x, y: y + 2, z }, 2.5);
          this.debris.burst(x, y + 3, z, 18, 0.45, [P.stone1, P.stone2, P.stone3, P.stone0], 7, 6);
          this.fx.dust({ x, y: y + 1, z }, 3, P.stone0, 5);
        });
    }
    this.world.activeZone = zone.index;
    this.engine.tweens.after(40, () => this.world.closeBehind(prev));
  }

  private async onPlayerDeath() {
    const eng = this.engine;
    // the first death plays out in the world (heart, soul, Anubis' arm); the last one gets the plain verdict
    if (this.run.revived) this.hud.toast('YOU DIED', '#ff5a3a', 'The desert keeps your bones…', true);
    this.ctx.sfx('sting_negative', null, 0.8);
    this.ctx.sfx('soul_leave', null, 0.9);
    eng.slowMo(0.15, 6);
    const pu = eng.post.u;
    void eng.tweens.tween(1.4, (k) => (pu.uDesat.value = k * 0.85), Ease.inOutQuad, true);
    if (this.run.revived) return this.endRun(false);
    // once per run: the Weighing of the Heart
    this.run.revived = true;
    await new SoulReaping({ ctx: this.ctx, player: this.player, qte: this.qte, hud: (on) => this.hud.setVisible(on) }).run();
    const trial = new AnubisTrial(eng, this.qte, this.player.rig.geo);
    this.trial = trial;
    eng.post.setSceneCamera(trial.scene, trial.camera);
    (window as any).__music?.setMood('underworld');
    eng.slowMo(1, 50);
    eng.paused = true;
    this.hud.setVisible(false);
    const ok = await trial.run({ kills: this.run.kills, wave: this.run.wave });
    eng.post.setSceneCamera(this.scene, this.camera);
    this.trial = null;
    trial.dispose();
    pu.uDesat.value = 0;
    eng.paused = false;
    this.hud.setVisible(true);
    if (!ok) {
      eng.fadeIn(0.6);
      return this.endRun(false);
    }
    // resurrection: rise out of the sand in a shockwave
    (window as any).__music?.setMood('combat');
    this.player.revive();
    this.player.hp = this.player.maxHp * 0.6;
    this.player.invuln = 4;
    const p = this.player.pos.clone();
    eng.fadeIn(0.5);
    this.events.emit('cutin', 'RETURNED FROM THE DUAT', '#7ff0ff', 'determined');
    this.ctx.sfx('resurrect', p, 1);
    this.ctx.shake(0.8);
    this.fx.explosion({ x: p.x, y: p.y + 0.5, z: p.z }, 6, 'divine');
    this.fx.ring({ x: p.x, y: p.y + 0.3, z: p.z }, 0x7ff0ff, 22, 0.8);
    this.events.emit('groundMark', p.x, p.z, 7, 2);
    this.enemies.inRadius(p, 14, (en) => this.enemies.damage(en, { base: 160, kind: 'magic', source: 'divine', knock: 18, canCrit: false }));
  }

  private async travel(next: 'A' | 'B' | 'C', wave: number) {
    const eng = this.engine;
    const info = SUBAREAS[next];
    this.hud.toast('THE STORM PARTS', '#ffd36b', `On to ${info.name}…`, true);
    this.ctx.sfx('wave_clear', null, 0.8);
    await eng.tweens.wait(2.5, true);
    eng.letterbox(true, 0.5);
    eng.input.enabled = false;
    // crane up into the sandstorm
    const p = this.player.pos.clone();
    const c0 = this.camera.position.clone();
    this.ctx.sfx('storm_loop', null, 1);
    await eng.tweens.tween(2.6, (k) => {
      this.camRig.setCine({ pos: c0.clone().lerp(p.clone().add(new THREE.Vector3(0, 60, 0)), k), look: p.clone().add(new THREE.Vector3(Math.sin(this.camRig.yaw) * 30 * k, 0, Math.cos(this.camRig.yaw) * 30 * k)), fov: 60 + k * 20 });
      if (Math.random() < 0.5) this.fx.dust({ x: p.x + (Math.random() - 0.5) * 30, y: p.y + k * 40, z: p.z + (Math.random() - 0.5) * 30 }, 4, 0xe6c08a, 6);
    }, Ease.inQuad, true);
    await eng.fadeOut(0.9, '#e6c08a');
    const carry = this.caveCarry();
    carry.run.wave = wave - 1;
    eng.input.enabled = true;
    eng.letterbox(false, 0.1);
    void eng.setScene(new RunScene(eng, { ...this.opts, area: next, startWave: wave, intro: false, carry, seed: (this.opts.seed * 17 + 3) % 100000 }), 0.9);
  }

  /** the run as it stands, for travel to another area or down into the cave */
  private caveCarry(): RunCarry {
    return {
      run: { ...this.run },
      history: [...this.upgrades.history],
      items: this.items.slots.map((x) => (x ? { ...x } : null)),
      hpFrac: this.player.hp / this.player.maxHp,
      mods: this.player.stats.mods.filter((m) => !m.source.startsWith('up:') && m.source !== 'gun' && !m.source.startsWith('item:') && !m.source.startsWith('gear:') && !m.source.startsWith('upx:')),
      gear: this.equipment.snapshot(),
      deadHand: this.equipment.deadHandSpent,
      codex: { ...this.codexKills },
      bosses: [...this.bossNames],
      ult: this.ult.variant,
    };
  }

  /** back up from the cave: take what was earned below */
  private caveRestore(c: RunCarry) {
    Object.assign(this.run, c.run);
    for (const id of c.history.slice(this.upgrades.history.length)) this.upgrades.apply(id);
    this.items.slots = c.items.map((s) => (s ? { ...s } : null)) as any;
    this.player.hp = this.player.maxHp * Math.max(0.05, c.hpFrac);
    this.player.ammo = this.player.maxAmmo;
    this.codexKills = { ...c.codex };
    this.bossNames = [...c.bosses];
    this.equipment.restore((c.gear ?? []) as any);
    this.equipment.deadHandSpent = !!c.deadHand;
  }

  private pausedByUser = false;
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
      { label: 'GIVE UP THE HUNT', fn: () => {
        this.setPaused(false);
        this.endRun(false);
      } },
      { label: 'MAIN MENU', fn: () => {
        this.setPaused(false);
        const eng = this.engine;
        nav.menu();
      } },
    ]);
  }

  private endRun(won: boolean) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.events.emit('runOver', this.run, won);
    const eng = this.engine;
    const p = this.player.pos;
    const res = {
      run: { ...this.run },
      won,
      sa: this.world.sa,
      reached: this.world.activeZone,
      trail: [...this.trail, { x: p.x, z: p.z }],
      deathAt: won ? null : { x: p.x, z: p.z },
      bosses: this.bossNames,
      heightAt: this.world.groundAt,
      banked: awardRun(this.run, this.codexKills),
      hero: this.player.rig.geo.spec,
    };
    // a true death: the killing blow in slow motion, the sky wheels through the days, he wakes at home
    if (!won && !this.player.alive) {
      eng.tweens.after(1.4, () => void eng.setScene(new DeathCine(eng, deathCineFromRun(this, res)), 0.35, '#fff3dc'), true);
      return;
    }
    eng.tweens.after(2.6, () => {
      void eng.setScene(
        new ResultsScene(eng, res, () => void eng.setScene(new RunScene(eng, { ...this.opts, seed: (this.opts.seed * 31 + 7) % 100000, startWave: 1 }), 0.8)),
        1.0
      );
    }, true);
  }

  // ------------------------------------------------------------------ update
  update(dt: number, rdt: number) {
    if (!this.ready) return;
    // below ground: the cave stage runs, the desert stays frozen as it was
    if (this.cavePit?.stage) {
      this.windLoop?.setVolume(0, 0.4);
      this.slideLoop?.setVolume(0, 0.1);
      this.stormLoop?.setVolume(0, 0.4);
      this.cavePit.stageUpdate(dt, rdt);
      return;
    }
    // codex discoveries wait until cutscenes, staged encounters and the rank-up are over
    this.codexRun?.update(rdt, this.introOn || this.picker.cinematic || Cinema.busy() || cineFlags.choice);
    const e = this.engine;
    this.run.time += dt;
    // pause toggle (simple until poster scene)
    this.touch?.update(!!this.trial || this.picker.active || this.choice.active || this.shop.active || this.ledger.open || this.pausedByUser || !!this.colony?.modal || !!this.jerboa?.modal || this.gearLoot.active || !!this.treasure?.modal);
    if (this.trial) {
      this.qte.update(rdt);
      this.trial.update(rdt);
      return;
    }
    if (this.ledger.open && (e.input.hit('stats') || e.input.wasPressed('Escape'))) {
      this.ledger.toggle(false);
      e.paused = false;
      e.input.setWantLock(true);
    } else if (!this.ledger.open && !this.choice.active && !this.shop.active && !this.picker.active && e.input.hit('stats')) {
      this.ledger.toggle(true);
      e.paused = true;
      e.input.setWantLock(false);
      e.audio.play('book_open', { volume: 0.6 });
    }
    const modal = this.choice.active || this.shop.active || this.ledger.open || !!this.colony?.modal || !!this.jerboa?.modal || this.gearLoot.active || !!this.treasure?.modal;
    if (!modal && !this.picker.active && e.input.hit('pause')) this.setPaused(!this.pausedByUser);
    this.qte.update(rdt);
    this.picker.update(rdt);
    this.gearLoot.update(dt, rdt);
    this.treasure?.update(dt, rdt);
    this.choice.update(rdt);
    this.shop.update(rdt);
    this.colony?.update(dt, rdt);
    this.jerboa?.update(dt, rdt);
    if (this.jerboa?.done) {
      this.jerboa.dispose();
      this.jerboa = null;
    }
    this.hud.suppressHint = this.picker.active || this.ult.active || modal || this.pausedByUser;
    // cinematic moments own the screen: no HUD over the rank-up, the turtle-house visit or a gear reveal
    const cineHud = this.picker.cinematic || this.shop.active || this.gearLoot.active || !!this.treasure?.modal;
    if (cineHud !== this.cineHudHidden) {
      this.cineHudHidden = cineHud;
      this.hud.setVisible(!cineHud);
    }
    if (modal) {
      this.cloth.update(rdt * 0.2, e.realTime);
      this.camRig.update(rdt, this.player.pos, 0, false, 0);
      this.updateHud(rdt);
      return;
    }
    // the upgrade cards own the screen: no hunter, buddy or HUD in front of them
    if (this.picker.active !== this.pickerShown) {
      // the rank-up cinematic frames the hunter under an arch of cards: Pinch steps aside
      this.pickerShown = this.picker.active;
      this.skills.pinchRoot.visible = !this.pickerShown;
    }
    if (this.picker.active) {
      this.cloth.update(rdt * 0.2, e.realTime);
      this.updateHud(rdt);
      return;
    }
    this.faces.begin();
    if (e.input.hit('ultimate') && this.run.ultCharge >= 1 && this.player.alive && !this.ult.active) this.ult.trigger();
    this.slicer.update(rdt);
    this.player.update(dt);
    if (!e.paused) this.slicer.post(rdt);
    this.skills.update(dt);
    if (this.tutorial) {
      this.tutorial.update(dt);
      if (this.tutorial.done) {
        this.tutorial.dispose();
        this.tutorial = null;
        this.director.start(this.opts.startWave ?? 1);
      }
    }
    this.items.update(dt, e.input);
    this.upFx.update(dt);
    this.upFx2.update(dt);
    this.equipment.update(dt);
    this.garments.update(this.world.sa.wind.x * 3, this.world.sa.wind.z * 3, this.player.board.vel);
    this.enemies.update(dt, this.run.time);
    this.pickups.update(dt);
    this.director.update(dt);
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 1.5;
      this.trail.push({ x: this.player.pos.x, z: this.player.pos.z });
    }
    this.inter.update(e.input);
    this.frogs?.update(dt);
    if (this.frogs?.finished) {
      this.frogs.dispose();
      this.frogs = null;
    }
    this.escort?.update(dt);
    if (this.escort?.finished) {
      this.escort.dispose();
      this.escort = null;
    }
    this.wagon?.update(dt);
    if (this.wagon?.finished) {
      this.wagon.dispose();
      this.wagon = null;
    }
    this.missions.update(dt);
    this.ruins?.update(dt);
    this.wildlife?.update(dt);
    this.cavePit?.update(dt);
    this.oasis?.update(dt);
    for (const s of this.scarabs) s.update(dt, this.player);
    for (let i = this.bosses.length - 1; i >= 0; i--) {
      const b = this.bosses[i];
      b.update(dt);
      if (!b.alive && !b.root.parent) this.bosses.splice(i, 1);
    }
    const pp = this.player.pos;
    this.world.update(dt, pp, e.realTime, this.fx);
    this.props.update(dt, pp, this.world.sa.wind, this.fx);
    // storm damage & mood
    const sdf = this.world.storm.sdf(pp.x, pp.z);
    const near = (this.world.storm as any).near ?? clamp(1 - sdf / 18, 0, 1);
    if (sdf < 0 && this.player.alive) {
      this.player.applyDamage(this.player.maxHp * 0.09 * dt, 'storm', true);
      const inw = this.world.storm.inward(pp.x, pp.z, { x: 0, z: 0 });
      this.player.board.vel.x += inw.x * 20 * dt;
      this.player.board.vel.z += inw.z * 20 * dt;
      if (rnd.chance(dt * 2)) this.hud.toast('THE STORM BITES', '#ffb070');
    }
    const devil = this.world.storm.devilDamageAt(pp.x, pp.z);
    if (devil > 0) this.player.applyDamage(devil * dt, 'storm', true);
    this.stormLoop?.setVolume(near * 0.9, 0.3);
    this.windLoop?.setVolume(0.45 + near * 0.3, 0.3);
    // board slide audio
    const sp = this.player.speed;
    this.slideLoop?.setVolume(this.player.board.grounded ? clamp(sp / 13, 0, 1) * 0.55 : 0, 0.08);
    this.slideLoop?.setRate(0.8 + clamp(sp / 40, 0, 0.6));
    // board tracks in sand
    if (this.player.board.grounded && sp > 2 && this.player.board.lastSurface.kind !== 'water') {
      const carveW = 0.4 + Math.min(0.22, Math.abs(this.player.board.lean) * 0.25) + (this.player.board.drifting ? 0.18 : 0);
      if (this.hasTrack) this.marks.segment(this.lastTrack.x, this.lastTrack.z, pp.x, pp.z, carveW, 0);
      this.lastTrack.copy(pp);
      this.hasTrack = true;
    } else this.hasTrack = false;
    this.emitSand(dt, sp);
    // fx
    this.particles.update(dt, this.world.env.fog);
    this.debris.update(dt);
    this.fx.update(dt);
    this.cloth.update(dt, e.realTime);
    this.marks.flush(dt);
    this.world.terrain.setMarkClock(this.marks.clock);
    // camera
    this.camRig.update(rdt, pp, sp, !this.player.board.grounded, this.player.board.lean);
    // post moods
    const pu = e.post.u;
    pu.uDamage.value = Math.max(0, pu.uDamage.value - rdt * 1.5);
    pu.uPoison.value = this.player.status.has('poison') ? 0.6 : Math.max(0, pu.uPoison.value - rdt);
    pu.uRadial.value = clamp((sp - 11) / 10, 0, 0.6) + (this.player.board.boosting ? 0.25 : 0);
    pu.uVignette.value = 0.32 + near * 0.35;
    // combo decay
    this.run.comboTimer -= dt;
    if (this.run.comboTimer <= 0) this.run.combo = 0;
    this.hitMarker = Math.max(0, this.hitMarker - rdt);
    this.killMarker = Math.max(0, this.killMarker - rdt);
    this.faces.end(this.world.env.fog);
    this.updateHud(rdt);
  }

  /** pixel-art sand everywhere: the board's rooster tail, grains skittering on the wind, dust motes */
  private emitSand(dt: number, sp: number) {
    const b = this.player.board;
    const p = this.player.pos;
    const pa = this.particles;
    const SAND = [0xf0d29a, 0xe3bd80, 0xd6a968, 0xfbe6b8];
    if (b.grounded && sp > 2.5 && b.lastSurface.kind !== 'water') {
      const f = b.forward;
      const side = Math.sign(b.lean || 1);
      const carve = Math.min(1, Math.abs(b.lean) * 1.6) + (b.drifting ? 1 : 0) + (b.boosting ? 0.6 : 0);
      const rate = Math.min(90, sp * 2.2 + carve * 40);
      const n = Math.floor(rate * dt) + (Math.random() < (rate * dt) % 1 ? 1 : 0);
      if (n > 0) {
        const back = { x: p.x - f.x * 0.55, y: p.y + 0.05, z: p.z - f.z * 0.55 };
        pa.emit({ pos: back, count: n, spread: 0.25, vel: { x: -f.x * sp * 0.22 + f.z * side * carve * 2.5, y: 1.6 + carve * 1.6 + sp * 0.04, z: -f.z * sp * 0.22 - f.x * side * carve * 2.5 }, jitter: 1.2 + carve, gravity: 9, drag: 1.2, life: [0.35, 0.8], size: [0.05, 0.11], sprite: ['dot3', 'dot3', 'puff0'], color: SAND, ground: true });
        if (carve > 0.8 && Math.random() < dt * 14) pa.emit({ pos: back, count: 2, spread: 0.3, up: 0.8, life: [0.5, 0.9], size: [0.35, 0.6], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.55, drag: 2 });
      }
    }
    // grains skittering along the ground with the wind
    const w = this.world.sa.wind;
    const wl = Math.hypot(w.x, w.z) || 1;
    if (Math.random() < dt * 22) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 16;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      pa.emit({ pos: { x, y: this.world.groundAt(x, z) + 0.06, z }, count: 3, spread: 0.6, vel: { x: (w.x / wl) * 4.5, y: 0.2, z: (w.z / wl) * 4.5 }, jitter: 0.6, gravity: 1.5, drag: 0.3, life: [0.6, 1.3], size: [0.04, 0.07], sprite: 'dot3', color: SAND, ground: true });
    }
    // a dust curtain hangs behind the rider and drifts off with the wind
    if (b.grounded && sp > 9 && b.lastSurface.kind !== 'water' && Math.random() < dt * (sp * 0.45)) {
      const f = b.forward;
      pa.emit({ pos: { x: p.x - f.x * 1.2, y: p.y + 0.35, z: p.z - f.z * 1.2 }, count: 1, vel: { x: (w.x / wl) * 1.6 - f.x * 1.5, y: 0.5, z: (w.z / wl) * 1.6 - f.z * 1.5 }, spread: 0.5, jitter: 0.4, gravity: -0.15, drag: 0.9, life: [1.6, 2.8], size: [0.7, 2.2], sprite: ['puff0', 'puff1'], color: [0xe9d3a4, 0xdcc08c], alpha: 0.32 });
    }
    // spindrift: sand streaming off nearby crests, downwind
    if (Math.random() < dt * 9) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 30;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const ux = w.x / wl, uz = w.z / wl;
      const h = this.world.groundSmooth(x, z);
      const crest = h - Math.max(this.world.groundSmooth(x - ux * 2.5, z - uz * 2.5), this.world.groundSmooth(x + ux * 2.5, z + uz * 2.5));
      if (crest > 0.12) {
        const k = Math.min(1, crest / 0.8);
        pa.emit({ pos: { x, y: h + 0.08, z }, count: 4 + Math.round(k * 8), vel: { x: ux * (5 + k * 4), y: 0.9 + k * 1.2, z: uz * (5 + k * 4) }, spread: 0.9, jitter: 1.6, gravity: 2.2, drag: 0.5, life: [0.7, 1.5], size: [0.04, 0.08], sprite: 'dot3', color: SAND });
        if (Math.random() < 0.5) pa.emit({ pos: { x: x + ux, y: h + 0.4, z: z + uz }, count: 1, vel: { x: ux * 3, y: 0.4, z: uz * 3 }, spread: 0.4, life: [1.0, 1.8], size: [0.6, 1.4], sprite: ['puff0', 'puff1'], color: 0xeedbb0, alpha: 0.28, drag: 0.8 });
      }
    }
    // gusts: a sheet of skimming sand sweeps across the dunes every few seconds
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 3 + Math.random() * 5;
      const ux = w.x / wl, uz = w.z / wl;
      const up = 14 + Math.random() * 10;
      for (let i = 0; i < 26; i++) {
        const l = (Math.random() * 2 - 1) * 26;
        const x = p.x - ux * up - uz * l, z = p.z - uz * up + ux * l;
        pa.emit({ pos: { x, y: this.world.groundAt(x, z) + 0.05 + Math.random() * 0.25, z }, count: 3, vel: { x: ux * (8 + Math.random() * 4), y: 0.25, z: uz * (8 + Math.random() * 4) }, spread: 0.8, jitter: 1.2, gravity: 1.2, drag: 0.25, life: [1.6, 3.2], size: [0.04, 0.07], sprite: 'dot3', color: SAND, ground: true, delay: Math.random() * 0.6 });
      }
    }
    // dust motes hanging in the sun
    if (Math.random() < dt * 5) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 9;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      pa.emit({ pos: { x, y: this.world.groundAt(x, z) + 0.6 + Math.random() * 2.4, z }, count: 1, vel: { x: (w.x / wl) * 0.5, y: 0.08, z: (w.z / wl) * 0.5 }, jitter: 0.15, gravity: -0.02, drag: 0.1, life: [2.5, 4], size: [0.03, 0.05], sprite: 'dot3', color: 0xfff2d0, alpha: 0.8 });
    }
  }

  postRender(renderer: THREE.WebGLRenderer) {
    if (this.cavePit?.stage) {
      this.cavePit.stage.postRender(renderer);
      return;
    }
    if (!this.ready || this.trial) return;
    this.hud3d.update(this.lastRdt);
    this.gearHud.update(this.lastRdt);
    this.hud3d.render(renderer);
  }

  private updateHud(rdt: number) {
    this.lastRdt = rdt;
    const p = this.player;
    const d = this.director;
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
      weapon: this.player.weapons?.hud(),
      treasure: this.treasure?.waypoints() ?? [],
      gold: this.run.gold,
      wave: d.wave,
      waveTime: d.timeLeft,
      waveLabel: d.hudLabel,
      intermission: d.inBreak ? d.breakLeft : undefined,
      intermissionTotal: d.breakTotal,
      bell: d.bell,
      heroWorld: p.center(this.hudHero),
      quests: this.questList(),
      boss: (() => {
        const b = this.bosses.find((x) => x.alive && !x.escaped);
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
      status: (['poison', 'bleed', 'burn', 'curse', 'slow'] as StatusId[]).map((id) => ({ id, stacks: p.status.stacks(id) })),
      hitMarker: this.hitMarker,
      killMarker: this.killMarker,
      spreadPx: p.spreadPx(window.innerHeight / this.hud.scale),
      reticle: p.reticle,
      combo: this.run.combo,
      locked: this.engine.input.lookActive,
      aiming: p.aiming,
      zone: this.world.zone.name,
      prompt: this.picker.active || this.choice.active || this.shop.active || this.colony?.modal || this.jerboa?.modal ? null : this.inter.prompt(),
      ...this.questHud(),
    };
    this.hud.update(rdt, st);
  }
}
