"""
Reusable procedural parts for facilities, the underground kit and the skyline:
insulators, lattice members, pipes with bends, flanges, valves, pumps, railings,
fences, louvres, dishes and 3D lettering.
"""

import math

import bpy
from mathutils import Matrix, Vector

PIPE_R = 0.9   # design visual radius of the scene's main pipes


def frame_from_axis(origin, axis):
    """4x4 matrix whose local +Z is `axis`, placed at `origin`."""
    a = Vector(axis).normalized()
    rot = a.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return Matrix.Translation(Vector(origin)) @ rot


def insulator(mb, x, y, z0, h, r=0.18, sheds=6, mat="facade", cap_mat="metal", seg=10):
    """Ribbed porcelain/polymer insulator standing on (x, y, z0)."""
    prof = [(r * 0.75, 0.0)]
    n = sheds
    for i in range(n):
        zc = 0.12 * h + (h * 0.8) * (i + 0.5) / n
        prof += [(r * 0.75, zc - 0.05 * h), (r * 1.9, zc - 0.015 * h), (r * 1.9, zc + 0.005 * h), (r * 0.75, zc + 0.03 * h)]
    prof += [(r * 0.75, h * 0.94), (0.0, h * 0.94)]
    with mb.T(x, y, z0):
        mb.lathe(prof, mat, seg=seg, smooth=True)
        mb.cylinder(0, 0, 0, 0.12 * h, r * 1.05, cap_mat, seg=seg)
        mb.cylinder(0, 0, h * 0.92, h, r * 0.9, cap_mat, seg=seg)


def insulator_between(mb, p0, p1, r=0.14, sheds=6, mat="facade"):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    with mb.xform(frame_from_axis(p0, d)):
        insulator(mb, 0, 0, 0, d.length, r=r, sheds=sheds, mat=mat)


def lattice_column(mb, x, y, z0, z1, w0, w1=None, mat="metal", leg=0.14, brace=0.07, panels=None):
    """Four-legged tapered lattice column with X bracing."""
    w1 = w0 if w1 is None else w1
    H = z1 - z0
    panels = panels or max(2, int(round(H / max(1.2, w0 * 1.1))))
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]

    def P(c, t):
        w = w0 + (w1 - w0) * t
        return Vector((x + c[0] * w / 2, y + c[1] * w / 2, z0 + H * t))

    for c in corners:
        mb.beam(P(c, 0), P(c, 1), leg, leg, mat, up=(1, 0, 0))
    for i in range(panels):
        t0, t1 = i / panels, (i + 1) / panels
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            mb.beam(P(a, t0), P(b, t1), brace, brace, mat)
            mb.beam(P(b, t0), P(a, t1), brace, brace, mat)
            mb.beam(P(a, t1), P(b, t1), brace, brace, mat)


def lattice_beam(mb, p0, p1, w=0.9, h=0.9, mat="metal", leg=0.12, brace=0.06, panels=None):
    """Horizontal box truss between p0 and p1 (along x or y)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    xa = d.normalized()
    ya = Vector((0, 0, 1)).cross(xa).normalized()
    za = Vector((0, 0, 1))
    panels = panels or max(2, int(round(L / max(1.0, h))))
    offs = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]

    def P(o, t):
        return p0 + xa * (L * t) + ya * o[0] + za * o[1]

    for o in offs:
        mb.beam(P(o, 0), P(o, 1), leg, leg, mat)
    for i in range(panels):
        t0, t1 = i / panels, (i + 1) / panels
        for k in range(4):
            a, b = offs[k], offs[(k + 1) % 4]
            if i % 2 == 0:
                mb.beam(P(a, t0), P(b, t1), brace, brace, mat)
            else:
                mb.beam(P(b, t0), P(a, t1), brace, brace, mat)


def rounded_path(points, bend_r=1.0, steps=4):
    """Polyline with arc-rounded corners (for pipes)."""
    pts = [Vector(p) for p in points]
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d0 = (b - a)
        d1 = (c - b)
        if d0.length < 1e-6 or d1.length < 1e-6:
            continue
        d0n, d1n = d0.normalized(), d1.normalized()
        ang = math.acos(max(-1.0, min(1.0, d0n.dot(d1n))))
        if ang < 1e-3:
            out.append(b)
            continue
        r = min(bend_r, d0.length * 0.45, d1.length * 0.45)
        t = r * math.tan(ang / 2)
        t = min(t, d0.length * 0.45, d1.length * 0.45)
        s0 = b - d0n * t
        s1 = b + d1n * t
        for k in range(steps + 1):
            u = k / steps
            # quadratic bezier approximates the arc well enough for pipes
            p = (1 - u) ** 2 * s0 + 2 * (1 - u) * u * b + u * u * s1
            out.append(p)
    out.append(pts[-1])
    return out


def pipe(mb, points, r=PIPE_R, mat="pipe", seg=14, bend_r=None, caps=False):
    path = rounded_path(points, bend_r if bend_r is not None else r * 2.2)
    mb.tube(path, r, mat, seg=seg, caps=caps, smooth=True)


def flange(mb, center, axis, r=PIPE_R, mat="pipe", t=0.22, seg=16, bolts=True):
    c = Vector(center)
    a = Vector(axis).normalized()
    with mb.xform(frame_from_axis(c - a * (t / 2), a)):
        mb.cylinder(0, 0, 0, t, r * 1.32, mat, seg=seg, smooth=True)
        if bolts:
            for i in range(8):
                ang = 2 * math.pi * i / 8
                mb.cylinder(math.cos(ang) * r * 1.18, math.sin(ang) * r * 1.18, -0.06, t + 0.06, 0.06, "steel_dark", seg=6, smooth=False)


def handwheel(mb, center, axis, R=0.7, mat="valve_red"):
    c = Vector(center)
    with mb.xform(frame_from_axis(c, axis)):
        mb.torus(R, 0.07, mat, seg=18, seg_minor=6)
        for i in range(4):
            ang = math.pi * i / 2 + math.pi / 4
            mb.beam((0, 0, 0), (math.cos(ang) * R, math.sin(ang) * R, 0), 0.07, 0.07, mat)
        mb.cylinder(0, 0, -0.1, 0.1, 0.14, mat, seg=8)


def gate_valve(mb, center, axis, r=PIPE_R, stem_up=(0, 0, 1), body_mat="pipe", wheel_mat="valve_red"):
    """Inline gate valve: flanged body, bonnet, stem and handwheel.  `axis` = pipe axis."""
    c = Vector(center)
    a = Vector(axis).normalized()
    up = Vector(stem_up).normalized()
    L = r * 2.4
    flange(mb, c - a * (L / 2), a, r, body_mat)
    flange(mb, c + a * (L / 2), a, r, body_mat)
    with mb.xform(frame_from_axis(c - a * (L / 2), a)):
        mb.cylinder(0, 0, 0, L, r * 1.08, body_mat, seg=16)
    # body bulge and bonnet along `up`
    with mb.xform(frame_from_axis(c, up)):
        mb.cylinder(0, 0, 0, r * 1.7, r * 0.95, body_mat, seg=14, r_top=r * 0.75)
        mb.cylinder(0, 0, r * 1.7, r * 1.85, r * 0.95, body_mat, seg=14)
        mb.cylinder(0, 0, r * 1.85, r * 3.3, 0.09, "metal", seg=8)
    handwheel(mb, c + up * (r * 3.1), up, R=r * 0.85, mat=wheel_mat)


def check_valve(mb, center, axis, r=PIPE_R, up=(0, 0, 1), body_mat="pipe", cover_mat="valve_red"):
    c = Vector(center)
    a = Vector(axis).normalized()
    u = Vector(up).normalized()
    L = r * 2.8
    flange(mb, c - a * (L / 2), a, r, body_mat)
    flange(mb, c + a * (L / 2), a, r, body_mat)
    with mb.xform(frame_from_axis(c - a * (L / 2), a)):
        mb.lathe([(r * 1.05, 0.0), (r * 1.35, L * 0.3), (r * 1.35, L * 0.7), (r * 1.05, L)], body_mat, seg=16)
    with mb.xform(frame_from_axis(c, u)):
        mb.cylinder(0, 0, r * 1.1, r * 1.55, r * 0.9, cover_mat, seg=14)
        mb.lathe([(r * 0.9, r * 1.55), (r * 0.6, r * 1.75), (0.0, r * 1.82)], cover_mat, seg=14)
        # counterweight lever
    lever0 = c + u * (r * 1.3) + a.cross(u).normalized() * (r * 1.0)
    mb.beam(lever0, lever0 + a * (r * 1.6) - u * (r * 0.4), 0.12, 0.12, "steel_dark")
    mb.sphere(*(lever0 + a * (r * 1.6) - u * (r * 0.4)), 0.25, "steel_dark", seg=8, rings=4)


def pump_unit(mb, origin, direction=1, r=PIPE_R, base_z=None):
    """Horizontal end-suction pump with motor.  `origin` = centre of the suction flange
    (on the pump axis); the pump body extends along +x*direction.  Returns the discharge
    nozzle top point."""
    o = Vector(origin)
    d = direction
    ax = Vector((d, 0, 0))
    zc = o.z
    floor = base_z if base_z is not None else zc - r * 2.6
    def X(t):
        return o.x + d * t
    # inertia block / baseplate
    x0, x1 = sorted((X(0.6), X(9.0)))
    mb.box(x0, o.y - 1.7, floor, x1, o.y + 1.7, floor + 0.55, "concrete", c=0.05)
    mb.box(x0 + 0.2, o.y - 1.4, floor + 0.55, x1 - 0.2, o.y + 1.4, floor + 0.75, "steel_dark")
    # suction flange + reducer
    flange(mb, (X(0.15), o.y, zc), ax, r, "pipe")
    with mb.xform(frame_from_axis(Vector((X(0.25), o.y, zc)), ax)):
        mb.cylinder(0, 0, 0, 1.2, r, "pipe", seg=16, r_top=r * 0.78)
    # volute casing (spiral approximated by an offset drum)
    vc = Vector((X(2.15), o.y, zc))
    with mb.xform(frame_from_axis(vc - ax * 0.75, ax)):
        mb.lathe([(r * 0.8, 0.0), (r * 1.9, 0.18), (r * 1.95, 0.75), (r * 1.9, 1.32), (r * 0.8, 1.5)], "pipe", seg=20)
    # tangential discharge nozzle (up)
    nz0 = zc + r * 1.2
    nz1 = zc + r * 2.75
    mb.cylinder(vc.x, o.y - r * 0.55, nz0, nz1, r * 0.72, "pipe", seg=14)
    flange(mb, (vc.x, o.y - r * 0.55, nz1 - 0.1), (0, 0, 1), r * 0.72, "pipe")
    # pedestal feet under volute
    mb.box(vc.x - 0.5, o.y - 1.0, floor + 0.75, vc.x + 0.5, o.y + 1.0, zc - r * 1.5, "pipe")
    # bearing frame
    with mb.xform(frame_from_axis(Vector((X(2.9), o.y, zc)), ax)):
        mb.cylinder(0, 0, 0, 1.4, r * 0.6, "pipe", seg=12)
    bx0, bx1 = sorted((X(3.0), X(4.2)))
    mb.box(bx0, o.y - 0.5, floor + 0.75, bx1, o.y + 0.5, zc - r * 0.5, "pipe")
    # coupling guard
    gx0, gx1 = sorted((X(4.3), X(5.3)))
    mb.box(gx0, o.y - r * 0.8, zc - r * 0.8, gx1, o.y + r * 0.8, zc + r * 0.75, "accent", c=0.08)
    # motor with cooling fins
    mx = X(5.4)
    with mb.xform(frame_from_axis(Vector((mx, o.y, zc)), ax)):
        mb.cylinder(0, 0, 0, 3.3, r * 1.25, "steel_dark", seg=18)
        for i in range(7):
            zf = 0.35 + i * 0.42
            mb.cylinder(0, 0, zf, zf + 0.12, r * 1.42, "steel_dark", seg=18, smooth=True)
        mb.cylinder(0, 0, 3.3, 3.9, r * 1.1, "metal", seg=18, r_top=r * 0.9)
    # motor feet and terminal box
    fx0, fx1 = sorted((X(5.7), X(8.3)))
    mb.box(fx0, o.y - r * 1.3, floor + 0.75, fx1, o.y + r * 1.3, zc - r * 1.0, "steel_dark")
    tx = X(6.8)
    mb.box(tx - 0.45, o.y - 0.45, zc + r * 1.2, tx + 0.45, o.y + 0.45, zc + r * 1.75, "steel_dark", c=0.04)
    return Vector((vc.x, o.y - r * 0.55, nz1))


def railing(mb, pts, h=1.1, mat="metal", post_every=1.6, closed=False):
    P = [Vector(p) for p in pts]
    if closed:
        P = P + [P[0]]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        L = (b - a).length
        n = max(1, int(L / post_every))
        for k in range(n + 1):
            q = a + (b - a) * (k / n)
            mb.box(q.x - 0.03, q.y - 0.03, q.z, q.x + 0.03, q.y + 0.03, q.z + h, mat)
        mb.beam(a + Vector((0, 0, h)), b + Vector((0, 0, h)), 0.06, 0.06, mat)
        mb.beam(a + Vector((0, 0, h * 0.5)), b + Vector((0, 0, h * 0.5)), 0.04, 0.04, mat)


def palisade(mb, pts, h=2.6, mat="metal", pale_every=0.55, post_every=3.0, gaps=()):
    """Palisade fence along a polyline.  Pales are thin flat strips."""
    P = [Vector(p) for p in pts]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        d = b - a
        L = d.length
        if L < 1e-6:
            continue
        t = d.normalized()
        nrm = Vector((-t.y, t.x, 0))
        n = int(L / pale_every)
        for k in range(n + 1):
            s = k * pale_every
            q = a + t * s
            skip = False
            for (gx, gy, gw) in gaps:
                if abs(q.x - gx) < gw / 2 and abs(q.y - gy) < gw / 2:
                    skip = True
            if skip:
                continue
            w = 0.07
            p0 = q - t * w / 2
            p1 = q + t * w / 2
            top = h - 0.15 * (k % 2)
            mb.face([(p0.x, p0.y, 0.05), (p1.x, p1.y, 0.05), (p1.x, p1.y, top), (p0.x, p0.y, top)], mat)
            mb.face([(p1.x, p1.y, 0.05), (p0.x, p0.y, 0.05), (p0.x, p0.y, top), (p1.x, p1.y, top)], mat)
        m = max(1, int(L / post_every))
        for k in range(m + 1):
            q = a + t * (L * k / m)
            skip = False
            for (gx, gy, gw) in gaps:
                if abs(q.x - gx) < gw / 2 and abs(q.y - gy) < gw / 2:
                    skip = True
            if not skip:
                mb.box(q.x - 0.06, q.y - 0.06, 0.0, q.x + 0.06, q.y + 0.06, h + 0.1, "steel_dark")
        for zr in (0.35, h - 0.4):
            mb.beam(a + Vector((0, 0, zr)) + nrm * 0.05, b + Vector((0, 0, zr)) + nrm * 0.05, 0.05, 0.07, mat)


def louvre_band(mb, axis, fixed, a0, a1, z0, z1, mat="trim", pitch=0.25, out=0.12, sign=-1):
    """Horizontal louvre slats on a vertical wall plane (x- or y-facing)."""
    n = max(1, int((z1 - z0) / pitch))
    for i in range(n):
        z = z0 + (i + 0.5) * (z1 - z0) / n
        if axis == "x":   # wall plane y = fixed, spanning x
            ya, yb = sorted((fixed, fixed + sign * out))
            mb.box(a0, ya, z - 0.04, a1, yb, z + 0.04, mat)
        else:
            xa, xb = sorted((fixed, fixed + sign * out))
            mb.box(xa, a0, z - 0.04, xb, a1, z + 0.04, mat)


def dish(mb, center, facing, R=1.6, depth=0.5, mat="facade", seg=18, mount=True):
    c = Vector(center)
    f = Vector(facing).normalized()
    prof = []
    rings = 5
    for i in range(rings + 1):
        r = R * i / rings
        prof.append((r, depth * (r / R) ** 2))
    with mb.xform(frame_from_axis(c, f)):
        # front (concave) and back faces
        mb.lathe(list(reversed(prof)), mat, seg=seg, smooth=True)
        mb.lathe([(p[0], p[1] - 0.06) for p in prof], mat, seg=seg, smooth=True)
        mb.cylinder(0, 0, depth * 0.1, depth * 1.6, 0.05, "metal", seg=6)
        mb.sphere(0, 0, depth * 1.65, 0.12, "steel_dark", seg=8, rings=4)


def text_polys(text, size=1.0, extrude=0.1, align="CENTER"):
    """Return (verts, polys, bbox) of extruded 3D text using the built-in font."""
    cu = bpy.data.curves.new("_txt", "FONT")
    cu.body = text
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.resolution_u = 2
    try:
        cu.fill_mode = "BOTH"
    except Exception:
        pass
    ob = bpy.data.objects.new("_txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    verts = [v.co.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    xs = [v.x for v in verts] or [0]
    ys = [v.y for v in verts] or [0]
    bbox = (min(xs), max(xs), min(ys), max(ys))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return verts, polys, bbox


def facade_text(mb, text, x, y, z, height, mat="emissive_sign", depth=0.18, facing=(0, -1, 0)):
    """3D lettering standing on a wall.  (x, y, z) = centre of the text bottom on the wall
    surface; letters protrude `depth` along `facing` and read left-to-right from there."""
    ext = 0.1
    verts, polys, bb = text_polys(text, size=1.0, extrude=ext)
    cap = (bb[3] - bb[2]) or 1.0
    s = height / cap
    f = Vector(facing).normalized()
    right = Vector((0, 0, 1)).cross(f).normalized()
    up = Vector((0, 0, 1))
    k = depth / (2 * ext)
    o = Vector((x, y, z)) + f * (depth / 2) - up * (bb[2] * s)
    m = Matrix((
        (right.x * s, up.x * s, f.x * k, o.x),
        (right.y * s, up.y * s, f.y * k, o.y),
        (right.z * s, up.z * s, f.z * k, o.z),
        (0, 0, 0, 1)))
    mb.merge_mesh_data(verts, polys, mat, matrix=m)
    return (bb[1] - bb[0]) * s
