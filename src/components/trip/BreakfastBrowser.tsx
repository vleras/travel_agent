import { useEffect, useMemo, useState } from 'react';
import { BREAKFAST_CATEGORIES } from '../../types/breakfast';
import type { BreakfastCategory, BreakfastPlace } from '../../types/breakfast';
import {
  fetchBreakfastOptions,
  filterBreakfastPlaces,
  inferCategoriesFromFood,
  rankPlacesByFoodPreference,
} from '../../services/breakfast';
import { PlaceImage } from '../shared/PlaceImage';

interface BreakfastBrowserProps {
  city: string;
  baseLat: number;
  baseLon: number;
  hasHotel: boolean;
  foodPreference: string | null;
  selectedId: string | null;
  previewId: string | null;
  onPreview: (place: BreakfastPlace) => void;
  onFoodPreferenceChange: (food: string) => void;
}

export function BreakfastBrowser({
  city,
  baseLat,
  baseLon,
  hasHotel,
  foodPreference,
  selectedId,
  previewId,
  onPreview,
  onFoodPreferenceChange,
}: BreakfastBrowserProps) {
  const inferred = inferCategoriesFromFood(foodPreference);
  const [category, setCategory] = useState<BreakfastCategory>(
    inferred.includes('all') ? 'all' : inferred[0],
  );
  const [places, setPlaces] = useState<BreakfastPlace[]>([]);
  const [nearBase, setNearBase] = useState(hasHotel);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = inferCategoriesFromFood(foodPreference);
    setCategory(next.includes('all') ? 'all' : next[0]);
  }, [foodPreference]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchBreakfastOptions({ baseLat, baseLon, city, hasHotel })
      .then((result) => {
        if (cancelled) return;
        setPlaces(result.places);
        setNearBase(result.nearBase);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load breakfast spots. Try again in a moment.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseLat, baseLon, city, hasHotel]);

  const ranked = useMemo(
    () => rankPlacesByFoodPreference(places, foodPreference),
    [places, foodPreference],
  );

  const filtered = useMemo(() => {
    const pool =
      foodPreference?.trim() && ranked.matched.length
        ? [...ranked.matched, ...ranked.other]
        : places;
    return filterBreakfastPlaces(pool, category);
  }, [places, ranked, foodPreference, category]);

  return (
    <div className="breakfast-browser">
      <div className="breakfast-browser-header">
        <strong>Where to eat breakfast?</strong>
        <p>
          {nearBase
            ? 'Tap a place — details open on the left. Then choose one for your itinerary.'
            : 'No hotel set — browsing the city center. Tap a place for details on the left.'}
        </p>
      </div>

      <div className="field" style={{ marginBottom: '0.85rem' }}>
        <label htmlFor="food-pref-live">What do you want to eat?</label>
        <input
          id="food-pref-live"
          type="text"
          value={foodPreference ?? ''}
          placeholder="e.g. croissants, eggs, coffee…"
          onChange={(e) => onFoodPreferenceChange(e.target.value)}
        />
      </div>

      {foodPreference?.trim() && !ranked.categories.includes('all') && (
        <p className="breakfast-status">
          Showing places that match <strong>{foodPreference}</strong>
          {ranked.categories.length
            ? ` (${ranked.categories.join(', ')})`
            : ''}
          .
        </p>
      )}

      <div className="chip-row breakfast-cats">
        {BREAKFAST_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
            title={c.hint}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading && <p className="breakfast-status">Finding bakeries, cafés & coffee…</p>}
      {error && <p className="breakfast-status error">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="breakfast-status">
          No spots match yet — try All, or change what you want to eat.
        </p>
      )}

      <div className="breakfast-grid">
        {filtered.map((place) => {
          const isMatch =
            !foodPreference?.trim() ||
            ranked.categories.includes('all') ||
            ranked.matched.some((m) => m.id === place.id);
          const isPreview = previewId === place.id;
          return (
            <button
              key={place.id}
              type="button"
              className={`breakfast-card ${selectedId === place.id ? 'selected' : ''} ${isPreview ? 'previewing' : ''}`}
              onClick={() => onPreview(place)}
            >
              <PlaceImage
                className="breakfast-card-photo"
                name={place.name}
                city={city}
                category={place.categoryLabel}
                lat={place.lat}
                lon={place.lon}
              />
              <div className="breakfast-card-body">
                <span className="category-pill">{place.categoryLabel}</span>
                {isMatch && foodPreference?.trim() && (
                  <span className="category-pill match-pill">Matches your food</span>
                )}
                <h4>{place.name}</h4>
                <p>{place.address || place.description}</p>
                <div className="breakfast-card-meta">
                  {place.distance_km != null && (
                    <span>
                      {place.distance_km.toFixed(1)} km from{' '}
                      {hasHotel ? 'your address' : 'city center'}
                    </span>
                  )}
                  {selectedId === place.id && <span className="picked">Selected</span>}
                </div>
                <span className="breakfast-card-cta">
                  {isPreview ? 'Showing details ←' : 'View details ←'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
