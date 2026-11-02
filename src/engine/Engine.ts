// dustUP custom engine runtime: renderer, post stack, scene switching,
// time control (slow-motion, hit-stop), DOM overlay layers.
import * as THREE from 'three';
import { PostStack } from './render/Post';
import { Input } from './Input';
import { Tweens, Ease } from './Tween';
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
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.id = 'gl';
    container.appendChild(r.domElement);
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

  async setScene(s: GameScene, fade = 0.5) {
    if (fade > 0 && this.current) await this.fadeOut(fade);
    this.current?.exit?.();
    this.tweens.clear();
    this.current = s;
    this.post.setSceneCamera(s.scene, s.camera);
    s.camera.aspect = this.width / this.height;
    s.camera.updateProjectionMatrix();
    this.timeScale = this.targetScale = 1;
    this.hitStopLeft = 0;
    await s.enter?.();
    if (fade > 0) this.fadeIn(fade);
    else this.fadeEl.style.opacity = '0';
  }

  fadeOut(t = 0.5, color = '#000') {
    this.fadeEl.style.background = color;
    return new Promise<void>((res) => {
      const start = parseFloat(this.fadeEl.style.opacity || '0');
      this.tweens.run(t, (k) => (this.fadeEl.style.opacity = String(start + (1 - start) * k)), Ease.inOutQuad, { real: true, done: res });
    });
  }
  fadeIn(t = 0.5) {
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
      this.tweens.update(dt, rdt);
      if (this.current) {
        this.current.update(dt, rdt);
        for (const f of this.onAfterUpdate) f(dt, rdt);
        this.audio.setListener(this.current.camera);
        this.post.render(rdt);
        this.current.postRender?.(this.renderer);
      }
      this.input.endFrame();
      this.frame++;
    };
    requestAnimationFrame(loop);
  }
}
