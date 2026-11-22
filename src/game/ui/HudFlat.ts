// THE LOWER HUD LOOK (user note): the heart, the bullets, the revolver cylinder and the tarot cards
// stay live 3D models that turn, beat and tumble, but read like 2D game icons:
//  • chunky low-res voxels: the sculpted models averaged down onto a 2-4x coarser grid (coarse,
//    coarseGeo, coarseRig), so the tiny details melt into a few clean blocks;
//  • flat colour with one soft shade step (flatMat): no specular, no env reflections, no tone curve,
//    glowing voxels stay flat and bright;
//  • a crisp dark ink outline (outline): an inverted hull whose back faces are pushed out a fixed
//    number of screen pixels along each screen axis from the piece's own centre, so the line keeps
//    one width however big the piece is drawn or however it turns.
// The materials keep the VoxelMaterial uniforms the HUD drives (userData.tint, userData.fx), so the
// beat, the warm last round, the ready breathing and the flashes work unchanged.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { downsampleModel, type VoxelModel } from '../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../engine/voxel/Rig';
import type { VoxelMaterial } from '../../engine/render/VoxelMaterial';

type V3 = [number, number, number];

/** how much coarser each lower-HUD piece is built than its sculpt */
export const HUD_COARSE = { heart: 4, round: 3, cylinder: 2, card: 2 } as const;

/** a chunkier copy of a voxel model: each f×f×f block of voxels averaged into one */
export function coarse(m: VoxelModel, f: number, fill = 0.3): VoxelModel {
  return f <= 1 ? m : downsampleModel(m, f, fill);
}
const onGrid = (p: V3, f: number): V3 => [p[0] / f, p[1] / f, p[2] / f];

/** the coarse geometry, the same size and pivot as buildVoxelGeometry(model, { voxelSize, pivot }) */
export function coarseGeo(m: VoxelModel, f: number, voxelSize: number, pivot: V3 | 'center', fill?: number) {
  return buildVoxelGeometry(coarse(m, f, fill), { voxelSize: voxelSize * f, pivot: pivot === 'center' ? pivot : onGrid(pivot, f), ao: 0.45 });
}

/** a rig rebuilt on the coarse grid: same joints, same size, same metadata */
export function coarseRig(spec: RigSpec, f: number, fill?: number): RigSpec {
  if (f <= 1) return spec;
  const sockets: RigSpec['sockets'] = {};
  for (const [k, s] of Object.entries(spec.sockets ?? {})) sockets[k] = { ...s, at: onGrid(s.at, f) };
  return {
    ...spec,
    name: `${spec.name}_c${f}`,
    voxelSize: spec.voxelSize * f,
    parts: spec.parts.map((p) => ({ ...p, model: coarse(p.model, f, fill), pivot: onGrid(p.pivot, f), attach: onGrid(p.attach, f) })),
    sockets,
  };
}

// ------------------------------------------------------------------ flat colour, one soft shade step
const FLAT_VS = /* glsl */ `
attribute vec2 matx;
varying vec3 vCol;
varying vec3 vNrm;
varying float vEm;
void main() {
  vCol = color;
  vEm = matx.x;
  vNrm = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLAT_FS = /* glsl */ `
uniform vec3 uTint;
uniform vec4 uFx;
uniform float uOpacity;
varying vec3 vCol;
varying vec3 vNrm;
varying float vEm;
void main() {
  // faces turned to the HUD's key light keep their flat colour; the rest drop one soft tone
  // (lifted: the sculpts' colours are authored for the strong HUD lights the old pieces had)
  float lit = smoothstep(0.02, 0.28, dot(normalize(vNrm), normalize(vec3(-0.45, 0.8, 1.0))));
  vec3 c = vCol * mix(1.15, 1.75, lit) * uTint;
  // glowing voxels (venom glass, gems) stay flat and bright, a touch brighter while boosted
  c = mix(c, vCol * uTint * (1.9 + uFx.z * 0.3), clamp(vEm, 0.0, 1.0));
  c = mix(c, vec3(1.0), clamp(uFx.x, 0.0, 1.0));
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}`;

/** the flat HUD material, a drop-in for makeVoxelMaterial({ fog: false }) in the lower HUD */
export function flatMat(): VoxelMaterial {
  const fx = { value: new THREE.Vector4(0, 0, 0, 0) };
  const tint = { value: new THREE.Color(1, 1, 1) };
  const m = new THREE.ShaderMaterial({
    uniforms: { uTint: tint, uFx: fx, uOpacity: { value: 1 } },
    vertexShader: FLAT_VS,
    fragmentShader: FLAT_FS,
    vertexColors: true,
  });
  m.userData = { fx, tint, emissiveStrength: { value: 1 } };
  return m as unknown as VoxelMaterial;
}

// ------------------------------------------------------------------ the ink outline
const INK = {
  px: { value: new THREE.Vector2(0.004, 0.006) },
  col: { value: new THREE.Color(0x140a06) },
};
/** the line's width in css px, for the W×H css-px HUD camera (Hud3D calls it every frame) */
export function setOutlinePx(px: number, W: number, H: number) {
  INK.px.value.set((2 * px) / Math.max(1, W), (2 * px) / Math.max(1, H));
}
const HULL_VS = /* glsl */ `
uniform vec3 uC;
uniform vec2 uPx;
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 c = projectionMatrix * modelViewMatrix * vec4(uC, 1.0);
  // out from the piece's own centre, the same few pixels along each screen axis
  vec2 d = p.xy / p.w - c.xy / c.w;
  p.xy += clamp(d / (uPx * 1.5), -1.0, 1.0) * uPx * p.w;
  gl_Position = p;
}`;
const HULL_FS = /* glsl */ `
uniform vec3 uCol;
void main() {
  gl_FragColor = vec4(uCol, 1.0);
  #include <colorspace_fragment>
}`;
const hulls = new WeakMap<THREE.BufferGeometry, THREE.ShaderMaterial>();
function hullMat(geo: THREE.BufferGeometry) {
  let m = hulls.get(geo);
  if (!m) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    m = new THREE.ShaderMaterial({ uniforms: { uC: { value: c }, uPx: INK.px, uCol: INK.col }, vertexShader: HULL_VS, fragmentShader: HULL_FS, side: THREE.BackSide });
    hulls.set(geo, m);
  }
  return m;
}

/** give a mesh its ink outline (a child hull that follows its geometry if it is swapped) */
export function outline<T extends THREE.Mesh>(mesh: T): T {
  if (mesh.userData.ink) return mesh;
  const hull = new THREE.Mesh(mesh.geometry, hullMat(mesh.geometry));
  hull.frustumCulled = false;
  hull.castShadow = false;
  hull.onBeforeRender = () => {
    if (hull.geometry !== mesh.geometry) {
      hull.geometry = mesh.geometry;
      hull.material = hullMat(mesh.geometry);
    }
  };
  mesh.add(hull);
  mesh.userData.ink = hull;
  return mesh;
}
