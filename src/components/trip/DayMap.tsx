import { useEffect } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import type { DayItinerary } from '../../types';
import 'leaflet/dist/leaflet.css';

const stopIcon = (n: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#1f6f68;color:white;display:grid;place-items:center;font:700 12px Outfit,sans-serif;border:2px solid white;box-shadow:0 4px 10px rgba(0,0,0,.25)">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const hotelIcon = L.divIcon({
  className: '',
  html: `<div style="width:30px;height:30px;border-radius:8px;background:#c45c4a;color:white;display:grid;place-items:center;font:700 14px Outfit,sans-serif;border:2px solid white;box-shadow:0 4px 10px rgba(0,0,0,.25)">H</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function FitBounds({
  day,
  hotelLat,
  hotelLon,
}: {
  day: DayItinerary;
  hotelLat: number;
  hotelLon: number;
}) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      [hotelLat, hotelLon],
      ...day.stops.map((s) => [s.lat, s.lon] as [number, number]),
    ];
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [day, hotelLat, hotelLon, map]);
  return null;
}

interface DayMapProps {
  day: DayItinerary;
  hotelLat: number;
  hotelLon: number;
}

const breakfastIcon = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#c4a35a;color:white;display:grid;place-items:center;font:700 11px Outfit,sans-serif;border:2px solid white;box-shadow:0 4px 10px rgba(0,0,0,.25)">B</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export function DayMap({ day, hotelLat, hotelLon }: DayMapProps) {
  const sightStops = day.stops.filter((s) => !s.is_meal);
  const mealStops = day.stops.filter((s) => s.is_meal);
  const route: [number, number][] = [
    [hotelLat, hotelLon],
    ...mealStops.map((s) => [s.lat, s.lon] as [number, number]),
    ...sightStops.map((s) => [s.lat, s.lon] as [number, number]),
    [hotelLat, hotelLon],
  ];

  return (
    <MapContainer
      center={[hotelLat, hotelLon]}
      zoom={13}
      scrollWheelZoom={false}
      style={{ width: '100%', height: '100%', minHeight: 420 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds day={day} hotelLat={hotelLat} hotelLon={hotelLon} />
      <Marker position={[hotelLat, hotelLon]} icon={hotelIcon}>
        <Popup>Base / Hotel</Popup>
      </Marker>
      {mealStops.map((stop) => (
        <Marker
          key={`meal-${stop.name}`}
          position={[stop.lat, stop.lon]}
          icon={breakfastIcon}
        >
          <Popup>
            <strong>{stop.name}</strong>
            <br />
            {stop.time_slot} · Breakfast
          </Popup>
        </Marker>
      ))}
      {sightStops.map((stop, i) => (
        <Marker
          key={`${stop.name}-${i}`}
          position={[stop.lat, stop.lon]}
          icon={stopIcon(i + 1)}
        >
          <Popup>
            <strong>
              {i + 1}. {stop.name}
            </strong>
            <br />
            {stop.time_slot} · {stop.category}
          </Popup>
        </Marker>
      ))}
      {sightStops.length > 0 && (
        <Polyline
          positions={route}
          pathOptions={{ color: '#1f6f68', weight: 3, opacity: 0.75 }}
        />
      )}
    </MapContainer>
  );
}
