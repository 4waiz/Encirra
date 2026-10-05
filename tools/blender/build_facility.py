"""
ENCIRRA - Blender build script for the generalized coastal energy campus.

Run inside Blender (Text Editor, or through the Blender MCP bridge):

    ENCIRRA_ROOT = r"C:\\path\\to\\Encirra"
    exec(open(ENCIRRA_ROOT + r"\\tools\\blender\\build_facility.py", encoding="utf-8").read())

Everything is built procedurally from ``src/data/site-layout.json`` inside a dedicated scene
("ENCIRRA_Facility") so the user's own scenes are never touched. Geometry is merged per material
(few draw calls, shared materials) and exported as separate GLB modules to ``public/models``.

The layout is fictional and generalized. It is artistically inspired by a four-unit coastal
energy campus and is NOT a replica of any real facility.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = globals().get("ENCIRRA_ROOT") or r"C:\Users\awaiz\OneDrive\Desktop\Github\Encirra"
with open(os.path.join(ROOT, "src", "data", "site-layout.json"), encoding="utf-8") as fh:
    LAYOUT = json.load(fh)
OUT_DIR = os.path.join(ROOT, "public", "models")
SRC_DIR = os.path.join(ROOT, "assets-src")
SCENE_NAME = "ENCIRRA_Facility"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(SRC_DIR, exist_ok=True)

RNG = random.Random(20261005)


# --------------------------------------------------------------------------- coordinates
def W(x, y, z):
    """App/world space (x east, y up, z south) -> Blender space (x east, y north, z up)."""
    return Vector((x, -z, y))


# --------------------------------------------------------------------------- materials
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hexcol):
    h = hexcol.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


# name: (base colour, roughness, metallic, double sided, emission colour, emission strength)
MAT_DEFS = {
    "dome_white": ("#E8E7E2", 0.46, 0.06),
    "concrete_white": ("#E1DED7", 0.86, 0.0),
    "concrete_light": ("#D0CBC1", 0.9, 0.0),
    "concrete_warm": ("#C6BCAA", 0.92, 0.0),
    "concrete_dark": ("#8E8A83", 0.92, 0.0),
    "cladding": ("#C3C7CB", 0.6, 0.3),
    "roof_metal": ("#CBCFD3", 0.5, 0.45),
    "roof_dark": ("#7F868D", 0.66, 0.3),
    "accent_blue": ("#56728A", 0.6, 0.2),
    "glass": ("#27333E", 0.14, 0.65),
    "steel": ("#8F969D", 0.42, 0.85),
    "steel_dark": ("#3E444B", 0.55, 0.6),
    "crane_black": ("#24282D", 0.5, 0.5),
    "pylon_red": ("#B53A2F", 0.6, 0.3),
    "pylon_white": ("#E3E3E0", 0.6, 0.3),
    "transformer": ("#6B776C", 0.55, 0.45),
    "ceramic": ("#9E8C7B", 0.35, 0.0),
    "tank_white": ("#EEEDEA", 0.5, 0.2),
    "rock": ("#918878", 0.95, 0.0),
    "hvac": ("#ACB2B7", 0.52, 0.45),
    "palm_trunk": ("#7B6A55", 0.95, 0.0),
    "palm_leaf": ("#5B7140", 0.85, 0.0, True),
    "car_white": ("#E6E7E5", 0.32, 0.45),
    "car_silver": ("#A6ABB0", 0.32, 0.65),
    "car_dark": ("#30353B", 0.32, 0.55),
    "car_blue": ("#3E5A77", 0.32, 0.5),
    "container_blue": ("#3F5D7A", 0.68, 0.4),
    "container_rust": ("#8A4632", 0.68, 0.4),
    "container_white": ("#D8D6D0", 0.68, 0.4),
    "container_gray": ("#7B8187", 0.68, 0.4),
    "nav_light_red": ("#C2322A", 0.4, 0.0, False, "#FF3B30", 4.0),
    "nav_light_green": ("#2E9E57", 0.4, 0.0, False, "#30D158", 4.0),
    "ugv_graphite": ("#2A2F35", 0.45, 0.55),
    "ugv_panel": ("#E3E5E7", 0.4, 0.2),
    "ugv_accent": ("#E8822A", 0.45, 0.2),
    "tyre": ("#1B1D20", 0.85, 0.0),
    "lens": ("#0E1318", 0.08, 0.8),
    "beacon_amber": ("#E39A2B", 0.3, 0.0, False, "#FFB13B", 6.0),
    "uav_body": ("#2B3036", 0.4, 0.5),
    "uav_light": ("#E8ECEF", 0.4, 0.2),
    "rotor": ("#121417", 0.5, 0.2, True),
    "sensor_white": ("#E6E8EA", 0.45, 0.15),
    "solar": ("#1D2A3A", 0.15, 0.6),
    "vehicle_red": ("#B02A22", 0.42, 0.25),
    "vehicle_white": ("#ECECEA", 0.42, 0.2),
    "lightbar": ("#D93A3A", 0.3, 0.0, False, "#FF4A3D", 5.0),
    "coverall": ("#2E3A50", 0.85, 0.0),
    "hivis": ("#C9D63F", 0.7, 0.0),
    "helmet": ("#F1F1EE", 0.4, 0.0),
    "skin": ("#B98663", 0.7, 0.0),
}

_MATS = {}


def M(name):
    if name in _MATS:
        return _MATS[name]
    d = MAT_DEFS[name]
    hexcol, rough, metal = d[0], d[1], d[2]
    double = d[3] if len(d) > 3 else False
    emit = d[4] if len(d) > 4 else None
    emit_strength = d[5] if len(d) > 5 else 0.0
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = rgba(hexcol)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        sock = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if sock is not None:
            sock.default_value = rgba(emit)
        st = bsdf.inputs.get("Emission Strength")
        if st is not None:
            st.default_value = emit_strength
    mat.diffuse_color = rgba(hexcol)
    mat.roughness = rough
    mat.metallic = metal
    mat.use_backface_culling = not double
    _MATS[name] = mat
    return mat


# --------------------------------------------------------------------------- geometry groups
SHARP_DEG = {"rock": 0.0, "palm_leaf": 85.0, "dome_white": 40.0}


class Group:
    """Accumulates geometry per material; each material becomes one mesh object on build."""

    def __init__(self, name):
        self.name = name
        self.bms = {}

    def bm(self, mat):
        b = self.bms.get(mat)
        if b is None:
            b = bmesh.new()
            self.bms[mat] = b
        return b

    def build(self, collection):
        objs = []
        for mat, b in self.bms.items():
            thr = math.radians(SHARP_DEG.get(mat, 34.0))
            for f in b.faces:
                f.smooth = True
            for e in b.edges:
                if not e.is_manifold:
                    e.smooth = False
                    continue
                if thr <= 0.0 or e.calc_face_angle(math.pi) > thr:
                    e.smooth = False
            me = bpy.data.meshes.new(f"{self.name}__{mat}")
            b.to_mesh(me)
            b.free()
            me.materials.append(M(mat))
            ob = bpy.data.objects.new(f"{self.name}__{mat}", me)
            collection.objects.link(ob)
            objs.append(ob)
        self.bms = {}
        return objs


def frame_from_dir(d):
    z = d.normalized()
    up = Vector((0.0, 0.0, 1.0)) if abs(z.z) < 0.95 else Vector((1.0, 0.0, 0.0))
    x = up.cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


def box(g, mat, cx, cy, cz, sx, sy, sz, yaw=0.0, bevel=0.0):
    """Axis box centred at app coords (cx, cy, cz); sx along x, sy height, sz along z."""
    b = g.bm(mat)
    mtx = Matrix.Translation(W(cx, cy, cz)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((sx, sz, sy, 1.0))
    res = bmesh.ops.create_cube(b, size=1.0, matrix=mtx)
    if bevel > 0.0:
        vs = res["verts"]
        es = list({e for v in vs for e in v.link_edges})
        off = min(bevel, 0.4 * min(sx, sy, sz))
        bmesh.ops.bevel(b, geom=es, offset=off, offset_type="OFFSET", segments=1, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return res


def box_mm(g, mat, x0, x1, y0, y1, z0, z1, bevel=0.0):
    return box(g, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, abs(x1 - x0), abs(y1 - y0), abs(z1 - z0), 0.0, bevel)


def beam(g, mat, p0, p1, t, t2=None):
    a, c = W(*p0), W(*p1)
    d = c - a
    length = d.length
    if length < 1e-5:
        return
    mtx = Matrix.Translation((a + c) / 2) @ frame_from_dir(d) @ Matrix.Diagonal((t, t if t2 is None else t2, length, 1.0))
    bmesh.ops.create_cube(g.bm(mat), size=1.0, matrix=mtx)


def cyl(g, mat, p0, p1, r, segs=12, r2=None, caps=True):
    a, c = W(*p0), W(*p1)
    d = c - a
    length = d.length
    if length < 1e-5:
        return
    mtx = Matrix.Translation((a + c) / 2) @ frame_from_dir(d)
    bmesh.ops.create_cone(g.bm(mat), cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                          radius2=(r if r2 is None else r2), depth=length, matrix=mtx)


def sphere(g, mat, c, r, u=16, v=8):
    bmesh.ops.create_uvsphere(g.bm(mat), u_segments=u, v_segments=v, radius=r, matrix=Matrix.Translation(W(*c)))


def lathe(g, mat, cx, cz, prof, segs=48, y0=0.0, cap_top=True, cap_bottom=False):
    """Surface of revolution around the vertical axis through (cx, cz). prof = [(radius, y), ...] bottom->top."""
    b = g.bm(mat)
    rings = []
    for (r, y) in prof:
        if r <= 1e-5:
            rings.append([b.verts.new(W(cx, y0 + y, cz))])
        else:
            rings.append([b.verts.new(W(cx + r * math.cos(2 * math.pi * i / segs), y0 + y,
                                        cz + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(B) == 1:
                b.faces.new((A[i], B[0], A[j]))
            elif len(A) == 1:
                b.faces.new((A[0], B[i], B[j]))
            else:
                b.faces.new((A[i], B[i], B[j], A[j]))
    if cap_top and len(rings[-1]) > 1:
        b.faces.new(list(reversed(rings[-1])))
    if cap_bottom and len(rings[0]) > 1:
        b.faces.new(rings[0])


def gable(g, mat, cx, cz, sx, sz, y_eave, rise, along="z", overhang=0.6):
    b = g.bm(mat)
    hx, hz = sx / 2 + overhang, sz / 2 + overhang
    ye, yr = y_eave, y_eave + rise
    if along == "z":
        pts = [(-hx, ye, -hz), (hx, ye, -hz), (0, yr, -hz), (-hx, ye, hz), (hx, ye, hz), (0, yr, hz)]
    else:
        pts = [(-hx, ye, -hz), (-hx, ye, hz), (-hx, yr, 0), (hx, ye, -hz), (hx, ye, hz), (hx, yr, 0)]
    v = [b.verts.new(W(cx + p[0], p[1], cz + p[2])) for p in pts]
    faces = [(v[0], v[1], v[2]), (v[3], v[5], v[4]), (v[0], v[2], v[5], v[3]), (v[1], v[4], v[5], v[2]),
             (v[0], v[3], v[4], v[1])]
    fs = [b.faces.new(f) for f in faces]
    bmesh.ops.recalc_face_normals(b, faces=fs)


def chaikin(points, iterations=2):
    pts = [tuple(p) for p in points]
    for _ in range(iterations):
        out = [pts[0]]
        for i in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            out.append((0.75 * x0 + 0.25 * x1, 0.75 * z0 + 0.25 * z1))
            out.append((0.25 * x0 + 0.75 * x1, 0.25 * z0 + 0.75 * z1))
        out.append(pts[-1])
        pts = out
    return pts


def resample(points, step):
    out = []
    for i in range(len(points) - 1):
        (x0, z0), (x1, z1) = points[i], points[i + 1]
        seg = math.hypot(x1 - x0, z1 - z0)
        n = max(1, int(seg / step))
        for k in range(n):
            t = k / n
            out.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
    out.append(tuple(points[-1]))
    return out


def sweep(g, mat, path, profile, jitter=0.0, head_round=False, base_y=-7.0):
    """Extrude an open cross-section profile [(lateral, y), ...] along a 2D path [(x, z), ...]."""
    b = g.bm(mat)
    n = len(path)
    frames = []
    for i, (x, z) in enumerate(path):
        xa, za = path[max(i - 1, 0)]
        xb, zb = path[min(i + 1, n - 1)]
        tx, tz = xb - xa, zb - za
        tl = math.hypot(tx, tz) or 1.0
        tx, tz = tx / tl, tz / tl
        frames.append((x, z, tx, tz, 1.0))
    if head_round:
        x, z, tx, tz, _ = frames[-1]
        for adv, s in ((3.5, 0.82), (6.5, 0.58), (8.5, 0.32), (9.5, 0.12)):
            frames.append((x + tx * adv, z + tz * adv, tx, tz, s))
    rings = []
    for (x, z, tx, tz, s) in frames:
        nx, nz = -tz, tx
        ring = []
        for j, (lat, y) in enumerate(profile):
            jl = jy = 0.0
            if jitter and 0 < j < len(profile) - 1:
                jl = RNG.uniform(-jitter, jitter)
                jy = RNG.uniform(-jitter, jitter * 0.5)
            yy = base_y + (y + jy - base_y) * s
            ring.append(b.verts.new(W(x + nx * (lat + jl) * s, yy, z + nz * (lat + jl) * s)))
        rings.append(ring)
    faces = []
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(len(profile) - 1):
            faces.append(b.faces.new((A[j], A[j + 1], B[j + 1], B[j])))
    if head_round:
        faces.append(b.faces.new(list(rings[-1])))
    bmesh.ops.recalc_face_normals(b, faces=faces)


# --------------------------------------------------------------------------- reusable details
def hvac_scatter(g, x0, x1, z0, z1, y, count, avoid=None):
    placed = 0
    tries = 0
    while placed < count and tries < count * 12:
        tries += 1
        x = RNG.uniform(x0, x1)
        z = RNG.uniform(z0, z1)
        if avoid and avoid(x, z):
            continue
        w, d = RNG.choice(((3.2, 2.0), (2.4, 2.4), (4.0, 2.2), (1.6, 1.6)))
        yaw = 0.0 if RNG.random() < 0.7 else math.pi / 2
        box(g, "hvac", x, y + 0.7, z, w, 1.4, d, yaw=yaw, bevel=0.08)
        if RNG.random() < 0.6:
            cyl(g, "steel_dark", (x, y + 1.4, z), (x, y + 1.62, z), 0.55, segs=10)
        placed += 1


def transformer(g, x, z, yaw_z=True):
    box(g, "concrete_dark", x, 0.25, z, 9, 0.5, 11)
    box(g, "transformer", x, 3.3, z, 5.5, 5.6, 7.5, bevel=0.15)
    for side in (-1, 1):
        for k in range(6):
            box(g, "transformer", x + side * 3.35, 3.0, z - 2.75 + k * 1.1, 1.2, 4.2, 0.12)
    cyl(g, "transformer", (x, 7.2, z - 3), (x, 7.2, z + 3), 0.7, segs=12)
    for k in (-1.6, 0.0, 1.6):
        cyl(g, "ceramic", (x + k, 6.1, z + 2.6), (x + k, 8.6, z + 2.6), 0.22, segs=8)


def palm(g, x, z):
    h = RNG.uniform(6.5, 9.0)
    lathe(g, "palm_trunk", x, z, [(0.34, 0.0), (0.28, h * 0.5), (0.21, h)], segs=6, cap_top=True)
    fronds = 7
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + RNG.uniform(-0.25, 0.25)
        length = RNG.uniform(3.2, 4.4)
        droop = RNG.uniform(1.5, 2.5)
        ca, sa = math.cos(a), math.sin(a)
        px, pz = -sa, ca
        widths = (0.14, 0.9, 0.75, 0.4, 0.04)
        pairs = []
        b = g.bm("palm_leaf")
        for s in range(5):
            t = s / 4.0
            r = length * t
            y = h + 0.5 * t - droop * t * t
            cx, cz = x + r * ca, z + r * sa
            w = widths[s] / 2
            lift = 0.12 * widths[s]
            pairs.append((b.verts.new(W(cx + px * w, y - lift, cz + pz * w)),
                          b.verts.new(W(cx, y + lift, cz)),
                          b.verts.new(W(cx - px * w, y - lift, cz - pz * w))))
        for s in range(4):
            L0, C0, R0 = pairs[s]
            L1, C1, R1 = pairs[s + 1]
            b.faces.new((L0, C0, C1, L1))
            b.faces.new((C0, R0, R1, C1))


def car(g, x, z, flip):
    mat = RNG.choices(("car_white", "car_silver", "car_dark", "car_blue"), weights=(5, 4, 3, 1))[0]
    s = -1.0 if flip else 1.0
    box(g, "tyre", x, 0.38, z, 1.66, 0.5, 3.7)
    box(g, mat, x, 0.78, z, 1.8, 0.62, 4.3, bevel=0.22)
    box(g, mat, x, 1.33, z - 0.25 * s, 1.58, 0.52, 2.25, bevel=0.2)
    box(g, "glass", x, 1.31, z - 0.25 * s, 1.62, 0.36, 2.05)


# --------------------------------------------------------------------------- builders
def build_unit(g):
    """One generalized reactor unit, authored around the containment axis at (0, 0)."""
    box_mm(g, "concrete_light", -50, 50, 0, 0.45, -48, 48)
    box(g, "concrete_white", 0, 12, 0, 96, 24, 92, bevel=0.35)
    box(g, "concrete_white", -37, 18, 0, 22, 36, 76, bevel=0.35)
    box(g, "concrete_white", 37, 15, 12, 22, 30, 52, bevel=0.35)
    box(g, "roof_dark", 0, 24.12, 0, 93, 0.25, 89)
    box(g, "roof_dark", -37, 36.12, 0, 19.5, 0.25, 73.5)
    box(g, "roof_dark", 37, 30.12, 12, 19.5, 0.25, 49.5)
    box(g, "accent_blue", 0, 21.0, 0, 96.3, 1.1, 92.3)
    box(g, "accent_blue", -37, 33.0, 0, 22.3, 1.1, 76.3)
    # vertical facade reveals on the aux building
    for k in range(9):
        zz = -42 + k * 10.5
        box(g, "concrete_light", 48.2, 12, zz, 0.4, 24, 0.8)
        box(g, "concrete_light", -48.2, 18, zz, 0.4, 36, 0.8)

    # containment: cylinder, cornice and shallow dome
    R, wall_h, cap_h = 26.5, 46.0, 22.0
    lathe(g, "dome_white", 0, 0, [(R, 0.0), (R, wall_h)], segs=80, cap_top=False)
    lathe(g, "concrete_light", 0, 0, [(R, wall_h - 0.2), (R + 0.8, wall_h - 0.2), (R + 0.8, wall_h + 1.7),
                                      (R, wall_h + 1.7)], segs=80, cap_top=False)
    rs = (R * R + cap_h * cap_h) / (2 * cap_h)
    cy = wall_h + 1.7 + cap_h - rs
    phi0 = math.asin(R / rs)
    steps = 20
    prof = [(rs * math.sin(phi0 * (1 - k / steps)), cy + rs * math.cos(phi0 * (1 - k / steps))) for k in range(steps + 1)]
    lathe(g, "dome_white", 0, 0, prof, segs=80, cap_top=False)
    for a in (math.radians(30), math.radians(150), math.radians(270)):
        box(g, "dome_white", (R + 0.35) * math.cos(a), 23.0, (R + 0.35) * math.sin(a), 1.2, 46.0, 2.2, yaw=-a)
    box(g, "concrete_light", 0, 30.0, 27.5, 12, 12, 6, bevel=0.2)

    # link building and turbine hall (towards the sea, -z)
    box(g, "concrete_white", 0, 8, -52, 40, 16, 12, bevel=0.3)
    box(g, "cladding", 0, 15.5, -102, 70, 31, 88, bevel=0.3)
    gable(g, "roof_metal", 0, -102, 70, 88, 31, 3.0, along="z", overhang=0.5)
    box(g, "roof_dark", 0, 34.4, -102, 5.5, 1.3, 68)
    box(g, "accent_blue", 0, 25.0, -102, 70.3, 1.5, 88.3)
    for k in range(10):
        zz = -146 + 4.4 + k * 8.8
        box(g, "cladding", 35.25, 15.5, zz, 0.5, 31, 0.9)
        box(g, "cladding", -35.25, 15.5, zz, 0.5, 31, 0.9)
    for k in range(8):
        xx = -35 + 4.375 + k * 8.75
        box(g, "cladding", xx, 15.5, -146.25, 0.9, 31, 0.5)
    box(g, "steel_dark", -35.3, 7, -80, 0.4, 14, 12)
    box(g, "steel_dark", -35.3, 5, -126, 0.4, 10, 8)

    # electrical annex on the east side of the hall
    box(g, "concrete_white", 44, 9, -102, 18, 18, 80, bevel=0.3)
    box(g, "roof_dark", 44, 18.12, -102, 16, 0.25, 78)
    for zz in (-132, -114, -96, -78):
        box(g, "steel_dark", 53.15, 12, zz, 0.3, 2.6, 9)
    hvac_scatter(g, 38, 50, -138, -66, 18.2, 5)

    # main transformers on the west side of the hall, separated by fire walls
    for tz in (-86, -102, -118):
        transformer(g, -48, tz)
    for fz in (-94, -110):
        box(g, "concrete_light", -48, 4.5, fz, 10, 9, 0.6)

    # roof plant on the auxiliary building (kept clear of the containment)
    hvac_scatter(g, -22, 22, -45, -31, 24.25, 6, avoid=lambda x, z: math.hypot(x, z) < 30.5)
    hvac_scatter(g, 27, 46, -44, -18, 24.25, 4)
    hvac_scatter(g, -46, -28, -34, 34, 36.25, 4)


def office(g, b):
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    box(g, "concrete_white", x, h / 2, z, w, h, d, bevel=0.3)
    floors = max(1, int(h // 3.6))
    for f in range(floors):
        box(g, "glass", x, f * 3.6 + 1.95, z, w + 0.3, 1.55, d + 0.3)
    box(g, "roof_dark", x, h + 0.12, z, w - 1.6, 0.25, d - 1.6)
    if w > 40:
        box(g, "concrete_light", x - w * 0.18, h + 1.6, z, w * 0.22, 3.2, d * 0.45, bevel=0.15)
    hvac_scatter(g, x - w * 0.42, x + w * 0.42, z - d * 0.38, z + d * 0.38, h + 0.25, max(2, int(w * d / 520)))


def industrial(g, b):
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    wall = "concrete_light" if (int(abs(x) + abs(z)) // 7) % 2 == 0 else "cladding"
    box(g, wall, x, h / 2, z, w, h, d, bevel=0.3)
    box(g, "accent_blue", x, h - 1.5, z, w + 0.25, 0.9, d + 0.25)
    box(g, "roof_metal", x, h + 0.12, z, w - 1.2, 0.25, d - 1.2)
    step = 8.0
    nx = max(1, int(w / step))
    for k in range(nx + 1):
        xx = x - w / 2 + k * (w / nx)
        box(g, wall, xx, h / 2, z + d / 2 + 0.2, 0.7, h, 0.4)
        box(g, wall, xx, h / 2, z - d / 2 - 0.2, 0.7, h, 0.4)
    for k in range(max(1, int(w / 22))):
        xx = x - w / 2 + (k + 0.5) * (w / max(1, int(w / 22)))
        box(g, "steel_dark", xx, 3.0, z + d / 2 + 0.25, 4.5, 4.2, 0.3)
    hvac_scatter(g, x - w * 0.42, x + w * 0.42, z - d * 0.38, z + d * 0.38, h + 0.25, max(2, int(w * d / 450)))


def warehouse(g, b):
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    box(g, "cladding", x, h / 2, z, w, h, d, bevel=0.25)
    along = "x" if w >= d else "z"
    gable(g, "roof_metal", x, z, w, d, h, 2.4, along=along, overhang=0.6)
    if along == "x":
        n = max(2, int(w / 26))
        for k in range(n):
            xx = x - w / 2 + (k + 0.5) * (w / n)
            box(g, "steel_dark", xx, 3.2, z + d / 2 + 0.2, 6.0, 6.4, 0.3)
        for k in range(int(w / 6)):
            xx = x - w / 2 + 3 + k * 6
            box(g, "cladding", xx, h / 2, z - d / 2 - 0.15, 0.5, h, 0.3)
    else:
        n = max(2, int(d / 26))
        for k in range(n):
            zz = z - d / 2 + (k + 0.5) * (d / n)
            box(g, "steel_dark", x - w / 2 - 0.2, 3.2, zz, 0.3, 6.4, 6.0)


def garage(g, b):
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    box(g, "concrete_white", x, h / 2, z, w, h, d, bevel=0.2)
    box(g, "roof_dark", x, h + 0.1, z, w - 1, 0.2, d - 1)
    for zz in (z - 4.5, z + 4.5):
        box(g, "steel_dark", x - w / 2 - 0.15, 2.4, zz, 0.3, 4.8, 6.5)
    box(g, "concrete_light", x - w / 2 - 3.5, h - 0.6, z, 7, 0.35, d - 2)
    box(g, "accent_blue", x, h - 1.0, z, w + 0.2, 0.6, d + 0.2)


def generator(g, b):
    industrial(g, b)
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    for k in range(4):
        xx = x - w * 0.36 + k * (w * 0.24)
        cyl(g, "steel", (xx, h, z - d * 0.25), (xx, h + 9, z - d * 0.25), 0.75, segs=12)


def coastal(g, b):
    x, z, w, d, h = b["x"], b["z"], b["w"], b["d"], b["h"]
    box(g, "concrete_white", x, h / 2, z, w, h, d, bevel=0.3)
    box(g, "roof_dark", x, h + 0.12, z, w - 1.4, 0.25, d - 1.4)
    for k in range(int(w / 7)):
        xx = x - w / 2 + 3.5 + k * 7
        box(g, "steel_dark", xx, h * 0.55, z - d / 2 - 0.12, 3.2, 1.6, 0.25)
    box(g, "accent_blue", x, h - 1.2, z, w + 0.25, 0.7, d + 0.25)
    hvac_scatter(g, x - w * 0.4, x + w * 0.4, z - d * 0.3, z + d * 0.3, h + 0.25, 4)


def tank(g, t):
    x, z, r, h = t["x"], t["z"], t["r"], t["h"]
    lathe(g, "concrete_dark", x, z, [(r + 0.9, 0.0), (r + 0.9, 0.45), (r, 0.45)], segs=40, cap_top=False)
    lathe(g, "tank_white", x, z, [(r, 0.45), (r, h), (r * 0.97, h + 0.3), (0.0, h + r * 0.14)], segs=40, cap_top=False)
    lathe(g, "steel", x, z, [(r + 0.05, h - 0.9), (r + 0.18, h - 0.9), (r + 0.18, h - 0.75), (r + 0.05, h - 0.75)],
          segs=40, cap_top=False)


def skid(g, s):
    x, z = s["x"], s["z"]
    if s["id"] == "SK-SY":
        transformer(g, x, z)
        return
    box(g, "concrete_dark", x, 0.15, z, 9, 0.3, 6.5)
    box(g, "steel_dark", x, 0.45, z, 7, 0.3, 4.5)
    cyl(g, "hvac", (x - 2.4, 1.35, z - 1.0), (x + 0.6, 1.35, z - 1.0), 0.78, segs=16)
    cyl(g, "steel_dark", (x + 0.6, 1.35, z - 1.0), (x + 2.7, 1.35, z - 1.0), 0.56, segs=14)
    box(g, "hvac", x + 2.3, 1.25, z + 1.4, 1.6, 1.9, 1.0, bevel=0.06)
    beam(g, "steel", (x - 3.1, 1.35, z - 1.0), (x - 3.1, 1.35, z + 1.9), 0.32)
    beam(g, "steel", (x - 3.1, 1.35, z + 1.9), (x + 1.0, 1.35, z + 1.9), 0.32)
    beam(g, "steel", (x - 3.1, 0.6, z - 1.0), (x - 3.1, 1.35, z - 1.0), 0.3)


def build_site(g):
    kinds = {"office": office, "industrial": industrial, "warehouse": warehouse, "garage": garage,
             "generator": generator, "coastal": coastal}
    for b in LAYOUT["buildings"]:
        kinds[b["kind"]](g, b)
    for t in LAYOUT["tanks"]:
        tank(g, t)
    for s in LAYOUT["skids"]:
        skid(g, s)
    # water-treatment clarifiers next to the tank farm
    for (x, z) in ((-246, 236), (-222, 236)):
        lathe(g, "concrete_light", x, z, [(9.5, 0.0), (9.5, 2.2), (8.9, 2.2), (8.9, 0.6)], segs=36, cap_top=False)


def build_marine(g):
    sw = LAYOUT["seawall"]
    z = sw["z"]
    box_mm(g, "concrete_dark", sw["minX"], sw["maxX"], -8.0, 0.9, z - 2.6, z + 0.6)
    box_mm(g, "concrete_warm", sw["minX"], sw["maxX"], 0.9, 1.25, z - 2.9, z + 0.9)

    # rubble-mound breakwaters with a concrete crest track and navigation lights at the heads
    profile = [(-17.0, -7.0), (-12.0, -2.4), (-8.0, 0.6), (-5.0, 2.0), (-3.4, 2.65), (3.4, 2.65), (5.0, 2.0),
               (8.0, 0.6), (12.0, -2.4), (17.0, -7.0)]
    for i, bw in enumerate(LAYOUT["breakwaters"]):
        path = resample(chaikin(bw["points"], 3), 5.0)
        sweep(g, "rock", path, profile, jitter=0.85, head_round=True)
        crest = [(-3.6, 2.2), (-3.2, 2.95), (3.2, 2.95), (3.6, 2.2)]
        sweep(g, "concrete_warm", path[:-1], crest)
        hx, hz = path[-1]
        cyl(g, "pylon_white", (hx, 2.9, hz), (hx, 9.5, hz), 0.95, segs=14)
        cyl(g, "nav_light_red" if i == 0 else "nav_light_green", (hx, 5.0, hz), (hx, 6.4, hz), 0.98, segs=14)
        cyl(g, "nav_light_red" if i == 0 else "nav_light_green", (hx, 9.5, hz), (hx, 10.3, hz), 0.42, segs=10)

    # intake pump houses on the seawall with piled forebay decks and gantry cranes
    for it in LAYOUT["intakes"]:
        x = it["x"]
        box_mm(g, "concrete_white", x - 30, x + 30, -7.0, 10.0, z - 12, z + 8, bevel=0.3)
        box_mm(g, "roof_dark", x - 28.6, x + 28.6, 10.0, 10.25, z - 10.6, z + 6.6)
        box_mm(g, "accent_blue", x - 30.15, x + 30.15, 7.6, 8.4, z - 12.15, z + 8.15)
        for bx in (-22.5, -7.5, 7.5, 22.5):
            box(g, "steel_dark", x + bx, -2.4, z - 12.2, 11.0, 7.0, 0.5)
        box_mm(g, "concrete_light", x - 24, x + 24, 1.4, 2.6, z - 46, z - 12)
        box_mm(g, "concrete_warm", x - 24, x + 24, 2.6, 3.2, z - 46, z - 45.4)
        for px in (-20, -10, 0, 10, 20):
            for pz in (-16, -26, -36, -44):
                cyl(g, "concrete_dark", (x + px, -7.0, z + pz), (x + px, 1.4, z + pz), 0.75, segs=10)
        hvac_scatter(g, x - 24, x + 24, z - 8, z + 4, 10.25, 3)
        if it.get("crane"):
            for lx in (-21.0, 21.0):
                beam(g, "crane_black", (x + lx, 2.6, z - 34), (x + lx, 16.0, z - 29), 0.9)
                beam(g, "crane_black", (x + lx, 2.6, z - 24), (x + lx, 16.0, z - 29), 0.9)
                beam(g, "crane_black", (x + lx, 3.4, z - 35), (x + lx, 3.4, z - 23), 0.7)
            box(g, "crane_black", x, 16.7, z - 29, 46.0, 1.6, 2.2)
            box(g, "crane_black", x + 5, 15.3, z - 29, 4.0, 2.2, 3.2)
            beam(g, "steel", (x + 5, 14.2, z - 29), (x + 5, 7.0, z - 29), 0.08)


def pylon(g, x, z):
    base, top, H = 4.6, 1.3, 40.0
    levels = [0.0, 8.0, 16.0, 24.0, 32.0, 40.0]

    def half(y):
        return base + (top - base) * (y / H)

    for i in range(len(levels) - 1):
        y0, y1 = levels[i], levels[i + 1]
        h0, h1 = half(y0), half(y1)
        mat = "steel" if i < 2 else ("pylon_red" if i % 2 == 0 else "pylon_white")
        for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            beam(g, mat, (x + sx * h0, y0, z + sz * h0), (x + sx * h1, y1, z + sz * h1), 0.34)
        # one diagonal per face per level keeps the lattice readable without the triangle cost
        beam(g, mat, (x - h0, y0, z + h0), (x + h1, y1, z + h1), 0.16)
        beam(g, mat, (x + h0, y0, z - h0), (x - h1, y1, z - h1), 0.16)
        beam(g, mat, (x + h0, y0, z + h0), (x + h1, y1, z - h1), 0.16)
        beam(g, mat, (x - h0, y0, z - h0), (x - h1, y1, z + h1), 0.16)
        hh = h1
        beam(g, mat, (x - hh, y1, z - hh), (x + hh, y1, z - hh), 0.18)
        beam(g, mat, (x - hh, y1, z + hh), (x + hh, y1, z + hh), 0.18)
        beam(g, mat, (x - hh, y1, z - hh), (x - hh, y1, z + hh), 0.18)
        beam(g, mat, (x + hh, y1, z - hh), (x + hh, y1, z + hh), 0.18)
    for ya in (30.0, 37.0):
        beam(g, "pylon_white", (x - 9.0, ya, z), (x + 9.0, ya, z), 0.5)
        beam(g, "pylon_red", (x - 9.0, ya, z), (x - half(ya), ya - 2.2, z), 0.22)
        beam(g, "pylon_red", (x + 9.0, ya, z), (x + half(ya), ya - 2.2, z), 0.22)
        for sx in (-8.5, 8.5):
            cyl(g, "ceramic", (x + sx, ya - 0.2, z), (x + sx, ya - 2.5, z), 0.16, segs=6)
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        beam(g, "pylon_red", (x + sx * top, H, z + sz * top), (x, H + 6.0, z), 0.2)


def wire(g, p0, p1, sag, segs=12, t=0.16):
    pts = []
    for k in range(segs + 1):
        u = k / segs
        pts.append((p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - sag * 4 * u * (1 - u),
                    p0[2] + (p1[2] - p0[2]) * u))
    for k in range(segs):
        beam(g, "steel_dark", pts[k], pts[k + 1], t)


def build_electrical(g):
    sy = LAYOUT["switchyard"]
    skid_xz = [(s["x"], s["z"]) for s in LAYOUT["skids"] if s["id"] == "SK-SY"]
    cols = [sy["minX"] + 15 + k * 30 for k in range(int((sy["maxX"] - sy["minX"]) / 30))]
    # gantry lines on the north and south edges of the yard
    for gz in (sy["minZ"] + 8, sy["maxZ"] - 2):
        for cx in cols:
            beam(g, "steel", (cx - 15, 0.0, gz), (cx - 15, 16.0, gz), 0.7)
        beam(g, "steel", (cols[-1] + 15, 0.0, gz), (cols[-1] + 15, 16.0, gz), 0.7)
        beam(g, "steel", (cols[0] - 15, 16.0, gz), (cols[-1] + 15, 16.0, gz), 0.8)
    rows = [sy["minZ"] + 24 + k * 15 for k in range(5)]
    for bx in cols:
        for rz in rows:
            if any(math.hypot(bx - sx_, rz - sz_) < 16 for (sx_, sz_) in skid_xz):
                continue
            for ph in (-3.2, 0.0, 3.2):
                px = bx + ph
                beam(g, "steel", (px, 0.0, rz), (px, 2.6, rz), 0.5)
                cyl(g, "ceramic", (px, 2.6, rz), (px, 5.8, rz), 0.38, segs=8, r2=0.26)
            box(g, "steel_dark", bx, 0.6, rz + 2.4, 7.5, 1.2, 0.8)
    for rz in rows:
        for ph in (-3.2, 0.0, 3.2):
            beam(g, "steel", (sy["minX"] + 4, 9.0, rz - 4 + ph), (sy["maxX"] - 4, 9.0, rz - 4 + ph), 0.22)
        for cx in cols:
            beam(g, "steel", (cx - 15, 0.0, rz - 4), (cx - 15, 9.0, rz - 4), 0.35)
    # transmission lines leaving the yard towards the desert
    sag = 7.0
    for line in LAYOUT["pylonLines"]:
        x = line["x"]
        for zz in line["zs"]:
            pylon(g, x, zz)
        attach_prev = [(x - 8.5, 16.0, sy["maxZ"] - 2), (x + 8.5, 16.0, sy["maxZ"] - 2)]
        first = True
        prev_z = None
        for zz in line["zs"]:
            lows = [(x - 8.5, 27.5, zz), (x + 8.5, 27.5, zz)]
            highs = [(x - 8.5, 34.5, zz), (x + 8.5, 34.5, zz)]
            if first:
                for a, b in zip(attach_prev, lows):
                    wire(g, a, b, 4.0)
                for a, b in zip(attach_prev, highs):
                    wire(g, a, b, 4.0)
                first = False
            else:
                for (a, b) in zip([(x - 8.5, 27.5, prev_z), (x + 8.5, 27.5, prev_z)], lows):
                    wire(g, a, b, sag)
                for (a, b) in zip([(x - 8.5, 34.5, prev_z), (x + 8.5, 34.5, prev_z)], highs):
                    wire(g, a, b, sag)
                wire(g, (x, 46.0, prev_z), (x, 46.0, zz), sag * 0.8, t=0.12)
            prev_z = zz


def build_props(g):
    # palms along the long edges of landscaped parcels
    for (x0, x1, z0, z1) in LAYOUT["lawns"]:
        w, d = x1 - x0, z1 - z0
        if w >= d:
            n = max(1, int(w / 15))
            for k in range(n):
                xx = x0 + (k + 0.5) * (w / n)
                palm(g, xx, z0 + 2.6)
                if d > 24:
                    palm(g, xx + 4, z1 - 2.6)
        else:
            n = max(1, int(d / 15))
            for k in range(n):
                zz = z0 + (k + 0.5) * (d / n)
                palm(g, x0 + 2.6, zz)
                if w > 24:
                    palm(g, x1 - 2.6, zz + 4)
    # parked cars
    for lot in LAYOUT["parking"]:
        n = int((lot["maxX"] - lot["minX"]) / lot["stall"])
        for ri, rz in enumerate(lot["rows"]):
            for k in range(n):
                if RNG.random() > lot["fill"]:
                    continue
                car(g, lot["minX"] + (k + 0.5) * lot["stall"], rz, ri % 2 == 1)
    # containers in the laydown yard
    ld = LAYOUT["laydown"]
    zz = ld["minZ"] + 3
    while zz < ld["maxZ"] - 2:
        xx = ld["minX"] + 4
        while xx < ld["maxX"] - 3:
            if RNG.random() < 0.78:
                stack = RNG.choice((1, 1, 2, 2, 3))
                for s in range(stack):
                    mat = RNG.choice(("container_blue", "container_rust", "container_white", "container_gray"))
                    box(g, mat, xx, 1.3 + s * 2.6, zz, 6.06, 2.58, 2.44, bevel=0.04)
            xx += 6.7
        zz += 3.3 if (int(zz) % 2 == 0) else 4.6
    # meteorological mast
    mm = LAYOUT["metMast"]
    x, z, h = mm["x"], mm["z"], mm["h"]
    legs = [(x + 0.9 * math.cos(a), z + 0.9 * math.sin(a)) for a in (0.0, 2.0944, 4.1888)]
    for (lx, lz) in legs:
        beam(g, "steel", (lx, 0.0, lz), (lx, h, lz), 0.12)
    for k in range(int(h / 5) + 1):
        y = k * 5.0
        for i in range(3):
            a, b = legs[i], legs[(i + 1) % 3]
            beam(g, "steel", (a[0], y, a[1]), (b[0], y, b[1]), 0.07)
            if k < int(h / 5):
                beam(g, "steel", (a[0], y, a[1]), (b[0], y + 5.0, b[1]), 0.05)
    for y in (10.0, 30.0, h):
        beam(g, "steel", (x, y, z), (x + 3.2, y, z), 0.08)
        box(g, "sensor_white", x + 3.2, y + 0.2, z, 0.35, 0.4, 0.35)
    box(g, "concrete_white", x + 4, 1.3, z + 3, 3.0, 2.6, 2.4, bevel=0.08)
    sphere(g, "nav_light_red", (x, h + 0.4, z), 0.35, u=10, v=6)


def build_sensor_node(g):
    box(g, "concrete_light", 0, 0.12, 0, 0.9, 0.24, 0.9, bevel=0.04)
    cyl(g, "steel", (0, 0.24, 0), (0, 3.05, 0), 0.06, segs=10)
    box(g, "sensor_white", 0, 2.55, 0.13, 0.44, 0.6, 0.26, bevel=0.03)
    cyl(g, "sensor_white", (0, 3.05, 0), (0, 3.4, 0), 0.15, segs=14)
    cyl(g, "steel_dark", (0, 3.4, 0), (0, 3.46, 0), 0.17, segs=14)
    beam(g, "solar", (0, 2.9, -0.42), (0, 3.18, -0.08), 0.62, 0.03)
    cyl(g, "steel_dark", (0.12, 3.46, 0), (0.12, 4.0, 0), 0.012, segs=6)


def build_ugv(g):
    box(g, "ugv_graphite", 0, 0.62, 0, 1.25, 0.46, 2.05, bevel=0.07)
    box(g, "ugv_panel", 0, 0.98, -0.05, 1.08, 0.28, 1.55, bevel=0.06)
    box(g, "ugv_accent", 0, 0.86, 0, 1.28, 0.07, 2.08)
    box(g, "ugv_graphite", 0, 0.72, 1.06, 1.1, 0.22, 0.12, bevel=0.03)
    box(g, "lens", 0, 0.75, 1.125, 0.82, 0.07, 0.02)
    for wz in (-0.72, 0.0, 0.72):
        for side in (-1, 1):
            cyl(g, "tyre", (side * 0.66, 0.34, wz), (side * 0.9, 0.34, wz), 0.34, segs=16)
            cyl(g, "steel", (side * 0.9, 0.34, wz), (side * 0.925, 0.34, wz), 0.16, segs=10)
    cyl(g, "ugv_graphite", (0, 1.12, -0.55), (0, 1.75, -0.55), 0.045, segs=8)
    box(g, "ugv_graphite", 0, 1.86, -0.52, 0.42, 0.22, 0.26, bevel=0.03)
    cyl(g, "lens", (-0.09, 1.86, -0.39), (-0.09, 1.86, -0.37), 0.065, segs=12)
    cyl(g, "lens", (0.09, 1.86, -0.39), (0.09, 1.86, -0.37), 0.05, segs=12)
    cyl(g, "ugv_graphite", (0, 1.12, 0.55), (0, 1.24, 0.55), 0.11, segs=16)
    cyl(g, "ugv_graphite", (0.4, 1.12, -0.8), (0.4, 1.9, -0.8), 0.012, segs=6)
    cyl(g, "ugv_graphite", (-0.4, 1.12, -0.8), (-0.4, 1.7, -0.8), 0.012, segs=6)
    cyl(g, "beacon_amber", (0, 1.97, -0.52), (0, 2.06, -0.52), 0.05, segs=10)


def build_uav(g):
    box(g, "uav_body", 0, 0, 0, 0.36, 0.14, 0.5, bevel=0.04)
    box(g, "uav_light", 0, 0.085, 0.02, 0.3, 0.05, 0.38, bevel=0.02)
    for (ax, az) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        tx, tz = ax * 0.55, az * 0.55
        beam(g, "uav_body", (ax * 0.12, 0.0, az * 0.15), (tx, 0.02, tz), 0.045)
        cyl(g, "uav_body", (tx, 0.0, tz), (tx, 0.09, tz), 0.05, segs=10)
        cyl(g, "rotor", (tx, 0.1, tz), (tx, 0.106, tz), 0.27, segs=24)
    sphere(g, "uav_body", (0, -0.13, 0.16), 0.07, u=12, v=8)
    cyl(g, "lens", (0, -0.13, 0.215), (0, -0.13, 0.235), 0.032, segs=10)
    for side in (-1, 1):
        beam(g, "uav_body", (side * 0.12, -0.06, 0.1), (side * 0.16, -0.22, 0.12), 0.02)
        beam(g, "uav_body", (side * 0.12, -0.06, -0.1), (side * 0.16, -0.22, -0.12), 0.02)
        beam(g, "uav_body", (side * 0.16, -0.22, -0.22), (side * 0.16, -0.22, 0.22), 0.025)
    sphere(g, "nav_light_red", (-0.6, 0.02, 0.6), 0.025, u=8, v=4)
    sphere(g, "nav_light_green", (0.6, 0.02, 0.6), 0.025, u=8, v=4)


def build_vehicle(g):
    box(g, "tyre", 0, 0.6, -0.2, 2.2, 0.5, 7.6)
    box(g, "vehicle_red", 0, 1.6, -0.95, 2.45, 2.3, 5.6, bevel=0.1)
    box(g, "vehicle_red", 0, 1.48, 2.95, 2.45, 2.12, 2.2, bevel=0.18)
    box(g, "glass", 0, 2.0, 3.55, 2.32, 0.85, 1.0, bevel=0.06)
    box(g, "vehicle_white", 0, 1.32, -0.95, 2.47, 0.28, 5.62)
    box(g, "steel", 0, 2.8, -0.95, 2.1, 0.08, 4.8)
    box(g, "lightbar", 0, 2.62, 3.15, 1.6, 0.14, 0.3)
    for wz in (-2.6, -1.35, 2.85):
        for side in (-1, 1):
            cyl(g, "tyre", (side * 1.0, 0.5, wz), (side * 1.24, 0.5, wz), 0.5, segs=16)


def build_person(g):
    for side in (-1, 1):
        cyl(g, "coverall", (side * 0.11, 0.08, 0), (side * 0.11, 0.86, 0), 0.085, segs=8)
        box(g, "tyre", side * 0.11, 0.05, 0.05, 0.12, 0.1, 0.28)
        cyl(g, "coverall", (side * 0.26, 1.42, 0), (side * 0.29, 0.88, 0.03), 0.06, segs=8)
    box(g, "coverall", 0, 1.15, 0, 0.42, 0.62, 0.24, bevel=0.07)
    box(g, "hivis", 0, 1.2, 0, 0.445, 0.42, 0.265, bevel=0.06)
    sphere(g, "skin", (0, 1.58, 0.0), 0.11, u=12, v=8)
    sphere(g, "helmet", (0, 1.635, -0.005), 0.125, u=12, v=6)


# --------------------------------------------------------------------------- scene + export
def fresh_scene():
    sc = bpy.data.scenes.get(SCENE_NAME)
    if sc is None:
        sc = bpy.data.scenes.new(SCENE_NAME)
    for ob in list(sc.objects):
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and getattr(data, "users", 1) == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
    for coll in list(sc.collection.children):
        if coll.name.startswith("ENC_"):
            bpy.data.collections.remove(coll)
    sc.unit_settings.system = "METRIC"
    return sc


def new_collection(sc, name):
    old = bpy.data.collections.get(name)
    if old is not None:
        bpy.data.collections.remove(old)
    coll = bpy.data.collections.new(name)
    sc.collection.children.link(coll)
    return coll


def export(sc, objs, filename):
    vl = sc.view_layers[0]
    for ob in sc.objects:
        ob.select_set(False, view_layer=vl)
    for ob in objs:
        ob.select_set(True, view_layer=vl)
    vl.objects.active = objs[0]
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_normals=True, export_materials="EXPORT", export_vertex_color="NONE",
        export_cameras=False, export_lights=False, export_extras=False,
    )
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in objs)
    return filename, round(os.path.getsize(path) / 1024.0, 1), tris


def background_scene():
    """Headless build: reuse the factory-startup scene of this throwaway Blender process."""
    sc = bpy.context.scene
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    sc.name = SCENE_NAME
    sc.unit_settings.system = "METRIC"
    return sc


def run():
    # The glTF exporter is not safe to call from a live UI session's add-on timer, so the build is
    # meant to run headless:  blender --background --factory-startup --python build_facility.py
    if not bpy.app.background:
        raise RuntimeError("Run this script with `blender --background --factory-startup --python ...`")
    sc = background_scene()
    report = []

    groups = [
        ("ENC_ReactorUnit", "reactor_unit", build_unit, "reactor-unit.glb"),
        ("ENC_ServiceBuildings", "service", build_site, "service-buildings.glb"),
        ("ENC_CoolingInfrastructure", "marine", build_marine, "cooling-infrastructure.glb"),
        ("ENC_ElectricalInfrastructure", "electrical", build_electrical, "electrical-infrastructure.glb"),
        ("ENC_SiteProps", "props", build_props, "site-props.glb"),
        ("ENC_SensorNode", "sensor_node", build_sensor_node, "sensor-node.glb"),
        ("ENC_UGV", "ugv", build_ugv, "ugv.glb"),
        ("ENC_UAV", "uav", build_uav, "uav.glb"),
        ("ENC_ResponseVehicle", "response_vehicle", build_vehicle, "response-vehicle.glb"),
        ("ENC_Person", "person", build_person, "person.glb"),
    ]
    built = {}
    for coll_name, gname, fn, fname in groups:
        coll = new_collection(sc, coll_name)
        g = Group(gname)
        fn(g)
        objs = g.build(coll)
        built[coll_name] = (coll, objs)
        report.append(export(sc, objs, fname))

    # preview assembly inside Blender: instance the unit at each layout position
    vl = sc.view_layers[0]
    unit_coll = built["ENC_ReactorUnit"][0]
    vl.layer_collection.children[unit_coll.name].exclude = True
    preview = new_collection(sc, "ENC_Preview")
    for u in LAYOUT["units"]:
        inst = bpy.data.objects.new(f"Preview_{u['id']}", None)
        inst.instance_type = "COLLECTION"
        inst.instance_collection = unit_coll
        inst.location = W(u["x"], 0.0, u["z"])
        preview.objects.link(inst)
    for coll_name, loc in (("ENC_UGV", (420.0, 0.0, 232.0)), ("ENC_ResponseVehicle", (-575.0, 0.0, 186.0)),
                           ("ENC_UAV", (300.0, 60.0, -150.0)), ("ENC_Person", (460.0, 0.0, 200.0)),
                           ("ENC_SensorNode", (182.0, 0.0, -126.0))):
        coll, objs = built[coll_name]
        for ob in objs:
            ob.location = W(*loc)
    ground = bpy.data.meshes.new("Preview_Ground")
    bm = bmesh.new()
    pts = [W(x, -0.02, z) for (x, z) in LAYOUT["coastline"]]
    verts = [bm.verts.new(p) for p in pts]
    face = bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=[face])
    if face.normal.z < 0:
        face.normal_flip()
    bm.to_mesh(ground)
    bm.free()
    gob = bpy.data.objects.new("Preview_Ground", ground)
    sand = bpy.data.materials.get("preview_sand") or bpy.data.materials.new("preview_sand")
    sand.diffuse_color = rgba("#D2C3A5")
    ground.materials.append(sand)
    preview.objects.link(gob)
    sea = bpy.data.meshes.new("Preview_Sea")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4000.0, matrix=Matrix.Translation(W(0, -1.5, 0)))
    bm.to_mesh(sea)
    bm.free()
    sob = bpy.data.objects.new("Preview_Sea", sea)
    water = bpy.data.materials.get("preview_sea") or bpy.data.materials.new("preview_sea")
    water.diffuse_color = rgba("#1F5662")
    sea.materials.append(water)
    preview.objects.link(sob)

    try:
        path = os.path.join(SRC_DIR, "encirra-facility.blend")
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
        report.append(("encirra-facility.blend", round(os.path.getsize(path) / 1024.0, 1), 0))
    except Exception as exc:  # the .blend snapshot is a convenience, never fatal
        report.append(("encirra-facility.blend", f"skipped: {exc}", 0))
    return report


if globals().get("ENCIRRA_AUTORUN", True):
    REPORT = run()
    for row in REPORT:
        print(row)
