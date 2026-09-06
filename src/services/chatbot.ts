import { geocode } from './nominatim';
import { haversineKm } from './geo';
import type { ItineraryStop } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export type ChatIntent =
  | { type: 'dietary'; label: string; breakfastHint: string }
  | { type: 'add_place'; placeQuery: string }
  | { type: 'skip_breakfast' }
  | { type: 'plan_day'; day: number }
  | { type: 'move_stop'; stopName: string; toDay: number }
  | { type: 'show_options'; category: string }
  | { type: 'preference'; note: string }
  | { type: 'help' }
  | { type: 'greeting' };

const DIET_PATTERNS: { re: RegExp; label: string; breakfastHint: string }[] = [
  {
    re: /\bvegan\b/i,
    label: 'vegan',
    breakfastHint: 'vegan bakery / plant-based breakfast',
  },
  {
    re: /\bvegetarian\b|\bveggies?\b|\bno meat\b/i,
    label: 'vegetarian',
    breakfastHint: 'vegetarian breakfast, eggs optional, no meat',
  },
  {
    re: /\bgluten[-\s]?free\b|\bceliac\b/i,
    label: 'gluten-free',
    breakfastHint: 'gluten-free bakery / café',
  },
  {
    re: /\bhalal\b/i,
    label: 'halal',
    breakfastHint: 'halal-friendly breakfast',
  },
  {
    re: /\bkosher\b/i,
    label: 'kosher',
    breakfastHint: 'kosher breakfast',
  },
  {
    re: /\bdairy[-\s]?free\b|\blactose\b/i,
    label: 'dairy-free',
    breakfastHint: 'dairy-free café breakfast',
  },
];

const ADD_PLACE_RE =
  /(?:(?:want to|wanna|would like to|I'd like to|i want to)\s+(?:visit|go to|see|check out)|(?:add|include|put)\s+(?:in\s+)?(?:the\s+)?(?:trip|itinerary)?\s*|visit|go to|see)\s+(.+)/i;

const MOVE_RE =
  /move\s+["“]?(.+?)["”]?\s+(?:to|onto)\s+(?:the\s+)?(?:day\s*)?(\d+)(?:st|nd|rd|th)?/i;

const PLAN_DAY_RE =
  /(?:plan|let'?s plan|show|start with|focus on)\s+(?:the\s+)?(?:first|1st|day\s*)?(\d+|first|second|third)?(?:st|nd|rd|th)?\s*day|(?:plan|let'?s plan)\s+day\s*(\d+)/i;

export function parseChatIntent(message: string): ChatIntent {
  const text = message.trim();
  if (!text) return { type: 'help' };

  if (/^(hi|hello|hey|yo)\b/i.test(text)) return { type: 'greeting' };
  if (/help|what can you|how do/i.test(text)) return { type: 'help' };

  if (/skip\s+breakfast|no breakfast|without breakfast|breakfast\s+later|breakfast\s+for\s+now/i.test(text)) {
    return { type: 'skip_breakfast' };
  }

  const move = text.match(MOVE_RE);
  if (move) {
    return {
      type: 'move_stop',
      stopName: move[1].trim(),
      toDay: Number(move[2]),
    };
  }

  const plan = text.match(PLAN_DAY_RE);
  if (plan || /plan\s+first\s+day|let'?s\s+plan\s+day\s*1|show\s+(me\s+)?(options|places)/i.test(text)) {
    let day = 1;
    const raw = plan?.[1] || plan?.[2];
    if (raw === 'first' || raw === '1') day = 1;
    else if (raw === 'second' || raw === '2') day = 2;
    else if (raw === 'third' || raw === '3') day = 3;
    else if (raw && /^\d+$/.test(raw)) day = Number(raw);
    return { type: 'plan_day', day };
  }

  if (/\b(nightlife|parks?|cafes?|café|museums?|food|shopping)\b/i.test(text) &&
      /\b(show|options|places|find|browse)\b/i.test(text)) {
    const cat = text.match(/\b(nightlife|parks?|cafes?|café|museums?|food|shopping)\b/i)?.[1] ?? 'places';
    return { type: 'show_options', category: cat };
  }

  for (const diet of DIET_PATTERNS) {
    if (diet.re.test(text)) {
      return {
        type: 'dietary',
        label: diet.label,
        breakfastHint: diet.breakfastHint,
      };
    }
  }

  const addMatch = text.match(ADD_PLACE_RE);
  if (addMatch?.[1]) {
    const placeQuery = addMatch[1]
      .replace(/[?.!]+$/, '')
      .replace(/\bplease\b/gi, '')
      .trim();
    if (placeQuery.length > 1) return { type: 'add_place', placeQuery };
  }

  if (
    text.length < 60 &&
    !/\b(food|eat|breakfast|prefer|need|want|plan|move|skip)\b/i.test(text) &&
    /^[A-ZÀ-ÖØ-Ý]/.test(text)
  ) {
    return { type: 'add_place', placeQuery: text.replace(/[?.!]+$/, '').trim() };
  }

  return { type: 'preference', note: text };
}

export async function resolvePlaceAsStop(
  placeQuery: string,
  city: string,
  baseLat: number,
  baseLon: number,
): Promise<ItineraryStop | null> {
  const { result } = await geocode(`${placeQuery}, ${city}`);
  const geo = result ?? (await geocode(placeQuery)).result;
  if (!geo) return null;

  const dist =
    Math.round(haversineKm(baseLat, baseLon, geo.lat, geo.lon) * 10) / 10;
  return {
    name: placeQuery,
    category: 'Custom',
    description: `Added from chat · ${geo.display_name.split(',').slice(0, 2).join(',')} · ~${dist} km from your base`,
    lat: geo.lat,
    lon: geo.lon,
    duration_min: 60,
    time_slot: '12:00',
  };
}

export interface ChatHandlers {
  onDietary?: (label: string, breakfastHint: string) => void;
  onPreference?: (note: string) => void;
  onAddPlace?: (placeQuery: string) => Promise<string>;
  onSkipBreakfast?: () => string | Promise<string>;
  onPlanDay?: (day: number) => string | Promise<string>;
  onMoveStop?: (stopName: string, toDay: number) => string | Promise<string>;
  onShowOptions?: (category: string) => string | Promise<string>;
}

export async function replyToChat(params: {
  message: string;
  city?: string | null;
  hasTrip: boolean;
} & ChatHandlers): Promise<string> {
  const intent = parseChatIntent(params.message);

  switch (intent.type) {
    case 'greeting':
      return params.hasTrip
        ? `Hi! I can skip breakfast, plan a day (“plan day 1”), show cafés/parks/nightlife, add a place, or move a stop (“move Colosseum to day 3”).`
        : 'Hi! Share preferences (vegetarian, must-visit places). Once your trip is built, I can rearrange days too.';

    case 'help':
      return [
        'Try:',
        '• “Skip breakfast for now”',
        '• “Let’s plan day 1”',
        '• “Show me parks / nightlife / cafés”',
        '• “I’m vegetarian”',
        '• “I want to visit the Pantheon”',
        '• “Move Trevi Fountain to day 3”',
      ].join('\n');

    case 'skip_breakfast': {
      if (!params.hasTrip || !params.onSkipBreakfast) {
        params.onPreference?.('Skip breakfast');
        return 'Okay — I’ll skip breakfast when we build the itinerary.';
      }
      return await params.onSkipBreakfast();
    }

    case 'plan_day': {
      if (!params.hasTrip || !params.onPlanDay) {
        return 'Finish building your itinerary first, then ask me to plan a specific day.';
      }
      return await params.onPlanDay(intent.day);
    }

    case 'move_stop': {
      if (!params.hasTrip || !params.onMoveStop) {
        return 'That works once your trip days exist. Build the itinerary, then tell me which stop to move.';
      }
      return await params.onMoveStop(intent.stopName, intent.toDay);
    }

    case 'show_options': {
      if (!params.hasTrip || !params.onShowOptions) {
        params.onPreference?.(`Interested in: ${intent.category}`);
        return `Noted interest in ${intent.category}. After the itinerary is ready, ask again to browse options.`;
      }
      return await params.onShowOptions(intent.category);
    }

    case 'dietary': {
      params.onDietary?.(intent.label, intent.breakfastHint);
      return params.hasTrip
        ? `Got it — ${intent.label}. Breakfast suggestions will bias toward “${intent.breakfastHint}”.`
        : `Noted: ${intent.label}. I’ll apply that when we build your itinerary.`;
    }

    case 'add_place': {
      if (!params.hasTrip || !params.onAddPlace) {
        params.onPreference?.(`Must visit: ${intent.placeQuery}`);
        return `I'll remember “${intent.placeQuery}”. Ask again after the itinerary is ready to drop it on a day.`;
      }
      try {
        return await params.onAddPlace(intent.placeQuery);
      } catch {
        return `I couldn't add “${intent.placeQuery}”. Try a clearer place name.`;
      }
    }

    case 'preference': {
      params.onPreference?.(intent.note);
      return `Noted: “${intent.note}”.`;
    }

    default:
      return 'Tell me a preference, a place to visit, or how to rearrange a day.';
  }
}
