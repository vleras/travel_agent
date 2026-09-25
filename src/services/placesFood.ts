export interface FoodPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: 'cafe' | 'restaurant';
  cuisine?: string;
  openingHours?: string;
  website?: string;
  source: 'geoapify' | 'overpass';
  recommended?: boolean;
  wikiDescription?: string;
  price?: string;
  address?: string;
}

export interface FoodPick { place: FoodPlace; reason: string }

const VERSION = 'food-v3';
const memory = new Map<string, FoodPick[]>();

function key(city: string, day: number, lat: number, lon: number) {
  return `${VERSION}|${city}|${day}|${lat.toFixed(3)}|${lon.toFixed(3)}`.toLowerCase();
}

function readCache(k: string): FoodPick[] | null {
  if (memory.has(k)) return memory.get(k)!;
  try {
    const value = JSON.parse(localStorage.getItem(k) || 'null');
    if (Array.isArray(value)) { memory.set(k, value); return value; }
  } catch { /* storage unavailable */ }
  return null;
}

function writeCache(k: string, value: FoodPick[]) {
  memory.set(k, value);
  try { localStorage.setItem(k, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function addressOf(raw: any): string | undefined {
  const t = raw.tags ?? {};
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const osm = [street, t['addr:city']].filter(Boolean).join(', ');
  const line = raw.address_line2 ?? raw.formatted ?? osm;
  return line ? String(line).trim() || undefined : undefined;
}

function normalize(raw: any, source: FoodPlace['source'], index: number): FoodPlace | null {
  const lat = Number(raw.lat ?? raw.location?.lat ?? raw.center?.lat);
  const lon = Number(raw.lon ?? raw.location?.lon ?? raw.center?.lon);
  const name = String(raw.name ?? raw.tags?.name ?? '').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const category = /cafe|coffee/i.test(String(raw.category ?? raw.categories ?? raw.tags?.amenity)) ? 'cafe' : 'restaurant';
  return { id: `${source}:${raw.place_id ?? raw.id ?? `${lat},${lon},${index}`}`, name, lat, lon, category,
    cuisine: raw.cuisine ?? raw.tags?.cuisine, openingHours: raw.opening_hours ?? raw.tags?.opening_hours,
    website: raw.website ?? raw.tags?.website, address: addressOf(raw), source };
}

async function overpass(lat: number, lon: number): Promise<FoodPlace[]> {
  const q = `[out:json][timeout:20];(nwr[amenity~"^(cafe|restaurant)$"](around:1500,${lat},${lon}););out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error('Overpass request failed');
  const data = await response.json() as { elements?: any[] };
  return (data.elements ?? []).map((item, i) => normalize(item, 'overpass', i)).filter(Boolean) as FoodPlace[];
}

async function candidates(lat: number, lon: number): Promise<FoodPlace[]> {
  const apiKey = import.meta.env.VITE_GEOAPIFY_KEY?.trim();
  let places: FoodPlace[] = [];
  if (apiKey) {
    try {
      const url = new URL('https://api.geoapify.com/v2/places');
      url.searchParams.set('categories', 'catering.cafe,catering.restaurant');
      url.searchParams.set('filter', `circle:${lon},${lat},1500`);
      url.searchParams.set('limit', '20');
      url.searchParams.set('apiKey', apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const data = await response.json() as { features?: any[] };
        places = (data.features ?? []).map((f, i) => normalize({ ...f.properties, lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] }, 'geoapify', i)).filter(Boolean) as FoodPlace[];
      }
    } catch { /* fallback below */ }
  }
  if (places.length < 5) {
    try { places = [...places, ...(await overpass(lat, lon))]; } catch { /* graceful empty result */ }
  }
  return Array.from(new Map(places.map((p) => [p.id, p])).values()).slice(0, 20);
}

interface WikiListing { name: string; lat?: number; lon?: number; price?: string; description?: string }

async function wikivoyageListings(city: string): Promise<WikiListing[]> {
  try {
    const url = new URL('https://en.wikivoyage.org/w/api.php');
    url.search = new URLSearchParams({ action: 'parse', page: city, prop: 'wikitext', format: 'json', origin: '*' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return [];
    const data = await response.json() as { parse?: { wikitext?: { '*': string } } };
    const text = data.parse?.wikitext?.['*'] ?? '';
    const sections = text.match(/={2,3}\s*(?:Eat|Drink)\s*={2,3}([\s\S]*?)(?=\n={2,3}[^=]|$)/i)?.[1] ?? '';
    const results: WikiListing[] = [];
    for (const match of sections.matchAll(/\{\{\s*(?:eat|drink|listing)\s*\|([\s\S]*?)\}\}/gi)) {
      const fields: Record<string, string> = {};
      for (const part of match[1].split('|')) {
        const at = part.indexOf('=');
        if (at > 0) fields[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
      }
      const name = (fields.name || fields.alt || fields.address || '').replace(/''+/g, '').trim();
      if (name) results.push({ name, lat: Number(fields.lat), lon: Number(fields.long || fields.lon), price: fields.price, description: fields.content || fields.description });
    }
    return results;
  } catch { return []; }
}

function enrichWithWikivoyage(places: FoodPlace[], listings: WikiListing[]): FoodPlace[] {
  const tokenise = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean);
  return places.map(place => {
    const placeTokens = new Set(tokenise(place.name));
    const match = listings.find(listing => {
      const listingTokens = tokenise(listing.name);
      const overlap = listingTokens.filter(token => placeTokens.has(token)).length;
      const nameMatch = overlap >= Math.min(2, listingTokens.length) || place.name.toLowerCase().includes(listing.name.toLowerCase()) || listing.name.toLowerCase().includes(place.name.toLowerCase());
      const distanceMatch = Number.isFinite(listing.lat) && Number.isFinite(listing.lon) ? Math.hypot((place.lat - listing.lat!) * 111, (place.lon - listing.lon!) * 75) < 1.5 : false;
      return nameMatch || distanceMatch;
    });
    return match ? { ...place, recommended: true, wikiDescription: match.description, price: match.price } : place;
  });
}

const browseCache = new Map<string, FoodPlace[]>();
const browsePending = new Map<string, Promise<FoodPlace[]>>();

async function cityCoordinates(city: string): Promise<{ lat: number; lon: number } | null> {
  const key = import.meta.env.VITE_GEOAPIFY_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.search = new URLSearchParams({ text: city, lang: 'en', limit: '1', apiKey: key }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json() as { features?: { properties?: { lat?: number; lon?: number } }[] };
    const point = data.features?.[0]?.properties;
    return point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? { lat: Number(point.lat), lon: Number(point.lon) } : null;
  } catch { return null; }
}

export async function getNearbyFoodPlacesForCity(city: string, fallback?: { lat: number; lon: number }): Promise<FoodPlace[]> {
  const point = await cityCoordinates(city) ?? fallback;
  return point ? getNearbyFoodPlaces(point.lat, point.lon) : [];
}

/** Browse real places directly, without requiring an AI selection. */
export function getNearbyFoodPlaces(lat: number, lon: number): Promise<FoodPlace[]> {
  const key = `food-browse-v1|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  if (browseCache.has(key)) return Promise.resolve(browseCache.get(key)!);
  if (browsePending.has(key)) return browsePending.get(key)!;
  const request = candidates(lat, lon).then(places => {
    if (places.length) browseCache.set(key, places);
    return places;
  }).finally(() => browsePending.delete(key));
  browsePending.set(key, request);
  return request;
}

export async function getFoodSuggestions(args: { city: string; day: number; lat: number; lon: number; attractions: unknown[]; preferences: unknown }): Promise<FoodPick[]> {
  const cacheKey = key(args.city, args.day, args.lat, args.lon);
  const cached = readCache(cacheKey);
  if (cached) return cached;
  const listings = await wikivoyageListings(args.city);
  const places = enrichWithWikivoyage(await candidates(args.lat, args.lon), listings);
  console.info('[Food]', { day: args.day, candidateCount: places.length, wikivoyageListingCount: listings.length, wikivoyageMatchCount: places.filter(p => p.recommended).length });
  if (!places.length) return [];
  try {
    const response = await fetch('/api/deepseek/food', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: args.city, day: args.day, attractions: args.attractions, preferences: args.preferences, candidates: places }) });
    if (response.ok) {
      const data = await response.json() as { picks?: { id?: string; reason?: string }[] };
      const byId = new Map(places.map((p) => [p.id, p]));
      let cafeCount = 0;
      let restaurantCount = 0;
      const picks = (data.picks ?? []).filter((p) => p.id && byId.has(p.id)).map((p) => ({ place: byId.get(p.id!)!, reason: String(p.reason || 'A convenient nearby option.') })).filter(({ place }) => {
        if (place.category === 'cafe') { if (cafeCount >= 1) return false; cafeCount += 1; return true; }
        if (restaurantCount >= 2) return false;
        restaurantCount += 1;
        return true;
      });
      writeCache(cacheKey, picks);
      return picks;
    }
  } catch { /* return no suggestions */ }
  return [];
}
