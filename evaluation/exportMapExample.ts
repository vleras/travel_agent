// Exports the map example of Ch6 (Figure 10): the same scenario split by list order (B2) and by the proposed method (P).
// Uses the app's own functions so the values match results_e1.csv exactly.
import { readFileSync, writeFileSync } from 'node:fs';
import { getFallbackAttractions } from '../src/data/fallbackAttractions';
import { compactnessScore, orderByDistanceFromBase, dayTotalDistance } from '../src/services/agent';

const sid = process.argv[2] ?? 'E1-rome-D3-balanced-r5';
const out = process.argv[3] ?? 'evaluation/output/analysis/map_example.json';
const scenarios = JSON.parse(readFileSync('evaluation/output/scenarios.json', 'utf8'));
const sc = scenarios.find((s: { id: string }) => s.id === sid);
const base = JSON.parse(readFileSync('evaluation/output/bases.json', 'utf8'))[sc.city];
const cityName: Record<string, string> = { rome: 'Rome', paris: 'Paris', barcelona: 'Barcelona', tokyo: 'Tokyo', bangkok: 'Bangkok' };
const byName = new Map(getFallbackAttractions(cityName[sc.city]).map(p => [p.name, p]));
const places = sc.names.map((n: string) => byName.get(n)!);
const proposed = JSON.parse(readFileSync('evaluation/output/proposed_checks.json', 'utf8'))
  .find((c: { scenario_id: string }) => c.scenario_id === sid).days.map((d: string[]) => d.map(n => byName.get(n)!));
let offset = 0; // same as consecutive() in runE1E2.ts
const listOrder = Array.from({ length: sc.D }, (_, i) => {
  const size = Math.floor(places.length / sc.D) + Number(i < places.length % sc.D);
  const group = places.slice(offset, offset + size); offset += size; return group;
});
const result: Record<string, unknown> = { scenario_id: sid, base, methods: {} };
for (const [name, days] of [['B2', listOrder], ['P', proposed]] as const) {
  (result.methods as Record<string, unknown>)[name] = days.map(day => {
    const ordered = orderByDistanceFromBase(day, base.lat, base.lon);
    return { stops: ordered.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })),
      K: compactnessScore(ordered, base.lat, base.lon, sc.pace), L: dayTotalDistance(ordered, base.lat, base.lon) };
  });
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log('map example written to', out);
