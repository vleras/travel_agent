import { backInFlow, loadTripState, saveTripState } from '../../services/sessionState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getWeatherForItinerary, weatherUnavailableMessage } from '../../services/weather';
import { isISODate, localToday } from '../../services/tripDates';
import { TravelChatBot } from '../chat/TravelChatBot';
import type { ChatReply } from '../../services/chatbot';
import { geocodeMany, type GeocodeResult } from '../../services/nominatim';
import { fetchPlacePhotoUrls } from '../../services/placePhotos';
import { rescheduleDayStops } from '../../services/agent';
import { addDays, haversineKm, minutesToLabel, toISODate } from '../../services/geo';
import {
  dayActionButtons,
  findExistingDay,
  formatDayHint,
  rankDaysForPlace,
  shortDisplayName,
  stopFromGeocode,
  type DayDistanceHint,
} from '../../services/placeLookup';
import { googleMapsUrl, sendTripPlanEmail } from '../../services/tripEmail';
import type {
  AgentOutput,
  DayItinerary,
  ItineraryStop,
  TripInput,
} from '../../types';
import { PlaceImage } from '../shared/PlaceImage';
import {
  PlacesOverviewMap,
  placesFromItineraryGroups,
  placesFromStops,
} from './PlacesOverviewMap';
import {
  PlaceDetailPage,
  type DetailTarget,
} from './PlaceDetailPane';
import '../../styles/trip.css';

interface ClusterPlanViewProps {
  input: TripInput;
  output: AgentOutput;
  onBack: () => void;
  onHome?: () => void;
  onItineraryChange?: (itinerary: DayItinerary[]) => void;
  onDatesChange: (input: TripInput, itinerary: DayItinerary[]) => void;
}

type LookupSession =
  | {
      stage: 'pick';
      query: string;
      preferredDay?: number;
      candidates: GeocodeResult[];
    }
  | {
      stage: 'preview';
      query: string;
      preferredDay?: number;
      geo: GeocodeResult;
      ranked: DayDistanceHint[];
    };

function formatKm(km: number): string {
  if (km < 0.1) return '< 0.1 km';
  return `${km.toFixed(1)} km`;
}

function clusterSpanKm(stops: ItineraryStop[]): number {
  const sights = stops.filter((s) => !s.is_meal);
  if (sights.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < sights.length; i++) {
    for (let j = i + 1; j < sights.length; j++) {
      max = Math.max(
        max,
        haversineKm(sights[i].lat, sights[i].lon, sights[j].lat, sights[j].lon),
      );
    }
  }
  return max;
}

const DAY_COLORS = [
  '#1f6f68',
  '#2a6f9e',
  '#8a5a2b',
  '#6b4c9a',
  '#b04a5a',
  '#3d7a4a',
];

function refreshDay(
  day: DayItinerary,
  input: TripInput,
  baseLat: number,
  baseLon: number,
): DayItinerary {
  return rescheduleDayStops(
    day,
    input.day_start_time,
    input.breakfast_time,
    baseLat,
    baseLon,
    input.destination_city,
    null,
    input.breakfast_food,
  );
}

function emptyDay(
  dayNumber: number,
  date: string,
): DayItinerary {
  return {
    date,
    day_number: dayNumber,
    stops: [],
    total_distance_km: 0,
    compactness_score: 100,
    hotel_distance_km: 0,
  };
}

/** Ensure itinerary length matches trip_length_days. */
function ensureTripDays(
  itinerary: DayItinerary[],
  tripDays: number,
  startDateIso: string,
): DayItinerary[] {
  const n = Math.max(1, tripDays);
  const start = new Date(`${startDateIso}T12:00:00`);
  const next = itinerary.slice(0, n).map((d, i) => ({
    ...d,
    day_number: i + 1,
  }));
  while (next.length < n) {
    const i = next.length;
    next.push(emptyDay(i + 1, toISODate(addDays(start, i))));
  }
  return next;
}

function buildPreviewReply(
  query: string,
  geo: GeocodeResult,
  ranked: DayDistanceHint[],
  dayCount: number,
  preferredDay?: number,
): ChatReply {
  const label = shortDisplayName(geo.display_name, query);
  const actions = dayActionButtons(dayCount);

  if (!ranked.length) {
    return {
      text: `Found ${query} (${label}). Which day should it go on?`,
      actions,
    };
  }

  const primary =
    (preferredDay != null
      ? ranked.find((r) => r.dayIndex === preferredDay - 1)
      : undefined) ?? ranked[0];
  const second = ranked.find((r) => r.dayIndex !== primary.dayIndex);

  let text = `Found ${query} (${label}). Closest to ${formatDayHint(primary)}.`;
  if (second) {
    text += ` Also near ${formatDayHint(second)}.`;
  }
  text += preferredDay
    ? ` Add to Day ${preferredDay}?`
    : ' Add to that day?';

  return { text, actions };
}

export function ClusterPlanView({
  input,
  output,
  onBack,
  onHome,
  onItineraryChange,
  onDatesChange,
}: ClusterPlanViewProps) {
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [startDate, setStartDate] = useState(input.dates_flexible ? '' : input.start_date);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const dateRequest = useRef(0);
  useEffect(() => () => { dateRequest.current += 1; }, []);
  const [saved] = useState(loadTripState);
  const [itinerary, setItinerary] = useState<DayItinerary[]>(() =>
    ensureTripDays(
      saved?.itinerary ?? output.itinerary,
      input.trip_length_days,
      input.start_date,
    ),
  );
  const [mapDayIndex, setMapDayIndex] = useState<number | null>(saved?.mapDayIndex ?? null);
  const [showAllMap, setShowAllMap] = useState(saved?.showAllMap ?? false);
  const [detail, setDetail] = useState<DetailTarget | null>(saved?.detail ?? null);
  const [focusDay, setFocusDay] = useState(saved?.focusDay ?? 0);
  const [lookup, setLookup] = useState<LookupSession | null>(null);
  const [previewPin, setPreviewPin] = useState<{
    name: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [dirty, setDirty] = useState(saved?.dirty ?? false);
  const [commitNote, setCommitNote] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem('lastEmailAddress') ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailSentItinerary, setEmailSentItinerary] = useState<string | null>(null);
  const [showEmailToast, setShowEmailToast] = useState(false);
  const [dragging, setDragging] = useState<{
    fromDay: number;
    stopName: string;
  } | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);

  const itineraryRef = useRef(itinerary);
  itineraryRef.current = itinerary;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  const baseLat = output.metadata.hotel_lat;
  const baseLon = output.metadata.hotel_lon;
  const fromLabel = input.hotel_address ? 'your stay' : 'city center';
  const tripDays = Math.max(1, input.trip_length_days);

  useEffect(() => {
    saveTripState({ itinerary, detail, focusDay, mapDayIndex, showAllMap, dirty });
  }, [itinerary, detail, focusDay, mapDayIndex, showAllMap, dirty]);

  const previousOutput = useRef(output);
  useEffect(() => {
    if (previousOutput.current === output) return;
    previousOutput.current = output;
    setItinerary(
      ensureTripDays(
        output.itinerary,
        input.trip_length_days,
        input.start_date,
      ),
    );
    setDirty(false);
    setCommitNote(null);
  }, [output, input.trip_length_days, input.start_date]);

  function applyDraft(
    next: DayItinerary[],
    options?: { markDirty?: boolean },
  ) {
    const normalized = ensureTripDays(
      next,
      input.trip_length_days,
      input.start_date,
    );
    setItinerary(normalized);
    if (options?.markDirty !== false) {
      setDirty(true);
      setCommitNote(null);
      // Mark that the plan has been edited after sending
      if (emailSentItinerary && emailSentTo) {
        setCommitNote('Plan updated.');
      }
    }
  }

  /** Persist the current day board (after removes / chat edits). */
  function commitChanges() {
    onItineraryChange?.(itineraryRef.current);
    setDirty(false);
    setCommitNote('Changes saved.');
  }

  function openEmailConfirm() {
    if (dirty) commitChanges();
    setEmailError(null);
    setEmailSentTo(null);
    setEmailOpen(true);
  }

  async function saveDates(event: React.FormEvent) {
    event.preventDefault();
    if (!isISODate(startDate) || startDate < localToday()) return;
    const request = ++dateRequest.current;
    const dated = itineraryRef.current.map((day, index) => ({ ...day, date: toISODate(addDays(new Date(`${startDate}T12:00:00`), index)), weather: undefined }));
    const nextInput = { ...input, start_date: startDate, end_date: dated.at(-1)!.date, dates_flexible: false };
    setItinerary(dated);
    itineraryRef.current = dated;
    onDatesChange(nextInput, dated);
    setDateEditorOpen(false);
    setWeatherLoading(true);
    const forecasts = await getWeatherForItinerary(baseLat, baseLon, dated.map(day => day.date));
    if (request !== dateRequest.current) return;
    const updated = itineraryRef.current.map(day => ({ ...day, weather: forecasts.find(forecast => forecast.date === day.date) }));
    setItinerary(updated);
    onDatesChange(nextInput, updated);
    setWeatherLoading(false);
  }

  async function sendPlanToEmail(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }

    setEmailSending(true);
    setEmailError(null);
    const result = await sendTripPlanEmail(
      trimmed,
      input,
      itineraryRef.current,
      { lat: baseLat, lon: baseLon },
    );
    setEmailSending(false);

    if (!result.ok) {
      setEmailError(result.error);
      return;
    }

    // Save email to localStorage and mark as sent
    localStorage.setItem('lastEmailAddress', trimmed);
    setEmailSentTo(trimmed);
    setEmailSentItinerary(JSON.stringify(itineraryRef.current));
    setCommitNote(`Plan sent to ${trimmed}. Check your inbox.`);

    // Show toast notification and go to home
    setShowEmailToast(true);
    setTimeout(() => {
      setEmailOpen(false);
    }, 500);
    setTimeout(() => {
      (onHome || onBack)();
    }, 2000);
  }

  function removePlaceFromDay(dayIdx: number, stopName: string) {
    const next = itineraryRef.current.map((d, i) => {
      if (i !== dayIdx) return d;
      return refreshDay(
        {
          ...d,
          stops: d.stops.filter(
            (s) => s.is_meal || s.name.toLowerCase() !== stopName.toLowerCase(),
          ),
        },
        input,
        baseLat,
        baseLon,
      );
    });
    applyDraft(next);
    if (detail?.kind === 'stop' && detail.stop.name === stopName) {
      setDetail(null);
    }
  }

  function movePlaceBetweenDays(
    fromDay: number,
    stopName: string,
    toDay: number,
  ) {
    if (fromDay === toDay) return;
    const current = itineraryRef.current;
    if (
      fromDay < 0 ||
      toDay < 0 ||
      fromDay >= current.length ||
      toDay >= current.length
    ) {
      return;
    }

    const needle = stopName.toLowerCase();
    const stopIdx = current[fromDay].stops.findIndex(
      (s) => !s.is_meal && s.name.toLowerCase() === needle,
    );
    if (stopIdx < 0) return;

    const moving = { ...current[fromDay].stops[stopIdx] };
    const next = current.map((d) => ({ ...d, stops: [...d.stops] }));
    next[fromDay].stops.splice(stopIdx, 1);
    next[toDay].stops.push(moving);
    applyDraft(next.map((d) => refreshDay(d, input, baseLat, baseLon)));
    setFocusDay(toDay);
    setMapDayIndex(null);
    setShowAllMap(false);
  }

  function loadPhotosAsync(stopName: string, dayIdx: number) {
    void fetchPlacePhotoUrls(
      stopName,
      input.destination_city,
      'Custom',
    ).then((urls) => {
      const cover = urls[0];
      if (!cover) return;
      const prev = itineraryRef.current;
      const next = prev.map((d, i) => {
        if (i !== dayIdx) return d;
        return {
          ...d,
          stops: d.stops.map((s) =>
            !s.is_meal && s.name.toLowerCase() === stopName.toLowerCase()
              ? { ...s, image_url: cover }
              : s,
          ),
        };
      });
      // Photo fill-in shouldn't force a Commit
      applyDraft(next, { markDirty: false });
    });
  }

  function goToPreview(
    query: string,
    geo: GeocodeResult,
    preferredDay?: number,
  ): ChatReply {
    const current = itineraryRef.current;
    const dup = findExistingDay(current, query, geo.lat, geo.lon);
    if (dup >= 0) {
      setLookup(null);
      setPreviewPin(null);
      return `“${query}” is already on Day ${dup + 1}. Say “move ${query} to day N” to relocate it.`;
    }

    const ranked = rankDaysForPlace(geo.lat, geo.lon, current);
    setLookup({ stage: 'preview', query, geo, ranked, preferredDay });
    setPreviewPin({ name: query, lat: geo.lat, lon: geo.lon });
    setShowAllMap(true);
    return buildPreviewReply(
      query,
      geo,
      ranked,
      current.length,
      preferredDay,
    );
  }

  async function geocodePlace(query: string): Promise<GeocodeResult[]> {
    const { results } = await geocodeMany(
      `${query} ${input.destination_city}`,
      3,
    );
    if (results.length) return results;
    return (await geocodeMany(query, 3)).results;
  }

  async function handleLookupPlace(
    placeQuery: string,
    toDay?: number,
  ): Promise<ChatReply> {
    const query = placeQuery.trim();
    const current = itineraryRef.current;
    const dup = findExistingDay(current, query);
    if (dup >= 0) {
      return `“${query}” is already on Day ${dup + 1}. Say “move ${query} to day N” to relocate it.`;
    }

    const hits = await geocodePlace(query);
    if (!hits.length) {
      setLookup(null);
      setPreviewPin(null);
      return `Couldn't find “${query}”. Try a neighborhood name or exact address.`;
    }

    if (hits.length > 1) {
      setLookup({
        stage: 'pick',
        query,
        preferredDay: toDay,
        candidates: hits,
      });
      setPreviewPin(null);
      return {
        text: `I found a few matches for “${query}”. Which one?`,
        actions: [
          ...hits.map((h, i) => ({
            label: `${i + 1}. ${shortDisplayName(h.display_name, query)}`,
            value: `Pick ${i + 1}`,
          })),
          { label: 'Cancel', value: 'Cancel' },
        ],
      };
    }

    return goToPreview(query, hits[0], toDay);
  }

  function confirmAdd(
    session: Extract<LookupSession, { stage: 'preview' }>,
    targetIdx: number,
  ): ChatReply {
    const stop = stopFromGeocode(
      session.query,
      session.geo,
      baseLat,
      baseLon,
    );
    const current = itineraryRef.current;
    const dup = findExistingDay(
      current,
      session.query,
      session.geo.lat,
      session.geo.lon,
    );
    if (dup >= 0) {
      setLookup(null);
      setPreviewPin(null);
      return `“${session.query}” is already on Day ${dup + 1}.`;
    }

    if (targetIdx < 0 || targetIdx >= current.length) {
      return {
        text: `Day ${targetIdx + 1} doesn’t exist (this trip has ${current.length} days).`,
        actions: dayActionButtons(current.length),
      };
    }

    const next = current.map((d, i) => {
      if (i !== targetIdx) return d;
      return refreshDay(
        { ...d, stops: [...d.stops, stop] },
        input,
        baseLat,
        baseLon,
      );
    });

    applyDraft(next);
    setLookup(null);
    setPreviewPin(null);
    setFocusDay(targetIdx);
    setMapDayIndex(targetIdx);
    setShowAllMap(false);
    setDetail(null);
    loadPhotosAsync(stop.name, targetIdx);

    const count = next[targetIdx].stops.filter((s) => !s.is_meal).length;
    return `Added “${stop.name}” to Day ${targetIdx + 1}, which now has ${count} stop${count === 1 ? '' : 's'}.`;
  }

  function handleChatCommand(message: string): ChatReply | null {
    const t = message.trim();
    const session = lookupRef.current;

    if (/^cancel$/i.test(t)) {
      if (!session) return null;
      setLookup(null);
      setPreviewPin(null);
      return 'Canceled. Look up another place anytime.';
    }

    if (session?.stage === 'pick') {
      const pick = t.match(/^(?:pick|option|choose)\s*#?(\d+)$/i);
      if (pick) {
        const idx = Number(pick[1]) - 1;
        const geo = session.candidates[idx];
        if (!geo) {
          return {
            text: 'That option isn’t on the list. Pick one of the numbers above.',
            actions: session.candidates.map((h, i) => ({
              label: `${i + 1}. ${shortDisplayName(h.display_name, session.query)}`,
              value: `Pick ${i + 1}`,
            })),
          };
        }
        return goToPreview(session.query, geo, session.preferredDay);
      }
    }

    if (session?.stage === 'preview') {
      const dayOnly = t.match(/^(?:add\s+to\s+)?(?:day|group)\s*(\d+)$/i);
      if (dayOnly) {
        return confirmAdd(session, Number(dayOnly[1]) - 1);
      }
    }

    return null;
  }

  function handleMoveStop(stopName: string, toDay: number): string {
    const targetIdx = toDay - 1;
    const current = itineraryRef.current;
    if (targetIdx < 0 || targetIdx >= current.length) {
      return `Day ${toDay} doesn’t exist (this trip has ${current.length} days).`;
    }

    const needle = stopName.toLowerCase();
    let fromIdx = -1;
    let stopIdx = -1;
    let moving: ItineraryStop | undefined;

    for (let di = 0; di < current.length; di++) {
      const si = current[di].stops.findIndex(
        (s) => !s.is_meal && s.name.toLowerCase().includes(needle),
      );
      if (si >= 0) {
        fromIdx = di;
        stopIdx = si;
        moving = current[di].stops[si];
        break;
      }
    }

    if (!moving || fromIdx < 0 || stopIdx < 0) {
      return `I couldn’t find a place matching “${stopName}”. Check the name on a day card.`;
    }

    if (fromIdx === targetIdx) {
      return `“${moving.name}” is already on Day ${toDay}.`;
    }

    const moved = { ...moving };
    const next = current.map((d) => ({ ...d, stops: [...d.stops] }));
    next[fromIdx].stops.splice(stopIdx, 1);
    next[targetIdx].stops.push(moved);
    applyDraft(
      next.map((d) => refreshDay(d, input, baseLat, baseLon)),
    );
    setFocusDay(targetIdx);
    setMapDayIndex(targetIdx);
    setShowAllMap(false);
    const count = next[targetIdx].stops.filter((s) => !s.is_meal).length;
    return `Moved “${moved.name}” to Day ${toDay}. Now on Day ${toDay}: ${count} stop${count === 1 ? '' : 's'}.`;
  }

  function handlePlanDay(dayNum: number): string {
    const current = itineraryRef.current;
    const idx = Math.max(0, Math.min(current.length, dayNum) - 1);
    setFocusDay(idx);
    setMapDayIndex(idx);
    setShowAllMap(false);
    setDetail(null);
    const names = (current[idx]?.stops ?? [])
      .filter((s) => !s.is_meal)
      .map((s) => s.name);
    return names.length
      ? `Focusing Day ${idx + 1}: ${names.join(', ')}. Look up another place to add here.`
      : `Day ${idx + 1} is empty. Tell me a place to find.`;
  }

  const days = useMemo(
    () =>
      itinerary.map((day, index) => {
        const sights = day.stops.filter((s) => !s.is_meal);
        return {
          day,
          index,
          sights,
          spanKm: clusterSpanKm(day.stops),
        };
      }),
    [itinerary],
  );

  const allPlaces = useMemo(() => {
    const mapped = placesFromItineraryGroups(days);
    if (!previewPin) return mapped;
    return [
      ...mapped,
      {
        name: previewPin.name,
        lat: previewPin.lat,
        lon: previewPin.lon,
        groupLabel: 'Preview',
        color: '#c45c26',
      },
    ];
  }, [days, previewPin]);

  const chat = (
    <TravelChatBot
      city={input.destination_city}
      hasTrip
      variant="groups"
      onAddPlace={handleLookupPlace}
      onSuggestDay={handleLookupPlace}
      onChatCommand={handleChatCommand}
      onMoveStop={handleMoveStop}
      onPlanDay={handlePlanDay}
      onShowOptions={(category) =>
        `Name a place to look up (e.g. “find a ${category} spot”), then pick a day.`
      }
      onPreference={() => undefined}
      onDietary={() => undefined}
      onSkipBreakfast={() =>
        'Look up a breakfast place to add to the day board.'
      }
    />
  );

  if (detail) {
    const dayIdx = findExistingDay(
      itinerary,
      detail.kind === 'stop' ? detail.stop.name : detail.place.name,
    );
    const daySights =
      dayIdx >= 0
        ? itinerary[dayIdx].stops.filter((s) => !s.is_meal).length
        : 0;
    return (
      <div className="trip-view">
        <PlaceDetailPage
          target={detail}
          city={input.destination_city}
          hasHotel={Boolean(input.hotel_address)}
          dayLabel={
            dayIdx >= 0
              ? `Day ${dayIdx + 1} · ${daySights} stop${daySights === 1 ? '' : 's'}`
              : 'Place details'
          }
          onBack={backInFlow}
        />
        {chat}
      </div>
    );
  }

  return (
    <div className="trip-view cluster-plan">
      <header className="trip-topbar">
        <div className="trip-topbar-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Back
          </button>
          <div className="trip-logo">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect fill="none" width="32" height="32" />
              <path d="M16 3 L28 9 L28 18 C28 26 16 29 16 29 C16 29 4 26 4 18 L4 9 Z" fill="#2a9d8f" opacity="0.1" stroke="#2a9d8f" strokeWidth="1.5" />
              <path d="M16 8 L20 10 L20 15 C20 20 16 22 16 22 C16 22 12 20 12 15 L12 10 Z" fill="#2a9d8f" stroke="#2a9d8f" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="2" fill="#2a9d8f" />
            </svg>
            <span className="trip-logo-text">Travel Agent</span>
          </div>
        </div>
        <div className="trip-topbar-center">
          <h1>
            {tripDays}-day plan in {input.destination_city}
          </h1>
          <div className="trip-date-controls">
            {input.dates_flexible && <p>Add exact travel dates to see a forecast.</p>}
            {weatherLoading && <p role="status">Loading forecast...</p>}
            {dateEditorOpen ? (
              <form onSubmit={saveDates} className="trip-date-form">
                <label htmlFor="trip-start-date">Trip start date</label>
                <input id="trip-start-date" type="date" min={localToday()} required value={startDate} onChange={event => setStartDate(event.target.value)} />
                <span>{tripDays} days, starting on this date</span>
                <button className="btn btn-primary" type="submit">Save dates</button>
                <button className="btn btn-ghost" type="button" onClick={() => setDateEditorOpen(false)}>Cancel</button>
              </form>
            ) : (
              <span
                className="trip-dates-text"
                onClick={() => setDateEditorOpen(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDateEditorOpen(true);
                  }
                }}
              >
                {input.dates_flexible ? 'Add dates' : (() => {
                  const start = new Date(`${input.start_date}T12:00:00`);
                  const end = new Date(`${input.end_date}T12:00:00`);
                  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  const endStr = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  return `${startStr} - ${endStr}`;
                })()}
              </span>
            )}
          </div>
        </div>
        <div className="trip-topbar-right">
          {commitNote && !dirty && !emailOpen && (
            <span className="cluster-commit-note">{commitNote}</span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={openEmailConfirm}
          >
            {emailSentItinerary && JSON.stringify(itinerary) !== emailSentItinerary
              ? "Send updated plan"
              : "Send plan to email"}
          </button>
          <button
            type="button"
            className={`btn ${showAllMap ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setShowAllMap((open) => !open);
              if (!showAllMap) setMapDayIndex(null);
            }}
          >
            {showAllMap ? 'Hide map' : 'See all on map'}
          </button>
        </div>
      </header>

      <div className="cluster-plan-body">
        {showAllMap && (
          <section className="cluster-all-map">
            <PlacesOverviewMap
              places={allPlaces}
              hotelLat={baseLat}
              hotelLon={baseLon}
            />
            <p className="cluster-map-hint">
              {previewPin
                ? `Preview pin for “${previewPin.name}” · confirm a day in chat to add it.`
                : `Pins are color-coded by day · base is ${fromLabel}.`}
            </p>
          </section>
        )}

        {days.map(({ day, index, sights, spanKm }) => {
          const mapOpen = mapDayIndex === index;
          const color = DAY_COLORS[index % DAY_COLORS.length];
          const focused = focusDay === index;
          const isDropTarget = dropDay === index;
          return (
            <section
              key={`${day.date}-${index}`}
              className={`cluster-group${focused ? ' cluster-group--focus' : ''}${isDropTarget ? ' cluster-group--drop' : ''}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropDay !== index) setDropDay(index);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropDay((d) => (d === index ? null : d));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw =
                  e.dataTransfer.getData('application/x-travel-stop') ||
                  e.dataTransfer.getData('text/plain');
                setDropDay(null);
                setDragging(null);
                if (!raw) return;
                try {
                  const payload = JSON.parse(raw) as {
                    fromDay: number;
                    stopName: string;
                  };
                  movePlaceBetweenDays(
                    payload.fromDay,
                    payload.stopName,
                    index,
                  );
                } catch {
                  /* ignore bad payload */
                }
              }}
            >
              <div className="cluster-group-head">
                <div>
                  <h2>
                    <span
                      className="cluster-group-swatch"
                      style={{ background: color }}
                      aria-hidden
                    />
                    Day {index + 1}
                    <span className="cluster-group-count">
                      {sights.length} place{sights.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  {!input.dates_flexible && <div className="day-weather" aria-label={`Weather for day ${index + 1}`}>
                    {!input.dates_flexible && <time dateTime={day.date}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
                    {day.weather && !input.dates_flexible ? (
                      <>
                        <span aria-hidden="true">{day.weather.icon}</span>
                        <span>{day.weather.condition}</span>
                        <strong>{day.weather.minTemp} to {day.weather.maxTemp}°C</strong>
                        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
                      </>
                    ) : <span>{weatherUnavailableMessage(day.date, input.dates_flexible)}</span>}
                  </div>}
                  <p>
                    {sights.length === 0
                      ? 'Empty day. Drag a place here or add one from chat'
                      : spanKm > 0
                        ? `Within about ${formatKm(spanKm)} of each other`
                        : 'Single stop today'}
                    {sights.length > 0 && (
                      <>
                        {' · '}
                        About {formatKm(day.hotel_distance_km)} from {fromLabel}
                      </>
                    )}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="day-card-hint-icon" title="Drag cards between days, tap × to remove, then send the plan to email.">
                    ℹ️
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setMapDayIndex(mapOpen ? null : index);
                      if (!mapOpen) setShowAllMap(false);
                      setFocusDay(index);
                    }}
                  >
                    {mapOpen ? 'Hide map' : 'See on map'}
                  </button>
                </div>
              </div>

              {mapOpen && sights.length > 0 && (
                <div className="cluster-group-map">
                  <PlacesOverviewMap
                    places={placesFromStops(
                      sights,
                      `Day ${index + 1}`,
                      color,
                    )}
                    hotelLat={baseLat}
                    hotelLon={baseLon}
                  />
                  <p className="cluster-map-hint">
                    Labels show each place name · distances from {fromLabel}.
                  </p>
                </div>
              )}

              {sights.length === 0 ? (
                <p className="cluster-empty-day cluster-drop-zone">
                  Drop a place here
                </p>
              ) : (
                <div className="cluster-card-grid">
                  {sights.map((stop, i) => {
                    const fromBase = haversineKm(
                      baseLat,
                      baseLon,
                      stop.lat,
                      stop.lon,
                    );
                    const nextStop = sights[i + 1];
                    const toNext = nextStop
                      ? haversineKm(
                          stop.lat,
                          stop.lon,
                          nextStop.lat,
                          nextStop.lon,
                        )
                      : null;
                    const isDragging =
                      dragging?.fromDay === index &&
                      dragging.stopName === stop.name;

                    return (
                      <article
                        key={`${stop.name}-${i}`}
                        className={`cluster-place-card${isDragging ? ' cluster-place-card--dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          const payload = {
                            fromDay: index,
                            stopName: stop.name,
                          };
                          setDragging(payload);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData(
                            'application/x-travel-stop',
                            JSON.stringify(payload),
                          );
                          e.dataTransfer.setData(
                            'text/plain',
                            JSON.stringify(payload),
                          );
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropDay(null);
                        }}
                      >
                        <div className="cluster-place-media">
                          <PlaceImage
                            className="cluster-place-photo"
                            name={stop.name}
                            localName={stop.localName}
                            wikipediaTitle={stop.wikipediaTitle}
                            wikidataId={stop.wikidataId}
                            city={input.destination_city}
                            category={stop.category}
                            imageUrl={stop.image_url}
                            lat={stop.lat}
                            lon={stop.lon}
                          />
                          <button
                            type="button"
                            className="cluster-place-remove"
                            aria-label={`Remove ${stop.name} from Day ${index + 1}`}
                            draggable={false}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removePlaceFromDay(index, stop.name);
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="cluster-place-body">
                          <h3>
                            {i + 1}.{' '}
                            <a
                              className="cluster-place-maps-link"
                              href={googleMapsUrl(stop)}
                              target="_blank"
                              rel="noopener noreferrer"
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {stop.name}
                            </a>
                          </h3>
                          <div className="cluster-place-meta">
                            <span>{minutesToLabel(stop.duration_min)}</span>
                            <span>
                              {formatKm(fromBase)} from {fromLabel}
                            </span>
                            {toNext != null && (
                              <span>{formatKm(toNext)} to next</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="breakfast-card-cta"
                            onClick={() => setDetail({ kind: 'stop', stop })}
                          >
                            View details →
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {emailOpen && (
        <div
          className="cluster-email-backdrop"
          role="presentation"
          onClick={() => {
            if (!emailSending) setEmailOpen(false);
          }}
        >
          <div
            className="cluster-email-modal"
            role="dialog"
            aria-labelledby="cluster-email-title"
            onClick={(e) => e.stopPropagation()}
          >
            {emailSentTo && JSON.stringify(itinerary) === emailSentItinerary ? (
              <>
                <h2 id="cluster-email-title">Plan sent</h2>
                <p>
                  Sent to <strong>{emailSentTo}</strong>. Check your inbox.
                </p>
                <div className="cluster-email-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setEmailOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="cluster-email-title">
                  {emailSentItinerary && JSON.stringify(itinerary) !== emailSentItinerary
                    ? "Send updated plan"
                    : "Send plan to email"}
                </h2>
                <p>
                  We’ll email your {tripDays}-day {input.destination_city} plan.
                </p>
                <form onSubmit={(ev) => void sendPlanToEmail(ev)}>
                  <label htmlFor="trip-email">
                    Email address
                    <input
                      id="trip-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      disabled={emailSending}
                      onChange={(ev) => {
                        setEmail(ev.target.value);
                        setEmailError(null);
                      }}
                      autoFocus
                    />
                  </label>
                  {emailError && (
                    <p className="cluster-email-error">{emailError}</p>
                  )}
                  <div className="cluster-email-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={emailSending}
                      onClick={() => setEmailOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={emailSending || !email.trim()}
                    >
                      {emailSending ? "Sending…" : (emailSentItinerary && JSON.stringify(itinerary) !== emailSentItinerary
                        ? "Send updated plan"
                        : "Send plan to email")}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {showEmailToast && (
        <div className="email-toast-notification">
          <div className="email-toast-content">
            <svg className="email-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <div className="email-toast-text">
              <p className="email-toast-title">Plan sent!</p>
              <p className="email-toast-message">Check your inbox for the trip details.</p>
            </div>
          </div>
          <p className="email-toast-redirect">Redirecting to home...</p>
        </div>
      )}

      {chat}
    </div>
  );
}
