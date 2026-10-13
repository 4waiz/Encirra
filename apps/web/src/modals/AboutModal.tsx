import { district } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { Modal } from '@/ui/Modal';
import { LogoMark } from '@/app/Logo';
import { CreditLink } from '@/app/Footer';

export const ACKNOWLEDGMENTS: { name: string; role: string }[] = [
  { name: 'pandapower', role: 'power-flow analysis' },
  { name: 'WNTR / EPANET', role: 'hydraulic simulation' },
  { name: 'NetworkX', role: 'graph analysis' },
  { name: 'OR-Tools', role: 'optimization toolkit' },
  { name: 'NumPy / SciPy / pandas', role: 'numerics and data handling' },
  { name: 'FastAPI', role: 'simulation service API' },
  { name: 'Pydantic', role: 'typed data contract' },
  { name: 'React', role: 'user interface' },
  { name: 'three.js', role: '3D rendering' },
  { name: 'React Three Fiber', role: 'declarative 3D scene' },
  { name: 'drei', role: '3D helpers' },
  { name: 'postprocessing', role: 'scene effects' },
  { name: 'Recharts', role: 'charts' },
  { name: 'Lucide', role: 'icons' },
  { name: 'Tailwind CSS', role: 'styling' },
  { name: 'Motion', role: 'interface transitions' },
  { name: 'Blender', role: '3D asset authoring' },
];

export function AboutModal() {
  const open = useTwin((s) => s.aboutOpen);
  const setOpen = useTwin((s) => s.setAboutOpen);
  const setPage = useTwin((s) => s.setPage);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="About Encirra" width={760} testId="about">
      <div className="space-y-4 text-[13px] leading-relaxed text-ink">
        <div className="flex items-start gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[15px] font-semibold text-navy">Encirra — Coupled Power + Water Resilience Twin</div>
            <div className="text-slate">See more. Recover faster. Safer cities for tomorrow.</div>
          </div>
        </div>
        <p>
          Encirra is an optimization-assisted, physics-driven digital twin. It models how a fault on an urban electrical distribution feeder cascades into the water network that depends on it (pumps lose
          supply, tanks drain, pressure falls), evaluates recovery switching strategies, and independently verifies the selected plan by re-solving the coupled power flow and hydraulics before it is
          presented as safe.
        </p>
        <div className="rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2.5">
          <div className="font-semibold text-navy">Research Prototype — Synthetic/Benchmark Infrastructure Data</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>No private utility data is available or authorized.</li>
            <li>{district.district.disclaimer}</li>
            <li>The electrical network is the published IEEE 33-bus distribution benchmark (Baran &amp; Wu, 1989); the water network is synthetic.</li>
            <li>The district is a {district.district.label}; no real substation, pumping station or customer is represented.</li>
            <li>Replays show precomputed solver output; they are not real-time telemetry. Ambient conditions are declared scenario assumptions.</li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-navy">Methodology</div>
          <p className="mt-1">
            Power flow (pandapower) and pressure-driven hydraulics (WNTR) are coupled through pump electrical demand (P = ρgQH/η) and pump supply availability. Recovery candidates (tie-switch closures,
            sectionalizing and load shedding) are scored on weighted soft objectives; hard constraints — convergence, voltage band, thermal limits, radiality, critical pressure — are never weighted.
            The full methodology, assumptions and limitations are in{' '}
            <button
              type="button"
              className="font-medium text-info hover:underline"
              onClick={() => {
                setOpen(false);
                setPage('reports');
              }}
            >
              Reports
            </button>
            .
          </p>
        </div>
        <div>
          <div className="font-semibold text-navy">Acknowledgments</div>
          <p className="mt-1 text-slate">Built with open-source software:</p>
          <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {ACKNOWLEDGMENTS.map((a) => (
              <li key={a.name}>
                <span className="font-medium text-navy">{a.name}</span> <span className="text-slate">— {a.role}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-line pt-3 text-[13px]">
          IEEE NEECON 2026 Undergraduate Innovation Challenge · <CreditLink className="font-semibold text-info hover:underline" />
        </div>
      </div>
    </Modal>
  );
}
