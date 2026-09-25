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
}

export interface FoodPick { place: FoodPlace; reason: string }

const VERSION = 'food-v1';
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

function normalize(raw: any, source: FoodPlace['source'], index: number): FoodPlace | null {
  const lat = Number(raw.lat ?? raw.location?.lat ?? raw.center?.lat);
  const lon = Number(raw.lon ?? raw.location?.lon ?? raw.center?.lon);
  const name = String(raw.name ?? raw.tags?.name ?? '').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const category = /cafe|coffee/i.test(String(raw.category ?? raw.categories ?? raw.tags?.amenity)) ? 'cafe' : 'restaurant';
  return { id: `${source}:${raw.place_id ?? raw.id ?? `${lat},${lon},${index}`}`, name, lat, lon, category,
    cuisine: raw.cuisine ?? raw.tags?.cuisine, openingHours: raw.opening_hours ?? raw.tags?.opening_hours,
    website: raw.website ?? raw.tags?.website, source };
}

async function overpass(lat: number, lon: number): Promise<FoodPlace[]> {
  const q = `[out:json][timeout:20];(nwr[amenity~"^(cafe|restaurant)$"](around:1500,${lat},${lon}););out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q });
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
      const response = await fetch(url);
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

export async function getFoodSuggestions(args: { city: string; day: number; lat: number; lon: number; attractions: unknown[]; preferences: unknown }): Promise<FoodPick[]> {
  const cacheKey = key(args.city, args.day, args.lat, args.lon);
  const cached = readCache(cacheKey);
  if (cached) return cached;
  const places = await candidates(args.lat, args.lon);
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
