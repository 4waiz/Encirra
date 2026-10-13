/**
 * "Curved world" for the decorative context (lower city, water, skyline).
 *
 * Beyond BEND.r0 metres from the district centre the ground falls away quadratically
 * (drop = (r − r0)² / 2R). Seen from the high oblique district camera this lowers the visible
 * horizon into the frame, so the dusk sky and the skyline sit behind the top cards while the
 * district fills the middle band — the reference composition, which a flat world cannot produce.
 * The district itself is never bent.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';

export const BEND = { r0: 290, R: 2300 };

export const BEND_GLSL = /* glsl */ `
float encBendDrop(vec2 xz) {
  float r = length(xz);
  float e = max(r - ${BEND.r0.toFixed(1)}, 0.0);
  return e * e / ${(2 * BEND.R).toFixed(1)};
}
`;

export function bendDrop(x: number, z: number) {
  const e = Math.max(Math.hypot(x, z) - BEND.r0, 0);
  return (e * e) / (2 * BEND.R);
}

const PROJECT_BENT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 encBW = modelMatrix * mvPosition;
encBW.y -= encBendDrop(encBW.xz);
mvPosition = viewMatrix * encBW;
gl_Position = projectionMatrix * mvPosition;
`;

/** Patch a shader (inside onBeforeCompile) so its vertices follow the curved world. */
export function bendShader(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${BEND_GLSL}`)
    .replace('#include <project_vertex>', PROJECT_BENT);
}

/** Apply the bend to a built-in material (chains any existing onBeforeCompile). */
export function applyBend<T extends Material>(mat: T, key = 'bend'): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    bendShader(shader);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
  return mat;
}
