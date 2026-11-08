// THOTH'S HALL, the main menu's way in: a glowing magic sign constructed of knowledge.
// A ring of flying books (rigged, flapping) circles in the dusk air; out of their open
// pages stream glyphs (ankh, eye, feather, scarab: pixel-art motes) and threads of light
// that build the words THOTH'S / HALL letter by letter. The letters are sculpted voxel
// type: a pale-gold face that glows, engraved with rows of tiny hieroglyphs, a gold edge
// and a lapis back. Once built it breathes: the letters bob, the glyphs keep flowing, the
// books circle. Hover lights it up and the books flap harder; a click bursts it open.
//
//   const sign = new KnowledgeSign(particles);  scene.add(sign.group);  sign.group.position...
//   sign.update(dt, hot)   (hot 0..1)
//   sign.proxy             an invisible box for raycasts
//   sign.burst()           the click
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance } from '../../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { alagardMask } from '../../models/props/menuSet';
import type { Particles } from '../../fx/Particles';
import { flyingBookRig, GLYPH_BITMAPS } from './HallModels';

const VS = 1 / 52;
const FACE = [0x5ad4f8, 0x3ab8ec, 0x2a9ee0];
const RIM = 0xe8fcff;
const EDGE = [0xf2c443, 0xc9952a];
const BACK = 0x14205a;
const INSET = 0x102060;

interface Letter {
  mesh: THREE.Mesh;
  mat: VoxelMaterial;
  home: THREE.Vector3;
  k: number;
  at: number;
  ph: number;
}

/** one line of voxel type from an Alagard mask: one mesh per letter (split at the empty columns) */
function wordLetters(text: string, px: number, seed: number) {
  const g = alagardMask(text, px);
  // split into letters at empty columns
  const cols: boolean[] = [];
  for (let x = 0; x < g.w; x++) {
    let any = false;
    for (let y = 0; y < g.h; y++) if (g.on(x, y)) any = true;
    cols.push(any);
  }
  const spans: [number, number][] = [];
  let x0 = -1;
  for (let x = 0; x <= g.w; x++) {
    if (x < g.w && cols[x]) {
      if (x0 < 0) x0 = x;
    } else if (x0 >= 0) {
      spans.push([x0, x - 1]);
      x0 = -1;
    }
  }
  const out: { geo: THREE.BufferGeometry; cx: number }[] = [];
  spans.forEach(([a, b], li) => {
    const m = new VoxelModel('sign_letter');
    const cx = (a + b) / 2;
    const on = (x: number, y: number) => x >= a && x <= b && g.on(x, y);
    for (let x = a - 2; x <= b + 2; x++)
      for (let y = -2; y < g.h + 2; y++) {
        const lx = x - cx, ly = g.h - 1 - y;
        if (!on(x, y)) {
          // a dark lapis border round every stroke: the bright type reads against any sky
          let near = false;
          for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2 && on(x + dx, y + dy)) near = true;
          if (near) {
            m.set(lx, ly, 0, BACK, 0);
            m.set(lx, ly, -1, BACK, 0);
          }
          continue;
        }
        const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
        const rim = !edge && (!on(x - 2, y) || !on(x, y - 2));
        // the face: magic blue, engraved with rows of tiny glyphs (a glyph every 7 columns, every 9 rows)
        const gl = GLYPH_BITMAPS[(Math.floor(x / 7) + Math.floor(ly / 9) * 3 + seed + li) % GLYPH_BITMAPS.length];
        const gx = ((x % 7) + 7) % 7, gy = 8 - (((ly % 9) + 9) % 9);
        const ink = !edge && !rim && gl[gy]?.[gx] === '#';
        const face = edge ? EDGE[0] : rim ? RIM : ink ? INSET : FACE[(ly >> 2) % 3];
        m.set(lx, ly, 2, face, edge ? VF.METAL | VF.EMISSIVE : ink ? 0 : VF.GLOW);
        m.set(lx, ly, 1, EDGE[1], VF.METAL);
        m.set(lx, ly, 0, EDGE[1], VF.METAL);
        m.set(lx, ly, -1, BACK, 0);
      }
    out.push({ geo: buildVoxelGeometry(m, { voxelSize: VS, pivot: [0, 0, 0] }), cx });
  });
  return { letters: out, w: g.w, h: g.h };
}

export class KnowledgeSign {
  group = new THREE.Group();
  /** raycast target (invisible) */
  proxy: THREE.Mesh;
  private letters: Letter[] = [];
  private books: { rig: RigInstance; a: number; r: number; y: number; sp: number; flap: number; flip: number }[] = [];
  private light: THREE.PointLight;
  private t = 0;
  private hot = 0;
  private burstT = -1;
  private geos: THREE.BufferGeometry[] = [];

  constructor(private particles: Particles) {
    // the two lines of type
    const top = wordLetters("THOTH'S", 26, 1), bot = wordLetters('HALL', 34, 4);
    const lineH = top.h * VS;
    const place = (ln: ReturnType<typeof wordLetters>, y: number, delay: number) => {
      ln.letters.forEach((l, i) => {
        const mat = makeVoxelMaterial({ emissiveStrength: 1 });
        const mesh = new THREE.Mesh(l.geo, mat);
        mesh.castShadow = false;
        this.geos.push(l.geo);
        const home = new THREE.Vector3((l.cx - ln.w / 2) * VS, y, 0);
        mesh.position.copy(home);
        mesh.scale.setScalar(0.001);
        this.group.add(mesh);
        this.letters.push({ mesh, mat, home, k: 0, at: delay + i * 0.32, ph: i * 0.9 + y });
      });
    };
    place(top, bot.h * VS + 0.08, 0.6);
    place(bot, 0, 0.6 + top.letters.length * 0.32 + 0.2);
    // the hit box
    const W = Math.max(top.w, bot.w) * VS + 0.3, H = (top.h + bot.h) * VS + 0.4;
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.set(0, H / 2 - 0.15, 0);
    this.group.add(this.proxy);
    // a ring of books circling the words
    for (let k = 0; k < 7; k++) {
      const rig = new RigInstance(buildRigGeo(flyingBookRig(k % 5), 'sign:book:' + (k % 5)), { castShadow: false });
      rig.root.scale.setScalar(1.05);
      this.group.add(rig.root);
      this.books.push({ rig, a: (k / 7) * Math.PI * 2, r: 1.25 + (k % 3) * 0.12, y: -0.05 + (k % 4) * 0.3, sp: 0.32 + (k % 3) * 0.05, flap: k, flip: -1 });
    }
    // the glow it throws on the sand and the camp
    this.light = new THREE.PointLight(0x9ac8ff, 0, 6, 2);
    this.light.position.set(0, lineH, 0.6);
    this.group.add(this.light);
  }

  /** a click: the letters jump, the books scatter a little, a shower of glyphs */
  burst() {
    this.burstT = 0;
    const p = this.group.getWorldPosition(new THREE.Vector3());
    this.particles.emit({ pos: { x: p.x, y: p.y + 0.5, z: p.z }, count: 50, spread: 2.6, up: 1.2, life: [0.6, 1.4], size: [0.1, 0.02], sprite: ['ankh', 'eye', 'feather', 'scarab', 'star4'], color: [0xffe08a, 0xbfe0ff, 0xffffff], additive: true, drag: 1.4 });
  }

  update(dt: number, hot: number) {
    this.t += dt;
    const t = this.t;
    this.hot += (hot - this.hot) * (1 - Math.exp(-dt * 8));
    const h = this.hot;
    this.group.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    // letters: built one by one as their glyph stream arrives, then they breathe
    let built = 0;
    for (const l of this.letters) {
      const since = t - l.at;
      if (since > 0) l.k = Math.min(1, l.k + dt * 2.2);
      if (l.k >= 1) built++;
      const e = l.k <= 0 ? 0.001 : 1 + Math.sin(Math.min(1, l.k) * Math.PI) * 0.35 - (1 - l.k) * 0.9;
      const jump = this.burstT >= 0 ? Math.sin(Math.min(1, this.burstT * 3 - l.ph * 0.05) * Math.PI) * 0.08 : 0;
      l.mesh.scale.setScalar(Math.max(0.001, e) * (1 + h * 0.05));
      l.mesh.position.set(l.home.x, l.home.y + Math.sin(t * 1.3 + l.ph) * 0.02 + jump, l.home.z + Math.sin(t * 0.9 + l.ph) * 0.015);
      l.mesh.rotation.y = Math.sin(t * 0.7 + l.ph) * 0.06;
      l.mesh.rotation.z = Math.sin(t * 0.8 + l.ph * 1.3) * 0.02;
      // the stream that builds it: glyph motes flying in from a book while it grows
      if (since > -0.6 && l.k < 1 && Math.random() < dt * 40) {
        const b = this.books[Math.floor(Math.random() * this.books.length)];
        b.rig.root.getWorldPosition(wp);
        const tgt = l.mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
        const v = tgt.clone().sub(wp).multiplyScalar(1.6);
        this.particles.emit({ pos: wp, vel: v, count: 1, life: [0.55, 0.65], size: [0.09, 0.05], sprite: ['ankh', 'eye', 'feather', 'scarab'], color: [0xffe08a, 0xbfe0ff], additive: true, drag: 0.2 });
      }
    }
    if (this.burstT >= 0) {
      this.burstT += dt;
      if (this.burstT > 1.2) this.burstT = -1;
    }
    // the books circle (faster when hot), open pages up, flapping
    for (const b of this.books) {
      b.a += dt * b.sp * (1 + h * 1.4);
      const x = Math.cos(b.a) * b.r * 1.25, z = Math.sin(b.a) * b.r * 0.32 - 0.22;
      const y = b.y + Math.sin(t * 0.9 + b.a * 2) * 0.12;
      b.rig.root.position.set(x, y, z);
      b.rig.root.rotation.set(0.25, -b.a + Math.PI, Math.sin(t + b.a) * 0.2, 'YXZ');
      b.flap += dt * (3 + h * 5);
      const fl = 0.5 + Math.sin(b.flap) * 0.5;
      b.rig.nodes['cover_l'].rotation.z = 0.5 + fl * 0.8;
      b.rig.nodes['cover_r'].rotation.z = -(0.5 + fl * 0.8);
      if (b.flip < 0 && Math.random() < dt * 0.3) b.flip = 0;
      if (b.flip >= 0) {
        b.flip += dt * 1.8;
        b.rig.nodes['leaf'].rotation.z = 0.6 - Math.min(1, b.flip) * 1.2;
        if (b.flip > 1.5) b.flip = -1;
      }
      // threads of light: a mote now and then from an open book to the words
      if (built > 0 && Math.random() < dt * (1.6 + h * 5)) {
        b.rig.root.getWorldPosition(wp);
        const l = this.letters[Math.floor(Math.random() * this.letters.length)];
        if (l.k >= 1) {
          const tgt = l.mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
          this.particles.emit({ pos: wp, vel: tgt.sub(wp).multiplyScalar(1.1), count: 1, life: [0.8, 0.95], size: [0.035, 0.02], sprite: Math.random() < 0.7 ? 'dot2' : 'star4', color: Math.random() < 0.5 ? 0xbfe0ff : 0xffe08a, additive: true, stretch: 0.6 });
        }
      }
    }
    // sparkle off the letters
    if (built > 0 && Math.random() < dt * (4 + h * 10)) {
      const l = this.letters[Math.floor(Math.random() * this.letters.length)];
      if (l.k >= 1) {
        l.mesh.getWorldPosition(wp);
        this.particles.emit({ pos: { x: wp.x + (Math.random() - 0.5) * 0.2, y: wp.y + Math.random() * 0.4, z: wp.z + 0.05 }, count: 1, spread: 0.05, up: 0.1, life: [0.4, 0.8], size: [0.07, 0.01], sprite: 'star4', color: 0xfff0c0, additive: true });
      }
    }
    if (built > 0 && Math.random() < dt * 6) {
      const l = this.letters[Math.floor(Math.random() * this.letters.length)];
      if (l.k >= 1) {
        l.mesh.getWorldPosition(wp);
        this.particles.emit({ pos: { x: wp.x, y: wp.y + 0.16, z: wp.z - 0.1 }, count: 1, life: [1.6, 2.4], size: [0.55, 0.7], sprite: 'glow32', color: 0x5ac8ff, alpha: 0.16 + h * 0.12, additive: true, fadeIn: 0.8 });
      }
    }
    const lit = built / Math.max(1, this.letters.length);
    // a shimmer runs along the words now and then; a letter flares as it lands
    const wave = (t * 0.55) % 3.2;
    this.letters.forEach((l, i) => {
      const x = i / Math.max(1, this.letters.length - 1);
      const sh = Math.max(0, 1 - Math.abs(wave - x * 1.2 - 0.4) * 4);
      const land = l.k > 0 && l.k < 1 ? 1.2 : 0;
      (l.mat.userData.emissiveStrength as { value: number }).value = 1.05 + sh * 0.9 + h * 0.8 + land + (this.burstT >= 0 ? 0.9 : 0);
    });
    this.light.intensity = (2.2 + h * 3 + Math.sin(t * 2.3) * 0.3) * lit;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.proxy.geometry.dispose();
    for (const l of this.letters) l.mat.dispose();
    for (const b of this.books) b.rig.dispose();
    this.group.removeFromParent();
  }
}
