import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { SITE } from '../data/site';
import { createSiteTexture, SITE_TEX_RECT } from './textures/siteTexture';
import { SHORE_RECT } from './textures/shoreMask';
import { registerThermal, thermalGround } from './thermal';
import { useUI } from '../store/ui';

const GLSL_NOISE = /* glsl */ `
  float g_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float g_noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(g_hash(i), g_hash(i + vec2(1.0, 0.0)), u.x), mix(g_hash(i + vec2(0.0, 1.0)), g_hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float g_fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * g_noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
`;

/** Coastline polygon extended far inland so the horizon is land, not water. */
function landPolygon(): [number, number][] {
  const c = SITE.coastline.slice(0, SITE.coastline.length - 2);
  return [[-14000, -110], ...c, [14000, -140], [14000, 14000], [-14000, 14000]];
}

function buildLand(): THREE.BufferGeometry {
  const poly = landPolygon();
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const top = new THREE.ShapeGeometry(shape, 1);
  top.rotateX(-Math.PI / 2);

  // sloping beach skirt along the natural coastline (the platform edge is the Blender seawall)
  const coast = poly.slice(0, poly.length - 2);
  const isSeawall = (a: [number, number], b: [number, number]) => a[1] === SITE.seawall.z && b[1] === SITE.seawall.z;
  const normals = coast.map((_, i) => {
    const acc = new THREE.Vector2();
    for (const [a, b] of [
      [coast[i - 1], coast[i]],
      [coast[i], coast[i + 1]],
    ] as const) {
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      acc.add(new THREE.Vector2(dz / len, -dx / len));
    }
    return acc.normalize();
  });
  const pos: number[] = [];
  const idx: number[] = [];
  const OUT = 26;
  const DOWN = -7;
  for (let i = 0; i < coast.length - 1; i++) {
    const a = coast[i];
    const b = coast[i + 1];
    if (isSeawall(a, b)) continue;
    const na = normals[i];
    const nb = normals[i + 1];
    const base = pos.length / 3;
    pos.push(a[0], 0, a[1], b[0], 0, b[1], a[0] + na.x * OUT, DOWN, a[1] + na.y * OUT, b[0] + nb.x * OUT, DOWN, b[1] + nb.y * OUT);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skirt.setIndex(idx);
  skirt.computeVertexNormals();

  const merged = new THREE.BufferGeometry();
  const tp = top.getAttribute('position').array as Float32Array;
  const tn = top.getAttribute('normal').array as Float32Array;
  const sp = skirt.getAttribute('position').array as Float32Array;
  const sn = skirt.getAttribute('normal').array as Float32Array;
  const positions = new Float32Array(tp.length + sp.length);
  positions.set(tp, 0);
  positions.set(sp, tp.length);
  const nrm = new Float32Array(tn.length + sn.length);
  nrm.set(tn, 0);
  nrm.set(sn, tn.length);
  const topIndex = top.getIndex();
  const ti = topIndex ? Array.from(topIndex.array) : Array.from({ length: tp.length / 3 }, (_, k) => k);
  const offset = tp.length / 3;
  const allIdx = [...ti, ...idx.map((k) => k + offset)];
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  merged.setIndex(allIdx);
  merged.computeBoundingSphere();
  top.dispose();
  skirt.dispose();
  return merged;
}

export function Terrain({ shoreTex }: { shoreTex: THREE.Texture }) {
  const gl = useThree((s) => s.gl);
  const quality = useUI((s) => s.settings.quality);
  const geometry = useMemo(buildLand, []);
  const siteTex = useMemo(() => createSiteTexture(quality, gl.capabilities.getMaxAnisotropy()), [quality, gl]);
  const siteRect = useMemo(
    () => new THREE.Vector4(SITE_TEX_RECT.minX, SITE_TEX_RECT.minZ, SITE_TEX_RECT.maxX - SITE_TEX_RECT.minX, SITE_TEX_RECT.maxZ - SITE_TEX_RECT.minZ),
    [],
  );

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, name: 'ground' });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uSiteTex: { value: siteTex },
        uSiteRect: { value: siteRect },
        uShore: { value: shoreTex },
        uShoreRect: { value: new THREE.Vector4(SHORE_RECT.minX, SHORE_RECT.minZ, SHORE_RECT.maxX - SHORE_RECT.minX, SHORE_RECT.maxZ - SHORE_RECT.minZ) },
        uSandA: { value: new THREE.Color('#dccaa6') },
        uSandB: { value: new THREE.Color('#c8b28c') },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGWorld;
          uniform sampler2D uSiteTex; uniform vec4 uSiteRect;
          uniform sampler2D uShore; uniform vec4 uShoreRect;
          uniform vec3 uSandA; uniform vec3 uSandB;
          ${GLSL_NOISE}`,
        )
        .replace(
          '#include <map_fragment>',
          `
          vec2 gp = vGWorld.xz;
          float n1 = g_fbm(gp * 0.0032);
          float n2 = g_fbm(gp * 0.019 + 7.3);
          float n3 = g_noise(gp * 0.42);
          vec3 sand = mix(uSandA, uSandB, smoothstep(0.3, 0.74, n1));
          sand *= 0.92 + 0.12 * n2 + 0.05 * (n3 - 0.5);
          sand *= 0.975 + 0.025 * sin(gp.x * 0.07 + gp.y * 0.04 + n2 * 7.0);
          vec2 shuv = (gp - uShoreRect.xy) / uShoreRect.zw;
          vec3 shore = texture2D(uShore, clamp(shuv, 0.001, 0.999)).rgb;
          float wet = smoothstep(0.42, 0.66, shore.r) * (1.0 - smoothstep(0.8, 0.97, shore.r));
          sand = mix(sand, sand * vec3(0.72, 0.74, 0.78), wet * 0.85);
          float road = (1.0 - smoothstep(5.0, 6.2, abs(gp.x + 588.0))) * step(300.0, gp.y);
          sand = mix(sand, vec3(0.06, 0.065, 0.075), road * (1.0 - smoothstep(2600.0, 7000.0, gp.y)));
          float track = (1.0 - smoothstep(1.4, 2.6, abs(abs(gp.x) - 72.0))) * step(260.0, gp.y);
          sand = mix(sand, sand * 0.86, track * 0.7 * (1.0 - smoothstep(1800.0, 4000.0, gp.y)));
          vec2 suv = vec2((gp.x - uSiteRect.x) / uSiteRect.z, 1.0 - (gp.y - uSiteRect.y) / uSiteRect.w);
          vec4 site = vec4(0.0);
          if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) site = texture2D(uSiteTex, suv);
          site.rgb *= 0.965 + 0.07 * (n3 - 0.5) + 0.05 * (n2 - 0.5);
          diffuseColor.rgb = mix(sand, site.rgb, site.a);
          `,
        );
    };
    m.customProgramCacheKey = () => 'encirra-ground-v1';
    return m;
  }, [siteTex, siteRect, shoreTex]);

  const mesh = useMemo(() => {
    const m = new THREE.Mesh(geometry, material);
    m.name = 'land';
    m.receiveShadow = true;
    return m;
  }, [geometry, material]);

  useEffect(() => registerThermal(mesh, thermalGround(siteTex, siteRect)), [mesh, siteTex, siteRect]);
  useEffect(() => () => siteTex.dispose(), [siteTex]);
  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={mesh} />;
}
