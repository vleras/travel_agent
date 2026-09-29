export interface TravelDateState {
  travelDates: string | null;
  datesAsked?: boolean;
  datesStatus?: 'provided' | 'flexible';
  startDate?: string | null;
}

export const DATES_QUESTION = 'What exact date would you like to start your trip?';
export const READY_MESSAGE = 'You can continue to choose places.';

/** A changed duration needs a fresh date answer, including previously flexible trips. */
export function resetDatesForChangedDays<T extends TravelDateState & { tripLength?: { days: number } | null }>(previous: T, next: T): T {
  const days = next.tripLength?.days;
  if (!previous.tripLength || !Number.isInteger(days) || days! < 1 || days! > 30 || days === previous.tripLength.days) return next;
  return { ...next, travelDates: null, startDate: null, datesStatus: undefined, datesAsked: false };
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function hasDateAnswer(data: TravelDateState): boolean {
  return data.datesStatus === 'flexible' || Boolean(data.travelDates?.trim());
}

export function hasCoreTripDetails(data: { destination?: string | null; tripLength?: unknown; hasAccommodation?: boolean | null; accommodation?: unknown }): boolean {
  return Boolean(data.destination?.trim() && data.tripLength && (data.hasAccommodation === false || (data.hasAccommodation === true && data.accommodation)));
}

/** Shared by local chat shortcuts and the API. The model cannot bypass this step. */
export function enforceDateStep<T extends TravelDateState & Parameters<typeof hasCoreTripDetails>[0]>(data: T, assistantMessage: string) {
  const coreReady = hasCoreTripDetails(data);
  const complete = coreReady && hasDateAnswer(data);
  return {
    data: coreReady && !complete ? { ...data, datesAsked: true } : data,
    complete,
    assistantMessage: complete ? READY_MESSAGE : coreReady ? DATES_QUESTION : assistantMessage,
  };
}

/** Deterministic answers remain usable even if the language-model request fails. */
export function parseDateAnswer(text: string, asked: boolean, today = localToday()): Partial<TravelDateState> | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/[’]/g, "'");
  if (asked && /^(?:no|not yet|no preference|not sure|unsure|flexible|skip|i (?:don't|do not) know|don't know|i'm not sure|i am not sure)$/.test(normalized)) {
    return { datesAsked: true, datesStatus: 'flexible', travelDates: null, startDate: null };
  }
  const exact = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (exact && isISODate(exact)) return { datesStatus: 'provided', travelDates: text.trim(), startDate: exact };
  if (/^(?:today|tomorrow)$/.test(normalized) && isISODate(today)) {
    const date = new Date(`${today}T12:00:00Z`);
    if (normalized === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1);
    return { datesStatus: 'provided', travelDates: text.trim(), startDate: date.toISOString().slice(0, 10) };
  }
  return null;
}
