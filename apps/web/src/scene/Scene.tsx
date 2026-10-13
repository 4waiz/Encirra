/**
 * Scene graph root for the Encirra twin.
 */
import { useFrame } from '@react-three/fiber';
import { useTwin } from '@/state/store';
import { sampleLive } from './data/live';
import { updateStateTextures } from './data/stateTextures';
import { fx } from './runtime';
import { SkyDome, SkyEnvironment, Lights } from './env/Atmosphere';
import { Effects } from './env/Effects';
import { Platform } from './district/Platform';
import { Buildings } from './buildings/Buildings';
import { CameraRig } from './camera/CameraRig';
import { LowerGround } from './context/LowerGround';
import { Skyline } from './context/Skyline';
import { Electrical } from './networks/Electrical';
import { WaterNetwork } from './networks/Water';
import { Props } from './district/Props';
import { Facilities } from './buildings/Facilities';
import { Labels } from './labels/Labels';

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
      </group>
      <Platform />
      <group visible={surface}>
        <Buildings />
        <Facilities />
        <Props />
      </group>
      <Electrical />
      <WaterNetwork />
      <Labels />
      <CameraRig />
      <Effects />
    </>
  );
}
