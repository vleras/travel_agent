/**
 * Multi-source place photos (browser-safe, no API keys).
 * Prefers iconic Wikipedia/Commons lead photos; dedupes file variants;
 * avoids maps/logos and weak nearby street shots when better matches exist.
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

interface ScoredPhoto {
  url: string;
  score: number;
  source: 'known' | 'wiki' | 'commons' | 'nearby' | 'openverse' | 'nominatim';
  titleHint: string;
}

const resultCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();
/** Avoid showing the same Commons file on two different places in one session. */
const claimedFingerprints = new Map<string, string>();

function cacheKey(q: PlacePhotoQuery): string {
  return [
    'v5',
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
  'restaurant', 'bakery', 'hotel', 'shop', 'store', 'visit', 'tour', 'walk',
  'ride', 'day', 'trip', 'nightlife', 'evening', 'dinner',
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

/** Same Commons file at different sizes / hosts → one fingerprint. */
function normalizeFileKey(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  return s
    .replace(/^File:/i, '')
    .replace(/^\d+px-/i, '')
    .replace(/\+/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function imageFingerprint(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);

    // Special:FilePath/Name.jpg
    const filepath = path.match(/\/special:filepath\/(.+)$/i);
    if (filepath?.[1]) return `commons:${normalizeFileKey(filepath[1])}`;

    // /wikipedia/commons/thumb/d/de/File.jpg/800px-File.jpg
    // /wikipedia/commons/d/de/File.jpg
    const commons = path.match(
      /\/wikipedia\/commons\/(?:thumb\/)?(?:[0-9a-f]\/[0-9a-f]{2}\/)?([^/]+?)(?:\/\d+px-[^/]+)?$/i,
    );
    if (commons?.[1]) return `commons:${normalizeFileKey(commons[1])}`;

    // Wikimedia static hash paths sometimes include /wikipedia/en/ etc.
    const wikiStatic = path.match(
      /\/wikipedia\/[^/]+\/(?:thumb\/)?(?:[0-9a-f]\/[0-9a-f]{2}\/)?([^/]+?)(?:\/\d+px-[^/]+)?$/i,
    );
    if (wikiStatic?.[1] && /\.(jpe?g|png|webp|gif)$/i.test(wikiStatic[1])) {
      return `commons:${normalizeFileKey(wikiStatic[1])}`;
    }

    // Flickr / Openverse size variants
    let base = (path.split('/').pop() ?? path).toLowerCase();
    base = base
      .replace(/_[a-z]\.(jpe?g|png|webp)$/i, '.$1')
      .replace(/_\d{2,4}\.(jpe?g|png|webp)$/i, '.$1')
      .replace(/-(small|medium|large|original)\.(jpe?g|png|webp)$/i, '.$1');

    return `${u.hostname.replace(/^www\./, '')}/${normalizeFileKey(base)}`;
  } catch {
    return normalizeFileKey(url.replace(/\?.*$/, ''));
  }
}

function uniquePhotoCount(scored: ScoredPhoto[]): number {
  const seen = new Set<string>();
  for (const item of scored) seen.add(imageFingerprint(item.url));
  return seen.size;
}

const UGLY =
  /\b(map|logo|icon|flag|seal|coa|coat[_ ]of[_ ]arms|diagram|svg|plan|blueprint|sign|poster|sticker|qr[_ ]?code|screenshot|crop|detail_of|cropped)\b/i;
const PRETTY =
  /\b(sunset|sunrise|dusk|dawn|golden|panorama|skyline|aerial|drone|night|illuminat|view|vista|exterior|facade|façade|harbour|harbor|bridge|plaza|square|garden|temple|palace|cathedral|fountain|beach|coast)\b/i;

function beautyBonus(titleOrUrl: string): number {
  let score = 0;
  if (PRETTY.test(titleOrUrl)) score += 0.35;
  if (UGLY.test(titleOrUrl)) score -= 0.8;
  if (/\.svg(\?|$)/i.test(titleOrUrl)) score -= 1.2;
  if (/upload\.wikimedia\.org/i.test(titleOrUrl)) score += 0.15;
  return score;
}

function commonsFileUrl(fileTitle: string, width = 1200): string {
  const title = fileTitle.replace(/^File:/i, '').trim();
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${width}`;
}

/** Prefer a stable wide Commons URL when we can extract the filename. */
function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const m = path.match(
      /\/wikipedia\/commons\/(?:thumb\/)?(?:[0-9a-f]\/[0-9a-f]{2}\/)?([^/]+?)(?:\/\d+px-[^/]+)?$/i,
    );
    if (m?.[1] && !m[1].toLowerCase().endsWith('.svg')) {
      return commonsFileUrl(m[1].replace(/^\d+px-/i, ''), 1200);
    }
  } catch {
    /* keep original */
  }
  return url;
}

/** Drop soft filler words so “Bondi to Coogee walk” still finds Bondi photos. */
function searchName(name: string): string {
  return name
    .replace(/\b(day trip|nightlife|evening|dinner|tour|walk|ride|stroll|&)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    const text = await res.text();
    if (!text || text.startsWith('You are making too many')) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
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

function pushScored(
  list: ScoredPhoto[],
  url: string | null | undefined,
  baseScore: number,
  source: ScoredPhoto['source'],
  titleHint = '',
) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (/\.svg(\?|$)/i.test(url) || UGLY.test(url) || UGLY.test(titleHint)) return;
  const canonical = canonicalizeUrl(url);
  const fp = imageFingerprint(canonical);
  // Skip exact duplicates as we collect — keeps later ranking cleaner
  if (list.some((item) => imageFingerprint(item.url) === fp)) {
    // Keep the higher-scoring copy
    const existing = list.find((item) => imageFingerprint(item.url) === fp);
    const nextScore = baseScore + beautyBonus(`${titleHint} ${canonical}`);
    if (existing && nextScore > existing.score) {
      existing.score = nextScore;
      existing.source = source;
      existing.url = canonical;
      existing.titleHint = titleHint || existing.titleHint;
    }
    return;
  }
  list.push({
    url: canonical,
    score: baseScore + beautyBonus(`${titleHint} ${canonical}`),
    source,
    titleHint,
  });
}

/** Rough scene tags so we don't fill a gallery with six night shots. */
function photoSceneTags(url: string, titleHint = ''): string[] {
  const hay = `${normalizeFileKey(titleHint)} ${normalizeFileKey(url)}`;
  const tags: string[] = [];
  if (/\b(night|nocturne|evening|dusk|illuminat|lights)\b/.test(hay)) {
    tags.push('night');
  }
  if (/\b(day|morning|noon|afternoon|sunny|daytime)\b/.test(hay)) {
    tags.push('day');
  }
  if (/\b(interior|inside|innen|interno|indoors)\b/.test(hay)) {
    tags.push('interior');
  }
  if (/\b(exterior|outside|facade|façade|front|entrance)\b/.test(hay)) {
    tags.push('exterior');
  }
  if (/\b(aerial|drone|bird.?s.?eye|from above)\b/.test(hay)) {
    tags.push('aerial');
  }
  if (/\b(detail|close.?up|sculpture|statue|fresco|mosaic)\b/.test(hay)) {
    tags.push('detail');
  }
  if (/\b(crowd|people|tourist)\b/.test(hay)) tags.push('people');
  return tags.length ? tags : ['general'];
}

function titleTokenOverlap(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits / Math.max(ta.size, tb.size);
}

function looksTooSimilar(a: ScoredPhoto, b: ScoredPhoto): boolean {
  const tagsA = photoSceneTags(a.url, a.titleHint);
  const tagsB = photoSceneTags(b.url, b.titleHint);
  const sharedScene = tagsA.some(
    (t) => t !== 'general' && tagsB.includes(t),
  );
  const overlap = titleTokenOverlap(
    `${a.titleHint} ${a.url}`,
    `${b.titleHint} ${b.url}`,
  );
  // Same angle (e.g. both night) or very similar filenames/titles
  if (sharedScene && overlap >= 0.35) return true;
  if (overlap >= 0.55) return true;
  return false;
}

function finalizePhotos(
  scored: ScoredPhoto[],
  placeName: string,
  limit = 4,
): string[] {
  scored.sort((a, b) => b.score - a.score);

  const placeKey = placeName.toLowerCase();
  const out: ScoredPhoto[] = [];
  const seen = new Set<string>();
  const usedScenes = new Set<string>();

  const ranked = [
    ...scored.filter(
      (s) =>
        s.source === 'known' ||
        s.source === 'wiki' ||
        s.source === 'commons' ||
        s.source === 'nominatim',
    ),
    ...scored.filter((s) => s.source === 'nearby' || s.source === 'openverse'),
  ];

  for (const item of ranked) {
    if (item.score < 0.45) continue;

    const curatedCount = out.filter((u) =>
      /wikimedia\.org|wikipedia\.org|commons\.wikimedia/i.test(u.url),
    ).length;

    if (
      (item.source === 'openverse' || item.source === 'nearby') &&
      curatedCount >= limit
    ) {
      continue;
    }

    const fp = imageFingerprint(item.url);
    if (seen.has(fp)) continue;

    const owner = claimedFingerprints.get(fp);
    if (owner && owner !== placeKey) continue;

    if (out.some((picked) => looksTooSimilar(picked, item))) continue;

    const scenes = photoSceneTags(item.url, item.titleHint);
    const primary = scenes.find((s) => s !== 'general') ?? 'general';
    // Allow at most one photo per non-general scene tag
    if (primary !== 'general' && usedScenes.has(primary)) continue;

    seen.add(fp);
    claimedFingerprints.set(fp, placeKey);
    if (primary !== 'general') usedScenes.add(primary);
    out.push(item);
    if (out.length >= limit) break;
  }

  // If diversity was too strict and we have fewer than needed, fill with
  // non-exact-duplicates we previously skipped for scene/title similarity
  if (out.length < Math.min(limit, 4)) {
    for (const item of ranked) {
      if (out.length >= limit) break;
      const fp = imageFingerprint(item.url);
      if (seen.has(fp)) continue;
      if (item.score < 0.45) continue;
      const owner = claimedFingerprints.get(fp);
      if (owner && owner !== placeKey) continue;
      // Still skip near-identical titles
      if (
        out.some(
          (picked) =>
            titleTokenOverlap(
              `${picked.titleHint} ${picked.url}`,
              `${item.titleHint} ${item.url}`,
            ) >= 0.7,
        )
      ) {
        continue;
      }
      seen.add(fp);
      claimedFingerprints.set(fp, placeKey);
      out.push(item);
    }
  }

  return out.map((p) => p.url);
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

async function wikipediaSummaryPhoto(
  title: string,
  lang: string,
): Promise<{ url: string; title: string } | null> {
  const summary = (await fetchJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  )) as {
    title?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    type?: string;
  } | null;
  if (!summary || summary.type === 'disambiguation') return null;
  const url = summary.originalimage?.source || summary.thumbnail?.source;
  if (!url) return null;
  return { url, title: summary.title ?? title };
}

async function fromWikipediaTag(tag: string): Promise<string | null> {
  const m = tag.match(/^(?:([a-z]{2,3}):)?(.+)$/i);
  if (!m) return null;
  const lang = (m[1] || 'en').toLowerCase();
  const title = m[2].replace(/_/g, ' ');
  const hit = await wikipediaSummaryPhoto(title, lang);
  return hit?.url ?? null;
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
  if (/tokyo|kyoto|osaka|seoul/.test(c)) return ['en', 'ja', 'ko'];
  if (/istanbul/.test(c)) return ['tr', 'en'];
  if (/athens/.test(c)) return ['el', 'en'];
  if (/prague/.test(c)) return ['cs', 'en'];
  if (/sydney/.test(c)) return ['en'];
  if (/marrakech|marrakesh/.test(c)) return ['fr', 'en'];
  return ['en'];
}

async function wikipediaMediaList(
  title: string,
  lang: string,
): Promise<ScoredPhoto[]> {
  const data = (await fetchJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
  )) as {
    items?: Array<{
      title?: string;
      type?: string;
      showInGallery?: boolean;
      original?: { source?: string; width?: number; height?: number };
      srcset?: Array<{ src?: string }>;
    }>;
  } | null;

  const scored: ScoredPhoto[] = [];
  for (const item of data?.items ?? []) {
    if (item.type && item.type !== 'image') continue;
    const titleHint = item.title ?? '';
    if (UGLY.test(titleHint)) continue;
    const url =
      item.original?.source ||
      item.srcset?.[item.srcset.length - 1]?.src ||
      item.srcset?.[0]?.src;
    if (!url) continue;
    let sizeBonus = 0;
    if (item.original?.width && item.original?.height) {
      const ratio = item.original.width / item.original.height;
      if (ratio >= 1.15 && ratio <= 2.4) sizeBonus += 0.15;
      if (item.original.width >= 1000) sizeBonus += 0.1;
    }
    // Gallery images from the article tend to be more varied than lead alone
    pushScored(
      scored,
      url,
      1.15 + sizeBonus + (item.showInGallery ? 0.1 : 0),
      'wiki',
      titleHint,
    );
  }
  return scored;
}

/** Exact-ish Wikipedia lead + article gallery images for variety. */
async function searchWikipediaLead(
  name: string,
  city?: string,
): Promise<ScoredPhoto[]> {
  const scored: ScoredPhoto[] = [];
  const core = searchName(name);
  const cityName = city ?? '';

  const titles = [
    /pantheon/i.test(core) && cityName ? 'Pantheon (Rome)' : '',
    /forum/i.test(core) && /rome|roma/i.test(cityName) ? 'Roman Forum' : '',
    /forum/i.test(core) && /rome|roma/i.test(cityName) ? 'Foro Romano' : '',
    /colosseum|colosseo/i.test(core) ? 'Colosseum' : '',
    /trevi/i.test(core) ? 'Trevi Fountain' : '',
    /st\.?\s*peter|san pietro|basilica/i.test(core) && /rome|roma|vatican/i.test(cityName)
      ? "St. Peter's Basilica"
      : '',
    /vatican/i.test(core) ? 'Vatican Museums' : '',
    cityName ? `${core} (${cityName})` : '',
    cityName ? `${core}, ${cityName}` : '',
    core,
  ].filter(Boolean);

  const langs = wikiLangsForCity(city).slice(0, 2);
  let resolvedTitle: { title: string; lang: string } | null = null;

  for (const lang of langs) {
    for (const title of titles) {
      const hit = await wikipediaSummaryPhoto(title, lang);
      if (!hit) continue;
      pushScored(scored, hit.url, 1.4, 'wiki', hit.title);
      resolvedTitle = { title: hit.title, lang };
      break;
    }
    if (resolvedTitle) break;
  }

  // Pull several distinct images from the article gallery (not just the lead)
  if (resolvedTitle) {
    scored.push(
      ...(await wikipediaMediaList(resolvedTitle.title, resolvedTitle.lang)),
    );
  }

  if (uniquePhotoCount(scored) < 4) {
    const lang = langs[0] ?? 'en';
    const data = await wikiApi(`${lang}.wikipedia.org`, {
      action: 'query',
      generator: 'search',
      gsrsearch: [core, cityName].filter(Boolean).join(' '),
      gsrlimit: '6',
      prop: 'pageimages|images',
      piprop: 'thumbnail|original',
      pithumbsize: '1200',
      imlimit: '8',
    });
    const pages = Object.values(
      (data?.query as {
        pages?: Record<
          string,
          {
            title?: string;
            thumbnail?: { source?: string };
            original?: { source?: string };
            images?: Array<{ title?: string }>;
          }
        >;
      })?.pages ?? {},
    );
    for (const page of pages) {
      const rel = Math.max(
        relevanceScore(page.title ?? '', name),
        relevanceScore(page.title ?? '', core),
      );
      if (rel < 0.45) continue;
      pushScored(
        scored,
        page.original?.source || page.thumbnail?.source,
        1.05 + rel,
        'wiki',
        page.title ?? '',
      );
      for (const img of page.images ?? []) {
        const file = img.title ?? '';
        if (!/^File:/i.test(file)) continue;
        if (UGLY.test(file)) continue;
        if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
        pushScored(scored, commonsFileUrl(file), 0.95 + rel * 0.3, 'wiki', file);
      }
    }
  }

  return scored;
}

async function searchCommonsByName(
  name: string,
  city?: string,
): Promise<ScoredPhoto[]> {
  const core = searchName(name);
  const queries = [
    [core, city].filter(Boolean).join(' '),
    `${core} exterior ${city ?? ''}`.trim(),
    `${core} interior ${city ?? ''}`.trim(),
    `${core} ${city ?? ''} daytime`.trim(),
    `${core} night ${city ?? ''}`.trim(),
    `${core} ${city ?? ''} panorama`.trim(),
  ].filter((q, i, arr) => q.length > 3 && arr.indexOf(q) === i);

  const scored: ScoredPhoto[] = [];

  for (const q of queries) {
    const data = await wikiApi('commons.wikimedia.org', {
      action: 'query',
      generator: 'search',
      gsrsearch: `${q} filetype:bitmap -svg`,
      gsrnamespace: '6',
      gsrlimit: '16',
      prop: 'imageinfo',
      iiprop: 'url|size|mime',
      iiurlwidth: '1200',
    });
    if (!data) continue;

    const pages = Object.values(
      (data.query as {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              width?: number;
              height?: number;
              mime?: string;
            }>;
          }
        >;
      })?.pages ?? {},
    );

    for (const page of pages) {
      const title = page.title ?? '';
      const rel = Math.max(relevanceScore(title, name), relevanceScore(title, core));
      if (rel < 0.45) continue;
      const info = page.imageinfo?.[0];
      if (info?.mime && !/^image\/(jpeg|png|webp)/i.test(info.mime)) continue;
      const url = info?.thumburl || info?.url;
      let sizeBonus = 0;
      if (info?.width && info?.height) {
        const ratio = info.width / info.height;
        if (ratio >= 1.15 && ratio <= 2.3) sizeBonus += 0.2;
        if (info.width >= 1200) sizeBonus += 0.1;
      }
      // Slight boost for query diversity keywords so interiors/exteriors compete
      const angleBonus = /\b(interior|exterior|night|view|plaza|square)\b/i.test(
        title,
      )
        ? 0.08
        : 0;
      pushScored(scored, url, 0.8 + rel + sizeBonus + angleBonus, 'commons', title);
    }
    if (uniquePhotoCount(scored) >= 6) break;
  }

  return scored;
}

async function searchCommonsNearby(
  lat: number,
  lon: number,
  name: string,
): Promise<ScoredPhoto[]> {
  const data = await wikiApi('commons.wikimedia.org', {
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lon}`,
    gsradius: '120',
    gslimit: '12',
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
    iiurlwidth: '1200',
  });
  if (!info) return [];

  const pages = (info.query as {
    pages?: Record<
      string,
      { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string }> }
    >;
  })?.pages;

  const scored: ScoredPhoto[] = [];
  for (const hit of hits) {
    const page = pages?.[String(hit.pageid)];
    const title = page?.title ?? hit.title;
    const nameScore = relevanceScore(title, name);
    // Only keep nearby shots that clearly relate to the place name
    if (nameScore < 0.45) continue;
    const url = page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url;
    const proximity = hit.dist <= 40 ? 0.2 : 0.05;
    pushScored(scored, url, 0.55 + nameScore + proximity, 'nearby', title);
  }
  return scored;
}

async function searchOpenverse(
  name: string,
  city?: string,
  category?: string,
): Promise<ScoredPhoto[]> {
  const q = [name, city, category].filter(Boolean).join(' ');
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', q);
  url.searchParams.set('page_size', '12');
  url.searchParams.set('mature', 'false');
  const data = (await fetchJson(url.toString(), {
    headers: { Accept: 'application/json' },
  })) as {
    results?: Array<{ title?: string; url?: string; thumbnail?: string }>;
  } | null;

  const scored: ScoredPhoto[] = [];
  for (const r of data?.results ?? []) {
    const title = r.title ?? '';
    const rel = relevanceScore(title, name);
    if (rel < 0.55) continue;
    pushScored(scored, r.url || r.thumbnail, 0.5 + rel, 'openverse', title);
  }
  return scored;
}

async function fromNominatim(
  name: string,
  city?: string,
): Promise<ScoredPhoto[]> {
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

  const scored: ScoredPhoto[] = [];
  for (const row of data) {
    if (relevanceScore(row.display_name ?? '', name) < 0.4) continue;
    const ex = row.extratags ?? {};
    if (ex.image?.startsWith('http')) {
      pushScored(scored, ex.image, 0.9, 'nominatim', row.display_name ?? '');
    }
    if (ex.wikidata) {
      pushScored(scored, await fromWikidata(ex.wikidata), 1.1, 'nominatim', ex.wikidata);
    }
    if (ex.wikipedia) {
      pushScored(
        scored,
        await fromWikipediaTag(ex.wikipedia),
        1.1,
        'nominatim',
        ex.wikipedia,
      );
    }
    if (ex.wikimedia_commons) {
      pushScored(
        scored,
        ex.wikimedia_commons.startsWith('http')
          ? ex.wikimedia_commons
          : commonsFileUrl(ex.wikimedia_commons),
        1.05,
        'nominatim',
        ex.wikimedia_commons,
      );
    }
  }
  return scored;
}

async function resolveKnownLinks(q: PlacePhotoQuery): Promise<ScoredPhoto[]> {
  const scored: ScoredPhoto[] = [];
  pushScored(scored, q.imageUrl, 1.3, 'known');
  if (q.commonsTag) {
    pushScored(
      scored,
      q.commonsTag.startsWith('http')
        ? q.commonsTag
        : commonsFileUrl(q.commonsTag),
      1.25,
      'known',
      q.commonsTag,
    );
  }
  const [wiki, wd] = await Promise.all([
    q.wikipediaTag ? fromWikipediaTag(q.wikipediaTag) : Promise.resolve(null),
    q.wikidataId ? fromWikidata(q.wikidataId) : Promise.resolve(null),
  ]);
  pushScored(scored, wiki, 1.2, 'known');
  pushScored(scored, wd, 1.2, 'known');
  return scored;
}

async function searchAll(q: PlacePhotoQuery): Promise<string[]> {
  const target = 6;
  const scored: ScoredPhoto[] = [...(await resolveKnownLinks(q))];

  // Wiki gallery first, then Commons angle searches for distinct shots
  scored.push(...(await searchWikipediaLead(q.name, q.city)));
  scored.push(...(await searchCommonsByName(q.name, q.city)));
  let result = finalizePhotos(scored, q.name, target);

  if (result.length < target) {
    const [nearby, openverse, nominatim] = await Promise.all([
      q.lat != null && q.lon != null
        ? searchCommonsNearby(q.lat, q.lon, q.name)
        : Promise.resolve([] as ScoredPhoto[]),
      searchOpenverse(searchName(q.name), q.city, q.category),
      fromNominatim(searchName(q.name), q.city),
    ]);
    scored.push(...nearby, ...openverse, ...nominatim);
    result = finalizePhotos(scored, q.name, target);
  }

  return result;
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
