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
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Attraction[];
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter((a) => a.name && a.typical_visit_duration_minutes);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Attraction[];
    } catch {
      return null;
    }
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
): Promise<{ attractions: Attraction[]; latencyMs: number; source: 'gemini' | 'fallback' }> {
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
