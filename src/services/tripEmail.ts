import { minutesToLabel } from './geo';
import type { DayItinerary, TripInput } from '../types';

export function buildTripEmailBody(
  input: TripInput,
  itinerary: DayItinerary[],
): string {
  const lines: string[] = [
    `Your trip to ${input.destination_city}`,
    `${itinerary.length} day${itinerary.length === 1 ? '' : 's'} · starting ${input.start_date}`,
    '',
  ];

  if (input.hotel_address) {
    lines.push(`Stay: ${input.hotel_address}`, '');
  }

  for (const day of itinerary) {
    const sights = day.stops.filter((s) => !s.is_meal);
    lines.push(`Day ${day.day_number} (${day.date})`);
    if (!sights.length) {
      lines.push('  (no places yet)', '');
      continue;
    }
    for (const stop of sights) {
      lines.push(`  • ${stop.name} — ${minutesToLabel(stop.duration_min)}`);
      if (stop.description) {
        lines.push(`    ${stop.description}`);
      }
    }
    lines.push('');
  }

  lines.push('—', 'Sent from Travel Agent');
  return lines.join('\n');
}

export function buildTripEmail(input: TripInput, itinerary: DayItinerary[]) {
  const subject = `Trip plan: ${input.destination_city} (${itinerary.length} days)`;
  const body = buildTripEmailBody(input, itinerary);
  return { subject, body };
}

export function openTripMailto(
  email: string,
  input: TripInput,
  itinerary: DayItinerary[],
): void {
  const { subject, body } = buildTripEmail(input, itinerary);
  const href = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}
