import type { DayWeather } from '../types';
import { isISODate, localToday } from './tripDates';

type Forecast = DayWeather & { date: string };
const cache = new Map<string, { expires: number; days: Forecast[] }>();
const pending = new Map<string, Promise<Forecast[]>>();

export function weatherCondition(code: number): [string, string] {
  if (code === 0) return ['Clear sky', '☀️'];
  if (code <= 3) return ['Partly cloudy', '⛅'];
  if (code === 45 || code === 48) return ['Fog', '🌫️'];
  if (code >= 51 && code <= 57) return ['Drizzle', '🌦️'];
  if (code >= 61 && code <= 67) return ['Rain', '🌧️'];
  if (code >= 71 && code <= 77) return ['Snow', '🌨️'];
  if (code >= 80 && code <= 82) return ['Rain showers', '🌦️'];
  if (code === 85 || code === 86) return ['Snow showers', '🌨️'];
  if (code >= 95 && code <= 99) return ['Thunderstorms', '⛈️'];
  return ['Weather conditions', '🌡️'];
}

/** Open-Meteo returns destination-local calendar dates; never match forecasts by array position. */
export async function getWeatherForItinerary(lat: number, lon: number, dates: string[]): Promise<Forecast[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  const today = localToday();
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 16);
  // Do not query distant trips. Leave one day of timezone tolerance and filter against provider dates below.
  if (!dates.some(date => isISODate(date) && date >= today && date <= horizon.toISOString().slice(0, 10))) return [];
  const key = `weather-v2|${lat.toFixed(3)}|${lon.toFixed(3)}|${today}`;
  const saved = cache.get(key);
  let days = saved && saved.expires > Date.now() ? saved.days : null;
  if (!days) {
    let work = pending.get(key);
    if (!work) {
      work = (async () => {
        try {
          const url = new URL('https://api.open-meteo.com/v1/forecast');
          url.search = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '16' }).toString();
          const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return [];
          const data = await response.json() as { daily?: { time?: string[]; weather_code?: (number | null)[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] } };
          const daily = data.daily;
          const forecasts = (daily?.time ?? []).flatMap((date, i): Forecast[] => {
            const max = daily?.temperature_2m_max?.[i];
            const min = daily?.temperature_2m_min?.[i];
            const code = daily?.weather_code?.[i];
            if (!isISODate(date) || typeof max !== 'number' || !Number.isFinite(max) || typeof min !== 'number' || !Number.isFinite(min) || typeof code !== 'number') return [];
            const [condition, icon] = weatherCondition(code);
            return [{ date, temperature: Math.round((max + min) / 2), minTemp: Math.round(min), maxTemp: Math.round(max), condition, icon }];
          });
          if (forecasts.length) cache.set(key, { days: forecasts, expires: Date.now() + 30 * 60 * 1000 });
          return forecasts;
        } catch { return []; }
        finally { pending.delete(key); }
      })();
      pending.set(key, work);
    }
    days = await work;
  }
  return days.filter(day => dates.includes(day.date));
}

export function weatherUnavailableMessage(date: string, flexible = false): string {
  if (flexible) return 'Add exact travel dates to see a forecast.';
  const daysAway = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${localToday()}T12:00:00Z`)) / 86400000);
  if (daysAway >= 16) return 'Forecast available closer to your trip, up to 16 days ahead.';
  if (daysAway < 0) return 'A forecast is no longer available for this past date.';
  return 'Forecast temporarily unavailable.';
}
