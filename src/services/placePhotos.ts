/**
 * Multi-source place photos (browser-safe).
 * Cascade: Unsplash → Wikimedia Commons (fill) → geo/Openverse/Nominatim.
 * Unsplash prefers time-of-day travel queries + engagement + photographer signals.
 * Results are cached per place; Unsplash fails silently when unavailable.
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
  source:
    | 'known'
    | 'unsplash'
    | 'wiki'
    | 'commons'
    | 'nearby'
    | 'openverse'
    | 'nominatim';
  titleHint: string;
}

const resultCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();
/** Avoid showing the same Commons file on two different places in one session. */
const claimedFingerprints = new Map<string, string>();

function cacheKey(q: PlacePhotoQuery): string {
  return [
    'v11',
    q.name,
    q.city ?? '',
    q.category ?? '',
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
  /\b(map|logo|icon|flag|seal|coa|coat[_ ]of[_ ]arms|diagram|svg|plan|blueprint|sign|poster|sticker|qr[_ ]?code|screenshot|crop|detail_of|cropped|watermark|stamp)\b/i;
const PRETTY =
  /\b(sunset|sunrise|dusk|dawn|golden|panorama|skyline|aerial|drone|night|illuminat|view|vista|exterior|facade|façade|harbour|harbor|bridge|plaza|square|garden|temple|palace|cathedral|fountain|beach|coast|scenic|landscape|interior)\b/i;
const ARCHIVAL_BW =
  /\b(black[\s_-]?and[\s_-]?white|b[&\s_-]?w|monochrome|greyscale|grayscale|archival|historical|historic photo|old photo|postcard|vintage|sepia|film grain|scan|engraving|etching|drawing|illustration|sketch|painting|oil on|watercolor|lithograph|antique|retro|1950|1960|1970|1980|1990|early 20th|19th century)\b/i;
const FRESH_LOOK =
  /\b(sunset|sunrise|golden hour|blue hour|vibrant|scenic|travel|modern|aerial|drone|beautiful|stunning|colorful|sunny|blue sky|clear day)\b/i;

function isDullUnsplashColor(color?: string): boolean {
  if (!color || !/^#?[0-9a-f]{3,8}$/i.test(color.trim())) return false;
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  if (full.length < 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Near-gray or muddy dark tones read as “old”
  if (sat < 0.12 && lum > 0.15 && lum < 0.85) return true;
  if (lum < 0.12) return true;
  return false;
}

function yearsSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
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

function unsplashQueryPair(
  name: string,
  kind: PlaceKind,
  city?: string,
): string[] {
  const n = searchName(name);
  const cityBit = city?.trim() ?? '';
  // Prefer place + time/mood over generic "landmark vibrant" modifiers
  const placeQ = (suffix: string) => {
    const base = `${n} ${suffix}`.trim();
    return cityBit ? [base, `${base} ${cityBit}`] : [base];
  };

  switch (kind) {
    case 'restaurant':
      return [
        ...placeQ('interior warm lighting'),
        ...placeQ('cozy'),
        ...placeQ('evening ambiance'),
        ...placeQ('restaurant interior'),
      ];
    case 'street':
      return [
        ...placeQ('street photography'),
        ...placeQ('people'),
        ...placeQ('daytime life'),
        ...placeQ('evening'),
      ];
    case 'museum':
      return [
        ...placeQ('interior'),
        ...placeQ('gallery'),
        ...placeQ('daytime'),
        ...placeQ('exhibits'),
      ];
    case 'park':
      return [
        ...placeQ('golden hour'),
        ...placeQ('sunset'),
        ...placeQ('daytime landscape'),
        ...placeQ('scenic'),
      ];
    default:
      // Landmarks: time-of-day travel shots beat "landmark vibrant"
      return [
        ...placeQ('sunset'),
        ...placeQ('golden hour'),
        ...placeQ('blue hour'),
        ...placeQ('daytime landscape'),
      ];
  }
}

/** Serious photographer signal — portfolio or Instagram on Unsplash profile. */
function hasPhotographerReputation(user?: {
  portfolio_url?: string | null;
  instagram_username?: string | null;
  social?: { instagram_username?: string | null };
}): boolean {
  const portfolio = user?.portfolio_url?.trim();
  const ig =
    user?.social?.instagram_username?.trim() ||
    user?.instagram_username?.trim();
  return Boolean(portfolio) || Boolean(ig);
}

/** Keep if well-liked OR strong engagement ratio when views are present. */
function passesUnsplashEngagement(likes: number, views?: number): boolean {
  if (likes > 150) return true;
  if (typeof views === 'number' && views > 0 && likes / views > 0.04) {
    return true;
  }
  return false;
}

function isStockGenericPhotographer(bio?: string | null, name?: string | null): boolean {
  const hay = `${bio ?? ''} ${name ?? ''}`.toLowerCase();
  return /\b(stock|generic|shutterstock|getty|alamy|royalty[\s-]?free|clipart|placeholder)\b/.test(
    hay,
  );
}

/** Higher = more aesthetically appealing by Unsplash signals. */
function unsplashAppealScore(photo: {
  likes?: number;
  downloads?: number;
  views?: number;
  created_at?: string;
  width?: number;
  height?: number;
}): number {
  const likes = photo.likes ?? 0;
  const downloads = Math.max(photo.downloads ?? 1, 1);
  const views = photo.views;
  const age = yearsSince(photo.created_at);

  // Likes primary; views/downloads rewards “looks good” over pure utility downloads
  let score = likes * 3;
  if (typeof views === 'number' && views > 0) {
    score += Math.min(views / downloads, 40) * 4;
  } else {
    // Soft proxy when views missing from search payload
    score += Math.min(likes / downloads, 5) * 8;
  }

  if (age != null) {
    if (age <= 2) score += 120;
    else if (age <= 4) score += 40;
    else score -= age * 8;
  }

  const w = photo.width ?? 0;
  const h = photo.height ?? 0;
  if (h > 0 && w / h > 1.3) score += 25;
  if (w >= 1600) score += 15;

  return score;
}

/**
 * Unsplash search — optional Access Key via VITE_UNSPLASH_ACCESS_KEY.
 * Ranks by likes / aesthetic signals and prefers fresh landscape travel shots.
 */
async function searchUnsplash(
  name: string,
  category?: string,
  city?: string,
  limit = 10,
): Promise<ScoredPhoto[]> {
  const accessKey =
    (import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined)?.trim() ||
    '';
  const kind = detectPlaceKind(name, category);
  const queries = [...new Set(unsplashQueryPair(name, kind, city))].filter(
    Boolean,
  );
  const scored: ScoredPhoto[] = [];
  const seenUserDims = new Set<string>();
  const seenUrls = new Set<string>();

  for (const query of queries) {
    if (uniquePhotoCount(scored) >= limit) break;

    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', '20');
    url.searchParams.set('order_by', 'relevant');
    url.searchParams.set('orientation', 'landscape');
    url.searchParams.set('content_filter', 'high');
    if (accessKey) url.searchParams.set('client_id', accessKey);

    const headers: HeadersInit = { 'Accept-Version': 'v1' };
    if (accessKey) {
      headers.Authorization = `Client-ID ${accessKey}`;
    }

    const data = (await fetchJson(url.toString(), { headers }, 5500)) as {
      results?: Array<{
        urls?: { regular?: string; small?: string };
        downloads?: number;
        likes?: number;
        views?: number;
        width?: number;
        height?: number;
        color?: string;
        created_at?: string;
        description?: string | null;
        alt_description?: string | null;
        user?: {
          id?: string;
          username?: string;
          name?: string;
          bio?: string | null;
          portfolio_url?: string | null;
          instagram_username?: string | null;
          social?: { instagram_username?: string | null };
        };
      }>;
    } | null;

    if (!data?.results?.length) continue;

    const ranked = [...data.results].sort(
      (a, b) => unsplashAppealScore(b) - unsplashAppealScore(a),
    );

    for (const photo of ranked) {
      if (uniquePhotoCount(scored) >= limit) break;
      const photoUrl = photo.urls?.regular || photo.urls?.small;
      if (!photoUrl || seenUrls.has(photoUrl)) continue;

      const width = photo.width ?? 0;
      const height = photo.height ?? 0;
      if (width > 0 && width < 1000) continue;
      // Travel photos trend wider
      if (height > 0 && width / height <= 1.3) continue;

      const likes = photo.likes ?? 0;
      if (!passesUnsplashEngagement(likes, photo.views)) continue;

      if (!hasPhotographerReputation(photo.user)) continue;

      const ageYears = yearsSince(photo.created_at);
      // Older popular shots are often generic — soft-cap hard filter at 6y
      if (ageYears != null && ageYears > 6) continue;

      if (isDullUnsplashColor(photo.color)) continue;
      if (isStockGenericPhotographer(photo.user?.bio, photo.user?.name)) {
        continue;
      }

      const hint = `${photo.alt_description ?? ''} ${photo.description ?? ''}`;
      if (ARCHIVAL_BW.test(hint) || UGLY.test(hint)) continue;

      const userId = photo.user?.id || photo.user?.username || 'anon';
      const userDimKey = `${userId}:${width}x${height}`;
      if (seenUserDims.has(userDimKey)) continue;
      seenUserDims.add(userDimKey);
      seenUrls.add(photoUrl);

      const appeal =
        1.55 + Math.min(unsplashAppealScore(photo) / 400, 0.9);
      pushScored(scored, photoUrl, appeal, 'unsplash', hint.trim() || query);
    }
  }

  return scored;
}

function beautyBonus(titleOrUrl: string): number {
  let score = 0;
  if (PRETTY.test(titleOrUrl) || FRESH_LOOK.test(titleOrUrl)) score += 0.4;
  if (UGLY.test(titleOrUrl) || ARCHIVAL_BW.test(titleOrUrl)) score -= 1.1;
  if (/\.svg(\?|$)/i.test(titleOrUrl)) score -= 1.2;
  // Slight penalty for generic Commons dumps vs Unsplash travel shots
  if (/upload\.wikimedia\.org/i.test(titleOrUrl)) score -= 0.05;
  if (/images\.unsplash\.com/i.test(titleOrUrl)) score += 0.2;
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

const TARGET_PLACE_PHOTOS = 10;

function finalizePhotos(
  scored: ScoredPhoto[],
  placeName: string,
  limit = TARGET_PLACE_PHOTOS,
): string[] {
  scored.sort((a, b) => b.score - a.score);

  const placeKey = placeName.toLowerCase();
  const out: ScoredPhoto[] = [];
  const seen = new Set<string>();
  const usedScenes = new Map<string, number>();

  const ranked = [
    ...scored.filter(
      (s) => s.source === 'unsplash' || s.source === 'known',
    ),
    ...scored.filter((s) => s.source === 'wiki'),
    ...scored.filter(
      (s) => s.source === 'commons' || s.source === 'nominatim',
    ),
    ...scored.filter((s) => s.source === 'nearby' || s.source === 'openverse'),
  ];

  for (const item of ranked) {
    if (item.score < 0.45) continue;
    if (ARCHIVAL_BW.test(item.titleHint) || ARCHIVAL_BW.test(item.url)) {
      continue;
    }

    const curatedCount = out.filter((u) =>
      /wikimedia\.org|wikipedia\.org|commons\.wikimedia|images\.unsplash\.com/i.test(
        u.url,
      ),
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
    // Allow a couple per scene so we can still reach ~10 varied shots
    const sceneCount = usedScenes.get(primary) ?? 0;
    if (primary !== 'general' && sceneCount >= 2) continue;

    seen.add(fp);
    claimedFingerprints.set(fp, placeKey);
    if (primary !== 'general') usedScenes.set(primary, sceneCount + 1);
    out.push(item);
    if (out.length >= limit) break;
  }

  // Fill remaining slots if diversity rules left us short of ~10
  if (out.length < limit) {
    for (const item of ranked) {
      if (out.length >= limit) break;
      const fp = imageFingerprint(item.url);
      if (seen.has(fp)) continue;
      if (item.score < 0.4) continue;
      const owner = claimedFingerprints.get(fp);
      if (owner && owner !== placeKey) continue;
      if (
        out.some(
          (picked) =>
            titleTokenOverlap(
              `${picked.titleHint} ${picked.url}`,
              `${item.titleHint} ${item.url}`,
            ) >= 0.75,
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

function commonsUploadAgeYears(ext?: Record<string, { value?: string }>): number | null {
  const raw =
    ext?.DateTimeOriginal?.value ||
    ext?.DateTime?.value ||
    ext?.DateTimeMetadata?.value ||
    '';
  if (!raw) return null;
  // Commons often uses "YYYY-MM-DD HH:MM:SS" or "YYYY"
  const isoish = raw.match(/(\d{4})(?:[-:/](\d{2}))?(?:[-:/](\d{2}))?/);
  if (!isoish) return null;
  const year = Number(isoish[1]);
  const month = Number(isoish[2] ?? '6');
  const day = Number(isoish[3] ?? '15');
  if (year < 1990 || year > new Date().getFullYear() + 1) return null;
  const t = Date.UTC(year, Math.max(0, month - 1), Math.max(1, day));
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}

function scoreCommonsCandidate(opts: {
  title: string;
  rel: number;
  width?: number;
  height?: number;
  ageYears?: number | null;
}): number {
  const { title, rel, width = 0, height = 0, ageYears } = opts;
  let score = 0.55 + rel;

  if (ARCHIVAL_BW.test(title) || UGLY.test(title)) return -1;
  if (height > 0) {
    const ratio = width / height;
    if (ratio > 1.3) score += 0.25;
    else if (ratio < 1.05) score -= 0.25;
  }
  if (width >= 2000) score += 0.25;
  else if (width >= 1400) score += 0.15;
  else if (width < 900) score -= 0.2;

  if (ageYears != null) {
    if (ageYears <= 3) score += 0.3;
    else if (ageYears <= 7) score += 0.1;
    else if (ageYears > 15) score -= 0.35;
    else score -= 0.1;
  }

  if (/\b(scenic|view|panorama|sunset|sunrise|vibrant|daytime)\b/i.test(title)) {
    score += 0.12;
  }
  return score;
}

async function searchCommonsByName(
  name: string,
  city?: string,
): Promise<ScoredPhoto[]> {
  const core = searchName(name);
  const queries = [
    [core, city].filter(Boolean).join(' '),
    `${core} exterior ${city ?? ''}`.trim(),
    `${core} scenic ${city ?? ''}`.trim(),
    `${core} ${city ?? ''} daytime`.trim(),
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
      iiprop: 'url|size|mime|extmetadata',
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
              extmetadata?: Record<string, { value?: string }>;
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
      const ageYears = commonsUploadAgeYears(info?.extmetadata);
      const score = scoreCommonsCandidate({
        title,
        rel,
        width: info?.width,
        height: info?.height,
        ageYears,
      });
      if (score < 0.5) continue;
      pushScored(scored, url, score, 'commons', title);
    }
    if (uniquePhotoCount(scored) >= 10) break;
  }

  return scored;
}

/** Commons fill-in: scenic / view angles when still short of photos. */
async function searchCommonsScenic(
  name: string,
  city?: string,
): Promise<ScoredPhoto[]> {
  const core = searchName(name);
  const queries = [
    `${core} scenic ${city ?? ''}`.trim(),
    `${core} view ${city ?? ''}`.trim(),
    `${core} ${city ?? ''}`.trim(),
  ].filter((q, i, arr) => q.length > 3 && arr.indexOf(q) === i);

  const scored: ScoredPhoto[] = [];

  for (const q of queries) {
    const data = await wikiApi('commons.wikimedia.org', {
      action: 'query',
      generator: 'search',
      gsrsearch: `${q} filetype:bitmap -svg`,
      gsrnamespace: '6',
      gsrlimit: '12',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
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
              extmetadata?: Record<string, { value?: string }>;
            }>;
          }
        >;
      })?.pages ?? {},
    );

    for (const page of pages) {
      const title = page.title ?? '';
      if (ARCHIVAL_BW.test(title) || UGLY.test(title)) continue;
      const rel = Math.max(
        relevanceScore(title, name),
        relevanceScore(title, core),
      );
      if (rel < 0.4) continue;
      const info = page.imageinfo?.[0];
      if (info?.mime && !/^image\/(jpeg|png|webp)/i.test(info.mime)) continue;
      const url = info?.thumburl || info?.url;
      const ageYears = commonsUploadAgeYears(info?.extmetadata);
      const score = scoreCommonsCandidate({
        title,
        rel,
        width: info?.width,
        height: info?.height,
        ageYears,
      });
      if (score < 0.5) continue;
      pushScored(scored, url, score, 'commons', title);
    }
    if (uniquePhotoCount(scored) >= 10) break;
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
  const target = TARGET_PLACE_PHOTOS;
  const scored: ScoredPhoto[] = [...(await resolveKnownLinks(q))];

  // Pull a full Unsplash set up front (~10 keepers after filters)
  scored.push(
    ...(await searchUnsplash(q.name, q.category, q.city, target + 5)),
  );
  let result = finalizePhotos(scored, q.name, target);

  // Wikimedia Commons scenic/view fill — not Wikipedia article dumps
  if (result.length < target) {
    scored.push(...(await searchCommonsScenic(q.name, q.city)));
    if (uniquePhotoCount(scored) < target) {
      scored.push(...(await searchCommonsByName(q.name, q.city)));
    }
    result = finalizePhotos(scored, q.name, target);
  }

  // Last resort geo / open catalog if still sparse
  if (result.length < Math.min(6, target)) {
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

  // Drop leftover Wikipedia hosts if we already have Unsplash/Commons picks
  const unsplashOrCommons = result.filter(
    (u) =>
      /images\.unsplash\.com|unsplash\.com|commons\.wikimedia|upload\.wikimedia/i.test(
        u,
      ) && !/\/wikipedia\//i.test(u),
  );
  if (unsplashOrCommons.length >= 4) {
    return unsplashOrCommons.slice(0, target);
  }

  return result.slice(0, target);
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
