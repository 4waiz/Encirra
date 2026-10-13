import { TwinCanvas } from '@/scene';
import { AppShell } from '@/app/AppShell';

// `?view=scene` renders the 3D twin alone (used for scene QA screenshots); keep it.
export default function App() {
  const sceneOnly = new URLSearchParams(window.location.search).get('view') === 'scene';
  if (sceneOnly) {
    return (
      <div className="relative h-full w-full">
        <TwinCanvas />
      </div>
    );
  }
  return <AppShell />;
}
