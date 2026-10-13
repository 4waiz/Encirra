"""
Assemble the whole district from packages/shared/generated/city-layout.json using the kit
(.blend sources saved by build_kit.py), add simple roads/blocks, the mains from
district.json and the skyline, save an editable assembled .blend and render dusk previews.

Usage (from the repo root, after build_kit.py):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --factory-startup \
      --python assets/blender/build_district_preview.py -- [--res 1920x1080] [--samples 64] [--no-save]
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common  # noqa: E402
import render_preview as pv  # noqa: E402

REPO = common.REPO
KIT_FILES = ["kit_buildings.blend", "kit_props.blend", "kit_base.blend", "kit_facilities.blend",
             "kit_skyline.blend", "kit_underground.blend"]
FACILITY_NODE = {"ps-1": "pump-station_v0", "ps-2": "pump-station_v1", "tank-t1": "water-tower_v0", "tank-t2": "water-tower_v1"}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", default="1920x1080")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--no-save", action="store_true")
    ap.add_argument("--views", default="hero,cutaway,overview,street")
    return ap.parse_args(argv)


def load_kit():
    """Append every object from the kit .blend files into a hidden library collection."""
    lib = bpy.data.collections.new("_kit_library")
    bpy.context.scene.collection.children.link(lib)
    for f in KIT_FILES:
        path = os.path.join(HERE, f)
        if not os.path.exists(path):
            print("missing kit file", f)
            continue
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [n for n in src.objects]
        for ob in dst.objects:
            if ob is not None:
                lib.objects.link(ob)
    lib.hide_render = True
    lib.hide_viewport = True
    return {o.name: o for o in lib.objects}


def merge_duplicate_materials():
    """Appending several kit files duplicates contract materials as 'facade.001' etc.;
    remap every duplicate onto the base material so preview shading applies everywhere."""
    import re
    for m in list(bpy.data.materials):
        mm = re.match(r"^(.*)\.\d{3}$", m.name)
        if mm and mm.group(1) in common.MATERIALS:
            base = bpy.data.materials.get(mm.group(1))
            if base is not None and base != m:
                m.user_remap(base)
                bpy.data.materials.remove(m)


def instance(src, name, coll, loc, rot_z=0.0, scale=(1, 1, 1)):
    ob = bpy.data.objects.new(name, src.data)
    coll.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0.0, 0.0, rot_z)
    ob.scale = scale
    for ch in src.children:
        c = bpy.data.objects.new(name + "_" + ch.name, ch.data)
        coll.objects.link(c)
        c.parent = ob
        c.location = ch.location
        c.rotation_euler = ch.rotation_euler
        c.scale = ch.scale
    return ob


def emissive_material(name, color, strength):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    b.inputs["Roughness"].default_value = 0.3
    return m


def simple_material(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def mesh_object(name, coll, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def build_ground(layout, coll):
    """Roads (asphalt), block paving and planted verges; Blender coords (x, -z)."""
    mb = common.MeshBuilder()
    P = layout["platform"]
    for r in layout["roads"]:
        (x0, z0), (x1, z1) = r["points"][0], r["points"][-1]
        w = r["width"]
        if abs(z0 - z1) < 1e-6:   # avenue along x
            mb.box(min(x0, x1), -z0 - w / 2, 0.0, max(x0, x1), -z0 + w / 2, 0.05, "asphalt", skip=("bottom",))
            for k in range(int((max(x0, x1) - min(x0, x1)) / 9)):
                xa = min(x0, x1) + k * 9 + 2
                mb.box(xa, -z0 - 0.12, 0.05, xa + 4.0, -z0 + 0.12, 0.06, "facade", skip=("bottom",))
        else:
            mb.box(x0 - w / 2, -max(z0, z1), 0.0, x0 + w / 2, -min(z0, z1), 0.045, "asphalt", skip=("bottom",))
            for k in range(int((max(z0, z1) - min(z0, z1)) / 9)):
                za = min(z0, z1) + k * 9 + 2
                mb.box(x0 - 0.12, -za - 4.0, 0.045, x0 + 0.12, -za, 0.055, "facade", skip=("bottom",))
    for b in layout["blocks"]:
        x0, x1, z0, z1 = b["minX"], b["maxX"], b["minZ"], b["maxZ"]
        # kerb + sidewalk ring (paving) and inner planted/paved lot
        mb.box(x0, -z1, 0.0, x1, -z0, 0.18, "concrete", c=0.05, skip=("bottom",))
        mb.box(x0 + 3.0, -z1 + 3.0, 0.18, x1 - 3.0, -z0 - 3.0, 0.2, "facade_alt", skip=("bottom",))
    ob = common.build_object(mb, "district_ground", coll)
    return ob


def build_pipes(district, coll):
    """Exaggerated mains along district.json routes (preview stand-in for the scene's pipes)."""
    mat_t = emissive_material("_pv_pipe_glow", (0.15, 0.75, 1.0), 6.0)
    mat_s = emissive_material("_pv_pipe_glow2", (0.1, 0.55, 1.0), 5.0)
    obs = []
    for p in district["water"]["pipes"]:
        if p["kind"] not in ("transmission", "suction", "riser"):
            continue
        pts = [Vector((q[0], -q[2], q[1])) for q in p["route"]]
        r = 0.9 if p["kind"] != "riser" else 0.7
        mb = common.MeshBuilder()
        import parts
        path = parts.rounded_path(pts, 3.0, steps=6)
        mb.tube(path, r, "pipe", seg=18, caps=True)
        ob = common.build_object(mb, "pipe_" + p["id"], coll)
        ob.data.materials[0] = mat_s if p["kind"] == "suction" else mat_t
        obs.append(ob)
    return obs


def build_sea(coll):
    m = simple_material("_pv_sea", (0.02, 0.07, 0.09), rough=0.08, metal=0.0)
    s = 6000.0
    return mesh_object("_pv_sea", coll, [(-s, -s, -60.0), (s, -s, -60.0), (s, s, -60.0), (-s, s, -60.0)], [(0, 1, 2, 3)], m)


def build_far_city(coll, seed=7):
    """Low-poly distant blocks on a coastal plate beyond the platform (preview only)."""
    r = common.rnd(seed)
    mb = common.MeshBuilder()
    mb.box(-4000.0, 650.0, -60.0, 4000.0, 4000.0, -2.0, "asphalt", skip=("bottom",))
    mb.glazing_uv = lambda p, n: ((p.x if abs(n.y) > abs(n.x) else p.y) / 3.0, p.z / 3.4)
    for i in range(1400):
        x = r.uniform(-3200, 3200)
        y = r.uniform(700, 3200)
        w = r.uniform(16, 34)
        d = r.uniform(16, 34)
        h = r.choice([10, 14, 18, 24, 30, 36, 48, 60]) * r.uniform(0.8, 1.2)
        mb.box(x - w / 2, y - d / 2, -2.0, x + w / 2, y + d / 2, h, "facade" if r.random() < 0.6 else "facade_alt",
               mats={"front": "glazing", "back": "glazing", "left": "glazing", "right": "glazing", "top": "roof"})
    return common.build_object(mb, "_pv_far_city", coll)


def setup_compositor_bloom():
    sc = bpy.context.scene
    try:
        tree = bpy.data.node_groups.new("_pv_comp", "CompositorNodeTree")
        rl = tree.nodes.new("CompositorNodeRLayers")
        gl = tree.nodes.new("CompositorNodeGlare")
        out = tree.nodes.new("NodeGroupOutput")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        for name, val in (("Type", "Bloom"), ("Quality", "High"), ("Threshold", 1.0), ("Strength", 0.4),
                          ("Size", 0.7), ("Saturation", 1.0)):
            if name in gl.inputs:
                try:
                    gl.inputs[name].default_value = val
                except Exception as e:
                    print("glare input", name, e)
        tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
        tree.links.new(gl.outputs["Image"], out.inputs[0])
        sc.compositing_node_group = tree
        sc.render.use_compositing = True
        print("compositor bloom enabled")
    except Exception as e:
        print("compositor setup skipped:", e)


def set_camera(loc, target, lens=35.0):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cd = bpy.data.cameras.new("_pv_cam")
        cam = bpy.data.objects.new("_pv_cam", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.data.clip_start = 1.0
    cam.data.clip_end = 20000.0
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def main():
    args = parse_args()
    res = tuple(int(v) for v in args.res.split("x"))
    common.reset_scene()
    with open(os.path.join(REPO, "packages", "shared", "generated", "city-layout.json"), encoding="utf-8") as fh:
        layout = json.load(fh)
    with open(os.path.join(REPO, "packages", "shared", "config", "district.json"), encoding="utf-8") as fh:
        district = json.load(fh)
    kit = load_kit()
    merge_duplicate_materials()
    common.ensure_all_materials()
    city = common.new_collection("DISTRICT")
    sky = common.new_collection("SKYLINE")
    env = common.new_collection("ENV")
    # nominal sizes from the sidecars
    nominal = {}
    for f in os.listdir(os.path.join(HERE, "manifest")):
        if f.endswith(".json") and not f.startswith("_"):
            with open(os.path.join(HERE, "manifest", f), encoding="utf-8") as fh:
                for a in json.load(fh)["assets"]:
                    nominal[a["node"]] = a
    # base
    instance(kit["district-base"], "district-base", city, (0, 0, 0))
    build_ground(layout, city)
    # buildings
    kit_kinds = {"tower-residential", "tower-office", "midrise-residential", "lowrise-residential", "villa", "commercial-podium"}
    n = 0
    for b in layout["buildings"]:
        node = FACILITY_NODE.get(b.get("facilityId") or "", "%s_v%d" % (b["kind"], b["variant"]))
        src = kit.get(node)
        if src is None:
            print("no asset for", b["id"], node)
            continue
        x, z = b["pos"]
        if b["kind"] in kit_kinds:
            a = nominal[node]
            W, D, H = a["nominalSize"]
            sc = (b["size"][0] / W, b["size"][1] / D, b["height"] / H)
        else:
            sc = (1.0, 1.0, 1.0)
        ob = instance(src, b["id"], city, (x, -z, 0.0), b["rot"], sc)
        n += 1
        if b.get("roofSolar") and b["kind"] in kit_kinds:
            a = nominal[node]
            ry = a["anchors"]["roofY"] * sc[2]
            sol = kit["solar-array_v0"]
            s = instance(sol, b["id"] + "_pv", city, (0, 0, 0))
            s.parent = ob
            s.location = (0.0, -1.0, a["anchors"]["roofY"])
            s.scale = (0.85 / sc[0], 0.85 / sc[1], 1.0 / sc[2])
    print("placed", n, "buildings")
    # palms and streetlights
    palms = [kit["palm_v0"], kit["palm_v1"], kit["palm_v2"]]
    for i, (x, z, s, rot) in enumerate(layout["props"]["palms"]):
        src = palms[(i * 7 + int(abs(x))) % 3]
        instance(src, "palm_%03d" % i, city, (x, -z, 0.18), rot, (s, s, s))
    for i, (x, z, rot) in enumerate(layout["props"]["streetLights"]):
        instance(kit["streetlight_v0"], "light_%03d" % i, city, (x, -z, 0.0), rot)
    # mains (preview stand-ins)
    build_pipes(district, city)
    # skyline (nodes carry their placement)
    for name, ob in kit.items():
        if name.startswith("skyline_"):
            loc = ob.location.copy()
            loc.z = -59.0   # background city stands on the coast at sea level, below the floating block
            instance(ob, name, sky, loc, ob.rotation_euler.z)
    build_sea(env)
    land = simple_material("_pv_land", (0.16, 0.13, 0.11), rough=0.9)
    mesh_object("_pv_land", env, [(-5000.0, 520.0, -59.2), (5000.0, 520.0, -59.2), (5000.0, 5000.0, -59.2), (-5000.0, 5000.0, -59.2)], [(0, 1, 2, 3)], land)
    if not args.no_save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "district_assembled.blend"), compress=True)
    # ---- previews ----
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.data.color_attributes.get("AO") is None:
            ca = o.data.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
            ca.data.foreach_set("color", [1.0] * (len(ca.data) * 4))
    pv.apply_preview_materials()
    sun_dir = (-0.78, -0.52, 0.14)
    pv.setup_dusk_world(0.5, sun_dir)
    pv.add_lights(sun_dir, 8.0)
    pv.setup_render(res, args.samples)
    bpy.context.scene.view_settings.exposure = 0.45
    setup_compositor_bloom()
    prev = os.path.join(HERE, "previews")
    views = args.views.split(",")
    if "hero" in views:
        set_camera((150.0, -820.0, 230.0), (-30.0, 200.0, 70.0), 30.0)
        pv.render_to(os.path.join(prev, "district_dusk.jpg"))
    if "cutaway" in views:
        set_camera((-95.0, -238.0, -2.0), (-175.0, -150.0, -18.0), 30.0)
        pv.render_to(os.path.join(prev, "district_cutaway.jpg"))
    if "overview" in views:
        set_camera((0.0, -260.0, 700.0), (0.0, -20.0, 0.0), 28.0)
        pv.render_to(os.path.join(prev, "district_overview.jpg"))
    if "street" in views:
        set_camera((-36.0, -82.0, 9.0), (-82.0, 4.0, 16.0), 26.0)
        pv.render_to(os.path.join(prev, "district_street.jpg"))
    print("DISTRICT_PREVIEW_DONE")


if __name__ == "__main__":
    main()
