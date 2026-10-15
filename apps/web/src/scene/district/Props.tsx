/**
 * Street props: instanced date palms (trunk + alpha-tested fronds) and street lights (poles,
 * emissive heads, glow sprites, light pools on the road). Each light is mapped to the bus of the
 * nearest building, so lights go dark with their area when that bus loses supply.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { cityLayout } from '@encirra/shared';
import { propBusIndex } from '../data/twin';
import { busTex } from '../data/stateTextures';
import { createFrondTexture } from './textures';
import { GeoBuilder, lin } from '../lib/GeoBuilder';
import { fx } from '../runtime';
import { useKitSignature } from '../assets/kit';
import { KitProps } from './KitProps';
import { patchWorldTiles, withPatch } from '../anim/patch';
import { motionUniforms, TILE_VERT_GLSL } from '../anim/motion';

const PALMS = cityLayout.props.palms;
const LIGHTS = cityLayout.props.streetLights;

export function trunkGeometry() {
  const g = new CylinderGeometry(0.2, 0.36, 9.5, 7, 6, true);
  g.translate(0, 4.75, 0);
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + 0.035 * y * y * 0.1);
    // ring bumps
    const s = 1 + 0.06 * Math.sin(y * 6);
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export function crownGeometry() {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const fronds = 11;
  const segs = 6;
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const len = 5.2 + (f % 3) * 0.5;
    const lift = f % 2 === 0 ? 1.4 : 0.6;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = len * t;
      const y = 9.5 + lift * t - 3.2 * t * t;
      const w = 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08));
      // perpendicular in plan
      const px = -sa;
      const pz = ca;
      pos.push(ca * r + px * w, y + 0.15 * w, sa * r + pz * w, ca * r - px * w, y + 0.15 * w, sa * r - pz * w);
      uv.push(1, 1 - t, 0, 1 - t);
      nor.push(0, 1, 0, 0, 1, 0);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function palmMatrices() {
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  return PALMS.map(([x, z, s, r]) => {
    q.setFromAxisAngle(up, r);
    return m.compose(new Vector3(x, 0, z), q, new Vector3(s, s, s)).clone();
  });
}

function lightPoleGeometry() {
  const g = new GeoBuilder();
  const c = lin('#3A4047');
  g.frame(0, 0, 0, 0);
  g.prism(0, 0, 0.16, 0, 8.6, 6, { color: c });
  g.beam([0, 8.4, 0], [0, 8.9, 2.6], 0.16, { color: c });
  g.box(0, 2.9, 0.5, 1.0, 8.6, 8.95, { color: c });
  return g.build();
}

export function Props() {
  const frondTex = useMemo(() => createFrondTexture(), []);
  const trunk = useMemo(() => trunkGeometry(), []);
  const crown = useMemo(() => crownGeometry(), []);
  const trunkMat = useMemo(() => withPatch(new MeshStandardMaterial({ color: '#7A6248', roughness: 0.95 }), 'tiles-pop', (s) => patchWorldTiles(s, { pop: true })), []);
  const crownMat = useMemo(
    () =>
      withPatch(
        new MeshStandardMaterial({
          map: frondTex,
          alphaTest: 0.45,
          side: DoubleSide,
          roughness: 0.8,
          color: '#9DBA6E',
          emissive: '#0B1404',
        }),
        'tiles-pop',
        (s) => patchWorldTiles(s, { pop: true }),
      ),
    [frondTex],
  );
  const palms = useMemo(() => {
    const mats = palmMatrices();
    const t = new InstancedMesh(trunk, trunkMat, mats.length);
    const c = new InstancedMesh(crown, crownMat, mats.length);
    mats.forEach((m, i) => {
      t.setMatrixAt(i, m);
      c.setMatrixAt(i, m);
    });
    for (const im of [t, c]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    return [t, c];
  }, [trunk, crown, trunkMat, crownMat]);

  // street lights
  const poleGeo = useMemo(() => lightPoleGeometry(), []);
  const poleMat = useMemo(() => withPatch(new MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 }), 'tiles-pop', (s) => patchWorldTiles(s, { pop: true })), []);
  const lightBus = useMemo(() => LIGHTS.map(([x, z]) => propBusIndex(x, z)), []);
  const poles = useMemo(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const im = new InstancedMesh(poleGeo, poleMat, LIGHTS.length);
    LIGHTS.forEach(([x, z, r], i) => {
      q.setFromAxisAngle(up, r);
      im.setMatrixAt(i, m.compose(new Vector3(x, 0, z), q, new Vector3(1, 1, 1)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.computeBoundingSphere();
    return im;
  }, [poleGeo, poleMat]);

  // glow sprites (heads) + light pools (road), both driven by the bus state texture
  const glowGeo = useMemo(() => {
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const a = new Float32Array(LIGHTS.length * 4);
    LIGHTS.forEach(([x, z, r], i) => {
      a.set([x + Math.sin(r) * 2.9, 8.55, z + Math.cos(r) * 2.9, lightBus[i]], i * 4);
    });
    g.setAttribute('aLight', new InstancedBufferAttribute(a, 4));
    g.instanceCount = LIGHTS.length;
    return g;
  }, [lightBus]);
  const glowMat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        uniforms: { uBusTex: { value: busTex }, uMode: { value: 0 }, uFade: { value: 1 }, uTileTex: motionUniforms.uTileTex, uBldAnim: motionUniforms.uBldAnim, uPropT: motionUniforms.uPropT },
        vertexShader: /* glsl */ `
          attribute vec4 aLight; uniform sampler2D uBusTex; uniform float uMode;
          varying vec2 vUv; varying float vOn;
          ${TILE_VERT_GLSL}
          void main() {
            vUv = uv * 2.0 - 1.0;
            vOn = texelFetch(uBusTex, ivec2(int(aLight.w + 0.5), 0), 0).b;
            float pop = encPropPop(aLight.xz);
            float ti = encTileOf(aLight.xz);
            vec3 nn = vec3(0.0, 1.0, 0.0);
            if (uMode < 0.5) {
              vec3 c = encTile(ti, aLight.xyz, nn);
              vec4 mv = modelViewMatrix * vec4(c, 1.0);
              mv.xy += position.xy * 3.2 * pop;
              gl_Position = projectionMatrix * mv;
            } else {
              vec3 p = vec3(aLight.x + position.x * 16.0 * pop, 0.12, aLight.z - position.y * 16.0 * pop);
              p = encTile(ti, p, nn);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
          }`,
        fragmentShader: /* glsl */ `
          uniform float uMode; uniform float uFade; varying vec2 vUv; varying float vOn;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            vec3 warm = vec3(1.0, 0.68, 0.36);
            float a = uMode < 0.5 ? (exp(-r * r * 18.0) * 3.0 + exp(-r * r * 4.0) * 0.4) : exp(-r * r * 3.2) * 0.22;
            gl_FragColor = vec4(warm * a * vOn * uFade, 1.0);
          }`,
      }),
    [],
  );
  const poolMat = useMemo(() => {
    const m = glowMat.clone();
    m.uniforms.uMode.value = 1;
    m.uniforms.uBusTex.value = busTex;
    // clone() copies uniform values: re-link the shared animation uniforms
    m.uniforms.uTileTex = motionUniforms.uTileTex;
    m.uniforms.uBldAnim = motionUniforms.uBldAnim;
    m.uniforms.uPropT = motionUniforms.uPropT;
    return m;
  }, [glowMat]);

  useFrame(() => {
    const fade = 1 - fx.xray * 0.85;
    glowMat.uniforms.uFade.value = fade;
    poolMat.uniforms.uFade.value = fade;
  });

  useEffect(
    () => () => {
      [trunk, crown, poleGeo, glowGeo].forEach((g) => g.dispose());
      [trunkMat, crownMat, poleMat, glowMat, poolMat].forEach((m) => m.dispose());
      frondTex.dispose();
    },
    [trunk, crown, poleGeo, glowGeo, trunkMat, crownMat, poleMat, glowMat, poolMat, frondTex],
  );

  const sig = useKitSignature(['palm.glb', 'streetlight.glb']);
  const kitPalms = sig.includes('palm.glb');
  const kitLights = sig.includes('streetlight.glb');
  return (
    <group>
      <KitProps palms={kitPalms} lights={kitLights} />
      {!kitPalms && <primitive object={palms[0]} />}
      {!kitPalms && <primitive object={palms[1]} />}
      {!kitLights && <primitive object={poles} />}
      <mesh geometry={glowGeo} material={poolMat} renderOrder={2} frustumCulled={false} />
      <mesh geometry={glowGeo} material={glowMat} renderOrder={10} frustumCulled={false} />
    </group>
  );
}
