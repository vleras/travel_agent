// Explains the differences between localization run 2 and run 3 (Ch6, 6.4).
// Between the two runs the only code change was the Tokyo centre (commit eeb6f44).
// For every place whose result differs, run 2's RECORDED service answers are replayed
// through the current lookup code, without network:
//   replay == run 3  -> the change comes from the code (the Tokyo centre)
//   replay == run 2  -> the change comes from the services (their answers differed)
// Usage: npx vite-node evaluation/replayLocalization.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'evaluation/output';

function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const split = (line: string) => {
    const cells: string[] = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur); return cells;
  };
  const head = split(lines[0]);
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

function km(a: number, b: number, c: number, d: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function replayOne(run: string, name: string, city: string) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(),
  };
  const places = JSON.parse(readFileSync(`${OUT}/localization_responses${run}.json`, 'utf8'));
  const place = places.find((p: any) => p.name === name);
  const requests = place.attempts[place.attempts.length - 1].requests;
  const strip = (u: string) => u.replace(/apiKey=[^&]*/, 'apiKey=***');
  const queryOf = (u: string) => decodeURIComponent((u.split(/[?&](?:q|text)=/)[1] ?? '').split('&')[0]).replace(/\+/g, ' ');
  (globalThis as any).fetch = async (input: any) => {
    const url = strip(String(input?.url ?? input));
    const hit = requests.find((q: any) => q.url === url)
      ?? requests.find((q: any) => q.url.split('?')[0] === url.split('?')[0] && queryOf(q.url) === queryOf(url));
    if (!hit) return new Response(JSON.stringify({ features: [] }), { status: 200 });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  const { locateSight } = await import('../src/services/sightLocation');
  const r: any = await locateSight(name, city);
  process.stdout.write(JSON.stringify(r ? { found: true, lat: r.lat, lon: r.lon } : { found: false }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--one') { await replayOne(args[1], args[2], args[3]); return; }
  const run2 = readCsv(`${OUT}/localization_results_run2.csv`);
  const run3 = new Map(readCsv(`${OUT}/localization_results.csv`).map(r => [r.name, r]));
  const rows: string[] = ['city,name,run2_found,run2_distance_m,run3_found,run3_distance_m,replay_found,replay_matches,cause'];
  for (const a of run2) {
    const b = run3.get(a.name)!;
    const same = a.found === b.found && a.within_threshold === b.within_threshold
      && Math.abs(Number(a.distance_m || 0) - Number(b.distance_m || 0)) < 1;
    if (same) continue;
    const out = execFileSync('npx', ['vite-node', 'evaluation/replayLocalization.ts', '--one', '_run2', a.name, a.city],
      { encoding: 'utf8', env: { ...process.env, VITE_GEOAPIFY_KEY: process.env.VITE_GEOAPIFY_KEY || 'replay' } });
    const rep = JSON.parse(out.slice(out.lastIndexOf('{')));
    const near = (r: Record<string, string>) => r.found === 'true' && rep.found
      && km(rep.lat, rep.lon, Number(r.found_lat), Number(r.found_lon)) < 0.002;
    const equals = (r: Record<string, string>) => (r.found !== 'true' && !rep.found) || near(r);
    const cause = equals(b) && !equals(a) ? 'qendra' : equals(a) && !equals(b) ? 'shërbimet' : 'e paqartë';
    rows.push([a.city, `"${a.name}"`, a.found, a.distance_m, b.found, b.distance_m, String(rep.found),
      equals(b) ? 'run3' : equals(a) ? 'run2' : 'asnjë', cause].join(','));
    console.log(`${a.city} | ${a.name}: ${cause}`);
  }
  mkdirSync(`${OUT}/analysis`, { recursive: true });
  writeFileSync(`${OUT}/analysis/localization_changes_run2_run3.csv`, rows.join('\n') + '\n');
  console.log(`changed places: ${rows.length - 1} -> ${OUT}/analysis/localization_changes_run2_run3.csv`);
}

main();
