/**
 * Palms lining the lower-city streets on the camera side of the district (instanced, curved
 * world, no shadows). Uses the procedural palm geometry with the canvas frond texture.
 */
import { useEffect, useMemo } from 'react';
import { DoubleSide, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { bendShader } from './bend';
import { GROUND_Y, lowerCityPalms } from './layout';
import { crownGeometry, trunkGeometry } from '../district/Props';
import { createFrondTexture } from '../district/textures';
import { useSceneQuality } from '../runtime';

function bent<T extends MeshLambertMaterial>(m: T, key: string) {
  m.onBeforeCompile = (shader) => {
    bendShader(shader);
    // dusk shade below the raised district
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 0.55;');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

export function LowerPalms() {
  const tier = useSceneQuality((s) => s.tier);
  const spots = useMemo(() => lowerCityPalms(), []);
  const frondTex = useMemo(() => createFrondTexture(), []);
  const trunk = useMemo(() => trunkGeometry(), []);
  const crown = useMemo(() => crownGeometry(), []);
  const trunkMat = useMemo(() => bent(new MeshLambertMaterial({ color: '#6E5A45' }), 'encirra-lowpalm-trunk'), []);
  const crownMat = useMemo(
    () => bent(new MeshLambertMaterial({ map: frondTex, alphaTest: 0.45, side: DoubleSide, color: '#8FB06A' }), 'encirra-lowpalm-crown'),
    [frondTex],
  );
  const meshes = useMemo(() => {
    const list = tier === 'low' ? spots.filter((_, i) => i % 2 === 0) : spots;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const t = new InstancedMesh(trunk, trunkMat, list.length);
    const c = new InstancedMesh(crown, crownMat, list.length);
    list.forEach(([x, z, s, r], i) => {
      q.setFromAxisAngle(up, r);
      m.compose(new Vector3(x, GROUND_Y, z), q, new Vector3(s, s, s));
      t.setMatrixAt(i, m);
      c.setMatrixAt(i, m);
    });
    for (const im of [t, c]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
    }
    return [t, c];
  }, [spots, trunk, crown, trunkMat, crownMat, tier]);
  useEffect(
    () => () => {
      [trunk, crown].forEach((g) => g.dispose());
      [trunkMat, crownMat].forEach((m) => m.dispose());
      frondTex.dispose();
    },
    [trunk, crown, trunkMat, crownMat, frondTex],
  );
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
