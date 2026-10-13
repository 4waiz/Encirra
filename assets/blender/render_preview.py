"""
EEVEE dusk preview rendering for the asset kit.

Preview-only shading lives here: after the GLBs are exported, `apply_preview_materials`
upgrades the contract materials (e.g. the glazing gets a lit-window pattern driven by
the storey/bay UV0 encoding) so previews show roughly what the scene's shaders do.
"""

import math
import bpy
from mathutils import Vector

from common import hex_to_lin, get_material


def _nodes(mat):
    return mat.node_tree.nodes, mat.node_tree.links


def _principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _math(nodes, op, a=None, b=None, links=None, va=0.0, vb=0.0):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    for i, src in enumerate((a, b)):
        if src is None:
            n.inputs[i].default_value = (va, vb)[i]
        elif isinstance(src, (int, float)):
            n.inputs[i].default_value = float(src)
        else:
            links.new(src, n.inputs[i])
    return n.outputs[0]


def setup_render(res=(1600, 900), samples=48):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    ee = sc.eevee
    for attr, val in (("taa_render_samples", samples), ("use_shadows", True), ("use_raytracing", True),
                      ("shadow_ray_count", 2), ("shadow_step_count", 8), ("use_fast_gi", True),
                      ("fast_gi_distance", 6.0), ("shadow_resolution_scale", 1.0)):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    try:
        ee.ray_tracing_method = "SCREEN"
    except Exception:
        pass
    for vt in ("AgX", "Filmic"):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "None"):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            continue
    sc.view_settings.exposure = 0.0


def setup_dusk_world(strength=0.85, sun_dir=(-0.62, -0.76, 0.2)):
    sc = bpy.context.scene
    w = bpy.data.worlds.get("Dusk") or bpy.data.worlds.new("Dusk")
    sc.world = w
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    L = nt.links
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Generated"], sep.inputs[0])
    remap = nt.nodes.new("ShaderNodeMath")
    remap.operation = "MULTIPLY_ADD"
    L.new(sep.outputs["Z"], remap.inputs[0])
    remap.inputs[1].default_value = 0.5
    remap.inputs[2].default_value = 0.5
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    stops = [(0.0, (0.07, 0.06, 0.055)), (0.488, (0.26, 0.21, 0.17)), (0.5, (1.0, 0.63, 0.37)),
             (0.515, (0.96, 0.68, 0.50)), (0.56, (0.66, 0.62, 0.66)), (0.66, (0.33, 0.41, 0.60)),
             (0.9, (0.10, 0.15, 0.33))]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*col, 1)
    L.new(remap.outputs[0], ramp.inputs[0])
    # sun glow
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(tc.outputs["Generated"], dot.inputs[0])
    sd = Vector(sun_dir).normalized()
    dot.inputs[1].default_value = (sd.x, sd.y, sd.z)
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.use_clamp = True
    L.new(dot.outputs["Value"], pw.inputs[0])
    pw.inputs[1].default_value = 24.0
    glow = nt.nodes.new("ShaderNodeMix")
    glow.data_type = "RGBA"
    glow.blend_type = "ADD"
    L.new(pw.outputs[0], glow.inputs["Factor"])
    L.new(ramp.outputs["Color"], glow.inputs[6])
    glow.inputs[7].default_value = (1.6, 0.75, 0.32, 1)
    L.new(glow.outputs[2], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    L.new(bg.outputs[0], out.inputs[0])
    return w


def add_lights(sun_dir=(-0.62, -0.76, 0.2), strength=4.8):
    sc = bpy.context.scene
    for ob in [o for o in sc.objects if o.name.startswith("_pv_light")]:
        bpy.data.objects.remove(ob, do_unlink=True)
    sd = Vector(sun_dir).normalized()
    sun = bpy.data.lights.new("_pv_light_sun", "SUN")
    sun.energy = strength
    sun.color = (1.0, 0.70, 0.46)
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new("_pv_light_sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (-sd).to_track_quat("-Z", "Y").to_euler()
    fill = bpy.data.lights.new("_pv_light_fill", "SUN")
    fill.energy = 0.35
    fill.color = (0.55, 0.62, 1.0)
    fill.angle = math.radians(20)
    fo = bpy.data.objects.new("_pv_light_fill", fill)
    sc.collection.objects.link(fo)
    fo.rotation_euler = Vector((0.5, 0.7, -0.5)).to_track_quat("-Z", "Y").to_euler()
    return so


def glazing_preview(mat):
    nodes, links = _nodes(mat)
    bsdf = _principled(mat)
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv.outputs[0], sep.inputs[0])
    u, v = sep.outputs[0], sep.outputs[1]
    fu = _math(nodes, "FRACT", u, links=links)
    fv = _math(nodes, "FRACT", v, links=links)
    flu = _math(nodes, "FLOOR", u, links=links)
    flv = _math(nodes, "FLOOR", v, links=links)
    oi = nodes.new("ShaderNodeObjectInfo")
    seed = _math(nodes, "MULTIPLY", oi.outputs["Random"], 97.0, links=links)
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(flu, comb.inputs[0])
    links.new(flv, comb.inputs[1])
    links.new(seed, comb.inputs[2])
    wn = nodes.new("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    links.new(comb.outputs[0], wn.inputs["Vector"])
    sc2 = nodes.new("ShaderNodeVectorMath")
    sc2.operation = "SCALE"
    links.new(comb.outputs[0], sc2.inputs[0])
    sc2.inputs["Scale"].default_value = 1.731
    wn2 = nodes.new("ShaderNodeTexWhiteNoise")
    wn2.noise_dimensions = "3D"
    links.new(sc2.outputs[0], wn2.inputs["Vector"])
    r1 = wn.outputs["Value"]
    r2 = wn2.outputs["Value"]
    inx = _math(nodes, "MULTIPLY", _math(nodes, "GREATER_THAN", fu, 0.06, links=links), _math(nodes, "LESS_THAN", fu, 0.94, links=links), links=links)
    iny = _math(nodes, "MULTIPLY", _math(nodes, "GREATER_THAN", fv, 0.10, links=links), _math(nodes, "LESS_THAN", fv, 0.90, links=links), links=links)
    mask = _math(nodes, "MULTIPLY", inx, iny, links=links)
    lit = _math(nodes, "MULTIPLY", _math(nodes, "GREATER_THAN", r1, 0.52, links=links), mask, links=links)
    level = _math(nodes, "ADD", _math(nodes, "MULTIPLY", r2, 5.0, links=links), 1.8, links=links)
    strength = _math(nodes, "MULTIPLY", lit, level, links=links)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    links.new(r2, mix.inputs["Factor"])
    mix.inputs[6].default_value = (1.0, 0.62, 0.30, 1)
    mix.inputs[7].default_value = (1.0, 0.86, 0.64, 1)
    links.new(mix.outputs[2], bsdf.inputs["Emission Color"])
    links.new(strength, bsdf.inputs["Emission Strength"])
    # glass vs frame
    base = nodes.new("ShaderNodeMix")
    base.data_type = "RGBA"
    links.new(mask, base.inputs["Factor"])
    base.inputs[6].default_value = (0.06, 0.06, 0.065, 1)
    base.inputs[7].default_value = (0.03, 0.045, 0.06, 1)
    links.new(base.outputs[2], bsdf.inputs["Base Color"])
    rough = _math(nodes, "SUBTRACT", 0.45, _math(nodes, "MULTIPLY", mask, 0.38, links=links), links=links)
    links.new(rough, bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.7


def ao_multiply(mat):
    """Multiply the base colour by the baked COLOR_0 ('AO') like three.js vertexColors does."""
    nodes, links = _nodes(mat)
    bsdf = _principled(mat)
    if any(n.type == "VERTEX_COLOR" for n in nodes):
        return
    vc = nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "AO"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    sock = bsdf.inputs["Base Color"]
    if sock.is_linked:
        links.new(sock.links[0].from_socket, mix.inputs[6])
    else:
        mix.inputs[6].default_value = sock.default_value
    links.new(vc.outputs["Color"], mix.inputs[7])
    links.new(mix.outputs[2], sock)


def apply_preview_materials():
    from common import MATERIALS
    for name in MATERIALS:
        if name in ("glazing", "light_emissive", "emissive_sign", "glass_clear", "water"):
            continue
        ao_multiply(get_material(name))
    g = get_material("glazing")
    glazing_preview(g)
    for name, k in (("light_emissive", 14.0), ("emissive_sign", 9.0), ("water", 2.0)):
        m = get_material(name)
        b = _principled(m)
        b.inputs["Emission Strength"].default_value = k


def preview_ground(size=4000.0, z=-0.02, color=(0.25, 0.24, 0.225)):
    m = bpy.data.materials.get("_pv_ground") or bpy.data.materials.new("_pv_ground")
    b = _principled(m)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.8
    me = bpy.data.meshes.new("_pv_ground")
    s = size / 2
    me.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    me.materials.append(m)
    ob = bpy.data.objects.new("_pv_ground", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def frame_camera(lo, hi, azim_deg=32.0, elev_deg=24.0, lens=50.0, margin=1.08, target_z_bias=0.0):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cd = bpy.data.cameras.new("_pv_cam")
        cam = bpy.data.objects.new("_pv_cam", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.data.sensor_width = 36.0
    cam.data.clip_start = 0.5
    cam.data.clip_end = 20000.0
    az, el = math.radians(azim_deg), math.radians(elev_deg)
    back = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    f = -back
    c = (lo + hi) / 2
    c.z += target_z_bias * (hi.z - lo.z)
    right = f.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(f).normalized()
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    th = math.tan(math.atan(18.0 / lens))
    tv = th * ry / rx
    dist = 0.0
    for x in (lo.x, hi.x):
        for y in (lo.y, hi.y):
            for z in (lo.z, hi.z):
                p = Vector((x, y, z)) - c
                px, py, pz = p.dot(right), p.dot(up), p.dot(f)
                dist = max(dist, abs(px) / th - pz, abs(py) / tv - pz)
    dist *= margin
    cam.location = c - f * dist
    cam.rotation_euler = f.to_track_quat("-Z", "Y").to_euler()
    return cam


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def lineup(objs, gap=6.0, axis="x"):
    """Lay objects out side by side (for previews); returns a restore callback."""
    saved = [(o, o.location.copy()) for o in objs]
    x = 0.0
    widths = []
    for o in objs:
        lo, hi = world_bbox([o])
        widths.append((lo, hi))
    total = sum((hi.x - lo.x) for lo, hi in widths) + gap * (len(objs) - 1)
    x = -total / 2
    for o, (lo, hi) in zip(objs, widths):
        w = hi.x - lo.x
        o.location.x += (x + w / 2) - (lo.x + hi.x) / 2
        x += w + gap
    bpy.context.view_layer.update()

    def restore():
        for o, loc in saved:
            o.location = loc
        bpy.context.view_layer.update()
    return restore


def isolate_render(objs):
    """Hide everything except objs (and their children), preview lights and ground."""
    keep = set()

    def rec(o):
        keep.add(o.name)
        for c in o.children:
            rec(c)
    for o in objs:
        rec(o)
    saved = {}
    for o in bpy.context.scene.objects:
        saved[o.name] = o.hide_render
        if o.name.startswith("_pv_"):
            o.hide_render = False
        else:
            o.hide_render = o.name not in keep

    def restore():
        for o in bpy.context.scene.objects:
            if o.name in saved:
                o.hide_render = saved[o.name]
    return restore


def preview_lineup(objs, path, res=(1600, 900), azim=30.0, elev=22.0, gap=6.0, lens=50.0, margin=1.06, samples=48):
    setup_render(res, samples)
    restore_pos = lineup(objs, gap)
    restore_vis = isolate_render(objs)
    try:
        lo, hi = world_bbox([c for o in objs for c in [o] + list(o.children_recursive)])
        frame_camera(lo, hi, azim, elev, lens, margin)
        render_to(path)
    finally:
        restore_vis()
        restore_pos()


def ensure_preview_env():
    sc = bpy.context.scene
    setup_dusk_world()
    add_lights()
    if "_pv_ground" not in sc.objects:
        preview_ground()
