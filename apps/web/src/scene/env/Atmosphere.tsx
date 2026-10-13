/**
 * Sky dome, procedural environment lighting (PMREM of a generated sky scene), sun + fill lights
 * and the scene haze.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, Color, FogExp2, type DirectionalLight, type Mesh, Object3D, ShaderMaterial, Vector3 } from 'three';
import { bendDrop } from '../context/bend';
import { GROUND_Y } from '../context/layout';
import { useKit } from '../assets/kit';
import { useTwin } from '@/state/store';
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
    uniforms: { uTime: { value: 0 }, uDip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDip;
      varying vec3 vDir;
      ${SKY_GLSL}
      ${NOISE_GLSL}
      void main() {
        vec3 d0 = normalize(vDir);
        // shift the sky so its horizon band sits on the visible (curved-world) horizon
        float el = asin(clamp(d0.y, -1.0, 1.0)) + uDip;
        vec2 hz = normalize(d0.xz + vec2(1e-5, 0.0));
        vec3 d = vec3(hz.x * cos(el), sin(el), hz.y * cos(el));
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
  const fwd = useMemo(() => new Vector3(), []);
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    const cam = state.camera;
    if (ref.current) ref.current.position.copy(cam.position);
    // visible horizon of the curved context ground along the view azimuth
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    let best = -Math.PI / 2;
    for (let i = 0; i < 64; i++) {
      const s = 30 * Math.pow(400, i / 63);
      const x = cam.position.x + fwd.x * s;
      const z = cam.position.z + fwd.z * s;
      const e = Math.atan2(GROUND_Y - bendDrop(x, z) - cam.position.y, s);
      if (e > best) best = e;
    }
    mat.uniforms.uDip.value = Math.max(0, -best);
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
    <Environment resolution={256} frames={1} environmentIntensity={0.48}>
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
    scene.fog = new FogExp2(new Color('#ffffff'), 0.00042);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  // The sun and every shadow caster are static, so the shadow map is re-rendered only when the
  // scene content changes (kit assets streamed in, layers toggled, quality tier) — plus a slow
  // safety refresh — instead of every frame.
  const gl = useThree((s) => s.gl);
  const dirty = useRef(8);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    const u1 = useKit.subscribe(() => (dirty.current = 6));
    const u2 = useTwin.subscribe((s, p) => {
      if (s.layers !== p.layers) dirty.current = 40; // fades run for a while
    });
    return () => {
      u1();
      u2();
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useEffect(() => {
    dirty.current = 6;
  }, [tier]);
  const frame = useRef(0);
  useFrame(() => {
    frame.current++;
    if (dirty.current > 0 || frame.current % 120 === 0) {
      gl.shadowMap.needsUpdate = true;
      if (dirty.current > 0) dirty.current--;
    }
  });

  return (
    <>
      <directionalLight
        ref={sun}
        color={SUN.color}
        intensity={4.6}
        position={[sd[0] * 900, sd[1] * 900, sd[2] * 900]}
        castShadow={tier !== 'low'}
      />
      {/* cool sky fill from the opposite side to separate facades */}
      <directionalLight color="#9DB4DA" intensity={0.38} position={[-sd[0] * 600, 500, -sd[2] * 600]} />
      <hemisphereLight args={['#A9BBD6', '#6A5240', 0.5]} />
    </>
  );
}
