import { geocodeMany, type GeocodeResult } from './nominatim';
import { haversineKm } from './geo';
import { locatePlaces } from './sightLocation';

export interface HotelMatch extends GeocodeResult { approximate: boolean }
const cache = new Map<string, HotelMatch[]>();
const pending = new Map<string, Promise<HotelMatch[]>>();

export function normalizeHotelInput(input: string): string {
  const countries: Record<string, string> = { greqi: 'Greece', italia: 'Italy', deutschland: 'Germany', shqipëri: 'Albania', shqiperi: 'Albania', hellas: 'Greece', ellada: 'Greece' };
  return input.trim().replace(/\s+/g, ' ').replace(/\p{L}+/gu, word => countries[word.toLowerCase()] ?? word);
}

export function hotelQueries(input: string, city: string): string[] {
  const full = normalizeHotelInput(input);
  const stripped = full.replace(/\b\d{3}\s?\d{2}\b|\b\d{4,6}\b/g, '').replace(/\s+/g, ' ').trim();
  const parts = stripped.split(',').map(p => p.trim()).filter(Boolean);
  const street = stripped.match(/\b(?:street|road|avenue|rruga|rrugë|via|viale|ulice|straat|strasse)\b.*|\b[^,]+\s(?:street|road|avenue|straße)\b[^,]*/i)?.[0];
  const withCity = (s: string) => [s, city].filter(Boolean).join(', ');
  return [...new Set([full, stripped, withCity(parts[0] ?? ''), withCity(street ?? parts[1] ?? ''), city].filter(Boolean))];
}

async function geoapify(text: string): Promise<HotelMatch[]> {
  const key = import.meta.env.VITE_GEOAPIFY_KEY?.trim();
  if (!key) return [];
  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.search = new URLSearchParams({ text, lang: 'en', limit: '5', apiKey: key }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.features ?? []).map(({ properties: p }: { properties: Record<string, string | number> }) => ({
      lat: Number(p.lat), lon: Number(p.lon), display_name: String(p.formatted ?? p.name ?? text),
      name: String(p.name ?? p.address_line1 ?? text), type: String(p.result_type ?? ''),
      approximate: !['amenity', 'building'].includes(String(p.result_type)),
    }));
  } catch { return []; }
}

export function geocodeHotel(input: string, destination = ''): Promise<HotelMatch[]> {
  const text = normalizeHotelInput(input);
  const city = normalizeHotelInput(destination);
  const key = `hotel-v2|${city.toLowerCase()}|${text.toLowerCase()}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (pending.has(key)) return pending.get(key)!;
  let center: GeocodeResult | undefined;
  let fromLocator = false;
  const work = (async () => {
    if (city) {
      center = (await geoapify(city))[0];
      if (!center) center = (await geocodeMany(city, 1)).results[0];
      // Never accept an unverified distance when the destination is known.
      if (!center) return [];
    }
    const valid = (matches: HotelMatch[]) => matches.filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180 && (!center || haversineKm(center.lat, center.lon, m.lat, m.lon) <= 50));
    // Named accommodation first: shared locator (Photon → Geoapify → Nominatim).
    if (city) {
      // "Hotel X, Rruga Y 12": search the name, use the rest as a bias hint.
      const comma = text.indexOf(',');
      const hotelName = comma > 0 ? text.slice(0, comma).trim() : text;
      const hint = comma > 0 ? text.slice(comma + 1).trim() : undefined;
      const named = await locatePlaces(hotelName, city, 'accommodation', { biasHint: hint || undefined });
      if (named.length) {
        fromLocator = true;
        return named.slice(0, 3).map(({ lat, lon, name, display_name }) => ({
          lat, lon, name, display_name, type: 'accommodation', approximate: false,
        }));
      }
    }
    let approximate = valid(await geoapify(text));
    const exact = approximate.filter(m => !m.approximate);
    if (exact.length) return exact.slice(0, 3);
    for (const query of hotelQueries(text, city)) {
      const { results } = await geocodeMany(query, 5);
      const matches = valid(results.map(m => ({ ...m, approximate: query === city || !['hotel', 'hostel', 'guest_house', 'apartment', 'apartments', 'motel', 'house', 'building'].includes(m.type ?? '') })));
      const precise = matches.filter(m => !m.approximate);
      if (precise.length) return precise.slice(0, 3);
      if (!approximate.length && matches.length) approximate = matches;
    }
    return approximate.slice(0, 3);
  })().catch(() => [] as HotelMatch[]).then(matches => {
    const first = matches[0];
    if (first && center && !fromLocator) console.info('[locate]', { kind: 'accommodation', name: text, city, provider: 'address-fallback', distanceKm: Number(haversineKm(center.lat, center.lon, first.lat, first.lon).toFixed(2)), match: first.display_name, approximate: first.approximate });
    if (matches.length) cache.set(key, matches);
    return matches;
  }).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
