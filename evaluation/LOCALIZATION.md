# Localization check (Chapter 4, section 4.10)

Run from the repository root in a fresh process:

```sh
NODE_USE_SYSTEM_CA=1 npx vite-node evaluation/runLocalization.ts
```

The runner refuses to overwrite existing localization outputs. It calls the real
`locateSight(name, cityName)` once per curated place, sequentially, using Rome,
Paris, Barcelona, Tokyo, Bangkok and each city's original list order. All 98
entries are included, including Beach. Curated coordinates are used only for
comparison after lookup, never as lookup arguments. No localName or
wikipediaTitle is supplied.

Environment loading uses Vite's `loadEnv` with its standard development-mode
file precedence and existing process variables. Only VITE_ variables are passed
into the app environment; metadata records key presence as booleans. A fresh,
empty in-memory localStorage implementation is installed before importing the
locator. No browser storage or previous evaluation output is read. The app's
own caches, city-center table, within-run anchors, name normalization, 20 km
validation, provider order, queues, timeouts and Photon retries remain intact.
No src files are modified. In particular, the locator's existing Nominatim
User-Agent is unchanged, even if a provider rejects it.

The supplied appendix defines 56 Atraksion (300 m), 39 Zonë (1,000 m), and three
Pa artikull entries (no threshold). Pa artikull entries are still looked up and
reported separately. Ayutthaya Day Trip Hub and Damnoen Saduak Floating Market
are flagged as excursions expected to be rejected by the 20 km rule. A returned
point is `found` even when it fails the coordinate tolerance; this distinguishes
lookup success from agreement with the reference. `within_threshold` is empty
when there is no result or no applicable threshold.

Outputs:

- `output/localization_results.csv`: 98 rows, including haversine distance in
  meters and lookup duration in milliseconds. `nr` starts at 1 for each city.
- `output/localization_responses.json`: every request attempt, sanitized URL,
  HTTP status and full sanitized response body; transport and body-read errors
  are explicit. Request headers are not recorded. API-key values are redacted.
- `output/localization_meta.json`: timestamps, source HEAD, runner SHA-256,
  runtime, key-presence booleans, protocol and summary counts. The source HEAD
  is the pre-run commit; the runner and outputs are committed together afterward.

`matched_service` is inferred only if the last successful recorded response
contains the exact returned coordinates. Otherwise it is blank. HTTP errors
count responses with status >=400; rate-limit responses (429) are a subset.
Network errors are counted separately. App-level retries are separate recorded
attempts, not reruns of the experiment. The runner does not initiate retries.
