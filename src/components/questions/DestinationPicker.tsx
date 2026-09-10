import { useEffect, useState } from 'react';
import { destinationRecommendations } from '../../data/destinations';
import { PlaceImage, fetchPlacePhotoUrls } from '../shared/PlaceImage';
import {
  clearDestState,
  loadDestState,
  saveDestState,
} from '../../services/sessionState';
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

type WikiBlurb = { extract: string; description?: string };

async function fetchWikiBlurb(
  place: string,
  city: string,
): Promise<WikiBlurb | null> {
  const titles = [place, `${place} (${city})`, `${place}, ${city}`];
  for (const title of titles) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        type?: string;
        extract?: string;
        description?: string;
      };
      if (data.type === 'disambiguation' || !data.extract) continue;
      return { extract: data.extract, description: data.description };
    } catch {
      /* try next title */
    }
  }
  return null;
}

function visitTips(category: string, city: string): string[] {
  const c = category.toLowerCase();
  if (c.includes('museum')) {
    return [
      'Often quieter mid-morning on weekdays',
      'Check timed-entry tickets before you go',
      `Pair with a nearby café or park in ${city}`,
    ];
  }
  if (c.includes('architect')) {
    return [
      'Best photos in soft morning or golden-hour light',
      'Look for viewpoints around the structure',
      'Give yourself time to walk the surroundings',
    ];
  }
  if (c.includes('beach') || c.includes('nature')) {
    return [
      'Bring sunscreen and water for longer stays',
      'Arrive early for calmer paths and better light',
      'Combine with a short walk nearby',
    ];
  }
  if (c.includes('night')) {
    return [
      'Start after dusk when the energy picks up',
      'Keep valuables close in busy areas',
      'Plan your route home before it gets late',
    ];
  }
  if (c.includes('shop')) {
    return [
      'Wandering beats a fixed shopping list',
      'Morning is calmer than late afternoon',
      'Look for local makers, not only souvenirs',
    ];
  }
  return [
    `A standout stop when exploring ${city}`,
    'Easy to fold into a half-day walk',
    'Worth lingering longer than a quick photo',
  ];
}

function HighlightStory({
  spot,
  destination,
  related,
  onBack,
  onOpenRelated,
  onStartPlanning,
}: {
  spot: DestinationHighlight;
  destination: DestinationCard;
  related: DestinationHighlight[];
  onBack: () => void;
  onOpenRelated: (spot: DestinationHighlight) => void;
  onStartPlanning: () => void;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [wiki, setWiki] = useState<WikiBlurb | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPhotos([]);
    setLightbox(null);
    setWiki(null);
    setExpanded(false);
    setLoadingPhotos(true);

    void fetchPlacePhotoUrls(spot.name, destination.city, spot.category).then(
      (urls) => {
        if (!cancelled) {
          setPhotos(urls.slice(0, 8));
          setLoadingPhotos(false);
        }
      },
    );
    void fetchWikiBlurb(spot.name, destination.city).then((blurb) => {
      if (!cancelled) setWiki(blurb);
    });

    return () => {
      cancelled = true;
    };
  }, [spot.name, spot.category, destination.city]);

  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight' && photos.length) {
        setLightbox((i) => (i == null ? 0 : (i + 1) % photos.length));
      }
      if (e.key === 'ArrowLeft' && photos.length) {
        setLightbox((i) =>
          i == null ? 0 : (i - 1 + photos.length) % photos.length,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, photos.length]);

  const hero = photos[0];
  const mosaic = photos.slice(1);
  const tips = visitTips(spot.category, destination.city);
  const shortExtract =
    wiki?.extract && wiki.extract.length > 280 && !expanded
      ? `${wiki.extract.slice(0, 280).trim()}…`
      : wiki?.extract;

  return (
    <div className="questions highlight-story">
      <div className="questions-header">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back to {destination.city}
        </button>
        <div className="brand-mark">Travel Agent</div>
      </div>

      <article className="highlight-story-card">
        <button
          type="button"
          className="highlight-story-hero"
          onClick={() => hero && setLightbox(0)}
          aria-label={hero ? `View ${spot.name} photos` : spot.name}
        >
          {hero ? (
            <img
              src={hero}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setPhotos((p) => p.slice(1))}
            />
          ) : (
            <PlaceImage
              className="highlight-story-hero-fallback"
              name={spot.name}
              city={destination.city}
              category={spot.category}
            />
          )}
          <div className="highlight-story-hero-shade" />
          <div className="highlight-story-hero-copy">
            <span className="category-pill">{spot.category}</span>
            <h1>{spot.name}</h1>
            <p>
              {destination.city}, {destination.country}
            </p>
          </div>
          {photos.length > 1 && (
            <span className="highlight-story-photo-count">
              {photos.length} photos · tap to explore
            </span>
          )}
        </button>

        <div className="highlight-story-body">
          <section className="highlight-story-section">
            <h2>About this place</h2>
            <p className="highlight-detail-lead">{spot.description}</p>
            {wiki?.description && (
              <p className="highlight-story-wiki-desc">{wiki.description}</p>
            )}
          </section>

          <section className="highlight-story-section">
            <h2>Good to know</h2>
            <ul className="highlight-story-tips">
              {tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>

          {(loadingPhotos || mosaic.length > 0) && (
            <section className="highlight-story-section">
              <div className="highlight-story-section-head">
                <h2>More looks</h2>
                <p className="hint">Tap any photo to open the gallery</p>
              </div>
              {loadingPhotos && mosaic.length === 0 ? (
                <div className="highlight-story-mosaic-loading">
                  Finding photos…
                </div>
              ) : (
                <div className="highlight-story-mosaic">
                  {mosaic.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      className="highlight-story-mosaic-item"
                      onClick={() => setLightbox(i + 1)}
                    >
                      <img
                        src={url}
                        alt={`${spot.name} photo ${i + 2}`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {shortExtract && (
            <section className="highlight-story-section highlight-story-readmore">
              <h2>A little more history</h2>
              <p>{shortExtract}</p>
              {wiki && wiki.extract.length > 280 && (
                <button
                  type="button"
                  className="btn btn-ghost highlight-story-expand"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </section>
          )}

          <section className="highlight-story-section">
            <h2>On your trip</h2>
            <p className="hint">
              When you start planning {destination.city}, stops like{' '}
              <strong>{spot.name}</strong> can land on your day-by-day itinerary —
              with timing that fits your pace.
            </p>
          </section>

          {related.length > 0 && (
            <section className="highlight-story-section">
              <h2>Also in {destination.city}</h2>
              <div className="highlight-story-related">
                {related.map((other) => (
                  <button
                    key={other.name}
                    type="button"
                    className="highlight-story-related-card"
                    onClick={() => {
                      onOpenRelated(other);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    <PlaceImage
                      className="highlight-story-related-photo"
                      name={other.name}
                      city={destination.city}
                      category={other.category}
                    />
                    <div>
                      <strong>{other.name}</strong>
                      <span>{other.category}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="highlight-story-actions">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStartPlanning}
          >
            Start planning this trip
          </button>
        </div>
      </article>

      {lightbox != null && photos[lightbox] && (
        <div
          className="highlight-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${spot.name} photo gallery`}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="highlight-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            Close
          </button>
          {photos.length > 1 && (
            <button
              type="button"
              className="highlight-lightbox-nav prev"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(
                  (lightbox - 1 + photos.length) % photos.length,
                );
              }}
            >
              ‹
            </button>
          )}
          <img
            src={photos[lightbox]}
            alt={`${spot.name} photo ${lightbox + 1}`}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
          />
          {photos.length > 1 && (
            <button
              type="button"
              className="highlight-lightbox-nav next"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox((lightbox + 1) % photos.length);
              }}
            >
              ›
            </button>
          )}
          <div className="highlight-lightbox-dots" onClick={(e) => e.stopPropagation()}>
            {photos.map((url, i) => (
              <button
                key={url}
                type="button"
                className={i === lightbox ? 'active' : ''}
                aria-label={`Photo ${i + 1}`}
                onClick={() => setLightbox(i)}
              />
            ))}
          </div>
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
  const [preview, setPreview] = useState<DestinationCard | null>(() => {
    const saved = loadDestState();
    if (!saved?.previewId) return null;
    return (
      destinationRecommendations.find((d) => d.id === saved.previewId) ?? null
    );
  });
  const [highlight, setHighlight] = useState<DestinationHighlight | null>(() => {
    const saved = loadDestState();
    if (!saved?.previewId || !saved.highlightName) return null;
    const dest = destinationRecommendations.find((d) => d.id === saved.previewId);
    return dest?.highlights.find((h) => h.name === saved.highlightName) ?? null;
  });

  useEffect(() => {
    if (!preview) {
      clearDestState();
      return;
    }
    saveDestState({
      previewId: preview.id,
      highlightName: highlight?.name ?? null,
    });
  }, [preview, highlight]);

  if (preview && highlight) {
    const related = preview.highlights
      .filter((h) => h.name !== highlight.name)
      .slice(0, 4);

    return (
      <HighlightStory
        spot={highlight}
        destination={preview}
        related={related}
        onBack={() => {
          setHighlight(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenRelated={(spot) => setHighlight(spot)}
        onStartPlanning={() => onSelect(preview)}
      />
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
                <span className="breakfast-card-cta">See places to visit →</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
