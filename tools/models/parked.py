"""Parked street cars, baked: each car type is a light mesh (about 3k triangles) with one shared texture
atlas that carries all the detail of the full model (lamps, grille, glass, panel lines, wheels, shading).

The atlas alpha channel tells the game how to shade each texel:
  1.0   body paint: tinted per car with the instance colour
  0.66  glass and lamps: glossy
  0.33  tyres, trim, plates: matte
  0.0   chrome and rims: metallic

Output: parked.glb (nodes parked_{kind}, material 'parked_atlas') and parked.webp (the atlas, sRGB, the
image's top row is v = 1 in glTF terms, so load it with flipY = false).
"""
import math
import os

import bpy
import numpy as np
from PIL import Image

import blendkit as bk
import cars
from vehicles import join

KINDS = ('hatch', 'sedan', 'suv', 'pickup')
TILE = 1024
TARGET = 3200

# mask values: chrome is at the end of the scale so that no filtered border between two other kinds of
# surface passes through it (that showed up as bright outlines around windows)
PAINT, GLASS, MATTE, METAL = 1.0, 0.66, 0.33, 0.0

# material name → (colour or (dark, light) reflection gradient, mask)
SHADE = {
    'car_paint': ((1, 1, 1), 1.0),
    'car_roof': ((1, 1, 1), 1.0),
    'car_glass': (((0.008, 0.009, 0.011), (0.1, 0.115, 0.135)), GLASS),
    'car_chrome': (((0.1, 0.1, 0.11), (0.42, 0.43, 0.45)), METAL),
    'car_rim': (((0.2, 0.2, 0.21), (0.5, 0.51, 0.53)), METAL),
    'car_rim_dark': ((0.05, 0.055, 0.06), METAL),
    'car_lamp': (((0.04, 0.04, 0.045), (0.35, 0.36, 0.38)), GLASS),
    'car_drl': ((0.8, 0.8, 0.78), GLASS),
    'car_tail': ((0.42, 0.015, 0.012), GLASS),
    'car_indicator': ((0.85, 0.36, 0.02), GLASS),
    'car_amber': ((0.78, 0.33, 0.02), GLASS),
    'car_plate': ((0.82, 0.82, 0.78), MATTE),
}


def _emission(name, colour, value=None):
    """Emission material: a flat colour, a sky-reflection gradient (dark, light) by normal, or a grey value."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    if value is not None:
        em.inputs['Color'].default_value = (value, value, value, 1)
    elif isinstance(colour[0], tuple):
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        mr.inputs['From Min'].default_value = -0.3
        mr.inputs['From Max'].default_value = 0.9
        nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
        mix.inputs['A'].default_value = (*colour[0], 1)
        mix.inputs['B'].default_value = (*colour[1], 1)
        nt.links.new(mix.outputs['Result'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (*colour, 1)
    return m


def _base(mat):
    if not mat or not mat.use_nodes or 'Principled BSDF' not in mat.node_tree.nodes:
        return (0.03, 0.03, 0.03)
    return tuple(mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])


def _set_materials(ob, mode):
    """mode 'colour' or 'mask': swap every slot of the high-detail car for an emission material."""
    for i, slot in enumerate(ob.material_slots):
        src = ob.data.materials[i]
        name = src.name if src else ''
        colour, mask = SHADE.get(name, (_base(src), MATTE))
        ob.data.materials[i] = _emission(f'{mode}_{name}_{i}', colour, mask if mode == 'mask' else None)


def _image(name, colour, fill=0.0):
    img = bpy.data.images.new(name, TILE, TILE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    img.generated_color = (fill, fill, fill, 1)
    return img


def _pixels(img):
    a = np.empty(TILE * TILE * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(TILE, TILE, 4)


def bake_kind(kind):
    """Returns (low-poly object, colour, ao, mask arrays)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.world = scene.world or bpy.data.worlds.new('w')
    body, wheels = cars.build(kind, livery=False, level=2, detail=True)
    hi = join([body] + wheels, f'{kind}_hi')
    body, wheels = cars.build(kind, livery=False, level=1, detail=False)
    lo = join([body] + wheels, f'parked_{kind}')
    bk.decimate(lo, min(1.0, TARGET / max(1, bk.tri_count([lo]))))
    lo.data.materials.clear()
    for p in lo.data.polygons:
        p.use_smooth = True
    lo.data.set_sharp_from_angle(angle=math.radians(40))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = lo
    lo.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.1, island_margin=0.004, area_weight=0.0, correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    mat = bpy.data.materials.new(f'bake_{kind}')
    mat.use_nodes = True
    lo.data.materials.append(mat)
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    nt.nodes.active = node
    lo.visible_camera = lo.visible_diffuse = lo.visible_glossy = lo.visible_shadow = False

    # ground for contact shadow in the occlusion bake
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    ground = bpy.context.active_object

    def run(kind_, img, samples):
        node.image = img
        scene.cycles.samples = samples
        for o in bpy.context.selected_objects:
            o.select_set(False)
        hi.select_set(True)
        lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        bpy.ops.object.bake(type=kind_, use_selected_to_active=True, cage_extrusion=0.03, max_ray_distance=0.09,
                            margin=8, use_clear=False)
        return _pixels(img)

    originals = list(hi.data.materials)
    _set_materials(hi, 'colour')
    colour = run('EMIT', _image(f'{kind}_colour', True), 1)
    for i, m in enumerate(originals):
        hi.data.materials[i] = m
    _set_materials(hi, 'mask')
    mask = run('EMIT', _image(f'{kind}_mask', False, MATTE), 1)  # unused texels read as matte
    ao = run('AO', _image(f'{kind}_ao', False), 64)
    bpy.data.objects.remove(hi)
    bpy.data.objects.remove(ground)
    lo.visible_camera = lo.visible_diffuse = lo.visible_glossy = lo.visible_shadow = True
    return lo, colour, ao, mask


def build(out_dir, preview=None):
    from build_models import export, stats, tree, preview as pv
    bk.reset()
    atlas = np.zeros((2 * TILE, 2 * TILE, 4), np.float32)
    los = []
    for i, kind in enumerate(KINDS):
        lo, colour, ao, mask = bake_kind(kind)
        tx, ty = i % 2, i // 2
        uv = lo.data.uv_layers.active.data
        a = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get('uv', a)
        a = a.reshape(-1, 2) * 0.5 + np.array([tx * 0.5, ty * 0.5], np.float32)
        uv.foreach_set('uv', a.ravel())
        rgba = colour.copy()
        rgba[..., :3] *= 0.5 + 0.5 * ao[..., :1]
        rgba[..., 3] = mask[..., 0]
        atlas[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = rgba
        los.append(lo)
    # one material for every car, its texture is the atlas
    img = bpy.data.images.new('parked_atlas', 2 * TILE, 2 * TILE, alpha=True)
    img.pixels.foreach_set(atlas.ravel())
    mat = bk.material('parked_atlas', (1, 1, 1), tex=img, rough=0.42, metal=0.15)
    for i, lo in enumerate(los):
        lo.data.materials.clear()
        lo.data.materials.append(mat)
        lo.location.x = (i - 1.5) * 2.6
    if preview:
        pv(preview, 'parked', (0, 3.2, 9.5), (0, 0.7, 0), lens=32, res=(1400, 600))
    for lo in los:
        lo.location.x = 0
    # export the meshes without the texture; the atlas goes out as its own WebP with the alpha mask
    mat.name = 'parked_preview'
    lo_mat = bpy.data.materials.new('parked_atlas_plain')
    lo_mat.use_nodes = True
    for lo in los:
        lo.data.materials[0] = lo_mat
    lo_mat.name = 'parked_atlas'
    path = os.path.join(out_dir, 'parked.webp')
    px = (np.clip(atlas[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(px, 'RGBA').save(path, quality=86, method=6)
    report = dict(stats(los), bytes=export(los, os.path.join(out_dir, 'parked.glb')), atlas_bytes=os.path.getsize(path),
                  each={lo.name: stats([lo]) for lo in los})
    return report
