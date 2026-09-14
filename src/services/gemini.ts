import { getFallbackAttractions } from '../data/fallbackAttractions';
import type { Attraction } from '../types';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function buildPrompt(
  city: string,
  interests: string[],
  customPreferences?: string | null,
): string {
  const custom = customPreferences?.trim()
    ? `\nAlso honor these extra preferences from the traveler: ${customPreferences.trim()}.`
    : '';
  const interestLine = interests.length
    ? interests.join(', ')
    : 'general sightseeing';
  return `You are a travel expert. Generate 20-30 attraction recommendations for ${city} that match these interests: ${interestLine}.${custom}

Do not suggest beaches unless Beach is explicitly listed in the interests.
Return ONLY a valid JSON array with no preamble:
[
  {
    "name": "Attraction Name",
    "category": "Museums|Food|Nature|Nightlife|Shopping|Beach|Architecture|Photography",
    "description": "Brief description (1 sentence)",
    "typical_visit_duration_minutes": 60,
    "why_visit": "Brief explanation"
  }
]`;
}

function parseAttractions(text: string): Attraction[] | null {
  try {
    const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    const items = Array.isArray(parsed) ? parsed : (parsed as { attractions?: unknown })?.attractions;
    if (!Array.isArray(items)) return null;
    const valid = items.filter((a): a is Attraction => a != null &&
      typeof a.name === 'string' && a.name.trim().length > 0 &&
      typeof a.category === 'string' && typeof a.description === 'string' &&
      typeof a.why_visit === 'string' && typeof a.typical_visit_duration_minutes === 'number' &&
      Number.isFinite(a.typical_visit_duration_minutes) && a.typical_visit_duration_minutes > 0);
    return valid.length ? valid : null;
  } catch {
    return null;
  }
}

function filterByInterests(
  attractions: Attraction[],
  interests: string[],
): Attraction[] {
  const wantsBeach = interests.map((i) => i.toLowerCase()).includes('beach');
  if (wantsBeach) return attractions;
  return attractions.filter((a) => a.category.toLowerCase() !== 'beach');
}

export async function generateAttractions(
  city: string,
  interests: string[],
  customPreferences?: string | null,
): Promise<{ attractions: Attraction[]; latencyMs: number; source: 'deepseek' | 'gemini' | 'fallback' }> {
  const deepseekStarted = performance.now();
  try {
    const response = await fetch('/api/deepseek/attractions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, interests, customPreferences }),
      signal: AbortSignal.timeout(65000),
    });
    if (response.ok) {
      const attractions = parseAttractions(JSON.stringify(await response.json()));
      const filtered = attractions ? filterByInterests(attractions, interests) : [];
      if (filtered.length) return { attractions: filtered, latencyMs: Math.round(performance.now() - deepseekStarted), source: 'deepseek' };
    }
  } catch {
    // Keep the itinerary available if DeepSeek is unreachable.
  }
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  if (!apiKey) {
    return {
      attractions: filterByInterests(getFallbackAttractions(city), interests),
      latencyMs: 0,
      source: 'fallback',
    };
  }

  const started = performance.now();
  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildPrompt(city, interests, customPreferences) },
            ],
          },
        ],
        generationConfig: { temperature: 0.7 },
      }),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return {
        attractions: filterByInterests(getFallbackAttractions(city), interests),
        latencyMs,
        source: 'fallback',
      };
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const attractions = parseAttractions(text);
    if (!attractions?.length) {
      return {
        attractions: filterByInterests(getFallbackAttractions(city), interests),
        latencyMs,
        source: 'fallback',
      };
    }
    return {
      attractions: filterByInterests(attractions, interests),
      latencyMs,
      source: 'gemini',
    };
  } catch {
    return {
      attractions: filterByInterests(getFallbackAttractions(city), interests),
      latencyMs: Math.round(performance.now() - started),
      source: 'fallback',
    };
  }
}
