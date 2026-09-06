import { useCallback, useState } from 'react';
import { TravelChatBot } from './components/chat/TravelChatBot';
import { DestinationPicker } from './components/questions/DestinationPicker';
import { EntryPoint } from './components/questions/EntryPoint';
import { QuestionFlow } from './components/questions/QuestionFlow';
import { AgentProcessing } from './components/trip/AgentProcessing';
import { TripView } from './components/trip/TripView';
import { runTravelAgent } from './services/agent';
import type {
  AgentOutput,
  AgentProgress,
  AppScreen,
  DestinationCard,
  TripInput,
} from './types';
import './styles/global.css';

type Path = 'A' | 'B' | null;

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('entry');
  const [path, setPath] = useState<Path>(null);
  const [picked, setPicked] = useState<DestinationCard | null>(null);
  const [input, setInput] = useState<TripInput | null>(null);
  const [output, setOutput] = useState<AgentOutput | null>(null);
  const [progress, setProgress] = useState<AgentProgress>({
    step: 'idle',
    message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [chatNotes, setChatNotes] = useState<string[]>([]);

  const resetToEntry = useCallback(() => {
    setScreen('entry');
    setPath(null);
    setPicked(null);
    setInput(null);
    setOutput(null);
    setError(null);
    setProgress({ step: 'idle', message: '' });
    setChatNotes([]);
  }, []);

  async function startAgent(tripInput: TripInput) {
    const mergedNotes = chatNotes.length
      ? [tripInput.custom_preferences, ...chatNotes].filter(Boolean).join('; ')
      : tripInput.custom_preferences;
    const withChat: TripInput = {
      ...tripInput,
      custom_preferences: mergedNotes || null,
      breakfast_food:
        tripInput.breakfast_food ||
        chatNotes.find((n) => n.startsWith('Diet:'))?.replace('Diet: ', '') ||
        null,
    };

    setInput(withChat);
    setScreen('processing');
    setError(null);
    setProgress({ step: 'reason', message: 'Starting…' });
    try {
      const result = await runTravelAgent(withChat, setProgress);
      setOutput(result);
      setScreen('trip');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent failed');
      setProgress({ step: 'error', message: 'Failed', detail: String(err) });
    }
  }

  const cityHint = picked?.city ?? input?.destination_city ?? null;
  const showGlobalChat = screen !== 'trip';

  return (
    <div className="app-shell">
      {screen === 'entry' && (
        <EntryPoint
          onKnowDestination={() => {
            setPath('A');
            setScreen('questions');
          }}
          onWantSuggestions={() => {
            setPath('B');
            setScreen('questions');
          }}
        />
      )}

      {screen === 'questions' && path === 'B' && !picked && (
        <DestinationPicker
          onBack={resetToEntry}
          onSelect={(dest) => setPicked(dest)}
        />
      )}

      {screen === 'questions' && path && !(path === 'B' && !picked) && (
        <QuestionFlow
          path={path}
          selectedDestination={picked}
          onBack={() => {
            if (path === 'B' && picked) {
              setPicked(null);
              return;
            }
            resetToEntry();
          }}
          onComplete={(tripInput) => {
            void startAgent(tripInput);
          }}
        />
      )}

      {screen === 'processing' && (
        <>
          <AgentProcessing progress={progress} />
          {error && (
            <div style={{ textAlign: 'center', marginTop: '-4rem' }}>
              <p style={{ color: 'var(--coral)' }}>{error}</p>
              <button type="button" className="btn btn-primary" onClick={resetToEntry}>
                Start over
              </button>
            </div>
          )}
        </>
      )}

      {screen === 'trip' && input && output && (
        <TripView
          input={input}
          output={output}
          onBack={resetToEntry}
          initialChatNotes={chatNotes}
        />
      )}

      {showGlobalChat && (
        <TravelChatBot
          city={cityHint}
          hasTrip={false}
          onDietary={(label, breakfastHint) => {
            setChatNotes((prev) => {
              const diet = `Diet: ${label}`;
              const food = `Breakfast: ${breakfastHint}`;
              return [...new Set([...prev.filter((n) => !n.startsWith('Diet:') && !n.startsWith('Breakfast:')), diet, food])];
            });
          }}
          onPreference={(note) => {
            setChatNotes((prev) => (prev.includes(note) ? prev : [...prev, note]));
          }}
        />
      )}
    </div>
  );
}
