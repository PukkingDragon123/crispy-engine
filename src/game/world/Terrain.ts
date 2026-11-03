// Voxel-column terrain renderer: 32 m chunks with 4 LODs, quantized column
// heights, per-corner AO, strata-painted cliffs and a texel-detail shader
// (wind ripples, sand sparkle, tile grout, rock strata lines).
import * as THREE from 'three';
import { Heightfield, MAT } from './Heightfield';
import { noise, hash2, clamp } from '../../engine/math/rand';
import { globalUniforms, celify } from '../../engine/render/VoxelMaterial';
import { SandWaves, SAND_GLSL, SAND_MAX } from './SandWaves';

const CHUNK = 32;
// near field: 12.5 cm sand columns (much higher voxel count), coarser rings outward
const LOD_CELL = [0.125, 0.25, 0.5, 1, 2, 4];
const LOD_STEP = [0.0625, 0.125, 0.25, 0.5, 1, 2];
const LOD_DIST = [32, 64, 110, 172, 262, 384];

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

export function makeTerrainMaterial(wind: { x: number; z: number }, sand: SandWaves = NO_SAND) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const uWind = { value: new THREE.Vector2(wind.x, wind.z) };
  const uMarks = { value: blackTex as THREE.Texture };
  const uMarkArea = { value: 256 };
  const uMarkClock = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = uWind;
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uMarks = uMarks;
    sh.uniforms.uMarkArea = uMarkArea;
    sh.uniforms.uMarkClock = uMarkClock;
    sandVertex(sh, sand, true);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float tm;
        varying float vTM;
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
        varying float vTM;
        varying vec3 vWP;
        varying vec3 vWN;
        vec3 sandBump = vec3(0.0);
        float th(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y); }
        float trk(vec2 p){ float r = texture2D(uMarks, fract(p / uMarkArea)).r; return r > 0.0 ? 1.0 - smoothstep(22.0, 48.0, uMarkClock - r) : 0.0; }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sparkle = 0.0;
        {
          vec3 an = abs(vWN);
          bool top = an.y > 0.6;
          vec2 tp = top ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy);
          vec2 px = floor(tp * 16.0);
          float h1 = th(px + vec2(vTM * 17.0, 3.0));
          float jit = (h1 - 0.5) * 0.11;
          float m = floor(vTM + 0.5);
          if (m <= 2.0 || m == 6.0) {
            if (top) {
              float camD = distance(vWP, cameraPosition);
              // wind ripples: asymmetric (gentle windward, steep lee) bands that catch the low sun,
              // creeping slowly downwind
              vec2 wd = normalize(uWind + vec2(1e-4));
              vec2 pw = vec2(dot(vWP.xz, wd), dot(vWP.xz, vec2(-wd.y, wd.x)));
              float ph = pw.x * 2.6 + sin(pw.y * 0.31 + th(floor(vWP.xz * 0.05)) * 6.0) * 1.3 - uTime * 0.11;
              float rf = fract(ph);
              float dh = rf < 0.72 ? 1.0 / 0.72 : -1.0 / 0.28;
              float fade = smoothstep(48.0, 8.0, camD);
              vec2 g = wd * dh * 2.6 * 0.012 * fade;
              sandBump = vec3(-g.x, 0.0, -g.y);
              jit += (rf > 0.72 ? -0.05 : (rf < 0.12 ? 0.03 : 0.0)) * fade;
              // mega-ripples: long sand waves that keep the far dunes detailed
              float ph2 = pw.x * 0.36 + sin(pw.y * 0.045 + th(floor(vWP.xz * 0.012)) * 6.0) * 2.2 - uTime * 0.02;
              float rf2 = fract(ph2);
              float far = smoothstep(220.0, 26.0, camD) * smoothstep(4.0, 18.0, camD);
              float dh2 = rf2 < 0.78 ? 1.0 / 0.78 : -1.0 / 0.22;
              vec2 g2 = wd * dh2 * 0.36 * 0.22 * far;
              sandBump += vec3(-g2.x, 0.0, -g2.y);
              jit += (rf2 > 0.78 ? -0.045 : (rf2 < 0.1 ? 0.025 : 0.0)) * far;
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
          } else if (m == 5.0) {
            vec2 g = fract(vWP.xz * 0.5 + 0.02);
            vec2 g2 = fract(vec2(vWP.x * 0.5 + floor(vWP.z * 0.5) * 0.5, vWP.z * 0.5));
            if (top && (g.y < 0.05 || g2.x < 0.04)) jit -= 0.2;
            if (!top && fract(vWP.y * 2.0) < 0.07) jit -= 0.18;
          } else if (m == 7.0) {
            jit += (h1 > 0.75 ? 0.08 : 0.0) - (h1 < 0.15 ? 0.1 : 0.0);
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
  m.customProgramCacheKey = () => 'terrain-v6sand';
  (m as any).userData = { uWind, uMarks, uMarkArea, uMarkClock };
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
  private nC: number;
  built = 0;
  /** the chunk being meshed a few rows per frame (no hitches at high resolution) */
  private job: { c: Chunk; lod: number; it: Generator<void, THREE.BufferGeometry, void> } | null = null;

  constructor(public field: Heightfield, wind: { x: number; z: number }, sand?: SandWaves) {
    this.material = makeTerrainMaterial(wind, sand);
    this.depthMaterial = makeTerrainDepthMaterial(sand ?? NO_SAND);
    this.nC = Math.ceil(field.size / CHUNK);
    for (let j = 0; j < this.nC; j++)
      for (let i = 0; i < this.nC; i++) this.chunks.set(i + j * 1000, { cx: i, cz: j, lod: -1, mesh: null, dirty: true, builtLod: -1 });
    field.onDirty.push((x0, z0, x1, z1) => this.markDirty(x0, z0, x1, z1));
    this.group.name = 'terrain';
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
    const want: Chunk[] = [];
    for (const c of this.chunks.values()) {
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
    }
    c.mesh.castShadow = lod <= 2;
    c.builtLod = lod;
    this.built++;
  }

  dispose() {
    for (const c of this.chunks.values()) c.mesh?.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.group.removeFromParent();
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
  for (let j = -1; j <= N; j++) {
    for (let i = -1; i <= N; i++) {
      const x = ox + (i + 0.5) * cs,
        z = oz + (j + 0.5) * cs;
      const h = f.heightAt(x, z);
      R[i + 1 + (j + 1) * W] = h;
      H[i + 1 + (j + 1) * W] = Math.round(h / step) * step;
      M[i + 1 + (j + 1) * W] = f.matAt(x, z);
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
      tms.push(tm);
    }
    for (let k = 0; k < 12; k++) col.push(cols[k]);
    if (!flip) idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    else idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
    vi += 4;
  };
  const quadCols = new Array(12).fill(0);
  const AO = [0.62, 0.78, 0.9, 1.0];
  let run: { x0: number; x1: number; z0: number; z1: number; h: number; m: number; hex: number; b: number; ci0: number; ci1: number; cj: number } | null = null;
  const flushRun = () => {
    if (!run) return;
    toLin(run.hex, run.b, quadCols, 0);
    toLin(run.hex, run.b, quadCols, 3);
    toLin(run.hex, run.b, quadCols, 6);
    toLin(run.hex, run.b, quadCols, 9);
    let vn: number[] | null = null;
    if (soft(run.m)) {
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
      const sm = soft(m);
      if (open && run && run.h === h && run.m === m && run.hex === topHex && run.b === bright && run.z0 === z0 && run.x1 - run.x0 < MAXRUN - 1e-6) {
        run.x1 = x1; // extend the merged strip
        run.ci1 = i + 1;
      } else {
        flushRun();
        if (open) run = { x0, x1, z0, z1, h, m, hex: topHex, b: bright, ci0: i, ci1: i + 1, cj: j };
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
  geo.setAttribute('tm', new THREE.BufferAttribute(new Uint8Array(tms), 1));
  geo.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
