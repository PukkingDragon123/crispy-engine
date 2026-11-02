// Parchment notices that drop in front of the camera (mission offers, outlaw
// encounters, choice events). Hover tilts toward the cursor, click or 1-4 picks.
// Pauses the world while open.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { Ease } from '../../engine/Tween';
import { damp } from '../../engine/math/rand';

export interface ChoiceOption {
  title: string;
  body: string;
  footer?: string;
  accent?: string;
  /** big rubber stamp across the card (e.g. 'WANTED', 'DEAL') */
  stamp?: string;
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function paintNotice(o: ChoiceOption, W = 256, H = 352) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  // parchment with burnt, torn edges (pixel clusters, no smooth gradients)
  const seed = o.title.length * 13;
  const h = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return s - Math.floor(s);
  };
  const P = 4;
  for (let y = 0; y < H; y += P)
    for (let x = 0; x < W; x += P) {
      const ex = Math.min(x, W - P - x), ey = Math.min(y, H - P - y);
      const edge = Math.min(ex, ey);
      const tear = h(Math.floor(x / 8), Math.floor(y / 8)) * 10;
      if (edge < tear - 4) continue;
      let col = h(x, y) < 0.5 ? '#ecd9ae' : '#e4cf9f';
      if (h(x * 0.3, y * 0.3) < 0.06) col = '#d7bf8b';
      if (edge < tear + 2) col = '#6a4020';
      else if (edge < tear + 6) col = '#a8783e';
      else if (edge < tear + 12) col = '#d2b07a';
      c.fillStyle = col;
      c.fillRect(x, y, P, P);
    }
  // nail at the top
  c.fillStyle = '#3a3a3e';
  c.fillRect(W / 2 - 6, 10, 12, 12);
  c.fillStyle = '#8a8c92';
  c.fillRect(W / 2 - 4, 12, 4, 4);
  const ink = '#2a1a10';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillStyle = o.accent ?? '#8a2a18';
  c.font = '32px Alagard';
  let y = 32;
  for (const l of wrap(c, o.title.toUpperCase(), W - 36)) {
    c.fillText(l, W / 2, y);
    y += 30;
  }
  // rule
  c.fillStyle = ink;
  c.fillRect(28, y + 4, W - 56, 3);
  c.fillRect(W / 2 - 3, y + 1, 6, 9);
  y += 20;
  c.fillStyle = ink;
  c.font = '16px Alagard';
  for (const l of wrap(c, o.body, W - 40)) {
    c.fillText(l, W / 2, y);
    y += 19;
  }
  if (o.footer) {
    c.fillStyle = '#5a3a1a';
    c.font = '16px Alagard';
    const fl = wrap(c, o.footer, W - 40);
    let fy = H - 30 - (fl.length - 1) * 18;
    for (const l of fl) {
      c.fillText(l, W / 2, fy);
      fy += 18;
    }
  }
  if (o.stamp) {
    c.save();
    c.translate(W / 2, H * 0.62);
    c.rotate(-0.22);
    c.globalAlpha = 0.75;
    c.strokeStyle = '#b02a1a';
    c.lineWidth = 4;
    c.font = '32px Alagard';
    const sw = c.measureText(o.stamp).width + 24;
    c.strokeRect(-sw / 2, -22, sw, 44);
    c.fillStyle = '#b02a1a';
    c.textBaseline = 'middle';
    c.fillText(o.stamp, 0, 2);
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

interface Card {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  hover: number;
  ready: boolean;
  tx: number;
  ty: number;
}

export class Choice {
  active = false;
  private group = new THREE.Group();
  private cards: Card[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Card | null = null;
  private resolve: ((i: number) => void) | null = null;
  private hint: HTMLDivElement;

  constructor(private ctx: Ctx, private input: Input) {
    ctx.scene.add(this.group);
    this.hint = document.createElement('div');
    this.hint.style.cssText = "position:absolute;left:50%;top:7vh;transform:translateX(-50%);font-family:'Alagard';font-size:26px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 12px #000;z-index:7;pointer-events:none;display:none;letter-spacing:1px;text-align:center";
    ctx.engine.overlay.appendChild(this.hint);
  }

  show(heading: string, options: ChoiceOption[], canCancel = true): Promise<number> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.active = true;
    this.cancelable = canCancel;
    eng.paused = true;
    eng.audio.setMuffle(0.45);
    eng.input.setWantLock(false);
    this.hint.innerHTML = `${heading}<div style="font-size:15px;opacity:.8;margin-top:6px">click or press 1-${options.length}${canCancel ? ' · ESC to walk away' : ''}</div>`;
    this.hint.style.display = 'block';
    ctx.sfx('paper_flutter', null, 0.8);
    const cam = ctx.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const center = cam.position.clone().addScaledVector(fwd, 2.1).addScaledVector(up, -0.05);
    const spacing = options.length > 2 ? 0.86 : 0.95;
    this.cards = options.map((o, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: paintNotice(o), transparent: true, alphaTest: 0.5, toneMapped: false, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 1.02), mat);
      mesh.renderOrder = 999;
      const home = center.clone().addScaledVector(right, (i - (options.length - 1) / 2) * spacing);
      const start = home.clone().addScaledVector(up, 1.6).addScaledVector(right, (i - 1) * 0.4);
      mesh.position.copy(start);
      mesh.quaternion.copy(cam.quaternion);
      this.group.add(mesh);
      const card: Card = { mesh, home, hover: 0, ready: false, tx: 0, ty: 0 };
      eng.tweens.run(0.6, (k) => {
        mesh.position.lerpVectors(start, home, k);
        mesh.quaternion.copy(cam.quaternion);
        mesh.rotateZ((1 - k) * (i % 2 ? 0.6 : -0.6));
      }, Ease.outBack, { real: true, delay: 0.08 + i * 0.12, done: () => (card.ready = true) });
      eng.tweens.after(0.08 + i * 0.12, () => ctx.sfx('card_flip', null, 0.5, 0.9 + i * 0.08), true);
      return card;
    });
    return new Promise((res) => (this.resolve = res));
  }
  private cancelable = true;

  private pick(i: number) {
    if (!this.resolve) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const res = this.resolve;
    this.resolve = null;
    this.hint.style.display = 'none';
    ctx.sfx(i >= 0 ? 'poster_slam' : 'paper_flutter', null, 0.8);
    this.cards.forEach((c, k) => {
      const from = c.mesh.position.clone();
      const to = from.clone().add(new THREE.Vector3(0, k === i ? 0.4 : -2.2, 0));
      eng.tweens.run(k === i ? 0.35 : 0.45, (t) => {
        c.mesh.position.lerpVectors(from, to, t);
        if (k === i) c.mesh.scale.setScalar(1 + t * 0.15);
        (c.mesh.material as THREE.MeshBasicMaterial).opacity = k === i ? 1 - t : 1;
      }, Ease.inQuad, { real: true, done: () => this.group.remove(c.mesh) });
    });
    eng.tweens.after(0.45, () => {
      this.active = false;
      eng.paused = false;
      eng.audio.setMuffle(0);
      eng.input.setWantLock(true);
      this.cards = [];
      res(i);
    }, true);
  }

  dispose() {
    this.hint.remove();
  }

  update(rdt: number) {
    if (!this.active || !this.resolve) return;
    const inp = this.input;
    const cam = this.ctx.camera;
    const ready = this.cards.every((c) => c.ready);
    for (let i = 0; i < this.cards.length; i++) if (ready && inp.wasPressed('Digit' + (i + 1))) return this.pick(i);
    if (this.cancelable && ready && inp.wasPressed('Escape')) return this.pick(-1);
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), cam);
    const hits = this.ray.intersectObjects(this.cards.map((c) => c.mesh), false);
    const h = hits.length ? this.cards.find((c) => c.mesh === hits[0].object) ?? null : null;
    if (h !== this.hovered) {
      if (h) this.ctx.sfx('card_hover', null, 0.5);
      this.hovered = h;
    }
    if (inp.wasPressed('Mouse0') && h && ready) return this.pick(this.cards.indexOf(h));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const c of this.cards) {
      if (!c.ready) continue;
      c.hover = damp(c.hover, c === h ? 1 : 0, 12, rdt);
      const local = c === h && hits.length ? hits[0].point.clone().sub(c.mesh.position) : new THREE.Vector3();
      c.ty = damp(c.ty, local.dot(right) * 0.6 * c.hover, 10, rdt);
      c.tx = damp(c.tx, -local.dot(upv) * 0.5 * c.hover, 10, rdt);
      c.mesh.position.copy(c.home).addScaledVector(fwd, -0.3 * c.hover).addScaledVector(upv, 0.06 * c.hover + Math.sin(performance.now() / 700 + c.home.x * 3) * 0.012);
      c.mesh.quaternion.copy(cam.quaternion);
      c.mesh.rotateY(c.ty);
      c.mesh.rotateX(c.tx);
      c.mesh.rotateZ(Math.sin(performance.now() / 900 + c.home.y) * 0.02);
    }
  }
}
