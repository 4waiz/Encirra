/**
 * Shader patches that make district materials follow the tile / grow animation (see motion.ts).
 *
 *  - patchBuildingShader: merged building meshes in district coordinates (identity model matrix);
 *    grows the building height and applies its tile transform, rotating normals too.
 *  - patchSurfaceShader: the per-tile block surface (aTile attribute).
 *  - patchWorldTiles: anything else (instanced props, tank water columns): the tile is taken from the
 *    instance / object origin, the transform is applied in world space before the view matrix, and
 *    instanced props pop in during the intro.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { motionUniforms, TILE_VERT_GLSL } from './motion';

type Shader = WebGLProgramParametersWithUniforms;

function addCommon(shader: Shader) {
  shader.uniforms.uTileTex = motionUniforms.uTileTex;
  shader.uniforms.uBldAnim = motionUniforms.uBldAnim;
  shader.uniforms.uPropT = motionUniforms.uPropT;
  if (!shader.vertexShader.includes('encTileRot(')) shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${TILE_VERT_GLSL}`);
}

const TILE_XF = /* glsl */ `
mat3 encR = mat3(1.0);
vec3 encPiv = vec3(0.0);
vec3 encOff = vec3(0.0);
{
  int ii = int(encTI + 0.5);
  vec4 ta = texelFetch(uTileTex, ivec2(ii, 0), 0);
  vec4 tb = texelFetch(uTileTex, ivec2(ii, 1), 0);
  vec4 tc = texelFetch(uTileTex, ivec2(ii, 2), 0);
  encR = encTileRot(ta, tb);
  encPiv = vec3(tc.x, 0.0, tc.y);
  encOff = ta.xyz;
}
`;

/** Merged building geometry: `bldExpr` is the GLSL expression of the building index attribute. */
export function patchBuildingShader(shader: Shader, bldExpr: string) {
  addCommon(shader);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
vec4 encBA = encBldAnim(${bldExpr});
float encTI = encBA.g;
${TILE_XF}
objectNormal = encR * objectNormal;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
transformed.y *= encBA.r;
transformed = encPiv + encR * (transformed - encPiv) + encOff;`,
    );
}

/** Block surface tiles: tile index from the aTile attribute. */
export function patchSurfaceShader(shader: Shader) {
  addCommon(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aTile;')
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
float encTI = aTile;
${TILE_XF}
objectNormal = encR * objectNormal;`,
    )
    .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = encPiv + encR * (transformed - encPiv) + encOff;`);
}

/**
 * World-space tile transform before the view matrix. `pop`: instanced props scale in from their
 * base during the intro. Works for instanced and plain meshes (tile from the object origin).
 */
export function patchWorldTiles(shader: Shader, opts: { pop?: boolean } = {}) {
  addCommon(shader);
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 encOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
#else
  vec3 encOrigin = modelMatrix[3].xyz;
#endif
vec4 encW = modelMatrix * mvPosition;
${opts.pop ? 'encW.xyz = encOrigin + (encW.xyz - encOrigin) * encPropPop(encOrigin.xz);' : ''}
float encTI = encTileOf(encOrigin.xz);
${TILE_XF}
encW.xyz = encPiv + encR * (encW.xyz - encPiv) + encOff;
mvPosition = viewMatrix * encW;
gl_Position = projectionMatrix * mvPosition;
`,
  );
}

/** Chain a patch onto a material's existing onBeforeCompile and extend its program cache key. */
export function withPatch<T extends Material>(m: T, key: string, patch: (s: Shader) => void): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    patch(shader);
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
  return m;
}
