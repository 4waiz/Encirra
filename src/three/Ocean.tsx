import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { SHORE_RECT } from './textures/shoreMask';
import { createWaveNormalMap } from './textures/waveNormal';
import { registerThermal, thermalWater } from './thermal';

export const WATER_LEVEL = -1.5;

export function Ocean({ shoreTex }: { shoreTex: THREE.Texture }) {
  const gl = useThree((s) => s.gl);
  const wave = useMemo(() => createWaveNormalMap(256, gl.capabilities.getMaxAnisotropy()), [gl]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWave: { value: wave },
      uShore: { value: shoreTex },
      uShoreRect: { value: new THREE.Vector4(SHORE_RECT.minX, SHORE_RECT.minZ, SHORE_RECT.maxX - SHORE_RECT.minX, SHORE_RECT.maxZ - SHORE_RECT.minZ) },
      uDeep: { value: new THREE.Color('#0c3c55') },
      uShallow: { value: new THREE.Color('#2fa39f') },
      uFoam: { value: new THREE.Color('#dce9e6') },
    }),
    [wave, shoreTex],
  );

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#0c3c55', roughness: 0.16, metalness: 0, envMapIntensity: 0.82, name: 'water' });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWWorld;
          uniform float uTime; uniform sampler2D uWave; uniform sampler2D uShore; uniform vec4 uShoreRect;
          uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
          float wFoam = 0.0;`,
        )
        .replace(
          '#include <map_fragment>',
          `
          vec2 wp = vWWorld.xz;
          vec2 shuv = (wp - uShoreRect.xy) / uShoreRect.zw;
          vec3 sh = texture2D(uShore, clamp(shuv, 0.001, 0.999)).rgb;
          float shallow = smoothstep(0.02, 0.62, sh.g);
          vec3 water = mix(uDeep, uShallow, shallow * 0.9);
          float far = smoothstep(1500.0, 6000.0, length(vWWorld.xz));
          water = mix(water, uDeep * 0.85, far);
          float foamBand = smoothstep(0.26, 0.5, sh.r) * (1.0 - sh.b);
          float fn = texture2D(uWave, wp * 0.06 + vec2(uTime * 0.012, -uTime * 0.009)).r;
          wFoam = foamBand * smoothstep(0.45, 0.8, fn + sh.r * 0.45);
          diffuseColor.rgb = mix(water, uFoam, wFoam * 0.6);
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.4, wFoam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec2 wq = vWWorld.xz;
            vec3 n1 = texture2D(uWave, wq * 0.0105 + vec2(uTime * 0.0058, uTime * 0.0041)).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(uWave, wq * 0.031 + vec2(-uTime * 0.0102, uTime * 0.0069)).xyz * 2.0 - 1.0;
            vec3 n3 = texture2D(uWave, wq * 0.0031 + vec2(uTime * 0.0019, -uTime * 0.0012)).xyz * 2.0 - 1.0;
            // fine chop dominates; long swells only tilt gently, so the sky doesn't mirror in patches
            vec3 nn = n1 * 0.6 + n2 * 0.85 + n3 * 0.22;
            float df = smoothstep(250.0, 4800.0, length(vWWorld - cameraPosition));
            float strength = mix(0.27, 0.035, df);
            vec3 nW = normalize(vec3(nn.x * strength, 1.0, nn.y * strength));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`,
        );
    };
    m.customProgramCacheKey = () => 'encirra-water-v1';
    return m;
  }, [uniforms]);

  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(30000, 30000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, material);
    m.position.y = WATER_LEVEL;
    m.name = 'ocean';
    m.receiveShadow = true;
    return m;
  }, [material]);

  useEffect(() => registerThermal(mesh, thermalWater()), [mesh]);
  useEffect(
    () => () => {
      wave.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
    [wave, material, mesh],
  );

  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
  });

  return <primitive object={mesh} />;
}
