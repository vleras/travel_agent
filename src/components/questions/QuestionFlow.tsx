import { useEffect, useMemo, useState } from 'react';
import {
  availableInterestOptions,
  destinationRecommendations,
  PACE_OPTIONS,
} from '../../data/destinations';
import {
  BREAKFAST_FOOD_SUGGESTIONS,
  normalizeBreakfastTime,
  parseDaysInput,
  parseFlexibleTime,
} from '../../data/scheduleOptions';
import { cityHasBeach } from '../../services/beachCheck';
import { addDays, nextWeekendStart, toISODate } from '../../services/geo';
import { autocompletePlaces, type GeocodeResult } from '../../services/nominatim';
import {
  loadQuestionState,
  saveQuestionState,
} from '../../services/sessionState';
import type {
  DestinationCard,
  DestinationHighlight,
  Interest,
  Pace,
  QuestionStep,
  TripInput,
} from '../../types';
import { PlaceImage } from '../shared/PlaceImage';
import { PlacePickDetail } from './PlacePickDetail';
import '../../styles/questions.css';
import '../../styles/chat.css';

interface QuestionFlowProps {
  path: 'A' | 'B';
  selectedDestination?: DestinationCard | null;
  onBack: () => void;
  onComplete: (input: TripInput) => void;
}

const STEPS_A: QuestionStep[] = [
  'destination',
  'days',
  'dates',
  'hotel',
  'interests',
  'pace',
  'places',
  'schedule',
];
const STEPS_B: QuestionStep[] = [
  'days',
  'dates',
  'hotel',
  'interests',
  'pace',
  'places',
  'schedule',
];

function placesForCity(
  city: string,
  selectedDestination?: DestinationCard | null,
): DestinationHighlight[] {
  if (selectedDestination?.highlights?.length) {
    return selectedDestination.highlights;
  }
  const match = destinationRecommendations.find(
    (d) => d.city.toLowerCase() === city.trim().toLowerCase(),
  );
  return match?.highlights ?? [];
}

function PlacesGuideChat({
  city,
  selectedCount,
}: {
  city: string;
  selectedCount: number;
}) {
  const [phase, setPhase] = useState(0);
  const placeLabel = city.trim() || 'your destination';

  useEffect(() => {
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 450);
    const t2 = window.setTimeout(() => setPhase(2), 1400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [city]);

  return (
    <aside className="schedule-guide-chat" aria-live="polite">
      <div className="schedule-guide-chat-head">
        <span className="schedule-guide-avatar" aria-hidden>
          ✈
        </span>
        <div>
          <strong>Travel Agent</strong>
          <p>Place picks</p>
        </div>
      </div>
      <div className="schedule-guide-messages chatbot-messages">
        {phase === 0 && (
          <div className="chatbot-bubble chatbot-bubble--assistant chatbot-typing">
            Typing…
          </div>
        )}
        {phase >= 1 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            Here are places to visit in <strong>{placeLabel}</strong>. Tap the
            ones you’re interested in seeing.
          </div>
        )}
        {phase >= 2 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            Tap a card to open details, or use Add on the card. When you’re done
            choosing, I’ll organize those picks into the days you want — we’ll
            set your daily schedule after this.
          </div>
        )}
        {selectedCount > 0 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            Nice — {selectedCount} place{selectedCount === 1 ? '' : 's'} selected.
            Keep tapping to add more, then continue to set your schedule.
          </div>
        )}
      </div>
    </aside>
  );
}

function ScheduleGuideChat({
  city,
  selectedCount,
}: {
  city: string;
  selectedCount: number;
}) {
  const [phase, setPhase] = useState(0);
  const placeLabel = city.trim() || 'your destination';

  useEffect(() => {
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 450);
    const t2 = window.setTimeout(() => setPhase(2), 1400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [city, selectedCount]);

  return (
    <aside className="schedule-guide-chat" aria-live="polite">
      <div className="schedule-guide-chat-head">
        <span className="schedule-guide-avatar" aria-hidden>
          ✈
        </span>
        <div>
          <strong>Travel Agent</strong>
          <p>Daily schedule</p>
        </div>
      </div>
      <div className="schedule-guide-messages chatbot-messages">
        {phase === 0 && (
          <div className="chatbot-bubble chatbot-bubble--assistant chatbot-typing">
            Typing…
          </div>
        )}
        {phase >= 1 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            {selectedCount > 0 ? (
              <>
                Great — you’ve picked {selectedCount} place
                {selectedCount === 1 ? '' : 's'} in <strong>{placeLabel}</strong>.
                Now tell me when your days should start
                {selectedCount > 0 ? ' and about breakfast' : ''}.
              </>
            ) : (
              <>
                Last step for <strong>{placeLabel}</strong>: set when sightseeing
                starts and whether you want breakfast on the plan.
              </>
            )}
          </div>
        )}
        {phase >= 2 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            After this, I’ll arrange your chosen places into the days you want.
          </div>
        )}
      </div>
    </aside>
  );
}

export function QuestionFlow({
  path,
  selectedDestination,
  onBack,
  onComplete,
}: QuestionFlowProps) {
  const steps = path === 'A' ? STEPS_A : STEPS_B;
  const saved = useMemo(() => loadQuestionState(path), [path]);
  const weekend = useMemo(() => nextWeekendStart(), []);
  const defaultDays = selectedDestination?.suggestedDays ?? 4;

  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(saved?.stepIndex ?? 0, steps.length - 1),
  );
  const step = steps[stepIndex];

  const [city, setCity] = useState(
    () => saved?.city ?? selectedDestination?.city ?? '',
  );
  const [daysText, setDaysText] = useState(
    () => saved?.daysText ?? String(defaultDays),
  );
  const [startDate, setStartDate] = useState(
    () => saved?.startDate ?? toISODate(weekend),
  );
  const [endDate, setEndDate] = useState(
    () =>
      saved?.endDate ?? toISODate(addDays(weekend, defaultDays - 1)),
  );
  const [datesFlexible, setDatesFlexible] = useState(
    () => saved?.datesFlexible ?? false,
  );
  const [hotelAddress, setHotelAddress] = useState(
    () => saved?.hotelAddress ?? '',
  );
  const [notBooked, setNotBooked] = useState(() => saved?.notBooked ?? false);
  const [interests, setInterests] = useState<Interest[]>(() => {
    if (saved?.interests) return saved.interests;
    const initial = selectedDestination?.interests ?? [];
    if (selectedDestination && !selectedDestination.hasBeach) {
      return initial.filter((i) => i !== 'beach');
    }
    return initial;
  });
  const [customPreferences, setCustomPreferences] = useState(
    () => saved?.customPreferences ?? '',
  );
  const [pace, setPace] = useState<Pace>(() => saved?.pace ?? 'balanced');
  const [dayStartInput, setDayStartInput] = useState(
    () => saved?.dayStartInput ?? '9',
  );
  const [wantBreakfast, setWantBreakfast] = useState(
    () => saved?.wantBreakfast ?? true,
  );
  const [breakfastTimeInput, setBreakfastTimeInput] = useState(
    () => saved?.breakfastTimeInput ?? '8 thirty',
  );
  const [breakfastFood, setBreakfastFood] = useState(
    () => saved?.breakfastFood ?? '',
  );
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>(
    () => saved?.selectedPlaces ?? [],
  );
  const [viewingPlace, setViewingPlace] = useState<DestinationHighlight | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [hasBeach, setHasBeach] = useState<boolean | null>(
    selectedDestination ? selectedDestination.hasBeach : null,
  );
  const [beachChecking, setBeachChecking] = useState(false);

  useEffect(() => {
    saveQuestionState({
      path,
      stepIndex,
      city,
      daysText,
      startDate,
      endDate,
      datesFlexible,
      hotelAddress,
      notBooked,
      interests,
      customPreferences,
      pace,
      dayStartInput,
      wantBreakfast,
      breakfastTimeInput,
      breakfastFood,
      selectedPlaces,
    });
  }, [
    path,
    stepIndex,
    city,
    daysText,
    startDate,
    endDate,
    datesFlexible,
    hotelAddress,
    notBooked,
    interests,
    customPreferences,
    pace,
    dayStartInput,
    wantBreakfast,
    breakfastTimeInput,
    breakfastFood,
    selectedPlaces,
  ]);

  const parsedDays = parseDaysInput(daysText);
  const interestOptions = availableInterestOptions(hasBeach === true);
  const allSelected =
    interestOptions.length > 0 &&
    interestOptions.every((opt) => interests.includes(opt.id));

  useEffect(() => {
    if (step !== 'destination' || city.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void autocompletePlaces(city).then(setSuggestions);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [city, step]);

  useEffect(() => {
    if (!city.trim()) {
      setHasBeach(null);
      return;
    }
    if (selectedDestination && selectedDestination.city === city) {
      setHasBeach(selectedDestination.hasBeach);
      if (!selectedDestination.hasBeach) {
        setInterests((prev) => prev.filter((i) => i !== 'beach'));
      }
      return;
    }

    let cancelled = false;
    setBeachChecking(true);
    void cityHasBeach(city).then((result) => {
      if (cancelled) return;
      setHasBeach(result);
      setBeachChecking(false);
      if (!result) {
        setInterests((prev) => prev.filter((i) => i !== 'beach'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [city, selectedDestination]);

  const progress = ((stepIndex + 1) / steps.length) * 100;

  function toggleInterest(id: Interest) {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setInterests([]);
      return;
    }
    setInterests(interestOptions.map((opt) => opt.id));
  }

  function canContinue(): boolean {
    if (step === 'destination') return city.trim().length > 1;
    if (step === 'days') return parsedDays != null;
    if (step === 'dates') {
      return Boolean(startDate && endDate && endDate >= startDate);
    }
    if (step === 'hotel') return hotelAddress.trim().length > 3;
    if (step === 'interests') {
      return interests.length > 0 || customPreferences.trim().length > 0;
    }
    if (step === 'schedule') {
      if (parseFlexibleTime(dayStartInput) == null) return false;
      if (!wantBreakfast) return true;
      return parseFlexibleTime(breakfastTimeInput) != null;
    }
    if (step === 'places') {
      const list = placesForCity(city, selectedDestination);
      if (list.length === 0) return true;
      return selectedPlaces.length > 0;
    }
    return true;
  }

  function togglePlace(name: string) {
    setSelectedPlaces((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  const availablePlaces = useMemo(
    () => placesForCity(city, selectedDestination),
    [city, selectedDestination],
  );
  const allPlacesSelected =
    availablePlaces.length > 0 &&
    availablePlaces.every((p) => selectedPlaces.includes(p.name));

  function toggleSelectAllPlaces() {
    if (allPlacesSelected) {
      setSelectedPlaces([]);
      return;
    }
    setSelectedPlaces(availablePlaces.map((p) => p.name));
  }

  function finish() {
    if (!parsedDays) return;
    const startParsed = parseFlexibleTime(dayStartInput);
    if (!startParsed) return;
    const cleanedInterests = hasBeach
      ? interests
      : interests.filter((i) => i !== 'beach');
    const breakfastTime = wantBreakfast
      ? normalizeBreakfastTime(breakfastTimeInput)
      : 'skip';

    const planningStart = datesFlexible
      ? toISODate(weekend)
      : startDate;
    const planningEnd = datesFlexible
      ? toISODate(addDays(weekend, parsedDays.days - 1))
      : endDate;

    const placeNote =
      selectedPlaces.length > 0
        ? `Must-visit places: ${selectedPlaces.join(', ')}`
        : null;
    const prefs = [customPreferences.trim() || null, placeNote]
      .filter(Boolean)
      .join('; ');

    onComplete({
      destination_city: city.trim(),
      trip_length_days: parsedDays.days,
      days_range: parsedDays.range,
      start_date: planningStart,
      end_date: planningEnd,
      dates_flexible: datesFlexible,
      hotel_address: notBooked ? null : hotelAddress.trim(),
      suggested_area: notBooked ? 'City Center' : null,
      interests: cleanedInterests,
      custom_preferences: prefs || null,
      pace,
      day_start_time: startParsed,
      breakfast_time: breakfastTime,
      breakfast_food:
        breakfastTime === 'skip' ? null : breakfastFood.trim() || null,
    });
  }

  function next() {
    if (stepIndex >= steps.length - 1) {
      finish();
      return;
    }
    setViewingPlace(null);
    setStepIndex((i) => i + 1);
  }

  function prev() {
    if (viewingPlace) {
      setViewingPlace(null);
      return;
    }
    if (stepIndex === 0) {
      onBack();
      return;
    }
    setStepIndex((i) => i - 1);
  }

  return (
    <div className="questions">
      <div className="questions-header">
        <button type="button" className="btn btn-ghost" onClick={prev}>
          ← Back
        </button>
        <div className="brand-mark">Travel Agent</div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className={`question-card${viewingPlace ? ' question-card--story' : ''}`} key={step}>
        {step === 'destination' && (
          <>
            <h2>Where are you going?</h2>
            <p className="hint">Start typing a city — suggestions come from OpenStreetMap.</p>
            <div className="question-body">
              <div className="field">
                <label htmlFor="city">Destination</label>
                <input
                  id="city"
                  type="text"
                  value={city}
                  placeholder="e.g. Rome"
                  onChange={(e) => setCity(e.target.value)}
                  autoFocus
                />
              </div>
              {suggestions.length > 0 && (
                <ul className="suggestions">
                  {suggestions.map((s) => (
                    <li key={s.display_name}>
                      <button
                        type="button"
                        onClick={() => {
                          const short = s.display_name.split(',')[0];
                          setCity(short);
                          setSuggestions([]);
                        }}
                      >
                        {s.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 'days' && (
          <>
            <h2>How many days?</h2>
            <p className="hint">
              Type a number (e.g. 4), or a range if you’re unsure (e.g. 3-5 or 3 to 5).
            </p>
            <div className="question-body">
              <div className="field">
                <label htmlFor="days">Trip length</label>
                <input
                  id="days"
                  type="text"
                  inputMode="numeric"
                  value={daysText}
                  placeholder="4 or 3-5"
                  onChange={(e) => setDaysText(e.target.value)}
                  autoFocus
                />
              </div>
              {parsedDays?.range && (
                <p className="hint" style={{ margin: 0 }}>
                  Unsure range noted — we’ll plan for{' '}
                  <strong>{parsedDays.days} days</strong> (middle of{' '}
                  {parsedDays.range[0]}–{parsedDays.range[1]}).
                </p>
              )}
              {daysText.trim() && !parsedDays && (
                <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
                  Enter a number between 1–30, or a range like 3-5.
                </p>
              )}
            </div>
          </>
        )}

        {step === 'dates' && (
          <>
            <h2>When do you want to go?</h2>
            <p className="hint">
              Pick both dates if you know them — the end date is not calculated automatically.
            </p>
            <div className="question-body">
              <div className="field">
                <label htmlFor="start">Start date</label>
                <input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="end">End date</label>
                <input
                  id="end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {endDate && startDate && endDate < startDate && (
                <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
                  End date should be on or after the start date.
                </p>
              )}
            </div>
          </>
        )}

        {step === 'hotel' && (
          <>
            <h2>Where are you staying?</h2>
            <p className="hint">
              We anchor every day to your accommodation — or the city center if you haven’t booked.
            </p>
            <div className="question-body">
              <div className="field">
                <label htmlFor="hotel">Hotel or address</label>
                <input
                  id="hotel"
                  type="text"
                  value={hotelAddress}
                  placeholder="e.g. Via Nazionale 123, Rome"
                  onChange={(e) => {
                    setNotBooked(false);
                    setHotelAddress(e.target.value);
                  }}
                />
              </div>
            </div>
          </>
        )}

        {step === 'interests' && (
          <>
            <h2>What interests you?</h2>
            <p className="hint">
              Select preferences for {city || 'your trip'} — or choose all, and add anything extra below.
            </p>
            <div className="question-body">
              {beachChecking && (
                <p className="hint" style={{ margin: 0 }}>
                  Checking whether {city} has a beach…
                </p>
              )}
              {hasBeach === false && !beachChecking && (
                <p className="hint beach-note" style={{ margin: 0 }}>
                  No beach nearby for {city}, so Beach isn’t offered as a preference.
                </p>
              )}
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${allSelected ? 'active' : ''}`}
                  onClick={toggleSelectAll}
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
                {interestOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`chip ${interests.includes(opt.id) ? 'active' : ''}`}
                    onClick={() => toggleInterest(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="custom-pref">Anything else? (optional)</label>
                <input
                  id="custom-pref"
                  type="text"
                  value={customPreferences}
                  placeholder="e.g. kid-friendly, gelato, rooftop views, quiet parks…"
                  onChange={(e) => setCustomPreferences(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {step === 'pace' && (
          <>
            <h2>Trip pace?</h2>
            <p className="hint">Optional — Balanced is a solid default for most cities.</p>
            <div className="question-body">
              <div className="radio-stack">
                {PACE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`radio-option ${pace === opt.id ? 'active' : ''}`}
                    onClick={() => setPace(opt.id)}
                  >
                    <div>
                      <strong>{opt.label}</strong>
                      <span>{opt.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 'schedule' && (
          <>
            <h2>Daily schedule</h2>
            <p className="hint">
              Set when sightseeing starts, then tell us when and what you want for breakfast.
            </p>
            <ScheduleGuideChat city={city} selectedCount={selectedPlaces.length} />
            <div className="question-body">
              <div className="field">
                <label htmlFor="day-start">Start seeing places at</label>
                <input
                  id="day-start"
                  type="text"
                  value={dayStartInput}
                  placeholder='e.g. 9, 9:30, "8 thirty", half past eight'
                  onChange={(e) => setDayStartInput(e.target.value)}
                />
                {dayStartInput.trim() &&
                  parseFlexibleTime(dayStartInput) == null && (
                    <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
                      Try “9”, “8 thirty”, “half past eight”, or “9:30am”.
                    </p>
                  )}
                {parseFlexibleTime(dayStartInput) && (
                  <p className="hint" style={{ margin: 0 }}>
                    Sightseeing starts at{' '}
                    <strong>{parseFlexibleTime(dayStartInput)}</strong>.
                  </p>
                )}
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={wantBreakfast}
                  onChange={(e) => setWantBreakfast(e.target.checked)}
                />
                Include breakfast in the itinerary
              </label>

              {wantBreakfast && (
                <>
                  <div className="field">
                    <label htmlFor="breakfast-time">What time do you want to eat?</label>
                    <input
                      id="breakfast-time"
                      type="text"
                      value={breakfastTimeInput}
                      placeholder='e.g. 8, "8 thirty", half past eight, 9am'
                      onChange={(e) => setBreakfastTimeInput(e.target.value)}
                    />
                    {breakfastTimeInput.trim() &&
                      parseFlexibleTime(breakfastTimeInput) == null && (
                        <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
                          Try “8 thirty”, “half past eight”, or “9:30am”.
                        </p>
                      )}
                    {parseFlexibleTime(breakfastTimeInput) && (
                      <p className="hint" style={{ margin: 0 }}>
                        We’ll schedule breakfast at{' '}
                        <strong>{parseFlexibleTime(breakfastTimeInput)}</strong>.
                      </p>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="breakfast-food">What do you want to eat?</label>
                    <input
                      id="breakfast-food"
                      type="text"
                      value={breakfastFood}
                      placeholder="e.g. croissants, eggs, coffee, hotel buffet…"
                      onChange={(e) => setBreakfastFood(e.target.value)}
                    />
                  </div>
                  <div className="chip-row">
                    {BREAKFAST_FOOD_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className={`chip ${breakfastFood === suggestion ? 'active' : ''}`}
                        onClick={() => setBreakfastFood(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {step === 'places' && viewingPlace && (
          <PlacePickDetail
            spot={viewingPlace}
            city={city}
            country={selectedDestination?.country}
            selected={selectedPlaces.includes(viewingPlace.name)}
            onBack={() => {
              setViewingPlace(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onToggleAdd={() => togglePlace(viewingPlace.name)}
          />
        )}

        {step === 'places' && !viewingPlace && (
          <>
            <h2>Places to visit</h2>
            <p className="hint">
              Open a place to learn more, or add it straight from the card. We’ll
              fold your picks into your days.
            </p>
            <PlacesGuideChat city={city} selectedCount={selectedPlaces.length} />
            <div className="question-body">
              {availablePlaces.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>
                  No curated list for this city yet — add must-visits in chat after planning, or go back and pick a suggested destination.
                </p>
              ) : (
                <>
                  <div className="chip-row place-pick-toolbar">
                    <button
                      type="button"
                      className={`chip ${allPlacesSelected ? 'active' : ''}`}
                      onClick={toggleSelectAllPlaces}
                    >
                      {allPlacesSelected ? 'Clear all' : 'Select all'}
                    </button>
                    {selectedPlaces.length > 0 && (
                      <span className="hint" style={{ margin: 0 }}>
                        {selectedPlaces.length} selected
                      </span>
                    )}
                  </div>
                  <div className="place-pick-grid">
                    {availablePlaces.map((spot) => {
                      const active = selectedPlaces.includes(spot.name);
                      return (
                        <div
                          key={spot.name}
                          className={`place-pick-card ${active ? 'active' : ''}`}
                        >
                          <button
                            type="button"
                            className="place-pick-open"
                            onClick={() => {
                              setViewingPlace(spot);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            <PlaceImage
                              className="place-pick-photo"
                              name={spot.name}
                              city={city}
                              category={spot.category}
                            />
                            <div className="place-pick-copy">
                              <div className="place-pick-title">
                                <strong>{spot.name}</strong>
                                <span className="category-pill">{spot.category}</span>
                              </div>
                              <p>{spot.description}</p>
                              <span className="place-pick-status">
                                View details →
                              </span>
                            </div>
                          </button>
                          <div className="place-pick-card-actions">
                            <button
                              type="button"
                              className={`btn ${active ? 'btn-secondary' : 'btn-primary'} place-pick-add-btn`}
                              onClick={() => togglePlace(spot.name)}
                              aria-pressed={active}
                            >
                              {active ? 'Added ✓' : 'Add'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {!(step === 'places' && viewingPlace) && (
        <div className="question-actions">
          <button type="button" className="btn btn-secondary" onClick={prev}>
            Back
          </button>
          <div className="question-actions-right">
            {step === 'dates' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDatesFlexible(true);
                  next();
                }}
              >
                Skip for now
              </button>
            )}
            {step === 'hotel' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setNotBooked(true);
                  setHotelAddress('');
                  next();
                }}
              >
                Not booked yet
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canContinue()}
              onClick={() => {
                if (step === 'dates') setDatesFlexible(false);
                if (step === 'hotel') setNotBooked(false);
                next();
              }}
            >
              {stepIndex === steps.length - 1 ? 'Build itinerary' : 'Continue'}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
