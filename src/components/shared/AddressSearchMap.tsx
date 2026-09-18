import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { findAccommodation, type GeocodeResult } from '../../services/nominatim';
import 'leaflet/dist/leaflet.css';

import type { TripAccommodation } from '../../types';

interface AddressSearchMapProps {
  city: string;
  value: TripAccommodation | null;
  onConfirm: (accommodation: TripAccommodation) => void;
  onChange?: () => void;
  initialQuery?: string;
}

const pin = L.divIcon({
  className: '',
  html: '<div class="address-map-pin"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function AddressSearchMap({ city, value, onConfirm, onChange, initialQuery = '' }: AddressSearchMapProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    if (value || selected || query.trim().length < 4) {
      setResults([]);
      setSearching(false);
      setError('');
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError('');
    const timer = window.setTimeout(() => {
      void findAccommodation(query, city)
        .then((matches) => {
          if (requestId.current !== id) return;
          setResults(matches);
          if (!matches.length) setError(`No matching accommodation or address found in ${city}.`);
        })
        .catch(() => {
          if (requestId.current === id) setError('Address search is unavailable. Please try again.');
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [city, query, selected, value]);

  if (value) {
    return (
      <section className="address-search address-search--confirmed">
        <div className="address-confirmed-copy">
          <div><span className="address-status">Confirmed location</span><strong>{value.address}</strong></div>
          <button type="button" className="btn btn-ghost" onClick={onChange}>Change</button>
        </div>
        <MapContainer key={`${value.latitude},${value.longitude}`} center={[value.latitude, value.longitude]} zoom={16} scrollWheelZoom className="address-map">
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker position={[value.latitude, value.longitude]} icon={pin} />
        </MapContainer>
        <p className="address-coordinates">{value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}</p>
      </section>
    );
  }

  return (
    <section className="address-search">
      <label htmlFor="hotel-address">Hotel or address</label>
      <div className="address-input-shell">
        <svg className="address-input-icon" viewBox="0 0 24 24" aria-hidden>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input id="hotel-address" type="search" autoComplete="off" value={query} placeholder={`Search an accommodation or address in ${city}`} onChange={(event) => {
          setQuery(event.target.value);
          setSelected(null);
        }} />
        {searching ? <span className="address-input-spinner" aria-hidden /> : query && (
          <button type="button" className="address-input-clear" aria-label="Clear address" onClick={() => {
            setQuery('');
            setSelected(null);
            setResults([]);
            setError('');
          }}>×</button>
        )}
      </div>
      {(searching || error) && <p className="address-search-status" role="status">{searching ? 'Searching addresses…' : error}</p>}
      {results.length > 0 && (
        <ul className="suggestions address-results">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon},${result.display_name}`}>
              <button type="button" onClick={() => {
                setSelected(result);
                setQuery(result.display_name);
                setResults([]);
                setError('');
              }}>{result.display_name}</button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="address-preview">
          <MapContainer key={`${selected.lat},${selected.lon}`} center={[selected.lat, selected.lon]} zoom={16} scrollWheelZoom className="address-map">
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[selected.lat, selected.lon]} icon={pin} />
          </MapContainer>
          <p className="address-coordinates">{selected.lat.toFixed(6)}, {selected.lon.toFixed(6)}</p>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm({ address: selected.display_name, latitude: selected.lat, longitude: selected.lon })}>Confirm this location</button>
        </div>
      )}
    </section>
  );
}
