# Travel Agent — AI Itinerary Planner

Thesis project: an agentic travel planner that combines a **reason → act → observe → revise** loop with **geographic compactness scoring** to produce day-by-day itineraries anchored to the user’s accommodation.

## Quick start

```bash
npm install
cp .env.example .env
# Add DEEPSEEK_API_KEY to .env (server-side only)
npm run dev
```

In a second terminal, run `npm run server` for the API on port 5174. Use Node.js 22.18 or newer, which supports the backend's TypeScript imports. Restart the API server after changing backend code or `.env`.

Without an AI key, the agent uses curated attractions for Rome, Tokyo, Barcelona, Bangkok, and Paris — the full clustering / scoring / revision loop still runs.

## Stack (zero-cost APIs)

| Concern | Provider |
|--------|----------|
| Geocoding | Nominatim (OpenStreetMap) |
| Routing sample | OSRM public demo |
| Attractions LLM | DeepSeek (preferred), Gemini or curated fallback |
| Maps | Leaflet + OSM tiles |
| Place photos | Wikipedia thumbnails (fallback: LoremFlickr) |

## Flow

1. Entry: know destination (Path A) or curated cards (Path B)
2. Questions: days (number or range), dates, hotel/base, interests, pace, daily schedule (start + breakfast)
3. Agent loop (visible in UI):
   - **Reason** — geocode city + hotel/base
   - **Act** — generate attractions (DeepSeek, Gemini or fallback)
   - **Observe** — cluster by day, score compactness
   - **Revise** — move outlier stops if score < 70
4. Trip view: day tabs, map with route, stop photos + list, schedule controls, compactness badges, thesis metrics

## Thesis metrics

Logged to the browser console and shown under each day:

- `compactness_before_revision` / `compactness_after_revision` / `improvement_delta`
- `revision_count`, `agent_processing_time_ms`, `api_calls_total`

## Project structure

```
src/
  components/questions/   # entry, destination cards, question wizard
  components/trip/        # map, list, agent progress, badges
  data/                   # destination cards + fallback attractions
  services/               # nominatim, osrm, gemini, agent, geo utils
  types/
  styles/
```

## DeepSeek integration

The standalone API server handles `/api/deepseek/trip-chat`, `/api/deepseek/attractions`, and `/api/deepseek/food`. Vite proxies `/api` to port 5174 during development; the API key stays on the backend. Set `DEEPSEEK_MODEL` to override the default model. Static previews need a separately configured API route.

For production, deploy `server/deepseek.ts` in a Node backend and route `/api/deepseek/attractions` to it, passing server environment variables to `deepseekHandler`. A static `dist` deployment alone cannot run this endpoint. Protect a public deployment with authentication and rate limits to control API spending.

The chatbot combines local short-answer handlers with DeepSeek extraction. Both paths require dates to be addressed after accommodation, but declining dates is allowed. API logs show parsed intent and completion state; local shortcuts do not make an API request. Explicit must-visit selections retain the existing behavior and skip AI-generated filler.

## Daily weather

Open-Meteo provides daily conditions and minimum/maximum temperatures without an API key. Forecasts use the destination coordinates and match each itinerary's exact calendar date. Dates supplied in chat carry through to planning and email. Flexible dates, past dates, trips beyond the 16-day forecast window, and network failures show an explanatory message in each day header instead of unrelated weather. Forecast failures never block planning.

## Email sending with EmailJS

The trip plan is sent via EmailJS (https://www.emailjs.com/). The email includes:
- Trip title ("Your N-day trip to CITY") with dates and hotel
- Each day's date
- Stop names linked to Google Maps
- Food places shown as meal lines ("Lunch at…", "Dinner at…")
- "Open today's route in Google Maps" link per day
- Clean inline-styled HTML and plain-text fallback

**Setup:**
1. Create an EmailJS account at https://www.emailjs.com/
2. Create a service (e.g., Gmail), template, and get your keys
3. Add to `.env`:
   ```
   VITE_EMAILJS_SERVICE_ID=your_service_id
   VITE_EMAILJS_TEMPLATE_ID=your_template_id
   VITE_EMAILJS_PUBLIC_KEY=your_public_key
   ```
4. Create an EmailJS email template with these variables:
   - `{{to_email}}` — recipient email (sent by app)
   - `{{trip_subject}}` — email subject (sent by app)
   - `{{{trip_html}}}` — HTML email body (sent by app)

The entered email is saved locally for the session.
