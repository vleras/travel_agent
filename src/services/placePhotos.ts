/**
 * Place photos from Pexels only (browser-safe).
 * No Unsplash / Wikimedia / other fallbacks.
 * Search: https://api.pexels.com/v1/search (~200 req/hour).
 */

export interface PlacePhotoQuery {
  name: string;
  city?: string;
  category?: string;
  lat?: number;
  lon?: number;
  imageUrl?: string;
  wikidataId?: string;
  wikipediaTag?: string;
  commonsTag?: string;
}

export type PhotoSourceInfo = {
  label: string;
  href?: string;
};

const TARGET_PLACE_PHOTOS = 10;
const PER_PAGE = 15;

const resultCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function cacheKey(q: PlacePhotoQuery): string {
  return [
    'v11',
    q.name,
    q.city ?? '',
    q.category ?? '',
    q.lat?.toFixed(4) ?? '',
    q.lon?.toFixed(4) ?? '',
    q.imageUrl ?? '',
  ]
    .join('|')
    .toLowerCase();
}

export function imageFingerprint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase();
  } catch {
    return url.replace(/\?.*$/, '').toLowerCase();
  }
}

/** Human-readable credit + optional page link inferred from a photo URL. */
export function photoSourceFromUrl(url: string): PhotoSourceInfo | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'images.pexels.com' || host.endsWith('pexels.com')) {
      const id = u.pathname.match(/\/photos\/(\d+)\//)?.[1];
      return {
        label: 'Pexels',
        href: id
          ? `https://www.pexels.com/photo/${id}/`
          : 'https://www.pexels.com',
      };
    }
    return { label: host };
  } catch {
    return null;
  }
}

type PlaceKind =
  | 'landmark'
  | 'restaurant'
  | 'street'
  | 'museum'
  | 'park';

function detectPlaceKind(name: string, category?: string): PlaceKind {
  const hay = `${category ?? ''} ${name}`.toLowerCase();
  if (
    /\b(food|restaurant|café|cafe|bakery|market|trattoria|deli|pizza|coffee|breakfast|gelato|brunch|eatery|bistro)\b/.test(
      hay,
    )
  ) {
    return 'restaurant';
  }
  if (/\b(museum|gallery|exhibit|collection)\b/.test(hay)) return 'museum';
  if (/\b(park|garden|nature|beach|coast|hill|botanic)\b/.test(hay)) {
    return 'park';
  }
  if (
    /\b(street|neighborhood|neighbourhood|district|quarter|walk|alley|nightlife|souk|bazaar)\b/.test(
      hay,
    )
  ) {
    return 'street';
  }
  return 'landmark';
}

function cleanName(name: string): string {
  return name
    .replace(/\b(day trip|nightlife|evening|dinner|tour|walk|ride|stroll|&)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kind-specific Pexels search queries. */
function pexelsQueries(
  name: string,
  kind: PlaceKind,
  city?: string,
): string[] {
  const n = cleanName(name);
  const withCity = (q: string) => {
    const cityBit = city?.trim();
    return cityBit ? [q, `${q} ${cityBit}`] : [q];
  };

  switch (kind) {
    case 'restaurant':
      return [
        ...withCity(`${n} interior`),
        'cozy restaurant',
        'ambient dining',
      ];
    case 'street':
      return [
        ...withCity(`${n} street photography`),
        ...withCity(`${n} street life`),
      ];
    case 'museum':
      return [
        ...withCity(`${n} interior`),
        ...withCity(`${n} exhibits`),
      ];
    case 'park':
      return [
        ...withCity(`${n} scenic`),
        ...withCity(`${n} landscape`),
      ];
    default:
      return [
        ...withCity(`${n} sunset`),
        ...withCity(`${n} golden hour`),
        ...withCity(`${n} daytime landscape`),
      ];
  }
}

type PexelsPhoto = {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  alt?: string | null;
  photographer?: string;
  likes?: number;
  liked?: boolean;
  avg_color?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
  };
};

function isLandscape(photo: PexelsPhoto): boolean {
  const w = photo.width ?? 0;
  const h = photo.height ?? 0;
  if (w > 0 && h > 0) return w / h >= 1.25;
  return true;
}

function isVisibleQuality(photo: PexelsPhoto): boolean {
  const w = photo.width ?? 0;
  const h = photo.height ?? 0;
  if (w > 0 && w < 800) return false;
  if (h > 0 && h < 500) return false;
  // Skip near-grayscale dull frames when avg_color is available
  const hex = photo.avg_color?.trim();
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / (3 * 255);
    if (sat < 0.08 && (lum < 0.18 || lum > 0.88)) return false;
  }
  return true;
}

async function searchPexels(query: string): Promise<PexelsPhoto[]> {
  const apiKey = (import.meta.env.VITE_PEXELS_API_KEY as string | undefined)?.trim();
  if (!apiKey) {
    console.error('[Pexels] Missing VITE_PEXELS_API_KEY — add it to .env and restart Vite.');
    return [];
  }

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', '1');
  url.searchParams.set('orientation', 'landscape');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5500);
  try {
    // Pexels expects the raw API key in Authorization (not a Bearer token).
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: apiKey,
      },
      signal: ctrl.signal,
    });
    if (res.status === 401) {
      console.error('[Pexels] Unauthorized (401) — check VITE_PEXELS_API_KEY.');
      return [];
    }
    if (!res.ok) {
      console.error('[Pexels]', { query, status: res.status, results: 0 });
      return [];
    }
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    const photos = data.photos ?? [];
    const top3 = photos.slice(0, 3).map((p) => ({
      title: p.alt?.trim() || p.url || '(no title)',
      likes: p.likes ?? (p.liked ? 1 : 0),
      photographer: p.photographer?.trim() || '(unknown)',
      url: p.src?.large || p.src?.large2x || p.src?.medium || '(no url)',
    }));
    console.log('[Pexels]', {
      query,
      results: photos.length,
      top3,
    });
    return photos;
  } catch (err) {
    console.error('[Pexels] Request failed', { query, err });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchAll(q: PlacePhotoQuery): Promise<string[]> {
  const kind = detectPlaceKind(q.name, q.category);
  const queries = [...new Set(pexelsQueries(q.name, kind, q.city))].filter(
    Boolean,
  );
  const urls: string[] = [];
  const seen = new Set<string>();

  // Prefer a known Unsplash/Pexels seed only if it's already a usable https URL
  if (q.imageUrl && /^https:\/\//i.test(q.imageUrl)) {
    // Skip non-Pexels seeds so we stay single-source when possible
    if (/images\.pexels\.com|pexels\.com/i.test(q.imageUrl)) {
      seen.add(imageFingerprint(q.imageUrl));
      urls.push(q.imageUrl);
    }
  }

  for (const query of queries) {
    if (urls.length >= TARGET_PLACE_PHOTOS) break;
    const photos = await searchPexels(query);
    for (const photo of photos) {
      if (urls.length >= TARGET_PLACE_PHOTOS) break;
      if (!isLandscape(photo) || !isVisibleQuality(photo)) continue;
      const src =
        photo.src?.large || photo.src?.large2x || photo.src?.medium;
      if (!src || !/^https:\/\//i.test(src)) continue;
      const fp = imageFingerprint(src);
      if (seen.has(fp)) continue;
      seen.add(fp);
      urls.push(src);
    }
  }

  return urls.slice(0, TARGET_PLACE_PHOTOS);
}

/**
 * Fetch ~10 place photos from Pexels (cached per place).
 * Signature kept compatible with existing callers (name, city, category, …).
 */
export async function fetchPlacePhotoUrls(
  name: string,
  city?: string,
  category?: string,
  lat?: number,
  lon?: number,
  extras?: Partial<PlacePhotoQuery>,
): Promise<string[]> {
  const q: PlacePhotoQuery = {
    name,
    city,
    category,
    lat,
    lon,
    imageUrl: extras?.imageUrl,
    wikidataId: extras?.wikidataId,
    wikipediaTag: extras?.wikipediaTag,
    commonsTag: extras?.commonsTag,
  };

  const key = cacheKey(q);
  const cached = resultCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = searchAll(q)
    .then((urls) => {
      resultCache.set(key, urls);
      inflight.delete(key);
      return urls;
    })
    .catch(() => {
      inflight.delete(key);
      return [] as string[];
    });

  inflight.set(key, promise);
  return promise;
}
