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

    if (data.hasAccommodation === null) {
      const normalized = content.toLowerCase().replace(/[.!?]+$/g, '').trim();
      const negativeBooking = /^(?:no|nope|nah|not yet|i (?:have not|haven't|havent) booked(?: anything| a place)?(?: yet)?|nothing booked(?: yet)?)$/.test(normalized);
      const positiveBooking = /^(?:yes|yeah|yep|i (?:have|already have)|i(?:'ve|ve) booked(?: a place| somewhere)?)$/.test(normalized);
      if (negativeBooking || positiveBooking) {
        const updated = { ...data, hasAccommodation: positiveBooking };
        setData(updated);
        setMessages([...nextMessages, {
          role: 'assistant',
          content: positiveBooking
            ? 'Okay — please confirm the address below. I use it to anchor each day, estimate travel time, and keep your itinerary compact.'
            : 'Okay — no problem. What kinds of activities interest you most, such as history, food, nature, beaches, nightlife, or shopping?',
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
      setError('I couldn’t process that answer. Please try again.');
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
            const isReady = Boolean(updated.destination && updated.tripLength && updated.interests.length && updated.budget);
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
