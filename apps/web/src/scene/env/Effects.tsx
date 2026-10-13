/**
 * Post-processing: optional N8AO (high tier), subtle bloom for energy lines / windows / signage,
 * ACES tone mapping, SMAA and a slight vignette.
 * Debug overrides (QA only): ?ao=0|1, ?msaa=<samples>.
 */
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { HalfFloatType } from 'three';
import { useSceneQuality } from '../runtime';

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const AO_OVERRIDE = params.get('ao');
const MSAA_OVERRIDE = params.get('msaa');

export function Effects() {
  const tier = useSceneQuality((s) => s.tier);
  const ao = AO_OVERRIDE != null ? AO_OVERRIDE === '1' : tier === 'high';
  const msaa = MSAA_OVERRIDE != null ? Number(MSAA_OVERRIDE) : 0;
  return (
    <EffectComposer multisampling={msaa} frameBufferType={HalfFloatType} key={`${tier}-${ao}-${msaa}`}>
      {ao ? <N8AO aoRadius={6} distanceFalloff={0.6} intensity={1.3} aoSamples={8} denoiseSamples={4} halfRes /> : <></>}
      <Bloom mipmapBlur intensity={tier === 'low' ? 0.6 : 0.85} luminanceThreshold={1.15} luminanceSmoothing={0.2} radius={0.68} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette offset={0.32} darkness={0.42} eskil={false} />
    </EffectComposer>
  );
}
