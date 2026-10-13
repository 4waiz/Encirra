/**
 * Chooses, per building, between the Blender kit and the procedural fallback. While the kit is
 * loading (or for any asset that is missing / failed) the procedural massing is shown.
 */
import { useMemo } from 'react';
import { kitFiles, kitManifest, useKitSignature } from '../assets/kit';
import { Buildings } from './Buildings';
import { Facilities } from './Facilities';
import { KIT_BUILDING_FILES, KitBuildings, resolvePlacements } from './KitBuildings';

export function BuildingsLayer() {
  const sig = useKitSignature(KIT_BUILDING_FILES);
  const placements = useMemo(() => {
    if (!sig.startsWith('ready:')) return [];
    const m = kitManifest();
    return m ? resolvePlacements(m, kitFiles(KIT_BUILDING_FILES)) : [];
  }, [sig]);
  const covered = useMemo(() => new Set(placements.map((p) => p.b.index)), [placements]);
  const coveredFacilities = useMemo(() => new Set(placements.filter((p) => p.b.facilityId).map((p) => p.b.facilityId as string)), [placements]);
  return (
    <>
      {placements.length > 0 && <KitBuildings placements={placements} signature={sig} />}
      <Buildings skip={covered} />
      <Facilities skip={coveredFacilities} />
    </>
  );
}
