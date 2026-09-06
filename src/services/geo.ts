/** Haversine distance in kilometers between two WGS84 points. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function nextWeekendStart(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSaturday);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDayTab(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
}

export function formatTripRange(
  start: string,
  end: string,
  flexible?: boolean,
): string {
  if (flexible) return 'Flexible dates';
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

export function minutesToLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}.${Math.round(m / 6)} hrs`;
}

export function paceStopsPerDay(pace: 'relaxed' | 'balanced' | 'packed'): number {
  if (pace === 'relaxed') return 4;
  if (pace === 'packed') return 8;
  return 6;
}

export function maxAcceptableDistanceKm(
  pace: 'relaxed' | 'balanced' | 'packed',
): number {
  if (pace === 'relaxed') return 20;
  if (pace === 'packed') return 40;
  return 30;
}
