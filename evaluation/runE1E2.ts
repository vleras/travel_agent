import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fallbackAttractions } from '../src/data/fallbackAttractions';
import { geocode } from '../src/services/nominatim';
import { haversineKm } from '../src/services/geo';
import { clusterByProximity, reviseClusters, distributeFoodPlaces, orderByDistanceFromBase, dayTotalDistance, compactnessScore, type ScoredAttraction } from '../src/services/agent';
import type { Pace } from '../src/types';

type Point = { lat: number; lon: number };
type Scenario = { id: string; experiment: 'E1' | 'E2'; city: string; D: number; pace: Pace; r?: number; names: string[]; key: string; duplicate_of: string | null };
const output = fileURLToPath(new URL('./output/', import.meta.url));
const citySizes = { rome: 22, paris: 21, barcelona: 19, tokyo: 18, bangkok: 18 };
const paces: Pace[] = ['relaxed', 'balanced', 'packed'];
const methods = ['P', 'B4', 'B1', 'B2', 'B3'] as const;
const startedAt = new Date().toISOString();
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function rng(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items], random = rng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function consecutive(items: ScoredAttraction[], D: number) {
  let offset = 0;
  return Array.from({ length: D }, (_, i) => {
    const size = Math.floor(items.length / D) + Number(i < items.length % D);
    const group = items.slice(offset, offset + size);
    offset += size;
    return group;
  });
}
const distance = (a: Point, b: Point) => haversineKm(a.lat, a.lon, b.lat, b.lon);
function kmeans(items: ScoredAttraction[], D: number, seed: number) {
  const random = rng(seed);
  const centers: Point[] = [{ ...items[Math.floor(random() * items.length)] }];
  while (centers.length < D) {
    const weights = items.map(p => Math.min(...centers.map(c => distance(p, c))) ** 2);
    const total = weights.reduce((a, b) => a + b, 0);
    let selected = 0;
    if (total > 0) {
      let target = random() * total;
      selected = weights.length - 1;
      for (let i = 0; i < weights.length; i++) {
        target -= weights[i];
        if (target < 0) { selected = i; break; }
      }
    } else selected = Math.floor(random() * items.length);
    centers.push({ ...items[selected] });
  }
  let previous: number[] = [];
  let groups: ScoredAttraction[][] = [];
  for (let iteration = 0; iteration < 50; iteration++) {
    const labels = items.map(p => {
      let best = 0;
      for (let c = 1; c < D; c++) if (distance(p, centers[c]) < distance(p, centers[best])) best = c;
      return best;
    });
    groups = Array.from({ length: D }, () => []);
    items.forEach((p, i) => groups[labels[i]].push(p));
    if (labels.every((label, i) => label === previous[i])) break;
    groups.forEach((g, i) => {
      if (g.length) centers[i] = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
      // Empty clusters retain their previous center; no forced rebalancing.
    });
    previous = labels;
  }
  return groups;
}
const contents = (days: ScoredAttraction[][]) => days.map(day => day.map(p => p.name));
const membership = (days: ScoredAttraction[][]) => JSON.stringify(contents(days).map(names => [...names].sort()));
function splitProposed(places: ScoredAttraction[], s: Scenario, base: Point, revise: boolean) {
  let start = performance.now();
  let days = clusterByProximity(places, s.D, s.pace, base.lat, base.lon);
  while (days.length < s.D) days.push([]);
  days = days.slice(0, s.D);
  let time = performance.now() - start;
  const beforeFood = membership(days);
  start = performance.now();
  days = distributeFoodPlaces(days, s.D);
  time += performance.now() - start;
  const foodChanged = beforeFood !== membership(days);
  const beforeRevision = membership(days);
  start = performance.now();
  const result = revise ? reviseClusters(days, base.lat, base.lon, s.pace) : { clusters: days, revisions: [] };
  time += performance.now() - start;
  return { days: result.clusters, revisions: result.revisions.length, changed: beforeRevision !== membership(result.clusters), foodChanged, time };
}
function ordered(days: ScoredAttraction[][], base: Point) {
  return days.map(day => orderByDistanceFromBase(day, base.lat, base.lon));
}
function metrics(days: ScoredAttraction[][], base: Point, pace: Pace, N: number) {
  const nonempty = days.filter(day => day.length);
  const K = nonempty.map(day => compactnessScore(day, base.lat, base.lon, pace));
  const L = days.map(day => dayTotalDistance(day, base.lat, base.lon));
  return {
    mean_K: K.reduce((a, b) => a + b, 0) / K.length,
    total_L: L.reduce((a, b) => a + b, 0), max_L: Math.max(...L),
    sigma: Math.sqrt(days.reduce((sum, day) => sum + (day.length - N / days.length) ** 2, 0) / days.length),
    pct_compact: K.filter(k => k >= 70).length / K.length,
    empty_days: days.length - nonempty.length,
  };
}
function writeJson(name: string, value: unknown) { writeFileSync(output + name, JSON.stringify(value, null, 2) + '\n'); }

async function main() {
  const lists: Record<string, ScoredAttraction[]> = {};
  for (const [city, size] of Object.entries(citySizes)) {
    assert.equal(fallbackAttractions[city].length, size);
    assert.equal(new Set(fallbackAttractions[city].map(p => p.name)).size, size);
    lists[city] = fallbackAttractions[city].map(p => {
      assert(Number.isFinite(p.lat) && Number.isFinite(p.lon));
      return { ...p, lat: p.lat!, lon: p.lon! };
    });
  }
  assert.equal(Object.values(lists).flat().length, 98);
  // The app guards unavailable localStorage. Ensure Node cannot reuse a persistent cache.
  assert.equal(typeof globalThis.localStorage, 'undefined', 'Run without Node localStorage enabled');
  const bases: Record<string, Point & { display_name: string; fetched_at: string }> = {};
  for (const city of Object.keys(citySizes)) {
    console.log(`Geocoding ${city} once through the app geocode() function…`);
    const originalFetch = globalThis.fetch;
    const responses: { status: number; body: string }[] = [];
    let transportError: string | undefined;
    globalThis.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        responses.push({ status: response.status, body: await response.clone().text() });
        return response;
      } catch (error) {
        transportError = String(error);
        throw error;
      }
    };
    let lookup: Awaited<ReturnType<typeof geocode>>;
    try { lookup = await geocode(city); }
    finally { globalThis.fetch = originalFetch; }
    const { result } = lookup;
    if (!result) console.error(JSON.stringify({ city, responses, transportError }, null, 2));
    assert(result && Number.isFinite(result.lat) && Number.isFinite(result.lon), `Live geocoding failed for ${city}; no fallback used`);
    bases[city] = { lat: result.lat, lon: result.lon, display_name: result.display_name, fetched_at: new Date().toISOString() };
  }
  mkdirSync(output, { recursive: true });
  writeJson('bases.json', bases);
  const scenarios: Scenario[] = [], first = new Map<string, string>();
  for (const experiment of ['E1', 'E2'] as const) for (const city of Object.keys(citySizes)) for (const D of [2, 3, 4, 5]) for (const pace of paces) {
    for (let r = 1; r <= (experiment === 'E1' ? 10 : 1); r++) {
      const list = lists[city];
      const picked = new Set(shuffle(list.map((_, i) => i), r).slice(0, Math.min(list.length, 4 * D)));
      const names = list.filter((_, i) => experiment === 'E2' || picked.has(i)).map(p => p.name);
      const id = `${experiment}-${city}-D${D}-${pace}${experiment === 'E1' ? `-r${r}` : ''}`;
      const key = `${city}|${D}|${pace}|${JSON.stringify([...names].sort())}`;
      scenarios.push({ id, experiment, city, D, pace, ...(experiment === 'E1' ? { r } : {}), names, key, duplicate_of: first.get(key) ?? null });
      if (!first.has(key)) first.set(key, id);
    }
  }
  assert.equal(scenarios.filter(s => s.experiment === 'E1').length, 600);
  assert.equal(scenarios.filter(s => s.experiment === 'E2').length, 60);
  writeJson('scenarios.json', scenarios);
  const rows: Record<string, string | number | boolean>[] = [];
  const checks: unknown[] = [];
  for (const s of scenarios) {
    const places = s.names.map(name => lists[s.city].find(p => p.name === name)!);
    const base = bases[s.city];
    for (const method of methods) {
      const runs = method === 'B1' || method === 'B3' ? 30 : 1;
      const measurements: ReturnType<typeof metrics>[] = [];
      let elapsed = 0, revisionCount: number | '' = '', changed: boolean | '' = '';
      for (let seed = 1; seed <= runs; seed++) {
        const t = performance.now();
        const result = method === 'P' || method === 'B4' ? splitProposed(places, s, base, method === 'P') : null;
        const days = result?.days ?? (method === 'B1' ? consecutive(shuffle(places, seed), s.D) : method === 'B2' ? consecutive(places, s.D) : kmeans(places, s.D, seed));
        elapsed += result ? result.time : performance.now() - t;
        assert.equal(days.length, s.D);
        assert.deepEqual(days.flat().map(p => p.name).sort(), [...s.names].sort());
        const sorted = ordered(days, base);
        measurements.push(metrics(sorted, base, s.pace, places.length));
        if (method === 'P') {
          const repeat = ordered(splitProposed(places, s, base, true).days, base);
          assert.deepEqual(contents(sorted), contents(repeat), `Determinism failed: ${s.id}`);
          revisionCount = result!.revisions;
          changed = result!.changed;
          checks.push({ scenario_id: s.id, deterministic: true, food_distribution_changed: result!.foodChanged, days: contents(sorted) });
          assert.equal(result!.foodChanged, false, `Unexpected food redistribution: ${s.id}`);
        }
      }
      const averages = Object.fromEntries(Object.keys(measurements[0]).map(key => [key, measurements.reduce((sum, m) => sum + m[key as keyof typeof m], 0) / runs]));
      rows.push({ scenario_id: s.id, experiment: s.experiment, city: s.city, D: s.D, pace: s.pace, r: s.r ?? '', duplicate_of: s.duplicate_of ?? '', method, ...averages, time_ms: elapsed / runs, revisions_count: revisionCount, split_changed_by_revision: changed });
    }
  }
  const columns = ['scenario_id','experiment','city','D','pace','r','duplicate_of','method','mean_K','total_L','max_L','sigma','pct_compact','empty_days','time_ms','revisions_count','split_changed_by_revision'];
  const csv = (value: unknown) => { const s = String(value); return /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };
  const counts = Object.fromEntries(['E1', 'E2'].map(exp => [exp, { scenarios: scenarios.filter(s => s.experiment === exp).length, duplicates: scenarios.filter(s => s.experiment === exp && s.duplicate_of).length }]));
  for (const exp of ['E1', 'E2']) {
    const selected = rows.filter(r => r.experiment === exp);
    assert.equal(selected.length, exp === 'E1' ? 3000 : 300);
    writeFileSync(output + `results_${exp.toLowerCase()}.csv`, columns.join(',') + '\n' + selected.map(row => columns.map(c => csv(row[c])).join(',')).join('\n') + '\n');
  }
  writeJson('proposed_checks.json', checks);
  const summary = ['E1', 'E2'].flatMap(experiment => methods.map(method => {
    const values = rows.filter(r => r.experiment === experiment && r.method === method).map(r => Number(r.mean_K)).sort((a,b) => a-b);
    return { experiment, method, median_mean_K: (values[values.length / 2 - 1] + values[values.length / 2]) / 2 };
  }));
  writeJson('run_meta.json', { started_at: startedAt, finished_at: new Date().toISOString(), git_commit: gitCommit, node: process.version, os: { platform: platform(), release: release(), arch: process.arch }, cpu: cpus()[0]?.model, logical_cpus: cpus().length, bases, determinism: { passed: true, scenarios_checked: checks.length }, counts, summary, protocol: { rng: 'mulberry32; Fisher-Yates shuffle', sampling_seeds: [1,10], baseline_seeds: [1,30], kmeans_max_iterations: 50, pct_compact_units: 'fraction 0..1', duplicate_scope: 'global, E1 before E2', timing: 'clusterByProximity + day padding + distributeFoodPlaces + reviseClusters (P only); excludes common final ordering, metrics, assertions, geocoding and file output', git_note: 'git_commit identifies the runner source commit; generated outputs are committed separately' } });
  console.log(JSON.stringify({ counts, determinism: 'PASS', bases, summary }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
