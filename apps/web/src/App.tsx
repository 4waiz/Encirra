import { useEffect } from 'react';
import { TwinCanvas } from '@/scene';
import { AppShell } from '@/app/AppShell';
import { bootstrap } from '@/data/loader';
import { usePlaybackLoop } from '@/playback/playback';

/** `?view=scene` renders the 3D twin alone (used for scene QA screenshots); data still loads so the scene can show run state. */
function SceneOnly() {
  usePlaybackLoop();
  useEffect(() => {
    void bootstrap();
  }, []);
  return (
    <div className="relative h-full w-full">
      <TwinCanvas />
    </div>
  );
}

export default function App() {
  const sceneOnly = new URLSearchParams(window.location.search).get('view') === 'scene';
  return sceneOnly ? <SceneOnly /> : <AppShell />;
}
