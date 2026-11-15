// dustUP custom engine runtime: renderer, post stack, scene switching,
// time control (slow-motion, hit-stop), DOM overlay layers.
import * as THREE from 'three';
import { PostStack } from './render/Post';
import { Input } from './Input';
import { Tweens, Ease, reportError } from './Tween';
import { AudioEngine } from './audio/AudioEngine';
import { globalUniforms } from './render/VoxelMaterial';
import { clamp, damp } from './math/rand';
import { lodBefore, lodAfter } from './render/RigLod';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** called once when becoming active */
  enter?(): void | Promise<void>;
  exit?(): void;
  /** dt = scaled game time, rdt = real time */
  update(dt: number, rdt: number): void;
  /** optional extra render (overlay scenes) after main composer */
  postRender?(renderer: THREE.WebGLRenderer): void;
  resize?(w: number, h: number): void;
}

/**
 * A full-screen loading cover (the game's hourglass, see game/ui/LoadingScreen). The engine raises it
 * over scene builds that take noticeable time and lowers it once the new scene has drawn a few frames.
 */
export interface LoadingCover {
  /** raise it; resolves once it covers the screen. `label` names what is loading */
  show(label?: string): Promise<void>;
  /** lower it; resolves once it is gone */
  hide(): Promise<void>;
  readonly shown: boolean;
}

export interface SceneSwitch {
  /**
   * cover the build with the loading screen (a string also labels it). Default: on for scenes that flag
   * a slow build with `ready === false` before `enter()`
   */
  loading?: boolean | string;
}

export interface Quality {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  particles: number; // 0.25..1
  drawDistance: number; // meters
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  post: PostStack;
  input: Input;
  audio: AudioEngine;
  tweens = new Tweens();
  current: GameScene | null = null;
  time = 0;
  realTime = 0;
  frame = 0;
  /** user/game requested time scale */
  timeScale = 1;
  private targetScale = 1;
  private scaleLambda = 8;
  private hitStopLeft = 0;
  private hitStopScale = 0.02;
  fps = 60;
  private lastT = performance.now();
  quality: Quality = { pixelRatio: Math.min(window.devicePixelRatio, 1.5), shadows: true, shadowSize: 4096, bloom: true, particles: 1, drawDistance: 260 }; // shadowSize caps scene shadow maps (capShadows): 4096 lets every scene keep its own
  /**
   * adaptive resolution: the 3D view renders at quality.pixelRatio x renderScale while the canvas
   * (and the live 3D HUD drawn over it) stays at full resolution. Lowered when frames run long,
   * raised back when there is headroom (see adaptResolution)
   */
  renderScale = 1;
  /** adaptive resolution on (off under automation, so headless screenshots stay full resolution; ?adaptive=1 / 0 forces it) */
  adaptive = (() => {
    const a = new URLSearchParams(location.search).get('adaptive');
    return a !== null ? a !== '0' : !navigator.webdriver;
  })();
  private ad = { t: 0, n: 0, max: 0, long: 0, cool: 3, hold: 0, raiseFails: 0, raisedAt: -1e9 };
  width = window.innerWidth;
  height = window.innerHeight;
  overlay: HTMLDivElement;
  fadeEl: HTMLDivElement;
  barTop: HTMLDivElement;
  barBot: HTMLDivElement;
  paused = false;
  /** the GPU dropped the WebGL context (tab in the background on a phone, driver reset): nothing draws until it is back */
  contextLost = false;
  /** called once the context is restored (scenes re-bake anything that lived only on the GPU) */
  onContextRestored: (() => void)[] = [];
  /** the loading screen, if the game installed one */
  loader: LoadingCover | null = null;
  /** the loading screen hides the view: skip drawing the scene (its GPU time goes to the build and the hourglass) */
  private covered = false;
  onAfterUpdate: ((dt: number, rdt: number) => void)[] = [];
  private emptyScene = new THREE.Scene();
  private emptyCam = new THREE.PerspectiveCamera();
  /**
   * every geometry the renderer has drawn since the last scene switch. three keeps a vertex-array
   * binding state per drawn geometry, holding its attribute arrays and GPU buffers, until that
   * geometry is disposed; a scene left without disposing its meshes kept all of them (JS heap and
   * VRAM) for the rest of the session, run after run. setScene releases them (see releaseDrawn).
   */
  private drawn = new Set<THREE.BufferGeometry>();
  /** empty draws skipped so far (see the renderBufferDirect wrapper; read by perf tools) */
  skippedDraws = 0;

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.setPixelRatio(this.quality.pixelRatio);
    r.setSize(this.width, this.height);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // filmic, physically plausible highlight roll-off (realistic look)
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.id = 'gl';
    container.appendChild(r.domElement);
    // a lost context (phones drop it under memory pressure or in the background) must not end the game:
    // three keeps its own state and re-uploads lazily once restored; drawing pauses meanwhile
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('[dustUP] WebGL context lost; waiting for it to come back');
    });
    r.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('[dustUP] WebGL context restored');
      for (const f of this.onContextRestored) {
        try {
          f();
        } catch (e) {
          reportError('contextRestored', e);
        }
      }
      (this.current as { contextRestored?: () => void } | null)?.contextRestored?.();
    });
    const rbd = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      // nothing to draw (an empty instance batch or particle pool): three would still bind the
      // program, upload uniforms and issue an empty draw, in the shadow pass too
      if (((object as THREE.InstancedMesh).isInstancedMesh && (object as THREE.InstancedMesh).count === 0) || geometry.drawRange.count === 0) {
        this.skippedDraws++;
        return;
      }
      this.drawn.add(geometry);
      rbd(camera, scene, geometry, material, object, group);
    };
    this.post = new PostStack(r, this.emptyScene, this.emptyCam, this.width, this.height);
    this.post.setSize(this.width, this.height, this.quality.pixelRatio * this.renderScale);
    this.input = new Input(r.domElement);
    this.audio = new AudioEngine();

    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    container.appendChild(this.overlay);
    this.barTop = this.mkDiv('bar bar-top');
    this.barBot = this.mkDiv('bar bar-bot');
    this.fadeEl = this.mkDiv('fade');
    this.fadeEl.style.opacity = '1';

    window.addEventListener('resize', () => this.resize());
  }

  private mkDiv(cls: string) {
    const d = document.createElement('div');
    d.className = cls;
    this.overlay.appendChild(d);
    return d;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.post.setSize(this.width, this.height, this.quality.pixelRatio * this.renderScale);
    if (this.current) {
      this.current.camera.aspect = this.width / this.height;
      this.current.camera.updateProjectionMatrix();
      this.current.resize?.(this.width, this.height);
    }
  }

  applyQuality(q: Partial<Quality>) {
    Object.assign(this.quality, q);
    if (q.pixelRatio !== undefined) {
      this.renderScale = 1;
      this.post.setSamples(4);
    }
    if (this.current) this.capShadows(this.current.scene);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.post.bloom.enabled = this.quality.bloom;
    this.resize();
  }

  /** the scene switch in flight (switches queue behind it, see setScene) */
  private switchQ: Promise<void> = Promise.resolve();

  /**
   * Switch scenes. Switches run one at a time: a second request made while one is still fading or
   * building (a menu click during a results fade, a death during travel) waits for it, then leaves
   * that scene properly. Run side by side, both left the same scene (its exit ran twice) and the
   * first one's scene went on building with nobody ever calling its exit: its DOM, listeners, loops
   * and meshes stayed alive under the new scene.
   */
  setScene(s: GameScene, fade = 0.5, color = '#000', o: SceneSwitch = {}): Promise<void> {
    const run = this.switchQ.then(() => this.switchTo(s, fade, color, o));
    this.switchQ = run.catch((e) => reportError('setScene', e));
    return run;
  }

  private async switchTo(s: GameScene, fade: number, color: string, o: SceneSwitch) {
    const flag = (s as { ready?: boolean }).ready;
    const load = !!this.loader && (o.loading ?? flag === false) !== false;
    if (fade > 0 && this.current) await this.fadeOut(fade, color);
    if (load) {
      await this.loader!.show(typeof o.loading === 'string' ? o.loading : undefined);
      this.covered = true;
    }
    // a scene that throws while leaving or arriving must not leave the screen covered forever
    try {
      this.current?.exit?.();
    } catch (e) {
      reportError('scene exit', e);
    }
    this.tweens.clear();
    this.releaseDrawn(s.scene);
    this.current = s;
    this.post.setSceneCamera(s.scene, s.camera);
    s.camera.aspect = this.width / this.height;
    s.camera.updateProjectionMatrix();
    this.timeScale = this.targetScale = 1;
    this.hitStopLeft = 0;
    try {
      await s.enter?.();
    } catch (e) {
      reportError('scene enter', e);
      (s as { ready?: boolean }).ready = true;
    }
    // some scenes finish building over later frames
    if (load) while ((s as { ready?: boolean }).ready === false && this.current === s) await this.nextFrame();
    if (this.current === s) this.capShadows(s.scene);
    if (fade > 0 || this.loader?.shown) void this.fadeIn(fade, light(color));
    else {
      this.covered = false;
      this.fadeEl.style.opacity = '0';
    }
  }

  /**
   * Free the GPU side of everything the outgoing scene drew, except what the incoming scene already
   * holds. Safe for shared or cached geometry: three uploads a disposed geometry again the next
   * time it is drawn, so a cache reused by the next scene only costs a re-upload.
   */
  private releaseDrawn(keep: THREE.Object3D) {
    const kept = new Set<THREE.BufferGeometry>();
    keep.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) kept.add(g);
    });
    for (const g of this.drawn) {
      if (kept.has(g)) continue;
      try {
        g.dispose();
      } catch (e) {
        reportError('releaseDrawn', e);
      }
    }
    this.drawn.clear();
  }

  /**
   * Hold every shadow map in a scene to quality.shadowSize (scenes ask for 2048 to 4096; the low
   * setting and phones get the smaller map they chose). Never raises a map a scene made smaller.
   */
  capShadows(root: THREE.Object3D) {
    const cap = this.quality.shadowSize;
    root.traverse((o) => {
      const sh = (o as THREE.DirectionalLight).shadow;
      if (!(o as THREE.Light).isLight || !sh || (sh.mapSize.x <= cap && sh.mapSize.y <= cap)) return;
      sh.mapSize.set(Math.min(sh.mapSize.x, cap), Math.min(sh.mapSize.y, cap));
      sh.map?.dispose();
      sh.map = null;
    });
  }

  /** resolves after the engine has rendered `n` more frames */
  nextFrame(n = 1) {
    const f0 = this.frame;
    return new Promise<void>((res) => {
      const check = () => (this.frame >= f0 + n ? res() : requestAnimationFrame(check));
      requestAnimationFrame(check);
    });
  }

  /**
   * Fade the screen to a colour. `{ loading }` raises the loading screen once covered: use it before a
   * slow build; the next fadeIn lowers it.
   */
  async fadeOut(t = 0.5, color = '#000', o: SceneSwitch = {}) {
    this.fadeEl.style.background = color;
    await new Promise<void>((res) => {
      const start = parseFloat(this.fadeEl.style.opacity || '0');
      this.tweens.run(t, (k) => (this.fadeEl.style.opacity = String(start + (1 - start) * k)), Ease.inOutQuad, { real: true, done: res });
    });
    if (o.loading && this.loader) {
      await this.loader.show(typeof o.loading === 'string' ? o.loading : undefined);
      this.covered = true;
    }
  }
  /** fade back in; if the loading screen is up, the first frames render (and compile) behind it first */
  async fadeIn(t = 0.5, holdColor = false) {
    const L = this.loader;
    this.covered = false;
    if (L?.shown) {
      await this.nextFrame(3);
      // a light fade colour (a white-out) shows between the hourglass and the scene
      if (holdColor) await L.hide();
      else void L.hide();
    }
    if (t <= 0) {
      this.fadeEl.style.opacity = '0';
      return;
    }
    return new Promise<void>((res) => {
      const start = parseFloat(this.fadeEl.style.opacity || '1');
      this.tweens.run(t, (k) => (this.fadeEl.style.opacity = String(start * (1 - k))), Ease.inOutQuad, { real: true, done: res });
    });
  }
  letterbox(on: boolean, t = 0.6) {
    const h = on ? 11 : 0;
    this.barTop.style.transition = `height ${t}s cubic-bezier(.6,0,.2,1)`;
    this.barBot.style.transition = `height ${t}s cubic-bezier(.6,0,.2,1)`;
    this.barTop.style.height = h + 'vh';
    this.barBot.style.height = h + 'vh';
  }

  /** smoothly change time scale (slow motion) */
  slowMo(scale: number, lambda = 8) {
    this.targetScale = scale;
    this.scaleLambda = lambda;
  }
  /** freeze-frame on impact (real-time seconds) */
  hitStop(seconds: number, scale = 0.03) {
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
    this.hitStopScale = scale;
  }
  /** screen flash via post */
  flash(color = 0xffffff, strength = 0.6, time = 0.25) {
    const u = this.post.u.uFlash.value;
    const c = new THREE.Color(color);
    u.set(c.r, c.g, c.b, strength);
    this.tweens.run(time, (k) => (u.w = strength * (1 - k)), Ease.outQuad, { real: true });
  }

  /**
   * Adaptive resolution. Frame intervals are judged one second at a time, leaving out that second's
   * single worst frame when it is a stall (a scene build or shader compile, not the steady cost of
   * drawing). A second under 50 fps for two seconds running lowers the 3D render scale a step (to
   * 0.6 at least); 8 s at 58 fps or better tries a step back up, and a step up that has to be taken
   * back waits longer before the next try.
   */
  private adaptResolution(raw: number) {
    const a = this.ad;
    if (!this.adaptive || this.covered || this.contextLost || document.hidden || this.paused) {
      a.t = a.n = a.max = 0;
      return;
    }
    a.t += raw;
    a.n++;
    a.max = Math.max(a.max, raw);
    a.cool = Math.max(0, a.cool - raw);
    if (a.t < 1 || a.n < 3) return;
    // the bucket without its worst frame; a lone frame 4x slower than the rest is a stall
    const rest = (a.t - a.max) / (a.n - 1);
    const stall = a.max > 0.12 && a.max > rest * 4;
    const avg = stall ? rest : a.t / a.n;
    a.t = a.n = a.max = 0;
    const set = (k: number) => {
      const next = clamp(Math.round(k * 20) / 20, 0.6, 1);
      if (next === this.renderScale) return;
      this.renderScale = next;
      this.post.setSize(this.width, this.height, this.quality.pixelRatio * next);
      // deep under load the edge smoothing goes 4x to 2x as well (the ink lines carry the edges)
      this.post.setSamples(next < 0.75 ? 2 : 4);
      a.cool = 2.5;
    };
    if (avg > 1 / 50) {
      a.hold = 0;
      a.long++;
      if (a.long >= 2 && a.cool <= 0 && this.renderScale > 0.6) {
        // a step up that did not hold: wait longer before the next try
        if (this.realTime - a.raisedAt < 8) a.raiseFails++;
        set(this.renderScale - 0.1);
        a.long = 0;
      }
    } else {
      a.long = 0;
      if (avg < 1 / 58) a.hold++;
      if (this.renderScale < 1 && a.cool <= 0 && a.hold >= 8 + Math.min(4, a.raiseFails) * 8) {
        set(this.renderScale + 0.05);
        a.raisedAt = this.realTime;
        a.hold = 0;
      }
    }
  }

  private camOk = { cam: null as THREE.Camera | null, p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /**
   * A NaN that reaches the camera (a zero-length direction normalised somewhere in a rig) blanks the
   * whole view for good: every later frame inherits it. Put the camera back where it last was valid,
   * and say so once a second so the cause can be found.
   */
  private guardCamera(cam: THREE.PerspectiveCamera) {
    const c = this.camOk, p = cam.position, q = cam.quaternion;
    if (Number.isFinite(p.x + p.y + p.z) && Number.isFinite(q.x + q.y + q.z + q.w) && Number.isFinite(cam.fov)) {
      c.cam = cam;
      c.p.copy(p);
      c.q.copy(q);
      return;
    }
    reportError('camera', new Error('non-finite camera transform; restored the last valid one'));
    if (c.cam === cam) {
      p.copy(c.p);
      q.copy(c.q);
    } else {
      p.set(0, 10, 10);
      q.identity();
    }
    if (!Number.isFinite(cam.fov)) cam.fov = 60;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const raw = (now - this.lastT) / 1000;
      let rdt = raw;
      this.lastT = now;
      rdt = clamp(rdt, 0, 0.1);
      this.fps = damp(this.fps, 1 / Math.max(rdt, 1e-3), 3, rdt);
      this.realTime += rdt;
      try {
        this.adaptResolution(raw);
      } catch (e) {
        reportError('adapt', e);
      }
      // time scale
      this.timeScale = damp(this.timeScale, this.targetScale, this.scaleLambda, rdt);
      let scale = this.paused ? 0 : this.timeScale;
      if (this.hitStopLeft > 0) {
        this.hitStopLeft -= rdt;
        scale = Math.min(scale, this.hitStopScale);
      }
      const dt = rdt * scale;
      this.time += dt;
      globalUniforms.uTime.value = this.realTime;
      this.post.u.uTime.value = this.realTime;
      // every stage is guarded: one throwing system is logged and skipped, the rest of the frame
      // still runs, input edges still clear and the frame counter still ticks (scene switches and
      // cinematics wait on it), so an exception can never freeze the game
      const guard = (where: string, fn: () => void) => {
        try {
          fn();
        } catch (e) {
          reportError(where, e);
        }
      };
      guard('tweens', () => this.tweens.update(dt, rdt));
      const cur = this.current;
      if (cur) {
        guard('update', () => cur.update(dt, rdt));
        for (const f of this.onAfterUpdate.slice()) guard('afterUpdate', () => f(dt, rdt));
        this.guardCamera(cur.camera);
        guard('audio', () => this.audio.setListener(cur.camera));
        if (!this.covered && !this.contextLost) {
          guard('render', () => {
            const rp = this.post.renderPass;
            lodBefore(rp.scene, rp.camera, this.post.composer.renderTarget1.height);
            try {
              this.post.render(rdt);
            } finally {
              lodAfter();
            }
          });
          guard('postRender', () => cur.postRender?.(this.renderer));
        }
      }
      this.input.endFrame();
      this.frame++;
    };
    requestAnimationFrame(loop);
  }
}

/** is a CSS colour light (a white-out rather than a black-out)? */
function light(css: string) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const n = parseInt(h, 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 140;
}
