"""Build the game's 3D models into web/public/models/ — all original, authored in this folder.

Requirements (build machine only, nothing here ships with the game):
  python3.13 -m venv .venv-models
  .venv-models/bin/pip install bpy==5.2.2 numpy scipy scikit-image opencv-python-headless pillow
  node tools/models/render-decals.mjs        # livery decals (badge, backpack, door, pizza lid)

Run:
  .venv-models/bin/python tools/models/build_models.py [--only scooter|bicycle|people|cars|dispatcher] [--preview DIR] [--fast]
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

import bake as bkk  # noqa: E402
import blendkit as bk  # noqa: E402
import cast  # noqa: E402
import sculpt as sc  # noqa: E402
import stances as st  # noqa: E402
import vehicles as vh  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'models')
CACHE = os.environ.get('MODEL_CACHE', '/tmp/model-cache')
FAST = False


def q(full, fast):
    return fast if FAST else full


# ------------------------------------------------------------------ riders

def scooter_pose(sk, b):
    V = vh.SCOOTER
    fx, fy, fz = V['floor']
    st.seated(sk, b, seat=(0, 0.795 + 0.1, -0.1), grip=V['grip'],
              ankles=[(fx, fy + 0.075, fz + 0.03), (-fx, fy + 0.075, fz + 0.03)], lean=20)


def bicycle_pose(sk, b):
    V = vh.BICYCLE
    bb, cr = np.array(V['bb']), V['crank']
    left = bb + np.array([0.125, 0.07, cr - 0.07])
    right = bb + np.array([-0.125, 0.07, -cr - 0.07])
    st.seated(sk, b, seat=(0, V['seat'][1] + 0.09, V['seat'][2] + 0.0), grip=V['grip'], ankles=[left, right], lean=22,
              pole_knee=(0, 0.25, 1))


def bake_rider(name, pose):
    b, sk, fig, pt = cast.courier(pose)
    h = sk.head('head')
    hb = (h + np.array([-0.15, -0.09, -0.17]), h + np.array([0.15, 0.27, 0.19]))
    lo = bkk.bake(name, fig, pt, ((-0.46, 0.2, -0.75), (0.46, 1.95, 0.8)), target=q(12000, 6000), tex=q(1024, 512),
                  head_bounds=hb, step=q(0.0025, 0.004), head_step=q(0.0012, 0.003), out_dir=os.path.join(CACHE, 'bake'))
    centre = sk.point('head', np.array([0, 0.09, 0.0]) * b.s)
    neck_top = sk.head('head')[1] - 0.03
    head = bkk.split(lo, lambda p: np.linalg.norm(p - centre) < 0.2 and p[1] > neck_top, f'{name}_head')
    lo.name = f'{name}_body'
    root = bk.empty(name)
    lo.parent = root
    if head:
        head.parent = root
    eye = sk.point('head', np.array([0, 0.0795, 0.08]) * b.s * b.head)
    return root, [round(float(x), 4) for x in eye]


# ------------------------------------------------------------------ export helpers

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
                              export_materials='EXPORT', export_image_format='WEBP', export_image_quality=84,
                              export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
    return os.path.getsize(path)


def stats(objs):
    return dict(triangles=bk.tri_count(objs),
                materials=len({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}))


def preview(folder, name, cam, look, lens=40, res=(960, 720)):
    os.makedirs(folder, exist_ok=True)
    bk.setup_render(res, 32)
    bpy.context.scene.view_settings.exposure = -1.0
    bk.camera(vh.G(cam), vh.G(look), lens=lens)
    bk.render(os.path.join(folder, name + '.png'))


def portrait(path):
    """Dispatcher portrait (head and shoulders), rendered from the high-detail sculpt."""
    b, sk, fig, pt = cast.dispatcher()
    h = sk.head('head')
    v, f, _ = sc.mesh(fig.field, h + np.array([-0.3, -0.35, -0.2]), h + np.array([0.3, 0.3, 0.25]), 0.0015, coarse=0.006)
    ob = bkk.make_mesh('dispatcher', v, f, pt.paint(v, fig.classify(v)))
    mat = bpy.data.materials.new('vc')
    mat.use_nodes = True
    nt = mat.node_tree
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    ob.data.materials.append(mat)
    bk.setup_render((512, 512), 64)
    bpy.data.objects['ground'].hide_render = True
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.view_settings.exposure = -0.9
    e = h + np.array([0, 0.07, 0])
    bk.camera(vh.G(e + np.array([0.16, 0.0, 0.62])), vh.G(e + np.array([0, -0.06, 0])), lens=55)
    png = os.path.join(CACHE, 'dispatcher.png')
    bk.render(png)
    import cv2
    im = cv2.imread(png, cv2.IMREAD_UNCHANGED)
    im = cv2.resize(im, (256, 256), interpolation=cv2.INTER_AREA)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, im, [cv2.IMWRITE_WEBP_QUALITY, 88])
    return os.path.getsize(path)


# ------------------------------------------------------------------ main

def main():
    global FAST
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    ap.add_argument('--fast', action='store_true')
    a = ap.parse_args([x for x in sys.argv[1:] if x != '--'])
    FAST = a.fast
    os.makedirs(OUT, exist_ok=True)
    report = {}

    def want(n):
        return a.only is None or n in a.only.split(',')

    for kind, build, spec, pose in (('scooter', vh.build_scooter, vh.SCOOTER, scooter_pose),
                                    ('bicycle', vh.build_bicycle, vh.BICYCLE, bicycle_pose)):
        if not want(kind):
            continue
        bk.reset()
        body, fw, rw = build()
        set_origin(fw, (0, spec['wheel_r'], spec['front']))
        set_origin(rw, (0, spec['wheel_r'], spec['rear']))
        root = bk.empty(kind)
        for o in (body, fw, rw):
            o.parent = root
        rider, eye = bake_rider(f'rider_{kind}', pose)
        objs = tree(root) + tree(rider)
        report[kind] = dict(stats(objs), bytes=export(objs, os.path.join(OUT, f'{kind}.glb')), eye=eye,
                            rider=stats(tree(rider)))
        if a.preview:
            preview(a.preview, kind, (2.3, 1.3, 1.6), (0, 0.85, 0.0))
            preview(a.preview, kind + '_back', (-1.2, 1.7, -2.6), (0, 0.95, 0.0))

    if want('people'):
        bk.reset()
        roots, each = [], {}
        for name, fn in cast.CAST.items():
            b, sk, fig, pt = fn()
            big = name in ('staff', 'pizza_carrier')
            lo = bkk.bake(name, fig, pt, ((-0.46, -0.02, -0.32), (0.46, 1.92, 0.6)), target=q(9000 if big else 7000, 4000),
                          tex=q(1024 if big else 512, 512), head_bounds=None if FAST else
                          (sk.head('head') + np.array([-0.15, -0.09, -0.17]), sk.head('head') + np.array([0.15, 0.27, 0.19])),
                          step=q(0.0028, 0.005), head_step=q(0.0016, 0.003), out_dir=os.path.join(CACHE, 'bake'))
            lo.name = f'{name}_body'
            r = bk.empty(name)
            lo.parent = r
            roots.append(r)
            each[name] = stats([lo])
        objs = [o for r in roots for o in tree(r)]
        report['people'] = dict(stats(objs), bytes=export(objs, os.path.join(OUT, 'people.glb')), each=each)
        if a.preview:
            for i, r in enumerate(roots):
                r.location.x = (i - (len(roots) - 1) / 2) * 0.85
            preview(a.preview, 'people', (0, 1.3, 5.6), (0, 0.95, 0), lens=34, res=(1400, 720))

    if want('cars'):
        import cars
        bk.reset()
        report['cars'] = cars.build_all(OUT, a.preview)

    if want('dispatcher'):
        bk.reset()
        report['dispatcher'] = dict(bytes=portrait(os.path.join(ROOT, 'web', 'public', 'img', 'dispatcher.webp')))

    path = os.path.join(OUT, 'models.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    merged = dict(old.get('report', {}), **report)
    with open(path, 'w') as f:
        json.dump(dict(report=merged, note='All models are original work generated by tools/models.'), f, indent=1)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
