import { useEffect, useRef, useState } from 'react';
import { extractTripChat, type TripChatData, type TripChatMessage } from '../../services/tripChatExtraction';
import { geocode } from '../../services/nominatim';
import { geocodeHotel, type HotelMatch } from '../../services/geocodeHotel';
import { parseDaysInput } from '../../data/scheduleOptions';
import { sanitizeAssistantText } from '../../services/sanitizeAssistantText';
import { parseLocationInput } from '../../services/parseLocation';
import { cityCenter } from '../../services/sightLocation';
import { haversineKm } from '../../services/geo';

export interface TripChatState { messages: TripChatMessage[]; data: TripChatData; complete: boolean }

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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(() => savedState?.complete ?? false);
  const [error, setError] = useState('');
  const [addressStatus, setAddressStatus] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [hotelMatches, setHotelMatches] = useState<HotelMatch[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const awaitingHotel = Boolean(data.hasAccommodation && !data.accommodation && data.destination && data.tripLength);
  // Offer exact-location options when we only found an area, or nothing.
  const offerExact = awaitingHotel && (hotelMatches.some((m) => m.approximate) || addressStatus === 'failed');

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { onStateChange({ messages, data, complete }); }, [messages, data, complete, onStateChange]);

  useEffect(() => {
    const query = data.accommodationQuery?.trim();
    const city = data.destination?.trim();
    if (!data.hasAccommodation || data.accommodation || !query || !city) return;
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
          content: `I couldn’t locate “${query}” near ${city}. Try another name or address, or continue without a hotel location.`,
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
    setData(current => ({ ...current, accommodation: { address: match.display_name, latitude: match.lat, longitude: match.lon } }));
    setHotelMatches([]);
    setAddressStatus('idle');
    setComplete(Boolean(data.destination && data.tripLength));
    setMessages(current => [...current, { role: 'user', content: match.approximate ? `Use the center of ${match.display_name}` : `Yes, ${match.display_name}` }, { role: 'assistant', content: 'Location confirmed. You can continue to choose places.' }]);
  }

  /** Pasted coordinates or a Google Maps link. Must lie near the destination. */
  async function usePinnedLocation(lat: number, lon: number, source: string) {
    const city = data.destination ?? '';
    const center = city ? await cityCenter(city) : null;
    if (center && haversineKm(center.lat, center.lon, lat, lon) > 50) {
      setMessages(current => [...current, { role: 'assistant', content: `That point is more than 50 km from ${city}. Check the link or coordinates.` }]);
      return;
    }
    const label = `Pinned location (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    console.info('[locate]', { kind: 'accommodation', name: label, city, provider: source, distanceKm: center ? Number(haversineKm(center.lat, center.lon, lat, lon).toFixed(2)) : null });
    chooseHotel({ lat, lon, name: label, display_name: label, approximate: false });
  }

  function rejectHotel() {
    setHotelMatches([]);
    setData(current => ({ ...current, accommodationQuery: null, accommodation: null }));
    setAddressStatus('failed');
    setMessages(current => [...current, { role: 'user', content: 'No' }, { role: 'assistant', content: 'Send a different hotel name or address, or continue without a hotel location.' }]);
  }

  function skipHotel() {
    setHotelMatches([]);
    setAddressStatus('idle');
    setData(current => ({ ...current, hasAccommodation: false, accommodationQuery: null, accommodation: null }));
    setComplete(Boolean(data.destination && data.tripLength));
    setMessages(current => [...current, { role: 'assistant', content: 'We’ll continue without a hotel location.' }]);
  }

  async function send() {
    const content = input.trim();
    if (!content || loading || addressStatus === 'checking') return;
    if (hotelMatches.length === 1 && /^(yes|yeah|correct)$/i.test(content)) { setInput(''); chooseHotel(hotelMatches[0]); return; }
    if (hotelMatches.length && /^(no|nope)$/i.test(content)) { setInput(''); rejectHotel(); return; }
    if (awaitingHotel) {
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
        await usePinnedLocation(parsed.lat, parsed.lon, content.includes('http') ? 'google-maps-link' : 'coordinates');
        return;
      }
    }
    const nextMessages: TripChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setError('');

    const normalized = content.toLowerCase().replace(/[.!?]+$/g, '').trim();
    if (!data.tripLength && data.destination) {
      const durationText = normalized.replace(/\s+days?$/, '');
      if (/^\d+(?:\s*(?:-|–|to)\s*\d+)?$/.test(durationText)) {
        const duration = parseDaysInput(durationText);
        if (!duration) {
          setMessages([...nextMessages, { role: 'assistant', content: 'Please choose between 1 and 30 days.' }]);
          return;
        }
        const ready = data.hasAccommodation === false || Boolean(data.accommodation);
        setData(current => ({ ...current, tripLength: { ...duration, flexible: Boolean(duration.range) } }));
        setComplete(ready);
        const nextQuestion = ready ? 'You can continue to choose places.' : data.hasAccommodation ? 'What’s the hotel name or address?' : 'Have you already booked a place to stay?';
        setMessages([...nextMessages, { role: 'assistant', content: nextQuestion }]);
        return;
      }
    }
    if (data.hasAccommodation && !data.accommodation && data.destination && data.tripLength) {
      setHotelMatches([]);
      setData(current => ({ ...current, accommodationQuery: content }));
      return;
    }
    const uncertain = /^(?:not sure|unsure|i (?:do not|don't|dont) know|idk|no idea|whatever you recommend|you (?:choose|decide)|any)$/.test(normalized);
    if (!data.tripLength && data.destination && uncertain) {
      const updated = { ...data, tripLength: { days: 4, range: [3, 4] as [number, number], flexible: true } };
      setData(updated);
      setMessages([...nextMessages, { role: 'assistant', content: 'I’d suggest 3 to 4 days to see the highlights without rushing. Have you already booked a place to stay?' }]);
      return;
    }

    if (data.hasAccommodation === null) {
      const negativeBooking = /^(?:no|nope|nah|not yet|i (?:have not|haven't|havent) booked(?: anything| a place)?(?: yet)?|nothing booked(?: yet)?)$/.test(normalized);
      const positiveBooking = /^(?:yes|yeah|yep|i (?:have|already have)|i(?:'ve|ve) booked(?: a place| somewhere)?)$/.test(normalized);
      if (negativeBooking || positiveBooking) {
        const updated = { ...data, hasAccommodation: positiveBooking };
        const readyWithoutAddress = negativeBooking && Boolean(updated.destination && updated.tripLength);
        setData(updated);
        setComplete(readyWithoutAddress);
        setMessages([...nextMessages, {
          role: 'assistant',
          content: positiveBooking
            ? 'What’s the name or address of your hotel?'
            : 'You can continue to choose places.',
        }]);
        return;
      }
    }

    setLoading(true);
    try {
      const result = await extractTripChat(nextMessages, data);
      if (result.data.destination && result.data.destination !== data.destination) {
        const destination = await geocode(result.data.destination);
        if (!destination.result) {
          result.complete = false;
          result.data.destination = null;
          result.assistantMessage = 'I couldn’t verify that destination. Could you give me a city, region, or country name?';
        }
      }
      setData(result.data);
      setComplete(result.complete);
      if (!(result.data.hasAccommodation && result.data.accommodationQuery && !result.data.accommodation)) {
        setMessages((current) => [...current, { role: 'assistant', content: result.assistantMessage }]);
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
        <div><h1>Plan with your travel agent</h1><p>Answer naturally. Short or detailed both work.</p></div>
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
      {!complete ? (
        <form className="interactive-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="interactive-chat-input-shell">
            <textarea aria-label="Your answer" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
            }} placeholder="Tell me about your trip…" rows={1} autoFocus />
            <button type="submit" className="interactive-chat-send" disabled={loading || addressStatus === 'checking' || !input.trim()} aria-label="Send answer">
              <span>Send</span><span className="interactive-send-arrow" aria-hidden>↑</span>
            </button>
          </div>
          <span className="interactive-chat-hint">Enter to send · Shift + Enter for a new line</span>
        </form>
      ) : (
        <button type="button" className="btn btn-primary interactive-ready" onClick={() => onReady(data)}>Ready to choose places</button>
      )}
      <div className="interactive-chat-footer">
        <button type="button" className="chat-form-link" onClick={onPreferForm}>Prefer to fill out a form?</button>
      </div>
    </div>
  );
}
