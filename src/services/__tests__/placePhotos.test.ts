import { describe, expect, it } from 'vitest';
import { imageFingerprint, isBadPhotoText } from '../placePhotos';

describe('isBadPhotoText', () => {
  it('rejects archive material', () => {
    for (const t of [
      'Old map of Tirana',
      'Historical photo of the square',
      'Vintage postcard, Parga',
      'Tirana black and white 1930',
      'Plan of the fortress',
      'Drawing of the castle',
      'Engraving (1800)',
    ]) expect(isBadPhotoText(t, 'Skanderbeg Square')).toBe(true);
  });

  it('keeps words that are part of the place name', () => {
    expect(isBadPhotoText('Old Bazaar, Mostar, 2019', 'Old Bazaar')).toBe(false);
  });

  it('keeps ordinary photos', () => {
    expect(isBadPhotoText('Skanderbeg Square 2016', 'Skanderbeg Square')).toBe(false);
    expect(isBadPhotoText('Planet Hollywood', 'Planet Hollywood')).toBe(false);
  });
});

describe('imageFingerprint', () => {
  it('treats a Commons original and its thumbnail as the same photo', () => {
    const original = 'https://upload.wikimedia.org/wikipedia/commons/8/86/Pyramid_of_Tirana_October_2023.jpg';
    const thumb =
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Pyramid_of_Tirana_October_2023.jpg/1920px-Pyramid_of_Tirana_October_2023.jpg?utm_source=x';
    expect(imageFingerprint(original)).toBe(imageFingerprint(thumb));
  });
});
