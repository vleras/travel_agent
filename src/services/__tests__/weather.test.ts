import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWeatherForItinerary, weatherUnavailableMessage } from '../weather';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('itinerary forecasts', () => {
  it('selects actual trip dates, ignores missing values, and caches by location', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ daily: { time: ['2026-09-29', '2026-09-30', '2026-10-01'], temperature_2m_max: [20, 17, null], temperature_2m_min: [10, 8, null], weather_code: [0, 61, null] } })));
    vi.stubGlobal('fetch', fetch);
    const weather = await getWeatherForItinerary(50, 14, ['2026-09-30', '2026-10-01']);
    expect(weather).toHaveLength(1);
    expect(weather[0]).toMatchObject({ date: '2026-09-30', minTemp: 8, maxTemp: 17, condition: 'Rain' });
    expect((await getWeatherForItinerary(50, 14, ['2026-09-29']))[0].maxTemp).toBe(20);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not invent forecasts for distant dates', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await getWeatherForItinerary(51, 14, ['2027-07-01'])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(weatherUnavailableMessage('2027-07-01')).toContain('closer');
    expect(weatherUnavailableMessage('2027-07-01', true)).toContain('exact travel dates');
  });
  it('keeps planning available after a network failure', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    expect(await getWeatherForItinerary(52, 14, ['2026-09-30'])).toEqual([]);
  });
});
