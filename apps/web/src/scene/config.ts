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

/** Sun direction (towards the sun) — low warm dusk sun in the west-south-west. */
export const SUN = {
  azimuthDeg: 232, // compass-like: 0 = -Z (north), 90 = +X (east), 180 = +Z (south), 270 = -X (west)
  elevationDeg: 19,
  color: '#FFC79A',
};

export function sunDirection(): [number, number, number] {
  const az = (SUN.azimuthDeg * Math.PI) / 180;
  const el = (SUN.elevationDeg * Math.PI) / 180;
  // north = -Z, east = +X
  const x = Math.sin(az) * Math.cos(el);
  const z = -Math.cos(az) * Math.cos(el);
  const y = Math.sin(el);
  return [x, y, z];
}

export const WORLD = {
  lowerGroundY: -48,
  skyRadius: 9000,
  fogColor: '#E9B993',
};
