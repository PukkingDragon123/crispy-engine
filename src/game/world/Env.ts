// Atmosphere: gradient sky dome with sun glow + pixel stars, warm haze fog,
// sun with player-following shadow frustum, hemisphere bounce, drifting voxel clouds.
import * as THREE from 'three';
import { RNG } from '../../engine/math/rand';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, vary } from '../../engine/voxel/VoxelModel';

export interface EnvPreset {
  zenith: number;
  horizon: number;
  ground: number;
  sunColor: number;
  sunIntensity: number;
  sunElev: number; // degrees
  sunAzim: number; // degrees
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  stars: number;
  clouds: number; // 0..1 coverage
  cloudColor: number;
}

export const PRESETS: Record<string, EnvPreset> = {
  dunes: { zenith: 0x3f86d6, horizon: 0xf3d6a4, ground: 0xd9ad74, sunColor: 0xffe3b8, sunIntensity: 3.4, sunElev: 34, sunAzim: 230, hemiSky: 0xbcd8ff, hemiGround: 0xd29a5c, hemiIntensity: 1.05, fog: 0xe9d3ae, fogNear: 110, fogFar: 460, exposure: 1.0, stars: 0, clouds: 0.5, cloudColor: 0xfff6ea },
  oasis: { zenith: 0x4b8fd1, horizon: 0xf6c88f, ground: 0xb8955f, sunColor: 0xffd29a, sunIntensity: 3.1, sunElev: 22, sunAzim: 250, hemiSky: 0xc9dcf0, hemiGround: 0xa8925c, hemiIntensity: 1.1, fog: 0xf0cf9e, fogNear: 60, fogFar: 300, exposure: 1.02, stars: 0, clouds: 0.65, cloudColor: 0xffe7cf },
  pyramid: { zenith: 0x5a2c3a, horizon: 0xe0794a, ground: 0x9c5a36, sunColor: 0xffa070, sunIntensity: 2.7, sunElev: 14, sunAzim: 260, hemiSky: 0xe0a080, hemiGround: 0x8c4a2c, hemiIntensity: 1.0, fog: 0xc8704a, fogNear: 40, fogFar: 240, exposure: 1.05, stars: 0.15, clouds: 0.8, cloudColor: 0xe89a7a },
  menu: { zenith: 0x2f5fa8, horizon: 0xffb877, ground: 0xc98c55, sunColor: 0xffb070, sunIntensity: 3.2, sunElev: 9, sunAzim: 255, hemiSky: 0xb0c4e8, hemiGround: 0xc88850, hemiIntensity: 0.95, fog: 0xf0b884, fogNear: 40, fogFar: 260, exposure: 1.0, stars: 0.25, clouds: 0.55, cloudColor: 0xffd2b0 },
  night: { zenith: 0x0b1530, horizon: 0x2c4466, ground: 0x2a2a38, sunColor: 0x9fb8ff, sunIntensity: 1.1, sunElev: 40, sunAzim: 140, hemiSky: 0x5068a0, hemiGround: 0x302a34, hemiIntensity: 0.7, fog: 0x1c2840, fogNear: 30, fogFar: 200, exposure: 1.1, stars: 1, clouds: 0.3, cloudColor: 0x5a6a90 },
  underworld: { zenith: 0x02080f, horizon: 0x0d3a4a, ground: 0x061018, sunColor: 0x8ff0ff, sunIntensity: 1.6, sunElev: 60, sunAzim: 200, hemiSky: 0x3a8ab0, hemiGround: 0x101820, hemiIntensity: 0.8, fog: 0x07222e, fogNear: 20, fogFar: 140, exposure: 1.15, stars: 1, clouds: 0, cloudColor: 0x203040 },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const skyFrag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uStars, uTime;
varying vec3 vDir;
float h3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-y * 6.0, 0.0, 1.0));
  // horizon haze band
  col = mix(col, uHorizon * 1.08, exp(-abs(y) * 14.0) * 0.45);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 64.0) * 0.6);
  // pixel sun disk
  if (sd > 0.9985) col = mix(col, vec3(1.0, 0.97, 0.88) * 3.0, 0.9);
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

  constructor(public scene: THREE.Scene, presetName: keyof typeof PRESETS = 'dunes', seed = 1) {
    this.preset = { ...PRESETS[presetName] };
    this.skyU = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    (this.sun.shadow as any).radius = 2.5;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 260;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);
    this.fog = new THREE.Fog(0xffffff, 60, 300);
    scene.fog = this.fog;
    scene.add(this.clouds);
    this.buildClouds(seed);
    this.apply(this.preset);
  }

  apply(p: EnvPreset) {
    this.preset = p;
    this.skyU.uZenith.value.setHex(p.zenith);
    this.skyU.uHorizon.value.setHex(p.horizon);
    this.skyU.uGround.value.setHex(p.ground);
    this.skyU.uSunColor.value.setHex(p.sunColor);
    this.skyU.uStars.value = p.stars;
    const el = THREE.MathUtils.degToRad(p.sunElev),
      az = THREE.MathUtils.degToRad(p.sunAzim);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.skyU.uSunDir.value.copy(this.sunDir);
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.setHex(p.fog);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    this.clouds.visible = p.clouds > 0.01;
    this.clouds.children.forEach((c, i) => ((c as THREE.Mesh).visible = i / this.clouds.children.length < p.clouds));
    const cm = (this.clouds.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
    if (cm) {
      cm.color.setHex(p.cloudColor).multiplyScalar(0.6);
      cm.emissive.setHex(p.cloudColor);
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
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, emissive: 0xffffff, emissiveIntensity: 0.55 });
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
  }
}
