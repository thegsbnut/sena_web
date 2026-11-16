# Original background music, synthesized from scratch (no samples, no copyright).
# 120 BPM, C major, I–V–vi–IV, 16 bars = 32 s. Last 4 bars = softer music-box outro.
import numpy as np, wave, sys

SR = 44100
BPM = 120
BEAT = 60 / BPM
BARS = int(sys.argv[2]) if len(sys.argv) > 2 else 16
OUTRO = int(sys.argv[3]) if len(sys.argv) > 3 else 12
DUR = BARS * 4 * BEAT + 1.5
N = int(DUR * SR)
out = np.zeros((N, 2))

def midi(n):
    return 440 * 2 ** ((n - 69) / 12)

def env(n, a=0.005, d=0.25):
    t = np.arange(n) / SR
    e = np.minimum(t / a, 1) * np.exp(-t / d)
    return e

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    s = sig[: j - i] * gain
    out[i:j, 0] += s * (1 - pan) / 2 * 2 ** 0.5
    out[i:j, 1] += s * (1 + pan) / 2 * 2 ** 0.5

def tone(freq, length, kind="tri", a=0.005, d=0.25):
    n = int(length * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * freq * t
    if kind == "sine":
        w = np.sin(ph)
    elif kind == "tri":
        w = 2 / np.pi * np.arcsin(np.sin(ph))
    elif kind == "square":
        w = sum(np.sin(ph * k) / k for k in (1, 3, 5, 7)) * 0.8
    elif kind == "bell":
        w = np.sin(ph) + 0.35 * np.sin(ph * 2.01) + 0.15 * np.sin(ph * 3.98)
    return w * env(n, a, d)

rng = np.random.default_rng(7)

def kick(start):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    w = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    add(w, start, 0, 0.9)

def clap(start):
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    w = rng.standard_normal(n) * np.exp(-t * 28)
    w = np.convolve(w, np.ones(6) / 6, mode="same")
    add(w, start, 0, 0.32)

def hat(start, g=0.1):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    w = np.diff(rng.standard_normal(n + 1)) * np.exp(-t * 90)
    add(w, start, 0.3, g)

# chords: (root midi, triad)
PROG = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [57, 60, 64]), (41, [57, 60, 65])]
# catchy hook, 8th notes per bar (None = rest)
HOOK = [
    [72, None, 76, 79, 76, None, 74, 72],
    [74, None, 71, 74, 79, None, 77, 74],
    [76, None, 72, 76, 81, None, 79, 76],
    [77, 76, 74, 72, 74, None, None, None],
]

for bar in range(BARS):
    t0 = bar * 4 * BEAT
    root, triad = PROG[bar % 4]
    outro = bar >= OUTRO
    intro = bar < 2
    # pad
    for n in triad:
        add(tone(midi(n), 4 * BEAT, "sine", a=0.3, d=3.0), t0, -0.2, 0.07)
    if outro:
        # music box arps
        arp = triad + [triad[0] + 12, triad[1] + 12, triad[0] + 12, triad[2], triad[1]]
        for k in range(8):
            add(tone(midi(arp[k] + 12), 0.8, "bell", d=0.5), t0 + k * BEAT / 2, 0.25, 0.10)
        add(tone(midi(root), 4 * BEAT, "sine", a=0.05, d=2.0), t0, 0, 0.18)
        continue
    # bass eighths
    for k in range(8):
        n = root if k % 4 != 3 else root + 7
        add(tone(midi(n), BEAT / 2, "tri", d=0.18), t0 + k * BEAT / 2, 0, 0.30)
    # drums
    for b in range(4):
        if not intro or b == 0:
            kick(t0 + b * BEAT)
        if b in (1, 3) and not intro:
            clap(t0 + b * BEAT)
        hat(t0 + b * BEAT + BEAT / 2, 0.08)
        if not intro:
            hat(t0 + b * BEAT + BEAT / 4, 0.035)
    # hook lead (pluck square) – plays from bar 2
    if not intro:
        for k, n in enumerate(HOOK[bar % 4]):
            if n is not None:
                add(tone(midi(n), 0.4, "square", d=0.14), t0 + k * BEAT / 2, 0.15, 0.085)
    # chord stabs on offbeats
    for b in range(4):
        for n in triad:
            add(tone(midi(n + 12), 0.15, "tri", d=0.06), t0 + b * BEAT + BEAT / 2, -0.35, 0.03)

# final chime on the last downbeat
end = BARS * 4 * BEAT
for n in (72, 76, 79, 84):
    add(tone(midi(n), 1.5, "bell", d=0.9), end - 0.02, 0, 0.12)

# simple stereo reverb-ish smear
dl = int(0.11 * SR)
out[dl:, 0] += out[:-dl, 1] * 0.22
out[dl:, 1] += out[:-dl, 0] * 0.22

# fade in/out
fi = int(0.05 * SR)
out[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(1.2 * SR)
out[-fo:] *= np.linspace(1, 0, fo)[:, None]
out /= np.max(np.abs(out)) * 1.12

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("ok", DUR)
