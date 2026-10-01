import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTripEmailBody, sendTripPlanEmail, googleMapsUrl } from '../tripEmail';
import type { DayItinerary, TripInput } from '../../types';

describe('tripEmail', () => {
  const mockBase = { lat: 48.8566, lon: 2.3522 }; // Paris

  const mockInput: TripInput = {
    destination_city: 'Paris',
    trip_length_days: 2,
    days_range: null,
    start_date: '2024-12-15',
    end_date: '2024-12-17',
    hotel_address: 'Hotel Le Marais',
    accommodation: null,
    suggested_area: null,
    interests: ['museums', 'art'],
    custom_preferences: null,
    must_visit_places: undefined,
    must_visit_attractions: undefined,
    pace: 'balanced',
    day_start_time: '09:00',
    breakfast_time: '08:00',
    breakfast_food: 'coffee',
  };

  const mockItinerary: DayItinerary[] = [
    {
      date: '2024-12-15',
      day_number: 1,
      stops: [
        {
          name: 'Louvre Museum',
          category: 'Museums',
          description: 'World\'s largest art museum',
          lat: 48.8606,
          lon: 2.3352,
          duration_min: 120,
          time_slot: '10:00',
          distance_to_next_km: 1.2,
        },
        {
          name: 'Café de Flore',
          category: 'Cafés',
          description: 'Iconic Parisian café',
          lat: 48.8542,
          lon: 2.3315,
          duration_min: 45,
          time_slot: '12:30',
          is_meal: true,
        },
      ],
      total_distance_km: 1.5,
      compactness_score: 85,
      hotel_distance_km: 0.8,
    },
    {
      date: '2024-12-16',
      day_number: 2,
      stops: [
        {
          name: 'Notre-Dame',
          category: 'Architecture',
          description: 'Historic cathedral',
          lat: 48.853,
          lon: 2.3499,
          duration_min: 60,
          time_slot: '09:00',
          distance_to_next_km: 0.5,
        },
      ],
      total_distance_km: 0.5,
      compactness_score: 95,
      hotel_distance_km: 0.3,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('googleMapsUrl', () => {
    it('generates correct Google Maps URL', () => {
      const url = googleMapsUrl({
        name: 'Louvre',
        lat: 48.8606,
        lon: 2.3352,
      });
      expect(url).toContain('google.com/maps/search');
      expect(url).toContain('48.8606');
      expect(url).toContain('2.3352');
    });
  });

  describe('sendTripPlanEmail', () => {
    it('rejects invalid email addresses', async () => {
      const result = await sendTripPlanEmail(
        'not-an-email',
        mockInput,
        mockItinerary,
        mockBase,
      );
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toContain('valid email');
    });

    it('handles missing email gracefully', async () => {
      const result = await sendTripPlanEmail(
        '   ',
        mockInput,
        mockItinerary,
        mockBase,
      );
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toContain('valid email');
    });

    it('sends the itinerary as FormData when the provider confirms success', async () => {
      const result = await sendTripPlanEmail(
        'test@example.com',
        mockInput,
        mockItinerary,
        mockBase,
      );
      expect(result.ok).toBe(true);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe('https://formsubmit.co/ajax/test%40example.com');
      const body = options?.body as FormData;
      expect(body.get('_subject')).toBe('Your 2-day plan for Paris');
      expect(body.has('name')).toBe(false);
      expect(body.has('message')).toBe(false);
      expect(body.get('Trip details')).toContain('Louvre');
    });
    it.each([false, 'false', undefined])('does not show success when HTTP 200 has success=%s', async success => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success, message: 'Confirm your email address first.' })));
      expect(await sendTripPlanEmail('test@example.com', mockInput, mockItinerary, mockBase)).toEqual({ ok: false, error: 'Confirm your email address first.' });
    });
    it('accepts the provider string success value', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: 'true' })));
      expect((await sendTripPlanEmail('test@example.com', mockInput, mockItinerary, mockBase)).ok).toBe(true);
    });
    it('handles a non-JSON provider response', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('<html>Service unavailable</html>'));
      expect((await sendTripPlanEmail('test@example.com', mockInput, mockItinerary, mockBase)).ok).toBe(false);
    });
  });

  describe('Email content', () => {
    it('includes trip header in email', () => {
      expect(buildTripEmailBody(mockInput, mockItinerary, mockBase)).toContain('Your trip to Paris');
    });

    it('includes daily itineraries', () => {
      const body = buildTripEmailBody(mockInput, mockItinerary, mockBase);
      expect(body).toContain('Day 1 (2024-12-15)');
      expect(body).toContain('Day 2 (2024-12-16)');
      expect(body).toContain('Notre-Dame');
    });
  });
});
