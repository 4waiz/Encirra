"""
Encirra asset kit - headless build entry point.

Usage (from the repo root):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --factory-startup \
      --python assets/blender/build_kit.py -- [--out assets/models] [--groups buildings,props,...]
      [--no-ao] [--no-previews] [--no-blend] [--preview-scale 1.0]

For every group the script builds the procedural meshes, optionally bakes ambient
occlusion into COLOR_0, exports one GLB per asset file (raw, unoptimised; run
scripts/build-assets.mjs afterwards), writes a manifest sidecar per file to
assets/blender/manifest/, saves an editable .blend source per group and renders an
EEVEE dusk preview per file into assets/blender/previews/.
"""

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import common  # noqa: E402
import render_preview as pv  # noqa: E402

GROUP_ORDER = ["buildings", "props", "base", "facilities", "underground", "skyline"]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(common.REPO, "assets", "models"))
    ap.add_argument("--groups", default=",".join(GROUP_ORDER))
    ap.add_argument("--no-ao", action="store_true")
    ap.add_argument("--no-previews", action="store_true")
    ap.add_argument("--no-blend", action="store_true")
    ap.add_argument("--preview-scale", type=float, default=1.0)
    return ap.parse_args(argv)


def group_builders():
    """name -> (callable returning {file_stem: [(root_obj, record), ...]}, bake_ao)"""
    import kit_buildings
    import kit_props
    reg = {}

    def buildings():
        colls = {}

        def coll_for(kind):
            if kind not in colls:
                colls[kind] = common.new_collection("KIT_" + kind)
            return colls[kind]
        return kit_buildings.build_all(coll_for)

    def props():
        colls = {}
        file_of = {"palm": "palm", "streetlight": "streetlight", "solar-array": "solar-array",
                   "planter": "street-furniture", "bench": "street-furniture"}

        def coll_for(kind):
            stem = file_of[kind]
            if stem not in colls:
                colls[stem] = common.new_collection("KIT_" + stem)
            return colls[stem]
        res = kit_props.build_all(coll_for)
        out = {}
        for kind, items in res.items():
            out.setdefault(file_of[kind], []).extend(items)
        return out

    reg["buildings"] = (buildings, True)
    reg["props"] = (props, False)
    try:
        import kit_base
        reg["base"] = (kit_base.build_group, False)
    except ImportError:
        pass
    try:
        import kit_facilities
        reg["facilities"] = (kit_facilities.build_group, True)
    except ImportError:
        pass
    try:
        import kit_underground
        reg["underground"] = (kit_underground.build_group, True)
    except ImportError:
        pass
    try:
        import kit_skyline
        reg["skyline"] = (kit_skyline.build_group, False)
    except ImportError:
        pass
    return reg


def finalize_record(rec, stem, ob):
    rec = dict(rec)
    rec["file"] = stem + ".glb"
    rec.setdefault("node", ob.name)
    rec["tris"] = sum(common.tri_count(o) for o in [ob] + list(ob.children_recursive) if o.type == "MESH")
    mats = []
    for o in [ob] + list(ob.children_recursive):
        if o.type == "MESH":
            for m in common.object_materials(o):
                if m not in mats:
                    mats.append(m)
    rec["materials"] = mats
    rec["vertexAO"] = any(o.type == "MESH" and o.data.color_attributes.get("AO") is not None
                          for o in [ob] + list(ob.children_recursive))
    return rec


def run_group(name, fn, bake_ao, args):
    t0 = time.time()
    print("\n=== group %s ===" % name)
    common.reset_scene()
    common.ensure_all_materials()
    files = fn()
    if bake_ao and not args.no_ao:
        objs = []
        for items in files.values():
            for ob, _ in items:
                objs.extend([ob] + [c for c in ob.children_recursive if c.type == "MESH"])
        t = time.time()
        common.bake_vertex_ao(objs)
        print("  AO baked for %d meshes in %.1fs" % (len(objs), time.time() - t))
    man_dir = os.path.join(HERE, "manifest")
    os.makedirs(man_dir, exist_ok=True)
    for stem, items in files.items():
        roots = [ob for ob, _ in items]
        path = os.path.join(args.out, stem + ".glb")
        common.export_glb(roots, path, image_format="JPEG" if name == "base" else "AUTO")
        recs = [finalize_record(rec, stem, ob) for ob, rec in items]
        with open(os.path.join(man_dir, stem + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"file": stem + ".glb", "group": name, "assets": recs}, fh, indent=2)
        print("  exported %s (%d nodes, %d tris)" % (stem, len(roots), sum(r["tris"] for r in recs)))
    if not args.no_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "kit_%s.blend" % name), compress=True)
    if not args.no_previews:
        prev_dir = os.path.join(HERE, "previews")
        os.makedirs(prev_dir, exist_ok=True)
        pv.apply_preview_materials()
        pv.ensure_preview_env()
        s = args.preview_scale
        res = (int(1600 * s), int(900 * s))
        for stem, items in files.items():
            roots = [ob for ob, _ in items]
            opts = getattr(sys.modules.get("kit_" + name), "PREVIEW_OPTS", {}).get(stem, {}) if ("kit_" + name) in sys.modules else {}
            if name == "buildings":
                opts = {}
            try:
                if "custom" in opts:
                    opts["custom"](roots, os.path.join(prev_dir, stem + ".png"), res)
                else:
                    pv.preview_lineup(roots, os.path.join(prev_dir, stem + ".png"), res=res,
                                      azim=opts.get("azim", 30.0), elev=opts.get("elev", 22.0),
                                      gap=opts.get("gap", 6.0), lens=opts.get("lens", 50.0), margin=opts.get("margin", 1.06))
            except Exception as e:
                print("  preview failed for", stem, e)
    print("=== group %s done in %.1fs" % (name, time.time() - t0))


def main():
    args = parse_args()
    reg = group_builders()
    wanted = [g.strip() for g in args.groups.split(",") if g.strip()]
    for g in GROUP_ORDER:
        if g in wanted:
            if g not in reg:
                print("group %s not available yet - skipped" % g)
                continue
            fn, ao = reg[g]
            run_group(g, fn, ao, args)
    print("BUILD_KIT_DONE")


if __name__ == "__main__":
    main()
