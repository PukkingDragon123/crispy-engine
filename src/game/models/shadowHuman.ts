// Shadow humans: every human in dustUP's cinematics and world is a shadow, a completely black,
// featureless figure (user note). The figures are still real sculpted, rigged anatomy (a tapered
// skull and jaw, a neck that slopes into the trapezius, deltoids, a ribcage over a narrower waist,
// calves, heels and toes, hands with a thumb) under nomad clothing whose silhouette tells who they
// are: a traveller's robe, sash, cloak and wrapped head-cloth; a mother's long dress, bell sleeves
// and a headscarf drape; an outlaw's wide hat, poncho and bandana.
//
// Rendering: shadowMaterial() is a black, non-specular material with only a faint rim (fresnel,
// biased toward one light) so the silhouette reads against a dark night. Fog and an optional
// dissolve (black smoke breaking up) are built in.
//
// Rigs use the standard humanoid part names (pelvis root, torso, head, arm_*/fore_*, thigh_*/shin_*;
// sockets hand_l/hand_r/head_top/back/chest/cradle), so any joint-angle animation fits. Extra cloth
// parts: 'robe' (skirt, parent pelvis), 'cape' (parent torso), 'tail' (head-cloth tail or veil, parent head),
// 'hat' (parent head). Faces +Z, left = +X, origin on the ground between the feet, 1/80 m.
//
// Also here: the cursed baby (a tiny scorpion-child in a linen swaddle, NOT a shadow) and a few
// shadow hand props (staff, pistol, lead rope coil).
import * as THREE from 'three';
import type { RigSpec } from '../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { RBm, Sc, type M3, mix, mulRGB, hash3, noise } from './enemies/real/sculpt';
import { ell, cap, tube } from './enemies/real/rk';

export type ShadowKind = 'man' | 'woman' | 'mother' | 'traveller' | 'bandit' | 'rider';

export const SHADOW_VS = 1 / 80;
/** voxel colours of a shadow figure (only seen when it is drawn with the plain voxel material, e.g. a photo) */
const INK = 0x16131a, INK2 = 0x0e0c11, INK3 = 0x221d26;
const tint: (x: number, y: number, z: number) => number = (x, y, z) => (hash3(x, y, z) < 0.5 ? INK : noise.n3(x * 0.2, y * 0.2, z * 0.2) > 0.3 ? INK3 : INK2);

// ====================================================================== the material
export interface ShadowMaterialOpts {
  /** rim strength (0 = pure black; default 0.55, faint) */
  rim?: number;
  rimColor?: number;
  /** world direction the rim light comes from (it favours that side); default from above-behind */
  rimDir?: THREE.Vector3;
  /** base colour (default near-black) */
  base?: number;
}
export type ShadowMaterial = THREE.ShaderMaterial & {
  userData: { fx: { value: THREE.Vector4 }; tint: { value: THREE.Color }; emissiveStrength: { value: number }; shadow: true };
  /** 0..1: the figure breaks up into black smoke */
  dissolve: number;
  rimDir: THREE.Vector3;
  rimColor: THREE.Color;
  rim: number;
};

const SH_VS = /* glsl */ `
varying vec3 vNW; varying vec3 vVW; varying vec3 vWP;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNW = normalize(mat3(modelMatrix) * normal);
  vVW = cameraPosition - wp.xyz;
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SH_FS = /* glsl */ `
uniform vec3 uBase, uRimCol, uRimDir, uFogCol;
uniform float uRim, uFogNear, uFogFar, uFogOn, uDissolve;
varying vec3 vNW; varying vec3 vVW; varying vec3 vWP;
float sh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  if (uDissolve > 0.001) {
    float n = sh(floor(vWP * 22.0)) * 0.7 + sh(floor(vWP * 5.0)) * 0.3;
    if (n < uDissolve * 1.05 - (vWP.y * 0.0)) discard;
  }
  vec3 n = normalize(vNW), v = normalize(vVW);
  float fres = 1.0 - clamp(abs(dot(n, v)), 0.0, 1.0);
  float side = clamp(dot(n, uRimDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = uBase + uRimCol * smoothstep(0.62, 0.98, fres) * (0.15 + 0.85 * side * side) * uRim;
  col = mix(col, uFogCol, uFogOn * smoothstep(uFogNear, uFogFar, length(vVW)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** the shadow look: black, no specular, a faint directional rim, fogged with the scene */
export function shadowMaterial(o: ShadowMaterialOpts = {}): ShadowMaterial {
  const u = {
    uBase: { value: new THREE.Color(o.base ?? 0x030204) },
    uRimCol: { value: new THREE.Color(o.rimColor ?? 0x9aa8d8) },
    uRimDir: { value: (o.rimDir ?? new THREE.Vector3(0, 0.6, -0.8)).clone().normalize() },
    uRim: { value: o.rim ?? 0.55 },
    uFogCol: { value: new THREE.Color(0) },
    uFogNear: { value: 1e4 },
    uFogFar: { value: 2e4 },
    uFogOn: { value: 0 },
    uDissolve: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({ vertexShader: SH_VS, fragmentShader: SH_FS, uniforms: u }) as unknown as ShadowMaterial;
  m.userData = { fx: { value: new THREE.Vector4() }, tint: { value: new THREE.Color(1, 1, 1) }, emissiveStrength: { value: 1 }, shadow: true };
  // follow the scene's fog without the fog chunks
  m.onBeforeRender = (_r, scene) => {
    const f = scene.fog as THREE.Fog | THREE.FogExp2 | null;
    if (f) {
      u.uFogCol.value.copy(f.color);
      if ((f as THREE.Fog).isFog) {
        u.uFogNear.value = (f as THREE.Fog).near;
        u.uFogFar.value = (f as THREE.Fog).far;
      } else {
        u.uFogNear.value = 0;
        u.uFogFar.value = 2.2 / Math.max(1e-4, (f as THREE.FogExp2).density);
      }
      u.uFogOn.value = 1;
    } else u.uFogOn.value = 0;
  };
  Object.defineProperties(m, {
    dissolve: { get: () => u.uDissolve.value, set: (v: number) => (u.uDissolve.value = v) },
    rim: { get: () => u.uRim.value, set: (v: number) => (u.uRim.value = v) },
    rimDir: { get: () => u.uRimDir.value },
    rimColor: { get: () => u.uRimCol.value },
  });
  return m;
}

// ====================================================================== anatomy
interface Body {
  k: number;
  fem: boolean;
  shX: number;
  hipX: number;
  J: Record<string, M3>;
}
function joints(fem: boolean, k: number): Body {
  const s = (v: M3): M3 => [v[0] * k, v[1] * k, v[2] * k];
  const shX = fem ? 0.165 : 0.188, hipX = fem ? 0.095 : 0.09;
  return {
    k,
    fem,
    shX: shX * k,
    hipX: hipX * k,
    J: {
      pelvis: s([0, 0.98, 0]),
      waist: s([0, 1.04, -0.005]),
      neck: s([0, 1.545, -0.012]),
      shoulder: s([shX, 1.43, -0.02]),
      elbow: s([shX + 0.014, 1.135, -0.034]),
      wrist: s([shX + 0.02, 0.88, -0.004]),
      hip: s([hipX, 0.93, 0]),
      knee: s([hipX + 0.006, 0.51, 0.012]),
      ankle: s([hipX + 0.01, 0.085, -0.012]),
    },
  };
}
const add = (a: M3, b: M3): M3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: M3, b: M3, t: number): M3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function sculptBody(rb: RBm, B: Body) {
  const { J, k, fem } = B;
  const c = tint;
  // ---- pelvis: hip mass, glutes, the tops of the thighs
  const pel = rb.pm('pelvis', undefined, J.pelvis);
  ell(pel, [0, 0.965 * k, -0.005], [(fem ? 0.162 : 0.142) * k, 0.1 * k, 0.098 * k], c);
  for (const sx of [1, -1]) {
    ell(pel, [sx * 0.07 * k, 0.9 * k, -0.045 * k], [0.075 * k, 0.085 * k, 0.07 * k], c); // glute
    ell(pel, [sx * B.hipX, 0.9 * k, 0.005], [0.085 * k, 0.07 * k, 0.08 * k], c);
  }
  // ---- torso: abdomen, ribcage, chest, shoulder caps, trapezius, shoulder blades, neck
  const tor = rb.pm('torso', 'pelvis', J.waist);
  ell(tor, [0, 1.11 * k, 0.005], [(fem ? 0.122 : 0.132) * k, 0.11 * k, 0.094 * k], c);
  ell(tor, [0, 1.3 * k, -0.008], [(fem ? 0.138 : 0.158) * k, 0.17 * k, 0.108 * k], c);
  ell(tor, [0, 1.235 * k, 0.03 * k], [0.11 * k, 0.07 * k, 0.07 * k], c); // belly front
  for (const sx of [1, -1]) {
    if (fem) ell(tor, [sx * 0.058 * k, 1.29 * k, 0.07 * k], [0.058 * k, 0.055 * k, 0.05 * k], c, { rot: [0.2, sx * 0.25, 0] });
    else ell(tor, [sx * 0.07 * k, 1.34 * k, 0.055 * k], [0.072 * k, 0.05 * k, 0.04 * k], c);
    ell(tor, [sx * (B.shX - 0.005), 1.415 * k, -0.02 * k], [0.06 * k, 0.062 * k, 0.062 * k], c); // deltoid
    cap(tor, [sx * 0.035 * k, 1.5 * k, -0.035 * k], [sx * (B.shX - 0.03), 1.445 * k, -0.03 * k], 0.048 * k, 0.04 * k, c); // trapezius slope
    ell(tor, [sx * 0.075 * k, 1.36 * k, -0.075 * k], [0.065 * k, 0.085 * k, 0.04 * k], c); // shoulder blade
  }
  cap(tor, [0, 1.44 * k, -0.022 * k], [0, 1.56 * k, -0.01 * k], 0.052 * k, 0.045 * k, c); // neck
  // ---- head: cranium, face, jaw and chin, brow, nose, ears, the back of the neck
  const hd = rb.pm('head', 'torso', J.neck);
  ell(hd, [0, 1.668 * k, -0.012 * k], [0.08 * k, 0.098 * k, 0.096 * k], c);
  ell(hd, [0, 1.612 * k, 0.03 * k], [0.068 * k, 0.07 * k, 0.07 * k], c);
  ell(hd, [0, 1.565 * k, 0.058 * k], [(fem ? 0.032 : 0.038) * k, 0.03 * k, 0.03 * k], c); // chin
  for (const sx of [1, -1]) {
    cap(hd, [sx * 0.058 * k, 1.615 * k, -0.01 * k], [sx * 0.03 * k, 1.565 * k, 0.05 * k], 0.024 * k, 0.02 * k, c); // jaw line
    ell(hd, [sx * 0.08 * k, 1.635 * k, -0.008 * k], [0.013 * k, 0.03 * k, 0.02 * k], c); // ear
    ell(hd, [sx * 0.046 * k, 1.615 * k, 0.06 * k], [0.026 * k, 0.022 * k, 0.025 * k], c); // cheek
  }
  ell(hd, [0, 1.664 * k, 0.072 * k], [0.066 * k, 0.017 * k, 0.026 * k], c); // brow
  cap(hd, [0, 1.648 * k, 0.088 * k], [0, 1.608 * k, 0.106 * k], 0.011 * k, 0.016 * k, c); // nose
  cap(hd, [0, 1.55 * k, -0.02 * k], [0, 1.61 * k, -0.03 * k], 0.046 * k, 0.05 * k, c);
  // ---- arms (left; mirrored below)
  const arm = rb.pm('arm_l', 'torso', J.shoulder);
  ell(arm, add(J.shoulder, [0.006, -0.01, 0]), [0.056 * k, 0.06 * k, 0.058 * k], c);
  cap(arm, J.shoulder, J.elbow, 0.05 * k, 0.038 * k, c);
  ell(arm, lerp3(J.shoulder, J.elbow, 0.45), [0.044 * k, 0.07 * k, 0.046 * k], c, { rot: [0, 0, 0.05] }); // biceps / triceps
  const fore = rb.pm('fore_l', 'arm_l', J.elbow);
  ell(fore, J.elbow, [0.036 * k, 0.036 * k, 0.036 * k], c);
  cap(fore, J.elbow, J.wrist, 0.04 * k, 0.026 * k, c);
  ell(fore, lerp3(J.elbow, J.wrist, 0.28), [0.044 * k, 0.07 * k, 0.04 * k], c); // forearm muscle
  const W = J.wrist;
  ell(fore, add(W, [0.003, -0.055 * k, 0.004]), [0.019 * k, 0.05 * k, 0.04 * k], c); // palm
  ell(fore, add(W, [0.0, -0.11 * k, 0.012 * k]), [0.016 * k, 0.04 * k, 0.035 * k], c, { rot: [-0.25, 0, 0] }); // fingers, a little curled
  cap(fore, add(W, [-0.008 * k, -0.03 * k, 0.03 * k]), add(W, [-0.014 * k, -0.075 * k, 0.046 * k]), 0.012 * k, 0.009 * k, c); // thumb
  // ---- legs
  const th = rb.pm('thigh_l', 'pelvis', J.hip);
  cap(th, J.hip, J.knee, 0.085 * k, 0.054 * k, c);
  ell(th, lerp3(J.hip, J.knee, 0.35), [0.075 * k, 0.15 * k, 0.078 * k], c, { rot: [0.04, 0, 0] }); // quads
  ell(th, add(lerp3(J.hip, J.knee, 0.55), [-0.02 * k, 0, -0.01]), [0.05 * k, 0.12 * k, 0.06 * k], c); // inner thigh
  const sh = rb.pm('shin_l', 'thigh_l', J.knee);
  ell(sh, add(J.knee, [0, 0, 0.012]), [0.052 * k, 0.05 * k, 0.05 * k], c); // knee
  cap(sh, J.knee, J.ankle, 0.048 * k, 0.03 * k, c);
  ell(sh, add(lerp3(J.knee, J.ankle, 0.27), [0.004, 0, -0.03 * k]), [0.05 * k, 0.11 * k, 0.05 * k], c); // calf
  const A = J.ankle;
  ell(sh, add(A, [0, -0.04 * k, -0.035 * k]), [0.034 * k, 0.04 * k, 0.04 * k], c, { keep: (_x, ly) => ly > -0.95 }); // heel
  tube(sh, [add(A, [0, -0.045 * k, -0.02 * k]), add(A, [0.004, -0.058 * k, 0.07 * k]), add(A, [0.008, -0.066 * k, 0.165 * k])], (t) => (0.038 - t * 0.012) * k, c);
}

// ====================================================================== clothing silhouettes
/** a draped skirt / robe from the waist down: folds, flare and an uneven hem (part 'robe', parent pelvis) */
function robe(rb: RBm, B: Body, top: number, hem: number, r0: [number, number], r1: [number, number], seed: number) {
  const s = rb.pm('robe', 'pelvis', B.J.pelvis);
  const vs = SHADOW_VS;
  const k = B.k;
  for (let y = hem; y <= top; y += vs) {
    const t = (top - y) / (top - hem); // 0 top, 1 hem
    const e = Math.pow(t, 0.8);
    const rx = r0[0] + (r1[0] - r0[0]) * e, rz = r0[1] + (r1[1] - r0[1]) * e;
    const N = Math.ceil((Math.PI * 2 * Math.max(rx, rz)) / (vs * 0.7));
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      // folds deepen toward the hem; the hem is uneven and dips at the back
      const fold = 1 + (0.03 + 0.07 * t) * Math.sin(a * 7 + seed + y * 3) + 0.03 * t * Math.sin(a * 13 + seed * 2);
      const hemY = hem + 0.02 * k * Math.sin(a * 5 + seed) + 0.015 * k * (Math.cos(a) < 0 ? 1 : 0);
      if (y < hemY) continue;
      for (let d = 0; d < 3; d++) {
        const f = fold - d * vs * 1.1 / Math.max(rx, rz);
        s.m.set(Math.floor((Math.sin(a) * rx * f) / vs), Math.floor(y / vs), Math.floor((Math.cos(a) * rz * f - 0.005) / vs), INK);
      }
    }
  }
  return s;
}
/** a head-cloth wound round the skull in tilted layers */
function headWrap(hd: Sc, k: number, tall: number) {
  for (let i = 0; i < 5; i++) {
    const y = (1.665 + i * 0.022 * tall) * k;
    ell(hd, [0, y, -0.012 * k], [(0.094 - i * 0.004) * k, 0.03 * k, (0.108 - i * 0.004) * k], tint, { rot: [0.12 * (i % 2 ? 1 : -1), 0, 0.06 * (i - 2)] });
  }
  ell(hd, [0, (1.71 + 0.06 * tall) * k, -0.02 * k], [0.08 * k, 0.05 * k, 0.088 * k], tint);
}
/** a cloak from the shoulders down the back (part 'cape', parent torso) */
function cloak(rb: RBm, B: Body, len: number) {
  const k = B.k;
  const top: M3 = [0, 1.47 * k, -0.07 * k];
  const s = rb.pm('cape', 'torso', top);
  const vs = SHADOW_VS;
  for (let y = 1.48 * k; y > 1.48 * k - len; y -= vs) {
    const t = (1.48 * k - y) / len;
    const hw = (B.shX + 0.04 + t * 0.1) * k;
    for (let x = -hw; x <= hw; x += vs * 0.8) {
      const u = x / hw;
      const z = -0.11 * k - t * 0.08 * k - (1 - u * u) * 0.03 + 0.012 * Math.sin(u * 9 + t * 4);
      if (t > 0.92 && Math.sin(u * 17) > 0.4) continue; // a ragged hem
      for (let d = 0; d < 3; d++) s.m.set(Math.floor(x / vs), Math.floor(y / vs), Math.floor((z + d * vs) / vs), INK);
      if (Math.abs(u) > 0.92) for (let d = 0; d < 6; d++) s.m.set(Math.floor(x / vs), Math.floor(y / vs), Math.floor((z + d * vs * 1.5) / vs), INK); // wraps forward at the sides
    }
  }
  // a gathered collar over the shoulders
  for (const sx of [1, -1]) ell(s, [sx * 0.11 * k, 1.47 * k, -0.04 * k], [0.08 * k, 0.04 * k, 0.07 * k], tint);
}
/** a hanging cloth tail (head-cloth end or veil) from the back of the head (part 'tail', parent head) */
function clothTail(rb: RBm, B: Body, len: number, w: number) {
  const k = B.k;
  const at: M3 = [0, 1.63 * k, -0.09 * k];
  const s = rb.pm('tail', 'head', at);
  const vs = SHADOW_VS;
  for (let y = at[1]; y > at[1] - len; y -= vs) {
    const t = (at[1] - y) / len;
    const hw = w * (1 - t * 0.35) * k;
    for (let x = -hw; x <= hw; x += vs * 0.8) {
      if (t > 0.9 && Math.abs(Math.sin(x * 90)) > 0.6) continue;
      const z = at[2] - 0.03 * k - t * 0.04 * k - Math.max(0, 0.12 - t) * 0.3;
      for (let d = 0; d < 2; d++) s.m.set(Math.floor(x / vs), Math.floor(y / vs), Math.floor((z + d * vs) / vs), INK);
    }
  }
}

// ====================================================================== builders
const cache = new Map<string, RigSpec>();

/**
 * A rigged shadow human. Kinds: 'man' (plain), 'woman', 'mother' (headscarf, long dress, a cradle socket
 * for the baby), 'traveller' (robe, sash, cloak, wrapped head-cloth), 'rider' (a traveller cut for the
 * saddle: shorter robe), 'bandit' (wide hat, poncho, bandana). Memoised per kind + height.
 */
export function shadowHumanRig(kind: ShadowKind = 'traveller', o: { height?: number } = {}): RigSpec {
  const fem = kind === 'woman' || kind === 'mother';
  const H = o.height ?? (fem ? 1.66 : 1.78);
  const key = kind + ':' + H.toFixed(2);
  const hit = cache.get(key);
  if (hit) return hit;
  const k = H / 1.75;
  const rb = new RBm('shadow_' + kind + '_' + Math.round(H * 100), SHADOW_VS);
  const B = joints(fem, k);
  sculptBody(rb, B);
  const hd = rb.sc('head'), tor = rb.sc('torso'), pel = rb.sc('pelvis');
  const seed = kind.length * 1.7;
  if (kind === 'traveller' || kind === 'rider') {
    // robe over the chest, a sash with a knot, wide sleeves, a wrapped head-cloth with a tail, a cloak
    ell(tor, [0, 1.29 * k, -0.01 * k], [0.168 * k, 0.19 * k, 0.118 * k], tint);
    ell(pel, [0, 1.03 * k, 0], [0.155 * k, 0.03 * k, 0.11 * k], tint); // sash
    tube(pel, [[0.06 * k, 1.02 * k, 0.1 * k], [0.075 * k, 0.9 * k, 0.11 * k], [0.08 * k, 0.8 * k, 0.1 * k]], (t) => (0.022 - t * 0.008) * k, tint);
    robe(rb, B, 1.02 * k, kind === 'rider' ? 0.62 * k : 0.14 * k, [0.16 * k, 0.12 * k], [kind === 'rider' ? 0.24 * k : 0.27 * k, kind === 'rider' ? 0.2 * k : 0.23 * k], seed);
    headWrap(hd, k, 1);
    clothTail(rb, B, 0.32 * k, 0.07);
    cloak(rb, B, (kind === 'rider' ? 0.7 : 1.05) * k);
  } else if (fem) {
    // a long dress to the ground, a fitted bodice, a headscarf that drapes down the back
    ell(tor, [0, 1.27 * k, -0.005 * k], [0.15 * k, 0.17 * k, 0.112 * k], tint);
    ell(pel, [0, 1.0 * k, 0], [0.165 * k, 0.05 * k, 0.11 * k], tint);
    robe(rb, B, 1.05 * k, 0.015, [0.165 * k, 0.12 * k], [0.3 * k, 0.26 * k], seed);
    // headscarf: a shell over the skull and a drape over the shoulders
    ell(hd, [0, 1.675 * k, -0.02 * k], [0.092 * k, 0.108 * k, 0.106 * k], tint, { keep: (_x, ly, lz) => !(lz > 0.55 && ly < 0.55) });
    for (const sx of [1, -1]) cap(hd, [sx * 0.085 * k, 1.64 * k, 0.01 * k], [sx * 0.1 * k, 1.53 * k, -0.02 * k], 0.03 * k, 0.045 * k, tint);
    clothTail(rb, B, (kind === 'mother' ? 0.62 : 0.5) * k, 0.12);
  } else if (kind === 'bandit') {
    // a poncho over the shoulders, a bandana over the face, a wide hat, a gun belt
    const pon = rb.pm('cape', 'torso', [0, 1.47 * k, 0]);
    for (let y = 1.5 * k; y > 1.08 * k; y -= SHADOW_VS) {
      const t = (1.5 * k - y) / (0.42 * k);
      const rx = (0.12 + t * 0.2) * k, rz = (0.11 + t * 0.07) * k;
      ell(pon, [0, y, 0], [rx, SHADOW_VS * 0.6, rz], tint, { keep: (lx, _y, lz) => lx * lx + lz * lz > 0.7 || t < 0.08 });
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      cap(pon, [Math.sin(a) * 0.3 * k, 1.09 * k, Math.cos(a) * 0.17 * k], [Math.sin(a) * 0.31 * k, 1.04 * k, Math.cos(a) * 0.175 * k], 0.008, 0.006, tint); // fringe
    }
    ell(hd, [0, 1.59 * k, 0.055 * k], [0.072 * k, 0.05 * k, 0.05 * k], tint, { rot: [0.35, 0, 0] }); // bandana
    ell(pel, [0, 1.0 * k, 0], [0.15 * k, 0.025 * k, 0.108 * k], tint); // belt
    ell(pel, [-0.15 * k, 0.9 * k, 0.02 * k], [0.022 * k, 0.07 * k, 0.04 * k], tint, { rot: [0, 0, 0.15] }); // holster
    const hat = rb.pm('hat', 'head', [0, 1.74 * k, -0.01 * k]);
    ell(hat, [0, 1.735 * k, -0.01 * k], [0.21 * k, 0.012 * k, 0.2 * k], tint, { keep: (lx, ly, lz) => ly > -0.2 || lx * lx + lz * lz > 0.85 });
    for (const sx of [1, -1]) ell(hat, [sx * 0.19 * k, 1.75 * k, -0.01 * k], [0.03 * k, 0.012 * k, 0.15 * k], tint); // curled sides
    ell(hat, [0, 1.79 * k, -0.012 * k], [0.09 * k, 0.065 * k, 0.1 * k], tint, { keep: (_x, ly) => ly > -0.75 });
    ell(hat, [0, 1.85 * k, -0.012 * k], [0.02 * k, 0.012 * k, 0.07 * k], tint, { carve: true }); // the crown's pinch
  } else {
    // a plain working man: shirt and trousers fuller than the body, a short head-cloth
    ell(tor, [0, 1.28 * k, -0.008 * k], [0.165 * k, 0.18 * k, 0.115 * k], tint);
    headWrap(hd, k, 0.5);
  }
  if (kind === 'traveller' || kind === 'rider' || fem) {
    // wide sleeves that bell at the wrist
    const fore = rb.sc('fore_l');
    cap(fore, lerp3(B.J.elbow, B.J.wrist, 0.1), lerp3(B.J.elbow, B.J.wrist, 0.92), 0.046 * k, 0.062 * k, tint);
    cap(rb.sc('arm_l'), B.J.shoulder, B.J.elbow, 0.058 * k, 0.05 * k, tint);
  }
  rb.mirrorLR();
  const J = B.J;
  rb.sockM('hand_l', 'fore_l', add(J.wrist, [0, -0.07 * k, 0.012]));
  rb.sockM('hand_r', 'fore_r', add([-J.wrist[0], J.wrist[1], J.wrist[2]], [0, -0.07 * k, 0.012]));
  rb.sockM('head_top', 'head', [0, 1.77 * k, -0.01]);
  rb.sockM('back', 'torso', [0, 1.3 * k, -0.13 * k]);
  rb.sockM('chest', 'torso', [0, 1.3 * k, 0.12 * k]);
  // where a cradled baby lies: across the forearms in front of the chest
  rb.sockM('cradle', 'torso', [0.02 * k, 1.17 * k, 0.2 * k]);
  const spec = rb.build({
    shadow: true,
    kind,
    height: (kind === 'bandit' ? 1.86 : 1.76) * k,
    hatTop: (kind === 'bandit' ? 1.88 : 1.79) * k,
    radius: 0.24 * k,
    hipY: J.hip[1],
    kneeY: J.knee[1],
    shoulderY: J.shoulder[1],
    legLen: J.hip[1],
    upperArmLen: J.shoulder[1] - J.elbow[1],
    foreArmLen: J.elbow[1] - J.wrist[1],
  });
  cache.set(key, spec);
  return spec;
}

// ====================================================================== poses
export type Pose = Record<string, [number, number, number]>;
/** joint angles for the shadow rigs (and any standard humanoid); missing joints stay at rest */
export const SHADOW_POSES: Record<string, Pose> = {
  idle: { arm_l: [0.02, 0, 0.08], arm_r: [0.02, 0, -0.08], fore_l: [-0.12, 0, 0], fore_r: [-0.12, 0, 0] },
  /** cradling a baby across the forearms, head bowed over it */
  cradle: { torso: [0.2, 0, 0], head: [0.42, 0.05, 0], arm_l: [-0.38, 0, -0.08], fore_l: [-1.38, 0, -0.62], arm_r: [-0.46, 0, 0.12], fore_r: [-1.3, 0, 0.72] },
  /** kneeling, sitting back on the heels (lower the root by `kneelDrop` of the leg length) */
  kneel: { thigh_l: [-1.5, 0, 0.06], thigh_r: [-1.5, 0, -0.06], shin_l: [2.75, 0, 0], shin_r: [2.75, 0, 0] },
  /** standing turned away: weight on one leg, head down, a staff in the right hand */
  away: { pelvis: [0, 0, 0.03], torso: [0.08, 0.1, -0.02], head: [0.28, -0.2, 0], arm_l: [0.05, 0, 0.06], fore_l: [-0.25, 0, 0], arm_r: [-0.22, 0, -0.12], fore_r: [-0.85, 0, 0], thigh_l: [0.04, 0, 0.04], shin_l: [0.1, 0, 0] },
  /** in a saddle */
  ride: { thigh_l: [-1.25, 0, 0.42], thigh_r: [-1.25, 0, -0.42], shin_l: [1.15, 0, -0.1], shin_r: [1.15, 0, 0.1], arm_l: [-0.5, 0, 0.1], fore_l: [-0.9, 0, 0], arm_r: [-0.4, 0, -0.1], fore_r: [-1.0, 0, 0], torso: [0.08, 0, 0] },
  /** a gunman squaring up */
  draw: { torso: [0.02, -0.2, 0], head: [0, 0.2, 0], arm_r: [-1.35, 0.1, -0.12], fore_r: [-0.1, 0, 0], arm_l: [0.1, 0, 0.25], fore_l: [-0.4, 0, 0], thigh_l: [-0.12, 0, 0.1], thigh_r: [0.1, 0, -0.08], shin_l: [0.2, 0, 0] },
};
/** the root drop when kneeling (m, of a figure whose hips are at `hipY`) */
export const kneelDrop = (hipY: number) => hipY * 0.66;

/** set a rig's joints to a weighted blend of poses (weights need not sum to 1; the rest is the rest pose) */
export function applyPose(nodes: Record<string, THREE.Object3D>, rest: Map<string, THREE.Euler> | null, poses: [Pose, number][]) {
  const acc: Record<string, [number, number, number]> = {};
  for (const [p, w] of poses)
    for (const [n, a] of Object.entries(p)) {
      const v = (acc[n] ??= [0, 0, 0]);
      v[0] += a[0] * w;
      v[1] += a[1] * w;
      v[2] += a[2] * w;
    }
  for (const [n, node] of Object.entries(nodes)) {
    const r = rest?.get(n);
    const a = acc[n];
    if (!a && !r) continue;
    node.rotation.set((r?.x ?? 0) + (a?.[0] ?? 0), (r?.y ?? 0) + (a?.[1] ?? 0), (r?.z ?? 0) + (a?.[2] ?? 0));
  }
}

/** a simple walk cycle layered on top (phase in radians; `amp` 0..1); returns the root bob (m) */
export function walkPose(nodes: Record<string, THREE.Object3D>, phase: number, amp = 1): number {
  const s = Math.sin(phase), c = Math.cos(phase);
  const n = nodes;
  const add = (name: string, x: number, y = 0, z = 0) => {
    const o = n[name];
    if (o) o.rotation.set(o.rotation.x + x, o.rotation.y + y, o.rotation.z + z);
  };
  add('thigh_l', -0.42 * s * amp);
  add('thigh_r', 0.42 * s * amp);
  add('shin_l', Math.max(0, c) * 0.75 * amp + 0.08);
  add('shin_r', Math.max(0, -c) * 0.75 * amp + 0.08);
  add('arm_l', 0.26 * s * amp);
  add('arm_r', -0.26 * s * amp);
  add('fore_l', -0.2 * amp);
  add('fore_r', -0.2 * amp);
  add('pelvis', 0, 0.08 * s * amp, 0);
  add('torso', 0.04 * amp, -0.1 * s * amp, 0);
  add('robe', 0.03 * s * amp, 0, 0.02 * c * amp);
  add('cape', 0.1 * amp + 0.04 * Math.abs(s) * amp, 0, 0.03 * c * amp);
  add('tail', 0.15 * amp + 0.05 * Math.abs(c) * amp, 0, 0.04 * s * amp);
  return Math.abs(c) * 0.025 * amp;
}

// ====================================================================== shadow hand props
/** a gnarled walking staff, held at its middle (1/80, pivot at the grip) */
export function shadowStaff(len = 1.7): { model: VoxelModel; voxelSize: number; pivot: [number, number, number] } {
  const m = new VoxelModel('shadow_staff');
  const s = new Sc(m, SHADOW_VS);
  const pts: M3[] = [];
  for (let i = 0; i <= 6; i++) pts.push([Math.sin(i * 1.7) * 0.012, -len * 0.55 + (i / 6) * len, Math.cos(i * 2.3) * 0.01]);
  tube(s, pts, (t) => 0.016 + (1 - t) * 0.004 + (t > 0.9 ? 0.012 : 0), INK);
  ell(s, [0.02, len * 0.45 - 0.02, 0], [0.03, 0.05, 0.028], INK); // the crook knot
  return { model: m, voxelSize: SHADOW_VS, pivot: [0, 0, 0] };
}

// ====================================================================== the cursed baby (not a shadow)
/** the scorpion-child's swaddle and chitin (cloth is linen, the chitin a soft newborn amber) */
const LINEN = [0xe8dcc0, 0xd2c2a0, 0xf4ecd8, 0xa8967a];
const CHIT = { base: 0xc98a56, hi: 0xe6b07a, lo: 0x8a5634, seam: 0x5a3420 };
export const BABY_VS = 1 / 240;

/**
 * The cursed baby: a tiny scorpion-child in a linen swaddle, lying along +X (head end), face up (+Y).
 * Parts: 'swaddle' (root, pivot at its centre underside), 'head' (the little carapace head with
 * modelled bead eyes 'eye_l'/'eye_r' and chelicerae), 'claw_l'/'claw_r' (tiny pincer arms peeking out of the
 * wrap, each with a movable finger 'clawf_l'/'clawf_r'), 'tail1'..'tail4' + 'stinger' (the little tail
 * curling out of the foot end). Left = +Z here. meta.length (m).
 */
export function scorpionBabyRig(): RigSpec {
  const hit = cache.get('baby');
  if (hit) return hit;
  const rb = new RBm('scorpion_baby', BABY_VS);
  const vs = BABY_VS;
  const linen = (x: number, y: number, z: number) => {
    // wrap bands spiral round the bundle; creases between them
    const X = (x + 0.5) * vs, Y = (y + 0.5) * vs - 0.075, Z = (z + 0.5) * vs;
    const a = Math.atan2(Z, Y);
    const band = ((X * 26 + a * 0.9) % 1 + 1) % 1;
    const c = band < 0.12 ? LINEN[1] : band > 0.82 ? LINEN[2] : LINEN[0];
    return mulRGB(c, 0.97 + hash3(x, y, z) * 0.05);
  };
  const sw = rb.pm('swaddle', undefined, [0, 0, 0]);
  tube(sw, [[-0.2, 0.062, 0], [-0.1, 0.072, 0], [0.02, 0.078, 0], [0.11, 0.08, 0]], (t) => 0.05 + Math.sin(t * Math.PI * 0.8) * 0.032, linen);
  // the hood round the head, open to the sky
  ell(sw, [0.15, 0.082, 0], [0.072, 0.075, 0.078], linen);
  ell(sw, [0.175, 0.125, 0], [0.06, 0.06, 0.056], 0, { carve: true });
  ell(sw, [0.205, 0.095, 0], [0.04, 0.05, 0.05], 0, { carve: true });
  // a thick turned-back lip round the opening, a loose fold and a corner flap at the feet
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const p: M3 = [0.175 + Math.cos(a) * 0.012, 0.125 + Math.sin(a) * 0.002 + 0.01, Math.sin(a) * 0.058];
    if (Math.cos(a) > 0.75) continue;
    ell(sw, p, [0.012, 0.012, 0.012], (x, y, z) => mix(LINEN[2], LINEN[0], hash3(x, y, z) * 0.4));
  }
  cap(sw, [0.05, 0.13, 0.03], [-0.08, 0.125, -0.04], 0.012, 0.009, (x, y, z) => mix(LINEN[1], LINEN[3], hash3(x, y, z) * 0.5));
  tube(sw, [[-0.21, 0.08, 0.02], [-0.25, 0.05, 0.035], [-0.27, 0.012, 0.03]], (t) => 0.02 - t * 0.012, linen);
  // a blue thread tied round the middle (a mother's knot)
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    sw.m.set(Math.floor(-0.02 / vs + Math.sin(a) * 1.5), Math.floor((0.075 + Math.cos(a) * 0.084) / vs), Math.floor((Math.sin(a) * 0.087) / vs), 0x3a5a9a);
  }
  ell(sw, [-0.02, 0.16, 0.01], [0.008, 0.007, 0.012], 0x2c4880);
  // ---- the head: a soft round carapace, plates and seams, chubby cheeks, chelicerae, modelled eyes
  const chit = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.25, y * 0.25, z * 0.25);
    return mulRGB(n > 0.35 ? CHIT.hi : n < -0.4 ? CHIT.lo : CHIT.base, 0.97 + hash3(x, y, z) * 0.06);
  };
  const H = rb.pm('head', 'swaddle', [0.14, 0.1, 0]);
  ell(H, [0.165, 0.112, 0], [0.042, 0.036, 0.04], chit);
  ell(H, [0.19, 0.105, 0], [0.026, 0.03, 0.034], chit); // the face front
  for (const sz of [1, -1]) ell(H, [0.186, 0.098, sz * 0.022], [0.016, 0.018, 0.016], chit); // cheeks
  // carapace seams: a midline groove and two arcs
  for (let i = -8; i <= 8; i++) H.m.set(Math.floor((0.165 + i * 0.0035) / vs), Math.floor((0.146 - Math.abs(i) * 0.0012) / vs), 0, CHIT.seam);
  for (const sz of [1, -1]) for (let i = 0; i < 10; i++) H.m.set(Math.floor((0.15 + i * 0.002) / vs), Math.floor((0.142 - i * 0.002) / vs), Math.floor((sz * (0.02 + i * 0.0018)) / vs), CHIT.seam);
  // ocular bump and the two median eyes (glossy black beads with a catchlight), as their own parts
  ell(H, [0.183, 0.13, 0], [0.016, 0.01, 0.022], chit);
  for (const [nm, sz] of [['eye_l', 1], ['eye_r', -1]] as [string, number][]) {
    const e = rb.pm(nm, 'head', [0.188, 0.133, sz * 0.011]);
    ell(e, [0.188, 0.133, sz * 0.011], [0.0075, 0.0075, 0.0075], 0x0a0706, { fl: VF.METAL });
    e.m.set(Math.floor(0.191 / vs), Math.floor(0.137 / vs), Math.floor((sz * 0.009) / vs), 0xfff8ee, VF.EMISSIVE);
  }
  for (const sz of [1, -1]) {
    cap(H, [0.205, 0.098, sz * 0.008], [0.216, 0.088, sz * 0.006], 0.006, 0.004, CHIT.lo); // chelicerae
    H.m.set(Math.floor(0.218 / vs), Math.floor(0.086 / vs), Math.floor((sz * 0.004) / vs), 0x2a160c);
  }
  // ---- the claws peeking out of the wrap beside the face, reaching up
  for (const [nm, sz] of [['l', 1], ['r', -1]] as ['l' | 'r', number][]) {
    const base: M3 = [0.1, 0.13, sz * 0.045];
    const cl = rb.pm('claw_' + nm, 'swaddle', base);
    tube(cl, [base, [0.115, 0.16, sz * 0.055], [0.13, 0.18, sz * 0.05]], (t) => 0.011 - t * 0.003, chit);
    ell(cl, [0.138, 0.19, sz * 0.05], [0.014, 0.017, 0.011], chit); // the little palm (manus)
    cap(cl, [0.142, 0.2, sz * 0.05], [0.15, 0.222, sz * 0.048], 0.006, 0.003, CHIT.lo); // fixed finger
    const f = rb.pm('clawf_' + nm, 'claw_' + nm, [0.135, 0.2, sz * 0.05]);
    cap(f, [0.135, 0.2, sz * 0.05], [0.13, 0.222, sz * 0.05], 0.0055, 0.003, CHIT.lo);
  }
  // ---- the tail: four segments and a stinger, curling up out of the foot end
  const TP: M3[] = [[-0.2, 0.09, 0], [-0.24, 0.12, 0.004], [-0.262, 0.165, 0.008], [-0.255, 0.21, 0.01], [-0.225, 0.238, 0.01], [-0.195, 0.232, 0.008]];
  let parent = 'swaddle';
  for (let i = 0; i < 4; i++) {
    const nm = 'tail' + (i + 1);
    const t = rb.pm(nm, parent, TP[i]);
    const r = 0.017 - i * 0.0022;
    ell(t, lerp3(TP[i], TP[i + 1], 0.5), [r * 1.15, r * 1.15, r], chit, {});
    cap(t, TP[i], TP[i + 1], r * 0.8, r * 0.7, chit);
    // a seam ring at each joint
    ell(t, TP[i + 1], [r * 0.72, r * 0.72, r * 0.72], CHIT.seam);
    parent = nm;
  }
  const st = rb.pm('stinger', 'tail4', TP[4]);
  ell(st, lerp3(TP[4], TP[5], 0.4), [0.011, 0.01, 0.009], chit);
  tube(st, [TP[5], [-0.188, 0.222, 0.008], [-0.186, 0.212, 0.007]], (t) => 0.005 - t * 0.0035, (x, y, z) => (y * vs < 0.218 ? 0x7aff7a : 0x3a6a2a));
  const spec = rb.build({ length: 0.5, eyes: 'voxel' });
  cache.set('baby', spec);
  return spec;
}
