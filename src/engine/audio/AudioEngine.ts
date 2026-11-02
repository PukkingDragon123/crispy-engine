// Web Audio engine: buses, 3D positional one-shots, seamless crossfaded loops,
// voice limiting, ducking, muffling (pause / underworld / slow-mo), reverb send.
import * as THREE from 'three';

export type Bus = 'sfx' | 'ui' | 'music' | 'amb' | 'voice';

export interface SoundDef {
  /** variations, relative to /audio/ */
  files: string[];
  /** linear gain (1 = unity) */
  volume?: number;
  /** random playback rate range */
  pitch?: [number, number];
  bus?: Bus;
  /** max simultaneous voices of this sound */
  max?: number;
  /** min seconds between triggers */
  cooldown?: number;
  /** reverb send 0..1 */
  reverb?: number;
  /** 3D falloff reference distance (meters) */
  ref?: number;
}

export interface PlayOpts {
  pos?: THREE.Vector3 | { x: number; y: number; z: number };
  volume?: number;
  pitch?: number;
  delay?: number;
  reverb?: number;
  /** pick a specific variation */
  variant?: number;
  /** start offset seconds */
  offset?: number;
  /** stop after seconds (with short fade) */
  duration?: number;
}

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  stop(fade?: number): void;
  setVolume(v: number, fade?: number): void;
  setRate(r: number, fade?: number): void;
  ended: boolean;
}

export class LoopHandle {
  private sources: { src: AudioBufferSourceNode; g: GainNode }[] = [];
  private timer = 0;
  private stopped = false;
  out: GainNode;
  private rate = 1;
  private nextStart = 0;
  constructor(private eng: AudioEngine, private buffer: AudioBuffer, dest: AudioNode, volume: number, private xfade = 1.5, private panner?: PannerNode) {
    const ctx = eng.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(panner ?? dest);
    if (panner) panner.connect(dest);
    this.out.gain.setTargetAtTime(volume, ctx.currentTime, 0.15);
    // fall back to native loop for short buffers
    if (buffer.duration < xfade * 3) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const g = ctx.createGain();
      src.connect(g).connect(this.out);
      src.start();
      this.sources.push({ src, g });
    } else {
      this.nextStart = ctx.currentTime;
      this.schedule();
    }
  }
  private schedule() {
    if (this.stopped) return;
    const ctx = this.eng.ctx;
    const b = this.buffer;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = this.rate;
    const g = ctx.createGain();
    const t0 = Math.max(this.nextStart, ctx.currentTime);
    const len = b.duration / this.rate;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + this.xfade);
    g.gain.setValueAtTime(1, t0 + len - this.xfade);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    src.connect(g).connect(this.out);
    src.start(t0);
    src.stop(t0 + len + 0.05);
    this.sources.push({ src, g });
    src.onended = () => {
      this.sources = this.sources.filter((s) => s.src !== src);
    };
    this.nextStart = t0 + len - this.xfade;
    const wait = (this.nextStart - ctx.currentTime - 0.5) * 1000;
    this.timer = window.setTimeout(() => this.schedule(), Math.max(50, wait));
  }
  setVolume(v: number, fade = 0.3) {
    const ctx = this.eng.ctx;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, Math.max(0.01, fade / 3));
  }
  setRate(r: number) {
    this.rate = r;
    for (const s of this.sources) s.src.playbackRate.setTargetAtTime(r, this.eng.ctx.currentTime, 0.1);
  }
  setPosition(p: { x: number; y: number; z: number }) {
    if (!this.panner) return;
    const t = this.eng.ctx.currentTime;
    this.panner.positionX.setTargetAtTime(p.x, t, 0.05);
    this.panner.positionY.setTargetAtTime(p.y, t, 0.05);
    this.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
  }
  stop(fade = 0.6) {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    const ctx = this.eng.ctx;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 3));
    const srcs = this.sources;
    setTimeout(() => {
      for (const s of srcs) {
        try {
          s.src.stop();
        } catch {
          /* */
        }
      }
      this.out.disconnect();
      this.panner?.disconnect();
    }, fade * 1000 + 200);
  }
}

export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<Bus, GainNode>;
  private sfxIn: GainNode; // sfx+voice go through muffle filter
  private muffle: BiquadFilterNode;
  private reverb: ConvolverNode;
  private reverbIn: GainNode;
  private comp: DynamicsCompressorNode;
  buffers = new Map<string, AudioBuffer>();
  defs: Record<string, SoundDef> = {};
  private lastPlay = new Map<string, number>();
  private active = new Map<string, Voice[]>();
  private duckGain: GainNode;
  listenerPos = new THREE.Vector3();
  volumes: Record<Bus | 'master', number> = { master: 0.9, sfx: 1, ui: 0.9, music: 0.55, amb: 0.8, voice: 1 };
  unlocked = false;
  loaded = false;

  constructor() {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.comp).connect(ctx.destination);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.7;
    this.sfxIn = ctx.createGain();
    this.sfxIn.connect(this.muffle).connect(this.duckGain);
    this.buses = {
      sfx: ctx.createGain(),
      voice: ctx.createGain(),
      ui: ctx.createGain(),
      music: ctx.createGain(),
      amb: ctx.createGain(),
    };
    this.buses.sfx.connect(this.sfxIn);
    this.buses.voice.connect(this.sfxIn);
    this.buses.amb.connect(this.sfxIn);
    this.buses.ui.connect(this.master);
    this.buses.music.connect(this.master);
    for (const b of Object.keys(this.buses) as Bus[]) this.buses[b].gain.value = this.volumes[b];
    // algorithmic reverb impulse (a short desert-canyon slap + tail)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.4);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.9;
    this.reverbIn.connect(this.reverb).connect(this.muffle);

    const unlock = () => {
      if (this.ctx.state !== 'running') this.ctx.resume();
      this.unlocked = true;
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private makeImpulse(seconds: number, decay: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflection cluster + diffuse tail
        const er = i < rate * 0.09 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = er + (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.35;
      }
    }
    return buf;
  }

  setVolume(bus: Bus | 'master', v: number) {
    this.volumes[bus] = v;
    const node = bus === 'master' ? this.master : this.buses[bus];
    node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  async loadManifest(defs: Record<string, SoundDef>, base: string, onProgress?: (f: number) => void) {
    this.defs = defs;
    const files = new Set<string>();
    for (const d of Object.values(defs)) for (const f of d.files) files.add(f);
    const list = [...files];
    let done = 0;
    const worker = async (f: string) => {
      try {
        const res = await fetch(base + f);
        if (!res.ok) throw new Error(res.status + '');
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers.set(f, buf);
      } catch (e) {
        console.warn('[audio] failed', f, e);
      }
      done++;
      onProgress?.(done / list.length);
    };
    // limited parallelism
    const queue = list.slice();
    const runners = Array.from({ length: 8 }, async () => {
      while (queue.length) await worker(queue.shift()!);
    });
    await Promise.all(runners);
    this.loaded = true;
  }

  /** load arbitrary extra buffers (e.g. instrument samples) */
  async loadBuffer(path: string) {
    if (this.buffers.has(path)) return this.buffers.get(path)!;
    const res = await fetch(path);
    const arr = await res.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(arr);
    this.buffers.set(path, buf);
    return buf;
  }

  has(id: string) {
    const d = this.defs[id];
    return !!d && d.files.some((f) => this.buffers.has(f));
  }

  private makePanner(pos: { x: number; y: number; z: number }, ref = 6) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 400;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  /** update listener from camera */
  setListener(cam: THREE.Camera) {
    const l = this.ctx.listener;
    const p = new THREE.Vector3();
    const f = new THREE.Vector3();
    const u = new THREE.Vector3();
    cam.getWorldPosition(p);
    cam.getWorldDirection(f);
    u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.listenerPos.copy(p);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t);
      l.forwardY.setValueAtTime(f.y, t);
      l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(u.x, t);
      l.upY.setValueAtTime(u.y, t);
      l.upZ.setValueAtTime(u.z, t);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  play(id: string, o: PlayOpts = {}): Voice | null {
    const d = this.defs[id];
    if (!d || this.ctx.state === 'closed') return null;
    const now = this.ctx.currentTime;
    if (d.cooldown) {
      const lp = this.lastPlay.get(id) ?? -1e9;
      if (now - lp < d.cooldown) return null;
    }
    const avail = d.files.filter((f) => this.buffers.has(f));
    if (!avail.length) return null;
    // voice limiting
    const list = (this.active.get(id) ?? []).filter((v) => !v.ended);
    const max = d.max ?? 6;
    if (list.length >= max) {
      const oldest = list.shift();
      oldest?.stop(0.03);
    }
    this.lastPlay.set(id, now);
    const file = o.variant !== undefined ? avail[o.variant % avail.length] : avail[Math.floor(Math.random() * avail.length)];
    const buf = this.buffers.get(file)!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const pr = d.pitch ? d.pitch[0] + Math.random() * (d.pitch[1] - d.pitch[0]) : 1;
    src.playbackRate.value = pr * (o.pitch ?? 1);
    const g = this.ctx.createGain();
    g.gain.value = (d.volume ?? 1) * (o.volume ?? 1);
    const bus = this.buses[d.bus ?? 'sfx'];
    src.connect(g);
    let tail: AudioNode = g;
    if (o.pos) {
      const p = this.makePanner(o.pos, d.ref ?? 6);
      g.connect(p);
      tail = p;
    }
    tail.connect(bus);
    const rv = o.reverb ?? d.reverb ?? 0;
    if (rv > 0) {
      const s = this.ctx.createGain();
      s.gain.value = rv;
      tail.connect(s).connect(this.reverbIn);
    }
    const start = now + (o.delay ?? 0);
    src.start(start, o.offset ?? 0);
    const voice: Voice = {
      src,
      gain: g,
      ended: false,
      stop: (fade = 0.05) => {
        if (voice.ended) return;
        const t = this.ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
        try {
          src.stop(t + fade + 0.05);
        } catch {
          /* */
        }
      },
      setVolume: (v: number, fade = 0.05) => g.gain.setTargetAtTime(v, this.ctx.currentTime, Math.max(0.005, fade / 3)),
      setRate: (r: number, fade = 0.05) => src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, Math.max(0.005, fade / 3)),
    };
    if (o.duration) {
      g.gain.setValueAtTime(g.gain.value, start + o.duration);
      g.gain.linearRampToValueAtTime(0, start + o.duration + 0.08);
      src.stop(start + o.duration + 0.1);
    }
    src.onended = () => {
      voice.ended = true;
      try {
        tail.disconnect();
      } catch {
        /* */
      }
    };
    list.push(voice);
    this.active.set(id, list);
    return voice;
  }

  /** seamless crossfaded loop. Positional if pos given. */
  loop(id: string, volume = 1, pos?: { x: number; y: number; z: number }, xfade = 1.5): LoopHandle | null {
    const d = this.defs[id];
    if (!d) return null;
    const f = d.files.find((x) => this.buffers.has(x));
    if (!f) return null;
    const buf = this.buffers.get(f)!;
    const panner = pos ? this.makePanner(pos, d.ref ?? 8) : undefined;
    return new LoopHandle(this, buf, this.buses[d.bus ?? 'amb'], (d.volume ?? 1) * volume, xfade, panner);
  }

  /** lowpass everything except UI+music (0 = clear, 1 = heavily muffled) */
  setMuffle(amount: number, time = 0.2) {
    const f = 20000 * Math.pow(0.012, Math.max(0, Math.min(1, amount)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, time / 3);
  }
  /** temporarily lower sfx (e.g. dialogue / cinematic) */
  duck(amount: number, time = 0.3) {
    this.duckGain.gain.setTargetAtTime(1 - amount, this.ctx.currentTime, time / 3);
  }
}
