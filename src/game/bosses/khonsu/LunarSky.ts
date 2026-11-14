// Khonsu's night: when he enters, the sun sinks behind the dunes and his moon comes up
// in its place, huge and close, over a sky full of stars; the light of the fight is
// moonlight (the Env sun follows the moon, so shadows fall from it). He can pull the
// moon closer, crack it, and drown it in a blood eclipse; when he dies the moon sets
// and the day comes back. One per Khonsu fight (bosses/khonsu/LunarKit owns it).
//
// The moon is the sculpted voxel face from models/enemies/khonsuMoon, always turned to
// the camera, 700 m out along its bearing (no fog, so it reads over the haze; the
// terrain still hides it when it is low). It sits exactly where the Env draws its sun
// disk at night, so the sky's own forward scatter makes its halo.
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import type { EnvPreset } from '../../world/Env';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { khonsuMoonModels, MOON_R } from '../../models/enemies/khonsuMoon';
import { damp } from '../../../engine/math/rand';

const D = 700;
const DEG = Math.PI / 180;

let GEO: { body: THREE.BufferGeometry; cracks: THREE.BufferGeometry[]; corona: THREE.BufferGeometry } | null = null;
function moonGeo() {
  if (!GEO) {
    const m = khonsuMoonModels();
    const o = { voxelSize: 1, pivot: [0.5, 0.5, 0.5] as [number, number, number], ao: 0.55 };
    GEO = { body: buildVoxelGeometry(m.body, o), cracks: m.cracks.map((c) => buildVoxelGeometry(c, { ...o, ao: 0 })), corona: buildVoxelGeometry(m.corona, { ...o, ao: 0 }) };
  }
  return GEO;
}

const moonVert = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vP;
void main(){
  vCol = color;
  vN = normal;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const moonFrag = /* glsl */ `
uniform float uGlow, uEclipse, uR, uNear;
uniform vec2 uShadow;
uniform vec3 uTint;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vP;
void main(){
  // lit from just above and to the right of the hunter: a full moon with a soft painted terminator
  vec3 L = normalize(vec3(0.38, 0.5, 1.0));
  float l = max(dot(normalize(vN), L), 0.0);
  float ramp = mix(0.6, 1.0, smoothstep(0.32, 0.4, l)) * (0.88 + 0.12 * l);
  float limb = clamp(length(vP.xy) / uR, 0.0, 1.0);
  vec3 c = vCol * ramp * (1.0 - 0.22 * pow(limb, 5.0));
  // the blood eclipse: a shadow slides across and the face goes deep red, brightest at the rim
  float d = length(vP.xy - uShadow);
  float sh = smoothstep(uR * 1.1, uR * 0.84, d) * uEclipse;
  vec3 blood = vec3(0.62, 0.11, 0.06) * (0.3 + 0.7 * dot(vCol, vec3(0.333))) * (0.55 + 0.6 * pow(limb, 3.0));
  c = mix(c, blood, sh);
  c *= uTint * uGlow * (1.0 + uNear * 0.25);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** the sun going down behind the dunes (light warm and low, first stars) */
function sunsetOf(b: EnvPreset): EnvPreset {
  return {
    ...b,
    zenith: 0x31295a, horizon: 0xff9058, ground: 0x7a4a3a, sunColor: 0xff9a5a, sunIntensity: b.sunIntensity * 0.42, sunElev: -3,
    hemiSky: 0x8a7cb0, hemiGround: 0x8a5a3e, hemiIntensity: b.hemiIntensity * 0.9, fog: 0x8c6a80, fogNear: b.fogNear, fogFar: Math.min(b.fogFar, 420),
    exposure: 1.06, stars: 0.35, clouds: b.clouds, cloudColor: 0xff9a7a,
  };
}
/** moonlit night: cool silver key from the moon, deep blue sky, every star out (bright enough to fight in) */
function moonlitOf(b: EnvPreset, elev: number, azim: number): EnvPreset {
  return {
    zenith: 0x0b1736, horizon: 0x36507c, ground: 0x2e3348, sunColor: 0xb9cdff, sunIntensity: 2.15, sunElev: elev, sunAzim: azim,
    hemiSky: 0x5d78b4, hemiGround: 0x3c3a52, hemiIntensity: 1.1, fog: 0x203050, fogNear: Math.max(35, b.fogNear * 0.8), fogFar: Math.max(260, Math.min(b.fogFar, 340)),
    exposure: 1.12, stars: 1, clouds: Math.min(0.35, b.clouds), cloudColor: 0x6a7ca8,
  };
}
const ECLIPSE: Partial<EnvPreset> = {
  zenith: 0x060409, horizon: 0x5a1812, ground: 0x1e0e0e, sunColor: 0xff6a48, sunIntensity: 1.0,
  hemiSky: 0x6a2c3c, hemiGround: 0x2a1418, hemiIntensity: 0.85, fog: 0x1e0c10, fogFar: 240, exposure: 1.16, stars: 1, clouds: 0.1, cloudColor: 0x5a2424,
};

function lerpP(a: EnvPreset, b: EnvPreset, k: number): EnvPreset {
  const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), k).getHex();
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    zenith: c(a.zenith, b.zenith), horizon: c(a.horizon, b.horizon), ground: c(a.ground, b.ground), sunColor: c(a.sunColor, b.sunColor),
    sunIntensity: n(a.sunIntensity, b.sunIntensity), sunElev: n(a.sunElev, b.sunElev), sunAzim: n(a.sunAzim, b.sunAzim),
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    fog: c(a.fog, b.fog), fogNear: n(a.fogNear, b.fogNear), fogFar: n(a.fogFar, b.fogFar), exposure: n(a.exposure, b.exposure),
    stars: n(a.stars, b.stars), clouds: n(a.clouds, b.clouds), cloudColor: c(a.cloudColor, b.cloudColor),
  };
}

export interface LunarSkyOpts {
  /** the moon's height once risen (degrees) */
  elev?: number;
  /** angular diameter of the risen moon (degrees); pulled close it grows to about 2.4x */
  size?: number;
}

export class LunarSky {
  /** 0 day → 0.5 sunset → 1 moonlit night */
  night = 0;
  nightT = 0;
  /** the moon pulled close (0..1) */
  near = 0;
  nearT = 0;
  /** blood eclipse (0..1) */
  eclipse = 0;
  eclipseT = 0;
  /** fracture stage 0..3, and a flare that fades after each new crack */
  crack = 0;
  crackFlare = 0;
  /** bearing of the moon (unit), valid once risen */
  dir = new THREE.Vector3(0, 0.3, -1).normalize();
  group = new THREE.Group();
  private body: THREE.Mesh;
  private cracks: THREE.Mesh[] = [];
  private corona: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private crackMat: THREE.MeshBasicMaterial;
  private coronaMat: THREE.MeshBasicMaterial;
  private base: EnvPreset;
  private sunset: EnvPreset;
  private moonlit: EnvPreset;
  private applied = { n: -1, e: -1, f: -1 };
  private elev: number;
  private azim: number;
  private size: number;
  private t = 0;
  private gone = false;

  constructor(private ctx: Ctx, o: LunarSkyOpts = {}) {
    const env = ctx.world.env;
    this.base = { ...env.preset };
    this.elev = o.elev ?? 17;
    this.size = o.size ?? 9;
    // the moon comes up a little off the bearing where the sun went down
    this.azim = this.base.sunAzim + 14;
    this.sunset = sunsetOf(this.base);
    this.moonlit = moonlitOf(this.base, this.elev, this.azim);
    const g = moonGeo();
    this.u = {
      uGlow: { value: 1.55 },
      uEclipse: { value: 0 },
      uR: { value: MOON_R },
      uNear: { value: 0 },
      uShadow: { value: new THREE.Vector2(-MOON_R * 2.4, MOON_R * 0.5) },
      uTint: { value: new THREE.Color(0xfff6ea) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: moonVert, fragmentShader: moonFrag, uniforms: this.u, vertexColors: true, fog: false });
    this.body = new THREE.Mesh(g.body, mat);
    this.crackMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    for (const cg of g.cracks) {
      const m = new THREE.Mesh(cg, this.crackMat);
      m.visible = false;
      this.cracks.push(m);
      this.group.add(m);
    }
    this.coronaMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, transparent: true, depthWrite: false });
    this.corona = new THREE.Mesh(g.corona, this.coronaMat);
    this.corona.visible = false;
    this.corona.renderOrder = -5;
    this.group.add(this.body, this.corona);
    this.group.visible = false;
    this.group.traverse((o) => {
      o.frustumCulled = false;
      (o as THREE.Mesh).castShadow = false;
      (o as THREE.Mesh).receiveShadow = false;
    });
    ctx.scene.add(this.group);
  }

  /**
   * set the moon's bearing (degrees, Env azimuth) before the night falls: the sun slides
   * round to it as it sets, so the moon comes up exactly where the sun went down
   */
  aim(azimDeg: number) {
    const b = this.base.sunAzim;
    const d = ((((azimDeg - b) % 360) + 540) % 360) - 180;
    this.azim = b + d;
    this.sunset.sunAzim = this.azim;
    this.moonlit = moonlitOf(this.base, this.elev, this.azim);
    this.applied.n = -1;
  }
  /** the Env azimuth (degrees) of a ground bearing (dx, dz) */
  static azimOf(dx: number, dz: number) {
    return (Math.atan2(dz, dx) * 180) / Math.PI;
  }

  /** the moon's elevation now (degrees) for a night level */
  private elevAt(k: number) {
    return k < 0.5 ? -14 : -3 + (this.elev + 3) * (k - 0.5) * 2;
  }

  /** a point in the sky toward the moon, `dist` m from (x, y, z) (beams and shards come from there) */
  skyPoint(x: number, y: number, z: number, dist: number, out = new THREE.Vector3()) {
    return out.set(x + this.dir.x * dist, y + this.dir.y * dist, z + this.dir.z * dist);
  }
  /** the ground-plane bearing toward the moon (unit) */
  flatDir(out = new THREE.Vector3()) {
    out.set(this.dir.x, 0, this.dir.z);
    return out.lengthSq() > 1e-6 ? out.normalize() : out.set(0, 0, -1);
  }

  /** crack the moon one stage further (up to 3) */
  crackTo(stage: number) {
    const s = Math.max(this.crack, Math.min(3, Math.round(stage)));
    if (s === this.crack) return;
    this.crack = s;
    this.crackFlare = 1;
    this.cracks.forEach((m, i) => (m.visible = i === s - 1));
  }

  update(dt: number) {
    if (this.gone) return;
    this.t += dt;
    this.night = damp(this.night, this.nightT, 0.9, dt);
    if (Math.abs(this.night - this.nightT) < 0.002) this.night = this.nightT;
    this.near = damp(this.near, this.nearT, 1.6, dt);
    this.eclipse = damp(this.eclipse, this.eclipseT, 1.4, dt);
    this.crackFlare = Math.max(0, this.crackFlare - dt * 0.6);
    const k = this.night;
    // ------------------------------------------------------------------ the sky
    const fl = this.near * 0.6 + this.crackFlare * 0.4;
    if (Math.abs(k - this.applied.n) > 0.002 || Math.abs(this.eclipse - this.applied.e) > 0.003 || Math.abs(fl - this.applied.f) > 0.01) {
      this.applied.n = k;
      this.applied.e = this.eclipse;
      this.applied.f = fl;
      let p = k < 0.5 ? lerpP(this.base, this.sunset, k * 2) : lerpP(this.sunset, this.moonlit, (k - 0.5) * 2);
      if (this.eclipse > 0.002 && k > 0.5) p = lerpP(p, { ...p, ...ECLIPSE }, this.eclipse * Math.min(1, (k - 0.5) * 2));
      if (fl > 0.01 && k > 0.5) p.sunIntensity *= 1 + fl * 0.35;
      if (k <= 0.0001 && this.eclipse <= 0.002) this.ctx.world.env.apply(this.base);
      else this.ctx.world.env.apply(p);
    }
    // ------------------------------------------------------------------ the moon
    const el = this.elevAt(k) * DEG - this.near * 2.5 * DEG;
    const az = this.azim * DEG;
    this.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const vis = k > 0.45;
    this.group.visible = vis;
    if (!vis) return;
    const cam = this.ctx.camera;
    this.group.position.copy(cam.position).addScaledVector(this.dir, D);
    this.group.lookAt(cam.position);
    // pulled close it swells (and breathes a little, like something too near)
    const ang = this.size * (1 + this.near * 1.4 + Math.sin(this.t * 2.1) * 0.012 * this.near);
    const s = (2 * D * Math.tan((ang * DEG) / 2)) / (2 * MOON_R + 1);
    this.group.scale.setScalar(s);
    this.u.uEclipse.value = this.eclipse;
    this.u.uNear.value = this.near;
    // the shadow slides in from the left as the eclipse deepens
    (this.u.uShadow.value as THREE.Vector2).set(-MOON_R * 2.3 * (1 - this.eclipse), MOON_R * 0.45 * (1 - this.eclipse));
    this.u.uGlow.value = 1.55 + this.near * 0.35 + this.crackFlare * 0.4;
    // cracks pulse; the corona burns while eclipsed
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 3.2);
    this.crackMat.color.setScalar((1.6 + this.crackFlare * 2.5) * pulse * (1 - this.eclipse * 0.5));
    this.corona.visible = this.eclipse > 0.04;
    if (this.corona.visible) {
      this.coronaMat.opacity = Math.min(1, this.eclipse * 1.4);
      this.coronaMat.color.setScalar(1.5 + Math.sin(this.t * 1.7) * 0.2);
      this.corona.rotation.z += dt * 0.05;
    }
  }

  /** the moon sets and the day comes back (resolves when the sky is restored) */
  async restore(wait: (s: number) => Promise<void>) {
    this.nightT = 0;
    this.eclipseT = 0;
    this.nearT = 0;
    for (let t = 0; t < 7 && (this.night > 0.002 || this.eclipse > 0.003); t += 0.05) {
      await wait(0.05);
      this.update(0.05);
    }
    this.dispose();
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    this.ctx.world.env.apply(this.base);
    this.group.removeFromParent();
    (this.body.material as THREE.Material).dispose();
    this.crackMat.dispose();
    this.coronaMat.dispose();
  }
}
