# Encirra 3D asset kit

All 3D assets of the Encirra digital twin are **original, procedurally generated geometry and textures**
built for this project by the Python scripts in `assets/blender/`. Blender runs headless, and gltf-transform
optimises the exports. No third-party models, textures or HDRIs are used.

The scene loads the optimised GLBs from `assets/models/` (served at `/models/<file>`). The contract between the
asset kit and the scene is **`assets/models/manifest.json`**. It lists every node with its nominal size, triangle
count, materials, anchors and notes. Treat the manifest as the source of truth; this page explains it.

## Conventions

| Topic | Convention |
| --- | --- |
| Units / axes | Metres, **+Y up**, model fronts face **+Z**. In Blender the scripts work Z-up with fronts facing -Y; the glTF exporter converts. |
| Origin | Centre of the footprint on the ground (y = 0). Every root node has an identity transform, except `skyline.glb` (see below). |
| Node names | Layout buildings map to `${kind}_v${variant}` (e.g. `midrise-residential_v2`). Props and underground parts use the same pattern (`palm_v1`, `gate-valve_v0`). |
| Facility lookup | `pump-station` and `water-tower` exist twice with different footprints, and the layout gives both variant 0. Resolve by `assets[].facilityId` first (`ps-1` → `pump-station_v0`, `ps-2` → `pump-station_v1`, `tank-t1` → `water-tower_v0`, `tank-t2` → `water-tower_v1`), then by kind + variant. |
| Kit scaling | Kit buildings are modelled at `nominalSize [w, d, h]` and tolerate about ±30% non-uniform scaling to the layout footprint and height. Facilities, props and underground parts are real-size and placed unscaled. |
| Glazing UVs | Material `glazing` marks window surfaces for the scene's lit-window shader. UV0 on glazing encodes the window grid: **v = storey coordinate** (the lobby spans 0..1, each storey above adds 1.0, aligned with the modelled slabs), **u = facade bay** (1.0 per ~1.5–3 m bay). `fract(v)` stays slab-aligned under non-uniform scaling. A world-space shader also works. |
| COLOR_0 | Baked ambient occlusion (linear, about 0.38–1.0) on buildings, facilities and underground parts. The district base carries hand-placed occlusion in its galleries. On kit buildings, facade faces are also multiplied by a per-variant stone tint (`stoneTint`: white / cream / beige / sand). three.js enables `vertexColors` automatically; keep it on replacement materials. |
| Compression | `EXT_meshopt_compression`: call `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`. Normals are int16, COLOR_0 is uint8, and positions and UVs stay float32, so node transforms remain identity and are safe to clone and scale. |
| Pipes | The scene renders the mains from `district.json` routes. Gallery saddles and underground-kit flanges are sized for a **visual pipe radius of 0.9 m**. |

## Files

| File | Nodes | Notes |
| --- | --- | --- |
| `tower-residential.glb` | `_v0` terrace tower, `_v1` egg-crate fins + crown frame, `_v2` mashrabiya side screens, `_v3` rounded "marina" balconies | nominal 22 × 19 × ~51–54 m, 1.7–3.8k tris |
| `tower-office.glb` | `_v0` mullion curtain wall, `_v1` chamfered banded, `_v2` stone spines + sloped crown, `_v3` banded + frame crown | nominal 21 × 18 × ~56–61 m, ≤1.4k tris |
| `midrise-residential.glb` | `_v0` balcony block, `_v1` stepped terraces, `_v2` deep fins + screens, `_v3` rounded balconies | nominal 20 × 18.5 × 31 m, ≤2.3k tris |
| `lowrise-residential.glb` | `_v0`..`_v2` | nominal 18.5 × 18 × 14–16 m |
| `villa.glb` | `_v0` cantilevered cube villa with pool, `_v1` two volumes + wind tower (barjeel) | nominal 15 × 14.5 × 8–10 m |
| `commercial-podium.glb` | `_v0` fins, `_v1` mashrabiya, `_v2` louvres | nominal 21 × 18 × 16 m |
| `hospital.glb` | `hospital_v0` | 52 × 40 m: podium and ward tower, red cross and two `HOSPITAL` signs (`emissive_sign`), drop-off and emergency canopies, rooftop helipad with lights |
| `substation.glb` | `substation_v0` | 62 × 58 m: two transformers (radiator fins, conservators, bushings), firewalls, lattice gantries with insulator strings, breakers and disconnectors, control building, palisade fence, lightning masts |
| `pump-station.glb` | `pump-station_v0` (PS-1, 26 m) + child `pump_cutaway`; `pump-station_v1` (PS-2, 28 m) + child `pump_cutaway_v1` | Industrial hall, roof ventilators, valved manifold, surge vessel, kiosk. The below-grade pump set (y −27.6..−11.5) aligns with the suction (y −24) and transmission (y −15) mains at local z = +6 |
| `water-tower.glb` | `water-tower_v0` (T1) + child `water_level`; `water-tower_v1` (T2) + child `water_level_v1` | Tapered shaft, glazed vessel band, dome, beacon. See *Water level* |
| `desalination-inlet.glb` | `desalination-inlet_v0` + child `intake_cutaway` | Three ground storage tanks, header and valves, pump building. The intake riser drops into the base's R1 chamber and tees onto the suction main |
| `cooling-plant.glb` | `cooling-plant_v0` | Chiller hall, six cooling-tower cells with fan stacks, thermal storage tank |
| `emergency-ops.glb` | `emergency-ops_v0` | Stone civic block, glazed operations room, antenna mast, satellite dishes, generator |
| `mall.glb` | `mall_v0` | Mashrabiya-screened retail mass, glass atrium with cantilevered canopy, barrel skylight |
| `office-complex.glb` | `office-complex_v0` | Podium with two curtain-wall towers and a sky bridge (66 m) |
| `palm.glb` | `palm_v0..v2` | Curved ringed trunks, 14 drooping fronds, 1.27k tris each |
| `streetlight.glb` | `streetlight_v0` (single arm), `_v1` (double arm) | 168 / 262 tris. Arm points along local +Z (layout rotation 0 = towards the road) |
| `solar-array.glb` | `solar-array_v0` | ~10 × 6 m rooftop PV rack, modules face +Z |
| `street-furniture.glb` | `planter_v0`, `bench_v0` | |
| `underground-kit.glb` | `pump-unit_v0`, `gate-valve_v0`, `check-valve_v0`, `pipe-saddle_v0`, `chamber_v0`, `cable-duct_v0` | Valves have their origin on the pipe axis (pipe along X); floor parts have their origin on the floor |
| `district-base.glb` | `district-base` | Floating block 500 × 320 × 42 m. See *District base* |
| `skyline.glb` | `skyline_spire` (765 m stylised supertall), `skyline_twist`, `skyline_twist_b`, `skyline_sail`, `skyline_twin_a/b`, `skyline_stepped`, `skyline_glass_a/b/c`, `skyline_marina_a/b/c` | Generic stylised towers, ≤2.4k tris each. Node transforms carry a suggested placement (`assets[].placement`) with bases at y = 0. Offset the group to the background ground level if it is lower (the previews use y = −59) |

The optimised payload is about **5.1 MB** for 22 files and 59 assets, against a 25 MB budget.

### District base

* Top face at y = 0. Render roads and blocks at least 0.02 m above it, or use `polygonOffset`.
* A 1.2 m concrete foundation band frames the top edge. Below it, the strata faces are recessed 0.3 m. Strata: topsoil (to −4 m), compacted sand (to −13 m), limestone (to −30 m), bedrock (to −42 m). The colour and normal textures are generated procedurally (numpy) by `kit_base.py` into `assets/textures/soil_strata_*.jpg` and embedded in the GLB. Soil UVs: u = perimeter metres / 84 (seamless around the block), v = (y + 42) / 40.8.
* Utility galleries are cut where the mains run (three.js coordinates):
  * front upper gallery (transmission, pipe centre y −15, z 152): x −250..236, y −18.2..−10.4, z 147..160
  * front lower gallery (suction, pipe centre y −24, z 152): x −236..236, y −27.6..−19.2, z 147..160
  * west gallery (transmission, pipe centre y −15, x −242): x −250..−237, y −18.2..−10.4, z −130..160
  * chambers merge both front galleries at PS-2 (x −169..−151), R1 (x 47..65) and PS-1 (x 91..109)
* Concrete saddles every ~12 m, with tops at y −15.9 (transmission) and −24.9 (suction). Ceiling strip lights (`light_emissive`) and cable trays line the galleries. The exact boxes are in `assets[].galleries` and `assets[].chambers`.

### Water level

`water_level` (T1) and `water_level_v1` (T2) are cylinders of `water` material inside each vessel's `glass_clear` band. The node origin sits at `anchors.waterLevelMinY`, and at `scale.y = 1` the surface reaches `anchors.waterLevelMaxY`.
Set `scale.y = clamp(levelM / anchors.tankMaxLevelM, 0.001, 1)`. The values are 36–45 m with max level 9 m for T1, and 37–44 m with max level 7 m for T2.

## Material contract

Assets use only these material names. The scene may override them; each GLB carries sensible PBR defaults,
listed with their full values in `manifest.materialPBR`.

| Name | Use |
| --- | --- |
| `facade` | Primary warm-white stone/render |
| `facade_alt` | Secondary sand/beige stone |
| `glazing` | Window surfaces (dark blue-grey glass); replaced by the lit-window shader |
| `roof` | Roof decks |
| `trim` | Dark anodised aluminium: mullions, louvres, copings, rails |
| `accent` | Bronze/champagne fins and mashrabiya screens |
| `glass_clear` | Balustrades, canopies, tank level band (alpha blended, double sided) |
| `emissive_sign` | Hospital red cross and lettering |
| `solar` | PV modules |
| `metal` | Galvanised steel: fences, gantries, vents |
| `steel_dark` | Dark painted steel: machinery, masts, frames |
| `concrete` | Plinths, galleries, saddles, paving |
| `asphalt` | Roads, helipad deck |
| `foliage` | Palm fronds, shrubs (double sided) |
| `trunk` | Palm trunks |
| `water` | Tank water column (faintly emissive) |
| `soil` | Base strata (textured) |
| `rock` | Bedrock underside, gravel |
| `light_emissive` | Lamp heads, gallery lights, aviation and helipad lights |
| `pipe` | Pump, valve and pipework bodies (industrial blue) |
| `valve_red` | Handwheels, check-valve covers, warning panels |

## Budgets (triangles)

| Category | Budget | Actual |
| --- | --- | --- |
| Building variant | ≤ 6k | 0.4k–3.8k |
| Hospital / substation | ≤ 40k | 4.3k / 31.8k |
| Pump station (incl. cutaway) | ≤ 25k | 8.7k |
| Skyline tower | ≤ 3k | 0.3k–2.4k |
| Palm | ≤ 1.5k | 1.27k |
| Streetlight | ≤ 300 | 168 / 262 |

## Rebuilding

From the repository root:

```bash
# full pipeline: headless Blender build (all groups, AO bake, previews) + gltf-transform optimisation + manifest
npm run assets:build

# selected groups only (buildings, props, base, facilities, underground, skyline)
npm run assets:build -- --groups buildings,props

# re-optimise / rewrite the manifest without running Blender
npm run assets:build -- --no-blender

# flags: --no-ao (skip the bake), --no-previews, --force (re-optimise compressed files); env BLENDER_EXE=<path>
```

Running Blender directly:

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup \
  --python assets/blender/build_kit.py -- --out assets/models [--groups ...] [--no-ao] [--no-previews]

# assembled district (needs the kit_*.blend files written by build_kit.py)
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup \
  --python assets/blender/build_district_preview.py -- --res 1920x1080 --samples 48
```

Blender writes raw GLBs to `assets/models/`, and `scripts/build-assets.mjs` optimises them in place. Always
build headless. Do not export from an interactive Blender session.

### Sources

| Path | Content |
| --- | --- |
| `assets/blender/common.py` | Material contract, mesh builder (chamfered boxes, lathe, tubes...), AO bake, stone tints, export |
| `assets/blender/kit_buildings.py` | Building kit generators and variant table |
| `assets/blender/kit_facilities.py` | Hero facilities |
| `assets/blender/kit_props.py` | Palms, streetlights, solar array, planter, bench |
| `assets/blender/kit_underground.py` | Underground kit |
| `assets/blender/kit_base.py` | District base and procedural strata textures |
| `assets/blender/kit_skyline.py` | Background skyline |
| `assets/blender/parts.py` | Shared parts: insulators, lattices, valves, pumps, fences, lettering |
| `assets/blender/render_preview.py` | EEVEE dusk preview helpers (preview-only lit-window shading) |
| `assets/blender/build_kit.py` | Build entry point |
| `assets/blender/build_district_preview.py` | District assembly from `city-layout.json` |
| `assets/blender/manifest/*.json` | Per-file manifest sidecars, merged into `assets/models/manifest.json` |
| `assets/blender/kit_*.blend`, `district_assembled.blend` | Editable sources, regenerated by the scripts. The scripts remain the source of truth |
| `assets/blender/previews/*.jpg` | Dusk previews of every file, plus `district_dusk`, `district_cutaway`, `district_overview` and `district_street` |

## Provenance

Every mesh is generated from code in `assets/blender/`, and the strata textures are computed procedurally in
`kit_base.py`. The lettering uses Blender's built-in default font. The skyline towers are generic, stylised forms
and do not reproduce any specific real building.

---

Built by Team Kanban
