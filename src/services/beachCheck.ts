import { geocode } from './nominatim';

/** Quick allowlist for common coastal destinations (avoids waiting on Overpass). */
const KNOWN_BEACH_CITIES = new Set([
  'barcelona',
  'nice',
  'cannes',
  'miami',
  'sydney',
  'rio de janeiro',
  'lisbon',
  'porto',
  'valencia',
  'malaga',
  'athens',
  'santorini',
  'mykonos',
  'dubai',
  'tel aviv',
  'los angeles',
  'san diego',
  'honolulu',
  'cancun',
  'phuket',
  'bali',
  'singapore',
  'hong kong',
  'busan',
  'cape town',
  'marseille',
  'genoa',
  'naples',
  'amalfi',
  'positano',
  'split',
  'dubrovnik',
  'istanbul',
]);

const KNOWN_NO_BEACH_CITIES = new Set([
  'rome',
  'paris',
  'tokyo',
  'bangkok',
  'london',
  'berlin',
  'madrid',
  'vienna',
  'prague',
  'budapest',
  'munich',
  'milan',
  'florence',
  'seoul',
  'beijing',
  'delhi',
  'moscow',
  'zurich',
  'geneva',
]);

const cache = new Map<string, boolean>();

function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}

async function overpassHasBeach(lat: number, lon: number): Promise<boolean> {
  // ~40km search — coastal cities with beaches a bit outside center still count
  const query = `
[out:json][timeout:15];
(
  node["natural"="beach"](around:40000,${lat},${lon});
  way["natural"="beach"](around:40000,${lat},${lon});
  node["leisure"="beach_resort"](around:40000,${lat},${lon});
);
out ids 5;
`.trim();

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { elements?: unknown[] };
  return (data.elements?.length ?? 0) > 0;
}

/**
 * Returns whether the destination has a real beach / coastline nearby.
 * Used to avoid offering "Beach" as an interest for inland cities.
 */
export async function cityHasBeach(city: string): Promise<boolean> {
  const key = normalizeCity(city);
  if (!key) return false;
  if (cache.has(key)) return cache.get(key)!;

  for (const known of KNOWN_BEACH_CITIES) {
    if (key.includes(known) || known.includes(key)) {
      cache.set(key, true);
      return true;
    }
  }
  for (const known of KNOWN_NO_BEACH_CITIES) {
    if (key === known || key.startsWith(`${known},`) || key.startsWith(`${known} `)) {
      cache.set(key, false);
      return false;
    }
  }

  try {
    const { result } = await geocode(city);
    if (!result) {
      cache.set(key, false);
      return false;
    }
    const has = await overpassHasBeach(result.lat, result.lon);
    cache.set(key, has);
    return has;
  } catch {
    cache.set(key, false);
    return false;
  }
}
