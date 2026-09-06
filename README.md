# Travel Agent — AI Itinerary Planner

Thesis project: an agentic travel planner that combines a **reason → act → observe → revise** loop with **geographic compactness scoring** to produce day-by-day itineraries anchored to the user’s accommodation.

## Quick start

```bash
npm install
cp .env.example .env
# Optional: add VITE_GEMINI_API_KEY from https://ai.google.dev/
npm run dev
```

Without a Gemini key, the agent uses curated attractions for Rome, Tokyo, Barcelona, Bangkok, and Paris — the full clustering / scoring / revision loop still runs.

## Stack (zero-cost APIs)

| Concern | Provider |
|--------|----------|
| Geocoding | Nominatim (OpenStreetMap) |
| Routing sample | OSRM public demo |
| Attractions LLM | Gemini (optional) |
| Maps | Leaflet + OSM tiles |
| Place photos | Wikipedia thumbnails (fallback: LoremFlickr) |

## Flow

1. Entry: know destination (Path A) or curated cards (Path B)
2. Questions: days (number or range), dates, hotel/base, interests, pace, daily schedule (start + breakfast)
3. Agent loop (visible in UI):
   - **Reason** — geocode city + hotel/base
   - **Act** — generate attractions (Gemini or fallback)
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
