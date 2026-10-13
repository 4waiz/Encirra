/**
 * Water network: metallic pipes along district.json routes (radius exaggerated from diameterMM)
 * with a glowing flow layer (intensity ∝ flow, pressure colour on distribution mains, moving
 * dashes along the sign of pipeFlowLps, speed ∝ velocity), direction chevrons on the gallery
 * mains, pump assemblies with status glow / red X, boundary valves and the R1 clearwell.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { JUNCTIONS, PIPES, PUMPS, RESERVOIRS, pipeRadius } from '../data/twin';
import { live } from '../data/live';
import { pipeTex } from '../data/stateTextures';
import { fx } from '../runtime';
import { buildTubes, type TubeSpec } from '../lib/tubes';
import { GeoBuilder, lin } from '../lib/GeoBuilder';
import { LIN } from '../config';
import { useKitSignature } from '../assets/kit';

/**
 * Cut-away reveal: the gallery mains sit ~8 m behind the cut face under a soil lip. When the camera
 * is outside that face (and not looking steeply down) their glow is depth-pulled towards the camera
 * so it reads through the lip, without leaking through the district surface or the block itself.
 */
export const PULL_GLSL = /* glsl */ `
float encGalleryPull(vec3 wp, vec3 camPos) {
  vec3 V = normalize(wp - camPos);
  float steep = 1.0 - smoothstep(0.72, 0.93, -V.y);
  float front = step(146.0, wp.z) * step(wp.y, -8.0) * smoothstep(0.12, 0.45, -V.z) * step(wp.z, camPos.z);
  float west = step(wp.x, -235.0) * step(wp.y, -8.0) * smoothstep(0.12, 0.45, V.x) * step(camPos.x, wp.x);
  return max(front, west) * steep;
}
`;

const tubeSpecs: TubeSpec[] = PIPES.map((p) => ({ id: p.index, points: p.route, radius: pipeRadius(p.diameterMM, p.kind) }));

function flowMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uPipeTex: { value: pipeTex }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aId; attribute float aS; attribute float aAround;
      varying float vId; varying float vS; varying vec3 vN; varying vec3 vV; varying vec3 vVp; varying float vPull;
      ${PULL_GLSL}
      void main() {
        vId = aId; vS = aS;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vec4 vp = viewMatrix * wp;
        vVp = vp.xyz;
        vPull = encGalleryPull(wp.xyz, cameraPosition);
        gl_Position = projectionMatrix * vp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPipeTex; uniform float uTime; uniform float uOpacity; uniform mat4 projectionMatrix;
      varying float vId; varying float vS; varying vec3 vN; varying vec3 vV; varying vec3 vVp; varying float vPull;
      void main() {
        // depth pull (see encGalleryPull): move the fragment up to 13 m towards the camera
        float dz = -vVp.z;
        vec3 pv = vVp * ((dz - min(13.0 * vPull, dz - 1.0)) / max(dz, 1.0));
        vec4 cp = projectionMatrix * vec4(pv, 1.0);
        gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
        int pi = int(vId + 0.5);
        vec4 c0 = texelFetch(uPipeTex, ivec2(pi, 0), 0);
        vec4 c1 = texelFetch(uPipeTex, ivec2(pi, 1), 0);
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(facing, 1.6);
        float rim = pow(1.0 - facing, 3.0) * 0.35;
        float dir = c1.a < 0.0 ? -1.0 : 1.0;
        float k = fract((vS - c1.r) / 8.0);
        float kk = dir > 0.0 ? k : 1.0 - k;
        float dash = pow(smoothstep(0.05, 0.62, kk) * (1.0 - smoothstep(0.62, 0.7, kk)), 2.0);
        float inten = (body * (0.62 + 1.9 * dash * c1.g) + rim * 0.5) * (1.0 + 0.35 * vPull);
        gl_FragColor = vec4(c0.rgb * inten * uOpacity, 1.0);
      }`,
  });
}

/** Chevrons on the visible gallery mains, pointing along the flow. */
const ARROW_PIPES = ['S-R1-PS2', 'S-R1-PS1', 'P-PS2D-T2C', 'P-PS1D-T1C', 'P-T2C-WR', 'P-PS2D-B4', 'P-PS1D-D4', 'P-T1C-F4', 'P-T2C-A4'];
function arrowGeometry() {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  const pos: number[] = [];
  const axis: number[] = [];
  const out: number[] = [];
  const meta: number[] = [];
  for (const p of PIPES) {
    if (!ARROW_PIPES.includes(p.id)) continue;
    const r = pipeRadius(p.diameterMM, p.kind);
    let s = 0;
    for (let i = 0; i < p.route.length - 1; i++) {
      const a = p.route[i];
      const b = p.route[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      // outward normal: towards the open face of the gallery (south or west)
      const west = Math.abs(a[0] + 242) < 2 && Math.abs(b[0] + 242) < 2;
      let ox = west ? -1 : 0;
      let oz = west ? 0 : 1;
      if (Math.abs(uz) > 0.9) {
        ox = -1;
        oz = 0;
      }
      for (let t = 6; t < len - 4; t += 13) {
        pos.push(a[0] + ux * t + ox * (r + 0.35), a[1] + uy * t + 0.15, a[2] + uz * t + oz * (r + 0.35));
        axis.push(ux, uy, uz);
        out.push(ox, 0, oz);
        meta.push(p.index, s + t, r * 1.5, 0);
      }
      s += len;
    }
  }
  const n = pos.length / 3;
  g.setAttribute('aPos', new InstancedBufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aAxis', new InstancedBufferAttribute(new Float32Array(axis), 3));
  g.setAttribute('aOut', new InstancedBufferAttribute(new Float32Array(out), 3));
  g.setAttribute('aMeta', new InstancedBufferAttribute(new Float32Array(meta), 4));
  g.instanceCount = n;
  return g;
}

function arrowMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: { uPipeTex: { value: pipeTex }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec3 aAxis; attribute vec3 aOut; attribute vec4 aMeta;
      uniform sampler2D uPipeTex;
      varying vec2 vUv; varying vec4 vC0; varying vec4 vC1; varying float vS; varying vec3 vVp; varying float vPull;
      ${PULL_GLSL}
      void main() {
        int pi = int(aMeta.x + 0.5);
        vC0 = texelFetch(uPipeTex, ivec2(pi, 0), 0);
        vC1 = texelFetch(uPipeTex, ivec2(pi, 1), 0);
        vS = aMeta.y;
        float dir = vC1.a < 0.0 ? -1.0 : 1.0;
        vec3 ax = normalize(aAxis) * dir;
        vec3 side = normalize(cross(aOut, ax));
        float size = aMeta.z * 2.2;
        vUv = uv * 2.0 - 1.0;
        vec3 p = aPos + ax * position.x * size + side * position.y * size;
        vPull = encGalleryPull(p, cameraPosition);
        vec4 vp = viewMatrix * vec4(p, 1.0);
        vVp = vp.xyz;
        gl_Position = projectionMatrix * vp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity; uniform mat4 projectionMatrix;
      varying vec2 vUv; varying vec4 vC0; varying vec4 vC1; varying float vS; varying vec3 vVp; varying float vPull;
      void main() {
        float dz = -vVp.z;
        vec3 pv = vVp * ((dz - min(13.0 * vPull, dz - 1.0)) / max(dz, 1.0));
        vec4 cp = projectionMatrix * vec4(pv, 1.0);
        gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
        // chevron pointing to +x
        vec2 p = vUv;
        float chev = smoothstep(0.24, 0.12, abs(p.x + abs(p.y) * 0.95 - 0.35)) * step(abs(p.y), 0.75) * step(-0.75, p.x);
        float dir = vC1.a < 0.0 ? -1.0 : 1.0;
        float k = fract((vS * dir - vC1.r * dir) / 13.0 / 3.0);
        float travel = 0.55 + 0.45 * smoothstep(0.0, 0.3, k) * (1.0 - smoothstep(0.3, 0.6, k));
        float a = chev * travel * vC1.g * 1.8;
        gl_FragColor = vec4(vC0.rgb * a * uOpacity, 1.0);
        if (a < 0.002) discard;
      }`,
  });
}

/** Pump assemblies, R1 clearwell and boundary valves (static geometry). */
function equipmentGeometry() {
  const metal = new GeoBuilder();
  const dark = new GeoBuilder();
  const cBody = lin('#5F7C8C');
  const cMotor = lin('#3D4A54');
  const cBase = lin('#8E8C88');
  for (const pu of PUMPS) {
    const j = JUNCTIONS.find((q) => q.id === pu.to)!;
    const [x, , z] = j.pos;
    metal.frame(x, 0, z, 0);
    dark.frame(x, 0, z, 0);
    // plinth
    dark.box(0, 3, 7, 7, -28.5, -26.8, { color: cBase });
    // volute casing + column
    metal.prism(0, 0, 2.5, -23.2, -19.6, 18, { color: cBody, roofColor: cBody });
    metal.prism(0, 0, 1.35, -26.8, -23.2, 14, { color: cBody });
    // motor (horizontal, towards the gallery opening)
    dark.box(0, 4.2, 2.6, 4.6, -22.8, -20.0, { color: cMotor });
    dark.box(0, 6.8, 2.0, 0.6, -22.4, -20.4, { color: lin('#2A3138') });
    // discharge flange stack
    metal.prism(0, 0, 1.7, -19.6, -17.6, 14, { color: lin('#6B8796') });
  }
  // R1 clearwell saddles
  const r1 = RESERVOIRS[0];
  dark.frame(r1.pos[0], 0, r1.pos[2], 0);
  for (const sx of [-10, 0, 10]) dark.box(sx, 0, 2.2, 7.5, -28.5, -24.5, { color: cBase });
  return { metal: metal.build(), dark: dark.build() };
}

function clearwellGeometry() {
  // horizontal cylinder along x: built by rotating a prism (x ↔ y) manually
  const g = new BufferGeometry();
  const r = 4.2;
  const L = 30;
  const seg = 28;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    const cy = Math.cos(a);
    const cz = Math.sin(a);
    pos.push(-L / 2, cy * r, cz * r, L / 2, cy * r, cz * r);
    nor.push(0, cy, cz, 0, cy, cz);
  }
  for (let k = 0; k < seg; k++) {
    const i = k * 2;
    idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  // end caps
  for (const sx of [-1, 1]) {
    const c = pos.length / 3;
    pos.push((sx * L) / 2, 0, 0);
    nor.push(sx, 0, 0);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push((sx * L) / 2, Math.cos(a) * r, Math.sin(a) * r);
      nor.push(sx, 0, 0);
    }
    for (let k = 0; k < seg; k++) sx > 0 ? idx.push(c, c + 1 + k, c + 2 + k) : idx.push(c, c + 2 + k, c + 1 + k);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

export function WaterNetwork() {
  const pipeGeo = useMemo(() => buildTubes(tubeSpecs, 14, true, 1), []);
  const flowGeo = useMemo(() => buildTubes(tubeSpecs, 14, true, 1.07), []);
  const pipeMat = useMemo(() => new MeshStandardMaterial({ color: '#8E9AA3', metalness: 0.78, roughness: 0.32, envMapIntensity: 1.2 }), []);
  const flowMat = useMemo(() => flowMaterial(), []);
  const arrowGeo = useMemo(() => arrowGeometry(), []);
  const arrowMat = useMemo(() => arrowMaterial(), []);
  const equip = useMemo(() => equipmentGeometry(), []);
  const equipMetal = useMemo(() => new MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.35 }), []);
  const equipDark = useMemo(() => new MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.6 }), []);
  const clearwell = useMemo(() => clearwellGeometry(), []);
  const clearwellMat = useMemo(
    () => new MeshStandardMaterial({ color: '#9FB4BF', metalness: 0.6, roughness: 0.25, transparent: true, opacity: 0.55, emissive: new Color(LIN.water).multiplyScalar(0.35), depthWrite: false }),
    [],
  );
  const group = useRef<Group>(null);

  useEffect(
    () => () => {
      [pipeGeo, flowGeo, arrowGeo, equip.metal, equip.dark, clearwell].forEach((g) => g.dispose());
      [pipeMat, flowMat, arrowMat, equipMetal, equipDark, clearwellMat].forEach((m) => m.dispose());
    },
    [pipeGeo, flowGeo, arrowGeo, equip, clearwell, pipeMat, flowMat, arrowMat, equipMetal, equipDark, clearwellMat],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const op = fx.water;
    flowMat.uniforms.uTime.value = t;
    flowMat.uniforms.uOpacity.value = op;
    arrowMat.uniforms.uTime.value = t;
    arrowMat.uniforms.uOpacity.value = op;
    if (group.current) group.current.visible = op > 0.01;
  });

  const r1 = RESERVOIRS[0];
  const kitPumps = useKitSignature(['pump-station.glb']) === 'ready:pump-station.glb';
  const kitDesal = useKitSignature(['desalination-inlet.glb']) === 'ready:desalination-inlet.glb';
  return (
    <group ref={group}>
      <mesh geometry={pipeGeo} material={pipeMat} castShadow receiveShadow />
      <mesh geometry={flowGeo} material={flowMat} renderOrder={4} />
      <mesh geometry={arrowGeo} material={arrowMat} renderOrder={9} frustumCulled={false} />
      {!kitPumps && <mesh geometry={equip.metal} material={equipMetal} castShadow receiveShadow />}
      {!kitPumps && <mesh geometry={equip.dark} material={equipDark} castShadow receiveShadow />}
      {!kitDesal && <mesh geometry={clearwell} material={clearwellMat} position={[r1.pos[0], r1.pos[1] + 2.4, r1.pos[2]]} renderOrder={3} />}
      <PumpStatus />
      <Valves />
    </group>
  );
}

/** Status ring around each pump volute (cyan running, red stopped) and a red X when off. */
function PumpStatus() {
  const pumps = useMemo(() => PUMPS.map((pu) => JUNCTIONS.find((q) => q.id === pu.to)!.pos), []);
  const ringMat = useMemo(() => pumps.map(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color(LIN.water), emissiveIntensity: 2.5, toneMapped: true })), [pumps]);
  const xMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * 9.0; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float ring = smoothstep(0.12, 0.04, abs(r - 0.8));
            vec2 q = abs(mat2(0.7071, -0.7071, 0.7071, 0.7071) * vUv);
            float cross = step(q.y, 0.1) * step(q.x, 0.52) + step(q.x, 0.1) * step(q.y, 0.52);
            float disc = smoothstep(1.0, 0.92, r) * 0.55;
            vec3 col = vec3(0.94, 0.27, 0.22) * (ring + min(cross, 1.0)) * 1.8 + vec3(0.12, 0.02, 0.02) * disc;
            float a = max(max(ring, min(cross, 1.0)), disc);
            gl_FragColor = vec4(col * (0.85 + 0.15 * sin(uTime * 6.0)), a);
          }`,
      }),
    [],
  );
  const rings = useRef<(Mesh | null)[]>([]);
  const xs = useRef<(Mesh | null)[]>([]);
  const torus = useMemo(() => new TorusGeometry(2.9, 0.22, 8, 40), []);
  useEffect(() => () => {
    ringMat.forEach((m) => m.dispose());
    xMat.dispose();
    torus.dispose();
  }, [ringMat, xMat, torus]);

  useFrame((state) => {
    xMat.uniforms.uTime.value = state.clock.elapsedTime;
    pumps.forEach((_, i) => {
      const on = live.pumpOn[i] === 1;
      const target = on ? LIN.water : LIN.faulted;
      const m = ringMat[i];
      m.emissive.lerp(target, 0.1);
      m.emissiveIntensity = on ? 2.4 : 2.0 + Math.sin(state.clock.elapsedTime * 6) * 0.8;
      const x = xs.current[i];
      if (x) x.visible = !on;
    });
  });

  return (
    <>
      {pumps.map((p, i) => (
        <group key={i} position={[p[0], 0, p[2]]}>
          <mesh ref={(m) => (rings.current[i] = m)} geometry={torus} material={ringMat[i]} position={[0, -21.4, 0]} rotation-x={Math.PI / 2} />
          <mesh ref={(m) => (xs.current[i] = m)} material={xMat} position={[0, -9, 6]} renderOrder={21} frustumCulled={false}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Boundary isolation valves BV-1…4: red rings when closed, green when open. */
function Valves() {
  const valves = useMemo(() => PIPES.filter((p) => p.kind === 'boundary'), []);
  const mats = useMemo(() => valves.map(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color(LIN.faulted), emissiveIntensity: 2.2 })), [valves]);
  const geo = useMemo(() => new TorusGeometry(1.35, 0.28, 8, 32), []);
  const wheel = useMemo(() => new TorusGeometry(0.9, 0.12, 6, 20), []);
  useEffect(() => () => {
    mats.forEach((m) => m.dispose());
    geo.dispose();
    wheel.dispose();
  }, [mats, geo, wheel]);
  useFrame(() => {
    valves.forEach((v, i) => {
      const open = live.pipeOpen[v.index] === 1;
      mats[i].emissive.lerp(open ? LIN.restored : LIN.faulted, 0.12);
    });
  });
  return (
    <>
      {valves.map((v, i) => {
        const a = v.route[0];
        const b = v.route[v.route.length - 1];
        const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
        return (
          <group key={v.id} position={mid}>
            <mesh geometry={geo} material={mats[i]} rotation-y={alongX ? Math.PI / 2 : 0} />
            <mesh geometry={wheel} material={mats[i]} position={[0, 1.9, 0]} rotation-x={Math.PI / 2} />
          </group>
        );
      })}
    </>
  );
}
