import { useState } from 'react';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pin = L.divIcon({
  className: '',
  html: '<div class="address-map-pin"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function ClickToPlace({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/** Tap the map to drop a pin, then confirm it. */
export function MapPicker({
  center,
  onConfirm,
  onCancel,
}: {
  center: { lat: number; lon: number };
  onConfirm: (lat: number, lon: number) => void;
  onCancel: () => void;
}) {
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  return (
    <div className="map-picker">
      <p className="hint">Tap the map where you’re staying.</p>
      <MapContainer center={[center.lat, center.lon]} zoom={15} scrollWheelZoom className="address-map">
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickToPlace onPick={(lat, lon) => setPoint({ lat, lon })} />
        {point && <Marker position={[point.lat, point.lon]} icon={pin} />}
      </MapContainer>
      {point && <p className="address-coordinates">{point.lat.toFixed(6)}, {point.lon.toFixed(6)}</p>}
      <div className="map-picker-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!point} onClick={() => point && onConfirm(point.lat, point.lon)}>
          Use this location
        </button>
      </div>
    </div>
  );
}
