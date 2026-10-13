/**
 * Lower city ground (y ≈ −48) out to the curved horizon: street grid with streetlight glow,
 * dusty blocks, and reflective water (creek + bay) that mirrors the procedural dusk sky.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three';
import { bendShader } from './bend';
import { GROUND_Y, LOW_GRID, LOW_STREET, WATER_GLSL } from './layout';
import { NOISE_GLSL, SKY_GLSL } from '../env/skyShader';
import { fx } from '../runtime';

/** Polar disc with geometric ring spacing (dense near the platform, sparse far away). */
function discGeometry(r0: number, r1: number, rings: number, segs: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const nor: number[] = [];
  pos.push(0, 0, 0);
  nor.push(0, 1, 0);
  const radii: number[] = [];
  for (let i = 0; i <= rings; i++) radii.push(r0 * Math.pow(r1 / r0, i / rings));
  for (const r of radii) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      nor.push(0, 1, 0);
    }
  }
  // centre fan
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 0; i < rings; i++) {
    const a0 = 1 + i * segs;
    const b0 = 1 + (i + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function LowerGround() {
  const geo = useMemo(() => discGeometry(60, 7000, 90, 160), []);
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, envMapIntensity: 0.5 });
    const uniforms = { uTime: { value: 0 }, uFade: { value: 1 } };
    m.userData.uniforms = uniforms;
    m.customProgramCacheKey = () => 'encirra-lower-ground-v1';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      bendShader(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGW = (modelMatrix * vec4(position, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vGW;
uniform float uTime;
uniform float uFade;
${NOISE_GLSL}
${WATER_GLSL}
#ifndef ENC_SKY
${SKY_GLSL}
#endif
float encGridLine(float x, float period, float halfW, float aa) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(halfW - aa, halfW + aa, d);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
vec2 gp = vGW.xz;
vec2 gfw = fwidth(gp);
float gaa = max(max(gfw.x, gfw.y), 0.05);
float wsd = encWaterSd(gp);
float isW = 1.0 - smoothstep(-2.0, 2.0, wsd);
float gn = encNoise(gp * 0.013);
float gn2 = encNoise(gp * 0.11);
// streets every ${LOW_GRID} m (aligned with the district grid)
float sx = encGridLine(gp.x, ${LOW_GRID.toFixed(1)}, ${(LOW_STREET / 2).toFixed(1)}, gaa);
float sz = encGridLine(gp.y, ${LOW_GRID.toFixed(1)}, ${(LOW_STREET / 2).toFixed(1)}, gaa);
float street = max(sx, sz);
// sidewalks
float swx = encGridLine(gp.x, ${LOW_GRID.toFixed(1)}, ${(LOW_STREET / 2 + 3.5).toFixed(1)}, gaa);
float swz = encGridLine(gp.y, ${LOW_GRID.toFixed(1)}, ${(LOW_STREET / 2 + 3.5).toFixed(1)}, gaa);
float walk = max(swx, swz) * (1.0 - street);
vec3 block = mix(vec3(0.13, 0.115, 0.095), vec3(0.2, 0.17, 0.13), gn) * (0.85 + 0.25 * gn2);
// parks and planted courtyards
float park = smoothstep(0.58, 0.66, encNoise(gp * 0.0045 + 3.0));
block = mix(block, mix(vec3(0.03, 0.06, 0.02), vec3(0.06, 0.1, 0.03), gn2), park * 0.9);
vec3 asphalt = vec3(0.022, 0.023, 0.026) * (0.85 + 0.3 * gn2);
vec3 gcol = mix(block, vec3(0.24, 0.22, 0.19), walk);
gcol = mix(gcol, asphalt, street);
// quay edge along the water
float quay = (1.0 - smoothstep(0.0, 12.0, wsd)) * (1.0 - isW);
gcol = mix(gcol, vec3(0.34, 0.32, 0.28), quay * 0.85);
diffuseColor.rgb = mix(gcol, vec3(0.01, 0.025, 0.035), isW);
// street lighting: warm light pools along the carriageways + soft network glow at distance
float lfade = 1.0 - smoothstep(0.5, 1.6, gaa);
float poolsX = pow(0.5 + 0.5 * cos(gp.y * 6.2832 / 26.0), 6.0) * sx;
float poolsZ = pow(0.5 + 0.5 * cos(gp.x * 6.2832 / 26.0), 6.0) * sz;
float traffic = 0.35 + 0.65 * smoothstep(0.35, 0.8, encNoise(gp * 0.02 + vec2(uTime * 0.02, 0.0)));
vec3 gEm = vec3(1.0, 0.6, 0.28) * (max(poolsX, poolsZ) * 0.9 * lfade + street * mix(0.06, 0.16, 1.0 - lfade)) * traffic * (1.0 - isW);
gEm += vec3(1.0, 0.7, 0.4) * walk * 0.03 * (1.0 - isW);
float gRough = mix(mix(0.92, 0.75, street), 0.04, isW);
`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
if (isW > 0.5) {
  // gentle ripples
  vec2 q = gp * 0.06 + vec2(uTime * 0.05, uTime * 0.03);
  float e = 0.6;
  float h0 = encNoise(q);
  float hx = encNoise(q + vec2(0.05, 0.0));
  float hz = encNoise(q + vec2(0.0, 0.05));
  vec3 wn = normalize(vec3((h0 - hx) * e, 1.0, (h0 - hz) * e));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
        )
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = gRough;`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += gEm;
if (isW > 0.0) {
  // analytic sky reflection (cheap planar look)
  vec3 V = normalize(vGW - cameraPosition);
  vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 R = reflect(V, Nw);
  R.y = abs(R.y);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, Nw), 0.0), 5.0);
  vec3 refl = encSkyBase(normalize(R), 1.0);
  totalEmissiveRadiance += refl * fres * 0.85 * isW;
}`,
        )
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\ngl_FragColor.a *= uFade;`);
    };
    return m;
  }, []);

  useFrame((state) => {
    mat.userData.uniforms.uTime.value = state.clock.elapsedTime;
    const fade = fx.skyline;
    mat.userData.uniforms.uFade.value = 1;
    void fade;
  });

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  return <mesh geometry={geo} material={mat} position={[0, GROUND_Y, 0]} receiveShadow frustumCulled={false} />;
}
