import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { SITE } from '../data/site';
import { MODELS, modelUrl, prepareModel } from './models';
import { registerThermalTree } from './thermal';

/** Instances the reactor-unit module at every unit position (one draw call per material). */
function ReactorUnits() {
  const gltf = useGLTF(modelUrl(MODELS.unit), false, false);
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'reactor-units';
    gltf.scene.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, SITE.units.length);
      SITE.units.forEach((u, i) => {
        m.makeTranslation(u.x, 0, u.z).multiply(mesh.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = mesh.name;
      g.add(im);
    });
    prepareModel(g);
    return g;
  }, [gltf]);
  useEffect(() => registerThermalTree(group), [group]);
  return <primitive object={group} />;
}

function StaticModule({ name, cast = true }: { name: string; cast?: boolean }) {
  const gltf = useGLTF(modelUrl(name), false, false);
  const root = useMemo(() => {
    prepareModel(gltf.scene, { cast, receive: true });
    return gltf.scene;
  }, [gltf, cast]);
  useEffect(() => registerThermalTree(root), [root]);
  return <primitive object={root} />;
}

export function Facility() {
  return (
    <group name="facility">
      <ReactorUnits />
      <StaticModule name={MODELS.service} />
      <StaticModule name={MODELS.cooling} />
      <StaticModule name={MODELS.electrical} />
      <StaticModule name={MODELS.props} />
    </group>
  );
}
