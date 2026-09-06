import type { DestinationCard } from '../types';

export const destinationRecommendations: DestinationCard[] = [
  {
    id: 'rome',
    city: 'Rome',
    country: 'Italy',
    imageUrl:
      'https://images.unsplash.com/photo-1552832860-cfcddd32af19?w=800&q=80',
    tagline: 'Ancient history, art, food',
    tags: ['Culture', 'Food', 'History'],
    suggestedDays: 4,
    description: 'Explore centuries of history in the Eternal City',
    interests: ['museums', 'food', 'art'],
    hasBeach: false,
  },
  {
    id: 'tokyo',
    city: 'Tokyo',
    country: 'Japan',
    imageUrl:
      'https://images.unsplash.com/photo-1540959375944-7049f642e9cc?w=800&q=80',
    tagline: 'Modern + traditional, incredible food',
    tags: ['Culture', 'Food', 'Technology'],
    suggestedDays: 5,
    description: 'Blend of ancient temples and cutting-edge technology',
    interests: ['food', 'museums', 'nightlife'],
    hasBeach: false,
  },
  {
    id: 'barcelona',
    city: 'Barcelona',
    country: 'Spain',
    imageUrl:
      'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
    tagline: 'Architecture, beaches, food scene',
    tags: ['Culture', 'Beach', 'Food'],
    suggestedDays: 4,
    description: "Gaudí's masterpieces, Mediterranean beaches, tapas paradise",
    interests: ['museums', 'beach', 'food', 'architecture'],
    hasBeach: true,
  },
  {
    id: 'bangkok',
    city: 'Bangkok',
    country: 'Thailand',
    imageUrl:
      'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&q=80',
    tagline: 'Street food, temples, nightlife',
    tags: ['Food', 'Culture', 'Adventure'],
    suggestedDays: 4,
    description: 'Vibrant street markets, ornate temples, bustling nightlife',
    interests: ['food', 'nightlife', 'architecture'],
    hasBeach: false,
  },
  {
    id: 'paris',
    city: 'Paris',
    country: 'France',
    imageUrl:
      'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
    tagline: 'Museums, art, romance, cafes',
    tags: ['Culture', 'Art', 'Food'],
    suggestedDays: 5,
    description: 'The City of Light offers world-class art, history, and cuisine',
    interests: ['museums', 'art', 'food'],
    hasBeach: false,
  },
];

export const INTEREST_OPTIONS = [
  { id: 'museums' as const, label: 'Museums' },
  { id: 'food' as const, label: 'Food' },
  { id: 'art' as const, label: 'Art & History' },
  { id: 'nature' as const, label: 'Nature' },
  { id: 'nightlife' as const, label: 'Nightlife' },
  { id: 'shopping' as const, label: 'Shopping' },
  { id: 'beach' as const, label: 'Beach' },
  { id: 'architecture' as const, label: 'Architecture' },
  { id: 'photography' as const, label: 'Photography' },
];

export function availableInterestOptions(hasBeach: boolean) {
  return INTEREST_OPTIONS.filter((opt) => opt.id !== 'beach' || hasBeach);
}
export const PACE_OPTIONS = [
  {
    id: 'relaxed' as const,
    label: 'Relaxed',
    description: '3–4 stops per day',
  },
  {
    id: 'balanced' as const,
    label: 'Balanced',
    description: '5–7 stops per day',
  },
  {
    id: 'packed' as const,
    label: 'Packed',
    description: '8+ stops per day',
  },
];
