// World runtime for one sub-area: terrain + atmosphere + storm + water + colliders
// + props, and the zone-progression transformations (walls collapse, temples rise).
import * as THREE from 'three';
import { generateSubArea, SubArea, ZoneDef, findOpenSpot, type OpenSpotOpts, type Anchor } from './RegionGen';
import { Terrain, Backdrop } from './Terrain';
import { Env, PRESETS, AirSand, type EnvPreset } from './Env';
import { Storm } from './Storm';
import { Colliders } from './Colliders';
import { MAT } from './Heightfield';
import type { SurfaceInfo } from '../player/Board';
import { globalUniforms, atmoFogUniforms, ATMO } from '../../engine/render/VoxelMaterial';
import { smoothstep, lerp, clamp } from '../../engine/math/rand';
import { SandWaves } from './SandWaves';
import type { StageId } from '../meta/Stage';
import { generateNileArea } from './NileGen';
import { NileWater, FlatWater, NILE_LOOKS, type WaterSurface, type WaterSample } from './NileWater';
import { BURN, resetBurn } from './NileBurn';

const waterVert = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const waterFrag = /* glsl */ `
uniform float uTime; uniform vec3 uDeep, uShallow, uSky;
uniform sampler2D uHeight; uniform vec2 uSize; uniform float uLevel;
varying vec3 vW;
#include <fog_pars_fragment>
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
  // pixel shoreline: a crisp, ragged two-band foam rim at the terrain's 16 texels / m
  float fn = h12(floor(vW.xz * 16.0));
  float foam = depth < 0.012 + fn * 0.014 ? 1.0 : (depth < 0.03 + fn * 0.014 && fract(w2 * 2.0) > 0.5 ? 0.55 : 0.0);
  col = mix(col, vec3(0.95, 0.97, 0.92), foam);
  col += glint;
  // grazing views mirror the sky
  float fr = pow(1.0 - clamp(normalize(cameraPosition - vW).y, 0.0, 1.0), 4.0);
  col = mix(col, uSky, 0.12 + 0.5 * fr);
  gl_FragColor = vec4(col, mix(0.86, 0.6, foam));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

export class World {
  sa: SubArea;
  terrain: Terrain;
  env: Env;
  storm: Storm;
  colliders = new Colliders();
  group = new THREE.Group();
  /**
   * The water of this sub-area: the Nile river (flowing, swells, wakes, lava after Ra's
   * fire) or a still pool. Ask it for the surface: water.heightAt(x, z), flowAt(x, z),
   * depthAt, isWater, lavaAt, moltenAt, sample(x, z, out); boats call wake() every frame
   * and impacts call splash(). null where there is none.
   */
  water: WaterSurface | null = null;
  /** the stage this world belongs to */
  stage: StageId;
  /** the Nile's own river mesh + runtime (null elsewhere) */
  river: NileWater | null = null;
  private waterMesh: THREE.Mesh | null = null;
  /** optional event bus (RunScene binds ctx.events): 'nileBurn' (k), 'nileBurned' */
  events: { emit(ev: string, ...a: any[]): void } | null = null;
  /** listeners for the burn's progress (0..1) */
  onBurn: ((k: number) => void)[] = [];
  private burnState = { k: 0, ox: 0, oz: 0, maxR: 1 };
  private burnAnim: { t: number; dur: number; resolve: () => void; ox: number; oz: number } | null = null;
  private basePreset: EnvPreset | null = null;
  private _ws: WaterSample = { h: 0, depth: 0, fx: 0, fz: 0, gx: 0, gz: 0, lava: 0, molten: false, amp: 0 };
  activeZone = 0;
  unlockedZone = 0;
  props: { update(dt: number, focus: THREE.Vector3): void; riseFor(stampId: string, k: number): void; group: THREE.Group } | null = null;
  /** living sand: travelling dune waves, rings, swells (rendered + felt by every ground query) */
  sand = new SandWaves();
  /** the land past the play area (and a far-field proxy of the map) */
  backdrop: Backdrop;
  /** airborne pixel sand around the camera */
  air: AirSand;
  private _g = { x: 0, z: 0 };
  private hazeT = 0;
  /**
   * The storm parting for a newly unlocked zone (runs on real time, so a cinematic's
   * slow-mo never stalls it): t in seconds since the unlock, DUR long. ZoneCine frames it.
   */
  parting: { zone: ZoneDef; prev: number; t: number; dur: number; strikes: number } | null = null;
  /** blocker collapse / plinth rise progress per zone (only ever moves forward) */
  private transformK = new Map<number, number>();
  /** storm closing behind the hunter: corridor retreats queued after the old zone is swallowed */
  private closing: { id: string; at: number; speed: number }[] = [];
  private lastTime = -1;
  private murkOn = false;
  private _murk = new THREE.Color();

  constructor(public scene: THREE.Scene, key: 'A' | 'B' | 'C', seed: number, stage: StageId = 'desert') {
    const t0 = performance.now();
    this.stage = stage;
    this.sa = stage === 'nile' ? generateNileArea(key, seed) : generateSubArea(key, seed);
    resetBurn();
    const t1 = performance.now();
    this.env = new Env(scene, this.sa.env, seed);
    this.terrain = new Terrain(this.sa.field, this.sa.wind, this.sand);
    this.sand.ground = (x, z) => this.sa.field.heightSmooth(x, z);
    this.group.add(this.terrain.group);
    this.env.setWind(this.sa.wind.x, this.sa.wind.z);
    this.backdrop = new Backdrop(this.sa.field, this.sa.wind, seed);
    this.group.add(this.backdrop.mesh);
    this.air = new AirSand(this.terrain.hf, this.sa.wind);
    this.env.air = this.air;
    this.env.apply(this.env.preset);
    this.group.add(this.air.points);
    this.storm = new Storm((x, z) => this.sa.field.heightAt(x, z));
    this.storm.wind = { x: this.sa.wind.x, z: this.sa.wind.z };
    this.group.add(this.storm.group);
    scene.add(this.group);
    if (this.sa.nile) this.makeRiver();
    else if (this.sa.waterLevel > -100) this.makeWater();
    console.log(`[world] ${key}: ${this.sa.size} m square, ${this.sa.zones.length} zones (r ${this.sa.zones.map((z) => z.r).join('/')}), ${this.sa.zones.reduce((n, z) => n + z.pois.length, 0)} sights; generate ${(t1 - t0).toFixed(0)} ms, terrain+storm ${(performance.now() - t1).toFixed(0)} ms`);
    // storm: zone 0 open, every other zone + corridor closed
    for (const z of this.sa.zones) {
      this.storm.addDisc('zone' + z.index, z.cx, z.cz, z.r, z.index === 0);
      if (z.corridor) this.storm.addCapsule('corr' + z.index, z.corridor.ax, z.corridor.az, z.corridor.bx, z.corridor.bz, z.corridor.w, false);
    }
  }

  get field() {
    return this.sa.field;
  }
  /** the Nile stage's river network, zone themes and gate arena (null on the desert) */
  get nile() {
    return this.sa.nile ?? null;
  }

  private makeRiver() {
    const nile = this.sa.nile!;
    this.basePreset = { ...PRESETS[this.sa.env] };
    this.river = new NileWater(this.sa.field, nile.river, NILE_LOOKS[this.sa.env] ?? NILE_LOOKS.nileDay);
    this.water = this.river;
    this.group.add(this.river.group);
    const S = this.sa.size;
    this.burnState.ox = nile.arena?.x ?? S / 2;
    this.burnState.oz = nile.arena?.z ?? S / 2;
    // region C: Ra has already burned the valley
    if (nile.burned) this.burnToLava(1);
  }

  /**
   * Ra burns the desert and the river: the fire front sweeps out from `origin` (default:
   * the gate boss's court) across the whole valley; k = 0..1 progress. The ground chars,
   * glowing cracks open, plants shrivel, the sky turns to fire and the river becomes
   * flowing lava (cooled crust plates ride on it; deep molten lava burns). Never runs
   * backwards. Emits 'nileBurn' (k) on the bound event bus and to onBurn listeners,
   * 'nileBurned' once complete. Region C starts with k = 1.
   */
  burnToLava(k: number, origin?: { x: number; z: number }) {
    if (!this.sa.nile) return;
    const b = this.burnState;
    if (origin && b.k <= 0) {
      b.ox = origin.x;
      b.oz = origin.z;
    }
    k = clamp(Math.max(k, b.k), 0, 1);
    const S = this.sa.size;
    b.maxR = Math.max(Math.hypot(b.ox, b.oz), Math.hypot(S - b.ox, b.oz), Math.hypot(b.ox, S - b.oz), Math.hypot(S - b.ox, S - b.oz)) + 60;
    const was = b.k;
    b.k = k;
    BURN.value.set(b.ox, b.oz, k >= 1 ? 1e5 : 10 + k * b.maxR, Math.min(1, k * 6));
    // the sky catches fire with the land
    const base = this.basePreset ?? PRESETS[this.sa.env];
    if (this.sa.env !== 'nileBurn') this.env.lerpPreset(base, PRESETS.nileBurn, smoothstep(0.0, 0.55, k));
    const air = this.air.points.material as THREE.ShaderMaterial;
    const pal = air.uniforms.uPal.value as THREE.Color[];
    const ASH = [0x6a605a, 0x4a423e, 0x8a7e76, 0xff9a4a];
    const SAND = [0xf2d49c, 0xe2b97a, 0xd2a564, 0xfbe8bc];
    pal.forEach((c, i) => c.setHex(SAND[i]).lerp(new THREE.Color(ASH[i]), smoothstep(0.1, 0.6, k)));
    if (k !== was) {
      for (const f of this.onBurn) f(k);
      this.events?.emit('nileBurn', k);
      if (k >= 1 && was < 1) this.events?.emit('nileBurned');
    }
  }
  /** the burn's progress (0 untouched .. 1 the whole valley is fire) */
  get burnK() {
    return this.burnState.k;
  }
  /** play the whole burn by itself over `dur` s of real time (cinematics can await it) */
  igniteNile(opts: { origin?: { x: number; z: number }; dur?: number } = {}): Promise<void> {
    if (!this.sa.nile || this.burnState.k >= 1) return Promise.resolve();
    const o = opts.origin ?? { x: this.burnState.ox, z: this.burnState.oz };
    return new Promise((resolve) => {
      this.burnAnim?.resolve();
      this.burnAnim = { t: 0, dur: opts.dur ?? 9, resolve, ox: o.x, oz: o.z };
      this.burnToLava(Math.max(this.burnState.k, 0.001), o);
    });
  }
  /** the run is over: the fire goes out (the menu and hub terrain read the same burn uniform) */
  stopBurn() {
    this.burnAnim?.resolve();
    this.burnAnim = null;
    resetBurn();
  }
  /** heat on a body at (x, y, z): 1 in contact with molten lava, else 0 (crust and banks are safe) */
  heatAt(x: number, y: number, z: number) {
    const w = this.river;
    if (!w || this.burnState.k <= 0) return 0;
    const s = w.sample(x, z, this._ws);
    return s.molten && y < s.h + 0.35 ? 1 : 0;
  }
  get zone(): ZoneDef {
    return this.sa.zones[this.activeZone];
  }

  private makeWater() {
    this.water = new FlatWater(this.sa.waterLevel, (x, z) => this.sa.field.heightSmooth(x, z));
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
      fog: true,
      uniforms: {
        ...atmoFogUniforms(),
        uTime: globalUniforms.uTime,
        uDeep: { value: new THREE.Color(0x1b6f86) },
        uShallow: { value: new THREE.Color(0x5fd0c8) },
        uSky: { value: new THREE.Color(env.zenith).lerp(new THREE.Color(env.fog), 0.45) },
        uHeight: { value: tex },
        uSize: { value: new THREE.Vector2(f.size, f.size) },
        uLevel: { value: this.sa.waterLevel },
      },
    });
    const wm = (this.waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(f.size, f.size), mat));
    (this.water as FlatWater).material = mat;
    wm.rotation.x = -Math.PI / 2;
    wm.position.set(f.size / 2, this.sa.waterLevel, f.size / 2);
    wm.renderOrder = 3;
    this.group.add(wm);
  }

  /** board surface query: height includes water, friction by material */
  surface = (x: number, z: number, out: SurfaceInfo): SurfaceInfo => {
    const f = this.sa.field;
    // the board rides the living sand too (dune waves, rings, the vortex)
    const h = f.heightSmooth(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0);
    const wl = this.sa.waterLevel;
    out.flowX = 0;
    out.flowZ = 0;
    out.roll = 0;
    out.lava = false;
    if (this.river) {
      // the Nile: ride the swells, the current carries the board; lava rides the same
      if (h < wl + 1.2) {
        const s = this.river.sample(x, z, this._ws);
        if (s.h > h + 0.01) {
          out.h = s.h;
          // shallows over a sandbar drag at the board; open water runs fast
          const shallow = s.depth < 0.4 ? 1 - s.depth / 0.4 : 0;
          out.drag = (s.lava > 0.5 ? 0.02 : 0.01) + shallow * 0.03;
          out.speedMul = (s.lava > 0.5 ? 1.04 : 1.14) - shallow * 0.12;
          out.kind = 'water';
          out.flowX = s.fx;
          out.flowZ = s.fz;
          out.roll = (s.lava > 0.5 ? 0.8 : 0.55) + shallow * 0.6;
          out.lava = s.lava > 0.5;
          return out;
        }
      }
    } else if (h < wl - 0.05) {
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
    if (this.sa.field.heightSmooth(x, z) < this.sa.waterLevel + 0.9) {
      if (this.river) {
        const s = this.river.sample(x, z, this._ws);
        if (s.h > this.sa.field.heightSmooth(x, z) + 0.01) return out.set(-s.gx, 1, -s.gz).normalize();
      } else if (this.sa.field.heightSmooth(x, z) < this.sa.waterLevel) return out.set(0, 1, 0);
    }
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

  /** animate blocker collapse / plinth rise; k: 0..1 (never runs backwards: several drivers may push it) */
  setTransform(zone: ZoneDef, k: number) {
    k = Math.max(k, this.transformK.get(zone.index) ?? 0);
    this.transformK.set(zone.index, k);
    if (zone.blockerStamp) this.sa.field.setStampWeight(zone.blockerStamp, 1 - k);
    if (zone.riseStamp) {
      this.sa.field.setStampWeight(zone.riseStamp, k);
      this.props?.riseFor(zone.riseStamp, k);
    }
  }

  /**
   * Unlock: the storm parts. The corridor tears open from the mouth of the zone the hunter
   * is in and drives through the storm like a blade (lightning at its head), then the new
   * zone's storm bursts outward. ~6.4 s of real time; see the parting timeline in update().
   */
  openStormFor(zone: ZoneDef) {
    const prev = Math.max(0, zone.index - 1);
    this.parting = { zone, prev, t: 0, dur: 6.4, strikes: 0 };
    this.storm.drive('corr' + zone.index, { w: 0, s0: 0, s1: 0 });
    this.storm.drive('zone' + zone.index, { r: 0 });
  }
  private stepParting(rdt: number, fx: any) {
    const P = this.parting!;
    const z = P.zone;
    P.t += rdt;
    const t = P.t;
    const e = (a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
    const ease = (k: number) => k * k * (3 - 2 * k);
    const W = z.corridor?.w ?? 34;
    this.storm.drive('corr' + z.index, { w: W * ease(e(0.25, 1.3)), s0: 0, s1: ease(e(0.45, 3.9)) });
    this.storm.drive('zone' + z.index, { r: z.r * (1 - Math.pow(1 - e(3.1, 6.2), 3)) });
    this.setTransform(z, ease(e(0.6, 4.4)));
    // lightning splits the storm open: at the mouth, then riding the head of the canyon
    const c = z.corridor;
    if (c) {
      const beats = [0.05, 1.15, 2.2, 3.15, 3.9];
      while (P.strikes < beats.length && t >= beats[P.strikes]) {
        const k = ease(e(0.45, 3.9));
        const hx = c.ax + (c.bx - c.ax) * k, hz = c.az + (c.bz - c.az) * k;
        const side = P.strikes % 2 ? 1 : -1;
        const nx = -(c.bz - c.az), nz = c.bx - c.ax, nl = Math.hypot(nx, nz) || 1;
        const off = W * 0.5 + 14;
        this.storm.strike({ x: hx + (nx / nl) * off * side, z: hz + (nz / nl) * off * side }, 12, P.strikes === 0 ? 1.5 : 1.15);
        P.strikes++;
      }
      // the canyon walls boil with thrown sand as they tear apart
      if (fx && t < 4.2) {
        const k = ease(e(0.45, 3.9));
        const hx = c.ax + (c.bx - c.ax) * k, hz = c.az + (c.bz - c.az) * k;
        const nx = -(c.bz - c.az), nz = c.bx - c.ax, nl = Math.hypot(nx, nz) || 1;
        for (const sd of [-1, 1]) {
          const px = hx + (nx / nl) * sd * (W * 0.5 + 3), pz = hz + (nz / nl) * sd * (W * 0.5 + 3);
          const y = this.groundAt(px, pz);
          fx.p.emit({ pos: { x: px, y: y + 2 + Math.random() * 10, z: pz }, count: 2, vel: { x: (nx / nl) * sd * 6, y: 5, z: (nz / nl) * sd * 6 }, spread: 4, jitter: 4, life: [1.2, 2.2], size: [3, 7], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0xd09a5e, 0xb87a46, 0xe6bc86], alpha: 0.7, drag: 0.8, rot: 6, rotSpeed: 0.8 });
          fx.p.emit({ pos: { x: px, y: y + 1, z: pz }, count: 6, vel: { x: (nx / nl) * sd * 9, y: 4, z: (nz / nl) * sd * 9 }, spread: 3, jitter: 2, gravity: 6, drag: 0.4, life: [0.6, 1.3], size: [0.08, 0.16], sprite: ['dot3'], color: [0xf0d29a, 0xe3bd80, 0xd6a968], ground: true });
        }
      }
    }
    if (t >= P.dur) {
      this.storm.drive('corr' + z.index, { w: W, s0: 0, s1: 1 });
      this.storm.drive('zone' + z.index, { r: z.r });
      this.setTransform(z, 1);
      this.parting = null;
    }
  }

  /**
   * After the hunter has moved on, the storm swallows the old zone: it closes in on the
   * exit (the disc shrinks while sliding toward the corridor it left by, ~45 s), then the
   * corridor itself is eaten from the old end toward the new zone (~20 s). The way back in
   * closes quickly.
   */
  closeBehind(prevIndex: number) {
    const old = this.sa.zones[prevIndex];
    const exit = this.sa.zones[prevIndex + 1]?.corridor;
    this.storm.setTarget('corr' + prevIndex, 0, 4);
    if (!old) return;
    const T = 45;
    this.storm.setTarget('zone' + prevIndex, 0, old.r / T);
    if (exit) {
      this.storm.moveDisc('zone' + prevIndex, exit.ax, exit.az, Math.hypot(exit.ax - old.cx, exit.az - old.cz) / T);
      this.closing.push({ id: 'corr' + (prevIndex + 1), at: T + 2, speed: 1 / 20 });
    } else this.storm.setTarget('corr' + (prevIndex + 1), 0, 4);
  }

  /** route the storm's own sound (howl, thunder) through the engine's audio */
  bindAudio(audio: any) {
    this.storm.bindAudio(audio);
  }

  /**
   * Open-spot query for other systems (treasure, wildlife, camps, set-ups): a level patch of
   * radius `radius` inside the zone, clear of every structure / sight / reserved spot / small
   * prop, off the corridor mouths and out of water, and (at runtime) clear of colliders.
   * Returns null when none is found. Claim it with claimSpot so later queries avoid it.
   */
  findOpenSpot(zone: number | ZoneDef, radius: number, opts: OpenSpotOpts = {}): { x: number; y: number; z: number } | null {
    const z = typeof zone === 'number' ? this.sa.zones[zone] : zone;
    if (!z) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = findOpenSpot(z, this.sa.field, radius, opts);
      if (!p) return null;
      let hit = false;
      this.colliders.query(p.x, p.z, radius + 3, (c) => {
        if (c.enabled && c.solid && Math.hypot(c.x - p.x, c.z - p.z) < c.r + radius) hit = true;
      });
      if (!hit) return { x: p.x, y: this.groundAt(p.x, p.z), z: p.z };
    }
    return null;
  }
  /** reserve a spot (radius r) in a zone so findOpenSpot and later placement keep off it */
  claimSpot(zone: number | ZoneDef, x: number, z: number, r: number, owner = 'claim', data?: any): Anchor {
    const zn = typeof zone === 'number' ? this.sa.zones[zone] : zone;
    const a: Anchor = { kind: 'claim', x, z, data: { r, owner, ...(data ?? {}) } };
    zn.anchors.push(a);
    return a;
  }
  /** anchors of a kind in a zone (e.g. 'digSpot', 'wildlifeSpot', 'cavePit', 'bossArena', 'viewpoint') */
  spots(zone: number | ZoneDef, kind: string): Anchor[] {
    const zn = typeof zone === 'number' ? this.sa.zones[zone] : zone;
    return zn ? zn.anchors.filter((a) => a.kind === kind) : [];
  }

  /**
   * Visibility collapses into orange murk near and inside the storm: the fog closes in,
   * its colour (and the sky's haze, which shares it) swings to dust-orange and the low
   * dust layer thickens. Written on top of the current Env preset, restored when clear.
   */
  private applyMurk() {
    const sd = this.storm.focusSdf;
    const m = smoothstep(26, -16, sd) * (0.6 + 0.4 * this.storm.strength);
    const env = this.env;
    const p = env.preset;
    const day = p.stars < 0.5;
    const dust = day ? (p.sunElev < 18 ? 0.65 : 0.5) : 0.22;
    if (m < 0.002) {
      if (this.murkOn) {
        env.fog.near = p.fogNear;
        env.fog.far = p.fogFar;
        env.fog.color.setHex(p.fog);
        const hz = this._murk.setHex(p.horizon);
        ATMO.u[4] = hz.r;
        ATMO.u[5] = hz.g;
        ATMO.u[6] = hz.b;
        ATMO.u[10] = 3.2;
        ATMO.u[11] = dust;
        this.murkOn = false;
      }
      return;
    }
    this.murkOn = true;
    env.fog.near = lerp(p.fogNear, 2, m);
    env.fog.far = lerp(p.fogFar, 36, Math.pow(m, 0.8));
    env.fog.color.setHex(p.fog).lerp(this._murk.setHex(0xb8703a), m);
    const hz = this._murk.setHex(p.horizon).lerp(new THREE.Color(0xd8904a), m);
    ATMO.u[4] = hz.r;
    ATMO.u[5] = hz.g;
    ATMO.u[6] = hz.b;
    ATMO.u[10] = lerp(3.2, 40, m);
    ATMO.u[11] = lerp(dust, 3.4, m);
  }

  update(dt: number, focus: THREE.Vector3, time: number, fx: any) {
    this.sand.update(dt);
    this.terrain.update(focus, 4);
    // the haze / dust floor rests on the regional ground level around the hunter
    this.hazeT -= dt;
    if (this.hazeT <= 0) {
      this.hazeT = 0.5;
      const f = this.sa.field;
      let s = 0;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        s += f.heightAt(focus.x + Math.cos(a) * 45, focus.z + Math.sin(a) * 45);
      }
      this.env.setHazeFloor(Math.max(this.sa.waterLevel, s / 9 - 3));
    }
    this.env.update(focus, dt, time);
    const st = this.env.sun.target.position;
    this.terrain.setShadowCenter(st.x, st.z, this.env.shadowExtent);
    // the storm runs its parting on real time (cinematics slow the game clock right down)
    const rdt = this.lastTime < 0 ? 0 : clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    if (this.parting) this.stepParting(rdt, fx);
    for (let i = this.closing.length - 1; i >= 0; i--) {
      const c = this.closing[i];
      c.at -= dt;
      if (c.at <= 0) {
        this.storm.setSpan(c.id, 1, 1, c.speed);
        this.closing.splice(i, 1);
      }
    }
    this.storm.update(dt, fx, focus);
    this.applyMurk();
    this.props?.update(dt, focus);
    if (this.river) {
      const ba = this.burnAnim;
      if (ba) {
        ba.t += rdt;
        const k = clamp(ba.t / ba.dur, 0, 1);
        this.burnToLava(k * k * (3 - 2 * k), { x: ba.ox, z: ba.oz });
        if (k >= 1) {
          this.burnAnim = null;
          ba.resolve();
        }
      }
      this.river.update(dt, time, focus, fx);
      if (fx && this.burnState.k > 0 && this.burnState.k < 1) this.fireFront(fx, focus);
    }
  }

  /** flames and smoke along the advancing fire front near the hunter */
  private fireFront(fx: any, focus: THREE.Vector3) {
    const b = BURN.value;
    const d = Math.hypot(focus.x - b.x, focus.z - b.y);
    if (Math.abs(d - b.z) > 90) return;
    const a0 = Math.atan2(focus.z - b.y, focus.x - b.x);
    for (let i = 0; i < 4; i++) {
      const a = a0 + (Math.random() - 0.5) * (120 / Math.max(40, b.z));
      const r = b.z - 6 + (Math.random() - 0.5) * 10;
      const x = b.x + Math.cos(a) * r, z = b.y + Math.sin(a) * r;
      const y = this.groundAt(x, z);
      fx.p.emit({ pos: { x, y: y + 0.2, z }, count: 2, vel: { x: 0, y: 2.5, z: 0 }, spread: 1.2, jitter: 1.2, gravity: -2, life: [0.5, 1.0], size: [1.1, 0.4], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], animate: true, additive: true, color: 0xffffff });
      if (Math.random() < 0.5) fx.p.emit({ pos: { x, y: y + 2, z }, count: 1, vel: { x: 0.5, y: 2.2, z: 0.3 }, spread: 0.8, life: [2, 3.5], size: [2, 5.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x2a201c, 0x3e302a], alpha: 0.5, drag: 0.5, rot: 6, rotSpeed: 0.3 });
    }
  }

  dispose() {
    this.burnAnim?.resolve();
    this.burnAnim = null;
    this.river?.dispose();
    resetBurn();
    this.storm.dispose();
    this.terrain.dispose();
    this.backdrop.dispose();
    this.group.removeFromParent();
    this.env.dispose();
  }
}
