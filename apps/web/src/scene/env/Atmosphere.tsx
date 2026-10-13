/**
 * Sky dome, procedural environment lighting (PMREM of a generated sky scene), sun + fill lights
 * and the scene haze.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, Color, FogExp2, type DirectionalLight, type Mesh, Object3D, ShaderMaterial } from 'three';
import { SKY_GLSL, NOISE_GLSL, installHazeFog } from './skyShader';
import { SUN, sunDirection, WORLD } from '../config';
import { useSceneQuality } from '../runtime';

installHazeFog();

function makeSkyMaterial(clouds: boolean) {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${SKY_GLSL}
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = encSkyBase(d, 1.0);
        ${
          clouds
            ? `
        if (d.y > 0.0) {
          vec2 cp = d.xz / (d.y + 0.08) * 0.55 + vec2(uTime * 0.004, uTime * 0.001);
          float n = encFbm(cp * 1.6);
          float n2 = encFbm(cp * 4.0 + 3.1);
          float cov = smoothstep(0.52, 0.86, n * 0.8 + n2 * 0.25) * smoothstep(0.015, 0.12, d.y) * (1.0 - smoothstep(0.45, 0.85, d.y));
          vec3 sh = normalize(vec3(ENC_SUN_DIR.x, 0.0, ENC_SUN_DIR.z));
          float az = dot(normalize(vec3(d.x, 0.0, d.z)), sh) * 0.5 + 0.5;
          vec3 cLit = mix(vec3(0.95, 0.66, 0.55), vec3(1.35, 0.92, 0.66), az);
          vec3 cShade = vec3(0.55, 0.5, 0.6);
          vec3 cloud = mix(cShade, cLit, smoothstep(0.35, 0.9, n2));
          col = mix(col, cloud * mix(0.9, 1.15, az), cov * 0.5);
          // long thin streaks near the horizon
          float streak = smoothstep(0.62, 0.9, encFbm(vec2(cp.x * 0.6, cp.y * 5.0))) * smoothstep(0.01, 0.05, d.y) * (1.0 - smoothstep(0.08, 0.2, d.y));
          col = mix(col, mix(vec3(1.0, 0.7, 0.55), vec3(1.4, 0.95, 0.7), az), streak * 0.35);
        }`
            : ''
        }
        // anti-banding dither
        float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (dn - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function SkyDome() {
  const mat = useMemo(() => makeSkyMaterial(true), []);
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    if (ref.current) ref.current.position.copy(state.camera.position);
  });
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh ref={ref} material={mat} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[WORLD.skyRadius, 48, 24]} />
    </mesh>
  );
}

/** PMREM environment generated from the procedural sky (+ a few soft light cards). */
export function SkyEnvironment() {
  const mat = useMemo(() => makeSkyMaterial(false), []);
  const sd = sunDirection();
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.62}>
      <mesh material={mat} scale={500} renderOrder={-1}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
      {/* warm sun-side card and a cool zenith card to shape reflections */}
      <Lightformer form="rect" intensity={6} color="#FFC08A" position={[sd[0] * 300, sd[1] * 300 + 20, sd[2] * 300]} scale={[260, 60, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.8} color="#B8C6DA" position={[0, 400, 0]} scale={[500, 500, 1]} rotation-x={Math.PI / 2} />
    </Environment>
  );
}

export function Lights() {
  const tier = useSceneQuality((s) => s.tier);
  const sun = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const scene = useThree((s) => s.scene);
  const sd = sunDirection();
  const mapSize = tier === 'high' ? 4096 : tier === 'medium' ? 2048 : 1024;

  useEffect(() => {
    scene.add(target);
    target.position.set(0, 0, 0);
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);

  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.target = target;
    const cam = l.shadow.camera;
    cam.left = -330;
    cam.right = 330;
    cam.top = 300;
    cam.bottom = -300;
    cam.near = 100;
    cam.far = 1700;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(mapSize, mapSize);
    l.shadow.bias = -0.00035;
    l.shadow.normalBias = 0.35;
    if (l.shadow.map) {
      l.shadow.map.dispose();
      (l.shadow as { map: unknown }).map = null;
    }
  }, [target, mapSize]);

  useEffect(() => {
    scene.fog = new FogExp2(new Color('#ffffff'), 0.00026);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  return (
    <>
      <directionalLight
        ref={sun}
        color={SUN.color}
        intensity={3.1}
        position={[sd[0] * 900, sd[1] * 900, sd[2] * 900]}
        castShadow={tier !== 'low'}
      />
      {/* cool sky fill from the opposite side to separate facades */}
      <directionalLight color="#A9BCD8" intensity={0.55} position={[-sd[0] * 600, 500, -sd[2] * 600]} />
      <hemisphereLight args={['#C6CEDC', '#7B5E46', 0.75]} />
    </>
  );
}
