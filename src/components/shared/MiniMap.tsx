import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pin = L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#c45c4a;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

interface MiniMapProps {
  lat: number;
  lon: number;
  className?: string;
  zoom?: number;
}

/** Always-reliable location preview (no external static-map host). */
export function MiniMap({ lat, lon, className, zoom = 16 }: MiniMapProps) {
  return (
    <div className={className} style={{ minHeight: 160 }}>
      <MapContainer
        center={[lat, lon]}
        zoom={zoom}
        scrollWheelZoom={false}
        dragging={false}
        zoomControl={false}
        style={{ width: '100%', height: '100%', minHeight: 160, borderRadius: 12 }}
      >
        <TileLayer
          attribution='&copy; OSM'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lon]} icon={pin} />
      </MapContainer>
    </div>
  );
}
