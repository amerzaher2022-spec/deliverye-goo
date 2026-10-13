"""Original human figures for Erbil Delivery World: skeleton, body, head, hands (numpy).

Everything here is authored for this project; no third-party body data is used.
Units: metres. World: y up, the figure faces +z, its left side is +x.
"""
import numpy as np

from sculpt import NOISE, Figure, Skeleton, sd_ellipsoid, smax

FINGERS = ('index', 'middle', 'ring', 'pinky')
FINGER_LEN = {'index': (0.044, 0.026, 0.021), 'middle': (0.049, 0.030, 0.023),
              'ring': (0.046, 0.028, 0.022), 'pinky': (0.036, 0.021, 0.019)}
FINGER_Z = {'index': 0.029, 'middle': 0.0095, 'ring': -0.0095, 'pinky': -0.027}
FINGER_R = {'index': 0.0092, 'middle': 0.0094, 'ring': 0.0088, 'pinky': 0.0078}
SIDES = (('L', 1), ('R', -1))


class Build:
    """Proportions for one person."""

    def __init__(self, sex='m', height=1.76, shoulders=1.0, hips=1.0, belly=0.0, muscle=1.0, chest=1.0, head=1.0):
        self.sex, self.height = sex, height
        self.shoulders, self.hips, self.belly, self.muscle, self.chest, self.head = shoulders, hips, belly, muscle, chest, head
        self.s = height / 1.76


def skeleton(b: Build):
    """Rest pose: standing, arms hanging slightly away from the body, palms facing the thighs."""
    s = b.s
    f = b.sex == 'f'
    sh = (0.176 if f else 0.186) * b.shoulders
    hip = (0.09 if f else 0.09) * b.hips

    def P(x, y, z):
        return np.array([x, y, z]) * s

    sk = Skeleton()
    sk.add('pelvis', None, P(0, 0.93, 0), P(0, 1.04, 0))
    sk.add('spine', 'pelvis', P(0, 1.04, 0), P(0, 1.24, 0.01))
    sk.add('chest', 'spine', P(0, 1.24, 0.01), P(0, 1.47, -0.01))
    sk.add('neck', 'chest', P(0, 1.47, -0.01), P(0, 1.565, 0.005))
    sk.add('head', 'neck', P(0, 1.565, 0.005), P(0, 1.76, 0.005))
    for side, sx in SIDES:
        sk.add(f'clav.{side}', 'chest', P(sx * 0.02, 1.435, 0.02), P(sx * (sh - 0.012), 1.432, -0.012), forward=(0, 1, 0))
        sk.add(f'uarm.{side}', f'clav.{side}', P(sx * sh, 1.42, -0.015), P(sx * (sh + 0.022), 1.143, -0.035))
        sk.add(f'farm.{side}', f'uarm.{side}', P(sx * (sh + 0.022), 1.143, -0.035), P(sx * (sh + 0.03), 0.893, 0.0))
        sk.add(f'hand.{side}', f'farm.{side}', P(sx * (sh + 0.03), 0.893, 0.0), P(sx * (sh + 0.033), 0.808, 0.004))
        hx, hy, hz = sx * (sh + 0.033), 0.808, 0.004
        for fi in FINGERS:
            z = FINGER_Z[fi]
            prev = f'hand.{side}'
            y0 = hy - (0.004 if fi in ('middle', 'ring') else 0.0) + (0.004 if fi == 'pinky' else 0)
            for j, L in enumerate(FINGER_LEN[fi]):
                y1 = y0 - L
                sk.add(f'{fi}{j + 1}.{side}', prev, P(hx, y0, hz + z), P(hx, y1, hz + z))
                prev = f'{fi}{j + 1}.{side}'
                y0 = y1
        # thumb: from the base of the palm, pointing down and forward
        t0 = np.array([hx - sx * 0.008, 0.872, 0.026])
        d = np.array([-sx * 0.25, -0.62, 0.74])
        d /= np.linalg.norm(d)
        prev = f'hand.{side}'
        for j, L in enumerate((0.042, 0.031, 0.026)):
            t1 = t0 + d * L
            sk.add(f'thumb{j + 1}.{side}', prev, P(*t0), P(*t1), forward=(sx * 1.0, 0, 0))
            prev = f'thumb{j + 1}.{side}'
            t0 = t1
            d = d + np.array([0, -0.1, -0.05])
            d /= np.linalg.norm(d)
        sk.add(f'thigh.{side}', 'pelvis', P(sx * hip, 0.925, 0.0), P(sx * (hip + 0.006), 0.495, 0.012))
        sk.add(f'shin.{side}', f'thigh.{side}', P(sx * (hip + 0.006), 0.495, 0.012), P(sx * (hip + 0.01), 0.08, -0.012))
        # horizontal foot bone: local y forward, local z up (the sole sits at local z = -0.08)
        sk.add(f'foot.{side}', f'shin.{side}', P(sx * (hip + 0.01), 0.08, -0.012), P(sx * (hip + 0.016), 0.08, 0.15), forward=(0, 1, 0))
    return sk


def body(fig: Figure, b: Build):
    """Skin: torso, neck, limbs and hands."""
    s, f = b.s, b.sex == 'f'
    m = b.muscle
    g = 'skin'
    # lower torso in the pelvis frame (origin at the hip line)
    hx = np.array([0.128, 0.162, 0.170, 0.158, 0.146, 0.145]) * s
    hz = np.array([0.084, 0.100, 0.108, 0.104, 0.098, 0.097]) * s
    if f:
        hx = hx * np.array([1.0, 1.12, 1.12, 1.06, 0.94, 0.92]) * b.hips
        hz = hz * np.array([1.0, 1.06, 1.05, 1.0, 0.95, 0.94])
    hz = hz + np.array([0, 0, 0.004, 0.012, 0.016, 0.012]) * b.belly
    lower = (np.array([-0.10, -0.05, 0.0, 0.05, 0.11, 0.21]) * s, hx, hz,
             np.array([-0.012, -0.014, -0.008, 0.0, 0.006, 0.008]) * s + np.array([0, 0, 0.002, 0.01, 0.014, 0.01]) * b.belly)
    fig.loft(g, 'pelvis', *lower, k=0.02)
    b.lower = lower
    # upper torso in the chest frame (origin at the lower ribs)
    hx = np.array([0.146, 0.151, 0.160, 0.168, 0.168, 0.15, 0.09]) * s
    hz = np.array([0.097, 0.100, 0.107, 0.111, 0.107, 0.094, 0.068]) * s
    if f:
        hx = hx * np.array([0.9, 0.88, 0.9, 0.92, 0.93, 0.92, 0.9]) * b.shoulders
        hz = hz * np.array([0.92, 0.92, 0.95, 0.96, 0.95, 0.92, 0.9])
    else:
        hx = hx * np.array([1, 1, 1, b.shoulders, b.shoulders, b.shoulders, 1])
    hz = hz + np.array([0.01, 0.006, 0.0, 0, 0, 0, 0]) * b.belly
    upper = (np.array([-0.21, -0.09, -0.01, 0.06, 0.12, 0.18, 0.225]) * s, hx, hz,
             np.array([0.004, 0.006, 0.009, 0.009, 0.003, -0.012, -0.022]) * s)
    fig.loft(g, 'chest', *upper, k=0.05)
    b.upper = upper
    if f:
        for sx in (1, -1):
            fig.ellipsoid(g, 'chest', np.array([sx * 0.062, 0.035, 0.085]) * s, np.array([0.058, 0.058, 0.05]) * s * b.chest, k=0.03)
    else:
        for sx in (1, -1):
            fig.ellipsoid(g, 'chest', np.array([sx * 0.066, 0.06, 0.083]) * s, np.array([0.074, 0.048, 0.03]) * s * m, k=0.03)
    for sx in (1, -1):
        # shoulder blades, trapezius slope, buttocks
        fig.ellipsoid(g, 'chest', np.array([sx * 0.075, 0.1, -0.083]) * s, np.array([0.062, 0.07, 0.026]) * s, k=0.03)
        fig.cone(g, 'chest', np.array([sx * 0.03, 0.235, -0.025]) * s, np.array([sx * 0.15, 0.175, -0.022]) * s,
                 0.043 * s, 0.036 * s, k=0.035)
        fig.ellipsoid(g, 'pelvis', np.array([sx * 0.07, -0.045, -0.068]) * s,
                      np.array([0.084, 0.088, 0.066]) * s * (1.08 if f else 1.0), k=0.03)
    # neck
    fig.cone(g, 'neck', [0, -0.03 * s, -0.004], [0, 0.1 * s, 0.006], (0.052 if f else 0.058) * s, (0.047 if f else 0.053) * s, k=0.03)
    for side, sx in SIDES:
        L = lambda bone: fig.sk.bones[bone]['length']
        ua, fa = f'uarm.{side}', f'farm.{side}'
        r = (0.86 if f else 1.0)
        fig.ellipsoid(g, ua, [0, 0.045 * s, 0.0], np.array([0.05, 0.075, 0.054]) * s * r * m, k=0.04)
        fig.cone(g, ua, [0, 0, 0], [0, L(ua), 0], 0.049 * s * r * m, 0.037 * s * r, k=0.03)
        fig.ellipsoid(g, ua, [0, 0.13 * s, 0.013 * s], np.array([0.034, 0.08, 0.033]) * s * r * m, k=0.02)
        fig.ellipsoid(g, ua, [0, 0.11 * s, -0.014 * s], np.array([0.036, 0.09, 0.032]) * s * r * m, k=0.02)
        fig.cone(g, fa, [0, 0, 0], [0, L(fa), 0], 0.038 * s * r, 0.025 * s * r, k=0.02)
        fig.ellipsoid(g, fa, [0, 0.065 * s, 0.003], np.array([0.039, 0.085, 0.035]) * s * r * m, k=0.02)
        fig.ellipsoid(g, fa, [0, L(fa) - 0.012 * s, 0], np.array([0.018, 0.022, 0.028]) * s * r, k=0.012)
        hand(fig, side, sx, s * (0.92 if f else 1.0))
        th, sh = f'thigh.{side}', f'shin.{side}'
        r = 1.0
        fig.cone(g, th, [0, 0, 0], [0, L(th), 0], 0.086 * s * r, 0.052 * s, k=0.03)
        fig.ellipsoid(g, th, [0, 0.17 * s, 0.022 * s], np.array([0.068, 0.15, 0.058]) * s * m, k=0.03)
        fig.ellipsoid(g, th, [0.032 * s, 0.09 * s, -0.004], np.array([0.056, 0.1, 0.06]) * s, k=0.03)
        fig.ellipsoid(g, th, [0, L(th) - 0.006, 0.034 * s], np.array([0.03, 0.034, 0.02]) * s, k=0.015)
        fig.cone(g, sh, [0, 0, 0], [0, L(sh), 0], 0.049 * s, 0.032 * s, k=0.025)
        fig.ellipsoid(g, sh, [0.004, 0.13 * s, -0.024 * s], np.array([0.046, 0.11, 0.044]) * s * m, k=0.025)


def hand(fig, side, sx, s):
    g = 'skin'
    h = f'hand.{side}'
    # palm (thickness along local x, width along local z)
    fig.box(g, h, [0.0, 0.046 * s, 0.002], np.array([0.0125, 0.046, 0.041]) * s, 0.012 * s, k=0.012)
    fig.ellipsoid(g, h, [sx * 0.009 * s, 0.03 * s, 0.024 * s], np.array([0.013, 0.027, 0.016]) * s, k=0.01)
    for fi in FINGERS:
        r = FINGER_R[fi] * s
        for j in range(3):
            bone = f'{fi}{j + 1}.{side}'
            L = fig.sk.bones[bone]['length']
            r0 = r * (1.0, 0.92, 0.85)[j]
            r1 = r * (0.92, 0.85, 0.78)[j]
            fig.cone(g, bone, [0, 0, 0], [0, L - (r1 * 0.6 if j == 2 else 0), 0], r0, r1, k=0.004)
            if j == 2:
                fig.ellipsoid('nail', bone, [-sx * r1 * 0.62, L - r1 * 1.5, 0], [r1 * 0.42, r1 * 1.25, r1 * 0.78], k=0.0)
    for j in range(3):
        bone = f'thumb{j + 1}.{side}'
        L = fig.sk.bones[bone]['length']
        r0, r1 = (0.0125, 0.0105, 0.0098)[j] * s, (0.011, 0.0098, 0.008)[j] * s
        fig.cone(g, bone, [0, 0, 0], [0, L - (r1 * 0.6 if j == 2 else 0), 0], r0, r1, k=0.01 if j == 0 else 0.004)
        if j == 2:
            fig.ellipsoid('nail', bone, [0, L - r1 * 1.5, -r1 * 0.62], [r1 * 0.8, r1 * 1.25, r1 * 0.42], k=0.0)


# ------------------------------------------------------------------ head

def head(fig: Figure, b: Build, brow=1.0, nose=1.0, jaw=1.0, lips=1.0, cheeks=1.0):
    """Face and skull in the head frame (origin at the top of the neck, y up, z forward).
    Loomis proportions: crown 0.195, brow 0.10, eyes 0.08, nose base 0.035, mouth 0.011, chin -0.035."""
    s = b.s * b.head
    f = b.sex == 'f'
    g = 'skin'
    H = 'head'
    E = lambda c, r, k=0.0, grp=g, op='add': fig.ellipsoid(grp, H, np.array(c) * s, np.array(r) * s, k=k * s, op=op)
    C = lambda a, c, r0, r1, k=0.0, grp=g: fig.cone(grp, H, np.array(a) * s, np.array(c) * s, r0 * s, r1 * s, k=k * s)
    jw = jaw * (0.92 if f else 1.0)
    E([0, 0.095, -0.016], [0.073, 0.1, 0.092])                            # cranium
    E([0, 0.112, 0.028], [0.063, 0.058, 0.058], 0.035)                    # forehead
    E([0, 0.04, 0.032], [0.054 * jw, 0.066, 0.06], 0.035)                 # face mass
    E([0, 0.05, -0.04], [0.06, 0.06, 0.05], 0.03)                         # back of the jaw / under the ears
    for sx in (1, -1):
        C([sx * 0.052 * jw, 0.022, -0.026], [sx * 0.02 * jw, -0.027, 0.066], 0.016 * jw, 0.013, 0.03)  # jaw line
        E([sx * 0.051, 0.071, 0.055], [0.021, 0.014, 0.022], 0.025)       # cheekbones
        E([sx * 0.038, 0.036, 0.062], [0.021 * cheeks, 0.021, 0.02], 0.025)   # cheeks
        E([sx * 0.064, 0.098, 0.03], [0.012, 0.02, 0.02], 0.02, op='sub')  # temples
    E([0, -0.021, 0.073], [0.021 * jw, 0.0155, 0.0165], 0.025)            # chin
    if brow:
        C([-0.04, 0.1, 0.083], [0.04, 0.1, 0.083], 0.0095 * brow, 0.0095 * brow, 0.02)
    E([0, 0.094, 0.09], [0.011, 0.012, 0.009], 0.012)                     # glabella
    for sx in (1, -1):
        E([sx * 0.031, 0.081, 0.091], [0.0195, 0.0128, 0.0142], 0.006, op='sub')   # eye sockets
    # eyes and lids
    for sx in (1, -1):
        c = np.array([sx * 0.031, 0.0795, 0.0775]) * s
        r = 0.0122 * s
        fig.ellipsoid('eye', H, c, [r, r, r])

        def lid(q, c=c, r=r, up=True, sx=sx):
            d = np.linalg.norm(q - c, axis=1) - r * 1.07
            rel = q[:, 1] - c[1] + (q[:, 0] - c[0]) * sx * (0.12 if up else -0.05)
            cut = (r * 0.48 - rel) if up else (rel + r * 0.68)
            return smax(d, cut, 0.0018 * s)
        fig.custom(g, H, lambda q, c=c, r=r, sx=sx: lid(q, c, r, True, sx), c - r * 1.5, c + r * 1.5, k=0.003 * s)
        fig.custom(g, H, lambda q, c=c, r=r, sx=sx: lid(q, c, r, False, sx), c - r * 1.5, c + r * 1.5, k=0.003 * s)
        # upper lid crease / brow fat
        E([sx * 0.031, 0.0935, 0.083], [0.017, 0.006, 0.009], 0.006)
    # nose
    n = nose
    C([0, 0.094, 0.087], [0, 0.046, 0.111 * n], 0.0066, 0.0094, 0.012)
    E([0, 0.04, 0.11 * n], [0.0112, 0.0102, 0.0102], 0.008)
    for sx in (1, -1):
        E([sx * 0.0122, 0.0375, 0.099], [0.0076, 0.0074, 0.0084], 0.006)
        E([sx * 0.0062, 0.0322, 0.1045 * n], [0.0039, 0.0025, 0.0047], 0.002, op='sub')
    # muzzle, lips and mouth
    E([0, 0.013, 0.081], [0.031, 0.028, 0.024], 0.022)
    lp = lips * (1.12 if f else 1.0)
    E([0, 0.0145, 0.0965], [0.0215, 0.0056 * lp, 0.0078], 0.0, grp='lips')
    E([0, 0.004, 0.0942], [0.0188, 0.0068 * lp, 0.0088], 0.0, grp='lips')
    for grp in ('lips', 'skin'):
        E([0, 0.0098, 0.1025], [0.0225, 0.0009, 0.0105], 0.0012, grp=grp, op='sub')
    # ears
    for sx in (1, -1):
        E([sx * 0.074, 0.067, -0.012], [0.011, 0.029, 0.019], 0.006)
        E([sx * 0.0815, 0.064, -0.007], [0.0064, 0.0135, 0.0092], 0.003, op='sub')


# ------------------------------------------------------------------ helpers for garments

def limb(fig, group, bone, t0, t1, r0, r1, k=0.015, frac=True):
    L = fig.sk.bones[bone]['length']
    a = t0 * L if frac else t0
    c = t1 * L if frac else t1
    fig.cone(group, bone, [0, a, 0], [0, c, 0], r0, r1, k=k)


def fold_noise(amp, scale, stretch=(1, 1, 1)):
    st = np.asarray(stretch, float)

    def fn(P):
        return amp * NOISE.fbm(P * st, scale, 3)
    return fn


def head_point(fig, local):
    return fig.sk.point('head', local)


def ellipsoid_d(q, c, r):
    return sd_ellipsoid(q, c, r)
