import type { Interest, TripAccommodation } from '../types';
import { enforceDateStep, hasCoreTripDetails, hasDateAnswer, isISODate, localToday, parseDateAnswer, resetDatesForChangedDays, type TravelDateState } from './tripDates';

export interface TripChatData extends TravelDateState {
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
export type TripChatIntent = 'hotel_answer' | 'change_destination' | 'change_days' | 'change_hotel' | 'skip_hotel' | 'dates_answer' | 'question' | 'other';
export interface TripChatResult { assistantMessage: string; data: TripChatData; missing: string[]; complete: boolean; intent: TripChatIntent; hotelName?: string | null; area?: string | null }

const allowedInterests = new Set<Interest>(['museums','food','art','nature','nightlife','shopping','beach','architecture','photography']);

export async function extractTripChat(messages: TripChatMessage[], current: TripChatData): Promise<TripChatResult> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch('/api/deepseek/trip-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, current, today: localToday() }), signal: AbortSignal.timeout(65000),
      });
      if (response.ok || response.status < 500) break;
    } catch {
      if (attempt === 1) throw new Error('Trip chat request failed');
    }
  }
  if (!response?.ok) throw new Error('Trip chat request failed');
  const result = await response.json() as TripChatResult;
  if (!result.data || typeof result.assistantMessage !== 'string') throw new Error('Invalid trip chat response');
  const intents: TripChatIntent[] = ['hotel_answer', 'change_destination', 'change_days', 'change_hotel', 'skip_hotel', 'dates_answer', 'question', 'other'];
  if (!intents.includes(result.intent)) throw new Error('Missing trip chat intent');
  const extracted = result.data;
  let data = { ...current };
  if (result.intent === 'change_destination') {
    data = { ...current, destination: extracted.destination, tripLength: extracted.tripLength ?? current.tripLength, hasAccommodation: null, accommodation: null, accommodationQuery: null, accommodationPreference: null, extraPreferences: [] };
  } else if (result.intent === 'change_days') {
    data.tripLength = extracted.tripLength ?? current.tripLength;
  } else if (result.intent === 'hotel_answer' || result.intent === 'change_hotel') {
    const name = typeof result.hotelName === 'string' ? result.hotelName.trim() : '';
    const area = typeof result.area === 'string' ? result.area.trim() : '';
    data = { ...current, hasAccommodation: true, accommodation: null, accommodationQuery: name ? [name, area].filter(Boolean).join(', ') : null };
  } else if (result.intent === 'skip_hotel') {
    data = { ...current, hasAccommodation: false, accommodation: null, accommodationQuery: null, accommodationPreference: null };
  } else if (!current.destination || !current.tripLength) {
    data = { ...current, destination: current.destination ?? extracted.destination, tripLength: current.tripLength ?? extracted.tripLength };
  }
  const lastMessage = messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
  const deterministicDates = parseDateAnswer(lastMessage, Boolean(current.datesAsked && !hasDateAnswer(current)));
  if (deterministicDates) data = { ...data, ...deterministicDates };
  else if (result.intent === 'dates_answer' && extracted.dateError) {
    data = { ...data, travelDates: null, startDate: null, datesStatus: undefined, dateError: extracted.dateError };
  }
  else if (result.intent === 'dates_answer' && current.datesAsked && extracted.datesStatus === 'flexible') {
    data = { ...data, datesStatus: 'flexible', travelDates: null, startDate: null };
  }
  else if (typeof extracted.travelDates === 'string' && extracted.travelDates.trim() && (result.intent === 'dates_answer' || lastMessage.toLowerCase().includes(extracted.travelDates.toLowerCase()))) {
    data = { ...data, travelDates: extracted.travelDates.trim(), datesStatus: 'provided', startDate: isISODate(extracted.startDate) ? extracted.startDate : null, dateError: extracted.startDate && !isISODate(extracted.startDate) ? 'invalid' : undefined };
  }
  data = resetDatesForChangedDays(current, data);
  result.data = data;
  let invalidTripLength = false;
  if (data.tripLength) {
    const range = data.tripLength.range;
    const invalidRange = range && (!Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 1 || range[1] > 30 || range[0] > range[1]);
    if (!Number.isInteger(data.tripLength.days) || data.tripLength.days < 1 || data.tripLength.days > 30 || invalidRange) { data.tripLength = null; invalidTripLength = true; }
  }
  data.interests = Array.isArray(data.interests) ? data.interests.filter((item): item is Interest => allowedInterests.has(item)) : [];
  data.extraPreferences = Array.isArray(data.extraPreferences) ? data.extraPreferences.filter((v): v is string => typeof v === 'string').slice(0, 10) : [];
  if (invalidTripLength) {
    result.assistantMessage = 'Choose between 1 and 30 days. If you’re unsure, I’d suggest 3 to 4 days.';
    result.missing = Array.from(new Set([...(result.missing ?? []), 'tripLength']));
  }
  const gated = enforceDateStep(data, result.assistantMessage);
  result.data = gated.data;
  result.assistantMessage = gated.assistantMessage;
  result.complete = gated.complete;
  if (hasCoreTripDetails(data) && !hasDateAnswer(data)) result.missing = ['travelDates'];
  if (result.complete) {
    result.missing = [];
  }
  return result;
}
