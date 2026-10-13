/**
 * Named camera shots (keep in sync with `CameraShot` in src/state/store.ts).
 * World: metres, X east (right in the home view), Z south (towards the home camera), Y up.
 * District platform: x −250…250, z −160…160, surface y = 0, cut-away galleries along the
 * south (front) and west faces.
 */
import type { CameraShot } from '@/state/store';

export interface ShotDef {
  position: [number, number, number];
  target: [number, number, number];
  /** vertical field of view (deg) */
  fov?: number;
  /** default transition duration (s) */
  duration?: number;
  /** reveal the underground network (x-ray) while this shot is active */
  xray?: boolean;
}

export const HOME_FOV = 30;

export const SHOTS: Record<CameraShot, ShotDef> = {
  // reference composition: high oblique from the south-south-west, district in the middle band
  home: { position: [-205, 245, 600], target: [22, -14, -2], fov: HOME_FOV, duration: 2.2 },
  aerial: { position: [-420, 640, 860], target: [10, 0, -60], fov: 32, duration: 2.6 },
  substation: { position: [-62, 92, 128], target: [0, 4, 0], fov: 34, duration: 2.0 },
  hospital: { position: [-150, 88, 120], target: [-80, 14, 2], fov: 34, duration: 2.0 },
  'ps-1': { position: [62, 46, 262], target: [100, -10, 148], fov: 34, duration: 2.0 },
  'ps-2': { position: [-210, 42, 262], target: [-162, -11, 148], fov: 34, duration: 2.0 },
  'tank-t1': { position: [128, 78, 280], target: [176, 22, 138], fov: 34, duration: 2.0 },
  'tank-t2': { position: [-300, 74, 258], target: [-228, 20, 138], fov: 34, duration: 2.0 },
  'west-district': { position: [-330, 230, 300], target: [-138, 0, 30], fov: 32, duration: 2.2 },
  'underground-west': { position: [-380, 40, 240], target: [-205, -16, 120], fov: 34, duration: 2.2, xray: true },
  'underground-front': { position: [-60, 70, 520], target: [-10, -18, 140], fov: 32, duration: 2.2 },
  'recovery-path': { position: [-300, 300, 360], target: [-110, 0, 20], fov: 32, duration: 2.2 },
  'overview-top': { position: [0, 820, 120], target: [0, 0, 0], fov: 32, duration: 2.4 },
};

/** Orbit / zoom limits for user control. */
export const LIMITS = {
  minDistance: 30,
  maxDistance: 1500,
  minPolarAngle: 0.05,
  maxPolarAngle: Math.PI * 0.47,
  // target must stay over the district (+ margin)
  boundary: { min: [-420, -45, -360], max: [420, 120, 360] } as { min: [number, number, number]; max: [number, number, number] },
  minCameraY: -40,
};
