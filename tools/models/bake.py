"""High-detail sculpt → game mesh: decimate, unwrap, and bake colour, ambient occlusion and normals (Blender)."""
import os

import bmesh
import bpy
import numpy as np

import blendkit as bk
import sculpt as sc


def to_blender(v):
    return np.c_[v[:, 0], -v[:, 2], v[:, 1]]


def make_mesh(name, v, f, colors=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(to_blender(v).tolist(), [], f[:, ::-1].tolist())
    if colors is not None:
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', np.c_[colors, np.ones(len(colors))].astype(np.float32).ravel())
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _inside(v, lo, hi):
    return np.all((v >= lo) & (v <= hi), axis=1)


def sculpt_meshes(fig, painter, bounds, head_bounds=None, step=0.0025, head_step=0.0012):
    """High-detail meshes (body, and the head at a finer step), painted."""
    lo, hi = bounds
    v, f, _ = sc.mesh(fig.field, lo, hi, step)
    parts = []
    if head_bounds is not None:
        hlo, hhi = np.asarray(head_bounds[0]), np.asarray(head_bounds[1])
        cent = v[f].mean(1)
        keep = ~_inside(cent, hlo + 0.004, hhi - 0.004)
        f = f[keep]
        hv, hf, _ = sc.mesh(fig.field, hlo, hhi, head_step, coarse=0.006)
        hc = hv[hf].mean(1)
        hf = hf[_inside(hc, hlo + 0.0015, hhi - 0.0015)]
        parts.append((hv, hf))
    parts.insert(0, (v, f))
    out = []
    for pv, pf in parts:
        cls = fig.classify(pv)
        out.append((pv, pf, painter.paint(pv, cls)))
    return out


def low_mesh(fig, bounds, step, target):
    v, f, _ = sc.mesh(fig.field, bounds[0], bounds[1], step)
    ob = make_mesh('low', v, f)
    bk.decimate(ob, min(1.0, target / max(1, len(f))))
    return ob


def unwrap(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def _image(name, size, non_color=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def bake(name, fig, painter, bounds, target=9000, tex=1024, head_bounds=None, low_step=0.0045,
         step=0.0025, head_step=0.0012, ao_strength=0.38, roughness=0.72, out_dir='/tmp/model-cache/bake'):
    """Returns a baked low-poly Blender object named `name`."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    his = []
    for i, (v, f, col) in enumerate(sculpt_meshes(fig, painter, bounds, head_bounds, step, head_step)):
        his.append(make_mesh(f'{name}_hi{i}', v, f, col))
    hm = bpy.data.materials.new(f'{name}_hi')
    hm.use_nodes = True
    nt = hm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    for h in his:
        h.data.materials.append(hm)

    lo = low_mesh(fig, bounds, low_step, target)
    lo.name = name
    unwrap(lo)
    mat = bpy.data.materials.new(f'{name}_mat')
    mat.use_nodes = True
    lo.data.materials.append(mat)
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    imgs = {k: _image(f'{name}_{k}', tex, non_color=(k == 'normal')) for k in ('color', 'ao', 'normal')}
    nodes = {}
    for k, img in imgs.items():
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nodes[k] = n

    lo.visible_camera = lo.visible_diffuse = lo.visible_glossy = lo.visible_shadow = False
    lo.visible_transmission = lo.visible_volume_scatter = False

    def run(kind, key, **kw):
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for h in his:
            h.select_set(True)
        lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        nt.nodes.active = nodes[key]
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.012, max_ray_distance=0.03,
                            margin=6, **kw)

    scene.cycles.samples = 1
    run('EMIT', 'color')
    scene.cycles.samples = 48
    scene.world = scene.world or bpy.data.worlds.new('w')
    run('AO', 'ao')
    scene.cycles.samples = 1
    run('NORMAL', 'normal', normal_space='TANGENT')

    # colour × ambient occlusion → final albedo
    size = tex * tex * 4
    c = np.empty(size, np.float32)
    a = np.empty(size, np.float32)
    imgs['color'].pixels.foreach_get(c)
    imgs['ao'].pixels.foreach_get(a)
    c = c.reshape(-1, 4)
    a = a.reshape(-1, 4)[:, :1]
    c[:, :3] *= (1 - ao_strength) + ao_strength * a
    final = bpy.data.images.new(f'{name}_albedo', tex, tex, alpha=False)
    final.pixels.foreach_set(c.ravel())
    for k in ('color', 'ao'):
        nt.nodes.remove(nodes[k])
        bpy.data.images.remove(imgs[k])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = final
    nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nodes['normal'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = roughness
    # pack baked images into the .blend data so the glTF exporter embeds them
    for img in (final, nodes['normal'].image):
        img.pack()
    for h in his:
        bpy.data.objects.remove(h)
    bpy.data.materials.remove(hm)
    lo.visible_camera = lo.visible_diffuse = lo.visible_glossy = lo.visible_shadow = True
    lo.visible_transmission = lo.visible_volume_scatter = True
    return lo


def split(ob, predicate, name):
    """Move faces whose centre (game frame) satisfies predicate into a new object."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    sel = []
    for face in bm.faces:
        c = face.calc_center_median()
        if predicate(np.array([c.x, c.z, -c.y])):
            sel.append(face)
    if not sel:
        bm.free()
        return None
    me2 = ob.data.copy()
    ob2 = bpy.data.objects.new(name, me2)
    bpy.context.scene.collection.objects.link(ob2)
    keep_idx = {f.index for f in sel}
    bmesh.ops.delete(bm, geom=sel, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    bm2 = bmesh.new()
    bm2.from_mesh(me2)
    bm2.faces.ensure_lookup_table()
    rest = [f for f in bm2.faces if f.index not in keep_idx]
    bmesh.ops.delete(bm2, geom=rest, context='FACES')
    bm2.to_mesh(me2)
    bm2.free()
    return ob2
