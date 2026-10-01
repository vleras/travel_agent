# Travel Agent

A travel-planning thesis project built with React and TypeScript. It combines a conversational planner with a reason, act, observe, and revise agent loop to create geographically compact daily itineraries.

Users can verify a hotel, pick attractions and food places, rearrange day cards, view maps and photos, add dates for weather, and email their plan.

## Requirements

- **Node.js 24 recommended**, or Node.js 22.18+. The backend imports TypeScript directly.
- **npm**, included with Node.js, and Git to clone the repository.
- A modern browser and internet access for external services.
- A **DeepSeek API key** for conversational planning and AI recommendations. Other provider keys are optional.

No database, Docker, or Python setup is required. Trip state and caches are stored in the browser or in memory.

## Local setup

```bash
git clone https://github.com/vleras/travel_agent.git
cd travel_agent
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. If `.env` already exists, edit it rather than replacing it.

Add your own keys to `.env`, then start both processes in separate terminals from the project directory.

**Terminal 1: API backend**

```bash
npm run server
```

The API listens on `http://127.0.0.1:5174`. Use this command rather than starting `server/index.ts` directly: the npm command loads `.env` and provides all three API routes.

**Terminal 2: web app**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), or the address printed by Vite if that port is occupied. Keep both terminals running; press `Ctrl+C` in each to stop them.

Vite forwards browser requests under `/api` to port 5174. Restart both processes after changing `.env`. Restart the backend after editing server code because it does not reload automatically.

## Environment variables

Copy the names from [.env.example](.env.example). Leave optional values empty. For compatibility with the backend's simple loader, use plain `NAME=value` lines without surrounding quotes or inline comments.

- `DEEPSEEK_API_KEY`: server-only key for chat extraction, attractions, and food selection. Obtain it from the [DeepSeek platform](https://platform.deepseek.com/). Never add a `VITE_` prefix.
- `DEEPSEEK_MODEL`: defaults to `deepseek-flash` in the code. Override it with a model available to your account if needed.
- `VITE_GEOAPIFY_KEY`: optional [Geoapify](https://www.geoapify.com/) key for food discovery and geocoding. Public OSM providers supply fallbacks.
- `VITE_TOMTOM_KEY`: optional [TomTom](https://developer.tomtom.com/) key for additional hotel search.
- `VITE_PEXELS_API_KEY`: optional [Pexels](https://www.pexels.com/api/) photo source.
- `VITE_GEMINI_API_KEY`: optional Gemini attraction fallback, configured through [Google AI Studio](https://aistudio.google.com/). It does not replace DeepSeek for chat.

All `VITE_` values are included in browser code. Use provider restrictions where supported. `.env` is ignored by Git; only the empty example belongs in the repository. Backend process environment variables take precedence over its `.env` file.

Weather and the current FormSubmit email sender need no API keys. EmailJS variables from older setups are no longer read by the sender.

## Dependencies

`npm ci` installs everything in [package.json](package.json), using [package-lock.json](package-lock.json) for reproducible versions. No global React, Vite, or TypeScript installation is needed.

- **UI:** React, React DOM, TypeScript, Vite, and the Vite React plugin.
- **Maps:** Leaflet and React Leaflet.
- **Dates:** date-fns.
- **Checks:** Vitest, Oxlint, and Node/React/Leaflet type definitions.
- **Legacy:** `@emailjs/browser` remains installed, but the active sender uses FormSubmit.

After deliberately changing dependencies, use `npm install` and commit both the manifest and updated lockfile.

## Commands

```bash
npm run dev       # Frontend development server
npm run server    # API backend on port 5174
npm run build     # Production frontend bundle in dist/
npm run preview   # Local built-app preview, normally on port 4173
npm test          # Vitest suite
npm run lint      # Oxlint checks
npx tsc -p tsconfig.app.json --noEmit  # Separate application type check
```

The build bundles the app; it does not run tests or TypeScript checking. Keep the backend running for `npm run preview`, which inherits the configured API proxy.

## Features and services

### Chat and itinerary planning

The chat collects destination, duration, accommodation, then dates. Dates can be declined or added later from the itinerary header. Past dates keep the conversation open for a correction; changing duration asks for dates again.

The agent locates attractions, groups them by day, scores geographic compactness, and revises spread-out days. Users can move or remove places afterward. Session storage supports refresh and browser Back/Forward navigation.

Attraction generation tries DeepSeek, optional Gemini, then curated data for Rome, Tokyo, Barcelona, Bangkok, and Paris. Without AI keys, use the form path for basic planning. Fallback city coverage is limited, and the full conversational experience requires DeepSeek.

### Places, maps, and photos

- Geocoding uses Photon, Nominatim/OSM, optional Geoapify, and optional TomTom for hotels.
- Maps use Leaflet with OSM tiles; route calculations use OSRM.
- Food discovery uses Geoapify with an Overpass/OSM fallback. Wikivoyage provides a recommendation signal; DeepSeek selects from retrieved candidates.
- Photos use Wikipedia/Wikidata metadata, Wikimedia Commons, Openverse, and optional Pexels, with landmark matching checks.

Keep provider attribution visible. Public endpoints can be rate-limited or temporarily unavailable, and coverage varies by location.

### Weather

Open-Meteo data is matched to itinerary dates:

- The first 16 calendar days, including today, use the forecast endpoint.
- All later dates use monthly averages labelled **“Typical (based on past years)”**. These describe historical temperatures, not a prediction of daily sunshine or rain.

Historical averages use the same month from the previous ten complete years. They are cached by location, month, and baseline year for 30 days in memory/localStorage. Forecasts are cached in memory for 30 minutes. Flexible trips show an Add dates prompt.

Open-Meteo's free hosted API is for non-commercial use, with usage limits and attribution requirements. See its [pricing and usage terms](https://open-meteo.com/en/pricing). AI APIs may require billing; the entire application is not guaranteed to run at zero cost.

### Email

The active sender uses [FormSubmit's AJAX endpoint](https://formsubmit.co/ajax-documentation). It sends a plain-text itinerary with destination, duration, hotel if supplied, each day's date, and sightseeing stops with Google Maps links and distance from the trip base.

No EmailJS setup is needed. [FormSubmit](https://formsubmit.co/) requires recipient confirmation on first use: check the inbox and spam folder for activation, confirm, and retry if needed. HTTP success is not proof of inbox delivery.

The last email address is saved in localStorage. Sending shares the address and itinerary with FormSubmit; use your own address for manual testing.

## Testing and known limitations

Run the commands above before submitting changes. Focused date-validation checks:

```bash
npx vitest run src/services/__tests__/tripDates.test.ts server/__tests__/tripChat.test.ts
```

Run the full unit suite and the separate type check as well as the build. Email tests mock provider responses and never send real email.

Additional scripts:

- `node scripts/test-photo-metadata.mjs`: mocked photo/locator checks.
- `node scripts/test-photo-rows.mjs`: browser checks for row-by-row photo loading, responsive columns, failures, and photos arriving after a long wait. Requires the browser-test dependencies below and a running Vite server; photo requests are mocked.
- `node scripts/test-sight-photos.mjs`: live photo-provider diagnostics using optional browser-facing keys.
- `scripts/test-chat-live.mjs`: live chat diagnostic requiring local servers and DeepSeek access. Its standalone TypeScript loader predates shared imports and may need updating. Live calls can consume API credit.
- `scripts/test-flow-history.mjs`: browser flow checks for chat, dates, weather, navigation, and mocked FormSubmit email sending. Requires Playwright and Chromium, neither installed by `npm ci`.

Optional browser-test dependencies:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

Run `node scripts/test-flow-history.mjs`. It accepts `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, and `TEST_BASE_URL`. The default URL is `http://127.0.0.1:5173`; use `TEST_BASE_URL=http://localhost:5173` if Vite only listens on localhost.

## Troubleshooting

- **Chat fails or returns 502:** check both servers, backend logs, the DeepSeek key/model, and account access. Port 5174 is the API, not the website.
- **API returns 503:** add `DEEPSEEK_API_KEY` to `.env` and restart the backend.
- **Port occupied:** stop the earlier process. The backend port is fixed at 5174; changing it requires updating `vite.config.ts` too.
- **Unknown TypeScript extension:** check `node --version` against the requirements above.
- **Certificate errors on a managed network:** use the organization's trusted CA bundle with `NODE_EXTRA_CA_CERTS`. The frontend dev launcher loads macOS system certificates; the standalone backend does not inherit that launcher environment. Do not disable TLS verification.
- **Stale trip or results:** sessionStorage/localStorage hold trip data and caches. Clear site data only when you intend to discard the saved trip, email address, and cached results.
- **Missing email:** check FormSubmit activation and spam, then inspect the network response. EmailJS variables do not affect the active sender.

## Production deployment

Build with `npm run build` and serve `dist/`. Browser-facing environment values must be supplied at build time.

Also deploy the API handlers in `server/`, with server-side DeepSeek variables and same-origin routing for:

- `POST /api/deepseek/trip-chat`
- `POST /api/deepseek/attractions`
- `POST /api/deepseek/food`

Static hosting alone cannot run the chat API. `server/dev-server.mjs` is a local development server bound to `127.0.0.1:5174`; production needs suitable routing/runtime configuration, HTTPS, and access/rate controls for the paid AI endpoints. `npm run preview` is for local inspection, not production hosting.

## Project structure

```text
server/                     DeepSeek handlers and local API server
scripts/                    Dev launcher and diagnostic scripts
src/components/questions/   Chat, form, destination and place selection
src/components/trip/        Itinerary, maps, photo/detail views, date editor
src/components/chat/        Supporting travel chat UI
src/services/               Agent, geocoding, food, photos, weather, email, storage
src/services/__tests__/     Service regression tests
src/data/                   Curated destinations and attraction fallbacks
src/types/                  Shared TypeScript types
src/styles/                 Application CSS
public/                     Static public assets
.env.example                Empty environment-variable template
vite.config.ts              Frontend build and API proxy
```

Agent metrics include compactness before/after revision, improvement, revision count, processing time, and API-call totals. Their types live in `src/types/` and values are populated by `src/services/agent.ts`.
