"""Texture edits for the generated characters: recolouring, logo removal, skin tone blends."""
import os

import cv2
import numpy as np


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    elif im.shape[2] == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
    return im.astype(np.float32) / 255.0  # BGRA


def save(im, path, jpeg=True, size=None):
    out = np.clip(im * 255 + 0.5, 0, 255).astype(np.uint8)
    if size and out.shape[0] != size:
        out = cv2.resize(out, (size, size), interpolation=cv2.INTER_AREA)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if jpeg:
        cv2.imwrite(path, out[:, :, :3], [cv2.IMWRITE_JPEG_QUALITY, 88])
    else:
        cv2.imwrite(path, out)
    return path


def rect_mask(im, rects):
    h, w = im.shape[:2]
    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in rects:
        m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    return m


def lum(im):
    return im[:, :, 0] * 0.114 + im[:, :, 1] * 0.587 + im[:, :, 2] * 0.299


def sat(im):
    mx = im[:, :, :3].max(2)
    mn = im[:, :, :3].min(2)
    return (mx - mn) / np.maximum(mx, 1e-4)


def recolor(im, mask, rgb, ref=None, keep=0.0):
    """Map the luminance of the masked area onto a new colour (keeps folds and seams)."""
    L = lum(im)
    if ref is None:
        ref = np.median(L[mask]) if mask.any() else 0.5
    bgr = np.array(rgb[::-1], np.float32)
    shade = np.clip(L / max(ref, 1e-3), 0, 2.2)[:, :, None]
    out = im.copy()
    new = np.clip(bgr[None, None, :] * shade, 0, 1)
    out[:, :, :3] = np.where(mask[:, :, None], new * (1 - keep) + im[:, :, :3] * keep, im[:, :, :3])
    return out


def inpaint(im, mask, radius=6):
    m = (mask.astype(np.uint8) * 255)
    m = cv2.dilate(m, np.ones((5, 5), np.uint8), iterations=2)
    u8 = np.clip(im[:, :, :3] * 255, 0, 255).astype(np.uint8)
    fixed = cv2.inpaint(u8, m, radius, cv2.INPAINT_TELEA).astype(np.float32) / 255
    out = im.copy()
    out[:, :, :3] = fixed
    return out


def blend(a, b, t):
    return a * (1 - t) + b * t


def warm(im, amount=0.06, darken=0.0):
    out = im.copy()
    out[:, :, 2] = out[:, :, 2] * (1 + amount)
    out[:, :, 0] = out[:, :, 0] * (1 - amount)
    out[:, :, :3] *= (1 - darken)
    return out


def hair(im, rgb, gain=1.0):
    """Recolour a hair texture (keeps alpha)."""
    L = lum(im)
    ref = np.percentile(L[im[:, :, 3] > 0.5], 60) if (im[:, :, 3] > 0.5).any() else 0.4
    out = recolor(im, np.ones(L.shape, bool), rgb, ref=ref / gain)
    out[:, :, 3] = im[:, :, 3]
    return out
