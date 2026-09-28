import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';
const env = {}; // Unit tests never use credentials or the network.
const modules = new Map();
function moduleUrl(path) {
  path = resolve(path);
  if (modules.has(path)) return modules.get(path);
  let code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/import\.meta\.env/g, JSON.stringify(env));
  code = code.replace(/from ['"](\.[^'"]+)['"]/g, (_, spec) => `from '${moduleUrl(resolve(dirname(path), spec.endsWith('.ts') ? spec : `${spec}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const requests = [];
let scenario = 'sorting';
const point = { lat: 51.456, lon: 7.014 };
const reply = data => new Response(JSON.stringify(data), { status: 200 });
globalThis.fetch = async input => {
  const u = new URL(input);
  requests.push(u);
  if (u.hostname === 'photon.komoot.io') {
    const q = u.searchParams.get('q');
    const feature = (name, lat) => ({ properties: { name, city: 'Essen', osm_key: 'tourism', osm_value: 'museum' }, geometry: { coordinates: [7.014, lat] } });
    return reply({ features: q === 'Essen' ? [feature('Essen', 51.456)] : scenario === 'sorting' ? [feature('Sample Gallery', 51.49), feature('Sample Gallery', 51.456), feature('Sample Gallery', 52.5)] : scenario === 'local' && q === 'Kunsthalle' ? [feature('Kunsthalle', 51.456)] : [] });
  }
  if (u.hostname === 'en.wikipedia.org') return reply({ query: { pages: [{ title: u.searchParams.get('titles'), pageimage: scenario === 'entity' ? undefined : 'Verified.jpg', pageprops: { wikibase_item: 'Q123' }, coordinates: [{ lat: scenario === 'distant' ? 48 : point.lat, lon: point.lon }] }] } });
  if (u.hostname === 'www.wikidata.org') return reply({ entities: { Q123: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: point.lat, longitude: point.lon } } } }], P18: [{ mainsnak: { datavalue: { value: scenario === 'entity' ? 'Entity.jpg' : 'VerifiedEntity.jpg' } } }] } } } });
  if (u.hostname === 'commons.wikimedia.org' && u.searchParams.get('titles')) {
    const title = u.searchParams.get('titles');
    return reply({ query: { pages: [{ title, imageinfo: [{ url: `https://upload.wikimedia.org/${title}`, mime: 'image/jpeg', width: 1400, height: 1800 }] }] } });
  }
  return reply({ query: { pages: [] }, results: [], features: [] });
};
const { locatePlaces, locateSight } = await import(moduleUrl('src/services/sightLocation.ts'));
const { fetchPlacePhotoUrls, photoSourceFromUrl } = await import(moduleUrl('src/services/placePhotos.ts'));
const sorted = await locatePlaces('Sample Gallery (Museum)', 'Essen');
assert.equal(sorted.length, 2);
assert.equal(sorted[0].lat, 51.456);
assert.equal(requests.find(u => u.hostname === 'photon.komoot.io' && u.searchParams.get('q') !== 'Essen').searchParams.get('q'), 'Sample Gallery');
scenario = 'local';
const local = await locateSight('Example Gallery (Art)', 'Essen', 'high', 'Kunsthalle [Museum]');
assert.equal(local?.lat, point.lat);
assert(requests.some(u => u.searchParams.get('q') === 'Kunsthalle'));
scenario = 'lead';
const lead = await fetchPlacePhotoUrls('Verified Monument', 'Essen', 'Architecture', point.lat, point.lon, { wikipediaTitle: 'Verified Monument', wikidataId: 'Q123' });
assert(lead[0]?.includes('Verified.jpg'));
assert(photoSourceFromUrl(lead[0]).label.includes('Wikipedia lead image'));
scenario = 'entity';
const entity = await fetchPlacePhotoUrls('Entity Monument', 'Essen', 'Architecture', point.lat, point.lon, { wikipediaTitle: 'Entity Monument' });
assert(entity[0]?.includes('Entity.jpg'));
assert(photoSourceFromUrl(entity[0]).label.includes('Wikidata main image'));
scenario = 'distant';
const start = requests.length;
const rejected = await fetchPlacePhotoUrls('Distant Monument', 'Essen', 'Architecture', point.lat, point.lon, { wikipediaTitle: 'Distant Monument' });
assert.equal(rejected.length, 0);
assert(!requests.slice(start).some(u => u.searchParams.get('ids') === 'Q123'));
console.log('PASS: bracket stripping, nearest match within 20 km, local-name fallback, portrait lead photo, article-to-Wikidata fallback, and rejection beyond 2 km.');
