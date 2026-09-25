import type { IncomingMessage, ServerResponse } from 'node:http';

export async function tripChatHandler(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined>) {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  if (req.method !== 'POST') return send(405, { error: 'Use POST' });
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Invalid origin' });
  if (!env.DEEPSEEK_API_KEY?.trim()) return send(503, { error: 'DeepSeek is not configured' });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 50000) return send(413, { error: 'Conversation too large' });
    }
    let body: { messages?: unknown; current?: unknown };
    try { body = JSON.parse(raw) as { messages?: unknown; current?: unknown }; }
    catch { return send(400, { error: 'Invalid request JSON' }); }
    if (!Array.isArray(body.messages) || body.messages.length > 40) return send(400, { error: 'Invalid conversation' });
    const messages = body.messages.filter((m): m is { role: 'user' | 'assistant'; content: string } =>
      Boolean(m) && typeof m === 'object' && ['user', 'assistant'].includes((m as { role?: string }).role ?? '') && typeof (m as { content?: unknown }).content === 'string' && (m as { content: string }).content.length <= 4000,
    );
    if (messages.length !== body.messages.length) return send(400, { error: 'Invalid conversation' });
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY.trim()}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: 1800,
        messages: [
          { role: 'system', content: `You are a friendly travel planning assistant. Extract and merge facts from the conversation with CURRENT_DATA. Ask a concise, conversational follow-up for the most useful missing or ambiguous facts. Never invent user preferences. If the traveler is unsure about duration, recommend a flexible 3–4 day trip and continue; do not treat uncertainty as an error. Required completion fields are destination, tripLength, and hasAccommodation (true or false). Interests and budget are optional: extract them only if volunteered, and never ask follow-up questions for them. Ask only whether the traveler has already booked a place; never ask whether they prefer a hotel, hostel, Airbnb, or any accommodation type. If the traveler gives a hotel, accommodation name, or address, set hasAccommodation=true and preserve exactly what they supplied in accommodationQuery. Tell them the app is verifying that location in the background; never ask them to enter the same hotel or address again. If they only answer yes without identifying the place, ask once for its name or address. If no, set hasAccommodation=false and continue. travelDates is optional and must never appear in missing or prevent completion. Set complete true and missing [] as soon as destination, tripLength, and hasAccommodation exist; explicit answers such as "no preference", "not booked", and "flexible budget" count. tripLength must have days (1-30) and may have range [min,max]. Map interests only to museums, food, art, nature, nightlife, shopping, beach, architecture, photography. Return only JSON: {"assistantMessage":"...","data":{"destination":string|null,"tripLength":{"days":number,"range":[number,number]|null,"flexible":boolean}|null,"hasAccommodation":boolean|null,"accommodationQuery":string|null,"accommodationPreference":string|null,"interests":string[],"budget":string|null,"travelDates":string|null,"extraPreferences":string[]},"missing":string[],"complete":boolean}. When the required trip facts exist and accommodationQuery is present, say the location is being verified in the background. When complete without accommodation, summarize the plan and say it is ready for attraction choices.` },
          { role: 'system', content: 'For every assistantMessage, write like a friendly human travel agent texting: short, casual, and natural. Never use em dashes or en dashes. Use commas, periods, or separate sentences. Write numeric ranges with "to", such as "3 to 4 days". Avoid filler openers like "Great", "No problem", "Perfect", "Absolutely", "Got it", or "Okay". Do not repeat what the user just said unless confirming a detail. Ask at most one question per message. When the trip is complete, simply say it is ready for attraction choices instead of recapping the user’s answers.' },
          { role: 'user', content: `CURRENT_DATA=${JSON.stringify(body.current ?? {})}` },
          ...messages,
        ],
      }),
    });
    if (!response.ok) return send(502, { error: 'DeepSeek request failed', upstreamStatus: response.status });
    const upstream = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const choice = upstream.choices?.[0];
    if (!choice?.message?.content || choice.finish_reason === 'length') return send(502, { error: 'Incomplete response' });
    const content = choice.message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(content) as Record<string, unknown>;
    } catch {
      const object = content.match(/\{[\s\S]*\}/)?.[0];
      if (!object) return send(502, { error: 'DeepSeek returned invalid JSON' });
      try { result = JSON.parse(object) as Record<string, unknown>; }
      catch { return send(502, { error: 'DeepSeek returned invalid JSON' }); }
    }
    if (typeof result.assistantMessage !== 'string' || typeof result.data !== 'object' || !result.data) return send(502, { error: 'Invalid response' });
    return send(200, result);
  } catch {
    return send(502, { error: 'Unable to continue trip chat' });
  }
}
