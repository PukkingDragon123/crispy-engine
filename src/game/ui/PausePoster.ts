// The pause screen: a real sheet of paper. It comes tumbling in on the desert
// wind (Verlet cloth: stretch, shear and bend springs, turbulence), two
// gunshots nail its top corners in place — bullet holes and all — and it hangs
// there, still fluttering a little, while the buttons ride on it. Unpausing
// rips it off the nails and the wind carries it away.
// Like the rest of the HUD it is crisp pixel art: Hud3D renders the cloth into
// a render target at HUD-pixel resolution and blows it up nearest-neighbour, the
// paper's light is stepped onto a few cel tones, its torn edge carries an ink
// line, and it casts a shadow (the same cloth, darkened, offset down-right).
// The poster's ink is set at the poster's own pixel size: Alagard type and
// Sundown photographed in 3D (IconFactory), printed in sepia on the HUD palette.
import * as THREE from 'three';
import { IconFactory } from './IconFactory';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { palNearest, pixelText, pixelTextWidth } from './HudSprites';

const NX = 13, NY = 17;
const ASPECT = 300 / 430;

const VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */ `
uniform sampler2D map; uniform float uHasMap; uniform vec4 uHole1, uHole2; uniform float uAspect, uSeed, uShadow; uniform vec2 uPx;
varying vec2 vUv; varying vec3 vN;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.07 + 1.3; a *= 0.5; } return s; }
// palette colours are written as sRGB; the output is encoded once more at the end
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
float hole(vec4 H, vec2 uv, inout vec3 col){
  if (H.w < 0.5) return 1.0;
  vec2 d = (uv - H.xy) * vec2(uAspect, 1.0);
  float r = length(d);
  float ang = atan(d.y, d.x);
  float jag = H.z * (0.42 + 0.12 * n2(vec2(ang * 3.0, 1.0)));
  if (r < jag) return 0.0;
  // scorched ring, then radial cracks / powder burn
  float burn = smoothstep(jag * 3.2, jag, r);
  float cracks = smoothstep(0.75, 1.0, n2(vec2(ang * 7.0, r * 30.0))) * smoothstep(H.z * 2.6, H.z * 0.6, r);
  col = mix(col, vec3(0.16, 0.09, 0.05), clamp(burn * 0.85 + cracks * 0.5, 0.0, 1.0));
  return 1.0;
}
void main(){
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x * uAspect, e.y);
  float tear = 0.008 + fbm(vUv * 22.0) * 0.022;
  if (edge < tear) discard;
  vec3 paper = mix(vec3(0.94, 0.86, 0.69), vec3(0.83, 0.71, 0.52), smoothstep(0.25, 0.85, fbm(vUv * 5.0)));
  paper *= 0.95 + 0.05 * fbm(vUv * vec2(120.0, 40.0));
  float fox = smoothstep(0.72, 0.9, fbm(vUv * 11.0 + 7.0));
  paper = mix(paper, vec3(0.7, 0.5, 0.3), fox * 0.35);
  float rim = smoothstep(tear + 0.06, tear, edge);
  paper = mix(paper, vec3(0.42, 0.26, 0.13), rim * 0.75);
  vec3 col = paper;
  if (uHasMap > 0.5) {
    vec4 ink = texture2D(map, vUv);
    col = mix(col, ink.rgb * mix(vec3(1.0), paper * 1.05, 0.25), ink.a);
  }
  if (hole(uHole1, vUv, col) < 0.5) discard;
  if (hole(uHole2, vUv, col) < 0.5) discard;
  if (uShadow > 0.5) { gl_FragColor = vec4(srgb(vec3(0.1, 0.055, 0.024)), 0.36); return; }
  // pixel paper: the paper tones stepped (the ink keeps its own), a one-pixel ink line on the torn edge
  if (!(uHasMap > 0.5 && texture2D(map, vUv).a > 0.5)) {
    // the paper onto the pixel kit's parchment ramp (as the mission notes)
    float pl = dot(col, vec3(0.3, 0.59, 0.11));
    col = srgb(pl > 0.9 ? vec3(1.0, 0.957, 0.847) : pl > 0.8 ? vec3(0.937, 0.863, 0.69) : pl > 0.66 ? vec3(0.839, 0.725, 0.522) : pl > 0.45 ? vec3(0.663, 0.518, 0.306) : pl > 0.24 ? vec3(0.42, 0.26, 0.13) : vec3(0.16, 0.086, 0.04));
  }
  if (edge < tear + uPx.y * 1.05) col = srgb(vec3(0.16, 0.086, 0.04));
  // folds catch the key light in hard cel steps
  vec3 n = normalize(vN);
  float l = clamp(dot(n * (gl_FrontFacing ? 1.0 : -1.0), normalize(vec3(-0.35, 0.55, 1.0))), 0.0, 1.0);
  l = l > 0.82 ? 1.0 : l > 0.62 ? 0.9 : l > 0.4 ? 0.8 : 0.7;
  gl_FragColor = vec4(col * l, 1.0);
  #include <colorspace_fragment>
}`;

interface P {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  pin: number; // -1 free, else pin index
}

export class PausePoster {
  mesh: THREE.Mesh;
  /** the same cloth, darkened and offset: the poster's cast shadow */
  shadow: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShaderMaterial;
  /** css px per HUD px (set by the HUD each frame) */
  scale = 2;
  private geo: THREE.PlaneGeometry;
  private pts: P[] = [];
  private springs: [number, number, number, number][] = [];
  private state: 'off' | 'in' | 'pinned' | 'out' = 'off';
  private t = 0;
  private st = 0;
  private shots = 0;
  private pins: { x: number; y: number }[] = [];
  private w = 300;
  private h = 430;
  private art: THREE.CanvasTexture | null = null;
  needsArt = true;
  /** the current poster centre in HUD pixels (for the DOM buttons) */
  centre = { x: 0, y: 0, visible: 0 };
  onShot?: (n: number) => void;

  constructor(private scene: THREE.Scene) {
    this.geo = new THREE.PlaneGeometry(1, 1, NX - 1, NY - 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        uHasMap: { value: 0 },
        uHole1: { value: new THREE.Vector4(0, 0, 0, 0) },
        uHole2: { value: new THREE.Vector4(0, 0, 0, 0) },
        uAspect: { value: ASPECT },
        uSeed: { value: Math.random() },
        uShadow: { value: 0 },
        uPx: { value: new THREE.Vector2(0.004, 0.003) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.shadowMat = this.mat.clone();
    this.shadowMat.uniforms = { ...this.mat.uniforms, uShadow: { value: 1 } };
    this.shadowMat.transparent = true;
    this.shadow = new THREE.Mesh(this.geo, this.shadowMat);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 19;
    this.shadow.visible = false;
    scene.add(this.shadow, this.mesh);
  }

  /** the poster's ink at its own HUD-pixel size: Alagard type + Sundown photographed from his own 3D rig */
  buildArt(renderer: THREE.WebGLRenderer, hero: RigSpec | null, scale = this.scale) {
    this.needsArt = false;
    const W = Math.max(60, Math.round(this.w / scale)), H = Math.max(80, Math.round(this.h / scale));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    const ink = '#2a160a';
    const big = pixelTextWidth('PAUSED', 48) < W * 0.86 ? 48 : 32;
    const y0 = Math.round(H * 0.06);
    pixelText(c, 'PAUSED', W / 2, y0, { size: big, color: ink, align: 'center' });
    const sub = '— the outlaws hold their breath —';
    pixelText(c, pixelTextWidth(sub, 16) < W * 0.94 ? sub : 'the outlaws hold their breath', W / 2, y0 + big * 1.05, { size: 16, color: '#5c2a12', align: 'center' });
    const box = Math.round(Math.min(W * 0.66, H * 0.48));
    const py = Math.round(y0 + big * 1.05 + 22);
    if (hero) {
      try {
        const f = new IconFactory(renderer);
        const r = new RigInstance(buildRigGeo(hero, hero.name + ':poster'), { material: makeVoxelMaterial({ fog: false }), castShadow: false });
        const n = r.nodes;
        n['arm_r']?.rotation.set(-0.5, 0, -0.35);
        n['fore_r']?.rotation.set(-1.3, 0, 0);
        n['head']?.rotation.set(0.08, 0.25, 0);
        r.root.updateMatrixWorld(true);
        const shot = f.capture(r.root, { w: box, h: box, ss: 4, yaw: 0.45, pitch: 0.08, fill: 0.95, dy: 0.18, light: 'sunset', levels: 24, ink: '#2a160a', rim: '#ffe2a8' });
        // printed in sepia ink, posterised onto the HUD's paper-and-wood ramp
        const sc = shot.getContext('2d', { willReadFrequently: true })!;
        const id = sc.getImageData(0, 0, shot.width, shot.height);
        for (let i = 0; i < id.data.length; i += 4) {
          if (!id.data[i + 3]) continue;
          const l = (id.data[i] * 0.3 + id.data[i + 1] * 0.59 + id.data[i + 2] * 0.11) / 255;
          const p = palNearest(Math.min(255, 70 + l * 175), Math.min(255, 40 + l * 150), Math.min(255, 20 + l * 105));
          id.data[i] = p[0];
          id.data[i + 1] = p[1];
          id.data[i + 2] = p[2];
        }
        sc.putImageData(id, 0, 0);
        // a printed frame round the portrait
        c.fillStyle = ink;
        c.fillRect(Math.round(W / 2 - box / 2) - 3, py - 3, box + 6, 1);
        c.fillRect(Math.round(W / 2 - box / 2) - 3, py + box + 2, box + 6, 1);
        c.fillRect(Math.round(W / 2 - box / 2) - 3, py - 3, 1, box + 6);
        c.fillRect(Math.round(W / 2 + box / 2) + 2, py - 3, 1, box + 6);
        c.drawImage(shot, Math.round(W / 2 - box / 2), py);
        f.dispose();
        r.root.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).dispose());
      } catch (e) {
        console.warn('[poster] portrait capture failed', e);
      }
    }
    pixelText(c, 'SUNDOWN', W / 2, py + box + 8, { size: 32, color: ink, align: 'center' });
    pixelText(c, 'REWARD: A BREATHER', W / 2, H - 30, { size: 16, color: ink, align: 'center' });
    this.art?.dispose();
    this.art = new THREE.CanvasTexture(cv);
    this.art.colorSpace = THREE.SRGBColorSpace;
    this.art.magFilter = THREE.NearestFilter;
    this.art.minFilter = THREE.NearestFilter;
    this.art.generateMipmaps = false;
    this.mat.uniforms.map.value = this.art;
    this.mat.uniforms.uHasMap.value = 1;
    this.mat.uniforms.uPx.value.set(1 / W, 1 / H);
  }

  open(W: number, H: number) {
    this.h = Math.min(H * 0.86, 640);
    this.w = this.h * ASPECT;
    this.pts = [];
    this.springs = [];
    // start off-screen to the left, tilted, carried by the wind
    const sx = -this.w * 1.3, sy = -H * 0.35;
    const rot = -0.7;
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const lx = (i / (NX - 1) - 0.5) * this.w, ly = (0.5 - j / (NY - 1)) * this.h;
        const x = sx + lx * Math.cos(rot) - ly * Math.sin(rot);
        const y = sy + lx * Math.sin(rot) + ly * Math.cos(rot);
        this.pts.push({ x, y, z: 0, px: x - 14, py: y + 3, pz: 0, pin: -1 });
      }
    const idx = (i: number, j: number) => j * NX + i;
    const link = (a: number, b: number, k: number) => {
      const A = this.pts[a], B = this.pts[b];
      this.springs.push([a, b, Math.hypot(A.x - B.x, A.y - B.y), k]);
    };
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        if (i < NX - 1) link(idx(i, j), idx(i + 1, j), 1);
        if (j < NY - 1) link(idx(i, j), idx(i, j + 1), 1);
        if (i < NX - 1 && j < NY - 1) {
          link(idx(i, j), idx(i + 1, j + 1), 0.6);
          link(idx(i + 1, j), idx(i, j + 1), 0.6);
        }
        // paper is stiff: bend springs over two cells
        if (i < NX - 2) link(idx(i, j), idx(i + 2, j), 0.35);
        if (j < NY - 2) link(idx(i, j), idx(i, j + 2), 0.35);
      }
    this.pins = [
      { x: W / 2 - this.w * 0.42, y: -H / 2 + this.h * 0.47 },
      { x: W / 2 + this.w * 0.42, y: -H / 2 + this.h * 0.47 },
    ];
    this.mat.uniforms.uHole1.value.set(0, 0, 0, 0);
    this.mat.uniforms.uHole2.value.set(0, 0, 0, 0);
    this.state = 'in';
    this.st = 0;
    this.shots = 0;
    this.mesh.visible = this.shadow.visible = true;
    // the ink is set at the poster's pixel size (it changes with the window)
    this.needsArt = true;
  }

  close() {
    if (this.state === 'off') return;
    this.state = 'out';
    this.st = 0;
    for (const p of this.pts) p.pin = -1;
  }

  /** poster height in HUD pixels */
  get height() {
    return this.h;
  }

  get active() {
    return this.state !== 'off';
  }

  update(dt: number, W: number, H: number, time: number) {
    if (this.state === 'off') return;
    this.t += dt;
    this.st += dt;
    const sub = 3, h = Math.min(dt, 1 / 30) / sub;
    const cx = W / 2, cy = -H / 2;
    // shots: the poster gets nailed when it reaches the middle
    if (this.state === 'in') {
      const c = this.centroid();
      if ((this.shots === 0 && (this.st > 0.85 || c.x > cx - this.w * 0.15)) || (this.shots === 1 && this.st > 1.12)) {
        const corner = this.shots === 0 ? 0 : NX - 1;
        const pin = this.pins[this.shots];
        const p = this.pts[corner];
        p.pin = this.shots;
        p.x = p.px = pin.x;
        p.y = p.py = pin.y;
        const holes = this.shots === 0 ? this.mat.uniforms.uHole1 : this.mat.uniforms.uHole2;
        holes.value.set(corner === 0 ? 0.035 : 0.965, 0.975, 0.03, 1);
        // the kick of the bullet shoves the nearby paper
        for (const q of this.pts) {
          const d = Math.hypot(q.x - pin.x, q.y - pin.y);
          if (d < this.w * 0.4 && q.pin < 0) q.px += (q.x - pin.x) * 0.04;
        }
        this.onShot?.(this.shots);
        this.shots++;
        if (this.shots === 2) {
          this.state = 'pinned';
          this.st = 0;
        }
      }
    }
    for (let s = 0; s < sub; s++) this.step(h, W, H, time);
    // write the cloth into the mesh
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < this.pts.length; k++) {
      const p = this.pts[k];
      pos.setXYZ(k, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.mesh.position.set(0, 0, 400);
    // it hangs a little off the screen: its shadow falls down-right, further while it flies
    const lift = this.state === 'pinned' ? 5 : 12;
    this.shadow.position.set(Math.round(1 + lift * 0.55) * this.scale, -Math.round(1 + lift * 0.85) * this.scale, 399);
    const c = this.centroid();
    this.centre.x = c.x;
    this.centre.y = -c.y;
    this.centre.visible = this.state === 'pinned' ? Math.min(1, this.st * 3) : 0;
    if (this.state === 'out' && (this.st > 2.2 || c.x > W + this.w * 1.2)) {
      this.state = 'off';
      this.mesh.visible = this.shadow.visible = false;
    }
  }

  private centroid() {
    let x = 0, y = 0;
    for (const p of this.pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / this.pts.length, y: y / this.pts.length };
  }

  private step(h: number, W: number, H: number, time: number) {
    const inS = this.state === 'in', out = this.state === 'out';
    const c = this.centroid();
    // wind: a strong gust carrying it in (steered toward the middle), gentle after
    const target = { x: W / 2, y: -H / 2 };
    const gust = inS ? 1 : out ? 1.6 : 0.12;
    for (let k = 0; k < this.pts.length; k++) {
      const p = this.pts[k];
      if (p.pin >= 0) {
        const pin = this.pins[p.pin];
        p.x = p.px = pin.x;
        p.y = p.py = pin.y;
        p.z = p.pz = 0;
        continue;
      }
      const i = k % NX, j = Math.floor(k / NX);
      const turb = Math.sin(time * 5.3 + i * 0.7 + j * 0.45) * 0.6 + Math.sin(time * 8.1 - i * 0.9 + j * 0.3) * 0.4;
      let ax = 0, ay = 0, az = 0;
      if (inS) {
        ax += (target.x - c.x) * 9 + 260 * gust;
        ay += (target.y - c.y) * 9;
      } else if (out) {
        ax += 2600;
        ay += 300 + Math.sin(time * 3 + j) * 400;
      } else ay -= 900; // pinned: it hangs
      ax += turb * 900 * gust;
      ay += Math.cos(time * 4.7 + i * 0.5) * 500 * gust;
      az += turb * 40 * (inS || out ? 1 : 0.25);
      const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985, vz = (p.z - p.pz) * 0.95;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.x += vx + ax * h * h;
      p.y += vy + ay * h * h;
      p.z += vz + az * h * h;
    }
    for (let it = 0; it < 4; it++)
      for (const [a, b, rest, k] of this.springs) {
        const A = this.pts[a], B = this.pts[b];
        const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = ((d - rest) / d) * 0.5 * k;
        const wa = A.pin >= 0 ? 0 : 1, wb = B.pin >= 0 ? 0 : 1;
        const sw = wa + wb || 1;
        A.x += dx * diff * (wa / sw) * 2;
        A.y += dy * diff * (wa / sw) * 2;
        A.z += dz * diff * (wa / sw) * 2;
        B.x -= dx * diff * (wb / sw) * 2;
        B.y -= dy * diff * (wb / sw) * 2;
        B.z -= dz * diff * (wb / sw) * 2;
      }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.shadow.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.shadowMat.dispose();
    this.art?.dispose();
    void this.scene;
  }
}
