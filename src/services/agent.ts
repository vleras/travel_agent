import { placeImageUrl } from '../data/scheduleOptions';
import { minutesToTime, parseTimeToMinutes } from '../data/scheduleOptions';
import { getFallbackAttractions } from '../data/fallbackAttractions';
import { lookupCityCenter } from '../data/cityCenters';
import { addDays, toISODate } from './geo';
import {
  haversineKm,
  maxAcceptableDistanceKm,
  paceStopsPerDay,
} from './geo';
import { generateAttractions } from './gemini';
import { geocode } from './nominatim';
import { routeDistance } from './osrm';
import { fetchPlacePhotoUrls } from './placePhotos';
import type {
  AgentOutput,
  AgentProgress,
  Attraction,
  BreakfastOption,
  DayItinerary,
  ItineraryStop,
  Pace,
  Revision,
  TripInput,
  TripLocation,
} from '../types';
import type { BreakfastPlace } from '../types/breakfast';

type ProgressCb = (progress: AgentProgress) => void;

interface ScoredAttraction extends Attraction {
  lat: number;
  lon: number;
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return (
    left === right || left.includes(right) || right.includes(left)
  );
}

/** Build Attraction records for the places the traveler picked. */
function resolveMustVisitAttractions(
  city: string,
  names: string[],
): Attraction[] {
  if (!names.length) return [];
  const curated = getFallbackAttractions(city);
  return names.map((name) => {
    const match = curated.find((a) => namesMatch(a.name, name));
    if (match) return { ...match, name: match.name };
    return {
      name,
      category: 'Sightseeing',
      description: `A must-visit stop in ${city}.`,
      typical_visit_duration_minutes: 75,
    };
  });
}

function clusterCentroid(
  stops: ScoredAttraction[],
): { lat: number; lon: number } | null {
  if (!stops.length) return null;
  return {
    lat: stops.reduce((sum, s) => sum + s.lat, 0) / stops.length,
    lon: stops.reduce((sum, s) => sum + s.lon, 0) / stops.length,
  };
}

/** Nearest-neighbor tour starting from an anchor (usually hotel/base). */
function orderByNearestNeighbor(
  stops: ScoredAttraction[],
  startLat: number,
  startLon: number,
): ScoredAttraction[] {
  const remaining = [...stops];
  const ordered: ScoredAttraction[] = [];
  let lat = startLat;
  let lon = startLon;

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineKm(lat, lon, remaining[i].lat, remaining[i].lon);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    lat = picked.lat;
    lon = picked.lon;
  }
  return ordered;
}

/**
 * Group nearby places onto the same day.
 * Seeds days with spatially spread anchors, then assigns each stop to the
 * nearest neighborhood cluster and walks a short route within each day.
 */
function clusterByProximity(
  attractions: ScoredAttraction[],
  days: number,
  pace: Pace,
  baseLat: number,
  baseLon: number,
): ScoredAttraction[][] {
  if (days <= 0) return [];
  if (!attractions.length) return Array.from({ length: days }, () => []);

  const perDay = paceStopsPerDay(pace);
  // Keep each neighborhood walkable: typically 2–4 nearby stops.
  const softCap = Math.min(
    4,
    Math.max(2, Math.min(perDay, Math.ceil(attractions.length / days))),
  );

  const remaining = [...attractions];
  const seeds: ScoredAttraction[] = [];

  // First seed: farthest from base (starts a distinct neighborhood).
  {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineKm(
        baseLat,
        baseLon,
        remaining[i].lat,
        remaining[i].lon,
      );
      if (dist > bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    seeds.push(remaining.splice(bestIdx, 1)[0]);
  }

  // More seeds: farthest from already chosen seeds (max-min distance).
  while (seeds.length < Math.min(days, attractions.length) && remaining.length) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const minToSeeds = Math.min(
        ...seeds.map((seed) =>
          haversineKm(seed.lat, seed.lon, remaining[i].lat, remaining[i].lon),
        ),
      );
      if (minToSeeds > bestDist) {
        bestDist = minToSeeds;
        bestIdx = i;
      }
    }
    seeds.push(remaining.splice(bestIdx, 1)[0]);
  }

  const clusters: ScoredAttraction[][] = seeds.map((seed) => [seed]);
  while (clusters.length < days) clusters.push([]);

  // Assign remaining stops to the nearest under-capacity neighborhood.
  for (const place of remaining) {
    let bestDay = 0;
    let bestDist = Infinity;

    for (let d = 0; d < days; d++) {
      const cluster = clusters[d];
      if (
        cluster.length >= softCap &&
        clusters.some((c, i) => i !== d && c.length < softCap)
      ) {
        continue;
      }
      const centroid = clusterCentroid(cluster);
      const dist = centroid
        ? haversineKm(centroid.lat, centroid.lon, place.lat, place.lon)
        : haversineKm(baseLat, baseLon, place.lat, place.lon);
      if (dist < bestDist) {
        bestDist = dist;
        bestDay = d;
      }
    }
    clusters[bestDay].push(place);
  }

  // Order days by neighborhood distance from the hotel/base.
  const orderedDays = [...clusters].sort((a, b) => {
    const ca = clusterCentroid(a);
    const cb = clusterCentroid(b);
    if (!ca && !cb) return 0;
    if (!ca) return 1;
    if (!cb) return -1;
    return (
      haversineKm(baseLat, baseLon, ca.lat, ca.lon) -
      haversineKm(baseLat, baseLon, cb.lat, cb.lon)
    );
  });

  // Compact walking order within each day.
  return orderedDays.map((day) =>
    orderByNearestNeighbor(day, baseLat, baseLon),
  );
}

function dayTotalDistance(
  stops: { lat: number; lon: number }[],
  baseLat: number,
  baseLon: number,
): number {
  if (!stops.length) return 0;
  let total = haversineKm(baseLat, baseLon, stops[0].lat, stops[0].lon);
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineKm(
      stops[i].lat,
      stops[i].lon,
      stops[i + 1].lat,
      stops[i + 1].lon,
    );
  }
  total += haversineKm(
    stops[stops.length - 1].lat,
    stops[stops.length - 1].lon,
    baseLat,
    baseLon,
  );
  return total;
}

function compactnessScore(
  stops: { lat: number; lon: number }[],
  baseLat: number,
  baseLon: number,
  pace: Pace,
): number {
  const maxDist = maxAcceptableDistanceKm(pace);
  const total = dayTotalDistance(stops, baseLat, baseLon);
  return Math.max(0, Math.min(100, Math.round(100 - (total / maxDist) * 100)));
}

function toItineraryStop(
  stop: ScoredAttraction & { is_meal?: boolean },
  time_slot: string,
  next?: ScoredAttraction,
  city?: string,
): ItineraryStop {
  return {
    name: stop.name,
    category: stop.category,
    description: stop.description,
    lat: stop.lat,
    lon: stop.lon,
    duration_min: stop.typical_visit_duration_minutes,
    time_slot,
    distance_to_next_km: next
      ? Math.round(haversineKm(stop.lat, stop.lon, next.lat, next.lon) * 10) / 10
      : undefined,
    image_url: stop.image_url ?? placeImageUrl(stop.name, city),
    is_meal: stop.is_meal,
  };
}

function makeBreakfastStop(
  baseLat: number,
  baseLon: number,
  city: string,
  selected?: BreakfastPlace | null,
  foodWanted?: string | null,
): ScoredAttraction & { is_meal: boolean } {
  if (selected) {
    return {
      name: selected.name,
      category: 'Food',
      description: foodWanted
        ? `${selected.description} · Looking for: ${foodWanted}`
        : selected.description,
      typical_visit_duration_minutes: 45,
      lat: selected.lat,
      lon: selected.lon,
      image_url:
        selected.image_url ?? placeImageUrl(selected.name, city),
      is_meal: true,
    };
  }
  return {
    name: 'Breakfast spot',
    category: 'Food',
    description: foodWanted
      ? `Looking for “${foodWanted}” near your base in ${city} — pick a place from the list.`
      : `Pick a bakery, café, or coffee shop near your base in ${city}.`,
    typical_visit_duration_minutes: 45,
    lat: baseLat,
    lon: baseLon,
    image_url: placeImageUrl('breakfast cafe', city),
    is_meal: true,
  };
}

export function assignTimeSlots(
  attractions: ScoredAttraction[],
  options: {
    dayStartTime: string;
    breakfastTime: BreakfastOption;
    baseLat: number;
    baseLon: number;
    city: string;
    breakfastPlace?: BreakfastPlace | null;
    breakfastFood?: string | null;
  },
): ItineraryStop[] {
  const {
    dayStartTime,
    breakfastTime,
    baseLat,
    baseLon,
    city,
    breakfastPlace,
    breakfastFood,
  } = options;
  const dayStartMins = parseTimeToMinutes(dayStartTime);
  const ordered: (ScoredAttraction & { is_meal?: boolean })[] = [];

  if (breakfastTime !== 'skip') {
    ordered.push(
      makeBreakfastStop(baseLat, baseLon, city, breakfastPlace, breakfastFood),
    );
  }
  ordered.push(...attractions);

  let minutes =
    breakfastTime !== 'skip'
      ? parseTimeToMinutes(breakfastTime)
      : dayStartMins;

  return ordered.map((stop, i) => {
    if (i === 1 && ordered[0]?.is_meal) {
      const breakfastEnd =
        parseTimeToMinutes(breakfastTime) +
        ordered[0].typical_visit_duration_minutes;
      minutes = Math.max(dayStartMins, breakfastEnd);
    }

    const time_slot = minutesToTime(minutes);
    const next = ordered[i + 1];
    const result = toItineraryStop(stop, time_slot, next, city);
    minutes += stop.typical_visit_duration_minutes + 30;
    return result;
  });
}

/** Re-slot an existing day's stops after the user changes start/breakfast times. */
export function rescheduleDayStops(
  day: DayItinerary,
  dayStartTime: string,
  breakfastTime: BreakfastOption,
  baseLat: number,
  baseLon: number,
  city: string,
  breakfastPlace?: BreakfastPlace | null,
  breakfastFood?: string | null,
): DayItinerary {
  const nonMeals = day.stops.filter((s) => !s.is_meal);
  const asAttractions: ScoredAttraction[] = nonMeals.map((s) => ({
    name: s.name,
    category: s.category,
    description: s.description,
    typical_visit_duration_minutes: s.duration_min,
    lat: s.lat,
    lon: s.lon,
    image_url: s.image_url,
  }));
  const stops = assignTimeSlots(asAttractions, {
    dayStartTime,
    breakfastTime,
    baseLat,
    baseLon,
    city,
    breakfastPlace,
    breakfastFood,
  });
  return { ...day, stops };
}

function buildDay(
  dayNumber: number,
  date: string,
  attractions: ScoredAttraction[],
  baseLat: number,
  baseLon: number,
  pace: Pace,
  schedule: {
    dayStartTime: string;
    breakfastTime: BreakfastOption;
    breakfastFood?: string | null;
    city: string;
  },
): DayItinerary {
  const stops = assignTimeSlots(attractions, {
    dayStartTime: schedule.dayStartTime,
    breakfastTime: schedule.breakfastTime,
    baseLat,
    baseLon,
    city: schedule.city,
    breakfastFood: schedule.breakfastFood,
  });
  const scoredForDistance = stops.filter((s) => !s.is_meal);
  const total_distance_km =
    Math.round(
      dayTotalDistance(scoredForDistance, baseLat, baseLon) * 10,
    ) / 10;
  const firstSight = scoredForDistance[0];
  const hotel_distance_km = firstSight
    ? Math.round(
        haversineKm(baseLat, baseLon, firstSight.lat, firstSight.lon) * 10,
      ) / 10
    : 0;
  return {
    date,
    day_number: dayNumber,
    stops,
    total_distance_km,
    compactness_score: compactnessScore(
      scoredForDistance,
      baseLat,
      baseLon,
      pace,
    ),
    hotel_distance_km,
  };
}

function reviseClusters(
  clusters: ScoredAttraction[][],
  baseLat: number,
  baseLon: number,
  pace: Pace,
): { clusters: ScoredAttraction[][]; revisions: Revision[] } {
  const revisions: Revision[] = [];
  const next = clusters.map((c) => [...c]);
  const threshold = 70;

  for (let dayIdx = 0; dayIdx < next.length; dayIdx++) {
    const score = compactnessScore(next[dayIdx], baseLat, baseLon, pace);
    if (score >= threshold || next[dayIdx].length < 2) continue;

    // Find farthest stop from day centroid
    const day = next[dayIdx];
    const centroidLat = day.reduce((s, a) => s + a.lat, 0) / day.length;
    const centroidLon = day.reduce((s, a) => s + a.lon, 0) / day.length;

    let farthestIdx = 0;
    let farthestDist = -1;
    day.forEach((stop, i) => {
      const dist = haversineKm(centroidLat, centroidLon, stop.lat, stop.lon);
      if (dist > farthestDist) {
        farthestDist = dist;
        farthestIdx = i;
      }
    });

    const candidate = day[farthestIdx];
    let bestDay = -1;
    let bestImprovement = 0;

    for (let other = 0; other < next.length; other++) {
      if (other === dayIdx) continue;
      if (next[other].length >= paceStopsPerDay(pace) + 1) continue;

      const trialFrom = day.filter((_, i) => i !== farthestIdx);
      const trialTo = [...next[other], candidate];
      const before =
        compactnessScore(day, baseLat, baseLon, pace) +
        compactnessScore(next[other], baseLat, baseLon, pace);
      const after =
        compactnessScore(trialFrom, baseLat, baseLon, pace) +
        compactnessScore(trialTo, baseLat, baseLon, pace);
      const improvement = after - before;
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestDay = other;
      }
    }

    if (bestDay >= 0 && bestImprovement > 0) {
      next[dayIdx] = day.filter((_, i) => i !== farthestIdx);
      next[bestDay].push(candidate);
      revisions.push({
        day_from: dayIdx + 1,
        day_to: bestDay + 1,
        stop_name: candidate.name,
        reason: 'too far spread from day cluster',
      });
    }
  }

  return { clusters: next, revisions };
}

async function ensureCoords(
  attractions: Attraction[],
  city: string,
  onProgress: ProgressCb,
): Promise<{
  scored: ScoredAttraction[];
  nominatimMs: number;
  apiCalls: number;
}> {
  const scored: ScoredAttraction[] = [];
  let nominatimMs = 0;
  let apiCalls = 0;

  for (const attraction of attractions) {
    if (attraction.lat != null && attraction.lon != null) {
      scored.push({
        ...attraction,
        lat: attraction.lat,
        lon: attraction.lon,
      });
      continue;
    }
    onProgress({
      step: 'act',
      message: 'Locating places',
      detail: attraction.name,
    });
    const { result, latencyMs } = await geocode(
      `${attraction.name}, ${city}`,
    );
    nominatimMs += latencyMs;
    apiCalls += 1;
    if (result) {
      scored.push({ ...attraction, lat: result.lat, lon: result.lon });
    }
  }
  return { scored, nominatimMs, apiCalls };
}

/** Attach real Wikipedia/Commons/Openverse photos after coords exist. */
async function attachPlacePhotos(
  attractions: ScoredAttraction[],
  city: string,
  onProgress: ProgressCb,
): Promise<ScoredAttraction[]> {
  onProgress({
    step: 'act',
    message: 'Loading photos',
    detail: `Fetching images for ${attractions.length} places…`,
  });

  const enriched: ScoredAttraction[] = [];
  const batchSize = 4;

  for (let i = 0; i < attractions.length; i += batchSize) {
    const batch = attractions.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (attr) => {
        const alreadyReal =
          attr.image_url &&
          !attr.image_url.includes('loremflickr.com') &&
          !attr.image_url.includes('picsum.photos');
        if (alreadyReal) return attr;

        const photoUrls = await fetchPlacePhotoUrls(
          attr.name,
          city,
          attr.category,
          attr.lat,
          attr.lon,
        );
        return {
          ...attr,
          image_url: photoUrls[0] ?? placeImageUrl(attr.name, city),
        };
      }),
    );
    enriched.push(...results);
    onProgress({
      step: 'act',
      message: 'Fetching place photos',
      detail: `${Math.min(i + batchSize, attractions.length)}/${attractions.length} places…`,
    });
  }

  return enriched;
}

export async function runTravelAgent(
  input: TripInput,
  onProgress: ProgressCb = () => undefined,
): Promise<AgentOutput> {
  const started = performance.now();
  let apiCalls = 0;
  let nominatimMs = 0;
  let osrmMs = 0;
  let geminiMs = 0;

  // —— REASON ——
  onProgress({
    step: 'reason',
    message: 'Finding your base',
    detail: input.hotel_address
      ? 'Locating your stay…'
      : `Locating ${input.destination_city}…`,
  });

  const destGeo = await geocode(input.destination_city);
  nominatimMs += destGeo.latencyMs;
  apiCalls += 1;

  const destFallback = !destGeo.result
    ? lookupCityCenter(input.destination_city)
    : null;
  const dest = destGeo.result ?? destFallback;

  if (!dest) {
    throw new Error(
      `Could not locate ${input.destination_city}. OpenStreetMap is busy — try again in a minute.`,
    );
  }

  let hotelLat: number | null = null;
  let hotelLon: number | null = null;
  let hotelName: string | null = null;

  if (input.hotel_address) {
    const hotelGeo = await geocode(
      `${input.hotel_address}, ${input.destination_city}`,
    );
    nominatimMs += hotelGeo.latencyMs;
    apiCalls += 1;
    if (hotelGeo.result) {
      hotelLat = hotelGeo.result.lat;
      hotelLon = hotelGeo.result.lon;
      hotelName = hotelGeo.result.display_name;
    }
  }

  const location: TripLocation = {
    destination_lat: dest.lat,
    destination_lon: dest.lon,
    destination_name: dest.display_name,
    hotel_lat: hotelLat,
    hotel_lon: hotelLon,
    hotel_name: hotelName,
    base_lat: hotelLat ?? dest.lat,
    base_lon: hotelLon ?? dest.lon,
  };

  // —— ACT ——
  onProgress({
    step: 'act',
    message: 'Organizing your places',
    detail: 'Finding nearby spots and grouping them…',
  });

  const mustVisitNames = (input.must_visit_places ?? []).filter(Boolean);
  const mustVisitAttractions = resolveMustVisitAttractions(
    input.destination_city,
    mustVisitNames,
  );

  let attractions: Attraction[] = [];
  let source: 'gemini' | 'fallback' | 'picks' = 'picks';

  if (mustVisitAttractions.length > 0) {
    // Traveler picks drive the plan — skip filler recommendations.
    attractions = mustVisitAttractions;
    source = 'picks';
  } else {
    const generated = await generateAttractions(
      input.destination_city,
      input.interests,
      input.custom_preferences,
    );
    attractions = generated.attractions;
    geminiMs += generated.latencyMs;
    if (generated.source === 'gemini') apiCalls += 1;
    source = generated.source === 'gemini' ? 'gemini' : 'fallback';
  }

  const mergedAttractions =
    mustVisitAttractions.length > 0
      ? mustVisitAttractions
      : attractions;

  onProgress({
    step: 'act',
    message: 'Locating places',
    detail:
      source === 'picks'
        ? `Pinning your ${mergedAttractions.length} picks on the map…`
        : source === 'fallback'
          ? 'Using curated attractions…'
          : `Geocoding ${mergedAttractions.length} places…`,
  });

  const { scored, nominatimMs: geoMs, apiCalls: geoCalls } = await ensureCoords(
    mergedAttractions,
    input.destination_city,
    onProgress,
  );
  nominatimMs += geoMs;
  apiCalls += geoCalls;

  const scoredWithPhotos = await attachPlacePhotos(
    scored,
    input.destination_city,
    onProgress,
  );

  const planningPool = scoredWithPhotos;

  // Sample OSRM for a couple of pairs (thesis metrics) without blocking clustering
  if (planningPool.length >= 2) {
    const sample = await routeDistance(
      planningPool[0].lon,
      planningPool[0].lat,
      planningPool[1].lon,
      planningPool[1].lat,
    );
    osrmMs += sample.latencyMs;
    apiCalls += 1;
  }

  // —— OBSERVE ——
  const dayCount = Math.max(
    1,
    Math.min(
      input.trip_length_days,
      Math.max(1, Math.ceil(planningPool.length / 2)),
    ),
  );

  onProgress({
    step: 'observe',
    message: 'Grouping nearby places',
    detail: `Clustering into walkable groups of 2–4 across ${dayCount} areas…`,
  });

  const clusters = clusterByProximity(
    planningPool,
    dayCount,
    input.pace,
    location.base_lat,
    location.base_lon,
  );

  const startDate = new Date(input.start_date + 'T12:00:00');
  const schedule = {
    dayStartTime: input.day_start_time,
    breakfastTime: input.breakfast_time,
    breakfastFood: input.breakfast_food,
    city: input.destination_city,
  };
  const beforeDays = clusters.map((c, i) =>
    buildDay(
      i + 1,
      toISODate(addDays(startDate, i)),
      c,
      location.base_lat,
      location.base_lon,
      input.pace,
      schedule,
    ),
  );
  const compactnessBefore = average(
    beforeDays.map((d) => d.compactness_score),
  );

  // —— REVISE ——
  onProgress({
    step: 'revise',
    message: 'Tightening groups',
    detail: 'Moving outliers into closer neighborhoods…',
  });

  const { clusters: revised, revisions } = reviseClusters(
    clusters,
    location.base_lat,
    location.base_lon,
    input.pace,
  );

  const itinerary = revised.map((c, i) =>
    buildDay(
      i + 1,
      toISODate(addDays(startDate, i)),
      c,
      location.base_lat,
      location.base_lon,
      input.pace,
      schedule,
    ),
  );

  const compactnessAfter = average(itinerary.map((d) => d.compactness_score));
  const totalTripDistance =
    Math.round(
      itinerary.reduce((s, d) => s + d.total_distance_km, 0) * 10,
    ) / 10;
  const processingMs = Math.round(performance.now() - started);

  const metrics = {
    agent_processing_time_ms: processingMs,
    compactness_before_revision: Math.round(compactnessBefore * 10) / 10,
    compactness_after_revision: Math.round(compactnessAfter * 10) / 10,
    improvement_delta:
      Math.round((compactnessAfter - compactnessBefore) * 10) / 10,
    revision_count: revisions.length,
    api_calls_total: apiCalls,
    api_call_latency: {
      nominatim_ms: nominatimMs,
      osrm_ms: osrmMs,
      gemini_ms: geminiMs,
    },
  };

  console.log('[TravelAgent metrics]', metrics);
  console.log('[TravelAgent revisions]', revisions);

  onProgress({
    step: 'done',
    message: 'Groups ready',
    detail: `${itinerary.length} nearby group${itinerary.length === 1 ? '' : 's'} from your picks`,
  });

  return {
    itinerary,
    revisions,
    metadata: {
      destination: input.destination_city,
      hotel_lat: location.base_lat,
      hotel_lon: location.base_lon,
      total_trip_distance_km: totalTripDistance,
      average_compactness: Math.round(compactnessAfter * 10) / 10,
      agent_revision_count: revisions.length,
      agent_processing_time_ms: processingMs,
    },
    metrics,
  };
}
