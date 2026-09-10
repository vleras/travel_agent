import type { AgentProgress } from '../../types';
import '../../styles/trip.css';

interface AgentProcessingProps {
  progress: AgentProgress;
}

export function AgentProcessing({ progress }: AgentProcessingProps) {
  return (
    <div className="processing">
      <div className="processing-card processing-card--simple">
        <h2>Organizing your places</h2>
        <p>
          Grouping nearby spots into walkable sets of 2–4 — no maps yet, just
          your picks arranged by distance.
        </p>
        <div className="processing-status" aria-live="polite">
          <span className="processing-pulse" aria-hidden />
          <div>
            <strong>{progress.message || 'Working…'}</strong>
            {progress.detail && <span>{progress.detail}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
