import { haversineKm } from './geo';
import { getCuratedBreakfast } from '../data/breakfastFallbacks';
import type { BreakfastCategory, BreakfastPlace } from '../types/breakfast';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function classify(tags: Record<string, string>): {
  category: BreakfastCategory;
  label: string;
} {
  const shop = tags.shop ?? '';
  const amenity = tags.amenity ?? '';
  const cuisine = (tags.cuisine ?? '').toLowerCase();

  if (shop === 'bakery' || cuisine.includes('bakery') || cuisine.includes('pastry')) {
    return { category: 'bakery', label: 'Bakery' };
  }
  if (
    cuisine.includes('coffee') ||
    (amenity === 'cafe' &&
      (tags.cuisine === 'coffee_shop' || tags.takeaway === 'yes'))
  ) {
    if (cuisine.includes('coffee') || tags.cuisine === 'coffee_shop') {
      return { category: 'coffee', label: 'Coffee' };
    }
  }
  if (cuisine.includes('brunch') || cuisine.includes('breakfast')) {
    return { category: 'brunch', label: 'Brunch' };
  }
  if (amenity === 'cafe' || amenity === 'ice_cream') {
    return { category: 'cafe', label: 'Café' };
  }
  if (amenity === 'fast_food' && cuisine.includes('coffee')) {
    return { category: 'coffee', label: 'Coffee' };
  }
  return { category: 'cafe', label: 'Café' };
}

function describe(tags: Record<string, string>, categoryLabel: string): string {
  const bits = [categoryLabel];
  if (tags.cuisine) bits.push(tags.cuisine.replace(/_/g, ', '));
  if (tags.opening_hours) bits.push(`Hours: ${tags.opening_hours}`);
  if (tags['addr:street']) {
    bits.push(
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    );
  }
  return bits.join(' · ');
}

async function queryOverpass(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<BreakfastPlace[]> {
  const query = `
[out:json][timeout:20];
(
  node["shop"="bakery"](around:${radiusM},${lat},${lon});
  node["amenity"="cafe"](around:${radiusM},${lat},${lon});
  node["amenity"="fast_food"]["cuisine"~"coffee|bakery",i](around:${radiusM},${lat},${lon});
  node["amenity"="restaurant"]["cuisine"~"breakfast|brunch|coffee",i](around:${radiusM},${lat},${lon});
  way["shop"="bakery"](around:${radiusM},${lat},${lon});
  way["amenity"="cafe"](around:${radiusM},${lat},${lon});
);
out center 40;
`.trim();

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);

  const data = (await response.json()) as { elements?: OverpassElement[] };
  const places: BreakfastPlace[] = [];
  const seen = new Set<string>();

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    if (plat == null || plon == null) continue;

    const key = `${name.toLowerCase()}-${plat.toFixed(4)}-${plon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { category, label } = classify(tags);
    const website =
      tags.website || tags['contact:website'] || tags['contact:facebook'];
    const menu =
      tags['contact:menu'] ||
      tags.menu ||
      (website && /menu/i.test(website) ? website : undefined);
    const phone = tags.phone || tags['contact:phone'];
    const address = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'],
    ]
      .filter(Boolean)
      .join(' ');

    places.push({
      id: `osm-${el.type}-${el.id}`,
      name,
      category,
      categoryLabel: label,
      description: describe(tags, label),
      lat: plat,
      lon: plon,
      address: address || undefined,
      opening_hours: tags.opening_hours,
      cuisine: tags.cuisine?.replace(/_/g, ', '),
      phone,
      website,
      menu_url: menu,
      osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      source: 'overpass',
    });
  }

  return places;
}

function withDistance(
  places: BreakfastPlace[],
  lat: number,
  lon: number,
): BreakfastPlace[] {
  return places
    .map((p) => ({
      ...p,
      distance_km: Math.round(haversineKm(lat, lon, p.lat, p.lon) * 100) / 100,
    }))
    .sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99));
}

function hotelOption(lat: number, lon: number): BreakfastPlace {
  return {
    id: 'hotel-breakfast',
    name: 'Hotel / accommodation breakfast',
    category: 'hotel',
    categoryLabel: 'Hotel',
    description: 'Stay in and eat at your base before sightseeing.',
    lat,
    lon,
    distance_km: 0,
    address: 'At your accommodation',
    opening_hours: 'Depends on your hotel',
    cuisine: 'Hotel breakfast buffet / à la carte',
    source: 'curated',
  };
}

/**
 * Nearby breakfast options around the trip base.
 * Uses a wider radius when the user has no hotel (city-center browsing).
 */
export async function fetchBreakfastOptions(params: {
  baseLat: number;
  baseLon: number;
  city: string;
  hasHotel: boolean;
}): Promise<{ places: BreakfastPlace[]; nearBase: boolean }> {
  const { baseLat, baseLon, city, hasHotel } = params;
  const radiusM = hasHotel ? 1200 : 2800;
  const nearBase = hasHotel;

  try {
    const live = await queryOverpass(baseLat, baseLon, radiusM);
    const merged = withDistance(
      [...live, hotelOption(baseLat, baseLon)],
      baseLat,
      baseLon,
    );
    if (merged.length >= 3) {
      return { places: merged.slice(0, 24), nearBase };
    }
  } catch {
    /* fall through to curated */
  }

  const curated = getCuratedBreakfast(city).map((p) =>
    p.category === 'hotel' ? { ...p, lat: baseLat, lon: baseLon } : p,
  );
  return {
    places: withDistance(curated, baseLat, baseLon),
    nearBase,
  };
}

export function filterBreakfastPlaces(
  places: BreakfastPlace[],
  category: BreakfastCategory,
): BreakfastPlace[] {
  if (category === 'all') return places;
  return places.filter((p) => p.category === category);
}

/** Map free-text food wants → preferred place categories. */
export function inferCategoriesFromFood(
  food: string | null | undefined,
): BreakfastCategory[] {
  if (!food?.trim()) return ['all'];
  const q = food.toLowerCase();
  const cats = new Set<BreakfastCategory>();

  if (/pastr|baker|croissant|bread|cornetto|brioche|donut|doughnut|bagel/.test(q)) {
    cats.add('bakery');
  }
  if (/coffee|espresso|latte|cappuccino|americano|flat white/.test(q)) {
    cats.add('coffee');
  }
  if (/egg|omelet|pancake|waffle|brunch|avocado|toast|bacon|sausage|full english/.test(q)) {
    cats.add('brunch');
  }
  if (/hotel|buffet|accommodation|stay/.test(q)) {
    cats.add('hotel');
  }
  if (/cafe|café|tea|yogurt|fruit|smoothie|juice/.test(q)) {
    cats.add('cafe');
  }
  if (/street|local|market/.test(q)) {
    cats.add('brunch');
    cats.add('cafe');
  }

  if (cats.size === 0) return ['all'];
  return [...cats];
}

/**
 * Rank / filter places by what the user said they want to eat.
 * Matching categories first, then the rest as “also nearby”.
 */
export function rankPlacesByFoodPreference(
  places: BreakfastPlace[],
  food: string | null | undefined,
): { matched: BreakfastPlace[]; other: BreakfastPlace[]; categories: BreakfastCategory[] } {
  const categories = inferCategoriesFromFood(food);
  if (categories.includes('all')) {
    return { matched: places, other: [], categories };
  }

  const matched = places.filter((p) => categories.includes(p.category));
  const other = places.filter((p) => !categories.includes(p.category));
  return { matched, other, categories };
}
