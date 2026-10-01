import { describe, expect, it, vi } from 'vitest';
import { geocodeHotel } from '../geocodeHotel';
import { locatePlaces } from '../sightLocation';

vi.mock('../sightLocation', () => ({
  cityCenter: vi.fn(async () => ({ lat: 35.8974, lon: 14.5147 })),
  reverseLabel: vi.fn(async () => 'Pinned hotel, Valletta'),
  locatePlaces: vi.fn(async () => []),
  locateArea: vi.fn(async () => null),
  isBigPlaceType: vi.fn(() => false),
  isRegionLevel: vi.fn(() => false),
}));
vi.mock('../nominatim', () => ({ geocodeMany: vi.fn(async () => []) }));

describe('hotel coordinate verification', () => {
  it('awaits parsed coordinates instead of treating them as a hotel name', async () => {
    expect(await geocodeHotel('35.8974, 14.5147', 'Valletta')).toMatchObject([
      { lat: 35.8974, lon: 14.5147, type: 'coordinates', approximate: false },
    ]);
    expect(locatePlaces).not.toHaveBeenCalled();
  });
  it('rejects coordinates beyond the destination distance limit', async () => {
    expect(await geocodeHotel('48.8566, 2.3522', 'Valletta')).toEqual([]);
  });
});
