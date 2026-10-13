/**
 * Background context city (decorative, not part of the model; toggled by layers.skyline):
 * instanced generic towers + lower city blocks with a cheap metric window shader, and a few
 * procedural landmark silhouettes (supertall spire, twisted tower, sail hotel, twin towers).
 * Everything follows the curved world (see bend.ts).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { bendShader } from './bend';
import { GROUND_Y, lowerCity, skylineTowers } from './layout';
import { GeoBuilder, STYLE, lin } from '../lib/GeoBuilder';
import { createFacadeMaterial, createStateTexture } from '../buildings/facadeMaterial';
import { useSceneQuality } from '../runtime';

const WINDOW_GLSL = /* glsl */ `
float encH13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float encAAB(float x, float a, float b, float w){ return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;

/** Instanced tower material: windows computed in metric object space from the instance scale. */
function createTowerMaterial(kind: 'tower' | 'low') {
  const m = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, envMapIntensity: 1.0 });
  m.customProgramCacheKey = () => `encirra-tower-${kind}-v1`;
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
varying float vH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 encScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vLoc = position * encScl;
vLN = normal;
vTw = aTower;
vH = encScl.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${WINDOW_GLSL}
varying vec3 vLoc;
varying vec3 vLN;
varying vec4 vTw;
varying float vH;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float seed = vTw.x;
float tone = vTw.y;
float floorH = vTw.z;
float litF = vTw.w;
bool roof = abs(vLN.y) > 0.5;
float u = abs(vLN.x) > 0.5 ? vLoc.z : vLoc.x;
float v = vLoc.y;
bool glassy = tone < 0.5;
float bay = glassy ? 1.8 : 3.2;
vec2 c = vec2(u / bay, v / floorH);
vec2 cw = max(fwidth(c), vec2(1e-4));
vec2 cf = fract(c);
vec2 ci = floor(c);
vec4 r = glassy ? vec4(0.06, 0.94, 0.12, 0.9) : vec4(0.22, 0.78, 0.3, 0.8);
float m = encAAB(cf.x, r.x, r.y, cw.x) * encAAB(cf.y, r.z, r.w, cw.y);
float cov = (r.y - r.x) * (r.w - r.z);
float farF = smoothstep(0.1, 0.3, max(cw.x, cw.y));
m = mix(m, cov, farF);
m *= step(4.0, v) * (1.0 - step(vH - 3.0, v));
if (roof) m = 0.0;
float h1 = encH13(vec3(ci, seed + (abs(vLN.x) > 0.5 ? 3.0 : 0.0) + sign(vLN.x + vLN.z) * 7.0));
float lit = step(h1, litF);
if (glassy) lit = step(encH13(vec3(ci.y, seed, 1.0)) * 0.75 + h1 * 0.25, litF);
lit = mix(lit, litF, farF);
vec3 warm = mix(vec3(1.0, 0.56, 0.25), vec3(1.0, 0.8, 0.55), encH13(vec3(ci, seed + 5.0)));
if (glassy) warm = mix(warm, vec3(0.85, 0.92, 1.0), 0.35);
vec3 wallA = glassy ? mix(vec3(0.05, 0.07, 0.085), vec3(0.14, 0.16, 0.17), fract(seed * 0.37)) : (tone < 0.75 ? mix(vec3(0.42, 0.4, 0.37), vec3(0.6, 0.58, 0.55), fract(seed * 0.71)) : mix(vec3(0.36, 0.28, 0.2), vec3(0.52, 0.42, 0.31), fract(seed * 0.71)));
vec3 glassC = glassy ? vec3(0.02, 0.035, 0.05) : vec3(0.025, 0.027, 0.03);
diffuseColor.rgb = roof ? vec3(0.35, 0.34, 0.33) : mix(wallA, glassC, m);
vec3 tEm = warm * (0.6 + 1.1 * encH13(vec3(ci, seed + 9.0))) * lit * m;
// crown light band on taller towers
float crown = smoothstep(vH - 6.0, vH - 4.0, v) * (1.0 - smoothstep(vH - 2.5, vH - 1.5, v)) * step(90.0, vH) * step(0.5, fract(seed * 1.3));
tEm += vec3(1.0, 0.85, 0.65) * crown * 2.5 * (roof ? 0.0 : 1.0);
float tRough = roof ? 0.9 : mix(glassy ? 0.3 : 0.75, 0.07, m);
float tMetal = roof ? 0.0 : mix(glassy ? 0.6 : 0.0, 0.9, m);`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = tRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = tMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEm;`);
  };
  return m;
}

function buildInstances(specs: { x: number; z: number; w: number; d: number; h: number; rot: number; seed: number; tone?: number; kind?: number }[], geo: BoxGeometry | CylinderGeometry, mat: MeshStandardMaterial, low: boolean) {
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
    attr[i * 4] = s.seed;
    attr[i * 4 + 1] = low ? 0.5 + ((s.seed * 7.13) % 1) * 0.5 : tone;
    attr[i * 4 + 2] = low ? 3.4 : tone < 0.55 ? 4.0 : 3.5;
    attr[i * 4 + 3] = low ? 0.3 : 0.22 + ((s.seed * 3.7) % 0.25);
  });
  mesh.geometry = geo.clone();
  mesh.geometry.setAttribute('aTower', new InstancedBufferAttribute(attr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Landmark silhouettes built with the facade generator (lit windows, curved world). */
function landmarks() {
  const g = new GeoBuilder();
  const glass = lin('#55666F');
  const steel = lin('#B9C2C8');
  const white = lin('#E9E6E0');
  // supertall spire, behind-left of the district
  {
    g.frame(-560, GROUND_Y, -1250, 0.4);
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
      // three buttress wings
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        g.prism(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, r * 0.45, y0, y1 - 12, 6, { color: glass, style: STYLE.curtain, floorH: 4.2, bayW: 1.8, bld: 0 });
      }
    }
    g.prism(0, 0, 6.5, 620, 700, 8, { color: steel, style: STYLE.plain, bld: 0, r1: 3.2 });
    g.prism(0, 0, 3.2, 700, 800, 8, { color: steel, style: STYLE.plain, bld: 0, r1: 0.6 });
  }
  // twisted tower in the west marina
  {
    g.frame(-930, GROUND_Y, -300, 0);
    const n = 70;
    for (let i = 0; i < n; i++) g.frame(-930, GROUND_Y, -300, (i / n) * (Math.PI / 2)).box(0, 0, 34, 34, i * 4.4, i * 4.4 + 4.4, { color: white, style: STYLE.curtain, floorH: 4.4, bayW: 2.2, bld: 0, top: i === n - 1 });
  }
  // sail hotel on the bay
  {
    g.frame(1010, GROUND_Y, -160, -0.5);
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const depth = 52 * Math.sqrt(1 - t) * (0.35 + 0.65 * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t)) * 0.5 + 0.2));
      g.box(-depth / 2 + 10, 0, depth, 26, i * 7, i * 7 + 7, { color: white, style: STYLE.ribbon, floorH: 3.5, bayW: 3, bld: 0, top: i === n - 1 });
    }
    g.beam([18, 0, 0], [8, 300, 0], 3, { color: steel });
    g.prism(14, 0, 1.4, 280, 330, 6, { color: steel, style: STYLE.plain, bld: 0, r1: 0.4 });
  }
  // twin towers downtown
  for (const [x, z, h] of [
    [330, -1080, 355],
    [392, -1140, 309],
  ] as const) {
    g.frame(x, GROUND_Y, z, 0.3);
    g.prism(0, 0, 30, 0, h, 3, { color: glass, style: STYLE.curtain, floorH: 4.2, bayW: 1.8, bld: 0 });
    g.prism(0, 0, 6, h, h + 40, 6, { color: steel, style: STYLE.plain, bld: 0, r1: 1 });
  }
  return g.build();
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
  const meshes = useMemo(() => {
    const boxes = towers.filter((t) => t.kind === 0);
    const cyls = towers.filter((t) => t.kind === 1);
    const lowSel = tier === 'low' ? low.filter((_, i) => i % 2 === 0) : low;
    return [
      buildInstances(boxes, boxGeo, towerMat, false),
      buildInstances(cyls, cylGeo, towerMat, false),
      buildInstances(lowSel, boxGeo, lowMat, true),
    ];
  }, [towers, low, boxGeo, cylGeo, towerMat, lowMat, tier]);

  const landmarkGeo = useMemo(() => landmarks(), []);
  const landmarkState = useMemo(() => createStateTexture(1), []);
  const landmarkMat = useMemo(() => {
    const m = createFacadeMaterial(landmarkState);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev.call(m, shader, r);
      bendShader(shader);
    };
    m.customProgramCacheKey = () => 'encirra-facade-v3|bend';
    return m;
  }, [landmarkState]);

  useFrame((state) => {
    landmarkMat.userData.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(
    () => () => {
      for (const m of meshes) m.geometry.dispose();
    },
    [meshes],
  );
  useEffect(
    () => () => {
      [towerMat, lowMat, landmarkMat].forEach((m) => m.dispose());
      [boxGeo, cylGeo, landmarkGeo].forEach((g) => g.dispose());
      landmarkState.dispose();
    },
    [towerMat, lowMat, landmarkMat, boxGeo, cylGeo, landmarkGeo, landmarkState],
  );

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <mesh geometry={landmarkGeo} material={landmarkMat} frustumCulled={false} />
    </group>
  );
}
