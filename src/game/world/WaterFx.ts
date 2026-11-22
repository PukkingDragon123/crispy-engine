// Shared water surface dynamics for the still water (oasis pools, flat lakes): a ring
// buffer of ripples (bodies wading, boards carving, splashes, rain of shell casings) that
// every water shader sums into its normal, plus the oasis pool shading: depth colour
// (clear turquoise shallows over the sand, deep teal), wandering sun caustics on the bed,
// fresnel sky, crisp pixel sun glints and shore / crest foam, all on the 16 texel / m grid.
import * as THREE from 'three';
import { globalUniforms, ATMO } from '../../engine/render/VoxelMaterial';

const N = 24;
export const RIPPLES = { value: Array.from({ length: N }, () => new THREE.Vector4(0, 0, -99, 0)) };
let head = 0;

/** start a ripple ring at (x, z): strength 0.2 (a step) .. 2 (a body crashing in) */
export function addRipple(x: number, z: number, strength = 0.5) {
  const r = RIPPLES.value[head];
  r.set(x, z, globalUniforms.uTime.value, strength);
  head = (head + 1) % N;
}

/** CPU twin of the shader's ripple height (for buoyant props) */
export function rippleHeight(x: number, z: number) {
  const t = globalUniforms.uTime.value;
  let h = 0;
  for (const r of RIPPLES.value) {
    if (r.w <= 0) continue;
    const age = t - r.z;
    if (age < 0 || age > 3.2) continue;
    const d = Math.hypot(x - r.x, z - r.y);
    const u = d - age * 1.6;
    h += Math.sin(u * 9) * r.w * Math.exp(-age * 1.3) * Math.exp(-u * u * 3) / (1 + d * 0.6);
  }
  return h * 0.06;
}

export const RIPPLE_GLSL = /* glsl */ `
uniform vec4 uRipples[${N}];
// summed ripple rings: x height, yz gradient
vec3 ripples(vec2 p, float t) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${N}; i++) {
    vec4 r = uRipples[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 3.2) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 1e-4;
    float x = dist - age * 1.6;
    float env = r.w * exp(-age * 1.3) * exp(-x * x * 3.0) / (1.0 + dist * 0.6);
    acc.x += sin(x * 9.0) * env;
    acc.yz += d / dist * cos(x * 9.0) * 9.0 * env;
  }
  return acc;
}
// sun caustics: two warped wave webs, bright where both cross
float caustic(vec2 p, float t) {
  vec2 q = p;
  q += vec2(sin(q.y * 1.7 + t * 0.9), sin(q.x * 1.9 - t * 0.7)) * 0.55;
  q += vec2(sin(q.y * 2.3 - t * 1.1), sin(q.x * 2.1 + t * 0.8)) * 0.35;
  float v = sin(q.x * 2.6) + sin(q.y * 2.6);
  return pow(1.0 - abs(v) * 0.5, 7.0);
}
`;

export const POOL_VERT = /* glsl */ `
attribute float aDepth;
varying vec3 vW;
varying float vD;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vD = aDepth; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;

export const POOL_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunDir, uSunCol;
varying vec3 vW;
varying float vD;
#include <fog_pars_fragment>
${RIPPLE_GLSL}
float h12(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  if (vD < 0.0) discard;
  vec2 px = floor(vW.xz * 16.0) / 16.0;
  // a light wind chop (two travelling trains) plus every live ripple ring
  vec2 g = vec2(cos(px.x * 1.3 + px.y * 0.4 + uTime * 1.2) * 0.045 + cos(px.x * 3.1 - px.y * 1.7 + uTime * 2.1) * 0.03,
                cos(px.y * 1.1 - px.x * 0.3 - uTime * 0.9) * 0.045 + cos(px.y * 2.7 + px.x * 1.9 + uTime * 1.7) * 0.03);
  vec3 rp = ripples(px, uTime);
  g += rp.yz * 0.055;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float depth = clamp(vD, 0.0, 2.4);
  float dk = 1.0 - exp(-depth * 1.7);
  vec3 col = mix(uShallow, uDeep, dk);
  // caustics dance on the shallow bed, bent by the surface
  vec2 cp = px * 1.5 + n.xz * 1.2;
  float caus = max(caustic(cp, uTime * 0.8), caustic(cp * 1.37 + 3.1, -uTime * 0.6) * 0.7);
  caus = floor(caus * 4.0 + 0.5) / 4.0;
  col += uSunCol * caus * (1.0 - dk) * 0.6;
  vec3 V = normalize(cameraPosition - vW);
  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col = mix(col, uSky, min(0.9, fr * 0.9 + 0.08));
  // crisp sun glints off the facets
  vec3 H = normalize(V + uSunDir);
  float sp = pow(max(dot(n, H), 0.0), 260.0);
  col += uSunCol * (step(0.35, sp) * 0.9 + sp * 0.5);
  // shoreline foam (ragged pixel rim) and white crests on strong ripples
  float fn = h12(floor(vW.xz * 16.0));
  float foam = vD < 0.035 + fn * 0.05 ? 1.0 : (vD < 0.1 + fn * 0.05 && fract(g.x * 40.0) > 0.5 ? 0.45 : 0.0);
  foam = max(foam, step(0.16 + fn * 0.12, rp.x) * 0.8);
  col = mix(col, vec3(0.94, 0.97, 0.95), foam);
  float a = mix(0.3, 0.93, dk);
  a = max(a, fr * 0.85);
  gl_FragColor = vec4(col, max(a, foam * 0.9));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

/** uniforms for a pool / lake material */
export function waterUniforms(sky: THREE.Color) {
  return {
    uTime: globalUniforms.uTime,
    uRipples: RIPPLES,
    uDeep: { value: new THREE.Color(0x0f5a68) },
    uShallow: { value: new THREE.Color(0x6fd8c8) },
    uSky: { value: sky },
    uSunDir: { value: ATMO.sunDir },
    uSunCol: { value: ATMO.sunColor },
  };
}
