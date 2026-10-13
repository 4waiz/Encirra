import { TwinCanvas } from '@/scene';

// Temporary shell — replaced by the application shell in src/app/.
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
  return (
    <div className="flex h-full items-center justify-center">
      <div className="enc-panel px-6 py-4 text-sm">Encirra is starting…</div>
    </div>
  );
}
