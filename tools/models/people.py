"""Build the game's people from the MakeHuman data set (run inside Blender's Python, see build_models.py).

Each character is morphed (gender, age, build), dressed with fitted clothes and hair, posed with
forward kinematics plus two-bone IK, and baked to a static mesh in the vehicle/ground frame used by
the game: metres, y up, facing +z (Blender: z up, facing -y; the glTF exporter converts).
"""
import math
import os

import bpy
import mathutils
import numpy as np

import blendkit as bk
import mh
import texops as tx

CACHE = os.environ.get('MODEL_CACHE', '/tmp/model-cache')

# MakeHuman → Blender: 0.1 scale (decimetres to metres) and (x, y, z) → (x, -z, y)
C = np.array([[0.1, 0, 0, 0], [0, 0, -0.1, 0], [0, 0.1, 0, 0], [0, 0, 0, 1]])
C_INV = np.linalg.inv(C)


def P(*a):
    return os.path.join(mh.DATA, *a)


def game_to_mh(p, offset):
    """Game frame (metres, y up, +z forward) → MakeHuman space, given the game position of MakeHuman's origin."""
    return (np.asarray(p, float) - offset) * 10.0


# ---------------------------------------------------------------- textures

def cached(key, make, jpeg=True, size=512):
    path = os.path.join(CACHE, 'tex', key + ('.jpg' if jpeg else '.png'))
    if not os.path.exists(path):
        tx.save(make(), path, jpeg, size)
    return path


def skin_tex(kind):
    def make():
        if kind == 'm':
            a = tx.load(P('skins/young_caucasian_male/textures/young_lightskinned_male_diffuse.png'))
            b = tx.load(P('skins/young_african_male/textures/young_darkskinned_male_diffuse.png'))
            return tx.warm(tx.blend(a, b, 0.22), 0.04)
        if kind == 'm2':
            a = tx.load(P('skins/young_caucasian_male/textures/young_lightskinned_male_diffuse2.png'))
            b = tx.load(P('skins/young_african_male/textures/young_darkskinned_male_diffuse.png'))
            return tx.warm(tx.blend(a, b, 0.32), 0.05)
        if kind == 'f':
            a = tx.load(P('skins/young_caucasian_female/textures/young_lightskinned_female_diffuse.png'))
            b = tx.load(P('skins/young_african_female/textures/young_darkskinned_female_diffuse.png'))
            return tx.warm(tx.blend(a, b, 0.1), 0.02)
        if kind == 'f2':
            a = tx.load(P('skins/young_caucasian_female/textures/young_lightskinned_female_diffuse2.png'))
            b = tx.load(P('skins/young_african_female/textures/young_darkskinned_female_diffuse.png'))
            return tx.warm(tx.blend(a, b, 0.25), 0.04)
        if kind == 'old':
            a = tx.load(P('skins/middleage_caucasian_male/textures/middleage_lightskinned_male_diffuse.png'))
            b = tx.load(P('skins/middleage_african_male/textures/middleage_darkskinned_male_diffuse.png'))
            return tx.warm(tx.blend(a, b, 0.3), 0.05)
        raise KeyError(kind)
    return cached('skin_' + kind, make)


def cloth_tex(rel, key, edit=None, alpha=False):
    folder = P('proxies', rel, 'textures')
    px = mh.load_proxy(rel)
    src = os.path.join(P('proxies', rel), px['materials'][0]['mapDiffuse'])

    def make():
        im = tx.load(src)
        return edit(im) if edit else im
    return cached(key, make, jpeg=not alpha)


# Texture edits: regions are (x0, y0, x1, y1) as fractions of the image, origin top-left.

def edit_white_tee(im):
    top = tx.rect_mask(im, [(0, 0, 1, 0.47)])
    mark = top & ((tx.sat(im) > 0.18) | (tx.lum(im) < 0.62))
    im = tx.inpaint(im, mark)
    im = tx.inpaint(im, tx.rect_mask(im, [(0.78, 0.93, 1, 1), (0.0, 0.93, 0.25, 1)]) & (tx.lum(im) < 0.6))
    return tx.inpaint(im, tx.rect_mask(im, [(0, 0.47, 1, 1)]) & (tx.lum(im) > 0.72) & (tx.sat(im) < 0.25))


def edit_jeans(rgb=None, ref=0.4):
    def edit(im):
        im = tx.inpaint(im, (tx.lum(im) > 0.42) & (tx.sat(im) < 0.3))
        if rgb:
            im = tx.recolor(im, im[:, :, 3] > -1, rgb, ref=ref)
        return im
    return edit


SUIT_TOP = [(0, 0, 1, 0.41), (0.72, 0.55, 1, 0.88)]
SUIT_BOTTOM = [(0, 0.41, 0.72, 1)]


def edit_staff_shirt(im):
    shirt = tx.rect_mask(im, SUIT_TOP)
    logo = tx.rect_mask(im, [(0.58, 0.08, 0.9, 0.4)]) & ((tx.sat(im) < 0.45) | (im[:, :, 2] > im[:, :, 0]))
    im = tx.inpaint(im, logo)
    im = tx.recolor(im, shirt, (0.36, 0.55, 0.86), ref=0.36)
    pants = tx.rect_mask(im, SUIT_BOTTOM)
    return tx.recolor(im, pants, (0.36, 0.26, 0.17), ref=0.42)


def edit_pink_top(im):
    shirt = tx.rect_mask(im, SUIT_TOP)
    logo = tx.rect_mask(im, [(0.58, 0.08, 0.9, 0.4)]) & ((tx.sat(im) < 0.45) | (im[:, :, 2] > im[:, :, 0]))
    im = tx.inpaint(im, logo)
    im = tx.inpaint(im, tx.rect_mask(im, [(0.88, 0.38, 0.97, 0.47)]))
    im = tx.recolor(im, shirt, (0.86, 0.45, 0.6), ref=0.36)
    pants = tx.rect_mask(im, SUIT_BOTTOM)
    return tx.recolor(im, pants, (0.17, 0.2, 0.28), ref=0.42)


def edit_grey_jacket(im):
    jacket = tx.rect_mask(im, [(0.45, 0, 1, 0.5), (0.0, 0.0, 0.45, 0.42), (0.6, 0.5, 1, 1)])
    jacket &= tx.sat(im) < 0.5
    return tx.recolor(im, jacket, (0.42, 0.43, 0.45), ref=0.3)


def edit_grey_tank(im):
    body = tx.lum(im) < 0.25
    return tx.recolor(im, body, (0.55, 0.56, 0.57), ref=0.12)


def edit_hivis(im):
    # The vest texture is red with flame decals: flatten to fluorescent yellow with two reflective bands.
    h, w = im.shape[:2]
    out = im.copy()
    L = tx.lum(im)
    out[:, :, :3] = np.array([0.08, 0.86, 0.94], np.float32)[None, None, :] * np.clip(0.75 + L * 0.5, 0, 1.1)[:, :, None]
    for y0 in (0.55, 0.75):
        out[int(y0 * h):int((y0 + 0.05) * h), :, :3] = 0.8
    return out


def hair_tex(rel, key, rgb, gain=1.0):
    px = mh.load_proxy(rel)
    src = os.path.join(P('proxies', rel), px['materials'][0]['mapDiffuse'])
    return cached(key, lambda: tx.hair(tx.load(src), rgb, gain), jpeg=False)


# ---------------------------------------------------------------- characters

class Person:
    """Morphed, dressed and posed MakeHuman figure."""

    def __init__(self, spec):
        self.spec = spec
        b = mh.base()
        weights = mh.macro_weights(**spec['macro'])
        weights.update(spec.get('extra', {}))
        self.v = mh.morph(weights)
        self.j = mh.joints(self.v)
        self.pose = {}
        self.offset = np.zeros(3)  # game-frame position of the MakeHuman origin

    # --- posing helpers
    def jp(self, bone, end='head'):
        return self.j[bone][end]

    def posed(self, bone, end='head'):
        b = mh.base()
        i = b.bone_names.index(bone + '____head')
        m = mh.bone_matrices(self.v, self.pose)[i]
        return m[:3, :3] @ self.j[bone][end] + m[:3, 3]

    def add(self, bone, *items):
        self.pose.setdefault(bone, []).extend(items)

    def world(self, bone, R):
        self.add(bone, mh.world_rot(self.v, self.pose, bone, R))

    def ik(self, chain, target_game, pole):
        self.pose = mh.solve(self.v, self.pose, [{'chain': chain, 'target': game_to_mh(target_game, self.offset), 'pole': pole}])

    def aim(self, bone, child, direction, up_child=None, up=None):
        """Rotate `bone` (world frame) so head→child points along `direction`; optionally roll so that
        head→up_child leans toward `up`."""
        h = self.posed(bone)
        c = self.posed(child)
        R = mh._arc(c - h, np.asarray(direction, float))
        self.world(bone, R)
        if up_child is not None:
            h = self.posed(bone)
            d = self.posed(child) - h
            d /= np.linalg.norm(d)
            u = self.posed(up_child) - h
            u -= d * np.dot(u, d)
            want = np.asarray(up, float) - d * np.dot(up, d)
            if np.linalg.norm(u) > 1e-6 and np.linalg.norm(want) > 1e-6:
                ang = math.degrees(math.atan2(np.dot(np.cross(u, want), d), np.dot(u, want) / 1.0))
                self.world(bone, mh.rot(d, ang))

    def matrices(self):
        return mh.bone_matrices(self.v, self.pose)

    def head_matrix(self):
        return self.bone_matrix('head')

    def bone_matrix(self, bone):
        b = mh.base()
        return self.matrices()[b.bone_names.index(bone + '____head')]


HEAD_BONES = ('head', 'neck', 'jaw', 'eye', 'levator', 'oris', 'oculi', 'orbicularis', 'temporalis',
              'risorius', 'tongue', 'special')


def _dominant(skin_idx, skin_w):
    b = mh.base()
    k = np.argmax(skin_w, 1)
    return skin_idx[np.arange(len(k)), k]


def _is_head_bone(i):
    name = mh.base().bone_names[i].replace('____head', '')
    return name.startswith(HEAD_BONES) and not name.startswith('neck01')


def build_parts(person, wear):
    """wear: list of dicts {proxy, tex, alpha, mat, head, rough, normal}. Returns mesh parts in MakeHuman space."""
    b = mh.base()
    mats = person.matrices()
    v_pose = mh.skin(person.v, b.skin_idx, b.skin_w, mats)
    deleted = np.zeros(len(person.v), bool)
    parts = []
    for item in wear:
        px = mh.load_proxy(item['proxy'])
        pv = mh.fit_proxy(px, person.v)
        pv = mh.skin(pv, px['skin_idx'], px['skin_w'], mats)
        if px['delete'] is not None and item.get('mask', True):
            deleted |= px['delete']
        head = item.get('head', False)
        parts.append(dict(name=item['mat'], v=pv, fv=px['fv'], fuv=px['fuv'], uvs=px['uvs'], tex=item['tex'],
                          alpha=item.get('alpha', False), head=head, rough=item.get('rough', 0.8),
                          proxy=item['proxy'], license=px['license'], author=px['license'].get('author'),
                          decimate=item.get('decimate', 0.45), inflate=item.get('inflate', 0)))
    body = b.fm == 0
    fv, fuv = b.fv[body], b.fuv[body]
    valid = fv >= 0
    masked = (deleted[np.where(valid, fv, 0)] & valid).sum(1)
    nverts = valid.sum(1)
    keep = masked < np.where(nverts == 4, 3, 2)
    fv, fuv = fv[keep], fuv[keep]
    dom = _dominant(b.skin_idx, b.skin_w)
    head_vert = np.array([_is_head_bone(i) for i in range(len(b.bone_names))])[dom]
    face_head = head_vert[np.where(fv >= 0, fv, fv[:, :1])].mean(1) > 0.5
    for flag, sel in ((False, ~face_head), (True, face_head)):
        if sel.any():
            parts.append(dict(name='skin', v=v_pose, fv=fv[sel], fuv=fuv[sel], uvs=b.uvs, tex=person.spec['skin'],
                              alpha=False, head=flag, rough=0.55, proxy='base', license=None, author=None,
                              decimate=0.6 if flag else 0.4))
    return parts


def part_object(part, name, xf, decimate=True, lod=1.0):
    fv, fuv = part['fv'], part['fuv']
    used = np.unique(fv[fv >= 0])
    remap = -np.ones(len(part['v']), int)
    remap[used] = np.arange(len(used))
    verts = (xf[:3, :3] @ part['v'][used].T).T + xf[:3, 3]
    faces, uvf = [], []
    for f, u in zip(fv, fuv):
        n = 4 if f[3] >= 0 else 3
        faces.append([remap[x] for x in f[:n]])
        uvf.append([tuple(part['uvs'][x]) for x in u[:n]])
    key = os.path.splitext(os.path.basename(part['tex']))[0]
    mat = bk.material(f"{part['name']}.{key}", tex=bk.image(part['tex']), alpha_tex=part['alpha'], rough=part['rough'],
                      double=part['alpha'])
    ob = bk.mesh_object(name, verts, faces, uvf, [mat])
    if part.get('inflate'):
        m = ob.modifiers.new('inflate', 'DISPLACE')
        m.strength = part['inflate']
        m.mid_level = 0
        bk.apply_modifiers(ob)
    if decimate and part.get('decimate', 1) < 1 and len(faces) > 400:
        bk.decimate(ob, part['decimate'] * lod)
    return ob


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def assemble(person, wear, accessories=(), name='person', split_head=False, decimate=True, lod=1.0):
    """Create Blender objects for a posed person. Returns the root empty."""
    parts = build_parts(person, wear)
    off = np.eye(4)
    off[:3, 3] = [person.offset[0], -person.offset[2], person.offset[1]]  # game → Blender
    xf = off @ C
    body, head = [], []
    for i, p in enumerate(parts):
        ob = part_object(p, f'{name}_{p["name"]}_{i}', xf, decimate, lod)
        (head if (split_head and p['head']) else body).append(ob)
    hm = person.head_matrix()
    for acc in accessories:
        objs = acc(person, off @ C @ hm @ C_INV)
        for ob, is_head in objs:
            (head if (split_head and is_head) else body).append(ob)
    root = bk.empty(name)
    b = join(body, name + '_body')
    b.parent = root
    if head:
        h = join(head, name + '_head')
        h.parent = root
    return root, parts


# ---------------------------------------------------------------- accessories (modelled here)

def head_frame(person):
    """Skull centre (Blender rest coordinates) and half-sizes in metres, from the body mesh."""
    b = mh.base()
    body = np.unique(b.fv[b.fm == 0])
    vb = person.v[body[body >= 0]]
    top = vb[:, 1].max()
    eye = person.j['eye.L']['head'][1]
    sl = vb[(vb[:, 1] > eye - 0.1) & (vb[:, 1] < eye + 0.1)]
    half_x = np.abs(sl[:, 0]).max()
    z0, z1 = sl[:, 2].min(), sl[:, 2].max()
    cy = top - (top - eye) * 0.72 - 0.0
    centre = np.array([0.0, cy, (z0 + z1) / 2 - 0.05])
    c = (C @ np.r_[centre, 1])[:3]
    return c, np.array([half_x, (z1 - z0) / 2, top - cy]) * 0.1


def _place(ob, M):
    ob.matrix_world = mathutils.Matrix(M.tolist()) @ ob.matrix_world


def helmet(person, M):
    """Open-face motorcycle helmet, gloss black with a white and red centre stripe."""
    centre, half = head_frame(person)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=tuple(centre))
    shell = bpy.context.active_object
    shell.name = 'helmet'
    shell.scale = (half[0] + 0.022, half[1] + 0.02, half[2] + 0.02)
    bpy.ops.object.transform_apply(scale=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    # cut away the bottom and the face opening
    cz = centre[2]
    def cut(c):
        back = min(1.0, max(0.0, (c.y - centre[1]) / half[1]))
        return c.z < cz - 0.035 - 0.07 * back
    kill = [f for f in bm.faces if cut(f.calc_center_median())]
    face = [f for f in bm.faces if f.calc_center_median().y < centre[1] - 0.03 and f.calc_center_median().z < cz + 0.03
            and abs(f.calc_center_median().x - centre[0]) < 0.082]
    bmesh.ops.delete(bm, geom=list(set(kill + face)), context='FACES')
    bm.to_mesh(shell.data)
    bm.free()
    sol = shell.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.018
    sol.offset = -1
    bk.apply_modifiers(shell)
    for p in shell.data.polygons:
        p.use_smooth = True
    black = bk.material('helmet_black', (0.018, 0.02, 0.025), rough=0.22, clearcoat=1.0)
    white = bk.material('helmet_white', (0.85, 0.85, 0.83), rough=0.3)
    red = bk.material('helmet_red', (0.62, 0.05, 0.05), rough=0.3)
    shell.data.materials.append(black)
    shell.data.materials.append(white)
    shell.data.materials.append(red)
    for p in shell.data.polygons:
        c = p.center
        dx = abs(c.x - centre[0])
        if c.z > cz - 0.01 or c.y > centre[1]:
            if dx < 0.012:
                p.material_index = 2
            elif dx < 0.036:
                p.material_index = 1
    shell.data.update()
    _place(shell, M)
    return [(shell, True)]


def cap(color=(0.17, 0.34, 0.18)):
    def build(person, M):
        centre, half = head_frame(person)
        centre = centre + np.array([0, 0, 0.012])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=tuple(centre))
        crown = bpy.context.active_object
        crown.scale = (half[0] + 0.01, half[1] + 0.008, half[2] + 0.0)
        bpy.ops.object.transform_apply(scale=True)
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(crown.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < centre[2] + 0.004], context='FACES')
        bm.to_mesh(crown.data)
        bm.free()
        s = crown.modifiers.new('s', 'SOLIDIFY')
        s.thickness = 0.006
        bk.apply_modifiers(crown)
        for p in crown.data.polygons:
            p.use_smooth = True
        mat = bk.material('cap_%02x%02x%02x' % tuple(int(c * 255) for c in color), color, rough=0.85)
        crown.data.materials.append(mat)
        # brim
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.085, depth=0.006,
                                            location=(centre[0], centre[1] - half[1] - 0.04, centre[2] + 0.01))
        brim = bpy.context.active_object
        brim.scale = (1.0, 0.75, 1.0)
        brim.rotation_euler = (math.radians(-8), 0, 0)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        brim.data.materials.append(mat)
        _place(crown, M)
        _place(brim, M)
        return [(crown, True), (brim, True)]
    return build


def shemagh(person, M):
    """Red and white shemagh with a black agal, draped from the crown to the shoulders."""
    centre, half = head_frame(person)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=36, ring_count=22, radius=1, location=tuple(centre))
    cloth = bpy.context.active_object
    cloth.scale = (half[0] + 0.012, half[1] + 0.012, half[2] + 0.014)
    bpy.ops.object.transform_apply(scale=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(cloth.data)
    # open the face, then let the lower half fall straight down to the shoulders
    face = [f for f in bm.faces if f.calc_center_median().y < centre[1] - 0.04 and f.calc_center_median().z < centre[2] + 0.055]
    bmesh.ops.delete(bm, geom=face, context='FACES')
    for v in bm.verts:
        if v.co.z < centre[2]:
            drop = (centre[2] - v.co.z)
            v.co.z = centre[2] - drop * 2.6
            v.co.x = centre[0] + (v.co.x - centre[0]) * (1 + drop * 3.2)
            v.co.y = v.co.y + drop * 0.6
    bm.to_mesh(cloth.data)
    bm.free()
    s = cloth.modifiers.new('s', 'SOLIDIFY')
    s.thickness = 0.008
    sub = cloth.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    bk.apply_modifiers(cloth)
    for p in cloth.data.polygons:
        p.use_smooth = True
    # red/white houndstooth-like check texture
    path = os.path.join(CACHE, 'tex', 'shemagh.png')
    if not os.path.exists(path):
        n = 256
        yy, xx = np.mgrid[0:n, 0:n]
        chk = (((xx // 8) + (yy // 8)) % 2 == 0)
        img = np.ones((n, n, 4), np.float32)
        img[:, :, :3] = 0.93
        red = np.array([0.1, 0.1, 0.72], np.float32)
        img[chk, :3] = red
        tx.save(img, path, jpeg=False)
    lay = cloth.data.uv_layers.new(name='UVMap')
    for loop in cloth.data.loops:
        co = cloth.data.vertices[loop.vertex_index].co
        lay.data[loop.index].uv = ((co.x - centre[0]) * 6 + 0.5, (co.z - centre[2]) * 6 + (co.y - centre[1]) * 3)
    cloth.data.materials.append(bk.material('shemagh', tex=bk.image(path), rough=0.9, double=True))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.011, location=tuple(centre + np.array([0, 0.004, half[2] * 0.55])))
    agal = bpy.context.active_object
    agal.scale = ((half[0] * 0.92 + 0.012) / 0.1, (half[1] * 0.92 + 0.012) / 0.1, 1)
    agal.rotation_euler = (math.radians(-12), 0, 0)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    agal.data.materials.append(bk.material('agal', (0.02, 0.02, 0.02), rough=0.6))
    _place(cloth, M)
    _place(agal, M)
    return [(cloth, True), (agal, True)]


def eye_brows_lashes(person, eye='brown', brows='eyebrow010', lashes='Eyelashes01', hair=None):
    out = [
        dict(proxy='eyes/Low-Poly', mat='eyes_' + eye, tex=os.path.join(P('proxies/eyes/Low-Poly/textures'), f'{eye}_eye.png'),
             head=True, rough=0.2, mask=True, decimate=1),
        dict(proxy=f'eyebrows/{brows}', mat='brows', alpha=True, head=True, decimate=1,
             tex=cloth_tex(f'eyebrows/{brows}', 'brows_' + brows, alpha=True)),
        dict(proxy=f'eyelashes/{lashes}', mat='lashes', alpha=True, head=True, decimate=1,
             tex=cloth_tex(f'eyelashes/{lashes}', 'lashes_' + lashes, alpha=True)),
    ]
    if hair:
        rel, key, rgb = hair
        out.append(dict(proxy=f'hair/{rel}', mat='hair_' + key, alpha=True, head=True, decimate=1, rough=0.6,
                        tex=hair_tex(f'hair/{rel}', 'hair_' + key, rgb)))
    return out
