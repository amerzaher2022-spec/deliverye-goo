"""Per-vertex colours for the original figures (linear RGB), painted on the high-detail surface before baking."""
import os

import numpy as np
from PIL import Image

from sculpt import NOISE, smoothstep

HERE = os.path.dirname(os.path.abspath(__file__))


def lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t


class Painter:
    def __init__(self, fig, build):
        self.fig, self.b = fig, build
        self.fns = {}

    def local(self, bone, P):
        M = self.fig.sk.world(bone)
        return (P - M[:3, 3]) @ M[:3, :3]

    def set(self, group, fn):
        self.fns[group] = fn

    def paint(self, P, cls):
        out = np.zeros((len(P), 3))
        for gi, g in enumerate(self.fig.groups):
            sel = cls == gi
            if not sel.any():
                continue
            fn = self.fns.get(g)
            if fn is None:
                out[sel] = lin('#ff00ff')
            elif callable(fn):
                out[sel] = fn(P[sel], self)
            else:
                out[sel] = fn
        return np.clip(out, 0, 1)


# ------------------------------------------------------------------ materials

def solid(hexc, var=0.06, scale=30):
    base = lin(hexc)

    def fn(P, pt):
        n = NOISE.fbm(P, scale, 3)
        return base[None, :] * (1 + var * n[:, None])
    return fn


def fabric(hexc, var=0.08, weave=420, stretch=(1, 1, 1)):
    base = lin(hexc)

    def fn(P, pt):
        n = NOISE.fbm(P * np.asarray(stretch), 24, 3)
        w = 0.5 + 0.5 * np.sin(P[:, 0] * weave) * np.sin(P[:, 1] * weave)
        return base[None, :] * (1 + var * n[:, None] - 0.03 * w[:, None])
    return fn


def denim(hexc='#2f4a6e', fade=0.25):
    base = lin(hexc)
    light = lin('#7d95b3')

    def fn(P, pt):
        twill = 0.5 + 0.5 * np.sin((P[:, 0] + P[:, 1]) * 900)
        n = NOISE.fbm(P * np.array([1, 3, 1]), 18, 3)
        f = np.clip(0.5 + 0.6 * n, 0, 1) * fade
        c = mix(base[None, :], light[None, :], f)
        return c * (0.92 + 0.08 * twill[:, None])
    return fn


def two_tone(hex_a, hex_b, split_fn, var=0.06):
    a, b = lin(hex_a), lin(hex_b)

    def fn(P, pt):
        t = split_fn(P, pt)
        n = NOISE.fbm(P, 30, 2)
        return mix(a[None, :], b[None, :], t) * (1 + var * n[:, None])
    return fn


def decal(base_fn, image, bone, centre, u, v, size, depth=0.05, facing=None):
    """Project an RGBA image onto the surface in a bone's frame.
    centre: local position of the image centre; u, v: local axes for image x (right) and y (up);
    size: (width, height) in metres; facing: local axis the decal faces (skips the far side)."""
    img = np.asarray(Image.open(os.path.join(HERE, 'decals', image)).convert('RGBA'), np.float32) / 255
    rgb = np.where(img[:, :, :3] <= 0.04045, img[:, :, :3] / 12.92, ((img[:, :, :3] + 0.055) / 1.055) ** 2.4)
    alpha = img[:, :, 3]
    H, W = alpha.shape
    centre, u, v = np.asarray(centre, float), np.asarray(u, float), np.asarray(v, float)
    nrm = np.cross(u, v) if facing is None else np.asarray(facing, float)

    def fn(P, pt):
        out = base_fn(P, pt) if callable(base_fn) else np.tile(base_fn, (len(P), 1))
        q = pt.local(bone, P) - centre
        x = q @ u / size[0] + 0.5
        y = 0.5 - q @ v / size[1]
        dz = q @ nrm
        sel = (x >= 0) & (x < 1) & (y >= 0) & (y < 1) & (np.abs(dz) < depth)
        if facing is not None:
            sel &= dz > -depth * 0.2
        if sel.any():
            xi = np.clip((x[sel] * W).astype(int), 0, W - 1)
            yi = np.clip((y[sel] * H).astype(int), 0, H - 1)
            a = alpha[yi, xi][:, None]
            out[sel] = out[sel] * (1 - a) + rgb[yi, xi] * a
        return out
    return fn


# ------------------------------------------------------------------ skin, eyes, lips, hair

SKIN = {'light': '#d9a98a', 'olive': '#c69272', 'tan': '#b07a58', 'brown': '#8d5b3e'}


def skin(tone='olive', stubble=0.0, brows='#2a1d16', brow_w=1.0, blush=0.12):
    base = lin(SKIN.get(tone, tone))
    red = lin('#c05a4c')
    dark = lin(brows)
    beard = lin('#3b3430')

    def fn(P, pt):
        b = pt.b
        s = b.s * b.head
        n = NOISE.fbm(P, 90, 3)
        c = base[None, :] * (1 + 0.05 * n[:, None])
        q = pt.local('head', P) / s
        head = (q[:, 1] > -0.06) & (np.abs(q[:, 0]) < 0.1)
        # warmth on cheeks, nose and ears
        cheek = np.exp(-(((np.abs(q[:, 0]) - 0.038) / 0.02) ** 2 + ((q[:, 1] - 0.045) / 0.018) ** 2 + ((q[:, 2] - 0.07) / 0.03) ** 2))
        nose = np.exp(-((q[:, 0] / 0.012) ** 2 + ((q[:, 1] - 0.045) / 0.015) ** 2 + ((q[:, 2] - 0.112) / 0.01) ** 2))
        ear = np.exp(-(((np.abs(q[:, 0]) - 0.078) / 0.01) ** 2 + ((q[:, 1] - 0.067) / 0.03) ** 2))
        warm = np.clip((cheek * 1.0 + nose * 0.8 + ear * 0.6) * blush, 0, 0.5) * head
        c = mix(c, red[None, :], warm)
        # stubble on the jaw, chin and upper lip
        if stubble > 0:
            below = smoothstep(0.048, 0.032, q[:, 1] + 0.3 * np.abs(q[:, 0]))      # under the cheek line
            above = smoothstep(-0.05, -0.035, q[:, 1])                              # stops under the chin
            front = smoothstep(-0.035, -0.01, q[:, 2])
            amt = stubble * below * above * front * head * (0.75 + 0.25 * NOISE(P, 900))
            c = mix(c, beard[None, :], np.clip(amt, 0, 1))
        # eyebrows: an arc above each eye, denser towards the nose
        ax = np.abs(q[:, 0])
        arc_y = 0.0975 + 0.006 * np.cos(np.clip((ax - 0.032) / 0.022, -1.6, 1.6))
        bw = 0.0042 * brow_w * (1.15 - 0.4 * np.clip((ax - 0.015) / 0.035, 0, 1))
        brow = (ax > 0.011) & (ax < 0.054) & (q[:, 2] > 0.06) & head
        bt = np.exp(-((q[:, 1] - arc_y) / bw) ** 2) * brow * (0.75 + 0.25 * NOISE(P * np.array([1, 4, 1]), 1500))
        c = mix(c, dark[None, :], np.clip(bt * 1.1, 0, 0.95))
        # lash line on the upper lid
        for sx in (1, -1):
            e = np.array([sx * 0.031, 0.0795, 0.0765])
            r = 0.0122
            d = q - e
            rim = np.exp(-((d[:, 1] - r * 0.25) / 0.0016) ** 2) * (np.abs(d[:, 0]) < r * 1.05) * (d[:, 2] > 0.003)
            c = mix(c, dark[None, :] * 0.6, np.clip(rim * 0.9, 0, 0.9) * head)
        return c
    return fn


def eyes(iris='#5a3a1e'):
    white = lin('#e9e4dc')
    ir = lin(iris)
    pupil = lin('#0b0a09')

    def fn(P, pt):
        b = pt.b
        s = b.s * b.head
        q = pt.local('head', P) / s
        out = np.tile(white, (len(P), 1))
        for sx in (1, -1):
            e = np.array([sx * 0.031, 0.0795, 0.0765])
            d = q - e
            r = np.linalg.norm(d, axis=1)
            near = r < 0.016
            cosang = d[:, 2] / np.maximum(r, 1e-6)
            ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
            iris_t = smoothstep(31, 26, ang) * near
            pupil_t = smoothstep(13, 10, ang) * near
            ring = np.exp(-((ang - 29) / 2.5) ** 2) * near
            col = ir[None, :] * (0.8 + 0.3 * NOISE(P * 3, 1200)[:, None])
            out = mix(out, col, iris_t)
            out = mix(out, ir[None, :] * 0.35, ring * 0.6)
            out = mix(out, pupil[None, :], pupil_t)
        return out
    return fn


def lips(hexc='#a8615a'):
    base = lin(hexc)

    def fn(P, pt):
        n = NOISE.fbm(P, 400, 2)
        return base[None, :] * (1 + 0.06 * n[:, None])
    return fn


def hair(hexc='#1b1512', streak=0.25):
    base = lin(hexc)

    def fn(P, pt):
        n = NOISE.fbm(P * np.array([6, 1, 6]), 70, 3)
        return base[None, :] * (1 + streak * n[:, None])
    return fn
