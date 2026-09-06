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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: hasTrip
        ? `Direct the plan anytime — skip breakfast, plan a day, browse cafés/parks/nightlife, or move a stop between days.`
        : 'Share diet prefs or must-visit places before or during planning.',
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = hasTrip ? SUGGESTIONS_TRIP : SUGGESTIONS_PRE;

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setOpen(true);
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
    <div className={`chat-fab-wrap ${open ? 'chat-fab-wrap--open' : ''}`}>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Travel assistant">
          <div className="chat-panel-head">
            <strong>Travel assistant</strong>
            <button
              type="button"
              className="chat-panel-close"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              ×
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
          <div className="chat-panel-suggestions">
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
            className="chat-panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              placeholder={
                hasTrip
                  ? 'e.g. skip breakfast, plan day 1…'
                  : 'e.g. vegetarian, must visit…'
              }
              onChange={(e) => setInput(e.target.value)}
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
      )}

      <button
        type="button"
        className="chat-fab"
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <span aria-hidden>×</span>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.2a.8.8 0 0 1-1.3-.6V16h-.5A2.5 2.5 0 0 1 4 13.5v-7Z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
