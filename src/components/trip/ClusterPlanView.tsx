import { useEffect, useMemo, useRef, useState } from 'react';
import { TravelChatBot } from '../chat/TravelChatBot';
import type { ChatReply } from '../../services/chatbot';
import { geocodeMany, type GeocodeResult } from '../../services/nominatim';
import { fetchPlacePhotoUrls } from '../../services/placePhotos';
import { rescheduleDayStops } from '../../services/agent';
import { addDays, haversineKm, minutesToLabel, toISODate } from '../../services/geo';
import {
  findExistingGroup,
  NEAR_GROUP_KM,
  rankGroupsForPlace,
  shortDisplayName,
  stopFromGeocode,
  type GroupDistanceHint,
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
      preferredGroup?: number;
      candidates: GeocodeResult[];
    }
  | {
      stage: 'preview';
      query: string;
      preferredGroup?: number;
      geo: GeocodeResult;
      ranked: GroupDistanceHint[];
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

const GROUP_COLORS = [
  '#1f6f68',
  '#2a6f9e',
  '#8a5a2b',
  '#6b4c9a',
  '#b04a5a',
  '#3d7a4a',
];

function refreshGroup(
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

function buildPreviewReply(
  query: string,
  geo: GeocodeResult,
  ranked: GroupDistanceHint[],
  preferredGroup?: number,
): ChatReply {
  const label = shortDisplayName(geo.display_name, query);
  const near = ranked.filter((r) => r.distanceKm <= NEAR_GROUP_KM).slice(0, 2);

  let primary =
    preferredGroup != null
      ? ranked.find((r) => r.groupIndex === preferredGroup - 1)
      : undefined;
  primary = primary ?? near[0] ?? ranked[0];

  const actions: { label: string; value: string }[] = [];
  const used = new Set<number>();

  const pushGroup = (hint: GroupDistanceHint) => {
    if (used.has(hint.groupIndex)) return;
    used.add(hint.groupIndex);
    const n = hint.groupIndex + 1;
    actions.push({
      label: `Add to Group ${n}`,
      value: `Add to Group ${n}`,
    });
  };

  if (primary && primary.distanceKm <= NEAR_GROUP_KM) pushGroup(primary);
  for (const hint of near) {
    if (actions.length >= 2) break;
    pushGroup(hint);
  }

  // Explicit preferred group even if farther
  if (
    preferredGroup != null &&
    preferredGroup >= 1 &&
    !used.has(preferredGroup - 1)
  ) {
    actions.unshift({
      label: `Add to Group ${preferredGroup}`,
      value: `Add to Group ${preferredGroup}`,
    });
  }

  actions.push({ label: 'New group', value: 'New group' });
  actions.push({ label: 'Cancel', value: 'Cancel' });

  const allFar = !ranked.length || ranked.every((r) => r.distanceKm > NEAR_GROUP_KM);
  const distLine = primary
    ? `${formatKm(primary.distanceKm)} from Group ${primary.groupIndex + 1}`
    : 'no existing groups yet';

  const hint = allFar
    ? `It’s more than ${NEAR_GROUP_KM} km from your current groups — a new group may fit better.`
    : 'Add there?';

  return {
    text: `Found ${query} (${label}). ${distLine}. ${hint}`,
    actions,
  };
}

export function ClusterPlanView({
  input,
  output,
  onBack,
  onItineraryChange,
}: ClusterPlanViewProps) {
  const [itinerary, setItinerary] = useState<DayItinerary[]>(output.itinerary);
  const [mapDayIndex, setMapDayIndex] = useState<number | null>(null);
  const [showAllMap, setShowAllMap] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [focusGroup, setFocusGroup] = useState(0);
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

  useEffect(() => {
    setItinerary(output.itinerary);
  }, [output]);

  function commitItinerary(next: DayItinerary[]) {
    setItinerary(next);
    onItineraryChange?.(next);
  }

  function loadPhotosAsync(stopName: string, groupIdx: number) {
    void fetchPlacePhotoUrls(
      stopName,
      input.destination_city,
      'Custom',
    ).then((urls) => {
      const cover = urls[0];
      if (!cover) return;
      const prev = itineraryRef.current;
      const next = prev.map((d, i) => {
        if (i !== groupIdx) return d;
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
    preferredGroup?: number,
  ): ChatReply {
    const current = itineraryRef.current;
    const dup = findExistingGroup(current, query, geo.lat, geo.lon);
    if (dup >= 0) {
      setLookup(null);
      setPreviewPin(null);
      return `“${query}” is already in Group ${dup + 1}. Say “move ${query} to group N” to relocate it.`;
    }

    const ranked = rankGroupsForPlace(geo.lat, geo.lon, current);
    setLookup({ stage: 'preview', query, geo, ranked, preferredGroup });
    setPreviewPin({ name: query, lat: geo.lat, lon: geo.lon });
    setShowAllMap(true);
    return buildPreviewReply(query, geo, ranked, preferredGroup);
  }

  async function handleLookupPlace(
    placeQuery: string,
    toDay?: number,
  ): Promise<ChatReply> {
    const query = placeQuery.trim();
    const current = itineraryRef.current;
    const dup = findExistingGroup(current, query);
    if (dup >= 0) {
      return `“${query}” is already in Group ${dup + 1}. Say “move ${query} to group N” to relocate it.`;
    }

    const { results } = await geocodeMany(
      `${query} ${input.destination_city}`,
      3,
    );
    const hits =
      results.length > 0
        ? results
        : (await geocodeMany(query, 3)).results;

    if (!hits.length) {
      setLookup(null);
      setPreviewPin(null);
      return `Couldn't find “${query}”. Try a neighborhood name or exact address.`;
    }

    if (hits.length > 1) {
      setLookup({
        stage: 'pick',
        query,
        preferredGroup: toDay,
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
    target: number | 'new',
  ): ChatReply {
    const stop = stopFromGeocode(
      session.query,
      session.geo,
      baseLat,
      baseLon,
    );
    const current = itineraryRef.current;
    const dup = findExistingGroup(
      current,
      session.query,
      session.geo.lat,
      session.geo.lon,
    );
    if (dup >= 0) {
      setLookup(null);
      setPreviewPin(null);
      return `“${session.query}” is already in Group ${dup + 1}.`;
    }

    let groupIdx: number;
    let next: DayItinerary[];

    if (target === 'new') {
      const last = current[current.length - 1];
      const nextDate = last
        ? toISODate(addDays(new Date(`${last.date}T12:00:00`), 1))
        : input.start_date;
      const blank: DayItinerary = {
        date: nextDate,
        day_number: current.length + 1,
        stops: [stop],
        total_distance_km: 0,
        compactness_score: 100,
        hotel_distance_km: 0,
      };
      next = [
        ...current,
        refreshGroup(blank, input, baseLat, baseLon),
      ];
      groupIdx = next.length - 1;
    } else {
      if (target < 0 || target >= current.length) {
        const again = buildPreviewReply(
          session.query,
          session.geo,
          session.ranked,
          session.preferredGroup,
        );
        return {
          text: `Group ${target + 1} doesn’t exist (you have ${current.length} groups).`,
          actions: typeof again === 'string' ? undefined : again.actions,
        };
      }
      groupIdx = target;
      next = current.map((d, i) => {
        if (i !== target) return d;
        return refreshGroup(
          { ...d, stops: [...d.stops, stop] },
          input,
          baseLat,
          baseLon,
        );
      });
    }

    commitItinerary(next);
    setLookup(null);
    setPreviewPin(null);
    setFocusGroup(groupIdx);
    setMapDayIndex(groupIdx);
    setShowAllMap(false);
    setDetail(null);
    loadPhotosAsync(stop.name, groupIdx);

    return `Added “${stop.name}” to Group ${groupIdx + 1}. Photos will fill in shortly.`;
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
        return goToPreview(session.query, geo, session.preferredGroup);
      }
    }

    if (session?.stage === 'preview') {
      if (/^new\s+group$/i.test(t)) {
        return confirmAdd(session, 'new');
      }
      const add = t.match(/^(?:add\s+to\s+)?(?:group|day)\s*(\d+)$/i);
      if (add) {
        return confirmAdd(session, Number(add[1]) - 1);
      }
    }

    return null;
  }

  function handleMoveStop(stopName: string, toDay: number): string {
    const targetIdx = toDay - 1;
    const current = itineraryRef.current;
    if (targetIdx < 0 || targetIdx >= current.length) {
      return `Group ${toDay} doesn’t exist (you have ${current.length} groups).`;
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
      return `I couldn’t find a place matching “${stopName}”. Check the name on a group card.`;
    }

    if (fromIdx === targetIdx) {
      return `“${moving.name}” is already in Group ${toDay}.`;
    }

    const moved = { ...moving };
    const next = current.map((d) => ({ ...d, stops: [...d.stops] }));
    next[fromIdx].stops.splice(stopIdx, 1);
    next[targetIdx].stops.push(moved);
    commitItinerary(
      next.map((d) => refreshGroup(d, input, baseLat, baseLon)),
    );
    setFocusGroup(targetIdx);
    setMapDayIndex(targetIdx);
    setShowAllMap(false);
    return `Moved “${moved.name}” from Group ${fromIdx + 1} to Group ${toDay}.`;
  }

  function handlePlanGroup(dayNum: number): string {
    const current = itineraryRef.current;
    const idx = Math.max(0, Math.min(current.length, dayNum) - 1);
    setFocusGroup(idx);
    setMapDayIndex(idx);
    setShowAllMap(false);
    setDetail(null);
    const names = (current[idx]?.stops ?? [])
      .filter((s) => !s.is_meal)
      .map((s) => s.name);
    return names.length
      ? `Focusing Group ${idx + 1}: ${names.join(', ')}. Look up another place to add here.`
      : `Group ${idx + 1} is empty — tell me a place to find.`;
  }

  const groups = useMemo(
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
    const mapped = placesFromItineraryGroups(groups);
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
  }, [groups, previewPin]);

  const chat = (
    <TravelChatBot
      city={input.destination_city}
      hasTrip
      variant="groups"
      onAddPlace={handleLookupPlace}
      onChatCommand={handleChatCommand}
      onMoveStop={handleMoveStop}
      onPlanDay={handlePlanGroup}
      onShowOptions={(category) =>
        `Name a place to look up (e.g. “find a ${category} spot”), then confirm which group.`
      }
      onPreference={() => undefined}
      onDietary={() => undefined}
      onSkipBreakfast={() =>
        'Breakfast isn’t part of nearby groups — look up a place to add instead.'
      }
    />
  );

  if (detail) {
    return (
      <div className="trip-view">
        <PlaceDetailPage
          target={detail}
          city={input.destination_city}
          hasHotel={Boolean(input.hotel_address)}
          dayLabel="Place details"
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
              Nearby groups in {input.destination_city}
            </h1>
            <p className="cluster-chat-hint">
              Look up a place in chat — preview first, photos load after you add it.
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
                ? `Preview pin for “${previewPin.name}” · confirm in chat to add it.`
                : `Each pin has a name label. Colors match the groups below · base is ${fromLabel}.`}
            </p>
          </section>
        )}

        {groups.map(({ day, index, sights, spanKm }) => {
          const mapOpen = mapDayIndex === index;
          const color = GROUP_COLORS[index % GROUP_COLORS.length];
          const focused = focusGroup === index;
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
                    Group {index + 1}
                    <span className="cluster-group-count">
                      {sights.length} place{sights.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  <p>
                    {spanKm > 0
                      ? `Within about ${formatKm(spanKm)} of each other`
                      : 'Single stop in this area'}
                    {' · '}
                    About {formatKm(day.hotel_distance_km)} from {fromLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setMapDayIndex(mapOpen ? null : index);
                    if (!mapOpen) setShowAllMap(false);
                    setFocusGroup(index);
                  }}
                >
                  {mapOpen ? 'Hide map' : 'See on map'}
                </button>
              </div>

              {mapOpen && (
                <div className="cluster-group-map">
                  <PlacesOverviewMap
                    places={placesFromStops(
                      sights,
                      `Group ${index + 1}`,
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
                        <span className="category-pill">◉ {stop.category}</span>
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
                        <span className="breakfast-card-cta">View details →</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {chat}
    </div>
  );
}
