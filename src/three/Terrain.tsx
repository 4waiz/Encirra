import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { SITE } from '../data/site';
import { createSiteTexture, SITE_TEX_RECT } from './textures/siteTexture';
import { SHORE_RECT } from './textures/shoreMask';
import { registerThermal, thermalGround } from './thermal';
import { useUI } from '../store/ui';

import { createNoiseTexture } from './textures/noise';
import { DUNE_START, terrainHeight } from './terrainHeight';

/** Coastline polygon: the flat coastal plain from the shore to where the dune field begins. */
function landPolygon(): [number, number][] {
  const c = SITE.coastline.slice(0, SITE.coastline.length - 2);
  return [[-14000, -110], ...c, [14000, -140], [14000, DUNE_START], [-14000, DUNE_START]];
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

/** Grid coordinates: fine near the campus, widening geometrically toward the fogged horizon. */
function axis(start: number, end: number, step0: number, coreEnd: number, growth: number) {
  const out = [start];
  let v = start;
  let step = step0;
  while (v < end) {
    if (v >= coreEnd) step *= growth;
    v = Math.min(end, v + step);
    out.push(v);
  }
  return out;
}

/**
 * Inland dune field: a heightfield whose first row meets the coastal plain at y = 0, split into tiles
 * so each camera (main view and every feed) only draws the tiles inside its frustum.
 */
function buildDunes(): THREE.BufferGeometry[] {
  const half = axis(0, 14000, 20, 2500, 1.03);
  const xs = [...half.slice(1).reverse().map((v) => -v), ...half];
  const zs = axis(DUNE_START, 12000, 14, DUNE_START, 1.012);
  const nx = xs.length;
  const nz = zs.length;
  // one shared vertex grid so normals are continuous across tile seams
  const pos = new Float32Array(nx * nz * 3);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      pos[k++] = xs[i];
      pos[k++] = terrainHeight(xs[i], zs[j]);
      pos[k++] = zs[j];
    }
  }
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fullIdx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      fullIdx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  all.setIndex(fullIdx);
  all.computeVertexNormals();
  const nrm = all.getAttribute('normal').array as Float32Array;
  all.dispose();

  const TILE_X = Math.ceil((nx - 1) / 8);
  const TILE_Z = Math.ceil((nz - 1) / 4);
  const tiles: THREE.BufferGeometry[] = [];
  for (let tj = 0; tj < nz - 1; tj += TILE_Z) {
    for (let ti = 0; ti < nx - 1; ti += TILE_X) {
      const i1 = Math.min(nx - 1, ti + TILE_X);
      const j1 = Math.min(nz - 1, tj + TILE_Z);
      const w = i1 - ti + 1;
      const h = j1 - tj + 1;
      const tp = new Float32Array(w * h * 3);
      const tn = new Float32Array(w * h * 3);
      let o = 0;
      for (let j = tj; j <= j1; j++) {
        for (let i = ti; i <= i1; i++) {
          const src = (j * nx + i) * 3;
          tp.set(pos.subarray(src, src + 3), o);
          tn.set(nrm.subarray(src, src + 3), o);
          o += 3;
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < h - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i;
          idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(tn, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      tiles.push(g);
    }
  }
  return tiles;
}

export function Terrain({ shoreTex }: { shoreTex: THREE.Texture }) {
  const gl = useThree((s) => s.gl);
  const quality = useUI((s) => s.settings.quality);
  const geometry = useMemo(buildLand, []);
  const duneTiles = useMemo(buildDunes, []);
  const noiseTex = useMemo(() => createNoiseTexture(256), []);
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
        uNoise: { value: noiseTex },
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
          uniform sampler2D uNoise;`,
        )
        .replace(
          '#include <map_fragment>',
          `
          vec2 gp = vGWorld.xz;
          float n1 = texture2D(uNoise, gp * 0.00085).r;
          float n2 = texture2D(uNoise, gp * 0.0105 + 0.37).g;
          float n3 = texture2D(uNoise, gp * 0.11 + 0.71).b;
          vec3 sand = mix(uSandA, uSandB, smoothstep(0.3, 0.74, n1));
          sand *= 0.92 + 0.12 * n2 + 0.05 * (n3 - 0.5);
          sand *= 0.975 + 0.025 * sin(gp.x * 0.07 + gp.y * 0.04 + n2 * 7.0);
          vec2 shuv = (gp - uShoreRect.xy) / uShoreRect.zw;
          vec3 shore = texture2D(uShore, clamp(shuv, 0.001, 0.999)).rgb;
          float wet = smoothstep(0.42, 0.66, shore.r) * (1.0 - smoothstep(0.8, 0.97, shore.r));
          sand = mix(sand, sand * vec3(0.72, 0.74, 0.78), wet * 0.85);
          // dunes: warmer, redder sand on crests; wind ripples up close
          float dh = clamp(vGWorld.y / 24.0, 0.0, 1.0);
          sand = mix(sand, sand * vec3(1.08, 0.92, 0.77), dh * 0.6);
          float ripC = dot(gp, vec2(0.62, 0.785)) * 2.4;
          float ripFade = 1.0 - smoothstep(0.35, 1.2, fwidth(ripC));
          sand *= 1.0 + 0.035 * sin(ripC + n2 * 9.0) * ripFade * smoothstep(0.2, 2.0, vGWorld.y);
          // coastal sabkha: pale salt crust and darker damp patches on the plain beside the campus
          float plain = (1.0 - smoothstep(520.0, 700.0, gp.y)) * smoothstep(690.0, 900.0, abs(gp.x));
          float cn = texture2D(uNoise, gp * 0.00061 + 0.21).r + 0.22 * (texture2D(uNoise, gp * 0.0047 + 0.5).g - 0.5);
          float crust = smoothstep(0.56, 0.6, cn);
          float rim = smoothstep(0.5, 0.56, cn) * (1.0 - crust);
          sand = mix(sand, mix(sand, vec3(0.84, 0.82, 0.77), 0.45) * (0.96 + 0.06 * n3), plain * crust * 0.72);
          sand = mix(sand, sand * vec3(0.86, 0.85, 0.82), plain * rim * 0.6);
          float damp = smoothstep(0.6, 0.8, texture2D(uNoise, gp * 0.0019 + 0.63).g);
          sand = mix(sand, sand * vec3(0.8, 0.79, 0.76), plain * damp * 0.45);
          // north–south access road with a dashed centre line
          float rx = abs(gp.x + 588.0);
          float road = (1.0 - smoothstep(5.0, 6.2, rx)) * step(300.0, gp.y);
          vec3 asphalt = vec3(0.065, 0.068, 0.075) * (0.94 + 0.12 * n3);
          sand = mix(sand, asphalt, road * (1.0 - smoothstep(4000.0, 9000.0, gp.y)));
          float fwx = fwidth(gp.x);
          float rcl = (1.0 - smoothstep(0.09, 0.09 + fwx, rx)) * min(1.0, 0.18 / max(fwx, 1e-4)) * step(0.5, fract(gp.y / 10.0));
          sand = mix(sand, vec3(0.82, 0.8, 0.74), road * rcl * 0.8);
          // inland east–west highway: dual carriageway, median, edge and lane lines
          float hd = abs(gp.y - 2600.0);
          float hw = 1.0 - smoothstep(11.0, 12.2, hd);
          float fwz = fwidth(gp.y);
          sand = mix(sand, asphalt, hw);
          sand = mix(sand, vec3(0.42, 0.4, 0.37), hw * (1.0 - smoothstep(0.7, 0.7 + fwz, hd)) * min(1.0, 1.4 / max(fwz, 1e-4)));
          float lineCov = min(1.0, 0.22 / max(fwz, 1e-4));
          float edge = (1.0 - smoothstep(0.12, 0.12 + fwz, abs(hd - 10.3))) * lineCov;
          float lane = (1.0 - smoothstep(0.1, 0.1 + fwz, abs(hd - 5.4))) * lineCov * step(0.55, fract(gp.x / 12.0));
          sand = mix(sand, vec3(0.86, 0.84, 0.78), hw * max(edge, lane) * 0.85);
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
    m.customProgramCacheKey = () => 'encirra-ground-v4';
    return m;
  }, [siteTex, siteRect, shoreTex, noiseTex]);

  const mesh = useMemo(() => {
    const m = new THREE.Mesh(geometry, material);
    m.name = 'land';
    m.receiveShadow = true;
    return m;
  }, [geometry, material]);

  const dunes = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'dunes';
    for (const g of duneTiles) {
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }, [duneTiles, material]);

  useEffect(() => {
    const heat = thermalGround(siteTex, siteRect);
    const offs = [registerThermal(mesh, heat), ...dunes.children.map((c) => registerThermal(c as THREE.Mesh, heat))];
    return () => {
      offs.forEach((f) => f());
      heat.dispose();
    };
  }, [mesh, dunes, siteTex, siteRect]);
  useEffect(() => () => duneTiles.forEach((g) => g.dispose()), [duneTiles]);
  useEffect(() => () => siteTex.dispose(), [siteTex]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <>
      <primitive object={mesh} />
      <primitive object={dunes} />
    </>
  );
}
