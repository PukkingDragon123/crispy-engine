#!/usr/bin/env python3
"""
dustUP orchestra + battle voice build
=====================================

Cuts the majestic layer of the score (strings, brass, choir, ney, harp, taiko, timpani,
darbuka, frame drum, riq, cymbals, gong) and the battle voice set out of real recordings.

    python3 tools/build_orchestra.py            # everything
    python3 tools/build_orchestra.py orch       # orchestra only
    python3 tools/build_orchestra.py voice      # voice lines only

Outputs
-------
    public/audio/orch/<inst>/*.mp3     pitched notes and hits for Music.ts (mono, 44.1 kHz)
    public/audio/vo/*.mp3              battle voice lines for BattleVoice.ts
    src/game/audio/orchManifest.ts     GENERATED tables (ORCH, PERC, VO, VO_TEXT)
    tools/orch_provenance.json         every output file -> its exact source files + license

Sources (clone / download them, or point the env vars at existing copies)
-------------------------------------------------------------------------
DUSTUP_VSCO    VS Chamber Orchestra 2: Community Edition, Versilian Studios (CC0 1.0)
               git clone --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE
               then `git checkout HEAD --pathspec-from-file=<list>` for the files named below.
DUSTUP_VCSL    Versilian Community Sample Library (CC0 1.0)
               git clone --filter=blob:none --no-checkout https://github.com/sgossner/VCSL
DUSTUP_CHOIR   Freesound, ShangusBurger (Shane Vincent), "GameSoundCon2024 Walla XY-AKG214-96k"
               pack 42098 (CC0 1.0): sounds 763909 (Ahh 01) and 763913 (Uh 01), hq previews
               saved as fs_<id>.mp3.
DUSTUP_META    Meta Open Sound: Oculus Audio Pack 01 (CC BY 4.0) VOX efforts / hurts / screams /
               laughs / whispers. https://github.com/facebookincubator/Meta-open-sound
DUSTUP_KENNEY  Kenney "Voiceover Pack: Fighter" (CC0) via open-game-sfx-index.
DUSTUP_PIPER   Piper TTS (MIT) + the en_US "ljspeech" high voice (LJ Speech dataset, public
               domain): https://huggingface.co/rhasspy/piper-voices  (Serket's lines only, and
               only ever heard as whispers: the voiced speech is replaced by noise excitation)

Requires numpy + ffmpeg (libmp3lame, rubberband).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 44100
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'public' / 'audio'
MANIFEST = REPO / 'src' / 'game' / 'audio' / 'orchManifest.ts'
PROV_FILE = REPO / 'tools' / 'orch_provenance.json'

VSCO = Path(os.environ.get('DUSTUP_VSCO', '/home/user/sfxsrc/orch/vsco2'))
VCSL = Path(os.environ.get('DUSTUP_VCSL', '/home/user/sfxsrc/orch/vcsl'))
CHOIR = Path(os.environ.get('DUSTUP_CHOIR', '/home/user/sfxsrc/orch/choir'))
META = Path(os.environ.get('DUSTUP_META', '/home/user/facebookincubator/meta-open-sound')) / 'corpora/oculus-audio-pack/ogg'
KENNEY = Path(os.environ.get('DUSTUP_KENNEY', '/home/user/mcamento8/open-game-sfx-index')) / 'audio/voiceover-pack-fighter'
PIPER = Path(os.environ.get('DUSTUP_PIPER', '/home/user/sfxsrc/orch/piper'))
PIPER_BIN = os.environ.get('DUSTUP_PIPER_BIN', '/home/user/sfxsrc/piperenv/bin/piper')

LIC = {
    'vsco': 'CC0 1.0 - VS Chamber Orchestra 2: Community Edition (Versilian Studios)',
    'vcsl': 'CC0 1.0 - Versilian Community Sample Library (Versilian Studios)',
    'choir': 'CC0 1.0 - Freesound, ShangusBurger (Shane Vincent), GameSoundCon2024 Walla',
    'meta': 'CC BY 4.0 - Oculus Audio Pack 01 (Oculus VR, LLC)',
    'kenney': 'CC0 1.0 - Kenney, Voiceover Pack: Fighter',
    'piper': 'Piper TTS (MIT), en_US ljspeech voice (LJ Speech dataset, public domain)',
}
PROV: dict[str, dict] = {}


# ----------------------------------------------------------------------------- io
def dec(path: Path, af: str | None = None, ch: int = 1) -> np.ndarray:
    if not path.exists():
        raise FileNotFoundError(path)
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path)]
    if af:
        cmd += ['-af', af]
    cmd += ['-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    return x.reshape(-1, ch) if ch > 1 else x


def proc(x: np.ndarray, af: str) -> np.ndarray:
    """run a mono signal through an ffmpeg filter chain"""
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-af', af, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, input=x.astype(np.float32).tobytes(), check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def enc(x: np.ndarray, rel: str, sources: list[str], lic: list[str], br: str = '96k'):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    x = np.clip(x, -1, 1).astype(np.float32)
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', br, str(p)]
    subprocess.run(cmd, input=x.tobytes(), check=True)
    PROV[rel] = dict(sources=sources, license=sorted(set(LIC[k] for k in lic)))


# ----------------------------------------------------------------------------- dsp
def db(v: float) -> float:
    return 10 ** (v / 20)


def trim(x: np.ndarray, thr_db: float = -45, pre: float = 0.004) -> np.ndarray:
    pk = np.max(np.abs(x)) + 1e-9
    idx = np.nonzero(np.abs(x) > pk * db(thr_db))[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(pre * SR))
    b = min(len(x), idx[-1] + int(0.05 * SR))
    return x[a:b]


def fade(x: np.ndarray, fi: float = 0.002, fo: float = 0.3) -> np.ndarray:
    x = x.copy()
    n = min(len(x), int(fi * SR))
    if n:
        x[:n] *= np.linspace(0, 1, n)
    n = min(len(x), int(fo * SR))
    if n:
        x[-n:] *= np.linspace(1, 0, n) ** 2
    return x


def cap(x: np.ndarray, sec: float, fo: float = 0.35) -> np.ndarray:
    return fade(x[: int(sec * SR)], fo=fo)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-12)


def norm_rms(x: np.ndarray, target_db: float, a: float = 0.2, b: float = 2.5, ceil_db: float = -1.0) -> np.ndarray:
    seg = x[int(a * SR): int(b * SR)]
    if len(seg) < SR * 0.05:
        seg = x
    y = x * (db(target_db) / rms(seg))
    pk = np.max(np.abs(y))
    if pk > db(ceil_db):
        y *= db(ceil_db) / pk
    return y


def norm_peak(x: np.ndarray, pk_db: float = -1.0) -> np.ndarray:
    return x * (db(pk_db) / (np.max(np.abs(x)) + 1e-9))


def resample(x: np.ndarray, rate: float) -> np.ndarray:
    """varispeed (rate > 1 = higher and shorter)"""
    n = int(len(x) / rate)
    return np.interp(np.arange(n) * rate, np.arange(len(x)), x).astype(np.float32)


def lowpass(x: np.ndarray, hz: float) -> np.ndarray:
    return proc(x, f'lowpass=f={hz}:p=2')


def f0(x: np.ndarray, t0: float = 0.45, dur: float = 0.5) -> float:
    a = int(t0 * SR)
    seg = x[a: a + int(dur * SR)]
    if len(seg) < 2048:
        seg = x[: int(dur * SR)]
    seg = (seg - seg.mean()) * np.hanning(len(seg))
    n = len(seg)
    F = np.fft.rfft(seg, 2 * n)
    ac = np.fft.irfft(np.abs(F) ** 2)[:n]
    ac /= ac[0] + 1e-12
    lo, hi = int(SR / 1800), int(SR / 26)
    r = ac[lo:hi]
    m = r.max()
    k = None
    for i in range(1, len(r) - 1):
        if r[i] >= 0.86 * m and r[i] >= r[i - 1] and r[i] >= r[i + 1]:
            k = i
            break
    if k is None:
        k = int(np.argmax(r))
    y0, y1, y2 = r[k - 1], r[k], r[k + 1]
    den = y0 - 2 * y1 + y2
    off = 0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0
    return SR / (lo + k + off)


PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def name_midi(n: str) -> int:
    m = re.match(r'([A-G])(#?)(-?\d)', n)
    assert m, n
    return 12 * (int(m.group(3)) + 1) + PC[m.group(1)] + (1 if m.group(2) else 0)


def hz_midi(h: float) -> float:
    return 69 + 12 * np.log2(h / 440)


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    n = len(x) + len(ir) - 1
    N = 1 << int(np.ceil(np.log2(n)))
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N))[:n].astype(np.float32)


def room_ir(sec: float, decay: float, seed: int, bright: float = 0.5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(sec * SR)
    t = np.arange(n) / n
    noise = rng.standard_normal(n).astype(np.float32)
    # darker as it decays (one-pole lowpass with a falling coefficient)
    out = np.empty(n, dtype=np.float32)
    s = 0.0
    k = bright * (1 - 0.7 * t)
    for i in range(n):
        s += (noise[i] - s) * k[i]
        out[i] = s
    out *= (1 - t) ** decay
    return out / (np.sqrt(np.sum(out ** 2)) + 1e-9)


def reverb(x: np.ndarray, ir: np.ndarray, wet: float) -> np.ndarray:
    w = convolve(x, ir)
    y = np.zeros(len(w), dtype=np.float32)
    y[: len(x)] += x * (1 - wet * 0.5)
    y += w * wet * (rms(x) / (rms(w) + 1e-9))
    return y


def compress(x: np.ndarray, thr_db: float = -18, ratio: float = 4, att: float = 0.002, rel: float = 0.09, makeup_db: float = 0) -> np.ndarray:
    env = np.abs(x).astype(np.float64)
    a, r = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    e = 0.0
    out = np.empty_like(env)
    for i, v in enumerate(env):
        e = a * e + (1 - a) * v if v > e else r * e + (1 - r) * v
        out[i] = e
    lvl = 20 * np.log10(out + 1e-9)
    gain = np.where(lvl > thr_db, (thr_db + (lvl - thr_db) / ratio) - lvl, 0.0)
    return (x * 10 ** ((gain + makeup_db) / 20)).astype(np.float32)


def sat(x: np.ndarray, drive: float) -> np.ndarray:
    return (np.tanh(x * drive) / np.tanh(drive)).astype(np.float32)


def mix(*parts: tuple[np.ndarray, float, float]) -> np.ndarray:
    """(signal, gain, delay s) layers summed"""
    n = max(len(p) + int(d * SR) for p, _, d in parts)
    y = np.zeros(n, dtype=np.float32)
    for p, g, d in parts:
        o = int(d * SR)
        y[o: o + len(p)] += p * g
    return y


def splits(x: np.ndarray, thr_db: float = -34, gap: float = 0.12, min_len: float = 0.08) -> list[np.ndarray]:
    """cut a take into its separate utterances"""
    hop = 256
    fr = np.array([rms(x[i: i + hop]) for i in range(0, len(x) - hop, hop)])
    on = fr > (fr.max() * db(thr_db))
    segs, start, quiet = [], None, 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet * hop / SR > gap:
                segs.append((start, i - quiet + 1))
                start, quiet = None, 0
    if start is not None:
        segs.append((start, len(on)))
    return [fade(x[max(0, a * hop - 200): b * hop + 2000], fo=0.05) for a, b in segs if (b - a) * hop / SR >= min_len]


# ----------------------------------------------------------------------------- orchestra
ORCH_TABLE: dict[str, list[dict]] = {}
PERC_TABLE: dict[str, list[str]] = {}

S = 'Strings'
PITCHED = {
    # inst: (cap seconds, rms target dB, [(vsco path, name note)])
    'str': (6.5, -19, [
        *[(f'{S}/Cello Section/susvib/susvib_{n}_v3_1.wav', n) for n in ('E1', 'G1', 'B1', 'D2', 'F2', 'A2')],
        *[(f'{S}/Viola Section/susvib/ViolaEns_susvib_{n}_v2_1.wav', n) for n in ('D3', 'F3', 'A3', 'C4')],
        *[(f'{S}/Violin Section/susVib/VlnEns_susVib_{n}_v2.wav', n) for n in ('E4', 'G4', 'B4', 'D5')],
    ]),
    'trem': (5.5, -20, [
        *[(f'{S}/Cello Section/trem/trem_{n}_v2_1.wav', n) for n in ('E1', 'G1', 'B2', 'D2', 'F2', 'A2')],
        *[(f'{S}/Viola Section/trem/Violas_trem_{n}_v2_rr1.wav', n) for n in ('D3', 'A3')],
        *[(f'{S}/Violin Section/Trem/VlnEns_Trem_{n}_v2.wav', n) for n in ('E4', 'G4', 'B4')],
    ]),
    'spic': (0.9, -16, [
        *[(f'{S}/Cello Section/spic/spic_{n}_v2_RR1.wav', n) for n in ('E1', 'G1', 'B1', 'D2', 'F2', 'A2')],
        (f'{S}/Viola Section/spic/Violas_spic_D3_v2_rr1.wav', 'D3'), (f'{S}/Viola Section/spic/Violas_spic_A3_v2_rr1.wav', 'A3'),
        (f'{S}/Violin Section/Spic/VlnEns_Spic_E4_v2_rr1.wav', 'E4'),
    ]),
    'horn': (6.0, -19, [
        *[(f'Brass/F Horn/sus/MOHorn_sus_{n}_v2_1.wav', n) for n in ('G1', 'A#1', 'D2', 'F2', 'A2', 'C3')],
        ('Brass/F Horn/sus/MOHorn_sus_D4_v1_1.wav', 'D4'), ('Brass/F Horn/sus/MOHorn_sus_F4_v1_1.wav', 'F4'),
    ]),
    'lowbr': (5.5, -19, [
        *[(f'Brass/Tuba/sus/Tuba3_sus_{n}_v2_rr1_Mid.wav', n) for n in ('F1', 'A#1', 'D2')],
        *[(f'Brass/Tenor Trombone/sus/tenortbn_sus_{n}_v2_1.wav', n) for n in ('F2', 'C3')],
    ]),
    'tpt': (5.0, -19, [(f'Brass/Trumpet/sus/Sum_SHTrumpet_sus_{n}_v3_rr1.wav', n) for n in ('G3', 'A#3', 'D4', 'F4', 'A4', 'C5')]),
    'ney': (4.5, -20, [(f'Woodwinds/Flute/susNV/LDFlute_susNV_{n}.wav', n.split('_')[0]) for n in ('E3_v1_1', 'A3_v1_1', 'C4_v1_1', 'E4_v1_1', 'A4_v1_1', 'C5_v2_1', 'E5_v2_1')]),
    'harp': (3.8, -17, [(f'{S}/Harp/KSHarp_{n}_mf.wav', n) for n in ('D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5')]),
}
# per-instrument ffmpeg colour (ney: the flute darkened and breathy, low end thinned like a reed flute)
COLOUR = {
    'ney': 'highpass=f=260,equalizer=f=1400:t=q:w=1.2:g=-3,equalizer=f=5200:t=q:w=1.5:g=4,lowpass=f=9500',
    'str': 'highpass=f=35', 'trem': 'highpass=f=40', 'spic': 'highpass=f=40',
    'horn': 'highpass=f=45', 'lowbr': 'highpass=f=30', 'tpt': 'highpass=f=120', 'harp': 'highpass=f=40',
}


def build_pitched():
    for inst, (sec, tgt, rows) in PITCHED.items():
        out = []
        t0, dur = (0.04, 0.15) if inst == 'spic' else (0.04, 0.35) if inst == 'harp' else (0.5, 0.35)
        audio = [trim(dec(VSCO / rel, af=COLOUR.get(inst))) for rel, _ in rows]
        ests = [hz_midi(f0(x, t0, dur)) for x in audio]
        # VSCO's octave numbering differs per instrument: one octave convention per source family
        # (majority vote of the pitch estimates), so a single odd estimate cannot skew a note
        fam_off: dict[str, list[int]] = {}
        for (rel, note), est in zip(rows, ests):
            fam_off.setdefault(rel.split('/')[1], []).append(int(round((est - name_midi(note)) / 12)) * 12)
        for (rel, note), x, est in zip(rows, audio, ests):
            vals = fam_off[rel.split('/')[1]]
            midi = name_midi(note) + max(set(vals), key=vals.count)
            d = est - midi
            if round(d / 12) and abs(d - 12 * round(d / 12)) < 0.6:  # a mislabelled octave (the estimate sits exactly on it)
                midi += 12 * round(d / 12)
            if abs(est - midi) > 0.6:
                print(f'    ! {inst} {note}: estimate {est:.2f} vs {midi} (kept the name)')
            x = cap(x, sec, fo=0.08 if inst == 'spic' else 0.4)
            x = norm_rms(x, tgt, 0.02 if inst in ('spic', 'harp') else 0.4, 0.4 if inst == 'spic' else 2.5)
            fname = f'orch/{inst}/{inst}_{midi}.mp3'
            assert fname not in PROV, fname
            enc(x, fname, [f'VSCO-2-CE:{rel}'], ['vsco'], '96k' if inst in ('str', 'trem', 'horn', 'lowbr', 'tpt') else '80k')
            L = len(x) / SR
            row = dict(midi=midi, file=fname, len=round(L, 3))
            if inst not in ('spic', 'harp'):
                row.update(ls=round(min(1.0, L * 0.3), 3), le=round(L - 0.5, 3))
            out.append(row)
        out.sort(key=lambda r: r['midi'])
        ORCH_TABLE[inst] = out
        print(f'  {inst}: {[r["midi"] for r in out]}')


def build_choir():
    takes = {'choirA': 'fs_763909.mp3', 'choirU': 'fs_763913.mp3'}
    for inst, fn in takes.items():
        src = CHOIR / fn
        x = trim(dec(src, af='highpass=f=90'))
        base = hz_midi(f0(x, 1.0, 1.0))
        # crowd pitch: keep the nearest F (the takes are sung "near concert F")
        print(f'    {inst}: sung at midi {base:.2f}')
        m0 = int(round(base))
        rows = []
        for st in (-5, -3, -1, 2, 4, 7):
            tgt = m0 + st
            ratio = 2 ** ((tgt - base) / 12)
            y = trim(dec(src, af=f'highpass=f=90,rubberband=pitch={ratio:.5f}:formant=preserved:pitchq=quality'))
            y = cap(y, 7.0, fo=0.8)
            y = norm_rms(y, -20, 0.6, 3.0)
            fname = f'orch/{inst}/{inst}_{tgt}.mp3'
            enc(y, fname, [f'freesound:{fn[3:-4]} (ShangusBurger, CC0)'], ['choir'], '96k')
            L = len(y) / SR
            rows.append(dict(midi=tgt, file=fname, len=round(L, 3), ls=1.0, le=round(L - 0.9, 3)))
        ORCH_TABLE[inst] = rows
        print(f'  {inst}: {[r["midi"] for r in rows]}')


def build_perc():
    E = 'VSCO 1 Percussion/drums/other/ethnic/giant'
    B = 'VSCO 1 Percussion/drums/bass'
    MS = 'Membranophones/Struck Membranophones'
    IS = 'Idiophones/Struck Idiophones'

    def put(pid: str, x: np.ndarray, srcs: list[str], lic: list[str], pk: float = -1.0):
        i = len(PERC_TABLE.setdefault(pid, []))
        fname = f'orch/perc/{pid}_{i + 1}.mp3'
        enc(norm_peak(x, pk), fname, srcs, lic, '96k')
        PERC_TABLE[pid].append(fname)

    # taiko: the giant ethnic drum (mallet / hand) slowed a touch for size, a lowpassed concert bass drum under it
    for mal, bd, rate in ((f'{E}/mallet/EthnicLargeMallet_hit_ff_1.wav', f'{B}/bdrum_fff_1.wav', 0.9), (f'{E}/mallet/EthnicLargeMallet_hit_ff_2.wav', f'{B}/bdrum3_fff_1.wav', 0.86), (f'{E}/hand/EthnicLargeHand_hit_ff_1.wav', f'{B}/bdrum_fff_1.wav', 0.93)):
        a = resample(trim(dec(VSCO / mal)), rate)
        b = lowpass(resample(trim(dec(VSCO / bd)), 0.94), 260)
        x = cap(mix((norm_peak(a), 1.0, 0), (norm_peak(b), 0.7, 0.004)), 3.6, fo=1.2)
        put('taiko', x, [f'VSCO-2-CE:{mal}', f'VSCO-2-CE:{bd}'], ['vsco'])
    put('taikoRim', cap(trim(dec(VSCO / f'{E}/EthnicLargeStick_rimshot_1.wav')), 1.2, fo=0.4), [f'VSCO-2-CE:{E}/EthnicLargeStick_rimshot_1.wav'], ['vsco'], -3)
    for t in ('Timpani1_Hit_v3_rr1_Sum', 'Timpani2_Hit_v4_rr1_Sum', 'Timpani3_Hit_v4_rr1_Sum', 'Timpani4_Hit_v4_rr1_Sum', 'Timpani5_Hit_v4_rr1_Sum'):
        put('timp', cap(trim(dec(VSCO / f'Percussion/Timpani/{t}.wav')), 4.0, fo=1.4), [f'VSCO-2-CE:Percussion/Timpani/{t}.wav'], ['vsco'])
    put('timpRoll', cap(trim(dec(VSCO / 'Percussion/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav')), 5.0, fo=1.0), ['VSCO-2-CE:Percussion/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav'], ['vsco'])
    # darbuka: sort the five strokes by brightness: the darkest is the doum, the rest teks / kas
    strokes = []
    for i in range(1, 6):
        rel = f'{MS}/Darbuka/Darbuka_{i}_hit_vl2_rr1.wav'
        x = cap(trim(dec(VCSL / rel)), 1.0, fo=0.3)
        sp = np.abs(np.fft.rfft(x[: 8192], 8192))
        cen = float(np.sum(sp * np.arange(len(sp))) / (np.sum(sp) + 1e-9)) * SR / 8192
        strokes.append((cen, rel, x))
    strokes.sort(key=lambda s: s[0])
    print('    darbuka centroids', [int(s[0]) for s in strokes])
    put('dum', strokes[0][2], [f'VCSL:{strokes[0][1]}'], ['vcsl'])
    rel2 = strokes[0][1].replace('vl2_rr1', 'vl1_rr2')
    put('dum', cap(trim(dec(VCSL / rel2)), 1.0, fo=0.3), [f'VCSL:{rel2}'], ['vcsl'], -3)
    for cen, rel, x in strokes[2:]:
        put('tek', x, [f'VCSL:{rel}'], ['vcsl'], -2)
    put('ka', strokes[1][2], [f'VCSL:{strokes[1][1]}'], ['vcsl'], -3)
    for f in ('HDrumL_Hit_v3_rr1_Sum', 'HDrumL_Hit_v3_rr2_Sum'):
        put('frame', cap(trim(dec(VCSL / f'{MS}/Frame Drum/{f}.wav')), 1.6, fo=0.5), [f'VCSL:{MS}/Frame Drum/{f}.wav'], ['vcsl'])
    for f in ('HDrumS_Hit_v3_rr1_Sum', 'HDrumS_HitMuted_v3_rr1_Sum', 'HDrumL_Hand_rr1_Sum'):
        put('frameHi', cap(trim(dec(VCSL / f'{MS}/Frame Drum/{f}.wav')), 1.0, fo=0.3), [f'VCSL:{MS}/Frame Drum/{f}.wav'], ['vcsl'], -3)
    for f in ('Tamb1_Hit_v2_rr1_Mid', 'Tamb1_Hit_v1_rr1_Mid', 'Tamb1_Shake_rr1_Mid'):
        put('riq', cap(trim(dec(VCSL / f'{IS}/Tambourine 1/{f}.wav', af='highpass=f=400')), 1.0, fo=0.3), [f'VCSL:{IS}/Tambourine 1/{f}.wav'], ['vcsl'], -4)
    put('fcym', cap(trim(dec(VCSL / f'{IS}/Finger Cymbals/Fing_Cymb.wav')), 3.0, fo=1.0), [f'VCSL:{IS}/Finger Cymbals/Fing_Cymb.wav'], ['vcsl'], -4)
    put('gong', cap(trim(dec(VCSL / f'{IS}/Gong 1/gong_fff.wav')), 7.5, fo=2.5), [f'VCSL:{IS}/Gong 1/gong_fff.wav'], ['vcsl'])
    put('crash', cap(trim(dec(VCSL / f'{IS}/Suspended Cymbal 1/susCymb1_hit_fff1.wav')), 5.0, fo=2.0), [f'VCSL:{IS}/Suspended Cymbal 1/susCymb1_hit_fff1.wav'], ['vcsl'], -2)
    for f, L in (('susCymb1_cresc_4s', 4.6), ('susCymb1_cresc_2s', 2.6)):
        x = dec(VCSL / f'{IS}/Suspended Cymbal 1/{f}.wav')
        a = np.nonzero(np.abs(x) > np.max(np.abs(x)) * db(-60))[0][0]
        put('swell', fade(x[a: a + int(L * SR)], fi=0.05, fo=0.05), [f'VCSL:{IS}/Suspended Cymbal 1/{f}.wav'], ['vcsl'], -3)
    print('  perc:', {k: len(v) for k, v in PERC_TABLE.items()})


# ----------------------------------------------------------------------------- voice
VO_TABLE: dict[str, list[str]] = {}
VO_TEXT: dict[str, str] = {}
IR_ROOM = None
IR_HALL = None


def put_vo(key: str, x: np.ndarray, srcs: list[str], lic: list[str], text: str | None = None):
    i = len(VO_TABLE.setdefault(key, []))
    fname = f'vo/{key.replace(":", "_")}_{i + 1}.mp3'
    enc(x, fname, srcs, lic, '80k')
    VO_TABLE[key].append(fname)
    if text:
        VO_TEXT[key] = text


def sundown(x: np.ndarray, semis: float = -3.0, sub: float = 0.22, drive: float = 2.2, wet: float = 0.14, slap: float = 0.16) -> np.ndarray:
    """the skeletal revenant: deeper and bigger, a gravel octave under it, hot and compressed, slapback"""
    ratio = 2 ** (semis / 12)
    main = proc(x, f'rubberband=pitch={ratio:.4f}:formant=shifted:pitchq=quality,highpass=f=70,equalizer=f=220:t=q:w=1:g=2,equalizer=f=2600:t=q:w=1.2:g=4,equalizer=f=7000:t=q:w=1:g=-3')
    low = proc(x, 'rubberband=pitch=0.5:formant=preserved,lowpass=f=900')
    n = min(len(main), len(low))
    y = main[:n] + low[:n] * sub
    y = sat(norm_peak(y, -3), drive)
    y = compress(y, -16, 4, 0.002, 0.08, 3)
    y = mix((y, 1.0, 0), (lowpass(y, 2500), slap, 0.095))
    y = reverb(y, IR_ROOM, wet)
    return norm_rms(fade(trim(y, -55), fo=0.08), -15, 0, 3, -1.0)


def whisperize(x: np.ndarray, n: int = 1024, hop: int = 256, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    win = np.hanning(n).astype(np.float32)
    pad = np.concatenate([np.zeros(n, np.float32), x, np.zeros(n, np.float32)])
    out = np.zeros(len(pad) + n, np.float32)
    wsum = np.zeros(len(pad) + n, np.float32)
    for i in range(0, len(pad) - n, hop):
        X = np.fft.rfft(pad[i: i + n] * win)
        Y = np.abs(X) * np.exp(1j * rng.uniform(-np.pi, np.pi, len(X)))
        out[i: i + n] += np.fft.irfft(Y).astype(np.float32) * win
        wsum[i: i + n] += win ** 2
    out = out / np.maximum(wsum, 1e-3)
    return out[n: n + len(x)]


def tts(text: str, length: float = 1.12) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / 'l.wav'
        subprocess.run([PIPER_BIN, '-m', str(PIPER / 'en_US-ljspeech-high.onnx'), '-f', str(wav), '--length-scale', str(length), '--noise-scale', '0.5', '--sentence-silence', '0.15'], input=text.encode(), check=True, capture_output=True)
        return trim(dec(wav), -50)


def serket(text: str, seed: int) -> np.ndarray:
    """Serket through the little scorpion: a many-mouthed whisper, a faint divine undertone, a long temple tail"""
    v = tts(text)
    w = proc(whisperize(v, seed=seed), 'highpass=f=320,equalizer=f=3200:t=q:w=1:g=3,equalizer=f=7500:t=q:w=1:g=4,lowpass=f=11000')
    w = norm_peak(w, -3)
    c1 = proc(w, 'rubberband=pitch=0.97:formant=preserved')
    c2 = proc(w, 'rubberband=pitch=1.03:formant=preserved')
    under = lowpass(proc(v, 'rubberband=pitch=0.5:formant=preserved'), 700)
    y = mix((w, 1.0, 0), (c1, 0.45, 0.019), (c2, 0.4, 0.033), (norm_peak(under, -3), 0.09, 0.01))
    y = compress(y, -20, 3, 0.003, 0.12, 2)
    y = reverb(y, IR_HALL, 0.42)
    return norm_rms(fade(trim(y, -60), fo=0.4), -21, 0, 4, -2.0)


# Serket's whispered lines (story / tutorial / combat can play any of these as 'serket:<key>')
SERKET_LINES = {
    'rise': 'Rise, my little hunter.',
    'wake': 'Wake... and devour.',
    'ultname': 'Serket... ascendant.',
    'strike': 'Strike.',
    'again': 'Again.',
    'good': 'Good. Very good.',
    'behind': 'Behind you.',
    'jump': 'Jump.',
    'hold': 'Hold... and fly.',
    'flip': 'Now. Turn in the air.',
    'balance': 'Mind your balance.',
    'getup': 'Get up, child.',
    'heart': 'Guard your heart.',
    'shoot': 'Let them hear your gun.',
    'domain': 'Welcome to my domain.',
    'trapped': 'There is no way out, little one.',
    'kill': 'Kill it.',
    'hunger': 'I hunger.',
    'mine': 'They are mine.',
    'night': 'The night is hungry.',
    'boss': 'This one is old. Be careful.',
    'well': 'You have done well.',
}


def build_voice():
    global IR_ROOM, IR_HALL
    IR_ROOM = room_ir(0.55, 3.0, 11, 0.55)
    IR_HALL = room_ir(3.2, 2.2, 23, 0.4)
    OC = lambda n: META / f'{n}.ogg'  # noqa: E731
    src = lambda n: f'OculusAudioPack01:{n}.ogg'  # noqa: E731

    # skill shouts: the male efforts and the clipped front of the screams ("hah!", "hyah!", "rrah!")
    efforts = [(dec(OC('VOXEfrt_Male01Effort_OS_01')), 'VOXEfrt_Male01Effort_OS_01'), (dec(OC('VOXEfrt_Male02Effort_OS_01')), 'VOXEfrt_Male02Effort_OS_01')]
    for i in (1, 2, 3):
        n = f'VOXScrm_MaleScream_OS_0{i}'
        s = trim(dec(OC(n)))
        efforts.append((fade(s[: int(0.42 * SR)], fo=0.12), n))
    variants = [(-3.0, 0.22), (-4.0, 0.28), (-2.0, 0.18)]
    k = 0
    for x, n in efforts:
        for semis, sub in variants[: 2 if k < 2 else 1]:
            put_vo('skill', sundown(trim(x), semis, sub), [src(n)], ['meta'])
        k += 1
    # light efforts for jumps / tricks: the efforts higher and drier, laughs for a landed trick
    for x, n in efforts[:2]:
        put_vo('jump', sundown(trim(x), -1.5, 0.12, 1.6, 0.08, 0.1), [src(n)], ['meta'])
    for n in ('VOXLaff_Male02Laugh_OS_01', 'VOXLaff_Male02Laugh_OS_03', 'VOXLaff_Male01Laugh_OS_01'):
        x = trim(dec(OC(n)))
        put_vo('trick', sundown(fade(x[: int(0.95 * SR)], fo=0.25), -3.0, 0.2, 2.0, 0.12, 0.2), [src(n)], ['meta'])
    for n in ('VOXLaff_EvilLaugh_OS_01', 'VOXLaff_EvilLaugh_OS_02'):
        put_vo('laugh', sundown(trim(dec(OC(n))), -2.0, 0.25, 2.0, 0.16, 0.2), [src(n)], ['meta'])
    # hurt
    for who in ('Male01', 'Male02'):
        for i in (1, 2, 3):
            n = f'VOXMale_{who}Hurt_OS_0{i}'
            put_vo('hurt', sundown(trim(dec(OC(n))), -3.0, 0.2, 2.4, 0.1, 0.08), [src(n)], ['meta'])
    for n in ('VOXMale_Male01DeathScream_OS_01', 'VOXMale_Male02DeathScream_OS_01'):
        put_vo('death', sundown(trim(dec(OC(n))), -3.5, 0.3, 2.2, 0.2, 0.1), [src(n)], ['meta'])
    # the ultimate: a full battle roar (the screams, deeper, with a growl octave and a big tail), then his line
    for i in (2, 3):
        n = f'VOXScrm_MaleScream_OS_0{i}'
        x = sundown(trim(dec(OC(n))), -4.5, 0.35, 2.6, 0.26, 0.2)
        put_vo('ult', x, [src(n)], ['meta'])
    # spoken words he really says (a real voice actor, Kenney, slowed and growled into his register)
    KW = {'prepare': ('prepare_yourself', 'Prepare yourself.'), 'sudden': ('sudden_death', 'Sudden death.'), 'fight': ('fight', 'Fight.'), 'killit': ('kill_it', 'Kill it.'), 'ready': ('ready', 'Ready.')}
    for key, (fn, text) in KW.items():
        x = trim(dec(KENNEY / f'{fn}.ogg'))
        put_vo(f'line:{key}', sundown(x, -2.5, 0.2, 1.8, 0.14, 0.16), [f'Kenney Voiceover Pack Fighter:{fn}.ogg'], ['kenney'], text)
    # Serket
    for j, (key, text) in enumerate(SERKET_LINES.items()):
        put_vo(f'serket:{key}', serket(text, 100 + j), [f'piper:ljspeech:"{text}"'], ['piper'], text)
    # wordless Serket texture for any line without a recording: the creepy whispers cut into breaths
    wsrc = 'VOXWhsp_WhispersCreepy_OS_01'
    parts = splits(trim(dec(OC(wsrc))), -30, 0.1, 0.35)
    for p in parts[:4]:
        y = proc(p, 'highpass=f=300,equalizer=f=6000:t=q:w=1:g=3')
        y = reverb(mix((y, 1, 0), (proc(y, 'rubberband=pitch=0.96:formant=preserved'), 0.4, 0.023)), IR_HALL, 0.45)
        put_vo('serket:breath', norm_rms(fade(trim(y, -60), fo=0.3), -22, 0, 4, -2), [src(wsrc)], ['meta'])
    # Serket hurt / roar (her beast form): the female effort, lowered and doubled
    for n in ('VOXEfrt_Female01Effort_OS_01', 'VOXEfrt_Female02Effort_OS_01'):
        x = trim(dec(OC(n)))
        a = proc(x, 'rubberband=pitch=0.8:formant=shifted,highpass=f=120')
        b = proc(x, 'rubberband=pitch=0.4:formant=preserved,lowpass=f=1200')
        y = reverb(sat(norm_peak(mix((a, 1, 0), (b, 0.35, 0.0)), -3), 1.8), IR_HALL, 0.35)
        put_vo('serket:roar', norm_rms(fade(trim(y, -60), fo=0.3), -16, 0, 3, -1), [src(n)], ['meta'])
    print('  voice:', {k: len(v) for k, v in VO_TABLE.items()})


# ----------------------------------------------------------------------------- manifest
def write_manifest():
    prev = {}
    if PROV_FILE.exists():
        prev = json.loads(PROV_FILE.read_text())
    tables = prev.get('_tables', {})
    if ORCH_TABLE:
        tables['orch'] = ORCH_TABLE
        tables['perc'] = PERC_TABLE
    if VO_TABLE:
        tables['vo'] = VO_TABLE
        tables['vo_text'] = VO_TEXT
    files = prev.get('files', {})
    files.update(PROV)
    PROV_FILE.write_text(json.dumps({'_tables': tables, 'files': files}, indent=1))
    orch, perc, vo, vt = tables.get('orch', {}), tables.get('perc', {}), tables.get('vo', {}), tables.get('vo_text', {})
    L = ['// AUTO-GENERATED by tools/build_orchestra.py - do not edit by hand (re-run the script).',
         '// The orchestral layer of the score and the battle voice set, cut from real recordings:',
         '// VSCO 2 CE + VCSL (CC0), Freesound crowd choir (CC0), Oculus Audio Pack 01 (CC BY 4.0),',
         '// Kenney (CC0) and Piper TTS whispers. See CREDITS.md and tools/orch_provenance.json.',
         '',
         '/** one pitched note (len / loop window ls..le in seconds of the file) */',
         'export interface OrchSample {', '  midi: number;', '  file: string;', '  len: number;', '  ls?: number;', '  le?: number;', '}',
         '']
    L.append('export type OrchInst = ' + ' | '.join(f"'{k}'" for k in orch) + ';')
    L.append('export const ORCH: Record<OrchInst, OrchSample[]> = {')
    for k, rows in orch.items():
        L.append(f'  {k}: [')
        for r in rows:
            extra = f", ls: {r['ls']}, le: {r['le']}" if 'ls' in r else ''
            L.append(f"    {{ midi: {r['midi']}, file: '{r['file']}', len: {r['len']}{extra} }},")
        L.append('  ],')
    L.append('};')
    L.append('')
    L.append('export type PercId = ' + ' | '.join(f"'{k}'" for k in perc) + ';')
    L.append('export const PERC: Record<PercId, string[]> = {')
    for k, fs in perc.items():
        L.append(f'  {k}: [' + ', '.join(f"'{f}'" for f in fs) + '],')
    L.append('};')
    L.append('')
    L.append('/** battle voice takes by key (BattleVoice.ts picks one) */')
    L.append('export const VO: Record<string, string[]> = {')
    for k, fs in vo.items():
        L.append(f"  '{k}': [" + ', '.join(f"'{f}'" for f in fs) + '],')
    L.append('};')
    L.append('/** the words of the spoken takes (for the floating 3D subtitle) */')
    L.append('export const VO_TEXT: Record<string, string> = {')
    for k, t in vt.items():
        L.append(f"  '{k}': {json.dumps(t)},")
    L.append('};')
    L.append('')
    MANIFEST.write_text('\n'.join(L))


def main(argv: list[str]):
    what = set(argv) or {'orch', 'voice'}
    if 'orch' in what:
        print('orchestra')
        build_pitched()
        build_choir()
        build_perc()
    if 'voice' in what:
        print('voice')
        build_voice()
    write_manifest()
    tot = sum((OUT / f).stat().st_size for f in PROV)
    print(f'wrote {len(PROV)} files, {tot / 1e6:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1:])
