import type { DayWeather } from '../types';
import { isISODate, localToday } from './tripDates';

type DayData = DayWeather & { date: string };
const forecastCache = new Map<string, { expires: number; days: DayData[] }>();
const forecastPending = new Map<string, Promise<DayData[]>>();
type Estimate = { minTemp: number; maxTemp: number; rainProbability: number; expires: number };
const estimateCache = new Map<string, Estimate>();
const estimatePending = new Map<string, Promise<Estimate | null>>();
type Typical = { minTemp: number; maxTemp: number; rainShare: number; expires: number };
const typicalCache = new Map<string, Typical>();
const typicalPending = new Map<string, Promise<Typical | null>>();

async function getEstimate(lat: number, lon: number, date: string): Promise<Estimate | null> {
  const key = `weather-estimate-v1|${lat.toFixed(3)}|${lon.toFixed(3)}|${date}`;
  let saved = estimateCache.get(key);
  if (saved && saved.expires > Date.now()) return saved;
  const inFlight = estimatePending.get(key);
  if (inFlight) return inFlight;
  const work = (async () => {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability',
        timezone: 'auto',
        forecast_days: '46'
      }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const data = await response.json() as { daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; precipitation_probability?: (number | null)[] } };
      const daily = data.daily;
      if (!daily?.time) return null;
      const idx = daily.time.indexOf(date);
      if (idx < 0) return null;
      const max = daily.temperature_2m_max?.[idx];
      const min = daily.temperature_2m_min?.[idx];
      const rainProb = daily.precipitation_probability?.[idx];
      if (typeof max !== 'number' || !Number.isFinite(max) || typeof min !== 'number' || !Number.isFinite(min) || min > max) return null;
      const estimate = {
        minTemp: Math.round(min),
        maxTemp: Math.round(max),
        rainProbability: typeof rainProb === 'number' ? rainProb / 100 : 0,
        expires: Date.now() + 12 * 3600000,
      };
      estimateCache.set(key, estimate);
      return estimate;
    } catch { return null; }
    finally { estimatePending.delete(key); }
  })();
  estimatePending.set(key, work);
  try { return await work; } finally { estimatePending.delete(key); }
}

async function getTypicalWeather(lat: number, lon: number, month: string): Promise<Typical | null> {
  const lastYear = Number(localToday().slice(0, 4)) - 1;
  const key = `weather-typical-v1|${lat.toFixed(3)}|${lon.toFixed(3)}|${month}|${lastYear}`;
  let saved = typicalCache.get(key);
  if (!saved) {
    try { saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Typical | undefined; } catch { /* Storage may be unavailable. */ }
  }
  if (saved && saved.expires > Date.now() && Number.isFinite(saved.minTemp) && Number.isFinite(saved.maxTemp) && saved.minTemp <= saved.maxTemp) return saved;
  const inFlight = typicalPending.get(key);
  if (inFlight) return inFlight;
  const work = (async () => {
    // Use the same calendar month from ten complete years, with one consistent reanalysis model.
    const years = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      const year = lastYear - i;
      const endDay = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
      try {
        const url = new URL('https://archive-api.open-meteo.com/v1/archive');
        url.search = new URLSearchParams({ latitude: String(lat), longitude: String(lon), start_date: `${year}-${month}-01`, end_date: `${year}-${month}-${endDay}`, daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', models: 'era5' }).toString();
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) return [];
        const { daily } = await response.json() as { daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] } };
        const samples = (daily?.time ?? []).flatMap((date, index) => {
          const min = daily?.temperature_2m_min?.[index];
          const max = daily?.temperature_2m_max?.[index];
          return isISODate(date) && date.startsWith(`${year}-${month}-`) && typeof min === 'number' && Number.isFinite(min) && typeof max === 'number' && Number.isFinite(max) && min <= max ? [{ min, max }] : [];
        });
        return samples.length >= Math.ceil(endDay * 0.8) ? samples : [];
      } catch { return []; }
    }));
    // Avoid presenting a single year or sparse response as a long-term average.
    if (years.filter(samples => samples.length).length < 8) return null;
    const samples = years.flat();
    const typical = {
      minTemp: Math.round(samples.reduce((sum, day) => sum + day.min, 0) / samples.length),
      maxTemp: Math.round(samples.reduce((sum, day) => sum + day.max, 0) / samples.length),
      rainShare: 0,
      expires: Date.now() + 30 * 86400000,
    };
    typicalCache.set(key, typical);
    try { localStorage.setItem(key, JSON.stringify(typical)); } catch { /* Memory cache still works. */ }
    return typical;
  })();
  typicalPending.set(key, work);
  try { return await work; } finally { typicalPending.delete(key); }
}

export async function getWeatherForItinerary(lat: number, lon: number, dates: string[]): Promise<DayData[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  const today = localToday();
  const boundary16 = new Date(`${today}T12:00:00Z`);
  boundary16.setUTCDate(boundary16.getUTCDate() + 16);
  const boundary46 = new Date(`${today}T12:00:00Z`);
  boundary46.setUTCDate(boundary46.getUTCDate() + 46);
  const date16 = boundary16.toISOString().slice(0, 10);
  const date46 = boundary46.toISOString().slice(0, 10);
  const validDates = [...new Set(dates)].filter(date => isISODate(date) && date >= today);
  const tier1 = validDates.filter(date => date < date16);
  const tier2 = validDates.filter(date => date >= date16 && date < date46);
  const tier3 = validDates.filter(date => date >= date46);
  const months = [...new Set([...tier2, ...tier3].map(d => d.slice(5, 7)))];
  const [forecasts, estimates, typicalMonths] = await Promise.all([
    tier1.length ? getForecast(lat, lon, tier1) : Promise.resolve([]),
    tier2.length ? Promise.all(tier2.map(d => getEstimate(lat, lon, d))) : Promise.resolve([]),
    months.length ? Promise.all(months.map(m => getTypicalWeather(lat, lon, m).then(t => [m, t] as const))) : Promise.resolve([]),
  ]);
  const result = new Map(forecasts.map(day => [day.date, day]));
  const typicalByMonth = new Map(typicalMonths);
  for (let i = 0; i < tier2.length; i++) {
    const date = tier2[i];
    const est = estimates[i];
    if (est) {
      result.set(date, { date, kind: 'estimate', minTemp: est.minTemp, maxTemp: est.maxTemp, temperature: Math.round((est.minTemp + est.maxTemp) / 2), condition: est.rainProbability > 0.5 ? 'Estimate (chance of rain)' : 'Estimate', icon: est.rainProbability > 0.5 ? '🌧️' : '⛅' });
    } else {
      const typical = typicalByMonth.get(date.slice(5, 7));
      if (typical) result.set(date, { date, kind: 'typical', minTemp: typical.minTemp, maxTemp: typical.maxTemp, temperature: Math.round((typical.minTemp + typical.maxTemp) / 2), condition: 'Typical (based on past years)', icon: typical.rainShare > 0.5 ? '🌧️' : '⛅' });
    }
  }
  for (const date of tier3) {
    const typical = typicalByMonth.get(date.slice(5, 7));
    if (typical) result.set(date, { date, kind: 'typical', minTemp: typical.minTemp, maxTemp: typical.maxTemp, temperature: Math.round((typical.minTemp + typical.maxTemp) / 2), condition: 'Typical (based on past years)', icon: '🌡️' });
  }
  return validDates.flatMap(date => result.has(date) ? [result.get(date)!] : []);
}

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
async function getForecast(lat: number, lon: number, dates: string[]): Promise<DayData[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  const today = localToday();
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 16);
  // Do not query distant trips. Leave one day of timezone tolerance and filter against provider dates below.
  if (!dates.some(date => isISODate(date) && date >= today && date <= horizon.toISOString().slice(0, 10))) return [];
  const key = `weather-forecast-v2|${lat.toFixed(3)}|${lon.toFixed(3)}|${today}`;
  const saved = forecastCache.get(key);
  let days = saved && saved.expires > Date.now() ? saved.days : null;
  if (!days) {
    let work = forecastPending.get(key);
    if (!work) {
      work = (async () => {
        try {
          const url = new URL('https://api.open-meteo.com/v1/forecast');
          url.search = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '16' }).toString();
          const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return [];
          const data = await response.json() as { daily?: { time?: string[]; weather_code?: (number | null)[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] } };
          const daily = data.daily;
          const forecasts = (daily?.time ?? []).flatMap((date, i): DayData[] => {
            const max = daily?.temperature_2m_max?.[i];
            const min = daily?.temperature_2m_min?.[i];
            const code = daily?.weather_code?.[i];
            if (!isISODate(date) || typeof max !== 'number' || !Number.isFinite(max) || typeof min !== 'number' || !Number.isFinite(min) || typeof code !== 'number') return [];
            const [condition, icon] = weatherCondition(code);
            return [{ date, kind: 'forecast', temperature: Math.round((max + min) / 2), minTemp: Math.round(min), maxTemp: Math.round(max), condition, icon }];
          });
          if (forecasts.length) forecastCache.set(key, { days: forecasts, expires: Date.now() + 30 * 60 * 1000 });
          return forecasts;
        } catch { return []; }
        finally { forecastPending.delete(key); }
      })();
      forecastPending.set(key, work);
    }
    days = await work;
  }
  return days.filter(day => dates.includes(day.date));
}

export function weatherUnavailableMessage(date: string, flexible = false): string {
  if (flexible) return 'Add exact travel dates to see a forecast.';
  const daysAway = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${localToday()}T12:00:00Z`)) / 86400000);
  if (daysAway >= 16) return 'Weather data not available for this date.';
  if (daysAway < 0) return 'A forecast is no longer available for this past date.';
  return 'Forecast temporarily unavailable.';
}

export function clearWeatherCache(): void {
  forecastCache.clear();
  estimateCache.clear();
  typicalCache.clear();
}
