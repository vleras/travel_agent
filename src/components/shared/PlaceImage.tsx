import { useEffect, useRef, useState } from 'react';
import {
  fetchPlacePhotoUrls as fetchPhotos,
  type PlacePhotoQuery,
} from '../../services/placePhotos';
import '../../styles/placeImage.css';

interface PlaceImageProps {
  name: string;
  city?: string;
  category?: string;
  lat?: number;
  lon?: number;
  imageUrl?: string;
  wikidataId?: string;
  wikipediaTag?: string;
  commonsTag?: string;
  className?: string;
  /** When true (default), allow swiping / arrows across multiple photos. */
  swipeable?: boolean;
}

/** Re-export gallery helper with lat/lon support. */
export async function fetchPlacePhotoUrls(
  name: string,
  city?: string,
  category?: string,
  lat?: number,
  lon?: number,
  extras?: Partial<PlacePhotoQuery>,
): Promise<string[]> {
  return fetchPhotos(name, city, category, lat, lon, extras);
}

/**
 * Cover image for a place — prefers Unsplash, then Commons.
 * When multiple photos load, swipe or use arrows to browse them.
 */
export function PlaceImage({
  name,
  city,
  category,
  lat,
  lon,
  imageUrl,
  wikidataId,
  wikipediaTag,
  commonsTag,
  className,
  swipeable = true,
}: PlaceImageProps) {
  const [index, setIndex] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!imageUrl);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    setIndex(0);
    setQueue(imageUrl ? [imageUrl] : []);

    void (async () => {
      const urls = await fetchPhotos(name, city, category, lat, lon, {
        imageUrl,
        wikidataId,
        wikipediaTag,
        commonsTag,
      });
      if (cancelled) return;
      const list = imageUrl
        ? [imageUrl, ...urls.filter((u) => u !== imageUrl)]
        : urls;
      setQueue(list);
      setIndex(0);
      setLoading(false);
      if (!list.length) setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    name,
    city,
    category,
    lat,
    lon,
    imageUrl,
    wikidataId,
    wikipediaTag,
    commonsTag,
  ]);

  const src = queue[index] ?? '';
  const canSwipe = swipeable && queue.length > 1;

  function go(delta: number) {
    if (!queue.length) return;
    setIndex((i) => (i + delta + queue.length) % queue.length);
  }

  if (failed || (!src && !loading)) {
    return (
      <div
        className={className}
        style={{
          display: 'grid',
          placeItems: 'center',
          background:
            'linear-gradient(135deg, #1f6f68 0%, #0f2f2c 55%, #c4a35a 140%)',
          color: 'white',
          fontSize: '0.85rem',
          fontWeight: 600,
          textAlign: 'center',
          padding: '0.75rem',
        }}
      >
        {name}
      </div>
    );
  }

  if (loading && !src) {
    return (
      <div
        className={className}
        style={{
          background:
            'linear-gradient(110deg, #dfe8e6 25%, #eef4f2 40%, #dfe8e6 55%)',
          backgroundSize: '200% 100%',
          animation: 'place-img-shimmer 1.2s ease infinite',
        }}
        aria-label={`Loading photo of ${name}`}
      />
    );
  }

  return (
    <div
      className={`place-img-swipe ${className ?? ''}`}
      onTouchStart={(e) => {
        touchStartX.current = e.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (!canSwipe || touchStartX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return;
        go(dx < 0 ? 1 : -1);
      }}
    >
      <img
        src={src}
        alt={`${name}${canSwipe ? ` photo ${index + 1}` : ''}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => {
          setQueue((prev) => {
            const next = prev.filter((u) => u !== src);
            if (!next.length) setFailed(true);
            setIndex(0);
            return next;
          });
        }}
      />
      {canSwipe && (
        <>
          <span
            className="place-img-nav prev"
            role="button"
            tabIndex={0}
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              go(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                go(-1);
              }
            }}
          >
            ‹
          </span>
          <span
            className="place-img-nav next"
            role="button"
            tabIndex={0}
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              go(1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                go(1);
              }
            }}
          >
            ›
          </span>
          <div className="place-img-dots" aria-hidden>
            {queue.map((_, i) => (
              <span key={i} className={i === index ? 'active' : ''} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
