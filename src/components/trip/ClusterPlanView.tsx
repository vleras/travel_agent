import { useEffect, useMemo, useRef, useState } from 'react';
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
  onItineraryChange?: (itinerary: DayItinerary[]) => void;
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
      text: `Found ${query} (${label}). No places on the board yet — which day should it go on?`,
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
  onItineraryChange,
}: ClusterPlanViewProps) {
  const [itinerary, setItinerary] = useState<DayItinerary[]>(() =>
    ensureTripDays(
      output.itinerary,
      input.trip_length_days,
      input.start_date,
    ),
  );
  const [mapDayIndex, setMapDayIndex] = useState<number | null>(null);
  const [showAllMap, setShowAllMap] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [focusDay, setFocusDay] = useState(0);
  const [lookup, setLookup] = useState<LookupSession | null>(null);
  const [previewPin, setPreviewPin] = useState<{
    name: string;
    lat: number;
    lon: number;
  } | null>(null);

  const itineraryRef = useRef(itinerary);
  itineraryRef.current = itinerary;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  const baseLat = output.metadata.hotel_lat;
  const baseLon = output.metadata.hotel_lon;
  const fromLabel = input.hotel_address ? 'your stay' : 'city center';
  const tripDays = Math.max(1, input.trip_length_days);

  useEffect(() => {
    setItinerary(
      ensureTripDays(
        output.itinerary,
        input.trip_length_days,
        input.start_date,
      ),
    );
  }, [output, input.trip_length_days, input.start_date]);

  function commitItinerary(next: DayItinerary[]) {
    const normalized = ensureTripDays(
      next,
      input.trip_length_days,
      input.start_date,
    );
    setItinerary(normalized);
    onItineraryChange?.(normalized);
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
      commitItinerary(next);
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

    commitItinerary(next);
    setLookup(null);
    setPreviewPin(null);
    setFocusDay(targetIdx);
    setMapDayIndex(targetIdx);
    setShowAllMap(false);
    setDetail(null);
    loadPhotosAsync(stop.name, targetIdx);

    const count = next[targetIdx].stops.filter((s) => !s.is_meal).length;
    return `Added “${stop.name}” to Day ${targetIdx + 1}. Now on Day ${targetIdx + 1}: ${count} stop${count === 1 ? '' : 's'}. Photos will fill in shortly.`;
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
    commitItinerary(
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
      : `Day ${idx + 1} is empty — tell me a place to find.`;
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
        'Breakfast isn’t part of the day board — look up a place to add instead.'
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
          onBack={() => setDetail(null)}
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
          <div>
            <div className="brand-mark" style={{ fontSize: '0.95rem' }}>
              Travel Agent
            </div>
            <h1>
              {tripDays}-day plan in {input.destination_city}
            </h1>
            <p className="cluster-chat-hint">
              Look up a place in chat — I’ll suggest the best day; photos load after you add it.
            </p>
          </div>
        </div>
        <div className="trip-topbar-right">
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
          return (
            <section
              key={`${day.date}-${index}`}
              className={`cluster-group${focused ? ' cluster-group--focus' : ''}`}
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
                  <p>
                    {sights.length === 0
                      ? 'Empty day — add a place from chat'
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
                <p className="cluster-empty-day">
                  No places yet. Say “find …” in chat to add one here.
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

                    return (
                      <button
                        key={`${stop.name}-${i}`}
                        type="button"
                        className="cluster-place-card"
                        onClick={() => setDetail({ kind: 'stop', stop })}
                      >
                        <PlaceImage
                          className="cluster-place-photo"
                          name={stop.name}
                          city={input.destination_city}
                          category={stop.category}
                          imageUrl={stop.image_url}
                          lat={stop.lat}
                          lon={stop.lon}
                        />
                        <div className="cluster-place-body">
                          <h3>
                            {i + 1}. {stop.name}
                          </h3>
                          <span className="category-pill">
                            ◉ {stop.category}
                          </span>
                          <p>{stop.description}</p>
                          <div className="cluster-place-meta">
                            <span>{minutesToLabel(stop.duration_min)}</span>
                            <span>
                              {formatKm(fromBase)} from {fromLabel}
                            </span>
                            {toNext != null && (
                              <span>{formatKm(toNext)} to next</span>
                            )}
                          </div>
                          <span className="breakfast-card-cta">
                            View details →
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {chat}
    </div>
  );
}
