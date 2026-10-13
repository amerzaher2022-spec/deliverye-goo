"""Build the game's 3D models into web/public/models/.

Requirements (build machine only, nothing here ships with the game):
  python3.13 -m venv .venv && .venv/bin/pip install bpy==5.2.2 numpy scikit-image opencv-python-headless pillow
  npm pack makehuman-data-v1 && tar xzf makehuman-data-v1-*.tgz   # MakeHuman data set (see CREDITS.md)

Run:
  MH_DATA=/path/to/package/public/data .venv/bin/python tools/models/build_models.py [--preview DIR] [--only NAME]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

import blendkit as bk  # noqa: E402
import mh  # noqa: E402
import people as pp  # noqa: E402
import poses as po  # noqa: E402
import props  # noqa: E402
import vehicles as vh  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FILE_OF = {'rider_scooter': 'scooter', 'rider_bicycle': 'bicycle', 'manager': 'dispatcher'}
OUT = os.path.join(ROOT, 'web', 'public', 'models')
CREDITS = []

MALE = dict(gender=1, age=0.5, muscle=0.6, weight=0.5, height=0.5, proportions=0.6, race=(0.15, 0.05, 0.8))
FEMALE = dict(gender=0, age=0.45, muscle=0.5, weight=0.45, height=0.45, proportions=0.65, race=(0.05, 0.05, 0.9))
DARK_HAIR = (0.045, 0.036, 0.03)


def wear(rel, mat, key, edit=None, **kw):
    return dict(proxy=rel, mat=mat, tex=pp.cloth_tex(rel, key, edit), **kw)


def rider_outfit(p):
    return pp.eye_brows_lashes(p, hair=('short04', 'dark', DARK_HAIR)) + [
        wear('clothes/male_casualsuit06', 'rider_tee_jeans', 'rider_suit', pp.edit_white_tee),
        wear('clothes/shoes05', 'sneakers_white', 'shoes05'),
    ]


# ------------------------------------------------------------------ characters

def rider_scooter():
    p = pp.Person(dict(macro=MALE, skin=pp.skin_tex('m')))
    S = vh.SCOOTER
    fx, fy, fz = S['floor']
    po.seated(p, seat=(0, 0.795 + 0.085, -0.2), grip=S['grip'], wrist_back=(0.03, 0.035, 0.07),
              ankles=[(fx, fy + 0.075, fz), (-fx, fy + 0.075, fz)], lean=14)
    return p, rider_outfit(p), [pp.helmet], True


def rider_bicycle():
    p = pp.Person(dict(macro=MALE, skin=pp.skin_tex('m')))
    B = vh.BICYCLE
    bb, cr = np.array(B['bb']), B['crank']
    left = bb + np.array([0.125, 0.07, cr - 0.07])
    right = bb + np.array([-0.125, 0.07, -cr - 0.07])
    sx, sy, sz = B['seat']
    po.seated(p, seat=(0, sy + 0.075, sz - 0.02), grip=B['grip'], wrist_back=(0.02, 0.03, 0.075),
              ankles=[left, right], lean=16, pole_knee=(0, 0.25, 1))
    return p, rider_outfit(p), [pp.helmet], True


def staff():
    """Restaurant staff: auburn hair, blue shirt, brown trousers, holding foil food trays."""
    p = pp.Person(dict(macro=FEMALE, skin=pp.skin_tex('f')))
    po.carry(p, depth=0.3, height=-0.3, width=0.12)
    w = pp.eye_brows_lashes(p, brows='eyebrow001', hair=('long01', 'auburn', (0.42, 0.13, 0.05))) + [
        wear('clothes/female_casualsuit01', 'staff_shirt', 'staff_suit', pp.edit_staff_shirt),
        wear('clothes/shoes03', 'shoes_black', 'shoes03'),
    ]
    return p, w, [props.foil_trays(3)], False


def pizza_carrier():
    p = pp.Person(dict(macro=dict(FEMALE, age=0.4, weight=0.5), skin=pp.skin_tex('f2')))
    po.carry(p, depth=0.3, height=-0.32, width=0.14)
    w = pp.eye_brows_lashes(p, brows='eyebrow001', hair=('ponytail01', 'brown', (0.09, 0.055, 0.035))) + [
        wear('clothes/female_casualsuit02', 'pink_top', 'pink_suit', pp.edit_pink_top),
        wear('clothes/shoes06', 'shoes_blue', 'shoes06'),
    ]
    return p, w, [props.pizza_boxes(3, pp.CACHE)], False


def cap_man():
    """Pedestrian in a green cap and grey tank top."""
    p = pp.Person(dict(macro=dict(MALE, muscle=0.7, age=0.42), skin=pp.skin_tex('m2')))
    po.idle(p, spread=0.07, bend=0.04)
    w = pp.eye_brows_lashes(p, hair=('short04', 'dark', DARK_HAIR)) + [
        wear('clothes/Tank_Top_01', 'tank_grey', 'tank_grey', pp.edit_grey_tank, inflate=0.01),
        wear('clothes/Tightjeans', 'jeans_dark', 'jeans_dark', pp.edit_jeans((0.16, 0.2, 0.3)), inflate=0.006),
        wear('clothes/shoes02', 'shoes_trainers', 'shoes02'),
    ]
    return p, w, [pp.cap((0.16, 0.32, 0.17))], False


def jacket_man():
    p = pp.Person(dict(macro=dict(MALE, age=0.58, weight=0.58), skin=pp.skin_tex('m'),
                       extra={}))
    po.idle(p, spread=0.05, bend=0.08, variant=1)
    w = pp.eye_brows_lashes(p, brows='eyebrow001', hair=('short01', 'dark', DARK_HAIR)) + [
        wear('clothes/male_casualsuit05', 'jacket_grey', 'jacket_grey', pp.edit_grey_jacket),
        wear('clothes/shoes03', 'shoes_black', 'shoes03'),
        dict(proxy='hair/Moustache', mat='moustache', alpha=True, head=True, decimate=1,
             tex=pp.cloth_tex('hair/Moustache', 'moustache', alpha=True)),
    ]
    return p, w, [], False


def worker():
    p = pp.Person(dict(macro=dict(MALE, muscle=0.65, weight=0.55), skin=pp.skin_tex('m2')))
    po.idle(p, spread=0.06, bend=0.06, variant=-1)
    w = pp.eye_brows_lashes(p, hair=('short02', 'dark', DARK_HAIR)) + [
        wear('clothes/male_worksuit01', 'overalls', 'worksuit'),
        wear('clothes/shoes01', 'shoes_brown', 'shoes01'),
    ]
    return p, w, [], False


def woman_casual():
    p = pp.Person(dict(macro=dict(FEMALE, age=0.5), skin=pp.skin_tex('f2')))
    po.idle(p, spread=0.05, bend=0.07)
    w = pp.eye_brows_lashes(p, brows='eyebrow001', hair=('bob02', 'black', (0.03, 0.025, 0.022))) + [
        wear('clothes/VNeckTop', 'vneck_teal', 'vneck_teal', lambda im: pp.tx.recolor(im, im[:, :, 3] > -1, (0.1, 0.42, 0.45), ref=0.75), inflate=0.01),
        wear('clothes/Tightjeans', 'jeans_mid', 'tightjeans', pp.edit_jeans(), inflate=0.006),
        wear('clothes/shoes04', 'shoes_tan', 'shoes04'),
    ]
    return p, w, [], False


def manager():
    """Dispatcher portrait: shemagh, white shirt and a high-visibility vest."""
    p = pp.Person(dict(macro=dict(MALE, age=0.72, weight=0.62, muscle=0.5), skin=pp.skin_tex('old'),
                       extra={'expression/units/caucasian/mouth-corner-puller': 0.7,
                              'expression/units/caucasian/eye-left-slit': 0.25,
                              'expression/units/caucasian/eye-right-slit': 0.25}))
    po.idle(p, spread=0.06, bend=0.12)
    w = pp.eye_brows_lashes(p, brows='eyebrow001') + [
        wear('clothes/male_casualsuit06', 'rider_tee_jeans', 'rider_suit', pp.edit_white_tee),
        wear('clothes/Harvey_VestV1', 'hivis', 'hivis', pp.edit_hivis, mask=False, inflate=0.012),
        dict(proxy='hair/Moustache', mat='moustache', alpha=True, head=True, decimate=1,
             tex=pp.cloth_tex('hair/Moustache', 'moustache', alpha=True)),
    ]
    return p, w, [pp.shemagh], False


PEOPLE = {
    'rider_scooter': rider_scooter,
    'rider_bicycle': rider_bicycle,
    'staff': staff,
    'pizza_carrier': pizza_carrier,
    'cap_man': cap_man,
    'jacket_man': jacket_man,
    'worker': worker,
    'woman_casual': woman_casual,
}


def build_person(name, fn, lod=1.0):
    p, w, acc, split = fn()
    for item in w:
        if item['proxy'].startswith('clothes/shoes'):
            item['decimate'] = 0.35
    root, parts = pp.assemble(p, w, accessories=acc, name=name, split_head=split, lod=lod)
    for part in parts:
        if part['license']:
            CREDITS.append((FILE_OF.get(name, 'people'), part['proxy'], part['license'].get('license'),
                            part['license'].get('author')))
    anchors = {k: po.g(p, b).round(4).tolist() for k, b in (('eyes', 'eye.L'), ('head', 'head'))}
    return root, anchors


# ------------------------------------------------------------------ export

def set_origin(ob, game_point):
    """Move the object's origin to a game-frame point (wheel axles) without moving the geometry."""
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = mathutils.Matrix.Identity(4)
    b = mathutils.Vector(vh.G(game_point))
    ob.data.transform(mathutils.Matrix.Translation(-b))
    ob.location = b


def tree(root):
    out = [root]
    for c in root.children:
        out += tree(c)
    return out


def export(objs, path):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_image_format='WEBP', export_image_quality=82,
                              export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False)
    return os.path.getsize(path)


def stats(objs, detail=False):
    out = dict(triangles=bk.tri_count(objs),
               materials=len({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}))
    if detail:
        per = {}
        for o in objs:
            if o.type != 'MESH':
                continue
            for p in o.data.polygons:
                k = o.data.materials[p.material_index].name
                per[k] = per.get(k, 0) + len(p.vertices) - 2
        out['by_material'] = per
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    a = ap.parse_args([x for x in sys.argv[1:] if x != '--'])
    mh.DATA = os.environ['MH_DATA']
    os.makedirs(OUT, exist_ok=True)
    report = {}

    def want(n):
        return a.only is None or a.only == n

    if want('scooter'):
        bk.reset()
        body, fw, rw = vh.build_scooter()
        set_origin(fw, (0, vh.SCOOTER['wheel_r'], vh.SCOOTER['front']))
        set_origin(rw, (0, vh.SCOOTER['wheel_r'], vh.SCOOTER['rear']))
        root = bk.empty('scooter')
        for o in (body, fw, rw):
            o.parent = root
        rider, anchors = build_person('rider_scooter', rider_scooter)
        objs = tree(root) + tree(rider)
        report['scooter'] = dict(stats(objs, True), bytes=export(objs, os.path.join(OUT, 'scooter.glb')), anchors=anchors)
        if a.preview:
            preview(a.preview, 'scooter', (2.3, 1.3, 1.6), (0, 0.8, 0.0))

    if want('bicycle'):
        bk.reset()
        body, fw, rw = vh.build_bicycle()
        set_origin(fw, (0, vh.BICYCLE['wheel_r'], vh.BICYCLE['front']))
        set_origin(rw, (0, vh.BICYCLE['wheel_r'], vh.BICYCLE['rear']))
        root = bk.empty('bicycle')
        for o in (body, fw, rw):
            o.parent = root
        rider, anchors = build_person('rider_bicycle', rider_bicycle)
        objs = tree(root) + tree(rider)
        report['bicycle'] = dict(stats(objs), bytes=export(objs, os.path.join(OUT, 'bicycle.glb')), anchors=anchors)
        if a.preview:
            preview(a.preview, 'bicycle', (2.3, 1.3, 1.6), (0, 0.85, 0.0))

    if want('people'):
        bk.reset()
        roots = []
        for i, (name, fn) in enumerate((k, v) for k, v in PEOPLE.items() if not k.startswith('rider')):
            r, _ = build_person(name, fn, lod=0.62)
            r.location.x = i * 1.0  # spread out for the preview; the game resets positions
            roots.append(r)
        objs = [o for r in roots for o in tree(r)]
        for r in roots:
            r.location.x = 0
        report['people'] = dict(stats(objs), bytes=export(objs, os.path.join(OUT, 'people.glb')),
                                each={r.name: stats(tree(r), True) for r in roots})
        if a.preview:
            for i, r in enumerate(roots):
                r.location.x = (i - (len(roots) - 1) / 2) * 0.85
            preview(a.preview, 'people', (0, 1.3, 5.4), (0, 0.95, 0), lens=34, res=(1400, 720))

    if want('manager'):
        bk.reset()
        r, _ = build_person('manager', manager)
        png = os.path.join(pp.CACHE, 'dispatcher.png')
        portrait(png)
        import cv2
        im = cv2.imread(png, cv2.IMREAD_UNCHANGED)
        im = cv2.resize(im, (256, 256), interpolation=cv2.INTER_AREA)
        out = os.path.join(ROOT, 'web', 'public', 'img', 'dispatcher.webp')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        cv2.imwrite(out, im, [cv2.IMWRITE_WEBP_QUALITY, 88])
        report['dispatcher'] = dict(bytes=os.path.getsize(out))

    # merge with the previous run so partial rebuilds (--only) keep the other entries
    path = os.path.join(OUT, 'models.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    merged = dict(old.get('report', {}), **report)
    sources = dict(old.get('sources', {}))
    for name in report:
        sources[name] = sorted({tuple(c[1:]) for c in CREDITS if c[0] == name})
    with open(path, 'w') as f:
        json.dump(dict(report=merged, sources=sources), f, indent=1)
    print(json.dumps(report, indent=1))


def preview(folder, name, cam, look, lens=40, res=(960, 720)):
    """Cycles render for checking the result (game frame camera position and target)."""
    os.makedirs(folder, exist_ok=True)
    bk.setup_render(res, 32)
    bpy.context.scene.view_settings.exposure = -1.1
    bk.camera(vh.G(cam), vh.G(look), lens=lens)
    bk.render(os.path.join(folder, name + '.png'))


def portrait(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    bk.setup_render((512, 512), 64)
    bpy.data.objects['ground'].hide_render = True
    sc.render.film_transparent = True
    sc.view_settings.exposure = -0.9
    bk.camera(vh.G((0.25, 1.5, 1.15)), vh.G((0, 1.48, 0)), lens=58)
    bk.render(path)


if __name__ == '__main__':
    main()
