import * as THREE from 'three';
import { createNoiseTexture } from './textures/noise';

// Procedural weathering for the Blender materials: the GLBs carry flat colours, and this shader layer
// adds the things that make built surfaces read as real at aerial and street distances: tonal
// variation, soiling at the foot of walls, rain streaks, precast panel joints, profiled cladding ribs
// and dusty roofs. Everything is world-space, so instanced reactor units weather individually.

export type WeatherKind = 'concrete' | 'cladding' | 'roof' | 'tank' | 'metal' | 'painted' | 'container';

interface Params {
  /** soiling band at the foot of walls (strength, height in m) */
  grime: number;
  grimeHeight: number;
  /** vertical rain streaks */
  streaks: number;
  /** precast panel joints (0/1) */
  joints: number;
  /** profiled cladding ribs (0/1) and their pitch in m */
  ribs: number;
  ribPitch: number;
  /** dust on up-facing surfaces */
  roof: number;
  /** large-scale tonal variation */
  macro: number;
}

const PARAMS: Record<WeatherKind, Params> = {
  concrete: { grime: 0.5, grimeHeight: 2.6, streaks: 1, joints: 1, ribs: 0, ribPitch: 0.9, roof: 0.6, macro: 1 },
  cladding: { grime: 0.42, grimeHeight: 2.2, streaks: 0.55, joints: 0, ribs: 1, ribPitch: 0.9, roof: 0.5, macro: 0.8 },
  roof: { grime: 0.2, grimeHeight: 1.0, streaks: 0.3, joints: 0, ribs: 0, ribPitch: 0.9, roof: 1, macro: 1.1 },
  tank: { grime: 0.45, grimeHeight: 2.0, streaks: 0.8, joints: 0, ribs: 0, ribPitch: 0.9, roof: 0.4, macro: 0.7 },
  metal: { grime: 0.22, grimeHeight: 1.6, streaks: 0.3, joints: 0, ribs: 0, ribPitch: 0.9, roof: 0.35, macro: 0.6 },
  painted: { grime: 0.15, grimeHeight: 1.0, streaks: 0.2, joints: 0, ribs: 0, ribPitch: 0.9, roof: 0.3, macro: 0.5 },
  // corrugated steel boxes: fine ribs, rust-run streaks, dusty tops
  container: { grime: 0.28, grimeHeight: 1.1, streaks: 0.7, joints: 0, ribs: 1, ribPitch: 0.3, roof: 0.55, macro: 0.75 },
};

const KIND_BY_MATERIAL: Record<string, WeatherKind> = {
  dome_white: 'concrete',
  concrete_white: 'concrete',
  concrete_light: 'concrete',
  concrete_warm: 'concrete',
  concrete_dark: 'concrete',
  concrete_sand: 'concrete',
  concrete_stone: 'concrete',
  cladding: 'cladding',
  cladding_blue: 'cladding',
  cladding_teal: 'cladding',
  cladding_sage: 'cladding',
  roof_dark: 'roof',
  roof_metal: 'roof',
  roof_white: 'roof',
  roof_green: 'roof',
  tank_white: 'tank',
  tank_green: 'tank',
  steel: 'metal',
  steel_dark: 'metal',
  crane_yellow: 'metal',
  pylon_red: 'metal',
  pylon_white: 'metal',
  transformer: 'metal',
  hvac: 'metal',
  stripe_red: 'painted',
  accent_blue: 'painted',
  accent_navy: 'painted',
  accent_teal: 'painted',
  container_blue: 'container',
  container_rust: 'container',
  container_white: 'container',
  container_gray: 'container',
  container_green: 'container',
  container_red: 'container',
  rock: 'concrete',
};

let noise: THREE.Texture | null = null;
const sharedNoise = () => (noise ??= createNoiseTexture(256));

const VERT_PARS = /* glsl */ `
varying vec3 vEncWorld;
varying vec3 vEncNormal;
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 encW = vec4(transformed, 1.0);
  vec3 encN = objectNormal;
  #ifdef USE_INSTANCING
    encW = instanceMatrix * encW;
    encN = mat3(instanceMatrix) * encN;
  #endif
  encW = modelMatrix * encW;
  vEncWorld = encW.xyz;
  vEncNormal = mat3(modelMatrix) * encN;
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vEncWorld;
varying vec3 vEncNormal;
uniform sampler2D uEncNoise;
uniform float uEncGrime;
uniform float uEncGrimeH;
uniform float uEncStreaks;
uniform float uEncJoints;
uniform float uEncRibs;
uniform float uEncRibPitch;
uniform float uEncRoof;
uniform float uEncMacro;
float encMid = 0.5;

// coverage of a thin line of width w (m) at distance d (m), box-filtered over the pixel footprint
float encLine(float d, float w, float fw) {
  float cov = clamp(w / max(fw, 1e-4), 0.0, 1.0);
  return (1.0 - smoothstep(w * 0.5, w * 0.5 + fw, d)) * max(cov, 0.12);
}
`;

const FRAG_MAIN = /* glsl */ `
{
  vec3 wp = vEncWorld;
  vec3 wn = normalize(vEncNormal);
  float wall = 1.0 - smoothstep(0.35, 0.75, abs(wn.y));
  float up = smoothstep(0.7, 0.95, wn.y);
  float nb = texture2D(uEncNoise, wp.xz * 0.0031 + wp.y * 0.0017).r;
  encMid = texture2D(uEncNoise, wp.xz * 0.043 + vec2(wp.y * 0.021, -wp.y * 0.017)).g;
  vec3 c = diffuseColor.rgb;

  // tonal variation across a facade or roof
  c *= 1.0 + uEncMacro * (0.13 * (nb - 0.5) + 0.05 * (encMid - 0.5));

  // coordinate along an axis-aligned facade
  float along = abs(wn.x) > abs(wn.z) ? wp.z : wp.x;

  // precast concrete: vertical joints every 6 m, horizontal every 3 m
  if (uEncJoints > 0.5) {
    float fa = fwidth(along);
    float fy = fwidth(wp.y);
    float jv = encLine(abs(fract(along / 6.0 + 0.5) - 0.5) * 6.0, 0.07, fa);
    float jh = encLine(abs(fract(wp.y / 3.0 + 0.5) - 0.5) * 3.0, 0.06, fy);
    c *= 1.0 - 0.26 * max(jv, jh) * wall;
  }

  // profiled cladding and corrugated steel: soft ribs, faded out before they alias
  if (uEncRibs > 0.5) {
    float rib = 0.5 + 0.5 * cos(along * 6.2832 / uEncRibPitch);
    float fade = clamp(1.0 - fwidth(along) / (uEncRibPitch * 0.45), 0.0, 1.0);
    c *= mix(1.0, mix(0.9, 1.035, rib), fade * wall);
  }

  // soiling at the foot of walls (splash-back and wind-blown sand)
  float foot = 1.0 - smoothstep(0.0, uEncGrimeH, wp.y);
  c = mix(c, c * vec3(0.7, 0.63, 0.54), wall * foot * uEncGrime);

  // rain streaks running down from parapets
  float st = texture2D(uEncNoise, vec2(along * 0.19, wp.y * 0.006)).b;
  c *= 1.0 - wall * uEncStreaks * 0.15 * smoothstep(0.55, 0.92, st);

  // dust and bleaching on roofs and other up-facing surfaces
  c = mix(c, c * vec3(0.93, 0.9, 0.84), up * uEncRoof * smoothstep(0.42, 0.85, encMid));

  diffuseColor.rgb = c;
}
`;

/** Adds the weathering layer to a GLB material (idempotent). */
export function weatherMaterial(m: THREE.MeshStandardMaterial) {
  const kind = KIND_BY_MATERIAL[m.name];
  if (!kind || m.userData.weathered) return;
  m.userData.weathered = true;
  const p = PARAMS[kind];
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uEncNoise: { value: sharedNoise() },
      uEncGrime: { value: p.grime },
      uEncGrimeH: { value: p.grimeHeight },
      uEncStreaks: { value: p.streaks },
      uEncJoints: { value: p.joints },
      uEncRibs: { value: p.ribs },
      uEncRibPitch: { value: p.ribPitch },
      uEncRoof: { value: p.roof },
      uEncMacro: { value: p.macro },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MAIN}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.9 + 0.22 * encMid), 0.04, 1.0);`,
      );
  };
  // one program per weathering class (uniform values differ per material, the code does not)
  m.customProgramCacheKey = () => `encirra-weather-v2`;
  m.needsUpdate = true;
}
