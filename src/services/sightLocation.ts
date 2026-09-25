import { geocode } from './nominatim';
import { haversineKm } from './geo';
import { distinctiveTokens, fold, matchesName, sharesStem } from './nameMatch';
import { lookupCityCenter } from '../data/cityCenters';

/**
 * Shared POI locator for sights and hotels.
 * Providers in order: Photon (free, no key, good at POI names), Geoapify,
 * then Nominatim (queued at 1 req/s). A result is only accepted when it lies
 * within 20 km of the city center and its name fuzzy-matches the query;
 * otherwise the next provider is tried.
 */

export type PlaceKind = 'sight' | 'accommodation';
export type MatchPath = 'english-name' | 'name' | 'local-name';
export type LocateProvider = 'photon' | 'geoapify' | 'nominatim';

export interface LocatedPlace {
  lat: number;
  lon: number;
  name: string;
  display_name: string;
  /** English name when the provider has one. */
  nameEn?: string;
  provider: LocateProvider;
  /** Which name rule accepted it. */
  matchPath: MatchPath;
  /** Distance from the city center. */
  distanceKm: number;
}

type Point = { lat: number; lon: number };
type Candidate = {
  lat: number;
  lon: number;
  name: string;
  display_name: string;
  /** English name when the provider has one (Photon `name:en`). */
  nameEn?: string;
  /** OSM key of the feature: tourism, historic, amenity, … */
  osmKey?: string;
  /** OSM value: hotel, museum, residential, … */
  osmValue?: string;
};

/** Features that are never a sight ("Lana Riverside Residences", "Art Hotel"). */
const NOT_A_SIGHT = new Set([
  'hotel', 'guest_house', 'apartment', 'apartments', 'hostel', 'motel', 'chalet',
  'residential', 'house', 'detached', 'office', 'commercial', 'company',
]);

const LOCAL_NAME_KEYS = new Set(['tourism', 'historic', 'amenity']);
const LOCAL_NAME_RADIUS_KM = 2;

const STORAGE_KEY = 'travel_planner_sight_coords_v2';
const MAX_FROM_CITY_KM = 20;
const USER_AGENT = 'TravelPlannerThesis/1.0 (thesis-project; contact@example.com)';

const memory = new Map<string, Point | null>();
/** Sights already located per city, anchors for the local-name path. */
const locatedByCity = new Map<string, Point[]>();

function cityKey(city: string) {
  return city.trim().toLowerCase();
}

function rememberLocated(city: string, point: Point) {
  const list = locatedByCity.get(cityKey(city)) ?? [];
  list.push(point);
  locatedByCity.set(cityKey(city), list);
}

function anchorsFor(city: string): Point[] {
  const key = cityKey(city);
  const fromStore = Object.entries(loadStore())
    .filter(([k]) => k.startsWith(`${key}|`))
    .map(([, p]) => p);
  return [...(locatedByCity.get(key) ?? []), ...fromStore];
}
const pending = new Map<string, Promise<Point | null>>();

function loadStore(): Record<string, Point> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Point>;
  } catch {
    return {};
  }
}

function saveStore(key: string, value: Point) {
  try {
    const store = loadStore();
    store[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable */
  }
}

const centers = new Map<string, Promise<Point | null>>();

/** City center: curated table, then Photon (place features), then Nominatim. */
export function cityCenter(city: string): Promise<Point | null> {
  const key = cityKey(city);
  const cached = centers.get(key);
  if (cached) return cached;
  const work = (async () => {
    const known = lookupCityCenter(city);
    if (known) return known;
    try {
      const url = new URL('https://photon.komoot.io/api/');
      url.search = new URLSearchParams({ q: city, limit: '1', lang: 'en', osm_tag: 'place' }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = (await res.json()) as { features?: { geometry?: { coordinates?: number[] } }[] };
        const [lon, lat] = data.features?.[0]?.geometry?.coordinates ?? [];
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
      }
    } catch {
      /* fall through */
    }
    return (await geocode(city)).result;
  })();
  centers.set(key, work);
  work.then((p) => {
    if (!p) centers.delete(key);
  });
  return work;
}

const valid = (c: Candidate) =>
  Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;

async function photon(name: string, center: Point, kind: PlaceKind): Promise<Candidate[]> {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', name);
    url.searchParams.set('lat', String(center.lat));
    url.searchParams.set('lon', String(center.lon));
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'en');
    // lat/lon alone is only a soft bias (a "Grace Hotel" in Sydney wins), so
    // also restrict to a box of roughly the 20 km validation radius.
    const dLat = MAX_FROM_CITY_KM / 111;
    const dLon = MAX_FROM_CITY_KM / (111 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.2));
    url.searchParams.set(
      'bbox',
      [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat].map((n) => n.toFixed(4)).join(','),
    );
    if (kind === 'accommodation') url.searchParams.set('osm_tag', 'tourism');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: number[] };
        properties?: Record<string, string> & { extra?: Record<string, string> };
      }[];
    };
    return (data.features ?? []).map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const display = [p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.city, p.country]
        .filter(Boolean)
        .join(', ');
      const nameEn = p['name:en'] ?? p.extra?.['name:en'];
      return {
        lat: Number(lat),
        lon: Number(lon),
        name: p.name ?? '',
        display_name: display || name,
        nameEn: typeof nameEn === 'string' ? nameEn : undefined,
        osmKey: p.osm_key,
        osmValue: p.osm_value,
      };
    });
  } catch {
    return [];
  }
}

async function geoapify(name: string, city: string, center: Point, kind: PlaceKind): Promise<Candidate[]> {
  const key = import.meta.env.VITE_GEOAPIFY_KEY?.trim();
  if (!key) return [];
  try {
    let url: URL;
    if (kind === 'accommodation') {
      url = new URL('https://api.geoapify.com/v2/places');
      url.search = new URLSearchParams({
        categories: 'accommodation',
        name,
        filter: `circle:${center.lon},${center.lat},${MAX_FROM_CITY_KM * 1000}`,
        bias: `proximity:${center.lon},${center.lat}`,
        limit: '5',
        apiKey: key,
      }).toString();
    } else {
      url = new URL('https://api.geoapify.com/v1/geocode/search');
      url.search = new URLSearchParams({
        text: `${name}, ${city}`,
        lang: 'en',
        limit: '5',
        bias: `proximity:${center.lon},${center.lat}`,
        apiKey: key,
      }).toString();
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: Record<string, string | number> }[] };
    return (data.features ?? []).map(({ properties: p = {} }) => ({
      lat: Number(p.lat),
      lon: Number(p.lon),
      name: String(p.name ?? p.address_line1 ?? ''),
      display_name: String(p.formatted ?? p.name ?? name),
      osmKey: /tourism|heritage|historic/.test(String(p.categories ?? p.result_type ?? ''))
        ? 'tourism'
        : undefined,
    }));
  } catch {
    return [];
  }
}

// Nominatim allows 1 request per second: every call waits its turn in this chain.
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

function queuedNominatim(query: string): Promise<Candidate[]> {
  const run = async (): Promise<Candidate[]> => {
    const wait = lastNominatimAt + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({ q: query, format: 'json', limit: '5' }).toString();
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        lat: string;
        lon: string;
        name?: string;
        display_name: string;
        class?: string;
        type?: string;
      }[];
      return data.map((d) => ({
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lon),
        name: d.name ?? '',
        display_name: d.display_name,
        osmKey: d.class,
        osmValue: d.type,
      }));
    } catch {
      return [];
    }
  };
  const result = nominatimQueue.then(run, run);
  nominatimQueue = result.catch(() => undefined);
  return result;
}

/** Point for an area/street hint (e.g. "Rruga Myslym Shyri"), else the city center. */
async function hintPoint(hint: string, city: string, center: Point): Promise<Point> {
  const hits = (await photon(`${hint}, ${city}`, center, 'sight')).filter(
    (c) => valid(c) && haversineKm(center.lat, center.lon, c.lat, c.lon) <= MAX_FROM_CITY_KM,
  );
  return hits[0] ?? center;
}

/**
 * An area or street inside the city (e.g. "Imerovigli" in Santorini), for
 * approximate hotel locations. Photon only, boxed to the city.
 */
export async function locateArea(hint: string, city: string): Promise<LocatedPlace | null> {
  const center = await cityCenter(city);
  if (!center) return null;
  const hit = (await photon(hint, center, 'sight'))
    .filter(valid)
    .map((c) => ({ ...c, distanceKm: haversineKm(center.lat, center.lon, c.lat, c.lon) }))
    .find((c) => c.distanceKm <= MAX_FROM_CITY_KM && sharesStem(`${c.nameEn ?? ''} ${c.name}`, hint));
  if (!hit) return null;
  return { ...hit, provider: 'photon', matchPath: 'name' };
}

/**
 * Candidates for `name` in `city`, from the first provider that returns any
 * result passing validation (≤20 km from the center, fuzzy name match).
 */
export async function locatePlaces(
  name: string,
  city: string,
  kind: PlaceKind = 'sight',
  options: { biasHint?: string } = {},
): Promise<LocatedPlace[]> {
  const center = await cityCenter(city);
  if (!center) return [];
  const bias = options.biasHint ? await hintPoint(options.biasHint, city, center) : center;
  const anchors = [center, ...anchorsFor(city)];

  // "Artificial Lake of Tirana" must be *in* Tirana, not "Fjolla artificial lake, Pezë".
  const cityTokens = distinctiveTokens(city);
  const nameHasCity = cityTokens.some((t) => fold(name).includes(t));

  const matchPath = (c: Candidate): MatchPath | null => {
    if (nameHasCity && !cityTokens.some((t) => fold(`${c.name} ${c.display_name}`).includes(t))) {
      return null;
    }
    if (kind === 'sight' && (c.osmKey === 'building' || c.osmKey === 'landuse' || (c.osmValue && NOT_A_SIGHT.has(c.osmValue)))) {
      return null;
    }
    // English name first, then the local name / full label.
    if (c.nameEn && matchesName(c.nameEn, name)) return 'english-name';
    if (matchesName(`${c.name} ${c.display_name}`, name)) return 'name';
    // Local-name path: a real POI near the center or another located sight
    // that shares a stem ("Sheshi Skënderbej" for "Skanderbeg Square").
    if (!c.osmKey || !LOCAL_NAME_KEYS.has(c.osmKey)) return null;
    if (!sharesStem(`${c.nameEn ?? ''} ${c.name}`, name)) return null;
    return anchors.some((a) => haversineKm(a.lat, a.lon, c.lat, c.lon) <= LOCAL_NAME_RADIUS_KM)
      ? 'local-name'
      : null;
  };

  const accept = (provider: LocateProvider, list: Candidate[]): LocatedPlace[] =>
    list
      .filter(valid)
      .map((c) => ({ ...c, provider, distanceKm: haversineKm(center.lat, center.lon, c.lat, c.lon) }))
      .filter((c) => c.distanceKm <= MAX_FROM_CITY_KM)
      .map((c) => ({ ...c, matchPath: matchPath(c) }))
      .filter((c): c is typeof c & { matchPath: MatchPath } => c.matchPath != null);

  const providers: [LocateProvider, () => Promise<Candidate[]>][] = [
    ['photon', () => photon(name, bias, kind)],
    ['geoapify', () => geoapify(name, city, bias, kind)],
    ['nominatim', () => queuedNominatim(`${name}, ${city}`)],
  ];
  for (const [provider, run] of providers) {
    const hits = accept(provider, await run());
    if (hits.length) {
      console.info('[locate]', {
        kind,
        name,
        city,
        provider,
        distanceKm: Number(hits[0].distanceKm.toFixed(2)),
        match: hits[0].nameEn ?? hits[0].display_name,
        matchPath: hits[0].matchPath,
        biasHint: options.biasHint,
      });
      return hits;
    }
  }
  console.info('[locate]', { kind, name, city, provider: null, result: 'no validated match' });
  return [];
}

/** Coordinates for a sight (cached in memory + localStorage, in-flight deduped). */
export function locateSight(name: string, city: string): Promise<Point | null> {
  const key = `${city}|${name}`.trim().toLowerCase();
  if (memory.has(key)) return Promise.resolve(memory.get(key)!);
  const stored = loadStore()[key];
  if (stored) {
    memory.set(key, stored);
    return Promise.resolve(stored);
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const work = locatePlaces(name, city, 'sight')
    .then((hits) => (hits[0] ? { lat: hits[0].lat, lon: hits[0].lon } : null))
    .catch(() => null)
    .then((point) => {
      memory.set(key, point);
      if (point) {
        saveStore(key, point);
        rememberLocated(city, point);
      }
      return point;
    })
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
