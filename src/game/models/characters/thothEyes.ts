// THOTH'S EYES: tiny flat 2D pixel dot eyes (user: "2d pixel simple dot eyes, 1 pixel, very cute").
// (CLAUDE.md exception, user note: Thoth alone has 2D eyes.)
//
// Each eye is a small flat pixel sprite laid on the head surface: one solid dark dot
// the size of one of his voxels. Pixel cells are half a voxel, so the dot is a crisp
// 2 x 2 cell square and every mood shape stays within a couple of his voxels:
//   dot      the resting eye
//   blink    a 1-cell-high dash (a frame or two)
//   happy    a tiny upturned arc
//   big      surprised: a slightly bigger dot
//   sleepy   a flat dash, sitting low
// plus a brief sparkle cell when he is excited, and a gaze that nudges the dot by
// one cell at most. The voxel `eye_l` / `eye_r` parts (one dark voxel each) are the
// stand-ins for captures that run no animator; this hides them.
//
//   const eyes = new ThothEyes(rig);           // ThothAnim does this for you
//   eyes.set(0, 'dot', 1, 0, false);  eyes.dispose();
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';

export type EyeDot = 'dot' | 'blink' | 'happy' | 'big' | 'sleepy';

/** cells of the sprite grid (N x N, centre between cells N/2 - 1 and N/2) */
const N = 8;
const INK: [number, number, number] = [0x18, 0x13, 0x1e];
const SPARK: [number, number, number] = [0xff, 0xf3, 0xb8];
/** the pixel shapes, top row first ('#' ink), drawn round the grid centre */
const SPRITES: Record<EyeDot, string[]> = {
  dot: ['##', '##'],
  big: ['.##.', '####', '####', '.##.'],
  blink: ['###'],
  sleepy: ['###'],
  happy: ['.##.', '#..#'],
};
/** vertical nudge of a shape (cells, + up) */
const LIFT: Record<EyeDot, number> = { dot: 0, big: 0, blink: -0.5, sleepy: -1, happy: 0 };

interface Eye {
  mesh: THREE.Mesh;
  tex: THREE.DataTexture;
  data: Uint8Array;
  key: string;
}

/** the two pixel dot eyes of one Thoth rig */
export class ThothEyes {
  meshes: THREE.Mesh[] = [];
  private e: Eye[] = [];
  constructor(rig: RigInstance) {
    const meta = rig.geo.spec.meta?.eyes as { cell: number; lift: number; n: [number, number, number] } | undefined;
    if (!meta) return;
    const geo = new THREE.PlaneGeometry(meta.cell * N, meta.cell * N);
    ['eye_l', 'eye_r'].forEach((name, i) => {
      const node = rig.nodes[name];
      if (!node) return;
      const data = new Uint8Array(N * N * 4);
      const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name + ':dot';
      // lie flat on the head, facing out along the surface normal, upright in head space
      const n = new THREE.Vector3(meta.n[0] * (i === 0 ? 1 : -1), meta.n[1], meta.n[2]).normalize();
      const x = new THREE.Vector3(0, 1, 0).cross(n).normalize();
      const y = n.clone().cross(x);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
      mesh.position.copy(n).multiplyScalar(meta.lift);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      node.add(mesh);
      const vox = rig.meshes[name];
      if (vox) vox.visible = false;
      this.meshes.push(mesh);
      this.e.push({ mesh, tex, data, key: '' });
      this.set(i, 'dot', 0, 0, false);
    });
  }
  /** draw eye i (0 left, 1 right): a shape, a gaze nudge (-1..1 cells each way), a sparkle */
  set(i: number, shape: EyeDot, gx: number, gy: number, spark: boolean) {
    const e = this.e[i];
    if (!e) return;
    const key = `${shape}|${gx}|${gy}|${spark ? 1 : 0}`;
    if (key === e.key) return;
    e.key = key;
    e.data.fill(0);
    const rows = SPRITES[shape];
    const h = rows.length, w = rows[0].length;
    // the sprite's bottom-left cell, centred on the grid, nudged by the gaze
    const x0 = Math.round(N / 2 - w / 2 + gx);
    const y0 = Math.round(N / 2 - h / 2 + LIFT[shape] + gy);
    const put = (cx: number, cy: number, c: [number, number, number]) => {
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return;
      const o = (cy * N + cx) * 4;
      e.data[o] = c[0];
      e.data[o + 1] = c[1];
      e.data[o + 2] = c[2];
      e.data[o + 3] = 255;
    };
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (rows[r][c] === '#') put(x0 + c, y0 + (h - 1 - r), INK);
    // a glint cell off the top corner of the dot (the outer side of each eye)
    if (spark) put(i === 0 ? x0 + w : x0 - 1, y0 + h, SPARK);
    e.tex.needsUpdate = true;
  }
  dispose() {
    for (const e of this.e) {
      (e.mesh.material as THREE.Material).dispose();
      e.tex.dispose();
      e.mesh.removeFromParent();
    }
    if (this.meshes[0]) this.meshes[0].geometry.dispose();
    this.meshes = [];
    this.e = [];
  }
}
