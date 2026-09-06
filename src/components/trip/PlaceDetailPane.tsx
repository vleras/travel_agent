import { useEffect, useState } from 'react';
import { PlaceImage, fetchPlacePhotoUrls } from '../shared/PlaceImage';
import { MiniMap } from '../shared/MiniMap';
import type { BreakfastPlace } from '../../types/breakfast';
import type { ItineraryStop } from '../../types';
import { minutesToLabel } from '../../services/geo';

type DetailTarget =
  | { kind: 'breakfast'; place: BreakfastPlace }
  | { kind: 'stop'; stop: ItineraryStop };

interface PlaceDetailPaneProps {
  target: DetailTarget;
  city: string;
  hasHotel: boolean;
  isBreakfastSelected?: boolean;
  onClose: () => void;
  onChooseBreakfast?: (place: BreakfastPlace) => void;
  onShowMap?: () => void;
  showMapButton?: boolean;
}

function distanceLabel(km: number | undefined, hasHotel: boolean): string {
  if (km == null) return 'Distance unavailable';
  return `${km.toFixed(1)} km from ${hasHotel ? 'your address' : 'city center'}`;
}

function PhotoGallery({
  name,
  city,
  category,
}: {
  name: string;
  city: string;
  category?: string;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setActive(0);
    void fetchPlacePhotoUrls(name, city, category).then((urls) => {
      if (!cancelled) setPhotos(urls.slice(0, 4));
    });
    return () => {
      cancelled = true;
    };
  }, [name, city, category]);

  if (!photos.length) {
    return (
      <PlaceImage
        className="place-detail-hero"
        name={name}
        city={city}
        category={category}
      />
    );
  }

  return (
    <div className="place-photo-gallery">
      <img
        className="place-detail-hero"
        src={photos[active]}
        alt={`${name} photo ${active + 1}`}
        referrerPolicy="no-referrer"
        onError={() => {
          if (active < photos.length - 1) setActive((a) => a + 1);
        }}
      />
      {photos.length > 1 && (
        <div className="place-photo-thumbs">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              className={`place-photo-thumb ${i === active ? 'active' : ''}`}
              onClick={() => setActive(i)}
            >
              <img src={url} alt="" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlaceDetailPane({
  target,
  city,
  hasHotel,
  isBreakfastSelected,
  onClose,
  onChooseBreakfast,
  onShowMap,
  showMapButton,
}: PlaceDetailPaneProps) {
  if (target.kind === 'breakfast') {
    const place = target.place;
    const mapsLink = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=18/${place.lat}/${place.lon}`;

    return (
      <aside className="place-detail-pane">
        <div className="place-detail-pane-top">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ← Back to list
          </button>
          {showMapButton && onShowMap && (
            <button type="button" className="btn btn-secondary" onClick={onShowMap}>
              Trip map
            </button>
          )}
        </div>

        <PhotoGallery
          name={place.name}
          city={city}
          category={place.categoryLabel}
        />

        <div className="place-detail-body">
          <span className="category-pill">{place.categoryLabel}</span>
          <h2>{place.name}</h2>
          <p>{place.description}</p>

          <dl className="breakfast-detail-facts">
            <div>
              <dt>Distance</dt>
              <dd>{distanceLabel(place.distance_km, hasHotel)}</dd>
            </div>
            {place.address && (
              <div>
                <dt>Location</dt>
                <dd>{place.address}</dd>
              </div>
            )}
            {place.cuisine && (
              <div>
                <dt>Cuisine / food</dt>
                <dd>{place.cuisine}</dd>
              </div>
            )}
            {place.opening_hours && (
              <div>
                <dt>Hours</dt>
                <dd>{place.opening_hours}</dd>
              </div>
            )}
            {place.phone && (
              <div>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${place.phone}`}>{place.phone}</a>
                </dd>
              </div>
            )}
          </dl>

          <div className="breakfast-detail-map-wrap">
            <p className="hint" style={{ marginBottom: '0.4rem' }}>
              Exact location
            </p>
            <MiniMap lat={place.lat} lon={place.lon} className="breakfast-detail-map" />
          </div>

          <div className="breakfast-detail-links">
            {place.website && (
              <a href={place.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
            {place.menu_url && (
              <a href={place.menu_url} target="_blank" rel="noreferrer">
                Menu
              </a>
            )}
            <a href={mapsLink} target="_blank" rel="noreferrer">
              Open map
            </a>
            {place.osm_url && (
              <a href={place.osm_url} target="_blank" rel="noreferrer">
                OSM listing
              </a>
            )}
          </div>

          {onChooseBreakfast && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => onChooseBreakfast(place)}
            >
              {isBreakfastSelected ? 'Selected ✓' : 'Choose this place'}
            </button>
          )}
        </div>
      </aside>
    );
  }

  const stop = target.stop;
  const mapsLink = `https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lon}#map=18/${stop.lat}/${stop.lon}`;

  return (
    <aside className="place-detail-pane">
      <div className="place-detail-pane-top">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ← Back to map
        </button>
      </div>

      <PhotoGallery name={stop.name} city={city} category={stop.category} />

      <div className="place-detail-body">
        <span className="category-pill">{stop.category}</span>
        {stop.is_meal && <span className="category-pill match-pill">Breakfast</span>}
        <h2>{stop.name}</h2>
        <p>{stop.description}</p>

        <dl className="breakfast-detail-facts">
          <div>
            <dt>Time</dt>
            <dd>{stop.time_slot}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{minutesToLabel(stop.duration_min)}</dd>
          </div>
          {stop.distance_to_next_km != null && (
            <div>
              <dt>To next stop</dt>
              <dd>{stop.distance_to_next_km} km</dd>
            </div>
          )}
        </dl>

        <div className="breakfast-detail-map-wrap">
          <p className="hint" style={{ marginBottom: '0.4rem' }}>
            Exact location
          </p>
          <MiniMap lat={stop.lat} lon={stop.lon} className="breakfast-detail-map" />
        </div>

        <div className="breakfast-detail-links">
          <a href={mapsLink} target="_blank" rel="noreferrer">
            Open map
          </a>
        </div>
      </div>
    </aside>
  );
}

export type { DetailTarget };
