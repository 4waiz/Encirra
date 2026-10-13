/**
 * Post-processing: optional N8AO (high tier), subtle bloom for energy lines / windows / signage,
 * ACES tone mapping, SMAA and a slight vignette.
 */
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { HalfFloatType } from 'three';
import { useSceneQuality } from '../runtime';

export function Effects() {
  const tier = useSceneQuality((s) => s.tier);
  return (
    <EffectComposer multisampling={tier === 'high' ? 4 : 0} frameBufferType={HalfFloatType} key={tier}>
      {tier === 'high' ? <N8AO aoRadius={7} distanceFalloff={0.6} intensity={1.4} aoSamples={12} denoiseSamples={4} halfRes /> : <></>}
      <Bloom mipmapBlur intensity={tier === 'low' ? 0.55 : 0.75} luminanceThreshold={0.92} luminanceSmoothing={0.25} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette offset={0.32} darkness={0.42} eskil={false} />
    </EffectComposer>
  );
}
