#!/usr/bin/env node
/**
 * Encirra 3D asset pipeline.
 *
 * 1. (optional) runs the headless Blender build (assets/blender/build_kit.py), which exports raw
 *    GLBs into assets/models/, writes per-file manifest sidecars to assets/blender/manifest/ and
 *    renders previews to assets/blender/previews/;
 * 2. optimises every GLB in assets/models/ with gltf-transform (dedup, weld, prune, vertex-cache
 *    reorder, NORMAL/COLOR_0 quantisation, EXT_meshopt_compression);
 * 3. writes assets/models/manifest.json (the contract with the scene).
 *
 * Positions and UVs stay float32 on purpose: position quantisation would bake de-quantisation
 * transforms into the nodes, and the kit nodes must keep identity transforms so the scene can
 * clone/scale them freely; glazing UVs carry storey/bay indices well outside 0..1.
 *
 * Usage:
 *   npm run assets:build                                   # Blender build (all groups) + optimise
 *   npm run assets:build -- --no-blender                   # optimise + manifest only
 *   npm run assets:build -- --groups buildings,props       # rebuild some groups only
 *   flags: --no-ao --no-previews --force (re-optimise files that are already compressed)
 *   env:   BLENDER_EXE=<path to blender>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = join(ROOT, 'assets', 'models');
const SIDECARS = join(ROOT, 'assets', 'blender', 'manifest');
const MANIFEST_VERSION = '1.0.0';
const BUDGET_BYTES = 25 * 1024 * 1024;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

function defaultBlender() {
  if (process.env.BLENDER_EXE) return process.env.BLENDER_EXE;
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\Blender Foundation';
    if (existsSync(base)) {
      const versions = readdirSync(base)
        .filter((d) => /^Blender \d/.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of versions) {
        const exe = join(base, v, 'blender.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  if (process.platform === 'darwin') return '/Applications/Blender.app/Contents/MacOS/Blender';
  return 'blender';
}

function runBlender() {
  const exe = opt('--blender', defaultBlender());
  const pyArgs = ['--out', MODELS];
  const groups = opt('--groups', null);
  if (groups) pyArgs.push('--groups', groups);
  if (flag('--no-ao')) pyArgs.push('--no-ao');
  if (flag('--no-previews')) pyArgs.push('--no-previews');
  const cmd = [
    '--background',
    '--factory-startup',
    '--python',
    join(ROOT, 'assets', 'blender', 'build_kit.py'),
    '--',
    ...pyArgs,
  ];
  console.log(`[assets] blender ${cmd.join(' ')}`);
  const res = spawnSync(exe, cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  for (const line of out.split(/\r?\n/)) {
    if (/^(===|  exported|  AO baked|group |BUILD_KIT_DONE|Traceback|\s+File |\w*Error)/.test(line)) console.log(`  ${line}`);
  }
  if (res.status !== 0 || !out.includes('BUILD_KIT_DONE')) {
    console.error('[assets] Blender build failed');
    process.exit(1);
  }
}

async function optimise(file, io) {
  const doc = await io.read(file);
  const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  if (used.includes('EXT_meshopt_compression') && !flag('--force')) return { file, skipped: true };
  await doc.transform(
    dedup({ keepUniqueNames: true }),
    weld(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|COLOR_0)$/, quantizeNormal: 10, quantizeColor: 8 }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  return { file, skipped: false };
}

function readSidecars() {
  if (!existsSync(SIDECARS)) return { files: [], materials: {}, materialPBR: {} };
  const files = [];
  let materials = {};
  let materialPBR = {};
  for (const name of readdirSync(SIDECARS).sort()) {
    if (!name.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(SIDECARS, name), 'utf8'));
    if (name === '_materials.json') {
      materials = data.materials ?? {};
      materialPBR = data.materialPBR ?? {};
    } else files.push(data);
  }
  return { files, materials, materialPBR };
}

const CONVENTIONS = {
  coordinates:
    'Metres, +Y up, model fronts face +Z. Each asset node has its origin at the centre of its footprint on the ground (y = 0); every root node has an identity transform (except skyline.glb, whose nodes carry a suggested world placement).',
  nodeLookup:
    'Layout buildings map to node `${kind}_v${variant}`. Facilities that exist twice with different footprints (pump-station, water-tower) have one node per facility: resolve by assets[].facilityId first, then by kind + variant.',
  kitScaling:
    'Kit buildings (tower-residential, tower-office, midrise-residential, lowrise-residential, villa, commercial-podium) are modelled at nominalSize [w, d, h] and tolerate non-uniform scaling of about +/-30% to the layout footprint/height. Facility, prop and underground assets are modelled at real size and placed unscaled.',
  glazing:
    'Material "glazing" marks window surfaces for the scene\'s lit-window shader. UV0 on glazing encodes the window grid: v = storey coordinate (the lobby spans v 0..1, every storey above adds 1.0, aligned with the modelled slabs, so fract(v) is the position inside a storey even after non-uniform scaling); u = facade bay coordinate (1.0 per ~1.5-3 m bay, see assets[].notes). World-space window shaders also work.',
  vertexAO:
    'Building, facility and underground meshes carry baked ambient occlusion in COLOR_0 (linear, 0.38-1.0). three.js GLTFLoader enables vertexColors automatically, which multiplies baseColor. Keep vertexColors on any replacement material to keep the grounding.',
  compression:
    'EXT_meshopt_compression (decode with GLTFLoader.setMeshoptDecoder(MeshoptDecoder) from three/examples/jsm/libs/meshopt_decoder.module.js). Normals are int16 and COLOR_0 uint8 (KHR_mesh_quantization); positions and UVs are float32.',
  emissive:
    'Emissive materials ("emissive_sign", "light_emissive", "water") carry emissive colour/strength suitable for bloom; the scene may drive their intensity (e.g. night/outage states).',
  pipes:
    'Exposed mains are rendered by the scene from district.json routes. district-base gallery saddles and underground-kit flanges are sized for a visual pipe radius of 0.9 m (anchors.pipeVisualRadius).',
  provenance:
    'All assets are original procedural geometry and textures generated for Encirra by the scripts in assets/blender/. No third-party models, textures or HDRIs are used.',
};

async function main() {
  if (!flag('--no-blender')) runBlender();
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const glbs = readdirSync(MODELS).filter((f) => f.endsWith('.glb')).sort();
  for (const name of glbs) {
    const before = statSync(join(MODELS, name)).size;
    const res = await optimise(join(MODELS, name), io);
    const after = statSync(join(MODELS, name)).size;
    console.log(
      res.skipped
        ? `[assets] ${name.padEnd(28)} already optimised (${(after / 1024).toFixed(0)} KB)`
        : `[assets] ${name.padEnd(28)} ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
    );
  }

  const { files, materials, materialPBR } = readSidecars();
  const assets = [];
  const fileInfo = {};
  let total = 0;
  for (const f of files) {
    const p = join(MODELS, f.file);
    if (!existsSync(p)) continue;
    const bytes = statSync(p).size;
    total += bytes;
    fileInfo[f.file] = { bytes, group: f.group, nodes: f.assets.map((a) => a.node) };
    for (const a of f.assets) assets.push({ ...a, file: f.file });
  }
  const order = [
    'tower-residential', 'tower-office', 'midrise-residential', 'lowrise-residential', 'villa', 'commercial-podium',
    'hospital', 'substation', 'pump-station', 'water-tower', 'desalination-inlet', 'cooling-plant', 'emergency-ops',
    'mall', 'office-complex',
  ];
  const rank = (k) => (order.indexOf(k) >= 0 ? order.indexOf(k) : 100);
  assets.sort((a, b) => rank(a.kind) - rank(b.kind) || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));

  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    units: 'm',
    up: '+Y',
    front: '+Z',
    basePath: '/models/',
    conventions: CONVENTIONS,
    materials,
    materialPBR,
    files: fileInfo,
    totalBytes: total,
    assets,
  };
  writeFileSync(join(MODELS, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[assets] manifest.json: ${assets.length} assets in ${Object.keys(fileInfo).length} files, ${(total / 1048576).toFixed(2)} MB total`);
  if (total > BUDGET_BYTES) {
    console.error(`[assets] payload ${(total / 1048576).toFixed(2)} MB exceeds the 25 MB budget`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
