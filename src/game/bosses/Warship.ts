// THE GOLDEN LEVIATHAN — the flagship of Cleopatra's river fleet, commanded from
// the aft castle by ADMIRAL APIS (models/nile/warship.ts). She sails the river
// beside the hunter; the fight is a running battle along her hull: dodge the
// broadsides, shoot out her gun ports and steering oars, board her and clear the
// deck, and finally bring down the admiral. Moves (Rolling Stones / GN'R / Beatles):
//   Madagascar                 the entrance: fog of gun smoke parts, the flagship
//                              swings broadside, every gun run out at once
//   Revolution                 a broadside: the guns facing the hunter fire bow to
//                              stern down lanes across the water
//   Can't You Hear Me Knocking the forecastle mortars lob shells onto marked rings
//   Rough Justice              (66%) she turns and rams: a wide lane, then the bronze
//                              snout; a missed ram leaves the steering oars exposed
//   All Together Now           boarding parties: reed skiffs put out, fresh soldiers
//                              take the deck
//   Taxman                     (33%) the admiral sounds his war horn: every crewman
//                              shoots at once and both mortars fire
//   Chinese Democracy          (33%) enraged: fire on deck, faster broadsides, both sides
// Weak points: each gun port (destroy it to silence it, a big chunk of her hp),
// the steering oars (x1.6, x2.4 after a missed ram), the admiral (x2.2).
// Her crew are ordinary soldiers standing on the deck (the Nile fleet carries them);
// the deck is a real floor: jump aboard from a wave.
import * as THREE from 'three';
import { Boss, BossDeps } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import { NileFleet, type Hull } from '../enemies/NileFleet';
import { ENEMIES, waveScale, type EnemyDef } from '../enemies/EnemyDefs';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { RigEyes } from '../fx/FaceFx';
import { warshipGeo, warshipGeoNow } from './nile/warshipGeo';
import { clamp, damp, rnd } from '../../engine/math/rand';

const COL = '#ffc860';
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();

interface Port {
  part: string;
  side: 1 | -1;
  node: THREE.Object3D;
  hp: number;
  max: number;
  broken: boolean;
  recoil: number;
  rest: THREE.Vector3;
}

export class Warship extends Boss {
  private fleet: NileFleet;
  private ownFleet = false;
  private hull: Hull | null = null;
  private admiral: RigInstance | null = null;
  private ports: Port[] = [];
  private tierN: number;
  private enraged = false;
  private exposedT = 0;
  private boardCd = 0;
  private lastCallout = '';
  private hornT = 0;
  private sinkingT = -1;
  private readonly def: EnemyDef;
  dbg = '';

  constructor(d: BossDeps, tier = 1) {
    // the base builds a cheap placeholder; the galley (built off-thread, warmed waves early) is swapped in
    super(d, 'nile_warship_placeholder', { name: 'The Golden Leviathan', title: "Flagship of the Queen's River", hp: 5600 * tier, scale: 1, eyes: ['glow', 0xffc040] });
    const old = this.rig;
    this.root.remove(old.root);
    old.material.dispose();
    this.rig = new RigInstance(warshipGeo() ?? warshipGeoNow(), { ownMaterial: true });
    this.root.add(this.rig.root);
    this.eyes = new RigEyes(this.rig, 'glow', 0xffc040);
    this.tierN = tier;
    this.flying = true;
    this.radius = 5;
    this.height = 12;
    this.armor = 40;
    this.physRes = 0.15;
    this.magicRes = 0.05;
    this.statusRes = { poison: 1, bleed: 1, burn: -0.3 };
    this.bounty = 460 * tier;
    this.gold = 180 * tier;
    this.phases = [0.66, 0.33];
    this.def = { ...(ENEMIES.warBarge as EnemyDef), id: 'nileFlagship', name: 'The Golden Leviathan', hp: this.maxHp, radius: 6, height: 12, moveTitles: { broadside: 'Revolution' } };
    // the run's fleet carries her crew and her deck (a fleet of her own outside the Nile stage)
    let f = NileFleet.current;
    if (!f) {
      f = new NileFleet({ ctx: d.ctx, player: d.player as any, enemies: d.enemies });
      this.ownFleet = true;
    }
    this.fleet = f;
    const meta = this.rig.geo.spec.meta ?? {};
    for (const p of (meta.ports as { part: string; side: number }[]) ?? []) {
      const node = this.rig.nodes[p.part];
      if (!node) continue;
      this.ports.push({ part: p.part, side: p.side as 1 | -1, node, hp: this.maxHp * 0.05, max: this.maxHp * 0.05, broken: false, recoil: 0, rest: node.position.clone() });
    }
    this.hitSpheres = [
      ...this.ports.map((p) => ({ node: p.part, offset: [p.side * 1.3, 0, 0] as [number, number, number], r: 0.95, part: p.part, weak: 1.4 })),
      { node: 'rudder_l', offset: [0.4, -2.6, -2.4], r: 1.2, part: 'rudder', weak: 1.6 },
      { node: 'rudder_r', offset: [-0.4, -2.6, -2.4], r: 1.2, part: 'rudder', weak: 1.6 },
      { node: 'hull', offset: [0, 1.4, 8], r: 3.6, part: 'hull' },
      { node: 'hull', offset: [0, 1.4, 0], r: 3.8, part: 'hull' },
      { node: 'hull', offset: [0, 1.4, -8], r: 3.6, part: 'hull' },
      { node: 'bow', offset: [0, 1.2, 9], r: 2.8, part: 'hull' },
      { node: 'stern', offset: [0, 2.0, -9], r: 2.8, part: 'hull' },
      { node: 'mast', offset: [0, 6, 0], r: 0.9, part: 'mast' },
    ];
    // the admiral on the aft castle
    const as = modelEntry('nile_admiral')?.() as RigSpec | undefined;
    if (as?.parts) {
      this.admiral = new RigInstance(buildRigGeo(as, 'boss:nile_admiral'), { ownMaterial: true });
      const at = (meta.admiral as number[]) ?? [0, 3.8, -12.7];
      this.admiral.root.position.set(at[0], at[1], at[2]);
      this.root.add(this.admiral.root);
      this.admiral.setExpression('smug');
    }
    if (!d.enemies.qte) d.enemies.qte = d.qte;
  }

  protected hitKind() {
    return 'wood' as any;
  }

  // ------------------------------------------------------------------ placement: on the river
  place(x: number, z: number, yaw = 0) {
    const pp = this.playerPos();
    const at = this.fleet.findWater(x, z, 2.2, 26) ?? this.fleet.findWater(pp.x, pp.z, 2.2, 24) ?? { x, z };
    // broadside on to the hunter, heading along the river where there is one
    const to = Math.atan2(pp.x - at.x, pp.z - at.z);
    let hd = to + Math.PI / 2;
    const riv = this.fleet.riverAt(at.x, at.z, { u: 0, hw: 0, tx: 0, tz: 1 });
    if (riv) {
      const a = Math.atan2(riv.tx, riv.tz);
      hd = Math.abs(Math.atan2(Math.sin(a - hd), Math.cos(a - hd))) < Math.PI / 2 ? a : a + Math.PI;
    }
    this.pos.set(at.x, this.fleet.waterAt(at.x, at.z), at.z);
    this.yaw = hd;
    this.hull = this.fleet.adopt(this.def, this.rig.geo.spec, at.x, at.z, hd, { rig: this.rig, root: this.root, hp: this.maxHp });
    this.hull.goalSpeed = 0;
    // her crew
    this.fleet.crewUp(this.hull, ['nileRam', 'nileFalcon', 'nileFalcon', 'nileBaboon', 'nileBaboon', 'nileFalcon', 'nileWolf', 'nileJackalSpear', 'nileWolf', 'nileHippo', 'nileFalcon'].slice(0, 7 + this.tierN * 2));
    void yaw;
  }

  // ------------------------------------------------------------------ helpers
  private get warn() {
    return this.d.enemies.warn;
  }
  private get haste() {
    return (1 - this.phase * 0.12) * (1 - (this.tierN - 1) * 0.07) * (this.enraged ? 0.82 : 1);
  }
  private callout(song: string, big = true) {
    this.dbg = song;
    const pos = { x: this.pos.x, y: this.pos.y + this.height, z: this.pos.z };
    this.d.enemies.callout(song, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title: song, enemy: this, pos, tier: 'boss' });
    if (big && song !== this.lastCallout) {
      this.lastCallout = song;
      this.ctx.toast(`« ${song} »`, COL, 'The Golden Leviathan');
      this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
    }
  }
  /** the admiral's lines hang over his head */
  private admiralSays(text: string) {
    if (!this.admiral) return this.taunt(text, COL);
    this.admiral.root.updateWorldMatrix(true, false);
    const p = this.admiral.root.getWorldPosition(new THREE.Vector3());
    const save = this.pos.clone(), h = this.height;
    this.pos.copy(p);
    this.height = 2.4;
    this.taunt(text, COL);
    this.pos.copy(save);
    this.height = h;
  }
  private sockW(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    this.root.updateMatrixWorld(true);
    if (s) s.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + 3, this.pos.z);
    return out;
  }
  /** which side of her the hunter is on (+1 port / left, -1 starboard / right) */
  private hunterSide() {
    const dx = this.player.pos.x - this.pos.x, dz = this.player.pos.z - this.pos.z;
    const lx = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
    return lx >= 0 ? 1 : -1;
  }
  private dmgK() {
    return waveScale(this.d.enemies.wave).dmg;
  }
  /** a cannon ball from a muzzle socket to land on `at` after T s */
  private ball(from: THREE.Vector3, at: THREE.Vector3, T: number, dmg: number) {
    const g = 14;
    const vx = (at.x - from.x) / T, vz = (at.z - from.z) / T, vy = (at.y - from.y) / T + 0.5 * g * T;
    this.d.enemies.proj.spawn({ kind: 'cannon', x: from.x, y: from.y, z: from.z, vx, vy, vz, dmg, life: T + 2, sourceId: this.id, r: 0.55 });
    const ctx = this.ctx;
    const l = Math.hypot(vx, vz) || 1;
    ctx.fx.muzzle(from, { x: vx / l, y: 0.1, z: vz / l }, 0xffd890, true);
    ctx.fx.light(from, 0xffb050, 7, 0.2, 16);
    ctx.particles.emit({ pos: from, count: 10, vel: { x: (vx / l) * 5, y: 1, z: (vz / l) * 5 }, spread: 1.6, life: [0.9, 1.8], size: [0.8, 2.0], sprite: ['puff0', 'puff1', 'cloud0'], color: [0xd8d0c4, 0xb8b0a4, 0x9a9288], alpha: 0.7, drag: 1.5, rot: 6, rotSpeed: 0.5 });
    ctx.sfx('explosion_big', from, 0.6, 1.3);
    ctx.shake(0.12);
  }

  // ------------------------------------------------------------------ steering
  /** sail on beside the hunter at a standoff, keeping him abeam */
  private async sailBeside(t: number, R = 20, speed = 7) {
    const h = this.hull;
    if (!h) return this.wait(t);
    for (let k = 0; k < t; k += 0.25) {
      const pp = this.playerPos();
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const side = this.hunterSide();
      // the point R off the hunter on our side, 26 m further along our heading
      const nx = Math.cos(this.yaw) * side, nz = -Math.sin(this.yaw) * side;
      h.goal = { x: pp.x - nx * R + fx * 26, z: pp.z - nz * R + fz * 26 };
      h.goalSpeed = speed * (this.enraged ? 1.2 : 1);
      await this.wait(0.25);
    }
  }

  // ------------------------------------------------------------------ intro: "Madagascar"
  async intro() {
    const ctx = this.ctx, cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    const pp = this.playerPos().clone();
    const toS = new THREE.Vector3(this.pos.x - pp.x, 0, this.pos.z - pp.z).normalize();
    const side = new THREE.Vector3(toS.z, 0, -toS.x);
    // a low wide shot across the water: smoke on the river, the flagship emerging from it
    const camAt = pp.clone().addScaledVector(toS, -6).addScaledVector(side, 5);
    camAt.y = this.fleet.surfaceAt(camAt.x, camAt.z) + 2.2;
    for (let i = 0; i < 18; i++) {
      const a = rnd.next() * Math.PI * 2, r = 4 + rnd.next() * 14;
      ctx.particles.emit({ pos: { x: this.pos.x + Math.sin(a) * r, y: this.pos.y + 1 + rnd.next() * 4, z: this.pos.z + Math.cos(a) * r }, count: 2, spread: 3, up: 0.4, life: [3, 5], size: [3, 7], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0xd8d0c4, 0xc8c0b4, 0xe8e2d8], alpha: 0.7, drag: 0.6, rot: 6, rotSpeed: 0.1 });
    }
    cam.setCine({ pos: camAt, look: new THREE.Vector3(this.pos.x, this.pos.y + 5, this.pos.z), fov: 50 });
    ctx.sfx('quake_rumble', this.pos, 0.8, 0.45);
    // she glides out of the smoke and swings broadside on
    if (this.hull) {
      this.hull.goalSpeed = 4;
      this.hull.goal = { x: this.pos.x + Math.sin(this.yaw) * 40, z: this.pos.z + Math.cos(this.yaw) * 40 };
    }
    this.callout('Madagascar');
    await this.wait(1.8);
    // the admiral steps to the rail; the close shot
    if (this.admiral) {
      this.admiral.root.updateWorldMatrix(true, false);
      const ap = this.admiral.root.getWorldPosition(new THREE.Vector3());
      const close = ap.clone().addScaledVector(toS, -7).addScaledVector(side, -3).add(new THREE.Vector3(0, 1.4, 0));
      cam.setCine({ pos: close, look: ap.clone().add(new THREE.Vector3(0, 2, 0)), fov: 42 });
      this.admiral.setExpression('laugh');
      this.hornT = 1.6;
      ctx.sfx('boss_roar', ap, 1, 1.35);
      this.admiralSays('Run out the guns. The Queen wants her river back clean.');
    }
    ctx.events.emit('bossIntro', this);
    await this.wait(1.6);
    // every gun runs out and fires a salute over the hunter's head
    cam.setCine({ pos: camAt, look: new THREE.Vector3(this.pos.x, this.pos.y + 3, this.pos.z), fov: 54 });
    const side0 = this.hunterSide();
    for (const p of this.ports) {
      if (p.side !== side0) continue;
      const m = this.sockW(p.part + '_muzzle', new THREE.Vector3());
      const over = pp.clone().addScaledVector(toS, -14).add(new THREE.Vector3((rnd.next() - 0.5) * 10, 0, (rnd.next() - 0.5) * 10));
      over.y = this.fleet.surfaceAt(over.x, over.z);
      this.ball(m, over, 1.4, 0);
      p.recoil = 1;
      await this.wait(0.16);
    }
    await this.wait(1.0);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
    this.admiral?.setExpression('angry');
    ctx.toast('THE GOLDEN LEVIATHAN', COL, 'Shoot out her gun ports. Board her. Bring down the admiral.', true);
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    let last = '';
    while (true) {
      this.check();
      await this.sailBeside((2.2 + rnd.next() * 1.4) * this.haste);
      this.boardCd -= 1;
      const p = this.phase;
      const pool: [string, number][] = [
        ['revolution', 3],
        ['knocking', 2],
        ['ram', p >= 1 ? 1.6 : 0],
        ['board', p >= 1 && this.boardCd <= 0 ? 1.6 : 0],
        ['taxman', p >= 2 ? 1.4 : 0],
      ];
      const k = rnd.weighted(pool.filter(([n, w]) => w > 0 && n !== last), (o) => o[1])[0];
      last = k;
      if (k === 'revolution') await this.revolution();
      else if (k === 'knocking') await this.knocking();
      else if (k === 'ram') await this.roughJustice();
      else if (k === 'board') await this.allTogetherNow();
      else await this.taxman();
      if (this.enraged && rnd.chance(0.5)) await this.revolution(true);
    }
  }

  /** "Revolution": the guns facing the hunter fire bow to stern down lanes across the water */
  private async revolution(both = false) {
    const ctx = this.ctx;
    this.callout(both ? 'Chinese Democracy' : 'Revolution');
    if (this.hull) this.hull.goalSpeed = 3.5;
    const side = this.hunterSide();
    const guns = this.ports.filter((p) => !p.broken && (both || p.side === side)).sort((a, b) => b.rest.z - a.rest.z);
    if (!guns.length) return this.wait(0.5);
    const W = 1.05 * this.haste;
    const fired: Promise<void>[] = [];
    for (const p of guns) {
      const m = this.sockW(p.part + '_muzzle', new THREE.Vector3());
      _n.set(p.side, 0, 0).transformDirection(this.root.matrixWorld);
      _n.y = 0;
      _n.normalize();
      // the lane runs out from the port across the hunter's water
      const pp = this.playerPos();
      const along = Math.max(10, (pp.x - m.x) * _n.x + (pp.z - m.z) * _n.z + 5);
      const L = Math.min(42, along);
      this.warn.lane(m.x, m.z, _n.x, _n.z, L, 2.6, W, 'heavy');
      const nx = _n.x, nz = _n.z;
      fired.push(
        (async () => {
          await this.wait(W);
          if (p.broken) return;
          const from = this.sockW(p.part + '_muzzle', new THREE.Vector3());
          const at = new THREE.Vector3(from.x + nx * L, 0, from.z + nz * L);
          at.y = this.fleet.surfaceAt(at.x, at.z);
          this.ball(from, at, 0.75 + L / 60, 20 * this.dmgK());
          p.recoil = 1;
        })()
      );
      ctx.sfx('dynamite_fuse', m, 0.4, 1.2);
      await this.wait(0.32 * this.haste);
    }
    await Promise.all(fired);
    await this.wait(0.6 * this.haste);
  }

  /** "Can't You Hear Me Knocking": the forecastle mortars lob shells onto rings around the hunter */
  private async knocking() {
    this.callout("Can't You Hear Me Knocking");
    const n = 4 + this.phase * 2;
    const T = 2.0;
    for (let i = 0; i < n; i++) {
      const v = this.player.board.vel;
      const lead = T + 0.6;
      const at = new THREE.Vector3(this.player.pos.x + v.x * lead * 0.75 + (rnd.next() - 0.5) * 7, 0, this.player.pos.z + v.z * lead * 0.75 + (rnd.next() - 0.5) * 7);
      at.y = this.fleet.surfaceAt(at.x, at.z);
      this.warn.circle(at.x, at.z, 3.3, T + 0.6, 'heavy');
      const which = i % 2 ? 'mortar_2' : 'mortar_1';
      this.ctx.engine.tweens.after(0.6, () => {
        if (!this.alive) return;
        const from = this.sockW(which + '_muzzle', new THREE.Vector3());
        this.ball(from, at, T, 22 * this.dmgK());
      });
      await this.wait(0.42 * this.haste);
    }
    await this.wait(1.4 * this.haste);
  }

  /** "Rough Justice": she turns on the hunter and rams */
  private async roughJustice() {
    const ctx = this.ctx;
    const h = this.hull;
    if (!h) return;
    this.callout('Rough Justice');
    this.admiral?.setExpression('enraged');
    this.admiralSays('Ramming speed!');
    // swing round toward the hunter
    for (let t = 0; t < 2.2; t += 0.2) {
      h.goal = { x: this.player.pos.x, z: this.player.pos.z };
      h.goalSpeed = 5;
      h.turnRate = 0.6;
      await this.wait(0.2);
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const W = 1.0 * this.haste;
    this.warn.lane(this.pos.x + dir.x * 14, this.pos.z + dir.z * 14, dir.x, dir.z, 40, 8, W, 'grab');
    ctx.sfx('boss_roar', this.pos, 0.9, 0.5);
    await this.wait(W);
    let hit = false;
    for (let t = 0; t < 3.0; t += 0.05) {
      h.goal = { x: this.pos.x + dir.x * 60, z: this.pos.z + dir.z * 60 };
      h.goalSpeed = 14;
      h.turnRate = 0.05;
      // the bronze snout through the water
      if (!hit && this.player.alive) {
        h.toLocal(this.player.pos, _v);
        const deck = (h.meta.deck as number[][])[0][4];
        if (Math.abs(_v.x) < 4.4 && Math.abs(_v.z) < 17 && _v.y < deck - 0.4) {
          hit = true;
          this.player.takeHit({ base: 32 * this.dmgK(), kind: 'phys', source: 'contact', knock: 16 }, this.pos);
          _w.set(Math.sign(_v.x || 1), 0, 0).transformDirection(this.root.matrixWorld).multiplyScalar(14).setY(6);
          this.player.board.impulse.add(_w);
          ctx.shake(0.7);
          ctx.sfx('crate_break', this.player.pos, 1, 0.5);
          this.fleet.splash(this.player.pos.x, this.player.pos.z, 2.2);
        }
      }
      if (rnd.chance(0.5)) {
        _v.set((rnd.next() - 0.5) * 3, 0, 17).applyMatrix4(this.root.matrixWorld);
        this.fleet.splash(_v.x, _v.z, 1.2);
      }
      await this.wait(0.05);
    }
    h.turnRate = 0;
    h.goalSpeed = 3;
    this.admiral?.setExpression('angry');
    if (!hit) {
      // she overshoots: the steering oars are open
      this.exposedT = 4.5;
      const top = this.sockW('admiral', new THREE.Vector3());
      this.d.enemies.callout('OPENING!', { x: top.x, y: top.y + 3, z: top.z }, 'elite');
      ctx.toast('HER STEERING OARS ARE EXPOSED', '#ffd36b', 'Hit the stern', true);
      ctx.sfx('counter_clang', this.pos, 0.8, 0.6);
    }
    await this.wait(0.8);
  }

  /** "All Together Now": boarding parties put out in skiffs, fresh soldiers take the deck */
  private async allTogetherNow() {
    this.callout('All Together Now');
    this.boardCd = 4;
    this.hornT = 1.4;
    this.ctx.sfx('boss_roar', this.pos, 0.8, 1.4);
    const pp = this.playerPos();
    for (let i = 0; i < 2; i++) {
      const a = rnd.next() * Math.PI * 2;
      this.d.enemies.spawn('reedBoat', pp.x + Math.sin(a) * 24, pp.z + Math.cos(a) * 24);
    }
    if (this.hull) this.fleet.crewUp(this.hull, ['nileWolf', 'nileJackalSpear', 'nileFalcon']);
    await this.wait(1.2);
  }

  /** "Taxman": the admiral's war horn, every crewman shoots, both mortars fire */
  private async taxman() {
    this.callout('Taxman');
    this.hornT = 1.8;
    this.admiralSays('Pay the river toll, hunter. In full.');
    this.ctx.sfx('boss_roar', this.pos, 1, 1.5);
    this.ctx.shake(0.4);
    await this.wait(0.8);
    for (const c of this.hull?.crew ?? []) for (let k = 0; k < c.e.cds.length; k++) c.e.cds[k] = Math.min(c.e.cds[k], rnd.next() * 0.6);
    await this.knocking();
  }

  // ------------------------------------------------------------------ damage
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || this.sinkingT >= 0) return null;
    let best = super.hitTest(o, d, maxT);
    // the admiral
    const a = this.admiral;
    if (a) {
      const n = a.nodes['torso'] ?? a.root;
      n.updateWorldMatrix(true, false);
      const c = n.getWorldPosition(_v).add(_w.set(0, 0.6, 0));
      const r = 0.9;
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
      if (disc >= 0) {
        let t = -b - Math.sqrt(disc);
        if (t < 0) t = -b + Math.sqrt(disc);
        if (t >= 0 && t < (best?.t ?? maxT)) {
          const point = o.clone().addScaledVector(d, t);
          best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: true, part: 'admiral', surface: 'enemy' };
        }
      }
    }
    // broken ports no longer catch shots
    if (best && best.part.startsWith('port_') && this.ports.find((p) => p.part === best!.part)?.broken) best = { ...best, part: 'hull', headshot: false };
    return best;
  }

  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive || this.sinkingT >= 0) return 0;
    const part = hit.tags?.[0] ?? '';
    let mult = 1;
    // a hull shrugs off bullets and splinters under blasts
    if (hit.source === 'explosion') mult *= 1.8;
    else if ((hit.source === 'gun' || hit.source === 'projectile') && (part === 'hull' || part === '' || part === 'mast')) mult *= 0.55;
    if (part === 'admiral') {
      mult *= 2.2;
      if (this.admiral && rnd.chance(0.4)) this.admiral.setExpression('hurt');
    }
    if (part === 'rudder' && this.exposedT > 0) mult *= 1.5;
    const port = this.ports.find((p) => p.part === part && !p.broken);
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * mult }, point, dir);
    if (port && amt > 0) {
      port.hp -= amt;
      if (port.hp <= 0) this.breakPort(port);
    }
    return amt;
  }

  private breakPort(p: Port) {
    if (p.broken) return;
    p.broken = true;
    const ctx = this.ctx;
    const at = this.sockW(p.part + '_muzzle', new THREE.Vector3());
    ctx.fx.explosion({ x: at.x, y: at.y, z: at.z }, 2.6);
    ctx.sfx('explosion_big', at, 1, 0.8);
    ctx.shake(0.4);
    ctx.events.emit('gibs', at.x, at.y, at.z, 26, 0.14, [0x8a4a2a, 0x6a3a1e, 0xb87e3c, 0xe2aa62], 7, 5);
    this.rig.setPartVisible(p.part, false);
    this.d.enemies.callout('GUN SILENCED', { x: at.x, y: at.y + 1.5, z: at.z }, 'elite');
    // a gun port blown open costs her dearly
    super.takeDamage({ base: this.maxHp * 0.035, kind: 'true', source: 'explosion', canCrit: false });
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    if (p >= 2 && !this.enraged) {
      this.enraged = true;
      this.callout('Chinese Democracy');
      this.admiralSays('Burn her if you must, but sink that hunter!');
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    if (!this.root.visible && !this.alive) return;
    this.t += dt;
    this.hitT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.exposedT = Math.max(0, this.exposedT - dt);
    const tick = this.status.tick(dt, this.maxHp, true, true);
    if (tick && this.alive) {
      if (tick.burn > 0) this.takeDamage({ base: tick.burn, kind: 'magic', source: 'burn', canCrit: false });
    }
    // the fleet floats her (before the crew think); a fleet of her own is ticked here
    if (this.ownFleet) this.fleet.update(dt);
    const h = this.hull;
    if (h && h.alive) {
      this.pos.copy(h.pos);
      this.yaw = h.yaw;
      this.vel.copy(h.vel);
    }
    const fx = this.rig.material.userData.fx?.value;
    if (fx) fx.x = this.flash * 0.5;
    this.animateShip(dt);
    // fire on her deck once she is enraged / sinking
    if ((this.enraged || this.sinkingT >= 0) && rnd.chance(dt * 8)) {
      _v.set((rnd.next() - 0.5) * 5, 2.6, (rnd.next() - 0.5) * 22).applyMatrix4(this.root.matrixWorld);
      this.ctx.fx.flames({ x: _v.x, y: _v.y, z: _v.z }, 2, 1.4);
      if (rnd.chance(0.3)) this.ctx.particles.emit({ pos: { x: _v.x, y: _v.y + 1, z: _v.z }, count: 2, spread: 1, up: 1.6, life: [1.6, 2.6], size: [1.2, 2.6], sprite: ['cloud0', 'cloud1'], color: [0x3a3430, 0x5a524a], alpha: 0.6, drag: 0.8, rot: 6, rotSpeed: 0.3 });
    }
    // the sinking finale
    if (this.sinkingT >= 0) {
      this.sinkingT += dt;
      if (rnd.chance(dt * 3)) {
        _v.set((rnd.next() - 0.5) * 6, 2, (rnd.next() - 0.5) * 26).applyMatrix4(this.root.matrixWorld);
        this.ctx.fx.explosion({ x: _v.x, y: _v.y, z: _v.z }, 2 + rnd.next() * 2);
        this.ctx.sfx('explosion', _v, 0.8, 0.7 + rnd.next() * 0.3);
      }
      if (this.sinkingT > 6.5) this.finish();
    }
  }

  private animateShip(dt: number) {
    for (const p of this.ports) {
      p.recoil = damp(p.recoil, 0, 5, dt);
      p.node.position.x = p.rest.x - p.side * p.recoil * 0.5;
    }
    const a = this.admiral;
    if (!a) return;
    const n = a.nodes;
    const t = this.t;
    this.hornT = Math.max(0, this.hornT - dt);
    const horn = clamp(this.hornT / 0.4, 0, 1);
    // he paces the rail, the flail pointing the guns at the hunter
    a.root.rotation.y = Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z) - this.yaw;
    if (n['torso']) n['torso'].rotation.set(Math.sin(t * 1.3) * 0.05 - horn * 0.25, Math.sin(t * 0.6) * 0.15, 0);
    if (n['head']) n['head'].rotation.set(-horn * 0.5 + Math.sin(t * 1.7) * 0.06, Math.sin(t * 0.9) * 0.25, 0);
    if (n['arm_r']) n['arm_r'].rotation.set(-1.2 - Math.sin(t * 2.2) * 0.25, 0, -0.2);
    if (n['fore_r']) n['fore_r'].rotation.x = -0.4;
    if (n['arm_l']) n['arm_l'].rotation.set(-2.2 * horn - 0.2, 0, 0.2 + horn * 0.4);
    if (n['fore_l']) n['fore_l'].rotation.x = -1.6 * horn - 0.3;
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, a.exprJaw + horn * 0.3 + (this.hornT > 0 ? 0.1 : 0), 10, dt);
    if (n['tail']) n['tail'].rotation.y = Math.sin(t * 2.4) * 0.3;
  }

  // ------------------------------------------------------------------ death: she breaks and goes down
  die() {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    this.setExpr('defeated');
    this.admiral?.setExpression('defeated');
    this.admiralSays('Tell the Queen... the river took her...');
    ctx.engine.slowMo(0.2, 30);
    ctx.engine.tweens.after(1.4, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1);
    ctx.shake(0.9);
    ctx.engine.flash(0xfff2d0, 0.35, 0.6);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    this.sinkingT = 0;
    if (this.hull) {
      this.hull.goalSpeed = 0;
      this.hull.founder(false);
    }
    for (const n of ['bow', 'mast_sail', 'foremast']) if (this.rig.nodes[n]) this.ctx.engine.tweens.after(0.8 + rnd.next() * 2, () => this.rig.setPartVisible(n, false));
  }
  private finish() {
    if (!this.root.visible) return;
    const c = { x: this.pos.x, y: this.fleet.waterAt(this.pos.x, this.pos.z) + 1, z: this.pos.z };
    this.ctx.fx.coins(c, 40);
    this.root.visible = false;
    this.onDefeated?.(this, false);
    this.dispose();
  }

  dispose() {
    if (this.hull) this.hull.dispose();
    this.hull = null;
    this.root.removeFromParent();
    this.admiral?.material.dispose();
    this.d.enemies.unregisterExternal(this);
    if (this.ownFleet) this.fleet.dispose();
  }
}
