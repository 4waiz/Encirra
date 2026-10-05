import * as THREE from 'three';

// Fullscreen composite passes drawn into each viewport rectangle of the shared canvas.

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HASH = /* glsl */ `
  float pp_hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

export function createFullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

/** Main twin view: tone mapping + gentle vignette + very light grain to avoid banding. */
export function createGradeMaterial() {
  return new THREE.ShaderMaterial({
    name: 'grade',
    uniforms: { tColor: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uReplay: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uReplay;
      varying vec2 vUv;
      ${HASH}
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        if (uReplay > 0.5) {
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, vec3(l) * vec3(0.92, 0.97, 1.08), 0.35);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec2 q = vUv - 0.5;
        gl_FragColor.rgb *= 1.0 - dot(q, q) * 0.38;
        gl_FragColor.rgb += (pp_hash(vUv * uRes + fract(uTime) * 17.0) - 0.5) / 255.0;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** CCTV-style visible feed. */
export function createVisibleFeedMaterial() {
  return new THREE.ShaderMaterial({
    name: 'feed-visible',
    uniforms: {
      tColor: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uStale: { value: 0 },
      uNoise: { value: 0.035 },
      uSat: { value: 0.8 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uStale;
      uniform float uNoise;
      uniform float uSat;
      varying vec2 vUv;
      ${HASH}
      void main() {
        vec2 uv = vUv;
        // faint chromatic fringing toward the edges (cheap lens character)
        vec2 dir = (uv - 0.5) * 0.0016;
        vec3 c;
        c.r = texture2D(tColor, uv + dir).r;
        c.g = texture2D(tColor, uv).g;
        c.b = texture2D(tColor, uv - dir).b;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // security-camera exposure: darker and more contrasty than the operator view so pale sand
        // and white cladding keep their detail instead of washing out
        c = mix(vec3(l), c, uSat) * 0.66;
        // graduated top: outdoor cameras expose for the ground, so the bright sky band is held back
        c *= mix(1.0, 0.86, smoothstep(0.55, 1.0, uv.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 x = clamp(gl_FragColor.rgb, 0.0, 1.0);
        x = pow(x, vec3(1.08));
        x = mix(x, x * x * (3.0 - 2.0 * x), 0.55);
        gl_FragColor.rgb = smoothstep(0.015, 1.0, x);
        float n = pp_hash(uv * uRes + fract(uTime * 3.7) * 91.0) - 0.5;
        gl_FragColor.rgb += n * uNoise;
        gl_FragColor.rgb *= 0.97 + 0.03 * sin(uv.y * uRes.y * 1.7);
        vec2 q = uv - 0.5;
        gl_FragColor.rgb *= 1.0 - dot(q, q) * 0.55;
        if (uStale > 0.5) {
          float g = dot(gl_FragColor.rgb, vec3(0.3333));
          float band = step(0.985, fract(uv.y * 3.0 + uTime * 0.21));
          gl_FragColor.rgb = vec3(g * 0.55) + band * 0.12 + (pp_hash(uv * uRes + uTime * 50.0) - 0.5) * 0.08;
        }
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** Thermal feed: optics blur, hot-area glow, palette mapping, sensor noise, scanlines. */
export function createThermalFeedMaterial(palette: THREE.Texture) {
  return new THREE.ShaderMaterial({
    name: 'feed-thermal',
    uniforms: {
      tHeat: { value: null },
      tPalette: { value: palette },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uRange: { value: new THREE.Vector2(0.2, 1.08) },
      uStale: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tHeat;
      uniform sampler2D tPalette;
      uniform vec2 uRes;
      uniform float uTime;
      uniform vec2 uRange;
      uniform float uStale;
      varying vec2 vUv;
      ${HASH}
      float heatAt(vec2 uv) { return texture2D(tHeat, uv).r; }
      void main() {
        vec2 px = 1.0 / uRes;
        float c0 = heatAt(vUv);
        float near = (heatAt(vUv + vec2(px.x, 0.0)) + heatAt(vUv - vec2(px.x, 0.0)) + heatAt(vUv + vec2(0.0, px.y)) + heatAt(vUv - vec2(0.0, px.y))) * 0.25;
        float wide = (heatAt(vUv + vec2(px.x, px.y) * 2.5) + heatAt(vUv - vec2(px.x, px.y) * 2.5) + heatAt(vUv + vec2(px.x, -px.y) * 2.5) + heatAt(vUv + vec2(-px.x, px.y) * 2.5)) * 0.25;
        // digital detail enhancement (DDE): lift edges the way real thermal cores do
        float h = c0 * 0.36 + near * 0.64 + (near - wide) * 1.35;
        float glow = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 o = vec2(cos(a), sin(a)) * px * 4.0;
          glow += max(heatAt(vUv + o) - 0.82, 0.0);
        }
        h += glow * 0.09;
        float x = clamp((h - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
        x = pow(x, 1.08);
        x += (pp_hash(vUv * uRes + fract(uTime * 2.3) * 113.0) - 0.5) * 0.03;
        vec3 col = texture2D(tPalette, vec2(clamp(x, 0.002, 0.998), 0.5)).rgb;
        col *= 0.95 + 0.05 * sin(vUv.y * uRes.y * 3.14159);
        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.5;
        if (uStale > 0.5) col = vec3(dot(col, vec3(0.333)) * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Fusion: visible luminance with thermal colour on warm areas (MSX-style blend). */
export function createFusionFeedMaterial(palette: THREE.Texture) {
  return new THREE.ShaderMaterial({
    name: 'feed-fusion',
    uniforms: {
      tColor: { value: null },
      tHeat: { value: null },
      tPalette: { value: palette },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uRange: { value: new THREE.Vector2(0.2, 1.08) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tHeat;
      uniform sampler2D tPalette;
      uniform vec2 uRes;
      uniform float uTime;
      uniform vec2 uRange;
      varying vec2 vUv;
      ${HASH}
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        l = l / (1.0 + l);
        l = pow(l, 1.0 / 2.2);
        float h = texture2D(tHeat, vUv).r;
        float x = clamp((h - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
        vec3 th = texture2D(tPalette, vec2(clamp(x, 0.002, 0.998), 0.5)).rgb;
        float a = smoothstep(0.58, 0.8, x);
        vec3 base = vec3(l) * vec3(0.92, 0.97, 1.0);
        vec3 col = mix(base, th, a * 0.85);
        col += (pp_hash(vUv * uRes + fract(uTime) * 71.0) - 0.5) * 0.025;
        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
