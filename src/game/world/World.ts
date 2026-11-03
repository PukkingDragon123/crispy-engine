// World runtime for one sub-area: terrain + atmosphere + storm + water + colliders
// + props, and the zone-progression transformations (walls collapse, temples rise).
import * as THREE from 'three';
import { generateSubArea, SubArea, ZoneDef } from './RegionGen';
import { Terrain } from './Terrain';
import { Env, PRESETS } from './Env';
import { Storm } from './Storm';
import { Colliders } from './Colliders';
import { MAT } from './Heightfield';
import type { SurfaceInfo } from '../player/Board';
import { globalUniforms } from '../../engine/render/VoxelMaterial';
import { SandWaves } from './SandWaves';

const waterVert = /* glsl */ `
varying vec3 vW; varying float vFog;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`;
const waterFrag = /* glsl */ `
uniform float uTime; uniform vec3 uDeep, uShallow, uSky, fogColor; uniform float fogNear, fogFar;
uniform sampler2D uHeight; uniform vec2 uSize; uniform float uLevel;
varying vec3 vW; varying float vFog;
float h12(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  vec2 px = floor(vW.xz * 4.0) / 4.0;
  float w1 = sin(px.x * 0.7 + uTime * 1.3) * cos(px.y * 0.6 - uTime * 1.1);
  float w2 = sin(px.x * 1.9 - px.y * 1.3 + uTime * 2.1);
  float g = texture2D(uHeight, vW.xz / uSize).r;
  float depth = clamp(uLevel - g, 0.0, 4.0) / 4.0;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth));
  col += (w1 * 0.04 + w2 * 0.03);
  float glint = step(0.985, h12(px + floor(uTime * 3.0))) * 0.6;
  float foam = smoothstep(0.12, 0.0, depth) * (0.6 + 0.4 * step(0.5, fract(w2 * 2.0)));
  col = mix(col, vec3(0.95, 0.97, 0.92), foam);
  col += glint;
  col = mix(col, uSky, 0.18);
  float f = smoothstep(fogNear, fogFar, vFog);
  gl_FragColor = vec4(mix(col, fogColor, f), mix(0.86, 0.6, foam));
  #include <colorspace_fragment>
}`;

export class World {
  sa: SubArea;
  terrain: Terrain;
  env: Env;
  storm: Storm;
  colliders = new Colliders();
  group = new THREE.Group();
  water: THREE.Mesh | null = null;
  activeZone = 0;
  unlockedZone = 0;
  props: { update(dt: number, focus: THREE.Vector3): void; riseFor(stampId: string, k: number): void; group: THREE.Group } | null = null;
  /** living sand: travelling dune waves, rings, swells (rendered + felt by every ground query) */
  sand = new SandWaves();
  private _g = { x: 0, z: 0 };

  constructor(public scene: THREE.Scene, key: 'A' | 'B' | 'C', seed: number) {
    this.sa = generateSubArea(key, seed);
    this.env = new Env(scene, this.sa.env, seed);
    this.terrain = new Terrain(this.sa.field, this.sa.wind, this.sand);
    this.sand.ground = (x, z) => this.sa.field.heightSmooth(x, z);
    this.group.add(this.terrain.group);
    this.storm = new Storm((x, z) => this.sa.field.heightAt(x, z));
    this.group.add(this.storm.group);
    scene.add(this.group);
    if (this.sa.waterLevel > -100) this.makeWater();
    // storm: zone 0 open, every other zone + corridor closed
    for (const z of this.sa.zones) {
      this.storm.addDisc('zone' + z.index, z.cx, z.cz, z.r, z.index === 0);
      if (z.corridor) this.storm.addCapsule('corr' + z.index, z.corridor.ax, z.corridor.az, z.corridor.bx, z.corridor.bz, z.corridor.w, false);
    }
  }

  get field() {
    return this.sa.field;
  }
  get zone(): ZoneDef {
    return this.sa.zones[this.activeZone];
  }

  private makeWater() {
    const f = this.sa.field;
    // height texture for depth tint
    const N = 256;
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) data[i + j * N] = f.heightAt((i / (N - 1)) * f.size, (j / (N - 1)) * f.size);
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const env = PRESETS[this.sa.env];
    const mat = new THREE.ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      transparent: true,
      uniforms: {
        uTime: globalUniforms.uTime,
        uDeep: { value: new THREE.Color(0x1b6f86) },
        uShallow: { value: new THREE.Color(0x5fd0c8) },
        uSky: { value: new THREE.Color(env.zenith) },
        fogColor: { value: new THREE.Color(env.fog) },
        fogNear: { value: env.fogNear },
        fogFar: { value: env.fogFar },
        uHeight: { value: tex },
        uSize: { value: new THREE.Vector2(f.size, f.size) },
        uLevel: { value: this.sa.waterLevel },
      },
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(f.size, f.size), mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(f.size / 2, this.sa.waterLevel, f.size / 2);
    this.water.renderOrder = 3;
    this.group.add(this.water);
  }

  /** board surface query: height includes water, friction by material */
  surface = (x: number, z: number, out: SurfaceInfo): SurfaceInfo => {
    const f = this.sa.field;
    // the board rides the living sand too (dune waves, rings, the vortex)
    const h = f.heightSmooth(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0);
    const wl = this.sa.waterLevel;
    if (h < wl - 0.05) {
      out.h = wl;
      out.drag = 0.035;
      out.speedMul = 0.8;
      out.kind = 'water';
      return out;
    }
    out.h = h;
    const m = f.matAt(x, z);
    switch (m) {
      case MAT.TILE:
      case MAT.ROCK:
      case MAT.DARK_ROCK:
        out.drag = 0.0;
        out.speedMul = 1.12;
        out.kind = 'hard';
        break;
      case MAT.DIRT:
        out.drag = 0.004;
        out.speedMul = 1.06;
        out.kind = 'hard';
        break;
      case MAT.SAND_DARK:
        out.drag = 0.004;
        out.speedMul = 1.05;
        out.kind = 'sand';
        break;
      case MAT.MUD:
        out.drag = 0.03;
        out.speedMul = 0.8;
        out.kind = 'mud';
        break;
      case MAT.GRASS:
        out.drag = 0.012;
        out.speedMul = 0.95;
        out.kind = 'grass';
        break;
      default:
        out.drag = 0.008;
        out.speedMul = 1;
        out.kind = 'sand';
    }
    return out;
  };

  groundAt = (x: number, z: number) => Math.max(this.sa.field.heightAt(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0), this.sa.waterLevel);
  groundSmooth = (x: number, z: number) => Math.max(this.sa.field.heightSmooth(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0), this.sa.waterLevel);
  normal = (x: number, z: number, out: THREE.Vector3) => {
    if (this.sa.field.heightSmooth(x, z) < this.sa.waterLevel) return out.set(0, 1, 0);
    this.sa.field.normalAt(x, z, out);
    if (this.sand.n) {
      // tilt by the living-sand gradient: n = normalize(-(hx+gx), 1, -(hz+gz))
      const g = this.sand.grad(x, z, this._g);
      if (g.x !== 0 || g.z !== 0) {
        const hx = -out.x / out.y + g.x,
          hz = -out.z / out.y + g.z;
        out.set(-hx, 1, -hz).normalize();
      }
    }
    return out;
  };
  slope = (x: number, z: number) => {
    const s = this.sa.field.slopeAt(x, z);
    if (!this.sand.n) return s;
    const g = this.sand.grad(x, z, this._g);
    return g.x === 0 && g.z === 0 ? s : Math.hypot(s, Math.hypot(g.x, g.z));
  };

  /** sand physics: explosions dig craters & throw a rim; permanent for the run */
  deform(x: number, z: number, radius: number, depth: number) {
    const f = this.sa.field;
    const r = f.res;
    const i0 = Math.max(1, Math.floor((x - radius * 1.6) / r)), i1 = Math.min(f.n - 2, Math.ceil((x + radius * 1.6) / r));
    const j0 = Math.max(1, Math.floor((z - radius * 1.6) / r)), j1 = Math.min(f.n - 2, Math.ceil((z + radius * 1.6) / r));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * r - x, j * r - z) / radius;
        if (d > 1.6) continue;
        const k = i + j * f.n;
        const m = f.baseMat[k];
        const soft = m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.TILE ? 0.15 : 1;
        const bowl = d < 1 ? -depth * (1 - d * d) : 0;
        const rim = Math.exp(-((d - 1.1) ** 2) / 0.05) * depth * 0.35;
        f.base[k] += (bowl + rim) * soft;
      }
    f.recompute(x - radius * 1.7, z - radius * 1.7, x + radius * 1.7, z + radius * 1.7);
  }

  /** open the next zone: returns the sequence parameters for the cinematic */
  unlockNext() {
    const next = this.unlockedZone + 1;
    if (next >= this.sa.zones.length) return null;
    this.unlockedZone = next;
    return this.sa.zones[next];
  }

  /** animate blocker collapse / plinth rise; k: 0..1 */
  setTransform(zone: ZoneDef, k: number) {
    if (zone.blockerStamp) this.sa.field.setStampWeight(zone.blockerStamp, 1 - k);
    if (zone.riseStamp) {
      this.sa.field.setStampWeight(zone.riseStamp, k);
      this.props?.riseFor(zone.riseStamp, k);
    }
  }

  openStormFor(zone: ZoneDef) {
    this.storm.setTarget('zone' + zone.index, zone.r, 16);
    this.storm.setTarget('corr' + zone.index, zone.corridor?.w ?? 26, 8);
  }
  /** after the player moves into the new zone, swallow the old one */
  closeBehind(prevIndex: number) {
    this.storm.setTarget('zone' + prevIndex, 0, 5);
    this.storm.setTarget('corr' + (prevIndex + 1), 0, 4);
    const prevCorr = 'corr' + prevIndex;
    this.storm.setTarget(prevCorr, 0, 4);
  }

  update(dt: number, focus: THREE.Vector3, time: number, fx: any) {
    this.sand.update(dt);
    this.terrain.update(focus, 4);
    this.env.update(focus, dt, time);
    this.storm.update(dt, fx);
    this.props?.update(dt, focus);
  }

  dispose() {
    this.terrain.dispose();
    this.group.removeFromParent();
    this.env.sky.removeFromParent();
    this.env.sun.removeFromParent();
    this.env.hemi.removeFromParent();
    this.env.clouds.removeFromParent();
  }
}
