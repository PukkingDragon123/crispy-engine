// Battle voice lines: Sundown's anime-style shouts on his moves, the ultimate, tricks and hurts,
// and Serket whispering through the little scorpion on his hat. Every take is a real recording
// (Oculus Audio Pack 01 efforts / screams / laughs, Kenney voice-actor lines) or a whispered
// line, cut and processed by tools/build_orchestra.py (deeper, gravel octave, slapback for him;
// a many-mouthed whisper with a long temple tail for her). The move names themselves are not
// spoken: the caller floats them as 3D text; Serket's lines and his few spoken lines return
// their words so the caller can float those too.
//
//   import { voice } from '../audio/BattleVoice';   (or window.__voice)
//   voice.play('skill:bomb');          // a shout (stable per skill id, varied, rate-limited)
//   voice.play('ult');                 // his battle roar, Serket's "Wake... and devour.", her beast roar, + the music's ult cue
//   voice.play('trick'); voice.play('jump'); voice.play('hurt'); voice.play('death'); voice.play('laugh');
//   voice.play('serket:domain');       // a whispered line (see VO_TEXT for the words), or a wordless whisper
//   voice.play('line:prepare');        // "Prepare yourself."  (also: sudden, fight, killit, ready)
//
// Unknown keys and a missing audio engine are a silent no-op; play() never throws.
import type { AudioEngine } from '../../engine/audio/AudioEngine';
import { VO, VO_TEXT } from './orchManifest';

export type VoiceKey = 'ult' | 'trick' | 'jump' | 'hurt' | 'death' | 'laugh' | `skill:${string}` | `serket:${string}` | `line:${string}` | 'ult:name';
export type VoiceWho = 'sundown' | 'serket';

export interface VoicePlayOpts {
  /** gain multiplier (default 1) */
  volume?: number;
  /** seconds from now */
  delay?: number;
  /** 'ult' only: also fire the score's ult cue (default true) */
  music?: boolean;
  /** ignore the rate limits (cutscenes) */
  force?: boolean;
}
export interface VoiceLine {
  key: string;
  /** the spoken words (null for shouts and wordless whispers) */
  text: string | null;
  who: VoiceWho;
  /** seconds */
  dur: number;
}

/** per key: cooldown (s), chance to speak at all, who says it */
const RULES: Record<string, { cd: number; chance: number; who: VoiceWho }> = {
  skill: { cd: 0.9, chance: 0.85, who: 'sundown' },
  jump: { cd: 1.8, chance: 0.45, who: 'sundown' },
  trick: { cd: 3.0, chance: 0.8, who: 'sundown' },
  hurt: { cd: 0.9, chance: 0.9, who: 'sundown' },
  death: { cd: 3, chance: 1, who: 'sundown' },
  laugh: { cd: 4, chance: 1, who: 'sundown' },
  ult: { cd: 2, chance: 1, who: 'sundown' },
  line: { cd: 1.5, chance: 1, who: 'sundown' },
  serket: { cd: 0.6, chance: 1, who: 'serket' },
};
const GAIN: Record<VoiceWho, number> = { sundown: 0.75, serket: 0.9 };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

interface Playing {
  src: AudioBufferSourceNode;
  g: GainNode;
}

export class BattleVoice {
  private audio: AudioEngine | null = null;
  private base = 'audio/';
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private last = new Map<string, number>();
  private lastTake = new Map<string, number>();
  private playing: Partial<Record<VoiceWho, Playing>> = {};
  /** master switch (a settings toggle may flip it) */
  enabled = true;

  attach(audio: AudioEngine, base = 'audio/') {
    this.audio = audio;
    this.base = base;
  }

  private eng(): AudioEngine | null {
    if (!this.audio) {
      const e = (window as unknown as { __engine?: { audio?: AudioEngine } }).__engine;
      if (e?.audio) this.audio = e.audio;
    }
    return this.audio;
  }

  /** fetch every take (about 1.4 MB); safe to call more than once */
  load(): Promise<void> {
    const a = this.eng();
    if (!a) return Promise.resolve();
    if (this.loading) return this.loading;
    const files = [...new Set(Object.values(VO).flat())];
    const work = async () => {
      while (files.length) {
        const f = files.shift()!;
        try {
          this.buffers.set(f, await a.loadBuffer(this.base + f));
        } catch (e) {
          console.warn('[voice] failed to load', f, e);
        }
      }
    };
    this.loading = Promise.all([work(), work(), work()]).then(() => undefined);
    return this.loading;
  }

  /** is there a recording for this key? */
  has(key: string) {
    return !!this.takes(key).length;
  }

  /** the words of a key's take, if it has words */
  line(key: string): string | null {
    return VO_TEXT[key] ?? null;
  }

  private takes(key: string): string[] {
    if (VO[key]) return VO[key];
    const kind = key.split(':')[0];
    if (kind === 'skill') return VO.skill ?? [];
    if (kind === 'serket') return VO['serket:breath'] ?? [];
    if (key === 'ult:name') return VO['serket:ultname'] ?? [];
    return [];
  }

  /** speak; returns what was said (for a floating subtitle) or null when it stayed quiet */
  play(key: VoiceKey | string, o: VoicePlayOpts = {}): VoiceLine | null {
    try {
      return this.playInner(String(key), o);
    } catch (e) {
      console.warn('[voice] play failed', key, e);
      return null;
    }
  }

  private playInner(key: string, o: VoicePlayOpts): VoiceLine | null {
    if (!this.enabled) return null;
    const a = this.eng();
    if (!a) return null;
    if (!this.loading) void this.load();
    if (key === 'ult') return this.ult(o);
    const kind = key.includes(':') && key !== 'ult:name' ? key.split(':')[0] : key === 'ult:name' ? 'serket' : key;
    const rule = RULES[kind];
    if (!rule) return null;
    const now = a.ctx.currentTime;
    const ck = kind === 'skill' ? 'skill' : key;
    if (!o.force) {
      if (now - (this.last.get(ck) ?? -99) < rule.cd) return null;
      if (Math.random() > rule.chance) return null;
    }
    const list = this.takes(key);
    if (!list.length) return null;
    // a skill keeps its own voice (stable take per id), the rest rotate without repeating
    let idx: number;
    if (kind === 'skill' && key !== 'skill') {
      const h = hash(key);
      const prev = this.lastTake.get(key);
      idx = prev === undefined ? h % list.length : (h + (Math.random() < 0.65 ? 0 : 1 + Math.floor(Math.random() * (list.length - 1)))) % list.length;
    } else {
      const prev = this.lastTake.get(key) ?? -1;
      idx = Math.floor(Math.random() * list.length);
      if (list.length > 1 && idx === prev) idx = (idx + 1) % list.length;
    }
    this.lastTake.set(key, idx);
    const file = list[idx];
    const wordless = !VO[key] && kind === 'serket';
    const dur = this.start(rule.who, file, (o.volume ?? 1) * (wordless ? 0.8 : 1), o.delay ?? 0, kind === 'skill' ? 0.97 + Math.random() * 0.06 : 1, wordless);
    if (dur <= 0) return null;
    this.last.set(ck, now);
    if (rule.who === 'serket') (window as unknown as { __music?: { duck?(a: number, h: number): void } }).__music?.duck?.(0.3, dur * 0.8);
    return { key, text: VO_TEXT[key] ?? null, who: rule.who, dur };
  }

  /** the ultimate: his roar, Serket waking ("Wake... and devour."), her beast roar under the score's ult cue */
  private ult(o: VoicePlayOpts): VoiceLine | null {
    const a = this.eng()!;
    const now = a.ctx.currentTime;
    if (!o.force && now - (this.last.get('ult') ?? -99) < RULES.ult.cd) return null;
    this.last.set('ult', now);
    const d0 = o.delay ?? 0;
    const v = o.volume ?? 1;
    const roar = VO.ult ?? [];
    if (roar.length) this.start('sundown', roar[Math.floor(Math.random() * roar.length)], v, d0, 1, false);
    const wake = VO['serket:wake']?.[0];
    const wd = wake ? this.start('serket', wake, v * 1.1, d0 + 0.55, 1, false) : 0;
    const beast = VO['serket:roar'] ?? [];
    if (beast.length) this.startExtra(beast[Math.floor(Math.random() * beast.length)], v * 0.9, d0 + 2.65);
    if (o.music !== false) (window as unknown as { __music?: { stinger?(k: string): void } }).__music?.stinger?.('ult');
    return { key: 'ult', text: VO_TEXT['serket:wake'] ?? null, who: 'serket', dur: Math.max(3, wd + 0.55) };
  }

  /** start a take on a speaker (cuts that speaker's previous take); returns its length (0 when not loaded) */
  private start(who: VoiceWho, file: string, vol: number, delay: number, rate: number, slice: boolean): number {
    const a = this.eng();
    const buf = this.buffers.get(file);
    if (!a || !buf) return 0;
    const ctx = a.ctx;
    const t = ctx.currentTime + Math.max(0, delay);
    const prev = this.playing[who];
    if (prev) {
      prev.g.gain.cancelScheduledValues(t);
      prev.g.gain.setTargetAtTime(0, t, 0.04);
      try {
        prev.src.stop(t + 0.25);
      } catch {
        /* already stopped */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const lvl = GAIN[who] * vol;
    // the wordless whisper texture: a random breath out of the long take
    let off = 0;
    let len = buf.duration / rate;
    if (slice && buf.duration > 3) {
      len = 1.6 + Math.random() * 0.8;
      off = Math.random() * Math.max(0, buf.duration - len - 0.2);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl, t + 0.15);
      g.gain.setValueAtTime(lvl, t + len - 0.4);
      g.gain.linearRampToValueAtTime(0, t + len);
    } else g.gain.value = lvl;
    src.connect(g).connect(a.buses.voice);
    src.start(t, off, slice ? len + 0.05 : undefined);
    const p: Playing = { src, g };
    this.playing[who] = p;
    src.onended = () => {
      if (this.playing[who] === p) delete this.playing[who];
      g.disconnect();
    };
    return len;
  }

  /** a take that overlaps whatever is speaking (the ult's beast roar) */
  private startExtra(file: string, vol: number, delay: number) {
    const a = this.eng();
    const buf = this.buffers.get(file);
    if (!a || !buf) return;
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    const g = a.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(a.buses.voice);
    src.start(a.ctx.currentTime + delay);
    src.onended = () => g.disconnect();
  }

  /** hush everyone (a cutscene cut, the pause menu) */
  stop(fade = 0.1) {
    const a = this.eng();
    if (!a) return;
    for (const who of Object.keys(this.playing) as VoiceWho[]) {
      const p = this.playing[who]!;
      p.g.gain.setTargetAtTime(0, a.ctx.currentTime, fade / 3);
      try {
        p.src.stop(a.ctx.currentTime + fade + 0.1);
      } catch {
        /* */
      }
    }
  }
}

export const voice = new BattleVoice();
if (typeof window !== 'undefined') (window as unknown as { __voice?: BattleVoice }).__voice = voice;
