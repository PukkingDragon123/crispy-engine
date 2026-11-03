// The ability bar as floating tarot cards (Rider–Waite style: cream border,
// Roman numeral, flat colour scene, title in caps). Each card's figure is the
// real 3D Sundown skeleton posed for that card and photographed through the
// IconFactory (pixel finish + ink outline), then painted into the card.
//   Q hook     XII  THE HANGED MAN — upside down on the rope
//   E scorpions I   THE MAGICIAN   — revolver raised, Pinch below
//   C swarm    XVI  THE TOWER      — arms flung wide, the sky splits
//   G dung     XIX  THE SUN        — the dung-sun held overhead
//   F kick     VIII STRENGTH       — mid-kick
//   Z ult      XIII DEATH          — still, with the scorpion banner
import * as THREE from 'three';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { modelEntry } from '../models/lookup';
import { IconFactory } from './IconFactory';

export interface TarotDef {
  key: string;
  num: string;
  title: string;
  sky: string;
  ground: string;
  motif: 'tree' | 'infinity' | 'tower' | 'sun' | 'mountain' | 'banner';
  pose: string;
  burst: number[]; // particle colours on use
}

export const TAROT: TarotDef[] = [
  { key: 'Q', num: 'XII', title: 'THE HANGED MAN', sky: '#9fd0df', ground: '#7a9a4a', motif: 'tree', pose: 'hanged', burst: [0xc8a050, 0xfff3d6, 0x7a5a3a] },
  { key: 'E', num: 'I', title: 'THE MAGICIAN', sky: '#f2c84b', ground: '#b0504a', motif: 'infinity', pose: 'magician', burst: [0x9dff3a, 0xfff3d6, 0xe0402c] },
  { key: 'C', num: 'XVI', title: 'THE TOWER', sky: '#56607a', ground: '#4a3a30', motif: 'tower', pose: 'tower', burst: [0xffd36b, 0xffffff, 0x9a8a72] },
  { key: 'G', num: 'XIX', title: 'THE SUN', sky: '#f2c84b', ground: '#8aa04a', motif: 'sun', pose: 'sun', burst: [0xffe08a, 0xf2a43a, 0x7a5530] },
  { key: 'F', num: 'VIII', title: 'STRENGTH', sky: '#f2c84b', ground: '#7a9a4a', motif: 'mountain', pose: 'kick', burst: [0xfff3d6, 0xe0b373, 0xffd36b] },
  { key: 'Z', num: 'XIII', title: 'DEATH', sky: '#3a2c3a', ground: '#2a2024', motif: 'banner', pose: 'death', burst: [0x9dff3a, 0xfff3d6, 0x2a2024] },
];

const W = 128, H = 208; // card art pixels
const ART = { x: 9, y: 24, w: 110, h: 156 };
const INK = '#1a0e08';

function poseRig(r: RigInstance, pose: string) {
  r.resetPose();
  const n = r.nodes;
  const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
  switch (pose) {
    case 'hanged': // the classic figure-four, hands behind the back
      set('thigh_r', 0.2, 0, -0.1);
      set('thigh_l', -1.2, 0, 0.5);
      set('shin_l', 2.0);
      set('arm_l', 0.5, 0, 0.35);
      set('arm_r', 0.5, 0, -0.35);
      set('fore_l', -1.6);
      set('fore_r', -1.6);
      set('head', -0.25);
      r.root.rotation.set(0, 0, Math.PI);
      break;
    case 'magician': // one hand to the sky, one to the ground
      set('arm_r', -2.9, 0, -0.15);
      set('fore_r', -0.2);
      set('arm_l', -0.3, 0, 0.55);
      set('fore_l', -0.3);
      set('head', 0.18, 0.2);
      set('torso', 0.05, -0.15);
      break;
    case 'tower': // flung wide, falling back
      set('arm_r', -2.2, 0, -1.0);
      set('arm_l', -2.2, 0, 1.0);
      set('head', -0.45);
      set('torso', -0.25);
      set('thigh_l', -0.5);
      set('shin_l', 0.9);
      set('thigh_r', 0.25);
      break;
    case 'sun': // holding the sun overhead
      set('arm_r', -2.8, 0, -0.25);
      set('arm_l', -2.8, 0, 0.25);
      set('fore_r', -0.5);
      set('fore_l', -0.5);
      set('head', -0.3);
      set('thigh_l', -0.25);
      set('thigh_r', 0.15);
      break;
    case 'kick': // STRENGTH: a roundhouse kick
      set('thigh_r', -1.75, 0.2, 0);
      set('shin_r', 0.15);
      set('thigh_l', 0.15);
      set('shin_l', 0.3);
      set('arm_l', -1.2, 0, 1.0);
      set('arm_r', 0.6, 0, -0.6);
      set('torso', 0.25, 0.3);
      set('head', -0.1, -0.3);
      break;
    case 'death': // standing still, gun lowered, hat tipped
      set('arm_r', -0.15, 0, -0.12);
      set('fore_r', -0.3);
      set('arm_l', -0.6, 0, 0.3);
      set('fore_l', -1.8);
      set('head', 0.25, 0.15);
      break;
  }
  r.root.updateMatrixWorld(true);
}

function px(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function paintMotif(c: CanvasRenderingContext2D, d: TarotDef) {
  const { x, y, w, h } = ART;
  const cx = x + w / 2;
  switch (d.motif) {
    case 'sun': {
      // rays: alternating straight and wavy, the deck's sun
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r0 = 15, r1 = i % 2 ? 30 : 38;
        for (let t = r0; t < r1; t++) px(c, cx + Math.cos(a) * t - 1, y + 30 + Math.sin(a) * t - 1, 2, 2, i % 2 ? '#f6a93a' : '#ffe48a');
      }
      for (let yy = -14; yy <= 14; yy++)
        for (let xx = -14; xx <= 14; xx++) if (xx * xx + yy * yy <= 196) px(c, cx + xx, y + 30 + yy, 1, 1, xx * xx + yy * yy > 160 ? INK : '#ffd03a');
      // sunflowers along the wall
      for (let i = 0; i < 5; i++) {
        const fx = x + 8 + i * 24;
        px(c, fx, y + h - 40, 2, 16, '#4a7a2a');
        px(c, fx - 4, y + h - 46, 10, 8, '#f6c02a');
        px(c, fx - 1, y + h - 43, 4, 3, '#6a3a1a');
      }
      px(c, x, y + h - 26, w, 4, '#c0703a');
      break;
    }
    case 'tower': {
      // storm sky, the tower struck, its crown blown off, lightning
      px(c, cx + 14, y + 40, 24, 100, '#9a8a7a');
      for (let yy = 0; yy < 100; yy += 8) px(c, cx + 14, y + 40 + yy, 24, 1, INK);
      px(c, cx + 10, y + 30, 32, 10, '#c9a050');
      for (let i = 0; i < 4; i++) px(c, cx + 18 + i * 5, y + 60 + i * 18, 4, 6, '#ffd36b');
      let lx = cx - 30, ly = y + 2;
      for (let i = 0; i < 9; i++) {
        const nx = lx + (i % 2 ? 6 : 3), ny = ly + 4;
        px(c, lx, ly, 3, 5, '#ffffff');
        lx = nx;
        ly = ny;
      }
      for (let i = 0; i < 14; i++) px(c, x + ((i * 37) % w), y + 10 + ((i * 53) % 60), 2, 2, '#ffd36b');
      break;
    }
    case 'infinity': {
      // the lemniscate above the head, a table with the four suits
      for (let t = 0; t < 120; t++) {
        const a = (t / 120) * Math.PI * 2;
        const s = 1 + Math.sin(a) ** 2;
        px(c, cx + (14 * Math.cos(a)) / s - 1, y + 14 + (14 * Math.sin(a) * Math.cos(a)) / s - 1, 2, 2, INK);
      }
      px(c, x + 6, y + h - 52, w - 12, 6, '#b0703a');
      px(c, x + 6, y + h - 52, w - 12, 1, INK);
      px(c, x + 14, y + h - 46, 3, 20, '#8a5a2a');
      px(c, x + w - 18, y + h - 46, 3, 20, '#8a5a2a');
      px(c, x + 22, y + h - 60, 6, 8, '#e2c050');
      px(c, x + 36, y + h - 58, 9, 6, '#c9cdd4');
      // roses and lilies
      for (let i = 0; i < 6; i++) px(c, x + 6 + i * 19, y + 8, 6, 6, i % 2 ? '#e0402c' : '#fff3d6');
      break;
    }
    case 'tree': {
      // the T-beam he hangs from, leaves sprouting
      px(c, x + 10, y + 6, w - 20, 8, '#8a5a2a');
      px(c, x + 14, y + 14, 7, h - 30, '#8a5a2a');
      px(c, x + w - 21, y + 14, 7, h - 30, '#8a5a2a');
      for (let i = 0; i < 8; i++) px(c, x + 12 + i * 13, y + 2 + (i % 2) * 2, 5, 4, '#5a8a3a');
      // the halo
      for (let t = 0; t < 60; t++) {
        const a = (t / 60) * Math.PI * 2;
        px(c, cx + Math.cos(a) * 12 - 1, y + h - 46 + Math.sin(a) * 12 - 1, 2, 2, '#ffd36b');
      }
      break;
    }
    case 'mountain': {
      for (let i = 0; i < 3; i++) {
        const mx = x + 10 + i * 38, mh = 30 + (i % 2) * 14;
        for (let yy = 0; yy < mh; yy++) px(c, mx + yy * 0.5, y + h - 40 - yy, Math.max(1, 30 - yy), 1, i % 2 ? '#7a8ab0' : '#9aa8c8');
      }
      for (let t = 0; t < 60; t++) {
        const a = (t / 60) * Math.PI * 2;
        const s = 1 + Math.sin(a) ** 2;
        px(c, cx + (12 * Math.cos(a)) / s - 1, y + 10 + (12 * Math.sin(a) * Math.cos(a)) / s - 1, 2, 2, INK);
      }
      break;
    }
    case 'banner': {
      // the black banner with a pale scorpion, a low sun between two towers
      px(c, x + 12, y + 8, 3, 90, '#c9a050');
      px(c, x + 15, y + 10, 34, 26, '#141014');
      px(c, x + 26, y + 16, 12, 4, '#e8e0d0');
      px(c, x + 22, y + 20, 20, 3, '#e8e0d0');
      px(c, x + 38, y + 12, 3, 8, '#e8e0d0');
      for (let i = 0; i < 2; i++) px(c, x + 70 + i * 26, y + 80, 12, 60, '#5a4a5a');
      for (let yy = -9; yy <= 0; yy++) for (let xx = -9; xx <= 9; xx++) if (xx * xx + yy * yy <= 81) px(c, x + 88 + xx, y + 94 + yy, 1, 1, '#f2a43a');
      break;
    }
  }
}

/** the full card face (128×208 art pixels) */
export function paintTarot(d: TarotDef, figure: HTMLCanvasElement | null) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  // card stock: aged cream with a thin ink frame
  px(c, 0, 0, W, H, '#efe3c4');
  for (let i = 0; i < 260; i++) px(c, (i * 47) % W, (i * 89) % H, 1, 1, i % 3 ? '#e4d5b2' : '#f7edd5');
  px(c, 4, 4, W - 8, H - 8, INK);
  px(c, 5, 5, W - 10, H - 10, '#efe3c4');
  // numeral
  c.fillStyle = INK;
  c.font = '16px Alagard';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillText(d.num, W / 2, 6);
  // the scene window
  const { x, y, w, h } = ART;
  px(c, x - 1, y - 1, w + 2, h + 2, INK);
  px(c, x, y, w, h, d.sky);
  paintMotif(c, d);
  px(c, x, y + h - 22, w, 22, d.ground);
  px(c, x, y + h - 22, w, 1, INK);
  for (let i = 0; i < 9; i++) px(c, x + 4 + i * 12, y + h - 16 + (i % 2) * 5, 4, 3, i % 3 ? '#f2e2a0' : '#e0402c');
  // the figure: the posed 3D skeleton, photographed
  if (figure) {
    const fw = figure.width, fh = figure.height;
    const fx = Math.round(x + (w - fw) / 2), fy = Math.round(y + h - 8 - fh);
    c.drawImage(figure, fx, fy);
    if (d.motif === 'tree') {
      // the rope from the beam to his ankle
      px(c, x + w / 2, y + 14, 1, Math.max(2, fy - y - 10), '#c9a050');
    }
  }
  // title band
  px(c, 9, H - 24, W - 18, 1, INK);
  c.fillStyle = INK;
  c.font = '16px Alagard';
  c.textBaseline = 'top';
  const title = d.title + '.';
  const tw = c.measureText(title).width;
  const sc = Math.min(1, (W - 20) / tw);
  c.save();
  c.translate(W / 2, H - 21);
  c.scale(sc, 1);
  c.fillText(title, 0, 0);
  c.restore();
  return cv;
}

/** render every card (figures captured from the 3D rig); returns canvases keyed by skill key */
export function buildTarotFaces(renderer: THREE.WebGLRenderer, heroGeo: RigGeo | null): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
  const factory = new IconFactory(renderer);
  let rig: RigInstance | null = null;
  const holder = new THREE.Group();
  if (heroGeo) {
    rig = new RigInstance(heroGeo, { material: makeVoxelMaterial({ fog: false }), castShadow: false });
    holder.add(rig.root);
    // props held in some poses
    const ball = modelEntry('dung_ball')?.() as any;
    if (ball?.model) {
      const m = new THREE.Mesh(buildVoxelGeometry(ball.model, { voxelSize: ball.voxelSize * 2.6, pivot: 'center' }), makeVoxelMaterial({ fog: false }));
      m.name = 'sunball';
      m.visible = false;
      holder.add(m);
    }
    const ps = modelEntry('pinch')?.() as RigSpec | undefined;
    if (ps?.parts) {
      const p = new RigInstance(buildRigGeo(ps, ps.name + ':card'), { material: makeVoxelMaterial({ fog: false }), castShadow: false });
      p.root.name = 'pinch';
      p.root.visible = false;
      if (!rig.attach('shoulder_l', p.root)) holder.add(p.root);
    }
  }
  for (const d of TAROT) {
    let fig: HTMLCanvasElement | null = null;
    if (rig) {
      poseRig(rig, d.pose);
      const sun = holder.getObjectByName('sunball');
      if (sun) {
        sun.visible = d.pose === 'sun';
        const hh = (rig.geo.spec.meta?.height as number) ?? 1.8;
        sun.position.set(0, hh * 1.18, 0.05);
      }
      const pinch = holder.getObjectByName('pinch');
      if (pinch) pinch.visible = d.pose === 'magician' || d.pose === 'death';
      try {
        fig = factory.capture(holder, { w: 96, h: d.pose === 'hanged' ? 120 : 136, yaw: d.pose === 'kick' ? 1.2 : d.pose === 'hanged' ? 0.2 : 0.45, pitch: d.pose === 'death' ? -0.08 : 0.1, fill: 0.9, light: d.pose === 'death' ? 'moon' : d.pose === 'tower' ? 'moon' : 'studio' });
      } catch (e) {
        console.warn('[tarot] capture failed', e);
      }
    }
    out[d.key] = paintTarot(d, fig);
  }
  rig?.resetPose();
  factory.dispose();
  return out;
}
