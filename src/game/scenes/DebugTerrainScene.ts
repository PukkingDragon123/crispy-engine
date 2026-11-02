// Dev scene: generate a sub-area and fly a camera over it (?debug=terrain&area=A&zone=0&yaw=..&h=..)
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { generateSubArea } from '../world/RegionGen';
import { Terrain } from '../world/Terrain';
import { Env } from '../world/Env';

export class DebugTerrainScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  terrain!: Terrain;
  env!: Env;
  focus = new THREE.Vector3();
  constructor(private engine: Engine, private params: URLSearchParams) {}
  async enter() {
    const area = (this.params.get('area') ?? 'A') as 'A' | 'B' | 'C';
    const t0 = performance.now();
    const sa = generateSubArea(area, +(this.params.get('seed') ?? 7));
    const t1 = performance.now();
    for (const z of sa.zones) if (z.riseStamp) sa.field.setStampWeight(z.riseStamp, 1);
    this.env = new Env(this.scene, sa.env);
    this.terrain = new Terrain(sa.field, sa.wind);
    this.scene.add(this.terrain.group);
    const zi = +(this.params.get('zone') ?? 0);
    const z = sa.zones[Math.min(zi, sa.zones.length - 1)];
    const yaw = +(this.params.get('yaw') ?? 0) * Math.PI / 180;
    const hgt = +(this.params.get('h') ?? 30);
    const dist = +(this.params.get('d') ?? z.r * 1.3);
    this.focus.set(z.cx, sa.field.heightAt(z.cx, z.cz), z.cz);
    this.camera.position.set(z.cx - Math.sin(yaw) * dist, this.focus.y + hgt, z.cz - Math.cos(yaw) * dist);
    this.camera.lookAt(this.focus);
    this.terrain.buildAll(this.camera.position);
    const t2 = performance.now();
    if (water(sa.waterLevel)) {
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(sa.size, sa.size), new THREE.MeshStandardMaterial({ color: 0x2f8fa0, transparent: true, opacity: 0.8, roughness: 0.2 }));
      wm.rotation.x = -Math.PI / 2;
      wm.position.set(sa.size / 2, sa.waterLevel, sa.size / 2);
      this.scene.add(wm);
    }
    console.log(`gen ${(t1 - t0).toFixed(0)}ms mesh ${(t2 - t1).toFixed(0)}ms chunks ${this.terrain.built} zones ${sa.zones.map((z) => z.name + '@' + z.cx.toFixed(0) + ',' + z.cz.toFixed(0)).join(' | ')}`);
    (window as any).__ready = true;
    (window as any).__sa = sa;
  }
  update(dt: number) {
    this.env.update(this.camera.position, dt, this.engine.realTime);
  }
}
function water(l: number) { return l > -100; }
