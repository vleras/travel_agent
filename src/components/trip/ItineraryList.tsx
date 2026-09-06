import { useEffect, useState } from 'react';
import { parseFlexibleTime } from '../../data/scheduleOptions';
import { minutesToLabel } from '../../services/geo';
import type { AgentOutput, DayItinerary, ItineraryStop } from '../../types';
import type { BreakfastPlace } from '../../types/breakfast';
import { PlaceImage } from '../shared/PlaceImage';
import { BreakfastBrowser } from './BreakfastBrowser';
import { CompactnessBadge } from './CompactnessBadge';

interface ItineraryListProps {
  day: DayItinerary;
  output: AgentOutput;
  city: string;
  baseLat: number;
  baseLon: number;
  hasHotel: boolean;
  dayStartTime: string;
  breakfastTime: string;
  breakfastFood: string | null;
  selectedBreakfast: BreakfastPlace | null;
  previewBreakfastId: string | null;
  previewStopKey: string | null;
  onScheduleChange: (start: string, breakfast: string) => void;
  onBreakfastFoodChange: (food: string) => void;
  onBreakfastPreview: (place: BreakfastPlace) => void;
  onStopPreview: (stop: ItineraryStop, key: string) => void;
}

export function ItineraryList({
  day,
  output,
  city,
  baseLat,
  baseLon,
  hasHotel,
  dayStartTime,
  breakfastTime,
  breakfastFood,
  selectedBreakfast,
  previewBreakfastId,
  previewStopKey,
  onScheduleChange,
  onBreakfastFoodChange,
  onBreakfastPreview,
  onStopPreview,
}: ItineraryListProps) {
  const showBreakfastBrowser = breakfastTime !== 'skip';
  const breakfastInput = breakfastTime === 'skip' ? '' : breakfastTime;
  const [startDraft, setStartDraft] = useState(dayStartTime);

  useEffect(() => {
    setStartDraft(dayStartTime);
  }, [dayStartTime]);

  function commitStart(raw: string) {
    setStartDraft(raw);
    const parsed = parseFlexibleTime(raw);
    if (parsed) onScheduleChange(parsed, breakfastTime);
  }

  return (
    <div>
      <div className="schedule-controls">
        <div className="field">
          <label htmlFor="day-start-live">Start sightseeing</label>
          <input
            id="day-start-live"
            type="text"
            value={startDraft}
            placeholder='e.g. 9, "8 thirty", half past eight'
            onChange={(e) => commitStart(e.target.value)}
            onBlur={(e) => {
              const parsed = parseFlexibleTime(e.target.value);
              if (parsed) setStartDraft(parsed);
            }}
          />
          {startDraft.trim() && parseFlexibleTime(startDraft) == null && (
            <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
              Try “8 thirty” or “half past eight”.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="breakfast-time-live">Breakfast time</label>
          <input
            id="breakfast-time-live"
            type="text"
            value={breakfastInput}
            placeholder='e.g. 8 thirty — leave empty to skip'
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                onScheduleChange(dayStartTime, 'skip');
                return;
              }
              const parsed = parseFlexibleTime(raw);
              onScheduleChange(dayStartTime, parsed ?? raw);
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                onScheduleChange(dayStartTime, 'skip');
                return;
              }
              const parsed = parseFlexibleTime(raw);
              if (parsed) onScheduleChange(dayStartTime, parsed);
            }}
          />
          <p className="hint" style={{ margin: 0 }}>
            Type freely (e.g. “8 thirty”). Clear the field to skip breakfast.
          </p>
        </div>
      </div>

      {showBreakfastBrowser && (
        <BreakfastBrowser
          city={city}
          baseLat={baseLat}
          baseLon={baseLon}
          hasHotel={hasHotel}
          foodPreference={breakfastFood}
          selectedId={selectedBreakfast?.id ?? null}
          previewId={previewBreakfastId}
          onPreview={onBreakfastPreview}
          onFoodPreferenceChange={onBreakfastFoodChange}
        />
      )}

      {output.revisions.length > 0 && (
        <div className="revision-banner">
          <strong>Agent revisions ({output.revisions.length})</strong>
          {output.revisions.map((r, i) => (
            <div key={`${r.stop_name}-${i}`}>
              Moved “{r.stop_name}” from Day {r.day_from} → Day {r.day_to} ({r.reason})
            </div>
          ))}
        </div>
      )}

      {day.stops.map((stop, i) => {
        const sightIndex = day.stops
          .slice(0, i + 1)
          .filter((s) => !s.is_meal).length;
        const labelIndex = stop.is_meal ? null : sightIndex;
        const key = `${stop.name}-${stop.time_slot}-${i}`;
        const isPreview = previewStopKey === key;

        return (
          <button
            key={key}
            type="button"
            className={`stop-card stop-card-button ${stop.is_meal ? 'stop-meal' : ''} ${isPreview ? 'previewing' : ''}`}
            onClick={() => onStopPreview(stop, key)}
          >
            <PlaceImage
              className="stop-photo"
              name={stop.name}
              city={city}
              category={stop.category}
              imageUrl={stop.image_url}
              lat={stop.lat}
              lon={stop.lon}
            />
            <div className="stop-time">
              {stop.time_slot}
              {stop.is_meal ? ' · Breakfast' : ''}
            </div>
            <h3>
              {labelIndex != null ? `${labelIndex}. ` : ''}
              {stop.name}
            </h3>
            <p>{stop.description}</p>
            <div className="stop-meta">
              <span className="category-pill">◉ {stop.category}</span>
              <span>Duration: {minutesToLabel(stop.duration_min)}</span>
              {stop.distance_to_next_km != null && (
                <span>Next: {stop.distance_to_next_km} km</span>
              )}
            </div>
            <span className="breakfast-card-cta">
              {isPreview ? 'Showing details ←' : 'View details ←'}
            </span>
          </button>
        );
      })}

      <div className="day-footer">
        <CompactnessBadge day={day} />
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          From base: {day.hotel_distance_km} km
        </span>
      </div>

      <div className="metrics-panel">
        <div>
          Before revision:{' '}
          <code>{output.metrics.compactness_before_revision}</code> → after:{' '}
          <code>{output.metrics.compactness_after_revision}</code> (Δ{' '}
          <code>{output.metrics.improvement_delta}</code>)
        </div>
        <div>
          Processing: <code>{output.metrics.agent_processing_time_ms} ms</code> ·
          API calls: <code>{output.metrics.api_calls_total}</code>
        </div>
      </div>
    </div>
  );
}
