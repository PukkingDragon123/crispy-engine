// THE SOUL GLASS: the HUD's day timer is the loading screen's sculpted hourglass (loading/HourglassRig: gold
// caps with the jade-inlaid glyph band, bone papyrus columns, jackal feet, the winged soul-disc), live in the
// 3D HUD layer with its real solved sand, its grain stream and jade and violet souls flowing down through the
// bulbs and the neck, a few soul wisps swimming round it.
//
//  • the sand tracks the clock: the top bulb drains with the wave timer (the boss's life on a boss wave, the
//    countdown in the break between waves). Every new wave or break the glass turns over with a weighty flip.
//  • HOLD IT (H, or T when nothing else wants T, or the mouse held on the glass while the cursor is free)
//    between waves: Sundown's skeletal gun hand (models/props/boneHand) reaches in from the edge of the
//    screen, closes its finger bones round the waist of the glass, rips it off the HUD toward you and shakes
//    it hard. While it shakes the break runs HURRY times faster (WaveDirector.hurry) and the sand and souls
//    pour. Let go and the hand slams it back into its slot and withdraws. Mid-fight the glass only rattles.
// Everything is a spring or an eased track, never a cut: the glass lags the hand, the forearm swings with the
// shake, the finger bones tremble on the glass.
import * as THREE from 'three';
import type { Hud } from './Hud';
import { makeVoxelMaterial, type VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { boneHandRig, type HandMeta } from '../models/props/boneHand';
import { HourglassRig } from './loading/HourglassRig';
import { HG } from '../models/props/hourglass';
import { uiSfx } from './HudKit';

export interface GlassState {
  /** 0..1 of the sand still in the top bulb */
  frac: number;
  /** the sand is running */
  flowing: boolean;
  /** changes whenever a new wave or break begins (the glass flips) */
  phaseKey: string;
  /** it may be hurried now (between waves) */
  canHurry: boolean;
  /** T means something else right now (an interact prompt, a shop) */
  blocked: boolean;
  /** where it stands (HUD px, centre) and its height (HUD px) */
  x: number;
  y: number;
  h: number;
  visible: boolean;
}

type Mode = 'idle' | 'reach' | 'grip' | 'lift' | 'shake' | 'back' | 'release' | 'retreat';
const DUR: Record<Mode, number> = { idle: 0, reach: 0.3, grip: 0.12, lift: 0.3, shake: 0, back: 0.26, release: 0.12, retreat: 0.32 };
/** how much bigger the glass is in the hand than on the HUD */
const LIFT = 2.1;
/** forearm angle (rad from +X): the arm comes in from the upper right */
const ARM_ANGLE = 0.36;
/** the hand's size against the glass (cm of hand per voxel of glass height, tuned on the old 66-voxel glass) */
const HAND_PER_H = 2.4 / 66;
/** where the palm closes on the glass (voxels, glass space): in front of the waist, between two columns */
const GRIP_AT = new THREE.Vector3(2.5, 3.0, 21);

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const backOut = (t: number) => {
  const c = 1.9;
  t = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};

export class SoulGlassHud {
  group = new THREE.Group();
  /** the glass's own pivot (flips, turns and wobbles about its waist) */
  private body = new THREE.Group();
  private rig: HourglassRig;
  /** the wisps' frame (metres): they ride with the glass but do not turn with it */
  private wispHold = new THREE.Group();
  /** voxels from the waist to the middle of the frame's bounds, and its full height */
  private midY: number;
  private fullH: number;
  private viewCam = new THREE.Camera();
  private keyDir = new THREE.Vector3(-0.45, 0.8, 1);
  private rimDir = new THREE.Vector3(0.8, 0.2, -0.6);
  private handMat: VoxelMaterial;
  private hand: RigInstance | null = null;
  private handMeta: HandMeta | null = null;
  private mode: Mode = 'idle';
  private mt = 0;
  private t = 0;
  // the glass's on-screen transform (css px, three space: y up)
  private pos = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private rot = 0;
  private rotV = 0;
  private scale = 1;
  private home = new THREE.Vector2();
  private liftAt = new THREE.Vector2();
  private from = new THREE.Vector2();
  private fromScale = 1;
  // flip
  private flipT = 1;
  private lastKey = '';
  private shownFrac = 1;
  // hand
  private grip = 0;
  private shakeK = 0;
  private shakeT = 0;
  private sfxT = 0;
  private rattle = 0;
  private placed = false;
  private wantRelease = false;
  private mouseGrab = false;
  private deniedT = 0;
  /** being shaken: the break runs fast */
  hurrying = false;
  /** a little camera kick while it is shaken (RunScene's ctx.shake) */
  onShake?: (amt: number) => void;
  /** the glass's screen box (css px) for mouse holds */
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private hud: Hud) {
    this.rig = new HourglassRig({ ortho: true, wisps: 4, trail: 60, wispK: [0.42, 0.4], souls: 46 });
    const b = this.rig.box;
    this.midY = (b.max.y + b.min.y) / 2;
    this.fullH = Math.max(1, b.max.y - b.min.y);
    this.body.add(this.rig.body);
    this.group.add(this.body);
    if (this.rig.wisps) {
      this.wispHold.add(this.rig.wisps);
      this.wispHold.scale.setScalar(1 / HG.vs);
      this.group.add(this.wispHold);
    }
    this.group.visible = false;
    scene.add(this.group);
    this.handMat = makeVoxelMaterial({ fog: false });
    try {
      const spec = boneHandRig();
      this.handMeta = spec.meta as unknown as HandMeta;
      this.hand = new RigInstance(buildRigGeo(spec, 'hud_bone_hand'), { material: this.handMat, castShadow: false });
      this.hand.root.rotation.order = 'ZYX';
      this.hand.root.visible = false;
      scene.add(this.hand.root);
    } catch (e) {
      console.warn('[soul glass] hand failed', e);
    }
  }

  private held(st: GlassState) {
    const inp = (window as any).__engine?.input;
    if (!inp || !inp.enabled) return false;
    if (inp.isDown?.('KeyH')) return true;
    if (!st.blocked && inp.held?.('interact')) return true;
    // the mouse held on the glass while the cursor is free
    if (inp.isDown?.('Mouse0') && !inp.locked) {
      const b = this.box;
      const mx = inp.mouseX, my = inp.mouseY;
      if (this.mouseGrab || (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h)) {
        this.mouseGrab = true;
        return true;
      }
    } else this.mouseGrab = false;
    return false;
  }

  private go(m: Mode) {
    this.mode = m;
    this.mt = 0;
  }

  update(dt: number, st: GlassState) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.mt += dt;
    const s = this.hud.scale;
    const px = (st.h * s) / this.fullH;
    this.home.set(st.x * s, -st.y * s);
    if (!this.placed) {
      this.pos.copy(this.home);
      this.placed = true;
    }
    const W = window.innerWidth, H = window.innerHeight;
    this.liftAt.set(Math.min(W * 0.5, this.home.x - 60), -Math.max(H * 0.36, -this.home.y + 150));
    const want = this.held(st);
    // ------------------------------------------------ the hand's state machine
    switch (this.mode) {
      case 'idle':
        if (want && st.canHurry && st.visible && this.hand) {
          this.go('reach');
          this.wantRelease = false;
          uiSfx('whoosh_big', 0.5, 1.25);
        } else if (want && !st.canHurry && st.visible && this.deniedT <= 0) {
          // mid-fight: the sand will not be hurried
          this.rattle = 1;
          this.deniedT = 1.2;
          uiSfx('ui_error', 0.35, 0.9);
          uiSfx('sand_spray', 0.25, 1.4);
        }
        break;
      case 'reach':
        if (this.mt >= DUR.reach) {
          this.go('grip');
          uiSfx('hit_bone', 0.55, 1.3);
          uiSfx('counter_clang', 0.18, 2.2);
          this.vel.y -= 260;
          this.rotV += 2.2;
        }
        break;
      case 'grip':
        if (this.mt >= DUR.grip) {
          this.go('lift');
          this.from.copy(this.pos);
          this.fromScale = this.scale;
          uiSfx('whoosh', 0.55, 0.85);
        }
        break;
      case 'lift':
        if (this.mt >= DUR.lift) {
          this.go('shake');
          this.shakeT = 0;
        }
        break;
      case 'shake':
        if (!want) this.wantRelease = true;
        if ((this.wantRelease && this.shakeT > 0.55) || !st.canHurry) {
          this.go('back');
          this.from.copy(this.pos);
          this.fromScale = this.scale;
          uiSfx('whoosh', 0.45, 1.1);
        }
        break;
      case 'back':
        if (this.mt >= DUR.back) {
          this.go('release');
          // slammed down into its slot
          uiSfx('counter_clang', 0.45, 0.75);
          uiSfx('board_land', 0.4, 1.4);
          this.vel.y += 420;
          this.rotV -= 3;
          this.onShake?.(0.12);
        }
        break;
      case 'release':
        if (this.mt >= DUR.release) {
          this.go('retreat');
          uiSfx('whoosh_big', 0.35, 1.5);
        }
        break;
      case 'retreat':
        if (this.mt >= DUR.retreat) this.go('idle');
        break;
    }
    this.deniedT = Math.max(0, this.deniedT - dt);
    const carried = this.mode === 'grip' || this.mode === 'lift' || this.mode === 'shake' || this.mode === 'back';
    this.hurrying = this.mode === 'shake' && st.canHurry;

    // ------------------------------------------------ the glass's transform
    let tx = this.home.x, ty = this.home.y, tScale = 1;
    if (this.mode === 'lift') {
      const k = backOut(this.mt / DUR.lift);
      tx = this.from.x + (this.liftAt.x - this.from.x) * k;
      ty = this.from.y + (this.liftAt.y - this.from.y) * k;
      tScale = this.fromScale + (LIFT - this.fromScale) * easeOut(this.mt / DUR.lift);
    } else if (this.mode === 'shake') {
      this.shakeT += dt;
      this.shakeK = Math.min(1, this.shakeK + dt * 5);
      const a = this.shakeK, T = this.shakeT;
      // a hard, uneven shake: big side-to-side throws, a fast vertical judder, a little drift
      tx = this.liftAt.x + a * (30 * Math.sin(T * 34.5) + 9 * Math.sin(T * 13.1 + 1.3));
      ty = this.liftAt.y + a * (16 * Math.sin(T * 69 + 0.6) + 6 * Math.sin(T * 7.7));
      tScale = LIFT * (1 + 0.03 * Math.sin(T * 21));
      this.sfxT -= dt;
      if (this.sfxT <= 0) {
        this.sfxT = 0.15 + Math.random() * 0.05;
        uiSfx('skeleton_rattle', 0.32, 0.9 + Math.random() * 0.3);
        if (Math.random() < 0.45) uiSfx('sand_spray', 0.3, 1.2 + Math.random() * 0.4);
        this.onShake?.(0.035);
      }
    } else if (this.mode === 'back') {
      const k = ease(this.mt / DUR.back);
      tx = this.from.x + (this.home.x - this.from.x) * k;
      ty = this.from.y + (this.home.y - this.from.y) * k + Math.sin(k * Math.PI) * 40;
      tScale = this.fromScale + (1 - this.fromScale) * k;
    }
    if (this.mode !== 'shake') this.shakeK = Math.max(0, this.shakeK - dt * 6);
    // the glass rides a stiff spring toward its track (the hand leads, the glass lags a hair)
    const kS = carried ? 900 : 260, cS = carried ? 46 : 18;
    this.vel.x += ((tx - this.pos.x) * kS - this.vel.x * cS) * dt;
    this.vel.y += ((ty - this.pos.y) * kS - this.vel.y * cS) * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    if (!carried && this.mode !== 'release' && this.pos.distanceTo(this.home) > 600) this.pos.copy(this.home);
    this.scale += (tScale - this.scale) * Math.min(1, dt * (carried ? 22 : 10));
    // tilt: swings against the throw, wobbles on the spring
    const tRot = this.mode === 'shake' ? -this.vel.x * 0.0011 + 0.42 * this.shakeK * Math.sin(this.shakeT * 34.5 + 0.9) : this.mode === 'lift' ? -0.22 : 0;
    this.rotV += ((tRot - this.rot) * 140 - this.rotV * 13) * dt;
    this.rot += this.rotV * dt;
    if (this.rattle > 0) this.rattle = Math.max(0, this.rattle - dt * 2.5);
    const ratX = this.rattle * 3 * Math.sin(this.t * 70);

    // ------------------------------------------------ flips, sand and souls
    if (st.phaseKey !== this.lastKey) {
      if (this.lastKey && !carried && this.mode === 'idle' && st.visible) {
        this.flipT = 0;
        uiSfx('card_flip', 0.4, 0.6);
        uiSfx('sand_spray', 0.3, 0.8);
      }
      this.lastKey = st.phaseKey;
    }
    let flip = 0;
    if (this.flipT < 1) {
      this.flipT = Math.min(1, this.flipT + dt / 0.6);
      flip = backOut(this.flipT) * Math.PI;
      if (this.flipT >= 1) flip = 0;
    }
    // while it turns over the old sand shows (drained top, full heap) until it lands the right way up
    const frac = this.flipT < 1 ? 0 : Math.min(1, Math.max(0, st.frac));
    this.shownFrac += (frac - this.shownFrac) * Math.min(1, dt * (this.flipT < 1 ? 30 : 6));
    if (this.flipT >= 1 && Math.abs(frac - this.shownFrac) > 0.5) this.shownFrac = frac;
    this.rig.setFill(1 - this.shownFrac, dt, st.flowing && this.flipT >= 1);
    const u = this.rig.ptU;
    u.uTime.value = this.t;
    u.uHurry.value += ((this.hurrying ? 1 : 0) - u.uHurry.value) * Math.min(1, dt * 8);
    // one point = half a HUD pixel at the HUD size: the motes stay on the HUD's pixel grid
    u.uPx.value = (window.devicePixelRatio || 1) * s * 0.5 * Math.max(1, this.scale * 0.8);
    this.rig.lights(this.viewCam, this.keyDir, this.rimDir);

    // ------------------------------------------------ place the glass
    const vis = st.visible || this.mode !== 'idle';
    this.group.visible = vis;
    const vs = px * this.scale;
    const bob = carried ? 0 : Math.sin(this.t * 1.4) * 1.2 * s;
    // the frame's middle sits on the slot (the waist is a little below it: the soul-disc crowns the top)
    this.group.position.set(this.pos.x + ratX, this.pos.y + bob - this.midY * vs, 60 * this.scale);
    this.group.scale.setScalar(vs);
    this.body.rotation.set(0.14 + (carried ? 0.1 : 0), this.t * 0.3 + (carried ? -0.35 : 0), this.rot + flip + this.rattle * 0.08 * Math.sin(this.t * 55));
    this.group.updateMatrixWorld(true);
    const half = (this.fullH / 2) * vs;
    this.box = { x: this.pos.x - half * 0.6, y: -this.pos.y - half, w: half * 1.2, h: half * 2 };

    // ------------------------------------------------ the hand
    this.updateHand(dt, vs);
  }

  private updateHand(dt: number, vs: number) {
    const h = this.hand, meta = this.handMeta;
    if (!h || !meta) return;
    const m = this.mode;
    const on = m !== 'idle';
    h.root.visible = on && this.group.visible;
    if (!on) return;
    // the hand scales with the glass
    const cm = vs * this.fullH * HAND_PER_H;
    // where the palm sits: the waist of the glass, in front of it (the glass turns: grip where it faces us)
    const g = this.v3.copy(GRIP_AT);
    g.applyMatrix4(this.group.matrixWorld);
    g.z = Math.max(g.z, this.group.position.z + GRIP_AT.z * vs);
    // grip state: open while reaching, closing on the glass, opening to let go
    const closing = m === 'grip' ? ease(this.mt / DUR.grip) : m === 'lift' || m === 'shake' || m === 'back' ? 1 : m === 'release' ? 1 - ease(this.mt / DUR.release) : 0;
    this.grip += (closing - this.grip) * Math.min(1, dt * 30);
    // arm comes in from the upper right; it swings with the shake (the wrist leads the elbow)
    const swingA = this.mode === 'shake' ? -this.vel.y * 0.00022 + this.vel.x * 0.00012 : 0;
    const ang = ARM_ANGLE + swingA + (1 - this.grip) * 0.05;
    const root = h.root;
    root.rotation.set(Math.PI / 2 + Math.sin(this.t * 1.7) * 0.04, -0.12, ang + this.rot * 0.85);
    root.scale.setScalar(cm);
    root.updateMatrix();
    this.q.setFromEuler(root.rotation);
    const pc = new THREE.Vector3(meta.palmCentre[0], meta.palmCentre[1], meta.palmCentre[2]).applyQuaternion(this.q).multiplyScalar(cm);
    const gripWrist = new THREE.Vector3(g.x - pc.x, g.y - pc.y, g.z - pc.z);
    // off screen, along the arm
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
    const away = gripWrist.clone().addScaledVector(dir, 70 * cm);
    let k = 1;
    if (m === 'reach') k = backOut(this.mt / DUR.reach);
    else if (m === 'retreat') k = 1 - ease(this.mt / DUR.retreat) * 1.02;
    root.position.copy(away).lerp(gripWrist, Math.max(0, k));
    root.position.z = Math.max(root.position.z, g.z);
    // fingers: curl round the glass (flex about each knuckle), trembling with the effort while it shakes
    const tremble = this.mode === 'shake' ? 0.06 : 0.015;
    const open = [0.06, 0.12, 0.1], shut = [0.62, 1.12, 0.86];
    for (let i = 1; i <= 4; i++)
      for (let j = 1; j <= 3; j++) {
        const n = h.nodes[`f${i}_${j}`];
        if (!n) continue;
        const a = open[j - 1] + (shut[j - 1] - open[j - 1]) * this.grip * (1 - (i - 1) * 0.04) + Math.sin(this.t * 31 + i * 1.7 + j) * tremble * this.grip;
        n.rotation.set(0, 0, a);
      }
    const ta = new THREE.Vector3(meta.thumbAxis[0], meta.thumbAxis[1], meta.thumbAxis[2]);
    for (let j = 1; j <= 3; j++) {
      const n = h.nodes[`t_${j}`];
      if (n) n.quaternion.setFromAxisAngle(ta, (0.12 + 0.55 * this.grip) * (j === 1 ? 0.6 : 1));
    }
    // the wrist: cocked back while reaching, flexed into the grip, snapping with the shake
    const palm = h.nodes['palm'];
    if (palm) palm.rotation.set(0, Math.sin(this.shakeT * 34.5) * 0.08 * this.shakeK, -0.18 * (1 - this.grip) + 0.12 * this.grip);
  }

  dispose() {
    this.group.removeFromParent();
    this.hand?.dispose();
    this.rig.dispose();
    this.handMat.dispose();
    void this.scene;
  }
}
