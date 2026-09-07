import { useState } from 'react';
import { destinationRecommendations } from '../../data/destinations';
import type { DestinationCard } from '../../types';
import '../../styles/questions.css';

interface DestinationPickerProps {
  onSelect: (destination: DestinationCard) => void;
  onBack: () => void;
}

function DestCardImage({
  dest,
  className,
}: {
  dest: DestinationCard;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`dest-card-fallback ${className ?? ''}`} aria-hidden>
        <span>{dest.city}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={dest.imageUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function DestinationPicker({ onSelect, onBack }: DestinationPickerProps) {
  const [preview, setPreview] = useState<DestinationCard | null>(null);

  if (preview) {
    return (
      <div className="questions">
        <div className="questions-header">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPreview(null)}
          >
            ← All cities
          </button>
          <div className="brand-mark">Travel Agent</div>
        </div>

        <div className="question-card dest-preview-card">
          <div className="dest-preview-hero">
            <DestCardImage dest={preview} className="dest-preview-img" />
            <div className="dest-preview-hero-copy">
              <p className="dest-preview-country">
                {preview.country}
              </p>
              <h2>{preview.city}</h2>
              <p>{preview.description}</p>
              <div className="tag-row">
                {preview.tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </div>
              <p className="dest-meta">
                Suggested trip: {preview.suggestedDays} days
              </p>
            </div>
          </div>

          <div className="dest-preview-body">
            <h3>What you can visit</h3>
            <p className="hint">
              A taste of highlights we’ll plan around — you’ll refine days, pace, and preferences next.
            </p>
            <ul className="dest-highlight-list">
              {preview.highlights.map((spot) => (
                <li key={spot.name}>
                  <div>
                    <strong>{spot.name}</strong>
                    <span className="category-pill">{spot.category}</span>
                  </div>
                  <p>{spot.description}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="question-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPreview(null)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onSelect(preview)}
            >
              Start planning this trip
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          Tap a city to see what you can visit — then start planning when you’re ready.
        </p>
        <div className="dest-grid">
          {destinationRecommendations.map((dest) => (
            <button
              key={dest.id}
              type="button"
              className="dest-card"
              onClick={() => {
                setPreview(dest);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <DestCardImage dest={dest} />
              <div className="dest-card-body">
                <h3>
                  {dest.city}
                  <span
                    style={{
                      fontWeight: 400,
                      color: 'var(--muted)',
                      fontSize: '0.85rem',
                    }}
                  >
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
                <div className="dest-meta">
                  Suggested trip: {dest.suggestedDays} days
                </div>
                <span className="breakfast-card-cta">See places to visit →</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
