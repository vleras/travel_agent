import { useEffect, useMemo, useRef, useState } from 'react';
import { destinationRecommendations, withoutFoodPlaces } from '../../data/destinations';
import { fallbackAttractions } from '../../data/fallbackAttractions';
import { parseDaysInput } from '../../data/scheduleOptions';
import { addDays, nextWeekendStart, toISODate } from '../../services/geo';
import { generateAttractions } from '../../services/gemini';
import { autocompletePlaces, type GeocodeResult } from '../../services/nominatim';
import {
  loadQuestionState,
  saveQuestionState,
} from '../../services/sessionState';
import type {
  Attraction,
  DestinationCard,
  DestinationHighlight,
  QuestionStep,
  TripInput,
  TripAccommodation,
} from '../../types';
import { PlaceImage } from '../shared/PlaceImage';
import { AddressSearchMap } from '../shared/AddressSearchMap';
import { PlacePickDetail } from './PlacePickDetail';
import { InteractiveTripChat, type TripChatState } from './InteractiveTripChat';
import type { TripChatData } from '../../services/tripChatExtraction';
import '../../styles/questions.css';
import '../../styles/chat.css';

interface QuestionFlowProps {
  path: 'A' | 'B';
  selectedDestination?: DestinationCard | null;
  onBack: () => void;
  onComplete: (input: TripInput) => void;
  onGlobalChatSuppressionChange?: (hidden: boolean) => void;
}

const STEPS_A: QuestionStep[] = [
  'destination',
  'days',
  'hotel',
  'places',
];
const STEPS_B: QuestionStep[] = [
  'days',
  'hotel',
  'places',
];

const DEFAULT_PACE = 'balanced' as const;
const MIN_PLACE_OPTIONS = 10;

function attractionToHighlight(a: Attraction): DestinationHighlight {
  return {
    name: a.name,
    category: a.category,
    description: a.description,
  };
}

function curatedAttractionsForCity(city: string): Attraction[] {
  const key = city.toLowerCase().trim();
  const match = Object.keys(fallbackAttractions).find(
    (k) => key.includes(k) || k.includes(key),
  );
  if (!match) return [];
  return fallbackAttractions[match];
}

function curatedPlacesForCity(city: string): DestinationHighlight[] {
  return withoutFoodPlaces(curatedAttractionsForCity(city)).map(attractionToHighlight);
}

function mergePlaceLists(
  primary: DestinationHighlight[],
  extras: DestinationHighlight[],
): DestinationHighlight[] {
  const seen = new Set(primary.map((p) => p.name.trim().toLowerCase()));
  const merged = [...primary];
  for (const place of extras) {
    const key = place.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(place);
  }
  return merged;
}

function placesForCity(
  city: string,
  selectedDestination?: DestinationCard | null,
): DestinationHighlight[] {
  const curated = curatedPlacesForCity(city);
  if (curated.length >= MIN_PLACE_OPTIONS) {
    return curated;
  }

  const fromCard = selectedDestination?.highlights?.length
    ? selectedDestination.highlights
    : destinationRecommendations.find(
        (d) => d.city.toLowerCase() === city.trim().toLowerCase(),
      )?.highlights ?? [];

  return withoutFoodPlaces(mergePlaceLists(fromCard, curated));
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
            choosing, I’ll organize those picks into your days.
          </div>
        )}
        {selectedCount > 0 && (
          <div className="chatbot-bubble chatbot-bubble--assistant schedule-guide-bubble">
            {selectedCount} place{selectedCount === 1 ? '' : 's'} selected.
            Keep tapping to add more, then continue to build your itinerary.
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
  onGlobalChatSuppressionChange,
}: QuestionFlowProps) {
  const steps = path === 'A' ? STEPS_A : STEPS_B;
  const saved = useMemo(() => loadQuestionState(path), [path]);
  const weekend = useMemo(() => nextWeekendStart(), []);

  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(saved?.stepIndex ?? 0, steps.indexOf('days')),
  );
  const step = steps[stepIndex];

  const [city, setCity] = useState(
    () => saved?.city ?? selectedDestination?.city ?? '',
  );
  const [daysText, setDaysText] = useState('');
  const [chatMode, setChatMode] = useState(true);
  const [chatData, setChatData] = useState<TripChatData | null>(null);
  const [chatState, setChatState] = useState<TripChatState | null>(null);
  const [notBooked, setNotBooked] = useState(false);
  const [accommodation, setAccommodation] = useState<TripAccommodation | null>(null);

  const [selectedPlaces, setSelectedPlaces] = useState<string[]>(
    () => saved?.selectedPlaces ?? [],
  );
  const [viewingPlace, setViewingPlace] = useState<DestinationHighlight | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [generatedPlaces, setGeneratedPlaces] = useState<Attraction[]>([]);
  const [generatingCity, setGeneratingCity] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const placesRequest = useRef(0);

  useEffect(() => {
    onGlobalChatSuppressionChange?.(chatMode || step === 'places');
    return () => onGlobalChatSuppressionChange?.(false);
  }, [chatMode, onGlobalChatSuppressionChange, step]);

  async function loadGeneratedPlaces(targetCity = city.trim()) {
    if (!targetCity) return;
    const request = ++placesRequest.current;
    setGeneratingCity(targetCity);
    setGenerationError(null);
    try {
      const generated = await generateAttractions(
        targetCity,
        chatData?.interests ?? selectedDestination?.interests ?? [],
        null,
      );
      if (request !== placesRequest.current) return;
      const sightseeing = withoutFoodPlaces(generated.attractions);
      setGeneratedPlaces(sightseeing);
      if (!sightseeing.length) {
        setGenerationError(`We couldn’t generate attractions for ${targetCity}. Please try again.`);
      }
    } catch {
      if (request === placesRequest.current) {
        setGenerationError(`We couldn’t generate attractions for ${targetCity}. Please try again.`);
      }
    } finally {
      if (request === placesRequest.current) setGeneratingCity(null);
    }
  }

  useEffect(() => {
    saveQuestionState({
      path,
      stepIndex,
      city,
      selectedPlaces,
    });
  }, [
    path,
    stepIndex,
    city,
    selectedPlaces,
  ]);

  const parsedDays = parseDaysInput(daysText);

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
    const targetCity = city.trim();
    placesRequest.current += 1;
    setGeneratedPlaces([]);
    setGenerationError(null);
    setGeneratingCity(null);
    setSelectedPlaces([]);
    if (!targetCity || placesForCity(targetCity, selectedDestination).length >= MIN_PLACE_OPTIONS) {
      return;
    }

    // Debounce free-text entry so only the settled destination starts a request.
    const timer = window.setTimeout(() => {
      void loadGeneratedPlaces(targetCity);
    }, 600);
    return () => {
      window.clearTimeout(timer);
      placesRequest.current += 1;
    };
    // loadGeneratedPlaces reads only the destination represented by these dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, selectedDestination, chatData?.interests]);

  const progress = ((stepIndex + 1) / steps.length) * 100;

  function canContinue(): boolean {
    if (step === 'destination') return city.trim().length > 1;
    if (step === 'days') return parsedDays != null;
    if (step === 'hotel') return accommodation != null;
    if (step === 'places') {
      const hasPlaces = placesForCity(city, selectedDestination).length > 0 || generatedPlaces.length > 0;
      return generatingCity !== city.trim() && hasPlaces && selectedPlaces.length > 0;
    }
    return true;
  }

  function togglePlace(name: string) {
    setSelectedPlaces((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  const availablePlaces = useMemo(
    () =>
      withoutFoodPlaces(
        mergePlaceLists(
          placesForCity(city, selectedDestination),
          generatedPlaces.map(attractionToHighlight),
        ),
      ),
    [city, selectedDestination, generatedPlaces],
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
    if (!parsedDays || (!chatData && !notBooked && !accommodation)) return;
    const planningStart = toISODate(weekend);
    const planningEnd = toISODate(addDays(weekend, parsedDays.days - 1));

    const placeNote =
      selectedPlaces.length > 0
        ? `Must-visit places: ${selectedPlaces.join(', ')}`
        : null;
    const curatedAttractions = curatedAttractionsForCity(city);
    const selectedAttractions = selectedPlaces.flatMap((name) => {
      const normalized = name.trim().toLowerCase();
      const match = generatedPlaces.find((place) => place.name.trim().toLowerCase() === normalized) ??
        curatedAttractions.find((place) => place.name.trim().toLowerCase() === normalized);
      return match ? [{ ...match }] : [];
    });

    onComplete({
      destination_city: city.trim(),
      trip_length_days: parsedDays.days,
      days_range: parsedDays.range,
      start_date: planningStart,
      end_date: planningEnd,
      dates_flexible: true,
      hotel_address: notBooked ? null : accommodation?.address ?? null,
      hotel_location: notBooked || !accommodation ? null : { lat: accommodation.latitude, lon: accommodation.longitude, display_name: accommodation.address },
      accommodation: notBooked ? null : accommodation,
      budget: chatData?.budget ?? null,
      suggested_area: chatData?.accommodationPreference ?? (notBooked ? 'City Center' : null),
      interests: chatData?.interests ?? selectedDestination?.interests ?? [],
      custom_preferences: [placeNote, chatData?.travelDates ? `Travel dates: ${chatData.travelDates}` : null, ...(chatData?.extraPreferences ?? [])].filter(Boolean).join('; ') || null,
      must_visit_places: selectedPlaces,
      must_visit_attractions: selectedAttractions,
      pace: DEFAULT_PACE,
      day_start_time: '09:00',
      breakfast_time: 'skip',
      breakfast_food: null,
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

  useEffect(() => {
    function continueOnEnter(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button, a, textarea, [role="option"]')) return;
      if (step === 'places' || viewingPlace || !canContinue()) return;
      event.preventDefault();
      if (step === 'hotel') setNotBooked(false);
      next();
    }
    document.addEventListener('keydown', continueOnEnter);
    return () => document.removeEventListener('keydown', continueOnEnter);
  });

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

  if (chatMode && step !== 'places') {
    return (
      <div className="questions">
        <div className="questions-header"><button type="button" className="btn btn-ghost" onClick={onBack}>← Back</button><div className="brand-mark">Travel Agent</div></div>
        <InteractiveTripChat
          initialDestination={(selectedDestination?.city ?? city) || undefined}
          onPreferForm={() => setChatMode(false)}
          savedState={chatState}
          onStateChange={setChatState}
          onReady={(trip) => {
            setChatData(trip);
            setCity(trip.destination ?? city);
            setDaysText(trip.tripLength?.range ? `${trip.tripLength.range[0]}-${trip.tripLength.range[1]}` : String(trip.tripLength?.days ?? ''));
            setAccommodation(trip.accommodation);
            setNotBooked(!trip.hasAccommodation);
            setStepIndex(steps.indexOf('places'));
          }}
        />
      </div>
    );
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

      <div
        className={`question-card${
          viewingPlace
            ? ' question-card--story'
            : step === 'places'
              ? ' question-card--places'
              : ''
        }`}
        key={step}
      >
        {step === 'destination' && (
          <>
            <h2>Where are you going?</h2>
            <p className="hint">Start typing a city to see suggestions from OpenStreetMap.</p>
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
                  autoComplete="off"
                  value={daysText}
                  placeholder="4 or 3-5"
                  onChange={(e) => setDaysText(e.target.value)}
                  autoFocus
                />
              </div>
              {parsedDays?.range && (
                <p className="hint" style={{ margin: 0 }}>
                  Based on your range, we’ll plan for{' '}
                  <strong>{parsedDays.days} days</strong> (middle of{' '}
                  {parsedDays.range[0]} to {parsedDays.range[1]}).
                </p>
              )}
              {daysText.trim() && !parsedDays && (
                <p className="hint" style={{ margin: 0, color: 'var(--coral)' }}>
                  Enter a number between 1 and 30, or a range like 3 to 5.
                </p>
              )}
            </div>
          </>
        )}

        {step === 'hotel' && (
          <>
            <h2>Where are you staying?</h2>
            <p className="hint">
              Each day starts from your accommodation, or the city center if you haven’t booked.
            </p>
            <div className="question-body">
              <AddressSearchMap
                city={city}
                value={accommodation}
                onChange={() => {
                  setAccommodation(null);
                  setNotBooked(false);
                }}
                onConfirm={(selection) => {
                  setAccommodation(selection);
                  setNotBooked(false);
                }}
              />
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
              {generatingCity === city.trim() && availablePlaces.length === 0 ? (
                <p className="hint" role="status" style={{ margin: 0 }}>
                  Generating attraction cards for {city}…
                </p>
              ) : availablePlaces.length === 0 ? (
                <div>
                  <p className="hint" role="alert" style={{ margin: '0 0 12px' }}>
                    {generationError || `No places are available for ${city} yet.`}
                  </p>
                  <button type="button" className="btn btn-secondary" disabled={generatingCity === city.trim()} onClick={() => void loadGeneratedPlaces()}>
                    Try again
                  </button>
                </div>
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
            {step === 'hotel' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setAccommodation(null);
                  setNotBooked(true);
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
                if (step === 'hotel') setNotBooked(false);
                next();
              }}
            >
              {stepIndex === steps.length - 1 ? 'Organize by day' : 'Continue'}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
