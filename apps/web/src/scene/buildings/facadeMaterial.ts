/**
 * Facade material: MeshStandardMaterial extended with a procedural window shader.
 *
 * Window grid in facade-metric space (aFacade: metres along facade, world height) with
 * derivative-based anti-aliasing and a far-distance fallback to average coverage (no shimmer).
 * Per-window hashed lit pattern, warm interiors, blinds, cool office floors.
 *
 * Per-building state comes from a small float DataTexture (one texel per building):
 *   R = power (0 dark … 1 lit), G = restore tint (green fade-in), B = highlight (hover/select),
 *   A = emergency lighting (de-energized / backup)
 */
import { DataTexture, FloatType, MeshStandardMaterial, NearestFilter, RGBAFormat, type IUniform } from 'three';
import { patchBuildingShader } from '../anim/patch';

export function createStateTexture(n: number) {
  const w = Math.max(1, n);
  const data = new Float32Array(w * 4);
  for (let i = 0; i < w; i++) data[i * 4] = 1;
  const tex = new DataTexture(data, w, 1, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface FacadeUniforms {
  uState: IUniform<DataTexture>;
  uTime: IUniform<number>;
  uFade: IUniform<number>; // 1 = opaque, lower = x-ray ghost
  uLitBoost: IUniform<number>;
}

const COMMON = /* glsl */ `
float encHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float encBoxAA(float x, float a, float b, float w){ return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;

export function createFacadeMaterial(stateTex: DataTexture, opts: { shadows?: boolean; tiles?: boolean } = {}) {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, envMapIntensity: 1.0 });
  const uniforms: FacadeUniforms = {
    uState: { value: stateTex },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uLitBoost: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => (opts.tiles ? 'encirra-facade-v3-tiles' : 'encirra-facade-v3');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec2 aFacade;
attribute vec4 aStyle;
attribute vec4 aExtra;
uniform sampler2D uState;
varying vec2 vFacade;
varying vec4 vStyle;
varying vec4 vExtra;
varying vec4 vBState;
varying vec3 vWNormal;
varying vec3 vWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
vFacade = aFacade;
vStyle = aStyle;
vExtra = aExtra;
vBState = texelFetch(uState, ivec2(int(aExtra.x + 0.5), 0), 0);
vWNormal = normalize(mat3(modelMatrix) * normal);
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
${COMMON}
uniform float uTime;
uniform float uFade;
uniform float uLitBoost;
varying vec2 vFacade;
varying vec4 vStyle;
varying vec4 vExtra;
varying vec4 vBState;
varying vec3 vWNormal;
varying vec3 vWPos;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float st = vStyle.x;
float floorH = max(vStyle.y, 0.5);
float bayW = max(vStyle.z, 0.5);
float facLen = vStyle.w;
float bldId = vExtra.x;
float baseY = vExtra.y;
float faceSeed = vExtra.z;
float topY = vExtra.w;
float power = vBState.r;
float restoreTint = vBState.g;
float highlight = vBState.b;
float emergency = vBState.a;
vec3 winEmissive = vec3(0.0);
float glassMask = 0.0;
float roughOut = 0.85;
float metalOut = 0.0;
bool isWall = abs(vWNormal.y) < 0.5;
vec3 wallCol = diffuseColor.rgb;

if (isWall && st > 0.5 && st < 6.5 || isWall && st > 8.5) {
  float margin = st > 1.5 && st < 2.5 ? 0.3 : (st > 8.5 && st < 9.5 ? 0.15 : 0.9);
  float span = max(facLen - 2.0 * margin, 0.01);
  float nCols = max(1.0, floor(span / bayW + 0.5));
  float bay = span / nCols;
  float cu = (vFacade.x - margin) / bay;
  float cv = (vFacade.y - baseY) / floorH;
  float col = floor(cu);
  float row = floor(cv);
  float fx = fract(cu);
  float fy = fract(cv);
  vec2 fw = max(fwidth(vec2(cu, cv)), vec2(1e-4));
  vec4 r = vec4(0.2, 0.8, 0.3, 0.86);
  float litFrac = 0.55;
  vec3 frameCol = wallCol;
  if (st < 1.5) { r = vec4(0.14, 0.86, 0.2, 0.88); litFrac = 0.66; }
  else if (st < 2.5) { r = vec4(0.06, 0.94, 0.1, 0.93); litFrac = 0.62; frameCol = wallCol * 0.55; }
  else if (st < 3.5) { r = vec4(0.0, 1.0, 0.32, 0.8); litFrac = 0.72; }
  else if (st < 4.5) {
    // storefront: tall ground floor glazing, ribbon above
    if (row < 0.5) { r = vec4(0.06, 0.94, 0.06, 0.82); litFrac = 0.92; }
    else { r = vec4(0.04, 0.96, 0.3, 0.78); litFrac = 0.6; }
  }
  else if (st < 5.5) { r = vec4(0.12, 0.88, 0.55, 0.8); litFrac = 0.35; }
  else if (st < 6.5) { r = vec4(0.15, 0.85, 0.2, 0.8); litFrac = 0.6; }
  else if (st > 8.5 && st < 9.5) { r = vec4(0.03, 0.97, 0.03, 0.97); litFrac = 0.85; }
  else { r = vec4(0.12, 0.88, 0.2, 0.88); litFrac = 0.66; }

  float inSpan = step(0.0, cu) * step(cu, nCols);
  float belowTop = 1.0 - smoothstep(topY - 1.1, topY - 0.9, vFacade.y);
  float aboveBase = smoothstep(baseY + 0.15, baseY + 0.35, vFacade.y);
  float mx = encBoxAA(fx, r.x, r.y, fw.x);
  float my = encBoxAA(fy, r.z, r.w, fw.y);
  float m = mx * my * inSpan * belowTop * aboveBase;
  float coverage = (r.y - r.x) * (r.w - r.z) * inSpan * belowTop * aboveBase;
  float farF = smoothstep(0.22, 0.55, max(fw.x, fw.y));
  m = mix(m, coverage, farF);

  // per-window variation
  vec3 cellId = vec3(col, row, faceSeed + bldId * 17.0);
  float h1 = encHash13(cellId);
  float h2 = mix(encHash13(cellId + 11.3), 0.5, farF);
  float h3 = mix(encHash13(cellId + 27.1), 0.5, farF);
  float lit = step(h1, litFrac);
  // whole-floor coherence for offices
  if (st > 1.5 && st < 2.5) lit = step(encHash13(vec3(row, faceSeed, bldId)) * 0.8 + h1 * 0.2, litFrac);
  lit = mix(lit, litFrac, farF);
  vec3 warm = mix(vec3(1.0, 0.56, 0.24), vec3(1.0, 0.78, 0.52), h2);
  if (st > 1.5 && st < 2.5) warm = mix(vec3(0.82, 0.9, 1.0), vec3(1.0, 0.8, 0.55), step(0.45, h2));
  float wy = (fy - r.z) / max(r.w - r.z, 0.01);
  // interior depth cue (ceiling glow, darker floor) and blinds
  float interior = mix(0.55, 1.0, smoothstep(0.0, 0.8, wy));
  float blinds = mix(1.0, 0.45 + 0.35 * step(0.5, fract(wy * 9.0)), step(0.72, h3) * (1.0 - farF));
  float intensity = (0.6 + 1.3 * h3) * interior * blinds;
  // de-energized: emergency fittings in a few windows + stair cores
  float emerg = step(0.955, h2) + step(0.5, encHash13(vec3(col, faceSeed, bldId))) * step(abs(col - floor(nCols * 0.5)), 0.0);
  vec3 litCol = warm * intensity * lit * power;
  vec3 emCol = vec3(0.65, 0.85, 1.0) * 0.55 * min(emerg, 1.0) * emergency * (1.0 - power);
  // restored: brief green-tinted fade-in
  litCol = mix(litCol, litCol * vec3(0.35, 1.25, 0.6) + vec3(0.02, 0.35, 0.12) * lit, restoreTint);
  winEmissive = (litCol + emCol) * m * uLitBoost;
  glassMask = m;
  // facade albedo: frame / spandrel colour where no glass
  vec3 glass = st > 1.5 && st < 2.5 ? vec3(0.1, 0.16, 0.2) : vec3(0.09, 0.11, 0.13);
  // floor slab lines on punched / ribbon facades
  float slab = (1.0 - encBoxAA(fy, 0.02, 0.98, fw.y)) * (1.0 - farF) * step(st, 3.5) * step(1.5, st);
  vec3 base = st > 1.5 && st < 2.5 ? frameCol : wallCol * (1.0 - 0.12 * slab);
  // ground-contact darkening (cheap AO) on the lowest metres of each volume
  base *= mix(0.72, 1.0, smoothstep(0.0, 7.0, vFacade.y - max(baseY, 0.0)));
  diffuseColor.rgb = mix(base, glass, m);
  roughOut = mix(st > 4.5 && st < 5.5 ? 0.7 : 0.8, 0.05, m);
  metalOut = mix(st > 1.5 && st < 2.5 ? 0.35 : 0.0, 0.55, m);
}
else if (!isWall && st > 6.5 && st < 7.5) {
  // rooftop PV: dark blue cells with fine frame lines
  vec2 pc = vFacade / vec2(1.05, 1.7);
  vec2 pf = fract(pc);
  vec2 pw = fwidth(pc);
  float cell = encBoxAA(pf.x, 0.05, 0.95, pw.x) * encBoxAA(pf.y, 0.04, 0.96, pw.y);
  float farP = smoothstep(0.3, 0.6, max(pw.x, pw.y));
  cell = mix(cell, 0.82, farP);
  diffuseColor.rgb = mix(vec3(0.5, 0.52, 0.55), vec3(0.012, 0.03, 0.075), cell);
  roughOut = mix(0.5, 0.18, cell);
  metalOut = mix(0.2, 0.55, cell);
}
else if (!isWall && st > 7.5 && st < 8.5) {
  // roof slab: subtle panel joints
  vec2 pc = vFacade / 4.0;
  vec2 pw = fwidth(pc);
  float j = 1.0 - encBoxAA(fract(pc.x), 0.02, 0.98, pw.x) * encBoxAA(fract(pc.y), 0.02, 0.98, pw.y);
  j *= 1.0 - smoothstep(0.2, 0.5, max(pw.x, pw.y));
  diffuseColor.rgb *= 1.0 - 0.12 * j;
  roughOut = 0.9;
}
else {
  roughOut = 0.8;
}
// de-energized buildings read darker and cooler (no interior light spill)
diffuseColor.rgb *= mix(vec3(0.7, 0.68, 0.74), vec3(1.0), clamp(power * 1.4, 0.0, 1.0));
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = roughOut;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
metalnessFactor = metalOut;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += winEmissive;
// hover / selection rim
vec3 viewDirW = normalize(cameraPosition - vWPos);
float rim = pow(1.0 - clamp(abs(dot(normalize(vWNormal), viewDirW)), 0.0, 1.0), 2.2);
totalEmissiveRadiance += vec3(0.25, 0.75, 1.0) * highlight * (0.18 + 1.6 * rim);`,
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `#include <dithering_fragment>
gl_FragColor.a *= uFade;`,
      );
    if (opts.tiles) patchBuildingShader(shader, 'aExtra.x');
  };
  return mat;
}
