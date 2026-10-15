/**
 * Orchestrates scene motion (see motion.ts):
 *  - intro assembly on first load once the asset kit is ready, replayed on every store.introNonce bump
 *    (with a gentle camera push-in on the first load);
 *  - exploded underground view driven by layers.underground;
 *  - fault / restore moments detected from frame state transitions (shockwave + sparks + red ripple +
 *    tile jolt at a fault; green cable pulse + green ripple + tile lift on restoration).
 * Also hosts <DistrictRig> (platform rise) and <Bursts> (shockwave rings / spark bursts).
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, type DirectionalLight, DoubleSide, type Group, type Mesh, type Points, ShaderMaterial } from 'three';
import type { CameraControls } from '@react-three/drei';
import { useTwin } from '@/state/store';
import { BUILDINGS, LINES, N_BUS, N_LINE, pointAlong } from '../data/twin';
import { CODE, live } from '../data/live';
import { fx } from '../runtime';
import { useKitSignature } from '../assets/kit';
import { KIT_BUILDING_FILES } from '../buildings/KitBuildings';
import { SHOTS } from '../camera/shots';
import { INTRO, armIntro, kickTiles, motion, motionUniforms, setExplode, startIntro, tileAt, updateMotion } from './motion';

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const SKIP_INTRO = params.get('intro') === '0';

/** bus index → tiles holding buildings supplied by it */
const BUS_TILES: Set<number>[] = Array.from({ length: N_BUS }, () => new Set<number>());
for (const b of BUILDINGS) if (b.busIndex >= 0) BUS_TILES[b.busIndex].add(tileAt(b.pos[0], b.pos[1]));

// ───────────────────────────────────────────── bursts (shockwave ring + sparks)
interface Burst {
  x: number;
  z: number;
  t0: number;
  kind: number; // 1 fault, 2 restore
}
const bursts: Burst[] = [];
export function fireBurst(x: number, z: number, kind: number) {
  if (motion.reduced) return;
  bursts.push({ x, z, t0: motion.time, kind });
  while (bursts.length > 2) bursts.shift();
}

const N_SPARK = 110;
function sparkGeometry() {
  const seed = new Float32Array(N_SPARK * 4);
  for (let i = 0; i < N_SPARK; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 0.35 + Math.random() * 0.65;
    const sp = 18 + Math.random() * 38;
    seed.set([Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5), Math.random()], i * 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(N_SPARK * 3), 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 4));
  return g;
}

function Bursts() {
  const ringMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
        uniforms: { uAge: { value: 99 }, uKind: { value: 1 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uAge; uniform float uKind; varying vec2 vP;
          void main() {
            float r = length(vP);
            float R = uAge * 95.0;
            float w = 3.5 + uAge * 9.0;
            float ring = exp(-pow((r - R) / w, 2.0));
            float inner = exp(-pow((r - R * 0.6) / (w * 1.6), 2.0)) * 0.35;
            float flash = exp(-r * r / 60.0) * exp(-uAge * 5.0) * 3.0;
            float fade = 1.0 - smoothstep(0.6, 1.6, uAge);
            vec3 c = uKind < 1.5 ? vec3(1.0, 0.25, 0.1) : vec3(0.2, 1.0, 0.5);
            gl_FragColor = vec4(c * (ring * 2.8 + inner * 1.2 + flash) * fade, 1.0);
          }`,
      }),
    [],
  );
  const sparkMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        uniforms: { uAge: { value: 99 }, uKind: { value: 1 }, uOrigin: { value: [0, 0, 0] } },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed; uniform float uAge; uniform vec3 uOrigin; varying float vLife;
          void main() {
            float t = uAge * (0.8 + aSeed.w * 0.5);
            vec3 p = uOrigin + aSeed.xyz * t + vec3(0.0, -24.0, 0.0) * t * t;
            p.y = max(p.y, uOrigin.y);
            vLife = clamp(1.0 - t / 1.4, 0.0, 1.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (6.0 + 9.0 * vLife) * (520.0 / max(-mv.z, 1.0));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uKind; varying float vLife;
          void main() {
            vec2 d = gl_PointCoord * 2.0 - 1.0;
            float a = exp(-dot(d, d) * 3.0) * vLife;
            vec3 c = uKind < 1.5 ? mix(vec3(1.0, 0.3, 0.1), vec3(1.0, 0.85, 0.5), vLife) : mix(vec3(0.2, 1.0, 0.5), vec3(0.8, 1.0, 0.85), vLife);
            gl_FragColor = vec4(c * a * 2.5, 1.0);
          }`,
      }),
    [],
  );
  const sparkGeo = useMemo(() => sparkGeometry(), []);
  const ring = useRef<Mesh>(null);
  const sparks = useRef<Points>(null);
  useEffect(
    () => () => {
      ringMat.dispose();
      sparkMat.dispose();
      sparkGeo.dispose();
    },
    [ringMat, sparkMat, sparkGeo],
  );
  useFrame(() => {
    const b = bursts[bursts.length - 1];
    const age = b ? motion.time - b.t0 : 99;
    const on = !!b && age < 2.2;
    const lift = motionUniforms.uLayerLift.value;
    if (ring.current) {
      ring.current.visible = on;
      if (b) ring.current.position.set(b.x, 1.2 + lift, b.z);
    }
    if (sparks.current) {
      sparks.current.visible = on && b.kind === 1;
      if (b) sparkMat.uniforms.uOrigin.value = [b.x, 2 + lift, b.z];
    }
    ringMat.uniforms.uAge.value = age;
    ringMat.uniforms.uKind.value = b?.kind ?? 1;
    sparkMat.uniforms.uAge.value = age;
    sparkMat.uniforms.uKind.value = b?.kind ?? 1;
  });
  return (
    <>
      <mesh ref={ring} material={ringMat} rotation-x={-Math.PI / 2} renderOrder={22} frustumCulled={false} visible={false}>
        <planeGeometry args={[320, 320]} />
      </mesh>
      <points ref={sparks} geometry={sparkGeo} material={sparkMat} renderOrder={23} frustumCulled={false} visible={false} />
    </>
  );
}

// ───────────────────────────────────────────── district rig (platform rise)
export function DistrictRig({ children }: { children: ReactNode }) {
  const g = useRef<Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const p = motion.platform;
    // rises from below with a small overshoot
    const s = 1.4;
    const u = p - 1;
    const e = p >= 1 ? 1 : 1 + (s + 1) * u * u * u + s * u * u;
    g.current.position.y = -150 * (1 - e);
    g.current.visible = motion.introT >= 0;
  });
  return (
    <group ref={g}>
      {children}
      <Bursts />
    </group>
  );
}

// ───────────────────────────────────────────── director
export function MotionDirector() {
  const kitSig = useKitSignature(KIT_BUILDING_FILES);
  const kitReady = kitSig.startsWith('ready:') || kitSig === 'missing';
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const armedAt = useRef(-1);
  const firstDone = useRef(false);
  const lastNonce = useRef(useTwin.getState().introNonce);
  const sun = useRef<DirectionalLight | null>(null);
  const shadowK = useRef(1);
  const wasMoving = useRef(false);
  const prev = useMemo(
    () => ({ version: -1, run: null as unknown, line: new Uint8Array(N_LINE), bus: new Uint8Array(N_BUS) }),
    [],
  );

  // arm the first-load intro (hidden until the kit is ready)
  useEffect(() => {
    if (!SKIP_INTRO) armIntro();
  }, []);

  // replay on every introNonce bump
  useEffect(
    () =>
      useTwin.subscribe((s) => {
        if (s.introNonce !== lastNonce.current) {
          lastNonce.current = s.introNonce;
          firstDone.current = true;
          startIntro();
        }
      }),
    [],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // first-load intro: wait for the kit (or 8 s), then assemble with a camera push-in
    if (!firstDone.current && !SKIP_INTRO) {
      if (armedAt.current < 0) armedAt.current = t;
      if ((kitReady && fx.frames > 8) || t - armedAt.current > 8) {
        firstDone.current = true;
        startIntro();
        if (!motion.reduced) {
          const controls = get().controls as unknown as CameraControls | null;
          const h = SHOTS.home;
          if (controls && !useTwin.getState().camera.request) {
            const [px, py, pz] = h.position;
            const [tx, ty, tz] = h.target;
            controls.setLookAt(tx + (px - tx) * 1.45, ty + (py - ty) * 1.55, tz + (pz - tz) * 1.45, tx, ty, tz, false);
            useTwin.getState().requestCamera({ shot: 'home', durationS: INTRO.duration });
          }
        }
      }
    }
    setExplode(useTwin.getState().layers.underground);
    detectEvents(t);
    updateMotion(t, dt);

    // shadows are cast from rest positions: fade them out while the district moves
    if (!sun.current) scene.traverse((o) => {
      if ((o as DirectionalLight).isDirectionalLight && o.castShadow) sun.current = o as DirectionalLight;
    });
    // re-render the shadow map from the rest pose as soon as everything has settled
    if (wasMoving.current && !motion.moving) state.gl.shadowMap.needsUpdate = true;
    wasMoving.current = motion.moving;
    const target = motion.moving ? 0 : 1;
    shadowK.current += (target - shadowK.current) * Math.min(1, dt * (target > shadowK.current ? 2.5 : 8));
    if (sun.current) sun.current.shadow.intensity = shadowK.current;
  }, -9);

  function detectEvents(t: number) {
    if (live.version === prev.version) return;
    const runChanged = live.run !== prev.run;
    prev.version = live.version;
    prev.run = live.run;
    if (!runChanged && live.hasRun) {
      // fault: a line newly in the faulted state
      let faultLine = -1;
      for (let i = 0; i < N_LINE; i++) if (live.lineCode[i] === CODE.faulted && prev.line[i] !== CODE.faulted) faultLine = i;
      const darkTiles = new Set<number>();
      const restoredTiles = new Set<number>();
      let rx = 0;
      let rz = 0;
      let rn = 0;
      for (let b = 0; b < N_BUS; b++) {
        const c = live.busCode[b];
        if (c === CODE.deenergized && prev.bus[b] !== CODE.deenergized) BUS_TILES[b].forEach((x) => darkTiles.add(x));
        if (c === CODE.restored && prev.bus[b] !== CODE.restored) {
          BUS_TILES[b].forEach((x) => restoredTiles.add(x));
          const bp = BUILDINGS.find((q) => q.busIndex === b);
          if (bp) {
            rx += bp.pos[0];
            rz += bp.pos[1];
            rn++;
          }
        }
      }
      if (faultLine >= 0) {
        const l = LINES[faultLine];
        const [x, z] = pointAlong(l.route, l.length / 2);
        fireBurst(x, z, 1);
        if (!motion.reduced) motionUniforms.uRipple.value = [x, z, t, 1];
        darkTiles.add(tileAt(x, z));
        kickTiles(darkTiles, -9, 0.9);
      } else if (darkTiles.size) kickTiles(darkTiles, -6, 0.5);
      if (restoredTiles.size) {
        kickTiles(restoredTiles, 11, 0.25);
        if (!motion.reduced) {
          motionUniforms.uPulse.value = [t, 1];
          if (rn) {
            motionUniforms.uRipple.value = [rx / rn, rz / rn, t, 2];
            fireBurst(rx / rn, rz / rn, 2);
          }
        }
      }
    }
    prev.line.set(live.lineCode);
    prev.bus.set(live.busCode);
  }

  return null;
}
