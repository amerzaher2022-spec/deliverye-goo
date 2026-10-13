"""Scooter and bicycle models (run inside Blender's Python, see build_models.py).

Curved body panels are modelled as signed distance fields (smooth unions of ellipsoids, boxes and
shells), meshed with marching cubes and decimated. Small mechanical parts are Blender primitives.
All coordinates are in the game's vehicle frame: metres, x = the vehicle's left, y up, +z forward,
origin on the ground midway between the wheel contact points.
"""
import math

import bmesh
import bpy
import numpy as np
from skimage import measure

import blendkit as bk

# key points shared with the rider poses (game frame)
SCOOTER = dict(
    wheel_r=0.245, front=0.62, rear=-0.56,
    seat=(0.0, 0.80, -0.24),            # where the rider's pelvis sits
    grip=(0.29, 1.005, 0.455),          # left grip centre (mirror x for the right)
    floor=(0.11, 0.315, 0.16),          # left foot (ankle target is above this)
)
BICYCLE = dict(
    wheel_r=0.34, front=0.55, rear=-0.53,
    seat=(0.0, 1.0, -0.29),
    grip=(0.27, 1.07, 0.12),
    bb=(0.0, 0.29, -0.03), crank=0.17,
)


def G(p):
    """Game frame → Blender frame."""
    x, y, z = p
    return (x, -z, y)


# ------------------------------------------------------------------ signed distance fields

def sd_ellipsoid(p, c, r):
    q = (p - c) / r
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / r, axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)


def sd_box(p, c, b, r=0.0):
    q = np.abs(p - c) - (np.asarray(b) - r)
    return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(q.max(-1), 0) - r


def sd_capsule(p, a, b, r):
    pa, ba = p - a, np.asarray(b) - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[..., None] * ba, axis=-1) - r


def sd_torus_x(p, c, R, r):
    """Torus around an axis parallel to x."""
    q = p - c
    d = np.sqrt(q[..., 1] ** 2 + q[..., 2] ** 2) - R
    return np.sqrt(d * d + q[..., 0] ** 2) - r


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def sdf_mesh(name, fn, lo, hi, step, mat, ratio=None, target=None):
    """Mesh the zero level set of fn over the box lo..hi (game frame)."""
    xs = [np.arange(lo[i], hi[i] + step, step) for i in range(3)]
    X, Y, Z = np.meshgrid(*xs, indexing='ij')
    p = np.stack([X, Y, Z], -1).astype(np.float32)
    d = fn(p)
    verts, faces, _, _ = measure.marching_cubes(d, 0.0, spacing=(step, step, step))
    verts += np.asarray(lo)
    bv = np.c_[verts[:, 0], -verts[:, 2], verts[:, 1]]
    ob = bk.mesh_object(name, bv, faces[:, ::-1].tolist(), mats=[mat], smooth=True)
    if target:
        ratio = min(1.0, target / max(1, len(faces)))
    if ratio:
        bk.decimate(ob, ratio)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    return ob


# ------------------------------------------------------------------ primitives

def cylinder(name, a, b, r, mat, sides=16, cap=True):
    a, b = np.asarray(G(a)), np.asarray(G(b))
    d = b - a
    L = float(np.linalg.norm(d))
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=L, location=tuple((a + b) / 2),
                                        end_fill_type='NGON' if cap else 'NOTHING')
    ob = bpy.context.active_object
    ob.name = name
    import mathutils
    ob.rotation_euler = mathutils.Vector(tuple(d)).to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return ob


def tube(name, pts, r, mat, sides=10, resolution=6):
    """Smooth tube through game-frame points (a bevelled Bezier curve converted to mesh)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = max(1, sides // 4 - 1)
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = G(p)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def torus_x(name, c, R, r, mat, major=48, minor=12):
    bpy.ops.mesh.primitive_torus_add(major_segments=major, minor_segments=minor, major_radius=R, minor_radius=r,
                                     location=G(c), rotation=(0, math.pi / 2, 0))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def disc_x(name, c, r, depth, mat, sides=32):
    return cylinder(name, (c[0] - depth / 2, c[1], c[2]), (c[0] + depth / 2, c[1], c[2]), r, mat, sides)


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# ------------------------------------------------------------------ materials

def mats():
    return dict(
        paint=bk.material('scooter_paint', (0.8, 0.44, 0.018), rough=0.3, clearcoat=0.6),
        seat=bk.material('seat_leather', (0.035, 0.033, 0.032), rough=0.55),
        seat_side=bk.material('seat_side', (0.32, 0.31, 0.3), rough=0.6),
        rubber=bk.material('rubber', (0.025, 0.025, 0.027), rough=0.85),
        chrome=bk.material('chrome', (0.85, 0.85, 0.86), rough=0.12, metal=1.0),
        alu=bk.material('alu', (0.62, 0.63, 0.64), rough=0.35, metal=1.0),
        dark=bk.material('dark_metal', (0.08, 0.085, 0.09), rough=0.45, metal=0.6),
        lamp=bk.material('lamp_glass', (0.9, 0.88, 0.8), rough=0.05, emission=((1.0, 0.95, 0.82), 0.6)),
        tail=bk.material('tail_glass', (0.55, 0.04, 0.03), rough=0.1, emission=((0.9, 0.05, 0.03), 0.3)),
        frame=bk.material('bike_frame', (0.012, 0.012, 0.014), rough=0.25, clearcoat=0.6),
        saddle=bk.material('saddle', (0.09, 0.055, 0.035), rough=0.5),
        mirror=bk.material('mirror', (0.7, 0.72, 0.75), rough=0.02, metal=1.0),
    )


# ------------------------------------------------------------------ wheels

def scooter_wheel(name, z, M, front=False):
    r = SCOOTER['wheel_r']
    c = (0.0, r, z)
    parts = [
        torus_x(name + '_tyre', c, r - 0.058, 0.058, M['rubber'], 48, 14),
        disc_x(name + '_rim', c, r - 0.085, 0.085, M['alu'], 32),
        disc_x(name + '_hub', c, 0.075, 0.11, M['chrome'], 24),
    ]
    # five wheel nuts
    for k in range(5):
        a = k * 2 * math.pi / 5
        parts.append(disc_x(f'{name}_nut{k}', (0.058, r + math.sin(a) * 0.045, z + math.cos(a) * 0.045), 0.009, 0.012,
                            M['chrome'], 8))
    return join(parts, name)


def bicycle_wheel(name, z, M):
    r = BICYCLE['wheel_r']
    c = (0.0, r, z)
    parts = [
        torus_x(name + '_tyre', c, r - 0.02, 0.02, M['rubber'], 64, 10),
        torus_x(name + '_rim', c, r - 0.042, 0.011, M['alu'], 64, 6),
        disc_x(name + '_hub', c, 0.022, 0.1, M['alu'], 16),
    ]
    n = 32
    for k in range(n):
        a = k * 2 * math.pi / n
        side = 0.035 if k % 2 else -0.035
        hub = (side, r + math.sin(a + 0.12) * 0.02, z + math.cos(a + 0.12) * 0.02)
        rim = (0.0, r + math.sin(a) * (r - 0.05), z + math.cos(a) * (r - 0.05))
        parts.append(cylinder(f'{name}_s{k}', hub, rim, 0.0016, M['alu'], 4, cap=False))
    return join(parts, name)


# ------------------------------------------------------------------ scooter

def build_scooter():
    M = mats()
    S = SCOOTER
    fz, rz, wr = S['front'], S['rear'], S['wheel_r']

    def body(p):
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        # rear cowl: one rounded volume, wider at the engine height, tapering into the floor
        q = p.copy()
        back = smoothstep(-0.45, -0.85, z)
        q[..., 1] = y - 0.07 * back                  # the tail lifts towards the back
        q[..., 0] = x / (1 + 0.16 * np.exp(-((y - 0.44) / 0.13) ** 2) - 0.25 * back)
        cowl = sd_ellipsoid(q, np.array([0, 0.47, -0.39]), np.array([0.235, 0.24, 0.44]))
        cowl = smax(cowl, y - 0.712, 0.025)         # flat top under the seat
        cowl = smax(cowl, 0.23 - y, 0.03)           # flat underside
        # floorboard tunnel
        floor = sd_box(p, np.array([0, 0.272, 0.13]), (0.17, 0.035, 0.33), 0.02)
        # leg shield: curved panel, wider at the bottom, leaning back
        lz = 0.465 + (y - 0.3) * 0.13
        shell = np.abs(sd_ellipsoid(p, np.array([0, 0.62, 0.0]), np.array([0.5, 0.75, 0.48 + 0.0]))) - 0.011
        width = 0.255 - (y - 0.26) * 0.15
        shell = smax(shell, np.abs(x) - width, 0.02)
        shell = smax(shell, 0.26 - y, 0.01)
        shell = smax(shell, y - 0.985, 0.02)
        shell = smax(shell, (lz - 0.12) - z, 0.01)
        # headset column joining the shield to the handlebar
        column = sd_capsule(p, np.array([0, 0.9, 0.5]), np.array([0, 1.0, 0.47]), 0.045)
        d = smin(cowl, floor, 0.12)
        d = smin(d, shell, 0.035)
        d = smin(d, column, 0.04)
        return d

    shell = sdf_mesh('scooter_body', body, (-0.36, 0.2, -0.92), (0.36, 1.06, 0.7), 0.008, M['paint'], target=11000)

    def fender(p):
        x, y, z = p[..., 0], p[..., 1] - wr, p[..., 2] - fz
        R = wr + 0.075 - 3.5 * x * x            # rounded cross-section, edges curl towards the tyre
        t = np.abs(np.sqrt(y * y + z * z) - R) - 0.007
        t = smax(t, np.abs(x) - 0.115, 0.012)
        ang = np.arctan2(y, z)                   # 0 = forward, pi/2 = up
        t = smax(t, smax(-0.45 - ang, ang - 2.3, 0.05), 0.02)
        return t

    fend = sdf_mesh('scooter_fender', fender, (-0.15, 0.05, 0.2), (0.15, 0.62, 0.98), 0.006, M['paint'], target=2500)

    def handlebar(p):
        bar = sd_box(p, np.array([0, 1.005, 0.455]), (0.205, 0.032, 0.05), 0.03)
        lamp = sd_capsule(p, np.array([0, 1.06, 0.455]), np.array([0, 1.06, 0.53]), 0.085)
        lamp = smax(lamp, p[..., 2] - 0.53, 0.01)
        return smin(bar, lamp, 0.04)

    hb = sdf_mesh('scooter_handlebar', handlebar, (-0.27, 0.92, 0.36), (0.27, 1.17, 0.58), 0.006, M['paint'], target=2500)

    def seat(p):
        y = p[..., 1]
        q = p.copy()
        q[..., 1] = y - 0.012 * np.cos(np.clip((p[..., 2] + 0.3) / 0.42, -1.5, 1.5))
        s = sd_box(q, np.array([0, 0.752, -0.3]), (0.14, 0.042, 0.33), 0.04)
        return s

    seat_top = sdf_mesh('scooter_seat', seat, (-0.2, 0.69, -0.68), (0.2, 0.82, 0.08), 0.007, M['seat'], target=1800)

    parts = [shell, fend, hb, seat_top]
    # seat piping band
    parts.append(join([cylinder('piping', (0, 0.722, -0.66), (0, 0.722, 0.04), 0.004, M['seat_side'], 6)], 'piping'))
    # floor rubber strips
    for k in range(5):
        x = -0.12 + k * 0.06
        parts.append(cylinder(f'strip{k}', (x, 0.309, -0.12), (x, 0.309, 0.4), 0.009, M['rubber'], 8))
    # headlight lens and chrome ring
    lens = cylinder('lens', (0, 1.06, 0.522), (0, 1.06, 0.538), 0.07, M['lamp'], 32)
    ring = torus_x('lens_ring', (0, 1.06, 0.53), 0.075, 0.009, M['chrome'], 32, 8)
    ring.rotation_euler = (math.pi / 2, 0, 0)
    parts += [lens, ring]
    # grips, levers and a round mirror on the left
    for sx in (1, -1):
        parts.append(cylinder(f'grip{sx}', (sx * 0.215, 1.005, 0.455), (sx * 0.355, 1.005, 0.455), 0.02, M['rubber'], 16))
        parts.append(cylinder(f'end{sx}', (sx * 0.355, 1.005, 0.455), (sx * 0.366, 1.005, 0.455), 0.017, M['chrome'], 16))
        parts.append(tube(f'lever{sx}', [(sx * 0.2, 1.02, 0.49), (sx * 0.29, 1.03, 0.515), (sx * 0.34, 1.025, 0.51)], 0.005, M['chrome']))
    for sx in (1, -1):
        parts.append(tube(f'mirror_stalk{sx}', [(sx * 0.17, 1.03, 0.45), (sx * 0.21, 1.12, 0.44), (sx * 0.25, 1.19, 0.43)], 0.006, M['chrome']))
        parts.append(cylinder(f'mirror{sx}', (sx * 0.255, 1.21, 0.415), (sx * 0.255, 1.21, 0.44), 0.045, M['chrome'], 24))
        parts.append(cylinder(f'mirror_glass{sx}', (sx * 0.255, 1.21, 0.411), (sx * 0.255, 1.21, 0.413), 0.04, M['mirror'], 24))
    # speedometer face in the handlebar top
    parts.append(cylinder('gauge', (0, 1.035, 0.42), (0, 1.045, 0.425), 0.04, M['dark'], 24))
    # tail light and a chrome trim strip along the cowl
    parts.append(cylinder('taillight', (0, 0.665, -0.815), (0, 0.66, -0.845), 0.045, M['tail'], 20))
    for sx in (1, -1):
        parts.append(tube(f'trim{sx}', [(sx * 0.2, 0.33, -0.08), (sx * 0.265, 0.37, -0.3), (sx * 0.25, 0.4, -0.6)], 0.006, M['chrome']))
        # side vents (engine grille)
        for k in range(5):
            y0 = 0.40 + k * 0.03
            parts.append(cylinder(f'vent{sx}{k}', (sx * 0.266, y0, -0.4), (sx * 0.262, y0, -0.24), 0.006, M['dark'], 6))
    # fork leg and front shock (left side), exhaust (right side)
    parts.append(cylinder('fork', (0.075, 0.5, 0.56), (0.075, wr, fz), 0.022, M['dark'], 12))
    parts.append(cylinder('shock', (0.075, 0.46, 0.53), (0.075, 0.32, 0.58), 0.03, M['chrome'], 12))
    parts.append(cylinder('exhaust', (-0.17, 0.2, -0.45), (-0.17, 0.22, -0.72), 0.05, M['dark'], 16))
    parts.append(cylinder('exhaust_tip', (-0.17, 0.22, -0.72), (-0.17, 0.222, -0.75), 0.035, M['chrome'], 16))
    body = join(parts, 'scooter_body')

    front = scooter_wheel('scooter_front_wheel', fz, M, True)
    rear = scooter_wheel('scooter_rear_wheel', rz, M)
    return body, front, rear


# ------------------------------------------------------------------ bicycle

def build_bicycle():
    M = mats()
    B = BICYCLE
    r, fz, rz = B['wheel_r'], B['front'], B['rear']
    bb = np.array(B['bb'])
    st_top = np.array([0, 0.86, -0.215])
    ht_top = np.array([0, 0.9, 0.355])
    ht_bot = np.array([0, 0.72, 0.4])
    fa = (0.0, r, fz)
    ra = (0.0, r, rz)
    tr = 0.016
    parts = [
        tube('seat_tube', [bb, (0, 0.6, -0.125), st_top], tr, M['frame']),
        tube('top_tube', [st_top - (0, 0.03, 0), (0, 0.85, 0.1), ht_top - (0, 0.04, 0)], tr, M['frame']),
        tube('down_tube', [bb, (0, 0.5, 0.2), ht_bot], 0.019, M['frame']),
        cylinder('head_tube', ht_bot - (0, 0.03, -0.008), ht_top + (0, 0.02, -0.005), 0.021, M['frame']),
    ]
    for sx in (1, -1):
        parts.append(tube(f'chainstay{sx}', [bb + (sx * 0.02, 0, 0), (sx * 0.06, 0.32, -0.3), (sx * 0.062, r, rz)], 0.009, M['frame']))
        parts.append(tube(f'seatstay{sx}', [st_top + (sx * 0.015, -0.03, 0), (sx * 0.055, 0.6, -0.39), (sx * 0.062, r, rz)], 0.008, M['frame']))
        parts.append(tube(f'fork{sx}', [ht_bot + (sx * 0.02, 0, 0), (sx * 0.05, 0.52, 0.48), (sx * 0.055, r + 0.01, fz)], 0.011, M['frame']))
    # stem and swept-back city handlebar
    stem_top = (0, 1.04, 0.33)
    parts.append(cylinder('stem', ht_top, stem_top, 0.014, M['alu']))
    gx, gy, gz = B['grip']
    parts.append(tube('bar', [(-gx, gy, gz), (-0.2, 1.05, 0.26), (0, 1.04, 0.33), (0.2, 1.05, 0.26), (gx, gy, gz)], 0.011, M['alu']))
    for sx in (1, -1):
        parts.append(cylinder(f'grip{sx}', (sx * (gx - 0.03), gy + 0.004, gz + 0.06), (sx * (gx + 0.03), gy - 0.004, gz - 0.07), 0.017,
                              M['rubber']))
    # saddle (sprung roadster saddle) and seat post
    sx_, sy, sz = B['seat']
    parts.append(cylinder('seat_post', st_top, (0, sy - 0.035, sz + 0.03), 0.012, M['alu']))
    q = sdf_mesh('saddle', lambda p: smin(
        sd_ellipsoid(p, np.array([0, sy - 0.0, sz - 0.03]), np.array([0.12, 0.04, 0.11])),
        sd_ellipsoid(p, np.array([0, sy + 0.002, sz + 0.1]), np.array([0.04, 0.03, 0.12])), 0.04),
        (-0.15, sy - 0.07, sz - 0.18), (0.15, sy + 0.06, sz + 0.25), 0.006, M['saddle'], target=900)
    parts.append(q)
    for sx in (1, -1):
        parts.append(tube(f'spring{sx}', [(sx * 0.06, sy - 0.03, sz - 0.08), (sx * 0.06, sy - 0.06, sz - 0.06), (sx * 0.05, sy - 0.08, sz - 0.02)], 0.006, M['chrome']))
    # crank, chain ring and pedals (left pedal forward)
    parts.append(disc_x('chainring', (-0.055, bb[1], bb[2]), 0.1, 0.006, M['alu'], 36))
    parts.append(disc_x('bb_shell', (0, bb[1], bb[2]), 0.028, 0.08, M['frame'], 16))
    for sx, a in ((1, 0.0), (-1, math.pi)):
        end = (sx * 0.085, bb[1] + math.sin(a) * B['crank'] * 0, bb[2] + math.cos(a) * B['crank'])
        parts.append(cylinder(f'crank{sx}', (sx * 0.065, bb[1], bb[2]), end, 0.011, M['alu'], 8))
        parts.append(join([bk_box(f'pedal{sx}', (sx * 0.125, end[1], end[2]), (0.045, 0.012, 0.035), M['rubber'])], f'pedal{sx}'))
    # chain guard
    def guard_plate(p):
        q = p.copy()
        q[..., 0] = -0.075
        plate = sd_capsule(q, np.array([-0.075, 0.31, -0.03]), np.array([-0.075, r, rz + 0.06]), 0.075)
        return smax(plate, np.abs(p[..., 0] + 0.075) - 0.005, 0.003)
    parts.append(sdf_mesh('chainguard', guard_plate, (-0.1, 0.18, -0.65), (-0.05, 0.45, 0.1), 0.003, M['frame'], target=600))
    # mudguards
    for name, zc in (('mudguard_f', fz), ('mudguard_r', rz)):
        def guard(p, zc=zc):
            x, y, z = p[..., 0], p[..., 1] - r, p[..., 2] - zc
            R = r + 0.03 - 4.0 * x * x
            t = np.abs(np.sqrt(y * y + z * z) - R) - 0.004
            t = smax(t, np.abs(x) - 0.03, 0.004)
            ang = np.arctan2(y, z)
            ang = np.where(ang < 0, ang + 2 * np.pi, ang)
            lo, hi = (0.15, 2.5) if zc > 0 else (0.6, 3.5)
            return smax(t, smax(lo - ang, ang - hi, 0.03), 0.01)
        parts.append(sdf_mesh(name, guard, (-0.05, 0.25, zc - 0.45), (0.05, 0.76, zc + 0.45), 0.004, M['frame'], target=900))
    # front rack and wire basket
    parts.append(join([bk_box('rack', (0, 0.86, 0.52), (0.12, 0.006, 0.1), M['frame'])], 'rack'))
    parts.append(tube('rack_stay_l', [(0.05, 0.86, 0.5), (0.055, r + 0.01, fz)], 0.006, M['frame']))
    parts.append(tube('rack_stay_r', [(-0.05, 0.86, 0.5), (-0.055, r + 0.01, fz)], 0.006, M['frame']))
    parts.append(basket((0, 0.87, 0.53), (0.36, 0.24, 0.27), M['frame']))
    # front lamp and bell
    parts.append(cylinder('lamp', (0, 0.84, 0.47), (0, 0.84, 0.5), 0.035, M['chrome'], 16))
    parts.append(cylinder('lamp_glass', (0, 0.84, 0.5), (0, 0.84, 0.503), 0.03, M['lamp'], 16))
    parts.append(cylinder('bell', (0.15, 1.06, 0.29), (0.15, 1.08, 0.29), 0.025, M['chrome'], 16))
    parts.append(cylinder('kick', (0.05, 0.3, -0.12), (0.12, 0.02, -0.2), 0.008, M['alu'], 6))
    body = join(parts, 'bicycle_body')
    front = bicycle_wheel('bicycle_front_wheel', fz, M)
    rear = bicycle_wheel('bicycle_rear_wheel', rz, M)
    return body, front, rear


def bk_box(name, c, half, mat):
    bpy.ops.mesh.primitive_cube_add(size=2, location=G(c))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (half[0], half[2], half[1])
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


def basket(c, size, mat):
    """Open-top wire basket: a subdivided box turned into struts with the wireframe modifier."""
    w, h, d = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(c))
    ob = bpy.context.active_object
    ob.name = 'basket'
    ob.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
    bm.to_mesh(ob.data)
    bm.free()
    m = ob.modifiers.new('wire', 'WIREFRAME')
    m.thickness = 0.005
    m.use_even_offset = True
    bk.apply_modifiers(ob)
    ob.data.materials.append(mat)
    return ob
