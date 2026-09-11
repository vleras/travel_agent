import { haversineKm } from './geo';
import type { GeocodeResult } from './nominatim';
import type { DayItinerary, ItineraryStop } from '../types';

export interface GroupDistanceHint {
  /** 0-based group index */
  groupIndex: number;
  distanceKm: number;
}

export function groupCentroid(
  stops: ItineraryStop[],
): { lat: number; lon: number } | null {
  const sights = stops.filter((s) => !s.is_meal);
  if (!sights.length) return null;
  const lat = sights.reduce((s, p) => s + p.lat, 0) / sights.length;
  const lon = sights.reduce((s, p) => s + p.lon, 0) / sights.length;
  return { lat, lon };
}

/** Rank existing groups by distance from a candidate lat/lon. */
export function rankGroupsForPlace(
  lat: number,
  lon: number,
  itinerary: DayItinerary[],
): GroupDistanceHint[] {
  const ranked: GroupDistanceHint[] = [];
  for (let i = 0; i < itinerary.length; i++) {
    const c = groupCentroid(itinerary[i].stops);
    if (!c) continue;
    ranked.push({
      groupIndex: i,
      distanceKm: Math.round(haversineKm(lat, lon, c.lat, c.lon) * 10) / 10,
    });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm);
  return ranked;
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

export function findExistingGroup(
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

/** Farther than this → prefer offering a new group. */
export const NEAR_GROUP_KM = 2;
