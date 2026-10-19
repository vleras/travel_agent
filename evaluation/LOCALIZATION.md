# Localization check (Chapter 4, section 4.10)

Run from the repository root:

```sh
NODE_USE_SYSTEM_CA=1 npx vite-node evaluation/runLocalization.ts
```

The runner refuses to overwrite existing localization outputs. Run 1 is preserved
unchanged in `output/localization_*_run1.*`. Run 2 uses the successful, single-request
pre-flight recorded in `localization_preflight_run2.json` and embedded in its meta.
That pre-flight is historical evidence, not a health guarantee for later runs.
Network connection type was unknown; no IP address or Wi-Fi identifier is recorded.

The real `locateSight(name, cityName)` receives only those two arguments, never
reference coordinates, localName or wikipediaTitle. The order is Rome, Paris,
Barcelona, Tokyo, Bangkok, preserving each city's curated list order. All 98
entries are included, including Beach. `nr` starts at 1 in each city.

Vite's `loadEnv` preserves .env/.env.local/mode-file and process-env precedence.
Only VITE_ variables are exposed to the lookup; metadata records key presence as
booleans. Each attempt runs in a fresh vite-node child process with empty
in-memory localStorage. This guarantees that successful earlier attempts cannot
be reused on retry. Unlike run 1, there are also no cross-place cached anchors.
The app's city-center table, provider order, normalization, 20 km rule, queues,
timeouts and internal Photon retries are unmodified. Run 2 uses the shared real
Nominatim User-Agent from the separately committed app fix.

There is a 3-second pause before every attempt after the first. After finishing
a city, places whose last attempt has `service_error` are retried in list order,
after a 60-second cooldown. At most two such retry rounds are performed, for at
most three attempts per place. The last attempt alone supplies the CSV result,
even if an earlier attempt returned coordinates. The 60-second cooldown is in
addition to the ordinary 3-second attempt spacing.

A final status is `service_error` if any request in that attempt has HTTP >=400
(including the required 403/429/5xx), a network/timeout/body-read error, or an
uncaught lookup exception. This takes precedence even if another provider
returns coordinates. Otherwise it is `found` or `not_found`. The CSV `found`
boolean still records whether coordinates were returned; it is distinct from
`final_status`. Summary found/not_found/service_error counts use final_status
and sum to 98. Per-type `found` and threshold statistics describe the retained
coordinates, including any service_error rows with coordinates.

The appendix defines 56 Atraksion (300 m), 39 Zonë (1,000 m), and three Pa artikull
(no threshold). Pa artikull entries are looked up and reported separately.
Ayutthaya Day Trip Hub and Damnoen Saduak Floating Market are flagged excursions
expected to fail the 20 km rule. `within_threshold` is empty without a result
or applicable threshold.

Outputs:

- `output/localization_results.csv`: 98 rows with haversine distance in meters,
  last-attempt lookup duration, attempts (1–3), and final_status.
- `output/localization_responses.json`: every attempt, its point, status, duration,
  every request (also marked with attempt number), sanitized URL, HTTP status,
  complete sanitized body, and explicit errors. Headers are not recorded.
- `output/localization_meta.json`: source HEAD, runner SHA-256, timestamps, runtime,
  pre-flight, key-presence booleans, pacing/retry protocol and counts across ALL
  attempts. The source HEAD predates the commit containing this run's outputs.

`matched_service` is populated only when the final successful response contains
the exact returned coordinates; otherwise it is blank. Duration includes the
app's queues and retries, but excludes worker startup, experiment pauses,
response-clone drain and output. HTTP errors are responses >=400; 403, 429 and
5xx counts are subsets. Network errors are counted separately. All response
bodies and request URLs are sanitized for loaded key values before saving.
