/**
 * Types for generated/city-layout.json (produced by scripts/build-layout.mjs from
 * config/district.json). World convention shared by the 3D twin, Blender pipeline and
 * mini-maps: metres, Y up, X east (right in the default view), Z south (towards the
 * default camera). Plan positions are [x, z]; the district surface is at y = 0.
 */

export type BuildingKind =
  | 'tower-residential'
  | 'tower-office'
  | 'midrise-residential'
  | 'lowrise-residential'
  | 'villa'
  | 'commercial-podium'
  | 'mall'
  | 'office-complex'
  | 'substation'
  | 'hospital'
  | 'emergency-ops'
  | 'pump-station'
  | 'water-tower'
  | 'desalination-inlet'
  | 'cooling-plant';

export interface LayoutBuilding {
  id: string; // "BLD-012" or "BLD-<facilityId>"
  kind: BuildingKind;
  variant: number;
  pos: [number, number];
  rot: number; // radians about +Y
  size: [number, number]; // footprint width (x) × depth (z) before rotation, metres
  height: number; // metres
  floors: number;
  bus: number | null; // 1-based benchmark bus number supplying the building (null = not on the modelled feeder)
  facilityId: string | null;
  name: string | null;
  roofSolar: boolean;
}

export interface LayoutRoad {
  id: string;
  kind: 'avenue' | 'street';
  width: number;
  points: [number, number][];
}

export interface LayoutBlock {
  id: string;
  col: number;
  row: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  edge: boolean;
  zone: 'West' | 'East';
}

export interface CityLayout {
  schemaVersion: 1;
  generatedFrom: string;
  seed: number;
  platform: { minX: number; maxX: number; minZ: number; maxZ: number; surfaceY: number; undergroundDepth: number };
  roads: LayoutRoad[];
  blocks: LayoutBlock[];
  buildings: LayoutBuilding[];
  props: {
    palms: [number, number, number, number][]; // x, z, scale, rotation
    streetLights: [number, number, number][]; // x, z, rotation
  };
  electrical: {
    lineRoutes: Record<string, [number, number][]>; // keyed by line id (0-based)
    cableY: number;
  };
  labels: { id: string; facilityId: string; anchor: [number, number, number] }[];
  stats: { buildings: number; palms: number; streetLights: number };
}
