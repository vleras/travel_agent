import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { loadEnv } from 'vite';
const env = loadEnv('development', process.cwd(), 'VITE_');
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
// Do not print provider errors containing request URLs or compiled modules.
console.error = () => {};
const report = console.log;
const liveFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await liveFetch(...args);
  if (!response.ok) report('PROVIDER_STATUS', new URL(args[0]).hostname, response.status);
  return response;
};
console.log = (...args) => { if (args[0] === 'PHOTO_RESULT') report(...args); };
console.info = () => {};
console.warn = () => {};
const { fetchPlacePhotoUrls, photoSourceFromUrl } = await import(moduleUrl('src/services/placePhotos.ts'));
const { locateSight } = await import(moduleUrl('src/services/sightLocation.ts'));
let failures = 0;
for (const [name, city, localName, wikipediaTitle] of [['Essen Cathedral','Essen','Essener Münster','Essen Minster'],['Old Synagogue Essen','Essen','Alte Synagoge','Old Synagogue (Essen)'],['RWE Tower','Essen','RWE-Turm','RWE Tower'],['Pyramid of Tirana','Tirana','Piramida e Tiranës','Pyramid of Tirana']]) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue;
  try {
    const point = await locateSight(name, city, 'high', localName, wikipediaTitle);
    let reported = false;
    const urls = await fetchPlacePhotoUrls(name, city, 'Architecture', point?.lat, point?.lon, { localName, wikipediaTitle, wikidataId: point?.wikidataId, limit: 1, onProgress: urls => { if (!reported && urls.length) { reported = true; console.log('PHOTO_RESULT', JSON.stringify({ name, stage: 'first-photo', point, photo: urls[0], source: photoSourceFromUrl(urls[0]) })); } } });
    const source = urls[0] ? photoSourceFromUrl(urls[0]) : null;
    const expectedFile = { 'Essen Cathedral': 'Essen_2011_66-2.jpg', 'Old Synagogue Essen': 'Alte_Synagoge_Essen_2014.jpg', 'RWE Tower': 'RWE-Turm_Essen,_abends.jpg', 'Pyramid of Tirana': 'Pyramid_of_Tirana_October_2023.jpg' }[name];
    const passed = Boolean(point && urls[0] && decodeURIComponent(urls[0]).includes(expectedFile) && /Wikipedia lead image|Wikidata main image/.test(source?.label ?? ''));
    if (!passed) failures++;
    console.log('PHOTO_RESULT', JSON.stringify({ name, point, photo: urls[0] ?? null, source, passed }));
  } catch { failures++; console.log('PHOTO_RESULT', JSON.stringify({ name, error: 'Lookup failed' })); }
}

process.exitCode = failures ? 1 : 0;
