"""MakeHuman data → posed, clothed meshes (numpy only).

Reads the open MakeHuman data set shipped in the `makehuman-data-v1` npm
package (base mesh, morph targets, skins and proxies such as clothes and
hair). Nothing from that package is committed to this repository: the
generated models are exported to `web/public/models/` by `build_models.py`.
"""
import json
import math
import os
from functools import lru_cache

import numpy as np

DATA = os.environ.get('MH_DATA', '')


def _p(*parts):
    return os.path.join(DATA, *parts)


def decode_faces(faces, n_uv_layers=1):
    """Three.js JSON v3 face array → (quads/tris vertex idx, material, uv idx)."""
    out_v, out_m, out_uv = [], [], []
    i, f = 0, faces
    while i < len(f):
        t = f[i]
        i += 1
        nv = 4 if t & 1 else 3
        vs = f[i:i + nv]
        i += nv
        mat = 0
        if t & 2:
            mat = f[i]
            i += 1
        if t & 4:
            i += n_uv_layers
        uvs = None
        if t & 8:
            uvs = f[i:i + nv]
            i += nv * n_uv_layers
        if t & 16:
            i += 1
        if t & 32:
            i += nv
        if t & 64:
            i += 1
        if t & 128:
            i += nv
        if nv == 3:  # store triangles as degenerate quads
            vs = list(vs) + [-1]
            uvs = list(uvs) + [-1] if uvs is not None else None
        out_v.append(vs)
        out_m.append(mat)
        out_uv.append(uvs if uvs is not None else [-1, -1, -1, -1])
    return np.array(out_v), np.array(out_m), np.array(out_uv)


def rot(axis, deg):
    """Rotation matrix about a world axis ('x', 'y', 'z' or a 3-vector)."""
    if isinstance(axis, str):
        axis = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    a = axis
    a = np.asarray(a, float)
    a = a / np.linalg.norm(a)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y, z = a
    return np.array([
        [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
        [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
        [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
    ])


class Base:
    def __init__(self):
        m = json.load(open(_p('models', 'human_full_size.json')))
        self.v0 = np.array(m['vertices'], np.float64).reshape(-1, 3)
        self.uvs = np.array(m['uvs'][0], np.float64).reshape(-1, 2)
        self.fv, self.fm, self.fuv = decode_faces(m['faces'])
        self.mat_names = [x['DbgName'] for x in m['materials']]
        self.skin_idx = np.array(m['skinIndices']).reshape(-1, 4)
        self.skin_w = np.array(m['skinWeights'], np.float64).reshape(-1, 4)
        bones = m['bones']
        self.bone_names = [b['name'] for b in bones]
        self.bone_parent = [b['parent'] for b in bones]
        self.joints = m['metadata']['joint_pos_idxs']
        tl = json.load(open(os.path.join(DATA, '..', '..', 'src', 'json', 'targets', 'target-list.json')))
        paths = sorted(k.lower() for k in tl['targets'].keys())
        self.target_index = {p.replace('data/targets/', '').replace('.target', ''): i for i, p in enumerate(paths)}
        n = len(self.v0)
        self.targets = np.memmap(_p('targets', 'targets.bin'), dtype=np.int16, mode='r').reshape(len(paths), n * 3)
        assert int(self.targets[3].astype(np.int64).sum()) == 2952, 'target ordering mismatch'


@lru_cache(maxsize=1)
def base():
    return Base()


def macro_weights(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                  race=(1 / 3, 1 / 3, 1 / 3)):
    """MakeHuman macro modifier factors → {target: weight}."""
    g = {'female': 1 - gender, 'male': gender}
    if age < 0.5:
        young = max(0.0, (age - 0.1875) * 3.2)
        a = {'baby': max(0.0, 1 - age * 5.333), 'young': young,
             'child': max(0.0, min(1.0, 5.333 * age) - young), 'old': 0.0}
    else:
        old = max(0.0, age * 2 - 1)
        a = {'baby': 0.0, 'child': 0.0, 'old': old, 'young': 1 - old}

    def tri(v, lo, mid, hi):
        mx, mn = max(0.0, v * 2 - 1), max(0.0, 1 - v * 2)
        return {hi: mx, lo: mn, mid: 1 - mx - mn}

    mu = tri(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle')
    we = tri(weight, 'minweight', 'averageweight', 'maxweight')
    he = {'maxheight': max(0.0, height * 2 - 1), 'minheight': max(0.0, 1 - height * 2)}
    pr = {'idealproportions': max(0.0, proportions * 2 - 1), 'uncommonproportions': max(0.0, 1 - proportions * 2)}
    rc = {'african': race[0], 'asian': race[1], 'caucasian': race[2]}
    out = {}
    for gk, gv in g.items():
        for ak, av in a.items():
            for rk, rv in rc.items():
                out[f'macrodetails/{rk}-{gk}-{ak}'] = gv * av * rv
            for mk, mv in mu.items():
                for wk, wv in we.items():
                    w = gv * av * mv * wv
                    out[f'macrodetails/universal-{gk}-{ak}-{mk}-{wk}'] = w
                    for hk, hv in he.items():
                        out[f'macrodetails/height/{gk}-{ak}-{mk}-{wk}-{hk}'] = w * hv
                    for pk, pv in pr.items():
                        out[f'macrodetails/proportions/{gk}-{ak}-{mk}-{wk}-{pk}'] = w * pv
    return {k: v for k, v in out.items() if v > 1e-6}


def morph(weights):
    b = base()
    d = np.zeros(b.v0.size, np.float64)
    for name, w in weights.items():
        idx = b.target_index.get(name)
        if idx is None:
            continue
        d += b.targets[idx].astype(np.float64) * w
    return b.v0 + d.reshape(-1, 3) * 1e-3


def joints(v):
    b = base()
    out = {}
    for name, idx in b.joints.items():
        bone, end = name.split('____')
        out.setdefault(bone, {})[end] = v[idx].mean(0)
    return out


def bone_matrices(v, pose):
    """pose: {bone: [(axis, degrees), ...]} rotations about the bone head, in the rest frame.
    Returns one 4x4 matrix per entry of the three.js bone list."""
    b = base()
    j = joints(v)
    mats = [None] * len(b.bone_names)
    for i, name in enumerate(b.bone_names):
        p = b.bone_parent[i]
        parent = mats[p] if p >= 0 else np.eye(4)
        if not name.endswith('____head'):
            mats[i] = parent
            continue
        bone = name[:-len('____head')]
        R = np.eye(3)
        for item in pose.get(bone, []):
            R = (item if isinstance(item, np.ndarray) else rot(*item)) @ R
        h = j[bone]['head']
        local = np.eye(4)
        local[:3, :3] = R
        local[:3, 3] = h - R @ h
        mats[i] = parent @ local
    return np.array(mats)


def skin(v, idx, w, mats):
    vh = np.c_[v, np.ones(len(v))]
    out = np.zeros_like(v)
    for k in range(idx.shape[1]):
        m = mats[idx[:, k]]  # (n,4,4)
        out += w[:, k:k + 1] * np.einsum('nij,nj->ni', m, vh)[:, :3]
    return out


@lru_cache(maxsize=64)
def load_proxy(rel):
    """rel like 'clothes/male_casualsuit06'."""
    folder = _p('proxies', rel)
    js = [f for f in os.listdir(folder) if f.endswith('.json')][0]
    p = json.load(open(os.path.join(folder, js)))
    fv, fm, fuv = decode_faces(p['faces'])
    md = p['metadata']
    dv = md.get('deleteVerts')
    if isinstance(dv, str):
        dv = json.loads(dv)
    return {
        'folder': folder,
        'ref': np.array(p['ref_vIdxs']),
        'w': np.array(p['weights'], np.float64),
        'off': np.array(p['offsets'], np.float64),
        'uvs': np.array(p['uvs'][0], np.float64).reshape(-1, 2),
        'fv': fv, 'fuv': fuv,
        'skin_idx': np.array(p['skinIndices']).reshape(-1, p.get('influencesPerVertex', 4)),
        'skin_w': np.array(p['skinWeights'], np.float64).reshape(-1, p.get('influencesPerVertex', 4)),
        'materials': p['materials'],
        'delete': np.array(dv, bool) if dv else None,
        'z_depth': md.get('z_depth', 0),
        'license': md.get('license', {}),
        'name': md.get('name', rel),
    }


def fit_proxy(px, v_rest):
    return (px['w'][:, :, None] * v_rest[px['ref']]).sum(1) + px['off']


def _arc(a, b):
    """Smallest rotation taking direction a onto direction b."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


def _xf(m, p):
    return m[:3, :3] @ p + m[:3, 3]


def solve(v, pose, iks=()):
    """Add two-bone IK rotations to `pose`.
    iks: [{'chain': (upper, lower, end), 'target': xyz, 'pole': xyz}] in MakeHuman space."""
    b = base()
    idx = {n: i for i, n in enumerate(b.bone_names)}
    j = joints(v)
    pose = {k: list(r) for k, r in pose.items()}

    def parent_rot(mats, bone):
        return mats[b.bone_parent[idx[bone + '____head']]][:3, :3]

    for ik in iks:
        up, lo, end = ik['chain']
        T = np.asarray(ik['target'], float)
        mats = bone_matrices(v, pose)
        S = _xf(mats[idx[up + '____head']], j[up]['head'])
        E = _xf(mats[idx[up + '____head']], j[lo]['head'])
        W = _xf(mats[idx[lo + '____head']], j[end]['head'])
        l1, l2 = np.linalg.norm(E - S), np.linalg.norm(W - E)
        d = np.clip(np.linalg.norm(T - S), abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
        dirn = (T - S) / np.linalg.norm(T - S)
        a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        h = math.sqrt(max(0.0, l1 * l1 - a * a))
        pole = np.asarray(ik['pole'], float)
        pole = pole - dirn * np.dot(pole, dirn)
        pole /= np.linalg.norm(pole)
        Es = S + dirn * a + pole * h
        P = parent_rot(mats, up)
        pose.setdefault(up, []).append(P.T @ _arc(E - S, Es - S) @ P)
        mats = bone_matrices(v, pose)
        E2 = _xf(mats[idx[lo + '____head']], j[lo]['head'])
        W2 = _xf(mats[idx[lo + '____head']], j[end]['head'])
        P = parent_rot(mats, lo)
        Tn = S + dirn * d
        pose.setdefault(lo, []).append(P.T @ _arc(W2 - E2, Tn - E2) @ P)
    return pose


def world_rot(v, pose, bone, R):
    """Rotation R given in the posed world frame → entry for pose[bone]."""
    b = base()
    idx = {n: i for i, n in enumerate(b.bone_names)}
    mats = bone_matrices(v, pose)
    P = mats[b.bone_parent[idx[bone + '____head']]][:3, :3]
    return P.T @ R @ P


def curl(v, side, angle, thumb=None, fingers=(2, 3, 4, 5), spread=0.0):
    """Finger curl rotations (rest frame) for one hand; positive closes the hand."""
    j = joints(v)
    s = side
    knuckles = j[f'finger5-1.{s}']['head'] - j[f'finger2-1.{s}']['head']
    axis = knuckles / np.linalg.norm(knuckles)
    if s == 'R':
        axis = -axis
    out = {}
    for f in fingers:
        for k, w in ((1, 0.8), (2, 1.0), (3, 0.75)):
            out[f'finger{f}-{k}.{s}'] = [(axis, angle * w)]
    if thumb is not None:
        d = j[f'finger1-2.{s}']['head'] - j[f'finger1-1.{s}']['head']
        palm = np.cross(knuckles, j[f'finger3-1.{s}']['head'] - j[f'wrist.{s}']['head'])
        ax = np.cross(d, palm)
        ax /= np.linalg.norm(ax)
        if s == 'R':
            ax = -ax
        for k, w in ((2, 0.6), (3, 1.0)):
            out[f'finger1-{k}.{s}'] = [(ax, thumb * w)]
    return out
