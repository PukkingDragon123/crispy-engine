// Sundown's cigarette: a thin curl of 2D pixel-art smoke rising off the ember (it drifts with his motion and
// streams back at speed), and a lungful exhaled from the corner of his mouth now and then while he idles, and
// a beat after every kill. The rig names its sockets in meta.smoke ({ tip, mouth }); rigs without it get none.
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';
import type { Ctx } from '../Ctx';

const SMOKE = [0xd8d2c8, 0xb9b2a8, 0x9a948c];
const SPRITES = ['puff0', 'puff1', 'puff2', 'cloud0'];

export class CigSmoke {
  private tip: THREE.Object3D | null = null;
  private mouth: THREE.Object3D | null = null;
  private acc = 0;
  private t = 0;
  /** seconds to the next idle puff */
  private idleT = 5;
  /** a queued exhale: seconds until it starts, then how long it keeps flowing */
  private wait = -1;
  private flow = 0;
  private p = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private primed = false;

  constructor(private ctx: Ctx, rig: RigInstance) {
    const sm = rig.geo.spec.meta?.smoke as { tip?: string; mouth?: string } | undefined;
    if (!sm?.tip) return;
    this.tip = rig.sockets[sm.tip] ?? null;
    this.mouth = (sm.mouth && rig.sockets[sm.mouth]) || this.tip;
    if (this.tip) ctx.events.on('enemyKilled', this.onKill);
  }

  get active() {
    return !!this.tip;
  }

  /** a beat after a kill: a slow, satisfied exhale */
  private onKill = () => {
    if (this.wait < 0 && this.flow <= 0) this.wait = 0.35 + Math.random() * 0.35;
  };

  /** dt in seconds; idle = standing still with nothing to do; visible = the cigarette is on screen (alive, not hidden) */
  update(dt: number, idle: boolean, visible: boolean) {
    const tip = this.tip;
    if (!tip || dt <= 0) return;
    this.t += dt;
    tip.getWorldPosition(this.p);
    if (!this.primed) {
      this.prev.copy(this.p);
      this.primed = true;
    }
    // the ember's own velocity: smoke left behind trails the way he came from
    this.vel.subVectors(this.p, this.prev).divideScalar(Math.max(dt, 1e-3));
    this.prev.copy(this.p);
    if (!visible) {
      this.wait = -1;
      this.flow = 0;
      return;
    }
    const sp = Math.min(30, this.vel.length());
    // the curl: a wisp every ~0.09 s, thinner at speed (the wind tears it off)
    this.acc += dt;
    const every = 0.085 + Math.min(0.12, sp * 0.006);
    while (this.acc >= every) {
      this.acc -= every;
      const sway = Math.sin(this.t * 2.3) * 0.08;
      this.ctx.particles.emit({
        pos: { x: this.p.x, y: this.p.y + 0.01, z: this.p.z },
        count: 1,
        vel: { x: -this.vel.x * 0.12 + sway, y: 0.32 + Math.random() * 0.1, z: -this.vel.z * 0.12 + Math.cos(this.t * 1.7) * 0.06 },
        spread: 0.05,
        life: [1.1, 1.9],
        size: [0.035, 0.2],
        sprite: SPRITES,
        color: SMOKE,
        alpha: 0.5,
        drag: 0.9,
        rot: 6,
        rotSpeed: 0.8,
        fadeIn: 0.12,
      });
    }
    // idle: a drag and a slow exhale every so often
    if (idle) {
      this.idleT -= dt;
      if (this.idleT <= 0 && this.wait < 0 && this.flow <= 0) {
        this.wait = 0.2;
        this.idleT = 5 + Math.random() * 5;
      }
    } else this.idleT = Math.max(this.idleT, 2.5);
    if (this.wait >= 0) {
      this.wait -= dt;
      if (this.wait < 0) this.flow = 0.7;
    }
    if (this.flow > 0) {
      this.flow -= dt;
      const m = this.mouth ?? tip;
      m.getWorldPosition(this.p);
      // blown out and a little down from the corner of his mouth, then it rises and spreads
      const fwd = tip.getWorldPosition(new THREE.Vector3()).sub(this.p).normalize();
      this.ctx.particles.emit({
        pos: { x: this.p.x, y: this.p.y, z: this.p.z },
        count: 2,
        vel: { x: fwd.x * 0.9 - this.vel.x * 0.1, y: 0.05, z: fwd.z * 0.9 - this.vel.z * 0.1 },
        spread: 0.18,
        up: 0.12,
        life: [1.3, 2.3],
        size: [0.06, 0.42],
        sprite: SPRITES,
        color: SMOKE,
        alpha: 0.46,
        drag: 1.6,
        rot: 6,
        rotSpeed: 0.6,
        fadeIn: 0.08,
      });
    }
  }

  dispose() {
    if (this.tip) this.ctx.events.off('enemyKilled', this.onKill);
    this.tip = this.mouth = null;
  }
}
