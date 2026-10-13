"""Cars for Erbil Delivery World (Blender): a branded courier hatchback for the player, and a sedan,
an SUV and a pickup for the streets. All original designs.

Bodies are subdivision cages lofted from cross-sections (with creases on the shoulder and window lines),
wheel arches are boolean cuts, and lamps, grilles, seams, handles and plates are shaped onto the body
by projecting outlines with a BVH. Game frame: metres, x = the car's left, y up, +z forward.
"""
import math
import os

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils.bvhtree import BVHTree

import blendkit as bk
from vehicles import G, cylinder, disc_x, join, torus_x

HERE = os.path.dirname(os.path.abspath(__file__))


def mats(livery=False):
    return dict(
        paint=bk.material('car_paint', (0.8, 0.8, 0.8), rough=0.28, metal=0.35, clearcoat=0.9),
        livery=bk.material('car_livery', (0.03, 0.032, 0.036), rough=0.3, metal=0.3, clearcoat=0.9),
        amber=bk.material('car_amber', (0.78, 0.33, 0.02), rough=0.32, metal=0.2, clearcoat=0.8),
        glass=bk.material('car_glass', (0.02, 0.025, 0.03), rough=0.06, metal=0.3),
        trim=bk.material('car_trim', (0.025, 0.026, 0.028), rough=0.55),
        under=bk.material('car_under', (0.012, 0.012, 0.013), rough=0.9),
        chrome=bk.material('car_chrome', (0.82, 0.83, 0.85), rough=0.12, metal=1.0),
        lamp=bk.material('car_lamp', (0.1, 0.105, 0.11), rough=0.06, metal=0.8),
        drl=bk.material('car_drl', (0.95, 0.95, 0.95), rough=0.1, emission=((1.0, 0.98, 0.92), 1.2)),
        roof=bk.material('car_roof', (0.8, 0.8, 0.8), rough=0.28, metal=0.35, clearcoat=0.9),
        tail=bk.material('car_tail', (0.45, 0.02, 0.02), rough=0.12, emission=((0.9, 0.04, 0.02), 0.4)),
        amberlamp=bk.material('car_indicator', (0.8, 0.35, 0.02), rough=0.12, emission=((1.0, 0.45, 0.05), 0.3)),
        tire=bk.material('car_tire', (0.03, 0.03, 0.032), rough=0.85),
        rim=bk.material('car_rim', (0.55, 0.56, 0.58), rough=0.25, metal=1.0),
        rimdark=bk.material('car_rim_dark', (0.06, 0.065, 0.07), rough=0.35, metal=0.8),
        plate=bk.material('car_plate', (0.85, 0.85, 0.82), rough=0.4),
        interior=bk.material('car_interior', (0.04, 0.04, 0.045), rough=0.8),
    )


# ------------------------------------------------------------------ car specifications

def _f(table):
    zs = np.array([p[0] for p in table], float)
    vs = np.array([p[1] for p in table], float)
    order = np.argsort(zs)
    return lambda z: float(np.interp(z, zs[order], vs[order]))


SPECS = {
    # compact five-door hatchback (the player's courier car)
    'hatch': dict(
        stations=[2.06, 2.0, 1.92, 1.8, 1.55, 1.3, 1.08, 0.9, 0.6, 0.3, 0.0, -0.3, -0.6, -0.9, -1.2, -1.45, -1.68, -1.86, -1.96, -2.02],
        bottom=_f([(2.06, 0.32), (2.02, 0.27), (1.92, 0.24), (1.8, 0.23), (1.5, 0.2), (0.0, 0.19), (-1.6, 0.21), (-1.86, 0.25), (-1.97, 0.3), (-2.02, 0.36)]),
        width=_f([(2.06, 0.66), (2.04, 0.75), (1.97, 0.82), (1.88, 0.85), (1.7, 0.88), (1.5, 0.885), (0.0, 0.895), (-1.4, 0.885), (-1.7, 0.86), (-1.9, 0.82), (-1.99, 0.77), (-2.02, 0.7)]),
        belt=_f([(2.06, 0.62), (2.0, 0.69), (1.92, 0.74), (1.75, 0.79), (1.3, 0.85), (1.0, 0.9), (0.0, 0.95), (-1.2, 0.99), (-1.6, 1.0), (-1.9, 0.98), (-2.02, 0.88)]),
        top=_f([(2.06, 0.66), (2.02, 0.72), (1.95, 0.77), (1.82, 0.81), (1.5, 0.87), (1.1, 0.93), (0.85, 1.06), (0.55, 1.26), (0.3, 1.4), (0.0, 1.455),
                (-0.9, 1.46), (-1.3, 1.44), (-1.55, 1.4), (-1.75, 1.25), (-1.92, 1.1), (-1.98, 1.02), (-2.02, 0.92)]),
        roofw=_f([(1.0, 0.7), (0.3, 0.67), (-1.3, 0.66), (-1.8, 0.62)]),
        crown=0.035, wheel_r=0.315, wheel_w=0.21, axles=(1.31, -1.31), track=0.775,
        windshield=(0.32, 1.02), rear_glass=(-1.98, -1.4), pillars=[(0.02, 0.1)], door_lines=[1.02, 0.05, -0.92],
        lamps_front=[(0.36, 0.6, 0.62, 0.73)], lamps_rear=[(0.38, 0.8, 0.68, 0.95)], grille=(0.3, 0.45, 0.6),
        plate_front=0.42, plate_rear=0.72, mirror_z=0.86,
    ),
    # mid-size saloon (Camry-like proportions)
    'sedan': dict(
        stations=[2.42, 2.36, 2.27, 2.12, 1.85, 1.55, 1.25, 1.0, 0.7, 0.35, 0.0, -0.35, -0.7, -1.0, -1.3, -1.6, -1.85, -2.1, -2.3, -2.4, -2.45],
        bottom=_f([(2.42, 0.3), (2.39, 0.25), (2.32, 0.22), (2.1, 0.2), (1.6, 0.18), (0.0, 0.17), (-1.9, 0.2), (-2.3, 0.23), (-2.42, 0.29), (-2.45, 0.34)]),
        width=_f([(2.42, 0.7), (2.405, 0.78), (2.37, 0.84), (2.28, 0.885), (2.1, 0.905), (0.0, 0.92), (-2.0, 0.905), (-2.3, 0.885), (-2.4, 0.84), (-2.44, 0.78), (-2.45, 0.72)]),
        belt=_f([(2.42, 0.64), (2.38, 0.71), (2.3, 0.75), (2.0, 0.8), (1.4, 0.85), (1.1, 0.88), (0.0, 0.92), (-1.2, 0.96), (-1.8, 0.985), (-2.3, 0.98), (-2.45, 0.9)]),
        top=_f([(2.42, 0.68), (2.39, 0.75), (2.33, 0.79), (2.15, 0.815), (1.8, 0.845), (1.3, 0.88), (1.1, 0.95), (0.8, 1.15), (0.45, 1.33), (0.1, 1.43), (-0.6, 1.44),
                (-1.0, 1.4), (-1.3, 1.3), (-1.6, 1.13), (-1.8, 1.03), (-2.2, 1.0), (-2.36, 0.985), (-2.42, 0.97), (-2.45, 0.92)]),
        roofw=_f([(1.1, 0.72), (0.4, 0.69), (-0.9, 0.68), (-1.6, 0.66)]),
        crown=0.035, wheel_r=0.33, wheel_w=0.22, axles=(1.41, -1.41), track=0.79,
        windshield=(0.42, 1.12), rear_glass=(-1.78, -0.95), pillars=[(0.02, 0.1)], door_lines=[1.12, 0.06, -1.02],
        lamps_front=[(0.37, 0.59, 0.67, 0.71)], lamps_rear=[(0.36, 0.75, 0.7, 0.88)], grille=(0.33, 0.47, 0.64),
        plate_front=0.45, plate_rear=0.66, mirror_z=0.95,
    ),
    # full-size four-wheel-drive SUV (boxy, high)
    'suv': dict(
        stations=[2.46, 2.42, 2.34, 2.2, 1.95, 1.65, 1.35, 1.1, 0.8, 0.45, 0.1, -0.3, -0.7, -1.1, -1.5, -1.85, -2.15, -2.35, -2.44, -2.48],
        bottom=_f([(2.46, 0.44), (2.42, 0.38), (2.3, 0.36), (2.2, 0.35), (1.6, 0.32), (0.0, 0.3), (-2.0, 0.34), (-2.38, 0.4), (-2.48, 0.46)]),
        width=_f([(2.46, 0.8), (2.44, 0.88), (2.36, 0.94), (2.2, 0.97), (0.0, 0.985), (-2.2, 0.975), (-2.38, 0.94), (-2.48, 0.82)]),
        belt=_f([(2.46, 0.96), (2.35, 1.02), (2.1, 1.06), (1.4, 1.11), (1.15, 1.13), (0.0, 1.16), (-1.5, 1.18), (-2.3, 1.18), (-2.48, 1.14)]),
        top=_f([(2.46, 1.0), (2.42, 1.06), (2.3, 1.1), (1.8, 1.13), (1.4, 1.16), (1.2, 1.24), (0.95, 1.55), (0.75, 1.78), (0.5, 1.86), (0.0, 1.88),
                (-1.5, 1.88), (-2.2, 1.86), (-2.38, 1.8), (-2.46, 1.62), (-2.48, 1.4)]),
        roofw=_f([(1.0, 0.82), (0.5, 0.8), (-2.2, 0.8)]),
        crown=0.03, wheel_r=0.39, wheel_w=0.27, axles=(1.43, -1.42), track=0.83, flares=True, rails=True,
        windshield=(0.62, 1.22), rear_glass=(-2.46, -2.3), pillars=[(0.08, 0.17), (-1.0, -0.88)], door_lines=[1.22, 0.12, -0.9],
        lamps_front=[(0.5, 0.95, 0.82, 1.07)], lamps_rear=[(0.7, 0.98, 0.86, 1.3)], grille=(0.44, 0.6, 1.04),
        plate_front=0.62, plate_rear=0.86, mirror_z=1.12,
    ),
    # double-cab pickup (Hilux-like) with an open bed
    'pickup': dict(
        stations=[2.64, 2.6, 2.52, 2.38, 2.15, 1.85, 1.55, 1.3, 1.0, 0.65, 0.3, -0.05, -0.2, -0.45, -0.8, -1.2, -1.6, -2.0, -2.35, -2.55, -2.64, -2.67],
        bottom=_f([(2.64, 0.46), (2.6, 0.4), (2.48, 0.37), (2.3, 0.36), (1.6, 0.33), (0.0, 0.31), (-2.2, 0.36), (-2.55, 0.44), (-2.67, 0.52)]),
        width=_f([(2.64, 0.8), (2.62, 0.87), (2.54, 0.91), (2.35, 0.93), (0.0, 0.935), (-2.5, 0.93), (-2.62, 0.9), (-2.67, 0.86)]),
        belt=_f([(2.64, 0.94), (2.5, 1.0), (2.25, 1.04), (1.6, 1.1), (1.35, 1.12), (0.0, 1.14), (-0.3, 1.15), (-2.67, 1.16)]),
        top=_f([(2.64, 0.98), (2.6, 1.04), (2.45, 1.08), (2.0, 1.11), (1.55, 1.14), (1.35, 1.2), (1.1, 1.48), (0.85, 1.7), (0.6, 1.79), (0.0, 1.8),
                (-0.6, 1.8), (-0.74, 1.76), (-0.8, 1.6), (-0.86, 1.2), (-2.67, 1.2)]),
        roofw=_f([(1.2, 0.8), (0.6, 0.78), (-0.75, 0.78)]),
        crown=0.03, wheel_r=0.375, wheel_w=0.26, axles=(1.57, -1.51), track=0.8, flares=True,
        windshield=(0.72, 1.4), rear_glass=None, pillars=[(0.02, 0.12)], door_lines=[1.38, 0.08, -0.74],
        lamps_front=[(0.48, 0.92, 0.8, 1.04)], lamps_rear=[(0.74, 0.86, 0.86, 1.12)], grille=(0.42, 0.6, 0.98),
        plate_front=0.62, plate_rear=0.7, mirror_z=1.36, bed=(-0.86, -2.62, 0.62),
    ),
}


# ------------------------------------------------------------------ body loft

def _bez(p0, p1, p2, n, include_start=True):
    t = np.linspace(0, 1, n + 1)[0 if include_start else 1:]
    p0, p1, p2 = map(np.asarray, (p0, p1, p2))
    return [tuple((1 - u) ** 2 * p0 + 2 * (1 - u) * u * p1 + u * u * p2) for u in t]


def _arc(c, r, a0, a1, n, include_start=True):
    t = np.linspace(a0, a1, n + 1)[0 if include_start else 1:]
    return [(c[0] + r * math.cos(a), c[1] + r * math.sin(a)) for a in t]


REGIONS = (('under', 4), ('sill', 4), ('side', 7), ('shoulder', 3), ('green', 7), ('corner', 3), ('roof', 4))


def section(sp, z):
    """Half cross-section from the bottom centre to the top centre, with fixed point counts per region."""
    bot, w, belt, top = sp['bottom'](z), sp['width'](z), sp['belt'](z), sp['top'](z)
    rw = min(sp['roofw'](z), w * 0.9)
    cr = sp['crown']
    gh = float(np.clip((top - belt - 0.06) / 0.2, 0, 1))
    rc = min(0.055, (belt - bot) * 0.25)
    pts = []
    pts += [(x, bot) for x in np.linspace(0, w * 0.985 - rc, 5)[:-1]]                            # under (4)
    pts += _arc((w * 0.985 - rc, bot + rc), rc, -math.pi / 2, 0, 4, include_start=True)[:4]      # sill (4)
    ws = w * 0.985
    # body side: pulled in at the sill, widest a little above the middle, then a crisp shoulder
    pts += _bez((w * 0.985, bot + rc), (w * 1.006, bot + (belt - bot) * 0.62), (ws, belt - 0.035), 7, include_start=True)[:7]   # side (7)
    wsh = w * 0.968
    pts += [(ws, belt - 0.035), (wsh + 0.004, belt - 0.012), (wsh, belt)]                           # shoulder (3)
    # greenhouse: cabin side glass, or the hood / deck surface
    gb = (wsh - 0.03, belt + 0.012)
    rr = 0.055
    cab = _bez(gb, (gb[0] - 0.02, (belt + top) / 2), (rw, top - rr), 7, include_start=True)[:7]
    cab_c = _arc((rw - rr, top - rr), rr, 0, math.pi / 2, 3, include_start=True)[:3]
    cab_r = [(x, top + cr * (1 - (x / max(rw - rr, 1e-3)) ** 2)) for x in np.linspace(rw - rr, 0, 4)]
    deck = _bez((wsh - 0.012, belt + 0.004), (wsh * 0.92, top + 0.004), (w * 0.62, top + cr * 0.4), 7, include_start=True)[:7]
    deck_c = [(x, top + cr * (0.4 + 0.2 * k)) for k, x in enumerate(np.linspace(w * 0.62, w * 0.46, 3))]
    deck_r = [(x, top + cr * (1 - (x / (w * 0.46)) ** 2 * 0.4)) for x in np.linspace(w * 0.46, 0, 4)]
    up = [(d[0] + (c[0] - d[0]) * gh, d[1] + (c[1] - d[1]) * gh) for d, c in zip(deck + deck_c + deck_r, cab + cab_c + cab_r)]
    pts += up
    return pts, gh


def _stations(sp, n=64):
    z0, z1 = sp['stations'][0], sp['stations'][-1]
    t = np.linspace(0, math.pi, n)
    zs = (z0 + z1) / 2 + (z0 - z1) / 2 * np.cos(t)
    return list(zs)


def body_cage(sp, M):
    zs = _stations(sp)
    rings, ghs = [], []
    for z in zs:
        half, gh = section(sp, z)
        ring = [(x, y, z) for x, y in half] + [(-x, y, z) for x, y in half[-2:0:-1]]
        rings.append(ring)
        ghs.append(gh)
    n = len(rings[0])
    nh = len(rings[0]) // 2 + 1
    labels = []
    for name, cnt in REGIONS:
        labels += [name] * cnt
    verts = [G(p) for r in rings for p in r]
    faces, fmat = [], []
    ax = sorted(sp['axles'])
    lo_z, hi_z = ax[0] - sp['wheel_r'] - 0.1, ax[-1] + sp['wheel_r'] + 0.1
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            c, d = (i + 1) * n + (j + 1) % n, (i + 1) * n + j
            faces.append([a, d, c, b])
            jj = j if j < nh - 1 else n - 1 - j
            zc = (zs[i] + zs[i + 1]) / 2
            label = labels[min(jj, len(labels) - 1)]
            if label in ('under', 'sill') and not lo_z <= zc <= hi_z:
                # bumper ends: paint the parts that face forwards or backwards, keep the underside dark
                p0, p1, p2 = (np.array(rings[i][j]), np.array(rings[i][(j + 1) % n]), np.array(rings[i + 1][j]))
                nrm = np.cross(p1 - p0, p2 - p0)
                if abs(nrm[1]) < 0.75 * (np.linalg.norm(nrm) + 1e-9):
                    label = 'side'
            fmat.append(_material(sp, label, zc, (ghs[i] + ghs[i + 1]) / 2))
    faces.append(list(range(n)))
    fmat.append('paint')
    last = (len(rings) - 1) * n
    faces.append([last + j for j in range(n)])
    fmat.append('paint')
    names = sorted(set(fmat))
    ob = bk.mesh_object('body', verts, faces, mats=[M[k] for k in names], face_mats=[names.index(k) for k in fmat], smooth=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.set_sharp_from_angle(angle=math.radians(32))
    return ob, rings


def _material(sp, region, z, g):
    if region == 'under':
        return 'under'
    if region == 'sill':
        return 'trim'
    ws = sp['windshield']
    rg = sp.get('rear_glass')
    if region == 'green' and g > 0.6:
        if ws[0] <= z <= ws[1]:
            return 'paint'          # A-pillar
        for p0, p1 in sp['pillars']:
            if p0 <= z <= p1:
                return 'trim'       # B pillar (black)
        if rg and rg[0] <= z <= rg[1]:
            return 'paint'          # C / D pillar
        if sp.get('glass_end') is not None and z < sp['glass_end']:
            return 'paint'
        return 'glass'
    if region in ('roof', 'corner') and ws[0] <= z <= ws[1] and g > 0.2:
        return 'glass'
    if region in ('roof', 'corner') and rg and rg[0] <= z <= rg[1] and g > 0.2:
        return 'glass'
    if region in ('roof', 'corner') and g > 0.6:
        return 'roof'
    return 'paint'


# ------------------------------------------------------------------ projection helpers

class Surface:
    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.ob = ob
        self.bvh = BVHTree.FromObject(ob, dg)

    def hit(self, origin, direction):
        """Cast from a game-frame point along a game-frame direction; returns (point, normal) in the game frame."""
        o = mathutils.Vector(G(origin))
        d = mathutils.Vector(G(direction)).normalized()
        loc, nrm, _, _ = self.bvh.ray_cast(o, d, 10.0)
        if loc is None:
            return None
        return np.array([loc.x, loc.z, -loc.y]), np.array([nrm.x, nrm.z, -nrm.y])


def projected_patch(surf, name, outline, direction, offset, mat, depth=0.0, res=10):
    """Fill a 2D outline (points in the plane perpendicular to `direction`) and project it onto the body.
    outline: list of 3D game-frame points on the projection plane (far outside the body)."""
    pts = np.asarray(outline, float)
    c = pts.mean(0)
    d = np.asarray(direction, float) / np.linalg.norm(direction)
    verts, faces = [], []
    hits = []
    grid = []
    # rows between the outline's left and right halves (outline must be convex and ordered)
    n = len(pts)
    for t in np.linspace(0, 1, res):
        row = []
        for k in range(n):
            p = pts[k] * (1 - t) + c * t
            row.append(p)
        grid.append(row)
    idx = {}
    for r, row in enumerate(grid):
        for k, p in enumerate(row):
            h = surf.hit(p, d)
            if h is None:
                return None
            hp, hn = h
            verts.append(G(hp + hn * offset))
            idx[(r, k)] = len(verts) - 1
    for r in range(res - 1):
        for k in range(n):
            a, b = idx[(r, k)], idx[(r, (k + 1) % n)]
            c2, d2 = idx[(r + 1, (k + 1) % n)], idx[(r + 1, k)]
            faces.append([a, b, c2, d2])
    ob = bk.mesh_object(name, verts, faces, mats=[mat], smooth=True)
    if depth:
        m = ob.modifiers.new('s', 'SOLIDIFY')
        m.thickness = depth
        bk.apply_modifiers(ob)
    return ob


def seam(surf, name, points, direction, mat, width=0.004, offset=0.0012):
    """Thin dark line following the body (door shut lines)."""
    verts, faces = [], []
    d = np.asarray(direction, float)
    prev = None
    for p in points:
        h = surf.hit(np.asarray(p) - d * 2.0, d)
        if h is None:
            continue
        hp, hn = h
        t = np.cross(hn, [0, 1, 0]) if abs(hn[1]) < 0.9 else np.cross(hn, [0, 0, 1])
        if prev is not None:
            along = hp - prev
            if np.linalg.norm(along) > 1e-6:
                t = np.cross(hn, along / np.linalg.norm(along))
        t = t / (np.linalg.norm(t) + 1e-9)
        verts += [G(hp + hn * offset + t * width / 2), G(hp + hn * offset - t * width / 2)]
        prev = hp
    k = len(verts) // 2
    for i in range(k - 1):
        faces.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])
    if not faces:
        return None
    return bk.mesh_object(name, verts, faces, mats=[mat], smooth=False)


def ellipse(cx, cy, rx, ry, plane_z, n=16, side='front'):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a), plane_z))
    return pts if side == 'front' else pts[::-1]


def rounded_rect(x0, y0, x1, y1, z, r=0.03, n=4, flip=False):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    pts = []
    corners = [(x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)]
    for cx, cy, a0 in corners:
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
    return pts[::-1] if flip else pts


# ------------------------------------------------------------------ wheels

def wheel(name, r, w, M, spokes=5, dark=False):
    """Tyre with a rounded sidewall, alloy rim with spokes, brake disc. Centred at the origin, axle along x."""
    parts = []
    # tyre: lathe a profile around the x axis
    prof = [(w * 0.5, r * 0.62), (w * 0.52, r * 0.72), (w * 0.5, r * 0.9), (w * 0.44, r * 0.98), (w * 0.3, r), (-w * 0.3, r),
            (-w * 0.44, r * 0.98), (-w * 0.5, r * 0.9), (-w * 0.52, r * 0.72), (-w * 0.5, r * 0.62)]
    seg = 36
    verts, faces = [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        for x, rr in prof:
            verts.append(G((x, rr * math.sin(a), rr * math.cos(a))))
    m = len(prof)
    for k in range(seg):
        for j in range(m - 1):
            a0 = k * m + j
            b0 = ((k + 1) % seg) * m + j
            faces.append([a0, b0, b0 + 1, a0 + 1])
    tyre = bk.mesh_object(name + '_tyre', verts, faces, mats=[M['tire']], smooth=True)
    parts.append(tyre)
    rim_m = M['rimdark'] if dark else M['rim']
    rr = r * 0.66
    parts.append(torus_x(name + '_lip', (w * 0.36, 0, 0), rr, 0.016, rim_m, 36, 8))
    parts.append(disc_x(name + '_barrel', (0, 0, 0), rr - 0.004, w * 0.8, M['under'], 32))
    parts.append(disc_x(name + '_disc', (w * 0.12, 0, 0), rr * 0.82, 0.02, M['chrome'], 28))
    parts.append(disc_x(name + '_hub', (w * 0.4, 0, 0), rr * 0.24, 0.05, rim_m, 20))
    parts.append(disc_x(name + '_cap', (w * 0.43, 0, 0), rr * 0.13, 0.03, M['chrome'], 16))
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        for off in (-0.07, 0.07):
            aa = a + off
            p0 = (w * 0.4, rr * 0.2 * math.sin(aa), rr * 0.2 * math.cos(aa))
            p1 = (w * 0.34, rr * 0.97 * math.sin(aa + off * 0.4), rr * 0.97 * math.cos(aa + off * 0.4))
            parts.append(cylinder(f'{name}_sp{k}{off}', p0, p1, 0.024, rim_m, 8))
    # caliper (brand amber)
    cal = cylinder(name + '_caliper', (w * 0.08, rr * 0.55, rr * 0.25), (w * 0.08, rr * 0.55, -rr * 0.25), 0.03, M['amber'], 8)
    parts.append(cal)
    return join(parts, name)


# ------------------------------------------------------------------ assembly

def build(kind, livery=False, level=2, detail=True):
    sp = SPECS[kind]
    M = mats()
    body, rings = body_cage(sp, M)
    # wheel arches
    for z in sp['axles']:
        r = sp['wheel_r'] + 0.045
        cut = cylinder('arch', (-1.5, sp['wheel_r'] + 0.012, z), (1.5, sp['wheel_r'] + 0.012, z), r, M['under'], 40)
        mod = body.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cut
        mod.solver = 'EXACT'
        bk.apply_modifiers(body)
        bpy.data.objects.remove(cut)
    if kind == 'pickup':
        z0, z1, floor = sp['bed']
        cutter = cylinder('bedcut', (0, floor + 0.6, z0 - 0.06), (0, floor + 0.6, z1 + 0.06), 0.01, M['under'], 4)
        bpy.data.objects.remove(cutter)
        bpy.ops.mesh.primitive_cube_add(size=1, location=G((0, floor + 0.5, (z0 + z1) / 2 - 0.02)))
        bed = bpy.context.active_object
        bed.scale = (2 * (sp['width'](-1.5) - 0.07), abs(z1 - z0) - 0.12, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        bed.data.materials.append(M['trim'])
        mod = body.modifiers.new('bed', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = bed
        mod.solver = 'EXACT'
        bk.apply_modifiers(body)
        bpy.data.objects.remove(bed)
    for p in body.data.polygons:
        p.use_smooth = True
    body.data.set_sharp_from_angle(angle=math.radians(32))
    parts = [body]
    if sp.get('flares'):
        for z in sp['axles']:
            for sx in (1, -1):
                bpy.ops.mesh.primitive_torus_add(major_segments=40, minor_segments=8, major_radius=sp['wheel_r'] + 0.075,
                                                 minor_radius=0.034, location=G((sx * (sp['width'](z) - 0.012), sp['wheel_r'] + 0.012, z)),
                                                 rotation=(0, math.pi / 2, 0))
                fl = bpy.context.active_object
                fl.scale = (0.75, 1, 1)
                bpy.ops.object.transform_apply(scale=True, rotation=True)
                bm = bmesh.new()
                bm.from_mesh(fl.data)
                cut = [v for v in bm.verts if v.co.z < sp['wheel_r'] - 0.02]
                bmesh.ops.delete(bm, geom=cut, context='VERTS')
                bm.to_mesh(fl.data)
                bm.free()
                fl.data.materials.append(M['trim'])
                for p in fl.data.polygons:
                    p.use_smooth = True
                parts.append(fl)
    if sp.get('rails'):
        z0, z1 = sp['windshield'][0] - 0.1, sp['stations'][-1] + 0.25
        for sx in (1, -1):
            x = sx * (sp['roofw'](0) - 0.07)
            y = sp['top'](0) + 0.035
            parts.append(cylinder('rail', (x, y, z0), (x, y, z1), 0.014, M['chrome'], 8))
            for z in (z0, (z0 + z1) / 2, z1):
                parts.append(cylinder('rail_foot', (x, y - 0.035, z), (x, y, z), 0.016, M['trim'], 8))
    surf = Surface(body)
    if detail:
        parts += details(sp, surf, M, livery)
    car = join(parts, f'{kind}_body')
    wheels = []
    for zi, z in enumerate(sp['axles']):
        for sx in (1, -1):
            w = wheel(f'{kind}_wheel_{"f" if zi == 0 else "r"}{"l" if sx > 0 else "r"}', sp['wheel_r'], sp['wheel_w'], M,
                      spokes=6 if kind == 'suv' else 5, dark=livery)
            if sx < 0:
                w.scale = (-1, 1, 1)
                bpy.context.view_layer.objects.active = w
                for o in bpy.context.selected_objects:
                    o.select_set(False)
                w.select_set(True)
                bpy.ops.object.transform_apply(scale=True)
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.mesh.flip_normals()
                bpy.ops.object.mode_set(mode='OBJECT')
            w.location = G((sx * (sp['track'] - sp['wheel_w'] * 0.4), sp['wheel_r'], z))
            wheels.append(w)
    return car, wheels


def details(sp, surf, M, livery):
    parts = []
    front = sp['stations'][0] + 1.0
    rear = sp['stations'][-1] - 1.0
    # headlights and tail lights (mirrored)
    for x0, y0, x1, y1 in sp['lamps_front']:
        for sx in (1, -1):
            out = rounded_rect(sx * x0, y0, sx * x1, y1, front, r=0.03, flip=sx < 0)
            ob = projected_patch(surf, 'headlamp', out, (0, 0, -1), 0.004, M['lamp'], depth=0.006)
            if ob:
                parts.append(ob)
            strip = rounded_rect(sx * (x0 + 0.02), y1 - 0.022, sx * (x1 - 0.02), y1 - 0.008, front, r=0.006, n=2, flip=sx < 0)
            ob = projected_patch(surf, 'drl', strip, (0, 0, -1), 0.0075, M['drl'], res=3)
            if ob:
                parts.append(ob)
            for k in range(2):
                cxk = sx * (x0 + (x1 - x0) * (0.3 + 0.38 * k))
                ob = projected_patch(surf, 'lens', ellipse(cxk, (y0 + y1) / 2 - 0.006, 0.022, 0.022, front, 12), (0, 0, -1), 0.0072,
                                     M['chrome'], res=3)
                if ob:
                    parts.append(ob)
            ind = rounded_rect(sx * (x1 - 0.04), y0, sx * x1, y0 + 0.03, front, r=0.01, flip=sx < 0)
            ob = projected_patch(surf, 'indicator', ind, (0, 0, -1), 0.007, M['amberlamp'], res=4)
            if ob:
                parts.append(ob)
    for x0, y0, x1, y1 in sp['lamps_rear']:
        for sx in (1, -1):
            out = rounded_rect(sx * x0, y0, sx * x1, y1, rear, r=0.025, flip=False)
            ob = projected_patch(surf, 'taillamp', out, (0, 0, 1), 0.004, M['tail'], depth=0.006)
            if ob:
                parts.append(ob)
    # grille
    gx, gy0, gy1 = sp['grille']
    ob = projected_patch(surf, 'grille', rounded_rect(-gx, gy0, gx, gy1, front, r=0.04), (0, 0, -1), 0.003, M['trim'], depth=0.01)
    if ob:
        parts.append(ob)
    for k in range(4):
        y = gy0 + (gy1 - gy0) * (k + 0.5) / 4
        bar = projected_patch(surf, 'gbar', rounded_rect(-gx + 0.03, y - 0.008, gx - 0.03, y + 0.008, front, r=0.006, n=2),
                              (0, 0, -1), 0.012, M['chrome'], res=3)
        if bar:
            parts.append(bar)
    # number plates
    for z, y, d in ((front, sp['plate_front'], (0, 0, -1)), (rear, sp['plate_rear'], (0, 0, 1))):
        ob = projected_patch(surf, 'plate', rounded_rect(-0.26, y - 0.055, 0.26, y + 0.055, z, r=0.01, n=2, flip=d[2] > 0), d,
                             0.006, M['plate'], depth=0.004, res=3)
        if ob:
            parts.append(ob)
    # door shut lines, handles
    for sx in (1, -1):
        for z in sp['door_lines']:
            pts = [(sx * 2.0, y, z + (y - 0.6) * 0.02) for y in np.linspace(sp['bottom'](z) + 0.06, sp['belt'](z) + 0.02, 14)]
            ob = seam(surf, 'seam', pts, (-sx, 0, 0), M['trim'])
            if ob:
                parts.append(ob)
        dl = sp['door_lines']
        for z0, z1 in zip(dl[:-1], dl[1:]):
            zc = z1 + 0.12
            y = sp['belt'](zc) - 0.07
            h = surf.hit((sx * 2.0, y, zc), (-sx, 0, 0))
            if h:
                hp, hn = h
                parts.append(cylinder('handle', hp + hn * 0.012 + np.array([0, 0, 0.06]), hp + hn * 0.012 - np.array([0, 0, 0.06]), 0.011,
                                      M['chrome'] if not livery else M['trim'], 8))
        # side mirror
        zm = sp['mirror_z']
        y = sp['belt'](zm) + 0.06
        h = surf.hit((sx * 2.0, y, zm), (-sx, 0, 0))
        if h:
            hp, hn = h
            parts.append(cylinder('mirror_arm', hp, hp + np.array([sx * 0.1, 0.02, -0.02]), 0.02, M['trim'], 8))
            bpy.ops.mesh.primitive_cube_add(size=2, location=G(hp + np.array([sx * 0.16, 0.05, -0.04])))
            mo = bpy.context.active_object
            mo.scale = (0.095, 0.035, 0.06)
            bpy.ops.object.transform_apply(scale=True)
            bev = mo.modifiers.new('b', 'BEVEL')
            bev.width = 0.028
            bev.segments = 4
            bk.apply_modifiers(mo)
            for p in mo.data.polygons:
                p.use_smooth = True
            mo.data.materials.append(M['paint'] if not livery else M['livery'])
            parts.append(mo)
    # chrome window line along the shoulder of the glass
    ws = sp['windshield']
    zs_win = [z for z in np.linspace(ws[0] - 0.02, (sp.get('rear_glass') or (sp['stations'][-1] + 0.3,))[0] + 0.25, 40)]
    for sx in (1, -1):
        pts = [(sx * 2.0, sp['belt'](z) + 0.016, z) for z in zs_win if section(sp, z)[1] > 0.6]
        ob = seam(surf, 'winline', pts, (-sx, 0, 0), M['chrome'], width=0.012, offset=0.002)
        if ob:
            parts.append(ob)
    # lower intake
    front = sp['stations'][0] + 1.0
    gx, gy0, gy1 = sp['grille']
    ob = projected_patch(surf, 'intake', rounded_rect(-gx * 1.2, sp['bottom'](sp['stations'][0]) + 0.05, gx * 1.2, gy0 - 0.06, front, r=0.03),
                         (0, 0, -1), 0.003, M['trim'], depth=0.008, res=4)
    if ob:
        parts.append(ob)
    # black lower valances: a bumper lip at the front, a diffuser band at the rear
    for z, d, y0 in ((front, (0, 0, -1), sp['bottom'](sp['stations'][0])), (rear, (0, 0, 1), sp['bottom'](sp['stations'][-1]))):
        w0 = sp['width'](sp['stations'][0] if d[2] < 0 else sp['stations'][-1]) * 0.92
        ob = projected_patch(surf, 'valance', rounded_rect(-w0, y0 + 0.005, w0, y0 + 0.075, z, r=0.02, flip=d[2] > 0), d, 0.003, M['trim'],
                             depth=0.006, res=4)
        if ob:
            parts.append(ob)
    # wipers
    z0, z1 = sp['windshield']
    for x in (-0.1, 0.42):
        h = surf.hit((x, 3.0, z1 - 0.05), (0, -1, 0))
        if h:
            hp, hn = h
            parts.append(cylinder('wiper', hp + hn * 0.012, hp + hn * 0.012 + np.array([-0.45, 0.06, -0.12]), 0.006, M['trim'], 5))
    return parts


def livery_decals(car_body, sp, surf_ob):
    """Courier livery: amber shoulder stripe and the app's name on the front doors."""
    surf = Surface(surf_ob)
    out = []
    M = mats()
    img = bk.image(os.path.join(HERE, 'decals', 'door_light.png'))
    dm = bk.material('door_decal', tex=img, alpha_tex=True, rough=0.3)
    dl = sp['door_lines']
    z0, z1 = dl[1] + 0.08, dl[0] - 0.12
    for sx in (1, -1):
        y0 = sp['bottom']((z0 + z1) / 2) + 0.3
        h = (z1 - z0) / 4.0
        verts, faces, uvs = [], [], []
        nu, nv = 14, 4
        ok = True
        for i in range(nu + 1):
            for j in range(nv + 1):
                u, v = i / nu, j / nv
                z = z1 - u * (z1 - z0) if sx > 0 else z0 + u * (z1 - z0)
                hit = surf.hit((sx * 2.0, y0 + v * h, z), (-sx, 0, 0))
                if hit is None:
                    ok = False
                    break
                hp, hn = hit
                verts.append(G(hp + hn * 0.0025))
                uvs.append((u, v))
            if not ok:
                break
        if ok:
            for i in range(nu):
                for j in range(nv):
                    a = i * (nv + 1) + j
                    quad = [a, a + nv + 1, a + nv + 2, a + 1]
                    faces.append(quad if sx > 0 else quad[::-1])
            uvf = [[uvs[k] for k in f] for f in faces]
            ob = bk.mesh_object('door_decal', verts, faces, uvf, [dm], smooth=True)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            for f in bm.faces:
                if f.normal.dot(mathutils.Vector((sx, 0, 0))) < 0:
                    f.normal_flip()
            bm.to_mesh(ob.data)
            bm.free()
            out.append(ob)
        st = seam(surf, 'stripe', [(sx * 2.0, sp['belt'](z) - 0.03, z) for z in np.linspace(sp['stations'][0] - 0.25,
                  sp['stations'][-1] + 0.25, 50)], (-sx, 0, 0), M['amber'], width=0.04, offset=0.0018)
        if st:
            out.append(st)
    return out


def build_all(out_dir, preview=None):
    """Player car (detailed, separate wheels) + parked set (baked, see parked.py)."""
    from build_models import export, stats, tree, set_origin, preview as pv
    report = {}
    # player courier hatchback
    bk.reset()
    car, wheels = build('hatch', livery=True, level=2)
    # charcoal livery paint with the amber stripe and door names
    white = bk.material('courier_white', (0.86, 0.86, 0.84), rough=0.25, metal=0.2, clearcoat=1.0)
    car.data.materials[car.data.materials.find('car_paint')] = white
    car.data.materials[car.data.materials.find('car_roof')] = mats()['livery']
    deco = livery_decals(car, SPECS['hatch'], car)
    car = join([car] + deco, 'car_body')
    root = bk.empty('car')
    car.parent = root
    for w in wheels:
        w.parent = root
    objs = tree(root)
    report['car'] = dict(stats(objs), bytes=export(objs, os.path.join(out_dir, 'car.glb')))
    if preview:
        pv(preview, 'car', (3.6, 1.6, 3.4), (0, 0.7, 0.2), lens=35)
        pv(preview, 'car_back', (-3.0, 1.8, -3.8), (0, 0.7, -0.2), lens=35)
    # parked cars: light meshes with the full detail baked into one texture atlas
    import parked
    report['parked'] = parked.build(out_dir, preview)
    return report
