"""
skyline.glb - stylised, generic background towers (not modelled after any specific
building).  Each tower is one node whose transform carries a suggested world placement
behind / around the district (three.js -Z is the background); the mesh origin is the
tower's base centre.  Materials: facade, glazing, trim, light_emissive (aviation
lights).  <= 3k triangles each.
"""

import math

import bpy
from mathutils import Vector

from common import MeshBuilder, build_object, to_three

STOREY = 4.0


def sky_uv(p, n):
    if abs(n.x) > abs(n.y):
        u = p.y / 3.0
    else:
        u = p.x / 3.0
    return (u, p.z / STOREY)


def aviation(mb, x, y, z, r=0.9):
    mb.sphere(x, y, z, r, "light_emissive", seg=8, rings=4)


def rounded_rect(w, d, c, seg=2):
    """Rounded rectangle polygon (CCW) with corner radius c."""
    pts = []
    corners = [(w / 2 - c, -d / 2 + c, -math.pi / 2), (w / 2 - c, d / 2 - c, 0.0), (-w / 2 + c, d / 2 - c, math.pi / 2), (-w / 2 + c, -d / 2 + c, math.pi)]
    for (cx, cy, a0) in corners:
        for k in range(seg + 1):
            a = a0 + (math.pi / 2) * k / seg
            pts.append((cx + c * math.cos(a), cy + c * math.sin(a)))
    return pts


def loft(mb, sections, mat="glazing", cap_mat="trim", cap=True):
    """sections: list of (z, [(x, y), ...]) with equal vertex counts (CCW)."""
    n = len(sections[0][1])

    def centroid(pts):
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    for i in range(len(sections) - 1):
        z0, p0 = sections[i]
        z1, p1 = sections[i + 1]
        cz = (z0 + z1) / 2
        c0 = centroid(p0)
        for k in range(n):
            j = (k + 1) % n
            a, b = p0[k], p0[j]
            c, d = p1[j], p1[k]
            mb.face([(a[0], a[1], z0), (b[0], b[1], z0), (c[0], c[1], z1), (d[0], d[1], z1)], mat, inside=(c0[0], c0[1], cz))
    if cap:
        zt, pt = sections[-1]
        ct = centroid(pt)
        mb.face([(p[0], p[1], zt) for p in pt], cap_mat, inside=(ct[0], ct[1], zt - 1))


# ---------------------------------------------------------------------------
# towers
# ---------------------------------------------------------------------------

def spire_tower(mb):
    """Stylised supertall: Y-plan wings stepping back in a spiral around a hexagonal core."""
    core_r = 14.0
    wing_w = 19.0
    tiers = 16
    H_core = 600.0
    base_len = 50.0
    for w in range(3):
        ang = math.pi / 2 + w * 2 * math.pi / 3
        dx, dy = math.cos(ang), math.sin(ang)
        px, py = -dy, dx
        z = 0.0
        for t in range(tiers):
            # each wing ends at a different tier (spiral setback)
            frac = 1.0 - ((t + w / 3.0) / tiers) ** 1.8
            if frac <= 0.06:
                break
            L = core_r + (base_len - core_r) * frac
            z0 = t * (H_core * 0.92 / tiers)
            z1 = (t + 1) * (H_core * 0.92 / tiers)
            ww = wing_w * (0.75 + 0.25 * frac)
            c = [(dx * 0 + px * ww / 2, dy * 0 + py * ww / 2), (dx * L + px * ww / 2, dy * L + py * ww / 2),
                 (dx * L - px * ww / 2, dy * L - py * ww / 2), (dx * 0 - px * ww / 2, dy * 0 - py * ww / 2)]
            # rounded wing tip approximated with an extra vertex
            tip = (dx * (L + ww * 0.35), dy * (L + ww * 0.35))
            poly = [c[0], c[1], tip, c[2], c[3]]
            mb.prism(poly, z0, z1, "glazing", top=True, top_mat="facade")
            # silver fin along the wing tip
            mb.box(tip[0] - 0.8, tip[1] - 0.8, z0, tip[0] + 0.8, tip[1] + 0.8, z1 + 2.0, "facade")
            # setback ledge band
            mb.prism([(x * 1.0, y * 1.0) for (x, y) in poly], z1 - 1.2, z1, "trim", top=False)
    # hexagonal core
    hexa = [(core_r * math.cos(k * math.pi / 3 + math.pi / 6), core_r * math.sin(k * math.pi / 3 + math.pi / 6)) for k in range(6)]
    mb.prism(hexa, 0.0, H_core, "glazing", top=True, top_mat="trim")
    for z in range(40, int(H_core), 60):
        mb.prism([(x * 1.04, y * 1.04) for (x, y) in hexa], z, z + 2.0, "facade", top=True)
    # tapered upper core and spire
    mb.cylinder(0, 0, H_core, H_core + 70.0, core_r * 0.85, "glazing", seg=6, r_top=core_r * 0.45, phase=math.pi / 6)
    mb.cylinder(0, 0, H_core + 70.0, H_core + 175.0, core_r * 0.42, "facade", seg=6, r_top=0.6, phase=math.pi / 6)
    for z in (H_core + 72.0, H_core + 120.0, H_core + 172.0):
        aviation(mb, 0, 0, z, 1.4)
    for w in range(3):
        ang = math.pi / 2 + w * 2 * math.pi / 3
        aviation(mb, math.cos(ang) * 30.0, math.sin(ang) * 30.0, H_core * 0.6, 1.2)
    return dict(height=H_core + 176.0)


def twist_tower(mb, H=310.0, w=34.0, twist=math.pi / 2):
    n = 36
    sections = []
    for i in range(n + 1):
        t = i / n
        a = twist * t
        s = 1.0 - 0.12 * t
        pts = []
        for (x, y) in rounded_rect(w * s, w * s, 7.0 * s, seg=1):
            pts.append((x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)))
        sections.append((H * t, pts))
    loft(mb, sections, "glazing", "trim")
    for i in range(0, n + 1, 4):
        z, pts = sections[i]
        ring = [(x * 1.03, y * 1.03) for (x, y) in pts]
        mb.prism(ring, z - 0.8, z + 0.8, "facade", top=True, bottom=True)
    mb.cylinder(0, 0, H, H + 30.0, 1.6, "trim", seg=8, r_top=0.3)
    aviation(mb, 0, 0, H + 30.5, 1.0)
    return dict(height=H + 31.0)


def sail_tower(mb, H=320.0):
    """Sail-like plan: a convex glazed 'sail' against a straight spine with a white frame."""
    sections = []
    n = 24
    for i in range(n + 1):
        t = i / n
        depth = 46.0 * (1.0 - 0.75 * t ** 1.6)
        width = 58.0 * (1.0 - 0.55 * t ** 1.3)
        pts = []
        arc = 9
        for k in range(arc + 1):
            a = -math.pi / 2 + math.pi * k / arc
            pts.append((width / 2 * math.sin(a), -depth * math.cos(a) * 0.95))
        pts.reverse()
        # back chord points (closing at y = 0)
        sections.append((H * 0.9 * t, pts))
    # make CCW
    loft(mb, [(z, list(reversed(p))) for (z, p) in sections], "glazing", "trim")
    # white exoskeleton legs along both chord ends, converging to the mast
    top = H * 0.9
    for sx in (-1, 1):
        mb.beam((sx * 31.0, 2.0, 0.0), (sx * 4.0, 2.0, top + 12.0), 4.0, 4.0, "facade")
        mb.beam((sx * 31.0, 2.0, 0.0), (sx * 31.0, 2.0, 30.0), 4.5, 4.5, "facade")
    for z in (70.0, 140.0, 200.0):
        sc = 1.0 - 0.55 * (z / top) ** 1.3
        mb.beam((-29.0 * sc - 1.0, 4.0, z), (29.0 * sc + 1.0, 4.0, z + 1.0), 2.0, 2.0, "facade")
    mb.cylinder(0, 2.0, top + 10.0, H + 40.0, 1.6, "facade", seg=8, r_top=0.4)
    # circular sky deck near the top
    mb.cylinder(0, -20.0, top - 30.0, top - 27.0, 12.0, "facade", seg=16)
    aviation(mb, 0, 2.0, H + 40.5, 1.0)
    return dict(height=H + 41.0)


def faceted_tower(mb, H, w, d, cham, crown="pyramid", band_every=6, fins=True):
    poly = [(-w / 2 + cham, -d / 2), (w / 2 - cham, -d / 2), (w / 2, -d / 2 + cham), (w / 2, d / 2 - cham),
            (w / 2 - cham, d / 2), (-w / 2 + cham, d / 2), (-w / 2, d / 2 - cham), (-w / 2, -d / 2 + cham)]
    mb.prism(poly, 0.0, H, "glazing", top=False)
    for k in range(1, int(H / (STOREY * band_every))):
        z = k * STOREY * band_every
        mb.prism([(x * 1.02, y * 1.02) for (x, y) in poly], z - 0.7, z + 0.7, "facade", top=True, bottom=True)
    if fins:
        for (x, y) in poly:
            mb.box(x - 0.7, y - 0.7, 0.0, x + 0.7, y + 0.7, H + 2.0, "facade")
    if crown == "pyramid":
        mb.cylinder(0, 0, H, H + 0.8 * min(w, d), min(w, d) * 0.6, "glazing", seg=8, r_top=1.0, phase=math.pi / 8)
        mb.cylinder(0, 0, H + 0.8 * min(w, d), H + 0.8 * min(w, d) + 40.0, 0.9, "trim", seg=6, r_top=0.2)
        top = H + 0.8 * min(w, d) + 40.0
    elif crown == "flat":
        mb.prism([(x * 0.96, y * 0.96) for (x, y) in poly], H, H + 6.0, "trim", top=True)
        top = H + 6.0
    else:  # slanted
        hi = 18.0
        pts_b = [(x, y, H) for (x, y) in poly]
        pts_t = [(x, y, H + hi * (0.5 + x / w)) for (x, y) in poly]
        for k in range(len(poly)):
            j = (k + 1) % len(poly)
            mb.face([pts_b[k], pts_b[j], pts_t[j], pts_t[k]], "glazing", inside=(0, 0, H))
        mb.face(pts_t, "trim", inside=(0, 0, H - 10))
        top = H + hi
    aviation(mb, 0, 0, top + 0.5, 0.9)
    return dict(height=top + 1.0)


def stepped_tower(mb, H=260.0, w=40.0, d=34.0):
    tiers = [(0.0, 0.45, 1.0), (0.45, 0.72, 0.82), (0.72, 0.9, 0.64), (0.9, 1.0, 0.46)]
    for (a, b, s) in tiers:
        z0, z1 = H * a, H * b
        ww, dd = w * s, d * s
        mb.box(-ww / 2, -dd / 2, z0, ww / 2, dd / 2, z1, "glazing", skip=("bottom",), mats={"top": "trim"})
        for k in range(-3, 4):
            x = k * ww / 7
            mb.box(x - 0.5, -dd / 2 - 0.6, z0, x + 0.5, -dd / 2 + 0.2, z1, "facade")
            mb.box(x - 0.5, dd / 2 - 0.2, z0, x + 0.5, dd / 2 + 0.6, z1, "facade")
        mb.box(-ww / 2 - 0.6, -dd / 2 - 0.6, z1 - 1.5, ww / 2 + 0.6, dd / 2 + 0.6, z1, "facade")
    mb.cylinder(0, 0, H, H + 25.0, 1.0, "trim", seg=6, r_top=0.2)
    aviation(mb, 0, 0, H + 25.5, 0.9)
    return dict(height=H + 26.0)


def slim_glass(mb, H, w, d, round_c=6.0, crown_h=10.0):
    poly = rounded_rect(w, d, round_c, seg=2)
    mb.prism(poly, 0.0, H, "glazing", top=False)
    for k in range(1, int(H / 40.0)):
        z = k * 40.0
        mb.prism([(x * 1.02, y * 1.02) for (x, y) in poly], z - 0.5, z + 0.5, "trim", top=True, bottom=True)
    mb.prism([(x * 0.94, y * 0.94) for (x, y) in poly], H, H + crown_h, "glazing", top=True, top_mat="trim")
    mb.prism([(x * 1.01, y * 1.01) for (x, y) in poly], H + crown_h, H + crown_h + 1.0, "trim", top=True)
    aviation(mb, 0, 0, H + crown_h + 1.6, 0.8)
    return dict(height=H + crown_h + 2.0)


def marina_tower(mb, H, w, d, seed=0):
    poly = rounded_rect(w, d, min(w, d) * 0.3, seg=2)
    mb.prism(poly, 0.0, H, "glazing", top=False)
    z = 8.0
    k = 0
    while z < H - 2.0:
        sc = 1.06 if k % 2 == 0 else 1.04
        mb.prism([(x * sc, y * sc) for (x, y) in poly], z - 0.35, z, "facade", top=True, bottom=True)
        z += 3.4 * (2 if k % 3 == 2 else 1)
        k += 1
    # vertical stone spine on the front
    mb.box(-3.0, -d / 2 * 1.08, 0.0, 3.0, -d / 2 + 2.0, H + 8.0, "facade")
    mb.prism([(x * 1.08, y * 1.08) for (x, y) in poly], H, H + 1.2, "facade", top=True, bottom=True)
    mb.prism([(x * 0.7, y * 0.7) for (x, y) in poly], H + 1.2, H + 7.0, "trim", top=True)
    aviation(mb, 0, 0, H + 8.6, 0.8)
    return dict(height=H + 9.0)


# suggested placements in three.js coordinates (x, z); y = 0
TOWERS = [
    ("skyline_spire", lambda mb: spire_tower(mb), (-560.0, -1150.0), 0.35),
    ("skyline_twist", lambda mb: twist_tower(mb), (430.0, -760.0), 0.2),
    ("skyline_sail", lambda mb: sail_tower(mb), (960.0, -420.0), -0.6),
    ("skyline_twin_a", lambda mb: faceted_tower(mb, 300.0, 34.0, 34.0, 8.0, "pyramid"), (-860.0, -690.0), 0.0),
    ("skyline_twin_b", lambda mb: faceted_tower(mb, 270.0, 32.0, 32.0, 8.0, "pyramid"), (-790.0, -760.0), 0.0),
    ("skyline_stepped", lambda mb: stepped_tower(mb), (150.0, -1020.0), 0.1),
    ("skyline_glass_a", lambda mb: slim_glass(mb, 230.0, 30.0, 24.0), (-320.0, -720.0), 0.3),
    ("skyline_glass_b", lambda mb: slim_glass(mb, 200.0, 26.0, 26.0, 8.0, 14.0), (700.0, -1060.0), -0.2),
    ("skyline_glass_c", lambda mb: faceted_tower(mb, 210.0, 30.0, 24.0, 5.0, "slanted", 5), (-1080.0, -470.0), 0.4),
    ("skyline_marina_a", lambda mb: marina_tower(mb, 190.0, 30.0, 24.0, 1), (1130.0, -160.0), -0.4),
    ("skyline_marina_b", lambda mb: marina_tower(mb, 170.0, 28.0, 26.0, 2), (-1220.0, -150.0), 0.5),
    ("skyline_marina_c", lambda mb: marina_tower(mb, 150.0, 26.0, 22.0, 3), (320.0, -1320.0), 0.0),
    ("skyline_twist_b", lambda mb: twist_tower(mb, 240.0, 28.0, -math.pi / 3), (-150.0, -1450.0), 0.0),
]


def build_group():
    coll = bpy.data.collections.get("KIT_skyline") or bpy.data.collections.new("KIT_skyline")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    items = []
    for (name, fn, (tx, tz), rot) in TOWERS:
        mb = MeshBuilder()
        mb.glazing_uv = sky_uv
        info = fn(mb)
        ob = build_object(mb, name, coll)
        # three.js (x, z) -> Blender (x, -z); rotation about +Y == rotation about +Z in Blender
        ob.location = (tx, -tz, 0.0)
        ob.rotation_euler = (0.0, 0.0, rot)
        lo, hi = mb.bounds()
        rec = dict(id=name, kind="skyline", variant=len(items), node=name,
                   nominalSize=[round(hi.x - lo.x, 1), round(hi.y - lo.y, 1), round(hi.z - lo.z, 1)],
                   placement={"position": [tx, 0.0, tz], "rotationY": rot},
                   anchors={"top": [0.0, round(info["height"], 1), 0.0]},
                   notes="Background tower (generic, stylised). Node transform = suggested placement; mesh origin = base centre.")
        items.append((ob, rec))
    return {"skyline": items}


def _skyline_preview(roots, path, res):
    import render_preview as pv
    # 1) lineup of every tower (placement temporarily cleared)
    saved = [(o, o.location.copy(), o.rotation_euler.copy()) for o in roots]
    for o in roots:
        o.location = (0.0, 0.0, 0.0)
        o.rotation_euler = (0.0, 0.0, 0.0)
    try:
        pv.preview_lineup(roots, path.replace(".png", "_lineup.png"), res=res, azim=20.0, elev=6.0, gap=25.0, lens=50.0, margin=1.04, samples=24)
    finally:
        for o, loc, rot in saved:
            o.location = loc
            o.rotation_euler = rot
        bpy.context.view_layer.update()
    # 2) suggested placement seen from the district
    pv.setup_render(res, 32)
    restore = pv.isolate_render(roots)
    try:
        sc = bpy.context.scene
        cam = sc.camera
        if cam is None:
            cd = bpy.data.cameras.new("_pv_cam")
            cam = bpy.data.objects.new("_pv_cam", cd)
            sc.collection.objects.link(cam)
            sc.camera = cam
        # view from the district towards the background (three.js -Z = Blender +Y)
        cam.data.lens = 28.0
        cam.data.clip_end = 20000.0
        cam.location = (0.0, -600.0, 220.0)
        d = Vector((0.0, 900.0, 260.0)) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        pv.render_to(path)
    finally:
        restore()


PREVIEW_OPTS = {"skyline": {"custom": _skyline_preview}}
