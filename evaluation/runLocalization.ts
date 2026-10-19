import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform, release, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('./output/', import.meta.url));
const files = ['localization_results.csv', 'localization_responses.json', 'localization_meta.json'];
// Do not accidentally overwrite the evidence with a second run.
assert(files.every(name => !existsSync(output + name)), 'Localization output already exists; refusing to rerun.');
const mode = import.meta.env.MODE || 'development';
// Vite's loader preserves its .env/.env.local/mode files and process-env precedence.
const env = loadEnv(mode, root, '');
for (const [name, value] of Object.entries(env)) {
  if (name.startsWith('VITE_')) process.env[name] = value;
}
const keyNames = [...new Set(['VITE_GEOAPIFY_KEY', 'VITE_GEMINI_API_KEY', 'VITE_PEXELS_API_KEY', 'VITE_TOMTOM_KEY',
  ...Object.keys(env).filter(name => name.startsWith('VITE_') && /KEY|TOKEN|SECRET/i.test(name))])];
const keysPresent = Object.fromEntries(keyNames.map(name => [name, Boolean(env[name]?.trim())]));
const secrets = Object.entries(env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value)
  .flatMap(([, value]) => [value, encodeURIComponent(value)]).sort((a, b) => b.length - a.length);
function redact(text: string): string {
  for (const secret of secrets) text = text.split(secret).join('***');
  return text.replace(/([?&](?:api_?key|access_token|token)=)[^&\s"<>]*/gi, '$1***')
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, '***');
}
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(String(key)) ?? null,
  setItem: (key: string, value: string) => { store.set(String(key), String(value)); },
  removeItem: (key: string) => { store.delete(String(key)); },
  clear: () => store.clear(),
} });
assert.equal(store.size, 0);
// Import the real lookup only after the empty storage and Vite env are installed.
const { locateSight } = await import('../src/services/sightLocation');
const { fallbackAttractions } = await import('../src/data/fallbackAttractions');
const { haversineKm } = await import('../src/services/geo');
const areas = new Set([
  'Trastevere Food Walk', 'Villa Borghese Gardens', 'Testaccio Market', 'Appian Way Park',
  'Jewish Ghetto & Tiber Island', 'Ostiense Street Art', 'Monti Neighborhood',
  'Latin Quarter Food Walk', 'Jardin du Luxembourg', 'Le Marais', 'Canal Saint-Martin',
  'Rue Cler Market Street', 'Père Lachaise Cemetery', 'Belleville Viewpoint', 'Gothic Quarter',
  'Barceloneta Beach', 'El Born Tapas Crawl', 'Gràcia Neighborhood', 'Ciutadella Park', 'Port Vell',
  'Tsukiji Outer Market', 'Akihabara Electric Town', 'Ginza', 'Ueno Park & Museums',
  'Harajuku Takeshita Street', 'Imperial Palace East Gardens', 'Omoide Yokocho', 'Yanaka Ginza',
  'Koenji Vintage District', 'Sumida River Cruise', 'Nakameguro Canal', 'Chatuchak Weekend Market',
  'Yaowarat Chinatown', 'Lumphini Park', 'Flower Market (Pak Khlong Talat)', 'Ayutthaya Day Trip Hub',
  'Thonglor Cafés', 'Benjakitti Park', 'Talad Noi Heritage Walk',
]);
const noArticle = new Set(["Caffè Sant'Eustachio", 'Roscioli Salumeria', 'Seine River Cruise']);
const excursions = new Set(['Ayutthaya Day Trip Hub', 'Damnoen Saduak Floating Market']);
const cities: Record<string, string> = { rome: 'Rome', paris: 'Paris', barcelona: 'Barcelona', tokyo: 'Tokyo', bangkok: 'Bangkok' };
const names = Object.values(fallbackAttractions).flat().map(place => place.name);
assert.equal(names.length, 98);
assert.equal(new Set(names).size, 98);
assert.equal(areas.size, 39);
assert.equal(noArticle.size, 3);
for (const name of [...areas, ...noArticle, ...excursions]) assert(names.includes(name), `Unknown appendix name: ${name}`);
for (const list of Object.values(fallbackAttractions)) for (const place of list) {
  assert(Number.isFinite(place.lat) && Number.isFinite(place.lon), `Missing reference: ${place.name}`);
}

type RequestRecord = { url: string; started_at: string; status: number | null; body: string | null; error?: string; body_error?: string };
type PlaceRecord = { city: string; nr: number; name: string; requests: RequestRecord[]; lookup_error?: string };
const responses: PlaceRecord[] = [];
const rows: Record<string, string | number | boolean>[] = [];
let active: PlaceRecord | undefined;
let bodyReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert(active, 'Request outside a place lookup');
  const record: RequestRecord = { url: redact(input instanceof Request ? input.url : String(input)),
    started_at: new Date().toISOString(), status: null, body: null };
  active.requests.push(record);
  try {
    const response = await originalFetch(input, init);
    record.status = response.status;
    bodyReads.push(response.clone().text().then(body => { record.body = redact(body); })
      .catch(error => { record.body_error = redact(String(error)); }));
    return response;
  } catch (error) {
    record.error = redact(String(error));
    throw error;
  }
};
function matchedService(point: { lat: number; lon: number } | null, requests: RequestRecord[]): string {
  if (!point) return '';
  // locateSight omits provider. Attribute only when the final successful provider's
  // recorded body contains the exact coordinates returned by the real lookup.
  const request = requests.filter(r => r.status != null && r.status >= 200 && r.status < 300).at(-1);
  if (!request?.body) return '';
  try {
    const data = JSON.parse(request.body);
    const host = new URL(request.url).hostname;
    const points: { lat: number; lon: number }[] = host === 'photon.komoot.io'
      ? (data.features ?? []).map((f: { geometry?: { coordinates?: number[] } }) => ({ lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] }))
      : host === 'api.geoapify.com'
        ? (data.features ?? []).map((f: { properties: { lat: number; lon: number } }) => f.properties)
        : host === 'nominatim.openstreetmap.org' && Array.isArray(data)
          ? data.map(p => ({ lat: Number(p.lat), lon: Number(p.lon) })) : [];
    if (!points.some(p => p.lat === point.lat && p.lon === point.lon)) return '';
    return host === 'photon.komoot.io' ? 'photon' : host === 'api.geoapify.com' ? 'geoapify' : 'nominatim';
  } catch { return ''; }
}
const startedAt = new Date().toISOString();
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
try {
  for (const [cityKey, city] of Object.entries(cities)) {
    for (const [index, place] of fallbackAttractions[cityKey].entries()) {
      active = { city, nr: index + 1, name: place.name, requests: [] };
      responses.push(active);
      bodyReads = [];
      const started = performance.now();
      let point: Awaited<ReturnType<typeof locateSight>> = null;
      try { point = await locateSight(place.name, city); }
      catch (error) { active.lookup_error = redact(String(error)); }
      const duration = performance.now() - started;
      await Promise.all(bodyReads);
      const type = noArticle.has(place.name) ? 'Pa artikull' : areas.has(place.name) ? 'Zonë' : 'Atraksion';
      const threshold = type === 'Pa artikull' ? '' : type === 'Zonë' ? 1000 : 300;
      const distance = point ? haversineKm(place.lat!, place.lon!, point.lat, point.lon) * 1000 : null;
      rows.push({ city, nr: index + 1, name: place.name, type, excursion: excursions.has(place.name),
        ref_lat: place.lat!, ref_lon: place.lon!, found: point !== null, found_lat: point?.lat ?? '', found_lon: point?.lon ?? '',
        distance_m: distance ?? '', threshold_m: threshold,
        within_threshold: distance !== null && threshold !== '' ? distance <= threshold : '',
        matched_service: matchedService(point, active.requests), duration_ms: duration });
      console.log(`[localization] ${rows.length}/98 ${city}: ${place.name}: ${point ? 'found' : 'not found'}`);
    }
  }
} finally { globalThis.fetch = originalFetch; }
assert.equal(rows.length, 98);
const requests = responses.flatMap(p => p.requests);
const countType = (type: string) => ({ total: rows.filter(r => r.type === type).length,
  found: rows.filter(r => r.type === type && r.found).length,
  within_threshold: rows.filter(r => r.type === type && r.within_threshold === true).length });
const meta = {
  started_at: startedAt, ended_at: new Date().toISOString(), git_commit: gitCommit,
  runner_sha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  node_version: process.version, os: { platform: platform(), release: release(), arch: arch() }, mode,
  keys_present: keysPresent,
  protocol: { input: 'locateSight(name, cityName), two arguments only; all 98 entries including Beach',
    city_order: Object.values(cities), place_order: 'original curated list order within each city; nr is 1-based per city',
    cache: 'fresh process and initially empty in-memory localStorage; app caches and anchors accumulate during the run',
    city_centers: 'unmodified app cityCenter; uses built-in table for these five cities',
    retries: 'no runner retries; app Photon 429/503 retries and original timeouts/queues retained',
    classification: 'user-supplied thesis appendix; Pa artikull looked up but excluded from threshold checks',
    matched_service: 'final successful recorded response must contain returned coordinates; otherwise empty',
    duration: 'locateSight wall time, including app queues/retries; excludes response-clone drain and output',
  },
  summary: { total: rows.length, found: rows.filter(r => r.found).length, requests: requests.length,
    http_errors: requests.filter(r => r.status !== null && r.status >= 400).length,
    rate_limit_responses: requests.filter(r => r.status === 429).length,
    network_errors: requests.filter(r => r.error).length,
    body_read_errors: requests.filter(r => r.body_error).length,
    lookup_errors: responses.filter(r => r.lookup_error).length,
    by_type: { Atraksion: countType('Atraksion'), 'Zonë': countType('Zonë'), 'Pa artikull': countType('Pa artikull') },
    excursions: rows.filter(r => r.excursion).map(r => ({ name: r.name, found: r.found })),
  },
};
const columns = ['city','nr','name','type','excursion','ref_lat','ref_lon','found','found_lat','found_lon','distance_m','threshold_m','within_threshold','matched_service','duration_ms'];
const csv = (value: unknown) => '"' + String(value).replaceAll('"', '""') + '"';
mkdirSync(output, { recursive: true });
writeFileSync(output + files[0], [columns.join(','), ...rows.map(row => columns.map(c => csv(row[c])).join(','))].join('\n') + '\n');
writeFileSync(output + files[1], redact(JSON.stringify(responses, null, 2)) + '\n');
writeFileSync(output + files[2], JSON.stringify(meta, null, 2) + '\n');
console.log(JSON.stringify(meta, null, 2));
