import { useEffect, useRef, useState } from 'react';
import {
  replyToChat,
  type ChatHandlers,
  type ChatMessage,
} from '../../services/chatbot';
import '../../styles/chat.css';

interface TravelChatBotProps extends ChatHandlers {
  city?: string | null;
  hasTrip: boolean;
}

const SUGGESTIONS_TRIP = [
  'Skip breakfast for now',
  'Let’s plan day 1',
  'Show me parks',
  'Move this to day 3',
];

const SUGGESTIONS_PRE = [
  'I’m vegetarian',
  'Must visit Colosseum',
  'What can you help with?',
];

export function TravelChatBot({
  city,
  hasTrip,
  onDietary,
  onPreference,
  onAddPlace,
  onSkipBreakfast,
  onPlanDay,
  onMoveStop,
  onShowOptions,
}: TravelChatBotProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: hasTrip
        ? `Direct the plan anytime — skip breakfast, plan a day, browse cafés/parks/nightlife, or move a stop between days.`
        : 'I’m always here under the screen. Share diet prefs or must-visit places before or during planning.',
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = hasTrip ? SUGGESTIONS_TRIP : SUGGESTIONS_PRE;

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, expanded]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setExpanded(true);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: trimmed },
    ]);
    setInput('');
    setBusy(true);

    const reply = await replyToChat({
      message: trimmed,
      city,
      hasTrip,
      onDietary,
      onPreference,
      onAddPlace,
      onSkipBreakfast,
      onPlanDay,
      onMoveStop,
      onShowOptions,
    });

    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: 'assistant', text: reply },
    ]);
    setBusy(false);
  }

  return (
    <div className={`chat-dock ${expanded ? 'chat-dock--open' : ''}`}>
      {expanded && (
        <div className="chat-dock-transcript">
          <div className="chat-dock-transcript-head">
            <strong>Travel assistant</strong>
            <button type="button" className="btn btn-ghost" onClick={() => setExpanded(false)}>
              Minimize
            </button>
          </div>
          <div className="chatbot-messages">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`chatbot-bubble chatbot-bubble--${m.role}`}
              >
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="chatbot-bubble chatbot-bubble--assistant chatbot-typing">
                Working…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      <div className="chat-dock-bar">
        <div className="chat-dock-suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => void send(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="chat-dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <span className="chat-dock-icon" aria-hidden>
            💬
          </span>
          <input
            type="text"
            value={input}
            placeholder={
              hasTrip
                ? 'Tell me what to do… e.g. skip breakfast, plan day 1, move Pantheon to day 3'
                : 'Ask the assistant… e.g. vegetarian, must visit Colosseum'
            }
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setExpanded(true)}
            disabled={busy}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
