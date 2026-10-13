/**
 * Scene graph root for the Encirra twin.
 */
import { useFrame } from '@react-three/fiber';
import { useTwin } from '@/state/store';
import { sampleLive } from './data/live';
import { updateStateTextures } from './data/stateTextures';
import { updateBuildingState } from './buildings/buildingState';
import { fx } from './runtime';
import { SkyDome, SkyEnvironment, Lights } from './env/Atmosphere';
import { Effects } from './env/Effects';
import { Platform } from './district/Platform';
import { CameraRig } from './camera/CameraRig';
import { LowerGround } from './context/LowerGround';
import { Skyline } from './context/Skyline';
import { LowerPalms } from './context/LowerPalms';
import { WaterReflection } from './context/WaterReflection';
import { Electrical } from './networks/Electrical';
import { WaterNetwork } from './networks/Water';
import { Props } from './district/Props';
import { BuildingsLayer } from './buildings/BuildingsLayer';
import { startKitLoading } from './assets/kit';
import { Labels } from './labels/Labels';
import { XrayGrid } from './district/XrayGrid';
import { GpuTimer } from './GpuTimer';

const GPU_TIMER = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('gputime') === '1';

/** Runs first every frame: store → `live` typed arrays → shared state textures. */
function LiveSampler() {
  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    fx.time = state.clock.elapsedTime;
    sampleLive();
    const layers = useTwin.getState().layers;
    const k = Math.min(1, d * 3.2);
    fx.xray += ((layers.underground ? 1 : 0) - fx.xray) * k;
    if (Math.abs(fx.xray - (layers.underground ? 1 : 0)) < 0.002) fx.xray = layers.underground ? 1 : 0;
    fx.electrical += ((layers.electrical ? 1 : 0) - fx.electrical) * k;
    fx.water += ((layers.water ? 1 : 0) - fx.water) * k;
    fx.skyline += ((layers.skyline ? 1 : 0) - fx.skyline) * k;
    updateStateTextures(state.clock.elapsedTime, d);
    updateBuildingState(state.clock.elapsedTime, d);
    fx.frames++;
    // QA statistics: when autoReset is disabled, accumulate all passes of a frame
    const info = state.gl.info;
    if (!info.autoReset) {
      fx.stats = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
    }
  }, -10);
  return null;
}

startKitLoading(['district-base.glb', 'midrise-residential.glb', 'tower-residential.glb', 'hospital.glb', 'substation.glb']);

export function Scene() {
  const surface = useTwin((s) => s.layers.surface);
  const skyline = useTwin((s) => s.layers.skyline);
  return (
    <>
      <LiveSampler />
      <SkyDome />
      <SkyEnvironment />
      <Lights />
      <group visible={skyline}>
        <LowerGround />
        <Skyline />
        <LowerPalms />
        <WaterReflection />
      </group>
      <Platform />
      <XrayGrid />
      <group visible={surface}>
        <BuildingsLayer />
        <Props />
      </group>
      <Electrical />
      <WaterNetwork />
      <Labels />
      <CameraRig />
      <Effects />
      {GPU_TIMER && <GpuTimer />}
    </>
  );
}
