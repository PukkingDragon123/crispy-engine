#!/usr/bin/env python3
"""
dustUP audio build
==================

Turns *real* recordings (CC0 field/foley/firearm recordings + the CC BY 4.0
Oculus Audio Pack) into every sound effect, ambience loop and instrument sample
the game uses. Nothing here is synthesized: every output is cut, layered,
filtered, pitched, compressed or reverberated from recorded audio.

Usage
-----
    python3 tools/build_audio.py              # build everything
    python3 tools/build_audio.py rev_ boss_   # rebuild ids starting with these prefixes
    python3 tools/build_audio.py --list       # list recipes and their sources
    python3 tools/build_audio.py --inst       # instruments only

Requires: python3 + numpy, ffmpeg with libmp3lame.

Outputs
-------
    public/audio/sfx/*.mp3          one-shots, mono 44.1 kHz ~96 kbps
    public/audio/amb/*.mp3          loops, pre-crossfaded seamless (stereo ~112 kbps / mono 96)
    public/audio/inst/{steel,nylon,piano}/*.mp3   instrument notes for Music.ts
    tools/audio_provenance.json    every output file -> exact source files used
    src/game/audio/manifest.ts      GENERATED SoundDef table + instrument tables

Sources (clone them, or point the env vars at existing copies)
--------------------------------------------------------------
DUSTUP_FFSL     Free Firearm Sound Library (Still North Media / Ben Jaszczak) - CC0
                git clone --filter=blob:none --no-checkout https://github.com/buddingmonkey/FreeFirearmsSFXLibrary
                then `git checkout HEAD -- "Prepared SFX/<gun>" "Master Tracks/<gun>/<file>"` for the files listed
                by --list (the full repo is 3.4 GB).
DUSTUP_META     Meta Open Sound (instruments CC0, Oculus Audio Pack 01 CC BY 4.0)
                https://github.com/facebookincubator/Meta-open-sound
DUSTUP_OGSI     Open Game SFX Index (Kenney + OpenGameArt CC0 mirrors)
                https://github.com/Mcamento8/open-game-sfx-index
DUSTUP_ATOM     AtomCut library (OpenGameArt CC0 packs, .m4a)
                https://github.com/novincode/atomcut-library  (blobless; checkout packs/<pack> as needed)
DUSTUP_OMARCHY  omarchy-ambient (CC0 Freesound field recordings by felix.blume, Sheyvan, ...)
                https://github.com/funcoder/omarchy-ambient
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

SR = 44100
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'public' / 'audio'
MANIFEST_TS = REPO / 'src' / 'game' / 'audio' / 'manifest.ts'

SRC = {
    'ffsl': os.environ.get('DUSTUP_FFSL', '/home/user/sfxsrc/ffsl'),
    'meta': os.environ.get('DUSTUP_META', '/home/user/facebookincubator/meta-open-sound'),
    'ogsi': os.environ.get('DUSTUP_OGSI', '/home/user/mcamento8/open-game-sfx-index'),
    'atom': os.environ.get('DUSTUP_ATOM', '/home/user/sfxsrc/atomcut-library'),
    'omarchy': os.environ.get('DUSTUP_OMARCHY', '/home/user/sfxsrc/omarchy-ambient'),
}
# shortcuts into source trees: key -> (source root key, sub folder)
ROOTS = {
    'F': ('ffsl', ''),
    'OC': ('meta', 'corpora/oculus-audio-pack/ogg'),
    'IN': ('meta', 'systems/instruments'),
    'K': ('ogsi', 'audio'),  # Kenney + OGA packs in the index (ogg / wav / flac)
    'A': ('atom', 'packs'),  # OGA packs (m4a)
    'OM': ('omarchy', 'sounds'),
}

LICENSE_OF = {
    'F': 'CC0 - Free Firearm Sound Library (Still North Media)',
    'OC': 'CC BY 4.0 - Oculus Audio Pack 01 (Oculus VR, LLC)',
    'IN': 'CC0 - Meta Open Sound instruments',
    'K': 'CC0 - Kenney / OpenGameArt (via open-game-sfx-index)',
    'A': 'CC0 - OpenGameArt packs (via atomcut-library)',
    'OM': 'CC0 - Freesound field recordings (via omarchy-ambient)',
}

# ---------------------------------------------------------------------------
# provenance tracking
# ---------------------------------------------------------------------------
_cur_sources: list[str] = []
PROV: dict[str, dict] = {}


def src_path(root: str, rel: str) -> str:
    key, sub = ROOTS[root]
    p = Path(SRC[key]) / sub / rel
    return str(p)


# ---------------------------------------------------------------------------
# ffmpeg I/O
# ---------------------------------------------------------------------------
_cache: dict[tuple, np.ndarray] = {}


def load(root: str, rel: str, start: float | None = None, dur: float | None = None, af: str | None = None, ch: int = 1) -> np.ndarray:
    """Decode a source file (optionally a time window) to float32 @ SR. ch=1 mono, ch=2 stereo."""
    tag = f'{root}:{rel}'
    if tag not in _cur_sources:
        _cur_sources.append(tag)
    key = (root, rel, start, dur, af, ch)
    if key in _cache:
        return _cache[key].copy()
    path = src_path(root, rel)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    cmd = ['ffmpeg', '-v', 'error', '-nostdin']
    if start is not None:
        cmd += ['-ss', f'{max(0.0, start):.4f}']
    if dur is not None:
        cmd += ['-t', f'{dur:.4f}']
    cmd += ['-i', path]
    if af:
        cmd += ['-af', af]
    cmd += ['-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f'ffmpeg decode failed for {path}: {r.stderr.decode()[:400]}')
    x = np.frombuffer(r.stdout, dtype=np.float32).copy()
    if ch == 2:
        x = x.reshape(-1, 2)
    x = np.nan_to_num(x)
    _cache[key] = x
    return x.copy()


def fx(x: np.ndarray, af: str) -> np.ndarray:
    """Run an ffmpeg audio filter chain over an array (mono or stereo)."""
    ch = 2 if x.ndim == 2 else 1
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-af', af, '-ar', str(SR), '-ac', str(ch), '-f', 'f32le', '-']
    r = subprocess.run(cmd, input=np.ascontiguousarray(x, dtype=np.float32).tobytes(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f'ffmpeg fx failed ({af}): {r.stderr.decode()[:400]}')
    y = np.frombuffer(r.stdout, dtype=np.float32).copy()
    if ch == 2:
        y = y.reshape(-1, 2)
    return np.nan_to_num(y)


def speed(x: np.ndarray, ratio: float) -> np.ndarray:
    """Tape-style speed change (pitch + duration) with a proper resampler."""
    if abs(ratio - 1) < 1e-4:
        return x.copy()
    return fx(x, f'asetrate={SR * ratio:.3f},aresample={SR}:resampler=soxr' if _has_soxr() else f'asetrate={SR * ratio:.3f},aresample={SR}')


_SOXR = None


def _has_soxr() -> bool:
    global _SOXR
    if _SOXR is None:
        r = subprocess.run(['ffmpeg', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.01', '-af', 'aresample=22050:resampler=soxr', '-f', 'null', '-'], capture_output=True)
        _SOXR = r.returncode == 0
    return _SOXR


def save(x: np.ndarray, rel: str, kbps: int | None = None) -> str:
    """Write mp3 to public/audio/<rel>. Mono arrays -> mono mp3, stereo -> stereo."""
    out = OUT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    ch = 2 if x.ndim == 2 else 1
    if kbps is None:
        kbps = 96 if ch == 2 else 96
    x = np.clip(np.nan_to_num(x), -1.0, 1.0).astype(np.float32)
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-af', 'highpass=f=18',
           '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-ar', str(SR), str(out)]
    # MP3 can overshoot the source peak (more so for quiet, transient-rich material):
    # verify the decoded file and back off until it no longer exceeds -0.1 dBFS.
    for attempt in range(6):
        r = subprocess.run(cmd, input=np.ascontiguousarray(x).tobytes(), capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f'mp3 encode failed {out}: {r.stderr.decode()[:300]}')
        dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'f32le', '-'], capture_output=True).stdout
        pk = float(np.abs(np.frombuffer(dec, dtype=np.float32)).max()) if dec else 0.0
        if pk <= db2a(-0.1):
            break
        x = (x * db2a(-max(0.4, a2db(pk) + 0.5))).astype(np.float32)
    return rel


# ---------------------------------------------------------------------------
# DSP helpers
# ---------------------------------------------------------------------------
def db2a(d: float) -> float:
    return 10 ** (d / 20)


def a2db(a: float) -> float:
    return 20 * np.log10(max(a, 1e-12))


def mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1) if x.ndim == 2 else x


def stereo(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


def sec(n: int) -> float:
    return n / SR


def smp(t: float) -> int:
    return int(round(t * SR))


def peak(x: np.ndarray) -> float:
    return float(np.abs(x).max()) if len(x) else 0.0


def loudness(x: np.ndarray, win: float = 0.05) -> float:
    """max short-term RMS (dB) over `win` windows - a decent one-shot loudness proxy"""
    m = mono(x)
    w = max(1, smp(win))
    n = len(m) // w
    if n == 0:
        return a2db(np.sqrt(np.mean(m ** 2)) if len(m) else 0)
    e = np.sqrt(np.mean(m[: n * w].reshape(n, w) ** 2, axis=1))
    return a2db(float(e.max()))


def rms_db(x: np.ndarray) -> float:
    m = mono(x)
    return a2db(float(np.sqrt(np.mean(m ** 2)))) if len(m) else -120.0


def gain(x: np.ndarray, d: float) -> np.ndarray:
    return x * db2a(d)


def limit(x: np.ndarray, ceiling_db: float = -1.0) -> np.ndarray:
    """soft-knee peak limiter (tanh above the knee)"""
    c = db2a(ceiling_db)
    knee = c * 0.7
    y = x.copy()
    a = np.abs(y)
    over = a > knee
    if over.any():
        s = np.sign(y[over])
        y[over] = s * (knee + (c - knee) * np.tanh((a[over] - knee) / (c - knee)))
    return y


def norm_peak(x: np.ndarray, target_db: float = -1.0) -> np.ndarray:
    p = peak(x)
    return x * (db2a(target_db) / p) if p > 0 else x


def norm_loud(x: np.ndarray, target_db: float, ceiling_db: float = -1.0) -> np.ndarray:
    l = loudness(x)
    y = x * db2a(target_db - l)
    return limit(y, ceiling_db)


def fade_in(x: np.ndarray, t: float) -> np.ndarray:
    n = min(len(x), smp(t))
    if n <= 1:
        return x
    y = x.copy()
    r = np.linspace(0, 1, n) ** 1.5
    if y.ndim == 2:
        r = r[:, None]
    y[:n] *= r
    return y


def fade_out(x: np.ndarray, t: float, curve: float = 2.0) -> np.ndarray:
    n = min(len(x), smp(t))
    if n <= 1:
        return x
    y = x.copy()
    r = np.linspace(1, 0, n) ** curve
    if y.ndim == 2:
        r = r[:, None]
    y[-n:] *= r
    return y


def cut(x: np.ndarray, a: float, b: float | None = None) -> np.ndarray:
    i = max(0, smp(a))
    j = len(x) if b is None else min(len(x), smp(b))
    return x[i:j].copy()


def env_db(x: np.ndarray, hop: float = 0.005) -> np.ndarray:
    m = mono(x)
    h = max(1, smp(hop))
    n = len(m) // h
    if n == 0:
        return np.array([-120.0])
    e = np.sqrt(np.mean(m[: n * h].reshape(n, h) ** 2, axis=1) + 1e-14)
    return 20 * np.log10(e)


def trim(x: np.ndarray, lead_db: float = -42, tail_db: float = -60, pre: float = 0.004, post: float = 0.02) -> np.ndarray:
    """Trim leading silence to a < 5 ms pre-roll before the onset (first 1 ms RMS frame above
    lead_db+8 relative to the loudest frame - robust against isolated noise ticks) and trailing
    samples below tail_db relative to the sample peak."""
    m = np.abs(mono(x))
    p = m.max() if len(m) else 0
    if p <= 0:
        return x
    e = env_db(x, 0.001)
    above = np.where(e > e.max() + lead_db + 8)[0]
    if not len(above):
        return x
    i = max(0, smp(above[0] * 0.001) - smp(pre))
    tail = np.where(m > p * db2a(tail_db))[0]
    j = min(len(x), tail[-1] + smp(post)) if len(tail) else len(x)
    return x[i:j].copy()


def pad(x: np.ndarray, t: float) -> np.ndarray:
    z = np.zeros((smp(t),) + x.shape[1:], dtype=np.float32)
    return np.concatenate([x, z])


def mix(*layers) -> np.ndarray:
    """mix((arr, offset_sec, gain_db), ...) -> array long enough for all layers"""
    st = any(l[0].ndim == 2 for l in layers)
    n = max(smp(l[1]) + len(l[0]) for l in layers)
    out = np.zeros((n, 2) if st else n, dtype=np.float32)
    for arr, off, g in layers:
        a = stereo(arr) if st else arr
        o = smp(off)
        out[o: o + len(a)] += a * db2a(g)
    return out


def onsets(x: np.ndarray, n_max: int = 8, min_gap: float = 0.15, floor_db: float = -45, rise_db: float = 9) -> list[float]:
    """Energy-rise transient detector. Returns onset times (sec) sorted by time,
    strongest n_max kept. floor_db relative to file peak."""
    e = env_db(x, 0.004)
    pk = e.max()
    cand = []
    lb = 6  # 24 ms look-back
    for i in range(lb, len(e) - 1):
        if e[i] < pk + floor_db:
            continue
        prev = e[max(0, i - lb): i].min()
        if e[i] - prev >= rise_db and e[i] >= e[i - 1] and e[i] >= e[i + 1] - 1.5:
            cand.append((e[i] - prev + (e[i] - pk) * 0.5, i))
    cand.sort(reverse=True)
    chosen: list[int] = []
    gap = int(min_gap / 0.004)
    for _, i in cand:
        if all(abs(i - c) > gap for c in chosen):
            chosen.append(i)
        if len(chosen) >= n_max:
            break
    # refine each onset back to where energy first rose near its local max
    out = []
    for i in sorted(chosen):
        j = i
        while j > 0 and e[j - 1] > e[i] - 18 and i - j < 10:
            j -= 1
        out.append(j * 0.004)
    return out


def seg(x: np.ndarray, t: float, pre: float = 0.004, post: float = 0.3, fo: float = 0.05) -> np.ndarray:
    y = cut(x, t - pre, t + post)
    return fade_out(fade_in(y, min(0.002, pre)), min(fo, post * 0.8))


def reverse(x: np.ndarray) -> np.ndarray:
    return x[::-1].copy()


_ir_cache: dict = {}


def reverb(x: np.ndarray, seconds: float = 1.6, decay: float = 3.0, wet_db: float = -10, predelay: float = 0.015, lp: int = 6000, hp: int = 180, seed: int = 7) -> np.ndarray:
    """Convolution reverb with a decaying-noise impulse (processing of the recording, not synthesis
    of the sound itself). Returns dry + wet, extended by the tail."""
    key = (seconds, decay, predelay, lp, hp, seed)
    if key not in _ir_cache:
        rng = np.random.default_rng(seed)
        n = smp(seconds)
        t = np.linspace(0, 1, n)
        ir = rng.standard_normal(n).astype(np.float32) * np.exp(-decay * t * 2.3).astype(np.float32)
        ir = fx(ir, f'highpass=f={hp},lowpass=f={lp}')
        ir = np.concatenate([np.zeros(smp(predelay), np.float32), ir])
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        _ir_cache[key] = ir
    ir = _ir_cache[key]

    def conv(a: np.ndarray) -> np.ndarray:
        n = len(a) + len(ir) - 1
        nf = 1 << (n - 1).bit_length()
        return np.fft.irfft(np.fft.rfft(a, nf) * np.fft.rfft(ir, nf), nf)[:n].astype(np.float32)

    if x.ndim == 2:
        wet = np.stack([conv(x[:, 0]), conv(x[:, 1])], axis=1)
    else:
        wet = conv(x)
    dry = np.zeros_like(wet)
    dry[: len(x)] = x
    return dry + wet * db2a(wet_db)


def glide(x: np.ndarray, r0: float, r1: float, curve: float = 1.0) -> np.ndarray:
    """time-varying playback rate (pitch glide) from r0 to r1 across the output"""
    m = mono(x)
    if max(r0, r1) > 1.0:
        m = fx(m, f'lowpass=f={int(0.45 * SR / max(r0, r1))}')
    # integrate rate over output samples
    approx = int(len(m) / ((r0 + r1) / 2))
    t = np.linspace(0, 1, approx) ** curve
    rate = r0 + (r1 - r0) * t
    pos = np.cumsum(rate)
    pos = pos[pos < len(m) - 1]
    return np.interp(pos, np.arange(len(m)), m).astype(np.float32)


def sat(x: np.ndarray, drive_db: float = 6) -> np.ndarray:
    """gentle tape-ish saturation for punch"""
    d = db2a(drive_db)
    return np.tanh(x * d) / np.tanh(d)


def seamless(x: np.ndarray, length: float, xf: float) -> np.ndarray:
    """Make a seamless loop of `length` sec from x (needs length + xf of material):
    the loop tail is equal-power crossfaded into the head."""
    L, X = smp(length), smp(xf)
    assert len(x) >= L + X, f'need {length + xf}s, have {sec(len(x)):.2f}s'
    y = x[:L].copy()
    t = np.linspace(0, 1, X)
    fi = np.sin(t * np.pi / 2)
    fo = np.cos(t * np.pi / 2)
    if y.ndim == 2:
        fi, fo = fi[:, None], fo[:, None]
    y[:X] = x[:X] * fi + x[L: L + X] * fo
    return y


def finish(x: np.ndarray, loud: float = -14, ceiling: float = -1.0, fo: float = 0.04, lead_db: float = -40, tail_db: float = -58, do_trim: bool = True) -> np.ndarray:
    if do_trim:
        x = trim(x, lead_db=lead_db, tail_db=tail_db)
    x = norm_loud(x, loud, ceiling)
    x = fade_out(x, fo)
    return fade_in(x, 0.0015)


# ---------------------------------------------------------------------------
# recipe registry
# ---------------------------------------------------------------------------
RECIPES: dict[str, dict] = {}


def sound(id: str, bus: str = 'sfx', volume: float = 1.0, pitch: tuple | None = (0.96, 1.04), max: int | None = None,
          cooldown: float | None = None, reverb: float | None = None, ref: float | None = None, folder: str = 'sfx', note: str = ''):
    def deco(fn):
        RECIPES[id] = dict(fn=fn, meta=dict(bus=bus, volume=volume, pitch=pitch, max=max, cooldown=cooldown, reverb=reverb, ref=ref), folder=folder, note=note or (fn.__doc__ or '').strip())
        return fn
    return deco


# convenience source shortcuts -------------------------------------------------
def OC(name: str, **k) -> np.ndarray:  # Oculus Audio Pack 01 (CC BY 4.0)
    return load('OC', name if name.endswith('.ogg') else name + '.ogg', **k)


def KN(rel: str, **k) -> np.ndarray:  # Kenney/OGA via open-game-sfx-index
    return load('K', rel, **k)


def AT(pack: str, f: str, **k) -> np.ndarray:  # atomcut OGA pack file
    return load('A', f'opengameart-{pack}/audio/{f}', **k)


def FF(rel: str, **k) -> np.ndarray:  # Free Firearm Sound Library
    return load('F', rel, **k)


def OM(name: str, **k) -> np.ndarray:
    return load('OM', name, **k)


def first_onset(x: np.ndarray, **kw) -> float:
    """first strong transient; falls back to just before the loudest moment"""
    o = onsets(x, 1, **kw) or onsets(x, 1, floor_db=-50, rise_db=6)
    if o:
        return o[0]
    e = env_db(x, 0.004)
    return max(0.0, int(np.argmax(e)) * 0.004 - 0.01)


def on1(x: np.ndarray, **kw) -> float:
    return first_onset(x, **kw)


def gate(x: np.ndarray, thresh_db: float = -34, floor_db: float = -22, attack: float = 0.002, release: float = 0.05) -> np.ndarray:
    """downward expander: tame the noise floor of raw master tracks before normalizing"""
    e = env_db(x, 0.002)
    pk = e.max()
    g = np.where(e > pk + thresh_db, 1.0, db2a(floor_db)).astype(np.float32)
    # smooth (fast attack / slow release)
    out = np.empty_like(g)
    a_c = np.exp(-0.002 / attack)
    r_c = np.exp(-0.002 / release)
    v = g[0]
    for i, t in enumerate(g):
        c = a_c if t > v else r_c
        v = t + (v - t) * c
        out[i] = v
    gs = np.repeat(out, smp(0.002))
    gs = np.pad(gs, (0, max(0, len(x) - len(gs))), mode='edge')[: len(x)]
    return x * (gs[:, None] if x.ndim == 2 else gs)


# ===========================================================================
# GUNS (Free Firearm Sound Library, CC0)
# ===========================================================================
SW = 'Prepared SFX/Smith & Wesson 642/'
SS = 'Prepared SFX/Ruger Single Six/'
SWM = 'Master Tracks/Smith & Wesson 642/'
SSM = 'Master Tracks/Ruger Single Six/'


def _shots(x: np.ndarray, n: int = 2) -> list[float]:
    return onsets(x, n, min_gap=1.5, floor_db=-20, rise_db=14)


@sound('rev_shot', volume=1.0, pitch=(0.97, 1.03), max=6, reverb=0.12, ref=10)
def rev_shot():
    """Player revolver: real near-field .38 / .22 revolver shot + low thump from the same take + mid-distance desert tail."""
    out = []
    near_sw, mid_sw = FF(SW + 'V_27P.wav'), FF(SW + 'V_22P.wav')
    near_ss, mid_ss = FF(SS + 'S_14P.wav'), FF(SS + 'S_11P.wav')
    for near, mid, body_rate, body_gain in ((near_sw, mid_sw, 0.8, -3), (near_ss, mid_ss, 0.72, -1)):
        tn, tm = _shots(near), _shots(mid)
        for k in range(2):
            shot = seg(near, tn[k % len(tn)], pre=0.002, post=0.55, fo=0.3)
            tail = seg(mid, tm[k % len(tm)], pre=0.0, post=1.6, fo=0.9)
            tail = fx(tail, 'highpass=f=250,lowpass=f=4200')
            thump = fx(speed(shot[: smp(0.25)], body_rate), 'lowpass=f=170,lowpass=f=170')
            thump = fade_out(norm_peak(thump, -1), 0.18)
            crack = fx(shot, 'highpass=f=2500')
            x = mix((shot, 0, 0), (thump, 0.0, body_gain), (crack, 0, -8), (tail, 0.014, -10))
            x = sat(x, 4)
            out.append(finish(x, loud=-7, ceiling=-0.3, fo=0.6))
    return out


@sound('rev_shot_far', volume=0.7, pitch=(0.94, 1.04), max=8, ref=25)
def rev_shot_far():
    """Distant revolver shots (far-distance mic positions)."""
    out = []
    for f in ('V_21.wav', 'V_23.wav'):
        x = FF(SWM + f)
        for t in _shots(x):
            s = seg(x, t, pre=0.003, post=1.4, fo=0.8)
            out.append(finish(fx(s, 'highpass=f=120,lowpass=f=5000'), loud=-15, fo=0.6))
    return out[:3]


@sound('enemy_shot', volume=0.75, pitch=(0.93, 1.06), max=8, reverb=0.08, ref=12)
def enemy_shot():
    """Outlaw pistols: Colt 1911 (.45) near + mid takes, slightly darker than the player's gun."""
    out = []
    for f in ('Prepared SFX/1911/A_34P.wav', 'Prepared SFX/1911/A_42P.wav'):
        x = FF(f)
        for t in _shots(x):
            s = seg(x, t, pre=0.002, post=1.1, fo=0.7)
            out.append(finish(fx(s, 'lowpass=f=6500'), loud=-11, ceiling=-1, fo=0.5))
    return out[:3]


@sound('rifle_shot', volume=0.85, pitch=(0.96, 1.04), max=6, reverb=0.1, ref=14)
def rifle_shot():
    """Winchester Model 1894 lever-action rifle (near transient + mid-distance tail)."""
    near, mid = FF('Prepared SFX/Model 1894/L_23P.wav'), FF('Prepared SFX/Model 1894/L_17P.wav')
    tn, tm = _shots(near), _shots(mid)
    out = []
    for k in range(2):
        s = seg(near, tn[k % len(tn)], post=0.6, fo=0.3)
        tail = fx(seg(mid, tm[k % len(tm)], pre=0.0, post=1.8, fo=1.0), 'highpass=f=200,lowpass=f=4500')
        thump = fade_out(norm_peak(fx(speed(s[: smp(0.25)], 0.75), 'lowpass=f=160'), -1), 0.2)
        out.append(finish(sat(mix((s, 0, 0), (thump, 0, -4), (tail, 0.015, -9)), 3), loud=-8, ceiling=-0.4, fo=0.7))
    return out


@sound('shotgun_shot', volume=0.95, pitch=(0.95, 1.04), max=5, reverb=0.12, ref=14)
def shotgun_shot():
    """12-gauge pump shotguns (Winchester Model 12, Charles Daly) with layered tails."""
    out = []
    for nf, mf in (('Prepared SFX/Model 12/K_22P.wav', 'Prepared SFX/Model 12/K_17P.wav'), ('Prepared SFX/CD/H_21P.wav', 'Prepared SFX/CD/H_16P.wav')):
        near, mid = FF(nf), FF(mf)
        tn, tm = _shots(near), _shots(mid)
        for k in range(2 if 'Model 12' in nf else 1):
            s = seg(near, tn[k % len(tn)], post=0.7, fo=0.35)
            tail = fx(seg(mid, tm[k % len(tm)], pre=0.0, post=1.8, fo=1.0), 'highpass=f=150,lowpass=f=4000')
            thump = fade_out(norm_peak(fx(speed(s[: smp(0.3)], 0.7), 'lowpass=f=150'), -1), 0.25)
            out.append(finish(sat(mix((s, 0, 0), (thump, 0, -2), (tail, 0.012, -8)), 4), loud=-6.5, ceiling=-0.3, fo=0.8))
    return out


@sound('shotgun_pump', volume=0.8, pitch=(0.97, 1.03), max=3)
def shotgun_pump():
    """Pump action full cycle (Charles Daly, Benelli Nova)."""
    out = []
    for f in ('Master Tracks/Charles Daly/H_6.wav', 'Master Tracks/Nova/O_6.wav'):
        x = fx(FF(f), 'highpass=f=120')
        t = on1(x, floor_db=-25)
        out.append(finish(gate(cut(x, t - 0.02, t + 0.75), -40, -18), loud=-15, fo=0.12))
    return out


@sound('lever_cycle', volume=0.8, pitch=(0.97, 1.03), max=3)
def lever_cycle():
    """Winchester 1894 lever cycle (lever down + up)."""
    out = []
    x = fx(FF('Master Tracks/Model 1894/L_11.wav'), 'highpass=f=120')
    t = first_onset(x)
    out.append(finish(gate(cut(x, t - 0.02, t + 1.25), -40, -18), loud=-14, fo=0.15))
    d, u = fx(FF('Master Tracks/Model 1894/L_4.wav'), 'highpass=f=120'), fx(FF('Master Tracks/Model 1894/L_3.wav'), 'highpass=f=120')
    td, tu = first_onset(d), first_onset(u)
    a = cut(d, td - 0.01, td + 0.45)
    b = cut(u, tu - 0.01, tu + 0.5)
    out.append(finish(mix((a, 0, 0), (b, 0.32, 0)), loud=-14, fo=0.12))
    return out


@sound('rev_hammer', volume=0.7, pitch=(0.96, 1.05), max=3)
def rev_hammer():
    """Single-action hammer cock 'click-clack' (Ruger Single Six) + S&W hammer clicks."""
    out = []
    x = FF(SSM + 'S_6.wav')
    x = fx(x, 'highpass=f=140')
    for t in onsets(x, 4, min_gap=0.8, floor_db=-30, rise_db=10)[:3]:
        out.append(finish(gate(seg(x, t, pre=0.006, post=0.45, fo=0.1)), loud=-15, fo=0.08))
    y = FF(SWM + 'V_7.wav')
    t = on1(y, floor_db=-12)
    out.append(finish(gate(seg(y, t, pre=0.006, post=0.3, fo=0.1)), loud=-15, fo=0.08))
    return out


@sound('rev_dry', volume=0.7, pitch=(0.97, 1.03), max=2, cooldown=0.08)
def rev_dry():
    """Dry fire on an empty chamber."""
    out = []
    x = fx(FF(SWM + 'V_5.wav'), 'highpass=f=140')
    t = on1(x, floor_db=-15)
    out.append(finish(gate(seg(x, t, pre=0.005, post=0.3, fo=0.1)), loud=-15))
    y = fx(FF(SSM + 'S_8.wav'), 'highpass=f=140')
    t = on1(y, floor_db=-15)
    out.append(finish(gate(seg(y, t, pre=0.005, post=0.3, fo=0.1)), loud=-15))
    return out


def _handling(rel: str, post: float, n: int = 1, floor_db: float = -14, loud: float = -15, pre: float = 0.01) -> list[np.ndarray]:
    x = fx(FF(rel), 'highpass=f=140,lowpass=f=11000')
    res = []
    ts = onsets(x, n, min_gap=0.4, floor_db=floor_db, rise_db=8)[:n] or [first_onset(x)]
    for t in ts:
        res.append(finish(gate(seg(x, t, pre=pre, post=post, fo=post * 0.4)), loud=loud, fo=0.05))
    return res


@sound('rev_open', volume=0.7, pitch=(0.97, 1.03), max=2)
def rev_open():
    """Swing the cylinder out / open the loading gate."""
    return _handling(SWM + 'V_9.wav', 0.45) + _handling(SWM + 'V_0.wav', 0.4) + _handling(SSM + 'S_0.wav', 0.35)


@sound('rev_close', volume=0.75, pitch=(0.97, 1.03), max=2)
def rev_close():
    """Flick the cylinder shut / close the loading gate."""
    return _handling(SWM + 'V_10.wav', 0.4) + _handling(SWM + 'V_1.wav', 0.35) + _handling(SSM + 'S_1.wav', 0.3)


@sound('rev_eject', volume=0.75, pitch=(0.96, 1.04), max=2)
def rev_eject():
    """Ejector rod pushing shells out + casings tumbling."""
    x = fx(FF(SWM + 'V_3.wav'), 'highpass=f=140,lowpass=f=10000')
    t = on1(x, floor_db=-12)
    rattle = gate(cut(x, t - 0.35, t + 0.5), -38, -18)
    out = []
    for i, c in enumerate(('BLLTShel_ShellCasingMetal_OS_01', 'BLLTShel_ShellCasingConcrete_OS_02')):
        cs = trim(OC(c))
        out.append(finish(mix((rattle, 0, 0), (cs, 0.38 + i * 0.05, -6)), loud=-14, fo=0.15))
    return out


@sound('rev_insert', volume=0.7, pitch=(0.95, 1.06), max=3)
def rev_insert():
    """Single cartridge pushed into a chamber (5 takes)."""
    x = fx(FF(SWM + 'V_18.wav'), 'highpass=f=140,lowpass=f=11000')
    out = [finish(gate(seg(x, t, pre=0.012, post=0.22, fo=0.08)), loud=-15, fo=0.05) for t in onsets(x, 5, min_gap=1.2, floor_db=-30, rise_db=10)]
    y = fx(FF(SSM + 'S_2.wav'), 'highpass=f=140')
    out += [finish(gate(seg(y, t, pre=0.01, post=0.2, fo=0.08)), loud=-15, fo=0.05) for t in onsets(y, 2, min_gap=1.0, floor_db=-12)]
    return out


@sound('rev_spin', volume=0.7, pitch=(0.96, 1.04), max=2)
def rev_spin():
    """Cylinder spin ratchet."""
    a = fx(FF(SWM + 'V_4.wav'), 'highpass=f=140,lowpass=f=11000')
    t = on1(a, floor_db=-14)
    b = fx(FF(SWM + 'V_13.wav'), 'highpass=f=140,lowpass=f=11000')
    return [finish(gate(cut(a, t - 0.05, t + 1.5), -40, -16), loud=-15, fo=0.6), finish(gate(cut(b, 3.72, 5.3), -40, -16), loud=-15, fo=0.7)]


@sound('shell_casing', volume=0.5, pitch=(0.9, 1.1), max=4, cooldown=0.04)
def shell_casing():
    """Spent brass casings bouncing (concrete / metal / grass takes)."""
    names = ['BLLTShel_ShellCasingConcrete_OS_01', 'BLLTShel_ShellCasingConcrete_OS_03', 'BLLTShel_ShellCasingMetal_OS_03', 'BLLTShel_ShellCasingGrass_OS_02']
    return [finish(OC(n), loud=-19, fo=0.15) for n in names]


# ===========================================================================
# PROJECTILES / IMPACTS
# ===========================================================================
@sound('bullet_whiz', volume=0.6, pitch=(0.92, 1.12), max=6, cooldown=0.03)
def bullet_whiz():
    """Near-miss bullet zip: fast bamboo-stick swishes, sped up and band-limited."""
    out = []
    for f, r in (('swosh-03.m4a', 1.8), ('swosh-11.m4a', 1.65), ('swosh-27.m4a', 1.9)):
        x = AT('swish-bamboo-stick-weapon-swhoshes', f)
        x = speed(trim(x), r)
        x = fx(x, 'highpass=f=1400,lowpass=f=11000')
        out.append(finish(x, loud=-16, fo=0.05))
    return out


@sound('bullet_impact_sand', volume=0.7, pitch=(0.9, 1.1), max=8, cooldown=0.02)
def bullet_impact_sand():
    """Bullet into sand: soft thud + sand crunch."""
    out = []
    for i in range(3):
        thud = KN(f'impact-sounds/impactSoft_medium_00{i}.ogg')
        crunch = AT('fantozzis-footsteps-grasssand-stone', ['fantozzi-sand-l1.m4a', 'fantozzi-sand-r2.m4a', 'fantozzi-sand-l3.m4a'][i])
        crunch = fx(trim(crunch), 'highpass=f=900')
        out.append(finish(mix((trim(thud), 0, 0), (crunch, 0.0, -4)), loud=-16, fo=0.1))
    return out


@sound('bullet_impact_rock', volume=0.7, pitch=(0.9, 1.1), max=8, cooldown=0.02)
def bullet_impact_rock():
    """Bullet into rock: pick-on-stone impact + pebble scatter."""
    out = []
    for i in range(3):
        hit = trim(KN(f'impact-sounds/impactMining_00{i}.ogg'))
        pebbles = trim(AT('75-cc0-breaking-falling-hit-sfx', f'bfh1-rock-falling-0{4 + i}.m4a'))
        out.append(finish(mix((cut(hit, 0, 0.35), 0, 0), (fx(pebbles, 'highpass=f=1500'), 0.02, -10)), loud=-15, fo=0.12))
    return out


@sound('ricochet', volume=0.6, pitch=(0.9, 1.12), max=4, cooldown=0.05)
def ricochet():
    """Ricochet whine: a struck metal bell/plate recording given a falling pitch glide."""
    out = []
    srcs = ['impact-sounds/impactBell_heavy_001.ogg', 'impact-sounds/impactBell_heavy_000.ogg', 'impact-sounds/impactBell_heavy_003.ogg']
    for i, f in enumerate(srcs):
        ring = trim(KN(f))
        whine = glide(cut(ring, 0, 0.9), 2.3 - i * 0.2, 1.25, curve=0.7)
        whine = fx(whine, 'highpass=f=1200')
        whine = cut(whine, 0, 0.55)
        tick = cut(trim(KN(f'impact-sounds/impactMining_00{i + 2}.ogg')), 0, 0.06)
        out.append(finish(mix((tick, 0, -3), (fade_out(whine, 0.3), 0.01, 0)), loud=-15, fo=0.15))
    return out


# ===========================================================================
# SANDBOARD / MOVEMENT
# ===========================================================================
@sound('board_land', volume=0.85, pitch=(0.92, 1.06), max=3, cooldown=0.06)
def board_land():
    """Landing on sand: dirt landing + heavy soft impact + sand crunch."""
    out = []
    for i in range(3):
        land = trim(OC(f'FEETHmn_ShoeDirtLand_OS_0{1 + i % 2}'))
        thud = trim(KN(f'impact-sounds/impactSoft_heavy_00{i}.ogg'))
        crunch = trim(AT('fantozzis-footsteps-grasssand-stone', ['fantozzi-sand-r1.m4a', 'fantozzi-sand-l2.m4a', 'fantozzi-sand-r3.m4a'][i]))
        x = mix((thud, 0, 0), (land, 0, -3), (crunch, 0.01, -5))
        out.append(finish(fx(x, 'lowpass=f=7000'), loud=-12, fo=0.2))
    return out


@sound('board_jump', volume=0.7, pitch=(0.94, 1.06), max=2, cooldown=0.08)
def board_jump():
    """Kick off the sand: dirt scuff + small whoosh."""
    out = []
    for i in range(2):
        scuff = trim(OC(f'FEETHmn_ShoeDirtRun_OS_0{2 + i}'))
        wh = trim(OC(f'WHSH_WhooshSmall_OS_0{1 + i}'))
        out.append(finish(mix((scuff, 0, 0), (wh, 0.02, -2)), loud=-15, fo=0.1))
    return out


@sound('board_slide_loop', bus='sfx', volume=0.55, pitch=None, folder='amb')
def board_slide_loop():
    """Sand hiss under the board: real desert-ground wind recording band-passed into grainy hiss."""
    x = OM('wind.ogg', start=58, dur=10.5, ch=1)
    x = fx(x, 'highpass=f=1300,highpass=f=1300,lowpass=f=9500,acompressor=threshold=-24dB:ratio=3:attack=5:release=120')
    grit = trim(AT('20-rustles-dry-leaves', 'rustle07.m4a'))
    grit = fx(speed(grit, 0.8), 'highpass=f=1500')
    layers = [(x, 0, 0)]
    for k, t in enumerate(np.arange(0.4, 9.5, 1.35)):
        layers.append((grit, float(t), -14 - (k % 3) * 2))
    y = mix(*layers)
    y = seamless(y, 8.0, 1.0)
    return [norm_loud(y, -16, -3)]


@sound('sand_spray', volume=0.65, pitch=(0.9, 1.1), max=4, cooldown=0.05)
def sand_spray():
    """Carving spray: dry rustles slowed + wind gust burst."""
    out = []
    gust = OM('wind.ogg', start=212, dur=1.2, ch=1)
    gust = fade_in(fade_out(fx(gust, 'highpass=f=900'), 0.6), 0.1)
    for f in ('rustle03.m4a', 'rustle11.m4a', 'rustle16.m4a'):
        r = fx(speed(trim(AT('20-rustles-dry-leaves', f)), 0.85), 'highpass=f=700')
        out.append(finish(fade_out(cut(mix((r, 0, 0), (gust, 0, -6)), 0, 0.95), 0.4), loud=-15, fo=0.25))
    return out


@sound('sand_burst', volume=0.8, pitch=(0.9, 1.08), max=4, cooldown=0.04)
def sand_burst():
    """Heavy sand eruption: soft heavy impact + mud thump + sand trickle."""
    out = []
    for i in range(3):
        thud = trim(KN(f'impact-sounds/impactSoft_heavy_00{2 + i}.ogg'))
        mud = fx(trim(AT('25-cc0-mud-sfx', f'mud-{[3, 9, 17][i]:02d}.m4a')), 'lowpass=f=1800')
        trickle = fx(speed(trim(AT('20-rustles-dry-leaves', f'rustle{[5, 9, 14][i]:02d}.m4a')), 0.7), 'highpass=f=500')
        out.append(finish(mix((thud, 0, 0), (mud, 0, -3), (trickle, 0.08, -7)), loud=-12, fo=0.35))
    return out


@sound('sand_rise', volume=0.7, pitch=(0.92, 1.05), max=4, cooldown=0.1)
def sand_rise():
    """Something clawing up out of the sand: overlapping slowed rustles + low thunder rumble."""
    out = []
    storm = OM('storm.ogg', start=232, dur=1.6, ch=1)
    rumble = fade_in(fade_out(fx(speed(storm, 0.6), 'lowpass=f=220,lowpass=f=220'), 1.0), 0.4)
    for v in range(2):
        layers = [(norm_peak(rumble, -6), 0, -4)]
        for k in range(5):
            r = fx(speed(trim(AT('20-rustles-dry-leaves', f'rustle{(k * 3 + v * 2) % 20 + 1:02d}.m4a')), 0.62 + 0.05 * k), 'highpass=f=300,lowpass=f=6000')
            layers.append((cut(r, 0, 1.2), 0.12 + k * 0.2 + v * 0.05, -4 - k))
        out.append(finish(fade_out(cut(mix(*layers), 0, 2.4), 0.7), loud=-15, fo=0.4, lead_db=-50))
    return out


@sound('footstep_sand', volume=0.55, pitch=(0.92, 1.08), max=3)
def footstep_sand():
    """Footsteps in sand (Fantozzi's footsteps, sand takes)."""
    names = ['fantozzi-sand-l1.m4a', 'fantozzi-sand-r1.m4a', 'fantozzi-sand-l2.m4a', 'fantozzi-sand-r2.m4a', 'fantozzi-sand-l3.m4a', 'fantozzi-sand-r3.m4a']
    return [finish(AT('fantozzis-footsteps-grasssand-stone', n), loud=-18, fo=0.06) for n in names]


# ===========================================================================
# WHOOSHES / MOVES
# ===========================================================================
@sound('whoosh', volume=0.6, pitch=(0.9, 1.1), max=4, cooldown=0.03)
def whoosh():
    """Swooshes (Oculus swoosh takes)."""
    return [finish(OC(f'SWSH_Swoosh_OS_0{i}'), loud=-15, fo=0.1) for i in (1, 2, 4, 6)]


@sound('whoosh_big', volume=0.75, pitch=(0.92, 1.06), max=3, cooldown=0.05)
def whoosh_big():
    """Big whoosh: medium whooshes slowed for weight + swoosh layer."""
    out = []
    for i in range(1, 4):
        a = speed(trim(OC(f'WHSH_WhooshMedium_OS_0{i}')), 0.72)
        b = trim(OC(f'SWSH_Swoosh_OS_0{i + 2}'))
        out.append(finish(mix((a, 0, 0), (b, 0.03, -5)), loud=-12, fo=0.15))
    return out


@sound('trick_spin', volume=0.6, pitch=(0.92, 1.1), max=3, cooldown=0.06)
def trick_spin():
    """Spinning trick: double/triple bamboo swish."""
    out = []
    for a, b, c in (('swosh-05.m4a', 'swosh-06.m4a', None), ('swosh-14.m4a', 'swosh-15.m4a', 'swosh-16.m4a'), ('swosh-30.m4a', 'swosh-31.m4a', None)):
        L = [(trim(AT('swish-bamboo-stick-weapon-swhoshes', a)), 0, 0), (trim(AT('swish-bamboo-stick-weapon-swhoshes', b)), 0.14, -2)]
        if c:
            L.append((trim(AT('swish-bamboo-stick-weapon-swhoshes', c)), 0.27, -4))
        out.append(finish(fade_out(cut(mix(*L), 0, 0.95), 0.3), loud=-15, fo=0.1))
    return out


@sound('grapple_fire', volume=0.75, pitch=(0.95, 1.05), max=2)
def grapple_fire():
    """Grappling hook launch: chain rattle + fast swish."""
    out = []
    for c, s in (('chain-01.m4a', 'swish-3.m4a'), ('chain-03.m4a', 'swish-8.m4a')):
        ch = trim(AT('80-cc0-rpg-sfx', c))
        sw = trim(AT('swishes-sound-pack', s))
        out.append(finish(mix((sw, 0, 0), (ch, 0.02, -3)), loud=-13, fo=0.15))
    return out


@sound('grapple_hit', volume=0.8, pitch=(0.94, 1.05), max=2)
def grapple_hit():
    """Hook bites: heavy metal impact + chain slap."""
    out = []
    for i, c in ((0, 'chain-02.m4a'), (3, 'chain-01.m4a')):
        m = trim(KN(f'impact-sounds/impactMetal_heavy_00{i}.ogg'))
        ch = trim(AT('80-cc0-rpg-sfx', c))
        out.append(finish(mix((m, 0, 0), (ch, 0.015, -5)), loud=-12, fo=0.2))
    return out


@sound('rope_reel', volume=0.6, pitch=(0.95, 1.08), max=2)
def rope_reel():
    """Chain/rope reeling in."""
    a = speed(trim(AT('80-cc0-rpg-sfx', 'chain-03.m4a')), 0.9)
    b = speed(trim(AT('80-cc0-rpg-sfx', 'chain-02.m4a')), 1.1)
    c = trim(AT('80-cc0-rpg-sfx', 'chain-01.m4a'))
    return [finish(mix((a, 0, 0), (b, 0.25, -3), (c, 0.45, -4)), loud=-16, fo=0.25), finish(mix((c, 0, 0), (a, 0.2, -2)), loud=-16, fo=0.25)]


@sound('boost', volume=0.8, pitch=(0.94, 1.06), max=2, cooldown=0.1)
def boost():
    """Boost burst: slowed heavy whoosh + real wind gust."""
    out = []
    for i, t0 in ((1, 205.0), (3, 221.0)):
        wh = speed(trim(OC(f'WHSH_WhooshMedium_OS_0{i}')), 0.62)
        gust = OM('wind.ogg', start=t0, dur=1.4, ch=1)
        gust = fade_in(fade_out(fx(gust, 'highpass=f=400,lowpass=f=9000'), 0.8), 0.05)
        out.append(finish(mix((wh, 0, 0), (norm_peak(gust, -3), 0, -4)), loud=-11, fo=0.5))
    return out


# ===========================================================================
# MELEE
# ===========================================================================
@sound('kick', volume=0.85, pitch=(0.94, 1.06), max=3)
def kick():
    """Boot kicks (Oculus fight impacts)."""
    return [finish(OC(f'FGHTImpt_Kick_OS_0{i}'), loud=-11, fo=0.12) for i in range(1, 6)]


@sound('punch', volume=0.85, pitch=(0.94, 1.06), max=3)
def punch():
    """Hard punches / pistol-whip impacts."""
    names = ['FGHTImpt_PunchHarder_OS_01', 'FGHTImpt_PunchHarder_OS_02', 'FGHTImpt_PunchHarder_OS_03', 'FGHTImpt_PunchHarder_OS_04', 'FGHTImpt_PunchHardest_OS_01']
    return [finish(OC(n), loud=-11, fo=0.12) for n in names]


@sound('melee_whoosh', volume=0.6, pitch=(0.9, 1.1), max=3, cooldown=0.04)
def melee_whoosh():
    """Swing whooshes (artisticdude swishes)."""
    return [finish(AT('swishes-sound-pack', f'swish-{i}.m4a'), loud=-14, fo=0.08) for i in (2, 5, 9, 12)]


@sound('counter_clang', volume=0.9, pitch=(0.95, 1.05), max=2, reverb=0.15)
def counter_clang():
    """Parry/counter: sword clash + ringing bell plate."""
    out = []
    clash = trim(OC('WEAPSwrd_SwordClash_OS_01'))
    for i, f in enumerate(('sword-clash-2.m4a', 'sword-clash-5.m4a', 'sword-clash-8.m4a')):
        c2 = trim(AT('20-sword-sound-effects-attacks-and-clashes', f))
        ring = trim(KN(f'impact-sounds/impactBell_heavy_00{i}.ogg'))
        base = clash if i == 0 else c2
        out.append(finish(mix((base, 0, 0), (c2 if i == 0 else clash, 0.005, -6), (ring, 0.0, -8)), loud=-9, ceiling=-0.5, fo=0.4))
    return out


@sound('dynamite_fuse', volume=0.55, pitch=(0.95, 1.05), max=3)
def dynamite_fuse():
    """Lit fuse: match strike + sputtering hiss (compressed-air/air recordings, chopped)."""
    out = []
    hiss_src = AT('100-cc0-sfx-2', 'sfx100v2-air-01.m4a')
    rng = np.random.default_rng(11)
    for v in range(2):
        h = fx(cut(hiss_src, 0.2 + v * 0.3, 2.2 + v * 0.3), 'highpass=f=2500,lowpass=f=9000')
        # sputter: random amplitude modulation of the real hiss
        n = len(h)
        mod = np.repeat(rng.uniform(0.35, 1.0, n // 441 + 1), 441)[:n]
        mod = np.convolve(mod, np.ones(64) / 64, mode='same')
        h = h * mod.astype(np.float32)
        try:
            strike = trim(AT('fantasy-sound-effects-tinysized-sfx', 'match-light-01.m4a'))
            x = mix((strike, 0, 0), (h, 0.15, -6))
        except FileNotFoundError:
            x = h
        out.append(finish(x, loud=-17, fo=0.3))
    return out


@sound('explosion', volume=1.0, pitch=(0.92, 1.06), max=4, reverb=0.2, ref=16)
def explosion():
    """Dynamite blast: real firework bang/cannon + thunder low end + rock debris."""
    out = []
    thunder = AT('100-cc0-sfx-2', 'sfx100v2-thunder-01.m4a')
    low = fx(cut(thunder, 0.6, 3.2), 'lowpass=f=300,lowpass=f=300')
    for i, (b, deb) in enumerate((('cannon-01.m4a', 'bfh1-rock-falling-01.m4a'), ('bang-09.m4a', 'bfh1-rock-falling-03.m4a'), ('bang-06.m4a', 'bfh1-rock-breaking-02.m4a'))):
        bang = trim(AT('25-cc0-bang-firework-sfx', b))
        body = fade_out(norm_peak(fx(speed(bang, 0.6), 'lowpass=f=260'), -1), 0.6)
        debris = fx(trim(AT('75-cc0-breaking-falling-hit-sfx', deb)), 'highpass=f=600')
        x = mix((bang, 0, 0), (body, 0, -2), (norm_peak(low, -3), 0.01, -5), (debris, 0.18, -10))
        out.append(finish(sat(x, 3), loud=-7, ceiling=-0.3, fo=0.9))
    return out


@sound('explosion_big', volume=1.0, pitch=(0.94, 1.04), max=2, reverb=0.25, ref=24)
def explosion_big():
    """Huge blast: slowed cannon + bang + storm thunder roll + crumbling rock."""
    out = []
    storm = OM('storm.ogg', start=266, dur=6, ch=1)
    roll = fade_out(fx(storm, 'lowpass=f=900'), 2.0)
    for i, (b1, b2) in enumerate((('cannon-02.m4a', 'bang-03.m4a'), ('cannon-04.m4a', 'bang-07.m4a'))):
        c = trim(AT('25-cc0-bang-firework-sfx', b1))
        bb = trim(AT('25-cc0-bang-firework-sfx', b2))
        deep = fade_out(norm_peak(fx(speed(c, 0.5), 'lowpass=f=200'), -1), 1.2)
        crumble = fx(trim(AT('75-cc0-breaking-falling-hit-sfx', 'bfh1-rock-breaking-02.m4a')), 'highpass=f=400')
        x = mix((c, 0, 0), (bb, 0.01, -3), (deep, 0, -1), (norm_peak(roll, -3), 0.05, -6), (crumble, 0.35, -10), (crumble, 0.7, -14))
        out.append(finish(sat(x, 4), loud=-6, ceiling=-0.3, fo=1.6))
    return out


# ===========================================================================
# POISON / INSECTS (Serket)
# ===========================================================================
@sound('poison_hit', volume=0.6, pitch=(0.9, 1.12), max=6, cooldown=0.03)
def poison_hit():
    """Venom splash on hit: slime squelch + fizz."""
    out = []
    fizz = fx(AT('80-cc0-rpg-sfx', 'spell-fire-06.m4a'), 'highpass=f=2500')
    for f in ('slime-03.m4a', 'slime-07.m4a', 'slime-11.m4a'):
        s = trim(AT('40-cc0-water-splash-slime-sfx', f))
        out.append(finish(mix((s, 0, 0), (norm_peak(trim(fizz), -6), 0.02, -9)), loud=-16, fo=0.12))
    return out


@sound('poison_tick', volume=0.4, pitch=(0.85, 1.2), max=6, cooldown=0.05)
def poison_tick():
    """Poison damage tick: tiny bubble pops."""
    return [finish(AT('40-cc0-water-splash-slime-sfx', f'bubble-0{i}.m4a'), loud=-21, fo=0.06) for i in (1, 2, 3)]


@sound('poison_burst', volume=0.8, pitch=(0.9, 1.08), max=3, cooldown=0.05, reverb=0.1)
def poison_burst():
    """Toxic detonation: wet splat + slime + boiling bubbles."""
    out = []
    bub = AT('40-cc0-water-splash-slime-sfx', 'loop-bubbles-1.m4a')
    for i, (sp, sl) in enumerate((('impactsplat02-mp3.m4a', 'slime-05.m4a'), ('impactsplat05-mp3.m4a', 'slime-09.m4a'), ('impactsplat07-mp3.m4a', 'slime-14.m4a'))):
        splat = trim(AT('8-wet-squish-slurp-impacts', sp))
        slime = trim(AT('40-cc0-water-splash-slime-sfx', sl))
        boil = fade_in(fade_out(cut(bub, i * 0.7, i * 0.7 + 1.1), 0.6), 0.05)
        out.append(finish(mix((splat, 0, 0), (slime, 0.03, -3), (boil, 0.06, -8)), loud=-12, fo=0.35))
    return out


@sound('scorpion_chitter', volume=0.55, pitch=(1.0, 1.25), max=3, cooldown=0.12)
def scorpion_chitter():
    """Pinch the scorpion: clicky bug vocalizations."""
    return [finish(AT(p, f), loud=-17, fo=0.06) for p, f in (('80-cc0-creature-sfx', 'bug-02.m4a'), ('80-cc0-creature-sfx', 'bug-04.m4a'), ('80-cc0-creture-sfx-2', 'bug-08.m4a'), ('80-cc0-creture-sfx-2', 'bug-10.m4a'))]


@sound('scorpion_sting', volume=0.75, pitch=(0.92, 1.1), max=4, cooldown=0.04)
def scorpion_sting():
    """Stinger strike: beetle bite + knife stab."""
    out = []
    for i, (b, k) in enumerate((('bite-small.wav', 'knifeSlice.ogg'), ('bite-small2.wav', 'knifeSlice2.ogg'), ('bite-small3.wav', 'knifeSlice.ogg'))):
        bite = trim(KN(f'oga-rpg-pack/RPG Sound Pack/NPC/beetle/{b}'))
        knife = trim(KN(f'rpg-audio/{k}'))
        out.append(finish(mix((knife, 0, -2), (bite, 0.0, 0)), loud=-13, fo=0.08))
    return out


@sound('scorpion_throw', volume=0.7, pitch=(0.94, 1.08), max=3)
def scorpion_throw():
    """Throwing scorpions: swish + chitter."""
    out = []
    for s, b in (('swish-6.m4a', 'bug-03.m4a'), ('swish-10.m4a', 'bug-01.m4a')):
        sw = trim(AT('swishes-sound-pack', s))
        bug = trim(AT('80-cc0-creature-sfx', b))
        out.append(finish(mix((sw, 0, 0), (speed(bug, 1.15), 0.04, -3)), loud=-14, fo=0.08))
    return out


@sound('swarm_loop', bus='sfx', volume=0.6, pitch=None, folder='amb')
def swarm_loop():
    """Insect swarm: real fly/bug/cicada recordings stacked at several speeds into a dense buzz."""
    srcs = [('swamp-environment-audio', 'fly-2.m4a'), ('swamp-environment-audio', 'fly-3.m4a'), ('swamp-environment-audio', 'bug-1.m4a'), ('swamp-environment-audio', 'bug-2.m4a'), ('swamp-environment-audio', 'cicada-1.m4a')]
    layers = []
    rates = [0.92, 1.0, 1.12, 1.26, 1.4, 0.85]
    for k in range(9):
        p, f = srcs[k % len(srcs)]
        x = trim(AT(p, f))
        x = speed(x, rates[k % len(rates)])
        # repeat until long enough
        while sec(len(x)) < 8.0:
            x = np.concatenate([x, x])
        x = fx(cut(x, 0, 8.0), 'highpass=f=180,lowpass=f=7000')
        layers.append((norm_peak(x, -6), (k * 0.37) % 1.0, -2 - (k % 3) * 2))
    y = mix(*layers)
    y = fx(y, 'acompressor=threshold=-20dB:ratio=4:attack=10:release=200')
    y = seamless(cut(y, 0.5, 7.9), 6.0, 1.2)
    return [norm_loud(y, -15, -3)]


@sound('scarab_squish', volume=0.75, pitch=(0.9, 1.1), max=4, cooldown=0.04)
def scarab_squish():
    """Beetle crunch: wet splat + carapace crack."""
    out = []
    for sp, cr in (('impactsplat01-mp3.m4a', 'bfh1-wood-breaking-01.m4a'), ('impactsplat04-mp3.m4a', 'bfh1-wood-breaking-03.m4a'), ('impactsplat06-mp3.m4a', 'bfh1-wood-breaking-04.m4a')):
        a = trim(AT('8-wet-squish-slurp-impacts', sp))
        c = fx(trim(AT('75-cc0-breaking-falling-hit-sfx', cr)), 'highpass=f=900')
        out.append(finish(mix((c, 0, 0), (a, 0.01, -1)), loud=-13, fo=0.12))
    return out


@sound('dung_kick', volume=0.8, pitch=(0.92, 1.06), max=2)
def dung_kick():
    """Kicking a dung ball: boot kick + soft thud + squelch."""
    out = []
    for i in range(2):
        k = trim(OC(f'FGHTImpt_Kick_OS_0{2 + i * 2}'))
        t = trim(KN(f'impact-sounds/impactSoft_heavy_00{i}.ogg'))
        m = fx(trim(AT('25-cc0-mud-sfx', f'mud-{[5, 12][i]:02d}.m4a')), 'lowpass=f=2500')
        out.append(finish(mix((k, 0, 0), (t, 0, -2), (m, 0.02, -7)), loud=-12, fo=0.15))
    return out


@sound('dung_roll_loop', bus='sfx', volume=0.5, pitch=None, folder='amb', ref=6)
def dung_roll_loop():
    """Ball rolling over sand: rolling-object loop recording, varied and darkened."""
    r = AT('30-cc0-sfx-loops', 'rolling.m4a')
    parts = []
    for k, rate in enumerate((1.0, 0.95, 1.04, 0.98, 1.02, 0.97, 1.03, 0.99)):
        parts.append((speed(r, rate), k * 0.95, -(k % 2) * 1.5))
    y = fx(mix(*parts), 'lowpass=f=3200')
    y = seamless(y, 6.0, 0.8)
    return [norm_loud(y, -18, -3)]


# ===========================================================================
# HITS / GORE
# ===========================================================================
@sound('hit_flesh', volume=0.75, pitch=(0.9, 1.1), max=8, cooldown=0.015)
def hit_flesh():
    """Bullet/blade into a body: punch impacts layered with qubodup hits."""
    out = []
    for i, h in enumerate(('hit05', 'hit11', 'hit19', 'hit27')):
        p = trim(KN(f'impact-sounds/impactPunch_medium_00{i}.ogg'))
        q = trim(KN(f'oga-hits-punches/hits/{h}.mp3.flac'))
        out.append(finish(mix((p, 0, 0), (q, 0, -4)), loud=-13, fo=0.08))
    return out


@sound('hit_bone', volume=0.75, pitch=(0.9, 1.12), max=8, cooldown=0.015)
def hit_bone():
    """Bone crack (skeletons, husks): bones breaking + light wood knock."""
    out = []
    for i in range(1, 4):
        b = OC(f'GOREBone_BonesBreaking_OS_0{i}')
        t = first_onset(b)
        crack = seg(b, t, pre=0.005, post=0.28, fo=0.1)
        knock = trim(KN(f'impact-sounds/impactWood_light_00{i}.ogg'))
        out.append(finish(mix((crack, 0, 0), (knock, 0, -6)), loud=-13, fo=0.08))
    return out


@sound('hit_armor', volume=0.75, pitch=(0.9, 1.1), max=6, cooldown=0.02)
def hit_armor():
    """Armored hit: metal plate impacts."""
    out = []
    for i in range(3):
        m = trim(KN(f'impact-sounds/impactMetal_medium_00{i}.ogg'))
        p = trim(KN(f'impact-sounds/impactPlate_medium_00{i + 1}.ogg'))
        out.append(finish(mix((m, 0, 0), (p, 0, -4)), loud=-13, fo=0.15))
    return out


@sound('hit_crit', volume=0.9, pitch=(0.94, 1.06), max=4, cooldown=0.03)
def hit_crit():
    """Critical hit: heavy punch + bell ring + bone snap."""
    out = []
    for i in range(3):
        p = trim(KN(f'impact-sounds/impactPunch_heavy_00{i}.ogg'))
        ring = trim(KN(f'impact-sounds/impactBell_heavy_00{i + 2}.ogg'))
        b = OC(f'GOREBone_BonesBreaking_OS_0{i + 1}')
        snap = seg(b, first_onset(b), post=0.2, fo=0.08)
        out.append(finish(mix((p, 0, 0), (ring, 0, -9), (snap, 0.005, -5)), loud=-9, ceiling=-0.5, fo=0.25))
    return out


@sound('headshot', volume=0.9, pitch=(0.95, 1.05), max=3, cooldown=0.03)
def headshot():
    """Headshot: skull cracking + heavy punch."""
    out = []
    for i in (1, 2):
        sk = OC(f'GOREBone_SkullCracking_OS_0{i}')
        t = first_onset(sk)
        crack = seg(sk, t, pre=0.005, post=0.5, fo=0.2)
        p = trim(KN(f'impact-sounds/impactPunch_heavy_00{i + 1}.ogg'))
        out.append(finish(mix((crack, 0, 0), (p, 0, -4)), loud=-10, ceiling=-0.5, fo=0.2))
    return out


@sound('gore_splat', volume=0.7, pitch=(0.9, 1.1), max=5, cooldown=0.03)
def gore_splat():
    """Wet gore: blood squish slices + wet splat impacts."""
    out = []
    for i in range(1, 5):
        sq = OC(f'GORESqsh_BloodSquishSlimy_OS_0{i}')
        t = first_onset(sq)
        s = seg(sq, t, pre=0.005, post=0.55, fo=0.25)
        sp = trim(AT('8-wet-squish-slurp-impacts', f'impactsplat0{[3, 8, 2, 5][i - 1]}-mp3.m4a'))
        out.append(finish(mix((sp, 0, 0), (s, 0.0, -3)), loud=-13, fo=0.2))
    return out


@sound('limb_off', volume=0.85, pitch=(0.92, 1.06), max=3, cooldown=0.04)
def limb_off():
    """Limb torn off: bone snap + wet squish."""
    out = []
    for i in (2, 3):
        b = OC(f'GOREBone_BonesBreaking_OS_0{i}')
        snap = seg(b, first_onset(b), post=0.45, fo=0.2)
        sq = OC(f'GORESqsh_BloodSquishSlimy_OS_0{i}')
        s = seg(sq, first_onset(sq), post=0.5, fo=0.25)
        out.append(finish(mix((snap, 0, 0), (s, 0.04, -2)), loud=-11, fo=0.25))
    return out


# ===========================================================================
# ENEMY VOICES
# ===========================================================================
@sound('husk_groan', bus='voice', volume=0.6, pitch=(0.85, 1.05), max=4, cooldown=0.35, ref=7)
def husk_groan():
    """Sand husk groans (artisticdude zombies), darkened."""
    return [finish(fx(KN(f'oga-zombies/zombies/zombie-{i}.wav'), 'lowpass=f=5000'), loud=-15, fo=0.2) for i in (2, 7, 12, 18)]


@sound('husk_death', bus='voice', volume=0.7, pitch=(0.88, 1.05), max=4, cooldown=0.08, ref=8)
def husk_death():
    """Husk collapses: zombie death rattle + crumbling sand."""
    out = []
    for z, r in ((5, 'rustle04.m4a'), (14, 'rustle12.m4a'), (21, 'rustle18.m4a')):
        v = trim(KN(f'oga-zombies/zombies/zombie-{z}.wav'))
        sand = fx(speed(trim(AT('20-rustles-dry-leaves', r)), 0.7), 'highpass=f=500')
        out.append(finish(fade_out(cut(mix((v, 0, 0), (sand, 0.15, -6)), 0, 2.0), 0.6), loud=-14, fo=0.3))
    return out


@sound('jackal_howl', bus='voice', volume=0.75, pitch=(0.92, 1.06), max=2, cooldown=0.8, reverb=0.35, ref=14)
def jackal_howl():
    """Jackal warrior howl (creature howl, with a darker pitched double)."""
    h = trim(AT('80-cc0-creature-sfx', 'howl.m4a'))
    a = finish(reverb(mix((h, 0, 0), (speed(h, 0.86), 0.02, -6)), 1.8, 2.6, -14), loud=-13, fo=0.8)
    b = finish(reverb(mix((speed(h, 0.92), 0, 0), (speed(h, 0.78), 0.03, -5)), 1.8, 2.6, -14), loud=-13, fo=0.8)
    return [a, b]


@sound('jackal_growl', bus='voice', volume=0.65, pitch=(0.9, 1.08), max=3, cooldown=0.3, ref=8)
def jackal_growl():
    """Jackal growls (rubberduck creature vocals)."""
    return [finish(fx(AT(p, f), 'lowpass=f=6000'), loud=-14, fo=0.15) for p, f in (('80-cc0-creature-sfx', 'monster-03.m4a'), ('80-cc0-creature-sfx', 'monster-06.m4a'), ('80-cc0-creture-sfx-2', 'monster-12.m4a'))]


@sound('jackal_attack', bus='voice', volume=0.7, pitch=(0.92, 1.08), max=3, cooldown=0.15, ref=8)
def jackal_attack():
    """Jackal attack snarls."""
    return [finish(AT('80-cc0-creture-sfx-2', f'attack-0{i}.m4a'), loud=-13, fo=0.1) for i in (2, 3, 4)]


@sound('mummy_groan', bus='voice', volume=0.6, pitch=(0.9, 1.04), max=3, cooldown=0.6, reverb=0.2, ref=8)
def mummy_groan():
    """Cursed mummy groans: creepy groans pitched down."""
    m = OC('VOXMale_GroanCreepy_OS_01')
    f = OC('VOXFem_GroanCreepy_OS_01')
    a = finish(fx(speed(cut(m, 0.1, 2.0), 0.84), 'lowpass=f=4000'), loud=-15, fo=0.5)
    b = finish(fx(speed(cut(m, 2.2, 4.4), 0.8), 'lowpass=f=4000'), loud=-15, fo=0.5)
    c = finish(fx(speed(cut(f, 0.1, 2.2), 0.66), 'lowpass=f=3500'), loud=-15, fo=0.5)
    return [a, b, c]


@sound('mummy_death', bus='voice', volume=0.75, pitch=(0.92, 1.05), max=3, cooldown=0.1, ref=9)
def mummy_death():
    """Mummy destroyed: creepy creature cry + linen tearing."""
    tear = trim(OC('PAPRRip_PaperTear_OS_01'))
    out = []
    for n in ('CREAMnstr_CreatureCreepy_OS_02', 'CREAMnstr_CreatureCreepy_OS_03'):
        c = fx(speed(cut(trim(OC(n)), 0, 1.6), 0.85), 'lowpass=f=5000')
        out.append(finish(mix((c, 0, 0), (tear, 0.1, -6)), loud=-13, fo=0.5))
    return out


@sound('gunslinger_laugh', bus='voice', volume=0.6, pitch=(0.94, 1.06), max=2, cooldown=1.0, ref=10)
def gunslinger_laugh():
    """Skeletal outlaw cackles."""
    return [finish(OC(f'VOXLaff_EvilLaugh_OS_0{i}'), loud=-15, fo=0.4) for i in (1, 2, 3)]


@sound('skeleton_rattle', volume=0.6, pitch=(0.9, 1.12), max=4, cooldown=0.08, ref=6)
def skeleton_rattle():
    """Rattling bones: dice shakes (bone-on-bone clatter) + light wood knocks."""
    out = []
    for i in (1, 2, 3):
        d = trim(KN(f'casino-audio/dice-shake-{i}.ogg'))
        k = trim(KN(f'impact-sounds/impactWood_light_00{i}.ogg'))
        out.append(finish(fx(mix((d, 0, 0), (k, 0.05, -8)), 'lowpass=f=7000'), loud=-17, fo=0.15))
    return out


@sound('giant_scorpion_hiss', bus='voice', volume=0.75, pitch=(0.9, 1.06), max=2, cooldown=0.5, ref=12)
def giant_scorpion_hiss():
    """Giant scorpion hiss: creepy creature hiss + spit + chitter, slowed."""
    c = OC('CREAMnstr_CreatureCreepy_OS_01')
    out = []
    for i, (a, b) in enumerate(((0.05, 1.25), (1.35, 2.5))):
        h = fx(speed(cut(c, a, b), 0.9), 'highpass=f=300')
        sp = trim(AT('80-cc0-creature-sfx', f'spit-0{i + 1}.m4a'))
        bug = speed(trim(AT('80-cc0-creature-sfx', 'bug-04.m4a')), 0.6)
        out.append(finish(mix((h, 0, 0), (sp, 0.05, -6), (bug, 0.1, -8)), loud=-13, fo=0.35))
    return out


@sound('giant_scorpion_death', bus='voice', volume=0.8, pitch=(0.94, 1.04), max=2, cooldown=0.3, ref=14)
def giant_scorpion_death():
    """Giant scorpion dies: troll death cry + insect screech."""
    out = []
    for i in (1, 2):
        d = trim(OC(f'CREAHmn_TrollDeath_OS_0{i}'))
        bug = speed(trim(AT('80-cc0-creture-sfx-2', 'bug-07.m4a')), 0.55)
        out.append(finish(mix((d, 0, 0), (bug, 0.0, -7), (bug, 0.3, -10)), loud=-12, fo=0.6))
    return out


@sound('vulture_screech', bus='voice', volume=0.65, pitch=(0.9, 1.08), max=2, cooldown=0.6, reverb=0.2, ref=16)
def vulture_screech():
    """Bone vulture screech (raven calls, slowed and roughened)."""
    out = []
    for f in ('raven-1.m4a', 'raven-2.m4a'):
        r = trim(AT('superpowers-assets-sound-effects', f))
        r = cut(r, 0, min(sec(len(r)), 1.6))
        out.append(finish(fade_out(mix((r, 0, 0), (speed(r, 0.8), 0.01, -6)), 0.4), loud=-14, fo=0.3))
    return out


@sound('boss_roar', bus='voice', volume=0.95, pitch=(0.95, 1.04), max=2, cooldown=0.8, reverb=0.3, ref=24)
def boss_roar():
    """Boss roar: creature roars doubled an octave-ish lower, with a canyon tail."""
    out = []
    for p, f in (('80-cc0-creature-sfx', 'roar-02.m4a'), ('80-cc0-creture-sfx-2', 'roar-04.m4a'), ('80-cc0-creture-sfx-2', 'roar-05.m4a'), ('80-cc0-rpg-sfx', 'creature-roar-02.m4a')):
        r = trim(AT(p, f))
        low = fx(speed(r, 0.62), 'lowpass=f=1500')
        x = reverb(mix((r, 0, 0), (low, 0, -2), (speed(r, 0.82), 0.02, -6)), 2.2, 2.4, -12)
        out.append(finish(sat(x, 3), loud=-9, ceiling=-0.5, fo=1.0))
    return out


@sound('boss_hurt', bus='voice', volume=0.85, pitch=(0.95, 1.05), max=2, cooldown=0.4, ref=20)
def boss_hurt():
    """Boss pain grunts (giant vocals)."""
    return [finish(OC(f'CREAHmn_GiantHurt_OS_0{i}'), loud=-12, fo=0.4) for i in (1, 2, 3)]


@sound('boss_death', bus='voice', volume=1.0, pitch=(0.97, 1.03), max=1, reverb=0.35, ref=30)
def boss_death():
    """Boss death scream."""
    return [finish(reverb(trim(OC('CREAHmn_GiantDeathScream_OS_01')), 2.4, 2.2, -14), loud=-10, fo=1.2),
            finish(reverb(trim(OC('CREAHmn_GiantDeath_OS_01')), 2.4, 2.2, -14), loud=-10, fo=1.0)]


@sound('boss_laugh', bus='voice', volume=0.85, pitch=(0.96, 1.04), max=1, cooldown=1.5, reverb=0.25, ref=24)
def boss_laugh():
    """Boss taunt laughs (giant laughs)."""
    return [finish(OC(f'CREAHmn_GiantLaugh_OS_0{i}'), loud=-12, fo=0.5) for i in (1, 2, 3)]


# ===========================================================================
# WORLD / DESTRUCTION
# ===========================================================================
@sound('rock_crumble', volume=0.85, pitch=(0.9, 1.06), max=3, cooldown=0.1, reverb=0.15, ref=16)
def rock_crumble():
    """Collapsing rock: breaking + falling rock layers + pick impact."""
    out = []
    for i, (b, f1, f2) in enumerate((('bfh1-rock-breaking-02.m4a', 'bfh1-rock-falling-01.m4a', 'bfh1-rock-falling-03.m4a'), ('bfh1-rock-breaking-01.m4a', 'bfh1-rock-falling-09.m4a', 'bfh1-rock-falling-05.m4a'), ('bfh1-rock-breaking-03.m4a', 'bfh1-rock-falling-02.m4a', 'bfh1-rock-falling-08.m4a'))):
        P = '75-cc0-breaking-falling-hit-sfx'
        br = trim(AT(P, b))
        a = trim(AT(P, f1))
        c = trim(AT(P, f2))
        thud = trim(KN(f'impact-sounds/impactSoft_heavy_00{i}.ogg'))
        x = mix((br, 0, 0), (thud, 0, -4), (a, 0.18, -3), (c, 0.42, -5), (a, 0.75, -9))
        out.append(finish(x, loud=-12, fo=0.4))
    return out


@sound('quake_rumble', volume=0.85, pitch=(0.95, 1.05), max=2, cooldown=0.5, ref=40)
def quake_rumble():
    """Earth shaking: storm thunder rolls slowed to sub rumble + trickling stones."""
    out = []
    for t0 in (228.0, 264.0):
        s = OM('storm.ogg', start=t0, dur=7.0, ch=1)
        r = fx(speed(s, 0.55), 'lowpass=f=240,lowpass=f=240')
        r = fade_in(fade_out(cut(r, 0, 4.5), 1.6), 0.4)
        peb = fx(trim(AT('75-cc0-breaking-falling-hit-sfx', 'bfh1-rock-falling-07.m4a')), 'highpass=f=800')
        x = mix((norm_peak(r, -2), 0, 0), (peb, 0.9, -16), (peb, 2.1, -18))
        out.append(finish(x, loud=-13, fo=1.2, lead_db=-50))
    return out


@sound('thunder', bus='amb', volume=0.8, pitch=(0.92, 1.05), max=2, cooldown=2.0)
def thunder():
    """Thunder rolls (real field recording; rain hiss low-passed away)."""
    out = []
    for t0 in (188.0, 229.0, 262.0):
        s = OM('storm.ogg', start=t0, dur=9.0, ch=2)
        e = env_db(s, 0.05)
        i = int(np.argmax(e))
        st = max(0.0, i * 0.05 - 1.2)
        th = fx(cut(s, st, st + 6.5), 'lowpass=f=2200,highpass=f=35')
        out.append(finish(fade_in(th, 0.4), loud=-12, fo=2.0, do_trim=False))
    t = trim(AT('100-cc0-sfx-2', 'sfx100v2-thunder-01.m4a'))
    out.append(finish(stereo(t), loud=-12, fo=1.5))
    return out


@sound('crate_break', volume=0.85, pitch=(0.92, 1.08), max=4, cooldown=0.04)
def crate_break():
    """Wooden crate smashed: wood cracks + plank impacts + splinters."""
    out = []
    for c, w, s in (('crack03-mp3.m4a', 'impactwood05-mp3.m4a', 'wood-breaking-01.m4a'), ('crack07-mp3.m4a', 'impactwood12-mp3.m4a', 'wood-breaking-02.m4a'), ('crack09-mp3.m4a', 'impactwood21-mp3.m4a', 'wood-breaking-01.m4a')):
        cr = trim(AT('35-wooden-crackshitsdestructions', c))
        im = trim(AT('35-wooden-crackshitsdestructions', w))
        sp = trim(AT('100-cc0-metal-and-wood-sfx', s))
        out.append(finish(fade_out(cut(mix((im, 0, 0), (cr, 0.0, -2), (sp, 0.04, -4)), 0, 1.5), 0.5), loud=-11, fo=0.25))
    return out


@sound('barrel_break', volume=0.85, pitch=(0.92, 1.06), max=3, cooldown=0.05)
def barrel_break():
    """Barrel smashed: staves breaking + iron hoop clatter."""
    out = []
    for i, s in enumerate(('wood-breaking-02.m4a', 'wood-breaking-01.m4a')):
        sp = trim(AT('100-cc0-metal-and-wood-sfx', s))
        hoop = trim(KN(f'impact-sounds/impactMetal_light_00{i + 1}.ogg'))
        im = trim(AT('35-wooden-crackshitsdestructions', f'impactwood{[8, 17][i]:02d}-mp3.m4a'))
        out.append(finish(fade_out(cut(mix((im, 0, 0), (sp, 0.02, -2), (hoop, 0.12, -6)), 0, 1.5), 0.5), loud=-11, fo=0.3))
    return out


@sound('glass_break', volume=0.75, pitch=(0.92, 1.08), max=3, cooldown=0.05)
def glass_break():
    """Bottle / glass shattering."""
    out = [finish(OC('GLASBrk_GlassBottleBreak_OS_01'), loud=-13, fo=0.3)]
    for f in ('bfh1-glass-breaking-02.m4a', 'bfh1-glass-breaking-05.m4a'):
        out.append(finish(AT('75-cc0-breaking-falling-hit-sfx', f), loud=-13, fo=0.3))
    return out


@sound('cactus_hit', volume=0.65, pitch=(0.9, 1.1), max=4, cooldown=0.04)
def cactus_hit():
    """Hitting a cactus: soft wet pulp thud."""
    out = []
    for i in range(3):
        t = trim(KN(f'impact-sounds/impactSoft_medium_00{i + 2}.ogg'))
        m = fx(trim(AT('25-cc0-mud-sfx', f'mud-{[2, 8, 20][i]:02d}.m4a')), 'highpass=f=400,lowpass=f=5000')
        out.append(finish(mix((t, 0, 0), (cut(m, 0, 0.3), 0.0, -5)), loud=-15, fo=0.1))
    return out


@sound('tumbleweed', volume=0.5, pitch=(0.85, 1.1), max=3, cooldown=0.15, ref=8)
def tumbleweed():
    """Dry tumbleweed rustle."""
    return [finish(AT('20-rustles-dry-leaves', f'rustle{i:02d}.m4a'), loud=-18, fo=0.15) for i in (2, 8, 13, 19)]


# ===========================================================================
# PICKUPS / PROGRESSION
# ===========================================================================
@sound('pickup_bounty', bus='ui', volume=0.45, pitch=(0.98, 1.18), max=6, cooldown=0.025)
def pickup_bounty():
    """Bounty token pickup: poker chips clicking (bright, low fatigue)."""
    return [finish(speed(KN(f'casino-audio/chips-collide-{i}.ogg'), 1.12), loud=-19, fo=0.06) for i in (1, 2, 3, 4)]


@sound('pickup_gold', bus='ui', volume=0.55, pitch=(0.95, 1.1), max=5, cooldown=0.03)
def pickup_gold():
    """Gold coin pickup: coin drops and handled coins."""
    out = [finish(OC('OBJCoin_CoinDrop_OS_01'), loud=-17, fo=0.1)]
    out += [finish(KN(f'rpg-audio/{f}'), loud=-17, fo=0.1) for f in ('handleCoins.ogg', 'handleCoins2.ogg')]
    out += [finish(AT('80-cc0-rpg-sfx', 'item-coins-02.m4a'), loud=-17, fo=0.1)]
    return out


@sound('gold_burst', volume=0.7, pitch=(0.96, 1.04), max=2, cooldown=0.1)
def gold_burst():
    """Spray of coins: coin shakes + spinning coin falls."""
    out = []
    for a, b in (('coins-shake-03.m4a', 'coin-spin-fall-02.m4a'), ('coins-shake-06.m4a', 'coin-spin-fall-05.m4a')):
        x = trim(AT('fantasy-accessory-sfx-library', a))
        y = trim(AT('fantasy-accessory-sfx-library', b))
        out.append(finish(fade_out(cut(mix((x, 0, 0), (y, 0.15, -3), (trim(OC('OBJCoin_CoinDrop_OS_01')), 0.05, -6)), 0, 1.8), 0.6), loud=-13, fo=0.3))
    return out


@sound('rank_up', bus='ui', volume=0.8, pitch=None, max=1, cooldown=0.5)
def rank_up():
    """Bounty rank up: acoustic guitar positive sting + rising bell tree."""
    bt = fade_out(cut(OC('UIMisc_BelltreeUp_OS_01'), 0, 1.8), 0.8)
    return [finish(mix((trim(OC(f'MUSCStngr_AcousticGuitarPositive_OS_0{i}')), 0, 0), (bt, 0.0, -12)), loud=-11, fo=0.6) for i in (1, 2)]


@sound('card_erupt', volume=0.85, pitch=(0.95, 1.05), max=3, cooldown=0.05)
def card_erupt():
    """Upgrade cards blasting out of the sand: sand eruption + whoosh + card fan."""
    out = []
    for i in range(2):
        thud = trim(KN(f'impact-sounds/impactSoft_heavy_00{3 + i}.ogg'))
        wh = speed(trim(OC(f'WHSH_WhooshMedium_OS_0{1 + i}')), 0.8)
        fan = trim(KN(f'casino-audio/card-fan-{1 + i}.ogg'))
        sand = fx(speed(trim(AT('20-rustles-dry-leaves', f'rustle{[6, 15][i]:02d}.m4a')), 0.75), 'highpass=f=600')
        out.append(finish(mix((thud, 0, 0), (wh, 0.02, -2), (fan, 0.12, -3), (sand, 0.05, -6)), loud=-11, fo=0.35))
    return out


@sound('card_flip', bus='ui', volume=0.6, pitch=(0.94, 1.08), max=3, cooldown=0.03)
def card_flip():
    """Card flips / slides."""
    return [finish(KN(f'casino-audio/card-{n}.ogg'), loud=-17, fo=0.06) for n in ('slide-1', 'slide-3', 'slide-6', 'place-2')]


@sound('card_hover', bus='ui', volume=0.4, pitch=(0.95, 1.1), max=2, cooldown=0.04)
def card_hover():
    """Card nudge on hover (quiet card shoves)."""
    return [finish(cut(trim(KN(f'casino-audio/card-shove-{i}.ogg')), 0, 0.25), loud=-21, fo=0.08) for i in (1, 2, 3)]


@sound('card_pick', bus='ui', volume=0.75, pitch=(0.97, 1.03), max=1, cooldown=0.1)
def card_pick():
    """Card chosen: slap down + chip stack."""
    out = []
    for i in (1, 3):
        a = trim(KN(f'casino-audio/card-place-{i}.ogg'))
        b = trim(KN(f'casino-audio/chips-stack-{i}.ogg'))
        out.append(finish(mix((a, 0, 0), (b, 0.06, -4)), loud=-14, fo=0.15))
    return out


@sound('chest_open', volume=0.8, pitch=(0.96, 1.04), max=2, cooldown=0.2)
def chest_open():
    """Treasure chest: latch, creaking lid, wooden box open."""
    out = []
    for i in (1, 2):
        latch = trim(KN('rpg-audio/metalLatch.ogg'))
        creak = trim(KN(f'rpg-audio/creak{i}.ogg'))
        box = trim(AT('100-cc0-sfx', 'wooded-box-open.m4a'))
        out.append(finish(mix((latch, 0, 0), (creak, 0.08, -2), (box, 0.35, -1)), loud=-13, fo=0.3))
    return out


@sound('chest_unlock', volume=0.75, pitch=(0.96, 1.04), max=1, cooldown=0.2)
def chest_unlock():
    """Lock turning / key unlock."""
    out = [finish(AT('80-cc0-rpg-sfx', f'lock-0{i}.m4a'), loud=-15, fo=0.08) for i in (1, 2)]
    out.append(finish(OC('MECHLock_DoorUnlockKey_OS_02'), loud=-15, fo=0.1))
    return out


@sound('loot_reveal', volume=0.75, pitch=(0.97, 1.03), max=2, cooldown=0.2, reverb=0.2)
def loot_reveal():
    """Loot reveal: magic shimmer + coin glitter."""
    out = []
    coins = cut(OC('OBJCoin_CoinsUI_LOOP_01'), 0.2, 1.4)
    for f in ('magical-1-0.m4a', 'magical-3.m4a'):
        m = trim(AT('magic-spell-sfx', f))
        out.append(finish(mix((m, 0, 0), (fade_out(coins, 0.6), 0.05, -9)), loud=-13, fo=0.4))
    return out


# ===========================================================================
# UI (wood theme)
# ===========================================================================
@sound('ui_hover', bus='ui', volume=0.35, pitch=(0.96, 1.08), max=2, cooldown=0.03)
def ui_hover():
    """Soft wooden tick."""
    return [finish(speed(cut(trim(KN(f'impact-sounds/impactWood_light_00{i}.ogg')), 0, 0.09), 1.25), loud=-24, fo=0.04) for i in (0, 4)]


@sound('ui_click', bus='ui', volume=0.6, pitch=(0.98, 1.03), max=2, cooldown=0.03)
def ui_click():
    """Wooden confirm click."""
    return [finish(OC('UIClick_WoodConfirm_OS_01'), loud=-16, fo=0.06)]


@sound('ui_back', bus='ui', volume=0.6, pitch=(0.98, 1.03), max=2, cooldown=0.03)
def ui_back():
    """Wooden back click."""
    return [finish(OC('UIClick_WoodBack_OS_01'), loud=-16, fo=0.06)]


@sound('ui_error', bus='ui', volume=0.6, pitch=None, max=1, cooldown=0.15)
def ui_error():
    """Wooden error knock."""
    return [finish(OC('UIAlert_WoodError_OS_01'), loud=-15, fo=0.08)]


@sound('ui_open', bus='ui', volume=0.6, pitch=(0.98, 1.03), max=1, cooldown=0.05)
def ui_open():
    """Wooden open."""
    return [finish(OC('UIClick_WoodOpen_OS_01'), loud=-16, fo=0.08)]


@sound('ui_close', bus='ui', volume=0.6, pitch=(0.98, 1.03), max=1, cooldown=0.05)
def ui_close():
    """Wooden close."""
    return [finish(OC('UIClick_WoodClose_OS_01'), loud=-16, fo=0.08)]


@sound('paper_flutter', bus='ui', volume=0.6, pitch=(0.92, 1.08), max=2, cooldown=0.1)
def paper_flutter():
    """Wind-blown poster flutter: flag flapping slices + paper handling."""
    flag = OC('CLOTHFlp_FlagFlapping_LOOP_01')
    out = []
    for i, (a, p) in enumerate(((2.0, 'paper-01.m4a'), (7.5, 'paper-02.m4a'), (12.0, 'paper-04.m4a'))):
        f = fade_in(fade_out(fx(cut(flag, a, a + 1.0), 'highpass=f=500'), 0.4), 0.15)
        pp = trim(AT('100-cc0-sfx', p))
        out.append(finish(mix((f, 0, 0), (pp, 0.1, -3)), loud=-16, fo=0.3))
    return out


@sound('poster_slam', bus='ui', volume=0.8, pitch=(0.95, 1.05), max=1, cooldown=0.1)
def poster_slam():
    """Poster slapped onto a board: heavy wood impact + paper."""
    out = []
    for i, p in ((1, 'paper-02.m4a'), (3, 'paper-03.m4a')):
        w = trim(KN(f'impact-sounds/impactWood_heavy_00{i}.ogg'))
        pp = trim(AT('100-cc0-sfx', p))
        out.append(finish(mix((w, 0, 0), (pp, 0.0, -4)), loud=-12, fo=0.2))
    return out


@sound('page_turn', bus='ui', volume=0.6, pitch=(0.94, 1.06), max=2, cooldown=0.05)
def page_turn():
    """Book page turns (codex)."""
    return [finish(AT('book-flip-sounds', f'book-flip{i}.m4a'), loud=-17, fo=0.08) for i in (2, 5, 8, 11)]


@sound('book_open', bus='ui', volume=0.7, pitch=(0.97, 1.03), max=1, cooldown=0.2)
def book_open():
    """Heavy book opening."""
    return [finish(OC('OBJBook_BookOpen_OS_01'), loud=-15, fo=0.15), finish(KN('rpg-audio/bookOpen.ogg'), loud=-15, fo=0.15)]


@sound('book_close', bus='ui', volume=0.7, pitch=(0.97, 1.03), max=1, cooldown=0.2)
def book_close():
    """Heavy book closing."""
    return [finish(OC('OBJBook_BookClose_OS_01'), loud=-14, fo=0.15), finish(KN('rpg-audio/bookClose.ogg'), loud=-14, fo=0.15)]


# ===========================================================================
# WAVES / QTE
# ===========================================================================
@sound('wave_start', volume=0.9, pitch=None, max=1, cooldown=1.0, reverb=0.3)
def wave_start():
    """New wave: struck gong + deep boom, with a long canyon tail."""
    out = []
    for g, i in (('gong-02.m4a', 0), ('gong-01.m4a', 3)):
        gong = trim(AT('100-cc0-sfx', g))
        boom = fade_out(norm_peak(fx(speed(trim(KN(f'impact-sounds/impactSoft_heavy_00{i}.ogg')), 0.55), 'lowpass=f=180'), -1), 0.8)
        x = reverb(mix((gong, 0, 0), (boom, 0, -3), (speed(gong, 0.5), 0.0, -9)), 3.0, 2.0, -11)
        out.append(finish(x, loud=-10, fo=1.5))
    return out


@sound('wave_clear', bus='ui', volume=0.7, pitch=None, max=1, cooldown=1.0)
def wave_clear():
    """Wave survived: bright bells."""
    return [finish(reverb(trim(AT('100-cc0-sfx', f'bell-0{i}.m4a')), 1.5, 2.5, -14), loud=-14, fo=0.6) for i in (1, 3)]


@sound('qte_prompt', bus='ui', volume=0.65, pitch=None, max=2, cooldown=0.1)
def qte_prompt():
    """QTE cue: short struck bell ping."""
    out = []
    for i in (2, 4):
        t = OC(f'UIAlert_MusicTone_OS_0{i}')
        out.append(finish(fade_out(cut(trim(t), 0, 0.7), 0.4), loud=-15, fo=0.3))
    out.append(finish(trim(AT('100-cc0-sfx', 'bell-02.m4a')), loud=-15, fo=0.2))
    return out


@sound('qte_perfect', bus='ui', volume=0.85, pitch=(0.99, 1.02), max=2, cooldown=0.05, reverb=0.25)
def qte_perfect():
    """Perfect timing: bell plate ring + bright bell + sparkle."""
    out = []
    for i, m in ((1, 'magical-5.m4a'), (4, 'magical-2.m4a')):
        ring = trim(KN(f'impact-sounds/impactBell_heavy_00{i}.ogg'))
        bell = trim(AT('100-cc0-sfx', 'bell-02.m4a'))
        sp = trim(AT('magic-spell-sfx', m))
        out.append(finish(mix((ring, 0, 0), (bell, 0.0, -4), (sp, 0.02, -8)), loud=-11, fo=0.5))
    return out


@sound('qte_good', bus='ui', volume=0.7, pitch=(0.98, 1.02), max=2, cooldown=0.05)
def qte_good():
    """Good timing: lighter metallic tick + small ring."""
    return [finish(KN('oga-rpg-pack/RPG Sound Pack/inventory/metal-small1.wav'), loud=-14, fo=0.15),
            finish(KN('oga-rpg-pack/RPG Sound Pack/inventory/metal-small2.wav'), loud=-14, fo=0.15)]


@sound('qte_fail', bus='ui', volume=0.75, pitch=None, max=1, cooldown=0.1)
def qte_fail():
    """Missed timing: dull metal error + wood thud."""
    out = []
    for i in (0, 2):
        e = trim(OC('UIAlert_MetalError_OS_01'))
        w = trim(KN(f'impact-sounds/impactWood_heavy_00{i}.ogg'))
        out.append(finish(mix((w, 0, 0), (e, 0.0, -2)), loud=-13, fo=0.15))
    return out


# ===========================================================================
# DIVINE / UNDERWORLD
# ===========================================================================
@sound('divine_whisper', bus='voice', volume=0.6, pitch=(0.95, 1.05), max=2, cooldown=0.8, reverb=0.4)
def divine_whisper():
    """A god's whisper: reverberant whispers (Oculus) + breathy whisper syllables."""
    w = OC('VOXWhsp_WhispersCreepyReverb_OS_01')
    out = []
    for a, b in ((0.1, 2.4), (2.5, 4.8), (4.0, 6.4)):
        x = fade_in(fade_out(cut(w, a, b), 0.6), 0.25)
        syl = trim(AT('dialog-vocal-samples', f'whisper-{1 + int(a) % 4}.m4a'))
        y = reverb(mix((x, 0, 0), (syl, 0.4, -6)), 2.5, 2.0, -10)
        out.append(finish(y, loud=-17, fo=0.9, lead_db=-50))
    return out


@sound('divine_chime', bus='ui', volume=0.6, pitch=(0.96, 1.04), max=2, cooldown=0.4)
def divine_chime():
    """Wind chimes (desert shrine)."""
    c = OC('MUSCChim_WindChimes_LOOP_01', ch=2)
    return [finish(fade_in(fade_out(cut(c, a, a + 3.2), 1.2), 0.08), loud=-17, fo=0.8, do_trim=False) for a in (3.0, 14.0)]


@sound('divine_power', volume=0.85, pitch=(0.96, 1.04), max=2, cooldown=0.15, reverb=0.3)
def divine_power():
    """Divine ability cast: magic spells."""
    out = [finish(OC('MAGSpel_MagicSpell_OS_01'), loud=-12, fo=0.5), finish(OC('MAGSpel_MagicSpell_OS_02'), loud=-12, fo=0.5)]
    out.append(finish(AT('magic-spell-sfx', 'magical-6-0.m4a'), loud=-12, fo=0.4))
    return out


@sound('soul_leave', bus='voice', volume=0.85, pitch=None, max=1, reverb=0.4)
def soul_leave():
    """Soul torn from the bones: rising reversed chime swell + whispers + spell."""
    out = []
    w = OC('VOXWhsp_WhispersCreepyReverb_OS_01')
    for k in range(2):
        chime = OC('MUSCChim_WindChimes_LOOP_02', ch=1)
        swell = fade_in(reverse(fade_out(cut(chime, 3 + k * 6, 6 + k * 6), 1.5)), 0.5)
        sp = trim(OC(f'MAGSpel_MagicSpell_OS_0{k + 1}'))
        wh = fade_in(fade_out(cut(w, 1.0 + k, 3.6 + k), 0.8), 0.4)
        x = reverb(mix((swell, 0, 0), (wh, 0.6, -2), (speed(sp, 0.8), 2.4, -3)), 3.0, 1.8, -9)
        out.append(finish(fade_out(cut(x, 0, 5.6), 1.6), loud=-12, fo=1.5, lead_db=-60))
    return out


@sound('underworld_loop', bus='amb', volume=0.7, pitch=None, folder='amb')
def underworld_loop():
    """Duat (underworld) bed: creepy drone recording, darkened, + a hollow wind layer."""
    d = OC('DSGNDron_DroneCreepy_OS_01', ch=2, start=4.0, dur=36.0)
    d = fx(d, 'lowpass=f=3500')
    hw = AT('random-sfx', 'hollow-wind.m4a', ch=2)
    while sec(len(hw)) < 34:
        hw = np.concatenate([hw, hw[::-1]])
    hw = fx(cut(hw, 0, 34), 'lowpass=f=1800')
    y = mix((d, 0, 0), (norm_peak(hw, -6), 0, -10))
    y = seamless(y, 30.0, 3.0)
    return [norm_peak(gain(y, -24 - rms_db(y)), -3)]


@sound('anubis_roar', bus='voice', volume=1.0, pitch=(0.97, 1.03), max=1, cooldown=1.0, reverb=0.4, ref=30)
def anubis_roar():
    """Anubis: giant death-scream and roar, pitched down into a jackal-god bellow, huge hall tail."""
    gs = trim(OC('CREAHmn_GiantDeathScream_OS_01'))
    r4 = trim(AT('80-cc0-creture-sfx-2', 'roar-04.m4a'))
    a = reverb(mix((speed(cut(gs, 0, 2.2), 0.82), 0, 0), (speed(r4, 0.68), 0.05, -3)), 3.2, 1.6, -9)
    howl = trim(AT('80-cc0-creature-sfx', 'howl.m4a'))
    b = reverb(mix((speed(howl, 0.62), 0, 0), (speed(r4, 0.6), 0.0, -2), (speed(cut(gs, 0.5, 2.0), 0.75), 0.15, -6)), 3.2, 1.6, -9)
    return [finish(sat(a, 2), loud=-9, fo=1.6), finish(sat(b, 2), loud=-9, fo=1.6)]


@sound('scales', volume=0.7, pitch=(0.97, 1.03), max=2, cooldown=0.2, reverb=0.3)
def scales():
    """Scales of Ma'at tipping: chain links + ringing metal pans."""
    out = []
    for i in (1, 2):
        ch = trim(KN(f'oga-rpg-pack/RPG Sound Pack/inventory/chainmail{i}.wav'))
        ring = trim(KN('oga-rpg-pack/RPG Sound Pack/inventory/metal-ringing.wav'))
        sm = trim(KN(f'oga-rpg-pack/RPG Sound Pack/inventory/metal-small{i + 1}.wav'))
        out.append(finish(mix((ch, 0, 0), (sm, 0.1, -3), (ring, 0.15, -8)), loud=-15, fo=0.5))
    return out


@sound('resurrect', volume=1.0, pitch=None, max=1, reverb=0.35)
def resurrect():
    """Bones rebuilding from sand: gong swell, rattling bones, sand eruption, magic."""
    out = []
    for k in range(2):
        gong = trim(AT('100-cc0-sfx', 'gong-02.m4a'))
        bones = mix((trim(KN('casino-audio/dice-shake-1.ogg')), 0, 0), (trim(KN('casino-audio/dice-shake-3.ogg')), 0.35, -2), (trim(KN('casino-audio/dice-throw-2.ogg')), 0.8, -3))
        sandb = trim(KN(f'impact-sounds/impactSoft_heavy_00{k}.ogg'))
        rush = fx(speed(trim(AT('20-rustles-dry-leaves', 'rustle10.m4a')), 0.6), 'highpass=f=400')
        mag = trim(OC(f'MAGSpel_MagicSpell_OS_0{k + 1}'))
        x = mix((rush, 0, -4), (bones, 0.3, -3), (sandb, 1.25, 0), (mag, 1.2, -2), (speed(gong, 0.75), 1.3, -4))
        out.append(finish(reverb(x, 2.4, 2.0, -12), loud=-11, fo=1.4))
    return out


@sound('ult_ready', bus='ui', volume=0.75, pitch=None, max=1, cooldown=1.0)
def ult_ready():
    """Ultimate charged: power-up shimmer."""
    return [finish(OC(f'UIMisc_Powerup_OS_0{i}'), loud=-14, fo=0.4) for i in (1, 2)]


@sound('ult_activate', volume=1.0, pitch=None, max=1, cooldown=0.5, reverb=0.35)
def ult_activate():
    """Ultimate unleashed: gong hit + spell + roar + big whoosh."""
    out = []
    for k in range(2):
        gong = trim(AT('100-cc0-sfx', f'gong-0{k + 1}.m4a'))
        sp = trim(OC(f'MAGSpel_MagicSpell_OS_0{k + 1}'))
        roar = fx(speed(trim(AT('80-cc0-creture-sfx-2', ['roar-05.m4a', 'roar-06.m4a'][k])), 0.7), 'lowpass=f=2500')
        wh = speed(trim(OC('WHSH_WhooshMedium_OS_02')), 0.6)
        x = mix((wh, 0, -2), (gong, 0.12, 0), (sp, 0.1, -2), (roar, 0.2, -3))
        out.append(finish(sat(reverb(x, 2.5, 2.0, -11), 2), loud=-9, fo=1.2))
    return out


@sound('spectral_scorpion', bus='voice', volume=0.95, pitch=(0.96, 1.04), max=1, cooldown=0.6, reverb=0.4, ref=24)
def spectral_scorpion():
    """Serket's giant spectral scorpion: reverberant creature screech + slowed chitter + whispers."""
    out = []
    w = OC('VOXWhsp_WhispersCreepyReverb_OS_01')
    for k, n in enumerate(('CREAMnstr_CreatureCreepyReverb_OS_02', 'CREAMnstr_CreatureCreepyReverb_OS_03')):
        c = trim(OC(n))
        ch = speed(trim(AT('80-cc0-creature-sfx', 'bug-04.m4a')), 0.5)
        wh = fade_out(cut(w, 0.5 + k, 2.5 + k), 0.6)
        x = mix((speed(c, 0.85), 0, 0), (ch, 0.1, -4), (ch, 0.5, -7), (wh, 0.2, -10))
        out.append(finish(reverb(x, 2.6, 1.8, -10), loud=-10, fo=1.2))
    return out


@sound('time_slow', volume=0.8, pitch=None, max=1, cooldown=0.3)
def time_slow():
    """Time slows: reversed slowed whoosh swelling into a low thunder drop."""
    out = []
    thunder = AT('100-cc0-sfx-2', 'sfx100v2-thunder-01.m4a')
    for k in (1, 3):
        wh = reverse(speed(trim(OC(f'WHSH_WhooshMedium_OS_0{k}')), 0.45))
        low = fade_out(fx(speed(cut(thunder, 0.6, 2.4), 0.6), 'lowpass=f=200'), 1.0)
        x = mix((wh, 0, 0), (norm_peak(low, -3), sec(len(wh)) - 0.05, -4))
        out.append(finish(x, loud=-13, fo=0.9, lead_db=-55))
    return out


# ===========================================================================
# NPCs / FUN
# ===========================================================================
@sound('merchant_greet', bus='voice', volume=0.7, pitch=(0.92, 1.0), max=1, cooldown=1.0, ref=8)
def merchant_greet():
    """Old merchant chuckles (slightly slowed for age)."""
    return [finish(speed(OC(f'VOXLaff_Male02Laugh_OS_0{i}'), 0.9), loud=-15, fo=0.3) for i in (1, 2, 3)]


@sound('camel_grunt', bus='voice', volume=0.7, pitch=(0.9, 1.05), max=2, cooldown=0.5, ref=8)
def camel_grunt():
    """Camel grumbles: grunts + burps pitched down."""
    out = [finish(fx(speed(AT('80-cc0-creature-sfx', f), 0.78), 'lowpass=f=4000'), loud=-14, fo=0.2) for f in ('grunt-01.m4a', 'burp-01.m4a')]
    out.append(finish(speed(KN('oga-rpg-pack/RPG Sound Pack/misc/burp.wav'), 0.85), loud=-14, fo=0.2))
    return out


@sound('camel_spit', bus='voice', volume=0.75, pitch=(0.94, 1.08), max=2, cooldown=0.4, ref=8)
def camel_spit():
    """Camel spit."""
    return [finish(AT('80-cc0-creature-sfx', f'spit-0{i}.m4a'), loud=-13, fo=0.1) for i in (1, 2, 3)]


@sound('duck_quack', bus='sfx', volume=0.75, pitch=(0.96, 1.06), max=2, cooldown=0.15, ref=6)
def duck_quack():
    """A real duck quacking (split into single quacks)."""
    x = OC('BIRDFowl_Duck_OS_01')
    ts = onsets(x, 4, min_gap=0.25, floor_db=-20, rise_db=8) or [first_onset(x)]
    out = []
    for k, t in enumerate(ts):
        nxt = ts[k + 1] if k + 1 < len(ts) else t + 0.6
        out.append(finish(cut(x, t - 0.01, min(nxt - 0.01, t + 0.6)), loud=-14, fo=0.08))
    out.append(finish(x, loud=-14, fo=0.15))  # the full triple-quack as a bonus variation
    return out


@sound('squeak', bus='sfx', volume=0.6, pitch=(0.95, 1.15), max=2, cooldown=0.1, ref=6)
def squeak():
    """Squeaky toy / tiny critter squeaks (cute creature vocals)."""
    return [finish(speed(AT('80-cc0-creature-sfx', f'cute-{i:02d}.m4a'), 1.2), loud=-16, fo=0.06) for i in (1, 4, 7)]


@sound('chicken', bus='sfx', volume=0.6, pitch=(0.95, 1.05), max=2, cooldown=0.5, ref=8)
def chicken():
    """Outpost chicken clucks."""
    x = OC('BIRDFowl_Chicken_OS_01')
    return [finish(cut(x, 0.0, 1.6), loud=-16, fo=0.2), finish(cut(x, 1.5, 3.3), loud=-16, fo=0.2)]


@sound('mining_hit', volume=0.8, pitch=(0.94, 1.06), max=3, cooldown=0.04)
def mining_hit():
    """Pickaxe on ore."""
    return [finish(KN(f'impact-sounds/impactMining_00{i}.ogg'), loud=-12, fo=0.12) for i in range(5)]


@sound('ore_crack', volume=0.85, pitch=(0.94, 1.06), max=2, cooldown=0.1)
def ore_crack():
    """Ore node cracks open: rock breaking + stone items."""
    out = []
    for b, s in (('bfh1-rock-breaking-01.m4a', 'item-stone-01.m4a'), ('bfh1-rock-breaking-03.m4a', 'item-stone-03.m4a'), ('bfh1-rock-breaking-02.m4a', 'item-stone-04.m4a')):
        br = trim(AT('75-cc0-breaking-falling-hit-sfx', b))
        st = trim(AT('80-cc0-rpg-sfx', s))
        out.append(finish(mix((br, 0, 0), (st, 0.08, -4)), loud=-12, fo=0.3))
    return out


@sound('gem_chime', bus='ui', volume=0.65, pitch=(0.96, 1.06), max=3, cooldown=0.05)
def gem_chime():
    """Gem collected."""
    return [finish(AT('80-cc0-rpg-sfx', f'item-gem-0{i}.m4a'), loud=-15, fo=0.1) for i in (1, 2, 3, 4)]


@sound('door_creak', volume=0.7, pitch=(0.94, 1.06), max=1, cooldown=0.3)
def door_creak():
    """Saloon doors / old wood creaks."""
    out = [finish(KN(f'rpg-audio/creak{i}.ogg'), loud=-16, fo=0.2) for i in (1, 3)]
    out.append(finish(cut(trim(OC('WOODFric_CreaksCreepy_OS_01')), 0, 1.6), loud=-16, fo=0.5))
    return out


@sound('banjo_funny', bus='music', volume=0.8, pitch=None, max=1, cooldown=1.0)
def banjo_funny():
    """Humorous banjo sting (for dumb deaths / comedy beats)."""
    return [finish(OC(f'MUSCStngr_BanjoHumorous_OS_0{i}'), loud=-12, fo=0.6) for i in (1, 2)]


@sound('sting_positive', bus='music', volume=0.8, pitch=None, max=1, cooldown=1.0)
def sting_positive():
    """Acoustic guitar positive stinger."""
    return [finish(OC(f'MUSCStngr_AcousticGuitarPositive_OS_0{i}'), loud=-12, fo=0.6) for i in (1, 2)]


@sound('sting_negative', bus='music', volume=0.8, pitch=None, max=1, cooldown=1.0)
def sting_negative():
    """Acoustic guitar negative stinger."""
    return [finish(OC('MUSCStngr_AcousticGuitarNegative_OS_01'), loud=-12, fo=0.8)]


@sound('heal', volume=0.75, pitch=(0.97, 1.04), max=2, cooldown=0.2)
def heal():
    """Healing: cork pop + gulp-like slosh + soft power-up shimmer."""
    out = []
    for f in ('bottle-glass-uncork-02.m4a', 'bottle-glass-uncork-04.m4a'):
        un = trim(AT('fantasy-accessory-sfx-library', f))
        pu = fade_out(trim(OC('UIMisc_Powerup_OS_02')), 0.5)
        out.append(finish(mix((un, 0, 0), (pu, 0.12, -9)), loud=-14, fo=0.4))
    return out


@sound('bandage', volume=0.75, pitch=(0.96, 1.05), max=1, cooldown=0.2)
def bandage():
    """Wrapping a bandage: cloth handling + quick linen tear."""
    out = []
    tear = trim(OC('PAPRRip_PaperTear_OS_01'))
    for i in (1, 3):
        c = trim(KN(f'rpg-audio/cloth{i}.ogg'))
        c2 = trim(OC(f'CLOTHMvmt_ClothingMovement_OS_0{i}'))
        out.append(finish(mix((tear, 0, -2), (c, 0.25, 0), (c2, 0.45, -3)), loud=-14, fo=0.25))
    return out


@sound('dagger_stab', volume=0.85, pitch=(0.95, 1.05), max=2, cooldown=0.1)
def dagger_stab():
    """Sacrificial dagger: blade slice + stab + squish."""
    out = []
    for i, k in ((1, 'knifeSlice.ogg'), (2, 'knifeSlice2.ogg')):
        kn = trim(KN(f'rpg-audio/{k}'))
        p = trim(KN(f'impact-sounds/impactPunch_medium_00{i}.ogg'))
        sq = trim(AT('8-wet-squish-slurp-impacts', f'impactsplat0{i + 2}-mp3.m4a'))
        out.append(finish(mix((kn, 0, 0), (p, 0.06, -3), (sq, 0.07, -6)), loud=-12, fo=0.2))
    return out


@sound('smoke_bomb', volume=0.85, pitch=(0.95, 1.05), max=2, cooldown=0.2)
def smoke_bomb():
    """Smoke bomb: muffled pop + long gas hiss."""
    out = []
    air = AT('100-cc0-sfx-2', 'sfx100v2-air-01.m4a')
    for b in ('bang-05.m4a', 'bang-08.m4a'):
        pop = fx(trim(AT('25-cc0-bang-firework-sfx', b)), 'lowpass=f=1800')
        hiss = fade_out(fx(trim(air), 'highpass=f=1200'), 1.0)
        out.append(finish(mix((pop, 0, 0), (hiss, 0.03, -5)), loud=-12, fo=0.8))
    return out


@sound('shield_up', volume=0.8, pitch=(0.97, 1.03), max=1, cooldown=0.2, reverb=0.2)
def shield_up():
    """Shield raised: metal plate + magic shimmer."""
    out = []
    for i in (1, 4):
        m = trim(KN(f'impact-sounds/impactMetal_heavy_00{i}.ogg'))
        sp = fade_out(trim(OC('MAGSpel_MagicSpell_OS_01')), 0.8)
        out.append(finish(mix((m, 0, 0), (sp, 0.0, -6)), loud=-12, fo=0.6))
    return out


@sound('charm', bus='ui', volume=0.7, pitch=(0.97, 1.05), max=1, cooldown=0.2)
def charm():
    """Divine charm: small bell + gem tinkle."""
    out = []
    for g in ('item-gem-04.m4a', 'item-gem-01.m4a'):
        b = trim(AT('100-cc0-sfx', 'bell-02.m4a'))
        gm = trim(AT('80-cc0-rpg-sfx', g))
        out.append(finish(mix((b, 0, 0), (gm, 0.05, -3)), loud=-15, fo=0.3))
    return out


def _thump(i: int) -> np.ndarray:
    t = trim(KN(f'impact-sounds/impactSoft_heavy_00{i}.ogg'))
    t = fx(t, 'lowpass=f=140,lowpass=f=140')
    return fade_out(norm_peak(cut(t, 0, 0.22), -1), 0.12)


@sound('heartbeat', volume=0.8, pitch=None, max=1, cooldown=0.3)
def heartbeat():
    """Heartbeat 'lub-dub' built from low-passed soft impact recordings."""
    out = []
    for i in (0, 3):
        a, b = _thump(i), _thump(i + 1)
        out.append(finish(mix((a, 0, 0), (b, 0.2, -4)), loud=-13, fo=0.1))
    return out


@sound('low_health_alarm', volume=0.5, pitch=None, max=1, cooldown=1.2)
def low_health_alarm():
    """Subtle low-health cue: slow heartbeat pair (loop by re-triggering every ~1.6 s)."""
    a, b = _thump(1), _thump(2)
    x = pad(mix((a, 0, 0), (b, 0.22, -5)), 0.2)
    return [finish(x, loud=-16, fo=0.1)]


@sound('level_transition', volume=0.9, pitch=None, max=1, cooldown=1.0, reverb=0.3)
def level_transition():
    """Region transition: big whoosh + thunder roll + wind surge."""
    out = []
    for k, t0 in enumerate((262.0, 228.0)):
        wh = speed(trim(OC(f'WHSH_WhooshMedium_OS_0{k + 1}')), 0.5)
        storm = OM('storm.ogg', start=t0, dur=4.0, ch=1)
        th = fade_out(fx(storm, 'lowpass=f=900'), 1.5)
        gust = fade_in(fade_out(fx(OM('wind.ogg', start=208 + k * 6, dur=3.0, ch=1), 'highpass=f=300'), 1.2), 0.5)
        x = mix((gust, 0, -2), (wh, 0.6, 0), (norm_peak(th, -3), 0.8, -3))
        out.append(finish(x, loud=-11, fo=1.4, lead_db=-50))
    return out


# ===========================================================================
# AMBIENCE LOOPS (stereo, pre-crossfaded seamless)
# ===========================================================================
def _amb(x: np.ndarray, length: float, xf: float, rms_target: float) -> np.ndarray:
    y = seamless(x, length, xf)
    y = gain(y, rms_target - rms_db(y))
    return limit(y, -2.0)


@sound('wind_loop', bus='amb', volume=0.7, pitch=None, folder='amb')
def wind_loop():
    """Desert wind (felix.blume, 'wind on bushes ... close to desert ground', Freesound 711106, CC0)."""
    x = OM('wind.ogg', start=118, dur=34, ch=2)
    return [_amb(x, 30, 3.0, -24)]


@sound('storm_loop', bus='amb', volume=0.8, pitch=None, folder='amb')
def storm_loop():
    """Sandstorm: gusty desert wind layered with a slowed dark copy (roar) and a high grain-hiss copy."""
    a = OM('wind.ogg', start=188, dur=40, ch=2)
    b = fx(speed(OM('wind.ogg', start=150, dur=40, ch=2), 0.8), 'lowpass=f=900')
    c = fx(OM('wind.ogg', start=205, dur=40, ch=2), 'highpass=f=2500')
    y = mix((a, 0, 0), (norm_peak(b, -3), 0, -2), (norm_peak(c, -6), 0, -8))
    y = fx(y, 'acompressor=threshold=-18dB:ratio=3:attack=20:release=400')
    return [_amb(y, 32, 3.0, -19)]


@sound('night_loop', bus='amb', volume=0.6, pitch=None, folder='amb')
def night_loop():
    """Night crickets (felix.blume, Freesound 476672, CC0)."""
    x = OM('crickets.ogg', start=40, dur=27, ch=2)
    return [_amb(x, 24, 2.5, -27)]


@sound('saloon_loop', bus='amb', volume=0.55, pitch=None, folder='amb')
def saloon_loop():
    """Saloon murmur: restaurant crowd recording, muffled as if from the next room + room tone."""
    x = fx(OC('CRWDConv_Restaurant_LOOP_01', ch=2, start=3, dur=31), 'lowpass=f=5200,highpass=f=90')
    rt = OC('AMBHome_RoomTone_LOOP_01', ch=2)
    while sec(len(rt)) < 31:
        rt = np.concatenate([rt, rt])
    y = mix((x, 0, 0), (cut(rt, 0, 31), 0, -6))
    return [_amb(y, 28, 2.5, -27)]


@sound('water_loop', bus='amb', volume=0.6, pitch=None, folder='amb', ref=10)
def water_loop():
    """Oasis water lapping."""
    x = OC('WATRLap_WaterLapping_LOOP_01', ch=2, start=2, dur=27)
    return [_amb(x, 24, 2.5, -27)]


# ===========================================================================
# INSTRUMENTS (Meta Open Sound, CC0) - consumed by src/game/audio/Music.ts
# ===========================================================================
NOTE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']


def midi_of(n: str) -> int:
    name, octv = n[:-1], int(n[-1])
    return 12 * (octv + 1) + NOTE_NAMES.index(name)


# instrument -> list of (note, string, velocity layers, keep seconds)
INSTR = {
    'steel': {
        'notes': [('E2', 'LowE', 5.0), ('G2', 'LowE', 4.5), ('As2', 'A', 4.2), ('Cs3', 'A', 4.0), ('E3', 'D', 3.8), ('G3', 'G', 3.6),
                  ('As3', 'G', 3.4), ('Cs4', 'B', 3.2), ('E4', 'HighE', 3.2), ('G4', 'HighE', 3.0), ('As4', 'HighE', 2.8),
                  ('Cs5', 'HighE', 2.6), ('E5', 'HighE', 2.5), ('G5', 'HighE', 2.4), ('As5', 'HighE', 2.2)],
        'layers': [('Vel02', 2, -6.0), ('Vel03', 3, -3.0)],
        'pattern': 'meta-steel-guitar/ogg/INSGuitarSteel_String{s}_{v}_{n}_01.ogg',
    },
    'nylon': {
        'notes': [('E2', 'LowE', 5.0), ('G2', 'LowE', 4.6), ('As2', 'A', 4.4), ('Cs3', 'A', 4.2), ('E3', 'D', 4.0), ('G3', 'G', 3.8),
                  ('As3', 'G', 3.6), ('Cs4', 'B', 3.4), ('E4', 'HighE', 3.4), ('G4', 'HighE', 3.2), ('As4', 'HighE', 3.0), ('Cs5', 'HighE', 2.8), ('E5', 'HighE', 2.6)],
        'layers': [('Vel01Finger', 1, -6.0)],
        'pattern': 'meta-nylon-guitar/ogg/INSGuitarNylon_String{s}_{v}_{n}_01.ogg',
    },
    'piano': {
        'notes': [('A1', None, 3.4), ('C2', None, 3.2), ('Ds2', None, 3.0), ('Fs2', None, 3.0), ('A2', None, 2.8), ('C3', None, 2.6),
                  ('Ds3', None, 2.5), ('Fs3', None, 2.4), ('A3', None, 2.3), ('C4', None, 2.2), ('Ds4', None, 2.1), ('Fs4', None, 2.0),
                  ('A4', None, 1.9), ('C5', None, 1.8), ('Ds5', None, 1.7), ('Fs5', None, 1.6), ('A5', None, 1.5), ('C6', None, 1.4)],
        'layers': [('Vel03', 3, -4.0)],
        'pattern': 'meta-piano/ogg/INSPiano_{v}_{n}_01.ogg',
    },
}
INST_TABLE: dict[str, list[dict]] = {}


def build_instruments():
    for inst, spec in INSTR.items():
        rows = []
        for note, string, keep in spec['notes']:
            for layer, vel, pk in spec['layers']:
                rel = spec['pattern'].format(s=string, v=layer, n=note)
                _cur_sources.clear()
                x = load('IN', rel)
                x = trim(x, lead_db=-36, tail_db=-80, pre=0.002)
                x = cut(x, 0, keep)
                x = fade_out(norm_peak(x, pk), min(0.9, keep * 0.35), curve=1.6)
                out_rel = f'inst/{inst}/{note}_v{vel}.mp3'
                save(x, out_rel, kbps=80)
                PROV[out_rel] = dict(id=f'inst:{inst}', sources=list(_cur_sources), license=LICENSE_OF['IN'])
                rows.append(dict(note=note, midi=midi_of(note), vel=vel, file=out_rel))
        INST_TABLE[inst] = rows
        print(f'  inst {inst}: {len(rows)} samples')


# ===========================================================================
# build driver
# ===========================================================================
FAILED: list[str] = []


def build_recipe(rid: str) -> list[str]:
    r = RECIPES[rid]
    _cur_sources.clear()
    t0 = time.time()
    try:
        arrs = r['fn']()
    except Exception as e:  # report and continue so one bad source doesn't stop the build
        import traceback
        traceback.print_exc()
        FAILED.append(f'{rid}: {e}')
        return []
    files = []
    for k, a in enumerate(arrs):
        if a is None or len(a) == 0:
            continue
        name = rid if len(arrs) == 1 else f'{rid}_{k + 1}'
        rel = f"{r['folder']}/{name}.mp3"
        save(a, rel)
        files.append(rel)
        lic = sorted({LICENSE_OF[s.split(':')[0]] for s in _cur_sources})
        PROV[rel] = dict(id=rid, sources=list(_cur_sources), license=lic, note=r['note'][:200])
    r['files'] = files
    durs = [sec(len(a)) for a in arrs if a is not None]
    print(f'  {rid:22s} {len(files)} file(s)  {min(durs):.2f}-{max(durs):.2f}s  [{time.time() - t0:.1f}s]')
    return files


def write_manifest():
    lines = [
        '// AUTO-GENERATED by tools/build_audio.py - do not edit by hand (re-run the script).',
        '// Every sound is cut/layered/processed from real recordings; see CREDITS.md and',
        '// tools/audio_provenance.json for the exact source files.',
        "import type { SoundDef } from '../../engine/audio/AudioEngine';",
        '',
    ]
    ids = sorted(RECIPES.keys())
    lines.append('export const SOUND_IDS = [')
    for i in ids:
        lines.append(f"  '{i}',")
    lines.append('] as const;')
    lines.append('export type SoundId = (typeof SOUND_IDS)[number];')
    lines.append('')
    lines.append('export const SOUNDS: Record<SoundId, SoundDef> = {')
    for i in ids:
        r = RECIPES[i]
        files = r.get('files') or []
        m = r['meta']
        parts = ['files: [' + ', '.join(f"'{f}'" for f in files) + ']']
        if m['volume'] != 1.0:
            parts.append(f"volume: {m['volume']}")
        if m['pitch']:
            parts.append(f"pitch: [{m['pitch'][0]}, {m['pitch'][1]}]")
        parts.append(f"bus: '{m['bus']}'")
        if m['max'] is not None:
            parts.append(f"max: {m['max']}")
        if m['cooldown'] is not None:
            parts.append(f"cooldown: {m['cooldown']}")
        if m['reverb'] is not None:
            parts.append(f"reverb: {m['reverb']}")
        if m['ref'] is not None:
            parts.append(f"ref: {m['ref']}")
        doc = r['note'].split('\n')[0].replace('*/', '')
        lines.append(f'  /** {doc} */')
        lines.append(f"  {i}: {{ {', '.join(parts)} }},")
    lines.append('};')
    lines.append('')
    lines.append('/** Ids that are seamless loops (play with AudioEngine.loop). */')
    lines.append('export const LOOP_IDS: SoundId[] = [' + ', '.join(f"'{i}'" for i in ids if i.endswith('_loop')) + '];')
    lines.append('')
    lines.append('export interface InstrumentSample {')
    lines.append('  note: string;')
    lines.append('  midi: number;')
    lines.append('  /** velocity layer (1 soft .. 3 hard) */')
    lines.append('  vel: number;')
    lines.append('  /** relative to the audio base path */')
    lines.append('  file: string;')
    lines.append('}')
    lines.append('')
    lines.append('/** Meta Open Sound (CC0) instrument samples used by Music.ts */')
    lines.append('export const INSTRUMENTS: Record<\'steel\' | \'nylon\' | \'piano\', InstrumentSample[]> = {')
    for inst in ('steel', 'nylon', 'piano'):
        rows = INST_TABLE.get(inst, [])
        lines.append(f'  {inst}: [')
        for r in rows:
            lines.append(f"    {{ note: '{r['note']}', midi: {r['midi']}, vel: {r['vel']}, file: '{r['file']}' }},")
        lines.append('  ],')
    lines.append('};')
    MANIFEST_TS.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_TS.write_text('\n'.join(lines) + '\n')


def load_previous_state():
    """When building a subset, keep file lists of the other recipes from the existing provenance."""
    p = Path(__file__).resolve().parent / 'audio_provenance.json'
    if not p.exists():
        return
    prev = json.loads(p.read_text())
    for rel, info in prev.get('files', {}).items():
        PROV.setdefault(rel, info)
        rid = info.get('id', '')
        if rid in RECIPES:
            RECIPES[rid].setdefault('files', [])
            if rel not in RECIPES[rid]['files'] and (OUT / rel).exists():
                RECIPES[rid]['files'].append(rel)
    for inst, rows in prev.get('instruments', {}).items():
        INST_TABLE.setdefault(inst, rows)


def main(argv: list[str]):
    if '--list' in argv:
        for rid, r in sorted(RECIPES.items()):
            print(f"{rid:24s} {r['note'][:90]}")
        return
    only_inst = '--inst' in argv
    prefixes = [a for a in argv if not a.startswith('--')]
    t0 = time.time()
    if prefixes or only_inst:
        load_previous_state()
    if not prefixes:
        print('instruments:')
        build_instruments()
    if not only_inst:
        print('sounds:')
        for rid in sorted(RECIPES):
            if prefixes and not any(rid.startswith(p) for p in prefixes):
                continue
            # rebuilt recipes replace their file list
            RECIPES[rid]['files'] = []
            for rel in [k for k, v in PROV.items() if v.get('id') == rid]:
                PROV.pop(rel, None)
            build_recipe(rid)
    # provenance + manifest
    used = sorted({s for v in PROV.values() for s in v.get('sources', [])})
    prov = dict(
        generated_by='tools/build_audio.py',
        license_note='All sources CC0 except files whose license lists the Oculus Audio Pack 01 (CC BY 4.0, credit in CREDITS.md).',
        source_roots={k: f'{SRC[v[0]]}/{v[1]}' for k, v in ROOTS.items()},
        files=dict(sorted(PROV.items())),
        instruments=INST_TABLE,
        all_sources=used,
    )
    (Path(__file__).resolve().parent / 'audio_provenance.json').write_text(json.dumps(prov, indent=1))
    write_manifest()
    if FAILED:
        print('FAILED recipes:\n  ' + '\n  '.join(FAILED))
    total = sum(f.stat().st_size for f in OUT.rglob('*.mp3'))
    print(f'done in {time.time() - t0:.0f}s; {len(list(OUT.rglob("*.mp3")))} mp3 files, {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1:])
