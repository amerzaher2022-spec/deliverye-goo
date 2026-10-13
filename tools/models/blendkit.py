"""Small helpers for building, rendering and exporting models with Blender's Python module (bpy)."""
import math
import os

import bpy
import numpy as np


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _images.clear()


def mh_to_blender(v):
    """MakeHuman (decimetres, y up, faces +z) → Blender (metres, z up, faces -y).
    The glTF exporter maps Blender back to y up, so the model faces +z in three.js."""
    v = np.asarray(v) * 0.1
    return np.c_[v[:, 0], -v[:, 2], v[:, 1]]


_images = {}


def image(path, name=None, tint=None, alpha=False):
    """Load an image once. `tint` is a function (np.ndarray RGBA float 0..1) → array."""
    key = (path, name, id(tint) if tint else None)
    if key in _images:
        return _images[key]
    img = bpy.data.images.load(path, check_existing=False)
    if tint is not None:
        px = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)
        px = tint(px)
        img.pixels[:] = np.clip(px, 0, 1).ravel()
    if name:
        img.name = name
    img.alpha_mode = 'STRAIGHT'
    _images[key] = img
    return img


def material(name, color=(0.8, 0.8, 0.8), tex=None, rough=0.7, metal=0.0, alpha_tex=False,
             normal_tex=None, emission=None, double=False, clearcoat=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if clearcoat:
        bsdf.inputs['Coat Weight'].default_value = clearcoat
    if tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_tex:
            # Alpha clip: the glTF exporter recognises Round(alpha) as MASK with cutoff 0.5.
            r = nt.nodes.new('ShaderNodeMath')
            r.operation = 'ROUND'
            nt.links.new(t.outputs['Alpha'], r.inputs[0])
            nt.links.new(r.outputs[0], bsdf.inputs['Alpha'])
    if normal_tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = normal_tex
        t.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission[0], 1)
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    mat.use_backface_culling = not double
    return mat


def mesh_object(name, verts, faces, uvs=None, mats=None, face_mats=None, smooth=True, parent=None):
    """verts (n,3) Blender coords; faces list of index lists; uvs list (per face) of (u,v) lists."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, p)) for p in verts], [], [list(map(int, f)) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name='UVMap')
        flat = [uv for f in uvs for uv in f]
        layer.data.foreach_set('uv', np.array(flat, np.float32).ravel())
    if mats:
        for m in mats:
            me.materials.append(m)
        if face_mats is not None:
            me.polygons.foreach_set('material_index', np.asarray(face_mats, np.int32))
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, parent=None, loc=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def decimate(ob, ratio, keep_group=None):
    if ratio >= 0.999:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    if keep_group:
        m.vertex_group = keep_group
        m.invert_vertex_group = True
        m.vertex_group_factor = 1.0
    apply_modifiers(ob)


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def setup_render(res=(768, 768), samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    sky = w.node_tree.nodes.new('ShaderNodeTexSky')
    try:
        sky.sky_type = 'NISHITA'
    except Exception:
        pass
    w.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.35
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(so)
    gp = bpy.data.meshes.new('ground')
    gp.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', gp)
    g.data.materials.append(material('ground', (0.42, 0.41, 0.4), rough=0.9))
    sc.collection.objects.link(g)
    return g


def camera(loc, target, lens=50):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    co = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = loc
    d = np.array(target) - np.array(loc)
    import mathutils
    co.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
