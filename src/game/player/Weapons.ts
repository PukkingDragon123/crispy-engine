// Sundown's arsenal. The revolver stays the sidearm (its feel, fanning and
// Pinch's active-reload QTE live in Player.ts); this module adds the long guns
// found as blueprints and everything around them:
//
//  - COACH GUN: two barrels, nine pellets each (pellets on one body are summed
//    into one hit: huge knockback, violent deaths and extra gore up close,
//    damage falls off with range), external hammers that cock and drop, a
//    break-action reload (barrels tip open under the support hand, a flick
//    throws the empties, shells come off the belt one by one, snap shut).
//    Fired in the air it shoves the board back (shotgun surfing).
//  - CHICAGO TYPEWRITER: full auto with a climb that builds while you hold it
//    (the view walks up, pull down to stay on target), bloom, brass flying out
//    of the port, a drum swap reload (pull the drum, toss it, a fresh one off
//    the hip, slap it in, rack the knob).
//  - switching: 3 / 4 / 5 or the mouse wheel. A short draw: the revolver comes
//    off the right hip, long guns off the back sling (where they ride when
//    holstered, the revolver sits in its hip holster).
//  - attachments (meta/Blueprints): visible on the models and tune the guns.
//  - both hands on a long gun: a two-hand IK hold (hip fire, shouldered when
//    aiming, low ready while riding), layered over the riding animation.
//  - the DIG pose for the treasure hunt: shovel out, scoop and throw the sand.
//  - weapon-upgrade blueprints: Blood Moon (lifesteal), Hot Loads, Quick-Draw,
//    Dragon's Breath, Drum Fire.
//
// Aim assist and ADS work with every gun (Player.magnetize / the shared assist).
import * as THREE from 'three';
import type { Player } from './Player';
import type { Ctx, EnemyLike, RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { Input } from '../../engine/Input';
import type { PlayerAnim } from '../anim/playerAnim';
import { armIK, lookQuat } from '../anim/playerAnim';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { clamp, damp, rnd } from '../../engine/math/rand';
import { shotgunRig, tommyRig, ShotgunAtt, TommyAtt, SHOTGUN_DEFAULT, TOMMY_DEFAULT, tommyDrum, shotgunShellModel, revolverLaserModel, shovelModel, LONG_VS } from '../models/characters/longguns';
import { Blueprints, gunTune, GunId, GUNS, WeaponTune, AttachmentDef, WEAPON_UPGRADES, TUNE_DEFAULT } from '../meta/Blueprints';
import type { LongGunId } from '../meta/Save';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const smooth = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** long-gun handling (per gun, before attachments / stats) */
export const LONG_FEEL = {
  shotgun: {
    mag: 2,
    pellets: 9,
    /** damage per pellet at point blank */
    pellet: 8.5,
    /** seconds between barrels */
    interval: 0.24,
    /** cone half-angle (deg) from the hip; ADS multiplier */
    hip: 7.0,
    adsMul: 0.62,
    /** full damage to near (m), down to `minFall` at far, nothing past range */
    near: 7,
    far: 26,
    minFall: 0.25,
    range: 40,
    /** knockback per pellet that lands (scaled by falloff and the knockback stat) */
    knock: 1.25,
    reload: 1.3,
    swap: 0.42,
    /** view punch (rad), screen trauma */
    punch: 0.085,
    trauma: 0.2,
    /** air shove (m/s) when fired off the ground */
    shove: 6.5,
  },
  tommy: {
    mag: 50,
    dmg: 9,
    interval: 0.085,
    hip: 1.5,
    adsMul: 0.42,
    bloom: 0.17,
    bloomMax: 4.2,
    /** view climb per round (rad), grows to ×2.2 over a long burst */
    climb: 0.0062,
    climbMax: 2.2,
    wander: 0.0035,
    range: 130,
    knock: 1.1,
    reload: 2.1,
    swap: 0.5,
  },
};

export interface WeaponHud {
  id: GunId;
  name: string;
  ammo: number;
  mag: number;
  /** how the HUD should draw the magazine */
  kind: 'cylinder' | 'shells' | 'drum';
  reloading: boolean;
  /** 0..1 while a swap is under way */
  swap: number;
  carried: { id: GunId; name: string; key: string; ammo: number; mag: number }[];
}

interface Dropped {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  t: number;
  rest: boolean;
}

const geoCache = new Map<string, { geo: THREE.BufferGeometry; size: number }>();
function staticGeo(key: string, make: () => { model: any; voxelSize: number; pivot: [number, number, number] }) {
  let g = geoCache.get(key);
  if (!g) {
    const m = make();
    g = { geo: buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: m.pivot }), size: m.voxelSize };
    geoCache.set(key, g);
  }
  return g.geo;
}

/** build any gun as a display object (hideout bench, blueprint schematics, icons) */
export function buildWeaponRig(g: GunId, fitted: AttachmentDef[] = Blueprints.fitted(g)): RigSpec | null {
  if (g === 'shotgun') return shotgunRig(shotgunAtt(fitted));
  if (g === 'tommy') return tommyRig(tommyAtt(fitted));
  return null;
}
export function shotgunAtt(fitted: AttachmentDef[]): ShotgunAtt {
  const a: ShotgunAtt = { ...SHOTGUN_DEFAULT };
  for (const f of fitted) {
    if (f.id === 'sg_sawnoff') a.barrel = 'sawnoff';
    if (f.id === 'sg_long') a.barrel = 'long';
    if (f.id === 'sg_choke') a.choke = true;
    if (f.id === 'sg_holder') a.holder = true;
    if (f.id === 'sg_laser') a.laser = true;
  }
  return a;
}
export function tommyAtt(fitted: AttachmentDef[]): TommyAtt {
  const a: TommyAtt = { ...TOMMY_DEFAULT };
  for (const f of fitted) {
    if (f.id === 'tm_drum100') a.drum = 'C100';
    if (f.id === 'tm_cutts') a.muzzle = 'cutts';
    if (f.id === 'tm_suppressor') a.muzzle = 'suppressor';
    if (f.id === 'tm_scope') a.scope = true;
    if (f.id === 'tm_laser') a.laser = true;
  }
  return a;
}
/** a ready-made display object for a long gun (its own RigInstance root) */
export function buildWeaponDisplay(g: GunId, fitted?: AttachmentDef[], material?: THREE.Material): THREE.Object3D | null {
  const spec = buildWeaponRig(g, fitted);
  if (!spec) return null;
  const inst = new RigInstance(buildRigGeo(spec), material ? { material: material as any } : {});
  return inst.root;
}

export class Weapons {
  /** guns on the hunter this run, in key order (3, 4, 5) */
  carried: GunId[] = ['revolver'];
  current: GunId = 'revolver';
  rigs: Partial<Record<GunId, RigInstance>> = {};
  tunes: Record<GunId, WeaponTune> = { revolver: { ...TUNE_DEFAULT }, shotgun: { ...TUNE_DEFAULT }, tommy: { ...TUNE_DEFAULT } };
  private fitted: Record<GunId, AttachmentDef[]> = { revolver: [], shotgun: [], tommy: [] };
  private ammo: Record<GunId, number> = { revolver: 6, shotgun: 2, tommy: 50 };
  private holsterT: Record<GunId, number> = { revolver: 0, shotgun: 0, tommy: 0 };
  /** swap in progress (the meshes change hands at the midpoint) */
  swap: { t: number; dur: number; from: GunId; to: GunId; swapped: boolean } | null = null;
  /** the treasure hunt's dig: where the blade goes in (world), set / cleared by TreasureHunt */
  dig: { at: THREE.Vector3; t: number } | null = null;
  // pose weights
  private lw = 0;
  private digW = 0;
  private swW = 0;
  private kick = 0;
  private kickV = 0;
  // long-gun fire state
  private bloom = 0;
  private spray = 0;
  private sprayT = 0;
  private barrel = 0;
  private roundN = 0;
  private hammerCock = [1, 1];
  private shotBuffer = 0;
  private reloadNeed = 0;
  private drumOff = 0;
  private boltBack = 0;
  private drumGone = false;
  // visuals
  private hip = new THREE.Group();
  private sling = new THREE.Group();
  private shovel: THREE.Mesh;
  private handShell: THREE.Mesh;
  private handDrum = new THREE.Group();
  private revLaser: THREE.Mesh | null = null;
  private laserLine: THREE.Line;
  private laserFrom = new THREE.Vector3();
  private dropped: Dropped[] = [];
  private mT = new THREE.Matrix4();
  private qT = new THREE.Quaternion();
  private aimT = new THREE.Vector3();
  private upT = new THREE.Vector3();
  private offs: (() => void)[] = [];
  private digPhase = 0;
  private wheelCd = 0;

  constructor(private ctx: Ctx, private p: Player, private input: Input, private holder: THREE.Group) {
    const P = p;
    this.rigs.revolver = P.gun;
    // the loadout: the revolver, the long gun on the sling (and every gun with ?guns=all)
    const lo = Blueprints.loadout();
    const all = new URLSearchParams(location.search).get('guns') === 'all';
    for (const g of ['shotgun', 'tommy'] as LongGunId[]) if (all || (lo.secondary === g && Blueprints.ownsGun(g))) this.carried.push(g);
    for (const g of ['revolver', 'shotgun', 'tommy'] as GunId[]) this.refit(g, false);
    this.ammo.revolver = P.ammo;
    for (const g of ['shotgun', 'tommy'] as GunId[]) this.ammo[g] = this.mag(g);
    // holsters: the revolver rides the right hip, long guns sling across the back
    P.rig.attach('hip_r', this.hip) || P.rig.nodes['pelvis']?.add(this.hip);
    P.rig.attach('back', this.sling) || P.rig.nodes['torso']?.add(this.sling);
    this.sling.position.set(0, -0.02, -0.07);
    for (const g of this.carried) if (g !== 'revolver') this.holster(g);
    // the dig shovel and the shell / drum the support hand carries during a reload
    this.shovel = new THREE.Mesh(staticGeo('shovel', shovelModel), P.material);
    this.shovel.visible = false;
    this.shovel.castShadow = true;
    holder.add(this.shovel);
    this.handShell = new THREE.Mesh(staticGeo('shell', shotgunShellModel), P.material);
    this.handShell.visible = false;
    this.handShell.rotation.x = Math.PI / 2;
    P.rig.attach('hand_l', this.handShell);
    this.handDrum.visible = false;
    P.rig.attach('hand_l', this.handDrum);
    // the laser: a hair-thin red line to whatever the sight is on
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.laserLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.laserLine.frustumCulled = false;
    this.laserLine.visible = false;
    ctx.scene.add(this.laserLine);
    this.applyUpgrades();
    this.offs.push(ctx.events.on('enemyKilled', () => {
      if (Blueprints.hasUpgrade('up_bloodmoon') && P.alive && P.hp < P.maxHp * 0.35) {
        P.heal(4);
        ctx.particles.emit({ pos: P.center(_v), count: 5, spread: 0.6, up: 1.2, life: [0.4, 0.7], size: [0.1, 0.03], sprite: ['dot3', 'star4'], additive: true, color: [0xd02030, 0xff6a5a], drag: 2 });
      }
    }));
  }

  // ------------------------------------------------------------------ queries
  get isLong() {
    return this.current !== 'revolver';
  }
  tune(g: GunId = this.current) {
    return this.tunes[g];
  }
  /** magazine size of a gun (stats included) */
  mag(g: GunId = this.current) {
    const base = Math.round(this.p.stats.get('ammo'));
    if (g === 'shotgun') return LONG_FEEL.shotgun.mag;
    if (g === 'tommy') return LONG_FEEL.tommy.mag + this.tunes.tommy.magAdd + Math.max(0, base - 6) * 5;
    return base;
  }
  hud(): WeaponHud {
    const g = this.current;
    return {
      id: g,
      name: GUNS[g].name,
      ammo: this.p.ammo,
      mag: this.mag(g),
      kind: g === 'revolver' ? 'cylinder' : g === 'shotgun' ? 'shells' : 'drum',
      reloading: this.p.reload.active,
      swap: this.swap ? this.swap.t / this.swap.dur : 0,
      carried: this.carried.map((c, i) => ({ id: c, name: GUNS[c].name, key: String(3 + i), ammo: c === g ? this.p.ammo : this.ammo[c], mag: this.mag(c) })),
    };
  }

  // ------------------------------------------------------------------ loadout
  /** (re)read a gun's fitted attachments; rebuild its model if it changed */
  refit(g: GunId, rebuild = true) {
    this.fitted[g] = Blueprints.fitted(g);
    this.tunes[g] = gunTune(g, this.fitted[g]);
    if (g === 'revolver') this.fitRevolverLaser();
    if (rebuild && g !== 'revolver' && this.rigs[g]) {
      const old = this.rigs[g]!;
      const parent = old.root.parent;
      old.root.removeFromParent();
      delete this.rigs[g];
      const inst = this.ensureRig(g);
      parent?.add(inst.root);
      inst.root.position.copy(old.root.position);
      inst.root.quaternion.copy(old.root.quaternion);
      if (this.current === g) this.p.gun = inst;
    }
  }

  private ensureRig(g: GunId): RigInstance {
    let r = this.rigs[g];
    if (r) return r;
    const spec = buildWeaponRig(g, this.fitted[g])!;
    r = new RigInstance(buildRigGeo(spec, spec.name + ':player'), { material: this.p.material });
    this.rigs[g] = r;
    return r;
  }

  private fitRevolverLaser() {
    const has = this.tunes.revolver.laser;
    if (!has && this.revLaser) {
      this.revLaser.removeFromParent();
      this.revLaser = null;
    }
    const rev = this.rigs.revolver;
    if (!has || this.revLaser || !rev) return;
    const frame = rev.nodes['frame'];
    const spec = rev.geo.spec;
    if (!frame) return;
    const vs = spec.voxelSize, piv = spec.parts[0].pivot;
    this.revLaser = new THREE.Mesh(staticGeo('rev_laser', revolverLaserModel), this.p.material);
    // clamped under the barrel, just ahead of the cylinder
    this.revLaser.position.set((0.5 - piv[0]) * vs, (0.6 - piv[1]) * vs, (10.5 - piv[2]) * vs);
    frame.add(this.revLaser);
  }

  /** stat modifiers of the weapon-upgrade blueprints ('upx:' sources are rebuilt every scene, never carried) */
  private applyUpgrades() {
    const st = this.p.stats;
    st.removeSource('upx:blueprint');
    for (const u of Object.values(WEAPON_UPGRADES)) {
      if (!Blueprints.hasUpgrade(u.id) || !u.mods) continue;
      st.add(u.mods.map((m) => ({ ...m, source: 'upx:blueprint' })));
    }
  }

  /** a blueprint was learned mid-run: hand the gun over / fit the part / switch the perk on */
  onLearn(id: string) {
    if (id.startsWith('gun_')) {
      const g = id.slice(4) as LongGunId;
      if (!this.carried.includes(g)) {
        this.carried.push(g);
        this.ammo[g] = this.mag(g);
        this.holster(g);
        this.ctx.toast(`${GUNS[g].name.toUpperCase()} ON YOUR BACK`, '#ffd36b', `Press ${3 + this.carried.indexOf(g)} or roll the wheel to draw it`);
      }
      return;
    }
    for (const g of ['revolver', 'shotgun', 'tommy'] as GunId[]) {
      const before = this.fitted[g].map((a) => a.id).join();
      this.fitted[g] = Blueprints.fitted(g);
      if (this.fitted[g].map((a) => a.id).join() !== before) this.refit(g);
    }
    this.applyUpgrades();
  }

  private holster(g: GunId) {
    const r = this.ensureRig(g);
    r.root.removeFromParent();
    if (g === 'revolver') {
      this.hip.add(r.root);
      r.root.position.set(0, -0.02, 0.02);
      // muzzle down along the thigh, the grip back and up
      r.root.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2 + 0.12, 0, 0.08));
    } else {
      // diagonal across the shoulder blades: muzzle up past the left shoulder, flat to the back
      const slot = this.carried.filter((c) => c !== 'revolver').indexOf(g);
      this.sling.add(r.root);
      const z = new THREE.Vector3(0.5 + slot * 0.18, 0.86, 0).normalize();
      const x = new THREE.Vector3(0, 0, -1);
      const y = new THREE.Vector3().crossVectors(z, x);
      r.root.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
      r.root.position.set(0.02 - slot * 0.03, -0.06, -0.025 - slot * 0.05);
    }
    for (const k of ['barrels', 'drum', 'bolt'] as const) {
      const n = r.nodes[k];
      if (n) {
        n.rotation.set(0, 0, 0);
        n.position.copy(r.geo.parts[r.geo.index[k]].offset);
        n.visible = true;
      }
    }
  }

  private draw(g: GunId) {
    const r = this.ensureRig(g);
    r.root.removeFromParent();
    this.holder.add(r.root);
    r.root.position.set(0, 0, 0);
    r.root.quaternion.identity();
    this.p.gun = r;
  }

  // ------------------------------------------------------------------ switching
  /** called first thing in the player's gun update: number keys / wheel, the swap itself */
  preUpdate(dt: number) {
    const inp = this.input;
    const P = this.p;
    this.wheelCd -= dt;
    // holstered guns: Quick-Draw reloads them after a moment on the hip / back
    const qd = Blueprints.hasUpgrade('up_quickdraw');
    for (const g of this.carried) {
      if (g === this.current) continue;
      this.holsterT[g] += dt;
      if (qd && this.holsterT[g] > 2.5) this.ammo[g] = this.mag(g);
    }
    if (!this.swap && P.alive && !this.dig && this.carried.length > 1) {
      let want: GunId | null = null;
      const keys = ['Digit3', 'Digit4', 'Digit5'];
      for (let i = 0; i < keys.length; i++) if (inp.enabled && inp.wasPressed(keys[i]) && this.carried[i]) want = this.carried[i];
      if (inp.enabled && inp.wheel !== 0 && this.wheelCd <= 0) {
        const i = this.carried.indexOf(this.current);
        want = this.carried[(i + Math.sign(inp.wheel) + this.carried.length) % this.carried.length];
        this.wheelCd = 0.2;
      }
      if (want && want !== this.current) this.select(want);
    }
    const s = this.swap;
    if (s) {
      s.t += dt;
      if (!s.swapped && s.t >= s.dur * 0.5) {
        s.swapped = true;
        this.ammo[s.from] = P.ammo;
        this.holster(s.from);
        this.draw(s.to);
        this.current = s.to;
        P.ammo = Math.min(this.ammo[s.to], this.mag(s.to));
        this.holsterT[s.to] = 0;
        this.bloom = 0;
        this.spray = 0;
        this.ctx.sfx(s.to === 'revolver' ? 'rev_close' : 'lever_cycle', P.pos, 0.6, s.to === 'tommy' ? 1.2 : 1.05);
        this.ctx.events.emit('weaponSwap', s.to, s.from);
      }
      if (s.t >= s.dur) this.swap = null;
    }
  }

  /** draw a carried gun (keys / wheel call this; the HUD or touch layer can too) */
  select(g: GunId) {
    const P = this.p;
    if (this.swap || g === this.current || !this.carried.includes(g)) return false;
    if (P.reload.active) this.cancelReload();
    const dur = (g === 'revolver' ? 0.34 : LONG_FEEL[g].swap) * (Blueprints.hasUpgrade('up_quickdraw') ? 0.5 : 1);
    this.swap = { t: 0, dur, from: this.current, to: g, swapped: false };
    P.fanning = false;
    P.fireCd = Math.max(P.fireCd, dur);
    this.ctx.sfx('whoosh', P.pos, 0.35, 1.3);
    if (g === 'revolver') this.ctx.sfx('rev_spin', P.pos, 0.45, 1.1);
    return true;
  }

  // ------------------------------------------------------------------ long guns: trigger + reload
  /** the long gun's update (Player calls this instead of the revolver's when one is held) */
  updateLong(dt: number) {
    const P = this.p;
    const inp = this.input;
    const R = P.reload;
    const g = this.current as LongGunId;
    const T = this.tune();
    this.bloom = Math.max(0, this.bloom - dt * (g === 'tommy' ? 4.5 : 3) * (1 + P.cam.aim));
    this.sprayT -= dt;
    if (this.sprayT <= 0) this.spray = Math.max(0, this.spray - dt * 18);
    if (R.active) {
      if (R.jam > 0) R.jam -= dt;
      else {
        const spd = P.stats.get('reloadSpeed') / T.reloadMul;
        R.t += (dt * spd) / R.dur;
        this.reloadStep(g);
        if (R.t >= 1) this.finishReload(false);
      }
      if (inp.hit('reload') && !R.tried && R.t > 0.05) {
        R.tried = true;
        if (R.t >= R.window[0] && R.t <= R.window[1]) this.finishReload(true);
        else {
          R.jam = 0.5;
          this.ctx.sfx('qte_fail', null, 0.6);
          this.ctx.toast('JAMMED', '#ff9a6a');
          P.express('hurt', 0.4);
        }
      }
    } else if (inp.hit('reload') && P.ammo < this.mag()) this.startReload();
    // trigger
    const want = inp.held('fire') && !this.swap;
    const pressed = inp.hit('fire') && !this.swap;
    P.firing = want;
    P.fanning = false;
    this.shotBuffer = pressed ? 0.14 : this.shotBuffer - dt;
    const rate = P.stats.get('fireRate');
    if (!R.active && !this.swap) {
      if (P.ammo <= 0) {
        if (pressed) {
          this.ctx.sfx('rev_dry', P.pos, 0.8, 0.8);
          this.startReload();
        }
      } else if (P.fireCd <= 0) {
        if (g === 'shotgun' && this.shotBuffer > 0) {
          this.shotBuffer = 0;
          P.fireCd = LONG_FEEL.shotgun.interval / rate;
          this.shootShotgun();
        } else if (g === 'tommy' && want) {
          // keep the cadence exact, but never bank shots while the trigger was off
          P.fireCd = Math.max(P.fireCd, -0.03) + LONG_FEEL.tommy.interval / rate;
          this.shootTommy();
        }
      }
    }
    if (P.ammo <= 0 && !R.active && P.fireCd < -0.3 && !this.swap) this.startReload();
    // parts: hammers / drum / bolt / barrels follow the state (reload choreography drives them)
    this.animateParts(dt);
  }

  startReload() {
    const P = this.p;
    const R = P.reload;
    if (R.active || P.ammo >= this.mag() || this.swap) return;
    R.active = true;
    R.t = 0;
    R.phase = 'none';
    R.tried = false;
    R.jam = 0;
    R.inserted = 0;
    R.dur = this.current === 'shotgun' ? LONG_FEEL.shotgun.reload : LONG_FEEL.tommy.reload;
    this.reloadNeed = this.mag() - P.ammo;
    const w = 0.16 - (this.ctx.run.rank > 10 ? 0.02 : 0);
    const s = 0.42 + rnd.next() * 0.16;
    R.window = [s, s + w];
    this.ctx.events.emit('reloadStart');
  }

  private cancelReload() {
    const R = this.p.reload;
    R.active = false;
    R.phase = 'none';
    R.dur = 1.5;
    this.handShell.visible = false;
    this.handDrum.visible = false;
    const r = this.rigs[this.current];
    if (this.drumGone && r?.nodes['drum']) r.nodes['drum'].visible = true;
    this.drumGone = false;
    this.drumOff = 0;
  }

  private finishReload(perfect: boolean) {
    const P = this.p;
    const R = P.reload;
    R.active = false;
    R.phase = 'none';
    R.dur = 1.5;
    P.ammo = this.mag();
    this.handShell.visible = false;
    this.handDrum.visible = false;
    const r = this.rigs[this.current];
    if (r?.nodes['drum']) r.nodes['drum'].visible = true;
    this.drumGone = false;
    this.drumOff = 0;
    this.hammerCock = [1, 1];
    if (perfect) {
      P.venomRounds = Math.min(P.ammo, this.current === 'tommy' ? 15 : P.ammo);
      R.perfectFx = 1;
      this.ctx.sfx('qte_perfect', null, 0.8);
      this.ctx.toast('PERFECT RELOAD', '#9dff3a', this.current === 'tommy' ? '15 venom rounds +35% dmg' : 'Venom shells +35% dmg');
      this.ctx.fx.sparkle(P.muzzleWorld, 0x9dff3a, 10, 0.3);
      P.express('smug', 0.9);
      this.ctx.events.emit('perfectReload');
    }
    this.ctx.sfx(this.current === 'shotgun' ? 'rev_close' : 'lever_cycle', P.pos, 0.5, 0.9);
  }

  /** phase boundaries + their sounds / props (the pose reads the phases too) */
  private reloadStep(g: LongGunId) {
    const P = this.p;
    const R = P.reload;
    const ctx = this.ctx;
    const k = R.t;
    const r = this.rigs[g];
    if (g === 'shotgun') {
      const phase = k < 0.16 ? 'open' : k < 0.3 ? 'eject' : k < 0.84 ? 'insert' : 'close';
      if (phase !== R.phase) {
        R.phase = phase;
        if (phase === 'open') ctx.sfx('rev_open', P.pos, 0.8, 0.75);
        if (phase === 'eject') {
          // the extractors kick the empties out over the shoulder
          const at = r?.sockets['ejector']?.getWorldPosition(_v) ?? P.muzzleWorld;
          const cf = P.cam.forward();
          const spent = Math.max(1, this.reloadNeed);
          ctx.particles.emit({ pos: at, count: spent, vel: { x: -cf.x * 2.2 + P.board.vel.x * 0.85, y: 3.6, z: -cf.z * 2.2 + P.board.vel.z * 0.85 }, spread: 1.0, life: [1.4, 2.0], size: [0.1, 0.09], sprite: 'bullet', color: 0xd04a34, gravity: 14, ground: true, bounce: 0.4, rot: 6, rotSpeed: 12, sizeJitter: 0.05 });
          ctx.particles.emit({ pos: at, count: 3, vel: { x: P.board.vel.x * 0.8, y: 0.6, z: P.board.vel.z * 0.8 }, spread: 0.4, life: [0.6, 1.1], size: [0.1, 0.4], sprite: ['puff1', 'puff2'], color: [0xd8d0c4, 0xbab0a4], alpha: 0.4, drag: 2.5, gravity: -0.6 });
          ctx.sfx('rev_eject', P.pos, 0.7, 0.75);
          ctx.engine.tweens.after(0.4, () => ctx.sfx('shell_casing', P.pos, 0.5, 0.75));
        }
        if (phase === 'close') {
          ctx.sfx('rev_close', P.pos, 0.9, 0.7);
          ctx.sfx('lever_cycle', P.pos, 0.35, 1.5);
        }
      }
      if (phase === 'insert') {
        const need = Math.max(1, this.reloadNeed);
        const n = Math.floor(((k - 0.3) / 0.54) * need + 0.15);
        if (n > R.inserted && n <= need) {
          R.inserted = n;
          ctx.sfx('rev_insert', P.pos, 0.7, 0.72 + n * 0.05);
        }
      }
    } else {
      const phase = k < 0.16 ? 'open' : k < 0.34 ? 'eject' : k < 0.8 ? 'insert' : 'close';
      if (phase !== R.phase) {
        R.phase = phase;
        if (phase === 'open') ctx.sfx('rev_open', P.pos, 0.7, 0.6);
        if (phase === 'insert') {
          ctx.sfx('rev_insert', P.pos, 0.5, 0.55);
        }
        if (phase === 'close') {
          ctx.sfx('rev_close', P.pos, 0.85, 0.62); // the drum slapped home
          ctx.engine.tweens.after(0.14, () => ctx.sfx('shotgun_pump', P.pos, 0.55, 1.45)); // rack the knob
        }
      }
      // pull and toss the empty drum
      if (phase === 'eject' && !this.drumGone && (k - 0.16) / 0.18 > 0.55 && r?.nodes['drum']) {
        this.drumGone = true;
        this.tossDrum(r);
        ctx.sfx('rev_eject', P.pos, 0.6, 0.55);
        ctx.engine.tweens.after(0.35, () => ctx.sfx('hit_armor', P.pos, 0.35, 0.7));
      }
    }
  }

  private tossDrum(r: RigInstance) {
    const node = r.nodes['drum'];
    node.updateMatrixWorld(true);
    const big = this.tunes.tommy.magAdd > 0;
    const mesh = new THREE.Mesh(r.meshes['drum'].geometry, this.p.material);
    mesh.castShadow = true;
    const obj = new THREE.Group();
    obj.add(mesh);
    node.matrixWorld.decompose(obj.position, obj.quaternion, _v3);
    this.ctx.scene.add(obj);
    node.visible = false;
    const side = _v.set(1, 0, 0).applyQuaternion(obj.quaternion);
    const bv = this.p.board.vel;
    this.dropped.push({ obj, vel: new THREE.Vector3(side.x * 2.4 + bv.x * 0.8, 1.6, side.z * 2.4 + bv.z * 0.8), spin: new THREE.Vector3(rnd.range(-6, 6), rnd.range(-3, 3), rnd.range(4, 9)), t: 0, rest: false });
    void big;
  }

  private updateDropped(dt: number) {
    for (let i = this.dropped.length - 1; i >= 0; i--) {
      const d = this.dropped[i];
      d.t += dt;
      if (!d.rest) {
        d.vel.y -= 16 * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotateX(d.spin.x * dt);
        d.obj.rotateY(d.spin.y * dt);
        d.obj.rotateZ(d.spin.z * dt);
        const gy = this.ctx.world.groundAt(d.obj.position.x, d.obj.position.z) + 0.06;
        if (d.obj.position.y < gy) {
          d.obj.position.y = gy;
          if (Math.abs(d.vel.y) > 2) {
            d.vel.y *= -0.3;
            d.vel.x *= 0.5;
            d.vel.z *= 0.5;
            d.spin.multiplyScalar(0.5);
            this.ctx.fx.dust({ x: d.obj.position.x, y: gy, z: d.obj.position.z }, 0.3, 0xe6cf9f, 2);
          } else d.rest = true;
        }
      } else if (d.t > 5) d.obj.position.y -= dt * 0.15;
      if (d.t > 7) {
        d.obj.removeFromParent();
        this.dropped.splice(i, 1);
      }
    }
  }

  /** hammers fall when a barrel fires and cock on the close; the bolt rides back on each round */
  private animateParts(dt: number) {
    const r = this.rigs[this.current];
    if (!r) return;
    const n = r.nodes;
    if (this.current === 'shotgun') {
      n['hammer_l'] && (n['hammer_l'].rotation.x = damp(n['hammer_l'].rotation.x, -0.55 * this.hammerCock[0], 30, dt));
      n['hammer_r'] && (n['hammer_r'].rotation.x = damp(n['hammer_r'].rotation.x, -0.55 * this.hammerCock[1], 30, dt));
    } else {
      this.boltBack = damp(this.boltBack, 0, 26, dt);
    }
  }

  // ------------------------------------------------------------------ the shots
  /** current cone (deg) for the crosshair and the shot */
  coneDeg() {
    const P = this.p;
    const g = this.current;
    if (g === 'revolver') return 0;
    const T = this.tune();
    const F = g === 'shotgun' ? LONG_FEEL.shotgun : LONG_FEEL.tommy;
    const ads = P.cam.aim;
    const base = F.hip * T.spreadMul * (1 - (1 - T.hipSpreadMul) * (1 - ads)) * P.stats.get('spread');
    const move = (clamp(P.speed / P.board.t.cap, 0, 1) * 0.5 + (P.board.grounded ? 0 : 0.4)) * (1 - ads * 0.6) * (g === 'shotgun' ? 0.6 : 1);
    return (base + move + this.bloom) * (1 - ads * (1 - F.adsMul));
  }

  private jitter(d: THREE.Vector3, coneDeg: number, ring = false) {
    const out = d.clone();
    const sr = coneDeg * DEG * (ring ? 0.55 + 0.45 * Math.sqrt(rnd.next()) : Math.sqrt(rnd.next()));
    const sa = rnd.next() * Math.PI * 2;
    const p1 = _v.set(0, 1, 0).cross(out).normalize();
    const p2 = _v2.copy(out).cross(p1).normalize();
    return out.addScaledVector(p1, Math.cos(sa) * Math.tan(sr)).addScaledVector(p2, Math.sin(sa) * Math.tan(sr)).normalize();
  }

  /** where a ray stops in the world (terrain / props) */
  private worldStop(o: THREE.Vector3, d: THREE.Vector3, max: number) {
    const ctx = this.ctx;
    const tt = ctx.world.field.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
    const colHit = { t: -1, c: null as any, nx: 0, nz: 0 };
    ctx.world.colliders.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, colHit);
    let t = max;
    let surface: 'terrain' | 'prop' | 'none' = 'none';
    if (tt >= 0) {
      t = tt;
      surface = 'terrain';
    }
    if (colHit.t >= 0 && colHit.t < t) {
      t = colHit.t;
      surface = 'prop';
    }
    return { t, surface, col: colHit };
  }

  private impact(p: THREE.Vector3, surface: 'terrain' | 'prop' | 'none', col: { c: any; nx: number; nz: number }, power: number, sound: boolean, d: THREE.Vector3) {
    const ctx = this.ctx;
    if (surface === 'terrain') {
      const n = new THREE.Vector3(0, 1, 0);
      ctx.world.normal(p.x, p.z, n);
      const mat = ctx.world.field.matAt(p.x, p.z);
      const rock = mat === 3 || mat === 4 || mat === 5;
      ctx.fx.hit(p, n, rock ? 'rock' : 'sand', power);
      if (sound) ctx.sfx(rock ? 'bullet_impact_rock' : 'bullet_impact_sand', p, 0.6);
    } else if (surface === 'prop') {
      ctx.fx.hit(p, { x: col.nx, y: 0.3, z: col.nz }, col.c?.data?.material ?? 'rock', power);
      if (sound) {
        ctx.sfx('bullet_impact_rock', p, 0.5);
        ctx.events.emit('propShot', col.c, p, d);
      }
    }
  }

  private shootShotgun() {
    const P = this.p;
    const ctx = this.ctx;
    const F = LONG_FEEL.shotgun;
    const T = this.tune();
    P.ammo--;
    const venom = P.venomRounds > 0;
    if (venom) P.venomRounds--;
    const ads = P.cam.aim;
    // which barrel: right first, then left
    const b = this.barrel;
    this.barrel = 1 - b;
    this.hammerCock[b] = 0;
    const r = this.rigs.shotgun!;
    const mz = r.sockets[b === 0 ? 'muzzle_r' : 'muzzle_l'] ?? r.sockets['muzzle'];
    mz?.getWorldPosition(P.muzzleWorld);
    const o = P.ray.o.clone();
    const cone = this.coneDeg();
    P.lastFireT = P.animTime;
    this.bloom = Math.min(3, this.bloom + 0.9 * (1 - ads * 0.5));
    // the pattern centre bends onto a near-miss body (aim assist), then the pellets scatter round it
    let dc = P.ray.d.clone();
    const range = F.range * T.rangeMul;
    if (!ctx.enemies.raycast(o, dc, range)) {
      const md = P.magnetize(o, dc);
      if (md) dc = md;
    }
    const pellets = F.pellets + T.pelletsAdd;
    const agg = new Map<EnemyLike, { n: number; dmg: number; head: number; point: THREE.Vector3; part: string; dist: number; fall: number }>();
    let firstHit: RayHit | null = null;
    let sounded = 0;
    const dragon = Blueprints.hasUpgrade('up_dragonsbreath');
    for (let i = 0; i < pellets; i++) {
      const d = i === 0 ? dc.clone() : this.jitter(dc, cone, i % 3 === 0);
      const w = this.worldStop(o, d, range);
      const hit = ctx.enemies.raycast(o, d, range);
      let end: THREE.Vector3;
      if (hit && hit.t < w.t && hit.enemy) {
        firstHit ??= hit;
        const near = F.near * T.rangeMul, far = F.far * T.rangeMul;
        const fall = hit.t <= near ? 1 : hit.t >= far ? F.minFall : 1 - (1 - F.minFall) * smooth((hit.t - near) / (far - near));
        const a = agg.get(hit.enemy) ?? { n: 0, dmg: 0, head: 0, point: hit.point.clone(), part: hit.part, dist: hit.t, fall: 0 };
        a.n++;
        a.dmg += F.pellet * fall;
        a.fall += fall;
        if (hit.headshot) a.head++;
        agg.set(hit.enemy, a);
        end = hit.point;
        if (i % 2 === 0) ctx.fx.hit(hit.point, { x: -d.x, y: 0.3, z: -d.z }, 'flesh', 0.35);
      } else {
        end = o.clone().addScaledVector(d, w.t);
        if (w.surface !== 'none') this.impact(end, w.surface, w.col, 0.45, sounded++ < 2, d);
      }
      // a few hot pellet streaks
      if (i < 5) ctx.fx.tracer(P.muzzleWorld, end, venom ? 0xc8ff5a : dragon ? 0xffa040 : 0xffe2a0, 280);
    }
    // one heavy hit per body: summed pellets, knockback grows with the pellets that land
    let killed = false, headAt: THREE.Vector3 | null = null;
    P.shotCrit = false;
    for (const [e, a] of agg) {
      const fallAvg = a.fall / a.n;
      const close = a.dist < 5;
      const h: Hit = {
        base: a.dmg * T.dmgMul * (venom ? 1.35 : 1),
        kind: 'phys',
        source: 'gun',
        headshot: a.head >= 3,
        critBonus: T.critAdd,
        status: [
          ...(venom ? [{ id: 'poison' as const, stacks: 3, dur: 4, power: 2.2 }] : []),
          ...(dragon ? [{ id: 'burn' as const, stacks: Math.min(4, a.n), dur: 3, power: 1.6 }] : []),
        ],
        knock: (2 + a.n * F.knock) * fallAvg * P.stats.get('knockback') * (close ? 1.25 : 1),
        dirX: dc.x,
        dirZ: dc.z,
        tags: [a.part],
      };
      const was = e.alive;
      ctx.enemies.damage(e, h, a.point, dc);
      if (was && !e.alive) {
        killed = true;
        // point blank: the body comes apart
        if (a.dist < 6 && a.n >= 4) {
          ctx.events.emit('gibs', e.pos.x, e.pos.y + e.height * 0.55, e.pos.z, 8 + a.n, 0.08, [0xeee2c8, 0xcdbd9c, 0x8a2a1e, 0x6a1a12], 6 + a.n * 0.5, 4);
          ctx.sfx('gore_splat', a.point, 0.7);
          ctx.fx.hit(a.point, { x: dc.x, y: 0.4, z: dc.z }, 'flesh', 1.6);
        }
      }
      if (h.headshot && !headAt) headAt = a.point.clone();
    }
    // the blast: big flash, a smoke slug, the boom
    const col = venom ? 0xc8ff5a : dragon ? 0xffa040 : 0xfff2a0;
    ctx.fx.muzzle(P.muzzleWorld, dc, col, true);
    ctx.fx.revolverMuzzle(P.muzzleWorld, dc, col, false, P.board.vel);
    if (dragon) ctx.particles.emit({ pos: P.muzzleWorld, count: 10, vel: { x: dc.x * 12, y: dc.y * 12, z: dc.z * 12 }, spread: 3.5, life: [0.25, 0.5], size: [0.18, 0.05], sprite: ['flame0', 'flame1'], additive: true, color: 0xffffff, drag: 3 });
    ctx.sfx('shotgun_shot', P.muzzleWorld, 1, 0.96 + rnd.next() * 0.06);
    ctx.sfx('rev_hammer', P.muzzleWorld, 0.3, 0.7);
    P.heat = Math.min(1.6, P.heat + 0.5);
    // recoil: the gun bucks, the view jumps, the board gets shoved in the air
    this.kickV += 9;
    P.gunKick.kick(24);
    const side = rnd.next() - 0.5;
    P.cam.punch(F.punch * T.recoilMul * (1 - ads * 0.35), side * 0.02, 3.2, side * 0.02);
    P.cam.addTrauma(F.trauma);
    if (!P.board.grounded) {
      P.board.impulse.x -= dc.x * F.shove;
      P.board.impulse.z -= dc.z * F.shove;
      P.board.impulse.y += Math.max(0, -dc.y) * F.shove + 1.2;
    }
    P.shotFeedback(firstHit, killed, !!headAt, headAt, dc, 1.3);
    P.onShot?.(firstHit);
    ctx.events.emit('shot', firstHit, venom);
  }

  private shootTommy() {
    const P = this.p;
    const ctx = this.ctx;
    const F = LONG_FEEL.tommy;
    const T = this.tune();
    P.ammo--;
    this.roundN++;
    const venom = P.venomRounds > 0;
    if (venom) P.venomRounds--;
    const tracerRound = Blueprints.hasUpgrade('up_drumfire') && this.roundN % 5 === 0;
    const ads = P.cam.aim;
    const r = this.rigs.tommy!;
    r.sockets['muzzle']?.getWorldPosition(P.muzzleWorld);
    this.spray = Math.min(40, this.spray + 1);
    this.sprayT = 0.16;
    const o = P.ray.o.clone();
    let d = this.jitter(P.ray.d, this.coneDeg());
    P.lastFireT = P.animTime;
    this.bloom = Math.min(F.bloomMax * T.spreadMul, this.bloom + F.bloom * T.recoilMul * (1 - ads * 0.5));
    let hit = ctx.enemies.raycast(o, d, F.range);
    if (!hit) {
      const md = P.magnetize(o, d);
      if (md) {
        const h2 = ctx.enemies.raycast(o, md, F.range);
        if (h2) {
          d = md;
          hit = h2;
        }
      }
    }
    const w = this.worldStop(o, d, F.range);
    const pierce = Math.round(P.stats.get('pierce'));
    const skip = new Set<number>();
    let last = o.clone().addScaledVector(d, w.t);
    let hits = 0;
    let firstHit: RayHit | null = null;
    let killed = false, headAt: THREE.Vector3 | null = null;
    P.shotCrit = false;
    const crit = T.critAdd;
    while (hit && hit.t < w.t && hits <= pierce) {
      firstHit ??= hit;
      const e = hit.enemy!;
      const h: Hit = {
        base: F.dmg * T.dmgMul * (venom ? 1.35 : 1),
        kind: 'phys',
        source: 'gun',
        headshot: hit.headshot,
        critBonus: crit,
        mult: ads > 0.6 && T.adsCritDmg > 0 && rnd.chance(P.stats.get('critChance')) ? 1 + T.adsCritDmg : 1,
        status: venom || tracerRound ? [{ id: 'poison', stacks: tracerRound ? 2 : 3, dur: 4, power: 2.2 }] : [],
        knock: F.knock * P.stats.get('knockback'),
        dirX: d.x,
        dirZ: d.z,
        tags: [hit.part],
      };
      const was = e.alive;
      ctx.enemies.damage(e, h, hit.point, d);
      if (was && !e.alive) killed = true;
      if (hit.headshot && !headAt) headAt = hit.point.clone();
      last = hit.point.clone();
      skip.add(e.id);
      hits++;
      hit = ctx.enemies.raycast(o, d, F.range, skip);
    }
    if (!firstHit && w.surface !== 'none') this.impact(last, w.surface, w.col, 0.7, this.roundN % 2 === 0, d);
    // flash, tracer (every other round), brass out of the port
    const col = venom || tracerRound ? 0xc8ff5a : 0xfff2a0;
    if (!T.quiet) ctx.fx.revolverMuzzle(P.muzzleWorld, d, col, true, P.board.vel);
    else ctx.particles.emit({ pos: P.muzzleWorld, count: 2, vel: { x: d.x * 2 + P.board.vel.x * 0.8, y: 0.3, z: d.z * 2 + P.board.vel.z * 0.8 }, spread: 0.4, life: [0.3, 0.6], size: [0.06, 0.24], sprite: ['puff1', 'puff2'], color: 0xcfc8bc, alpha: 0.35, drag: 3 });
    if (this.roundN % 2 === 0 || tracerRound || firstHit) ctx.fx.bulletTracer(P.muzzleWorld, last, tracerRound ? 0xb4ff52 : 0xffe2a0, !!firstHit);
    const ej = r.sockets['ejector']?.getWorldPosition(_v2) ?? P.muzzleWorld;
    const cf = P.cam.forward();
    ctx.fx.shells(ej, { x: -cf.z * 0.9, y: 0, z: cf.x * 0.9 }, 1, P.board.vel);
    if (this.roundN % 4 === 0) ctx.engine.tweens.after(0.3, () => ctx.sfx('shell_casing', P.pos, 0.3, 1.1 + rnd.next() * 0.2));
    if (T.quiet) {
      ctx.sfx('rev_hammer', P.muzzleWorld, 0.5, 0.62 + rnd.next() * 0.05);
      ctx.sfx('rifle_shot', P.muzzleWorld, 0.16, 1.7);
    } else ctx.sfx('rifle_shot', P.muzzleWorld, 0.62, 1.24 + rnd.next() * 0.08);
    P.heat = Math.min(1.6, P.heat + 0.06);
    this.boltBack = 1;
    // climbing recoil: the view walks up (and wanders) the longer the burst
    const k = Math.min(1, this.spray / 14);
    const climb = F.climb * (1 + (F.climbMax - 1) * k) * T.recoilMul * (1 - ads * 0.35);
    P.cam.nudge((rnd.next() - 0.5) * F.wander * T.recoilMul + Math.sin(this.spray * 0.55) * F.wander * 0.6 * k, climb);
    P.cam.punch(0.006 * T.recoilMul, (rnd.next() - 0.5) * 0.004, 0.25, (rnd.next() - 0.5) * 0.006);
    P.cam.addTrauma(0.025);
    this.kickV += 2.4;
    P.gunKick.kick(7);
    P.shotFeedback(firstHit, killed, !!headAt, headAt, d, 0.5);
    P.onShot?.(firstHit);
    ctx.events.emit('shot', firstHit, venom);
  }

  // ------------------------------------------------------------------ the pose
  /**
   * Layer the long-gun hold, the swap reach, the reload choreography and the
   * dig over the riding animation (call right after PlayerAnim.finish).
   */
  pose(dt: number, pa: PlayerAnim) {
    const P = this.p;
    const rig = P.rig;
    const n = rig.nodes;
    this.updateDropped(dt);
    // spring for the long-gun kick (separate from the revolver's wrist chain)
    this.kickV += (-this.kick * 260 - this.kickV * 22) * dt;
    this.kick += this.kickV * dt;
    const g = this.current;
    const gunRig = this.rigs[g];
    const wrapped = !!(this.ctx.enemies as unknown as { wrapping?: unknown }).wrapping;
    const free = P.alive && !P.action && !P.board.grapple.active && !P.status.stunned() && !wrapped;
    this.lw = damp(this.lw, this.isLong && free && !this.dig ? 1 : 0, 12, dt);
    this.digW = damp(this.digW, this.dig && P.alive ? 1 : 0, 9, dt);
    const s = this.swap;
    this.swW = s ? Math.sin(clamp(s.t / s.dur, 0, 1) * Math.PI) : damp(this.swW, 0, 14, dt);
    // shovel / gun visibility
    const digging = this.digW > 0.5;
    this.shovel.visible = digging;
    if (gunRig) gunRig.root.visible = !digging;
    this.updateMuzzle();
    if (this.lw < 0.005 && this.digW < 0.005 && this.swW < 0.005) {
      this.updateLaser();
      return;
    }
    const torso = n['torso'];
    const armR = n['arm_r'], foreR = n['fore_r'], armL = n['arm_l'], foreL = n['fore_l'];
    if (!torso || !armR || !foreR || !armL || !foreL) return;
    // the dig bends him over the hole
    if (this.digW > 0.001) torso.rotateX(0.42 * this.digW);
    torso.updateMatrixWorld(true);
    this.mT.copy(torso.matrixWorld).invert();
    torso.getWorldQuaternion(this.qT);
    this.upT.copy(UP).transformDirection(this.mT);
    this.aimT.copy(P.aimPoint).applyMatrix4(this.mT);
    const sc = pa.scale;
    const S_R = pa.shR, S_L = pa.shL, l1 = pa.l1Arm, l2 = pa.l2Arm;
    const R = P.reload;

    // ---------------------------------------------------------------- the long-gun hold
    const H = new THREE.Vector3();
    const D = new THREE.Vector3();
    const Up = this.upT.clone();
    const poleR = new THREE.Vector3(-0.85, -0.6, -0.3);
    let leftW = 1;
    let leftT: THREE.Vector3 | null = null;
    const poleL = new THREE.Vector3(0.55, -1, -0.15);
    if (this.lw > 0.001 && gunRig) {
      const aimW = pa.aimW, ads = P.cam.aim;
      // low ready → hip fire → shouldered
      H.set(S_R.x + 0.07 * sc, S_R.y - 0.42 * sc, S_R.z + 0.2 * sc);
      H.lerp(_v.set(S_R.x + 0.06 * sc, S_R.y - 0.33 * sc, S_R.z + 0.27 * sc), aimW);
      H.lerp(_v.set(S_R.x + 0.1 * sc, S_R.y - 0.13 * sc, S_R.z + 0.27 * sc), ads);
      const carry = _v2.set(0.42, -0.52, 1).normalize();
      const aimDir = _v3.copy(this.aimT).sub(H).normalize();
      D.copy(carry).lerp(aimDir, aimW).normalize();
      Up.lerp(_v.set(-0.35, 1, 0).normalize(), (1 - aimW) * 0.6).normalize();
      // ride the swell: sway with the board
      poleR.lerp(_v.set(-1, -0.35, -0.2), ads);
      // recoil: back into the shoulder and the muzzle climbs
      const kk = clamp(this.kick * 0.02, -0.3, 1);
      H.addScaledVector(D, -0.07 * kk * sc);
      D.addScaledVector(Up, 0.45 * kk).normalize();
      // the reload choreography
      if (R.active) {
        const k = R.t, ph = R.phase;
        const Hr = _v.set(S_R.x + 0.12 * sc, S_R.y - 0.33 * sc, S_R.z + 0.22 * sc);
        const rw = smooth(k / 0.08) * smooth((1 - k) / 0.08);
        H.lerp(Hr, rw);
        let dr = _v2.set(0.3, -0.3, 1).normalize();
        if (g === 'shotgun') {
          if (ph === 'eject') {
            const u = (k - 0.16) / 0.14;
            dr = _v2.set(0.3, -0.3 + Math.sin(u * Math.PI) * 0.9, 1).normalize(); // flick the empties out
          } else if (ph === 'close') {
            const u = (k - 0.84) / 0.16;
            dr = _v2.set(0.25, -0.3 + Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.75, 1).normalize(); // snap it shut
          }
        } else {
          dr = _v2.set(0.35, -0.2, 1).normalize();
          Up.lerp(_v3.set(-0.7, 0.7, 0).normalize(), rw * (ph === 'close' ? 0.2 : 0.65)).normalize(); // roll it to show the drum
        }
        D.lerp(dr, rw).normalize();
        if (R.jam > 0) {
          H.x += Math.sin(P.animTime * 41) * 0.015;
          D.y += Math.sin(P.animTime * 33) * 0.06;
        }
      }
      // the swap reach on the way out / in
      if (this.swW > 0.001 && s) this.reachHolster(H, s.t < s.dur * 0.5 ? s.from : s.to, S_R, sc);
      // solve the gun arm, then turn the gun onto the line
      this.solveArm(armR, foreR, S_R, H, poleR, Up, l1, l2, this.lw);
      gunRig.root.updateMatrixWorld(true);
      const want = lookQuat(D, Up, _q).premultiply(this.qT);
      const hq = this.holder.getWorldQuaternion(_q2).invert();
      gunRig.root.quaternion.slerp(hq.multiply(want), this.lw);
      gunRig.root.updateMatrixWorld(true);
      // the shotgun barrels tip open; the drum slides; the bolt rides back
      this.reloadParts(gunRig);
      // support hand: on the forend / foregrip, or busy with the reload
      leftT = this.supportTarget(gunRig, pa, sc);
      leftW = 1 - pa.grabW * 0.85;
    } else if (this.swW > 0.001 && s) {
      // the revolver in hand (riding anim on the arm): just the reach to the holster
      H.copy(rig.sockets['hand_r'].getWorldPosition(_v)).applyMatrix4(this.mT);
      this.reachHolster(H, s.t < s.dur * 0.5 ? s.from : s.to, S_R, sc);
      this.solveArm(armR, foreR, S_R, H, _v.set(-0.8, -0.7, -0.3), this.upT, l1, l2, this.swW);
    }

    // ---------------------------------------------------------------- the dig
    if (this.digW > 0.001 && this.dig) {
      const d = this.dig;
      d.t += dt;
      const ground = d.at.clone().applyMatrix4(this.mT);
      const c = (d.t * 1.25) % 1;
      // the blade: up, in, lever, throw to the right, back
      const tip = new THREE.Vector3();
      const up = _v.copy(this.upT);
      const raise = (k: number) => ground.clone().addScaledVector(up, k);
      const fwd = _v2.set(0, 0, 1);
      const right = _v3.set(-1, 0, 0);
      if (c < 0.38) tip.copy(raise(0.42)).lerp(raise(-0.14), smooth(c / 0.38));
      else if (c < 0.62) tip.copy(raise(-0.14)).lerp(raise(0.32).addScaledVector(fwd, 0.08), smooth((c - 0.38) / 0.24));
      else if (c < 0.78) tip.copy(raise(0.32).addScaledVector(fwd, 0.08)).lerp(raise(0.6).addScaledVector(right, 0.42), smooth((c - 0.62) / 0.16));
      else tip.copy(raise(0.6).addScaledVector(right, 0.42)).lerp(raise(0.42), smooth((c - 0.78) / 0.22));
      // throw the sand at the top of the swing; a crunch on the way in
      const ph = c < 0.38 ? 0 : c < 0.7 ? 1 : 2;
      if (ph !== this.digPhase) {
        this.digPhase = ph;
        const w = tip.clone().applyMatrix4(torso.matrixWorld);
        if (ph === 1) {
          this.ctx.sfx('footstep_sand', w, 0.7, 0.7);
          this.ctx.fx.sandBurst({ x: d.at.x, y: d.at.y + 0.05, z: d.at.z }, 0.35);
        }
        if (ph === 2) {
          const rw = right.clone().transformDirection(torso.matrixWorld);
          this.ctx.sfx('sand_spray', w, 0.55, 1.1 + rnd.next() * 0.2);
          this.ctx.particles.emit({ pos: w, count: 22, vel: { x: rw.x * 4 + 0, y: 3.5, z: rw.z * 4 }, spread: 1.6, jitter: 1, gravity: 11, drag: 0.6, life: [0.5, 1.1], size: [0.05, 0.11], sprite: ['dot3', 'dot3', 'puff0'], color: [0xf0d29a, 0xe3bd80, 0xd6a968, 0xfbe6b8], ground: true });
          this.ctx.particles.emit({ pos: w, count: 3, vel: { x: rw.x * 1.5, y: 0.8, z: rw.z * 1.5 }, spread: 0.6, life: [0.7, 1.2], size: [0.3, 0.8], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.5, drag: 2 });
          this.ctx.events.emit('digScoop', d.at);
        }
      }
      // grip high (D-handle, right hand), the left hand down the shaft
      const G0 = new THREE.Vector3(S_R.x + 0.16 * sc, S_R.y - 0.12 * sc, S_R.z + 0.3 * sc);
      const L = 0.62;
      const G = tip.clone().add(G0.clone().sub(tip).normalize().multiplyScalar(L));
      const shaft = tip.clone().sub(G).normalize();
      this.solveArm(armR, foreR, S_R, G, _v.set(-0.8, -0.5, -0.4), this.upT, l1, l2, this.digW);
      // the shovel root rides the right fist; aim its shaft at the blade
      armR.updateMatrixWorld(true);
      const want = lookQuat(shaft, this.upT, _q).premultiply(this.qT);
      const hq = this.holder.getWorldQuaternion(_q2).invert();
      this.shovel.quaternion.copy(hq.multiply(want));
      this.shovel.position.set(0, 0, 0);
      leftT = G.clone().addScaledVector(shaft, 0.3);
      leftW = 1;
      poleL.set(0.8, -0.6, -0.2);
    }

    // ---------------------------------------------------------------- the support hand
    const lwt = Math.max(this.lw, this.digW) * leftW;
    if (leftT && lwt > 0.001) this.solveArm(armL, foreL, S_L, leftT, poleL, this.upT, l1, l2, lwt);
    this.updateMuzzle();
    this.updateLaser();
  }

  private solveArm(arm: THREE.Object3D, fore: THREE.Object3D, S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, hint: THREE.Vector3, l1: number, l2: number, w: number) {
    armIK(S, T, pole, l1, l2, hint, _q, _q2);
    arm.quaternion.slerp(_q, w);
    fore.quaternion.slerp(_q2, w);
    arm.updateMatrixWorld(true);
  }

  /** bend the hand target toward where the gun is put away / drawn from */
  private reachHolster(H: THREE.Vector3, g: GunId, S_R: THREE.Vector3, sc: number) {
    const w = this.swW;
    if (g === 'revolver') {
      const hip = this.hip.getWorldPosition(_v).applyMatrix4(this.mT);
      H.lerp(hip.add(_v2.set(0, 0.06, 0.03)), w * 0.9);
    } else H.lerp(_v.set(S_R.x + 0.04 * sc, S_R.y + 0.12 * sc, S_R.z - 0.12 * sc), w * 0.85);
  }

  /** the support hand's target (torso frame) for the hold and the reload */
  private supportTarget(r: RigInstance, pa: PlayerAnim, sc: number): THREE.Vector3 {
    const P = this.p;
    const R = P.reload;
    const sock = (name: string) => r.sockets[name]?.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.mT) ?? null;
    const grip = sock('grip_l') ?? new THREE.Vector3(pa.shL.x, pa.shL.y - 0.3 * sc, pa.shL.z + 0.4 * sc);
    this.handShell.visible = false;
    this.handDrum.visible = false;
    if (!R.active) return grip;
    const k = R.t, ph = R.phase;
    // the left hip (belt shells, the spare drum)
    const pel = P.rig.nodes['pelvis'];
    const belt = pel ? pel.localToWorld(new THREE.Vector3(0.15 * sc, -0.02 * sc, 0.13 * sc)).applyMatrix4(this.mT) : grip.clone();
    if (this.current === 'shotgun') {
      if (ph !== 'insert') return grip;
      const need = Math.max(1, this.reloadNeed);
      const u = ((k - 0.3) / 0.54) * need;
      const s = u - Math.floor(u);
      const breech = sock('ejector') ?? grip;
      breech.addScaledVector(this.upT, 0.03);
      // to the belt for a shell, then thumbed into the chamber
      const t = new THREE.Vector3();
      if (s < 0.45) t.copy(grip).lerp(belt, smooth(s / 0.3));
      else t.copy(belt).lerp(breech, smooth((s - 0.45) / 0.35));
      this.handShell.visible = s > 0.25 && s < 0.88;
      return t;
    }
    // tommy: pull the drum, toss it, a fresh one off the hip, slap it in, rack the knob
    const drum = sock('drum_l') ?? grip;
    const knob = sock('bolt_knob') ?? grip;
    if (ph === 'open') return grip.clone().lerp(drum, smooth(k / 0.12));
    if (ph === 'eject') {
      const u = (k - 0.16) / 0.18;
      this.drumOff = smooth(u / 0.55) * 0.07;
      const away = drum.clone().addScaledVector(_v.set(1, -0.3, 0).normalize(), smooth((u - 0.5) / 0.5) * 0.14);
      return away;
    }
    if (ph === 'insert') {
      const u = (k - 0.34) / 0.46;
      this.drumOff = 0.07 * (1 - smooth((u - 0.7) / 0.3));
      this.handDrum.visible = u > 0.2 && u < 0.62;
      if (u > 0.6 && this.drumGone && r.nodes['drum']) {
        r.nodes['drum'].visible = true;
        this.drumGone = false;
      }
      if (!this.handDrum.children.length) {
        const big = this.tunes.tommy.magAdd > 0;
        const m = new THREE.Mesh(staticGeo(big ? 'drumC' : 'drumL', () => ({ model: tommyDrum(big).m, voxelSize: LONG_VS, pivot: [0, 0, 0] as [number, number, number] })), P.material);
        m.position.set(0, -0.04, 0.02);
        m.rotation.set(0, 0, Math.PI / 2);
        this.handDrum.add(m);
      }
      if (u < 0.25) return drum.clone().lerp(belt, smooth(u / 0.25));
      if (u < 0.6) return belt.clone().lerp(drum.clone().addScaledVector(_v.set(1, 0, 0), 0.07), smooth((u - 0.25) / 0.35));
      return drum;
    }
    // close: rack the bolt and back to the foregrip
    const u = (k - 0.8) / 0.2;
    if (u < 0.6) {
      this.boltBack = Math.max(this.boltBack, Math.sin(clamp((u - 0.2) / 0.4, 0, 1) * Math.PI));
      return grip.clone().lerp(knob, smooth(u / 0.25));
    }
    return knob.clone().lerp(grip, smooth((u - 0.6) / 0.4));
  }

  /** the moving parts the reload drives */
  private reloadParts(r: RigInstance) {
    const R = this.p.reload;
    const n = r.nodes;
    if (this.current === 'shotgun') {
      let open = 0;
      if (R.active) {
        const k = R.t;
        open = k < 0.16 ? smooth(k / 0.12) : k < 0.84 ? 1 : 1 - smooth((k - 0.84) / 0.06);
        if (k > 0.86) this.hammerCock = [1, 1];
      }
      if (n['barrels']) n['barrels'].rotation.x = 0.62 * open;
      if (n['lever']) n['lever'].rotation.y = -0.5 * Math.min(1, open * 3);
    } else {
      const d = n['drum'];
      if (d) {
        const base = r.geo.parts[r.geo.index['drum']].offset;
        // gun-local +X is the left flank: the drum slides out that way
        d.position.set(base.x + this.drumOff / 1, base.y, base.z);
      }
      const b = n['bolt'];
      if (b) {
        const base = r.geo.parts[r.geo.index['bolt']].offset;
        b.position.set(base.x, base.y, base.z - this.boltBack * 0.045);
      }
    }
  }

  /** the muzzle point the effects come from (sockets beat the meta for the long guns) */
  private updateMuzzle() {
    if (!this.isLong) return;
    const r = this.rigs[this.current];
    const s = r?.sockets[this.current === 'shotgun' ? (this.barrel === 0 ? 'muzzle_r' : 'muzzle_l') : 'muzzle'];
    if (s) {
      r!.root.updateMatrixWorld(true);
      s.getWorldPosition(this.p.muzzleWorld);
    }
  }

  private updateLaser() {
    const P = this.p;
    const T = this.tune();
    const r = this.rigs[this.current];
    let on = T.laser && P.alive && !this.dig && !this.swap && !!r;
    if (on) {
      if (this.current === 'revolver') {
        if (!this.revLaser) on = false;
        else this.revLaser.localToWorld(this.laserFrom.set(0, 0, 0.03));
      } else {
        const s = r!.sockets['laser'];
        if (!s) on = false;
        else s.getWorldPosition(this.laserFrom);
      }
    }
    this.laserLine.visible = on;
    if (!on) return;
    const to = _v.copy(P.aimPoint);
    if (to.distanceTo(this.laserFrom) > 90) to.sub(this.laserFrom).setLength(90).add(this.laserFrom);
    const pos = this.laserLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, this.laserFrom.x, this.laserFrom.y, this.laserFrom.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    if (P.aimHit) this.ctx.particles.emit({ pos: to, count: 1, life: [0.035, 0.035], size: [0.16, 0.16], sprite: 'glow16', additive: true, color: 0xff3020, alpha: 0.9, sizeJitter: 0 });
  }

  /** a scope widens the ADS zoom (camera's scope channel) */
  scopeFor(dt: number) {
    const P = this.p;
    const want = this.tune().zoom && P.aiming && !this.swap ? 1 : 0;
    P.cam.scope = damp(P.cam.scope, want, want ? 10 : 8, dt);
  }

  dispose() {
    for (const o of this.offs) o();
    this.laserLine.removeFromParent();
    for (const d of this.dropped) d.obj.removeFromParent();
    this.dropped = [];
  }
}
