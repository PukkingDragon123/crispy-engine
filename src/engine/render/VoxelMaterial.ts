// Shared PBR-ish material for all voxel geometry. Extends MeshStandardMaterial
// with: per-vertex emission & metalness (matx attribute), per-instance FX
// (hit flash, dissolve-into-sand, emissive boost) and optional wind sway.

import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uRim: { value: 0.1 },
  uSandColor: { value: new THREE.Color(0xe0b77a) },
  /**
   * World look, written by Env around its own scene's render (0 for every other
   * render: menus, the hub, card / icon captures keep their approved look).
   * x: on, y: sun rim strength, z: sand bounce strength, w: sky rim strength
   */
  uLook: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** world-space direction toward the sun */
  uSunDirW: { value: new THREE.Vector3(0.4, 0.6, 0.5).normalize() },
  /** sun radiance (linear, includes intensity) */
  uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
  /** warm light thrown up by the sunlit sand (linear radiance) */
  uBounceCol: { value: new THREE.Color(0.4, 0.28, 0.16) },
};

/**
 * Shared atmosphere state. `u` is a mat4 handed by reference to every built-in
 * material (see the ShaderLib patch below) so one write per frame reaches them all:
 *  [0..3]   sun direction xyz, sun glow (Mie) strength
 *  [4..7]   sunward haze colour (linear rgb), height falloff of the haze (1/m)
 *  [8..11]  wind direction xz, ground-dust layer thickness (m), dust density
 *  [12..15] time, haze base height (m), spare, 1 while an Env scene renders
 * Away from the sun the haze is the scene fog colour.
 */
export const ATMO = {
  u: new Float32Array(16),
  /** the scene whose Env drives the atmosphere (post effects only run for it) */
  scene: null as THREE.Scene | null,
  sunDir: new THREE.Vector3(0, 1, 0),
  /** linear sun colour for shafts / glare */
  sunColor: new THREE.Color(1, 0.85, 0.65),
  /** 0..1 post sun-shaft strength */
  shafts: 0.45,
};

/** haze colour along a view ray: cool sky haze away from the sun, warm forward-scattered glow toward it */
export const ATMO_HAZE_GLSL = /* glsl */ `
vec3 atmoHaze(vec3 rd, vec3 awayCol) {
  float mu = dot(rd, uAtmo[0].xyz);
  float w = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(awayCol, uAtmo[1].xyz, w * w * (3.0 - 2.0 * w));
  c += uAtmo[1].xyz * pow(max(mu, 0.0), 10.0) * uAtmo[0].w * 0.35;
  return c;
}`;

// --- global fog upgrade: aerial perspective + height haze + drifting ground dust ---------
// Materials keep the stock linear fog unless an Env-lit scene is rendering (uAtmo[3].w).
THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  #ifndef FOG_EXP2
    varying vec3 vFogWorld;
  #endif
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifndef FOG_EXP2
    vFogWorld = cameraPosition + ( mvPosition.xyz * mat3( viewMatrix ) );
  #endif
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
    uniform mat4 uAtmo;
    varying vec3 vFogWorld;
    ${ATMO_HAZE_GLSL}
    float atmoH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float atmoN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(atmoH(i), atmoH(i + vec2(1.0, 0.0)), f.x), mix(atmoH(i + vec2(0.0, 1.0)), atmoH(i + vec2(1.0, 1.0)), f.x), f.y); }
    // mean of exp(-k y) along the ray between heights y0 and y1 (analytic height-fog integral)
    float atmoMean(float k, float y0, float y1) {
      float dy = y1 - y0;
      float e1 = exp(-k * y1);
      return abs(dy) > 0.05 ? (exp(-k * y0) - e1) / (k * dy) : e1;
    }
    vec3 atmoApply(vec3 col) {
      vec3 ray = vFogWorld - cameraPosition;
      float dist = length(ray);
      vec3 rd = ray / max(dist, 1e-3);
      float base = uAtmo[3].y;
      float y0 = max(cameraPosition.y - base, -3.0), y1 = max(vFogWorld.y - base, -3.0);
      // aerial perspective: thicker low down, thinning with altitude (mesa tops stand out of it)
      float hm = clamp(atmoMean(uAtmo[1].w, y0, y1), 0.0, 3.0);
      float x = max(dist - fogNear, 0.0) / max(fogFar - fogNear, 1.0);
      float odA = x * (0.3 + 1.35 * hm);
      // low dust: pools in the troughs and drifts downwind in slow patches
      float L = min(dist, 240.0);
      vec2 mp = cameraPosition.xz + rd.xz * L * 0.5;
      vec2 wd = uAtmo[2].xy;
      float t = uAtmo[3].x;
      float n = atmoN(mp * 0.018 - wd * t * 0.55) * 0.62 + atmoN(mp * 0.061 - wd * t * 1.6 + 7.3) * 0.38;
      float dm = clamp(atmoMean(1.0 / max(uAtmo[2].z, 0.2), y0, y1), 0.0, 3.0);
      float odD = uAtmo[2].w * dm * (0.25 + 1.25 * n * n) * (L / 240.0) * smoothstep(5.0, 55.0, dist);
      vec3 hz = atmoHaze(rd, fogColor);
      col = mix(col, hz, 1.0 - exp(-odA));
      vec3 dust = mix(fogColor, uAtmo[1].xyz, 0.55) * vec3(1.03, 0.95, 0.84);
      return mix(col, dust, 1.0 - exp(-odD));
    }
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #else
    if ( uAtmo[3].w > 0.5 ) gl_FragColor.rgb = atmoApply( gl_FragColor.rgb );
    else gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( fogNear, fogFar, vFogDepth ) );
  #endif
#endif`;
// every built-in material gets the shared array by reference (UniformsUtils.clone keeps typed arrays)
for (const k of ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'dashed', 'sprite'] as const) {
  const sl = (THREE.ShaderLib as any)[k];
  if (sl) sl.uniforms.uAtmo = { value: ATMO.u };
}
/** uniforms a custom ShaderMaterial needs to use the fog chunks with the atmosphere */
export function atmoFogUniforms() {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uAtmo: { value: ATMO.u } };
}

export interface VoxelMaterialOptions {
  roughness?: number;
  emissiveStrength?: number;
  sway?: number; // wind sway amplitude for foliage/cloth (meters at 1m height)
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  fog?: boolean;
}

export type VoxelMaterial = THREE.MeshStandardMaterial & {
  userData: { fx: { value: THREE.Vector4 }; tint: { value: THREE.Color }; emissiveStrength: { value: number } };
};

/**
 * Anime cel shading for any MeshStandard-based shader: a two-tone sun ramp with
 * a soft terminator and crisp shadow edges. Ambient (IBL + hemisphere) is left
 * smooth so the shade tone keeps the sky's colour.
 */
const CEL_FUNCS = /* glsl */ `
float celRamp(float x){ return smoothstep(0.0, 0.09, x) * 0.84 + smoothstep(0.5, 0.64, x) * 0.16; }
// crisp shadow edges up close, softer with distance (painted far field, no hard frustum seam)
float celShadow(float s){ float w = mix(0.1, 0.42, smoothstep(14.0, 70.0, length(vViewPosition))); return smoothstep(0.5 - w, 0.5 + w, s); }
#ifndef CEL_SHADOW_HOOK
#define CEL_SHADOW_HOOK(s) (s)
#endif
`;
const SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
export const CEL = { enabled: true };
/**
 * Cel-shade a MeshStandard-based shader. A material may `#define CEL_SHADOW_HOOK(s)`
 * (before the lights chunk) to blend its own shadow term into the sun shadow.
 */
export function celify(shader: { fragmentShader: string }) {
  if (!CEL.enabled) return;
  const lp = THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = celRamp( dotNL ) * directLight.color;');
  const lb = THREE.ShaderChunk.lights_fragment_begin.replace(SHADOW_LINE, SHADOW_LINE.replace('? getShadow(', '? celShadow( CEL_SHADOW_HOOK( getShadow(').replace(' : 1.0;', ' ) ) : 1.0;'));
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', CEL_FUNCS + lp).replace('#include <lights_fragment_begin>', lb);
}

export function makeVoxelMaterial(o: VoxelMaterialOptions = {}): VoxelMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: o.roughness ?? 0.92,
    metalness: 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    fog: o.fog ?? true,
  }) as VoxelMaterial;
  const fx = { value: new THREE.Vector4(0, 0, 0, 0) }; // x flash, y dissolve, z emissive boost, w tintAmount
  const tint = { value: new THREE.Color(1, 1, 1) };
  const emissiveStrength = { value: o.emissiveStrength ?? 1.0 };
  const sway = o.sway ?? 0;
  m.userData = { fx, tint, emissiveStrength } as any;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFx = fx;
    shader.uniforms.uTint = tint;
    shader.uniforms.uEmissiveStrength = emissiveStrength;
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uRim = globalUniforms.uRim;
    shader.uniforms.uLook = globalUniforms.uLook;
    shader.uniforms.uSunDirW = globalUniforms.uSunDirW;
    shader.uniforms.uSunCol = globalUniforms.uSunCol;
    shader.uniforms.uBounceCol = globalUniforms.uBounceCol;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 matx;
        varying vec2 vMatx;
        varying vec4 vFx;
        varying vec3 vWPos;
        varying vec3 vInstTint;
        uniform vec4 uFx;
        uniform float uTime;
        #ifdef USE_INSTANCING
          attribute vec4 instFx;
        #endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vMatx = matx;
        #ifdef USE_INSTANCING
          vFx = instFx + uFx;
        #else
          vFx = uFx;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vInstTint = instanceColor;
        #else
          vInstTint = vec3(1.0);
        #endif
        ${
          sway > 0
            ? `{
            vec4 wpp = modelMatrix * vec4(transformed, 1.0);
            float hgt = max(0.0, transformed.y);
            float s = sin(uTime * 1.7 + wpp.x * 0.35 + wpp.z * 0.21) + 0.5 * sin(uTime * 3.1 + wpp.z * 0.6);
            transformed.x += s * ${sway.toFixed(3)} * hgt * hgt;
            transformed.z += s * ${(sway * 0.6).toFixed(3)} * hgt * hgt;
          }`
            : ''
        }`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4;
          #endif
          vWPos = (modelMatrix * wp4).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vMatx;
        varying vec4 vFx;
        varying vec3 vWPos;
        varying vec3 vInstTint;
        uniform float uEmissiveStrength;
        uniform float uRim;
        uniform vec4 uLook;
        uniform vec3 uSunDirW, uSunCol, uBounceCol;
        uniform vec3 uTint;
        float vhash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float dissolveEdge = 0.0;
        if (vFx.y > 0.001) {
          float hn = vhash(floor(vWPos * 16.0));
          float th = vFx.y * 1.08;
          if (hn < th - 0.04) discard;
          dissolveEdge = 1.0 - smoothstep(0.0, 0.08, hn - th + 0.04);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= uTint;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(vFx.x, 0.0, 1.0));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, vMatx.y);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = vMatx.y * 0.75;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * (1.0 + vFx.z));
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * clamp(vFx.x, 0.0, 1.0) * 0.6;
        totalEmissiveRadiance += vec3(1.0, 0.55, 0.15) * dissolveEdge * 1.2;
        {
          vec3 vdir = normalize(vViewPosition);
          float fres = 1.0 - clamp(dot(normal, vdir), 0.0, 1.0);
          if (uLook.x > 0.5) {
            // anime rim light: a crisp band on the sun side of the silhouette, strongest when back-lit
            vec3 sv = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
            float sl = length(sv.xy);
            float side = sl > 1e-3 ? dot(normalize(normal.xy + vec2(1e-5)), sv.xy / sl) : 0.0;
            float back = clamp(0.5 - sv.z * 0.5, 0.0, 1.0);
            float band = smoothstep(0.5, 0.64, fres) * smoothstep(-0.05, 0.4, side);
            totalEmissiveRadiance += diffuseColor.rgb * uSunCol * band * (0.18 + 0.82 * back * back) * uLook.y;
            // cool sky rim on the shade side keeps dark silhouettes readable
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.42, 0.55, 0.85) * smoothstep(0.58, 0.8, fres) * (1.0 - smoothstep(-0.35, 0.15, side)) * uLook.w;
            // warm bounce from the sunlit sand onto undersides (chins, hat brims, bellies)
            vec3 nW = (vec4(normal, 0.0) * viewMatrix).xyz;
            float under = clamp(0.42 - nW.y * 0.58, 0.0, 1.0);
            totalEmissiveRadiance += diffuseColor.rgb * uBounceCol * under * under * uLook.z;
          } else {
            // pixel-art style warm rim light: separates silhouettes from the sand
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.82, 0.58) * pow(fres, 3.0) * uRim;
          }
        }`
      );
    celify(shader);
  };
  m.customProgramCacheKey = () => 'voxel-mat-v4look-' + sway.toFixed(3);
  m.envMapIntensity = 1.0;
  return m;
}

/** Material for instanced meshes (adds instFx attribute expectation). Same shader. */
export const sharedVoxelMaterial = makeVoxelMaterial();
export const sharedFoliageMaterial = makeVoxelMaterial({ sway: 0.05 });

/** Ensure an instanced mesh has an instFx attribute */
export function ensureInstFx(mesh: THREE.InstancedMesh) {
  const g = mesh.geometry;
  if (!g.getAttribute('instFx')) {
    const arr = new Float32Array(mesh.instanceMatrix.count * 4);
    const attr = new THREE.InstancedBufferAttribute(arr, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('instFx', attr);
  }
  return g.getAttribute('instFx') as THREE.InstancedBufferAttribute;
}
