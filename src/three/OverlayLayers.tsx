import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ZONES, SITE } from '../data/site';
import { SENSORS } from '../simulation/sensors';
import { engine } from '../simulation/engine';
import { useUI, type Selection } from '../store/ui';
import { useSim } from '../store/sim';
import { registerPickable } from './picking';
import { sceneClock } from './sceneClock';
import { assetVisual } from './AssetLayer';
import { LAYER } from './layers';
import { windVector } from '../utils/math';
import type { Polyline } from '../data/site';

const overlay = (o: THREE.Object3D) => {
  o.traverse((c) => c.layers.set(LAYER.OVERLAY));
  return o;
};

const sameSel = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------------------------ zones

export function ZonesLayer() {
  const visible = useUI((s) => s.layers.zones);
  const hovered = useUI((s) => s.hovered);
  const selection = useUI((s) => s.selection);

  const zones = useMemo(
    () =>
      ZONES.map((z) => {
        const w = z.maxX - z.minX;
        const d = z.maxZ - z.minZ;
        const cx = (z.minX + z.maxX) / 2;
        const cz = (z.minZ + z.maxZ) / 2;
        const color = new THREE.Color(z.color);
        const fillGeo = new THREE.PlaneGeometry(w, d);
        fillGeo.rotateX(-Math.PI / 2);
        const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false });
        const fill = new THREE.Mesh(fillGeo, fillMat);
        fill.position.set(cx, 0.55, cz);
        fill.renderOrder = 1;
        const pts = [
          new THREE.Vector3(z.minX, 0.7, z.minZ),
          new THREE.Vector3(z.maxX, 0.7, z.minZ),
          new THREE.Vector3(z.maxX, 0.7, z.maxZ),
          new THREE.Vector3(z.minX, 0.7, z.maxZ),
          new THREE.Vector3(z.minX, 0.7, z.minZ),
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineDashedMaterial({ color, dashSize: 9, gapSize: 6, transparent: true, opacity: 0.75 });
        const line = new THREE.Line(lineGeo, lineMat);
        line.computeLineDistances();
        const boxGeo = new THREE.BoxGeometry(w, z.height, d);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
        edges.position.set(cx, z.height / 2, cz);
        const pick = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.set(cx, z.height / 2, cz);
        pick.updateMatrixWorld(true);
        const group = new THREE.Group();
        group.add(fill, line, edges);
        overlay(group);
        return { zone: z, group, fill, fillMat, line, lineMat, edges, pick };
      }),
    [],
  );

  useEffect(() => {
    const offs = zones.map((z) =>
      registerPickable({
        object: z.pick,
        selection: { kind: 'zone', id: z.zone.id },
        priority: z.zone.overlay ? 3 : 2,
        area: (z.zone.maxX - z.zone.minX) * (z.zone.maxZ - z.zone.minZ),
      }),
    );
    return () => offs.forEach((f) => f());
  }, [zones]);

  useEffect(() => {
    for (const z of zones) {
      const sel: Selection = { kind: 'zone', id: z.zone.id };
      const isHover = sameSel(hovered, sel);
      const isSel = sameSel(selection, sel);
      const show = (visible && z.zone.overlay) || isHover || isSel;
      z.group.visible = show;
      z.fill.visible = (visible && z.zone.overlay) || isSel || isHover;
      z.line.visible = visible && z.zone.overlay;
      z.edges.visible = isHover || isSel;
      z.fillMat.opacity = isSel ? 0.16 : isHover ? 0.12 : 0.06;
      (z.edges.material as THREE.LineBasicMaterial).opacity = isSel ? 0.95 : 0.6;
    }
  }, [zones, visible, hovered, selection]);

  return (
    <group name="zones">
      {zones.map((z) => (
        <primitive key={z.zone.id} object={z.group} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------ weather

const ARROW_VERT = /* glsl */ `
  attribute vec3 aBase;
  attribute float aPhase;
  uniform vec2 uWind;
  uniform float uTime;
  uniform float uSpeed;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    float spacing = 150.0;
    float travel = mod(uTime * uSpeed * 6.0 + aPhase * spacing, spacing);
    vec2 dir = uWind;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 local = vec2(position.x, position.z);
    vec2 rotated = perp * local.x + dir * local.y;
    vec3 p = aBase + vec3(dir.x, 0.0, dir.y) * (travel - spacing * 0.5) + vec3(rotated.x, 0.0, rotated.y);
    vAlpha = sin(travel / spacing * 3.14159);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const ARROW_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uAlpha * uOpacity);
  }
`;

/** Miter-offsets a simple polygon outward by `d` (dark outline behind each wind chevron). */
function offsetPolygon(pts: THREE.Vector2[], d: number) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area < 0 ? 1 : -1;
  const normal = (a: THREE.Vector2, b: THREE.Vector2) => {
    const e = b.clone().sub(a).normalize();
    return new THREE.Vector2(-e.y * sign, e.x * sign);
  };
  return pts.map((cur, i) => {
    const n0 = normal(pts[(i + n - 1) % n], cur);
    const n1 = normal(cur, pts[(i + 1) % n]);
    const m = n0.clone().add(n1).normalize();
    return cur.clone().addScaledVector(m, d / Math.max(0.2, m.dot(n1)));
  });
}

export function WeatherLayer() {
  const visible = useUI((s) => s.layers.weather);
  const opacity = useRef(0);
  const { arrows, outlines, vane, uniforms } = useMemo(() => {
    const uniforms = { uWind: { value: new THREE.Vector2(0.7, 0.7) }, uTime: { value: 0 }, uSpeed: { value: 3.3 }, uOpacity: { value: 0 } };
    // chevron in local (x = across, z = along wind); a dark miter outline drawn underneath keeps the
    // cyan fill legible on white roofs, pale sand and open sea alike
    const S = 1.3;
    const chevron = [
      [-9, -6],
      [0, 6],
      [9, -6],
      [5, -6],
      [0, 1],
      [-5, -6],
    ].map(([x, y]) => new THREE.Vector2(x * S, y * S));
    const bases: number[] = [];
    const phases: number[] = [];
    for (let x = -720; x <= 720; x += 160) {
      for (let z = -520; z <= 420; z += 150) {
        bases.push(x + ((z / 150) % 2) * 80, 62, z);
        phases.push(Math.random());
      }
    }
    const aBase = new THREE.InstancedBufferAttribute(new Float32Array(bases), 3);
    const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(phases), 1);
    const instanced = (pts: THREE.Vector2[], color: THREE.Color, alpha: number, order: number) => {
      const sg = new THREE.ShapeGeometry(new THREE.Shape(pts));
      sg.rotateX(Math.PI / 2); // shape y -> world z (along wind)
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = sg.index;
      ig.setAttribute('position', sg.getAttribute('position'));
      ig.setAttribute('uv', sg.getAttribute('uv'));
      ig.setAttribute('aBase', aBase);
      ig.setAttribute('aPhase', aPhase);
      ig.instanceCount = phases.length;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uColor: { value: color }, uAlpha: { value: alpha } },
        vertexShader: ARROW_VERT,
        fragmentShader: ARROW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ig, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      return overlay(mesh) as THREE.Mesh;
    };
    const outlines = instanced(offsetPolygon(chevron, 1.5), new THREE.Color(0.004, 0.018, 0.045), 0.62, 5);
    const arrows = instanced(chevron, new THREE.Color(0.02, 0.4, 0.95), 0.92, 6);
    // wind vane above the met mast
    const vg = new THREE.ConeGeometry(4, 16, 3);
    vg.rotateX(Math.PI / 2);
    const vane = new THREE.Mesh(vg, new THREE.MeshBasicMaterial({ color: '#38a8f0', transparent: true, opacity: 0.9 }));
    vane.position.set(SITE.metMast.x, SITE.metMast.h + 12, SITE.metMast.z);
    overlay(vane);
    return { arrows, outlines, vane, uniforms };
  }, []);

  useFrame((_, dt) => {
    const t = sceneClock.t;
    const w = windVector(engine.windDirAt(t));
    uniforms.uWind.value.lerp(new THREE.Vector2(w.x, w.z), 1 - Math.exp(-dt * 2)).normalize();
    uniforms.uSpeed.value = engine.windSpeedAt(t) / 3.6;
    uniforms.uTime.value += dt;
    opacity.current += ((visible ? 1 : 0) - opacity.current) * (1 - Math.exp(-dt * 6));
    uniforms.uOpacity.value = opacity.current;
    arrows.visible = outlines.visible = vane.visible = opacity.current > 0.01;
    vane.rotation.y = Math.atan2(uniforms.uWind.value.x, uniforms.uWind.value.y);
    (vane.material as THREE.MeshBasicMaterial).opacity = 0.9 * opacity.current;
  });

  return (
    <>
      <primitive object={outlines} />
      <primitive object={arrows} />
      <primitive object={vane} />
    </>
  );
}

// ------------------------------------------------------------------------------------------ UGV route

const ROUTE_VERT = /* glsl */ `
  attribute float aDist;
  varying float vDist;
  varying vec2 vUv;
  void main() {
    vDist = aDist;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;
const ROUTE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDone;
  uniform float uOpacity;
  varying float vDist;
  varying vec2 vUv;
  void main() {
    if (vDist < uDone) discard;
    float dash = step(0.45, fract((vDist - uTime * 14.0) / 9.0));
    float edge = 1.0 - smoothstep(0.35, 0.5, abs(vUv.y - 0.5));
    vec3 col = vec3(0.3, 0.75, 1.0);
    gl_FragColor = vec4(col * 1.6, (0.35 + 0.65 * dash) * edge * 0.85 * uOpacity);
  }
`;

function buildRibbon(path: Polyline, width = 2.6) {
  const pts = path.pts;
  const pos: number[] = [];
  const uv: number[] = [];
  const dist: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz * width * 0.5;
    const nz = dx * width * 0.5;
    pos.push(pts[i].x + nx, 0, pts[i].z + nz, pts[i].x - nx, 0, pts[i].z - nz);
    uv.push(path.cum[i], 0, path.cum[i], 1);
    dist.push(path.cum[i], path.cum[i]);
    if (i < pts.length - 1) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setIndex(idx);
  return g;
}

export function RouteLayer() {
  const visible = useUI((s) => s.layers.assets);
  const state = useRef<{ path: Polyline | null; mesh: THREE.Mesh | null; dest: THREE.Mesh | null }>({ path: null, mesh: null, dest: null });
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uDone: { value: 0 }, uOpacity: { value: 1 } }), []);
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.name = 'route';
    return g;
  }, []);
  const material = useMemo(
    () => new THREE.ShaderMaterial({ uniforms, vertexShader: ROUTE_VERT, fragmentShader: ROUTE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    [uniforms],
  );
  const destMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#6cc4ff', transparent: true, opacity: 0.8, depthWrite: false }), []);

  useEffect(
    () => () => {
      material.dispose();
      destMat.dispose();
      state.current.mesh?.geometry.dispose();
      state.current.dest?.geometry.dispose();
    },
    [material, destMat],
  );

  useFrame((_, dt) => {
    const t = sceneClock.t;
    const path = engine.ugv.activeRoute(t);
    const s = state.current;
    if (path !== s.path) {
      if (s.mesh) {
        group.remove(s.mesh);
        s.mesh.geometry.dispose();
      }
      if (s.dest) {
        group.remove(s.dest);
        s.dest.geometry.dispose();
      }
      s.path = path;
      s.mesh = null;
      s.dest = null;
      if (path) {
        const m = new THREE.Mesh(buildRibbon(path), material);
        m.position.y = 0.45;
        m.renderOrder = 3;
        const end = path.pts[path.pts.length - 1];
        const dg = new THREE.RingGeometry(3.2, 4.2, 40);
        dg.rotateX(-Math.PI / 2);
        const d = new THREE.Mesh(dg, destMat);
        d.position.set(end.x, 0.5, end.z);
        group.add(m, d);
        overlay(m);
        overlay(d);
        s.mesh = m;
        s.dest = d;
      }
    }
    if (s.path) {
      const p = engine.ugvPose(t);
      // distance travelled ≈ projection of the vehicle onto the path
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < s.path.pts.length; i++) {
        const q = s.path.pts[i];
        const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (d < bestD) (bestD = d), (best = s.path.cum[i]);
      }
      uniforms.uDone.value = best;
      if (s.dest) s.dest.scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.08);
    }
    uniforms.uTime.value += dt;
    group.visible = visible;
  });

  return <primitive object={group} />;
}

// ------------------------------------------------------------------------------------------ sensor rings + selection

const STATUS_COLOR: Record<string, THREE.Color> = {
  online: new THREE.Color('#3cc8dc'),
  elevated: new THREE.Color('#f2b33d'),
  alert: new THREE.Color('#ff6a3d'),
  offline: new THREE.Color('#6b7785'),
};

export function MarkerLayer() {
  const sensors = useSim((s) => s.sensors);
  const selection = useUI((s) => s.selection);
  const labels = useUI((s) => s.settings.labels);
  const nodes = useMemo(() => SENSORS, []);
  const rings = useMemo(() => {
    const g = new THREE.RingGeometry(2.6, 3.4, 40);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const im = new THREE.InstancedMesh(g, m, nodes.length);
    im.renderOrder = 3;
    im.frustumCulled = false;
    overlay(im);
    return im;
  }, [nodes]);
  const select = useMemo(() => {
    const g = new THREE.RingGeometry(5.2, 6.4, 64, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#e9f6ff', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 4;
    overlay(mesh);
    const tick = new THREE.Mesh(new THREE.RingGeometry(7.4, 7.9, 64, 1, 0, Math.PI * 0.5), mat);
    tick.geometry.rotateX(-Math.PI / 2);
    overlay(tick);
    const group = new THREE.Group();
    group.add(mesh, tick);
    return { group, tick };
  }, []);

  useEffect(
    () => () => {
      rings.geometry.dispose();
      (rings.material as THREE.Material).dispose();
    },
    [rings],
  );

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), s: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion() }), []);

  useFrame(() => {
    const now = performance.now();
    nodes.forEach((n, i) => {
      const st = sensors[n.id]?.status ?? 'online';
      const pulse = st === 'elevated' || st === 'alert' ? 1 + 0.35 * ((now / 1100 + i * 0.13) % 1) : 1;
      tmp.p.set(n.x, n.kind === 'met' ? 0.6 : 0.4, n.z);
      tmp.s.setScalar(pulse * (n.kind === 'met' ? 1.6 : 1));
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      rings.setMatrixAt(i, tmp.m);
      rings.setColorAt(i, STATUS_COLOR[st] ?? STATUS_COLOR.online);
    });
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    rings.visible = labels;

    // selection ring follows the selected sensor / asset
    let target: { x: number; z: number; r: number } | null = null;
    if (selection?.kind === 'sensor') {
      const s = SENSORS.find((x) => x.id === selection.id);
      if (s) target = { x: s.x, z: s.z, r: 1 };
    } else if (selection?.kind === 'asset') {
      if (selection.id === 'UGV-01') target = { x: assetVisual.ugv.x, z: assetVisual.ugv.z, r: 1.1 };
      else if (selection.id === 'UAV-01') {
        target = { x: assetVisual.uav.x, z: assetVisual.uav.z, r: 2.2 };
      } else if (selection.id === 'TEAM-1') target = { x: assetVisual.team[0].x, z: assetVisual.team[0].z, r: 0.9 };
      else target = { x: 470, z: 192.5, r: 1.4 };
    } else if (selection?.kind === 'location') target = { x: selection.x, z: selection.z, r: 3 };
    select.group.visible = !!target;
    if (target) {
      select.group.position.set(target.x, 0.6, target.z);
      const k = target.r * (1 + Math.sin(now / 380) * 0.04);
      select.group.scale.setScalar(k);
      select.tick.rotation.y = now / 900;
    }
  });

  return (
    <>
      <primitive object={rings} />
      <primitive object={select.group} />
    </>
  );
}
