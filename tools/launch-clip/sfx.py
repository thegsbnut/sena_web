# Synthesized UI sound effects timed to clip.html.
# usage: python3 sfx.py music.wav mix.wav build/sfx.json
import numpy as np, wave, sys

SR = 44100
with wave.open(sys.argv[1]) as w:
    music = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2) / 32767.0
N = len(music)
fx = np.zeros(N)
rng = np.random.default_rng(3)

def put(sig, t, g):
    i = int(t * SR); j = min(N, i + len(sig))
    fx[i:j] += sig[: j - i] * g

def T(d):
    return np.arange(int(d * SR)) / SR

def click(t):
    x = T(0.06); put(np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 120) + rng.standard_normal(len(x)) * np.exp(-x * 300) * 0.3, t, 0.5)

def pop(t, f=520):
    x = T(0.16); fr = f * (1 + 1.2 * np.exp(-x * 40))
    put(np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-x * 22), t, 0.45)

def whoosh(t, d=0.45, g=0.35):
    x = T(d); n = rng.standard_normal(len(x))
    k = np.sin(np.pi * x / d) ** 2
    lp = np.convolve(n, np.ones(25) / 25, mode="same")
    put((n - lp) * k * 0.6 + lp * k * 2, t, g)

def chime(t, notes=(84, 88, 91)):
    for i, m in enumerate(notes):
        f = 440 * 2 ** ((m - 69) / 12); x = T(0.9)
        put((np.sin(2 * np.pi * f * x) + 0.3 * np.sin(4 * np.pi * f * x)) * np.exp(-x * 5), t + i * 0.07, 0.22)

def sparkle(t):
    for i in range(7):
        f = 2000 + rng.random() * 2500; x = T(0.25)
        put(np.sin(2 * np.pi * f * x) * np.exp(-x * 18), t + i * 0.05, 0.12)

def confetti(t):
    for i in range(14):
        x = T(0.05); put(rng.standard_normal(len(x)) * np.exp(-x * 80), t + rng.random() * 0.5, 0.25)
    chime(t, (79, 84, 88, 91))

def aww(t):  # cute descending "puppy eyes" whistle
    x = T(0.6); f = 1100 - 500 * x / 0.6 + 30 * np.sin(2 * np.pi * 7 * x)
    put(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * x / 0.6), t, 0.18)


def key(t):
    x = T(0.035); put(rng.standard_normal(len(x)) * np.exp(-x * 160) * 0.6 + np.sin(2*np.pi*2600*x)*np.exp(-x*200)*0.3, t, 0.28)

import json
fn = {'pop': pop, 'whoosh': whoosh, 'click': click, 'chime': chime, 'key': key, 'confetti': confetti, 'aww': aww, 'sparkle': sparkle,
      'chime3': lambda t: chime(t, (72, 79, 84))}
for name, t in json.load(open(sys.argv[3]))['sfx']:
    fn[name](t)

mix = music * 0.85 + fx[:, None]
mix /= max(1.0, np.max(np.abs(mix)) * 1.05)
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("ok")
