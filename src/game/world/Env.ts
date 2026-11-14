// Atmosphere: a painted physically-inspired sky that shares its horizon haze with
// the fog (distant dunes melt into the exact sky colour of their bearing), warm low
// sun with a player-following shadow frustum, cool sky fill + warm sand bounce,
// aerial perspective / drifting ground dust (see ATMO in VoxelMaterial), drifting
// voxel clouds and airborne pixel sand.
import * as THREE from 'three';
import { RNG } from '../../engine/math/rand';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, vary } from '../../engine/voxel/VoxelModel';
import { ATMO, ATMO_HAZE_GLSL, globalUniforms } from '../../engine/render/VoxelMaterial';

export interface EnvPreset {
  zenith: number;
  /** sunward horizon haze (warm forward-scattered glow) */
  horizon: number;
  /** below-horizon / sand tint */
  ground: number;
  sunColor: number;
  sunIntensity: number;
  sunElev: number; // degrees
  sunAzim: number; // degrees
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** haze away from the sun (aerial perspective colour, particles fog to it too) */
  fog: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  stars: number;
  clouds: number; // 0..1 coverage
  cloudColor: number;
}

export const PRESETS: Record<string, EnvPreset> = {
  // warm, fairly low afternoon sun; cool lavender distance, gold toward the sun
  dunes: { zenith: 0x2860b8, horizon: 0xffdfb4, ground: 0xd2a26a, sunColor: 0xffd8a8, sunIntensity: 3.4, sunElev: 26, sunAzim: 230, hemiSky: 0x93b0e6, hemiGround: 0xd9a46a, hemiIntensity: 1.0, fog: 0xc0c7d8, fogNear: 45, fogFar: 560, exposure: 1.0, stars: 0, clouds: 0.45, cloudColor: 0xfff2e2 },
  oasis: { zenith: 0x317ccb, horizon: 0xffdaa8, ground: 0xb8955f, sunColor: 0xffd29e, sunIntensity: 3.3, sunElev: 21, sunAzim: 250, hemiSky: 0xa2c2ea, hemiGround: 0xb39a62, hemiIntensity: 1.05, fog: 0xc0d0d6, fogNear: 22, fogFar: 430, exposure: 1.02, stars: 0, clouds: 0.6, cloudColor: 0xffe8d0 },
  pyramid: { zenith: 0x47305a, horizon: 0xff9c60, ground: 0x9c5a36, sunColor: 0xffa676, sunIntensity: 2.9, sunElev: 13, sunAzim: 260, hemiSky: 0xc49eaa, hemiGround: 0x9a5434, hemiIntensity: 1.0, fog: 0xb58074, fogNear: 18, fogFar: 330, exposure: 1.05, stars: 0.15, clouds: 0.8, cloudColor: 0xe89a7a },
  menu: { zenith: 0x2f5fa8, horizon: 0xffb877, ground: 0xc98c55, sunColor: 0xffb070, sunIntensity: 3.2, sunElev: 9, sunAzim: 255, hemiSky: 0xb0c4e8, hemiGround: 0xc88850, hemiIntensity: 0.95, fog: 0xf0b884, fogNear: 40, fogFar: 260, exposure: 1.0, stars: 0.25, clouds: 0.55, cloudColor: 0xffd2b0 },
  night: { zenith: 0x0b1530, horizon: 0x2c4466, ground: 0x2a2a38, sunColor: 0x9fb8ff, sunIntensity: 1.1, sunElev: 40, sunAzim: 140, hemiSky: 0x5068a0, hemiGround: 0x302a34, hemiIntensity: 0.7, fog: 0x1c2840, fogNear: 30, fogFar: 200, exposure: 1.1, stars: 1, clouds: 0.3, cloudColor: 0x5a6a90 },
  // the Nile: a bright river day, the dusky temple city, the sky Ra set on fire
  nileDay: { zenith: 0x2a6fd0, horizon: 0xfff0d2, ground: 0xc9a46c, sunColor: 0xfff0d8, sunIntensity: 3.6, sunElev: 44, sunAzim: 215, hemiSky: 0x9cc0ee, hemiGround: 0xb8a070, hemiIntensity: 1.05, fog: 0xc6d6e2, fogNear: 50, fogFar: 560, exposure: 1.0, stars: 0, clouds: 0.5, cloudColor: 0xfffaf0 },
  nileDusk: { zenith: 0x3a3c86, horizon: 0xffa66e, ground: 0xa8784c, sunColor: 0xffb47a, sunIntensity: 3.0, sunElev: 11, sunAzim: 248, hemiSky: 0xb49cc8, hemiGround: 0xa87048, hemiIntensity: 1.0, fog: 0xc8a0a0, fogNear: 30, fogFar: 420, exposure: 1.04, stars: 0.12, clouds: 0.7, cloudColor: 0xffc2a0 },
  nileBurn: { zenith: 0x3a0e0a, horizon: 0xff6a24, ground: 0x5a2a1a, sunColor: 0xff7a3a, sunIntensity: 2.7, sunElev: 18, sunAzim: 235, hemiSky: 0xc0604a, hemiGround: 0x6a2a18, hemiIntensity: 1.0, fog: 0x8c3a26, fogNear: 22, fogFar: 330, exposure: 1.06, stars: 0, clouds: 0.92, cloudColor: 0x7a2a1e },
  underworld: { zenith: 0x02080f, horizon: 0x0d3a4a, ground: 0x061018, sunColor: 0x8ff0ff, sunIntensity: 1.6, sunElev: 60, sunAzim: 200, hemiSky: 0x3a8ab0, hemiGround: 0x101820, hemiIntensity: 0.8, fog: 0x07222e, fogNear: 20, fogFar: 140, exposure: 1.15, stars: 1, clouds: 0, cloudColor: 0x203040 },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const skyFrag = /* glsl */ `
uniform vec3 uZenith, uGround, fogColor, uSunDisk;
uniform mat4 uAtmo;
uniform float uStars, uTime, uDisk;
varying vec3 vDir;
${ATMO_HAZE_GLSL}
float h3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float mu = dot(d, uAtmo[0].xyz);
  float m = max(mu, 0.0);
  // the horizon band is the very haze distant terrain fades into
  vec3 hz = atmoHaze(d, fogColor);
  float t = clamp(y, 0.0, 1.0);
  float g = pow(smoothstep(0.0, 0.75, t), 0.55);
  // the sunward sky stays paler for longer: a bright dusty halo
  g *= 1.0 - 0.3 * pow(m, 3.0) * (1.0 - t);
  vec3 col = mix(hz, uZenith, g);
  col += hz * 0.07 * exp(-abs(y) * 36.0);
  if (y < 0.0) col = mix(hz, uGround, smoothstep(0.0, 0.35, -y) * 0.35);
  // forward scattering around the sun
  col += uSunDisk * 0.05 * (pow(m, 6.0) * 0.45 + pow(m, 48.0) * 1.1 + pow(m, 420.0) * 3.0) * uAtmo[0].w;
  // sun disk with a touch of limb darkening (bloom picks the HDR core up)
  float disk = smoothstep(0.99958, 0.99974, mu);
  col = mix(col, uSunDisk * (0.72 + 0.28 * smoothstep(0.99958, 0.99994, mu)), disk * uDisk);
  // stars (pixelated)
  if (uStars > 0.0 && y > 0.05) {
    vec3 q = floor(d * 380.0);
    float s = h3(q);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
    col += vec3(1.0, 0.95, 0.85) * step(0.9965, s) * uStars * tw * smoothstep(0.05, 0.4, y);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** airborne pixel sand: saltating grains hopping low over the dunes and fine dust hanging higher, all wind-driven */
const airVert = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam, uSunDirW, uLight;
uniform vec3 uPal[4];
uniform float uTime, uPx, uBox;
uniform vec2 uWind;
uniform sampler2D uHF;
uniform vec4 uHFInfo;
varying vec3 vCol;
varying float vA;
void main(){
  bool salt = aSeed.w < 0.68;
  vec2 wd = normalize(uWind + vec2(1e-4));
  vec2 side = vec2(-wd.y, wd.x);
  float spd = salt ? mix(5.5, 10.5, aSeed.y) : mix(0.9, 2.6, aSeed.y);
  float sway = salt ? sin(uTime * 2.3 + aSeed.z * 40.0) * 0.15 : sin(uTime * (0.35 + aSeed.z * 0.6) + aSeed.x * 31.0) * 1.6;
  vec2 p = (aSeed.xz - 0.5) * uBox + wd * spd * uTime + side * sway;
  vec2 rel = mod(p - uCam.xz + uBox * 0.5, uBox) - uBox * 0.5;
  vec2 xz = uCam.xz + rel;
  float g = texture2D(uHF, xz * uHFInfo.x + uHFInfo.y).r;
  float hop;
  if (salt) {
    // saltation: short ballistic hops skimming the sand
    float ph = fract(uTime * mix(0.8, 1.7, aSeed.z) + aSeed.x * 7.0);
    hop = 4.0 * ph * (1.0 - ph) * mix(0.05, 0.6, aSeed.z * aSeed.z) + 0.04;
  } else {
    hop = mix(0.35, 6.0, aSeed.y * aSeed.y) + sin(uTime * 0.7 + aSeed.z * 12.0) * 0.35;
  }
  vec3 wp = vec3(xz.x, g + hop, xz.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.1);
  float sz = (salt ? 0.032 : 0.022) * uPx / d;
  gl_PointSize = clamp(floor(sz + 0.5), 1.0, 3.0);
  vA = smoothstep(uBox * 0.5, uBox * 0.3, length(rel)) * smoothstep(0.5, 1.8, d) * (salt ? 0.95 : 0.6) * min(1.0, sz * 1.5 + 0.3) * uHFInfo.w;
  int ci = int(floor(aSeed.y * 3.99));
  vec3 c = ci == 0 ? uPal[0] : ci == 1 ? uPal[1] : ci == 2 ? uPal[2] : uPal[3];
  // grains catch the sun: brighter looking into it, with the odd glint
  vec3 vd = normalize(wp - cameraPosition);
  float fwd = max(dot(vd, uSunDirW), 0.0);
  float glint = step(0.94, fract(aSeed.x * 91.7 + uTime * (0.4 + aSeed.z)));
  vCol = c * uLight * (1.0 + fwd * fwd * 1.3 + glint * 0.8);
}`;
const airFrag = /* glsl */ `
varying vec3 vCol;
varying float vA;
float bayer4(vec2 p){ vec2 q = mod(floor(p), 4.0); int i = int(q.x + q.y * 4.0);
  float m[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0); return (m[i] + 0.5) / 16.0; }
void main(){
  if (vA < bayer4(gl_FragCoord.xy)) discard;
  gl_FragColor = vec4(vCol, 1.0);
}`;

export interface HeightTex {
  tex: THREE.Texture;
  /** x: world->uv scale, y: uv offset, z: texel size (m), w: 1 when valid */
  info: THREE.Vector4;
}

export class AirSand {
  points: THREE.Points;
  private u: Record<string, THREE.IUniform>;
  private v2 = new THREE.Vector2();

  constructor(hf: HeightTex, wind: { x: number; z: number }, count = 7200, box = 58) {
    const rng = new RNG(4242);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.u = {
      uTime: globalUniforms.uTime,
      uSunDirW: globalUniforms.uSunDirW,
      uCam: { value: new THREE.Vector3() },
      uLight: { value: new THREE.Color(1.6, 1.5, 1.35) },
      uPal: { value: [0xf2d49c, 0xe2b97a, 0xd2a564, 0xfbe8bc].map((c) => new THREE.Color(c)) },
      uPx: { value: 600 },
      uBox: { value: box },
      uWind: { value: new THREE.Vector2(wind.x, wind.z) },
      uHF: { value: hf.tex },
      uHFInfo: { value: hf.info },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: airVert, fragmentShader: airFrag, uniforms: this.u, depthWrite: false });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.name = 'airSand';
    this.points.onBeforeRender = (renderer, _s, camera) => {
      this.u.uCam.value.copy(camera.position);
      renderer.getDrawingBufferSize(this.v2);
      this.u.uPx.value = this.v2.y * 0.5 * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    };
  }
  /** light level of the grains (sun radiance share + sky) */
  setLight(sun: THREE.Color, k: number, ambient: number) {
    (this.u.uLight.value as THREE.Color).copy(sun).multiplyScalar(k).addScalar(ambient);
  }
  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class Env {
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  clouds = new THREE.Group();
  preset: EnvPreset;
  sunDir = new THREE.Vector3();
  private skyU: Record<string, THREE.IUniform>;
  private cloudSpeed = 2.2;
  shadowExtent = 46;
  /** smoothed reference height of the regional ground: the haze / dust layers sit on it */
  hazeBase = 8;
  private hazeTarget = NaN;
  air: AirSand | null = null;
  private prevBefore: THREE.Scene['onBeforeRender'];
  private prevAfter: THREE.Scene['onAfterRender'];
  private dustDensity = 0.9;

  constructor(public scene: THREE.Scene, presetName: keyof typeof PRESETS = 'dunes', seed = 1) {
    this.preset = { ...PRESETS[presetName] };
    this.fog = new THREE.Fog(0xffffff, 60, 300);
    this.skyU = {
      uZenith: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      fogColor: { value: this.fog.color },
      uSunDisk: { value: new THREE.Color() },
      uAtmo: { value: ATMO.u },
      uStars: { value: 0 },
      uDisk: { value: 1 },
      uTime: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    (this.sun.shadow as any).radius = 3.2;
    (this.sun.shadow as any).blurSamples = 12;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 260;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);
    scene.fog = this.fog;
    scene.add(this.clouds);
    this.buildClouds(seed);
    this.apply(this.preset);
    // the new look (atmosphere, rim, bounce) is live only while this scene renders
    ATMO.scene = scene;
    this.prevBefore = scene.onBeforeRender;
    this.prevAfter = scene.onAfterRender;
    scene.onBeforeRender = (...a) => {
      ATMO.u[15] = 1;
      globalUniforms.uLook.value.x = 1;
      this.prevBefore.apply(scene, a);
    };
    scene.onAfterRender = (...a) => {
      ATMO.u[15] = 0;
      globalUniforms.uLook.value.x = 0;
      this.prevAfter.apply(scene, a);
    };
  }

  setWind(x: number, z: number) {
    const l = Math.hypot(x, z) || 1;
    ATMO.u[8] = x / l;
    ATMO.u[9] = z / l;
  }

  apply(p: EnvPreset) {
    this.preset = p;
    const day = p.stars < 0.5;
    this.skyU.uZenith.value.setHex(p.zenith);
    this.skyU.uGround.value.setHex(p.ground);
    this.skyU.uStars.value = p.stars;
    const el = THREE.MathUtils.degToRad(p.sunElev),
      az = THREE.MathUtils.degToRad(p.sunAzim);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    // a strong warm sun, cool sky fill from the hemisphere + IBL (cel shade tone stays bluish)
    this.sun.color.setHex(p.sunColor).lerp(new THREE.Color(0xffffff), 0.22);
    this.sun.intensity = p.sunIntensity * (day ? 1.35 : 1);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity * (day ? 0.34 : 0.8);
    this.fog.color.setHex(p.fog);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    (this.skyU.uSunDisk.value as THREE.Color).setHex(p.sunColor).multiplyScalar(day ? 7 : 2.2);
    this.skyU.uDisk.value = 1;
    // shared atmosphere
    const u = ATMO.u;
    u[0] = this.sunDir.x;
    u[1] = this.sunDir.y;
    u[2] = this.sunDir.z;
    u[3] = day ? 0.8 : 0.25;
    const hz = new THREE.Color(p.horizon);
    u[4] = hz.r;
    u[5] = hz.g;
    u[6] = hz.b;
    u[7] = 0.034;
    u[10] = 3.2;
    this.dustDensity = day ? (p.sunElev < 18 ? 0.65 : 0.5) : 0.22;
    u[11] = this.dustDensity;
    ATMO.sunDir.copy(this.sunDir);
    ATMO.sunColor.setHex(p.sunColor);
    ATMO.shafts = day ? 0.5 : 0.18;
    // look uniforms for every voxel model
    const gu = globalUniforms;
    gu.uSunDirW.value.copy(this.sunDir);
    gu.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    const sunOnGround = this.sun.intensity * Math.max(0, this.sunDir.y);
    gu.uBounceCol.value.setHex(p.hemiGround).multiplyScalar(0.26 * sunOnGround);
    gu.uLook.value.set(gu.uLook.value.x, day ? 0.34 : 0.2, 1, day ? 0.22 : 0.35);
    this.air?.setLight(gu.uSunCol.value, 0.36, day ? 0.3 : 0.12);
    this.clouds.visible = p.clouds > 0.01;
    this.clouds.children.forEach((c, i) => ((c as THREE.Mesh).visible = i / this.clouds.children.length < p.clouds));
    const cm = (this.clouds.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
    if (cm) {
      cm.color.setHex(p.cloudColor).multiplyScalar(0.95);
      cm.emissive.setHex(p.cloudColor).multiplyScalar(0.35);
    }
  }

  /** blend toward another preset over time (k = 0..1) */
  lerpPreset(a: EnvPreset, b: EnvPreset, k: number) {
    const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), k).getHex();
    const n = (x: number, y: number) => x + (y - x) * k;
    this.apply({
      zenith: c(a.zenith, b.zenith),
      horizon: c(a.horizon, b.horizon),
      ground: c(a.ground, b.ground),
      sunColor: c(a.sunColor, b.sunColor),
      sunIntensity: n(a.sunIntensity, b.sunIntensity),
      sunElev: n(a.sunElev, b.sunElev),
      sunAzim: n(a.sunAzim, b.sunAzim),
      hemiSky: c(a.hemiSky, b.hemiSky),
      hemiGround: c(a.hemiGround, b.hemiGround),
      hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
      fog: c(a.fog, b.fog),
      fogNear: n(a.fogNear, b.fogNear),
      fogFar: n(a.fogFar, b.fogFar),
      exposure: n(a.exposure, b.exposure),
      stars: n(a.stars, b.stars),
      clouds: n(a.clouds, b.clouds),
      cloudColor: c(a.cloudColor, b.cloudColor),
    });
  }

  private buildClouds(seed: number) {
    const rng = new RNG(seed * 31 + 7);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, emissive: 0xffffff, emissiveIntensity: 0.4 });
    for (let c = 0; c < 14; c++) {
      const m = new VoxelModel('cloud');
      const blobs = rng.int(3, 6);
      for (let b = 0; b < blobs; b++) {
        const bx = rng.int(-10, 10),
          bz = rng.int(-6, 6);
        const rx = rng.int(5, 9),
          rz = rng.int(4, 7);
        for (let x = -rx; x <= rx; x++)
          for (let z = -rz; z <= rz; z++) {
            const d = (x * x) / (rx * rx) + (z * z) / (rz * rz);
            if (d > 1 || rng.chance(0.06)) continue;
            const th = d < 0.35 ? 2 : 1;
            for (let y = 0; y < th; y++) m.set(bx + x, y, bz + z, vary(0xffffff, 0.04, c), 16);
          }
      }
      const geo = buildVoxelGeometry(m, { voxelSize: 4, pivot: 'center', ao: 0.4, brightness: 1.0 });
      const mesh = new THREE.Mesh(geo, mat);
      const a = rng.range(0, Math.PI * 2),
        r = rng.range(150, 520);
      mesh.position.set(Math.cos(a) * r, rng.range(110, 170), Math.sin(a) * r);
      mesh.rotation.y = rng.range(0, Math.PI);
      mesh.userData.r = r;
      mesh.userData.a = a;
      this.clouds.add(mesh);
    }
  }

  /** prefiltered sky environment for image-based fill + PBR reflections (metal, gold, wet) */
  applyEnvMap(renderer: THREE.WebGLRenderer) {
    const p = this.preset;
    const day = p.stars < 0.5;
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: { ...this.skyU, uDisk: { value: 0 } }, side: THREE.BackSide, depthWrite: false }));
    envScene.add(sky);
    // sunlit sand below: the warm bounce every shaded surface picks up
    const sunOnGround = this.sun.intensity * Math.max(0.05, this.sunDir.y);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.hemiGround).multiplyScalar(day ? 0.11 * sunOnGround : 0.3) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    envScene.add(ground);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(envScene, 0.04, 0.1, 200);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = day ? 0.52 : 0.6;
    if (!day) this.hemi.intensity = this.preset.hemiIntensity * 0.7;
    pm.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return rt;
  }

  /** keep sky + shadow frustum centered on focus */
  update(focus: THREE.Vector3, dt: number, time: number) {
    this.skyU.uTime.value = time;
    this.sky.position.copy(focus);
    const ext = this.shadowExtent;
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    // snap shadow center to texel grid to avoid shimmering
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel,
      fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 120, focus.y + this.sunDir.y * 120, fz + this.sunDir.z * 120);
    this.sun.target.updateMatrixWorld();
    this.clouds.position.set(focus.x, 0, focus.z);
    for (const c of this.clouds.children) {
      c.userData.a += (dt * this.cloudSpeed) / c.userData.r;
      c.position.x = Math.cos(c.userData.a) * c.userData.r;
      c.position.z = Math.sin(c.userData.a) * c.userData.r;
    }
    // atmosphere: the haze floor follows the regional ground height slowly
    if (Number.isNaN(this.hazeTarget)) this.hazeTarget = focus.y - 4;
    this.hazeBase += (this.hazeTarget - this.hazeBase) * Math.min(1, dt * 0.5);
    ATMO.u[12] = time;
    ATMO.u[13] = this.hazeBase;
    ATMO.scene = this.scene;
  }

  /** regional ground level for the haze floor (World samples the terrain around the player) */
  setHazeFloor(y: number) {
    if (Number.isNaN(this.hazeTarget)) this.hazeBase = y;
    this.hazeTarget = y;
  }

  dispose() {
    if (this.scene.onBeforeRender !== this.prevBefore) this.scene.onBeforeRender = this.prevBefore;
    if (this.scene.onAfterRender !== this.prevAfter) this.scene.onAfterRender = this.prevAfter;
    if (ATMO.scene === this.scene) ATMO.scene = null;
    ATMO.u[15] = 0;
    globalUniforms.uLook.value.x = 0;
    this.sky.removeFromParent();
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.hemi.removeFromParent();
    this.clouds.removeFromParent();
    this.air?.dispose();
  }
}
