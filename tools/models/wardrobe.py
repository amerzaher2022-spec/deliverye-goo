"""Garments, hair and accessories for the original figures (geometry only; colours are in paint.py).

All pieces are offsets of the body's own forms, so they fit every build and every pose.
"""
import numpy as np

from anatomy import SIDES
from sculpt import NOISE, sd_box, sd_ellipsoid, smax, smin


def _bl(fig, bone):
    return fig.sk.bones[bone]['length']


def _infl(loft, dx, dz, ys=None, scale_bottom=1.0):
    y, hx, hz, cz = loft
    hx = np.asarray(hx) + dx
    hz = np.asarray(hz) + dz
    if scale_bottom != 1.0:
        w = np.linspace(scale_bottom, 1.0, len(y))
        hx, hz = hx * w, hz * w
    return (np.asarray(y) if ys is None else ys, hx, hz, cz)


def _clip_loft(loft, y0, y1):
    """Re-sample a loft between y0 and y1 (keeps the shape, moves the ends)."""
    y, hx, hz, cz = loft
    ys = np.unique(np.clip(np.concatenate([[y0], y[(y > y0) & (y < y1)], [y1]]), y0, y1))
    return ys, np.interp(ys, y, hx), np.interp(ys, y, hz), np.interp(ys, y, cz)


# ------------------------------------------------------------------ tops

def _limbs(*names):
    return [f'{n}.{s}' for n in names for s, _ in SIDES]


def top(fig, b, group='shirt', sleeve=0.45, loose=0.011, hem=-0.035, collar='polo', tuck=False):
    """T-shirt / polo / shirt. sleeve: fraction of the upper arm (0.45 short) or 1 + fraction of the forearm."""
    s = b.s
    clip = {'pelvis': [((0, -1, 0), -(0.07 if tuck else hem) * s, 0.004)]}
    for side, _ in SIDES:
        L = _bl(fig, f'uarm.{side}')
        if sleeve <= 1.0:
            clip[f'uarm.{side}'] = [((0, 1, 0), sleeve * L, 0.004)]
        else:
            clip[f'farm.{side}'] = [((0, 1, 0), (sleeve - 1.0) * _bl(fig, f'farm.{side}'), 0.004)]
    hem_plane = ('pelvis', (0, -1, 0), -(0.07 if tuck else hem) * s, 0.004)
    for side, _ in SIDES:
        clip[f'thigh.{side}'] = [hem_plane]
    bones = ['pelvis', 'spine', 'chest'] + _limbs('clav', 'uarm', 'thigh') + (_limbs('farm') if sleeve > 1.0 else [])
    # the top sits a little outside the trousers so its hem stays level
    fig.clone('skin', group, bones, loose + 0.004, clip, skip=lambda p: p.bone.startswith('thigh') and p.kind != 'cone')
    if collar == 'polo':
        def ring(q, s=s):
            d2 = np.sqrt(q[:, 0] ** 2 + (q[:, 2] + 0.004) ** 2) - 0.064 * s
            return np.sqrt(d2 ** 2 + q[:, 1] ** 2 * 0.35) - 0.011 * s
        fig.custom(group, 'neck', ring, np.array([-0.09, -0.05, -0.09]) * s, np.array([0.09, 0.05, 0.09]) * s, k=0.006)
    elif collar == 'crew':
        def ring(q, s=s):
            d2 = np.sqrt(q[:, 0] ** 2 + (q[:, 2] + 0.002) ** 2) - 0.061 * s
            return np.sqrt(d2 ** 2 + (q[:, 1] + 0.022 * s) ** 2) - 0.006 * s
        fig.custom(group, 'neck', ring, np.array([-0.08, -0.04, -0.08]) * s, np.array([0.08, 0.0, 0.08]) * s, k=0.006)
    fig.displace[group] = lambda P: 0.0022 * NOISE.fbm(P * np.array([1.0, 1.6, 1.0]), 22, 3)


def vest(fig, b, group='vest', loose=0.026, hem=0.0):
    """Sleeveless vest worn over a top (high-visibility vest)."""
    s = b.s
    fig.clone('skin', group, ['pelvis', 'spine', 'chest'], loose, {'pelvis': [((0, -1, 0), -hem * s, 0.004)]},
              skip=lambda p: p.bone == 'chest' and p.kind == 'cone')
    for sx in (1, -1):
        fig.cone(group, 'chest', np.array([sx * 0.04, 0.226, -0.022]) * s, np.array([sx * 0.13, 0.19, -0.02]) * s,
                 0.05 * s, 0.045 * s, k=0.03)
        fig.ellipsoid(group, 'chest', np.array([sx * 0.2, 0.1, 0.0]) * s, np.array([0.065, 0.11, 0.08]) * s, k=0.01, op='sub')
    fig.box(group, 'chest', np.array([0, 0.18, 0.12]) * s, np.array([0.03, 0.08, 0.06]) * s, 0.01, k=0.01, op='sub')


def coat(fig, b, group='coat', length=0.42, loose=0.02):
    """Long women's coat (manteau): fitted to the body above the waist, A-line below, long sleeves."""
    s = b.s
    clip = {}
    for side, _ in SIDES:
        clip[f'farm.{side}'] = [((0, 1, 0), 0.9 * _bl(fig, f'farm.{side}'), 0.004)]
    for side, _ in SIDES:
        clip[f'thigh.{side}'] = [('pelvis', (0, -1, 0), length * s * 0.9, 0.01)]
    fig.clone('skin', group, ['pelvis', 'spine', 'chest'] + _limbs('clav', 'uarm', 'farm', 'thigh'), loose, clip)
    y0 = -length * s
    lo = b.lower
    ys = np.array([y0, y0 * 0.6, y0 * 0.25, 0.0, 0.06 * s])
    hx = np.interp(np.clip(ys, lo[0][0], lo[0][-1]), lo[0], lo[1]) * np.array([1.38, 1.28, 1.18, 1.1, 1.0]) + loose
    hz = np.interp(np.clip(ys, lo[0][0], lo[0][-1]), lo[0], lo[2]) * np.array([1.4, 1.28, 1.16, 1.06, 1.0]) + loose
    cz = np.array([0.0, -0.005, -0.01, -0.008, 0.0]) * s
    fig.loft(group, 'pelvis', ys, hx, hz, cz, k=0.03)
    fig.displace[group] = lambda P: 0.003 * NOISE.fbm(P * np.array([1.0, 0.5, 1.0]), 16, 3)


# ------------------------------------------------------------------ bottoms

def trousers(fig, b, group='pants', loose=0.012, flare=0.0, length=0.97, waist=0.115):
    s = b.s
    clip = {'pelvis': [((0, 1, 0), waist * s, 0.004)]}
    for side, _ in SIDES:
        clip[f'shin.{side}'] = [((0, 1, 0), length * _bl(fig, f'shin.{side}'), 0.004)]
    fig.clone('skin', group, ['pelvis'] + _limbs('thigh', 'shin'), loose, clip)
    if flare:
        for side, _ in SIDES:
            sh = f'shin.{side}'
            L = _bl(fig, sh)
            fig.cone(group, sh, [0, L * 0.55, 0], [0, L * length, 0], 0.045 * s + loose, 0.04 * s + loose + flare, k=0.03)
    fig.displace[group] = lambda P: 0.0025 * NOISE.fbm(P * np.array([1.0, 2.2, 1.0]), 20, 3)


def sharwal(fig, b, group='kurdi'):
    """Traditional Kurdish trousers: very wide, gathered at the ankle."""
    s = b.s
    clip = {'pelvis': [((0, 1, 0), 0.115 * s, 0.004)]}
    for side, _ in SIDES:
        clip[f'shin.{side}'] = [((0, 1, 0), 0.95 * _bl(fig, f'shin.{side}'), 0.004)]
    fig.clone('skin', group, ['pelvis'] + _limbs('thigh', 'shin'), 0.022, clip, k=0.04)
    for side, sx in SIDES:
        th, sh = f'thigh.{side}', f'shin.{side}'
        fig.cone(group, th, [0, -0.02, 0], [0, _bl(fig, th), 0], 0.112 * s, 0.088 * s, k=0.05)
        fig.cone(group, sh, [0, 0, 0], [0, _bl(fig, sh) * 0.78, 0], 0.088 * s, 0.064 * s, k=0.05)
    fig.displace[group] = lambda P: 0.006 * NOISE.fbm(P * np.array([1.0, 2.6, 1.0]), 12, 3)


def sash(fig, b, group='sash'):
    """Wide wrapped waist sash (pishtên)."""
    s = b.s
    y, hx, hz, cz = b.lower
    ys = np.array([0.02, 0.06, 0.1, 0.14, 0.17]) * s
    fig.loft(group, 'pelvis', ys, np.interp(ys, y, hx) + 0.058, np.interp(ys, y, hz) + 0.056 + 0.012 * b.belly, np.interp(ys, y, cz), k=0.01)
    fig.displace[group] = lambda P: 0.003 * np.sin(P[:, 1] * 260)


def apron(fig, b, group='apron'):
    s = b.s
    y, hx, hz, cz = b.lower
    front = float(np.interp(0.05 * s, y, hz) + np.interp(0.05 * s, y, cz))
    fig.box(group, 'pelvis', np.array([0, -0.12 * s, front + 0.03 * s]), np.array([0.15, 0.22, 0.012]) * s, 0.01, k=0.0)
    fig.loft(group, 'pelvis', np.array([0.09, 0.115]) * s, np.interp([0.09, 0.115], y, hx) + 0.02,
             np.interp([0.09, 0.115], y, hz) + 0.02, np.interp([0.09, 0.115], y, cz), k=0.0)


# ------------------------------------------------------------------ shoes

def shoes(fig, b, kind='sneaker'):
    s = b.s
    for side, sx in SIDES:
        ft = f'foot.{side}'
        ys = np.array([-0.07, -0.035, 0.03, 0.1, 0.17, 0.205]) * s
        hx = np.array([0.034, 0.041, 0.045, 0.047, 0.041, 0.02]) * s
        hz = np.array([0.05, 0.056, 0.05, 0.036, 0.029, 0.018]) * s
        cz = np.array([-0.032, -0.028, -0.04, -0.052, -0.058, -0.062]) * s
        cx = np.array([0.0, 0.0, 0.004, 0.008, 0.01, 0.008]) * s   # toe box leans to the big toe
        if kind == 'boot':
            hz = hz + np.array([0.02, 0.02, 0.008, 0.004, 0.004, 0.003]) * s
            cz = cz + np.array([0.02, 0.02, 0.004, 0, 0, 0]) * s
        fig.loft('shoes', ft, ys, hx, hz, cz, cx, k=0.0)
        fig.box('sole', ft, np.array([0.004, 0.065, -0.073]) * s, np.array([0.049, 0.142, 0.0085]) * s, 0.008 * s, k=0.0)
        if kind == 'sneaker':
            fig.cone('shoes', ft, np.array([0, -0.02, 0.0]) * s, np.array([0, 0.0, 0.012]) * s, 0.045 * s, 0.042 * s, k=0.01)


# ------------------------------------------------------------------ head wear and hair

def _hairline(q, front=0.158, temple=0.132, side=0.1, back=0.035, s=1.0):
    """Height of the hairline around the head, from the horizontal angle."""
    ang = np.arctan2(np.abs(q[:, 0]), q[:, 2])   # 0 = front, pi = back
    pts = np.array([0, 0.55, 1.35, 2.0, np.pi])
    hs = np.array([front, temple, side, side * 0.7 + back * 0.3, back]) * s
    return np.interp(ang, pts, hs)


def hair_short(fig, b, group='hair', length=0.006, front=0.158, top=0.012):
    s = b.s * b.head

    def fn(q):
        d = sd_ellipsoid(q, np.array([0, 0.095 + top * 0.3, -0.017]) * s,
                         np.array([0.073 + length, 0.1 + length + top, 0.092 + length]) * s)
        return smax(d, _hairline(q, front=front, s=s) - q[:, 1], 0.004 * s)
    fig.custom(group, 'head', fn, np.array([-0.1, 0.0, -0.13]) * s, np.array([0.1, 0.23, 0.12]) * s, k=0.0)
    fig.displace[group] = lambda P: 0.0018 * NOISE.fbm(P * np.array([3.0, 1.0, 3.0]), 60, 2)


def hair_bun(fig, b, group='hair'):
    s = b.s * b.head
    hair_short(fig, b, group, length=0.007, front=0.16, top=0.008)
    fig.ellipsoid(group, 'head', np.array([0, 0.15, -0.105]) * s, np.array([0.038, 0.034, 0.034]) * s, k=0.01)


def hair_long(fig, b, group='hair'):
    s = b.s * b.head
    hair_short(fig, b, group, length=0.009, front=0.162, top=0.01)

    def back(q):
        d = sd_box(q, np.array([0, 0.03, -0.055]) * s, np.array([0.08, 0.09, 0.05]) * s, 0.04 * s)
        return smax(d, q[:, 2] - 0.02 * s, 0.01)
    fig.custom(group, 'head', back, np.array([-0.1, -0.08, -0.12]) * s, np.array([0.1, 0.15, 0.04]) * s, k=0.02)
    fig.displace[group] = lambda P: 0.002 * NOISE.fbm(P * np.array([4.0, 0.6, 4.0]), 50, 2)


def helmet(fig, b, group='helmet'):
    """Open-face (three-quarter) delivery helmet: covers the ears and the back of the head, short peak."""
    s = b.s * b.head
    c = np.array([0, 0.096, -0.018]) * s
    R = np.array([0.104, 0.12, 0.127]) * s

    def fn(q):
        outer = sd_ellipsoid(q, c, R)
        inner = sd_ellipsoid(q, c, R - 0.02 * s)
        d = smax(outer, -inner, 0.002)
        back = np.clip(-(q[:, 2] - c[2]) / R[2], 0, 1)
        d = smax(d, (0.012 - 0.03 * back) * s - q[:, 1], 0.006 * s)
        open_ = sd_ellipsoid(q, np.array([0, 0.03, 0.125]) * s, np.array([0.074, 0.102, 0.1]) * s)
        return smax(d, -open_, 0.008 * s)
    fig.custom(group, 'head', fn, c - R - 0.01, c + R + 0.01, k=0.0)
    fig.box('visor', 'head', np.array([0, 0.142, 0.112]) * s, np.array([0.06, 0.004, 0.018]) * s, 0.0035 * s, k=0.0)


def cap(fig, b, group='cap'):
    s = b.s * b.head
    c = np.array([0, 0.11, -0.012]) * s

    def fn(q):
        d = sd_ellipsoid(q, c, np.array([0.08, 0.092, 0.1]) * s)
        return smax(d, 0.125 * s - q[:, 1] + np.clip(q[:, 2], -1, 0) * 0.2, 0.004 * s)
    fig.custom(group, 'head', fn, c - 0.12, c + 0.12, k=0.0)

    def brim(q):
        d = sd_ellipsoid(q, np.array([0, 0.135, 0.1]) * s, np.array([0.072, 0.007, 0.062]) * s)
        return smax(d, 0.06 * s - q[:, 2], 0.004 * s)
    fig.custom(group, 'head', brim, np.array([-0.09, 0.11, 0.0]) * s, np.array([0.09, 0.16, 0.18]) * s, k=0.004)


def hijab(fig, b, group='scarf'):
    """Headscarf framing the face and draping over the neck and shoulders."""
    s = b.s * b.head

    def fn(q):
        d = sd_ellipsoid(q, np.array([0, 0.092, -0.016]) * s, np.array([0.086, 0.112, 0.106]) * s)
        neck = sd_ellipsoid(q, np.array([0, -0.06, -0.025]) * s, np.array([0.098, 0.1, 0.098]) * s)
        d = smin(d, neck, 0.03 * s)
        face = sd_ellipsoid(q, np.array([0, 0.045, 0.1]) * s, np.array([0.058, 0.098, 0.075]) * s)
        return smax(d, -face, 0.008 * s)
    fig.custom(group, 'head', fn, np.array([-0.15, -0.14, -0.15]) * s, np.array([0.15, 0.23, 0.15]) * s, k=0.0)
    # drape over the shoulders and upper chest (chest frame)
    fig.ellipsoid(group, 'chest', np.array([0, 0.19, 0.0]) * s, np.array([0.135, 0.075, 0.12]) * b.s, k=0.03)
    fig.displace[group] = lambda P: 0.003 * NOISE.fbm(P * np.array([1.0, 2.0, 1.0]), 14, 3)


def jamana(fig, b, group='turban'):
    """Kurdish men's wrapped headscarf (jamana / klaw u jamana)."""
    s = b.s * b.head
    c = np.array([0, 0.118, -0.012]) * s

    def fn(q):
        d = sd_ellipsoid(q, c, np.array([0.086, 0.07, 0.102]) * s)
        d = smax(d, 0.088 * s - q[:, 1], 0.006 * s)
        wraps = 0.002 * np.sin((q[:, 1] - c[1]) * 900 + np.arctan2(q[:, 0], q[:, 2]) * 2)
        return d - wraps
    fig.custom(group, 'head', fn, c - 0.12, c + 0.12, k=0.0)


# ------------------------------------------------------------------ carried / worn kit

def backpack(fig, b, group='bag'):
    """Insulated delivery backpack with shoulder straps."""
    s = b.s
    y, hx, hz, cz = b.upper
    back = -(np.interp(0.08 * s, y, hz) - np.interp(0.08 * s, y, cz)) - 0.012
    c = np.array([0, 0.06 * s, back - 0.13])
    b.bag_back = c[2] - 0.12
    b.bag_centre = c
    fig.box(group, 'chest', c, np.array([0.2, 0.215, 0.12]), 0.028, k=0.0)
    fig.box('bagtop', 'chest', c + np.array([0, 0.205, 0]), np.array([0.196, 0.016, 0.116]), 0.014, k=0.0)
    for sx in (1, -1):
        pts = [np.array([sx * 0.085, 0.2 * s, back - 0.02]), np.array([sx * 0.1, 0.235 * s, -0.035 * s]),
               np.array([sx * 0.105, 0.2 * s, 0.07 * s]), np.array([sx * 0.13, 0.06 * s, 0.1 * s]),
               np.array([sx * 0.16, -0.02 * s, 0.03 * s])]
        for a, c2 in zip(pts[:-1], pts[1:]):
            fig.cone('strap', 'chest', a, c2, 0.012, 0.012, k=0.01)


# ------------------------------------------------------------------ more pieces

def moustache(fig, b, group='hair', full=1.0):
    s = b.s * b.head
    fig.ellipsoid(group, 'head', np.array([0, 0.0255, 0.0985]) * s, np.array([0.024, 0.0058, 0.0085]) * s * full, k=0.002)


def hood(fig, b, group='shirt'):
    """Folded hood lying behind the neck, and a front pocket."""
    s = b.s
    fig.ellipsoid(group, 'chest', np.array([0, 0.235, -0.07]) * s, np.array([0.105, 0.055, 0.07]) * s, k=0.02)
    fig.ellipsoid(group, 'chest', np.array([0, 0.205, -0.02]) * s, np.array([0.085, 0.035, 0.085]) * s, k=0.02)
    y, hx, hz, cz = b.lower
    front = float(np.interp(0.15 * s, y, hz) + np.interp(0.15 * s, y, cz))
    fig.box(group, 'pelvis', np.array([0, 0.15 * s, front + 0.02]), np.array([0.11, 0.05, 0.006]) * s, 0.006, k=0.004)


def hardhat(fig, b, group='hardhat'):
    s = b.s * b.head
    c = np.array([0, 0.105, -0.014]) * s

    def dome(q):
        d = sd_ellipsoid(q, c, np.array([0.096, 0.104, 0.112]) * s)
        return smax(d, 0.112 * s - q[:, 1], 0.004 * s)
    fig.custom(group, 'head', dome, c - 0.13, c + 0.13, k=0.0)

    def brim(q):
        d = sd_ellipsoid(q, np.array([0, 0.112, 0.004]) * s, np.array([0.112, 0.006, 0.134]) * s)
        return d
    fig.custom(group, 'head', brim, c - 0.15, c + 0.15, k=0.004)
    fig.cone(group, 'head', np.array([0, 0.205, -0.08]) * s, np.array([0, 0.214, 0.06]) * s, 0.012 * s, 0.01 * s, k=0.01)


def headset(fig, b, group='headset'):
    s = b.s * b.head

    def band(q):
        # arc over the head from ear to ear
        d = np.sqrt(q[:, 0] ** 2 + (q[:, 1] - 0.085 * s) ** 2) - 0.106 * s
        d = np.sqrt(d ** 2 + (q[:, 2] + 0.008 * s) ** 2) - 0.007 * s
        return smax(d, 0.085 * s - q[:, 1], 0.003 * s)
    fig.custom(group, 'head', band, np.array([-0.13, 0.05, -0.04]) * s, np.array([0.13, 0.21, 0.03]) * s, k=0.0)
    for sx in (1, -1):
        fig.ellipsoid(group, 'head', np.array([sx * 0.088, 0.07, -0.008]) * s, np.array([0.014, 0.032, 0.03]) * s, k=0.003)
    fig.cone(group, 'head', np.array([0.09, 0.055, 0.0]) * s, np.array([0.035, 0.012, 0.1]) * s, 0.0035 * s, 0.003 * s, k=0.0)
    fig.ellipsoid(group, 'head', np.array([0.03, 0.012, 0.104]) * s, np.array([0.009, 0.006, 0.006]) * s, k=0.002)


# ------------------------------------------------------------------ carried props (in world space, after posing)

def palms(fig, b):
    """Centre between the palms and the height of the palms (after posing)."""
    sk = fig.sk
    pts = []
    for side, sx in SIDES:
        palm = np.array([1.0, 0, 0]) if sx > 0 else np.array([-1.0, 0, 0])
        pts.append(sk.point(f'hand.{side}', palm * 0.014 * b.s + np.array([0, 0.06 * b.s, 0])))
    pts = np.array(pts)
    return pts.mean(0), pts[:, 1].max()


def _world_bone(fig):
    if 'world' not in fig.sk.bones:
        fig.sk.add('world', None, (0, 0, 0), (0, 1, 0))


def foil_trays(fig, b, count=3):
    _world_bone(fig)
    c, top = palms(fig, b)
    y = top + 0.012
    for i in range(count):
        cc = np.array([c[0], y + 0.024, c[2] + 0.015])

        def tray(q, cc=cc):
            t = np.clip((q[:, 1] - cc[1]) / 0.05 + 0.5, 0, 1)     # walls flare towards the top
            sc_ = 0.88 + 0.12 * t
            p = q.copy()
            p[:, 0] = cc[0] + (q[:, 0] - cc[0]) / sc_
            p[:, 2] = cc[2] + (q[:, 2] - cc[2]) / sc_
            return sd_box(p, cc, np.array([0.112, 0.024, 0.08]), 0.008)
        fig.custom('foil', 'world', tray, cc - 0.15, cc + 0.15, k=0.0)
        fig.box('lid', 'world', cc + np.array([0, 0.028, 0]), np.array([0.118, 0.005, 0.086]), 0.004, k=0.0)
        fig.box('lid', 'world', cc + np.array([0, 0.034, 0]), np.array([0.09, 0.003, 0.06]), 0.003, k=0.002)
        y += 0.062
    b.prop_top = y


def pizza_boxes(fig, b, count=3):
    _world_bone(fig)
    c, top = palms(fig, b)
    y = top + 0.012
    for i in range(count):
        cc = np.array([c[0], y + 0.022, c[2] + 0.06])
        fig.box('kraft', 'world', cc, np.array([0.165, 0.021, 0.165]), 0.004, k=0.0)
        y += 0.045
    b.prop_top = y
    b.prop_centre = np.array([c[0], y, c[2] + 0.06])
