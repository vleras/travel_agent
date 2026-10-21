"""Analysis for Chapter 6 (Rezultatet).

Regenerates every table, figure and number reported in Chapter 6 from the files in
evaluation/output/. Run from the repository root:

    pip install -r evaluation/requirements.txt
    python3 evaluation/analyze.py            # all steps
    python3 evaluation/analyze.py --no-map   # skip the map example (needs Node + internet for tiles)

Outputs go to evaluation/output/analysis/.
Localization: run 3 (after the Tokyo centre fix) is the main result; run 2 is compared and wrong matches are
traced (see evaluation/replayLocalization.ts for the cause of each change).
Method (Ch4 4.10): 516 distinct E1 scenarios (identical scenarios counted once), paired two-sided
Wilcoxon signed-rank tests on mean compactness per scenario, alpha = 0.05, pairs with zero difference
dropped, Holm correction within each hypothesis over all its tests (H1: 4, H2: 2, H3: 36).
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'evaluation' / 'output'
AN = OUT / 'analysis'
EPS = 1e-9
METHODS = ['P', 'B4', 'B3', 'B2', 'B1']
NAMES = {'P': 'Metoda e propozuar', 'B4': 'Ndarja pa rishikim', 'B3': 'k-means++',
         'B2': 'Ndarja sipas renditjes së vendeve në listë', 'B1': 'Ndarja rastësore'}
USER_AGENT = 'travel_agent-thesis/1.0 (+https://github.com/vleras/travel_agent)'
summary: list[str] = []


def say(line: str = '') -> None:
    print(line)
    summary.append(line)


def holm(pvalues) -> np.ndarray:
    p = np.asarray(pvalues, dtype=float)
    order = np.argsort(p)
    adjusted = np.empty_like(p)
    running = 0.0
    for k, i in enumerate(order):
        running = max(running, (len(p) - k) * p[i])
        adjusted[i] = min(1.0, running)
    return adjusted


def paired(a: pd.Series, b: pd.Series) -> dict:
    diff = (a - b).astype(float)
    nonzero = diff[diff.abs() > EPS]
    p = wilcoxon(nonzero).pvalue if len(nonzero) else 1.0
    return dict(better=int((diff > EPS).sum()), equal=int((diff.abs() <= EPS).sum()),
                worse=int((diff < -EPS).sum()), n_nonzero=len(nonzero),
                median_diff=float(diff.median()),
                median_diff_nonzero=float(nonzero.median()) if len(nonzero) else 0.0, p=float(p))


def is_true(series: pd.Series) -> pd.Series:
    return series.astype(str).str.lower().eq('true')


def describe(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for m in METHODS:
        x = df[df.method == m]
        rows.append({'metoda': NAMES[m], 'K_mesatare': x.mean_K.mean(), 'K_mediana': x.mean_K.median(),
                     'L_totale_km': x.total_L.mean(), 'L_max_mesatare_km': x.max_L.mean(),
                     'L_max_mediana_km': x.max_L.median(), 'sigma': x.sigma.mean(),
                     'dite_kompakte_pct': 100 * x.pct_compact.mean(),
                     'koha_mediana_ms': x.time_ms.median(), 'koha_max_ms': x.time_ms.max()})
    return pd.DataFrame(rows)


def e1(d1: pd.DataFrame) -> pd.DataFrame:
    dup = d1[(d1.method == 'P') & d1.duplicate_of.notna()]
    say(f'## E1: {d1.scenario_id.nunique()} scenarios, {len(dup)} duplicates, '
        f'{d1.scenario_id.nunique() - len(dup)} distinct')
    say('duplicates by city/D: ' + str(dup.groupby(['city', 'D']).size().to_dict()))
    dist = d1[d1.duplicate_of.isna()]
    table = describe(dist)
    table.round(2).to_csv(AN / 'e1_table.csv', index=False)
    say(table.round(2).to_string(index=False))
    by_city = dist.pivot_table(index='city', columns='method', values=['mean_K', 'max_L'], aggfunc='mean').round(1)
    by_city.to_csv(AN / 'e1_by_city.csv')
    say('E1 by city (mean): ' + str(by_city.to_dict()))
    return dist


def figure_compactness(dist: pd.DataFrame) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    labels = {'P': 'Metoda e\npropozuar', 'B4': 'Ndarja pa\nrishikim', 'B3': 'k-means++',
              'B2': 'Ndarja sipas\nrenditjes së\nvendeve në listë', 'B1': 'Ndarja\nrastësore'}
    data = [dist[dist.method == m].mean_K.values for m in METHODS]
    fig, ax = plt.subplots(figsize=(7.2, 3.6), dpi=200)
    bp = ax.boxplot(data, patch_artist=True, widths=0.55, showmeans=True,
                    meanprops=dict(marker='D', markerfacecolor='white', markeredgecolor='black', markersize=4),
                    medianprops=dict(color='black'), flierprops=dict(marker='o', markersize=2, alpha=0.4))
    for i, box in enumerate(bp['boxes']):
        box.set_facecolor('#2F5496' if i == 0 else '#D9E2F3')
        box.set_edgecolor('#404040')
    ax.set_xticks(range(1, 6))
    ax.set_xticklabels([labels[m] for m in METHODS], fontsize=8.5)
    ax.set_ylabel(r'Kompaktësia mesatare $\bar{K}$ e skenarit', fontsize=8.5)
    ax.set_ylim(0, 100)
    ax.grid(axis='y', alpha=0.3)
    ax.tick_params(axis='y', labelsize=8)
    for i, m in enumerate(METHODS, 1):
        ax.text(i, 95, f'{dist[dist.method == m].mean_K.mean():.1f}'.replace('.', ','), ha='center', fontsize=8)
    plt.tight_layout()
    plt.savefig(AN / 'fig9_kompaktesia_E1.png')
    plt.close(fig)


def hypotheses(dist: pd.DataFrame) -> None:
    K = dist.pivot(index='scenario_id', columns='method', values='mean_K')
    S = dist.pivot(index='scenario_id', columns='method', values='sigma')
    rows = []
    # Holm within each hypothesis over ALL its tests (Ch4 4.10): H1 = 3 tests on K + sigma vs k-means++,
    # H2 = K + sigma vs no revision. For sigma, "better" means P has the lower sigma.
    h1 = [dict(hypothesis='H1', baseline=NAMES[b], metric='K', **paired(K.P, K[b])) for b in ['B1', 'B2', 'B3']]
    h1.append(dict(hypothesis='H1 plotësuese', baseline=NAMES['B3'], metric='sigma', **paired(S.B3, S.P)))
    for row, p in zip(h1, holm([r['p'] for r in h1])):
        row['p_holm'] = p
    h2 = [dict(hypothesis='H2', baseline=NAMES['B4'], metric='K', **paired(K.P, K.B4)),
          dict(hypothesis='H2 plotësuese', baseline=NAMES['B4'], metric='sigma', **paired(S.B4, S.P))]
    for row, p in zip(h2, holm([r['p'] for r in h2])):
        row['p_holm'] = p
    rows = h1 + h2
    h2 = h2[0]
    table = pd.DataFrame(rows)
    table.to_csv(AN / 'h1_h2.csv', index=False)
    P = dist[dist.method == 'P'].set_index('scenario_id')
    changed = int(is_true(P.split_changed_by_revision).sum())
    say('\n## H1 and H2 (sigma rows: "better" = P has lower sigma)')
    say(table[['hypothesis', 'baseline', 'metric', 'better', 'equal', 'worse', 'median_diff',
               'median_diff_nonzero', 'p', 'p_holm']].to_string(index=False))
    say(f'revision changed the split in {changed} of {len(P)} scenarios; '
        f'K changed in {h2["n_nonzero"]}; K lower with revision in {h2["worse"]}')


def h3(dist: pd.DataFrame) -> None:
    K = dist.pivot(index='scenario_id', columns='method', values='mean_K')
    meta = dist[dist.method == 'P'].set_index('scenario_id')[['city', 'D', 'pace']]
    K = K.join(meta)
    groups = [('ritmi', v) for v in ['relaxed', 'balanced', 'packed']] + \
             [('ditet', v) for v in [2, 3, 4, 5]] + \
             [('qyteti', v) for v in ['rome', 'paris', 'barcelona', 'tokyo', 'bangkok']]
    column = {'ritmi': 'pace', 'ditet': 'D', 'qyteti': 'city'}
    rows = []
    for kind, value in groups:
        g = K[K[column[kind]] == value]
        for b in ['B1', 'B2', 'B3']:
            rows.append(dict(subgroup=kind, value=value, baseline=NAMES[b], n=len(g), **paired(g.P, g[b])))
    table = pd.DataFrame(rows)
    table['p_holm'] = holm(table.p.values)
    table['significant_in_favour'] = (table.p_holm < 0.05) & (table.median_diff > 0)
    table.to_csv(AN / 'h3.csv', index=False)
    ok = table.groupby(['subgroup', 'value'], sort=False).significant_in_favour.all()
    say(f'\n## H3: {int(ok.sum())} of {len(ok)} subgroups meet the criterion (Holm over {len(table)} tests)')
    say(table[['subgroup', 'value', 'baseline', 'n', 'better', 'worse', 'median_diff', 'p_holm']]
        .round(4).to_string(index=False))


def e2(d2: pd.DataFrame) -> None:
    # Duplicates are flagged globally (E2 copies of E1 scenarios); within E2 all 60 are distinct.
    say(f'\n## E2: {d2.scenario_id.nunique()} scenarios (all used; descriptive only)')
    table = describe(d2)
    table.round(2).to_csv(AN / 'e2_table.csv', index=False)
    say(table.round(2).to_string(index=False))
    by_city = d2.pivot_table(index='city', columns='method', values=['mean_K', 'max_L'], aggfunc='mean').round(1)
    by_city.to_csv(AN / 'e2_by_city.csv')
    say('E2 by city (mean): ' + str(by_city.to_dict()))
    K = d2.pivot(index='scenario_id', columns='method', values='mean_K')
    for b in ['B1', 'B2', 'B3', 'B4']:
        diff = K.P - K[b]
        say(f'P vs {NAMES[b]}: better {int((diff > EPS).sum())} / equal {int((diff.abs() <= EPS).sum())} '
            f'/ worse {int((diff < -EPS).sum())}')
    P = d2[d2.method == 'P']
    say(f'revision changed the split in {int(is_true(P.split_changed_by_revision).sum())} of {len(P)}; '
        f'moves in total: {int(P.revisions_count.sum())}')


def kj7_kj3(dist: pd.DataFrame, d2: pd.DataFrame) -> None:
    rows = []
    for label, df in [('E1', dist), ('E2', d2)]:
        for m, what in [('B4', 'ndarja'), ('P', 'ndarja + rishikimi')]:
            t = df[df.method == m].time_ms
            rows.append(dict(experiment=label, step=what, median_ms=t.median(), p95_ms=t.quantile(0.95), max_ms=t.max()))
    table = pd.DataFrame(rows)
    table.round(3).to_csv(AN / 'kj7_time.csv', index=False)
    meta = json.loads((OUT / 'run_meta.json').read_text())
    say('\n## KJ7 (time per scenario) and KJ3')
    say(f"machine: {meta.get('cpu')}, {meta.get('os')}, Node {meta.get('node')}")
    say(table.round(3).to_string(index=False))
    checks = json.loads((OUT / 'proposed_checks.json').read_text())
    deterministic = sum(1 for c in checks if c.get('deterministic') is True)
    say(f'KJ3: proposed method run twice per scenario, identical in {deterministic} of {len(checks)} '
        f'(the runner asserts equality; a mismatch stops the run)')


def localization() -> None:
    L = pd.read_csv(OUT / 'localization_results.csv')
    meta = json.loads((OUT / 'localization_meta.json').read_text())
    excursion = is_true(L.excursion)
    no_article = L.type.eq('Pa artikull')
    main = L[~excursion & ~no_article]
    say(f"\n## Localization test (run {meta.get('started_at')} – {meta.get('ended_at')}, code {str(meta.get('git_commit'))[:7]})")

    def row(group: pd.DataFrame, label: str) -> dict:
        found = group[group.found]
        within = is_true(group.within_threshold)
        return dict(grupi=label, n=len(group), gjetur=int(group.found.sum()),
                    gjetur_pct=100 * group.found.mean(), largesia_mediane_m=found.distance_m.median(),
                    brenda_pragut=int(within.sum()), brenda_pragut_pct=100 * within.mean(),
                    brenda_pragut_pct_e_gjeturave=100 * within.sum() / max(1, len(found)))

    rows = [row(main, 'të gjitha'), row(main[main.type == 'Atraksion'], 'atraksione (300 m)'),
            row(main[main.type == 'Zonë'], 'zona (1 km)')]
    rows += [row(main[main.city == c], c) for c in ['Rome', 'Paris', 'Barcelona', 'Tokyo', 'Bangkok']]
    # Reported separately (Ch4 4.10): the two Bangkok excursions and the three places without an article
    rows += [row(L[excursion], 'ekskursionet e Bangkokut'), row(L[no_article], 'vendet pa artikull')]
    table = pd.DataFrame(rows)
    table.round(1).to_csv(AN / 'localization_summary.csv', index=False)
    say(table.round(1).to_string(index=False))
    say('excursions: ' + str(L[excursion][['name', 'found']].to_dict('records')))
    say('no article: ' + str(L[no_article][['name', 'found', 'distance_m']].round(0).to_dict('records')))
    say('not found (main): ' + ', '.join(main[~main.found].name))
    outside = main[main.found & ~is_true(main.within_threshold)]
    say('found outside threshold: ' + ', '.join(f'{r.name} ({r.distance_m:.0f} m)' for r in outside.itertuples()))
    say('matched service: ' + str(main[main.found].matched_service.value_counts().to_dict()))

    # Run 2 vs run 3 (run 3 = after the Tokyo centre fix, commit eeb6f44); run 3 is the main result.
    run2_path = OUT / 'localization_results_run2.csv'
    if run2_path.exists():
        L2 = pd.read_csv(run2_path)
        main2 = L2[~is_true(L2.excursion) & ~L2.type.eq('Pa artikull')]
        runs = []
        for label, df in [('run 2', main2), ('run 3', main)]:
            for g, sub in [('të gjitha', df), ('atraksione (300 m)', df[df.type == 'Atraksion']), ('zona (1 km)', df[df.type == 'Zonë'])]:
                runs.append(dict(ekzekutimi=label, **row(sub, g)))
        runs_table = pd.DataFrame(runs)
        runs_table.round(1).to_csv(AN / 'localization_runs.csv', index=False)
        say('\nrun 2 vs run 3:')
        say(runs_table[['ekzekutimi', 'grupi', 'n', 'gjetur', 'largesia_mediane_m', 'brenda_pragut']].round(1).to_string(index=False))
        changes = AN / 'localization_changes_run2_run3.csv'
        if changes.exists():
            say('changes between runs (from evaluation/replayLocalization.ts): '
                + str(pd.read_csv(changes)[['city', 'name', 'cause']].to_dict('records')))

    # Wrong matches: found, but outside the threshold -> the accepted object is another place.
    # The accepted object is traced in the recorded service answers, as evidence.
    def accepted_object(responses: list, r) -> tuple[str, str]:
        place = next(p for p in responses if p['name'] == r['name'])
        for request in place['attempts'][-1]['requests']:
            try:
                body = json.loads(request.get('body') or '')
            except (ValueError, TypeError):
                continue
            for f in (body.get('features') if isinstance(body, dict) else body) or []:
                if 'geometry' in f:
                    lon, lat = f['geometry']['coordinates'][:2]
                    props = f.get('properties') or {}
                    name, kind = props.get('name') or '', props.get('osm_value') or ''
                else:
                    lat, lon = float(f.get('lat', 0)), float(f.get('lon', 0))
                    name, kind = (f.get('display_name') or '').split(',')[0], f.get('type') or ''
                d = 2 * 6371000 * math.asin(math.sqrt(math.sin(math.radians(lat - r['found_lat']) / 2) ** 2
                    + math.cos(math.radians(lat)) * math.cos(math.radians(r['found_lat']))
                    * math.sin(math.radians(lon - r['found_lon']) / 2) ** 2))
                if d < 40:
                    return name, kind
        return '', ''

    wrong = []
    for label, results, responses_file in [('run 2', run2_path, 'localization_responses_run2.json'),
                                           ('run 3', OUT / 'localization_results.csv', 'localization_responses.json')]:
        if not results.exists():
            continue
        df = pd.read_csv(results)
        df = df[~is_true(df.excursion) & ~df.type.eq('Pa artikull')]
        responses = json.loads((OUT / responses_file).read_text())
        found = df[df.found]
        for _, r in found[~is_true(found.within_threshold)].iterrows():
            name, kind = accepted_object(responses, r)
            wrong.append(dict(ekzekutimi=label, qyteti=r.city, vendi=r['name'], lloji=r.type, largesia_m=round(r.distance_m),
                              objekti_i_pranuar=name, lloji_i_objektit=kind, mbi_2_km=r.distance_m > 2000))
        n_wrong = sum(1 for w in wrong if w['ekzekutimi'] == label)
        n_far = sum(1 for w in wrong if w['ekzekutimi'] == label and w['mbi_2_km'])
        say(f'wrong matches ({label}): {n_wrong} of {len(found)} found, {n_far} of them more than 2 km away')
    wrong_table = pd.DataFrame(wrong)
    wrong_table.to_csv(AN / 'localization_wrong_matches.csv', index=False)
    say(wrong_table.to_string(index=False))


def input_tests(skip_tests: bool) -> None:
    report = AN / 'vitest_inputs.json'
    files = ['src/services/__tests__/tripDates.test.ts', 'server/__tests__/tripChat.test.ts',
             'src/services/__tests__/parseLocation.test.ts']
    if not skip_tests:
        subprocess.run(['npx', 'vitest', 'run', '--reporter=json', f'--outputFile={report}', *files],
                       cwd=ROOT, check=False, capture_output=True)
    data = json.loads(report.read_text())
    categories = json.loads((ROOT / 'evaluation' / 'input_test_categories.json').read_text())
    results = [(a['title'], a['status']) for f in data['testResults'] for a in f['assertionResults']]
    missing = [t for t, _ in results if t not in categories]
    if missing:
        sys.exit(f'Uncategorised input tests: {missing}')
    table = (pd.DataFrame([dict(category=categories[t], passed=s == 'passed') for t, s in results])
             .groupby('category', sort=False).agg(raste=('passed', 'size'), te_sakta=('passed', 'sum')).reset_index())
    table.to_csv(AN / 'input_tests.csv', index=False)
    # Ch6 Tabela 21: report by the inputs actually tested, in the categories of Ch4 4.10
    inputs = json.loads((ROOT / 'evaluation' / 'input_test_inputs.json').read_text())
    status = dict(results)
    names = {'known': 'Formate të njohura', 'relative': 'Data relative', 'no_date': 'Përgjigje pa datë',
             'impossible': 'Data të pamundura', 'past': 'Data në të kaluarën',
             'to_model': 'Formate që duhet t’i kalojnë modelit gjuhësor', 'coordinates': 'Koordinata në formate të ndryshme',
             'map_links': 'Lidhje hartash', 'out_of_range': 'Vlera jashtë kufijve',
             'not_coordinates': 'Tekste që nuk janë koordinata'}
    rows = []
    for group, label in [('date', 'Datat'), ('location', 'Vendndodhja')]:
        for key in [k for k in names if any(k in i['categories'] for i in inputs[group])]:
            members = [i for i in inputs[group] if key in i['categories']]
            ok = [i for i in members if all(status.get(t) == 'passed' for t in i['tests'])]
            rows.append(dict(grupi=label, kategoria=names[key], hyrje=len(members), te_sakta=len(ok),
                             hyrjet='; '.join(i['input'] for i in members)))
    by_input = pd.DataFrame(rows)
    by_input.to_csv(AN / 'input_tests_by_input.csv', index=False)
    flow = sum(1 for t, _ in results if categories[t] == 'date_flow')
    say(f"by input: {len(inputs['date'])} date inputs, {len(inputs['location'])} location inputs, "
        f"{flow} flow checks without an input format")
    say(by_input[['grupi', 'kategoria', 'hyrje', 'te_sakta']].to_string(index=False))
    say(f'\n## Input interpretation: {len(results)} cases, {sum(s == "passed" for _, s in results)} correct')
    say(table.to_string(index=False))


def map_example(no_map: bool) -> None:
    if no_map:
        return
    target = AN / 'map_example.json'
    subprocess.run(['npx', 'vite-node', 'evaluation/exportMapExample.ts', 'E1-rome-D3-balanced-r5', str(target)],
                   cwd=ROOT, check=True, capture_output=True)
    example = json.loads(target.read_text())
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import contextily as cx
    import contextily.tile as cx_tile
    cx_tile.USER_AGENT = USER_AGENT  # OSM tile policy: identify the application
    cx.set_cache_dir(tempfile.mkdtemp())

    def merc(lat: float, lon: float) -> tuple[float, float]:
        x = lon * 20037508.34 / 180
        y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * 20037508.34 / 180
        return x, y

    base = example['base']
    colors = ['#C0392B', '#2F5496', '#1E8449']
    points = [merc(s['lat'], s['lon']) for m in example['methods'].values() for d in m for s in d['stops']]
    points.append(merc(base['lat'], base['lon']))
    xs, ys = zip(*points)
    pad = 650
    fig, axes = plt.subplots(1, 2, figsize=(10, 5.2), dpi=200)
    titles = {'B2': '(a) Ndarja sipas renditjes së vendeve në listë', 'P': '(b) Metoda e propozuar'}
    say('\n## Map example (E1-rome-D3-balanced-r5)')
    for ax, m in zip(axes, ['B2', 'P']):
        days = example['methods'][m]
        bx, by = merc(base['lat'], base['lon'])
        ax.set_xlim(min(xs) - pad, max(xs) + pad)
        ax.set_ylim(min(ys) - pad, max(ys) + pad)
        ax.set_aspect('equal')
        cx.add_basemap(ax, source=cx.providers.OpenStreetMap.Mapnik, zoom=13,
                       attribution='© OpenStreetMap contributors', attribution_size=5, alpha=0.55)
        for i, d in enumerate(days):
            pts = [merc(s['lat'], s['lon']) for s in d['stops']]
            ax.plot([bx] + [p[0] for p in pts] + [bx], [by] + [p[1] for p in pts] + [by], '-',
                    color=colors[i], lw=1.8, alpha=0.9, zorder=3)
            ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=50, color=colors[i], edgecolor='white',
                       linewidth=1, zorder=4, label=f"Dita {i + 1}: K = {d['K']}, {d['L']:.1f} km".replace('.', ','))
        ax.scatter([bx], [by], marker='s', s=75, color='black', zorder=5, label='Baza')
        ax.set_axis_off()
        mean_k = sum(d['K'] for d in days) / len(days)
        ax.set_title(f'{titles[m]} – K̄ = {mean_k:.2f}'.replace('.', ','), fontsize=10)
        ax.legend(loc='upper left', fontsize=7, framealpha=0.92)
        say(f"{NAMES[m]}: mean K {mean_k:.2f}; days: " +
            '; '.join(f"K={d['K']}, {d['L']:.1f} km, {len(d['stops'])} places" for d in days))
    plt.tight_layout()
    plt.savefig(AN / 'fig10_shembulli_harta.png', bbox_inches='tight')
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--no-map', action='store_true', help='skip the map example (Node + internet needed)')
    parser.add_argument('--skip-tests', action='store_true', help='reuse analysis/vitest_inputs.json')
    args = parser.parse_args()
    AN.mkdir(parents=True, exist_ok=True)
    import scipy
    say(f'# Chapter 6 analysis (pandas {pd.__version__}, scipy {scipy.__version__})')
    d1 = pd.read_csv(OUT / 'results_e1.csv')
    d2 = pd.read_csv(OUT / 'results_e2.csv')
    dist = e1(d1)
    figure_compactness(dist)
    hypotheses(dist)
    h3(dist)
    e2(d2)
    kj7_kj3(dist, d2)
    localization()
    input_tests(args.skip_tests)
    map_example(args.no_map)
    (AN / 'summary.md').write_text('\n'.join(summary) + '\n')
    print(f'\nWritten to {AN}')


if __name__ == '__main__':
    main()
