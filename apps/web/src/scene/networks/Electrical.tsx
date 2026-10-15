/**
 * Electrical network overlay: glowing cable ribbons along the street routes, bus nodes,
 * switch glyphs and the fault marker. Colours, dashes and moving energy pulses come from the
 * shared lineTex / busTex (see data/stateTextures.ts) — pulses run ONLY on energized/restored
 * lines, in the direction of lineFlowKW, at a speed proportional to |flow|.
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
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { BUSES, CABLE_Y, LINES, N_LINE, pointAlong } from '../data/twin';
import { CODE, live } from '../data/live';
import { busTex, lineTex } from '../data/stateTextures';
import { fx } from '../runtime';
import { LIN } from '../config';
import { motionUniforms } from '../anim/motion';

const HALF_W = 3.2; // ribbon half-width (m) — core + halo are shaped in the shader

function ribbonGeometry() {
  const pos: number[] = [];
  const line: number[] = [];
  const sArr: number[] = [];
  const side: number[] = [];
  const lens: number[] = [];
  const idx: number[] = [];
  for (const l of LINES) {
    const pts = l.route;
    if (pts.length < 2) continue;
    const y = CABLE_Y + 0.05 + (l.id % 5) * 0.02;
    let s = 0;
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // miter direction
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let d1x = p[0] - a[0];
      let d1z = p[1] - a[1];
      let d2x = b[0] - p[0];
      let d2z = b[1] - p[1];
      const l1 = Math.hypot(d1x, d1z) || 1;
      const l2 = Math.hypot(d2x, d2z) || 1;
      d1x /= l1;
      d1z /= l1;
      d2x /= l2;
      d2z /= l2;
      if (i === 0) {
        d1x = d2x;
        d1z = d2z;
      }
      if (i === pts.length - 1) {
        d2x = d1x;
        d2z = d1z;
      }
      let nx = -(d1z + d2z);
      let nz = d1x + d2x;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      // miter length so the ribbon keeps its width around corners
      const cosHalf = Math.max(0.5, nx * -d1z + nz * d1x);
      const m = HALF_W / cosHalf;
      if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      pos.push(p[0] + nx * m, y, p[1] + nz * m, p[0] - nx * m, y, p[1] - nz * m);
      line.push(l.id, l.id);
      lens.push(l.length, l.length);
      sArr.push(s, s);
      side.push(1, -1);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLine', new BufferAttribute(new Float32Array(line), 1));
  g.setAttribute('aS', new BufferAttribute(new Float32Array(sArr), 1));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aLen', new BufferAttribute(new Float32Array(lens), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function cableMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: { uLineTex: { value: lineTex }, uTime: { value: 0 }, uOpacity: { value: 1 }, uDraw: motionUniforms.uDraw, uLayerLift: motionUniforms.uLayerLift, uPulse: motionUniforms.uPulse },
    vertexShader: /* glsl */ `
      attribute float aLine; attribute float aS; attribute float aSide; attribute float aLen;
      uniform float uLayerLift;
      varying float vLine; varying float vS; varying float vSide; varying float vLen;
      void main() {
        vLine = aLine; vS = aS; vSide = aSide; vLen = aLen;
        vec3 p = position;
        p.y += uLayerLift;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLineTex; uniform float uTime; uniform float uOpacity; uniform float uDraw; uniform vec2 uPulse;
      varying float vLine; varying float vS; varying float vSide; varying float vLen;
      void main() {
        // intro: the cable draws on along its route, with a bright leading spark
        float head = uDraw * (vLen + 12.0);
        if (vS > head) discard;
        float lead = (uDraw < 1.0) ? exp(-pow((head - vS) / 6.0, 2.0)) * 4.0 : 0.0;
        int li = int(vLine + 0.5);
        vec4 c0 = texelFetch(uLineTex, ivec2(li, 0), 0);
        vec4 c1 = texelFetch(uLineTex, ivec2(li, 1), 0);
        vec4 c2 = texelFetch(uLineTex, ivec2(li, 2), 0);
        float w = max(c2.r, 0.2);
        float a = abs(vSide) / w;
        float core = exp(-a * a * 26.0);
        float halo = exp(-a * a * 4.0) * 0.3;
        float dash = mix(1.0, step(0.42, fract(vS / 7.5)), c1.b);
        float k = fract((vS - c1.r) / 30.0);
        float kk = c2.a < 0.0 ? 1.0 - k : k;
        float pulse = pow(smoothstep(0.0, 0.82, kk) * (1.0 - smoothstep(0.82, 0.86, kk)), 4.0);
        float flow = c1.g;
        float fp = c1.a > 0.5 ? 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 7.0)) : 1.0;
        float rb = c2.g > 0.5 ? 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 4.0)) : 1.0;
        float inten = (core * (1.0 + flow * pulse * 3.0) + halo * (1.0 + flow * pulse * 1.2)) * dash * fp * rb;
        // restoration: a green energy pulse sweeps along every restored cable
        vec4 c3 = texelFetch(uLineTex, ivec2(li, 3), 0);
        float age = uTime - uPulse.x;
        float sweep = 0.0;
        if (c3.r > 0.5 && age > 0.0 && age < 4.5) {
          float d = (vS - age * 120.0) / 14.0;
          sweep = exp(-d * d) * (1.0 - age / 4.5) * (core * 5.0 + halo * 2.5);
        }
        vec3 col = c0.rgb * inten + vec3(0.2, 1.6, 0.7) * sweep + vec3(1.0, 0.85, 0.5) * lead * (core + halo);
        gl_FragColor = vec4(col * uOpacity, 1.0);
      }`,
  });
}

/** Instanced camera-facing glyphs (bus nodes, switches) drawn procedurally in the shader. */
function glyphMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uBusTex: { value: busTex }, uLayerLift: motionUniforms.uLayerLift, uPropT: motionUniforms.uPropT },
    vertexShader: /* glsl */ `
      attribute vec4 aGlyph;   // x, y, z, size
      attribute vec4 aColor;   // rgb, kind (0 bus node, 1 switch closed, 2 switch open, 3 hidden)
      attribute float aBus;
      uniform sampler2D uBusTex; uniform float uLayerLift; uniform float uPropT;
      varying vec2 vUv; varying vec4 vColor; varying vec4 vBus;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vColor = aColor;
        vBus = aBus >= 0.0 ? texelFetch(uBusTex, ivec2(int(aBus + 0.5), 0), 0) : vec4(0.0, 0.0, 1.0, 0.0);
        vec3 gpos = aGlyph.xyz;
        gpos.y += uLayerLift;
        vec4 mv = modelViewMatrix * vec4(gpos, 1.0);
        float sz = aColor.a > 2.5 ? 0.0 : aGlyph.w * clamp(uPropT / 0.5, 0.0, 1.0);
        mv.xy += position.xy * sz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity;
      varying vec2 vUv; varying vec4 vColor; varying vec4 vBus;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float kind = vColor.a;
        vec3 col = vColor.rgb;
        float a = 0.0;
        if (kind < 0.5) {
          // bus node: colour from bus state (powered amber / dark red / restored green flash)
          vec3 amber = vec3(${LIN.energized.r.toFixed(3)}, ${LIN.energized.g.toFixed(3)}, ${LIN.energized.b.toFixed(3)});
          vec3 red = vec3(${LIN.faulted.r.toFixed(3)}, ${LIN.faulted.g.toFixed(3)}, ${LIN.faulted.b.toFixed(3)});
          vec3 green = vec3(${LIN.restored.r.toFixed(3)}, ${LIN.restored.g.toFixed(3)}, ${LIN.restored.b.toFixed(3)});
          col = mix(amber, red * 0.6, vBus.r);
          col = mix(col, green, vBus.g);
          float dot0 = smoothstep(0.32, 0.22, r);
          float ring = smoothstep(0.08, 0.0, abs(r - 0.5)) * 0.6;
          float glow = exp(-r * r * 6.0) * 0.5;
          a = (dot0 * 2.4 + ring + glow) * mix(1.0, 0.35, vBus.r);
        } else {
          // switch glyph: ring + bar; open switches show a gap
          float ring = smoothstep(0.1, 0.0, abs(r - 0.78));
          float bar = step(abs(vUv.y), 0.12) * step(abs(vUv.x), 0.55);
          if (kind > 1.5) {
            // open: tilted bar with a gap
            vec2 q = mat2(0.82, -0.57, 0.57, 0.82) * vUv;
            bar = step(abs(q.y), 0.11) * step(-0.55, q.x) * step(q.x, 0.2);
            bar += step(length(vUv - vec2(0.42, 0.0)), 0.13);
          }
          float disc = smoothstep(0.95, 0.85, r) * 0.18;
          a = ring * 1.8 + bar * 2.2 + disc;
        }
        gl_FragColor = vec4(col * a * uOpacity, 1.0);
      }`,
  });
}

interface GlyphSpec {
  pos: [number, number, number];
  size: number;
  bus: number;
}

function glyphGeometry(specs: GlyphSpec[]) {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  const a = new Float32Array(specs.length * 4);
  const c = new Float32Array(specs.length * 4);
  const b = new Float32Array(specs.length);
  specs.forEach((s, i) => {
    a.set([s.pos[0], s.pos[1], s.pos[2], s.size], i * 4);
    c.set([1, 1, 1, 0], i * 4);
    b[i] = s.bus;
  });
  g.setAttribute('aGlyph', new InstancedBufferAttribute(a, 4));
  g.setAttribute('aColor', new InstancedBufferAttribute(c, 4));
  g.setAttribute('aBus', new InstancedBufferAttribute(b, 1));
  g.instanceCount = specs.length;
  return g;
}

/** Switch glyph anchor: near the "from" end for feeders, mid-span for ties. */
function switchAnchor(lineId: number): [number, number, number] {
  const l = LINES[lineId];
  const s = l.kind === 'tie' ? l.length / 2 : Math.min(l.length * 0.3, 26);
  const [x, z] = pointAlong(l.route, s);
  return [x, 7.5, z];
}

export function Electrical() {
  const ribbon = useMemo(() => ribbonGeometry(), []);
  const cableMat = useMemo(() => cableMaterial(), []);
  const nodeSpecs = useMemo<GlyphSpec[]>(
    () => BUSES.map((b) => ({ pos: [b.pos[0], 1.2, b.pos[1]] as [number, number, number], size: b.number === 1 ? 0 : 9, bus: b.index })),
    [],
  );
  const nodeGeo = useMemo(() => glyphGeometry(nodeSpecs), [nodeSpecs]);
  const switchSpecs = useMemo<GlyphSpec[]>(() => LINES.map((l) => ({ pos: switchAnchor(l.id), size: 7, bus: -1 })), []);
  const switchGeo = useMemo(() => glyphGeometry(switchSpecs), [switchSpecs]);
  const nodeMat = useMemo(() => glyphMaterial(), []);
  const switchMat = useMemo(() => glyphMaterial(), []);
  const seen = useRef(-1);
  const group = useRef<Group>(null);

  useEffect(
    () => () => {
      [ribbon, nodeGeo, switchGeo].forEach((g) => g.dispose());
      [cableMat, nodeMat, switchMat].forEach((m) => m.dispose());
    },
    [ribbon, nodeGeo, switchGeo, cableMat, nodeMat, switchMat],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const op = fx.electrical;
    cableMat.uniforms.uTime.value = t;
    cableMat.uniforms.uOpacity.value = op;
    nodeMat.uniforms.uTime.value = t;
    nodeMat.uniforms.uOpacity.value = op;
    switchMat.uniforms.uTime.value = t;
    switchMat.uniforms.uOpacity.value = op;
    if (group.current) group.current.visible = op > 0.01;

    if (seen.current !== live.version) {
      seen.current = live.version;
      const col = switchGeo.getAttribute('aColor') as InstancedBufferAttribute;
      const arr = col.array as Float32Array;
      const c = new Color();
      for (let i = 0; i < N_LINE; i++) {
        const l = LINES[i];
        const closed = live.switchClosedByLine[i] === 1;
        const normal = !l.normallyOpen;
        const inPlan = live.planSwitchLines.has(i);
        const code = live.lineCode[i];
        const show = l.kind === 'tie' || closed !== normal || inPlan || code === CODE.faulted || code === CODE.isolated;
        let kind = closed ? 1 : 2;
        if (!show) kind = 3;
        if (!closed) c.copy(code === CODE.isolated || code === CODE.faulted ? LIN.faulted : LIN.open).multiplyScalar(code === CODE.isolated ? 1.6 : 1.1);
        else if (code === CODE.restored) c.copy(LIN.restored).multiplyScalar(1.6);
        else if (code === CODE.restoring) c.copy(LIN.energized).multiplyScalar(1.4);
        else c.copy(LIN.energized).multiplyScalar(1.5);
        arr.set([c.r, c.g, c.b, kind], i * 4);
      }
      col.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={ribbon} material={cableMat} renderOrder={5} frustumCulled={false} />
      <mesh geometry={nodeGeo} material={nodeMat} renderOrder={6} frustumCulled={false} />
      <mesh geometry={switchGeo} material={switchMat} renderOrder={7} frustumCulled={false} />
      <FaultMarker />
    </group>
  );
}

/** Pulsing red ring + spark icon + light beam at the midpoint of the faulted line. */
function FaultMarker() {
  const ringMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        side: DoubleSide,
        uniforms: { uTime: { value: 0 }, uColor: { value: LIN.faulted.clone() }, uOn: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float a = 0.0;
            for (int i = 0; i < 3; i++) {
              float ph = fract(uTime * 0.6 + float(i) / 3.0);
              float rr = mix(0.12, 1.0, ph);
              a += smoothstep(0.06, 0.0, abs(r - rr)) * (1.0 - ph) * 1.6;
            }
            a += smoothstep(0.2, 0.0, r) * 1.2;
            gl_FragColor = vec4(uColor * a * uOn, 1.0);
          }`,
      }),
    [],
  );
  const beamMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        side: DoubleSide,
        uniforms: { uTime: { value: 0 }, uColor: { value: LIN.faulted.clone() }, uOn: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
          void main() {
            float x = abs(vUv.x - 0.5) * 2.0;
            float a = exp(-x * x * 9.0) * (1.0 - vUv.y) * (0.7 + 0.3 * sin(uTime * 7.0));
            gl_FragColor = vec4(uColor * a * 1.4 * uOn, 1.0);
          }`,
      }),
    [],
  );
  const sparkMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * 14.0; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uOn; varying vec2 vUv;
          float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            vec3 bg = vec3(0.86, 0.12, 0.1);
            float disc = smoothstep(1.0, 0.94, r);
            // lightning bolt
            vec2 p = vUv * 1.25;
            float d = min(min(sdSeg(p, vec2(0.18, 0.72), vec2(-0.22, 0.02)), sdSeg(p, vec2(-0.22, 0.02), vec2(0.2, 0.02))), sdSeg(p, vec2(0.2, 0.02), vec2(-0.16, -0.72)));
            float bolt = smoothstep(0.11, 0.07, d);
            vec3 col = mix(bg, vec3(1.0, 0.95, 0.85), bolt);
            float pulse = 0.85 + 0.15 * sin(uTime * 7.0);
            gl_FragColor = vec4(col * pulse * 1.6, disc * uOn);
          }`,
      }),
    [],
  );
  const ring = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const spark = useRef<Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    let idx = -1;
    for (let i = 0; i < N_LINE; i++) if (live.lineCode[i] === CODE.faulted) idx = i;
    const on = idx >= 0 ? 1 : 0;
    for (const m of [ringMat, beamMat, sparkMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uOn.value += (on - m.uniforms.uOn.value) * 0.1;
    }
    const vis = ringMat.uniforms.uOn.value > 0.01;
    if (idx >= 0) {
      const l = LINES[idx];
      const [x, z] = pointAlong(l.route, l.length / 2);
      const lift = motionUniforms.uLayerLift.value;
      ring.current?.position.set(x, CABLE_Y + 0.4 + lift, z);
      beam.current?.position.set(x, 30 + lift, z);
      spark.current?.position.set(x, 26 + lift, z);
    }
    if (ring.current) ring.current.visible = vis;
    if (beam.current) {
      beam.current.visible = vis;
      beam.current.lookAt(state.camera.position.x, 30, state.camera.position.z);
    }
    if (spark.current) spark.current.visible = vis;
  });

  return (
    <>
      <mesh ref={ring} material={ringMat} rotation-x={-Math.PI / 2} renderOrder={8}>
        <planeGeometry args={[46, 46]} />
      </mesh>
      <mesh ref={beam} material={beamMat} renderOrder={8}>
        <planeGeometry args={[7, 60]} />
      </mesh>
      <mesh ref={spark} material={sparkMat} renderOrder={20} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  );
}
