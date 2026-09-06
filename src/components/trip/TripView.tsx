import { useEffect, useState } from 'react';
import { TravelChatBot } from '../chat/TravelChatBot';
import { normalizeBreakfastTime } from '../../data/scheduleOptions';
import { resolvePlaceAsStop } from '../../services/chatbot';
import { formatDayTab, formatTripRange } from '../../services/geo';
import { rescheduleDayStops } from '../../services/agent';
import type {
  AgentOutput,
  DayItinerary,
  ItineraryStop,
  TripInput,
} from '../../types';
import type { BreakfastPlace } from '../../types/breakfast';
import { DayMap } from './DayMap';
import { ItineraryList } from './ItineraryList';
import {
  PlaceDetailPage,
  type DetailTarget,
} from './PlaceDetailPane';
import '../../styles/trip.css';

interface TripViewProps {
  input: TripInput;
  output: AgentOutput;
  onBack: () => void;
  initialChatNotes?: string[];
}

export function TripView({
  input,
  output,
  onBack,
  initialChatNotes = [],
}: TripViewProps) {
  const [activeDay, setActiveDay] = useState(0);
  const [itinerary, setItinerary] = useState<DayItinerary[]>(output.itinerary);
  const [dayStartTime, setDayStartTime] = useState(input.day_start_time);
  const [breakfastTime, setBreakfastTime] = useState(input.breakfast_time);
  const [breakfastFood, setBreakfastFood] = useState<string | null>(
    input.breakfast_food,
  );
  const [selectedBreakfast, setSelectedBreakfast] =
    useState<BreakfastPlace | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [chatNotes, setChatNotes] = useState<string[]>(initialChatNotes);

  useEffect(() => {
    setItinerary(output.itinerary);
  }, [output]);

  useEffect(() => {
    setDetail(null);
  }, [activeDay]);

  const day = itinerary[activeDay];
  if (!day) return null;

  const browsingBreakfast =
    breakfastTime !== 'skip' && selectedBreakfast == null;

  function applySchedule(
    start: string,
    breakfast: string,
    place: BreakfastPlace | null,
    food = breakfastFood,
  ) {
    const nextBreakfast =
      breakfast === 'skip' ? 'skip' : normalizeBreakfastTime(breakfast);
    if (breakfast !== 'skip' && nextBreakfast === 'skip') return;

    setDayStartTime(start);
    setBreakfastTime(nextBreakfast);
    setItinerary((prev) =>
      prev.map((d) =>
        rescheduleDayStops(
          d,
          start,
          nextBreakfast,
          output.metadata.hotel_lat,
          output.metadata.hotel_lon,
          input.destination_city,
          place,
          food,
        ),
      ),
    );
  }

  function handleScheduleChange(start: string, breakfast: string) {
    if (breakfast === 'skip') {
      setSelectedBreakfast(null);
      setDetail(null);
      applySchedule(start, 'skip', null);
      return;
    }
    const normalized = normalizeBreakfastTime(breakfast);
    if (normalized === 'skip') {
      setBreakfastTime(breakfast);
      setDayStartTime(start);
      return;
    }
    applySchedule(start, normalized, selectedBreakfast);
  }

  function openPlace(target: DetailTarget) {
    setDetail(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeDetail() {
    setDetail(null);
  }

  function handleBreakfastSelect(place: BreakfastPlace) {
    setSelectedBreakfast(place);
    applySchedule(dayStartTime, breakfastTime, place);
    setDetail(null);
  }

  async function handleAddPlaceFromChat(placeQuery: string): Promise<string> {
    const stop = await resolvePlaceAsStop(
      placeQuery,
      input.destination_city,
      output.metadata.hotel_lat,
      output.metadata.hotel_lon,
    );
    if (!stop) {
      return `I couldn’t find “${placeQuery}” near ${input.destination_city}. Try a more specific name.`;
    }

    setItinerary((prev) =>
      prev.map((d, i) => {
        if (i !== activeDay) return d;
        const withoutDup = d.stops.filter(
          (s) => s.name.toLowerCase() !== stop.name.toLowerCase(),
        );
        const nextStops = [...withoutDup, stop];
        return rescheduleDayStops(
          { ...d, stops: nextStops },
          dayStartTime,
          breakfastTime,
          output.metadata.hotel_lat,
          output.metadata.hotel_lon,
          input.destination_city,
          selectedBreakfast,
          breakfastFood,
        );
      }),
    );
    openPlace({ kind: 'stop', stop });
    setChatNotes((prev) =>
      prev.includes(`Must visit: ${stop.name}`)
        ? prev
        : [...prev, `Must visit: ${stop.name}`],
    );

    return `Added “${stop.name}” to Day ${activeDay + 1}. Opened its details page.`;
  }

  if (detail) {
    return (
      <div className="trip-view">
        <PlaceDetailPage
          target={detail}
          city={input.destination_city}
          hasHotel={Boolean(input.hotel_address)}
          dayLabel={`Day ${activeDay + 1}`}
          isBreakfastSelected={
            detail.kind === 'breakfast' &&
            selectedBreakfast?.id === detail.place.id
          }
          onBack={closeDetail}
          onAddToTrip={
            detail.kind === 'breakfast' ? handleBreakfastSelect : undefined
          }
        />
        <TravelChatBot
          city={input.destination_city}
          hasTrip
          onDietary={(label, breakfastHint) => {
            setBreakfastFood(breakfastHint);
            setChatNotes((prev) =>
              prev.includes(`Diet: ${label}`)
                ? prev
                : [...prev, `Diet: ${label}`],
            );
            applySchedule(
              dayStartTime,
              breakfastTime,
              selectedBreakfast,
              breakfastHint,
            );
          }}
          onPreference={(note) => {
            setChatNotes((prev) =>
              prev.includes(note) ? prev : [...prev, note],
            );
          }}
          onAddPlace={handleAddPlaceFromChat}
          onSkipBreakfast={() => {
            setSelectedBreakfast(null);
            setDetail(null);
            applySchedule(dayStartTime, 'skip', null);
            setChatNotes((prev) =>
              prev.includes('Skip breakfast')
                ? prev
                : [...prev, 'Skip breakfast'],
            );
            return 'Skipped breakfast for now.';
          }}
          onPlanDay={(dayNum) => {
            const idx = Math.max(0, Math.min(itinerary.length, dayNum) - 1);
            setActiveDay(idx);
            setDetail(null);
            return `Opened Day ${idx + 1}.`;
          }}
          onMoveStop={() =>
            'Go back to the trip list first, then tell me which stop to move.'
          }
          onShowOptions={() =>
            'Go back to the trip list to browse day’s options, or ask to add a place.'
          }
        />
      </div>
    );
  }

  return (
    <div className="trip-view">
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
              Trip to {input.destination_city} (
              {formatTripRange(input.start_date, input.end_date)})
            </h1>
          </div>
        </div>
        <div className="trip-topbar-right">
          <button type="button" className="btn btn-secondary" disabled title="Phase 2">
            Share
          </button>
          <button type="button" className="btn btn-secondary" disabled title="Phase 2">
            •••
          </button>
        </div>
      </header>

      {chatNotes.length > 0 && (
        <div className="chat-notes-bar">
          <strong>From chat:</strong> {chatNotes.join(' · ')}
        </div>
      )}

      <div className="day-tabs" role="tablist">
        {itinerary.map((d, i) => (
          <button
            key={d.date}
            type="button"
            role="tab"
            aria-selected={i === activeDay}
            className={`day-tab ${i === activeDay ? 'active' : ''}`}
            onClick={() => setActiveDay(i)}
          >
            {formatDayTab(d.date)}
          </button>
        ))}
      </div>

      <div
        className={`trip-body ${browsingBreakfast ? 'trip-body--browse' : ''}`}
      >
        {!browsingBreakfast && (
          <div className="map-pane">
            <DayMap
              key={`${day.date}-${day.stops.map((s) => `${s.name}-${s.time_slot}`).join('|')}`}
              day={day}
              hotelLat={output.metadata.hotel_lat}
              hotelLon={output.metadata.hotel_lon}
            />
          </div>
        )}

        <div className="list-pane">
          <ItineraryList
            day={day}
            output={{ ...output, itinerary }}
            city={input.destination_city}
            baseLat={output.metadata.hotel_lat}
            baseLon={output.metadata.hotel_lon}
            hasHotel={Boolean(input.hotel_address)}
            dayStartTime={dayStartTime}
            breakfastTime={breakfastTime}
            breakfastFood={breakfastFood}
            selectedBreakfast={selectedBreakfast}
            previewBreakfastId={null}
            previewStopKey={null}
            onScheduleChange={handleScheduleChange}
            onBreakfastFoodChange={setBreakfastFood}
            onBreakfastPreview={(place) =>
              openPlace({ kind: 'breakfast', place })
            }
            onStopPreview={(stop) => openPlace({ kind: 'stop', stop })}
          />
        </div>
      </div>

      <TravelChatBot
        city={input.destination_city}
        hasTrip
        onDietary={(label, breakfastHint) => {
          setBreakfastFood(breakfastHint);
          setChatNotes((prev) =>
            prev.includes(`Diet: ${label}`) ? prev : [...prev, `Diet: ${label}`],
          );
          applySchedule(
            dayStartTime,
            breakfastTime,
            selectedBreakfast,
            breakfastHint,
          );
        }}
        onPreference={(note) => {
          setChatNotes((prev) => (prev.includes(note) ? prev : [...prev, note]));
        }}
        onAddPlace={handleAddPlaceFromChat}
        onSkipBreakfast={() => {
          setSelectedBreakfast(null);
          setDetail(null);
          applySchedule(dayStartTime, 'skip', null);
          setChatNotes((prev) =>
            prev.includes('Skip breakfast') ? prev : [...prev, 'Skip breakfast'],
          );
          return 'Skipped breakfast for now. Say “plan day 1” when you’re ready to focus a day.';
        }}
        onPlanDay={(dayNum) => {
          const idx = Math.max(0, Math.min(itinerary.length, dayNum) - 1);
          setActiveDay(idx);
          setDetail(null);
          const stops = itinerary[idx]?.stops ?? [];
          const names = stops
            .filter((s) => !s.is_meal)
            .map((s) => s.name)
            .slice(0, 6);
          return names.length
            ? `Focusing Day ${idx + 1}. Current stops: ${names.join(', ')}. Tap any stop for its page, or tell me to move one.`
            : `Opened Day ${idx + 1}. It’s light so far — ask to add a place or show cafés/parks/nightlife.`;
        }}
        onMoveStop={(stopName, toDay) => {
          const targetIdx = toDay - 1;
          if (targetIdx < 0 || targetIdx >= itinerary.length) {
            return `Day ${toDay} doesn’t exist (this trip has ${itinerary.length} days).`;
          }
          const needle = stopName.toLowerCase();
          let fromIdx = -1;
          let stopIdx = -1;
          let moving: ItineraryStop | undefined;

          for (let di = 0; di < itinerary.length; di++) {
            const si = itinerary[di].stops.findIndex((s) =>
              s.name.toLowerCase().includes(needle),
            );
            if (si >= 0) {
              fromIdx = di;
              stopIdx = si;
              moving = itinerary[di].stops[si];
              break;
            }
          }

          if (!moving || fromIdx < 0 || stopIdx < 0) {
            return `I couldn’t find a stop matching “${stopName}”. Check the name on the list.`;
          }

          const moved: ItineraryStop = moving;
          setItinerary((prev) => {
            const copy = prev.map((d) => ({ ...d, stops: [...d.stops] }));
            copy[fromIdx].stops.splice(stopIdx, 1);
            copy[targetIdx].stops.push(moved);
            return copy.map((d) =>
              rescheduleDayStops(
                d,
                dayStartTime,
                breakfastTime,
                output.metadata.hotel_lat,
                output.metadata.hotel_lon,
                input.destination_city,
                selectedBreakfast,
                breakfastFood,
              ),
            );
          });

          setActiveDay(targetIdx);
          openPlace({ kind: 'stop', stop: moved });
          return `Moved “${moved.name}” to Day ${toDay}.`;
        }}
        onShowOptions={(category) => {
          const cat = category.toLowerCase();
          const mapped =
            /park/.test(cat)
              ? 'Nature'
              : /night/.test(cat)
                ? 'Nightlife'
                : /cafe|café|coffee/.test(cat)
                  ? 'Food'
                  : /museum/.test(cat)
                    ? 'Museums'
                    : /shop/.test(cat)
                      ? 'Shopping'
                      : null;

          const matches = day.stops.filter((s) => {
            if (s.is_meal) return false;
            if (!mapped) return true;
            return (
              s.category.toLowerCase().includes(mapped.toLowerCase()) ||
              s.name.toLowerCase().includes(cat)
            );
          });

          if (!matches.length) {
            return `No ${category} stops on Day ${activeDay + 1} yet. Try “I want to visit …” to add one, or switch days.`;
          }

          openPlace({ kind: 'stop', stop: matches[0] });
          return `Here are ${category} options on Day ${activeDay + 1}: ${matches.map((m) => m.name).join(', ')}. Opened “${matches[0].name}” — tap Back for the list.`;
        }}
      />
    </div>
  );
}
