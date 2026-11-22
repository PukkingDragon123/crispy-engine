// THE BEETLES: Khepri's fab four, four scarab musicians who fight as a band, then
// fly together into a giant scarab colossus. (Beatles nods, with a few other bands
// on the colossus.)
//
// Entrance: four specks buzz in out of the sun and land; the band crosses the sand
// in single file; the drummer counts it in ("I Saw Her Standing There") and the
// first chord shakes the dune. Everything they do lands on a 132 bpm beat, so the
// fight can be read and danced: heads nod, the drummer hits on the beat, the
// guitarists strum on the off-beats, the attacks fall on the bar.
// Band (first 45 % of the life bar, a share per member; knock one onto its back and
// it is out until the others pick it up):
//   Here, There and Everywhere (rhythm) rings of notes on the beat
//   Day Tripper                (bass)   a marked lane, then he rides it at speed
//   Within You Without You     (lead)   slow homing drone notes from the oud
//   Eight Days a Week          (drums)  eight beats, a marked ring at you on every other one
//   With a Little Help from My Friends   a member down too long gets helped back up
// Magical Mystery Tour: all four down, they rise, spiral, flash and assemble into
// THE SCARAB COLOSSUS (gold, lapis and bronze), which fights with:
//   Maxwell's Silver Hammer    the silver fist on a following ring, bang, bang
//   Hammer to Fall             (Queen) both fists down a marked wedge, a shock line
//   Dig a Pony                 it digs in, a ripple hunts you, it erupts under the mark
//   A Day in the Life          the chest disc winds up, then a two-armed spiral
//   For Those About to Rock    (AC/DC) the shoulder guns salute: marked mortar rings
//   Kashmir                    (Led Zeppelin) a march, every stomp a ring
//   Welcome to the Machine     (Pink Floyd) at a quarter life: elytra open, it overclocks
// Death (All You Need Is Love): it kneels, sheds plates and melts away; the four fly
// out of it, bow together in a row, and leave for the sun.
import * as THREE from 'three';
import { Boss, BossDeps, Cancelled } from '../Boss';
import type { RayHit } from '../../Ctx';
import type { Hit } from '../../combat/Damage';
import { resolveHit } from '../../combat/Damage';
import { buildRigGeo, cachedRigGeo, RigInstance, RigSpec } from '../../../engine/voxel/Rig';
import { modelEntry } from '../../models/lookup';
import { RigEyes } from '../../fx/FaceFx';
import { song, stinger, socketAt } from './MusicFx';
import { clamp, damp, dampAngle, rnd } from '../../../engine/math/rand';

const BPM = 132;
const BEAT = 60 / BPM;
const GOLDC = 0xffd070;
const NAMES = ['Rhythm', 'Bass', 'Lead', 'Drums'];
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

interface Member {
  i: number;
  pos: THREE.Vector3;
  yaw: number;
  air: number;
  share: number;
  shareMax: number;
  down: number;
  hitT: number;
  fly: number;
  busy: boolean;
  script: boolean;
  walk: number;
  bow: number;
  contact: number;
  visible: boolean;
  spd: number;
}

export class Beetles extends Boss {
  barTheme = 'beetle';
  private band: RigInstance;
  private mech: RigInstance;
  private form: 'band' | 'combining' | 'colossus' | 'dead' = 'band';
  private m: Member[] = [];
  private tier: number;
  private beatT = 0;
  private beatN = 0;
  private spin = 0;
  private queue: string[] = [];
  private lastAttack = '';
  private haste = 1;
  private mechAnim = { lift: 0, slamL: 0, slamR: 0, dig: 0, disc: 0, kneel: 0, elytra: 0, cannon: 0, grow: 1, step: 0 };
  private hammerUp = 0;

  constructor(d: BossDeps, tier = 1) {
    super(d, 'beetles_band', { name: 'The Beetles', title: "Khepri's Fab Four", hp: 3000 * tier, scale: 1, eyes: ['organic', 0x1a1408] });
    this.tier = tier;
    this.band = this.rig;
    this.phases = [0.55, 0.25];
    this.armor = 30;
    this.physRes = 0.12;
    this.bounty = 400 * tier;
    this.gold = 150 * tier;
    this.statusRes = { stun: 0.5 };
    this.radius = 6;
    this.height = 1.6;
    // the colossus they become (built now, so the transformation never hitches)
    const cached = cachedRigGeo('boss:beetles_colossus');
    const spec = (cached?.spec ?? modelEntry('beetles_colossus')?.()) as RigSpec;
    this.mech = new RigInstance(buildRigGeo(spec, 'boss:beetles_colossus'), { ownMaterial: true });
    for (let i = 0; i < 4; i++) {
      const share = this.maxHp * 0.1125;
      this.m.push({ i, pos: new THREE.Vector3(), yaw: 0, air: 0, share, shareMax: share, down: 0, hitT: 9, fly: 0, busy: false, script: false, walk: rnd.next() * 6, bow: 0, contact: 0, visible: true, spd: 0 });
      this.band.setPartVisible(`b${i}_wing_l`, false);
      this.band.setPartVisible(`b${i}_wing_r`, false);
    }
  }

  private get dmgK() {
    return 0.85 + this.tier * 0.15;
  }
  private ground(x = this.pos.x, z = this.pos.z) {
    return this.ctx.world.groundAt(x, z);
  }
  private fork(p: Promise<unknown>) {
    p.catch((e) => {
      if (!(e instanceof Cancelled)) console.error(e);
    });
  }
  private slot(i: number, out: THREE.Vector3) {
    if (i === 3) return out.set(this.pos.x, 0, this.pos.z);
    const a = this.spin + (i / 3) * Math.PI * 2;
    return out.set(this.pos.x + Math.cos(a) * 5.2, 0, this.pos.z + Math.sin(a) * 5.2);
  }
  private up() {
    return this.m.filter((m) => m.down <= 0 && m.visible);
  }
  /** wait until the next beat (plus k more beats) */
  private async onBeat(k = 0) {
    const next = (this.beatN + 1 + k) * BEAT;
    await this.waitRaw(Math.max(0.01, next - this.beatT));
  }
  private memberAt(m: Member, out: THREE.Vector3, h = 0.9) {
    return out.set(m.pos.x, this.ground(m.pos.x, m.pos.z) + m.air + h, m.pos.z);
  }

  // ------------------------------------------------------------------ the entrance
  async intro() {
    const ctx = this.ctx, cam = this.d.cam, eng = ctx.engine;
    stinger('bossIntro');
    eng.letterbox(true, 0.5);
    this.invulnerable = true;
    const bx = this.pos.x, bz = this.pos.z, g = this.ground();
    const pp = this.playerPos();
    const dx = bx - pp.x, dz = bz - pp.z, dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl, sx = uz, sz = -ux;
    for (const m of this.m) m.script = true;
    // the four land in a row across the hunter's view
    const row = (i: number) => new THREE.Vector3(bx + sx * (i - 1.5) * 2.2, 0, bz + sz * (i - 1.5) * 2.2);
    const start = (i: number) => new THREE.Vector3(bx + ux * 40 + sx * (i - 1.5) * 6, 0, bz + uz * 40 + sz * (i - 1.5) * 6);
    // 1) out of the sun: four buzzing specks glide in
    const wide = new THREE.Vector3(pp.x - ux * 5 + sx * 2.5, 0, pp.z - uz * 5 + sz * 2.5);
    wide.y = this.ground(wide.x, wide.z) + 1.5;
    cam.setCine({ pos: wide, look: new THREE.Vector3(bx, g + 5, bz), fov: 52 });
    eng.flash(0xfff0c0, 0.35, 0.4);
    ctx.sfx('swarm_loop', this.pos, 0.8, 1.3);
    this.band.setPartVisible('b3_kit', false);
    const T = 2.4;
    for (let t = 0; t < T; t += 0.05) {
      const k = t / T, e = 1 - (1 - k) ** 2;
      for (const m of this.m) {
        const a = start(m.i), b = row(m.i);
        m.pos.lerpVectors(a, b, e);
        m.air = Math.sin(k * Math.PI) * 9 * (1 - k) + (1 - e) * 6;
        m.fly = k < 0.92 ? 1 : 0;
        m.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      }
      await this.waitRaw(0.05);
    }
    for (const m of this.m) {
      m.air = 0;
      m.fly = 0;
      ctx.fx.sandBurst(this.memberAt(m, _v, 0), 0.6);
    }
    ctx.sfx('board_land', this.pos, 0.8, 1.2);
    // 2) the walk: single file across the sand
    const side = new THREE.Vector3(bx - sx * 9 + ux * 3, 0, bz - sz * 9 + uz * 3);
    side.y = this.ground(side.x, side.z) + 0.9;
    cam.setCine({ pos: side, look: new THREE.Vector3(bx, g + 1.1, bz), fov: 40 });
    const walkT = 2.4;
    const from = this.m.map((m) => m.pos.clone());
    for (let t = 0; t < walkT; t += 0.05) {
      const k = t / walkT;
      for (const m of this.m) {
        m.pos.copy(from[m.i]).addScaledVector(_v.set(sx, 0, sz), k * 4.4);
        m.yaw = Math.atan2(sx, sz);
        m.walk += 0.05 * 7;
      }
      await this.waitRaw(0.05);
    }
    // 3) the count-in: the drummer clicks his sticks four times, then the first chord
    for (const m of this.m) m.script = false;
    this.slotSnap();
    this.band.setPartVisible('b3_kit', true);
    ctx.fx.sandBurst({ x: bx, y: g, z: bz }, 1.2);
    const dr = this.m[3];
    this.root.updateMatrixWorld(true);
    const head = this.memberAt(dr, new THREE.Vector3(), 1.2);
    cam.setCine({ pos: new THREE.Vector3(head.x - ux * 3.6 + sx * 1.4, head.y + 0.3, head.z - uz * 3.6 + sz * 1.4), look: head, fov: 42 });
    this.taunt('One, two, three, four!', '#ffe08a');
    for (let k = 0; k < 4; k++) {
      await this.onBeat();
      ctx.sfx('counter_clang', head, 0.5, 2.1);
      this.mechAnim.step = 1;
    }
    await this.onBeat();
    ctx.sfx('divine_power', this.pos, 1, 1.2);
    ctx.shake(0.5);
    ctx.world.sand.ring(bx, bz, { speed: 10, height: 0.5, width: 1.6, life: 1.4 });
    eng.flash(0xfff0c0, 0.3, 0.3);
    song(this, 'I Saw Her Standing There', 'The Beatles', '#ffd070');
    ctx.events.emit('bossIntro', this);
    await this.waitRaw(1.6);
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.invulnerable = false;
  }
  private slotSnap() {
    for (const m of this.m) {
      this.slot(m.i, m.pos);
      m.air = 0;
    }
  }

  // ------------------------------------------------------------------ the fight
  protected async fight() {
    while (true) {
      this.check();
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      if (this.form === 'combining' || this.form === 'dead') {
        await this.wait(0.2);
        continue;
      }
      if (this.form === 'band') await this.bandTurn();
      else await this.mechTurn();
    }
  }
  private async bandTurn() {
    const up = this.up();
    if (!up.length) return this.wait(0.3);
    // keep the stage about fourteen metres off the hunter
    const pp = this.playerPos();
    const d = this.distToPlayer();
    if ((d > 24 || d < 9) && !this.moveTarget) {
      const a = Math.atan2(this.pos.z - pp.z, this.pos.x - pp.x) + rnd.range(-0.6, 0.6);
      this.moveTo(pp.x + Math.cos(a) * 15, pp.z + Math.sin(a) * 15, 4.5, 2.5).catch(() => undefined);
    }
    // one or two members play at once (never the same move twice running)
    const free = up.filter((m) => !m.busy);
    if (free.length && this.m.filter((m) => m.busy).length < 2) {
      const m = free[(rnd.next() * free.length) | 0];
      const k = ['here', 'tripper', 'within', 'eight'][m.i];
      if (k !== this.lastAttack || free.length === 1) {
        this.lastAttack = k;
        m.busy = true;
        this.fork(this.run(k).finally(() => (m.busy = false)));
      }
    }
    await this.wait(1.1 * this.haste);
  }
  private async mechTurn() {
    const p = this.phase, r = rnd.next(), d = this.distToPlayer();
    // it closes in on the hunter between songs
    if (d > 16 && d < 30 && rnd.chance(0.6)) {
      const pp = this.playerPos();
      const a = Math.atan2(this.pos.z - pp.z, this.pos.x - pp.x);
      await this.moveTo(pp.x + Math.cos(a) * 11, pp.z + Math.sin(a) * 11, 3.4, 2.4);
    }
    let pick: string;
    if (d > 30) pick = r < 0.5 ? 'kashmir' : 'dig';
    else if (p < 2) pick = r < 0.24 ? 'maxwell' : r < 0.42 ? 'hammer' : r < 0.58 ? 'dayInLife' : r < 0.74 ? 'salute' : r < 0.88 ? 'dig' : 'kashmir';
    else pick = r < 0.2 ? 'maxwell' : r < 0.36 ? 'hammer' : r < 0.52 ? 'dayInLife' : r < 0.7 ? 'salute' : r < 0.84 ? 'dig' : 'kashmir';
    if (pick === this.lastAttack) pick = pick === 'maxwell' ? 'salute' : 'maxwell';
    this.lastAttack = pick;
    await this.run(pick);
    await this.wait((p >= 2 ? 0.55 : 0.85) * this.haste);
  }
  private async run(name: string) {
    switch (name) {
      case 'here':
        return this.hereThereEverywhere();
      case 'tripper':
        return this.dayTripper();
      case 'within':
        return this.withinYou();
      case 'eight':
        return this.eightDays();
      case 'maxwell':
        return this.maxwell();
      case 'hammer':
        return this.hammerToFall();
      case 'dig':
        return this.digAPony();
      case 'dayInLife':
        return this.aDayInTheLife();
      case 'salute':
        return this.forThoseAboutToRock();
      case 'kashmir':
        return this.kashmir();
    }
  }
  /** dev/test: queue a move (here, tripper, within, eight while a band; maxwell, hammer, dig, dayInLife, salute, kashmir as the colossus) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  // ------------------------------------------------------------------ the band's songs
  /** a member's song: the title over him, the HUD and barks hear it */
  private memberSong(m: Member, title: string) {
    const pos = this.memberAt(m, new THREE.Vector3(), 2.1);
    this.d.enemies.callout(title, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title, enemy: this, pos, tier: 'boss' });
    this.ctx.toast(title.toUpperCase(), '#ffd070', `The Beatles, ${NAMES[m.i].toLowerCase()}`);
  }
  private live(m: Member) {
    if (m.down > 0 || this.form !== 'band') throw new Cancelled();
  }
  private async hereThereEverywhere() {
    const m = this.m[0];
    this.memberSong(m, 'Here, There and Everywhere');
    for (let k = 0; k < 3; k++) {
      await this.onBeat(1);
      this.live(m);
      const from = socketAt(this, 'b0_fx', new THREE.Vector3());
      const n = 9;
      const off = k * 0.35 + rnd.next() * 0.2;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        this.d.enemies.proj.spawn({ kind: 'curse', x: from.x, y: from.y, z: from.z, vx: Math.sin(a) * 8, vy: 0, vz: Math.cos(a) * 8, dmg: 8 * this.dmgK, sourceId: this.id, life: 3.2 });
      }
      this.ctx.sfx('banjo_funny', from, 0.5, 1.4 + k * 0.12);
      this.ctx.particles.emit({ pos: from, count: 5, spread: 2, up: 1, life: [0.6, 1], size: [0.18, 0.1], sprite: 'note', color: 0xffe08a, drag: 1.5 });
    }
  }
  private async dayTripper() {
    const m = this.m[1];
    const ctx = this.ctx;
    this.memberSong(m, 'Day Tripper');
    const pp = this.playerPos();
    const dx = pp.x - m.pos.x, dz = pp.z - m.pos.z, dl = Math.hypot(dx, dz) || 1;
    const L = Math.min(28, dl + 8);
    this.d.enemies.warn.lane(m.pos.x, m.pos.z, dx, dz, L, 2.6, 0.95, 'heavy');
    m.script = true;
    m.yaw = Math.atan2(dx, dz);
    await this.waitRaw(0.95);
    this.live(m);
    ctx.sfx('whoosh_big', m.pos, 0.8, 0.8);
    const x0 = m.pos.x, z0 = m.pos.z;
    let hit = false;
    for (let s = 0; s < L; s += 26 * 0.05) {
      m.pos.set(x0 + (dx / dl) * s, 0, z0 + (dz / dl) * s);
      m.walk += 1.4;
      ctx.fx.sandSpray({ x: m.pos.x, y: this.ground(m.pos.x, m.pos.z), z: m.pos.z }, { x: -dx / dl, y: 0.6, z: -dz / dl }, 1.6);
      const pl = this.player.pos;
      if (!hit && Math.hypot(pl.x - m.pos.x, pl.z - m.pos.z) < 1.7 && pl.y < this.ground(pl.x, pl.z) + 2) {
        hit = true;
        this.player.takeHit({ base: 20 * this.dmgK, kind: 'phys', source: 'contact', knock: 11 }, m.pos.clone());
      }
      await this.waitRaw(0.05);
      if (m.down > 0 || this.form !== 'band') break;
    }
    ctx.world.sand.ring(m.pos.x, m.pos.z, { speed: 8, height: 0.35, width: 1.2, life: 0.9 });
    m.script = false;
  }
  private async withinYou() {
    const m = this.m[2];
    this.memberSong(m, 'Within You Without You');
    for (let k = 0; k < 3; k++) {
      await this.onBeat(1);
      this.live(m);
      const from = socketAt(this, 'b2_fx', new THREE.Vector3());
      const pp = this.player.center(new THREE.Vector3());
      const base = Math.atan2(pp.x - from.x, pp.z - from.z);
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.6;
        this.d.enemies.proj.spawn({ kind: 'needle', x: from.x, y: from.y, z: from.z, vx: Math.sin(a) * 7, vy: 0.6, vz: Math.cos(a) * 7, dmg: 9 * this.dmgK, homing: 1.1, sourceId: this.id, life: 4 });
      }
      this.ctx.sfx('banjo_funny', from, 0.45, 0.7);
      this.ctx.particles.emit({ pos: from, count: 4, spread: 1.5, up: 1, life: [0.8, 1.2], size: [0.18, 0.1], sprite: 'note', color: 0xffb070, drag: 1.5 });
    }
  }
  private async eightDays() {
    const m = this.m[3];
    const ctx = this.ctx;
    this.memberSong(m, 'Eight Days a Week');
    for (let b = 0; b < 8; b++) {
      await this.onBeat();
      this.live(m);
      ctx.sfx('punch', m.pos, 0.6, 0.6);
      if (b % 2 === 0) {
        const pp = this.playerPos(), pv = this.player.board.vel;
        const x = pp.x + pv.x * 0.5, z = pp.z + pv.z * 0.5;
        this.fork(this.slam(new THREE.Vector3(x, 0, z), 2.4, 16 * this.dmgK, BEAT * 2, 'sand'));
      }
    }
  }

  // ------------------------------------------------------------------ damage on the band
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (this.form === 'colossus') return super.hitTest(o, d, maxT);
    if (!this.alive || this.form !== 'band') return null;
    let best: RayHit | null = null;
    let bt = maxT;
    for (const m of this.m) {
      if (!m.visible) continue;
      for (const [h, r, tag] of [[0.8, 0.62, ''], [1.32, 0.36, 'h']] as [number, number, string][]) {
        const c = this.memberAt(m, _v, m.down > 0 ? 0.3 : h);
        const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
        if (disc < 0) continue;
        let t = -b - Math.sqrt(disc);
        if (t < 0) t = -b + Math.sqrt(disc);
        if (t < 0 || t > bt) continue;
        bt = t;
        const point = o.clone().addScaledVector(d, t);
        best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: tag === 'h', part: `m${m.i}${tag}`, surface: 'enemy' };
      }
    }
    return best;
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (this.form === 'colossus') return super.takeDamage(hit, point, dir);
    if (!this.alive || this.form !== 'band' || this.invulnerable) {
      if (point) this.ctx.fx.hit(point, { x: 0, y: 1, z: 0 }, 'armor', 0.6);
      return 0;
    }
    const tag = hit.tags?.[0] ?? '';
    const mm = /^m(\d)(h?)$/.exec(tag);
    let m: Member | undefined = mm ? this.m[+mm[1]] : undefined;
    if (!m) {
      const at = point ?? this.player.pos;
      let bd = 7;
      for (const q of this.m) {
        const dd = Math.hypot(q.pos.x - at.x, q.pos.z - at.z);
        if (q.down <= 0 && q.visible && dd < bd) {
          bd = dd;
          m = q;
        }
      }
    }
    if (!m) return 0;
    const pp = point ?? this.memberAt(m, new THREE.Vector3(), 0.9);
    if (m.down > 0) {
      this.ctx.fx.hit(pp, { x: 0, y: 1, z: 0 }, 'chitin', 0.5);
      return 0;
    }
    const head = !!mm?.[2];
    const res = resolveHit(this.player.stats, { ...hit, mult: (hit.mult ?? 1) * (head ? 1.5 : 1) }, { hp: this.hp, maxHp: this.maxHp, armor: this.armor, physRes: this.physRes, magicRes: this.magicRes, statusRes: this.statusRes, status: this.status, isBoss: true }, this.player.speed);
    const amt = Math.min(res.amount, m.share);
    m.share -= amt;
    this.hp -= amt;
    m.hitT = 0;
    this.flash = 1;
    this.hitT = 0;
    if (hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      this.ctx.fx.hit(pp, { x: -(dir?.x ?? 0), y: 0.5, z: -(dir?.z ?? 0) }, 'chitin', res.crit ? 1.6 : 1);
      this.ctx.sfx('hit_armor', pp, 0.5, 1.2);
    }
    this.ctx.fx.number({ x: pp.x, y: pp.y + 0.4, z: pp.z }, amt, res.crit ? 0xffd040 : 0xffffff, res.crit ? 1.4 : 1.05);
    this.ctx.events.emit('enemyHit', this, hit, amt, res);
    if (m.share <= 0.5) this.knockDown(m);
    return amt;
  }
  private knockDown(m: Member) {
    const ctx = this.ctx;
    m.share = 0;
    m.down = 0.001;
    m.busy = false;
    m.script = false;
    ctx.sfx('scarab_squish', m.pos, 0.9, 0.8);
    ctx.sfx('boss_hurt', m.pos, 0.6, 1.5);
    ctx.fx.sandBurst(this.memberAt(m, _v, 0), 0.8);
    ctx.toast(`${NAMES[m.i].toUpperCase()} IS DOWN`, '#ffd070', this.up().length ? 'The others will pick him up' : '', false);
    if (!this.up().length) this.fork(this.combine());
  }
  /** With a Little Help from My Friends: a member down too long is helped back up */
  private updateDowns(dt: number) {
    for (const m of this.m) {
      if (m.down <= 0) continue;
      m.down += dt;
      if (m.down > 9.5 && this.up().length && this.form === 'band') {
        m.down = 0;
        const back = m.shareMax * 0.4;
        m.share = back;
        this.hp = Math.min(this.maxHp, this.hp + back);
        song(this, 'With a Little Help from My Friends', 'The Beatles', '#ffd070');
        this.ctx.sfx('heal', m.pos, 0.8, 1.2);
        this.ctx.particles.emit({ pos: this.memberAt(m, _v, 0.8), count: 14, spread: 1.6, up: 2, life: [0.6, 1.1], size: [0.14, 0.04], sprite: 'star4', color: GOLDC, additive: true, drag: 1.2 });
      }
    }
  }

  // ------------------------------------------------------------------ Magical Mystery Tour: the colossus
  private async combine() {
    if (this.form !== 'band') return;
    this.form = 'combining';
    const ctx = this.ctx, cam = this.d.cam, eng = ctx.engine;
    this.invulnerable = true;
    this.stop();
    this.phase = 1;
    super.onPhase(1);
    stinger('bossIntro');
    eng.letterbox(true, 0.5);
    const bx = this.pos.x, bz = this.pos.z, g = this.ground();
    const pp = this.playerPos();
    const dx = bx - pp.x, dz = bz - pp.z, dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    const camPos = new THREE.Vector3(bx - ux * 15 + uz * 6, 0, bz - uz * 15 - ux * 6);
    camPos.y = this.ground(camPos.x, camPos.z) + 2;
    const look = new THREE.Vector3(bx, g + 3, bz);
    cam.setCine({ pos: camPos, look, fov: 54 });
    song(this, 'Magical Mystery Tour', 'The Beatles', '#ffd070');
    // they pick themselves up, open their wings, and spiral up together
    for (const m of this.m) {
      m.down = 0;
      m.script = true;
      m.fly = 1;
    }
    this.band.setPartVisible('b3_kit', false);
    ctx.sfx('swarm_loop', this.pos, 1, 1.1);
    const from = this.m.map((m) => m.pos.clone());
    const T = 2.4;
    for (let t = 0; t < T; t += 0.05) {
      const k = t / T, e = k * k * (3 - 2 * k);
      for (const m of this.m) {
        const a = m.i * (Math.PI / 2) + k * Math.PI * 4;
        const R = (1 - e) * 5 + 1.2 * (1 - k);
        m.pos.set(from[m.i].x * (1 - e) + (bx + Math.cos(a) * R) * e, 0, from[m.i].z * (1 - e) + (bz + Math.sin(a) * R) * e);
        m.air = e * 6.5;
        m.yaw = a + Math.PI / 2;
        if (rnd.chance(0.5)) ctx.particles.emit({ pos: this.memberAt(m, _v, 0.6), count: 1, spread: 0.3, life: [0.5, 0.9], size: [0.12, 0.03], sprite: 'star4', color: GOLDC, additive: true });
      }
      look.y = g + 3 + e * 5;
      await this.waitRaw(0.05);
    }
    // the flash: the band becomes the machine
    eng.flash(0xfff0c0, 0.85, 0.6);
    ctx.fx.light({ x: bx, y: g + 7, z: bz }, GOLDC, 10, 0.8, 40);
    ctx.sfx('explosion_big', { x: bx, y: g + 6, z: bz }, 0.9, 1.1);
    ctx.shake(0.8);
    this.root.remove(this.band.root);
    this.root.add(this.mech.root);
    this.rig = this.mech;
    this.eyes = new RigEyes(this.mech, 'glow', 0xffc040);
    this.mechAnim.grow = 0.25;
    this.height = 8.8;
    this.radius = 3.4;
    this.hitSpheres = [
      { node: 'torso', offset: [0, 1.2, 0.2], r: 2.0, part: 'torso' },
      { node: 'disc', offset: [0, 0.05, 0.12], r: 0.85, part: 'disc', weak: 2.2 },
      { node: 'head', offset: [0, 0.4, 0.3], r: 1.1, part: 'head', weak: 1.8 },
      { node: 'pelvis', offset: [0, 0, -0.1], r: 1.6, part: 'pelvis' },
      { node: 'thigh_l', offset: [0, -0.6, 0.1], r: 0.7, part: 'thigh_l' },
      { node: 'thigh_r', offset: [0, -0.6, 0.1], r: 0.7, part: 'thigh_r' },
      { node: 'fist_l', offset: [0, -0.2, 0.1], r: 0.8, part: 'fist_l' },
      { node: 'fist_r', offset: [0, -0.6, 0], r: 0.9, part: 'fist_r' },
    ];
    this.name = 'The Scarab Colossus';
    this.title = "Sgt. Scarab's Lonely Hearts Engine";
    this.faceTarget(pp);
    // it assembles: plates clamp on with every clank
    for (let k = 0; k < 4; k++) {
      ctx.sfx('counter_clang', { x: bx, y: g + 4, z: bz }, 0.8, 0.6 + k * 0.08);
      ctx.sfx('lever_cycle', { x: bx, y: g + 3, z: bz }, 0.5, 0.7);
      ctx.shake(0.25);
      ctx.particles.emit({ pos: { x: bx, y: g + 4, z: bz }, count: 10, spread: 6, up: 2, life: [0.3, 0.6], size: [0.14, 0.03], sprite: 'spark', color: 0xffd8a0, additive: true });
      await this.waitRaw(0.22);
    }
    // the roar, low under the head
    this.root.updateMatrixWorld(true);
    const head = socketAt(this, 'head', new THREE.Vector3());
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    cam.setCine({ pos: new THREE.Vector3(head.x + hx * 13 + hz * 5, Math.max(head.y - 4.5, this.ground() + 1.2), head.z + hz * 13 - hx * 5), look: head.clone(), fov: 46 });
    ctx.sfx('boss_roar', this.pos, 1, 0.5);
    ctx.shake(0.7);
    ctx.world.sand.ring(bx, bz, { speed: 11, height: 0.7, width: 2, life: 1.6 });
    this.taunt('All together now: one, two, three, FOUR!', '#ffe08a');
    this.form = 'colossus';
    ctx.events.emit('bossIntro', this);
    await this.waitRaw(1.8);
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.invulnerable = false;
  }

  // ------------------------------------------------------------------ the colossus' songs
  private async maxwell() {
    song(this, "Maxwell's Silver Hammer", 'The Beatles', '#e8eef8');
    for (let k = 0; k < 2 + (this.phase >= 2 ? 1 : 0); k++) {
      this.hammerUp = 1;
      const pp = this.playerPos(), pv = this.player.board.vel;
      const at = new THREE.Vector3(pp.x + pv.x * 0.45, 0, pp.z + pv.z * 0.45);
      this.faceTarget(at);
      const warn = k === 0 ? 1.1 : 0.8;
      this.ctx.engine.tweens.after(warn - 0.18, () => (this.mechAnim.slamR = 1));
      await this.slam(at, 4.2, 30 * this.dmgK, warn, 'sand');
      this.hammerUp = 0;
      this.ctx.sfx('counter_clang', at, 1, 0.5);
      this.ctx.world.sand.ring(at.x, at.z, { speed: 9, height: 0.45, width: 1.4, life: 1 });
      await this.waitRaw(0.25);
      this.mechAnim.slamR = 0;
    }
  }
  private async hammerToFall() {
    const ctx = this.ctx;
    song(this, 'Hammer to Fall', 'Queen', '#e8eef8');
    const pp = this.playerPos();
    this.faceTarget(pp);
    const yaw = this.yaw;
    this.d.enemies.warn.wedge(this.pos.x, this.pos.z, yaw, 18, 0.32, 1.05, 'heavy');
    this.mechAnim.lift = 1;
    await this.waitRaw(0.95);
    this.mechAnim.slamL = this.mechAnim.slamR = 1;
    await this.waitRaw(0.1);
    ctx.shake(0.7);
    ctx.sfx('explosion_big', this.pos, 0.8, 0.8);
    for (let k = 1; k <= 6; k++) {
      const x = this.pos.x + Math.sin(yaw) * k * 3, z = this.pos.z + Math.cos(yaw) * k * 3;
      ctx.engine.tweens.after(k * 0.05, () => {
        ctx.fx.sandBurst({ x, y: this.ground(x, z), z }, 1.4);
        ctx.world.deform(x, z, 1.6, 0.4);
      });
    }
    const pl = this.player.pos;
    const rx = pl.x - this.pos.x, rz = pl.z - this.pos.z, rd = Math.hypot(rx, rz);
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(rx, rz) - yaw), Math.cos(Math.atan2(rx, rz) - yaw)));
    if (rd < 18 && ang < 0.34 && pl.y < this.ground(pl.x, pl.z) + 2.5) this.player.takeHit({ base: 32 * this.dmgK, kind: 'phys', source: 'contact', knock: 13 }, this.pos.clone());
    await this.waitRaw(0.5);
    this.mechAnim.lift = 0;
    this.mechAnim.slamL = this.mechAnim.slamR = 0;
  }
  private async digAPony() {
    const ctx = this.ctx;
    song(this, 'Dig a Pony', 'The Beatles', '#ffd070');
    this.invulnerable = true;
    for (let t = 0; t < 1; t += 0.05) {
      this.mechAnim.dig = t;
      if (rnd.chance(0.6)) ctx.fx.sandSpray({ x: this.pos.x, y: this.ground(), z: this.pos.z }, { x: rnd.range(-1, 1), y: 1.5, z: rnd.range(-1, 1) }, 2);
      await this.waitRaw(0.05);
    }
    this.mechAnim.dig = 1;
    this.root.visible = false;
    // the ripple hunts the hunter, then the mark locks
    const hunt = 2.4;
    const mark = this.d.enemies.warn.circle(this.player.pos.x, this.player.pos.z, 4.4, hunt + 0.7, 'heavy', () => ({ x: this.player.pos.x, z: this.player.pos.z }), hunt);
    for (let t = 0; t < hunt; t += 0.05) {
      const pp = this.player.pos;
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
      const step = Math.min(dl, 13 * 0.05);
      this.pos.x += (dx / dl) * step;
      this.pos.z += (dz / dl) * step;
      if (rnd.chance(0.7)) ctx.fx.sandSpray({ x: this.pos.x, y: this.ground(), z: this.pos.z }, { x: 0, y: 1.2, z: 0 }, 1.6);
      await this.waitRaw(0.05);
    }
    const lx = mark.x, lz = mark.z;
    await this.waitRaw(0.7);
    this.pos.set(lx, this.ground(lx, lz), lz);
    this.root.visible = true;
    this.invulnerable = false;
    this.mechAnim.dig = 0;
    ctx.fx.sandBurst({ x: lx, y: this.ground(lx, lz), z: lz }, 2.4);
    ctx.world.sand.ring(lx, lz, { speed: 10, height: 0.8, width: 2, life: 1.2 });
    ctx.sfx('sand_burst', this.pos, 1, 0.6);
    ctx.shake(0.8);
    const pl = this.player.pos;
    if (Math.hypot(pl.x - lx, pl.z - lz) < 4.4 && pl.y < this.ground(lx, lz) + 3) {
      this.player.takeHit({ base: 30 * this.dmgK, kind: 'phys', source: 'contact', knock: 12 }, this.pos.clone());
      this.player.board.impulse.y += 9;
    }
    this.squash.kick(4);
    await this.waitRaw(0.6);
  }
  private async aDayInTheLife() {
    const ctx = this.ctx;
    song(this, 'A Day in the Life', 'The Beatles', '#ffd070');
    // the crescendo: the disc winds up, its pitch rising
    for (let k = 0; k < 6; k++) {
      this.mechAnim.disc = (k + 1) / 6;
      ctx.sfx('divine_power', this.pos, 0.35, 0.6 + k * 0.15);
      await this.waitRaw(0.2);
    }
    const arms = this.phase >= 2 ? 3 : 2;
    const dur = 3;
    let a0 = rnd.next() * Math.PI * 2;
    const dirn = rnd.chance(0.5) ? 1 : -1;
    for (let t = 0; t < dur; t += 0.12) {
      const from = socketAt(this, 'disc_c', _w);
      a0 += dirn * 0.23;
      for (let k = 0; k < arms; k++) {
        const a = a0 + (k / arms) * Math.PI * 2;
        this.d.enemies.proj.spawn({ kind: 'curse', x: from.x, y: Math.max(from.y - 3.5, this.ground() + 1.1), z: from.z, vx: Math.sin(a) * 9, vy: 0, vz: Math.cos(a) * 9, dmg: 9 * this.dmgK, sourceId: this.id, life: 3.2 });
      }
      await this.waitRaw(0.12);
    }
    this.mechAnim.disc = 0;
  }
  private async forThoseAboutToRock() {
    const ctx = this.ctx;
    song(this, 'For Those About to Rock (We Salute You)', 'AC/DC', '#ffd070');
    this.mechAnim.cannon = 1;
    await this.waitRaw(0.5);
    const n = 6 + this.phase * 2;
    for (let k = 0; k < n; k++) {
      const pp = this.playerPos(), pv = this.player.board.vel;
      const a = rnd.next() * Math.PI * 2, r = k === 0 ? 0 : 1.5 + rnd.next() * 6;
      const x = pp.x + pv.x * 0.7 + Math.cos(a) * r, z = pp.z + pv.z * 0.7 + Math.sin(a) * r;
      const muzzle = socketAt(this, k % 2 ? 'muzzle_l' : 'muzzle_r', new THREE.Vector3());
      ctx.sfx('explosion', muzzle, 0.6, 1.4);
      ctx.particles.emit({ pos: muzzle, count: 8, spread: 1.5, up: 3, life: [0.6, 1.1], size: [0.6, 1.4], sprite: ['puff0', 'cloud0'], color: 0x8a8070, alpha: 0.6, drag: 1.4 });
      this.fork(this.slam(new THREE.Vector3(x, 0, z), 2.8, 20 * this.dmgK, 1.15, 'fire'));
      await this.waitRaw(0.22);
    }
    await this.waitRaw(0.9);
    this.mechAnim.cannon = 0;
  }
  private async kashmir() {
    song(this, 'Kashmir', 'Led Zeppelin', '#ffd070');
    for (let k = 0; k < 6; k++) {
      const pp = this.playerPos();
      this.faceTarget(pp);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const side = k % 2 ? 1 : -1;
      const foot = new THREE.Vector3(this.pos.x + fx * 3.4 + fz * side * 1.4, 0, this.pos.z + fz * 3.4 - fx * side * 1.4);
      this.mechAnim.step = side;
      this.moveSpeed = 0;
      const go = this.slam(foot, 3.6, 22 * this.dmgK, 0.5, 'sand');
      for (let t = 0; t < 0.5; t += 0.05) {
        this.pos.x += fx * 6 * 0.05;
        this.pos.z += fz * 6 * 0.05;
        await this.waitRaw(0.05);
      }
      await go;
      this.ctx.world.sand.ring(foot.x, foot.z, { speed: 7, height: 0.4, width: 1.2, life: 0.8 });
    }
    this.mechAnim.step = 0;
  }

  protected onPhase(p: number) {
    if (p === 2) {
      super.onPhase(p);
      song(this, 'Welcome to the Machine', 'Pink Floyd', '#ffd070');
      this.haste = 0.75;
      this.mechAnim.elytra = 1;
      this.ctx.sfx('lever_cycle', this.pos, 1, 0.5);
      for (let k = 0; k < 3; k++) this.ctx.engine.tweens.after(k * 0.3, () => this.ctx.particles.emit({ pos: socketAt(this, 'torso', new THREE.Vector3()), count: 14, spread: 3, up: 4, life: [1.2, 2], size: [1, 2.6], sprite: ['cloud0', 'puff1'], color: 0xf0ece4, alpha: 0.6, drag: 1.2, gravity: -0.6 }));
    }
  }

  // ------------------------------------------------------------------ death: All You Need Is Love
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.form = 'dead';
    this.stop();
    const ctx = this.ctx;
    ctx.engine.slowMo(0.2, 30);
    ctx.engine.tweens.after(0.9, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.7);
    ctx.shake(0.8);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    void this.deathSequence().catch((e) => console.error(e));
  }
  private async deathSequence() {
    const ctx = this.ctx, eng = ctx.engine, cam = this.d.cam;
    const w = (s: number) => eng.tweens.wait(s);
    eng.letterbox(true, 0.4);
    const bx = this.pos.x, bz = this.pos.z, g = this.ground();
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    cam.setCine({ pos: new THREE.Vector3(bx + fx * 16 + fz * 6, g + 2.6, bz + fz * 16 - fx * 6), look: new THREE.Vector3(bx, g + 4, bz), fov: 50 });
    // it kneels, sparking, shedding plates
    for (let t = 0; t < 1.4; t += 1 / 30) {
      this.mechAnim.kneel = Math.min(1, t / 1.1);
      if (rnd.chance(0.25)) {
        const p = { x: bx + rnd.range(-3, 3), y: g + 2 + rnd.next() * 6, z: bz + rnd.range(-3, 3) };
        ctx.fx.explosion(p, 1.2);
        ctx.particles.emit({ pos: p, count: 6, spread: 4, up: 3, life: [0.6, 1.2], size: [0.2, 0.08], sprite: ['chip', 'rock'], color: [0xf2c443, 0xa8742e, 0x3a62b8], gravity: 12, ground: true, bounce: 0.3, rot: 6, rotSpeed: 8 });
      }
      await w(1 / 30);
    }
    ctx.sfx('explosion_big', this.pos, 0.9, 0.7);
    eng.flash(0xfff0c0, 0.6, 0.5);
    // the machine melts away and the four fly out of its chest
    const chest = socketAt(this, 'chest', new THREE.Vector3());
    const mfx = this.mech.material.userData.fx.value;
    this.ctx.scene.attach(this.mech.root);
    this.root.add(this.band.root);
    this.rig = this.band;
    this.root.quaternion.identity();
    this.yaw = 0;
    for (const m of this.m) {
      m.visible = true;
      m.down = 0;
      m.script = true;
      m.fly = 1;
      m.pos.set(chest.x, 0, chest.z);
      m.air = chest.y - g - 0.8;
    }
    this.band.setPartVisible('b3_kit', false);
    song(this, 'All You Need Is Love', 'The Beatles', '#ffd070');
    const pp = this.playerPos();
    const dx = pp.x - bx, dz = pp.z - bz, dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    const row = (i: number) => new THREE.Vector3(bx + ux * 5 + uz * (i - 1.5) * 2, 0, bz + uz * 5 - ux * (i - 1.5) * 2);
    const start = this.m.map((m) => ({ p: m.pos.clone(), a: m.air }));
    for (let t = 0; t < 1.6; t += 1 / 30) {
      const k = Math.min(1, t / 1.4), e = 1 - (1 - k) ** 2;
      mfx.y = Math.min(1, t / 1.4);
      for (const m of this.m) {
        m.pos.lerpVectors(start[m.i].p, row(m.i), e);
        m.air = start[m.i].a * (1 - e) + Math.sin(k * Math.PI) * 1.5;
        m.yaw = Math.atan2(dx, dz);
      }
      await w(1 / 30);
    }
    this.mech.root.removeFromParent();
    const cam2 = new THREE.Vector3(bx + ux * 11, g + 1.4, bz + uz * 11);
    cam.setCine({ pos: cam2, look: new THREE.Vector3(bx + ux * 5, g + 1, bz + uz * 5), fov: 42 });
    for (const m of this.m) {
      m.air = 0;
      m.fly = 0;
      m.yaw = Math.atan2(dx, dz);
    }
    await w(0.5);
    // they bow together
    for (let t = 0; t < 1.6; t += 1 / 30) {
      const b = Math.sin(Math.min(1, t / 1.4) * Math.PI);
      for (const m of this.m) m.bow = b;
      await w(1 / 30);
    }
    ctx.sfx('divine_chime', this.pos, 0.8, 1.1);
    // and leave for the sun
    const bfx = this.band.material.userData.fx.value;
    for (const m of this.m) m.fly = 1;
    for (let t = 0; t < 1.6; t += 1 / 30) {
      for (const m of this.m) {
        m.air += (2 + m.i * 0.6) / 30 * (1 + t * 3);
        m.pos.x -= ux * 0.12;
        m.pos.z -= uz * 0.12;
        if (rnd.chance(0.4)) ctx.particles.emit({ pos: this.memberAt(m, _v, 0.6), count: 1, spread: 0.2, life: [0.5, 0.9], size: [0.14, 0.03], sprite: 'star4', color: GOLDC, additive: true });
      }
      bfx.y = Math.max(0, (t - 0.8) / 0.8);
      await w(1 / 30);
    }
    this.root.visible = false;
    ctx.fx.coins({ x: bx, y: g + 1, z: bz }, 44);
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.onDefeated?.(this, false);
    this.dispose();
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.beatT += dt;
    const nb = Math.floor(this.beatT / BEAT);
    const newBeat = nb !== this.beatN;
    this.beatN = nb;
    this.spin += dt * 0.22;
    this.updateDowns(dt);
    const bandForm = this.form === 'band' || this.form === 'combining' || this.form === 'dead';
    if (bandForm && this.rig === this.band) {
      // the band: the stage centre moves; members walk to their slots on it
      for (const m of this.m) {
        m.hitT += dt;
        if (m.script || m.down > 0) {
          m.spd = 0;
          continue;
        }
        this.slot(m.i, _v);
        const dx = _v.x - m.pos.x, dz = _v.z - m.pos.z, d = Math.hypot(dx, dz);
        const sp = Math.min(d, 6 * dt);
        if (d > 0.01) {
          m.pos.x += (dx / d) * sp;
          m.pos.z += (dz / d) * sp;
        }
        m.walk += sp * 3.2;
        m.spd = sp / Math.max(dt, 1e-3);
        const pp = this.player.pos;
        m.yaw = dampAngle(m.yaw, Math.atan2(pp.x - m.pos.x, pp.z - m.pos.z), 5, dt);
        // contact: a member you ride into hurts you (or you bowl it over at speed)
        m.contact -= dt;
        if (this.alive && !this.invulnerable && m.contact <= 0 && Math.hypot(pp.x - m.pos.x, pp.z - m.pos.z) < 0.85 && Math.abs(pp.y - this.ground(m.pos.x, m.pos.z)) < 1.6) {
          m.contact = 1;
          if (this.player.speed > 14) this.takeDamage({ base: this.player.speed * 1.2, kind: 'phys', source: 'board', knock: 0, tags: [`m${m.i}`] });
          else this.player.takeHit({ base: 10 * this.dmgK, kind: 'phys', source: 'contact', knock: 9 }, m.pos.clone());
        }
      }
      // no body contact at the empty stage centre: the members carry it (restored after the base update)
      const r = this.radius;
      this.radius = 0.01;
      this.yaw = 0;
      super.update(dt);
      this.radius = r;
      this.yaw = 0;
      this.root.quaternion.identity();
    } else super.update(dt);
    if (newBeat) this.onBeatFx();
  }
  private onBeatFx() {
    if (this.form === 'band' && this.alive && this.m[3].down <= 0 && this.m[3].visible && !this.m[3].script && this.beatN % 2 === 0) this.ctx.sfx('punch', this.m[3].pos, 0.22, 0.55);
  }

  // ------------------------------------------------------------------ procedural animation
  protected animate(dt: number) {
    if (this.rig === this.band) this.animateBand(dt);
    else this.animateMech(dt);
    const fxv = this.rig.material.userData.fx.value;
    fxv.x = this.flash * 0.7;
  }
  private animateBand(dt: number) {
    const n = this.band.nodes;
    const t = this.t;
    const ph = (this.beatT / BEAT) % 1;
    const bob = Math.abs(Math.sin(ph * Math.PI));
    const gy = this.pos.y;
    for (const m of this.m) {
      const P = `b${m.i}_`;
      const body = n[P + 'body'];
      if (!body) continue;
      body.visible = m.visible;
      const g = this.ground(m.pos.x, m.pos.z);
      const hitK = Math.max(0, 1 - m.hitT / 0.25);
      const down = m.down > 0;
      const sit = m.i === 3 && !m.fly && !down && !m.script;
      const moving = m.script && !m.fly;
      const walkAmp = moving ? 1 : clamp(m.spd / 2.5, 0, 1);
      // the body: placed on the sand (rig space is world-aligned here: yaw 0)
      const lieY = down ? 0.28 : 0;
      body.position.set(m.pos.x - this.pos.x, g - gy + m.air + 16 / 30 + (down ? lieY - 16 / 30 + 0.2 : bob * 0.05 * (sit ? 0.4 : 1) - (sit ? 0.12 : 0)), m.pos.z - this.pos.z);
      body.rotation.set(down ? -Math.PI / 2 - 0.25 : m.bow * 0.75 - hitK * 0.3 + (m.fly ? 0.35 : 0), m.yaw, down ? Math.sin(t * 9 + m.i) * 0.12 : Math.sin(t * 1.3 + m.i) * 0.03);
      const torso = n[P + 'torso'], head = n[P + 'head'];
      if (torso) torso.rotation.set(m.bow * 0.3 + bob * 0.04, Math.sin(ph * Math.PI * 2) * 0.06, 0);
      if (head) head.rotation.set(Math.sin(ph * Math.PI * 2) * 0.16 - m.bow * 0.2 + hitK * 0.3, Math.sin(t * 0.7 + m.i) * 0.2, Math.sin(ph * Math.PI * 2 + m.i) * 0.08);
      for (const s of ['l', 'r']) {
        const sg = s === 'l' ? 1 : -1;
        const ant = n[P + 'ant_' + s];
        if (ant) ant.rotation.set(Math.sin(t * 4 + m.i + sg) * 0.18, 0, sg * Math.sin(t * 3.1 + m.i) * 0.15);
        const ely = n[P + 'elytra_' + s], wing = n[P + 'wing_' + s];
        const open = m.fly ? 1 : down ? 0.3 : 0.04 * bob;
        if (ely) ely.rotation.set(-open * 0.35, sg * open * 0.95, sg * open * 0.3);
        if (wing) {
          wing.visible = !!m.fly;
          if (m.fly) wing.rotation.set(-0.3, sg * 1.1, sg * (0.4 + Math.sin(t * 70 + m.i) * 0.5));
        }
        // hind legs: stand, walk, sit (drummer), kick on the back (down), dangle in flight
        const leg = n[P + 'leg_' + s], shin = n[P + 'shin_' + s];
        const w = m.walk + (s === 'l' ? 0 : Math.PI);
        let lx = Math.sin(w) * 0.5 * walkAmp, sx = Math.max(0, Math.sin(w + 1.2)) * 0.7 * walkAmp;
        if (sit) (lx = -1.45), (sx = 1.5 + (s === 'r' && ph < 0.25 ? 0.15 : 0));
        if (down) (lx = -0.8 + Math.sin(t * 14 + sg) * 0.5), (sx = 0.8 + Math.sin(t * 12 + sg) * 0.4);
        if (m.fly) (lx = 0.3), (sx = 0.5);
        if (!sit && !down && !moving && !m.fly && s === 'r') sx = Math.max(0, Math.sin(ph * Math.PI * 2)) * 0.25; // tapping a foot
        if (leg) leg.rotation.set(lx - m.bow * 0.3, 0, sg * 0.05);
        if (shin) shin.rotation.set(sx, 0, 0);
      }
      // arms by instrument
      const arm = (s: 'l' | 'r', x: number, z: number, f: number) => {
        const a = n[P + 'arm_' + s], fo = n[P + 'fore_' + s];
        if (a) a.rotation.set(x, 0, z);
        if (fo) fo.rotation.set(f, 0, 0);
      };
      const strum = Math.sin(ph * Math.PI * 4);
      if (down) {
        arm('l', -1.6 + Math.sin(t * 13) * 0.4, 0.3, 0.5);
        arm('r', -1.6 + Math.sin(t * 11) * 0.4, -0.3, 0.5);
      } else if (m.fly && m.i !== 3) {
        arm('l', -0.6, 0.4, -0.4);
        arm('r', -0.6, -0.4, -0.4);
      } else if (m.i === 0 || m.i === 2) {
        // right-handed: the left hand frets up the neck, the right strums the body
        arm('l', -0.85 + Math.sin(t * 2.2) * 0.08, 0.55, -0.9);
        arm('r', -0.5 + strum * 0.22, -0.1, -0.6 + strum * 0.35);
      } else if (m.i === 1) {
        // the bass is played left-handed
        arm('r', -0.85 + Math.sin(t * 2.2) * 0.08, -0.55, -0.9);
        arm('l', -0.5 + strum * 0.22, 0.1, -0.6 + strum * 0.35);
      } else {
        // the drummer: alternating sticks on the beat, a crash on the bar
        const hitL = Math.max(0, Math.sin(ph * Math.PI * 2)), hitR = Math.max(0, -Math.sin(ph * Math.PI * 2));
        const bar = (this.beatN % 4 === 0 ? 1 : 0) * (1 - ph);
        arm('l', -0.9 - hitL * 0.5 - bar * 0.6, 0.35, -0.5 + hitL * 0.4);
        arm('r', -0.9 - hitR * 0.5, -0.35, -0.5 + hitR * 0.4);
      }
    }
  }
  private animateMech(dt: number) {
    const n = this.mech.nodes;
    const t = this.t;
    const A = this.mechAnim;
    A.grow = damp(A.grow, 1, 5, dt);
    this.mech.root.scale.setScalar(A.grow);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim.walk += dt * (1.2 + sp * 0.9);
    const w = this.anim.walk;
    const stride = clamp(sp / 3, 0, 1) + Math.abs(A.step) * 0.6;
    const kneel = A.kneel;
    const dig = A.dig;
    const hitK = Math.max(0, 1 - this.hitT / 0.3);
    if (n.pelvis) {
      const p0 = this.mech.geo.parts[this.mech.geo.index['pelvis']].offset;
      n.pelvis.position.set(p0.x, p0.y - kneel * 1.4 - dig * 3.2 + Math.abs(Math.sin(w)) * 0.12 * stride, p0.z);
      n.pelvis.rotation.set(kneel * 0.15 + dig * 0.4, Math.sin(w) * 0.06 * stride, Math.sin(w) * 0.04 * stride);
    }
    for (const s of ['l', 'r']) {
      const sg = s === 'l' ? 1 : -1;
      const ww = w + (s === 'l' ? 0 : Math.PI);
      const th = n['thigh_' + s], sh = n['shin_' + s], ft = n['foot_' + s];
      if (th) th.rotation.set(-Math.sin(ww) * 0.45 * stride - kneel * 1.2 - dig * 0.6, 0, sg * 0.04);
      if (sh) sh.rotation.set(Math.max(0, Math.sin(ww + 1.2)) * 0.6 * stride + kneel * 1.5 + dig * 0.8, 0, 0);
      if (ft) ft.rotation.set(-kneel * 0.3, 0, 0);
      // arms: swing, lift for the hammers, slam down
      const arm = n['arm_' + s], fore = n['fore_' + s], fist = n['fist_' + s];
      const slam = s === 'l' ? A.slamL : A.slamR;
      const raise = Math.max(A.lift, s === 'r' ? this.hammerUp : 0);
      const ax = Math.sin(ww + Math.PI) * 0.25 * stride - raise * 2.4 * (1 - slam) - slam * 0.9 + kneel * 0.4 + Math.sin(t * 1.1 + sg) * 0.05;
      if (arm) arm.rotation.set(ax, 0, sg * (0.18 + raise * 0.2 - kneel * 0.1));
      if (fore) fore.rotation.set(-0.35 - raise * 0.4 * (1 - slam) + slam * 0.2, 0, 0);
      if (fist) fist.rotation.set(Math.sin(t * 2 + sg) * 0.06, 0, 0);
      const can = n['cannon_' + s];
      if (can) can.rotation.set(-A.cannon * 0.5 + Math.sin(t * 1.7 + sg) * 0.03, 0, -sg * A.cannon * 0.15);
      const ely = n['elytra_' + s];
      if (ely) ely.rotation.set(-A.elytra * 0.3, sg * A.elytra * 0.7, sg * A.elytra * 0.2);
      const mand = n['mand_' + s];
      if (mand) mand.rotation.set(0, sg * (0.15 + Math.max(0, Math.sin(t * 7)) * 0.25 * (A.disc + A.lift)), 0);
      const ant = n['ant_' + s];
      if (ant) ant.rotation.set(Math.sin(t * 2.6 + sg) * 0.12, 0, sg * Math.sin(t * 1.9) * 0.1);
    }
    if (n.torso) n.torso.rotation.set(0.04 + kneel * 0.35 - A.lift * 0.12 + A.slamR * 0.2 - hitK * 0.15, Math.sin(w) * 0.05 * stride, Math.sin(t * 0.8) * 0.02);
    if (n.head) {
      const pp = this.player.pos;
      const want = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z) - this.yaw;
      const ly = Math.atan2(Math.sin(want), Math.cos(want));
      n.head.rotation.set(kneel * 0.5 + Math.sin(t * 1.3) * 0.04 + hitK * 0.2, clamp(ly, -0.6, 0.6), Math.sin(t * 0.9) * 0.04);
    }
    if (n.disc) n.disc.rotation.z += dt * (0.6 + A.disc * 12);
  }

  dispose() {
    this.band.dispose();
    this.mech.dispose();
    super.dispose();
  }
}
