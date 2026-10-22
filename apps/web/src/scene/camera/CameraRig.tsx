/**
 * Camera: drei CameraControls with limits, smooth scripted transitions for every named shot and
 * for focus-on-selection (store.camera.request), and a slow cinematic auto-orbit that pauses on
 * user input.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useTwin, type CameraRequest } from '@/state/store';
import { HOME_FOV, LIMITS, SHOTS } from './shots';
import { focusTargetFor } from '../interaction/selection';

interface Tween {
  p0: Vector3;
  t0: Vector3;
  p1: Vector3;
  t1: Vector3;
  fov0: number;
  fov1: number;
  start: number;
  dur: number;
  lift: number;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tween = useRef<Tween | null>(null);
  const lastNonce = useRef<number>(-1);
  const pauseUntil = useRef(0);
  const clock = useThree((s) => s.clock);

  // initial home framing (no transition)
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const h = SHOTS.home;
    camera.fov = h.fov ?? HOME_FOV;
    camera.near = 2;
    camera.far = 14000;
    camera.updateProjectionMatrix();
    c.setLookAt(...h.position, ...h.target, false);
    c.minDistance = LIMITS.minDistance;
    c.maxDistance = LIMITS.maxDistance;
    c.minPolarAngle = LIMITS.minPolarAngle;
    c.maxPolarAngle = LIMITS.maxPolarAngle;
    c.setBoundary(new Box3(new Vector3(...LIMITS.boundary.min), new Vector3(...LIMITS.boundary.max)));
    c.boundaryFriction = 0.3;
    c.smoothTime = 0.35;
    c.draggingSmoothTime = 0.12;
    c.dollyToCursor = true;
    c.dollySpeed = 0.6;
    c.azimuthRotateSpeed = 0.6;
    c.polarRotateSpeed = 0.6;
    c.truckSpeed = 1.2;
    const onStart = () => {
      tween.current = null;
      pauseUntil.current = clock.elapsedTime + 8;
    };
    c.addEventListener('controlstart', onStart);
    return () => c.removeEventListener('controlstart', onStart);
  }, [camera, clock]);

  const start = (req: CameraRequest) => {
    const c = ref.current;
    if (!c) return;
    const p0 = c.getPosition(new Vector3());
    const t0 = c.getTarget(new Vector3());
    let p1: Vector3;
    let t1: Vector3;
    let fov1 = camera.fov;
    let dur = req.durationS ?? 2.0;
    if (req.focus) {
      const f = focusTargetFor(req.focus);
      if (!f) return;
      // elements buried in the block (distribution mains, junctions) need the x-ray view
      if (f.underground && (req.focus.kind === 'pipe' || req.focus.kind === 'junction')) {
        const st = useTwin.getState();
        // gallery mains / headers (front z > 144 or west x < -234) are visible in the cut-away
        const buried = f.center[2] < 144 && f.center[0] > -234;
        if (buried && !st.layers.underground) st.setLayer('underground', true);
      }
      t1 = new Vector3(...f.center);
      // keep the current azimuth, settle at a comfortable oblique angle
      const dir = p0.clone().sub(t0);
      dir.y = 0;
      if (dir.lengthSq() < 1) dir.set(-0.35, 0, 1);
      dir.normalize();
      // gallery elements are framed from outside the cut face at a low angle; elements buried in
      // the block are framed from above (the x-ray view reveals them)
      const inGallery = f.underground && !(f.center[2] < 144 && f.center[0] > -234);
      const buriedTarget = f.underground && !inGallery;
      if (inGallery) {
        // look into the cut-away from outside the face that exposes the element
        if (f.center[0] < -234 && f.center[2] < 144) dir.set(-1, 0, 0.3).normalize();
        else if (dir.z < 0.35) dir.set(-0.3, 0, 1).normalize();
      }
      const elev = MathUtils.degToRad(inGallery ? 14 : buriedTarget ? 40 : 33);
      const dist = buriedTarget ? Math.max(170, f.radius * 3.2) : f.radius * 2.4;
      p1 = t1.clone().add(new Vector3(dir.x * Math.cos(elev), Math.sin(elev), dir.z * Math.cos(elev)).multiplyScalar(dist));
      fov1 = 34;
      dur = req.durationS ?? 1.6;
    } else {
      const s = SHOTS[req.shot ?? 'home'] ?? SHOTS.home;
      p1 = new Vector3(...s.position);
      t1 = new Vector3(...s.target);
      fov1 = s.fov ?? HOME_FOV;
      dur = req.durationS ?? s.duration ?? 2.0;
    }
    const travel = p0.distanceTo(p1);
    tween.current = {
      p0,
      t0,
      p1,
      t1,
      fov0: camera.fov,
      fov1,
      start: clock.elapsedTime,
      dur: Math.max(0.05, dur),
      lift: Math.min(160, travel * 0.18),
    };
  };

  // react to camera requests without re-rendering (transient subscription)
  useEffect(() => {
    const unsub = useTwin.subscribe((s, prev) => {
      const r = s.camera.request;
      if (r && r !== prev.camera.request && r.nonce !== lastNonce.current) {
        lastNonce.current = r.nonce;
        start(r);
      }
    });
    const r = useTwin.getState().camera.request;
    if (r && r.nonce !== lastNonce.current) {
      lastNonce.current = r.nonce;
      start(r);
    }
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adaptive lens shift: centre the composition on the free band between the dashboard cards
  // (store.overlayLayout.safe) instead of the raw viewport centre. A vertical view offset keeps
  // the viewing angle (so the cut faces stay visible) and shifts everything uniformly, including
  // the 3D labels and picking.
  // When the free band is tall (dashboard cards hidden in focus mode) the lens also zooms in, by
  // rendering a centred sub-window of the frame, so the district fills the space instead of
  // shrinking into the middle. Camera pose, fov and the user's dolly are untouched.
  // Side-rail layouts (a narrow, tall centre band) are handled too: the lens also shifts horizontally to
  // the band centre, and the zoom is capped by the band width (it may zoom out a little below 1).
  const shift = useRef(0);
  const shiftX = useRef(0);
  const zoom = useRef(1);
  const size = useThree((s) => s.size);
  useFrame(() => {
    const ol = useTwin.getState().overlayLayout;
    const H = size.height;
    const W = size.width;
    const bandCentre = ol ? ol.safe.y + ol.safe.height / 2 : H * 0.495;
    const bandCentreX = ol ? ol.safe.x + ol.safe.width / 2 : W / 2;
    const bandRatio = ol ? ol.safe.height / H : 0.45;
    const bandRatioW = ol ? ol.safe.width / W : 1;
    const targetShift = MathUtils.clamp(H / 2 - bandCentre, -H * 0.32, H * 0.32);
    const targetShiftX = MathUtils.clamp(W / 2 - bandCentreX, -W * 0.32, W * 0.32);
    // height-driven zoom (focus mode), capped so the district (≈ 50 % of the frame width at zoom 1)
    // still fits the band width with a margin
    const zoomH = MathUtils.clamp(0.55 + 0.9 * bandRatio, 1, 1.38);
    // the fov is vertical, so the district's share of the frame width grows as the aspect narrows
    // (≈ 52 % at 16:9, ≈ 2× the width on a portrait phone)
    const districtFrac = (0.52 * (16 / 9)) / Math.max(0.3, W / H);
    const zoomW = (bandRatioW * 0.92) / districtFrac;
    const targetZoom = MathUtils.clamp(Math.min(zoomH, zoomW), 0.32, 1.38);
    shift.current += (targetShift - shift.current) * 0.08;
    shiftX.current += (targetShiftX - shiftX.current) * 0.08;
    zoom.current += (targetZoom - zoom.current) * 0.08;
    const s = Math.round(shift.current * 2) / 2;
    const sx = Math.round(shiftX.current * 2) / 2;
    const z = Math.round(zoom.current * 1000) / 1000;
    const v = camera.view;
    if (Math.abs(s) < 0.5 && Math.abs(sx) < 0.5 && Math.abs(z - 1) < 0.002) {
      if (v && v.enabled) camera.clearViewOffset();
      return;
    }
    const w = W / z;
    const h = H / z;
    const x = (W - w) / 2 + sx / z;
    const y = H / 2 - (H / 2 - s) / z;
    if (!v || !v.enabled || v.offsetX !== x || v.offsetY !== y || v.width !== w || v.fullWidth !== W || v.fullHeight !== H) {
      camera.setViewOffset(W, H, x, y, w, h);
    }
  });

  const tmpP = new Vector3();
  const tmpT = new Vector3();
  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    const tw = tween.current;
    if (tw) {
      const k = Math.min(1, (clock.elapsedTime - tw.start) / tw.dur);
      const e = easeInOut(k);
      tmpP.lerpVectors(tw.p0, tw.p1, e);
      tmpP.y += Math.sin(Math.PI * e) * tw.lift;
      tmpT.lerpVectors(tw.t0, tw.t1, e);
      c.setLookAt(tmpP.x, tmpP.y, tmpP.z, tmpT.x, tmpT.y, tmpT.z, false);
      const fov = tw.fov0 + (tw.fov1 - tw.fov0) * e;
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (k >= 1) tween.current = null;
      return;
    }
    const mode = useTwin.getState().camera.mode;
    if (mode === 'cinematic' && clock.elapsedTime > pauseUntil.current) {
      c.rotate(MathUtils.degToRad(2.2) * dt, 0, false);
    }
    // never let the user orbit below the lower city ground
    c.getPosition(tmpP);
    if (tmpP.y < LIMITS.minCameraY) {
      c.getTarget(tmpT);
      const dist = tmpP.distanceTo(tmpT);
      const cosPolar = MathUtils.clamp((LIMITS.minCameraY - tmpT.y) / Math.max(dist, 1e-3), -1, 1);
      c.rotatePolarTo(Math.acos(cosPolar), false);
    }
  });

  return <CameraControls ref={ref} makeDefault />;
}
