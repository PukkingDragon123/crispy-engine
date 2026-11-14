// World runtime for one sub-area: terrain + atmosphere + storm + water + colliders
// + props, and the zone-progression transformations (walls collapse, temples rise).
import * as THREE from 'three';
import { generateSubArea, SubArea, ZoneDef, findOpenSpot, type OpenSpotOpts, type Anchor } from './RegionGen';
import { Terrain, Backdrop } from './Terrain';
import { Env, PRESETS, AirSand } from './Env';
import { Storm } from './Storm';
import { Colliders } from './Colliders';
import { MAT } from './Heightfield';
import type { SurfaceInfo } from '../player/Board';
import { globalUniforms, atmoFogUniforms, ATMO } from '../../engine/render/VoxelMaterial';
import { smoothstep, lerp, clamp } from '../../engine/math/rand';
import { SandWaves } from './SandWaves';

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
  water: THREE.Mesh | null = null;
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

  constructor(public scene: THREE.Scene, key: 'A' | 'B' | 'C', seed: number) {
    const t0 = performance.now();
    this.sa = generateSubArea(key, seed);
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
    if (this.sa.waterLevel > -100) this.makeWater();
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
  }

  dispose() {
    this.storm.dispose();
    this.terrain.dispose();
    this.backdrop.dispose();
    this.group.removeFromParent();
    this.env.dispose();
  }
}
