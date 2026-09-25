import { geocode, geocodeMany } from './nominatim';
import { haversineKm } from './geo';
import { lookupCityCenter } from '../data/cityCenters';

/**
 * Coordinates for curated sights that ship without lat/lon, so photo lookup
 * can use its location steps. Geocoded once (Geoapify, then Nominatim),
 * biased to the sight's city, and cached in localStorage.
 */

type Point = { lat: number; lon: number };

const STORAGE_KEY = 'travel_planner_sight_coords_v1';
/** Results farther than this from the city center are a different place. */
const MAX_FROM_CITY_KM = 40;

const memory = new Map<string, Point | null>();
const pending = new Map<string, Promise<Point | null>>();

function loadStore(): Record<string, Point | null> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Point | null>;
  } catch {
    return {};
  }
}

function saveStore(key: string, value: Point | null) {
  try {
    const store = loadStore();
    store[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable */
  }
}

async function cityCenter(city: string): Promise<Point | null> {
  const known = lookupCityCenter(city);
  if (known) return known;
  return (await geocode(city)).result;
}

async function geoapify(text: string, bias: Point): Promise<Point[]> {
  const key = import.meta.env.VITE_GEOAPIFY_KEY?.trim();
  if (!key) return [];
  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.search = new URLSearchParams({
      text,
      lang: 'en',
      limit: '5',
      bias: `proximity:${bias.lon},${bias.lat}`,
      apiKey: key,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const data = (await response.json()) as { features?: { properties?: { lat?: number; lon?: number } }[] };
    return (data.features ?? [])
      .map((f) => ({ lat: Number(f.properties?.lat), lon: Number(f.properties?.lon) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch {
    return [];
  }
}

async function resolve(name: string, city: string): Promise<Point | null> {
  const center = await cityCenter(city);
  if (!center) return null;
  const near = (p: Point) => haversineKm(center.lat, center.lon, p.lat, p.lon) <= MAX_FROM_CITY_KM;
  const text = `${name}, ${city}`;
  const fromGeoapify = (await geoapify(text, center)).find(near);
  if (fromGeoapify) return fromGeoapify;
  const { results } = await geocodeMany(text, 5);
  const hit = results.find(near);
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

export function locateSight(name: string, city: string): Promise<Point | null> {
  const key = `${city}|${name}`.trim().toLowerCase();
  if (memory.has(key)) return Promise.resolve(memory.get(key)!);
  const stored = loadStore();
  if (key in stored) {
    memory.set(key, stored[key]);
    return Promise.resolve(stored[key]);
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const work = resolve(name, city)
    .catch(() => null)
    .then((point) => {
      memory.set(key, point);
      if (point) saveStore(key, point);
      return point;
    })
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
