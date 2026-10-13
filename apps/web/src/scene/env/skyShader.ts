/**
 * Procedural dusk sky (shared by the visible sky dome, the PMREM environment scene and the
 * view-direction-aware distance haze). Everything is generated — no HDRI downloads.
 */
import { Color, ShaderChunk } from 'three';
import { skyGlowDirection } from '../config';

const v3 = (c: string) => {
  const k = new Color(c); // converted to linear working space
  return `vec3(${k.r.toFixed(5)}, ${k.g.toFixed(5)}, ${k.b.toFixed(5)})`;
};

const gd = skyGlowDirection();
const GLOW = `normalize(vec3(${gd[0].toFixed(5)}, ${gd[1].toFixed(5)}, ${gd[2].toFixed(5)}))`;

/**
 * GLSL: base sky radiance (linear HDR) for a world direction.
 * Palette (as in the reference): slate-blue zenith, grey-blue / lavender mid sky, dusty rose above
 * the horizon and a warm peach-gold glow low on the horizon behind the skyline (ENC_SUN_DIR is the
 * glow direction, not the key light).
 */
export const SKY_GLSL = /* glsl */ `
#ifndef ENC_SKY
#define ENC_SKY
const vec3 ENC_SUN_DIR = ${GLOW};
vec3 encSkyGrad(vec3 d, float withSun, float squash);
vec3 encSkyBase(vec3 d, float withSun) {
  return encSkyGrad(d, withSun, 1.0);
}
vec3 encSkyGrad(vec3 d, float withSun, float squash) {
  float h = d.y;
  // squash > 1 compresses the gradient towards the horizon (used by the visible dome, whose
  // in-frame sky band is only a few degrees tall above the curved horizon)
  float t = clamp(h * squash, 0.0, 1.0);
  vec3 cHor = ${v3('#FFDDB8')} * 1.35;
  vec3 cLow = ${v3('#EDB898')} * 1.05;
  vec3 cMid = ${v3('#C2A0A6')} * 0.85;
  vec3 cUp  = ${v3('#8792B0')} * 0.68;
  vec3 cTop = ${v3('#4A5C80')} * 0.55;
  vec3 col = mix(cHor, cLow, smoothstep(0.0, 0.04, t));
  col = mix(col, cMid, smoothstep(0.03, 0.13, t));
  col = mix(col, cUp, smoothstep(0.11, 0.32, t));
  col = mix(col, cTop, smoothstep(0.28, 0.8, t));
  vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
  vec3 sh = normalize(vec3(ENC_SUN_DIR.x, 0.0, ENC_SUN_DIR.z));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float lowW = 1.0 - smoothstep(0.0, 0.45, t);
  // warm towards the glow, cool lavender-blue away from it (strongest near the horizon)
  float azW = pow(az, 1.6);
  col *= mix(${v3('#BFC8DE')} * 0.92, ${v3('#FFE4C6')} * 1.12, azW * lowW + (1.0 - lowW) * 0.42);
  float sdot = max(dot(d, ENC_SUN_DIR), 0.0);
  vec3 glowCol = ${v3('#FFC898')};
  col += glowCol * (pow(sdot, 4.0) * 0.32 + pow(sdot, 22.0) * 0.85 + pow(sdot, 180.0) * 1.6) * withSun;
  vec3 cGround = ${v3('#5E5F6C')} * 0.55;
  col = mix(col, mix(cHor * 0.8, cGround, smoothstep(0.02, 0.25, -h)), smoothstep(0.0, 0.02, -h));
  return col;
}
vec3 encHaze(vec3 d) {
  vec3 dd = normalize(vec3(d.x, 0.004, d.z) + vec3(1e-5, 0.0, 0.0));
  // aerial perspective: warm towards the glow, blue-grey elsewhere
  vec3 sh = normalize(vec3(ENC_SUN_DIR.x, 0.0, ENC_SUN_DIR.z));
  float az = dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0)), sh) * 0.5 + 0.5;
  return encSkyBase(dd, 0.35) * mix(vec3(0.56, 0.61, 0.72), vec3(0.84, 0.77, 0.7), az * az);
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
  for (int i = 0; i < 4; i++) { v += a * encNoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
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
  // low evening mist over the lower city so the raised district reads clearly above it
  float encMist = (1.0 - smoothstep(-62.0, -30.0, encWy)) * smoothstep(60.0, 420.0, vFogDepth) * 0.26;
  vec3 encFogCol = encHaze(normalize(vFogWorld)) * fogColor;
  // the mist is a dimmer, cooler blue-grey dusk haze than the bright horizon glow
  vec3 encMistCol = encFogCol * vec3(0.34, 0.38, 0.48);
  encFogCol = mix(encFogCol, encMistCol, encMist / max(1.0 - (1.0 - fogFactor) * (1.0 - encMist), 1e-3) * (1.0 - fogFactor));
  fogFactor = 1.0 - (1.0 - fogFactor) * (1.0 - encMist);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, encFogCol, fogFactor );
#endif`;
}
