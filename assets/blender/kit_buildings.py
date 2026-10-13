"""
Building kit: tower-residential, tower-office, midrise-residential, lowrise-residential,
villa and commercial-podium variants.

Each variant is one mesh object named "<kind>_v<n>" with its origin at the centre of
the footprint at ground level.  Everything stays inside the nominal footprint so the
scene can scale each variant non-uniformly to a layout footprint/height.

Glazing UV0 convention: v = storey coordinate (lobby = 0..1, every storey above adds
1.0, aligned with the modelled slabs), u = bay coordinate (1.0 per facade bay).
"""

import math
from mathutils import Vector
from common import MeshBuilder, build_object, tri_count, object_materials, rnd

SLAB_T = 0.32


class Frame:
    """Storey frame: storey 0 is the lobby (height L), storeys 1..n have height fh."""

    def __init__(self, L, fh, n_up):
        self.L, self.fh, self.n = L, fh, n_up

    def z(self, k):
        if k <= 0:
            return 0.0
        return self.L + (k - 1) * self.fh

    @property
    def roof(self):
        return self.z(self.n + 1)

    def storey(self, z):
        if z <= self.L:
            return z / self.L
        return 1.0 + (z - self.L) / self.fh


def glazing_uv_fn(W, D, fr, bay_x=3.0, bay_y=3.0):
    def f(p, n):
        if abs(n.x) > abs(n.y):
            u = (p.y + D / 2) / bay_y
        else:
            u = (p.x + W / 2) / bay_x
        return (u, fr.storey(p.z))
    return f


# ---------------------------------------------------------------------------
# small parts
# ---------------------------------------------------------------------------

def edge_parapet(mb, rect, z0, h, t, mat, sides=("front", "back", "left", "right"), glass=False, gap=0.0):
    """Parapet/balustrade along the edges of rect=(x0,x1,y0,y1)."""
    x0, x1, y0, y1 = rect
    if glass:
        for s in sides:
            if s == "front":
                a, b = (x0 + gap, y0), (x1 - gap, y0 + 0.04)
            elif s == "back":
                a, b = (x0 + gap, y1 - 0.04), (x1 - gap, y1)
            elif s == "left":
                a, b = (x0, y0 + gap), (x0 + 0.04, y1 - gap)
            else:
                a, b = (x1 - 0.04, y0 + gap), (x1, y1 - gap)
            mb.box(a[0], a[1], z0, b[0], b[1], z0 + h - 0.06, "glass_clear")
            # handrail
            mb.box(a[0] - 0.02, a[1] - 0.02, z0 + h - 0.08, b[0] + 0.02, b[1] + 0.02, z0 + h, "trim")
        return
    for s in sides:
        if s == "front":
            mb.box(x0 + gap, y0, z0, x1 - gap, y0 + t, z0 + h, mat)
        elif s == "back":
            mb.box(x0 + gap, y1 - t, z0, x1 - gap, y1, z0 + h, mat)
        elif s == "left":
            mb.box(x0, y0 + gap, z0, x0 + t, y1 - gap, z0 + h, mat)
        else:
            mb.box(x1 - t, y0 + gap, z0, x1, y1 - gap, z0 + h, mat)


def roof_plant(mb, cx, cy, z, w, d, seed, tanks=2, units=3, overrun=True, mat="facade"):
    """Typical Gulf rooftop: lift overrun, water tanks, AC condensers."""
    r = rnd(seed)
    if overrun:
        ow, od = min(4.2, w * 0.3), min(3.4, d * 0.3)
        mb.box(cx - ow / 2, cy - od / 2 + d * 0.08, z, cx + ow / 2, cy + od / 2 + d * 0.08, z + 3.2, mat, c=0.06)
        mb.box(cx - ow / 2 - 0.15, cy - od / 2 + d * 0.08 - 0.15, z + 3.2, cx + ow / 2 + 0.15, cy + od / 2 + d * 0.08 + 0.15, z + 3.45, "trim")
    for i in range(tanks):
        tx = cx - w * 0.3 + i * 2.2
        ty = cy - d * 0.22
        mb.cylinder(tx, ty, z, z + 1.8, 0.85, "facade", seg=10)
        mb.cylinder(tx, ty, z + 1.8, z + 2.05, 0.5, "facade", seg=10)
    for i in range(units):
        ux = cx + w * 0.12 + i * 1.6
        uy = cy - d * 0.25 + r.uniform(-0.3, 0.3)
        mb.box(ux - 0.6, uy - 0.5, z, ux + 0.6, uy + 0.5, z + 1.1, "metal")
        mb.cylinder(ux, uy, z + 1.1, z + 1.16, 0.42, "steel_dark", seg=8, smooth=False)


def pergola(mb, x0, x1, y0, y1, z, h, mat="trim", spacing=0.9, post_mat=None):
    post_mat = post_mat or mat
    for (px, py) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        mb.box(px - 0.12, py - 0.12, z, px + 0.12, py + 0.12, z + h, post_mat)
    mb.box(x0 - 0.12, y0 - 0.12, z + h, x1 + 0.12, y0 + 0.12, z + h + 0.25, post_mat)
    mb.box(x0 - 0.12, y1 - 0.12, z + h, x1 + 0.12, y1 + 0.12, z + h + 0.25, post_mat)
    n = max(2, int((x1 - x0) / spacing))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        mb.box(x - 0.05, y0 - 0.25, z + h + 0.25, x + 0.05, y1 + 0.25, z + h + 0.45, mat)


def screen_panel(mb, axis, fixed, a0, a1, z0, z1, mat="accent", cell=1.0, slat=0.07, depth=0.08, frame=True):
    """Mashrabiya-style diagonal lattice in a vertical plane.
    axis='x': plane y=fixed spanning x in [a0,a1]; axis='y': plane x=fixed spanning y."""
    def P(a, z):
        return (a, fixed, z) if axis == "x" else (fixed, a, z)

    up = (0, 0, 1)
    if frame:
        for (pa, pb) in ((P(a0, z0), P(a1, z0)), (P(a0, z1), P(a1, z1)), (P(a0, z0), P(a0, z1)), (P(a1, z0), P(a1, z1))):
            mb.beam(pa, pb, 0.14, 0.14, mat, up=(0, 1, 0) if axis == "x" else (1, 0, 0))
    w = a1 - a0
    h = z1 - z0
    # diagonals: lines a - z = c and a + z = c, clipped to the rectangle
    for sgn in (1, -1):
        k = -h
        while k <= w:
            # parametric line through (a0+k, z0) with direction (1, sgn)
            pts = []
            if sgn == 1:
                ta = max(0.0, -k)
                tb = min(h, w - k)
            else:
                ta = max(0.0, k - w)
                tb = min(h, k)
            if tb - ta > 0.15:
                if sgn == 1:
                    pa = P(a0 + k + ta, z0 + ta)
                    pb = P(a0 + k + tb, z0 + tb)
                else:
                    pa = P(a0 + k - ta, z0 + ta)
                    pb = P(a0 + k - tb, z0 + tb)
                mb.beam(pa, pb, slat, depth, mat, up=(0, 1, 0) if axis == "x" else (1, 0, 0))
            k += cell


# ---------------------------------------------------------------------------
# residential generator (towers, mid-rise, low-rise)
# ---------------------------------------------------------------------------

def residential(mb, W, D, fr, P):
    prim = P.get("primary", "facade")
    sec = P.get("secondary", "facade_alt")
    pier_w = P.get("pier_w", 1.1)
    tiers = P.get("tiers") or [dict(k0=0, k1=fr.n + 1, rect=(-W / 2, W / 2, -D / 2, D / 2))]
    bal = P.get("bal", (1.6, 1.6, 0.0, 0.0))  # front, back, left, right
    bal_style = P.get("bal_style", "solid")
    band_every = P.get("band_every", 0)
    divider_fracs = P.get("dividers", (0.33, 0.67))
    arcade = P.get("arcade", 1.8)
    side_fins = P.get("side_fins", 0)
    seed = P.get("seed", 1)
    r = rnd(seed)
    info = {}

    for ti, T in enumerate(tiers):
        k0, k1 = T["k0"], T["k1"]
        x0, x1, y0, y1 = T["rect"]
        tb = T.get("bal", bal)
        bf, bb, bl, br = [max(0.18, v) for v in tb]
        style = T.get("bal_style", bal_style)
        zA, zB = fr.z(k0), fr.z(k1)
        top_tier = ti == len(tiers) - 1
        # glazing core above the lobby
        ks = max(k0, 1)
        cz0 = fr.z(ks) - SLAB_T if k0 > 0 else fr.z(1) - SLAB_T
        mb.box(x0 + bl, y0 + bf, cz0, x1 - br, y1 - bb, zB, "glazing", skip=("bottom", "top"))
        if k0 == 0:
            # lobby: set back behind an arcade on the front
            ins = arcade if arcade else 0.6
            mb.box(x0 + 0.8, y0 + ins, 0.0, x1 - 0.8, y1 - 0.6, fr.z(1) - SLAB_T, "glazing", skip=("bottom", "top"))
            # plinth band (sits below lobby glazing)
            mb.box(x0 + 0.7, y0 + ins - 0.1, 0.0, x1 - 0.7, y1 - 0.5, 0.45, sec)
            # arcade piers
            if arcade:
                n_p = max(3, int(round((x1 - x0) / 4.5)))
                for i in range(1, n_p):
                    px = x0 + (x1 - x0) * i / n_p
                    mb.box(px - 0.35, y0 + 0.25, 0.0, px + 0.35, y0 + 0.95, fr.z(1) - SLAB_T, prim, c=0.05)
            # entrance canopy (stays inside the footprint)
            ew = min(7.0, (x1 - x0) * 0.35)
            mb.box(-ew / 2, y0 + 0.02, fr.z(1) * 0.62, ew / 2, y0 + ins + 0.3, fr.z(1) * 0.62 + 0.28, "trim")
        # slabs
        for k in range(max(k0, 1), k1):
            z = fr.z(k)
            thick = band_every and (k % band_every == 0)
            t = 0.62 if thick else SLAB_T
            mb.box(x0, y0, z - t, x1, y1, z, sec if thick else prim, c=0.05)
        # balconies parapets
        for k in range(max(k0, 1), k1):
            z = fr.z(k)
            for side, depth in (("front", bf), ("back", bb), ("left", bl), ("right", br)):
                if depth < 0.9:
                    continue
                st = style
                if style == "mixed":
                    st = "glass" if (k + (side == "back")) % 2 else "solid"
                if st == "glass":
                    edge_parapet(mb, (x0, x1, y0, y1), z, 1.1, 0.2, prim, sides=(side,), glass=True, gap=pier_w)
                else:
                    edge_parapet(mb, (x0, x1, y0, y1), z, 1.05, 0.22, prim, sides=(side,), gap=pier_w)
        # balcony dividers (fins between apartments)
        zf0 = fr.z(max(k0, 1)) - SLAB_T
        for side, depth in (("front", bf), ("back", bb)):
            if depth < 0.9:
                continue
            for fx in divider_fracs:
                px = x0 + (x1 - x0) * fx
                if side == "front":
                    mb.box(px - 0.14, y0, zf0, px + 0.14, y0 + depth, zB, sec, c=0.04)
                else:
                    mb.box(px - 0.14, y1 - depth, zf0, px + 0.14, y1, zB, sec, c=0.04)
        for side, depth in (("left", bl), ("right", br)):
            if depth < 0.9:
                continue
            for fy in divider_fracs:
                py = y0 + (y1 - y0) * fy
                if side == "left":
                    mb.box(x0, py - 0.14, zf0, x0 + depth, py + 0.14, zB, sec, c=0.04)
                else:
                    mb.box(x1 - depth, py - 0.14, zf0, x1, py + 0.14, zB, sec, c=0.04)
        # vertical fins on flush side facades
        if side_fins:
            for side, depth, lo, hi in (("left", bl, y0, y1), ("right", br, y0, y1)):
                if depth >= 0.9:
                    continue
                for i in range(1, side_fins + 1):
                    py = lo + (hi - lo) * i / (side_fins + 1)
                    if side == "left":
                        mb.box(x0 - 0.0, py - 0.12, zf0, x0 + 0.7, py + 0.12, zB, prim)
                    else:
                        mb.box(x1 - 0.7, py - 0.12, zf0, x1, py + 0.12, zB, prim)
        # corner piers
        if pier_w > 0:
            for (px, py) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
                sx = 1 if px == x0 else -1
                sy = 1 if py == y0 else -1
                ax, bx = sorted((px, px + sx * pier_w))
                ay, by = sorted((py, py + sy * pier_w))
                mb.box(ax, ay, zA if k0 > 0 else 0.0, bx, by, zB + 1.25, prim, c=0.06)
        # tier roof
        mb.box(x0, y0, zB, x1, y1, zB + 0.5, prim, c=0.06, mats={"top": "roof"})
        par_h = 1.15
        if top_tier:
            edge_parapet(mb, (x0, x1, y0, y1), zB + 0.5, par_h, 0.28, prim, gap=0.0)
            mb.box(x0 - 0.05, y0 - 0.05, zB + 0.5 + par_h, x1 + 0.05, y0 + 0.33, zB + 0.62 + par_h, "trim")
        else:
            edge_parapet(mb, (x0, x1, y0, y1), zB + 0.5, 1.1, 0.2, prim, glass=True, gap=0.3)
        info["roof_z"] = zB + 0.5
        info["roof_rect"] = (x0, x1, y0, y1)
    return info


def crown_frame(mb, rect, z, h, mat, depth=0.6):
    x0, x1, y0, y1 = rect
    for (ax, ay, bx, by) in ((x0, y0, x1, y0 + depth), (x0, y1 - depth, x1, y1)):
        mb.box(ax, ay, z + h - 0.7, bx, by, z + h, mat, c=0.05)
    for (px, py) in ((x0, y0), (x1 - depth, y0), (x0, y1 - depth), (x1 - depth, y1 - depth)):
        mb.box(px, py, z, px + depth, py + depth, z + h, mat, c=0.05)
    mb.box(x0, y0, z + h - 0.7, x0 + depth, y1, z + h, mat, c=0.05)
    mb.box(x1 - depth, y0, z + h - 0.7, x1, y1, z + h, mat, c=0.05)


# ---------------------------------------------------------------------------
# office tower generator
# ---------------------------------------------------------------------------

def octagon(x0, x1, y0, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def office(mb, W, D, fr, P):
    base_k = P.get("base_k", 1)
    cham = P.get("chamfer", 0.0)
    fin_sp = P.get("fin_spacing", 1.5)
    fin_mat = P.get("fin_mat", "trim")
    fin_d = P.get("fin_depth", 0.35)
    band = P.get("band", "trim")
    stone = P.get("stone", "facade")
    crown = P.get("crown", "parapet")
    inset = P.get("inset", 0.6)
    x0, x1, y0, y1 = -W / 2 + inset, W / 2 - inset, -D / 2 + inset, D / 2 - inset
    zb = fr.z(base_k)
    top = fr.roof
    # podium base: stone frame with tall recessed glazing
    mb.box(-W / 2 + 1.0, -D / 2 + 1.6, 0, W / 2 - 1.0, D / 2 - 1.0, zb, "glazing", skip=("bottom",), mats={"top": "roof"})
    n_p = max(3, int(round(W / 4.0)))
    for i in range(n_p + 1):
        px = -W / 2 + 0.2 + (W - 0.4) * i / n_p
        mb.box(px - 0.4, -D / 2 + 0.2, 0, px + 0.4, -D / 2 + 1.2, zb - 0.3, stone, c=0.05)
        mb.box(px - 0.4, D / 2 - 1.0, 0, px + 0.4, D / 2 - 0.2, zb - 0.3, stone, c=0.05)
    mb.box(-W / 2 + 0.1, -D / 2 + 0.1, zb - 0.9, W / 2 - 0.1, D / 2 - 0.1, zb + 0.1, stone, c=0.08)
    # canopy
    mb.box(-W * 0.22, -D / 2, zb * 0.55, W * 0.22, -D / 2 + 2.0, zb * 0.55 + 0.3, "trim")
    # shaft
    if cham > 0:
        poly = octagon(x0, x1, y0, y1, cham)
        mb.prism(poly, zb + 0.1, top, "glazing", top=False)
    else:
        mb.box(x0, y0, zb + 0.1, x1, y1, top, "glazing", skip=("bottom", "top"))
    # floor bands
    for k in range(base_k + 1, fr.n + 1):
        z = fr.z(k)
        if P.get("band_every", 1) and (k - base_k) % P.get("band_every", 1) == 0:
            e = P.get("band_proj", 0.12)
            if cham > 0:
                poly = octagon(x0 - e, x1 + e, y0 - e, y1 + e, cham + e * 0.4)
                mb.prism(poly, z - 0.16, z + 0.08, band, top=True, bottom=True)
            else:
                mb.box(x0 - e, y0 - e, z - 0.16, x1 + e, y1 + e, z + 0.08, band)
    # vertical fins (mullions)
    if fin_sp:
        for (axis, lo, hi, fixed, out) in (("x", x0 + cham, x1 - cham, y0, -1), ("x", x0 + cham, x1 - cham, y1, 1),
                                           ("y", y0 + cham, y1 - cham, x0, -1), ("y", y0 + cham, y1 - cham, x1, 1)):
            n = max(1, int(round((hi - lo) / fin_sp)))
            for i in range(n + 1):
                a = lo + (hi - lo) * i / n
                if axis == "x":
                    yy0, yy1 = sorted((fixed, fixed + out * fin_d))
                    mb.box(a - 0.06, yy0, zb + 0.1, a + 0.06, yy1, top, fin_mat, skip=("bottom",))
                else:
                    xx0, xx1 = sorted((fixed, fixed + out * fin_d))
                    mb.box(xx0, a - 0.06, zb + 0.1, xx1, a + 0.06, top, fin_mat, skip=("bottom",))
    # stone spine frames on the sides
    if P.get("spines"):
        for sx in (-1, 1):
            mb.box(sx * (W / 2) - (0 if sx < 0 else 1.6), -D / 2 + 1.0, zb, sx * (W / 2) + (1.6 if sx < 0 else 0), D / 2 - 1.0, top + 2.2, stone, c=0.08)
    # crown
    info = {}
    if crown == "parapet":
        if cham > 0:
            mb.prism(octagon(x0, x1, y0, y1, cham), top, top + 3.2, "glazing", top=False)
            mb.prism(octagon(x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, cham), top, top + 0.4, "roof", top=True)
            mb.prism(octagon(x0 - 0.15, x1 + 0.15, y0 - 0.15, y1 + 0.15, cham), top + 3.2, top + 3.6, "trim", top=False)
        else:
            mb.box(x0, y0, top, x1, y1, top + 3.2, "glazing", skip=("bottom", "top"))
            mb.box(x0 + 0.4, y0 + 0.4, top, x1 - 0.4, y1 - 0.4, top + 0.4, "roof")
            mb.box(x0 - 0.15, y0 - 0.15, top + 3.2, x1 + 0.15, y1 + 0.15, top + 3.6, "trim", skip=())
        roof_plant(mb, 0, 0, top + 0.4, x1 - x0, y1 - y0, 7, tanks=0, units=4, overrun=True)
        info["roof_z"] = top + 0.4
    elif crown == "slope":
        # sloped glass crown rising towards +x
        h0, h1 = 1.5, 9.0
        verts_b = [(x0, y0, top), (x1, y0, top), (x1, y1, top), (x0, y1, top)]
        verts_t = [(x0, y0, top + h0), (x1, y0, top + h1), (x1, y1, top + h1), (x0, y1, top + h0)]
        ctr = ((x0 + x1) / 2, (y0 + y1) / 2, top + 2)
        for i in range(4):
            j = (i + 1) % 4
            mb.face([verts_b[i], verts_b[j], verts_t[j], verts_t[i]], "glazing", inside=ctr)
        mb.face(verts_t, "trim", inside=ctr)
        # frame edges
        mb.beam((x0, y0 - 0.1, top + h0), (x1, y0 - 0.1, top + h1), 0.3, 0.4, "trim")
        mb.beam((x0, y1 + 0.1, top + h0), (x1, y1 + 0.1, top + h1), 0.3, 0.4, "trim")
        info["roof_z"] = top
    elif crown == "frame":
        mb.box(x0 + 0.3, y0 + 0.3, top, x1 - 0.3, y1 - 0.3, top + 0.5, stone, mats={"top": "roof"})
        crown_frame(mb, (x0 - 0.2, x1 + 0.2, y0 - 0.2, y1 + 0.2), top, 6.0, stone, depth=0.9)
        roof_plant(mb, 0, 0, top + 0.5, x1 - x0, y1 - y0, 9, tanks=0, units=3)
        info["roof_z"] = top + 0.5
    elif crown == "step":
        mb.box(x0 + 0.3, y0 + 0.3, top, x1 - 0.3, y1 - 0.3, top + 0.5, "trim", mats={"top": "roof"})
        sx0, sx1, sy0, sy1 = x0 + 3, x1 - 3, y0 + 2.5, y1 - 2.5
        mb.box(sx0, sy0, top + 0.5, sx1, sy1, top + 4.5, "glazing", skip=("bottom",), mats={"top": "roof"})
        mb.box(sx0 - 0.15, sy0 - 0.15, top + 4.5, sx1 + 0.15, sy1 + 0.15, top + 4.9, "trim")
        edge_parapet(mb, (x0, x1, y0, y1), top + 0.5, 1.1, 0.2, "trim", glass=True)
        info["roof_z"] = top + 0.5
    return info


# ---------------------------------------------------------------------------
# villas and podiums
# ---------------------------------------------------------------------------

def villa(mb, W, D, P):
    v = P.get("v", 0)
    prim = P.get("primary", "facade")
    sec = P.get("secondary", "facade_alt")
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    # garden plinth / boundary wall
    mb.box(x0, y0, 0, x1, y1, 0.25, "concrete", c=0.04)
    wall_h = 1.6
    edge_parapet(mb, (x0, x1, y0, y1), 0.25, wall_h, 0.25, sec, sides=("back", "left", "right"))
    mb.box(x0, y0, 0.25, x0 + W * 0.35, y0 + 0.25, 0.25 + wall_h, sec)
    mb.box(x1 - W * 0.25, y0, 0.25, x1, y0 + 0.25, 0.25 + wall_h, sec)
    # gate
    mb.box(x0 + W * 0.35, y0 + 0.05, 0.25, x1 - W * 0.25, y0 + 0.15, 0.25 + wall_h * 0.9, "trim")
    g0 = 0.25
    if v == 0:
        # ground volume
        gx0, gx1, gy0, gy1 = x0 + 1.2, x1 - 3.2, y0 + 4.0, y1 - 1.0
        mb.box(gx0, gy0, g0, gx1, gy1, g0 + 3.6, "glazing", skip=("bottom",), mats={"top": "roof", "left": prim, "back": prim})
        mb.box(gx0 - 0.2, gy0 - 0.2, g0 + 3.4, gx1 + 0.2, gy1 + 0.2, g0 + 3.8, prim, c=0.05)
        # side solid wall pieces
        mb.box(gx0, gy0, g0, gx0 + 2.2, gy0 + 0.4, g0 + 3.4, sec, c=0.04)
        # cantilevered upper volume, shifted to the right and forward
        ux0, ux1, uy0, uy1 = x0 + 3.0, x1 - 0.8, y0 + 2.6, y1 - 2.2
        mb.box(ux0, uy0, g0 + 3.8, ux1, uy1, g0 + 7.0, prim, c=0.08, mats={"front": prim})
        # upper glazing ribbon on the front, recessed
        mb.box(ux0 + 0.6, uy0 - 0.02, g0 + 4.5, ux1 - 0.6, uy0 + 0.3, g0 + 6.4, "glazing", skip=("back",))
        mb.box(ux0 + 0.6, uy0 - 0.06, g0 + 4.35, ux1 - 0.6, uy0 + 0.35, g0 + 4.5, "trim")
        # roof terrace parapet + roof
        mb.box(ux0, uy0, g0 + 7.0, ux1, uy1, g0 + 7.15, prim, mats={"top": "roof"})
        edge_parapet(mb, (ux0, ux1, uy0, uy1), g0 + 7.15, 0.75, 0.2, prim)
        # pergola on ground roof
        pergola(mb, gx0 + 0.3, ux0 - 0.3 if ux0 - gx0 > 2.0 else gx0 + 2.2, gy0 + 0.4, gy1 - 0.4, g0 + 3.8, 2.4, "accent")
        # pool
        mb.box(x0 + 1.0, y0 + 0.8, 0.25, x0 + 6.5, y0 + 3.4, 0.33, "concrete")
        mb.box(x0 + 1.2, y0 + 1.0, 0.25, x0 + 6.3, y0 + 3.2, 0.31, "water")
        info = {"roof_z": g0 + 7.15}
    else:
        # two volumes and a wind tower (barjeel)
        ax0, ax1, ay0, ay1 = x0 + 1.0, x0 + W * 0.55, y0 + 3.5, y1 - 1.0
        bx0, bx1, by0, by1 = x0 + W * 0.5, x1 - 1.0, y0 + 2.2, y1 - 2.4
        mb.box(ax0, ay0, g0, ax1, ay1, g0 + 6.6, sec, c=0.08, mats={"top": "roof"})
        mb.box(bx0, by0, g0, bx1, by1, g0 + 3.8, prim, c=0.08, mats={"top": "roof"})
        # recessed glazing on front of both volumes
        mb.box(ax0 + 0.8, ay0 - 0.02, g0 + 0.3, ax1 - 0.8, ay0 + 0.3, g0 + 2.9, "glazing", skip=("back",))
        mb.box(ax0 + 1.2, ay0 - 0.02, g0 + 3.9, ax1 - 1.2, ay0 + 0.3, g0 + 5.7, "glazing", skip=("back",))
        mb.box(bx0 + 0.6, by0 - 0.02, g0 + 0.3, bx1 - 0.6, by0 + 0.3, g0 + 3.0, "glazing", skip=("back",))
        # deep shading frame on volume b
        mb.box(bx0 - 0.1, by0 - 1.4, g0 + 3.2, bx1 + 0.1, by0 + 0.1, g0 + 3.5, prim)
        for px in (bx0, bx1 - 0.3):
            mb.box(px, by0 - 1.4, g0, px + 0.3, by0 - 1.1, g0 + 3.2, prim)
        # parapets
        edge_parapet(mb, (ax0, ax1, ay0, ay1), g0 + 6.6, 0.6, 0.2, sec)
        edge_parapet(mb, (bx0, bx1, by0, by1), g0 + 3.8, 1.0, 0.2, prim, glass=True)
        # wind tower on volume a
        tx, ty = ax0 + 1.8, ay1 - 1.8
        tw = 1.8
        mb.box(tx - tw / 2, ty - tw / 2, g0 + 6.6, tx + tw / 2, ty + tw / 2, g0 + 9.6, sec, c=0.05)
        for s in range(4):
            ang = s * math.pi / 2
            with mb.TR(tx, ty, 0, ang):
                for j in (-0.45, 0.0, 0.45):
                    mb.box(j - 0.12, -tw / 2 - 0.04, g0 + 7.6, j + 0.12, -tw / 2 + 0.25, g0 + 9.2, "trim")
        mb.box(tx - tw / 2 - 0.12, ty - tw / 2 - 0.12, g0 + 9.6, tx + tw / 2 + 0.12, ty + tw / 2 + 0.12, g0 + 9.8, sec)
        # palm-shade canopy
        pergola(mb, bx0 + 0.6, bx1 - 0.6, by0 + 0.6, by1 - 0.6, g0 + 3.8, 2.3, "accent", post_mat="trim")
        info = {"roof_z": g0 + 6.6}
    return info


def podium(mb, W, D, P):
    v = P.get("v", 0)
    prim = P.get("primary", "facade_alt")
    sec = P.get("secondary", "facade")
    L, fh, n = P.get("L", 5.5), P.get("fh", 4.2), P.get("n", 2)
    fr = Frame(L, fh, n)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    top = fr.roof
    # shopfront ground floor
    mb.box(x0 + 0.6, y0 + 2.2, 0, x1 - 0.6, y1 - 0.6, L, "glazing", skip=("bottom",), mats={"top": "roof"})
    # ground floor stone piers on the front
    n_p = max(3, int(round(W / 5.0)))
    for i in range(n_p + 1):
        px = x0 + 0.5 + (W - 1.0) * i / n_p
        mb.box(px - 0.45, y0 + 0.2, 0, px + 0.45, y0 + 1.2, L, prim, c=0.05)
    # continuous canopy
    mb.box(x0 + 0.2, y0, L - 0.9, x1 - 0.2, y0 + 2.4, L - 0.6, "trim")
    # signage band
    mb.box(x0 + 0.3, y0 + 0.15, L - 0.6, x1 - 0.3, y0 + 1.25, L + 0.6, "accent")
    # upper floors
    ux0, ux1, uy0, uy1 = x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3
    mb.box(ux0 + 0.5, uy0 + 0.6, L, ux1 - 0.5, uy1 - 0.4, top, "glazing", skip=("bottom",), mats={"top": "roof"})
    for k in range(2, n + 1):
        z = fr.z(k)
        mb.box(ux0, uy0, z - 0.4, ux1, uy1, z, prim, c=0.05)
    mb.box(ux0, uy0, L, ux1, uy1, L + 0.6, prim, c=0.05)
    if v == 0:
        # vertical fins all around upper floors
        for i in range(int((ux1 - ux0) / 1.4) + 1):
            px = ux0 + 0.3 + i * 1.4
            if px > ux1 - 0.2:
                break
            mb.box(px - 0.12, uy0, L + 0.6, px + 0.12, uy0 + 0.6, top, "accent")
            mb.box(px - 0.12, uy1 - 0.4, L + 0.6, px + 0.12, uy1, top, "accent")
        for i in range(int((uy1 - uy0) / 1.4) + 1):
            py = uy0 + 0.3 + i * 1.4
            if py > uy1 - 0.2:
                break
            mb.box(ux0, py - 0.12, L + 0.6, ux0 + 0.5, py + 0.12, top, "accent")
            mb.box(ux1 - 0.5, py - 0.12, L + 0.6, ux1, py + 0.12, top, "accent")
    elif v == 1:
        # mashrabiya screens on the front upper floors
        nsc = 3
        span = (ux1 - ux0 - 1.0) / nsc
        for i in range(nsc):
            a0 = ux0 + 0.5 + i * span + 0.4
            a1 = a0 + span - 0.8
            screen_panel(mb, "x", uy0 + 0.1, a0, a1, L + 0.9, top - 0.5, "accent", cell=1.1)
        for sx in (-1, 1):
            fixed = (ux0 + 0.1) if sx < 0 else (ux1 - 0.1)
            screen_panel(mb, "y", fixed, uy0 + 1.4, uy1 - 1.4, L + 0.9, top - 0.5, "accent", cell=1.1)
    else:
        # horizontal louvres
        for k in range(n * 3):
            z = L + 0.9 + k * (top - L - 1.2) / (n * 3)
            mb.box(ux0 - 0.1, uy0 - 0.25, z, ux1 + 0.1, uy0 + 0.35, z + 0.12, "trim")
            mb.box(ux0 - 0.25, uy0, z, ux0 + 0.35, uy1, z + 0.12, "trim")
            mb.box(ux1 - 0.35, uy0, z, ux1 + 0.25, uy1, z + 0.12, "trim")
    # roof
    mb.box(ux0, uy0, top, ux1, uy1, top + 0.4, prim, mats={"top": "roof"})
    edge_parapet(mb, (ux0, ux1, uy0, uy1), top + 0.4, 1.0, 0.25, prim)
    # rooftop plant screen
    sx0, sx1, sy0, sy1 = ux0 + W * 0.2, ux1 - W * 0.2, uy0 + D * 0.3, uy1 - D * 0.15
    roof_plant(mb, (sx0 + sx1) / 2, (sy0 + sy1) / 2, top + 0.4, sx1 - sx0, sy1 - sy0, 11, tanks=0, units=4, overrun=False)
    for (ax, bx) in ((sx0, sx1),):
        for yy in (sy0, sy1):
            mb.box(ax, yy - 0.05, top + 0.4, bx, yy + 0.05, top + 2.2, "trim")
    info = {"roof_z": top + 0.4, "frame": fr}
    return info


# ---------------------------------------------------------------------------
# variant table
# ---------------------------------------------------------------------------

def _tr_tiers(W, D, fr, spec):
    tiers = []
    for (k0, k1, ins) in spec:
        f, b, l, r_ = ins
        tiers.append(dict(k0=k0, k1=k1, rect=(-W / 2 + l, W / 2 - r_, -D / 2 + f, D / 2 - b)))
    return tiers


def variant_specs():
    """Return a list of (kind, variant, builder) tuples. builder(mb) -> dict info."""
    specs = []

    # ---------------- tower-residential (nominal 22 x 19, ~48 m) ----------------
    def tr0(mb):
        W, D = 22.0, 19.0
        fr = Frame(5.0, 3.25, 13)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        tiers = _tr_tiers(W, D, fr, [(0, 10, (0, 0, 0, 0)), (10, 13, (2.5, 0, 0, 3.5)), (13, 14, (5.0, 2.0, 2.0, 6.0))])
        info = residential(mb, W, D, fr, dict(bal=(1.8, 1.6, 0.0, 0.0), bal_style="glass", band_every=3,
                                                 dividers=(0.25, 0.5, 0.75), side_fins=3, pier_w=1.2, seed=11, tiers=tiers))
        rect = info["roof_rect"]
        roof_plant(mb, (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, info["roof_z"], rect[1] - rect[0], rect[3] - rect[2], 3, tanks=2, units=2)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-residential", 0, tr0))

    def tr1(mb):
        W, D = 22.0, 19.0
        fr = Frame(5.5, 3.3, 13)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.4, 2.4)
        info = residential(mb, W, D, fr, dict(primary="facade_alt", secondary="facade", bal=(0.2, 0.2, 0.2, 0.2), pier_w=1.6,
                                                 band_every=4, side_fins=4, dividers=(), seed=12))
        # vertical stone fins on the front/back over the glazing
        top = fr.roof
        for side_y, sgn in ((-D / 2, 1), (D / 2, -1)):
            for i in range(1, 9):
                px = -W / 2 + W * i / 9
                y0 = side_y if sgn > 0 else side_y - 0.9
                mb.box(px - 0.16, min(side_y, side_y + sgn * 0.9) - (0.0 if sgn > 0 else 0), fr.z(1) - SLAB_T, px + 0.16, max(side_y, side_y + sgn * 0.9), top, "facade", skip=("bottom",))
        # crown: open frame
        crown_frame(mb, (-W / 2, W / 2, -D / 2, D / 2), info["roof_z"] + 1.15, 4.0, "facade_alt", depth=1.0)
        roof_plant(mb, 0, 0, info["roof_z"], W - 4, D - 4, 4, tanks=2, units=3)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-residential", 1, tr1))

    def tr2(mb):
        W, D = 22.0, 19.0
        fr = Frame(5.0, 3.2, 13)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = residential(mb, W, D, fr, dict(bal=(1.7, 1.7, 0.0, 0.0), bal_style="solid", dividers=(0.5,), pier_w=0.0,
                                                 band_every=0, side_fins=0, seed=13))
        top = fr.roof
        # mashrabiya screens on both side facades (central bands)
        for sx in (-1, 1):
            fixed = sx * (W / 2 + 0.02) - sx * 0.1
            screen_panel(mb, "y", fixed, -D * 0.28, D * 0.28, fr.z(1), top - 0.4, "accent", cell=1.3, slat=0.09)
        # stone side walls framing the screens
        for sx in (-1, 1):
            for sy in (-1, 1):
                ax = sx * W / 2
                mb.box(min(ax, ax - sx * 1.0), sy * D * 0.3 - 0.0 if sy > 0 else -D / 2, 0, max(ax, ax - sx * 1.0), D / 2 if sy > 0 else -D * 0.3, top + 1.2, "facade_alt", c=0.06)
        # crown: stepped cap
        mb.box(-W / 2 + 3, -D / 2 + 3, info["roof_z"], W / 2 - 3, D / 2 - 3, info["roof_z"] + 3.0, "facade", c=0.08, mats={"top": "roof"})
        mb.box(-W / 2 + 2.6, -D / 2 + 2.6, info["roof_z"] + 3.0, W / 2 - 2.6, D / 2 - 2.6, info["roof_z"] + 3.35, "trim")
        roof_plant(mb, 0, 0, info["roof_z"] + 3.35, W - 8, D - 8, 5, tanks=1, units=2, overrun=False)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-residential", 2, tr2))

    def tr3(mb):
        W, D = 22.0, 19.0
        fr = Frame(5.0, 3.25, 12)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        # two offset wings: left wing taller, right wing lower with terrace
        tiers_left = [dict(k0=0, k1=13, rect=(-W / 2, 0.6, -D / 2, D / 2 - 2.0))]
        info = residential(mb, W, D, fr, dict(bal=(1.8, 1.4, 0.0, 0.0), bal_style="mixed", dividers=(0.5,), pier_w=1.0,
                                                 band_every=0, side_fins=2, seed=14, tiers=tiers_left))
        z_left_roof = info["roof_z"]
        tiers_right = [dict(k0=0, k1=10, rect=(0.6, W / 2, -D / 2 + 2.0, D / 2))]
        info2 = residential(mb, W, D, fr, dict(primary="facade_alt", secondary="facade", bal=(1.6, 1.6, 0.0, 1.6), bal_style="glass",
                                                  dividers=(0.5,), pier_w=1.0, band_every=3, arcade=0, seed=15, tiers=tiers_right))
        # crown on the tall wing
        pergola(mb, -W / 2 + 1.5, -1.0, -D / 2 + 2.5, D / 2 - 4.5, z_left_roof + 1.15, 2.6, "accent", post_mat="facade")
        roof_plant(mb, -W / 4, 0, z_left_roof, W / 2 - 3, D - 6, 6, tanks=1, units=2, overrun=True)
        rr = info2["roof_rect"]
        roof_plant(mb, (rr[0] + rr[1]) / 2, (rr[2] + rr[3]) / 2, info2["roof_z"], rr[1] - rr[0] - 2, rr[3] - rr[2] - 2, 8, tanks=2, units=1, overrun=False)
        return dict(info, frame=fr, W=W, D=D, roof_rect=(-W / 2, 0.6, -D / 2, D / 2 - 2.0))
    specs.append(("tower-residential", 3, tr3))

    # ---------------- tower-office (nominal 21 x 18, ~55 m) ----------------
    def to0(mb):
        W, D = 21.0, 18.0
        fr = Frame(6.5, 3.8, 12)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 1.5, 1.5)
        info = office(mb, W, D, fr, dict(base_k=1, chamfer=0.0, fin_spacing=1.5, fin_mat="trim", band_every=1, crown="parapet"))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-office", 0, to0))

    def to1(mb):
        W, D = 21.0, 18.0
        fr = Frame(6.5, 3.8, 12)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = office(mb, W, D, fr, dict(base_k=1, chamfer=3.2, fin_spacing=0, band="facade", band_every=1, band_proj=0.55, crown="parapet"))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-office", 1, to1))

    def to2(mb):
        W, D = 21.0, 18.0
        fr = Frame(6.5, 3.8, 12)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = office(mb, W, D, fr, dict(base_k=1, chamfer=0.0, fin_spacing=3.0, fin_mat="accent", fin_depth=0.6, band_every=2, spines=True, crown="slope"))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-office", 2, to2))

    def to3(mb):
        W, D = 21.0, 18.0
        fr = Frame(6.5, 3.8, 12)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.0, 2.0)
        info = office(mb, W, D, fr, dict(base_k=2, chamfer=0.0, fin_spacing=2.0, fin_mat="trim", band="facade", band_every=3, band_proj=0.4, crown="frame", stone="facade"))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("tower-office", 3, to3))

    # ---------------- midrise-residential (nominal 20 x 18.5, ~28 m) ----------------
    def mr0(mb):
        W, D = 20.0, 18.5
        fr = Frame(4.6, 3.2, 7)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = residential(mb, W, D, fr, dict(bal=(2.0, 1.8, 0.0, 0.0), bal_style="solid", dividers=(0.33, 0.67), pier_w=1.0,
                                                 band_every=0, side_fins=2, seed=21))
        rr = info["roof_rect"]
        pergola(mb, rr[0] + 1.5, rr[0] + 8.0, rr[2] + 1.5, rr[3] - 6.0, info["roof_z"], 2.6, "accent", post_mat="facade")
        roof_plant(mb, 2.5, 1.0, info["roof_z"], 9, 10, 21, tanks=2, units=2)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("midrise-residential", 0, mr0))

    def mr1(mb):
        W, D = 20.0, 18.5
        fr = Frame(4.6, 3.2, 7)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        tiers = _tr_tiers(W, D, fr, [(0, 6, (0, 0, 0, 0)), (6, 8, (3.0, 0, 3.0, 0))])
        info = residential(mb, W, D, fr, dict(primary="facade_alt", secondary="facade", bal=(1.6, 1.6, 1.6, 0.0), bal_style="glass",
                                                 dividers=(0.5,), pier_w=1.1, band_every=2, side_fins=2, seed=22, tiers=tiers))
        rr = info["roof_rect"]
        roof_plant(mb, (rr[0] + rr[1]) / 2, (rr[2] + rr[3]) / 2, info["roof_z"], rr[1] - rr[0], rr[3] - rr[2], 22, tanks=2, units=2)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("midrise-residential", 1, mr1))

    def mr2(mb):
        W, D = 20.0, 18.5
        fr = Frame(4.6, 3.2, 7)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.5, 2.5)
        info = residential(mb, W, D, fr, dict(bal=(0.2, 0.2, 0.2, 0.2), pier_w=1.3, dividers=(), band_every=0, side_fins=3, seed=23))
        top = fr.roof
        # deep vertical fins on the front (sand) + mashrabiya panels on the stair core
        for i in range(1, 8):
            px = -W / 2 + W * i / 8
            mb.box(px - 0.18, -D / 2 - 0.0, fr.z(1) - SLAB_T, px + 0.18, -D / 2 + 1.1, top, "facade_alt", skip=("bottom",))
        for i in range(1, 8):
            px = -W / 2 + W * i / 8
            mb.box(px - 0.18, D / 2 - 1.1, fr.z(1) - SLAB_T, px + 0.18, D / 2, top, "facade_alt", skip=("bottom",))
        screen_panel(mb, "y", -W / 2 + 0.05, -D * 0.22, D * 0.22, fr.z(1), top - 0.3, "accent", cell=1.0)
        screen_panel(mb, "y", W / 2 - 0.05, -D * 0.22, D * 0.22, fr.z(1), top - 0.3, "accent", cell=1.0)
        roof_plant(mb, 0, 0, info["roof_z"], W - 4, D - 4, 23, tanks=3, units=3)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("midrise-residential", 2, mr2))

    def mr3(mb):
        W, D = 20.0, 18.5
        fr = Frame(4.8, 3.2, 7)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = residential(mb, W, D, fr, dict(primary="facade", secondary="facade_alt", bal=(1.9, 0.0, 0.0, 1.9), bal_style="mixed",
                                                 dividers=(0.5,), pier_w=1.2, band_every=4, side_fins=2, seed=24))
        crown_frame(mb, (-W / 2 + 0.6, W / 2 - 0.6, -D / 2 + 0.6, D / 2 - 0.6), info["roof_z"] + 1.15, 3.0, "facade_alt", depth=0.7)
        roof_plant(mb, 0, 0, info["roof_z"], W - 5, D - 5, 24, tanks=2, units=3)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("midrise-residential", 3, mr3))

    # ---------------- lowrise-residential (nominal 18.5 x 18, ~13.5 m) ----------------
    def lr0(mb):
        W, D = 18.5, 18.0
        fr = Frame(3.8, 3.2, 2)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = residential(mb, W, D, fr, dict(bal=(1.8, 1.5, 0.0, 0.0), bal_style="solid", dividers=(0.5,), pier_w=0.9, side_fins=2, arcade=1.6, seed=31))
        rr = info["roof_rect"]
        pergola(mb, rr[0] + 1.2, rr[0] + 7.5, rr[2] + 1.2, rr[3] - 1.2, info["roof_z"], 2.5, "accent", post_mat="facade")
        roof_plant(mb, 3.5, 2.0, info["roof_z"], 7, 8, 31, tanks=1, units=2, overrun=True)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("lowrise-residential", 0, lr0))

    def lr1(mb):
        W, D = 18.5, 18.0
        fr = Frame(3.8, 3.2, 2)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        info = residential(mb, W, D, fr, dict(primary="facade_alt", secondary="facade", bal=(1.6, 0.0, 1.6, 0.0), bal_style="glass",
                                                 dividers=(0.5,), pier_w=1.0, band_every=0, side_fins=0, seed=32))
        top = fr.roof
        screen_panel(mb, "y", W / 2 - 0.05, -D * 0.3, D * 0.3, fr.z(1), top - 0.2, "accent", cell=0.9)
        roof_plant(mb, 0, 0, info["roof_z"], W - 5, D - 5, 32, tanks=2, units=2)
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("lowrise-residential", 1, lr1))

    def lr2(mb):
        W, D = 18.5, 18.0
        fr = Frame(3.8, 3.2, 3)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
        tiers = _tr_tiers(W, D, fr, [(0, 3, (0, 0, 0, 0)), (3, 4, (4.0, 0.0, 0.0, 5.0))])
        info = residential(mb, W, D, fr, dict(bal=(1.6, 1.4, 0.0, 0.0), bal_style="mixed", dividers=(0.5,), pier_w=0.9, band_every=0, side_fins=2, seed=33, tiers=tiers))
        rr = info["roof_rect"]
        roof_plant(mb, (rr[0] + rr[1]) / 2, (rr[2] + rr[3]) / 2, info["roof_z"], rr[1] - rr[0], rr[3] - rr[2], 33, tanks=1, units=2, overrun=False)
        pergola(mb, W / 2 - 4.6, W / 2 - 0.8, -D / 2 + 1.0, -D / 2 + 6.0, fr.z(3) + 0.5, 2.5, "accent", post_mat="facade")
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("lowrise-residential", 2, lr2))

    # ---------------- villas (nominal 15 x 14.5, ~8-10 m) ----------------
    def vi0(mb):
        W, D = 15.0, 14.5
        fr = Frame(3.85, 3.4, 1)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.5, 2.5)
        info = villa(mb, W, D, dict(v=0))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("villa", 0, vi0))

    def vi1(mb):
        W, D = 15.0, 14.5
        fr = Frame(3.55, 3.3, 1)
        mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.5, 2.5)
        info = villa(mb, W, D, dict(v=1))
        return dict(info, frame=fr, W=W, D=D)
    specs.append(("villa", 1, vi1))

    # ---------------- commercial-podium (nominal 21 x 18, ~15 m) ----------------
    for v in range(3):
        def cp(mb, v=v):
            W, D = 21.0, 18.0
            P = dict(v=v, L=5.5, fh=4.2, n=2, primary=("facade_alt", "facade", "facade_alt")[v], secondary="facade")
            fr = Frame(P["L"], P["fh"], P["n"])
            mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
            info = podium(mb, W, D, P)
            return dict(info, frame=fr, W=W, D=D)
        specs.append(("commercial-podium", v, cp))
    return specs


def build_all(collection_for_kind):
    """Build every kit variant. Returns {kind: [(obj, record), ...]}."""
    out = {}
    for kind, v, fn in variant_specs():
        mb = MeshBuilder()
        info = fn(mb)
        name = "%s_v%d" % (kind, v)
        lo, hi = mb.bounds()
        ob = build_object(mb, name, collection_for_kind(kind))
        fr = info.get("frame")
        W = hi.x - lo.x
        D = hi.y - lo.y
        H = hi.z - max(0.0, lo.z)
        rec = dict(
            id=name, kind=kind, variant=v, node=name,
            nominalSize=[round(W, 2), round(D, 2), round(H, 2)],
            tris=tri_count(ob), materials=object_materials(ob),
            floors=(fr.n + 1) if fr else None,
            storeyHeight=round(fr.fh, 2) if fr else None,
            lobbyHeight=round(fr.L, 2) if fr else None,
            roofY=round(info.get("roof_z", H), 2),
        )
        out.setdefault(kind, []).append((ob, rec))
    return out
