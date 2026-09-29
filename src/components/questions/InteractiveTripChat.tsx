import { useEffect, useRef, useState } from 'react';
import { extractTripChat, type TripChatData, type TripChatMessage } from '../../services/tripChatExtraction';
import { geocode } from '../../services/nominatim';
import { geocodeHotel, type HotelMatch } from '../../services/geocodeHotel';
import { parseDaysInput } from '../../data/scheduleOptions';
import { sanitizeAssistantText } from '../../services/sanitizeAssistantText';
import { parseLocationInput } from '../../services/parseLocation';
import { cityCenter, reverseLabel } from '../../services/sightLocation';
import { haversineKm } from '../../services/geo';
import { DATES_QUESTION, READY_MESSAGE, enforceDateStep, hasCoreTripDetails, hasDateAnswer, parseDateAnswer, resetDatesForChangedDays } from '../../services/tripDates';

export interface TripChatState {
  messages: TripChatMessage[]; data: TripChatData; complete: boolean;
  draft?: string; hotelMatches?: HotelMatch[]; addressStatus?: 'idle' | 'checking' | 'failed';
}

interface InteractiveTripChatProps {
  initialDestination?: string;
  onPreferForm: () => void;
  onReady: (data: TripChatData) => void;
  savedState?: TripChatState | null;
  onStateChange: (state: TripChatState) => void;
}

const emptyData = (destination?: string): TripChatData => ({
  destination: destination || null, tripLength: null, hasAccommodation: null, accommodationQuery: null, accommodationPreference: null, accommodation: null,
  interests: [], budget: null, travelDates: null, extraPreferences: [],
});

export function InteractiveTripChat({ initialDestination, onPreferForm, onReady, savedState, onStateChange }: InteractiveTripChatProps) {
  const opening = initialDestination
    ? `${initialDestination} sounds great! How many days are you planning?`
    : "Let's plan your trip! Where are you thinking of traveling?";
  const [messages, setMessages] = useState<TripChatMessage[]>(() => savedState?.messages ?? [{ role: 'assistant', content: opening }]);
  const [data, setData] = useState<TripChatData>(() => savedState?.data ?? emptyData(initialDestination));
  const [input, setInput] = useState(savedState?.draft ?? '');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(() => Boolean(savedState?.complete && hasDateAnswer(savedState.data)));
  const [error, setError] = useState('');
  const [addressStatus, setAddressStatus] = useState<'idle' | 'checking' | 'failed'>(savedState?.addressStatus === 'failed' ? 'failed' : 'idle');
  const [hotelMatches, setHotelMatches] = useState<HotelMatch[]>(savedState?.hotelMatches ?? []);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const awaitingHotel = Boolean(data.hasAccommodation && !data.accommodation && data.destination && data.tripLength);
  // Offer exact-location options when we only found an area, or nothing.
  const offerExact = awaitingHotel && (hotelMatches.some((m) => m.approximate) || addressStatus === 'failed');

  function updateTrip(next: TripChatData, message: string, history = messages) {
    const result = enforceDateStep(resetDatesForChangedDays(data, next), message);
    setData(result.data);
    setComplete(result.complete);
    setMessages([...history, { role: 'assistant', content: result.assistantMessage }]);
  }

  // Upgrade previously saved conversations that were completed before dates were asked.
  useEffect(() => {
    if (hasCoreTripDetails(data) && !hasDateAnswer(data) && !data.datesAsked) {
      setData(current => ({ ...current, datesAsked: true }));
      setComplete(false);
      setMessages(current => [...current, { role: 'assistant', content: DATES_QUESTION }]);
    }
  }, [data]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { onStateChange({ messages, data, complete, draft: input, hotelMatches, addressStatus }); }, [messages, data, complete, input, hotelMatches, addressStatus, onStateChange]);

  useEffect(() => {
    const query = data.accommodationQuery?.trim();
    const city = data.destination?.trim();
    if (!data.hasAccommodation || data.accommodation || !query || !city) return;
    if (savedState?.data.accommodationQuery === query && savedState.data.destination === city && savedState.hotelMatches?.length) return;
    let cancelled = false;
    setHotelMatches([]);
    setComplete(false);
    setAddressStatus('checking');
    void geocodeHotel(query, city).then((matches) => {
      if (cancelled) return;
      const match = matches[0];
      if (!match) {
        setAddressStatus('failed');
        setMessages((current) => [...current, {
          role: 'assistant',
          content: `I couldn’t pin down “${query}” in ${city}. Paste the hotel’s coordinates (e.g. 35.8974, 14.5147) or a Google Maps link, or continue without a hotel location.`,
        }]);
        return;
      }
      setHotelMatches(matches);
      setMessages(current => [...current, { role: 'assistant', content: matches.length === 1
        ? match.approximate ? `I found only an area match: ${match.display_name}. Use this area's center as your hotel location?` : `Found ${match.display_name}. Is that correct?`
        : 'I found several possible locations. Choose one below; area matches use an approximate center.' }]);
      setAddressStatus('idle');
    }).catch(() => {
      if (!cancelled) {
        setAddressStatus('failed');
        setMessages(current => [...current, { role: 'assistant', content: 'Location search is unavailable. Try another address or continue without a hotel location.' }]);
      }
    });
    return () => { cancelled = true; };
  }, [data.accommodationQuery, data.destination, data.hasAccommodation, data.accommodation]);

  function chooseHotel(match: HotelMatch) {
    const next = { ...data, accommodation: { address: match.display_name, latitude: match.lat, longitude: match.lon } };
    setHotelMatches([]);
    setAddressStatus('idle');
    updateTrip(next, READY_MESSAGE, [...messages, { role: 'user', content: match.approximate ? `Use the center of ${match.display_name}` : `Yes, ${match.display_name}` }]);
  }

  /** Pasted coordinates or a Google Maps link. Must lie near the destination. */
  async function usePinnedLocation(lat: number, lon: number, source: string) {
    const city = data.destination ?? '';
    const center = city ? await cityCenter(city) : null;
    if (center && haversineKm(center.lat, center.lon, lat, lon) > 50) {
      setMessages(current => [...current, { role: 'assistant', content: `That point is more than 50 km from ${city}. Check the link or coordinates.` }]);
      return;
    }
    setAddressStatus('checking');
    const place = await reverseLabel(lat, lon);
    setAddressStatus('idle');
    const point = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const label = place ? `${place} (${point})` : `Pinned location (${point})`;
    console.info('[locate]', { kind: 'accommodation', name: label, city, provider: source, distanceKm: center ? Number(haversineKm(center.lat, center.lon, lat, lon).toFixed(2)) : null });
    // Confirm before saving, like a name match.
    setHotelMatches([{ lat, lon, name: label, display_name: label, approximate: false }]);
    setMessages(current => [...current, { role: 'assistant', content: `Found ${label}. Is that correct?` }]);
  }

  function rejectHotel() {
    setHotelMatches([]);
    setData(current => ({ ...current, accommodationQuery: null, accommodation: null }));
    setAddressStatus('failed');
    setMessages(current => [...current, { role: 'user', content: 'No' }, { role: 'assistant', content: 'Send a different hotel name or address, or continue without a hotel location.' }]);
  }

  function setInputAndFocusEnd(text: string) {
    setInput(text);
    setComplete(false);
    // Focus and move cursor to end after state updates
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = text.length;
      }
    }, 0);
  }

  function skipHotel() {
    setHotelMatches([]);
    setAddressStatus('idle');
    updateTrip({ ...data, hasAccommodation: false, accommodationQuery: null, accommodation: null }, READY_MESSAGE);
  }

  async function send() {
    const content = input.trim();
    if (!content || loading || addressStatus === 'checking') return;
    if (hasCoreTripDetails(data) && data.datesAsked && !hasDateAnswer(data)) {
      const dateAnswer = parseDateAnswer(content, true);
      if (dateAnswer) {
        setInput('');
        updateTrip({ ...data, ...dateAnswer }, READY_MESSAGE, [...messages, { role: 'user', content }]);
        return;
      }
      if (/^yes[.!]?$/i.test(content)) {
        setInput('');
        setMessages([...messages, { role: 'user', content }, { role: 'assistant', content: 'What date would you like to start your trip?' }]);
        return;
      }
    }
    if (hotelMatches.length === 1 && /^yes$/i.test(content)) { setInput(''); chooseHotel(hotelMatches[0]); return; }
    if (hotelMatches.length && /^no$/i.test(content)) { setInput(''); rejectHotel(); return; }
    // Coordinates and Maps links are read before any search or extraction,
    // whenever a hotel location is still open (not declined, not set).
    if (data.destination && data.hasAccommodation !== false && !data.accommodation) {
      const parsed = parseLocationInput(content);
      if (parsed) {
        setInput('');
        setMessages(current => [...current, { role: 'user', content }]);
        if (parsed.kind === 'short-link') {
          setMessages(current => [...current, { role: 'assistant', content: 'I can’t open short Google Maps links. Open it, copy the full link from the address bar (or the coordinates), and paste that here.' }]);
          return;
        }
        setHotelMatches([]);
        setAddressStatus('idle');
        setData(current => ({ ...current, hasAccommodation: true, accommodationQuery: null }));
        await usePinnedLocation(parsed.lat, parsed.lon, content.includes('http') ? 'google-maps-link' : 'coordinates');
        return;
      }
    }
    const nextMessages: TripChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setError('');

    if (!data.tripLength && data.destination) {
      const durationText = content;
      // Match "4" or "Change to 4" format
      const daysMatch = durationText.match(/^(?:change\s+to\s+)?(\d+)(?:\s+days?)?$/i);
      if (daysMatch) {
        const duration = parseDaysInput(daysMatch[1]);
        if (!duration) {
          setMessages([...nextMessages, { role: ‘assistant’, content: ‘Please choose between 1 and 30 days.’ }]);
          return;
        }
        const ready = data.hasAccommodation === false || Boolean(data.accommodation);
        const next = { ...data, tripLength: { ...duration, flexible: Boolean(duration.range) } };
        const nextQuestion = ready ? ‘You can continue to choose places.’ : data.hasAccommodation ? ‘What\’s the hotel name or address?’ : ‘Have you already booked a place to stay?’;
        updateTrip(next, nextQuestion, nextMessages);
        return;
      }
    }

    if (data.hasAccommodation === null || awaitingHotel) {
      const negativeBooking = /^no$/i.test(content);
      const positiveBooking = /^yes$/i.test(content);
      if (negativeBooking || positiveBooking) {
        const updated = { ...data, hasAccommodation: positiveBooking, accommodationQuery: null, accommodation: null };
        setHotelMatches([]);
        setAddressStatus('idle');
        updateTrip(updated, positiveBooking ? 'What’s the name or address of your hotel?' : READY_MESSAGE, nextMessages);
        return;
      }
    }

    setLoading(true);
    try {
      const result = await extractTripChat(nextMessages, data);
      if (result.intent === 'change_destination' && result.data.destination) {
        const destination = await geocode(result.data.destination);
        if (!destination.result) {
          setMessages(current => [...current, { role: 'assistant', content: 'I couldn’t verify that destination. Could you give me a city, region, or country name?' }]);
          return;
        }
        setHotelMatches([]);
        setAddressStatus('idle');
        setError('');
        result.complete = false;
        result.assistantMessage = result.data.tripLength
          ? `${result.data.destination} it is. Have you booked a place to stay there?`
          : `${result.data.destination} it is. How many days are you planning?`;
      }
      if (['hotel_answer', 'change_hotel', 'skip_hotel'].includes(result.intent)) {
        setHotelMatches([]);
        setAddressStatus('idle');
      }
      setData(result.data);
      // After a change is accepted, stay in chat mode to continue conversation naturally
      setComplete(result.complete);
      if (!(['hotel_answer', 'change_hotel'].includes(result.intent) && result.data.accommodationQuery)) {
        let msg = result.assistantMessage;
        if (result.complete && !(['change_destination', 'change_days'].includes(result.intent))) {
          msg = result.assistantMessage + '\n\nWant to adjust something before choosing places? You can change the destination or number of days.';
        }
        setMessages((current) => [...current, { role: 'assistant', content: msg }]);
      }
    } catch {
      const clarification = !data.destination
        ? 'I didn’t quite catch the destination. Which city, region, or country would you like to visit?'
        : !data.tripLength
          ? 'I’d suggest 3 to 4 days. Would that work for you?'
          : data.hasAccommodation === null
            ? 'I didn’t quite catch that. Have you already booked a place to stay? You can answer yes or no.'
            : 'I didn’t quite understand that, but we can keep going. Could you rephrase it in a few words?';
      setMessages((current) => [...current, { role: 'assistant', content: clarification }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="interactive-trip-chat">
      <div className="interactive-chat-head">
        <div><span className="schedule-guide-avatar" aria-hidden>✈</span></div>
        <div><h1>Plan with your travel agent</h1></div>
      </div>
      <div className="interactive-chat-thread" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`interactive-chat-message interactive-chat-message--${message.role}`}>
            {message.role === 'assistant' ? sanitizeAssistantText(message.content) : message.content}
          </div>
        ))}
        {loading && <div className="interactive-chat-message interactive-chat-message--assistant chatbot-typing">Thinking…</div>}
        {addressStatus === 'checking' && (
          <div className="interactive-chat-message interactive-chat-message--assistant address-verifying" role="status">
            <span className="address-verifying-spinner" aria-hidden />
            <span>Verifying location…</span>
          </div>
        )}
        {error && <div className="interactive-chat-error" role="alert">{error}</div>}
        {hotelMatches.length > 0 && <div className="hotel-match-options">
          {hotelMatches.map((match, index) => <button type="button" className="btn btn-secondary" key={`${match.lat}-${match.lon}-${index}`} onClick={() => chooseHotel(match)}>
            {hotelMatches.length === 1 ? match.approximate ? 'Yes, use area center' : 'Yes' : `${match.display_name}${match.approximate ? ' (area center)' : ''}`}
          </button>)}
          <button type="button" className="btn btn-ghost" onClick={rejectHotel}>{hotelMatches.length === 1 ? 'No' : 'None of these'}</button>
        </div>}
        {offerExact && <div className="interactive-chat-message interactive-chat-message--assistant">
          For an exact spot, paste coordinates (e.g. 41.3275, 19.8187) or a Google Maps link.
        </div>}
        {(hotelMatches.length > 0 || addressStatus !== 'idle') && <button type="button" className="btn btn-ghost" onClick={skipHotel}>Continue without hotel location</button>}
        <div ref={endRef} />
      </div>
      {complete && (
        <div className="interactive-completion-actions">
          <div className="interactive-completion-chips">
            <button
              type="button"
              className="chip"
              onClick={() => setInputAndFocusEnd('Change destination to ')}
            >
              Change destination
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setInputAndFocusEnd('Change to ')}
            >
              Change number of days
            </button>
          </div>
          <button type="button" className="btn btn-primary interactive-ready" onClick={() => onReady(data)}>Ready to choose places</button>
        </div>
      )}
      {!complete && (
        <form className="interactive-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="interactive-chat-input-shell">
            <textarea ref={textareaRef} aria-label="Your answer" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
            }} placeholder={complete ? "Want to change anything?" : "Tell me about your trip…"} rows={1} autoFocus />
            <button type="submit" className="interactive-chat-send" disabled={loading || addressStatus === 'checking' || !input.trim()} aria-label="Send answer">
              <span>Send</span><span className="interactive-send-arrow" aria-hidden>↑</span>
            </button>
          </div>
          <span className="interactive-chat-hint">Enter to send · Shift + Enter for a new line</span>
        </form>
      )}
      <div className="interactive-chat-footer">
        <button type="button" className="chat-form-link" onClick={onPreferForm}>Prefer to fill out a form?</button>
      </div>
    </div>
  );
}
