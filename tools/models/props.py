"""Carried props: foil food trays and pizza boxes, placed on a posed person's palms."""
import os

import bpy
import numpy as np

import blendkit as bk
import poses as po
import texops as tx
from vehicles import G


def _palms(person):
    l = po.g(person, 'finger3-1.L')
    r = po.g(person, 'finger3-1.R')
    wl = po.g(person, 'wrist.L')
    wr = po.g(person, 'wrist.R')
    c = (l + r + wl + wr) / 4
    return c, max(l[1], r[1], wl[1], wr[1])


def _box(name, centre, size, mat, bevel=0.004, taper=1.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(centre))
    ob = bpy.context.active_object
    ob.name = name
    w, h, d = size
    ob.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    if taper != 1.0:
        for v in ob.data.vertices:
            if v.co.z < 0:
                v.co.x *= taper
                v.co.y *= taper
    if bevel:
        m = ob.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 2
        bk.apply_modifiers(ob)
    ob.data.materials.append(mat)
    return ob


def foil_trays(count=3):
    def build(person, M):
        c, top = _palms(person)
        foil = bk.material('foil', (0.78, 0.79, 0.8), rough=0.32, metal=1.0)
        lid = bk.material('foil_lid', (0.86, 0.86, 0.86), rough=0.4, metal=0.8)
        out = []
        y = top + 0.015
        for k in range(count):
            tray = _box(f'tray{k}', (c[0], y + 0.025, c[2] + 0.02), (0.235, 0.05, 0.17), foil, 0.004, taper=0.86)
            cover = _box(f'tray_lid{k}', (c[0], y + 0.055, c[2] + 0.02), (0.245, 0.01, 0.18), lid, 0.003)
            emb = _box(f'tray_emb{k}', (c[0], y + 0.062, c[2] + 0.02), (0.19, 0.006, 0.12), lid, 0.002)
            out += [(tray, False), (cover, False), (emb, False)]
            y += 0.062
        return out
    return build


def pizza_boxes(count=3, cache='/tmp/model-cache'):
    def build(person, M):
        c, top = _palms(person)
        path = os.path.join(cache, 'tex', 'pizza_top.png')
        if not os.path.exists(path):
            from PIL import Image, ImageDraw
            im = Image.new('RGB', (256, 256), (170, 125, 78))
            d = ImageDraw.Draw(im)
            d.ellipse((58, 58, 198, 198), outline=(165, 32, 28), width=10)
            d.ellipse((92, 92, 164, 164), fill=(165, 32, 28))
            for i in range(0, 256, 32):
                d.line((i, 0, i, 6), fill=(150, 108, 66), width=2)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            im.save(path)
        kraft = bk.material('kraft', (0.55, 0.39, 0.23), rough=0.85)
        print_mat = bk.material('pizza_print', tex=bk.image(path), rough=0.85)
        out = []
        y = top + 0.02
        for k in range(count):
            box = _box(f'pizza{k}', (c[0], y + 0.022, c[2] + 0.04), (0.33, 0.044, 0.33), kraft, 0.003)
            x0, z0, h = c[0], c[2] + 0.04, y + 0.0445
            pts = [(x0 - 0.16, h, z0 - 0.16), (x0 + 0.16, h, z0 - 0.16), (x0 + 0.16, h, z0 + 0.16), (x0 - 0.16, h, z0 + 0.16)]
            topo = bk.mesh_object(f'pizza_top{k}', [G(p) for p in pts], [[0, 3, 2, 1]], [[(0, 0), (0, 1), (1, 1), (1, 0)]],
                                  [print_mat], smooth=False)
            out += [(box, False), (topo, False)]
            y += 0.046
        return out
    return build
