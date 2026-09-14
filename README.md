# Travel Agent — AI Itinerary Planner

Thesis project: an agentic travel planner that combines a **reason → act → observe → revise** loop with **geographic compactness scoring** to produce day-by-day itineraries anchored to the user’s accommodation.

## Quick start

```bash
npm install
cp .env.example .env
# Add DEEPSEEK_API_KEY to .env (server-side only)
npm run dev
```

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

DeepSeek generates attractions through `POST /api/deepseek/attractions`. The Vite development and preview servers run this endpoint; the API key stays on the server. Set `DEEPSEEK_MODEL` to override the default model. Restart Vite after changing `.env`.

For production, deploy `server/deepseek.ts` in a Node backend and route `/api/deepseek/attractions` to it, passing server environment variables to `deepseekHandler`. A static `dist` deployment alone cannot run this endpoint. Protect a public deployment with authentication and rate limits to control API spending.

The travel chatbot uses local intent handlers; this integration powers attraction recommendations. Explicit must-visit selections retain the existing behavior and skip AI-generated filler.
