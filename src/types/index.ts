export type Pace = 'relaxed' | 'balanced' | 'packed';

export type Interest =
  | 'museums'
  | 'food'
  | 'art'
  | 'nature'
  | 'nightlife'
  | 'shopping'
  | 'beach'
  | 'architecture'
  | 'photography';

export type BreakfastOption = string; // 'skip' or 'HH:MM'

export interface DestinationCard {
  id: string;
  city: string;
  country: string;
  imageUrl: string;
  tagline: string;
  tags: string[];
  suggestedDays: number;
  description: string;
  interests: Interest[];
  /** Whether this destination has a beach / coastline. */
  hasBeach: boolean;
}

export interface TripInput {
  destination_city: string;
  trip_length_days: number;
  days_range: [number, number] | null;
  start_date: string;
  end_date: string;
  hotel_address: string | null;
  suggested_area: string | null;
  interests: Interest[];
  custom_preferences: string | null;
  pace: Pace;
  day_start_time: string;
  breakfast_time: BreakfastOption;
  breakfast_food: string | null;
}

export interface TripLocation {
  destination_lat: number;
  destination_lon: number;
  destination_name: string;
  hotel_lat: number | null;
  hotel_lon: number | null;
  hotel_name: string | null;
  base_lat: number;
  base_lon: number;
}

export interface Attraction {
  name: string;
  category: string;
  description: string;
  typical_visit_duration_minutes: number;
  why_visit?: string;
  lat?: number;
  lon?: number;
  image_url?: string;
}

export interface ItineraryStop {
  name: string;
  category: string;
  description: string;
  lat: number;
  lon: number;
  duration_min: number;
  time_slot: string;
  distance_to_next_km?: number;
  image_url?: string;
  is_meal?: boolean;
}

export interface DayItinerary {
  date: string;
  day_number: number;
  stops: ItineraryStop[];
  total_distance_km: number;
  compactness_score: number;
  hotel_distance_km: number;
}

export interface Revision {
  day_from: number;
  day_to: number;
  stop_name: string;
  reason: string;
}

export interface AgentMetrics {
  agent_processing_time_ms: number;
  compactness_before_revision: number;
  compactness_after_revision: number;
  improvement_delta: number;
  revision_count: number;
  api_calls_total: number;
  api_call_latency: {
    nominatim_ms: number;
    osrm_ms: number;
    gemini_ms: number;
  };
}

export interface AgentOutput {
  itinerary: DayItinerary[];
  revisions: Revision[];
  metadata: {
    destination: string;
    hotel_lat: number;
    hotel_lon: number;
    total_trip_distance_km: number;
    average_compactness: number;
    agent_revision_count: number;
    agent_processing_time_ms: number;
  };
  metrics: AgentMetrics;
}

export type AgentStep =
  | 'idle'
  | 'reason'
  | 'act'
  | 'observe'
  | 'revise'
  | 'done'
  | 'error';

export interface AgentProgress {
  step: AgentStep;
  message: string;
  detail?: string;
}

export type AppScreen = 'entry' | 'questions' | 'processing' | 'trip';

export type QuestionStep =
  | 'destination'
  | 'days'
  | 'dates'
  | 'hotel'
  | 'interests'
  | 'pace'
  | 'schedule';
