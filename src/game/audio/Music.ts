// dustUP generative score.
// Spaghetti-western guitar language (galloping palm-muted bass, tremolo-picked
// leads, Andalusian strums, slapback + cavernous reverb) written in E Phrygian
// dominant for the Egyptian colour, played on real multi-sampled CC0 Meta steel /
// nylon guitars and piano. Every phrase is composed from motifs below and varied
// (ornaments, register, rhythm displacement) - no random note soup.
//
// Over it sits a majestic orchestral layer (Music.orch below): string sections, horns,
// trumpets and low brass, a sung crowd choir, a ney-coloured flute, harp, timpani, taiko,
// darbuka, frame drum, riq, finger cymbals, gong and cymbal swells, all real CC0 recordings
// (VSCO 2 CE, VCSL, Freesound) in a big hall reverb. It follows the same progressions, so the
// guitar keeps the western voice and the orchestra the Egyptian-mythic size:
//   menu: strings, choir and a horn lament · explore: low strings, frame drum, ney answers
//   night (auto when the sky turns, or setNight): tremolo strings, the dark choir, a lone ney
//   combat: spiccato ostinato, darbuka maqsum, horn swells · boss: taiko, low brass, choir, trumpets
//   stinger('ult'): the soaring ultimate cue · 'bossIntro', 'dawn', 'nightfall' for the cinematics
//
// Usage:
//   const music = new Music(audio);          // audio: AudioEngine
//   await music.load();
//   music.setMood('menu');                    // crossfades between moods
//   music.setIntensity(0.7);                  // combat density/tempo 0..1
//   music.stinger('rankup');                  // one-shot phrase over the bed
//   music.update(dt);                         // call each frame (also self-ticks)

import type { AudioEngine } from '../../engine/audio/AudioEngine';
import { INSTRUMENTS, type InstrumentSample } from './manifest';
import { ORCH, PERC, type OrchInst, type OrchSample, type PercId } from './orchManifest';

export type MusicMood = 'off' | 'menu' | 'hub' | 'intro' | 'explore' | 'night' | 'combat' | 'boss' | 'underworld' | 'victory' | 'tension';
export type StingerKind = 'rankup' | 'wave' | 'boss' | 'death' | 'victory' | 'discover' | 'funny' | 'ult' | 'bossIntro' | 'dawn' | 'nightfall';
type Guitar = 'steel' | 'nylon' | 'piano';
type Inst = Guitar | OrchInst;
const isOrch = (i: Inst): i is OrchInst => i in ORCH;

/** every instrument sample file (relative to the audio base) */
export const musicSampleFiles: string[] = [...INSTRUMENTS.steel, ...INSTRUMENTS.nylon, ...INSTRUMENTS.piano].map((s) => s.file);
/** the orchestral layer's files (loaded after the guitars, in the background) */
export const orchSampleFiles: string[] = [...Object.values(ORCH).flat().map((s) => s.file), ...Object.values(PERC).flat()];

// ---------------------------------------------------------------------------
// musical vocabulary
// ---------------------------------------------------------------------------
/** one note event inside a bar; times in beats */
interface Ev {
  b: number; // start beat within bar
  i: Inst;
  m: number; // midi
  v: number; // velocity 0..1
  d: number; // duration (beats)
  pm?: boolean; // palm mute
  pan?: number;
  lead?: boolean; // routed to the wetter lead bus
  bend?: number; // semitone bend reached at the end of the note
  slide?: number; // start this many semitones away and slide in
  det?: number; // detune factor (honky-tonk double strike)
  tr?: boolean; // tremolo re-pick (damps the previous strike quickly)
  // orchestral layer
  p?: PercId; // a percussion hit (m ignored; rate from r)
  r?: number; // perc playback rate
  k?: number; // perc take index (default: round robin)
  sw?: number; // swell: start at this fraction of the level and grow over the note
  att?: number; // attack (s)
  rel?: number; // release (s)
  lp?: number; // lowpass cutoff (Hz) for darker / softer dynamics
}

// Guitar voicings (low -> high)
const CH: Record<string, { root: number; strum: number[]; pow: number[]; arp: number[] }> = {
  E: { root: 40, strum: [40, 47, 52, 56, 59, 64], pow: [40, 47, 52], arp: [40, 47, 52, 56, 59, 64] },
  F: { root: 41, strum: [41, 48, 53, 57, 60, 65], pow: [41, 48, 53], arp: [41, 48, 53, 57, 60, 65] },
  G: { root: 43, strum: [43, 47, 50, 55, 59, 67], pow: [43, 50, 55], arp: [43, 50, 55, 59, 62, 67] },
  Am: { root: 45, strum: [45, 52, 57, 60, 64], pow: [45, 52, 57], arp: [45, 52, 57, 60, 64, 69] },
  A: { root: 45, strum: [45, 52, 57, 61, 64], pow: [45, 52, 57], arp: [45, 52, 57, 61, 64, 69] },
  Dm: { root: 50, strum: [50, 57, 62, 65], pow: [38, 45, 50], arp: [38, 50, 57, 62, 65, 69] },
  C: { root: 48, strum: [48, 52, 55, 60, 64], pow: [48, 55, 60], arp: [48, 55, 60, 64, 67, 72] },
  Gm: { root: 43, strum: [43, 50, 55, 58, 62, 67], pow: [43, 50, 55], arp: [43, 50, 55, 58, 62, 67] },
  B7: { root: 47, strum: [47, 51, 57, 59, 66], pow: [47, 54, 59], arp: [47, 51, 57, 59, 63, 66] },
};

// Motifs: [semitones above E4 (64), beats]. Rests have semitone null.
type Motif = [number | null, number][];
const MOTIF: Record<string, Motif> = {
  // the dustUP hook: E . F G# A | G# F E
  hook: [[0, 1.5], [1, 0.5], [4, 1], [5, 1], [4, 0.75], [1, 0.25], [0, 2], [null, 1]],
  // answer: rises to B and C, falls back through the augmented second
  answer: [[7, 1], [8, 0.5], [7, 0.5], [5, 1], [4, 1], [5, 0.5], [4, 0.5], [1, 0.5], [0, 0.5], [0, 2]],
  // high cry for climaxes
  cry: [[12, 2], [13, 1], [12, 1], [10, 0.5], [8, 0.5], [7, 1], [8, 1], [4, 2]],
  // descending 16th run (Phrygian dominant)
  run: [[12, 0.25], [10, 0.25], [8, 0.25], [7, 0.25], [5, 0.25], [4, 0.25], [1, 0.25], [0, 0.25]],
  // slow menu whistle-line
  lament: [[7, 2], [8, 1], [7, 1], [5, 2], [4, 1], [1, 1], [0, 3], [null, 1]],
  // boss: hammering b2
  boss: [[12, 0.5], [13, 0.5], [12, 0.5], [13, 0.5], [16, 1], [13, 1], [12, 1.5], [8, 0.5], [7, 2]],
};
// Andalusian & Phrygian progressions (one chord per bar)
const PROG = {
  andalusian: ['Am', 'G', 'F', 'E'],
  phrygian: ['E', 'F', 'E', 'E', 'E', 'F', 'G', 'F'],
  menu: ['Am', 'E', 'Am', 'E', 'Dm', 'Am', 'F', 'E'],
  underworld: ['E', 'E', 'F', 'E', 'Dm', 'Dm', 'F', 'E'],
  victory: ['E', 'A', 'E', 'B7', 'E', 'A', 'B7', 'E'],
  boss: ['E', 'E', 'F', 'E', 'E', 'Gm', 'F', 'E'],
};

// Ragtime (hub) - C major, 8+8 bars; [bass root midi, chord tones]
const RAG: [number, number[]][] = [
  [36, [60, 64, 67]], [36, [60, 64, 67]], [41, [60, 65, 69]], [42, [60, 63, 66, 69]],
  [43, [60, 64, 67]], [45, [61, 64, 67, 69]], [38, [60, 62, 66, 69]], [43, [59, 62, 65, 67]],
  [45, [60, 64, 69]], [40, [59, 62, 64, 68]], [45, [60, 64, 69]], [40, [59, 62, 64, 68]],
  [41, [60, 65, 69]], [36, [60, 64, 67]], [38, [60, 62, 66, 69]], [43, [59, 62, 65, 67]],
];
// ragtime melody fragments per bar (midi, beat, dur) - syncopated, two variants per bar
const RAG_MEL: [number, number, number][][][] = [
  [[[76, 0, 0.5], [79, 0.5, 0.5], [76, 1, 0.75], [74, 1.75, 0.25], [72, 2, 1], [67, 3, 0.5], [69, 3.5, 0.5]], [[72, 0, 0.75], [76, 0.75, 0.75], [79, 1.5, 1], [76, 2.5, 0.5], [72, 3, 1]]],
  [[[72, 0, 0.75], [74, 0.75, 0.25], [76, 1, 1], [79, 2, 0.75], [77, 2.75, 0.25], [76, 3, 1]], [[79, 0, 0.5], [81, 0.5, 0.5], [79, 1, 0.5], [76, 1.5, 1], [74, 2.5, 0.5], [72, 3, 1]]],
  [[[77, 0, 0.75], [81, 0.75, 0.75], [84, 1.5, 1], [81, 2.5, 0.5], [77, 3, 1]], [[72, 0, 0.5], [77, 0.5, 1], [81, 1.5, 0.5], [79, 2, 1], [77, 3, 1]]],
  [[[78, 0, 0.75], [75, 0.75, 0.75], [72, 1.5, 1], [69, 2.5, 0.5], [72, 3, 1]], [[75, 0, 1], [78, 1, 0.5], [81, 1.5, 1], [78, 2.5, 1.5]]],
  [[[79, 0, 1.5], [76, 1.5, 0.5], [72, 2, 0.75], [74, 2.75, 0.25], [76, 3, 1]], [[76, 0, 0.75], [79, 0.75, 0.75], [84, 1.5, 1.5], [79, 3, 1]]],
  [[[81, 0, 0.75], [79, 0.75, 0.25], [76, 1, 0.75], [73, 1.75, 0.25], [76, 2, 1], [81, 3, 1]], [[73, 0, 0.5], [76, 0.5, 0.5], [79, 1, 1], [81, 2, 2]]],
  [[[78, 0, 0.75], [81, 0.75, 0.75], [78, 1.5, 0.5], [74, 2, 0.75], [72, 2.75, 0.25], [74, 3, 1]], [[74, 0, 1], [78, 1, 0.5], [81, 1.5, 0.5], [79, 2, 0.5], [77, 2.5, 0.5], [74, 3, 1]]],
  [[[79, 0, 0.5], [77, 0.5, 0.5], [74, 1, 0.5], [71, 1.5, 0.5], [72, 2, 2]], [[71, 0, 0.75], [74, 0.75, 0.75], [77, 1.5, 0.5], [76, 2, 2]]],
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

class Rng {
  constructor(private s: number) {}
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length) % a.length];
  }
  chance(p: number) {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------------------
// bar writers
// ---------------------------------------------------------------------------
interface BarCtx {
  bar: number; // bar index within section
  beats: number; // beats per bar
  bpm: number;
  I: number; // intensity 0..1
  r: Rng;
  ev: Ev[];
  night?: number; // 0 day .. 1 night (colours combat)
}

function strum(c: BarCtx, chord: number[], b: number, v: number, d: number, up = false, inst: Inst = 'steel', spreadSec = 0.014) {
  const sb = (spreadSec * c.bpm) / 60;
  const notes = up ? [...chord].reverse() : chord;
  notes.forEach((m, k) => c.ev.push({ b: b + k * sb, i: inst, m, v: v * (up ? 0.85 : 1) * (1 - k * 0.03), d, pan: -0.25 + (k / notes.length) * 0.5 }));
}
function gallop(c: BarCtx, root: number, b: number, v: number, octave = false, double = false) {
  // "da da-da" (8th + two 16ths); double = straight 16ths
  const hits = double ? [0, 0.25, 0.5, 0.75] : [0, 0.5, 0.75];
  for (const h of hits) {
    const acc = h === 0 ? 1 : 0.78;
    c.ev.push({ b: b + h, i: 'steel', m: root, v: v * acc, d: 0.22, pm: true, pan: -0.15 });
    if (octave) c.ev.push({ b: b + h, i: 'steel', m: root + 12, v: v * acc * 0.7, d: 0.2, pm: true, pan: 0.15 });
  }
}
function tremolo(c: BarCtx, m: number, b: number, d: number, rate: number, v0: number, v1: number, lead = true) {
  const n = Math.max(1, Math.round(d * rate));
  for (let k = 0; k < n; k++) {
    const t = k / Math.max(1, n - 1);
    const v = (v0 + (v1 - v0) * t) * (0.86 + c.r.next() * 0.14);
    c.ev.push({ b: b + k / rate, i: 'steel', m, v, d: k === n - 1 ? 1.2 : 1 / rate, lead, pan: 0.2, tr: k !== n - 1 });
  }
}
function melody(c: BarCtx, motif: Motif, startBeat: number, base: number, v: number, opts: { tremoloRate?: number; inst?: Inst; ornament?: number; maxBeats?: number; slideIn?: boolean } = {}) {
  let t = startBeat;
  const end = opts.maxBeats !== undefined ? startBeat + opts.maxBeats : Infinity;
  motif.forEach(([s, d], idx) => {
    if (t >= end) return;
    const dur = Math.min(d, end - t);
    if (s !== null) {
      const m = base + s;
      // grace note ornament (lower neighbour hammer-on)
      if (opts.ornament && c.r.chance(opts.ornament) && dur >= 0.75) c.ev.push({ b: t - 0.08, i: opts.inst ?? 'steel', m: m - 1, v: v * 0.6, d: 0.1, lead: true, pan: 0.2 });
      if (opts.tremoloRate && dur >= 1) tremolo(c, m, t, dur, opts.tremoloRate, v * 0.9, v);
      else
        c.ev.push({
          b: t,
          i: opts.inst ?? 'steel',
          m,
          v,
          d: dur,
          lead: true,
          pan: 0.2,
          slide: opts.slideIn && idx === 0 ? -2 : undefined,
          bend: dur >= 2 && c.r.chance(0.3) ? 0.5 : undefined,
        });
    }
    t += d;
  });
  return t;
}
/** slice a motif across bars: returns the part that falls in [from, from+len) beats */
function motifSlice(motif: Motif, from: number, len: number): { m: Motif; offset: number } {
  const out: Motif = [];
  let t = 0;
  let offset = -1;
  for (const [s, d] of motif) {
    const a = t,
      b = t + d;
    if (b > from && a < from + len) {
      const st = Math.max(a, from);
      const en = Math.min(b, from + len);
      if (offset < 0) offset = st - from;
      out.push([st === a ? s : null, en - st]);
    }
    t = b;
  }
  return { m: out, offset: Math.max(0, offset) };
}
const motifLen = (m: Motif) => m.reduce((a, [, d]) => a + d, 0);

// ---------------------------------------------------------------------------
// orchestral writing
// ---------------------------------------------------------------------------
/** chord tones as pitch classes (C = 0) */
const PCS: Record<string, number[]> = {
  E: [4, 8, 11], F: [5, 9, 0], G: [7, 11, 2], Am: [9, 0, 4], A: [9, 1, 4], Dm: [2, 5, 9], C: [0, 4, 7], Gm: [7, 10, 2], B7: [11, 3, 6, 9],
};
/** chord tones of `ch` between lo and hi (midi), low to high; n > 0 keeps an evenly spread subset */
function tones(ch: string, lo: number, hi: number, n = 0): number[] {
  const pcs = PCS[ch] ?? PCS.E;
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  if (!n || out.length <= n) return out;
  return Array.from({ length: n }, (_, k) => out[Math.round((k * (out.length - 1)) / Math.max(1, n - 1))]);
}
/** the chord's root in [lo, lo + 11] */
function rootIn(ch: string, lo: number) {
  const pc = CH[ch] ? CH[ch].root % 12 : 4;
  return lo + ((pc - lo) % 12 + 12) % 12;
}
interface PadOpts {
  sw?: number;
  att?: number;
  rel?: number;
  lp?: number;
  pan?: number;
}
function pad(c: BarCtx, i: OrchInst, notes: number[], b: number, d: number, v: number, o: PadOpts = {}) {
  notes.forEach((m, k) => c.ev.push({ b: b + k * 0.012, i, m, v: v * (1 - k * 0.04), d, sw: o.sw, att: o.att, rel: o.rel, lp: o.lp, pan: o.pan ?? (notes.length > 1 ? -0.35 + (k / (notes.length - 1)) * 0.7 : 0) }));
}
function hit(c: BarCtx, p: PercId, b: number, v: number, r = 1, pan = 0) {
  c.ev.push({ b, i: 'str', m: 0, v, d: 0, p, r, pan });
}
/** a single orchestral line (motif) on `i` from base midi */
function oline(c: BarCtx, i: OrchInst, motif: Motif, b0: number, base: number, v: number, o: PadOpts & { slide?: boolean; maxBeats?: number } = {}) {
  let t = b0;
  const end = o.maxBeats !== undefined ? b0 + o.maxBeats : Infinity;
  for (const [s, d] of motif) {
    if (t >= end) break;
    if (s !== null) c.ev.push({ b: t, i, m: base + s, v, d: Math.min(d, end - t) * 0.98, att: o.att, rel: o.rel, lp: o.lp, sw: o.sw, pan: o.pan ?? 0.1, slide: o.slide && d >= 1 && c.r.chance(0.5) ? -1 : undefined });
    t += d;
  }
}
/** harp glissando through the Phrygian-dominant scale */
const SCALE = [0, 1, 4, 5, 7, 8, 10];
function gliss(c: BarCtx, from: number, n: number, b: number, step: number, v: number, down = false) {
  const notes: number[] = [];
  for (let m = from; notes.length < n; m += down ? -1 : 1) if (SCALE.includes((((m - 4) % 12) + 12) % 12)) notes.push(m);
  notes.forEach((m, k) => c.ev.push({ b: b + k * step, i: 'harp', m, v: v * (0.75 + 0.25 * (k / n)), d: 2, pan: 0.35 - (k / n) * 0.3 }));
}
/** the cymbal swell that lands exactly on beat `land` (2.6 s or 4.6 s take) */
function swellInto(c: BarCtx, land: number, long = false, v = 0.5) {
  const spb = 60 / c.bpm;
  const len = long ? 4.6 : 2.6;
  c.ev.push({ b: land - len / spb, i: 'str', m: 0, v, d: 0, p: 'swell', k: long ? 0 : 1, r: 1, pan: 0 });
}
/** maqsum on the darbuka (doum . tek tek . doum . tek .), denser with intensity */
function maqsum(c: BarCtx, v: number) {
  hit(c, 'dum', 0, v, 1, -0.1);
  hit(c, 'tek', 0.5, v * 0.55, 1, 0.2);
  hit(c, 'tek', 1.5, v * 0.7, 1.02, 0.2);
  hit(c, 'dum', 2, v * 0.9, 0.98, -0.1);
  hit(c, 'tek', 3, v * 0.7, 1, 0.2);
  if (c.I > 0.45) hit(c, 'ka', 2.5, v * 0.4, 1.05, 0.25), hit(c, 'ka', 3.5, v * 0.45, 1.05, 0.25);
  if (c.I > 0.75) hit(c, 'ka', 3.75, v * 0.4, 1.1, 0.3), hit(c, 'tek', 1, v * 0.35, 1.05, 0.2);
}

// ---------------------------------------------------------------------------
// moods
// ---------------------------------------------------------------------------
interface MoodSpec {
  bpm: (I: number) => number;
  beats: number;
  reverb: number; // send level
  delay: number; // lead slapback send
  gain: number;
  bar: (c: BarCtx, s: SectionState) => void;
}
interface SectionState {
  phraseMotif: Motif;
  plan: string[];
}

const MOODS = {
  menu: {
    bpm: () => 66,
    beats: 3,
    reverb: 0.55,
    delay: 0.15,
    gain: 1.5,
    bar(c, s) {
      const ch = CH[PROG.menu[c.bar % 8]];
      // fingerpicked 6/8-ish arpeggio on nylon: bass, 5th, octave, 3rd, octave, 5th
      const a = ch.arp;
      const pat = [0, 2, 3, 4, 3, 2];
      pat.forEach((k, j) => c.ev.push({ b: j * 0.5, i: 'nylon', m: a[Math.min(k, a.length - 1)], v: j === 0 ? 0.62 : 0.42 + c.r.next() * 0.08, d: j === 0 ? 2.8 : 1.2, pan: -0.3 + j * 0.1 }));
      // lament line on steel every other 8-bar phrase, two bars per motif chunk
      const phrase = Math.floor(c.bar / 8);
      if (phrase % 2 === 1) {
        const sl = motifSlice(MOTIF.lament, (c.bar % 8) * 3, 3);
        melody(c, sl.m, sl.offset, 64, 0.5, { ornament: 0.35, tremoloRate: 0 });
      } else if (c.bar % 8 === 7 && c.r.chance(0.6)) {
        c.ev.push({ b: 1.5, i: 'steel', m: 76, v: 0.35, d: 2, lead: true, bend: -1 });
      }
    },
  },
  intro: {
    bpm: () => 80,
    beats: 4,
    reverb: 0.6,
    delay: 0.25,
    gain: 1.8,
    bar(c) {
      const k = c.bar % 16;
      // low E drone struck every 2 bars
      if (k % 2 === 0) c.ev.push({ b: 0, i: 'steel', m: 40, v: 0.75, d: 8 });
      if (k < 4) {
        // tremolo swells E4 -> F4 -> E4 (the b2 sigh)
        tremolo(c, k % 2 === 0 ? 64 : 65, 0, 4, 6, 0.25, 0.55);
      } else if (k < 12) {
        const sl = motifSlice(k < 8 ? MOTIF.hook : MOTIF.answer, ((k - 4) % 4) * 4, 4);
        melody(c, sl.m, sl.offset, 64, 0.62, { tremoloRate: 6, ornament: 0.3 });
        if (k >= 8) strum(c, CH[PROG.andalusian[k % 4]].strum, 0, 0.45, 3.5);
      } else {
        strum(c, CH[PROG.andalusian[k % 4]].strum, 0, 0.6, 2);
        strum(c, CH[PROG.andalusian[k % 4]].strum, 2.5, 0.5, 1.5, true);
        if (k === 15) tremolo(c, 76, 0, 4, 8, 0.4, 0.75);
        else {
          const sl = motifSlice(MOTIF.cry, ((k - 12) % 4) * 4, 4);
          melody(c, sl.m, sl.offset, 64, 0.7, { tremoloRate: 8 });
        }
      }
    },
  },
  explore: {
    bpm: (I) => 92 + I * 10,
    beats: 4,
    reverb: 0.35,
    delay: 0.2,
    gain: 1.1,
    bar(c, s) {
      const ch = CH[PROG.phrygian[c.bar % 8]];
      const v = 0.38 + c.I * 0.2;
      for (let b = 0; b < 4; b++) gallop(c, ch.root, b, v);
      if (c.bar % 2 === 0) c.ev.push({ b: 0, i: 'nylon', m: ch.root, v: 0.45, d: 7 });
      if (c.bar % 2 === 0) strum(c, ch.strum, 0, 0.42, 1.5);
      if (c.bar % 4 === 3) strum(c, ch.strum, 2.5, 0.35, 1, true);
      // lead: phrase motif across 2-bar windows, every other phrase half
      const ph = c.bar % 8;
      if (ph >= 4) {
        const sl = motifSlice(s.phraseMotif, (ph - 4) * 4, 4);
        melody(c, sl.m, sl.offset, 64, 0.5 + c.I * 0.15, { tremoloRate: c.I > 0.4 ? 6 : 0, ornament: 0.3 });
      }
    },
  },
  combat: {
    bpm: (I) => 112 + I * 28,
    beats: 4,
    reverb: 0.28,
    delay: 0.18,
    gain: 0.74,
    bar(c, s) {
      const prog = c.I > 0.55 ? PROG.andalusian : PROG.phrygian;
      const ch = CH[prog[c.bar % prog.length]];
      const v = 0.55 + c.I * 0.25;
      for (let b = 0; b < 4; b++) gallop(c, ch.root, b, v, c.I > 0.45, c.I > 0.8 && b % 2 === 1);
      strum(c, ch.pow, 0, 0.6 + c.I * 0.2, 0.6);
      strum(c, ch.strum, 1.5, 0.5, 0.5, true);
      if (c.I > 0.3) strum(c, ch.pow, 2.5, 0.55, 0.4);
      const ph = c.bar % 8;
      const ml = motifLen(s.phraseMotif);
      const sl = motifSlice(s.phraseMotif, (ph % Math.ceil(ml / 4)) * 4, 4);
      if (ph < 6 || c.I < 0.7) {
        melody(c, sl.m, sl.offset, c.I > 0.6 ? 76 : 64, 0.62 + c.I * 0.2, { tremoloRate: 8, ornament: 0.4 });
      } else {
        melody(c, MOTIF.run, 0, 64 + (ph === 7 ? 12 : 0), 0.7, { maxBeats: 2 });
        melody(c, MOTIF.run, 2, 64, 0.65, { maxBeats: 2 });
      }
    },
  },
  boss: {
    bpm: (I) => 146 + I * 10,
    beats: 4,
    reverb: 0.3,
    delay: 0.2,
    gain: 0.62,
    bar(c, s) {
      const ch = CH[PROG.boss[c.bar % 8]];
      // driving 16th gallop with b2 kicks every bar end
      for (let b = 0; b < 4; b++) gallop(c, ch.root, b, 0.82, true, b % 2 === 1);
      c.ev.push({ b: 3.5, i: 'steel', m: ch.root + 1, v: 0.9, d: 0.25, pm: true });
      strum(c, ch.pow, 0, 0.9, 0.5);
      strum(c, CH[ch === CH.E ? 'F' : 'E'].pow, 1.75, 0.8, 0.25);
      strum(c, ch.pow, 2, 0.85, 0.5);
      const ph = c.bar % 8;
      if (ph < 4) {
        const sl = motifSlice(MOTIF.boss, ph * 4, 4);
        melody(c, sl.m, sl.offset, 64, 0.85, { tremoloRate: 10 });
      } else if (ph < 7) {
        const sl = motifSlice(MOTIF.cry, (ph - 4) * 4, 4);
        melody(c, sl.m, sl.offset, 64, 0.85, { tremoloRate: 10, ornament: 0.4 });
      } else {
        melody(c, MOTIF.run, 0, 76, 0.85, { maxBeats: 2 });
        melody(c, MOTIF.run, 2, 64, 0.85, { maxBeats: 2 });
      }
    },
  },
  tension: {
    bpm: () => 72,
    beats: 4,
    reverb: 0.5,
    delay: 0.25,
    gain: 1.45,
    bar(c) {
      // muted low-E tremolo pedal, rising and falling
      for (let k = 0; k < 16; k++) c.ev.push({ b: k * 0.25, i: 'steel', m: 40, v: 0.25 + 0.15 * Math.sin((k / 16) * Math.PI), d: 0.2, pm: true });
      if (c.bar % 2 === 1) c.ev.push({ b: 2, i: 'steel', m: c.bar % 4 === 1 ? 77 : 76, v: 0.4, d: 2, lead: true, bend: c.bar % 4 === 1 ? -1 : undefined });
      if (c.bar % 4 === 0) c.ev.push({ b: 0, i: 'nylon', m: 41, v: 0.5, d: 4 });
    },
  },
  underworld: {
    bpm: () => 54,
    beats: 4,
    reverb: 0.8,
    delay: 0.3,
    gain: 1.75,
    bar(c) {
      const ch = CH[PROG.underworld[c.bar % 8]];
      const a = ch.arp;
      // slow descending/ascending low arpeggio on nylon
      const order = c.bar % 2 === 0 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 2, 1, 3, 2, 4, 3, 1];
      order.forEach((k, j) => c.ev.push({ b: j * 0.5, i: 'nylon', m: a[Math.min(k, a.length - 1)], v: j === 0 ? 0.55 : 0.32 + c.r.next() * 0.06, d: 2.5, pan: -0.4 + j * 0.1 }));
      if (c.bar % 4 === 3) c.ev.push({ b: 2.5, i: 'nylon', m: 77, v: 0.28, d: 3, lead: true }); // the eerie b2 above
      if (c.bar % 8 === 0) c.ev.push({ b: 0, i: 'piano', m: 28 + 12, v: 0.35, d: 6 }); // deep E on piano
    },
  },
  hub: {
    bpm: () => 104,
    beats: 4,
    reverb: 0.12,
    delay: 0,
    gain: 0.92,
    bar(c) {
      const k = c.bar % 16;
      const [bass, chord] = RAG[k];
      // stride: bass on 1 (octave), chord on 2, bass (5th) on 3, chord on 4
      const fifth = bass + 7 > 47 ? bass - 5 : bass + 7;
      c.ev.push({ b: 0, i: 'piano', m: bass, v: 0.62, d: 0.9 }, { b: 0, i: 'piano', m: bass + 12, v: 0.45, d: 0.9 });
      chord.forEach((m) => c.ev.push({ b: 1, i: 'piano', m, v: 0.42, d: 0.45 }));
      c.ev.push({ b: 2, i: 'piano', m: fifth, v: 0.55, d: 0.9 });
      chord.forEach((m) => c.ev.push({ b: 3, i: 'piano', m, v: 0.4, d: 0.45 }));
      // melody (ragtime), every other pass an alternate line; honky-tonk double strike
      const mel = RAG_MEL[k % 8][Math.floor(c.bar / 16) % 2 === 0 ? (k < 8 ? 0 : 1) : k < 8 ? 1 : 0];
      for (const [m, b, d] of mel) {
        c.ev.push({ b, i: 'piano', m, v: 0.55 + c.r.next() * 0.08, d });
        c.ev.push({ b: b + 0.025, i: 'piano', m, v: 0.3, d, det: 1.007 });
      }
    },
  },
  victory: {
    bpm: () => 100,
    beats: 4,
    reverb: 0.45,
    delay: 0.2,
    gain: 0.74,
    bar(c) {
      const ch = CH[PROG.victory[c.bar % 8]];
      strum(c, ch.strum, 0, 0.75, 2);
      strum(c, ch.strum, 1.5, 0.5, 1, true);
      strum(c, ch.strum, 2, 0.6, 2);
      strum(c, ch.strum, 3.5, 0.45, 0.5, true);
      c.ev.push({ b: 0, i: 'steel', m: ch.root, v: 0.7, d: 2 });
      if (c.bar % 8 === 7) tremolo(c, 80, 0, 4, 8, 0.5, 0.8);
      else if (c.bar % 2 === 0) {
        const sl = motifSlice(MOTIF.answer, ((c.bar % 8) / 2) * 4, 4);
        melody(c, sl.m, sl.offset, 68, 0.6, { tremoloRate: 8 });
      }
    },
  },
} as Omit<Record<Exclude<MusicMood, 'off'>, MoodSpec>, 'night'> as Record<Exclude<MusicMood, 'off'>, MoodSpec>;

/** the calm night ride: tremolo strings, the dark choir, a lone ney, oud-like nylon plucks */
MOODS.night = {
  bpm: () => 70,
  beats: 4,
  reverb: 0.55,
  delay: 0.3,
  gain: 1.5,
  bar(c) {
    const prog = PROG.underworld;
    const ch = CH[prog[c.bar % 8]];
    const a = ch.arp;
    // sparse low nylon, every other bar a little oud-like mordent figure up high
    [0, 2, 3].forEach((k, j) => c.ev.push({ b: j * 1.5, i: 'nylon', m: a[Math.min(k, a.length - 1)], v: j === 0 ? 0.5 : 0.3, d: 3, pan: -0.3 + j * 0.2 }));
    if (c.bar % 2 === 1) {
      const top = ch.root + 24;
      [[2.5, top, 0.25], [2.75, top + 1, 0.25], [3, top, 1]].forEach(([b, m, d]) => c.ev.push({ b, i: 'nylon', m, v: 0.4, d, lead: true, pan: 0.25, slide: b === 3 ? 1 : undefined }));
    }
  },
};

/** the orchestral layer of each mood (written into the same bar as the guitars) */
const ORCH_PART: Partial<Record<Exclude<MusicMood, 'off'>, (c: BarCtx, s: SectionState) => void>> = {
  menu(c) {
    const chn = PROG.menu[c.bar % 8];
    const phrase = Math.floor(c.bar / 8) % 4;
    pad(c, 'str', [rootIn(chn, 40), rootIn(chn, 40) + 7], 0, 3, 0.42, { sw: 0.5, att: 0.5, rel: 1.6, lp: 2600 });
    pad(c, 'str', tones(chn, 60, 72, 3), 0.05, 3, 0.26, { sw: 0.6, att: 0.7, rel: 1.6, lp: 3200 });
    if (phrase >= 1) pad(c, 'choirA', tones(chn, 50, 62, 3), 0, 3, phrase === 3 ? 0.42 : 0.3, { sw: 0.4, att: 0.9, rel: 1.8 });
    if (phrase === 2 || phrase === 3) {
      const sl = motifSlice(MOTIF.lament, (c.bar % 8) * 3, 3);
      oline(c, 'horn', sl.m, sl.offset, 52, 0.48, { att: 0.18, rel: 0.9, slide: true });
    }
    if (phrase >= 1) hit(c, 'frame', 0, 0.28, 0.9, -0.1);
    if (c.bar % 8 === 7) gliss(c, 52, 10, 1, 0.12, 0.32);
    if (c.bar % 32 === 0) hit(c, 'gong', 0, 0.3, 0.9);
    if (phrase === 3 && c.bar % 8 === 0) hit(c, 'taiko', 0, 0.32, 0.9);
  },
  intro(c) {
    const k = c.bar % 16;
    const chn = k < 12 ? 'E' : PROG.andalusian[k % 4];
    if (k % 4 === 0) pad(c, 'str', [40, 47], 0, 16, 0.4, { sw: 0.3, att: 1.2, rel: 2.5, lp: 2200 });
    if (k % 4 === 0) pad(c, 'lowbr', [40], 0, 16, 0.25, { sw: 0.2, att: 1.5, rel: 2 });
    if (k >= 4 && k % 2 === 0) pad(c, 'choirU', k < 8 ? [52, 53] : tones(chn, 50, 62, 3), 0, 8, 0.32, { sw: 0.3, att: 1.2, rel: 2 });
    if (k >= 8 && k < 12 && k % 2 === 0) pad(c, 'horn', tones(chn, 47, 60, 3), 0, 8, 0.36, { sw: 0.2, att: 0.6, rel: 1.5 });
    if (k === 11) swellInto(c, 4, false, 0.55);
    if (k >= 12) {
      pad(c, 'str', tones(chn, 52, 76, 5), 0, 4, 0.36, { att: 0.15, rel: 1.4 });
      pad(c, 'choirA', tones(chn, 50, 62, 3), 0, 4, 0.4, { att: 0.3, rel: 1.6 });
      hit(c, 'timp', 0, 0.55);
      hit(c, 'taiko', 0, k === 12 ? 0.8 : 0.5);
      if (k === 12) hit(c, 'crash', 0, 0.5), hit(c, 'gong', 0, 0.45);
    }
    if (k === 0) hit(c, 'gong', 0, 0.35, 0.85);
  },
  explore(c, s) {
    const chn = PROG.phrygian[c.bar % 8];
    const ph = c.bar % 8;
    const phrase = Math.floor(c.bar / 8);
    if (c.bar % 2 === 0) pad(c, 'str', [rootIn(chn, 40), rootIn(chn, 40) + 7], 0, 8, 0.32, { sw: 0.5, att: 0.7, rel: 1.5, lp: 2400 });
    if (c.bar % 4 === 0) pad(c, 'str', tones(chn, 74, 84, 2), 0.1, 16, 0.14, { sw: 0.2, att: 2, rel: 2.5, lp: 5000 });
    // the gallop under the gallop: frame drum and riq
    hit(c, 'frame', 0, 0.36, 1, -0.15);
    hit(c, 'frame', 2, 0.28, 1.04, -0.15);
    hit(c, 'frameHi', 1.5, 0.16 + c.I * 0.1, 1, 0.2);
    hit(c, 'frameHi', 3.5, 0.16 + c.I * 0.1, 1.03, 0.2);
    if (c.I > 0.3) hit(c, 'riq', 1, 0.14, 1, 0.3), hit(c, 'riq', 3, 0.14, 1.04, 0.3);
    // the ney answers in the first half of every other phrase, where the guitar lead rests
    if (ph < 4 && phrase % 2 === 1) {
      const sl = motifSlice(phrase % 4 === 1 ? MOTIF.answer : MOTIF.lament, ph * 4, 4);
      oline(c, 'ney', sl.m, sl.offset, 76, 0.42, { att: 0.09, rel: 0.6, slide: true, pan: -0.2 });
    }
    if (ph === 6) pad(c, 'horn', tones(chn, 47, 59, 2), 0, 8, 0.32, { sw: 0.2, att: 0.5, rel: 1.4 });
    if (ph === 7 && phrase % 2 === 0) gliss(c, 52, 12, 2, 0.125, 0.3);
    if (s && c.bar % 32 === 0) hit(c, 'gong', 0, 0.22, 0.95);
  },
  night(c) {
    const chn = PROG.underworld[c.bar % 8];
    const phrase = Math.floor(c.bar / 8);
    if (c.bar % 2 === 0) {
      pad(c, 'trem', [40, 47], 0, 8, 0.28, { sw: 0.3, att: 1, rel: 2, lp: 1600 });
      pad(c, 'choirU', tones(chn, 50, 60, 3), 0, 8, 0.26, { sw: 0.2, att: 1.6, rel: 2.4, lp: 3000 });
    }
    if (c.bar % 4 === 1) pad(c, 'trem', [c.bar % 8 === 1 ? 77 : 76], 0, 12, 0.1, { sw: 0.1, att: 2, rel: 2.5 });
    if (phrase % 2 === 1) {
      const sl = motifSlice(MOTIF.lament, (c.bar % 8) * 4, 4);
      oline(c, 'ney', sl.m, sl.offset, 64, 0.4, { att: 0.12, rel: 0.9, slide: true, pan: -0.15 });
    }
    hit(c, 'frameHi', 0, 0.18, 0.9, -0.2);
    if (c.bar % 2 === 1) hit(c, 'dum', 0, 0.26, 0.92);
    if (c.bar % 4 === 3) hit(c, 'fcym', 3, 0.22, 1, 0.3);
    if (c.bar % 16 === 0) hit(c, 'gong', 0, 0.26, 0.8);
  },
  combat(c, s) {
    const prog = c.I > 0.55 ? PROG.andalusian : PROG.phrygian;
    const chn = prog[c.bar % prog.length];
    const r = rootIn(chn, 40);
    const ph = c.bar % 8;
    const night = (c.night ?? 0) > 0.5;
    // spiccato ostinato in eighths (root, the b2 kick, the octave)
    [0, 0, 12, 0, 1, 0, 12, 7].forEach((st, k) => c.ev.push({ b: k * 0.5, i: 'spic', m: r + st, v: (k % 2 ? 0.4 : 0.52) + c.I * 0.18, d: 0.4, pan: 0.25 }));
    if (c.I > 0.5) [0, 1, 0, 3, 4, 3, 1, 0].forEach((st, k) => c.ev.push({ b: k * 0.5, i: 'spic', m: rootIn(chn, 62) + st, v: 0.32 + c.I * 0.12, d: 0.35, pan: -0.3 }));
    maqsum(c, 0.42 + c.I * 0.25);
    hit(c, 'frame', 0, 0.4, 1, -0.1);
    if (ph === 0) hit(c, 'taiko', 0, 0.5 + c.I * 0.3);
    if (c.I > 0.7 && ph % 2 === 1) hit(c, 'taiko', 2, 0.45), hit(c, 'taikoRim', 3.5, 0.35);
    if (c.I > 0.3 && ph % 4 === 0) pad(c, 'horn', tones(chn, 47, 62, 3), 0, 8, 0.28 + c.I * 0.2, { sw: 0.25, att: 0.4, rel: 1.2 });
    if (night) {
      if (ph % 2 === 0) pad(c, 'trem', tones(chn, 74, 84, 2), 0, 8, 0.16, { sw: 0.2, att: 1, rel: 1.5 });
      if (ph % 4 === 0) pad(c, 'choirU', tones(chn, 50, 60, 3), 0, 16, 0.3, { sw: 0.3, att: 1.2, rel: 2 });
    } else if (c.I > 0.7 && ph % 4 === 0) pad(c, 'choirA', tones(chn, 50, 62, 3), 0, 16, 0.32, { sw: 0.3, att: 1, rel: 2 });
    if (ph === 6) pad(c, 'str', tones(chn, 64, 79, 3), 0, 8, 0.3, { sw: 0.15, att: 0.6, rel: 0.8 });
    if (ph === 7) swellInto(c, 4, false, 0.32 + c.I * 0.2);
    if (s && c.bar % 16 === 0 && c.I > 0.5) hit(c, 'crash', 0, 0.3);
  },
  boss(c) {
    const chn = PROG.boss[c.bar % 8];
    const r = rootIn(chn, 40);
    const ph = c.bar % 8;
    // the drums of the gods
    hit(c, 'taiko', 0, 0.85);
    hit(c, 'taiko', 1.5, 0.55, 1.04);
    hit(c, 'taiko', 2, 0.7, 0.98);
    hit(c, 'taiko', 3.5, 0.5, 1.06);
    hit(c, 'taikoRim', 1, 0.3), hit(c, 'taikoRim', 3, 0.3);
    hit(c, 'timp', 0, 0.6), hit(c, 'timp', 2, 0.5);
    maqsum(c, 0.4);
    // low brass hammering the root and the b2
    [0, 1, 2, 3].forEach((b) => c.ev.push({ b, i: 'lowbr', m: r + (b === 3 && ph % 2 ? 1 : 0), v: b === 0 ? 0.62 : 0.48, d: 0.75, att: 0.03, rel: 0.25, pan: 0.3 }));
    pad(c, 'horn', tones(chn, 52, 64, 3), 0, 1.5, 0.5, { att: 0.04, rel: 0.5 });
    [0, 0, 1, 0, 12, 0, 1, 7].forEach((st, k) => c.ev.push({ b: k * 0.5, i: 'spic', m: r + st, v: 0.55, d: 0.35, pan: 0.2 }));
    if (ph % 2 === 0) pad(c, 'choirA', tones(chn, 50, 62, 3), 0, 8, 0.42, { sw: 0.35, att: 0.6, rel: 1.6 });
    if (ph >= 4 && ph < 7) {
      const sl = motifSlice(MOTIF.cry, (ph - 4) * 4, 4);
      oline(c, 'tpt', sl.m, sl.offset, 64, 0.5, { att: 0.05, rel: 0.6 });
      pad(c, 'str', tones(chn, 64, 79, 3), 0, 4, 0.32, { att: 0.15, rel: 0.6 });
    }
    if (ph === 7) swellInto(c, 4, false, 0.5);
    if (ph === 0) hit(c, 'crash', 0, 0.4);
    if (c.bar % 16 === 0) hit(c, 'gong', 0, 0.45);
  },
  tension(c) {
    if (c.bar % 2 === 0) pad(c, 'trem', [40], 0, 8, 0.3, { sw: 0.2, att: 1, rel: 1.5, lp: 1400 });
    if (c.bar % 4 === 0) pad(c, 'choirU', [52, 53], 0, 16, 0.2, { sw: 0.2, att: 2, rel: 2.5 });
    if (c.bar % 4 === 2) hit(c, 'timpRoll', 0, 0.3);
    hit(c, 'frameHi', 0, 0.14, 0.85);
  },
  underworld(c) {
    const chn = PROG.underworld[c.bar % 8];
    if (c.bar % 2 === 0) pad(c, 'choirU', tones(chn, 48, 60, 3), 0, 8, 0.34, { sw: 0.3, att: 1.6, rel: 2.5 });
    if (c.bar % 4 === 0) pad(c, 'trem', [40, 47], 0, 16, 0.24, { sw: 0.2, att: 1.5, rel: 2.5, lp: 1500 });
    if (c.bar % 2 === 1) hit(c, 'timp', 0, 0.3, 0.9);
    if (c.bar % 8 === 0) hit(c, 'gong', 0, 0.38, 0.8);
    if (c.bar % 8 === 5) oline(c, 'ney', [[13, 2], [12, 2]], 0, 64, 0.32, { att: 0.2, rel: 1, slide: true });
  },
  hub(c) {
    const k = c.bar % 16;
    hit(c, 'riq', 1, 0.12, 1, 0.3), hit(c, 'riq', 3, 0.12, 1.03, 0.3);
    if (k % 2 === 0) hit(c, 'dum', 0, 0.18, 1, -0.2);
    if (k === 15) gliss(c, 60, 10, 2, 0.1, 0.25);
  },
  victory(c) {
    const chn = PROG.victory[c.bar % 8];
    pad(c, 'str', [rootIn(chn, 40), ...tones(chn, 55, 76, 4)], 0, 4, 0.34, { att: 0.12, rel: 1 });
    pad(c, 'horn', tones(chn, 52, 64, 3), 0, 2, 0.4, { att: 0.05, rel: 0.6 });
    pad(c, 'horn', tones(chn, 52, 64, 3), 2, 2, 0.34, { att: 0.05, rel: 0.8 });
    if (c.bar % 2 === 0) {
      const sl = motifSlice(MOTIF.answer, ((c.bar % 8) / 2) * 4, 4);
      oline(c, 'tpt', sl.m, sl.offset, 68, 0.42, { att: 0.04, rel: 0.6 });
    }
    hit(c, 'timp', 0, 0.5), hit(c, 'taiko', 0, c.bar % 4 === 0 ? 0.6 : 0.35);
    if (c.bar % 8 === 0) hit(c, 'crash', 0, 0.4);
    pad(c, 'choirA', tones(chn, 50, 62, 3), 0, 4, 0.28, { att: 0.4, rel: 1.2 });
  },
};
/** hall reverb send per mood (the orchestra's room) */
const HALL: Partial<Record<Exclude<MusicMood, 'off'>, number>> = { menu: 0.75, intro: 0.8, explore: 0.55, night: 0.8, combat: 0.42, boss: 0.45, tension: 0.7, underworld: 0.9, hub: 0.3, victory: 0.55 };
/** per-instrument level, attack, release and hall send */
const OI: Record<OrchInst, { g: number; att: number; rel: number; hall: number }> = {
  str: { g: 0.62, att: 0.22, rel: 0.9, hall: 0.55 },
  trem: { g: 0.55, att: 0.25, rel: 0.9, hall: 0.6 },
  spic: { g: 0.55, att: 0.002, rel: 0.12, hall: 0.35 },
  horn: { g: 0.56, att: 0.12, rel: 0.7, hall: 0.5 },
  lowbr: { g: 0.58, att: 0.08, rel: 0.5, hall: 0.4 },
  tpt: { g: 0.5, att: 0.05, rel: 0.5, hall: 0.5 },
  ney: { g: 0.5, att: 0.08, rel: 0.6, hall: 0.65 },
  harp: { g: 0.5, att: 0.002, rel: 1.6, hall: 0.6 },
  choirA: { g: 0.6, att: 0.6, rel: 1.4, hall: 0.7 },
  choirU: { g: 0.6, att: 0.7, rel: 1.6, hall: 0.75 },
};
const PERC_G: Record<PercId, number> = { taiko: 0.95, taikoRim: 0.5, timp: 0.8, timpRoll: 0.6, dum: 0.6, tek: 0.45, ka: 0.4, frame: 0.6, frameHi: 0.45, riq: 0.4, fcym: 0.4, gong: 0.7, crash: 0.5, swell: 0.55 };

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------
interface Section {
  mood: Exclude<MusicMood, 'off'>;
  spec: MoodSpec;
  out: GainNode; // section fader
  lead: GainNode;
  orch: GainNode; // the orchestral layer (dry into out)
  hall: number; // the orchestra's hall send
  nextBar: number; // audio time of next bar
  bar: number;
  bpm: number;
  state: SectionState;
}

export class Music {
  private ctx: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private master: GainNode;
  private dry: GainNode;
  private rvbIn: GainNode;
  private dlyIn: GainNode;
  private duckGain: GainNode;
  private cur: Section | null = null;
  private old: Section[] = [];
  private mood: MusicMood = 'off';
  private intensity = 0.3;
  private targetIntensity = 0.3;
  private rng = new Rng(0xd057);
  private timer = 0;
  private hallIn: GainNode;
  /** 0 day .. 1 night: read off the run's sky (window.__days.night) unless setNight says otherwise */
  private night = 0;
  private nightSet: number | null = null;
  private rr = new Map<string, number>();
  loaded = false;
  /** the orchestral layer has finished loading */
  orchLoaded = false;
  /** orchestral layer level 0..1 (settings may expose it) */
  orchLevel = 1;

  constructor(private audio: AudioEngine, private base = 'audio/') {
    const ctx = (this.ctx = audio.ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.duckGain = ctx.createGain();
    this.master.connect(this.duckGain).connect(audio.buses.music);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    // cavernous canyon reverb (convolution with a decaying-noise impulse)
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(3.4, 2.2);
    this.rvbIn = ctx.createGain();
    const rvbOut = ctx.createGain();
    rvbOut.gain.value = 0.9;
    const rvbHp = ctx.createBiquadFilter();
    rvbHp.type = 'highpass';
    rvbHp.frequency.value = 220;
    this.rvbIn.connect(rvbHp).connect(conv).connect(rvbOut).connect(this.master);
    // slapback echo for the lead (classic western twang)
    const dl = ctx.createDelay(1.0);
    dl.delayTime.value = 0.29;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.dlyIn = ctx.createGain();
    this.dlyIn.connect(dl);
    dl.connect(lp).connect(fb).connect(dl);
    lp.connect(this.master);
    lp.connect(this.rvbIn);
    // the orchestra's hall: a long, dark temple tail
    const hall = ctx.createConvolver();
    hall.buffer = this.impulse(4.8, 2.6);
    this.hallIn = ctx.createGain();
    const hallHp = ctx.createBiquadFilter();
    hallHp.type = 'highpass';
    hallHp.frequency.value = 150;
    const hallOut = ctx.createGain();
    hallOut.gain.value = 0.75;
    this.hallIn.connect(hallHp).connect(hall).connect(hallOut).connect(this.master);
  }

  private impulse(seconds: number, decay: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lpState = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // darker as it decays: one-pole lowpass whose coefficient falls over time
        const k = 0.6 - 0.45 * t;
        lpState += (rnd() - lpState) * k;
        d[i] = lpState * Math.pow(1 - t, decay) * 0.5;
      }
    }
    return buf;
  }

  private async fetchAll(list: string[], workers: number) {
    const files = list.slice();
    const work = async () => {
      while (files.length) {
        const f = files.shift()!;
        try {
          const b = await this.audio.loadBuffer(this.base + f);
          this.buffers.set(f, b);
        } catch (e) {
          console.warn('[music] failed to load', f, e);
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, work));
  }

  /** the guitars and piano (resolves when they are in); the orchestra keeps loading behind it */
  async load(): Promise<void> {
    await this.fetchAll(musicSampleFiles, 6);
    this.loaded = true;
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 120);
    this.tick();
    void this.fetchAll(orchSampleFiles, 3).then(() => (this.orchLoaded = true));
  }

  /** everything, the orchestra included (offline renders, tests) */
  async loadAll(): Promise<void> {
    await this.fetchAll([...musicSampleFiles, ...orchSampleFiles], 6);
    this.loaded = this.orchLoaded = true;
  }

  /** night 0..1 for the score (null: follow the run's sky again) */
  setNight(n: number | null) {
    this.nightSet = n === null ? null : clamp(n, 0, 1);
  }

  /** duck the score under something (a whisper, a cutscene line) for `hold` seconds */
  duck(amount: number, hold = 1.5, fade = 0.25) {
    const t = this.ctx.currentTime;
    const dg = this.duckGain.gain;
    dg.cancelScheduledValues(t);
    dg.setValueAtTime(dg.value, t);
    dg.linearRampToValueAtTime(clamp(1 - amount, 0.05, 1), t + fade);
    dg.setValueAtTime(clamp(1 - amount, 0.05, 1), t + fade + hold);
    dg.linearRampToValueAtTime(1, t + fade + hold + 1.2);
  }

  /** the spec that actually plays for a requested mood (explore turns into the night ride after dark) */
  private resolve(m: Exclude<MusicMood, 'off'>): Exclude<MusicMood, 'off'> {
    return m === 'explore' && this.night > (this.cur?.mood === 'night' ? 0.45 : 0.55) ? 'night' : m;
  }

  getMood() {
    return this.mood;
  }

  setMood(m: MusicMood, fade = 1.5) {
    if (m === this.mood) return;
    this.mood = m;
    this.startSection(m === 'off' ? 'off' : this.resolve(m), fade);
  }

  private startSection(m: MusicMood, fade: number) {
    const t = this.ctx.currentTime;
    if (this.cur) {
      const s = this.cur;
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setValueAtTime(s.out.gain.value, t);
      s.out.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fade));
      this.old.push(s);
      setTimeout(() => {
        s.out.disconnect();
        s.lead.disconnect();
        s.orch.disconnect();
        this.old = this.old.filter((x) => x !== s);
      }, (fade + 8) * 1000);
      this.cur = null;
    }
    if (m === 'off') return;
    const spec = MOODS[m];
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(spec.gain, t + Math.max(0.05, fade * 0.8));
    out.connect(this.dry);
    const rv = this.ctx.createGain();
    rv.gain.value = spec.reverb;
    out.connect(rv).connect(this.rvbIn);
    const lead = this.ctx.createGain();
    lead.connect(out);
    const dl = this.ctx.createGain();
    dl.gain.value = spec.delay;
    lead.connect(dl).connect(this.dlyIn);
    const orch = this.ctx.createGain();
    orch.gain.value = this.orchLevel;
    orch.connect(out);
    this.cur = {
      mood: m,
      spec,
      out,
      lead,
      orch,
      hall: HALL[m] ?? 0.5,
      nextBar: t + 0.08,
      bar: 0,
      bpm: spec.bpm(this.intensity),
      state: { phraseMotif: MOTIF.hook, plan: [] },
    };
    this.tick();
  }

  setIntensity(x: number) {
    this.targetIntensity = clamp(x, 0, 1);
  }

  update(dt: number) {
    // smooth intensity changes so tempo/density don't lurch
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 0.8);
    // night: the run's sky (Days) unless told; only the riding moods care
    const days = (window as unknown as { __days?: { night?: number } }).__days;
    const want = this.nightSet ?? (this.mood === 'explore' || this.mood === 'combat' ? days?.night ?? 0 : 0);
    const was = this.night;
    this.night += (want - this.night) * Math.min(1, dt * 0.5);
    if (this.mood === 'explore' && this.cur) {
      const key = this.resolve('explore');
      if (key !== this.cur.mood) {
        this.startSection(key, 4);
        this.stinger(key === 'night' ? 'nightfall' : 'dawn');
      }
    } else if (this.mood === 'combat' && was <= 0.55 && this.night > 0.55) this.stinger('nightfall');
    this.tick();
  }

  private tick() {
    if (!this.loaded || !this.cur) return;
    const ctx = this.ctx;
    const s = this.cur;
    // don't run away when the context is suspended (no user gesture yet)
    const horizon = ctx.state === 'running' ? 1.2 : 0.3;
    let guard = 0;
    while (s.nextBar < ctx.currentTime + horizon && guard++ < 4) {
      if (s.nextBar < ctx.currentTime - 0.5) s.nextBar = ctx.currentTime + 0.05; // after a stall, re-sync instead of bursting
      s.bpm = s.spec.bpm(this.intensity);
      if (s.bar % 8 === 0) {
        // choose the motif for this 8-bar phrase (composed rotation with a little chance)
        const order: Motif[] = s.mood === 'combat' ? [MOTIF.hook, MOTIF.answer, MOTIF.hook, MOTIF.cry] : [MOTIF.hook, MOTIF.answer, MOTIF.lament, MOTIF.hook];
        s.state.phraseMotif = order[Math.floor(s.bar / 8) % order.length];
        if (this.rng.chance(0.2)) s.state.phraseMotif = this.rng.pick(order);
      }
      const c: BarCtx = { bar: s.bar, beats: s.spec.beats, bpm: s.bpm, I: this.intensity, r: this.rng, ev: [], night: this.night };
      s.spec.bar(c, s.state);
      if (this.orchLevel > 0.01) ORCH_PART[s.mood]?.(c, s.state);
      const spb = 60 / s.bpm;
      for (const e of c.ev) this.playEv(e, s, s.nextBar + e.b * spb, spb);
      s.nextBar += s.spec.beats * spb;
      s.bar++;
    }
  }

  private pick(inst: Guitar, midi: number, vel: number): InstrumentSample | null {
    const list = INSTRUMENTS[inst];
    let best: InstrumentSample | null = null;
    let bestScore = 1e9;
    const wantVel = inst === 'steel' ? (vel > 0.68 ? 3 : 2) : list[0]?.vel ?? 1;
    for (const s of list) {
      if (!this.buffers.has(s.file)) continue;
      const score = Math.abs(s.midi - midi) * 10 + (s.vel === wantVel ? 0 : 4);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private playEv(e: Ev, s: Section, when: number, spb: number, dest?: AudioNode) {
    if (e.p) return this.playPerc(e, s, when);
    if (isOrch(e.i)) return this.playOrch(e, e.i, s, when, spb);
    const smp = this.pick(e.i, e.m, e.v);
    if (!smp) return;
    const buf = this.buffers.get(smp.file)!;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = Math.pow(2, (e.m - smp.midi) / 12) * (e.det ?? 1);
    if (e.slide) {
      src.playbackRate.setValueAtTime(rate * Math.pow(2, e.slide / 12), when);
      src.playbackRate.exponentialRampToValueAtTime(rate, when + Math.min(0.12, e.d * spb * 0.5));
    } else src.playbackRate.setValueAtTime(rate, when);
    const durS = Math.max(0.05, e.d * spb);
    if (e.bend) {
      src.playbackRate.setValueAtTime(rate, when + durS * 0.45);
      src.playbackRate.exponentialRampToValueAtTime(rate * Math.pow(2, e.bend / 12), when + durS * 0.9);
    }
    const g = ctx.createGain();
    const instGain = e.i === 'piano' ? 0.9 : e.i === 'nylon' ? 1.1 : 1.0;
    const amp = Math.pow(clamp(e.v, 0, 1), 1.35) * instGain * (e.pm ? 1.3 : 1);
    const rel = e.pm ? 0.05 : e.tr ? 0.04 : e.i === 'piano' ? 0.35 : 0.25;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.004);
    g.gain.setValueAtTime(amp, when + durS);
    g.gain.exponentialRampToValueAtTime(0.0005, when + durS + rel);
    let head: AudioNode = src;
    if (e.pm) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 950;
      f.Q.value = 0.8;
      src.connect(f);
      head = f;
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(e.pan ?? 0, -1, 1);
    head.connect(g).connect(pan).connect(dest ?? (e.lead ? s.lead : s.out));
    src.start(when);
    src.stop(when + durS + rel + 0.05);
    src.onended = () => {
      try {
        pan.disconnect();
      } catch {
        /* */
      }
    };
  }

  private pickOrch(inst: OrchInst, midi: number): OrchSample | null {
    let best: OrchSample | null = null;
    let bd = 1e9;
    for (const smp of ORCH[inst]) {
      if (!this.buffers.has(smp.file)) continue;
      const d = Math.abs(smp.midi - midi) + (smp.midi < midi ? 0.1 : 0); // ties: shift down (darker, never chipmunk)
      if (d < bd) {
        bd = d;
        best = smp;
      }
    }
    return best;
  }

  /** an orchestral note: attack / swell envelope, a dynamics lowpass, endless sustain by crossfaded segments */
  private playOrch(e: Ev, inst: OrchInst, s: Section, when: number, spb: number) {
    const smp = this.pickOrch(inst, e.m);
    if (!smp) return;
    const buf = this.buffers.get(smp.file)!;
    const ctx = this.ctx;
    const P = OI[inst];
    const rate = Math.pow(2, (e.m - smp.midi) / 12);
    const durS = Math.max(0.05, e.d * spb);
    const att = e.att ?? P.att;
    const rel = e.rel ?? P.rel;
    const amp = Math.pow(clamp(e.v, 0, 1), 1.2) * P.g;
    const hold = Math.max(att + 0.02, durS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    if (e.sw !== undefined) {
      g.gain.linearRampToValueAtTime(Math.max(0.0002, amp * e.sw), when + att);
      g.gain.linearRampToValueAtTime(amp, when + Math.max(att + 0.05, durS * 0.85));
    } else g.gain.linearRampToValueAtTime(amp, when + att);
    g.gain.setValueAtTime(amp, when + hold);
    g.gain.exponentialRampToValueAtTime(0.0003, when + hold + rel);
    // a soft note is a darker note; a swell opens up as it grows
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const cut = e.lp ?? 1600 + Math.pow(clamp(e.v, 0, 1), 1.1) * 9500;
    if (e.sw !== undefined) {
      lp.frequency.setValueAtTime(cut * 0.4, when);
      lp.frequency.linearRampToValueAtTime(cut, when + Math.max(att + 0.05, durS * 0.85));
    } else lp.frequency.value = cut;
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(e.pan ?? 0, -1, 1);
    const hs = ctx.createGain();
    hs.gain.value = P.hall * s.hall;
    g.connect(lp).connect(pan).connect(s.orch);
    pan.connect(hs).connect(this.hallIn);
    const need = hold + rel + 0.05;
    const avail = smp.len / rate;
    let last: AudioBufferSourceNode | null = null;
    if (need <= avail - 0.05 || smp.ls === undefined || smp.le === undefined) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (e.slide) {
        src.playbackRate.setValueAtTime(rate * Math.pow(2, e.slide / 12), when);
        src.playbackRate.exponentialRampToValueAtTime(rate, when + Math.min(0.14, durS * 0.4));
      } else src.playbackRate.value = rate;
      src.connect(g);
      src.start(when);
      src.stop(when + Math.min(need, avail + 0.02));
      last = src;
    } else {
      // chain crossfaded segments of the sustain body (any format, no sample-exact loop points needed)
      const X = 0.35;
      let t = when;
      let off = 0;
      for (let n = 0; n < 16 && t < when + need; n++) {
        const segLen = (smp.le - off) / rate;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const sg = ctx.createGain();
        if (n === 0) sg.gain.setValueAtTime(1, t);
        else {
          sg.gain.setValueAtTime(0, t);
          sg.gain.linearRampToValueAtTime(1, t + X);
        }
        const end = t + segLen;
        sg.gain.setValueAtTime(1, end - X);
        sg.gain.linearRampToValueAtTime(0, end);
        src.connect(sg).connect(g);
        src.start(t, off);
        src.stop(end + 0.02);
        last = src;
        t = end - X;
        off = smp.ls + this.rng.next() * Math.min(0.5, (smp.le - smp.ls) * 0.25);
      }
    }
    if (last)
      last.onended = () => {
        try {
          pan.disconnect();
          hs.disconnect();
        } catch {
          /* */
        }
      };
  }

  private playPerc(e: Ev, s: Section, when: number) {
    const id = e.p!;
    const list = PERC[id];
    if (!list?.length) return;
    let k = e.k;
    if (k === undefined) {
      k = ((this.rr.get(id) ?? -1) + 1) % list.length;
      this.rr.set(id, k);
    }
    const buf = this.buffers.get(list[k % list.length]);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (e.r ?? 1) * (0.985 + this.rng.next() * 0.03);
    const g = ctx.createGain();
    g.gain.value = Math.pow(clamp(e.v, 0, 1), 1.1) * PERC_G[id];
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(e.pan ?? 0, -1, 1);
    const hs = ctx.createGain();
    const big = id === 'taiko' || id === 'timp' || id === 'timpRoll' || id === 'gong' || id === 'crash' || id === 'swell';
    hs.gain.value = (big ? 0.6 : 0.28) * s.hall;
    src.connect(g).connect(pan).connect(s.orch);
    pan.connect(hs).connect(this.hallIn);
    src.start(Math.max(when, ctx.currentTime));
    src.onended = () => {
      try {
        pan.disconnect();
        hs.disconnect();
      } catch {
        /* */
      }
    };
  }

  /** a short composed phrase on top of the current bed (ducks the bed briefly) */
  stinger(k: StingerKind) {
    if (!this.loaded) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.03;
    const bpm = k === 'ult' ? 90 : k === 'bossIntro' || k === 'dawn' || k === 'nightfall' ? 84 : 132;
    const spb = 60 / bpm;
    const c: BarCtx = { bar: 0, beats: 4, bpm, I: 1, r: this.rng, ev: [] };
    let duck = 0.55;
    let hold = 1.6;
    switch (k) {
      case 'rankup': // fast rising Phrygian-dominant arpeggio into a ringing high E, the harp and the choir under it
        [52, 56, 59, 64, 65, 68, 71, 76].forEach((m, i) => c.ev.push({ b: i * 0.25, i: 'steel', m, v: 0.7 + i * 0.03, d: 1.5, lead: true }));
        tremolo(c, 76, 2, 2, 8, 0.6, 0.85);
        strum(c, CH.E.strum, 2, 0.6, 3);
        gliss(c, 52, 14, 0, 0.13, 0.4);
        pad(c, 'choirA', [52, 56, 59, 64], 2, 4, 0.45, { att: 0.25, rel: 1.6 });
        pad(c, 'str', [40, 52, 56, 59, 64, 68, 76], 2, 4, 0.38, { att: 0.12, rel: 1.4 });
        hit(c, 'fcym', 2, 0.4);
        hit(c, 'timp', 2, 0.5);
        break;
      case 'wave': // power stab + b2 sigh resolving down, a taiko and the horns
        strum(c, CH.E.pow, 0, 0.95, 1.5);
        c.ev.push({ b: 0, i: 'steel', m: 40, v: 0.9, d: 3 });
        tremolo(c, 65, 0.5, 1.5, 8, 0.5, 0.8);
        c.ev.push({ b: 2, i: 'steel', m: 64, v: 0.8, d: 2, lead: true, slide: 1 });
        hit(c, 'taiko', 0, 0.85);
        hit(c, 'timp', 0, 0.55);
        pad(c, 'horn', [52, 53], 0, 2, 0.5, { att: 0.04, rel: 0.6 });
        pad(c, 'horn', [52, 59], 2, 2, 0.45, { att: 0.05, rel: 1 });
        break;
      case 'boss': // chromatic chug E-F-E + dissonant high F tremolo, over the drums of the gods
        [0, 0.5, 1, 1.5].forEach((b, i) => c.ev.push({ b, i: 'steel', m: i % 2 ? 41 : 40, v: 0.95, d: 0.3, pm: true }));
        strum(c, CH.F.pow, 2, 0.95, 1);
        tremolo(c, 77, 2, 2, 10, 0.6, 0.95);
        c.ev.push({ b: 2, i: 'steel', m: 40, v: 0.9, d: 4 });
        [0, 0.5, 1, 1.5].forEach((b, i) => {
          hit(c, 'taiko', b, 0.6 + i * 0.1);
          c.ev.push({ b, i: 'lowbr', m: i % 2 ? 41 : 40, v: 0.6, d: 0.4, att: 0.02, rel: 0.2 });
        });
        hit(c, 'crash', 2, 0.5);
        hit(c, 'taiko', 2, 0.9);
        pad(c, 'choirU', [52, 53], 2, 4, 0.5, { att: 0.15, rel: 1.6 });
        pad(c, 'lowbr', [40, 47], 2, 4, 0.55, { att: 0.05, rel: 1.2 });
        break;
      case 'death': // slow falling nylon line, low and dark, the dark choir and a far gong
        [64, 61, 60, 56, 53, 52, 49, 40].forEach((m, i) => c.ev.push({ b: i * 0.75, i: 'nylon', m, v: 0.55 - i * 0.03, d: 2.5 }));
        pad(c, 'choirU', [48, 52], 0, 8, 0.4, { sw: 0.2, att: 1, rel: 2.5 });
        hit(c, 'gong', 0, 0.35, 0.85);
        hold = 3;
        break;
      case 'victory':
        strum(c, CH.E.strum, 0, 0.85, 1);
        strum(c, CH.A.strum, 1, 0.8, 1);
        strum(c, CH.B7.strum, 2, 0.8, 1);
        strum(c, CH.E.strum, 3, 0.95, 4);
        tremolo(c, 80, 3, 3, 8, 0.6, 0.9);
        [0, 1, 2].forEach((b) => hit(c, 'taiko', b, 0.55 + b * 0.1));
        pad(c, 'horn', [52, 57, 61], 1, 1, 0.5, { att: 0.04, rel: 0.4 });
        pad(c, 'horn', [51, 54, 59], 2, 1, 0.5, { att: 0.04, rel: 0.4 });
        pad(c, 'str', [40, 52, 56, 59, 64, 68, 71, 76], 3, 5, 0.42, { att: 0.08, rel: 2 });
        pad(c, 'tpt', [71, 76], 3, 5, 0.5, { att: 0.05, rel: 1.5 });
        pad(c, 'choirA', [52, 56, 59], 3, 5, 0.42, { att: 0.15, rel: 2 });
        hit(c, 'crash', 3, 0.5);
        hit(c, 'timp', 3, 0.6);
        hold = 2.5;
        break;
      case 'discover': // harp-like nylon arpeggio up into a soft harmonic-ish high note
        [52, 56, 59, 64, 68, 71, 76].forEach((m, i) => c.ev.push({ b: i * 0.2, i: 'nylon', m, v: 0.5, d: 3 }));
        c.ev.push({ b: 1.6, i: 'steel', m: 76, v: 0.45, d: 3, lead: true });
        gliss(c, 64, 8, 0, 0.2, 0.3);
        hit(c, 'fcym', 1.6, 0.35);
        break;
      case 'funny': // deflating guitar 'wah wah'
        [59, 58, 57].forEach((m, i) => c.ev.push({ b: i * 0.75, i: 'steel', m, v: 0.7, d: 0.6, bend: -0.3 }));
        c.ev.push({ b: 2.25, i: 'steel', m: 56, v: 0.7, d: 2, bend: -1 });
        break;
      case 'ult': {
        // the ultimate: the hall rises (choir, tremolo strings, timpani roll, harp) under a soaring brass
        // call that lands on the summoning at beat 4 (2.7 s): taiko, gong, crash and the full E major tutti
        duck = 0.9;
        hold = 8.5;
        hit(c, 'taiko', 0, 0.9);
        hit(c, 'timp', 0, 0.7);
        pad(c, 'lowbr', [40], 0, 4, 0.45, { sw: 0.3, att: 0.3 });
        pad(c, 'str', [40, 47], 0, 4, 0.4, { sw: 0.3, att: 0.3 });
        pad(c, 'trem', [76, 80], 0, 4, 0.28, { sw: 0.1, att: 0.4 });
        pad(c, 'choirA', [52, 56, 59], 0, 4, 0.42, { sw: 0.15, att: 0.6 });
        gliss(c, 52, 14, 0.5, 0.22, 0.42);
        hit(c, 'timpRoll', 1.2, 0.55);
        swellInto(c, 4, false, 0.65);
        const call: [number, number, number][] = [[1, 64, 0.5], [1.5, 65, 0.5], [2, 68, 0.5], [2.5, 69, 1], [3.5, 71, 0.5]];
        for (const [b, m, d] of call) {
          c.ev.push({ b, i: 'tpt', m, v: 0.62, d, att: 0.03, rel: 0.25 });
          c.ev.push({ b, i: 'horn', m: m - 12, v: 0.55, d, att: 0.04, rel: 0.3 });
        }
        // the summoning
        hit(c, 'taiko', 4, 1);
        hit(c, 'taiko', 4.5, 0.75, 1.05);
        hit(c, 'crash', 4, 0.6);
        hit(c, 'gong', 4, 0.6);
        hit(c, 'timp', 4, 0.8);
        pad(c, 'str', [40, 47, 52, 56, 59, 64, 68, 71, 76], 4, 8, 0.5, { att: 0.06, rel: 2.6 });
        pad(c, 'choirA', [52, 56, 59, 64], 4, 8, 0.55, { att: 0.12, rel: 2.8 });
        pad(c, 'horn', [52, 56, 59, 64], 4, 8, 0.52, { att: 0.05, rel: 2.2 });
        pad(c, 'lowbr', [40, 47], 4, 8, 0.6, { att: 0.04, rel: 2 });
        pad(c, 'tpt', [76, 71], 4, 8, 0.6, { att: 0.04, rel: 2 });
        tremolo(c, 76, 4, 4, 8, 0.5, 0.8);
        strum(c, CH.E.strum, 4, 0.8, 6);
        [6, 7, 7.5].forEach((b, i) => hit(c, 'taiko', b, 0.6 + i * 0.1, 1 + i * 0.02));
        hit(c, 'taiko', 8, 0.95);
        hit(c, 'timp', 8, 0.7);
        hit(c, 'crash', 8, 0.4);
        break;
      }
      case 'bossIntro': // the drums announce it, low brass F falling to E under the dark choir, a gong lands it
        duck = 0.8;
        hold = 5.5;
        hit(c, 'taiko', 0, 0.9);
        hit(c, 'taiko', 0.75, 0.7, 1.04);
        hit(c, 'taiko', 1.5, 0.85);
        hit(c, 'taikoRim', 2.25, 0.4);
        pad(c, 'lowbr', [41], 0, 2, 0.55, { sw: 0.4, att: 0.2 });
        pad(c, 'lowbr', [40, 47], 2, 6, 0.6, { att: 0.1, rel: 2 });
        pad(c, 'choirU', [52, 53], 0, 6, 0.45, { sw: 0.2, att: 0.8, rel: 2 });
        pad(c, 'trem', [40, 41], 0, 6, 0.3, { sw: 0.2, att: 0.5, rel: 1.5 });
        swellInto(c, 6, false, 0.6);
        hit(c, 'crash', 6, 0.5);
        hit(c, 'gong', 6, 0.6);
        hit(c, 'taiko', 6, 1);
        hit(c, 'timp', 6, 0.8);
        pad(c, 'horn', [52, 53, 59], 6, 3, 0.55, { att: 0.04, rel: 1.8 });
        pad(c, 'str', [40, 52, 53, 64], 6, 4, 0.45, { att: 0.06, rel: 2 });
        break;
      case 'dawn': // the harp runs up into a horn call, high strings like first light
        duck = 0.4;
        hold = 3;
        gliss(c, 52, 14, 0, 0.18, 0.4);
        hit(c, 'fcym', 0, 0.35);
        c.ev.push({ b: 0.5, i: 'horn', m: 52, v: 0.5, d: 1, att: 0.08, rel: 0.5 }, { b: 1.5, i: 'horn', m: 59, v: 0.52, d: 1, att: 0.08, rel: 0.5 }, { b: 2.5, i: 'horn', m: 64, v: 0.55, d: 3, att: 0.1, rel: 1.5 });
        pad(c, 'str', [76, 80, 83], 0, 6, 0.3, { sw: 0.2, att: 1, rel: 2 });
        pad(c, 'str', [40, 47], 2.5, 4, 0.35, { att: 0.4, rel: 2 });
        hit(c, 'frame', 2.5, 0.35);
        break;
      case 'nightfall': // the dark choir swells, the ney falls through the scale, a far gong
        duck = 0.45;
        hold = 4;
        pad(c, 'choirU', [52, 53, 59], 0, 6, 0.42, { sw: 0.15, att: 1.2, rel: 2.5 });
        pad(c, 'trem', [40], 0, 8, 0.3, { sw: 0.2, att: 1, rel: 2 });
        oline(c, 'ney', [[13, 1], [12, 0.5], [8, 0.5], [7, 1], [4, 1], [1, 1], [0, 2]], 0.5, 64, 0.45, { att: 0.1, rel: 1, slide: true });
        hit(c, 'gong', 0, 0.35, 0.85);
        break;
    }
    // duck the bed under the stinger
    this.duck(duck, hold, 0.08);
    // stingers route around the duck (straight to the music bus) with their own reverb send
    const out = ctx.createGain();
    out.gain.value = 0.75;
    out.connect(this.audio.buses.music);
    const rv = ctx.createGain();
    rv.gain.value = 0.35;
    out.connect(rv).connect(this.rvbIn);
    const fake: Section = { mood: 'combat', spec: MOODS.combat, out, lead: out, orch: out, hall: 0.7, nextBar: 0, bar: 0, bpm, state: { phraseMotif: MOTIF.hook, plan: [] } };
    for (const e of c.ev) this.playEv(e, fake, t + e.b * spb, spb, out);
    setTimeout(() => {
      out.disconnect();
    }, 18000);
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = 0;
    this.setMood('off', 0.3);
  }
}
