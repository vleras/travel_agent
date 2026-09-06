import type { AgentProgress, AgentStep } from '../../types';
import '../../styles/trip.css';

const STEPS: { id: AgentStep; label: string }[] = [
  { id: 'reason', label: 'Reason' },
  { id: 'act', label: 'Act' },
  { id: 'observe', label: 'Observe' },
  { id: 'revise', label: 'Revise' },
];

const ORDER: AgentStep[] = ['reason', 'act', 'observe', 'revise', 'done'];

interface AgentProcessingProps {
  progress: AgentProgress;
}

export function AgentProcessing({ progress }: AgentProcessingProps) {
  const currentIdx = ORDER.indexOf(progress.step === 'error' ? 'reason' : progress.step);

  return (
    <div className="processing">
      <div className="processing-card">
        <h2>Agent at work</h2>
        <p>Reason → Act → Observe → Revise — the self-correction loop for your trip.</p>
        <div className="agent-steps">
          {STEPS.map((s, i) => {
            const stepIdx = ORDER.indexOf(s.id);
            const done = currentIdx > stepIdx || progress.step === 'done';
            const active = progress.step === s.id;
            return (
              <div
                key={s.id}
                className={`agent-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}
              >
                <div className="step-dot">{i + 1}</div>
                <div>
                  <strong>{s.label}</strong>
                  <span>
                    {active
                      ? progress.detail || progress.message
                      : done
                        ? 'Complete'
                        : 'Waiting…'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
