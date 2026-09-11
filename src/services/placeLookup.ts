import { haversineKm } from './geo';
import type { GeocodeResult } from './nominatim';
import type { DayItinerary, ItineraryStop } from '../types';

export interface DayDistanceHint {
  /** 0-based day index */
  dayIndex: number;
  distanceKm: number;
  /** Closest place already on that day (for chat copy). */
  nearestPlaceName?: string;
  nearestPlaceKm?: number;
}

export function dayCentroid(
  stops: ItineraryStop[],
): { lat: number; lon: number } | null {
  const sights = stops.filter((s) => !s.is_meal);
  if (!sights.length) return null;
  const lat = sights.reduce((s, p) => s + p.lat, 0) / sights.length;
  const lon = sights.reduce((s, p) => s + p.lon, 0) / sights.length;
  return { lat, lon };
}

function nearestStopOnDay(
  lat: number,
  lon: number,
  stops: ItineraryStop[],
): { name: string; distanceKm: number } | null {
  const sights = stops.filter((s) => !s.is_meal);
  if (!sights.length) return null;
  let best = sights[0];
  let bestKm = haversineKm(lat, lon, best.lat, best.lon);
  for (let i = 1; i < sights.length; i++) {
    const km = haversineKm(lat, lon, sights[i].lat, sights[i].lon);
    if (km < bestKm) {
      best = sights[i];
      bestKm = km;
    }
  }
  return {
    name: best.name,
    distanceKm: Math.round(bestKm * 10) / 10,
  };
}

/** Rank days that already have places by distance from a candidate lat/lon. */
export function rankDaysForPlace(
  lat: number,
  lon: number,
  itinerary: DayItinerary[],
): DayDistanceHint[] {
  const ranked: DayDistanceHint[] = [];
  for (let i = 0; i < itinerary.length; i++) {
    const c = dayCentroid(itinerary[i].stops);
    if (!c) continue;
    const nearest = nearestStopOnDay(lat, lon, itinerary[i].stops);
    ranked.push({
      dayIndex: i,
      distanceKm: Math.round(haversineKm(lat, lon, c.lat, c.lon) * 10) / 10,
      nearestPlaceName: nearest?.name,
      nearestPlaceKm: nearest?.distanceKm,
    });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm);
  return ranked;
}

/** Chat action chips for every trip day + Cancel. */
export function dayActionButtons(dayCount: number): { label: string; value: string }[] {
  const actions = Array.from({ length: Math.max(1, dayCount) }, (_, i) => ({
    label: `Day ${i + 1}`,
    value: `Day ${i + 1}`,
  }));
  actions.push({ label: 'Cancel', value: 'Cancel' });
  return actions;
}

export function formatDayHint(hint: DayDistanceHint): string {
  const day = `Day ${hint.dayIndex + 1}`;
  if (hint.nearestPlaceName != null && hint.nearestPlaceKm != null) {
    return `${day} (${hint.nearestPlaceKm} km from ${hint.nearestPlaceName})`;
  }
  return `${day} (${hint.distanceKm} km from day center)`;
}

export function shortDisplayName(display: string, fallback: string): string {
  const parts = display.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || fallback;
}

export function stopFromGeocode(
  query: string,
  geo: GeocodeResult,
  baseLat: number,
  baseLon: number,
): ItineraryStop {
  const dist =
    Math.round(haversineKm(baseLat, baseLon, geo.lat, geo.lon) * 10) / 10;
  const label = shortDisplayName(geo.display_name, query);
  return {
    name: query.trim(),
    category: 'Custom',
    description: `Added from chat · ${label} · ~${dist} km from your base`,
    lat: geo.lat,
    lon: geo.lon,
    duration_min: 60,
    time_slot: '12:00',
  };
}

export function findExistingDay(
  itinerary: DayItinerary[],
  placeName: string,
  lat?: number,
  lon?: number,
): number {
  const needle = placeName.toLowerCase().trim();
  for (let i = 0; i < itinerary.length; i++) {
    for (const s of itinerary[i].stops) {
      if (s.is_meal) continue;
      if (s.name.toLowerCase() === needle) return i;
      if (
        lat != null &&
        lon != null &&
        Math.abs(s.lat - lat) < 0.0008 &&
        Math.abs(s.lon - lon) < 0.0008
      ) {
        return i;
      }
    }
  }
  return -1;
}
