export interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
}

const CACHE_KEY = 'travel_planner_geocode_v1';
const LIST_CACHE_KEY = 'travel_planner_geocode_list_v1';
const USER_AGENT = 'TravelPlannerThesis/1.0 (thesis-project; contact@example.com)';

let lastRequestAt = 0;

function loadCache(): Record<string, GeocodeResult> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GeocodeResult>) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, GeocodeResult>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota errors */
  }
}

function loadListCache(): Record<string, GeocodeResult[]> {
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GeocodeResult[]>) : {};
  } catch {
    return {};
  }
}

function saveListCache(cache: Record<string, GeocodeResult[]>) {
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

async function rateLimit() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestAt = Date.now();
}

async function nominatimSearch(
  query: string,
  limit: number,
): Promise<{ results: GeocodeResult[]; latencyMs: number }> {
  const started = performance.now();
  await rateLimit();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));

  async function requestOnce(): Promise<Response> {
    return fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  }

  try {
    let response = await requestOnce();
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      await rateLimit();
      response = await requestOnce();
    }
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return { results: [], latencyMs };
    }
    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    const results = data.map((d) => ({
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display_name: d.display_name,
    }));
    return { results, latencyMs };
  } catch {
    return {
      results: [],
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export async function geocode(
  query: string,
): Promise<{ result: GeocodeResult | null; latencyMs: number }> {
  const key = query.trim().toLowerCase();
  const cache = loadCache();
  if (cache[key]) {
    return { result: cache[key], latencyMs: 0 };
  }

  const { results, latencyMs } = await nominatimSearch(query, 5);
  if (!results.length) return { result: null, latencyMs };

  const result = results[0];
  cache[key] = result;
  saveCache(cache);
  return { result, latencyMs };
}

/** Up to `limit` Nominatim hits for disambiguation (cached per query). */
export async function geocodeMany(
  query: string,
  limit = 3,
): Promise<{ results: GeocodeResult[]; latencyMs: number }> {
  const key = `${query.trim().toLowerCase()}|${limit}`;
  const listCache = loadListCache();
  if (listCache[key]?.length) {
    return { results: listCache[key], latencyMs: 0 };
  }

  const { results, latencyMs } = await nominatimSearch(query, limit);
  if (results.length) {
    listCache[key] = results;
    saveListCache(listCache);
    const single = loadCache();
    single[query.trim().toLowerCase()] = results[0];
    saveCache(single);
  }
  return { results, latencyMs };
}

export async function autocompletePlaces(
  query: string,
): Promise<GeocodeResult[]> {
  if (query.trim().length < 2) return [];
  const { results } = await nominatimSearch(query, 5);
  return results;
}
