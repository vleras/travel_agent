/** Shared fuzzy name rules for photo lookup and geocoding validation. */

const STOPWORDS = new Set(['the', 'and', 'of', 'de', 'la', 'le', 'el', 'del', 'di', 'des', 'du', 'von']);

// Greek and Cyrillic → Latin, so local-script titles ("Κάστρο Πάργας") can
// share stems with English names ("Parga").
const TRANSLIT: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l',
  μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f',
  χ: 'ch', ψ: 'ps', ω: 'o',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u0370-\u03ff\u0400-\u04ff]/g, (ch) => TRANSLIT[ch] ?? ch);
}

/** Type words that many different places share ("Aktaia Boutique Hotel"). */
const GENERIC = new Set([
  'hotel', 'hotels', 'boutique', 'resort', 'suites', 'suite', 'apartments', 'apartment',
  'studios', 'rooms', 'villa', 'villas', 'inn', 'hostel', 'guesthouse', 'spa', 'residence',
]);

export function distinctiveTokens(name: string): string[] {
  const tokens = fold(name.replace(/\s+/g, ' ').trim())
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  // Generic type words only count when the name has nothing else.
  const specific = tokens.filter((t) => !GENERIC.has(t));
  return specific.length ? specific : tokens;
}

/**
 * Text must name this exact place: every distinctive word of the name (one may
 * be missing for long names). "Pyramid of Tirana" therefore rejects the Giza
 * pyramids.
 */
export function mentionsPlace(text: string, name: string): boolean {
  const tokens = distinctiveTokens(name);
  if (!tokens.length) return false;
  const hay = fold(text);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= (tokens.length >= 3 ? tokens.length - 1 : tokens.length);
}

/** Words of a text, accent-folded ("Skënderbej" → "skenderbej"). */
function words(text: string): string[] {
  return fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Do two words share a stem? First 4 letters with "y" as "i"
 * ("pyramid" ~ "piramida"), or the same first 4 consonants so vowel-shifted
 * local spellings still match ("skanderbeg" ~ "skenderbej").
 * Words shorter than 4 letters must match whole.
 */
export function sameStem(a: string, b: string, size = 4): boolean {
  if (a.length < 4 || b.length < 4) return a === b;
  // Longer stems allow for an inflected ending ("farka" ~ "farkës"): compare up
  // to `size` letters but at most the shorter word minus its last letter.
  const shorter = Math.min(a.length, b.length);
  const n = size > 4 ? Math.max(4, Math.min(size, shorter - 1)) : Math.min(size, shorter);
  const letters = (w: string) => w.replace(/y/g, 'i');
  const consonants = (w: string) => letters(w).replace(/[aeiou]/g, '');
  if (letters(a).slice(0, n) === letters(b).slice(0, n)) return true;
  const ca = consonants(a);
  const cb = consonants(b);
  const m = Math.min(size, 6);
  return ca.length >= m && cb.length >= m && ca.slice(0, m) === cb.slice(0, m);
}

/** Number of the name's distinctive tokens that appear (whole or by stem) in `text`. */
function tokenHits(text: string, name: string): { hits: number; total: number } {
  const tokens = distinctiveTokens(name);
  const hay = fold(text);
  const list = words(text);
  const hits = tokens.filter((t) => hay.includes(t) || list.some((w) => sameStem(w, t))).length;
  return { hits, total: tokens.length };
}

/** Words that say what kind of place it is; a match may leave them out ("Zoo Park" ~ "Tirana Zoo"). */
export const TYPE_WORDS = new Set([
  'mosque', 'church', 'cathedral', 'museum', 'gallery', 'square', 'street', 'park', 'castle',
  'fortress', 'bridge', 'tower', 'market', 'bazaar', 'palace', 'monument', 'memorial', 'lake',
  'national', 'center', 'centre', 'house', 'tomb', 'library', 'theatre', 'theater', 'garden',
  'gardens', 'beach', 'island', 'mountain', 'hill', 'old', 'new', 'grand', 'saint', 'district',
  'area', 'quarter', 'promenade', 'boulevard', 'avenue', 'road', 'zone', 'cable', 'car',
  'cableway', 'gondola', 'station', 'walk', 'tour', 'route', 'trail', 'viewpoint',
]);

/**
 * Like mentionsPlace, but a token may also match by stem ("Piramida e Tiranës").
 * - The city's own words are left out (the locator checks the city separately).
 * - Type words (museum, street, park…) are optional when the name has other words.
 * - Among the remaining words, a 3+ word name may miss one, but never its
 *   single longest, so "National Archaeological Museum" ≠ "National Historical Museum".
 */
export function matchesName(text: string, name: string, city?: string): boolean {
  const cityTokens = new Set(city ? distinctiveTokens(city) : []);
  const all = distinctiveTokens(name);
  const noCity = all.filter((t) => !cityTokens.has(t));
  const base = noCity.length ? noCity : all;
  const specific = base.filter((t) => !TYPE_WORDS.has(t));
  const tokens = specific.length ? specific : base;
  if (!tokens.length) return false;
  const hay = fold(text);
  const list = words(text);
  // A single specific word carries the whole match, so it needs a 6-letter stem
  // ("artisan" ≠ "artisti", "farka" ≠ "farkë").
  const size = tokens.length === 1 ? 6 : 4;
  const hit = (t: string) => hay.includes(t) || list.some((w) => sameStem(w, t, size));
  const missing = tokens.filter((t) => !hit(t));
  if (!missing.length) return true;
  if (tokens.length < 3 || missing.length > 1) return false;
  const longest = Math.max(...tokens.map((t) => t.length));
  const longestCount = tokens.filter((t) => t.length === longest).length;
  return missing[0].length < longest || longestCount > 1;
}

/** At least one distinctive token of the name appears in `text` (whole or by stem). */
export function sharesStem(text: string, name: string): boolean {
  return tokenHits(text, name).hits > 0;
}

/**
 * Strict version for a single word: a 6-letter stem ("kokonozi" ~ "kokonozit",
 * "skanderbeg" ~ "skenderbej" by consonants) so "artisan" ≠ "artisti".
 */
export function sharesStrongStem(text: string, word: string): boolean {
  const w = fold(word);
  return words(text).some((x) => x === w || sameStem(x, w, 6));
}
