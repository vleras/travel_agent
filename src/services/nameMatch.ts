/** Shared fuzzy name rules for photo lookup and geocoding validation. */

const STOPWORDS = new Set(['the', 'and', 'of', 'de', 'la', 'le', 'el', 'del', 'di', 'des', 'du', 'von']);

export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function distinctiveTokens(name: string): string[] {
  return fold(name.replace(/\s+/g, ' ').trim())
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
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
export function sameStem(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return a === b;
  const letters = (w: string) => w.replace(/y/g, 'i');
  const consonants = (w: string) => letters(w).replace(/[aeiou]/g, '');
  if (letters(a).slice(0, 4) === letters(b).slice(0, 4)) return true;
  const ca = consonants(a);
  const cb = consonants(b);
  return ca.length >= 4 && cb.length >= 4 && ca.slice(0, 4) === cb.slice(0, 4);
}

/** Number of the name's distinctive tokens that appear (whole or by stem) in `text`. */
function tokenHits(text: string, name: string): { hits: number; total: number } {
  const tokens = distinctiveTokens(name);
  const hay = fold(text);
  const list = words(text);
  const hits = tokens.filter((t) => hay.includes(t) || list.some((w) => sameStem(w, t))).length;
  return { hits, total: tokens.length };
}

/** Like mentionsPlace, but a token may also match by stem ("Piramida e Tiranës"). */
export function matchesName(text: string, name: string): boolean {
  const { hits, total } = tokenHits(text, name);
  if (!total) return false;
  return hits >= (total >= 3 ? total - 1 : total);
}

/** At least one distinctive token of the name appears in `text` (whole or by stem). */
export function sharesStem(text: string, name: string): boolean {
  return tokenHits(text, name).hits > 0;
}
