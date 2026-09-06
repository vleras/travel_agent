export type BreakfastCategory =
  | 'all'
  | 'bakery'
  | 'cafe'
  | 'coffee'
  | 'hotel'
  | 'brunch';

export interface BreakfastPlace {
  id: string;
  name: string;
  category: BreakfastCategory;
  categoryLabel: string;
  description: string;
  lat: number;
  lon: number;
  distance_km?: number;
  address?: string;
  opening_hours?: string;
  cuisine?: string;
  phone?: string;
  website?: string;
  menu_url?: string;
  osm_url?: string;
  /** Direct photo from OSM `image=*` when present */
  image_url?: string;
  wikidata_id?: string;
  wikipedia_tag?: string;
  commons_tag?: string;
  source: 'overpass' | 'curated';
}

export const BREAKFAST_CATEGORIES: {
  id: BreakfastCategory;
  label: string;
  hint: string;
}[] = [
  { id: 'all', label: 'All', hint: 'Everything nearby' },
  { id: 'bakery', label: 'Bakeries', hint: 'Pastries, bread, quick bites' },
  { id: 'cafe', label: 'Cafés', hint: 'Sit-down breakfast cafés' },
  { id: 'coffee', label: 'Coffee', hint: 'Coffee shops & espresso bars' },
  { id: 'brunch', label: 'Brunch', hint: 'Hearty morning plates' },
  { id: 'hotel', label: 'Hotel', hint: 'Breakfast at your stay' },
];
