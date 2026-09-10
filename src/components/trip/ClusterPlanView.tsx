import { useMemo, useState } from 'react';
import { formatTripRange, haversineKm, minutesToLabel } from '../../services/geo';
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
}

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

export function ClusterPlanView({
  input,
  output,
  onBack,
}: ClusterPlanViewProps) {
  const [itinerary] = useState<DayItinerary[]>(output.itinerary);
  const [mapDayIndex, setMapDayIndex] = useState<number | null>(null);
  const [showAllMap, setShowAllMap] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);

  const baseLat = output.metadata.hotel_lat;
  const baseLon = output.metadata.hotel_lon;
  const fromLabel = input.hotel_address ? 'your stay' : 'city center';

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

  const allPlaces = useMemo(
    () => placesFromItineraryGroups(groups),
    [groups],
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
            <p className="cluster-plan-sub">
              {formatTripRange(
                input.start_date,
                input.end_date,
                input.dates_flexible,
              )}{' '}
              · Places close together are grouped for easier days
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
              Each pin has a name label. Colors match the groups below · base is{' '}
              {fromLabel}.
            </p>
          </section>
        )}

        {groups.map(({ day, index, sights, spanKm }) => {
          const mapOpen = mapDayIndex === index;
          const color = GROUP_COLORS[index % GROUP_COLORS.length];
          return (
            <section key={day.date} className="cluster-group">
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
                  const next = sights[i + 1];
                  const toNext = next
                    ? haversineKm(stop.lat, stop.lon, next.lat, next.lon)
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
    </div>
  );
}
