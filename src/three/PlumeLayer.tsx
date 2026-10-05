import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { engine } from '../simulation/engine';
import { envelope, type Effect } from '../simulation/effects';
import { useSim } from '../store/sim';
import { useUI } from '../store/ui';
import { sceneClock } from './sceneClock';
import { LAYER } from './layers';
import { windVector } from '../utils/math';

const FOOT_VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/** Ground footprint of the Gaussian plume (matches chemField in the engine). */
const CHEM_FOOT_FRAG = /* glsl */ `
  uniform vec2 uSource;
  uniform vec2 uWind;
  uniform float uLevel;
  uniform float uReach;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vXZ;
  void main() {
    vec2 d = vXZ - uSource;
    float along = dot(d, uWind);
    float cross = -d.x * uWind.y + d.y * uWind.x;
    float a = max(along, 0.0);
    float upwind = along < 0.0 ? exp(along / 14.0) : 1.0;
    float sy = 7.0 + 0.24 * a;
    float decay = 1.0 / (1.0 + a / 140.0);
    float front = 1.0 - smoothstep(uReach - 15.0, uReach + 35.0, along);
    float f = uLevel * upwind * decay * front * exp(-cross * cross / (2.0 * sy * sy));
    if (f < 0.02) discard;
    vec3 col = mix(vec3(0.18, 0.78, 0.66), vec3(0.62, 1.0, 0.82), smoothstep(0.3, 1.0, f));
    float lv = f * 6.0 - uTime * 0.3;
    float g = fract(lv);
    float contour = 1.0 - smoothstep(0.0, fwidth(lv) * 1.4, min(g, 1.0 - g));
    float alpha = smoothstep(0.02, 0.35, f) * 0.34 + contour * 0.28 * smoothstep(0.05, 0.2, f);
    gl_FragColor = vec4(col * 1.2, alpha * uOpacity);
  }
`;

/** Wind-advected soft particles: positions are computed on the GPU from seed + time. */
const PUFF_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec2 uSource;
  uniform vec2 uWind;
  uniform float uSpeed;
  uniform float uTime;
  uniform float uLevel;
  uniform float uReach;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float life = 34.0;
    float age = fract(uTime / life + aSeed.x);
    float dist = age * life * max(uSpeed, 1.2) * 1.1;
    vec2 perp = vec2(-uWind.y, uWind.x);
    float spread = 6.0 + 0.26 * dist;
    vec2 p2 = uSource + uWind * dist + perp * (aSeed.y * 2.0 - 1.0) * spread * 1.3
      + perp * sin(uTime * 0.35 + aSeed.x * 31.0) * (1.5 + dist * 0.03);
    float y = 1.2 + aSeed.z * (2.5 + dist * 0.09) + age * 5.0;
    float size = (7.0 + dist * 0.32) * (0.65 + 0.7 * aSeed.w);
    vec4 mv = viewMatrix * vec4(p2.x, y, p2.y, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy + 0.5;
    float decay = 1.0 / (1.0 + dist / 160.0);
    float front = 1.0 - smoothstep(uReach - 10.0, uReach + 30.0, dist);
    vAlpha = uLevel * decay * front * smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(0.7, 1.0, age));
  }
`;

const PUFF_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float d = length(vUv - 0.5);
    float a = (1.0 - smoothstep(0.08, 0.5, d)) * vAlpha * 0.2 * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(0.42, 0.95, 0.8), a);
  }
`;

const BIO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BIO_FRAG = /* glsl */ `
  uniform float uLevel;
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vW;
  float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 v = normalize(cameraPosition - vW);
    float fres = pow(1.0 - abs(dot(normalize(vN), v)), 2.0);
    float n = n3(vW * 0.035 + vec3(0.0, uTime * 0.06, uTime * 0.03));
    float a = (0.028 + fres * 0.24) * (0.6 + 0.8 * n) * uLevel * uOpacity;
    gl_FragColor = vec4(vec3(0.38, 0.78, 1.0) * 1.3, a);
  }
`;

const BIO_FOOT_FRAG = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uSigma;
  uniform float uLevel;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vXZ;
  void main() {
    vec2 d = vXZ - uCenter;
    float f = exp(-dot(d, d) / (2.0 * uSigma * uSigma)) * uLevel;
    if (f < 0.03) discard;
    vec2 cell = fract(vXZ / 9.0) - 0.5;
    float dots = 1.0 - smoothstep(0.08, 0.16, length(cell));
    float ring = 1.0 - smoothstep(0.0, 1.6, abs(length(d) - uSigma * 1.6));
    float a = (smoothstep(0.03, 0.5, f) * 0.14 + dots * f * 0.32 + ring * 0.25 * uLevel);
    gl_FragColor = vec4(vec3(0.42, 0.8, 1.0), a * uOpacity);
  }
`;

function useLayerOpacity(on: boolean) {
  const v = useRef(0);
  return (dt: number) => {
    v.current += ((on ? 1 : 0) - v.current) * (1 - Math.exp(-dt * 6));
    return v.current;
  };
}

function ChemPlume({ effect }: { effect: Effect }) {
  const visible = useUI((s) => s.layers.chemical);
  const fade = useLayerOpacity(visible);
  const { foot, puffs, uniforms } = useMemo(() => {
    const uniforms = {
      uSource: { value: new THREE.Vector2(effect.x, effect.z) },
      uWind: { value: new THREE.Vector2(0.7, 0.7) },
      uSpeed: { value: 3 },
      uLevel: { value: 0 },
      uReach: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    };
    const fg = new THREE.PlaneGeometry(1400, 1400);
    fg.rotateX(-Math.PI / 2);
    const foot = new THREE.Mesh(fg, new THREE.ShaderMaterial({ uniforms, vertexShader: FOOT_VERT, fragmentShader: CHEM_FOOT_FRAG, transparent: true, depthWrite: false }));
    foot.position.set(effect.x, 0.8, effect.z);
    foot.renderOrder = 2;
    const N = 380;
    const base = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = base.index;
    ig.setAttribute('position', base.getAttribute('position'));
    ig.setAttribute('uv', base.getAttribute('uv'));
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
    ig.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    ig.instanceCount = N;
    const puffs = new THREE.Mesh(ig, new THREE.ShaderMaterial({ uniforms, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false }));
    puffs.frustumCulled = false;
    puffs.renderOrder = 4;
    foot.layers.set(LAYER.OVERLAY);
    puffs.layers.set(LAYER.OVERLAY);
    return { foot, puffs, uniforms };
  }, [effect]);

  useEffect(
    () => () => {
      [foot, puffs].forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
    },
    [foot, puffs],
  );

  useFrame((_, dt) => {
    const t = sceneClock.t;
    const env = envelope(effect, t);
    const w = windVector(engine.windDirAt(t));
    uniforms.uWind.value.lerp(new THREE.Vector2(w.x, w.z), 1 - Math.exp(-dt * 1.6)).normalize();
    uniforms.uSpeed.value = engine.windSpeedAt(t) / 3.6;
    uniforms.uLevel.value = Math.min(1.2, (effect.amplitude * env) / 2.2);
    uniforms.uReach.value = Math.max(25, uniforms.uSpeed.value * Math.max(0, (t - effect.t0) / 1000) * 1.15);
    uniforms.uTime.value += dt;
    uniforms.uOpacity.value = fade(dt);
    foot.visible = puffs.visible = uniforms.uOpacity.value > 0.01 && env > 0.001;
  });

  return (
    <>
      <primitive object={foot} />
      <primitive object={puffs} />
    </>
  );
}

function BioCloud({ effect }: { effect: Effect }) {
  const visible = useUI((s) => s.layers.biological);
  const fade = useLayerOpacity(visible);
  const { dome, foot, uniforms } = useMemo(() => {
    const uniforms = {
      uCenter: { value: new THREE.Vector2(effect.x, effect.z) },
      uSigma: { value: effect.sigma },
      uLevel: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    };
    const dg = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(dg, new THREE.ShaderMaterial({ uniforms, vertexShader: BIO_VERT, fragmentShader: BIO_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    dome.scale.set(effect.sigma * 1.55, effect.sigma * 0.34, effect.sigma * 1.55);
    dome.renderOrder = 5;
    const fg = new THREE.PlaneGeometry(effect.sigma * 4, effect.sigma * 4);
    fg.rotateX(-Math.PI / 2);
    const foot = new THREE.Mesh(fg, new THREE.ShaderMaterial({ uniforms, vertexShader: FOOT_VERT, fragmentShader: BIO_FOOT_FRAG, transparent: true, depthWrite: false }));
    foot.renderOrder = 2;
    dome.layers.set(LAYER.OVERLAY);
    foot.layers.set(LAYER.OVERLAY);
    return { dome, foot, uniforms };
  }, [effect]);

  useEffect(
    () => () => {
      [dome, foot].forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
    },
    [dome, foot],
  );

  useFrame((_, dt) => {
    const t = sceneClock.t;
    const env = envelope(effect, t);
    const w = windVector(engine.windDirAt(t));
    const cx = effect.x + w.x * 0.3 * effect.sigma;
    const cz = effect.z + w.z * 0.3 * effect.sigma;
    uniforms.uCenter.value.set(cx, cz);
    dome.position.set(cx, 0.5, cz);
    foot.position.set(cx, 0.7, cz);
    uniforms.uLevel.value = Math.min(1, (effect.amplitude * env) / 38);
    uniforms.uTime.value += dt;
    uniforms.uOpacity.value = fade(dt);
    dome.visible = foot.visible = uniforms.uOpacity.value > 0.01 && env > 0.001;
  });

  return (
    <>
      <primitive object={dome} />
      <primitive object={foot} />
    </>
  );
}

export function PlumeLayer() {
  const tick = useSim((s) => s.tick);
  const effects = useMemo(() => engine.effects.filter((e) => e.kind === 'chem' || e.kind === 'bio'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group name="plume-layer">
      {effects.map((e) => (e.kind === 'chem' ? <ChemPlume key={e.id} effect={e} /> : <BioCloud key={e.id} effect={e} />))}
    </group>
  );
}
