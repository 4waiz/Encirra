"""
Props: palms, streetlights, rooftop solar array, planter and bench.

Palms are designed for heavy instancing (<= 1.5k triangles): a curved, ringed trunk
and 12-14 drooping, comb-edged fronds using the double-sided "foliage" material.
The streetlight arm points along local -Y in Blender, i.e. local +Z in three.js,
matching the layout convention (rotation 0 = arm towards +Z / the road centre).
"""

import math
from mathutils import Vector, Matrix
from common import MeshBuilder, build_object, tri_count, object_materials, rnd


def palm(mb, height=10.0, lean=0.9, fronds=12, seed=1, frond_len=4.4, crown_r=0.34):
    r = rnd(seed)
    # ---- trunk: curved path with ring bulges ------------------------------
    n = 15
    path, radii = [], []
    lean_dir = Vector((1.0, 0.25, 0.0)).normalized()
    for i in range(n + 1):
        t = i / n
        off = lean_dir * (lean * t * t)
        path.append(Vector((off.x, off.y, t * height)))
        base = 0.34 * (1.0 - 0.38 * t) + (0.14 * (1 - t) ** 6)
        radii.append(base * (1.07 if i % 2 == 0 else 0.95))
    mb.tube(path, radii, "trunk", seg=7, caps=False, smooth=True)
    top = path[-1]
    tan = (path[-1] - path[-2]).normalized()
    # ---- crown shaft and boots ---------------------------------------------
    with mb.xform(Matrix.Translation(top)):
        mb.lathe([(0.24, -0.1), (0.33, 0.25), (0.30, 0.6), (0.16, 0.85), (0.0, 0.95)], "trunk", seg=7, smooth=True)
    crown = top + Vector((0, 0, 0.7))
    # ---- fronds ---------------------------------------------------------------
    golden = math.pi * (3 - math.sqrt(5))
    for f in range(fronds):
        az = f * golden * 1.0 + r.uniform(-0.15, 0.15)
        # older fronds (lower) droop more
        age = f / max(1, fronds - 1)
        elev = math.radians(48 - 62 * age + r.uniform(-6, 6))
        L = frond_len * (0.85 + 0.3 * r.random()) * (0.92 + 0.16 * age)
        droop = (0.55 + 0.6 * age) * L * 0.42
        d = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        side = Vector((-math.sin(az), math.cos(az), 0.0))
        samples = 12
        spine, left, right = [], [], []
        for s in range(samples + 1):
            u = s / samples
            p = crown + d * (u * L) + Vector((0, 0, -droop * u * u))
            # width profile with comb teeth (leaflets)
            w = 0.62 * (math.sin(math.pi * min(1.0, u * 1.05)) ** 0.75)
            if s % 2 == 1:
                w *= 0.35
            if s == 0:
                w = 0.05
            # leaflets hang down from the rachis
            hang = Vector((0, 0, -0.42 * w - 0.03))
            twist = 0.25 * u
            sv = side * math.cos(twist) + Vector((0, 0, math.sin(twist) * 0.3))
            spine.append(p)
            left.append(p + sv * w + hang)
            right.append(p - sv * w + hang)
        for s in range(samples):
            mb.face([left[s], left[s + 1], spine[s + 1], spine[s]], "foliage", smooth=True)
            mb.face([spine[s], spine[s + 1], right[s + 1], right[s]], "foliage", smooth=True)
    return dict(height=crown.z + 0.6)


def streetlight(mb, height=9.0, arms=1):
    # base plinth
    mb.box(-0.28, -0.28, 0.0, 0.28, 0.28, 0.6, "concrete", c=0.04, skip=("bottom",))
    # tapered pole
    mb.cylinder(0, 0, 0.6, height, 0.12, "steel_dark", seg=8, r_top=0.075, bottom=False)
    dirs = [(0, -1)] if arms == 1 else [(0, -1), (0, 1)]
    for (dx, dy) in dirs:
        # gently curved arm from the pole top towards local -Y (three.js +Z)
        pts = []
        for i in range(5):
            t = i / 4
            pts.append(Vector((dx * 1.9 * t, dy * 1.9 * t, height - 0.25 + 0.45 * math.sin(t * math.pi * 0.5))))
        mb.tube(pts, [0.06, 0.055, 0.05, 0.048, 0.045], "steel_dark", seg=6, caps=False)
        hx, hy = dx * 2.1, dy * 2.1
        hz = height + 0.12
        # luminaire head: slim box with an emissive lens underneath
        with mb.TR(hx, hy, 0, 0.0 if dy != 0 else math.pi / 2):
            mb.box(-0.22, -0.5, hz - 0.1, 0.22, 0.5, hz + 0.06, "steel_dark", c=0.03)
            mb.box(-0.17, -0.42, hz - 0.13, 0.17, 0.42, hz - 0.1, "light_emissive", skip=("top",))
    mb.cylinder(0, 0, height, height + 0.25, 0.075, "steel_dark", seg=8, r_top=0.03, bottom=False)
    return dict(height=height + 0.3)


def solar_array(mb, W=10.0, D=6.0, rows=3, tilt_deg=18.0):
    """Rooftop PV rack: rows of tilted modules facing local -Y (three.js +Z, south)."""
    pitch = D / rows
    panel_d = pitch * 0.78
    tilt = math.radians(tilt_deg)
    for i in range(rows):
        y0 = -D / 2 + i * pitch + 0.15
        lift = panel_d * math.sin(tilt)
        run = panel_d * math.cos(tilt)
        z_lo, z_hi = 0.35, 0.35 + lift
        # module plane (front edge low, back edge high)
        a = (-W / 2 + 0.1, y0, z_lo)
        b = (W / 2 - 0.1, y0, z_lo)
        c = (W / 2 - 0.1, y0 + run, z_hi)
        d = (-W / 2 + 0.1, y0 + run, z_hi)
        mb.face([a, b, c, d], "solar", inside=(0, y0 + run * 0.6, z_lo - 0.5))
        # thin frame underside/edges
        mb.face([d, c, b, a], "trim", inside=(0, y0 + run * 0.4, z_hi + 0.5))
        mb.beam((-W / 2 + 0.1, y0 - 0.02, z_lo - 0.03), (W / 2 - 0.1, y0 - 0.02, z_lo - 0.03), 0.06, 0.06, "trim")
        # module seams
        for k in range(1, 6):
            x = -W / 2 + 0.1 + (W - 0.2) * k / 6
            mb.beam((x, y0, z_lo + 0.012), (x, y0 + run, z_hi + 0.012), 0.04, 0.02, "trim", up=(0, -math.sin(tilt), math.cos(tilt)))
        # supports
        for x in (-W / 2 + 0.6, 0.0, W / 2 - 0.6):
            mb.box(x - 0.05, y0 + 0.05, 0.0, x + 0.05, y0 + 0.15, z_lo, "metal")
            mb.box(x - 0.05, y0 + run - 0.15, 0.0, x + 0.05, y0 + run - 0.05, z_hi, "metal")
            mb.box(x - 0.3, y0, 0.0, x + 0.3, y0 + run, 0.12, "concrete")
    return dict(height=0.35 + panel_d * math.sin(tilt))


def planter(mb):
    mb.box(-1.2, -1.2, 0, 1.2, 1.2, 0.75, "concrete", c=0.06, skip=("bottom",))
    mb.box(-1.05, -1.05, 0.6, 1.05, 1.05, 0.72, "rock")
    # low shrub mound
    r = rnd(5)
    for i in range(5):
        a = i * 2 * math.pi / 5
        mb.sphere(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.95, 0.55 + 0.1 * r.random(), "foliage", seg=7, rings=4, sz=0.45)
    mb.sphere(0, 0, 1.15, 0.6, "foliage", seg=7, rings=4, sz=0.55)
    return dict(height=1.7)


def bench(mb):
    for x in (-0.8, 0.8):
        mb.box(x - 0.08, -0.25, 0, x + 0.08, 0.25, 0.42, "concrete", c=0.02)
    mb.box(-1.0, -0.28, 0.42, 1.0, 0.28, 0.48, "accent", c=0.015)
    for i in range(5):
        mb.box(-1.0, 0.18 + 0.0, 0.48 + i * 0.09, 1.0, 0.26, 0.54 + i * 0.09, "accent")
    return dict(height=0.95)


def build_all(coll_for):
    out = {}
    specs = [
        ("palm", 0, lambda mb: palm(mb, height=10.0, lean=1.1, fronds=12, seed=3, frond_len=4.5)),
        ("palm", 1, lambda mb: palm(mb, height=7.0, lean=0.5, fronds=14, seed=8, frond_len=4.0)),
        ("palm", 2, lambda mb: palm(mb, height=12.5, lean=1.8, fronds=12, seed=13, frond_len=4.7)),
        ("streetlight", 0, lambda mb: streetlight(mb, 9.0, arms=1)),
        ("streetlight", 1, lambda mb: streetlight(mb, 10.0, arms=2)),
        ("solar-array", 0, lambda mb: solar_array(mb)),
        ("planter", 0, lambda mb: planter(mb)),
        ("bench", 0, lambda mb: bench(mb)),
    ]
    for kind, v, fn in specs:
        mb = MeshBuilder()
        info = fn(mb)
        name = "%s_v%d" % (kind, v)
        lo, hi = mb.bounds()
        ob = build_object(mb, name, coll_for(kind))
        rec = dict(id=name, kind=kind, variant=v, node=name,
                   nominalSize=[round(hi.x - lo.x, 2), round(hi.y - lo.y, 2), round(hi.z - max(0.0, lo.z), 2)],
                   tris=tri_count(ob), materials=object_materials(ob))
        out.setdefault(kind, []).append((ob, rec))
    return out
