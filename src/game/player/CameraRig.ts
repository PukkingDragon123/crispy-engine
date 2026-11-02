// Third-person over-the-shoulder camera with speed FOV, aim zoom, terrain
// collision, trauma shake, recoil kick and blendable cinematic overrides.
import * as THREE from 'three';
import { clamp, damp, noise } from '../../engine/math/rand';

export interface CineShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

export class CameraRig {
  yaw = 0;
  pitch = -0.12;
  dist = 5.2;
  height = 1.45;
  shoulder = 0.9;
  fov = 72;
  trauma = 0;
  recoil = 0;
  roll = 0;
  aim = 0; // 0..1 aim blend
  scope = 0;
  cine: CineShot | null = null;
  cineBlend = 0;
  private cineTarget = 0;
  private cur = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private first = true;
  sensitivity = 0.0022;
  shakeScale = 1;

  constructor(public camera: THREE.PerspectiveCamera, public groundAt: (x: number, z: number) => number) {}

  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t * this.shakeScale);
  }
  kick(r: number) {
    this.recoil += r;
  }

  setCine(shot: CineShot | null, blendIn = true) {
    if (shot) this.cine = shot;
    this.cineTarget = shot ? 1 : 0;
    if (!blendIn) this.cineBlend = this.cineTarget;
  }

  mouse(dx: number, dy: number) {
    const s = this.sensitivity * (1 - this.aim * 0.45 - this.scope * 0.35);
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.15, 0.85);
  }

  forward() {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  update(dt: number, target: THREE.Vector3, speed: number, airborne: boolean, lean: number) {
    // smooth target follow (lag grows with speed for sense of motion)
    if (this.first) {
      this.smoothTarget.copy(target);
      this.first = false;
    }
    const lag = clamp(18 - speed * 0.18, 9, 18);
    this.smoothTarget.x = damp(this.smoothTarget.x, target.x, lag, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, target.z, lag, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, target.y, airborne ? 6 : 12, dt);
    const T = this.smoothTarget;

    this.recoil = damp(this.recoil, 0, 9, dt);
    const pitch = this.pitch + this.recoil * 0.5;
    const d = (this.dist + clamp(speed - 12, 0, 30) * 0.045) * (1 - this.aim * 0.42 - this.scope * 0.25);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sh = this.shoulder * (1 + this.aim * 0.15);
    const head = this.tmp.set(T.x + rx * sh, T.y + this.height, T.z + rz * sh);
    // desired camera position (behind, pitched)
    let cx = head.x - fx * cp * d, cy = head.y - sp * d, cz = head.z - fz * cp * d;
    // terrain collision along the boom
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      const px = head.x + (cx - head.x) * k, py = head.y + (cy - head.y) * k, pz = head.z + (cz - head.z) * k;
      const g = this.groundAt(px, pz) + 0.45;
      if (py < g) {
        // pull camera up and in
        const kk = Math.max(0.25, k - 0.08);
        cx = head.x + (cx - head.x) * kk;
        cz = head.z + (cz - head.z) * kk;
        cy = Math.max(head.y + (cy - head.y) * kk, this.groundAt(cx, cz) + 0.5);
        break;
      }
    }
    cy = Math.max(cy, this.groundAt(cx, cz) + 0.45);
    // look target ahead along aim
    const lx = head.x + fx * cp * 30, ly = head.y + sp * 30 + 0.2, lz = head.z + fz * cp * 30;

    this.cineBlend = damp(this.cineBlend, this.cineTarget, 3.2, dt);
    if (this.cineBlend < 0.001 && this.cineTarget === 0) this.cine = null;
    const cb = this.cine ? this.cineBlend : 0;
    const smoothK = 1 - Math.exp(-30 * dt);
    if (cb > 0 && this.cine) {
      const e = cb * cb * (3 - 2 * cb);
      this.cur.set(cx + (this.cine.pos.x - cx) * e, cy + (this.cine.pos.y - cy) * e, cz + (this.cine.pos.z - cz) * e);
      this.look.set(lx + (this.cine.look.x - lx) * e, ly + (this.cine.look.y - ly) * e, lz + (this.cine.look.z - lz) * e);
    } else {
      this.cur.lerp(new THREE.Vector3(cx, cy, cz), smoothK);
      this.look.set(lx, ly, lz);
    }
    const cam = this.camera;
    cam.position.copy(this.cur);
    cam.lookAt(this.look);
    // roll with carve lean
    this.roll = damp(this.roll, -lean * 0.06, 4, dt);
    cam.rotateZ(this.roll + (this.cine?.roll ?? 0) * cb);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const t = performance.now() / 1000;
      cam.rotateX(noise.n2(t * 23, 1.7) * 0.06 * s);
      cam.rotateY(noise.n2(t * 23, 7.3) * 0.06 * s);
      cam.rotateZ(noise.n2(t * 19, 3.1) * 0.08 * s);
    }
    // FOV
    const targetFov = cb > 0.5 && this.cine ? this.cine.fov : 72 + clamp(speed - 10, 0, 34) * 0.42 - this.aim * 22 - this.scope * 26 + (airborne ? 3 : 0);
    this.fov = damp(this.fov, targetFov, 6, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  /** aim ray from camera through screen center */
  aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    origin.copy(this.camera.position);
    this.camera.getWorldDirection(dir);
  }
}
