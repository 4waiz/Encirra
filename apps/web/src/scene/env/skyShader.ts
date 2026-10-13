/**
 * Procedural dusk sky (shared by the visible sky dome, the PMREM environment scene and the
 * view-direction-aware distance haze). Everything is generated — no HDRI downloads.
 */
import { Color, ShaderChunk } from 'three';
import { sunDirection } from '../config';

const v3 = (c: string) => {
  const k = new Color(c); // converted to linear working space
  return `vec3(${k.r.toFixed(5)}, ${k.g.toFixed(5)}, ${k.b.toFixed(5)})`;
};

const sd = sunDirection();
const SUN = `normalize(vec3(${sd[0].toFixed(5)}, ${sd[1].toFixed(5)}, ${sd[2].toFixed(5)}))`;

/** GLSL: base sky radiance (linear HDR) for a world direction. */
export const SKY_GLSL = /* glsl */ `
#ifndef ENC_SKY
#define ENC_SKY
const vec3 ENC_SUN_DIR = ${SUN};
vec3 encSkyBase(vec3 d, float withSun) {
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 cHor = ${v3('#FFD0A0')} * 1.6;
  vec3 cLow = ${v3('#F6AA78')} * 1.35;
  vec3 cMid = ${v3('#E3A27F')} * 1.0;
  vec3 cUp  = ${v3('#8E9DB9')} * 0.88;
  vec3 cTop = ${v3('#4F6E99')} * 0.8;
  vec3 col = mix(cHor, cLow, smoothstep(0.0, 0.05, t));
  col = mix(col, cMid, smoothstep(0.03, 0.16, t));
  col = mix(col, cUp, smoothstep(0.12, 0.38, t));
  col = mix(col, cTop, smoothstep(0.32, 0.9, t));
  vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
  vec3 sh = normalize(vec3(ENC_SUN_DIR.x, 0.0, ENC_SUN_DIR.z));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float lowW = 1.0 - smoothstep(0.0, 0.55, t);
  col *= mix(${v3('#D8D4E6')} * 1.02, ${v3('#FFE9D2')} * 1.12, az * lowW + (1.0 - lowW) * 0.5);
  float sdot = max(dot(d, ENC_SUN_DIR), 0.0);
  vec3 sunCol = ${v3('#FFC894')};
  col += sunCol * (pow(sdot, 5.0) * 0.38 + pow(sdot, 32.0) * 0.75 + pow(sdot, 300.0) * 2.4) * withSun;
  col += sunCol * smoothstep(0.99955, 0.99975, dot(d, ENC_SUN_DIR)) * 40.0 * withSun;
  vec3 cGround = ${v3('#C9946F')} * 0.9;
  col = mix(col, mix(cHor * 0.92, cGround, smoothstep(0.02, 0.25, -h)), smoothstep(0.0, 0.02, -h));
  return col;
}
vec3 encHaze(vec3 d) {
  vec3 dd = normalize(vec3(d.x, 0.004, d.z) + vec3(1e-5, 0.0, 0.0));
  // aerial perspective: warm towards the sun, dustier / cooler elsewhere
  vec3 sh = normalize(vec3(ENC_SUN_DIR.x, 0.0, ENC_SUN_DIR.z));
  float az = dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0)), sh) * 0.5 + 0.5;
  return encSkyBase(dd, 0.35) * mix(vec3(0.62, 0.6, 0.66), vec3(0.78, 0.7, 0.62), az);
}
#endif
`;

/** GLSL helpers for clouds (dome only). */
export const NOISE_GLSL = /* glsl */ `
float encH21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float encNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = encH21(i), b = encH21(i + vec2(1.0, 0.0)), c = encH21(i + vec2(0.0, 1.0)), d = encH21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float encFbm(vec2 p){
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * encNoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
`;

let fogInstalled = false;
/**
 * Replace three's fog chunks with a view-direction-aware haze whose colour matches the sky at the
 * horizon in that direction (so distant towers dissolve into the dusk glow, not a flat colour).
 * Uses FogExp2 density; scene.fog.color acts as a multiplier (keep it white).
 */
export function installHazeFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${SKY_GLSL}
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float encFogD = max(vFogDepth - 420.0, 0.0);
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * encFogD * encFogD );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float encWy = cameraPosition.y + vFogWorld.y;
  fogFactor = clamp(fogFactor * mix(1.25, 0.8, smoothstep(-50.0, 150.0, encWy)), 0.0, 1.0);
  vec3 encFogCol = encHaze(normalize(vFogWorld)) * fogColor;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, encFogCol, fogFactor );
#endif`;
}
