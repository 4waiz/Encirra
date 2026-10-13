"""
district-base.glb - the floating district block (platform x -250..250, z -160..160 in
three.js; top y = 0, bottom y = -42).

* side cut faces show soil strata (topsoil, compacted sand, limestone, bedrock) from a
  procedurally generated, seamlessly tiling texture (assets/textures/soil_strata_*.jpg)
* a 1.2 m concrete foundation band frames the top edge (strata faces are recessed 0.3 m)
* utility galleries are cut into the front (+Z) and west (-X) faces where the
  transmission (-15 m) and suction (-24 m) mains run, with concrete pipe saddles at
  the district.json pipe centrelines, ceiling lights and cable trays
* pump/intake chambers merge the two front galleries at PS-2, R1 and PS-1

All coordinates below are Blender (x, y, z) = three.js (x, -z, y).
"""

import json
import math
import os

import bpy
import numpy as np

from common import MeshBuilder, build_object, get_material, REPO, to_three

PLAT = dict(minX=-250.0, maxX=250.0, minZ=-160.0, maxZ=160.0, depth=42.0)
BAND = 1.2          # concrete foundation band height
RECESS = 0.3        # strata faces sit this far behind the band
FRAME = 0.6         # concrete lining visible around gallery openings
PIPE_R = 0.9        # design visual pipe radius the saddles are sized for
U_REPEAT = 84.0     # metres of perimeter per texture repeat
TEX_W, TEX_H = 2048, 1024

# galleries (Blender coords).  front face is y = -160 (three.js z = +160)
GA = dict(name="transmission-front", x0=-250.0, x1=236.0, y0=-160.0, y1=-147.0, z0=-18.2, z1=-10.4)
GB = dict(name="suction-front", x0=-236.0, x1=236.0, y0=-160.0, y1=-147.0, z0=-27.6, z1=-19.2)
GW = dict(name="transmission-west", x0=-250.0, x1=-237.0, y0=-160.0, y1=130.0, z0=-18.2, z1=-10.4)
CHAMBERS = [dict(name="PS-2", x0=-169.0, x1=-151.0), dict(name="R1", x0=47.0, x1=65.0), dict(name="PS-1", x0=91.0, x1=109.0)]
PIPE_Y_FRONT = -152.0   # three.js z = 152
PIPE_X_WEST = -242.0
Z_TRANS, Z_SUCT = -15.0, -24.0
STRATA = [("topsoil", -1.2, -4.0), ("compacted sand", -4.0, -13.0), ("limestone", -13.0, -30.0), ("bedrock", -30.0, -42.0)]


# ---------------------------------------------------------------------------
# procedural strata texture (numpy) - seamless along u
# ---------------------------------------------------------------------------

def _value_noise(w, h, cx, cy, rng):
    g = rng.random((cy + 2, cx))
    xs = np.arange(w) * (cx / w)
    ys = np.arange(h) * (cy / h)
    xi = np.floor(xs).astype(int)
    yi = np.floor(ys).astype(int)
    xf = xs - xi
    yf = ys - yi
    xf = xf * xf * (3 - 2 * xf)
    yf = yf * yf * (3 - 2 * yf)
    x0, x1 = xi % cx, (xi + 1) % cx
    a = g[np.ix_(yi, x0)]
    b = g[np.ix_(yi, x1)]
    c = g[np.ix_(yi + 1, x0)]
    d = g[np.ix_(yi + 1, x1)]
    top = a + (b - a) * xf[None, :]
    bot = c + (d - c) * xf[None, :]
    return top + (bot - top) * yf[:, None]


def _fbm(w, h, cell_m, octaves, rng, gain=0.5, aniso=1.0):
    """fBm with base cell size in metres (u spans U_REPEAT m, v spans 40.8 m)."""
    total = np.zeros((h, w))
    amp, norm = 1.0, 0.0
    cx = max(1, int(round(U_REPEAT / cell_m)))
    cy = max(1, int(round(40.8 / (cell_m * aniso))))
    for o in range(octaves):
        total += amp * _value_noise(w, h, cx * 2 ** o, cy * 2 ** o, rng)
        norm += amp
        amp *= gain
    return total / norm


def _smooth(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def _worley(w, h, cell_m, rng, yscale=1.0, warp_x=None, warp_y=None):
    """Periodic (in u) Worley noise with optional domain warp (metres).
    Returns F1, F2 (metres) and the nearest feature's random id."""
    cx = max(2, int(round(U_REPEAT / cell_m)))
    cy = max(2, int(round(40.8 / (cell_m * yscale))))
    fx = (np.arange(cx)[None, :] + rng.random((cy, cx))) / cx
    fy = (np.arange(cy)[:, None] + rng.random((cy, cx))) / cy
    fid = rng.random((cy, cx))
    px = np.repeat(((np.arange(w) + 0.5) / w)[None, :], h, axis=0)
    py = np.repeat(((np.arange(h) + 0.5) / h)[:, None], w, axis=1)
    if warp_x is not None:
        px = (px + warp_x / U_REPEAT) % 1.0
    if warp_y is not None:
        py = np.clip(py + warp_y / 40.8, 0.0, 0.999999)
    ci = np.floor(px * cx).astype(int)
    cj = np.floor(py * cy).astype(int)
    F1 = np.full((h, w), 1e9)
    F2 = np.full((h, w), 1e9)
    ID = np.zeros((h, w))
    for dj in (-1, 0, 1):
        nj = cj + dj
        valid = (nj >= 0) & (nj < cy)
        njc = np.clip(nj, 0, cy - 1)
        for di in (-1, 0, 1):
            ni_raw = ci + di
            ni = ni_raw % cx
            wrap = np.where(ni_raw < 0, -1.0, np.where(ni_raw >= cx, 1.0, 0.0))
            ptx = fx[njc, ni] + wrap
            pty = fy[njc, ni]
            dx = (px - ptx) * U_REPEAT
            dy = (py - pty) * 40.8 / yscale
            d = np.sqrt(dx * dx + dy * dy)
            d = np.where(valid, d, 1e9)
            ids = fid[njc, ni]
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, ids, ID)
            F1 = np.where(closer, d, F1)
    return F1, F2, ID


def _hash(a, b):
    v = np.sin(a * 127.1 + b * 311.7) * 43758.5453
    return v - np.floor(v)


def generate_strata_textures(out_dir, seed=4242):
    rng = np.random.default_rng(seed)
    W, H = TEX_W, TEX_H
    z = -42.0 + (np.arange(H) + 0.5) / H * 40.8          # rows bottom -> top
    Z = np.repeat(z[:, None], W, axis=1)
    X = np.repeat(((np.arange(W) + 0.5) / W * U_REPEAT)[None, :], H, axis=0)
    big = _fbm(W, H, 16.0, 4, rng)
    mid = _fbm(W, H, 3.0, 5, rng)
    fine = _fbm(W, H, 0.3, 3, rng)
    streak = _fbm(W, H, 0.35, 3, rng, aniso=8.0)          # vertical streaks (roots)
    hbed = _fbm(W, H, 5.0, 3, rng, aniso=0.15)            # horizontally stretched
    lens = _fbm(W, H, 4.0, 3, rng, aniso=0.3)
    wx = (_fbm(W, H, 2.5, 3, rng) - 0.5) * 1.6
    wy = (_fbm(W, H, 2.5, 3, rng) - 0.5) * 1.6

    # wavy layer boundaries
    wob = (big - 0.5) * 1.4 + (mid - 0.5) * 0.45
    b1 = -4.0 + wob * 0.6
    b2 = -13.0 + wob * 1.0
    b3 = -30.0 + wob * 1.2

    top_c = np.array((0.25, 0.165, 0.105))
    sand_c = np.array((0.70, 0.55, 0.37))
    lime_c = np.array((0.76, 0.68, 0.54))
    bed_c = np.array((0.37, 0.32, 0.28))

    w_top = _smooth(-0.2, 0.2, Z - b1)
    w_sand = _smooth(-0.25, 0.25, Z - b2) * (1 - w_top)
    w_lime = _smooth(-0.25, 0.25, Z - b3) * (1 - w_top - w_sand)
    w_bed = np.clip(1 - w_top - w_sand - w_lime, 0, 1)

    # topsoil: dark organic loam with fine vertical root streaks, darker at the very top
    roots = np.clip((streak - 0.62) * 5.0, 0, 1)
    top_mod = 0.88 + 0.28 * (mid - 0.5) + 0.3 * (fine - 0.5) - 0.3 * roots - 0.12 * _smooth(-2.0, -1.2, Z)
    top_h = 0.45 * fine + 0.35 * mid - 0.3 * roots

    # compacted sand: soft wavy bedding, darker lenses, scattered gravel
    bedding = 0.5 + 0.5 * np.sin(Z * (2 * math.pi / 0.8) + (hbed - 0.5) * 9.0)
    pF1, pF2, pID = _worley(W, H, 0.6, rng)
    peb = (1 - _smooth(0.06, 0.12, pF1)) * (pID > 0.6)
    sand_mod = (0.92 + 0.07 * (bedding - 0.5) + 0.16 * (mid - 0.5) + 0.12 * (fine - 0.5)
                - 0.12 * np.clip((lens - 0.6) * 4, 0, 1) + 0.5 * peb * (pID - 0.8))
    sand_h = 0.1 * bedding + 0.3 * fine + 0.7 * peb

    # limestone: beds of irregular thickness bounded by bedding planes, sparse partial joints
    Zw = Z + (hbed - 0.5) * 1.4 + (mid - 0.5) * 0.35
    brng = np.random.default_rng(seed + 7)
    bounds = [-44.0]
    while bounds[-1] < 2.0:
        bounds.append(bounds[-1] + brng.uniform(0.7, 3.6))
    bounds = np.array(bounds)
    bed_i = np.searchsorted(bounds, Zw) - 1
    lo_b = bounds[np.clip(bed_i, 0, len(bounds) - 1)]
    hi_b = bounds[np.clip(bed_i + 1, 0, len(bounds) - 1)]
    dplane = np.minimum(Zw - lo_b, hi_b - Zw)
    pw = 0.02 + 0.03 * fine
    planes = (1 - _smooth(0.0, 1.0, dplane / pw)) * (0.55 + 0.45 * _smooth(0.3, 0.6, lens))
    sp = 5.0 + 7.0 * _hash(bed_i * 1.0, 1.0)
    ph = _hash(bed_i * 1.0, 2.0) * sp
    xj = X + wx * 0.6 + (Zw - lo_b) * (_hash(bed_i * 1.0, 3.0) - 0.5) * 0.6
    jf = np.mod(xj + ph, sp)
    jidx = np.floor((xj + ph) / sp)
    jd = np.minimum(jf, sp - jf)
    keep = (_hash(bed_i * 1.0, jidx) > 0.45) * _smooth(0.35, 0.55, _fbm(W, H, 3.0, 2, rng))
    jw = 0.025 + 0.05 * fine
    joints = (1 - _smooth(0.0, 1.0, jd / jw)) * keep
    block = _hash(bed_i + 0.5, jidx + 0.5)
    vugs = (1 - _smooth(0.03, 0.08, _worley(W, H, 0.45, rng)[0])) * (fine > 0.6)
    lime_mod = (0.93 + 0.08 * (block - 0.5) + 0.06 * (_hash(bed_i * 1.0, 9.0) - 0.5) + 0.14 * (big - 0.5)
                + 0.1 * (mid - 0.5) + 0.07 * (fine - 0.5) - 0.35 * planes - 0.38 * joints - 0.15 * vugs)
    lime_h = 0.45 + 0.2 * _smooth(0.0, 0.3, dplane) + 0.12 * mid + 0.12 * fine - 0.45 * joints - 0.2 * vugs

    # bedrock: dark, massive, domain-warped fractures
    bF1, bF2, bID = _worley(W, H, 5.0, rng, yscale=0.7, warp_x=wx, warp_y=wy)
    frac = 1 - _smooth(0.03, 0.16, bF2 - bF1)
    frac *= _smooth(0.35, 0.55, _fbm(W, H, 6.0, 2, rng))  # fractures fade in and out
    bed_mod = (0.9 + 0.12 * (bID - 0.5) + 0.2 * (mid - 0.5) + 0.14 * (fine - 0.5) - 0.55 * frac)
    bed_h = 0.6 + 0.25 * _smooth(0.0, 1.5, bF2 - bF1) - 0.7 * frac + 0.2 * fine + 0.1 * mid

    col = (w_top[..., None] * top_c * top_mod[..., None]
           + w_sand[..., None] * sand_c * sand_mod[..., None]
           + w_lime[..., None] * lime_c * lime_mod[..., None]
           + w_bed[..., None] * bed_c * bed_mod[..., None])
    depth_dark = 0.84 + 0.16 * np.clip((Z + 42) / 18.0, 0, 1)
    col *= depth_dark[..., None]
    col = np.clip(col, 0, 1)
    height = (w_top * top_h + w_sand * sand_h + w_lime * lime_h + w_bed * bed_h)

    # normal map (OpenGL / glTF convention, +Y up)
    px = U_REPEAT / W
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (2 * px)
    gy = np.zeros_like(height)
    gy[1:-1] = (height[2:] - height[:-2]) / (2 * px)
    k = 0.05
    nx, ny, nz = -gx * k, -gy * k, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5

    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for name, arr, cs in (("soil_strata_basecolor", col, "sRGB"), ("soil_strata_normal", nrm, "Non-Color")):
        img = bpy.data.images.get(name)
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, W, H, alpha=False, float_buffer=False)
        img.colorspace_settings.name = cs   # must precede the pixel write (it regenerates the buffer)
        rgba = np.concatenate([arr, np.ones((H, W, 1))], axis=-1).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        path = os.path.join(out_dir, name + ".jpg")
        img.filepath_raw = path
        img.file_format = "JPEG"
        try:
            img.save(filepath=path, quality=92)
        except TypeError:
            img.save()
        img.source = "FILE"
        img.filepath = path
        img.reload()
        img.colorspace_settings.name = cs
        paths[name] = path
    return paths


def setup_soil_material(paths):
    mat = get_material("soil")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for n in [n for n in nt.nodes if n.type in ("TEX_IMAGE", "NORMAL_MAP")]:
        nt.nodes.remove(n)
    texc = nt.nodes.new("ShaderNodeTexImage")
    texc.image = bpy.data.images.load(paths["soil_strata_basecolor"], check_existing=True)
    texc.image.colorspace_settings.name = "sRGB"
    texn = nt.nodes.new("ShaderNodeTexImage")
    texn.image = bpy.data.images.load(paths["soil_strata_normal"], check_existing=True)
    texn.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 1.0
    nt.links.new(texc.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(texn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return mat


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------

def perim_s(face, a):
    """Perimeter coordinate (metres) for a point on a side face; continuous around."""
    W = PLAT["maxX"] - PLAT["minX"]
    D = PLAT["maxZ"] - PLAT["minZ"]
    if face == "front":      # y = -160, a = x
        return a - PLAT["minX"]
    if face == "east":       # x = +250, a = y
        return W + (a + D / 2)
    if face == "back":       # y = +160, a = x
        return W + D + (PLAT["maxX"] - a)
    return 2 * W + D + (D / 2 - a)   # west, a = y


def soil_uv(face, a, z):
    return (perim_s(face, a) / U_REPEAT, (z + 42.0) / 40.8)


def side_face(mb, face, a0, a1, openings):
    """Emit the strata face of one side with rectangular openings (+ concrete frames).
    a = coordinate along the face (x for front/back, y for east/west)."""
    zb, zt = -42.0, -BAND
    xa = sorted(set([a0, a1] + [v for o in openings for v in (o[0], o[1], o[0] - FRAME, o[1] + FRAME)]))
    zs = sorted(set([zb, zt] + [v for o in openings for v in (o[2], o[3], o[2] - FRAME, o[3] + FRAME)]))
    xa = [v for v in xa if a0 <= v <= a1]
    zs = [v for v in zs if zb <= v <= zt]

    def classify(am, zm):
        t = "soil"
        for o in openings:
            if o[0] <= am <= o[1] and o[2] <= zm <= o[3]:
                return "void"
            if o[0] - FRAME <= am <= o[1] + FRAME and o[2] - FRAME <= zm <= o[3] + FRAME:
                t = "frame"
        return t

    if face == "front":
        P = lambda a, z: (a, PLAT["minZ"] + RECESS, z)
        out = (0, -1, 0)
    elif face == "back":
        P = lambda a, z: (a, PLAT["maxZ"] - RECESS, z)
        out = (0, 1, 0)
    elif face == "east":
        P = lambda a, z: (PLAT["maxX"] - RECESS, a, z)
        out = (1, 0, 0)
    else:
        P = lambda a, z: (PLAT["minX"] + RECESS, a, z)
        out = (-1, 0, 0)
    for zi in range(len(zs) - 1):
        z0, z1 = zs[zi], zs[zi + 1]
        if z1 - z0 < 1e-6:
            continue
        run_start, run_type = None, None
        cells = []
        for xi in range(len(xa) - 1):
            x0, x1 = xa[xi], xa[xi + 1]
            if x1 - x0 < 1e-6:
                continue
            cells.append((x0, x1, classify((x0 + x1) / 2, (z0 + z1) / 2)))
        # merge runs
        merged = []
        for c in cells:
            if merged and merged[-1][2] == c[2] and abs(merged[-1][1] - c[0]) < 1e-6:
                merged[-1] = (merged[-1][0], c[1], c[2])
            else:
                merged.append(c)
        for (x0, x1, t) in merged:
            if t == "void":
                continue
            pts = [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)]
            inside = tuple(p - 1.0 * o for p, o in zip(P((x0 + x1) / 2, (z0 + z1) / 2), out))
            if t == "soil":
                uvs = [soil_uv(face, x0, z0), soil_uv(face, x1, z0), soil_uv(face, x1, z1), soil_uv(face, x0, z1)]
                mb.face(pts, "soil", inside=inside, uvs=uvs, col=1.0)
            else:
                mb.face(pts, "concrete", inside=inside, col=0.92)


def gallery_interior(mb, g, axis, open_ends=(), chambers=(), floor_holes=(), ceil_holes=()):
    """Inward-facing concrete faces of a gallery box open on the cut face.
    axis='x' : gallery runs along x, cut face at y = g.y0;  axis='y': runs along y, cut face at x = g.x0."""
    x0, x1, y0, y1, z0, z1 = g["x0"], g["x1"], g["y0"], g["y1"], g["z0"], g["z1"]
    if axis == "x":
        y0 = PLAT["minZ"] + RECESS
        x0 = max(x0, PLAT["minX"] + RECESS)
    else:
        x0 = PLAT["minX"] + RECESS
        y0 = max(y0, PLAT["minZ"] + RECESS)
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2

    def spans(lo, hi, holes):
        cuts = sorted(holes)
        out, cur = [], lo
        for (h0, h1) in cuts:
            if h0 > cur:
                out.append((cur, min(h0, hi)))
            cur = max(cur, h1)
        if cur < hi:
            out.append((cur, hi))
        return out

    # `inside` points sit in the solid material so normals face into the gallery void
    if axis == "x":
        for (a, b) in spans(x0, x1, floor_holes):
            mb.face([(a, y0, z0), (b, y0, z0), (b, y1, z0), (a, y1, z0)], "concrete", inside=(cx, cy, z0 - 50), col=0.62)
        for (a, b) in spans(x0, x1, ceil_holes):
            mb.face([(a, y0, z1), (b, y0, z1), (b, y1, z1), (a, y1, z1)], "concrete", inside=(cx, cy, z1 + 50), col=0.42)
        mb.face([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], "concrete", inside=(cx, y1 + 50, cz), col=0.5)
        if "x0" not in open_ends:
            mb.face([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], "concrete", inside=(x0 - 50, cy, cz), col=0.55)
        if "x1" not in open_ends:
            mb.face([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], "concrete", inside=(x1 + 50, cy, cz), col=0.55)
    else:
        mb.face([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], "concrete", inside=(cx, cy, z0 - 50), col=0.62)
        mb.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], "concrete", inside=(cx, cy, z1 + 50), col=0.42)
        mb.face([(x1, y0 + 13.0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0 + 13.0, z1)], "concrete", inside=(x1 + 50, cy, cz), col=0.5)
        mb.face([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], "concrete", inside=(cx, y1 + 50, cz), col=0.55)


def saddle(mb, along, pos, pipe_c, floor_z, pipe_z):
    """Concrete pipe saddle. along='x' (front galleries) or 'y' (west gallery)."""
    top = pipe_z - PIPE_R
    w_across, l_along = 2.6, 1.3
    if along == "x":
        x, y = pos, pipe_c
        mb.box(x - l_along / 2, y - w_across / 2, floor_z, x + l_along / 2, y + w_across / 2, top, "concrete", c=0.06)
        for s in (-1, 1):
            mb.box(x - l_along / 2, y + s * (PIPE_R * 0.75) - 0.3, top, x + l_along / 2, y + s * (PIPE_R * 0.75) + 0.3, top + PIPE_R * 0.42, "concrete", c=0.05)
        mb.box(x - l_along / 2 - 0.25, y - w_across / 2 - 0.25, floor_z, x + l_along / 2 + 0.25, y + w_across / 2 + 0.25, floor_z + 0.25, "concrete")
    else:
        x, y = pipe_c, pos
        mb.box(x - w_across / 2, y - l_along / 2, floor_z, x + w_across / 2, y + l_along / 2, top, "concrete", c=0.06)
        for s in (-1, 1):
            mb.box(x + s * (PIPE_R * 0.75) - 0.3, y - l_along / 2, top, x + s * (PIPE_R * 0.75) + 0.3, y + l_along / 2, top + PIPE_R * 0.42, "concrete", c=0.05)
        mb.box(x - w_across / 2 - 0.25, y - l_along / 2 - 0.25, floor_z, x + w_across / 2 + 0.25, y + l_along / 2 + 0.25, floor_z + 0.25, "concrete")


def stations(a, b, step=12.0, margin=4.0, avoid=()):
    out = []
    lo, hi = min(a, b), max(a, b)
    p = lo + margin
    while p <= hi - margin + 1e-6:
        if not any(c0 - 1.5 <= p <= c1 + 1.5 for (c0, c1) in avoid):
            out.append(p)
        p += step
    return out


def build_base():
    mb = MeshBuilder()
    x0, x1, y0, y1 = PLAT["minX"], PLAT["maxX"], PLAT["minZ"], PLAT["maxZ"]
    D = PLAT["depth"]
    # top slab
    mb.face([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], "concrete", inside=(0, 0, -1), col=1.0)
    # foundation band (outer faces + underside lip)
    ctr = (0, 0, -BAND / 2)
    for (pa, pb) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        mb.face([(pa[0], pa[1], -BAND), (pb[0], pb[1], -BAND), (pb[0], pb[1], 0), (pa[0], pa[1], 0)], "concrete", inside=ctr, col=0.95)
    r = RECESS
    lip = [((x0, y0), (x1, y0), (x1 - r, y0 + r), (x0 + r, y0 + r)),
           ((x1, y0), (x1, y1), (x1 - r, y1 - r), (x1 - r, y0 + r)),
           ((x1, y1), (x0, y1), (x0 + r, y1 - r), (x1 - r, y1 - r)),
           ((x0, y1), (x0, y0), (x0 + r, y0 + r), (x0 + r, y1 - r))]
    for q in lip:
        mb.face([(p[0], p[1], -BAND) for p in q], "concrete", inside=(0, 0, 0), col=0.7)
    # bottom
    mb.face([(x0 + r, y0 + r, -D), (x1 - r, y0 + r, -D), (x1 - r, y1 - r, -D), (x0 + r, y1 - r, -D)], "rock", inside=(0, 0, 0), col=0.8)

    # openings in cut-face coordinates: (a0, a1, z0, z1)
    front_open = [(GA["x0"], GA["x1"], GA["z0"], GA["z1"]), (GB["x0"], GB["x1"], GB["z0"], GB["z1"])]
    for c in CHAMBERS:
        front_open.append((c["x0"], c["x1"], GB["z0"], GA["z1"]))
    west_open = [(GW["y0"], GW["y1"], GW["z0"], GW["z1"])]
    side_face(mb, "front", x0 + r, x1 - r, [(max(o[0], x0 + r), o[1], o[2], o[3]) for o in front_open])
    side_face(mb, "east", y0 + r, y1 - r, [])
    side_face(mb, "back", x0 + r, x1 - r, [])
    side_face(mb, "west", y0 + r, y1 - r, [(max(o[0], y0 + r), o[1], o[2], o[3]) for o in west_open])

    # gallery interiors
    holes = [(c["x0"], c["x1"]) for c in CHAMBERS]
    ga = dict(GA, x0=GW["x1"])  # corner square belongs to the west gallery
    gallery_interior(mb, ga, "x", open_ends=("x0",), floor_holes=holes)
    gallery_interior(mb, GB, "x", ceil_holes=holes)
    gallery_interior(mb, GW, "y")
    # chamber side walls through the rib, and back-wall rib fill
    for c in CHAMBERS:
        for (xx, sgn) in ((c["x0"], 1), (c["x1"], -1)):
            mb.face([(xx, y0 + r, GB["z1"]), (xx, GA["y1"], GB["z1"]), (xx, GA["y1"], GA["z0"]), (xx, y0 + r, GA["z0"])],
                    "concrete", inside=(xx - sgn * 5, -153, (GB["z1"] + GA["z0"]) / 2), col=0.55)
        mb.face([(c["x0"], GA["y1"], GB["z1"]), (c["x1"], GA["y1"], GB["z1"]), (c["x1"], GA["y1"], GA["z0"]), (c["x0"], GA["y1"], GA["z0"])],
                "concrete", inside=((c["x0"] + c["x1"]) / 2, -140, -18.7), col=0.5)
        # sump plinth for the pump unit
        mb.box(c["x0"] + 1.0, -158.0, GB["z0"], c["x1"] - 1.0, -147.0, GB["z0"] + 0.35, "concrete", col=0.7)

    # pipe saddles
    mb.col = 0.78
    avoid = holes
    for xx in stations(-242.0, -160.0, avoid=avoid) + stations(100.0, 176.0, avoid=avoid):
        saddle(mb, "x", xx, PIPE_Y_FRONT, GA["z0"], Z_TRANS)
    for xx in stations(-160.0, 100.0, avoid=avoid):
        saddle(mb, "x", xx, PIPE_Y_FRONT, GB["z0"], Z_SUCT)
    for yy in stations(-152.0, 120.0):
        saddle(mb, "y", yy, PIPE_X_WEST, GW["z0"], Z_TRANS)
    mb.col = None

    # ceiling lights
    for g, along in ((dict(GA, x0=GW["x1"]), "x"), (GB, "x"), (GW, "y")):
        if along == "x":
            p = g["x0"] + 6.0
            while p < g["x1"] - 3.0:
                if not any(c["x0"] - 1 < p < c["x1"] + 1 for c in CHAMBERS):
                    mb.box(p - 1.5, -150.2, g["z1"] - 0.12, p + 1.5, -149.8, g["z1"], "light_emissive", skip=("top",))
                p += 12.0
        else:
            p = g["y0"] + 18.0
            while p < g["y1"] - 3.0:
                mb.box(-239.2, p - 1.5, g["z1"] - 0.12, -238.8, p + 1.5, g["z1"], "light_emissive", skip=("top",))
                p += 12.0

    # cable trays on the upper gallery back walls (power cables share the corridor)
    mb.col = 0.7
    yb = GA["y1"]
    for zt in (-12.4, -13.5):
        mb.box(GW["x1"] + 0.5, yb - 0.75, zt, GA["x1"] - 0.5, yb - 0.05, zt + 0.12, "metal")
        mb.box(GW["x1"] + 0.5, yb - 0.75, zt + 0.12, GA["x1"] - 0.5, yb - 0.68, zt + 0.3, "metal")
        mb.box(GW["x1"] + 0.5, yb - 0.6, zt + 0.12, GA["x1"] - 0.5, yb - 0.2, zt + 0.26, "steel_dark")
    p = GW["x1"] + 2.0
    while p < GA["x1"] - 1.0:
        mb.box(p - 0.06, yb - 0.8, -13.7, p + 0.06, yb, -12.0, "steel_dark")
        p += 6.0
    mb.col = None
    return mb


def build_group():
    tex_dir = os.path.join(REPO, "assets", "textures")
    paths = generate_strata_textures(tex_dir)
    setup_soil_material(paths)
    coll = bpy.data.collections.get("KIT_district-base") or bpy.data.collections.new("KIT_district-base")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    mb = build_base()
    ob = build_object(mb, "district-base", coll)

    def three_box(g):
        return dict(name=g["name"], min=to_three((g["x0"], g["y1"], g["z0"])), max=to_three((g["x1"], g["y0"], g["z1"])))

    rec = dict(
        id="district-base", kind="district-base", variant=0, node="district-base",
        nominalSize=[500.0, 320.0, 42.0],
        anchors={
            "surfaceY": 0.0, "bottomY": -42.0,
            "transmissionFront": [0.0, Z_TRANS, -PIPE_Y_FRONT],
            "suctionFront": [0.0, Z_SUCT, -PIPE_Y_FRONT],
            "transmissionWest": [PIPE_X_WEST, Z_TRANS, 0.0],
            "saddleTopTransmissionY": round(Z_TRANS - PIPE_R, 3),
            "saddleTopSuctionY": round(Z_SUCT - PIPE_R, 3),
            "pipeVisualRadius": PIPE_R,
        },
        galleries=[three_box(GA), three_box(GB), three_box(GW)],
        chambers=[dict(name=c["name"], minX=c["x0"], maxX=c["x1"], minY=GB["z0"], maxY=GA["z1"], minZ=147.0, maxZ=160.0) for c in CHAMBERS],
        strata=[dict(name=n, topY=a, bottomY=b) for (n, a, b) in STRATA],
        textures=["assets/textures/soil_strata_basecolor.jpg", "assets/textures/soil_strata_normal.jpg"],
        notes=("Top face at y=0 (render roads/blocks >= 0.02 m above it or with polygonOffset). Strata faces are "
               "recessed 0.3 m under a 1.2 m concrete band. Galleries: front upper (transmission, pipe centre "
               "y=-15, z=152), front lower (suction, y=-24, z=152), west (transmission, y=-15, x=-242). Saddles "
               "are sized for a visual pipe radius of 0.9 m. COLOR_0 carries hand-placed occlusion for gallery "
               "interiors. Soil UVs: u = perimeter metres / 84 (seamless), v = (y + 42) / 40.8."),
    )
    return {"district-base": [(ob, rec)]}


def _preview_custom(roots, path, res):
    import render_preview as pv
    pv.setup_render(res, 48)
    restore = pv.isolate_render(roots)
    g = bpy.context.scene.objects.get("_pv_ground")
    gz = g.location.z if g else 0.0
    if g:
        g.location.z = -160.0
    try:
        # oblique view of the front-west corner (galleries)
        lo = (-260.0, -175.0, -45.0)
        hi = (-60.0, -140.0, 2.0)
        from mathutils import Vector
        pv.frame_camera(Vector(lo), Vector(hi), azim_deg=-28.0, elev_deg=14.0, lens=50.0, margin=1.0)
        pv.render_to(path)
        p2 = path.replace(".png", "_overview.png")
        pv.frame_camera(Vector((-250, -160, -42)), Vector((250, 160, 0)), azim_deg=-20.0, elev_deg=26.0, lens=40.0, margin=1.02)
        pv.render_to(p2)
    finally:
        restore()
        if g:
            g.location.z = gz


PREVIEW_OPTS = {"district-base": {"custom": _preview_custom}}
