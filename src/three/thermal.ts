import * as THREE from 'three';
import { MATERIAL_HEAT } from './layers';

// Simulated thermal imaging. Every physical mesh carries a "heat" material; the render loop swaps
// them in for thermal feeds and renders raw heat into a float target, which the thermal post
// shader maps through an ironbow palette with optics blur, sensor noise and scanlines.

export const thermalUniforms = {
  uHotspots: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uHotCount: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.7, 0.59, 0.4).normalize() },
  uTime: { value: 0 },
};

const NOISE = /* glsl */ `
  float th_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float th_noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(th_hash(i), th_hash(i + vec2(1.0, 0.0)), u.x), mix(th_hash(i + vec2(0.0, 1.0)), th_hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  void main() {
    vec4 lp = vec4(position, 1.0);
    vec3 ln = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      ln = mat3(instanceMatrix) * ln;
    #endif
    vec4 wp = modelMatrix * lp;
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * ln);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG_COMMON = /* glsl */ `
  uniform vec4 uHotspots[4];
  uniform int uHotCount;
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  ${NOISE}
  float hotspotHeat(vec3 p) {
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= uHotCount) break;
      vec4 s = uHotspots[i];
      vec3 d = p - vec3(s.x, 1.6, s.y);
      d.y *= 1.6;
      h += s.w * exp(-dot(d, d) / (2.0 * s.z * s.z));
    }
    return h;
  }
  float atmosphere(float heat) {
    float dist = length(vWorldPos - cameraPosition);
    return mix(heat, 0.34, smoothstep(500.0, 4200.0, dist) * 0.85);
  }
`;

const FRAG_SOLID = /* glsl */ `
  uniform float uHeat;
  uniform float uSunGain;
  ${FRAG_COMMON}
  void main() {
    vec3 n = normalize(vNormalW);
    float sun = max(dot(n, normalize(uSunDir)), 0.0);
    float heat = uHeat + uSunGain * (sun - 0.42);
    heat -= 0.05 * clamp(-n.y, 0.0, 1.0);
    heat += 0.03 * (th_noise(vWorldPos.xz * 0.45 + vWorldPos.y * 0.3) - 0.5);
    heat += hotspotHeat(vWorldPos);
    gl_FragColor = vec4(vec3(atmosphere(heat)), 1.0);
  }
`;

const FRAG_GROUND = /* glsl */ `
  uniform sampler2D uSiteTex;
  uniform vec4 uSiteRect;
  ${FRAG_COMMON}
  void main() {
    vec2 wp = vWorldPos.xz;
    float heat = 0.56 + 0.05 * (th_noise(wp * 0.02) - 0.5) + 0.025 * (th_noise(wp * 0.3) - 0.5);
    vec2 suv = vec2((wp.x - uSiteRect.x) / uSiteRect.z, 1.0 - (wp.y - uSiteRect.y) / uSiteRect.w);
    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
      vec4 site = texture2D(uSiteTex, suv);
      float lum = dot(site.rgb, vec3(0.2126, 0.7152, 0.0722));
      float green = clamp((site.g - site.r) * 6.0, 0.0, 1.0);
      float siteHeat = 0.46 + 0.32 * (1.0 - clamp(lum * 1.6, 0.0, 1.0)) - 0.16 * green;
      heat = mix(heat, siteHeat, site.a);
    }
    heat += hotspotHeat(vWorldPos);
    gl_FragColor = vec4(vec3(atmosphere(heat)), 1.0);
  }
`;

const FRAG_WATER = /* glsl */ `
  ${FRAG_COMMON}
  void main() {
    vec2 wp = vWorldPos.xz;
    float heat = 0.25 + 0.03 * (th_noise(wp * 0.05 + uTime * 0.05) - 0.5) + 0.015 * (th_noise(wp * 0.6 - uTime * 0.2) - 0.5);
    gl_FragColor = vec4(vec3(atmosphere(heat)), 1.0);
  }
`;

const FRAG_SKY = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    float up = clamp(normalize(vWorldPos - cameraPosition).y, 0.0, 1.0);
    gl_FragColor = vec4(vec3(mix(0.3, 0.05, pow(up, 0.5))), 1.0);
  }
`;

const cache = new Map<string, THREE.ShaderMaterial>();

export function thermalSolid(heat: number, sunGain = 0.16): THREE.ShaderMaterial {
  const key = `solid:${heat.toFixed(3)}:${sunGain}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      name: key,
      uniforms: { ...thermalUniforms, uHeat: { value: heat }, uSunGain: { value: sunGain } },
      vertexShader: VERT,
      fragmentShader: FRAG_SOLID,
      side: THREE.DoubleSide,
    });
    cache.set(key, m);
  }
  return m;
}

export function thermalForMaterial(mat: THREE.Material | THREE.Material[]): THREE.ShaderMaterial {
  const m = Array.isArray(mat) ? mat[0] : mat;
  const heat = MATERIAL_HEAT[m.name] ?? 0.48;
  const people = ['skin', 'coverall', 'hivis', 'helmet'].includes(m.name);
  return thermalSolid(heat, people ? 0.04 : 0.16);
}

export function thermalGround(siteTex: THREE.Texture, rect: THREE.Vector4) {
  return new THREE.ShaderMaterial({
    name: 'thermal-ground',
    uniforms: { ...thermalUniforms, uSiteTex: { value: siteTex }, uSiteRect: { value: rect } },
    vertexShader: VERT,
    fragmentShader: FRAG_GROUND,
  });
}

export function thermalWater() {
  return new THREE.ShaderMaterial({ name: 'thermal-water', uniforms: { ...thermalUniforms }, vertexShader: VERT, fragmentShader: FRAG_WATER });
}

export function thermalSky() {
  return new THREE.ShaderMaterial({
    name: 'thermal-sky',
    vertexShader: VERT,
    fragmentShader: FRAG_SKY,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// ------------------------------------------------------------------------------------------ registry

interface Entry {
  mesh: THREE.Mesh;
  visible: THREE.Material | THREE.Material[];
  thermal: THREE.Material;
}

const entries = new Set<Entry>();
let thermalActive = false;

export function registerThermal(mesh: THREE.Mesh, thermal?: THREE.Material) {
  const entry: Entry = { mesh, visible: mesh.material, thermal: thermal ?? thermalForMaterial(mesh.material) };
  entries.add(entry);
  return () => {
    if (thermalActive) mesh.material = entry.visible;
    entries.delete(entry);
  };
}

export function setThermalMode(on: boolean) {
  if (on === thermalActive) return;
  thermalActive = on;
  for (const e of entries) e.mesh.material = on ? e.thermal : e.visible;
}

/** Register every mesh below a root (GLB scene). Returns an unregister function. */
export function registerThermalTree(root: THREE.Object3D) {
  const offs: (() => void)[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) offs.push(registerThermal(mesh));
  });
  return () => offs.forEach((f) => f());
}

// ------------------------------------------------------------------------------------------ palette

export function createPaletteTexture(kind: 'ironbow' | 'whitehot') {
  const stops: [number, [number, number, number]][] =
    kind === 'ironbow'
      ? [
          [0.0, [0, 0, 0]],
          [0.16, [32, 8, 74]],
          [0.34, [118, 22, 132]],
          [0.52, [206, 50, 64]],
          [0.68, [240, 112, 30]],
          [0.84, [251, 202, 62]],
          [1.0, [255, 252, 236]],
        ]
      : [
          [0.0, [8, 8, 10]],
          [0.5, [120, 122, 126]],
          [1.0, [250, 252, 255]],
        ];
  const N = 256;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    let k = 0;
    while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [x0, c0] = stops[k];
    const [x1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    const s = f * f * (3 - 2 * f);
    data[i * 4] = Math.round(c0[0] + (c1[0] - c0[0]) * s);
    data[i * 4 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * s);
    data[i * 4 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * s);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Map a raw heat value to a display temperature (°C) for legends and labels. */
export const heatToCelsius = (h: number) => 18 + h * 50;
