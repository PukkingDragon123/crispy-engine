// THOTH'S EYES: big glossy cartoon eyes drawn by a shader on a real curved eyeball.
// (CLAUDE.md exception, user note: Thoth alone has stylized 2D eyes.)
//
// Each eye is a smooth ball seated in its socket on the voxel head (the voxel
// `eye_l` / `eye_r` parts are the stand-ins for captures that run no animator; this
// hides them). The ball's surface is painted per pixel:
//   - lids of the head's own white down wrap the ball; their shape is two curves
//     (upper and lower lid) with a slant, so one set of numbers gives a wide stare,
//     a happy squint, a sly half-lid, a sleepy droop or a blink;
//   - inside: a wet white with a soft lid shadow, a jade iris painted ON the ball (it
//     foreshortens as he looks sideways) with a gold collarette, radial streaks,
//     light pooling low and a dark limbal ring; a pupil that dilates;
//   - catchlights that ride the iris; when he is excited they become twinkling stars;
//   - an ink lash line, heavier at the outer corner, with an Egyptian kohl flick;
//   - a feathered charcoal brow above each eye that raises, slants and arches.
// Lit by the scene (MeshStandardMaterial), so it sits in the hall's light and fog.
//
//   const eyes = new ThothEyes(rig);           // ThothAnim does this for you
//   eyes.set(0, shape, gazeDirLocal);  eyes.set(1, ...);  eyes.time(t);
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';

/** one eye's drawing parameters (q space: the ball's front, x toward the temple, y up, radius 1) */
export interface EyeShape {
  /** upper lid height at the centre, and how much it falls toward the corners */
  top: number;
  topCurve: number;
  /** lower lid height at the centre, and how much it rises toward the corners (negative: a smiling arch) */
  bot: number;
  botCurve: number;
  /** lid slant: + lifts the outer corner (a cross or determined look), - drops it (sad, sleepy) */
  tilt: number;
  botTilt: number;
  /** pupil size (1 normal) and iris size (1 normal) */
  pupil: number;
  iris: number;
  /** 0..1: the catchlights turn into twinkling stars */
  spark: number;
  /** brow height, slant (+ outer end up), arch, visibility */
  browY: number;
  browAng: number;
  browCurve: number;
}

export const EYE_SHAPES: Record<string, EyeShape> = {
  neutral: { top: 0.7, topCurve: 0.5, bot: -0.62, botCurve: 0.5, tilt: 0, botTilt: 0, pupil: 1.05, iris: 1, spark: 0, browY: 0.9, browAng: -0.02, browCurve: 0.32 },
  happy: { top: 0.56, topCurve: 0.62, bot: -0.02, botCurve: -0.55, tilt: 0.04, botTilt: 0, pupil: 1.1, iris: 1, spark: 0.15, browY: 0.86, browAng: -0.04, browCurve: 0.42 },
  surprised: { top: 0.86, topCurve: 0.42, bot: -0.84, botCurve: 0.38, tilt: 0, botTilt: 0, pupil: 0.55, iris: 0.86, spark: 0, browY: 0.95, browAng: -0.02, browCurve: 0.5 },
  sly: { top: 0.18, topCurve: 0.04, bot: -0.46, botCurve: 0.42, tilt: 0.14, botTilt: 0.08, pupil: 0.9, iris: 1, spark: 0, browY: 0.72, browAng: 0.22, browCurve: 0.1 },
  sleepy: { top: 0.02, topCurve: 0.1, bot: -0.5, botCurve: 0.45, tilt: -0.14, botTilt: 0, pupil: 1.05, iris: 1, spark: 0, browY: 0.72, browAng: -0.12, browCurve: 0.16 },
  excited: { top: 0.74, topCurve: 0.5, bot: -0.66, botCurve: 0.46, tilt: 0, botTilt: 0, pupil: 1.32, iris: 1.06, spark: 1, browY: 0.92, browAng: -0.04, browCurve: 0.46 },
  curious: { top: 0.76, topCurve: 0.52, bot: -0.58, botCurve: 0.48, tilt: 0.02, botTilt: 0, pupil: 1.18, iris: 1.02, spark: 0.2, browY: 0.88, browAng: 0.04, browCurve: 0.34 },
  sad: { top: 0.42, topCurve: 0.42, bot: -0.56, botCurve: 0.46, tilt: -0.3, botTilt: 0, pupil: 1.28, iris: 1.04, spark: 0.35, browY: 0.8, browAng: -0.36, browCurve: 0.06 },
  determined: { top: 0.4, topCurve: 0.3, bot: -0.5, botCurve: 0.44, tilt: 0.3, botTilt: -0.06, pupil: 0.85, iris: 0.98, spark: 0, browY: 0.7, browAng: 0.42, browCurve: 0.04 },
  focus: { top: 0.4, topCurve: 0.42, bot: -0.46, botCurve: 0.5, tilt: 0.1, botTilt: 0, pupil: 0.92, iris: 1, spark: 0, browY: 0.74, browAng: 0.14, browCurve: 0.12 },
};

export function cloneShape(s: EyeShape): EyeShape {
  return { ...s };
}
/** ease every field of `cur` toward `to` (k: 0..1) */
export function easeShape(cur: EyeShape, to: EyeShape, k: number) {
  for (const key of Object.keys(to) as (keyof EyeShape)[]) cur[key] += (to[key] - cur[key]) * k;
}

const EYE_GLSL = /* glsl */ `
uniform vec4 uLidA;
uniform vec4 uLidB;
uniform vec4 uBrowA;
uniform vec4 uFxA;
uniform vec3 uGaze;
uniform vec3 uSkin;
varying vec3 vEyeP;
float tAA(float d) { float w = max(fwidth(d), 1e-4); return clamp(d / w + 0.5, 0.0, 1.0); }
vec3 sRGB(vec3 c) { return pow(c, vec3(2.2)); }
float segDist(vec2 p, vec2 a, vec2 b, out float h) { vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float star4(vec2 p, float r) { p = abs(p) / r; return sqrt(p.x) + sqrt(p.y) - 1.0; }
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
struct EyeOut { vec3 col; float rough; vec3 emit; };
EyeOut thothEye(vec3 n) {
  EyeOut o;
  float side = uFxA.z;
  float tm = uFxA.y;
  vec2 q = vec2(n.x * side, n.y);
  float T = uLidA.x, Tc = uLidA.y, B = uLidA.z, Bc = uLidA.w;
  float top = T - Tc * q.x * q.x + uLidB.x * q.x;
  float bot = B + Bc * q.x * q.x + uLidB.y * q.x;
  float h = top - bot;
  float front = smoothstep(-0.1, 0.12, n.z);
  // ---- lid skin: the head's white down, shaded where it wraps round the ball
  vec3 col = uSkin * mix(0.8, 1.0, smoothstep(-0.25, 0.55, n.z)) * mix(0.97, 1.05, smoothstep(0.1, 0.9, n.y));
  // the soft fold above the open eye, and a little cheek crease under a smile
  float foldY = top + 0.15 + 0.03 * (1.0 - q.x * q.x);
  float fold = (1.0 - tAA(abs(q.y - foldY) - 0.02)) * smoothstep(0.08, 0.3, h) * smoothstep(0.8, 0.45, abs(q.x));
  col *= 1.0 - 0.13 * fold;
  float smile = smoothstep(0.0, -0.4, Bc);
  float crease = (1.0 - tAA(abs(q.y - (bot - 0.13 - 0.25 * q.x * q.x)) - 0.018)) * smile * smoothstep(0.75, 0.3, abs(q.x));
  col *= 1.0 - 0.14 * crease;
  // ---- the open eye
  float open = tAA(top - q.y) * tAA(q.y - bot) * front;
  vec3 g = normalize(uGaze);
  vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), g));
  vec3 t2 = cross(g, t1);
  float ri = 0.46 * uLidB.w;
  vec2 ip = vec2(dot(n, t1), dot(n, t2)) / ri;
  float facing = step(0.0, dot(n, g));
  float r = length(ip);
  float ang = atan(ip.y, ip.x);
  vec3 sc = sRGB(vec3(0.985, 0.975, 0.95));
  sc = mix(sc, sRGB(vec3(0.76, 0.8, 0.92)), smoothstep(0.26, 0.0, top - q.y) * 0.42);
  sc = mix(sc, sRGB(vec3(0.86, 0.85, 0.9)), smoothstep(0.2, 0.0, q.y - bot) * 0.4);
  sc *= mix(0.84, 1.0, smoothstep(0.0, 0.6, n.z));
  float pr = 0.43 * uLidB.z;
  vec3 ic = mix(sRGB(vec3(0.2, 0.74, 0.62)), sRGB(vec3(0.03, 0.3, 0.37)), smoothstep(0.32, 0.98, r));
  ic *= 0.88 + 0.12 * sin(ang * 23.0 + sin(ang * 5.0) * 2.0) * smoothstep(pr, pr + 0.25, r);
  ic = mix(sRGB(vec3(1.0, 0.8, 0.36)), ic, smoothstep(pr + 0.03, pr + 0.21, r));
  ic += sRGB(vec3(0.45, 0.85, 0.62)) * 0.32 * smoothstep(0.1, 0.85, -ip.y) * smoothstep(1.0, 0.5, r);
  ic *= mix(1.0, 0.5, smoothstep(0.05, 0.95, ip.y));
  ic = mix(ic, sRGB(vec3(0.02, 0.07, 0.1)), smoothstep(0.83, 0.97, r));
  float irisM = (1.0 - tAA(r - 1.0)) * facing;
  float pupM = (1.0 - tAA(r - pr)) * facing;
  vec3 eye = mix(sc, ic, irisM);
  eye = mix(eye, sRGB(vec3(0.02, 0.025, 0.05)), pupM);
  // catchlights ride the iris; excited, they become twinkling stars
  float spark = uFxA.x;
  vec2 gc = g.xy;
  vec2 p0 = n.xy - (gc + vec2(-0.28, 0.32) * ri);
  vec2 p1 = n.xy - (gc + vec2(0.33, -0.3) * ri);
  float c0 = 1.0 - tAA(length(p0 / (vec2(0.26, 0.2) * ri)) - 1.0);
  float tw = 0.85 + 0.15 * sin(tm * 9.0);
  float s0 = 1.0 - tAA(star4(rot2(p0, 0.25 + 0.15 * sin(tm * 2.3)), ri * 0.62 * tw));
  float c1 = 1.0 - tAA(length(p1) - 0.075 * ri);
  vec2 p2 = n.xy - (gc + vec2(0.46, 0.3) * ri);
  float s2 = (1.0 - tAA(star4(rot2(p2, -0.3), ri * 0.26 * (0.7 + 0.3 * sin(tm * 7.0 + 1.3))))) * spark;
  float catchM = clamp(mix(c0, s0, spark) + c1 + s2, 0.0, 1.0) * (0.25 + 0.75 * irisM);
  eye = mix(eye, sRGB(vec3(1.0, 0.99, 0.95)), catchM);
  col = mix(col, eye, open);
  // ---- ink: upper lash line (heavier toward the outer corner), lower line, the kohl flick
  float near = tAA(h + 0.12);
  float lwT = 0.055 + 0.055 * clamp(q.x + 0.25, 0.0, 1.0);
  float upInk = tAA(q.y - (top - 0.02)) * tAA(top + lwT - q.y) * near;
  float loInk = tAA(bot + 0.012 - q.y) * tAA(q.y - (bot - 0.032)) * near * smoothstep(0.85, 0.35, abs(q.x));
  float xf = 0.6;
  float yf = T - Tc * xf * xf + uLidB.x * xf;
  float hh;
  float df = segDist(q, vec2(xf, yf + 0.02), vec2(0.98, yf + 0.2 + 0.25 * uLidB.x), hh);
  float flick = 1.0 - tAA(df - mix(0.055, 0.01, hh));
  float ink = clamp(max(max(upInk, loInk), flick), 0.0, 1.0) * front;
  vec3 inkC = sRGB(vec3(0.07, 0.06, 0.1));
  col = mix(col, inkC, ink);
  // ---- the brow: a feathered charcoal stroke, thick at the inner end
  float bx0 = -0.6, bx1 = 0.6;
  float by = uBrowA.x + uBrowA.y * q.x - uBrowA.z * q.x * q.x;
  float tx = clamp((q.x - bx0) / (bx1 - bx0), 0.0, 1.0);
  float bth = mix(0.082, 0.028, tx);
  float dx = max(max(bx0 - q.x, q.x - bx1), 0.0);
  float bd = length(vec2(dx, q.y - by)) - bth;
  float brow = (1.0 - tAA(bd)) * uBrowA.w * front;
  vec3 bc = mix(sRGB(vec3(0.12, 0.11, 0.16)), sRGB(vec3(0.3, 0.31, 0.44)), smoothstep(-bth, bth, q.y - by) * 0.55);
  col = mix(col, bc, brow);
  float wet = open * (1.0 - ink) * (1.0 - brow);
  o.col = col;
  o.rough = mix(0.9, 0.12, wet);
  o.emit = eye * 0.07 * wet + vec3(1.0, 0.97, 0.9) * catchM * open * 0.55 + sRGB(vec3(1.0, 0.8, 0.36)) * 0.05 * irisM * (1.0 - smoothstep(pr + 0.03, pr + 0.21, r)) * open;
  return o;
}
`;

interface EyeU {
  uLidA: { value: THREE.Vector4 };
  uLidB: { value: THREE.Vector4 };
  uBrowA: { value: THREE.Vector4 };
  uFxA: { value: THREE.Vector4 };
  uGaze: { value: THREE.Vector3 };
  uSkin: { value: THREE.Color };
}

function eyeMaterial(side: number, skin: number): { mat: THREE.MeshStandardMaterial; u: EyeU } {
  const u: EyeU = {
    uLidA: { value: new THREE.Vector4(0.6, 0.55, -0.6, 0.5) },
    uLidB: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBrowA: { value: new THREE.Vector4(0.8, 0, 0.22, 1) },
    uFxA: { value: new THREE.Vector4(0, 0, side, 0) },
    uGaze: { value: new THREE.Vector3(0, 0, 1) },
    uSkin: { value: new THREE.Color(skin).multiplyScalar(1.12) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EYE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\nEyeOut eo = thothEye(normalize(vEyeP));\ndiffuseColor.rgb = eo.col;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = eo.rough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += eo.emit;');
  };
  mat.customProgramCacheKey = () => 'thoth-eye-v1';
  return { mat, u };
}

let ballGeo: THREE.SphereGeometry | null = null;
let ballR = 0;

/** the two painted eyeballs of one Thoth rig */
export class ThothEyes {
  meshes: THREE.Mesh[] = [];
  private u: EyeU[] = [];
  constructor(rig: RigInstance) {
    const meta = rig.geo.spec.meta?.eyes as { radius: number; yaw: number; pitch: number; skin: number } | undefined;
    if (!meta) return;
    if (!ballGeo || ballR !== meta.radius) {
      ballGeo = new THREE.SphereGeometry(meta.radius, 48, 32);
      ballR = meta.radius;
    }
    ['eye_l', 'eye_r'].forEach((name, i) => {
      const node = rig.nodes[name];
      if (!node) return;
      const side = i === 0 ? 1 : -1;
      const { mat, u } = eyeMaterial(side, meta.skin);
      const m = new THREE.Mesh(ballGeo!, mat);
      m.name = name + ':ball';
      m.rotation.set(meta.pitch, meta.yaw * side, 0, 'YXZ');
      m.castShadow = false;
      m.receiveShadow = true;
      node.add(m);
      const vox = rig.meshes[name];
      if (vox) vox.visible = false;
      this.meshes.push(m);
      this.u.push(u);
    });
  }
  /** draw eye i (0 left, 1 right) with a shape and a gaze direction in that eye's own space */
  set(i: number, s: EyeShape, gaze: THREE.Vector3) {
    const u = this.u[i];
    if (!u) return;
    u.uLidA.value.set(s.top, s.topCurve, Math.min(s.bot, s.top), s.botCurve);
    u.uLidB.value.set(s.tilt, s.botTilt, s.pupil, s.iris);
    u.uBrowA.value.set(s.browY, s.browAng, s.browCurve, 1);
    u.uFxA.value.x = s.spark;
    u.uGaze.value.copy(gaze);
  }
  time(t: number) {
    for (const u of this.u) u.uFxA.value.y = t;
  }
  dispose() {
    for (const m of this.meshes) {
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    }
    this.meshes = [];
    this.u = [];
  }
}
