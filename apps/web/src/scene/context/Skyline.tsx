/**
 * Background context city (decorative, not part of the model; toggled by layers.skyline):
 * instanced lower city (typed facades: white render, beige stone, grey concrete, glass, villas)
 * and generic towers with a cheap metric window shader, plus the skyline.glb landmarks
 * (procedural landmark silhouettes as fallback). Everything follows the curved world (bend.ts).
 *
 * Reflections: the skyline is also instantiated a second time, mirrored about the local ground
 * level, on REFLECTION_LAYER only. WaterReflection renders that layer into a texture which the
 * water shader samples — the towers are genuinely reflected in the bay at negligible cost.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  type Material,
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { bendShader } from './bend';
import { CONTEXT_ROT, GROUND_Y, ensureLandCtx, lowerCity, skylineTowers, type LowSpec, type TowerSpec } from './layout';
import { useKitFile, useKitSignature, kitManifest } from '../assets/kit';
import { collectMeshes, mergeItems, type MergeItem } from '../assets/merge';
import { createKitMaterial, type KitUniforms } from '../assets/kitMaterials';
import { GeoBuilder, STYLE, lin } from '../lib/GeoBuilder';
import { createFacadeMaterial, createStateTexture } from '../buildings/facadeMaterial';
import { useSceneQuality } from '../runtime';

/** Layer used only by the water reflection pass. */
export const REFLECTION_LAYER = 1;

const WINDOW_GLSL = /* glsl */ `
float encH13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float encAAB(float x, float a, float b, float w){ return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;

/** Instanced building material: windows in metric object space from the instance scale. */
function createTowerMaterial(kind: 'tower' | 'low') {
  // low IBL on towers: at dusk their glass should read as dark blue-grey, not mirror the bright horizon
  const m = kind === 'low' ? new MeshLambertMaterial({ color: '#ffffff' }) : new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, envMapIntensity: 0.35 });
  m.customProgramCacheKey = () => `encirra-tower-${kind}-v3`;
  if (kind === 'low') m.defines = { ENC_LOW: '' };
  m.onBeforeCompile = (shader) => {
    bendShader(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aTower;
varying vec3 vLoc;
varying vec3 vLN;
varying vec4 vTw;
varying vec3 vScl;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 encScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vLoc = position * encScl;
vLN = normal;
vTw = aTower;
vScl = encScl;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${WINDOW_GLSL}
varying vec3 vLoc;
varying vec3 vLN;
varying vec4 vTw;
varying vec3 vScl;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float seed = vTw.x;
float tone = vTw.y;
float floorH = vTw.z;
float litF = vTw.w;
float vH = vScl.y;
bool roof = abs(vLN.y) > 0.5;
float u = abs(vLN.x) > 0.5 ? vLoc.z : vLoc.x;
float v = vLoc.y;
#ifdef ENC_LOW
  // lower city: 0 glass, 1 white render, 2 beige stone, 3 grey concrete, 4 villa
  float type = floor(tone + 0.5);
  bool glassy = type < 0.5;
  float bay = glassy ? 2.0 : type > 3.5 ? 4.5 : 3.4;
#else
  bool glassy = tone < 0.5;
  float bay = glassy ? 1.8 : 3.2;
#endif
vec2 c = vec2(u / bay, v / floorH);
vec2 cw = max(fwidth(c), vec2(1e-4));
vec2 cf = fract(c);
vec2 ci = floor(c);
vec4 r = glassy ? vec4(0.06, 0.94, 0.12, 0.9) : vec4(0.22, 0.78, 0.3, 0.8);
#ifdef ENC_LOW
  if (type > 3.5) r = vec4(0.15, 0.85, 0.15, 0.85);
#endif
float m = encAAB(cf.x, r.x, r.y, cw.x) * encAAB(cf.y, r.z, r.w, cw.y);
float cov = (r.y - r.x) * (r.w - r.z);
float farF = smoothstep(0.1, 0.3, max(cw.x, cw.y));
m = mix(m, cov, farF);
m *= step(min(4.0, floorH * 0.8), v) * (1.0 - step(vH - 1.2, v));
if (roof) m = 0.0;
float h1 = encH13(vec3(ci, seed + (abs(vLN.x) > 0.5 ? 3.0 : 0.0) + sign(vLN.x + vLN.z) * 7.0));
float lit = step(h1, litF);
if (glassy) lit = step(encH13(vec3(ci.y, seed, 1.0)) * 0.75 + h1 * 0.25, litF);
lit = mix(lit, litF, farF);
vec3 warm = mix(vec3(1.0, 0.56, 0.25), vec3(1.0, 0.8, 0.55), mix(encH13(vec3(ci, seed + 5.0)), 0.5, farF));
warm = mix(warm, vec3(0.82, 0.9, 1.0), step(0.8, encH13(vec3(ci, seed + 2.0))) * (1.0 - farF) * 0.7);
if (glassy) warm = mix(warm, vec3(0.85, 0.92, 1.0), 0.35);
float sv = fract(seed * 0.71);
vec3 wallA;
vec3 glassC = glassy ? vec3(0.02, 0.035, 0.05) : vec3(0.025, 0.027, 0.03);
vec3 roofC;
#ifdef ENC_LOW
  if (type < 0.5) wallA = mix(vec3(0.035, 0.05, 0.07), vec3(0.07, 0.1, 0.13), sv);
  else if (type < 1.5) wallA = mix(vec3(0.27, 0.27, 0.27), vec3(0.34, 0.34, 0.33), sv);
  else if (type < 2.5) wallA = mix(vec3(0.24, 0.2, 0.15), vec3(0.31, 0.26, 0.2), sv);
  else if (type < 3.5) wallA = mix(vec3(0.13, 0.135, 0.15), vec3(0.19, 0.195, 0.21), sv);
  else wallA = mix(vec3(0.33, 0.32, 0.3), vec3(0.4, 0.38, 0.35), sv);
  // roofs: light membrane, dark tar or concrete, with a lighter parapet edge
  float rs = fract(seed * 0.53);
  roofC = rs < 0.4 ? vec3(0.22, 0.22, 0.22) : rs < 0.75 ? vec3(0.07, 0.07, 0.08) : vec3(0.14, 0.135, 0.13);
  vec2 rl = abs(vLoc.xz);
  float edge = min(vScl.x * 0.5 - rl.x, vScl.z * 0.5 - rl.y);
  roofC = mix(roofC, vec3(0.26, 0.255, 0.245), 1.0 - smoothstep(0.4, 0.8, edge));
  // rooftop plant / AC units as darker blocks
  vec2 rb = floor(vLoc.xz / 4.0);
  roofC *= mix(1.0, 0.55, step(0.86, encH13(vec3(rb, seed + 31.0))) * step(1.5, edge));
#else
  wallA = glassy ? mix(vec3(0.03, 0.045, 0.065), vec3(0.07, 0.095, 0.12), fract(seed * 0.37)) : (tone < 0.75 ? mix(vec3(0.16, 0.17, 0.19), vec3(0.24, 0.245, 0.26), sv) : mix(vec3(0.2, 0.18, 0.16), vec3(0.28, 0.25, 0.21), sv));
  roofC = vec3(0.16, 0.16, 0.17);
#endif
diffuseColor.rgb = roof ? roofC : mix(wallA, glassC, m);
vec3 tEm = warm * (0.6 + 1.1 * mix(encH13(vec3(ci, seed + 9.0)), 0.5, farF)) * lit * m;
// crown light band on taller towers
float crown = smoothstep(vH - 6.0, vH - 4.0, v) * (1.0 - smoothstep(vH - 2.5, vH - 1.5, v)) * step(90.0, vH) * step(0.5, fract(seed * 1.3));
tEm += vec3(1.0, 0.85, 0.65) * crown * 2.5 * (roof ? 0.0 : 1.0);
float tRough = roof ? 0.9 : mix(glassy ? 0.45 : 0.75, 0.28, m);
float tMetal = roof ? 0.0 : mix(glassy ? 0.25 : 0.0, 0.3, m);`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = tRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = tMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEm;`)
      // dusk shade: the context city below / beyond the raised district gets less direct sun
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#ifdef ENC_LOW
reflectedLight.directDiffuse *= 0.42;
#else
reflectedLight.directDiffuse *= 0.5;
reflectedLight.directSpecular *= 0.5;
#endif`,
      );
  };
  return m;
}

type InstSpec = (TowerSpec | LowSpec) & { tone?: number; type?: number };

function buildInstances(specs: InstSpec[], geo: BoxGeometry | CylinderGeometry, mat: MeshStandardMaterial | MeshLambertMaterial, low: boolean) {
  const mesh = new InstancedMesh(geo, mat, specs.length);
  const attr = new Float32Array(specs.length * 4);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  specs.forEach((s, i) => {
    q.setFromAxisAngle(up, s.rot);
    m.compose(new Vector3(s.x, GROUND_Y, s.z), q, new Vector3(s.w, s.h, s.d));
    mesh.setMatrixAt(i, m);
    const tone = s.tone ?? 0.8;
    const type = s.type ?? 1;
    attr[i * 4] = s.seed;
    attr[i * 4 + 1] = low ? type : tone;
    attr[i * 4 + 2] = low ? (type === 4 ? 3.6 : 3.3) : tone < 0.55 ? 4.0 : 3.5;
    attr[i * 4 + 3] = low ? (type === 4 ? 0.62 : 0.5) : 0.36 + ((s.seed * 3.7) % 0.24);
  });
  mesh.geometry = geo.clone();
  mesh.geometry.setAttribute('aTower', new InstancedBufferAttribute(attr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A reflection-only copy (same geometry / material), for the mirrored skyline group. */
function reflectionCopy(src: Mesh | InstancedMesh): Object3D {
  let copy: Mesh;
  if ((src as InstancedMesh).isInstancedMesh) {
    const im = src as InstancedMesh;
    const c = new InstancedMesh(im.geometry, im.material, im.count);
    c.instanceMatrix = im.instanceMatrix;
    copy = c;
  } else {
    copy = new Mesh(src.geometry, src.material);
  }
  copy.matrixAutoUpdate = false;
  copy.matrix.copy(src.matrix);
  copy.frustumCulled = false;
  copy.layers.set(REFLECTION_LAYER);
  return copy;
}

/** Mirror about the plane y = GROUND_Y (the bend shader then lowers it onto the local water level). */
const MIRROR = new Matrix4().makeTranslation(0, 2 * GROUND_Y, 0).multiply(new Matrix4().makeScale(1, -1, 1));

/** Landmark silhouettes built with the facade generator (fallback when skyline.glb is missing). */
function landmarks() {
  const g = new GeoBuilder();
  const glass = lin('#55666F');
  const steel = lin('#B9C2C8');
  const white = lin('#E9E6E0');
  {
    const [x, z] = ensureLandCtx(-560, -1250);
    g.frame(x, GROUND_Y, z, 0.4);
    const tiers = [
      [44, 0, 90],
      [38, 90, 190],
      [32, 190, 290],
      [26, 290, 390],
      [20, 390, 480],
      [15, 480, 560],
      [10.5, 560, 620],
    ];
    for (const [r, y0, y1] of tiers) {
      g.prism(0, 0, r, y0, y1, 6, { color: glass, style: STYLE.curtain, floorH: 4.2, bayW: 1.8, bld: 0, phase: Math.PI / 6 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        g.prism(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, r * 0.45, y0, y1 - 12, 6, { color: glass, style: STYLE.curtain, floorH: 4.2, bayW: 1.8, bld: 0 });
      }
    }
    g.prism(0, 0, 6.5, 620, 700, 8, { color: steel, style: STYLE.plain, bld: 0, r1: 3.2 });
    g.prism(0, 0, 3.2, 700, 800, 8, { color: steel, style: STYLE.plain, bld: 0, r1: 0.6 });
  }
  {
    const [x, z] = ensureLandCtx(-930, -950);
    const n = 70;
    for (let i = 0; i < n; i++) g.frame(x, GROUND_Y, z, (i / n) * (Math.PI / 2)).box(0, 0, 34, 34, i * 4.4, i * 4.4 + 4.4, { color: white, style: STYLE.curtain, floorH: 4.4, bayW: 2.2, bld: 0, top: i === n - 1 });
  }
  {
    const [x, z] = ensureLandCtx(1010, -900);
    g.frame(x, GROUND_Y, z, -0.5);
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const depth = 52 * Math.sqrt(1 - t) * (0.35 + 0.65 * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t)) * 0.5 + 0.2));
      g.box(-depth / 2 + 10, 0, depth, 26, i * 7, i * 7 + 7, { color: white, style: STYLE.ribbon, floorH: 3.5, bayW: 3, bld: 0, top: i === n - 1 });
    }
    g.beam([18, 0, 0], [8, 300, 0], 3, { color: steel });
    g.prism(14, 0, 1.4, 280, 330, 6, { color: steel, style: STYLE.plain, bld: 0, r1: 0.4 });
  }
  for (const [x0, z0, h] of [
    [330, -1080, 355],
    [392, -1140, 309],
  ] as const) {
    const [x, z] = ensureLandCtx(x0, z0);
    g.frame(x, GROUND_Y, z, 0.3);
    g.prism(0, 0, 30, 0, h, 3, { color: glass, style: STYLE.curtain, floorH: 4.2, bayW: 1.8, bld: 0 });
    g.prism(0, 0, 6, h, h + 40, 6, { color: steel, style: STYLE.plain, bld: 0, r1: 1 });
  }
  return g.build();
}

/** Distance multiplier applied to the kit's suggested skyline placements. */
const SKYLINE_SPREAD = 1.25;

function withBend<T extends Material>(material: T, suffix: string) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev.call(material, shader, r);
    bendShader(shader);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => key() + suffix;
  return material;
}

/** skyline.glb landmarks (context frame) batched per material — plus their reflection copies. */
function useKitSkyline(enabled: boolean) {
  const gltf = useKitFile('skyline.glb');
  const state = useMemo(() => createStateTexture(1), []);
  const uniforms = useMemo<KitUniforms>(() => ({ uState: { value: state }, uTime: { value: 0 }, uFade: { value: 1 } }), [state]);
  const meshes = useMemo(() => {
    if (!gltf || !enabled) return [] as Mesh[];
    const m = kitManifest();
    const groups = new Map<string, { items: MergeItem[]; src: Material }>();
    gltf.scene.updateMatrixWorld(true);
    for (const root of gltf.scene.children) {
      // placement (context frame): pushed out and nudged onto land behind the bay
      const p = new Vector3().setFromMatrixPosition(root.matrixWorld);
      const [lx, lz] = ensureLandCtx(p.x * SKYLINE_SPREAD, p.z * SKYLINE_SPREAD, 50);
      const shift = new Matrix4().makeTranslation(lx - p.x, GROUND_Y, lz - p.z);
      for (const mm of collectMeshes(root, gltf.scene)) {
        if (!groups.has(mm.name)) groups.set(mm.name, { items: [], src: mm.material });
        groups.get(mm.name)!.items.push({ geometry: mm.geometry, matrix: new Matrix4().multiplyMatrices(shift, mm.matrix), bld: 0, tint: [1, 1, 1] });
      }
    }
    const out: Mesh[] = [];
    for (const [name, g] of groups) {
      const geometry = mergeItems(g.items);
      if (!geometry) continue;
      const material = withBend(createKitMaterial(name, g.src, m, uniforms, { darkenOutage: false, skyline: true }), '|bend');
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    return out;
  }, [gltf, uniforms, enabled]);
  useEffect(
    () => () => {
      meshes.forEach((b) => {
        b.geometry.dispose();
        (b.material as Material).dispose();
      });
    },
    [meshes],
  );
  useEffect(() => () => state.dispose(), [state]);
  useFrame((st) => {
    uniforms.uTime.value = st.clock.elapsedTime;
  });
  return meshes;
}

function useProceduralLandmarks(enabled: boolean) {
  const state = useMemo(() => createStateTexture(1), []);
  const mesh = useMemo(() => {
    if (!enabled) return null;
    const m = withBend(createFacadeMaterial(state), '|bend');
    m.customProgramCacheKey = () => 'encirra-facade-v3|bend';
    const mesh = new Mesh(landmarks(), m);
    mesh.frustumCulled = false;
    return mesh;
  }, [state, enabled]);
  useFrame((st) => {
    if (mesh) (mesh.material as Material).userData.uniforms.uTime.value = st.clock.elapsedTime;
  });
  useEffect(
    () => () => {
      if (mesh) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
      }
    },
    [mesh],
  );
  useEffect(() => () => state.dispose(), [state]);
  return mesh;
}

export function Skyline() {
  const tier = useSceneQuality((s) => s.tier);
  const towerMat = useMemo(() => createTowerMaterial('tower'), []);
  const lowMat = useMemo(() => createTowerMaterial('low'), []);
  const towers = useMemo(() => skylineTowers(), []);
  const low = useMemo(() => lowerCity(), []);
  const boxGeo = useMemo(() => {
    const b = new BoxGeometry(1, 1, 1);
    b.translate(0, 0.5, 0);
    return b;
  }, []);
  const cylGeo = useMemo(() => {
    const c = new CylinderGeometry(0.5, 0.5, 1, 18, 1);
    c.translate(0, 0.5, 0);
    return c;
  }, []);
  const towerMeshes = useMemo(() => {
    const boxes = towers.filter((t) => t.kind === 0);
    const cyls = towers.filter((t) => t.kind === 1);
    return [buildInstances(boxes, boxGeo, towerMat, false), buildInstances(cyls, cylGeo, towerMat, false)];
  }, [towers, boxGeo, cylGeo, towerMat]);
  const lowMesh = useMemo(() => {
    const lowSel = tier === 'low' ? low.filter((_, i) => i % 3 === 0) : low;
    return buildInstances(lowSel, boxGeo, lowMat, true);
  }, [low, boxGeo, lowMat, tier]);
  const kitSky = useKitSignature(['skyline.glb']) === 'ready:skyline.glb';
  const kitMeshes = useKitSkyline(kitSky);
  const landmarkMesh = useProceduralLandmarks(!kitSky);

  // skyline group (context frame) + its mirrored reflection copy
  const { skylineGroup, mirrorGroup } = useMemo(() => {
    const skylineGroup = new Group();
    skylineGroup.rotation.y = CONTEXT_ROT;
    const parts: (Mesh | InstancedMesh)[] = [...towerMeshes, ...kitMeshes, ...(landmarkMesh ? [landmarkMesh] : [])];
    for (const p of parts) skylineGroup.add(p);
    const mirrorGroup = new Group();
    mirrorGroup.matrixAutoUpdate = false;
    mirrorGroup.matrix.copy(MIRROR);
    const rot = new Group();
    rot.rotation.y = CONTEXT_ROT;
    mirrorGroup.add(rot);
    for (const p of parts) {
      p.updateMatrix();
      rot.add(reflectionCopy(p));
    }
    return { skylineGroup, mirrorGroup };
  }, [towerMeshes, kitMeshes, landmarkMesh]);

  useEffect(() => () => towerMeshes.forEach((m) => m.geometry.dispose()), [towerMeshes]);
  useEffect(() => () => lowMesh.geometry.dispose(), [lowMesh]);
  useEffect(
    () => () => {
      [towerMat, lowMat].forEach((m) => m.dispose());
      [boxGeo, cylGeo].forEach((g) => g.dispose());
    },
    [towerMat, lowMat, boxGeo, cylGeo],
  );

  return (
    <group>
      <primitive object={lowMesh} />
      <primitive object={skylineGroup} />
      <primitive object={mirrorGroup} />
    </group>
  );
}
