// QTE DODGE: the big attacks (pounces, charges, dives, boss slams and grabs)
// can offer a timed key press a beat before they land. The world drops into
// slow motion while a ring closes on SPACE; hit it and the hunter twists out
// of the blow in slow motion, leaving jade afterimages, with i-frames — and
// the attacker is left wide open (the caller turns that into a counter
// window). Rate-limited so it stays a highlight, never a chore.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Qte, QteResult } from '../ui/Qte';

/** what the dodge needs from the hunter (the real Player satisfies it) */
export interface DodgeHunter {
  pos: THREE.Vector3;
  alive: boolean;
  board: { vel: THREE.Vector3; impulse: THREE.Vector3 };
  root?: THREE.Object3D;
  invuln?: number;
}

export const DODGE_QTE = {
  /** ring time (real seconds) — generous */
  window: 1.35,
  /** world speed while the ring closes */
  slow: 0.1,
  /** minimum real seconds between two offers */
  cooldown: 5,
  /** i-frames after a successful dodge (game seconds) */
  iframes: 1.3,
  /** shove (m/s) sideways and up */
  side: 14,
  hop: 5,
};

export type DodgeResult = 'perfect' | 'good' | 'fail' | 'none';

export class Dodge {
  qte: Qte | null = null;
  /** real-time seconds until another dodge may be offered */
  private cdUntil = 0;
  busy = false;
  private ghosts: { g: THREE.Group; mat: THREE.MeshBasicMaterial; t: number; life: number; a: number }[] = [];
  private queue: number[] = [];
  private lastReal = 0;

  constructor(private ctx: Ctx, private hunter: DodgeHunter) {}

  private get now() {
    return this.ctx.engine.realTime;
  }

  /** can a dodge be offered right now? */
  ready() {
    const q = this.qte;
    return !!q && !q.active && !this.busy && this.hunter.alive && this.now >= this.cdUntil && (this.hunter.invuln ?? 0) <= 0;
  }

  /**
   * Offer a QTE dodge against a blow coming from `from`. Resolves after the
   * key press (or the miss). On success the hunter is already out of the way
   * and invulnerable for a moment. `up` makes it a jump (sweeps along the
   * ground) instead of a side-step.
   */
  async offer(o: { from: { x: number; z: number }; label?: string; up?: boolean; window?: number }): Promise<DodgeResult> {
    if (!this.ready()) return 'none';
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.busy = true;
    this.cdUntil = this.now + 99;
    eng.slowMo(DODGE_QTE.slow, 40);
    ctx.sfx('time_slow', null, 0.45, 1.6);
    let r: QteResult = 'fail';
    try {
      r = await this.qte!.run({ kind: 'ring', key: 'Space', label: o.label ?? (o.up ? 'JUMP!' : 'DODGE!'), duration: o.window ?? DODGE_QTE.window });
    } finally {
      this.busy = false;
      this.cdUntil = this.now + DODGE_QTE.cooldown;
    }
    if (r === 'fail' || !this.hunter.alive) {
      eng.slowMo(1, 14);
      return 'fail';
    }
    this.evade(o.from, !!o.up, r === 'perfect');
    return r;
  }

  /** the slow-motion twist out of the blow */
  private evade(from: { x: number; z: number }, up: boolean, perfect: boolean) {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const h = this.hunter;
    let ax = h.pos.x - from.x, az = h.pos.z - from.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    // side-step across the line of the blow, toward where the hunter is already drifting
    const v = h.board.vel;
    const lat = v.x * -az + v.z * ax;
    const side = Math.abs(lat) > 1.5 ? Math.sign(lat) : Math.random() < 0.5 ? -1 : 1;
    const dx = -az * side, dz = ax * side;
    if (up) {
      h.board.impulse.x += ax * 3;
      h.board.impulse.z += az * 3;
      h.board.impulse.y += DODGE_QTE.hop * 2.1;
    } else {
      const along = v.x * dx + v.z * dz;
      if (along < 0) {
        v.x -= dx * along;
        v.z -= dz * along;
      }
      h.board.impulse.x += dx * DODGE_QTE.side + ax * 4;
      h.board.impulse.z += dz * DODGE_QTE.side + az * 4;
      h.board.impulse.y += DODGE_QTE.hop;
    }
    h.invuln = Math.max(h.invuln ?? 0, DODGE_QTE.iframes);
    // slow-motion beat (real time), then back up to speed
    eng.slowMo(0.28, 30);
    eng.tweens.after(perfect ? 0.55 : 0.4, () => eng.slowMo(1, 7), true);
    this.queue = [0, 0.05, 0.1, 0.16, 0.23];
    const c = { x: h.pos.x, y: h.pos.y + 1, z: h.pos.z };
    ctx.sfx('whoosh_big', c, 0.8, 1.35);
    ctx.sfx('bullet_whiz', c, 0.6, 0.8);
    ctx.fx.sparkle(c, 0x6fe3cf, 14, 0.9);
    ctx.fx.sandSpray({ x: h.pos.x, y: ctx.world.groundAt(h.pos.x, h.pos.z) + 0.05, z: h.pos.z }, { x: -dx * 5, y: 1.6, z: -dz * 5 }, 1.8);
    ctx.toast(perfect ? 'PERFECT DODGE — COUNTER!' : 'DODGED — COUNTER!', '#6fe3cf');
    ctx.run.ultCharge = Math.min(1, ctx.run.ultCharge + (perfect ? 0.04 : 0.02));
    ctx.events.emit('perfectDodge');
    ctx.events.emit('qteDodge', perfect);
  }

  /** afterimages run on real time so they read the same in slow motion */
  update() {
    const now = this.now;
    const rdt = Math.min(0.1, Math.max(0, now - (this.lastReal || now)));
    this.lastReal = now;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i] -= rdt;
      if (this.queue[i] <= 0) {
        this.queue.splice(i, 1);
        this.ghost();
      }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += rdt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.g.removeFromParent();
        g.mat.dispose();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.mat.opacity = g.a * (1 - k) * (1 - k);
    }
  }

  /** freeze the hunter's current pose into a fading jade afterimage */
  private ghost() {
    const root = this.hunter.root;
    if (!root) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x8dffb8, vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !(m.geometry as THREE.BufferGeometry).getAttribute('color')) return;
      const c = new THREE.Mesh(m.geometry, mat);
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      c.frustumCulled = false;
      c.renderOrder = 2;
      g.add(c);
    });
    this.ctx.scene.add(g);
    this.ghosts.push({ g, mat, t: 0, life: 0.55, a: 0.5 });
  }

  clear() {
    for (const g of this.ghosts) {
      g.g.removeFromParent();
      g.mat.dispose();
    }
    this.ghosts.length = 0;
    this.queue.length = 0;
  }
}
