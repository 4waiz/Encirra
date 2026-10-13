/**
 * Planar-style water reflections for the curved world.
 *
 * The skyline has a mirrored copy on REFLECTION_LAYER (mirrored about the local ground level, see
 * Skyline.tsx). Once per frame, before the post-processing composer renders the scene, that layer
 * is rendered with the main camera into a half-resolution HDR target; the water shader samples it
 * in screen space (with ripple distortion). Disabled on the low quality tier.
 */
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, type DirectionalLight, HalfFloatType, LinearFilter, Vector2, WebGLRenderTarget } from 'three';
import { REFLECTION_LAYER } from './Skyline';
import { fx, useSceneQuality } from '../runtime';

const target = new WebGLRenderTarget(4, 4, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });

/** Shared uniforms consumed by the water shader (LowerGround). */
export const reflectionUniforms = {
  uRefl: { value: target.texture },
  uReflOn: { value: 0 },
  uViewport: { value: new Vector2(1, 1) },
};

export function WaterReflection() {
  const tier = useSceneQuality((s) => s.tier);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const buf = useMemo(() => new Vector2(), []);
  const clear = useMemo(() => new Color(), []);

  useEffect(() => () => target.dispose(), []);

  // shadow-casting lights: the pass waits until their shadow maps exist (the shared materials
  // sample them; drawing before the first shadow render binds a non-depth texture to a shadow sampler)
  const shadowLights = useMemo<DirectionalLight[]>(() => [], []);
  useFrame(() => {
    if (shadowLights.length === 0) {
      scene.traverse((o) => {
        if ((o as DirectionalLight).isDirectionalLight && o.castShadow) shadowLights.push(o as DirectionalLight);
      });
    }
    const shadowsReady = shadowLights.every((l) => !l.castShadow || l.shadow.map != null);
    const on = tier !== 'low' && fx.skyline > 0.01 && shadowsReady && fx.frames > 2;
    reflectionUniforms.uReflOn.value = on ? 1 : 0;
    if (!on) return;
    gl.getDrawingBufferSize(buf);
    reflectionUniforms.uViewport.value.copy(buf);
    const w = Math.max(4, Math.round(buf.x * 0.5));
    const h = Math.max(4, Math.round(buf.y * 0.5));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    const prevTarget = gl.getRenderTarget();
    const prevMask = camera.layers.mask;
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(clear);
    const prevAutoClear = gl.autoClear;
    const prevShadow = gl.shadowMap.needsUpdate;
    gl.shadowMap.needsUpdate = false; // the main pass keeps ownership of shadow-map refreshes

    camera.layers.set(REFLECTION_LAYER);
    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.autoClear = true;
    gl.clear(true, true, false);
    gl.render(scene, camera);

    gl.setRenderTarget(prevTarget);
    gl.setClearColor(clear, prevAlpha);
    gl.autoClear = prevAutoClear;
    gl.shadowMap.needsUpdate = prevShadow;
    camera.layers.mask = prevMask;
  }, 0.5);

  return null;
}
