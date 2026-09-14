export interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
  boundingbox?: string[];
  address?: Record<string, string>;
  type?: string;
  name?: string;
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
  options: Record<string, string> = {},
): Promise<{ results: GeocodeResult[]; latencyMs: number }> {
  const started = performance.now();
  await rateLimit();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('addressdetails', '1');
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value);

  async function requestOnce(): Promise<Response> {
    return fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
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
      boundingbox?: string[];
      address?: Record<string, string>;
      type?: string;
      name?: string;
    }>;
    const results = data.map((d) => ({
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display_name: d.display_name,
      boundingbox: d.boundingbox,
      address: d.address,
      type: d.type,
      name: d.name,
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

function normalizePlaceName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Official listings cover business names that are missing or outdated in OSM.
// Coordinates must still be resolved and checked against the destination.
const accommodationListings = [{
  city: 'Prague',
  aliases: ['Hotel Karlova Prague', 'Hotel Karlova'],
  name: 'Hotel Karlova Prague',
  street: 'Karlova',
  houseNumber: '13',
  address: 'Karlova 13, Prague 1',
  source: 'https://www.hotelkarlovaprague.com/en/contact/',
}];

/** Explicit search: match the requested stay/address, never just nearby hotels. */
export async function findAccommodation(query: string, city: string): Promise<GeocodeResult[]> {
  const destination = (await nominatimSearch(city, 1, { featuretype: 'city' })).results[0];
  if (!destination?.boundingbox) throw new Error('Destination lookup unavailable');
  const [south, north, west, east] = destination.boundingbox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) throw new Error('Invalid destination bounds');
  const options = { viewbox: `${west},${north},${east},${south}`, bounded: '1' };
  const withinDestination = (r: GeocodeResult) => Number.isFinite(r.lat) && Number.isFinite(r.lon) &&
    r.lat >= south && r.lat <= north && r.lon >= west && r.lon <= east;
  const cityWords = new Set(normalizePlaceName(city).split(' '));
  const nameWords = normalizePlaceName(query).split(' ').filter(w => !cityWords.has(w));
  const cleanedQuery = nameWords.join(' ');
  if (!cleanedQuery) return [];
  const stays = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'apartments', 'motel', 'chalet']);
  const isNumberedAddress = /\d/.test(cleanedQuery);
  const significantWords = nameWords.filter(w => !['hotel', 'hostel', 'guest', 'house', 'apartment', 'apartments', 'motel'].includes(w));
  const matchesQuery = (r: GeocodeResult) => {
    if (!withinDestination(r)) return false;
    if (isNumberedAddress) {
      const addressWords = normalizePlaceName(`${r.address?.road ?? ''} ${r.address?.house_number ?? ''}`).split(' ');
      return Boolean(r.address?.house_number) && nameWords.every(w => addressWords.includes(w));
    }
    const resultWords = normalizePlaceName(r.name ?? r.display_name.split(',')[0]).split(' ');
    return stays.has(r.type ?? '') && significantWords.length > 0 && significantWords.every(w => resultWords.includes(w));
  };
  const initial = await nominatimSearch(`${cleanedQuery}, ${city.trim()}`, 10, options);
  let matches = initial.results.filter(matchesQuery);
  if (!matches.length && !isNumberedAddress) {
    // A city already in the entered name must not be duplicated in the query.
    const alternative = await nominatimSearch(cleanedQuery, 10, options);
    matches = alternative.results.filter(matchesQuery);
  }
  if (matches.length) return matches;
  const listing = accommodationListings.find(l => normalizePlaceName(l.city) === normalizePlaceName(city) &&
    l.aliases.some(alias => normalizePlaceName(alias) === normalizePlaceName(query)));
  if (!listing) return [];
  const resolved = await nominatimSearch(listing.address, 5, options);
  return resolved.results.filter(r => withinDestination(r) &&
    normalizePlaceName(r.address?.road ?? '') === normalizePlaceName(listing.street) &&
    (r.address?.house_number ?? '').split('/').includes(listing.houseNumber))
    .map(r => ({ ...r, name: listing.name, display_name: `${listing.name}, ${r.display_name}` }));
}
