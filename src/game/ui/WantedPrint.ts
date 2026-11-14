// Sundown's WANTED print: a chunky pixel-art bill on aged paper.
// - The portrait is a photograph of his own rig (CardStudio): head and shoulders,
//   the face lost in deep shadow under the hat brim, only the glowing modelled
//   eyes and the bandana catching the light, a hot sky and rim light behind him.
// - The photo is then printed: posterised onto a few sepia inks plus the poster's
//   red, ordered-dithered like a cheap frontier press; the eyes keep a luminous
//   green ink the paper shader makes glow faintly.
// - The lettering is Alagard set at its own pixel sizes and snapped to hard pixels.
// The paper itself (stains, foxing, torn edges) is the poster's shader, pixelated
// on the same grid.
import * as THREE from 'three';
import { RigInstance, type RigGeo } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { CardStudio, type Shot } from './CardStudio';

/** the print grid (art pixels); same aspect as the old 720 × 1040 sheet */
export const PRINT_W = 162, PRINT_H = 234;
const PORTRAIT_W = 96, PORTRAIT_H = 84;

// inks (sRGB)
const INK = [0x1a0e07, 0x3a2210, 0x6a4224, 0x9a6d45];
const RED = [0x5a120c, 0x8e1c12];
const EYE = [0x3fbf24, 0x9cff4a];
const TEXT_INK = '#1a0e07', TEXT_RED = '#8e1c12', TEXT_SEPIA = '#6a4224';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Sundown, head and shoulders, in deep shadow under the brim (raw photograph, PORTRAIT_W × PORTRAIT_H) */
export function mysteryPhoto(renderer: THREE.WebGLRenderer, geo: RigGeo): HTMLCanvasElement | null {
  const mat = makeVoxelMaterial({ fog: false });
  const studio = new CardStudio(renderer);
  try {
    const r = new RigInstance(geo, { material: mat, castShadow: true });
    for (const p of ['thigh_l', 'thigh_r', 'shin_l', 'shin_r']) r.setPartVisible(p, false);
    r.setExpression('focus');
    const n = r.nodes;
    if (n.jaw) n.jaw.rotation.x = r.exprJaw;
    n.brow_l?.rotation.set(0, 0, r.exprBrow[0]);
    n.brow_r?.rotation.set(0, 0, r.exprBrow[1]);
    // chin down, a quarter turn: the brim swallows the eyes
    n.head?.rotation.set(0.16, -0.14, 0.03);
    n.torso?.rotation.set(0.03, 0.18, 0);
    n.arm_l?.rotation.set(0.05, 0, 0.1);
    n.arm_r?.rotation.set(0.05, 0, -0.1);
    const root = new THREE.Group();
    root.add(r.root);
    root.updateMatrixWorld(true);
    const H = (n.head ?? r.root).getWorldPosition(new THREE.Vector3());
    // the head pivot is the neck: frame from the chest to the crown of the hat (from the rig's own heights)
    const top = ((geo.spec.meta?.hatTop as number) ?? H.y + 0.6) + 0.03, bot = H.y - 0.3;
    const cy = (top + bot) / 2, fov = (2 * Math.atan(((top - bot) * 1.12) / 2 / 2.75) * 180) / Math.PI;
    const shot: Shot = {
      root,
      cam: { pos: [H.x + 0.32, cy + 0.14, H.z + 2.75], look: [H.x + 0.02, cy, H.z], fov },
      sky: { zenith: 0x3a2c44, mid: 0xb0684a, horizon: 0xffd49a, ground: 0x6a4630, sunDir: [-0.15, 0.1, -1], sunColor: 0xffe2b0, sunSize: 0, sunGlow: 0.55, sunGain: 1.2, gain: 0.95 },
      // a high, hard sun from the front: the brim's shadow falls across the eyes, the bandana stays in the light
      key: { dir: [0.28, 1.0, 0.42], color: 0xffe2b8, intensity: 3.6, center: [H.x, H.y, H.z], radius: 1.0 },
      hemi: { sky: 0x2a2440, ground: 0x3a2418, intensity: 0.22 },
      rim: { dir: [-0.7, 0.45, -1], color: 0xffbf80, intensity: 3.2 },
      // bloom only on the eyes (a hot sky must not wash the silhouette)
      grade: { exposure: 0.92, contrast: 1.2, sat: 1.1, vignette: 0.7, bloom: [0.35, 0.3, 1.5], grain: 0 },
      ink: { thick: 0.9 },
      env: 0.12,
      display: 'screen',
    };
    return studio.shoot(shot, PORTRAIT_W, PORTRAIT_H, 4);
  } catch (e) {
    console.warn('[wanted] portrait failed', e);
    return null;
  } finally {
    studio.dispose();
    mat.dispose();
  }
}

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/**
 * Print a photograph with the frontier press: sepia inks by brightness (bright sky =
 * bare paper), the red bandana in red ink, glowing eyes in luminous green, all
 * ordered-dithered on the pixel grid. Returns an ink layer (transparent = paper).
 */
export function pressPrint(photo: HTMLCanvasElement): HTMLCanvasElement {
  const w = photo.width, h = photo.height;
  const src = photo.getContext('2d')!.getImageData(0, 0, w, h).data;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const out = c.createImageData(w, h);
  const ramp = [...INK.map(rgb), null];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const r = src[k] / 255, g = src[k + 1] / 255, b = src[k + 2] / 255;
      const l = r * 0.3 + g * 0.59 + b * 0.11;
      const d = BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47;
      let col: number[] | null;
      if (g > 0.42 && g > r * 1.3 && g > b * 1.45) col = rgb(EYE[g > 0.75 ? 1 : 0]);
      else if (r > 0.2 && r > g * 2.1 && r > b * 1.9) {
        const v = Math.min(1, l * 3.2) + d * 0.9;
        col = v < 0.3 ? rgb(INK[0]) : rgb(RED[v < 0.75 ? 0 : 1]);
      } else {
        // a press curve: shadows crushed, the sky bleached out to paper
        const t = Math.pow(Math.min(1, Math.max(0, (l - 0.05) / 0.72)), 0.95);
        const i = Math.max(0, Math.min(4, Math.round(t * 4 + d)));
        col = ramp[i];
      }
      if (col) {
        out.data[k] = col[0];
        out.data[k + 1] = col[1];
        out.data[k + 2] = col[2];
        out.data[k + 3] = 255;
      }
    }
  c.putImageData(out, 0, 0);
  return cv;
}

/** the whole sheet's ink: Alagard lettering at pixel sizes + the pressed portrait */
export function paintWantedPrint(print: HTMLCanvasElement | null, cv = document.createElement('canvas')) {
  const W = PRINT_W, H = PRINT_H;
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.clearRect(0, 0, W, H);
  c.imageSmoothingEnabled = false;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  const line = (s: string, sizes: number[], y: number, col: string) => {
    let size = sizes[sizes.length - 1], w = 0;
    for (const z of sizes) {
      c.font = `${z}px Alagard`;
      w = c.measureText(s).width;
      size = z;
      if (w <= W - 8) break;
    }
    c.font = `${size}px Alagard`;
    w = c.measureText(s).width;
    c.fillStyle = col;
    const sx = Math.min(1, (W - 8) / Math.max(1, w));
    c.save();
    c.translate(Math.round(W / 2 - (w * sx) / 2), y);
    c.scale(sx, 1);
    c.fillText(s, 0, 0);
    c.restore();
  };
  line('WANTED', [32, 24], 5, TEXT_INK);
  line('DEAD  OR  ALIVE', [16], 36, TEXT_RED);
  line('SUNDOWN', [32, 24], 141, TEXT_INK);
  line('NAME  UNKNOWN', [16], 171, TEXT_SEPIA);
  line('REWARD', [16], 187, TEXT_INK);
  line('$ 1,000,000', [24, 16], 203, TEXT_RED);
  // hard pixels: no anti-aliasing fringe, every pixel one of the inks
  const id = c.getImageData(0, 0, W, H);
  const d = id.data;
  const pal = [TEXT_INK, TEXT_RED, TEXT_SEPIA].map((s) => rgb(parseInt(s.slice(1), 16)));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 120) {
      d[i + 3] = 0;
      continue;
    }
    let best = pal[0], bd = 1e9;
    for (const p of pal) {
      const e = (p[0] - d[i]) ** 2 + (p[1] - d[i + 1]) ** 2 + (p[2] - d[i + 2]) ** 2;
      if (e < bd) (bd = e), (best = p);
    }
    d[i] = best[0];
    d[i + 1] = best[1];
    d[i + 2] = best[2];
    d[i + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  if (print) c.drawImage(print, Math.round(W / 2 - print.width / 2), 54);
  return cv;
}
