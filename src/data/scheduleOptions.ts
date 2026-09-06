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

/** Word forms for hours 1–12 (and informal variants). */
const HOUR_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

function padTime(h: number, m: number): string | null {
  if (h > 23 || m > 59 || h < 0 || m < 0) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function applyMeridiem(h: number, meridiem?: string | null): number {
  if (!meridiem) {
    // Bare morning hours stay as-is; 1–6 without am/pm → assume morning (am)
    // 7–11 stay as-is; 12 alone → noon if no am
    return h;
  }
  const m = meridiem.replace(/\./g, '').toLowerCase();
  if (m.startsWith('p') && h < 12) return h + 12;
  if (m.startsWith('a') && h === 12) return 0;
  return h;
}

function wordToHour(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n >= 0 && n <= 23 ? n : null;
  }
  return HOUR_WORDS[token] ?? null;
}

/**
 * Parse free-text time into "HH:MM".
 * Accepts: "8", "8:30", "8am", "8 thirty", "half past eight",
 * "quarter to nine", "quarter past 8", "around 9", "nine thirty am".
 */
export function parseFlexibleTime(raw: string): string | null {
  let text = raw
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');

  if (!text || /^(skip|none|no)$/i.test(text)) return null;

  // Strip soft fillers
  text = text
    .replace(/^(around|about|approx(?:imately)?|at|say)\s+/i, '')
    .replace(/\s+(o'?clock|oclock)$/i, '')
    .trim();

  // half past X / half past eight
  let m = text.match(
    /^half\s+past\s+(\d{1,2}|[a-z]+)(?:\s*(a\.?m\.?|p\.?m\.?))?$/,
  );
  if (m) {
    const h = wordToHour(m[1]);
    if (h == null) return null;
    return padTime(applyMeridiem(h, m[2]), 30);
  }

  // quarter past / quarter to
  m = text.match(
    /^quarter\s+(past|to)\s+(\d{1,2}|[a-z]+)(?:\s*(a\.?m\.?|p\.?m\.?))?$/,
  );
  if (m) {
    let h = wordToHour(m[2]);
    if (h == null) return null;
    h = applyMeridiem(h, m[3]);
    if (m[1] === 'past') return padTime(h, 15);
    // quarter to → previous hour :45
    const prev = (h + 23) % 24;
    return padTime(prev, 45);
  }

  // "8 thirty", "eight thirty", "9 fifteen am"
  m = text.match(
    /^(\d{1,2}|[a-z]+)\s+(thirty|fifteen|forty|fifty|twenty|ten|five|zero|oh|o)(?:\s*(a\.?m\.?|p\.?m\.?))?$/,
  );
  if (m) {
    let h = wordToHour(m[1]);
    const mins = MINUTE_WORDS[m[2]];
    if (h == null || mins == null) return null;
    h = applyMeridiem(h, m[3]);
    return padTime(h, mins);
  }

  // "8 30", "8 30am"
  m = text.match(/^(\d{1,2})\s+(\d{1,2})(?:\s*(a\.?m\.?|p\.?m\.?))?$/);
  if (m) {
    let h = Number(m[1]);
    const mins = Number(m[2]);
    h = applyMeridiem(h, m[3]);
    return padTime(h, mins);
  }

  // classic am/pm: 8am, 8:30pm, 8.30 am
  m = text.match(
    /^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i,
  );
  if (m) {
    const h = applyMeridiem(Number(m[1]), m[3]);
    const mins = Number(m[2] ?? 0);
    return padTime(h, mins);
  }

  // word hour alone: "nine", "nine am"
  m = text.match(/^([a-z]+)(?:\s*(a\.?m\.?|p\.?m\.?))?$/);
  if (m && HOUR_WORDS[m[1]] != null) {
    const h = applyMeridiem(HOUR_WORDS[m[1]], m[2]);
    return padTime(h, 0);
  }

  // HH:MM or H:MM or H
  m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (m) {
    return padTime(Number(m[1]), Number(m[2] ?? 0));
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
