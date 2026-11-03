// The giant jerboa: a rare, harmless, enormous hopper that bounds around the
// dunes and gets curious about you — it hops closer, tilts its head, swivels
// its huge ears and sniffs. Ride up and it challenges you to a DANCE-OFF: a
// rhythm game where it leads a phrase of moves on the beat and you repeat them
// in time (ring QTEs locked to the beat). Both dancers are animated
// procedurally (hops, shimmies, tail wiggles, spins) under a two-shot camera
// that bobs to the beat. Dance well and it gifts you an item (Serket's Charm
// for a great dance) plus gold; dance badly and it hops off — still adorable.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { JerboaDance } from '../run/JerboaDance';   (+ findClearSpot from '../run/MeerkatColony')
//   field:   jerboa: JerboaDance | null = null;
//   spawn:   rare, in populateZone(z) (at most one alive):
//              if (!this.jerboa && z.index >= 1 && rnd.chance(0.15)) {
//                const s = findClearSpot(this.ctx, z, 3);
//                if (s) this.jerboa = new JerboaDance({ ctx: this.ctx, player: this.player, inter: this.inter,
//                  qte: this.qte, cam: this.camRig, items: this.items, pickups: this.pickups, x: s.x, z: s.z });
//              }
//   update:  in update(), right after `this.shop.update(rdt);` add:
//              this.jerboa?.update(dt, rdt);
//              if (this.jerboa?.done) { this.jerboa.dispose(); this.jerboa = null; }
//   modal:   const modal = … || !!this.jerboa?.modal;  (true during the dance-off: the world is paused,
//            input is disabled, the class owns the camera via camRig.setCine and poses the player rig)
//            and add `|| this.jerboa?.modal` to the hud `prompt:` null-condition in updateHud().
//   exit():  this.jerboa?.dispose();
// It registers its own Interactable ("Dance with the Giant Jerboa"), listens to ctx.events 'shot' /
// 'explosion' (it startles, and leaves after enough gunfire), and grants the reward itself:
// items.add(id) + toast, pickups.drop('gold', …). No other wiring.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Interactable } from './Interact';
import type { Qte, QteResult } from '../ui/Qte';
import type { CameraRig, CineShot } from '../player/CameraRig';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { giantJerboaRig } from '../models/creatures/jerboa';
import { JerboaAnim, HumanDance, DanceMove, DANCE_INFO, DANCE_MOVES, HumanMove } from '../models/creatures/anim';
import { ITEMS, ItemId } from '../player/Items';
import { itemObject3D, InventoryLike } from '../ui/MeerkatTrade';
import { Ease } from '../../engine/Tween';

export interface DancePlayer {
  pos: THREE.Vector3;
  alive: boolean;
  invuln: number;
  board: { vel: { x: number; y: number; z: number } };
  rig: RigInstance;
}
export interface JerboaDanceDeps {
  ctx: Ctx;
  player: DancePlayer;
  inter: { add(i: Interactable): Interactable; remove(i: Interactable): void; current: Interactable | null };
  qte: Qte;
  cam: CameraRig;
  items: InventoryLike;
  pickups?: { drop(kind: any, value: number, at: { x: number; y: number; z: number }, n?: number): void };
  x: number;
  z: number;
}

type JState = 'roam' | 'curious' | 'startled' | 'dance' | 'leaving';
const BPM = 120;
const BEAT = 60 / BPM;
const RING_DUR = 0.95;
const RING_HIT = 0.806 * RING_DUR; // the shrinking ring meets its target this long after it starts
const ROUNDS = [3, 4, 5];
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Timed {
  at: number;
  fn: () => void;
}

export class JerboaDance {
  /** true while the dance-off runs (world paused; add to RunScene's modal check) */
  modal = false;
  /** set once it has hopped away for good: dispose() and drop the reference */
  done = false;
  rig: RigInstance;
  anim: JerboaAnim;
  pos = new THREE.Vector3();
  heading = Math.random() * Math.PI * 2;
  private home = new THREE.Vector3();
  private state: JState = 'roam';
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null = null;
  private pause = 1;
  private series = 0;
  private startleLeft = 0;
  private startles = 0;
  private seen = false;
  private inter: Interactable;
  private unsub: (() => void)[] = [];
  // ---- dance-off
  private clock = 0;
  private sched: Timed[] = [];
  private beat0 = 0;
  private lastBeat = -1;
  private jMove: { move: DanceMove; start: number; dur: number } | null = null;
  private pMove: { move: HumanMove; start: number; dur: number } | null = null;
  private dancer: HumanDance | null = null;
  private saved: { q: THREE.Quaternion; p: THREE.Vector3 } | null = null;
  private shot: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0 };
  private side = 1;
  private focus = 0;
  private focusT = 0;
  private score = 0;
  private maxScore = 0;
  private roundScore = 0;
  private hook: ((dt: number, rdt: number) => void) | null = null;
  private call: HTMLDivElement | null = null;
  private musicPrev: string | null = null;
  private gift: THREE.Group | null = null;
  private endT = 0;
  private outro: 'none' | 'happy' | 'sad' = 'none';

  constructor(private d: JerboaDanceDeps) {
    const ctx = d.ctx;
    this.rig = new RigInstance(buildRigGeo(giantJerboaRig(), 'giant_jerboa'));
    this.anim = new JerboaAnim(this.rig);
    this.home.set(d.x, 0, d.z);
    this.pos.set(d.x, ctx.world.groundAt(d.x, d.z), d.z);
    ctx.scene.add(this.rig.root);
    this.syncRoot();
    this.inter = { pos: this.pos.clone(), radius: 7.5, label: 'Dance with the Giant Jerboa', enabled: true, promptY: 3.1, use: () => this.startDance() };
    d.inter.add(this.inter);
    this.unsub.push(ctx.events.on('shot', () => {
      if (this.distToPlayer() < 26) this.startle(true);
    }));
    this.unsub.push(ctx.events.on('explosion', (p: { x: number; z: number }) => {
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 22) this.startle(true);
    }));
  }

  private distToPlayer() {
    const p = this.d.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }
  private syncRoot(extraY = 0) {
    this.rig.root.position.set(this.pos.x, this.pos.y + extraY, this.pos.z);
    this.rig.root.rotation.y = this.heading + this.anim.root.yaw;
  }
  private turnTo(yaw: number, rate: number, dt: number) {
    let dd = yaw - this.heading;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    this.heading += dd * (1 - Math.exp(-rate * dt));
    return Math.abs(dd);
  }
  private startHop(to: THREE.Vector3, dur = 0.62, h = -1) {
    const g = this.d.ctx.world.groundAt(to.x, to.z);
    const dist = Math.hypot(to.x - this.pos.x, to.z - this.pos.z);
    this.hop = { from: this.pos.clone(), to: new THREE.Vector3(to.x, g, to.z), t: 0, dur, h: h >= 0 ? h : 0.45 + dist * 0.16 };
  }
  private landFx(p: THREE.Vector3, big = 1) {
    const ctx = this.d.ctx;
    ctx.fx.dust({ x: p.x, y: p.y + 0.05, z: p.z }, 0.55 * big, 0xe0b373, 3);
    ctx.sfx('board_land', p, 0.3 * big, 0.55);
  }

  private startle(gunfire: boolean) {
    if (this.state === 'dance' || this.state === 'leaving' || this.done) return;
    if (this.startleLeft > 0) return;
    if (gunfire) this.startles++;
    this.d.ctx.sfx('squeak', this.pos, 0.7, 0.75);
    if (this.startles >= 4) {
      this.d.ctx.toast('THE GIANT JERBOA', '#ffd38a', 'Too much shooting! It bounds away over the dunes.');
      this.leave();
      return;
    }
    this.state = 'startled';
    this.startleLeft = 0.45;
    this.series = 3;
    this.pause = 0.45;
    this.anim.kick(2.2);
  }
  private leave() {
    this.state = 'leaving';
    this.inter.enabled = false;
    this.series = 99;
    this.pause = 0.6;
  }

  // ======================================================================= update
  update(dt: number, rdt = dt) {
    if (this.done) return;
    if (this.state === 'dance') {
      this.updateDance(rdt);
      return;
    }
    if (dt <= 0) return;
    const ctx = this.d.ctx, P = this.d.player;
    const pd = this.distToPlayer();
    if (!this.seen && pd < 34) {
      this.seen = true;
      ctx.toast('A GIANT JERBOA!', '#ffd38a', 'It looks... curious. Ride up slowly and say hi.');
      ctx.sfx('squeak', this.pos, 0.6, 0.55);
    }
    const sp = Math.hypot(P.board.vel.x, P.board.vel.z);
    if (pd < 6 && sp > 14) this.startle(false);
    if (this.state === 'roam' && pd < 16) this.state = 'curious';
    if (this.state === 'curious' && pd > 24) this.state = 'roam';
    this.startleLeft = Math.max(0, this.startleLeft - dt);
    const playerYaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    // ---------------------------------------------------------------- hop engine
    let lift = 0;
    if (this.hop) {
      const h = this.hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur);
      // airborne between 30% and 85% of the hop; the anim crouches before and absorbs after
      const air = k > 0.3 && k < 0.85 ? (k - 0.3) / 0.55 : k >= 0.85 ? 1 : 0;
      const e = air * air * (3 - 2 * air);
      this.pos.set(h.from.x + (h.to.x - h.from.x) * e, 0, h.from.z + (h.to.z - h.from.z) * e);
      this.pos.y = h.from.y + (h.to.y - h.from.y) * e;
      lift = Math.sin(Math.PI * air) * h.h * (k < 0.85 ? 1 : 0);
      this.anim.mode = 'hop';
      this.anim.hopK = k;
      this.turnTo(Math.atan2(h.to.x - h.from.x, h.to.z - h.from.z), 10, dt);
      if (k >= 1) {
        this.hop = null;
        this.landFx(this.pos, 0.9);
        this.series--;
        this.pause = this.series > 0 ? rand(0.05, 0.18) : rand(0.8, 2.4);
      }
    } else {
      this.pause -= dt;
      this.anim.mode = this.state === 'startled' && this.startleLeft > 0 ? 'startle' : this.state === 'curious' ? 'curious' : 'idle';
      if (this.state === 'curious') this.turnTo(playerYaw, 2.5, dt);
      if (this.pause <= 0) this.planHop(pd);
    }
    this.anim.lookAt = this.state === 'curious' || this.state === 'startled' ? _v.set(P.pos.x, P.pos.y + 1.5, P.pos.z).clone() : null;
    this.anim.update(dt);
    this.syncRoot(lift);
    this.inter.pos.copy(this.pos);
    this.inter.enabled = (this.state === 'roam' || this.state === 'curious') && !this.hop && P.alive;
    if (this.state === 'leaving' && pd > 48) this.done = true;
  }

  private planHop(pd: number) {
    const P = this.d.player;
    const away = new THREE.Vector3(this.pos.x - P.pos.x, 0, this.pos.z - P.pos.z).normalize();
    if (this.state === 'startled' || this.state === 'leaving') {
      if (this.series <= 0) {
        this.state = this.state === 'leaving' ? 'leaving' : 'curious';
        this.series = this.state === 'leaving' ? 99 : 0;
        this.pause = 1;
        return;
      }
      const wob = (Math.random() - 0.5) * 0.6;
      const dir = away.applyAxisAngle(UP, wob);
      this.startHop(this.pos.clone().addScaledVector(dir, this.state === 'leaving' ? 3.2 : 2.6), 0.6);
      return;
    }
    if (this.state === 'curious') {
      // hop up to a polite, curious distance; otherwise bounce in place now and then
      const want = new THREE.Vector3(P.pos.x, 0, P.pos.z).addScaledVector(away, 4.8);
      const gap = Math.hypot(want.x - this.pos.x, want.z - this.pos.z);
      if (gap > 1.2) {
        const step = Math.min(2.2, gap);
        const to = this.pos.clone().add(new THREE.Vector3(want.x - this.pos.x, 0, want.z - this.pos.z).normalize().multiplyScalar(step));
        this.series = 1;
        this.startHop(to);
      } else if (Math.random() < 0.3) {
        this.series = 1;
        this.startHop(this.pos.clone(), 0.5, 0.35);
        this.d.ctx.sfx('squeak', this.pos, 0.4, 0.62);
      } else this.pause = rand(0.8, 1.8);
      return;
    }
    // roam: short series of hops toward a wander point near home
    if (this.series <= 0) this.series = 2 + Math.floor(Math.random() * 3);
    const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
    const tgt = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
    const dir = tgt.sub(new THREE.Vector3(this.pos.x, 0, this.pos.z));
    const L = Math.min(dir.length(), rand(1.4, 2.6));
    if (L < 0.4) {
      this.pause = 1;
      return;
    }
    this.startHop(this.pos.clone().add(dir.normalize().multiplyScalar(L)));
    void pd;
  }

  // ======================================================================= the dance-off
  private startDance() {
    if (this.state === 'dance' || this.done) return;
    const ctx = this.d.ctx, eng = ctx.engine, P = this.d.player;
    this.state = 'dance';
    this.modal = true;
    this.hop = null;
    this.inter.enabled = false;
    this.d.inter.current = null;
    eng.paused = true;
    eng.input.enabled = false;
    P.invuln = Math.max(P.invuln, 999);
    P.board.vel.x = P.board.vel.z = 0;
    eng.letterbox(true, 0.5);
    const m = (window as any).__music;
    if (m?.getMood) {
      this.musicPrev = m.getMood();
      m.setMood?.('off', 0.4);
      m.stinger?.('funny');
    }
    // the stage: the jerboa faces you from 4.6 m away
    const toJ = new THREE.Vector3(this.pos.x - P.pos.x, 0, this.pos.z - P.pos.z);
    if (toJ.lengthSq() < 0.01) toJ.set(0, 0, 1);
    toJ.normalize();
    const spot = P.pos.clone().addScaledVector(toJ, 4.6);
    spot.y = ctx.world.groundAt(spot.x, spot.z);
    this.hop = { from: this.pos.clone(), to: spot, t: 0, dur: 0.7, h: 0.5 };
    const n = new THREE.Vector3(-toJ.z, 0, toJ.x);
    this.side = n.dot(ctx.camera.position.clone().sub(P.pos)) >= 0 ? 1 : -1;
    // the player's rig: we pose it until the dance ends
    this.dancer = new HumanDance(P.rig);
    this.saved = { q: P.rig.root.quaternion.clone(), p: P.rig.root.position.clone() };
    this.hook = (_dt, r) => this.posePlayer(r);
    eng.onAfterUpdate.push(this.hook);
    // the call line (typography only)
    this.call = document.createElement('div');
    this.call.style.cssText = "position:absolute;left:50%;top:13vh;transform:translateX(-50%);z-index:7;pointer-events:none;font-family:'Alagard';text-align:center;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 14px #000;letter-spacing:1px;white-space:nowrap";
    eng.overlay.appendChild(this.call);
    ctx.toast('DANCE-OFF!', '#ff9ad8', 'Copy the Giant Jerboa on the beat: W A S D SPACE', true);
    ctx.sfx('squeak', this.pos, 0.8, 0.6);
    this.buildSchedule();
    this.shotUpdate(1);
  }

  private say(who: string, what: string, color = '#ffd36b', glyph = '') {
    if (!this.call) return;
    const key = glyph ? ` <span style="display:inline-block;min-width:34px;padding:0 8px;margin-left:10px;background:#e8d2a8;color:#2a1810;border:3px solid #2a1810;box-shadow:0 3px 0 #2a1810;text-shadow:none;font-size:26px">${glyph}</span>` : '';
    this.call.innerHTML = `<div style="font-size:17px;opacity:.85">${who}</div><div style="font-size:36px;color:${color};margin-top:2px">${what}${key}</div>`;
  }

  private buildSchedule() {
    const s: Timed[] = [];
    const T = (beat: number) => this.beat0 + beat * BEAT;
    this.beat0 = 0.9; // after the jerboa takes its spot
    this.clock = 0;
    this.score = 0;
    this.maxScore = 0;
    let b = 0;
    let last: DanceMove | null = null;
    ROUNDS.forEach((n, r) => {
      const moves: DanceMove[] = [];
      for (let i = 0; i < n; i++) {
        let m: DanceMove;
        do m = DANCE_MOVES[Math.floor(Math.random() * DANCE_MOVES.length)];
        while (m === last);
        moves.push(m);
        last = m;
      }
      // the jerboa leads
      s.push({ at: T(b), fn: () => {
        this.say(`ROUND ${r + 1} OF ${ROUNDS.length}`, 'THE JERBOA LEADS…', '#ffd38a');
        this.focusT = 1;
        this.roundScore = 0;
      } });
      b += 2;
      moves.forEach((m, i) => {
        const at = T(b + 2 * i);
        s.push({ at, fn: () => {
          this.jMove = { move: m, start: this.clock, dur: 2 * BEAT };
          this.say('WATCH', DANCE_INFO[m].name, '#ffd38a', DANCE_INFO[m].glyph);
        } });
        s.push({ at: at + BEAT, fn: () => this.d.ctx.sfx('squeak', this.pos, 0.55, 0.5 + DANCE_MOVES.indexOf(m) * 0.06) });
      });
      b += 2 * n;
      // your turn: one beat-locked ring per move
      s.push({ at: T(b), fn: () => {
        this.jMove = null;
        this.say('YOUR TURN', 'COPY IT!', '#9dff3a');
        this.focusT = -1;
      } });
      b += 2;
      moves.forEach((m, i) => {
        const beatAt = T(b + 2 * i + 1);
        this.maxScore += 2;
        s.push({ at: T(b + 2 * i), fn: () => this.say('YOUR TURN', DANCE_INFO[m].name, '#9dff3a', DANCE_INFO[m].glyph) });
        s.push({ at: beatAt - RING_HIT, fn: () => {
          void this.d.qte.run({ kind: 'ring', key: DANCE_INFO[m].key, label: DANCE_INFO[m].name, duration: RING_DUR }).then((res) => this.onStep(m, res));
        } });
      });
      b += 2 * n;
      s.push({ at: T(b), fn: () => this.roundEnd(n) });
      b += 2;
    });
    s.push({ at: T(b), fn: () => this.finale() });
    this.endT = T(b) + 4.2;
    this.sched = s.sort((a, c) => a.at - c.at);
    this.lastBeat = -1;
  }

  private onStep(m: DanceMove, res: QteResult) {
    if (this.state !== 'dance') return;
    const ctx = this.d.ctx, P = this.d.player;
    const pts = res === 'perfect' ? 2 : res === 'good' ? 1 : 0;
    this.score += pts;
    this.roundScore += pts;
    const dur = 2 * BEAT * 0.92;
    if (pts > 0) {
      this.pMove = { move: m, start: this.clock - dur * 0.25, dur };
      if (res === 'perfect') ctx.fx.sparkle({ x: P.pos.x, y: P.pos.y + 1.2, z: P.pos.z }, 0xffd36b, 8, 0.8);
      this.anim.kick(0.9);
    } else {
      this.pMove = { move: 'stumble', start: this.clock, dur };
      ctx.sfx('squeak', this.pos, 0.35, 0.45);
    }
  }

  private roundEnd(n: number) {
    const good = this.roundScore >= n * 1.2;
    this.say(good ? 'THE JERBOA LOVES IT' : 'THE JERBOA TILTS ITS HEAD', good ? 'NICE MOVES!' : 'HMM…', good ? '#9dff3a' : '#ffb07a');
    this.jMove = null;
    this.focusT = 0;
    this.anim.kick(good ? 2 : 0.6);
    if (good) this.d.ctx.sfx('sting_positive', null, 0.35);
  }

  private finale() {
    const ctx = this.d.ctx, P = this.d.player;
    const frac = this.maxScore ? this.score / this.maxScore : 0;
    this.focusT = 0.4;
    this.jMove = null;
    if (frac >= 0.55) {
      this.outro = 'happy';
      const great = frac >= 0.85;
      const pool: ItemId[] = ['goldBandage', 'shield', 'smoke', 'dynamite', 'snakeoil', 'whiskey', 'dagger'];
      const id: ItemId = great ? 'charm' : pool[Math.floor(Math.random() * pool.length)];
      this.say(great ? 'A LEGENDARY DANCE!' : 'WHAT A DANCER!', `${Math.round(frac * 100)}% IN STEP`, '#ffd36b');
      ctx.toast(great ? 'LEGENDARY MOVES' : 'DANCE-OFF WON', '#ffd36b', 'The Giant Jerboa offers you a gift with its tiny paws.', true);
      ctx.sfx('sting_positive', null, 0.6);
      ctx.sfx('loot_reveal', this.pos, 0.7);
      // the gift: the item's own model pops from its paws and arcs over to you
      this.rig.root.updateMatrixWorld(true);
      const from = new THREE.Vector3();
      (this.rig.sockets['paw_l'] ?? this.rig.root).getWorldPosition(from);
      const g = itemObject3D(id, 0.22);
      g.position.copy(from);
      ctx.scene.add(g);
      this.gift = g;
      const to = P.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
      ctx.engine.tweens.run(1.1, (k) => {
        g.position.lerpVectors(from, to, k).add(new THREE.Vector3(0, Math.sin(Math.PI * k) * 1.2, 0));
        g.rotation.y += 0.2;
        g.scale.setScalar(1 + Math.sin(Math.PI * k) * 0.4);
      }, Ease.inOutQuad, { real: true, delay: 0.9, done: () => {
        g.removeFromParent();
        this.gift = null;
        const at = { x: P.pos.x, y: P.pos.y + 0.8, z: P.pos.z };
        if (this.d.items.add(id, 1)) ctx.toast(ITEMS[id].name.toUpperCase(), '#9dff3a', 'A gift from the Giant Jerboa');
        else {
          ctx.toast('POCKETS FULL', '#ff8a6a', 'It leaves you a pile of gold instead');
          this.d.pickups?.drop('gold', 1, at, 18);
        }
        this.d.pickups?.drop('gold', 1, at, great ? 14 : 8);
        ctx.fx.sparkle(at, 0xffd36b, 14, 0.9);
        ctx.sfx('pickup_gold', null, 0.7);
      } });
    } else {
      this.outro = 'sad';
      this.say('THE JERBOA SHRUGS ITS EARS', `${Math.round(frac * 100)}% IN STEP`, '#ffb07a');
      ctx.toast('DANCE-OFF LOST', '#ffb07a', 'The Giant Jerboa hops off, unimpressed… but still adorable.', true);
      ctx.sfx('sting_negative', null, 0.5);
    }
  }

  private finishDance() {
    const ctx = this.d.ctx, eng = ctx.engine, P = this.d.player;
    if (this.hook) {
      const i = eng.onAfterUpdate.indexOf(this.hook);
      if (i >= 0) eng.onAfterUpdate.splice(i, 1);
      this.hook = null;
    }
    if (this.saved) {
      P.rig.resetPose();
      P.rig.root.quaternion.copy(this.saved.q);
      P.rig.root.position.copy(this.saved.p);
      this.saved = null;
    }
    this.dancer = null;
    this.call?.remove();
    this.call = null;
    this.d.cam.setCine(null);
    eng.letterbox(false, 0.5);
    eng.paused = false;
    eng.input.enabled = true;
    P.invuln = 1.5;
    const m = (window as any).__music;
    if (m?.setMood && this.musicPrev) m.setMood(this.musicPrev, 1.2);
    this.musicPrev = null;
    this.modal = false;
    this.jMove = this.pMove = null;
    this.leave();
  }

  private updateDance(rdt: number) {
    const ctx = this.d.ctx, P = this.d.player;
    this.clock += rdt;
    // keep particles and lights alive while the world is paused for the dance
    ctx.particles.update(rdt, (ctx.world as any).env?.fog ?? null);
    ctx.fx.update(rdt);
    // the jerboa takes its spot with one big hop
    let lift = 0;
    if (this.hop) {
      const h = this.hop;
      h.t += rdt;
      const k = Math.min(1, h.t / h.dur);
      this.pos.lerpVectors(h.from, h.to, k * k * (3 - 2 * k));
      lift = Math.sin(Math.PI * k) * h.h;
      this.anim.mode = 'hop';
      this.anim.hopK = k;
      if (k >= 1) {
        this.hop = null;
        this.landFx(this.pos, 1);
      }
    }
    this.turnTo(Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), 8, rdt);
    // the beat: a soft kick on 1 and 3, shaker clicks between
    const beatNow = (this.clock - this.beat0) / BEAT;
    if (this.clock < this.endT - 3 && beatNow >= 0 && Math.floor(beatNow) !== this.lastBeat) {
      this.lastBeat = Math.floor(beatNow);
      const down = this.lastBeat % 2 === 0;
      ctx.sfx(down ? 'footstep_sand' : 'ui_click', null, down ? 0.75 : 0.28, down ? 0.62 : 1.7);
    }
    // fire due events
    while (this.sched.length && this.sched[0].at <= this.clock) this.sched.shift()!.fn();
    // the jerboa's pose
    if (!this.hop) {
      const jm = this.jMove;
      if (jm && this.clock < jm.start + jm.dur) {
        this.anim.mode = 'dance';
        this.anim.move = jm.move;
        this.anim.moveK = (this.clock - jm.start) / jm.dur;
      } else if (this.outro === 'happy') this.anim.mode = this.clock > this.endT - 2.6 ? 'bow' : 'happy';
      else if (this.outro === 'sad') this.anim.mode = 'sad';
      else this.anim.mode = 'groove';
    }
    this.anim.beat = Math.max(0, beatNow);
    this.anim.lookAt = _v.set(P.pos.x, P.pos.y + 1.4, P.pos.z).clone();
    this.anim.update(rdt);
    this.syncRoot(lift);
    this.shotUpdate(rdt);
    if (this.clock >= this.endT) this.finishDance();
  }

  /** applied after the scene update so the player's own animation never overrides the dance */
  private posePlayer(rdt: number) {
    if (!this.dancer || this.state !== 'dance') return;
    const P = this.d.player;
    const pm = this.pMove;
    let move: HumanMove = this.outro === 'happy' ? 'cheer' : 'groove', k = 0;
    if (pm && this.clock < pm.start + pm.dur) {
      move = pm.move;
      k = (this.clock - pm.start) / pm.dur;
    }
    if (this.clock < this.beat0) move = 'idle';
    this.dancer.pose(move, k, Math.max(0, (this.clock - this.beat0) / BEAT), this.clock, Math.max(rdt, 1e-3));
    // face the jerboa (plus the spin)
    const rr = P.rig.root;
    if (rr.parent) {
      rr.parent.updateWorldMatrix(true, false);
      rr.parent.getWorldQuaternion(_q);
      _q2.setFromAxisAngle(UP, Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + this.dancer.root.yaw);
      rr.quaternion.copy(_q.invert().multiply(_q2));
    }
  }

  /** the two-shot: side-on, favouring whoever is dancing, bobbing to the beat */
  private shotUpdate(rdt: number) {
    const P = this.d.player;
    const A = new THREE.Vector3(P.pos.x, P.pos.y, P.pos.z), B = this.pos;
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const d = new THREE.Vector3(B.x - A.x, 0, B.z - A.z);
    const len = Math.max(0.5, d.length());
    d.normalize();
    const n = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(this.side);
    this.focus += (this.focusT - this.focus) * (1 - Math.exp(-2.5 * rdt));
    const bt = Math.max(0, (this.clock - this.beat0) / BEAT);
    const f = this.focus;
    this.shot.look.copy(mid).addScaledVector(d, f * len * 0.13).add(new THREE.Vector3(0, 1.3 + Math.max(0, f) * 0.3, 0));
    this.shot.pos.copy(mid).addScaledVector(n, 7.0 - Math.abs(f) * 0.5).addScaledVector(d, f * len * 0.08).add(new THREE.Vector3(0, 1.5 + Math.abs(Math.sin(Math.PI * bt)) * 0.06, 0));
    this.shot.fov = 50;
    this.shot.roll = Math.sin((Math.PI * bt) / 2) * 0.025;
    this.d.cam.setCine(this.shot, true);
  }

  dispose() {
    if (this.state === 'dance') this.finishDance();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.gift?.removeFromParent();
    this.d.inter.remove(this.inter);
    this.rig.root.removeFromParent();
    this.done = true;
  }
}
