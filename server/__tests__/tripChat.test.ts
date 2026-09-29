import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { tripChatHandler } from '../tripChat';

afterEach(() => vi.restoreAllMocks());

it('forces the date question even when DeepSeek prematurely completes with invented dates', async () => {
  const current = { destination: 'Prague', tripLength: { days: 4 }, hasAccommodation: null, accommodation: null, travelDates: null };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'skip_hotel', assistantMessage: 'You can continue to choose places.', data: { ...current, hasAccommodation: false, travelDates: 'next weekend', startDate: '2026-10-03' }, complete: true }) } }] })));
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const req = Readable.from([JSON.stringify({ current, messages: [{ role: 'user', content: "I haven't booked yet" }] })]) as IncomingMessage;
  req.method = 'POST';
  const writeHead = vi.fn();
  const end = vi.fn();
  await tripChatHandler(req, { writeHead, end } as unknown as ServerResponse, { DEEPSEEK_API_KEY: 'test-only' });
  expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  expect(JSON.parse(end.mock.calls[0][0])).toMatchObject({ complete: false, assistantMessage: 'What exact date would you like to start your trip?', data: { datesAsked: true, travelDates: null, startDate: null } });
  expect(log).toHaveBeenCalledWith('[trip-chat]', expect.objectContaining({ stage: 'parsed', modelComplete: true, complete: false }));
});

it('rejects a past model date and keeps the accommodation and duration for the next answer', async () => {
  const current = { destination: 'Prague', tripLength: { days: 4 }, hasAccommodation: false, accommodation: null, datesAsked: true, travelDates: null };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'dates_answer', assistantMessage: 'Ready', data: { ...current, travelDates: 'last Monday', startDate: '2026-09-28' }, complete: true }) } }] })));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const req = Readable.from([JSON.stringify({ today: '2026-09-29', current, messages: [{ role: 'user', content: 'last Monday' }] })]) as IncomingMessage;
  req.method = 'POST';
  const end = vi.fn();
  await tripChatHandler(req, { writeHead: vi.fn(), end } as unknown as ServerResponse, { DEEPSEEK_API_KEY: 'test-only' });
  expect(JSON.parse(end.mock.calls[0][0])).toMatchObject({ complete: false, assistantMessage: expect.stringContaining('already passed'), data: { destination: 'Prague', tripLength: { days: 4 }, hasAccommodation: false, startDate: null, travelDates: null, dateError: 'past' } });
});
