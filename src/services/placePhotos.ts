import { haversineKm } from './geo';
import { locateSight } from './sightLocation';
import { mentionsPlace, sharesStem } from './nameMatch';
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
  /** Max photos to return (defaults to the full gallery). */
  limit?: number;
  /** Geocode curated sights without lat/lon so location steps apply. */
  locate?: boolean;
}

export type PhotoSourceInfo = {
  label: string;
  href?: string;
};

/** Gallery sizes: landmarks up to 8 (source order), food spots keep 10. */
const LANDMARK_PHOTOS = 8;
const FOOD_PHOTOS = 10;
/** Cards (PlaceImage) only ever show this many. */
export const CARD_PHOTOS = 3;
const PER_PAGE = 15;

const resultCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();
/** Photo fingerprint → cache key of the place that already uses it. */
const claimedBy = new Map<string, string>();

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function cacheKey(q: PlacePhotoQuery): string {
  return [
    'v17',
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

const FOOD_RE = /caf[eé]|coffee|espresso|restaurant|bakery|brunch|bistro|bar\b|pub|food|breakfast|pizz|grill|diner|eatery/i;
const FOOD_ALT_RE = /caf[eé]|coffee|espresso|latte|cappuccino|restaurant|food|dish|meal|plate|bakery|pastr|bread|croissant|breakfast|brunch|dining|table|interior|barista|drink|cup|menu|chef|kitchen|pizza|burger|salad|dessert|cake/i;

function isFoodPlace(category?: string): boolean {
  return FOOD_RE.test(category ?? '');
}

/** Short English word Pexels understands for the place's category. */
function categoryTerm(category?: string): string {
  const c = (category ?? '').toLowerCase();
  if (/coffee/.test(c)) return 'coffee shop';
  if (/caf/.test(c)) return 'cafe';
  if (/bakery/.test(c)) return 'bakery';
  if (/brunch|breakfast/.test(c)) return 'breakfast';
  if (/restaurant|food|grill|pizz|bistro/.test(c)) return 'restaurant';
  return c.replace(/[^a-z ]/g, ' ').trim();
}

function nameTokens(name: string): string[] {
  return cleanName(name)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

/**
 * Always anchor the name with city/category context: a bare name like
 * "Costa" otherwise returns coastlines instead of the café.
 */
function pexelsQueries(name: string, city?: string, category?: string): string[] {
  const n = cleanName(name);
  if (!n) return [];
  const cityBit = city?.trim();
  const term = categoryTerm(category);
  const queries: string[] = [];
  if (term) queries.push(`${n} ${term}${cityBit ? ` ${cityBit}` : ''}`);
  if (cityBit) queries.push(`${n} ${cityBit}`);
  // Generic, on-topic fallback for food spots Pexels won't know by name.
  if (isFoodPlace(category) && term) queries.push(`${term} interior`, `${term} food`);
  return queries;
}

/** Generic fallbacks return the same stock photos for every café, so each place reads a different page. */
function isGenericQuery(query: string, name: string): boolean {
  return !query.toLowerCase().includes(cleanName(name).toLowerCase());
}

/** Does a stock photo's alt text plausibly show this place? */
function pexelsRelevant(photo: PexelsPhoto, q: PlacePhotoQuery): boolean {
  const alt = (photo.alt ?? '').toLowerCase();
  if (!alt) return false;
  if (isFoodPlace(q.category)) return FOOD_ALT_RE.test(alt);
  const tokens = [...nameTokens(q.name), ...nameTokens(q.city ?? '')];
  return tokens.some((t) => alt.includes(t));
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

async function searchPexels(query: string, page = 1): Promise<PexelsPhoto[]> {
  const apiKey = (import.meta.env.VITE_PEXELS_API_KEY as string | undefined)?.trim();
  if (!apiKey) {
    console.error('[Pexels] Missing VITE_PEXELS_API_KEY. Add it to .env and restart Vite.');
    return [];
  }

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', String(page));
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
  coordinates?: { lat?: number; lon?: number }[];
};

function hasCoords(q: PlacePhotoQuery): q is PlacePhotoQuery & { lat: number; lon: number } {
  return Number.isFinite(q.lat) && Number.isFinite(q.lon);
}

/** Shared Commons query runner: returns pages with imageinfo (+ coordinates). */
async function commonsPages(params: Record<string, string>): Promise<CommonsPage[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '1400',
    ...params,
  }).toString();
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6500) });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: CommonsPage[] } };
    return data.query?.pages ?? [];
  } catch {
    return [];
  }
}

type WikidataMatch = { image?: string; category?: string };

/**
 * Find the place on Wikidata by name, confirmed by its coordinates (P625)
 * lying within 1 km. Returns its main image (P18) and Commons category (P373).
 */
async function wikidataMatch(name: string, lat: number, lon: number): Promise<WikidataMatch | null> {
  try {
    const search = new URL('https://www.wikidata.org/w/api.php');
    search.search = new URLSearchParams({
      action: 'wbsearchentities',
      search: cleanName(name),
      language: 'en',
      limit: '7',
      format: 'json',
      origin: '*',
    }).toString();
    const found = (await (await fetch(search.toString(), { signal: AbortSignal.timeout(6000) })).json()) as {
      search?: { id: string }[];
    };
    const ids = (found.search ?? []).map((e) => e.id);
    if (!ids.length) return null;

    const get = new URL('https://www.wikidata.org/w/api.php');
    get.search = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'claims',
      format: 'json',
      origin: '*',
    }).toString();
    type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
    const data = (await (await fetch(get.toString(), { signal: AbortSignal.timeout(6000) })).json()) as {
      entities?: Record<string, { claims?: Record<string, Claim[]> }>;
    };
    // Keep search ranking order; take the first entity close enough.
    for (const id of ids) {
      const claims = data.entities?.[id]?.claims;
      const coord = claims?.P625?.[0]?.mainsnak?.datavalue?.value as
        | { latitude?: number; longitude?: number }
        | undefined;
      if (coord?.latitude == null || coord.longitude == null) continue;
      if (haversineKm(lat, lon, coord.latitude, coord.longitude) > 1) continue;
      const image = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const category = claims?.P373?.[0]?.mainsnak?.datavalue?.value;
      return {
        image: typeof image === 'string' ? image : undefined,
        category: typeof category === 'string' ? category : undefined,
      };
    }
  } catch {
    /* fall through to text search */
  }
  return null;
}

function commonsQueries(name: string, city?: string): string[] {
  const n = cleanName(name);
  if (!n) return [];
  const cityBit = city?.trim();
  // Never search the bare name when we know the city: it drifts to unrelated
  // subjects (e.g. "Costa" → coastlines).
  return cityBit ? [`"${n}" ${cityBit}`, `${n} ${cityBit}`] : [`"${n}"`];
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
  url.searchParams.set('prop', 'imageinfo|coordinates');
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

/** Geosearch name check (any language): some title word shares a stem with the name. */
function sharesNameStem(title: string, name: string): boolean {
  return sharesStem(title.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, ''), name);
}

/** Files filed under a Commons category, e.g. Category:Pyramid of Tirana. */
function commonsCategoryFiles(category: string): Promise<CommonsPage[]> {
  return commonsPages({
    generator: 'categorymembers',
    gcmtitle: `Category:${category.replace(/^Category:/i, '')}`,
    gcmtype: 'file',
    gcmlimit: String(PER_PAGE * 2),
  });
}

async function searchAll(q: PlacePhotoQuery, key: string): Promise<string[]> {
  const food = isFoodPlace(q.category);
  const target = food ? FOOD_PHOTOS : LANDMARK_PHOTOS;
  const urls: string[] = [];
  const seen = new Set<string>();
  const full = () => urls.length >= target;
  // Skip photos another place already shows, so two places never share images.
  const add = (src: string | undefined) => {
    if (full() || !src || !/^https:\/\//i.test(src)) return;
    const fp = imageFingerprint(src);
    if (seen.has(fp)) return;
    const owner = claimedBy.get(fp);
    if (owner != null && owner !== key) return;
    seen.add(fp);
    claimedBy.set(fp, key);
    urls.push(src);
  };

  if (q.imageUrl && /images\.pexels\.com|pexels\.com/i.test(q.imageUrl)) add(q.imageUrl);

  const addCommons = (pages: CommonsPage[], requireName: boolean) => {
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info || !isUsableCommonsImage(info)) continue;
      if (requireName && !mentionsPlace(page.title ?? '', q.name)) continue;
      // Text matches geotagged far from the place are a different place.
      const at = page.coordinates?.[0];
      if (
        requireName &&
        hasCoords(q) &&
        at?.lat != null &&
        at.lon != null &&
        haversineKm(q.lat, q.lon, at.lat, at.lon) > 2
      ) {
        continue;
      }
      add(info.thumburl || info.url);
    }
  };

  const runPexels = async () => {
    for (const query of [...new Set(pexelsQueries(q.name, q.city, q.category))]) {
      if (full()) break;
      const generic = isGenericQuery(query, q.name);
      // Landmarks only use stock photos whose description names the place.
      if (!food && generic) continue;
      const page = generic ? 1 + (hashString(key) % 8) : 1;
      for (const photo of await searchPexels(query, page)) {
        if (!isLandscape(photo) || !isVisibleQuality(photo)) continue;
        const alt = photo.alt ?? '';
        if (food ? !pexelsRelevant(photo, q) : !mentionsPlace(alt, q.name)) continue;
        add(photo.src?.large || photo.src?.large2x || photo.src?.medium);
      }
    }
  };

  const runCommons = async () => {
    if (!food && hasCoords(q)) {
      // 1–2. Wikidata entity confirmed by location: main image, then its category.
      const match = await wikidataMatch(q.name, q.lat, q.lon);
      if (match?.image) addCommons(await commonsPages({ titles: `File:${match.image}` }), false);
      addCommons(await commonsCategoryFiles(match?.category ?? q.name), false);
      // 3. Geotagged files: within 50 m, or within 150 m and sharing a name stem.
      if (!full()) {
        const pages = await commonsPages({
          generator: 'geosearch',
          ggscoord: `${q.lat}|${q.lon}`,
          ggsradius: '150',
          ggsnamespace: '6',
          ggslimit: String(PER_PAGE * 2),
          prop: 'imageinfo|coordinates',
        });
        const { lat, lon } = q;
        addCommons(
          pages.filter((page) => {
            const at = page.coordinates?.[0];
            if (at?.lat == null || at.lon == null) return false;
            const m = haversineKm(lat, lon, at.lat, at.lon) * 1000;
            if (m <= 50) return true;
            return m <= 150 && sharesNameStem(page.title ?? '', q.name);
          }),
          false,
        );
      }
    } else if (!food) {
      addCommons(await commonsCategoryFiles(q.name), false);
    }
    // 4. Text search, name rules + distance check.
    for (const query of [...new Set(commonsQueries(q.name, q.city))]) {
      if (full()) break;
      addCommons(await searchCommons(query), true);
    }
  };

  // Landmarks: real Commons photos first; food spots: stock photos first.
  if (food) {
    await runPexels();
    await runCommons();
  } else {
    await runCommons();
    await runPexels();
  }

  return urls.slice(0, target);
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

  const limit = extras?.limit;
  const cut = (urls: string[]) => (limit ? urls.slice(0, limit) : urls);

  // Key before geocoding so the card and detail page share one result.
  const key = cacheKey(q) + (extras?.locate ? '|locate' : '');
  const cached = resultCache.get(key);
  if (cached) return cut(cached);

  const pending = inflight.get(key);
  if (pending) return pending.then(cut);

  const promise = (async () => {
    if (extras?.locate && !hasCoords(q) && q.city && !isFoodPlace(q.category)) {
      const point = await locateSight(q.name, q.city);
      if (point) {
        q.lat = point.lat;
        q.lon = point.lon;
      }
    }
    return searchAll(q, key);
  })()
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
  return promise.then(cut);
}
