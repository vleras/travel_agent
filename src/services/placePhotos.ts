/**
 * Browser-safe place photos from Pexels and Wikimedia Commons.
 * Search: https://api.pexels.com/v1/search (~200 req/hour).
 * Commons is used as a no-key fallback when Pexels has too few matches.
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
    'v12',
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
    if (host === 'upload.wikimedia.org' || host.endsWith('.wikimedia.org')) {
      const parts = u.pathname.split('/').filter(Boolean);
      // Thumbnail URLs end in /Original_file.jpg/1400px-Original_file.jpg.
      const filename = decodeURIComponent(
        u.pathname.includes('/thumb/')
          ? (parts.at(-2) ?? '')
          : (parts.at(-1) ?? ''),
      );
      return {
        label: 'Wikimedia Commons',
        href: filename
          ? `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`
          : 'https://commons.wikimedia.org',
      };
    }
    return { label: host };
  } catch {
    return null;
  }
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Straightforward queries: place name, plus name+city when city is known. */
function pexelsQueries(name: string, city?: string): string[] {
  const n = cleanName(name);
  if (!n) return [];
  const cityBit = city?.trim();
  if (cityBit) return [n, `${n} ${cityBit}`];
  return [n];
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
    console.error('[Pexels] Missing VITE_PEXELS_API_KEY. Add it to .env and restart Vite.');
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
      console.error('[Pexels] Unauthorized (401). Check VITE_PEXELS_API_KEY.');
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

type CommonsImageInfo = {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  mime?: string;
};

type CommonsPage = {
  title?: string;
  imageinfo?: CommonsImageInfo[];
};

function commonsQueries(name: string, city?: string): string[] {
  const n = cleanName(name);
  if (!n) return [];
  const cityBit = city?.trim();
  return cityBit ? [`"${n}" ${cityBit}`, `"${n}"`, `${n} ${cityBit}`] : [`"${n}"`, n];
}

function isUsableCommonsImage(info: CommonsImageInfo): boolean {
  const mime = info.mime ?? '';
  if (!/^image\/(jpeg|png|webp)$/i.test(mime)) return false;
  const width = info.thumbwidth ?? info.width ?? 0;
  const height = info.thumbheight ?? info.height ?? 0;
  if (width > 0 && width < 700) return false;
  if (height > 0 && height < 400) return false;
  return width <= 0 || height <= 0 || width / height >= 1.15;
}

async function searchCommons(query: string): Promise<CommonsPage[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('origin', '*');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', String(PER_PAGE));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime');
  url.searchParams.set('iiurlwidth', '1400');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6500);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error('[Wikimedia Commons]', { query, status: res.status, results: 0 });
      return [];
    }
    const data = (await res.json()) as { query?: { pages?: CommonsPage[] } };
    const pages = data.query?.pages ?? [];
    console.log('[Wikimedia Commons]', { query, results: pages.length });
    return pages;
  } catch (err) {
    console.error('[Wikimedia Commons] Request failed', { query, err });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchAll(q: PlacePhotoQuery): Promise<string[]> {
  const queries = [...new Set(pexelsQueries(q.name, q.city))].filter(Boolean);
  const urls: string[] = [];
  const seen = new Set<string>();

  // Prefer a known Pexels seed if present
  if (
    q.imageUrl &&
    /^https:\/\//i.test(q.imageUrl) &&
    /images\.pexels\.com|pexels\.com/i.test(q.imageUrl)
  ) {
    seen.add(imageFingerprint(q.imageUrl));
    urls.push(q.imageUrl);
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

  // Commons often has exact landmark photos that stock-photo search misses.
  if (urls.length < TARGET_PLACE_PHOTOS) {
    const queries = [...new Set(commonsQueries(q.name, q.city))];
    for (const query of queries) {
      if (urls.length >= TARGET_PLACE_PHOTOS) break;
      const pages = await searchCommons(query);
      for (const page of pages) {
        if (urls.length >= TARGET_PLACE_PHOTOS) break;
        const info = page.imageinfo?.[0];
        if (!info || !isUsableCommonsImage(info)) continue;
        const src = info.thumburl || info.url;
        if (!src || !/^https:\/\//i.test(src)) continue;
        const fp = imageFingerprint(src);
        if (seen.has(fp)) continue;
        seen.add(fp);
        urls.push(src);
      }
    }
  }

  return urls.slice(0, TARGET_PLACE_PHOTOS);
}

/**
 * Fetch ~10 place photos from Pexels and Wikimedia Commons (cached per place).
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
