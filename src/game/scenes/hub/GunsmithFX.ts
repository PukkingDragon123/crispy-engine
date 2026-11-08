// The gunsmith's magic at the turntable (Bench3D's work view):
//  - a rune circle turning under the platter: two gold rings with tick nubs and
//    a band of jade Alagard letters set round it (typography, as voxels);
//  - an energy shell outlining the selected component (jade into gold, a band
//    of light running along it, brighter at the rim);
//  - the schematic: a cyanotype photograph of the gun as it would be.
// (The exploded view is the guns' own: spec.meta.explode, explodeWeapon.)
import * as THREE from 'three';
import { RigSpec, buildRigGeo, RigInstance } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { CardStudio, Shot } from '../../ui/CardStudio';
import { parchmentSheet } from '../../models/props/treasure';

export const JADE = 0x6affc0;
export const GOLD = 0xffcf5a;

// ======================================================================= the rune circle
/** a glyph's ink mask from Alagard (typography only) */
function glyph(ch: string, px = 36) {
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px + 8;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `${px}px Alagard`;
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  c.fillText(ch, px / 2, px);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++)
      if (d[(y * cv.width + x) * 4 + 3] > 110) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { at: (u: number, v: number) => (x1 < 0 ? false : d[(Math.round(y0 + v * (y1 - y0)) * cv.width + Math.round(x0 + u * (x1 - x0))) * 4 + 3] > 110), aspect: x1 < 0 ? 1 : (x1 - x0 + 1) / (y1 - y0 + 1) };
}
/**
 * One band of the circle (XZ plane, centre origin, voxels at vs): a gold ring
 * at each edge with tick nubs and notches, the letters of `words` evenly round
 * the band between them, upright to a reader standing outside.
 */
export function runeBand(r0: number, r1: number, words: string, seed = 1): VoxelModel {
  const m = new VoxelModel('rune_band');
  const ring = (r: number, col: number) => {
    const n = Math.ceil(r * Math.PI * 2.4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(Math.sin(a * 6 + seed)) < 0.035) continue; // little notches
      m.set(Math.round(Math.cos(a) * r), 0, Math.round(Math.sin(a) * r), col, VF.EMISSIVE);
    }
  };
  // (deeper than the glow colours: the circle's own light would wash the letters out)
  ring(r1, 0xb88a2e);
  ring(r1 - 1.6, 0xd8b060);
  ring(r0, 0xb88a2e);
  // tick nubs on the outer ring
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + seed;
    const len = i % 6 === 0 ? 3 : 1.5;
    for (let t = 0; t <= len; t += 0.5) m.set(Math.round(Math.cos(a) * (r1 + t)), 0, Math.round(Math.sin(a) * (r1 + t)), 0xb88a2e, VF.EMISSIVE);
  }
  // the letters
  const chars = words.split('');
  const H = r1 - r0 - 4;
  const mid = (r0 + r1) / 2 - 0.4;
  chars.forEach((ch, i) => {
    if (ch === ' ') return;
    const g = glyph(ch);
    const a0 = (i / chars.length) * Math.PI * 2;
    const W = H * g.aspect;
    for (let v = 0; v <= H; v += 0.5)
      for (let u = 0; u <= W; u += 0.5) {
        if (!g.at(u / Math.max(0.01, W), 1 - v / H)) continue;
        const r = mid - H / 2 + v;
        const a = a0 + (u - W / 2) / r;
        m.set(Math.round(Math.cos(a) * r), 0, Math.round(Math.sin(a) * r), 0x2fb880, VF.EMISSIVE);
      }
  });
  return m;
}

/** the circle under the turntable: an outer band turning one way, an inner band the other, fading in and out */
export class RuneCircle {
  readonly grp = new THREE.Group();
  private outer: THREE.Mesh;
  private inner: THREE.Mesh;
  private mat = makeVoxelMaterial({ transparent: true, opacity: 0 });
  private k = 0;
  constructor(radius: number) {
    const vs = 1 / 200;
    const R = Math.round(radius / vs);
    const om = runeBand(R - 15, R, 'SERKET WATCHES OVER THIS IRON   ', 1);
    const im = runeBand(R - 31, R - 19, 'DUST TO DUST   LEAD TO BONE   ', 4);
    this.outer = new THREE.Mesh(buildVoxelGeometry(om, { voxelSize: vs, pivot: [0.5, 0, 0.5] }), this.mat);
    this.inner = new THREE.Mesh(buildVoxelGeometry(im, { voxelSize: vs, pivot: [0.5, 0, 0.5] }), this.mat);
    for (const m of [this.outer, this.inner]) {
      m.renderOrder = 3;
      m.castShadow = false;
      m.receiveShadow = false;
      this.grp.add(m);
    }
    this.mat.depthWrite = false;
    this.grp.visible = false;
  }
  update(rdt: number, on: boolean, t: number) {
    this.k += ((on ? 1 : 0) - this.k) * (1 - Math.exp(-rdt * (on ? 2.2 : 5)));
    this.grp.visible = this.k > 0.01;
    this.mat.opacity = this.k * (0.78 + Math.sin(t * 2.1) * 0.1);
    this.outer.rotation.y += rdt * 0.12;
    this.inner.rotation.y -= rdt * 0.2;
    const s = 0.9 + this.k * 0.1;
    this.grp.scale.setScalar(s);
  }
  dispose() {
    this.outer.geometry.dispose();
    this.inner.geometry.dispose();
    this.mat.dispose();
  }
}

// ======================================================================= the energy shell
/** additive jade-into-gold glow on a slightly swollen copy of a component, brighter at the rim, a band of light running along it */
export function shellMaterial(a = JADE, b = GOLD) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uK: { value: 0 }, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec3 p = position + normal * 0.0032;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uK; uniform vec3 uA; uniform vec3 uB;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        float band = 0.5 + 0.5 * sin(dot(vW, vec3(31.0, 19.0, 27.0)) - uT * 6.0);
        vec3 c = mix(uA, uB, band * 0.7);
        float a = (0.12 + rim * 0.9 + pow(band, 6.0) * 0.35) * uK;
        gl_FragColor = vec4(c * (1.1 + rim * 0.8), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ======================================================================= the schematic
/**
 * Photograph a gun (as configured) lying on a schematic sheet, graded like a
 * cyanotype blueprint with pale ink lines: the picture in the gunsmith's
 * schematic panel (a photograph of the 3D model, never drawn).
 */
export function gunSchematic(renderer: THREE.WebGLRenderer, spec: RigSpec, cacheKey: string): HTMLCanvasElement | null {
  const mat = makeVoxelMaterial();
  const root = new THREE.Group();
  const sheet = parchmentSheet(124, 80, 11);
  const sheetMesh = new THREE.Mesh(buildVoxelGeometry(sheet.model, { voxelSize: sheet.voxelSize, pivot: sheet.pivot }), mat);
  root.add(sheetMesh);
  const inst = new RigInstance(buildRigGeo(spec, cacheKey), { material: mat });
  const holder = new THREE.Group();
  holder.add(inst.root);
  holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
  root.add(holder);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  holder.scale.setScalar(Math.min(1.6, Math.min(0.92 / Math.max(0.05, size.x), 0.5 / Math.max(0.05, size.z))));
  root.updateMatrixWorld(true);
  box.setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, 0.03 - box.min.y + 0.012, -c.z - 0.02);
  const dist = 1.36, pitch = 1.3;
  const shot: Shot = {
    root,
    cam: { pos: [0, Math.sin(pitch) * dist, Math.cos(pitch) * dist], look: [0, 0, -0.01], fov: 30 },
    sky: { zenith: 0x1a3a6a, mid: 0x2a5a8a, horizon: 0x4a7aaa, ground: 0x10284a, sunDir: [-0.4, 0.8, -0.5], sunColor: 0xe8f4ff, sunSize: 0, gain: 0.6 },
    key: { dir: [-0.55, 0.75, -0.45], color: 0xeaf4ff, intensity: 3.0, center: [0, 0, 0], radius: 1.0 },
    hemi: { sky: 0xd8ecff, ground: 0x2a4a7a, intensity: 1.0 },
    rim: { dir: [0.6, 0.4, 0.8], color: 0xbfe0ff, intensity: 0.9 },
    grade: { sat: 0.18, contrast: 1.25, shadowTint: 0x14336a, highTint: 0xd6ecff, vignette: 0.5, bloom: [0.16, 0.3, 1.6], grain: 0.06 },
    ink: { color: 0xeaf6ff, thr: 0.04, rel: 0.02, thick: 1.0, strength: 1 },
    env: 0.3,
  };
  const studio = new CardStudio(renderer);
  try {
    return studio.shoot(shot, 480, 300, 2);
  } catch (e) {
    console.warn('[hub+] schematic', e);
    return null;
  } finally {
    studio.dispose();
    sheetMesh.geometry.dispose();
    mat.dispose();
  }
}
