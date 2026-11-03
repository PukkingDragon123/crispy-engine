// A cinematic camera that sits on top of the run camera: every frame, after the
// scene has moved its own camera (CameraRig), it lays the cut's shot over it -
// hard cuts, blends in and out, a dutch roll and its own handheld shake - so a
// cutscene never fights a boss's own choreography: when it ends it simply
// blends back to whatever the CameraRig is doing at that moment.
import * as THREE from 'three';
import { noise } from '../../engine/math/rand';

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

export class CineCam {
  shot: Shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), fov: 50, roll: 0 };
  /** 0 = the game's camera, 1 = the shot */
  blend = 0;
  private target = 0;
  private rate = 4;
  private trauma = 0;
  private t = 0;
  /** keeps the lens above this surface (optional) */
  groundAt: ((x: number, z: number) => number) | null = null;

  constructor(public camera: THREE.PerspectiveCamera) {}

  get on() {
    return this.blend > 0.0005 || this.target > 0;
  }

  /** take the screen: a hard cut (default) or a blend over ~1/rate s */
  take(cut = true, rate = 4) {
    this.target = 1;
    this.rate = rate;
    if (cut) this.blend = 1;
  }
  /** hand the screen back, blending over ~1/rate s */
  release(rate = 2.2) {
    this.target = 0;
    this.rate = rate;
  }
  /** drop out at once */
  kill() {
    this.target = 0;
    this.blend = 0;
  }
  set(pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0) {
    this.shot.pos.copy(pos);
    this.shot.look.copy(look);
    this.shot.fov = fov;
    this.shot.roll = roll;
    if (this.groundAt) {
      const g = this.groundAt(pos.x, pos.z) + 0.35;
      if (this.shot.pos.y < g) this.shot.pos.y = g;
    }
  }
  shake(a: number) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** call once per frame after the scene updated its camera */
  apply(rdt: number) {
    this.t += rdt;
    const d = this.target - this.blend;
    if (Math.abs(d) > 1e-4) this.blend += d * Math.min(1, rdt * this.rate * (d > 0 ? 1.4 : 1));
    if (this.target === 0 && this.blend < 0.002) this.blend = 0;
    this.trauma = Math.max(0, this.trauma - rdt * 1.25);
    if (this.blend <= 0) return;
    const cam = this.camera;
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    // shot orientation
    _m.lookAt(this.shot.pos, this.shot.look, _up);
    _q.setFromRotationMatrix(_m);
    if (this.shot.roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, this.shot.roll));
    const s = this.trauma * this.trauma;
    if (s > 1e-4) {
      const tt = this.t;
      const sh = new THREE.Euler(noise.n2(tt * 21, 1.7) * 0.07 * s, noise.n2(tt * 21, 7.3) * 0.07 * s, noise.n2(tt * 17, 3.1) * 0.09 * s);
      _q.multiply(new THREE.Quaternion().setFromEuler(sh));
    }
    cam.position.lerp(this.shot.pos, e);
    cam.quaternion.slerp(_q, e);
    cam.fov += (this.shot.fov - cam.fov) * e;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
}
