"""Convert the Poly Haven (CC0) downloads on the asset-candidates branch into game files in web/public/textures.

    git fetch origin asset-candidates && git archive FETCH_HEAD polyhaven | tar -x -C /tmp/ph
    python3 tools/assets/convert_polyhaven.py /tmp/ph/polyhaven

Materials become <set>_col.webp (colour with the ambient occlusion multiplied in), <set>_nrm.webp
(OpenGL normal map) and <set>_rgh.webp (roughness), 1024 px. The sky HDRI becomes sky.webp (tone mapped
panorama for the background), sky_env.hdr (small HDR light probe) and sky.json (sun direction and the
horizon colour, for the sun light and the fog).
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'public', 'textures')
os.makedirs(OUT, exist_ok=True)

SETS = {
    'asphalt': 'asphalt_02',
    'asphalt_worn': 'aerial_asphalt_01',
    'pavers': 'concrete_pavers_02',
    'paving': 'concrete_pavement',
    'plaster': 'beige_wall_001',
    'plaster_smooth': 'plastered_wall_02',
    'sand': 'dense_sand',
    'shutter': 'painted_metal_shutter',
}
SKY = 'kloofendal_48d_partly_cloudy_puresky'


def find(folder, part):
    for f in os.listdir(folder):
        if part in f:
            return os.path.join(folder, f)
    return None


for name, pid in SETS.items():
    d = os.path.join(SRC, pid)
    col = Image.open(find(d, '_diff_')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
    ao_path = find(d, '_ao_')
    if ao_path:
        ao = np.asarray(Image.open(ao_path).convert('L').resize((1024, 1024), Image.LANCZOS), np.float32) / 255
        c = np.asarray(col, np.float32) * (0.45 + 0.55 * ao[..., None])
        col = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8))
    col.save(os.path.join(OUT, f'{name}_col.webp'), quality=82, method=6)
    Image.open(find(d, '_nor_gl_')).convert('RGB').resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, f'{name}_nrm.webp'), quality=88, method=6)
    Image.open(find(d, '_rough_')).convert('L').resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'{name}_rgh.webp'), quality=80, method=6)
    print('material', name)


def read_hdr(path):
    """Radiance RGBE reader (new-style run-length encoding, -Y +X)."""
    with open(path, 'rb') as f:
        data = f.read()
    end = data.index(b'\n\n')
    rest = data[end + 2:]
    line_end = rest.index(b'\n')
    m = re.match(rb'-Y (\d+) \+X (\d+)', rest[:line_end])
    h, w = int(m.group(1)), int(m.group(2))
    buf = rest[line_end + 1:]
    img = np.zeros((h, w, 4), np.uint8)
    p = 0
    for y in range(h):
        assert buf[p] == 2 and buf[p + 1] == 2
        p += 4
        for ch in range(4):
            x = 0
            row = img[y, :, ch]
            while x < w:
                n = buf[p]
                p += 1
                if n > 128:
                    n -= 128
                    row[x:x + n] = buf[p]
                    p += 1
                else:
                    row[x:x + n] = np.frombuffer(buf, np.uint8, n, p)
                    p += n
                x += n
    e = img[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return img[..., :3].astype(np.float32) * scale[..., None]


def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    mx = rgb.max(axis=2)
    e = np.zeros((h, w), np.int32)
    mant = np.zeros((h, w), np.float32)
    nz = mx > 1e-32
    mant[nz], e[nz] = np.frexp(mx[nz])
    rgbe = np.zeros((h, w, 4), np.uint8)
    scale = np.where(nz, mant * 256.0 / np.where(nz, mx, 1), 0)
    rgbe[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(nz, e + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode())
        f.write(rgbe.tobytes())  # flat (uncompressed) scanlines


def resize_float(rgb, w, h):
    return np.stack([np.asarray(Image.fromarray(rgb[..., c]).resize((w, h), Image.BOX)) for c in range(3)], axis=2)


hdr = read_hdr(find(os.path.join(SRC, SKY), '.hdr'))
H, W, _ = hdr.shape
# sun: the brightest region
lum = hdr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
py, px = np.unravel_index(np.argmax(lum), lum.shape)
u = (px + 0.5) / W
v = 1 - (py + 0.5) / H
elev = (v - 0.5) * np.pi
az = (u - 0.5) * 2 * np.pi
sun = [float(np.cos(az) * np.cos(elev)), float(np.sin(elev)), float(np.sin(az) * np.cos(elev))]


def tonemap(x, exposure):
    x = x * exposure
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    y = np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)
    return np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055)


# exposure so the sky away from the sun sits at a natural brightness
sky_level = np.median(lum[: H // 3])
exposure = 0.55 / max(sky_level, 1e-6)
pano = resize_float(hdr, 2048, 1024)
ldr = (tonemap(pano, exposure) * 255).astype(np.uint8)
Image.fromarray(ldr).save(os.path.join(OUT, 'sky.webp'), quality=84, method=6)
write_hdr(os.path.join(OUT, 'sky_env.hdr'), resize_float(hdr, 512, 256) * exposure)
horizon = ldr[505:520].reshape(-1, 3).mean(axis=0)
json.dump({'sun': sun, 'horizon': '#%02x%02x%02x' % tuple(int(c) for c in horizon), 'source': SKY}, open(os.path.join(OUT, 'sky.json'), 'w'), indent=1)
print('sky', SKY, 'sun', [round(s, 3) for s in sun], 'elevation', round(float(np.degrees(elev)), 1), 'exposure', round(float(exposure), 3))
open(os.path.join(OUT, 'CREDITS.txt'), 'w').write(
    'Materials and sky from Poly Haven (https://polyhaven.com), CC0 1.0: free for any use, no attribution required.\n'
    + '\n'.join(f'{k}: {v}' for k, v in SETS.items()) + f'\nsky: {SKY}\n')
