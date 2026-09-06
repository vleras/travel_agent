/**
 * Multi-source place photos (browser-safe, no API keys).
 * Cascade: OSM/Wikidata links → Wikipedia/Commons → nearby geotagged → Openverse.
 * Instagram/Google Images aren’t available without scraping or paid keys.
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

const resultCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function cacheKey(q: PlacePhotoQuery): string {
  return [
    q.name,
    q.city ?? '',
    q.lat?.toFixed(4) ?? '',
    q.lon?.toFixed(4) ?? '',
    q.wikidataId ?? '',
    q.imageUrl ?? '',
  ]
    .join('|')
    .toLowerCase();
}

const STOP = new Set([
  'the', 'and', 'for', 'del', 'della', 'delle', 'dei', 'di', 'da', 'la', 'le',
  'il', 'lo', 'gli', 'une', 'des', 'les', 'von', 'van', 'cafe', 'café', 'bar',
  'restaurant', 'bakery', 'hotel', 'shop', 'store',
]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function relevanceScore(haystack: string, name: string): number {
  const h = haystack.toLowerCase();
  const tokens = nameTokens(name);
  if (!tokens.length) {
    const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return compact.length >= 3 && h.includes(compact) ? 1 : 0;
  }
  let hits = 0;
  for (const t of tokens) if (h.includes(t)) hits += 1;
  if (h.includes(name.toLowerCase())) hits += tokens.length;
  return hits / tokens.length;
}

function commonsFileUrl(fileTitle: string): string {
  const title = fileTitle.replace(/^File:/i, '').trim();
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=800`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 4500,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function wikiApi(
  host: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`https://${host}/w/api.php`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return (await fetchJson(url.toString())) as Record<string, unknown> | null;
}

function pushUnique(list: string[], url: string | null | undefined) {
  if (url && /^https?:\/\//i.test(url) && !list.includes(url)) list.push(url);
}

async function fromWikidata(id: string): Promise<string | null> {
  const clean = id.trim().toUpperCase();
  if (!/^Q\d+$/.test(clean)) return null;
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', clean);
  url.searchParams.set('props', 'claims');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const data = (await fetchJson(url.toString())) as {
    entities?: Record<
      string,
      { claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> } }
    >;
  } | null;
  const file = data?.entities?.[clean]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file ? commonsFileUrl(file) : null;
}

async function fromWikipediaTag(tag: string): Promise<string | null> {
  const m = tag.match(/^(?:([a-z]{2,3}):)?(.+)$/i);
  if (!m) return null;
  const lang = (m[1] || 'en').toLowerCase();
  const title = m[2].replace(/_/g, ' ');
  // REST summary is fast and CORS-friendly
  const summary = (await fetchJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  )) as { thumbnail?: { source?: string }; originalimage?: { source?: string } } | null;
  return summary?.originalimage?.source || summary?.thumbnail?.source || null;
}

function wikiLangsForCity(city?: string): string[] {
  const c = (city ?? '').toLowerCase();
  if (/roma|rome|milan|firenze|florence|venezia|venice|napoli|naples/.test(c)) {
    return ['it', 'en'];
  }
  if (/paris|lyon|marseille|nice/.test(c)) return ['fr', 'en'];
  if (/madrid|barcelona|sevilla|valencia/.test(c)) return ['es', 'en'];
  if (/berlin|münchen|munich|hamburg|köln|cologne/.test(c)) return ['de', 'en'];
  if (/lisboa|lisbon|porto/.test(c)) return ['pt', 'en'];
  if (/tokyo|kyoto|osaka/.test(c)) return ['ja', 'en'];
  return ['en'];
}

async function searchWikipedia(name: string, city?: string): Promise<string[]> {
  const query = [name, city].filter(Boolean).join(' ');
  const found: Array<{ url: string; score: number }> = [];

  await Promise.all(
    wikiLangsForCity(city).map(async (lang) => {
      const data = await wikiApi(`${lang}.wikipedia.org`, {
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrlimit: '6',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '800',
      });
      if (!data) return;
      const pages = Object.values(
        (data.query as {
          pages?: Record<string, { title?: string; thumbnail?: { source?: string } }>;
        })?.pages ?? {},
      );
      for (const page of pages) {
        if (!page.thumbnail?.source) continue;
        const score = relevanceScore(`${page.title ?? ''}`, name);
        if (score >= 0.4) found.push({ url: page.thumbnail.source, score });
      }
    }),
  );

  found.sort((a, b) => b.score - a.score);
  return [...new Set(found.map((f) => f.url))];
}

async function searchCommonsByName(name: string, city?: string): Promise<string[]> {
  const q = [name, city].filter(Boolean).join(' ');
  const data = await wikiApi('commons.wikimedia.org', {
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '800',
  });
  if (!data) return [];

  const pages = Object.values(
    (data.query as {
      pages?: Record<
        string,
        { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string }> }
      >;
    })?.pages ?? {},
  );

  const found: Array<{ url: string; score: number }> = [];
  for (const page of pages) {
    const url = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url;
    if (!url) continue;
    const score = relevanceScore(`${page.title ?? ''}`, name);
    if (score >= 0.4) found.push({ url, score });
  }
  found.sort((a, b) => b.score - a.score);
  return [...new Set(found.map((f) => f.url))];
}

async function searchCommonsNearby(
  lat: number,
  lon: number,
  name: string,
): Promise<string[]> {
  const data = await wikiApi('commons.wikimedia.org', {
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lon}`,
    gsradius: '200',
    gslimit: '15',
    gsnamespace: '6',
  });
  if (!data) return [];

  const hits = (
    data.query as { geosearch?: Array<{ pageid: number; title: string; dist: number }> }
  )?.geosearch;
  if (!hits?.length) return [];

  const info = await wikiApi('commons.wikimedia.org', {
    action: 'query',
    pageids: hits.map((h) => h.pageid).join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '800',
  });
  if (!info) return [];

  const pages = (info.query as {
    pages?: Record<
      string,
      { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string }> }
    >;
  })?.pages;

  const scored: Array<{ url: string; score: number; dist: number }> = [];
  for (const hit of hits) {
    const page = pages?.[String(hit.pageid)];
    const url = page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url;
    if (!url) continue;
    // Prefer very close shots; boost filename match
    const nameScore = relevanceScore(`${page?.title ?? ''}`, name);
    const proximity = hit.dist <= 35 ? 0.85 : hit.dist <= 90 ? 0.55 : 0.3;
    scored.push({ url, score: Math.max(nameScore, proximity), dist: hit.dist });
  }
  scored.sort((a, b) => b.score - a.score || a.dist - b.dist);
  return [...new Set(scored.map((s) => s.url))].slice(0, 5);
}

async function searchOpenverse(
  name: string,
  city?: string,
  category?: string,
): Promise<string[]> {
  const queries = [
    [name, city].filter(Boolean).join(' '),
    [name, category, city].filter(Boolean).join(' '),
  ];
  const found: Array<{ url: string; score: number }> = [];

  for (const q of queries) {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.searchParams.set('q', q);
    url.searchParams.set('page_size', '10');
    url.searchParams.set('mature', 'false');
    const data = (await fetchJson(url.toString(), {
      headers: { Accept: 'application/json' },
    })) as {
      results?: Array<{ title?: string; url?: string; thumbnail?: string }>;
    } | null;
    if (!data?.results) continue;

    for (const r of data.results) {
      const img = r.url || r.thumbnail;
      if (!img) continue;
      const score = relevanceScore(`${r.title ?? ''}`, name);
      if (score >= 0.45) found.push({ url: img, score });
    }
    if (found.some((f) => f.score >= 0.75)) break;
  }

  found.sort((a, b) => b.score - a.score);
  return [...new Set(found.map((f) => f.url))];
}

/** One Nominatim lookup — only when we still have nothing. */
async function fromNominatim(name: string, city?: string): Promise<string[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', [name, city].filter(Boolean).join(', '));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '2');
  url.searchParams.set('extratags', '1');
  const data = (await fetchJson(url.toString(), {
    headers: { Accept: 'application/json' },
  })) as Array<{
    display_name?: string;
    extratags?: Record<string, string>;
  }> | null;
  if (!Array.isArray(data)) return [];

  const urls: string[] = [];
  for (const row of data) {
    if (relevanceScore(row.display_name ?? '', name) < 0.34) continue;
    const ex = row.extratags ?? {};
    if (ex.image?.startsWith('http')) pushUnique(urls, ex.image);
    if (ex.wikidata) pushUnique(urls, await fromWikidata(ex.wikidata));
    if (ex.wikipedia) pushUnique(urls, await fromWikipediaTag(ex.wikipedia));
    if (ex.wikimedia_commons) {
      pushUnique(
        urls,
        ex.wikimedia_commons.startsWith('http')
          ? ex.wikimedia_commons
          : commonsFileUrl(ex.wikimedia_commons),
      );
    }
  }
  return urls;
}

async function resolveKnownLinks(q: PlacePhotoQuery): Promise<string[]> {
  const urls: string[] = [];
  pushUnique(urls, q.imageUrl);
  if (q.commonsTag) {
    pushUnique(
      urls,
      q.commonsTag.startsWith('http')
        ? q.commonsTag
        : commonsFileUrl(q.commonsTag),
    );
  }
  const [wiki, wd] = await Promise.all([
    q.wikipediaTag ? fromWikipediaTag(q.wikipediaTag) : Promise.resolve(null),
    q.wikidataId ? fromWikidata(q.wikidataId) : Promise.resolve(null),
  ]);
  pushUnique(urls, wiki);
  pushUnique(urls, wd);
  return urls;
}

async function searchAll(q: PlacePhotoQuery): Promise<string[]> {
  const urls = await resolveKnownLinks(q);
  if (urls.length >= 2) return urls.slice(0, 8);

  // Fast parallel: wiki + commons name + nearby street photos
  const [wiki, commons, nearby] = await Promise.all([
    searchWikipedia(q.name, q.city),
    searchCommonsByName(q.name, q.city),
    q.lat != null && q.lon != null
      ? searchCommonsNearby(q.lat, q.lon, q.name)
      : Promise.resolve([] as string[]),
  ]);

  for (const u of wiki) pushUnique(urls, u);
  for (const u of commons) pushUnique(urls, u);
  for (const u of nearby) pushUnique(urls, u);

  if (urls.length >= 2) return urls.slice(0, 8);

  // Broader CC search + OSM linked media
  const [openverse, nominatim] = await Promise.all([
    searchOpenverse(q.name, q.city, q.category),
    fromNominatim(q.name, q.city),
  ]);
  for (const u of openverse) pushUnique(urls, u);
  for (const u of nominatim) pushUnique(urls, u);

  return urls.slice(0, 8);
}

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
