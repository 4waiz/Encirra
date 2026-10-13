"""
Encirra asset kit - shared helpers for the headless Blender build.

Everything here is procedural and original to this project: no downloaded models,
textures or HDRIs.  Geometry is generated with a small mesh builder (MeshBuilder)
that writes vertices/faces directly, assigns contract material names, computes UVs
and orients faces outward.  Blender is Z-up with model fronts facing -Y; the glTF
exporter converts that to three.js +Y up / fronts facing +Z.
"""

import bpy
import math
import os
import random
from collections import OrderedDict
from contextlib import contextmanager
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# ---------------------------------------------------------------------------
# Material contract (names are shared with the scene; keep in sync with
# assets/models/manifest.json and docs/ASSETS.md)
# ---------------------------------------------------------------------------

MATERIALS = OrderedDict([
    ("facade", dict(hex="#E8E1D4", rough=0.78, metal=0.0,
                    desc="Primary warm-white stone/render: walls, slabs, piers, balcony fronts.")),
    ("facade_alt", dict(hex="#D2BC98", rough=0.82, metal=0.0,
                        desc="Secondary sand/beige stone: bands, alternate volumes, podiums.")),
    ("glazing", dict(hex="#1D2730", rough=0.12, metal=0.45,
                     desc="Facade glazing planes/bands; replaced in the scene by the lit-window shader. "
                          "UV0 encodes the window grid: v = storey index (1.0 per storey, slab-aligned), "
                          "u = bay index (1.0 per ~3 m bay).")),
    ("roof", dict(hex="#B6AFA3", rough=0.92, metal=0.0,
                  desc="Roof decks and membranes.")),
    ("trim", dict(hex="#4A4E54", rough=0.42, metal=0.75,
                  desc="Dark anodised aluminium: mullions, frames, louvres, copings, rails.")),
    ("accent", dict(hex="#A88457", rough=0.45, metal=0.7,
                    desc="Bronze/champagne metal accents: fins, mashrabiya-style screens, signage bands.")),
    ("glass_clear", dict(hex="#BCD5DC", rough=0.06, metal=0.0, alpha=0.35, double=True,
                         desc="Clear glass (balustrades, canopies, tank level band); alpha blended.")),
    ("emissive_sign", dict(hex="#E3242B", rough=0.5, metal=0.0, emit="#FF2A2A", strength=4.0,
                           desc="Self-lit signage: hospital red cross and lettering.")),
    ("solar", dict(hex="#1B2C47", rough=0.2, metal=0.5,
                   desc="Photovoltaic module glass.")),
    ("metal", dict(hex="#A7ABAE", rough=0.4, metal=0.9,
                   desc="Galvanised/bright steel: fences, gantries, rails, vents, ladders.")),
    ("steel_dark", dict(hex="#3A3F45", rough=0.5, metal=0.6,
                        desc="Dark painted steel: transformers, machinery, frames, antenna masts.")),
    ("concrete", dict(hex="#B8AFA2", rough=0.92, metal=0.0,
                      desc="Cast concrete: plinths, slabs, galleries, pipe supports, paving.")),
    ("asphalt", dict(hex="#343537", rough=0.95, metal=0.0,
                     desc="Asphalt / dark paving / helipad deck.")),
    ("foliage", dict(hex="#55702E", rough=0.72, metal=0.0, double=True,
                     desc="Palm fronds and planting (double sided).")),
    ("trunk", dict(hex="#8A7152", rough=0.95, metal=0.0,
                   desc="Palm trunks.")),
    ("water", dict(hex="#2A7C9E", rough=0.08, metal=0.0, emit="#1A8FD0", strength=0.6,
                   desc="Water bodies (tank level column); faintly self-lit cyan.")),
    ("soil", dict(hex="#FFFFFF", rough=0.95, metal=0.0,
                  desc="Soil/rock strata on the district base cut faces (baked colour + normal textures).")),
    ("rock", dict(hex="#7B6F61", rough=0.95, metal=0.0,
                  desc="Rock and gravel: bedrock underside, substation yard gravel.")),
    ("light_emissive", dict(hex="#FFE6BF", rough=0.4, metal=0.0, emit="#FFD08A", strength=6.0,
                            desc="Warm lamp heads, aviation and helipad lights.")),
    ("pipe", dict(hex="#3F6D8C", rough=0.45, metal=0.35,
                  desc="Painted pipework and pump/valve bodies (industrial blue).")),
    ("valve_red", dict(hex="#B0231D", rough=0.5, metal=0.2,
                       desc="Red-painted valve handwheels, check-valve covers and fire equipment.")),
])


def hex_to_lin(h):
    h = h.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(f(c) for c in rgb)


def _principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def get_material(name):
    """Return the contract material `name`, creating it with export-friendly PBR values."""
    if name not in MATERIALS:
        raise KeyError("material %r is not part of the contract" % name)
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    spec = MATERIALS[name]
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = _principled(mat)
    col = hex_to_lin(spec["hex"])
    _set_input(bsdf, ["Base Color"], (*col, 1.0))
    _set_input(bsdf, ["Roughness"], spec["rough"])
    _set_input(bsdf, ["Metallic"], spec["metal"])
    mat.diffuse_color = (*col, spec.get("alpha", 1.0))
    mat.roughness = spec["rough"]
    mat.metallic = spec["metal"]
    if spec.get("emit"):
        _set_input(bsdf, ["Emission Color", "Emission"], (*hex_to_lin(spec["emit"]), 1.0))
        _set_input(bsdf, ["Emission Strength"], spec.get("strength", 1.0))
    alpha = spec.get("alpha", 1.0)
    if alpha < 1.0:
        _set_input(bsdf, ["Alpha"], alpha)
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(mat, attr, val)
            except Exception:
                pass
    mat.use_backface_culling = not spec.get("double", False)
    return mat


def ensure_all_materials():
    return [get_material(n) for n in MATERIALS]


# ---------------------------------------------------------------------------
# Mesh builder
# ---------------------------------------------------------------------------

def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a = pts[i]
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class MeshBuilder:
    """Accumulates faces with material names, smooth flags and optional explicit UVs."""

    def __init__(self, uv_scale=1.0):
        self.verts = []
        self.faces = []
        self.fmat = []
        self.fsmooth = []
        self.fuv = []
        self.stack = [Matrix.Identity(4)]
        self.uv_scale = uv_scale
        # Optional callable(point_world, normal) -> (u, v) for glazing faces
        self.glazing_uv = None
        self.uv_override = {}
        self.fcol = []
        self.col = None  # current per-face colour (grey value or rgb) written to COLOR_0 "AO"

    # -- transforms ---------------------------------------------------------
    @property
    def M(self):
        return self.stack[-1]

    @contextmanager
    def xform(self, m):
        self.stack.append(self.stack[-1] @ m)
        try:
            yield
        finally:
            self.stack.pop()

    def T(self, x=0.0, y=0.0, z=0.0):
        return self.xform(Matrix.Translation((x, y, z)))

    def R(self, angle, axis="Z"):
        return self.xform(Matrix.Rotation(angle, 4, axis))

    def S(self, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        m = Matrix.Identity(4)
        m[0][0], m[1][1], m[2][2] = sx, sy, sz
        return self.xform(m)

    def TR(self, x, y, z, angle):
        return self.xform(Matrix.Translation((x, y, z)) @ Matrix.Rotation(angle, 4, "Z"))

    # -- low level ----------------------------------------------------------
    def face(self, pts, mat, inside=None, smooth=False, uvs=None, col=None):
        """Add a polygon. `pts` are local points; if `inside` (local point) is given the
        face is oriented so its normal points away from it."""
        M = self.M
        wp = [M @ Vector(p) for p in pts]
        if len(wp) < 3:
            return
        n = _newell(wp)
        if n.length < 1e-12:
            return
        flip = False
        if inside is not None:
            c = sum(wp, Vector()) / len(wp)
            if n.dot(c - (M @ Vector(inside))) < 0:
                flip = True
        elif M.determinant() < 0:
            flip = True
        if flip:
            wp = list(reversed(wp))
            if uvs is not None:
                uvs = list(reversed(uvs))
        base = len(self.verts)
        self.verts.extend(wp)
        self.faces.append(tuple(range(base, base + len(wp))))
        self.fmat.append(mat)
        self.fsmooth.append(smooth)
        self.fuv.append(uvs)
        self.fcol.append(col if col is not None else self.col)

    def quad(self, a, b, c, d, mat, inside=None, smooth=False, uvs=None):
        self.face([a, b, c, d], mat, inside, smooth, uvs)

    # -- primitives ---------------------------------------------------------
    def box(self, x0, y0, z0, x1, y1, z1, mat, c=0.0, skip=(), mats=None,
            bevel_vertical=True, bevel_top=True, bevel_bottom=False, col=None):
        if col is not None:
            prev = self.col
            self.col = col
            try:
                return self.box(x0, y0, z0, x1, y1, z1, mat, c, skip, mats, bevel_vertical, bevel_top, bevel_bottom)
            finally:
                self.col = prev
        """Axis-aligned box. `c` = chamfer width.  `mats` maps side names
        ('top','bottom','front'(-y),'back'(+y),'left'(-x),'right'(+x)) to materials.
        `skip` lists sides to omit."""
        if x0 > x1:
            x0, x1 = x1, x0
        if y0 > y1:
            y0, y1 = y1, y0
        if z0 > z1:
            z0, z1 = z1, z0
        mats = mats or {}
        ctr = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        if dx <= 1e-6 or dy <= 1e-6 or dz <= 1e-6:
            return
        if c > 0:
            c = min(c, dx * 0.3, dy * 0.3, dz * 0.3)
        if c <= 1e-4:
            P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                 (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
            sides = {
                "bottom": (0, 1, 2, 3), "top": (4, 5, 6, 7),
                "front": (0, 1, 5, 4), "back": (2, 3, 7, 6),
                "left": (3, 0, 4, 7), "right": (1, 2, 6, 5),
            }
            for s, idx in sides.items():
                if s in skip:
                    continue
                self.face([P[i] for i in idx], mats.get(s, mat), inside=ctr)
            return
        self._chamfer_box(x0, y0, z0, x1, y1, z1, mat, c, skip, mats, ctr,
                          bevel_vertical, bevel_top, bevel_bottom)

    def _chamfer_box(self, x0, y0, z0, x1, y1, z1, mat, c, skip, mats, ctr, bv, bt, bb):
        cv = c if bv else 0.0
        if cv > 0:
            prof = [(x0 + cv, y0), (x1 - cv, y0), (x1, y0 + cv), (x1, y1 - cv),
                    (x1 - cv, y1), (x0 + cv, y1), (x0, y1 - cv), (x0, y0 + cv)]
            side_of = ["front", None, "right", None, "back", None, "left", None]
        else:
            prof = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            side_of = ["front", "right", "back", "left"]
        rect = [(x0 + c, y0 + c), (x1 - c, y0 + c), (x1 - c, y1 - c), (x0 + c, y1 - c)]
        n = len(prof)
        za = z0 + (c if bb else 0.0)
        zb = z1 - (c if bt else 0.0)
        # walls
        for i in range(n):
            j = (i + 1) % n
            s = side_of[i]
            if s in skip:
                continue
            m = mats.get(s, mat) if s else mat
            a, b = prof[i], prof[j]
            self.face([(a[0], a[1], za), (b[0], b[1], za), (b[0], b[1], zb), (a[0], a[1], zb)], m, inside=ctr)

        def cap(zring, zcap, top):
            name = "top" if top else "bottom"
            if name in skip:
                return
            m = mats.get(name, mat)
            if (bt if top else bb):
                if cv > 0:
                    # 4 edge quads + 4 corner triangles + inset rectangle
                    for k in range(4):
                        o0, o1 = prof[2 * k], prof[2 * k + 1]
                        o2 = prof[(2 * k + 2) % 8]
                        r0, r1 = rect[k], rect[(k + 1) % 4]
                        self.face([(o0[0], o0[1], zring), (o1[0], o1[1], zring), (r1[0], r1[1], zcap), (r0[0], r0[1], zcap)], mat, inside=ctr)
                        self.face([(o1[0], o1[1], zring), (o2[0], o2[1], zring), (r1[0], r1[1], zcap)], mat, inside=ctr)
                else:
                    for k in range(4):
                        o0, o1 = prof[k], prof[(k + 1) % 4]
                        r0, r1 = rect[k], rect[(k + 1) % 4]
                        self.face([(o0[0], o0[1], zring), (o1[0], o1[1], zring), (r1[0], r1[1], zcap), (r0[0], r0[1], zcap)], mat, inside=ctr)
                self.face([(p[0], p[1], zcap) for p in rect], m, inside=ctr)
            else:
                self.face([(p[0], p[1], zcap) for p in prof], m, inside=ctr)

        cap(zb, z1, True)
        cap(za, z0, False)

    def cbox(self, cx, cy, z0, w, d, h, mat, **kw):
        """Box from centre-x/centre-y, base z, width (x), depth (y), height."""
        self.box(cx - w / 2, cy - d / 2, z0, cx + w / 2, cy + d / 2, z0 + h, mat, **kw)

    def prism(self, poly, z0, z1, mat, top=True, bottom=False, side_mat=None, top_mat=None, smooth=False):
        """Extrude a 2D polygon (any winding) from z0 to z1."""
        pts = list(poly)
        area = 0.0
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            area += a[0] * b[1] - b[0] * a[1]
        if area < 0:
            pts.reverse()
        n = len(pts)
        sm = side_mat or mat
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            # CCW polygon -> (a,b,b',a') faces outward
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], sm, smooth=smooth)
        if top:
            self.face([(p[0], p[1], z1) for p in pts], top_mat or mat)
        if bottom:
            self.face([(p[0], p[1], z0) for p in reversed(pts)], mat)

    def cylinder(self, cx, cy, z0, z1, r, mat, seg=16, r_top=None, top=True, bottom=True,
                 smooth=True, cap_mat=None, phase=None):
        r_top = r if r_top is None else r_top
        ph = (math.pi / seg) if phase is None else phase
        ctr = (cx, cy, (z0 + z1) / 2)
        ring0 = [(cx + r * math.cos(ph + 2 * math.pi * i / seg), cy + r * math.sin(ph + 2 * math.pi * i / seg), z0) for i in range(seg)]
        ring1 = [(cx + r_top * math.cos(ph + 2 * math.pi * i / seg), cy + r_top * math.sin(ph + 2 * math.pi * i / seg), z1) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            mid_in = (cx, cy, (z0 + z1) / 2)
            self.face([ring0[i], ring0[j], ring1[j], ring1[i]], mat, inside=mid_in, smooth=smooth)
        cm = cap_mat or mat
        if top and r_top > 1e-6:
            self.face(ring1, cm, inside=ctr)
        if bottom and r > 1e-6:
            self.face(ring0, cm, inside=ctr)

    def cyl_between(self, p0, p1, r, mat, seg=12, caps=True, smooth=True, r1=None):
        """Cylinder between two arbitrary points."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return
        rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
        with self.xform(Matrix.Translation(p0) @ rot):
            self.cylinder(0, 0, 0, L, r, mat, seg=seg, r_top=r1, top=caps, bottom=caps, smooth=smooth)

    def lathe(self, profile, mat, seg=24, smooth=True, cx=0.0, cy=0.0, mats=None, phase=0.0):
        """Surface of revolution. `profile` = [(r, z), ...] traversed along the outer
        surface (outward normal = (dz, -dr)).  `mats` optional per-segment materials."""
        for k in range(len(profile) - 1):
            r0, z0 = profile[k]
            r1, z1 = profile[k + 1]
            dr, dz = r1 - r0, z1 - z0
            nrm = Vector((dz, -dr))
            if nrm.length < 1e-9:
                continue
            nrm.normalize()
            m = mats[k] if mats else mat
            for i in range(seg):
                a0 = phase + 2 * math.pi * i / seg
                a1 = phase + 2 * math.pi * (i + 1) / seg
                am = (a0 + a1) / 2
                pts = []
                for (rr, zz, aa) in ((r0, z0, a0), (r0, z0, a1), (r1, z1, a1), (r1, z1, a0)):
                    pts.append((cx + rr * math.cos(aa), cy + rr * math.sin(aa), zz))
                # drop degenerate pole vertices
                clean = []
                for p in pts:
                    if not clean or (Vector(p) - Vector(clean[-1])).length > 1e-7:
                        clean.append(p)
                if len(clean) > 1 and (Vector(clean[0]) - Vector(clean[-1])).length < 1e-7:
                    clean.pop()
                if len(clean) < 3:
                    continue
                rm = (r0 + r1) / 2
                zm = (z0 + z1) / 2
                cpt = Vector((cx + rm * math.cos(am), cy + rm * math.sin(am), zm))
                out = Vector((nrm.x * math.cos(am), nrm.x * math.sin(am), nrm.y))
                self.face(clean, m, inside=tuple(cpt - out * 0.1), smooth=smooth)

    def disc(self, cx, cy, z, r, mat, seg=16, up=True):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z) for i in range(seg)]
        self.face(pts, mat, inside=(cx, cy, z - (1 if up else -1)))

    def sphere(self, cx, cy, cz, r, mat, seg=12, rings=6, sz=None, smooth=True):
        sz = r if sz is None else sz
        prof = []
        for k in range(rings + 1):
            t = -math.pi / 2 + math.pi * k / rings
            prof.append((r * math.cos(t), cz + sz * math.sin(t)))
        self.lathe(prof, mat, seg=seg, smooth=smooth, cx=cx, cy=cy)

    def torus(self, R, r, mat, seg=16, seg_minor=6, smooth=True):
        """Torus in the local XY plane around the origin (axis Z)."""
        for i in range(seg):
            a0 = 2 * math.pi * i / seg
            a1 = 2 * math.pi * (i + 1) / seg
            for k in range(seg_minor):
                b0 = 2 * math.pi * k / seg_minor
                b1 = 2 * math.pi * (k + 1) / seg_minor

                def P(a, b):
                    return ((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))

                am = (a0 + a1) / 2
                inside = (R * math.cos(am), R * math.sin(am), 0.0)
                self.face([P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], mat, inside=inside, smooth=smooth)

    def tube(self, path, radii, mat, seg=8, caps=False, smooth=True, twist=0.0, mats=None):
        """Sweep a circle along a polyline (parallel-transport frames)."""
        path = [Vector(p) for p in path]
        if isinstance(radii, (int, float)):
            radii = [radii] * len(path)
        n = len(path)
        tangents = []
        for i in range(n):
            if i == 0:
                t = path[1] - path[0]
            elif i == n - 1:
                t = path[-1] - path[-2]
            else:
                t = (path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()
            tangents.append(t.normalized())
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        u = tangents[0].cross(ref).normalized()
        frames = []
        for i in range(n):
            if i > 0:
                # parallel transport
                t0, t1 = tangents[i - 1], tangents[i]
                axis = t0.cross(t1)
                if axis.length > 1e-8:
                    ang = math.acos(max(-1.0, min(1.0, t0.dot(t1))))
                    u = (Matrix.Rotation(ang, 3, axis.normalized()) @ u).normalized()
            v = tangents[i].cross(u).normalized()
            frames.append((u.copy(), v))
        rings = []
        for i in range(n):
            u_, v_ = frames[i]
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg + twist * i
                ring.append(path[i] + (u_ * math.cos(a) + v_ * math.sin(a)) * radii[i])
            rings.append(ring)
        for i in range(n - 1):
            m = mats[i] if mats else mat
            for k in range(seg):
                kk = (k + 1) % seg
                mid = (path[i] + path[i + 1]) / 2
                self.face([rings[i][k], rings[i][kk], rings[i + 1][kk], rings[i + 1][k]], m,
                          inside=tuple(mid), smooth=smooth)
        if caps:
            self.face(list(reversed(rings[0])), mat, inside=tuple(path[0] + tangents[0]))
            self.face(rings[-1], mat, inside=tuple(path[-1] - tangents[-1]))

    def beam(self, p0, p1, w, h, mat, up=(0, 0, 1)):
        """Rectangular member between two points (w across, h along `up`)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return
        x = d.normalized()
        upv = Vector(up)
        if abs(x.dot(upv.normalized())) > 0.98:
            upv = Vector((1, 0, 0)) if abs(x.x) < 0.9 else Vector((0, 1, 0))
        y = upv.cross(x).normalized()
        z = x.cross(y).normalized()
        m = Matrix((
            (x.x, y.x, z.x, p0.x),
            (x.y, y.y, z.y, p0.y),
            (x.z, y.z, z.z, p0.z),
            (0, 0, 0, 1)))
        with self.xform(m):
            self.box(0, -w / 2, -h / 2, L, w / 2, h / 2, mat)

    def merge_mesh_data(self, verts, polys, mat, matrix=None, smooth=False):
        """Append raw mesh data (e.g. converted text)."""
        M = self.M @ (matrix or Matrix.Identity(4))
        flip = M.determinant() < 0
        for poly in polys:
            wp = [M @ Vector(verts[i]) for i in poly]
            if flip:
                wp.reverse()
            base = len(self.verts)
            self.verts.extend(wp)
            self.faces.append(tuple(range(base, base + len(wp))))
            self.fmat.append(mat)
            self.fsmooth.append(smooth)
            self.fuv.append(None)
            self.fcol.append(self.col)

    # -- stats --------------------------------------------------------------
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def bounds(self):
        if not self.verts:
            return Vector(), Vector()
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    # -- output -------------------------------------------------------------
    def _auto_uv(self, pts, n, mat):
        s = self.uv_scale
        if mat == "glazing" and self.glazing_uv is not None:
            return [self.glazing_uv(p, n) for p in pts]
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        if az >= ax and az >= ay:
            return [(p.x * s, p.y * s if n.z >= 0 else -p.y * s) for p in pts]
        if ax >= ay:
            sg = 1.0 if n.x >= 0 else -1.0
            return [(p.y * s * sg, p.z * s) for p in pts]
        sg = -1.0 if n.y >= 0 else 1.0
        return [(p.x * s * sg, p.z * s) for p in pts]

    def to_mesh(self, name, weld=True):
        # weld coincident vertices that share smooth/flat status so meshes are tidy
        verts = self.verts
        faces = self.faces
        if weld:
            key_to_idx = {}
            remap = []
            new_verts = []
            for v in verts:
                k = (round(v.x, 4), round(v.y, 4), round(v.z, 4))
                idx = key_to_idx.get(k)
                if idx is None:
                    idx = len(new_verts)
                    key_to_idx[k] = idx
                    new_verts.append(v)
                remap.append(idx)
            new_faces = []
            keep = []
            for fi, f in enumerate(faces):
                nf = []
                for i in f:
                    j = remap[i]
                    if not nf or nf[-1] != j:
                        nf.append(j)
                if len(nf) > 1 and nf[0] == nf[-1]:
                    nf.pop()
                if len(set(nf)) >= 3 and len(set(nf)) == len(nf):
                    new_faces.append(tuple(nf))
                    keep.append(fi)
            verts_out, faces_out = new_verts, new_faces
        else:
            verts_out, faces_out = verts, faces
            keep = list(range(len(faces)))
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in verts_out], [], faces_out)
        # materials
        order = []
        for fi in keep:
            m = self.fmat[fi]
            if m not in order:
                order.append(m)
        for m in order:
            me.materials.append(get_material(m))
        idx = [order.index(self.fmat[fi]) for fi in keep]
        me.polygons.foreach_set("material_index", idx)
        # smooth flags
        sm = [bool(self.fsmooth[fi]) for fi in keep]
        try:
            me.polygons.foreach_set("use_smooth", sm)
        except Exception:
            attr = me.attributes.get("sharp_face") or me.attributes.new("sharp_face", "BOOLEAN", "FACE")
            attr.data.foreach_set("value", [not s for s in sm])
        # UVs
        uvl = me.uv_layers.new(name="UVMap")
        flat = []
        for out_i, fi in enumerate(keep):
            pts = [self.verts[i] for i in self.faces[fi]]
            n = _newell(pts)
            if n.length > 0:
                n.normalize()
            uvs = self.fuv[fi]
            if uvs is None:
                uvs = self._auto_uv(pts, n, self.fmat[fi])
            # faces may have been shortened by welding; match length
            poly = me.polygons[out_i]
            if len(uvs) != poly.loop_total:
                uvs = uvs[:poly.loop_total] if len(uvs) > poly.loop_total else uvs + [uvs[-1]] * (poly.loop_total - len(uvs))
            for uv in uvs:
                flat.extend(uv)
        uvl.data.foreach_set("uv", flat)
        if any(c is not None for c in self.fcol):
            ca = me.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
            cols = []
            for out_i, fi in enumerate(keep):
                c = self.fcol[fi]
                if c is None:
                    c = (1.0, 1.0, 1.0)
                elif isinstance(c, (int, float)):
                    c = (c, c, c)
                for _ in range(me.polygons[out_i].loop_total):
                    cols.extend((c[0], c[1], c[2], 1.0))
            ca.data.foreach_set("color", cols)
            me.color_attributes.active_color = ca
        me.validate(clean_customdata=False)
        me.update()
        return me


def build_object(mb, name, collection, parent=None, weld=True):
    me = mb.to_mesh(name, weld=weld)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def tri_count(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def object_materials(ob):
    return [m.name for m in ob.data.materials if m is not None]


# ---------------------------------------------------------------------------
# Scene / collections
# ---------------------------------------------------------------------------

def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    for cam in list(bpy.data.cameras):
        bpy.data.cameras.remove(cam)
    for li in list(bpy.data.lights):
        bpy.data.lights.remove(li)
    bpy.context.scene.camera = None
    bpy.context.view_layer.update()


def _deselect_all():
    for o in bpy.context.scene.objects:
        try:
            o.select_set(False)
        except Exception:
            pass


def new_collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


# ---------------------------------------------------------------------------
# GPU / ambient occlusion bake into COLOR_0
# ---------------------------------------------------------------------------

_GPU_READY = False


def setup_cycles_gpu(samples=64):
    global _GPU_READY
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    if not _GPU_READY:
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for dt in ("OPTIX", "CUDA"):
                try:
                    prefs.compute_device_type = dt
                    prefs.get_devices()
                    devs = [d for d in prefs.devices if d.type == dt]
                    if devs:
                        for d in prefs.devices:
                            d.use = (d.type == dt)
                        break
                except Exception:
                    continue
            sc.cycles.device = "GPU"
        except Exception as e:  # CPU fallback
            print("GPU setup failed, using CPU:", e)
        _GPU_READY = True
    sc.cycles.samples = samples
    try:
        sc.cycles.use_denoising = False
    except Exception:
        pass


def bake_vertex_ao(objects, distance=6.0, samples=48, strength=0.85, floor=0.38, ground=True,
                   gamma=1.0):
    """Bake ambient occlusion per face corner into a colour attribute 'AO'
    (exported as glTF COLOR_0).  Each object is baked in isolation with an
    optional ground plane so building bases darken naturally."""
    sc = bpy.context.scene
    setup_cycles_gpu(samples)
    if sc.world is None:
        sc.world = bpy.data.worlds.new("BakeWorld")
    sc.world.light_settings.distance = distance
    all_obs = [o for o in sc.objects]
    saved = {o.name: o.hide_render for o in all_obs}
    plane = None
    if ground:
        pm = bpy.data.meshes.new("_bake_ground")
        s = 400.0
        pm.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        plane = bpy.data.objects.new("_bake_ground", pm)
        sc.collection.objects.link(plane)
    try:
        for ob in objects:
            if ob.type != "MESH" or len(ob.data.polygons) == 0:
                continue
            for o in sc.objects:
                o.hide_render = True
            ob.hide_render = False
            if plane is not None:
                plane.hide_render = False
                # ground plane sits at the object's lowest world z
                zmin = min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
                plane.location = (ob.matrix_world.translation.x, ob.matrix_world.translation.y, min(0.0, zmin) if zmin > -0.5 else zmin - 0.01)
            me = ob.data
            ca = me.color_attributes.get("AO")
            if ca is None:
                ca = me.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
            me.color_attributes.active_color = ca
            try:
                me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
            except Exception:
                pass
            _deselect_all()
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
            n = len(ca.data)
            buf = [0.0] * (n * 4)
            ca.data.foreach_get("color", buf)
            for i in range(n):
                ao = buf[i * 4]
                if gamma != 1.0:
                    ao = ao ** gamma
                v = 1.0 - strength * (1.0 - ao)
                v = max(floor, min(1.0, v))
                buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v
                buf[i * 4 + 3] = 1.0
            ca.data.foreach_set("color", buf)
            me.update()
    finally:
        for o in sc.objects:
            if o.name in saved:
                o.hide_render = saved[o.name]
        if plane is not None:
            m = plane.data
            bpy.data.objects.remove(plane, do_unlink=True)
            bpy.data.meshes.remove(m)


STONE_TINTS = {
    "white": (1.0, 1.0, 1.0),
    "cream": (1.0, 0.962, 0.9),
    "beige": (0.975, 0.915, 0.83),
    "sand": (0.95, 0.885, 0.775),
}


def apply_facade_tint(ob, tint, mats=("facade", "facade_alt")):
    """Multiply COLOR_0 ('AO') by a stone tint on faces using the given materials, giving
    per-variant white / cream / beige / sand variety without extra materials."""
    if isinstance(tint, str):
        tint = STONE_TINTS[tint]
    if tint == (1.0, 1.0, 1.0):
        return
    me = ob.data
    ca = me.color_attributes.get("AO")
    if ca is None:
        ca = me.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
        ca.data.foreach_set("color", [1.0] * (len(ca.data) * 4))
        me.color_attributes.active_color = ca
    idx = {i for i, m in enumerate(me.materials) if m is not None and m.name.split(".")[0] in mats}
    buf = [0.0] * (len(ca.data) * 4)
    ca.data.foreach_get("color", buf)
    for poly in me.polygons:
        if poly.material_index not in idx:
            continue
        for li in poly.loop_indices:
            for c in range(3):
                buf[li * 4 + c] *= tint[c]
    ca.data.foreach_set("color", buf)
    me.update()


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _select_tree(objs):
    _deselect_all()
    sel = []

    def rec(o):
        sel.append(o)
        for c in o.children:
            rec(c)

    for o in objs:
        rec(o)
    for o in sel:
        o.hide_set(False)
        o.select_set(True)
    return sel


def export_glb(objs, path, image_format="AUTO"):
    """Export the given root objects (and their children) to a GLB."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _select_tree(objs)
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_image_format=image_format,
    )
    try:
        bpy.ops.export_scene.gltf(export_vertex_color="ACTIVE", export_all_vertex_colors=False, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    _deselect_all()


# ---------------------------------------------------------------------------
# Coordinate helpers (Blender Z-up, front -Y  ->  three.js Y-up, front +Z)
# ---------------------------------------------------------------------------

def to_three(p):
    """Blender (x, y, z) -> three.js (x, y, z)."""
    return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]


def rnd(seed):
    return random.Random(seed)
