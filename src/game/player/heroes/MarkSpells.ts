// Mark's moon magic, on the shared tarot slots (learned from rank-up cards, empower
// ring, echo) and the ultimate slot. Every name is a song title:
//  E  SHINE A LIGHT (Rolling Stones): a pillar of moonlight drops on the reticle,
//     throws what stands in it off its feet and keeps burning the ones that stay.
//  C  BLACKBIRD (Beatles): an eclipse dash, a streak of black feathers and silver that
//     cuts through every body on the line, then GIMME SHELTER (Rolling Stones): a lunar
//     ward of circling moonlight that soaks up the next blows.
//  G  NOVEMBER RAIN (Guns N' Roses): crescent blades rain out of the night sky round the
//     reticle. Two charges.
//  Z  MR. MOONLIGHT (Beatles): night falls, the full moon rises behind him and answers
//     three timed calls with great moonbeams; the last one breaks into a crescent storm.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../../Ctx';
import type { Player } from '../Player';
import type { Qte, QteResult } from '../../ui/Qte';
import type { CameraRig } from '../CameraRig';
import type { HeroSpells, HeroUlt, SpellKey } from './HeroKit';
import { MarkKit, MOONLIGHT } from './MarkKit';
import { SKILL_INFO } from '../Skills';
import { UPGRADES } from '../../run/Upgrades';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { VF } from '../../../engine/voxel/VoxelModel';
import { moonCrestModel } from '../../models/characters/markGear';
import { sculpt, fbm3, h3 } from '../../ui/HudKit';
import { PRESETS, type EnvPreset } from '../../world/Env';
import { Ease } from '../../../engine/Tween';
import { clamp, rnd } from '../../../engine/math/rand';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const MARK_SPELLS = {
  beam: { cd: 9, delay: 0.4, radius: 3.2, dmg: 44, life: 1.7, tick: 0.35, tickDmg: 9, range: 34 },
  dash: { cd: 11, dur: 0.24, speed: 27, width: 1.9, dmg: 34, ward: 4, shield: 32 },
  rain: { recharge: 8, blades: 9, radius: 4.4, dmg: 22, hitR: 1.7, over: 1.1 },
};

/** the tarot texts while Mark rides (restored when the run ends) */
const TEXT: Record<SpellKey, { name: string; desc: string; lore: string }> = {
  E: { name: 'Shine a Light', desc: 'LEARN SHINE A LIGHT  [E]: a pillar of moonlight drops where you aim, throws the foes in it off their feet and keeps burning the ones that stay.', lore: 'The moon god keeps one lamp lit for his guardian.' },
  C: { name: 'Blackbird', desc: 'LEARN BLACKBIRD  [C]: an eclipse dash that cuts through everything on the line, then GIMME SHELTER, a lunar ward that soaks up the next blows.', lore: 'Take these broken wings, and cut.' },
  G: { name: 'November Rain', desc: 'LEARN NOVEMBER RAIN  [G]: crescent blades rain out of the night sky around where you aim. Two charges.', lore: 'Nothing lasts forever, even cold crescents.' },
};
const LEARN_ID: Record<SpellKey, string> = { E: 'learnScorpionToss', C: 'learnLocustSwarm', G: 'learnDungBomb' };

interface Beam {
  at: THREE.Vector3;
  t: number;
  life: number;
  r: number;
  dmg: number;
  tick: number;
  struck: boolean;
  big: boolean;
}
interface Blade {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vy: number;
  delay: number;
  spin: number;
  r: number;
  dmg: number;
}

export interface MarkSpellDeps {
  ctx: Ctx;
  player: Player;
  kit: MarkKit;
  qte: Qte;
  cam: CameraRig;
}

export class MarkSpells implements HeroSpells, HeroUlt {
  readonly name = 'Mr. Moonlight';
  private ctx: Ctx;
  private p: Player;
  private kit: MarkKit;
  private qte: Qte;
  private cam: CameraRig;
  cdE = 0;
  cdC = 0;
  gCharges = 2;
  gRecharge = 0;
  private beams: Beam[] = [];
  private blades: Blade[] = [];
  private bladePool: THREE.Mesh[] = [];
  private crestGeo: THREE.BufferGeometry;
  private dash: { t: number; dir: THREE.Vector3; hits: Set<number> } | null = null;
  private wardShield = 0;
  private moon: THREE.Mesh | null = null;
  private saved: { info: Record<string, string>; up: Record<string, { name: string; desc: (lv: number) => string; lore?: string }> } = { info: {}, up: {} };
  private time = 0;

  constructor(d: MarkSpellDeps) {
    this.ctx = d.ctx;
    this.p = d.player;
    this.kit = d.kit;
    this.qte = d.qte;
    this.cam = d.cam;
    const cm = moonCrestModel();
    this.crestGeo = buildVoxelGeometry(cm.model, { voxelSize: cm.voxelSize, pivot: 'center' });
    // the tarot cards speak of his spells while he rides
    for (const k of ['E', 'C', 'G'] as SpellKey[]) {
      this.saved.info[k] = SKILL_INFO[k].name;
      SKILL_INFO[k].name = TEXT[k].name;
      const u = UPGRADES.find((x) => x.id === LEARN_ID[k]);
      if (u) {
        this.saved.up[k] = { name: u.name, desc: u.desc, lore: u.lore };
        u.desc = () => TEXT[k].desc;
        u.lore = TEXT[k].lore;
      }
    }
  }

  // ============================================================== slots
  cast(k: SpellKey): boolean {
    if (k === 'E' && this.cdE <= 0) this.shineALight();
    else if (k === 'C' && this.cdC <= 0) this.blackbird();
    else if (k === 'G' && this.gCharges > 0) this.novemberRain();
    else return false;
    return true;
  }

  empower(k: SpellKey, perfect: boolean, aim: THREE.Vector3) {
    const ctx = this.ctx;
    const c = this.p.center(new THREE.Vector3());
    this.kit.burst(c, perfect ? 22 : 12, 1.2);
    ctx.sfx('divine_chime', c, perfect ? 0.6 : 0.4, perfect ? 1.3 : 1.1);
    if (k === 'E') this.dropBeam(aim.clone(), perfect ? 1.35 : 1.1, 0.25);
    else if (k === 'C') {
      this.kit.wardT += perfect ? 2.5 : 1.2;
      this.p.shield += perfect ? 18 : 9;
      this.wardShield += perfect ? 18 : 9;
    } else this.rainOn(aim.clone(), perfect ? 6 : 3, 0.3);
  }

  echo(k: SpellKey) {
    if (!this.p.alive) return;
    this.kit.burst(this.p.center(_v), 10, 0.8);
    if (k === 'E') this.shineALight(true);
    else if (k === 'C') this.blackbird(true);
    else this.novemberRain(true);
  }

  cooldowns() {
    return { scorp: Math.max(0, this.cdE), swarm: Math.max(0, this.cdC), bomb: this.gCharges > 0 ? 0 : Math.max(0, this.gRecharge), bombCharges: this.gCharges };
  }

  update(dt: number) {
    this.time += dt;
    const cdr = 1 - this.p.stats.get('cdr');
    this.cdE -= dt;
    this.cdC -= dt;
    if (this.gCharges < 2) {
      this.gRecharge -= dt;
      if (this.gRecharge <= 0) {
        this.gCharges++;
        this.gRecharge = MARK_SPELLS.rain.recharge * cdr;
      }
    }
    this.updateBeams(dt);
    this.updateBlades(dt);
    this.updateDash(dt);
    // the ward fades with its time
    if (this.wardShield > 0 && this.kit.wardT <= 0) {
      this.p.shield = Math.max(0, this.p.shield - this.wardShield);
      this.wardShield = 0;
    }
    if (this.wardShield > 0) this.wardShield = Math.min(this.wardShield, this.p.shield);
  }

  private aimGround(maxD: number, out: THREE.Vector3) {
    const p = this.p;
    out.copy(p.aimPoint);
    const d = out.distanceTo(p.pos);
    if (d > maxD) out.sub(p.pos).setLength(maxD).add(p.pos);
    out.y = this.ctx.world.groundAt(out.x, out.z);
    return out;
  }

  // ============================================================== E: SHINE A LIGHT
  private shineALight(echo = false) {
    const S = MARK_SPELLS.beam;
    if (!echo) this.cdE = S.cd * (1 - this.p.stats.get('cdr'));
    const at = this.aimGround(S.range, new THREE.Vector3());
    this.kit.startPose('beam', 0.62, at);
    this.p.express('determined', 0.8);
    this.ctx.sfx('divine_whisper', this.p.pos, 0.6, 1.25);
    if (!echo) this.ctx.toast('SHINE A LIGHT', '#cfe2ff');
    this.dropBeam(at, 1, S.delay);
  }

  /** a moonbeam column: telegraph ring, the strike, a lingering burn */
  dropBeam(at: THREE.Vector3, power = 1, delay = 0.4, big = false) {
    const S = MARK_SPELLS.beam;
    const r = S.radius * (big ? 1.7 : 1) * Math.sqrt(this.p.stats.get('explosionRadius') || 1);
    this.beams.push({ at, t: -delay, life: S.life * (big ? 1.2 : 1), r, dmg: S.dmg * power * (big ? 2.4 : 1), tick: 0, struck: false, big });
    this.ctx.fx.ring({ x: at.x, y: at.y + 0.1, z: at.z }, 0xcfe2ff, r * 2, delay + 0.1);
    this.ctx.fx.glyphs({ x: at.x, y: at.y + 0.4, z: at.z }, 0xbcd8ff, 8, r * 0.7);
  }

  private updateBeams(dt: number) {
    const ctx = this.ctx, S = MARK_SPELLS.beam;
    const verbs = ctx.enemies as unknown as { knockdown?: (e: EnemyLike, dx: number, dz: number, src?: string) => void };
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const at = b.at;
      if (b.t < 0) {
        // the gathering: a thin thread of light from the sky
        if (Math.random() < dt * 40) ctx.particles.emit({ pos: { x: at.x + (Math.random() - 0.5) * 0.4, y: at.y + 6 + Math.random() * 10, z: at.z + (Math.random() - 0.5) * 0.4 }, count: 1, vel: { x: 0, y: -24, z: 0 }, life: [0.3, 0.5], size: [0.08, 0.04], sprite: 'streak', color: MOONLIGHT, additive: true, stretch: 0.06 });
        continue;
      }
      if (!b.struck) {
        b.struck = true;
        ctx.sfx('explosion_big', at, b.big ? 1 : 0.6, 1.4);
        ctx.sfx('divine_power', at, 0.8, b.big ? 0.9 : 1.15);
        ctx.fx.light({ x: at.x, y: at.y + 2, z: at.z }, 0xcfe2ff, b.big ? 14 : 8, 0.5, b.r * 5);
        ctx.fx.ring({ x: at.x, y: at.y + 0.15, z: at.z }, 0xeef7ff, b.r * 2.6, 0.5);
        ctx.shake(b.big ? 0.6 : 0.3);
        ctx.events.emit('groundMark', at.x, at.z, b.r, 2);
        ctx.particles.emit({ pos: { x: at.x, y: at.y + 0.3, z: at.z }, count: b.big ? 70 : 36, vel: { x: 0, y: 4, z: 0 }, spread: b.r * 2.2, life: [0.4, 0.9], size: [0.12, 0.02], sprite: ['moon0', 'moon1', 'spark', 'star4'], color: MOONLIGHT, additive: true, drag: 2, gravity: 3 });
        ctx.enemies.inRadius(at, b.r, (e) => {
          const dx = e.pos.x - at.x, dz = e.pos.z - at.z;
          const dl = Math.hypot(dx, dz) || 1;
          ctx.enemies.damage(e, { base: b.dmg, kind: 'magic', source: 'divine', knock: 6, dirX: dx / dl, dirZ: dz / dl, canCrit: true, status: [{ id: 'slow', stacks: 2, dur: 2.5 }] }, undefined, new THREE.Vector3(dx / dl, 0, dz / dl));
          const en = e as EnemyLike & { vel?: THREE.Vector3 };
          if (e.alive && !e.isBoss) {
            verbs.knockdown?.(e, dx / dl, dz / dl, 'explosion');
            if (en.vel) en.vel.y = Math.max(en.vel.y, b.big ? 9 : 6.5);
          }
        });
      }
      // the pillar: falling light, rising motes, a glowing core
      const k = 1 - b.t / b.life;
      const n = Math.round((b.big ? 70 : 34) * dt * 60 * 0.2 * (0.4 + k));
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * b.r * 0.45;
        ctx.particles.emit({ pos: { x: at.x + Math.cos(a) * rr, y: at.y + 2 + Math.random() * 16, z: at.z + Math.sin(a) * rr }, count: 1, vel: { x: 0, y: -30, z: 0 }, life: [0.2, 0.4], size: [0.1 + k * 0.08, 0.05], sprite: 'streak', color: MOONLIGHT, additive: true, stretch: 0.05, alpha: 0.7 + k * 0.3 });
      }
      if (Math.random() < dt * 22) {
        const a = Math.random() * Math.PI * 2, rr = b.r * (0.4 + Math.random() * 0.6);
        ctx.particles.emit({ pos: { x: at.x + Math.cos(a) * rr, y: at.y + 0.2, z: at.z + Math.sin(a) * rr }, count: 1, vel: { x: 0, y: 2.4, z: 0 }, life: [0.6, 1.1], size: [0.07, 0.02], sprite: ['moon1', 'dot3', 'star4'], color: MOONLIGHT, additive: true, drag: 0.6 });
      }
      if (Math.random() < dt * 8) ctx.particles.emit({ pos: { x: at.x, y: at.y + 1 + Math.random() * 3, z: at.z }, count: 1, life: [0.25, 0.4], size: [b.r * 0.9, b.r * 1.1], sprite: 'glow32', color: 0xbcd8ff, additive: true, alpha: 0.3 * k });
      b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = S.tick;
        ctx.enemies.inRadius(at, b.r * 0.8, (e) => ctx.enemies.damage(e, { base: S.tickDmg * (b.big ? 2 : 1), kind: 'magic', source: 'divine', canCrit: false, status: [{ id: 'slow', stacks: 1, dur: 1.5 }] }));
      }
      if (b.t >= b.life) this.beams.splice(i, 1);
    }
  }

  // ============================================================== C: BLACKBIRD -> GIMME SHELTER
  private blackbird(echo = false) {
    const S = MARK_SPELLS.dash;
    const p = this.p, ctx = this.ctx;
    if (!echo) this.cdC = S.cd * (1 - p.stats.get('cdr'));
    // where he goes: the ride's way if he is moving, else the view
    const b = p.board;
    const dir = new THREE.Vector3(b.vel.x, 0, b.vel.z);
    if (dir.lengthSq() < 9) {
      const cf = p.cam.forward();
      dir.set(cf.x, 0, cf.z);
    }
    dir.normalize();
    this.dash = { t: 0, dir, hits: new Set() };
    p.invuln = Math.max(p.invuln, S.dur + 0.3);
    this.kit.startPose('dash', S.dur + 0.15, _v.copy(p.pos).addScaledVector(dir, 5));
    ctx.sfx('whoosh_big', p.pos, 0.9, 0.7);
    ctx.sfx('time_slow', p.pos, 0.35, 1.6);
    if (!echo) ctx.toast('BLACKBIRD', '#cfe2ff');
    p.cam.punch(0, 0, 4, 0);
    p.express('determined', 0.8);
  }

  private updateDash(dt: number) {
    const d = this.dash;
    if (!d) return;
    const S = MARK_SPELLS.dash;
    const p = this.p, ctx = this.ctx, b = p.board;
    d.t += dt;
    b.vel.x = d.dir.x * S.speed;
    b.vel.z = d.dir.z * S.speed;
    if (!b.grounded) b.vel.y = Math.max(b.vel.y, 0);
    const c = p.center(_v);
    // the eclipse streak: black feathers, a silver rim, smoke
    ctx.particles.emit({ pos: c, count: 3, vel: { x: -d.dir.x * 2, y: 0.4, z: -d.dir.z * 2 }, spread: 1.2, jitter: 0.5, life: [0.4, 0.8], size: [0.1, 0.06], sprite: 'feather', color: [0x14111a, 0x231e2c, 0x0b0a0e], drag: 2, gravity: 1.5, rot: 6 });
    ctx.particles.emit({ pos: c, count: 2, spread: 0.8, jitter: 0.6, life: [0.3, 0.6], size: [0.5, 1.1], sprite: ['puff0', 'puff1'], color: 0x17131f, alpha: 0.7, drag: 2.5 });
    ctx.particles.emit({ pos: c, count: 2, spread: 1.5, jitter: 0.5, life: [0.2, 0.4], size: [0.06, 0.01], sprite: ['spark', 'moon1'], color: MOONLIGHT, additive: true, drag: 3 });
    ctx.enemies.inRadius(c, S.width, (e) => {
      if (d.hits.has(e.id)) return;
      d.hits.add(e.id);
      const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z);
      ctx.enemies.damage(e, { base: S.dmg, kind: 'magic', source: 'divine', knock: 4, dirX: d.dir.x, dirZ: d.dir.z, canCrit: true, status: [{ id: 'curse', stacks: 2, dur: 4 }, { id: 'bleed', stacks: 2, dur: 3 }] }, at, d.dir.clone());
      ctx.particles.emit({ pos: at, count: 10, spread: 4, life: [0.15, 0.35], size: [0.07, 0.015], sprite: 'spark', color: MOONLIGHT, additive: true, stretch: 0.04, drag: 3 });
      ctx.sfx('dagger_stab', at, 0.6, 1.1);
      ctx.engine.hitStop(0.03);
    });
    if (d.t >= S.dur) {
      this.dash = null;
      b.vel.x *= 0.55;
      b.vel.z *= 0.55;
      // GIMME SHELTER: the ward closes round him
      const sh = S.shield * Math.max(0.6, p.stats.get('magicDmg'));
      p.shield += sh;
      this.wardShield += sh;
      this.kit.wardT = Math.max(this.kit.wardT, S.ward);
      ctx.sfx('shield_up', p.pos, 0.8, 1.2);
      ctx.toast('GIMME SHELTER', '#cfe2ff', `Lunar ward +${Math.round(sh)}`);
      this.kit.burst(p.center(_v), 20, 1.4);
      this.kit.startPose('ward', 0.45);
    }
  }

  // ============================================================== G: NOVEMBER RAIN
  private novemberRain(echo = false) {
    if (!echo) {
      this.gCharges--;
      if (this.gCharges < 2 && this.gRecharge <= 0) this.gRecharge = MARK_SPELLS.rain.recharge * (1 - this.p.stats.get('cdr'));
    }
    const at = this.aimGround(36, new THREE.Vector3());
    this.kit.startPose('rain', 0.55, at);
    this.ctx.sfx('divine_whisper', this.p.pos, 0.55, 0.9);
    if (!echo) this.ctx.toast('NOVEMBER RAIN', '#cfe2ff');
    this.rainOn(at, MARK_SPELLS.rain.blades + Math.round(this.p.stats.get('scorpions')), 0.25);
  }

  /** crescent blades out of the sky round a point */
  rainOn(at: THREE.Vector3, n: number, delay: number, radius = MARK_SPELLS.rain.radius, dmgMul = 1) {
    const S = MARK_SPELLS.rain;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const mesh = this.bladePool.pop() ?? new THREE.Mesh(this.crestGeo, this.p.material);
      mesh.visible = false;
      mesh.scale.setScalar(1.25);
      this.ctx.scene.add(mesh);
      const g = this.ctx.world.groundAt(x, z);
      this.blades.push({ mesh, pos: new THREE.Vector3(x, g + 18 + Math.random() * 6, z), vy: -34, delay: delay + (i / Math.max(1, n - 1)) * S.over + Math.random() * 0.08, spin: Math.random() * 6, r: S.hitR, dmg: S.dmg * dmgMul });
      this.ctx.fx.ring({ x, y: g + 0.08, z }, 0xbcd8ff, S.hitR * 2, delay + 0.25 + (i / Math.max(1, n - 1)) * S.over);
    }
  }

  private updateBlades(dt: number) {
    const ctx = this.ctx;
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const bl = this.blades[i];
      if (bl.delay > 0) {
        bl.delay -= dt;
        continue;
      }
      bl.mesh.visible = true;
      bl.pos.y += bl.vy * dt;
      bl.spin += dt * 30;
      bl.mesh.position.copy(bl.pos);
      // edge down, spinning in a vertical plane
      bl.mesh.rotation.set(Math.PI / 2, 0, bl.spin);
      if (Math.random() < dt * 30) ctx.particles.emit({ pos: bl.pos, count: 1, vel: { x: 0, y: 6, z: 0 }, life: [0.15, 0.3], size: [0.08, 0.02], sprite: ['moon1', 'dot3'], color: MOONLIGHT, additive: true });
      const g = ctx.world.groundAt(bl.pos.x, bl.pos.z);
      if (bl.pos.y <= g + 0.3) {
        const at = new THREE.Vector3(bl.pos.x, g + 0.4, bl.pos.z);
        ctx.enemies.inRadius(at, bl.r, (e) => {
          const dx = e.pos.x - at.x, dz = e.pos.z - at.z;
          const dl = Math.hypot(dx, dz) || 1;
          ctx.enemies.damage(e, { base: bl.dmg, kind: 'magic', source: 'divine', knock: 3, dirX: dx / dl, dirZ: dz / dl, canCrit: true, status: [{ id: 'bleed', stacks: 1, dur: 3 }] });
        });
        ctx.particles.emit({ pos: at, count: 12, vel: { x: 0, y: 3, z: 0 }, spread: 4, life: [0.2, 0.5], size: [0.08, 0.015], sprite: ['spark', 'moon1', 'star4'], color: MOONLIGHT, additive: true, drag: 2.5, gravity: 6 });
        ctx.fx.sandBurst(at, 0.5);
        ctx.events.emit('groundMark', at.x, at.z, 0.9, 1);
        if (Math.random() < 0.6) ctx.sfx('dagger_stab', at, 0.5, 1.3 + Math.random() * 0.2);
        bl.mesh.removeFromParent();
        this.bladePool.push(bl.mesh);
        this.blades.splice(i, 1);
      }
    }
  }

  // ============================================================== Z: MR. MOONLIGHT
  private moonMesh() {
    if (this.moon) return this.moon;
    // a sculpted full moon: maria, rayed craters, a pale glowing face (1/4 m voxels, ~11 m across)
    const R = 22;
    const craters: [number, number, number, number][] = [];
    for (let i = 0; i < 26; i++) {
      const a = h3(i, 1, 2) * Math.PI * 2, b = Math.acos(h3(i, 3, 4) * 2 - 1);
      craters.push([Math.sin(b) * Math.cos(a) * R, Math.cos(b) * R, Math.sin(b) * Math.sin(a) * R, 1.5 + h3(i, 5, 6) * 3.5]);
    }
    const m = sculpt('ult_moon', [-R - 1, -R - 1, -R - 1, R + 1, R + 1, R + 1], (x, y, z) => {
      let d = Math.hypot(x, y, z) - R;
      for (const [cx, cy, cz, cr] of craters) {
        const q = Math.hypot(x - cx, y - cy, z - cz);
        if (q < cr * 1.4) d = Math.max(d, -(q - cr * 0.8)) + (q > cr * 0.8 && q < cr * 1.2 ? -0.5 : 0);
      }
      return d;
    }, (x, y, z, s) => {
      const mare = fbm3(x * 0.07, y * 0.07, z * 0.07) > 0.15;
      const c = s.exp < 0.3 ? 0x8a9bbc : mare ? 0xb4c2dc : s.exp > 0.75 ? 0xf4f8ff : 0xdce6f4;
      return [c, VF.SOLID | VF.GLOW];
    });
    const geo = buildVoxelGeometry(m, { voxelSize: 0.25, pivot: 'center' });
    this.moon = new THREE.Mesh(geo, makeVoxelMaterial({ fog: false }));
    return this.moon;
  }

  private bestTarget(maxD = 40): THREE.Vector3 | null {
    const list = this.ctx.enemies.list.filter((e) => e.alive && e.pos.distanceTo(this.p.pos) < maxD);
    let best: EnemyLike | null = null, bestN = -1;
    for (const e of list) {
      let n = 0;
      for (const o of list) if (o.pos.distanceTo(e.pos) < 6) n += o.isBoss ? 4 : 1;
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    return best ? best.pos.clone() : null;
  }

  async run() {
    const ctx = this.ctx, eng = ctx.engine, p = this.p, cam = this.cam;
    const env = ctx.world.env;
    const base: EnvPreset = { ...env.preset };
    this.kit.startPose('ult', 9);
    // night falls
    await eng.tweens.tween(0.7, (k) => env.lerpPreset(base, PRESETS.night, k * 0.9), Ease.inOutQuad, true);
    // the moon rises behind him, where the camera can see it
    const moon = this.moonMesh();
    const yaw = cam.yaw;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const mPos = p.pos.clone().addScaledVector(f, 70);
    ctx.scene.add(moon);
    ctx.sfx('divine_power', p.pos, 1, 0.8);
    ctx.sfx('quake_rumble', null, 0.6, 1.3);
    cam.setCine({ pos: p.pos.clone().addScaledVector(f, -6).add(new THREE.Vector3(0, 1.4, 0)), look: mPos.clone().add(new THREE.Vector3(0, 20, 0)), fov: 58 });
    await eng.tweens.tween(1.2, (k) => {
      moon.position.copy(mPos).add(new THREE.Vector3(0, -6 + 34 * k, 0));
      moon.rotation.y = k * 0.4;
    }, Ease.outCubic, true);
    ctx.fx.light(p.pos, 0xbcd8ff, 8, 1.2, 30);
    // three calls, three moonbeams
    const res: QteResult[] = [];
    for (let s = 0; s < 3; s++) {
      const tgt = this.bestTarget() ?? p.pos.clone().add(new THREE.Vector3(rnd.next() * 16 - 8, 0, rnd.next() * 16 - 8));
      tgt.y = ctx.world.groundAt(tgt.x, tgt.z);
      cam.setCine({ pos: tgt.clone().add(new THREE.Vector3(Math.sin(yaw + 0.7) * -13, 8, Math.cos(yaw + 0.7) * -13)), look: tgt.clone().add(new THREE.Vector3(0, 1.5, 0)), fov: 56 });
      ctx.fx.ring({ x: tgt.x, y: tgt.y + 0.2, z: tgt.z }, 0xcfe2ff, 10, 1.1);
      const r = await this.qte.run({ kind: 'ring', key: 'KeyZ', label: `MOONBEAM ${s + 1}/3`, duration: 1.05 - s * 0.12 });
      res.push(r);
      const mult = r === 'perfect' ? 1.7 : r === 'good' ? 1.1 : 0.5;
      this.dropBeam(tgt, mult * 1.25, 0.05, true);
      eng.hitStop(0.08);
      if (r === 'perfect') ctx.toast('FULL MOON', '#eef7ff');
      await eng.tweens.wait(0.45, true);
    }
    if (res.every((x) => x === 'perfect')) {
      ctx.toast('KHONSU SMILES', '#eef7ff', 'Flawless: ultimate refunds 35%', true);
      ctx.run.ultCharge = 0.35;
    }
    // the moon breaks into a crescent storm round him
    cam.setCine({ pos: p.pos.clone().addScaledVector(f, -9).add(new THREE.Vector3(0, 6, 0)), look: p.pos.clone().add(new THREE.Vector3(0, 1, 0)), fov: 64 });
    this.rainOn(p.pos.clone(), 18, 0.1, 10, 1.6);
    await eng.tweens.wait(1.3, true);
    // the moon sets, the day comes back
    await eng.tweens.tween(0.8, (k) => {
      moon.position.y -= 0.6;
      env.lerpPreset(base, PRESETS.night, 0.9 * (1 - k));
    }, Ease.inQuad, true);
    moon.removeFromParent();
    env.apply(base);
    this.kit.pose = null;
  }

  dispose() {
    for (const k of ['E', 'C', 'G'] as SpellKey[]) {
      if (this.saved.info[k]) SKILL_INFO[k].name = this.saved.info[k];
      const u = UPGRADES.find((x) => x.id === LEARN_ID[k]);
      const sv = this.saved.up[k];
      if (u && sv) {
        u.desc = sv.desc;
        u.lore = sv.lore;
      }
    }
    for (const b of this.blades) b.mesh.removeFromParent();
    this.blades = [];
    this.moon?.removeFromParent();
    this.moon?.geometry.dispose();
  }
}
void UP;
void _v2;
void clamp;
