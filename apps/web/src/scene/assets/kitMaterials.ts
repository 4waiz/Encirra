/**
 * Materials for batched kit meshes. Every material reads the per-building state texture through
 * the aBld vertex attribute (power, restore tint, highlight, emergency):
 *  - glazing: lit-window shader driven by the kit's glazing UV grid (u = bay, v = storey)
 *  - light_emissive / emissive_sign: switched with the supplying bus
 *  - everything else: PBR from the kit + baked AO (vertex colour) + hover rim + outage tint
 */
import { Color, DataTexture, DoubleSide, type Material, MeshStandardMaterial } from 'three';
import type { KitManifest } from './kit';

export interface KitUniforms {
  uState: { value: DataTexture };
  uTime: { value: number };
  uFade: { value: number };
}

const STATE_VERT_PARS = /* glsl */ `
attribute float aBld;
attribute vec2 aGrid;
uniform sampler2D uState;
varying vec4 vBState;
varying vec2 vGrid;
varying vec3 vKWN;
varying vec3 vKWP;
`;
const STATE_VERT = /* glsl */ `
vBState = texelFetch(uState, ivec2(int(aBld + 0.5), 0), 0);
vGrid = aGrid;
vKWN = normalize(mat3(modelMatrix) * normal);
vKWP = (modelMatrix * vec4(position, 1.0)).xyz;
`;
const STATE_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uFade;
varying vec4 vBState;
varying vec2 vGrid;
varying vec3 vKWN;
varying vec3 vKWP;
float kHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float kBoxAA(float x, float a, float b, float w){ return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;
const RIM = /* glsl */ `
{
  vec3 vd = normalize(cameraPosition - vKWP);
  float rim = pow(1.0 - clamp(abs(dot(normalize(vKWN), vd)), 0.0, 1.0), 2.2);
  totalEmissiveRadiance += vec3(0.25, 0.75, 1.0) * vBState.b * (0.16 + 1.5 * rim);
}
`;

type Kind = 'glazing' | 'emissive' | 'glass' | 'standard';

export function kitMaterialKind(name: string): Kind {
  if (name === 'glazing') return 'glazing';
  if (name === 'light_emissive' || name === 'emissive_sign') return 'emissive';
  if (name === 'glass_clear') return 'glass';
  return 'standard';
}

/**
 * Build the batched material for a kit material name.
 * `src` is the GLTF material (PBR values are taken from it, falling back to the manifest).
 */
export function createKitMaterial(name: string, src: Material | null, manifest: KitManifest | null, uniforms: KitUniforms, opts: { darkenOutage?: boolean; skyline?: boolean } = {}) {
  const pbr = manifest?.materialPBR?.[name] ?? {};
  const s = src as MeshStandardMaterial | null;
  const kind = kitMaterialKind(name);
  const mat = new MeshStandardMaterial({
    color: s?.color?.clone() ?? new Color(pbr.baseColor ?? '#cccccc'),
    roughness: s?.roughness ?? pbr.roughness ?? 0.8,
    metalness: s?.metalness ?? pbr.metalness ?? 0,
    map: s?.map ?? null,
    normalMap: s?.normalMap ?? null,
    vertexColors: true,
    side: s?.side ?? (name === 'foliage' ? DoubleSide : undefined),
    envMapIntensity: 1,
  });
  if (s?.normalMap && s.normalScale) mat.normalScale.copy(s.normalScale);
  if (kind === 'emissive') {
    mat.emissive = s?.emissive?.clone() ?? new Color(pbr.emissive ?? '#ffd08a');
    mat.emissiveIntensity = (s?.emissiveIntensity ?? pbr.emissiveIntensity ?? 4) * (name === 'light_emissive' ? 0.55 : 0.7);
  }
  if (kind === 'glass') {
    mat.transparent = true;
    mat.opacity = s?.opacity ?? pbr.opacity ?? 0.35;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.roughness = 0.05;
    mat.metalness = 0.1;
  }
  if (name === 'water') {
    mat.emissive = new Color('#1A8FD0');
    mat.emissiveIntensity = 0.8;
  }
  mat.userData.uniforms = uniforms;
  mat.userData.kitKind = kind;
  const darken = opts.darkenOutage !== false;
  if (opts.skyline) {
    mat.defines = { ENC_SKYLINE: '' };
    if (kind === 'standard') mat.color.multiplyScalar(0.62);
  }
  mat.customProgramCacheKey = () => `encirra-kit-${kind}-${name === 'water' ? 'w' : ''}${darken ? 'd' : ''}${mat.map ? 'm' : ''}${mat.normalMap ? 'n' : ''}${opts.skyline ? 's' : ''}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STATE_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${STATE_VERT}`);
    let frag = shader.fragmentShader.replace('#include <common>', `#include <common>\n${STATE_FRAG_PARS}`);
    if (kind === 'glazing') {
      frag = frag
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
float power = vBState.r;
float restoreTint = vBState.g;
float emergency = vBState.a;
vec2 g = vGrid;
vec2 ci = floor(g);
vec2 cf = fract(g);
vec2 fw = max(fwidth(g), vec2(1e-4));
float farF = smoothstep(0.18, 0.45, max(fw.x, fw.y));
// thin mullions / transoms inside each bay
float pane = kBoxAA(cf.x, 0.035, 0.965, fw.x) * kBoxAA(cf.y, 0.05, 0.95, fw.y);
pane = mix(pane, 0.86, farF);
vec3 nq = normalize(vKWN);
float face = floor(atan(nq.z, nq.x) * 0.6366 + 2.5);
vec3 cid = vec3(ci, face * 31.0 + floor(vKWP.x * 0.05) * 7.0 + floor(vKWP.z * 0.05) * 13.0);
float h1 = kHash13(cid);
float h2 = mix(kHash13(cid + 11.3), 0.5, farF);
float h3 = mix(kHash13(cid + 27.1), 0.5, farF);
bool lobby = g.y < 1.0;
#ifdef ENC_SKYLINE
float litFrac = 0.3;
#else
float litFrac = lobby ? 0.85 : 0.44;
#endif
float lit = step(h1, litFrac);
lit = mix(lit, litFrac, farF);
vec3 warm = mix(vec3(1.0, 0.55, 0.24), vec3(1.0, 0.78, 0.5), h2);
warm = mix(warm, vec3(0.85, 0.92, 1.0), step(0.86, h2) * 0.6);
float interior = mix(0.5, 1.0, smoothstep(0.0, 0.85, cf.y));
interior = mix(interior, 0.8, farF);
float blinds = mix(1.0, 0.45 + 0.35 * step(0.5, fract(cf.y * 9.0)), step(0.74, h3) * (1.0 - farF));
float inten = (0.55 + 1.25 * h3) * interior * blinds * (lobby ? 1.3 : 1.0);
float emerg = step(0.955, h2) * emergency * (1.0 - power);
vec3 litCol = warm * inten * lit * power;
litCol = mix(litCol, litCol * vec3(0.35, 1.25, 0.6) + vec3(0.02, 0.35, 0.12) * lit, restoreTint);
vec3 kWinEm = (litCol + vec3(0.65, 0.85, 1.0) * 0.55 * emerg) * pane;
vec3 frameCol = vec3(0.16, 0.17, 0.19);
#ifdef ENC_SKYLINE
diffuseColor.rgb = mix(frameCol * 0.6, diffuseColor.rgb * 0.45, pane);
kWinEm *= 0.75;
#else
diffuseColor.rgb = mix(frameCol, diffuseColor.rgb * 0.85, pane);
#endif
float kRough = mix(0.45, 0.06, pane);
#ifdef ENC_SKYLINE
float kMetal = 0.35;
#else
float kMetal = mix(0.6, 0.55, pane);
#endif`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = kRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = kMetal;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += kWinEm;\n${RIM}`);
    } else if (kind === 'emissive') {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// lamps follow the supplying bus; a few stay on as emergency lighting
totalEmissiveRadiance *= mix(0.08 + 0.35 * vBState.a, 1.0, clamp(vBState.r, 0.0, 1.0));
${RIM}`,
      );
    } else {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
${RIM}`,
      );
      if (darken)
        frag = frag.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(0.72, 0.7, 0.76), vec3(1.0), clamp(vBState.r * 1.4, 0.0, 1.0));`,
        );
    }
    frag = frag.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= uFade;');
    shader.fragmentShader = frag;
  };
  return mat;
}
