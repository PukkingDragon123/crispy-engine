// The back-yard range: through the right-hand door, a weathered cedar fence
// with bottles and cans along its top plank, two kegs with one more each. E
// at the door and Sundown steps out, draws the real six-shooter (your bench
// loadout), and the camera drops over his right shoulder. Thirty seconds on
// the clock: click to fire (fan the hammer by clicking fast), R or an empty
// click to reload. Bottles burst (the neck spins off, the broken base stays on
// the plank); cans jump, and a can hit again in the air is a juggle bonus.
// Clear them all for a time bonus; accuracy pays too. Best score is kept.
import * as THREE from 'three';
import { RigInstance, buildRigGeo, RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as CH from '../../models/characters';
import * as WS from '../../models/props/workshop';
import * as HX from '../../models/props/hideout';
import * as PM from '../../models/props';
type SMish = { model: VoxelModel; voxelSize: number };
import { Fx } from '../../fx/Fx';
import { Debris } from '../../fx/Debris';
import { loadSave } from '../../meta/Save';
import { damp } from '../../../engine/math/rand';
import { BuildKit, HubHost, HubStation, HeroBubble, HUD_CSS, hubStats, saveHubStats, safe, geoOf, meshOf, reach, joint, sstep, clamp01 } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

const IN = HX.CABIN_IN;
const FENCE = new THREE.Vector3(9.7, 0, 1.45);
const STAND = new THREE.Vector2(6.35, 1.62);
const GROUND = -0.02;
const ROUND = 30;

interface Target {
  kind: 'bottle' | 'can';
  v: number;
  home: THREE.Vector3;
  full: THREE.Mesh;
  base: THREE.Mesh | null;
  neck: THREE.Mesh | null;
  mid: VoxelModel | null;
  vs: number;
  h: number;
  r: number;
  glass: number;
  state: 'up' | 'air' | 'down' | 'broken';
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  neckVel: THREE.Vector3;
  neckSpin: THREE.Vector3;
  pop: number;
  hits: number;
}

export class ShootingRange implements Mode {
  id = 'range';
  done = false;
  raw = true;
  private st: HubStation | null = null;
  private targets: Target[] = [];
  private fx: Fx;
  private debris = new Debris();
  private flash: THREE.PointLight | null = null;
  private flashK = 0;
  private gun: RigInstance | null = null;
  private gunHold = new THREE.Group();
  private phase: 'count' | 'live' | 'end' = 'count';
  private t = 0;
  private left = ROUND;
  private score = 0;
  private shots = 0;
  private hits = 0;
  private ammo = 6;
  private reload = -1;
  private kick = 0;
  private lastShot = -9;
  private fanned = 0;
  private cyl = 0;
  private cylT = 0;
  private aimK = 0;
  private aim = new THREE.Vector3();
  private shake = 0;
  private doorK = 0;
  private hud = document.createElement('div');
  private big = document.createElement('div');
  private cross = document.createElement('div');
  private ray = new THREE.Raycaster();
  private v = new THREE.Vector3();
  private best = false;
  private rotor: THREE.Mesh | null = null;

  constructor(private h: HubHost, private bubble: HeroBubble) {
    this.fx = new Fx(h.particles, new THREE.Scene()); // its pooled lights stay out of the hub (one muzzle light of our own)
    this.hud.style.cssText = HUD_CSS + ';left:50%;top:18px;transform:translateX(-50%);font-size:24px;display:none';
    this.big.style.cssText = HUD_CSS + ';left:50%;top:30%;transform:translate(-50%,-50%);font-size:64px;text-align:center;display:none;color:#ffe2a0';
    this.cross.style.cssText = 'position:absolute;z-index:9;pointer-events:none;display:none;width:0;height:0';
    // the run's crosshair: four pixel ticks with a dark drop
    for (const [dx, dy, w, hh] of [[-11, 0, 6, 2], [5, 0, 6, 2], [0, -11, 2, 6], [0, 5, 2, 6], [-1, -1, 2, 2]]) {
      const t = document.createElement('div');
      t.style.cssText = `position:absolute;left:${dx}px;top:${dy}px;width:${w}px;height:${hh}px;background:#fff3d6;box-shadow:1px 1px 0 rgba(20,10,4,.75)`;
      this.cross.appendChild(t);
    }
    h.engine.overlay.append(this.hud, this.big, this.cross);
  }

  build(k: BuildKit) {
    const s = this.h.scene;
    // the yard: ground, the fence, two kegs, a cactus, grass
    const yg = geoOf(safe(() => WS.yardGround(10, 13)), WS.ORIGIN_PIVOT);
    if (yg) {
      const m = meshOf(yg, sharedVoxelMaterial, false);
      m.position.set(HX.CABIN.W / 2 - 0.02, GROUND - 1 / 16, 0.4);
      s.add(m);
    }
    const fs = safe(() => WS.yardFence());
    const fence = k.put(fs, FENCE.x, FENCE.z, -Math.PI / 2, GROUND, 1, false);
    const slots: THREE.Vector3[] = [];
    if (fence && fs) {
      fence.updateMatrixWorld(true);
      for (const p of fs.meta.slots) slots.push(new THREE.Vector3(...p).applyMatrix4(fence.matrixWorld));
    }
    for (const [x, z, sd] of [[7.9, -0.25, 5], [8.25, 3.3, 6]] as const) {
      const kg = k.put(safe(() => HX.kegCraft(sd)), x, z, sd, GROUND, 0.9, false);
      if (kg) slots.push(new THREE.Vector3(x, new THREE.Box3().setFromObject(kg).max.y, z));
    }
    const P: any = PM;
    k.put(safe(() => P.cactus?.(17, 'saguaro')), 12.6, 4.6, 0.6, GROUND, 0.8, false);
    k.put(safe(() => P.cactus?.(23, 'organ')), 13.4, -2.6, 2.1, GROUND, 0.7, false);
    // the rest of the yard: an outhouse with a moon cut in the door, a trough, a skull on a post, a wheel against
    // the fence, and the windmill turning out past it all
    k.put(safe(() => P.outhouse?.(3)), 7.6, 6.0, -Math.PI / 2 - 0.25, GROUND, 1, false);
    k.put(safe(() => P.trough?.(2)), 6.9, -1.9, 0.2, GROUND, 1, false);
    k.put(safe(() => P.cattleSkullPost?.(4)), 11.6, -0.6, -1.3, GROUND, 1, false);
    const wh = k.put(safe(() => P.wagonWheel?.(5)), FENCE.x + 0.12, FENCE.z + 1.95, -Math.PI / 2, GROUND, 1, false);
    if (wh) wh.rotation.z = 0.25;
    const wm = safe(() => P.windmill?.(1)) as (SMish & { rotor: VoxelModel; rotorPivot: [number, number, number]; rotorAt: [number, number, number] }) | null;
    const tower = k.put(wm, 17.5, -3.2, -Math.PI / 2 + 0.3, GROUND, 1, false);
    if (wm && tower) {
      const rg = buildVoxelGeometry(wm.rotor, { voxelSize: wm.voxelSize, pivot: wm.rotorPivot });
      this.rotor = meshOf(rg);
      this.rotor.position.set(...wm.rotorAt);
      tower.add(this.rotor);
    }
    for (let i = 0; i < 9; i++) k.put(safe(() => HX.grassTuft(i % 3)), 6 + (i * 1.37) % 7, -2.2 + ((i * 2.9) % 7.5), i, GROUND, 1, false);
    // the targets
    slots.forEach((p, i) => {
      const kind: 'bottle' | 'can' = i % 3 === 2 || i >= 9 ? 'can' : 'bottle';
      this.addTarget(kind, i, p);
    });
    this.flash = k.lamp(0xffb050, 0, 6, 1.6, new THREE.Vector3(STAND.x + 0.5, 1.4, STAND.y));
    this.debris.groundAt = () => GROUND;
    s.add(this.debris.mesh);
    // the station: in the doorway, out to the yard
    this.st = k.station({
      id: 'range', label: 'Back Yard', title: 'THE BACK YARD', short: 'BACK YARD', sub: 'bottles, cans and a fence that has seen worse', verb: 'Shoot bottles',
      stand: STAND.clone(), face: Math.PI / 2, at: new THREE.Vector3(FENCE.x, 1.0, FENCE.z), r: 0.8, objs: [fence], pose: 'range',
      via: [new THREE.Vector2(3.62, 0.25), new THREE.Vector2(3.62, 1.62), new THREE.Vector2(4.55, 1.62), new THREE.Vector2(5.35, 1.62)],
      slot: [0.86, 0.84, 'right'], arc: new THREE.Vector3(4.15, 1.68, 1.62),
      shot: { pos: new THREE.Vector3(5.42, 1.66, 2.18), look: new THREE.Vector3(), fov: 48, subject: new THREE.Vector3(STAND.x, 1.48, STAND.y), ndc: [-0.34, 0.02] },
    });
    void IN;
  }

  private addTarget(kind: 'bottle' | 'can', i: number, at: THREE.Vector3) {
    const v = kind === 'bottle' ? [0, 1, 3, 2][i % 4] : (i % 3);
    const sm = kind === 'bottle' ? safe(() => WS.targetBottle(v)) : safe(() => WS.targetCan(v));
    if (!sm) return;
    const b = sm.model.bounds();
    const piv: [number, number, number] = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
    const mk = (m: VoxelModel) => {
      const g = buildVoxelGeometry(m, { voxelSize: sm.voxelSize, pivot: piv });
      const mesh = meshOf(g);
      this.h.scene.add(mesh);
      return mesh;
    };
    const full = mk(sm.model);
    let base: THREE.Mesh | null = null, neck: THREE.Mesh | null = null, mid: VoxelModel | null = null;
    if (kind === 'bottle') {
      // the break: a jagged line low on the body (the base stays), a second one under the shoulder (the neck flies)
      const ny = Math.round((sm.meta as unknown as { neckY: number }).neckY / sm.voxelSize);
      const lo = new VoxelModel('base'), hi = new VoxelModel('neck');
      mid = new VoxelModel('mid');
      sm.model.forEach((x, y, z, c, f) => {
        const jag = Math.round(Math.sin(x * 2.1 + z * 1.7) * 1.2);
        if (y < 3 + jag) lo.set(x, y, z, c, f);
        else if (y >= ny + jag) hi.set(x, y, z, c, f);
        else mid!.set(x, y, z, c, f);
      });
      base = mk(lo);
      neck = mk(hi);
    }
    const t: Target = { kind, v, home: at.clone(), full, base, neck, mid, vs: sm.voxelSize, h: (sm.meta as unknown as { h: number }).h, r: kind === 'bottle' ? 0.06 : 0.065, glass: (sm.meta as unknown as { glass?: number }).glass ?? 0x9a9c9c, state: 'up', vel: new THREE.Vector3(), spin: new THREE.Vector3(), neckVel: new THREE.Vector3(), neckSpin: new THREE.Vector3(), pop: 1, hits: 0 };
    this.targets.push(t);
    this.rack(t, 0);
  }
  /** set a target back on its spot (with a little drop-in) */
  private rack(t: Target, delay: number) {
    t.state = 'up';
    t.hits = 0;
    t.pop = -delay;
    t.full.visible = true;
    t.full.position.copy(t.home);
    t.full.rotation.set(0, t.v * 1.3, 0);
    if (t.base) t.base.visible = false;
    if (t.neck) t.neck.visible = false;
  }

  // ======================================================================= the mode
  enter(): Mode | null {
    if (!this.h.arrived) return null;
    this.st = this.h.here;
    this.done = false;
    this.startRound();
    // draw the six-shooter
    const d = loadSave();
    const spec = safe(() => (CH as any).revolverRig(d.gun) as RigSpec);
    if (spec?.parts && this.h.hero) {
      this.gun = new RigInstance(buildRigGeo(spec, `gun:${d.gun.barrel}:${d.gun.cylinder}:${d.gun.grip}:${d.gun.sight}`), { material: makeVoxelMaterial(), castShadow: true });
      this.gunHold = new THREE.Group();
      this.gunHold.rotation.x = Math.PI / 2;
      this.gunHold.add(this.gun.root);
      if (!this.h.hero.attach('hand_r', this.gunHold)) this.h.hero.nodes['fore_r']?.add(this.gunHold);
    }
    this.h.engine.audio.play('rev_spin', { volume: 0.7 });
    this.hud.style.display = 'block';
    this.cross.style.display = 'block';
    document.body.style.cursor = 'none';
    this.aimK = 0;
    return this;
  }
  private startRound() {
    this.phase = 'count';
    this.t = 0;
    this.left = ROUND;
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.ammo = 6;
    this.reload = -1;
    this.best = false;
    this.targets.forEach((t, i) => this.rack(t, i * 0.07));
    this.debris.clear();
  }
  view(): View | null {
    const hx = this.h.pos.x, hz = this.h.pos.y;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    return {
      pos: new THREE.Vector3(hx - 1.3 + sx * 0.02, 1.86 + sy * 0.02, hz + 1.18),
      look: new THREE.Vector3(FENCE.x, 0.95 + sy * 0.05, FENCE.z + 0.05 + sx * 0.05),
      fov: 44,
    };
  }
  picks(): Pick[] {
    return [];
  }
  hint() {
    if (this.phase === 'end') return 'Click to shoot again   ·   Esc: done';
    return 'Click: fire (click fast to fan the hammer)   ·   R: reload   ·   Esc: holster';
  }
  back() {
    this.leave();
    return true;
  }
  private leave() {
    this.gunHold.removeFromParent();
    this.gun = null;
    this.hud.style.display = 'none';
    this.big.style.display = 'none';
    this.cross.style.display = 'none';
    document.body.style.cursor = 'default';
    this.done = true;
  }

  // ======================================================================= shooting
  private muzzle(out: THREE.Vector3) {
    const g = this.gun;
    const mz = g?.geo.spec.meta?.muzzle as [number, number, number] | undefined;
    const fr = g?.nodes['frame'];
    if (g && mz && fr) {
      const vs = g.geo.spec.voxelSize, piv = g.geo.spec.parts[0].pivot;
      fr.updateWorldMatrix(true, false);
      return fr.localToWorld(out.set((mz[0] - piv[0]) * vs, (mz[1] - piv[1]) * vs, (mz[2] - piv[2]) * vs));
    }
    return out.set(this.h.pos.x + 0.6, 1.4, this.h.pos.y);
  }
  private fire() {
    const eng = this.h.engine;
    if (this.reload >= 0) return;
    if (this.ammo <= 0) {
      eng.audio.play('rev_dry', { volume: 0.6 });
      this.startReload();
      return;
    }
    const now = this.t;
    const fan = now - this.lastShot < 0.24;
    this.lastShot = now;
    if (fan) this.fanned = 1;
    this.ammo--;
    this.shots++;
    this.kick = 1;
    this.shake = 1;
    this.cyl++;
    this.cylT = 0;
    const inp = eng.input;
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
    // a hair of spread when fanning
    if (fan) this.ray.ray.direction.add(new THREE.Vector3((Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012)).normalize();
    const R = this.ray.ray;
    let best: Target | null = null, bd = 1e9;
    for (const t of this.targets) {
      if (t.state !== 'up' && t.state !== 'air') continue;
      const c = t.full.position.clone().add(new THREE.Vector3(0, t.state === 'up' ? t.h * 0.5 : 0, 0));
      const d = R.distanceSqToPoint(c);
      const along = c.clone().sub(R.origin).dot(R.direction);
      if (d < t.r * t.r * 1.3 && along > 0 && along < bd) {
        bd = along;
        best = t;
      }
    }
    const mz = this.muzzle(new THREE.Vector3());
    let hitP: THREE.Vector3;
    if (best) {
      hitP = R.at(bd, new THREE.Vector3());
      this.hitTarget(best, R.direction);
    } else {
      // the fence takes the miss, or the dirt beyond
      const tx = (FENCE.x - 0.05 - R.origin.x) / R.direction.x;
      const p = R.at(tx, new THREE.Vector3());
      if (tx > 0 && p.y < 1.05 + GROUND && p.y > GROUND && Math.abs(p.z - FENCE.z) < 1.6) {
        hitP = p;
        this.fx.hit(p, { x: -1, y: 0, z: 0 }, 'wood', 0.8);
        eng.audio.play('bullet_impact_rock', { volume: 0.4, pitch: 1.2 });
      } else {
        const tg = R.direction.y < -0.01 ? (GROUND - R.origin.y) / R.direction.y : 40;
        hitP = R.at(Math.min(tg, 40), new THREE.Vector3());
        if (tg < 40) {
          this.fx.hit(hitP, { x: 0, y: 1, z: 0 }, 'sand', 0.8);
          eng.audio.play('bullet_impact_sand', { volume: 0.35 });
        } else eng.audio.play('bullet_whiz', { volume: 0.25 });
      }
    }
    const dir = hitP.clone().sub(mz).normalize();
    this.fx.revolverMuzzle(mz, dir, 0xfff2a0, fan);
    this.fx.bulletTracer(mz, hitP, 0xfff0b0, !!best);
    this.flashK = 1;
    if (this.flash) this.flash.position.copy(mz);
    eng.audio.play('rev_shot', { volume: 0.9, pitch: fan ? 1.05 : 1 });
    if (fan) eng.audio.play('rev_hammer', { volume: 0.4, pitch: 1.08 });
    if (this.ammo === 0) setTimeout(() => this.reload < 0 && this.phase === 'live' && this.startReload(), 380);
  }
  private hitTarget(t: Target, dir: THREE.Vector3) {
    const eng = this.h.engine;
    this.hits++;
    t.hits++;
    if (t.kind === 'bottle') {
      t.state = 'broken';
      this.score += 10;
      t.full.visible = false;
      const p = t.full.position;
      if (t.base) {
        t.base.visible = true;
        t.base.position.copy(p);
        t.base.rotation.copy(t.full.rotation);
      }
      if (t.neck) {
        t.neck.visible = true;
        t.neck.position.copy(p);
        t.neck.rotation.copy(t.full.rotation);
        t.neckVel.set(dir.x * 2.2 + (Math.random() - 0.5), 2.4 + Math.random(), dir.z * 2.2 + (Math.random() - 0.5) * 1.5);
        t.neckSpin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18);
      }
      if (t.mid) {
        t.full.updateMatrixWorld(true);
        const b = t.mid.bounds();
        this.debris.shatter(t.mid, t.vs, t.full.matrixWorld, [(b.minX + b.maxX + 1) / 2, 0, (b.minZ + b.maxZ + 1) / 2], { chunk: 2, speed: 2.6, up: 1.4, dir: { x: dir.x * 2, y: 0, z: dir.z * 2 }, max: 40 });
      }
      const c = { x: p.x, y: p.y + t.h * 0.45, z: p.z };
      this.h.particles.emit({ pos: c, count: 14, spread: 2.2, up: 1.2, life: [0.4, 0.9], size: [0.035, 0.02], sprite: 'crystal', color: [t.glass, 0xffffff], gravity: 9, ground: true, bounce: 0.3, rot: 6, rotSpeed: 12 });
      this.h.particles.emit({ pos: c, count: 6, spread: 1.6, life: [0.1, 0.25], size: [0.06, 0.01], sprite: 'star4', additive: true, color: 0xffffff });
      eng.audio.play('glass_break', { volume: 0.8, pitch: 0.9 + Math.random() * 0.25 });
    } else {
      const air = t.state === 'air';
      this.score += air ? 25 : 15;
      if (air) this.pop(`+25 JUGGLE`);
      t.state = 'air';
      t.vel.set(dir.x * 1.6 + (Math.random() - 0.5) * 0.6, 3.4 + Math.random() * 0.8, dir.z * 1.6 + (Math.random() - 0.5) * 1.2);
      t.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16);
      const c = t.full.position.clone().add(new THREE.Vector3(0, 0.04, 0));
      this.h.particles.emit({ pos: c, count: 8, spread: 1.8, life: [0.1, 0.25], size: [0.05, 0.008], sprite: 'spark', additive: true, color: 0xfff0c0, stretch: 0.02 });
      eng.audio.play(air ? 'counter_clang' : 'ricochet', { volume: 0.6, pitch: 1.1 + Math.random() * 0.3 });
    }
  }
  private startReload() {
    if (this.reload >= 0 || this.ammo >= 6) return;
    this.reload = 0;
    this.h.engine.audio.play('rev_open', { volume: 0.7 });
  }
  private pop(text: string) {
    this.big.textContent = text;
    this.big.style.display = 'block';
    this.big.style.fontSize = '34px';
    this.popT = 0.9;
  }
  private popT = 0;

  // ======================================================================= per frame
  tick(t: number, rdt: number) {
    // the back door swings wide whenever he is out here or on his way
    const out = this.h.here.id === 'range' || this.h.pos.x > 4.2;
    this.doorK = damp(this.doorK, out ? 1 : 0, 2.5, rdt);
    if (this.h.entry && this.doorK > 0.001) this.h.entry.root.rotation.y -= this.doorK * 0.78;
    // targets that are flying, falling, settling
    for (const tg of this.targets) {
      if (tg.pop < 1) {
        tg.pop += rdt * 2.4;
        const u = clamp01(tg.pop);
        const b = u < 0.6 ? (u / 0.6) ** 2 : 1 - Math.sin(((u - 0.6) / 0.4) * Math.PI) * 0.12;
        tg.full.position.copy(tg.home).add(this.v.set(0, (1 - b) * 0.5, 0));
        tg.full.visible = tg.pop > 0;
      }
      if (tg.state === 'air') {
        tg.vel.y -= 9.8 * rdt;
        tg.full.position.addScaledVector(tg.vel, rdt);
        tg.full.rotation.x += tg.spin.x * rdt;
        tg.full.rotation.y += tg.spin.y * rdt;
        tg.full.rotation.z += tg.spin.z * rdt;
        if (tg.full.position.y < GROUND + 0.035 && tg.vel.y < 0) {
          tg.full.position.y = GROUND + 0.035;
          if (tg.vel.y < -2.5) {
            tg.vel.y *= -0.3;
            tg.vel.x *= 0.5;
            tg.vel.z *= 0.5;
            this.h.engine.audio.play('counter_clang', { volume: 0.2, pitch: 1.6 });
          } else {
            tg.state = 'down';
            tg.full.rotation.set(Math.PI / 2, tg.full.rotation.y, 0);
          }
        }
      }
      if (tg.neck?.visible && tg.state === 'broken') {
        const n = tg.neck;
        if (n.position.y > GROUND + 0.02 || tg.neckVel.y > 0) {
          tg.neckVel.y -= 9.8 * rdt;
          n.position.addScaledVector(tg.neckVel, rdt);
          n.rotation.x += tg.neckSpin.x * rdt;
          n.rotation.z += tg.neckSpin.z * rdt;
          if (n.position.y <= GROUND + 0.02 && tg.neckVel.y < 0) {
            n.position.y = GROUND + 0.02;
            n.rotation.set(Math.PI / 2, n.rotation.y, 0);
            tg.neckVel.set(0, 0, 0);
          }
        }
      }
    }
    this.debris.update(rdt);
    if (this.rotor) this.rotor.rotation.z += rdt * (0.8 + this.h.gust * 1.5);
    this.flashK = Math.max(0, this.flashK - rdt * 14);
    if (this.flash) this.flash.intensity = this.flashK * 7;
    void t;
  }

  update(_t: number, rdt: number) {
    const eng = this.h.engine;
    const inp = eng.input;
    this.t += rdt;
    this.kick = Math.max(0, this.kick - rdt * 6);
    this.shake = Math.max(0, this.shake - rdt * 7);
    this.fanned = Math.max(0, this.fanned - rdt * 5);
    this.cylT += rdt;
    this.aimK = damp(this.aimK, 1, 5, rdt);
    // where the mouse points, at the fence
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
    const R = this.ray.ray;
    const tx = (FENCE.x - R.origin.x) / Math.max(0.05, R.direction.x);
    R.at(Math.min(Math.max(tx, 2), 14), this.aim);
    this.cross.style.left = `${inp.mouseX}px`;
    this.cross.style.top = `${inp.mouseY}px`;
    // the cylinder turns a chamber with each shot; the hammer falls
    if (this.gun) {
      const c = this.gun.nodes['cylinder'];
      if (c) c.rotation.z = -(this.cyl - 1 + sstep(0, 0.09, this.cylT)) * (Math.PI / 3) + (this.reload >= 0 ? this.reload * 14 : 0);
      const hm = this.gun.nodes['hammer'];
      if (hm) hm.rotation.x = this.cylT < 0.06 ? 0 : -0.5 * sstep(0.06, 0.2, this.cylT);
    }
    // the round
    if (this.phase === 'count') {
      const n = 3 - Math.floor(this.t / 0.6);
      const txt = n > 0 ? String(n) : 'DRAW!';
      if (this.big.textContent !== txt) {
        this.big.textContent = txt;
        this.big.style.fontSize = '64px';
        this.big.style.display = 'block';
        eng.audio.play(n > 0 ? 'rev_hammer' : 'qte_good', { volume: 0.6, pitch: n > 0 ? 0.9 + (3 - n) * 0.1 : 1 });
      }
      if (this.t > 2.1) {
        this.phase = 'live';
        this.t = 0;
        this.big.style.display = 'none';
      }
    } else if (this.phase === 'live') {
      this.left = Math.max(0, ROUND - this.t);
      if (inp.wasPressed('Mouse0')) this.fire();
      if (inp.wasPressed('KeyR')) this.startReload();
      const clear = this.targets.every((q) => q.state !== 'up' && q.state !== 'air');
      if (this.left <= 0 || clear) this.finish(clear);
    } else if (this.phase === 'end') {
      if (inp.wasPressed('Mouse0') && this.t > 1.2) {
        this.startRound();
        this.big.style.display = 'none';
      }
    }
    // the reload: open, dump the brass, six rounds in, close, spin
    if (this.reload >= 0) {
      const r0 = this.reload;
      this.reload += rdt;
      const at = (s: number) => r0 < s && this.reload >= s;
      if (at(0.18)) {
        eng.audio.play('rev_eject', { volume: 0.6 });
        this.fx.shells(this.muzzle(new THREE.Vector3()), { x: 0, y: 0, z: 1 }, 6 - this.ammo);
      }
      for (let k = 0; k < 6; k++) if (at(0.35 + k * 0.11)) eng.audio.play('rev_insert', { volume: 0.4, pitch: 0.95 + k * 0.03 });
      if (at(1.05)) eng.audio.play('rev_close', { volume: 0.6 });
      if (at(1.15)) eng.audio.play('rev_spin', { volume: 0.5 });
      if (this.reload > 1.3) {
        this.reload = -1;
        this.ammo = 6;
      }
    }
    if (this.popT > 0) {
      this.popT -= rdt;
      if (this.popT <= 0 && this.phase === 'live') this.big.style.display = 'none';
    }
    const st = hubStats();
    const bullets = this.reload >= 0 ? 'RELOADING' : 'I'.repeat(this.ammo).split('').join(' ') || 'EMPTY';
    const html = `SCORE ${this.score}  ·  ${Math.ceil(this.left)}s  ·  ${bullets}<div style="font-size:15px;opacity:.85;text-align:center">best ${Math.max(st.rangeBest, this.best ? this.score : 0)}</div>`;
    if (this.hud.innerHTML !== html) this.hud.innerHTML = html;
  }
  private finish(clear: boolean) {
    this.phase = 'end';
    this.t = 0;
    const eng = this.h.engine;
    const timeB = clear ? Math.round(this.left * 3) : 0;
    const acc = this.shots ? Math.round((40 * this.hits) / this.shots) : 0;
    this.score += timeB + acc;
    const st = hubStats();
    st.rangeRounds++;
    this.best = this.score > st.rangeBest;
    if (this.best) st.rangeBest = this.score;
    saveHubStats();
    this.big.innerHTML = `${this.score}<div style="font-size:20px;color:#fff3d6">${clear ? `cleared! +${timeB} time` : 'time!'}  ·  +${acc} aim${this.best ? '<br>NEW BEST' : ''}</div>`;
    this.big.style.fontSize = '64px';
    this.big.style.display = 'block';
    eng.audio.play(this.best ? 'rank_up' : 'wave_clear', { volume: 0.6 });
    const lines = this.best ? ['Still got it.', 'Not one bottle safe in the Reach.', 'Write that down, Mama.'] : this.hits < this.shots / 2 ? ['The sun was in my eyes.', 'Bottles moved.', 'Warming up.'] : ['Fair shooting.', 'Pinch could do better. Do not tell him.'];
    this.bubble.say(lines[Math.floor(Math.random() * lines.length)]);
  }

  /** the gun arm out at the target, the other thumb in his belt, a kick with every shot, the fan, the reload */
  poseHero(t: number, _rdt: number) {
    if (!this.h.hero) return;
    const H = this.h.heroHolder;
    const n = this.h.hero.nodes;
    const w = this.aimK;
    joint(this.h, 'torso', 0.04, -0.32, 0.03, w);
    joint(this.h, 'head', 0.08, -0.12, 0, w);
    const sh = n['arm_r'] ? n['arm_r'].getWorldPosition(new THREE.Vector3()) : H.localToWorld(new THREE.Vector3(-0.2, 1.4, 0));
    const dir = this.aim.clone().sub(sh).normalize();
    const R = (this.h.armL1 + this.h.armL2) * 0.94;
    let hand = sh.clone().addScaledVector(dir, R);
    // recoil: the hand jumps up and back
    hand.y += this.kick * 0.07;
    hand.addScaledVector(dir, -this.kick * 0.06);
    if (this.reload >= 0) {
      // bring it in to the chest, tip the muzzle up
      const k = sstep(0, 0.2, this.reload) * (1 - sstep(1.1, 1.3, this.reload));
      hand = hand.lerp(H.localToWorld(new THREE.Vector3(-0.08, 1.15, 0.32)), k);
      reach(this.h, 'l', H.localToWorld(new THREE.Vector3(0.0, 1.18 + Math.sin(this.reload * 30) * 0.01, 0.34)), new THREE.Vector3(0.8, -0.5, -0.3), k);
    } else if (this.fanned > 0) {
      // the left palm slaps the hammer
      reach(this.h, 'l', this.muzzle(new THREE.Vector3()).lerp(sh, 0.55).add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0.8, -0.4, -0.3), this.fanned);
    } else reach(this.h, 'l', H.localToWorld(new THREE.Vector3(0.165, 0.8, 0.085)), new THREE.Vector3(1, -0.2, -0.4), w);
    reach(this.h, 'r', hand, new THREE.Vector3(-1, -0.6, -0.3), w);
    if (n['fore_r'] && this.kick > 0) n['fore_r'].rotateX(-this.kick * 0.35);
    void t;
  }

  dispose() {
    this.leave();
    this.hud.remove();
    this.big.remove();
    this.cross.remove();
  }
}
