// dustUP custom engine runtime: renderer, post stack, scene switching,
// time control (slow-motion, hit-stop), DOM overlay layers.
import * as THREE from 'three';
import { PostStack } from './render/Post';
import { Input } from './Input';
import { Tweens, Ease, reportError } from './Tween';
import { AudioEngine } from './audio/AudioEngine';
import { globalUniforms } from './render/VoxelMaterial';
import { clamp, damp } from './math/rand';

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
  quality: Quality = { pixelRatio: Math.min(window.devicePixelRatio, 1.5), shadows: true, shadowSize: 2048, bloom: true, particles: 1, drawDistance: 260 };
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
    this.post = new PostStack(r, this.emptyScene, this.emptyCam, this.width, this.height);
    this.post.setSize(this.width, this.height, this.quality.pixelRatio);
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
    this.post.setSize(this.width, this.height, this.quality.pixelRatio);
    if (this.current) {
      this.current.camera.aspect = this.width / this.height;
      this.current.camera.updateProjectionMatrix();
      this.current.resize?.(this.width, this.height);
    }
  }

  applyQuality(q: Partial<Quality>) {
    Object.assign(this.quality, q);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.post.bloom.enabled = this.quality.bloom;
    this.resize();
  }

  async setScene(s: GameScene, fade = 0.5, color = '#000', o: SceneSwitch = {}) {
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
    if (fade > 0 || this.loader?.shown) void this.fadeIn(fade, light(color));
    else {
      this.covered = false;
      this.fadeEl.style.opacity = '0';
    }
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

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let rdt = (now - this.lastT) / 1000;
      this.lastT = now;
      rdt = clamp(rdt, 0, 0.1);
      this.fps = damp(this.fps, 1 / Math.max(rdt, 1e-3), 3, rdt);
      this.realTime += rdt;
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
        guard('audio', () => this.audio.setListener(cur.camera));
        if (!this.covered && !this.contextLost) {
          guard('render', () => this.post.render(rdt));
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
