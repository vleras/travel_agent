import { describe, expect, it } from 'vitest';
import { parseLocationInput } from '../parseLocation';

const LAT = 35.8974;
const LON = 14.5147;

function expectCoords(input: string, lat = LAT, lon = LON) {
  const parsed = parseLocationInput(input);
  expect(parsed?.kind).toBe('coords');
  if (parsed?.kind !== 'coords') return;
  expect(parsed.lat).toBeCloseTo(lat, 4);
  expect(parsed.lon).toBeCloseTo(lon, 4);
}

describe('parseLocationInput', () => {
  it('reads "lat, lon"', () => expectCoords('35.8974, 14.5147'));

  it('reads "lat lon" separated by a space', () => expectCoords('35.8974 14.5147'));

  it('reads labelled degrees with hemispheres', () =>
    expectCoords('Latitude: 35.8974° N, Longitude: 14.5147° E'));

  it('reads labelled values across bulleted lines', () => {
    expectCoords('• Latitude: 35.8974° N\n• Longitude: 14.5147° E');
    expectCoords('- Latitude: 35.8974° N\n  - Longitude: 14.5147° E\n');
  });

  it('reads compact hemisphere suffixes', () => expectCoords('35.8974°N 14.5147°E'));

  it('reads DMS', () => {
    // 35°53'50.6" = 35.89739, 14°30'52.9" = 14.51469
    expectCoords(`35°53'50.6"N 14°30'52.9"E`, 35.89739, 14.51469);
    expectCoords('35°53′50.6″N 14°30′52.9″E', 35.89739, 14.51469);
  });

  it('reads "lat … lng …"', () => {
    expectCoords('lat 35.8974 lng 14.5147');
    expectCoords('lat: 35.8974, lon: 14.5147');
  });

  it('makes S and W negative', () => {
    expectCoords('33.8688° S, 151.2093° E', -33.8688, 151.2093);
    expectCoords('40.7128°N 74.0060°W', 40.7128, -74.006);
    expectCoords(`22°54'30"S 43°11'47"W`, -22.90833, -43.19639);
  });

  it('accepts hemispheres in lon-first order', () => expectCoords('14.5147°E 35.8974°N'));

  it('keeps plain negative numbers', () => expectCoords('-33.8688, 151.2093', -33.8688, 151.2093));

  it('reads full Google Maps links', () => {
    expectCoords('https://www.google.com/maps/place/X/@35.89,14.51,17z/data=!3m1!4b1!4m6!3m5!8m2!3d35.8974!4d14.5147');
    expectCoords('https://maps.google.com/?q=35.8974,14.5147');
  });

  it('reports short links', () => {
    expect(parseLocationInput('https://maps.app.goo.gl/abc123')).toEqual({ kind: 'short-link' });
  });

  it('rejects names, out-of-range values and single numbers', () => {
    expect(parseLocationInput('Hotel Rogner')).toBeNull();
    expect(parseLocationInput('Rruga Myslym Shyri 12, Tirana')).toBeNull();
    expect(parseLocationInput('95.1, 14.5')).toBeNull();
    expect(parseLocationInput('35.8974')).toBeNull();
    expect(parseLocationInput(`35°61'00"N 14°30'00"E`)).toBeNull();
  });
});
