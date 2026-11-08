// Text that lives in the 3D world: dialogue lines that type themselves out next
// to the speaker, glowing location titles, clickable response plaques. Alagard
// typography on a canvas texture, billboarded toward the camera, drawn on top
// with a soft glow (bloom catches it), a gentle float and fade.
import * as THREE from 'three';

export interface FloatTextOpts {
  /** world height of one text line (m) */
  size?: number;
  color?: string;
  glow?: string;
  /** canvas pixels per line */
  px?: number;
  /** characters per second for the typewriter (0 = instant) */
  cps?: number;
  /** wrap after this many characters */
  wrap?: number;
  align?: 'center' | 'left';
  /** HDR multiplier so bloom picks the glow up */
  hdr?: number;
}

export class FloatText3D {
  mesh: THREE.Mesh;
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private full = '';
  private shown = -1;
  private prog = 0;
  private lines: string[] = [];
  private fade = 0;
  private fadeTarget = 1;
  private t = Math.random() * 10;
  anchor = new THREE.Vector3();
  hover = 0;
  private base = new THREE.Vector2(1, 1);
  private o: Required<FloatTextOpts>;

  constructor(text: string, opts: FloatTextOpts = {}) {
    this.o = { size: 0.32, color: '#fff3d6', glow: '#ffb070', px: 64, cps: 38, wrap: 34, align: 'center', hdr: 1.5, ...opts };
    this.c = this.cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 });
    this.mat.color.setScalar(this.o.hdr);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 990;
    this.mesh.frustumCulled = false;
    this.setText(text);
  }

  setText(text: string, instant = false) {
    this.full = text;
    this.lines = wrapText(text, this.o.wrap);
    this.prog = instant || this.o.cps <= 0 ? text.length : 0;
    this.shown = -1;
    // size the canvas for the whole text so the plane never jumps while typing
    const px = this.o.px;
    this.c.font = `${px}px Alagard`;
    const w = Math.max(...this.lines.map((l) => this.c.measureText(l).width), 10) + px;
    const W = Math.ceil(w), H = Math.ceil(this.lines.length * px * 1.2 + px * 0.6);
    if (W !== this.cv.width || H !== this.cv.height) {
      this.cv.width = W;
      this.cv.height = H;
      // the GPU copy has fixed storage (texStorage2D): a bigger canvas cannot be uploaded into it
      // (GL_INVALID_VALUE, the old words stay on screen), so free it and let three allocate anew
      this.tex.dispose();
    }
    // one text line (px * 1.2 canvas pixels) is `size` metres tall
    const h = this.o.size * (this.cv.height / (px * 1.2));
    this.base.set(h * (this.cv.width / this.cv.height), h);
    this.mesh.scale.set(this.base.x, this.base.y, 1);
    this.draw();
  }

  get done() {
    return this.prog >= this.full.length;
  }
  skipTyping() {
    this.prog = this.full.length;
  }
  show(on = true) {
    this.fadeTarget = on ? 1 : 0;
  }
  get visibleAmount() {
    return this.fade;
  }

  private draw() {
    const n = Math.floor(this.prog);
    if (n === this.shown) return;
    this.shown = n;
    const { px, color, glow, align } = this.o;
    const c = this.c;
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.font = `${px}px Alagard`;
    c.textBaseline = 'top';
    c.textAlign = align;
    let left = n;
    this.lines.forEach((line, i) => {
      if (left <= 0) return;
      const part = line.slice(0, left);
      left -= line.length + 1;
      const x = align === 'center' ? this.cv.width / 2 : px * 0.5;
      const y = px * 0.3 + i * px * 1.2;
      // soft glow, a dark ink edge for readability, then the letters
      c.shadowColor = glow;
      c.shadowBlur = px * 0.45;
      c.lineWidth = px * 0.12;
      c.strokeStyle = 'rgba(20,10,4,0.85)';
      c.strokeText(part, x, y);
      c.fillStyle = color;
      c.fillText(part, x, y);
      c.shadowBlur = 0;
      c.fillText(part, x, y);
    });
    this.tex.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera, onChar?: (ch: string, index: number, text: string) => void) {
    this.t += dt;
    if (this.prog < this.full.length) {
      const before = Math.floor(this.prog);
      this.prog = Math.min(this.full.length, this.prog + dt * this.o.cps);
      if (Math.floor(this.prog) !== before && onChar && this.full[Math.floor(this.prog) - 1] !== ' ') onChar(this.full[Math.floor(this.prog) - 1], Math.floor(this.prog) - 1, this.full);
    }
    this.draw();
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 6);
    this.mat.opacity = this.fade;
    this.mesh.visible = this.fade > 0.01;
    this.mesh.position.copy(this.anchor);
    this.mesh.position.y += Math.sin(this.t * 1.4) * 0.05;
    this.mesh.quaternion.copy(camera.quaternion);
    const s = (1 + this.hover * 0.12) * (0.92 + 0.08 * this.fade);
    this.mesh.scale.set(this.base.x * s, this.base.y * s, 1);
    this.mat.color.setScalar(this.o.hdr * (1 + this.hover * 0.5));
  }

  dispose() {
    this.mesh.removeFromParent();
    this.tex.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}

function wrapText(text: string, max: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if ((line + ' ' + w).trim().length > max && line) {
        out.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}
