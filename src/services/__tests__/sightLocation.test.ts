import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../nominatim', () => ({ geocode: vi.fn(async () => ({ result: {
  lat: 42.7, lon: 25.5, type: 'country', display_name: 'Bulgaria',
  boundingbox: ['41.2', '44.3', '22.3', '28.7'],
}, latencyMs: 0 })) }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('locates country-wide sights outside the city radius using destination bounds', async () => {
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    const center = url.searchParams.get('osm_tag') === 'place';
    return new Response(JSON.stringify({ features: [{
      geometry: { coordinates: center ? [25.5, 42.7] : [23.34, 42.13] },
      properties: center ? { osm_value: 'country' } : { name: 'Rila Monastery', osm_key: 'historic', osm_value: 'monastery', country: 'Bulgaria' },
    }] }));
  });
  vi.stubGlobal('fetch', fetch);
  const { locateSight } = await import('../sightLocation');
  expect(await locateSight('Rila Monastery', 'Bulgaria')).toMatchObject({ lat: 42.13, lon: 23.34 });
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('bbox')).toBe('22.3000,41.2000,28.7000,44.3000');
});

it('keeps city distance validation and retries failed lookups', async () => {
  let nearby = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [{
    geometry: { coordinates: nearby ? [14.42, 50.08] : [23.34, 42.13] },
    properties: { name: 'Test Monument', osm_key: 'historic', osm_value: 'monument' },
  }] }))));
  const { locateSight } = await import('../sightLocation');
  expect(await locateSight('Test Monument', 'Prague')).toBeNull();
  nearby = true;
  expect(await locateSight('Test Monument', 'Prague')).toMatchObject({ lat: 50.08, lon: 14.42 });
});
