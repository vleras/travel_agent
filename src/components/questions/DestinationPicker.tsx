import { destinationRecommendations } from '../../data/destinations';
import type { DestinationCard } from '../../types';
import '../../styles/questions.css';


interface DestinationPickerProps {
  onSelect: (destination: DestinationCard) => void;
  onBack: () => void;
}

export function DestinationPicker({ onSelect, onBack }: DestinationPickerProps) {
  return (
    <div className="questions">
      <div className="questions-header">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="brand-mark">Travel Agent</div>
      </div>
      <div className="question-card" style={{ maxWidth: 980 }}>
        <h2>Where should we take you?</h2>
        <p className="hint">
          Pick a city to start planning — more options below if you want inspiration.
        </p>
        <div className="dest-grid">
          {destinationRecommendations.map((dest) => (
            <button
              key={dest.id}
              type="button"
              className="dest-card"
              onClick={() => onSelect(dest)}
            >
              <img src={dest.imageUrl} alt="" loading="lazy" />
              <div className="dest-card-body">
                <h3>
                  {dest.city}
                  <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '0.85rem' }}>
                    {' '}
                    · {dest.country}
                  </span>
                </h3>
                <p>{dest.tagline}</p>
                <div className="tag-row">
                  {dest.tags.map((tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ))}
                </div>
                <div className="dest-meta">Suggested trip: {dest.suggestedDays} days</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
