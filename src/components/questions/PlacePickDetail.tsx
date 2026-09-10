import { useEffect, useState } from 'react';
import type { DestinationHighlight } from '../../types';
import { planStoryPhotos } from '../../services/storyPhotoPlan';
import { PlaceImage, fetchPlacePhotoUrls } from '../shared/PlaceImage';
import '../../styles/questions.css';

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
      /* try next */
    }
  }
  return null;
}

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

interface PlacePickDetailProps {
  spot: DestinationHighlight;
  city: string;
  country?: string;
  selected: boolean;
  onBack: () => void;
  onToggleAdd: () => void;
}

export function PlacePickDetail({
  spot,
  city,
  country,
  selected,
  onBack,
  onToggleAdd,
}: PlacePickDetailProps) {
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

    void fetchPlacePhotoUrls(spot.name, city, spot.category).then((urls) => {
      if (!cancelled) {
        setPhotos(urls.slice(0, 8));
        setLoadingPhotos(false);
      }
    });
    void fetchWikiBlurb(spot.name, city).then((blurb) => {
      if (!cancelled) setWiki(blurb);
    });

    return () => {
      cancelled = true;
    };
  }, [spot.name, spot.category, city]);

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

  const wikiChunks = wiki?.extract ? chunkText(wiki.extract, 190) : [];
  const plan = planStoryPhotos(photos);
  const {
    hero,
    pair,
    pairIndices,
    split,
    splitIndex,
    reverseSplit,
    reverseSplitIndex,
  } = plan;

  const addButton = (
    <button
      type="button"
      className={`btn ${selected ? 'btn-secondary' : 'btn-primary'} place-pick-detail-add`}
      onClick={onToggleAdd}
    >
      {selected ? 'Remove from my list' : 'Add to my list'}
    </button>
  );

  return (
    <article className="highlight-story-card place-pick-detail">
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
      ) : (
        <PlaceImage
          className="highlight-story-hero-shot"
          name={spot.name}
          city={city}
          category={spot.category}
        />
      )}

      <header className="highlight-story-titlebar">
        <span className="category-pill">{spot.category}</span>
        <h1>{spot.name}</h1>
        <p>
          {city}
          {country ? `, ${country}` : ''}
        </p>
        {wiki?.description && (
          <p className="highlight-story-wiki-desc">{wiki.description}</p>
        )}
        <p className="highlight-detail-lead">{spot.description}</p>
        <div className="place-pick-detail-inline-add">{addButton}</div>
      </header>

      <div className="highlight-story-body">
        <section className="highlight-story-section">
          <h2>About this place</h2>
          <p className="highlight-story-detail">
            {spot.name} is a standout stop in {city}. Browse the photos, then
            add it if you want it on your itinerary — we’ll place your picks
            into the days you choose.
          </p>
        </section>

        {pair && pairIndices && (
          <div className="highlight-story-pair">
            <StoryPhoto
              url={pair[0]}
              alt={`${spot.name} photo 2`}
              onOpen={() => setLightbox(pairIndices[0])}
              onError={() => dropPhoto(pair[0])}
            />
            <StoryPhoto
              url={pair[1]}
              alt={`${spot.name} photo 3`}
              onOpen={() => setLightbox(pairIndices[1])}
              onError={() => dropPhoto(pair[1])}
            />
          </div>
        )}

        {loadingPhotos && !pair && photos.length === 0 && (
          <div className="highlight-story-pair">
            <div className="highlight-story-shot is-loading" aria-hidden />
            <div className="highlight-story-shot is-loading" aria-hidden />
          </div>
        )}

        {wikiChunks[0] && (
          <section className="highlight-story-section">
            <h2>A bit of history</h2>
            <p className="highlight-story-detail">{wikiChunks[0]}</p>
            {wikiChunks[1] && (
              <p className="highlight-story-detail">{wikiChunks[1]}</p>
            )}
          </section>
        )}

        {split && splitIndex != null && (
          <section className="highlight-story-split">
            <StoryPhoto
              url={split}
              alt={`${spot.name} photo ${splitIndex + 1}`}
              className="highlight-story-split-media"
              onOpen={() => setLightbox(splitIndex)}
              onError={() => dropPhoto(split)}
            />
            <div className="highlight-story-split-copy">
              <h2>Add it to your trip?</h2>
              <p className="highlight-story-detail">
                {wikiChunks[2] ??
                  `If ${spot.name} is on your must-see list, add it here. You can always remove it before building the itinerary.`}
              </p>
              {wikiChunks[3] && (
                <p className="highlight-story-detail">{wikiChunks[3]}</p>
              )}
              <div className="place-pick-detail-inline-add">{addButton}</div>
            </div>
          </section>
        )}

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

        {reverseSplit && reverseSplitIndex != null && (
          <section className="highlight-story-split is-reversed">
            <StoryPhoto
              url={reverseSplit}
              alt={`${spot.name} photo ${reverseSplitIndex + 1}`}
              className="highlight-story-split-media"
              onOpen={() => setLightbox(reverseSplitIndex)}
              onError={() => dropPhoto(reverseSplit)}
            />
            <div className="highlight-story-split-copy">
              <h2>On the ground</h2>
              <p className="highlight-story-detail">
                Give yourself time here. {spot.name} works best when it isn’t
                rushed — fold it into a half-day walk around {city}.
              </p>
            </div>
          </section>
        )}
      </div>

      <div className="highlight-story-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to places
        </button>
        {addButton}
      </div>

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
        </div>
      )}
    </article>
  );
}
