import type {
  AgentOutput,
  AppScreen,
  DestinationCard,
  TripInput,
} from '../types';

const APP_KEY = 'travel-agent-app-v1';
const DEST_KEY = 'travel-agent-dest-v1';
const QUESTION_KEY = 'travel-agent-questions-v1';

export type Path = 'A' | 'B' | null;

export interface PersistedAppState {
  screen: AppScreen;
  path: Path;
  picked: DestinationCard | null;
  input: TripInput | null;
  output: AgentOutput | null;
  chatNotes: string[];
}

export interface PersistedDestState {
  previewId: string | null;
  highlightName: string | null;
}

export interface PersistedQuestionState {
  path: 'A' | 'B';
  stepIndex: number;
  city: string;
  daysText: string;
  hotelAddress: string;
  notBooked: boolean;
  selectedPlaces: string[];
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function loadAppState(): PersistedAppState | null {
  const state = readJson<PersistedAppState>(APP_KEY);
  if (!state) return null;

  // Mid-run processing shouldn't leave a stuck spinner after refresh
  if (state.screen === 'processing') {
    if (state.input && state.output) {
      return { ...state, screen: 'trip' };
    }
    return {
      ...state,
      screen: 'questions',
      output: null,
    };
  }

  if (state.screen === 'trip' && (!state.input || !state.output)) {
    return { ...state, screen: 'questions', output: null };
  }

  return state;
}

export function saveAppState(state: PersistedAppState) {
  writeJson(APP_KEY, state);
}

export function loadDestState(): PersistedDestState | null {
  return readJson<PersistedDestState>(DEST_KEY);
}

export function saveDestState(state: PersistedDestState) {
  writeJson(DEST_KEY, state);
}

export function clearDestState() {
  sessionStorage.removeItem(DEST_KEY);
}

export function loadQuestionState(path: 'A' | 'B'): PersistedQuestionState | null {
  const state = readJson<PersistedQuestionState>(QUESTION_KEY);
  if (!state || state.path !== path) return null;
  return state;
}

export function saveQuestionState(state: PersistedQuestionState) {
  writeJson(QUESTION_KEY, state);
}

export function clearQuestionState() {
  sessionStorage.removeItem(QUESTION_KEY);
}

export function clearAllSessionState() {
  sessionStorage.removeItem(APP_KEY);
  sessionStorage.removeItem(DEST_KEY);
  sessionStorage.removeItem(QUESTION_KEY);
}
