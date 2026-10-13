/**
 * Visual constants for the 3D twin (colour language, materials, lighting).
 * Colour language (electrical): energized amber, faulted red, restored green, isolated/de-energized grey.
 * Water: cyan flow; pressure-driven amber/red on distribution mains.
 */
import { Color } from 'three';

export const COLORS = {
  energized: '#F5A623',
  faulted: '#F04438',
  restored: '#17A769',
  isolated: '#6B7280',
  open: '#8A93A0',
  water: '#00BFEA',
  waterLow: '#F5A623',
  waterCritical: '#F04438',
  waterIdle: '#1C3A4A',
  labelBg: 'rgba(20,24,30,0.78)',
} as const;

/** Linear-space colours ready for shader uniforms. */
export const LIN = {
  energized: new Color(COLORS.energized),
  faulted: new Color(COLORS.faulted),
  restored: new Color(COLORS.restored),
  isolated: new Color(COLORS.isolated),
  open: new Color(COLORS.open),
  water: new Color(COLORS.water),
  waterLow: new Color(COLORS.waterLow),
  waterCritical: new Color(COLORS.waterCritical),
  waterIdle: new Color(COLORS.waterIdle),
};

/**
 * Key light (towards the light) — low warm golden-hour sun from the west-south-west, i.e. from
 * behind-left of the home camera, so the camera-facing facades are lit and long shadows fall away.
 */
export const SUN = {
  azimuthDeg: 248, // compass-like: 0 = -Z (north), 90 = +X (east), 180 = +Z (south), 270 = -X (west)
  elevationDeg: 15,
  color: '#FFD3A6',
};

/**
 * Sky glow (art direction, as in the reference): the bright dusk glow sits low on the horizon
 * behind the skyline, slightly left of the home view direction, so the towers read as silhouettes
 * against it while the district itself stays front-lit by the key light.
 */
export const SKY_GLOW = {
  azimuthDeg: 24,
  elevationDeg: 2.5,
};

function dirFrom(azDeg: number, elDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  // north = -Z, east = +X
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

export function sunDirection(): [number, number, number] {
  return dirFrom(SUN.azimuthDeg, SUN.elevationDeg);
}

export function skyGlowDirection(): [number, number, number] {
  return dirFrom(SKY_GLOW.azimuthDeg, SKY_GLOW.elevationDeg);
}

export const WORLD = {
  lowerGroundY: -48,
  skyRadius: 9000,
  fogColor: '#E9B993',
};
