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

// ------------------------------------------------------------------------------------------ ambient occlusion

const VIEW_POS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  vec3 viewPos(vec2 uv) {
    float d = textureLod(tDepth, uv, 0.0).r;
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
`;

/**
 * Screen-space ambient obscurance at half resolution: view-space normal from neighbouring depths, a
 * rotated spiral of samples inside a world-space radius, horizon-angle occlusion with distance falloff.
 */
export function createAOMaterial() {
  return new THREE.ShaderMaterial({
    name: 'ssao',
    uniforms: {
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uProjScale: { value: 1 },
      uRadius: { value: 10 },
      uIntensity: { value: 2.9 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${VIEW_POS}
      uniform vec2 uTexel;
      uniform float uProjScale;
      uniform float uRadius;
      uniform float uIntensity;
      varying vec2 vUv;
      ${HASH}
      #define SAMPLES 12
      void main() {
        float d = textureLod(tDepth, vUv, 0.0).r;
        if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }
        vec3 p = viewPos(vUv);
        vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0));
        vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0));
        vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y));
        vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y));
        vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
        vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
        vec3 n = normalize(cross(dx, dy));
        float rPix = min(uRadius * uProjScale / -p.z, 64.0);
        float rot = pp_hash(gl_FragCoord.xy) * 6.2831853;
        float occ = 0.0;
        float r2 = uRadius * uRadius;
        for (int i = 0; i < SAMPLES; i++) {
          float a = (float(i) + 0.5) / float(SAMPLES);
          float ang = a * 6.2831853 * 7.0 + rot;
          vec2 o = vec2(cos(ang), sin(ang)) * (a * rPix + 1.0) * uTexel;
          vec3 v = viewPos(vUv + o) - p;
          float vv = dot(v, v);
          float vn = dot(v, n);
          occ += max(0.0, vn * inversesqrt(vv + 1e-4) - 0.035) * (1.0 - smoothstep(0.0, r2, vv));
        }
        float ao = clamp(1.0 - uIntensity * occ / float(SAMPLES), 0.0, 1.0);
        ao = pow(ao, 1.35);
        gl_FragColor = vec4(ao, ao, ao, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** Separable depth-aware blur for the AO buffer (run once horizontally, once vertically). */
export function createAOBlurMaterial() {
  return new THREE.ShaderMaterial({
    name: 'ssao-blur',
    uniforms: {
      tAO: { value: null },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${VIEW_POS}
      uniform sampler2D tAO;
      uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        float z0 = viewPos(vUv).z;
        float sum = 0.0;
        float wsum = 0.0;
        for (int i = -3; i <= 3; i++) {
          vec2 uv = vUv + uDir * float(i);
          float z = viewPos(uv).z;
          float w = exp(-float(i * i) * 0.18) * exp(-abs(z - z0) / (0.02 * abs(z0) + 0.5));
          sum += textureLod(tAO, uv, 0.0).r * w;
          wsum += w;
        }
        float ao = sum / max(wsum, 1e-4);
        gl_FragColor = vec4(ao, ao, ao, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** Main twin view: ambient occlusion, tone mapping, gentle vignette, very light grain against banding. */
export function createGradeMaterial() {
  return new THREE.ShaderMaterial({
    name: 'grade',
    uniforms: {
      tColor: { value: null },
      tAO: { value: null },
      uAO: { value: 0 },
      uAODebug: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uReplay: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tAO;
      uniform float uAO;
      uniform float uAODebug;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uReplay;
      varying vec2 vUv;
      ${HASH}
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
        if (uAODebug > 0.5) { gl_FragColor = vec4(vec3(texture2D(tAO, vUv).r), 1.0); return; }
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
