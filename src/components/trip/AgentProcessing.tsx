import type { AgentProgress } from '../../types';
import '../../styles/trip.css';

interface AgentProcessingProps {
  progress: AgentProgress;
}

export function AgentProcessing({ progress }: AgentProcessingProps) {
  return (
    <div className="processing">
      <div className="processing-card processing-card--simple">
        <h2>Building your days</h2>
        <p>
          Assigning your picks across the trip timeline — nearby places prefer
          the same day when it helps walking.
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
