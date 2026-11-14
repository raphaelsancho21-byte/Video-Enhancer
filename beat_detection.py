"""Offline beat/transient detection using FFmpeg PCM streaming, bounded memory.

This detects prominent rhythmic onsets rather than identifying musical meter.
Only analyzed on request; results are cached by input SHA-256.
"""
from __future__ import annotations
import array
import hashlib
import math
import subprocess
import threading
from collections import deque

_CACHE = {}
_LOCK = threading.Lock()
SAMPLE_RATE = 11025
HOP = 512
MAX_DURATION = 20 * 60


def detect_beats(path, ffmpeg):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    digest = h.hexdigest()
    with _LOCK:
        if digest in _CACHE:
            return _CACHE[digest]

    process = subprocess.Popen(
        [ffmpeg, "-v", "error", "-nostdin", "-i", str(path),
         "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-t", str(MAX_DURATION),
         "-f", "s16le", "-acodec", "pcm_s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    flux = []
    waveform = []
    previous = 0
    try:
        while len(flux) * HOP / SAMPLE_RATE < MAX_DURATION:
            block = process.stdout.read(HOP * 2)
            if len(block) < HOP * 2:
                break
            samples = array.array("h")
            samples.frombytes(block)
            if len(samples) != HOP:
                break
            # Envelope's positive changes are robust for kicks and snares,
            # and require negligible memory compared to full spectrum analysis.
            rms = math.sqrt(sum(x*x for x in samples) / HOP) / 32768
            flux.append(max(0.0, rms - previous))
            waveform.append(rms)
            previous = rms
        process.wait(timeout=15)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

    window = 25
    recent = deque(maxlen=window)
    beats = []
    last = -999
    for i, value in enumerate(flux):
        recent.append(value)
        if i < window:
            continue
        avg = sum(recent) / len(recent)
        # Dynamic threshold + refractory window prevents every transient from
        # becoming a beat marker.
        t = i * HOP / SAMPLE_RATE
        if value > max(0.0025, avg * 2.4) and t - last >= .22:
            beats.append(round(t, 4))
            last = t

    buckets = min(1600, len(waveform))
    envelope = []
    if buckets:
        stride = len(waveform) / buckets
        for j in range(buckets):
            a = int(j * stride)
            b = max(a+1, int((j+1) * stride))
            envelope.append(round(max(waveform[a:b]), 3))
    result = {"beats": beats[:3000], "waveform": envelope,
              "duration": round(len(waveform) * HOP / SAMPLE_RATE, 4),
              "method": "dynamic-transient-energy", "cached": False}
    with _LOCK:
        if len(_CACHE) >= 12:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[digest] = result
    return result
