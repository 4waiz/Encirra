/**
 * Cut-away dressing: light spill on the gallery back walls (cool fixtures + a cyan bounce from the
 * mains, modulated by the live flow state of the main in that stretch) and underground-kit fittings
 * (gate / check valves) on the visible mains at PS-2, R1, PS-1 and in the west gallery.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, InstancedMesh, type Material, Matrix4, type MeshStandardMaterial, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { PIPES } from '../data/twin';
import { live } from '../data/live';
import { fx } from '../runtime';
import { useKitFile } from '../assets/kit';
import { collectMeshes } from '../assets/merge';
import { PULL_GLSL } from '../networks/Water';

/** Gallery back-wall panels (world space). seg = pipe whose flow tints the bounce light. */
interface Panel {
  a: [number, number, number]; // bottom-left corner
  u: [number, number, number]; // along-wall vector (length = width)
  h: number; // height
  n: [number, number, number]; // wall normal (into the gallery)
  pipe: string;
}

const PANELS: Panel[] = [
  // front transmission gallery (pipe y −15), split at PS-2 / PS-1 so each stretch follows its main
  { a: [-250, -18.2, 147.05], u: [90, 0, 0], h: 7.8, n: [0, 0, 1], pipe: 'P-PS2D-T2C' },
  { a: [-160, -18.2, 147.05], u: [260, 0, 0], h: 7.8, n: [0, 0, 1], pipe: 'P-PS1D-T1C' },
  { a: [100, -18.2, 147.05], u: [136, 0, 0], h: 7.8, n: [0, 0, 1], pipe: 'P-PS1D-T1C' },
  // front suction gallery (pipe y −24)
  { a: [-236, -27.6, 147.05], u: [292, 0, 0], h: 8.4, n: [0, 0, 1], pipe: 'S-R1-PS2' },
  { a: [56, -27.6, 147.05], u: [180, 0, 0], h: 8.4, n: [0, 0, 1], pipe: 'S-R1-PS1' },
  // west gallery (pipe x −242)
  { a: [-236.95, -18.2, 160], u: [0, 0, -290], h: 7.8, n: [-1, 0, 0], pipe: 'P-T2C-WR' },
];

function panelGeometry() {
  const pos: number[] = [];
  const uv: number[] = [];
  const pid: number[] = [];
  const idx: number[] = [];
  PANELS.forEach((p, i) => {
    const b = pos.length / 3;
    const len = Math.hypot(...p.u);
    const c = [p.a, [p.a[0] + p.u[0], p.a[1], p.a[2] + p.u[2]], [p.a[0] + p.u[0], p.a[1] + p.h, p.a[2] + p.u[2]], [p.a[0], p.a[1] + p.h, p.a[2]]];
    for (let k = 0; k < 4; k++) {
      pos.push(...(c[k] as number[]));
      uv.push(k === 1 || k === 2 ? len : 0, k >= 2 ? p.h : 0);
      pid.push(i);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aPanel', new BufferAttribute(new Float32Array(pid), 1));
  g.setIndex(idx);
  return g;
}

export function Galleries() {
  const geo = useMemo(() => panelGeometry(), []);
  const pipeIdx = useMemo(() => PANELS.map((p) => PIPES.findIndex((q) => q.id === p.pipe)), []);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
        uniforms: { uFlow: { value: new Float32Array(8) }, uTime: { value: 0 }, uOn: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aPanel;
          varying vec2 vUv; varying float vPanel; varying vec3 vVp; varying float vPull;
          ${PULL_GLSL}
          void main() {
            vUv = uv; vPanel = aPanel;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            // read through the soil lip like the mains (pulled slightly less)
            vPull = encGalleryPull(wp.xyz + vec3(0.0, 0.0, 0.0), cameraPosition);
            vec4 vp = viewMatrix * wp;
            vVp = vp.xyz;
            gl_Position = projectionMatrix * vp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uFlow[8]; uniform float uTime; uniform float uOn; uniform mat4 projectionMatrix;
          varying vec2 vUv; varying float vPanel; varying vec3 vVp; varying float vPull;
          void main() {
            float dz = -vVp.z;
            vec3 pv = vVp * ((dz - min(9.0 * vPull, dz - 1.0)) / max(dz, 1.0));
            vec4 cp = projectionMatrix * vec4(pv, 1.0);
            gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
            int pi = int(vPanel + 0.5);
            float flow = 0.0;
            for (int i = 0; i < 8; i++) if (i == pi) flow = uFlow[i];
            float hgt = vUv.y;
            float top = 1.0 - smoothstep(0.0, 3.2, abs(hgt - 6.6));
            // fixture pools every 10 m along the wall
            float pool = pow(0.5 + 0.5 * cos(vUv.x * 6.2832 / 10.0), 3.0);
            vec3 fixture = vec3(0.62, 0.74, 0.95) * (0.02 + 0.08 * pool) * (0.3 + 0.7 * top);
            // cyan bounce from the main (centre ~3.2 m above the gallery floor)
            float band = exp(-pow((hgt - 3.3) / 1.9, 2.0));
            vec3 bounce = vec3(0.0, 0.62, 0.95) * band * (0.02 + 0.16 * flow);
            gl_FragColor = vec4((fixture + bounce) * uOn, 1.0);
          }`,
      }),
    [],
  );
  useFrame((state) => {
    const f = mat.uniforms.uFlow.value as Float32Array;
    pipeIdx.forEach((pi, i) => {
      const moving = pi >= 0 && live.pipeOpen[pi] === 1 && live.pipeDir[pi] !== 0 ? 1 : 0;
      f[i] += (moving - f[i]) * 0.08;
    });
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uOn.value = fx.water;
  });
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return (
    <>
      <mesh geometry={geo} material={mat} renderOrder={3} frustumCulled={false} />
      <UndergroundFittings />
    </>
  );
}

/** Fitting placements: [node, x, y, z, rotY] (valves: origin on the pipe axis, pipe along X). */
const FITTINGS: [string, number, number, number, number][] = [
  // PS-2: suction isolation (east of the chamber), discharge check + isolation (west, towards T2)
  ['gate-valve_v0', -143, -24, 152, 0],
  ['check-valve_v0', -176, -15, 152, 0],
  ['gate-valve_v0', -186, -15, 152, 0],
  // R1 clearwell outlets
  ['gate-valve_v0', 40, -24, 152, 0],
  ['gate-valve_v0', 72, -24, 152, 0],
  // PS-1: suction isolation (west of the chamber), discharge check + isolation (east, towards T1)
  ['gate-valve_v0', 84, -24, 152, 0],
  ['check-valve_v0', 116, -15, 152, 0],
  ['gate-valve_v0', 126, -15, 152, 0],
  // west gallery ring main
  ['gate-valve_v0', -242, -15, 40, Math.PI / 2],
  ['gate-valve_v0', -242, -15, -70, Math.PI / 2],
];

function UndergroundFittings() {
  const gltf = useKitFile('underground-kit.glb');
  const built = useMemo(() => {
    if (!gltf) return null;
    const meshes: InstancedMesh[] = [];
    const mats: Material[] = [];
    const nodes = [...new Set(FITTINGS.map((f) => f[0]))];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const name of nodes) {
      const node = gltf.scene.getObjectByName(name);
      if (!node) continue;
      const list = FITTINGS.filter((f) => f[0] === name);
      for (const mm of collectMeshes(node, gltf.scene)) {
        const m = (mm.material as MeshStandardMaterial).clone();
        m.vertexColors = !!mm.geometry.getAttribute('color');
        mats.push(m);
        const im = new InstancedMesh(mm.geometry, m, list.length);
        // node origin at the gltf root: drop the node's own placement, keep its local mesh offset
        const local = new Matrix4().copy(node.matrixWorld).invert().multiply(new Matrix4().multiplyMatrices(gltf.scene.matrixWorld, mm.matrix));
        list.forEach(([, x, y, z, r], i) => {
          q.setFromAxisAngle(up, r);
          im.setMatrixAt(i, new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(1, 1, 1)).multiply(local));
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false;
        meshes.push(im);
      }
    }
    return { meshes, mats };
  }, [gltf]);
  useEffect(() => () => built?.mats.forEach((m) => m.dispose()), [built]);
  const group = useRef(null);
  if (!built) return null;
  return (
    <group ref={group}>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
