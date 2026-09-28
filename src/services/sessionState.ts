import type { AgentOutput, AppScreen, Attraction, DayItinerary, DestinationCard, DestinationHighlight, TripAccommodation, TripInput } from '../types';
import type { TripChatState } from '../components/questions/InteractiveTripChat';
import type { TripChatData } from './tripChatExtraction';
import type { BreakfastPlace } from '../types/breakfast';

const APP_KEY = 'travel-agent-app-v1';
const DEST_KEY = 'travel-agent-dest-v1';
const QUESTION_KEY = 'travel-agent-questions-v1';
const TRIP_KEY = 'travel-agent-trip-v1';
const HISTORY_PREFIX = 'travel-agent-session-v2:';
export type Path = 'A' | 'B' | null;
export interface PersistedAppState {
  screen: AppScreen;
  path: Path;
  picked: DestinationCard | null;
  input: TripInput | null;
  output: AgentOutput | null;
  chatNotes: string[];
}
export interface PersistedDestState { previewId: string | null; highlightName: string | null }
export interface PersistedQuestionState {
  path: 'A' | 'B'; stepIndex: number; city: string; selectedPlaces: string[];
  daysText?: string; chatMode?: boolean; chatData?: TripChatData | null;
  chatState?: TripChatState | null; notBooked?: boolean; accommodation?: TripAccommodation | null;
  viewingPlace?: DestinationHighlight | null; generatedPlaces?: Attraction[];
  foodPlaces?: Attraction[]; placeCategory?: string;
}
export type TripDetail = { kind: 'stop'; stop: DayItinerary['stops'][number] } | { kind: 'breakfast'; place: BreakfastPlace };
export interface PersistedTripState {
  itinerary: DayItinerary[]; detail: TripDetail | null; focusDay: number;
  mapDayIndex: number | null; showAllMap: boolean; dirty: boolean;
}
interface SessionSnapshot {
  app: PersistedAppState | null;
  question: PersistedQuestionState | null;
  destination: PersistedDestState | null;
  trip: PersistedTripState | null;
}
interface FlowRoute {
  screen: AppScreen; path: Path; picked: DestinationCard | null;
  question?: { stepIndex: number; chatMode: boolean; viewingPlace: DestinationHighlight | null };
  destination?: PersistedDestState;
  detail?: TripDetail | null;
}
interface FlowEntry {
  travelAgent: 2; step: string; sessionKey: string; route: FlowRoute; scrollY: number; depth: number;
}
const memory = new Map<string, unknown>();
function readJson<T>(key: string): T | null {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* Fall back to this tab's memory when storage is unavailable. */ }
  return (memory.get(key) as T) ?? null;
}
function writeJson(key: string, value: unknown) {
  memory.set(key, value);
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}
function remove(key: string) {
  memory.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* private mode */ }
}
export function loadAppState(): PersistedAppState | null {
  const state = readJson<PersistedAppState>(APP_KEY);
  if (state?.screen === 'trip' && (!state.input || !state.output)) return { ...state, screen: 'questions' };
  return state;
}
export function loadDestState() { return readJson<PersistedDestState>(DEST_KEY); }
export function loadQuestionState(path: 'A' | 'B') {
  const state = readJson<PersistedQuestionState>(QUESTION_KEY);
  return state?.path === path ? state : null;
}
export function loadTripState() { return readJson<PersistedTripState>(TRIP_KEY); }
export function saveAppState(state: PersistedAppState) { writeJson(APP_KEY, state); scheduleHistory(); }
export function saveDestState(state: PersistedDestState) { writeJson(DEST_KEY, state); scheduleHistory(); }
export function saveQuestionState(state: PersistedQuestionState) { writeJson(QUESTION_KEY, state); scheduleHistory(); }
export function saveTripState(state: PersistedTripState) { writeJson(TRIP_KEY, state); scheduleHistory(); }
export function clearDestState() { remove(DEST_KEY); scheduleHistory(); }
export function clearQuestionState() { remove(QUESTION_KEY); scheduleHistory(); }
export function clearTripState() { remove(TRIP_KEY); scheduleHistory(); }
export function clearAllSessionState() {
  [APP_KEY, DEST_KEY, QUESTION_KEY, TRIP_KEY].forEach(remove);
}
function snapshot(): SessionSnapshot {
  return { app: loadAppState(), question: readJson(QUESTION_KEY), destination: loadDestState(), trip: loadTripState() };
}
function currentRoute(): FlowRoute {
  const { app, question, destination, trip } = snapshot();
  const route: FlowRoute = { screen: app?.screen ?? 'entry', path: app?.path ?? null, picked: app?.picked ?? null };
  if (route.screen === 'questions') {
    if (route.path === 'B' && !route.picked) route.destination = destination ?? { previewId: null, highlightName: null };
    else route.question = { stepIndex: question?.stepIndex ?? 0, chatMode: question?.chatMode ?? true, viewingPlace: question?.viewingPlace ?? null };
  }
  if (route.screen === 'trip') route.detail = trip?.detail ?? null;
  return route;
}
function stepName(route: FlowRoute): string {
  if (route.screen === 'entry') return 'home';
  if (route.screen === 'processing') return 'processing';
  if (route.screen === 'trip') return route.detail ? 'itinerary-detail' : 'itinerary';
  if (route.destination) return route.destination.highlightName ? 'destination-detail' : route.destination.previewId ? 'destination-preview' : 'destinations';
  if (route.question?.viewingPlace) return 'place-detail';
  const steps = route.path === 'B' ? ['days', 'hotel', 'places'] : ['destination', 'days', 'hotel', 'places'];
  const step = steps[route.question?.stepIndex ?? 0] ?? 'destination';
  return step !== 'places' && route.question?.chatMode ? 'chat' : step;
}
function isEntry(value: unknown): value is FlowEntry {
  const entry = value as FlowEntry | null;
  return entry?.travelAgent === 2 && typeof entry.sessionKey === 'string' && Boolean(entry.route);
}
let sessionKey = '';
let scheduled = false;
let scrollRestore: number | null = null;
let restoreFrame = 0;
function restoreScroll(y: number) {
  cancelAnimationFrame(restoreFrame);
  scrollRestore = y;
  let attempts = 0;
  const apply = () => {
    window.scrollTo({ top: y, behavior: 'instant' });
    // Wait for the remounted list to have its saved height (images may still be loading).
    if (Math.abs(window.scrollY - y) < 2 || ++attempts >= 120) { scrollRestore = null; return; }
    restoreFrame = requestAnimationFrame(apply);
  };
  restoreFrame = requestAnimationFrame(() => { restoreFrame = requestAnimationFrame(apply); });
}
export function rememberFlowScroll() {
  if (scrollRestore != null || !isEntry(history.state)) return;
  history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
}
function restoreEntry(entry: FlowEntry): boolean {
  const saved = readJson<SessionSnapshot>(entry.sessionKey);
  if (!saved?.app) return false;
  sessionKey = entry.sessionKey;
  const route = entry.route;
  writeJson(APP_KEY, { ...saved.app, screen: route.screen, path: route.path, picked: route.picked });
  if (saved.question) writeJson(QUESTION_KEY, { ...saved.question, ...(route.question ?? {}) });
  else remove(QUESTION_KEY);
  if (route.destination || saved.destination) writeJson(DEST_KEY, route.destination ?? saved.destination);
  else remove(DEST_KEY);
  if (saved.trip) writeJson(TRIP_KEY, { ...saved.trip, ...(route.screen === 'trip' ? { detail: route.detail ?? null } : {}) });
  else remove(TRIP_KEY);
  restoreScroll(entry.scrollY ?? 0);
  return true;
}
function newKey() { return HISTORY_PREFIX + crypto.randomUUID(); }
/** Upgrade an existing saved trip that predates browser-history support. */
function initialTrail(route: FlowRoute): FlowRoute[] {
  const home: FlowRoute = { screen: 'entry', path: null, picked: null };
  if (route.screen === 'entry') return [home];
  const trail = [home];
  if (route.path === 'B') {
    const destinations: FlowRoute = { screen: 'questions', path: 'B', picked: null, destination: { previewId: null, highlightName: null } };
    trail.push(destinations);
    const previewId = route.picked?.id ?? route.destination?.previewId;
    if (previewId) trail.push({ ...destinations, destination: { previewId, highlightName: null } });
    if (route.destination) {
      if (route.destination.highlightName) trail.push(route);
      return trail;
    }
  }
  const path = route.path ?? 'A';
  const placesIndex = path === 'A' ? 3 : 2;
  let saved = loadQuestionState(path);
  const input = loadAppState()?.input;
  if (!saved && input) {
    saved = {
      path, stepIndex: placesIndex, chatMode: false, city: input.destination_city,
      daysText: String(input.trip_length_days), accommodation: input.accommodation ?? (input.hotel_location ? {
        address: input.hotel_address ?? input.hotel_location.display_name,
        latitude: input.hotel_location.lat, longitude: input.hotel_location.lon,
      } : null),
      notBooked: !input.hotel_address, selectedPlaces: input.must_visit_places ?? [],
      generatedPlaces: input.must_visit_attractions ?? [],
    };
    writeJson(QUESTION_KEY, saved);
  }
  const question = route.question ?? { stepIndex: placesIndex, chatMode: saved?.chatMode ?? true, viewingPlace: null };
  const chat: FlowRoute = { screen: 'questions', path, picked: route.picked, question: { stepIndex: 0, chatMode: true, viewingPlace: null } };
  trail.push(chat);
  if (!question.chatMode) {
    for (let index = 0; index <= question.stepIndex; index++) trail.push({ ...chat, question: { stepIndex: index, chatMode: false, viewingPlace: null } });
  } else if (question.stepIndex === placesIndex) {
    trail.push({ ...chat, question: { ...question, viewingPlace: null } });
  }
  if (question.viewingPlace) trail.push({ ...chat, question });
  if (route.screen === 'processing') trail.push(route);
  if (route.screen === 'trip') {
    trail.push({ ...route, detail: null });
    if (route.detail) trail.push(route);
  }
  return trail;
}
export function initializeFlowHistory() {
  history.scrollRestoration = 'manual';
  if (isEntry(history.state) && restoreEntry(history.state)) return;
  sessionKey = newKey();
  const route = currentRoute();
  const trail = initialTrail(route);
  writeJson(sessionKey, snapshot());
  trail.forEach((item, depth) => {
    const entry: FlowEntry = { travelAgent: 2, sessionKey, route: item, step: stepName(item), scrollY: 0, depth };
    if (depth === 0) history.replaceState(entry, '');
    else history.pushState(entry, '');
  });
}
// React effects for the parent and child run in the same turn. Commit only the final route.
function scheduleHistory() {
  if (!sessionKey || scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; syncHistory(); });
}
function syncHistory() {
  const route = currentRoute();
  writeJson(sessionKey, snapshot());
  const previous = history.state;
  if (isEntry(previous) && previous.sessionKey === sessionKey && JSON.stringify(previous.route) === JSON.stringify(route)) return;
  const entry: FlowEntry = { travelAgent: 2, sessionKey, route, step: stepName(route), scrollY: 0, depth: isEntry(previous) ? previous.depth + 1 : 0 };
  // Processing is transient: Back from a completed itinerary returns to the place picks, never reruns the agent.
  if (isEntry(previous) && previous.step === 'processing' && entry.step === 'itinerary') {
    entry.depth = previous.depth;
    history.replaceState(entry, '');
  } else history.pushState(entry, '');
  restoreScroll(0);
}
let restoreListener: (() => void) | null = null;
export function subscribeFlowHistory(onRestore: () => void) {
  restoreListener = onRestore;
  const pop = (event: PopStateEvent) => {
    if (isEntry(event.state) && restoreEntry(event.state)) onRestore();
  };
  window.addEventListener('popstate', pop);
  window.addEventListener('scroll', rememberFlowScroll, { passive: true });
  return () => { window.removeEventListener('popstate', pop); window.removeEventListener('scroll', rememberFlowScroll); };
}
/**
 * Back always works, whatever is still loading: the current screen's state is
 * already saved, so history.back() restores the previous entry immediately.
 * With nothing to go back to (first entry, or a tab without flow history), go home.
 */
export function backInFlow() {
  rememberFlowScroll();
  if (isEntry(history.state) && history.state.depth > 0) {
    history.back();
    return;
  }
  const app = loadAppState();
  if (!app || app.screen === 'entry') return;
  writeJson(APP_KEY, { ...app, screen: 'entry', path: null, picked: null });
  if (sessionKey) syncHistory();
  restoreListener?.();
}
/** Starting another trip creates a separate data key; old history remains navigable. */
export function startNewFlowSession() {
  sessionKey = newKey();
  clearAllSessionState();
}
