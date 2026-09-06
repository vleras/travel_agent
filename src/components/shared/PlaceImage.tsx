import { useEffect, useState } from 'react';
import {
  fetchPlacePhotoUrls as fetchPhotos,
  type PlacePhotoQuery,
} from '../../services/placePhotos';

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
 * Cover image for a place — searches Wikipedia, Commons, Wikidata, OSM links,
 * and Openverse for photos that actually match the venue name / location.
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
}: PlaceImageProps) {
  const [src, setSrc] = useState(imageUrl || '');
  const [queue, setQueue] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!imageUrl);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    setSrc(imageUrl || '');

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
      setSrc(list[0] ?? '');
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
    <img
      className={className}
      src={src}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        const idx = queue.indexOf(src);
        const next = queue[idx + 1];
        if (next) {
          setSrc(next);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
