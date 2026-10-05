import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { registerThermal, thermalSky, thermalUniforms } from './thermal';
import { useUI } from '../store/ui';

// Afternoon coastal light: sun from the west-south-west, ~36° elevation, hazy horizon.
const AZ = (240 * Math.PI) / 180;
const EL = (36 * Math.PI) / 180;
export const SUN_DIR = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), -Math.cos(AZ) * Math.cos(EL)).normalize();
thermalUniforms.uSunDir.value.copy(SUN_DIR);

export const SKY_COLORS = {
  zenith: new THREE.Color('#6b90b6'),
  horizon: new THREE.Color('#c6d2d8'),
  ground: new THREE.Color('#bcae92'),
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, h));
    col = mix(col, mix(uHorizon, uGround, 0.35), smoothstep(0.0, -0.12, h));
    col = mix(col, uHorizon * 1.04, exp(-abs(h) * 18.0) * 0.45);
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.92, 0.78) * (pow(sd, 900.0) * 14.0 + pow(sd, 24.0) * 0.22 + pow(sd, 4.0) * 0.06);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: {
      uZenith: { value: SKY_COLORS.zenith },
      uHorizon: { value: SKY_COLORS.horizon },
      uGround: { value: SKY_COLORS.ground },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function SceneEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const quality = useUI((s) => s.settings.quality);

  const sky = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(9500, 48, 24), makeSkyMaterial());
    mesh.name = 'sky';
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  // image-based lighting from the same sky (water, glass and metal reflections)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial());
    envScene.add(envSky);
    const rt = pmrem.fromScene(envScene, 0.015, 1, 1000);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.9;
    scene.fog = new THREE.Fog(SKY_COLORS.horizon.clone(), 2600, 9200);
    return () => {
      scene.environment = null;
      rt.dispose();
      pmrem.dispose();
      envSky.geometry.dispose();
      (envSky.material as THREE.Material).dispose();
    };
  }, [gl, scene]);

  useEffect(() => registerThermal(sky, thermalSky()), [sky]);

  const sun = useMemo(() => {
    const light = new THREE.DirectionalLight('#fff1dd', 2.7);
    light.position.copy(SUN_DIR).multiplyScalar(2600).add(new THREE.Vector3(0, 0, -40));
    light.target.position.set(0, 0, -40);
    light.castShadow = true;
    const cam = light.shadow.camera;
    cam.left = -800;
    cam.right = 800;
    cam.top = 800;
    cam.bottom = -800;
    cam.near = 400;
    cam.far = 5200;
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.00025;
    light.shadow.normalBias = 0.9;
    return light;
  }, []);

  useEffect(() => {
    const size = quality === 'high' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }, [quality, sun]);

  return (
    <>
      <primitive object={sky} />
      <primitive object={sun} />
      <primitive object={sun.target} />
      <hemisphereLight args={['#d5e4f0', '#a99372', 0.95]} />
    </>
  );
}
