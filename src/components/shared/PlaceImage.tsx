import { useEffect, useState } from 'react';

interface PlaceImageProps {
  name: string;
  city?: string;
  category?: string;
  lat?: number;
  lon?: number;
  imageUrl?: string;
  className?: string;
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic Unsplash-style photo via Lorem Picsum (always loads). */
function picsumUrl(name: string, city?: string): string {
  const seed = hashSeed(`${name}|${city ?? ''}`);
  return `https://picsum.photos/seed/${seed}/800/500`;
}

/** AI photo prompt fallback that usually returns a related visual. */
function pollinationsUrl(name: string, city?: string, category?: string): string {
  const prompt = [
    'travel photography',
    name,
    city,
    category,
    'exterior storefront or landmark',
  ]
    .filter(Boolean)
    .join(', ');
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=500&nologo=true&seed=${hashSeed(name)}`;
}

async function fetchOpenverseUrl(
  name: string,
  city?: string,
  category?: string,
): Promise<string | null> {
  const q = [name, city, category, 'building'].filter(Boolean).join(' ');
  try {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.searchParams.set('q', q);
    url.searchParams.set('page_size', '5');
    url.searchParams.set('mature', 'false');
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ url?: string; thumbnail?: string }>;
    };
    const hit = data.results?.find((r) => r.url || r.thumbnail);
    return hit?.url || hit?.thumbnail || null;
  } catch {
    return null;
  }
}

async function fetchWikipediaThumb(
  name: string,
  city?: string,
): Promise<string | null> {
  try {
    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('generator', 'search');
    searchUrl.searchParams.set('gsrsearch', `${name} ${city ?? ''}`.trim());
    searchUrl.searchParams.set('gsrlimit', '3');
    searchUrl.searchParams.set('prop', 'pageimages');
    searchUrl.searchParams.set('piprop', 'thumbnail');
    searchUrl.searchParams.set('pithumbsize', '800');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');

    const res = await fetch(searchUrl.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    };
    const pages = Object.values(data.query?.pages ?? {});
    for (const page of pages) {
      if (page.thumbnail?.source) return page.thumbnail.source;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch several candidate photo URLs for galleries. */
export async function fetchPlacePhotoUrls(
  name: string,
  city?: string,
  category?: string,
): Promise<string[]> {
  const urls: string[] = [];
  const [openverse, wiki] = await Promise.all([
    fetchOpenverseUrl(name, city, category),
    fetchWikipediaThumb(name, city),
  ]);
  if (openverse) urls.push(openverse);
  if (wiki) urls.push(wiki);
  urls.push(pollinationsUrl(name, city, category));
  urls.push(picsumUrl(name, city));
  return [...new Set(urls)];
}

/**
 * Cover image for a place. Tries real photos first, then reliable fallbacks.
 * (Broken static-map hosts were causing empty grey boxes.)
 */
export function PlaceImage({
  name,
  city,
  category,
  imageUrl,
  className,
}: PlaceImageProps) {
  const [src, setSrc] = useState(imageUrl || '');
  const [queue, setQueue] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(imageUrl || '');

    void (async () => {
      const urls = await fetchPlacePhotoUrls(name, city, category);
      if (cancelled) return;
      const list = imageUrl ? [imageUrl, ...urls.filter((u) => u !== imageUrl)] : urls;
      setQueue(list);
      setSrc(list[0] ?? '');
    })();

    return () => {
      cancelled = true;
    };
  }, [name, city, category, imageUrl]);

  if (failed || !src) {
    return (
      <div
        className={className}
        style={{
          display: 'grid',
          placeItems: 'center',
          background:
            'linear-gradient(135deg, #1f6f68 0%, #0f2f2c 55%, #c4a35a 140%)',
          color: 'white',
          fontSize: '0.9rem',
          fontWeight: 600,
          textAlign: 'center',
          padding: '0.75rem',
        }}
      >
        {name}
      </div>
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

/** @deprecated static map host is unreliable — use MiniMap instead */
export function mapCoverUrl(lat: number, lon: number, w = 640, h = 400): string {
  return `https://tile.openstreetmap.org/17/${lon}/${lat}.png?w=${w}&h=${h}`;
}
