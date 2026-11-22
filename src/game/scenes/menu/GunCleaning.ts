// The main menu's hero loop: Sundown stands at the camp and cleans his revolver. A procedural cycle on
// his own rig (the four-armed scorpion-man, characters/sundown), every joint eased, nothing keyed:
//  WIPE     the gun hand holds the revolver up at the chest, the cloth hand works a rag (engine cloth,
//           pinned in the fist) along the barrel and round the frame, his head down over the work
//  SPIN     the cloth hand flicks the cylinder: it whirs (the gun rig's own `cylinder` part), clicks
//           and settles; the lower pincer arms twitch at the sound
//  BLOW     he lifts the gun to his jaw and blows the grit out of the chambers: a soft puff of dust
//  INSPECT  he holds it out and turns it to the light, then a glance up (at the camera, the corpse or a
//           sign under the cursor) before the next pass
// Weight sits on one leg, the hips sway with the breath, the tail curls and flicks, the pincers rest
// half open. MenuScene feeds the head-look target and the wind.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { Cloth, type ClothRenderer } from '../../../engine/physics/Cloth';
import type { Particles } from '../../fx/Particles';
import type { AudioEngine } from '../../../engine/audio/AudioEngine';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sm = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** a 0..1..0 window: in over [a, a + fin], out over [b - fout, b] */
const win = (k: number, a: number, b: number, fin = 0.35, fout = 0.35) => sm((k - a) / fin) * (1 - sm((k - (b - fout)) / fout));
const damp = (a: number, b: number, l: number, dt: number) => b + (a - b) * Math.exp(-l * dt);

const CYCLE = 11.5;
type Phase = 'wipe' | 'spin' | 'blow' | 'inspect';

export class GunCleaning {
  private t = 0;
  private flag = 0;
  private cyl = { a: 0, v: 0 };
  private rag: Cloth | null = null;
  private tail: THREE.Object3D[] = [];
  private claws: THREE.Object3D[][] = [];
  private flick = { t: 2, k: 0 };
  /** smoothed joint targets (so the phases blend) */
  private s: Record<string, number> = {};
  phase: Phase = 'wipe';
  /** where the eyes go this moment (null: the caller's look target) */
  focus: THREE.Vector3 | null = null;

  constructor(
    private hero: RigInstance,
    private gun: RigInstance | null,
    private gunSpin: THREE.Object3D,
    private particles: Particles,
    private audio: AudioEngine,
    cloth: ClothRenderer | null
  ) {
    const meta = hero.geo.spec.meta as { tail?: { parts: string[] }; claws?: Record<'l' | 'r', string[]> } | undefined;
    this.tail = (meta?.tail?.parts ?? []).map((k) => hero.nodes[k]).filter(Boolean);
    for (const s of ['l', 'r'] as const) {
      const n = (meta?.claws?.[s] ?? []).map((k) => hero.nodes[k]);
      if (n.length === 4 && n.every(Boolean)) this.claws.push(n);
    }
    for (const k of ['torso', 'head', 'pelvis']) if (hero.nodes[k]) hero.nodes[k].rotation.order = 'YXZ';
    // the rag: a square of old linen hanging from the cloth fist
    if (cloth) {
      try {
        this.rag = new Cloth({ w: 4, h: 5, width: 0.16, length: 0.22, colors: [0xd9cba6, 0xa8977a, 0x7e6c54], pattern: 'plain', fray: 0.35, stiffness: 0.55, damping: 0.08, pin: 'top', drag: 0.9, gravity: 1 });
        cloth.add(this.rag);
      } catch (e) {
        console.warn('[menu] rag', e);
        this.rag = null;
      }
    }
  }

  private ease(key: string, v: number, dt: number, l = 7) {
    const cur = this.s[key] ?? v;
    const n = damp(cur, v, l, dt);
    this.s[key] = n;
    return n;
  }

  update(dt: number, time: number, wind: THREE.Vector3) {
    const h = this.hero;
    const n = h.nodes;
    this.t += dt;
    const k = this.t % CYCLE;
    if (k < dt * 1.5) this.flag = 0;
    const phase: Phase = k < 5.2 ? 'wipe' : k < 6.9 ? 'spin' : k < 8.4 ? 'blow' : 'inspect';
    this.phase = phase;
    const set = (key: string, x: number, y = 0, z = 0) => n[key]?.rotation.set(this.ease(key + 'x', x, dt), this.ease(key + 'y', y, dt), this.ease(key + 'z', z, dt));
    // ---- legs and hips: weight on the right leg, the left knee soft and turned out
    const br = Math.sin(time * 1.5);
    const sway = Math.sin(time * 0.42) * 0.025;
    set('pelvis', 0.02, 0.1 + sway, -0.05 + sway * 0.6);
    set('thigh_r', 0.04, 0, 0.05);
    set('shin_r', 0.04);
    set('thigh_l', -0.16, 0.22, 0.12);
    set('shin_l', 0.3);
    // ---- the work
    const wipe = win(k, 0, 5.2, 0.6, 0.5);
    const spin = win(k, 5.0, 6.9, 0.3, 0.4);
    const blow = win(k, 6.8, 8.4, 0.4, 0.45);
    const insp = win(k, 8.3, CYCLE + 0.2, 0.5, 0.9);
    const stroke = Math.sin(k * 5.4) * wipe;
    const twist = Math.sin(k * 2.7 + 1) * wipe;
    // torso bends over the gun, rises for the blow and the look
    set('torso', 0.2 - blow * 0.08 - insp * 0.14 + br * 0.012, -0.08 + insp * 0.12, 0.02);
    // the gun hand: forearm up, the revolver at the chest; lifted to the jaw for the blow; out to the light
    set('arm_r', -0.42 - blow * 0.22 - insp * 0.18, 0.1, 0.32 + blow * 0.08 - insp * 0.12);
    set('fore_r', -1.55 - blow * 0.45 + insp * 0.15 + twist * 0.06, 0.35 + insp * 0.5 * Math.sin(k * 1.4), 0);
    // the cloth hand: rubbing along the barrel, flicking the cylinder, then down to the hip
    set('arm_l', -0.5 + stroke * 0.12 - spin * 0.1 + insp * 0.38, -0.12, -0.42 + stroke * 0.06 + insp * 0.3);
    set('fore_l', -1.5 + stroke * 0.32 - spin * 0.35 * Math.max(0, Math.sin((k - 5.2) * 9)) + insp * 1.0, 0.2, 0);
    // the revolver turns in the fist while it is worked on and looked over
    this.gunSpin.rotation.z = this.ease('gz', twist * 0.35 + insp * Math.sin(k * 1.1) * 0.5, dt, 5);
    // ---- the cylinder
    if (phase === 'spin' && this.flag === 0 && k > 5.45) {
      this.flag = 1;
      this.cyl.v = 34;
      this.audio.play('rev_spin', { volume: 0.4 });
      for (const c of this.claws) this.s[c[3].uuid] = 0.9;
    }
    this.cyl.v *= Math.exp(-dt * 1.6);
    if (this.cyl.v < 1.2 && this.cyl.v > 0) {
      // the last click into a chamber
      if (this.flag === 1) {
        this.flag = 2;
        this.audio.play('rev_hammer', { volume: 0.22, pitch: 1.2 });
      }
      this.cyl.v = 0;
      this.cyl.a = Math.round(this.cyl.a / (Math.PI / 3)) * (Math.PI / 3);
    }
    this.cyl.a += this.cyl.v * dt;
    const cylNode = this.gun?.nodes['cylinder'];
    if (cylNode) cylNode.rotation.z = this.cyl.a;
    // ---- the blow: a soft puff of grit off the chambers
    if (phase === 'blow' && this.flag === 2 && k > 7.45) {
      this.flag = 3;
      const at = (cylNode ?? this.gunSpin).getWorldPosition(new THREE.Vector3());
      const headAt = (n['head'] ?? h.root).getWorldPosition(new THREE.Vector3());
      const away = at.clone().sub(headAt).setY(0).normalize();
      this.audio.play('whoosh', { volume: 0.18, pitch: 1.6 });
      this.particles.emit({ pos: at, count: 16, spread: 0.12, up: 0.15, vel: { x: away.x * 0.9, y: 0.25, z: away.z * 0.9 }, life: [0.6, 1.3], size: [0.012, 0.006], sprite: ['grain0', 'grain1', 'grain2'], color: [0xe8cfa0, 0xc8a878], gravity: 0.6, drag: 1.4, jitter: 0.3 });
      this.particles.emit({ pos: at, count: 4, spread: 0.06, vel: { x: away.x * 0.5, y: 0.12, z: away.z * 0.5 }, life: [0.8, 1.4], size: [0.06, 0.22], sprite: ['puff0', 'puff1'], color: 0xe6d2ac, alpha: 0.32, drag: 2.2, rot: 3, rotSpeed: 0.8 });
    }
    // ---- head: down over the work, up for the blow and the look
    const headX = 0.34 - blow * 0.05 - insp * 0.42;
    this.focus = phase === 'inspect' && k > 9.6 ? null : (cylNode ?? this.gunSpin).getWorldPosition(new THREE.Vector3());
    this.s.headX = damp(this.s.headX ?? headX, headX, 5, dt);
    // ---- tail: a slow curl breath and a flick now and then
    this.flick.t -= dt;
    if (this.flick.t <= 0) {
      this.flick.t = 3 + Math.random() * 4;
      this.flick.k = 1;
    }
    this.flick.k = Math.max(0, this.flick.k - dt * 2.2);
    const nT = this.tail.length;
    this.tail.forEach((node, i) => {
      const f = i / Math.max(1, nT - 1);
      const curl = Math.sin(time * 0.7 - i * 0.5) * 0.05 + (spin > 0.5 ? 0.06 : 0) + this.flick.k * Math.sin(this.flick.k * 9 - i) * 0.25 * f;
      node.rotation.set(curl * (i ? 0.55 : 0.35), Math.sin(time * 0.9 + 0.6 - i * 0.4) * 0.07 * 0.4, 0);
    });
    // ---- the lower pincer arms: held half up, breathing, clicking now and then
    this.claws.forEach((c, i) => {
      const s = i === 0 ? 1 : -1;
      const b = Math.sin(time * 0.9 + s * 1.3) * 0.05;
      c[0].rotation.set(-0.28 + b, -s * 0.03, s * (0.1 + b * 0.5));
      c[1].rotation.set(-0.42 + b * 0.5, 0, 0);
      c[2].rotation.set(Math.sin(time * 1.3 + s * 1.7) * 0.12, 0, 0);
      const open = (this.s[c[3].uuid] = damp(this.s[c[3].uuid] ?? 0.1, 0.1 + Math.max(0, Math.sin(time * 0.37 + i * 2)) * 0.15, 3, dt));
      c[3].rotation.set(open, 0, 0);
    });
    // ---- the rag in the cloth fist
    const rag = this.rag;
    const hand = h.sockets['hand_l'] ?? n['fore_l'];
    if (rag && hand) {
      hand.updateMatrixWorld(true);
      const p = hand.getWorldPosition(new THREE.Vector3());
      const q = hand.getWorldQuaternion(new THREE.Quaternion());
      const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      rag.anchors.forEach((a, i) => a.copy(p).addScaledVector(across, (i / Math.max(1, rag.anchors.length - 1) - 0.5) * 0.08));
      rag.wind.copy(wind).multiplyScalar(0.35);
    }
  }

  /** the extra nod of the head over the work (added to the caller's look pitch) */
  get headPitch() {
    return this.s.headX ?? 0.3;
  }

  dispose(cloth: ClothRenderer | null) {
    if (this.rag && cloth) cloth.remove(this.rag);
    this.rag = null;
  }
}
