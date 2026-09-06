export const DAY_START_OPTIONS = [
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
] as const;

/** Quick food ideas the user can tap — they can also type anything. */
export const BREAKFAST_FOOD_SUGGESTIONS = [
  'Pastries / bakery',
  'Coffee & croissant',
  'Eggs / omelette',
  'Avocado toast',
  'Pancakes / brunch',
  'Hotel buffet',
  'Yogurt & fruit',
  'Local street breakfast',
] as const;

/** Parse free-text time like "8", "8:30", "8am", "08:30" → "HH:MM". */
export function parseFlexibleTime(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || /^(skip|none|no)$/i.test(trimmed)) return null;

  const ampm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? 0);
    const meridiem = ampm[3].replace(/\./g, '').toLowerCase();
    if (meridiem.startsWith('p') && h < 12) h += 12;
    if (meridiem.startsWith('a') && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const hm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2] ?? 0);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

/** Normalize breakfast time field: 'skip' or HH:MM. */
export function normalizeBreakfastTime(raw: string): string {
  if (!raw.trim() || /^skip$/i.test(raw.trim())) return 'skip';
  return parseFlexibleTime(raw) ?? 'skip';
}

/** Parse "4" or "3-5" / "3 to 5" into a day count (midpoint for ranges). */
export function parseDaysInput(
  raw: string,
): { days: number; range: [number, number] | null } | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const rangeMatch = trimmed.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a < 1 || b < 1 || a > 30 || b > 30) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return { days: Math.round((lo + hi) / 2), range: [lo, hi] };
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1 || n > 30) return null;
  return { days: Math.round(n), range: null };
}

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Stable photo URL for a place (Unsplash search-style via Lorem Flickr). */
export function placeImageUrl(name: string, city?: string): string {
  const tags = [name, city, 'travel']
    .filter(Boolean)
    .join(',')
    .replace(/[^a-zA-Z0-9,\s]/g, '')
    .replace(/\s+/g, ',');
  return `https://loremflickr.com/640/400/${encodeURIComponent(tags)}?lock=${hashString(name)}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100000;
}
