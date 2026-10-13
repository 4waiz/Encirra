"""
Hero facility assets, modelled at their district footprint and placed unscaled.

Blender coordinates: front faces -Y (three.js +Z), origin = footprint centre on the ground.
Each facility is one mesh object "<kind>_v<n>" plus optional child nodes:
  pump-station_v0/v1 -> child "pump_cutaway" / "pump_cutaway_v1" (below grade, y -27.6..-14)
  water-tower_v0/v1  -> child "water_level" / "water_level_v1" (scale Y = level fraction)
  desalination-inlet_v0 -> child "intake_cutaway" (riser into the suction gallery)
"""

import math

import bpy
from mathutils import Vector

from common import MeshBuilder, build_object, tri_count, object_materials, to_three, rnd
from kit_buildings import (Frame, glazing_uv_fn, edge_parapet, coping, roof_plant, pergola,
                           screen_panel, crown_frame, octagon, SLAB_T)
import parts
from parts import PIPE_R


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def banded(mb, rect, bands, inset=0.45, solid="facade", c=0.06):
    x0, x1, y0, y1 = rect
    for (z0, z1, kind) in bands:
        if kind == "glass":
            mb.box(x0 + inset, y0 + inset, z0, x1 - inset, y1 - inset, z1, "glazing", skip=("top", "bottom"))
        else:
            mb.box(x0, y0, z0, x1, y1, z1, kind if kind not in ("solid",) else solid, c=c)


def storey_bands(fr, k0, k1, spandrel=1.1, top_solid=0.0):
    """Ribbon-window bands for storeys k0..k1-1 (solid spandrel at each floor line)."""
    out = []
    for k in range(k0, k1):
        za, zb = fr.z(k), fr.z(k + 1)
        out.append((za, za + spandrel, "solid"))
        out.append((za + spandrel, zb, "glass"))
    return out


def fins(mb, rect, z0, z1, spacing, depth, w=0.24, mat="facade", sides=("front", "back")):
    x0, x1, y0, y1 = rect
    for s in sides:
        if s in ("front", "back"):
            n = max(1, int(round((x1 - x0) / spacing)))
            for i in range(1, n):
                x = x0 + (x1 - x0) * i / n
                if s == "front":
                    mb.box(x - w / 2, y0 - depth, z0, x + w / 2, y0 + 0.1, z1, mat)
                else:
                    mb.box(x - w / 2, y1 - 0.1, z0, x + w / 2, y1 + depth, z1, mat)
        else:
            n = max(1, int(round((y1 - y0) / spacing)))
            for i in range(1, n):
                y = y0 + (y1 - y0) * i / n
                if s == "left":
                    mb.box(x0 - depth, y - w / 2, z0, x0 + 0.1, y + w / 2, z1, mat)
                else:
                    mb.box(x1 - 0.1, y - w / 2, z0, x1 + depth, y + w / 2, z1, mat)


def gable_roof(mb, x0, x1, y0, y1, z_eave, z_ridge, mat="metal", over=0.6, t=0.25, gable_mat="facade_alt"):
    """Shallow gable roof with the ridge along x."""
    ym = (y0 + y1) / 2
    xa, xb = x0 - over, x1 + over
    ya, yb = y0 - over, y1 + over
    slope = (z_ridge - z_eave) / ((y1 - y0) / 2)
    za = z_eave - over * slope
    for (yy0, zz0, yy1, zz1) in ((ya, za, ym, z_ridge), (yb, za, ym, z_ridge)):
        top = [(xa, yy0, zz0 + t), (xb, yy0, zz0 + t), (xb, yy1, zz1 + t), (xa, yy1, zz1 + t)]
        bot = [(xa, yy0, zz0), (xb, yy0, zz0), (xb, yy1, zz1), (xa, yy1, zz1)]
        mb.face(top, mat, inside=(0, ym, zz1 - 5))
        mb.face(bot, mat, inside=(0, ym, zz1 + 5))
        for (p, q) in ((0, 1), (2, 3)):
            pass
        mb.face([bot[0], bot[1], top[1], top[0]], mat, inside=(0, ym, zz0))
        mb.face([bot[3], bot[0], top[0], top[3]], mat, inside=(xa + 5, ym, zz0))
        mb.face([bot[1], bot[2], top[2], top[1]], mat, inside=(xb - 5, ym, zz0))
    # gable end walls
    for x in (x0, x1):
        mb.face([(x, y0, z_eave), (x, y1, z_eave), (x, ym, z_ridge)], gable_mat, inside=(0, ym, z_eave))
    # ridge cap
    mb.box(xa, ym - 0.2, z_ridge + t - 0.05, xb, ym + 0.2, z_ridge + t + 0.12, "trim")


def downlights(mb, pts, z, size=0.5):
    for (x, y) in pts:
        mb.box(x - size / 2, y - size / 2, z - 0.06, x + size / 2, y + size / 2, z, "light_emissive", skip=("top",))


def flood_pole(mb, x, y, h=10.0, facing=(0, 1, 0)):
    mb.cylinder(x, y, 0, h, 0.1, "steel_dark", seg=8, r_top=0.07)
    f = Vector(facing).normalized()
    hx, hy = x + f.x * 0.4, y + f.y * 0.4
    mb.box(hx - 0.35, hy - 0.35, h - 0.3, hx + 0.35, hy + 0.35, h + 0.15, "steel_dark")
    mb.box(hx - 0.28 + f.x * 0.36, hy - 0.28 + f.y * 0.36, h - 0.22, hx + 0.28 + f.x * 0.36, hy + 0.28 + f.y * 0.36, h + 0.08, "light_emissive")


def planter_box(mb, x0, y0, x1, y1, h=0.7, seed=1, shrubs=3):
    r = rnd(seed)
    mb.box(x0, y0, 0, x1, y1, h, "concrete", c=0.04)
    mb.box(x0 + 0.15, y0 + 0.15, h - 0.12, x1 - 0.15, y1 - 0.15, h - 0.02, "rock")
    for i in range(shrubs):
        cx = x0 + (x1 - x0) * (i + 0.5) / shrubs
        cy = (y0 + y1) / 2
        rr = min(x1 - x0, y1 - y0) * 0.38
        mb.sphere(cx + r.uniform(-0.2, 0.2), cy, h + rr * 0.45, rr, "foliage", seg=7, rings=4, sz=rr * 0.75)


# ---------------------------------------------------------------------------
# hospital (52 x 40, ~34 m) ------------------------------------------------------
# ---------------------------------------------------------------------------

def hospital(mb):
    W, D = 52.0, 40.0
    fr = Frame(5.0, 4.2, 7)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
    info = {}
    # site
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    # --- podium (2 storeys) ---
    pr = (-25.0, 25.0, -13.0, 19.0)
    pod_top = fr.z(2)
    mb.box(pr[0] + 1.2, pr[2] + 1.6, 0.12, pr[1] - 1.2, pr[3] - 1.0, fr.z(1) - 0.2, "glazing", skip=("bottom", "top"))
    banded(mb, pr, [(fr.z(1) - 0.45, fr.z(1) + 0.9, "facade"), (fr.z(1) + 0.9, pod_top - 0.9, "glass"),
                    (pod_top - 0.9, pod_top + 0.35, "facade")], inset=0.5)
    mb.box(pr[0] + 0.3, pr[2] + 0.3, pod_top + 0.3, pr[1] - 0.3, pr[3] - 0.3, pod_top + 0.4, "roof")
    # podium colonnade piers on the lobby level
    for i in range(9):
        x = pr[0] + 1.0 + (pr[1] - pr[0] - 2.0) * i / 8
        mb.box(x - 0.35, pr[2] + 0.2, 0.12, x + 0.35, pr[2] + 0.9, fr.z(1) - 0.45, "facade", c=0.05)
    # podium parapet + coping
    edge_parapet(mb, pr, pod_top + 0.35, 0.9, 0.25, "facade")
    coping(mb, pr, pod_top + 1.25, 0.3)
    # --- ward tower ---
    tr = (-20.0, 20.0, -9.0, 11.0)
    t_top = fr.z(8)
    banded(mb, tr, storey_bands(fr, 2, 8, spandrel=1.15) + [(t_top, t_top + 0.6, "facade")], inset=0.55)
    fins(mb, tr, pod_top + 0.35, t_top, 4.0, 0.7, 0.28, "facade", sides=("front", "back"))
    fins(mb, tr, pod_top + 0.35, t_top, 4.0, 0.5, 0.28, "facade", sides=("left", "right"))
    # tower roof
    mb.box(tr[0] + 0.3, tr[2] + 0.3, t_top + 0.6, tr[1] - 0.3, tr[3] - 0.3, t_top + 0.7, "roof")
    edge_parapet(mb, tr, t_top + 0.6, 1.0, 0.25, "facade")
    coping(mb, tr, t_top + 1.6, 0.3)
    # --- front circulation core with the red cross ---
    cr = (-4.0, 4.0, -10.6, -8.6)
    core_top = t_top + 4.2
    mb.box(cr[0], cr[2], pod_top, cr[1], cr[3], core_top, "facade", c=0.08, mats={"top": "roof"})
    mb.box(cr[0] - 0.15, cr[2] - 0.15, core_top - 0.1, cr[1] + 0.15, cr[3] + 0.15, core_top + 0.2, "trim")
    # vertical glass slot on the core
    mb.box(-0.9, cr[2] - 0.02, pod_top + 1.0, 0.9, cr[2] + 0.4, t_top - 5.5, "glazing", skip=("back",))
    # red cross (emissive) on a white disc panel, facing the front and the back
    cz = core_top - 3.4
    with mb.xform(parts.frame_from_axis(Vector((0, cr[2] - 0.05, cz)), (0, -1, 0))):
        mb.cylinder(0, 0, 0, 0.25, 3.2, "facade", seg=24)
        mb.box(-0.75, -2.5, 0.25, 0.75, 2.5, 0.45, "emissive_sign")
        mb.box(-2.5, -0.75, 0.25, 2.5, 0.75, 0.45, "emissive_sign")
    info["redCross"] = (0.0, cr[2] - 0.5, cz)
    # "HOSPITAL" lettering above the entrance canopy on the podium fascia
    tw = parts.facade_text(mb, "HOSPITAL", 0.0, pr[2] - 0.0, pod_top - 1.75, 1.7, "emissive_sign", depth=0.22, facing=(0, -1, 0))
    # sign backing band
    mb.box(-tw / 2 - 0.8, pr[2] - 0.12, pod_top - 2.05, tw / 2 + 0.8, pr[2] + 0.05, pod_top - 0.2, "facade")
    info["sign"] = (0.0, pr[2] - 0.3, pod_top - 1.0)
    # --- main entrance canopy (drop-off) ---
    cy0, cy1 = -19.6, pr[2] + 0.5
    mb.box(-12.0, cy0, 4.55, 12.0, cy1, 5.0, "facade", c=0.06)
    mb.box(-12.1, cy0 - 0.08, 4.4, 12.1, cy0 + 0.25, 5.05, "trim")
    mb.box(-10.5, cy0 + 1.2, 4.98, 10.5, cy1 - 1.2, 5.06, "glass_clear")
    for x in (-10.0, -3.5, 3.5, 10.0):
        mb.cylinder(x, cy0 + 0.8, 0.12, 4.55, 0.18, "metal", seg=10)
    downlights(mb, [(x, y) for x in (-8, -4, 0, 4, 8) for y in (-17.5, -15.0)], 4.55, 0.45)
    # --- emergency entrance canopy (east, with small red cross) ---
    mb.box(14.0, -19.6, 3.9, 24.5, pr[2] + 0.5, 4.3, "facade", c=0.05)
    mb.box(14.0, -19.7, 4.3, 24.5, -19.3, 4.9, "valve_red")
    with mb.xform(parts.frame_from_axis(Vector((19.25, -19.75, 4.6)), (0, -1, 0))):
        mb.box(-0.12, -0.42, 0, 0.12, 0.42, 0.06, "light_emissive")
        mb.box(-0.42, -0.12, 0, 0.42, 0.12, 0.06, "light_emissive")
    for x in (14.5, 24.0):
        mb.cylinder(x, -19.0, 0.12, 3.9, 0.15, "metal", seg=10)
    # --- helipad on the tower roof (east half) ---
    hx, hy = 9.5, 1.0
    hz = t_top + 2.3
    for (lx, ly) in ((-6, -6), (6, -6), (6, 6), (-6, 6), (0, -7), (0, 7), (-7, 0), (7, 0)):
        mb.box(hx + lx - 0.18, hy + ly - 0.18, t_top + 0.7, hx + lx + 0.18, hy + ly + 0.18, hz - 0.35, "steel_dark")
    oct_pts = [(hx + 9.4 * math.cos(math.pi / 8 + i * math.pi / 4), hy + 9.4 * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]
    mb.prism(oct_pts, hz - 0.35, hz, "steel_dark", top=False, bottom=True)
    mb.face([(p[0], p[1], hz) for p in oct_pts], "asphalt", inside=(hx, hy, hz - 1))
    # touchdown circle (annulus) and H marking
    ring = []
    for i in range(24):
        a0, a1 = 2 * math.pi * i / 24, 2 * math.pi * (i + 1) / 24
        ro, ri = 6.0, 5.4
        mb.face([(hx + ri * math.cos(a0), hy + ri * math.sin(a0), hz + 0.02), (hx + ro * math.cos(a0), hy + ro * math.sin(a0), hz + 0.02),
                 (hx + ro * math.cos(a1), hy + ro * math.sin(a1), hz + 0.02), (hx + ri * math.cos(a1), hy + ri * math.sin(a1), hz + 0.02)],
                "facade", inside=(hx, hy, hz - 1))
    for (ax0, ay0, ax1, ay1) in ((-1.8, -2.6, -1.0, 2.6), (1.0, -2.6, 1.8, 2.6), (-1.0, -0.4, 1.0, 0.4)):
        mb.face([(hx + ax0, hy + ay0, hz + 0.02), (hx + ax1, hy + ay0, hz + 0.02), (hx + ax1, hy + ay1, hz + 0.02), (hx + ax0, hy + ay1, hz + 0.02)],
                "facade", inside=(hx, hy, hz - 1))
    for i in range(8):
        a = math.pi / 8 + i * math.pi / 4
        mb.box(hx + 9.0 * math.cos(a) - 0.18, hy + 9.0 * math.sin(a) - 0.18, hz, hx + 9.0 * math.cos(a) + 0.18, hy + 9.0 * math.sin(a) + 0.18, hz + 0.16, "light_emissive")
    # safety net frame
    for i in range(8):
        p0 = oct_pts[i]
        p1 = oct_pts[(i + 1) % 8]
        d0 = Vector((p0[0] - hx, p0[1] - hy, 0)).normalized()
        d1 = Vector((p1[0] - hx, p1[1] - hy, 0)).normalized()
        q0 = Vector((p0[0], p0[1], hz - 0.1)) + d0 * 1.4 + Vector((0, 0, 0.25))
        q1 = Vector((p1[0], p1[1], hz - 0.1)) + d1 * 1.4 + Vector((0, 0, 0.25))
        mb.beam(q0, q1, 0.08, 0.08, "trim")
        mb.beam(Vector((p0[0], p0[1], hz - 0.1)), q0, 0.06, 0.06, "trim")
    # access stair to the helipad
    mb.box(hx - 11.0, hy - 1.0, t_top + 0.7, hx - 9.2, hy + 1.0, hz - 0.2, "metal")
    info["helipad"] = (hx, hy, hz)
    # rooftop plant (west half of the tower)
    roof_plant(mb, -10.0, 1.0, t_top + 0.7, 14.0, 14.0, 41, tanks=2, units=4, overrun=True)
    mb.box(-16.5, 4.0, t_top + 0.7, -12.0, 9.0, t_top + 3.8, "facade", c=0.06)
    for x in (-15.5, -13.0):
        mb.cylinder(x, 6.5, t_top + 3.8, t_top + 5.4, 0.35, "metal", seg=10)
    # podium roof plant and skylights
    for x in (-21.0, 21.0):
        mb.box(x - 2.5, 13.0, pod_top + 0.4, x + 2.5, 17.5, pod_top + 2.4, "metal", c=0.05)
    for (x0, x1) in ((-24.0, -21.0), (21.0, 24.0)):
        mb.box(x0, -11.5, pod_top + 0.4, x1, 8.0, pod_top + 1.0, "glazing", skip=("bottom",))
    # forecourt planters and bollards
    planter_box(mb, -24.5, -19.5, -14.0, -17.5, seed=3, shrubs=4)
    planter_box(mb, 25.0 - 0.1, -12.0, 25.9, 18.0, h=0.6, seed=4, shrubs=0)
    for x in range(-11, 12, 2):
        mb.cylinder(float(x), -19.9, 0.12, 1.0, 0.12, "steel_dark", seg=8)
    info["roof_z"] = t_top + 0.7
    return info


# ---------------------------------------------------------------------------
# substation (62 x 58, ~14 m) -----------------------------------------------------
# ---------------------------------------------------------------------------

def transformer(mb, cx, cy, seed=1):
    """Power transformer with radiator banks, conservator and bushings (long axis x)."""
    # bund wall with gravel
    mb.box(cx - 5.0, cy - 4.2, 0.0, cx + 5.0, cy + 4.2, 0.45, "concrete", c=0.04)
    mb.box(cx - 4.7, cy - 3.9, 0.3, cx + 4.7, cy + 3.9, 0.42, "rock")
    # plinth + tank
    mb.box(cx - 3.0, cy - 1.8, 0.45, cx + 3.0, cy + 1.8, 0.9, "concrete")
    mb.box(cx - 2.7, cy - 1.55, 0.9, cx + 2.7, cy + 1.55, 4.6, "metal", c=0.08)
    mb.box(cx - 2.85, cy - 1.7, 4.6, cx + 2.85, cy + 1.7, 4.85, "metal", c=0.04)
    # stiffener ribs
    for x in (-1.8, 0.0, 1.8):
        for sy in (-1, 1):
            mb.box(cx + x - 0.1, cy + sy * 1.55 - (0.12 if sy > 0 else 0.0), 1.0, cx + x + 0.1, cy + sy * 1.55 + (0.0 if sy > 0 else 0.12), 4.5, "metal")
    # radiator banks on both long sides
    for sy in (-1, 1):
        for bank in (-1, 1):
            bx = cx + bank * 1.35
            y_in = cy + sy * 1.68
            y_out = cy + sy * 3.0
            ya, yb = sorted((y_in, y_out))
            for i in range(9):
                x = bx - 1.0 + i * 0.25
                mb.box(x - 0.03, ya, 1.1, x + 0.03, yb, 4.1, "metal")
            yc = (ya + yb) / 2
            mb.cyl_between((bx - 1.15, yc, 4.2), (bx + 1.15, yc, 4.2), 0.12, "metal", seg=8)
            mb.cyl_between((bx - 1.15, yc, 1.0), (bx + 1.15, yc, 1.0), 0.12, "metal", seg=8)
    # conservator tank on brackets
    mb.box(cx - 2.4, cy - 0.15, 4.85, cx - 2.2, cy + 0.15, 6.0, "metal")
    mb.box(cx + 0.6, cy - 0.15, 4.85, cx + 0.8, cy + 0.15, 6.0, "metal")
    mb.cyl_between((cx - 2.7, cy + 0.0, 6.35), (cx + 1.0, cy + 0.0, 6.35), 0.55, "metal", seg=14)
    # HV bushings (3) and LV bushings (3)
    for i, x in enumerate((-1.3, 0.0, 1.3)):
        parts.insulator(mb, cx + x + 1.2, cy - 0.7, 4.85, 2.7, r=0.17, sheds=7, mat="facade_alt")
        parts.insulator(mb, cx + x * 0.7 + 1.0, cy + 0.9, 4.85, 1.3, r=0.12, sheds=3, mat="facade_alt")
    # control cabinet
    mb.box(cx + 3.0, cy - 0.8, 0.9, cx + 3.6, cy + 0.8, 2.6, "metal", c=0.03)
    return [(cx + x + 1.2, cy - 0.7, 4.85 + 2.7) for x in (-1.3, 0.0, 1.3)]


def breaker(mb, x, y, h=2.6):
    """Dead-tank circuit breaker on a stand with two bushings."""
    for dx in (-0.7, 0.7):
        for dy in (-0.5, 0.5):
            mb.box(x + dx - 0.07, y + dy - 0.07, 0, x + dx + 0.07, y + dy + 0.07, h, "metal")
    mb.cyl_between((x - 1.1, y, h + 0.5), (x + 1.1, y, h + 0.5), 0.5, "metal", seg=12)
    parts.insulator(mb, x - 0.6, y, h + 0.9, 2.2, r=0.13, sheds=5, mat="facade_alt")
    parts.insulator(mb, x + 0.6, y, h + 0.9, 2.2, r=0.13, sheds=5, mat="facade_alt")
    mb.box(x - 0.4, y + 0.55, h - 1.2, x + 0.4, y + 1.0, h + 0.2, "metal")


def disconnector(mb, x, y, h=3.0, span=2.6):
    for dx in (-span / 2, span / 2):
        mb.box(x + dx - 0.12, y - 0.12, 0, x + dx + 0.12, y + 0.12, h, "metal")
        parts.insulator(mb, x + dx, y, h, 1.9, r=0.12, sheds=5, mat="facade_alt")
    mb.beam((x - span / 2, y, h + 1.95), (x + span / 2, y, h + 1.95), 0.08, 0.08, "metal")


def substation(mb):
    W, D = 62.0, 58.0
    info = {}
    fx0, fx1, fy0, fy1 = -30.6, 30.6, -28.6, 28.6
    # gravel yard and internal roads
    mb.box(fx0, fy0, 0, fx1, fy1, 0.1, "concrete")
    mb.box(-3.5, fy0, 0.1, 3.5, 12.0, 0.16, "asphalt")
    mb.box(-27.0, 8.6, 0.1, 27.0, 11.6, 0.16, "asphalt")
    # perimeter palisade with front gate opening
    gaps = [(0.0, fy0, 7.4)]
    parts.palisade(mb, [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1), (fx0, fy0)], h=2.6, mat="metal", gaps=gaps)
    # gate leaves (one open)
    for (ax, bx) in ((-3.6, -0.1),):
        mb.box(ax, fy0 - 0.05, 0.1, bx, fy0 + 0.05, 2.4, "metal")
    mb.box(0.3, fy0 - 3.6, 0.1, 0.4, fy0 - 0.1, 2.4, "metal")
    for gx in (-3.8, 3.8):
        mb.box(gx - 0.2, fy0 - 0.2, 0, gx + 0.2, fy0 + 0.2, 3.0, "facade", c=0.04)
    # gatehouse
    mb.box(5.0, fy0 + 0.6, 0.1, 9.0, fy0 + 4.0, 3.2, "facade_alt", c=0.06, mats={"top": "roof"})
    mb.box(4.7, fy0 + 0.3, 3.2, 9.3, fy0 + 4.3, 3.45, "facade")
    mb.box(5.6, fy0 + 0.55, 1.0, 8.4, fy0 + 0.7, 2.4, "glazing", skip=("back",))
    # --- control / switchgear building (back) ---
    cb = (-27.5, 4.5, 13.5, 26.5)
    ch = 6.2
    mb.box(cb[0], cb[2], 0.1, cb[1], cb[3], ch, "facade_alt", c=0.08, mats={"top": "roof"})
    mb.box(cb[0] - 0.2, cb[2] - 0.2, ch, cb[1] + 0.2, cb[3] + 0.2, ch + 0.4, "facade", c=0.05)
    mb.box(cb[0], cb[2] - 0.05, 0.1, cb[1], cb[2] + 0.2, 0.7, "facade")
    # louvre panels and doors on the front of the control building
    for i in range(6):
        x = cb[0] + 2.5 + i * 5.0
        parts.louvre_band(mb, "x", cb[2], x - 1.2, x + 1.2, 2.4, 4.6, "trim", pitch=0.22, out=0.12, sign=-1)
        mb.box(x - 1.3, cb[2] - 0.05, 2.3, x + 1.3, cb[2] + 0.02, 4.7, "trim")
    for x in (cb[0] + 5.0, cb[0] + 20.0):
        mb.box(x - 1.0, cb[2] - 0.08, 0.1, x + 1.0, cb[2] + 0.02, 2.6, "trim")
        mb.box(x - 1.6, cb[2] - 1.4, 2.9, x + 1.6, cb[2] + 0.1, 3.1, "facade")
        downlights(mb, [(x, cb[2] - 0.7)], 2.9, 0.35)
    edge_parapet(mb, (cb[0] - 0.2, cb[1] + 0.2, cb[2] - 0.2, cb[3] + 0.2), ch + 0.4, 0.6, 0.2, "facade")
    for i in range(5):
        ux = cb[0] + 3.0 + i * 5.5
        mb.box(ux - 0.9, 19.5, ch + 0.4, ux + 0.9, 21.3, ch + 1.6, "metal", c=0.04)
        mb.cylinder(ux, 20.4, ch + 1.6, ch + 1.66, 0.6, "steel_dark", seg=10, smooth=False)
    # --- transformers with firewall ---
    t_left = transformer(mb, -12.5, -8.0, 1)
    t_right = transformer(mb, 12.5, -8.0, 2)
    mb.box(-0.35, -13.0, 0.1, 0.35, -3.0, 8.0, "concrete", c=0.05)
    for x in (-19.0, 19.0):
        mb.box(x - 0.3, -13.0, 0.1, x + 0.3, -3.0, 6.5, "concrete", c=0.05)
    # --- busbar gantries (incoming bays, behind the transformers) ---
    gy = 3.0
    cols = [-26.0, -9.0, 9.0, 26.0]
    gh = 12.5
    for x in cols:
        parts.lattice_column(mb, x, gy, 0.1, gh, 1.3, 0.8, "metal", leg=0.13, brace=0.06, panels=8)
        mb.box(x - 0.9, gy - 0.9, 0.0, x + 0.9, gy + 0.9, 0.5, "concrete")
    for a, b in zip(cols[:-1], cols[1:]):
        parts.lattice_beam(mb, (a + 0.5, gy, gh - 0.6), (b - 0.5, gy, gh - 0.6), 0.9, 1.0, "metal", panels=8)
        # three phase insulator strings + strung busbars
        for k, ph in enumerate((-1, 0, 1)):
            x = (a + b) / 2 + ph * 3.2
            parts.insulator_between(mb, (x, gy, gh - 1.1), (x, gy, gh - 3.2), r=0.11, sheds=6)
            mb.cyl_between((a + 1.0, gy + (k - 1) * 0.0, gh - 3.35 + 0.0), (b - 1.0, gy, gh - 3.35), 0.05, "metal", seg=6)
    # lightning spikes on gantry tops
    for x in cols:
        mb.cylinder(x, gy, gh, gh + 3.0, 0.06, "metal", seg=6, r_top=0.02)
    # bay equipment between gantries and transformers: disconnectors + breakers, droppers
    for tx, bush in ((-12.5, t_left), (12.5, t_right)):
        disconnector(mb, tx, 1.2, 3.0, 2.6)
        breaker(mb, tx + 0.5, -1.6, 2.4)
        for i, (bx, by, bz) in enumerate(bush):
            top = Vector((tx - 3.2 + i * 3.2, gy, gh - 3.35))
            mid = Vector((bx, by - 2.5, bz + 1.6))
            mb.tube([top, (top + mid) / 2 + Vector((0, 0, -0.6)), mid, Vector((bx, by, bz))], 0.05, "metal", seg=5)
    # outgoing feeder cable terminations (front left)
    for i in range(4):
        x = -26.0 + i * 3.0
        mb.box(x - 0.15, -22.0, 0.1, x + 0.15, -21.7, 3.4, "metal")
        parts.insulator(mb, x, -21.85, 3.4, 1.0, r=0.1, sheds=3, mat="facade_alt")
    # cable trench covers
    mb.box(-13.3, -3.0, 0.1, -11.7, 13.5, 0.22, "concrete")
    mb.box(11.7, -3.0, 0.1, 13.3, 13.5, 0.22, "concrete")
    mb.box(-27.0, -20.5, 0.1, -12.0, -19.3, 0.22, "concrete")
    # lightning masts and flood lights
    for (x, y) in ((-28.6, -26.6), (28.6, 26.6)):
        parts.lattice_column(mb, x, y, 0.1, 15.5, 1.1, 0.35, "metal", leg=0.1, brace=0.05, panels=9)
        mb.cylinder(x, y, 15.5, 18.5, 0.06, "metal", seg=6, r_top=0.02)
    for (x, y, f) in ((-28.6, 26.6, (1, -1, 0)), (28.6, -26.6, (-1, 1, 0)), (-28.6, -10.0, (1, 0, 0)), (28.6, 10.0, (-1, 0, 0))):
        flood_pole(mb, x, y, 9.0, f)
    # warning sign panels on the fence
    for x in (-15.0, 15.0):
        mb.box(x - 0.45, fy0 - 0.08, 1.2, x + 0.45, fy0 - 0.03, 1.8, "valve_red")
    info["roof_z"] = ch + 0.4
    info["transformers"] = [(-12.5, -8.0, 4.85), (12.5, -8.0, 4.85)]
    return info


# ---------------------------------------------------------------------------
# pump station (26/28 x 18, ~11 m) + below-grade pump cutaway --------------------
# ---------------------------------------------------------------------------

def pump_station(mb, W):
    D = 18.0
    info = {}
    fr = Frame(4.2, 3.6, 1)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.0, 2.0)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.15, "concrete")
    hx0, hx1, hy0, hy1 = -W / 2 + 2.0, W / 2 - 2.0, -3.6, 8.2
    eave = 8.2
    # walls: concrete plinth, sand body, white top band
    mb.box(hx0, hy0, 0.15, hx1, hy1, 0.9, "concrete", c=0.04)
    mb.box(hx0 + 0.1, hy0 + 0.1, 0.9, hx1 - 0.1, hy1 - 0.1, 6.2, "facade_alt", c=0.06)
    mb.box(hx0 + 0.35, hy0 + 0.35, 6.2, hx1 - 0.35, hy1 - 0.35, 7.5, "glazing", skip=("top", "bottom"))
    mb.box(hx0, hy0, 7.5, hx1, hy1, eave, "facade", c=0.05)
    # clerestory mullions
    for i in range(1, int((hx1 - hx0) / 1.8)):
        x = hx0 + i * 1.8
        for yy in (hy0 + 0.2, hy1 - 0.45):
            mb.box(x - 0.06, yy, 6.2, x + 0.06, yy + 0.25, 7.5, "trim")
    gable_roof(mb, hx0, hx1, hy0, hy1, eave, eave + 1.9, "metal", over=0.5, gable_mat="facade")
    # roller door + canopy (front)
    dx = -W * 0.12
    mb.box(dx - 2.6, hy0 - 0.12, 0.15, dx + 2.6, hy0 + 0.05, 5.0, "trim")
    parts.louvre_band(mb, "x", hy0 - 0.12, dx - 2.4, dx + 2.4, 0.3, 4.9, "metal", pitch=0.3, out=0.05, sign=-1)
    mb.box(dx - 2.9, hy0 - 0.2, 5.0, dx + 2.9, hy0 + 0.1, 5.6, "facade")
    mb.box(dx - 3.2, hy0 - 1.6, 5.6, dx + 3.2, hy0 + 0.1, 5.85, "trim")
    # personnel door
    pdx = W * 0.2
    mb.box(pdx - 0.6, hy0 - 0.08, 0.15, pdx + 0.6, hy0 + 0.02, 2.4, "trim")
    mb.box(pdx - 1.1, hy0 - 1.1, 2.7, pdx + 1.1, hy0 + 0.05, 2.9, "facade")
    downlights(mb, [(pdx, hy0 - 0.6), (dx - 1.5, hy0 - 0.9), (dx + 1.5, hy0 - 0.9)], 2.7, 0.3)
    # side louvres
    for sx in (hx0, hx1):
        parts.louvre_band(mb, "y", sx, 1.0, 5.0, 2.0, 4.6, "trim", pitch=0.25, out=0.12, sign=-1 if sx == hx0 else 1)
    # roof ventilators along the ridge
    ym = (hy0 + hy1) / 2
    for i, x in enumerate((hx0 + 3.0, 0.0, hx1 - 3.0)):
        mb.cylinder(x, ym, eave + 1.9, eave + 2.6, 0.45, "metal", seg=10)
        with mb.T(0, 0, eave + 2.6):
            mb.lathe([(0.62, 0.0), (0.66, 0.35), (0.4, 0.75), (0.0, 0.85)], "metal", seg=10, cx=x, cy=ym)
    # --- external manifold at the front (towards the platform edge / galleries) ---
    r = 0.42
    for (px, tag) in ((-W * 0.3, "suction"), (W * 0.32, "discharge")):
        # riser from the ground into the wall
        parts.pipe(mb, [(px, -6.0, -0.5), (px, -6.0, 1.4), (px, hy0 - 0.2, 1.4)], r, "pipe", seg=12, bend_r=0.9)
        parts.gate_valve(mb, (px, -6.0, 0.6), (0, 0, 1), r, stem_up=(0, -1, 0))
        mb.box(px - 0.6, -6.6, 0.15, px + 0.6, -5.4, 0.35, "concrete")
        mb.box(px - 0.5, hy0 - 1.4, 0.15, px + 0.5, hy0 - 1.0, 1.0, "concrete")
    # flow meter on the discharge
    fxm = W * 0.32
    mb.cyl_between((fxm, hy0 - 2.6, 1.4), (fxm, hy0 - 1.8, 1.4), r * 1.35, "pipe", seg=12)
    mb.box(fxm - 0.25, hy0 - 2.45, 1.4 + r * 1.3, fxm + 0.25, hy0 - 1.95, 1.4 + r * 1.3 + 0.4, "steel_dark")
    # surge vessel (back corner)
    sy = D / 2 - 1.3
    mb.cylinder(W / 2 - 1.3, sy, 0.15, 0.6, 1.0, "concrete", seg=12)
    mb.lathe([(0.0, 0.6), (0.9, 0.75), (1.0, 1.0), (1.0, 4.2), (0.9, 4.45), (0.0, 4.6)], "pipe", seg=16, cx=W / 2 - 1.3, cy=sy)
    # electrical kiosk + pad-mounted transformer (supply bus)
    kx = -W / 2 + 1.3
    mb.box(kx - 1.0, -8.6, 0.15, kx + 1.0, -6.4, 2.5, "facade", c=0.05)
    parts.louvre_band(mb, "y", kx + 1.0, -8.3, -6.7, 0.6, 2.0, "trim", pitch=0.2, out=0.06, sign=1)
    mb.box(kx - 0.9, -5.8, 0.15, kx + 0.9, -4.2, 1.9, "steel_dark", c=0.04)
    for i in range(5):
        mb.box(kx + 0.9, -5.7 + i * 0.32, 0.4, kx + 1.15, -5.6 + i * 0.32, 1.7, "steel_dark")
    info["roof_z"] = eave + 1.9
    return info


def pump_cutaway(mb, direction):
    """Below-grade pump set in the station chamber; local coords of the station.
    Suction main ends at (0, -6, -24); transmission main starts at (0, -6, -15)."""
    d = direction
    py = -6.0
    floor = -27.25
    # isolation gate valve on the suction just upstream of the pump
    parts.gate_valve(mb, (-2.6 * d, py, -24.0), (1, 0, 0), PIPE_R, stem_up=(0, -1, 0))
    parts.pipe(mb, [(-4.2 * d, py, -24.0), (0.0, py, -24.0)], PIPE_R, "pipe", seg=16)
    noz = parts.pump_unit(mb, (0.0, py, -24.0), direction=d, r=PIPE_R, base_z=floor)
    # nozzle is offset towards -y in pump_unit; route the discharge riser
    nx, ny = noz.x, noz.y
    rr = PIPE_R * 0.72
    parts.check_valve(mb, (nx, ny, -19.8), (0, 0, 1), rr, up=(0, -1, 0))
    parts.gate_valve(mb, (nx, ny, -17.4), (0, 0, 1), rr, stem_up=(0, -1, 0))
    parts.pipe(mb, [(nx, ny, noz.z), (nx, ny, -15.0), (0.0, ny, -15.0), (0.0, py, -15.0)], rr, "pipe", seg=14, bend_r=1.2)
    # reducer to the main diameter
    with mb.xform(parts.frame_from_axis(Vector((0.4 * d, py, -15.0)), (-d, 0, 0))):
        mb.cylinder(0, 0, 0, 1.4, rr, "pipe", seg=14, r_top=PIPE_R)
    parts.flange(mb, (0.0, py, -15.0), (1, 0, 0), PIPE_R, "pipe")
    # riser supports and cable conduit to the station above
    mb.box(nx - 0.9, ny - 0.9, floor, nx + 0.9, ny + 0.9, floor + 0.4, "concrete")
    cx = 6.8 * d
    parts.pipe(mb, [(cx, py, -24.0 + PIPE_R * 1.75), (cx, py, -21.5), (cx, -2.0, -21.5), (cx, -2.0, -12.0)], 0.12, "steel_dark", seg=6, bend_r=0.4)
    # gauge panel
    mb.box(3.5 * d - 0.6, -2.4, floor + 0.4, 3.5 * d + 0.6, -1.9, floor + 2.4, "steel_dark", c=0.03)
    mb.box(3.5 * d - 0.45, -2.45, floor + 1.5, 3.5 * d + 0.45, -2.38, floor + 2.2, "light_emissive")
    return dict(suctionFlange=(0.0, py, -24.0), dischargeFlange=(0.0, py, -15.0), nozzle=(nx, ny, noz.z))


# ---------------------------------------------------------------------------
# water tower (T1 / T2) + water_level child -----------------------------------------
# ---------------------------------------------------------------------------

def water_tower(mb, foot, vessel_r, shaft_r0, shaft_r1, z_floor, level_h):
    """Returns info incl. the water level bounds."""
    info = {}
    R = foot / 2
    # base plaza ring + glowing water ring
    mb.cylinder(0, 0, 0, 0.3, R - 0.2, "concrete", seg=32)
    mb.cylinder(0, 0, 0.3, 0.6, shaft_r0 + 1.6, "facade", seg=32)
    mb.cylinder(0, 0, 0.6, 0.75, shaft_r0 + 1.3, "water", seg=32)
    # shaft (slightly tapered) with vertical recesses and stair windows
    z_top = z_floor - 4.2
    mb.cylinder(0, 0, 0.6, z_top, shaft_r0, "facade", seg=28, r_top=shaft_r1, top=False, bottom=False)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        for k in range(6):
            z = 4.0 + k * (z_top - 8.0) / 5
            rr = shaft_r0 + (shaft_r1 - shaft_r0) * (z / z_top)
            with mb.xform(parts.frame_from_axis(Vector((math.cos(a) * (rr - 0.05), math.sin(a) * (rr - 0.05), z)), (math.cos(a), math.sin(a), 0))):
                mb.box(-0.35, -0.9, 0.0, 0.35, 0.9, 0.12, "glazing")
    for z in (3.6, z_top * 0.5, z_top - 1.0):
        rr = shaft_r0 + (shaft_r1 - shaft_r0) * (z / z_top)
        mb.cylinder(0, 0, z, z + 0.35, rr + 0.12, "trim", seg=28)
    # entrance with canopy (front)
    mb.box(-1.0, -shaft_r0 - 0.2, 0.6, 1.0, -shaft_r0 + 0.6, 3.0, "trim")
    mb.box(-1.8, -shaft_r0 - 1.8, 3.0, 1.8, -shaft_r0 + 0.3, 3.25, "facade")
    # vessel: conical bottom, glazed level band, solid upper band, dome
    vr = vessel_r
    zb = z_floor - 0.3
    mb.lathe([(shaft_r1, z_top), (shaft_r1 + 0.4, z_top + 0.5), (vr - 0.3, zb - 0.6), (vr, zb)], "facade", seg=40)
    mb.cylinder(0, 0, zb, z_floor + 0.4, vr, "facade", seg=40, top=False, bottom=False)
    glass_top = z_floor + level_h + 0.1
    mb.cylinder(0, 0, z_floor + 0.4, glass_top, vr - 0.05, "glass_clear", seg=40, top=False, bottom=False)
    # glazing mullions
    for i in range(16):
        a = 2 * math.pi * i / 16
        mb.box(math.cos(a) * vr - 0.09, math.sin(a) * vr - 0.09, z_floor + 0.4, math.cos(a) * vr + 0.09, math.sin(a) * vr + 0.09, glass_top, "facade")
    mb.cylinder(0, 0, glass_top, glass_top + 1.4, vr, "facade", seg=40, top=False, bottom=False)
    # interior floor of the vessel (seen through the glass)
    mb.disc(0, 0, z_floor - 0.02, vr - 0.1, "steel_dark", seg=40)
    # walkway + railing ring
    mb.cylinder(0, 0, glass_top + 1.4, glass_top + 1.6, vr + 1.1, "facade", seg=40)
    pts = [(math.cos(2 * math.pi * i / 24) * (vr + 1.0), math.sin(2 * math.pi * i / 24) * (vr + 1.0), glass_top + 1.6) for i in range(24)]
    parts.railing(mb, pts, 1.0, "metal", post_every=2.5, closed=True)
    # dome
    dz = glass_top + 1.6
    prof = [(vr, dz)]
    for i in range(1, 7):
        t = i / 6
        prof.append((vr * math.cos(t * math.pi / 2), dz + 2.4 * math.sin(t * math.pi / 2)))
    mb.lathe(prof, "facade", seg=40)
    mb.cylinder(0, 0, dz + 2.35, dz + 2.9, 0.5, "metal", seg=12)
    mb.sphere(0, 0, dz + 3.05, 0.22, "light_emissive", seg=8, rings=4)
    # level gauge strip on the front (scene can ignore)
    info["levelMinZ"] = z_floor
    info["levelMaxZ"] = z_floor + level_h
    info["top"] = dz + 3.3
    return info


def water_level_mesh(vessel_r, level_h):
    mb = MeshBuilder()
    mb.cylinder(0, 0, 0, level_h, vessel_r - 0.25, "water", seg=40, top=True, bottom=True)
    return mb


# ---------------------------------------------------------------------------
# desalination supply R1 (44 x 24): ground storage tanks --------------------------
# ---------------------------------------------------------------------------

def storage_tank(mb, cx, cy, r, h, seed=1):
    # ring foundation
    mb.cylinder(cx, cy, 0.0, 0.45, r + 0.5, "concrete", seg=36)
    # shell with subtle horizontal seams
    mb.cylinder(cx, cy, 0.45, h, r, "facade", seg=36, top=False, bottom=False)
    for z in (0.45 + (h - 0.45) * k / 4 for k in (1, 2, 3)):
        mb.cylinder(cx, cy, z, z + 0.08, r + 0.03, "facade_alt", seg=36, top=False, bottom=False)
    # cone roof
    mb.lathe([(r + 0.15, h), (r * 0.15, h + r * 0.18), (0.0, h + r * 0.2)], "facade", seg=36, cx=cx, cy=cy)
    mb.cylinder(cx, cy, h + r * 0.18, h + r * 0.18 + 0.6, 0.45, "metal", seg=10)
    # roof handrail ring
    pts = [(cx + math.cos(2 * math.pi * i / 20) * (r - 0.4), cy + math.sin(2 * math.pi * i / 20) * (r - 0.4), h + 0.05 + r * 0.18 * 0.4 / r) for i in range(20)]
    parts.railing(mb, pts, 1.0, "metal", post_every=3.0, closed=True)
    # spiral stair (simplified helical stringer + steps)
    n = 16
    for i in range(n):
        a = -math.pi * 0.95 + i * (math.pi * 0.95) / n
        z = 0.45 + (h - 0.45) * (i + 1) / n
        p = Vector((cx + math.cos(a) * (r + 0.55), cy + math.sin(a) * (r + 0.55), z))
        mb.box(p.x - 0.5, p.y - 0.5, z - 0.08, p.x + 0.5, p.y + 0.5, z, "metal")
    for i in range(n):
        a0 = -math.pi * 0.95 + i * (math.pi * 0.95) / n
        a1 = -math.pi * 0.95 + (i + 1) * (math.pi * 0.95) / n
        z0 = 0.45 + (h - 0.45) * (i + 1) / n + 1.0
        z1 = 0.45 + (h - 0.45) * (i + 2) / n + 1.0 if i < n - 1 else z0
        mb.beam((cx + math.cos(a0) * (r + 1.05), cy + math.sin(a0) * (r + 1.05), z0), (cx + math.cos(a1) * (r + 1.05), cy + math.sin(a1) * (r + 1.05), z1), 0.05, 0.05, "metal")
    # level indicator strip
    mb.box(cx - 0.12, cy - r - 0.12, 1.0, cx + 0.12, cy - r + 0.05, h - 0.8, "steel_dark")


def desalination(mb):
    W, D = 44.0, 24.0
    info = {}
    fr = Frame(4.0, 3.5, 1)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.5, 2.5)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    # bund walls around the tank farm
    edge_parapet(mb, (-21.5, 21.5, -3.0, 11.8), 0.12, 1.1, 0.35, "concrete")
    mb.box(-21.2, -2.7, 0.12, 21.2, 11.5, 0.2, "rock")
    r, h = 5.0, 10.8
    centres = [(-15.2, 4.4), (0.0, 4.4), (15.2, 4.4)]
    for i, (cx, cy) in enumerate(centres):
        storage_tank(mb, cx, cy, r, h, seed=i)
    # header pipe along the front on pedestals, branches into each tank
    hr = 0.45
    hy = -5.6
    parts.pipe(mb, [(-18.0, hy, 1.2), (18.0, hy, 1.2)], hr, "pipe", seg=12)
    for (cx, cy) in centres:
        parts.pipe(mb, [(cx, hy, 1.2), (cx, cy - r - 0.3, 1.2)], hr * 0.8, "pipe", seg=10, bend_r=0.6)
        parts.gate_valve(mb, (cx, hy + 1.4, 1.2), (0, 1, 0), hr * 0.8, stem_up=(0, 0, 1))
    for x in range(-17, 18, 4):
        mb.box(x - 0.35, hy - 0.5, 0.12, x + 0.35, hy + 0.5, 1.2 - hr, "concrete")
    # outlet riser down to the suction main (R1 at x = 0, z = -24 in the base chamber)
    parts.pipe(mb, [(0.0, hy, 1.2), (0.0, -6.0, 1.2), (0.0, -6.0, -0.4)], hr * 1.2, "pipe", seg=12, bend_r=0.8)
    parts.flange(mb, (0.0, -6.0, -0.2), (0, 0, 1), hr * 1.2, "pipe")
    # pump/control building (front right)
    bx0, bx1, by0, by1 = 9.5, 21.0, -11.5, -6.6
    mb.box(bx0, by0, 0.12, bx1, by1, 4.6, "facade", c=0.06, mats={"top": "roof"})
    mb.box(bx0 + 0.5, by0 - 0.02, 1.0, bx1 - 3.5, by0 + 0.3, 3.4, "glazing", skip=("back",))
    mb.box(bx1 - 2.6, by0 - 0.05, 0.12, bx1 - 1.2, by0 + 0.05, 2.5, "trim")
    mb.box(bx0 - 0.2, by0 - 1.2, 4.6, bx1 + 0.2, by1 + 0.2, 4.9, "facade_alt")
    roof_plant(mb, (bx0 + bx1) / 2, (by0 + by1) / 2 + 1.0, 4.9, bx1 - bx0 - 2, by1 - by0 - 1, 51, tanks=0, units=2, overrun=False)
    # dosing skid and small tanks (front left)
    for i in range(3):
        mb.cylinder(-19.0 + i * 1.6, -9.5, 0.12, 2.4, 0.6, "facade", seg=12)
        mb.lathe([(0.6, 2.4), (0.3, 2.6), (0.0, 2.65)], "facade", seg=12, cx=-19.0 + i * 1.6, cy=-9.5)
    mb.box(-20.0, -11.3, 0.12, -15.6, -10.6, 1.4, "steel_dark")
    # perimeter fence on the front/sides (low palisade)
    parts.palisade(mb, [(-W / 2 + 0.3, -D / 2 + 0.3), (-W / 2 + 0.3, D / 2 - 0.3), (W / 2 - 0.3, D / 2 - 0.3), (W / 2 - 0.3, -D / 2 + 0.3)], h=2.0, mat="metal", pale_every=0.6)
    for (x, y, f) in ((-21.0, -11.0, (1, 1, 0)), (21.0, 11.0, (-1, -1, 0))):
        flood_pole(mb, x, y, 8.0, f)
    info["roof_z"] = h + r * 0.2
    return info


def intake_cutaway(mb):
    """Outlet riser from R1 down to the suction main (in the base 'R1' chamber)."""
    hr = 0.45 * 1.2
    parts.pipe(mb, [(0.0, -6.0, -0.4), (0.0, -6.0, -21.2)], hr, "pipe", seg=14)
    with mb.xform(parts.frame_from_axis(Vector((0.0, -6.0, -21.2)), (0, 0, -1))):
        mb.cylinder(0, 0, 0, 1.6, hr, "pipe", seg=14, r_top=PIPE_R)
    parts.flange(mb, (0.0, -6.0, -22.9), (0, 0, 1), PIPE_R, "pipe")
    # tee onto the suction main
    mb.sphere(0.0, -6.0, -24.0, PIPE_R * 1.15, "pipe", seg=16, rings=8)
    parts.gate_valve(mb, (0.0, -6.0, -12.5), (0, 0, 1), hr, stem_up=(0, -1, 0))
    for z in (-17.5, -11.2):
        mb.box(-0.8, -6.8, z, 0.8, -1.0, z + 0.3, "steel_dark")
    mb.box(-1.4, -7.4, -27.25, 1.4, -4.6, -24.0 - PIPE_R * 1.1, "concrete", c=0.05)


# ---------------------------------------------------------------------------
# district cooling plant (36 x 30, ~18 m) ------------------------------------------
# ---------------------------------------------------------------------------

def cooling_plant(mb):
    W, D = 36.0, 30.0
    info = {}
    fr = Frame(5.0, 3.0, 2)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 2.5, 2.5)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    hx0, hx1, hy0, hy1 = -17.4, 17.4, -5.5, 14.6
    hh = 11.0
    mb.box(hx0, hy0, 0.12, hx1, hy1, hh, "facade_alt", c=0.08, mats={"top": "roof"})
    mb.box(hx0 - 0.15, hy0 - 0.15, hh - 1.0, hx1 + 0.15, hy1 + 0.15, hh, "facade", c=0.05)
    mb.box(hx0, hy0 - 0.05, 0.12, hx1, hy0 + 0.2, 0.8, "facade")
    # louvred bays on the front and sides
    for i in range(6):
        x = hx0 + 3.0 + i * 5.8
        parts.louvre_band(mb, "x", hy0, x - 2.0, x + 2.0, 3.0, 9.0, "trim", pitch=0.28, out=0.14, sign=-1)
        mb.box(x - 2.15, hy0 - 0.06, 2.85, x + 2.15, hy0 + 0.02, 9.15, "steel_dark")
    for sx in (hx0, hx1):
        parts.louvre_band(mb, "y", sx, hy0 + 2.0, hy1 - 2.0, 3.0, 8.5, "trim", pitch=0.3, out=0.14, sign=-1 if sx == hx0 else 1)
    # entrance
    mb.box(9.0, hy0 - 0.06, 0.12, 12.0, hy0 + 0.02, 3.2, "glazing")
    mb.box(8.4, hy0 - 2.2, 3.4, 12.6, hy0 + 0.1, 3.7, "facade")
    # rooftop cooling tower cells (2 x 2) with fan stacks
    cells = [(-8.4, 0.6), (0.0, 0.6), (8.4, 0.6), (-8.4, 8.6), (0.0, 8.6), (8.4, 8.6)]
    for (cx, cy) in cells:
        c0 = hh
        mb.box(cx - 3.9, cy - 3.7, c0, cx + 3.9, cy + 3.7, c0 + 0.6, "concrete")
        mb.box(cx - 3.6, cy - 3.4, c0 + 0.6, cx + 3.6, cy + 3.4, c0 + 4.6, "facade", c=0.06)
        for side in (-1, 1):
            parts.louvre_band(mb, "x", cy + side * 3.4, cx - 3.3, cx + 3.3, c0 + 0.9, c0 + 3.0, "trim", pitch=0.3, out=0.12, sign=side)
        mb.box(cx - 3.6, cy - 3.4, c0 + 4.6, cx + 3.6, cy + 3.4, c0 + 4.8, "steel_dark")
        mb.cylinder(cx, cy, c0 + 4.8, c0 + 6.9, 2.75, "metal", seg=24, r_top=2.95, top=False, bottom=False)
        mb.cylinder(cx, cy, c0 + 4.8, c0 + 6.9, 2.6, "steel_dark", seg=24, r_top=2.8, top=False, bottom=False)
        mb.disc(cx, cy, c0 + 6.0, 2.6, "steel_dark", seg=24)
        mb.cylinder(cx, cy, c0 + 6.0, c0 + 6.5, 0.35, "metal", seg=10)
        for b in range(6):
            a = b * math.pi / 3 + 0.3
            mb.beam((cx, cy, c0 + 6.3), (cx + math.cos(a) * 2.45, cy + math.sin(a) * 2.45, c0 + 6.35), 0.5, 0.06, "metal")
    # thermal storage tank (front left) and chilled water pipes
    tx, ty = -10.0, -10.0
    mb.cylinder(tx, ty, 0.12, 0.6, 4.9, "concrete", seg=32)
    mb.cylinder(tx, ty, 0.6, 14.0, 4.5, "facade", seg=32, top=False, bottom=False)
    mb.lathe([(4.6, 14.0), (0.6, 14.9), (0.0, 15.0)], "facade", seg=32, cx=tx, cy=ty)
    for z in (4.0, 8.5, 12.5):
        mb.cylinder(tx, ty, z, z + 0.12, 4.56, "facade_alt", seg=32, top=False, bottom=False)
    for k, x in enumerate((2.0, 5.0)):
        parts.pipe(mb, [(x, hy0 - 0.2, 4.0), (x, -9.5, 4.0), (x, -9.5, 0.6), (x, -13.0, 0.6), (x, -13.0, -0.8)], 0.5, "pipe", seg=12, bend_r=1.0)
        mb.box(x - 0.5, -9.9, 0.12, x + 0.5, -9.1, 3.5, "concrete")
        parts.gate_valve(mb, (x, -11.2, 0.6), (0, 1, 0), 0.5, stem_up=(0, 0, 1))
    mb.cyl_between((tx + 4.5, ty, 2.0), (1.5, ty, 2.0), 0.35, "pipe", seg=10)
    # pump skids
    for i in range(3):
        mb.box(9.0 + i * 2.6, -12.5, 0.12, 10.8 + i * 2.6, -10.0, 1.6, "pipe", c=0.04)
    info["roof_z"] = hh
    return info


# ---------------------------------------------------------------------------
# emergency operations centre (40 x 30, ~22 m) -------------------------------------
# ---------------------------------------------------------------------------

def emergency_ops(mb):
    W, D = 40.0, 30.0
    info = {}
    fr = Frame(5.0, 4.0, 4)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 1.2, 1.2)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    br = (-19.5, 19.5, -11.0, 14.5)
    top = fr.z(4)  # 17 m
    # glazed recessed core with dense stone piers (civic, robust)
    mb.box(br[0] + 0.8, br[2] + 0.8, 0.12, br[1] - 0.8, br[3] - 0.8, top, "glazing", skip=("bottom",), mats={"top": "roof"})
    for k in range(1, 4):
        z = fr.z(k)
        mb.box(br[0], br[2], z - 0.6, br[1], br[3], z + 0.2, "facade_alt", c=0.05)
    fins(mb, (br[0] + 0.8, br[1] - 0.8, br[2] + 0.8, br[3] - 0.8), fr.z(1) - 0.6, top, 1.6, 0.8, 0.45, "facade_alt", sides=("front", "back", "left", "right"))
    # solid corner blocks
    for (x0, x1) in ((br[0], br[0] + 4.0), (br[1] - 4.0, br[1])):
        mb.box(x0, br[2], 0.12, x1, br[3], top + 0.4, "facade_alt", c=0.08, mats={"top": "roof"})
    # operations room: glazed top floor with deep overhanging roof
    orr = (-14.0, 14.0, -12.6, 10.0)
    mb.box(br[0], br[2], top, br[1], br[3], top + 0.4, "facade", c=0.05, mats={"top": "roof"})
    mb.box(orr[0], orr[2], top + 0.4, orr[1], orr[3], top + 4.6, "glazing", skip=("bottom",))
    for i in range(15):
        x = orr[0] + i * (orr[1] - orr[0]) / 14
        mb.box(x - 0.07, orr[2] - 0.05, top + 0.4, x + 0.07, orr[2] + 0.1, top + 4.6, "trim")
    mb.box(orr[0] - 1.2, orr[2] - 1.4, top + 4.6, orr[1] + 1.2, orr[3] + 1.0, top + 5.3, "facade", c=0.06, mats={"top": "roof"})
    rz = top + 5.3
    # entrance canopy + flagpoles + bollards
    mb.box(-6.0, -15.0, 4.0, 6.0, br[2] + 0.2, 4.4, "facade", c=0.05)
    for x in (-5.5, 5.5):
        mb.box(x - 0.25, -14.8, 0.12, x + 0.25, -14.3, 4.0, "facade_alt")
    downlights(mb, [(-3, -13.0), (0, -13.0), (3, -13.0)], 4.0, 0.4)
    for x in (-13.0, -10.5, -8.0):
        mb.cylinder(x, -13.8, 0.12, 9.0, 0.08, "metal", seg=8, r_top=0.05)
        mb.sphere(x, -13.8, 9.05, 0.12, "metal", seg=6, rings=3)
    for x in range(-18, 19, 3):
        if abs(x) > 7:
            mb.cylinder(float(x), -14.6, 0.12, 1.0, 0.13, "steel_dark", seg=8)
    # roof: lattice antenna mast, satellite dishes, comms shelter, plant
    parts.lattice_column(mb, -9.0, 5.0, rz, rz + 14.0, 1.4, 0.45, "steel_dark", leg=0.1, brace=0.05, panels=10)
    mb.cylinder(-9.0, 5.0, rz + 14.0, rz + 17.0, 0.06, "metal", seg=6, r_top=0.03)
    mb.sphere(-9.0, 5.0, rz + 17.1, 0.16, "light_emissive", seg=8, rings=4)
    for (zz, a) in ((rz + 6.0, 0.0), (rz + 9.5, 2.1), (rz + 12.0, 4.2)):
        d = Vector((math.cos(a), math.sin(a), 0))
        mb.cyl_between((-9.0 + d.x * 0.5, 5.0 + d.y * 0.5, zz), (-9.0 + d.x * 1.3, 5.0 + d.y * 1.3, zz), 0.35, "facade", seg=10)
    for (x, y, f) in ((3.0, 3.0, (0.2, -0.6, 0.75)), (7.5, 3.0, (-0.3, -0.6, 0.7)), (11.5, 5.5, (0.0, -0.5, 0.85))):
        mb.box(x - 0.4, y - 0.4, rz, x + 0.4, y + 0.4, rz + 1.2, "steel_dark")
        parts.dish(mb, (x, y, rz + 2.3), f, R=1.5, depth=0.45, mat="facade")
    mb.box(-14.5, 1.0, rz, -11.0, 8.0, rz + 3.0, "facade", c=0.06)
    roof_plant(mb, 6.0, -4.0, rz, 12.0, 6.0, 61, tanks=0, units=4, overrun=False)
    # standby generator enclosure (east side) with exhaust stacks and fuel tank
    gx0, gx1 = 14.5, 19.8
    mb.box(gx0, -14.5, 0.12, gx1, -12.0, 2.9, "facade_alt", c=0.05)
    parts.louvre_band(mb, "x", -14.5, gx0 + 0.5, gx1 - 0.5, 0.6, 2.4, "trim", pitch=0.22, out=0.06, sign=-1)
    for x in (gx0 + 1.3, gx1 - 1.3):
        mb.cylinder(x, -12.8, 2.9, 5.0, 0.22, "steel_dark", seg=8)
    mb.cyl_between((gx0 - 3.6, -13.2, 0.9), (gx0 - 0.6, -13.2, 0.9), 0.75, "facade", seg=14)
    info["roof_z"] = rz
    info["mastTop"] = (-9.0, 5.0, rz + 17.1)
    return info


# ---------------------------------------------------------------------------
# mall (56 x 44, ~24 m) ----------------------------------------------------------------
# ---------------------------------------------------------------------------

def mall(mb):
    W, D = 56.0, 44.0
    info = {}
    fr = Frame(6.5, 5.5, 2)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 3.0, 3.0)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    mr = (-27.5, 27.5, -15.0, 21.5)
    top = 18.5
    # shopfront level: recessed glazing + continuous canopy
    mb.box(mr[0] + 1.6, mr[2] + 2.5, 0.12, mr[1] - 1.6, mr[3] - 1.6, 6.8, "glazing", skip=("bottom", "top"))
    for i in range(12):
        x = mr[0] + 1.0 + (mr[1] - mr[0] - 2.0) * i / 11
        mb.box(x - 0.5, mr[2] + 0.3, 0.12, x + 0.5, mr[2] + 1.4, 6.8, "facade_alt", c=0.05)
    mb.box(mr[0] + 0.5, mr[2] - 1.0, 5.6, mr[1] - 0.5, mr[2] + 2.5, 5.95, "trim")
    # upper mass with mashrabiya panels in stone frames
    mb.box(mr[0], mr[2], 6.8, mr[1], mr[3], top, "facade_alt", c=0.1, mats={"top": "roof"})
    mb.box(mr[0] - 0.2, mr[2] - 0.2, 6.8, mr[1] + 0.2, mr[3] + 0.2, 7.6, "facade", c=0.05)
    mb.box(mr[0] - 0.2, mr[2] - 0.2, top - 0.9, mr[1] + 0.2, mr[3] + 0.2, top, "facade", c=0.05)
    for (a0, a1) in ((-26.0, -16.0), (-14.5, -10.0), (10.0, 14.5), (16.0, 26.0)):
        mb.box(a0, mr[2] - 0.05, 8.4, a1, mr[2] + 0.3, top - 1.7, "glazing", skip=("back",))
        screen_panel(mb, "x", mr[2] - 0.35, a0 + 0.15, a1 - 0.15, 8.5, top - 1.8, "accent", cell=1.4, slat=0.1)
    for sx in (-1, 1):
        fixed = sx * (mr[1] + 0.3)
        mb.box(min(fixed, sx * mr[1]) - 0.0, -6.0, 8.4, max(fixed, sx * mr[1]), 12.0, top - 1.7, "glazing")
        screen_panel(mb, "y", fixed + sx * 0.05, -5.8, 11.8, 8.5, top - 1.8, "accent", cell=1.4, slat=0.1)
    # central glass atrium entrance with a sweeping canopy
    ar = (-9.0, 9.0, -21.0, -13.0)
    mb.box(ar[0], ar[2], 0.12, ar[1], ar[3], 21.5, "glazing", skip=("bottom",), mats={"top": "roof"})
    for i in range(7):
        x = ar[0] + i * (ar[1] - ar[0]) / 6
        mb.box(x - 0.1, ar[2] - 0.15, 0.12, x + 0.1, ar[2] + 0.05, 21.5, "trim")
    for z in (6.8, 12.0, 17.0):
        mb.box(ar[0], ar[2] - 0.15, z - 0.1, ar[1], ar[2] + 0.05, z + 0.1, "trim")
    mb.box(-13.0, -22.0, 21.5, 13.0, -8.0, 22.3, "facade", c=0.08)
    mb.box(-13.1, -22.1, 21.3, 13.1, -21.6, 22.4, "trim")
    for x in (-11.5, 11.5):
        mb.cylinder(x, -20.5, 0.12, 21.5, 0.35, "facade", seg=12, r_top=0.25)
    downlights(mb, [(x, -18.5) for x in (-10.5, -6, 6, 10.5)], 21.5, 0.6)
    # side entrances
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 27.5, sx * 28.0))
        mb.box(x0, -2.0, 0.12, x1, 6.0, 6.0, "glazing")
        xa, xb = sorted((sx * 27.0, sx * 28.0))
        mb.box(xa, -3.0, 6.0, xb, 7.0, 6.4, "trim")
    # roof: barrel-vault skylight along the spine + plant
    vx0, vx1 = -5.5, 5.5
    vy0, vy1 = -12.5, 18.5
    segs = 8
    rad = (vx1 - vx0) / 2
    for i in range(segs):
        a0 = math.pi * i / segs
        a1 = math.pi * (i + 1) / segs
        p0 = (rad * math.cos(a0), rad * 0.55 * math.sin(a0))
        p1 = (rad * math.cos(a1), rad * 0.55 * math.sin(a1))
        mb.face([(p0[0], vy0, top + p0[1]), (p0[0], vy1, top + p0[1]), (p1[0], vy1, top + p1[1]), (p1[0], vy0, top + p1[1])],
                "glass_clear", inside=(0, (vy0 + vy1) / 2, top - 5))
    for y in (vy0, vy1):
        pts = [(rad * math.cos(math.pi * i / segs), y, top + rad * 0.55 * math.sin(math.pi * i / segs)) for i in range(segs + 1)]
        mb.face(pts, "trim", inside=(0, y + (5 if y == vy0 else -5), top + 1))
    for k in range(9):
        y = vy0 + (vy1 - vy0) * k / 8
        for i in range(segs):
            a0 = math.pi * i / segs
            a1 = math.pi * (i + 1) / segs
            mb.beam((rad * math.cos(a0), y, top + rad * 0.55 * math.sin(a0) + 0.05), (rad * math.cos(a1), y, top + rad * 0.55 * math.sin(a1) + 0.05), 0.12, 0.12, "trim")
    edge_parapet(mb, (mr[0], mr[1], mr[2], mr[3]), top, 1.0, 0.3, "facade")
    roof_plant(mb, -17.0, 8.0, top, 14.0, 14.0, 71, tanks=0, units=6, overrun=False)
    roof_plant(mb, 17.0, 8.0, top, 14.0, 14.0, 72, tanks=0, units=6, overrun=True)
    mb.box(vx0, vy0, top - 0.3, vx1, vy1, top + 0.05, "light_emissive", skip=("bottom",))
    for x in (-16.0, 16.0):
        mb.box(x - 5.0, -10.0, top, x + 5.0, -2.0, top + 0.6, "glass_clear", skip=("bottom",))
    # forecourt planters
    planter_box(mb, -26.0, -21.5, -16.0, -19.6, seed=7, shrubs=4)
    planter_box(mb, 16.0, -21.5, 26.0, -19.6, seed=8, shrubs=4)
    info["roof_z"] = top
    return info


# ---------------------------------------------------------------------------
# office complex (48 x 40, ~62 m) -----------------------------------------------------
# ---------------------------------------------------------------------------

def curtain_tower(mb, rect, z0, z1, fh, fin_sp=1.5, band_every=3, mat_band="facade", fin_mat="trim"):
    x0, x1, y0, y1 = rect
    mb.box(x0 + 0.4, y0 + 0.4, z0, x1 - 0.4, y1 - 0.4, z1, "glazing", skip=("bottom", "top"))
    k = 0
    z = z0
    while z < z1 - 0.1:
        thick = (k % band_every == 0)
        mb.box(x0 + (0.1 if thick else 0.3), y0 + (0.1 if thick else 0.3), z - (0.45 if thick else 0.12), x1 - (0.1 if thick else 0.3), y1 - (0.1 if thick else 0.3), z + 0.1,
               mat_band if thick else "trim")
        z += fh
        k += 1
    fins(mb, (x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4), z0, z1, fin_sp, 0.35, 0.1, fin_mat, sides=("front", "back", "left", "right"))
    for (px, py) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        ax, bx = sorted((px, px + (0.9 if px == x0 else -0.9)))
        ay, by = sorted((py, py + (0.9 if py == y0 else -0.9)))
        mb.box(ax, ay, z0, bx, by, z1 + 1.0, mat_band, c=0.05)


def office_complex(mb):
    W, D = 48.0, 40.0
    info = {}
    fr = Frame(6.0, 3.75, 15)
    mb.glazing_uv = glazing_uv_fn(W, D, fr, 1.5, 1.5)
    mb.box(-W / 2, -D / 2, 0, W / 2, D / 2, 0.12, "concrete")
    # podium (3 storeys)
    pr = (-23.5, 23.5, -16.0, 19.5)
    ptop = fr.z(3)
    mb.box(pr[0] + 1.2, pr[2] + 2.0, 0.12, pr[1] - 1.2, pr[3] - 1.0, fr.z(1) - 0.2, "glazing", skip=("bottom", "top"))
    banded(mb, pr, [(fr.z(1) - 0.5, fr.z(1) + 0.6, "facade"), (fr.z(1) + 0.6, fr.z(2) - 0.3, "glass"), (fr.z(2) - 0.3, fr.z(2) + 0.6, "facade"),
                    (fr.z(2) + 0.6, ptop - 0.3, "glass"), (ptop - 0.3, ptop + 0.4, "facade")], inset=0.5)
    for i in range(9):
        x = pr[0] + 0.8 + (pr[1] - pr[0] - 1.6) * i / 8
        mb.box(x - 0.4, pr[2] + 0.3, 0.12, x + 0.4, pr[2] + 1.2, fr.z(1) - 0.5, "facade", c=0.05)
    mb.box(-10.0, -20.0, 4.6, 10.0, pr[2] + 0.5, 5.0, "facade", c=0.06)
    mb.box(-10.1, -20.1, 4.45, 10.1, -19.8, 5.1, "trim")
    for x in (-9.0, 9.0):
        mb.cylinder(x, -19.2, 0.12, 4.6, 0.2, "metal", seg=10)
    edge_parapet(mb, pr, ptop + 0.4, 1.0, 0.25, "facade", glass=True)
    mb.box(pr[0] + 0.3, pr[2] + 0.3, ptop + 0.35, pr[1] - 0.3, pr[3] - 0.3, ptop + 0.45, "roof")
    # tower A (tall) and B (lower)
    ta = (-22.0, -3.0, -14.0, 3.0)
    tb = (3.0, 22.0, -1.0, 16.0)
    za1 = fr.z(16)  # 6 + 15*3.75 = 62.25
    zb1 = fr.z(12)
    curtain_tower(mb, ta, ptop + 0.4, za1, fr.fh, 1.5, 3)
    curtain_tower(mb, tb, ptop + 0.4, zb1, fr.fh, 1.5, 3)
    # crowns
    mb.box(ta[0] + 0.4, ta[2] + 0.4, za1, ta[1] - 0.4, ta[3] - 0.4, za1 + 0.4, "roof")
    for (x0, y0, x1, y1) in ((ta[0], ta[2], ta[1], ta[2] + 0.3), (ta[0], ta[3] - 0.3, ta[1], ta[3]), (ta[0], ta[2], ta[0] + 0.3, ta[3]), (ta[1] - 0.3, ta[2], ta[1], ta[3])):
        mb.box(x0, y0, za1, x1, y1, za1 + 2.8, "glazing")
    roof_plant(mb, (ta[0] + ta[1]) / 2, (ta[2] + ta[3]) / 2, za1 + 0.4, 12.0, 12.0, 81, tanks=0, units=3, overrun=True)
    mb.box(tb[0] + 0.4, tb[2] + 0.4, zb1, tb[1] - 0.4, tb[3] - 0.4, zb1 + 0.4, "roof")
    edge_parapet(mb, tb, zb1 + 0.4, 1.1, 0.2, "trim", glass=True)
    pergola(mb, tb[0] + 2.0, tb[1] - 7.0, tb[2] + 2.0, tb[3] - 2.0, zb1 + 0.4, 2.8, "accent", post_mat="facade")
    roof_plant(mb, tb[1] - 4.0, (tb[2] + tb[3]) / 2, zb1 + 0.4, 6.0, 10.0, 82, tanks=0, units=2, overrun=True)
    # sky bridge
    bz = fr.z(9)
    mb.box(-3.2, -0.6, bz - 0.4, 3.2, 2.6, bz + 3.6, "glazing", skip=())
    mb.box(-3.2, -0.7, bz - 0.6, 3.2, 2.7, bz - 0.2, "facade")
    mb.box(-3.2, -0.7, bz + 3.6, 3.2, 2.7, bz + 4.0, "facade")
    info["roof_z"] = za1 + 0.4
    return info


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def _rec(name, kind, v, mb_or_lohi, ob, info, extra=None, facility=None, notes=""):
    lo, hi = mb_or_lohi
    rec = dict(id=name, kind=kind, variant=v, node=name,
               nominalSize=[round(hi.x - lo.x, 2), round(hi.y - lo.y, 2), round(hi.z - max(0.0, lo.z), 2)],
               anchors={"label": [0.0, round(hi.z + 6.0, 2), 0.0]}, notes=notes)
    if "roof_z" in info:
        rec["anchors"]["roofY"] = round(info["roof_z"], 2)
    if facility:
        rec["facilityId"] = facility
    if extra:
        rec["anchors"].update(extra)
    return rec


def build_group():
    out = {}

    def coll(stem):
        c = bpy.data.collections.get("KIT_" + stem)
        if c is None:
            c = bpy.data.collections.new("KIT_" + stem)
            bpy.context.scene.collection.children.link(c)
        return c

    # hospital
    mb = MeshBuilder()
    info = hospital(mb)
    ob = build_object(mb, "hospital_v0", coll("hospital"))
    out["hospital"] = [(ob, _rec("hospital_v0", "hospital", 0, mb.bounds(), ob, info, facility="hospital",
                                 extra={"helipad": to_three(info["helipad"]), "redCross": to_three(info["redCross"]), "sign": to_three(info["sign"])},
                                 notes="City Hospital: podium + ward tower, red cross and HOSPITAL lettering (emissive_sign), drop-off canopy, emergency canopy, rooftop helipad."))]
    # substation
    mb = MeshBuilder()
    info = substation(mb)
    ob = build_object(mb, "substation_v0", coll("substation"))
    out["substation"] = [(ob, _rec("substation_v0", "substation", 0, mb.bounds(), ob, info, facility="substation-s1",
                                   extra={"transformers": [to_three(t) for t in info["transformers"]]},
                                   notes="Substation S1 compound: two power transformers with radiator banks/conservators/bushings, firewalls, busbar gantries with insulator strings, breakers and disconnectors, control building, palisade fence and gate."))]
    # pump stations (PS-1 26 m wide, suction from -X; PS-2 28 m wide, suction from +X)
    items = []
    for v, (W, d, fac) in enumerate(((26.0, 1, "ps-1"), (28.0, -1, "ps-2"))):
        mb = MeshBuilder()
        info = pump_station(mb, W)
        name = "pump-station_v%d" % v
        ob = build_object(mb, name, coll("pump-station"))
        mbc = MeshBuilder()
        cinfo = pump_cutaway(mbc, d)
        cname = "pump_cutaway" if v == 0 else "pump_cutaway_v%d" % v
        cob = build_object(mbc, cname, coll("pump-station"), parent=ob)
        lo, hi = mb.bounds()
        rec = _rec(name, "pump-station", v, (lo, hi), ob, info, facility=fac,
                   extra={"suctionFlange": to_three(cinfo["suctionFlange"]), "dischargeFlange": to_three(cinfo["dischargeFlange"]),
                          "pumpCutawayNode": cname, "pumpCutawayMinY": -27.6, "pumpCutawayMaxY": -11.5},
                   notes=("Pumping station %s. Child node '%s' sits below grade (y -27.6..-11.5, z +1..+12 local) in the "
                          "district-base chamber: suction gate valve, end-suction pump + motor, check and gate valves, "
                          "discharge riser. The suction main (y=-24) ends at the suction flange; the transmission main "
                          "(y=-15) starts at the discharge flange (local x=0, z=+6)." % (fac.upper(), cname)))
        items.append((ob, rec))
    out["pump-station"] = items
    # water towers
    items = []
    for v, (foot, vr, s0, s1, zf, lh, fac, maxl) in enumerate(((16.0, 6.5, 3.3, 2.5, 36.0, 9.0, "tank-t1", 9.0),
                                                                  (14.0, 4.6, 2.7, 2.0, 37.0, 7.0, "tank-t2", 7.0))):
        mb = MeshBuilder()
        info = water_tower(mb, foot, vr, s0, s1, zf, lh)
        name = "water-tower_v%d" % v
        ob = build_object(mb, name, coll("water-tower"))
        lmb = water_level_mesh(vr, lh)
        lname = "water_level" if v == 0 else "water_level_v%d" % v
        lob = build_object(lmb, lname, coll("water-tower"), parent=ob)
        lob.location = (0.0, 0.0, zf)
        lo, hi = mb.bounds()
        rec = _rec(name, "water-tower", v, (lo, hi), ob, info, facility=fac,
                   extra={"waterLevelNode": lname, "waterLevelMinY": round(info["levelMinZ"], 3), "waterLevelMaxY": round(info["levelMaxZ"], 3),
                          "tankMaxLevelM": maxl, "beacon": [0.0, round(info["top"], 2), 0.0]},
                   notes=("Elevated tank %s. Child '%s' is the water column: origin at waterLevelMinY, height = "
                          "waterLevelMaxY - waterLevelMinY at scale.y = 1; set scale.y = clamp(levelM / tankMaxLevelM, 0.001, 1). "
                          "It is visible through the glass_clear band of the vessel." % (fac.upper(), lname)))
        items.append((ob, rec))
    out["water-tower"] = items
    # desalination supply R1
    mb = MeshBuilder()
    info = desalination(mb)
    ob = build_object(mb, "desalination-inlet_v0", coll("desalination-inlet"))
    imb = MeshBuilder()
    intake_cutaway(imb)
    build_object(imb, "intake_cutaway", coll("desalination-inlet"), parent=ob)
    out["desalination-inlet"] = [(ob, _rec("desalination-inlet_v0", "desalination-inlet", 0, mb.bounds(), ob, info, facility="desal-r1",
                                           extra={"suctionOrigin": to_three((0.0, -6.0, -24.0)), "intakeCutawayNode": "intake_cutaway"},
                                           notes="Desalination supply R1: three ground storage tanks, header and valves, pump/control building. Child 'intake_cutaway' drops the outlet riser into the base's R1 chamber and tees onto the suction main at (local) x=0, y=-24, z=+6."))]
    # cooling plant
    mb = MeshBuilder()
    info = cooling_plant(mb)
    ob = build_object(mb, "cooling-plant_v0", coll("cooling-plant"))
    out["cooling-plant"] = [(ob, _rec("cooling-plant_v0", "cooling-plant", 0, mb.bounds(), ob, info, facility="cooling-dc1",
                                      notes="District cooling plant DC-1: chiller hall with louvres, six rooftop cooling-tower cells with fan stacks, thermal storage tank and chilled-water pipework."))]
    # emergency ops
    mb = MeshBuilder()
    info = emergency_ops(mb)
    ob = build_object(mb, "emergency-ops_v0", coll("emergency-ops"))
    out["emergency-ops"] = [(ob, _rec("emergency-ops_v0", "emergency-ops", 0, mb.bounds(), ob, info, facility="eoc",
                                      extra={"mastTop": to_three(info["mastTop"])},
                                      notes="Emergency Operations Centre: robust stone civic block, glazed operations room, antenna mast with aviation light, satellite dishes, standby generator."))]
    # mall
    mb = MeshBuilder()
    info = mall(mb)
    ob = build_object(mb, "mall_v0", coll("mall"))
    out["mall"] = [(ob, _rec("mall_v0", "mall", 0, mb.bounds(), ob, info, facility="mall",
                             notes="Retail mall: shopfront arcade, mashrabiya-screen upper mass, glass atrium with cantilevered canopy, barrel skylight."))]
    # office complex
    mb = MeshBuilder()
    info = office_complex(mb)
    ob = build_object(mb, "office-complex_v0", coll("office-complex"))
    out["office-complex"] = [(ob, _rec("office-complex_v0", "office-complex", 0, mb.bounds(), ob, info, facility="office-complex",
                                       notes="Office complex: three-storey podium with two curtain-wall towers (62 m / 47 m) linked by a sky bridge."))]
    return out


def _water_preview(roots, path, res):
    import render_preview as pv
    pv.preview_lineup(roots, path, res=res, azim=28.0, elev=12.0, gap=10.0, lens=50.0, margin=1.08)


def _pump_preview(roots, path, res):
    import render_preview as pv
    pv.preview_lineup(roots, path, res=res, azim=28.0, elev=22.0, gap=8.0, lens=50.0, margin=1.08)
    # cutaway close-up: hide ground so the below-grade part is visible
    g = bpy.context.scene.objects.get("_pv_ground")
    gz = g.location.z if g else 0.0
    if g:
        g.location.z = -60.0
    try:
        pv.preview_lineup(roots, path.replace(".jpg", "_cutaway.jpg"), res=res, azim=18.0, elev=8.0, gap=8.0, lens=50.0, margin=1.04)
    finally:
        if g:
            g.location.z = gz


PREVIEW_OPTS = {
    "water-tower": {"custom": _water_preview},
    "pump-station": {"custom": _pump_preview},
    "substation": {"azim": 32.0, "elev": 34.0},
    "hospital": {"azim": 28.0, "elev": 26.0},
}
