import { useEffect } from 'react';
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import type { ItineraryStop } from '../../types';
import 'leaflet/dist/leaflet.css';

export interface LabeledMapPlace {
  name: string;
  lat: number;
  lon: number;
  category?: string;
  /** Optional group label shown in the marker chip */
  groupLabel?: string;
  /** Accent color for the pin */
  color?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labeledPlaceIcon(place: LabeledMapPlace, index: number) {
  const color = place.color ?? '#1f6f68';
  const title = escapeHtml(place.name);
  const group = place.groupLabel
    ? `<span class="map-label-group">${escapeHtml(place.groupLabel)}</span>`
    : '';

  return L.divIcon({
    className: 'map-labeled-marker',
    html: `
      <div class="map-label-stack">
        <div class="map-label-box" style="border-color:${color}">
          ${group}
          <strong>${index}. ${title}</strong>
        </div>
        <div class="map-label-pin" style="background:${color}">${index}</div>
      </div>
    `,
    iconSize: [160, 58],
    iconAnchor: [80, 58],
  });
}

const hotelIcon = L.divIcon({
  className: 'map-labeled-marker',
  html: `
    <div class="map-label-stack">
      <div class="map-label-box map-label-box--base">
        <strong>Your base</strong>
      </div>
      <div class="map-label-pin map-label-pin--base">H</div>
    </div>
  `,
  iconSize: [120, 58],
  iconAnchor: [60, 58],
});

const GROUP_COLORS = [
  '#1f6f68',
  '#2a6f9e',
  '#8a5a2b',
  '#6b4c9a',
  '#b04a5a',
  '#3d7a4a',
];

function FitPoints({
  points,
}: {
  points: { lat: number; lon: number }[];
}) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 14);
      return;
    }
    const bounds = L.latLngBounds(
      points.map((p) => [p.lat, p.lon] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [56, 56] });
  }, [points, map]);
  return null;
}

interface PlacesOverviewMapProps {
  places: LabeledMapPlace[];
  hotelLat: number;
  hotelLon: number;
  showHotel?: boolean;
}

export function PlacesOverviewMap({
  places,
  hotelLat,
  hotelLon,
  showHotel = true,
}: PlacesOverviewMapProps) {
  const fitPoints = [
    ...(showHotel ? [{ lat: hotelLat, lon: hotelLon }] : []),
    ...places,
  ];

  return (
    <MapContainer
      center={[hotelLat, hotelLon]}
      zoom={13}
      scrollWheelZoom
      className="places-overview-map"
      style={{ width: '100%', height: '100%', minHeight: 420 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitPoints points={fitPoints} />
      {showHotel && (
        <Marker position={[hotelLat, hotelLon]} icon={hotelIcon} />
      )}
      {places.map((place, i) => (
        <Marker
          key={`${place.name}-${place.lat}-${place.lon}-${i}`}
          position={[place.lat, place.lon]}
          icon={labeledPlaceIcon(place, i + 1)}
        />
      ))}
    </MapContainer>
  );
}

/** Build labeled places from itinerary days, colored by day. */
export function placesFromItineraryGroups(
  groups: { sights: ItineraryStop[]; index: number }[],
): LabeledMapPlace[] {
  return groups.flatMap(({ sights, index }) =>
    sights.map((stop) => ({
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      category: stop.category,
      groupLabel: `Day ${index + 1}`,
      color: GROUP_COLORS[index % GROUP_COLORS.length],
    })),
  );
}

export function placesFromStops(
  stops: ItineraryStop[],
  groupLabel?: string,
  color?: string,
): LabeledMapPlace[] {
  return stops
    .filter((s) => !s.is_meal)
    .map((stop) => ({
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      category: stop.category,
      groupLabel,
      color,
    }));
}
