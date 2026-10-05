import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MODELS, modelUrl, prepareModel } from './models';
import { registerThermalTree } from './thermal';
import { registerPickable } from './picking';
import { engine } from '../simulation/engine';
import { teamPose, RESPONSE_VEHICLE_POSE } from '../simulation/assets';
import { SENSORS } from '../simulation/sensors';
import { sceneClock } from './sceneClock';
import { angleDeltaRad, clamp } from '../utils/math';

export const UGV_SCALE = 1.6;
export const UAV_SCALE = 2.6;

/** Damped visual state of moving assets (read by feed cameras and DOM overlays). */
export const assetVisual = {
  ugv: { x: 0, y: 0, z: 0, heading: 0, speed: 0, ready: false },
  uav: { x: 0, y: 120, z: 0, heading: 0, roll: 0, ready: false },
  team: [0, 1, 2].map(() => ({ x: 0, z: 0, heading: 0 })),
};

function pickBox(w: number, h: number, d: number, y = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.y = y;
  return m;
}

function findMaterial(root: THREE.Object3D, name: string): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!found && mesh.isMesh) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.name === name) found = m;
    }
  });
  return found;
}

function SensorNodes() {
  const gltf = useGLTF(modelUrl(MODELS.sensor), false, false);
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'sensor-nodes';
    const nodes = SENSORS.filter((s) => s.kind !== 'met');
    const m = new THREE.Matrix4();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, nodes.length);
      nodes.forEach((s, i) => {
        m.makeRotationY((i * 1.7) % (Math.PI * 2));
        m.setPosition(s.x, 0, s.z);
        m.multiply(mesh.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
    });
    prepareModel(g);
    return g;
  }, [gltf]);
  useEffect(() => registerThermalTree(group), [group]);
  return <primitive object={group} />;
}

export function AssetLayer() {
  const ugvGltf = useGLTF(modelUrl(MODELS.ugv), false, false);
  const uavGltf = useGLTF(modelUrl(MODELS.uav), false, false);
  const personGltf = useGLTF(modelUrl(MODELS.person), false, false);
  const vehicleGltf = useGLTF(modelUrl(MODELS.vehicle), false, false);

  const ugv = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'UGV-01';
    const body = ugvGltf.scene;
    body.scale.setScalar(UGV_SCALE);
    prepareModel(body);
    g.add(body);
    const proxy = pickBox(5, 4, 6);
    g.add(proxy);
    return { group: g, proxy, beacon: findMaterial(body, 'beacon_amber') };
  }, [ugvGltf]);

  const uav = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'UAV-01';
    const body = uavGltf.scene;
    body.scale.setScalar(UAV_SCALE);
    prepareModel(body, { cast: true, receive: false });
    g.add(body);
    const proxy = pickBox(12, 8, 12, 0);
    g.add(proxy);
    return { group: g, body, proxy };
  }, [uavGltf]);

  const team = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const g = new THREE.Group();
        g.name = `TEAM-${i + 1}`;
        const body = personGltf.scene.clone(true);
        prepareModel(body);
        g.add(body);
        const proxy = pickBox(2.4, 2.6, 2.4);
        g.add(proxy);
        return { group: g, proxy };
      }),
    [personGltf],
  );

  const vehicle = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'RV-02';
    const body = vehicleGltf.scene;
    prepareModel(body);
    g.add(body);
    g.position.set(RESPONSE_VEHICLE_POSE.x, 0, RESPONSE_VEHICLE_POSE.z);
    g.rotation.y = RESPONSE_VEHICLE_POSE.heading;
    const proxy = pickBox(4, 4, 10);
    g.add(proxy);
    return { group: g, proxy };
  }, [vehicleGltf]);

  useEffect(() => {
    const offs = [
      registerThermalTree(ugv.group),
      registerThermalTree(uav.group),
      registerThermalTree(vehicle.group),
      ...team.map((p) => registerThermalTree(p.group)),
      registerPickable({ object: ugv.proxy, selection: { kind: 'asset', id: 'UGV-01' }, priority: 0, area: 1 }),
      registerPickable({ object: uav.proxy, selection: { kind: 'asset', id: 'UAV-01' }, priority: 0, area: 1 }),
      registerPickable({ object: vehicle.proxy, selection: { kind: 'asset', id: 'RV-02' }, priority: 0, area: 1 }),
      ...team.map((p) => registerPickable({ object: p.proxy, selection: { kind: 'asset', id: 'TEAM-1' }, priority: 0, area: 1 })),
    ];
    return () => offs.forEach((f) => f());
  }, [ugv, uav, vehicle, team]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = sceneClock.t;
    const k = 1 - Math.exp(-dt * 7);

    // UGV
    const p = engine.ugvPose(t);
    const v = assetVisual.ugv;
    if (!v.ready || sceneClock.replay) {
      v.heading = p.heading;
      v.ready = true;
    }
    v.heading += angleDeltaRad(v.heading, p.heading) * k;
    v.x = p.x;
    v.z = p.z;
    v.speed = p.speed;
    ugv.group.position.set(p.x, 0.02 + (p.speed > 0.3 ? Math.sin(performance.now() / 70) * 0.012 : 0), p.z);
    ugv.group.rotation.y = v.heading;
    if (ugv.beacon) {
      const on = Math.floor(performance.now() / 420) % 2 === 0;
      ugv.beacon.emissiveIntensity = on ? 7 : 0.6;
    }

    // UAV with banking into turns
    const q = engine.uavPose(t);
    const u = assetVisual.uav;
    if (!u.ready) {
      u.heading = q.heading;
      u.ready = true;
    }
    const prev = u.heading;
    u.heading += angleDeltaRad(u.heading, q.heading) * k;
    const yawRate = angleDeltaRad(prev, u.heading) / Math.max(dt, 1e-3);
    u.roll += (clamp(-yawRate * 0.9, -0.32, 0.32) - u.roll) * k;
    u.x = q.x;
    u.y = q.y + Math.sin(performance.now() / 1800) * 0.6;
    u.z = q.z;
    uav.group.position.set(u.x, u.y, u.z);
    uav.group.rotation.set(0, u.heading, 0);
    uav.body.rotation.set(0.07, 0, u.roll);

    // survey team
    team.forEach((m, i) => {
      const tp = teamPose(i, t);
      const walk = tp.speed > 0.1;
      m.group.position.set(tp.x, walk ? Math.abs(Math.sin(performance.now() / 300)) * 0.035 : 0, tp.z);
      m.group.rotation.y = tp.heading;
      assetVisual.team[i] = { x: tp.x, z: tp.z, heading: tp.heading };
    });
  });

  return (
    <group name="assets">
      <primitive object={ugv.group} />
      <primitive object={uav.group} />
      <primitive object={vehicle.group} />
      {team.map((m) => (
        <primitive key={m.group.name} object={m.group} />
      ))}
      <SensorNodes />
    </group>
  );
}
