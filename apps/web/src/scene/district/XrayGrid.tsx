/**
 * Underground x-ray backdrop: a subtle dark-blue engineering grid under the network, faded in
 * with layers.underground so the pipes and cables read against a calm, technical background.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, type Mesh, NormalBlending, ShaderMaterial } from 'three';
import { PLATFORM } from '../data/twin';
import { fx } from '../runtime';

export function XrayGrid() {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: NormalBlending,
        fog: false,
        uniforms: { uOn: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vP = w.xz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOn;
          varying vec2 vP;
          float gridLine(vec2 p, float period, float w) {
            vec2 q = abs(fract(p / period + 0.5) - 0.5) * period;
            vec2 fw = fwidth(p);
            vec2 l = 1.0 - smoothstep(vec2(w) - fw, vec2(w) + fw, q);
            return max(l.x, l.y);
          }
          void main() {
            vec2 hb = vec2(${((PLATFORM.maxX - PLATFORM.minX) / 2 + 30).toFixed(1)}, ${((PLATFORM.maxZ - PLATFORM.minZ) / 2 + 30).toFixed(1)});
            vec2 e = abs(vP) / hb;
            float edge = 1.0 - smoothstep(0.82, 1.0, max(e.x, e.y));
            float minor = gridLine(vP, 10.0, 0.12) * 0.35;
            float major = gridLine(vP, 40.0, 0.25);
            vec3 base = vec3(0.012, 0.03, 0.06);
            vec3 line = vec3(0.12, 0.38, 0.75);
            vec3 col = base + line * max(minor, major) * 0.9;
            float a = (0.62 + 0.3 * max(minor, major)) * edge * uOn;
            if (a < 0.003) discard;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    [],
  );
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    mat.uniforms.uOn.value = fx.xray;
    if (ref.current) ref.current.visible = fx.xray > 0.003;
  });
  useEffect(() => () => mat.dispose(), [mat]);
  const w = PLATFORM.maxX - PLATFORM.minX + 60;
  const d = PLATFORM.maxZ - PLATFORM.minZ + 60;
  return (
    <mesh ref={ref} material={mat} rotation-x={-Math.PI / 2} position={[0, -30.5, 0]} renderOrder={1} visible={false}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}
