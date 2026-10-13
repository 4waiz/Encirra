import { Canvas } from '@react-three/fiber';

/**
 * Full-screen WebGL canvas that hosts the 3D digital twin.
 * Rendered behind the dashboard overlay on every page.
 * (Initial stub — the scene implementation lives in src/scene/.)
 */
export function TwinCanvas() {
  return (
    <div className="absolute inset-0" data-testid="twin-canvas">
      <Canvas camera={{ position: [0, 320, 520], fov: 35, near: 1, far: 8000 }} dpr={[1, 2]}>
        <color attach="background" args={['#d8c8b0']} />
        <ambientLight intensity={0.8} />
        <mesh position={[0, -21, 0]}>
          <boxGeometry args={[500, 42, 320]} />
          <meshStandardMaterial color="#8c7356" />
        </mesh>
      </Canvas>
    </div>
  );
}
