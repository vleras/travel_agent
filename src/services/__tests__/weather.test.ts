import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWeatherForItinerary, weatherUnavailableMessage } from '../weather';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function historicalResponse(input: URL) {
  const start = input.searchParams.get('start_date')!;
  const end = Number(input.searchParams.get('end_date')!.slice(-2));
  return new Response(JSON.stringify({ daily: {
    time: Array.from({ length: end }, (_, i) => `${start.slice(0, 8)}${String(i + 1).padStart(2, '0')}`),
    temperature_2m_max: Array(end).fill(22), temperature_2m_min: Array(end).fill(12),
  } }));
}
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
  it('does not invent typical weather when history is unavailable', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await getWeatherForItinerary(51, 14, ['2027-07-01'])).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(weatherUnavailableMessage('2027-07-01')).toContain('Typical weather temporarily unavailable');
    expect(weatherUnavailableMessage('2027-07-01', true)).toContain('exact travel dates');
  });
  it('mixes forecasts and typical temperatures at the 16-day boundary and caches by month across years', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fetch = vi.fn(async (url: URL) => url.hostname === 'archive-api.open-meteo.com' ? historicalResponse(url) : new Response(JSON.stringify({ daily: { time: ['2026-10-14'], temperature_2m_max: [19], temperature_2m_min: [9], weather_code: [61] } })));
    vi.stubGlobal('fetch', fetch);
    const weather = await getWeatherForItinerary(53, 14, ['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(weather).toHaveLength(3);
    expect(weather[0]).toMatchObject({ date: '2026-10-14', condition: 'Rain', maxTemp: 19 });
    expect(weather[1]).toMatchObject({ date: '2026-10-15', kind: 'typical', condition: 'Typical (based on past years)', minTemp: 12, maxTemp: 22 });
    expect(fetch).toHaveBeenCalledTimes(11);
    expect((await getWeatherForItinerary(53, 14, ['2028-10-20']))[0].kind).toBe('typical');
    expect(fetch).toHaveBeenCalledTimes(11);
    // Simulate a page reload: module memory is gone, localStorage remains.
    vi.resetModules();
    const reloaded = await import('../weather');
    expect((await reloaded.getWeatherForItinerary(53, 14, ['2027-10-01']))[0].maxTemp).toBe(22);
    expect(fetch).toHaveBeenCalledTimes(11);
  });
  it('fetches separate months, deduplicates concurrent calls, and expires cached averages', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fetch = vi.fn(async (url: URL) => historicalResponse(url)); vi.stubGlobal('fetch', fetch);
    await Promise.all([getWeatherForItinerary(54, 14, ['2027-01-31', '2027-02-01']), getWeatherForItinerary(54, 14, ['2028-01-01'])]);
    expect(fetch).toHaveBeenCalledTimes(20);
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    await getWeatherForItinerary(54, 14, ['2027-01-01']);
    expect(fetch).toHaveBeenCalledTimes(30);
  });
  it('rejects sparse history rather than claiming a monthly average', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(JSON.stringify({ daily: { time: [url.searchParams.get('start_date')], temperature_2m_max: [22], temperature_2m_min: [12] } }))));
    expect(await getWeatherForItinerary(55, 14, ['2027-01-01'])).toEqual([]);
  });
  it('keeps planning available after a network failure', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    expect(await getWeatherForItinerary(52, 14, ['2026-09-30'])).toEqual([]);
  });
});
