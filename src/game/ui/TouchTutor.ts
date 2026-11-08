// The first-time touch tutorial: Sundown's own left forearm and open bony hand
// (the `fore_l` part of the player's rig, studded wrist band and all), turned
// into a jade spectre in the 3D HUD overlay, shows each gesture on the glass:
// it presses, sways, drags, taps on the beat and flicks, trailing soul motes,
// while an Alagard caption names it. Each step waits for the player to do it
// (or moves on after a while); the last one marks the tutorial as seen.
// Re-run it with ?touchtutor=1.
import * as THREE from 'three';
import type { RigGeo } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { PixelFx, TAU, uiSfx } from './HudKit';
import type { Hud } from './Hud';

const KEY = 'dustup.touchTutor';

export function tutorSeen() {
  try {
    if (new URLSearchParams(location.search).get('touchtutor') === '1') return false;
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
/** show the touch lesson again on the next ride (settings) */
export function resetTutor() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}
function markSeen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked */
  }
}

/** progress counters kept by TouchControls */
export interface TouchStats {
  ride: number;
  aim: number;
  push: number;
  jump: number;
  drift: number;
  hud: number;
}

/** where the hand is this instant: fingertip (css px), how hard it presses (0 lifted .. 1 on the glass), which hand */
interface Pose {
  x: number;
  y: number;
  press: number;
  right: boolean;
}

interface Step {
  title: string;
  sub: string;
  done: (s: TouchStats, b: TouchStats) => boolean;
  pose: (t: number, W: number, H: number, hud: Hud) => Pose;
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

const STEPS: Step[] = [
  {
    title: 'HOLD HERE TO RIDE',
    sub: 'he kicks along by himself. drag to steer, pull back to brake',
    done: (s, b) => s.ride - b.ride > 1.6,
    pose: (t, W, H) => ({ x: W * 0.2 + Math.sin(t * 1.5) * W * 0.045 * ease(t - 0.6), y: H * 0.7 + Math.max(0, Math.sin(t * 0.75 - 2)) * H * 0.04, press: ease(t * 2.5), right: false }),
  },
  {
    title: 'DRAG HERE TO AIM',
    sub: 'the gun fires itself when a target sits in the sights',
    done: (s, b) => s.aim - b.aim > 260,
    pose: (t, W, H) => {
      const u = Math.max(0, t - 0.5);
      return { x: W * 0.72 + Math.sin(u * 1.3) * W * 0.09, y: H * 0.46 + Math.sin(u * 2.6) * H * 0.06, press: ease(t * 2.5), right: true };
    },
  },
  {
    title: 'TAP BETWEEN HIS KICKS',
    sub: 'tap right on the beat for a perfect push',
    done: (s, b) => s.push - b.push >= 2,
    pose: (t, W, H) => {
      const ph = (t % 0.6) / 0.6;
      const down = ph < 0.22 ? 1 - ph / 0.22 : ph > 0.8 ? (ph - 0.8) / 0.2 : 0;
      return { x: W * 0.74, y: H * 0.68, press: ease(down) * ease(t * 3), right: true };
    },
  },
  {
    title: 'FLICK UP TO JUMP',
    sub: 'keep it up to charge, flick sideways to drift',
    done: (s, b) => s.jump - b.jump >= 1,
    pose: (t, W, H) => {
      const ph = t % 1.8;
      const fl = ease((ph - 0.55) / 0.16);
      const lift = ph > 0.95 ? ease((ph - 0.95) / 0.3) : 0;
      return { x: W * 0.2 + fl * W * 0.01, y: H * 0.74 - fl * H * 0.2, press: ease(ph * 4) * (1 - lift), right: false };
    },
  },
  {
    title: 'TAP A CARD TO CAST',
    sub: 'tap the cylinder to reload, the soul jar to unleash',
    done: (s, b) => s.hud - b.hud >= 1,
    pose: (t, W, H, hud) => {
      const s = hud.scale;
      const c = hud.cardAnchors[0];
      const x = c ? c.x * s : W * 0.5, y = c ? c.y * s : H - 32 * s;
      const ph = t % 1.4;
      const down = ph < 0.25 ? ph / 0.25 : ph < 0.45 ? 1 : ph < 0.7 ? 1 - (ph - 0.45) / 0.25 : 0;
      return { x, y, press: ease(down), right: true };
    },
  },
];

/** a step moves on by itself after this long (s) */
const STEP_MAX = 14;

export class TouchTutor {
  running = false;
  finished = false;
  private root = new THREE.Group();
  private lean = new THREE.Group();
  private tip = new THREE.Group();
  private body = new THREE.Group();
  private mat: VoxelMaterial;
  private mesh: THREE.Mesh | null = null;
  private len = 0.45;
  private step = 0;
  private t = 0;
  private fade = 0;
  private gap = 0;
  private base: TouchStats | null = null;
  private title: HTMLDivElement;
  private lastPose: Pose = { x: 0, y: 0, press: 0, right: false };
  private s = 2;

  constructor(private scene: THREE.Scene, geo: RigGeo, private fx: PixelFx, caption: HTMLDivElement) {
    this.title = caption;
    this.mat = makeVoxelMaterial({ fog: false, transparent: true, opacity: 0.86 });
    this.mat.emissive = new THREE.Color(0x2fdc8a);
    this.mat.emissiveIntensity = 0.5;
    (this.mat.userData as any).tint.value.setRGB(0.86, 1.12, 1.0);
    const pi = geo?.index?.['fore_l'];
    const part = pi !== undefined ? geo.parts[pi] : null;
    if (part) {
      const g = part.geo as THREE.BufferGeometry;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      this.len = Math.max(0.1, bb.max.y - bb.min.y);
      // the fingertips: the lowest vertices of the hanging hand
      const pos = g.attributes.position as THREE.BufferAttribute;
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pos.count; i++)
        if (pos.getY(i) < bb.min.y + this.len * 0.06) {
          sx += pos.getX(i);
          sz += pos.getZ(i);
          n++;
        }
      const m = new THREE.Mesh(g, this.mat);
      m.position.set(-(n ? sx / n : 0), -bb.min.y, -(n ? sz / n : 0));
      m.renderOrder = 90;
      m.frustumCulled = false;
      this.mesh = m;
      this.body.add(m);
    }
    // hanging hand -> fingers up, back of the hand to the viewer; fingertips lean into the glass
    this.body.rotation.x = Math.PI;
    this.tip.add(this.body);
    this.lean.add(this.tip);
    this.root.add(this.lean);
    this.root.visible = false;
    scene.add(this.root);
  }

  /** `active`: gameplay is live and the HUD is up (the tutorial pauses otherwise) */
  update(dt: number, s: number, stats: TouchStats, hud: Hud, active: boolean) {
    if (this.finished) return;
    if (!this.mesh) {
      this.finish();
      return;
    }
    const W = window.innerWidth, H = window.innerHeight;
    this.s = s;
    if (active && !this.running) {
      this.running = true;
      this.base = { ...stats };
      this.t = 0;
    }
    const show = active && this.running && this.gap <= 0;
    this.fade += ((show ? 1 : 0) - this.fade) * Math.min(1, dt * (show ? 5 : 8));
    if (this.gap > 0) this.gap -= dt;
    this.root.visible = this.fade > 0.02;
    this.title.style.opacity = String(Math.max(0, this.fade * 1.4 - 0.4));
    if (!this.running || !active) return;
    const st = STEPS[this.step];
    if (this.gap <= 0) {
      this.t += dt;
      if (st.done(stats, this.base!) || this.t > STEP_MAX) {
        this.burst(this.lastPose, 26);
        uiSfx('qte_good', 0.35, 1.25 + this.step * 0.06);
        this.step++;
        this.t = 0;
        this.gap = 0.55;
        this.base = { ...stats };
        if (this.step >= STEPS.length) {
          this.finish();
          return;
        }
      }
    }
    const step = STEPS[this.step];
    const p = step.pose(this.t, W, H, hud);
    this.lastPose = p;
    this.pose(p, H);
    // caption above the hand, kept on screen
    const text = `${step.title}<small>${step.sub.toUpperCase()}</small>`;
    if (this.title.dataset.k !== String(this.step)) {
      this.title.dataset.k = String(this.step);
      this.title.innerHTML = text;
    }
    const half = this.title.offsetWidth / 2 + 10;
    this.title.style.left = Math.min(W - half, Math.max(half, p.x)) + 'px';
    this.title.style.top = Math.max(8, p.y - 104) + 'px';
    // soul motes off the fingertip, a puff of light where it meets the glass
    if (this.fade > 0.3) {
      if (Math.random() < dt * 22)
        this.fx.emit({ x: p.x / s + (Math.random() - 0.5) * 6, y: p.y / s + 4 + Math.random() * 10, vx: (Math.random() - 0.5) * 8, vy: -8 - Math.random() * 10, life: 0.6 + Math.random() * 0.5, size: Math.random() < 0.2 ? 2 : 1, c0: 0xc4ffe0, c1: 0x2fbf7e, alpha: 0.8, curl: 6, flick: 0.4 });
      if (p.press > 0.85 && Math.random() < dt * 30) {
        const a = Math.random() * TAU;
        this.fx.emit({ x: p.x / s, y: p.y / s, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22, drag: 4, life: 0.35, size: 1, c0: 0xfff3d6, c1: 0x5cf0a8, alpha: 0.85, flick: 0.3 });
      }
    }
  }

  /** place the hand: fingertip on (x, y); lifted hands hover up and back */
  private pose(p: Pose, H: number) {
    const k = (H * 0.44) / this.len;
    const lift = 1 - p.press;
    this.root.position.set(p.x + lift * 14 * (p.right ? 1 : -1), -(p.y - lift * 22), 2200);
    this.root.scale.set(k * (p.right ? -1 : 1) * (1 + lift * 0.08), k * (1 + lift * 0.08), k);
    // the forearm comes in from the lower outside corner
    this.lean.rotation.z = -0.42 + Math.sin(performance.now() * 0.0013) * 0.03;
    this.tip.rotation.x = -0.75 + lift * 0.25;
    this.mat.opacity = 0.86 * this.fade;
    this.mat.emissiveIntensity = 0.42 + p.press * 0.18;
  }

  private burst(p: Pose, n: number) {
    const s = this.s;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.fx.emit({ x: p.x / s, y: p.y / s, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, drag: 4, life: 0.45 + Math.random() * 0.2, size: i % 5 ? 1 : 2, c0: 0xc4ffe0, c1: 0x2fbf7e, flick: 0.35 });
    }
  }

  private finish() {
    this.finished = true;
    this.running = false;
    this.title.style.opacity = '0';
    markSeen();
    this.dispose();
  }

  dispose() {
    this.root.removeFromParent();
    this.mat.dispose();
    void this.scene;
  }
}
