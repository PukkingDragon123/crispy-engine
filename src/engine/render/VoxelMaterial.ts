// Shared PBR-ish material for all voxel geometry. Extends MeshStandardMaterial
// with: per-vertex emission & metalness (matx attribute), per-instance FX
// (hit flash, dissolve-into-sand, emissive boost) and optional wind sway.

import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uRim: { value: 0.1 },
  uSandColor: { value: new THREE.Color(0xe0b77a) },
};

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
float celShadow(float s){ return smoothstep(0.4, 0.6, s); }
`;
const SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
export const CEL = { enabled: true };
export function celify(shader: { fragmentShader: string }) {
  if (!CEL.enabled) return;
  const lp = THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = celRamp( dotNL ) * directLight.color;');
  const lb = THREE.ShaderChunk.lights_fragment_begin.replace(SHADOW_LINE, SHADOW_LINE.replace('? getShadow(', '? celShadow( getShadow(').replace(' : 1.0;', ' ) : 1.0;'));
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
          // pixel-art style warm rim light: separates silhouettes from the sand
          vec3 vdir = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.82, 0.58) * rim * uRim;
        }`
      );
    celify(shader);
  };
  m.customProgramCacheKey = () => 'voxel-mat-v3cel-' + sway.toFixed(3);
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
