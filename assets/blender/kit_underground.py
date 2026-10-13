"""
Underground kit (underground-kit.glb): pump unit, gate valve, check valve, pipe saddle,
concrete valve chamber and cable duct.  Sized for the scene's visual pipe radius
(0.9 m).  Inline parts (valves) have their origin on the pipe axis and run along
three.js X; floor-standing parts have their origin on the floor.
"""

import math

import bpy
from mathutils import Vector

from common import MeshBuilder, build_object, to_three
import parts
from parts import PIPE_R


def pump_unit_part(mb):
    axis_z = PIPE_R * 2.6
    noz = parts.pump_unit(mb, (0.0, 0.0, axis_z), direction=1, r=PIPE_R, base_z=0.0)
    return dict(suctionFlange=(0.0, 0.0, axis_z), dischargeNozzle=tuple(noz))


def gate_valve_part(mb):
    parts.gate_valve(mb, (0.0, 0.0, 0.0), (1, 0, 0), PIPE_R, stem_up=(0, 0, 1))
    return dict(pipeAxis=(0.0, 0.0, 0.0))


def check_valve_part(mb):
    parts.check_valve(mb, (0.0, 0.0, 0.0), (1, 0, 0), PIPE_R, up=(0, 0, 1))
    return dict(pipeAxis=(0.0, 0.0, 0.0))


def saddle_part(mb):
    top = 1.6
    mb.box(-0.65, -1.3, 0.0, 0.65, 1.3, top, "concrete", c=0.06)
    mb.box(-0.9, -1.55, 0.0, 0.9, 1.55, 0.25, "concrete")
    # cradle cheeks
    for s in (-1, 1):
        mb.box(-0.65, s * PIPE_R * 0.78 - 0.32, top, 0.65, s * PIPE_R * 0.78 + 0.32, top + PIPE_R * 0.45, "concrete", c=0.04)
    # steel strap over the pipe
    strap_pts = []
    for i in range(11):
        a = math.pi * i / 10
        strap_pts.append((0.0, -(PIPE_R + 0.06) * math.cos(a), top + PIPE_R + (PIPE_R + 0.06) * math.sin(a) - 0.0))
    mb.tube(strap_pts, 0.05, "steel_dark", seg=5)
    return dict(pipeAxis=(0.0, 0.0, top + PIPE_R), topY=top)


def chamber_part(mb):
    """Open-front concrete valve chamber (8 x 6 x 6 m) with ladder and manhole collar."""
    w, d, h, t = 8.0, 6.0, 6.0, 0.4
    mb.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, t, "concrete")                     # floor
    mb.box(-w / 2, d / 2 - t, t, w / 2, d / 2, h, "concrete", c=0.04)            # back wall
    mb.box(-w / 2, -d / 2, t, -w / 2 + t, d / 2 - t, h, "concrete", c=0.04)      # side walls
    mb.box(w / 2 - t, -d / 2, t, w / 2, d / 2 - t, h, "concrete", c=0.04)
    mb.box(-w / 2, -d / 2 + 2.0, h, w / 2, d / 2, h + t, "concrete", c=0.04)     # roof (front cut away)
    mb.cylinder(1.8, 1.0, h + t, h + t + 0.5, 0.8, "concrete", seg=16)
    mb.cylinder(1.8, 1.0, h + t + 0.5, h + t + 0.58, 0.7, "steel_dark", seg=16)
    # ladder on the back wall
    for x in (1.45, 2.15):
        mb.box(x - 0.04, d / 2 - t - 0.25, t, x + 0.04, d / 2 - t - 0.17, h + t, "metal")
    for i in range(14):
        z = t + 0.4 + i * 0.42
        mb.box(1.45, d / 2 - t - 0.24, z, 2.15, d / 2 - t - 0.18, z + 0.04, "metal")
    # pipe sleeves through the side walls
    for x in (-w / 2, w / 2):
        with mb.xform(parts.frame_from_axis(Vector((x - (0.25 if x > 0 else -0.25), 0.0, 2.6)), (1, 0, 0))):
            mb.cylinder(0, 0, -0.3, 0.3, PIPE_R * 1.25, "concrete", seg=16)
    mb.box(-0.9, -0.9, t, 0.9, 0.9, 1.6, "concrete", c=0.04)   # valve plinth
    return dict(pipeAxis=(0.0, 0.0, 2.6), pipeAxisDirection="x")


def cable_duct_part(mb):
    """10 m concrete duct-bank section with six conduits and an open cable tray on top."""
    L, w, h = 10.0, 1.8, 1.3
    mb.box(-L / 2, -w / 2, 0.0, L / 2, w / 2, h, "concrete", c=0.04)
    for row in range(2):
        for col in range(3):
            y = -0.55 + col * 0.55
            z = 0.35 + row * 0.55
            for x in (-L / 2 - 0.02, L / 2 - 0.08):
                with mb.xform(parts.frame_from_axis(Vector((x, y, z)), (1, 0, 0))):
                    mb.cylinder(0, 0, 0, 0.1, 0.19, "steel_dark", seg=10)
                    mb.cylinder(0, 0, -0.01, 0.11, 0.1, "valve_red" if (row + col) % 3 == 0 else "trim", seg=8)
    # cable tray with three cables on brackets
    for x in (-4.0, -1.3, 1.3, 4.0):
        mb.box(x - 0.05, -0.5, h, x + 0.05, 0.5, h + 0.55, "steel_dark")
    mb.box(-L / 2, -0.55, h + 0.5, L / 2, 0.55, h + 0.56, "metal")
    for y in (-0.55, 0.55):
        mb.box(-L / 2, y - 0.03, h + 0.5, L / 2, y + 0.03, h + 0.7, "metal")
    for k, y in enumerate((-0.3, 0.0, 0.3)):
        mb.cyl_between((-L / 2, y, h + 0.66), (L / 2, y, h + 0.66), 0.09, "trim" if k != 1 else "steel_dark", seg=8)
    return dict(length=L)


def build_group():
    coll = bpy.data.collections.get("KIT_underground-kit") or bpy.data.collections.new("KIT_underground-kit")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    specs = [
        ("pump-unit", pump_unit_part, "Horizontal end-suction pump set (suction flange on the origin side, body along +X, discharge nozzle up). Origin on the floor below the suction flange."),
        ("gate-valve", gate_valve_part, "Inline flanged gate valve with handwheel; origin on the pipe axis, pipe along X, stem +Y."),
        ("check-valve", check_valve_part, "Inline swing check valve with red cover and counterweight; origin on the pipe axis, pipe along X."),
        ("pipe-saddle", saddle_part, "Concrete pipe saddle with steel strap; origin on the floor, pipe along X, pipe axis at anchors.pipeAxis."),
        ("chamber", chamber_part, "Open-front concrete valve chamber (8 x 6 x 6 m) with manhole collar, ladder and wall sleeves; front (+Z) cut away for the cutaway view."),
        ("cable-duct", cable_duct_part, "10 m concrete duct-bank section along X with six conduits and a cable tray on brackets."),
    ]
    items = []
    for kind, fn, notes in specs:
        mb = MeshBuilder()
        info = fn(mb)
        name = "%s_v0" % kind
        ob = build_object(mb, name, coll)
        lo, hi = mb.bounds()
        anchors = {}
        for k, v in info.items():
            if isinstance(v, tuple) and len(v) == 3:
                anchors[k] = to_three(v)
            else:
                anchors[k] = v
        anchors["pipeVisualRadius"] = PIPE_R
        rec = dict(id=name, kind=kind, variant=0, node=name,
                   nominalSize=[round(hi.x - lo.x, 2), round(hi.y - lo.y, 2), round(hi.z - lo.z, 2)],
                   anchors=anchors, notes=notes)
        items.append((ob, rec))
    return {"underground-kit": items}


PREVIEW_OPTS = {"underground-kit": {"azim": 30.0, "elev": 20.0, "gap": 3.0}}
