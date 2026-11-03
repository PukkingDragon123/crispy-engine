// The meerkat colony: a sandy warren whose residents pop out of their burrows
// on staggered timers (rise, look around in quick sentinel snaps, hop out to
// stand guard, groom, chatter) and dive for cover when you rush in, shoot
// nearby or enemies come close. A sentinel keeps watch from the lookout rock
// and barks the alarm. The band — Sgt. Peppercorn's Lonely Burrows Club Band —
// pops up in its own burrows by the trading stall when you come near and hops
// out to play (and dance) when you walk up. Mama Mim runs the swap counter.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { MeerkatColony, findClearSpot } from '../run/MeerkatColony';
//   field:   colony: MeerkatColony | null = null;
//   spawn:   once per sub-area, in populateZone(z) (the zone's props/colliders already exist there):
//              if (!this.colony && z.index === 1) {
//                const s = findClearSpot(this.ctx, z);
//                if (s) this.colony = new MeerkatColony({ ctx: this.ctx, player: this.player, inter: this.inter,
//                  items: this.items, cam: this.camRig, input: this.engine.input, x: s.x, z: s.z, rot: s.rot });
//              }
//            (findClearSpot: no solid colliders within 4.4 m, gentle dry ground; rot faces the zone centre)
//   update:  in update(), right after `this.shop.update(rdt);` add:
//              this.colony?.update(dt, rdt);
//            (before the `if (modal) return`, so the swap counter and the meerkats keep animating
//            while the world is paused for the trade)
//   modal:   const modal = this.choice.active || this.shop.active || this.ledger.open || !!this.colony?.modal;
//            and add `|| this.colony?.modal` to the hud `prompt:` null-condition in updateHud().
//   exit():  this.colony?.dispose();
// The colony registers its own Interactable ("Swap with the meerkats" at the stall), its own solid
// colliders (rock + stall), listens to ctx.events 'shot' / 'explosion', hands the camera to the
// counter while trading (camRig.setCine, released on close) and applies swaps to player.items.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Interactable } from './Interact';
import type { Input } from '../../engine/Input';
import type { CameraRig } from '../player/CameraRig';
import type { Collider } from '../world/Colliders';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { meerkatRig, beatleMeerkatRig, BEATLE_IDS, BEATLES, BAND_NAME } from '../models/creatures/meerkat';
import { meerkatWarrenModel, meerkatStallModel, BurrowHole } from '../models/creatures/colony';
import { MeerkatAnim, MeerkatMode } from '../models/creatures/anim';
import { MeerkatTrade, buildOffers, InventoryLike, TradeReaction } from '../ui/MeerkatTrade';
import { Voice } from '../audio/Voice';

export interface ColonyPlayer {
  pos: THREE.Vector3;
  alive: boolean;
  board: { vel: { x: number; z: number } };
}
export interface ColonyInteractions {
  add(i: Interactable): Interactable;
  remove(i: Interactable): void;
  current: Interactable | null;
}
export interface MeerkatColonyDeps {
  ctx: Ctx;
  player: ColonyPlayer;
  inter: ColonyInteractions;
  items: InventoryLike;
  cam: CameraRig;
  input: Input;
  x: number;
  z: number;
  /** yaw the colony front (stall) faces */
  rot?: number;
}

type KatState = 'hidden' | 'rise' | 'peek' | 'hopOut' | 'out' | 'hopIn' | 'dive' | 'rock' | 'bark' | 'hopUp' | 'hopDown' | 'pit' | 'stage' | 'counter';
type Role = 'pop' | 'pup' | 'rock' | 'band' | 'trader';
interface Kat {
  rig: RigInstance;
  anim: MeerkatAnim;
  role: Role;
  hole: BurrowHole;
  /** where it stands when out (colony-local) */
  spot: THREE.Vector3;
  state: KatState;
  t: number;
  dur: number;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  hopH: number;
  yaw: number;
  wait: number;
  scale: number;
  delay: number;
  mode: MeerkatMode;
  modeUntil: number;
  next: KatState;
}

/**
 * A clear, gentle spot inside a zone for the colony / the jerboa: no solid colliders within
 * `clear` metres, ground varying < 0.7 m over the footprint, not under water. Faces the zone
 * centre. Returns null if nothing suitable turns up.
 */
export function findClearSpot(ctx: Ctx, zone: { cx: number; cz: number; r: number }, clear = 4.4, rnd: () => number = Math.random): { x: number; z: number; rot: number } | null {
  const sa = (ctx.world as any).sa;
  for (let tries = 0; tries < 48; tries++) {
    const a = rnd() * Math.PI * 2, d = zone.r * (0.3 + rnd() * 0.45);
    const x = zone.cx + Math.cos(a) * d, z = zone.cz + Math.sin(a) * d;
    let blocked = false;
    ctx.world.colliders.query(x, z, clear + 2, (c) => {
      if (c.enabled && c.solid && Math.hypot(c.x - x, c.z - z) < c.r + clear) blocked = true;
    });
    if (blocked) continue;
    let lo = 1e9, hi = -1e9, wet = false;
    for (const [ox, oz] of [[0, 0], [2.6, 0], [-2.6, 0], [0, 2.4], [0, -2.4], [1.8, 1.8], [-1.8, -1.8]]) {
      const g = ctx.world.groundAt(x + ox, z + oz);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      if (sa?.field?.heightAt && sa.waterLevel !== undefined && sa.field.heightAt(x + ox, z + oz) < sa.waterLevel + 0.05) wet = true;
    }
    if (hi - lo > 0.7 || wet) continue;
    return { x, z, rot: Math.atan2(zone.cx - x, zone.cz - z) };
  }
  return null;
}

const BPM = 116;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const outBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class MeerkatColony {
  root = new THREE.Group();
  /** true while the swap counter is open (world paused, camera on the counter) */
  modal = false;
  private kats: Kat[] = [];
  private stall = new THREE.Group();
  private counterTop: number;
  private holes: BurrowHole[];
  private surfaceY: (x: number, z: number) => number;
  private rockTop: THREE.Vector3;
  private inter: Interactable;
  private trade: MeerkatTrade | null = null;
  private colliders: Collider[] = [];
  private unsub: (() => void)[] = [];
  private alarm = 0;
  private beat = 0;
  private time = 0;
  private bandWant = 0;
  private announced = false;
  private musicPrev: string | null = null;
  private enemyCheck = 0;
  private flourish = 0;
  private pl = new THREE.Vector3();
  private pd = 99;
  private seed = Math.floor(Math.random() * 1e6);

  constructor(private d: MeerkatColonyDeps) {
    const ctx = d.ctx;
    const W = meerkatWarrenModel();
    const S = meerkatStallModel();
    this.holes = W.meta.holes;
    this.surfaceY = W.meta.surfaceY;
    this.counterTop = S.meta.counterTop;
    // sit the mound into the ground (it has a skirt for gentle slopes)
    const rot = d.rot ?? 0;
    const g: number[] = [];
    for (const [ox, oz] of [[0, 0], [-1.8, -1.2], [1.6, -1], [-1.5, 1.2], [1.4, 1.3], [0, -1.6], [0, 1.5]]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      g.push(ctx.world.groundAt(d.x + ox * c + oz * s, d.z - ox * s + oz * c));
    }
    const gmin = Math.min(...g), gmean = g.reduce((a, b) => a + b, 0) / g.length;
    this.root.position.set(d.x, gmin + (gmean - gmin) * 0.35 - 0.02, d.z);
    this.root.rotation.y = rot;
    ctx.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    // the warren
    const wm = new THREE.Mesh(buildVoxelGeometry(W.model, { voxelSize: W.voxelSize, pivot: [0, 0, 0] }), sharedVoxelMaterial);
    wm.castShadow = true;
    wm.receiveShadow = true;
    this.root.add(wm);
    // the stall on its own patch of ground
    const st = W.meta.stall;
    const sm = new THREE.Mesh(buildVoxelGeometry(S.model, { voxelSize: S.voxelSize, pivot: [0, 0, 0] }), sharedVoxelMaterial);
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.stall.add(sm);
    const sw = this.root.localToWorld(new THREE.Vector3(st.x, 0, st.z));
    this.stall.position.set(st.x, ctx.world.groundAt(sw.x, sw.z) - this.root.position.y, st.z);
    this.stall.rotation.y = st.rot;
    this.root.add(this.stall);
    this.root.updateMatrixWorld(true);
    this.rockTop = new THREE.Vector3(...W.meta.rockTop);
    // solid bits: the lookout rock and the counter
    const rw = this.root.localToWorld(new THREE.Vector3(this.rockTop.x - 0.1, 0, this.rockTop.z + 0.05));
    this.colliders.push(ctx.world.colliders.circle(rw.x, rw.z, 0.62, this.root.position.y - 1, this.root.position.y + 1.1, { tag: 'meerkatRock' }));
    const swp = this.stall.getWorldPosition(new THREE.Vector3());
    this.colliders.push(ctx.world.colliders.box(swp.x, swp.z, 0.4, 0.17, rot + st.rot, swp.y - 1, swp.y + 0.7, { tag: 'meerkatStall', bullets: false }));

    // ---------------------------------------------------------------- residents
    const colonyHoles = this.holes.filter((h) => h.role === 'colony');
    const bandHoles = this.holes.filter((h) => h.role === 'band');
    const mk = (spec: ReturnType<typeof meerkatRig>, role: Role, hole: BurrowHole, scale = 1, seed = 1): Kat => {
      const rig = new RigInstance(buildRigGeo(spec, spec.name));
      rig.root.scale.setScalar(scale);
      rig.root.visible = false;
      this.root.add(rig.root);
      const spot = this.spotBeside(hole, role === 'band' ? 0 : seed * 1.7);
      const k: Kat = {
        rig, anim: new MeerkatAnim(rig, seed), role, hole, spot, state: 'hidden', t: 0, dur: 0,
        pos: new THREE.Vector3(hole.x, this.deepY(hole, scale), hole.z), from: new THREE.Vector3(), to: new THREE.Vector3(),
        hopH: 0.1, yaw: hole.fan * 0.3, wait: 0.6 + Math.random() * 3.5, scale, delay: 0, mode: 'stand', modeUntil: 0, next: 'hidden',
      };
      this.kats.push(k);
      return k;
    };
    colonyHoles.forEach((h, i) => mk(meerkatRig(i % 2), 'pop', h, 1, 2 + i));
    mk(meerkatRig(1), 'pup', colonyHoles[0], 0.62, 11).wait += 3;
    mk(meerkatRig(0), 'pup', colonyHoles[2], 0.6, 12).wait += 4;
    // the lookout sentinel starts on its rock
    const sentinel = mk(meerkatRig(0), 'rock', colonyHoles[0], 1, 13);
    sentinel.state = 'rock';
    sentinel.pos.copy(this.rockTop);
    sentinel.yaw = 0.6;
    sentinel.rig.root.visible = true;
    bandHoles.forEach((h, i) => {
      const k = mk(beatleMeerkatRig(BEATLE_IDS[i]), 'band', h, 1, 20 + i);
      k.spot.set(h.x, this.surfaceY(h.x, h.z + 0.27), h.z + 0.27);
      k.delay = i * 0.17;
    });
    // Mama Mim behind her counter
    const tr = mk(meerkatRig(2), 'trader', colonyHoles[3], 1, 30);
    const tl = this.stall.localToWorld(new THREE.Vector3(...S.meta.trader));
    this.root.worldToLocal(tl);
    tr.state = 'counter';
    tr.pos.copy(tl);
    tr.yaw = st.rot;
    tr.rig.root.visible = true;

    // ---------------------------------------------------------------- interaction + alarms
    const front = this.stall.localToWorld(new THREE.Vector3(0, 0, 0.8));
    this.inter = { pos: front, radius: 2.6, label: 'Swap with the meerkats', enabled: true, promptY: 1.0, use: () => this.openTrade() };
    d.inter.add(this.inter);
    this.unsub.push(ctx.events.on('shot', () => {
      if (this.pd < 30) this.panic(rand(5, 7));
    }));
    this.unsub.push(ctx.events.on('explosion', (p: { x: number; z: number }) => {
      if (Math.hypot(p.x - this.root.position.x, p.z - this.root.position.z) < 26) this.panic(8);
    }));
  }

  // ------------------------------------------------------------------ layout helpers
  private deepY(h: BurrowHole, scale: number) {
    return h.plug - 0.44 * scale;
  }
  private periY(k: Kat) {
    return k.hole.rim - (k.role === 'band' ? 0.105 : 0.165 * k.scale);
  }
  private spotBeside(h: BurrowHole, jitter: number) {
    const a = h.fan + Math.sin(jitter) * 0.9;
    const x = h.x + Math.sin(a) * 0.25, z = h.z + Math.cos(a) * 0.25;
    return new THREE.Vector3(x, this.surfaceY(x, z), z);
  }
  private world(k: Kat, out = _w) {
    return this.root.localToWorld(out.copy(k.pos));
  }
  private holeBusy(h: BurrowHole, self: Kat) {
    return this.kats.some((o) => o !== self && o.hole === h && (o.state === 'rise' || o.state === 'peek' || o.state === 'hopIn' || o.state === 'dive' || o.state === 'pit'));
  }
  private go(k: Kat, s: KatState, dur: number) {
    k.state = s;
    k.t = 0;
    k.dur = dur;
  }
  private hop(k: Kat, to: THREE.Vector3, dur: number, h: number, s: KatState, next: KatState) {
    k.from.copy(k.pos);
    k.to.copy(to);
    k.hopH = h;
    k.next = next;
    this.go(k, s, dur);
    k.anim.kick(1.4);
  }
  private puff(k: Kat, big = 0.12) {
    const p = this.world(k, _v);
    this.d.ctx.fx.dust({ x: p.x, y: p.y + 0.03, z: p.z }, big, 0xd8ac70, 2);
    this.d.ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.05, z: p.z }, count: 5, spread: 0.7, up: 1.2, life: [0.3, 0.6], size: [0.025, 0.015], sprite: ['grain0', 'grain1', 'grain2'], color: [0xd8ac70, 0xc8955a, 0xe6c48c], gravity: 9, ground: true });
  }
  private chirp(k: Kat, pitch = 2.1, vol = 0.28) {
    this.d.ctx.sfx('squeak', this.world(k, _v), vol, pitch + Math.random() * 0.3);
  }

  /** everyone dives for cover; the sentinel barks first */
  private panic(sec: number) {
    if (this.modal) return;
    const fresh = this.alarm <= 0;
    this.alarm = Math.max(this.alarm, sec);
    if (!fresh) return;
    for (const k of this.kats) {
      const lag = Math.random() * 0.22 + (k.role === 'rock' ? 0 : 0.18);
      k.delay = lag;
      if (k.role === 'rock' && k.state === 'rock') {
        this.go(k, 'bark', 0.55);
        this.chirp(k, 1.35, 0.6);
        Voice.chatter('meerkat', 'alarm', { pos: this.world(k, _v), key: 'meerkat:alarm' });
      }
    }
  }

  private react(kind: TradeReaction) {
    const tr = this.kats.find((k) => k.role === 'trader')!;
    Voice.chatter('meerkat', kind, { pos: this.world(tr, _v) });
    const set = (m: MeerkatMode, s: number) => {
      tr.mode = m;
      tr.modeUntil = this.time + s;
    };
    if (kind === 'greet') {
      tr.anim.chatter = 1;
      this.chirp(tr, 2.2, 0.4);
    } else if (kind === 'hover') tr.anim.kick(0.6);
    else if (kind === 'deal') {
      set('cheer', 1.4);
      tr.anim.kick(2.2);
      this.chirp(tr, 2.5, 0.5);
      this.flourish = 3.2;
    } else if (kind === 'nope') set('sad', 1.3);
    else if (kind === 'bye') {
      set('cheer', 0.7);
      tr.anim.chatter = 0.8;
    }
  }

  private openTrade() {
    const ctx = this.d.ctx;
    if (this.modal) return;
    if (this.alarm > 0) {
      ctx.toast('THE BURROW EXCHANGE', '#ffd36b', 'Everyone is hiding. Hold your fire and wait a moment.');
      return;
    }
    let s = this.seed;
    const rng = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const offers = buildOffers(this.d.items, rng);
    if (!offers.length) {
      ctx.toast('MAMA MIM', '#ffd36b', 'Nothing to swap? Bring her a consumable, bone-friend!');
      this.react('nope');
      return;
    }
    this.trade ??= new MeerkatTrade(ctx, this.d.input, this.d.cam);
    this.modal = true;
    this.inter.enabled = false;
    this.d.inter.current = null;
    this.trade.open({
      stall: this.stall,
      counterTop: this.counterTop,
      offers,
      items: this.d.items,
      react: (k) => this.react(k),
      refresh: () => {
        let s2 = this.seed;
        return buildOffers(this.d.items, () => ((s2 = (s2 * 9301 + 49297) % 233280) / 233280));
      },
      onClose: () => {
        this.modal = false;
        this.inter.enabled = true;
      },
    });
  }

  // ------------------------------------------------------------------ update
  update(dt: number, rdt = dt) {
    const adt = this.modal ? rdt : dt;
    if (this.trade?.active) this.trade.update(rdt);
    if (adt <= 0) return;
    const ctx = this.d.ctx, P = this.d.player;
    this.time += adt;
    this.beat += (adt * BPM) / 60;
    this.pl.copy(P.pos);
    this.root.worldToLocal(this.pl);
    this.pd = Math.hypot(this.pl.x, this.pl.z);
    // ---- alarms: rushing in, gunfire (events), enemies prowling close
    if (!this.modal) {
      const sp = Math.hypot(P.board.vel.x, P.board.vel.z);
      if (sp > 10 && this.pd < 11) this.panic(3.2);
      this.enemyCheck -= adt;
      if (this.enemyCheck <= 0) {
        this.enemyCheck = 0.5;
        if (ctx.enemies?.nearest?.(this.root.position, 9)) this.panic(2.5);
      }
      this.alarm = Math.max(0, this.alarm - adt);
    }
    this.flourish = Math.max(0, this.flourish - adt);
    // ---- the band wants out when you come close and stay calm
    const want = this.alarm > 0 ? 0 : this.pd < (this.bandWant === 2 ? 9.5 : 7.5) ? 2 : this.pd < (this.bandWant >= 1 ? 25 : 21) ? 1 : 0;
    if (want >= 1 && !this.announced) {
      this.announced = true;
      ctx.toast(BAND_NAME.toUpperCase(), '#ffd36b', BEATLE_IDS.map((id) => BEATLES[id].name).join(' · '));
    }
    this.bandWant = want;
    this.music(want === 2);
    const look = this.pd < 14 ? _v.set(P.pos.x, P.pos.y + 1.45, P.pos.z).clone() : null;
    for (const k of this.kats) this.stepKat(k, adt, look);
  }

  private music(on: boolean) {
    const m = (window as any).__music;
    if (!m?.setMood || !m?.getMood) return;
    if (on && this.musicPrev === null) {
      const cur = m.getMood();
      if (cur === 'explore' || cur === 'combat' || cur === 'hub') {
        this.musicPrev = cur;
        if (cur !== 'hub') m.setMood('hub', 1.2);
      }
    } else if (!on && this.musicPrev !== null) {
      if (m.getMood() === 'hub' && this.musicPrev !== 'hub') m.setMood(this.musicPrev, 1.5);
      this.musicPrev = null;
    }
  }

  private stepKat(k: Kat, dt: number, look: THREE.Vector3 | null) {
    k.t += dt;
    const a = k.anim;
    const alarm = this.alarm > 0;
    const calm = this.pd < 14 && !alarm;
    let mode: MeerkatMode = 'stand';
    const near = this.pd < 16;
    // face the visitor when near, else the fan/front
    const faceYaw = near ? Math.atan2(this.pl.x - k.pos.x, this.pl.z - k.pos.z) : k.role === 'band' || k.role === 'trader' ? k.yaw : k.hole.fan * 0.4;
    const turn = (target: number, rate = 5) => {
      let dd = target - k.yaw;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      k.yaw += dd * (1 - Math.exp(-rate * dt));
    };
    if (alarm && k.delay > 0) k.delay -= dt;
    const alarmed = alarm && k.delay <= 0;
    const fin = k.t >= k.dur;

    switch (k.state) {
      // -------------------------------------------------- burrow life
      case 'hidden': {
        k.wait -= dt;
        if (k.role === 'band') {
          if (this.bandWant >= 1 && !alarm && (k.delay -= dt) <= 0 && !this.holeBusy(k.hole, k)) {
            k.pos.set(k.hole.x, this.deepY(k.hole, 1), k.hole.z);
            this.go(k, 'rise', 0.34);
            k.anim.kick(1.8);
            this.chirp(k, 2.3, 0.25);
            this.puff(k);
          }
          break;
        }
        if (k.wait <= 0 && !alarm && !this.holeBusy(k.hole, k)) {
          k.pos.set(k.hole.x, this.deepY(k.hole, k.scale), k.hole.z);
          this.go(k, 'rise', 0.3);
          k.anim.kick(1.8);
          if (Math.random() < 0.6) this.chirp(k, k.role === 'pup' ? 2.7 : 2.1, 0.22);
          this.puff(k);
        }
        break;
      }
      case 'rise': {
        const e = outBack(Math.min(1, k.t / k.dur));
        k.pos.y = this.deepY(k.hole, k.scale) + (this.periY(k) - this.deepY(k.hole, k.scale)) * e;
        mode = 'periscope';
        if (fin) {
          if (k.role === 'band') this.go(k, 'pit', 1e9);
          else if (k.role === 'rock') this.go(k, 'peek', 0.8);
          else this.go(k, 'peek', rand(1, 3) * (calm ? 1.4 : 1));
        }
        break;
      }
      case 'peek':
        mode = Math.sin(k.t * 3 + k.scale * 7) > 0.8 && k.role !== 'pup' ? 'alert' : 'periscope';
        if (Math.random() < dt * 0.4) k.anim.chatter = 0.7;
        if (alarmed) this.dive(k);
        else if (fin) {
          if (k.role === 'rock') this.hop(k, this.rockTop, 0.62, 0.42, 'hopUp', 'rock');
          else if (Math.random() < (k.role === 'pup' ? 0.35 : 0.62)) this.hop(k, k.spot, 0.42, 0.11, 'hopOut', 'out');
          else this.dive(k);
        }
        break;
      case 'hopOut':
      case 'hopIn':
      case 'hopUp':
      case 'hopDown': {
        const e = ease(Math.min(1, k.t / k.dur));
        k.pos.lerpVectors(k.from, k.to, e);
        k.pos.y += Math.sin(Math.PI * e) * k.hopH;
        mode = 'hop';
        a.hopK = e;
        turn(Math.atan2(k.to.x - k.from.x, k.to.z - k.from.z) || k.yaw, 14);
        if (fin) {
          a.kick(-1.6);
          if (k.state === 'hopIn') {
            if (k.next === 'pit') this.go(k, 'pit', 1e9);
            else this.dive(k);
          } else if (k.next === 'out') this.go(k, 'out', rand(3, 8) * (calm ? 1.5 : 1));
          else if (k.next === 'stage') this.go(k, 'stage', 1e9);
          else if (k.next === 'rock') this.go(k, 'rock', 1e9);
          else if (k.next === 'pit') this.go(k, 'pit', 1e9);
          else if (k.next === 'hopIn') this.hop(k, new THREE.Vector3(k.hole.x, this.periY(k), k.hole.z), 0.28, 0.1, 'hopIn', 'hidden');
          if (k.next !== 'hopIn') this.puff(k, 0.08);
        }
        break;
      }
      case 'out': {
        // sentinel duty: stand tall, sometimes groom, sometimes a chatter burst
        const phase = Math.floor(k.t / 2.2 + k.scale * 3) % 5;
        mode = phase === 3 && k.role !== 'pup' ? 'groom' : 'stand';
        if (Math.random() < dt * 0.25) {
          k.anim.chatter = 1;
          this.chirp(k, k.role === 'pup' ? 2.8 : 2.3, 0.18);
        }
        turn(faceYaw, 3);
        if (alarmed) this.hop(k, new THREE.Vector3(k.hole.x, this.periY(k), k.hole.z), 0.2, 0.08, 'hopIn', 'hidden');
        else if (fin) this.hop(k, new THREE.Vector3(k.hole.x, this.periY(k), k.hole.z), 0.32, 0.1, 'hopIn', 'hidden');
        break;
      }
      case 'dive': {
        const e = Math.min(1, k.t / k.dur);
        k.pos.y = k.from.y + (this.deepY(k.hole, k.scale) - k.from.y) * e * e;
        mode = 'dive';
        if (fin) {
          this.go(k, 'hidden', 0);
          k.wait = alarm ? this.alarm + rand(1, 4) : rand(1.5, 5.5);
        }
        break;
      }
      // -------------------------------------------------- the lookout
      case 'rock':
        mode = this.pd < 22 && !alarm ? (Math.random() < 0.002 ? 'alert' : 'stand') : 'stand';
        turn(this.pd < 22 ? faceYaw : 0.6 + Math.sin(this.time * 0.3) * 0.8, 2.5);
        if (alarm) {
          this.go(k, 'bark', 0.55);
          this.chirp(k, 1.35, 0.6);
        }
        break;
      case 'bark':
        mode = 'alert';
        k.anim.chatter = 1;
        if (fin) this.hop(k, new THREE.Vector3(k.hole.x, k.hole.rim + 0.02, k.hole.z), 0.58, 0.36, 'hopDown', 'hopIn');
        break;
      // -------------------------------------------------- the band
      case 'pit':
        mode = this.flourish > 0 ? 'dance' : 'play';
        k.pos.y = this.periY(k);
        turn(faceYaw * 0.5, 3);
        if (alarmed || this.bandWant === 0) this.dive(k);
        else if (this.bandWant === 2 && (k.delay -= dt) <= 0) this.hop(k, k.spot, 0.42, 0.13, 'hopOut', 'stage');
        break;
      case 'stage': {
        // play; every so often everyone breaks into the twist
        const brk = (this.beat % 32) > 26 || this.flourish > 0;
        mode = brk ? 'dance' : 'play';
        turn(near ? faceYaw * 0.7 : 0, 2.5);
        if (alarmed) this.hop(k, new THREE.Vector3(k.hole.x, this.periY(k), k.hole.z), 0.22, 0.08, 'hopIn', 'hidden');
        else if (this.bandWant < 2) {
          k.delay = 0.1 + Math.random() * 0.3;
          this.hop(k, new THREE.Vector3(k.hole.x, this.periY(k), k.hole.z), 0.36, 0.12, 'hopIn', 'pit');
        }
        break;
      }
      // -------------------------------------------------- Mama Mim
      case 'counter':
        mode = alarm ? 'crouch' : this.time < k.modeUntil ? k.mode : 'stand';
        if (!alarm && this.pd < 7 && Math.random() < dt * 0.22) {
          k.anim.chatter = 0.9;
          this.chirp(k, 2.2, 0.22);
        }
        break;
    }
    // ---- drive the rig
    const visible = k.state !== 'hidden';
    k.rig.root.visible = visible;
    if (!visible) return;
    a.mode = mode;
    a.lookAt = look && (mode === 'stand' || mode === 'periscope' || mode === 'alert' || mode === 'play' || mode === 'cheer' || mode === 'sad') ? look : null;
    a.beat = this.beat + (k.role === 'band' ? 0 : k.scale);
    a.update(dt);
    k.rig.root.position.copy(k.pos);
    k.rig.root.rotation.y = k.yaw;
  }

  private dive(k: Kat) {
    k.from.copy(k.pos);
    k.pos.x = k.hole.x;
    k.pos.z = k.hole.z;
    this.go(k, 'dive', 0.22);
    k.anim.kick(1.5);
    this.puff(k, 0.14);
    this.d.ctx.sfx('footstep_sand', this.world(k, _v), 0.35, 1.7);
  }

  dispose() {
    for (const u of this.unsub) u();
    this.unsub = [];
    if (this.trade) {
      this.trade.dispose();
      this.trade = null;
    }
    this.music(false);
    this.d.inter.remove(this.inter);
    for (const c of this.colliders) this.d.ctx.world.colliders.remove(c);
    this.colliders = [];
    this.root.removeFromParent();
    this.modal = false;
  }
}
