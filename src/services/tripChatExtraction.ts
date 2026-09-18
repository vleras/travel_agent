import type { Interest, TripAccommodation } from '../types';

export interface TripChatData {
  destination: string | null;
  tripLength: { days: number; range: [number, number] | null; flexible: boolean } | null;
  hasAccommodation: boolean | null;
  accommodationQuery: string | null;
  accommodationPreference: string | null;
  accommodation: TripAccommodation | null;
  interests: Interest[];
  budget: string | null;
  travelDates: string | null;
  extraPreferences: string[];
}

export interface TripChatMessage { role: 'user' | 'assistant'; content: string }
export interface TripChatResult { assistantMessage: string; data: TripChatData; missing: string[]; complete: boolean }

const allowedInterests = new Set<Interest>(['museums','food','art','nature','nightlife','shopping','beach','architecture','photography']);

export async function extractTripChat(messages: TripChatMessage[], current: TripChatData): Promise<TripChatResult> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch('/api/deepseek/trip-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, current }), signal: AbortSignal.timeout(65000),
      });
      if (response.ok || response.status < 500) break;
    } catch {
      if (attempt === 1) throw new Error('Trip chat request failed');
    }
  }
  if (!response?.ok) throw new Error('Trip chat request failed');
  const result = await response.json() as TripChatResult;
  const data = result.data;
  data.accommodation = current.accommodation ?? null;
  data.accommodationQuery = data.accommodationQuery ?? current.accommodationQuery ?? null;
  if (!data || typeof result.assistantMessage !== 'string') throw new Error('Invalid trip chat response');
  let invalidTripLength = false;
  if (data.tripLength) {
    const range = data.tripLength.range;
    const invalidRange = range && (!Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 1 || range[1] > 30 || range[0] > range[1]);
    if (!Number.isInteger(data.tripLength.days) || data.tripLength.days < 1 || data.tripLength.days > 30 || invalidRange) { data.tripLength = null; invalidTripLength = true; }
  }
  data.interests = Array.isArray(data.interests) ? data.interests.filter((item): item is Interest => allowedInterests.has(item)) : [];
  data.extraPreferences = Array.isArray(data.extraPreferences) ? data.extraPreferences.filter((v): v is string => typeof v === 'string').slice(0, 10) : [];
  if (invalidTripLength) {
    result.assistantMessage = 'Please choose a trip length between 1 and 30 days. If you’re unsure, I recommend a flexible 3–4 day trip.';
    result.missing = Array.from(new Set([...(result.missing ?? []), 'tripLength']));
  }
  if (data.hasAccommodation && data.accommodationQuery && !data.accommodation) {
    result.assistantMessage = 'Got it.';
  }
  result.complete = Boolean(data.destination?.trim() && data.tripLength && data.hasAccommodation !== null && (!data.hasAccommodation || Boolean(data.accommodation)));
  if (result.complete) {
    const duration = data.tripLength?.range ? `${data.tripLength.range[0]}–${data.tripLength.range[1]} days` : `${data.tripLength?.days} days`;
    result.missing = [];
    const extras = [data.interests.length ? `interests in ${data.interests.join(', ')}` : '', data.budget ? `${data.budget} budget` : ''].filter(Boolean).join(', ');
    result.assistantMessage = `Great — I have everything I need: ${duration} in ${data.destination}${extras ? `, ${extras}` : ''}. Your trip is ready for attraction choices.`;
  }
  return result;
}
