export interface TravelDateState {
  travelDates: string | null;
  datesAsked?: boolean;
  datesStatus?: "provided" | "flexible";
  startDate?: string | null;
  dateError?: 'past' | 'invalid';
}

export const DATES_QUESTION = "What exact date would you like to start your trip?";
export const READY_MESSAGE = "You can continue to choose places.";
export const PAST_DATE_MESSAGE = 'That date has already passed. What start date works for you from today onward?';
export const INVALID_DATE_MESSAGE = 'That date isn’t valid. What date would you like to start your trip?';

function rejectedDate(reason: 'past' | 'invalid'): Partial<TravelDateState> {
  return { travelDates: null, startDate: null, datesStatus: undefined, dateError: reason, datesAsked: true };
}

/** A changed duration needs a fresh date answer, including previously flexible trips. */
export function resetDatesForChangedDays<T extends TravelDateState & { tripLength?: { days: number } | null }>(previous: T, next: T): T {
  const days = next.tripLength?.days;
  if (!previous.tripLength || !Number.isInteger(days) || days! < 1 || days! > 30 || days === previous.tripLength.days) return next;
  return { ...next, travelDates: null, startDate: null, datesStatus: undefined, datesAsked: false, dateError: undefined };
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function hasDateAnswer(data: TravelDateState, today = localToday()): boolean {
  if (data.dateError || (data.startDate && (!isISODate(data.startDate) || data.startDate < today))) return false;
  return data.datesStatus === "flexible" || Boolean(data.travelDates?.trim());
}

export function hasCoreTripDetails(data: { destination?: string | null; tripLength?: unknown; hasAccommodation?: boolean | null; accommodation?: unknown }): boolean {
  return Boolean(data.destination?.trim() && data.tripLength && (data.hasAccommodation === false || (data.hasAccommodation === true && data.accommodation)));
}

/** Shared by local chat shortcuts and the API. The model cannot bypass this step. */
export function enforceDateStep<T extends TravelDateState & Parameters<typeof hasCoreTripDetails>[0]>(data: T, assistantMessage: string, today = localToday()) {
  const dateError = data.startDate
    ? !isISODate(data.startDate) ? 'invalid' : data.startDate < today ? 'past' : undefined
    : data.datesStatus === 'flexible' ? undefined : data.dateError;
  if (dateError) {
    return { data: { ...data, ...rejectedDate(dateError) }, complete: false, assistantMessage: dateError === 'past' ? PAST_DATE_MESSAGE : INVALID_DATE_MESSAGE };
  }
  data = { ...data, dateError: undefined };
  const coreReady = hasCoreTripDetails(data);
  const complete = coreReady && hasDateAnswer(data, today);
  return {
    data: coreReady && !complete ? { ...data, datesAsked: true } : data,
    complete,
    assistantMessage: complete ? READY_MESSAGE : coreReady ? DATES_QUESTION : assistantMessage,
  };
}

/** Deterministic answers remain usable even if the language-model request fails. */
export function parseDateAnswer(text: string, asked: boolean, today = localToday()): Partial<TravelDateState> | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/[‘’]/g, "'");
  if (asked && /^(?:no|not yet|no preference|not sure|unsure|flexible|skip|i (?:don't|do not) know|don't know|i'm not sure|i am not sure)$/.test(normalized)) {
    return { datesAsked: true, datesStatus: "flexible", travelDates: null, startDate: null, dateError: undefined };
  }

  // Try ISO date format (YYYY-MM-DD)
  const exact = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (exact) {
    if (!isISODate(exact)) return rejectedDate('invalid');
    if (exact < today) return rejectedDate('past');
    return { datesStatus: "provided", travelDates: text.trim(), startDate: exact, dateError: undefined };
  }

  // Handle "today" or "tomorrow"
  if (/^(?:today|tomorrow)$/.test(normalized) && isISODate(today)) {
    const date = new Date(`${today}T12:00:00Z`);
    if (normalized === "tomorrow") date.setUTCDate(date.getUTCDate() + 1);
    const isoDate = date.toISOString().slice(0, 10);
    if (isoDate < today && normalized !== "today") return null; // Reject past dates (allow "today")
    return { datesStatus: "provided", travelDates: text.trim(), startDate: isoDate, dateError: undefined };
  }

  // Try natural date formats: "17 september", "september 17", "17th september", etc.
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
  };

  // Match patterns: "17 september", "september 17", "17th september", "sept 17", etc.
  const datePatterns = [
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(\w+)\s*(\d{4})?$/,  // "17 september 2025" or "17th of september"
    /^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(\d{4})?$/              // "september 17" or "september 17 2025"
  ];

  for (const pattern of datePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      let day: number, month: number, year: number;

      if (pattern === datePatterns[0]) {
        // "17 september" format
        day = parseInt(match[1], 10);
        month = months[match[2]];
        year = match[3] ? parseInt(match[3], 10) : new Date(`${today}T12:00:00Z`).getUTCFullYear();
      } else {
        // "september 17" format
        month = months[match[1]];
        day = parseInt(match[2], 10);
        year = match[3] ? parseInt(match[3], 10) : new Date(`${today}T12:00:00Z`).getUTCFullYear();
      }

      if (!month) continue;
      if (day < 1 || day > 31) return rejectedDate('invalid');

      // Create date and validate it’s real (e.g., not Feb 31)
      const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return rejectedDate('invalid');

      const isoDate = date.toISOString().slice(0, 10);
      if (isISODate(isoDate)) {
        if (isoDate < today) return rejectedDate('past');
        return { datesStatus: "provided", travelDates: text.trim(), startDate: isoDate, dateError: undefined };
      }
    }
  }

  return null;
}
