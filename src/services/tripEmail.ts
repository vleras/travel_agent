import { minutesToLabel } from './geo';
import type { DayItinerary, ItineraryStop, TripInput } from '../types';

/** Google Maps pin for a stop (lat/lon). */
export function googleMapsUrl(stop: Pick<ItineraryStop, 'lat' | 'lon' | 'name'>): string {
  const q = `${stop.lat},${stop.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

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
      // Plain-text email: name + duration, then Maps URL on the next line
      // (FormSubmit escapes HTML, so the name itself can't be an <a> link).
      lines.push(
        `  • ${stop.name} — ${minutesToLabel(stop.duration_min)}`,
        `    ${googleMapsUrl(stop)}`,
      );
    }
    lines.push('');
  }

  lines.push('—', 'Sent from Travel Agent');
  return lines.join('\n');
}

export function buildTripEmail(input: TripInput, itinerary: DayItinerary[]) {
  const subject = `Your ${itinerary.length}-day plan for ${input.destination_city}`;
  const body = buildTripEmailBody(input, itinerary);
  return { subject, body };
}

export type SendTripEmailResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Emails a plain-text itinerary via FormSubmit.
 * FormSubmit escapes HTML in form fields, so we send readable text only
 * (custom HTML arrives as raw tags in the inbox).
 */
export async function sendTripPlanEmail(
  to: string,
  input: TripInput,
  itinerary: DayItinerary[],
): Promise<SendTripEmailResult> {
  const trimmed = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const { subject, body } = buildTripEmail(input, itinerary);

  try {
    const res = await fetch(
      `https://formsubmit.co/ajax/${encodeURIComponent(trimmed)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Travel Agent',
          _subject: subject,
          message: body,
          _template: 'box',
          _captcha: 'false',
        }),
      },
    );

    const data = (await res.json().catch(() => null)) as {
      success?: string | boolean;
      message?: string;
    } | null;

    if (!res.ok) {
      return {
        ok: false,
        error:
          data?.message ||
          'Couldn’t send the email right now. Try again in a moment.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Network error — check your connection and try again.',
    };
  }
}
