/**
 * Assign photos to alternating story layouts so we never stack the same
 * pattern twice (e.g. two full-width horizontals, or a pair of near-twins).
 *
 * Page pattern: hero → split (image+text) → reverse-split (text+image).
 * No side-by-side twin rows, no stacked full-bleed solos.
 */
export interface StoryPhotoPlan {
  /** Flat order for lightbox indexing */
  urls: string[];
  hero: string | null;
  /** Kept for API stability — always null (no twin horizontal row) */
  pair: [string, string] | null;
  pairIndices: [number, number] | null;
  /** Image + text row */
  split: string | null;
  splitIndex: number | null;
  /** Text + image (opposite side) */
  reverseSplit: string | null;
  reverseSplitIndex: number | null;
}

export function planStoryPhotos(photos: string[]): StoryPhotoPlan {
  const urls = photos.slice(0, 4);
  const hero = urls[0] ?? null;
  const split = urls[1] ?? null;
  const reverseSplit = urls[2] ?? null;

  return {
    urls,
    hero,
    pair: null,
    pairIndices: null,
    split,
    splitIndex: split ? 1 : null,
    reverseSplit,
    reverseSplitIndex: reverseSplit ? 2 : null,
  };
}
