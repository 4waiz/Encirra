export * from './contract';
export * from './layout';

import districtJson from '../config/district.json';
import layoutJson from '../generated/city-layout.json';
import type { CityLayout } from './layout';

/** Authoritative district configuration (buses ↔ facilities ↔ water nodes, plan positions). */
export const district = districtJson;
export type DistrictConfig = typeof districtJson;

/** Generated spatial layout (roads, buildings, props, cable routes). */
export const cityLayout = layoutJson as unknown as CityLayout;
