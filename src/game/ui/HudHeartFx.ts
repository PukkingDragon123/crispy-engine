// The HUD heart's living light: an additive skin over the sculpted, linen-wrapped heart
// (props/hud.ts hudHeartRig) sharing every part's geometry and joints, so it beats with it.
//  • subsurface glow: warm light bleeding through the thin edges of the muscle, swelling
//    on each beat (stronger the healthier you are)
//  • cracks: below half health ember-lit fissures open across the muscle between the
//    wraps, more and wider as it drains, flickering with the pulse; pixel embers and drops
//    of blood fall from it
//  • heal: a gold shimmer sweeps up over the heart and wraps, with rising pixel motes
//  • hurt: a hot flash through the flesh
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';
import { PixelFx } from './HudKit';

const VS = /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying vec3 vNm;
void main(){
  vP = position; vC = color; vNm = normal;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `
uniform float uBeat, uDmg, uHeal, uHurt, uT, uScale, uKind, uVox;
varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying vec3 vNm;
vec3 h33(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
// distance to the nearest Voronoi edge, and the cell's random id
vec2 crack(vec3 p){
  vec3 b = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0; float id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = h33(b + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = o.x; } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, id);
}
void main(){
  vec3 n = normalize(vN), v = normalize(vV);
  float fres = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  float muscle = uKind < 0.5 ? smoothstep(0.04, 0.18, vC.r - max(vC.g, vC.b)) : 0.0;
  // snapped to the centre of its (low-res) voxel, so the cracks and the heal band step in whole blocks
  vec3 q = (floor((vP - vNm * 0.5 * uVox) / uVox) + 0.5) * uVox * uScale;
  vec3 col = vec3(0.0);
  // subsurface: light through the thin silhouette, pulsing with the beat
  // (flat, one step: only faces turned well away glow, and softer, so it reads as a 2D icon)
  float sss = step(0.55, fres) * 0.55 * (0.3 + 0.7 * uBeat);
  col += vec3(1.0, 0.28, 0.14) * sss * (0.6 * muscle + 0.1) * (0.45 + 0.55 * (1.0 - uDmg));
  // cracks open below half health
  if (uDmg > 0.45 && muscle > 0.01) {
    vec2 cr = crack(q * 6.0 + vec3(0.0, 0.0, 3.0));
    float grow = (uDmg - 0.45) / 0.55;
    float w = 0.03 + 0.07 * grow;
    float line = 1.0 - smoothstep(0.0, w, cr.x);
    float open = step(cr.y, grow * 1.25);
    float flick = 0.75 + 0.25 * sin(uT * 23.0 + cr.y * 40.0);
    col += vec3(1.0, 0.5, 0.12) * line * open * muscle * flick * (0.9 + 0.9 * uBeat);
  }
  // heal: a gold band sweeping up
  if (uHeal > 0.001) {
    float yb = (1.0 - uHeal) * 1.6 - 0.75;
    float band = exp(-pow((q.y - yb) * 8.0, 2.0));
    col += vec3(1.0, 0.9, 0.55) * band * (0.35 + 0.9 * fres) * min(1.0, uHeal * 3.0);
  }
  col += vec3(1.0, 0.35, 0.22) * uHurt * (0.25 + 0.5 * fres);
  gl_FragColor = vec4(col, 1.0);
}`;

export class HeartFx {
  private mats: THREE.ShaderMaterial[] = [];
  private u = {
    uBeat: { value: 0 },
    uDmg: { value: 0 },
    uHeal: { value: 0 },
    uHurt: { value: 0 },
    uT: { value: 0 },
    uScale: { value: 1 },
    uVox: { value: 1 },
  };
  /** pixel embers, blood drops and heal motes around the heart (HUD px) */
  fx = new PixelFx(160, true, 64);
  private heal = 0;
  private last = -1;
  private emberAcc = 0;

  constructor(heart: RigInstance, height: number, scene: THREE.Scene) {
    this.u.uScale.value = 1 / Math.max(1e-4, height);
    this.u.uVox.value = heart.geo.spec.voxelSize;
    for (const [name, mesh] of Object.entries(heart.meshes)) {
      const m = new THREE.ShaderMaterial({
        uniforms: { ...this.u, uKind: { value: name === 'heart' ? 0 : 1 } },
        vertexShader: VS,
        fragmentShader: FS,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.mats.push(m);
      const skin = new THREE.Mesh(mesh.geometry, m);
      skin.frustumCulled = false;
      skin.renderOrder = 1;
      mesh.add(skin);
    }
    scene.add(this.fx.points);
  }

  /**
   * beat 0..1 pulse, frac health, hurt 0..1; (x, y) the heart's centre and r its radius, HUD px
   */
  update(dt: number, beat: number, frac: number, hurt: number, t: number, x: number, y: number, r: number, s: number, visible: boolean) {
    if (this.last >= 0 && frac > this.last + 0.004) {
      this.heal = 1;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.emit({ x: x + Math.cos(a) * r * 0.8, y: y + Math.sin(a) * r * 0.8, vx: Math.cos(a) * 12, vy: -30 - Math.random() * 30, drag: 1.5, life: 0.6 + Math.random() * 0.5, size: i % 4 ? 1 : 2, c0: 0xffffff, c1: 0xffd070, alpha: 1, flick: 0.4 });
      }
    }
    this.last = frac;
    this.heal = Math.max(0, this.heal - dt / 0.9);
    const dmg = 1 - frac;
    this.u.uBeat.value = beat;
    this.u.uDmg.value = dmg;
    this.u.uHeal.value = this.heal;
    this.u.uHurt.value = hurt;
    this.u.uT.value = t;
    // a cracked heart sheds embers and drops of blood
    if (visible && dmg > 0.45) {
      this.emberAcc += dt * (dmg - 0.4) * 14 * (0.5 + beat);
      while (this.emberAcc > 1) {
        this.emberAcc -= 1;
        const blood = Math.random() < 0.4;
        this.fx.emit({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.2) * r * 0.8, vx: (Math.random() - 0.5) * 14, vy: blood ? 10 : -18 - Math.random() * 20, ay: blood ? 160 : -10, drag: 1, life: 0.5 + Math.random() * 0.4, size: 1, c0: blood ? 0xc43a2a : 0xffc060, c1: blood ? 0x4a0e0a : 0xc23a1c, alpha: 1, flick: blood ? 0 : 0.5 });
      }
    }
    this.fx.points.visible = visible;
    this.fx.update(dt, s);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.fx.points.removeFromParent();
    this.fx.dispose();
  }
}
