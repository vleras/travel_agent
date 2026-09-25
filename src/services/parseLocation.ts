/**
 * Coordinates from pasted text, checked before any hotel name search.
 *
 * Accepts decimal pairs ("35.8974, 14.5147" or "35.8974 14.5147"), labelled
 * values ("Latitude: 35.8974° N, Longitude: 14.5147° E", also across bulleted
 * lines, or "lat 35.8974 lng 14.5147"), hemisphere letters ("35.8974°N
 * 14.5147°E"; S and W are negative), DMS ("35°53'50.6"N 14°30'52.9"E") and
 * full Google Maps links (…/@lat,lon, ?q=lat,lon, !3dlat!4dlon, ll=…).
 * Short links (maps.app.goo.gl) can't be expanded in the browser, so they are
 * reported separately.
 */

export type ParsedLocation =
  | { kind: 'coords'; lat: number; lon: number }
  | { kind: 'short-link' }
  | null;

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

function valid(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function coords(lat: number, lon: number): ParsedLocation {
  return valid(lat, lon) ? { kind: 'coords', lat, lon } : null;
}

/** Google Maps URLs carry the point in a few well-known places. */
function fromMapsLink(text: string): ParsedLocation {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* keep raw */
  }
  const patterns = [
    // Place links carry the pin in !3d…!4d…; prefer it over the viewport @.
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`[?&](?:q|query|ll|destination|center)=${NUM},\\s*${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m) return coords(parseFloat(m[1]), parseFloat(m[2]));
  }
  return null;
}

/**
 * Normalise free text: drop bullets and lat/lng labels, unify the various
 * degree/minute/second and quote characters, collapse whitespace.
 */
function normalise(text: string): string {
  return text
    .replace(/[′’´`]/g, "'") // prime, right quote, acute → '
    .replace(/[″”“]|''/g, '"') // double prime, curly quotes → "
    .replace(/[º˚]/g, '°')
    .replace(/^\s*(?:[>*•·–—]|-(?=\s))\s*/gm, ' ') // bullets at line starts (not a minus sign)
    .replace(/\b(?:latitude|longitude|lat|lng|lon|long)\b\s*[:=]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Part = { value: number; hemi?: string };

/** One coordinate: decimal or D°M'S", with an optional N/S/E/W on either side. */
const PART = new RegExp(
  [
    '([NSEW])?\\s*',
    '(-?\\d{1,3}(?:\\.\\d+)?)\\s*°?', // degrees
    `(?:\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*'`, // minutes
    `(?:\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*")?)?`, // seconds
    '\\s*([NSEW])?',
  ].join(''),
  'gi',
);

function readParts(text: string): Part[] {
  const parts: Part[] = [];
  for (const m of text.matchAll(PART)) {
    if (!m[2]) continue;
    const deg = parseFloat(m[2]);
    const min = m[3] ? parseFloat(m[3]) : 0;
    const sec = m[4] ? parseFloat(m[4]) : 0;
    if (min >= 60 || sec >= 60) return [];
    const sign = deg < 0 ? -1 : 1;
    const value = sign * (Math.abs(deg) + min / 60 + sec / 3600);
    parts.push({ value, hemi: (m[5] || m[1])?.toUpperCase() });
  }
  return parts;
}

function applyHemisphere({ value, hemi }: Part): number {
  return hemi === 'S' || hemi === 'W' ? -Math.abs(value) : value;
}

export function parseLocationInput(text: string): ParsedLocation {
  const t = text.trim();
  if (!t) return null;
  if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(t)) return { kind: 'short-link' };
  if (/https?:\/\//i.test(t)) return fromMapsLink(t);

  const clean = normalise(t);
  // Only digits, signs, separators, degree marks and hemisphere letters may be
  // left; anything else ("Hotel Rogner 5") is a name, not coordinates.
  if (!/^[\d\s.,;°'"+\-NSEW]+$/i.test(clean)) return null;

  const parts = readParts(clean.replace(/[,;]/g, ' '));
  if (parts.length !== 2) return null;
  let [a, b] = parts;
  // "14.5147°E 35.8974°N": hemisphere letters say which one is latitude.
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S')) [a, b] = [b, a];
  if (a.hemi && !'NS'.includes(a.hemi)) return null;
  if (b.hemi && !'EW'.includes(b.hemi)) return null;
  return coords(applyHemisphere(a), applyHemisphere(b));
}
