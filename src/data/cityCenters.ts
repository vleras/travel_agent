import { fallbackAttractions } from './fallbackAttractions';
import type { GeocodeResult } from '../services/nominatim';

/** Hardcoded centers for curated destinations when Nominatim is rate-limited. */
const CITY_CENTERS: Record<string, GeocodeResult> = {
  rome: { lat: 41.9028, lon: 12.4964, display_name: 'Rome, Italy' },
  tokyo: { lat: 35.6762, lon: 139.6503, display_name: 'Tokyo, Japan' },
  barcelona: { lat: 41.3874, lon: 2.1686, display_name: 'Barcelona, Spain' },
  bangkok: { lat: 13.7563, lon: 100.5018, display_name: 'Bangkok, Thailand' },
  paris: { lat: 48.8566, lon: 2.3522, display_name: 'Paris, France' },
  lisbon: { lat: 38.7223, lon: -9.1393, display_name: 'Lisbon, Portugal' },
  amsterdam: { lat: 52.3676, lon: 4.9041, display_name: 'Amsterdam, Netherlands' },
  london: { lat: 51.5074, lon: -0.1278, display_name: 'London, United Kingdom' },
  'new york': { lat: 40.7128, lon: -74.006, display_name: 'New York, USA' },
  istanbul: { lat: 41.0082, lon: 28.9784, display_name: 'Istanbul, Türkiye' },
  prague: { lat: 50.0755, lon: 14.4378, display_name: 'Prague, Czechia' },
  athens: { lat: 37.9838, lon: 23.7275, display_name: 'Athens, Greece' },
  marrakech: { lat: 31.6295, lon: -7.9811, display_name: 'Marrakech, Morocco' },
  sydney: { lat: -33.8688, lon: 151.2093, display_name: 'Sydney, Australia' },
  seoul: { lat: 37.5665, lon: 126.978, display_name: 'Seoul, South Korea' },
};

function cityKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Average coords from curated attractions when we know the city. */
function centerFromFallbacks(city: string): GeocodeResult | null {
  const key = cityKey(city);
  const list = fallbackAttractions[key];
  if (!list?.length) return null;
  const withCoords = list.filter(
    (a) => typeof a.lat === 'number' && typeof a.lon === 'number',
  );
  if (!withCoords.length) return null;
  const lat =
    withCoords.reduce((s, a) => s + (a.lat as number), 0) / withCoords.length;
  const lon =
    withCoords.reduce((s, a) => s + (a.lon as number), 0) / withCoords.length;
  return {
    lat,
    lon,
    display_name: `${city} (approx. from curated places)`,
  };
}

/**
 * Offline-safe city center for clustering when live geocoding fails
 * (Nominatim 429 / network).
 */
export function lookupCityCenter(city: string): GeocodeResult | null {
  const key = cityKey(city);
  if (CITY_CENTERS[key]) return CITY_CENTERS[key];
  // “Tokyo, Japan” style
  const first = key.split(',')[0]?.trim();
  if (first && CITY_CENTERS[first]) return CITY_CENTERS[first];
  return centerFromFallbacks(first || city);
}
