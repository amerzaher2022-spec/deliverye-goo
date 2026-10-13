"""Signed-distance sculpting with a posable skeleton (numpy only).

Characters are written as primitives (round cones, ellipsoids, rounded boxes, lofts) attached to bones.
A pose moves the bones; the field is then evaluated in each bone's local frame, so any pose is exact
(no skinning). Surfaces are extracted with marching cubes on a narrow band around the zero level set.

Conventions: metres, world y up, the figure faces +z, its left side is +x.
"""
import math

import numpy as np
from scipy import ndimage
from skimage import measure

BIG = 1.0e3


# ------------------------------------------------------------------ math helpers

def rot(axis, deg):
    if isinstance(axis, str):
        axis = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y, z = a
    return np.array([
        [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
        [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
        [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
    ])


def arc(a, b):
    """Smallest rotation taking direction a onto direction b."""
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        if c > 0:
            return np.eye(3)
        p = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        return rot(p, 180)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


def frame(direction, forward=(0, 0, 1)):
    """Rotation whose local +y is `direction` and local +z leans towards `forward`."""
    y = np.asarray(direction, float)
    y = y / np.linalg.norm(y)
    f = np.asarray(forward, float)
    z = f - y * np.dot(f, y)
    if np.linalg.norm(z) < 1e-6:
        z = np.array([0.0, 0.0, 1.0]) - y * y[2]
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ primitives (local coordinates)

def sd_round_cone(q, a, b, ra, rb):
    """Capsule from a to b with radii ra, rb (exact for a cone-capsule)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = q - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - np.outer(y, ba)
    x2 = np.einsum('ij,ij->i', xv, xv)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    out = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
    m1 = np.sign(z) * a2 * z2 > k
    m2 = np.sign(y) * a2 * y2 < k
    out = np.where(m1, np.sqrt(np.maximum(x2 + z2, 0)) * il2 - rb, out)
    out = np.where(m2 & ~m1, np.sqrt(np.maximum(x2 + y2, 0)) * il2 - ra, out)
    return out


def sd_ellipsoid(q, c, r):
    p = (q - np.asarray(c, float)) / np.asarray(r, float)
    k0 = np.linalg.norm(p, axis=1)
    k1 = np.linalg.norm(p / np.asarray(r, float), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_box(q, c, h, r=0.0):
    p = np.abs(q - np.asarray(c, float)) - (np.asarray(h, float) - r)
    return np.linalg.norm(np.maximum(p, 0), axis=1) + np.minimum(p.max(1), 0) - r


def sd_loft(q, ys, half_x, half_z, cz, cx=None, cap=0.02):
    """Stack of ellipses along local y (torsos, garments). Approximate distance."""
    y = q[:, 1]
    a = np.interp(y, ys, half_x)
    b = np.interp(y, ys, half_z)
    c = np.interp(y, ys, cz)
    ox = np.interp(y, ys, cx) if cx is not None else 0.0
    e = np.sqrt(((q[:, 0] - ox) / a) ** 2 + ((q[:, 2] - c) / b) ** 2)
    d = (e - 1.0) * np.minimum(a, b)
    d = smax(d, ys[0] - y, cap)
    return smax(d, y - ys[-1], cap)


# ------------------------------------------------------------------ noise

class Noise:
    """Smooth 3D value noise (vectorised), for fabric folds, hair strands and skin variation."""

    def __init__(self, seed=1):
        rng = np.random.default_rng(seed)
        self.table = rng.random((64, 64, 64)).astype(np.float32)

    def __call__(self, p, scale=1.0):
        q = p * scale
        i = np.floor(q).astype(np.int64)
        f = q - i
        f = f * f * (3 - 2 * f)
        t = self.table
        out = 0.0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                    out = out + w * t[(i[:, 0] + dx) % 64, (i[:, 1] + dy) % 64, (i[:, 2] + dz) % 64]
        return out * 2 - 1

    def fbm(self, p, scale, octaves=3):
        s, amp, total, norm = scale, 1.0, 0.0, 0.0
        for _ in range(octaves):
            total = total + amp * self(p, s)
            norm += amp
            s *= 2.03
            amp *= 0.5
        return total / norm


NOISE = Noise(7)


# ------------------------------------------------------------------ skeleton

class Skeleton:
    """Bones with rest transforms; a pose adds local rotations. Every bone points along its local +y."""

    def __init__(self):
        self.bones = {}   # name -> dict(parent, head (rest world), R0 (rest world rotation), length)
        self.order = []
        self.pose = {}    # name -> 3x3 local rotation
        self.offset = np.zeros(3)   # moves the whole figure
        self._world = None

    def add(self, name, parent, head, tail, forward=(0, 0, 1)):
        head, tail = np.asarray(head, float), np.asarray(tail, float)
        d = tail - head
        self.bones[name] = dict(parent=parent, head=head, R0=frame(d, forward), length=float(np.linalg.norm(d)))
        self.order.append(name)
        self._world = None

    def rotate(self, name, axis, deg, space='local'):
        """Add a rotation to a bone. space='local' uses the bone's own axes; 'world' uses world axes
        expressed in the bone's current posed orientation."""
        R = rot(axis, deg)
        if space == 'world':
            Rw = self.world(name)[:3, :3]
            R = Rw.T @ R @ Rw
        self.pose[name] = self.pose.get(name, np.eye(3)) @ R
        self._world = None

    def move(self, delta):
        self.offset = self.offset + np.asarray(delta, float)
        self._world = None

    def set_world_rotation(self, name, Rworld):
        """Apply an extra rotation given in world space about the bone head."""
        Rw = self.world(name)[:3, :3]
        self.pose[name] = self.pose.get(name, np.eye(3)) @ (Rw.T @ Rworld @ Rw)
        self._world = None

    def world(self, name):
        if self._world is None:
            self._world = {}
            for n in self.order:
                b = self.bones[n]
                Rl = self.pose.get(n, np.eye(3))
                if b['parent'] is None:
                    M = np.eye(4)
                    M[:3, :3] = b['R0'] @ Rl
                    M[:3, 3] = b['head'] + self.offset
                else:
                    P = self._world[b['parent']]
                    pb = self.bones[b['parent']]
                    # rest offset of this head in the parent's rest frame
                    off = pb['R0'].T @ (b['head'] - pb['head'])
                    Rrel = pb['R0'].T @ b['R0']
                    M = np.eye(4)
                    M[:3, :3] = P[:3, :3] @ Rrel @ Rl
                    M[:3, 3] = P[:3, :3] @ off + P[:3, 3]
                self._world[n] = M
        return self._world[name]

    def head(self, name):
        return self.world(name)[:3, 3].copy()

    def tail(self, name):
        M = self.world(name)
        return M[:3, :3] @ np.array([0, self.bones[name]['length'], 0]) + M[:3, 3]

    def point(self, name, local):
        M = self.world(name)
        return M[:3, :3] @ np.asarray(local, float) + M[:3, 3]

    def ik(self, upper, lower, end, target, pole):
        """Two-bone IK: rotate `upper` and `lower` so the head of `end` reaches `target`."""
        target = np.asarray(target, float)
        S, E, W = self.head(upper), self.head(lower), self.head(end)
        l1, l2 = np.linalg.norm(E - S), np.linalg.norm(W - E)
        d = np.clip(np.linalg.norm(target - S), abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
        dirn = (target - S) / np.linalg.norm(target - S)
        a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        h = math.sqrt(max(0.0, l1 * l1 - a * a))
        p = np.asarray(pole, float) - dirn * np.dot(pole, dirn)
        p /= np.linalg.norm(p)
        Es = S + dirn * a + p * h
        self.set_world_rotation(upper, arc(E - S, Es - S))
        E2, W2 = self.head(lower), self.head(end)
        self.set_world_rotation(lower, arc(W2 - E2, S + dirn * d - E2))

    def aim(self, name, direction, roll_axis=None, roll_target=None):
        """Point a bone along a world direction; optionally roll it so its local `roll_axis` faces `roll_target`."""
        y = self.world(name)[:3, 1]
        self.set_world_rotation(name, arc(y, direction))
        if roll_axis is not None:
            M = self.world(name)[:3, :3]
            ax = M @ np.asarray(roll_axis, float)
            yy = M[:, 1]
            want = np.asarray(roll_target, float)
            ax = ax - yy * np.dot(ax, yy)
            want = want - yy * np.dot(want, yy)
            if np.linalg.norm(ax) > 1e-6 and np.linalg.norm(want) > 1e-6:
                ang = math.degrees(math.atan2(np.dot(np.cross(ax, want), yy), np.dot(ax, want)))
                self.set_world_rotation(name, rot(yy, ang))


# ------------------------------------------------------------------ figure: parts grouped by material

class Part:
    def __init__(self, group, bone, kind, args, op='add', k=0.0, clip=None):
        self.group, self.bone, self.kind, self.args, self.op, self.k = group, bone, kind, args, op, k
        self.clip = clip or []   # [(normal, offset, k)]: keep q·normal <= offset (local frame)

    def inflated(self, group, d, clip=None, k=None):
        a = self.args
        if self.kind == 'cone':
            args = (a[0], a[1], a[2] + d, a[3] + d)
        elif self.kind == 'ellipsoid':
            args = (a[0], np.asarray(a[1]) + d)
        elif self.kind == 'box':
            args = (a[0], np.asarray(a[1]) + d, a[2] + d)
        elif self.kind == 'loft':
            args = (a[0], np.asarray(a[1]) + d, np.asarray(a[2]) + d) + tuple(a[3:])
        else:
            raise ValueError(self.kind)
        return Part(group, self.bone, self.kind, args, 'add', self.k if k is None else k, clip)

    def local_bounds(self):
        a = self.args
        if self.kind == 'cone':
            p0, p1, r0, r1 = a
            lo = np.minimum(p0, p1) - max(r0, r1)
            hi = np.maximum(p0, p1) + max(r0, r1)
        elif self.kind == 'ellipsoid':
            c, r = a
            lo, hi = np.asarray(c) - r, np.asarray(c) + r
        elif self.kind == 'box':
            c, h, _ = a
            lo, hi = np.asarray(c) - h, np.asarray(c) + h
        elif self.kind == 'loft':
            ys, hx, hz, cz = a[:4]
            cx = a[4] if len(a) > 4 and a[4] is not None else [0.0]
            m = max(max(hx), max(hz)) + max(abs(np.min(cz)), abs(np.max(cz))) + max(abs(np.min(cx)), abs(np.max(cx)))
            lo = np.array([-m, ys[0], -m])
            hi = np.array([m, ys[-1], m])
        elif self.kind == 'fn':
            lo, hi = np.asarray(a[1][0]), np.asarray(a[1][1])
        return np.asarray(lo, float), np.asarray(hi, float)

    def sdf(self, q):
        a = self.args
        if self.kind == 'cone':
            return sd_round_cone(q, a[0], a[1], a[2], a[3])
        if self.kind == 'ellipsoid':
            return sd_ellipsoid(q, a[0], a[1])
        if self.kind == 'box':
            return sd_box(q, a[0], a[1], a[2])
        if self.kind == 'loft':
            return sd_loft(q, *a)
        if self.kind == 'fn':
            return a[0](q)
        raise ValueError(self.kind)


class Figure:
    """A skeleton plus parts; evaluates one distance per material group."""

    def __init__(self, skeleton):
        self.sk = skeleton
        self.parts = []
        self.groups = []
        self.displace = {}   # group -> fn(world points) -> displacement (positive = outward)

    def add(self, group, bone, kind, *args, op='add', k=0.0):
        if group not in self.groups:
            self.groups.append(group)
        self.parts.append(Part(group, bone, kind, args, op, k))

    def cone(self, group, bone, p0, p1, r0, r1, k=0.0, op='add'):
        self.add(group, bone, 'cone', np.asarray(p0, float), np.asarray(p1, float), r0, r1, op=op, k=k)

    def ellipsoid(self, group, bone, c, r, k=0.0, op='add'):
        self.add(group, bone, 'ellipsoid', np.asarray(c, float), np.asarray(r, float), op=op, k=k)

    def box(self, group, bone, c, h, r=0.0, k=0.0, op='add'):
        self.add(group, bone, 'box', np.asarray(c, float), np.asarray(h, float), r, op=op, k=k)

    def loft(self, group, bone, ys, hx, hz, cz, cx=None, k=0.0, op='add'):
        self.add(group, bone, 'loft', np.asarray(ys, float), np.asarray(hx, float), np.asarray(hz, float),
                 np.asarray(cz, float), None if cx is None else np.asarray(cx, float), op=op, k=k)

    def custom(self, group, bone, fn, lo, hi, k=0.0, op='add'):
        self.add(group, bone, 'fn', fn, (lo, hi), op=op, k=k)

    def clone(self, src, dst, bones, inflate, clip=None, k=None, skip=None):
        """Copy the 'add' parts of group `src` on `bones` into group `dst`, inflated (garments).
        clip: {bone: [(normal, offset, k)]} per-bone cut planes in the bone's frame."""
        if dst not in self.groups:
            self.groups.append(dst)
        clip = clip or {}
        for p in list(self.parts):
            if p.group != src or p.op != 'add' or p.bone not in bones or p.kind == 'fn':
                continue
            if skip and skip(p):
                continue
            self.parts.append(p.inflated(dst, inflate, clip.get(p.bone), k))

    def evaluate(self, P):
        """P (n,3) world points → dict group -> distance."""
        n = len(P)
        out = {g: np.full(n, BIG, np.float64) for g in self.groups}
        for part in self.parts:
            M = self.sk.world(part.bone)
            R, t = M[:3, :3], M[:3, 3]
            lo, hi = part.local_bounds()
            corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
            wc = corners @ R.T + t
            pad = part.k * 2 + 0.004
            wlo, whi = wc.min(0) - pad, wc.max(0) + pad
            sel = np.all((P >= wlo) & (P <= whi), axis=1)
            if not sel.any():
                continue
            q = (P[sel] - t) @ R
            d = part.sdf(q)
            for cl in part.clip:
                if len(cl) == 4:   # plane in another bone's frame
                    cb, nrm, off, kc = cl
                    Mc = self.sk.world(cb)
                    qc = (P[sel] - Mc[:3, 3]) @ Mc[:3, :3]
                    d = smax(d, qc @ np.asarray(nrm, float) - off, kc)
                else:
                    nrm, off, kc = cl
                    d = smax(d, q @ np.asarray(nrm, float) - off, kc)
            cur = out[part.group][sel]
            if part.op == 'add':
                cur = smin(cur, d, part.k)
            elif part.op == 'sub':
                cur = smax(cur, -d, part.k)
            elif part.op == 'inter':
                cur = smax(cur, d, part.k)
            out[part.group][sel] = cur
        for g, fn in self.displace.items():
            near = out[g] < 0.02
            if near.any():
                out[g][near] -= fn(P[near])
        return out

    def field(self, P):
        out = self.evaluate(P)
        return np.min(np.stack([out[g] for g in self.groups]), axis=0)

    def classify(self, P):
        out = self.evaluate(P)
        return np.argmin(np.stack([out[g] for g in self.groups]), axis=0)


def mesh(fn, lo, hi, step, coarse=0.012, band=None):
    """Marching cubes over [lo, hi] at `step`, evaluating `fn` exactly only near the surface."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    band = band or max(coarse * 1.8, step * 4)
    cs = [np.arange(lo[i], hi[i] + coarse, coarse) for i in range(3)]
    CX, CY, CZ = np.meshgrid(*cs, indexing='ij')
    cd = fn(np.stack([CX.ravel(), CY.ravel(), CZ.ravel()], 1)).reshape(CX.shape)
    fs = [np.arange(lo[i], hi[i] + step, step) for i in range(3)]
    shape = tuple(len(f) for f in fs)
    zoom = [shape[i] / cd.shape[i] for i in range(3)]
    fine = ndimage.zoom(cd.astype(np.float32), zoom, order=1)
    fine = fine[:shape[0], :shape[1], :shape[2]]
    if fine.shape != shape:
        pad = [(0, shape[i] - fine.shape[i]) for i in range(3)]
        fine = np.pad(fine, pad, mode='edge')
    idx = np.nonzero(np.abs(fine) < band)
    if len(idx[0]):
        pts = np.stack([fs[0][idx[0]], fs[1][idx[1]], fs[2][idx[2]]], 1)
        CH = 2_000_000
        vals = np.concatenate([fn(pts[i:i + CH]) for i in range(0, len(pts), CH)])
        fine[idx] = vals.astype(np.float32)
    verts, faces, normals, _ = measure.marching_cubes(fine, 0.0, spacing=(step, step, step))
    return verts + lo, faces, normals
