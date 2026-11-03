// One leaf of the Codex: a bendable sheet of old paper. Its shape is integrated
// column by column from the spine, so a turning page really curls: the outer corner
// leads, the middle bows, the inner edge stays bound in the gutter. Resting pages
// follow the page blocks' gutter profile, ripple a little, and some are dog-eared
// (the folded corner shows the back of the leaf).
// The paper is a shader: yellowed fibres, foxing, tide-line stains, sun-browned
// edges, the gutter's shadow; the ink (Alagard type) comes from a canvas, the plates
// are live 3D dioramas rendered to a texture, inked from their depth, and the
// rubber stamps press into the fibres.
import * as THREE from 'three';
import { PARCHMENT_GLSL } from '../Choice';
import { BM, prof } from './BookModels';

export const NU = 40;
export const NV = 22;
/** canvas size for a page's ink (keeps the page's aspect) */
export const INK_W = 768;
export const INK_H = Math.round(INK_W * (BM.PH / BM.PW));

export interface FaceContent {
  ink: THREE.Texture | null;
  /** live plate: colour + depth textures, rect in canvas uv (x0, y0, x1, y1), style 1 paint · 2 blueprint · 3 locked */
  plate?: { tex: THREE.Texture; depth: THREE.Texture; rect: [number, number, number, number]; style: number; near: number; far: number } | null;
  stamp?: { map: THREE.Texture; rect: [number, number, number, number]; ang: number; color: THREE.Color } | null;
  seed: number;
}

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
const blankDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blankDepth.needsUpdate = true;

const PAGE_GLSL = /* glsl */ `
uniform sampler2D uInkF, uInkB, uPlateF, uPlateB, uDepthF, uDepthB, uStampMap;
uniform vec4 uRectF, uRectB, uStampRect, uCamF, uCamB;
uniform float uStyleF, uStyleB, uSeedF, uSeedB, uAspect, uStamp, uStampAng;
uniform vec3 uStampCol;
uniform vec2 uPlateRes;
varying vec2 vPageUv;
${PARCHMENT_GLSL}
float pF3(vec2 p){ return pNoise(p) * 0.57 + pNoise(p * 2.07 + 1.3) * 0.29 + pNoise(p * 4.3 + 2.6) * 0.14; }
vec3 bookPaper(vec2 cu, float sd, float gutter) {
  vec2 q = cu * vec2(uAspect, 1.0) + sd * 13.7;
  float mot = pF3(q * 3.2);
  vec3 col = mix(vec3(0.93, 0.85, 0.67), vec3(0.83, 0.71, 0.5), smoothstep(0.25, 0.92, mot));
  col *= 0.95 + 0.05 * pNoise(q * vec2(150.0, 40.0));
  float fox = smoothstep(0.66, 0.9, pF3(q * 7.0 + 3.0));
  col = mix(col, vec3(0.62, 0.43, 0.24), fox * 0.34);
  col *= 1.0 - 0.14 * step(0.994, pHash(floor(q * 260.0)));
  // a tide-line (a spilled cup, a rain-soaked night) on some pages
  float on = step(0.58, fract(sd * 5.1));
  if (on > 0.5) {
    vec2 sc = vec2(0.2 + 0.6 * fract(sd * 3.7), 0.2 + 0.6 * fract(sd * 7.3));
    float r = length((cu - sc) * vec2(uAspect, 1.0));
    float rr = 0.07 + 0.06 * fract(sd * 11.0) + (mot - 0.5) * 0.04;
    col = mix(col, vec3(0.58, 0.4, 0.22), smoothstep(0.012, 0.0, abs(r - rr)) * 0.38);
    col = mix(col, col * vec3(0.95, 0.9, 0.82), smoothstep(rr, rr - 0.02, r));
  }
  // sun-browned, thumbed edges
  vec2 e = min(cu, 1.0 - cu);
  float edge = min(e.x * uAspect, e.y) + (pNoise(cu * 14.0 + sd) - 0.5) * 0.025;
  col = mix(col, vec3(0.6, 0.41, 0.22), smoothstep(0.075, 0.0, edge) * 0.6);
  // the gutter swallows the light
  col *= 1.0 - 0.42 * exp(-gutter * 22.0);
  return col;
}
float linD(float z, vec4 cam) { return (cam.x * cam.y) / (cam.y - z * (cam.y - cam.x)); }
vec4 plateInk(sampler2D tex, sampler2D dep, vec4 rect, vec4 cam, vec2 cu, float style, float sd) {
  vec2 q = (cu - rect.xy) / (rect.zw - rect.xy);
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  vec2 tq = vec2(q.x, 1.0 - q.y);
  float ar = (rect.z - rect.x) * uAspect / max(1e-4, rect.w - rect.y);
  vec2 e2 = min(q, 1.0 - q);
  float ed = min(e2.x * ar, e2.y);
  float n = pF3(q * vec2(ar, 1.0) * 5.0 + sd * 5.0);
  // a painted vignette: the image bleeds into the paper with a ragged, brushy edge
  float m = smoothstep(0.0, 0.08, ed - (n - 0.5) * 0.09 - 0.012);
  vec3 col = texture2D(tex, tq).rgb;
  col = col / (1.0 + col * 0.85) * 1.32;
  // ink lines from the diorama's depth (silhouettes and creases)
  vec2 px = 1.0 / uPlateRes;
  float d0 = linD(texture2D(dep, tq).x, cam);
  float dl = linD(texture2D(dep, tq - vec2(px.x, 0.0)).x, cam), dr = linD(texture2D(dep, tq + vec2(px.x, 0.0)).x, cam);
  float du = linD(texture2D(dep, tq + vec2(0.0, px.y)).x, cam), dd = linD(texture2D(dep, tq - vec2(0.0, px.y)).x, cam);
  float dz = max(max(abs(dl - d0), abs(dr - d0)), max(abs(du - d0), abs(dd - d0)));
  float line = smoothstep(0.035, 0.09, dz / max(d0, 0.05));
  if (style < 1.5) {
    col = mix(col, vec3(0.1, 0.06, 0.035), line * 0.85);
  } else if (style < 2.5) {
    // cyanotype: Prussian blue ground, white linework, a faint drafting grid
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(0.04, 0.13, 0.3), vec3(0.18, 0.34, 0.58), clamp(l * 1.1, 0.0, 1.0));
    vec2 g = abs(fract(q * vec2(ar, 1.0) * 12.0) - 0.5);
    col = mix(col, vec3(0.42, 0.56, 0.78), (1.0 - smoothstep(0.0, 0.035, min(g.x, g.y))) * 0.22);
    col = mix(col, vec3(0.93, 0.96, 1.0), line);
    m = smoothstep(0.0, 0.02, ed - 0.004 - (n - 0.5) * 0.01);
  } else {
    // unknown: a sepia ghost with the creature in shadow
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(0.55, 0.41, 0.25), vec3(0.86, 0.75, 0.55), clamp(l * 1.4, 0.0, 1.0));
    col = mix(col, vec3(0.12, 0.07, 0.04), line * 0.5);
    m *= 0.8;
  }
  return vec4(col, m);
}
`;

const PAGE_FRAG = /* glsl */ `
{
  bool front = gl_FrontFacing;
  vec2 cu = front ? vPageUv : vec2(1.0 - vPageUv.x, vPageUv.y);
  float sd = front ? uSeedF : uSeedB;
  vec3 lin = pow(bookPaper(cu, sd, vPageUv.x), vec3(2.2));
  float style = front ? uStyleF : uStyleB;
  if (style > 0.5) {
    vec4 pc = front ? plateInk(uPlateF, uDepthF, uRectF, uCamF, cu, style, sd) : plateInk(uPlateB, uDepthB, uRectB, uCamB, cu, style, sd);
    lin = mix(lin, pc.rgb * mix(vec3(1.0), lin * 1.12, 0.22), pc.a);
  }
  vec2 tu = vec2(cu.x, 1.0 - cu.y);
  vec4 ink = front ? texture2D(uInkF, tu) : texture2D(uInkB, tu);
  float press = 0.76 + 0.24 * smoothstep(0.2, 0.6, pNoise(cu * vec2(uAspect, 1.0) * 250.0 + sd));
  lin = mix(lin, ink.rgb * mix(vec3(1.0), lin * 1.1, 0.2), ink.a * press);
  if (front && uStamp > 0.001) {
    float st = rubberStamp(vec2(cu.x, 1.0 - cu.y), uAspect, uStampRect, uStampAng, uStampMap);
    lin = mix(lin, uStampCol * mix(vec3(1.0), lin, 0.25), st * 0.8 * uStamp);
  }
  diffuseColor.rgb *= lin;
}
`;

export class PageSheet {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  u: Record<string, THREE.IUniform>;
  private pos: Float32Array;
  private phi = new Float32Array(NU + 1);
  private dirty = true;
  private last = '';

  constructor(seed: number) {
    const n = (NU + 1) * (NV + 1);
    this.pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let j = 0; j <= NV; j++)
      for (let i = 0; i <= NU; i++) {
        const k = j * (NU + 1) + i;
        uv[k * 2] = i / NU;
        uv[k * 2 + 1] = j / NV;
        if (i < NU && j < NV) {
          const a = k, b = k + 1, c = k + NU + 1, d = k + NU + 2;
          idx.push(a, c, b, b, c, d);
        }
      }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pageUv', new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.u = {
      uInkF: { value: blank }, uInkB: { value: blank },
      uPlateF: { value: blank }, uPlateB: { value: blank }, uDepthF: { value: blankDepth }, uDepthB: { value: blankDepth },
      uRectF: { value: new THREE.Vector4() }, uRectB: { value: new THREE.Vector4() },
      uCamF: { value: new THREE.Vector4(0.1, 20, 0, 0) }, uCamB: { value: new THREE.Vector4(0.1, 20, 0, 0) },
      uStyleF: { value: 0 }, uStyleB: { value: 0 }, uSeedF: { value: seed }, uSeedB: { value: seed + 0.37 },
      uSeed: { value: seed },
      uAspect: { value: BM.PW / BM.PH },
      uStamp: { value: 0 }, uStampAng: { value: 0.2 }, uStampRect: { value: new THREE.Vector4(0.7, 0.86, 0.1, 0.04) }, uStampCol: { value: new THREE.Color('#a8281a') }, uStampMap: { value: blank },
      uPlateRes: { value: new THREE.Vector2(512, 512) },
    };
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pageUv;\nvarying vec2 vPageUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPageUv = pageUv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PAGE_GLSL).replace('#include <map_fragment>', PAGE_FRAG);
    };
    this.mat.customProgramCacheKey = () => 'dustup-codex-page';
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** the faces' content: front = a right-hand page, back = a left-hand page */
  setFace(side: 'F' | 'B', c: FaceContent | null) {
    const u = this.u;
    u['uInk' + side].value = c?.ink ?? blank;
    u['uSeed' + side].value = c?.seed ?? 0.5;
    const p = c?.plate;
    u['uStyle' + side].value = p ? p.style : 0;
    if (p) {
      u['uPlate' + side].value = p.tex;
      u['uDepth' + side].value = p.depth;
      (u['uRect' + side].value as THREE.Vector4).set(...p.rect);
      (u['uCam' + side].value as THREE.Vector4).set(p.near, p.far, 0, 0);
    } else {
      u['uPlate' + side].value = blank;
      u['uDepth' + side].value = blankDepth;
    }
    if (side === 'F') {
      const s = c?.stamp;
      u.uStamp.value = s ? 1 : 0;
      if (s) {
        u.uStampMap.value = s.map;
        (u.uStampRect.value as THREE.Vector4).set(...s.rect);
        u.uStampAng.value = s.ang;
        (u.uStampCol.value as THREE.Color).copy(s.color);
      }
    }
  }

  /**
   * Shape the sheet. T: 0 resting on the right block … 1 resting on the left; tR / tL: block thicknesses (m);
   * dir: +1 turning forward (right → left), -1 back; ear: dog-ear size (0 none); lift: a hover lift of the outer edge.
   */
  shape(T: number, tR: number, tL: number, dir = 1, ear = 0, lift = 0) {
    const key = `${T.toFixed(4)}|${tR.toFixed(5)}|${tL.toFixed(5)}|${dir}|${ear.toFixed(3)}|${lift.toFixed(4)}`;
    if (key === this.last && !this.dirty) return;
    this.last = key;
    this.dirty = false;
    const W = BM.PW, H = BM.PH, BT = BM.BT;
    const ds = W / NU;
    const phi = this.phi;
    const LEAD = 0.65;
    const eps = 0.0012;
    const P = this.pos;
    const slopeR = (s: number) => Math.atan2(tR * (prof((s + ds * 0.5) / W) - prof((s - ds * 0.5) / W)), ds);
    const slopeL = (s: number) => Math.atan2(tL * (prof((s + ds * 0.5) / W) - prof((s - ds * 0.5) / W)), ds);
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const corner = 0.5 + 0.5 * v; // the near (bottom) corner leads
      for (let i = 0; i <= NU; i++) {
        const s = (i / NU) * W, u = i / NU;
        const a0 = slopeR(s), a1 = Math.PI - slopeL(s);
        let k: number;
        if (T <= 0) k = 0;
        else if (T >= 1) k = 1;
        else {
          const lead = Math.pow(u, 1.25) * corner;
          k = dir > 0 ? THREE.MathUtils.clamp(T * (1 + LEAD) - LEAD * (1 - lead), 0, 1) : 1 - THREE.MathUtils.clamp((1 - T) * (1 + LEAD) - LEAD * (1 - lead), 0, 1);
          k = k * k * (3 - 2 * k);
        }
        phi[i] = a0 + (a1 - a0) * k + (k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.12 * u * dir : 0);
      }
      let x = 0, y = BT + eps;
      const z = (v - 0.5) * H;
      for (let i = 0; i <= NU; i++) {
        if (i > 0) {
          const a = (phi[i - 1] + phi[i]) * 0.5;
          x += Math.cos(a) * ds;
          y += Math.sin(a) * ds;
        }
        const u = i / NU;
        // paper is never quite flat: a soft ripple, the outer edge curling up a touch
        const rest = T <= 0 || T >= 1 ? 1 : 0;
        const ripple = (Math.sin(u * 7.1 + v * 3.3 + this.u.uSeedF.value * 9) * 0.0011 + Math.max(0, u - 0.86) ** 2 * 0.09) * u * rest + lift * u * u;
        const k3 = (j * (NU + 1) + i) * 3;
        P[k3] = x;
        P[k3 + 1] = y + ripple;
        P[k3 + 2] = z;
      }
    }
    // a dog-eared top outer corner: everything past the fold line folds over onto the page
    if (ear > 0 && (T <= 0 || T >= 1)) {
      const ai = Math.round(NU * (1 - ear)), bj = Math.round(NV * ear * 1.25);
      const A = new THREE.Vector2(P[ai * 3], P[ai * 3 + 2]);
      const kb = (bj * (NU + 1) + NU) * 3;
      const B = new THREE.Vector2(P[kb], P[kb + 2]);
      const d = B.clone().sub(A).normalize();
      const nrm = new THREE.Vector2(-d.y, d.x);
      // the corner's side of the line
      const kc = NU * 3;
      const sideC = Math.sign(new THREE.Vector2(P[kc] - A.x, P[kc + 2] - A.y).dot(nrm));
      const yA = P[ai * 3 + 1];
      for (let j = 0; j <= NV; j++)
        for (let i = 0; i <= NU; i++) {
          const k3 = (j * (NU + 1) + i) * 3;
          const px = P[k3] - A.x, pz = P[k3 + 2] - A.y;
          const dist = px * nrm.x + pz * nrm.y;
          if (Math.sign(dist) !== sideC || Math.abs(dist) < 1e-6) continue;
          P[k3] -= 2 * dist * nrm.x;
          P[k3 + 2] -= 2 * dist * nrm.y;
          P[k3 + 1] = yA + 0.0016 + Math.abs(dist) * 0.05;
        }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
