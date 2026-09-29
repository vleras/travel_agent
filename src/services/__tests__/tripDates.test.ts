import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATES_QUESTION, PAST_DATE_MESSAGE, enforceDateStep, isISODate, parseDateAnswer } from '../tripDates';
import { extractTripChat, type TripChatData } from '../tripChatExtraction';

const ready: TripChatData = { destination: 'Prague', tripLength: { days: 4, range: null, flexible: false }, hasAccommodation: false, accommodation: null, accommodationQuery: null, accommodationPreference: null, interests: [], budget: null, travelDates: null, extraPreferences: [] };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('required date question with optional dates', () => {
  it.each(['7 september', 'September 7', '2026-09-07'])('keeps the chat open for %s and accepts a corrected date', answer => {
    const rejected = enforceDateStep({ ...ready, ...parseDateAnswer(answer, true) }, 'Ready');
    expect(rejected).toMatchObject({ complete: false, assistantMessage: PAST_DATE_MESSAGE, data: { startDate: null, travelDates: null, datesAsked: true, dateError: 'past' } });
    const corrected = enforceDateStep({ ...rejected.data, ...parseDateAnswer('today', true) }, 'Ready');
    expect(corrected).toMatchObject({ complete: true, data: { startDate: '2026-09-29', dateError: undefined } });
  });
  it('does not let the model roll a past date into next year', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'dates_answer', data: { ...ready, travelDates: '7 september', startDate: '2027-09-07' }, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: '7 september' }], { ...ready, datesAsked: true })).toMatchObject({ complete: false, assistantMessage: PAST_DATE_MESSAGE, data: { startDate: null } });
  });
  it('validates model dates even for wording the local parser does not recognize', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'dates_answer', data: { ...ready, travelDates: 'last Monday', startDate: '2026-09-28' }, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'last Monday' }], { ...ready, datesAsked: true })).toMatchObject({ complete: false, assistantMessage: PAST_DATE_MESSAGE });
  });
  it.each(['31 February', '2026-02-30'])('asks for a valid date after %s', answer => {
    expect(enforceDateStep({ ...ready, ...parseDateAnswer(answer, true) }, 'Ready')).toMatchObject({ complete: false, data: { dateError: 'invalid', startDate: null } });
  });
  it.each(['provided', 'flexible'] as const)('asks dates again after changing days with %s dates', async status => {
    const current: TripChatData = { ...ready, datesAsked: true, datesStatus: status, travelDates: status === 'provided' ? 'October 5' : null, startDate: status === 'provided' ? '2026-10-05' : null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'change_days', data: { ...current, tripLength: { days: 5, range: null, flexible: false } }, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'actually make it 5 days' }], current)).toMatchObject({ complete: false, assistantMessage: DATES_QUESTION, data: { tripLength: { days: 5 }, destination: 'Prague', hasAccommodation: false, datesAsked: true, travelDates: null, startDate: null, datesStatus: undefined } });
  });
  it('keeps dates when the duration has not changed', async () => {
    const current: TripChatData = { ...ready, datesAsked: true, datesStatus: 'provided', travelDates: 'October 5', startDate: '2026-10-05' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'change_days', data: current, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'keep it 4 days' }], current)).toMatchObject({ complete: true, data: { startDate: '2026-10-05' } });
  });
  it('intercepts completion after declining or confirming a hotel', () => {
    for (const data of [ready, { ...ready, hasAccommodation: true, accommodation: { address: 'Hotel', latitude: 50, longitude: 14 } }]) {
      expect(enforceDateStep(data, 'Ready')).toMatchObject({ complete: false, assistantMessage: DATES_QUESTION, data: { datesAsked: true } });
    }
  });
  it('waits for hotel verification before asking for dates', () => {
    expect(enforceDateStep({ ...ready, hasAccommodation: true }, 'Verify hotel')).toMatchObject({ complete: false, assistantMessage: 'Verify hotel' });
  });
  it.each(['no', "I don't know", 'not sure', 'no preference', 'skip'])('accepts %s after the dates question without asking forever', answer => {
    const dates = parseDateAnswer(answer, true);
    expect(dates?.datesStatus).toBe('flexible');
    expect(enforceDateStep({ ...ready, ...dates }, 'Ready').complete).toBe(true);
    expect(parseDateAnswer(answer, false)).toBeNull();
  });
  it('resolves dates without timezone shifts and rejects invalid calendar dates', () => {
    expect(parseDateAnswer('tomorrow', true, '2026-12-31')?.startDate).toBe('2027-01-01');
    expect(parseDateAnswer('2026-10-02', true)?.startDate).toBe('2026-10-02');
    expect(isISODate('2026-02-30')).toBe(false);
    expect(parseDateAnswer('yes', true)).toBeNull();
  });
  it('does not trust the model to mark a trip complete before dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'skip_hotel', data: ready, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'Not booked yet' }], ready)).toMatchObject({ complete: false, assistantMessage: DATES_QUESTION });
  });
  it('merges natural-language dates instead of discarding them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'dates_answer', data: { ...ready, travelDates: 'October 5', startDate: '2026-10-05' }, assistantMessage: 'Ready', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'October 5' }], { ...ready, datesAsked: true })).toMatchObject({ complete: true, data: { startDate: '2026-10-05', travelDates: 'October 5' } });
  });
  it('accepts a model-classified flexible answer after the date question', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ intent: 'dates_answer', data: { ...ready, datesStatus: 'flexible' }, assistantMessage: 'You can choose places.', complete: true }))));
    expect(await extractTripChat([{ role: 'user', content: 'I need to decide on dates later' }], { ...ready, datesAsked: true })).toMatchObject({ complete: true, data: { datesStatus: 'flexible', startDate: null } });
  });
});
