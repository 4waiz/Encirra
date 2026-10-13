/**
 * Facility hero details (procedural): hospital cross + signage + helipad, substation equipment
 * yard (transformers, gantries, energised busbars), elevated water towers whose water level
 * follows water.tankPct, desalination ground tanks and the EOC communications mast.
 * The main facility volumes are part of the merged building mesh (window shader + power state).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Color, DoubleSide, type Mesh, MeshBasicMaterial, MeshStandardMaterial, CylinderGeometry, TorusGeometry, CircleGeometry, RingGeometry } from 'three';
import { useTwin } from '@/state/store';
import { BUILDING_BY_FACILITY, FACILITY_BY_ID, SURFACE_ELEV, TANKS } from '../data/twin';
import { isPowered, live } from '../data/live';
import { GeoBuilder, lin } from '../lib/GeoBuilder';
import { createTextTexture } from '../district/textures';
import { LIN } from '../config';
import { fx } from '../runtime';

const C = {
  steel: lin('#8C969E'),
  steelDark: lin('#4E5860'),
  white: lin('#EEF0F0'),
  conc: lin('#B7B2A8'),
  trafo: lin('#5D6B5F'),
  porcelain: lin('#C9B9A3'),
  tank: lin('#D9DDE0'),
  red: lin('#C81E1E'),
};

function substationGeometry() {
  const g = new GeoBuilder();
  const e = new GeoBuilder(); // energised conductors
  g.frame(0, 0, 0, 0);
  e.frame(0, 0, 0, 0);
  // concrete pads
  g.box(4, 6, 46, 10, 0, 0.4, { color: C.conc });
  // transformers
  for (const x of [-14, 2, 18]) {
    g.box(x, 6, 7, 5, 0.4, 6, { color: C.trafo, roofColor: C.trafo });
    for (let k = -2; k <= 2; k++) {
      g.box(x + k * 1.2, 6 + 3.1, 0.25, 1.2, 0.8, 5.6, { color: C.steelDark });
      g.box(x + k * 1.2, 6 - 3.1, 0.25, 1.2, 0.8, 5.6, { color: C.steelDark });
    }
    g.prism(x - 2.5, 6, 0.9, 6, 7.2, 10, { color: C.trafo });
    for (const bx of [-1.8, 0, 1.8]) {
      g.prism(x + bx, 6, 0.32, 6, 9.6, 8, { color: C.porcelain });
      for (let d = 0; d < 6; d++) g.prism(x + bx, 6, 0.55, 6.4 + d * 0.5, 6.55 + d * 0.5, 8, { color: C.porcelain });
      e.prism(x + bx, 6, 0.18, 9.6, 11.5, 6, { color: [1, 1, 1] });
    }
  }
  // gantries (portal frames)
  for (const z of [-8, 20]) {
    for (const x of [-26, -9, 9, 26]) {
      g.beam([x - 0.6, 0, z - 0.6], [x - 0.3, 13, z - 0.3], 0.45, { color: C.steel });
      g.beam([x + 0.6, 0, z + 0.6], [x + 0.3, 13, z + 0.3], 0.45, { color: C.steel });
      g.beam([x - 0.6, 0, z + 0.6], [x + 0.6, 6.5, z - 0.6], 0.2, { color: C.steel });
    }
    g.beam([-27, 13, z], [27, 13, z], 0.7, { color: C.steel });
    g.beam([-27, 11.8, z], [27, 11.8, z], 0.35, { color: C.steel });
    // three busbar conductors
    for (const dz of [-1.4, 0, 1.4]) e.beam([-26, 12.2, z + dz], [26, 12.2, z + dz], 0.32, { color: [1, 1, 1] });
  }
  // droppers from busbars to transformers
  for (const x of [-14, 2, 18]) for (const dz of [-1.4, 0, 1.4]) e.beam([x + dz, 12.2, -8 + dz], [x + dz, 11.5, 6], 0.16, { color: [1, 1, 1] });
  // breakers row
  for (let x = -24; x <= 24; x += 6) {
    g.box(x, 26, 1.6, 1.6, 0, 3.4, { color: C.steelDark });
    g.prism(x, 26, 0.3, 3.4, 6.5, 8, { color: C.porcelain });
  }
  // fence
  const W = 31;
  const D = 29;
  for (let x = -W; x <= W; x += 4) {
    g.box(x, -D, 0.18, 0.18, 0, 2.6, { color: C.steelDark });
    g.box(x, D, 0.18, 0.18, 0, 2.6, { color: C.steelDark });
  }
  for (let z = -D; z <= D; z += 4) {
    g.box(-W, z, 0.18, 0.18, 0, 2.6, { color: C.steelDark });
    g.box(W, z, 0.18, 0.18, 0, 2.6, { color: C.steelDark });
  }
  for (const y of [1.2, 2.5]) {
    g.beam([-W, y, -D], [W, y, -D], 0.08, { color: C.steelDark });
    g.beam([-W, y, D], [W, y, D], 0.08, { color: C.steelDark });
    g.beam([-W, y, -D], [-W, y, D], 0.08, { color: C.steelDark });
    g.beam([W, y, -D], [W, y, D], 0.08, { color: C.steelDark });
  }
  return { equip: g.build(), live: e.build() };
}

function desalGeometry() {
  const g = new GeoBuilder();
  const f = FACILITY_BY_ID.get('desal-r1')!;
  g.frame(f.pos[0], 0, f.pos[1], 0);
  const tanks: [number, number, number, number][] = [
    [-15, 3, 6.2, 12],
    [-1.5, 4, 5.6, 10.5],
    [10, 5, 3.8, 8],
  ];
  for (const [x, z, r, h] of tanks) {
    g.prism(x, z, r, 0, h, 28, { color: C.tank, roofColor: C.tank, top: false });
    g.prism(x, z, r, h, h + r * 0.35, 28, { color: C.tank, r1: r * 0.2, roofColor: C.tank });
    for (let k = 1; k < 4; k++) g.prism(x, z, r + 0.08, (h * k) / 4, (h * k) / 4 + 0.35, 28, { color: lin('#A8B0B6'), top: false });
  }
  g.beam([-15, 12, 3], [-1.5, 10.5, 4], 0.6, { color: C.steel });
  return g.build();
}

function eocGeometry() {
  const g = new GeoBuilder();
  const b = BUILDING_BY_FACILITY.get('eoc')!;
  g.frame(b.pos[0], 0, b.pos[1], 0);
  const h = b.height;
  g.prism(8, -5, 0.45, h, h + 26, 6, { color: C.steel, r1: 0.18 });
  for (let k = 0; k < 4; k++) g.beam([8, h + 4 + k * 5, -5], [8 + 2.2, h + 4 + k * 5, -5], 0.12, { color: C.steel });
  // dishes
  g.prism(-8, -2, 2.2, h + 1.2, h + 2.2, 16, { color: C.white, r1: 0.4 });
  g.prism(-2, 4, 1.6, h + 1.0, h + 1.8, 16, { color: C.white, r1: 0.3 });
  return g.build();
}

interface TowerDims {
  id: string;
  facilityId: string;
  x: number;
  z: number;
  floorY: number;
  radius: number;
  height: number;
  tankIndex: number;
}

function towerDims(): TowerDims[] {
  return TANKS.map((t, i) => {
    const floorY = t.elevationM - SURFACE_ELEV;
    const radius = Math.max(6, t.diameterM / 2 + 1.0);
    return { id: t.id, facilityId: t.facilityId as string, x: t.pos[0], z: t.pos[2], floorY, radius, height: t.maxLevelM + 1.6, tankIndex: i };
  });
}

function waterTowerGeometry(d: TowerDims[]) {
  const g = new GeoBuilder();
  for (const t of d) {
    g.frame(t.x, 0, t.z, 0);
    g.prism(0, 0, 3.6, 0, 1.2, 16, { color: C.conc });
    g.prism(0, 0, 2.7, 1.2, t.floorY - 5, 20, { color: C.white, roofColor: C.white, top: false });
    // flared support cone
    g.prism(0, 0, 2.7, t.floorY - 5, t.floorY, 24, { color: C.white, r1: t.radius * 0.92, top: false });
    // tank rings (top & bottom bands) + cap
    g.prism(0, 0, t.radius + 0.15, t.floorY, t.floorY + 0.9, 32, { color: C.white, top: false });
    g.prism(0, 0, t.radius + 0.15, t.floorY + t.height - 0.9, t.floorY + t.height, 32, { color: C.white, top: false });
    g.prism(0, 0, t.radius + 0.15, t.floorY + t.height, t.floorY + t.height + t.radius * 0.38, 32, { color: C.white, r1: 0.6, roofColor: C.white });
    // vertical ribs
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.box(Math.cos(a) * (t.radius + 0.1), Math.sin(a) * (t.radius + 0.1), 0.35, 0.35, t.floorY, t.floorY + t.height, { color: C.white });
    }
    // walkway ring
    g.prism(0, 0, t.radius + 1.4, t.floorY - 0.4, t.floorY, 32, { color: C.steelDark });
  }
  return g.build();
}

export function Facilities() {
  const sub = useMemo(() => substationGeometry(), []);
  const desal = useMemo(() => desalGeometry(), []);
  const eoc = useMemo(() => eocGeometry(), []);
  const towers = useMemo(() => towerDims(), []);
  const towerGeo = useMemo(() => waterTowerGeometry(towers), [towers]);
  const equipMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.45 }), []);
  const whiteMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6 }), []);
  const busbarMat = useMemo(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color(LIN.energized), emissiveIntensity: 2.6 }), []);
  const glassMat = useMemo(
    () => new MeshStandardMaterial({ color: '#BFD6E2', metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide, envMapIntensity: 1.5 }),
    [],
  );
  const waterMat = useMemo(
    () => new MeshStandardMaterial({ color: '#0A4A5E', emissive: new Color(LIN.water), emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.2 }),
    [],
  );
  const levelRingMat = useMemo(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color(LIN.water), emissiveIntensity: 3.0 }), []);
  const crossMat = useMemo(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color('#FF2B2B'), emissiveIntensity: 3.2, side: DoubleSide }), []);
  const beaconMat = useMemo(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color('#FF3030'), emissiveIntensity: 4 }), []);
  const signTex = useMemo(() => createTextTexture('HOSPITAL', { w: 1024, h: 192 }), []);
  const signMat = useMemo(() => {
    const m = new MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false, side: DoubleSide });
    m.color.setScalar(2.4);
    return m;
  }, [signTex]);
  const helipadMat = useMemo(() => new MeshStandardMaterial({ color: '#2E3338', roughness: 0.8 }), []);
  const helipadMark = useMemo(() => new MeshStandardMaterial({ color: '#E8E8E8', emissive: new Color('#FFFFFF'), emissiveIntensity: 0.25, side: DoubleSide }), []);

  const waterRefs = useRef<(Mesh | null)[]>([]);
  const ringRefs = useRef<(Mesh | null)[]>([]);
  const beacon = useRef<Mesh>(null);
  const waterCyl = useMemo(() => new CylinderGeometry(1, 1, 1, 32, 1), []);
  const levelRing = useMemo(() => new TorusGeometry(1, 0.025, 6, 48), []);
  const tankShell = useMemo(() => new CylinderGeometry(1, 1, 1, 40, 1, true), []);

  const hosp = BUILDING_BY_FACILITY.get('hospital')!;
  const eocB = BUILDING_BY_FACILITY.get('eoc')!;
  const setHovered = useTwin((s) => s.setHovered);
  const setSelected = useTwin((s) => s.setSelected);

  useEffect(
    () => () => {
      [sub.equip, sub.live, desal, eoc, towerGeo, waterCyl, levelRing, tankShell].forEach((g) => g.dispose());
      [equipMat, whiteMat, busbarMat, glassMat, waterMat, levelRingMat, crossMat, beaconMat, signMat, helipadMat, helipadMark].forEach((m) => m.dispose());
      signTex.dispose();
    },
    [sub, desal, eoc, towerGeo, waterCyl, levelRing, tankShell, equipMat, whiteMat, busbarMat, glassMat, waterMat, levelRingMat, crossMat, beaconMat, signMat, helipadMat, helipadMark, signTex],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // substation conductors glow while the primary bus is energised
    const subOn = isPowered(live.busCode[0]) ? 1 : 0.15;
    busbarMat.emissiveIntensity += (2.6 * subOn - busbarMat.emissiveIntensity) * Math.min(1, dt * 3);
    // hospital cross: steady when supplied, slow pulse on backup power
    const hf = live.facilities.get('hospital');
    const backup = hf?.power === 'backup' || hf?.power === 'offline';
    crossMat.emissiveIntensity = backup ? 1.6 + 0.8 * Math.sin(t * 2.5) : 3.2;
    // water levels
    towers.forEach((tw, i) => {
      const pct = Math.max(0, Math.min(100, live.tankPct[tw.tankIndex] ?? 50));
      const tank = TANKS[tw.tankIndex];
      const levelM = tank.minLevelM + ((tank.maxLevelM - tank.minLevelM) * pct) / 100;
      const h = Math.max(0.05, levelM);
      const w = waterRefs.current[i];
      if (w) {
        w.scale.set(tw.radius * 0.96, h, tw.radius * 0.96);
        w.position.set(tw.x, tw.floorY + 0.9 + h / 2, tw.z);
      }
      const r = ringRefs.current[i];
      if (r) {
        r.position.set(tw.x, tw.floorY + 0.9 + h, tw.z);
        r.scale.setScalar(tw.radius + 0.25);
      }
    });
    const low = live.tankTrend[1] < -0.01 || (live.tankPct[1] ?? 100) < 25;
    levelRingMat.emissive.lerp(low ? LIN.waterLow : LIN.water, 0.08);
    if (beacon.current) (beacon.current.material as MeshStandardMaterial).emissiveIntensity = Math.sin(t * 3) > 0.6 ? 6 : 0.2;
    const fade = 1 - fx.xray * 0.85;
    glassMat.opacity = 0.32 * fade;
  });

  const facilityHandlers = (facilityId: string) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered({ kind: 'facility', id: facilityId });
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(null);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      setSelected({ kind: 'facility', id: facilityId });
    },
  });

  const hTop = hosp.height;
  return (
    <group>
      <group {...facilityHandlers('substation-s1')}>
        <mesh geometry={sub.equip} material={equipMat} castShadow receiveShadow />
        <mesh geometry={sub.live} material={busbarMat} />
      </group>
      <mesh geometry={desal} material={whiteMat} castShadow receiveShadow {...facilityHandlers('desal-r1')} />
      <group {...facilityHandlers('eoc')}>
        <mesh geometry={eoc} material={equipMat} castShadow />
        <mesh ref={beacon} material={beaconMat.clone()} position={[eocB.pos[0] + 8, eocB.height + 26.5, eocB.pos[1] - 5]}>
          <sphereGeometry args={[0.8, 10, 8]} />
        </mesh>
      </group>
      {/* hospital: red cross on the main facade + roof, signage, helipad */}
      <group {...facilityHandlers('hospital')}>
        <group position={[hosp.pos[0], 0, hosp.pos[1] + 6 + 8.05]}>
          <mesh material={crossMat} position={[0, hTop - 4.2, 0]}>
            <boxGeometry args={[7.5, 2.4, 0.3]} />
          </mesh>
          <mesh material={crossMat} position={[0, hTop - 4.2, 0]}>
            <boxGeometry args={[2.4, 7.5, 0.3]} />
          </mesh>
          <mesh material={signMat} position={[0, hTop - 10.2, 0.25]}>
            <planeGeometry args={[22, 4.1]} />
          </mesh>
        </group>
        <group position={[hosp.pos[0] + 12, hTop + 0.85, hosp.pos[1] + 6]}>
          <mesh material={helipadMat} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[5.6, 32]} />
          </mesh>
          <mesh material={helipadMark} rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
            <ringGeometry args={[4.6, 5.0, 40]} />
          </mesh>
          <mesh material={helipadMark} position={[-1.3, 0.06, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.6, 4]} />
          </mesh>
          <mesh material={helipadMark} position={[1.3, 0.06, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.6, 4]} />
          </mesh>
          <mesh material={helipadMark} position={[0, 0.06, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[2.2, 0.6]} />
          </mesh>
        </group>
        <group position={[hosp.pos[0] - 14, hTop + 3.05, hosp.pos[1] + 6]} rotation-x={-Math.PI / 2}>
          <mesh material={crossMat}>
            <planeGeometry args={[8, 2.6]} />
          </mesh>
          <mesh material={crossMat}>
            <planeGeometry args={[2.6, 8]} />
          </mesh>
        </group>
      </group>
      {/* elevated water towers */}
      <mesh geometry={towerGeo} material={whiteMat} castShadow receiveShadow />
      {towers.map((tw, i) => (
        <group key={tw.id} {...facilityHandlers(tw.facilityId)}>
          <mesh ref={(m) => (waterRefs.current[i] = m)} geometry={waterCyl} material={waterMat} />
          <mesh ref={(m) => (ringRefs.current[i] = m)} geometry={levelRing} material={levelRingMat} rotation-x={Math.PI / 2} />
          <mesh geometry={tankShell} material={glassMat} position={[tw.x, tw.floorY + tw.height / 2, tw.z]} scale={[tw.radius, tw.height, tw.radius]} renderOrder={12} />
        </group>
      ))}
    </group>
  );
}

// unused geometry helpers kept tree-shakeable
void CircleGeometry;
void RingGeometry;
