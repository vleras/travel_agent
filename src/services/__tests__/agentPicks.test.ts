import { expect, it, vi } from 'vitest';
import { runTravelAgent } from '../agent';
import { locateSight } from '../sightLocation';
import type { TripInput } from '../../types';

vi.mock('../nominatim', () => ({ geocode: vi.fn(async () => ({ result: { lat: 42.7, lon: 25.5, display_name: 'Bulgaria' }, latencyMs: 0 })) }));
vi.mock('../sightLocation', () => ({ locateSight: vi.fn(async () => null) }));
vi.mock('../placePhotos', () => ({ fetchPlacePhotoUrls: vi.fn(async () => []) }));
vi.mock('../osrm', () => ({ routeDistance: vi.fn(async () => ({ latencyMs: 0 })) }));

const input: TripInput = {
  destination_city: 'Bulgaria', trip_length_days: 3, days_range: null,
  start_date: '2026-10-10', end_date: '2026-10-12', dates_flexible: true,
  hotel_address: null, suggested_area: null, interests: [], custom_preferences: null,
  pace: 'balanced', day_start_time: '09:00', breakfast_time: 'skip', breakfast_food: null,
  must_visit_places: ['Rila Monastery', 'Old Nessebar'],
};

it('keeps every selected place in the itinerary even when photos are unavailable', async () => {
  const result = await runTravelAgent({ ...input, must_visit_attractions: [
    { name: 'Rila Monastery', category: 'Architecture', description: '', typical_visit_duration_minutes: 75, lat: 42.13, lon: 23.34 },
    { name: 'Old Nessebar', category: 'Architecture', description: '', typical_visit_duration_minutes: 75, lat: 42.66, lon: 27.73 },
  ] });
  expect(result.itinerary.flatMap(day => day.stops.map(stop => stop.name)).sort()).toEqual([...input.must_visit_places!].sort());
  expect(result.itinerary).toHaveLength(3);
});

it('reports unresolved picks instead of returning an empty or incomplete itinerary', async () => {
  vi.mocked(locateSight).mockResolvedValue(null);
  await expect(runTravelAgent(input)).rejects.toThrow('Could not locate these selected places: Rila Monastery, Old Nessebar');
});
