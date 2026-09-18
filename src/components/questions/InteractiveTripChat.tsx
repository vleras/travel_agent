import { useEffect, useRef, useState } from 'react';
import { extractTripChat, type TripChatData, type TripChatMessage } from '../../services/tripChatExtraction';
import { geocode } from '../../services/nominatim';
import { AddressSearchMap } from '../shared/AddressSearchMap';

export interface TripChatState { messages: TripChatMessage[]; data: TripChatData; complete: boolean }

interface InteractiveTripChatProps {
  initialDestination?: string;
  onPreferForm: () => void;
  onReady: (data: TripChatData) => void;
  savedState?: TripChatState | null;
  onStateChange: (state: TripChatState) => void;
}

const emptyData = (destination?: string): TripChatData => ({
  destination: destination || null, tripLength: null, hasAccommodation: null, accommodationPreference: null, accommodation: null,
  interests: [], budget: null, travelDates: null, extraPreferences: [],
});

export function InteractiveTripChat({ initialDestination, onPreferForm, onReady, savedState, onStateChange }: InteractiveTripChatProps) {
  const opening = initialDestination
    ? `${initialDestination} sounds great! How many days are you planning, and are your dates flexible?`
    : "Let's plan your trip! Where are you thinking of traveling?";
  const [messages, setMessages] = useState<TripChatMessage[]>(() => savedState?.messages ?? [{ role: 'assistant', content: opening }]);
  const [data, setData] = useState<TripChatData>(() => savedState?.data ?? emptyData(initialDestination));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(() => savedState?.complete ?? false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { onStateChange({ messages, data, complete }); }, [messages, data, complete, onStateChange]);

  async function send() {
    const content = input.trim();
    if (!content || loading) return;
    const nextMessages: TripChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setError('');

    const normalized = content.toLowerCase().replace(/[.!?]+$/g, '').trim();
    const uncertain = /^(?:not sure|unsure|i (?:do not|don't|dont) know|idk|no idea|whatever you recommend|you (?:choose|decide)|any)$/.test(normalized);
    if (!data.tripLength && data.destination && uncertain) {
      const updated = { ...data, tripLength: { days: 4, range: [3, 4] as [number, number], flexible: true } };
      setData(updated);
      setMessages([...nextMessages, { role: 'assistant', content: `No problem — I’d suggest 3–4 days for ${data.destination}, which gives you enough time for the highlights without rushing. Have you already booked a place to stay?` }]);
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
            ? 'Okay — please confirm the address below. I use it to anchor each day, estimate travel time, and keep your itinerary compact.'
            : 'Okay — no problem. I have everything I need, so you can continue to the place suggestions.',
        }]);
        return;
      }
    }

    setLoading(true);
    try {
      const result = await extractTripChat(nextMessages, data);
      if (result.complete && result.data.destination) {
        const destination = await geocode(result.data.destination);
        if (!destination.result) {
          result.complete = false;
          result.data.destination = null;
          result.assistantMessage = 'I couldn’t verify that destination. Could you give me a city, region, or country name?';
        }
      }
      setData(result.data);
      setComplete(result.complete);
      setMessages((current) => [...current, { role: 'assistant', content: result.assistantMessage }]);
    } catch {
      const clarification = !data.destination
        ? 'I didn’t quite catch the destination. Which city, region, or country would you like to visit?'
        : !data.tripLength
          ? `No problem — I’d usually suggest 3–4 days for ${data.destination}. Would that work for you?`
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
        <div><h1>Plan with your travel agent</h1><p>Answer naturally — short or detailed both work.</p></div>
      </div>
      <div className="interactive-chat-thread" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`interactive-chat-message interactive-chat-message--${message.role}`}>
            {message.content}
          </div>
        ))}
        {loading && <div className="interactive-chat-message interactive-chat-message--assistant chatbot-typing">Thinking…</div>}
        {error && <div className="interactive-chat-error" role="alert">{error}</div>}
        <div ref={endRef} />
      </div>
      {data.hasAccommodation && !data.accommodation && data.destination && (
        <div className="interactive-chat-address">
          <p><strong>Confirm where you’re staying</strong><br />We use this location to anchor each day, estimate travel distances, and keep your itinerary compact.</p>
          <AddressSearchMap city={data.destination} value={null} onConfirm={(accommodation) => {
            const updated = { ...data, accommodation };
            const isReady = Boolean(updated.destination && updated.tripLength);
            setData(updated);
            setComplete(isReady);
            setMessages((current) => [...current, { role: 'assistant', content: `Location confirmed. I’ll use ${accommodation.address} as the starting point for your daily routes.` }]);
          }} />
        </div>
      )}
      {!complete ? (
        <form className="interactive-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="interactive-chat-input-shell">
            <textarea aria-label="Your answer" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
            }} placeholder="Tell me about your trip…" rows={1} autoFocus />
            <button type="submit" className="interactive-chat-send" disabled={loading || !input.trim()} aria-label="Send answer">
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
