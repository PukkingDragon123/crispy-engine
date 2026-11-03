// Character voices, synthesized at runtime. No recordings, no TTS: every line is
// formant-shaped babble that follows the text actually being spoken.
//
//   text ─► words ─► letters-to-sounds (a small English rule set) ─► syllables
//        ─► prosody (stress, declination, question rise, exclamation punch,
//           comma pauses, phrase-final creak) ─► scheduled sample-accurately on a
//           per-speaker WebAudio graph:
//
//   glottal buzz (PeriodicWave, tilt per voice) + subharmonic growl + octave shimmer
//     pitch in cents on a ConstantSource ► detune; vibrato, jitter, rasp AM, croak AM
//   ► voicing gate ─┬► parallel formant bank F1..F4 (alternating polarity) ─┐
//   aspiration ─────┘   + a low "body" path for the fundamental            ├► EQ ► comb / chorus / ring
//   frication noise ► band-pass (bursts, sibilants, clicks) ────────────────┘   ► panner ► echo / reverb
//
// Usage:
//   Voice.say('anubis', 'Bones of the West.', { pos: head, follow: true });
//   ft.update(dt, cam, (c, i, s) => Voice.syllable('serket', c, { index: i, text: s }));
//   Voice.stop();
// The voice bus is the engine's 'voice' bus; music is ducked while anyone talks.
import type { AudioEngine } from '../../engine/audio/AudioEngine';

type Vec3 = { x: number; y: number; z: number };
type Fm = [number, number, number];

// ---------------------------------------------------------------------------------------------
// voice profiles
// ---------------------------------------------------------------------------------------------
export interface VoiceProfile {
  /** speaking pitch (Hz) */
  f0: number;
  /** pitch excursion for accents and contours (semitones) */
  range: number;
  /** formant frequency scale (vocal-tract size: < 1 big, > 1 small) */
  formant: number;
  /** formant bandwidth multiplier (wider = muffled, hollow) */
  bw: number;
  /** glottal spectral tilt (higher = softer, rounder) */
  tilt: number;
  /** steady aspiration under the voice 0..1 */
  breath: number;
  /** pitch-synchronous gravel + amplitude roughness 0..1 */
  rasp: number;
  /** subharmonic (period doubling) level 0..1 */
  growl: number;
  /** random pitch wander (cents) */
  jitter: number;
  /** vibrato [rate Hz, depth cents] */
  vib: [number, number];
  /** vocal fry dropping into sentence ends 0..1 */
  creak: number;
  /** syllable rate multiplier (1 ~ 6 syllables a second) */
  speed: number;
  /** punctuation pause multiplier */
  pauseMul: number;
  /** silence between words (s) */
  wordGap: number;
  gain: number;
  /** octave-up shimmer layer level */
  octave?: number;
  /** old-age tremolo depth */
  quaver?: number;
  /** throat ratchet AM (frogs) 0..1 */
  croak?: number;
  /** burst / aspiration loudness for voiceless stops and h */
  asp?: number;
  /** sibilant loudness multiplier */
  sib?: number;
  /** consonant burst loudness multiplier */
  cons?: number;
  /** voicing level multiplier (low = mostly noise and clicks) */
  voicing?: number;
  /** dB: low shelf, presence, high shelf */
  warmth?: number;
  presence?: number;
  air?: number;
  /** nasal twang 0..1 */
  nasal?: number;
  /** reverb send 0..1 */
  reverb?: number;
  /** feedback echo [time s, feedback, mix] */
  echo?: [number, number, number];
  /** tube resonance comb [delay s, feedback, mix] */
  hollow?: [number, number, number];
  /** layered chorus [copies, depth ms, mix] */
  chorus?: [number, number, number];
  /** ring modulation [Hz, mix] */
  ring?: [number, number];
  /** insect clicks per syllable 0..1 */
  click?: number;
  /** upward chirp glide per syllable (semitones) */
  chirp?: number;
  /** wide moaning glides (semitones) */
  moan?: number;
  /** default music duck 0..1 while speaking */
  duck?: number;
  /** positional reference distance (m) */
  ref?: number;
  /** canned lines for Voice.chatter(profile, kind) */
  phrases?: Record<string, string[]>;
}

const PROFILES = {
  /** Sundown: low, dry, raspy outlaw drawl; few words, long pauses, fry at the ends */
  sundown: { f0: 88, range: 2.6, formant: 0.9, bw: 1.1, tilt: 1.15, breath: 0.16, rasp: 0.55, growl: 0.14, jitter: 16, vib: [0, 0], creak: 0.55, speed: 0.74, pauseMul: 1.5, wordGap: 0.055, gain: 1.02, warmth: 3, presence: 2, air: -3, reverb: 0.06, duck: 0.35, ref: 10 },
  /** Serket: airy, ethereal, a layered chorus with an octave shimmer and a long halo */
  serket: { f0: 228, range: 5, formant: 1.14, bw: 1.15, tilt: 1.55, breath: 0.55, rasp: 0.04, growl: 0, octave: 0.22, jitter: 6, vib: [5.2, 24], creak: 0, speed: 1.02, pauseMul: 1.1, wordGap: 0.02, gain: 0.73, warmth: -1, presence: 1, air: 5, reverb: 0.5, chorus: [3, 3.5, 0.55], duck: 0.45 },
  /** Mama Toad: warm, croaky grandma with a gentle quaver */
  mamaToad: { f0: 182, range: 6, formant: 1.04, bw: 1.2, tilt: 1.3, breath: 0.24, rasp: 0.28, growl: 0.05, jitter: 14, vib: [5.6, 28], quaver: 0.12, croak: 0.1, creak: 0.25, speed: 0.92, pauseMul: 1.2, wordGap: 0.025, gain: 0.78, warmth: 4, presence: 1, nasal: 0.15, reverb: 0.12, duck: 0.4, ref: 9 },
  /** Ozymandias: slow, deep, creaky old tortoise */
  ozymandias: { f0: 82, range: 3.2, formant: 0.82, bw: 1.25, tilt: 1.3, breath: 0.2, rasp: 0.32, growl: 0.12, jitter: 18, vib: [4.2, 16], quaver: 0.14, creak: 0.85, speed: 0.6, pauseMul: 1.6, wordGap: 0.05, gain: 0.91, warmth: 5, presence: -1, air: -4, reverb: 0.15, duck: 0.4, ref: 12 },
  /** Mother Tamsin: a quick, nasal, two-hundred-year-old haggler */
  tamsin: { f0: 205, range: 6.5, formant: 1.1, bw: 1.1, tilt: 1.25, breath: 0.2, rasp: 0.18, growl: 0, jitter: 12, vib: [6.2, 30], quaver: 0.16, creak: 0.3, speed: 1.08, pauseMul: 1, wordGap: 0.02, gain: 0.91, nasal: 0.45, presence: 3, reverb: 0.1, duck: 0.4, ref: 9 },
  /** Anubis: huge, slow, reverb-drenched bass with a subharmonic floor */
  anubis: { f0: 56, range: 2.2, formant: 0.7, bw: 1.15, tilt: 0.95, breath: 0.12, rasp: 0.2, growl: 0.4, jitter: 8, vib: [3.4, 10], creak: 0.35, speed: 0.55, pauseMul: 1.4, wordGap: 0.05, gain: 1.15, warmth: 5, presence: 2, air: -2, reverb: 0.95, echo: [0.42, 0.28, 0.25], duck: 0.6, ref: 40 },
  /** Khonsu: hollow, echoing moon voice */
  khonsu: { f0: 118, range: 3.5, formant: 0.92, bw: 1.6, tilt: 1.3, breath: 0.32, rasp: 0.1, growl: 0.08, jitter: 6, vib: [3.6, 18], creak: 0.2, speed: 0.78, pauseMul: 1.3, wordGap: 0.04, gain: 1.06, air: -2, hollow: [0.0058, 0.62, 0.7], echo: [0.31, 0.45, 0.45], reverb: 0.55, duck: 0.5, ref: 34 },
  /** Pinch: a scorpion who talks in clicks */
  pinch: { f0: 880, range: 8, formant: 1.75, bw: 2, tilt: 1.1, breath: 0.4, rasp: 0.25, growl: 0, jitter: 30, vib: [0, 0], creak: 0, speed: 1.7, pauseMul: 0.8, wordGap: 0.03, gain: 0.48, click: 1, voicing: 0.45, chirp: 3, duck: 0.2 },
  /** generic outlaw (vary with pitch / formant per speaker) */
  outlaw: { f0: 112, range: 4, formant: 0.97, bw: 1.1, tilt: 1.15, breath: 0.12, rasp: 0.3, growl: 0.06, jitter: 12, vib: [0, 0], creak: 0.3, speed: 1, pauseMul: 1.1, wordGap: 0.03, gain: 1.14, nasal: 0.15, warmth: 2, presence: 2, reverb: 0.08, ref: 12 },
  /** Cactus Pete: an old gold-panner, cracked and nasal */
  prospector: {
    f0: 140, range: 6, formant: 0.98, bw: 1.2, tilt: 1.2, breath: 0.22, rasp: 0.35, growl: 0, jitter: 22, vib: [6.5, 20], quaver: 0.18, creak: 0.4, speed: 1.08, pauseMul: 1, wordGap: 0.02, gain: 0.94, nasal: 0.35, ref: 12,
    phrases: {
      hail: ['Hey! Over here, friend!', 'Hoo-ee! A rider!', 'Yoo-hoo! Got a minute?'],
      ask: ['Find them parts yet?', 'Still need my bits, friend.', 'Wheel, grease and rope. Easy as pie.'],
      thanks: ['Hot dang! She rolls!', 'Yee-haw! Much obliged!', 'Well, I never! Thank you kindly!'],
    },
  },
  /** Doc Hapi: a fast-talking snake-oil peddler */
  peddler: { f0: 128, range: 6.5, formant: 1.02, bw: 1.05, tilt: 1.1, breath: 0.1, rasp: 0.12, growl: 0, jitter: 10, vib: [5.5, 12], creak: 0.15, speed: 1.22, pauseMul: 0.85, wordGap: 0.015, gain: 0.75, nasal: 0.55, presence: 3, ref: 12 },
  /** husk groan: a wordless dead moan */
  husk: { f0: 72, range: 7, formant: 0.82, bw: 1.4, tilt: 1.35, breath: 0.45, rasp: 0.75, growl: 0.35, jitter: 40, vib: [2.5, 30], creak: 0.7, speed: 0.42, pauseMul: 1.4, wordGap: 0.1, gain: 0.84, moan: 5, reverb: 0.15, ref: 8, phrases: { groan: ['Uhhh... ohhh...', 'Hhuuuurrgh...', 'Mmmuhhh...', 'Ohhhh... uhh.'] } },
  /** meerkat squeak: bright chirpy chatter */
  meerkat: {
    f0: 640, range: 7, formant: 1.5, bw: 1.6, tilt: 1.2, breath: 0.12, rasp: 0.05, growl: 0, jitter: 20, vib: [9, 30], creak: 0, speed: 1.65, pauseMul: 0.7, wordGap: 0.025, gain: 0.29, chirp: 4, duck: 0.25, ref: 8,
    phrases: {
      greet: ['Hallo hallo! Swap swap?', 'Ooh! Customer!', 'Welcome, welcome! Look look!'],
      deal: ['Deal! Deal!', 'Yes yes yes!', 'Ha! Lovely lovely!'],
      nope: ['Nope nope.', 'Hmm. No.', 'Tsk tsk.'],
      bye: ['Bye bye!', 'Come back soon!', 'Ta-ta, bones!'],
      alarm: ['Eek! Down down!', 'Hide! Hide!'],
    },
  },
  /** frog croak: ratcheting throat, gulpy vowels */
  frog: {
    f0: 150, range: 5, formant: 0.88, bw: 1.3, tilt: 1.15, breath: 0.15, rasp: 0.45, growl: 0.2, croak: 0.75, jitter: 15, vib: [0, 0], creak: 0.5, speed: 0.85, pauseMul: 1, wordGap: 0.04, gain: 0.31, nasal: 0.3, duck: 0.3, ref: 10,
    phrases: {
      wail: ['Mrrp? Mrrrooo...', 'Brrp... brrp?', 'Rrrooo?', 'Mrrroo... rrp?'],
      joy: ['Rrribbit!', 'Brrup brrup!', 'Mrrp! Mrrp!'],
      hum: ['Mmm... mmm...', 'Hmm hmm hmm.'],
    },
  },
  /** Sethos: menacing, gravelly, close */
  sethos: { f0: 98, range: 4, formant: 0.9, bw: 1.1, tilt: 1.05, breath: 0.15, rasp: 0.38, growl: 0.25, jitter: 10, vib: [0, 0], creak: 0.4, speed: 0.86, pauseMul: 1.2, wordGap: 0.03, gain: 1.27, presence: 3, reverb: 0.3, duck: 0.45, ref: 30 },
  /** the Avatar of Set: colossal, ring-modulated, storming */
  setAvatar: { f0: 66, range: 3.5, formant: 0.76, bw: 1.2, tilt: 0.95, breath: 0.15, rasp: 0.45, growl: 0.5, jitter: 12, vib: [0, 0], creak: 0.5, speed: 0.7, pauseMul: 1.3, wordGap: 0.04, gain: 1.48, ring: [52, 0.25], echo: [0.25, 0.3, 0.25], reverb: 0.6, duck: 0.55, ref: 40 },
  /** Pharaoh Nekh-Amun: dry, dusty, regal, from inside a sarcophagus */
  pharaoh: { f0: 104, range: 4.5, formant: 0.92, bw: 1.3, tilt: 1.25, breath: 0.42, rasp: 0.48, growl: 0.1, jitter: 20, vib: [4.5, 14], creak: 0.6, speed: 0.8, pauseMul: 1.3, wordGap: 0.04, gain: 1.34, hollow: [0.0042, 0.45, 0.4], reverb: 0.4, duck: 0.45, ref: 30 },
  /** The Ironclad: a fireman turned locomotive, metallic and steaming */
  ironclad: { f0: 94, range: 4, formant: 0.96, bw: 1.2, tilt: 1.0, breath: 0.32, rasp: 0.32, growl: 0.15, jitter: 8, vib: [0, 0], creak: 0.3, speed: 0.92, pauseMul: 1.1, wordGap: 0.03, gain: 1.64, ring: [88, 0.45], hollow: [0.0031, 0.5, 0.35], presence: 4, reverb: 0.2, duck: 0.45, ref: 34 },
  /** Big Bertha: a shrill, chittering brood mother */
  broodmother: { f0: 196, range: 7, formant: 1.12, bw: 1.2, tilt: 1.15, breath: 0.2, rasp: 0.38, growl: 0, jitter: 18, vib: [6, 25], creak: 0.3, speed: 1.12, pauseMul: 1, wordGap: 0.02, gain: 0.85, click: 0.45, nasal: 0.3, reverb: 0.15, duck: 0.45, ref: 30 },
  /** Old Thornback: a hissing old lizard */
  thornback: { f0: 106, range: 5, formant: 0.9, bw: 1.2, tilt: 1.2, breath: 0.35, rasp: 0.45, growl: 0.12, jitter: 16, vib: [0, 0], creak: 0.5, speed: 0.84, pauseMul: 1.2, wordGap: 0.03, gain: 0.89, sib: 2.2, reverb: 0.15, duck: 0.45, ref: 30 },
} satisfies Record<string, VoiceProfile>;

export type VoiceId = keyof typeof PROFILES;
export const VOICES: Record<VoiceId, VoiceProfile> = PROFILES;

/** the voice a named speaker (boss, NPC) talks with */
export function voiceFor(name: string): VoiceId {
  const n = name.toLowerCase();
  if (n.includes('khonsu')) return 'khonsu';
  if (n.includes('avatar of set')) return 'setAvatar';
  if (n.includes('sethos')) return 'sethos';
  if (n.includes('pharaoh') || n.includes('nekh')) return 'pharaoh';
  if (n.includes('ironclad')) return 'ironclad';
  if (n.includes('bertha')) return 'broodmother';
  if (n.includes('thornback')) return 'thornback';
  if (n.includes('anubis')) return 'anubis';
  if (n.includes('serket')) return 'serket';
  if (n.includes('ozymandias')) return 'ozymandias';
  if (n.includes('tamsin')) return 'tamsin';
  if (n.includes('pete')) return 'prospector';
  if (n.includes('hapi')) return 'peddler';
  return 'outlaw';
}

export interface SayOpts {
  /** world position of the speaker (positional audio) */
  pos?: Vec3;
  /** keep reading `pos` while the line plays (a moving speaker) */
  follow?: boolean;
  /** positional reference distance (m) */
  ref?: number;
  volume?: number;
  /** pitch / formant / speed multipliers on the profile (one profile, many speakers) */
  pitch?: number;
  formant?: number;
  speed?: number;
  /** expressiveness: scales the pitch range */
  expr?: number;
  /** pace the words to a typewriter showing this many characters a second */
  cps?: number;
  /** seconds before it starts */
  delay?: number;
  /** music duck 0..1 (defaults per profile) */
  duck?: number;
  /** sing: one melody note (semitones from the voice's pitch) per syllable, cycled */
  sing?: number[];
  /** channel name; a new line on the same channel cuts the old one (default: the profile id) */
  key?: string;
}

export interface SyllableOpts {
  /** index of `char` in the whole line, and the line (lets the voice plan the sentence) */
  index?: number;
  text?: string;
  pos?: Vec3;
  ref?: number;
  volume?: number;
  pitch?: number;
  formant?: number;
  expr?: number;
  /** typewriter speed hint (it is also measured from the call rate) */
  cps?: number;
  duck?: number;
  key?: string;
}

export interface Speech {
  /** AudioContext time the line ends */
  end: number;
  duration: number;
  stop(fade?: number): void;
}

// ---------------------------------------------------------------------------------------------
// phonetics
// ---------------------------------------------------------------------------------------------
// vowel formants (adult male reference, Hz), scaled per voice
const VOW: Record<string, Fm> = {
  I: [270, 2290, 3010],
  IH: [390, 1990, 2550],
  E: [530, 1840, 2480],
  AE: [660, 1720, 2410],
  A: [730, 1090, 2440],
  O: [570, 840, 2410],
  OH: [470, 920, 2380],
  U: [300, 870, 2240],
  UU: [440, 1020, 2240],
  UH: [640, 1190, 2390],
  ER: [490, 1350, 1690],
  AX: [500, 1400, 2450],
};
const DIPH: Record<string, [string, string]> = { AI: ['A', 'IH'], EI: ['E', 'IH'], OI: ['O', 'IH'], AU: ['A', 'UU'], OU: ['OH', 'UU'] };

type CKind = 'stop' | 'fric' | 'aff' | 'nasal' | 'approx' | 'asp';
interface Cons {
  k: CKind;
  v: boolean;
  /** noise centre (Hz), Q, level */
  nf?: number;
  nq?: number;
  na?: number;
  /** duration (s) */
  d: number;
  /** F2 locus (Hz) the formants bend toward */
  loc: number;
  /** own formants (nasals, approximants) */
  fm?: Fm;
}
const CON: Record<string, Cons> = {
  P: { k: 'stop', v: false, nf: 900, nq: 0.9, na: 0.55, d: 0.075, loc: 800 },
  B: { k: 'stop', v: true, nf: 800, nq: 0.9, na: 0.35, d: 0.06, loc: 800 },
  T: { k: 'stop', v: false, nf: 4300, nq: 1.3, na: 0.6, d: 0.07, loc: 1800 },
  D: { k: 'stop', v: true, nf: 3900, nq: 1.3, na: 0.4, d: 0.055, loc: 1700 },
  K: { k: 'stop', v: false, nf: 2300, nq: 2.2, na: 0.6, d: 0.075, loc: 2100 },
  G: { k: 'stop', v: true, nf: 2100, nq: 2.2, na: 0.4, d: 0.06, loc: 2000 },
  F: { k: 'fric', v: false, nf: 5500, nq: 0.45, na: 0.16, d: 0.085, loc: 900 },
  V: { k: 'fric', v: true, nf: 4800, nq: 0.45, na: 0.1, d: 0.06, loc: 900 },
  TH: { k: 'fric', v: false, nf: 6200, nq: 0.4, na: 0.12, d: 0.08, loc: 1500 },
  DH: { k: 'fric', v: true, nf: 5000, nq: 0.4, na: 0.07, d: 0.045, loc: 1500 },
  S: { k: 'fric', v: false, nf: 6600, nq: 2.6, na: 0.42, d: 0.095, loc: 1700 },
  Z: { k: 'fric', v: true, nf: 6000, nq: 2.6, na: 0.26, d: 0.07, loc: 1700 },
  SH: { k: 'fric', v: false, nf: 3100, nq: 2.2, na: 0.5, d: 0.095, loc: 2000 },
  ZH: { k: 'fric', v: true, nf: 2900, nq: 2.2, na: 0.3, d: 0.07, loc: 2000 },
  H: { k: 'asp', v: false, na: 0.5, d: 0.065, loc: 0 },
  CH: { k: 'aff', v: false, nf: 3200, nq: 2.2, na: 0.5, d: 0.1, loc: 2000 },
  J: { k: 'aff', v: true, nf: 3000, nq: 2.2, na: 0.32, d: 0.085, loc: 2000 },
  M: { k: 'nasal', v: true, d: 0.065, loc: 900, fm: [280, 1000, 2200] },
  N: { k: 'nasal', v: true, d: 0.06, loc: 1700, fm: [280, 1550, 2500] },
  NG: { k: 'nasal', v: true, d: 0.065, loc: 2200, fm: [280, 2000, 2600] },
  L: { k: 'approx', v: true, d: 0.055, loc: 1100, fm: [360, 1050, 2900] },
  R: { k: 'approx', v: true, d: 0.055, loc: 1250, fm: [420, 1250, 1650] },
  W: { k: 'approx', v: true, d: 0.05, loc: 700, fm: [300, 650, 2200] },
  Y: { k: 'approx', v: true, d: 0.045, loc: 2200, fm: [280, 2250, 2950] },
};
const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'J']);

// words the rules would get wrong (and the cast's names)
const LEX: Record<string, string> = {
  the: 'DH AX', a: 'AX', an: 'AE N', i: 'AI', im: 'AI M', ill: 'AI L', ive: 'AI V', id: 'AI D',
  you: 'Y U', your: 'Y O R', youre: 'Y O R', yours: 'Y O R Z', to: 'T U', too: 'T U', two: 'T U', do: 'D U', does: 'D UH Z', who: 'H U', whose: 'H U Z',
  of: 'AX V', is: 'IH Z', was: 'W UH Z', are: 'A R', were: 'W ER', be: 'B I', me: 'M I', he: 'H I', we: 'W I', she: 'SH I',
  one: 'W UH N', once: 'W UH N S', done: 'D UH N', come: 'K UH M', some: 'S UH M', none: 'N UH N', love: 'L UH V', above: 'AX B UH V',
  have: 'H AE V', give: 'G IH V', live: 'L IH V', gone: 'G O N', there: 'DH E R', where: 'W E R', their: 'DH E R', theyre: 'DH E R',
  they: 'DH EI', hey: 'H EI', could: 'K UU D', would: 'W UU D', should: 'SH UU D', said: 'S E D', says: 'S E Z',
  any: 'E N I', many: 'M E N I', eye: 'AI', eyes: 'AI Z', oh: 'OU', ah: 'A', ha: 'H A', huh: 'H UH', uh: 'UH', hm: 'MM', hmm: 'MM', mm: 'MM', mmm: 'MM',
  hrrm: 'H RR M', theres: 'DH E R Z', heres: 'H I R Z', wheres: 'W E R Z', what: 'W UH T', put: 'P UU T', pull: 'P UU L', push: 'P UU SH', full: 'F UU L', son: 'S UH N', other: 'UH DH ER',
  mother: 'M UH DH ER', brother: 'B R UH DH ER', nothing: 'N UH TH IH NG', been: 'B IH N', again: 'AX G E N', people: 'P I P AX L',
  friend: 'F R E N D', friends: 'F R E N D Z', dear: 'D I R', dearie: 'D I R I', here: 'H I R', sure: 'SH UU R', sugar: 'SH UU G ER',
  heart: 'H A R T', ready: 'R E D I', dead: 'D E D', head: 'H E D', bread: 'B R E D', great: 'G R EI T', break: 'B R EI K',
  though: 'DH OU', through: 'TH R U', thought: 'TH O T', laugh: 'L AE F', every: 'E V R I', dont: 'D OU N T', wont: 'W OU N T',
  honey: 'H UH N I', money: 'M UH N I', cookie: 'K UU K I', cookies: 'K UU K I Z', pharaoh: 'F E R OU', anubis: 'AX N U B IH S',
  serket: 'S ER K E T', sethos: 'S E TH OH S', khonsu: 'K O N S U', ozymandias: 'O Z IH M AE N D I AX S', gobi: 'G OU B I',
  ammit: 'AE M IH T', maat: 'M AX A T', duat: 'D U A T', tamsin: 'T AE M Z IH N', hapi: 'H A P I', amun: 'A M U N',
  reckon: 'R E K AX N', together: 'T AX G E DH ER', forget: 'F ER G E T', get: 'G E T', desert: 'D E Z ER T', kettle: 'K E T AX L', little: 'L IH T AX L', bones: 'B OU N Z', bone: 'B OU N', rain: 'R EI N', shine: 'SH AI N',
  click: 'K L IH K', eek: 'I K', tsk: 'T S K', shh: 'SH', ribbit: 'R IH B IH T', rrribbit: 'RR IH B IH T', brrp: 'B RR P', brrup: 'B RR UH P',
  mrrp: 'M RR P', mrrroo: 'M RR U', rrrooo: 'RR U', rrroo: 'RR U', mrrrooo: 'M RR U', hhuuuurrgh: 'H U RR G', uhhh: 'UH', ohhh: 'OU', mmmuhhh: 'M UH', uhh: 'UH',
  hoo: 'H U', ee: 'I', yee: 'Y I', haw: 'H O', yoo: 'Y U', ta: 'T A', dang: 'D AE NG', ooh: 'U', hallo: 'H AX L OU',
};
// unstressed function words
const FUNC = new Set(
  'a an the and or but of to in on at by for from with as is am are was were be been it its this that these those i me my we us our you your he him his she her they them their do does did so if then than will would shall should can could may might must have has had just like up out into over off some any each very too also only im ive id ill youre theyre its lets em'.split(' '),
);
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  if (n < 1e6) return numWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return String(n)
    .split('')
    .map((d) => ONES[+d])
    .join(' ');
}

const isVowelTok = (x?: string) => !!x && (x.length === 1 && x === x.toLowerCase() ? 'aeiouy'.includes(x) : x in VOW || x in DIPH);
const VOICED = new Set(['B', 'D', 'G', 'V', 'DH', 'Z', 'ZH', 'J', 'M', 'N', 'NG', 'L', 'R', 'W', 'Y', 'b', 'd', 'g', 'v', 'z', 'j', 'm', 'n', 'l', 'r', 'w']);

/** letters to sounds: a compact English rule set (good enough to shape babble by the text) */
function g2p(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  const lx = LEX[w];
  if (lx !== undefined) return lx ? lx.split(' ') : [];
  let s = w;
  const R = (re: RegExp, to: string | ((...a: string[]) => string)) => (s = s.replace(re, to as any));
  R(/^gh/, '{G}');
  R(/^kn/, '{N}');
  R(/^wr/, '{R}');
  R(/^wh/, '{W}');
  R(/^ps/, '{S}');
  R(/mb$/, '{M}');
  R(/tion/g, '{SH}{AX}{N}');
  R(/sion/g, '{ZH}{AX}{N}');
  R(/ture/g, '{CH}{ER}');
  R(/[ct]ious/g, '{SH}{AX}{S}');
  R(/([^aeiou])ion/g, '$1{Y}{AX}{N}');
  R(/igh/g, '{AI}');
  R(/ough|augh/g, '{O}');
  R(/eau/g, '{OU}');
  R(/tch/g, '{CH}');
  R(/dge/g, '{J}');
  R(/qu/g, '{K}{W}');
  R(/ck/g, '{K}');
  R(/ph/g, '{F}');
  R(/sh/g, '{SH}');
  R(/ch/g, '{CH}');
  R(/th/g, '{TH}');
  R(/ng(?![aeiouy])/g, '{NG}');
  R(/gh/g, '');
  // vowel digraphs
  R(/ee|ea/g, '{I}');
  R(/oo/g, '{U}');
  R(/oa/g, '{OU}');
  R(/oi|oy/g, '{OI}');
  R(/ai|ay/g, '{EI}');
  R(/au|aw/g, '{O}');
  R(/ew|ue|ui|eu/g, '{U}');
  R(/ou/g, '{AU}');
  R(/ow$/, w.length <= 3 && /^[hnc]/.test(w) ? '{AU}' : '{OU}');
  R(/ow/g, '{AU}');
  R(/ey$/, w.length > 4 ? '{I}' : '{EI}');
  R(/ei/g, '{EI}');
  R(/ie$/, w.length <= 3 ? '{AI}' : '{I}');
  if (w.length <= 6) R(/ie(?=[ds]$)/, '{AI}');
  R(/ie/g, '{I}');
  // magic e: a single vowel, one consonant, e, end (or -es / -ed)
  const LONG: Record<string, string> = { a: '{EI}', i: '{AI}', o: '{OU}', u: '{U}', e: '{I}' };
  R(/(?<![aeiou])([aioue])([bcdfgklmnprstvz])e(?=s?$|d$)/g, (_m, v, c) => LONG[v] + (c === 'c' ? '{S}' : c === 'g' ? '{J}' : c));
  // r-coloured vowels
  R(/([aeiouy])r(?![aeiouy])/g, (_m, v) => (v === 'a' ? '{A}{R}' : v === 'o' ? '{O}{R}' : '{ER}'));
  // endings
  R(/([bcdfgkpstvz])le$/, '$1{AX}{L}');
  R(/([td])ed$/, '$1{IH}{D}');
  R(/([pkfsx]|\{SH\}|\{CH\}|\{K\})ed$/, '$1{T}');
  R(/ed$/, '{D}');
  R(/([sxz]|\{SH\}|\{CH\}|\{J\})es$/, '$1{IH}{Z}');
  if (/e$/.test(s) && s.length > 2 && /[aeiouy]|\{(?:[AEIOU][A-Z]?|ER|AX)\}/.test(s.slice(0, -1))) s = s.slice(0, -1);
  // tokens
  const toks: string[] = [];
  for (let i = 0; i < s.length; ) {
    if (s[i] === '{') {
      const j = s.indexOf('}', i);
      toks.push(s.slice(i + 1, j));
      i = j + 1;
    } else toks.push(s[i++]);
  }
  const out: string[] = [];
  let vowelsSeen = 0;
  const MAP: Record<string, string> = { b: 'B', d: 'D', f: 'F', j: 'J', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', r: 'R', t: 'T', v: 'V', z: 'Z', q: 'K' };
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i];
    if (x !== x.toLowerCase()) {
      out.push(x);
      if (isVowelTok(x)) vowelsSeen++;
      continue;
    }
    const prev = toks[i - 1], next = toks[i + 1], last = i === toks.length - 1;
    if (x === next && !'aeiou'.includes(x)) continue; // doubled consonant
    switch (x) {
      case 'a':
        out.push(last ? 'AX' : next === 'l' && (toks[i + 2] === 'l' || toks[i + 2] === 'k') ? 'O' : prev === 'w' ? 'O' : 'AE');
        break;
      case 'e':
        out.push(last ? 'I' : 'E');
        break;
      case 'i':
        out.push(last ? 'I' : 'IH');
        break;
      case 'o':
        out.push(last ? 'OU' : 'O');
        break;
      case 'u':
        out.push(last ? 'U' : 'UH');
        break;
      case 'y':
        if (i === 0 || isVowelTok(next)) out.push('Y');
        else out.push(last ? (vowelsSeen === 0 ? 'AI' : 'I') : 'IH');
        break;
      case 'c':
        out.push(next && 'eiy'.includes(next) ? 'S' : 'K');
        break;
      case 'g':
        out.push(next && 'eiy'.includes(next) && i > 0 ? 'J' : 'G');
        break;
      case 's':
        out.push((isVowelTok(prev) && isVowelTok(next)) || (last && i > 0 && (VOICED.has(prev) || isVowelTok(prev))) ? 'Z' : 'S');
        break;
      case 'x':
        if (i === 0) out.push('Z');
        else out.push('K', 'S');
        break;
      case 'h':
        if (isVowelTok(next)) out.push('H');
        break;
      case 'w':
        if (i === 0 || isVowelTok(next)) out.push('W');
        break;
      default:
        if (MAP[x]) out.push(MAP[x]);
    }
    if (isVowelTok(x)) vowelsSeen++;
  }
  if (out[0] === 'TH' && DH_WORDS.has(w)) out[0] = 'DH';
  return out;
}
const DH_WORDS = new Set('this that these those them then than thus thee thy thine theirs themselves thats therell theyll theyve thence'.split(' '));

interface SylShape {
  on: string[];
  nu: string[];
  co: string[];
  stress: number;
}
const NASALS = ['M', 'N', 'NG'];
function syllabify(ph: string[]): SylShape[] {
  const isNuc = (p: string) => p in VOW || p in DIPH || p === 'MM' || p === 'RR';
  const nuc: number[] = [];
  ph.forEach((p, i) => isNuc(p) && nuc.push(i));
  if (!nuc.length) {
    if (!ph.length) return [];
    // a vowelless word: hum through nasals, trill through r, else a consonant puff
    if (ph.some((p) => NASALS.includes(p))) return [{ on: ph.filter((p) => !NASALS.includes(p)).slice(0, 2), nu: ['MM'], co: [], stress: 0 }];
    const r = ph.indexOf('R');
    if (r >= 0) return [{ on: ph.slice(0, r), nu: ['RR'], co: ph.slice(r + 1).filter((p) => p !== 'R'), stress: 0 }];
    return [{ on: ph.slice(0, 3), nu: [], co: [], stress: 0 }];
  }
  const out: SylShape[] = [];
  let start = 0;
  for (let n = 0; n < nuc.length; n++) {
    const v = nuc[n], nv = nuc[n + 1];
    const on = ph.slice(start, v).slice(-3);
    let co: string[];
    if (nv === undefined) co = ph.slice(v + 1);
    else {
      const mid = ph.slice(v + 1, nv);
      const split = mid.length <= 1 ? 0 : 1;
      co = mid.slice(0, split);
      start = v + 1 + split;
    }
    out.push({ on, nu: [ph[v]], co: co.slice(0, 3), stress: 0 });
  }
  return out;
}
const PREFIX = /^(a[^aeiou][aeiouy]|be[^aeiou]|re[^aeiou]|for[^aeiou]|mis|dis)/;

// ---------------------------------------------------------------------------------------------
// prosody plan
// ---------------------------------------------------------------------------------------------
interface PSyl {
  on: string[];
  nu: string[];
  co: string[];
  /** natural duration (s) */
  dur: number;
  /** pitch at start / end (semitones from the voice's pitch) */
  p0: number;
  p1: number;
  amp: number;
  stress: number;
  /** 0 mid-phrase, 1 phrase end, 2 sentence end */
  final: number;
  creak: number;
  /** blend toward schwa 0..1 */
  reduce: number;
  shout: boolean;
  sung: boolean;
  /** silence after (s); > 0 releases the voice */
  gap: number;
}
interface PWord {
  /** character index of the word in the source text */
  ci: number;
  syl: PSyl[];
  gap: number;
}
interface RawWord {
  s: string;
  ci: number;
  caps: boolean;
  punct: string;
}

const PAUSE: Record<string, number> = { ',': 0.2, ';': 0.26, ':': 0.24, '—': 0.24, '.': 0.42, '!': 0.4, '?': 0.46, '…': 0.62 };
const PUNCT_RANK = ['', ',', ':', ';', '—', '.', '!', '…', '?'];
const SENT_END = new Set(['.', '!', '?', '…']);
const SYL = 0.165;

function tokenize(text: string): RawWord[] {
  const out: RawWord[] = [];
  const re = /([A-Za-z0-9][A-Za-z0-9'’]*)|(\.\.\.|…|[.!?,;:—–()-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      const raw = m[1];
      if (/^\d+$/.test(raw)) {
        for (const nw of numWords(Math.min(+raw, 999999)).split(' ')) out.push({ s: nw, ci: m.index, caps: false, punct: '' });
        continue;
      }
      const letters = raw.replace(/[^A-Za-z]/g, '');
      out.push({ s: raw, ci: m.index, caps: letters.length >= 2 && letters === letters.toUpperCase(), punct: '' });
    } else if (out.length) {
      let p = m[2];
      if (p === '...' || p === '…') p = '…';
      else if (p === '—' || p === '–') p = '—';
      else if (p === '-') p = text[m.index - 1] === ' ' || text[m.index + 1] === ' ' ? '—' : '';
      else if (p === '(' || p === ')') p = ',';
      const lw = out[out.length - 1];
      if (PUNCT_RANK.indexOf(p) > PUNCT_RANK.indexOf(lw.punct)) lw.punct = p;
    }
  }
  return out;
}

function makePlan(P: VoiceProfile, text: string, o: { expr?: number; speed?: number; sing?: number[] } = {}): PWord[] {
  const raw = tokenize(text);
  const words: PWord[] = [];
  const R = P.range * (o.expr ?? 1);
  const spd = P.speed * (o.speed ?? 1);
  const sing = o.sing && o.sing.length ? o.sing : null;
  let sungIdx = 0;
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length - 1 && !SENT_END.has(raw[j].punct)) j++;
    const sent = raw.slice(i, j + 1);
    i = j + 1;
    const type = sent[sent.length - 1].punct;
    const shout = sent.filter((w) => w.caps).length >= Math.max(1, sent.length * 0.5);
    const shaped = sent.map((w) => {
      const lw = w.s.toLowerCase().replace(/[^a-z]/g, '');
      const syl = syllabify(g2p(w.s));
      const func = FUNC.has(lw);
      if (!func && syl.length) syl[syl.length > 1 && PREFIX.test(lw) && lw.length >= 5 ? 1 : 0].stress = 1;
      return { w, syl, func };
    });
    // the nuclear accent: the last content word
    let nucW = -1;
    for (let k = shaped.length - 1; k >= 0; k--)
      if (shaped[k].syl.length && (!shaped[k].func || nucW < 0)) {
        nucW = k;
        if (!shaped[k].func) break;
      }
    if (nucW >= 0) {
      const sy = shaped[nucW].syl;
      const si = Math.max(0, sy.findIndex((x) => x.stress > 0));
      sy[si].stress = 2;
    }
    const n = shaped.reduce((a, x) => a + x.syl.length, 0);
    let k = 0;
    let lastWithSyl = -1;
    shaped.forEach((x, wi) => x.syl.length && (lastWithSyl = wi));
    shaped.forEach(({ w, syl, func }, wi) => {
      const pw: PWord = { ci: w.ci, syl: [], gap: 0 };
      syl.forEach((s, si) => {
        const x = n > 1 ? k / (n - 1) : 0;
        const lastInWord = si === syl.length - 1;
        const lastInSent = wi === lastWithSyl && lastInWord;
        const phraseEnd = lastInWord && (w.punct === ',' || w.punct === ';' || w.punct === ':' || w.punct === '—');
        const st = s.stress;
        let base = -0.35 * R * x;
        if (type === '!') base += 0.3 * R;
        if (shout || w.caps) base += 0.35 * R;
        const acc = st === 2 ? 0.8 * R : st === 1 ? 0.45 * R : -0.08 * R;
        const hum = (Math.random() - 0.5) * 0.3 * R;
        let p0 = base + acc + hum + (st ? 0.12 * R : 0);
        let p1 = base + acc * 0.55 + hum;
        let final = 0;
        if (phraseEnd) {
          p1 = p0 + 0.3 * R;
          final = 1;
        }
        if (lastInSent) {
          final = 2;
          if (type === '?') {
            p0 = base + 0.05 * R;
            p1 = base + 1.1 * R;
          } else if (type === '!') {
            p0 = base + acc + 0.25 * R;
            p1 = p0 - R;
          } else if (type === '…') p1 = p0 - 0.7 * R;
          else {
            p0 = base + acc * 0.7 + hum;
            p1 = -0.95 * R;
          }
        }
        if (P.chirp) {
          p0 -= P.chirp * 0.35;
          p1 += P.chirp;
        }
        if (P.moan) {
          const m = (Math.random() < 0.5 ? -1 : 1) * P.moan * 0.5;
          p0 -= m;
          p1 += m;
        }
        if (sing) p0 = p1 = sing[sungIdx++ % sing.length];
        let dur = SYL * (st === 2 ? 1.32 : st === 1 ? 1.16 : 0.8) * (final === 2 ? 1.45 : final === 1 ? 1.18 : 1);
        dur *= (syl.length === 1 && !func ? 1.1 : 1) * (1 + 0.05 * (s.on.length + s.co.length)) * (shout ? 1.06 : 1);
        dur /= spd;
        if (sing) dur *= 1.7;
        const amp = (st === 2 ? 1.06 : st === 1 ? 1 : 0.76) * (1 - 0.16 * x) * (type === '!' ? 1.15 : 1) * (shout || w.caps ? 1.25 : 1) * (type === '…' && lastInSent ? 0.8 : 1);
        let gap = 0;
        if (lastInWord) {
          gap = (w.punct ? (PAUSE[w.punct] ?? 0) * P.pauseMul : P.wordGap) / (o.speed ?? 1);
          if (sing) gap = Math.min(gap, 0.12);
        }
        pw.syl.push({
          on: s.on, nu: s.nu, co: s.co, dur, p0, p1, amp, stress: st, final,
          creak: sing ? 0 : final === 2 ? P.creak : final === 1 ? P.creak * 0.35 : 0,
          reduce: st === 0 && syl.length > 1 ? 0.5 : st === 0 && func ? 0.3 : 0,
          shout: shout || w.caps, sung: !!sing, gap,
        });
        k++;
      });
      if (pw.syl.length) {
        pw.gap = pw.syl[pw.syl.length - 1].gap;
        words.push(pw);
      } else if (words.length && w.punct) {
        // a silent token still carries its pause
        const lw = words[words.length - 1];
        const ls = lw.syl[lw.syl.length - 1];
        ls.gap = Math.max(ls.gap, (PAUSE[w.punct] ?? 0) * P.pauseMul);
        lw.gap = ls.gap;
      }
    });
  }
  return words;
}

// ---------------------------------------------------------------------------------------------
// shared per-AudioContext resources
// ---------------------------------------------------------------------------------------------
class Bank {
  noise: AudioBuffer;
  wobble: AudioBuffer;
  rough: AudioBuffer;
  rvIn: GainNode;
  private waves = new Map<string, PeriodicWave>();
  constructor(public ac: BaseAudioContext, public out: AudioNode) {
    const sr = ac.sampleRate;
    const n = Math.floor(sr * 2);
    this.noise = ac.createBuffer(1, n, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.wobble = smoothNoise(ac, 4, 11);
    this.rough = smoothNoise(ac, 2, 95);
    const cv = ac.createConvolver();
    cv.buffer = impulse(ac, 3.6, 2.6);
    this.rvIn = ac.createGain();
    const ret = ac.createGain();
    ret.gain.value = 0.55;
    this.rvIn.connect(cv).connect(ret).connect(out);
  }
  /** glottal pulse spectrum: k^-tilt with a little second-harmonic hump */
  wave(tilt: number) {
    const key = tilt.toFixed(2);
    let w = this.waves.get(key);
    if (!w) {
      const N = 72;
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++) im[k] = -Math.pow(k, -tilt) * (1 + 0.35 * Math.exp(-((k - 2) ** 2) / 1.5));
      w = this.ac.createPeriodicWave(re, im);
      this.waves.set(key, w);
    }
    return w;
  }
}
/** loopable smooth random signal in [-1, 1] (cosine-interpolated control points) */
function smoothNoise(ac: BaseAudioContext, seconds: number, rate: number) {
  const sr = ac.sampleRate;
  const step = Math.max(2, Math.floor(sr / rate));
  const M = Math.max(4, Math.round(seconds * rate));
  const pts = Array.from({ length: M }, () => Math.random() * 2 - 1);
  pts.push(pts[0]);
  const b = ac.createBuffer(1, M * step, sr);
  const d = b.getChannelData(0);
  for (let m = 0; m < M; m++)
    for (let i = 0; i < step; i++) {
      const f = 0.5 - 0.5 * Math.cos((Math.PI * i) / step);
      d[m * step + i] = pts[m] + (pts[m + 1] - pts[m]) * f;
    }
  return b;
}
/** a dark stone hall: pre-delay, a few early slaps, a darkening diffuse tail */
function impulse(ac: BaseAudioContext, sec: number, decay: number) {
  const sr = ac.sampleRate, n = Math.floor(sr * sec);
  const b = ac.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    const pre = Math.floor(sr * 0.022);
    for (let i = pre; i < n; i++) {
      const k = (i - pre) / (n - pre);
      const coef = 0.85 - 0.75 * k; // brighter early, darker late
      lp += (Math.random() * 2 - 1 - lp) * coef;
      d[i] = lp * Math.pow(1 - k, decay) * Math.min(1, (i - pre) / (sr * 0.015));
    }
    for (let r = 0; r < 12; r++) {
      const at = pre + Math.floor(sr * (0.006 + Math.random() * 0.075));
      if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.35);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// automation track: remembers its last event so every ramp starts where it should
// ---------------------------------------------------------------------------------------------
class Trk {
  t: number;
  v: number;
  constructor(private p: AudioParam, v: number, t0: number) {
    this.v = v;
    this.t = t0;
    p.setValueAtTime(v, t0);
  }
  /** hold the current value until `a`, then glide to `v` by `b` */
  go(v: number, a: number, b: number) {
    if (a > this.t + 1e-4) {
      this.p.setValueAtTime(this.v, a);
      this.t = a;
    }
    if (b <= this.t + 1e-4) b = this.t + 1e-4;
    this.p.linearRampToValueAtTime(v, b);
    this.v = v;
    this.t = b;
  }
  set(v: number, a: number) {
    if (a < this.t) a = this.t;
    this.p.setValueAtTime(v, a);
    this.v = v;
    this.t = a;
  }
}

// ---------------------------------------------------------------------------------------------
// one speaker: a live voice graph plus its schedule
// ---------------------------------------------------------------------------------------------
const NORM = 1.3;
const G2 = -0.72, G3 = 0.36;

interface SpeakerOpts {
  pitch?: number;
  formant?: number;
  volume?: number;
  pos?: Vec3;
  follow?: boolean;
  ref?: number;
}

class Speaker {
  busy = 0;
  tail = 0.25;
  cutAt = -1;
  fs: number;
  f0: number;
  posRef: Vec3 | null = null;
  panner: PannerNode | null = null;
  // typewriter state
  text = '';
  words: PWord[] = [];
  next = 0;
  cps = 38;
  lastI = -1;
  lastT = 0;
  buf = '';
  private nfs: number;
  private T: Record<'pc' | 'f1' | 'f2' | 'f3' | 'g2' | 'g3' | 'vg' | 'bg' | 'fg' | 'ff' | 'fq' | 'ra' | 'cr' | 'vb', Trk>;
  private srcs: AudioScheduledSourceNode[] = [];
  private out: GainNode;
  private vol: number;
  private sendNodes: AudioNode[] = [];

  constructor(private bank: Bank, readonly P: VoiceProfile, o: SpeakerOpts, dest: AudioNode, t0: number) {
    const ac = bank.ac;
    const sr = ac.sampleRate;
    this.fs = P.formant * (o.formant ?? 1);
    this.f0 = P.f0 * (o.pitch ?? 1);
    this.nfs = Math.max(0.6, Math.min(1.5, 0.65 + 0.35 * this.fs));
    const g = (v = 1) => {
      const n = ac.createGain();
      n.gain.value = v;
      return n;
    };
    const src = <T extends AudioScheduledSourceNode>(n: T) => (this.srcs.push(n), n);
    const loop = (b: AudioBuffer, rate = 1) => {
      const s = src(ac.createBufferSource());
      s.buffer = b;
      s.loop = true;
      s.playbackRate.value = rate;
      return s;
    };
    // ---- pitch: everything is in cents on the oscillators' detune
    const pc = src(ac.createConstantSource());
    pc.offset.value = 0;
    const wave = bank.wave(P.tilt);
    const mkOsc = (mul: number) => {
      const os = src(ac.createOscillator());
      os.setPeriodicWave(wave);
      os.frequency.value = this.f0 * mul;
      pc.connect(os.detune);
      return os;
    };
    const oscs = [mkOsc(1)];
    const glot = g(1);
    oscs[0].connect(glot);
    if (P.growl > 0) {
      const sub = mkOsc(0.5);
      oscs.push(sub);
      sub.connect(g(P.growl)).connect(glot);
    }
    if (P.octave) {
      const oct = mkOsc(2);
      oscs.push(oct);
      oct.connect(g(P.octave)).connect(glot);
    }
    const vibAmt = g(0);
    if (P.vib[0] > 0) {
      const lfo = src(ac.createOscillator());
      lfo.frequency.value = P.vib[0] * (0.95 + Math.random() * 0.1);
      lfo.connect(vibAmt);
    }
    const jit = loop(bank.wobble, 0.8 + Math.random() * 0.5);
    const jitAmt = g(P.jitter);
    jit.connect(jitAmt);
    for (const os of oscs) {
      vibAmt.connect(os.detune);
      jitAmt.connect(os.detune);
    }
    // ---- amplitude texture on the buzz: rasp (fast rough AM), croak / trill (ratchet), quaver
    const rough = loop(bank.rough, 0.8 + Math.random() * 0.4);
    const raspAmt = g(0);
    rough.connect(raspAmt).connect(glot.gain);
    const ratchet = src(ac.createOscillator());
    ratchet.type = 'square';
    ratchet.frequency.value = 23 + Math.random() * 4;
    const croakAmt = g(0);
    ratchet.connect(croakAmt).connect(glot.gain);
    if (P.quaver) {
      const q = src(ac.createOscillator());
      q.frequency.value = 6.2 + Math.random() * 1.2;
      q.connect(g(P.quaver)).connect(glot.gain);
    }
    // ---- sources into the tract
    const vg = g(0);
    glot.connect(vg);
    const noise = loop(bank.noise);
    const breathHp = ac.createBiquadFilter();
    breathHp.type = 'highpass';
    breathHp.frequency.value = 450;
    const bg = g(0);
    noise.connect(breathHp).connect(bg);
    // pitch-synchronous gravel: noise gated by the glottal buzz
    if (P.rasp > 0.05) {
      const pn = g(0);
      noise.connect(pn);
      oscs[0].connect(g(P.rasp * 0.55)).connect(pn.gain);
      pn.connect(vg);
    }
    // ---- formant bank (parallel, alternating polarity) + a body path for the fundamental
    const bwK = P.bw * Math.max(1, this.f0 / 200);
    const fIn = g(1);
    vg.connect(fIn);
    bg.connect(fIn);
    const sum = g(1);
    const mx = sr * 0.45;
    const bp = (f: number, bw: number, gain: number) => {
      const b = ac.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = Math.min(mx, f);
      b.Q.value = Math.max(0.7, f / (bw * bwK));
      const gn = g(gain);
      fIn.connect(b).connect(gn).connect(sum);
      return { b, gn };
    };
    const ax = VOW.AX;
    const F1 = bp(ax[0] * this.fs, 85, 1);
    const F2 = bp(ax[1] * this.fs, 105, G2);
    const F3 = bp(ax[2] * this.fs, 160, G3);
    bp(3350 * this.fs, 240, -0.18);
    const body = ac.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = this.f0 * 1.6;
    body.Q.value = 0.5;
    vg.connect(body).connect(g(0.1)).connect(sum);
    // ---- frication: bursts, sibilants, clicks
    const fbp = ac.createBiquadFilter();
    fbp.type = 'bandpass';
    fbp.frequency.value = 4000;
    fbp.Q.value = 1;
    const fg = g(0);
    noise.connect(fbp).connect(fg);
    // ---- colour
    let chain: AudioNode = sum;
    const eq = (type: BiquadFilterType, f: number, gain: number, q = 0.8) => {
      if (!gain) return;
      const e = ac.createBiquadFilter();
      e.type = type;
      e.frequency.value = Math.min(mx, f);
      e.gain.value = gain;
      e.Q.value = q;
      chain.connect(e);
      chain = e;
    };
    eq('lowshelf', 220, P.warmth ?? 0);
    eq('peaking', 2300 * this.fs, (P.presence ?? 0) + (P.nasal ?? 0) * 6, 1.1);
    eq('peaking', 900 * this.fs, -(P.nasal ?? 0) * 9, 2.2);
    eq('highshelf', 5200, P.air ?? 0);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.min(60, this.f0 * 0.55);
    hp.Q.value = 0.6;
    chain.connect(hp);
    const dry = g(1);
    hp.connect(dry);
    fg.connect(dry);
    // ---- character effects
    const fx = g(1);
    let dryMix = 1;
    if (P.hollow) {
      const [dt, fb, mix] = P.hollow;
      const inG = g(1), dl = ac.createDelay(0.05), lp = ac.createBiquadFilter(), fbG = g(fb);
      dl.delayTime.value = dt;
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      dry.connect(inG).connect(dl).connect(lp).connect(fbG).connect(inG);
      dl.connect(g(mix * 0.8)).connect(fx);
      dryMix -= mix * 0.45;
      this.tail = Math.max(this.tail, 0.3);
    }
    if (P.chorus) {
      const [nCh, depth, mix] = P.chorus;
      for (let i = 0; i < nCh; i++) {
        const dl = ac.createDelay(0.1);
        dl.delayTime.value = 0.011 + i * 0.0065;
        const lfo = src(ac.createOscillator());
        lfo.frequency.value = 0.33 + i * 0.27 + Math.random() * 0.1;
        lfo.connect(g(depth / 1000)).connect(dl.delayTime);
        const pan = ac.createStereoPanner();
        pan.pan.value = nCh > 1 ? -0.7 + (1.4 * i) / (nCh - 1) : 0;
        dry.connect(dl).connect(g((mix * 1.4) / nCh)).connect(pan).connect(fx);
      }
    }
    if (P.ring) {
      const [hz, mix] = P.ring;
      const rg = g(0);
      const ro = src(ac.createOscillator());
      ro.frequency.value = hz;
      ro.connect(rg.gain);
      dry.connect(rg).connect(g(mix * 1.3)).connect(fx);
      dryMix -= mix * 0.55;
    }
    dry.connect(g(Math.max(0.2, dryMix))).connect(fx);
    // ---- out: volume, place, echo, reverb
    this.vol = P.gain * (o.volume ?? 1) * NORM;
    this.out = g(this.vol);
    fx.connect(this.out);
    let tailNode: AudioNode = this.out;
    if (o.pos) {
      const p = ac.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? P.ref ?? 10;
      p.maxDistance = 500;
      p.rolloffFactor = 0.9;
      p.positionX.value = o.pos.x;
      p.positionY.value = o.pos.y;
      p.positionZ.value = o.pos.z;
      this.out.connect(p);
      tailNode = p;
      this.panner = p;
      if (o.follow) this.posRef = o.pos;
    }
    tailNode.connect(dest);
    if (P.echo) {
      const [et, fb, mix] = P.echo;
      const dl = ac.createDelay(1.5), lp = ac.createBiquadFilter(), fbG = g(fb), send = g(mix);
      dl.delayTime.value = et;
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      tailNode.connect(send).connect(dl).connect(lp).connect(fbG).connect(dl);
      lp.connect(dest);
      this.sendNodes.push(send);
      this.tail = Math.max(this.tail, (et * Math.log(0.002)) / Math.log(Math.max(0.05, fb)));
    }
    if (P.reverb) {
      const send = g(P.reverb);
      tailNode.connect(send).connect(bank.rvIn);
      this.sendNodes.push(send);
    }
    // ---- tracks
    const fsK = this.fs;
    this.T = {
      pc: new Trk(pc.offset, 0, t0),
      f1: new Trk(F1.b.frequency, ax[0] * fsK, t0),
      f2: new Trk(F2.b.frequency, ax[1] * fsK, t0),
      f3: new Trk(F3.b.frequency, Math.min(mx, ax[2] * fsK), t0),
      g2: new Trk(F2.gn.gain, G2, t0),
      g3: new Trk(F3.gn.gain, G3, t0),
      vg: new Trk(vg.gain, 0, t0),
      bg: new Trk(bg.gain, 0, t0),
      fg: new Trk(fg.gain, 0, t0),
      ff: new Trk(fbp.frequency, 4000, t0),
      fq: new Trk(fbp.Q, 1, t0),
      ra: new Trk(raspAmt.gain, P.rasp * 0.5, t0),
      cr: new Trk(croakAmt.gain, P.croak ?? 0, t0),
      vb: new Trk(vibAmt.gain, P.vib[1] * 0.4, t0),
    };
    for (const s of this.srcs) {
      if (s instanceof AudioBufferSourceNode) s.start(t0, Math.random() * (s.buffer ? s.buffer.duration : 0));
      else s.start(t0);
    }
  }

  // ---------------------------------------------------------------- scheduling
  /** one word; `allot` squeezes or stretches it into a typewriter's time */
  word(w: PWord, t: number, allot?: number) {
    let syl = w.syl;
    const sum = (a: PSyl[]) => a.reduce((x, s) => x + s.dur, 0);
    let k = 1;
    if (allot !== undefined) {
      const room = Math.max(0.07, allot * 0.92);
      k = Math.min(1.3, room / sum(syl));
      if (k < 0.55 && syl.length > 2) {
        // drop the weakest middle syllables until it fits
        const keep = syl.slice();
        while (keep.length > 2 && sum(keep) * 0.55 > room) {
          let wi = 1;
          for (let i = 2; i < keep.length - 1; i++) if (keep[i].stress < keep[wi].stress) wi = i;
          keep.splice(wi, 1);
        }
        syl = keep;
        k = Math.min(1.3, room / sum(syl));
      }
      k = Math.max(0.5, k);
    }
    for (const s of syl) t = this.syl(s, t, k);
    return t;
  }

  private cd(c: string) {
    return CON[c]?.d ?? 0.05;
  }

  /** one syllable at t0, durations scaled by k; returns where the next one may start */
  syl(s: PSyl, t0: number, k: number): number {
    const P = this.P, T = this.T;
    const amp = s.amp * (P.voicing ?? 1);
    const cs = Math.min(1.25, Math.max(0.55, k)) / Math.sqrt(P.speed);
    let onD = 0, coD = 0;
    for (const c of s.on) onD += this.cd(c) * cs;
    for (const c of s.co) coD += this.cd(c) * cs;
    const clicks = P.click ? (P.click > 0.8 ? 2 : Math.random() < P.click ? 1 : 0) : 0;
    const clickD = clicks * 0.022;
    const total = Math.max(0.07, s.dur * k);
    const none = !s.nu.length;
    let q = 1;
    let vD = none ? 0 : total - onD - coD - clickD;
    if (none) q = Math.max(0.5, (total - clickD) / Math.max(1e-3, onD + coD));
    else {
      const minV = Math.min(0.06, total * 0.4);
      if (vD < minV) {
        q = Math.max(0.25, (total - minV - clickD) / Math.max(1e-3, onD + coD));
        vD = Math.max(minV, total - (onD + coD) * q - clickD);
      }
    }
    let t = t0;
    T.ra.go(P.rasp * 0.5 + (s.shout ? 0.15 : 0), t, t + 0.02);
    T.cr.go(P.croak ?? 0, t, t + 0.02);
    const c0 = s.p0 * 100;
    if (t - T.pc.t > 0.1) T.pc.set(c0, t);
    else T.pc.go(c0, t, t + 0.035);
    for (let i = 0; i < clicks; i++) {
      this.burst(t + 0.002, 4300 + Math.random() * 1500, 3.5, amp * 0.9 * (P.click ?? 0));
      t += 0.022;
    }
    const N = nucleus(s.nu, s.reduce);
    let soft = false;
    for (let j = 0; j < s.on.length; j++) {
      const C = CON[s.on[j]];
      if (!C) continue;
      const d = this.cd(s.on[j]) * cs * q;
      const nx = CON[s.on[j + 1]]?.fm ?? N.a;
      this.cons(s.on[j], t, d, amp, nx, false, true);
      soft = C.k === 'approx' || C.k === 'nasal';
      t += d;
    }
    if (!none) {
      this.vowel(N, s, t, t + vD, amp, soft, s.on.length === 0 && !clicks);
      t += vD;
    }
    for (let j = 0; j < s.co.length; j++) {
      const C = CON[s.co[j]];
      if (!C) continue;
      const d = this.cd(s.co[j]) * cs * q;
      this.cons(s.co[j], t, d, amp, C.fm ?? N.b ?? N.a, true, j === s.co.length - 1 && (s.gap > 0.03 || s.final > 0));
      t += d;
    }
    if (s.gap >= 0.035 || s.final) {
      const rel = s.final ? 0.09 : 0.04;
      T.vg.go(0, t, t + rel);
      T.bg.go(0, t, t + rel);
      T.fg.go(0, t, t + 0.02);
      return t + rel;
    }
    return t;
  }

  private vowel(N: Nuc, s: PSyl, a: number, b: number, amp: number, slow: boolean, open: boolean) {
    const T = this.T, P = this.P;
    const d = b - a;
    const tr = Math.min(d * 0.45, slow ? 0.065 : 0.04);
    this.formants(N.a, a, a + tr);
    const hum = N.kind === 'hum';
    T.g2.go(hum ? G2 * 0.22 : G2, a, a + 0.03);
    T.g3.go(hum ? G3 * 0.25 : G3, a, a + 0.03);
    if (N.b) this.formants(N.b, a + d * 0.35, a + d * 0.85);
    const va = amp * (hum ? 0.75 : 1);
    let at = a;
    if (open && T.vg.v > 0.05) {
      T.vg.go(amp * 0.25, a, a + 0.014); // a little glottal catch between vowel-joined words
      at = a + 0.014;
    }
    T.vg.go(va, at, at + 0.024);
    T.vg.go(va * (s.final ? 0.68 : 0.85), at + 0.024, b);
    T.bg.go(amp * P.breath * 0.5, a, a + 0.03);
    T.bg.go(amp * P.breath * 0.42, a + 0.03, b);
    T.fg.go(0, a, a + 0.015);
    const c0 = s.p0 * 100, c1 = s.p1 * 100;
    if (s.creak > 0.05 && d > 0.08) {
      const m = a + d * 0.5;
      T.pc.go(c0 + (c1 - c0) * 0.5, a + 0.02, m);
      T.pc.go(c1 - s.creak * 450, m, b);
      T.ra.go(Math.min(0.95, P.rasp * 0.5 + s.creak * 0.5), m, b);
    } else T.pc.go(c1, a + 0.02, b);
    const vd = P.vib[1] * (s.sung ? 1.7 : 1);
    if (vd > 0) {
      T.vb.go(vd * 0.3, a, a + 0.02);
      if (d > 0.2) T.vb.go(vd, a + d * 0.45, b);
    }
    if (N.kind === 'trill') {
      T.cr.go(0.85, a, a + 0.03);
      T.cr.go(0.85, a + 0.03, b - 0.02);
      T.cr.go(P.croak ?? 0, b - 0.02, b);
    }
  }

  private cons(code: string, t: number, d: number, amp: number, nf: Fm, coda: boolean, released: boolean) {
    const T = this.T, P = this.P, C = CON[code];
    const cons = P.cons ?? 1;
    const toward = (to: number) => {
      const F2 = C.loc ? C.loc * 0.6 + nf[1] * 0.4 : nf[1];
      this.formants([C.k === 'stop' || C.k === 'aff' ? 260 : nf[0] * 0.85, F2, nf[2]], t, to);
    };
    switch (C.k) {
      case 'stop':
      case 'aff': {
        const cl = d * (C.k === 'aff' ? 0.4 : 0.62);
        T.vg.go(C.v ? amp * 0.1 : 0, t, t + 0.014);
        T.bg.go(0, t, t + 0.014);
        T.fg.go(0, t, t + 0.01);
        toward(t + cl);
        const tb = t + cl;
        if (C.k === 'aff') {
          this.burst(tb, C.v ? 3900 : 4300, 1.3, (C.na ?? 0.4) * amp * cons * 0.7);
          this.fric(C.nf!, C.nq!, (C.na ?? 0.4) * amp * (P.sib ?? 1), tb + 0.012, t + d);
          if (C.v) T.vg.go(amp * 0.32, tb, tb + 0.02);
        } else {
          if (released) this.burst(tb, C.nf!, C.nq!, (C.na ?? 0.4) * amp * cons * (coda ? 0.5 : 1));
          if (!C.v && !coda) {
            T.bg.go(amp * 0.45 * (P.asp ?? 1), tb + 0.006, tb + 0.012);
            T.bg.go(amp * 0.06, tb + 0.012, t + d);
          }
          if (C.v && !coda) T.vg.go(amp * 0.5, tb + 0.004, t + d);
        }
        break;
      }
      case 'fric': {
        const sib = SIBILANT.has(code) ? (P.sib ?? 1) : 1;
        this.fric(C.nf!, C.nq!, (C.na ?? 0.2) * amp * sib, t, t + d);
        T.vg.go(C.v ? amp * 0.32 : 0, t, t + 0.02);
        T.bg.go(C.v ? amp * 0.05 : 0, t, t + 0.02);
        toward(t + Math.min(d, 0.04));
        break;
      }
      case 'asp':
        T.vg.go(0, t, t + 0.015);
        T.fg.go(0, t, t + 0.01);
        T.bg.go(amp * 0.55 * (P.asp ?? 1), t, t + 0.025);
        this.formants(nf, t, t + 0.02);
        break;
      case 'nasal':
        T.fg.go(0, t, t + 0.01);
        T.bg.go(amp * P.breath * 0.2, t, t + 0.02);
        T.vg.go(amp * 0.62, t, t + 0.02);
        this.formants(C.fm!, t, t + Math.min(0.025, d * 0.5));
        T.g2.go(G2 * 0.22, t, t + 0.02);
        T.g3.go(G3 * 0.25, t, t + 0.02);
        break;
      case 'approx':
        T.fg.go(0, t, t + 0.01);
        T.vg.go(amp * 0.72, t, t + 0.025);
        this.formants(C.fm!, t, t + Math.min(0.035, d * 0.6));
        break;
    }
  }

  private formants(F: Fm, a: number, b: number) {
    const mx = this.bank.ac.sampleRate * 0.45, fs = this.fs, T = this.T;
    T.f1.go(Math.min(mx, F[0] * fs), a, b);
    T.f2.go(Math.min(mx, F[1] * fs), a, b);
    T.f3.go(Math.min(mx, F[2] * fs), a, b);
  }
  private burst(tb: number, f: number, q: number, a: number) {
    const T = this.T, mx = this.bank.ac.sampleRate * 0.45;
    T.ff.set(Math.min(mx, f * this.nfs), tb);
    T.fq.set(q, tb);
    T.fg.set(0, tb);
    T.fg.go(a, tb, tb + 0.0025);
    T.fg.go(0, tb + 0.0025, tb + 0.02);
  }
  private fric(f: number, q: number, a: number, t1: number, t2: number) {
    const T = this.T, mx = this.bank.ac.sampleRate * 0.45;
    T.ff.set(Math.min(mx, f * this.nfs), t1);
    T.fq.set(q, t1);
    const at = Math.min(0.02, (t2 - t1) * 0.3);
    T.fg.go(a, t1, t1 + at);
    T.fg.go(a * 0.85, t1 + at, t2 - at);
    T.fg.go(0, t2 - at, t2 + 0.008);
  }

  /** a loose syllable from a single typed character (no line to plan from) */
  loose(ch: string, t: number) {
    const c = ch.toLowerCase();
    if (!/[a-z]/.test(c)) {
      this.buf = '';
      return t;
    }
    const prev = this.buf[this.buf.length - 1];
    this.buf += c;
    if (!'aeiouy'.includes(c) || (prev && 'aeiouy'.includes(prev))) return t;
    const onset = g2p(this.buf.slice(-3, -1)).filter((p) => CON[p]).slice(-2);
    const V: Record<string, string> = { a: Math.random() < 0.5 ? 'AE' : 'A', e: 'E', i: 'IH', o: 'O', u: 'UH', y: 'I' };
    const R = this.P.range;
    const p0 = (Math.random() - 0.4) * R * 0.8;
    const s: PSyl = { on: onset, nu: [V[c]], co: [], dur: SYL / this.P.speed, p0, p1: p0 - R * 0.2, amp: 0.85, stress: 1, final: 0, creak: 0, reduce: 0, shout: false, sung: false, gap: 0.04 };
    return this.syl(s, t, 0.85);
  }

  /** fade out now (a new line on this channel, or Voice.stop) */
  cut(fade = 0.06) {
    const ac = this.bank.ac;
    const now = ac.currentTime;
    if (this.cutAt >= 0) return;
    this.cutAt = now;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(this.vol, now);
    g.linearRampToValueAtTime(0, now + fade);
    for (const s of this.sendNodes) (s as GainNode).gain.setTargetAtTime(0, now + fade, 0.05);
    this.busy = now;
    this.tail = fade + 0.1;
  }
  stopAt(t: number) {
    for (const s of this.srcs) {
      try {
        s.stop(t);
      } catch {
        /* */
      }
    }
  }
  dispose() {
    this.stopAt(0);
    try {
      this.out.disconnect();
      this.panner?.disconnect();
    } catch {
      /* */
    }
  }
  follow() {
    const p = this.panner, r = this.posRef;
    if (!p || !r) return;
    const now = this.bank.ac.currentTime;
    p.positionX.setTargetAtTime(r.x, now, 0.05);
    p.positionY.setTargetAtTime(r.y, now, 0.05);
    p.positionZ.setTargetAtTime(r.z, now, 0.05);
  }
  place(pos: Vec3) {
    const p = this.panner;
    if (!p) return;
    const now = this.bank.ac.currentTime;
    p.positionX.setTargetAtTime(pos.x, now, 0.05);
    p.positionY.setTargetAtTime(pos.y, now, 0.05);
    p.positionZ.setTargetAtTime(pos.z, now, 0.05);
  }
}

interface Nuc {
  a: Fm;
  b: Fm | null;
  kind: 'vowel' | 'hum' | 'trill' | 'none';
}
function nucleus(nu: string[], reduce: number): Nuc {
  const x = nu[0];
  const mix = (f: Fm): Fm => (reduce > 0 ? [f[0] + (VOW.AX[0] - f[0]) * reduce, f[1] + (VOW.AX[1] - f[1]) * reduce, f[2] + (VOW.AX[2] - f[2]) * reduce] : f);
  if (!x) return { a: VOW.AX, b: null, kind: 'none' };
  if (x === 'MM') return { a: CON.M.fm!, b: null, kind: 'hum' };
  if (x === 'RR') return { a: CON.R.fm!, b: null, kind: 'trill' };
  const dp = DIPH[x];
  if (dp) return { a: mix(VOW[dp[0]]), b: VOW[dp[1]], kind: 'vowel' };
  return { a: mix(VOW[x] ?? VOW.AX), b: null, kind: 'vowel' };
}

/** lay a whole planned line onto a speaker from t0; cps paces words to a typewriter */
function speakPlan(sp: Speaker, words: PWord[], t0: number, cps?: number) {
  let t = t0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let allot: number | undefined;
    if (cps) {
      const ws = t0 + w.ci / cps;
      if (ws > t) t = ws;
      const nx = words[i + 1];
      allot = nx ? t0 + nx.ci / cps - t : undefined;
    }
    t = sp.word(w, t, allot);
    // natural pacing keeps the pauses; a typewriter sets its own
    if (!cps) t += Math.max(0, w.gap - 0.04);
  }
  return t;
}

function resolve(p: VoiceId | VoiceProfile): VoiceProfile {
  return typeof p === 'string' ? (PROFILES as Record<string, VoiceProfile>)[p] ?? PROFILES.outlaw : p;
}

// ---------------------------------------------------------------------------------------------
// the voice system
// ---------------------------------------------------------------------------------------------
class VoiceSystem {
  private eng: AudioEngine | null = null;
  private bank: Bank | null = null;
  private bus: GainNode | null = null;
  private duckNode: GainNode | null = null;
  private duckUntil = 0;
  private duckAmt = 0;
  private live = new Map<string, Speaker>();
  private dying: Speaker[] = [];
  private timer = 0;
  private lastPick = new Map<string, number>();
  private muted = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mute') === '1';
  private level = 1;

  /** route voices into an engine (done lazily from the page's engine if never called) */
  attach(audio: AudioEngine) {
    if (this.eng === audio) return;
    this.eng = audio;
    const ac = audio.ctx;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    this.bus = ac.createGain();
    this.bus.gain.value = this.level;
    this.bus.connect(comp).connect(audio.buses.voice);
    this.bank = new Bank(ac, this.bus);
    // music ducking: the music bus now runs through a gain we control
    try {
      const d = ac.createGain();
      audio.buses.music.disconnect(audio.master);
      audio.buses.music.connect(d);
      d.connect(audio.master);
      this.duckNode = d;
    } catch {
      this.duckNode = null;
    }
  }

  /** speech level (on top of the engine's 'voice' bus) */
  get volume() {
    return this.level;
  }
  set volume(v: number) {
    this.level = v;
    if (this.bus && this.eng) this.bus.gain.setTargetAtTime(v, this.eng.ctx.currentTime, 0.05);
  }

  private ready() {
    if (this.muted) return false;
    if (!this.eng) {
      const e = (globalThis as any).__engine;
      if (e?.audio) this.attach(e.audio);
    }
    return !!this.eng && !!this.bank && this.eng.ctx.state === 'running';
  }

  /** speak a whole line */
  say(profile: VoiceId | VoiceProfile, text: string, o: SayOpts = {}): Speech | null {
    if (!text || !this.ready()) return null;
    const P = resolve(profile);
    const words = makePlan(P, text, o);
    if (!words.length) return null;
    const ac = this.eng!.ctx;
    const key = o.key ?? (typeof profile === 'string' ? profile : 'custom');
    this.retire(key, 0.05);
    const now = ac.currentTime;
    const sp = new Speaker(this.bank!, P, o, this.bus!, now);
    const t0 = now + 0.03 + Math.max(0, o.delay ?? 0);
    const end = speakPlan(sp, words, t0, o.cps);
    sp.busy = end;
    this.live.set(key, sp);
    this.duck(t0, end, o.duck ?? P.duck ?? 0.4);
    this.arm();
    return { end, duration: end - t0, stop: (f = 0.08) => sp.cut(f) };
  }

  /**
   * Typewriter sync: call for each revealed character. With `index` and `text` the voice
   * plans the whole sentence and speaks each word as its first letter appears, fitted to
   * the measured typing speed; with a bare character it babbles syllable by syllable.
   */
  syllable(profile: VoiceId | VoiceProfile, char: string, o: SyllableOpts = {}) {
    if (!char || !this.ready()) return;
    const P = resolve(profile);
    const ac = this.eng!.ctx;
    const now = ac.currentTime;
    const key = o.key ?? (typeof profile === 'string' ? profile : 'custom');
    let sp = this.live.get(key);
    if (!sp || sp.cutAt >= 0 || sp.P !== P) {
      if (sp) this.retire(key, 0.05);
      sp = new Speaker(this.bank!, P, { ...o, pos: o.pos ? { x: o.pos.x, y: o.pos.y, z: o.pos.z } : undefined }, this.bus!, now);
      sp.busy = now;
      this.live.set(key, sp);
      this.arm();
    }
    if (o.pos) sp.place(o.pos);
    const start = Math.max(now + 0.012, sp.busy);
    if (start - now > 0.3) return; // falling behind the text: let this one go
    let end = start;
    if (o.text !== undefined && o.index !== undefined) {
      const i = o.index;
      if (sp.text !== o.text || i < sp.lastI) {
        sp.text = o.text;
        sp.words = makePlan(P, o.text, o);
        sp.next = 0;
        sp.cps = o.cps ?? 38;
        sp.lastI = -1;
      } else if (sp.lastI >= 0) {
        const dt = now - sp.lastT, di = i - sp.lastI;
        if (dt > 0.004 && dt < 0.6 && di > 0) sp.cps += (Math.min(120, Math.max(8, di / dt)) - sp.cps) * 0.3;
      }
      sp.lastI = i;
      sp.lastT = now;
      let w: PWord | null = null, pending = 0;
      while (sp.next < sp.words.length && sp.words[sp.next].ci <= i) (w = sp.words[sp.next++]), pending++;
      if (!w || pending > 2) return; // nothing new, or the typing was skipped ahead
      const nx = sp.words[sp.next];
      end = sp.word(w, start, nx ? Math.max(0.06, (nx.ci - i) / sp.cps) : undefined);
    } else end = sp.loose(char, start);
    if (end > start) {
      sp.busy = end;
      this.duck(start, end, o.duck ?? P.duck ?? 0.4);
    }
  }

  /** a random canned line for a mood (profile.phrases[kind]); null if it has none */
  chatter(profile: VoiceId, kind: string, o: SayOpts = {}): Speech | null {
    const list = resolve(profile).phrases?.[kind];
    if (!list?.length) return null;
    const k = profile + ':' + kind;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastPick.get(k)) i = (i + 1) % list.length;
    this.lastPick.set(k, i);
    return this.say(profile, list[i], o);
  }

  /** silence one channel / profile, or everyone */
  stop(key?: string, fade = 0.08) {
    for (const [k] of [...this.live]) if (!key || k === key) this.retire(k, fade);
    if ((!key || !this.live.size) && this.duckNode && this.eng) {
      // nobody left talking: bring the music back now
      const now = this.eng.ctx.currentTime, g = this.duckNode.gain;
      this.duckUntil = now;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(1, now, 0.3);
    }
  }

  /** is anyone (other than `except`) still talking? */
  speaking(except?: string) {
    if (!this.eng) return false;
    const now = this.eng.ctx.currentTime;
    for (const [k, sp] of this.live) if (k !== except && sp.cutAt < 0 && sp.busy > now) return true;
    return false;
  }

  /** render a line offline (tests, baking): a stereo AudioBuffer */
  async render(profile: VoiceId | VoiceProfile, text: string, o: SayOpts = {}, sampleRate = 44100): Promise<AudioBuffer> {
    const P = resolve(profile);
    const words = makePlan(P, text, o);
    let nat = 0;
    for (const w of words) for (const s of w.syl) nat += s.dur + s.gap + 0.1;
    const len = Math.max(nat * 1.3, o.cps ? text.length / o.cps + 1 : 0) + 4;
    const ac = new OfflineAudioContext(2, Math.ceil(sampleRate * len), sampleRate);
    const bank = new Bank(ac, ac.destination);
    const sp = new Speaker(bank, P, { ...o, pos: undefined }, ac.destination, 0);
    const end = speakPlan(sp, words, 0.05, o.cps);
    sp.stopAt(Math.min(len, end + sp.tail + 3));
    return ac.startRendering();
  }

  // ---------------------------------------------------------------- housekeeping
  private retire(key: string, fade: number) {
    const old = this.live.get(key);
    if (!old) return;
    this.live.delete(key);
    old.cut(fade);
    this.dying.push(old);
    this.arm();
  }

  private duck(t0: number, end: number, amount: number) {
    const d = this.duckNode;
    if (!d || amount <= 0 || !this.eng) return;
    const now = this.eng.ctx.currentTime;
    if (now > this.duckUntil) this.duckAmt = 0;
    this.duckAmt = Math.max(this.duckAmt, amount);
    this.duckUntil = Math.max(this.duckUntil, end);
    const g = d.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(1 - this.duckAmt, Math.max(now, t0 - 0.05), 0.07);
    g.setTargetAtTime(1, this.duckUntil + 0.25, 0.4);
  }

  private arm() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 100);
  }
  private tick() {
    const now = this.eng?.ctx.currentTime ?? 0;
    for (const [k, sp] of this.live) {
      sp.follow();
      if (now > sp.busy + sp.tail + 1.5) {
        sp.dispose();
        this.live.delete(k);
      }
    }
    this.dying = this.dying.filter((sp) => {
      if (now > sp.busy + sp.tail) {
        sp.dispose();
        return false;
      }
      return true;
    });
    if (!this.live.size && !this.dying.length) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }
}

export const Voice = new VoiceSystem();

/** exposed for debugging / tests */
export const VoiceDebug = { g2p, syllabify, makePlan, tokenize };
