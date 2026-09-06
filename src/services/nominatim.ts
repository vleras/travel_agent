export interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
}

const CACHE_KEY = 'travel_planner_geocode_v1';
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

async function rateLimit() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestAt = Date.now();
}

export async function geocode(
  query: string,
): Promise<{ result: GeocodeResult | null; latencyMs: number }> {
  const key = query.trim().toLowerCase();
  const cache = loadCache();
  if (cache[key]) {
    return { result: cache[key], latencyMs: 0 };
  }

  const started = performance.now();
  await rateLimit();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return { result: null, latencyMs };
    }
    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    if (!data.length) return { result: null, latencyMs };

    const result: GeocodeResult = {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display_name: data[0].display_name,
    };
    cache[key] = result;
    saveCache(cache);
    return { result, latencyMs };
  } catch {
    return { result: null, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function autocompletePlaces(
  query: string,
): Promise<GeocodeResult[]> {
  if (query.trim().length < 2) return [];
  await rateLimit();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('featuretype', 'city');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    return data.map((d) => ({
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display_name: d.display_name,
    }));
  } catch {
    return [];
  }
}
