/**
 * Coordinates from pasted text: plain "41.3275, 19.8187" or a full Google
 * Maps link (…/@41.32,19.81,17z, ?q=41.32,19.81, !3d41.32!4d19.81, ll=…).
 * Short links (maps.app.goo.gl) can't be expanded in the browser, so they
 * are reported separately.
 */

export type ParsedLocation =
  | { kind: 'coords'; lat: number; lon: number }
  | { kind: 'short-link' }
  | null;

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

function valid(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function parseLocationInput(text: string): ParsedLocation {
  const t = text.trim();
  if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(t)) return { kind: 'short-link' };

  const patterns = [
    // Place links carry the pin in !3d…!4d…; prefer it over the viewport @.
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`[?&](?:q|query|ll|destination|center)=${NUM},\\s*${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
    new RegExp(`^${NUM}\\s*[,;\\s]\\s*${NUM}$`),
  ];
  const decoded = (() => {
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  })();
  for (const re of patterns) {
    const m = decoded.match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (valid(lat, lon)) return { kind: 'coords', lat, lon };
  }
  return null;
}
