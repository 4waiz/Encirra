/**
 * Procedural district surface (top of the platform): asphalt avenues/streets with lane markings,
 * crosswalks, sidewalks with curbs, landscaped blocks (lawns, paving, planting), the substation
 * gravel yard and the state-driven ground tint (red over de-energized areas, green flash on
 * restoration) sampled from a bus-ownership map.
 */
import { district } from '@encirra/shared';
import { DataTexture, LinearFilter, MeshStandardMaterial, NearestFilter, RedFormat, RGBAFormat, UnsignedByteType } from 'three';
import { BUILDINGS, PLATFORM } from '../data/twin';
import { busTex } from '../data/stateTextures';
import { NOISE_GLSL } from '../env/skyShader';

const AV = district.streets.avenuesZ;
const ST = district.streets.streetsX;
const AVH = district.streets.avenueWidth / 2;
const STH = district.streets.streetWidth / 2;

const f = (v: number) => v.toFixed(2);

export const SURFACE_GLSL = /* glsl */ `
${NOISE_GLSL}
const float AV_HALF = ${f(AVH)};
const float ST_HALF = ${f(STH)};
const vec4 PLAT = vec4(${f(PLATFORM.minX)}, ${f(PLATFORM.maxX)}, ${f(PLATFORM.minZ)}, ${f(PLATFORM.maxZ)});
float encAvZ(int i) { ${AV.map((z, i) => `if (i == ${i}) return ${f(z)};`).join(' ')} return 0.0; }
float encStX(int i) { ${ST.map((x, i) => `if (i == ${i}) return ${f(x)};`).join(' ')} return 0.0; }
float encLineAA(float d, float halfW, float aa) { return 1.0 - smoothstep(halfW - aa, halfW + aa, d); }

// returns albedo (linear), roughness in .w
float encSurfKind = 0.0;
vec4 encSurface(vec2 p) {
  float kind = 0.0;
  float dAv = 1e9; float cAv = 0.0;
  for (int i = 0; i < ${AV.length}; i++) { float d = abs(p.y - encAvZ(i)); if (d < dAv) { dAv = d; cAv = encAvZ(i); } }
  float dSt = 1e9; float cSt = 0.0;
  for (int i = 0; i < ${ST.length}; i++) { float d = abs(p.x - encStX(i)); if (d < dSt) { dSt = d; cSt = encStX(i); } }
  vec2 fw = fwidth(p);
  float aa = max(max(fw.x, fw.y), 0.02);
  float fineFade = 1.0 - smoothstep(0.18, 0.45, aa);
  float n1 = encNoise(p * 0.21);
  float n2 = encNoise(p * 1.7);
  float n3 = encNoise(p * 0.043 + 7.0);
  bool inAv = dAv < AV_HALF;
  bool inSt = dSt < ST_HALF;
  vec3 col = vec3(0.0);
  float rough = 0.85;
  if (inAv || inSt) {
    kind = 1.0;
    vec3 asph = vec3(0.034, 0.036, 0.04) * (0.82 + 0.3 * n1 + 0.12 * n2);
    rough = 0.78 + 0.1 * n2;
    float mark = 0.0;
    float yellow = 0.0;
    if (inAv && inSt) {
      // intersection: faint box junction hatch
      mark = 0.0;
    } else if (inAv) {
      float a = p.y - cAv;
      float along = p.x;
      float med = encLineAA(abs(a), 0.7, aa);
      yellow = encLineAA(abs(abs(a) - 0.95), 0.09, aa) * fineFade;
      float lane = encLineAA(abs(abs(a) - 4.6), 0.1, aa) * step(0.45, fract(along / 9.0)) * fineFade;
      float edge = encLineAA(abs(abs(a) - 8.2), 0.12, aa) * fineFade;
      float beyond = dSt - ST_HALF;
      float cw = step(1.2, beyond) * step(beyond, 5.6) * step(abs(a), 8.4) * step(0.5, fract(a / 1.3)) ;
      float stop = encLineAA(abs(beyond - 6.6), 0.22, aa) * step(0.0, a * sign(along - cSt)) * step(abs(a), 8.3);
      mark = max(max(lane, edge), max(cw * mix(0.55, 1.0, fineFade), stop * fineFade));
      asph = mix(asph, vec3(0.16, 0.15, 0.13), med);
    } else {
      float a = p.x - cSt;
      float along = p.y;
      float centre = encLineAA(abs(a), 0.1, aa) * step(0.45, fract(along / 8.0)) * fineFade;
      float edge = encLineAA(abs(abs(a) - 6.3), 0.11, aa) * fineFade;
      float beyond = dAv - AV_HALF;
      float cw = step(1.2, beyond) * step(beyond, 5.6) * step(abs(a), 6.4) * step(0.5, fract(a / 1.3));
      mark = max(max(centre, edge), cw * mix(0.55, 1.0, fineFade));
    }
    col = mix(asph, vec3(0.62, 0.62, 0.6), mark * 0.85);
    col = mix(col, vec3(0.75, 0.48, 0.08), yellow * 0.9);
  } else {
    // distance to the nearest road edge and to the platform rim
    float dEdge = min(dAv - AV_HALF, dSt - ST_HALF);
    float dRim = min(min(p.x - PLAT.x, PLAT.y - p.x), min(p.y - PLAT.z, PLAT.w - p.y));
    dEdge = min(dEdge, dRim);
    if (abs(p.x) < 33.0 && abs(p.y) < 31.0) {
      // substation gravel yard
      kind = 3.0;
      float sp = encNoise(p * 6.0);
      col = vec3(0.2, 0.2, 0.2) * (0.8 + 0.35 * sp);
      float pad = step(abs(p.x), 30.0) * step(abs(p.y), 28.0);
      col = mix(col * 0.9, col, pad);
      rough = 0.95;
    } else if (dEdge < 4.0) {
      // sidewalk + kerb
      kind = 2.0;
      vec3 pave = vec3(0.34, 0.31, 0.27) * (0.9 + 0.15 * n2);
      vec2 tl = fract(p / 1.2);
      float joint = (1.0 - encLineAA(abs(tl.x - 0.5), 0.47, aa / 1.2) * encLineAA(abs(tl.y - 0.5), 0.47, aa / 1.2)) * fineFade;
      pave *= 1.0 - 0.18 * joint;
      float curb = 1.0 - smoothstep(0.25, 0.4, dEdge);
      col = mix(pave, vec3(0.5, 0.49, 0.46), curb);
      rough = 0.86;
    } else {
      // landscaped block interior
      kind = 4.0;
      vec3 paving = vec3(0.42, 0.37, 0.29) * (0.92 + 0.12 * n2);
      vec2 tl = fract(p / 3.0);
      float joint = (1.0 - encLineAA(abs(tl.x - 0.5), 0.485, aa / 3.0) * encLineAA(abs(tl.y - 0.5), 0.485, aa / 3.0)) * fineFade;
      paving *= 1.0 - 0.12 * joint;
      vec3 grass = mix(vec3(0.055, 0.12, 0.025), vec3(0.11, 0.2, 0.04), n1) * (0.85 + 0.3 * n2);
      float verge = step(dEdge, 7.5);
      float lawn = smoothstep(0.42, 0.5, n3 + 0.12 * n1);
      float m = max(verge, lawn);
      // hedges / planter lines along the verge edge
      float hedge = encLineAA(abs(dEdge - 7.5), 0.5, aa) * 0.6;
      col = mix(paving, grass, m);
      col = mix(col, vec3(0.03, 0.07, 0.02), hedge);
      rough = mix(0.85, 0.95, m);
    }
  }
  encSurfKind = kind;
  return vec4(col, rough);
}
`;

/** Bus-ownership map (nearest building's bus within ~38 m) used for the outage ground tint. */
export function createBusMap() {
  const W = 250;
  const H = 160;
  const id = new Uint8Array(W * H * 4);
  const wt = new Uint8Array(W * H);
  const { minX, maxX, minZ, maxZ } = PLATFORM;
  const rects = BUILDINGS.filter((b) => b.busIndex >= 1).map((b) => {
    const rotated = Math.abs(Math.sin(b.rot)) > 0.5;
    const hw = (rotated ? b.size[1] : b.size[0]) / 2;
    const hd = (rotated ? b.size[0] : b.size[1]) / 2;
    return { x: b.pos[0], z: b.pos[1], hw, hd, bus: b.busIndex };
  });
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = minX + ((i + 0.5) / W) * (maxX - minX);
      const z = minZ + ((j + 0.5) / H) * (maxZ - minZ);
      let best = -1;
      let bd = 1e9;
      for (const r of rects) {
        const dx = Math.max(0, Math.abs(x - r.x) - r.hw);
        const dz = Math.max(0, Math.abs(z - r.z) - r.hd);
        const d = Math.hypot(dx, dz);
        if (d < bd) {
          bd = d;
          best = r.bus;
        }
      }
      const k = j * W + i;
      const w = best >= 0 ? Math.max(0, 1 - bd / 38) : 0;
      id[k * 4] = best >= 0 ? best + 1 : 0;
      id[k * 4 + 3] = 255;
      wt[k] = Math.round(Math.pow(w, 0.8) * 255);
    }
  }
  const idTex = new DataTexture(id, W, H, RGBAFormat, UnsignedByteType);
  idTex.magFilter = NearestFilter;
  idTex.minFilter = NearestFilter;
  idTex.needsUpdate = true;
  const wTex = new DataTexture(wt, W, H, RedFormat, UnsignedByteType);
  wTex.magFilter = LinearFilter;
  wTex.minFilter = LinearFilter;
  wTex.needsUpdate = true;
  return { idTex, wTex };
}

export function createSurfaceMaterial() {
  const { idTex, wTex } = createBusMap();
  const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, envMapIntensity: 0.6 });
  const uniforms = {
    uBusId: { value: idTex },
    uBusW: { value: wTex },
    uBusState: { value: busTex },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uTint: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => 'encirra-surface-v2';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSurfW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurfW = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSurfW;
uniform sampler2D uBusId;
uniform sampler2D uBusW;
uniform sampler2D uBusState;
uniform float uTime;
uniform float uFade;
uniform float uTint;
${SURFACE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 surf = encSurface(vSurfW.xz);
float surfKind = encSurfKind;
diffuseColor.rgb = surf.rgb;
float surfRough = surf.a;
vec2 busUv = vec2((vSurfW.x - PLAT.x) / (PLAT.y - PLAT.x), (vSurfW.z - PLAT.z) / (PLAT.w - PLAT.z));
float busIdx = floor(texture2D(uBusId, busUv).r * 255.0 + 0.5) - 1.0;
float busW = texture2D(uBusW, busUv).r;
vec3 tintEm = vec3(0.0);
if (busIdx >= 0.0) {
  vec4 bs = texelFetch(uBusState, ivec2(int(busIdx), 0), 0);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.2);
  tintEm += vec3(1.0, 0.1, 0.07) * bs.r * busW * busW * 0.22 * pulse;
  tintEm += vec3(0.1, 0.9, 0.35) * bs.g * busW * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.72, 0.7), bs.r * busW * 0.45);
}
tintEm *= uTint;`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = surfRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += tintEm;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\ngl_FragColor.a *= uFade;`);
  };
  return mat;
}
