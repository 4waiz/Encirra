/**
 * The district platform: landscaped top surface, soil-strata cutaway faces and two open utility
 * galleries (front/south and west) where the transmission and suction mains run, so the water
 * network is visible from the default view exactly like an architectural section model.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, type Material, Mesh, MeshStandardMaterial } from 'three';
import { useKitFile, useKitSignature } from '../assets/kit';
import { PLATFORM, DEPTH } from '../data/twin';
import { createGalleryTexture, createStrataTexture, STRATA_U_METRES } from './textures';
import { createSurfaceMaterial, createTileSurfaceGeometry } from './surfaceShader';
import { fx } from '../runtime';
import { GeoBuilder, lin } from '../lib/GeoBuilder';

export const GALLERY = {
  y0: -28.5, // floor
  y1: -4.2, // underside of the street deck
  frontZ: 144, // back (soil) wall of the front gallery
  westX: -234, // back (soil) wall of the west gallery
};

type V3 = [number, number, number];

class FaceBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** rectangle given 4 corners CCW from the outside; uv = metres mapped by the callback */
  rect(c: V3[], n: V3, uv: (p: V3) => [number, number]) {
    const b = this.pos.length / 3;
    for (const p of c) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.uv.push(...uv(p));
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const { minX, maxX, minZ, maxZ } = PLATFORM;
const B = -DEPTH;
const G = GALLERY;

function strataGeometry() {
  const f = new FaceBuilder();
  const uvX = (p: V3): [number, number] => [p[0] / STRATA_U_METRES, (p[1] - B) / DEPTH];
  const uvZ = (p: V3): [number, number] => [p[2] / STRATA_U_METRES, (p[1] - B) / DEPTH];
  const bands: [number, number][] = [
    [G.y1, 0],
    [B, G.y0],
  ];
  for (const [y0, y1] of bands) {
    // south (+z) face
    f.rect([[minX, y0, maxZ], [maxX, y0, maxZ], [maxX, y1, maxZ], [minX, y1, maxZ]], [0, 0, 1], uvX);
    // west (−x)
    f.rect([[minX, y0, minZ], [minX, y0, maxZ], [minX, y1, maxZ], [minX, y1, minZ]], [-1, 0, 0], uvZ);
    // east (+x)
    f.rect([[maxX, y0, maxZ], [maxX, y0, minZ], [maxX, y1, minZ], [maxX, y1, maxZ]], [1, 0, 0], uvZ);
    // north (−z)
    f.rect([[maxX, y0, minZ], [minX, y0, minZ], [minX, y1, minZ], [maxX, y1, minZ]], [0, 0, -1], uvX);
  }
  // core between the galleries: east and north faces
  f.rect([[maxX, G.y0, G.frontZ], [maxX, G.y0, minZ], [maxX, G.y1, minZ], [maxX, G.y1, G.frontZ]], [1, 0, 0], uvZ);
  f.rect([[maxX, G.y0, minZ], [G.westX, G.y0, minZ], [G.westX, G.y1, minZ], [maxX, G.y1, minZ]], [0, 0, -1], uvX);
  // excavated soil walls behind the galleries
  f.rect([[G.westX, G.y0, G.frontZ], [maxX, G.y0, G.frontZ], [maxX, G.y1, G.frontZ], [G.westX, G.y1, G.frontZ]], [0, 0, 1], uvX);
  f.rect([[G.westX, G.y0, minZ], [G.westX, G.y0, G.frontZ], [G.westX, G.y1, G.frontZ], [G.westX, G.y1, minZ]], [-1, 0, 0], uvZ);
  // bottom
  f.rect([[minX, B, minZ], [maxX, B, minZ], [maxX, B, maxZ], [minX, B, maxZ]], [0, -1, 0], (p) => [p[0] / 40, p[2] / 40]);
  return f.build();
}

function galleryGeometry() {
  const f = new FaceBuilder();
  const uvF = (p: V3): [number, number] => [p[0] / 24, p[2] / 24];
  // floors (face up)
  f.rect([[minX, G.y0, maxZ], [maxX, G.y0, maxZ], [maxX, G.y0, G.frontZ], [minX, G.y0, G.frontZ]], [0, 1, 0], uvF);
  f.rect([[minX, G.y0, G.frontZ], [G.westX, G.y0, G.frontZ], [G.westX, G.y0, minZ], [minX, G.y0, minZ]], [0, 1, 0], uvF);
  // ceilings (face down)
  f.rect([[minX, G.y1, G.frontZ], [maxX, G.y1, G.frontZ], [maxX, G.y1, maxZ], [minX, G.y1, maxZ]], [0, -1, 0], uvF);
  f.rect([[minX, G.y1, minZ], [G.westX, G.y1, minZ], [G.westX, G.y1, G.frontZ], [minX, G.y1, G.frontZ]], [0, -1, 0], uvF);
  return f.build();
}

/** Pipe plinths, wall brackets and ceiling light strips inside the galleries. */
function galleryFurniture() {
  const conc = new GeoBuilder();
  const steel = new GeoBuilder();
  const lamps = new GeoBuilder();
  const cConc = lin('#9C9993');
  const cSteel = lin('#5E666E');
  const cLamp = lin('#FFFFFF');
  conc.frame(0, 0, 0, 0);
  steel.frame(0, 0, 0, 0);
  lamps.frame(0, 0, 0, 0);
  // front gallery: plinths under the suction main (y −24) and brackets for the transmission (y −15)
  for (let x = minX + 8; x <= maxX - 6; x += 12) {
    conc.box(x, 152, 2.2, 4.2, G.y0, -25.6, { color: cConc });
    steel.box(x + 6, 152, 0.5, 0.5, -16.6, -16.2, { color: cSteel });
    steel.beam([x + 6, -16.4, G.frontZ], [x + 6, -16.4, 154], 0.45, { color: cSteel });
    steel.beam([x + 6, -16.4, G.frontZ], [x + 6, -12.0, G.frontZ], 0.35, { color: cSteel });
  }
  // west gallery: brackets for the ring main (x −242, y −15)
  for (let z = minZ + 10; z <= maxZ - 20; z += 12) {
    steel.beam([G.westX, -16.4, z], [-244, -16.4, z], 0.45, { color: cSteel });
    steel.beam([G.westX, -16.4, z], [G.westX, -12, z], 0.35, { color: cSteel });
    conc.box(-242, z + 6, 3.0, 2.2, G.y0, -27.6, { color: cConc });
  }
  // wall-mounted gallery luminaires just under the deck
  for (let x = minX + 6; x <= maxX - 4; x += 10) lamps.box(x, G.frontZ + 0.2, 2.2, 0.4, G.y1 - 1.6, G.y1 - 1.1, { color: cLamp, top: false });
  for (let z = minZ + 6; z <= G.frontZ - 4; z += 10) lamps.box(G.westX - 0.2, z, 0.4, 2.2, G.y1 - 1.6, G.y1 - 1.1, { color: cLamp, top: false });
  // walkway grating along the front gallery
  steel.box(0, 157.5, maxX - minX - 2, 2.4, G.y0 + 0.2, G.y0 + 0.5, { color: lin('#4A5056') });
  return { conc: conc.build(), steel: steel.build(), lamps: lamps.build() };
}

/** keepDepth: partially transparent but still depth-writing (floating exploded tiles read as solid ghosts) */
function useFade(materials: Material[], min = 0.12, keepDepth = false) {
  useFrame(() => {
    const fade = 1 - (1 - min) * fx.xray;
    const transparent = fade < 0.999;
    for (const m of materials) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent || keepDepth;
        m.needsUpdate = true;
      }
      m.opacity = fade;
      const u = (m.userData as { uniforms?: { uFade?: { value: number } } }).uniforms;
      if (u?.uFade) u.uFade.value = fade;
    }
  });
}

/** Landscaped top surface (roads, blocks, outage tint). Sits 3 cm above the base top face. */
function Surface() {
  const surfaceMat = useMemo(() => createSurfaceMaterial(), []);
  const geo = useMemo(() => createTileSurfaceGeometry(), []);
  useFade([surfaceMat], 0.5, true);
  useFrame((state) => {
    surfaceMat.userData.uniforms.uTime.value = state.clock.elapsedTime;
  });
  useEffect(
    () => () => {
      surfaceMat.dispose();
      geo.dispose();
    },
    [surfaceMat, geo],
  );
  // the tiles move in the vertex shader: never frustum-cull them on their rest bounds
  return <mesh geometry={geo} material={surfaceMat} receiveShadow frustumCulled={false} />;
}

/** Procedural slab: strata cut faces, soil-walled galleries and gallery furniture (fallback). */
function ProceduralBase() {
  const strataTex = useMemo(() => createStrataTexture(), []);
  const galleryTex = useMemo(() => createGalleryTexture(), []);
  const strataGeo = useMemo(() => strataGeometry(), []);
  const galleryGeo = useMemo(() => galleryGeometry(), []);
  const furniture = useMemo(() => galleryFurniture(), []);
  const strataMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: strataTex,
        bumpMap: strataTex,
        bumpScale: 1.6,
        roughness: 0.96,
        metalness: 0,
        envMapIntensity: 0.35,
      }),
    [strataTex],
  );
  const galleryMat = useMemo(
    () => new MeshStandardMaterial({ map: galleryTex, roughness: 0.9, metalness: 0, color: new Color('#c9c4bb'), envMapIntensity: 0.4 }),
    [galleryTex],
  );
  const concMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), []);
  const steelMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }), []);
  const lampMat = useMemo(() => new MeshStandardMaterial({ color: '#000000', emissive: new Color('#FFE2B8'), emissiveIntensity: 3.2 }), []);
  useFade([strataMat, galleryMat, concMat, steelMat], 0.14);
  useEffect(
    () => () => {
      [strataTex, galleryTex].forEach((t) => t.dispose());
      [strataGeo, galleryGeo, furniture.conc, furniture.steel, furniture.lamps].forEach((g) => g.dispose());
      [strataMat, galleryMat, concMat, steelMat, lampMat].forEach((m) => m.dispose());
    },
    [strataTex, galleryTex, strataGeo, galleryGeo, furniture, strataMat, galleryMat, concMat, steelMat, lampMat],
  );
  return (
    <group>
      <mesh geometry={strataGeo} material={strataMat} receiveShadow castShadow />
      <mesh geometry={galleryGeo} material={galleryMat} receiveShadow />
      <mesh geometry={furniture.conc} material={concMat} receiveShadow castShadow />
      <mesh geometry={furniture.steel} material={steelMat} receiveShadow castShadow />
      <mesh geometry={furniture.lamps} material={lampMat} />
    </group>
  );
}

/** district-base.glb from the asset kit (cut faces with soil strata, galleries, chambers). */
function KitBase() {
  const gltf = useKitFile('district-base.glb');
  const { meshes, materials } = useMemo(() => {
    if (!gltf) return { meshes: [] as Mesh[], materials: [] as Material[] };
    const node = gltf.scene.getObjectByName('district-base') ?? gltf.scene;
    const ms: Mesh[] = [];
    const mats: Material[] = [];
    node.updateMatrixWorld(true);
    node.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const src = (Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial;
      const mat = src.clone();
      mat.vertexColors = !!m.geometry.getAttribute('color');
      if (mat.name === 'light_emissive') {
        // gallery strip lights: cool white, bright enough to read the galleries as lit tunnels
        mat.emissive.set('#DCEBFF');
        mat.emissiveIntensity = (src.emissiveIntensity ?? 4) * 1.1;
      }
      if (mat.name === 'soil') {
        // reference look: dark charcoal-brown strata with strong contrast (the kit texture is sandy)
        mat.envMapIntensity = 0.25;
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.6)) * vec3(1.0, 0.9, 0.84) * 1.15;`,
          );
        };
        mat.customProgramCacheKey = () => 'encirra-soil-grade-v1';
      }
      if (mat.name === 'concrete') mat.color.multiplyScalar(0.82);
      mat.userData.baseOpacity = 1;
      const mesh = new Mesh(m.geometry, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m.matrixWorld);
      mesh.castShadow = mat.name !== 'light_emissive';
      mesh.receiveShadow = true;
      ms.push(mesh);
      mats.push(mat);
    });
    return { meshes: ms, materials: mats };
  }, [gltf]);
  useFade(materials, 0.14);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

export function Platform() {
  const sig = useKitSignature(['district-base.glb']);
  const kit = sig === 'ready:district-base.glb';
  return (
    <group>
      <Surface />
      {kit ? <KitBase /> : <ProceduralBase />}
    </group>
  );
}

export function useKitBaseActive() {
  return useKitSignature(['district-base.glb']) === 'ready:district-base.glb';
}
