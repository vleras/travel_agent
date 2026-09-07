import { useEffect, useState } from 'react';
import { destinationRecommendations } from '../../data/destinations';
import { PlaceImage, fetchPlacePhotoUrls } from '../shared/PlaceImage';
import type { DestinationCard, DestinationHighlight } from '../../types';
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

function HighlightGallery({
  spot,
  city,
}: {
  spot: DestinationHighlight;
  city: string;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setActive(0);
    setPhotos([]);
    void fetchPlacePhotoUrls(spot.name, city, spot.category).then((urls) => {
      if (!cancelled) {
        // Already deduped + ranked for beauty in placePhotos
        setPhotos(urls.slice(0, 5));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spot.name, spot.category, city]);

  if (!photos.length) {
    return (
      <PlaceImage
        className="highlight-detail-hero"
        name={spot.name}
        city={city}
        category={spot.category}
      />
    );
  }

  return (
    <div className="highlight-detail-gallery">
      <img
        className="highlight-detail-hero"
        src={photos[active]}
        alt={`${spot.name} photo ${active + 1}`}
        referrerPolicy="no-referrer"
        onError={() => {
          if (active < photos.length - 1) setActive((a) => a + 1);
        }}
      />
      {photos.length > 1 && (
        <div className="place-photo-thumbs">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              className={`place-photo-thumb ${i === active ? 'active' : ''}`}
              onClick={() => setActive(i)}
            >
              <img src={url} alt="" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightCard({
  spot,
  city,
  onOpen,
}: {
  spot: DestinationHighlight;
  city: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="dest-highlight-card" onClick={onOpen}>
      <PlaceImage
        className="dest-highlight-photo"
        name={spot.name}
        city={city}
        category={spot.category}
      />
      <div className="dest-highlight-copy">
        <div className="dest-highlight-title">
          <strong>{spot.name}</strong>
          <span className="category-pill">{spot.category}</span>
        </div>
        <p>{spot.description}</p>
        <span className="breakfast-card-cta">View photos & details →</span>
      </div>
    </button>
  );
}

export function DestinationPicker({ onSelect, onBack }: DestinationPickerProps) {
  const [preview, setPreview] = useState<DestinationCard | null>(null);
  const [highlight, setHighlight] = useState<DestinationHighlight | null>(null);

  if (preview && highlight) {
    return (
      <div className="questions">
        <div className="questions-header">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setHighlight(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            ← Back to {preview.city}
          </button>
          <div className="brand-mark">Travel Agent</div>
        </div>

        <div className="question-card highlight-detail-card">
          <HighlightGallery spot={highlight} city={preview.city} />
          <div className="highlight-detail-body">
            <span className="category-pill">{highlight.category}</span>
            <h2>{highlight.name}</h2>
            <p className="highlight-detail-lead">{highlight.description}</p>
            <p className="hint">
              In {preview.city}, {preview.country}. When you start planning, stops
              like this can land on your day-by-day itinerary.
            </p>
          </div>
          <div className="question-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setHighlight(null)}
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
              <p className="dest-preview-country">{preview.country}</p>
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
              Tap a place for photos and more — then start planning when you’re ready.
            </p>
            <div className="dest-highlight-list">
              {preview.highlights.map((spot) => (
                <HighlightCard
                  key={spot.name}
                  spot={spot}
                  city={preview.city}
                  onOpen={() => {
                    setHighlight(spot);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ))}
            </div>
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
                setHighlight(null);
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
