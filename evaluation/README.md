# E1 / E2 scenario evaluation

From the repository root, after `npm ci`, run:

```sh
NODE_USE_SYSTEM_CA=1 npx vite-node evaluation/runE1E2.ts
```

This invokes the actual exported application algorithms through vite-node; it does
not copy the clustering or revision implementation. No browser or running web
server is needed. Internet access is required for the five base lookups. On
PowerShell set `$env:NODE_USE_SYSTEM_CA="1"` before running the npx command.

## Data and protocol

- All 98 curated places, including beaches: Rome 22, Paris 21, Barcelona 19,
  Tokyo 18, Bangkok 18. Counts, unique names and finite coordinates are asserted.
- Call the app's `geocode(city)` once per city in that order, with lowercase city
  names and no persistent localStorage. The app can internally retry HTTP 429.
  Abort if any city returns no valid coordinates. Never use cityCenters.ts.
- E1: 600 scenarios, D=2..5, three paces, seeds 1..10. Fisher-Yates shuffles
  indices using mulberry32, selects min(list size, 4D), then restores list order.
- E2: 60 scenarios using all places. E1 precedes E2 when marking duplicates.
  The key includes city, D, pace and JSON-encoded sorted names. Duplicates remain.
- P calls clustering, pads/slices to D, distributes food, then revises. B4 stops
  before revision. Food redistribution is recorded and asserted to be unchanged.
- B1: balanced random splits, seeds 1..30. B2: balanced consecutive list splits.
  Earlier days receive extra places for both methods.
- B3: k-means++ weighted by squared haversine distance, arithmetic lat/lon
  centroids, seeds 1..30, at most 50 assignment/update iterations. Assignment ties
  prefer the lowest cluster index; empty clusters retain their center. When all
  initialization weights are zero a seeded random point is selected. No size cap.
- All final days use the app's stable distance-from-base ordering. This is a sort
  by distance to the base, not a nearest-neighbor route. Internal ordering already
  performed by the app's clustering is retained during revision.
- Mean K and compact share exclude empty days; population sigma includes all D.
  `pct_compact` is a fraction in [0,1], not a 0..100 percentage. L uses the app's
  base-to-stops-and-back haversine distance. Metrics for B1/B3 are arithmetic means
  of the 30 run-level metrics, not metrics of an averaged itinerary.
- Timers surround splitting/distribution/revision only, excluding final common
  ordering, checks, metrics, geocoding and file writing. The app's internal
  clustering ordering remains part of its runtime. No warm-up or timing repeats
  beyond the requested stochastic runs are added.
- P is run twice for each scenario; ordered day-name arrays must match exactly.
  Every method/run must preserve every selected name exactly once and have D days.
- No statistical tests are implemented.

## Outputs

Written under `evaluation/output/` (successful reruns overwrite these files):

- `bases.json`: actual geocoder coordinates, display names and retrieval times.
- `scenarios.json`: all scenario definitions, ordered names, keys and duplicate IDs.
- `results_e1.csv`: 3,000 rows, one per scenario/method.
- `results_e2.csv`: 300 rows, one per scenario/method.
- `proposed_checks.json`: P's ordered day contents, determinism status and whether
  food distribution changed membership, for each scenario.
- `run_meta.json`: UTC timestamps, Git HEAD, Node/OS/CPU, bases, counts, determinism,
  protocol details and median mean_K summaries (including duplicate scenarios).

CSV uses decimal dots. `r` is blank for E2. Revision count and changed flag are
blank for methods other than P. Membership-change flags ignore within-day order.
The Git hash identifies the committed runner and export-only application changes.
Run from a clean working tree; generated outputs are committed separately afterward.

## Run status

The initial attempt stopped at Rome without using a fallback. After changing only
the app geocoder's User-Agent to identify this repository, all five live lookups
succeeded. The successful run produced 600 E1 scenarios (84 duplicates) and 60 E2
scenarios (9 duplicates of earlier E1 scenarios). All 660 determinism checks passed;
food distribution changed none of the proposed splits. All 64 existing tests passed.
The runner now captures HTTP status/body when a base lookup fails, without issuing
an extra request. Saved timestamps are UTC (the successful run was October 14 in
Europe/Tirane).
