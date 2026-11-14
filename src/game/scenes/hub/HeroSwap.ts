// WHO RIDES: once Mark is free (Khonsu of the Sands has fallen) his crescent board leans
// against the wall by the barn doors, moonlight pooled round it. Click it at the doors to
// swap riders: the board lifts off the wall and turns in a ring of moon motes, and the
// pick is written to the save (`hero`, read by main.ts on the ride). While Mark is the
// rider the board glows and the doors' subtitle says so; with Sundown it rests dim.
import * as THREE from 'three';
import type { Engine } from '../../../engine/Engine';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import type { Particles } from '../../fx/Particles';
import { modelEntry } from '../../models/lookup';
import { crescentBoardModel } from '../../models/enemies/khonsuMoon';
import { markOpen, chosenHero, setHero, chosenStage } from '../../meta/StageUnlocks';
import { say3D } from '../../fx/WorldSpeech';
import { damp, rnd } from '../../../engine/math/rand';

export interface HeroSwapHost {
  scene: THREE.Scene;
  engine: Engine;
  particles: Particles;
  /** foot of the board on the floor, the wall it leans on is behind it (-Z of `yaw`) */
  at: THREE.Vector3;
  yaw: number;
  /** the barn-door station: its subtitle names the rider, and the board joins its clickables */
  station: { sub: string; objs: THREE.Object3D[] };
}

const PALE = [0xcfe8ff, 0xffffff, 0x9fd0ff];

export class HeroSwap {
  obj = new THREE.Group();
  private tilt = new THREE.Group();
  private mat: VoxelMaterial;
  private geo: THREE.BufferGeometry;
  private light: THREE.PointLight;
  private glow = 0;
  private lift = 0;
  private spin = 0;
  private t = 0;
  private fxT = 0;

  static build(h: HeroSwapHost): HeroSwap | null {
    if (!markOpen()) return null;
    return new HeroSwap(h);
  }

  private constructor(private h: HeroSwapHost) {
    const b = (modelEntry('board_crescent')?.() as { model: VoxelModel; voxelSize: number } | undefined) ?? crescentBoardModel();
    this.geo = buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: 'center' });
    this.geo.computeBoundingBox();
    const bb = this.geo.boundingBox!;
    this.mat = makeVoxelMaterial();
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // stood on end, deck (and its silver crescent) to the room, leaning back against the wall
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = bb.max.z;
    this.tilt.add(mesh);
    this.tilt.rotation.x = -0.2;
    this.obj.add(this.tilt);
    this.obj.position.copy(h.at);
    this.obj.rotation.y = h.yaw;
    this.light = new THREE.PointLight(0xbfdcff, 0, 2.6, 1.8);
    this.light.position.set(0, 0.9, 0.35);
    this.obj.add(this.light);
    h.scene.add(this.obj);
    h.station.objs.push(this.obj);
    this.glow = chosenHero() === 'mark' ? 1 : 0;
    this.caption();
  }

  /** is this (a hit object or one of its parents) the board? */
  is(o: THREE.Object3D | null) {
    return o === this.obj;
  }
  tip() {
    return chosenHero() === 'mark' ? 'Ride as Sundown' : 'Ride as Mark';
  }

  private caption() {
    const who = chosenHero() === 'mark' ? 'Mark' : 'Sundown';
    const where = chosenStage() === 'nile' ? 'the river is calling' : 'the dunes are calling';
    this.h.station.sub = `${who} rides out · ${where}`;
  }

  /** swap riders */
  toggle() {
    const next = chosenHero() === 'mark' ? 'sundown' : 'mark';
    setHero(next);
    this.caption();
    this.spin = 1;
    const eng = this.h.engine;
    eng.audio.play(next === 'mark' ? 'divine_chime' : 'card_flip', { volume: 0.6, pitch: next === 'mark' ? 0.8 : 1.1 });
    eng.audio.play('whoosh', { volume: 0.4, pitch: 1.4 });
    const p = this.obj.localToWorld(new THREE.Vector3(0, 0.9, 0.2));
    this.h.particles.emit({ pos: p, count: next === 'mark' ? 30 : 12, spread: 0.9, up: 0.8, life: [0.6, 1.2], size: [0.06, 0.015], sprite: ['star4', 'spark', 'dot3'], additive: true, color: next === 'mark' ? PALE : [0xffd8a0, 0xfff2d0], drag: 1.4 });
    say3D(eng, next === 'mark' ? 'MARK RIDES NEXT' : 'SUNDOWN RIDES NEXT', () => this.obj.localToWorld(new THREE.Vector3(0, 1.9, 0)), {
      key: 'hub:rider', size: 0.13, px: 64, color: '#eef6ff', glow: next === 'mark' ? '#7fc4ff' : '#ffb070', hdr: 1.6, hold: 1.8,
    });
  }

  update(dt: number) {
    this.t += dt;
    const mark = chosenHero() === 'mark';
    this.glow = damp(this.glow, mark ? 1 : 0, 3, dt);
    this.spin = Math.max(0, this.spin - dt * 1.1);
    // a swap lifts it off the wall, turns it once, and sets it back
    const s = this.spin;
    this.lift = Math.sin(s * Math.PI) * 0.14;
    this.tilt.position.y = this.lift;
    this.tilt.rotation.x = -0.2 + Math.sin(s * Math.PI) * 0.18;
    this.tilt.rotation.y = (1 - s * s) * Math.PI * 2;
    this.light.intensity = 0.25 + this.glow * (1.4 + Math.sin(this.t * 2.1) * 0.25);
    (this.mat.userData.emissiveStrength as { value: number }).value = 0.4 + this.glow * 1.3;
    // moon motes drift up round it while he is the rider
    this.fxT -= dt;
    if (this.glow > 0.4 && this.fxT <= 0) {
      this.fxT = 0.18;
      const p = this.obj.localToWorld(new THREE.Vector3((rnd.next() - 0.5) * 0.5, 0.2 + rnd.next() * 1.3, 0.2));
      this.h.particles.emit({ pos: p, count: 1, vel: { x: 0, y: 0.25, z: 0 }, life: [1.2, 2], size: [0.035, 0.01], sprite: ['dot3', 'star4'], additive: true, color: PALE, drag: 0.4 });
    }
  }

  dispose() {
    this.obj.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
