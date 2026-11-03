// 2D art made by photographing 3D scenes. Renders any object (a posed rig, a
// prop, an item) in a little studio (key + rim + fill light), reads the pixels
// back and gives them a pixel-art finish: downscale to a chunky grid,
// posterise, a 1-px ink outline around the silhouette and a warm rim highlight.
// Used for the tarot ability cards, wanted-poster portraits and icons.
import * as THREE from 'three';

export interface CaptureOpts {
  /** output size in art pixels (the chunky grid) */
  w: number;
  h: number;
  /** render supersampling before the pixel downscale */
  ss?: number;
  yaw?: number;
  pitch?: number;
  /** fraction of the frame the object's height fills (0..1) */
  fill?: number;
  /** vertical framing offset (fraction of height, + moves the subject down) */
  dy?: number;
  ink?: string | null;
  rim?: string | null;
  levels?: number;
  /** light direction preset */
  light?: 'studio' | 'sunset' | 'moon';
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export class IconFactory {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(28, 1, 0.01, 200);
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private fill: THREE.HemisphereLight;
  private rt: THREE.WebGLRenderTarget | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.key = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.rim = new THREE.DirectionalLight(0xffc27a, 2.4);
    this.fill = new THREE.HemisphereLight(0xcfe0ff, 0x7a5a3a, 1.1);
    this.scene.add(this.key, this.rim, this.fill);
  }

  capture(obj: THREE.Object3D, o: CaptureOpts): HTMLCanvasElement {
    const ss = o.ss ?? 4;
    const W = o.w * ss, H = o.h * ss;
    if (!this.rt || this.rt.width !== W || this.rt.height !== H) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const parent = obj.parent;
    const prevPos = obj.position.clone(), prevQuat = obj.quaternion.clone();
    this.scene.add(obj);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, o.yaw ?? 0.5, 0);
    obj.updateMatrixWorld(true);
    // frame on what is actually visible (hidden props in the hierarchy must not shrink the subject)
    _box.makeEmpty();
    obj.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) _box.expandByObject(o);
    });
    if (_box.isEmpty()) _box.setFromObject(obj);
    const size = _box.getSize(new THREE.Vector3());
    const center = _box.getCenter(new THREE.Vector3());
    const fill = o.fill ?? 0.86;
    const aspect = o.w / o.h;
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
    const vfov = THREE.MathUtils.degToRad(this.cam.fov);
    const fitH = size.y / fill, fitW = Math.max(size.x, size.z) / (fill * aspect);
    const dist = Math.max(fitH, fitW) / (2 * Math.tan(vfov / 2)) + Math.max(size.x, size.z) * 0.5;
    const pitch = o.pitch ?? 0.12;
    const look = center.clone().add(new THREE.Vector3(0, (o.dy ?? 0) * size.y, 0));
    this.cam.position.set(look.x, look.y + Math.sin(pitch) * dist, look.z + Math.cos(pitch) * dist);
    this.cam.lookAt(look);
    const L = o.light ?? 'studio';
    this.key.position.set(L === 'sunset' ? -3 : -2, L === 'moon' ? 4 : 3, 3);
    this.rim.position.set(3, 2, -3);
    this.rim.color.set(L === 'moon' ? 0x9fd0ff : 0xffc27a);
    this.key.color.set(L === 'moon' ? 0xcfe2ff : L === 'sunset' ? 0xffc890 : 0xfff1dc);
    // render with no tone-mapping surprises: plain sRGB output
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, this.cam);
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(this.rt, 0, 0, W, H, buf);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.toneMapping = prevTone;
    // restore the object
    this.scene.remove(obj);
    if (parent) parent.add(obj);
    obj.position.copy(prevPos);
    obj.quaternion.copy(prevQuat);
    return this.pixelate(buf, W, H, o);
  }

  /** downscale (box filter, alpha-weighted), posterise, ink outline, rim light */
  private pixelate(buf: Uint8Array, W: number, H: number, o: CaptureOpts) {
    const ss = o.ss ?? 4, w = o.w, h = o.h;
    const levels = o.levels ?? 9;
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < ss; j++)
          for (let i = 0; i < ss; i++) {
            // render targets read bottom-up
            const k = ((H - 1 - (y * ss + j)) * W + (x * ss + i)) * 4;
            const al = buf[k + 3] / 255;
            r += buf[k] * al;
            g += buf[k + 1] * al;
            b += buf[k + 2] * al;
            a += al;
          }
        const o4 = (y * w + x) * 4;
        const n = ss * ss;
        px[o4 + 3] = a / n;
        if (a > 0) {
          px[o4] = r / a;
          px[o4 + 1] = g / a;
          px[o4 + 2] = b / a;
        }
      }
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(w, h);
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0.45;
    const q = (v: number) => Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255);
    const ink = o.ink === undefined ? '#1a0e08' : o.ink;
    const inkRGB = ink ? new THREE.Color(ink) : null;
    const rim = o.rim === undefined ? '#ffe2a8' : o.rim;
    const rimRGB = rim ? new THREE.Color(rim) : null;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        if (solid(x, y)) {
          let r = q(px[k]), g = q(px[k + 1]), b = q(px[k + 2]);
          // rim: pixels on the upper-right silhouette edge catch the warm light
          if (rimRGB && (!solid(x + 1, y - 1) || !solid(x, y - 1)) && solid(x - 1, y + 1)) {
            r = Math.round(r * 0.55 + rimRGB.r * 255 * 0.45);
            g = Math.round(g * 0.55 + rimRGB.g * 255 * 0.45);
            b = Math.round(b * 0.55 + rimRGB.b * 255 * 0.45);
          }
          img.data[k] = r;
          img.data[k + 1] = g;
          img.data[k + 2] = b;
          img.data[k + 3] = 255;
        } else if (inkRGB && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
          img.data[k] = inkRGB.r * 255;
          img.data[k + 1] = inkRGB.g * 255;
          img.data[k + 2] = inkRGB.b * 255;
          img.data[k + 3] = 255;
        }
      }
    c.putImageData(img, 0, 0);
    void _v;
    return cv;
  }

  dispose() {
    this.rt?.dispose();
  }
}
