import { geocode } from './nominatim';
import { haversineKm } from './geo';
import type { ItineraryStop } from '../types';

export interface ChatAction {
  label: string;
  /** Sent as the next user message when clicked. */
  value: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: ChatAction[];
}

/** Handlers may return plain text or text + quick-action chips. */
export type ChatReply = string | { text: string; actions?: ChatAction[] };

export function normalizeChatReply(reply: ChatReply): {
  text: string;
  actions?: ChatAction[];
} {
  if (typeof reply === 'string') return { text: reply };
  return { text: reply.text, actions: reply.actions };
}

export type ChatIntent =
  | { type: 'dietary'; label: string; breakfastHint: string }
  | { type: 'add_place'; placeQuery: string; toDay?: number }
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
  /(?:(?:want to|wanna|would like to|I'd like to|i want to)\s+(?:visit|go to|see|check out)|(?:add|include|put|find|look\s*up|search\s+for)\s+(?:in\s+)?(?:the\s+)?(?:trip|itinerary)?\s*|visit|go to|see|find|look\s*up)\s+(.+)/i;

/** “add Pantheon to group 1” / “put Trevi in the first group” */
const ADD_TO_GROUP_RE =
  /(?:add|put|include)\s+["“]?(.+?)["”]?\s+(?:to|onto|in|into|on)\s+(?:the\s+)?(?:(first|second|third|1st|2nd|3rd)(?:\s*(?:group|day))?|(?:(?:day|group)\s*)(\d+)(?:st|nd|rd|th)?)/i;

const MOVE_RE =
  /move\s+["“]?(.+?)["”]?\s+(?:to|onto)\s+(?:the\s+)?(?:(?:day|group)\s*)?(\d+)(?:st|nd|rd|th)?/i;

const PLAN_DAY_RE =
  /(?:plan|let'?s plan|show|start with|focus on|open)\s+(?:the\s+)?(?:(first|second|third|1st|2nd|3rd)(?:\s*(?:day|group))?|(?:(?:day|group)\s*)(\d+)(?:st|nd|rd|th)?)/i;

function ordinalToDay(raw: string | undefined): number | null {
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key === 'first' || key === '1st' || key === '1') return 1;
  if (key === 'second' || key === '2nd' || key === '2') return 2;
  if (key === 'third' || key === '3rd' || key === '3') return 3;
  if (/^\d+$/.test(key)) return Number(key);
  return null;
}

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

  const addToGroup = text.match(ADD_TO_GROUP_RE);
  if (addToGroup?.[1]) {
    const toDay =
      ordinalToDay(addToGroup[2]) ?? ordinalToDay(addToGroup[3]) ?? 1;
    const placeQuery = addToGroup[1]
      .replace(/[?.!]+$/, '')
      .replace(/\bplease\b/gi, '')
      .trim();
    if (placeQuery.length > 1) {
      return { type: 'add_place', placeQuery, toDay };
    }
  }

  const plan = text.match(PLAN_DAY_RE);
  if (
    plan ||
    /plan\s+first\s+(?:day|group)|let'?s\s+plan\s+(?:day|group)\s*1|show\s+(me\s+)?(options|places)/i.test(
      text,
    )
  ) {
    const day = ordinalToDay(plan?.[1] || plan?.[2]) ?? 1;
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
  /** Optional toDay = group/day number (1-based). May return action chips. */
  onAddPlace?: (
    placeQuery: string,
    toDay?: number,
  ) => Promise<ChatReply> | ChatReply;
  onSkipBreakfast?: () => ChatReply | Promise<ChatReply>;
  onPlanDay?: (day: number) => ChatReply | Promise<ChatReply>;
  onMoveStop?: (
    stopName: string,
    toDay: number,
  ) => ChatReply | Promise<ChatReply>;
  onShowOptions?: (category: string) => ChatReply | Promise<ChatReply>;
  /**
   * Intercept pending lookup flow (pick option / confirm group).
   * Return null to fall through to normal intent parsing.
   */
  onChatCommand?: (message: string) => Promise<ChatReply | null> | ChatReply | null;
}

export async function replyToChat(params: {
  message: string;
  city?: string | null;
  hasTrip: boolean;
} & ChatHandlers): Promise<ChatReply> {
  if (params.onChatCommand) {
    const intercepted = await params.onChatCommand(params.message);
    if (intercepted != null) return intercepted;
  }

  const intent = parseChatIntent(params.message);

  switch (intent.type) {
    case 'greeting':
      return params.hasTrip
        ? `Hi! Look up a place (“find Pantheon”), then I’ll suggest a group. Or move one (“move Trevi to group 2”).`
        : 'Hi! Share preferences (vegetarian, must-visit places). Once groups are ready, I can rearrange them too.';

    case 'help':
      return [
        'Try:',
        '• “Find Pantheon” or “I want to visit the Pantheon”',
        '• Then tap Add to Group N (photos load after)',
        '• “Move Colosseum to group 2”',
        '• “Show group 1”',
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
        return 'Finish building your groups first, then ask me to show a specific group.';
      }
      return await params.onPlanDay(intent.day);
    }

    case 'move_stop': {
      if (!params.hasTrip || !params.onMoveStop) {
        return 'That works once your nearby groups exist. Then tell me which place to move.';
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
        return `I'll remember “${intent.placeQuery}”. Ask again after groups are ready to drop it in.`;
      }
      try {
        return await params.onAddPlace(intent.placeQuery, intent.toDay);
      } catch {
        return `Couldn't find “${intent.placeQuery}”. Try a neighborhood name or exact address.`;
      }
    }

    case 'preference': {
      params.onPreference?.(intent.note);
      return `Noted: “${intent.note}”. Say “help” for ways to change groups.`;
    }

    default:
      return 'Tell me a place to look up, or how to rearrange a group (e.g. “move X to group 2”).';
  }
}
