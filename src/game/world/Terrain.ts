// Voxel-column terrain renderer: 32 m chunks with 4 LODs, quantized column
// heights, per-corner AO, strata-painted cliffs and a texel-detail shader
// (wind ripples, sand sparkle, tile grout, rock strata lines).
import * as THREE from 'three';
import { Heightfield, MAT } from './Heightfield';
import { noise, hash2, clamp, Noise, smoothstep } from '../../engine/math/rand';
import { globalUniforms, celify } from '../../engine/render/VoxelMaterial';
import type { HeightTex } from './Env';
import { SandWaves, SAND_GLSL, SAND_MAX } from './SandWaves';
import { pixelAtlas, PIXEL_GLSL, PX } from './PixelTex';

const CHUNK = 32;
/** GPU heightfield texel (m) */
const HF_CELL = 2;
// near field: 12.5 cm sand columns (much higher voxel count), coarser rings outward
const LOD_CELL = [0.125, 0.25, 0.5, 1, 2, 4];
const LOD_STEP = [0.0625, 0.125, 0.25, 0.5, 1, 2];
const LOD_DIST = [32, 64, 110, 172, 262, 384];
/** hard ground (rock, flagstones, turf, dirt, mud) is built of big blocks this wide in the near rings */
const BLOCK_M = 0.5;
const BLOCK_MATS = new Set<number>([MAT.ROCK, MAT.DARK_ROCK, MAT.TILE, MAT.DIRT, MAT.GRASS, MAT.MUD]);

// sRGB palette per material: [top A, top B, side]
const MATCOL: Record<number, [number, number, number]> = {
  [MAT.SAND]: [0xedc68a, 0xe0b06e, 0xc99a5d],
  [MAT.SAND_DARK]: [0xd8a86a, 0xcc9a5c, 0xb78550],
  [MAT.RED_SAND]: [0xe0a46c, 0xd4935e, 0xb8784a],
  [MAT.ROCK]: [0xc79568, 0xb07e55, 0xa0704a],
  [MAT.DARK_ROCK]: [0x8a7a6a, 0x766858, 0x5f5246],
  [MAT.TILE]: [0xf0d9aa, 0xe2c590, 0xc9a874],
  [MAT.DIRT]: [0xb88a5c, 0xa77a4f, 0x8f6643],
  [MAT.GRASS]: [0x8db04e, 0x76a043, 0x8a6a45],
  [MAT.MUD]: [0x7e6446, 0x6e563b, 0x5e4931],
  [MAT.BONE]: [0xf0e3c6, 0xe1d0ab, 0xcdb88e],
  [MAT.GOLD]: [0xf3c24a, 0xdca832, 0xb98522],
  [MAT.CRYSTAL]: [0xc77df0, 0xa860d6, 0x8445b0],
};
const STRATA = [0xe2bd8f, 0xc99a6c, 0xb5835a, 0xd6aa7c, 0x9e6c48, 0xc08d62, 0x8a5a3c, 0xd0a374];

const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function toLin(hex: number, f: number, out: number[], o: number) {
  out[o] = clamp(lin[(hex >> 16) & 255] * f, 0, 1);
  out[o + 1] = clamp(lin[(hex >> 8) & 255] * f, 0, 1);
  out[o + 2] = clamp(lin[hex & 255] * f, 0, 1);
}

const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blackTex.needsUpdate = true;

const NO_SAND = new SandWaves();

/** shared vertex-stage injection: living-sand displacement (+ tilted top normals) */
function sandVertex(sh: THREE.WebGLProgramParametersWithUniforms, sand: SandWaves, normals: boolean) {
  sh.uniforms.uSWA = sand.uA;
  sh.uniforms.uSWB = sand.uB;
  sh.uniforms.uSWN = sand.uN;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
${SAND_GLSL}`);
  if (normals)
    sh.vertexShader = sh.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      float swH = 0.0;
      if (uSWN > 0) {
        vec3 swp = (modelMatrix * vec4(position, 1.0)).xyz;
        swH = sandWave(swp.xz);
        if (objectNormal.y > 0.5) {
          float e = 0.4;
          float gx = (sandWave(swp.xz + vec2(e, 0.0)) - sandWave(swp.xz - vec2(e, 0.0))) / (2.0 * e);
          float gz = (sandWave(swp.xz + vec2(0.0, e)) - sandWave(swp.xz - vec2(0.0, e))) / (2.0 * e);
          vec3 nn = objectNormal / max(objectNormal.y, 0.2);
          objectNormal = normalize(vec3(nn.x - gx, 1.0, nn.z - gz));
        }
      }`
    );
  sh.vertexShader = sh.vertexShader.replace(
    '#include <begin_vertex>',
    normals
      ? `#include <begin_vertex>
      transformed.y += swH;`
      : `#include <begin_vertex>
      if (uSWN > 0) transformed.y += sandWave((modelMatrix * vec4(position, 1.0)).xz);`
  );
}

/** shadow caster twin so sand waves throw the right shadow */
export function makeTerrainDepthMaterial(sand: SandWaves) {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (sh) => sandVertex(sh, sand, false);
  m.customProgramCacheKey = () => 'terrain-depth-sw' + SAND_MAX;
  return m;
}

const blackHF = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
blackHF.needsUpdate = true;

export function makeTerrainMaterial(wind: { x: number; z: number }, sand: SandWaves = NO_SAND) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const uWind = { value: new THREE.Vector2(wind.x, wind.z) };
  const uMarks = { value: blackTex as THREE.Texture };
  const uMarkArea = { value: 256 };
  const uMarkClock = { value: 0 };
  /** coarse heightfield (far dune shadows, crest / trough colour) */
  const uHF = { value: blackHF as THREE.Texture };
  const uHFInfo = { value: new THREE.Vector4(0, 0, 1, 0) };
  /** sun shadow-map coverage: centre xz, radius; beyond it the heightfield casts the shadows */
  const uShC = { value: new THREE.Vector4(0, 0, 40, 0) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = uWind;
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uMarks = uMarks;
    sh.uniforms.uMarkArea = uMarkArea;
    sh.uniforms.uMarkClock = uMarkClock;
    sh.uniforms.uHF = uHF;
    sh.uniforms.uHFInfo = uHFInfo;
    sh.uniforms.uShC = uShC;
    sh.uniforms.uSunDirW = globalUniforms.uSunDirW;
    sh.uniforms.uLook = globalUniforms.uLook;
    sh.uniforms.uPxTex = { value: pixelAtlas() };
    sandVertex(sh, sand, true);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 tm;
        varying vec2 vTM;
        varying vec3 vWP;
        varying vec3 vWN;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTM = tm;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec2 uWind;
        uniform float uTime;
        uniform sampler2D uMarks;
        uniform float uMarkArea, uMarkClock;
        uniform sampler2D uHF;
        uniform vec4 uHFInfo, uShC, uLook;
        uniform vec3 uSunDirW;
        varying vec2 vTM;
        varying vec3 vWP;
        varying vec3 vWN;
        ${PIXEL_GLSL}
        vec3 sandBump = vec3(0.0);
        // far field: the heightfield casts the dune shadows the shadow map cannot reach
        float tFarSh = 1.0;
        float tMapW = 1.0;
        #define CEL_SHADOW_HOOK(s) mix(tFarSh, (s), tMapW)
        float th(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y); }
        float trk(vec2 p){ float r = texture2D(uMarks, fract(p / uMarkArea)).r; return r > 0.0 ? 1.0 - smoothstep(22.0, 48.0, uMarkClock - r) : 0.0; }
        float hfAt(vec2 xz){ return texture2D(uHF, xz * uHFInfo.x + uHFInfo.y).r; }
        // soft shadow marched over the heightfield toward the sun (penumbra widens with distance)
        float farShadow(vec3 p, vec3 L) {
          float res = 1.0;
          float t = 1.6;
          p.y = max(p.y, hfAt(p.xz)) + 0.35;
          for (int i = 0; i < 16; i++) {
            vec3 q = p + L * t;
            float dh = q.y - hfAt(q.xz);
            res = min(res, 5.0 * dh / t + 0.5);
            if (res < 0.0) break;
            t *= 1.33;
          }
          return smoothstep(0.0, 1.0, res);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sparkle = 0.0;
        {
          float dC = distance(vWP.xz, uShC.xy);
          tMapW = uShC.w > 0.5 ? 1.0 - smoothstep(uShC.z * 0.6, uShC.z * 0.92, dC) : 1.0;
          if (tMapW < 0.999 && uHFInfo.w > 0.5 && uSunDirW.y > 0.03) tFarSh = farShadow(vWP + vWN * 0.3, uSunDirW);
        }
        {
          vec3 an = abs(vWN);
          bool top = an.y > 0.6;
          vec2 tp = top ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy);
          vec2 px = floor(tp * 16.0);
          float h1 = th(px + vec2(vTM.x * 17.0, 3.0));
          float m = floor(vTM.x + 0.5);
          // near field: big blocks with pixel-art material textures (fade to the painted far look)
          float pxK = (1.0 - smoothstep(42.0, 74.0, distance(vWP, cameraPosition))) * step(m, 8.5);
          float jit = (h1 - 0.5) * 0.11 * (1.0 - 0.75 * pxK);
          if (m <= 2.0 || m == 6.0) {
            if (top) {
              float camD = distance(vWP, cameraPosition);
              // wind ripples: asymmetric (gentle windward, steep lee) bands that catch the low sun,
              // creeping slowly downwind
              vec2 wd = normalize(uWind + vec2(1e-4));
              // slipfaces (steep lee faces) are smooth avalanche sand: no ripples, grain-flow streaks instead
              float lee = smoothstep(0.1, 0.32, dot(vWN.xz, wd)) * smoothstep(0.12, 0.34, 1.0 - vWN.y);
              vec2 pw = vec2(dot(vWP.xz, wd), dot(vWP.xz, vec2(-wd.y, wd.x)));
              float ph = pw.x * 2.6 + sin(pw.y * 0.31 + th(floor(vWP.xz * 0.05)) * 6.0) * 1.3 - uTime * 0.11;
              float rf = fract(ph);
              float dh = rf < 0.72 ? 1.0 / 0.72 : -1.0 / 0.28;
              float fade = smoothstep(48.0, 8.0, camD) * (1.0 - lee);
              vec2 g = wd * dh * 2.6 * 0.012 * fade;
              sandBump = vec3(-g.x, 0.0, -g.y);
              jit += (rf > 0.72 ? -0.05 : (rf < 0.12 ? 0.03 : 0.0)) * fade;
              // mega-ripples: long sand waves that keep the far dunes detailed
              float ph2 = pw.x * 0.36 + sin(pw.y * 0.045 + th(floor(vWP.xz * 0.012)) * 6.0) * 2.2 - uTime * 0.02;
              float rf2 = fract(ph2);
              float far = smoothstep(220.0, 26.0, camD) * smoothstep(4.0, 18.0, camD) * (1.0 - lee * 0.85);
              float dh2 = rf2 < 0.78 ? 1.0 / 0.78 : -1.0 / 0.22;
              vec2 g2 = wd * dh2 * 0.36 * 0.22 * far;
              sandBump += vec3(-g2.x, 0.0, -g2.y);
              jit += (rf2 > 0.78 ? -0.045 : (rf2 < 0.1 ? 0.025 : 0.0)) * far;
              if (lee > 0.01) {
                vec2 dn = normalize(vWN.xz + vec2(1e-4));
                vec2 q16 = floor(vWP.xz * 16.0) / 16.0;
                float across = dot(q16, vec2(-dn.y, dn.x));
                float along = dot(q16, dn);
                float gf = vn(vec2(across * 2.2, along * 0.16 + th(vec2(floor(across * 2.2), 5.0)) * 3.0));
                float gfFade = smoothstep(90.0, 6.0, camD);
                jit += ((gf > 0.66 ? -0.07 : (gf < 0.22 ? 0.045 : 0.0)) * gfFade - 0.035) * lee;
              }
              // grain: three-tone speckle at 32 px / m, a finer 64 px / m layer up close
              float gr = th(floor(vWP.xz * 32.0));
              jit += gr > 0.93 ? 0.06 : (gr < 0.07 ? -0.07 : 0.0);
              float gr2 = th(floor(vWP.xz * 64.0) + 7.0);
              jit += (gr2 > 0.95 ? 0.05 : (gr2 < 0.05 ? -0.05 : 0.0)) * smoothstep(14.0, 4.0, camD);
              // saltation: thin pixel wisps of sand skimming downwind, gusting in patches
              float sf = smoothstep(85.0, 6.0, camD);
              if (sf > 0.0) {
                vec2 qp = floor(vWP.xz * 16.0) / 16.0;
                vec2 qw = vec2(dot(qp, wd), dot(qp, vec2(-wd.y, wd.x)));
                vec2 sp = vec2(qw.x * 0.42 - uTime * 2.7, qw.y * 2.1);
                float s1 = vn(sp) * 0.6 + vn(sp * 2.3 + vec2(11.7 - uTime * 1.4, 3.1)) * 0.4;
                float gust = vn(vec2(qw.x * 0.035 - uTime * 0.4, qw.y * 0.06));
                float streak = smoothstep(0.6, 0.84, s1) * smoothstep(0.32, 0.72, gust) * sf;
                jit += streak * 0.09;
                sparkle += streak * step(0.982, th(px * 0.73 + floor(uTime * 12.0)));
              }
              vec2 q = floor(vWP.xz * 16.0) / 16.0;
              float rp = fract(dot(q, uWind) * 1.25 + th(floor(vWP.xz * 0.35)) * 0.45 + sin(dot(q, vec2(-uWind.y, uWind.x)) * 0.6) * 0.25);
              jit += rp < 0.3 ? -0.055 : (rp < 0.42 ? 0.035 : 0.0);
              float s = th(px * 1.37 + floor(uTime * 3.0 + h1 * 7.0));
              sparkle = step(0.9992, s) * step(0.5, h1) * smoothstep(30.0, 6.0, distance(vWP, cameraPosition));
            } else {
              jit += (fract(vWP.y * 4.0) < 0.25 ? -0.04 : 0.0);
            }
          } else if (m == 3.0 || m == 4.0) {
            float band = fract(vWP.y * 0.9 + th(floor(vWP.xz * 0.2)) * 0.3);
            jit += band < 0.08 ? -0.12 : (band > 0.92 ? 0.06 : 0.0);
            if (!top) { float cr = th(floor(vec2(tp.x * 2.0, vWP.y * 0.5))); jit += cr > 0.93 ? -0.15 : 0.0; }
          } else if (m == 5.0 && pxK < 0.99) {
            vec2 g = fract(vWP.xz * 0.5 + 0.02);
            vec2 g2 = fract(vec2(vWP.x * 0.5 + floor(vWP.z * 0.5) * 0.5, vWP.z * 0.5));
            if (top && (g.y < 0.05 || g2.x < 0.04)) jit -= 0.2;
            if (!top && fract(vWP.y * 2.0) < 0.07) jit -= 0.18;
          } else if (m == 7.0) {
            jit += (h1 > 0.75 ? 0.08 : 0.0) - (h1 < 0.15 ? 0.1 : 0.0);
          }
          // dune colour: bleached dry crests, damp darker troughs, warm / cool sand fields
          if ((m <= 2.0 || m == 6.0) && uHFInfo.w > 0.5) {
            vec2 xz = vWP.xz;
            float hc = hfAt(xz);
            float hA = (hfAt(xz + vec2(10.0, 0.0)) + hfAt(xz - vec2(10.0, 0.0)) + hfAt(xz + vec2(0.0, 10.0)) + hfAt(xz - vec2(0.0, 10.0))) * 0.25;
            float cv = clamp((hc - hA) * 0.42, -1.0, 1.0);
            vec3 tint = mix(vec3(1.0), vec3(1.06, 1.035, 0.96), smoothstep(0.05, 0.8, cv));
            tint *= mix(vec3(1.0), vec3(0.87, 0.83, 0.82), smoothstep(-0.05, -0.9, cv));
            float wc = vn(xz * 0.0045 + 3.7) * 0.65 + vn(xz * 0.013 - 1.3) * 0.35;
            tint *= mix(vec3(0.97, 0.985, 1.03), vec3(1.035, 0.99, 0.94), smoothstep(0.3, 0.7, wc));
            diffuseColor.rgb *= tint;
          }
          if (pxK > 0.001) {
            // the face's true orientation (sand sides carry the dune normal for lighting)
            vec3 gn = normalize(cross(dFdx(vWP), dFdy(vWP)));
            bool gTop = abs(gn.y) > 0.6;
            vec2 puv = pxUV(vWP, gn);
            float layer = ${PX.MUD}.0, amt = 1.0;
            if (m == 0.0 || m == 2.0) { layer = gTop ? ${PX.SAND}.0 : ${PX.SAND_SIDE}.0; amt = 0.72; }
            else if (m == 1.0) { layer = gTop ? ${PX.PACKED}.0 : ${PX.SAND_SIDE}.0; amt = 0.85; }
            else if (m == 3.0 || m == 4.0) layer = gTop ? ${PX.ROCK_TOP}.0 : ${PX.ROCK_SIDE}.0;
            else if (m == 5.0) layer = gTop ? ${PX.TILE_TOP}.0 : ${PX.TILE_SIDE}.0;
            else if (m == 6.0) layer = gTop ? ${PX.DIRT_TOP}.0 : ${PX.DIRT_SIDE}.0;
            else if (m == 7.0) layer = gTop ? ${PX.GRASS_TOP}.0 : ${PX.GRASS_SIDE}.0;
            diffuseColor.rgb *= mix(vec3(1.0), pxSample(puv, layer), pxK * amt);
            if (m == 7.0 && !gTop) {
              // turf hanging over the block edge: a ragged pixel fringe, the blade tips a shade darker
              float tx = floor(puv.x * 128.0);
              float fl = (2.0 + floor(th(vec2(tx, 3.0)) * 3.0) + step(0.82, th(vec2(tx, 9.0))) * 3.0) / 32.0;
              float dT = vTM.y / 64.0;
              if (dT < fl) {
                float shd = dot(vColor.rgb, vec3(0.3, 0.59, 0.11)) / 0.1695;
                vec3 turf = vec3(0.223, 0.391, 0.0685) * pxSample(puv, ${PX.GRASS_TOP}.0) * shd * (dT > fl - 0.04 ? 0.72 : 1.0);
                diffuseColor.rgb = mix(diffuseColor.rgb, turf, pxK);
              }
            }
          }
          diffuseColor.rgb *= 1.0 + jit;
          // ground marks: board tracks, scorch, blood, venom (timestamps -> fade by age)
          vec4 mk = texture2D(uMarks, fract(vWP.xz / uMarkArea));
          float tf = top ? 1.0 : 0.45;
          // board tracks are carved grooves: a darker cool floor, walls that catch the
          // light, a lighter thrown-up berm along both lips; wind slowly fills them in
          {
            float e = uMarkArea / 2048.0;
            float c0 = trk(vWP.xz);
            float tl = trk(vWP.xz - vec2(e, 0.0)), tr = trk(vWP.xz + vec2(e, 0.0));
            float td = trk(vWP.xz - vec2(0.0, e)), tu = trk(vWP.xz + vec2(0.0, e));
            vec2 tg = vec2(tr - tl, tu - td);
            if (c0 > 0.0) {
              float edge = 1.0 - min(min(tl, tr), min(td, tu)) / max(c0, 1e-3);
              diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.79, 0.83), c0 * tf);
              diffuseColor.rgb *= 1.0 + 0.05 * clamp(edge, 0.0, 1.0) * c0;
              if (top) sandBump += vec3(tg.x, 0.0, tg.y) * 0.75 * c0;
            } else if (top) {
              float nb = max(max(tl, tr), max(td, tu));
              if (nb > 0.0) {
                diffuseColor.rgb *= 1.0 + 0.1 * nb;
                sandBump -= vec3(tg.x, 0.0, tg.y) * 0.5;
              }
            }
          }
          if (mk.g > 0.0) { float a = 1.0 - smoothstep(35.0, 70.0, uMarkClock - mk.g); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.27, 0.24), a * 0.85 * tf); }
          if (mk.b > 0.0) { float a = 1.0 - smoothstep(20.0, 45.0, uMarkClock - mk.b); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.03, 0.02), a * 0.75 * tf); }
          if (mk.a > 0.0) { float a = 1.0 - smoothstep(15.0, 30.0, uMarkClock - mk.a); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.5, 0.06), a * 0.7 * tf); }
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(sandBump, 0.0)).xyz);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * sparkle * 0.45;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        gl_FragColor.a = 0.0; // marks terrain for the ink pass (sand-on-sand steps get no outline)`
      );
    celify(sh);
  };
  m.customProgramCacheKey = () => 'terrain-v8px';
  (m as any).userData = { uWind, uMarks, uMarkArea, uMarkClock, uHF, uHFInfo, uShC };
  return m;
}

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh | null;
  dirty: boolean;
  builtLod: number;
}

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  private chunks = new Map<number, Chunk>();
  /** chunks holding a mesh */
  private live = new Set<Chunk>();
  private look: Chunk[] = [];
  private nC: number;
  built = 0;
  /** the chunk being meshed a few rows per frame (no hitches at high resolution) */
  private job: { c: Chunk; lod: number; it: Generator<void, THREE.BufferGeometry, void> } | null = null;

  /** coarse half-float heightfield on the GPU: far dune shadows, crest / trough colour, airborne sand */
  hf: HeightTex;
  private hfN: number;
  private hfData: Uint16Array;
  private hfDirty: number[] | null = null;
  private hfLast = 0;

  constructor(public field: Heightfield, wind: { x: number; z: number }, sand?: SandWaves) {
    this.material = makeTerrainMaterial(wind, sand);
    this.depthMaterial = makeTerrainDepthMaterial(sand ?? NO_SAND);
    this.nC = Math.ceil(field.size / CHUNK);
    for (let j = 0; j < this.nC; j++)
      for (let i = 0; i < this.nC; i++) this.chunks.set(i + j * 1000, { cx: i, cz: j, lod: -1, mesh: null, dirty: true, builtLod: -1 });
    field.onDirty.push((x0, z0, x1, z1) => this.markDirty(x0, z0, x1, z1));
    this.group.name = 'terrain';
    const n = (this.hfN = Math.ceil(field.size / HF_CELL) + 1);
    this.hfData = new Uint16Array(n * n);
    this.fillHF(0, 0, n - 1, n - 1);
    const tex = new THREE.DataTexture(this.hfData, n, n, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.hf = { tex, info: new THREE.Vector4(1 / (HF_CELL * n), 0.5 / n, HF_CELL, 1) };
    const u = (this.material as any).userData;
    u.uHF.value = tex;
    u.uHFInfo.value = this.hf.info;
    field.onDirty.push((x0, z0, x1, z1) => {
      const d = this.hfDirty;
      this.hfDirty = d ? [Math.min(d[0], x0), Math.min(d[1], z0), Math.max(d[2], x1), Math.max(d[3], z1)] : [x0, z0, x1, z1];
    });
  }

  private fillHF(i0: number, j0: number, i1: number, j1: number) {
    const n = this.hfN, f = this.field;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.hfData[i + j * n] = THREE.DataUtils.toHalfFloat(f.heightAt(i * HF_CELL, j * HF_CELL));
  }
  /** re-upload the changed part of the GPU heightfield (stamps rising, craters) a few times a second */
  private flushHF() {
    const d = this.hfDirty;
    if (!d) return;
    const now = performance.now();
    if (now - this.hfLast < 300) return;
    this.hfLast = now;
    this.hfDirty = null;
    const n = this.hfN;
    const c = (v: number) => Math.max(0, Math.min(n - 1, v));
    this.fillHF(c(Math.floor(d[0] / HF_CELL) - 1), c(Math.floor(d[1] / HF_CELL) - 1), c(Math.ceil(d[2] / HF_CELL) + 1), c(Math.ceil(d[3] / HF_CELL) + 1));
    this.hf.tex.needsUpdate = true;
  }
  /** where the sun's shadow map is valid (the heightfield shadows the rest) */
  setShadowCenter(x: number, z: number, radius: number) {
    (this.material as any).userData.uShC.value.set(x, z, radius, 1);
  }

  setMarks(tex: THREE.Texture, area: number) {
    const u = (this.material as any).userData;
    u.uMarks.value = tex;
    u.uMarkArea.value = area;
  }
  setMarkClock(t: number) {
    (this.material as any).userData.uMarkClock.value = t;
  }

  markDirty(x0: number, z0: number, x1: number, z1: number) {
    const i0 = Math.max(0, Math.floor((x0 - 2) / CHUNK)),
      i1 = Math.min(this.nC - 1, Math.floor((x1 + 2) / CHUNK));
    const j0 = Math.max(0, Math.floor((z0 - 2) / CHUNK)),
      j1 = Math.min(this.nC - 1, Math.floor((z1 + 2) / CHUNK));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = this.chunks.get(i + j * 1000)!;
        c.dirty = true;
      }
  }

  /** decide LODs around focus and rebuild within a time budget */
  update(focus: THREE.Vector3, budgetMs = 4, force = false) {
    const t0 = performance.now();
    this.flushHF();
    const want: Chunk[] = [];
    // only the chunks inside the outermost LOD ring (plus any still holding a mesh) need a look:
    // the big maps have thousands of chunks
    const reach = LOD_DIST[LOD_DIST.length - 1] + CHUNK;
    const i0 = Math.max(0, Math.floor((focus.x - reach) / CHUNK)), i1 = Math.min(this.nC - 1, Math.floor((focus.x + reach) / CHUNK));
    const j0 = Math.max(0, Math.floor((focus.z - reach) / CHUNK)), j1 = Math.min(this.nC - 1, Math.floor((focus.z + reach) / CHUNK));
    const look = this.look;
    look.length = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) look.push(this.chunks.get(i + j * 1000)!);
    for (const c of this.live) if (c.cx < i0 || c.cx > i1 || c.cz < j0 || c.cz > j1) look.push(c);
    for (const c of look) {
      const x0 = c.cx * CHUNK,
        z0 = c.cz * CHUNK;
      const dx = Math.max(x0 - focus.x, 0, focus.x - (x0 + CHUNK));
      const dz = Math.max(z0 - focus.z, 0, focus.z - (z0 + CHUNK));
      const d = Math.hypot(dx, dz);
      let lod = -1;
      for (let l = 0; l < LOD_DIST.length; l++)
        if (d < LOD_DIST[l]) {
          lod = l;
          break;
        }
      // hysteresis: keep finer lod if close to boundary
      if (c.builtLod >= 0 && lod > c.builtLod && lod >= 0 && d < LOD_DIST[c.builtLod] + 8) lod = c.builtLod;
      c.lod = lod;
      if (lod < 0) {
        if (this.job?.c === c) this.job = null;
        if (c.mesh) {
          this.group.remove(c.mesh);
          c.mesh.geometry.dispose();
          c.mesh = null;
          c.builtLod = -1;
          this.live.delete(c);
        }
        continue;
      }
      if (c.dirty || c.builtLod !== lod) want.push(c);
    }
    // nearest / finest first
    want.sort((a, b) => a.lod - b.lod || this.dist2(a, focus) - this.dist2(b, focus));
    let wi = 0;
    for (;;) {
      if (!this.job) {
        // next chunk: skip the one just finished if it is already up to date
        while (wi < want.length && !want[wi].dirty && want[wi].builtLod === want[wi].lod) wi++;
        if (wi >= want.length) break;
        const c = want[wi++];
        c.dirty = false;
        this.job = { c, lod: c.lod, it: buildChunkGeometry(this.field, c.cx * CHUNK, c.cz * CHUNK, c.lod) };
      }
      const job = this.job;
      let r = job.it.next();
      while (!r.done && (force || performance.now() - t0 < budgetMs)) r = job.it.next();
      if (!r.done) break; // out of time: resume next frame
      this.job = null;
      this.apply(job.c, job.lod, r.value);
      if (!force && performance.now() - t0 > budgetMs) break;
    }
    return want.length;
  }

  private dist2(c: Chunk, f: THREE.Vector3) {
    const x = c.cx * CHUNK + CHUNK / 2 - f.x,
      z = c.cz * CHUNK + CHUNK / 2 - f.z;
    return x * x + z * z;
  }

  /** build every chunk around focus synchronously (loading screens) */
  buildAll(focus: THREE.Vector3) {
    this.update(focus, 1e9, true);
  }

  private apply(c: Chunk, lod: number, geo: THREE.BufferGeometry) {
    if (c.lod < 0) {
      geo.dispose();
      return;
    }
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.material);
      c.mesh.receiveShadow = true;
      c.mesh.matrixAutoUpdate = false;
      c.mesh.customDepthMaterial = this.depthMaterial;
      this.group.add(c.mesh);
      this.live.add(c);
    }
    c.mesh.castShadow = lod <= 2;
    c.mesh.userData.lod = lod;
    c.builtLod = lod;
    this.built++;
  }

  dispose() {
    for (const c of this.chunks.values()) c.mesh?.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.hf.tex.dispose();
    this.group.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
/**
 * The land beyond the play area: a low-detail proxy of the heightfield (fills the
 * far field past the chunk LOD range) that runs on outside the map into a sea of
 * big transverse dunes, terraced mesas with strata cliffs and a far hazy range of
 * buttes. Lives almost entirely inside the aerial perspective, so distance reads
 * in layers.
 */
export class Backdrop {
  mesh: THREE.Mesh;
  constructor(field: Heightfield, wind: { x: number; z: number }, seed: number) {
    const S = field.size;
    const nz = new Noise(seed * 13 + 5);
    // the big maps: the outer ring stops ~800 m out (past the camera's useful range in the haze)
    const CELL = S > 1000 ? 16 : 12;
    const pad = Math.min(0.9 * S, 820);
    const x0 = -pad, x1 = S + pad;
    const N = Math.ceil((x1 - x0) / CELL) + 1;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const H = new Float32Array(N * N);
    const wl = Math.hypot(wind.x, wind.z) || 1;
    const wx = wind.x / wl, wz = wind.z / wl;
    const edgeH = (x: number, z: number) => field.heightAt(Math.max(0, Math.min(S, x)), Math.max(0, Math.min(S, z)));
    // dune sea: big wind-shaped transverse ridges with a sharp brink and a long windward back
    const dunes = (x: number, z: number) => {
      const u = x * wx + z * wz, v = -x * wz + z * wx;
      const ph = (u + nz.n2(x * 0.003, z * 0.003) * 70) / (150 + 60 * nz.n2(v * 0.002, 1.7)) + nz.n2(v * 0.006, 2.3) * 0.7;
      const t = ph - Math.floor(ph);
      const prof = t < 0.78 ? smoothstep(0, 1, t / 0.78) : 1 - smoothstep(0, 1, (t - 0.78) / 0.22);
      return prof * (12 + 9 * nz.n2(x * 0.0025 - 4, z * 0.0025 + 2)) + nz.fbm2(x / 420, z / 420, 3) * 14;
    };
    // mesas: blobby plateaus (thresholded fbm), eroded edges from a finer octave
    const mesaMask = (x: number, z: number) => nz.fbm2(x * 0.0034 + 3.3, z * 0.0034 - 1.1, 3) + nz.n2(x * 0.02, z * 0.02) * 0.05;
    const mesa = (x: number, z: number, out: number) => {
      const r = mesaMask(x, z);
      if (r < 0.26) return -1e9;
      const top = 46 + 70 * (nz.n2(x * 0.004 + 9, z * 0.004) * 0.5 + 0.5);
      // stepped terraces: cliff band, ledge, cap rock
      const k = smoothstep(0.26, 0.4, r);
      const steps = Math.floor(k * 3.999) / 3 * 0.35 + smoothstep(0.0, 1.0, k) * 0.65;
      return 24 + top * steps * smoothstep(40, 160, out);
    };
    const far = (x: number, z: number, out: number) => {
      // a far range of buttes standing out of the haze
      const k = smoothstep(260, 520, out);
      if (k <= 0) return -1e9;
      const r = nz.ridged2(x * 0.0035 - 7, z * 0.0035 + 3, 3);
      return 30 + Math.pow(Math.max(0, r - 0.45) / 0.55, 1.6) * 150 * k;
    };
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = x0 + i * CELL, z = x0 + j * CELL;
        const out = Math.max(-x, -z, x - S, z - S); // metres outside the map square
        let h: number;
        let kind = 0; // 0 sand, 1 mesa rock, 2 far butte
        if (out <= -CELL) {
          // proxy: stays just below the real terrain so near chunks always cover it
          h = Math.min(field.heightAt(x, z), field.heightAt(x + CELL, z), field.heightAt(x - CELL, z), field.heightAt(x, z + CELL), field.heightAt(x, z - CELL)) - 4;
        } else {
          const e = edgeH(x, z) - 4;
          const d = 22 + dunes(x, z);
          const m = mesa(x, z, out);
          const f = far(x, z, out);
          let w = Math.max(d, m, f);
          if (m >= w - 0.01 && m > d) kind = 1;
          if (f >= w - 0.01 && f > d && f > m) kind = 2;
          h = e + (w - e) * smoothstep(-CELL, 90, out);
          // the outermost rows sink so the grid edge never shows
          const rim = Math.min(i, j, N - 1 - i, N - 1 - j);
          if (rim < 2) h -= (2 - rim) * 60;
        }
        const k = i + j * N;
        H[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        col[k * 3] = kind;
      }
    // colours: sand with crest / trough value, strata on cliffs, mauve far rock
    const c = new THREE.Color();
    const SAND = [0xe8c088, 0xdcae74, 0xf0cf98];
    const STR = [0xd6a674, 0xbf8a5c, 0xa8744c, 0xcf9a6a, 0x8f5e40, 0xc48c60];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = i + j * N;
        const h = H[k];
        const hl = H[Math.max(0, i - 1) + j * N], hr = H[Math.min(N - 1, i + 1) + j * N];
        const hd = H[i + Math.max(0, j - 1) * N], hu = H[i + Math.min(N - 1, j + 1) * N];
        const slope = Math.hypot(hr - hl, hu - hd) / (2 * CELL);
        const cav = h - (hl + hr + hd + hu) * 0.25;
        const kind = col[k * 3];
        const x = pos[k * 3], z = pos[k * 3 + 2];
        if (kind === 0 || slope < 0.35) {
          c.setHex(SAND[Math.floor((nz.n2(x * 0.01, z * 0.01) * 0.5 + 0.5) * 2.99)]);
          c.multiplyScalar(1 + Math.max(-0.2, Math.min(0.08, cav * 0.05)));
          if (kind > 0) c.lerp(new THREE.Color(0xc8946a), 0.35);
        } else {
          c.setHex(STR[Math.floor(h * 0.16 + nz.n2(x * 0.02, z * 0.02) * 1.2 + 64) % STR.length]);
          if (kind === 2) c.lerp(new THREE.Color(0xa48078), 0.45);
        }
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let o = 0;
    for (let j = 0; j < N - 1; j++)
      for (let i = 0; i < N - 1; i++) {
        const a = i + j * N, b = a + 1, d = a + N, e = d + 1;
        idx[o++] = a; idx[o++] = d; idx[o++] = b;
        idx[o++] = b; idx[o++] = d; idx[o++] = e;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = 0.0;');
      celify(sh);
    };
    mat.customProgramCacheKey = () => 'backdrop-v1';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'backdrop';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -5;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
function* buildChunkGeometry(f: Heightfield, ox: number, oz: number, lod: number): Generator<void, THREE.BufferGeometry, void> {
  const cs = LOD_CELL[lod];
  const step = LOD_STEP[lod];
  const N = Math.round(CHUNK / cs);
  const W = N + 2;
  // quantized heights incl. 1-cell border
  const H = new Float32Array(W * W);
  const R = new Float32Array(W * W); // raw (unquantized) heights for smooth sand normals
  const M = new Uint8Array(W * W);
  /** 1 = the cell belongs to a big pixel-textured block (hard ground: rock, flagstones, turf, dirt, mud) */
  const B = new Uint8Array(W * W);
  // near rings: hard ground snaps to 0.5 m blocks (one height per block, coarser steps on cliffs)
  // so it reads as big textured blocks; sand keeps its fine rideable columns
  const blocky = cs <= BLOCK_M;
  const nb = Math.ceil((N + 2) * cs / BLOCK_M) + 2;
  const bh = blocky ? new Float32Array(nb * nb).fill(NaN) : null;
  const bm = blocky ? new Uint8Array(nb * nb) : null;
  const bx0 = Math.floor((ox - cs) / BLOCK_M), bz0 = Math.floor((oz - cs) / BLOCK_M);
  for (let j = -1; j <= N; j++) {
    for (let i = -1; i <= N; i++) {
      const x = ox + (i + 0.5) * cs,
        z = oz + (j + 0.5) * cs;
      const k = i + 1 + (j + 1) * W;
      if (bh) {
        const bi = Math.floor(x / BLOCK_M), bj = Math.floor(z / BLOCK_M);
        const bk = bi - bx0 + (bj - bz0) * nb;
        if (Number.isNaN(bh[bk])) {
          const cx = (bi + 0.5) * BLOCK_M, cz = (bj + 0.5) * BLOCK_M;
          const m = f.matAt(cx, cz);
          bm![bk] = m;
          if (BLOCK_MATS.has(m)) {
            const hb = f.heightAt(cx, cz);
            const q = (m === MAT.ROCK || m === MAT.DARK_ROCK) && f.slopeAt(cx, cz) > 0.7 ? 0.25 : 0.125;
            bh[bk] = Math.round(hb / q) * q;
          } else bh[bk] = -1e9;
        }
        if (bh[bk] > -1e8) {
          // raw height kept for the smooth normals of the sand cells around the block
          R[k] = f.heightAt(x, z);
          H[k] = bh[bk];
          M[k] = bm![bk];
          B[k] = 1;
          continue;
        }
      }
      const h = f.heightAt(x, z);
      R[k] = h;
      H[k] = Math.round(h / step) * step;
      M[k] = f.matAt(x, z);
    }
    if ((j & 31) === 31) yield;
  }
  // per-corner normals of the true dune surface: soft ground is lit by its real form
  // (sunny / shaded dune faces), the voxel steps stay as fine geometry
  const NC = N + 1;
  const CN = new Float32Array(NC * NC * 3);
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const a = R[i + j * W], b = R[i + 1 + j * W], c = R[i + (j + 1) * W], d = R[i + 1 + (j + 1) * W];
      const gx = (b + d - (a + c)) / (2 * cs);
      const gz = (c + d - (a + b)) / (2 * cs);
      const l = Math.hypot(gx, 1, gz);
      const o = (i + j * NC) * 3;
      CN[o] = -gx / l;
      CN[o + 1] = 1 / l;
      CN[o + 2] = -gz / l;
    }
  const soft = (m: number) => m === MAT.SAND || m === MAT.SAND_DARK || m === MAT.RED_SAND || m === MAT.DIRT || m === MAT.GRASS || m === MAT.MUD;
  const cn = (ci: number, cj: number, out: number[], o: number) => {
    const k = (ci + cj * NC) * 3;
    out[o] = CN[k];
    out[o + 1] = CN[k + 1];
    out[o + 2] = CN[k + 2];
  };
  const qn = new Array(12).fill(0);
  /** per-vertex depth below the column top (m), for the turf fringe on block sides */
  const dTop = [0, 0, 0, 0];
  // merged strips stay short so living-sand displacement bends them without cracks
  const MAXRUN = Math.max(cs, 1);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const tms: number[] = [];
  const idx: number[] = [];
  const tmp = [0, 0, 0];
  let vi = 0;
  const pushQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    cols: number[], tm: number, flip: boolean, vn: number[] | null = null
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 4; k++) {
      if (vn) nrm.push(vn[k * 3], vn[k * 3 + 1], vn[k * 3 + 2]);
      else nrm.push(nx, ny, nz);
      tms.push(tm, ny > 0.5 ? 0 : Math.min(255, Math.round(dTop[k] * 64)));
    }
    for (let k = 0; k < 12; k++) col.push(cols[k]);
    if (!flip) idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    else idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
    vi += 4;
  };
  const quadCols = new Array(12).fill(0);
  const AO = [0.62, 0.78, 0.9, 1.0];
  let run: { x0: number; x1: number; z0: number; z1: number; h: number; m: number; hex: number; b: number; ci0: number; ci1: number; cj: number; blk: number } | null = null;
  const flushRun = () => {
    if (!run) return;
    toLin(run.hex, run.b, quadCols, 0);
    toLin(run.hex, run.b, quadCols, 3);
    toLin(run.hex, run.b, quadCols, 6);
    toLin(run.hex, run.b, quadCols, 9);
    let vn: number[] | null = null;
    if (soft(run.m) && !run.blk) {
      cn(run.ci0, run.cj, qn, 0);
      cn(run.ci0, run.cj + 1, qn, 3);
      cn(run.ci1, run.cj + 1, qn, 6);
      cn(run.ci1, run.cj, qn, 9);
      vn = qn;
    }
    pushQuad(run.x0, run.h, run.z0, run.x0, run.h, run.z1, run.x1, run.h, run.z1, run.x1, run.h, run.z0, 0, 1, 0, quadCols, run.m, false, vn);
    run = null;
  };
  for (let j = 0; j < N; j++) {
    flushRun();
    if ((j & 7) === 7) yield;
    for (let i = 0; i < N; i++) {
      const k = i + 1 + (j + 1) * W;
      const h = H[k];
      const m = M[k];
      const x0 = ox + i * cs,
        z0 = oz + j * cs,
        x1 = x0 + cs,
        z1 = z0 + cs;
      const wx = x0 + cs * 0.5,
        wz = z0 + cs * 0.5;
      const pal = MATCOL[m] ?? MATCOL[0];
      // top color: large patches + per-cell jitter
      const patch = noise.n2(wx * 0.045, wz * 0.045) * 0.5 + 0.5;
      const cj = hash2(Math.floor(wx * 0.5), Math.floor(wz * 0.5));
      let topHex = patch + (cj - 0.5) * 0.18 > 0.5 ? pal[0] : pal[1];
      let bright = 1;
      if (m === MAT.ROCK || m === MAT.DARK_ROCK) {
        topHex = STRATA[Math.floor(h * 0.9 + noise.n2(wx * 0.05, wz * 0.05) * 1.5 + 64) % STRATA.length];
        bright *= 1.04;
      }
      // AO from 8 neighbours (higher neighbour -> occlusion)
      const hn = (di: number, dj: number) => H[k + di + dj * W] > h + 0.01 ? 1 : 0;
      const n_ = hn(0, -1),
        s_ = hn(0, 1),
        w_ = hn(-1, 0),
        e_ = hn(1, 0);
      const nw = hn(-1, -1),
        ne = hn(1, -1),
        sw = hn(-1, 1),
        se = hn(1, 1);
      const ao = (a: number, b: number, c: number) => (a && b ? 0 : 3 - (a + b + c));
      const a00 = ao(w_, n_, nw),
        a10 = ao(e_, n_, ne),
        a11 = ao(e_, s_, se),
        a01 = ao(w_, s_, sw);
      // vertices: (x0,z0) (x0,z1) (x1,z1) (x1,z0)  -> CCW from above
      const open = a00 === 3 && a01 === 3 && a11 === 3 && a10 === 3;
      const blk = B[k];
      const sm = soft(m) && !blk;
      if (open && run && run.h === h && run.m === m && run.hex === topHex && run.b === bright && run.blk === blk && run.z0 === z0 && run.x1 - run.x0 < MAXRUN - 1e-6) {
        run.x1 = x1; // extend the merged strip
        run.ci1 = i + 1;
      } else {
        flushRun();
        if (open) run = { x0, x1, z0, z1, h, m, hex: topHex, b: bright, ci0: i, ci1: i + 1, cj: j, blk };
        else {
          toLin(topHex, bright * AO[a00], quadCols, 0);
          toLin(topHex, bright * AO[a01], quadCols, 3);
          toLin(topHex, bright * AO[a11], quadCols, 6);
          toLin(topHex, bright * AO[a10], quadCols, 9);
          let vn: number[] | null = null;
          if (sm) {
            cn(i, j, qn, 0);
            cn(i, j + 1, qn, 3);
            cn(i + 1, j + 1, qn, 6);
            cn(i + 1, j, qn, 9);
            vn = qn;
          }
          pushQuad(x0, h, z0, x0, h, z1, x1, h, z1, x1, h, z0, 0, 1, 0, quadCols, m, a00 + a11 < a01 + a10, vn);
        }
      }
      // sides toward lower neighbours (and border skirts)
      const sideHex = m === MAT.ROCK || m === MAT.DARK_ROCK ? -1 : pal[2];
      const border = (di: number, dj: number) => i + di < 0 || i + di >= N || j + dj < 0 || j + dj >= N;
      const sides: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [di, dj] of sides) {
        let nh = H[k + di + dj * W];
        const isBorder = border(di, dj);
        if (isBorder) nh = Math.min(nh, h) - (lod > 0 ? step * 2 + 0.5 : 0.6);
        if (nh >= h - 1e-4) continue;
        // split tall sides into strata bands for rock
        const bottom = nh;
        const segs = sideHex === -1 ? Math.max(1, Math.min(8, Math.ceil((h - bottom) / 1.0))) : 1;
        for (let s = 0; s < segs; s++) {
          const yb = bottom + ((h - bottom) * s) / segs;
          const yt = bottom + ((h - bottom) * (s + 1)) / segs;
          let hex = sideHex;
          if (hex === -1) hex = STRATA[Math.floor(yb * 0.9 + noise.n2(wx * 0.03 + di, wz * 0.03 + dj) * 1.2 + 64) % STRATA.length];
          const shadeB = sm && !isBorder ? 0.9 : 0.8 * (s === 0 ? 0.82 : 1);
          const shadeT = sm && !isBorder ? 0.98 : s === segs - 1 ? 0.97 : 0.88;
          let ax: number, az: number, bx: number, bz: number, nx = di, nz = dj;
          // corner indices of a / b
          let aci: number, acj: number, bci: number, bcj: number;
          if (di === 1) {
            ax = x1; az = z1; bx = x1; bz = z0;
            aci = i + 1; acj = j + 1; bci = i + 1; bcj = j;
          } else if (di === -1) {
            ax = x0; az = z0; bx = x0; bz = z1;
            aci = i; acj = j; bci = i; bcj = j + 1;
          } else if (dj === 1) {
            ax = x0; az = z1; bx = x1; bz = z1;
            aci = i; acj = j + 1; bci = i + 1; bcj = j + 1;
          } else {
            ax = x1; az = z0; bx = x0; bz = z0;
            aci = i + 1; acj = j; bci = i; bcj = j;
          }
          toLin(hex, shadeB, quadCols, 0);
          toLin(hex, shadeB, quadCols, 3);
          toLin(hex, shadeT, quadCols, 6);
          toLin(hex, shadeT, quadCols, 9);
          let vn: number[] | null = null;
          if (sm && !isBorder) {
            cn(aci, acj, qn, 0);
            cn(bci, bcj, qn, 3);
            cn(bci, bcj, qn, 6);
            cn(aci, acj, qn, 9);
            vn = qn;
          }
          dTop[0] = dTop[1] = h - yb;
          dTop[2] = dTop[3] = h - yt;
          // a(bottom) b(bottom) b(top) a(top)
          pushQuad(ax!, yb, az!, bx!, yb, bz!, bx!, yt, bz!, ax!, yt, az!, nx, 0, nz, quadCols, m, false, vn);
        }
      }
    }
  }
  flushRun();
  void tmp;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n8 = new Int8Array(nrm.length);
  for (let k = 0; k < nrm.length; k++) n8[k] = Math.round(nrm[k] * 127);
  geo.setAttribute('normal', new THREE.BufferAttribute(n8, 3, true));
  const c8 = new Uint8Array(col.length);
  for (let k = 0; k < col.length; k++) c8[k] = Math.round(col[k] * 255);
  geo.setAttribute('color', new THREE.BufferAttribute(c8, 3, true));
  geo.setAttribute('tm', new THREE.BufferAttribute(new Uint8Array(tms), 2));
  geo.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
