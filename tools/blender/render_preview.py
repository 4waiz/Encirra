"""
Headless preview render of the generated campus (sanity check for proportions and composition).

    blender --background assets-src/encirra-facility.blend --python tools/blender/render_preview.py -- <out.png> [view]
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "//preview.png"
VIEW = argv[1] if len(argv) > 1 else "hero"


def W(x, y, z):
    return Vector((x, -z, y))


def principled(mat, rgba):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.9


sc = bpy.context.scene
for name in ("preview_sand", "preview_sea"):
    m = bpy.data.materials.get(name)
    if m:
        principled(m, tuple(m.diffuse_color))

views = {
    "hero": ((-1150.0, 620.0, -1250.0), (40.0, 0.0, -20.0), 30.0),
    "units": ((-420.0, 160.0, -520.0), (60.0, 20.0, -90.0), 38.0),
    "top": ((0.0, 1800.0, 0.1), (0.0, 0.0, 0.0), 40.0),
    "closeup": ((404.0, 5.0, 246.0), (424.0, 1.2, 230.0), 50.0),
}
pos, target, fov = views.get(VIEW, views["hero"])
cam_data = bpy.data.cameras.new("PreviewCam")
cam_data.lens_unit = "FOV"
cam_data.angle = math.radians(fov)
cam_data.clip_start = 1.0
cam_data.clip_end = 8000.0
cam = bpy.data.objects.new("PreviewCam", cam_data)
sc.collection.objects.link(cam)
cam.location = W(*pos)
d = W(*target) - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
sc.camera = cam

sun_data = bpy.data.lights.new("PreviewSun", "SUN")
sun_data.energy = 4.0
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("PreviewSun", sun_data)
sc.collection.objects.link(sun)
az, el = math.radians(240.0), math.radians(36.0)
sun_dir = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
sun.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()

world = sc.world or bpy.data.worlds.new("PreviewWorld")
sc.world = world
bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
if bg:
    bg.inputs[0].default_value = (0.55, 0.68, 0.82, 1.0)
    bg.inputs[1].default_value = 0.9

sc.render.resolution_x = 1600
sc.render.resolution_y = 900
sc.render.film_transparent = False
sc.render.filepath = OUT
engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        continue
print("engine", sc.render.engine)
try:
    sc.eevee.taa_render_samples = 16
except Exception:
    pass
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
