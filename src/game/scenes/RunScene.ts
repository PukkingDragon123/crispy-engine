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
import { Hud, HudState } from '../ui/Hud';
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

export interface RunOptions {
  area: 'A' | 'B' | 'C';
  seed: number;
  startWave?: number;
  look?: { hat: string; outfit: string; board: string };
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
  run: RunState = { wave: 0, bounty: 0, rank: 1, bountyToNext: 12, gold: 0, kills: 0, totalBounty: 0, totalGold: 0, time: 0, ultCharge: 0, revived: false, combo: 0, comboTimer: 0, style: 0 };
  private hitMarker = 0;
  private killMarker = 0;
  private windLoop: any = null;
  private slideLoop: any = null;
  private stormLoop: any = null;
  private lastTrack = new THREE.Vector3();
  private hasTrack = false;
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
    this.cloth = new ClothRenderer();
    this.scene.add(this.cloth.mesh);
    this.particles.groundAt = this.world.groundAt;
    this.debris.groundAt = this.world.groundAt;
    this.camRig = new CameraRig(this.camera, this.world.groundAt);
    this.hud = new Hud(e.overlay);

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
    };

    // player visuals
    const look = this.opts.look ?? { hat: 'stetson', outfit: 'duster', board: 'driftwood' };
    const vis: PlayerVisuals = {
      rig: resolveRig([`cowboy_${look.hat}_${look.outfit}`, 'cowboy_stetson_duster'], () => placeholderHumanoid()),
      gun: resolveRig(['revolver_standard', 'revolver'], placeholderRevolver),
      board: resolveStatic([`board_${look.board}`, 'board_driftwood'], placeholderBoard),
    };
    this.player = new Player(this.ctx, vis, this.camRig, e.input);
    this.enemies = new Enemies(this.ctx, this.player as any);
    this.ctx.enemies = this.enemies;
    this.qte = new Qte(e.overlay, e.input, e.audio);
    this.skills = new Skills(this.ctx, this.player, e.input);
    this.items = new Inventory(this.ctx, this.player);
    this.items.add('bandage', 2);
    this.items.add('dynamite', 1);
    this.ult = new Ultimate(this.ctx, this.player, this.qte, this.camRig);
    this.upgrades = new UpgradeManager(this.player.stats);
    this.upFx = new UpgradeEffects(this.ctx, this.upgrades, this.player, this.skills);
    this.picker = new CardPicker(this.ctx, this.upgrades, e.input, () => this.player.pos);
    this.garments = new Garments(this.player.rig, this.cloth, this.world.groundAt);
    const v3 = new THREE.Vector3();
    this.hud.project = (p) => {
      v3.set(p.x, p.y, p.z).project(this.camera);
      return { x: (v3.x * 0.5 + 0.5) * e.width, y: (-v3.y * 0.5 + 0.5) * e.height, visible: v3.z < 1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2 };
    };
    this.pickups = new Pickups(this.ctx, () => this.player);
    this.director = new WaveDirector(this.ctx, this.enemies, () => this.player);
    this.wireEvents();

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
    this.director.start(this.opts.startWave ?? 1);
  }

  exit() {
    this.windLoop?.stop(0.5);
    this.slideLoop?.stop(0.5);
    this.stormLoop?.stop(0.5);
    this.hud.canvas.remove();
    this.qte.dispose();
    this.engine.input.setWantLock(false);
    this.events.clear();
  }

  // ------------------------------------------------------------------ events
  private wireEvents() {
    const ev = this.events;
    const ctx = this.ctx;
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
    ev.on('upgradePicked', (id: string) => {
      if (id === 'extraChamber' || id === 'bandolier') this.player.ammo = this.player.maxAmmo;
    });
    ev.on('enemyKilled', (en: Enemy) => {
      this.killMarker = 0.2;
      this.run.kills++;
      this.run.combo++;
      this.run.comboTimer = 3;
      const bountyMul = this.player.stats.get('bountyGain');
      const b = en.def.bounty * (en.alpha ? 8 : 1) * bountyMul * (1 + this.run.wave * 0.04);
      this.pickups.dropBounty(b, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z });
      const [g0, g1] = en.def.gold;
      const gold = Math.round((g0 + rnd.next() * (g1 - g0)) * (en.alpha ? 5 : 1) * this.player.stats.get('goldGain'));
      if (gold > 0) this.pickups.drop('gold', 1, { x: en.pos.x, y: en.pos.y + 0.5, z: en.pos.z }, Math.min(gold, 12));
      if (rnd.chance(0.012 + (en.alpha ? 0.5 : 0))) this.pickups.drop('heart', 25, en.pos);
      this.run.ultCharge = Math.min(1, this.run.ultCharge + 0.006 * this.player.stats.get('ultCharge') * (en.alpha ? 6 : 1));
      if (this.run.combo === 10 || this.run.combo === 25 || this.run.combo % 50 === 0) {
        this.hud.toast(`${this.run.combo} STREAK!`, '#ffd36b');
        this.player.express('laugh', 1);
      }
    });
    this.pickups.onCollect = (k, v, at) => {
      if (k === 'gold' || k === 'bounty' || k === 'bountyBig') this.hud.fly(k === 'gold' ? 'coin' : 'chip', at);
      if (k === 'bounty' || k === 'bountyBig') this.addBounty(v);
      else if (k === 'gold') {
        this.run.gold += v;
        this.run.totalGold += v;
      } else if (k === 'heart') this.player.heal(v);
      else if (k === 'boost') this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.3);
    };
    ev.on('trick', (l: any) => {
      this.hud.toast(l.trickName || 'TRICK', '#6fe3cf', `+${l.score} style`);
      this.run.style += l.score;
      this.run.ultCharge = Math.min(1, this.run.ultCharge + l.score / 6000);
      ctx.sfx('trick_spin', null, 0.6);
      if (l.score > 400) ctx.sfx('sting_positive', null, 0.4);
    });
    ev.on('graze', () => {
      this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.02);
      this.run.ultCharge = Math.min(1, this.run.ultCharge + 0.002);
    });
    ev.on('groundMark', (x: number, z: number, r: number, ch: MarkChannel) => this.marks.splat(x, z, r, ch));
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
    this.director.onWaveStart = (s) => this.onWaveStart(s);
    this.director.onWaveEnd = (s) => this.onWaveEnd(s);
  }

  addBounty(v: number) {
    const r = this.run;
    r.bounty += v;
    r.totalBounty += v;
    while (r.bounty >= r.bountyToNext) {
      r.bounty -= r.bountyToNext;
      r.rank++;
      r.bountyToNext = Math.round(12 + r.rank * 9 + Math.pow(r.rank, 1.6) * 2);
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
    this.hud.toast(label, s.boss !== 'none' ? '#ff8a4a' : '#fff3d6', s.boss === 'none' ? this.world.zone.name : `Wave ${s.n}`, true);
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
    this.pickups.vacuum();
    this.hud.toast('WAVE CLEARED', '#9dff3a', `+${10 + s.n * 2} gold`);
    this.run.gold += 10 + s.n * 2;
    this.ctx.sfx('wave_clear', null, 0.7);
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
    if (nextZ) this.engine.tweens.after(0.2, () => this.props.buildZone(nextZ));
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

  private onPlayerDeath() {
    this.gameOver = true;
    this.hud.toast('YOU DIED', '#ff5a3a', 'The desert keeps your bones…', true);
    this.ctx.sfx('sting_negative', null, 0.8);
    this.engine.slowMo(0.2, 3);
    this.events.emit('runOver', this.run);
  }

  // ------------------------------------------------------------------ update
  update(dt: number, rdt: number) {
    if (!this.ready) return;
    const e = this.engine;
    this.run.time += dt;
    // pause toggle (simple until poster scene)
    if (e.input.hit('pause')) {
      e.paused = !e.paused;
      e.input.setWantLock(!e.paused);
      e.audio.setMuffle(e.paused ? 0.6 : 0);
      this.hud.toast(e.paused ? 'PAUSED' : 'RESUMED', '#fff3d6');
    }
    this.qte.update(rdt);
    this.picker.update(rdt);
    this.hud.suppressHint = this.picker.active || this.ult.active;
    if (this.picker.active) {
      this.cloth.update(rdt * 0.2, e.realTime);
      this.updateHud(rdt);
      return;
    }
    if (e.input.hit('ultimate') && this.run.ultCharge >= 1 && this.player.alive && !this.ult.active) this.ult.trigger();
    this.player.update(dt);
    this.skills.update(dt);
    this.items.update(dt, e.input);
    this.upFx.update(dt);
    this.garments.update(this.world.sa.wind.x * 3, this.world.sa.wind.z * 3, this.player.board.vel);
    this.enemies.update(dt, this.run.time);
    this.pickups.update(dt);
    this.director.update(dt);
    const pp = this.player.pos;
    this.world.update(dt, pp, e.realTime, this.fx);
    this.props.update(dt, pp, this.world.sa.wind, this.fx);
    // storm damage & mood
    const sdf = this.world.storm.sdf(pp.x, pp.z);
    const near = clamp(1 - sdf / 18, 0, 1);
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
    this.slideLoop?.setVolume(this.player.board.grounded ? clamp(sp / 30, 0, 1) * 0.55 : 0, 0.08);
    this.slideLoop?.setRate(0.8 + clamp(sp / 40, 0, 0.6));
    // board tracks in sand
    if (this.player.board.grounded && sp > 2 && this.player.board.lastSurface.kind !== 'water') {
      if (this.hasTrack) this.marks.segment(this.lastTrack.x, this.lastTrack.z, pp.x, pp.z, 0.42, 0);
      this.lastTrack.copy(pp);
      this.hasTrack = true;
    } else this.hasTrack = false;
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
    pu.uRadial.value = clamp((sp - 28) / 30, 0, 0.6) + (this.player.board.boosting ? 0.25 : 0);
    pu.uVignette.value = 0.32 + near * 0.35;
    // combo decay
    this.run.comboTimer -= dt;
    if (this.run.comboTimer <= 0) this.run.combo = 0;
    this.hitMarker = Math.max(0, this.hitMarker - rdt);
    this.killMarker = Math.max(0, this.killMarker - rdt);
    this.updateHud(rdt);
  }

  private updateHud(rdt: number) {
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
      gold: this.run.gold,
      wave: d.wave,
      waveTime: d.timeLeft,
      waveLabel: `WAVE ${d.wave}`,
      boss: null,
      ult: this.run.ultCharge,
      skills: (() => {
        const cd = this.skills.cooldowns();
        return [
          { key: 'Q', icon: 'twig', cd: Math.max(0, p.grappleCd), max: 2.2 },
          { key: 'E', icon: 'scorp', cd: cd.scorp, max: this.skills.constants.scorpCd },
          { key: 'C', icon: 'locust', cd: cd.swarm, max: this.skills.constants.swarmCd },
          { key: 'G', icon: 'dung', cd: cd.bomb, max: this.skills.constants.bombRecharge, charges: cd.bombCharges },
          { key: 'F', icon: 'bone', cd: Math.max(0, p.meleeCd), max: 0.55 },
        ];
      })(),
      items: this.items.slots.map((sl, i) => ({ key: String(i + 1), icon: sl ? ITEMS[sl.id].icon : '', count: sl?.count ?? 0 })),
      status: (['poison', 'bleed', 'burn', 'curse', 'slow'] as StatusId[]).map((id) => ({ id, stacks: p.status.stacks(id) })),
      hitMarker: this.hitMarker,
      killMarker: this.killMarker,
      combo: this.run.combo,
      locked: this.engine.input.locked,
      aiming: p.aiming,
      zone: this.world.zone.name,
    };
    this.hud.update(rdt, st);
  }
}
