import type { DayItinerary } from '../../types';

interface CompactnessBadgeProps {
  day: DayItinerary;
}

function scoreClass(score: number): string {
  if (score >= 90) return 'good';
  if (score >= 70) return 'ok';
  return 'poor';
}

export function CompactnessBadge({ day }: CompactnessBadgeProps) {
  return (
    <div className={`score-badge ${scoreClass(day.compactness_score)}`}>
      <span>Compactness: {day.compactness_score}/100</span>
      <span>·</span>
      <span>Total: {day.total_distance_km} km</span>
    </div>
  );
}
