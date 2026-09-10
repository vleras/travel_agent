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

function placeDetailCopy(
  spot: DestinationHighlight,
  destination: DestinationCard,
): string {
  const c = spot.category.toLowerCase();
  if (c.includes('museum')) {
    return `${spot.name} is one of the cultural anchors of ${destination.city}. Expect collections and rooms that reward a slower visit — plan it as a focused stop rather than a quick glance.`;
  }
  if (c.includes('architect')) {
    return `${spot.name} is a landmark of ${destination.city}’s built landscape. The structure and the spaces around it are part of the experience, so leave room to approach it from more than one angle.`;
  }
  if (c.includes('beach') || c.includes('nature')) {
    return `${spot.name} offers a breath of open air in and around ${destination.city}. It’s the kind of stop that resets the pace of a trip between denser city days.`;
  }
  if (c.includes('night')) {
    return `${spot.name} shows a different side of ${destination.city} after dark — atmosphere, music, and people-watching as much as any single venue.`;
  }
  if (c.includes('shop')) {
    return `${spot.name} is a browsing stop in ${destination.city}: local craft, neighborhood character, and the pleasure of wandering without a strict checklist.`;
  }
  if (c.includes('photo')) {
    return `${spot.name} is a classic ${destination.city} viewpoint — worth visiting when the light is soft and the streets around it are still waking up or winding down.`;
  }
  return `${spot.name} is a highlight travelers keep returning to in ${destination.city}, ${destination.country}. It pairs well with a half-day of nearby walks and other stops on your list.`;
}

/** Split long copy into short readable paragraphs (no “read more”). */
function chunkText(text: string, maxLen = 200): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (next.length > maxLen && buf) {
      chunks.push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const MIN_STORY_PHOTOS = 4;

function StoryPhoto({
  url,
  alt,
  className,
  onOpen,
  onError,
}: {
  url: string;
  alt: string;
  className?: string;
  onOpen: () => void;
  onError: () => void;
}) {
  return (
    <button
      type="button"
      className={`highlight-story-shot ${className ?? ''}`}
      onClick={onOpen}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={onError}
      />
    </button>
  );
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
  const [loadingPhotos, setLoadingPhotos] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPhotos([]);
    setLightbox(null);
    setWiki(null);
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

  const dropPhoto = (url: string) =>
    setPhotos((prev) => prev.filter((u) => u !== url));

  const detailChunks = chunkText(placeDetailCopy(spot, destination), 170);
  const wikiChunks = wiki?.extract ? chunkText(wiki.extract, 190) : [];
  const [hero, pairA, pairB, splitPhoto, trailing, ...rest] = photos;
  const extraPhotos = [trailing, ...rest].filter(Boolean) as string[];

  return (
    <div className="questions highlight-story">
      <div className="questions-header">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back to {destination.city}
        </button>
        <div className="brand-mark">Travel Agent</div>
      </div>

      <article className="highlight-story-card">
        {/* 1 — full hero image */}
        {loadingPhotos && !hero ? (
          <div className="highlight-story-hero-shot is-loading" aria-hidden />
        ) : hero ? (
          <StoryPhoto
            url={hero}
            alt={`${spot.name} main photo`}
            className="highlight-story-hero-shot"
            onOpen={() => setLightbox(0)}
            onError={() => dropPhoto(hero)}
          />
        ) : null}

        <header className="highlight-story-titlebar">
          <span className="category-pill">{spot.category}</span>
          <h1>{spot.name}</h1>
          <p>
            {destination.city}, {destination.country}
          </p>
          {wiki?.description && (
            <p className="highlight-story-wiki-desc">{wiki.description}</p>
          )}
          <p className="highlight-detail-lead">{spot.description}</p>
        </header>

        <div className="highlight-story-body">
          {/* Intro text chunks */}
          <section className="highlight-story-section">
            <h2>About this place</h2>
            {detailChunks.map((chunk) => (
              <p key={chunk} className="highlight-story-detail">
                {chunk}
              </p>
            ))}
          </section>

          {/* 2 — two side by side */}
          {(pairA || pairB || loadingPhotos) && (
            <div className="highlight-story-pair">
              {loadingPhotos && !pairA && !pairB ? (
                <>
                  <div className="highlight-story-shot is-loading" aria-hidden />
                  <div className="highlight-story-shot is-loading" aria-hidden />
                </>
              ) : (
                <>
                  {pairA && (
                    <StoryPhoto
                      url={pairA}
                      alt={`${spot.name} photo 2`}
                      onOpen={() => setLightbox(1)}
                      onError={() => dropPhoto(pairA)}
                    />
                  )}
                  {pairB && (
                    <StoryPhoto
                      url={pairB}
                      alt={`${spot.name} photo 3`}
                      onOpen={() => setLightbox(2)}
                      onError={() => dropPhoto(pairB)}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* History chunk */}
          {wikiChunks[0] && (
            <section className="highlight-story-section">
              <h2>A bit of history</h2>
              <p className="highlight-story-detail">{wikiChunks[0]}</p>
              {wikiChunks[1] && (
                <p className="highlight-story-detail">{wikiChunks[1]}</p>
              )}
            </section>
          )}

          {/* 3 — image left, text right */}
          {splitPhoto && (
            <section className="highlight-story-split">
              <StoryPhoto
                url={splitPhoto}
                alt={`${spot.name} photo 4`}
                className="highlight-story-split-media"
                onOpen={() => setLightbox(3)}
                onError={() => dropPhoto(splitPhoto)}
              />
              <div className="highlight-story-split-copy">
                <h2>Looking closer</h2>
                <p className="highlight-story-detail">
                  {wikiChunks[2] ??
                    `Wander around ${spot.name} and take in the details — the scale, materials, and how it sits in ${destination.city}.`}
                </p>
                {wikiChunks[3] && (
                  <p className="highlight-story-detail">{wikiChunks[3]}</p>
                )}
              </div>
            </section>
          )}

          {/* Remaining wiki chunks */}
          {wikiChunks.length > 4 && (
            <section className="highlight-story-section">
              <h2>Worth knowing</h2>
              {wikiChunks.slice(4).map((chunk) => (
                <p key={chunk} className="highlight-story-detail">
                  {chunk}
                </p>
              ))}
            </section>
          )}

          {/* 4+ — full-width solo, then optional reverse split */}
          {extraPhotos[0] && (
            <StoryPhoto
              url={extraPhotos[0]}
              alt={`${spot.name} photo 5`}
              className="highlight-story-solo"
              onOpen={() => setLightbox(4)}
              onError={() => dropPhoto(extraPhotos[0])}
            />
          )}

          {extraPhotos[1] && (
            <section className="highlight-story-split is-reversed">
              <StoryPhoto
                url={extraPhotos[1]}
                alt={`${spot.name} photo 6`}
                className="highlight-story-split-media"
                onOpen={() => setLightbox(5)}
                onError={() => dropPhoto(extraPhotos[1])}
              />
              <div className="highlight-story-split-copy">
                <h2>On the ground</h2>
                <p className="highlight-story-detail">
                  Give yourself time here. {spot.name} works best when it isn’t
                  rushed — fold it into a half-day that also includes nearby
                  streets and viewpoints in {destination.city}.
                </p>
              </div>
            </section>
          )}

          {extraPhotos.slice(2).map((url, i) => (
            <StoryPhoto
              key={url}
              url={url}
              alt={`${spot.name} photo ${i + 7}`}
              className="highlight-story-solo"
              onOpen={() => setLightbox(i + 6)}
              onError={() => dropPhoto(url)}
            />
          ))}

          {!loadingPhotos && photos.length > 0 && photos.length < MIN_STORY_PHOTOS && (
            <p className="hint">
              Showing {photos.length} photo{photos.length === 1 ? '' : 's'} for
              this place so far.
            </p>
          )}

          <section className="highlight-story-section">
            <h2>On your trip</h2>
            <p className="highlight-story-detail">
              When you start planning {destination.city},{' '}
              <strong>{spot.name}</strong> can sit on your day-by-day itinerary
              with timing that matches your pace — alongside other stops you
              pick from this city.
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
          <div
            className="highlight-lightbox-stage"
            onClick={(e) => e.stopPropagation()}
          >
            {photos.length > 1 && (
              <button
                type="button"
                className="highlight-lightbox-nav prev"
                onClick={() =>
                  setLightbox((lightbox - 1 + photos.length) % photos.length)
                }
              >
                ‹
              </button>
            )}
            <img
              src={photos[lightbox]}
              alt={`${spot.name} photo ${lightbox + 1}`}
              referrerPolicy="no-referrer"
            />
            {photos.length > 1 && (
              <button
                type="button"
                className="highlight-lightbox-nav next"
                onClick={() => setLightbox((lightbox + 1) % photos.length)}
              >
                ›
              </button>
            )}
          </div>
          <div
            className="highlight-lightbox-dots"
            onClick={(e) => e.stopPropagation()}
          >
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
