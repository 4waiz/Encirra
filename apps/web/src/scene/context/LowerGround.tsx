/**
 * Lower city ground (y ≈ −48) out to the curved horizon: street grid with kerb lamps, warm
 * carriageway glow and moving vehicle light streaks; neutral blocks with parks; and blue-teal
 * water (bay, creek, marina) reflecting the dusk sky analytically and the skyline through the
 * mirrored reflection pass (WaterReflection).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, MeshLambertMaterial } from 'three';
import { bendShader } from './bend';
import { GROUND_Y, LOW_GRID, LOW_STREET, WATER_GLSL } from './layout';
import { reflectionUniforms } from './WaterReflection';
import { NOISE_GLSL, SKY_GLSL } from '../env/skyShader';

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

const G = LOW_GRID.toFixed(1);
const HS = (LOW_STREET / 2).toFixed(1);

export function LowerGround() {
  const geo = useMemo(() => discGeometry(60, 7000, 96, 180), []);
  const mat = useMemo(() => {
    // Lambert (no IBL / specular): the lower city covers many pixels; water reflections are explicit
    const m = new MeshLambertMaterial({ color: '#ffffff' });
    const uniforms = { uTime: { value: 0 }, uFade: { value: 1 }, ...reflectionUniforms };
    m.userData.uniforms = uniforms;
    m.customProgramCacheKey = () => 'encirra-lower-ground-v3';
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
uniform sampler2D uRefl;
uniform float uReflOn;
uniform vec2 uViewport;
${NOISE_GLSL}
${WATER_GLSL}
#ifndef ENC_SKY
${SKY_GLSL}
#endif
float encGridLine(float x, float period, float halfW, float aa) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(halfW - aa, halfW + aa, d);
}
float encLane(float off, float centre) { return 1.0 - smoothstep(0.3, 0.8, abs(off - centre)); }
float encHash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`,
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
float gn2 = 0.5 + 0.3 * sin(gp.x * 0.07 + sin(gp.y * 0.031) * 2.0) * sin(gp.y * 0.09 + sin(gp.x * 0.027) * 2.0);
// streets every ${LOW_GRID} m (aligned with the district grid)
float sx = encGridLine(gp.x, ${G}, ${HS}, gaa);
float sz = encGridLine(gp.y, ${G}, ${HS}, gaa);
float street = max(sx, sz);
float swx = encGridLine(gp.x, ${G}, ${(LOW_STREET / 2 + 3.5).toFixed(1)}, gaa);
float swz = encGridLine(gp.y, ${G}, ${(LOW_STREET / 2 + 3.5).toFixed(1)}, gaa);
float walk = max(swx, swz) * (1.0 - street);
vec3 block = mix(vec3(0.05, 0.05, 0.052), vec3(0.08, 0.077, 0.072), gn) * (0.85 + 0.25 * gn2);
// parks and planted courtyards
float park = smoothstep(0.56, 0.64, encNoise(gp * 0.0045 + 3.0));
block = mix(block, mix(vec3(0.028, 0.07, 0.025), vec3(0.05, 0.1, 0.035), gn2), park * 0.9);
vec3 asphalt = vec3(0.022, 0.023, 0.026) * (0.85 + 0.3 * gn2);
vec3 gcol = mix(block, vec3(0.11, 0.105, 0.1), walk);
gcol = mix(gcol, asphalt, street);
// stone quay along the water
float quay = (1.0 - smoothstep(0.0, 9.0, wsd)) * (1.0 - isW);
gcol = mix(gcol, vec3(0.34, 0.33, 0.31), quay * 0.9);
diffuseColor.rgb = mix(gcol, vec3(0.006, 0.02, 0.03), isW);
float lfade = 1.0 - smoothstep(0.5, 1.6, gaa);
// street lighting: soft carriageway glow, kerb lamp points
float dX = abs(fract(gp.x / ${G} + 0.5) - 0.5) * ${G};
float dZ = abs(fract(gp.y / ${G} + 0.5) - 0.5) * ${G};
float lampsX = pow(0.5 + 0.5 * cos(gp.y * 6.2832 / 28.0), 24.0) * (1.0 - smoothstep(0.6, 1.6, abs(dX - ${(LOW_STREET / 2 - 0.5).toFixed(1)})));
float lampsZ = pow(0.5 + 0.5 * cos(gp.x * 6.2832 / 28.0), 24.0) * (1.0 - smoothstep(0.6, 1.6, abs(dZ - ${(LOW_STREET / 2 - 0.5).toFixed(1)})));
vec3 gEm = vec3(1.0, 0.58, 0.26) * street * mix(0.045, 0.1, 1.0 - lfade) * (1.0 - isW);
gEm += vec3(1.0, 0.74, 0.45) * max(lampsX, lampsZ) * 2.0 * lfade * (1.0 - isW);
gEm += vec3(1.0, 0.72, 0.42) * walk * 0.025 * (1.0 - isW);
// vehicle light streaks: warm headlights on one lane, red tail lights on the other
float ox = gp.x - ${G} * floor(gp.x / ${G} + 0.5);
float oz = gp.y - ${G} * floor(gp.y / ${G} + 0.5);
float ix = floor(gp.x / ${G} + 0.5);
float iz = floor(gp.y / ${G} + 0.5);
float chx = encHash1(ix + 3.1);
float chz = encHash1(iz + 7.7);
float carNX = step(fract((gp.y + uTime * (11.0 + 5.0 * chx) + chx * 97.0) / (19.0 + 9.0 * chx)), 0.22);
float carSX = step(fract((gp.y - uTime * (10.0 + 4.0 * chx) + chx * 41.0) / (23.0 + 8.0 * chx)), 0.2);
float carEZ = step(fract((gp.x + uTime * (12.0 + 4.0 * chz) + chz * 63.0) / (21.0 + 7.0 * chz)), 0.22);
float carWZ = step(fract((gp.x - uTime * (10.0 + 5.0 * chz) + chz * 29.0) / (25.0 + 6.0 * chz)), 0.2);
float onX = step(dZ, ${G} * 0.5 - ${HS}) * sx;
float onZ = step(dX, ${G} * 0.5 - ${HS}) * sz;
float head = encLane(ox, -2.6) * carNX * onX + encLane(oz, 2.6) * carEZ * onZ;
float tail = encLane(ox, 2.6) * carSX * onX + encLane(oz, -2.6) * carWZ * onZ;
float nearF = 1.0 - smoothstep(0.25, 0.7, gaa);
gEm += (vec3(1.0, 0.88, 0.7) * 1.9 * head + vec3(1.0, 0.09, 0.04) * 1.5 * tail) * nearF * (1.0 - isW);
`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
vec3 encWN = vec3(0.0, 1.0, 0.0);
if (isW > 0.5) {
  // two octaves of gentle ripples
  vec2 q = gp * 0.05 + vec2(uTime * 0.04, uTime * 0.025);
  vec2 q2 = gp * 0.17 + vec2(-uTime * 0.07, uTime * 0.05);
  float h0 = encNoise(q) + 0.45 * encNoise(q2);
  float hx = encNoise(q + vec2(0.04, 0.0)) + 0.45 * encNoise(q2 + vec2(0.136, 0.0));
  float hz = encNoise(q + vec2(0.0, 0.04)) + 0.45 * encNoise(q2 + vec2(0.0, 0.136));
  encWN = normalize(vec3((h0 - hx) * 0.9, 1.0, (h0 - hz) * 0.9));
  normal = normalize((viewMatrix * vec4(encWN, 0.0)).xyz);
}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += gEm;
if (isW > 0.0) {
  vec3 V = normalize(vGW - cameraPosition);
  vec3 R = reflect(V, encWN);
  // bias the reflected ray upwards: the bay mirrors the blue-grey evening sky, not only the bright horizon band
  R.y = abs(R.y) * 0.75 + 0.16;
  R = normalize(R);
  float cosT = max(dot(-V, encWN), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 skyR = encSkyBase(R, 0.6);
  // reflected skyline: screen-space lookup of the mirrored skyline pass, distorted by the ripples
  vec2 suv = gl_FragCoord.xy / uViewport + encWN.xz * vec2(0.02, 0.05);
  vec4 rr = uReflOn > 0.5 ? texture2D(uRefl, suv) : vec4(0.0);
  float ra = clamp(rr.a, 0.0, 1.0);
  vec3 refl = mix(skyR * fres, rr.rgb * max(fres, 0.42), ra);
  // a little deep-water colour so it reads blue-teal even where the reflection is dark
  totalEmissiveRadiance += (refl + vec3(0.006, 0.026, 0.045)) * isW;
}`,
        )
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 0.4;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\ngl_FragColor.a *= uFade;`);
    };
    return m;
  }, []);

  useFrame((state) => {
    mat.userData.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  return <mesh geometry={geo} material={mat} position={[0, GROUND_Y, 0]} frustumCulled={false} />;
}
